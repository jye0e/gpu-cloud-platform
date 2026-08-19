"""
Docker 容器管理服务
- 容器创建与调度
- GPU 资源分配
- 多引擎推理服务启动
- 容器生命周期管理
"""

import json
import socket
from typing import Optional

import docker
from docker.errors import DockerException, NotFound, APIError

from app.config import settings
from app.core.logging import logger
from app.models import DeployedService, ServiceStatus, Tenant
from app.services.engine_registry import (
    EngineType,
    get_engine_config,
    build_engine_command,
    get_health_check_url,
)


# Docker 客户端（延迟初始化，服务器上才有）
_docker_client: Optional[docker.DockerClient] = None


def get_docker_client() -> docker.DockerClient:
    """获取 Docker 客户端单例"""
    global _docker_client
    if _docker_client is None:
        try:
            _docker_client = docker.DockerClient(
                base_url=settings.DOCKER_SOCKET,
                timeout=30,
            )
            # 测试连接
            _docker_client.ping()
            logger.info("Docker 客户端连接成功")
        except DockerException as e:
            logger.error(f"Docker 连接失败: {e}")
            raise
    return _docker_client


def find_free_port(start: int = 28000, end: int = 29000) -> int:
    """查找可用端口"""
    for port in range(start, end):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("0.0.0.0", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"在 {start}-{end} 范围内未找到可用端口")


def get_gpu_info() -> dict:
    """
    获取 GPU 信息（通过 nvidia-smi）
    返回每块 GPU 的显存使用情况
    """
    import subprocess
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=index,name,memory.total,memory.used,memory.free",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return {}

        gpus = {}
        for line in result.stdout.strip().split("\n"):
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 5:
                gpu_id = parts[0]
                gpus[gpu_id] = {
                    "name": parts[1],
                    "total_mb": int(parts[2]),
                    "used_mb": int(parts[3]),
                    "free_mb": int(parts[4]),
                }
        return gpus
    except Exception as e:
        logger.warning(f"获取 GPU 信息失败: {e}")
        return {}


def select_gpu_for_tenant(tenant: Tenant) -> str:
    """
    为租户选择最合适的 GPU
    策略：选择空闲显存最多的 GPU
    """
    gpu_info = get_gpu_info()
    if not gpu_info:
        # 没有 GPU 信息，返回默认 0
        logger.warning("无法获取 GPU 信息，默认使用 GPU 0")
        return "0"

    # 过滤掉预留显存不足的 GPU
    best_gpu = None
    best_free = 0
    for gpu_id, info in gpu_info.items():
        # 保留系统预留显存
        available = info["free_mb"] - settings.GPU_MEMORY_RESERVE_MB
        if available > best_free:
            best_free = available
            best_gpu = gpu_id

    if best_gpu is None:
        raise RuntimeError("没有可用的 GPU 资源")

    logger.info(
        f"为租户 {tenant.tenant_id} 分配 GPU {best_gpu} "
        f"(空闲显存: {best_free}MB)"
    )
    return best_gpu


async def deploy_service(
    db,
    tenant: Tenant,
    service: DeployedService,
    model_path: str,
    deploy_params: dict,
    engine_type: str = "vllm",
    custom_image: Optional[str] = None,
    custom_entrypoint: Optional[list[str]] = None,
) -> DeployedService:
    """
    核心部署逻辑：
    1. 选择 GPU
    2. 创建 Docker 容器（挂载模型文件、分配 GPU）
    3. 启动推理引擎服务
    4. 等待服务就绪
    """
    logger.info(
        f"开始部署服务 | tenant={tenant.tenant_id} service={service.service_name} "
        f"engine={engine_type} model_path={model_path}"
    )

    try:
        # 更新状态为部署中
        service.status = ServiceStatus.DEPLOYING
        await db.flush()

        # 获取引擎配置
        engine_config = get_engine_config(engine_type, custom_image)
        logger.info(f"引擎配置: {engine_config.label} ({engine_config.docker_image})")

        client = get_docker_client()

        # 1. 选择 GPU
        gpu_id = select_gpu_for_tenant(tenant)
        service.gpu_device_id = gpu_id

        # 2. 分配内部端口
        engine_port = find_free_port()
        service.vllm_port = engine_port

        # 3. 构建容器名称
        container_name = f"{tenant.tenant_id}_svc_{service.id}"
        service.container_name = container_name

        # 4. 构建引擎启动命令
        engine_cmd = build_engine_command(
            engine_type=engine_type,
            model_path=model_path,
            deploy_params=deploy_params,
            engine_config=engine_config,
            custom_entrypoint=custom_entrypoint,
        )
        logger.info(f"引擎启动命令: {engine_cmd}")

        # 5. 创建 Docker 容器
        container_kwargs = dict(
            image=engine_config.docker_image,
            name=container_name,
            device_requests=[
                docker.types.DeviceRequest(
                    device_ids=[gpu_id],
                    capabilities=[["gpu"]],
                )
            ],
            ports={"8000/tcp": engine_port},
            detach=True,
            auto_remove=False,
            network_mode="bridge",
        )

        # 只有非空命令才传
        if engine_cmd:
            container_kwargs["command"] = engine_cmd

        # 挂载模型文件（非 Ollama 等管理型引擎）
        if engine_type != EngineType.OLLAMA.value:
            if "volumes" not in container_kwargs:
                container_kwargs["volumes"] = {}
            container_kwargs["volumes"][model_path] = {"bind": model_path, "mode": "ro"}

        # 资源限制
        mem_limit = deploy_params.get("memory_limit_gb", 16)
        if mem_limit:
            container_kwargs["mem_limit"] = f"{mem_limit}g"
        cpu_limit = deploy_params.get("cpu_limit", 4.0)
        if cpu_limit:
            container_kwargs["cpu_limit"] = cpu_limit

        # 额外环境变量
        if engine_config.extra_env:
            container_kwargs["environment"] = engine_config.extra_env

        container = client.containers.create(**container_kwargs)

        service.container_id = container.id
        await db.flush()

        # 6. 启动容器
        container.start()
        logger.info(
            f"容器已启动 | container={container_name} id={container.id[:12]} "
            f"gpu={gpu_id} port={engine_port} engine={engine_type}"
        )

        # 7. 等待服务就绪（最多等待 120 秒）
        import asyncio
        import httpx

        health_url = get_health_check_url(engine_type, engine_config, engine_port)
        ready = False

        for attempt in range(24):  # 24 * 5s = 120s
            await asyncio.sleep(5)
            try:
                resp = await httpx.AsyncClient().get(health_url, timeout=5)
                if resp.status_code == 200:
                    ready = True
                    logger.info(
                        f"引擎服务就绪 | service={service.service_name} "
                        f"engine={engine_type} 尝试次数={attempt + 1}"
                    )
                    break
            except Exception:
                logger.debug(
                    f"等待 {engine_type} 就绪... 尝试 {attempt + 1}/24"
                )

        if not ready:
            # 获取容器日志用于排错
            try:
                logs = container.logs(tail=50).decode("utf-8", errors="replace")
                logger.error(f"{engine_type} 启动超时，容器日志:\n{logs}")
            except Exception:
                pass

            # 清理容器
            try:
                container.stop()
                container.remove()
            except Exception:
                pass

            service.status = ServiceStatus.ERROR
            service.error_message = f"{engine_type} 服务启动超时（120秒内未就绪）"
            await db.flush()
            raise RuntimeError(f"{engine_type} 服务启动超时")

        # 8. 部署成功
        service.status = ServiceStatus.RUNNING
        service.error_message = None
        service.service_port = engine_port
        await db.flush()

        logger.info(
            f"部署成功 | tenant={tenant.tenant_id} service={service.service_name} "
            f"engine={engine_type} port={engine_port} gpu={gpu_id}"
        )

        return service

    except Exception as e:
        logger.error(f"部署失败: {e}", exc_info=True)
        service.status = ServiceStatus.ERROR
        service.error_message = str(e)
        await db.flush()
        raise


async def stop_service(service: DeployedService):
    """停止服务（停止容器但保留）"""
    if not service.container_id:
        return

    try:
        client = get_docker_client()
        container = client.containers.get(service.container_id)
        container.stop(timeout=10)
        logger.info(f"容器已停止 | container={service.container_name}")
    except NotFound:
        logger.warning(f"容器不存在: {service.container_id}")
    except Exception as e:
        logger.error(f"停止容器失败: {e}")
        raise

    service.status = ServiceStatus.STOPPED


async def start_service(service: DeployedService):
    """启动已停止的服务（复用容器）"""
    if not service.container_id:
        raise ValueError("容器不存在，需要重新部署")

    try:
        client = get_docker_client()
        container = client.containers.get(service.container_id)
        container.start()
        logger.info(f"容器已重新启动 | container={service.container_name}")
    except NotFound:
        logger.warning(f"容器不存在: {service.container_id}，需要重新部署")
        service.status = ServiceStatus.ERROR
        service.error_message = "容器已被删除，需要重新部署"
        raise
    except Exception as e:
        logger.error(f"启动容器失败: {e}")
        raise

    service.status = ServiceStatus.RUNNING


async def remove_service(service: DeployedService):
    """彻底删除服务（停止并删除容器）"""
    if not service.container_id:
        return

    try:
        client = get_docker_client()
        container = client.containers.get(service.container_id)
        try:
            container.stop(timeout=10)
        except Exception:
            pass
        container.remove()
        logger.info(f"容器已删除 | container={service.container_name}")
    except NotFound:
        logger.warning(f"容器不存在: {service.container_id}")
    except Exception as e:
        logger.error(f"删除容器失败: {e}")
        raise


async def get_container_status(service: DeployedService) -> dict:
    """获取容器实时状态"""
    if not service.container_id:
        return {"exists": False}

    try:
        client = get_docker_client()
        container = client.containers.get(service.container_id)
        container.reload()
        return {
            "exists": True,
            "status": container.status,  # running / exited / paused
            "name": container.name,
            "image": container.image.tags[0] if container.image.tags else "unknown",
        }
    except NotFound:
        return {"exists": False}
    except Exception as e:
        return {"exists": False, "error": str(e)}


async def get_container_logs(service: DeployedService, tail: int = 100) -> str:
    """获取容器日志（用于调试）"""
    if not service.container_id:
        return "容器不存在"

    try:
        client = get_docker_client()
        container = client.containers.get(service.container_id)
        logs = container.logs(tail=tail).decode("utf-8", errors="replace")
        return logs
    except Exception as e:
        return f"获取日志失败: {e}"

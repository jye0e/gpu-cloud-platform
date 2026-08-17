"""
资源管控服务
- GPU 资源监控
- 存储配额管理
- 闲置服务休眠
- QPS 限流
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.logging import logger
from app.models import DeployedService, ServiceStatus, Tenant
from app.services.docker_service import (
    get_gpu_info,
    stop_service,
    get_container_status,
)


async def get_tenant_resource_usage(tenant: Tenant) -> dict:
    """获取租户资源使用概况"""
    from app.services.upload_service import get_tenant_storage_usage

    storage_bytes = await get_tenant_storage_usage(tenant.tenant_id)

    # 查询运行中的服务数
    return {
        "tenant_id": tenant.tenant_id,
        "storage": {
            "used_bytes": storage_bytes,
            "used_gb": round(storage_bytes / (1024**3), 2),
            "quota_gb": tenant.storage_quota_gb,
            "usage_percent": round(storage_bytes / (tenant.storage_quota_gb * 1024**3) * 100, 1),
        },
        "gpu_config": {
            "gpu_memory_util_limit": tenant.gpu_memory_util,
            "max_model_len": tenant.max_model_len,
            "assigned_gpu_ids": tenant.gpu_device_ids,
        },
        "qps_limit": tenant.qps_limit,
    }


async def get_gpu_resource_overview() -> dict:
    """获取整机 GPU 资源概况"""
    gpu_info = get_gpu_info()

    overview = {
        "total_gpus": len(gpu_info),
        "gpus": [],
        "reserved_mb": settings.GPU_MEMORY_RESERVE_MB,
    }

    for gpu_id, info in gpu_info.items():
        available = info["free_mb"] - settings.GPU_MEMORY_RESERVE_MB
        overview["gpus"].append({
            "gpu_id": gpu_id,
            "name": info["name"],
            "total_mb": info["total_mb"],
            "used_mb": info["used_mb"],
            "free_mb": info["free_mb"],
            "available_mb": max(available, 0),
            "usage_percent": round(info["used_mb"] / info["total_mb"] * 100, 1),
        })

    return overview


async def check_idle_services(db: AsyncSession) -> list[DeployedService]:
    """
    检查闲置服务
    超过 IDLE_TIMEOUT_MINUTES 未活跃的服务将被标记为休眠候选
    """
    threshold = datetime.now(timezone.utc) - timedelta(
        minutes=settings.IDLE_TIMEOUT_MINUTES
    )

    result = await db.execute(
        select(DeployedService).where(
            DeployedService.status == ServiceStatus.RUNNING,
            DeployedService.last_active_at < threshold,
        )
    )
    idle_services = result.scalars().all()

    if idle_services:
        logger.info(
            f"发现 {len(idle_services)} 个闲置服务（超过 "
            f"{settings.IDLE_TIMEOUT_MINUTES} 分钟未活跃）"
        )

    return idle_services


async def sleep_idle_services(db: AsyncSession):
    """
    将闲置服务休眠（停止容器，保留配置）
    可由定时任务调用
    """
    idle_services = await check_idle_services(db)

    for service in idle_services:
        try:
            logger.info(
                f"自动休眠闲置服务 | service={service.service_name} "
                f"last_active={service.last_active_at}"
            )
            await stop_service(service)
            service.status = ServiceStatus.SLEEPING
            await db.flush()
        except Exception as e:
            logger.error(
                f"休眠服务失败 | service={service.service_name} error={e}"
            )


async def update_service_activity(db: AsyncSession, service_id: int):
    """更新服务活跃时间（每次推理调用时触发）"""
    await db.execute(
        update(DeployedService)
        .where(DeployedService.id == service_id)
        .values(last_active_at=datetime.now(timezone.utc))
    )
    await db.flush()


async def check_tenant_can_deploy(
    db: AsyncSession,
    tenant: Tenant,
) -> bool:
    """
    检查租户是否可以部署新服务
    - 存储配额检查
    - 运行中服务数限制
    """
    # 检查存储配额
    from app.services.upload_service import check_storage_quota
    if not await check_storage_quota(tenant):
        raise ValueError("存储空间已满，无法部署新服务")

    # 检查运行中服务数（单租户最多 5 个并发服务）
    result = await db.execute(
        select(DeployedService).where(
            DeployedService.tenant_id == tenant.id,
            DeployedService.status.in_([
                ServiceStatus.RUNNING,
                ServiceStatus.DEPLOYING,
                ServiceStatus.PENDING,
            ]),
        )
    )
    active_count = len(result.scalars().all())

    if active_count >= 5:
        raise ValueError(
            f"已达到最大并发服务数限制（5），当前运行中: {active_count}"
        )

    return True

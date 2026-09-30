"""
推理代理服务
将租户的推理请求代理到对应的 vLLM 容器
统一 API 网关的核心组件
支持普通请求和流式请求（SSE）代理
"""

import asyncio
import json
import time
from typing import Optional, AsyncIterator

import httpx
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.models import DeployedService, ServiceStatus, Tenant
from app.services.docker_service import get_container_status, start_service
from app.services.resource_service import update_service_activity


class ServiceNotReadyError(ValueError):
    """服务存在但尚未就绪（休眠唤醒中/模型加载中/唤醒失败/已停止）"""


# 并发唤醒保护：同一服务同时只触发一次拉起，其余请求排队等待
_wake_locks: dict[int, asyncio.Lock] = {}
WAKE_TIMEOUT_SECONDS = 600   # 唤醒/等就绪上限（大模型加载可能需数分钟）
WAKE_POLL_INTERVAL = 2       # 健康检查轮询间隔（秒）


async def _wait_until_healthy(service: DeployedService) -> None:
    """轮询容器 /health 直到就绪；容器异常退出则快速失败"""
    deadline = time.monotonic() + WAKE_TIMEOUT_SECONDS
    async with httpx.AsyncClient(timeout=3) as client:
        while time.monotonic() < deadline:
            try:
                resp = await client.get(
                    f"http://127.0.0.1:{service.service_port}/health"
                )
                if resp.status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            info = await get_container_status(service)
            if info.get("exists") and info.get("status") == "exited":
                raise ServiceNotReadyError(
                    f"服务 {service.service_name} 唤醒失败：容器异常退出，请查看服务日志"
                )
            await asyncio.sleep(WAKE_POLL_INTERVAL)
    raise ServiceNotReadyError(
        f"服务 {service.service_name} 等待就绪超时（{WAKE_TIMEOUT_SECONDS}秒），请稍后重试"
    )


async def ensure_service_ready(db: AsyncSession, service: DeployedService) -> None:
    """
    唤醒透传：请求到达时保证服务可推理
    - SLEEPING：自动拉起容器并等待模型加载完成（对客户端透明）
    - RUNNING：模型尚未加载完（/health 未就绪）时挂起等待
    - STOPPED：用户主动停止，不自动拉起
    - ERROR：异常状态，拒绝
    """
    if service.status == ServiceStatus.ERROR:
        raise ServiceNotReadyError(
            f"服务 {service.service_name} 处于异常状态，请查看服务日志"
        )
    if service.status == ServiceStatus.STOPPED:
        raise ServiceNotReadyError(
            f"服务 {service.service_name} 已停止，请先启动服务"
        )

    lock = _wake_locks.setdefault(service.id, asyncio.Lock())
    async with lock:
        # 双检：持锁排队期间可能已被其他请求唤醒
        row = await db.execute(
            select(DeployedService.status).where(DeployedService.id == service.id)
        )
        current = row.scalar_one_or_none()
        if current == ServiceStatus.SLEEPING:
            logger.info(f"推理请求触发自动唤醒 | service={service.service_name}")
            await start_service(service)
            service.status = ServiceStatus.RUNNING
            await db.commit()
        elif current != ServiceStatus.RUNNING:
            raise ServiceNotReadyError(
                f"服务 {service.service_name} 当前状态为 "
                f"{current.value if current else '未知'}，无法推理"
            )
        await _wait_until_healthy(service)


async def find_service_for_inference(
    db: AsyncSession,
    tenant: Tenant,
    service_name: Optional[str] = None,
) -> DeployedService:
    """
    查找可用于推理的服务
    如果指定 service_name 则查找特定服务，否则查找第一个运行中的服务
    """
    if service_name:
        result = await db.execute(
            select(DeployedService)
            .options(selectinload(DeployedService.model))
            .where(
                DeployedService.tenant_id == tenant.id,
                DeployedService.service_name == service_name,
            )
        )
    else:
        result = await db.execute(
            select(DeployedService)
            .options(selectinload(DeployedService.model))
            .where(
                DeployedService.tenant_id == tenant.id,
                DeployedService.status == ServiceStatus.RUNNING,
            ).limit(1)
        )

    service = result.scalar_one_or_none()

    if service is None:
        raise ValueError(
            f"未找到可用的推理服务"
            + (f": {service_name}" if service_name else "")
        )

    # 唤醒透传：休眠自动拉起并等待就绪；STOPPED/ERROR 拒绝（见 ensure_service_ready）
    await ensure_service_ready(db, service)

    return service


def _fix_model_in_body(
    body: bytes, actual_model_name: str
) -> tuple[bytes, bool]:
    """解析并修正请求体中的 model 字段
    Returns: (forward_body, was_modified)
    """
    if not actual_model_name or not body:
        return body, False
    try:
        body_json = json.loads(body)
        if "model" in body_json:
            original_model = body_json["model"]
            if original_model != actual_model_name:
                body_json["model"] = actual_model_name
                logger.debug(
                    f"修正模型名 | {original_model} -> {actual_model_name}"
                )
                return json.dumps(body_json).encode("utf-8"), True
    except (json.JSONDecodeError, UnicodeDecodeError):
        pass
    return body, False


def _is_streaming_request(body: bytes) -> bool:
    """检测请求是否为流式请求"""
    if not body:
        return False
    try:
        body_json = json.loads(body)
        return body_json.get("stream", False) is True
    except (json.JSONDecodeError, UnicodeDecodeError):
        return False


async def proxy_inference_request(
    db: AsyncSession,
    tenant: Tenant,
    service: DeployedService,
    path: str,
    method: str,
    body: bytes,
    headers: dict,
) -> httpx.Response:
    """
    代理推理请求到 vLLM 容器（非流式）
    自动修正请求中的 model 字段为实际部署的模型名
    """
    if not service.service_port:
        raise ValueError("服务端口未配置")

    actual_model_name = service.model.model_name if service.model else None
    vllm_url = f"http://127.0.0.1:{service.service_port}{path}"

    await update_service_activity(db, service.id)

    # 修正模型名
    forward_body, _ = _fix_model_in_body(body, actual_model_name)

    logger.debug(
        f"代理推理请求 | tenant={tenant.tenant_id} "
        f"service={service.service_name} -> {vllm_url}"
    )

    # 过滤并转发 headers
    forward_headers = {}
    for k, v in headers.items():
        if k.lower() not in ("host", "content-length", "authorization"):
            forward_headers[k] = v
    forward_headers["Content-Type"] = "application/json"

    async with httpx.AsyncClient(timeout=300) as client:
        response = await client.request(
            method=method,
            url=vllm_url,
            content=forward_body,
            headers=forward_headers,
        )

    logger.info(
        f"推理请求完成 | tenant={tenant.tenant_id} "
        f"service={service.service_name} status={response.status_code}"
    )

    return response


async def proxy_inference_streaming(
    db: AsyncSession,
    tenant: Tenant,
    service: DeployedService,
    path: str,
    method: str,
    body: bytes,
    headers: dict,
) -> StreamingResponse:
    """
    代理流式推理请求（SSE）
    自动修正 model 字段，透传 SSE 流
    """
    if not service.service_port:
        raise ValueError("服务端口未配置")

    actual_model_name = service.model.model_name if service.model else None
    vllm_url = f"http://127.0.0.1:{service.service_port}{path}"

    await update_service_activity(db, service.id)

    # 修正模型名
    forward_body, _ = _fix_model_in_body(body, actual_model_name)

    logger.debug(
        f"代理流式推理请求 | tenant={tenant.tenant_id} "
        f"service={service.service_name} -> {vllm_url}"
    )

    # 过滤并转发 headers
    forward_headers = {}
    for k, v in headers.items():
        if k.lower() not in ("host", "content-length", "authorization"):
            forward_headers[k] = v
    forward_headers["Content-Type"] = "application/json"

    def _sse_error(message: str) -> bytes:
        """构造 SSE 错误事件：同时带 error 字段和 delta 内容，前端对话区可直接展示"""
        payload = {
            "error": {"message": message, "type": "upstream_error"},
            "choices": [{
                "index": 0,
                "delta": {"content": f"\n\n[错误] {message}"},
                "finish_reason": None,
            }],
        }
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")

    async def stream_generator() -> AsyncIterator[bytes]:
        """流式转发生成器（上游异常时优雅终止 SSE，避免浏览器断流报错）"""
        async with httpx.AsyncClient(timeout=300) as client:
            try:
                async with client.stream(
                    method=method,
                    url=vllm_url,
                    content=forward_body,
                    headers=forward_headers,
                ) as upstream:
                    if upstream.status_code >= 400:
                        detail = (await upstream.aread()).decode("utf-8", errors="replace")[:500]
                        logger.warning(
                            f"流式推理上游返回 {upstream.status_code} | tenant={tenant.tenant_id} "
                            f"service={service.service_name} -> {vllm_url} | {detail[:200]}"
                        )
                        yield _sse_error(f"推理服务返回 {upstream.status_code}，请稍后重试")
                        return
                    # 转发 SSE 数据流
                    async for chunk in upstream.aiter_bytes():
                        yield chunk
            except httpx.HTTPError as e:
                logger.error(
                    f"流式推理上游异常 | tenant={tenant.tenant_id} "
                    f"service={service.service_name} -> {vllm_url} | {type(e).__name__}: {e}"
                )
                if isinstance(e, httpx.ConnectError):
                    message = "推理服务尚未就绪（模型可能正在加载中），请稍后重试"
                else:
                    message = "推理服务连接中断，请稍后重试"
                yield _sse_error(message)
                return

        logger.info(
            f"流式推理完成 | tenant={tenant.tenant_id} "
            f"service={service.service_name}"
        )

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用 Nginx 缓冲
        },
    )


async def proxy_inference(
    db: AsyncSession,
    tenant: Tenant,
    service: DeployedService,
    path: str,
    method: str,
    body: bytes,
    headers: dict,
) -> httpx.Response | StreamingResponse:
    """
    智能代理入口：自动检测是否为流式请求并路由
    """
    if method in ("POST", "PUT") and _is_streaming_request(body):
        return await proxy_inference_streaming(
            db, tenant, service, path, method, body, headers
        )
    return await proxy_inference_request(
        db, tenant, service, path, method, body, headers
    )
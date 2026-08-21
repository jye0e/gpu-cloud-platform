"""
推理代理服务
将租户的推理请求代理到对应的 vLLM 容器
统一 API 网关的核心组件
支持普通请求和流式请求（SSE）代理
"""

import json
from typing import Optional, AsyncIterator

import httpx
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.models import DeployedService, ServiceStatus, Tenant
from app.services.resource_service import update_service_activity


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

    if service.status == ServiceStatus.SLEEPING:
        raise ValueError(
            f"服务 {service.service_name} 处于休眠状态，请先唤醒服务"
        )

    if service.status != ServiceStatus.RUNNING:
        raise ValueError(
            f"服务 {service.service_name} 当前状态为 {service.status.value}，无法推理"
        )

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

    async def stream_generator() -> AsyncIterator[bytes]:
        """流式转发生成器"""
        async with httpx.AsyncClient(timeout=300) as client:
            async with client.stream(
                method=method,
                url=vllm_url,
                content=forward_body,
                headers=forward_headers,
            ) as upstream:
                # 转发 SSE 数据流
                async for chunk in upstream.aiter_bytes():
                    yield chunk

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
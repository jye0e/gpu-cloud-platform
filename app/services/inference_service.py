"""
推理代理服务
将租户的推理请求代理到对应的 vLLM 容器
统一 API 网关的核心组件
"""

import httpx
from typing import Optional

from sqlalchemy import select
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
            select(DeployedService).where(
                DeployedService.tenant_id == tenant.id,
                DeployedService.service_name == service_name,
            )
        )
    else:
        result = await db.execute(
            select(DeployedService).where(
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
    代理推理请求到 vLLM 容器
    支持 OpenAI 兼容接口（/v1/chat/completions, /v1/completions 等）
    """
    if not service.service_port:
        raise ValueError("服务端口未配置")

    # 构建 vLLM 目标 URL
    vllm_url = f"http://127.0.0.1:{service.service_port}{path}"

    # 更新活跃时间
    await update_service_activity(db, service.id)

    logger.debug(
        f"代理推理请求 | tenant={tenant.tenant_id} "
        f"service={service.service_name} -> {vllm_url}"
    )

    # 转发请求
    async with httpx.AsyncClient(timeout=300) as client:
        # 过滤掉不需要的头部
        forward_headers = {}
        for k, v in headers.items():
            if k.lower() not in ("host", "content-length", "authorization"):
                forward_headers[k] = v

        # 添加 vLLM 不需要鉴权的标记
        forward_headers["Content-Type"] = "application/json"

        response = await client.request(
            method=method,
            url=vllm_url,
            content=body,
            headers=forward_headers,
        )

    logger.info(
        f"推理请求完成 | tenant={tenant.tenant_id} "
        f"service={service.service_name} status={response.status_code}"
    )

    return response

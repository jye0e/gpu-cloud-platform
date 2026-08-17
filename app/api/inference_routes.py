"""
推理代理路由
将租户的推理请求路由到对应的 vLLM 容器
支持标准 OpenAI 兼容接口

路由模式:
  POST /api/tenant/inference/{service_name}/v1/chat/completions
  POST /api/tenant/inference/{service_name}/v1/completions
  GET  /api/tenant/inference/{service_name}/v1/models
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_tenant
from app.core.logging import logger, log_audit
from app.database import get_db
from app.models import Tenant
from app.services.inference_service import (
    find_service_for_inference,
    proxy_inference_request,
)

router = APIRouter(prefix="/api/tenant/inference", tags=["租户-推理调用"])


@router.api_route(
    "/{service_name}/v1/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE"],
    summary="推理服务代理",
    description="""
    标准 OpenAI 兼容接口代理。

    使用方式与 OpenAI / 火山引擎 / 阿里云完全一致：
    - POST /v1/chat/completions   对话补全
    - POST /v1/completions        文本补全
    - GET  /v1/models             模型列表

    鉴权：使用租户 API Key (Bearer Token)
    """,
)
async def inference_proxy(
    request: Request,
    service_name: str,
    path: str,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    # 1. 查找服务
    try:
        service = await find_service_for_inference(
            db=db, tenant=tenant, service_name=service_name
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # 2. 读取请求体
    body = await request.body()

    # 3. 代理请求
    try:
        response = await proxy_inference_request(
            db=db,
            tenant=tenant,
            service=service,
            path=f"/v1/{path}",
            method=request.method,
            body=body,
            headers=dict(request.headers),
        )
    except Exception as e:
        logger.error(f"推理代理失败: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"推理服务不可用: {str(e)}")

    # 4. 记录审计日志
    await log_audit(
        db, tenant.id, "inference_call",
        resource=service.service_name,
        detail={
            "path": f"/v1/{path}",
            "method": request.method,
            "status_code": response.status_code,
        },
        status_code=response.status_code,
    )

    # 5. 返回响应
    return Response(
        content=response.content,
        status_code=response.status_code,
        headers=dict(response.headers),
        media_type=response.headers.get("content-type"),
    )

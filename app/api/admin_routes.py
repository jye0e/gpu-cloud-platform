"""
管理端路由
- 创建租户
- 查看租户列表
- 查看整机资源
- 管理租户状态

注意：管理端接口使用独立的 admin token 鉴权，与租户 token 隔离
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import (
    generate_tenant_id,
    generate_api_key,
    hash_token,
    generate_access_token,
)
from app.core.logging import logger, log_audit
from app.database import get_db
from app.models import Tenant, TenantStatus
from app.api.schemas import (
    CreateTenantRequest,
    CreateTenantResponse,
    TenantInfoResponse,
    UpdateTenantQuotaRequest,
)
from app.services.resource_service import get_gpu_resource_overview

router = APIRouter(prefix="/admin", tags=["管理端"])

# 管理端 Token（生产环境务必通过环境变量设置）
ADMIN_TOKEN = "admin-secret-token-change-in-production"


async def verify_admin_token(
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token"),
):
    """验证管理端 Token"""
    if not x_admin_token or x_admin_token != ADMIN_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="管理端 Token 无效",
        )
    return True


@router.post(
    "/tenants",
    response_model=CreateTenantResponse,
    summary="创建租户",
    description="创建新租户，分配专属 Token、API Key 和资源配额",
)
async def create_tenant(
    req: CreateTenantRequest,
    _auth: bool = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db),
):
    # 生成租户凭证
    tenant_id = generate_tenant_id()
    api_key = generate_api_key()
    access_token = generate_access_token(tenant_id, api_key)

    # 创建租户记录（Token 存哈希）
    tenant = Tenant(
        tenant_id=tenant_id,
        name=req.name,
        token_hash=hash_token(access_token),
        api_key=api_key,
        status=TenantStatus.ACTIVE,
        gpu_memory_util=req.gpu_memory_util,
        max_model_len=req.max_model_len,
        storage_quota_gb=req.storage_quota_gb,
        qps_limit=req.qps_limit,
        gpu_device_ids=req.gpu_device_ids,
    )
    db.add(tenant)
    await db.flush()

    logger.info(f"创建租户 | tenant_id={tenant_id} name={req.name}")

    return CreateTenantResponse(
        tenant_id=tenant_id,
        name=req.name,
        api_key=api_key,
        access_token=access_token,
        status=TenantStatus.ACTIVE.value,
    )


@router.get(
    "/tenants",
    response_model=list[TenantInfoResponse],
    summary="查看所有租户",
)
async def list_tenants(
    _auth: bool = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Tenant).order_by(Tenant.created_at.desc()))
    tenants = result.scalars().all()

    return [
        TenantInfoResponse(
            tenant_id=t.tenant_id,
            name=t.name,
            api_key=t.api_key,
            status=t.status.value if hasattr(t.status, 'value') else str(t.status),
            gpu_memory_util=t.gpu_memory_util,
            max_model_len=t.max_model_len,
            storage_quota_gb=t.storage_quota_gb,
            qps_limit=t.qps_limit,
            gpu_device_ids=t.gpu_device_ids,
            created_at=t.created_at.isoformat(),
        )
        for t in tenants
    ]


@router.get(
    "/tenants/{tenant_id}",
    response_model=TenantInfoResponse,
    summary="查看租户详情",
)
async def get_tenant(
    tenant_id: str,
    _auth: bool = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Tenant).where(Tenant.tenant_id == tenant_id)
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="租户不存在")

    return TenantInfoResponse(
        tenant_id=tenant.tenant_id,
        name=tenant.name,
        status=tenant.status.value if hasattr(tenant.status, 'value') else str(tenant.status),
        gpu_memory_util=tenant.gpu_memory_util,
        max_model_len=tenant.max_model_len,
        storage_quota_gb=tenant.storage_quota_gb,
        qps_limit=tenant.qps_limit,
        gpu_device_ids=tenant.gpu_device_ids,
        created_at=tenant.created_at.isoformat(),
    )


@router.patch(
    "/tenants/{tenant_id}/status",
    summary="修改租户状态",
)
async def update_tenant_status(
    tenant_id: str,
    new_status: str,
    _auth: bool = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Tenant).where(Tenant.tenant_id == tenant_id)
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="租户不存在")

    try:
        tenant.status = TenantStatus(new_status)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"无效状态: {new_status}，可选: active/suspended/deleted",
        )

    await db.flush()
    logger.info(f"租户状态更新 | tenant_id={tenant_id} status={new_status}")

    return {"message": f"租户状态已更新为 {new_status}"}


@router.patch(
    "/tenants/{tenant_id}/quota",
    summary="更新租户资源配额",
    description="更新租户的GPU显存利用率、存储配额、QPS限制等资源配置",
)
async def update_tenant_quota(
    tenant_id: str,
    req: UpdateTenantQuotaRequest,
    _auth: bool = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Tenant).where(Tenant.tenant_id == tenant_id)
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="租户不存在")

    # 只更新传入的字段
    if req.gpu_memory_util is not None:
        tenant.gpu_memory_util = req.gpu_memory_util
    if req.max_model_len is not None:
        tenant.max_model_len = req.max_model_len
    if req.storage_quota_gb is not None:
        tenant.storage_quota_gb = req.storage_quota_gb
    if req.qps_limit is not None:
        tenant.qps_limit = req.qps_limit
    if req.gpu_device_ids is not None:
        tenant.gpu_device_ids = req.gpu_device_ids if req.gpu_device_ids else None

    await db.flush()
    logger.info(f"租户资源配额更新 | tenant_id={tenant_id}")

    return {"message": "租户资源配额已更新"}


@router.get(
    "/gpu/overview",
    summary="查看整机 GPU 资源",
    description="查看所有 GPU 的显存使用情况",
)
async def get_gpu_overview(
    _auth: bool = Depends(verify_admin_token),
):
    return await get_gpu_resource_overview()

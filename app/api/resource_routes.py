"""
租户端路由 - 资源查询
- GET /api/tenant/resource_overview  查看租户资源使用概况
"""

from fastapi import APIRouter, Depends

from app.core.auth import get_current_tenant
from app.models import Tenant
from app.services.resource_service import get_tenant_resource_usage

router = APIRouter(prefix="/api/tenant", tags=["租户-资源管理"])


@router.get(
    "/resource_overview",
    summary="查看租户资源概况",
    description="查看当前租户的存储使用量、GPU 配置、QPS 限制等资源信息。",
)
async def resource_overview(
    tenant: Tenant = Depends(get_current_tenant),
):
    return await get_tenant_resource_usage(tenant)

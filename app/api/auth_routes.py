"""
租户登录路由
- POST /api/auth/login  用 API Key 换取 JWT Token
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Tenant, TenantStatus
from app.core.auth import generate_access_token

router = APIRouter(prefix="/api/auth", tags=["认证"])


class LoginRequest(BaseModel):
    api_key: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    tenant_id: str
    tenant_name: str


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="租户登录",
    description="租户用 API Key 登录，获取 JWT Access Token",
)
async def login(
    req: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Tenant).where(Tenant.api_key == req.api_key)
    )
    tenant = result.scalar_one_or_none()

    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API Key 无效",
        )

    if tenant.status != TenantStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"租户账户状态异常: {tenant.status.value}，请联系管理员",
        )

    access_token = generate_access_token(tenant.tenant_id, tenant.api_key)

    return LoginResponse(
        access_token=access_token,
        tenant_id=tenant.tenant_id,
        tenant_name=tenant.name,
    )
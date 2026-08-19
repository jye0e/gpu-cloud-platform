"""
租户鉴权模块
- Token 生成与验证
- 请求级租户身份解析
- 权限隔离中间件
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import Tenant, TenantStatus

# Bearer Token 提取器
bearer_scheme = HTTPBearer(auto_error=False)


def generate_tenant_id() -> str:
    """生成租户唯一ID"""
    return f"tnt_{uuid.uuid4().hex[:16]}"


def generate_api_key() -> str:
    """生成租户 API 密钥"""
    return f"sk_{''.join(secrets.token_hex(16))}"


def hash_token(token: str) -> str:
    """Token 哈希存储（不存明文）"""
    return hashlib.sha256(token.encode()).hexdigest()


def generate_access_token(tenant_id: str, api_key: str) -> str:
    """
    生成 JWT 访问令牌
    租户用此 Token 进行所有 API 调用
    """
    payload = {
        "tenant_id": tenant_id,
        "api_key": api_key,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def verify_access_token(token: str) -> Optional[dict]:
    """验证 JWT 并返回 payload"""
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


async def get_current_tenant(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Tenant:
    """
    核心依赖：从请求中解析租户身份
    支持两种认证方式：
    1. API Key 直接认证（推荐）：Bearer sk_xxxx
    2. JWT Token 认证（兼容）：Bearer eyJxxxx
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少认证凭证，请在 Authorization 头中提供 Bearer Token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    # 方式一：API Key 直接认证（以 sk_ 开头）
    if token.startswith("sk_"):
        result = await db.execute(
            select(Tenant).where(Tenant.api_key == token)
        )
        tenant = result.scalar_one_or_none()

        if tenant is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="API Key 无效",
                headers={"WWW-Authenticate": "Bearer"},
            )

        if tenant.status != TenantStatus.ACTIVE:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"租户账户状态异常: {tenant.status.value}，请联系管理员",
            )

        return tenant

    # 方式二：JWT Token 认证（兼容旧方式）
    payload = verify_access_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 无效或已过期",
            headers={"WWW-Authenticate": "Bearer"},
        )

    tenant_id = payload.get("tenant_id")
    api_key = payload.get("api_key")

    if not tenant_id or not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 内容不完整",
        )

    # 查询租户
    result = await db.execute(
        select(Tenant).where(
            Tenant.tenant_id == tenant_id,
            Tenant.api_key == api_key,
        )
    )
    tenant = result.scalar_one_or_none()

    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="租户不存在或 API Key 不匹配",
        )

    if tenant.status != TenantStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"租户账户状态异常: {tenant.status.value}，请联系管理员",
        )

    return tenant


class TenantContext:
    """
    租户上下文工具类
    提供租户级别的路径隔离、配额检查等工具方法
    """

    @staticmethod
    def get_tenant_storage_path(tenant_id: str) -> "Path":
        """获取租户专属存储目录"""
        from pathlib import Path
        path = settings.storage_path / tenant_id / "models"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @staticmethod
    def get_tenant_container_prefix(tenant_id: str) -> str:
        """获取租户容器命名前缀"""
        return f"tnt_{tenant_id}"

    @staticmethod
    def get_tenant_network_name(tenant_id: str) -> str:
        """获取租户专属 Docker 网络名"""
        return f"net_{tenant_id}"

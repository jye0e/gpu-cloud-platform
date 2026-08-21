"""
数据库连接管理
异步 SQLAlchemy 引擎 + Session 工厂
"""

import secrets
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings
from app.models import Base, Tenant, TenantStatus


def _ensure_db_dir():
    """确保 SQLite 数据库文件所在目录存在"""
    if "sqlite" in settings.DATABASE_URL:
        # 从 URL 提取路径: sqlite+aiosqlite:///./data/gpu_cloud.db
        db_path = settings.DATABASE_URL.split("///")[-1]
        db_dir = Path(db_path).parent
        db_dir.mkdir(parents=True, exist_ok=True)


# 确保目录存在
_ensure_db_dir()

# 创建异步引擎
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.APP_DEBUG,
    pool_pre_ping=True,
)

# Session 工厂
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def _seed_default_tenant():
    """初始化默认租户（如果数据库为空）"""
    async with async_session_factory() as session:
        result = await session.execute(select(Tenant).limit(1))
        existing = result.scalar_one_or_none()

        if existing is not None:
            return  # 已有租户，不重复初始化

        # 创建默认租户
        tenant = Tenant(
            tenant_id=f"tnt_{uuid.uuid4().hex[:16]}",
            name="默认租户",
            token_hash="",
            api_key="sk_1683601c8ac505c56c7542df3443683d",
            status=TenantStatus.ACTIVE,
            gpu_memory_util=0.4,
            max_model_len=4096,
            storage_quota_gb=50,
            qps_limit=10,
        )
        session.add(tenant)
        await session.commit()


async def init_db():
    """初始化数据库（创建所有表 + 种子数据）"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # 种子数据
    await _seed_default_tenant()


async def get_db() -> AsyncSession:
    """获取数据库 Session（依赖注入用）"""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

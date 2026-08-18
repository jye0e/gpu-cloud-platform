"""
数据库连接管理
异步 SQLAlchemy 引擎 + Session 工厂
"""

from pathlib import Path

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings
from app.models import Base


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


async def init_db():
    """初始化数据库（创建所有表）"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


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

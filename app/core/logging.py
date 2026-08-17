"""
日志模块
基于 loguru，支持文件轮转、结构化日志
"""

import sys
from loguru import logger

from app.config import settings


def setup_logging():
    """初始化日志配置"""
    logger.remove()

    # 控制台输出
    logger.add(
        sys.stdout,
        level=settings.LOG_LEVEL,
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
            "<level>{message}</level>"
        ),
        colorize=True,
    )

    # 文件输出（轮转）
    logger.add(
        settings.log_path / "app_{time:YYYY-MM-DD}.log",
        level=settings.LOG_LEVEL,
        format=(
            "{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | "
            "{name}:{function}:{line} | {message}"
        ),
        rotation="00:00",       # 每天轮转
        retention="30 days",    # 保留30天
        compression="zip",      # 压缩旧日志
        encoding="utf-8",
    )

    # 错误日志单独文件
    logger.add(
        settings.log_path / "error_{time:YYYY-MM-DD}.log",
        level="ERROR",
        format=(
            "{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | "
            "{name}:{function}:{line} | {message}"
        ),
        rotation="00:00",
        retention="90 days",
        compression="zip",
        encoding="utf-8",
    )

    logger.info("日志系统初始化完成")


async def log_audit(
    db,
    tenant_id: int,
    action: str,
    resource: str = None,
    detail: dict = None,
    ip_address: str = None,
    status_code: int = None,
):
    """记录审计日志"""
    from app.models import AuditLog
    log_entry = AuditLog(
        tenant_id=tenant_id,
        action=action,
        resource=resource,
        detail=detail or {},
        ip_address=ip_address,
        status_code=status_code,
    )
    db.add(log_entry)
    await db.flush()
    logger.info(
        f"审计日志 | tenant_id={tenant_id} action={action} "
        f"resource={resource} ip={ip_address} status={status_code}"
    )

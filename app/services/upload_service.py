"""
模型上传服务
- 分片上传
- 断点续传
- 文件格式校验
- 存储隔离
"""

import os
import uuid
import shutil
import hashlib
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import TenantContext
from app.core.logging import logger
from app.models import Tenant, TenantModel, UploadTask, UploadStatus


# 分片大小常量（默认 10MB）
DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024


def _get_tenant_storage(tenant_id: str) -> Path:
    """获取租户存储目录（确保隔离）"""
    path = Path(settings.STORAGE_ROOT) / tenant_id / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _get_tenant_temp(tenant_id: str) -> Path:
    """获取租户临时分片目录"""
    path = Path(settings.STORAGE_ROOT) / tenant_id / "temp"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _validate_file_extension(filename: str) -> bool:
    """校验文件扩展名是否合规"""
    ext = Path(filename).suffix.lower()
    return ext in settings.ALLOWED_MODEL_EXTENSIONS


def _get_file_format(filename: str) -> str:
    """根据扩展名获取模型格式标识"""
    ext = Path(filename).suffix.lower().lstrip(".")
    return ext


async def get_tenant_storage_usage(tenant_id: str) -> int:
    """获取租户当前存储使用量（字节）"""
    storage_path = _get_tenant_storage(tenant_id)
    total = 0
    if storage_path.exists():
        for f in storage_path.rglob("*"):
            if f.is_file():
                total += f.stat().st_size
    return total


async def check_storage_quota(tenant: Tenant) -> bool:
    """检查租户是否超出存储配额"""
    usage = await get_tenant_storage_usage(tenant.tenant_id)
    quota_bytes = tenant.storage_quota_gb * 1024 * 1024 * 1024
    return usage < quota_bytes


async def create_upload_task(
    db: AsyncSession,
    tenant: Tenant,
    model_name: str,
    total_size: int,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
) -> UploadTask:
    """
    创建分片上传任务
    租户发起上传前先调用此接口，获取 task_id 和分片方案
    """
    # 校验文件格式
    if not _validate_file_extension(model_name):
        raise ValueError(
            f"不支持的模型文件格式。允许的格式: {', '.join(settings.ALLOWED_MODEL_EXTENSIONS)}"
        )

    # 检查存储配额
    usage = await get_tenant_storage_usage(tenant.tenant_id)
    quota_bytes = tenant.storage_quota_gb * 1024 * 1024 * 1024
    if usage + total_size > quota_bytes:
        raise ValueError(
            f"存储空间不足。当前已用: {usage // (1024**3):.1f}GB, "
            f"配额: {tenant.storage_quota_gb}GB, "
            f"本次需要: {total_size // (1024**3):.1f}GB"
        )

    # 计算分片数
    total_chunks = (total_size + chunk_size - 1) // chunk_size

    # 生成任务ID
    task_id = f"upload_{uuid.uuid4().hex[:16]}"

    # 创建临时目录
    temp_dir = _get_tenant_temp(tenant.tenant_id) / task_id
    temp_dir.mkdir(parents=True, exist_ok=True)

    # 持久化任务记录
    task = UploadTask(
        tenant_id=tenant.id,
        task_id=task_id,
        model_name=model_name,
        total_chunks=total_chunks,
        uploaded_chunks=0,
        chunk_size=chunk_size,
        total_size=total_size,
        status=UploadStatus.UPLOADING,
        temp_dir=str(temp_dir),
    )
    db.add(task)
    await db.flush()

    logger.info(
        f"创建上传任务 | tenant={tenant.tenant_id} task={task_id} "
        f"model={model_name} chunks={total_chunks} size={total_size}"
    )

    return task


async def upload_chunk(
    db: AsyncSession,
    tenant: Tenant,
    task_id: str,
    chunk_index: int,
    chunk_data: bytes,
) -> UploadTask:
    """
    上传单个分片
    支持断点续传：已上传的分片会被跳过
    """
    # 查询任务
    result = await db.execute(
        select(UploadTask).where(
            UploadTask.task_id == task_id,
            UploadTask.tenant_id == tenant.id,
        )
    )
    task = result.scalar_one_or_none()

    if task is None:
        raise ValueError(f"上传任务不存在: {task_id}")

    if task.status == UploadStatus.COMPLETED:
        raise ValueError("上传任务已完成")

    if task.status == UploadStatus.FAILED:
        raise ValueError("上传任务已失败，请重新创建")

    if chunk_index < 0 or chunk_index >= task.total_chunks:
        raise ValueError(f"分片索引无效: {chunk_index}, 总分片数: {task.total_chunks}")

    # 检查分片是否已存在（断点续传）
    chunk_file = Path(task.temp_dir) / f"chunk_{chunk_index:06d}"
    if chunk_file.exists():
        logger.debug(f"分片已存在，跳过 | task={task_id} chunk={chunk_index}")
        return task

    # 写入分片
    async with open(chunk_file, "wb") as f:
        await f.write(chunk_data)

    # 更新进度
    task.uploaded_chunks += 1
    await db.flush()

    logger.debug(
        f"分片上传完成 | task={task_id} chunk={chunk_index}/{task.total_chunks - 1}"
    )

    return task


async def complete_upload(
    db: AsyncSession,
    tenant: Tenant,
    task_id: str,
) -> TenantModel:
    """
    完成上传：合并所有分片，校验完整性，移动到最终存储位置
    """
    result = await db.execute(
        select(UploadTask).where(
            UploadTask.task_id == task_id,
            UploadTask.tenant_id == tenant.id,
        )
    )
    task = result.scalar_one_or_none()

    if task is None:
        raise ValueError(f"上传任务不存在: {task_id}")

    if task.uploaded_chunks < task.total_chunks:
        raise ValueError(
            f"分片未上传完整: 已上传 {task.uploaded_chunks}/{task.total_chunks}"
        )

    # 合并分片
    storage_path = _get_tenant_storage(tenant.tenant_id)
    final_file = storage_path / task.model_name
    final_file.parent.mkdir(parents=True, exist_ok=True)

    logger.info(f"开始合并分片 | task={task_id} -> {final_file}")

    sha256_hash = hashlib.sha256()
    total_written = 0

    with open(final_file, "wb") as out_f:
        for i in range(task.total_chunks):
            chunk_file = Path(task.temp_dir) / f"chunk_{i:06d}"
            if not chunk_file.exists():
                raise ValueError(f"分片文件缺失: chunk_{i:06d}")

            with open(chunk_file, "rb") as in_f:
                while True:
                    data = in_f.read(1024 * 1024)  # 1MB 读写缓冲
                    if not data:
                        break
                    out_f.write(data)
                    sha256_hash.update(data)
                    total_written += len(data)

    # 校验文件大小
    if total_written != task.total_size:
        logger.error(
            f"文件大小校验失败 | expected={task.total_size} actual={total_written}"
        )
        # 删除不完整文件
        final_file.unlink(missing_ok=True)
        task.status = UploadStatus.FAILED
        await db.flush()
        raise ValueError(
            f"文件大小校验失败: 预期 {task.total_size}, 实际 {total_written}"
        )

    # 清理临时分片
    shutil.rmtree(task.temp_dir, ignore_errors=True)

    # 计算文件 SHA256
    file_sha256 = sha256_hash.hexdigest()

    # 创建模型记录
    model_format = _get_file_format(task.model_name)
    model = TenantModel(
        tenant_id=tenant.id,
        model_name=task.model_name,
        model_path=str(final_file),
        model_format=model_format,
        file_size_bytes=total_written,
        file_sha256=file_sha256,
    )
    db.add(model)

    # 更新任务状态
    task.status = UploadStatus.COMPLETED
    task.final_path = str(final_file)
    await db.flush()

    logger.info(
        f"模型上传完成 | tenant={tenant.tenant_id} model={task.model_name} "
        f"size={total_written} sha256={file_sha256[:16]}..."
    )

    return model


async def get_upload_task_status(
    db: AsyncSession,
    tenant: Tenant,
    task_id: str,
) -> Optional[UploadTask]:
    """查询上传任务状态"""
    result = await db.execute(
        select(UploadTask).where(
            UploadTask.task_id == task_id,
            UploadTask.tenant_id == tenant.id,
        )
    )
    return result.scalar_one_or_none()


async def cancel_upload_task(
    db: AsyncSession,
    tenant: Tenant,
    task_id: str,
):
    """取消上传任务，清理临时文件"""
    result = await db.execute(
        select(UploadTask).where(
            UploadTask.task_id == task_id,
            UploadTask.tenant_id == tenant.id,
        )
    )
    task = result.scalar_one_or_none()

    if task is None:
        raise ValueError(f"上传任务不存在: {task_id}")

    # 清理临时分片
    if task.temp_dir:
        shutil.rmtree(task.temp_dir, ignore_errors=True)

    task.status = UploadStatus.CANCELLED
    await db.flush()

    logger.info(f"上传任务已取消 | task={task_id}")

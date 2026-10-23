"""
模型上传服务
- 分片上传
- 断点续传
- 文件格式校验
- 存储隔离
"""

import os
import json
import uuid
import shutil
import hashlib
from pathlib import Path
from typing import Optional

import aiofiles

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import TenantContext
from app.core.logging import logger
from app.models import Tenant, TenantModel, UploadTask, UploadStatus


# 分片大小常量（默认 10MB）
DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024

# 分片大小上限：分片数据会整体读入内存，超大分片可打爆服务进程
MAX_CHUNK_SIZE = 16 * 1024 * 1024

# 多文件模型清单文件名（存于任务临时目录）
MANIFEST_NAME = "manifest.json"


def _expected_chunk_size(task: UploadTask, index: int) -> int:
    """计算指定索引分片的期望字节数（末片为总大小余数）"""
    offset = index * task.chunk_size
    return min(task.chunk_size, task.total_size - offset)


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


def _validate_manifest(files: list[dict]) -> None:
    """校验多文件清单：路径安全、无重复、至少一个权重文件"""
    if not files:
        raise ValueError("文件清单不能为空")

    seen = set()
    for spec in files:
        name = spec.get("name", "")
        if not name or name.startswith("/") or "\\" in name or ":" in name:
            raise ValueError(f"非法文件路径: {name!r}")
        parts = name.split("/")
        if any(p in ("", ".", "..") for p in parts):
            raise ValueError(f"非法文件路径: {name!r}")
        if name in seen:
            raise ValueError(f"文件清单存在重复: {name}")
        seen.add(name)

        sha = spec.get("sha256")
        if sha is not None and (
            len(sha) != 64 or any(c not in "0123456789abcdefABCDEF" for c in sha)
        ):
            raise ValueError(f"非法的SHA256值: {name}")

    if not any(
        Path(spec["name"]).suffix.lower() in settings.ALLOWED_MODEL_EXTENSIONS
        for spec in files
    ):
        raise ValueError(
            "文件清单必须至少包含一个模型权重文件。"
            f"允许的格式: {', '.join(settings.ALLOWED_MODEL_EXTENSIONS)}"
        )


def _write_manifest(temp_dir: Path, files: list[dict]) -> None:
    """将多文件清单写入任务临时目录（分片编号 = 清单顺序拼接的字节流）"""
    path = temp_dir / MANIFEST_NAME
    path.write_text(
        json.dumps({"version": 1, "files": files}, ensure_ascii=False),
        encoding="utf-8",
    )


def _load_manifest(task: UploadTask) -> Optional[list[dict]]:
    """加载多文件清单；单文件任务返回 None"""
    path = Path(task.temp_dir) / MANIFEST_NAME
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise ValueError(f"文件清单损坏，无法完成上传: {e}")
    files = data.get("files")
    if not isinstance(files, list):
        raise ValueError("文件清单格式错误，无法完成上传")
    _validate_manifest(files)
    if sum(f["size"] for f in files) != task.total_size:
        raise ValueError("文件清单与总大小不一致，无法完成上传")
    return files


def _split_to_dir(merged_file: Path, dest_dir: Path, files: list[dict]) -> None:
    """按清单大小把合并流切分写入目标目录；中途失败由调用方清理 dest_dir"""
    with open(merged_file, "rb") as src:
        for spec in files:
            target = dest_dir / spec["name"]
            target.parent.mkdir(parents=True, exist_ok=True)
            expect_sha = (spec.get("sha256") or "").strip().lower()
            sha = hashlib.sha256() if expect_sha else None
            remaining = spec["size"]
            with open(target, "wb") as out:
                while remaining > 0:
                    data = src.read(min(1024 * 1024, remaining))
                    if not data:
                        raise ValueError(f"合并数据不足: {spec['name']}")
                    out.write(data)
                    remaining -= len(data)
                    if sha:
                        sha.update(data)
            if sha and sha.hexdigest() != expect_sha:
                raise ValueError(
                    f"文件SHA256校验失败: {spec['name']} "
                    f"预期 {expect_sha}, 实际 {sha.hexdigest()}"
                )


def _detect_dir_format(target_dir: Path) -> str:
    """根据目录内权重文件推断模型格式"""
    for f in target_dir.rglob("*"):
        ext = f.suffix.lower()
        if ext in settings.ALLOWED_MODEL_EXTENSIONS:
            return ext.lstrip(".")
    return "safetensors"


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
    files: Optional[list[dict]] = None,
) -> UploadTask:
    """
    创建分片上传任务
    租户发起上传前先调用此接口，获取 task_id 和分片方案
    files: 多文件清单（存入 manifest.json），缺省为单文件模式
    """
    if chunk_size > MAX_CHUNK_SIZE:
        raise ValueError(
            f"分片大小超过上限: {MAX_CHUNK_SIZE // (1024 * 1024)}MB"
        )

    # 拒绝路径分隔符：目标路径按 model_name 拼接，含分隔符会写出租户目录
    if "/" in model_name or "\\" in model_name:
        raise ValueError("模型名称不能包含路径分隔符")

    if files:
        # 多文件模式：model_name 为模型目录名，不要求扩展名
        _validate_manifest(files)
        if sum(f["size"] for f in files) != total_size:
            raise ValueError(
                f"文件清单总大小({sum(f['size'] for f in files)})与total_size({total_size})不一致"
            )
        # 多文件合并为目录，同名已存在时拒绝（目录写入非原子，不覆盖）
        final_path = _get_tenant_storage(tenant.tenant_id) / model_name
        if final_path.exists():
            raise ValueError(
                f"目标模型已存在: {model_name}，请先删除后再上传"
            )
    elif not _validate_file_extension(model_name):
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

    if files:
        _write_manifest(temp_dir, files)

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
        # 失败（大小/SHA256校验未过）可重传修复：无法定位坏分片，清空临时分片从头传
        for stale in Path(task.temp_dir).glob("chunk_*"):
            stale.unlink(missing_ok=True)
        task.uploaded_chunks = 0
        task.status = UploadStatus.UPLOADING
        logger.info(f"失败任务恢复重传 | task={task_id}")

    if chunk_index < 0 or chunk_index >= task.total_chunks:
        raise ValueError(f"分片索引无效: {chunk_index}, 总分片数: {task.total_chunks}")

    expected_size = _expected_chunk_size(task, chunk_index)
    if len(chunk_data) != expected_size:
        raise ValueError(
            f"分片大小不符: 索引 {chunk_index} 预期 {expected_size} 字节, "
            f"实际 {len(chunk_data)} 字节"
        )

    # 检查分片是否已存在（断点续传）
    chunk_file = Path(task.temp_dir) / f"chunk_{chunk_index:06d}"
    if chunk_file.exists():
        if chunk_file.stat().st_size == expected_size:
            # 以磁盘为准重算进度：修复“分片已落盘但计数未持久化”导致永远凑不满的死锁
            count = 0
            for f in Path(task.temp_dir).glob("chunk_*"):
                try:
                    idx = int(f.name.split("_", 1)[1])
                except ValueError:
                    continue
                if (
                    0 <= idx < task.total_chunks
                    and f.stat().st_size == _expected_chunk_size(task, idx)
                ):
                    count += 1
            task.uploaded_chunks = count
            await db.flush()
            logger.debug(f"分片已存在，跳过 | task={task_id} chunk={chunk_index}")
            return task
        # 半截分片：大小不符则删除后重写
        chunk_file.unlink()

    # 写入分片
    async with aiofiles.open(chunk_file, "wb") as f:
        await f.write(chunk_data)

    if chunk_file.stat().st_size != expected_size:
        raise ValueError(
            f"分片写入磁盘大小不符: 预期 {expected_size}, 实际 {chunk_file.stat().st_size}"
        )

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
    expected_sha256: Optional[str] = None,
) -> TenantModel:
    """
    完成上传：合并所有分片，校验完整性，移动到最终存储位置
    expected_sha256: 可选的期望文件哈希（64位十六进制），提供则比对内容完整性
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

    # 以磁盘为准校验所有分片（存在且大小等于期望值），不信任数据库计数
    missing = []
    for i in range(task.total_chunks):
        chunk_file = Path(task.temp_dir) / f"chunk_{i:06d}"
        if (
            not chunk_file.exists()
            or chunk_file.stat().st_size != _expected_chunk_size(task, i)
        ):
            missing.append(i)
    if missing:
        raise ValueError(
            f"分片不完整: 缺失或大小不符 {len(missing)} 片, "
            f"例如索引 {missing[:5]}"
        )
    task.uploaded_chunks = task.total_chunks

    # 多文件模式：按清单切分为目录；单文件模式：落一个文件
    manifest = _load_manifest(task)
    storage_path = _get_tenant_storage(tenant.tenant_id)
    final_path = storage_path / task.model_name

    if manifest and final_path.exists():
        # create 时已查过，此处防合并窗口内的同名竞争
        raise ValueError(
            f"目标模型已存在: {task.model_name}，请先删除后再上传"
        )

    logger.info(f"开始合并分片 | task={task_id} -> {final_path}")

    # 先合并到临时文件：校验通过前不碰最终位置，避免半截产物
    merged_file = Path(task.temp_dir) / "merged.bin"
    sha256_hash = hashlib.sha256()
    total_written = 0

    with open(merged_file, "wb") as out_f:
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

    # 校验总大小
    if total_written != task.total_size:
        logger.error(
            f"文件大小校验失败 | expected={task.total_size} actual={total_written}"
        )
        merged_file.unlink(missing_ok=True)
        task.status = UploadStatus.FAILED
        # 先提交再抛错：get_db 捕获异常后会回滚，否则 FAILED 不会落库
        await db.commit()
        raise ValueError(
            f"文件大小校验失败: 预期 {task.total_size}, 实际 {total_written}"
        )

    # 计算整体 SHA256（单文件=文件哈希；多文件=按清单顺序拼接流哈希）
    file_sha256 = sha256_hash.hexdigest()

    # 比对期望哈希（仅大小校验无法发现内容损坏）
    expect = (expected_sha256 or "").strip().lower()
    if expect and file_sha256 != expect:
        logger.error(
            f"SHA256校验失败 | task={task_id} expect={expect} actual={file_sha256}"
        )
        merged_file.unlink(missing_ok=True)
        task.status = UploadStatus.FAILED
        # 先提交再抛错：get_db 捕获异常后会回滚，否则 FAILED 不会落库
        await db.commit()
        raise ValueError(
            f"SHA256校验失败: 预期 {expect}, 实际 {file_sha256}"
        )

    # 落盘到最终位置
    if manifest:
        try:
            _split_to_dir(merged_file, final_path, manifest)
        except (OSError, ValueError) as e:
            # 切分半成品目录不可信，整体清除
            shutil.rmtree(final_path, ignore_errors=True)
            merged_file.unlink(missing_ok=True)
            task.status = UploadStatus.FAILED
            await db.commit()
            raise ValueError(f"切分模型文件失败: {e}")
        merged_file.unlink(missing_ok=True)
        model_format = _detect_dir_format(final_path)
    else:
        if final_path.exists() and final_path.is_dir():
            # 单文件名撞上已有模型目录：不能覆盖非空目录
            merged_file.unlink(missing_ok=True)
            raise ValueError(
                f"目标位置已存在同名模型目录: {task.model_name}，请先删除后再上传"
            )
        final_path.parent.mkdir(parents=True, exist_ok=True)
        os.replace(merged_file, final_path)  # 原子替换，保持单文件覆盖语义
        model_format = _get_file_format(task.model_name)

    # 清理临时分片
    shutil.rmtree(task.temp_dir, ignore_errors=True)

    # 创建模型记录
    model = TenantModel(
        tenant_id=tenant.id,
        model_name=task.model_name,
        model_path=str(final_path),
        model_format=model_format,
        file_size_bytes=total_written,
        file_sha256=file_sha256,
    )
    db.add(model)

    # 更新任务状态
    task.status = UploadStatus.COMPLETED
    task.final_path = str(final_path)
    await db.flush()

    logger.info(
        f"模型上传完成 | tenant={tenant.tenant_id} model={task.model_name} "
        f"files={len(manifest) if manifest else 1} size={total_written} "
        f"sha256={file_sha256[:16]}..."
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

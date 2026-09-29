"""
模型库导入服务
- 从 ModelScope / HuggingFace 拉取完整模型目录（权重分片 + 配置文件）
- 后台异步下载，支持进度查询、取消
- 存储配额控制
"""

import asyncio
import re
import shutil
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from aiofiles import open as aio_open
from sqlalchemy import select

from app.core.logging import logger, log_audit
from app.database import async_session_factory
from app.models import Tenant, TenantModel
from app.services.upload_service import _get_tenant_storage, get_tenant_storage_usage

DOWNLOAD_CONCURRENCY = 3
CHUNK_SIZE = 1024 * 1024  # 1MB

MODELSCOPE_API = "https://modelscope.cn/api/v1/models"
HF_ENDPOINT = "https://huggingface.co"

_REPO_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+){1,2}$")

# 内存任务注册表（服务重启后丢失，已完成任务已落库不受影响）
_tasks: dict[str, "ImportTask"] = {}


@dataclass
class ImportTask:
    """一个模型库导入任务"""
    task_id: str
    tenant_row_id: int          # tenants.id（数据库外键）
    tenant_id: str              # 租户标识（存储目录名）
    repo_id: str
    source: str                 # modelscope / hf
    model_name: str
    target_dir: Path
    file_list: list[dict]
    status: str = "pending"     # downloading/completed/failed/cancelled
    total_bytes: int = 0
    downloaded_bytes: int = 0
    files_total: int = 0
    files_done: int = 0
    current_file: str = ""
    error: str = ""
    model_row_id: Optional[int] = None
    created_at: float = field(default_factory=time.time)
    cancel_requested: bool = False
    usage_before: int = 0       # 导入前租户已用存储（字节）
    quota_bytes: int = 0

    def quota_exceeded(self) -> bool:
        return self.usage_before + self.downloaded_bytes > self.quota_bytes

    def to_dict(self) -> dict:
        elapsed = max(time.time() - self.created_at, 0.001)
        speed = self.downloaded_bytes / elapsed if self.status == "downloading" else 0
        return {
            "task_id": self.task_id,
            "repo_id": self.repo_id,
            "source": self.source,
            "model_name": self.model_name,
            "status": self.status,
            "total_bytes": self.total_bytes,
            "downloaded_bytes": self.downloaded_bytes,
            "files_total": self.files_total,
            "files_done": self.files_done,
            "current_file": self.current_file,
            "progress_percent": round(self.downloaded_bytes / self.total_bytes * 100, 1)
            if self.total_bytes > 0 else 0,
            "speed_mb_s": round(speed / (1024 * 1024), 1),
            "error": self.error,
            "model_id": self.model_row_id,
            "created_at": datetime.fromtimestamp(self.created_at).isoformat(),
        }


def _list_repo_files(source: str, repo_id: str) -> list[dict]:
    """获取仓库完整文件列表 [{path, size}]"""
    with httpx.Client(timeout=30) as client:
        if source == "modelscope":
            resp = client.get(
                f"{MODELSCOPE_API}/{repo_id}/repo/files",
                params={"Revision": "master"},
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("Code") != 200:
                raise ValueError(f"ModelScope 仓库不存在或不可访问: {repo_id}")
            files = [
                {"path": f["Path"], "size": f.get("Size", 0)}
                for f in data["Data"]["Files"]
                if f.get("Type") == "blob" and not f["Path"].startswith(".")
            ]
        elif source == "hf":
            resp = client.get(
                f"{HF_ENDPOINT}/api/models/{repo_id}/tree/main",
                params={"recursive": "true"},
            )
            resp.raise_for_status()
            files = [
                {"path": f["path"], "size": f.get("size", 0)}
                for f in resp.json()
                if f.get("type") == "blob" and not f["path"].startswith(".")
            ]
        else:
            raise ValueError(f"不支持的模型源: {source}，可选: modelscope / hf")
    return files


def _download_url(source: str, repo_id: str, path: str) -> str:
    if source == "modelscope":
        return f"{MODELSCOPE_API}/{repo_id}/repo?Revision=master&FilePath={path}"
    return f"{HF_ENDPOINT}/{repo_id}/resolve/main/{path}"


def _detect_model_format(target_dir: Path) -> str:
    """根据目录内文件推断模型格式"""
    for f in target_dir.rglob("*"):
        if f.suffix.lower() == ".gguf":
            return "gguf"
    return "safetensors"


async def _download_file(
    client: httpx.AsyncClient,
    task: ImportTask,
    file_info: dict,
    dest: Path,
):
    """下载单个文件（流式写入，实时更新进度与配额检查）"""
    path, file_size = file_info["path"], file_info["size"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = _download_url(task.source, task.repo_id, path)

    async with client.stream("GET", url) as resp:
        resp.raise_for_status()
        async with aio_open(dest, "wb") as f:
            async for chunk in resp.aiter_bytes(CHUNK_SIZE):
                if task.cancel_requested:
                    raise asyncio.CancelledError()
                if task.quota_exceeded():
                    raise QuotaExceeded()
                await f.write(chunk)
                task.downloaded_bytes += len(chunk)

    # 校验单文件大小（服务端能提供准确 size 时）
    if file_size and abs(dest.stat().st_size - file_size) > file_size * 0.01 + 1024:
        raise ValueError(f"文件大小校验失败: {path}")


class QuotaExceeded(Exception):
    """存储配额超限"""


async def _run_import(task: ImportTask):
    """后台下载主流程"""
    sem = asyncio.Semaphore(DOWNLOAD_CONCURRENCY)

    async def worker(client: httpx.AsyncClient, file_info: dict):
        async with sem:
            if task.status in ("failed", "cancelled"):
                return
            task.current_file = file_info["path"]
            dest = task.target_dir / file_info["path"]
            try:
                await _download_file(client, task, file_info, dest)
                task.files_done += 1
            except (asyncio.CancelledError, QuotaExceeded):
                raise
            except Exception as e:
                raise RuntimeError(f"下载 {file_info['path']} 失败: {e}")

    try:
        task.status = "downloading"

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=15, read=120, write=60, pool=60),
            follow_redirects=True,
        ) as client:
            results = await asyncio.gather(
                *(asyncio.create_task(worker(client, fi)) for fi in task.file_list),
                return_exceptions=True,
            )

        if task.cancel_requested:
            task.status = "cancelled"
            task.error = "用户取消导入"
        elif any(isinstance(r, QuotaExceeded) for r in results):
            task.status = "failed"
            task.error = "存储配额超限，导入已中止"
        elif any(isinstance(r, asyncio.CancelledError) for r in results):
            # 单个 worker 主动取消（配额/全局取消），归入对应状态
            if task.quota_exceeded():
                task.status = "failed"
                task.error = "存储配额超限，导入已中止"
            else:
                task.status = "cancelled"
                task.error = "用户取消导入"
        else:
            first_err = next(
                (str(r) for r in results if isinstance(r, Exception)), None
            )
            if first_err:
                raise RuntimeError(first_err)
            task.status = "completed"
            task.current_file = ""
            await _register_model(task)

    except Exception as e:
        task.status = "failed"
        task.error = str(e)
        logger.error(
            f"模型导入失败 | task={task.task_id} repo={task.repo_id} error={e}"
        )
    finally:
        task.file_list = []

        # 失败/取消时清理不完整目录
        if task.status in ("failed", "cancelled"):
            shutil.rmtree(task.target_dir, ignore_errors=True)

        logger.info(
            f"模型导入结束 | task={task.task_id} repo={task.repo_id} "
            f"status={task.status} downloaded={task.downloaded_bytes}"
        )


async def _register_model(task: ImportTask):
    """下载完成后写入模型记录与审计日志"""
    async with async_session_factory() as db:
        try:
            fmt = _detect_model_format(task.target_dir)
            model = TenantModel(
                tenant_id=task.tenant_row_id,
                model_name=task.model_name,
                model_path=str(task.target_dir),
                model_format=fmt,
                file_size_bytes=task.downloaded_bytes,
                file_sha256=None,
            )
            db.add(model)
            await db.flush()
            task.model_row_id = model.id

            await log_audit(
                db, task.tenant_row_id, "model_import",
                resource=task.model_name,
                detail={
                    "repo_id": task.repo_id,
                    "source": task.source,
                    "size_bytes": task.downloaded_bytes,
                    "task_id": task.task_id,
                },
            )
            await db.commit()

            tenant = await db.get(Tenant, task.tenant_row_id)
            logger.info(
                f"模型导入完成 | tenant={tenant.tenant_id if tenant else task.tenant_id} "
                f"model={task.model_name} size={task.downloaded_bytes}"
            )
        except Exception:
            await db.rollback()
            raise


async def start_import(
    tenant: Tenant,
    repo_id: str,
    source: str = "modelscope",
) -> ImportTask:
    """发起导入：校验、规划文件清单、启动后台下载"""
    repo_id = repo_id.strip().strip("/")
    if not _REPO_ID_RE.match(repo_id):
        raise ValueError(f"模型仓库名称格式无效: {repo_id}（应为 namespace/model 形式）")
    if source not in ("modelscope", "hf"):
        raise ValueError(f"不支持的模型源: {source}，可选: modelscope / hf")

    model_name = repo_id.split("/")[-1]

    # 同名任务进行中则拒绝
    for t in _tasks.values():
        if (
            t.tenant_row_id == tenant.id
            and t.model_name == model_name
            and t.status in ("pending", "downloading")
        ):
            raise ValueError(f"该模型已有导入任务进行中: {t.task_id}")

    # 获取文件清单（校验仓库存在性 + 预估总大小）
    loop = asyncio.get_running_loop()
    try:
        file_list = await loop.run_in_executor(None, _list_repo_files, source, repo_id)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise ValueError(f"仓库不存在: {repo_id}（{source}）")
        raise ValueError(f"获取仓库文件列表失败: HTTP {e.response.status_code}")
    except httpx.HTTPError as e:
        raise ValueError(f"无法连接模型源（{source}）: {e}")

    if not file_list:
        raise ValueError("仓库为空，无可下载文件")

    total_bytes = sum(f["size"] for f in file_list)

    # 配额检查
    usage = await get_tenant_storage_usage(tenant.tenant_id)
    quota_bytes = tenant.storage_quota_gb * 1024**3
    if usage + total_bytes > quota_bytes:
        need_gb, free_gb = total_bytes / 1024**3, (quota_bytes - usage) / 1024**3
        raise ValueError(
            f"存储空间不足。需要 {need_gb:.1f}GB，剩余 {free_gb:.1f}GB，"
            f"配额 {tenant.storage_quota_gb}GB，请联系管理员扩容"
        )

    target_dir = _get_tenant_storage(tenant.tenant_id) / model_name

    # 目录已存在：有模型记录则拒绝；无记录（历史残留）则清理后继续
    if target_dir.exists():
        async with async_session_factory() as db:
            result = await db.execute(
                select(TenantModel).where(
                    TenantModel.tenant_id == tenant.id,
                    TenantModel.model_name == model_name,
                )
            )
            if result.scalar_one_or_none():
                raise ValueError(f"模型已存在: {model_name}，请先删除或更换名称")
        shutil.rmtree(target_dir, ignore_errors=True)
        logger.warning(f"清理历史残留目录 | path={target_dir}")

    task = ImportTask(
        task_id=f"import_{uuid.uuid4().hex[:16]}",
        tenant_row_id=tenant.id,
        tenant_id=tenant.tenant_id,
        repo_id=repo_id,
        source=source,
        model_name=model_name,
        target_dir=target_dir,
        file_list=file_list,
        total_bytes=total_bytes,
        files_total=len(file_list),
        usage_before=usage,
        quota_bytes=quota_bytes,
    )
    _tasks[task.task_id] = task

    asyncio.create_task(_run_import(task))

    logger.info(
        f"创建导入任务 | tenant={tenant.tenant_id} repo={repo_id} "
        f"source={source} files={len(file_list)} size={total_bytes}"
    )
    return task


def get_task(task_id: str, tenant: Tenant) -> Optional[ImportTask]:
    """获取当前租户的导入任务"""
    task = _tasks.get(task_id)
    if task and task.tenant_row_id == tenant.id:
        return task
    return None


def list_tasks(tenant: Tenant) -> list[dict]:
    """列出当前租户的所有导入任务（新→旧）"""
    mine = [t for t in _tasks.values() if t.tenant_row_id == tenant.id]
    mine.sort(key=lambda t: t.created_at, reverse=True)
    return [t.to_dict() for t in mine]


def request_cancel(task_id: str, tenant: Tenant) -> ImportTask:
    """请求取消导入任务"""
    task = get_task(task_id, tenant)
    if task is None:
        raise ValueError(f"导入任务不存在: {task_id}")
    if task.status not in ("pending", "downloading"):
        raise ValueError(f"任务已结束（{task.status}），无法取消")
    task.cancel_requested = True
    logger.info(f"请求取消导入 | task={task_id}")
    return task

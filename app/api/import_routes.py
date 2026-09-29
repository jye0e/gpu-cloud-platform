"""
租户端路由 - 模型库导入
- POST   /api/tenant/models/import           发起导入（ModelScope/HF）
- GET    /api/tenant/models/import/tasks     导入任务列表
- GET    /api/tenant/models/import/{task_id} 查询导入进度
- POST   /api/tenant/models/import/{task_id}/cancel 取消导入
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_tenant
from app.core.logging import log_audit
from app.database import get_db
from app.models import Tenant
from app.services import import_service

router = APIRouter(prefix="/api/tenant/models/import", tags=["租户-模型导入"])


class ImportModelRequest(BaseModel):
    """发起模型导入请求"""
    repo_id: str = Field(..., description="模型仓库 ID，如 Qwen/Qwen2.5-0.5B-Instruct")
    source: str = Field(default="modelscope", description="模型源: modelscope / hf")


@router.post(
    "",
    summary="从模型库导入完整模型",
    description=(
        "从 ModelScope 或 HuggingFace 拉取完整模型目录"
        "（权重分片 + config.json/tokenizer 等配置文件），"
        "后台异步下载，返回 task_id 用于查询进度。"
    ),
)
async def create_import(
    req: ImportModelRequest,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    try:
        task = await import_service.start_import(
            tenant=tenant,
            repo_id=req.repo_id,
            source=req.source,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_audit(
        db, tenant.id, "import_start",
        resource=req.repo_id,
        detail={"task_id": task.task_id, "source": req.source},
    )

    return task.to_dict()


@router.get(
    "/tasks",
    summary="查询导入任务列表",
)
async def list_imports(tenant: Tenant = Depends(get_current_tenant)):
    return {"tasks": import_service.list_tasks(tenant), "total": len(import_service.list_tasks(tenant))}


@router.get(
    "/{task_id}",
    summary="查询导入进度",
)
async def get_import_status(
    task_id: str,
    tenant: Tenant = Depends(get_current_tenant),
):
    task = import_service.get_task(task_id, tenant)
    if task is None:
        raise HTTPException(status_code=404, detail="导入任务不存在")
    return task.to_dict()


@router.post(
    "/{task_id}/cancel",
    summary="取消导入任务",
    description="取消下载并清理不完整的文件。",
)
async def cancel_import(
    task_id: str,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    try:
        task = import_service.request_cancel(task_id, tenant)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await log_audit(db, tenant.id, "import_cancel", resource=task.repo_id)
    return {"task_id": task_id, "message": "取消请求已发送"}

"""
租户端路由 - 模型上传
- POST /api/tenant/upload_model/init    创建上传任务
- POST /api/tenant/upload_model/chunk   上传分片
- POST /api/tenant/upload_model/complete 完成上传
- GET  /api/tenant/upload_model/status   查询上传状态
- DELETE /api/tenant/upload_model/cancel  取消上传
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_tenant
from app.core.logging import logger, log_audit
from app.database import get_db
from app.models import Tenant
from app.services import upload_service
from app.api.schemas import (
    CreateUploadRequest,
    CreateUploadResponse,
    UploadStatusResponse,
)

router = APIRouter(prefix="/api/tenant/upload_model", tags=["租户-模型上传"])


@router.post(
    "/init",
    response_model=CreateUploadResponse,
    summary="初始化分片上传",
    description="创建上传任务，返回 task_id 和分片方案。支持大模型文件分片上传、断点续传。",
)
async def init_upload(
    req: CreateUploadRequest,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    try:
        task = await upload_service.create_upload_task(
            db=db,
            tenant=tenant,
            model_name=req.model_name,
            total_size=req.total_size,
            chunk_size=req.chunk_size,
        )

        await log_audit(
            db, tenant.id, "upload_init",
            resource=req.model_name,
            detail={"task_id": task.task_id, "total_size": req.total_size},
        )

        return CreateUploadResponse(
            task_id=task.task_id,
            model_name=task.model_name,
            total_chunks=task.total_chunks,
            chunk_size=task.chunk_size,
            total_size=task.total_size,
            uploaded_chunks=task.uploaded_chunks,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/chunk",
    summary="上传单个分片",
    description="上传指定分片。已上传的分片会被自动跳过（断点续传）。",
)
async def upload_chunk(
    task_id: str = Query(..., description="上传任务ID"),
    chunk_index: int = Query(..., description="分片索引（从0开始）"),
    file: UploadFile = File(..., description="分片数据"),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    try:
        chunk_data = await file.read()
        task = await upload_service.upload_chunk(
            db=db,
            tenant=tenant,
            task_id=task_id,
            chunk_index=chunk_index,
            chunk_data=chunk_data,
        )

        return {
            "task_id": task_id,
            "chunk_index": chunk_index,
            "uploaded_chunks": task.uploaded_chunks,
            "total_chunks": task.total_chunks,
            "progress_percent": round(
                task.uploaded_chunks / task.total_chunks * 100, 1
            ),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/complete",
    summary="完成上传（合并分片）",
    description="合并所有分片为完整模型文件，校验完整性，存储到租户专属目录。",
)
async def complete_upload(
    task_id: str = Query(..., description="上传任务ID"),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    try:
        model = await upload_service.complete_upload(
            db=db,
            tenant=tenant,
            task_id=task_id,
        )

        await log_audit(
            db, tenant.id, "upload_complete",
            resource=model.model_name,
            detail={
                "model_id": model.id,
                "file_size": model.file_size_bytes,
                "sha256": model.file_sha256[:16] + "...",
            },
        )

        return {
            "model_id": model.id,
            "model_name": model.model_name,
            "model_format": model.model_format,
            "file_size_bytes": model.file_size_bytes,
            "file_sha256": model.file_sha256,
            "message": "模型上传完成，可以开始部署",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/status",
    response_model=UploadStatusResponse,
    summary="查询上传任务状态",
)
async def get_upload_status(
    task_id: str = Query(..., description="上传任务ID"),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    task = await upload_service.get_upload_task_status(
        db=db, tenant=tenant, task_id=task_id
    )
    if task is None:
        raise HTTPException(status_code=404, detail="上传任务不存在")

    status_value = task.status.value if hasattr(task.status, 'value') else str(task.status)

    return UploadStatusResponse(
        task_id=task.task_id,
        model_name=task.model_name,
        total_chunks=task.total_chunks,
        uploaded_chunks=task.uploaded_chunks,
        status=status_value,
        progress_percent=round(task.uploaded_chunks / task.total_chunks * 100, 1)
        if task.total_chunks > 0 else 0,
    )


@router.delete(
    "/cancel",
    summary="取消上传任务",
    description="取消上传并清理临时分片文件。",
)
async def cancel_upload(
    task_id: str = Query(..., description="上传任务ID"),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    try:
        await upload_service.cancel_upload_task(
            db=db, tenant=tenant, task_id=task_id
        )
        await log_audit(db, tenant.id, "upload_cancel", resource=task_id)
        return {"message": "上传任务已取消"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

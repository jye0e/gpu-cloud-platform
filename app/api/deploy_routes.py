"""
租户端路由 - 模型部署 & 服务管理
- POST   /api/tenant/deploy            一键部署模型
- GET    /api/tenant/service_info       查询服务列表/详情
- POST   /api/tenant/service_operate    启停/删除服务
- GET    /api/tenant/models             查看已上传模型列表
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_tenant
from app.core.logging import logger, log_audit
from app.database import get_db
from app.models import (
    Tenant,
    TenantModel,
    DeployedService,
    ServiceStatus,
)
from app.services import docker_service, resource_service
from app.services.docker_service import (
    deploy_service,
    stop_service,
    start_service,
    remove_service,
    get_container_status,
    get_container_logs,
)
from app.services.engine_registry import list_engines
from app.api.schemas import (
    DeployRequest,
    DeployResponse,
    ServiceInfoResponse,
    ServiceOperateRequest,
)

router = APIRouter(prefix="/api/tenant", tags=["租户-部署与服务管理"])


@router.get(
    "/engines",
    summary="获取可用的推理引擎列表",
    description="返回系统支持的所有推理引擎及其配置信息",
)
async def get_engines():
    return {"engines": list_engines(), "total": len(list_engines())}


@router.get(
    "/models",
    summary="查看已上传模型列表",
)
async def list_models(
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TenantModel)
        .where(TenantModel.tenant_id == tenant.id)
        .order_by(TenantModel.created_at.desc())
    )
    models = result.scalars().all()

    return {
        "models": [
            {
                "model_id": m.id,
                "model_name": m.model_name,
                "model_format": m.model_format,
                "file_size_bytes": m.file_size_bytes,
                "file_size_gb": round(m.file_size_bytes / (1024**3), 2),
                "sha256": (m.file_sha256[:16] + "...") if m.file_sha256 else None,
                "created_at": m.created_at.isoformat(),
            }
            for m in models
        ],
        "total": len(models),
    }


@router.post(
    "/deploy",
    response_model=DeployResponse,
    summary="一键部署模型",
    description="租户自主配置部署参数，触发自动化部署。系统自动完成容器创建、GPU分配、vLLM启动。",
)
async def deploy_model(
    req: DeployRequest,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    # 1. 检查资源配额
    try:
        await resource_service.check_tenant_can_deploy(db, tenant)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))

    # 2. 查找模型
    result = await db.execute(
        select(TenantModel).where(
            TenantModel.id == req.model_id,
            TenantModel.tenant_id == tenant.id,
        )
    )
    model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=404, detail="模型不存在")

    # 3. 创建服务记录
    service = DeployedService(
        tenant_id=tenant.id,
        model_id=model.id,
        service_name=req.service_name,
        engine_type=req.engine_type,
        deploy_params=req.deploy_params,
        status=ServiceStatus.PENDING,
    )
    db.add(service)
    await db.flush()

    await log_audit(
        db, tenant.id, "deploy",
        resource=req.service_name,
        detail={"model_id": model.id, "model_name": model.model_name},
    )

    # 4. 执行部署（同步等待）
    try:
        await deploy_service(
            db=db,
            tenant=tenant,
            service=service,
            model_path=model.model_path,
            deploy_params=req.deploy_params,
            engine_type=req.engine_type,
            custom_image=req.custom_image,
            custom_entrypoint=req.custom_entrypoint,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"部署失败: {str(e)}")

    # 5. 返回部署信息
    inference_endpoint = None
    if service.status == ServiceStatus.RUNNING and service.service_port:
        inference_endpoint = f"/api/tenant/inference/{service.service_name}/v1"

    status_value = service.status.value if hasattr(service.status, 'value') else str(service.status)

    await log_audit(
        db, tenant.id, "deploy_complete",
        resource=service.service_name,
        detail={"status": status_value, "port": service.service_port, "engine_type": req.engine_type},
        status_code=200 if service.status == ServiceStatus.RUNNING else 500,
    )

    return DeployResponse(
        service_id=service.id,
        service_name=service.service_name,
        model_name=model.model_name,
        engine_type=req.engine_type,
        status=status_value,
        gpu_device_id=service.gpu_device_id,
        service_port=service.service_port,
        inference_endpoint=inference_endpoint,
        api_key=tenant.api_key,
    )


@router.get(
    "/service_info",
    summary="查询服务列表",
    description="查询当前租户的所有部署服务及其状态。",
)
async def list_services(
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeployedService, TenantModel)
        .join(TenantModel, DeployedService.model_id == TenantModel.id)
        .where(DeployedService.tenant_id == tenant.id)
        .order_by(DeployedService.created_at.desc())
    )
    rows = result.all()

    services = []
    for service, model in rows:
        status_value = service.status.value if hasattr(service.status, 'value') else str(service.status)

        # 获取容器实时状态
        container_info = await get_container_status(service)

        inference_endpoint = None
        if service.status == ServiceStatus.RUNNING and service.service_port:
            inference_endpoint = f"/api/tenant/inference/{service.service_name}/v1"

        services.append({
            "service_id": service.id,
            "service_name": service.service_name,
            "model_name": model.model_name,
            "engine_type": service.engine_type,
            "status": status_value,
            "gpu_device_id": service.gpu_device_id,
            "service_port": service.service_port,
            "inference_endpoint": inference_endpoint,
            "deploy_params": service.deploy_params,
            "container_status": container_info,
            "created_at": service.created_at.isoformat(),
            "last_active_at": service.last_active_at.isoformat(),
            "error_message": service.error_message,
        })

    return {"services": services, "total": len(services)}


@router.get(
    "/service_info/{service_id}",
    summary="查询单个服务详情",
)
async def get_service_detail(
    service_id: int,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeployedService, TenantModel)
        .join(TenantModel, DeployedService.model_id == TenantModel.id)
        .where(
            DeployedService.id == service_id,
            DeployedService.tenant_id == tenant.id,
        )
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=404, detail="服务不存在")

    service, model = row
    status_value = service.status.value if hasattr(service.status, 'value') else str(service.status)
    container_info = await get_container_status(service)

    inference_endpoint = None
    if service.status == ServiceStatus.RUNNING and service.service_port:
        inference_endpoint = f"/api/tenant/inference/{service.service_name}/v1"

    return {
        "service_id": service.id,
        "service_name": service.service_name,
        "model_name": model.model_name,
        "model_format": model.model_format,
        "status": status_value,
        "gpu_device_id": service.gpu_device_id,
        "service_port": service.service_port,
        "inference_endpoint": inference_endpoint,
        "deploy_params": service.deploy_params,
        "container_info": container_info,
        "container_id": service.container_id,
        "container_name": service.container_name,
        "created_at": service.created_at.isoformat(),
        "last_active_at": service.last_active_at.isoformat(),
        "error_message": service.error_message,
    }


@router.post(
    "/service_operate",
    summary="操作服务（启动/停止/重启/删除）",
    description="对已部署的服务执行生命周期操作。",
)
async def operate_service(
    req: ServiceOperateRequest,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeployedService).where(
            DeployedService.id == req.service_id,
            DeployedService.tenant_id == tenant.id,
        )
    )
    service = result.scalar_one_or_none()
    if service is None:
        raise HTTPException(status_code=404, detail="服务不存在")

    action = req.action.lower()

    try:
        if action == "stop":
            await stop_service(service)
            service.status = ServiceStatus.STOPPED
            await log_audit(db, tenant.id, "service_stop", resource=service.service_name)

        elif action == "start":
            await start_service(service)
            service.status = ServiceStatus.RUNNING
            await log_audit(db, tenant.id, "service_start", resource=service.service_name)

        elif action == "restart":
            await stop_service(service)
            import asyncio
            await asyncio.sleep(2)
            await start_service(service)
            service.status = ServiceStatus.RUNNING
            await log_audit(db, tenant.id, "service_restart", resource=service.service_name)

        elif action == "remove":
            await remove_service(service)
            service.status = ServiceStatus.STOPPED
            await log_audit(db, tenant.id, "service_remove", resource=service.service_name)
            return {"message": f"服务 {service.service_name} 已删除"}

        else:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的操作: {action}，可选: start/stop/restart/remove",
            )

        await db.flush()
        status_value = service.status.value if hasattr(service.status, 'value') else str(service.status)

        return {
            "service_id": service.id,
            "service_name": service.service_name,
            "status": status_value,
            "message": f"操作 {action} 已执行",
        }

    except HTTPException:
        raise
    except Exception as e:
        service.status = ServiceStatus.ERROR
        service.error_message = str(e)
        await db.flush()
        raise HTTPException(status_code=500, detail=f"操作失败: {str(e)}")


@router.get(
    "/service_logs/{service_id}",
    summary="获取服务容器日志",
    description="获取最近的服务日志，用于调试。",
)
async def get_service_logs(
    service_id: int,
    tail: int = Query(100, description="获取最后 N 行日志"),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeployedService).where(
            DeployedService.id == service_id,
            DeployedService.tenant_id == tenant.id,
        )
    )
    service = result.scalar_one_or_none()
    if service is None:
        raise HTTPException(status_code=404, detail="服务不存在")

    logs = await get_container_logs(service, tail=tail)
    return {
        "service_id": service.id,
        "service_name": service.service_name,
        "logs": logs,
    }

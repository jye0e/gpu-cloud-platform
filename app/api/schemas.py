"""
Pydantic 请求/响应模型定义
"""

from typing import Optional
from pydantic import BaseModel, Field


# ==================== 通用响应 ====================

class BaseResponse(BaseModel):
    code: int = 0
    message: str = "success"
    data: Optional[dict] = None


# ==================== 模型上传 ====================

class CreateUploadRequest(BaseModel):
    """创建上传任务"""
    model_name: str = Field(..., description="模型文件名，含扩展名", examples=["kimi-lora.safetensors"])
    total_size: int = Field(..., description="文件总大小（字节）", gt=0)
    chunk_size: int = Field(
        default=10485760,
        description="分片大小（字节），默认10MB",
        gt=0,
    )


class CreateUploadResponse(BaseModel):
    task_id: str
    model_name: str
    total_chunks: int
    chunk_size: int
    total_size: int
    uploaded_chunks: int = 0


class UploadStatusResponse(BaseModel):
    task_id: str
    model_name: str
    total_chunks: int
    uploaded_chunks: int
    status: str
    progress_percent: float


# ==================== 模型部署 ====================

class DeployRequest(BaseModel):
    """部署模型请求"""
    model_id: int = Field(..., description="已上传的模型ID")
    service_name: str = Field(..., description="服务名称", max_length=128)
    deploy_params: dict = Field(
        default={},
        description="部署参数",
        examples=[{
            "gpu_memory_utilization": 0.4,
            "max_model_len": 4096,
            "tensor_parallel_size": 1,
            "dtype": "auto",
            "memory_limit_gb": 16,
            "cpu_limit": 4.0,
        }],
    )


class DeployResponse(BaseModel):
    service_id: int
    service_name: str
    model_name: str
    status: str
    gpu_device_id: Optional[str] = None
    service_port: Optional[int] = None
    inference_endpoint: Optional[str] = None
    api_key: Optional[str] = None


# ==================== 服务管理 ====================

class ServiceInfoResponse(BaseModel):
    service_id: int
    service_name: str
    model_name: str
    status: str
    gpu_device_id: Optional[str] = None
    service_port: Optional[int] = None
    inference_endpoint: Optional[str] = None
    deploy_params: dict = {}
    created_at: str
    last_active_at: str
    error_message: Optional[str] = None


class ServiceOperateRequest(BaseModel):
    """服务操作"""
    action: str = Field(..., description="操作类型: start/stop/restart/remove")
    service_id: int = Field(..., description="服务ID")


# ==================== 租户管理（管理端） ====================

class CreateTenantRequest(BaseModel):
    """创建租户"""
    name: str = Field(..., description="租户名称", max_length=128)
    gpu_memory_util: float = Field(default=0.4, ge=0.1, le=0.9)
    max_model_len: int = Field(default=4096, gt=0)
    storage_quota_gb: int = Field(default=50, gt=0)
    qps_limit: int = Field(default=10, gt=0)
    gpu_device_ids: Optional[str] = Field(None, description="指定GPU ID，逗号分隔")


class CreateTenantResponse(BaseModel):
    tenant_id: str
    name: str
    api_key: str
    access_token: str
    status: str


class TenantInfoResponse(BaseModel):
    tenant_id: str
    name: str
    status: str
    gpu_memory_util: float
    max_model_len: int
    storage_quota_gb: int
    qps_limit: int
    gpu_device_ids: Optional[str] = None
    created_at: str


# ==================== 资源概览 ====================

class ResourceOverviewResponse(BaseModel):
    """租户资源概览"""
    storage: dict
    gpu_config: dict
    qps_limit: int

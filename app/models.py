"""
数据库模型定义
使用 SQLAlchemy 2.0 异步 ORM
"""

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    String, Integer, Float, Text, DateTime, Boolean,
    ForeignKey, JSON, Enum as SAEnum,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """ORM 基类"""
    pass


class TenantStatus(PyEnum):
    """租户状态"""
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DELETED = "deleted"


class ServiceStatus(PyEnum):
    """部署服务状态"""
    PENDING = "pending"       # 等待部署
    DEPLOYING = "deploying"   # 部署中（容器创建/模型加载）
    RUNNING = "running"       # 运行中
    STOPPED = "stopped"       # 已停止
    ERROR = "error"           # 异常
    SLEEPING = "sleeping"     # 闲置休眠


class UploadStatus(PyEnum):
    """上传任务状态"""
    UPLOADING = "uploading"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Tenant(Base):
    """租户表"""
    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, comment="租户唯一标识")
    name: Mapped[str] = mapped_column(String(128), comment="租户名称")
    token_hash: Mapped[str] = mapped_column(String(256), comment="Token哈希值")
    api_key: Mapped[str] = mapped_column(String(128), unique=True, comment="租户API密钥")
    status: Mapped[str] = mapped_column(
        SAEnum(TenantStatus), default=TenantStatus.ACTIVE, comment="租户状态"
    )

    # 资源配额
    gpu_memory_util: Mapped[float] = mapped_column(Float, default=0.4, comment="GPU显存利用率上限")
    max_model_len: Mapped[int] = mapped_column(Integer, default=4096, comment="最大上下文长度")
    storage_quota_gb: Mapped[int] = mapped_column(Integer, default=50, comment="存储配额(GB)")
    qps_limit: Mapped[int] = mapped_column(Integer, default=10, comment="QPS限流")
    gpu_device_ids: Mapped[str] = mapped_column(String(256), nullable=True, comment="分配的GPU设备ID，逗号分隔")

    # 元数据
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关联
    models: Mapped[list["TenantModel"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")
    services: Mapped[list["DeployedService"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")
    upload_tasks: Mapped[list["UploadTask"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")


class TenantModel(Base):
    """租户上传的模型"""
    __tablename__ = "tenant_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    model_name: Mapped[str] = mapped_column(String(256), comment="模型名称")
    model_path: Mapped[str] = mapped_column(String(512), comment="模型文件存储路径")
    model_format: Mapped[str] = mapped_column(String(32), comment="模型格式: safetensors/gguf/bin")
    file_size_bytes: Mapped[int] = mapped_column(Integer, default=0, comment="文件大小(字节)")
    file_sha256: Mapped[str] = mapped_column(String(128), nullable=True, comment="文件SHA256校验值")

    # 元数据
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # 关联
    tenant: Mapped["Tenant"] = relationship(back_populates="models")
    services: Mapped[list["DeployedService"]] = relationship(back_populates="model")


class UploadTask(Base):
    """分片上传任务"""
    __tablename__ = "upload_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    task_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, comment="上传任务ID")
    model_name: Mapped[str] = mapped_column(String(256), comment="目标模型名称")
    total_chunks: Mapped[int] = mapped_column(Integer, comment="总分片数")
    uploaded_chunks: Mapped[int] = mapped_column(Integer, default=0, comment="已上传分片数")
    chunk_size: Mapped[int] = mapped_column(Integer, comment="单片大小(字节)")
    total_size: Mapped[int] = mapped_column(Integer, comment="文件总大小(字节)")
    status: Mapped[str] = mapped_column(
        SAEnum(UploadStatus), default=UploadStatus.UPLOADING, comment="上传状态"
    )
    temp_dir: Mapped[str] = mapped_column(String(512), comment="分片临时存储目录")
    final_path: Mapped[str] = mapped_column(String(512), nullable=True, comment="合并后最终路径")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant: Mapped["Tenant"] = relationship(back_populates="upload_tasks")


class DeployedService(Base):
    """已部署的推理服务"""
    __tablename__ = "deployed_services"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("tenant_models.id"), index=True)
    service_name: Mapped[str] = mapped_column(String(128), comment="服务名称")
    engine_type: Mapped[str] = mapped_column(String(32), default="vllm", comment="推理引擎类型")
    container_id: Mapped[str] = mapped_column(String(128), nullable=True, comment="Docker容器ID")
    container_name: Mapped[str] = mapped_column(String(128), nullable=True, comment="容器名称")

    # 部署参数
    deploy_params: Mapped[dict] = mapped_column(JSON, default=dict, comment="部署参数JSON")
    gpu_device_id: Mapped[str] = mapped_column(String(32), nullable=True, comment="使用的GPU ID")
    vllm_port: Mapped[int] = mapped_column(Integer, nullable=True, comment="vLLM内部端口")
    service_port: Mapped[int] = mapped_column(Integer, nullable=True, comment="对外映射端口")

    # 状态
    status: Mapped[str] = mapped_column(
        SAEnum(ServiceStatus), default=ServiceStatus.PENDING, comment="服务状态"
    )
    error_message: Mapped[str] = mapped_column(Text, nullable=True, comment="错误信息")
    last_active_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, comment="最后活跃时间"
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant: Mapped["Tenant"] = relationship(back_populates="services")
    model: Mapped["TenantModel"] = relationship(back_populates="services")


class AuditLog(Base):
    """审计日志"""
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(64), comment="操作类型: upload/deploy/stop/start/call")
    resource: Mapped[str] = mapped_column(String(256), nullable=True, comment="操作资源")
    detail: Mapped[dict] = mapped_column(JSON, default=dict, comment="操作详情")
    ip_address: Mapped[str] = mapped_column(String(64), nullable=True, comment="请求IP")
    status_code: Mapped[int] = mapped_column(Integer, nullable=True, comment="HTTP状态码")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="audit_logs")

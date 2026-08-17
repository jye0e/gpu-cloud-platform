"""
应用配置模块
从 .env 文件加载配置，提供全局配置实例
"""

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """全局配置"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- 服务配置 ---
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    APP_DEBUG: bool = False

    # --- JWT 配置 ---
    JWT_SECRET_KEY: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24

    # --- 数据库 ---
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/gpu_cloud.db"

    # --- 存储配置 ---
    STORAGE_ROOT: str = "/data/models"

    # --- Docker 配置 ---
    DOCKER_SOCKET: str = "unix:///var/run/docker.sock"
    VLLM_IMAGE: str = "vllm/vllm-openai:latest"

    # --- GPU 配置 ---
    GPU_MEMORY_RESERVE_MB: int = 2048
    MAX_TENANTS_PER_GPU: int = 2

    # --- 默认资源配额 ---
    DEFAULT_GPU_MEMORY_UTIL: float = 0.4
    DEFAULT_MAX_MODEL_LEN: int = 4096
    DEFAULT_STORAGE_QUOTA_GB: int = 50
    DEFAULT_QPS_LIMIT: int = 10

    # --- 网关配置 ---
    GATEWAY_RATE_LIMIT: int = 100
    IDLE_TIMEOUT_MINUTES: int = 30

    # --- 日志 ---
    LOG_LEVEL: str = "INFO"
    LOG_DIR: str = "./logs"

    # --- 合规模型文件扩展名 ---
    ALLOWED_MODEL_EXTENSIONS: list[str] = [
        ".safetensors",
        ".gguf",
        ".bin",
        ".pt",
        ".pth",
    ]

    @property
    def project_root(self) -> Path:
        return Path(__file__).resolve().parent.parent

    @property
    def storage_path(self) -> Path:
        path = Path(self.STORAGE_ROOT)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def log_path(self) -> Path:
        path = Path(self.LOG_DIR)
        path.mkdir(parents=True, exist_ok=True)
        return path


# 全局配置单例
settings = Settings()

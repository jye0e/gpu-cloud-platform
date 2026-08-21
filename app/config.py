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
    JWT_EXPIRE_HOURS: int = 168  # 7天

    # --- 数据库 ---
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/gpu_cloud.db"

    # --- 存储配置 ---
    STORAGE_ROOT: str = "./data/models"

    # --- Docker 配置 ---
    DOCKER_SOCKET: str = "unix:///var/run/docker.sock"

    # --- 推理引擎配置 ---
    DEFAULT_ENGINE: str = "vllm"

    # 镜像源前缀（用于国内加速，留空则使用原始地址）
    # 示例: "m.daocloud.io/docker.io/" 将 Docker Hub 镜像走 DaoCloud 代理
    IMAGE_MIRROR_PREFIX: str = "m.daocloud.io/docker.io/"

    # 各引擎默认镜像（配置中可覆盖）
    VLLM_IMAGE: str = "vllm/vllm-openai:v0.26.0"
    TENSORRT_LLM_IMAGE: str = "nvcr.io/nvidia/tensorrt-llm:latest"
    LM_DEPLOY_IMAGE: str = "openmmlab/lmdeploy:latest"
    SGLANG_IMAGE: str = "lmsysorg/sglang:latest"
    TGI_IMAGE: str = "ghcr.io/huggingface/text-generation-inference:latest"
    OLLAMA_IMAGE: str = "ollama/ollama:latest"

    # 自定义引擎镜像（由用户部署时指定，不经过镜像替换）
    CUSTOM_IMAGE: str = ""

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

    def apply_mirror(self, image: str, skip_mirror: bool = False) -> str:
        """
        对镜像名应用国内镜像源前缀。
        - Docker Hub 镜像 (不含 '/' 或以 'library/' 开头): 直接加前缀
        - 已含 registry 前缀的镜像: 检查是否已在允许列表
        - skip_mirror=True 或 IMAGE_MIRROR_PREFIX 为空: 原样返回
        """
        if skip_mirror or not self.IMAGE_MIRROR_PREFIX:
            return image

        # 如果镜像已经是完整路径（包含镜像前缀本身），直接返回
        if image.startswith(self.IMAGE_MIRROR_PREFIX):
            return image

        # 如果镜像已经带有其他 registry（如 nvcr.io, ghcr.io, quay.io），不做替换
        known_registries = ("nvcr.io", "ghcr.io", "quay.io", "gcr.io", "registry.cn-hangzhou.aliyuncs.com", "m.daocloud.io")
        for reg in known_registries:
            if image.startswith(reg):
                return image

        # Docker Hub 镜像: 添加镜像前缀
        return self.IMAGE_MIRROR_PREFIX + image


# 全局配置单例
settings = Settings()

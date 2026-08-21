"""
推理引擎注册表
- 定义引擎类型和配置
- 支持内置引擎和自定义引擎
- 提供引擎命令构建函数
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from app.config import settings


class EngineType(str, Enum):
    """支持的引擎类型"""
    VLLM = "vllm"
    TENSORRT_LLM = "tensorrt_llm"
    LM_DEPLOY = "lmdeploy"
    SGLANG = "sglang"
    TGI = "tgi"
    OLLAMA = "ollama"
    CUSTOM = "custom"


@dataclass
class EngineConfig:
    """引擎配置"""
    name: str
    label: str
    docker_image: str
    description: str
    health_check_path: str = "/health"
    api_base_path: str = "/v1"
    supports_gguf: bool = False
    supports_safetensors: bool = True
    default_entrypoint: Optional[list[str]] = None
    extra_env: dict = field(default_factory=dict)


# ==================== 内置引擎注册表 ====================

_BUILTIN_ENGINES: dict[EngineType, EngineConfig] = {
    EngineType.VLLM: EngineConfig(
        name="vllm",
        label="vLLM",
        docker_image=settings.apply_mirror(settings.VLLM_IMAGE),
        description="高性能推理引擎，PagedAttention 动态批处理，吞吐量极高",
        health_check_path="/health",
        api_base_path="/v1",
        supports_gguf=True,
        supports_safetensors=True,
    ),
    EngineType.TENSORRT_LLM: EngineConfig(
        name="tensorrt_llm",
        label="TensorRT-LLM",
        docker_image=settings.apply_mirror(settings.TENSORRT_LLM_IMAGE),
        description="NVIDIA 官方推理引擎，极致性能，需模型编译优化",
        health_check_path="/v1/health",
        api_base_path="/v1",
        supports_gguf=False,
        supports_safetensors=True,
        extra_env={"NVIDIA_TENSORRT_LLM": "1"},
    ),
    EngineType.LM_DEPLOY: EngineConfig(
        name="lmdeploy",
        label="LMDeploy",
        docker_image=settings.apply_mirror(settings.LM_DEPLOY_IMAGE),
        description="国产高性能推理引擎，支持多模态模型，TurboMind 后端",
        health_check_path="/v1/models",
        api_base_path="/v1",
        supports_gguf=False,
        supports_safetensors=True,
    ),
    EngineType.SGLANG: EngineConfig(
        name="sglang",
        label="SGLang",
        docker_image=settings.apply_mirror(settings.SGLANG_IMAGE),
        description="清华出品，灵活调度，支持多模态，快速发展中",
        health_check_path="/health",
        api_base_path="/v1",
        supports_gguf=False,
        supports_safetensors=True,
    ),
    EngineType.TGI: EngineConfig(
        name="tgi",
        label="TGI",
        docker_image=settings.apply_mirror(settings.TGI_IMAGE),
        description="HuggingFace 官方引擎，兼容性最好，支持模型最广",
        health_check_path="/health",
        api_base_path="/v1",
        supports_gguf=False,
        supports_safetensors=True,
    ),
    EngineType.OLLAMA: EngineConfig(
        name="ollama",
        label="Ollama",
        docker_image=settings.apply_mirror(settings.OLLAMA_IMAGE),
        description="最简部署，适合桌面/边缘设备，一键运行",
        health_check_path="/api/tags",
        api_base_path="/v1",
        supports_gguf=True,
        supports_safetensors=False,
        default_entrypoint=["ollama", "serve"],
    ),
}


# ==================== 引擎接口 ====================


def get_engine_config(engine_type: str, custom_image: Optional[str] = None) -> EngineConfig:
    """获取引擎配置，支持自定义引擎"""
    try:
        etype = EngineType(engine_type)
    except ValueError:
        etype = EngineType.CUSTOM

    if etype == EngineType.CUSTOM:
        if not custom_image:
            raise ValueError("自定义引擎必须提供 Docker 镜像")
        # 自定义镜像也尝试应用镜像前缀（如果用户没有指定完整 registry）
        mirrored_image = settings.apply_mirror(custom_image)
        return EngineConfig(
            name="custom",
            label=f"自定义 ({custom_image.split('/')[-1].split(':')[0]})",
            docker_image=mirrored_image,
            description="用户自定义推理引擎",
            health_check_path="/health",
            api_base_path="/v1",
            supports_gguf=True,
            supports_safetensors=True,
        )

    return _BUILTIN_ENGINES[etype]


def list_engines() -> list[dict]:
    """列出所有内置引擎"""
    engines = [
        {
            "type": etype.value,
            "label": cfg.label,
            "image": cfg.docker_image,
            "description": cfg.description,
            "supports_gguf": cfg.supports_gguf,
            "supports_safetensors": cfg.supports_safetensors,
        }
        for etype, cfg in _BUILTIN_ENGINES.items()
    ]
    # 添加自定义引擎
    engines.append({
        "type": "custom",
        "label": "自定义",
        "image": "",
        "description": "用户自定义推理引擎，可指定任意 Docker 镜像和启动命令",
        "supports_gguf": True,
        "supports_safetensors": True,
    })
    return engines


def build_engine_command(
    engine_type: str,
    model_path: str,
    deploy_params: dict,
    engine_config: EngineConfig,
    custom_entrypoint: Optional[list[str]] = None,
) -> list[str]:
    """
    根据引擎类型构建容器启动命令
    """
    if custom_entrypoint:
        return custom_entrypoint

    gpu_memory_util = deploy_params.get("gpu_memory_utilization", 0.4)
    max_model_len = deploy_params.get("max_model_len", 4096)
    tensor_parallel_size = deploy_params.get("tensor_parallel_size", 1)
    dtype = deploy_params.get("dtype", "auto")

    # 根据引擎类型构建命令
    if engine_type == EngineType.VLLM.value:
        cmd = [
            "--model", model_path,
            "--served-model-name", model_path.split("/")[-1],
            "--host", "0.0.0.0",
            "--port", "8000",
            "--gpu-memory-utilization", str(gpu_memory_util),
            "--max-model-len", str(max_model_len),
            "--tensor-parallel-size", str(tensor_parallel_size),
            "--dtype", dtype,
            "--trust-remote-code",
            "--enforce-eager",
        ]
        if model_path.endswith(".gguf"):
            cmd.extend(["--quantization", "gguf"])
        return cmd

    elif engine_type == EngineType.LM_DEPLOY.value:
        return [
            "lmdeploy", "serve", "api_server",
            model_path,
            "--server-port", "8000",
            "--tp", str(tensor_parallel_size),
            "--mem-fraction", str(gpu_memory_util),
            "--dtype", dtype,
        ]

    elif engine_type == EngineType.SGLANG.value:
        return [
            "python3", "-m", "sglang.serve.server",
            "--model-path", model_path,
            "--host", "0.0.0.0",
            "--port", "8000",
            "--tp", str(tensor_parallel_size),
            "--mem-fraction-static", str(gpu_memory_util),
            "--trust-remote-code",
        ]

    elif engine_type == EngineType.TGI.value:
        return [
            "--model-id", model_path,
            "--hostname", "0.0.0.0",
            "--port", "8000",
            "--max-total-tokens", str(max_model_len),
            "--dtype", dtype,
            "--trust-remote-code",
        ]

    elif engine_type == EngineType.TENSORRT_LLM.value:
        return [
            "trtllm", "serve",
            model_path,
            "--host", "0.0.0.0",
            "--port", "8000",
        ]

    elif engine_type == EngineType.OLLAMA.value:
        if engine_config.default_entrypoint:
            return engine_config.default_entrypoint
        return ["ollama", "serve"]

    else:
        # 自定义引擎：无默认命令，交给用户指定
        return []


def get_health_check_url(engine_type: str, engine_config: EngineConfig, port: int) -> str:
    """获取健康检查 URL"""
    if engine_type == EngineType.VLLM.value:
        # vLLM v0.26.0+ 没有 /health 端点，使用 /v1/models 代替
        return f"http://127.0.0.1:{port}/v1/models"
    elif engine_type == EngineType.TENSORRT_LLM.value:
        return f"http://127.0.0.1:{port}/v1/health"
    elif engine_type == EngineType.LM_DEPLOY.value:
        return f"http://127.0.0.1:{port}/v1/models"
    elif engine_type == EngineType.SGLANG.value:
        return f"http://127.0.0.1:{port}/health"
    elif engine_type == EngineType.TGI.value:
        return f"http://127.0.0.1:{port}/health"
    elif engine_type == EngineType.OLLAMA.value:
        return f"http://127.0.0.1:{port}/api/tags"
    else:
        return f"http://127.0.0.1:{port}{engine_config.health_check_path}"
"""
应用主入口
- 创建 FastAPI 应用
- 注册路由
- 配置中间件（限流、审计、CORS）
- 启动事件（数据库初始化、定时任务）
"""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.core.logging import setup_logging, logger
from app.database import init_db
from app.api import (
    admin_routes,
    upload_routes,
    deploy_routes,
    inference_routes,
    resource_routes,
)


# ==================== 限流中间件 ====================

class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    简单的内存限流（基于令牌桶）
    生产环境可替换为 Redis 实现
    """

    def __init__(self, app, max_requests: int = 100, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._buckets: dict[str, list[datetime]] = {}

    async def dispatch(self, request: Request, call_next):
        # 跳过健康检查
        if request.url.path in ("/health", "/docs", "/openapi.json", "/redoc"):
            return await call_next(request)

        # 获取客户端 IP（简易限流，租户级限流在路由层处理）
        client_ip = request.client.host if request.client else "unknown"
        now = datetime.now()

        # 清理过期记录
        if client_ip in self._buckets:
            self._buckets[client_ip] = [
                t for t in self._buckets[client_ip]
                if (now - t).seconds < self.window_seconds
            ]
        else:
            self._buckets[client_ip] = []

        # 检查限流
        if len(self._buckets[client_ip]) >= self.max_requests:
            return Response(
                content='{"detail": "请求过于频繁，请稍后再试"}',
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(self.window_seconds)},
            )

        self._buckets[client_ip].append(now)
        return await call_next(request)


# ==================== 审计日志中间件 ====================

class AuditMiddleware(BaseHTTPMiddleware):
    """记录所有请求的访问日志"""

    async def dispatch(self, request: Request, call_next):
        start_time = datetime.now()

        # 处理请求
        response = await call_next(request)

        # 计算耗时
        duration_ms = (datetime.now() - start_time).total_seconds() * 1000

        # 记录访问日志
        logger.info(
            f"{request.method} {request.url.path} | "
            f"status={response.status_code} | "
            f"duration={duration_ms:.1f}ms | "
            f"ip={request.client.host if request.client else 'unknown'}"
        )

        return response


# ==================== 应用生命周期 ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动
    setup_logging()
    logger.info("=" * 60)
    logger.info("云端硬件托管·租户自助模型部署平台 启动中...")
    logger.info(f"监听地址: {settings.APP_HOST}:{settings.APP_PORT}")
    logger.info(f"调试模式: {settings.APP_DEBUG}")
    logger.info(f"存储根目录: {settings.STORAGE_ROOT}")
    logger.info(f"vLLM 镜像: {settings.VLLM_IMAGE}")
    logger.info("=" * 60)

    # 初始化数据库
    await init_db()
    logger.info("数据库初始化完成")

    # 启动定时任务（闲置服务休眠检查）
    async def idle_check_loop():
        while True:
            await asyncio.sleep(300)  # 每 5 分钟检查一次
            try:
                from app.database import async_session_factory
                from app.services.resource_service import sleep_idle_services

                async with async_session_factory() as db:
                    await sleep_idle_services(db)
                    await db.commit()
            except Exception as e:
                logger.error(f"闲置检查任务异常: {e}")

    idle_task = asyncio.create_task(idle_check_loop())
    logger.info("定时任务已启动（闲置服务休眠检查）")

    yield

    # 关闭
    idle_task.cancel()
    logger.info("平台已关闭")


# ==================== 创建应用 ====================

app = FastAPI(
    title="云端硬件托管·租户自助模型部署平台",
    description="""
    ## 云厂商模式 GPU 算力托管平台

    对标火山引擎、阿里云 GPU 托管服务模式。

    ### 核心能力
    - **自主模型上传**：分片上传、断点续传、格式校验
    - **自主模型部署**：一键部署、自动容器调度、GPU 分配
    - **自主服务管理**：启停、查询、调试
    - **标准推理接口**：OpenAI 兼容 API

    ### 鉴权方式
    所有租户接口使用 `Authorization: Bearer <token>` 鉴权。
    """,
    version="1.0.0",
    lifespan=lifespan,
)

# 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuditMiddleware)
app.add_middleware(
    RateLimitMiddleware,
    max_requests=settings.GATEWAY_RATE_LIMIT,
    window_seconds=60,
)

# 注册路由
app.include_router(admin_routes.router)
app.include_router(upload_routes.router)
app.include_router(deploy_routes.router)
app.include_router(inference_routes.router)
app.include_router(resource_routes.router)


# 健康检查
@app.get("/health", tags=["系统"], summary="健康检查")
async def health_check():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.get("/", tags=["系统"], summary="系统信息")
async def root():
    return {
        "name": "云端硬件托管·租户自助模型部署平台",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=settings.APP_DEBUG,
    )

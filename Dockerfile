# ===============================================
# 阶段一：构建前端
# ===============================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/web

# 利用 Docker 缓存层：先复制依赖定义文件
COPY web/package.json web/package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com

# 复制前端源码并构建
COPY web/ ./
RUN npm run build

# ===============================================
# 阶段二：运行后端（精简生产镜像）
# ===============================================
FROM python:3.11-slim

LABEL maintainer="GPU Cloud Platform"
LABEL description="云端硬件托管·租户自助模型部署平台"

WORKDIR /app

# 系统依赖（用于 Docker SDK、python-magic 等）
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc \
        libmagic1 \
        && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖（利用 pip 缓存）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 复制后端代码
COPY app/ ./app/

# 复制构建好的前端产物
COPY --from=frontend-builder /app/web/dist ./web/dist

# 创建数据与日志目录
RUN mkdir -p /app/data /app/logs /data/models

# 生产环境默认配置（可通过环境变量覆盖）
ENV APP_HOST=0.0.0.0
ENV APP_PORT=8000
ENV APP_DEBUG=false
ENV JWT_SECRET_KEY=change-me-in-production
ENV DATABASE_URL=sqlite+aiosqlite:///./data/gpu_cloud.db
ENV STORAGE_ROOT=/data/models
ENV LOG_DIR=./logs
ENV IMAGE_MIRROR_PREFIX=

EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# 启动命令
CMD ["python", "-m", "app.main"]

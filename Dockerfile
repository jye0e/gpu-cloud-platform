# ===============================================
# 阶段一：构建前端
# ===============================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

# ===============================================
# 阶段二：运行后端
# ===============================================
FROM python:3.11-slim

WORKDIR /app

# 系统依赖（用于 Docker SDK 和文件处理）
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制后端代码
COPY app/ ./app/

# 复制构建好的前端
COPY --from=frontend-builder /app/web/dist ./web/dist

# 创建数据目录
RUN mkdir -p /app/data /app/logs

# 环境变量（默认生产配置）
ENV APP_HOST=0.0.0.0
ENV APP_PORT=8000
ENV APP_DEBUG=false
ENV JWT_SECRET_KEY=change-me-in-production
ENV DATABASE_URL=sqlite+aiosqlite:///./data/gpu_cloud.db
ENV STORAGE_ROOT=/data/models
ENV LOG_DIR=./logs

EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["python", "-m", "app.main"]
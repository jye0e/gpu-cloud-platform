#!/bin/bash
# ============================================
# 平台启动脚本
# ============================================

set -e

echo "========================================"
echo "  云端硬件托管·租户自助模型部署平台"
echo "========================================"

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] 未找到 Python3，请先安装"
    exit 1
fi

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "[ERROR] 未找到 Docker，请先安装"
    exit 1
fi

# 检查 nvidia-smi
if ! command -v nvidia-smi &> /dev/null; then
    echo "[WARNING] 未找到 nvidia-smi，GPU 功能将不可用"
fi

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "[INFO] 未找到 .env 文件，从模板创建"
    cp .env.example .env
    echo "[WARNING] 请编辑 .env 文件修改配置后重新启动"
    echo "[INFO] 特别注意修改 JWT_SECRET_KEY"
fi

# 创建虚拟环境（如果不存在）
if [ ! -d "venv" ]; then
    echo "[INFO] 创建虚拟环境..."
    python3 -m venv venv
fi

# 激活虚拟环境
source venv/bin/activate

# 安装依赖
echo "[INFO] 检查依赖..."
pip install -r requirements.txt -q

# 创建必要目录
mkdir -p data logs

# 启动服务
echo "[INFO] 启动服务..."
echo "[INFO] API 文档: http://0.0.0.0:8000/docs"
echo "[INFO] 健康检查: http://0.0.0.0:8000/health"
echo "========================================"

uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 1

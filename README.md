# GPU 算力托管平台

对标火山引擎、阿里云 GPU 托管服务模式，提供纯硬件算力资源托管，租户可完全自主完成模型上传、部署、推理调用。

## 快速部署

### 方案一：Docker 部署（推荐）

#### 1. 前置条件

```bash
# 必选：NVIDIA GPU + NVIDIA 驱动 + NVIDIA Container Toolkit
nvidia-smi              # 验证 GPU 驱动
docker --version        # 验证 Docker
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi  # 验证 GPU 容器支持
```

#### 2. 克隆项目

```bash
git clone https://github.com/jye0e/gpu-cloud-platform.git
cd gpu-cloud-platform
```

#### 3. 配置环境变量

```bash
cp .env.example .env
# 修改 .env 中的 JWT_SECRET_KEY（生产环境必须！）
# 其他配置按需修改
```

#### 4. 构建并启动

```bash
# 构建镜像并启动
docker compose up -d --build

# 查看日志
docker compose logs -f

# 查看服务状态
docker compose ps
```

#### 5. 访问

| 地址 | 说明 |
|------|------|
| `http://<服务器IP>:8000/` | Web 管控台 |
| `http://<服务器IP>:8000/docs` | API 文档（Swagger） |
| `http://<服务器IP>:8000/health` | 健康检查 |

---

### 方案二：使用预构建镜像

```bash
# 1. 拉取镜像（如果已推送到镜像仓库）
docker pull <registry>/gpu-cloud-platform:latest

# 2. 修改 docker-compose.yml 中的 image 字段为拉取的镜像
# 3. 挂载数据目录并启动
docker compose up -d

# 或者直接 docker run
docker run -d \
  --name gpu-cloud-platform \
  --gpus all \
  -p 8000:8000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ./data:/app/data \
  -v ./logs:/app/logs \
  -v ./data/models:/data/models \
  -e JWT_SECRET_KEY=your-secret-key \
  <registry>/gpu-cloud-platform:latest
```

---

### 方案三：直接部署（无 Docker 环境）

```bash
# 1. 安装 Python 3.11+ 和 Node.js 20+
python3 --version
node --version

# 2. 克隆代码
git clone https://github.com/jye0e/gpu-cloud-platform.git
cd gpu-cloud-platform

# 3. 配置环境
cp .env.example .env

# 4. 安装后端依赖
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 5. 构建前端
cd web
npm install
npm run build
cd ..

# 6. 启动服务
python -m app.main

# 7. 访问 http://<服务器IP>:8000/
```

---

## 登录

### 租户登录

在 Web 界面选择「租户登录」，使用管理员分配的 API Key：

```
# API Key 由管理员创建租户时自动生成
# 格式：sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 管理端登录

在 Web 界面切换到「管理端」，使用管理端 Token：

```bash
# 创建租户等管理操作使用此 Token
# 默认值（请修改 .env 中的 JWT_SECRET_KEY）
admin-secret-token-change-in-production
```

## 配置说明

### 核心配置项（.env）

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `JWT_SECRET_KEY` | change-me | **生产环境必须修改** |
| `APP_PORT` | 8000 | 服务端口 |
| `DATABASE_URL` | SQLite | 数据库连接，可切换 PostgreSQL |
| `STORAGE_ROOT` | /data/models | 模型存储根目录 |
| `IMAGE_MIRROR_PREFIX` | 空 | 国内镜像源前缀（加速拉取） |
| `GPU_MEMORY_RESERVE_MB` | 2048 | 系统预留显存(MB) |
| `IDLE_TIMEOUT_MINUTES` | 30 | 闲置服务自动休眠时间 |
| `GATEWAY_RATE_LIMIT` | 100 | 全局 QPS 上限 |

### 推理引擎镜像

| 引擎 | 配置项 | 默认镜像 |
|------|--------|----------|
| vLLM | `VLLM_IMAGE` | vllm/vllm-openai:latest |
| TensorRT-LLM | `TENSORRT_LLM_IMAGE` | nvcr.io/nvidia/tensorrt-llm:latest |
| LMDeploy | `LM_DEPLOY_IMAGE` | openmmlab/lmdeploy:latest |
| SGLang | `SGLANG_IMAGE` | lmsysorg/sglang:latest |
| TGI | `TGI_IMAGE` | ghcr.io/huggingface/text-generation-inference:latest |
| Ollama | `OLLAMA_IMAGE` | ollama/ollama:latest |

### 国内镜像源（加速拉取）

如果服务器在国内，建议在 `.env` 中设置镜像源前缀：

```bash
# 使用 DaoCloud 代理
IMAGE_MIRROR_PREFIX=m.daocloud.io/docker.io/

# 或使用阿里云代理
# IMAGE_MIRROR_PREFIX=registry.cn-hangzhou.aliyuncs.com/
```

平台会自动为所有推理引擎镜像添加此前缀，无需手动修改。

## 使用流程

### 1. 创建租户

```bash
curl -X POST http://localhost:8000/admin/tenants \
  -H "X-Admin-Token: <管理端Token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试租户A",
    "gpu_memory_util": 0.4,
    "max_model_len": 4096,
    "storage_quota_gb": 50,
    "qps_limit": 10
  }'
# 返回: tenant_id, api_key, access_token
```

### 2. 上传模型

```bash
TOKEN="<返回的 API Key>"

# 初始化上传
curl -X POST http://localhost:8000/api/tenant/upload_model/init \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model_name": "my-model.safetensors", "total_size": 5000000000, "chunk_size": 10485760}'

# 上传分片（循环）
curl -X POST "http://localhost:8000/api/tenant/upload_model/chunk?task_id=xxx&chunk_index=0" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@chunk_0.bin"

# 完成上传
curl -X POST "http://localhost:8000/api/tenant/upload_model/complete?task_id=xxx" \
  -H "Authorization: Bearer $TOKEN"
```

### 3. 部署模型

```bash
curl -X POST http://localhost:8000/api/tenant/deploy \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model_id": 1,
    "service_name": "my-llm-service",
    "engine_type": "vllm",
    "deploy_params": {
      "gpu_memory_utilization": 0.4,
      "max_model_len": 4096,
      "dtype": "auto"
    }
  }'
```

### 4. 调用推理

```bash
# 流式对话
curl -N -X POST http://localhost:8000/api/tenant/inference/my-llm-service/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-model",
    "messages": [{"role": "user", "content": "你好"}],
    "max_tokens": 100,
    "stream": true
  }'
```

### 5. 服务管理

```bash
# 查看服务列表
curl http://localhost:8000/api/tenant/service_info -H "Authorization: Bearer $TOKEN"

# 停止/启动/删除
curl -X POST http://localhost:8000/api/tenant/service_operate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "stop", "service_id": 1}'
```

## API 接口

### 管理端

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/admin/tenants` | 创建租户 |
| GET | `/admin/tenants` | 查看所有租户 |
| GET | `/admin/tenants/{id}` | 查看租户详情 |
| PATCH | `/admin/tenants/{id}/status` | 修改租户状态 |
| GET | `/admin/gpu/overview` | 查看整机 GPU 资源 |

### 租户端

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/tenant/upload_model/init` | 初始化分片上传 |
| POST | `/api/tenant/upload_model/chunk` | 上传分片 |
| POST | `/api/tenant/upload_model/complete` | 完成上传 |
| GET | `/api/tenant/models` | 查看已上传模型 |
| POST | `/api/tenant/deploy` | 一键部署模型 |
| GET | `/api/tenant/service_info` | 查看服务列表 |
| POST | `/api/tenant/service_operate` | 启停/删除服务 |
| ANY | `/api/tenant/inference/{service}/v1/*` | OpenAI 兼容推理 |

## 项目结构

```
gpu-cloud-platform/
├── app/                    # 后端（FastAPI）
│   ├── main.py            # 应用入口
│   ├── config.py          # 配置管理
│   ├── database.py        # 数据库
│   ├── models.py          # 数据模型
│   ├── api/               # 路由层
│   ├── core/              # 鉴权/日志
│   └── services/          # 业务逻辑
├── web/                    # 前端（React 19 + Vite + Tailwind）
├── Dockerfile              # Docker 多阶段构建
├── docker-compose.yml      # Docker Compose 编排
├── .env.example            # 环境变量模板
├── requirements.txt        # Python 依赖
└── README.md
```

## Web 管控台

| 页面 | 路径 | 说明 |
|------|------|------|
| 登录 | `/login` | 租户 API Key / 管理端 Token |
| 仪表盘 | `/dashboard` | 资源概况、服务状态 |
| 模型上传 | `/upload` | 分片上传、进度展示 |
| 模型部署 | `/deploy` | 选择引擎、一键部署 |
| 服务管理 | `/services` | 启停、日志查看、API 示例 |
| 推理测试 | `/inference` | 流式对话测试 |
| 资源管理 | `/resources` | 存储、GPU 配置、配额 |

## 安全机制

- **权限隔离**：租户无 SSH/Docker 权限，仅通过 API 操作
- **存储隔离**：每租户独立存储目录，互不可见
- **双重鉴权**：JWT Token + API Key
- **文件校验**：仅允许 safetensors/gguf/bin/pt/pth 格式
- **资源配额**：GPU 显存、存储、QPS 三重限制
- **闲置休眠**：超时 30 分钟自动停止服务（可配置）
- **全链路审计**：所有操作可追溯

## 生产部署建议

1. **修改 JWT_SECRET_KEY**：使用 `openssl rand -hex 32` 生成强密钥
2. **切换 PostgreSQL**：修改 `DATABASE_URL`
3. **配置 Nginx**：HTTPS 反向代理
4. **配置 systemd**：开机自启、崩溃重启
5. **定期备份**：数据库 + 模型文件

```bash
# 生成密钥
openssl rand -hex 32

# 备份数据
docker compose exec gpu-cloud-platform cp /app/data/gpu_cloud.db /app/data/backup_$(date +%Y%m%d).db
```

## 常见问题

### Q: 服务启动后无法访问？

```bash
# 检查端口占用
lsof -i :8000

# 查看服务日志
docker compose logs gpu-cloud-platform

# 验证健康检查
curl http://localhost:8000/health
```

### Q: 推理引擎镜像拉取失败？

```bash
# 设置国内镜像源
# 在 .env 中添加:
IMAGE_MIRROR_PREFIX=m.daocloud.io/docker.io/

# 重启服务
docker compose up -d
```

### Q: GPU 不可用？

```bash
# 检查 NVIDIA 驱动
nvidia-smi

# 检查容器 GPU 支持
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

### Q: 如何切换端口？

```bash
# 修改 .env
APP_PORT=9000

# 或 docker compose 直接指定
docker compose -e APP_PORT=9000 up -d
```

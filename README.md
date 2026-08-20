# 云端硬件托管·租户自助模型部署平台

对标火山引擎、阿里云 GPU 托管服务模式，提供纯硬件算力资源托管，租户可完全自主完成模型上传、部署、推理调用。

## 技术栈

- **后端框架**：FastAPI + Uvicorn
- **数据库**：SQLite（开发）/ PostgreSQL（生产可切换）
- **容器引擎**：Docker + Docker SDK for Python
- **推理引擎**：vLLM（默认） / TensorRT-LLM / LMDeploy / SGLang / TGI / Ollama / 自定义引擎
- **GPU 管理**：nvidia-docker / NVIDIA Container Toolkit
- **容器化部署**：Docker Compose（项目本身）

## 项目结构

```
gpu-cloud-platform/
├── app/
│   ├── __init__.py
│   ├── main.py              # 应用主入口
│   ├── config.py             # 全局配置
│   ├── database.py           # 数据库连接
│   ├── models.py             # ORM 数据模型
│   ├── api/
│   │   ├── __init__.py
│   │   ├── schemas.py        # Pydantic 请求/响应模型
│   │   ├── auth_routes.py    # 租户登录接口
│   │   ├── admin_routes.py   # 管理端路由（创建租户等）
│   │   ├── upload_routes.py  # 模型上传路由
│   │   ├── deploy_routes.py  # 部署与服务管理路由
│   │   ├── inference_routes.py # 推理代理路由
│   │   └── resource_routes.py  # 资源查询路由
│   ├── core/
│   │   ├── __init__.py
│   │   ├── auth.py           # 鉴权与权限隔离
│   │   └── logging.py        # 日志与审计
│   └── services/
│       ├── __init__.py
│       ├── upload_service.py     # 模型上传服务
│       ├── docker_service.py     # Docker 容器管理
│       ├── resource_service.py   # 资源管控
│       ├── inference_service.py  # 推理代理
│       └── engine_registry.py    # 推理引擎注册表
├── web/                      # 前端（React 19 + Vite + Tailwind）
├── Dockerfile                # Docker 多阶段构建
├── docker-compose.yml        # Docker Compose 一键部署
├── .dockerignore
├── requirements.txt
├── .env.example
├── .gitignore
└── README.md
```

## 快速部署

### 方式一：Docker 部署（推荐）

项目已提供 Docker 多阶段构建，一键启动：

```bash
# 1. 克隆代码
git clone https://github.com/jye0e/gpu-cloud-platform.git
cd gpu-cloud-platform

# 2. 构建并启动（需要 NVIDIA GPU + Docker + NVIDIA Container Toolkit）
docker compose up -d --build

# 3. 查看日志
docker compose logs -f

# 4. 访问
#    Web 界面: http://<服务器IP>:8000/
#    API 文档: http://<服务器IP>:8000/docs
```

> **注意**：Docker 部署需要服务器已安装 NVIDIA 驱动及 NVIDIA Container Toolkit。
> 请确保 `nvidia-smi` 可正常运行。

### 方式二：直接部署

```bash
# 1. 克隆代码
git clone <your-github-repo-url>
cd gpu-cloud-platform

# 2. 安装依赖
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. 配置环境
cp .env.example .env
# 编辑 .env 文件，修改以下关键配置：
# - JWT_SECRET_KEY    生产环境必须修改
# - STORAGE_ROOT      模型存储路径（确保磁盘空间充足）
# - GPU_MEMORY_RESERVE_MB  为自有业务预留的显存

# 4. 构建前端
cd web
npm install
npm run build
cd ..

# 5. 启动服务
python -m app.main

# 6. 访问
#    Web 界面: http://<服务器IP>:8000/
#    API 文档: http://<服务器IP>:8000/docs
```

## 使用流程

### 管理端操作

```bash
# 1. 创建租户
curl -X POST http://localhost:8000/admin/tenants \
  -H "X-Admin-Token: admin-secret-token-change-in-production" \
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

### 租户操作

```bash
# 设置租户 Token
TOKEN="返回的 access_token"

# 1. 初始化上传
curl -X POST http://localhost:8000/api/tenant/upload_model/init \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model_name": "my-model.safetensors",
    "total_size": 5000000000,
    "chunk_size": 10485760
  }'

# 2. 上传分片（循环上传所有分片）
curl -X POST "http://localhost:8000/api/tenant/upload_model/chunk?task_id=xxx&chunk_index=0" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@chunk_0.bin"

# 3. 完成上传
curl -X POST "http://localhost:8000/api/tenant/upload_model/complete?task_id=xxx" \
  -H "Authorization: Bearer $TOKEN"

# 4. 部署模型（支持选择推理引擎）
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

# 可用引擎类型: vllm, tensorrt_llm, lmdeploy, sglang, tgi, ollama, custom

# 5. 调用推理（OpenAI 兼容接口）
curl -X POST http://localhost:8000/api/tenant/inference/my-llm-service/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-model",
    "messages": [
      {"role": "user", "content": "你好"}
    ],
    "max_tokens": 100
  }'

# 6. 查看服务状态
curl http://localhost:8000/api/tenant/service_info \
  -H "Authorization: Bearer $TOKEN"

# 7. 停止服务
curl -X POST http://localhost:8000/api/tenant/service_operate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "stop", "service_id": 1}'
```

## API 接口概览

### 管理端
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/admin/tenants` | 创建租户 |
| GET | `/admin/tenants` | 查看所有租户 |
| GET | `/admin/tenants/{id}` | 查看租户详情 |
| PATCH | `/admin/tenants/{id}/status` | 修改租户状态 |
| GET | `/admin/gpu/overview` | 查看整机GPU资源 |

### 租户端 - 模型上传
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/tenant/upload_model/init` | 初始化分片上传 |
| POST | `/api/tenant/upload_model/chunk` | 上传分片 |
| POST | `/api/tenant/upload_model/complete` | 完成上传 |
| GET | `/api/tenant/upload_model/status` | 查询上传状态 |
| DELETE | `/api/tenant/upload_model/cancel` | 取消上传 |

### 租户端 - 部署与服务管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tenant/models` | 查看已上传模型 |
| POST | `/api/tenant/deploy` | 一键部署模型 |
| GET | `/api/tenant/service_info` | 查看服务列表 |
| GET | `/api/tenant/service_info/{id}` | 查看服务详情 |
| POST | `/api/tenant/service_operate` | 启停/删除服务 |
| GET | `/api/tenant/service_logs/{id}` | 查看服务日志 |

### 租户端 - 推理调用
| 方法 | 路径 | 说明 |
|------|------|------|
| ANY | `/api/tenant/inference/{service_name}/v1/*` | OpenAI 兼容接口代理 |

### 租户端 - 资源管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tenant/resource_overview` | 查看资源概况 |

## 安全设计

- **权限隔离**：租户无 SSH/Docker/系统操作权限，仅通过 API 操作
- **存储隔离**：每个租户独立存储目录，互不可见
- **Token 鉴权**：JWT Token + API Key 双重验证
- **文件校验**：仅允许 safetensors/gguf/bin/pt/pth 格式
- **资源配额**：GPU 显存、存储、QPS 三重限制
- **闲置休眠**：超时未使用的服务自动停止
- **全链路审计**：所有操作记录可追溯

## Web 管控台

平台提供完整的 Web 界面，对标公有云控制台体验。

### 技术栈
- React 19 + Vite + Tailwind CSS
- React Router（BrowserRouter 模式，URL 不带 #）

### 页面概览

| 页面 | 路径 | 说明 |
|------|------|------|
| 登录 | `/login` | 租户 API Key / 管理端 Token 登录 |
| 概览仪表盘 | `/dashboard` | 资源概况、服务状态、快速操作 |
| 模型上传 | `/upload` | 分片上传、进度展示、断点续传 |
| 模型部署 | `/deploy` | 选择模型、选择引擎、配置参数、一键部署 |
| 服务管理 | `/services` | 服务列表、启停/重启/删除、日志查看 |
| 推理测试 | `/inference` | 在线对话测试（OpenAI 兼容） |
| 资源管理 | `/resources` | 存储用量、GPU 配置、配额信息 |
| 管理端 | `/admin` | 创建租户、GPU 概览、租户状态管理 |

### 前端开发

```bash
cd web
npm install
npm run dev    # 开发模式，端口 5173，自动代理 API 到 8000
npm run build  # 构建到 web/dist/，由 FastAPI 自动托管
```

### 部署流程

**方式一：Docker 部署（推荐）**
```bash
docker compose up -d --build
```

**方式二：手动部署**
1. 在开发机或服务器上构建前端：`cd web && npm install && npm run build`
2. 启动后端：`python -m app.main`
3. 访问 `http://<服务器IP>:8000/` 即可看到 Web 界面（自动加载 `web/dist`）
4. 开发时可用 `npm run dev` 单独启动前端，API 请求会自动代理到后端

## 生产部署建议

1. **使用 PostgreSQL 替代 SQLite**：修改 `.env` 中的 `DATABASE_URL`
2. **使用 Nginx 反向代理**：处理 HTTPS、负载均衡
3. **使用 Redis 实现限流**：替换内存限流中间件
4. **配置 systemd 服务**：实现开机自启和崩溃重启
5. **修改管理端 Token**：`ADMIN_TOKEN` 必须更换为强随机值
6. **定期备份**：数据库和模型存储定期备份

## 登录方式

### 方式一：租户登录（推荐，可以看到完整管控台）

在登录页选择「租户登录」，输入以下 API Key：
```
sk_1683601c8ac505c56c7542df3443683d
```

> API Key 由管理员创建租户时分配，**永久有效**，可直接用于所有租户接口的访问，无需额外换取 Token。

### 方式二：管理端登录

在登录页切换到「管理端」，输入管理端 Token：
```
admin-secret-token-change-in-production
```

> 管理端 Token 用于创建租户、管理资源等操作，同样**永久有效**。
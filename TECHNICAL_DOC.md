# GPU 算力托管平台 技术文档

提供纯硬件算力资源托管，租户可完全自主完成模型上传、部署、推理调用。

---

## 1. 系统概述

### 1.1 核心能力

| 能力 | 说明 |
|------|------|
| 自主模型上传 | 分片上传（默认 10MB/片）、断点续传、SHA256 校验、格式白名单校验 |
| 自主模型部署 | 一键部署，自动 GPU 调度、端口分配、容器创建、健康检查 |
| 多引擎支持 | vLLM / TensorRT-LLM / LMDeploy / SGLang / TGI / Ollama / 自定义镜像 |
| 统一推理网关 | OpenAI 兼容 API 代理，支持 SSE 流式，自动修正 model 字段 |
| 多租户隔离 | 存储目录隔离、容器命名隔离、配额限制（显存/存储/QPS） |
| 资源管控 | GPU 智能调度、闲置服务自动休眠、租户级资源配额 |

### 1.2 总体架构

```
┌─────────────────────────────────────────────────────┐
│                  Web 管控台 (React 19)                │
│   Login / Dashboard / Upload / Deploy / Services     │
│        Resources / Inference / AdminPage             │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP (Bearer Token / X-Admin-Token)
┌──────────────────────▼──────────────────────────────┐
│              FastAPI 后端 (app/main.py)               │
│  ┌────────────┐ ┌────────────┐ ┌─────────────────┐  │
│  │ 限流中间件  │ │ 审计中间件  │ │   CORS 中间件    │  │
│  └────────────┘ └────────────┘ └─────────────────┘  │
│  ┌──────────────────────────────────────────────┐   │
│  │  API 路由层: admin / auth / upload / deploy   │   │
│  │              inference / resource             │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │  服务层: upload / deploy(docker) / inference  │   │
│  │          resource / engine_registry           │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │ SQLite(异步) │  │ 核心层: JWT 鉴权 / loguru 日志│  │
│  └──────────────┘  └─────────────────────────────┘  │
└───────┬──────────────────────────┬──────────────────┘
        │ Docker SDK               │ httpx 反向代理
        ▼                          ▼
┌──────────────────┐    ┌─────────────────────────────┐
│  Docker Engine   │    │  推理引擎容器 (每服务一个)      │
│  (docker.sock)   │    │  vLLM 等, 监听容器内 :8000     │
│  GPU 调度 (nvidia│    │  宿主机端口 28000-29000 映射    │
│  -smi)           │    └─────────────────────────────┘
└──────────────────┘
```

### 1.3 技术栈

**后端**
- Web 框架：FastAPI 0.111 + Uvicorn（全异步）
- ORM：SQLAlchemy 2.0（异步）+ aiosqlite，预留 Alembic 迁移
- 鉴权：PyJWT（HS256）+ API Key 双模式
- 容器编排：docker SDK for Python 7.1（挂载 docker.sock）
- HTTP 代理：httpx 0.27（支持流式转发）
- 日志：loguru（按日轮转 + 错误分离）
- 配置：pydantic-settings（.env 加载）

**前端**
- React 19 + React Router 7 + Vite 8
- Tailwind CSS 3 + lucide-react 图标
- Lint：oxlint

**基础设施**
- NVIDIA GPU + NVIDIA Container Toolkit
- Docker Compose 单机编排

---

## 2. 项目结构

```
gpu-cloud-platform/
├── app/                        # 后端（FastAPI）
│   ├── main.py                 # 应用入口：中间件、生命周期、SPA 托管
│   ├── config.py               # 配置管理（pydantic-settings + 镜像加速逻辑）
│   ├── database.py             # 异步引擎、Session 工厂、初始化种子数据
│   ├── models.py               # 5 张核心表的 ORM 定义
│   ├── api/                    # 路由层
│   │   ├── admin_routes.py     # 管理端：租户 CRUD、GPU 概览（X-Admin-Token 鉴权）
│   │   ├── auth_routes.py      # 登录：api_key -> JWT
│   │   ├── upload_routes.py    # 分片上传 5 个端点
│   │   ├── deploy_routes.py    # 引擎列表、模型列表、部署、服务管理
│   │   ├── inference_routes.py # 推理代理（ANY /v1/* 通配）
│   │   ├── resource_routes.py  # 租户资源概况
│   │   └── schemas.py          # Pydantic 请求/响应模型
│   ├── core/
│   │   ├── auth.py             # 双模式鉴权、租户上下文工具
│   │   └── logging.py          # loguru 配置 + 审计日志
│   └── services/               # 业务逻辑层
│       ├── upload_service.py   # 分片上传/合并/配额
│       ├── docker_service.py   # 容器创建、GPU 调度、生命周期
│       ├── engine_registry.py  # 引擎注册表（可扩展设计）
│       ├── inference_service.py# 推理反向代理（普通/SSE 流式）
│       └── resource_service.py # 配额、闲置休眠、GPU 概览
├── web/                        # 前端（React 19 + Vite）
│   └── src/
│       ├── api/client.js       # 统一 API 封装（双 Token 自动切换）
│       ├── pages/              # 9 个页面组件
│       └── components/ui.jsx   # 通用 UI 组件
├── Dockerfile                  # 两阶段构建（node:20-alpine -> python:3.11-slim）
├── docker-compose.yml          # 单机编排（挂载 docker.sock + GPU）
├── .env.example                # 环境变量模板（60+ 配置项）
└── requirements.txt
```

---

## 3. 数据模型

数据库默认 SQLite（`data/gpu_cloud.db`），可通过 `DATABASE_URL` 切换 PostgreSQL。共 5 张表（[models.py](app/models.py)）：

| 表 | 说明 | 关键字段 |
|----|------|----------|
| `tenants` | 租户 | `tenant_id`(tnt_前缀)、`api_key`(sk_前缀)、`token_hash`、状态、配额（`gpu_memory_util`/`max_model_len`/`storage_quota_gb`/`qps_limit`）、`gpu_device_ids` |
| `tenant_models` | 租户模型 | `model_path`、`model_format`、`file_size_bytes`、`file_sha256` |
| `upload_tasks` | 分片上传任务 | `total_chunks`、`uploaded_chunks`、`chunk_size`、`temp_dir`、状态机 |
| `deployed_services` | 推理服务 | `engine_type`、`container_id/name`、`deploy_params`(JSON)、`gpu_device_id`、`vllm_port`/`service_port`、状态机、`last_active_at` |
| `audit_logs` | 审计日志 | `action`、`resource`、`detail`(JSON)、`ip_address`、`status_code` |

**状态机**

- 服务状态：`pending → deploying → running ⇄ stopped / sleeping`，异常进入 `error`
- 上传状态：`uploading → completed / failed / cancelled`

初始化时若数据库为空，会自动创建一个默认租户（[database.py:48](app/database.py#L48)）。

---

## 4. 鉴权体系

采用**双 Token 双端**设计（[core/auth.py](app/core/auth.py)）：

### 4.1 管理端
- 请求头 `X-Admin-Token`，与 `.env` 中 `JWT_SECRET_KEY` 比对（`verify_admin_token`）
- 仅管理端路由 `/admin/*` 使用，用于租户生命周期管理与 GPU 概览

### 4.2 租户端（`get_current_tenant` 依赖注入）
支持两种凭证，自动识别：

1. **API Key 直连**（推荐）：`Authorization: Bearer sk_xxx` → 直接查 `tenants.api_key`
2. **JWT Token**：登录接口 `POST /api/auth/login` 用 api_key 换取 JWT（HS256，默认 7 天有效）→ 解码后校验 `tenant_id + api_key`

两种方式均校验租户状态必须为 `active`。

### 4.3 隔离机制
- 存储：`STORAGE_ROOT/{tenant_id}/models`（`TenantContext.get_tenant_storage_path`）
- 容器：`{tenant_id}_svc_{service.id}` 命名
- 所有查询强制携带 `tenant_id` 条件

---

## 5. 核心流程

### 5.1 模型分片上传

入口：[upload_routes.py](app/api/upload_routes.py) + [upload_service.py](app/services/upload_service.py)

```
init → chunk × N → complete
```

1. **init**：校验扩展名白名单（`.safetensors/.gguf/.bin/.pt/.pth`）→ 检查存储配额 → 计算分片数 → 创建 `temp/{task_id}/` 临时目录与任务记录
2. **chunk**：校验任务状态与分片索引，逐片落盘并更新 `uploaded_chunks`（天然支持断点续传/重传）
3. **complete**：校验分片完整性 → 顺序合并至 `models/{tenant_id}/models/` → 计算 SHA256 → 清理临时目录 → 创建 `TenantModel` 记录

### 5.2 模型部署（核心调度）

入口：[deploy_routes.py](app/api/deploy_routes.py) → [docker_service.py:deploy_service](app/services/docker_service.py#L129)

```
校验配额(check_tenant_can_deploy)
  → 选择 GPU（nvidia-smi 查询空闲显存，减去 GPU_MEMORY_RESERVE_MB，选剩余最多者）
  → find_free_port() 分配宿主机端口（28000-29000）
  → build_engine_command() 按引擎生成启动命令
  → containers.create()：
      - DeviceRequest 绑定指定 GPU
      - 端口映射 8000/tcp → engine_port
      - 模型目录只读挂载（同路径 bind，Ollama 除外）
      - mem_limit / cpu_quota 资源限制
      - vLLM 注入 VLLM_MEMORY_PROFILER_ESTIMATE_CUDAGRAPHS=0
  → start() → 轮询健康检查（每 5s，最多 300s）
  → 成功: status=running；超时: 拉取容器日志排错、销毁容器、status=error
```

**引擎注册表**（[engine_registry.py](app/services/engine_registry.py)）：`EngineConfig` dataclass 描述每个引擎的镜像、健康检查路径、支持的模型格式、默认 entrypoint；`build_engine_command` 为各引擎生成 CLI 参数。**新增引擎只需在注册表加一项**，这是平台可扩展性的核心设计。自定义引擎允许用户传入任意镜像 + entrypoint。

**镜像加速**：`settings.apply_mirror()` 自动为 Docker Hub 镜像添加 `IMAGE_MIRROR_PREFIX` 前缀（已识别 nvcr.io/ghcr.io/quay.io/gcr.io 等 registry 则跳过）。

### 5.3 推理调用（反向代理网关）

入口：[inference_routes.py](app/api/inference_routes.py) → [inference_service.py](app/services/inference_service.py)

- 路由：`ANY /api/tenant/inference/{service_name}/v1/*`，通配转发任意 OpenAI 兼容路径
- 智能分流：解析请求体 `stream:true` → SSE 流式走 `proxy_inference_streaming`（`StreamingResponse` 逐块透传，禁用 Nginx 缓冲），否则走普通代理
- **model 字段自动修正**：租户请求中的 `model` 名自动替换为实际部署的模型文件名（`_fix_model_in_body`），屏蔽内部细节
- Header 过滤：剔除 `host/content-length/authorization` 后转发
- 每次调用刷新 `last_active_at`（供闲置休眠判断）
- 仅 `running` 状态服务可推理，`sleeping` 状态提示先唤醒

### 5.4 闲置休眠

- [main.py](app/main.py) lifespan 启动后台任务，每 5 分钟执行 `sleep_idle_services`
- 超过 `IDLE_TIMEOUT_MINUTES`（默认 30 分钟）未活跃的 running 服务 → 停止容器并标记 `sleeping`（保留配置，可手动重启唤醒）

---

## 6. API 接口清单

### 管理端（`X-Admin-Token`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/admin/tenants` | 创建租户（返回 tenant_id / api_key / access_token） |
| GET | `/admin/tenants` | 租户列表 |
| GET | `/admin/tenants/{id}` | 租户详情 |
| PATCH | `/admin/tenants/{id}/status` | 修改租户状态 |
| PATCH | `/admin/tenants/{id}/quota` | 更新租户配额 |
| GET | `/admin/gpu/overview` | 整机 GPU 资源概览 |

### 租户端（`Bearer sk_xxx` 或 JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | api_key 换 JWT |
| POST | `/api/tenant/upload_model/init` | 初始化分片上传 |
| POST | `/api/tenant/upload_model/chunk` | 上传分片 |
| POST | `/api/tenant/upload_model/complete` | 合并完成 |
| GET | `/api/tenant/upload_model/status` | 上传进度 |
| DELETE | `/api/tenant/upload_model/cancel` | 取消上传 |
| GET | `/api/tenant/models` | 已上传模型列表 |
| GET | `/api/tenant/engines` | 可用推理引擎列表 |
| POST | `/api/tenant/deploy` | 一键部署 |
| GET | `/api/tenant/service_info` | 服务列表 |
| GET | `/api/tenant/service_info/{id}` | 服务详情（含容器实时状态） |
| POST | `/api/tenant/service_operate` | 启动/停止/删除服务 |
| GET | `/api/tenant/service_logs/{id}` | 容器日志 |
| GET | `/api/tenant/resource_overview` | 存储/GPU 配额使用情况 |
| ANY | `/api/tenant/inference/{service}/v1/*` | OpenAI 兼容推理（支持流式） |

### 系统

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/docs` | Swagger UI |
| GET | `/` | 系统信息 |

---

## 7. 前端架构

- **技术栈**：React 19 + React Router 7 + Vite 8 + Tailwind CSS 3
- **构建产物由 FastAPI 直接托管**：`web/dist` 挂载为静态目录，非 API 路径统一回退 `index.html`（SPA 模式，单端口部署）

| 路由 | 页面 | 功能 |
|------|------|------|
| `/login` | Login | 租户 API Key / 管理端 Token 双入口 |
| `/admin` | AdminPage | 租户创建/管理、GPU 概览 |
| `/dashboard` | Dashboard | 资源概况、服务状态 |
| `/upload` | UploadPage | 分片上传、进度展示 |
| `/deploy` | DeployPage | 引擎选择、部署参数配置 |
| `/services` | ServicesPage | 服务启停、日志、API 示例 |
| `/inference` | InferencePage | 流式对话测试（SSE） |
| `/resources` | ResourcesPage | 存储、GPU 配额 |

`api/client.js` 统一封装：按接口前缀自动选择 `X-Admin-Token`（管理端）或 `Authorization: Bearer`（租户端），Token 存于 localStorage；推理封装含非流式与 SSE 流式（`fetch` + ReadableStream）两种实现。

---

## 8. 部署方案

### 8.1 Docker 部署（推荐）

```bash
git clone https://github.com/jye0e/gpu-cloud-platform.git
cd gpu-cloud-platform
cp .env.example .env      # 必须修改 JWT_SECRET_KEY
docker compose up -d --build
```

关键挂载：
- `/var/run/docker.sock` —— 平台容器通过宿主 Docker Daemon 创建推理容器（Docker-in-Docker 代理模式）
- `./data` —— SQLite + 模型文件持久化
- GPU：compose 中 `deploy.resources.reservations.devices` 声明 + `runtime: nvidia`

前置条件：NVIDIA 驱动 + NVIDIA Container Toolkit（`docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi` 验证）。

### 8.2 Dockerfile 要点

两阶段构建：`node:20-alpine` 构建前端 → `python:3.11-slim` 运行后端，内置 HEALTHCHECK（30s 间隔探测 `/health`）。

---

## 9. 安全机制

| 机制 | 实现 |
|------|------|
| 权限隔离 | 租户无 SSH/Docker 权限，仅能通过 API 操作自己名下资源 |
| 双重鉴权 | 管理端 Token 与租户 API Key/JWT 完全独立 |
| 存储隔离 | 每租户独立目录 + 查询强制 tenant_id 过滤 |
| 文件校验 | 扩展名白名单 + SHA256 完整性校验 |
| IP 限流 | 全局内存令牌桶（`GATEWAY_RATE_LIMIT`，默认 100 req/min/IP），租户级 QPS 配额独立控制 |
| 资源配额 | GPU 显存利用率、存储 GB、并发服务数（5）、上下文长度四重限制 |
| 审计日志 | AuditMiddleware 记录全部请求；业务操作写入 audit_logs 表 |
| 闲置回收 | 超时自动休眠释放 GPU |

---

## 10. 已知限制与优化建议

基于代码分析，当前实现存在以下可改进点：

1. **单机架构**：Docker 单节点调度，无跨节点编排能力；扩展需引入 K8s 或多机调度器
2. **限流为进程内存实现**：多实例部署时限流失效，建议替换 Redis（代码中已预留注释）
3. **SQLite 并发写入限制**：高并发场景建议切换 PostgreSQL（改 `DATABASE_URL` 即可）
4. **端口探测存在竞态**：`find_free_port` 绑定后释放、容器创建前端口可能被抢占
5. **健康检查阻塞**：部署请求同步等待最长 300 秒，建议改为异步任务 + 前端轮询
6. **GPU 调度较简单**：仅按当前空闲显存选择，未考虑已分配显存的预约式管理（`MAX_TENANTS_PER_GPU` 配置项尚未在调度中生效）
7. **CORS 全放开**：`allow_origins=["*"]`，生产环境应收敛
8. **推理代理超时 300s**：长生成场景可能不够，可配置化
9. **默认租户 API Key 硬编码**在 `database.py` 种子逻辑中，生产环境应移除

---

## 11. 快速上手（端到端示例）

```bash
# 1. 管理员创建租户
curl -X POST http://localhost:8000/admin/tenants \
  -H "X-Admin-Token: admin-secret-token-change-in-production" \
  -H "Content-Type: application/json" \
  -d '{"name":"测试租户","gpu_memory_util":0.4,"storage_quota_gb":50}'
# → {"tenant_id":"tnt_xxx","api_key":"sk_xxx",...}

# 2. 上传模型（init → chunk 循环 → complete）
curl -X POST http://localhost:8000/api/tenant/upload_model/init \
  -H "Authorization: Bearer sk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"model_name":"Qwen2-7B.safetensors","total_size":15000000000}'

# 3. 部署（选择 vLLM 引擎）
curl -X POST http://localhost:8000/api/tenant/deploy \
  -H "Authorization: Bearer sk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"model_id":1,"service_name":"qwen-svc","engine_type":"vllm",
       "deploy_params":{"gpu_memory_utilization":0.4,"max_model_len":4096}}'

# 4. OpenAI 兼容推理（流式）
curl -N -X POST http://localhost:8000/api/tenant/inference/qwen-svc/v1/chat/completions \
  -H "Authorization: Bearer sk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"any","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

---

## 12. 二进制打包（PyInstaller）

将平台打包为独立可执行文件：**Windows 上产出 `.exe`，Linux 上产出 ELF 可执行文件**（PyInstaller 不支持交叉编译，需在目标平台上分别打包）。

### 12.1 打包文件

| 文件 | 说明 |
|------|------|
| `run.py` | 打包入口。冻结环境下直接传递 `app` 对象给 uvicorn，避免 import string 二次导入模块 |
| `gpu_cloud_platform.spec` | 打包配置（onedir 模式） |

`app/main.py` 中的 `_get_web_dist()` 已做 frozen 兼容：打包后从 `sys._MEIPASS` 解包目录定位 `web/dist`，源码运行仍从项目根目录定位。

### 12.2 打包步骤

```bash
# 1. 安装依赖（含 PyInstaller）
pip install -r requirements.txt pyinstaller

# 2. 构建前端（web/dist 必须存在）
cd web && npm install && npm run build && cd ..

# 3. 打包（Windows / Linux 同一条命令）
pyinstaller gpu_cloud_platform.spec --noconfirm
```

产物（onedir 模式，服务类应用启动快、便于排错）：

```
dist/gpu-cloud-platform/
├── gpu-cloud-platform.exe      # Windows 可执行
├── gpu-cloud-platform          # Linux ELF 可执行
└── _internal/                  # 运行时依赖 + web/dist 静态资源
```

### 12.3 运行方式

```bash
# 在产物目录下运行（data/、logs/、.env 均基于当前工作目录解析）
cd dist/gpu-cloud-platform
./gpu-cloud-platform.exe          # Windows
./gpu-cloud-platform              # Linux

# 自定义端口（环境变量优先级高于 .env）
APP_PORT=9000 ./gpu-cloud-platform
```

`.env` 从**当前工作目录**加载：将其复制到 exe 同级目录，或全部改用环境变量。首次运行会自动在工作目录创建 `data/`（SQLite）与 `logs/`。

### 12.4 spec 关键配置

- **`datas`**：`web/dist` 整体打包进 `_internal/web/dist`
- **`hiddenimports`**：
  - `uvicorn` 全量子模块（运行时动态加载 loops/protocols/lifespan）
  - `aiosqlite` + `sqlalchemy.dialects.sqlite.*`（SQLAlchemy 按字符串动态加载方言）
  - `python_multipart`（分片上传的表单解析，新旧包名均声明）
  - `app` 全量子模块（lifespan 内存在函数级延迟导入）
- **`excludes`**：`alembic`/`passlib`/`slowapi`/`magic`（requirements 中声明但代码未引用，其中 python-magic 依赖系统 libmagic 原生库，剔除可规避部署问题）、`tkinter`/`matplotlib`/`numpy` 等无关大件
- **`console=True`**：服务端程序保留控制台日志输出

### 12.5 注意事项

1. **不可交叉编译**：exe 在 Windows 上打、ELF 在 Linux 上打，spec 文件两平台通用
2. **onefile 模式不推荐**：每次启动需解压全部依赖到临时目录，服务类应用启动慢且杀软误报率高；如需单文件，将 spec 中 `EXE` 的 `exclude_binaries=True` 改为 `False` 并去掉 `COLLECT`，同时在 `EXE(..., a.datas)` 中包含数据
3. **前端更新**：修改前端后必须重新 `npm run build` 并重新打包（web/dist 已烧录进二进制）
4. **GPU/Docker 依赖不变**：打包只是分发形式的改变，推理调度仍需目标机具备 Docker Engine + NVIDIA Container Toolkit
5. **运行时工作目录**：双击 exe 启动时工作目录为 exe 所在目录，配置与数据均落在此处

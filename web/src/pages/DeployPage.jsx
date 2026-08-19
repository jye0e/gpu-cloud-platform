/**
 * 模型部署页面
 * - 选择已上传模型
 * - 配置部署参数
 * - 一键部署
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Rocket, FileText, Cpu, Settings, Loader2, CheckCircle,
  ArrowRight, Zap, Server
} from 'lucide-react'
import {
  Card, Button, Select, Input, toast, PageLoader, EmptyState
} from '../components/ui'
import { deployApi } from '../api/client'

export default function DeployPage() {
  const [models, setModels] = useState([])
  const [engines, setEngines] = useState([])
  const [loading, setLoading] = useState(true)
  const [deploying, setDeploying] = useState(false)

  // 表单
  const [modelId, setModelId] = useState('')
  const [serviceName, setServiceName] = useState('')
  const [engineType, setEngineType] = useState('vllm')
  const [customImage, setCustomImage] = useState('')
  const [customEntrypoint, setCustomEntrypoint] = useState('')
  const [params, setParams] = useState({
    gpu_memory_utilization: 0.4,
    max_model_len: 4096,
    tensor_parallel_size: 1,
    dtype: 'auto',
    memory_limit_gb: 16,
    cpu_limit: 4.0,
  })

  // 部署结果
  const [result, setResult] = useState(null)

  useEffect(() => {
    Promise.all([
      deployApi.listModels().then(data => ({ models: data.models || [] })),
      deployApi.listEngines().then(data => ({ engines: data.engines || [] })),
    ]).then(([modelsData, enginesData]) => {
      setModels(modelsData.models)
      setEngines(enginesData.engines)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleDeploy = async () => {
    if (!modelId) {
      toast('请选择模型', 'warning')
      return
    }
    if (!serviceName.trim()) {
      toast('请输入服务名称', 'warning')
      return
    }

    setDeploying(true)
    setResult(null)

    try {
      const body = {
        model_id: parseInt(modelId),
        service_name: serviceName.trim(),
        engine_type: engineType,
        deploy_params: params,
      }
      if (engineType === 'custom') {
        body.custom_image = customImage.trim()
        if (customEntrypoint.trim()) {
          body.custom_entrypoint = customEntrypoint.trim().split(/\s+/)
        }
      }
      const resp = await deployApi.deploy(body)
      setResult(resp)
      toast('部署成功！', 'success')
    } catch (err) {
      toast(`部署失败: ${err.message}`, 'error')
    } finally {
      setDeploying(false)
    }
  }

  if (loading) return <PageLoader />

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">模型部署</h2>
        <p className="text-sm text-slate-400">选择已上传的模型，配置参数后一键部署</p>
      </div>

      {models.length === 0 ? (
        <div className="space-y-6">
          <Card className="p-8">
            <EmptyState
              icon={<Rocket className="w-12 h-12" />}
              title="暂无可部署的模型"
              description="请先上传模型权重文件"
              action={
                <Link to="/upload" className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-slate-900 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
                  <FileText className="w-4 h-4" /> 去上传
                </Link>
              }
            />
          </Card>

          {/* 无模型时也展示引擎列表 */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Cpu className="w-5 h-5 text-brand-300" />
              <h3 className="font-semibold text-slate-100">支持的推理引擎</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {engines.map(e => (
                <div
                  key={e.type}
                  className="p-3 rounded-lg border border-slate-600 bg-slate-800"
                >
                  <div className="text-sm font-medium text-slate-200">{e.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5 leading-tight">{e.description}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：模型列表 */}
          <div className="lg:col-span-1 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">已上传模型</h3>
            {models.map(m => (
              <Card
                key={m.model_id}
                hover
                className={`p-4 cursor-pointer border-2 transition-all ${modelId === String(m.model_id) ? 'border-slate-400 ring-2 ring-slate-400/20' : 'border-transparent'}`}
                onClick={() => setModelId(String(m.model_id))}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${modelId === String(m.model_id) ? 'bg-slate-400' : 'bg-slate-700'}`}>
                    <FileText className={`w-4.5 h-4.5 ${modelId === String(m.model_id) ? 'text-slate-900' : 'text-slate-500'}`} style={{ width: 18, height: 18 }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-200 truncate">{m.model_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs px-1.5 py-0.5 bg-slate-700 rounded text-slate-400">{m.model_format}</span>
                      <span className="text-xs text-slate-500">{(m.file_size_bytes / (1024 ** 3)).toFixed(2)} GB</span>
                    </div>
                  </div>
                  {modelId === String(m.model_id) && (
                    <CheckCircle className="w-4.5 h-4.5 text-slate-400" style={{ width: 18, height: 18 }} />
                  )}
                </div>
              </Card>
            ))}
          </div>

          {/* 右侧：部署配置 */}
          <div className="lg:col-span-2 space-y-5">
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-5">
                <Settings className="w-5 h-5 text-brand-300" />
                <h3 className="font-semibold text-slate-100">部署配置</h3>
              </div>

              <div className="space-y-4">
                {/* 服务名称 */}
                <Input
                  label="服务名称"
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  placeholder="例如: my-llm-service"
                />

                {/* 推理引擎选择 */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">推理引擎</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {engines.map(e => (
                      <button
                        key={e.type}
                        type="button"
                        onClick={() => setEngineType(e.type)}
                        className={`p-3 rounded-lg border text-left transition-all ${
                          engineType === e.type
                            ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/30'
                            : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                        }`}
                      >
                        <div className="text-sm font-medium text-slate-200">{e.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5 leading-tight">{e.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 自定义引擎参数 */}
                {engineType === 'custom' && (
                  <div className="space-y-3 p-4 rounded-lg border border-slate-600 bg-slate-800/50">
                    <p className="text-sm font-medium text-slate-300">自定义引擎配置</p>
                    <Input
                      label="Docker 镜像"
                      value={customImage}
                      onChange={(e) => setCustomImage(e.target.value)}
                      placeholder="例如: my-registry/my-engine:latest"
                    />
                    <Input
                      label="启动命令（可选）"
                      value={customEntrypoint}
                      onChange={(e) => setCustomEntrypoint(e.target.value)}
                      placeholder="例如: python -m my_engine.server --port 8000"
                    />
                  </div>
                )}

                {/* 参数网格 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">GPU 显存利用率</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.05"
                        value={params.gpu_memory_utilization}
                        onChange={(e) => setParams({ ...params, gpu_memory_utilization: parseFloat(e.target.value) })}
                        className="flex-1 accent-slate-400"
                      />
                      <span className="text-sm font-medium text-slate-300 w-12 text-right">
                        {Math.round(params.gpu_memory_utilization * 100)}%
                      </span>
                    </div>
                  </div>

                  <Select
                    label="数据类型 (dtype)"
                    value={params.dtype}
                    onChange={(e) => setParams({ ...params, dtype: e.target.value })}
                    options={[
                      { value: 'auto', label: 'auto (自动)' },
                      { value: 'float16', label: 'float16' },
                      { value: 'bfloat16', label: 'bfloat16' },
                      { value: 'float32', label: 'float32' },
                    ]}
                  />

                  <Input
                    label="最大上下文长度"
                    type="number"
                    value={params.max_model_len}
                    onChange={(e) => setParams({ ...params, max_model_len: parseInt(e.target.value) || 4096 })}
                  />

                  <Input
                    label="Tensor 并行数"
                    type="number"
                    value={params.tensor_parallel_size}
                    onChange={(e) => setParams({ ...params, tensor_parallel_size: parseInt(e.target.value) || 1 })}
                  />

                  <Input
                    label="内存限制 (GB)"
                    type="number"
                    value={params.memory_limit_gb}
                    onChange={(e) => setParams({ ...params, memory_limit_gb: parseInt(e.target.value) || 16 })}
                  />

                  <Input
                    label="CPU 核心数"
                    type="number"
                    step="0.5"
                    value={params.cpu_limit}
                    onChange={(e) => setParams({ ...params, cpu_limit: parseFloat(e.target.value) || 4.0 })}
                  />
                </div>
              </div>

              {/* 部署按钮 */}
              <div className="mt-6 pt-5 border-t border-slate-700">
                {deploying ? (
                  <div className="flex flex-col items-center py-4">
                    <Loader2 className="w-8 h-8 text-slate-400 animate-spin mb-3" />
                    <p className="text-sm text-slate-300">正在部署...</p>
                    <p className="text-xs text-slate-500 mt-1">系统正在创建容器、分配 GPU、启动 vLLM（预计 1-2 分钟）</p>
                  </div>
                ) : (
                  <Button
                    onClick={handleDeploy}
                    disabled={!modelId || !serviceName.trim()}
                    size="lg"
                    className="w-full"
                  >
                    <Rocket className="w-5 h-5" />
                    一键部署
                  </Button>
                )}
              </div>

              {/* 部署结果 */}
              {result && (
                <div className="mt-5 p-4 bg-emerald-900/30 border border-emerald-800 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                    <span className="font-medium text-emerald-400">部署成功</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">服务 ID</span>
                      <span className="text-slate-200 font-mono">{result.service_id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">GPU</span>
                      <span className="text-slate-200">{result.gpu_device_id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">推理端点</span>
                      <span className="text-slate-200 font-mono text-xs">{result.inference_endpoint}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">API Key</span>
                      <span className="text-slate-200 font-mono text-xs">{result.api_key?.slice(0, 12)}...</span>
                    </div>
                  </div>
                  <div className="flex gap-3 mt-4">
                    <Link to="/services" className="flex-1">
                      <Button variant="outline" className="w-full">
                        <Server className="w-4 h-4" /> 服务管理
                      </Button>
                    </Link>
                    <Link to="/inference" className="flex-1">
                      <Button className="w-full">
                        <Zap className="w-4 h-4" /> 推理测试 <ArrowRight className="w-4 h-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </Card>

            {/* 参数说明 */}
            <Card className="p-5 bg-slate-700/50 border-slate-700">
              <h4 className="text-sm font-medium text-slate-200 mb-2">参数说明</h4>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• <b>GPU 显存利用率</b>：vLLM 预分配的显存比例，值越大推理吞吐越高但占用越多</li>
                <li>• <b>最大上下文长度</b>：模型支持的最大输入+输出 token 数</li>
                <li>• <b>Tensor 并行数</b>：多 GPU 并行推理，单 GPU 设为 1</li>
                <li>• <b>dtype</b>：模型推理精度，float16 显存减半，auto 自动检测</li>
                <li>• 部署后系统自动等待 vLLM 就绪，启动成功后即可调用推理接口</li>
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

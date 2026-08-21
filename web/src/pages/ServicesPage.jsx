/**
 * 服务管理页面
 * - 服务列表
 * - 启停/重启/删除
 * - 查看日志
 * - API 调用方法（代码示例、快速测试）
 */

import { useEffect, useState } from 'react'
import {
  Server, Play, Square, RotateCw, Trash2, FileText,
  Cpu, Clock, AlertCircle, RefreshCw, Zap, Copy, Check,
  Terminal, ExternalLink, Key
} from 'lucide-react'
import {
  Card, Button, StatusBadge, Modal, toast, PageLoader, EmptyState
} from '../components/ui'
import { deployApi } from '../api/client'

export default function ServicesPage() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [operating, setOperating] = useState(null)
  const [logModal, setLogModal] = useState(null)
  const [logs, setLogs] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [apiModal, setApiModal] = useState(null)
  const [copiedField, setCopiedField] = useState('')

  const fetchServices = async () => {
    try {
      const data = await deployApi.listServices()
      setServices(data.services || [])
    } catch (err) {
      toast('获取服务列表失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchServices()
    const timer = setInterval(fetchServices, 10000)
    return () => clearInterval(timer)
  }, [])

  const handleOperate = async (serviceId, action) => {
    setOperating(serviceId)
    try {
      await deployApi.operate({ service_id: serviceId, action })
      const actionMap = { start: '启动', stop: '停止', restart: '重启', remove: '删除' }
      toast(`服务${actionMap[action]}成功`, 'success')
      fetchServices()
    } catch (err) {
      toast(`操作失败: ${err.message}`, 'error')
    } finally {
      setOperating(null)
    }
  }

  const handleViewLogs = async (serviceId, serviceName) => {
    setLogModal({ id: serviceId, name: serviceName })
    setLogsLoading(true)
    setLogs('')
    try {
      const data = await deployApi.getLogs(serviceId, 200)
      setLogs(data.logs || '无日志')
    } catch (err) {
      setLogs(`获取日志失败: ${err.message}`)
    } finally {
      setLogsLoading(false)
    }
  }

  const handleViewApi = (service) => {
    setApiModal(service)
  }

  const copyToClipboard = (text, field) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(''), 1500)
    })
  }

  const formatDate = (iso) => {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const getApiBaseUrl = (service) => {
    return `http://120.202.35.106:8888/api/tenant/inference/${service.service_name}/v1`
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 mb-1">服务管理</h2>
          <p className="text-sm text-slate-400">管理已部署的推理服务</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchServices}>
          <RefreshCw className="w-3.5 h-3.5" /> 刷新
        </Button>
      </div>

      {services.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            icon={<Server className="w-12 h-12" />}
            title="暂无部署服务"
            description="上传模型后即可一键部署推理服务"
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {services.map(s => (
            <Card key={s.service_id} className="p-5" hover>
              <div className="flex items-start justify-between gap-4">
                {/* 左侧：服务信息 */}
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    s.status === 'running' ? 'bg-emerald-900/30' :
                    s.status === 'error' ? 'bg-red-900/30' :
                    s.status === 'deploying' ? 'bg-blue-900/30' : 'bg-slate-700'
                  }`}>
                    <Server className={`w-5 h-5 ${
                      s.status === 'running' ? 'text-emerald-400' :
                      s.status === 'error' ? 'text-red-400' :
                      s.status === 'deploying' ? 'text-blue-400' : 'text-slate-500'
                    }`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-slate-100 truncate">{s.service_name}</h3>
                      <StatusBadge status={s.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" /> {s.model_name}
                      </span>
                      {s.gpu_device_id && (
                        <span className="flex items-center gap-1">
                          <Cpu className="w-3 h-3" /> GPU {s.gpu_device_id}
                        </span>
                      )}
                      {s.service_port && (
                        <span className="font-mono">:{s.service_port}</span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatDate(s.created_at)}
                      </span>
                    </div>
                    {s.error_message && (
                      <div className="mt-2 flex items-start gap-1.5 text-xs text-red-400 bg-red-900/30 px-2.5 py-1.5 rounded-lg">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{s.error_message}</span>
                      </div>
                    )}
                    {s.inference_endpoint && s.status === 'running' && (
                      <div className="mt-2 flex items-center gap-2">
                        <code className="text-xs text-emerald-400 bg-emerald-900/30 px-2.5 py-1.5 rounded-lg font-mono flex-1 truncate">
                          {getApiBaseUrl(s)}/chat/completions
                        </code>
                        <button
                          onClick={() => copyToClipboard(`${getApiBaseUrl(s)}/chat/completions`, `endpoint-${s.service_id}`)}
                          className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
                          title="复制端点"
                        >
                          {copiedField === `endpoint-${s.service_id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => setApiModal(s)}
                        >
                          <Terminal className="w-3.5 h-3.5" /> API
                        </Button>
                        <a
                          href="/inference"
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-slate-900 rounded-lg text-xs font-medium transition-colors"
                        >
                          <Zap className="w-3.5 h-3.5" /> 测试
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* 右侧：操作按钮 */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {s.status === 'running' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOperate(s.service_id, 'stop')}
                      disabled={operating === s.service_id}
                    >
                      <Square className="w-3.5 h-3.5" /> 停止
                    </Button>
                  )}
                  {(s.status === 'stopped' || s.status === 'sleeping') && (
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => handleOperate(s.service_id, 'start')}
                      disabled={operating === s.service_id}
                    >
                      <Play className="w-3.5 h-3.5" /> 启动
                    </Button>
                  )}
                  {s.status !== 'deploying' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOperate(s.service_id, 'restart')}
                      disabled={operating === s.service_id}
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleViewLogs(s.service_id, s.service_name)}
                  >
                    <FileText className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`确定删除服务 ${s.service_name}？此操作不可恢复。`)) {
                        handleOperate(s.service_id, 'remove')
                      }
                    }}
                    disabled={operating === s.service_id}
                    className="text-red-400 hover:bg-red-900/30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 日志弹窗 */}
      <Modal
        open={!!logModal}
        onClose={() => setLogModal(null)}
        title={`服务日志 - ${logModal?.name || ''}`}
        size="xl"
      >
        {logsLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
          </div>
        ) : (
          <pre className="bg-slate-950 text-slate-400 p-4 rounded-lg text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap">
            {logs || '无日志'}
          </pre>
        )}
      </Modal>

      {/* API 调用弹窗 */}
      <Modal
        open={!!apiModal}
        onClose={() => setApiModal(null)}
        title={`API 调用方法 - ${apiModal?.service_name || ''}`}
        size="lg"
      >
        {apiModal && (
          <div className="space-y-4">
            {/* 端点信息 */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
                <Key className="w-4 h-4 text-amber-400" /> 调用端点
              </h4>
              <div className="bg-slate-950 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 bg-emerald-900/50 text-emerald-400 rounded font-mono">POST</span>
                  <code className="flex-1 text-xs text-slate-300 font-mono truncate">
                    {getApiBaseUrl(apiModal)}/chat/completions
                  </code>
                  <button
                    onClick={() => copyToClipboard(`${getApiBaseUrl(apiModal)}/chat/completions`, 'curl-url')}
                    className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {copiedField === 'curl-url' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 bg-blue-900/50 text-blue-400 rounded font-mono">GET</span>
                  <code className="flex-1 text-xs text-slate-300 font-mono truncate">
                    {getApiBaseUrl(apiModal)}/models
                  </code>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 bg-purple-900/50 text-purple-400 rounded font-mono">POST</span>
                  <code className="flex-1 text-xs text-slate-300 font-mono truncate">
                    {getApiBaseUrl(apiModal)}/chat/completions (stream: true)
                  </code>
                </div>
              </div>
            </div>

            {/* cURL 示例 */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-200">cURL 示例</h4>
              <div className="relative">
                <pre className="bg-slate-950 rounded-lg p-3 text-xs text-slate-300 font-mono overflow-x-auto max-h-48">
{`curl -X POST ${getApiBaseUrl(apiModal)}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <API_KEY>" \\
  -d '{
    "model": "${apiModal.model_name}",
    "messages": [{"role": "user", "content": "你好"}],
    "max_tokens": 256
  }'`}
                </pre>
                <button
                  onClick={() => copyToClipboard(`curl -X POST ${getApiBaseUrl(apiModal)}/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer <API_KEY>" -d '{"model": "${apiModal.model_name}", "messages": [{"role": "user", "content": "你好"}], "max_tokens": 256}'`, 'curl')}
                  className="absolute top-2 right-2 p-1.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {copiedField === 'curl' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Python 示例 */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-200">Python 示例</h4>
              <div className="relative">
                <pre className="bg-slate-950 rounded-lg p-3 text-xs text-slate-300 font-mono overflow-x-auto max-h-48">
{`import requests

url = "${getApiBaseUrl(apiModal)}/chat/completions"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer <API_KEY>"
}
data = {
    "model": "${apiModal.model_name}",
    "messages": [{"role": "user", "content": "你好"}],
    "max_tokens": 256
}

# 非流式
resp = requests.post(url, headers=headers, json=data)
print(resp.json())

# 流式
data["stream"] = True
with requests.post(url, headers=headers, json=data, stream=True) as resp:
    for line in resp.iter_lines():
        if line.startswith(b"data: "):
            chunk = line[6:]
            if chunk == b"[DONE]": break
            print(chunk.decode())`}
                </pre>
                <button
                  onClick={() => copyToClipboard('import requests\n\nurl = "' + getApiBaseUrl(apiModal) + '/chat/completions"\nheaders = {\n    "Content-Type": "application/json",\n    "Authorization": "Bearer <API_KEY>"\n}\ndata = {\n    "model": "' + apiModal.model_name + '",\n    "messages": [{"role": "user", "content": "你好"}],\n    "max_tokens": 256\n}\n\nresp = requests.post(url, headers=headers, json=data)\nprint(resp.json())', 'python')}
                  className="absolute top-2 right-2 p-1.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {copiedField === 'python' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* 说明 */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-xs text-slate-400 space-y-1">
              <p className="font-medium text-slate-300">📝 调用说明</p>
              <ul className="space-y-1 list-disc list-inside">
                <li><code className="text-slate-300">model</code> 字段已自动填入模型名 <code className="text-emerald-400">{apiModal.model_name}</code>，也可填任意值，平台会自动映射</li>
                <li>请求头需携带 <code className="text-slate-300">Authorization: Bearer &lt;API_KEY&gt;</code></li>
                <li>流式请求添加 <code className="text-slate-300">"stream": true</code>，响应为 SSE 格式</li>
              </ul>
            </div>

            {/* 快速跳转 */}
            <div className="flex gap-2 pt-2">
              <a
                href="/inference"
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-slate-900 rounded-lg text-sm font-medium transition-colors"
              >
                <Zap className="w-4 h-4" /> 前往推理测试
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
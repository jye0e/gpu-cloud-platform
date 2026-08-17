/**
 * 服务管理页面
 * - 服务列表
 * - 启停/重启/删除
 * - 查看日志
 */

import { useEffect, useState } from 'react'
import {
  Server, Play, Square, RotateCw, Trash2, FileText,
  Cpu, Clock, AlertCircle, RefreshCw
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
    // 定时刷新（每 10 秒）
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

  const formatDate = (iso) => {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">服务管理</h2>
          <p className="text-sm text-slate-500">管理已部署的推理服务</p>
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
                    s.status === 'running' ? 'bg-emerald-50' :
                    s.status === 'error' ? 'bg-red-50' :
                    s.status === 'deploying' ? 'bg-blue-50' : 'bg-slate-100'
                  }`}>
                    <Server className={`w-5 h-5 ${
                      s.status === 'running' ? 'text-emerald-600' :
                      s.status === 'error' ? 'text-red-500' :
                      s.status === 'deploying' ? 'text-blue-500' : 'text-slate-400'
                    }`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-slate-800 truncate">{s.service_name}</h3>
                      <StatusBadge status={s.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
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
                      <div className="mt-2 flex items-start gap-1.5 text-xs text-red-500 bg-red-50 px-2.5 py-1.5 rounded-lg">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{s.error_message}</span>
                      </div>
                    )}
                    {s.inference_endpoint && s.status === 'running' && (
                      <div className="mt-2 text-xs text-emerald-600 bg-emerald-50 px-2.5 py-1.5 rounded-lg font-mono">
                        POST {s.inference_endpoint}/chat/completions
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
                    className="text-red-500 hover:bg-red-50"
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
            <RefreshCw className="w-6 h-6 text-brand-500 animate-spin" />
          </div>
        ) : (
          <pre className="bg-slate-900 text-slate-300 p-4 rounded-lg text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap">
            {logs || '无日志'}
          </pre>
        )}
      </Modal>
    </div>
  )
}

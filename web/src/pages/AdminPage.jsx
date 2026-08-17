/**
 * 管理端页面
 * - 创建租户
 * - 租户列表
 * - GPU 资源概览
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Shield, Users, Cpu, Plus, Copy, RefreshCw,
  HardDrive, Server, Activity, LogOut
} from 'lucide-react'
import {
  Card, Button, Input, Select, StatusBadge, Modal,
  toast, PageLoader, EmptyState, Progress
} from '../components/ui'
import { adminApi } from '../api/client'

export default function AdminPage() {
  const navigate = useNavigate()
  const [tenants, setTenants] = useState([])
  const [gpuData, setGpuData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTenantResult, setNewTenantResult] = useState(null)

  // 创建表单
  const [form, setForm] = useState({
    name: '',
    gpu_memory_util: 0.4,
    max_model_len: 4096,
    storage_quota_gb: 50,
    qps_limit: 10,
    gpu_device_ids: '',
  })

  const adminToken = localStorage.getItem('adminToken')
  if (!adminToken) {
    navigate('/login')
    return null
  }

  const fetchData = async () => {
    try {
      const [t, g] = await Promise.all([
        adminApi.listTenants(),
        adminApi.getGpuOverview().catch(() => null),
      ])
      setTenants(t || [])
      setGpuData(g)
    } catch (err) {
      toast('获取数据失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast('请输入租户名称', 'warning')
      return
    }

    setCreating(true)
    try {
      const resp = await adminApi.createTenant({
        ...form,
        gpu_memory_util: parseFloat(form.gpu_memory_util),
        max_model_len: parseInt(form.max_model_len),
        storage_quota_gb: parseInt(form.storage_quota_gb),
        qps_limit: parseInt(form.qps_limit),
        gpu_device_ids: form.gpu_device_ids || null,
      })
      setNewTenantResult(resp)
      toast('租户创建成功', 'success')
      fetchData()
    } catch (err) {
      toast(`创建失败: ${err.message}`, 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleCopy = (text, label) => {
    navigator.clipboard.writeText(text)
    toast(`${label} 已复制`, 'success')
  }

  const handleStatusChange = async (tenantId, newStatus) => {
    try {
      await adminApi.updateTenantStatus(tenantId, newStatus)
      toast('状态已更新', 'success')
      fetchData()
    } catch (err) {
      toast(`操作失败: ${err.message}`, 'error')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('adminToken')
    navigate('/login')
  }

  if (loading) return <PageLoader />

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 顶栏 */}
      <header className="bg-slate-900 text-white px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
            <Shield className="w-4.5 h-4.5 text-white" style={{ width: 18, height: 18 }} />
          </div>
          <span className="font-semibold">GPU 托管平台 · 管理端</span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-400 hover:text-white hover:bg-slate-800">
          <LogOut className="w-4 h-4" /> 退出
        </Button>
      </header>

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* GPU 资源概览 */}
        {gpuData && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-brand-600" />
                <h3 className="font-semibold text-slate-800">GPU 资源概览</h3>
              </div>
              <Button variant="outline" size="sm" onClick={fetchData}>
                <RefreshCw className="w-3.5 h-3.5" /> 刷新
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {gpuData.gpus?.map(gpu => (
                <div key={gpu.gpu_id} className="p-4 bg-slate-50 rounded-xl">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-brand-500" />
                      <span className="text-sm font-medium text-slate-700">GPU {gpu.gpu_id}</span>
                    </div>
                    <span className="text-xs text-slate-400">{gpu.name}</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">显存使用</span>
                      <span className="text-slate-600">
                        {gpu.used_mb} / {gpu.total_mb} MB
                      </span>
                    </div>
                    <Progress
                      value={gpu.usage_percent}
                      color={gpu.usage_percent > 80 ? 'danger' : gpu.usage_percent > 60 ? 'warning' : 'success'}
                    />
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>已用: {gpu.used_mb}MB</span>
                      <span>可用: {gpu.available_mb}MB</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {gpuData.total_gpus === 0 && (
              <p className="text-center text-slate-400 py-8">未检测到 GPU</p>
            )}
          </Card>
        )}

        {/* 租户管理 */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-brand-600" />
              <h3 className="font-semibold text-slate-800">租户管理</h3>
              <span className="text-sm text-slate-400">({tenants.length})</span>
            </div>
            <Button onClick={() => setShowCreate(true)} size="sm">
              <Plus className="w-4 h-4" /> 创建租户
            </Button>
          </div>

          {tenants.length === 0 ? (
            <EmptyState
              icon={<Users className="w-12 h-12" />}
              title="暂无租户"
              description="创建租户后可分配 Token 和资源配额"
              action={<Button onClick={() => setShowCreate(true)} size="sm"><Plus className="w-4 h-4" /> 创建租户</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-2 text-xs font-medium text-slate-500">租户</th>
                    <th className="text-left py-3 px-2 text-xs font-medium text-slate-500">状态</th>
                    <th className="text-left py-3 px-2 text-xs font-medium text-slate-500">GPU 显存</th>
                    <th className="text-left py-3 px-2 text-xs font-medium text-slate-500">存储配额</th>
                    <th className="text-left py-3 px-2 text-xs font-medium text-slate-500">QPS</th>
                    <th className="text-left py-3 px-2 text-xs font-medium text-slate-500">创建时间</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-slate-500">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map(t => (
                    <tr key={t.tenant_id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-2">
                        <div>
                          <p className="text-sm font-medium text-slate-700">{t.name}</p>
                          <p className="text-xs text-slate-400 font-mono">{t.tenant_id}</p>
                        </div>
                      </td>
                      <td className="py-3 px-2"><StatusBadge status={t.status} /></td>
                      <td className="py-3 px-2 text-sm text-slate-600">{Math.round(t.gpu_memory_util * 100)}%</td>
                      <td className="py-3 px-2 text-sm text-slate-600">{t.storage_quota_gb} GB</td>
                      <td className="py-3 px-2 text-sm text-slate-600">{t.qps_limit}</td>
                      <td className="py-3 px-2 text-xs text-slate-400">
                        {new Date(t.created_at).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="py-3 px-2 text-right">
                        <Select
                          value={t.status}
                          onChange={(e) => handleStatusChange(t.tenant_id, e.target.value)}
                          options={[
                            { value: 'active', label: '正常' },
                            { value: 'suspended', label: '暂停' },
                            { value: 'deleted', label: '删除' },
                          ]}
                          className="text-xs py-1.5 w-24"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* 创建租户弹窗 */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setNewTenantResult(null) }}
        title={newTenantResult ? '租户创建成功' : '创建租户'}
        size="lg"
      >
        {newTenantResult ? (
          /* 创建成功，展示凭证 */
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-4 bg-emerald-50 rounded-xl">
              <Activity className="w-5 h-5 text-emerald-600" />
              <span className="text-sm font-medium text-emerald-700">租户已创建，请保存以下凭证</span>
            </div>

            <div className="space-y-3">
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500">租户 ID</span>
                  <button onClick={() => handleCopy(newTenantResult.tenant_id, '租户ID')} className="text-xs text-brand-600 hover:underline">
                    <Copy className="w-3 h-3 inline" /> 复制
                  </button>
                </div>
                <p className="text-sm font-mono text-slate-700">{newTenantResult.tenant_id}</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500">API Key</span>
                  <button onClick={() => handleCopy(newTenantResult.api_key, 'API Key')} className="text-xs text-brand-600 hover:underline">
                    <Copy className="w-3 h-3 inline" /> 复制
                  </button>
                </div>
                <p className="text-sm font-mono text-slate-700 break-all">{newTenantResult.api_key}</p>
              </div>

              <div className="p-3 bg-brand-50 rounded-lg border border-brand-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-brand-600 font-medium">Access Token（租户登录用）</span>
                  <button onClick={() => handleCopy(newTenantResult.access_token, 'Access Token')} className="text-xs text-brand-600 hover:underline">
                    <Copy className="w-3 h-3 inline" /> 复制
                  </button>
                </div>
                <p className="text-sm font-mono text-slate-700 break-all">{newTenantResult.access_token}</p>
              </div>
            </div>

            <p className="text-xs text-slate-400">
              ⚠️ Access Token 仅展示一次，请妥善保存。租户使用此 Token 登录管控台。
            </p>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setShowCreate(false); setNewTenantResult(null); setForm({ name: '', gpu_memory_util: 0.4, max_model_len: 4096, storage_quota_gb: 50, qps_limit: 10, gpu_device_ids: '' }) }}>
                继续创建
              </Button>
              <Button className="flex-1" onClick={() => { setShowCreate(false); setNewTenantResult(null) }}>
                完成
              </Button>
            </div>
          </div>
        ) : (
          /* 创建表单 */
          <div className="space-y-4">
            <Input
              label="租户名称"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如: 客户A"
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">GPU 显存利用率</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0.1"
                    max="0.9"
                    step="0.05"
                    value={form.gpu_memory_util}
                    onChange={(e) => setForm({ ...form, gpu_memory_util: parseFloat(e.target.value) })}
                    className="flex-1 accent-brand-600"
                  />
                  <span className="text-sm text-slate-600 w-12 text-right">{Math.round(form.gpu_memory_util * 100)}%</span>
                </div>
              </div>
              <Input
                label="最大上下文长度"
                type="number"
                value={form.max_model_len}
                onChange={(e) => setForm({ ...form, max_model_len: e.target.value })}
              />
              <Input
                label="存储配额 (GB)"
                type="number"
                value={form.storage_quota_gb}
                onChange={(e) => setForm({ ...form, storage_quota_gb: e.target.value })}
              />
              <Input
                label="QPS 限制"
                type="number"
                value={form.qps_limit}
                onChange={(e) => setForm({ ...form, qps_limit: e.target.value })}
              />
              <Input
                label="指定 GPU ID（可选）"
                value={form.gpu_device_ids}
                onChange={(e) => setForm({ ...form, gpu_device_ids: e.target.value })}
                placeholder="例如: 0 或 0,1"
                className="col-span-2"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>取消</Button>
              <Button className="flex-1" onClick={handleCreate} loading={creating}>
                <Plus className="w-4 h-4" /> 创建租户
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

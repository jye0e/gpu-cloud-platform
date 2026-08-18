/**
 * 管理端页面
 * - 创建租户
 * - 租户列表
 * - GPU 资源概览
 */

import { useEffect, useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import {
  Shield, Users, Cpu, Plus, Copy, RefreshCw,
  HardDrive, Server, Activity, LogOut, Pencil, Search
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

  // 编辑配额
  const [editTenant, setEditTenant] = useState(null)
  const [editForm, setEditForm] = useState({
    gpu_memory_util: 0.4,
    max_model_len: 4096,
    storage_quota_gb: 50,
    qps_limit: 10,
    gpu_device_ids: '',
  })
  const [savingQuota, setSavingQuota] = useState(false)

  // 搜索关键词
  const [searchKeyword, setSearchKeyword] = useState('')

  const adminToken = localStorage.getItem('adminToken')
  if (!adminToken) {
    return <Navigate to="/login" replace />
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

  // 搜索过滤
  const filteredTenants = tenants.filter(t => {
    if (!searchKeyword.trim()) return true
    const kw = searchKeyword.toLowerCase()
    return t.name.toLowerCase().includes(kw) || t.tenant_id.toLowerCase().includes(kw)
  })

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

  const handleEditQuota = (tenant) => {
    setEditTenant(tenant)
    setEditForm({
      gpu_memory_util: tenant.gpu_memory_util,
      max_model_len: tenant.max_model_len,
      storage_quota_gb: tenant.storage_quota_gb,
      qps_limit: tenant.qps_limit,
      gpu_device_ids: tenant.gpu_device_ids || '',
    })
  }

  const handleSaveQuota = async () => {
    setSavingQuota(true)
    try {
      await adminApi.updateTenantQuota(editTenant.tenant_id, {
        gpu_memory_util: parseFloat(editForm.gpu_memory_util),
        max_model_len: parseInt(editForm.max_model_len),
        storage_quota_gb: parseInt(editForm.storage_quota_gb),
        qps_limit: parseInt(editForm.qps_limit),
        gpu_device_ids: editForm.gpu_device_ids || null,
      })
      toast('资源配额已更新', 'success')
      setEditTenant(null)
      fetchData()
    } catch (err) {
      toast(`更新失败: ${err.message}`, 'error')
    } finally {
      setSavingQuota(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('adminToken')
    navigate('/login')
  }

  if (loading) return <PageLoader />

  return (
    <div className="min-h-screen bg-slate-950">
      {/* 顶栏 */}
      <header className="bg-slate-950 text-white px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
            <Shield className="w-4.5 h-4.5 text-slate-900" style={{ width: 18, height: 18 }} />
          </div>
          <span className="font-semibold">GPU 托管平台 · 管理端</span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-500 hover:text-white hover:bg-slate-800">
          <LogOut className="w-4 h-4" /> 退出
        </Button>
      </header>

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* GPU 资源概览 */}
        {gpuData && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-brand-300" />
                <h3 className="font-semibold text-slate-100">GPU 资源概览</h3>
              </div>
              <Button variant="outline" size="sm" onClick={fetchData}>
                <RefreshCw className="w-3.5 h-3.5" /> 刷新
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {gpuData.gpus?.map(gpu => (
                <div key={gpu.gpu_id} className="p-4 bg-slate-700/50 rounded-xl">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-brand-300" />
                      <span className="text-sm font-medium text-slate-200">GPU {gpu.gpu_id}</span>
                    </div>
                    <span className="text-xs text-slate-500">{gpu.name}</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">显存使用</span>
                      <span className="text-slate-300">
                        {gpu.used_mb} / {gpu.total_mb} MB
                      </span>
                    </div>
                    <Progress
                      value={gpu.usage_percent}
                      color={gpu.usage_percent > 80 ? 'danger' : gpu.usage_percent > 60 ? 'warning' : 'success'}
                    />
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>已用: {gpu.used_mb}MB</span>
                      <span>可用: {gpu.available_mb}MB</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {gpuData.total_gpus === 0 && (
              <p className="text-center text-slate-500 py-8">未检测到 GPU</p>
            )}
          </Card>
        )}

        {/* 租户管理 */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-brand-300" />
              <h3 className="font-semibold text-slate-100">租户管理</h3>
              <span className="text-sm text-slate-500">({tenants.length})</span>
            </div>
          <Button onClick={() => setShowCreate(true)} size="sm">
            <Plus className="w-4 h-4" /> 创建租户
          </Button>
        </div>

        {/* 搜索栏 */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="搜索租户名称或 ID..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2 rounded-lg border border-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all bg-slate-800"
          />
        </div>

        {filteredTenants.length === 0 ? (
          <EmptyState
            icon={<Users className="w-12 h-12" />}
            title={searchKeyword ? '未找到匹配的租户' : '暂无租户'}
            description={searchKeyword ? `没有包含"${searchKeyword}"的租户` : '创建租户后可分配 Token 和资源配额'}
            action={!searchKeyword && <Button onClick={() => setShowCreate(true)} size="sm"><Plus className="w-4 h-4" /> 创建租户</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-3 px-2 text-xs font-medium text-slate-400">租户</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-slate-400">状态</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-slate-400">GPU 显存</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-slate-400">存储配额</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-slate-400">QPS</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-slate-400">创建时间</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-slate-400">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.map(t => (
                    <tr key={t.tenant_id} className="border-b border-slate-700 hover:bg-slate-700/30">
                      <td className="py-3 px-2">
                        <div>
                          <p className="text-sm font-medium text-slate-200">{t.name}</p>
                          <p className="text-xs text-slate-500 font-mono">{t.tenant_id}</p>
                        </div>
                      </td>
                      <td className="py-3 px-2"><StatusBadge status={t.status} /></td>
                      <td className="py-3 px-2 text-sm text-slate-300">{Math.round(t.gpu_memory_util * 100)}%</td>
                      <td className="py-3 px-2 text-sm text-slate-300">{t.storage_quota_gb} GB</td>
                      <td className="py-3 px-2 text-sm text-slate-300">{t.qps_limit}</td>
                      <td className="py-3 px-2 text-xs text-slate-500">
                        {new Date(t.created_at).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="py-3 px-2 text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => handleEditQuota(t)}
                            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-brand-300 transition-colors"
                            title="编辑资源配额"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
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
                        </div>
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
            <div className="flex items-center gap-2 p-4 bg-emerald-900/30 rounded-xl">
              <Activity className="w-5 h-5 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">租户已创建，请保存以下凭证</span>
            </div>

            <div className="space-y-3">
              <div className="p-3 bg-slate-700/50 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-400">租户 ID</span>
                  <button onClick={() => handleCopy(newTenantResult.tenant_id, '租户ID')} className="text-xs text-brand-400 hover:underline">
                    <Copy className="w-3 h-3 inline" /> 复制
                  </button>
                </div>
                <p className="text-sm font-mono text-slate-200">{newTenantResult.tenant_id}</p>
              </div>

              <div className="p-3 bg-slate-700/50 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-400">API Key</span>
                  <button onClick={() => handleCopy(newTenantResult.api_key, 'API Key')} className="text-xs text-brand-400 hover:underline">
                    <Copy className="w-3 h-3 inline" /> 复制
                  </button>
                </div>
                <p className="text-sm font-mono text-slate-200 break-all">{newTenantResult.api_key}</p>
              </div>

              <div className="p-3 bg-slate-700 rounded-lg border border-slate-600">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-100 font-medium">Access Token（租户登录用）</span>
                  <button onClick={() => handleCopy(newTenantResult.access_token, 'Access Token')} className="text-xs text-brand-400 hover:underline">
                    <Copy className="w-3 h-3 inline" /> 复制
                  </button>
                </div>
                <p className="text-sm font-mono text-slate-200 break-all">{newTenantResult.access_token}</p>
              </div>
            </div>

            <p className="text-xs text-slate-500">
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
                <label className="block text-sm font-medium text-slate-300 mb-1.5">GPU 显存利用率</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0.1"
                    max="0.9"
                    step="0.05"
                    value={form.gpu_memory_util}
                    onChange={(e) => setForm({ ...form, gpu_memory_util: parseFloat(e.target.value) })}
                    className="flex-1 accent-slate-400"
                  />
                  <span className="text-sm text-slate-300 w-12 text-right">{Math.round(form.gpu_memory_util * 100)}%</span>
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

      {/* 编辑资源配额弹窗 */}
      <Modal
        open={!!editTenant}
        onClose={() => setEditTenant(null)}
        title={`编辑资源配额 - ${editTenant?.name || ''}`}
        size="md"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">GPU 显存利用率</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.1"
                  max="0.9"
                  step="0.05"
                  value={editForm.gpu_memory_util}
                  onChange={(e) => setEditForm({ ...editForm, gpu_memory_util: parseFloat(e.target.value) })}
                  className="flex-1 accent-slate-400"
                />
                <span className="text-sm text-slate-300 w-12 text-right">{Math.round(editForm.gpu_memory_util * 100)}%</span>
              </div>
            </div>
            <Input
              label="最大上下文长度"
              type="number"
              value={editForm.max_model_len}
              onChange={(e) => setEditForm({ ...editForm, max_model_len: e.target.value })}
            />
            <Input
              label="存储配额 (GB)"
              type="number"
              value={editForm.storage_quota_gb}
              onChange={(e) => setEditForm({ ...editForm, storage_quota_gb: e.target.value })}
            />
            <Input
              label="QPS 限制"
              type="number"
              value={editForm.qps_limit}
              onChange={(e) => setEditForm({ ...editForm, qps_limit: e.target.value })}
            />
            <Input
              label="指定 GPU ID（可选）"
              value={editForm.gpu_device_ids}
              onChange={(e) => setEditForm({ ...editForm, gpu_device_ids: e.target.value })}
              placeholder="例如: 0 或 0,1"
              className="col-span-2"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditTenant(null)}>取消</Button>
            <Button className="flex-1" onClick={handleSaveQuota} loading={savingQuota}>
              保存配额
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

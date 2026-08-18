/**
 * 资源管理页面
 * - 存储用量
 * - GPU 配置
 * - 配额信息
 */

import { useEffect, useState } from 'react'
import {
  HardDrive, Cpu, Gauge, Activity, Database, Zap
} from 'lucide-react'
import {
  Card, Progress, PageLoader
} from '../components/ui'
import { resourceApi } from '../api/client'

export default function ResourcesPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    resourceApi.overview()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <PageLoader />
  if (!data) return <div className="text-center text-slate-500 py-8">获取资源信息失败</div>

  const storagePercent = data.storage?.usage_percent || 0
  const gpuUtil = data.gpu_config?.gpu_memory_util_limit || 0

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">资源管理</h2>
        <p className="text-sm text-slate-400">查看当前租户的资源配额与使用情况</p>
      </div>

      {/* 存储用量 */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 bg-amber-900/30 rounded-lg flex items-center justify-center">
            <HardDrive className="w-4.5 h-4.5 text-amber-400" style={{ width: 18, height: 18 }} />
          </div>
          <h3 className="font-semibold text-slate-100">存储用量</h3>
        </div>

        <div className="flex items-end justify-between mb-3">
          <div>
            <span className="text-3xl font-bold text-slate-100">{data.storage?.used_gb || 0}</span>
            <span className="text-lg text-slate-500 ml-1">/ {data.storage?.quota_gb || 0} GB</span>
          </div>
          <span className={`text-sm font-medium ${storagePercent > 80 ? 'text-red-400' : 'text-slate-400'}`}>
            {storagePercent}%
          </span>
        </div>
        <Progress
          value={storagePercent}
          color={storagePercent > 80 ? 'danger' : storagePercent > 60 ? 'warning' : 'brand'}
          className="h-3"
        />
        <div className="grid grid-cols-3 gap-4 mt-5">
          <div className="text-center p-3 bg-slate-700/50 rounded-lg">
            <p className="text-xs text-slate-500 mb-1">已使用</p>
            <p className="text-sm font-semibold text-slate-200">{data.storage?.used_gb || 0} GB</p>
          </div>
          <div className="text-center p-3 bg-slate-700/50 rounded-lg">
            <p className="text-xs text-slate-500 mb-1">总配额</p>
            <p className="text-sm font-semibold text-slate-200">{data.storage?.quota_gb || 0} GB</p>
          </div>
          <div className="text-center p-3 bg-slate-700/50 rounded-lg">
            <p className="text-xs text-slate-500 mb-1">剩余</p>
            <p className="text-sm font-semibold text-slate-200">
              {((data.storage?.quota_gb || 0) - (data.storage?.used_gb || 0)).toFixed(1)} GB
            </p>
          </div>
        </div>
      </Card>

      {/* GPU 配置 */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 bg-slate-700 rounded-lg flex items-center justify-center">
            <Cpu className="w-4.5 h-4.5 text-slate-100" style={{ width: 18, height: 18 }} />
          </div>
          <h3 className="font-semibold text-slate-100">GPU 配置</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-slate-700/50 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Gauge className="w-4 h-4 text-brand-300" />
              <span className="text-xs text-slate-400">显存利用率上限</span>
            </div>
            <p className="text-2xl font-bold text-slate-100">{Math.round(gpuUtil * 100)}%</p>
            <Progress value={gpuUtil * 100} color="brand" className="mt-2" />
          </div>

          <div className="p-4 bg-slate-700/50 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-slate-400">最大上下文</span>
            </div>
            <p className="text-2xl font-bold text-slate-100">
              {data.gpu_config?.max_model_len || 0}
            </p>
            <p className="text-xs text-slate-500 mt-2">tokens</p>
          </div>

          <div className="p-4 bg-slate-700/50 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Database className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-slate-400">分配 GPU</span>
            </div>
            <p className="text-2xl font-bold text-slate-100">
              {data.gpu_config?.assigned_gpu_ids || 'Auto'}
            </p>
            <p className="text-xs text-slate-500 mt-2">设备 ID</p>
          </div>
        </div>
      </Card>

      {/* 接口限流 */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 bg-emerald-900/30 rounded-lg flex items-center justify-center">
            <Zap className="w-4.5 h-4.5 text-emerald-400" style={{ width: 18, height: 18 }} />
          </div>
          <h3 className="font-semibold text-slate-100">接口限流</h3>
        </div>
        <div className="flex items-center justify-between p-4 bg-slate-700/50 rounded-xl">
          <div>
            <p className="text-sm font-medium text-slate-200">QPS 限制</p>
            <p className="text-xs text-slate-500 mt-0.5">每秒最大请求数</p>
          </div>
          <p className="text-2xl font-bold text-slate-100">{data.qps_limit || 0}</p>
        </div>
      </Card>

      {/* 提示 */}
      <Card className="p-5 bg-blue-900/30 border-blue-800">
        <p className="text-sm text-blue-400">
          如需调整资源配额（存储空间、GPU 显存、QPS 限制等），请联系平台管理员。
        </p>
      </Card>
    </div>
  )
}

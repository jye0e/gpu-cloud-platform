/**
 * 概览仪表盘
 * 展示租户资源概况、服务状态、快速操作入口
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  HardDrive, Cpu, Server, Activity, Upload, Rocket,
  MessageSquare, ArrowRight, Gauge
} from 'lucide-react'
import { Card, StatusBadge, Progress, PageLoader, EmptyState } from '../components/ui'
import { resourceApi, deployApi } from '../api/client'

export default function Dashboard() {
  const [resource, setResource] = useState(null)
  const [services, setServices] = useState([])
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      resourceApi.overview().catch(() => null),
      deployApi.listServices().catch(() => ({ services: [] })),
      deployApi.listModels().catch(() => ({ models: [] })),
    ]).then(([r, s, m]) => {
      setResource(r)
      setServices(s.services || [])
      setModels(m.models || [])
      setLoading(false)
    })
  }, [])

  if (loading) return <PageLoader />

  const runningServices = services.filter(s => s.status === 'running').length
  const totalServices = services.length
  const totalModels = models.length

  const stats = [
    {
      label: '运行中服务',
      value: runningServices,
      total: totalServices,
      icon: Server,
      color: 'brand',
      link: '/services',
    },
    {
      label: '已上传模型',
      value: totalModels,
      icon: Upload,
      color: 'emerald',
      link: '/deploy',
    },
    {
      label: '存储用量',
      value: `${resource?.storage?.used_gb || 0}`,
      unit: ` / ${resource?.storage?.quota_gb || 0} GB`,
      icon: HardDrive,
      color: 'amber',
      link: '/resources',
    },
    {
      label: 'GPU 显存',
      value: `${Math.round((resource?.gpu_config?.gpu_memory_util_limit || 0) * 100)}`,
      unit: '%',
      icon: Cpu,
      color: 'purple',
      link: '/resources',
    },
  ]

  const colorMap = {
    brand: { bg: 'bg-slate-700', text: 'text-brand-300', icon: 'bg-slate-400' },
    emerald: { bg: 'bg-emerald-900/30', text: 'text-emerald-400', icon: 'bg-emerald-500' },
    amber: { bg: 'bg-amber-900/30', text: 'text-amber-400', icon: 'bg-amber-500' },
    purple: { bg: 'bg-purple-900/30', text: 'text-purple-400', icon: 'bg-purple-500' },
  }

  return (
    <div className="space-y-6">
      {/* 欢迎横幅 */}
      <div className="bg-gradient-to-r from-slate-700 to-slate-800 rounded-2xl p-6 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-20 -mt-20" />
        <div className="absolute bottom-0 right-10 w-32 h-32 bg-white/5 rounded-full -mb-10" />
        <div className="relative">
          <h2 className="text-xl font-bold mb-1">欢迎使用 GPU 算力托管平台</h2>
          <p className="text-white/70 text-sm mb-4">自主上传模型、一键部署、标准 OpenAI 接口调用</p>
          <div className="flex gap-3">
            <Link to="/upload" className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/15 backdrop-blur rounded-lg text-sm font-medium transition-all">
              <Upload className="w-4 h-4" />
              上传模型
            </Link>
            <Link to="/inference" className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/15 backdrop-blur rounded-lg text-sm font-medium transition-all">
              <MessageSquare className="w-4 h-4" />
              推理测试
            </Link>
          </div>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => {
          const Icon = stat.icon
          const c = colorMap[stat.color]
          return (
            <Link key={i} to={stat.link}>
              <Card hover className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${c.bg}`}>
                    <Icon className={`w-5 h-5 ${c.text}`} />
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-600" />
                </div>
                <p className="text-2xl font-bold text-slate-100">
                  {stat.value}
                  {stat.total !== undefined && <span className="text-base text-slate-500 font-normal">/{stat.total}</span>}
                  {stat.unit && <span className="text-base text-slate-500 font-normal">{stat.unit}</span>}
                </p>
                <p className="text-sm text-slate-400 mt-0.5">{stat.label}</p>
              </Card>
            </Link>
          )
        })}
      </div>

      {/* 服务列表 + 资源详情 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 服务列表 */}
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-100">部署服务</h3>
            <Link to="/services" className="text-sm text-brand-400 hover:underline flex items-center gap-1">
              查看全部 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {services.length === 0 ? (
            <EmptyState
              icon={<Server className="w-12 h-12" />}
              title="暂无部署服务"
              description="上传模型后即可一键部署"
              action={<Link to="/deploy" className="text-sm text-brand-400 hover:underline">去部署 →</Link>}
            />
          ) : (
            <div className="space-y-3">
              {services.slice(0, 5).map(s => (
                <div key={s.service_id} className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-2 h-2 rounded-full ${s.status === 'running' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate">{s.service_name}</p>
                      <p className="text-xs text-slate-500 truncate">{s.model_name}</p>
                    </div>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 资源详情 */}
        <Card className="p-5">
          <h3 className="font-semibold text-slate-100 mb-4">资源详情</h3>
          <div className="space-y-4">
            {/* 存储 */}
            <div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-slate-300">存储</span>
                <span className="text-slate-400">{resource?.storage?.usage_percent || 0}%</span>
              </div>
              <Progress value={resource?.storage?.usage_percent || 0} color={resource?.storage?.usage_percent > 80 ? 'danger' : 'brand'} />
              <p className="text-xs text-slate-500 mt-1">
                {resource?.storage?.used_gb || 0}GB / {resource?.storage?.quota_gb || 0}GB
              </p>
            </div>

            {/* GPU 配置 */}
            <div className="pt-3 border-t border-slate-700">
              <div className="flex items-center gap-2 text-sm text-slate-300 mb-2">
                <Gauge className="w-4 h-4" />
                GPU 配置
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">显存利用率上限</span>
                  <span className="text-slate-300">{Math.round((resource?.gpu_config?.gpu_memory_util_limit || 0) * 100)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">最大上下文</span>
                  <span className="text-slate-300">{resource?.gpu_config?.max_model_len || 0} tokens</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">QPS 限制</span>
                  <span className="text-slate-300">{resource?.qps_limit || 0}</span>
                </div>
              </div>
            </div>

            {/* 快速操作 */}
            <div className="pt-3 border-t border-slate-700 space-y-2">
              <Link to="/upload" className="flex items-center justify-between p-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
                <span className="text-sm text-slate-100 font-medium flex items-center gap-2">
                  <Upload className="w-4 h-4" /> 上传新模型
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </Link>
              <Link to="/deploy" className="flex items-center justify-between p-2.5 bg-emerald-900/30 hover:bg-emerald-900/50 rounded-lg transition-colors">
                <span className="text-sm text-emerald-400 font-medium flex items-center gap-2">
                  <Rocket className="w-4 h-4" /> 部署模型
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

/**
 * 管控台布局
 * 侧边栏导航 + 顶栏 + 内容区
 */

import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom'
import {
  LayoutDashboard, Upload, Rocket, Server, MessageSquare,
  HardDrive, LogOut, Cloud, Menu, X, Cpu, Copy
} from 'lucide-react'
import { resourceApi } from '../api/client'
import { toast } from '../components/ui'

const navItems = [
  { path: '/dashboard', label: '概览', icon: LayoutDashboard },
  { path: '/upload', label: '模型上传', icon: Upload },
  { path: '/deploy', label: '模型部署', icon: Rocket },
  { path: '/services', label: '服务管理', icon: Server },
  { path: '/inference', label: '推理测试', icon: MessageSquare },
  { path: '/resources', label: '资源管理', icon: HardDrive },
]

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [resourceData, setResourceData] = useState(null)

  const token = localStorage.getItem('token')
  if (!token) {
    return <Navigate to="/login" replace />
  }

  useEffect(() => {
    resourceApi.overview().then(setResourceData).catch(() => {})
  }, [location.pathname])

  const handleLogout = () => {
    localStorage.removeItem('token')
    toast('已退出登录', 'info')
    navigate('/login')
  }

  const currentNav = navItems.find(n => n.path === location.pathname)

  return (
    <div className="flex h-screen bg-slate-950">
      {/* 侧边栏 */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-30 w-64 bg-slate-900 flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        {/* Logo */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-slate-700/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-brand-600 rounded-lg flex items-center justify-center">
              <Cloud className="w-5 h-5 text-slate-900" />
            </div>
            <div>
              <p className="text-white font-semibold text-sm">元熙智能云</p>
              <p className="text-slate-500 text-xs">GPU 托管平台</p>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 导航 */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <p className="px-3 mb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">租户管控台</p>
          {navItems.map(item => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all mb-0.5 ${
                    isActive
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`
                }
              >
                <Icon className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        {/* 底部信息 */}
        <div className="p-3 border-t border-slate-700/50">
          {resourceData && (
            <div className="px-3 py-3 bg-slate-800/50 rounded-lg mb-2">
              <p className="text-sm font-medium text-slate-200">{resourceData.tenant_name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="text-xs font-mono text-slate-500 truncate">{resourceData.tenant_id}</p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(resourceData.tenant_id)
                    toast('租户 ID 已复制', 'success')
                  }}
                  className="shrink-0 p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-300 transition-colors"
                  title="复制租户 ID"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-slate-500">存储用量</span>
                <span className="text-slate-300">{resourceData.storage?.used_gb || 0} / {resourceData.storage?.quota_gb || 0} GB</span>
              </div>
              <div className="mt-1.5 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-slate-400 rounded-full"
                  style={{ width: `${resourceData.storage?.usage_percent || 0}%` }}
                />
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-red-900/30 hover:text-red-400 transition-all w-full"
          >
            <LogOut className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
            退出登录
          </button>
        </div>
      </aside>

      {/* 遮罩 */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶栏 */}
        <header className="flex items-center justify-between h-16 bg-slate-800 border-b border-slate-700 px-4 lg:px-6 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-slate-700">
              <Menu className="w-5 h-5 text-slate-300" />
            </button>
            <h1 className="text-lg font-semibold text-slate-100">
              {currentNav?.label || '概览'}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-700/50 rounded-lg">
              <Cpu className="w-4 h-4 text-brand-300" />
              <span className="text-sm text-slate-300 font-medium">
                GPU {resourceData?.gpu_config?.assigned_gpu_ids || 'Auto'}
              </span>
            </div>
          </div>
        </header>

        {/* 页面内容 */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

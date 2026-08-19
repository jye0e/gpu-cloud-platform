/**
 * 登录页面
 * 租户通过 API Key 登录（永久有效）
 * 管理端通过 Admin Token 登录
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cloud, KeyRound, Shield, ArrowRight, Eye, EyeOff } from 'lucide-react'
import { Button, Input, toast } from '../components/ui'

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('tenant') // tenant | admin
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const savedTenantKey = localStorage.getItem('savedTenantKey')
    const savedAdminKey = localStorage.getItem('savedAdminKey')
    if (savedTenantKey) {
      setKey(savedTenantKey)
    }
  }, [])

  const handleModeSwitch = (newMode) => {
    setMode(newMode)
    if (newMode === 'tenant') {
      setKey(localStorage.getItem('savedTenantKey') || '')
    } else {
      setKey(localStorage.getItem('savedAdminKey') || '')
    }
    setShowKey(false)
  }

  const handleLogin = async () => {
    if (!key.trim()) {
      toast(
        mode === 'tenant' ? '请输入 API Key' : '请输入管理端 Token',
        'warning',
      )
      return
    }

    setLoading(true)
    try {
      if (mode === 'tenant') {
        const resp = await fetch('/api/tenant/resource_overview', {
          headers: { 'Authorization': `Bearer ${key.trim()}` },
        })
        if (!resp.ok) {
          throw new Error('API Key 无效，请检查')
        }
        const data = await resp.json()
        localStorage.setItem('token', key.trim())
        localStorage.setItem('savedTenantKey', key.trim())
        toast(`登录成功，欢迎 ${data.tenant_name}`, 'success')
        navigate('/dashboard')
      } else {
        const resp = await fetch('/admin/tenants', {
          headers: { 'X-Admin-Token': key.trim() },
        })
        if (!resp.ok) {
          throw new Error('管理端 Token 验证失败')
        }
        localStorage.setItem('adminToken', key.trim())
        localStorage.setItem('savedAdminKey', key.trim())
        toast('管理端登录成功', 'success')
        navigate('/admin')
      }
    } catch (err) {
      toast(err.message, 'error')
      if (mode === 'tenant') {
        localStorage.removeItem('token')
      } else {
        localStorage.removeItem('adminToken')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 animated-gradient p-4">
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/5 backdrop-blur-md rounded-2xl mb-4 border border-slate-600/50">
            <Cloud className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">元熙智能云</h1>
          <p className="text-sm text-white/50 mt-1">GPU 托管平台</p>
        </div>

        {/* 登录卡片 */}
        <div className="bg-slate-800/95 backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-slate-600/50">
          {/* 模式切换 */}
          <div className="flex gap-2 p-1 bg-slate-700 rounded-xl mb-6">
            <button
              onClick={() => handleModeSwitch('tenant')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${mode === 'tenant' ? 'bg-slate-600 shadow-sm text-slate-100' : 'text-slate-500'}`}
            >
              <KeyRound className="w-4 h-4" />
              租户登录
            </button>
            <button
              onClick={() => handleModeSwitch('admin')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${mode === 'admin' ? 'bg-slate-600 shadow-sm text-slate-100' : 'text-slate-500'}`}
            >
              <Shield className="w-4 h-4" />
              管理端
            </button>
          </div>

          {/* 输入区 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                {mode === 'tenant' ? 'API Key' : 'Admin Token'}
              </label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    mode === 'tenant'
                      ? '请输入 API Key（sk_ 开头）'
                      : '请输入管理端 Token'
                  }
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {mode === 'tenant'
                  ? 'API Key 由管理员创建租户时分配，永久有效，用于访问所有租户接口'
                  : '管理端 Token 用于创建租户、管理资源等操作'}
              </p>
            </div>

            <Button
              onClick={handleLogin}
              loading={loading}
              className="w-full"
              size="lg"
            >
              登录
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-white/30 mt-6">
          元熙智能云 GPU 托管模式 · v1.0
        </p>
      </div>
    </div>
  )
}

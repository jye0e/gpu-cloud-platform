/**
 * 登录页面
 * 租户通过 Access Token 登录
 * 管理端通过 Admin Token 登录
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cloud, KeyRound, Shield, ArrowRight, Cpu } from 'lucide-react'
import { Button, Input, toast } from '../components/ui'

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('tenant') // tenant | admin
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!token.trim()) {
      toast('请输入 Token', 'warning')
      return
    }

    setLoading(true)
    try {
      if (mode === 'tenant') {
        // 验证 Token：调用一个需要鉴权的接口
        localStorage.setItem('token', token.trim())
        const resp = await fetch('/api/tenant/resource_overview', {
          headers: { 'Authorization': `Bearer ${token.trim()}` },
        })
        if (!resp.ok) {
          localStorage.removeItem('token')
          throw new Error('Token 验证失败，请检查')
        }
        toast('登录成功', 'success')
        navigate('/dashboard')
      } else {
        // 管理端验证
        localStorage.setItem('adminToken', token.trim())
        const resp = await fetch('/admin/tenants', {
          headers: { 'X-Admin-Token': token.trim() },
        })
        if (!resp.ok) {
          localStorage.removeItem('adminToken')
          throw new Error('管理端 Token 验证失败')
        }
        toast('管理端登录成功', 'success')
        navigate('/admin')
      }
    } catch (err) {
      toast(err.message, 'error')
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
          <h1 className="text-2xl font-bold text-white">GPU 算力托管平台</h1>
          <p className="text-sm text-white/50 mt-1">云端硬件托管 · 租户自助模型部署</p>
        </div>

        {/* 登录卡片 */}
        <div className="bg-slate-800/95 backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-slate-600/50">
          {/* 模式切换 */}
          <div className="flex gap-2 p-1 bg-slate-700 rounded-xl mb-6">
            <button
              onClick={() => setMode('tenant')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${mode === 'tenant' ? 'bg-slate-600 shadow-sm text-slate-100' : 'text-slate-500'}`}
            >
              <KeyRound className="w-4 h-4" />
              租户登录
            </button>
            <button
              onClick={() => setMode('admin')}
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
                {mode === 'tenant' ? 'Access Token' : 'Admin Token'}
              </label>
              <div className="relative">
                <Input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={mode === 'tenant' ? '请输入租户 Access Token' : '请输入管理端 Token'}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  className="pr-10"
                />
                <Cpu className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {mode === 'tenant'
                  ? 'Token 由管理员创建租户时分配，用于访问所有租户接口'
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
          对标火山引擎 / 阿里云 GPU 托管模式 · v1.0
        </p>
      </div>
    </div>
  )
}

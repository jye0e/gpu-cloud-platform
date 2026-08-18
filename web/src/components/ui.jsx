/**
 * 通用 UI 组件
 */

import { Loader2, X, AlertCircle, CheckCircle } from 'lucide-react'

// 按钮组件
export function Button({ children, variant = 'primary', size = 'md', loading, disabled, className = '', ...props }) {
  const variants = {
    primary: 'bg-brand-600 hover:bg-brand-700 text-slate-900 shadow-sm',
    secondary: 'bg-slate-700 hover:bg-slate-700 text-slate-200',
    danger: 'bg-red-500 hover:bg-red-600 text-white shadow-sm',
    success: 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm',
    ghost: 'hover:bg-slate-700 text-slate-300',
    outline: 'border border-slate-600 hover:bg-slate-700/50 text-slate-200',
  }
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  }
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={loading || disabled}
      {...props}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  )
}

// 卡片组件
export function Card({ children, className = '', hover = false, ...props }) {
  return (
    <div
      className={`bg-slate-800 rounded-xl border border-slate-700 shadow-sm ${hover ? 'card-hover' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

// 状态标签
export function StatusBadge({ status }) {
  const map = {
    running: { label: '运行中', color: 'bg-emerald-900/30 text-emerald-400 border-emerald-800', dot: 'bg-emerald-500' },
    stopped: { label: '已停止', color: 'bg-slate-700 text-slate-300 border-slate-700', dot: 'bg-slate-400' },
    deploying: { label: '部署中', color: 'bg-blue-900/30 text-blue-400 border-blue-800', dot: 'bg-blue-500' },
    pending: { label: '等待中', color: 'bg-amber-900/30 text-amber-400 border-amber-800', dot: 'bg-amber-500' },
    error: { label: '异常', color: 'bg-red-900/30 text-red-400 border-red-800', dot: 'bg-red-500' },
    sleeping: { label: '休眠', color: 'bg-purple-900/30 text-purple-400 border-purple-800', dot: 'bg-purple-500' },
    active: { label: '正常', color: 'bg-emerald-900/30 text-emerald-400 border-emerald-800', dot: 'bg-emerald-500' },
    suspended: { label: '已暂停', color: 'bg-red-900/30 text-red-400 border-red-800', dot: 'bg-red-500' },
    deleted: { label: '已删除', color: 'bg-slate-700 text-slate-400 border-slate-700', dot: 'bg-slate-400' },
    uploading: { label: '上传中', color: 'bg-blue-900/30 text-blue-400 border-blue-800', dot: 'bg-blue-500' },
    completed: { label: '已完成', color: 'bg-emerald-900/30 text-emerald-400 border-emerald-800', dot: 'bg-emerald-500' },
    failed: { label: '失败', color: 'bg-red-900/30 text-red-400 border-red-800', dot: 'bg-red-500' },
    cancelled: { label: '已取消', color: 'bg-slate-700 text-slate-400 border-slate-700', dot: 'bg-slate-400' },
  }
  const cfg = map[status] || { label: status, color: 'bg-slate-700 text-slate-300 border-slate-700', dot: 'bg-slate-400' }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

// 进度条
export function Progress({ value, className = '', color = 'brand' }) {
  const colors = {
    brand: 'bg-slate-400',
    success: 'bg-emerald-500',
    danger: 'bg-red-500',
    warning: 'bg-amber-500',
  }
  return (
    <div className={`w-full bg-slate-700 rounded-full h-2 overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-300 ${colors[color]}`}
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  )
}

// 输入框
export function Input({ label, error, className = '', ...props }) {
  return (
    <div className="w-full">
      {label && <label className="block text-sm font-medium text-slate-300 mb-1.5">{label}</label>}
      <input
        className={`w-full px-3.5 py-2.5 rounded-lg border border-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all bg-slate-800 ${error ? 'border-red-500' : ''} ${className}`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}

// 下拉选择
export function Select({ label, options = [], className = '', ...props }) {
  return (
    <div className="w-full">
      {label && <label className="block text-sm font-medium text-slate-300 mb-1.5">{label}</label>}
      <select
        className={`w-full px-3.5 py-2.5 pr-10 rounded-lg border border-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all bg-slate-800 appearance-none ${className}`}
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%239CA3AF' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 14px center',
          backgroundSize: '14px 12px',
        }}
        {...props}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// 文本域
export function Textarea({ label, className = '', ...props }) {
  return (
    <div className="w-full">
      {label && <label className="block text-sm font-medium text-slate-300 mb-1.5">{label}</label>}
      <textarea
        className={`w-full px-3.5 py-2.5 rounded-lg border border-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all resize-none bg-slate-800 ${className}`}
        {...props}
      />
    </div>
  )
}

// 弹窗
export function Modal({ open, onClose, title, children, size = 'md' }) {
  if (!open) return null
  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-slate-800 rounded-2xl shadow-2xl w-full ${sizes[size]} max-h-[90vh] overflow-hidden flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  )
}

// Toast 提示
let toastContainer = null
export function toast(message, type = 'info') {
  if (!toastContainer) {
    toastContainer = document.createElement('div')
    toastContainer.className = 'fixed top-4 right-4 z-[100] flex flex-col gap-2'
    document.body.appendChild(toastContainer)
  }
  const el = document.createElement('div')
  const colors = {
    success: 'bg-emerald-900/50 border-emerald-700 text-emerald-300',
    error: 'bg-red-900/50 border-red-700 text-red-300',
    info: 'bg-blue-900/50 border-blue-700 text-blue-300',
    warning: 'bg-amber-900/50 border-amber-700 text-amber-300',
  }
  const icons = {
    success: <CheckCircle className="w-5 h-5 text-emerald-400" />,
    error: <AlertCircle className="w-5 h-5 text-red-400" />,
    info: <AlertCircle className="w-5 h-5 text-blue-400" />,
    warning: <AlertCircle className="w-5 h-5 text-amber-400" />,
  }
  el.className = `flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-lg ${colors[type]} animate-[slideIn_0.3s_ease]`
  el.innerHTML = `<span>${message}</span>`
  // 用 React render 有点重，直接简单提示
  el.textContent = message
  toastContainer.appendChild(el)
  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transform = 'translateX(20px)'
    el.style.transition = 'all 0.3s ease'
    setTimeout(() => el.remove(), 300)
  }, 3000)
}

// 空状态
export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-4 text-slate-600">{icon}</div>}
      <h3 className="text-lg font-medium text-slate-300">{title}</h3>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// 页面加载
export function PageLoader({ message = '加载中...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-slate-400 animate-spin mb-3" />
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  )
}

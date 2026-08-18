/**
 * 推理测试页面
 * - 在线对话
 * - OpenAI 兼容接口测试
 */

import { useEffect, useState, useRef } from 'react'
import {
  MessageSquare, Send, Bot, User, Loader2, Server,
  Trash2, Settings, Zap
} from 'lucide-react'
import {
  Card, Button, Select, Input, toast, PageLoader, EmptyState
} from '../components/ui'
import { deployApi, inferenceApi } from '../api/client'

export default function InferencePage() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedService, setSelectedService] = useState('')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [genParams, setGenParams] = useState({
    max_tokens: 512,
    temperature: 0.7,
    top_p: 0.9,
  })

  const messagesEndRef = useRef(null)

  useEffect(() => {
    deployApi.listServices().then(data => {
      const running = (data.services || []).filter(s => s.status === 'running')
      setServices(running)
      if (running.length > 0) {
        setSelectedService(running[0].service_name)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || !selectedService) return

    const userMsg = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setSending(true)

    try {
      const resp = await inferenceApi.chat(selectedService, newMessages, genParams)

      if (resp.error) {
        throw new Error(resp.error.message || '推理失败')
      }

      const assistantMsg = {
        role: 'assistant',
        content: resp.choices?.[0]?.message?.content || '（空响应）',
      }
      setMessages([...newMessages, assistantMsg])
    } catch (err) {
      setMessages([...newMessages, {
        role: 'assistant',
        content: `❌ 请求失败: ${err.message}`,
        error: true,
      }])
      toast(`推理失败: ${err.message}`, 'error')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    setMessages([])
  }

  if (loading) return <PageLoader />

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-4xl mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 mb-1">推理测试</h2>
          <p className="text-sm text-slate-400">标准 OpenAI 兼容接口在线测试</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(!showSettings)}>
            <Settings className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClear} disabled={messages.length === 0}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 服务选择 + 参数设置 */}
      {showSettings && (
        <Card className="p-4 mb-3">
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="max_tokens"
              type="number"
              value={genParams.max_tokens}
              onChange={(e) => setGenParams({ ...genParams, max_tokens: parseInt(e.target.value) || 512 })}
            />
            <Input
              label="temperature"
              type="number"
              step="0.1"
              value={genParams.temperature}
              onChange={(e) => setGenParams({ ...genParams, temperature: parseFloat(e.target.value) || 0.7 })}
            />
            <Input
              label="top_p"
              type="number"
              step="0.1"
              value={genParams.top_p}
              onChange={(e) => setGenParams({ ...genParams, top_p: parseFloat(e.target.value) || 0.9 })}
            />
          </div>
        </Card>
      )}

      {/* 服务选择 */}
      {services.length === 0 ? (
        <Card className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<MessageSquare className="w-12 h-12" />}
            title="没有运行中的服务"
            description="请先部署模型并启动服务"
            action={
              <a href="/deploy" className="text-sm text-brand-400 hover:underline">去部署 →</a>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="p-3 mb-3">
            <Select
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
              options={services.map(s => ({ value: s.service_name, label: `${s.service_name} (${s.model_name})` }))}
            />
          </Card>

          {/* 对话区域 */}
          <Card className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <div className="w-14 h-14 bg-slate-700 rounded-2xl flex items-center justify-center mb-3">
                    <Bot className="w-7 h-7 text-slate-100" />
                  </div>
                  <p className="text-sm font-medium text-slate-300">开始对话</p>
                  <p className="text-xs text-slate-500 mt-1">输入消息，测试模型推理效果</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    {msg.role === 'assistant' && (
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${msg.error ? 'bg-red-900/30' : 'bg-slate-600'}`}>
                        <Bot className={`w-4 h-4 ${msg.error ? 'text-red-400' : 'text-slate-100'}`} />
                      </div>
                    )}
                    <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm ${
                      msg.role === 'user'
                        ? 'bg-brand-600 text-slate-900 rounded-tr-md'
                        : msg.error
                          ? 'bg-red-900/30 text-red-400 rounded-tl-md'
                          : 'bg-slate-700 text-slate-200 rounded-tl-md'
                    }`}>
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    </div>
                    {msg.role === 'user' && (
                      <div className="w-8 h-8 bg-slate-700 rounded-lg flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-slate-400" />
                      </div>
                    )}
                  </div>
                ))
              )}
              {sending && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-slate-600 rounded-lg flex items-center justify-center shrink-0">
                    <Loader2 className="w-4 h-4 text-slate-100 animate-spin" />
                  </div>
                  <div className="bg-slate-700 px-4 py-2.5 rounded-2xl rounded-tl-md">
                    <span className="text-sm text-slate-500">正在生成...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入区 */}
            <div className="border-t border-slate-700 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                  rows="1"
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent resize-none max-h-32 bg-slate-800"
                  style={{ minHeight: '42px' }}
                />
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="shrink-0"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

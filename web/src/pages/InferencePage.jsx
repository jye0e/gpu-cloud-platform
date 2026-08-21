/**
 * 推理测试页面
 * - 在线对话（支持流式和非流式）
 * - 思考过程 (reasoning_content) 区分显示
 * - 标准 OpenAI 兼容接口测试
 */

import { useEffect, useState, useRef } from 'react'
import {
  MessageSquare, Send, Bot, User, Loader2,
  Trash2, Settings, Zap, Brain, ChevronDown, ChevronUp,
  Pause
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
  const [streaming, setStreaming] = useState(true)
  const [expandedReasoning, setExpandedReasoning] = useState(new Set())
  const [genParams, setGenParams] = useState({
    max_tokens: 512,
    temperature: 0.7,
    top_p: 0.9,
  })

  const messagesEndRef = useRef(null)
  const abortControllerRef = useRef(null)

  // 根据 service_name 查找对应的 model_name
  const selectedServiceInfo = services.find(s => s.service_name === selectedService)
  const modelName = selectedServiceInfo?.model_name || ''

  const toggleReasoning = (idx) => {
    setExpandedReasoning(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  useEffect(() => {
    deployApi.listServices().then(data => {
      const running = (data.services || []).filter(s => s.status === 'running')
      setServices(running)
      if (running.length > 0) {
        setSelectedService(running[0].service_name)
      }
      setLoading(false)
    }).catch(() => setLoading(false))

    // 组件卸载时清理未完成的请求
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || !selectedService || sending) return

    const userMsg = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    const assistantMsg = {
      role: 'assistant',
      content: '',
      reasoning: '',
      streaming: true,
    }
    setMessages([...newMessages, assistantMsg])
    setInput('')
    setSending(true)

    // 创建新的 AbortController
    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      if (streaming) {
        await inferenceApi.chatStream(
          selectedService,
          [...messages, userMsg],
          genParams,
          (chunk) => {
            if (chunk.done) {
              setMessages(prev => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, streaming: false } : m
              ))
              return
            }
            setMessages(prev => prev.map((m, i) => {
              if (i === prev.length - 1 && m.streaming) {
                return {
                  ...m,
                  content: m.content + (chunk.content || ''),
                  reasoning: m.reasoning + (chunk.reasoningContent || ''),
                }
              }
              return m
            }))
          },
          controller.signal,
          modelName,
        )
      } else {
        const resp = await inferenceApi.chat(
          selectedService,
          [...messages, userMsg],
          genParams,
          modelName,
        )
        if (resp.error) throw new Error(resp.error.message || '推理失败')

        const assistantMsgFinal = {
          role: 'assistant',
          content: resp.choices?.[0]?.message?.content || '（空响应）',
          reasoning: resp.choices?.[0]?.message?.reasoning_content || '',
          streaming: false,
        }
        setMessages([...newMessages, assistantMsgFinal])
      }
    } catch (err) {
      // AbortError 是主动中止，不算错误
      if (err.name === 'AbortError' || controller.signal.aborted) {
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, streaming: false } : m
        ))
      } else {
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, error: true, content: `❌ 请求失败: ${err.message}`, streaming: false } : m
        ))
        toast(`推理失败: ${err.message}`, 'error')
      }
    } finally {
      setSending(false)
      abortControllerRef.current = null
    }
  }

  const handleStop = () => {
    abortControllerRef.current?.abort()
    setSending(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    abortControllerRef.current?.abort()
    setMessages([])
  }

  if (loading) return <PageLoader />

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-4xl mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 mb-1">推理测试</h2>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span>{streaming ? '流式对话 · SSE 实时输出' : '非流式对话 · 完整响应'}</span>
            {modelName && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-800 rounded text-xs text-slate-300 border border-slate-600">
                <Bot className="w-3 h-3" />
                {modelName}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStreaming(!streaming)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              streaming
                ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-700'
                : 'bg-slate-700 text-slate-400 border border-slate-600 hover:bg-slate-600'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            {streaming ? '流式' : '非流式'}
          </button>
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(!showSettings)}>
            <Settings className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClear} disabled={messages.length === 0}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 参数设置 */}
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
              onChange={(e) => {
                setSelectedService(e.target.value)
                setMessages([])  // 切换服务时清空对话
              }}
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
                  <p className="text-xs text-slate-500 mt-1">
                    {streaming ? '流式输出：模型思考过程和最终答案实时呈现' : '非流式：等待模型完整响应'}
                  </p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    {msg.role === 'assistant' && (
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        msg.error ? 'bg-red-900/30' : 'bg-slate-600'
                      }`}>
                        <Bot className={`w-4 h-4 ${msg.error ? 'text-red-400' : 'text-slate-100'}`} />
                      </div>
                    )}

                    <div className={`max-w-[75%] ${msg.role === 'user' ? '' : 'flex-1'}`}>
                      {msg.role === 'user' ? (
                        <div className="px-4 py-2.5 rounded-2xl text-sm bg-brand-600 text-slate-900 rounded-tr-md">
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        </div>
                      ) : (
                        <div className={`rounded-2xl rounded-tl-md overflow-hidden ${
                          msg.error ? 'bg-red-900/30 border border-red-800' : 'bg-slate-700 border border-slate-600'
                        }`}>
                          {/* 思考过程 */}
                          {msg.reasoning && (
                            <div className="border-b border-slate-600">
                              <button
                                onClick={() => toggleReasoning(i)}
                                className="w-full flex items-center justify-between px-3 py-2 bg-slate-800/50 hover:bg-slate-800 text-xs text-slate-400 transition-colors"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Brain className="w-3.5 h-3.5" />
                                  {expandedReasoning.has(i) ? '隐藏思考过程' : `查看思考过程 (${msg.reasoning.length} 字符)`}
                                </span>
                                {expandedReasoning.has(i) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                              </button>
                              {expandedReasoning.has(i) && (
                                <div className="px-3 py-2.5 bg-slate-900/50 border-b border-slate-600">
                                  <p className="whitespace-pre-wrap break-words text-xs text-slate-500 italic leading-relaxed">
                                    {msg.reasoning}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                          {/* 最终回答 */}
                          <div className="px-4 py-2.5">
                            <p className={`whitespace-pre-wrap break-words text-sm ${
                              msg.error ? 'text-red-400' : 'text-slate-200'
                            }`}>
                              {msg.content || (msg.streaming && !msg.error ? '正在生成...' : '')}
                              {msg.streaming && !msg.error && msg.content && (
                                <span className="inline-block w-1.5 h-4 bg-slate-400 ml-0.5 animate-pulse align-middle" />
                              )}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {msg.role === 'user' && (
                      <div className="w-8 h-8 bg-slate-700 rounded-lg flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-slate-400" />
                      </div>
                    )}
                  </div>
                ))
              )}
              {sending && !messages[messages.length - 1]?.streaming && (
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
                {sending ? (
                  <Button onClick={handleStop} variant="danger" className="shrink-0">
                    <Pause className="w-4 h-4" /> 停止
                  </Button>
                ) : (
                  <Button
                    onClick={handleSend}
                    disabled={!input.trim() || !selectedService}
                    className="shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
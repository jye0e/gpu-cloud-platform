/**
 * 模型上传页面
 * - 文件选择
 * - 分片上传
 * - 实时进度
 * - 断点续传
 */

import { useState, useRef, useCallback } from 'react'
import {
  Upload, FileText, CheckCircle, XCircle, Loader2,
  Pause, Play, Trash2, CloudUpload
} from 'lucide-react'
import {
  Card, Button, Progress, toast, EmptyState
} from '../components/ui'
import { uploadApi } from '../api/client'

const CHUNK_SIZE = 10 * 1024 * 1024 // 10MB

export default function UploadPage() {
  const [file, setFile] = useState(null)
  const [taskId, setTaskId] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 })
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState(null)

  const fileInputRef = useRef(null)
  const pauseRef = useRef(false)
  const cancelRef = useRef(false)

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const handleFileSelect = (e) => {
    const f = e.target.files[0]
    if (!f) return

    // 校验扩展名
    const ext = f.name.split('.').pop().toLowerCase()
    const allowed = ['safetensors', 'gguf', 'bin', 'pt', 'pth']
    if (!allowed.includes(ext)) {
      toast(`不支持的文件格式: .${ext}，仅支持 ${allowed.join(', ')}`, 'error')
      return
    }

    setFile(f)
    setTaskId(null)
    setCompleted(false)
    setError(null)
    setProgress({ current: 0, total: 0, percent: 0 })
  }

  const startUpload = async () => {
    if (!file) return

    setUploading(true)
    setPaused(false)
    pauseRef.current = false
    cancelRef.current = false
    setError(null)

    try {
      // 1. 初始化上传任务
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
      const initResp = await uploadApi.init({
        model_name: file.name,
        total_size: file.size,
        chunk_size: CHUNK_SIZE,
      })

      setTaskId(initResp.task_id)
      setProgress({ current: initResp.uploaded_chunks, total: totalChunks, percent: (initResp.uploaded_chunks / totalChunks) * 100 })

      // 2. 分片上传（支持断点续传）
      for (let i = initResp.uploaded_chunks; i < totalChunks; i++) {
        if (cancelRef.current) break

        // 暂停检测
        while (pauseRef.current && !cancelRef.current) {
          await new Promise(r => setTimeout(r, 500))
        }
        if (cancelRef.current) break

        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, file.size)
        const chunk = file.slice(start, end)

        await uploadApi.uploadChunk(initResp.task_id, i, chunk)

        setProgress({
          current: i + 1,
          total: totalChunks,
          percent: ((i + 1) / totalChunks) * 100,
        })
      }

      if (cancelRef.current) {
        toast('上传已取消', 'warning')
        setUploading(false)
        return
      }

      // 3. 完成上传
      toast('正在合并分片...', 'info')
      const result = await uploadApi.complete(initResp.task_id)

      setCompleted(true)
      setUploading(false)
      toast(`模型上传完成: ${result.model_name}`, 'success')

    } catch (err) {
      console.error('Upload error:', err)
      setError(err.message || '上传失败')
      setUploading(false)
      toast(`上传失败: ${err.message}`, 'error')
    }
  }

  const handlePause = () => {
    pauseRef.current = !pauseRef.current
    setPaused(pauseRef.current)
  }

  const handleCancel = async () => {
    cancelRef.current = true
    if (taskId) {
      try {
        await uploadApi.cancel(taskId)
      } catch (e) {
        // ignore
      }
    }
    setUploading(false)
    setPaused(false)
    setTaskId(null)
    setProgress({ current: 0, total: 0, percent: 0 })
    toast('上传已取消', 'warning')
  }

  const handleReset = () => {
    setFile(null)
    setTaskId(null)
    setCompleted(false)
    setError(null)
    setProgress({ current: 0, total: 0, percent: 0 })
    setUploading(false)
    setPaused(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) {
      const ext = f.name.split('.').pop().toLowerCase()
      const allowed = ['safetensors', 'gguf', 'bin', 'pt', 'pth']
      if (!allowed.includes(ext)) {
        toast(`不支持的文件格式: .${ext}`, 'error')
        return
      }
      setFile(f)
      setCompleted(false)
      setError(null)
      setProgress({ current: 0, total: 0, percent: 0 })
    }
  }, [])

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">模型上传</h2>
        <p className="text-sm text-slate-400">支持分片上传、断点续传，适用于大模型文件传输</p>
      </div>

      {completed ? (
        /* 上传完成 */
        <Card className="p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-900/30 rounded-full mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-100 mb-1">上传完成</h3>
          <p className="text-sm text-slate-400 mb-4">{file?.name} 已成功上传</p>
          <div className="flex justify-center gap-3">
            <Button onClick={handleReset} variant="outline">
              继续上传
            </Button>
            <Button onClick={() => window.location.href = '/deploy'}>
              去部署 →
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {/* 文件选择区 */}
          {!file ? (
            <Card className="p-0">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-600 rounded-xl p-12 text-center cursor-pointer hover:border-slate-400 hover:bg-slate-700/30 transition-all"
              >
                <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-700 rounded-2xl mb-4">
                  <CloudUpload className="w-8 h-8 text-slate-500" />
                </div>
                <p className="text-base font-medium text-slate-200">点击或拖拽文件到此处</p>
                <p className="text-sm text-slate-500 mt-1">支持 .safetensors / .gguf / .bin / .pt / .pth 格式</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileSelect}
                  accept=".safetensors,.gguf,.bin,.pt,.pth"
                />
              </div>
            </Card>
          ) : (
            /* 上传进度区 */
            <Card className="p-6">
              {/* 文件信息 */}
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-slate-100" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{file.name}</p>
                    <p className="text-xs text-slate-500">{formatSize(file.size)}</p>
                  </div>
                </div>
                {!uploading && !completed && (
                  <button onClick={handleReset} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500">
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* 进度条 */}
              {progress.total > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-slate-300">
                      {paused ? '已暂停' : uploading ? '上传中...' : '准备上传'}
                      {error && <span className="text-red-400"> · {error}</span>}
                    </span>
                    <span className="text-slate-500">
                      {progress.current} / {progress.total} 分片
                    </span>
                  </div>
                  <Progress
                    value={progress.percent}
                    color={error ? 'danger' : completed ? 'success' : 'brand'}
                  />
                  <p className="text-xs text-slate-500 mt-1.5">
                    {progress.percent.toFixed(1)}%
                  </p>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex gap-3">
                {!uploading && !error && progress.current === 0 && (
                  <Button onClick={startUpload} className="flex-1">
                    <Upload className="w-4 h-4" />
                    开始上传
                  </Button>
                )}
                {uploading && (
                  <>
                    <Button onClick={handlePause} variant="outline" className="flex-1">
                      {paused ? <><Play className="w-4 h-4" /> 继续</> : <><Pause className="w-4 h-4" /> 暂停</>}
                    </Button>
                    <Button onClick={handleCancel} variant="danger" className="flex-1">
                      <Trash2 className="w-4 h-4" />
                      取消
                    </Button>
                  </>
                )}
                {error && (
                  <Button onClick={startUpload} className="flex-1">
                    <Upload className="w-4 h-4" />
                    重试
                  </Button>
                )}
              </div>
            </Card>
          )}

          {/* 说明 */}
          <Card className="p-5 bg-slate-700/50 border-slate-700">
            <h4 className="text-sm font-medium text-slate-200 mb-2">上传说明</h4>
            <ul className="space-y-1.5 text-xs text-slate-400">
              <li>• 默认分片大小 10MB，支持断点续传，网络中断后可继续上传</li>
              <li>• 仅支持 safetensors、gguf、bin、pt、pth 格式的模型权重文件</li>
              <li>• 上传完成后系统自动校验文件完整性（SHA256）</li>
              <li>• 存储空间受租户配额限制，如需扩容请联系管理员</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}

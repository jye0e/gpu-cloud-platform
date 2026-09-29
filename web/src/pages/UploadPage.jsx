/**
 * 模型上传页面
 * - 文件选择
 * - 分片上传
 * - 实时进度
 * - 断点续传
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Upload, FileText, CheckCircle, XCircle, Loader2,
  Pause, Play, Trash2, CloudUpload, Download, X, ArrowRight
} from 'lucide-react'
import {
  Card, Button, Progress, toast, EmptyState, Select
} from '../components/ui'
import { uploadApi } from '../api/client'

const CHUNK_SIZE = 10 * 1024 * 1024 // 10MB

const IMPORT_STATUS_MAP = {
  downloading: { label: '下载中', color: 'text-brand-300' },
  completed: { label: '已完成', color: 'text-emerald-400' },
  failed: { label: '失败', color: 'text-red-400' },
  cancelled: { label: '已取消', color: 'text-slate-500' },
}

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

  // 模型库导入
  const [importSource, setImportSource] = useState('modelscope')
  const [repoId, setRepoId] = useState('')
  const [importing, setImporting] = useState(false)
  const [importTasks, setImportTasks] = useState([])

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

  // ---- 模型库导入 ----
  const refreshImports = useCallback(async () => {
    try {
      const data = await uploadApi.listImports()
      setImportTasks(data.tasks || [])
    } catch { /* 静默失败 */ }
  }, [])

  useEffect(() => { refreshImports() }, [refreshImports])

  const hasActiveImport = importTasks.some(t => ['downloading', 'pending'].includes(t.status))

  useEffect(() => {
    if (!hasActiveImport) return
    const timer = setInterval(refreshImports, 2000)
    return () => clearInterval(timer)
  }, [hasActiveImport, refreshImports])

  const startImport = async () => {
    if (!repoId.trim()) {
      toast('请输入模型仓库名称', 'warning')
      return
    }
    setImporting(true)
    try {
      await uploadApi.importModel({ repo_id: repoId.trim(), source: importSource })
      toast('导入任务已创建，开始下载', 'success')
      setRepoId('')
      refreshImports()
    } catch (err) {
      toast(`导入失败: ${err.message}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  const cancelImport = async (taskId) => {
    try {
      await uploadApi.cancelImport(taskId)
      toast('已请求取消', 'warning')
      refreshImports()
    } catch (err) {
      toast(`取消失败: ${err.message}`, 'error')
    }
  }

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

      {/* 模型库导入 */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <Download className="w-5 h-5 text-brand-300" />
          <h3 className="font-semibold text-slate-100">从模型库导入完整模型</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          自动拉取全部权重分片和 config.json / tokenizer 等配置文件，无需逐个上传（分片模型推荐用此方式）
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Select
            value={importSource}
            onChange={(e) => setImportSource(e.target.value)}
            options={[
              { value: 'modelscope', label: 'ModelScope（国内快）' },
              { value: 'hf', label: 'HuggingFace' },
            ]}
          />
          <input
            value={repoId}
            onChange={(e) => setRepoId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && startImport()}
            placeholder="例如: Qwen/Qwen2.5-0.5B-Instruct"
            className="flex-1 px-3.5 py-2.5 rounded-lg border border-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all bg-slate-800"
          />
          <Button onClick={startImport} loading={importing} disabled={!repoId.trim()}>
            <Download className="w-4 h-4" /> 导入
          </Button>
        </div>

        {/* 导入任务列表 */}
        {importTasks.length > 0 && (
          <div className="mt-5 space-y-3">
            {importTasks.map(t => {
              const st = IMPORT_STATUS_MAP[t.status] || { label: t.status, color: 'text-slate-400' }
              return (
                <div key={t.task_id} className="p-4 rounded-lg border border-slate-700 bg-slate-800/50">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate font-mono">{t.repo_id}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {t.files_done}/{t.files_total} 个文件 · {formatSize(t.downloaded_bytes)} / {formatSize(t.total_bytes)}
                        {t.status === 'downloading' && ` · ${t.speed_mb_s} MB/s`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-medium ${st.color}`}>{st.label}</span>
                      {t.status === 'downloading' && (
                        <button
                          onClick={() => cancelImport(t.task_id)}
                          className="p-1 rounded hover:bg-slate-700 text-slate-500"
                          title="取消导入"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {t.status === 'downloading' && (
                    <>
                      <Progress value={t.progress_percent} />
                      <p className="text-xs text-slate-600 mt-1.5 truncate">
                        {t.current_file ? `正在下载: ${t.current_file}` : '准备中...'}
                      </p>
                    </>
                  )}
                  {t.status === 'failed' && t.error && (
                    <p className="text-xs text-red-400 mt-1">{t.error}</p>
                  )}
                  {t.status === 'completed' && (
                    <a href="/deploy" className="text-xs text-brand-300 hover:underline inline-flex items-center gap-1 mt-1">
                      去部署 <ArrowRight className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

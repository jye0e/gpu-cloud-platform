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
const WEIGHT_EXTS = ['safetensors', 'gguf', 'bin', 'pt', 'pth']

const IMPORT_STATUS_MAP = {
  downloading: { label: '下载中', color: 'text-brand-300' },
  completed: { label: '已完成', color: 'text-emerald-400' },
  failed: { label: '失败', color: 'text-red-400' },
  cancelled: { label: '已取消', color: 'text-slate-500' },
}

export default function UploadPage() {
  // 多文件模型：entries = [{ file, name }]，name 为模型内相对路径
  const [entries, setEntries] = useState([])
  const [modelName, setModelName] = useState('')
  const [taskId, setTaskId] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [merging, setMerging] = useState(false)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 })
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState(null)

  const fileInputRef = useRef(null)
  const folderInputRef = useRef(null)
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

  const isMulti = entries.length > 1 || entries.some(e => e.name.includes('/'))
  const totalSize = entries.reduce((s, e) => s + e.file.size, 0)

  // 清单校验 + 归一化（相对路径、去重）；成功则更新选择状态
  const acceptEntries = (fileList) => {
    const arr = [...fileList].map(f => ({
      file: f,
      name: (f.webkitRelativePath || f.name).replace(/\\/g, '/'),
    }))
    if (arr.length === 0) return

    for (const e of arr) {
      if (e.name.split('/').some(p => !p || p === '.' || p === '..')) {
        toast(`非法文件路径: ${e.name}`, 'error')
        return
      }
    }
    if (new Set(arr.map(e => e.name)).size !== arr.length) {
      toast('所选文件中存在重名路径', 'error')
      return
    }

    const multi = arr.length > 1 || arr.some(e => e.name.includes('/'))
    if (!multi) {
      const ext = arr[0].name.split('.').pop().toLowerCase()
      if (!WEIGHT_EXTS.includes(ext)) {
        toast(`不支持的文件格式: .${ext}，仅支持 ${WEIGHT_EXTS.join(', ')}`, 'error')
        return
      }
    } else if (!arr.some(e => WEIGHT_EXTS.includes(e.name.split('.').pop().toLowerCase()))) {
      toast(`多文件模型必须至少包含一个权重文件（${WEIGHT_EXTS.join(', ')}）`, 'error')
      return
    }

    // 模型名推导：整文件夹选择时用文件夹名，否则用首个文件名去扩展名
    let name
    const firstSegs = arr.map(e => e.name.split('/')[0])
    if (arr.every(e => e.name.includes('/')) && new Set(firstSegs).size === 1) {
      name = firstSegs[0]
    } else {
      const base = arr[0].name.split('/').pop()
      name = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base
    }
    setModelName(name.replace(/[\\/:*?"<>|]/g, '_'))

    setEntries(arr)
    setTaskId(null)
    setCompleted(false)
    setError(null)
    setProgress({ current: 0, total: 0, percent: 0 })
  }

  const handleFileSelect = (e) => {
    acceptEntries(e.target.files)
    e.target.value = ''
  }

  const startUpload = async () => {
    if (entries.length === 0) return

    const multi = entries.length > 1 || entries.some(e => e.name.includes('/'))
    if (multi && !modelName.trim()) {
      toast('请输入模型名称', 'error')
      return
    }

    setUploading(true)
    setPaused(false)
    pauseRef.current = false
    cancelRef.current = false
    setError(null)

    try {
      // 分片 = 清单顺序拼接的字节流；累计偏移表用于跨文件切片
      let offset = 0
      const spans = entries.map(e => {
        const start = offset
        offset += e.file.size
        return { ...e, start, end: offset }
      })
      const totalChunks = Math.ceil(offset / CHUNK_SIZE)

      const sliceStream = (i) => {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, offset)
        const parts = []
        for (const sp of spans) {
          if (sp.end <= start || sp.start >= end) continue
          parts.push(sp.file.slice(
            Math.max(start, sp.start) - sp.start,
            Math.min(end, sp.end) - sp.start,
          ))
        }
        return new Blob(parts, { type: 'application/octet-stream' })
      }

      // 1. 初始化上传任务
      const initResp = await uploadApi.init({
        model_name: multi ? modelName.trim() : entries[0].name,
        total_size: offset,
        chunk_size: CHUNK_SIZE,
        ...(multi
          ? { files: entries.map(e => ({ name: e.name, size: e.file.size })) }
          : {}),
      })

      setTaskId(initResp.task_id)
      setProgress({
        current: initResp.uploaded_chunks,
        total: totalChunks,
        percent: (Math.min(initResp.uploaded_chunks * CHUNK_SIZE, offset) / offset) * 100,
      })

      // 2. 分片上传（支持断点续传）
      for (let i = initResp.uploaded_chunks; i < totalChunks; i++) {
        if (cancelRef.current) break

        // 暂停检测
        while (pauseRef.current && !cancelRef.current) {
          await new Promise(r => setTimeout(r, 500))
        }
        if (cancelRef.current) break

        await uploadApi.uploadChunk(initResp.task_id, i, sliceStream(i), (loaded) => {
          // 片内字节级进度：大分片慢网下进度条不再长时间停滞
          setProgress({
            current: i,
            total: totalChunks,
            percent: (Math.min(i * CHUNK_SIZE + loaded, offset) / offset) * 100,
          })
        })

        setProgress({
          current: i + 1,
          total: totalChunks,
          percent: (Math.min((i + 1) * CHUNK_SIZE, offset) / offset) * 100,
        })
      }

      if (cancelRef.current) {
        toast('上传已取消', 'warning')
        setUploading(false)
        return
      }

      // 3. 完成上传（合并/切分校验耗时，显示独立状态避免误以为卡死）
      toast('正在合并分片...', 'info')
      setMerging(true)
      try {
        const result = await uploadApi.complete(initResp.task_id)
        setCompleted(true)
        toast(`模型上传完成: ${result.model_name}`, 'success')
      } finally {
        setMerging(false)
      }
      setUploading(false)

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
    setEntries([])
    setModelName('')
    setTaskId(null)
    setCompleted(false)
    setError(null)
    setProgress({ current: 0, total: 0, percent: 0 })
    setUploading(false)
    setPaused(false)
    setMerging(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (folderInputRef.current) folderInputRef.current.value = ''
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    if (e.dataTransfer.files?.length) acceptEntries(e.dataTransfer.files)
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
    <div className="space-y-6">
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
          <p className="text-sm text-slate-400 mb-4">{modelName} 已成功上传{isMulti ? `（${entries.length} 个文件）` : ''}</p>
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
          {entries.length === 0 ? (
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
                <p className="text-sm text-slate-500 mt-1">
                  单个权重文件，或多个文件（含 config.json / tokenizer 等）
                </p>
                <div className="flex justify-center gap-3 mt-4" onClick={(e) => e.stopPropagation()}>
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <FileText className="w-4 h-4" /> 选择文件（可多选）
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => folderInputRef.current?.click()}>
                    <Upload className="w-4 h-4" /> 选择模型文件夹
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  webkitdirectory=""
                  directory=""
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>
            </Card>
          ) : (
            /* 上传进度区 */
            <Card className="p-6">
              {/* 文件信息 */}
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-slate-100" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {isMulti ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 shrink-0">模型名称</span>
                          <input
                            value={modelName}
                            onChange={(e) => setModelName(e.target.value)}
                            disabled={uploading}
                            className="flex-1 min-w-0 h-8 px-2 rounded-md border border-slate-600 bg-slate-800 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60"
                          />
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          {entries.length} 个文件 · {formatSize(totalSize)}
                          {isMulti && entries.length > 0 && (
                            <span className="text-slate-600">
                              {' · '}如为训练目录，建议排除 optimizer.pt / trainer_state 等非推理文件
                            </span>
                          )}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-slate-200 truncate">{entries[0]?.name}</p>
                        <p className="text-xs text-slate-500">{formatSize(totalSize)}</p>
                      </>
                    )}
                  </div>
                </div>
                {!uploading && !completed && (
                  <button onClick={handleReset} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500">
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* 多文件清单（限高滚动） */}
              {isMulti && entries.length > 1 && !uploading && (
                <div className="mb-4 max-h-32 overflow-y-auto rounded-lg border border-slate-700 divide-y divide-slate-700/60">
                  {entries.map(e => (
                    <div key={e.name} className="flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className="text-slate-400 truncate min-w-0">{e.name}</span>
                      <span className="text-slate-600 shrink-0 ml-3">{formatSize(e.file.size)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 进度条 */}
              {progress.total > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-slate-300">
                      {merging ? '合并分片中...' : paused ? '已暂停' : uploading ? '上传中...' : '准备上传'}
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
                {uploading && !merging && (
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
                {merging && (
                  <Button variant="outline" className="flex-1" disabled>
                    <Loader2 className="w-4 h-4 animate-spin" /> 正在合并分片
                  </Button>
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
              <li>• 支持单个权重文件，也支持多文件完整模型（config.json / tokenizer / 多个分片，或直接选模型文件夹）</li>
              <li>• 权重格式支持 safetensors、gguf、bin、pt、pth；多文件清单中至少要有一个权重文件</li>
              <li>• 上传完成后自动按磁盘校验分片完整性与总大小；API 调用可附带期望 SHA256 做内容比对</li>
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
          <div className="sm:w-52 shrink-0">
            <Select
              className="h-11"
              value={importSource}
              onChange={(e) => setImportSource(e.target.value)}
              options={[
                { value: 'modelscope', label: 'ModelScope（国内快）' },
                { value: 'hf', label: 'HuggingFace' },
              ]}
            />
          </div>
          <input
            value={repoId}
            onChange={(e) => setRepoId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && startImport()}
            placeholder="例如: Qwen/Qwen2.5-0.5B-Instruct"
            className="flex-1 min-w-0 h-11 px-3.5 py-2.5 rounded-lg border border-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all bg-slate-800"
          />
          <Button className="h-11 px-6" onClick={startImport} loading={importing} disabled={!repoId.trim()}>
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

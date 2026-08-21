/**
 * API 客户端
 * 统一封装所有后端接口调用
 */

const BASE_URL = ''

function getToken() {
  return localStorage.getItem('token') || ''
}

function getAdminToken() {
  return localStorage.getItem('adminToken') || ''
}

async function request(url, options = {}) {
  const isAdmin = url.startsWith('/admin/')
  const token = isAdmin ? getAdminToken() : getToken()

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }
  if (token) {
    headers['Authorization'] = isAdmin ? undefined : `Bearer ${token}`
    if (isAdmin) {
      headers['X-Admin-Token'] = token
    }
  }

  const resp = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers,
  })

  const data = await resp.json().catch(() => ({}))

  if (!resp.ok) {
    throw new Error(data.detail || data.message || `请求失败 (${resp.status})`)
  }

  return data
}

// ==================== 管理端 API ====================

export const adminApi = {
  createTenant: (body) =>
    request('/admin/tenants', { method: 'POST', body: JSON.stringify(body) }),

  listTenants: () =>
    request('/admin/tenants'),

  getTenant: (tenantId) =>
    request(`/admin/tenants/${tenantId}`),

  updateTenantStatus: (tenantId, status) =>
    request(`/admin/tenants/${tenantId}/status?new_status=${status}`, { method: 'PATCH' }),

  getGpuOverview: () =>
    request('/admin/gpu/overview'),

  updateTenantQuota: (tenantId, body) =>
    request(`/admin/tenants/${tenantId}/quota`, { method: 'PATCH', body: JSON.stringify(body) }),
}

// ==================== 租户端 - 模型上传 ====================

export const uploadApi = {
  init: (body) =>
    request('/api/tenant/upload_model/init', { method: 'POST', body: JSON.stringify(body) }),

  uploadChunk: (taskId, chunkIndex, chunkData) => {
    const formData = new FormData()
    formData.append('file', chunkData)
    return fetch(`${BASE_URL}/api/tenant/upload_model/chunk?task_id=${taskId}&chunk_index=${chunkIndex}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` },
      body: formData,
    }).then(r => r.json())
  },

  complete: (taskId) =>
    request(`/api/tenant/upload_model/complete?task_id=${taskId}`, { method: 'POST' }),

  getStatus: (taskId) =>
    request(`/api/tenant/upload_model/status?task_id=${taskId}`),

  cancel: (taskId) =>
    request(`/api/tenant/upload_model/cancel?task_id=${taskId}`, { method: 'DELETE' }),
}

// ==================== 租户端 - 部署与服务管理 ====================

export const deployApi = {
  listModels: () =>
    request('/api/tenant/models'),

  listEngines: () =>
    request('/api/tenant/engines'),

  deploy: (body) =>
    request('/api/tenant/deploy', { method: 'POST', body: JSON.stringify(body) }),

  listServices: () =>
    request('/api/tenant/service_info'),

  getServiceDetail: (serviceId) =>
    request(`/api/tenant/service_info/${serviceId}`),

  operate: (body) =>
    request('/api/tenant/service_operate', { method: 'POST', body: JSON.stringify(body) }),

  getLogs: (serviceId, tail = 100) =>
    request(`/api/tenant/service_logs/${serviceId}?tail=${tail}`),
}

// ==================== 租户端 - 资源管理 ====================

export const resourceApi = {
  overview: () =>
    request('/api/tenant/resource_overview'),
}

// ==================== 租户端 - 推理测试 ====================

export const inferenceApi = {
  /**
   * 非流式对话
   * @param {string} serviceName - 服务名
   * @param {Array} messages - 消息列表
   * @param {Object} options - 生成参数 (max_tokens, temperature, top_p 等)
   * @param {string} modelName - 实际模型名
   */
  chat: async (serviceName, messages, options = {}, modelName = '') => {
    const resp = await fetch(`${BASE_URL}/api/tenant/inference/${serviceName}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
      },
      body: JSON.stringify({
        model: modelName || 'default',
        messages,
        ...options,
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      let errMsg = errText
      try {
        const parsed = JSON.parse(errText)
        errMsg = parsed.detail || parsed.message || errText
      } catch {}
      throw new Error(errMsg || `请求失败 (${resp.status})`)
    }

    return resp.json()
  },

  /**
   * 流式对话 (SSE)
   * @param {string} serviceName - 服务名
   * @param {Array} messages - 消息列表
   * @param {Object} options - 生成参数
   * @param {Function} onChunk - chunk 回调 (content, reasoningContent, done)
   * @param {AbortSignal} signal - 中止信号
   * @param {string} modelName - 实际模型名
   */
  chatStream: async (serviceName, messages, options = {}, onChunk, signal, modelName = '') => {
    return new Promise((resolve, reject) => {
      const url = `${BASE_URL}/api/tenant/inference/${serviceName}/v1/chat/completions`
      const xhr = new XMLHttpRequest()
      xhr.open('POST', url, true)
      xhr.setRequestHeader('Content-Type', 'application/json')
      xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`)
      xhr.setRequestHeader('Accept', 'text/event-stream')

      const body = JSON.stringify({
        model: modelName || 'default',
        messages,
        stream: true,
        ...options,
      })

      let buffer = ''
      let lastIndex = 0

      xhr.onreadystatechange = () => {
        if (xhr.readyState === 3 || xhr.readyState === 4) {
          const newData = xhr.responseText.slice(lastIndex)
          lastIndex = xhr.responseText.length
          buffer += newData

          // 解析 SSE 事件
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line) continue
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') {
                onChunk({ done: true })
                resolve()
                return
              }
              try {
                const parsed = JSON.parse(data)
                const delta = parsed.choices?.[0]?.delta || {}
                onChunk({
                  content: delta.content || '',
                  reasoningContent: delta.reasoning_content || '',
                  finishReason: parsed.choices?.[0]?.finish_reason,
                })
              } catch {
                // JSON 解析失败则跳过
              }
            }
          }
        }

        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300) {
            onChunk({ done: true })
            resolve()
          } else if (xhr.status === 0 && signal?.aborted) {
            onChunk({ done: true })
            resolve()
          } else {
            reject(new Error(`请求失败 (${xhr.status})`))
          }
        }
      }

      xhr.onerror = () => {
        if (signal?.aborted || xhr.status === 0) {
          onChunk({ done: true })
          resolve()
        } else {
          reject(new Error(`网络错误 (${xhr.status})`))
        }
      }

      xhr.onabort = () => {
        onChunk({ done: true })
        resolve()
      }

      if (signal) {
        if (signal.aborted) {
          xhr.abort()
          return
        }
        signal.addEventListener('abort', () => xhr.abort(), { once: true })
      }

      xhr.send(body)
    })
  },
}
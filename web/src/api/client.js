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
  chat: async (serviceName, messages, options = {}) => {
    const resp = await fetch(`${BASE_URL}/api/tenant/inference/${serviceName}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
      },
      body: JSON.stringify({
        model: 'default',
        messages,
        ...options,
      }),
    })
    return resp.json()
  },
}

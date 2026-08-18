/**
 * 应用入口
 * 路由配置
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Layout from './pages/Layout'
import Dashboard from './pages/Dashboard'
import UploadPage from './pages/UploadPage'
import DeployPage from './pages/DeployPage'
import ServicesPage from './pages/ServicesPage'
import ResourcesPage from './pages/ResourcesPage'
import InferencePage from './pages/InferencePage'
import AdminPage from './pages/AdminPage'

function RootRedirect() {
  const token = localStorage.getItem('token')
  const adminToken = localStorage.getItem('adminToken')
  if (adminToken) return <Navigate to="/admin" replace />
  if (token) return <Navigate to="/dashboard" replace />
  return <Navigate to="/login" replace />
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 默认跳转 */}
        <Route path="/" element={<RootRedirect />} />

        {/* 登录 */}
        <Route path="/login" element={<Login />} />

        {/* 管理端 */}
        <Route path="/admin" element={<AdminPage />} />

        {/* 租户管控台 */}
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/deploy" element={<DeployPage />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/inference" element={<InferencePage />} />
        </Route>

        {/* 兜底 */}
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

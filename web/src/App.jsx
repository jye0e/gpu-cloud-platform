/**
 * 应用入口
 * 路由配置
 */

import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Layout from './pages/Layout'
import Dashboard from './pages/Dashboard'
import UploadPage from './pages/UploadPage'
import DeployPage from './pages/DeployPage'
import ServicesPage from './pages/ServicesPage'
import ResourcesPage from './pages/ResourcesPage'
import InferencePage from './pages/InferencePage'
import AdminPage from './pages/AdminPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        {/* 登录 */}
        <Route path="/login" element={<Login />} />

        {/* 管理端 */}
        <Route path="/admin" element={<AdminPage />} />

        {/* 租户管控台 */}
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/deploy" element={<DeployPage />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/inference" element={<InferencePage />} />
        </Route>

        {/* 兜底 */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App

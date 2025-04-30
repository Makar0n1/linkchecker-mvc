import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import StartPage from './components/StartPage';
import LoginPage from './components/LoginPage';
import RegisterPage from './components/RegisterPage';
import Dashboard from './components/Dashboard';
import Projects from './components/Projects';
import ProjectDetails from './components/ProjectDetails';
import Profile from './components/Profile';
import ProtectedRoute from './ProtectedRoute'; // Создадим отдельный файл для ProtectedRoute

const App = () => (
  <div className="bg-gray-100 font-sans">
    <Routes>
      <Route path="/" element={<StartPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/app" element={<ProtectedRoute><Dashboard /></ProtectedRoute>}>
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:projectId" element={<ProjectDetails />} />
        <Route path="profile" element={<Profile />} />
        <Route path="" element={<Navigate to="projects" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  </div>
);

export default App;
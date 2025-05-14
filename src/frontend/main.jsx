import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import StartPage from './components/StartPage';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';
import Projects from './components/Projects';
import ProjectDetails from './components/ProjectDetails';
import Profile from './components/Profile';
import ScrollToTopButton from './components/ScrollToTopButton';
import FAQ from './components/FAQ';
import './styles.css';

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  if (!token) {
    console.log('ProtectedRoute: No token, redirecting to /login');
    return <Navigate to="/login" />;
  }
  return children;
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<StartPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/app" element={<ProtectedRoute><Dashboard /></ProtectedRoute>}>
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:projectId" element={<ProjectDetails />} />
        <Route path="profile" element={<Profile />} />
        <Route path="faq" element={<FAQ />} />
        <Route path="" element={<Navigate to="projects" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
    <ScrollToTopButton />
  </BrowserRouter>
);
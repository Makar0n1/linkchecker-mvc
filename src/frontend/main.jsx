import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import StartPage from './components/StartPage';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';
import ManualLinks from './components/ManualLinks';
import GoogleSheets from './components/GoogleSheets';
import './styles.css';

console.log('main.jsx loaded');

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<StartPage />} /> {/* Убрали PublicRoute */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/app" element={<ProtectedRoute><Dashboard /></ProtectedRoute>}>
        <Route path="manual" element={<ManualLinks />} />
        <Route path="sheets" element={<GoogleSheets />} />
        <Route path="" element={<Navigate to="manual" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  </BrowserRouter>
);
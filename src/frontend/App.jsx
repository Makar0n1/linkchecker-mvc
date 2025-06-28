import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import ScrollToTopButton from './components/ScrollToTopButton';
import axios from 'axios';

const App = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const rememberMeToken = localStorage.getItem('rememberMeToken');
    const apiBaseUrl = import.meta.env.MODE === 'production'
      ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
      : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

    if (rememberMeToken) {
      axios
        .post(`${apiBaseUrl}/verify-remember-me`, { rememberMeToken })
        .then((response) => {
          localStorage.setItem('token', response.data.token);
          navigate('/app');
        })
        .catch((err) => {
          console.error('Verify rememberMeToken failed:', err.response?.data);
          localStorage.removeItem('rememberMeToken');
          localStorage.removeItem('encryptedPassword');
          navigate('/login');
        });
    }
  }, [navigate]);

  return (
    <div className="bg-gray-100 font-sans">
      <Dashboard />
      <ScrollToTopButton />
    </div>
  );
};

export default App;
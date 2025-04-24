import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${apiBaseUrl}/login`, { username, password });
      
      const token = response.data.token;
      localStorage.setItem('token', token);
     
      // Добавляем небольшую задержку для синхронизации localStorage
      setTimeout(() => {
        navigate('/app');
       
      }, 100);
    } catch (err) {
      console.error('Login error:', err.response?.data);
      setError(err.response?.data?.error || 'An error occurred during login');
    }
  };

  const fadeInUp = {
    hidden: { opacity: 0, y: 50 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: 'easeOut' } },
  };

  return (
    <div className="bg-gray-100 min-h-screen flex flex-col font-sans">
      <header className="bg-green-600 text-white py-4 shadow-lg sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 flex justify-between items-center">
          <motion.h1
            onClick={() => navigate('/')}
            className="text-2xl sm:text-3xl font-bold tracking-tight cursor-pointer"
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
          >
            LinkSentry
          </motion.h1>
          <Link to="/">
            <motion.button
              className="bg-white text-green-600 px-3 sm:px-5 py-1 sm:py-2 rounded-full font-semibold hover:bg-green-100 transition-all shadow-md text-sm sm:text-base"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Back to Home
            </motion.button>
          </Link>
        </div>
      </header>
      <motion.div
        className="flex-1 flex items-center justify-center p-4"
        variants={fadeInUp}
        initial="hidden"
        animate="visible"
      >
        <div className="container max-w-md mx-auto bg-white shadow-lg rounded-lg p-6">
          <h1 className="text-3xl font-semibold text-gray-800 text-center mb-6">Login</h1>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50"
            />
            <button
              type="submit"
              className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors shadow-md"
            >
              Login
            </button>
          </form>
          {error && <p className="text-red-500 mt-4 text-center text-sm">{error}</p>}
        </div>
      </motion.div>
      <footer className="bg-gray-800 text-white py-4 sm:py-6">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-sm sm:text-base">© 2025 Link-Check-Pro.Top | All rights reserved.</p>
          <p className="mt-2 text-sm sm:text-base">
            Created by Kirill Shtepa{' '}
            <a href="https://github.com/Makar0n1/" className="underline hover:text-green-400">
              github.com/Makar0n1
            </a>{' '}
            | Have a great day! :)
          </p>
        </div>
      </footer>
    </div>
  );
};

export default LoginPage;
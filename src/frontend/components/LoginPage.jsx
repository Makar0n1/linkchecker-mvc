import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  useEffect(() => {
    const savedUsername = localStorage.getItem('username');
    const encryptedPassword = localStorage.getItem('encryptedPassword');
    const rememberMeToken = localStorage.getItem('rememberMeToken');

    if (savedUsername && encryptedPassword && rememberMeToken) {
      setLoading(true);
      axios
        .post(`${apiBaseUrl}/decrypt-password`, { encryptedPassword })
        .then((response) => {
          const decryptedPassword = response.data.decryptedPassword;
          setUsername(savedUsername);
          setPassword(decryptedPassword);
          setRememberMe(true);

          // Автоматический логин
          axios
            .post(
              `${apiBaseUrl}/login`,
              { username: savedUsername, password: decryptedPassword, rememberMe: true },
              { headers: { 'x-remember-me-token': rememberMeToken } }
            )
            .then((response) => {
              const { token, refreshToken, rememberMeToken: newToken } = response.data;
              localStorage.setItem('token', token);
              localStorage.setItem('refreshToken', refreshToken);
              if (newToken) localStorage.setItem('rememberMeToken', newToken);
              navigate('/app');
            })
            .catch((err) => {
              setError(err.response?.data?.error || 'Failed to auto-login');
              localStorage.removeItem('rememberMeToken');
              localStorage.removeItem('encryptedPassword');
            })
            .finally(() => setLoading(false));
        })
        .catch((err) => {
          setError(err.response?.data?.error || 'Failed to decrypt password');
          localStorage.removeItem('encryptedPassword');
          localStorage.removeItem('rememberMeToken');
          setLoading(false);
        });
    }
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let encryptedPassword = null;
      if (rememberMe) {
        const response = await axios.post(
          `${apiBaseUrl}/encrypt-password`,
          { password }
        );
        encryptedPassword = response.data.encryptedPassword;
      }

      const headers = localStorage.getItem('rememberMeToken')
        ? { 'x-remember-me-token': localStorage.getItem('rememberMeToken') }
        : {};
      const response = await axios.post(
        `${apiBaseUrl}/login`,
        { username, password, rememberMe },
        { headers }
      );

      const { token, refreshToken, rememberMeToken } = response.data;
      localStorage.setItem('token', token);
      localStorage.setItem('refreshToken', refreshToken);
      if (rememberMe && encryptedPassword) {
        localStorage.setItem('encryptedPassword', encryptedPassword);
        localStorage.setItem('username', username);
        if (rememberMeToken) localStorage.setItem('rememberMeToken', rememberMeToken);
      } else {
        localStorage.removeItem('encryptedPassword');
        localStorage.removeItem('username');
        localStorage.removeItem('rememberMeToken');
      }

      navigate('/app');
    } catch (err) {
      setError(err.response?.data?.error || 'An error occurred during login');
      if (err.response?.status === 403 && err.response?.data?.error.includes('Invalid rememberMe token')) {
        localStorage.removeItem('rememberMeToken');
        localStorage.removeItem('encryptedPassword');
      }
    } finally {
      setLoading(false);
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
          {error && (
            <p className="text-red-500 mt-4 text-center text-sm error-message">{error}</p>
          )}
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50"
              disabled={loading}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50"
              disabled={loading}
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                disabled={loading}
              />
              <label className="text-sm text-gray-700">Remember Me</label>
            </div>
            <button
              type="submit"
              className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors shadow-md disabled:bg-green-300"
              disabled={loading}
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
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
import React, { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { motion } from 'framer-motion';

// Функция для повторных попыток запроса
const retryRequest = async (fn, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`Retrying request (${i + 1}/${retries})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

const Dashboard = () => {
  const [user, setUser] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth >= 640);
  const navigate = useNavigate();
  const location = useLocation();
  const sidebarRef = useRef(null);

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  useEffect(() => {
    const token = localStorage.getItem('token');
    
    if (!token) {
      console.log('Dashboard: No token, redirecting to /login');
      navigate('/login');
      return;
    }

    const fetchUser = async () => {
      try {
        const response = await retryRequest(() =>
          axios.get(`${apiBaseUrl}/user`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        );
        
        setUser(response.data);
      } catch (err) {
        console.error('Dashboard: Error fetching user:', err);
        if (err.response?.status === 401) {
          console.log('Dashboard: Invalid token, redirecting to /login');
          localStorage.removeItem('token');
          navigate('/login');
        } else {
          console.log('Dashboard: Network or server error, keeping token');
          setUser({ username: 'Error loading user', plan: 'unknown', isSuperAdmin: false });
        }
      }
    };

    fetchUser();
  }, [navigate]);

  const handleLogout = async () => {
    const token = localStorage.getItem('token');
    
    // Отправляем запрос на сервер для инвалидации токенов в БД
    try {
      await axios.post(`${apiBaseUrl}/logout`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log('Dashboard: Logout successful on server');
    } catch (err) {
      console.error('Dashboard: Error during logout request:', err);
      // Продолжаем выход даже при ошибке
    }
    
    // Удаляем все токены и данные Remember Me из localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('rememberMeToken');
    localStorage.removeItem('encryptedPassword');
    localStorage.removeItem('username');
    
    navigate('/');
  };

  if (!user) return null;

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path);

  const planLimits = {
    free: 100,
    basic: 10000,
    pro: 50000,
    premium: 200000,
    enterprise: Infinity
  };
  const linksRemaining = user.isSuperAdmin ? 'Unlimited' : planLimits[user.plan] - (user.linksCheckedThisMonth || 0);

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 font-sans">
      <header className="bg-green-600 text-white py-4 shadow-lg sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <motion.h1
              onClick={() => navigate('/')}
              className="text-2xl sm:text-3xl font-bold tracking-tight cursor-pointer"
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
            >
              LinkSentry
            </motion.h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="text-green-100 text-sm sm:text-base hidden sm:inline">Logged in as: {user.username}</span>
            <motion.button
              onClick={() => navigate('/app/projects')}
              className="bg-white text-green-600 px-3 sm:px-5 py-1 sm:py-2 rounded-full font-semibold hover:bg-green-100 transition-all shadow-md text-sm sm:text-base"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Projects
            </motion.button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar для десктопа */}
        <motion.aside
          ref={sidebarRef}
          initial={{ width: isSidebarOpen ? 256 : 64 }}
          animate={{ width: isSidebarOpen ? 256 : 64 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="bg-green-600 text-white flex-shrink-0 shadow-lg hidden sm:block fixed top-[72px] left-0 z-40 h-screen"
        >
          <div className="flex flex-col h-full p-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className={`text-2xl font-bold ${isSidebarOpen ? 'block' : 'hidden'}`}>Dashboard</h2>
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="text-white focus:outline-none"
              >
                {isSidebarOpen ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto">
              <ul>
                <li className="mb-4">
                  <button
                    onClick={() => navigate('/app/projects')}
                    className={`w-full text-left p-2 rounded flex items-center gap-2 ${isActive('/app/projects') ? 'bg-green-700' : 'hover:bg-green-700'}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7h18M3 12h18m-7 5h7" />
                    </svg>
                    <span className={isSidebarOpen ? 'block' : 'hidden'}>Projects</span>
                  </button>
                </li>
                <li className="mb-4">
                  <button
                    onClick={() => navigate('/app/profile')}
                    className={`w-full text-left p-2 rounded flex items-center gap-2 ${isActive('/app/profile') ? 'bg-green-700' : 'hover:bg-green-700'}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className={isSidebarOpen ? 'block' : 'hidden'}>Profile</span>
                  </button>
                </li>
                <li className="mb-4">
                  <button
                    onClick={() => navigate('/app/faq')}
                    className={`w-full text-left p-2 rounded flex items-center gap-2 ${isActive('/app/faq') ? 'bg-green-700' : 'hover:bg-green-700'}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className={isSidebarOpen ? 'block' : 'hidden'}>FAQ</span>
                  </button>
                </li>
                <li className="mt-4">
                  <div className={`text-sm text-green-200 mb-2 ${isSidebarOpen ? 'block' : 'hidden'}`}>
                    Links Remaining: {linksRemaining}
                  </div>
                </li>
                <li className="mt-auto">
                  <div className={`text-sm text-green-200 mb-2 ${isSidebarOpen ? 'block' : 'hidden'}`}>
                    Logged in as: {user.username}
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left p-2 hover:bg-red-700 rounded bg-red-600 flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span className={isSidebarOpen ? 'block' : 'hidden'}>Logout</span>
                  </button>
                </li>
              </ul>
            </nav>
          </div>
        </motion.aside>
        <main
          className={`flex-grow p-4 sm:p-6 w-full h-auto transition-all duration-300 ease-in-out overflow-x-hidden pb-16 sm:pb-0
            ${isSidebarOpen ? 'sm:ml-[256px] custom-1300:ml-[256px]' : 'sm:ml-[64px] custom-1300:ml-[64px]'}`}
        >
          <Outlet />
        </main>
      </div>

      {/* Таб-бар для мобильной версии */}
      <motion.nav
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="sm:hidden bg-green-600 text-white fixed bottom-0 left-0 right-0 shadow-lg z-50"
      >
        <div className="flex justify-around items-center h-16">
          <motion.button
            onClick={() => navigate('/app/projects')}
            className={`flex flex-col items-center justify-center flex-1 h-full ${isActive('/app/projects') ? 'bg-green-700' : 'hover:bg-green-700'}`}
            whileTap={{ scale: 0.95 }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7h18M3 12h18m-7 5h7" />
            </svg>
            <span className="text-xs mt-1">Projects</span>
          </motion.button>
          <motion.button
            onClick={() => navigate('/app/profile')}
            className={`flex flex-col items-center justify-center flex-1 h-full ${isActive('/app/profile') ? 'bg-green-700' : 'hover:bg-green-700'}`}
            whileTap={{ scale: 0.95 }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-xs mt-1">Profile</span>
          </motion.button>
          <motion.button
            onClick={() => navigate('/app/faq')}
            className={`flex flex-col items-center justify-center flex-1 h-full ${isActive('/app/faq') ? 'bg-green-700' : 'hover:bg-green-700'}`}
            whileTap={{ scale: 0.95 }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs mt-1">FAQ</span>
          </motion.button>
          <motion.button
            onClick={handleLogout}
            className="flex flex-col items-center justify-center flex-1 h-full bg-red-600 hover:bg-red-700"
            whileTap={{ scale: 0.95 }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="text-xs mt-1">Logout</span>
          </motion.button>
        </div>
      </motion.nav>

      {/* Футер */}
      <footer className="sm:block hidden bg-gray-800 text-white py-4 sm:py-6 z-50 relative">
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

export default Dashboard;
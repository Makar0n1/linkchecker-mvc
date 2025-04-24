import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { motion } from 'framer-motion';

const Dashboard = () => {
  const [user, setUser] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth >= 640);
  const navigate = useNavigate();
  const location = useLocation();

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  useEffect(() => {
    const token = localStorage.getItem('token');
    console.log('Dashboard: Token in useEffect:', token); // Отладочный лог
    if (!token) {
      console.log('Dashboard: No token, redirecting to /login');
      navigate('/login');
      return;
    }

    const fetchUser = async () => {
      try {
        const response = await axios.get(`${apiBaseUrl}/user`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        console.log('Dashboard: User fetched:', response.data); // Отладочный лог
        setUser(response.data);
      } catch (err) {
        console.error('Dashboard: Error fetching user:', err);
        localStorage.removeItem('token');
        navigate('/login');
      }
    };

    fetchUser();
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('token');
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
              className="text-2xl sm:text-3xl font-bold tracking-tight"
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
      <nav className="bg-green-600 text-white py-2 sm:hidden sticky top-16 z-40">
        <div className="container max-w-7xl mx-auto px-4 flex gap-3 overflow-x-auto">
          <button
            onClick={() => navigate('/app/projects')}
            className={`px-3 py-1 rounded flex items-center gap-2 text-sm ${isActive('/app/projects') ? 'bg-green-700' : 'hover:bg-green-700'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7h18M3 12h18m-7 5h7" />
            </svg>
            Projects
          </button>
          <button
            onClick={() => navigate('/app/profile')}
            className={`px-3 py-1 rounded flex items-center gap-2 text-sm ${isActive('/app/profile') ? 'bg-green-700' : 'hover:bg-green-700'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Profile
          </button>
          <button
            onClick={handleLogout}
            className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 flex items-center gap-2 text-sm"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </div>
      </nav>
      <div className="flex flex-1 overflow-hidden">
        <motion.aside
          initial={{ width: isSidebarOpen ? 256 : 64 }}
          animate={{ width: isSidebarOpen ? 256 : 64 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="bg-green-600 text-white p-4 flex-shrink-0 shadow-lg hidden sm:block sm:static sm:h-auto sm:z-auto"
        >
          <div className="flex justify-between items-center mb-6">
            <h2 className={`text-2xl font-bold ${isSidebarOpen ? 'block' : 'hidden'} sm:${isSidebarOpen ? 'block' : 'hidden'}`}>Dashboard</h2>
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="text-white focus:outline-none hidden sm:block"
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
          <nav className="flex-1">
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
        </motion.aside>
        <main className="flex-grow p-4 sm:p-6 w-full overflow-x-hidden">
          <Outlet />
        </main>
      </div>
      <footer className="bg-gray-800 text-white py-4 sm:py-6 z-10 relative">
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
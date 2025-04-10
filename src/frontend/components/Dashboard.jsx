import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { motion } from 'framer-motion';

const Dashboard = () => {
  const [user, setUser] = useState(null);
  const [links, setLinks] = useState([]);
  const [urlList, setUrlList] = useState('');
  const [targetDomain, setTargetDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth >= 640);
  const navigate = useNavigate();
  const location = useLocation();

  const apiBaseUrl = `http://${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return navigate('/login');

    const fetchUser = async () => {
      try {
        const response = await axios.get(`${apiBaseUrl}/user`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setUser(response.data);

        // Проверяем, если пользователь на Free плане и пытается зайти на /sheets
        if (response.data.plan === 'free' && location.pathname === '/app/sheets') {
          navigate('/app/profile');
        }
      } catch (err) {
        localStorage.removeItem('token');
        navigate('/login');
      }
    };

    const fetchLinks = async () => {
      try {
        const response = await axios.get(apiBaseUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setLinks(response.data);
      } catch (err) {
        console.error('Failed to fetch links:', err);
      }
    };

    fetchUser();
    fetchLinks();
  }, [navigate, location.pathname]);

  const handleAddLinks = async (e) => {
    e.preventDefault();
    if (!urlList || !targetDomain) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const urls = urlList.split('\n').map(url => url.trim()).filter(url => url);
      const linksData = urls.map(url => ({ url, targetDomain }));
      const response = await axios.post(apiBaseUrl, linksData, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLinks([...links, ...response.data]);
      setUrlList('');
      setTargetDomain('');
    } catch (err) {
      console.error('Failed to add links:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckLinks = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(`${apiBaseUrl}/check`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLinks(response.data);
    } catch (err) {
      console.error('Failed to check links:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLink = async (id) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${apiBaseUrl}/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLinks(links.filter(link => link._id !== id));
    } catch (err) {
      console.error('Failed to delete link:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAllLinks = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      await axios.delete(apiBaseUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLinks([]);
    } catch (err) {
      console.error('Failed to delete all links:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/');
  };

  if (!user) return null;

  const isActive = (path) => location.pathname === path;

  // Лимиты ссылок
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
              LinkChecker Pro
            </motion.h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="text-green-100 text-sm sm:text-base hidden sm:inline">Logged in as: {user.username}</span>
            <motion.button
              onClick={() => navigate('/app/manual')}
              className="bg-white text-green-600 px-3 sm:px-5 py-1 sm:py-2 rounded-full font-semibold hover:bg-green-100 transition-all shadow-md text-sm sm:text-base"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Start Analyse
            </motion.button>
          </div>
        </div>
      </header>
      <nav className="bg-green-600 text-white py-2 sm:hidden sticky top-16 z-40">
        <div className="container max-w-7xl mx-auto px-4 flex gap-3 overflow-x-auto">
          <button
            onClick={() => navigate('/app/manual')}
            className={`px-3 py-1 rounded flex items-center gap-2 text-sm ${isActive('/app/manual') ? 'bg-green-700' : 'hover:bg-green-700'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Manual Links
          </button>
          {user.plan !== 'free' && (
            <button
              onClick={() => navigate('/app/sheets')}
              className={`px-3 py-1 rounded flex items-center gap-2 text-sm ${isActive('/app/sheets') ? 'bg-green-700' : 'hover:bg-green-700'}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17V7h10v10H9zm-4-5h2m0-2v4" />
              </svg>
              Google Sheets
            </button>
          )}
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
      <div className="flex flex-1 relative">
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
                  onClick={() => navigate('/app/manual')}
                  className={`w-full text-left p-2 rounded flex items-center gap-2 ${isActive('/app/manual') ? 'bg-green-700' : 'hover:bg-green-700'}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className={isSidebarOpen ? 'block' : 'hidden'}>Manual Links</span>
                </button>
              </li>
              {user.plan !== 'free' && (
                <li className="mb-4">
                  <button
                    onClick={() => navigate('/app/sheets')}
                    className={`w-full text-left p-2 rounded flex items-center gap-2 ${isActive('/app/sheets') ? 'bg-green-700' : 'hover:bg-green-700'}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17V7h10v10H9zm-4-5h2m0-2v4" />
                    </svg>
                    <span className={isSidebarOpen ? 'block' : 'hidden'}>Google Sheets</span>
                  </button>
                </li>
              )}
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
        <main className="flex-grow p-4 sm:p-6 w-full">
          <Outlet context={{ links, setLinks, urlList, setUrlList, targetDomain, setTargetDomain, loading, setLoading, handleAddLinks, handleCheckLinks, handleDeleteLink, handleDeleteAllLinks }} />
        </main>
      </div>
      <footer className="bg-gray-800 text-white py-4 sm:py-6 z-10 relative">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-sm sm:text-base">© 2025 LinkChecker Pro. All rights reserved.</p>
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
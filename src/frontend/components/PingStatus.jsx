import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const PingStatus = ({
  projectId,
  setLoading: setParentLoading,
}) => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    spreadsheetUrl: '',
    urlColumn: '',
    statusColumn: '',
    intervalDays: '1',
  });
  const [editForm, setEditForm] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [pingSpreadsheets, setPingSpreadsheets] = useState([]);
  const [checkingIds, setCheckingIds] = useState([]);
  const [timers, setTimers] = useState({});
  const [isTokenInvalid, setIsTokenInvalid] = useState(false);
  const [isRefreshingToken, setIsRefreshingToken] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  const intervalOptions = [
    { value: '1', label: '1 day' },
    { value: '3', label: '3 days' },
    { value: '7', label: '7 days' },
    { value: '14', label: '14 days' },
  ];

  const parseSpreadsheetUrl = (url) => {
    try {
      const regex = /https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)\/edit.*gid=([0-9]+)/;
      const match = url.match(regex);
      if (!match) {
        return { spreadsheetId: null, gid: null };
      }
      return {
        spreadsheetId: match[1],
        gid: match[2],
      };
    } catch (err) {
      console.error('Failed to parse spreadsheet URL:', err.message);
      return { spreadsheetId: null, gid: null };
    }
  };

  const openAddModal = () => {
    setIsAddModalOpen(true);
  };

  const closeAddModal = () => {
    setIsAddModalOpen(false);
    setForm({
      spreadsheetUrl: '',
      urlColumn: '',
      statusColumn: '',
      intervalDays: '1',
    });
    setError(null);
  };

  let refreshPromise = null;
  const refreshToken = async () => {
    if (isRefreshingToken) {
      return refreshPromise;
    }

    setIsRefreshingToken(true);
    refreshPromise = new Promise(async (resolve, reject) => {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        console.error('No refresh token found, setting token invalid');
        setIsTokenInvalid(true);
        setError('Authentication token missing. Please log in again.');
        reject(new Error('No refresh token'));
        return;
      }
      try {
        const response = await axios.post(`${apiBaseUrl}/refresh-token`, { refreshToken });
        const newToken = response.data.token;
        localStorage.setItem('token', newToken);
        setIsTokenInvalid(false);
        setIsRefreshingToken(false);
        setError(null);
        resolve(newToken);
      } catch (err) {
        console.error('Error refreshing token:', err.message);
        setIsTokenInvalid(true);
        setIsRefreshingToken(false);
        setError(err.response?.data?.error || 'Failed to refresh token');
        reject(err);
      }
    });

    return refreshPromise;
  };

  const fetchPingSpreadsheets = async () => {
    let token = localStorage.getItem('token');
    if (!token) {
      console.error('No token found for fetchPingSpreadsheets');
      setIsTokenInvalid(true);
      setError('Authentication token missing. Please log in again.');
      return;
    }
    try {
      setLoading(true);
      setParentLoading(true);
      const response = await axios.get(`${apiBaseUrl}/${projectId}/ping-spreadsheets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPingSpreadsheets(response.data);
      
      // Обновляем checkingIds на основе статуса
      const checking = response.data
        .filter(ps => ps.status === 'checking')
        .map(ps => ps._id);
      setCheckingIds(checking);
      
      setError(null);
    } catch (err) {
      console.error('Error fetching ping spreadsheets:', err.message);
      if (err.response?.status === 401) {
        try {
          token = await refreshToken();
          if (token) {
            const response = await axios.get(`${apiBaseUrl}/${projectId}/ping-spreadsheets`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            setPingSpreadsheets(response.data);
            
            const checking = response.data
              .filter(ps => ps.status === 'checking')
              .map(ps => ps._id);
            setCheckingIds(checking);
            
            setError(null);
          }
        } catch (retryErr) {
          console.error('Retry fetchPingSpreadsheets failed:', retryErr.message);
          setError(retryErr.response?.data?.error || 'Failed to fetch ping spreadsheets after token refresh');
        }
      } else {
        setError(err.response?.data?.error || 'Failed to fetch ping spreadsheets');
      }
    } finally {
      setLoading(false);
      setParentLoading(false);
    }
  };

  useEffect(() => {
    fetchPingSpreadsheets();
    
    // Периодическая проверка статусов
    const statusInterval = setInterval(fetchPingSpreadsheets, 10000); // Каждые 10 секунд
    
    return () => {
      clearInterval(statusInterval);
    };
  }, [projectId]);

  // WebSocket для real-time обновлений
  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = import.meta.env.MODE === 'production'
      ? import.meta.env.VITE_BACKEND_DOMAIN.replace('https://', '').replace('http://', '')
      : `localhost:${import.meta.env.VITE_BACKEND_PORT}`;
    const ws = new WebSocket(`${wsProtocol}//${wsHost}`);

    ws.onopen = () => {
      console.log('[PingStatus] WebSocket connected');
      ws.send(JSON.stringify({ type: 'subscribe', projectId }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('[PingStatus] WebSocket message:', data);

      if (data.type === 'pingStarted' && data.projectId === projectId) {
        console.log('[PingStatus] Ping started:', data.pingSpreadsheetId);
        setCheckingIds(prev => [...prev, data.pingSpreadsheetId]);
        fetchPingSpreadsheets();
      }

      if (data.type === 'pingComplete' && data.projectId === projectId) {
        console.log('[PingStatus] Ping complete:', data.pingSpreadsheetId);
        setCheckingIds(prev => prev.filter(id => id !== data.pingSpreadsheetId));
        fetchPingSpreadsheets();
      }
    };

    ws.onclose = () => {
      console.log('[PingStatus] WebSocket closed');
    };

    ws.onerror = (error) => {
      console.error('[PingStatus] WebSocket error:', error);
    };

    return () => {
      ws.close();
    };
  }, [projectId]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const newTimers = {};
      pingSpreadsheets.forEach(ps => {
        if (ps.lastRun && ps.intervalDays) {
          const lastRun = new Date(ps.lastRun);
          const nextRun = new Date(lastRun.getTime() + ps.intervalDays * 24 * 60 * 60 * 1000);
          const now = new Date();
          const timeUntilNext = nextRun - now;
          if (timeUntilNext > 0) {
            const days = Math.floor(timeUntilNext / (1000 * 60 * 60 * 24));
            const hours = Math.floor((timeUntilNext % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((timeUntilNext % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((timeUntilNext % (1000 * 60)) / 1000);
            newTimers[ps._id] = `${days}d ${hours}h ${minutes}m ${seconds}s`;
          } else {
            newTimers[ps._id] = 'Ready';
          }
        } else {
          newTimers[ps._id] = 'Not yet run';
        }
      });
      setTimers(newTimers);
    }, 1000);
    return () => clearInterval(intervalId);
  }, [pingSpreadsheets]);

  const handleFormChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleEditChange = (e) => {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  };

  const openEditModal = (pingSpreadsheet) => {
    setEditForm({
      _id: pingSpreadsheet._id,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${pingSpreadsheet.spreadsheetId}/edit?gid=${pingSpreadsheet.gid}`,
      urlColumn: pingSpreadsheet.urlColumn,
      statusColumn: pingSpreadsheet.statusColumn,
      intervalDays: pingSpreadsheet.intervalDays.toString(),
    });
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditForm(null);
    setError(null);
  };

  const addPingSpreadsheet = async (e) => {
    e.preventDefault();
    let token = localStorage.getItem('token');
    setLoading(true);
    setParentLoading(true);
    try {
      const { spreadsheetUrl, urlColumn, statusColumn, intervalDays } = form;
      const { spreadsheetId, gid } = parseSpreadsheetUrl(spreadsheetUrl);
      if (!spreadsheetId || !gid || !urlColumn || !statusColumn || !intervalDays) {
        setError('All fields are required or invalid spreadsheet URL');
        setLoading(false);
        setParentLoading(false);
        return;
      }

      // Проверка на дублирование
      const isDuplicate = pingSpreadsheets.some(
        (ps) => ps.spreadsheetId === spreadsheetId && ps.gid === parseInt(gid)
      );
      if (isDuplicate) {
        setError('This spreadsheet has already been added to the project');
        setLoading(false);
        setParentLoading(false);
        return;
      }

      console.log('Adding ping spreadsheet:', { projectId, spreadsheetId, gid: parseInt(gid), urlColumn, statusColumn, intervalDays: parseInt(intervalDays) });
      const response = await axios.post(
        `${apiBaseUrl}/${projectId}/ping-spreadsheets`,
        { spreadsheetId, gid: parseInt(gid), urlColumn, statusColumn, intervalDays: parseInt(intervalDays) },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      console.log('Add ping spreadsheet response:', response.data);
      
      closeAddModal();
      await fetchPingSpreadsheets();
      setForm({
        spreadsheetUrl: '',
        urlColumn: '',
        statusColumn: '',
        intervalDays: '1',
      });
      setError(null);
    } catch (err) {
      console.error('Error adding ping spreadsheet:', err.message);
      if (err.response?.status === 401) {
        try {
          token = await refreshToken();
          if (token) {
            const { spreadsheetUrl, urlColumn, statusColumn, intervalDays } = form;
            const { spreadsheetId, gid } = parseSpreadsheetUrl(spreadsheetUrl);
            const response = await axios.post(
              `${apiBaseUrl}/${projectId}/ping-spreadsheets`,
              { spreadsheetId, gid: parseInt(gid), urlColumn, statusColumn, intervalDays: parseInt(intervalDays) },
              { headers: { Authorization: `Bearer ${token}` } }
            );
            
            closeAddModal();
            await fetchPingSpreadsheets();
            setForm({
              spreadsheetUrl: '',
              urlColumn: '',
              statusColumn: '',
              intervalDays: '1',
            });
            setError(null);
          }
        } catch (retryErr) {
          console.error('Retry addPingSpreadsheet failed:', retryErr.message);
          setError(retryErr.response?.data?.error || 'Failed to add ping spreadsheet after token refresh');
        }
      } else {
        setError(err.response?.data?.error || 'Failed to add ping spreadsheet');
      }
    } finally {
      setLoading(false);
      setParentLoading(false);
    }
  };

  const editPingSpreadsheet = async (e) => {
    e.preventDefault();
    let token = localStorage.getItem('token');
    setLoading(true);
    setParentLoading(true);
    try {
      const { _id, spreadsheetUrl, urlColumn, statusColumn, intervalDays } = editForm;
      const { spreadsheetId, gid } = parseSpreadsheetUrl(spreadsheetUrl);
      if (!spreadsheetId || !gid || !urlColumn || !statusColumn || !intervalDays) {
        setError('All fields are required or invalid spreadsheet URL');
        setLoading(false);
        setParentLoading(false);
        return;
      }

      // Проверка на дублирование (кроме текущей)
      const isDuplicate = pingSpreadsheets.some(
        (ps) => ps._id !== _id && ps.spreadsheetId === spreadsheetId && ps.gid === parseInt(gid)
      );
      if (isDuplicate) {
        setError('This spreadsheet has already been added to the project');
        setLoading(false);
        setParentLoading(false);
        return;
      }

      const response = await axios.put(
        `${apiBaseUrl}/${projectId}/ping-spreadsheets/${_id}`,
        { spreadsheetId, gid: parseInt(gid), urlColumn, statusColumn, intervalDays: parseInt(intervalDays) },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchPingSpreadsheets();
      closeEditModal();
      setError(null);
    } catch (err) {
      console.error('Error editing ping spreadsheet:', err.message);
      if (err.response?.status === 401) {
        try {
          token = await refreshToken();
          if (token) {
            const { _id, spreadsheetUrl, urlColumn, statusColumn, intervalDays } = editForm;
            const { spreadsheetId, gid } = parseSpreadsheetUrl(spreadsheetUrl);
            const response = await axios.put(
              `${apiBaseUrl}/${projectId}/ping-spreadsheets/${_id}`,
              { spreadsheetId, gid: parseInt(gid), urlColumn, statusColumn, intervalDays: parseInt(intervalDays) },
              { headers: { Authorization: `Bearer ${token}` } }
            );
            await fetchPingSpreadsheets();
            closeEditModal();
            setError(null);
          }
        } catch (retryErr) {
          console.error('Retry editPingSpreadsheet failed:', retryErr.message);
          setError(retryErr.response?.data?.error || 'Failed to edit ping spreadsheet after token refresh');
        }
      } else {
        setError(err.response?.data?.error || 'Failed to edit ping spreadsheet');
      }
    } finally {
      setLoading(false);
      setParentLoading(false);
    }
  };

  const runPing = async (pingSpreadsheetId) => {
    let token = localStorage.getItem('token');
    if (!token) {
      setError('Authorization token is missing. Please log in again.');
      navigate('/login');
      return;
    }
    setCheckingIds([...checkingIds, pingSpreadsheetId]);
    setLoading(true);
    setParentLoading(true);
    try {
      const response = await axios.post(`${apiBaseUrl}/${projectId}/ping-spreadsheets/${pingSpreadsheetId}/run`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setError(null);
    } catch (err) {
      console.error('Error running ping:', err.message);
      if (err.response?.status === 401) {
        try {
          token = await refreshToken();
          if (token) {
            const response = await axios.post(`${apiBaseUrl}/${projectId}/ping-spreadsheets/${pingSpreadsheetId}/run`, {}, {
              headers: { Authorization: `Bearer ${token}` },
            });
            setError(null);
          }
        } catch (retryErr) {
          console.error('Retry runPing failed:', retryErr.message);
          setError(retryErr.response?.data?.error || 'Failed to start ping after token refresh');
        }
      } else {
        const errorMessage = err.response?.data?.error || 'Failed to start ping';
        setError(errorMessage);
        setCheckingIds(checkingIds.filter(id => id !== pingSpreadsheetId));
      }
    } finally {
      setLoading(false);
      setParentLoading(false);
    }
  };

  const deletePingSpreadsheet = async (pingSpreadsheetId) => {
    let token = localStorage.getItem('token');
    setLoading(true);
    setParentLoading(true);
    try {
      const response = await axios.delete(`${apiBaseUrl}/${projectId}/ping-spreadsheets/${pingSpreadsheetId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPingSpreadsheets(pingSpreadsheets.filter(ps => ps._id !== pingSpreadsheetId));
      setError(null);
    } catch (err) {
      console.error('Error deleting ping spreadsheet:', err.message);
      if (err.response?.status === 401) {
        try {
          token = await refreshToken();
          if (token) {
            const response = await axios.delete(`${apiBaseUrl}/${projectId}/ping-spreadsheets/${pingSpreadsheetId}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            setPingSpreadsheets(pingSpreadsheets.filter(ps => ps._id !== pingSpreadsheetId));
            setError(null);
          }
        } catch (retryErr) {
          console.error('Retry deletePingSpreadsheet failed:', retryErr.message);
          setError(retryErr.response?.data?.error || 'Failed to delete ping spreadsheet after token refresh');
        }
      } else {
        setError(err.response?.data?.error || 'Failed to delete ping spreadsheet');
      }
    } finally {
      setLoading(false);
      setParentLoading(false);
    }
  };

  const statusColor = (status, isChecking) => {
    if (isChecking) return 'bg-blue-500';
    return {
      ready: 'bg-green-500',
      checking: 'bg-blue-500',
      error: 'bg-red-500',
    }[status];
  };

  const formatInterval = (intervalDays) => {
    return `${intervalDays} day${intervalDays > 1 ? 's' : ''}`;
  };

  const modalVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: 'easeOut' } },
    exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2, ease: 'easeIn' } },
  };

  return (
    <motion.div
      className="max-w-full mx-auto"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
      }}
    >
      {isTokenInvalid && (
        <div className="mb-4 p-3 bg-yellow-100 text-yellow-700 rounded-lg">
          Session expired. Please log in again.
          <button
            onClick={() => {
              localStorage.removeItem('token');
              localStorage.removeItem('refreshToken');
              navigate('/login');
            }}
            className="ml-2 text-yellow-900 underline"
          >
            Login
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-900 underline"
          >
            Close
          </button>
        </div>
      )}

      <div className="relative border-b border-gray-200 mb-6">
        <div className="col-span-1 sm:col-span-2 flex items-center justify-between mb-4">
          <h3 className="text-base flex gap-[20px] sm:gap-[50px] items-center sm:text-2xl font-semibold text-gray-800">
            Ping Status Service
            <button
              onClick={openAddModal}
              className="bg-green-500 text-white p-2 rounded-full hover:bg-green-600 transition-colors shadow-md"
              title="Add new ping spreadsheet"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </h3>
        </div>
      </div>

      <ul>
        {pingSpreadsheets.map((ps) => {
          const isChecking = checkingIds.includes(ps._id) || ps.status === 'checking';
          return (
            <motion.li
              key={ps._id}
              className="mb-4 p-3 bg-gray-50 rounded-lg shadow-sm hover:bg-gray-100 transition-colors flex flex-col gap-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full ${statusColor(ps.status, isChecking)} flex-shrink-0`}></span>
                    <span className="text-gray-700 break-all">
                      {ps.spreadsheetId} - Every {formatInterval(ps.intervalDays)}
                    </span>
                  </div>
                  <div className="text-gray-600 text-sm">
                    <p>Pings: {ps.pingCount || 0}</p>
                    <p>Status: {isChecking ? 'Checking' : ps.status === 'ready' ? 'Ready' : ps.status === 'error' ? 'Error' : 'Not started'}</p>
                    <p>Last ping: {ps.lastRun ? new Date(ps.lastRun).toLocaleString('en-US') : 'Never'}</p>
                    <p>Next ping in: {timers[ps._id] || 'Calculating...'}</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 sm:ml-auto">
                  <button
                    onClick={() => runPing(ps._id)}
                    disabled={loading || isChecking || isTokenInvalid}
                    className={`bg-green-500 text-white px-3 py-1 sm:px-4 sm:py-1 rounded-lg ${loading || isChecking || isTokenInvalid ? 'opacity-50 cursor-not-allowed' : 'hover:bg-green-600'} transition-colors`}
                  >
                    {isChecking ? 'Pinging...' : 'Start'}
                  </button>
                  <button
                    onClick={() => openEditModal(ps)}
                    disabled={loading || isChecking || isTokenInvalid}
                    className={`bg-yellow-500 text-white px-3 py-1 sm:px-4 sm:py-1 rounded-lg ${loading || isChecking || isTokenInvalid ? 'opacity-50 cursor-not-allowed' : 'hover:bg-yellow-600'} transition-colors`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deletePingSpreadsheet(ps._id)}
                    disabled={loading || isChecking || isTokenInvalid}
                    className={`bg-red-500 text-white px-3 py-1 sm:px-4 sm:py-1 rounded-lg ${loading || isChecking || isTokenInvalid ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-600'} transition-colors`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </motion.li>
          );
        })}
      </ul>

      {/* Модальное окно для добавления */}
      <AnimatePresence>
        {isAddModalOpen && (
          <motion.div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={modalVariants}
          >
            <div className="relative bg-white rounded-lg shadow-lg w-full max-w-[90vw] sm:max-w-[600px] mx-4 p-4 sm:p-6 overflow-y-auto max-h-[75vh]">
              <button
                onClick={closeAddModal}
                className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-4">Add Ping Spreadsheet</h3>
              <form onSubmit={addPingSpreadsheet} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="col-span-1 sm:col-span-2">
                  <input
                    name="spreadsheetUrl"
                    value={form.spreadsheetUrl}
                    onChange={handleFormChange}
                    placeholder="Spreadsheet URL (e.g., https://docs.google.com/spreadsheets/d/.../edit?gid=...)"
                    type="text"
                    className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                    disabled={loading || isTokenInvalid}
                  />
                </div>
                <div>
                  <input
                    name="urlColumn"
                    value={form.urlColumn}
                    onChange={handleFormChange}
                    placeholder="URL column (e.g., A)"
                    type="text"
                    className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                    disabled={loading || isTokenInvalid}
                  />
                </div>
                <div>
                  <input
                    name="statusColumn"
                    value={form.statusColumn}
                    onChange={handleFormChange}
                    placeholder="Status column (e.g., B)"
                    type="text"
                    className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                    disabled={loading || isTokenInvalid}
                  />
                </div>
                <div className="col-span-1 sm:col-span-2">
                  <select
                    name="intervalDays"
                    value={form.intervalDays}
                    onChange={handleFormChange}
                    className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                    disabled={loading || isTokenInvalid}
                  >
                    {intervalOptions.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-1 sm:col-span-2 flex justify-center">
                  <button
                    type="submit"
                    className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors shadow-md disabled:bg-green-300"
                    disabled={loading || isTokenInvalid}
                  >
                    {loading ? 'Adding...' : 'Add spreadsheet'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Модальное окно для редактирования */}
      <AnimatePresence>
        {isEditModalOpen && (
          <motion.div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={modalVariants}
          >
            <div className="relative modal-mobile-edit bg-white rounded-lg shadow-lg w-full max-w-[30vw] mx-4 p-4 sm:p-6 overflow-y-auto max-h-[75vh]">
              <button
                onClick={closeEditModal}
                className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-4">Edit Ping Spreadsheet</h3>
              <form onSubmit={editPingSpreadsheet} className="flex flex-col gap-4">
                <input
                  name="spreadsheetUrl"
                  value={editForm ? editForm.spreadsheetUrl : ''}
                  onChange={handleEditChange}
                  placeholder="Spreadsheet URL"
                  type="text"
                  className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                  disabled={loading}
                />
                <input
                  name="urlColumn"
                  value={editForm ? editForm.urlColumn : ''}
                  onChange={handleEditChange}
                  placeholder="URL column"
                  type="text"
                  className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                  disabled={loading}
                />
                <input
                  name="statusColumn"
                  value={editForm ? editForm.statusColumn : ''}
                  onChange={handleEditChange}
                  placeholder="Status column"
                  type="text"
                  className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                  disabled={loading}
                />
                <select
                  name="intervalDays"
                  value={editForm ? editForm.intervalDays : ''}
                  onChange={handleEditChange}
                  className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50"
                  disabled={loading}
                >
                  {intervalOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors shadow-md disabled:bg-green-300"
                  disabled={loading}
                >
                  {loading ? 'Saving...' : 'Save changes'}
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default PingStatus;


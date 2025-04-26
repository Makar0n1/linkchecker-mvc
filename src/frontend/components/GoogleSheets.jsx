import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom'; // Добавляем useNavigate
import axios from 'axios';

const GoogleSheets = ({
  projectId,
  spreadsheets,
  setSpreadsheets,
  runningIds,
  setRunningIds,
  setLoading,
  setError,
  isAnalyzing,
}) => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    spreadsheetId: '',
    gid: '',
    targetDomain: '',
    urlColumn: '',
    targetColumn: '',
    resultRangeStart: '',
    resultRangeEnd: '',
    intervalHours: 4,
  });
  const [timers, setTimers] = useState({});
  const [isProjectAnalyzing, setIsProjectAnalyzing] = useState(isAnalyzing);

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  const wsBaseUrl = import.meta.env.MODE === 'production'
    ? `wss://api.link-check-pro.top`
    : `ws://localhost:${import.meta.env.VITE_BACKEND_PORT}`;

  const fetchSpreadsheets = async () => {
    const token = localStorage.getItem('token');
    try {
      const response = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSpreadsheets(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch spreadsheets');
    }
  };

  const fetchAnalysisStatus = async () => {
    const token = localStorage.getItem('token');
    try {
      const response = await axios.get(`${apiBaseUrl}/${projectId}/analysis-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setIsProjectAnalyzing(response.data.isAnalyzing);
      if (!response.data.isAnalyzing && runningIds.length > 0) {
        fetchSpreadsheets();
        setRunningIds([]);
        setLoading(false);
      }
    } catch (err) {
      console.error('Error fetching analysis status:', err);
    }
  };

  const connectWebSocket = () => {
    const ws = new WebSocket(wsBaseUrl);

    ws.onopen = () => {
      console.log('Connected to WebSocket');
      ws.send(JSON.stringify({ type: 'subscribe', projectId }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket message received:', data);
      if (data.type === 'analysisComplete' && data.projectId === projectId) {
        console.log(`Analysis completed for project ${projectId}, fetching updated spreadsheets`);
        fetchSpreadsheets();
        setRunningIds([]);
        setLoading(false);
        setIsProjectAnalyzing(false);
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from WebSocket, attempting to reconnect in 5 seconds...');
      setTimeout(connectWebSocket, 5000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      ws.close();
    };

    return ws;
  };

  useEffect(() => {
    fetchSpreadsheets();

    const ws = connectWebSocket();

    // Проверяем статус анализа каждые 10 секунд
    const statusInterval = setInterval(fetchAnalysisStatus, 10000);

    return () => {
      ws.close();
      clearInterval(statusInterval);
    };
  }, [projectId, setSpreadsheets, setError, runningIds, setLoading]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const newTimers = {};
      spreadsheets.forEach(s => {
        if (s.lastRun && s.intervalHours) {
          const lastRun = new Date(s.lastRun);
          const nextRun = new Date(lastRun.getTime() + s.intervalHours * 60 * 60 * 1000);
          const now = new Date();
          const timeUntilNext = nextRun - now;
          if (timeUntilNext > 0) {
            const hours = Math.floor(timeUntilNext / (1000 * 60 * 60));
            const minutes = Math.floor((timeUntilNext % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((timeUntilNext % (1000 * 60)) / 1000);
            newTimers[s._id] = `${hours}h ${minutes}m ${seconds}s`;
          } else {
            newTimers[s._id] = 'Ready';
          }
        } else {
          newTimers[s._id] = 'Not yet run';
        }
      });
      setTimers(newTimers);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [spreadsheets]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const addSpreadsheet = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    setLoading(true);
    try {
      const response = await axios.post(
        `${apiBaseUrl}/${projectId}/spreadsheets`,
        { ...form, gid: parseInt(form.gid), intervalHours: parseInt(form.intervalHours) },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSpreadsheets([...spreadsheets, { ...response.data, status: 'pending' }]);
      setForm({
        spreadsheetId: '',
        gid: '',
        targetDomain: '',
        urlColumn: '',
        targetColumn: '',
        resultRangeStart: '',
        resultRangeEnd: '',
        intervalHours: 4,
      });
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add spreadsheet');
    } finally {
      setLoading(false);
    }
  };

  const runAnalysis = async (spreadsheetId) => {
    const token = localStorage.getItem('token');
    setRunningIds([...runningIds, spreadsheetId]);
    setLoading(true);
    try {
      await axios.post(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}/run`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const updated = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSpreadsheets(updated.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to run analysis');
      setRunningIds(runningIds.filter(id => id !== spreadsheetId));
      setLoading(false);
    }
  };

  const cancelAnalysis = async (spreadsheetId) => {
    const token = localStorage.getItem('token');
    setLoading(true);
    try {
      await axios.post(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}/cancel`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const updated = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSpreadsheets(updated.data);
      setRunningIds(runningIds.filter(id => id !== spreadsheetId));
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to cancel analysis');
    } finally {
      setLoading(false);
    }
  };

  const deleteSpreadsheet = async (spreadsheetId) => {
    const token = localStorage.getItem('token');
    setLoading(true);
    try {
      await axios.delete(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSpreadsheets(spreadsheets.filter(s => s._id !== spreadsheetId));
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete spreadsheet');
    } finally {
      setLoading(false);
    }
  };

  const statusColor = (status, isRunning) => {
    if (isRunning) return 'bg-blue-500';
    return {
      pending: 'bg-gray-400',
      checking: 'bg-blue-500',
      completed: 'bg-green-500',
      error: 'bg-red-500',
    }[status];
  };

  const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  return (
    <motion.div
      className="max-w-full mx-auto"
      initial="hidden"
      animate="visible"
      variants={fadeInUp}
    >
      <button
        onClick={() => navigate('/app/projects')}
        className="mb-4 flex items-center gap-2 text-gray-700 hover:text-gray-900 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Projects
      </button>

      <form onSubmit={addSpreadsheet} className="mb-6 grid grid-cols-2 gap-4">
        {[
          { name: 'spreadsheetId', placeholder: 'Spreadsheet ID' },
          { name: 'gid', placeholder: 'GID' },
          { name: 'targetDomain', placeholder: 'Target Domain' },
          { name: 'urlColumn', placeholder: 'URL Column (e.g., D)' },
          { name: 'targetColumn', placeholder: 'Target Column (e.g., I)' },
          { name: 'resultRangeStart', placeholder: 'Result Start (e.g., L)' },
          { name: 'resultRangeEnd', placeholder: 'Result End (e.g., P)' },
          { name: 'intervalHours', placeholder: 'Interval (4-24)', type: 'number', min: 4, max: 24 },
        ].map((field) => (
          <input
            key={field.name}
            name={field.name}
            value={form[field.name]}
            onChange={handleChange}
            placeholder={field.placeholder}
            type={field.type || 'text'}
            min={field.min}
            max={field.max}
            className="p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50"
            disabled={isProjectAnalyzing}
          />
        ))}
        <button
          type="submit"
          className="col-span-2 bg-green-500 text-white p-2 rounded-lg hover:bg-green-600 transition-colors shadow-md"
          disabled={isProjectAnalyzing}
        >
          Add Spreadsheet
        </button>
      </form>
      <ul>
        {spreadsheets.map((s) => {
          const isRunning = runningIds.includes(s._id);
          return (
            <motion.li
              key={s._id}
              className="mb-4 p-3 bg-gray-50 rounded-lg shadow-sm hover:bg-gray-100 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className={`w-4 h-4 rounded-full ${statusColor(s.status, isRunning)} flex-shrink-0`}></span>
                  <span className="text-gray-700 break-all">
                    {s.spreadsheetId} - {s.targetDomain} - Every {s.intervalHours} hours
                  </span>
                </div>
                <div className="text-gray-600 text-sm">
                  <p>Scans: {s.scanCount || 0}</p>
                  <p>Last Scan: {s.lastRun ? new Date(s.lastRun).toLocaleString() : 'Never'}</p>
                  <p>Next Scan In: {timers[s._id] || 'Calculating...'}</p>
                </div>
              </div>
              <div className="flex gap-2 sm:ml-auto">
                {s.status === 'checking' ? (
                  <>
                    <button
                      onClick={() => cancelAnalysis(s._id)}
                      className="bg-red-500 text-white px-4 py-1 rounded-lg hover:bg-red-600 transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => runAnalysis(s._id)}
                      disabled={isRunning || isProjectAnalyzing}
                      className={`bg-green-500 text-white px-4 py-1 rounded-lg ${isRunning || isProjectAnalyzing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-green-600'} transition-colors`}
                    >
                      {isRunning ? 'Running...' : 'Run'}
                    </button>
                    <button
                      onClick={() => deleteSpreadsheet(s._id)}
                      disabled={isRunning || isProjectAnalyzing}
                      className={`bg-red-500 text-white px-4 py-1 rounded-lg ${isRunning || isProjectAnalyzing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-600'} transition-colors`}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
};

export default GoogleSheets;
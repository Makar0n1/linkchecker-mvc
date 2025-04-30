import React, { useState, useEffect, useCallback, useContext } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { CookieContext } from './CookieContext';

const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

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
  const [progressData, setProgressData] = useState({});
  const [taskIds, setTaskIds] = useState({});
  const [progressKeys, setProgressKeys] = useState({});
  const [isTokenInvalid, setIsTokenInvalid] = useState(false);
  const context = useContext(CookieContext);
  const hasCookieConsent = context ? context.hasCookieConsent : true;
  const [cookieError, setCookieError] = useState(null);

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  const debouncedSetProgressData = useCallback(
    debounce((newProgressData) => {
      setProgressData(newProgressData);
    }, 300),
    []
  );

  const fetchSpreadsheets = async () => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }

    try {
      const response = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
        withCredentials: true,
      });
      setSpreadsheets(response.data);
    } catch (err) {
      console.error('Error fetching spreadsheets:', err.message, err.response?.status);
      if (err.response?.status === 401) {
        setIsTokenInvalid(true);
      } else {
        setError(err.response?.data?.error || 'Failed to fetch spreadsheets');
      }
    }
  };

  const fetchActiveTasks = async () => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }
  
    try {
      const response = await axios.get(`${apiBaseUrl}/${projectId}/active-spreadsheet-tasks`, {
        withCredentials: true,
      });
      const tasks = response.data;
      const newTaskIds = {};
      const newProgressKeys = {};
      const newProgressData = {};
  
      tasks.forEach(task => {
        newTaskIds[task.spreadsheetId] = task.taskId;
        if (task.progressKey) { // Проверяем наличие progressKey
          newProgressKeys[task.spreadsheetId] = task.progressKey;
        } else {
          console.warn(`No progressKey returned for spreadsheet ${task.spreadsheetId}, taskId=${task.taskId}`);
        }
        newProgressData[task.spreadsheetId] = {
          progress: task.progress || 0,
          processedLinks: task.processedLinks || 0,
          totalLinks: task.totalLinks || 0,
          estimatedTimeRemaining: task.estimatedTimeRemaining || 0,
          status: task.status || 'pending',
        };
      });
  
      setTaskIds(prev => {
        const updatedTaskIds = { ...newTaskIds };
        Object.keys(prev).forEach(spreadsheetId => {
          if (!newTaskIds[spreadsheetId]) {
            console.log(`Task for spreadsheet ${spreadsheetId} is no longer active, removing...`);
            delete updatedTaskIds[spreadsheetId];
          }
        });
        return updatedTaskIds;
      });
  
      setProgressKeys(prev => {
        const updatedProgressKeys = { ...newProgressKeys };
        Object.keys(prev).forEach(spreadsheetId => {
          if (!newProgressKeys[spreadsheetId]) {
            console.log(`Progress key for spreadsheet ${spreadsheetId} removed`);
            delete updatedProgressKeys[spreadsheetId];
          }
        });
        return updatedProgressKeys;
      });
  
      setProgressData(newProgressData);
      setRunningIds(Object.keys(newTaskIds));
      setIsProjectAnalyzing(Object.keys(newTaskIds).length > 0);
    } catch (err) {
      console.error('Error fetching active tasks:', err.message, err.response?.status);
      if (err.response?.status === 401) {
        setIsTokenInvalid(true);
      }
    }
  };

  const fetchProgress = async (spreadsheetId, taskId) => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }

    const progressKey = progressKeys[spreadsheetId];
    if (!progressKey) {
      console.error(`No progress key found for spreadsheet ${spreadsheetId}, taskId=${taskId}`);
      setError('Progress key missing. Please restart the analysis.');
      return;
    }
    console.log(`Fetching progress for task ${taskId} with progressKey: ${progressKey.substring(0, 10)}...`);
    try {
      const response = await axios.get(`${apiBaseUrl}/${projectId}/task-progress/${taskId}?progressKey=${progressKey}`, {
        withCredentials: true,
      });
      const data = response.data;
      debouncedSetProgressData(prev => ({
        ...prev,
        [spreadsheetId]: {
          progress: data.progress || 0,
          processedLinks: data.processedLinks || 0,
          totalLinks: data.totalLinks || 0,
          estimatedTimeRemaining: data.estimatedTimeRemaining || 0,
          status: data.status || 'pending',
        },
      }));
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
        console.log(`Task ${taskId} completed with status ${data.status}, cleaning up...`);
        if (data.status === 'failed') {
          setError('Analysis failed. Please try again or check the logs.');
        }
        setRunningIds(prev => prev.filter(id => id !== spreadsheetId));
        setTaskIds(prev => {
          const newTaskIds = { ...prev };
          delete newTaskIds[spreadsheetId];
          return newTaskIds;
        });
        setProgressKeys(prev => {
          const newProgressKeys = { ...prev };
          delete newProgressKeys[spreadsheetId];
          return newProgressKeys;
        });
        setProgressData(prev => {
          const updatedProgress = { ...prev };
          delete updatedProgress[spreadsheetId];
          return updatedProgress;
        });
        setIsProjectAnalyzing(Object.keys(taskIds).length === 1);
        fetchSpreadsheets();
      }
    } catch (err) {
      console.error(`Error fetching progress for task ${taskId}:`, err.message, err.response?.status, err.response?.data);
      if (err.response?.status === 401) {
        console.error(`Invalid progress key for task ${taskId}, progressKey: ${progressKey}`);
        setError('Invalid progress key. Please restart the analysis.');
      } else if (err.response?.status === 404) {
        console.log(`Task ${taskId} not found, cleaning up...`);
        setRunningIds(prev => prev.filter(id => id !== spreadsheetId));
        setTaskIds(prev => {
          const newTaskIds = { ...prev };
          delete newTaskIds[spreadsheetId];
          return newTaskIds;
        });
        setProgressKeys(prev => {
          const newProgressKeys = { ...prev };
          delete newProgressKeys[spreadsheetId];
          return newProgressKeys;
        });
        setProgressData(prev => {
          const updatedProgress = { ...prev };
          delete updatedProgress[spreadsheetId];
          return updatedProgress;
        });
        setIsProjectAnalyzing(Object.keys(taskIds).length === 1);
        fetchSpreadsheets();
      }
    }
  };

  const startSSE = (spreadsheetId, taskId) => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return null;
    }

    const progressKey = progressKeys[spreadsheetId];
    if (!progressKey) {
      console.error(`No progress key found for spreadsheet ${spreadsheetId}, taskId=${taskId}`);
      setError('Progress key missing. Please restart the analysis.');
      return null;
    }
    console.log(`Starting SSE for task ${taskId} with progressKey: ${progressKey.substring(0, 10)}...`);
    const eventSource = new EventSource(`${apiBaseUrl}/${projectId}/task-progress-sse/${taskId}?progressKey=${progressKey}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) {
        console.error(`SSE error for task ${taskId}: ${data.error}`);
        eventSource.close();
        if (data.error.includes('Invalid or expired progress key')) {
          console.error(`Invalid progress key for task ${taskId}, progressKey: ${progressKey}`);
          setError('Invalid progress key. Please restart the analysis.');
        } else if (data.error.includes('Task not found')) {
          console.log(`Task ${taskId} not found via SSE, cleaning up...`);
          setRunningIds(prev => prev.filter(id => id !== spreadsheetId));
          setTaskIds(prev => {
            const newTaskIds = { ...prev };
            delete newTaskIds[spreadsheetId];
            return newTaskIds;
          });
          setProgressKeys(prev => {
            const newProgressKeys = { ...prev };
            delete newProgressKeys[spreadsheetId];
            return newProgressKeys;
          });
          setProgressData(prev => {
            const updatedProgress = { ...prev };
            delete updatedProgress[spreadsheetId];
            return updatedProgress;
          });
          setIsProjectAnalyzing(Object.keys(taskIds).length === 1);
          fetchSpreadsheets();
        }
        return;
      }
      debouncedSetProgressData(prev => ({
        ...prev,
        [spreadsheetId]: {
          progress: data.progress || 0,
          processedLinks: data.processedLinks || 0,
          totalLinks: data.totalLinks || 0,
          estimatedTimeRemaining: data.estimatedTimeRemaining || 0,
          status: data.status || 'pending',
        },
      }));
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
        console.log(`Task ${taskId} completed with status ${data.status} via SSE, cleaning up...`);
        if (data.status === 'failed') {
          setError('Analysis failed. Please try again or check the logs.');
        }
        setRunningIds(prev => prev.filter(id => id !== spreadsheetId));
        setTaskIds(prev => {
          const newTaskIds = { ...prev };
          delete newTaskIds[spreadsheetId];
          return newTaskIds;
        });
        setProgressKeys(prev => {
          const newProgressKeys = { ...prev };
          delete newProgressKeys[spreadsheetId];
          return newProgressKeys;
        });
        setProgressData(prev => {
          const updatedProgress = { ...prev };
          delete updatedProgress[spreadsheetId];
          return updatedProgress;
        });
        setIsProjectAnalyzing(Object.keys(taskIds).length === 1);
        fetchSpreadsheets();
        eventSource.close();
      }
    };

    eventSource.onerror = (error) => {
      console.error(`SSE error for task ${taskId}:`, error);
      eventSource.close();
      setRunningIds(prev => prev.filter(id => id !== spreadsheetId));
      setTaskIds(prev => {
        const newTaskIds = { ...prev };
        delete newTaskIds[spreadsheetId];
        return newTaskIds;
      });
      setProgressKeys(prev => {
        const newProgressKeys = { ...prev };
        delete newProgressKeys[spreadsheetId];
        return newProgressKeys;
      });
      setProgressData(prev => {
        const updatedProgress = { ...prev };
        delete updatedProgress[spreadsheetId];
        return updatedProgress;
      });
      setIsProjectAnalyzing(Object.keys(taskIds).length === 1);
      fetchSpreadsheets();
    };

    return eventSource;
  };

  const fetchAnalysisStatus = async () => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }

    try {
      const response = await axios.get(`${apiBaseUrl}/${projectId}/analysis-status`, {
        withCredentials: true,
      });
      setIsProjectAnalyzing(response.data.isAnalyzingSpreadsheet);
    } catch (err) {
      console.error('Error fetching analysis status:', err.message, err.response?.status);
      if (err.response?.status === 401) {
        setIsTokenInvalid(true);
      }
    }
  };

  useEffect(() => {
    fetchSpreadsheets();
    fetchActiveTasks();
    const statusInterval = setInterval(fetchAnalysisStatus, 10000);
    const activeTasksInterval = setInterval(fetchActiveTasks, 10000);
    return () => {
      clearInterval(statusInterval);
      clearInterval(activeTasksInterval);
    };
  }, [projectId, hasCookieConsent]);

  useEffect(() => {
    const eventSources = {};
    Object.keys(taskIds).forEach(spreadsheetId => {
      const taskId = taskIds[spreadsheetId];
      const progressKey = progressKeys[spreadsheetId];
      if (progressKey) { // Проверяем наличие progressKey перед вызовом
        fetchProgress(spreadsheetId, taskId);
        eventSources[spreadsheetId] = startSSE(spreadsheetId, taskId);
      } else {
        console.warn(`Skipping fetchProgress and startSSE for spreadsheet ${spreadsheetId} due to missing progressKey`);
      }
    });
    return () => {
      Object.values(eventSources).forEach(eventSource => eventSource?.close());
    };
  }, [taskIds, progressKeys]);

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
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }

    setLoading(true);
    try {
      const { spreadsheetId, gid, targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours } = form;
      if (!spreadsheetId || gid === '' || !targetDomain || !urlColumn || !targetColumn || !resultRangeStart || !resultRangeEnd || !intervalHours) {
        setError('All fields are required');
        setLoading(false);
        return;
      }
      const response = await axios.post(
        `${apiBaseUrl}/${projectId}/spreadsheets`,
        { ...form, gid: parseInt(form.gid), intervalHours: parseInt(form.intervalHours) },
        { withCredentials: true }
      );
      await fetchSpreadsheets();
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
      console.error('Error adding spreadsheet:', err.message, err.response?.status);
      if (err.response?.status === 401) {
        setIsTokenInvalid(true);
      } else {
        setError(err.response?.data?.error || 'Failed to add spreadsheet');
      }
    } finally {
      setLoading(false);
    }
  };

  const runAnalysis = async (spreadsheetId) => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }
  
    setRunningIds([...runningIds, spreadsheetId]);
    setLoading(true);
    setProgressData(prev => ({
      ...prev,
      [spreadsheetId]: {
        progress: 0,
        processedLinks: 0,
        totalLinks: 0,
        estimatedTimeRemaining: 0,
        status: 'pending',
      },
    }));
    try {
      const response = await axios.post(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}/run`, {}, {
        withCredentials: true,
      });
      const { taskId, progressKey } = response.data;
      console.log(`runAnalysis: Received taskId=${taskId}, progressKey=${progressKey} for spreadsheet ${spreadsheetId}`);
      setTaskIds(prev => ({
        ...prev,
        [spreadsheetId]: taskId,
      }));
      setProgressKeys(prev => ({
        ...prev,
        [spreadsheetId]: progressKey,
      }));
      const updated = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
        withCredentials: true,
      });
      setSpreadsheets(updated.data);
      setError(null);
    } catch (err) {
      console.error('Error running analysis:', err.message, err.response?.status);
      if (err.response?.status === 401) {
        setIsTokenInvalid(true);
      } else {
        const errorMessage = err.response?.data?.error || 'Failed to run analysis';
        setError(errorMessage);
        setRunningIds(runningIds.filter(id => id !== spreadsheetId));
        setLoading(false);
        setProgressData(prev => {
          const newProgress = { ...prev };
          delete newProgress[spreadsheetId];
          return newProgress;
        });
        setTaskIds(prev => {
          const newTaskIds = { ...prev };
          delete newTaskIds[spreadsheetId];
          return newTaskIds;
        });
        setProgressKeys(prev => {
          const newProgressKeys = { ...prev };
          delete newProgressKeys[spreadsheetId];
          return newProgressKeys;
        });
      }
    }
  };

  const cancelAnalysis = async (spreadsheetId) => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }

    setLoading(true);
    try {
      await axios.post(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}/cancel`, {}, {
        withCredentials: true,
      });
      const updated = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
        withCredentials: true,
      });
      setSpreadsheets(updated.data);
      setRunningIds(runningIds.filter(id => id !== spreadsheetId));
      setProgressData(prev => {
        const newProgress = { ...prev };
        delete newProgress[spreadsheetId];
        return newProgress;
      });
      setTaskIds(prev => {
        const newTaskIds = { ...prev };
        delete newTaskIds[spreadsheetId];
        return newTaskIds;
      });
      setProgressKeys(prev => {
        const newProgressKeys = { ...prev };
        delete newProgressKeys[spreadsheetId];
        return newProgressKeys;
      });
      setIsProjectAnalyzing(false);
      setError(null);
    } catch (err) {
      console.error('Error cancelling analysis:', err.message, err.response?.status);
      if (err.response?.status === 401) {
        setIsTokenInvalid(true);
      } else {
        setError(err.response?.data?.error || 'Failed to cancel analysis');
      }
    } finally {
      setLoading(false);
    }
  };

  const deleteSpreadsheet = async (spreadsheetId) => {
    if (!hasCookieConsent) {
      setCookieError('You must accept cookies to use this feature.');
      return;
    }

    setLoading(true);
    try {
      await axios.delete(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}`, {
        withCredentials: true,
      });
      setSpreadsheets(spreadsheets.filter(s => s._id !== spreadsheetId));
      setError(null);
      setProgressData(prev => {
        const newProgress = { ...prev };
        delete newProgress[spreadsheetId];
        return newProgress;
      });
      setTaskIds(prev => {
        const newTaskIds = { ...prev };
        delete newTaskIds[spreadsheetId];
        return newTaskIds;
      });
      setProgressKeys(prev => {
        const newProgressKeys = { ...prev };
        delete newProgressKeys[spreadsheetId];
        return newProgressKeys;
      });
    } catch (err) {
      console.error('Error deleting spreadsheet:', err.message, err.response?.status);
      if (err.response?.status === 401) {
        setIsTokenInvalid(true);
      } else {
        setError(err.response?.data?.error || 'Failed to delete spreadsheet');
      }
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

      {isTokenInvalid && (
        <div className="mb-4 p-3 bg-yellow-100 text-yellow-700 rounded-lg">
          Your session has expired. Please log in again to continue.
          <button
            onClick={() => {
              navigate('/login');
            }}
            className="ml-2 text-yellow-900 underline"
          >
            Log in
          </button>
        </div>
      )}

      {cookieError && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
          {cookieError}
          <button
            onClick={() => setCookieError(null)}
            className="ml-2 text-red-900 underline"
          >
            Close
          </button>
        </div>
      )}

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
            disabled={isProjectAnalyzing || isTokenInvalid}
          />
        ))}
        <button
          type="submit"
          className="col-span-2 bg-green-500 text-white p-2 rounded-lg hover:bg-green-600 transition-colors shadow-md"
          disabled={isProjectAnalyzing || isTokenInvalid}
        >
          Add Spreadsheet
        </button>
      </form>
      <ul>
        {spreadsheets.map((s) => {
          const isRunning = runningIds.includes(s._id) || s.status === 'checking';
          const progress = progressData[s._id] || { progress: 0, processedLinks: 0, totalLinks: 0, estimatedTimeRemaining: 0, status: 'pending' };
          return (
            <motion.li
              key={s._id}
              className="mb-4 p-3 bg-gray-50 rounded-lg shadow-sm hover:bg-gray-100 transition-colors flex flex-col gap-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
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
                  {(s.status === 'checking' || isRunning) && isProjectAnalyzing ? (
                    <>
                      <button
                        onClick={() => cancelAnalysis(s._id)}
                        className="bg-red-500 text-white px-4 py-1 rounded-lg hover:bg-red-600 transition-colors"
                        disabled={isTokenInvalid}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => runAnalysis(s._id)}
                        disabled={isRunning || isProjectAnalyzing || isTokenInvalid}
                        className={`bg-green-500 text-white px-4 py-1 rounded-lg ${isRunning || isProjectAnalyzing || isTokenInvalid ? 'opacity-50 cursor-not-allowed' : 'hover:bg-green-600'} transition-colors`}
                      >
                        {isRunning ? 'Running...' : 'Run'}
                      </button>
                      <button
                        onClick={() => deleteSpreadsheet(s._id)}
                        disabled={isRunning || isProjectAnalyzing || isTokenInvalid}
                        className={`bg-red-500 text-white px-4 py-1 rounded-lg ${isRunning || isProjectAnalyzing || isTokenInvalid ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-600'} transition-colors`}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
              {(isRunning || progress.status === 'pending') && isProjectAnalyzing && (
                <div className="flex flex-col gap-2">
                  <div className="w-full bg-gray-200 rounded-full h-4">
                    <div
                      className="bg-green-500 h-4 rounded-full"
                      style={{ width: `${progress.progress}%`, transition: 'width 0.5s ease-in-out' }}
                    ></div>
                  </div>
                  <div className="text-gray-600 text-sm">
                    <p>Progress: {progress.progress}%</p>
                    <p>Processed: {progress.processedLinks} / {progress.totalLinks} links</p>
                    <p>Estimated time remaining: {progress.estimatedTimeRemaining} seconds</p>
                  </div>
                </div>
              )}
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
};

export default GoogleSheets;
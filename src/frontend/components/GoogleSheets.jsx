import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
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
  setIsAnalyzing,
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
  const [progressData, setProgressData] = useState(() => {
    const savedProgress = localStorage.getItem(`progressData-${projectId}`);
    return savedProgress ? JSON.parse(savedProgress) : {};
  });
  const [taskIds, setTaskIds] = useState(() => {
    const savedTaskIds = localStorage.getItem(`taskIds-${projectId}`);
    return savedTaskIds ? JSON.parse(savedTaskIds) : {};
  });
  const isMounted = useRef(true);
  const isFetching = useRef(false);

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const refreshToken = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No token found for refresh');
      const response = await axios.post(`${apiBaseUrl}/refresh-token`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const { token: newToken } = response.data;
      localStorage.setItem('token', newToken);
      console.log('Token refreshed:', newToken);
      return newToken;
    } catch (err) {
      console.error('Failed to refresh token:', err);
      localStorage.removeItem('token');
      if (isMounted.current) {
        navigate('/app/login');
      }
      return null;
    }
  };

  const clearStaleTasks = async () => {
    if (!isMounted.current || isFetching.current) return;
    isFetching.current = true;
    let token = localStorage.getItem('token');
    if (!token) {
      console.error('No token found in localStorage, redirecting to login');
      navigate('/app/login');
      return;
    }
    try {
      const response = await axios.post(`${apiBaseUrl}/user/clear-stale-tasks`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log('Stale tasks cleared:', response.data);
    } catch (err) {
      console.error('Error clearing stale tasks:', err);
      if (err.response?.status === 401) {
        token = await refreshToken();
        if (token && isMounted.current) {
          try {
            const response = await axios.post(`${apiBaseUrl}/user/clear-stale-tasks`, {}, {
              headers: { Authorization: `Bearer ${token}` },
            });
            console.log('Stale tasks cleared after token refresh:', response.data);
          } catch (retryErr) {
            console.error('Retry failed after token refresh:', retryErr);
            navigate('/app/login');
          }
        }
      } else {
        console.error('Failed to clear stale tasks:', err.message);
      }
    } finally {
      isFetching.current = false;
    }
  };

  const fetchSpreadsheets = async () => {
    if (!isMounted.current || isFetching.current) return;
    isFetching.current = true;
    let token = localStorage.getItem('token');
    if (!token) {
      navigate('/app/login');
      return;
    }
    try {
      const response = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (isMounted.current) {
        setSpreadsheets(Array.isArray(response.data) ? response.data : []);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err.response?.data?.error || 'Failed to fetch spreadsheets');
        setSpreadsheets([]);
        if (err.response?.status === 401) {
          token = await refreshToken();
          if (token && isMounted.current) {
            try {
              const response = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              setSpreadsheets(Array.isArray(response.data) ? response.data : []);
            } catch (retryErr) {
              navigate('/app/login');
            }
          }
        }
      }
    } finally {
      isFetching.current = false;
    }
  };

  const fetchUserTasks = async () => {
    if (!isMounted.current || isFetching.current) return;
    isFetching.current = true;
    let token = localStorage.getItem('token');
    if (!token) {
      navigate('/app/login');
      return;
    }
    try {
      const response = await axios.get(`${apiBaseUrl}/user/tasks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const serverTaskIds = response.data.activeTasks || {};
      if (isMounted.current) {
        setTaskIds(serverTaskIds);
        localStorage.setItem(`taskIds-${projectId}`, JSON.stringify(serverTaskIds));
        if (Object.keys(serverTaskIds).length === 0) {
          setIsProjectAnalyzing(false);
          setIsAnalyzing(false);
          setRunningIds([]);
          setProgressData({});
          localStorage.setItem(`progressData-${projectId}`, JSON.stringify({}));
        }
      }
    } catch (err) {
      console.error('Error fetching user tasks:', err);
      if (isMounted.current) {
        setTaskIds({});
        localStorage.setItem(`taskIds-${projectId}`, JSON.stringify({}));
        setIsProjectAnalyzing(false);
        setIsAnalyzing(false);
        setRunningIds([]);
        setProgressData({});
        localStorage.setItem(`progressData-${projectId}`, JSON.stringify({}));
        if (err.response?.status === 401) {
          token = await refreshToken();
          if (token && isMounted.current) {
            try {
              const response = await axios.get(`${apiBaseUrl}/user/tasks`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const serverTaskIds = response.data.activeTasks || {};
              setTaskIds(serverTaskIds);
              localStorage.setItem(`taskIds-${projectId}`, JSON.stringify(serverTaskIds));
            } catch (retryErr) {
              navigate('/app/login');
            }
          }
        }
      }
    } finally {
      isFetching.current = false;
    }
  };

  const fetchProgress = async (spreadsheetId, taskId) => {
    if (!isMounted.current || isFetching.current) return;
    isFetching.current = true;
    let token = localStorage.getItem('token');
    if (!token) {
      navigate('/app/login');
      return;
    }
    try {
      const response = await axios.get(`${apiBaseUrl}/${projectId}/task-progress/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = response.data;
      if (isMounted.current) {
        setProgressData(prev => {
          const updatedProgress = {
            ...prev,
            [spreadsheetId]: {
              progress: data.progress || 0,
              processedLinks: data.processedLinks || 0,
              totalLinks: data.totalLinks || 0,
              estimatedTimeRemaining: data.estimatedTimeRemaining || 0,
              status: data.status || 'pending',
            },
          };
          localStorage.setItem(`progressData-${projectId}`, JSON.stringify(updatedProgress));
          return updatedProgress;
        });
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
          setRunningIds(prev => prev.filter(id => id !== spreadsheetId));
          setTaskIds(prev => {
            const newTaskIds = { ...prev };
            delete newTaskIds[spreadsheetId];
            localStorage.setItem(`taskIds-${projectId}`, JSON.stringify(newTaskIds));
            return newTaskIds;
          });
          setProgressData(prev => {
            const updatedProgress = { ...prev };
            delete updatedProgress[spreadsheetId];
            localStorage.setItem(`progressData-${projectId}`, JSON.stringify(updatedProgress));
            return updatedProgress;
          });
          setIsProjectAnalyzing(false);
          setIsAnalyzing(false);
          fetchSpreadsheets();
        }
      }
    } catch (err) {
      console.error(`Error fetching progress for task ${taskId}:`, err);
      if (isMounted.current) {
        if (err.response?.status === 404) {
          setRunningIds(prev => prev.filter(id => id !== spreadsheetId));
          setTaskIds(prev => {
            const newTaskIds = { ...prev };
            delete newTaskIds[spreadsheetId];
            localStorage.setItem(`taskIds-${projectId}`, JSON.stringify(newTaskIds));
            return newTaskIds;
          });
          setProgressData(prev => {
            const updatedProgress = { ...prev };
            delete updatedProgress[spreadsheetId];
            localStorage.setItem(`progressData-${projectId}`, JSON.stringify(updatedProgress));
            return updatedProgress;
          });
          setIsProjectAnalyzing(false);
          setIsAnalyzing(false);
          fetchSpreadsheets();
        } else if (err.response?.status === 401) {
          token = await refreshToken();
          if (token && isMounted.current) {
            try {
              const response = await axios.get(`${apiBaseUrl}/${projectId}/task-progress/${taskId}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const data = response.data;
              setProgressData(prev => {
                const updatedProgress = {
                  ...prev,
                  [spreadsheetId]: {
                    progress: data.progress || 0,
                    processedLinks: data.processedLinks || 0,
                    totalLinks: data.totalLinks || 0,
                    estimatedTimeRemaining: data.estimatedTimeRemaining || 0,
                    status: data.status || 'pending',
                  },
                };
                localStorage.setItem(`progressData-${projectId}`, JSON.stringify(updatedProgress));
                return updatedProgress;
              });
            } catch (retryErr) {
              navigate('/app/login');
            }
          }
        }
      }
    } finally {
      isFetching.current = false;
    }
  };

  const fetchAnalysisStatus = async () => {
    if (!isMounted.current || isFetching.current) return;
    isFetching.current = true;
    let token = localStorage.getItem('token');
    if (!token) {
      navigate('/app/login');
      return;
    }
    try {
      const response = await axios.get(`${apiBaseUrl}/${projectId}/analysis-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (isMounted.current) {
        setIsProjectAnalyzing(response.data.isAnalyzing);
        setIsAnalyzing(response.data.isAnalyzing);
        if (!response.data.isAnalyzing) {
          await fetchSpreadsheets();
          setRunningIds([]);
          setLoading(false);
          setProgressData(prev => {
            const updatedProgress = {};
            localStorage.setItem(`progressData-${projectId}`, JSON.stringify(updatedProgress));
            return updatedProgress;
          });
          setTaskIds(prev => {
            const newTaskIds = {};
            localStorage.setItem(`taskIds-${projectId}`, JSON.stringify(newTaskIds));
            return newTaskIds;
          });
          await fetchUserTasks();
        }
      }
    } catch (err) {
      console.error('Error fetching analysis status:', err);
      if (isMounted.current && err.response?.status === 401) {
        token = await refreshToken();
        if (token && isMounted.current) {
          try {
            const response = await axios.get(`${apiBaseUrl}/${projectId}/analysis-status`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            setIsProjectAnalyzing(response.data.isAnalyzing);
            setIsAnalyzing(response.data.isAnalyzing);
          } catch (retryErr) {
            navigate('/app/login');
          }
        }
      }
    } finally {
      isFetching.current = false;
    }
  };

  useEffect(() => {
    const initialize = async () => {
      await clearStaleTasks();
      await fetchSpreadsheets();
      await fetchUserTasks();
    };

    initialize().catch(err => {
      console.error('Initialization error:', err);
      if (isMounted.current) {
        navigate('/app/login');
      }
    });

    const statusInterval = setInterval(async () => {
      const currentTaskIds = JSON.parse(localStorage.getItem(`taskIds-${projectId}`)) || {};
      if (Object.keys(currentTaskIds).length === 0) {
        if (isMounted.current) {
          setIsProjectAnalyzing(false);
          setIsAnalyzing(false);
        }
        return;
      }
      await fetchAnalysisStatus();
    }, 15000);

    const progressInterval = setInterval(() => {
      Object.keys(taskIds).forEach(spreadsheetId => {
        const taskId = taskIds[spreadsheetId];
        fetchProgress(spreadsheetId, taskId);
      });
    }, 5000);

    return () => {
      clearInterval(statusInterval);
      clearInterval(progressInterval);
    };
  }, [projectId, setSpreadsheets, setError, runningIds, setLoading]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (!isMounted.current) return;
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
      if (isMounted.current) {
        setTimers(newTimers);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [spreadsheets]);

  const handleChange = (e) => {
    if (!isMounted.current) return;
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const addSpreadsheet = async (e) => {
    e.preventDefault();
    if (!isMounted.current || isFetching.current) return;
    isFetching.current = true;
    let token = localStorage.getItem('token');
    if (!token) {
      navigate('/app/login');
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
        { headers: { Authorization: `Bearer ${token}` } }
      );

      await fetchSpreadsheets();

      if (isMounted.current) {
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
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err.response?.data?.error || 'Failed to add spreadsheet');
        if (err.response?.status === 401) {
          token = await refreshToken();
          if (token && isMounted.current) {
            try {
              await axios.post(
                `${apiBaseUrl}/${projectId}/spreadsheets`,
                { ...form, gid: parseInt(form.gid), intervalHours: parseInt(form.intervalHours) },
                { headers: { Authorization: `Bearer ${token}` } }
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
            } catch (retryErr) {
              navigate('/app/login');
            }
          }
        }
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
      isFetching.current = false;
    }
  };

  const runAnalysis = async (spreadsheetId) => {
    if (!isMounted.current || isFetching.current) return;
    isFetching.current = true;
    let token = localStorage.getItem('token');
    if (!token) {
      navigate('/app/login');
      return;
    }
    setRunningIds([...runningIds, spreadsheetId]);
    setLoading(true);
    setIsProjectAnalyzing(true);
    setIsAnalyzing(true);
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
        headers: { Authorization: `Bearer ${token}` },
      });
      const { taskId } = response.data;
      if (isMounted.current) {
        setTaskIds(prev => {
          const newTaskIds = { ...prev, [spreadsheetId]: taskId };
          localStorage.setItem(`taskIds-${projectId}`, JSON.stringify(newTaskIds));
          return newTaskIds;
        });
        const updated = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSpreadsheets(updated.data);
        setError(null);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err.response?.data?.error || 'Failed to run analysis');
        setRunningIds(runningIds.filter(id => id !== spreadsheetId));
        setLoading(false);
        setProgressData(prev => {
          const newProgress = { ...prev };
          delete newProgress[spreadsheetId];
          localStorage.setItem(`progressData-${projectId}`, JSON.stringify(newProgress));
          return newProgress;
        });
        setTaskIds(prev => {
          const newTaskIds = { ...prev };
          delete newTaskIds[spreadsheetId];
          localStorage.setItem(`taskIds-${projectId}`, JSON.stringify(newTaskIds));
          return newTaskIds;
        });
        setIsProjectAnalyzing(false);
        setIsAnalyzing(false);
        if (err.response?.status === 401) {
          token = await refreshToken();
          if (token && isMounted.current) {
            try {
              const response = await axios.post(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}/run`, {}, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const { taskId } = response.data;
              setTaskIds(prev => {
                const newTaskIds = { ...prev, [spreadsheetId]: taskId };
                localStorage.setItem(`taskIds-${projectId}`, JSON.stringify(newTaskIds));
                return newTaskIds;
              });
            } catch (retryErr) {
              navigate('/app/login');
            }
          }
        }
      }
    } finally {
      isFetching.current = false;
    }
  };

  const cancelAnalysis = async (spreadsheetId) => {
    if (!isMounted.current || isFetching.current) return;
    isFetching.current = true;
    let token = localStorage.getItem('token');
    if (!token) {
      navigate('/app/login');
      return;
    }
    setLoading(true);
    try {
      const response = await axios.post(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}/cancel`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const updated = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (isMounted.current) {
        setSpreadsheets(updated.data);
        setRunningIds(runningIds.filter(id => id !== spreadsheetId));
        setProgressData(prev => {
          const newProgress = { ...prev };
          delete newProgress[spreadsheetId];
          localStorage.setItem(`progressData-${projectId}`, JSON.stringify(newProgress));
          return newProgress;
        });
        setTaskIds(prev => {
          const newTaskIds = { ...prev };
          delete newTaskIds[spreadsheetId];
          localStorage.setItem(`taskIds-${projectId}`, JSON.stringify(newTaskIds));
          return newTaskIds;
        });
        setIsProjectAnalyzing(false);
        setIsAnalyzing(false);
        setError(null);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err.response?.data?.error || 'Failed to cancel analysis');
        if (err.response?.status === 401) {
          token = await refreshToken();
          if (token && isMounted.current) {
            try {
              await axios.post(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}/cancel`, {}, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const updated = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              setSpreadsheets(updated.data);
              setRunningIds(runningIds.filter(id => id !== spreadsheetId));
            } catch (retryErr) {
              navigate('/app/login');
            }
          }
        }
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
      isFetching.current = false;
    }
  };

  const deleteSpreadsheet = async (spreadsheetId) => {
    if (!isMounted.current || isFetching.current) return;
    isFetching.current = true;
    let token = localStorage.getItem('token');
    if (!token) {
      navigate('/app/login');
      return;
    }
    setLoading(true);
    try {
      await axios.delete(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (isMounted.current) {
        setSpreadsheets(spreadsheets.filter(s => s._id !== spreadsheetId));
        setError(null);
        setProgressData(prev => {
          const newProgress = { ...prev };
          delete newProgress[spreadsheetId];
          localStorage.setItem(`progressData-${projectId}`, JSON.stringify(newProgress));
          return newProgress;
        });
        setTaskIds(prev => {
          const newTaskIds = { ...prev };
          delete newTaskIds[spreadsheetId];
          localStorage.setItem(`taskIds-${projectId}`, JSON.stringify(newTaskIds));
          return newTaskIds;
        });
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err.response?.data?.error || 'Failed to delete spreadsheet');
        if (err.response?.status === 401) {
          token = await refreshToken();
          if (token && isMounted.current) {
            try {
              await axios.delete(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              setSpreadsheets(spreadsheets.filter(s => s._id !== spreadsheetId));
            } catch (retryErr) {
              navigate('/app/login');
            }
          }
        }
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
      isFetching.current = false;
    }
  };

  const resetAnalysisState = () => {
    if (!isMounted.current) return;
    setRunningIds([]);
    setTaskIds({});
    setProgressData({});
    setIsProjectAnalyzing(false);
    setIsAnalyzing(false);
    localStorage.removeItem(`taskIds-${projectId}`);
    localStorage.removeItem(`progressData-${projectId}`);
    fetchSpreadsheets();
    setError(null);
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

      <div className="mb-6">
        <button
          onClick={resetAnalysisState}
          className="bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition-colors shadow-md"
        >
          Reset Analysis State
        </button>
      </div>

      <ul>
        {Array.isArray(spreadsheets) && spreadsheets.length > 0 ? (
          spreadsheets.map((s) => {
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
          })
        ) : (
          <li className="text-gray-500 text-center">No spreadsheets added yet.</li>
        )}
      </ul>
    </motion.div>
  );
};

export default GoogleSheets;
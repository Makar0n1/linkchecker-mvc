import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import serviceAccount from '../../../service-account.json';
import startVideo  from '../../assets/images/start.mp4';
import endVideo from '../../assets/images/end.mp4';

// Заглушка для client_email (заменить на импорт из service-account.json или переменную окружения)
const SERVICE_ACCOUNT_EMAIL = serviceAccount?.client_email || '';

// Собственная функция debounce
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
  setLoading: setParentLoading,
  isAnalyzing,
  stats,
  renderStatsContent,
}) => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    spreadsheetUrl: '',
    targetDomain: '',
    urlColumn: '',
    targetColumn: '',
    resultRangeStart: '',
    resultRangeEnd: '',
    intervalHours: '4',
  });
  const [editForm, setEditForm] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false); // Для модального окна инструкции
  const [showNotification, setShowNotification] = useState(false); // Для уведомления
  const hasNotificationShown = useRef(false);
  const [timers, setTimers] = useState({});
  const [isProjectAnalyzing, setIsProjectAnalyzing] = useState(isAnalyzing);
  const [progressData, setProgressData] = useState({});
  const [taskIds, setTaskIds] = useState({});
  const [isTokenInvalid, setIsTokenInvalid] = useState(false);
  const [isRefreshingToken, setIsRefreshingToken] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [taskTimestamps, setTaskTimestamps] = useState({});
  const [isCopied, setIsCopied] = useState(false);
  const [isWarningModalOpen, setIsWarningModalOpen] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isResultRangeStartFocused, setIsResultRangeStartFocused] = useState(false);
  const [isResultRangeEndFocused, setIsResultRangeEndFocused] = useState(false);

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  const intervalOptions = [
    { value: '0.083', label: '5 minutes' },
    { value: '0.5', label: '30 minutes' },
    { value: '1', label: '1 hour' },
    { value: '4', label: '4 hours' },
    { value: '8', label: '8 hours' },
    { value: '12', label: '12 hours' },
    { value: '24', label: '1 day' },
    { value: '72', label: '3 days' },
    { value: '120', label: '5 days' },
    { value: '240', label: '10 days' },
    { value: '336', label: '14 days' },
    { value: '672', label: '28 days' },
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
      targetDomain: '',
      urlColumn: '',
      targetColumn: '',
      resultRangeStart: '',
      resultRangeEnd: '',
      intervalHours: '4',
    });
    setError(null);
  };

  useEffect(() => {
    let showTimer, hideTimer;
    if (isResultRangeStartFocused || isResultRangeEndFocused) {
      showTimer = setTimeout(() => {
        // Видео отображается через isResultRangeStartFocused
      }, 500); // Появление через 0.5 секунды
      hideTimer = setTimeout(() => {
        setIsResultRangeStartFocused(false);
        setIsResultRangeEndFocused(false);
      }, 10000); // Исчезновение через 9.5 секунд после фокуса (500 + 9500)
    }

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [isResultRangeStartFocused, isResultRangeEndFocused]);

  const validateResultRange = (start, end) => {
    const getColumnIndex = (col) => {
      if (!col || typeof col !== 'string') return -1;
      return col.toUpperCase().charCodeAt(0) - 65; // A=0, B=1, ..., Z=25
    };

    const startIndex = getColumnIndex(start);
    const endIndex = getColumnIndex(end);

    if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) {
      return false;
    }

    const columnCount = endIndex - startIndex + 1;
    return columnCount === 5; // Требуется ровно 5 столбцов
  };

  // Форматирование интервала для отображения в UI
  const formatInterval = (intervalHours) => {
    const hours = parseFloat(intervalHours);
    if (hours < 1) {
      const minutes = Math.round(hours * 60);
      return `${minutes} minutes`;
    } else if (hours < 24) {
      return `${hours} hours`;
    } else {
      const days = Math.round(hours / 24);
      return `${days} day${days > 1 ? 's' : ''}`;
    }
  };

  const debouncedSetProgressData = useCallback(
    debounce((newProgressData) => {
      setProgressData(newProgressData);
    }, 300),
    []
  );

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
        console.error('Error refreshing token:', err.message, err.response?.data);
        setIsTokenInvalid(true);
        setIsRefreshingToken(false);
        setError(err.response?.data?.error || 'Failed to refresh token');
        reject(err);
      }
    });

    return refreshPromise;
  };

  const handleCopyEmail = async () => {
    try {
      const permissionStatus = await navigator.permissions.query({ name: 'clipboard-write' });
      if (permissionStatus.state === 'granted' || permissionStatus.state === 'prompt') {
        const blob = new Blob([String(SERVICE_ACCOUNT_EMAIL)], { type: 'text/plain' });
        const item = new ClipboardItem({ 'text/plain': blob });
        await navigator.clipboard.write([item]);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000); // Сброс через 2 секунды
      } else {
        setError('Failed to copy email: permission to access the clipboard is missing');
      }
    } catch (err) {
      console.error('Failed to copy email:', err.message);
      setError('Не удалось скопировать email: ' + err.message);
    }
  };

  const fetchSpreadsheets = async () => {
    let token = localStorage.getItem('token');
    if (!token) {
      console.error('No token found for fetchSpreadsheets, setting token invalid');
      setIsTokenInvalid(true);
      setError('Authentication token missing. Please log in again.');
      return;
    }
    try {
      setLoading(true);
      setParentLoading(true);
      const response = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSpreadsheets(response.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching spreadsheets:', err.message, err.response?.status, err.response?.data);
      if (err.response?.status === 401) {
        try {
          token = await refreshToken();
          if (token) {
            const response = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            setSpreadsheets(response.data);
            setError(null);
          }
        } catch (retryErr) {
          console.error('Retry fetchSpreadsheets failed:', retryErr.message, retryErr.response?.data);
          setError(retryErr.response?.data?.error || 'Failed to fetch spreadsheets after token refresh');
        }
      } else {
        setError(err.response?.data?.error || 'Failed to fetch spreadsheets');
      }
    } finally {
      setLoading(false);
      setParentLoading(false);
    }
  };

  const fetchActiveTasks = async () => {
    let token = localStorage.getItem('token');
    if (!token) {
      console.error('No token found for fetchActiveTasks, setting token invalid');
      setIsTokenInvalid(true);
      setError('Authentication token missing. Please log in again.');
      return;
    }
    try {
      setLoading(true);
      setParentLoading(true);
      const response = await axios.get(`${apiBaseUrl}/${projectId}/active-spreadsheet-tasks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const tasks = response.data;
      const newTaskIds = {};
      const newProgressData = {};
      const newTaskTimestamps = {};
      tasks.forEach(task => {
        newTaskIds[task.spreadsheetId] = task.taskId;
        newProgressData[task.spreadsheetId] = {
          progress: task.progress || 0,
          processedLinks: task.processedLinks || 0,
          totalLinks: task.totalLinks || 0,
          estimatedTimeRemaining: task.estimatedTimeRemaining || 0,
          status: task.status || 'pending',
        };
        newTaskTimestamps[task.spreadsheetId] = Date.now();
      });
      setTaskIds(prev => {
        const updatedTaskIds = { ...newTaskIds };
        Object.keys(prev).forEach(spreadsheetId => {
          if (!newTaskIds[spreadsheetId]) {
            delete updatedTaskIds[spreadsheetId];
          }
        });
        return updatedTaskIds;
      });
      setProgressData(newProgressData);
      setRunningIds(Object.keys(newTaskIds));
      setTaskTimestamps(newTaskTimestamps);
      setIsProjectAnalyzing(Object.keys(newTaskIds).length > 0);
      setError(null);
    } catch (err) {
      console.error('Error fetching active tasks:', err.message, err.response?.status, err.response?.data);
      if (err.response?.status === 401) {
        try {
          token = await refreshToken();
          if (token) {
            const response = await axios.get(`${apiBaseUrl}/${projectId}/active-spreadsheet-tasks`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const tasks = response.data;
            const newTaskIds = {};
            const newProgressData = {};
            const newTaskTimestamps = {};
            tasks.forEach(task => {
              newTaskIds[task.spreadsheetId] = task.taskId;
              newProgressData[task.spreadsheetId] = {
                progress: task.progress || 0,
                processedLinks: task.processedLinks || 0,
                totalLinks: task.totalLinks || 0,
                estimatedTimeRemaining: task.estimatedTimeRemaining || 0,
                status: task.status || 'pending',
              };
              newTaskTimestamps[task.spreadsheetId] = Date.now();
            });
            setTaskIds(prev => {
              const updatedTaskIds = { ...newTaskIds };
              Object.keys(prev).forEach(spreadsheetId => {
                if (!newTaskIds[spreadsheetId]) {
                  delete updatedTaskIds[spreadsheetId];
                }
              });
              return updatedTaskIds;
            });
            setProgressData(newProgressData);
            setRunningIds(Object.keys(newTaskIds));
            setTaskTimestamps(newTaskTimestamps);
            setIsProjectAnalyzing(Object.keys(newTaskIds).length > 0);
            setError(null);
          }
        } catch (retryErr) {
          console.error('Retry fetchActiveTasks failed:', retryErr.message, retryErr.response?.data);
          setError(retryErr.response?.data?.error || 'Failed to fetch active tasks after token refresh');
        }
      } else {
        setError(err.response?.data?.error || 'Failed to fetch active tasks');
      }
    } finally {
      setLoading(false);
      setParentLoading(false);
    }
  };

  const fetchProgress = async (spreadsheetId, taskId) => {
    let token = localStorage.getItem('token');
    if (!token) {
      console.error(`No token found for fetching progress of task ${taskId}, setting token invalid`);
      setIsTokenInvalid(true);
      setError('Authentication token missing. Please log in again.');
      return;
    }

    try {
      setLoading(true);
      setParentLoading(true);
      const response = await axios.get(`${apiBaseUrl}/${projectId}/task-progress/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = response.data;
      setProgressData(prev => ({
        ...prev,
        [spreadsheetId]: {
          progress: data.progress || 0,
          processedLinks: data.processedLinks || 0,
          totalLinks: data.totalLinks || 0,
          estimatedTimeRemaining: data.estimatedTimeRemaining || 0,
          status: data.status || 'pending',
        },
      }));
      setTaskTimestamps(prev => ({
        ...prev,
        [spreadsheetId]: Date.now(),
      }));
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
        if (data.status === 'failed') {
          setError('Analysis failed. Please try again or check the logs.');
        }
        setRunningIds(prev => prev.filter(id => id !== spreadsheetId));
        setTaskIds(prev => {
          const newTaskIds = { ...prev };
          delete newTaskIds[spreadsheetId];
          return newTaskIds;
        });
        setProgressData(prev => {
          const updatedProgress = { ...prev };
          delete updatedProgress[spreadsheetId];
          return updatedProgress;
        });
        setTaskTimestamps(prev => {
          const updatedTimestamps = { ...prev };
          delete updatedTimestamps[spreadsheetId];
          return updatedTimestamps;
        });
        setIsProjectAnalyzing(Object.keys(taskIds).length === 1);
        fetchSpreadsheets();
      }
    } catch (err) {
      console.error(`Error fetching progress for task ${taskId}:`, err.message, err.response?.status, err.response?.data);
      if (err.response?.status === 401) {
        try {
          token = await refreshToken();
          if (token) {
            const response = await axios.get(`${apiBaseUrl}/${projectId}/task-progress/${taskId}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = response.data;
            setProgressData(prev => ({
              ...prev,
              [spreadsheetId]: {
                progress: data.progress || 0,
                processedLinks: data.processedLinks || 0,
                totalLinks: data.totalLinks || 0,
                estimatedTimeRemaining: data.estimatedTimeRemaining || 0,
                status: data.status || 'pending',
              },
            }));
            setTaskTimestamps(prev => ({
              ...prev,
              [spreadsheetId]: Date.now(),
            }));
            if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
              if (data.status === 'failed') {
                setError('Analysis failed. Please try again or check the logs.');
              }
              setRunningIds(prev => prev.filter(id => id !== spreadsheetId));
              setTaskIds(prev => {
                const newTaskIds = { ...prev };
                delete newTaskIds[spreadsheetId];
                return newTaskIds;
              });
              setProgressData(prev => {
                const updatedProgress = { ...prev };
                delete updatedProgress[spreadsheetId];
                return updatedProgress;
              });
              setTaskTimestamps(prev => {
                const updatedTimestamps = { ...prev };
                delete updatedTimestamps[spreadsheetId];
                return updatedTimestamps;
              });
              setIsProjectAnalyzing(Object.keys(taskIds).length === 1);
              fetchSpreadsheets();
            }
          } else {
            setError('Please log in again to continue.');
          }
        } catch (retryErr) {
          console.error('Retry fetchProgress failed:', retryErr.message, retryErr.response?.data);
          setError('Failed to fetch progress after token refresh. Please log in again.');
        }
      } else if (err.response?.status === 404) {
        setRunningIds(prev => prev.filter(id => id !== spreadsheetId));
        setTaskIds(prev => {
          const newTaskIds = { ...prev };
          delete newTaskIds[spreadsheetId];
          return newTaskIds;
        });
        setProgressData(prev => {
          const updatedProgress = { ...prev };
          delete updatedProgress[spreadsheetId];
          return updatedProgress;
        });
        setTaskTimestamps(prev => {
          const updatedTimestamps = { ...prev };
          delete updatedTimestamps[spreadsheetId];
          return updatedTimestamps;
        });
        setIsProjectAnalyzing(Object.keys(taskIds).length === 1);
        fetchSpreadsheets();
      }
    } finally {
      setLoading(false);
      setParentLoading(false);
    }
  };

  const startSSE = (spreadsheetId, taskId) => {
    let token = localStorage.getItem('token');
    if (!token) {
      console.error(`No token found for SSE task ${taskId}, setting token invalid`);
      setIsTokenInvalid(true);
      setError('Authentication token missing. Please log in again.');
      return null;
    }

    const eventSource = new EventSource(`${apiBaseUrl}/${projectId}/task-progress-sse/${taskId}?token=${token}`);

    eventSource.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.error) {
        console.error(`SSE error for task ${taskId}:`, data.error);
        eventSource.close();
        if (data.error.includes('Invalid token')) {
          try {
            token = await refreshToken();
            if (token) {
              eventSource.close();
              return startSSE(spreadsheetId, taskId);
            }
          } catch (refreshErr) {
            console.error('Failed to refresh token for SSE:', refreshErr.message);
            setError('Please log in again to continue.');
          }
        } else {
          if (data.error.includes('Task not found')) {
            setError('Task not found. Please try again.');
          }
          if (data.status === 'failed') {
            setError('Analysis failed. Please try again or check the logs.');
          }
          setRunningIds(prev => prev.filter(id => id !== spreadsheetId));
          setTaskIds(prev => {
            const newTaskIds = { ...prev };
            delete newTaskIds[spreadsheetId];
            return newTaskIds;
          });
          setProgressData(prev => {
            const updatedProgress = { ...prev };
            delete updatedProgress[spreadsheetId];
            return updatedProgress;
          });
          setTaskTimestamps(prev => {
            const updatedTimestamps = { ...prev };
            delete updatedTimestamps[spreadsheetId];
            return updatedTimestamps;
          });
          setIsProjectAnalyzing(Object.keys(taskIds).length === 1);
          fetchSpreadsheets();
        }
        return;
      }
      setProgressData(prev => ({
        ...prev,
        [spreadsheetId]: {
          progress: data.progress || 0,
          processedLinks: data.processedLinks || 0,
          totalLinks: data.totalLinks || 0,
          estimatedTimeRemaining: data.estimatedTimeRemaining || 0,
          status: data.status || 'pending',
        },
      }));
      setTaskTimestamps(prev => ({
        ...prev,
        [spreadsheetId]: Date.now(),
      }));
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
        if (data.status === 'failed') {
          setError('Analysis failed. Please try again or check the logs.');
        }
        setRunningIds(prev => prev.filter(id => id !== spreadsheetId));
        setTaskIds(prev => {
          const newTaskIds = { ...prev };
          delete newTaskIds[spreadsheetId];
          return newTaskIds;
        });
        setProgressData(prev => {
          const updatedProgress = { ...prev };
          delete updatedProgress[spreadsheetId];
          return updatedProgress;
        });
        setTaskTimestamps(prev => {
          const updatedTimestamps = { ...prev };
          delete updatedTimestamps[spreadsheetId];
          return updatedTimestamps;
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
      setProgressData(prev => {
        const updatedProgress = { ...prev };
        delete updatedProgress[spreadsheetId];
        return updatedProgress;
      });
      setTaskTimestamps(prev => {
        const updatedTimestamps = { ...prev };
        delete updatedTimestamps[spreadsheetId];
        return updatedTimestamps;
      });
      setIsProjectAnalyzing(Object.keys(taskIds).length === 1);
      fetchSpreadsheets();
    };

    return eventSource;
  };

  // Проверка зависших задач
  useEffect(() => {
    const checkStaleTasks = async () => {
      const STALE_THRESHOLD = 5 * 60 * 1000; // 5 минут
      const now = Date.now();
      Object.keys(taskIds).forEach(async (spreadsheetId) => {
        const taskTimestamp = taskTimestamps[spreadsheetId];
        const taskProgress = progressData[spreadsheetId];
        if (taskTimestamp && (now - taskTimestamp > STALE_THRESHOLD) && taskProgress?.status !== 'completed') {
          await cancelAnalysis(spreadsheetId);
          setError(`Task for spreadsheet ${spreadsheetId} was cancelled due to inactivity.`);
        }
      });
    };

    const intervalId = setInterval(checkStaleTasks, 60000);
    return () => clearInterval(intervalId);
  }, [taskIds, taskTimestamps, progressData]);

  // Управление уведомлением
  useEffect(() => {
    // Если открыто модальное окно (инструкции или добавления) или есть таблицы — не показываем уведомление
    if (isInfoModalOpen || isAddModalOpen || hasNotificationShown.current || spreadsheets.length > 0) {
      setShowNotification(false);
      return;
    }

    // Помечаем, что уже показывали
    hasNotificationShown.current = true;

    // Таймеры на показ и скрытие
    const showTimer = setTimeout(() => {
      setShowNotification(true);
    }, 1000);

    const hideTimer = setTimeout(() => {
      setShowNotification(false);
    }, 5000); // 1 + 4 секунды

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [isInfoModalOpen, isAddModalOpen, spreadsheets.length]);

  useEffect(() => {
    fetchSpreadsheets();
    fetchActiveTasks();
    const statusInterval = setInterval(fetchActiveTasks, 10000);
    return () => {
      clearInterval(statusInterval);
    };
  }, [projectId]);

  useEffect(() => {
    const eventSources = {};
    Object.keys(taskIds).forEach(spreadsheetId => {
      const taskId = taskIds[spreadsheetId];
      fetchProgress(spreadsheetId, taskId);
      eventSources[spreadsheetId] = startSSE(spreadsheetId, taskId);
    });
    return () => {
      Object.values(eventSources).forEach(eventSource => eventSource?.close());
    };
  }, [taskIds]);

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

  const handleFormChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleEditChange = (e) => {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  };

  const openEditModal = (spreadsheet) => {
    setEditForm({
      _id: spreadsheet._id,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheet.spreadsheetId}/edit?gid=${spreadsheet.gid}`,
      targetDomain: spreadsheet.targetDomain,
      urlColumn: spreadsheet.urlColumn,
      targetColumn: spreadsheet.targetColumn,
      resultRangeStart: spreadsheet.resultRangeStart,
      resultRangeEnd: spreadsheet.resultRangeEnd,
      intervalHours: spreadsheet.intervalHours.toString(),
    });
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditForm(null);
    setError(null);
  };

  const openInfoModal = () => {
    setIsInfoModalOpen(true);
  };

  const closeInfoModal = () => {
    setIsInfoModalOpen(false);
  };

  const addSpreadsheet = async (e) => {
    e.preventDefault();
    let token = localStorage.getItem('token');
    setLoading(true);
    setParentLoading(true);
    try {
      const { spreadsheetUrl, targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours } = form;
      const { spreadsheetId, gid } = parseSpreadsheetUrl(spreadsheetUrl);
      if (!spreadsheetId || !gid || !targetDomain || !urlColumn || !targetColumn || !resultRangeStart || !resultRangeEnd || !intervalHours) {
        setError('All fields are required or invalid spreadsheet URL');
        setLoading(false);
        setParentLoading(false);
        return;
      }

      // Проверка диапазона результатов
      if (!validateResultRange(resultRangeStart, resultRangeEnd)) {
        setError('The result range must include exactly 5 columns (e.g., L:P)');
        setLoading(false);
        setParentLoading(false);
        return;
      }

      // Проверка на дублирование таблицы
      const isDuplicate = spreadsheets.some(
        (s) => s.spreadsheetId === spreadsheetId && s.gid === parseInt(gid)
      );
      if (isDuplicate) {
        setError('This spreadsheet (with the given URL) has already been added to the project');
        setLoading(false);
        setParentLoading(false);
        return;
      }

      console.log('Adding spreadsheet with data:', { projectId, spreadsheetId, gid: parseInt(gid), targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours: parseFloat(intervalHours) });
      const response = await axios.post(
        `${apiBaseUrl}/${projectId}/spreadsheets`,
        { spreadsheetId, gid: parseInt(gid), targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours: parseFloat(intervalHours) },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      console.log('Add spreadsheet response:', response.data);
      
      // Проверяем warning в ответе
      if (response.data.warning) {
        setWarningMessage(response.data.warning);
        setIsWarningModalOpen(true);
      }

      await fetchSpreadsheets();
      setForm({
        spreadsheetUrl: '',
        targetDomain: '',
        urlColumn: '',
        targetColumn: '',
        resultRangeStart: '',
        resultRangeEnd: '',
        intervalHours: '4',
      });
      setError(null);
    } catch (err) {
      console.error('Error adding spreadsheet:', err.message, err.response?.status, err.response?.data);
      if (err.response?.status === 401) {
        try {
          token = await refreshToken();
          if (token) {
            console.log('Retrying add spreadsheet with new token:', token.substring(0, 10));
            const { spreadsheetUrl, targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours } = form;
            const { spreadsheetId, gid } = parseSpreadsheetUrl(spreadsheetUrl);
            const response = await axios.post(
              `${apiBaseUrl}/${projectId}/spreadsheets`,
              { spreadsheetId, gid: parseInt(gid), targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours: parseFloat(intervalHours) },
              { headers: { Authorization: `Bearer ${token}` } }
            );
            console.log('Retry add spreadsheet response:', response.data);
            
            // Проверяем warning в ответе при повторной попытке
            if (response.data.warning) {
              setWarningMessage(response.data.warning);
              setIsWarningModalOpen(true);
            }

            await fetchSpreadsheets();
            setForm({
              spreadsheetUrl: '',
              targetDomain: '',
              urlColumn: '',
              targetColumn: '',
              resultRangeStart: '',
              resultRangeEnd: '',
              intervalHours: '4',
            });
            setError(null);
          }
        } catch (retryErr) {
          console.error('Retry addSpreadsheet failed:', retryErr.message, retryErr.response?.data);
          setError(retryErr.response?.data?.error || 'Failed to add spreadsheet after token refresh');
        }
      } else {
        setError(err.response?.data?.error || 'Failed to add spreadsheet');
      }
    } finally {
      setLoading(false);
      setParentLoading(false);
    }
  };

  const editSpreadsheet = async (e) => {
    e.preventDefault();
    let token = localStorage.getItem('token');
    setLoading(true);
    setParentLoading(true);
    try {
      const { _id, spreadsheetUrl, targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours } = editForm;
      const { spreadsheetId, gid } = parseSpreadsheetUrl(spreadsheetUrl);
      if (!spreadsheetId || !gid || !targetDomain || !urlColumn || !targetColumn || !resultRangeStart || !resultRangeEnd || !intervalHours) {
        setError('All fields are required or invalid spreadsheet URL');
        setLoading(false);
        setParentLoading(false);
        return;
      }

      // Проверка диапазона результатов
      if (!validateResultRange(resultRangeStart, resultRangeEnd)) {
        setError('The result range must include exactly 5 columns (e.g., L:P)');
        setLoading(false);
        setParentLoading(false);
        return;
      }

      // Проверка на дублирование таблицы (кроме текущей)
      const isDuplicate = spreadsheets.some(
        (s) => s._id !== _id && s.spreadsheetId === spreadsheetId && s.gid === parseInt(gid)
      );
      if (isDuplicate) {
        setError('This spreadsheet (with the given URL) has already been added to the project');
        setLoading(false);
        setParentLoading(false);
        return;
      }

      console.log('Editing spreadsheet with data:', { _id, projectId, spreadsheetId, gid: parseInt(gid), targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours: parseFloat(intervalHours) });
      const response = await axios.put(
        `${apiBaseUrl}/${projectId}/spreadsheets/${_id}`,
        { spreadsheetId, gid: parseInt(gid), targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours: parseFloat(intervalHours) },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      console.log('Edit spreadsheet response:', response.data);
      await fetchSpreadsheets();
      closeEditModal();
      setError(null);
    } catch (err) {
      console.error('Error editing spreadsheet:', err.message, err.response?.status, err.response?.data);
      if (err.response?.status === 401) {
        try {
          token = await refreshToken();
          if (token) {
            console.log('Retrying edit spreadsheet with new token:', token.substring(0, 10));
            const { _id, spreadsheetUrl, targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours } = editForm;
            const { spreadsheetId, gid } = parseSpreadsheetUrl(spreadsheetUrl);
            const response = await axios.put(
              `${apiBaseUrl}/${projectId}/spreadsheets/${_id}`,
              { spreadsheetId, gid: parseInt(gid), targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours: parseFloat(intervalHours) },
              { headers: { Authorization: `Bearer ${token}` } }
            );
            console.log('Retry edit spreadsheet response:', response.data);
            await fetchSpreadsheets();
            closeEditModal();
            setError(null);
          }
        } catch (retryErr) {
          console.error('Retry editSpreadsheet failed:', retryErr.message, retryErr.response?.data);
          setError(retryErr.response?.data?.error || 'Failed to edit spreadsheet after token refresh');
        }
      } else {
        setError(err.response?.data?.error || `Failed to edit spreadsheet: ${err.message}`);
      }
    } finally {
      setLoading(false);
      setParentLoading(false);
    }
  };

  const runAnalysis = async (spreadsheetId) => {
    let token = localStorage.getItem('token');
    if (!token) {
      setError('Authorization token is missing. Please log in again.');
      navigate('/login');
      return;
    }
    setRunningIds([...runningIds, spreadsheetId]);
    setLoading(true);
    setParentLoading(true);
    try {
      const response = await axios.post(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}/run`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const { taskId } = response.data;
      setTaskIds(prev => ({
        ...prev,
        [spreadsheetId]: taskId,
      }));
      setTaskTimestamps(prev => ({
        ...prev,
        [spreadsheetId]: Date.now(),
      }));
      const updated = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSpreadsheets(updated.data);
      setError(null);
    } catch (err) {
      console.error('Error running analysis:', err.message, err.response?.status, err.response?.data);
      if (err.response?.status === 401) {
        try {
          token = await refreshToken();
          if (token) {
            const response = await axios.post(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}/run`, {}, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const { taskId } = response.data;
            setTaskIds(prev => ({
              ...prev,
              [spreadsheetId]: taskId,
            }));
            setTaskTimestamps(prev => ({
              ...prev,
              [spreadsheetId]: Date.now(),
            }));
            const updated = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            setSpreadsheets(updated.data);
            setError(null);
          }
        } catch (retryErr) {
          console.error('Retry runAnalysis failed:', retryErr.message, retryErr.response?.data);
          setError(retryErr.response?.data?.error || 'Failed to start analysis after token refresh');
        }
      } else {
        const errorMessage = err.response?.data?.error || 'Failed to start analysis';
        setError(errorMessage.includes('already in progress') ? 'Spreadsheet analysis is already in progress' : errorMessage.includes('not found') ? 'Spreadsheet not found' : errorMessage);
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
        setTaskTimestamps(prev => {
          const updatedTimestamps = { ...prev };
          delete updatedTimestamps[spreadsheetId];
          return updatedTimestamps;
        });
      }
    } finally {
      setLoading(false);
      setParentLoading(false);
    }
  };

  const cancelAnalysis = async (spreadsheetId) => {
    let token = localStorage.getItem('token');
    setLoading(true);
    setParentLoading(true);
    try {
      const response = await axios.post(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}/cancel`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const updated = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
        headers: { Authorization: `Bearer ${token}` },
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
      setTaskTimestamps(prev => {
        const updatedTimestamps = { ...prev };
        delete updatedTimestamps[spreadsheetId];
        return updatedTimestamps;
      });
      setIsProjectAnalyzing(false);
      setError(null);
    } catch (err) {
      console.error('Error cancelling analysis:', err.message, err.response?.status, err.response?.data);
      if (err.response?.status === 401) {
        try {
          token = await refreshToken();
          if (token) {
            const response = await axios.post(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}/cancel`, {}, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const updated = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
              headers: { Authorization: `Bearer ${token}` },
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
            setTaskTimestamps(prev => {
              const updatedTimestamps = { ...prev };
              delete updatedTimestamps[spreadsheetId];
              return updatedTimestamps;
            });
            setIsProjectAnalyzing(false);
            setError(null);
          }
        } catch (retryErr) {
          console.error('Retry cancelAnalysis failed:', retryErr.message, retryErr.response?.data);
          setError(retryErr.response?.data?.error || 'Failed to cancel analysis after token refresh');
        }
      } else {
        setError(err.response?.data?.error || 'Failed to cancel analysis');
      }
    } finally {
      setLoading(false);
      setParentLoading(false);
    }
  };

  const deleteSpreadsheet = async (spreadsheetId) => {
    let token = localStorage.getItem('token');
    setLoading(true);
    setParentLoading(true);
    try {
      const response = await axios.delete(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}`, {
        headers: { Authorization: `Bearer ${token}` },
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
      setTaskTimestamps(prev => {
        const updatedTimestamps = { ...prev };
        delete updatedTimestamps[spreadsheetId];
        return updatedTimestamps;
      });
    } catch (err) {
      console.error('Error deleting spreadsheet:', err.message, err.response?.status, err.response?.data);
      if (err.response?.status === 401) {
        try {
          token = await refreshToken();
          if (token) {
            const response = await axios.delete(`${apiBaseUrl}/${projectId}/spreadsheets/${spreadsheetId}`, {
              headers: { Authorization: `Bearer ${token}` },
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
            setTaskTimestamps(prev => {
              const updatedTimestamps = { ...prev };
              delete updatedTimestamps[spreadsheetId];
              return updatedTimestamps;
            });
          }
        } catch (retryErr) {
          console.error('Retry deleteSpreadsheet failed:', retryErr.message, retryErr.response?.data);
          setError(retryErr.response?.data?.error || 'Failed to delete spreadsheet after token refresh');
        }
      } else {
        setError(err.response?.data?.error || 'Failed to delete spreadsheet');
      }
    } finally {
      setLoading(false);
      setParentLoading(false);
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

  const modalVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: 'easeOut' } },
    exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2, ease: 'easeIn' } },
  };

  const notificationVariants = {
    hidden: { opacity: 0, y: -20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
    exit: { opacity: 0, y: -20, transition: { duration: 0.5, ease: 'easeIn' } },
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
            Закрыть
          </button>
        </div>
      )}

      

      {/* <div className="relative">
        <form onSubmit={addSpreadsheet} className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="col-span-1 sm:col-span-2 flex items-center justify-between mb-2">
            <h3 className="text-base sm:text-lg font-semibold text-gray-800">Add Google Sheet</h3>
            <button
              type="button"
              onClick={openInfoModal}
              className="text-gray-500 hover:text-gray-700"
              title="Инструкция по добавлению"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
          <div className="col-span-1 sm:col-span-2 google-sheet-fields">
            <input
              name="spreadsheetUrl"
              value={form.spreadsheetUrl}
              onChange={handleFormChange}
              placeholder="Spreadsheet URL (e.g., https://docs.google.com/spreadsheets/d/.../edit?gid=...)"
              type="text"
              className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
              disabled={loading || isProjectAnalyzing || isTokenInvalid}
            />
          </div>
          {[
            { name: 'targetDomain', placeholder: 'Target domain' },
            { name: 'urlColumn', placeholder: 'URL column (e.g., D)' },
            { name: 'targetColumn', placeholder: 'Target column (e.g., I)' },
            { name: 'resultRangeStart', placeholder: 'Result range start (e.g., L)' },
            { name: 'resultRangeEnd', placeholder: 'Result range end (e.g., P)' },
          ].map((field) => (
            <div key={field.name} className="relative google-sheet-fields">
              <input
                name={field.name}
                value={form[field.name]}
                onChange={handleFormChange}
                placeholder={field.placeholder}
                type="text"
                className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                disabled={loading || isProjectAnalyzing || isTokenInvalid}
              />
            </div>
          ))}
          <select
            name="intervalHours"
            value={form.intervalHours}
            onChange={handleFormChange}
            className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50"
            disabled={loading || isProjectAnalyzing || isTokenInvalid}
          >
            {intervalOptions.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            type="submit"
            className="col-span-1 sm:col-span-2 bg-green-500 text-white p-2 rounded-lg hover:bg-green-600 transition-colors shadow-md disabled:bg-green-300"
            disabled={loading || isProjectAnalyzing || isTokenInvalid}
          >
            {loading ? 'Adding...' : 'Add spreadsheet'}
          </button>
        </form>
      </div> */}

      <div className="relative border-b border-gray-200 mb-6">
        <div className="col-span-1 sm:col-span-2 flex items-center justify-between mb-4">
          <h3 className="text-base flex gap-[20px] sm:gap-[50px] items-center sm:text-2xl font-semibold text-gray-800">Add Google Sheet
              <button
              onClick={openAddModal}
              className="bg-green-500 text-white p-2 rounded-full hover:bg-green-600 transition-colors shadow-md"
              title="Add new spreadsheet"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
            </button>

          </h3>
          
          <div className="flex items-center gap-2">
            <AnimatePresence>
              {showNotification && (
                <motion.div
                  className="hidden sm:block fixed top-[312px] right-[65px] bg-blue-100 text-blue-700 text-sm px-3 py-2 rounded-tl-md rounded-tr-md rounded-bl-md shadow-md z-[9999] pointer-events-none"
                  variants={{
                    hidden: { opacity: 0, y: -10 },
                    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
                    exit: { opacity: 0, y: -10, transition: { duration: 0.5, ease: 'easeIn' } },
                  }}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  Сперва ознакомьтесь с информацией перед добавлением
                </motion.div>
              )}
            </AnimatePresence>
            <button
              type="button"
              onClick={openInfoModal}
              className="text-gray-500 hover:text-gray-700"
              title="Инструкция по добавлению"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

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
                      {s.spreadsheetId} - {s.targetDomain} - Every {formatInterval(s.intervalHours)}
                    </span>
                  </div>
                  <div className="text-gray-600 text-sm">
                    <p>Scans: {s.scanCount || 0}</p>
                    <p>Status: {progress.status === 'pending' ? 'Waiting' : progress.status === 'checking' ? 'Checking' : progress.status === 'completed' ? 'Completed' : 'Not started'}</p>
                    <p>Last scan: {s.lastRun ? new Date(s.lastRun).toLocaleString('en-US') : 'Never'}</p>
                    <p>Next scan in: {timers[s._id] || 'Calculating...'}</p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 sm:ml-auto">
                  {(s.status === 'checking' || isRunning) && isProjectAnalyzing ? (
                    <button
                      onClick={() => cancelAnalysis(s._id)}
                      className="bg-red-500 text-white px-3 py-1 sm:px-4 sm:py-1 rounded-lg hover:bg-red-600 transition-colors"
                      disabled={isTokenInvalid}
                    >
                      Cancel
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => runAnalysis(s._id)}
                        disabled={loading || isRunning || isProjectAnalyzing || isTokenInvalid}
                        className={`bg-green-500 text-white px-3 py-1 sm:px-4 sm:py-1 rounded-lg ${loading || isRunning || isProjectAnalyzing || isTokenInvalid ? 'opacity-50 cursor-not-allowed' : 'hover:bg-green-600'} transition-colors`}
                      >
                        {isRunning ? 'Running...' : 'Start'}
                      </button>
                      <button
                        onClick={() => openEditModal(s)}
                        disabled={loading || isRunning || isProjectAnalyzing || isTokenInvalid}
                        className={`bg-yellow-500 text-white px-3 py-1 sm:px-4 sm:py-1 rounded-lg ${loading || isRunning || isProjectAnalyzing || isTokenInvalid ? 'opacity-50 cursor-not-allowed' : 'hover:bg-yellow-600'} transition-colors`}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteSpreadsheet(s._id)}
                        disabled={loading || isRunning || isProjectAnalyzing || isTokenInvalid}
                        className={`bg-red-500 text-white px-3 py-1 sm:px-4 sm:py-1 rounded-lg ${loading || isRunning || isProjectAnalyzing || isTokenInvalid ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-600'} transition-colors`}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
              {(isRunning || progress.status === 'pending' || progress.status === 'checking') && isProjectAnalyzing && (
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
                    <p>Time remaining: {progress.estimatedTimeRemaining} seconds</p>
                  </div>
                </div>
              )}
            </motion.li>
          );
        })}
      </ul>

      {/* Модальное окно для добавления таблицы */} 
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
          <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-4">Add Google Sheet</h3>
          <form onSubmit={addSpreadsheet} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-1 sm:col-span-2 google-sheet-fields">
              <input
                name="spreadsheetUrl"
                value={form.spreadsheetUrl}
                onChange={handleFormChange}
                placeholder="Spreadsheet URL (e.g., https://docs.google.com/spreadsheets/d/.../edit?gid=...)"
                type="text"
                className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                disabled={loading || isProjectAnalyzing || isTokenInvalid}
                onFocus={() => {
                  setIsResultRangeStartFocused(false);
                  setIsResultRangeEndFocused(false);
                }}
              />
            </div>
            {[
              { name: 'targetDomain', placeholder: 'Target domain' },
              { name: 'urlColumn', placeholder: 'URL column (e.g., D)' },
              { name: 'targetColumn', placeholder: 'Target column (e.g., I)' },
              { name: 'resultRangeStart', placeholder: 'Result range start (e.g., L)' },
            ].map((field) => (
              <div key={field.name} className="relative google-sheet-fields">
                <input
                  name={field.name}
                  value={form[field.name]}
                  onChange={handleFormChange}
                  placeholder={field.placeholder}
                  type="text"
                  className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                  disabled={loading || isProjectAnalyzing || isTokenInvalid}
                  onFocus={() => {
                    if (field.name === 'resultRangeStart') {
                      setIsResultRangeStartFocused(true);
                      setIsResultRangeEndFocused(false);
                    } else {
                      setIsResultRangeStartFocused(false);
                      setIsResultRangeEndFocused(false);
                    }
                  }}
                />
                {field.name === 'resultRangeStart' && (
                  <p className="text-gray-500 text-[10px] mt-1">
                    The result range must include 5 columns (e.g., L:P).
                  </p>
                )}
              </div>
            ))}
            <div className="relative google-sheet-fields">
              <input
                name="resultRangeEnd"
                value={form.resultRangeEnd}
                onChange={handleFormChange}
                placeholder="Result range end (e.g., P)"
                type="text"
                className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                disabled={loading || isProjectAnalyzing || isTokenInvalid}
                onFocus={() => {
                  setIsResultRangeStartFocused(false);
                  setIsResultRangeEndFocused(true);
                }}
              />
              <p className="text-gray-500 text-[10px] mt-1">
                The result range must include 5 columns (e.g., L:P).
              </p>
            </div>
            <div className="relative google-sheet-fields">
              <select
                name="intervalHours"
                value={form.intervalHours}
                onChange={handleFormChange}
                className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                disabled={loading || isProjectAnalyzing || isTokenInvalid}
                onFocus={() => {
                  setIsResultRangeStartFocused(false);
                  setIsResultRangeEndFocused(false);
                }}
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
                disabled={loading || isProjectAnalyzing || isTokenInvalid}
              >
                {loading ? 'Adding...' : 'Add spreadsheet'}
              </button>
            </div>
          </form>
        </div>
        <AnimatePresence>
          {isResultRangeStartFocused && (
            <motion.video
              src={startVideo}
              autoPlay
              loop
              muted
              className="hidden sm:block absolute rounded-lg right-[3vw] w-[30vw] max-w-[20vw] min-w-[20vw] h-auto z-[9999] will-change-transform"
              style={{ transform: 'translateZ(0)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.9, transition: { duration: 0.5, ease: 'easeOut' } }}
              exit={{ opacity: 0, transition: { duration: 0.5, ease: 'easeIn' } }}
            />
          )}
          {isResultRangeEndFocused && (
            <motion.video
              src={endVideo}
              autoPlay
              loop
              muted
              className="hidden sm:block absolute rounded-lg top-[50vh] right-[77vw] w-[30vw] max-w-[20vw] min-w-[20vw] h-auto z-[9999] will-change-transform"
              style={{ transform: 'translateZ(0)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.9, transition: { duration: 0.5, ease: 'easeOut' } }}
              exit={{ opacity: 0, transition: { duration: 0.5, ease: 'easeIn' } }}
            />
          )}
        </AnimatePresence>
      </motion.div>
    )}
  </AnimatePresence>
      {/* Модальное окно для редактирования таблицы */}
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
              <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-4">Редактировать таблицу</h3>
              <form onSubmit={editSpreadsheet} className="flex flex-col gap-4">
                <div className="relative google-sheet-fields">
                  <input
                    name="spreadsheetUrl"
                    value={editForm ? editForm.spreadsheetUrl : ''}
                    onChange={handleEditChange}
                    placeholder="Spreadsheet URL (e.g., https://docs.google.com/spreadsheets/d/.../edit?gid=...)"
                    type="text"
                    className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                    disabled={loading}
                  />
                </div>
                {[
                  { name: 'targetDomain', placeholder: 'Target domain' },
                  { name: 'urlColumn', placeholder: 'URL column (e.g., D)' },
                  { name: 'targetColumn', placeholder: 'Target column (e.g., I)' },
                  { name: 'resultRangeStart', placeholder: 'Result range start (e.g., L)' },
                  { name: 'resultRangeEnd', placeholder: 'Result range end (e.g., P)' },
                ].map((field) => (
                  <div key={field.name} className="relative google-sheet-fields">
                    <input
                      name={field.name}
                      value={editForm ? editForm[field.name] : ''}
                      onChange={handleEditChange}
                      placeholder={field.placeholder}
                      type="text"
                      className="p-[1.5px] sm:p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 w-full"
                      disabled={loading}
                    />
                    {(field.name === 'resultRangeStart' || field.name === 'resultRangeEnd') && (
                      <p className="text-gray-500 text-[10px] mt-1">
                        The result range must include 5 columns (e.g., L:P).
                      </p>
                    )}
                  </div>
                ))}
                <select
                  name="intervalHours"
                  value={editForm ? editForm.intervalHours : ''}
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
                  {loading ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Модальное окно с инструкцией */}
      <AnimatePresence>
    {isInfoModalOpen && (
      <motion.div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={modalVariants}
      >
        <div className="relative modal-mobile bg-white rounded-lg shadow-lg w-full max-w-[30vw] mx-4 p-4 sm:p-6 overflow-y-auto max-h-[75vh]">
          <button
            onClick={closeInfoModal}
            className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-4">Инструкция по добавлению Google Таблицы</h3>
          <p className="text-gray-600">
            Чтобы сервис мог работать с вашей Google Таблицей, скопируйте полную ссылку на таблицу (например, https://docs.google.com/spreadsheets/d/.../edit?gid=...) и вставьте её в поле формы. Затем добавьте почту сервисного аккаунта в редакторы таблицы. Перейдите в настройки доступа вашей Google Таблицы и добавьте следующий адрес электронной почты в список редакторов:
          </p>
          <div className="flex items-center mt-2">
            {SERVICE_ACCOUNT_EMAIL ? (
              <p className="text-gray-800 py-1 px-2 rounded-lg bg-gray-200 font-semibold text-[12px] break-all">{SERVICE_ACCOUNT_EMAIL}</p>
            ) : (
              <p className="text-red-600 text-sm">Адрес сервисного аккаунта не задан. Обратитесь к администратору.</p>
            )}
            <button
              onClick={handleCopyEmail}
              className={`ml-2 px-2 py-1 rounded-lg text-sm transition-colors ${isCopied ? 'bg-green-200 text-green-700' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
              title="Скопировать email"
              disabled={!SERVICE_ACCOUNT_EMAIL}
            >
              {isCopied ? 'Скопировано!' : 'Скопировать'}
            </button>
          </div>
          <p className="text-gray-600 mt-4">
            Результаты анализа будут занимать 5 столбцов в таблице. Рекомендуется в первой строке указанного диапазона добавить заголовки столбцов (слева направо): <strong>"Статус", "Ответ сайта", "Индексируемость", "Причина не индексации", "Наличие ссылки"</strong>. Указывайте диапазон из 5 столбцов, например, L:P (L, M, N, O, P). Если вы укажете менее или более 5 столбцов, появится уведомление об ошибке.
          </p>
          <p className="text-gray-600 mt-2">
            После этого вы сможете успешно добавить таблицу для анализа в этом интерфейсе.
          </p>
          <button
            onClick={closeInfoModal}
            className="mt-4 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors shadow-md"
          >
            Понятно
          </button>
        </div>
      </motion.div>
    )}
  </AnimatePresence>

      {/* Модальное окно с предупреждением */}
      <AnimatePresence>
        {isWarningModalOpen && (
          <motion.div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={modalVariants}
          >
            <div className="relative bg-white modal-mobile-warn rounded-lg shadow-lg w-full max-w-[30vw] mx-4 p-4 sm:p-6 overflow-y-auto max-h-[75vh]">
              <button
                onClick={() => setIsWarningModalOpen(false)}
                className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-4">Внимание</h3>
              <p className="text-gray-600">
                Внимание: {warningMessage}
              </p>
              <button
                onClick={() => setIsWarningModalOpen(false)}
                className="mt-4 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors shadow-md"
              >
                Я понимаю, приму меры
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default GoogleSheets;
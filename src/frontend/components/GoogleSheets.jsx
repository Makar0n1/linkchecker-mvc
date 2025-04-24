import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';

const GoogleSheets = ({
  projectId,
  spreadsheets,
  setSpreadsheets,
  runningIds,
  setRunningIds,
  setLoading,
  setError,
}) => {
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

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  useEffect(() => {
    const token = localStorage.getItem('token');
    const fetchSpreadsheets = async () => {
      try {
        const response = await axios.get(`${apiBaseUrl}/${projectId}/spreadsheets`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSpreadsheets(response.data);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to fetch spreadsheets');
      }
    };

    fetchSpreadsheets();
  }, [projectId, setSpreadsheets, setError]);

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
      setSpreadsheets([...spreadsheets, { ...response.data, status: 'inactive' }]);
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
    } finally {
      setRunningIds(runningIds.filter(runningId => runningId !== spreadsheetId));
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
      inactive: 'bg-gray-400',
      completed: 'bg-green-500',
      running: 'bg-blue-500',
      error: 'bg-red-500',
    }[status];
  };

  const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  return (
    <motion.div
      className="max-w-full mx-auto overflow-hidden"
      initial="hidden"
      animate="visible"
      variants={fadeInUp}
    >
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
          />
        ))}
        <button type="submit" className="col-span-2 bg-green-500 text-white p-2 rounded-lg hover:bg-green-600 transition-colors shadow-md">
          Add Spreadsheet
        </button>
      </form>
      <ul>
        {spreadsheets.map((s) => {
          const isRunning = runningIds.includes(s._id);
          return (
            <motion.li
              key={s._id}
              className="mb-4 flex items-center justify-between p-3 bg-gray-50 rounded-lg shadow-sm hover:bg-gray-100 transition-colors"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex items-center gap-2">
                <span className={`w-4 h-4 rounded-full ${statusColor(s.status, isRunning)}`}></span>
                <span className="text-gray-700">{s.spreadsheetId} - {s.targetDomain} - Every {s.intervalHours} hours</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => runAnalysis(s._id)}
                  disabled={isRunning}
                  className={`bg-green-500 text-white px-4 py-1 rounded-lg ${isRunning ? 'opacity-50 cursor-not-allowed' : 'hover:bg-green-600'} transition-colors`}
                >
                  {isRunning ? 'Running...' : 'Run'}
                </button>
                <button
                  onClick={() => deleteSpreadsheet(s._id)}
                  className="bg-red-500 text-white px-4 py-1 rounded-lg hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
};

export default GoogleSheets;
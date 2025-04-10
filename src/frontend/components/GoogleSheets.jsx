import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { motion } from 'framer-motion';

const GoogleSheets = () => {
  const { setError } = useOutletContext();
  const [spreadsheets, setSpreadsheets] = useState([]);
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
  const [runningIds, setRunningIds] = useState([]);

  const apiBaseUrl = `http://${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  useEffect(() => {
    const fetchSpreadsheets = async () => {
      const token = localStorage.getItem('token');
      try {
        const response = await fetch(`${apiBaseUrl}/spreadsheets`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to fetch spreadsheets');
        }
        const data = await response.json();
        setSpreadsheets(data);
      } catch (err) {
        setError(err.message);
      }
    };
    fetchSpreadsheets();
  }, [setError]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const addSpreadsheet = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`${apiBaseUrl}/spreadsheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, gid: parseInt(form.gid), intervalHours: parseInt(form.intervalHours) }),
      });
      if (!response.ok) throw new Error('Failed to add spreadsheet');
      const data = await response.json();
      setSpreadsheets([...spreadsheets, { ...data, status: 'inactive' }]);
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
    } catch (err) {
      setError(err.message || 'Failed to add spreadsheet');
    }
  };

  const runAnalysis = async (id) => {
    const token = localStorage.getItem('token');
    setRunningIds([...runningIds, id]);
    try {
      const response = await fetch(`${apiBaseUrl}/spreadsheets/${id}/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to run analysis');
      const updated = await fetch(`${apiBaseUrl}/spreadsheets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSpreadsheets(await updated.json());
    } catch (err) {
      setError(err.message || 'Failed to run analysis');
    } finally {
      setRunningIds(runningIds.filter(runningId => runningId !== id));
    }
  };

  const deleteSpreadsheet = async (id) => {
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`${apiBaseUrl}/spreadsheets/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to delete spreadsheet');
      setSpreadsheets(spreadsheets.filter(s => s._id !== id));
    } catch (err) {
      setError('Failed to delete spreadsheet');
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
      className="bg-white p-6 rounded-lg shadow-md"
      initial="hidden"
      animate="visible"
      variants={fadeInUp}
    >
      <h2 className="text-2xl font-semibold text-gray-800 mb-6">Google Sheets Analysis</h2>
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
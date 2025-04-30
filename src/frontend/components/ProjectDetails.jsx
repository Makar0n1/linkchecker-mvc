import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';
import ManualLinks from './ManualLinks';
import GoogleSheets from './GoogleSheets';

const ProjectDetails = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState('');
  const [activeTab, setActiveTab] = useState('manual');
  const [error, setError] = useState(null);
  const [isServerBusy, setIsServerBusy] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Состояния для Manual Links
  const [links, setLinks] = useState([]);
  const [urlList, setUrlList] = useState('');
  const [targetDomain, setTargetDomain] = useState('');
  const [loading, setLoading] = useState(false);

  // Состояния для Google Sheets
  const [spreadsheets, setSpreadsheets] = useState([]);
  const [runningIds, setRunningIds] = useState([]);

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  useEffect(() => {
    const token = localStorage.getItem('token');
    const fetchProject = async () => {
      try {
        const response = await axios.get(`${apiBaseUrl}/projects`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const project = response.data.find((proj) => proj._id === projectId);
        if (project) {
          setProjectName(project.name);
          setIsAnalyzing(project.isAnalyzing);
        } else {
          setError('Project not found');
          navigate('/app/projects');
        }
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to fetch project');
      }
    };

    fetchProject();
  }, [projectId, navigate]);

  const handleAddLinks = async (e, projectId) => {
    e.preventDefault();
    if (!urlList || !targetDomain) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const urls = urlList.split('\n').map(url => url.trim()).filter(url => url);
      const linksData = { urls, targetDomains: [targetDomain] }; // Обновляем формат данных
      const response = await axios.post(`${apiBaseUrl}/${projectId}/links`, linksData, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLinks([...links, ...response.data]);
      setUrlList('');
      setTargetDomain('');
      setError(null);
      setIsServerBusy(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add links');
      if (err.response?.status === 429 || err.message.includes('Network Error')) {
        setIsServerBusy(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCheckLinks = async (projectId) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${apiBaseUrl}/${projectId}/links/check`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setError(null);
      setIsServerBusy(false);
      setIsAnalyzing(true); // Устанавливаем isAnalyzing в true во время анализа
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to check links');
      if (err.response?.status === 429 || err.response?.status === 409 || err.message.includes('Network Error')) {
        setIsServerBusy(true);
        setIsAnalyzing(true);
      }
    }
  };

  const handleDeleteLink = async (id, projectId) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${apiBaseUrl}/${projectId}/links/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLinks(links.filter(link => link._id !== id));
      setError(null);
      setIsServerBusy(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete link');
      if (err.response?.status === 429 || err.message.includes('Network Error')) {
        setIsServerBusy(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAllLinks = async (projectId) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${apiBaseUrl}/${projectId}/links`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLinks([]);
      setError(null);
      setIsServerBusy(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete all links');
      if (err.response?.status === 429 || err.message.includes('Network Error')) {
        setIsServerBusy(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  return (
    <motion.div
      className="max-w-full mx-auto p-4 sm:p-6 bg-white rounded-lg shadow-md overflow-hidden"
      initial="hidden"
      animate="visible"
      variants={fadeInUp}
    >
      <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-6">
        Project: {projectName || 'Loading...'}
      </h2>
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
      {isServerBusy && (
        <div className="mb-4 p-3 bg-yellow-100 text-yellow-700 rounded-lg">
          Server is currently busy with another analysis. Please try again in a few minutes.
          <button
            onClick={() => setIsServerBusy(false)}
            className="ml-2 text-yellow-900 underline"
          >
            Close
          </button>
        </div>
      )}
      <div className="border-b border-gray-200 mb-8">
        <nav className="flex space-x-4">
          <button
            onClick={() => setActiveTab('manual')}
            className={`py-2 px-4 text-sm font-medium rounded-t-lg transition-colors duration-200 ${
              activeTab === 'manual'
                ? 'bg-green-500 text-white border-b-2 border-green-500'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            Manual Links
          </button>
          <button
            onClick={() => setActiveTab('sheets')}
            className={`py-2 px-4 text-sm font-medium rounded-t-lg transition-colors duration-200 ${
              activeTab === 'sheets'
                ? 'bg-green-500 text-white border-b-2 border-green-500'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            Google Sheets
          </button>
        </nav>
      </div>

      {activeTab === 'manual' && (
        <ManualLinks
          projectId={projectId}
          links={links}
          setLinks={setLinks}
          urlList={urlList}
          setUrlList={setUrlList}
          targetDomain={targetDomain}
          setTargetDomain={setTargetDomain}
          loading={loading}
          setLoading={setLoading}
          error={error}
          setError={setError}
          handleAddLinks={handleAddLinks}
          handleCheckLinks={handleCheckLinks}
          handleDeleteLink={handleDeleteLink}
          handleDeleteAllLinks={handleDeleteAllLinks}
        />
      )}

      {activeTab === 'sheets' && (
        <GoogleSheets
          projectId={projectId}
          spreadsheets={spreadsheets}
          setSpreadsheets={setSpreadsheets}
          runningIds={runningIds}
          setRunningIds={setRunningIds}
          setLoading={setLoading}
          setError={setError}
          isAnalyzing={isAnalyzing}
        />
      )}
    </motion.div>
  );
};

export default ProjectDetails;
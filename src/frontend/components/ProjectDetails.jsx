import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import ManualLinks from './ManualLinks';
import GoogleSheets from './GoogleSheets';
import { Bar, Pie } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

const ProjectDetails = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState('');
  const [activeTab, setActiveTab] = useState('manual');
  const [error, setError] = useState(null);
  const [isServerBusy, setIsServerBusy] = useState(false);
  const [isAnalyzingManual, setIsAnalyzingManual] = useState(false);
  const [isAnalyzingSpreadsheet, setIsAnalyzingSpreadsheet] = useState(false);
  const [manualStats, setManualStats] = useState(null);
  const [spreadsheetStats, setSpreadsheetStats] = useState(null);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [isAddLinksModalOpen, setIsAddLinksModalOpen] = useState(false);
  const [isStatsExpanded, setIsStatsExpanded] = useState(true);

  const [links, setLinks] = useState([]);
  const [urlList, setUrlList] = useState('');
  const [targetDomain, setTargetDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [spreadsheets, setSpreadsheets] = useState([]);
  const [runningIds, setRunningIds] = useState([]);
  const [domainSummary, setDomainSummary] = useState({ uniqueDomains: 0, totalLinks: 0 });

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  useEffect(() => {
    const token = localStorage.getItem('token');
    const fetchProject = async () => {
      if (!token) {
        setError('Authentication token missing. Please log in again.');
        navigate('/login');
        return;
      }
      try {
        const response = await axios.get(`${apiBaseUrl}/projects`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const project = response.data.find((proj) => proj._id === projectId);
        if (project) {
          setProjectName(project.name);
          setIsAnalyzingManual(project.isAnalyzingManual);
          setIsAnalyzingSpreadsheet(project.isAnalyzingSpreadsheet);
        } else {
          setError('Project not found');
          navigate('/app/projects');
        }
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to fetch project');
      }
    };

    const fetchAnalysisStatus = async () => {
      if (!token) return;
      try {
        const response = await axios.get(`${apiBaseUrl}/${projectId}/analysis-status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setIsAnalyzingManual(response.data.isAnalyzingManual);
        setIsAnalyzingSpreadsheet(response.data.isAnalyzingSpreadsheet);
      } catch (err) {
        console.error('Error fetching analysis status:', err);
      }
    };

    const fetchStats = async (source, setStatsFunc) => {
      if (!token) {
        setError('Authentication token missing. Please log in again.');
        navigate('/login');
        return;
      }
      try {
        console.log(`Fetching ${source} stats for project:`, projectId, 'with token:', token);
        const response = await axios.get(`${apiBaseUrl}/projects/${projectId}/stats`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { source },
        });
        console.log(`${source} Stats response:`, response.data);
        setStatsFunc(response.data);
      } catch (err) {
        console.error(`Error fetching ${source} project stats:`, err);
        if (err.response?.status === 401) {
          setError('Session expired. Please log in again.');
          navigate('/login');
        } else {
          setError(err.response?.data?.error || `Failed to fetch ${source} project stats`);
        }
      }
    };

    const fetchDomainSummary = async () => {
      try {
        const response = await axios.get(`${apiBaseUrl}/${projectId}/links`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        const linksData = Array.isArray(response.data) ? response.data : [];

        // Извлекаем домен из link.url
        const domains = new Set(linksData.map(link => {
          try {
            const url = new URL(link.url);
            return url.hostname; // Извлекаем домен (например, site1.com)
          } catch (error) {
            console.error(`Invalid URL for link ${link.url}:`, error);
            return 'N/A'; // Если URL некорректный, используем заглушку
          }
        }).filter(domain => domain !== 'N/A')); // Исключаем некорректные домены

        setDomainSummary({
          uniqueDomains: domains.size,
          totalLinks: linksData.length,
        });
      } catch (err) {
        console.error('Error fetching domain summary:', err);
      }
    };

    fetchProject();
    fetchAnalysisStatus();
    fetchStats('manual', setManualStats);
    fetchStats('google_sheets', setSpreadsheetStats); // Убедимся, что используем правильный source
    fetchDomainSummary();
    const interval = setInterval(fetchAnalysisStatus, 10000);
    return () => clearInterval(interval);
  }, [projectId, navigate]);

  useEffect(() => {
    if (isStatsModalOpen || isAddLinksModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [isStatsModalOpen, isAddLinksModalOpen]);

  const handleAddLinks = async (e) => {
    e.preventDefault();
    if (!urlList || !targetDomain) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const urls = urlList.split('\n').map(url => url.trim()).filter(url => url);
      const linksData = urls.map(url => ({
        url,
        targetDomain,
      }));
      const response = await axios.post(`${apiBaseUrl}/${projectId}/links`, linksData, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLinks([...links, ...response.data]);
      setUrlList('');
      setTargetDomain('');
      setError(null);
      setIsServerBusy(false);
      setIsAddLinksModalOpen(false);
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
      const response = await axios.post(`${apiBaseUrl}/${projectId}/links/check`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setError(null);
      setIsServerBusy(false);
      setIsAnalyzingManual(true);
      return response;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to check links');
      if (err.response?.status === 429 || err.response?.status === 409 || err.message.includes('Network Error')) {
        setIsServerBusy(true);
        setIsAnalyzingManual(true);
      }
      throw err;
    } finally {
      setLoading(false);
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

  const chartDataLinkTypes = (stats) => stats ? {
    labels: ['Dofollow', 'Nofollow'],
    datasets: [{
      label: 'Link Types',
      data: [stats.linkTypes.dofollow, stats.linkTypes.nofollow],
      backgroundColor: ['#10B981', '#F59E0B'],
    }],
  } : null;

  const chartDataStatuses = (stats) => stats ? {
    labels: Object.keys(stats.statuses).filter(key => key !== 'total').map(key => key.charAt(0).toUpperCase() + key.slice(1)),
    datasets: [{
      label: 'Statuses',
      data: Object.keys(stats.statuses).filter(key => key !== 'total').map(key => stats.statuses[key]),
      backgroundColor: ['#10B981', '#EF4444', '#F59E0B', '#3B82F6', '#6B7280', '#2563EB'],
    }],
  } : null;

  const chartDataResponseCodes = (stats) => stats ? {
    labels: Object.keys(stats.responseCodes),
    datasets: [{
      label: 'Response Codes',
      data: Object.values(stats.responseCodes),
      backgroundColor: Object.keys(stats.responseCodes).map(code => code === '200' ? '#10B981' : '#EF4444'),
    }],
  } : null;

  const chartDataIndexability = (stats) => stats ? {
    labels: ['Indexable', 'Non-Indexable'],
    datasets: [{
      label: 'Indexability',
      data: [stats.indexability.indexable, stats.indexability.nonIndexable],
      backgroundColor: ['#10B981', '#EF4444'],
    }],
  } : null;

  const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  const modalVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: 'easeOut' } },
    exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2, ease: 'easeIn' } },
  };

  const accordionVariants = {
    open: { height: 'auto', opacity: 1, transition: { duration: 0.3, ease: 'easeOut' } },
    closed: { height: 0, opacity: 0, transition: { duration: 0.3, ease: 'easeIn' } },
  };

  const renderStatsContent = (stats, isMobile = false) => {
    if (!stats) {
      return <p className="text-gray-600 text-xs">Loading analytics...</p>;
    }
    if (stats.statuses.total === 0) {
      return <p className="text-gray-600 text-xs">No links added yet. Add links to see analytics.</p>;
    }

    const content = (
      <>
        {activeTab === 'manual' && isMobile && (
          <div className="flex mb-4 justify-between">
            <div className="min-w-[33%] p-2">
              <h3 className="text-[10px] font-semibold text-gray-600">Unique Domains</h3>
              <p className="text-sm font-bold text-gray-800">{domainSummary.uniqueDomains}</p>
            </div>
            <div className="min-w-[33%] p-2">
              <h3 className="text-[10px] font-semibold text-gray-600">Total Links</h3>
              <p className="text-sm font-bold text-gray-800">{domainSummary.totalLinks}</p>
            </div>
            <div className="min-w-[33%] p-2">
              <h3 className="text-[10px] font-semibold text-gray-600">Avg Load Time</h3>
              <p className="text-sm font-bold text-gray-800">{manualStats?.averageLoadTime || 0} s</p>
            </div>
          </div>
        )}
        <div className="min-w-[250px] max-h-[200px] bg-gray-50 p-3 rounded-lg shadow-sm">
          <h4 className="text-xs font-semibold text-gray-600">Link Types</h4>
          <Bar data={chartDataLinkTypes(stats)} options={{ responsive: true, plugins: { legend: { position: 'top', labels: { font: { size: 10 } } } }, maintainAspectRatio: false }} height={60} />
        </div>
        <div className="min-w-[250px] max-h-[200px] bg-gray-50 p-3 rounded-lg shadow-sm">
          <h4 className="text-xs font-semibold text-gray-600">Statuses</h4>
          <Pie data={chartDataStatuses(stats)} options={{ responsive: true, plugins: { legend: { position: 'top', labels: { font: { size: 10 } } } }, maintainAspectRatio: false }} height={60} />
        </div>
        <div className="min-w-[250px] max-h-[200px] bg-gray-50 p-3 rounded-lg shadow-sm">
          <h4 className="text-xs font-semibold text-gray-600">Response Codes</h4>
          <Bar data={chartDataResponseCodes(stats)} options={{ responsive: true, plugins: { legend: { position: 'top', labels: { font: { size: 10 } } } }, maintainAspectRatio: false }} height={60} />
        </div>
        <div className="min-w-[250px] max-h-[200px] bg-gray-50 p-3 rounded-lg shadow-sm">
          <h4 className="text-xs font-semibold text-gray-600">Indexability</h4>
          <Pie data={chartDataIndexability(stats)} options={{ responsive: true, plugins: { legend: { position: 'top', labels: { font: { size: 10 } } } }, maintainAspectRatio: false }} height={60} />
        </div>
      </>
    );

    return (
      <div className={isMobile ? "flex flex-col gap-4" : "flex overflow-x-auto overflow-y-hidden justify-between gap-4"}>
        {content}
      </div>
    );
  };

  return (
    <motion.div
      className="max-w-full mx-auto p-4 sm:p-6 bg-white rounded-lg shadow-md overflow-hidden"
      initial="hidden"
      animate="visible"
      variants={fadeInUp}
    >
      {/* Header: Back arrow, Project name */}
      <div className="flex items-center gap-4 mb-6 border-b border-gray-200 pb-4">
        <button
          onClick={() => navigate('/app/projects')}
          className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">
          {projectName || 'Loading...'}
        </h2>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
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

      {/* Error and Server Busy Alerts */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg border-b border-gray-200">
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
        <div className="mb-4 p-3 bg-yellow-100 text-yellow-700 rounded-lg border-b border-gray-200">
          Server is currently busy with another analysis. Please try again in a few minutes.
          <button
            onClick={() => setIsServerBusy(false)}
            className="ml-2 text-yellow-900 underline"
          >
            Close
          </button>
        </div>
      )}

      {/* Dashboard: Stats */}
      <div className="mb-6">
        {/* Stats on Desktop */}
        <div className="hidden sm:block border-b border-gray-200 pb-4 mb-4">
          <button
            onClick={() => setIsStatsExpanded(!isStatsExpanded)}
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 mb-2"
          >
            <h3 className="text-lg font-semibold">Analytics</h3>
            <svg
              className={`w-4 h-4 transition-transform ${isStatsExpanded ? 'rotate-180' : 'rotate-0'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <AnimatePresence>
            {isStatsExpanded && (
              <motion.div
                initial="closed"
                animate="open"
                exit="closed"
                variants={accordionVariants}
              >
                {activeTab === 'manual' ? renderStatsContent(manualStats) : renderStatsContent(spreadsheetStats)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Stats Button on Mobile */}
        <div className="sm:hidden mb-4 border-b border-gray-200 pb-4">
          <button
            onClick={() => setIsStatsModalOpen(true)}
            className="w-full bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            Show Analytics
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-full overflow-x-auto">
        {activeTab === 'manual' && (
          <ManualLinks
            projectId={projectId}
            links={links}
            setLinks={setLinks}
            loading={loading}
            setLoading={setLoading}
            error={error}
            setError={setError}
            handleCheckLinks={handleCheckLinks}
            handleDeleteLink={handleDeleteLink}
            handleDeleteAllLinks={handleDeleteAllLinks}
            isAddLinksModalOpen={isAddLinksModalOpen}
            setIsAddLinksModalOpen={setIsAddLinksModalOpen}
            urlList={urlList}
            setUrlList={setUrlList}
            targetDomain={targetDomain}
            setTargetDomain={setTargetDomain}
            handleAddLinks={handleAddLinks}
            domainSummary={domainSummary}
            avgLoadTime={manualStats?.averageLoadTime || 0}
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
            isAnalyzing={isAnalyzingSpreadsheet}
            stats={spreadsheetStats}
            renderStatsContent={renderStatsContent}
          />
        )}
      </div>

      {/* Modal for Stats (Mobile) */}
      <AnimatePresence>
        {isStatsModalOpen && (
          <motion.div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 sm:hidden"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={modalVariants}
          >
            <div className="relative bg-white rounded-lg shadow-lg max-w-[90%] h-[80%] overflow-y-auto">
              <button
                onClick={() => setIsStatsModalOpen(false)}
                className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-8 h-8 flex items-center justify-center z-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="p-4">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Analytics</h3>
                {activeTab === 'manual' ? renderStatsContent(manualStats, true) : renderStatsContent(spreadsheetStats, true)}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal for Adding Links */}
      <AnimatePresence>
        {isAddLinksModalOpen && (
          <motion.div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={modalVariants}
          >
            <div className="relative bg-white rounded-lg shadow-lg w-full max-w-md mx-4 p-6">
              <button
                onClick={() => setIsAddLinksModalOpen(false)}
                className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Add Links</h3>
              <form onSubmit={handleAddLinks} className="flex flex-col gap-4">
                <textarea
                  value={urlList}
                  onChange={(e) => setUrlList(e.target.value)}
                  placeholder="Enter URLs (one per line)"
                  className="w-full max-w-full h-28 p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 resize-none text-sm"
                  disabled={loading}
                />
                <input
                  type="text"
                  value={targetDomain}
                  onChange={(e) => setTargetDomain(e.target.value)}
                  placeholder="Target Domain (e.g., example.com)"
                  className="w-full max-w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 text-sm"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 disabled:bg-green-300 transition-colors shadow-md text-sm"
                >
                  {loading ? 'Adding...' : 'Add Links'}
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default ProjectDetails;
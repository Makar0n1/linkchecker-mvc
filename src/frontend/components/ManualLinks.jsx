import React, { useState, useEffect } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';

const ManualLinks = () => {
  const { projectId } = useParams(); // Получаем projectId из URL
  const {
    links,
    setLinks,
    urlList,
    setUrlList,
    targetDomain,
    setTargetDomain,
    loading,
    setLoading,
    error,
    setError,
    handleAddLinks,
    handleCheckLinks,
    handleDeleteLink,
    handleDeleteAllLinks,
  } = useOutletContext();

  const [projectName, setProjectName] = useState('');
  const [copiedField, setCopiedField] = useState(null);

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
        } else {
          setError('Project not found');
        }
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to fetch project');
      }
    };

    const fetchLinks = async () => {
      try {
        const response = await axios.get(`${apiBaseUrl}/${projectId}/links`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setLinks(response.data);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to fetch links');
      }
    };

    fetchProject();
    fetchLinks();
  }, [projectId, setLinks, setError]);

  const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  const getStatus = (link) => {
    const isCanonicalMatch = !link.canonicalUrl || link.url.toLowerCase().replace(/\/$/, '') === link.canonicalUrl.toLowerCase().replace(/\/$/, '');
    const isOk = link.isIndexable && link.responseCode === '200' && link.rel !== 'not found';
    return isOk ? 'OK' : 'Problem';
  };

  const copyToClipboard = (key) => {
    navigator.clipboard.writeText(key.value).then(() => {
      setCopiedField(key.id);
      setTimeout(() => setCopiedField(null), 1500);
    });
  };

  return (
    <motion.div
      className="max-w-full mx-auto p-4 sm:p-6 bg-white rounded-lg shadow-md overflow-hidden"
      initial="hidden"
      animate="visible"
      variants={fadeInUp}
    >
      <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-6">
        Manual Links - {projectName || 'Loading...'}
      </h2>
      <form onSubmit={(e) => handleAddLinks(e, projectId)} className="mb-6 flex flex-col gap-4">
        <textarea
          value={urlList}
          onChange={(e) => setUrlList(e.target.value)}
          placeholder="Enter URLs (one per line)"
          className="w-full h-28 p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 resize-none text-sm sm:text-base"
        />
        <input
          type="text"
          value={targetDomain}
          onChange={(e) => setTargetDomain(e.target.value)}
          placeholder="Target Domain (e.g., example.com)"
          className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 text-sm sm:text-base"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-green-500 text-white px-4 sm:px-6 py-2 rounded-lg hover:bg-green-600 disabled:bg-green-300 transition-colors shadow-md text-sm sm:text-base"
        >
          {loading ? 'Adding...' : 'Add Links'}
        </button>
      </form>
      <div className="mb-6 flex flex-col sm:flex-row gap-3 sm:gap-4">
        <button
          onClick={() => handleCheckLinks(projectId)}
          disabled={loading}
          className="bg-green-500 text-white px-4 sm:px-6 py-2 rounded-lg hover:bg-green-600 disabled:bg-green-300 transition-colors shadow-md text-sm sm:text-base"
        >
          {loading ? 'Checking...' : 'Check All Links'}
        </button>
        <button
          onClick={() => handleDeleteAllLinks(projectId)}
          disabled={loading || links.length === 0}
          className="bg-red-500 text-white px-4 sm:px-6 py-2 rounded-lg hover:bg-red-600 disabled:bg-red-300 transition-colors shadow-md text-sm sm:text-base"
        >
          {loading ? 'Deleting...' : 'Delete All Links'}
        </button>
      </div>
      {error && <p className="text-red-500 mb-6 text-sm">{error}</p>}
      <div className="overflow-x-auto rounded-lg shadow-sm">
        <table className="w-full bg-white border border-gray-200">
          <thead>
            <tr className="bg-green-50 text-gray-700 text-xs sm:text-sm">
              <th className="p-2 sm:p-3 text-left w-10">#</th>
              <th className="p-2 sm:p-3 text-left">URL</th>
              <th className="p-2 sm:p-3 text-left">Target Domain</th>
              <th className="p-2 sm:p-3 text-left">Status</th>
              <th className="p-2 sm:p-3 text-left">Response Code</th>
              <th className="p-2 sm:p-3 text-left">Indexable</th>
              <th className="p-2 sm:p-3 text-left">Rel</th>
              <th className="p-2 sm:p-3 text-left w-24 sm:w-32">Link Type</th>
              <th className="p-2 sm:p-3 text-left">Canonical URL</th>
              <th className="p-2 sm:p-3 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {links.length === 0 ? (
              <tr>
                <td colSpan="10" className="p-2 sm:p-3 text-center text-gray-500 text-sm sm:text-base">No links added yet</td>
              </tr>
            ) : (
              links.map((link, index) => {
                const isCanonicalMismatch = link.canonicalUrl && link.url.toLowerCase().replace(/\/$/, '') !== link.canonicalUrl.toLowerCase().replace(/\/$/, '');
                const status = getStatus(link);
                return (
                  <tr key={link._id} className="border-t border-gray-200 hover:bg-gray-50 transition-colors">
                    <td className="p-2 sm:p-3 text-gray-700 text-center text-sm sm:text-base whitespace-nowrap">{index + 1}</td>
                    <td className="p-2 sm:p-3 text-gray-700 min-w-[150px] truncate text-sm sm:text-base">
                      <div>{link.url}</div>
                      <button
                        onClick={() => copyToClipboard({ id: `url-${link._id}`, value: link.url })}
                        className="mt-1 text-xs sm:text-sm text-black hover:text-green-600 transition-colors"
                      >
                        {copiedField === `url-${link._id}` ? 'Copied!' : 'Copy'}
                      </button>
                    </td>
                    <td className="p-2 sm:p-3 text-gray-700 min-w-[150px] truncate text-sm sm:text-base">
                      {link.targetDomain}
                    </td>
                    <td className="p-2 sm:p-3 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        status === 'OK' ? (isCanonicalMismatch ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800') : 'bg-red-100 text-red-800'
                      }`}>
                        {status}
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 text-gray-700 text-sm sm:text-base whitespace-nowrap">{link.responseCode || 'N/A'}</td>
                    <td className="p-2 sm:p-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          link.isIndexable === null ? 'bg-gray-100 text-gray-800' :
                          link.isIndexable ? (isCanonicalMismatch ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800') :
                          'bg-red-100 text-red-800'
                        }`}
                      >
                        {link.isIndexable === null ? 'Unknown' : link.isIndexable ? 'Yes' : 'No'}
                        {isCanonicalMismatch && (
                          <span className="relative group ml-1">
                            <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
                            </svg>
                            <span className="absolute hidden group-hover:block bg-gray-800 text-white text-xs rounded p-2 -mt-10 -ml-20 w-48 z-10">
                              Canonical URL differs from page URL. Search bots may prioritize the canonical URL for indexing.
                            </span>
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 text-gray-700 whitespace-nowrap text-sm sm:text-base">{link.rel || 'none'}</td>
                    <td className="p-2 sm:p-3 text-center w-24 sm:w-32 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        link.rel === 'not found' ? 'bg-red-100 text-red-800' :
                        link.linkType === 'dofollow' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
                      }`}>
                        {link.rel === 'not found' ? 'not found' : link.linkType || 'not found'}
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 text-gray-700 min-w-[150px] truncate text-sm sm:text-base">
                      <div>{link.canonicalUrl || 'None'}</div>
                      {link.canonicalUrl && (
                        <button
                          onClick={() => copyToClipboard({ id: `canonical-${link._id}`, value: link.canonicalUrl })}
                          className="mt-1 text-xs sm:text-sm text-black hover:text-green-600 transition-colors"
                        >
                          {copiedField === `canonical-${link._id}` ? 'Copied!' : 'Copy'}
                        </button>
                      )}
                    </td>
                    <td className="p-2 sm:p-3 whitespace-nowrap">
                      <button
                        onClick={() => handleDeleteLink(link._id, projectId)}
                        disabled={loading}
                        className="bg-red-500 text-white px-2 sm:px-3 py-1 rounded-lg hover:bg-red-600 disabled:bg-red-300 transition-colors text-sm sm:text-base"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
};

export default ManualLinks;
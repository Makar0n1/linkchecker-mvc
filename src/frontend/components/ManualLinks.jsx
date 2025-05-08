import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { saveAs } from 'file-saver';

const ManualLinks = ({
  projectId,
  links,
  setLinks,
  loading,
  setLoading,
  error,
  setError,
  handleCheckLinks,
  handleDeleteLink,
  handleDeleteAllLinks,
  isAddLinksModalOpen,
  setIsAddLinksModalOpen,
  urlList,
  setUrlList,
  targetDomain,
  setTargetDomain,
  handleAddLinks,
  domainSummary,
  avgLoadTime,
}) => {
  const [copiedField, setCopiedField] = useState(null);
  const [checkingLinks, setCheckingLinks] = useState(new Set());
  const [hoveredLinkId, setHoveredLinkId] = useState(null);
  const [hoveredCanonicalId, setHoveredCanonicalId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isCollapsing, setIsCollapsing] = useState(false);
  const tableRef = React.useRef(null);
  const buttonsRef = React.useRef(null);
  const linksPerPage = 10;

  const indexOfLastLink = currentPage * linksPerPage;
  const displayedLinks = links.slice(0, Math.min(indexOfLastLink, links.length));

  const hasMoreLinks = indexOfLastLink < links.length;

  const handleLoadMore = () => {
    setCurrentPage((prevPage) => prevPage + 1);
  };

  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const smoothScrollTo = (target, duration = 1500) => {
    let start = window.scrollY;
    let end;
    let elementTop;

    if (typeof target === 'number') {
      end = target;
    } else if (target instanceof HTMLElement) {
      elementTop = target.getBoundingClientRect().top + window.scrollY;
      end = elementTop;
    } else {
      return;
    }

    const startTime = performance.now();

    const animateScroll = (currentTime) => {
      const elapsedTime = currentTime - startTime;
      const progress = Math.min(elapsedTime / duration, 1);
      const easedProgress = easeInOutCubic(progress);

      window.scrollTo(0, start + (end - start) * easedProgress);

      if (progress < 1) {
        requestAnimationFrame(animateScroll);
      }
    };

    requestAnimationFrame(animateScroll);
  };

  const handleCollapse = () => {
    setIsCollapsing(true);
    setTimeout(() => {
      setCurrentPage(1);
      setIsCollapsing(false);
      setTimeout(() => {
        if (buttonsRef.current) {
          const elementTop = buttonsRef.current.getBoundingClientRect().top + window.scrollY;
          smoothScrollTo(elementTop, 1500);
        }
      }, 100);
    }, 500);
  };

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  const wsBaseUrl = import.meta.env.MODE === 'production'
    ? `wss://api.link-check-pro.top`
    : `ws://localhost:${import.meta.env.VITE_BACKEND_PORT}`;

  const fetchLinks = async () => {
    const token = localStorage.getItem('token');
    try {
      const response = await axios.get(`${apiBaseUrl}/${projectId}/links`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLinks(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch links');
      setLinks([]);
    }
  };

  const connectWebSocket = () => {
    const ws = new WebSocket(wsBaseUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', projectId }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'analysisComplete' && data.projectId === projectId) {
        fetchLinks();
        setLoading(false);
        setCheckingLinks(new Set());
      }
    };

    ws.onclose = () => {
      setTimeout(connectWebSocket, 5000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      ws.close();
    };

    return ws;
  };

  useEffect(() => {
    fetchLinks();

    const ws = connectWebSocket();

    return () => {
      ws.close();
    };
  }, [projectId]);

  const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  const getStatus = (link) => {
    if (checkingLinks.has(link._id)) return 'Checking';
    if (!link.status || link.status === 'pending') return 'Not checked yet...';
    if (link.status === 'checking') return 'Checking';

    const isOk =
      link.responseCode === '200' &&
      link.isIndexable === true &&
      link.rel !== 'not found' &&
      (link.linkType === 'dofollow' || link.linkType === 'nofollow');

    return isOk ? 'OK' : 'Problem';
  };

  const copyToClipboard = (key) => {
    navigator.clipboard.writeText(key.value).then(() => {
      setCopiedField(key.id);
      setTimeout(() => setCopiedField(null), 1500);
    });
  };

  const truncateUrl = (url, maxLength = 50) => {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + '...';
  };

  const wrappedHandleCheckLinks = async (projectId) => {
    const linkIds = links.map(link => link._id);
    setCheckingLinks(new Set(linkIds));
    setLoading(true);
    try {
      await handleCheckLinks(projectId);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to check links');
      setLoading(false);
      setCheckingLinks(new Set());
    }
  };

  const handleExportToCSV = () => {
    if (!links || links.length === 0) return;

    const csvRows = [];
    const headers = [
      '#,URL,Target Domain,Status,Response Code,Indexable,Rel,Link Type,Canonical URL',
    ];
    csvRows.push(headers.join(','));

    links.forEach((link, index) => {
      const status = getStatus(link);
      const row = [
        index + 1,
        `"${link.url}"`,
        link.targetDomains && link.targetDomains.length > 0 ? `"${link.targetDomains.join(', ')}"` : 'N/A',
        status,
        status === 'Not checked yet...' || status === 'Checking' ? 'N/A' : link.responseCode || 'N/A',
        status === 'Not checked yet...' || status === 'Checking' ? 'N/A' :
          link.isIndexable === null ? 'Unknown' : link.isIndexable ? 'Yes' : 'No',
        status === 'Not checked yet...' || status === 'Checking' ? 'N/A' : link.rel || 'none',
        status === 'Not checked yet...' || status === 'Checking' ? 'N/A' : link.rel === 'not found' ? 'not found' : link.linkType || 'not found',
        link.canonicalUrl ? `"${link.canonicalUrl}"` : 'None',
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `links_analysis_${projectId}.csv`);
  };

  const handleMouseEnterLink = (linkId) => {
    setHoveredLinkId(linkId);
  };

  const handleMouseLeaveLink = () => {
    setHoveredLinkId(null);
  };

  const handleMouseEnterCanonical = (canonicalId) => {
    setHoveredCanonicalId(canonicalId);
  };

  const handleMouseLeaveCanonical = () => {
    setHoveredCanonicalId(null);
  };

  return (
    <motion.div
      className="max-w-full mx-auto h-auto"
      initial="hidden"
      animate="visible"
      variants={fadeInUp}
    >
      <div ref={buttonsRef} className="mb-6 flex items-center gap-3 sm:gap-4 border-b border-gray-200 pb-4">
  {/* Mobile Buttons (in a row) */}
  <div className="sm:hidden flex overflow-x-auto gap-3">
    <button
      onClick={() => wrappedHandleCheckLinks(projectId)}
      disabled={loading}
      className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 disabled:bg-green-300 transition-colors shadow-md text-sm whitespace-nowrap"
    >
      {loading ? 'Checking...' : 'Check All'}
    </button>
    <button
      onClick={() => handleDeleteAllLinks(projectId)}
      disabled={loading || links.length === 0}
      className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 disabled:bg-red-300 transition-colors shadow-md text-sm whitespace-nowrap"
    >
      {loading ? 'Deleting...' : 'Delete All'}
    </button>
    <button
      onClick={() => setIsAddLinksModalOpen(true)}
      className="bg-green-500 text-white p-2 rounded-full hover:bg-green-600 transition-colors shadow-md"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
      </svg>
    </button>
  </div>

  {/* Desktop Buttons (in a row with + justified to the right) */}
  <div className="hidden sm:flex items-center justify-between gap-4 w-full">
    <div className="flex gap-4">
      <button
        onClick={() => wrappedHandleCheckLinks(projectId)}
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
      
      <div className="min-w-[100px] p-2">
          <h3 className="text-[10px] font-semibold text-gray-600">Unique Domains</h3>
          <p className="text-sm font-bold text-gray-800">{domainSummary.uniqueDomains}</p>
        </div>
        <div className="min-w-[100px] p-2">
          <h3 className="text-[10px] font-semibold text-gray-600">Total Links</h3>
          <p className="text-sm font-bold text-gray-800">{domainSummary.totalLinks}</p>
        </div>
        <div className="min-w-[100px] p-2">
          <h3 className="text-[10px] font-semibold text-gray-600">Avg Load Time</h3>
          <p className="text-sm font-bold text-gray-800">{avgLoadTime} s</p>
        </div>
    </div>
    <div className="flex items-center gap-4">
      
      <div className="flex overflow-x-auto gap-3 my-2">
        <button
        onClick={() => setIsAddLinksModalOpen(true)}
        className="bg-green-500 text-white p-2 rounded-full hover:bg-green-600 transition-colors shadow-md"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
        </svg>
      </button>
      </div>
    </div>
  </div>
</div>
      {error && <p className="text-red-500 mb-6 text-sm">{error}</p>}
      <div className="rounded-lg shadow-sm overflow-x-auto">
        <table ref={tableRef} className="w-full max-w-full bg-white border border-gray-200 table-auto min-w-full">
          <thead>
            <tr className="bg-green-50 text-gray-700 text-xs sm:text-sm">
              <th className="p-2 sm:p-3 text-left min-w-[40px]">#</th>
              <th className="p-2 sm:p-3 text-left min-w-[200px]">URL</th>
              <th className="p-2 sm:p-3 text-left min-w-[150px]">Target Domain</th>
              <th className="p-2 sm:p-3 text-left min-w-[100px]">Status</th>
              <th className="p-2 sm:p-3 text-left min-w-[120px]">Response Code</th>
              <th className="p-2 sm:p-3 text-left min-w-[100px]">Indexable</th>
              <th className="p-2 sm:p-3 text-left min-w-[80px]">Rel</th>
              <th className="p-2 sm:p-3 text-left min-w-[100px]">Link Type</th>
              <th className="p-2 sm:p-3 text-left min-w-[200px]">Canonical URL</th>
              <th className="p-2 sm:p-3 text-left min-w-[100px]">Action</th>
            </tr>
          </thead>
          <tbody>
            {!Array.isArray(links) || links.length === 0 ? (
              <tr>
                <td colSpan="10" className="p-2 sm:p-3 text-center text-gray-500 text-xs sm:text-sm">No links added yet</td>
              </tr>
            ) : (
              displayedLinks.map((link, index) => {
                const isCanonicalMismatch = link.canonicalUrl && link.url.toLowerCase().replace(/\/$/, '') !== link.canonicalUrl.toLowerCase().replace(/\/$/, '');
                const status = getStatus(link);
                const truncatedUrl = truncateUrl(link.url);
                const truncatedCanonicalUrl = truncateUrl(link.canonicalUrl || 'None');
                const isUrlTruncated = link.url !== truncatedUrl;
                const isCanonicalTruncated = link.canonicalUrl && link.canonicalUrl !== truncatedCanonicalUrl;

                return (
                  <motion.tr
                    key={link._id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: isCollapsing ? 0 : 1, y: isCollapsing ? 20 : 0 }}
                    transition={{ duration: 0.5 }}
                    className="border-t border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    <td className="p-2 sm:p-3 text-gray-700 text-center text-xs sm:text-sm whitespace-nowrap">{index + 1}</td>
                    <td className="p-2 sm:p-3 text-gray-700 text-xs sm:text-sm truncate relative">
                      <span
                        className="truncate block"
                        onMouseEnter={() => {
                          if (isUrlTruncated) {
                            setTimeout(() => {
                              handleMouseEnterLink(link._id);
                            }, 500);
                          }
                        }}
                        onMouseLeave={handleMouseLeaveLink}
                      >
                        {truncatedUrl}
                      </span>
                      {isUrlTruncated && hoveredLinkId === link._id && (
                        <span className="absolute bg-gray-800 text-white text-xs rounded p-2 z-[9999] whitespace-nowrap max-w-none -top-8 left-0">
                          {link.url}
                        </span>
                      )}
                      <button
                        onClick={() => copyToClipboard({ id: `url-${link._id}`, value: link.url })}
                        className="mt-1 text-xs sm:text-sm text-black hover:text-green-600 transition-colors"
                      >
                        {copiedField === `url-${link._id}` ? 'Copied!' : 'Copy'}
                      </button>
                    </td>
                    <td className="p-2 sm:p-3 text-gray-700 text-xs sm:text-sm truncate">
                      {link.targetDomains && link.targetDomains.length > 0 ? link.targetDomains.join(', ') : 'N/A'}
                    </td>
                    <td className="p-2 sm:p-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          status === 'Not checked yet...' ? 'bg-gray-100 text-gray-800' :
                          status === 'Checking' ? 'bg-blue-100 text-blue-800' :
                          status === 'OK' ? (isCanonicalMismatch ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800') :
                          'bg-red-100 text-red-800'
                        }`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 text-gray-700 text-xs sm:text-sm whitespace-nowrap">
                      {status === 'Not checked yet...' || status === 'Checking' ? 'N/A' : link.responseCode || 'N/A'}
                    </td>
                    <td className="p-2 sm:p-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          status === 'Not checked yet...' || status === 'Checking' ? 'bg-gray-100 text-gray-800' :
                          link.isIndexable === null ? 'bg-gray-100 text-gray-800' :
                          link.isIndexable ? (isCanonicalMismatch ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800') :
                          'bg-red-100 text-red-800'
                        }`}
                      >
                        {status === 'Not checked yet...' || status === 'Checking' ? 'N/A' :
                          link.isIndexable === null ? 'Unknown' : link.isIndexable ? 'Yes' : 'No'}
                        {isCanonicalMismatch && status !== 'Not checked yet...' && status !== 'Checking' && (
                          <span className="relative group ml-1">
                            <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
                            </svg>
                            <span className="absolute hidden group-hover:block bg-gray-800 text-white text-xs rounded p-2 z-[9999] top-100 bottom-3 left-3 min-w-[200px] max-w-[200px] whitespace-normal break-words opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-in-out">
                              Canonical URL differs from page URL. Search bots may prioritize the canonical URL for indexing.
                            </span>
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 text-gray-700 whitespace-wrap text-xs sm:text-sm">
                      {status === 'Not checked yet...' || status === 'Checking' ? 'N/A' : link.rel || 'none'}
                    </td>
                    <td className="p-2 sm:p-3 text-center whitespace-wrap">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          status === 'Not checked yet...' || status === 'Checking' ? 'bg-gray-100 text-gray-800' :
                          link.rel === 'not found' ? 'bg-red-100 text-red-800' :
                          link.linkType === 'dofollow' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
                        }`}
                      >
                        {status === 'Not checked yet...' || status === 'Checking' ? 'N/A' : link.rel === 'not found' ? 'not found' : link.linkType || 'not found'}
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 text-gray-700 text-xs sm:text-sm truncate relative">
                      <span
                        className="truncate block"
                        onMouseEnter={() => {
                          if (isCanonicalTruncated) {
                            setTimeout(() => {
                              handleMouseEnterCanonical(`canonical-${link._id}`);
                            }, 500);
                          }
                        }}
                        onMouseLeave={handleMouseLeaveCanonical}
                      >
                        {truncatedCanonicalUrl}
                      </span>
                      {link.canonicalUrl && isCanonicalTruncated && hoveredCanonicalId === `canonical-${link._id}` && (
                        <span className="absolute bg-gray-800 text-white text-xs rounded p-2 z-[9999] whitespace-nowrap max-w-none -top-8 left-0">
                          {link.canonicalUrl}
                        </span>
                      )}
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
                        className="bg-red-500 text-white px-2 sm:px-3 py-1 rounded-lg hover:bg-red-600 disabled:bg-red-300 transition-colors text-xs sm:text-sm"
                      >
                        Delete
                      </button>
                    </td>
                  </motion.tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-6 flex justify-center gap-3">
        {hasMoreLinks && (
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="bg-green-500 text-white px-4 sm:px-6 py-2 rounded-lg hover:bg-green-600 disabled:bg-green-300 transition-colors shadow-md text-sm sm:text-base"
          >
            Load More
          </button>
        )}
        {currentPage > 1 && (
          <button
            onClick={handleCollapse}
            disabled={loading}
            className="bg-gray-500 text-white px-4 sm:px-6 py-2 rounded-lg hover:bg-gray-600 disabled:bg-gray-300 transition-colors shadow-md text-sm sm:text-base"
          >
            Collapse
          </button>
        )}
      </div>
    </motion.div>
  );
};

export default ManualLinks;
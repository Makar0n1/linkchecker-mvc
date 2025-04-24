import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';

const Projects = () => {
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const apiBaseUrl = import.meta.env.MODE === 'production'
    ? `${import.meta.env.VITE_BACKEND_DOMAIN}/api/links`
    : `${import.meta.env.VITE_BACKEND_DOMAIN}:${import.meta.env.VITE_BACKEND_PORT}/api/links`;

  useEffect(() => {
    const token = localStorage.getItem('token');
    const fetchProjects = async () => {
      try {
        const response = await axios.get(`${apiBaseUrl}/projects`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setProjects(response.data);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to fetch projects');
      }
    };

    fetchProjects();
  }, []);

  const handleAddProject = async (e) => {
    e.preventDefault();
    if (!newProjectName.trim()) return setError('Project name is required');

    const token = localStorage.getItem('token');
    try {
      const response = await axios.post(
        `${apiBaseUrl}/projects`,
        { name: newProjectName },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setProjects([...projects, response.data]);
      setNewProjectName('');
      setIsAdding(false);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add project');
    }
  };

  const handleDeleteProject = async (projectId) => {
    const token = localStorage.getItem('token');
    try {
      await axios.delete(`${apiBaseUrl}/projects/${projectId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProjects(projects.filter((project) => project._id !== projectId));
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete project');
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
      <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-6">Your Projects</h2>
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
      <div className="mb-6">
        <button
          onClick={() => setIsAdding(true)}
          className="bg-green-500 text-white px-4 sm:px-6 py-2 rounded-lg hover:bg-green-600 transition-colors shadow-md text-sm sm:text-base"
        >
          + New Project
        </button>
      </div>
      {isAdding && (
        <form onSubmit={handleAddProject} className="mb-6 flex flex-col gap-4">
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="Project Name"
            className="w-full p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300 shadow-sm bg-gray-50 text-sm sm:text-base"
          />
          <div className="flex gap-3">
            <button
              type="submit"
              className="bg-green-500 text-white px-4 sm:px-6 py-2 rounded-lg hover:bg-green-600 transition-colors shadow-md text-sm sm:text-base"
            >
              Create Project
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="bg-gray-300 text-gray-700 px-4 sm:px-6 py-2 rounded-lg hover:bg-gray-400 transition-colors shadow-md text-sm sm:text-base"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {projects.length === 0 ? (
        <p className="text-gray-500 text-sm sm:text-base">No projects yet. Create one to start analyzing links!</p>
      ) : (
        <ul>
          {projects.map((project) => (
            <motion.li
              key={project._id}
              className="mb-4 flex items-center justify-between p-3 bg-gray-50 rounded-lg shadow-sm hover:bg-gray-100 transition-colors"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <div
                onClick={() => navigate(`/app/manual/${project._id}`)}
                className="cursor-pointer flex items-center gap-2"
              >
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7h18M3 12h18m-7 5h7" />
                </svg>
                <span className="text-gray-700">{project.name}</span>
              </div>
              <button
                onClick={() => handleDeleteProject(project._id)}
                className="bg-red-500 text-white px-4 py-1 rounded-lg hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </motion.li>
          ))}
        </ul>
      )}
    </motion.div>
  );
};

export default Projects;
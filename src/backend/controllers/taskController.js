const AnalysisTask = require('../models/AnalysisTask');
const Project = require('../models/Project');
const User = require('../models/User');
const { calculateProgress } = require('./analysisController');

const getUserTasks = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ activeTasks: user.activeTasks });
  } catch (error) {
    console.error('getUserTasks: Error fetching user tasks', error);
    res.status(500).json({ error: 'Error fetching user tasks', details: error.message });
  }
};

const getAnalysisStatus = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ isAnalyzing: project.isAnalyzing });
  } catch (error) {
    console.error('getAnalysisStatus: Error fetching analysis status', error);
    res.status(500).json({ error: 'Error fetching analysis status', details: error.message });
  }
};

const getTaskProgress = async (req, res) => {
  const { projectId, taskId } = req.params;
  try {
    const progressData = await calculateProgress(projectId, taskId);
    res.json(progressData);
  } catch (error) {
    console.error('getTaskProgress: Error fetching task progress', error);
    res.status(500).json({ error: 'Error fetching task progress', details: error.message });
  }
};

const getTaskProgressSSE = (req, res) => {
  const { projectId, taskId } = req.params;
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const intervalId = setInterval(async () => {
    try {
      const progressData = await calculateProgress(projectId, taskId);
      res.write(`data: ${JSON.stringify(progressData)}\n\n`);
      if (progressData.status === 'completed' || progressData.status === 'failed' || progressData.status === 'cancelled') {
        clearInterval(intervalId);
        res.end();
      }
    } catch (error) {
      console.error('getTaskProgressSSE: Error sending progress update', error);
      res.write(`data: ${JSON.stringify({ error: 'Error fetching progress', details: error.message })}\n\n`);
      clearInterval(intervalId);
      res.end();
    }
  }, 5000);

  req.on('close', () => {
    clearInterval(intervalId);
    res.end();
  });
};

module.exports = {
  getUserTasks,
  getAnalysisStatus,
  getTaskProgress,
  getTaskProgressSSE,
};
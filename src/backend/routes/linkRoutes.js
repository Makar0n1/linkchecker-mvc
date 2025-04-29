const express = require('express');
const router = express.Router();
const {
  authMiddleware,
  superAdminMiddleware,
  registerUser,
  loginUser,
  refreshToken,
  getUserInfo,
  selectPlan,
  processPayment,
  cancelSubscription,
  deleteAccount,
  updateProfile,
} = require('../controllers/authController');
const { createProject, getProjects, deleteProject } = require('../controllers/projectController');
const { addLinks, getLinks, deleteLink, deleteAllLinks } = require('../controllers/linkController');
const { addSpreadsheet, getSpreadsheets, deleteSpreadsheet } = require('../controllers/spreadsheetController');
const { checkLinks, runSpreadsheetAnalysis, cancelSpreadsheetAnalysis } = require('../controllers/analysisController');
const { getUserTasks, getAnalysisStatus, getTaskProgress, getTaskProgressSSE } = require('../controllers/taskController');
const User = require('../models/User');
const Project = require('../models/Project');
const AnalysisTask = require('../models/AnalysisTask');

router.post('/register', superAdminMiddleware, registerUser);
router.post('/login', loginUser);
router.post('/refresh-token', refreshToken);
router.get('/user', authMiddleware, getUserInfo);
router.get('/user/tasks', authMiddleware, getUserTasks);
router.get('/:projectId/analysis-status', authMiddleware, getAnalysisStatus);
router.get('/:projectId/task-progress/:taskId', authMiddleware, getTaskProgress);
router.get('/:projectId/task-progress-sse/:taskId', authMiddleware, getTaskProgressSSE);

// Проекты
router.post('/projects', authMiddleware, createProject);
router.get('/projects', authMiddleware, getProjects);
router.delete('/projects/:projectId', authMiddleware, deleteProject);

// Ссылки (в рамках проекта)
router.post('/:projectId/links', authMiddleware, addLinks);
router.get('/:projectId/links', authMiddleware, getLinks);
router.delete('/:projectId/links', authMiddleware, deleteAllLinks);
router.post('/:projectId/links/check', authMiddleware, checkLinks);
router.delete('/:projectId/links/:id', authMiddleware, deleteLink);

// Google Sheets (в рамках проекта)
router.post('/:projectId/spreadsheets', authMiddleware, addSpreadsheet);
router.get('/:projectId/spreadsheets', authMiddleware, getSpreadsheets);
router.post('/:projectId/spreadsheets/:spreadsheetId/run', authMiddleware, runSpreadsheetAnalysis);
router.delete('/:projectId/spreadsheets/:spreadsheetId', authMiddleware, deleteSpreadsheet);
router.post('/:projectId/spreadsheets/:spreadsheetId/cancel', authMiddleware, cancelSpreadsheetAnalysis);

// Профиль и подписка
router.post('/select-plan', authMiddleware, selectPlan);
router.post('/process-payment', authMiddleware, processPayment);
router.put('/profile', authMiddleware, updateProfile);
router.post('/cancel-subscription', authMiddleware, cancelSubscription);
router.delete('/account', authMiddleware, deleteAccount);

router.post('/user/clear-stale-tasks', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const activeTasks = user.activeTasks || new Map();
    const projectIds = Array.from(activeTasks.keys());
    const tasksToRemove = [];

    for (const projectId of projectIds) {
      const taskId = activeTasks.get(projectId);
      const task = await AnalysisTask.findById(taskId);
      if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        tasksToRemove.push(projectId);
      }
    }

    for (const projectId of tasksToRemove) {
      const taskId = activeTasks.get(projectId);
      activeTasks.delete(projectId);
      const project = await Project.findOne({ _id: projectId, userId });
      if (project) {
        project.isAnalyzing = false;
        await project.save();
        console.log(`Cleared isAnalyzing for project ${projectId}`);
      }
      await AnalysisTask.findByIdAndDelete(taskId);
      console.log(`Deleted stale AnalysisTask ${taskId} for project ${projectId}`);
    }

    user.activeTasks = activeTasks;
    await user.save();

    res.json({ message: 'Stale tasks cleared' });
  } catch (error) {
    console.error('Error clearing stale tasks:', error);
    res.status(500).json({ error: 'Failed to clear stale tasks' });
  }
});

module.exports = router;
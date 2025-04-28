const express = require('express');
const router = express.Router();
const linkController = require('../controllers/linkController');

router.post('/register', linkController.registerUser);
router.post('/login', linkController.loginUser);
router.get('/user', linkController.getUserInfo);
router.get('/user/tasks', linkController.getUserTasks);
router.get('/:projectId/analysis-status', linkController.getAnalysisStatus);
router.get('/:projectId/task-progress/:taskId', linkController.getTaskProgress); // Удаляем inline-обработчик
router.get('/:projectId/task-progress-sse/:taskId', linkController.getTaskProgressSSE);

// Проекты
router.post('/projects', linkController.createProject);
router.get('/projects', linkController.getProjects);
router.delete('/projects/:projectId', linkController.deleteProject);

// Ссылки (в рамках проекта)
router.post('/:projectId/links', linkController.addLinks);
router.get('/:projectId/links', linkController.getLinks);
router.delete('/:projectId/links', linkController.deleteAllLinks);
router.post('/:projectId/links/check', linkController.checkLinks);
router.delete('/:projectId/links/:id', linkController.deleteLink);

// Google Sheets (в рамках проекта)
router.get('/projects/:projectId/activeTasks', linkController.getActiveTasks);
router.post('/:projectId/spreadsheets', linkController.addSpreadsheet);
router.get('/:projectId/spreadsheets', linkController.getSpreadsheets);
router.post('/:projectId/spreadsheets/:spreadsheetId/run', linkController.runSpreadsheetAnalysis);
router.delete('/:projectId/spreadsheets/:spreadsheetId', linkController.deleteSpreadsheet);
router.post('/:projectId/spreadsheets/:spreadsheetId/cancel', linkController.cancelSpreadsheetAnalysis);

// Профиль и подписка
router.post('/select-plan', linkController.selectPlan);
router.post('/process-payment', linkController.processPayment);
router.put('/profile', linkController.updateProfile);
router.post('/cancel-subscription', linkController.cancelSubscription);
router.delete('/account', linkController.deleteAccount);
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
  
      // Проверяем каждую задачу
      for (const projectId of projectIds) {
        const taskId = activeTasks.get(projectId);
        const task = await AnalysisTask.findById(taskId);
        if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
          tasksToRemove.push(projectId);
        }
      }
  
      // Удаляем устаревшие задачи
      for (const projectId of tasksToRemove) {
        activeTasks.delete(projectId);
        const project = await Project.findOne({ _id: projectId, userId });
        if (project) {
          project.isAnalyzing = false;
          await project.save();
        }
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
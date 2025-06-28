const express = require('express');
const router = express.Router();
const linkController = require('../controllers/linkController');
const authMiddleware = require('../controllers/middleware/authMiddleware');

router.post('/register', linkController.registerUser);
router.post('/login', linkController.loginUser);
router.post('/encrypt-password', linkController.encryptPassword); // Убрано authMiddleware
router.post('/decrypt-password', linkController.decryptPassword); // Убрано authMiddleware
router.get('/user', authMiddleware, linkController.getUserInfo);
router.get('/user/tasks', authMiddleware, linkController.getUserTasks);
router.get('/:projectId/analysis-status', authMiddleware, linkController.getAnalysisStatus);
router.get('/:projectId/task-progress/:taskId', linkController.getTaskProgress);
router.get('/:projectId/task-progress-sse/:taskId', linkController.getTaskProgressSSE);
router.get('/:projectId/active-spreadsheet-tasks', authMiddleware, linkController.getActiveSpreadsheetTasks);
router.post('/refresh-token', linkController.refreshToken);

// Проекты
router.post('/projects', authMiddleware, linkController.createProject);
router.get('/projects', authMiddleware, linkController.getProjects);
router.delete('/projects/:projectId', authMiddleware, linkController.deleteProject);
router.get('/projects/:projectId/stats', authMiddleware, linkController.getProjectStats);

// Ссылки (в рамках проекта)
router.post('/:projectId/links', authMiddleware, linkController.addLinks);
router.get('/:projectId/links', authMiddleware, linkController.getLinks);
router.delete('/:projectId/links', authMiddleware, linkController.deleteAllLinks);
router.post('/:projectId/links/check', authMiddleware, linkController.checkLinks);
router.delete('/:projectId/links/:id', authMiddleware, linkController.deleteLink);

// Google Sheets (в рамках проекта)
router.get('/projects/:projectId/activeTasks', authMiddleware, linkController.getActiveTasks);
router.post('/:projectId/spreadsheets', authMiddleware, linkController.addSpreadsheet);
router.get('/:projectId/spreadsheets', authMiddleware, linkController.getSpreadsheets);
router.post('/:projectId/spreadsheets/:spreadsheetId/run', authMiddleware, linkController.runSpreadsheetAnalysis);
router.delete('/:projectId/spreadsheets/:spreadsheetId', authMiddleware, linkController.deleteSpreadsheet);
router.post('/:projectId/spreadsheets/:spreadsheetId/cancel', authMiddleware, linkController.cancelSpreadsheetAnalysis);

// Профиль и подписка
router.post('/select-plan', authMiddleware, linkController.selectPlan);
router.post('/process-payment', authMiddleware, linkController.processPayment);
router.put('/profile', authMiddleware, linkController.updateProfile);
router.post('/cancel-subscription', authMiddleware, linkController.cancelSubscription);
router.delete('/account', authMiddleware, linkController.deleteAccount);
router.post('/update-password', authMiddleware, linkController.updatePassword);

module.exports = router;
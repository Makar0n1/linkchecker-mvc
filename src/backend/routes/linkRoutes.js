const express = require('express');
const router = express.Router();
const linkController = require('../controllers/linkController');

router.post('/register', linkController.registerUser);
router.post('/login', linkController.loginUser);
router.get('/user', linkController.getUserInfo);
router.get('/user/tasks', linkController.getUserTasks);
router.get('/:projectId/analysis-status', linkController.getAnalysisStatus);
router.get('/:projectId/task-progress/:taskId', linkController.getTaskProgress); // Без authMiddleware
router.get('/:projectId/task-progress-sse/:taskId', linkController.getTaskProgressSSE); // Без authMiddleware
router.get('/:projectId/active-spreadsheet-tasks', linkController.getActiveSpreadsheetTasks);
router.post('/refresh-token', linkController.refreshToken);

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

module.exports = router;
const express = require('express');
const router = express.Router();
const linkController = require('../controllers/linkController');
const spreadsheetController = require('../controllers/spreadsheetController');

router.post('/register', linkController.registerUser);
router.post('/login', linkController.loginUser);
router.post('/logout', linkController.logoutUser);
router.post('/encrypt-password', linkController.encryptPassword);
router.post('/decrypt-password', linkController.decryptPassword);
router.post('/verify-remember-me', linkController.verifyRememberMeToken);
router.get('/user', linkController.getUserInfo);
router.get('/user/tasks', linkController.getUserTasks);
router.get('/:projectId/analysis-status', linkController.getAnalysisStatus);
router.get('/:projectId/task-progress/:taskId', linkController.getTaskProgress);
router.get('/:projectId/task-progress-sse/:taskId', linkController.getTaskProgressSSE);
router.get('/:projectId/active-spreadsheet-tasks', linkController.getActiveSpreadsheetTasks);
router.post('/refresh-token', linkController.refreshToken);

// Проекты
router.post('/projects', linkController.createProject);
router.get('/projects', linkController.getProjects);
router.delete('/projects/:projectId', linkController.deleteProject);
router.get('/projects/:projectId/stats', linkController.getProjectStats);

// Ссылки (в рамках проекта)
router.post('/:projectId/links', linkController.addLinks);
router.get('/:projectId/links', linkController.getLinks);
router.delete('/:projectId/links', linkController.deleteAllLinks);
router.post('/:projectId/links/check', linkController.checkLinks);
router.delete('/:projectId/links/:id', linkController.deleteLink);
router.get('/:projectId/links/export', linkController.exportLinksToExcel);

// Google Sheets (в рамках проекта)
router.get('/projects/:projectId/activeTasks', linkController.getActiveTasks);
router.post('/:projectId/spreadsheets', spreadsheetController.addSpreadsheet);
router.put('/:projectId/spreadsheets/:spreadsheetId', spreadsheetController.editSpreadsheet);
router.get('/:projectId/spreadsheets', spreadsheetController.getSpreadsheets);
router.post('/:projectId/spreadsheets/:spreadsheetId/run', spreadsheetController.runSpreadsheetAnalysis);
router.delete('/:projectId/spreadsheets/:spreadsheetId', spreadsheetController.deleteSpreadsheet);
router.post('/:projectId/spreadsheets/:spreadsheetId/cancel', spreadsheetController.cancelSpreadsheetAnalysis);

// Ping Status (в рамках проекта)
const pingController = require('../controllers/pingController');
router.post('/:projectId/ping-spreadsheets', pingController.addPingSpreadsheet);
router.get('/:projectId/ping-spreadsheets', pingController.getPingSpreadsheets);
router.put('/:projectId/ping-spreadsheets/:pingSpreadsheetId', pingController.editPingSpreadsheet);
router.delete('/:projectId/ping-spreadsheets/:pingSpreadsheetId', pingController.deletePingSpreadsheet);
router.post('/:projectId/ping-spreadsheets/:pingSpreadsheetId/run', pingController.runPingAnalysis);

// Профиль и подписка
router.post('/select-plan', linkController.selectPlan);
router.post('/process-payment', linkController.processPayment);
router.put('/profile', linkController.updateProfile);
router.post('/cancel-subscription', linkController.cancelSubscription);
router.delete('/account', linkController.deleteAccount);

// Смена пароля
router.post('/update-password', linkController.updatePassword);

module.exports = router;
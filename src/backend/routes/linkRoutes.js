const express = require('express');
const router = express.Router();
const linkController = require('../controllers/linkController');

router.post('/register', linkController.registerUser);
router.post('/login', linkController.loginUser);
router.get('/user', linkController.getUserInfo);

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

// Google Sheets (без изменений)
router.post('/spreadsheets', linkController.addSpreadsheet);
router.get('/spreadsheets', linkController.getSpreadsheets);
router.post('/spreadsheets/:spreadsheetId/run', linkController.runSpreadsheetAnalysis);
router.delete('/spreadsheets/:spreadsheetId', linkController.deleteSpreadsheet);

// Профиль и подписка (без изменений)
router.post('/select-plan', linkController.selectPlan);
router.post('/process-payment', linkController.processPayment);
router.put('/profile', linkController.updateProfile);
router.post('/cancel-subscription', linkController.cancelSubscription);
router.delete('/account', linkController.deleteAccount);

module.exports = router;
const express = require('express');
const router = express.Router();
const linkController = require('../controllers/linkController');

router.post('/register', linkController.registerUser);
router.post('/login', linkController.loginUser);
router.get('/user', linkController.getUserInfo);
router.post('/', linkController.addLinks);
router.get('/', linkController.getLinks);
router.delete('/', linkController.deleteAllLinks);
router.post('/check', linkController.checkLinks);
router.post('/spreadsheets', linkController.addSpreadsheet);
router.get('/spreadsheets', linkController.getSpreadsheets);
router.post('/spreadsheets/:spreadsheetId/run', linkController.runSpreadsheetAnalysis);
router.delete('/spreadsheets/:spreadsheetId', linkController.deleteSpreadsheet);
router.post('/select-plan', linkController.selectPlan);
router.post('/process-payment', linkController.processPayment);
router.put('/profile', linkController.updateProfile);
router.post('/cancel-subscription', linkController.cancelSubscription);
router.delete('/account', linkController.deleteAccount); // Переместили выше
router.delete('/:id', linkController.deleteLink); // Теперь этот маршрут ниже

module.exports = router;
const express = require('express');
const router = express.Router();
const linkController = require('../controllers/linkController');

router.post('/register', linkController.registerUser); // Регистрация
router.post('/login', linkController.loginUser);       // Логин
router.get('/user', linkController.getUserInfo);       // Получение информации о пользователе
router.post('/', linkController.addLinks);             // Добавление ссылок
router.get('/', linkController.getLinks);              // Получение ссылок
router.delete('/:id', linkController.deleteLink);      // Удаление одной ссылки
router.delete('/', linkController.deleteAllLinks);     // Удаление всех ссылок
router.post('/check', linkController.checkLinks);      // Проверка ссылок
router.post('/spreadsheets', linkController.addSpreadsheet);
router.get('/spreadsheets', linkController.getSpreadsheets);
router.post('/spreadsheets/:spreadsheetId/run', linkController.runSpreadsheetAnalysis);
router.delete('/spreadsheets/:spreadsheetId', linkController.deleteSpreadsheet);

module.exports = router;
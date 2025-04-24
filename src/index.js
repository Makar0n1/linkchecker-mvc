const { spawn } = require('child_process');
const dotenv = require('dotenv');
const path = require('path');
const schedule = require('node-schedule');
const mongoose = require('mongoose');
const Spreadsheet = require('./backend/models/Spreadsheet');
const Project = require('./backend/models/Project');
const linkController = require('./backend/controllers/linkController');

// Загружаем .env в зависимости от окружения
const envPath = process.env.NODE_ENV === 'production'
  ? path.resolve(__dirname, '../.env.prod')
  : path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

console.log('Index.js - NODE_ENV:', process.env.NODE_ENV);
console.log('Index.js - FRONTEND_PORT:', process.env.FRONTEND_PORT);

// Запуск бэкенда
const backend = spawn('node', ['src/backend/server.js'], { 
  stdio: 'inherit', 
  env: { ...process.env }
});

// Запуск фронтенда
let frontend;
if (process.env.NODE_ENV === 'production') {
  // В продакшене используем serve для раздачи dist
  frontend = spawn('node', [
    path.resolve(__dirname, '../node_modules/serve/build/main.js'),
    '-s', 'dist',
    '-l', process.env.FRONTEND_PORT || 3001
  ], { 
    stdio: 'inherit', 
    cwd: path.resolve(__dirname, '..'), 
    env: { ...process.env } 
  });
} else {
  // В разработке используем vite
  frontend = spawn('node', [
    path.resolve(__dirname, '../node_modules/vite/bin/vite.js'),
    '--port', process.env.FRONTEND_PORT || 3001
  ], { 
    stdio: 'inherit', 
    cwd: path.resolve(__dirname, '..'), 
    env: { ...process.env, NODE_ENV: 'development' } 
  });
}

// Логирование запуска процессов
backend.on('spawn', () => console.log('Backend spawned'));
backend.on('error', (err) => console.error('Backend error:', err));
frontend.on('spawn', () => console.log('Frontend spawned'));
frontend.on('error', (err) => console.error('Frontend error:', err));

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Очищаем все существующие задачи при перезапуске
schedule.gracefulShutdown().then(() => {
  console.log('Cleared all scheduled jobs on startup');
});

// Функция для анализа таблиц
const runAnalysis = async () => {
  console.log('Checking scheduled spreadsheet analysis...');
  try {
    // Выбираем только таблицы со статусом pending
    const spreadsheets = await Spreadsheet.find({ status: 'pending' });
    console.log(`Found ${spreadsheets.length} spreadsheets with status 'pending' for analysis`);

    for (const spreadsheet of spreadsheets) {
      const now = new Date();
      const lastRun = spreadsheet.lastRun || new Date(0);
      const hoursSinceLastRun = (now - lastRun) / (1000 * 60 * 60);

      if (hoursSinceLastRun >= spreadsheet.intervalHours) {
        // Проверяем, не анализируется ли проект
        const project = await Project.findOne({ _id: spreadsheet.projectId });
        if (project.isAnalyzing) {
          console.log(`Analysis already in progress for project ${spreadsheet.projectId}, skipping spreadsheet ${spreadsheet.spreadsheetId}`);
          continue;
        }

        console.log(`Running analysis for ${spreadsheet.spreadsheetId}`);
        spreadsheet.status = 'checking';
        await spreadsheet.save();
        try {
          await linkController.analyzeSpreadsheet(spreadsheet);
          spreadsheet.status = 'completed';
        } catch (error) {
          spreadsheet.status = 'error';
          console.error(`Error analyzing ${spreadsheet.spreadsheetId}:`, error);
        }
        spreadsheet.lastRun = now;
        await spreadsheet.save();
      }
    }
  } catch (error) {
    console.error('Error in runAnalysis:', error);
  }
};

// Запускаем планировщик каждые 5 минут
schedule.scheduleJob('*/5 * * * *', runAnalysis);

// Обработка graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  backend.kill();
  frontend.kill();
  mongoose.connection.close();
  process.exit();
});
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const linkRoutes = require('./routes/linkRoutes');
const WebSocket = require('ws');
const Spreadsheet = require('./models/Spreadsheet');
const Project = require('./models/Project');
const authMiddleware = require('./controllers/middleware/authMiddleware');
const { analysisQueue, loadPendingTasks, initQueue } = require('./controllers/taskQueue');
const { analyzeSpreadsheet } = require('./controllers/spreadsheetController');

console.log('server.js: Loading taskQueue module');
const taskQueue = require('./controllers/taskQueue');

// Загружаем .env из корня проекта
const envPath = process.env.NODE_ENV === 'production'
  ? path.resolve(__dirname, '../../.env.prod')
  : path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

console.log('server.js: NODE_ENV:', process.env.NODE_ENV);
console.log('server.js: MONGODB_URI:', process.env.MONGODB_URI);
console.log('server.js: JWT_SECRET:', process.env.JWT_SECRET ? 'set' : 'not set');
console.log('server.js: JWT_REMEMBER_ME_SECRET:', process.env.JWT_REMEMBER_ME_SECRET ? 'set' : 'not set');
console.log('server.js: AES_SECRET defined:', !!process.env.AES_SECRET);
console.log('server.js: AES_IV defined:', !!process.env.AES_IV);
console.log('server.js: Initializing taskQueue and node-schedule');

const app = express();
const port = process.env.BACKEND_PORT || 3000;

// Инициализация очереди
initQueue();

// Импорт Agenda планировщика
const { startAgenda } = require('./schedulers/agendaScheduler');

// Настройка подключения к MongoDB
mongoose.set('strictQuery', true);
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(async () => {
    console.log('server.js: Connected to MongoDB');
    
    // Запускаем Agenda планировщик после подключения к MongoDB
    await startAgenda();
    console.log('server.js: Agenda scheduler started');

    // Проверка коллекций
    console.log('server.js: Checking database for missing userId in Spreadsheets and Projects...');
    const spreadsheetsWithoutUserId = await Spreadsheet.find({ userId: { $exists: false } });
    if (spreadsheetsWithoutUserId.length > 0) {
      console.log(`server.js: Found ${spreadsheetsWithoutUserId.length} Spreadsheets without userId`);
      for (const spreadsheet of spreadsheetsWithoutUserId) {
        const project = await Project.findById(spreadsheet.projectId);
        if (project && project.userId) {
          spreadsheet.userId = project.userId;
          await spreadsheet.save();
          console.log(`server.js: Updated Spreadsheet ${spreadsheet._id} with userId=${spreadsheet.userId}`);
        } else {
          console.error(`server.js: Cannot update Spreadsheet ${spreadsheet._id}: Project ${spreadsheet.projectId} not found or missing userId`);
        }
      }
    } else {
      console.log('server.js: All Spreadsheets have userId');
    }

    const projectsWithoutUserId = await Project.find({ userId: { $exists: false } });
    if (projectsWithoutUserId.length > 0) {
      console.error(`server.js: Found ${projectsWithoutUserId.length} Projects without userId:`, projectsWithoutUserId.map(p => p._id));
    } else {
      console.log('server.js: All Projects have userId');
    }

    // Загрузка ожидающих задач
    console.log('server.js: Loading pending tasks for analysisQueue');
    try {
      await loadPendingTasks();
    } catch (error) {
      console.error(`server.js: Failed to load pending tasks: ${error.message}, retrying...`);
      setTimeout(() => loadPendingTasks(), 5000); // Повтор через 5 секунд
    }
  })
  .catch(err => {
    console.error('server.js: MongoDB connection error:', err);
    process.exit(1);
  });

// Настройка CORS
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      'https://link-check-pro.top',
      'http://localhost:3001',
      'http://localhost:3000',
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`server.js: CORS: Origin ${origin} not allowed. Allowed origins: ${allowedOrigins}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-remember-me-token'],
  credentials: true,
};
app.use(cors(corsOptions));

// Обработка preflight запросов
app.options('*', (req, res) => {
  console.log(`server.js: Handling OPTIONS request for ${req.url}`);
  res.set({
    'Access-Control-Allow-Origin': 'https://link-check-pro.top',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-remember-me-token',
    'Access-Control-Allow-Credentials': 'true',
  });
  res.status(204).send();
});

// Middleware для парсинга JSON
app.use(express.json());

// Логирование всех запросов для отладки
app.use((req, res, next) => {
  console.log(`server.js: [${new Date().toISOString()}] ${req.method} ${req.url} (Origin: ${req.headers.origin})`);
  if (req.method === 'POST' && req.url.includes('/spreadsheets') && req.url.includes('/run')) {
    console.log(`server.js: Run analysis requested for ${req.url}`);
  }
  next();
});

// Применяем маршруты, исключая /login, /encrypt-password и /decrypt-password из authMiddleware
app.use('/api/links', (req, res, next) => {
  if (['/login', '/encrypt-password', '/decrypt-password'].includes(req.path)) {
    console.log(`server.js: Bypassing authMiddleware for ${req.path}`);
    return next();
  }
  authMiddleware(req, res, next);
}, linkRoutes);

// Запуск HTTP сервера
const server = app.listen(port, () => {
  const baseUrl = process.env.NODE_ENV === 'production'
    ? `https://api.link-check-pro.top`
    : `http://localhost:${port}`;
  console.log(`server.js: Backend running at ${baseUrl}`);
});

// Настройка WebSocket сервера
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('server.js: WebSocket client connected');
  ws.on('message', (message) => {
    const data = JSON.parse(message.toString());
    if (data.type === 'subscribe' && data.projectId) {
      ws.projectId = data.projectId;
      console.log(`server.js: Client subscribed to project ${data.projectId}`);
    }
  });
  ws.on('close', () => {
    console.log('server.js: WebSocket client disconnected');
  });
});

// Middleware для добавления wss в req
app.use((req, res, next) => {
  req.wss = wss;
  next();
});

// Инициализация WebSocket broadcast утилит
const { 
  initializeWebSocket, 
  broadcastProgress: broadcastProgressUtil 
} = require('./utils/websocketBroadcast');

// Инициализируем WebSocket после создания wss
initializeWebSocket(wss);

// Слушатель событий BullMQ для WebSocket обновлений
const { linkAnalysisQueue } = require('./queues/linkQueue');
const AnalysisTask = require('./models/AnalysisTask');

// Функция для отправки обновления прогресса через WebSocket
const broadcastProgress = async (taskId, projectId) => {
  try {
    const task = await AnalysisTask.findById(taskId);
    if (!task) return;
    
    const progressData = {
      taskId: task._id.toString(),
      projectId: projectId,
      status: task.status,
      progress: task.progress,
      processedLinks: task.processedLinks,
      totalLinks: task.totalLinks,
      estimatedTimeRemaining: task.estimatedTimeRemaining || 0,
    };
    
    // Используем утилиту для отправки
    broadcastProgressUtil(projectId, progressData);
  } catch (error) {
    console.error('[WebSocket] Error broadcasting progress:', error.message);
  }
};

// Слушаем события completed для отправки финальных обновлений
linkAnalysisQueue.on('completed', async (job, result) => {
  const { taskId, projectId } = job.data;
  if (taskId && projectId) {
    await broadcastProgress(taskId, projectId);
  }
});

// Периодический мониторинг активных задач для WebSocket обновлений
setInterval(async () => {
  try {
    const activeTasks = await AnalysisTask.find({ 
      status: { $in: ['pending', 'processing'] } 
    });
    
    if (activeTasks.length > 0) {
      console.log(`[WebSocket] Broadcasting progress for ${activeTasks.length} active tasks`);
      for (const task of activeTasks) {
        await broadcastProgress(task._id.toString(), task.projectId.toString());
      }
    }
  } catch (error) {
    console.error('[WebSocket] Error in periodic progress broadcast:', error.message);
  }
}, 2000); // Каждые 2 секунды (баланс между real-time и нагрузкой)

console.log('[WebSocket] Real-time progress broadcasting initialized');

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error(`server.js: Server error: ${err.message}`);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

process.on('uncaughtException', (error) => {
  console.error('server.js: Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('server.js: Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = { 
  app, 
  wss
};
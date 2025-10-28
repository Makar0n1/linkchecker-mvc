/**
 * linkWorker.js - Воркер для обработки задач анализа ссылок из BullMQ очереди
 * 
 * Запускается как отдельный процесс (или несколько процессов через PM2).
 * Обрабатывает задачи из очереди link-analysis параллельно с заданным уровнем concurrency.
 * 
 * Запуск:
 * - Разработка: `npm run worker`
 * - Продакшн: через PM2 (см. ecosystem.config.js)
 */

const { Worker } = require('bullmq');
const { connection } = require('../queues/linkQueue');
const { checkLinkStatus } = require('../controllers/linkAnalysisController');
const { finalizeTask } = require('./taskFinalization');
const FrontendLink = require('../models/FrontendLink');
const AnalysisTask = require('../models/AnalysisTask');
const Project = require('../models/Project');
const User = require('../models/User');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Загрузка переменных окружения
const envPath = process.env.NODE_ENV === 'production'
  ? path.resolve(__dirname, '../../../.env.prod')
  : path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

console.log(`[LinkWorker] 📋 Loading environment from: ${envPath}`);
console.log(`[LinkWorker] 📋 MONGODB_URI defined: ${!!process.env.MONGODB_URI}`);
console.log(`[LinkWorker] 📋 REDIS_HOST: ${process.env.REDIS_HOST || 'not set'}`);

// Проверка наличия MONGODB_URI
if (!process.env.MONGODB_URI) {
  console.error('[LinkWorker] ❌ MONGODB_URI is not defined in environment!');
  console.error(`[LinkWorker] ❌ Tried to load from: ${envPath}`);
  process.exit(1);
}

// Подключение к MongoDB (если еще не подключено)
if (mongoose.connection.readyState === 0) {
  console.log(`[LinkWorker] 🔌 Connecting to MongoDB: ${process.env.MONGODB_URI}`);
  mongoose.connect(process.env.MONGODB_URI, { 
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
  })
    .then(() => console.log('[LinkWorker] ✅ Connected to MongoDB'))
    .catch(err => {
      console.error('[LinkWorker] ❌ MongoDB connection error:', err.message);
      console.error('[LinkWorker] ❌ URI:', process.env.MONGODB_URI);
      process.exit(1);
    });
}

// Конфигурация воркера
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY) || 3;
const MAX_JOBS_PER_WORKER = parseInt(process.env.MAX_JOBS_PER_WORKER) || 5;

console.log(`[LinkWorker] ⚙️ Configuration: CONCURRENCY=${CONCURRENCY}, MAX_JOBS=${MAX_JOBS_PER_WORKER}`);

/**
 * Обработчик задачи
 * @param {Job} job - Задача из BullMQ
 */
const processJob = async (job) => {
  const { linkId, taskId, projectId, userId } = job.data;
  
  console.log(`[LinkWorker] 🔄 Processing job ${job.id}: link=${linkId}, task=${taskId}`);
  
  try {
    // Проверка, не отменена ли задача
    const task = await AnalysisTask.findById(taskId);
    if (!task) {
      console.log(`[LinkWorker] ⚠️ Task ${taskId} not found, skipping job ${job.id}`);
      return { status: 'task_not_found', linkId, taskId };
    }
    
    if (task.status === 'cancelled') {
      console.log(`[LinkWorker] ⚠️ Task ${taskId} cancelled, skipping job ${job.id}`);
      return { status: 'cancelled', linkId, taskId };
    }
    
    // Получаем ссылку
    const link = await FrontendLink.findById(linkId);
    if (!link) {
      console.log(`[LinkWorker] ⚠️ Link ${linkId} not found, skipping job ${job.id}`);
      return { status: 'link_not_found', linkId, taskId };
    }
    
    // Обновляем прогресс задачи (начало обработки)
    await job.updateProgress(0);
    
    // Анализируем ссылку
    console.log(`[LinkWorker] 🔍 Analyzing link: ${link.url}`);
    const result = await checkLinkStatus(link);
    
    // Обновляем прогресс задачи (завершение)
    await job.updateProgress(100);
    
    // Обновляем счетчик обработанных ссылок в задаче
    const updatedTask = await AnalysisTask.findByIdAndUpdate(
      taskId,
      {
        $inc: { processedLinks: 1 },
        updatedAt: new Date(),
      },
      { new: true }
    );
    
    // Вычисляем прогресс
    const progress = Math.round((updatedTask.processedLinks / updatedTask.totalLinks) * 100);
    await AnalysisTask.findByIdAndUpdate(taskId, {
      $set: { progress },
    });
    
    console.log(`[LinkWorker] ✅ Job ${job.id} completed: ${updatedTask.processedLinks}/${updatedTask.totalLinks} (${progress}%)`);
    
    // Проверяем, завершена ли вся задача
    if (updatedTask.processedLinks >= updatedTask.totalLinks) {
      console.log(`[LinkWorker] 🎉 Task ${taskId} fully completed! Starting finalization...`);
      
      // Финализация задачи (экспорт в Google Sheets, обновление статусов, планирование)
      await finalizeTask(taskId);
      
      console.log(`[LinkWorker] 🧹 Task ${taskId} finalized successfully`);
    }
    
    return {
      status: 'completed',
      linkId,
      taskId,
      linkStatus: result.status,
      overallStatus: result.overallStatus,
      progress: `${updatedTask.processedLinks}/${updatedTask.totalLinks}`,
    };
  } catch (error) {
    console.error(`[LinkWorker] ❌ Error processing job ${job.id}:`, error.message);
    console.error(error.stack);
    
    // Обновляем задачу с ошибкой
    await AnalysisTask.findByIdAndUpdate(taskId, {
      $inc: { processedLinks: 1 }, // Считаем как обработанную (чтобы не зависло)
      $set: { updatedAt: new Date() },
    }).catch(err => console.error('[LinkWorker] Error updating task on failure:', err.message));
    
    throw error; // BullMQ обработает повторы
  }
};

/**
 * Создание воркера
 */
const linkWorker = new Worker(
  'link-analysis',
  processJob,
  {
    connection,
    concurrency: CONCURRENCY, // Количество параллельных задач
    limiter: {
      max: MAX_JOBS_PER_WORKER, // Максимум задач в секунду на воркер
      duration: 1000,
    },
    lockDuration: 300000, // 5 минут на обработку одной задачи (защита от зависания)
    stalledInterval: 30000, // Проверка зависших задач каждые 30 секунд
  }
);

/**
 * События воркера
 */

linkWorker.on('ready', () => {
  console.log(`[LinkWorker] ✅ Worker ready (concurrency: ${CONCURRENCY})`);
});

linkWorker.on('active', (job) => {
  console.log(`[LinkWorker] 🔄 Job ${job.id} started`);
});

linkWorker.on('completed', (job, result) => {
  console.log(`[LinkWorker] ✅ Job ${job.id} completed:`, result.status);
});

linkWorker.on('failed', (job, error) => {
  console.error(`[LinkWorker] ❌ Job ${job?.id} failed:`, error.message);
  
  // Логируем детали для дебага
  if (job) {
    console.error(`[LinkWorker] Job data:`, JSON.stringify(job.data, null, 2));
    console.error(`[LinkWorker] Attempt: ${job.attemptsMade}/${job.opts.attempts}`);
  }
});

linkWorker.on('stalled', (jobId) => {
  console.warn(`[LinkWorker] ⚠️ Job ${jobId} stalled (not responding)`);
});

linkWorker.on('progress', (job, progress) => {
  console.log(`[LinkWorker] 📊 Job ${job.id} progress: ${progress}%`);
});

linkWorker.on('error', (error) => {
  console.error('[LinkWorker] ❌ Worker error:', error.message);
});

linkWorker.on('closed', () => {
  console.log('[LinkWorker] 🔒 Worker closed');
});

/**
 * Graceful shutdown
 */
const gracefulShutdown = async () => {
  console.log('[LinkWorker] 🔒 Shutting down gracefully...');
  
  try {
    await linkWorker.close();
    await mongoose.connection.close();
    console.log('[LinkWorker] ✅ Worker shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('[LinkWorker] ❌ Error during shutdown:', error.message);
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Обработка необработанных ошибок
process.on('unhandledRejection', (reason, promise) => {
  console.error('[LinkWorker] ⚠️ Unhandled Rejection:', reason);
  // Не завершаем процесс, просто логируем
});

process.on('uncaughtException', (error) => {
  console.error('[LinkWorker] ⚠️ Uncaught Exception:', error.message);
  console.error(error.stack);
  // Завершаем процесс при критической ошибке
  gracefulShutdown();
});

console.log(`[LinkWorker] 🚀 Link worker started (PID: ${process.pid})`);

module.exports = linkWorker;


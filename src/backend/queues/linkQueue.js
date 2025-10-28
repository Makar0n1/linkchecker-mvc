/**
 * linkQueue.js - Очередь задач для анализа ссылок с использованием BullMQ
 * 
 * Заменяет async.queue на более надежную и масштабируемую систему очередей BullMQ.
 * 
 * Преимущества BullMQ над async.queue:
 * - Персистентность задач через Redis (переживает перезагрузки)
 * - Автоматические повторы при ошибках (exponential backoff)
 * - Распределенная обработка (несколько воркеров)
 * - Мониторинг и статистика задач
 * - Приоритезация задач
 * - Graceful shutdown
 */

const { Queue } = require('bullmq');
const Redis = require('ioredis');

// Создание подключения к Redis
const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

// Очередь для анализа ссылок
// QueueScheduler больше не нужен в BullMQ v3+ - функциональность встроена в Queue
const linkAnalysisQueue = new Queue('link-analysis', {
  connection,
  defaultJobOptions: {
    attempts: 3, // Максимум 3 попытки на задачу
    backoff: {
      type: 'exponential',
      delay: 5000, // 5 секунд базовая задержка
    },
    removeOnComplete: {
      age: 3600, // Удалять завершенные задачи через 1 час (для экономии памяти)
      count: 100, // Хранить только последние 100 завершенных задач
    },
    removeOnFail: {
      age: 7200, // Удалять упавшие задачи через 2 часа
      count: 50, // Хранить последние 50 упавших задач для анализа
    },
  },
});

// События очереди для логирования

linkAnalysisQueue.on('error', (error) => {
  console.error('[LinkQueue] ❌ Queue Error:', error.message);
});

linkAnalysisQueue.on('waiting', (jobId) => {
  console.log(`[LinkQueue] ⏳ Job ${jobId} is waiting`);
});

linkAnalysisQueue.on('active', (job) => {
  console.log(`[LinkQueue] 🔄 Job ${job.id} started (${job.name})`);
});

linkAnalysisQueue.on('completed', (job, result) => {
  console.log(`[LinkQueue] ✅ Job ${job.id} completed`, result);
});

linkAnalysisQueue.on('failed', (job, error) => {
  console.error(`[LinkQueue] ❌ Job ${job.id} failed:`, error.message);
});

linkAnalysisQueue.on('stalled', (jobId) => {
  console.warn(`[LinkQueue] ⚠️ Job ${jobId} stalled (not responding)`);
});

linkAnalysisQueue.on('removed', (job) => {
  console.log(`[LinkQueue] 🗑️ Job ${job.id} removed`);
});

// События подключения к Redis

connection.on('error', (error) => {
  console.error('[LinkQueue] ❌ Redis connection error:', error.message);
});

connection.on('connect', () => {
  console.log('[LinkQueue] ✅ Redis connected successfully');
});

connection.on('ready', () => {
  console.log('[LinkQueue] ✅ Redis ready for commands');
});

connection.on('reconnecting', () => {
  console.log('[LinkQueue] 🔄 Reconnecting to Redis...');
});

connection.on('close', () => {
  console.log('[LinkQueue] 🔒 Redis connection closed');
});

/**
 * Получение статистики очереди
 * @returns {Promise<Object>}
 */
const getQueueStats = async () => {
  try {
    const counts = await linkAnalysisQueue.getJobCounts(
      'waiting', 'active', 'completed', 'failed', 'delayed'
    );
    
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    };
  } catch (error) {
    console.error('[LinkQueue] Error getting queue stats:', error.message);
    return null;
  }
};

/**
 * Очистка завершенных/упавших задач
 * @param {number} grace - Время в миллисекундах (по умолчанию 0 - все)
 */
const cleanQueue = async (grace = 0) => {
  try {
    console.log('[LinkQueue] 🧹 Cleaning queue...');
    const jobs = await linkAnalysisQueue.clean(grace, 1000, 'completed');
    console.log(`[LinkQueue] ✅ Cleaned ${jobs.length} completed jobs`);
    
    const failedJobs = await linkAnalysisQueue.clean(grace, 1000, 'failed');
    console.log(`[LinkQueue] ✅ Cleaned ${failedJobs.length} failed jobs`);
    
    return { completed: jobs.length, failed: failedJobs.length };
  } catch (error) {
    console.error('[LinkQueue] ❌ Error cleaning queue:', error.message);
    return null;
  }
};

/**
 * Очистка всех задач (для тестирования/дебага)
 */
const obliterateQueue = async () => {
  try {
    console.log('[LinkQueue] ☢️ OBLITERATING entire queue...');
    await linkAnalysisQueue.obliterate({ force: true });
    console.log('[LinkQueue] ✅ Queue obliterated');
  } catch (error) {
    console.error('[LinkQueue] ❌ Error obliterating queue:', error.message);
  }
};

/**
 * Получение задачи по ID
 * @param {string} jobId
 * @returns {Promise<Job|null>}
 */
const getJob = async (jobId) => {
  try {
    return await linkAnalysisQueue.getJob(jobId);
  } catch (error) {
    console.error(`[LinkQueue] Error getting job ${jobId}:`, error.message);
    return null;
  }
};

/**
 * Graceful shutdown очереди
 */
const shutdownQueue = async () => {
  console.log('[LinkQueue] 🔒 Shutting down queue...');
  
  try {
    await linkAnalysisQueue.close();
    await connection.quit();
    console.log('[LinkQueue] ✅ Queue shutdown complete');
  } catch (error) {
    console.error('[LinkQueue] ❌ Error during shutdown:', error.message);
  }
};

// Graceful shutdown при SIGTERM/SIGINT
process.on('SIGTERM', shutdownQueue);
process.on('SIGINT', shutdownQueue);

// Логирование инициализации
console.log('[LinkQueue] 🚀 Link analysis queue initialized');

module.exports = {
  linkAnalysisQueue,
  connection,
  getQueueStats,
  cleanQueue,
  obliterateQueue,
  getJob,
  shutdownQueue,
};


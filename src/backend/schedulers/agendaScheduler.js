/**
 * agendaScheduler.js - Планировщик задач с использованием Agenda
 * 
 * Заменяет node-schedule на более надежный и масштабируемый Agenda.
 * 
 * Преимущества Agenda над node-schedule:
 * - Персистентность задач в MongoDB (переживает перезагрузки)
 * - Распределенная обработка (несколько серверов)
 * - Автоматическая обработка пропущенных задач
 * - Приоритезация и управление конкурентностью
 * - Подробное логирование и мониторинг
 * - Graceful shutdown
 */

const dotenv = require('dotenv');
const path = require('path');

// Загрузка переменных окружения
const envPath = process.env.NODE_ENV === 'production'
  ? path.resolve(__dirname, '../../../.env.prod')
  : path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

console.log(`[AgendaScheduler] 📋 Loading environment from: ${envPath}`);
console.log(`[AgendaScheduler] 📋 MONGODB_URI defined: ${!!process.env.MONGODB_URI}`);

// Проверка наличия MONGODB_URI
if (!process.env.MONGODB_URI) {
  console.error('[AgendaScheduler] ❌ MONGODB_URI is not defined in environment!');
  console.error(`[AgendaScheduler] ❌ Tried to load from: ${envPath}`);
  throw new Error('MONGODB_URI is required for Agenda scheduler');
}

const Agenda = require('agenda');
const mongoose = require('mongoose');
const Spreadsheet = require('../models/Spreadsheet');
const Project = require('../models/Project');
const User = require('../models/User');
const AnalysisTask = require('../models/AnalysisTask');
const { addLinkAnalysisJobs, monitorTaskCompletion } = require('../controllers/taskQueue');

// Создание Agenda экземпляра
const agenda = new Agenda({
  db: { 
    address: process.env.MONGODB_URI,
    collection: 'agendaJobs', // Отдельная коллекция для Agenda
    options: { useUnifiedTopology: true },
  },
  processEvery: '1 minute', // Проверка новых задач каждую минуту
  maxConcurrency: 3, // Максимум 3 задачи одновременно
  defaultConcurrency: 1, // По умолчанию 1 задача за раз
  defaultLockLifetime: 10 * 60 * 1000, // 10 минут на выполнение задачи
});

console.log('[AgendaScheduler] 🚀 Initializing Agenda scheduler...');

/**
 * Определение задачи для пинга spreadsheet
 */
agenda.define('ping-spreadsheet', { priority: 'normal', concurrency: 2 }, async (job) => {
  const { pingSpreadsheetId } = job.attrs.data;
  
  console.log(`[AgendaScheduler] 🏓 Starting scheduled ping for ${pingSpreadsheetId}`);
  
  try {
    const { executePingAnalysis } = require('../controllers/pingController');
    await executePingAnalysis(pingSpreadsheetId);
    
    console.log(`[AgendaScheduler] 🎉 Successfully completed ping for ${pingSpreadsheetId}`);
  } catch (error) {
    console.error(`[AgendaScheduler] ❌ Error pinging spreadsheet ${pingSpreadsheetId}:`, error.message);
    throw error;
  }
});

/**
 * Определение задачи для анализа spreadsheet
 */
agenda.define('analyze-spreadsheet', { priority: 'high', concurrency: 1 }, async (job) => {
  const { spreadsheetId, projectId, userId } = job.attrs.data;
  
  console.log(`[AgendaScheduler] 📊 Starting scheduled analysis for spreadsheet ${spreadsheetId}`);
  
  try {
    // Проверяем, существует ли spreadsheet
    const spreadsheet = await Spreadsheet.findById(spreadsheetId);
    if (!spreadsheet) {
      console.log(`[AgendaScheduler] ⚠️ Spreadsheet ${spreadsheetId} not found, cancelling job`);
      await agenda.cancel({ 'data.spreadsheetId': spreadsheetId });
      return;
    }
    
    // Проверяем, не идет ли уже анализ
    const project = await Project.findById(projectId);
    if (!project) {
      console.log(`[AgendaScheduler] ⚠️ Project ${projectId} not found, cancelling job`);
      return;
    }
    
    if (project.isAnalyzingSpreadsheet) {
      console.log(`[AgendaScheduler] ⚠️ Project ${projectId} already analyzing, skipping`);
      return;
    }
    
    // Проверяем лимиты пользователя
    const user = await User.findById(userId);
    if (!user) {
      console.log(`[AgendaScheduler] ⚠️ User ${userId} not found`);
      return;
    }
    
    // Определяем лимит ссылок на основе плана
    const linkLimits = {
      basic: 1000,
      pro: 5000,
      premium: 10000,
      enterprise: 50000,
    };
    const maxLinks = linkLimits[user.plan] || 0;
    
    if (maxLinks === 0) {
      console.log(`[AgendaScheduler] ⚠️ User ${userId} does not have a valid plan for spreadsheets`);
      return;
    }
    
    console.log(`[AgendaScheduler] ✅ Starting analysis with maxLinks=${maxLinks}`);
    
    // Создаем задачу анализа
    const task = new AnalysisTask({
      projectId,
      userId,
      type: 'runSpreadsheetAnalysis',
      status: 'pending',
      totalLinks: 0, // Будет обновлено после импорта
      processedLinks: 0,
      progress: 0,
      data: { userId, projectId, spreadsheetId, maxLinks },
    });
    await task.save();
    console.log(`[AgendaScheduler] ✅ Created analysis task ${task._id}`);
    
    // Обновляем пользователя
    user.activeTasks.set(projectId.toString(), task._id.toString());
    await user.save();
    
    // Помечаем проект как анализируемый
    project.isAnalyzingSpreadsheet = true;
    await project.save();
    
    // Обновляем spreadsheet
    spreadsheet.status = 'checking';
    await spreadsheet.save();
    
    // Импортируем ссылки из Google Sheets
    const { importFromGoogleSheets } = require('../controllers/googleSheetsUtils');
    const { links: importedLinks } = await importFromGoogleSheets(
      spreadsheet.spreadsheetId,
      spreadsheet.targetDomain,
      spreadsheet.urlColumn,
      spreadsheet.targetColumn,
      spreadsheet.gid
    );
    
    console.log(`[AgendaScheduler] 📋 Imported ${importedLinks.length} links from spreadsheet`);
    
    // Проверяем лимит
    if (importedLinks.length > maxLinks) {
      throw new Error(`Spreadsheet has ${importedLinks.length} links, but limit is ${maxLinks}`);
    }
    
    // Создаем FrontendLink для каждой импортированной ссылки
    const FrontendLink = require('../models/FrontendLink');
    await FrontendLink.deleteMany({ 
      projectId, 
      spreadsheetId, 
      source: 'google_sheets' 
    });
    
    const createdLinks = [];
    for (const linkData of importedLinks) {
      const newLink = new FrontendLink({
        url: linkData.url,
        targetDomains: linkData.targetDomains,
        projectId,
        userId,
        spreadsheetId,
        rowIndex: linkData.rowIndex,
        source: 'google_sheets',
        status: 'pending',
        taskId: task._id,
      });
      await newLink.save();
      createdLinks.push(newLink);
    }
    
    console.log(`[AgendaScheduler] ✅ Created ${createdLinks.length} FrontendLinks`);
    
    // Обновляем totalLinks в задаче
    await AnalysisTask.findByIdAndUpdate(task._id, {
      $set: { totalLinks: createdLinks.length },
    });
    
    // Добавляем задачи в BullMQ очередь
    const result = await addLinkAnalysisJobs(
      task._id, 
      projectId, 
      userId, 
      'google_sheets', 
      spreadsheetId
    );
    console.log(`[AgendaScheduler] ✅ Added ${result.added} jobs to BullMQ queue`);
    
    // Запускаем мониторинг завершения задачи
    monitorTaskCompletion(task._id, projectId, userId, 'google_sheets', spreadsheetId);
    
    console.log(`[AgendaScheduler] 🎉 Successfully started analysis for spreadsheet ${spreadsheetId}`);
  } catch (error) {
    console.error(`[AgendaScheduler] ❌ Error analyzing spreadsheet ${spreadsheetId}:`, error.message);
    console.error(error.stack);
    
    // Обновляем статус при ошибке
    await Spreadsheet.findByIdAndUpdate(spreadsheetId, {
      $set: { status: 'error' },
      $inc: { scanCount: 1 },
    }).catch(() => {});
    
    await Project.findByIdAndUpdate(projectId, {
      $set: { isAnalyzingSpreadsheet: false },
    }).catch(() => {});
    
    throw error; // Agenda пометит задачу как failed
  }
});

/**
 * Обработчик успешного выполнения задачи
 */
agenda.on('success', (job) => {
  console.log(`[AgendaScheduler] ✅ Job "${job.attrs.name}" succeeded`);
});

/**
 * Обработчик ошибок задачи
 */
agenda.on('fail', (error, job) => {
  console.error(`[AgendaScheduler] ❌ Job "${job.attrs.name}" failed:`, error.message);
});

/**
 * Обработчик запуска задачи
 */
agenda.on('start', (job) => {
  console.log(`[AgendaScheduler] 🔄 Job "${job.attrs.name}" started`);
});

/**
 * Обработчик завершения задачи
 */
agenda.on('complete', (job) => {
  console.log(`[AgendaScheduler] ✅ Job "${job.attrs.name}" completed`);
});

/**
 * Запуск Agenda
 */
const startAgenda = async () => {
  try {
    await agenda.start();
    console.log('[AgendaScheduler] ✅ Agenda scheduler started successfully');
    
    // Загружаем существующие spreadsheets и планируем их
    await scheduleExistingSpreadsheets();
  } catch (error) {
    console.error('[AgendaScheduler] ❌ Failed to start Agenda:', error.message);
    throw error;
  }
};

/**
 * Функция для планирования существующих spreadsheets
 * Планирует только те, что уже хотя бы раз запускались (lastRun !== null)
 */
const scheduleExistingSpreadsheets = async () => {
  try {
    console.log('[AgendaScheduler] 🔍 Loading existing spreadsheets...');
    
    // Планируем только те spreadsheets, которые уже были запущены хотя бы раз
    const spreadsheets = await Spreadsheet.find({ 
      status: { $in: ['pending', 'completed'] },
      lastRun: { $ne: null } // Только с lastRun (уже запускались)
    });
    
    console.log(`[AgendaScheduler] 📋 Found ${spreadsheets.length} spreadsheets to schedule (with lastRun)`);
    
    for (const spreadsheet of spreadsheets) {
      try {
        await scheduleSpreadsheet(spreadsheet);
      } catch (error) {
        console.error(`[AgendaScheduler] ⚠️ Failed to schedule spreadsheet ${spreadsheet._id}:`, error.message);
        // Продолжаем планировать остальные
      }
    }
    
    console.log('[AgendaScheduler] ✅ Finished scheduling existing spreadsheets');
  } catch (error) {
    console.error('[AgendaScheduler] ❌ Error scheduling existing spreadsheets:', error.message);
  }
};

/**
 * Функция для планирования отдельного spreadsheet
 * Планирует ОДИН запуск в будущем (lastRun + intervalHours)
 * @param {Object} spreadsheet - Объект Spreadsheet из MongoDB
 */
const scheduleSpreadsheet = async (spreadsheet) => {
  try {
    // Удаляем старую задачу, если есть
    try {
      await agenda.cancel({ 
        name: 'analyze-spreadsheet', 
        'data.spreadsheetId': spreadsheet._id.toString() 
      });
      console.log(`[AgendaScheduler] 🗑️ Cancelled old job for spreadsheet ${spreadsheet._id}`);
    } catch (cancelError) {
      // Игнорируем ошибку если задачи не было
      console.log(`[AgendaScheduler] ℹ️ No previous job to cancel for spreadsheet ${spreadsheet._id}`);
    }
    
    // Вычисляем время следующего запуска
    const now = new Date();
    const lastRun = spreadsheet.lastRun || now;
    const intervalMs = spreadsheet.intervalHours * 60 * 60 * 1000;
    
    // Следующий запуск = lastRun + intervalHours
    const nextRun = new Date(lastRun.getTime() + intervalMs);
    
    // Если время уже прошло - запускаем через 1 минуту
    const scheduleTime = nextRun > now ? nextRun : new Date(now.getTime() + 60000);
    
    const timeUntilRun = Math.round((scheduleTime - now) / 1000 / 60); // минуты
    
    console.log(`[AgendaScheduler] 📅 Scheduling spreadsheet ${spreadsheet._id}`);
    console.log(`[AgendaScheduler]    Last run: ${lastRun.toISOString()}`);
    console.log(`[AgendaScheduler]    Interval: ${spreadsheet.intervalHours} hours`);
    console.log(`[AgendaScheduler]    Next run: ${scheduleTime.toISOString()} (in ${timeUntilRun} minutes)`);
    
    // Создаем одноразовую задачу на конкретное время
    await agenda.schedule(scheduleTime, 'analyze-spreadsheet', {
      spreadsheetId: spreadsheet._id.toString(),
      projectId: spreadsheet.projectId.toString(),
      userId: spreadsheet.userId.toString(),
    });
    
    console.log(`[AgendaScheduler] ✅ Scheduled spreadsheet ${spreadsheet._id} for ${scheduleTime.toISOString()}`);
  } catch (error) {
    console.error(`[AgendaScheduler] ❌ Error scheduling spreadsheet ${spreadsheet._id}:`, error.message);
    console.error(error.stack);
    throw error;
  }
};

/**
 * Функция для отмены планирования spreadsheet
 * @param {string} spreadsheetId - ID spreadsheet
 */
const cancelSpreadsheetSchedule = async (spreadsheetId) => {
  try {
    const numRemoved = await agenda.cancel({ 
      name: 'analyze-spreadsheet', 
      'data.spreadsheetId': spreadsheetId.toString() 
    });
    
    console.log(`[AgendaScheduler] 🗑️ Cancelled ${numRemoved} jobs for spreadsheet ${spreadsheetId}`);
  } catch (error) {
    console.error(`[AgendaScheduler] ❌ Error cancelling schedule for spreadsheet ${spreadsheetId}:`, error.message);
    throw error;
  }
};

/**
 * Graceful shutdown Agenda
 */
const shutdownAgenda = async () => {
  console.log('[AgendaScheduler] 🔒 Shutting down Agenda...');
  
  try {
    await agenda.stop();
    console.log('[AgendaScheduler] ✅ Agenda shutdown complete');
  } catch (error) {
    console.error('[AgendaScheduler] ❌ Error during Agenda shutdown:', error.message);
  }
};

/**
 * Функция для планирования ping spreadsheet
 * @param {Object} pingSpreadsheet - Объект PingSpreadsheet из MongoDB
 */
const schedulePingSpreadsheet = async (pingSpreadsheet) => {
  try {
    // Удаляем старую задачу, если есть
    try {
      await agenda.cancel({ 
        name: 'ping-spreadsheet', 
        'data.pingSpreadsheetId': pingSpreadsheet._id.toString() 
      });
      console.log(`[AgendaScheduler] 🗑️ Cancelled old ping job for ${pingSpreadsheet._id}`);
    } catch (cancelError) {
      console.log(`[AgendaScheduler] ℹ️ No previous ping job to cancel for ${pingSpreadsheet._id}`);
    }
    
    // Вычисляем время следующего запуска
    const now = new Date();
    const lastRun = pingSpreadsheet.lastRun || now;
    const intervalMs = pingSpreadsheet.intervalDays * 24 * 60 * 60 * 1000;
    
    // Следующий запуск = lastRun + intervalDays
    const nextRun = new Date(lastRun.getTime() + intervalMs);
    
    // Если время уже прошло - запускаем через 1 минуту
    const scheduleTime = nextRun > now ? nextRun : new Date(now.getTime() + 60000);
    
    const timeUntilRun = Math.round((scheduleTime - now) / 1000 / 60 / 60); // часы
    
    console.log(`[AgendaScheduler] 🏓 Scheduling ping spreadsheet ${pingSpreadsheet._id}`);
    console.log(`[AgendaScheduler]    Last run: ${lastRun.toISOString()}`);
    console.log(`[AgendaScheduler]    Interval: ${pingSpreadsheet.intervalDays} days`);
    console.log(`[AgendaScheduler]    Next run: ${scheduleTime.toISOString()} (in ${timeUntilRun} hours)`);
    
    // Создаем одноразовую задачу на конкретное время
    await agenda.schedule(scheduleTime, 'ping-spreadsheet', {
      pingSpreadsheetId: pingSpreadsheet._id.toString(),
    });
    
    console.log(`[AgendaScheduler] ✅ Scheduled ping spreadsheet ${pingSpreadsheet._id} for ${scheduleTime.toISOString()}`);
  } catch (error) {
    console.error(`[AgendaScheduler] ❌ Error scheduling ping spreadsheet ${pingSpreadsheet._id}:`, error.message);
    throw error;
  }
};

/**
 * Функция для отмены планирования ping spreadsheet
 * @param {string} pingSpreadsheetId - ID ping spreadsheet
 */
const cancelPingSpreadsheetSchedule = async (pingSpreadsheetId) => {
  try {
    const numRemoved = await agenda.cancel({ 
      name: 'ping-spreadsheet', 
      'data.pingSpreadsheetId': pingSpreadsheetId.toString() 
    });
    
    console.log(`[AgendaScheduler] 🗑️ Cancelled ${numRemoved} ping jobs for ${pingSpreadsheetId}`);
  } catch (error) {
    console.error(`[AgendaScheduler] ❌ Error cancelling ping schedule for ${pingSpreadsheetId}:`, error.message);
    throw error;
  }
};

// Graceful shutdown handlers
process.on('SIGTERM', shutdownAgenda);
process.on('SIGINT', shutdownAgenda);

module.exports = {
  agenda,
  startAgenda,
  scheduleSpreadsheet,
  cancelSpreadsheetSchedule,
  schedulePingSpreadsheet,
  cancelPingSpreadsheetSchedule,
  shutdownAgenda,
};


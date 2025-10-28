/**
 * taskQueue.js - Управление очередью задач анализа (обновлено для BullMQ)
 * 
 * ОБНОВЛЕНО: Использует BullMQ вместо async.queue для:
 * - Персистентности задач (переживает перезагрузки)
 * - Распределенной обработки через воркеры
 * - Автоматических повторов при ошибках
 * - Мониторинга и статистики
 * 
 * ВАЖНО: Фактическая обработка задач происходит в воркерах (src/backend/workers/linkWorker.js)
 */

const { linkAnalysisQueue, getQueueStats } = require('../queues/linkQueue');
const AnalysisTask = require('../models/AnalysisTask');
const Project = require('../models/Project');
const FrontendLink = require('../models/FrontendLink');
const Spreadsheet = require('../models/Spreadsheet');
const User = require('../models/User');

console.log('[TaskQueue] 🚀 Initializing BullMQ-based task queue');

const cancelAnalysis = { value: false };

/**
 * Добавление задач анализа ссылок в BullMQ очередь
 * @param {string} taskId - ID задачи AnalysisTask
 * @param {string} projectId - ID проекта
 * @param {string} userId - ID пользователя
 * @param {string} source - Источник ссылок ('manual' или 'google_sheets')
 * @param {string} [spreadsheetId] - ID таблицы (опционально)
 */
const addLinkAnalysisJobs = async (taskId, projectId, userId, source, spreadsheetId = null) => {
  try {
    console.log(`[TaskQueue] 📋 Adding analysis jobs for task ${taskId}, source: ${source}`);
    
    // Получаем ссылки для анализа
    const query = { projectId, source, taskId };
    if (spreadsheetId) {
      query.spreadsheetId = spreadsheetId;
    }
    
    const links = await FrontendLink.find(query);
    
    if (links.length === 0) {
      console.log(`[TaskQueue] ⚠️ No links found for task ${taskId}`);
      return { added: 0, total: 0 };
    }
    
    console.log(`[TaskQueue] 📊 Found ${links.length} links to analyze`);
    
    // Создаем задачи для BullMQ (bulk добавление для производительности)
    const jobs = links.map((link, index) => ({
      name: `analyze-link-${source}`,
      data: {
        linkId: link._id.toString(),
        taskId: taskId.toString(),
        projectId: projectId.toString(),
        userId: userId.toString(),
        source,
        spreadsheetId: spreadsheetId ? spreadsheetId.toString() : null,
        url: link.url, // Для логирования
      },
      opts: {
        jobId: `link-${link._id}-${taskId}`, // Уникальный ID для предотвращения дубликатов
        priority: source === 'manual' ? 1 : 2, // Manual links имеют приоритет
        delay: index * 100, // Небольшая задержка между добавлением задач (для плавного старта)
      },
    }));
    
    // Добавляем все задачи в очередь одним запросом
    await linkAnalysisQueue.addBulk(jobs);
    
    console.log(`[TaskQueue] ✅ Added ${jobs.length} jobs to BullMQ queue for task ${taskId}`);
    
    return { added: jobs.length, total: links.length };
  } catch (error) {
    console.error(`[TaskQueue] ❌ Error adding analysis jobs for task ${taskId}:`, error.message);
    throw error;
  }
};

/**
 * Мониторинг завершения задачи (периодическая проверка)
 * @param {string} taskId - ID задачи
 * @param {string} projectId - ID проекта
 * @param {string} userId - ID пользователя
 * @param {string} source - Источник ('manual' или 'google_sheets')
 * @param {string} [spreadsheetId] - ID таблицы (опционально)
 */
const monitorTaskCompletion = async (taskId, projectId, userId, source, spreadsheetId = null) => {
  console.log(`[TaskQueue] 👁️ Starting completion monitor for task ${taskId}`);
  
  const checkInterval = setInterval(async () => {
    try {
      const task = await AnalysisTask.findById(taskId);
      if (!task) {
        console.log(`[TaskQueue] ⚠️ Task ${taskId} not found, stopping monitor`);
        clearInterval(checkInterval);
        return;
      }
      
      // Если задача отменена или завершена
      if (['cancelled', 'completed', 'failed'].includes(task.status)) {
        console.log(`[TaskQueue] 🛑 Task ${taskId} status: ${task.status}, stopping monitor`);
        clearInterval(checkInterval);
        return;
      }
      
      // Проверяем прогресс (воркер обновляет processedLinks)
      if (task.processedLinks >= task.totalLinks) {
        console.log(`[TaskQueue] 🎉 Task ${taskId} completed: ${task.processedLinks}/${task.totalLinks}`);
        clearInterval(checkInterval);
        
        // Обновляем статус задачи
        await AnalysisTask.findByIdAndUpdate(taskId, {
          $set: { status: 'completed', progress: 100 },
        });
        
        // Обновляем проект
        const project = await Project.findById(projectId);
        if (project) {
          if (source === 'manual') {
            project.isAnalyzingManual = false;
          } else if (source === 'google_sheets') {
            project.isAnalyzingSpreadsheet = false;
          }
          await project.save();
          console.log(`[TaskQueue] ✅ Updated project ${projectId} analyzing status`);
        }
        
        // Очищаем активную задачу у пользователя
        const user = await User.findById(userId);
        if (user) {
          user.activeTasks.delete(projectId.toString());
          await user.save();
          console.log(`[TaskQueue] ✅ Cleared active task for user ${userId}`);
        }
        
        // Если это spreadsheet, обновляем его статус
        if (spreadsheetId) {
          await Spreadsheet.findByIdAndUpdate(spreadsheetId, {
            $set: {
              status: 'completed',
              lastRun: new Date(),
            },
            $inc: { scanCount: 1 },
          });
          console.log(`[TaskQueue] ✅ Updated spreadsheet ${spreadsheetId} status`);
        }
      }
    } catch (error) {
      console.error(`[TaskQueue] ❌ Error monitoring task ${taskId}:`, error.message);
    }
  }, 5000); // Проверяем каждые 5 секунд
};

/**
 * Загрузка pending задач при старте сервера
 * Восстанавливает незавершенные задачи и добавляет их в BullMQ
 */
const loadPendingTasks = async () => {
  try {
    console.log('[TaskQueue] 🔍 Checking for pending tasks...');
    
    // Очистка зависших задач (старше 2 часов в статусе 'processing')
    const stuckTasks = await AnalysisTask.find({ 
      status: 'processing', 
      startedAt: { $lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } 
    });
    
    if (stuckTasks.length > 0) {
      console.log(`[TaskQueue] ⚠️ Found ${stuckTasks.length} stuck tasks older than 2 hours`);
      
      for (const task of stuckTasks) {
        await AnalysisTask.findByIdAndUpdate(task._id, { 
          $set: { 
            status: 'failed', 
            error: 'Task timed out', 
            completedAt: new Date() 
          } 
        });
        console.log(`[TaskQueue] ❌ Marked stuck task ${task._id} as failed`);
        
        // Очистка связанных данных
        const spreadsheet = await Spreadsheet.findOne({ 
          _id: task.data?.spreadsheetId, 
          projectId: task.projectId 
        });
        if (spreadsheet) {
          spreadsheet.status = 'error';
          await spreadsheet.save();
        }
        
        const project = await Project.findById(task.projectId);
        if (project) {
          project.isAnalyzingSpreadsheet = false;
          project.isAnalyzingManual = false;
          await project.save();
        }
        
        const user = await User.findById(task.userId);
        if (user) {
          user.activeTasks.delete(task.projectId.toString());
          await user.save();
        }
      }
    }
    
    // Загрузка pending задач
    const pendingTasks = await AnalysisTask.find({ status: 'pending' })
      .sort({ createdAt: 1 }) // Сортируем по времени создания
      .limit(10); // Ограничиваем количество для первого запуска
    
    console.log(`[TaskQueue] 📋 Found ${pendingTasks.length} pending tasks to process`);
    
    if (pendingTasks.length === 0) {
      console.log('[TaskQueue] ✅ No pending tasks found');
      return;
    }
    
    // Добавляем каждую pending задачу в BullMQ
    for (const task of pendingTasks) {
      try {
        console.log(`[TaskQueue] ➕ Processing pending task ${task._id}, type: ${task.type}`);
        
        if (task.type === 'checkLinks') {
          const project = await Project.findById(task.projectId);
          if (!project) {
            await AnalysisTask.findByIdAndUpdate(task._id, { 
              $set: { status: 'failed', error: 'Project not found' } 
            });
            continue;
          }
          
          const userId = task.data?.userId || project.userId;
          const result = await addLinkAnalysisJobs(task._id, task.projectId, userId, 'manual');
          console.log(`[TaskQueue] ✅ Added ${result.added} manual link jobs for task ${task._id}`);
          
          // Запускаем мониторинг
          monitorTaskCompletion(task._id, task.projectId, userId, 'manual');
          
        } else if (task.type === 'runSpreadsheetAnalysis') {
          const spreadsheetId = task.data?.spreadsheetId;
          if (!spreadsheetId) {
            await AnalysisTask.findByIdAndUpdate(task._id, { 
              $set: { status: 'failed', error: 'Spreadsheet ID missing' } 
            });
            continue;
          }
          
          const spreadsheet = await Spreadsheet.findById(spreadsheetId);
          if (!spreadsheet) {
            await AnalysisTask.findByIdAndUpdate(task._id, { 
              $set: { status: 'failed', error: 'Spreadsheet not found' } 
            });
            continue;
          }
          
          const userId = task.data?.userId || spreadsheet.userId;
          const result = await addLinkAnalysisJobs(
            task._id, 
            task.projectId, 
            userId, 
            'google_sheets', 
            spreadsheetId
          );
          console.log(`[TaskQueue] ✅ Added ${result.added} spreadsheet link jobs for task ${task._id}`);
          
          // Запускаем мониторинг
          monitorTaskCompletion(task._id, task.projectId, userId, 'google_sheets', spreadsheetId);
        }
      } catch (error) {
        console.error(`[TaskQueue] ❌ Error processing pending task ${task._id}:`, error.message);
      }
    }
    
    console.log('[TaskQueue] ✅ Finished loading pending tasks');
  } catch (error) {
    console.error('[TaskQueue] ❌ Error loading pending tasks:', error.message);
  }
};

/**
 * Получение статистики очереди
 */
const getStats = async () => {
  try {
    const stats = await getQueueStats();
    console.log('[TaskQueue] 📊 Queue stats:', stats);
    return stats;
  } catch (error) {
    console.error('[TaskQueue] ❌ Error getting queue stats:', error.message);
    return null;
  }
};

// Устаревшие функции для обратной совместимости (эмулируют async.queue API)
const initQueue = () => {
  console.log('[TaskQueue] ⚠️ initQueue() called (deprecated - BullMQ auto-initializes)');
  return linkAnalysisQueue;
};

const triggerNextTask = async () => {
  console.log('[TaskQueue] ⚠️ triggerNextTask() called (deprecated - BullMQ handles this automatically)');
  // BullMQ автоматически обрабатывает следующие задачи через воркеры
  // Эта функция оставлена для обратной совместимости, но ничего не делает
};

// Экспорт для обратной совместимости
const analysisQueue = {
  push: (task, callback) => {
    console.warn('[TaskQueue] ⚠️ analysisQueue.push() called (deprecated - use addLinkAnalysisJobs instead)');
    // Эта функция оставлена для обратной совместимости
    // Новый код должен использовать addLinkAnalysisJobs()
    if (callback) callback(new Error('Deprecated API - use BullMQ functions'));
  },
  length: () => {
    console.warn('[TaskQueue] ⚠️ analysisQueue.length() called (deprecated - use getStats instead)');
    return 0;
  },
};

console.log('[TaskQueue] ✅ BullMQ task queue initialized');

module.exports = {
  analysisQueue, // Для обратной совместимости (deprecated)
  linkAnalysisQueue, // Новая очередь BullMQ
  loadPendingTasks,
  addLinkAnalysisJobs, // Новая функция для добавления задач
  monitorTaskCompletion, // Новая функция для мониторинга
  cancelAnalysis,
  initQueue, // Deprecated
  triggerNextTask, // Deprecated
  getStats,
};

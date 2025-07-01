const async = require('async');
const AnalysisTask = require('../models/AnalysisTask');
const Project = require('../models/Project');
const FrontendLink = require('../models/FrontendLink');
const Spreadsheet = require('../models/Spreadsheet');
const User = require('../models/User');
const { processLinksInBatches } = require('./linkAnalysisController');

console.log('taskQueue.js: Initializing task queue');

// Проверка загрузки модуля async
if (!async || typeof async.queue !== 'function') {
  console.error('taskQueue.js: Failed to load async module');
  process.exit(1);
}

const MAX_CONCURRENT_ANALYSES = 1; // Последовательная обработка

// Функция инициализации очереди
const initQueue = () => {
  console.log('taskQueue.js: Initializing analysisQueue');
  try {
    const queue = async.queue((task, callback) => {
      console.log(`analysisQueue: Starting task ${task.taskId} for project ${task.projectId}, type=${task.type}, spreadsheetId=${task.spreadsheetId || 'N/A'}, userId=${task.userId}`);

      if (typeof task.handler !== 'function') {
        console.error(`analysisQueue: Handler is not a function for task ${task.taskId}, type=${task.type}`);
        return callback(new Error('Handler is not a function'));
      }

      AnalysisTask.findOneAndUpdate(
        { _id: task.taskId, status: 'pending' },
        { $set: { status: 'processing', startedAt: new Date() } },
        { new: true }
      ).then(taskDoc => {
        if (!taskDoc) {
          console.error(`analysisQueue: Task ${task.taskId} not found or not pending`);
          return callback(new Error('Task not found or not pending'));
        }
        task.handler(task, (err, result) => {
          if (err) {
            console.error(`analysisQueue: Error in task ${task.taskId} for project ${task.projectId}, type=${task.type}: ${err.message}`);
            AnalysisTask.findOneAndUpdate(
              { _id: task.taskId },
              { $set: { status: 'failed', error: err.message, completedAt: new Date() } }
            ).then(() => {
              callback(err);
              triggerNextTask(); // Запускаем следующую задачу
            });
            return;
          }
          console.log(`analysisQueue: Completed task ${task.taskId} for project ${task.projectId}, type=${task.type}`);
          AnalysisTask.findOneAndUpdate(
            { _id: task.taskId },
            { $set: { status: 'completed', completedAt: new Date() } }
          ).then(() => {
            callback(null, result);
            triggerNextTask(); // Запускаем следующую задачу
          });
        });
      }).catch(err => {
        console.error(`analysisQueue: Error updating task status to processing for task ${task.taskId}: ${err.message}`);
        callback(err);
        triggerNextTask(); // Запускаем следующую задачу даже при ошибке
      });
    }, MAX_CONCURRENT_ANALYSES);

    queue.drain(() => {
      console.log('analysisQueue: All queued analyses have been processed');
      triggerNextTask(); // Проверяем очередь после опустошения
    });

    queue.error((err, task) => {
      console.error(`analysisQueue: Error in queue for task ${task.taskId}, project ${task.projectId}, type=${task.type}: ${err.message}`);
      triggerNextTask(); // Запускаем следующую задачу при ошибке
    });

    console.log('taskQueue.js: analysisQueue initialized successfully');
    return queue;
  } catch (error) {
    console.error(`taskQueue.js: Failed to initialize analysisQueue: ${error.message}`);
    throw error;
  }
};

// Создаём очередь
const analysisQueue = initQueue();

const cancelAnalysis = { value: false };

// Функция для запуска следующей задачи
const triggerNextTask = async () => {
  try {
    console.log('triggerNextTask: Checking for pending tasks');
    const pendingTasks = await AnalysisTask.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(1); // Берём самую старую задачу
    if (pendingTasks.length === 0) {
      console.log('triggerNextTask: No pending tasks found');
      return;
    }

    const task = pendingTasks[0];
    console.log(`triggerNextTask: Found pending task ${task._id}, type=${task.type}, projectId=${task.projectId}`);

    if (task.type === 'checkLinks') {
      const project = await Project.findById(task.projectId);
      if (!project) {
        console.error(`triggerNextTask: Project ${task.projectId} not found, marking task ${task._id} as failed`);
        await AnalysisTask.findByIdAndUpdate(task._id, { $set: { status: 'failed', error: 'Project not found', completedAt: new Date() } });
        return triggerNextTask(); // Проверяем следующую задачу
      }
      if (!project.userId) {
        console.error(`triggerNextTask: Project ${task.projectId} has no userId, marking task ${task._id} as failed`);
        await AnalysisTask.findByIdAndUpdate(task._id, { $set: { status: 'failed', error: 'Project missing userId', completedAt: new Date() } });
        return triggerNextTask();
      }
      const links = await FrontendLink.find({ projectId: task.projectId, source: 'manual' });
      analysisQueue.push({
        taskId: task._id,
        projectId: task.projectId,
        type: task.type,
        req: null,
        res: null,
        userId: task.data.userId || project.userId,
        wss: null,
        data: task.data,
        handler: (task, callback) => {
          console.log(`checkLinks handler: Starting for task ${task.taskId}, userId=${task.userId}`);
          let project;
          Project.findOne({ _id: task.projectId, userId: task.userId })
            .then(proj => {
              if (!proj) throw new Error('Project not found in handler');
              project = proj;
              project.isAnalyzingManual = true;
              return project.save();
            })
            .then(() => FrontendLink.updateMany({ projectId: task.projectId, source: 'manual' }, { $set: { status: 'checking' } }))
            .then(() => processLinksInBatches(links, 20, task.projectId, task.wss, null, task.taskId))
            .then(updatedLinks => Promise.all(updatedLinks.map(link => link.save())))
            .then(updatedLinks => {
              console.log(`checkLinks handler: Completed for project ${task.projectId}`);
              if (task.res && !task.res.headersSent) {
                task.res.json(updatedLinks);
              }
              const wssLocal = task.wss;
              if (wssLocal) {
                wssLocal.clients.forEach(client => {
                  if (client.readyState === WebSocket.OPEN && client.projectId === task.projectId) {
                    client.send(JSON.stringify({ type: 'analysisComplete', projectId: task.projectId }));
                  }
                });
              }
              callback(null, updatedLinks);
            })
            .catch(error => {
              console.error(`checkLinks handler: Error for project ${task.projectId}: ${error.message}`);
              if (task.res && !task.res.headersSent) {
                task.res.status(500).json({ error: 'Error checking links', details: error.message });
              }
              callback(error);
            })
            .finally(() => {
              if (project) {
                project.isAnalyzingManual = false;
                project.save()
                  .then(() => console.log(`checkLinks handler: Set isAnalyzingManual to false for project ${task.projectId}`))
                  .catch(err => console.error(`checkLinks handler: Error setting isAnalyzingManual to false for project ${task.projectId}: ${err.message}`));
              }
            });
        },
      }, (err) => {
        if (err) console.error(`triggerNextTask: Error queuing checkLinks task ${task._id}: ${err.message}`);
      });
    } else if (task.type === 'runSpreadsheetAnalysis') {
      const spreadsheet = await Spreadsheet.findOne({ _id: task.data.spreadsheetId, projectId: task.projectId });
      if (!spreadsheet) {
        console.error(`triggerNextTask: Spreadsheet ${task.data.spreadsheetId} not found, marking task ${task._id} as failed`);
        await AnalysisTask.findByIdAndUpdate(task._id, { $set: { status: 'failed', error: 'Spreadsheet not found', completedAt: new Date() } });
        return triggerNextTask();
      }

      let userId = task.data.userId;
      console.log(`triggerNextTask: Processing runSpreadsheetAnalysis task ${task._id}, initial userId=${userId}`);
      if (!userId) {
        console.log(`triggerNextTask: userId not found in task.data for task ${task._id}, attempting to retrieve from project`);
        const project = await Project.findById(task.projectId);
        if (project && project.userId) {
          userId = project.userId;
          console.log(`triggerNextTask: Retrieved userId=${userId} from project ${task.projectId}`);
        } else {
          console.error(`triggerNextTask: Could not retrieve userId for task ${task._id}, marking as failed`);
          await AnalysisTask.findByIdAndUpdate(task._id, { $set: { status: 'failed', error: 'userId not found', completedAt: new Date() } });
          return triggerNextTask();
        }
      }

      if (!spreadsheet.userId) {
        console.error(`triggerNextTask: Spreadsheet ${spreadsheet._id} has no userId, attempting to set from project`);
        const project = await Project.findById(task.projectId);
        if (project && project.userId) {
          spreadsheet.userId = project.userId;
          await spreadsheet.save();
          console.log(`triggerNextTask: Updated spreadsheet ${spreadsheet._id} with userId=${spreadsheet.userId}`);
        } else {
          console.error(`triggerNextTask: Could not set userId for spreadsheet ${spreadsheet._id}, marking task as failed`);
          await AnalysisTask.findByIdAndUpdate(task._id, { $set: { status: 'failed', error: 'Spreadsheet missing userId', completedAt: new Date() } });
          return triggerNextTask();
        }
      }

      analysisQueue.push({
        taskId: task._id,
        projectId: task.projectId,
        type: task.type,
        req: null,
        res: null,
        userId,
        wss: null,
        spreadsheetId: task.data.spreadsheetId,
        data: task.data,
        handler: async (task, callback) => {
          console.log(`loadPendingTasks handler: Processing runSpreadsheetAnalysis task ${task.taskId} for project ${task.projectId}, spreadsheet ${task.spreadsheetId}, userId=${task.userId}`);
          let project, spreadsheet;
          try {
            project = await Project.findOne({ _id: task.projectId, userId: task.userId });
            if (!project) {
              throw new Error('Project not found in handler');
            }

            spreadsheet = await Spreadsheet.findOne({ _id: task.spreadsheetId, projectId: task.projectId, userId: task.userId });
            if (!spreadsheet) {
              throw new Error('Spreadsheet not found in handler');
            }

            project.isAnalyzingSpreadsheet = true;
            await project.save();
            console.log(`loadPendingTasks handler: Set isAnalyzingSpreadsheet to true for project ${task.projectId}`);

            spreadsheet.status = 'checking';
            await spreadsheet.save();
            console.log(`loadPendingTasks handler: Set spreadsheet ${task.spreadsheetId} status to checking`);

            cancelAnalysis.value = false;
            console.log(`loadPendingTasks handler: Calling analyzeSpreadsheet with userId=${task.userId} for task ${task.taskId}`);
            const { analyzeSpreadsheet } = require('./spreadsheetController'); // Ленивый импорт
            await analyzeSpreadsheet(spreadsheet, task.data.maxLinks, task.projectId, task.wss, task.taskId, task.userId, task);

            if (cancelAnalysis.value) {
              throw new Error('Analysis cancelled');
            }

            spreadsheet.status = 'completed';
            spreadsheet.lastRun = new Date();
            spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
            await spreadsheet.save();
            console.log(`loadPendingTasks handler: Set spreadsheet ${task.spreadsheetId} status to completed`);

            console.log(`loadPendingTasks handler: Analysis completed for spreadsheet ${task.spreadsheetId}`);
            if (task.res && !task.res.headersSent) {
              task.res.json({ message: 'Analysis completed', taskId: task.taskId });
            }
            const wssLocal = task.wss;
            if (wssLocal) {
              wssLocal.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && client.projectId === task.projectId) {
                  client.send(JSON.stringify({ type: 'analysisComplete', projectId: task.projectId, spreadsheetId: task.spreadsheetId }));
                }
              });
            }
            callback(null);
          } catch (error) {
            console.error(`loadPendingTasks handler: Error analyzing spreadsheet ${task.spreadsheetId} in project ${task.projectId}: ${error.message}`);
            if (spreadsheet) {
              spreadsheet.status = error.message === 'Analysis cancelled' ? 'pending' : 'error';
              spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
              await spreadsheet.save();
              console.log(`loadPendingTasks handler: Set spreadsheet ${task.spreadsheetId} status to ${spreadsheet.status}`);
            }
            if (task.res && !task.res.headersSent) {
              if (error.message === 'Analysis cancelled') {
                task.res.json({ message: 'Analysis cancelled' });
              } else {
                task.res.status(500).json({ error: 'Error analyzing spreadsheet', details: error.message });
              }
            }
            callback(error);
          } finally {
            if (project) {
              project.isAnalyzingSpreadsheet = false;
              await project.save();
              console.log(`loadPendingTasks handler: Set isAnalyzingSpreadsheet to false for project ${task.projectId}`);
              const user = await User.findById(task.userId);
              if (user) {
                user.activeTasks.delete(task.projectId);
                await user.save();
                console.log(`loadPendingTasks handler: Removed task ${task.taskId} from activeTasks for user ${task.userId}`);
              }
            }
          }
        },
      }, (err) => {
        if (err) console.error(`triggerNextTask: Error queuing runSpreadsheetAnalysis task ${task._id}: ${err.message}`);
      });
    }
  } catch (error) {
    console.error(`triggerNextTask: Error processing pending tasks: ${error.message}`);
  }
};

const loadPendingTasks = async () => {
  try {
    console.log('loadPendingTasks: Checking for pending tasks');
    const pendingTasks = await AnalysisTask.find({ status: 'pending' });
    console.log(`loadPendingTasks: Found ${pendingTasks.length} pending tasks to process`);

    // Очистка зависших задач
    const stuckTasks = await AnalysisTask.find({ status: 'processing', startedAt: { $lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    if (stuckTasks.length > 0) {
      console.log(`loadPendingTasks: Found ${stuckTasks.length} stuck tasks older than 2 hours`);
      for (const task of stuckTasks) {
        await AnalysisTask.findByIdAndUpdate(task._id, { $set: { status: 'failed', error: 'Task timed out', completedAt: new Date() } });
        console.log(`loadPendingTasks: Marked stuck task ${task._id} as failed`);
        const spreadsheet = await Spreadsheet.findOne({ _id: task.data.spreadsheetId, projectId: task.projectId });
        if (spreadsheet) {
          spreadsheet.status = 'error';
          await spreadsheet.save();
          console.log(`loadPendingTasks: Set spreadsheet ${task.data.spreadsheetId} status to error for stuck task ${task._id}`);
        }
        const project = await Project.findById(task.projectId);
        if (project) {
          project.isAnalyzingSpreadsheet = false;
          await project.save();
          console.log(`loadPendingTasks: Set isAnalyzingSpreadsheet to false for project ${task.projectId}`);
        }
        const user = await User.findById(task.userId);
        if (user) {
          user.activeTasks.delete(task.projectId);
          await user.save();
          console.log(`loadPendingTasks: Removed task ${task._id} from activeTasks for user ${task.userId}`);
        }
      }
    }

    // Запускаем первую задачу, если очередь пуста
    if (analysisQueue.length() === 0 && pendingTasks.length > 0) {
      console.log('loadPendingTasks: Triggering next task since queue is empty');
      await triggerNextTask();
    }
  } catch (error) {
    console.error(`loadPendingTasks: Error loading pending tasks: ${error.message}`);
  }
};

module.exports = {
  analysisQueue,
  loadPendingTasks,
  cancelAnalysis,
  initQueue,
  triggerNextTask,
};
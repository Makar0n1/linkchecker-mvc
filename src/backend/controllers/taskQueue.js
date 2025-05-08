const async = require('async');
const AnalysisTask = require('../models/AnalysisTask');
const Project = require('../models/Project');
const FrontendLink = require('../models/FrontendLink');
const Spreadsheet = require('../models/Spreadsheet');
const { processLinksInBatches } = require('./linkAnalysisController');
const { analyzeSpreadsheet } = require('./spreadsheetController');

const MAX_CONCURRENT_ANALYSES = 2;

const analysisQueue = async.queue((task, callback) => {
  console.log(`Starting queued analysis for project ${task.projectId}, type: ${task.type}, taskId: ${task.taskId}, userId: ${task.userId}`);
  if (typeof task.handler !== 'function') {
    console.error(`Handler is not a function for task type ${task.type}`);
    return callback(new Error('Handler is not a function'));
  }

  AnalysisTask.findOneAndUpdate(
    { _id: task.taskId, status: 'pending' },
    { $set: { status: 'processing' } },
    { new: true }
  ).then(() => {
    task.handler(task, (err, result) => {
      if (err) {
        console.error(`Error in queued analysis for project ${task.projectId}, type: ${task.type}:`, err);
        AnalysisTask.findOneAndUpdate(
          { _id: task.taskId },
          { $set: { status: 'failed', error: err.message } }
        ).then(() => callback(err));
        return;
      }
      console.log(`Finished queued analysis for project ${task.projectId}, type: ${task.type}`);
      AnalysisTask.findOneAndUpdate(
        { _id: task.taskId },
        { $set: { status: 'completed' } }
      ).then(() => callback(null, result));
    });
  }).catch(err => {
    console.error(`Error updating task status to processing for task ${task.taskId}:`, err);
    callback(err);
  });
}, MAX_CONCURRENT_ANALYSES);

analysisQueue.drain(() => {
  console.log('All queued analyses have been processed');
});

analysisQueue.error((err, task) => {
  console.error(`Error in analysis queue for project ${task.projectId}, type: ${task.type}:`, err);
});

const loadPendingTasks = async () => {
  try {
    const pendingTasks = await AnalysisTask.find({ status: 'pending' });
    console.log(`Found ${pendingTasks.length} pending tasks to process`);
    for (const task of pendingTasks) {
      if (task.type === 'checkLinks') {
        const project = await Project.findById(task.projectId);
        if (!project) {
          console.log(`Project ${task.projectId} not found, marking task as failed`);
          await AnalysisTask.findByIdAndUpdate(task._id, { $set: { status: 'failed', error: 'Project not found' } });
          continue;
        }
        if (!project.userId) {
          console.error(`loadPendingTasks: Project ${task.projectId} has no userId, marking task as failed`);
          await AnalysisTask.findByIdAndUpdate(task._id, { $set: { status: 'failed', error: 'Project missing userId' } });
          continue;
        }
        const links = await FrontendLink.find({ projectId: task.projectId, source: 'manual' });
        analysisQueue.push({
          taskId: task._id,
          projectId: task.projectId,
          type: task.type,
          req: null,
          res: null,
          userId: task.data.userId,
          wss: null,
          handler: (task, callback) => {
            console.log(`checkLinks handler: Starting for task ${task.taskId}, userId=${task.userId}, type=${typeof task.userId}`);
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
                console.log(`Finished link check for project ${task.projectId}`);
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
                console.error(`Error in checkLinks for project ${task.projectId}:`, error);
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
                    .catch(err => console.error(`Error setting isAnalyzingManual to false for project ${task.projectId}:`, err));
                }
              });
          },
        });
      } else if (task.type === 'runSpreadsheetAnalysis') {
        const spreadsheet = await Spreadsheet.findOne({ _id: task.data.spreadsheetId, projectId: task.projectId });
        if (!spreadsheet) {
          console.log(`Spreadsheet ${task.data.spreadsheetId} not found, marking task as failed`);
          await AnalysisTask.findByIdAndUpdate(task._id, { $set: { status: 'failed', error: 'Spreadsheet not found' } });
          continue;
        }

        let userId = task.data.userId;
        console.log(`loadPendingTasks: Processing runSpreadsheetAnalysis task ${task._id}, initial userId=${userId}, type=${typeof userId}`);
        if (!userId) {
          console.log(`loadPendingTasks: userId not found in task.data for task ${task._id}, attempting to retrieve from project`);
          const project = await Project.findById(task.projectId);
          if (project && project.userId) {
            userId = project.userId;
            console.log(`loadPendingTasks: Retrieved userId=${userId}, type=${typeof userId} from project ${task.projectId}`);
          } else {
            console.log(`loadPendingTasks: Could not retrieve userId for task ${task._id}, marking as failed`);
            await AnalysisTask.findByIdAndUpdate(task._id, { $set: { status: 'failed', error: 'userId not found' } });
            continue;
          }
        }

        if (!spreadsheet.userId) {
          console.error(`loadPendingTasks: Spreadsheet ${spreadsheet._id} has no userId, attempting to set from project`);
          const project = await Project.findById(task.projectId);
          if (project && project.userId) {
            spreadsheet.userId = project.userId;
            await spreadsheet.save();
            console.log(`loadPendingTasks: Updated spreadsheet ${spreadsheet._id} with userId=${spreadsheet.userId}`);
          } else {
            console.error(`loadPendingTasks: Could not set userId for spreadsheet ${spreadsheet._id}, marking task as failed`);
            await AnalysisTask.findByIdAndUpdate(task._id, { $set: { status: 'failed', error: 'Spreadsheet missing userId' } });
            continue;
          }
        }

        analysisQueue.push({
          taskId: task._id,
          projectId: task.projectId,
          type: task.type,
          req: null,
          res: null,
          userId: userId,
          wss: null,
          spreadsheetId: task.data.spreadsheetId,
          handler: (task, callback) => {
            console.log(`loadPendingTasks handler: Processing runSpreadsheetAnalysis task ${task.taskId}, userId=${task.userId}, type=${typeof task.userId}`);
            let project;
            Project.findOne({ _id: task.projectId, userId: task.userId })
              .then(proj => {
                if (!proj) throw new Error('Project not found in handler');
                project = proj;
                project.isAnalyzingSpreadsheet = true;
                return project.save();
              })
              .then(() => {
                spreadsheet.status = 'checking';
                return spreadsheet.save();
              })
              .then(() => {
                cancelAnalysis = false;
                console.log(`loadPendingTasks: Calling analyzeSpreadsheet with userId=${task.userId} for task ${task._id}`);
                return analyzeSpreadsheet(spreadsheet, task.data.maxLinks, task.projectId, task.wss, task.taskId, task.userId);
              })
              .then(() => {
                if (cancelAnalysis) {
                  throw new Error('Analysis cancelled');
                }
                spreadsheet.status = 'completed';
                spreadsheet.lastRun = new Date();
                spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
                return spreadsheet.save();
              })
              .then(() => {
                console.log(`Finished spreadsheet analysis for spreadsheet ${spreadsheet._id}`);
                if (task.res && !task.res.headersSent) {
                  task.res.json({ message: 'Analysis completed' });
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
              })
              .catch(error => {
                console.error(`Error analyzing spreadsheet ${spreadsheet._id} in project ${task.projectId}:`, error);
                spreadsheet.status = error.message === 'Analysis cancelled' ? 'pending' : 'error';
                spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
                spreadsheet.save()
                  .then(() => {
                    if (task.res && !task.res.headersSent) {
                      if (error.message === 'Analysis cancelled') {
                        task.res.json({ message: 'Analysis cancelled' });
                      } else {
                        task.res.status(500).json({ error: 'Error analyzing spreadsheet', details: error.message });
                      }
                    }
                    callback(error);
                  });
              })
              .finally(() => {
                if (project) {
                  project.isAnalyzingSpreadsheet = false;
                  project.save()
                    .then(() => console.log(`runSpreadsheetAnalysis handler: Set isAnalyzingSpreadsheet to false for project ${task.projectId}`))
                    .catch(err => console.error(`Error setting isAnalyzingSpreadsheet to false for project ${task.projectId}:`, err));
                }
              });
          },
        });
      }
    }
  } catch (error) {
    console.error('Error loading pending tasks:', error);
  }
};

let cancelAnalysis = false;

module.exports = {
  analysisQueue,
  loadPendingTasks,
  cancelAnalysis,
};
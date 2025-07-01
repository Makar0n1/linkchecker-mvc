const Spreadsheet = require('../models/Spreadsheet');
const User = require('../models/User');
const Project = require('../models/Project');
const AnalysisTask = require('../models/AnalysisTask');
const FrontendLink = require('../models/FrontendLink');
const mongoose = require('mongoose');
const { importFromGoogleSheets, exportLinksToGoogleSheetsBatch, formatGoogleSheet } = require('./googleSheetsUtils');
const { analysisQueue, cancelAnalysis } = require('./taskQueue');
const { processLinksInBatches } = require('./linkAnalysisController');

// Функция добавления таблицы с проверкой дубликатов
const addSpreadsheet = async (req, res) => {
  const { projectId } = req.params;
  const { spreadsheetId, gid, targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours } = req.body;

  console.log(`addSpreadsheet: Received projectId=${projectId}, spreadsheetId=${spreadsheetId}, gid=${gid}, userId=${req.userId}, token=${req.headers.authorization?.slice(0, 20)}...`);

  try {
    if (!req.userId) {
      console.error(`addSpreadsheet: Missing userId for projectId=${projectId}`);
      return res.status(401).json({ error: 'User authentication required' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      console.error(`addSpreadsheet: User not found for userId=${req.userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.isSuperAdmin && user.plan === 'free') {
      console.log(`addSpreadsheet: Google Sheets integration not available on Free plan for userId=${req.userId}`);
      return res.status(403).json({ message: 'Google Sheets integration is not available on Free plan' });
    }

    // Явно преобразуем projectId в ObjectId
    let projectObjectId;
    try {
      projectObjectId = new mongoose.Types.ObjectId(projectId);
      console.log(`addSpreadsheet: Converted projectId=${projectId} to ObjectId=${projectObjectId}`);
    } catch (error) {
      console.error(`addSpreadsheet: Invalid projectId=${projectId}: ${error.message}`);
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    // Проверяем существование проекта
    const project = await Project.findOne({ _id: projectObjectId, userId: req.userId });
    if (!project) {
      console.error(`addSpreadsheet: Project not found for projectId=${projectId}, userId=${req.userId}`);
      const projectExists = await Project.findById(projectObjectId);
      console.log(`addSpreadsheet: Project check - exists=${!!projectExists}, userIdMatch=${projectExists ? projectExists.userId.toString() === req.userId : 'N/A'}`);
      return res.status(404).json({ error: 'Project not found or does not belong to user' });
    }

    const spreadsheets = await Spreadsheet.find({ projectId: projectObjectId, userId: req.userId });
    const planLimits = {
      basic: 1,
      pro: 5,
      premium: 20,
      enterprise: Infinity,
    };
    const maxSpreadsheets = user.isSuperAdmin ? Infinity : planLimits[user.plan];
    if (spreadsheets.length >= maxSpreadsheets) {
      console.error(`addSpreadsheet: Spreadsheet limit exceeded for userId=${req.userId}, plan=${user.plan}, currentCount=${spreadsheets.length}, max=${maxSpreadsheets}`);
      return res.status(403).json({ message: 'Spreadsheet limit exceeded for your plan' });
    }

    if (!spreadsheetId || gid === undefined || gid === null || !targetDomain || !urlColumn || !targetColumn || !resultRangeStart || !resultRangeEnd || intervalHours === undefined) {
      console.error(`addSpreadsheet: Missing required fields for projectId=${projectId}: spreadsheetId=${spreadsheetId}, gid=${gid}, targetDomain=${targetDomain}, urlColumn=${urlColumn}, targetColumn=${targetColumn}, resultRangeStart=${resultRangeStart}, resultRangeEnd=${resultRangeEnd}, intervalHours=${intervalHours}`);
      return res.status(400).json({ error: 'All fields required' });
    }

    // Проверка на дубликаты
    const existingSpreadsheet = await Spreadsheet.findOne({
      spreadsheetId,
      gid: parseInt(gid),
      projectId: projectObjectId,
    });
    if (existingSpreadsheet) {
      console.error(`addSpreadsheet: Duplicate spreadsheet detected: spreadsheetId=${spreadsheetId}, gid=${gid}, projectId=${projectId}`);
      return res.status(400).json({ error: 'Spreadsheet with this spreadsheetId and gid already exists in this project' });
    }

    const planIntervalLimits = {
      basic: 24,
      pro: 4,
      premium: 1,
      enterprise: 1,
    };
    const minInterval = user.isSuperAdmin ? 1 : planIntervalLimits[user.plan];
    if (parseInt(intervalHours) < minInterval) {
      console.error(`addSpreadsheet: Interval too short: ${intervalHours} hours, min=${minInterval} for plan=${user.plan}`);
      return res.status(403).json({ message: `Interval must be at least ${minInterval} hours for your plan` });
    }

    const spreadsheet = new Spreadsheet({
      spreadsheetId,
      gid: parseInt(gid),
      targetDomain,
      urlColumn,
      targetColumn,
      resultRangeStart,
      resultRangeEnd,
      intervalHours: parseInt(intervalHours),
      userId: req.userId,
      projectId: projectObjectId,
      status: 'pending',
    });
    await spreadsheet.save();
    console.log(`addSpreadsheet: Successfully added spreadsheetId=${spreadsheetId}, gid=${gid} for projectId=${projectId}, userId=${req.userId}`);
    res.status(201).json(spreadsheet);
  } catch (error) {
    console.error(`addSpreadsheet: Error for projectId=${projectId}, userId=${req.userId}: ${error.message}`);
    return res.status(500).json({ error: 'Error adding spreadsheet', details: error.message });
  }
};

// Функция редактирования таблицы
const editSpreadsheet = async (req, res) => {
  const { projectId, spreadsheetId } = req.params;
  const { spreadsheetId: newSpreadsheetId, gid, targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours } = req.body;

  console.log(`editSpreadsheet: Received projectId=${projectId}, spreadsheetId=${spreadsheetId}, newSpreadsheetId=${newSpreadsheetId}, gid=${gid}, userId=${req.userId}, token=${req.headers.authorization?.slice(0, 20)}...`);

  try {
    if (!req.userId) {
      console.error(`editSpreadsheet: Missing userId for projectId=${projectId}, spreadsheetId=${spreadsheetId}`);
      return res.status(401).json({ error: 'User authentication required' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      console.error(`editSpreadsheet: User not found for userId=${req.userId}`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Явно преобразуем projectId и spreadsheetId в ObjectId
    let projectObjectId, spreadsheetObjectId;
    try {
      projectObjectId = new mongoose.Types.ObjectId(projectId);
      spreadsheetObjectId = new mongoose.Types.ObjectId(spreadsheetId);
      console.log(`editSpreadsheet: Converted projectId=${projectId} to ObjectId=${projectObjectId}, spreadsheetId=${spreadsheetId} to ObjectId=${spreadsheetObjectId}`);
    } catch (error) {
      console.error(`editSpreadsheet: Invalid ID format - projectId=${projectId}, spreadsheetId=${spreadsheetId}: ${error.message}`);
      return res.status(400).json({ error: 'Invalid project or spreadsheet ID format' });
    }

    // Проверяем существование проекта
    const project = await Project.findOne({ _id: projectObjectId, userId: req.userId });
    if (!project) {
      console.error(`editSpreadsheet: Project not found for projectId=${projectId}, userId=${req.userId}`);
      const projectExists = await Project.findById(projectObjectId);
      console.log(`editSpreadsheet: Project check - exists=${!!projectExists}, userIdMatch=${projectExists ? projectExists.userId.toString() === req.userId : 'N/A'}`);
      return res.status(404).json({ error: 'Project not found or does not belong to user' });
    }

    // Проверяем существование таблицы
    const spreadsheet = await Spreadsheet.findOne({ _id: spreadsheetObjectId, projectId: projectObjectId, userId: req.userId });
    if (!spreadsheet) {
      console.error(`editSpreadsheet: Spreadsheet not found for spreadsheetId=${spreadsheetId}, projectId=${projectId}, userId=${req.userId}`);
      const spreadsheetExists = await Spreadsheet.findById(spreadsheetObjectId);
      console.log(`editSpreadsheet: Spreadsheet check - exists=${!!spreadsheetExists}, projectIdMatch=${spreadsheetExists ? spreadsheetExists.projectId.toString() === projectId : 'N/A'}, userIdMatch=${spreadsheetExists ? spreadsheetExists.userId.toString() === req.userId : 'N/A'}`);
      return res.status(404).json({ error: 'Spreadsheet not found or does not belong to project' });
    }

    // Валидация входных данных
    if (!newSpreadsheetId || gid === undefined || gid === null || !targetDomain || !urlColumn || !targetColumn || !resultRangeStart || !resultRangeEnd || intervalHours === undefined) {
      console.error(`editSpreadsheet: Missing required fields for spreadsheetId=${spreadsheetId}: newSpreadsheetId=${newSpreadsheetId}, gid=${gid}, targetDomain=${targetDomain}, urlColumn=${urlColumn}, targetColumn=${targetColumn}, resultRangeStart=${resultRangeStart}, resultRangeEnd=${resultRangeEnd}, intervalHours=${intervalHours}`);
      return res.status(400).json({ error: 'All fields required' });
    }

    // Проверка на дубликаты (исключая текущую таблицу)
    const existingSpreadsheet = await Spreadsheet.findOne({
      spreadsheetId: newSpreadsheetId,
      gid: parseInt(gid),
      projectId: projectObjectId,
      _id: { $ne: spreadsheetObjectId },
    });
    if (existingSpreadsheet) {
      console.error(`editSpreadsheet: Duplicate spreadsheet detected: newSpreadsheetId=${newSpreadsheetId}, gid=${gid}, projectId=${projectId}`);
      return res.status(400).json({ error: 'Spreadsheet with this spreadsheetId and gid already exists in this project' });
    }

    // Проверка интервала
    const planIntervalLimits = {
      basic: 24,
      pro: 4,
      premium: 1,
      enterprise: 1,
    };
    const minInterval = user.isSuperAdmin ? 1 : planIntervalLimits[user.plan];
    if (parseInt(intervalHours) < minInterval) {
      console.error(`editSpreadsheet: Interval too short: ${intervalHours} hours, min=${minInterval} for plan=${user.plan}`);
      return res.status(403).json({ message: `Interval must be at least ${minInterval} hours for your plan` });
    }

    // Обновляем таблицу
    spreadsheet.spreadsheetId = newSpreadsheetId;
    spreadsheet.gid = parseInt(gid);
    spreadsheet.targetDomain = targetDomain;
    spreadsheet.urlColumn = urlColumn;
    spreadsheet.targetColumn = targetColumn;
    spreadsheet.resultRangeStart = resultRangeStart;
    spreadsheet.resultRangeEnd = resultRangeEnd;
    spreadsheet.intervalHours = parseInt(intervalHours);
    await spreadsheet.save();

    console.log(`editSpreadsheet: Successfully updated spreadsheetId=${spreadsheetId} to newSpreadsheetId=${newSpreadsheetId}, gid=${gid} for projectId=${projectId}, userId=${req.userId}`);
    res.json(spreadsheet);
  } catch (error) {
    console.error(`editSpreadsheet: Error for projectId=${projectId}, spreadsheetId=${spreadsheetId}, userId=${req.userId}: ${error.message}`);
    return res.status(500).json({ error: 'Error updating spreadsheet', details: error.message });
  }
};

// Остальные функции из исходного файла
const getSpreadsheets = async (req, res) => {
  const { projectId } = req.params;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const spreadsheets = await Spreadsheet.find({ projectId, userId: req.userId });
    res.json(spreadsheets);
  } catch (error) {
    console.error('getSpreadsheets: Error fetching spreadsheets', error);
    res.status(500).json({ error: 'Error fetching spreadsheets', details: error.message });
  }
};

const deleteSpreadsheet = async (req, res) => {
  const { projectId, spreadsheetId } = req.params;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.isSuperAdmin && user.plan === 'free') {
      return res.status(403).json({ message: 'Google Sheets integration is not available on Free plan' });
    }

    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const spreadsheet = await Spreadsheet.findOneAndDelete({ _id: spreadsheetId, projectId, userId: req.userId });
    if (!spreadsheet) return res.status(404).json({ error: 'Spreadsheet not found' });

    // Удаляем связанные FrontendLink записи
    await FrontendLink.deleteMany({
      spreadsheetId: spreadsheet.spreadsheetId,
      projectId,
    });
    console.log(`Deleted FrontendLinks for spreadsheet ${spreadsheetId}`);

    res.json({ message: 'Spreadsheet deleted' });
  } catch (error) {
    console.error('deleteSpreadsheet: Error deleting spreadsheet', error);
    res.status(500).json({ error: 'Error deleting spreadsheet', details: error.message });
  }
};

const analyzeSpreadsheet = async (spreadsheet, maxLinks, projectId, wss, taskId, userId) => {
  try {
    console.log(`analyzeSpreadsheet: Entering function for spreadsheet ${spreadsheet._id}, project ${projectId}, task ${taskId}`);
    console.log(`analyzeSpreadsheet: Received userId=${userId}, spreadsheet.userId=${spreadsheet.userId}, spreadsheetId=${spreadsheet._id}`);

    const existingSpreadsheet = await Spreadsheet.findOne({ _id: spreadsheet._id, userId: spreadsheet.userId, projectId: spreadsheet.projectId });
    if (!existingSpreadsheet) {
      console.error(`analyzeSpreadsheet: Spreadsheet ${spreadsheet._id} not found in database`);
      throw new Error('Spreadsheet not found');
    }

    console.log(`analyzeSpreadsheet: Cleaning up invalid FrontendLinks for spreadsheet ${spreadsheet._id}`);
    const invalidLinks = await FrontendLink.deleteMany({
      spreadsheetId: spreadsheet.spreadsheetId,
      $or: [
        { userId: { $exists: false } },
        { userId: null },
      ],
    });
    console.log(`analyzeSpreadsheet: Deleted ${invalidLinks.deletedCount} invalid FrontendLinks`);

    console.log(`analyzeSpreadsheet: Checking userId: userId=${userId}, spreadsheet.userId=${spreadsheet.userId}`);
    if (!userId && !spreadsheet.userId) {
      console.error(`analyzeSpreadsheet: userId is missing for spreadsheet ${spreadsheet._id}`);
      throw new Error('userId is required but missing');
    }
    const effectiveUserId = userId || spreadsheet.userId;
    console.log(`analyzeSpreadsheet: Computed effectiveUserId=${effectiveUserId}, type=${typeof effectiveUserId}`);
    if (!effectiveUserId || effectiveUserId === '' || effectiveUserId === null) {
      console.error(`analyzeSpreadsheet: effectiveUserId is invalid for spreadsheet ${spreadsheet._id}, userId=${userId}, spreadsheet.userId=${spreadsheet.userId}`);
      throw new Error('effectiveUserId is invalid (undefined, null, or empty)');
    }

    let finalUserId;
    console.log(`analyzeSpreadsheet: Starting ObjectId validation for effectiveUserId=${effectiveUserId}`);
    try {
      const isValidObjectId = mongoose.isValidObjectId(effectiveUserId);
      console.log(`analyzeSpreadsheet: mongoose.isValidObjectId returned ${isValidObjectId} for effectiveUserId=${effectiveUserId}`);
      if (isValidObjectId) {
        console.log(`analyzeSpreadsheet: effectiveUserId=${effectiveUserId} is a valid ObjectId`);
        finalUserId = mongoose.Types.ObjectId(effectiveUserId);
        console.log(`analyzeSpreadsheet: Converted effectiveUserId to ObjectId: ${finalUserId}`);
      } else {
        console.error(`analyzeSpreadsheet: effectiveUserId=${effectiveUserId} is not a valid ObjectId`);
        throw new Error('Invalid userId format: not a valid ObjectId');
      }
    } catch (error) {
      console.error(`analyzeSpreadsheet: Error during ObjectId validation for effectiveUserId=${effectiveUserId}: ${error.message}`);
      throw new Error(`ObjectId validation failed: ${error.message}`);
    }
    console.log(`analyzeSpreadsheet: Using userId=${finalUserId} for spreadsheet ${spreadsheet._id}`);

    const { links, sheetName } = await importFromGoogleSheets(
      spreadsheet.spreadsheetId,
      spreadsheet.targetDomain,
      spreadsheet.urlColumn,
      spreadsheet.targetColumn,
      spreadsheet.gid,
    );

    if (links.length > maxLinks) {
      throw new Error(`Link limit exceeded for your plan (${maxLinks} links)`);
    }

    const dbLinks = await Promise.all(
      links.map(async link => {
        console.log(`Creating FrontendLink for URL ${link.url} with userId=${finalUserId}`);
        const newLink = new FrontendLink({
          url: link.url,
          targetDomains: link.targetDomains,
          userId: finalUserId,
          projectId: spreadsheet.projectId,
          spreadsheetId: spreadsheet.spreadsheetId,
          source: 'google_sheets',
          status: 'pending',
          rowIndex: link.rowIndex,
          taskId,
        });
        console.log(`FrontendLink object before save: ${JSON.stringify(newLink.toObject())}`);
        await newLink.save();
        return newLink;
      })
    );

    const updatedLinks = await processLinksInBatches(dbLinks, 20, projectId, wss, spreadsheet.spreadsheetId, taskId);

    if (updatedLinks.length === 0) {
      console.log(`analyzeSpreadsheet: Analysis for spreadsheet ${spreadsheet._id} was cancelled`);
      return;
    }

    const updatedSpreadsheet = await Spreadsheet.findOneAndUpdate(
      { _id: spreadsheet._id, userId: finalUserId, projectId: spreadsheet.projectId },
      {
        $set: {
          links: updatedLinks.map(link => ({
            url: link.url,
            targetDomain: link.targetDomains.join(', '),
            status: link.status,
            responseCode: link.responseCode,
            isIndexable: link.isIndexable,
            canonicalUrl: link.canonicalUrl,
            rel: link.rel,
            linkType: link.linkType,
            lastChecked: link.lastChecked,
            rowIndex: link.rowIndex,
          })),
          gid: spreadsheet.gid,
        },
      },
      { new: true, runValidators: true },
    );

    if (!updatedSpreadsheet) {
      throw new Error('Spreadsheet not found during update');
    }

    // Сохраняем updatedLinks в базе данных FrontendLink
    await Promise.all(updatedLinks.map(async link => {
      await FrontendLink.findOneAndUpdate(
        { _id: link._id },
        {
          $set: {
            status: link.status,
            responseCode: link.responseCode,
            isIndexable: link.isIndexable,
            canonicalUrl: link.canonicalUrl,
            rel: link.rel,
            linkType: link.linkType,
            lastChecked: link.lastChecked,
            loadTime: link.loadTime,
            errorDetails: link.errorDetails,
            indexabilityStatus: link.indexabilityStatus,
            overallStatus: link.overallStatus,
            anchorText: link.anchorText,
          },
        },
        { new: true }
      );
    }));

    await exportLinksToGoogleSheetsBatch(
      spreadsheet.spreadsheetId,
      updatedLinks,
      spreadsheet.resultRangeStart,
      spreadsheet.resultRangeEnd,
      sheetName
    );

    await formatGoogleSheet(spreadsheet.spreadsheetId, Math.max(...updatedLinks.map(link => link.rowIndex)) + 1, spreadsheet.gid, spreadsheet.resultRangeStart, spreadsheet.resultRangeEnd);
  } catch (error) {
    if (error.name === 'DocumentNotFoundError') {
      console.log(`analyzeSpreadsheet: Document not found, likely cancelled for spreadsheet ${spreadsheet._id}`);
      return;
    }
    console.error(`Critical error in analyzeSpreadsheet for spreadsheet ${spreadsheet._id}:`, error);
    throw error;
  }
};

const runSpreadsheetAnalysis = async (req, res) => {
  const { projectId, spreadsheetId } = req.params;

  if (!req.userId) {
    console.error(`runSpreadsheetAnalysis: req.userId is missing, request headers: ${JSON.stringify(req.headers)}`);
    return res.status(401).json({ error: 'User authentication required: missing userId' });
  }

  console.log(`runSpreadsheetAnalysis: Starting for project ${projectId}, spreadsheet ${spreadsheetId}, userId=${req.userId}, type=${typeof req.userId}`);

  try {
    const user = await User.findById(req.userId);
    if (!user) {
      console.error(`runSpreadsheetAnalysis: User not found for userId=${req.userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.isSuperAdmin && user.plan === 'free') {
      console.log(`runSpreadsheetAnalysis: Google Sheets integration is not available on Free plan for user ${req.userId}`);
      return res.status(403).json({ message: 'Google Sheets integration is not available on Free plan' });
    }

    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) {
      console.error(`runSpreadsheetAnalysis: Project ${projectId} not found for user ${req.userId}`);
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.isAnalyzingSpreadsheet) {
      console.log(`runSpreadsheetAnalysis: Google Sheets analysis already in progress for project ${projectId}, rejecting request`);
      return res.status(409).json({ error: 'Google Sheets analysis is already in progress for this project' });
    }

    const spreadsheet = await Spreadsheet.findOne({ _id: spreadsheetId, projectId, userId: req.userId });
    if (!spreadsheet) {
      console.error(`runSpreadsheetAnalysis: Spreadsheet ${spreadsheetId} not found for project ${projectId}, user ${req.userId}`);
      return res.status(404).json({ error: 'Spreadsheet not found' });
    }

    const planLinkLimits = {
      basic: 1000,
      pro: 5000,
      premium: 10000,
      enterprise: 50000,
    };
    const maxLinks = user.isSuperAdmin ? 50000 : planLinkLimits[user.plan];

    console.log(`Adding runSpreadsheetAnalysis task to queue for spreadsheet ${spreadsheetId} in project ${projectId} with userId=${req.userId}`);

    if (user.activeTasks.has(projectId)) {
      console.log(`runSpreadsheetAnalysis: Found existing task for project ${projectId}, removing it`);
      await AnalysisTask.findByIdAndDelete(user.activeTasks.get(projectId));
      user.activeTasks.delete(projectId);
      await user.save();
    }

    const task = new AnalysisTask({
      projectId,
      userId: req.userId,
      type: 'runSpreadsheetAnalysis',
      status: 'pending',
      data: { userId: req.userId, spreadsheetId, maxLinks },
    });
    await task.save();

    user.activeTasks.set(projectId, task._id.toString());
    await user.save();
    console.log(`runSpreadsheetAnalysis: Updated activeTasks for user ${req.userId}, activeTasks: ${JSON.stringify(user.activeTasks)}`);

    await FrontendLink.updateMany(
      { projectId, userId: req.userId, spreadsheetId, source: 'google_sheets' },
      { $set: { taskId: task._id } }
    );
    console.log(`Updated FrontendLinks with taskId=${task._id} for spreadsheet ${spreadsheetId} in project ${projectId}`);

    analysisQueue.push({
      taskId: task._id,
      projectId,
      type: 'runSpreadsheetAnalysis',
      req,
      res,
      userId: req.userId,
      wss: req.wss,
      spreadsheetId,
      data: { userId: req.userId, spreadsheetId, maxLinks },
      handler: (task, callback) => {
        console.log(`runSpreadsheetAnalysis handler: Processing task ${task.taskId} for project ${task.projectId}, userId=${task.userId}, type=${typeof task.userId}`);
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
            cancelAnalysis.value = false;
            console.log(`runSpreadsheetAnalysis: Calling analyzeSpreadsheet with userId=${task.userId} for task ${task.taskId}`);
            return analyzeSpreadsheet(spreadsheet, task.data.maxLinks, task.projectId, task.wss, task.taskId, task.userId);
          })
          .then(() => {
            if (cancelAnalysis.value) {
              throw new Error('Analysis cancelled');
            }
            spreadsheet.status = 'completed';
            spreadsheet.lastRun = new Date();
            spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
            return spreadsheet.save();
          })
          .then(() => {
            console.log(`Finished spreadsheet analysis for spreadsheet ${spreadsheetId}`);
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
            console.error(`Error analyzing spreadsheet ${spreadsheetId} in project ${projectId}:`, error);
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
                .then(async () => {
                  console.log(`runSpreadsheetAnalysis handler: Set isAnalyzingSpreadsheet to false for project ${task.projectId}`);
                  const user = await User.findById(task.userId);
                  user.activeTasks.delete(projectId);
                  await user.save();
                })
                .catch(err => console.error(`Error setting isAnalyzingSpreadsheet to false for project ${task.projectId}:`, err));
            }
          });
      },
    });

    res.json({ taskId: task._id });
  } catch (error) {
    console.error('Error starting spreadsheet analysis:', error);
    res.status(500).json({ error: 'Failed to start spreadsheet analysis' });
  }
};

const cancelSpreadsheetAnalysis = async (req, res) => {
  const { projectId, spreadsheetId } = req.params;
  const userId = req.userId;

  try {
    const spreadsheet = await Spreadsheet.findOne({ _id: spreadsheetId, projectId, userId });
    if (!spreadsheet) {
      return res.status(404).json({ error: 'Spreadsheet not found' });
    }

    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.isAnalyzingSpreadsheet) {
      return res.status(400).json({ error: 'No Google Sheets analysis is currently running for this project' });
    }

    const task = await AnalysisTask.findOneAndUpdate(
      { projectId, status: { $in: ['pending', 'processing'] } },
      { $set: { status: 'cancelled', error: 'Analysis cancelled by user' } },
      { new: true }
    );

    if (!task) {
      return res.status(404).json({ error: 'No active task found to cancel' });
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    await FrontendLink.deleteMany({
      spreadsheetId: spreadsheet.spreadsheetId,
      projectId,
    });
    console.log(`Deleted all FrontendLinks for spreadsheet ${spreadsheetId}`);

    spreadsheet.status = 'pending';
    spreadsheet.lastRun = null;
    spreadsheet.scanCount = 0;
    await spreadsheet.save();

    project.isAnalyzingSpreadsheet = false;
    await project.save();

    const user = await User.findById(userId);
    user.activeTasks.delete(projectId);
    await user.save();

    res.json({ message: 'Analysis cancelled' });
  } catch (error) {
    console.error('Error cancelling spreadsheet analysis:', error);
    res.status(500).json({ error: 'Failed to cancel analysis' });
  }
};

const scheduleSpreadsheetAnalysis = async (spreadsheet) => {
  console.log(`Adding scheduleSpreadsheetAnalysis task to queue for spreadsheet ${spreadsheet.spreadsheetId} in project ${spreadsheet.projectId}`);

  return new Promise((resolve, reject) => {
    analysisQueue.push({
      projectId: spreadsheet.projectId,
      type: 'scheduleSpreadsheetAnalysis',
      req: null,
      res: null,
      handler: async () => {
        const project = await Project.findOne({ _id: spreadsheet.projectId });
        if (project.isAnalyzing) {
          console.log(`Analysis already in progress for project ${spreadsheet.projectId}, skipping spreadsheet ${spreadsheet.spreadsheetId}`);
          resolve();
          return;
        }

        if (!project.userId) {
          console.error(`scheduleSpreadsheetAnalysis: userId is missing in project ${spreadsheet.projectId}`);
          reject(new Error('userId is missing in project'));
          return;
        }
        const userId = project.userId;
        console.log(`scheduleSpreadsheetAnalysis: Using userId=${userId} for spreadsheet ${spreadsheet.spreadsheetId}`);

        project.isAnalyzing = true;
        await project.save();

        try {
          spreadsheet.status = 'checking';
          await spreadsheet.save();

          const maxLinks = 50000;
          await analyzeSpreadsheet(spreadsheet, maxLinks, spreadsheet.projectId, null, null, userId);
          spreadsheet.status = 'completed';
          spreadsheet.lastRun = new Date();
          spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
          await spreadsheet.save();
          console.log(`Finished scheduled spreadsheet analysis for spreadsheet ${spreadsheet.spreadsheetId}`);
          resolve();
        } catch (error) {
          console.error(`Error in scheduled analysis for spreadsheet ${spreadsheet.spreadsheetId}:`, error);
          spreadsheet.status = 'error';
          spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
          await spreadsheet.save();
          reject(error);
        } finally {
          project.isAnalyzing = false;
          await project.save();
        }
      },
    });
  });
};

const getActiveSpreadsheetTasks = async (req, res) => {
  const { projectId } = req.params;
  const userId = req.userId;

  try {
    const tasks = await AnalysisTask.find({
      projectId,
      userId,
      type: 'runSpreadsheetAnalysis',
      status: { $in: ['pending', 'processing'] },
    }).select('_id data.spreadsheetId progress processedLinks totalLinks estimatedTimeRemaining status');

    res.json(tasks.map(task => ({
      taskId: task._id,
      spreadsheetId: task.data.spreadsheetId,
      progress: task.progress || 0,
      processedLinks: task.processedLinks || 0,
      totalLinks: task.totalLinks || 0,
      estimatedTimeRemaining: task.estimatedTimeRemaining || 0,
      status: task.status || 'pending',
    })));
  } catch (error) {
    console.error('getActiveSpreadsheetTasks: Error fetching active spreadsheet tasks', error);
    res.status(500).json({ error: 'Error fetching active spreadsheet tasks', details: error.message });
  }
};

module.exports = {
  addSpreadsheet,
  editSpreadsheet,
  getSpreadsheets,
  deleteSpreadsheet,
  analyzeSpreadsheet,
  runSpreadsheetAnalysis,
  cancelSpreadsheetAnalysis,
  scheduleSpreadsheetAnalysis,
  getActiveSpreadsheetTasks,
};
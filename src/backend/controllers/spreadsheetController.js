const Spreadsheet = require('../models/Spreadsheet');
const User = require('../models/User');
const Project = require('../models/Project');
const AnalysisTask = require('../models/AnalysisTask');
const FrontendLink = require('../models/FrontendLink');
const mongoose = require('mongoose');
const { importFromGoogleSheets, exportLinksToGoogleSheetsBatch, formatGoogleSheet } = require('./googleSheetsUtils');
const { analysisQueue, cancelAnalysis, initQueue, triggerNextTask } = require('./taskQueue');
const { processLinksInBatches } = require('./linkAnalysisController');
const { scheduleJob, scheduledJobs } = require('node-schedule');

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
      return res.status(403).json({ error: 'Google Sheets integration is not available on Free plan' });
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
      return res.status(403).json({ error: 'Spreadsheet limit exceeded for your plan' });
    }

    if (!spreadsheetId || gid === undefined || gid === null || !targetDomain || !urlColumn || !targetColumn || !resultRangeStart || !resultRangeEnd || intervalHours === undefined) {
      console.error(`addSpreadsheet: Missing required fields for projectId=${projectId}: spreadsheetId=${spreadsheetId}, gid=${gid}, targetDomain=${targetDomain}, urlColumn=${urlColumn}, targetColumn=${targetColumn}, resultRangeStart=${resultRangeStart}, resultRangeEnd=${resultRangeEnd}, intervalHours=${intervalHours}`);
      return res.status(400).json({ error: 'All fields required' });
    }

    // Проверка интервала
    const validIntervals = [0.083, 0.5, 1, 4, 8, 12, 24, 72, 120, 240, 336, 672];
    const interval = parseFloat(intervalHours);
    console.log(`addSpreadsheet: Validating intervalHours=${interval} for projectId=${projectId}, userId=${req.userId}`);
    if (isNaN(interval) || !validIntervals.includes(interval)) {
      console.error(`addSpreadsheet: Invalid intervalHours=${interval}, must be one of ${validIntervals.join(', ')}`);
      return res.status(400).json({ error: `Interval must be one of ${validIntervals.join(', ')} hours` });
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

    const spreadsheet = new Spreadsheet({
      spreadsheetId,
      gid: parseInt(gid),
      targetDomain,
      urlColumn,
      targetColumn,
      resultRangeStart,
      resultRangeEnd,
      intervalHours: parseFloat(intervalHours),
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

    // Проверка интервала
    const validIntervals = [0.083, 0.5, 1, 4, 8, 12, 24, 72, 120, 240, 336, 672];
    const interval = parseFloat(intervalHours);
    console.log(`addSpreadsheet: Validating intervalHours=${interval} for projectId=${projectId}, userId=${req.userId}`);
    if (isNaN(interval) || !validIntervals.includes(interval)) {
      console.error(`addSpreadsheet: Invalid intervalHours=${interval}, must be one of ${validIntervals.join(', ')}`);
      return res.status(400).json({ error: `Interval must be one of ${validIntervals.join(', ')} hours` });
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

    // Обновляем таблицу
    spreadsheet.spreadsheetId = newSpreadsheetId;
    spreadsheet.gid = parseInt(gid);
    spreadsheet.targetDomain = targetDomain;
    spreadsheet.urlColumn = urlColumn;
    spreadsheet.targetColumn = targetColumn;
    spreadsheet.resultRangeStart = resultRangeStart;
    spreadsheet.resultRangeEnd = resultRangeEnd;
    spreadsheet.intervalHours = parseFloat(intervalHours);
    await spreadsheet.save();

    console.log(`editSpreadsheet: Successfully updated spreadsheetId=${spreadsheetId} to newSpreadsheetId=${newSpreadsheetId}, gid=${gid} for projectId=${projectId}, userId=${req.userId}`);
    res.json(spreadsheet);
  } catch (error) {
    console.error(`editSpreadsheet: Error for projectId=${projectId}, spreadsheetId=${spreadsheetId}, userId=${req.userId}: ${error.message}`);
    return res.status(500).json({ error: 'Error updating spreadsheet', details: error.message });
  }
};

// Функция получения списка таблиц
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

// Функция удаления таблицы
const deleteSpreadsheet = async (req, res) => {
  const { projectId, spreadsheetId } = req.params;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.isSuperAdmin && user.plan === 'free') {
      return res.status(403).json({ error: 'Google Sheets integration is not available on Free plan' });
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
    console.log(`deleteSpreadsheet: Deleted FrontendLinks for spreadsheet ${spreadsheetId}`);

    res.json({ message: 'Spreadsheet deleted' });
  } catch (error) {
    console.error('deleteSpreadsheet: Error deleting spreadsheet', error);
    res.status(500).json({ error: 'Error deleting spreadsheet', details: error.message });
  }
};

// Функция анализа таблицы
const analyzeSpreadsheet = async (spreadsheet, maxLinks, projectId, wss, taskId, userId, task) => {
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
        finalUserId = new mongoose.Types.ObjectId(effectiveUserId);
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

    // Обновляем общее количество ссылок в задаче
    await AnalysisTask.findByIdAndUpdate(task._id, {
      $set: { totalLinks: links.length }
    });
    console.log(`analyzeSpreadsheet: Updated task ${task._id} with totalLinks=${links.length}`);

    const dbLinks = await Promise.all(
      links.map(async link => {
        console.log(`analyzeSpreadsheet: Creating FrontendLink for URL ${link.url} with userId=${finalUserId}`);
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
        console.log(`analyzeSpreadsheet: FrontendLink object before save: ${JSON.stringify(newLink.toObject())}`);
        await newLink.save();
        return newLink;
      })
    );

    const updatedLinks = await processLinksInBatches(dbLinks, 20, projectId, wss, spreadsheet.spreadsheetId, taskId, async (processed, total) => {
      // Обновляем прогресс в задаче
      const progress = Math.round((processed / total) * 100);
      await AnalysisTask.findByIdAndUpdate(task._id, {
        $set: {
          progress,
          processedLinks: processed,
          estimatedTimeRemaining: Math.round(((total - processed) * 0.5) / 1000) // Примерно 0.5 сек на ссылку
        }
      });
      if (wss) {
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN && client.projectId === projectId) {
            client.send(JSON.stringify({
              type: 'progressUpdate',
              taskId,
              projectId,
              spreadsheetId: spreadsheet._id,
              progress,
              processedLinks: processed,
              totalLinks: total,
              estimatedTimeRemaining: Math.round(((total - processed) * 0.5) / 1000)
            }));
          }
        });
      }
      console.log(`analyzeSpreadsheet: Updated task ${task._id} progress: ${progress}%, processed: ${processed}/${total}`);
    });

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

    console.log(`analyzeSpreadsheet: Successfully completed analysis for spreadsheet ${spreadsheet._id}`);
  } catch (error) {
    if (error.name === 'DocumentNotFoundError') {
      console.log(`analyzeSpreadsheet: Document not found, likely cancelled for spreadsheet ${spreadsheet._id}`);
      return;
    }
    console.error(`analyzeSpreadsheet: Critical error for spreadsheet ${spreadsheet._id}: ${error.message}`);
    throw error;
  }
};

// Функция запуска анализа таблицы
const runSpreadsheetAnalysis = async (req, res) => {
  const { projectId, spreadsheetId } = req.params;

  console.log(`runSpreadsheetAnalysis: Starting for project ${projectId}, spreadsheet ${spreadsheetId}, userId=${req.userId}`);

  try {
    if (!req.userId) {
      console.error(`runSpreadsheetAnalysis: req.userId is missing, request headers: ${JSON.stringify(req.headers)}`);
      return res.status(401).json({ error: 'User authentication required: missing userId' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      console.error(`runSpreadsheetAnalysis: User not found for userId=${req.userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.isSuperAdmin && user.plan === 'free') {
      console.log(`runSpreadsheetAnalysis: Google Sheets integration not available on Free plan for user ${req.userId}`);
      return res.status(403).json({ error: 'Google Sheets integration is not available on Free plan' });
    }

    const projectObjectId = new mongoose.Types.ObjectId(projectId);
    const spreadsheetObjectId = new mongoose.Types.ObjectId(spreadsheetId);
    const project = await Project.findOne({ _id: projectObjectId, userId: req.userId });
    if (!project) {
      console.error(`runSpreadsheetAnalysis: Project ${projectId} not found for user ${req.userId}`);
      return res.status(404).json({ error: 'Project not found' });
    }

    const spreadsheet = await Spreadsheet.findOne({ _id: spreadsheetObjectId, projectId: projectObjectId, userId: req.userId });
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

    console.log(`runSpreadsheetAnalysis: Preparing task for spreadsheet ${spreadsheetId} in project ${projectId} with userId=${req.userId}`);

    // Проверяем и отменяем существующую задачу
    const existingTask = await AnalysisTask.findOne({ projectId, spreadsheetId, status: { $in: ['pending', 'processing'] } });
    if (existingTask) {
      console.log(`runSpreadsheetAnalysis: Found existing task ${existingTask._id} for project ${projectId}, spreadsheet ${spreadsheetId}, cancelling it`);
      await AnalysisTask.findByIdAndUpdate(
        existingTask._id,
        { $set: { status: 'cancelled', error: 'Replaced by new task', completedAt: new Date() } }
      );
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
    console.log(`runSpreadsheetAnalysis: Created task ${task._id} for spreadsheet ${spreadsheetId}`);

    user.activeTasks.set(projectId, task._id.toString());
    await user.save();
    console.log(`runSpreadsheetAnalysis: Updated activeTasks for user ${req.userId}, activeTasks: ${JSON.stringify([...user.activeTasks])}`);

    await FrontendLink.updateMany(
      { projectId, userId: req.userId, spreadsheetId, source: 'google_sheets' },
      { $set: { taskId: task._id } }
    );
    console.log(`runSpreadsheetAnalysis: Updated FrontendLinks with taskId=${task._id} for spreadsheet ${spreadsheetId} in project ${projectId}`);

    // Проверка очереди
    if (!analysisQueue || typeof analysisQueue.push !== 'function') {
      console.error(`runSpreadsheetAnalysis: analysisQueue not initialized for project ${projectId}, spreadsheet ${spreadsheetId}, reinitializing`);
      initQueue();
    }

    // Добавляем задачу в очередь
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
      handler: async (task, callback) => {
        console.log(`runSpreadsheetAnalysis handler: Processing task ${task.taskId} for project ${task.projectId}, spreadsheet ${task.spreadsheetId}, userId=${task.userId}`);
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
          console.log(`runSpreadsheetAnalysis handler: Set isAnalyzingSpreadsheet to true for project ${task.projectId}`);

          spreadsheet.status = 'checking';
          await spreadsheet.save();
          console.log(`runSpreadsheetAnalysis handler: Set spreadsheet ${task.spreadsheetId} status to checking`);

          cancelAnalysis.value = false;
          console.log(`runSpreadsheetAnalysis handler: Calling analyzeSpreadsheet with userId=${task.userId} for task ${task.taskId}`);
          await analyzeSpreadsheet(spreadsheet, task.data.maxLinks, task.projectId, task.wss, task.taskId, task.userId, task);

          if (cancelAnalysis.value) {
            throw new Error('Analysis cancelled');
          }

          spreadsheet.status = 'completed';
          spreadsheet.lastRun = new Date();
          spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
          await spreadsheet.save();
          console.log(`runSpreadsheetAnalysis handler: Set spreadsheet ${task.spreadsheetId} status to completed`);

          // Планируем следующий анализ
          console.log(`runSpreadsheetAnalysis handler: Scheduling next analysis for spreadsheet ${task.spreadsheetId}`);
          const { scheduleSpreadsheetAnalysis } = require('./spreadsheetController'); // Ленивый импорт
          await scheduleSpreadsheetAnalysis(spreadsheet);

          console.log(`runSpreadsheetAnalysis handler: Analysis completed for spreadsheet ${task.spreadsheetId}`);
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
          console.error(`runSpreadsheetAnalysis handler: Error analyzing spreadsheet ${task.spreadsheetId} in project ${task.projectId}: ${error.message}`);
          if (spreadsheet) {
            spreadsheet.status = error.message === 'Analysis cancelled' ? 'pending' : 'error';
            spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
            await spreadsheet.save();
            console.log(`runSpreadsheetAnalysis handler: Set spreadsheet ${task.spreadsheetId} status to ${spreadsheet.status}`);
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
            console.log(`runSpreadsheetAnalysis handler: Set isAnalyzingSpreadsheet to false for project ${task.projectId}`);
            const user = await User.findById(task.userId);
            if (user) {
              user.activeTasks.delete(task.projectId);
              await user.save();
              console.log(`runSpreadsheetAnalysis handler: Removed task ${task.taskId} from activeTasks for user ${task.userId}`);
            }
            // Запускаем следующую задачу
            triggerNextTask();
          }
        }
      },
    }, (err) => {
      if (err) {
        console.error(`runSpreadsheetAnalysis: Error queuing task ${task._id} for spreadsheet ${spreadsheetId}: ${err.message}`);
        res.status(500).json({ error: 'Failed to queue analysis task', details: err.message });
      } else {
        console.log(`runSpreadsheetAnalysis: Task ${task._id} successfully queued for spreadsheet ${spreadsheetId}`);
        res.json({ taskId: task._id });
        // Запускаем первую задачу, если очередь пуста
        if (analysisQueue.length() === 0) {
          console.log('runSpreadsheetAnalysis: Triggering next task since queue is empty');
          triggerNextTask();
        }
      }
    });
  } catch (error) {
    console.error(`runSpreadsheetAnalysis: Error for project ${projectId}, spreadsheet ${spreadsheetId}, userId=${req.userId}: ${error.message}`);
    res.status(500).json({ error: 'Failed to start spreadsheet analysis', details: error.message });
    try {
      initQueue();
      console.log(`runSpreadsheetAnalysis: Reinitialized queue for project ${projectId}, spreadsheet ${spreadsheetId}`);
      triggerNextTask(); // Проверяем очередь после реинициализации
    } catch (initError) {
      console.error(`runSpreadsheetAnalysis: Failed to reinitialize queue: ${initError.message}`);
    }
  }
};

// Функция планирования анализа
const scheduleSpreadsheetAnalysis = async (spreadsheet) => {
  const jobKey = `${spreadsheet.projectId}-${spreadsheet._id}`;
  console.log(`scheduleSpreadsheetAnalysis: Scheduling for spreadsheetId=${spreadsheet._id}, projectId=${spreadsheet.projectId}, intervalHours=${spreadsheet.intervalHours}`);

  try {
    // Удаляем старую задачу, если она существует
    if (scheduledJobs[jobKey]) {
      scheduledJobs[jobKey].cancel();
      console.log(`scheduleSpreadsheetAnalysis: Cancelled existing job ${jobKey}`);
    }

    // Определяем cron-выражение в зависимости от интервала
    const intervalHours = parseFloat(spreadsheet.intervalHours);
    console.log(`scheduleSpreadsheetAnalysis: Processing intervalHours=${intervalHours} for spreadsheetId=${spreadsheet._id}, projectId=${spreadsheet.projectId}`);
    let cronExpression;
    if (intervalHours < 1) {
      const intervalMinutes = Math.round(intervalHours * 60);
      cronExpression = `*/${intervalMinutes} * * * *`; // Например, */5 * * * * для 5 минут
    } else if (intervalHours <= 24) {
      cronExpression = `0 0 */${Math.round(intervalHours)} * * *`; // Часы
    } else {
      const intervalDays = Math.round(intervalHours / 24);
      cronExpression = `0 0 0 */${intervalDays} * *`; // Дни
    }
    console.log(`scheduleSpreadsheetAnalysis: Using cronExpression=${cronExpression} for job ${jobKey}`);

    // Планируем новую задачу
    const job = scheduleJob(jobKey, cronExpression, async () => {
      console.log(`scheduleSpreadsheetAnalysis: Executing job ${jobKey} for spreadsheetId=${spreadsheet._id}, projectId=${spreadsheet.projectId}`);
      let project;
      try {
        project = await Project.findOne({ _id: spreadsheet.projectId, userId: spreadsheet.userId });
        if (!project) {
          console.error(`scheduleSpreadsheetAnalysis: Project not found for projectId=${spreadsheet.projectId}, userId=${spreadsheet.userId}`);
          return;
        }

        const currentSpreadsheet = await Spreadsheet.findOne({ _id: spreadsheet._id, projectId: spreadsheet.projectId, userId: spreadsheet.userId });
        if (!currentSpreadsheet) {
          console.error(`scheduleSpreadsheetAnalysis: Spreadsheet not found for spreadsheetId=${spreadsheet._id}, projectId=${spreadsheet.projectId}`);
          return;
        }

        if (project.isAnalyzingSpreadsheet) {
          console.log(`scheduleSpreadsheetAnalysis: Analysis already in progress for project ${spreadsheet.projectId}, skipping spreadsheet ${spreadsheet._id}`);
          return;
        }

        const maxLinks = 50000;
        project.isAnalyzingSpreadsheet = true;
        await project.save();
        console.log(`scheduleSpreadsheetAnalysis: Set isAnalyzingSpreadsheet to true for project ${spreadsheet.projectId}`);

        currentSpreadsheet.status = 'checking';
        await currentSpreadsheet.save();
        console.log(`scheduleSpreadsheetAnalysis: Set spreadsheet ${spreadsheet._id} status to checking`);

        const task = new AnalysisTask({
          projectId: spreadsheet.projectId,
          userId: spreadsheet.userId,
          type: 'runSpreadsheetAnalysis',
          status: 'pending',
          data: { userId: spreadsheet.userId, spreadsheetId: spreadsheet._id, maxLinks },
        });
        await task.save();
        console.log(`scheduleSpreadsheetAnalysis: Created task ${task._id} for spreadsheet ${spreadsheet._id}`);

        const user = await User.findById(spreadsheet.userId);
        user.activeTasks.set(spreadsheet.projectId, task._id.toString());
        await user.save();
        console.log(`scheduleSpreadsheetAnalysis: Updated activeTasks for user ${spreadsheet.userId}, activeTasks: ${JSON.stringify([...user.activeTasks])}`);

        await FrontendLink.updateMany(
          { projectId: spreadsheet.projectId, userId: spreadsheet.userId, spreadsheetId: spreadsheet._id, source: 'google_sheets' },
          { $set: { taskId: task._id } }
        );
        console.log(`scheduleSpreadsheetAnalysis: Updated FrontendLinks with taskId=${task._id} for spreadsheet ${spreadsheet._id} in project ${spreadsheet.projectId}`);

        // Добавляем задачу в очередь
        analysisQueue.push({
          taskId: task._id,
          projectId: spreadsheet.projectId,
          type: 'runSpreadsheetAnalysis',
          req: null,
          res: null,
          userId: spreadsheet.userId,
          wss: null,
          spreadsheetId: spreadsheet._id,
          data: { userId: spreadsheet.userId, spreadsheetId: spreadsheet._id, maxLinks },
          handler: async (task, callback) => {
            console.log(`scheduleSpreadsheetAnalysis handler: Processing task ${task.taskId} for project ${task.projectId}, spreadsheet ${task.spreadsheetId}, userId=${task.userId}`);
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
              console.log(`scheduleSpreadsheetAnalysis handler: Set isAnalyzingSpreadsheet to true for project ${task.projectId}`);

              spreadsheet.status = 'checking';
              await spreadsheet.save();
              console.log(`scheduleSpreadsheetAnalysis handler: Set spreadsheet ${task.spreadsheetId} status to checking`);

              cancelAnalysis.value = false;
              console.log(`scheduleSpreadsheetAnalysis handler: Calling analyzeSpreadsheet with userId=${task.userId} for task ${task.taskId}`);
              await analyzeSpreadsheet(spreadsheet, task.data.maxLinks, task.projectId, task.wss, task.taskId, task.userId, task);

              if (cancelAnalysis.value) {
                throw new Error('Analysis cancelled');
              }

              spreadsheet.status = 'completed';
              spreadsheet.lastRun = new Date();
              spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
              await spreadsheet.save();
              console.log(`scheduleSpreadsheetAnalysis handler: Set spreadsheet ${task.spreadsheetId} status to completed`);

              console.log(`scheduleSpreadsheetAnalysis handler: Analysis completed for spreadsheet ${task.spreadsheetId}`);
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
              console.error(`scheduleSpreadsheetAnalysis handler: Error analyzing spreadsheet ${task.spreadsheetId} in project ${task.projectId}: ${error.message}`);
              if (spreadsheet) {
                spreadsheet.status = error.message === 'Analysis cancelled' ? 'pending' : 'error';
                spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
                await spreadsheet.save();
                console.log(`scheduleSpreadsheetAnalysis handler: Set spreadsheet ${task.spreadsheetId} status to ${spreadsheet.status}`);
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
                console.log(`scheduleSpreadsheetAnalysis handler: Set isAnalyzingSpreadsheet to false for project ${task.projectId}`);
                const user = await User.findById(task.userId);
                if (user) {
                  user.activeTasks.delete(task.projectId);
                  await user.save();
                  console.log(`scheduleSpreadsheetAnalysis handler: Removed task ${task.taskId} from activeTasks for user ${task.userId}`);
                }
                // Запускаем следующую задачу
                triggerNextTask();
              }
            }
          },
        }, (err) => {
          if (err) console.error(`scheduleSpreadsheetAnalysis: Error queuing task ${task._id} for spreadsheet ${spreadsheet._id}: ${err.message}`);
        });

        // Запускаем первую задачу, если очередь пуста
        if (analysisQueue.length() === 0) {
          console.log('scheduleSpreadsheetAnalysis: Triggering next task since queue is empty');
          triggerNextTask();
        }
      } catch (error) {
        console.error(`scheduleSpreadsheetAnalysis: Error for spreadsheet ${spreadsheet._id}: ${error.message}`);
        if (currentSpreadsheet) {
          currentSpreadsheet.status = 'error';
          currentSpreadsheet.scanCount = (currentSpreadsheet.scanCount || 0) + 1;
          await currentSpreadsheet.save();
          console.log(`scheduleSpreadsheetAnalysis: Set spreadsheet ${spreadsheet._id} status to error`);
        }
      } finally {
        if (project) {
          project.isAnalyzingSpreadsheet = false;
          await project.save();
          console.log(`scheduleSpreadsheetAnalysis: Set isAnalyzingSpreadsheet to false for project ${spreadsheet.projectId}`);
          // Запускаем следующую задачу
          triggerNextTask();
        }
      }
    });

    console.log(`scheduleSpreadsheetAnalysis: Scheduled job ${jobKey} for spreadsheet ${spreadsheet._id} with cron ${cronExpression}`);
  } catch (error) {
    console.error(`scheduleSpreadsheetAnalysis: Error scheduling job for spreadsheet ${spreadsheet._id}: ${error.message}`);
  }
};

// Функция отмены анализа таблицы
const cancelSpreadsheetAnalysis = async (req, res) => {
  const { projectId, spreadsheetId } = req.params;
  const userId = req.userId;

  console.log(`cancelSpreadsheetAnalysis: Received projectId=${projectId}, spreadsheetId=${spreadsheetId}, userId=${userId}`);

  try {
    const spreadsheet = await Spreadsheet.findOne({ _id: spreadsheetId, projectId, userId });
    if (!spreadsheet) {
      console.error(`cancelSpreadsheetAnalysis: Spreadsheet not found for spreadsheetId=${spreadsheetId}, projectId=${projectId}, userId=${userId}`);
      return res.status(404).json({ error: 'Spreadsheet not found' });
    }

    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      console.error(`cancelSpreadsheetAnalysis: Project not found for projectId=${projectId}, userId=${userId}`);
      return res.status(404).json({ error: 'Project not found' });
    }

    const task = await AnalysisTask.findOne({ projectId, spreadsheetId, status: { $in: ['pending', 'processing'] } });
    if (!task) {
      console.log(`cancelSpreadsheetAnalysis: No active task found for project ${projectId}, spreadsheet ${spreadsheetId}`);
      return res.status(404).json({ error: 'No active task found to cancel' });
    }

    await AnalysisTask.findOneAndUpdate(
      { _id: task._id },
      { $set: { status: 'cancelled', error: 'Analysis cancelled by user', completedAt: new Date() } }
    );
    console.log(`cancelSpreadsheetAnalysis: Cancelled task ${task._id} for spreadsheet ${spreadsheetId}`);

    cancelAnalysis.value = true;
    console.log(`cancelSpreadsheetAnalysis: Set cancelAnalysis.value to true for task ${task._id}`);

    await FrontendLink.deleteMany({
      spreadsheetId: spreadsheet.spreadsheetId,
      projectId,
    });
    console.log(`cancelSpreadsheetAnalysis: Deleted all FrontendLinks for spreadsheet ${spreadsheetId}`);

    spreadsheet.status = 'pending';
    spreadsheet.lastRun = null;
    spreadsheet.scanCount = 0;
    await spreadsheet.save();
    console.log(`cancelSpreadsheetAnalysis: Reset spreadsheet ${spreadsheetId} status to pending`);

    project.isAnalyzingSpreadsheet = false;
    await project.save();
    console.log(`cancelSpreadsheetAnalysis: Set isAnalyzingSpreadsheet to false for project ${projectId}`);

    const user = await User.findById(userId);
    user.activeTasks.delete(projectId);
    await user.save();
    console.log(`cancelSpreadsheetAnalysis: Removed task ${task._id} from activeTasks for user ${userId}`);

    res.json({ message: 'Analysis cancelled' });

    // Запускаем следующую задачу
    triggerNextTask();
  } catch (error) {
    console.error(`cancelSpreadsheetAnalysis: Error for projectId=${projectId}, spreadsheetId=${spreadsheetId}, userId=${userId}: ${error.message}`);
    res.status(500).json({ error: 'Failed to cancel analysis', details: error.message });
  }
};

// Функция получения активных задач
const getActiveSpreadsheetTasks = async (req, res) => {
  const { projectId } = req.params;
  const userId = req.userId;

  console.log(`getActiveSpreadsheetTasks: Received projectId=${projectId}, userId=${userId}`);

  try {
    const tasks = await AnalysisTask.find({
      projectId,
      userId,
      type: 'runSpreadsheetAnalysis',
      status: { $in: ['pending', 'processing'] },
    }).select('_id data.spreadsheetId progress processedLinks totalLinks estimatedTimeRemaining status');

    console.log(`getActiveSpreadsheetTasks: Found ${tasks.length} active tasks for project ${projectId}`);

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
    console.error(`getActiveSpreadsheetTasks: Error for projectId=${projectId}, userId=${userId}: ${error.message}`);
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
const async = require('async');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { URL } = require('url');
const dns = require('dns').promises;
const FrontendLink = require('../models/FrontendLink');
const Project = require('../models/Project');
const User = require('../models/User');
const AnalysisTask = require('../models/AnalysisTask');
const Spreadsheet = require('../models/Spreadsheet');
const { google } = require('googleapis');
const path = require('path');
const { calculateProgress } = require('../utils/calculateProgress'); // Новый импорт

const sheets = google.sheets({
  version: 'v4',
  auth: new google.auth.GoogleAuth({
    keyFile: path.resolve(__dirname, '../../../service-account.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  }),
});

let pLimit;
(async () => {
  const { default: pLimitModule } = await import('p-limit');
  pLimit = pLimitModule;
})();

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
          handler: async (task, callback) => {
            console.log(`checkLinks handler: Starting for task ${task.taskId}, userId=${task.userId}, type=${typeof task.userId}`);
            let project;
            try {
              project = await Project.findOne({ _id: task.projectId, userId: task.userId });
              if (!project) throw new Error('Project not found in handler');
              project.isAnalyzing = true;
              await project.save();

              await FrontendLink.updateMany({ projectId: task.projectId }, { $set: { status: 'checking' } });
              const updatedLinks = await processLinksInBatches(links, 20, task.projectId, task.wss, null, task.taskId);
              await Promise.all(updatedLinks.map(link => link.save()));
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
            } catch (error) {
              console.error(`Error in checkLinks for project ${task.projectId}:`, error);
              if (task.res && !task.res.headersSent) {
                task.res.status(500).json({ error: 'Error checking links', details: error.message });
              }
              callback(error);
            } finally {
              if (project) {
                project.isAnalyzing = false;
                await project.save();
                console.log(`checkLinks handler: Set isAnalyzing to false for project ${task.projectId}`);
              }
              const user = await User.findById(task.userId);
              if (user) {
                user.activeTasks.delete(task.projectId);
                await user.save();
                console.log(`Cleared active task for project ${task.projectId} from user ${task.userId}`);
              } else {
                console.error(`User ${task.userId} not found during cleanup in loadPendingTasks`);
              }
              await AnalysisTask.findByIdAndDelete(task.taskId);
              console.log(`Deleted AnalysisTask ${task.taskId} after completion`);
            }
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
          handler: async (task, callback) => {
            console.log(`loadPendingTasks handler: Processing runSpreadsheetAnalysis task ${task.taskId}, userId=${task.userId}`);
            let project;
            try {
              project = await Project.findOne({ _id: task.projectId, userId: task.userId });
              if (!project) throw new Error('Project not found in handler');
              project.isAnalyzing = true;
              await project.save();

              const spreadsheet = await Spreadsheet.findOne({ _id: task.data.spreadsheetId, projectId: task.projectId });
              if (!spreadsheet) throw new Error('Spreadsheet not found in handler');

              spreadsheet.status = 'checking';
              await spreadsheet.save();

              const maxLinks = task.data.maxLinks || 50000;
              await analyzeSpreadsheet(spreadsheet, maxLinks, task.projectId, task.wss, task.taskId, task.userId);

              spreadsheet.status = 'completed';
              spreadsheet.lastRun = new Date();
              spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
              await spreadsheet.save();
              console.log(`Finished spreadsheet analysis for spreadsheet ${task.data.spreadsheetId}`);

              const wssLocal = task.wss;
              if (wssLocal) {
                wssLocal.clients.forEach(client => {
                  if (client.readyState === WebSocket.OPEN && client.projectId === task.projectId) {
                    client.send(JSON.stringify({ type: 'analysisComplete', projectId: task.projectId, spreadsheetId: task.data.spreadsheetId }));
                  }
                });
              }
              callback(null);
            } catch (error) {
              console.error(`Error analyzing spreadsheet ${task.data.spreadsheetId} in project ${task.projectId}:`, error);
              if (spreadsheet) {
                spreadsheet.status = 'error';
                spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
                await spreadsheet.save();
              }
              callback(error);
            } finally {
              if (project) {
                project.isAnalyzing = false;
                await project.save();
                console.log(`runSpreadsheetAnalysis handler: Set isAnalyzing to false for project ${task.projectId}`);
              }
              const user = await User.findById(task.userId);
              if (user) {
                user.activeTasks.delete(task.projectId);
                await user.save();
                console.log(`Cleared active task for project ${task.projectId} from user ${task.userId}`);
              }
              await AnalysisTask.findByIdAndDelete(task.taskId);
              console.log(`Deleted AnalysisTask ${task.taskId} after completion`);
            }
          },
        });
      }
    }
  } catch (error) {
    console.error('loadPendingTasks: Error loading pending tasks:', error);
  }
};

const checkLinks = async (req, res) => {
  const { projectId } = req.params;
  const userId = req.userId;

  try {
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.isAnalyzing) {
      return res.status(409).json({ error: 'Analysis is already in progress for this project' });
    }

    const links = await FrontendLink.find({ projectId, userId });
    if (links.length === 0) {
      return res.status(400).json({ error: 'No links found to analyze' });
    }

    const task = new AnalysisTask({
      projectId,
      type: 'checkLinks',
      status: 'pending',
      data: { userId, projectId },
    });
    await task.save();

    const user = await User.findById(userId);
    user.activeTasks.set(projectId, task._id.toString());
    await user.save();

    await FrontendLink.updateMany(
      { projectId, userId, taskId: { $exists: false } },
      { $set: { taskId: task._id } }
    );
    console.log(`Updated FrontendLinks with taskId=${task._id} for project ${projectId}`);

    const updatedLinks = await FrontendLink.find({ projectId, userId });

    analysisQueue.push({
      taskId: task._id,
      projectId,
      type: 'checkLinks',
      req,
      res,
      userId,
      wss: req.wss,
      handler: async (task, callback) => {
        console.log(`checkLinks handler: Starting analysis for project ${projectId}`);
        let project;
        try {
          project = await Project.findOne({ _id: task.projectId, userId: task.userId });
          if (!project) throw new Error('Project not found in handler');
          project.isAnalyzing = true;
          await project.save();

          const processedLinks = await processLinksInBatches(updatedLinks, 20, projectId, task.wss, null, task.taskId);

          console.log(`Finished link check for project ${projectId}`);
          callback(null);
        } catch (error) {
          console.error(`Error in checkLinks for project ${projectId}:`, error);
          callback(error);
        } finally {
          if (project) {
            project.isAnalyzing = false;
            await project.save();
            console.log(`checkLinks handler: Set isAnalyzing to false for project ${projectId}`);
          }
          const user = await User.findById(task.userId);
          if (user) {
            user.activeTasks.delete(projectId);
            await user.save();
            console.log(`Cleared active task for project ${projectId} from user ${task.userId}`);
          } else {
            console.error(`User ${task.userId} not found during cleanup in checkLinks`);
          }
          await AnalysisTask.findByIdAndDelete(task.taskId);
          console.log(`Deleted AnalysisTask ${task.taskId} after completion`);
        }
      },
    });

    res.json({ taskId: task._id });
  } catch (error) {
    console.error('Error starting link check:', error);
    res.status(500).json({ error: 'Failed to start link check' });
  }
};

const runSpreadsheetAnalysis = async (req, res) => {
  const { projectId, spreadsheetId } = req.params;
  console.log(`runSpreadsheetAnalysis: Starting for project ${projectId}, spreadsheet ${spreadsheetId}, userId=${req.userId}, type=${typeof req.userId}`);

  if (!req.userId) {
    console.error(`runSpreadsheetAnalysis: req.userId is missing`);
    return res.status(401).json({ error: 'User authentication required' });
  }

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

  if (project.isAnalyzing) {
    console.log(`runSpreadsheetAnalysis: Analysis already in progress for project ${projectId}, rejecting request`);
    return res.status(409).json({ error: 'Analysis is already in progress for this project' });
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
    type: 'runSpreadsheetAnalysis',
    status: 'pending',
    data: { userId: req.userId, spreadsheetId, maxLinks },
  });
  await task.save();

  user.activeTasks.set(projectId, task._id.toString());
  await user.save();

  analysisQueue.push({
    taskId: task._id,
    projectId,
    type: 'runSpreadsheetAnalysis',
    req,
    res,
    userId: req.userId,
    wss: req.wss,
    spreadsheetId,
    handler: async (task, callback) => {
      console.log(`runSpreadsheetAnalysis handler: Processing task ${task.taskId} for project ${task.projectId}, userId=${task.userId}, type=${typeof task.userId}`);
      let project;
      try {
        project = await Project.findOne({ _id: task.projectId, userId: task.userId });
        if (!project) throw new Error('Project not found in handler');
        project.isAnalyzing = true;
        await project.save();

        const spreadsheet = await Spreadsheet.findOne({ _id: task.spreadsheetId, projectId: task.projectId });
        if (!spreadsheet) throw new Error('Spreadsheet not found in handler');

        spreadsheet.status = 'checking';
        await spreadsheet.save();

        await analyzeSpreadsheet(spreadsheet, task.data.maxLinks, task.projectId, task.wss, task.taskId, task.userId);

        spreadsheet.status = 'completed';
        spreadsheet.lastRun = new Date();
        spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
        await spreadsheet.save();

        console.log(`Finished spreadsheet analysis for spreadsheet ${spreadsheetId}`);
        if (!task.res.headersSent) {
          task.res.json({ message: 'Analysis completed' });
        }
        const wssLocal = task.wss;
        wssLocal.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN && client.projectId === task.projectId) {
            client.send(JSON.stringify({ type: 'analysisComplete', projectId: task.projectId, spreadsheetId: task.spreadsheetId }));
          }
        });
        callback(null);
      } catch (error) {
        if (error.name === 'DocumentNotFoundError') {
          console.log(`runSpreadsheetAnalysis: Analysis for spreadsheet ${spreadsheetId} was likely cancelled`);
          if (spreadsheet) {
            spreadsheet.status = 'pending';
            spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
            await spreadsheet.save();
          }
          if (!task.res.headersSent) {
            task.res.json({ message: 'Analysis cancelled' });
          }
          callback(null);
        } else {
          console.error(`Error analyzing spreadsheet ${spreadsheetId} in project ${projectId}:`, error);
          if (spreadsheet) {
            spreadsheet.status = 'error';
            spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
            await spreadsheet.save();
          }
          if (!task.res.headersSent) {
            task.res.status(500).json({ error: 'Error analyzing spreadsheet', details: error.message });
          }
          callback(error);
        }
      } finally {
        if (project) {
          project.isAnalyzing = false;
          await project.save();
          console.log(`runSpreadsheetAnalysis handler: Set isAnalyzing to false for project ${task.projectId}`);
        }
        const user = await User.findById(task.userId);
        if (user) {
          user.activeTasks.delete(projectId);
          await user.save();
          console.log(`Cleared active task for project ${projectId} from user ${task.userId}`);
        } else {
          console.error(`User ${task.userId} not found during cleanup in runSpreadsheetAnalysis`);
        }
        await AnalysisTask.findByIdAndDelete(task.taskId);
        console.log(`Deleted AnalysisTask ${task.taskId} after completion`);
      }
    },
  });

  res.json({ taskId: task._id });
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

    if (!project.isAnalyzing) {
      return res.status(400).json({ error: 'No analysis is currently running for this project' });
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

    project.isAnalyzing = false;
    await project.save();

    const user = await User.findById(userId);
    user.activeTasks.delete(projectId);
    await user.save();

    await AnalysisTask.findByIdAndDelete(task._id);
    console.log(`Deleted AnalysisTask ${task._id} after cancellation`);

    res.json({ message: 'Analysis cancelled' });
  } catch (error) {
    console.error('Error cancelling spreadsheet analysis:', error);
    res.status(500).json({ error: 'Failed to cancel analysis' });
  }
};

const processLinksInBatches = async (links, batchSize, projectId, wss, spreadsheetId = null, taskId = null) => {
  const updatedLinks = [];
  const limit = pLimit(5);

  const processBatch = async (batch) => {
    const batchPromises = batch.map(link => limit(async () => {
      try {
        const { responseCode, isIndexable, rel, linkType, canonicalUrl } = await analyzeLink(link.url);
        link.status = 'completed';
        link.responseCode = responseCode;
        link.isIndexable = isIndexable;
        link.rel = rel;
        link.linkType = linkType;
        link.canonicalUrl = canonicalUrl;

        if (link.targetDomains && link.targetDomains.length > 0) {
          const targetDomain = link.targetDomains[0];
          if (targetDomain) {
            const linkDomain = new URL(link.url).hostname;
            const targetDomainMatch = linkDomain === targetDomain || linkDomain.endsWith(`.${targetDomain}`);
            link.isTargetDomainMatch = targetDomainMatch;
          }
        }

        if (taskId) {
          const progressData = await calculateProgress(projectId, taskId, spreadsheetId);
          if (wss) {
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN && client.projectId === projectId) {
                client.send(JSON.stringify(progressData));
              }
            });
          }
        }

        await link.save();
        return link;
      } catch (error) {
        console.error(`Error analyzing link ${link.url}:`, error);
        link.status = 'error';
        link.error = error.message;
        await link.save();
        return link;
      }
    }));

    const batchResults = await Promise.all(batchPromises);
    updatedLinks.push(...batchResults);
  };

  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize);
    await processBatch(batch);
  }

  return updatedLinks;
};

const analyzeLink = async (url) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      timeout: 60000,
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setRequestInterception(true);

    page.on('request', request => {
      if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const responseCode = response.status();

    const content = await page.content();
    const $ = cheerio.load(content);

    const robotsMeta = $('meta[name="robots"]').attr('content') || '';
    const isIndexable = !robotsMeta.includes('noindex');

    const canonicalUrl = $('link[rel="canonical"]').attr('href') || null;

    let rel = 'not found';
    let linkType = null;
    $('a').each((i, element) => {
      const href = $(element).attr('href');
      if (href && href.includes(url)) {
        rel = $(element).attr('rel') || 'none';
        linkType = rel.includes('nofollow') ? 'nofollow' : 'dofollow';
        return false;
      }
    });

    return { responseCode, isIndexable, rel, linkType, canonicalUrl };
  } catch (error) {
    console.error(`Error analyzing link ${url}:`, error);
    return { responseCode: 'Error', isIndexable: null, rel: 'error', linkType: null, canonicalUrl: null, error: error.message };
  } finally {
    if (browser) await browser.close();
  }
};

const analyzeSpreadsheet = async (spreadsheet, maxLinks, projectId, wss, taskId, userId) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      timeout: 60000,
    });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: `${spreadsheet.gid}!${spreadsheet.urlColumn}2:${spreadsheet.urlColumn}${maxLinks + 1}`,
    });

    const rows = response.data.values || [];
    const urls = rows.map(row => row[0]).filter(url => url && typeof url === 'string' && url.trim());
    if (urls.length === 0) {
      console.log(`No URLs found in spreadsheet ${spreadsheet.spreadsheetId}`);
      return;
    }

    const project = await Project.findById(projectId);
    if (!project) throw new Error('Project not found');

    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const planLinkLimits = {
      basic: 1000,
      pro: 5000,
      premium: 10000,
      enterprise: 50000,
    };
    const linkLimit = user.isSuperAdmin ? 50000 : planLinkLimits[user.plan];
    if (urls.length > linkLimit) {
      throw new Error(`Too many links (${urls.length}). Your plan allows up to ${linkLimit} links.`);
    }

    const now = new Date();
    if (now.getMonth() !== user.lastReset.getMonth()) {
      user.linksCheckedThisMonth = 0;
      user.lastReset = now;
    }
    if (!user.isSuperAdmin && user.linksCheckedThisMonth + urls.length > linkLimit) {
      throw new Error('Link limit exceeded for your plan this month');
    }

    user.linksCheckedThisMonth += urls.length;
    await user.save();

    const links = [];
    for (const url of urls) {
      const link = new FrontendLink({
        url,
        targetDomains: [spreadsheet.targetDomain],
        projectId,
        userId,
        spreadsheetId: spreadsheet.spreadsheetId,
        source: 'spreadsheet',
        status: 'pending',
      });
      if (taskId) link.taskId = taskId;
      await link.save();
      links.push(link);
    }

    project.links.push(...links.map(link => link._id));
    await project.save();

    const updatedLinks = await processLinksInBatches(links, 20, projectId, wss, spreadsheet.spreadsheetId, taskId);

    const results = updatedLinks.map(link => {
      const isOk = link.responseCode === '200' &&
                   link.isIndexable === true &&
                   link.rel !== 'not found' &&
                   (link.linkType === 'dofollow' || link.linkType === 'nofollow');
      const canonicalMismatch = link.canonicalUrl && link.url.toLowerCase().replace(/\/$/, '') !== link.canonicalUrl.toLowerCase().replace(/\/$/, '');
      return [
        link.responseCode || 'N/A',
        link.isIndexable === null ? 'Unknown' : link.isIndexable ? 'Yes' : 'No',
        link.rel || 'none',
        link.linkType || 'not found',
        isOk ? (canonicalMismatch ? 'Warning' : 'OK') : 'Problem',
      ];
    });

    const resultRange = `${spreadsheet.gid}!${spreadsheet.resultRangeStart}2:${spreadsheet.resultRangeEnd}${urls.length + 1}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheet.spreadsheetId,
      range: resultRange,
      valueInputOption: 'RAW',
      resource: { values: results },
    });

    console.log(`Updated Google Sheet ${spreadsheet.spreadsheetId} with analysis results`);
  } catch (error) {
    console.error(`Error analyzing spreadsheet ${spreadsheet.spreadsheetId}:`, error);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
};

module.exports = {
  loadPendingTasks,
  checkLinks,
  runSpreadsheetAnalysis,
  cancelSpreadsheetAnalysis,
  processLinksInBatches,
  analyzeLink,
  analyzeSpreadsheet,
  analysisQueue,
};
const FrontendLink = require('../models/FrontendLink');
const Spreadsheet = require('../models/Spreadsheet');
const User = require('../models/User');
const Project = require('../models/Project');
const AnalysisTask = require('../models/AnalysisTask');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { Solver } = require('2captcha');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { google } = require('googleapis');
const path = require('path');
const async = require('async');
const { URL } = require('url');
const dns = require('dns').promises;
//const { wss } = require('../server');

let pLimit;
(async () => {
  const { default: pLimitModule } = await import('p-limit');
  pLimit = pLimitModule;
})();

const MAX_CONCURRENT_ANALYSES = 2;
const analysisQueue = async.queue((task, callback) => {
  console.log(`Starting queued analysis for project ${task.projectId}, type: ${task.type}`);
  if (typeof task.handler !== 'function') {
    console.error(`Handler is not a function for task type ${task.type}`);
    return callback(new Error('Handler is not a function'));
  }

  // Обновляем статус задачи на 'processing'
  AnalysisTask.findOneAndUpdate(
    { _id: task.taskId, status: 'pending' },
    { $set: { status: 'processing' } },
    { new: true }
  ).then(() => {
    task.handler(task, (err, result) => {
      if (err) {
        console.error(`Error in queued analysis for project ${task.projectId}, type: ${task.type}:`, err);
        // Обновляем статус на 'failed'
        AnalysisTask.findOneAndUpdate(
          { _id: task.taskId },
          { $set: { status: 'failed', error: err.message } }
        ).then(() => callback(err));
        return;
      }
      console.log(`Finished queued analysis for project ${task.projectId}, type: ${task.type}`);
      // Обновляем статус на 'completed'
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
            let project;
            Project.findOne({ _id: task.projectId, userId: task.userId })
              .then(proj => {
                if (!proj) throw new Error('Project not found in handler');
                project = proj;
                project.isAnalyzing = true;
                return project.save();
              })
              .then(() => FrontendLink.updateMany({ projectId: task.projectId }, { $set: { status: 'checking' } }))
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
                  project.isAnalyzing = false;
                  project.save()
                    .then(() => console.log(`checkLinks handler: Set isAnalyzing to false for project ${task.projectId}`))
                    .catch(err => console.error(`Error setting isAnalyzing to false for project ${task.projectId}:`, err));
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
        analysisQueue.push({
          taskId: task._id,
          projectId: task.projectId,
          type: task.type,
          req: null,
          res: null,
          userId: task.data.userId,
          wss: null,
          spreadsheetId: task.data.spreadsheetId,
          handler: (task, callback) => {
            let project;
            Project.findOne({ _id: task.projectId, userId: task.userId })
              .then(proj => {
                if (!proj) throw new Error('Project not found in handler');
                project = proj;
                project.isAnalyzing = true;
                return project.save();
              })
              .then(() => {
                spreadsheet.status = 'checking';
                return spreadsheet.save();
              })
              .then(() => {
                cancelAnalysis = false;
                return analyzeSpreadsheet(spreadsheet, task.data.maxLinks, task.projectId, task.wss, task.taskId);
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
                  project.isAnalyzing = false;
                  project.save()
                    .then(() => console.log(`runSpreadsheetAnalysis handler: Set isAnalyzing to false for project ${task.projectId}`))
                    .catch(err => console.error(`Error setting isAnalyzing to false for project ${task.projectId}:`, err));
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

// Вызываем при старте сервера
loadPendingTasks();

const solver = new Solver(process.env.TWOCAPTCHA_API_KEY);
const JWT_SECRET = process.env.JWT_SECRET;

const sheets = google.sheets({
  version: 'v4',
  auth: new google.auth.GoogleAuth({
    keyFile: path.resolve(__dirname, '../../../service-account.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  }),
});

const initializeBrowser = async () => {
  console.log('Initializing new browser for task...');
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1920,1080',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote',
      '--disable-accelerated-2d-canvas',
    ],
    ignoreHTTPSErrors: true,
    timeout: 60000,
  });
  console.log('New browser initialized');
  return browser;
};

const closeBrowser = async (browser) => {
  if (browser) {
    await browser.close();
    console.log('Browser closed');
  }
};

const restartBrowser = async () => {
  console.log('Restarting global browser due to error...');
  await closeBrowser();
  return await initializeBrowser();
};

const authMiddleware = (req, res, next) => {
  let token = req.headers.authorization?.split(' ')[1]; // Проверяем заголовок Authorization: Bearer <token>
  if (!token) {
    token = req.query.token; // Если в заголовке нет, проверяем query-параметр token
  }

  if (!token) {
    console.log('authMiddleware: No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    console.log('authMiddleware: Invalid token', error.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const superAdminMiddleware = async (req, res, next) => {
  const user = await User.findById(req.userId);
  if (!user || !user.isSuperAdmin) {
    console.log(`superAdminMiddleware: Access denied for user ${req.userId}`);
    return res.status(403).json({ error: 'SuperAdmin access required' });
  }
  next();
};

const registerUser = async (req, res) => {
  const { username, password, isSuperAdmin } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const user = new User({
      username,
      password,
      isSuperAdmin: isSuperAdmin || false,
      plan: isSuperAdmin ? 'enterprise' : 'free',
      subscriptionStatus: isSuperAdmin ? 'active' : 'inactive',
    });
    await user.save();
    res.status(201).json({ message: 'User registered', userId: user._id });
  } catch (error) {
    console.error('registerUser: Error registering user', error);
    res.status(400).json({ error: 'Username taken or invalid data' });
  }
};

const loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!JWT_SECRET) {
      console.error('loginUser: JWT_SECRET is not defined');
      return res.status(500).json({ error: 'Server configuration error', details: 'JWT_SECRET is not defined' });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, isSuperAdmin: user.isSuperAdmin, plan: user.plan });
  } catch (error) {
    console.error('loginUser: Error logging in', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Login failed', details: error.message });
    }
  }
};

const getUserInfo = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    console.error('getUserInfo: Error fetching user info', error);
    res.status(500).json({ error: 'Error fetching user info', details: error.message });
  }
};

// Функции для работы с проектами
const createProject = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });

  try {
    const project = new Project({
      name,
      userId: req.userId,
      links: [],
    });
    await project.save();
    res.status(201).json(project);
  } catch (error) {
    console.error('createProject: Error creating project', error);
    res.status(500).json({ error: 'Error creating project', details: error.message });
  }
};

const getProjects = async (req, res) => {
  try {
    const projects = await Project.find({ userId: req.userId });
    res.json(projects);
  } catch (error) {
    console.error('getProjects: Error fetching projects', error);
    res.status(500).json({ error: 'Error fetching projects', details: error.message });
  }
};

const deleteProject = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    await FrontendLink.deleteMany({ projectId });
    await Spreadsheet.deleteMany({ projectId });
    await Project.deleteOne({ _id: projectId, userId: req.userId });
    res.json({ message: 'Project deleted' });
  } catch (error) {
    console.error('deleteProject: Error deleting project', error);
    res.status(500).json({ error: 'Error deleting project', details: error.message });
  }
};

// Функции для работы с ссылками (в рамках проекта)
const addLinks = async (req, res) => {
  const { projectId } = req.params;
  const linksData = Array.isArray(req.body) ? req.body : [req.body];
  if (!linksData.every(item => item && typeof item.url === 'string' && item.url.trim() && item.targetDomain)) {
    return res.status(400).json({ error: 'Each item must have a valid url (non-empty string) and targetDomain' });
  }

  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const now = new Date();
    if (now.getMonth() !== user.lastReset.getMonth()) {
      user.linksCheckedThisMonth = 0;
      user.lastReset = now;
    }

    const planLimits = {
      free: 100,
      basic: 10000,
      pro: 50000,
      premium: 200000,
      enterprise: Infinity,
    };
    const newLinksCount = linksData.length;
    if (!user.isSuperAdmin && user.linksCheckedThisMonth + newLinksCount > planLimits[user.plan]) {
      return res.status(403).json({ message: 'Link limit exceeded for your plan' });
    }

    const newLinks = [];
    for (const { url, targetDomain } of linksData) {
      const newLink = new FrontendLink({ 
        url, 
        targetDomains: [targetDomain],
        projectId, 
        userId: req.userId,
        source: 'manual', // Указываем источник
        status: 'pending' 
      });
      await newLink.save();
      newLinks.push(newLink);
    }

    project.links.push(...newLinks.map(link => link._id));
    await project.save();

    user.linksCheckedThisMonth += newLinksCount;
    await user.save();
    res.status(201).json(newLinks);
  } catch (error) {
    console.error('addLinks: Error adding links', error);
    res.status(500).json({ error: 'Error adding links', details: error.message });
  }
};

const getLinks = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const links = await FrontendLink.find({ projectId, source: 'manual' }); // Фильтруем по source
    res.json(links);
  } catch (error) {
    console.error('getLinks: Error fetching links', error);
    res.status(500).json({ error: 'Error fetching links', details: error.message });
  }
};

const deleteLink = async (req, res) => {
  const { projectId, id } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const deletedLink = await FrontendLink.findOneAndDelete({ _id: id, projectId });
    if (!deletedLink) return res.status(404).json({ error: 'Link not found' });

    project.links = project.links.filter(linkId => linkId.toString() !== id);
    await project.save();

    res.json({ message: 'Link deleted' });
  } catch (error) {
    console.error('deleteLink: Error deleting link', error);
    res.status(500).json({ error: 'Error deleting link', details: error.message });
  }
};

const deleteAllLinks = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    await FrontendLink.deleteMany({ projectId });
    project.links = [];
    await project.save();

    res.json({ message: 'All links deleted' });
  } catch (error) {
    console.error('deleteAllLinks: Error deleting all links', error);
    res.status(500).json({ error: 'Error deleting all links', details: error.message });
  }
};

const checkLinks = async (req, res) => {
  const { projectId } = req.params;
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const project = await Project.findOne({ _id: projectId, userId: req.userId });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (project.isAnalyzing) {
    console.log(`checkLinks: Analysis already in progress for project ${projectId}, rejecting request`);
    return res.status(409).json({ error: 'Analysis is already in progress for this project' });
  }

  const links = await FrontendLink.find({ projectId, source: 'manual' });

  const planLinkCheckLimits = {
    free: 20,
    basic: 50,
    pro: 100,
    premium: 200,
    enterprise: 500,
  };
  const maxLinksToCheck = user.isSuperAdmin ? planLinkCheckLimits.enterprise : planLinkCheckLimits[user.plan];
  if (links.length > maxLinksToCheck) {
    return res.status(403).json({ error: `Too many links to check at once. Your plan allows checking up to ${maxLinksToCheck} links at a time.` });
  }

  console.log(`Adding checkLinks task to queue for project ${projectId} with ${links.length} links`);

  const task = new AnalysisTask({
    projectId,
    type: 'checkLinks',
    status: 'pending',
    data: { userId: req.userId },
  });
  await task.save();

  analysisQueue.push({
    taskId: task._id,
    projectId,
    type: 'checkLinks',
    req,
    res,
    userId: req.userId,
    wss: req.wss,
    handler: (task, callback) => {
      console.log(`checkLinks handler: Starting analysis for project ${task.projectId}`);
      let project;
      Project.findOne({ _id: task.projectId, userId: task.userId })
        .then(proj => {
          if (!proj) throw new Error('Project not found in handler');
          project = proj;
          project.isAnalyzing = true;
          return project.save();
        })
        .then(() => FrontendLink.updateMany({ projectId: task.projectId }, { $set: { status: 'checking' } }))
        .then(() => processLinksInBatches(links, 20, task.projectId, task.wss, null, task.taskId))
        .then(updatedLinks => Promise.all(updatedLinks.map(link => link.save())))
        .then(updatedLinks => {
          console.log(`Finished link check for project ${task.projectId}`);
          if (!task.res.headersSent) {
            task.res.json(updatedLinks);
          }
          const wssLocal = task.wss;
          wssLocal.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.projectId === task.projectId) {
              client.send(JSON.stringify({ type: 'analysisComplete', projectId: task.projectId }));
            }
          });
          callback(null, updatedLinks);
        })
        .catch(error => {
          console.error(`Error in checkLinks for project ${task.projectId}:`, error);
          if (!task.res.headersSent) {
            task.res.status(500).json({ error: 'Error checking links', details: error.message });
          }
          callback(error);
        })
        .finally(() => {
          if (project) {
            project.isAnalyzing = false;
            project.save()
              .then(() => console.log(`checkLinks handler: Set isAnalyzing to false for project ${task.projectId}`))
              .catch(err => console.error(`Error setting isAnalyzing to false for project ${task.projectId}:`, err));
          }
        });
    },
  });
};

// Функции для работы с Google Sheets (в рамках проекта)
const addSpreadsheet = async (req, res) => {
  const { projectId } = req.params;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.isSuperAdmin && user.plan === 'free') {
      return res.status(403).json({ message: 'Google Sheets integration is not available on Free plan' });
    }

    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const spreadsheets = await Spreadsheet.find({ projectId, userId: user.id });
    const planLimits = {
      basic: 1,
      pro: 5,
      premium: 20,
      enterprise: Infinity,
    };
    const maxSpreadsheets = user.isSuperAdmin ? Infinity : planLimits[user.plan];
    if (spreadsheets.length >= maxSpreadsheets) {
      return res.status(403).json({ message: 'Spreadsheet limit exceeded for your plan' });
    }

    const { spreadsheetId, gid, targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours } = req.body;
    if (!spreadsheetId || gid === undefined || gid === null || !targetDomain || !urlColumn || !targetColumn || !resultRangeStart || !resultRangeEnd || intervalHours === undefined) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const planIntervalLimits = {
      basic: 24,
      pro: 4,
      premium: 1,
      enterprise: 1,
    };
    const minInterval = user.isSuperAdmin ? 1 : planIntervalLimits[user.plan];
    if (parseInt(intervalHours) < minInterval) {
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
      projectId,
      status: 'pending',
    });
    await spreadsheet.save();
    res.status(201).json(spreadsheet);
  } catch (error) {
    console.error('addSpreadsheet: Error adding spreadsheet', error);
    res.status(500).json({ error: 'Error adding spreadsheet', details: error.message });
  }
};

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
    res.json({ message: 'Spreadsheet deleted' });
  } catch (error) {
    console.error('deleteSpreadsheet: Error deleting spreadsheet', error);
    res.status(500).json({ error: 'Error deleting spreadsheet', details: error.message });
  }
};

let cancelAnalysis = false;

const runSpreadsheetAnalysis = async (req, res) => {
  const { projectId, spreadsheetId } = req.params;
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.isSuperAdmin && user.plan === 'free') {
    return res.status(403).json({ message: 'Google Sheets integration is not available on Free plan' });
  }

  const project = await Project.findOne({ _id: projectId, userId: req.userId });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (project.isAnalyzing) {
    console.log(`runSpreadsheetAnalysis: Analysis already in progress for project ${projectId}, rejecting request`);
    return res.status(409).json({ error: 'Analysis is already in progress for this project' });
  }

  const spreadsheet = await Spreadsheet.findOne({ _id: spreadsheetId, projectId, userId: req.userId });
  if (!spreadsheet) return res.status(404).json({ error: 'Spreadsheet not found' });

  const planLinkLimits = {
    basic: 1000,
    pro: 5000,
    premium: 10000,
    enterprise: 50000,
  };
  const maxLinks = user.isSuperAdmin ? 50000 : planLinkLimits[user.plan];

  console.log(`Adding runSpreadsheetAnalysis task to queue for spreadsheet ${spreadsheetId} in project ${projectId}`);

  const task = new AnalysisTask({
    projectId,
    type: 'runSpreadsheetAnalysis',
    status: 'pending',
    data: { userId: req.userId, spreadsheetId, maxLinks },
  });
  await task.save();

  // Сохраняем taskId в activeTasks пользователя
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
    handler: (task, callback) => {
      let project;
      Project.findOne({ _id: task.projectId, userId: task.userId })
        .then(proj => {
          if (!proj) throw new Error('Project not found in handler');
          project = proj;
          project.isAnalyzing = true;
          return project.save();
        })
        .then(() => {
          spreadsheet.status = 'checking';
          return spreadsheet.save();
        })
        .then(() => {
          cancelAnalysis = false;
          return analyzeSpreadsheet(spreadsheet, maxLinks, task.projectId, task.wss, task.taskId);
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
        })
        .catch(error => {
          console.error(`Error analyzing spreadsheet ${spreadsheetId} in project ${projectId}:`, error);
          spreadsheet.status = error.message === 'Analysis cancelled' ? 'pending' : 'error';
          spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
          spreadsheet.save()
            .then(() => {
              if (!task.res.headersSent) {
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
            project.isAnalyzing = false;
            project.save()
              .then(async () => {
                console.log(`runSpreadsheetAnalysis handler: Set isAnalyzing to false for project ${task.projectId}`);
                // Удаляем taskId из activeTasks после завершения
                const user = await User.findById(task.userId);
                user.activeTasks.delete(projectId);
                await user.save();
              })
              .catch(err => console.error(`Error setting isAnalyzing to false for project ${task.projectId}:`, err));
          }
        });
    },
  });

  res.json({ taskId: task._id });
};

const cancelSpreadsheetAnalysis = async (req, res) => {
  const { projectId, spreadsheetId } = req.params;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.isSuperAdmin && user.plan === 'free') {
      return res.status(403).json({ message: 'Google Sheets integration is not available on Free plan' });
    }

    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const spreadsheet = await Spreadsheet.findOne({ _id: spreadsheetId, projectId, userId: req.userId });
    if (!spreadsheet) return res.status(404).json({ error: 'Spreadsheet not found' });

    if (spreadsheet.status !== 'checking') {
      return res.status(400).json({ error: 'No analysis in progress to cancel' });
    }

    cancelAnalysis = true;

    spreadsheet.status = 'pending';
    spreadsheet.links = [];
    await spreadsheet.save();

    project.isAnalyzing = false;
    await project.save();

    // Удаляем taskId из activeTasks
    user.activeTasks.delete(projectId);
    await user.save();

    res.json({ message: 'Analysis cancelled and data cleared' });
  } catch (error) {
    console.error('cancelSpreadsheetAnalysis: Error cancelling analysis', error);
    res.status(500).json({ error: 'Error cancelling analysis', details: error.message });
  }
};

// Функции для профиля и подписки
const selectPlan = async (req, res) => {
  const { plan } = req.body;
  const validPlans = ['free', 'basic', 'pro', 'premium', 'enterprise'];
  if (!validPlans.includes(plan)) {
    return res.status(400).json({ message: 'Invalid plan' });
  }

  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isSuperAdmin) {
      return res.status(403).json({ message: 'SuperAdmin cannot change plan' });
    }
    user.plan = plan;
    user.subscriptionStatus = 'pending';
    await user.save();
    res.json({ message: 'Plan selected, please proceed to payment' });
  } catch (error) {
    console.error('selectPlan: Error selecting plan', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const processPayment = async (req, res) => {
  const { cardNumber, cardHolder, expiryDate, cvv, autoPay } = req.body;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.isSuperAdmin) {
      return res.status(403).json({ message: 'SuperAdmin does not need to pay' });
    }

    if (cardNumber && cardHolder && expiryDate && cvv) {
      user.paymentDetails = { cardNumber, cardHolder, expiryDate, cvv };
    }
    user.autoPay = autoPay || false;
    if (user.subscriptionStatus === 'pending') {
      user.subscriptionStatus = 'active';
      user.subscriptionEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    await user.save();
    res.json({ message: user.subscriptionStatus === 'pending' ? 'Payment successful, plan activated' : 'Payment details updated' });
  } catch (error) {
    console.error('processPayment: Error processing payment', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const cancelSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isSuperAdmin) {
      return res.status(403).json({ message: 'SuperAdmin cannot cancel subscription' });
    }

    const projects = await Project.find({ userId: req.userId });
    const projectIds = projects.map(project => project._id);
    const spreadsheets = await Spreadsheet.find({ projectId: { $in: projectIds } });
    for (const spreadsheet of spreadsheets) {
      spreadsheet.status = 'inactive';
      await spreadsheet.save();
    }
    await Spreadsheet.deleteMany({ projectId: { $in: projectIds } });

    user.plan = 'free';
    user.subscriptionStatus = 'inactive';
    user.subscriptionEnd = null;
    user.autoPay = false;
    await user.save();
    res.json({ message: 'Subscription cancelled, reverted to Free plan' });
  } catch (error) {
    console.error('cancelSubscription: Error cancelling subscription', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const deleteAccount = async (req, res) => {
  try {
    if (!req.userId) {
      console.error('deleteAccount: req.userId is undefined');
      return res.status(400).json({ error: 'User ID is missing' });
    }

    console.log(`deleteAccount: Starting account deletion for user ${req.userId}`);
    const user = await User.findById(req.userId);
    if (!user) {
      console.error(`deleteAccount: User not found for ID ${req.userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.isSuperAdmin) {
      console.log(`deleteAccount: Attempt to delete SuperAdmin account (ID: ${req.userId})`);
      return res.status(403).json({ message: 'SuperAdmin cannot delete their account' });
    }

    console.log(`deleteAccount: Deleting Projects, FrontendLinks, and Spreadsheets for user ${req.userId}`);
    const projects = await Project.find({ userId: req.userId });
    const projectIds = projects.map(project => project._id);
    await FrontendLink.deleteMany({ projectId: { $in: projectIds } });
    await Spreadsheet.deleteMany({ projectId: { $in: projectIds } });
    await Project.deleteMany({ userId: req.userId });

    console.log(`deleteAccount: Deleting user ${req.userId}`);
    const userDeleteResult = await User.findByIdAndDelete(req.userId);
    if (!userDeleteResult) {
      console.error(`deleteAccount: Failed to delete user ${req.userId}, user not found`);
      return res.status(404).json({ error: 'User not found during deletion' });
    }

    console.log(`deleteAccount: Account deleted successfully for user ${req.userId}`);
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error(`deleteAccount: Error deleting account for user ${req.userId}:`, error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.profile = req.body;
    await user.save();
    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('updateProfile: Error updating profile', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const checkLinkStatus = async (link, browser) => {
  let page;
  let attempt = 0;
  const maxAttempts = 3;
  console.log(`Starting analysis for link: ${link.url}`);

  // Валидация URL перед началом обработки
  try {
    new URL(link.url);
  } catch (error) {
    console.error(`Invalid URL detected: ${link.url}`);
    link.status = 'broken';
    link.errorDetails = `Invalid URL: ${link.url}`;
    link.isIndexable = false;
    link.indexabilityStatus = 'invalid-url';
    link.responseCode = 'Error';
    link.overallStatus = 'Problem';
    link.lastChecked = new Date();
    await link.save();
    return link;
  }

  // Проверка доступности домена через DNS
  const domain = new URL(link.url).hostname;
  try {
    await dns.lookup(domain);
    console.log(`DNS resolved successfully for ${domain}`);
  } catch (error) {
    console.error(`DNS resolution failed for ${domain}: ${error.message}`);
    link.status = 'broken';
    link.errorDetails = `DNS resolution failed: ${error.message}`;
    link.isIndexable = false;
    link.indexabilityStatus = 'dns-error';
    link.responseCode = 'Error';
    link.overallStatus = 'Problem';
    link.lastChecked = new Date();
    await link.save();
    return link;
  }

  while (attempt < maxAttempts) {
    try {
      console.log(`Attempt ${attempt + 1} to check link ${link.url}`);
      if (!browser) {
        browser = await initializeBrowser();
      }

      page = await browser.newPage();
      await page.setDefaultNavigationTimeout(60000);

      const userAgents = [
      {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Connection': 'keep-alive',
          'Referer': 'https://www.google.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
      },
      {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://www.bing.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"macOS"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-User': '?1',
        },
      },
      {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://duckduckgo.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
      },
      {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.52',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Connection': 'keep-alive',
          'Referer': 'https://www.google.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Microsoft Edge";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
      },
      {
        ua: 'Mozilla/5.0 (Linux; Android 14; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://www.google.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'Sec-Ch-Ua-Mobile': '?1',
          'Sec-Ch-Ua-Platform': '"Android"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
      },
      {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://www.apple.com/',
          'Upgrade-Insecure-Requests': '1',
        },
      },
      {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://www.youtube.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Google Chrome";v="128", "Not;A=Brand";v="8", "Chromium";v="128"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-User': '?1',
        },
      },
      {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:130.0) Gecko/20100101 Firefox/130.0',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Referer': 'https://www.mozilla.org/',
          'Upgrade-Insecure-Requests': '1',
        },
      },
      {
        ua: 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 Edge/129.0.2792.52',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://www.microsoft.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Microsoft Edge";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'Sec-Ch-Ua-Mobile': '?1',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
      },
      {
        ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Connection': 'keep-alive',
          'Referer': 'https://www.google.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Linux"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
      },
    ];
    const selectedAgent = userAgents[attempt % userAgents.length];
      await page.setUserAgent(selectedAgent.ua);
      await page.setExtraHTTPHeaders(selectedAgent.headers);

      await page.setViewport({ width: 1920, height: 1080 });

      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media', 'script'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      const startTime = Date.now();
      let response;
      let finalUrl = link.url;

      try {
        console.log(`Navigating to ${link.url}`);
        response = await page.goto(link.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        finalUrl = await page.url();
        console.log(`Page loaded with status: ${response ? response.status() : 'No response'}, Final URL: ${finalUrl}`);
        link.responseCode = response ? response.status().toString() : 'Timeout';
      } catch (error) {
        console.error(`Navigation failed for ${link.url}:`, error.message);
        link.status = 'timeout'; // Возвращаем старое поведение: тайм-аут записывается в таблицу
        link.errorDetails = error.message;
        link.isIndexable = false;
        link.indexabilityStatus = 'timeout';
        link.responseCode = 'Timeout';
        await link.save();
        return link; // Прерываем попытки и возвращаем ссылку
      }
      const loadTime = Date.now() - startTime;
      link.loadTime = loadTime;

      if (response) {
        const statusCode = response.status();
        link.responseCode = statusCode.toString();

        if (statusCode === 500) {
          console.log(`Received 500 for ${link.url}, but will try to process content anyway`);
        } else if (statusCode === 304) {
          console.log(`Received 304 for ${link.url}, treating as successful`);
        } else if (statusCode === 302) {
          console.log(`Received 302 for ${link.url}, followed redirect to ${finalUrl}`);
          link.redirectUrl = finalUrl;
        } else if (statusCode === 418) {
          console.log(`Received 418 for ${link.url}, likely region restriction`);
          link.errorDetails = 'Region restriction (418)';
          throw new Error('Region restriction (418)');
        } else if (!response.ok() && ![302, 304].includes(statusCode)) {
          link.isIndexable = false;
          link.indexabilityStatus = `HTTP ${statusCode}`;
          link.status = statusCode >= 400 ? 'broken' : 'redirect';
          await link.save();
        }
      }

      await page.waitForFunction(
        () => document.readyState === 'complete' || (document.querySelector('meta[name="robots"]') || document.querySelector('a[href]')),
        { timeout: 5000 },
      ).catch(() => console.log(`Timeout waiting for page to stabilize for ${link.url}`));

      const randomDelay = Math.floor(Math.random() * 2000) + 1000;
      await new Promise(resolve => setTimeout(resolve, randomDelay));

      let content;
      try {
        content = await page.evaluate(() => document.documentElement.outerHTML);
      } catch (error) {
        console.error(`Failed to extract HTML for ${link.url}:`, error.message);
        link.status = 'broken';
        link.errorDetails = `Failed to extract HTML: ${error.message}`;
        link.isIndexable = false;
        link.indexabilityStatus = `check failed: ${error.message}`;
        link.responseCode = 'Error';
        link.overallStatus = 'Problem';
        await link.save();
        return link;
      }

      const $ = cheerio.load(content);

      let metaRobots = '';
      let isMetaRobotsFound = false;
      let isIndexableBasedOnRobots = false;
      try {
        await page.waitForFunction(() => document.readyState === 'complete', { timeout: 3000 });
        metaRobots = (await page.$eval('meta[name="robots"]', el => el?.content)) || '';
        isMetaRobotsFound = true;
        const robotsValues = metaRobots.toLowerCase().split(',').map(val => val.trim());
        if (robotsValues.includes('noindex') || robotsValues.includes('nofollow')) {
          link.isIndexable = false;
          link.indexabilityStatus = robotsValues.includes('noindex') ? 'noindex' : 'nofollow';
        } else {
          link.isIndexable = true;
          link.indexabilityStatus = 'indexable';
          isIndexableBasedOnRobots = true;
        }
      } catch (error) {
        console.error(`Failed to extract meta robots for ${link.url}:`, error.message);
        link.isIndexable = true;
        link.indexabilityStatus = 'indexable';
        isIndexableBasedOnRobots = true;
      }

      if (link.isIndexable && (link.responseCode === '200' || link.responseCode === 'Timeout' || link.responseCode === '304' || link.responseCode === '302')) {
        try {
          await page.waitForFunction(() => document.readyState === 'complete', { timeout: 3000 });
          const canonical = await page.$eval('link[rel="canonical"]', el => el?.href);
          if (canonical) {
            link.canonicalUrl = canonical;
            const currentUrl = finalUrl.toLowerCase().replace(/\/$/, '');
            const canonicalNormalized = canonical.toLowerCase().replace(/\/$/, '');
            if (currentUrl !== canonicalNormalized) {
              link.indexabilityStatus = 'canonical mismatch';
            }
          }
        } catch (error) {
          console.error(`Failed to extract canonical URL for ${link.url}:`, error.message);
          link.canonicalUrl = null;
        }
      }

      const cleanTargetDomains = link.targetDomains.map(domain =>
        domain
          .replace(/^https?:\/\//, '')
          .replace(/^\/+/, '')
          .replace(/\/+$/, '')
          .toLowerCase()
      );

      let linksFound = null;
      let captchaType = 'none';
      let captchaToken = null;

      // Обнаружение всех типов капч
      if ($('.cf-turnstile').length > 0) captchaType = 'Cloudflare Turnstile';
      else if ($('.g-recaptcha').length > 0) captchaType = 'Google reCAPTCHA';
      else if ($('.h-captcha').length > 0) captchaType = 'hCaptcha';
      else if ($('form[action*="/cdn-cgi/"]').length > 0) captchaType = 'Cloudflare Challenge Page';
      else if ($('div[id*="arkose"]').length > 0 || $('script[src*="arkoselabs"]').length > 0) captchaType = 'FunCaptcha';
      else if ($('div[class*="geetest"]').length > 0) captchaType = 'GeeTest';
      else if ($('img[src*="captcha"]').length > 0 || $('input[placeholder*="enter code"]').length > 0) captchaType = 'Image CAPTCHA';
      else if ($('body').text().toLowerCase().includes('verify you are not a robot')) captchaType = 'Custom CAPTCHA';
      else if ($('script[src*="keycaptcha"]').length > 0) captchaType = 'KeyCAPTCHA';
      else if ($('div[class*="capy"]').length > 0 || $('script[src*="capy"]').length > 0) captchaType = 'Capy Puzzle CAPTCHA';
      else if ($('div[id*="lemin-cropped-captcha"]').length > 0) captchaType = 'Lemin CAPTCHA';
      else if ($('script[src*="awswaf"]').length > 0) captchaType = 'Amazon CAPTCHA';
      else if ($('script[src*="cybersiara"]').length > 0 || $('div[class*="cybersiara"]').length > 0) captchaType = 'CyberSiARA';
      else if ($('script[src*="mtcaptcha"]').length > 0) captchaType = 'MTCaptcha';
      else if ($('div[class*="cutcaptcha"]').length > 0) captchaType = 'Cutcaptcha';
      else if ($('div[class*="frc-captcha"]').length > 0 || $('script[src*="friendlycaptcha"]').length > 0) captchaType = 'Friendly Captcha';
      else if ($('script[src*="aisecurius"]').length > 0) captchaType = 'atbCAPTCHA';
      else if ($('script[src*="tencent"]').length > 0 || $('div[id*="TencentCaptcha"]').length > 0) captchaType = 'Tencent';
      else if ($('script[src*="prosopo"]').length > 0) captchaType = 'Prosopo Procaptcha';
      else if ($('div[class*="captcha"]').length > 0 && $('span[class*="rotate"]').length > 0) captchaType = 'Rotate CAPTCHA';
      else if ($('div[class*="captcha"]').length > 0 && $('div[class*="grid"]').length > 0) captchaType = 'Grid CAPTCHA';
      else if ($('div[class*="captcha"]').length > 0 && $('canvas').length > 0) captchaType = 'Draw Around CAPTCHA';
      else if ($('div[class*="captcha"]').length > 0 && $('div[class*="bounding-box"]').length > 0) captchaType = 'Bounding Box CAPTCHA';
      else if ($('audio[src*="captcha"]').length > 0 || $('div[class*="audio-captcha"]').length > 0) captchaType = 'Audio CAPTCHA';
      else if ($('div[class*="captcha"]').length > 0 && $('input[type="text"]').length > 0 && $('body').text().toLowerCase().includes('solve')) captchaType = 'Text CAPTCHA';

      if (captchaType !== 'none') console.log(`CAPTCHA detected: ${captchaType}`);

      if (captchaType !== 'none') {
        try {
          const currentPageUrl = await page.url();
          console.log(`Current page URL after redirects: ${currentPageUrl}`);
      
          const solveCaptcha = async (task, maxRetries = 2) => {
            let retry = 0;
            while (retry <= maxRetries) {
              try {
                const createTaskResponse = await axios.post('https://api.2captcha.com/createTask', {
                  clientKey: process.env.TWOCAPTCHA_API_KEY,
                  task: task,
                });
                console.log(`2Captcha createTask response:`, createTaskResponse.data);
      
                if (createTaskResponse.data.errorId !== 0) {
                  throw new Error(`2Captcha createTask error: ${createTaskResponse.data.errorDescription}`);
                }
      
                const taskId = createTaskResponse.data.taskId;
      
                let result;
                while (true) {
                  await new Promise(resolve => setTimeout(resolve, 5000));
                  const resultResponse = await axios.post('https://api.2captcha.com/getTaskResult', {
                    clientKey: process.env.TWOCAPTCHA_API_KEY,
                    taskId: taskId,
                  });
                  result = resultResponse.data;
                  console.log(`2Captcha task status for task ${taskId}:`, result);
                  if (result.status === 'ready') break;
                  if (result.status === 'failed' || result.errorId) {
                    throw new Error(`2Captcha task failed: ${result.errorDescription || 'Unknown error'}`);
                  }
                }
      
                if (!result.solution) {
                  throw new Error('No solution returned from 2Captcha');
                }
      
                return result.solution;
              } catch (error) {
                retry++;
                if (retry > maxRetries) {
                  throw error;
                }
                console.log(`Retrying CAPTCHA solve (attempt ${retry + 1}) after error:`, error.message);
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }
          };

          // Обработка всех типов капч
          if (captchaType === 'Google reCAPTCHA') {
            const sitekey = await page.$eval('.g-recaptcha', el => el.getAttribute('data-sitekey'));
            if (!sitekey) throw new Error('Could not extract sitekey for Google reCAPTCHA');
            console.log(`Extracted sitekey for Google reCAPTCHA: ${sitekey}`);

            const task = {
              type: 'RecaptchaV2TaskProxyless',
              websiteURL: currentPageUrl,
              websiteKey: sitekey,
              isInvisible: false,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.gRecaptchaResponse;
            console.log(`Google reCAPTCHA solved: ${captchaToken}`);

            const textareaExists = await page.evaluate(() => !!document.querySelector('#g-recaptcha-response'));
            if (!textareaExists) {
              console.error('No g-recaptcha-response textarea found');
              throw new Error('No g-recaptcha-response textarea found');
            }

            await page.evaluate(token => {
              const textarea = document.querySelector('#g-recaptcha-response');
              if (textarea) textarea.innerHTML = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Google reCAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Cloudflare Turnstile') {
            const sitekey = await page.$eval('.cf-turnstile', el => el.getAttribute('data-sitekey'));
            if (!sitekey) throw new Error('Could not extract sitekey for Cloudflare Turnstile');
            console.log(`Extracted sitekey for Cloudflare Turnstile: ${sitekey}`);

            const task = {
              type: 'TurnstileTaskProxyless',
              websiteURL: currentPageUrl,
              websiteKey: sitekey,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.token;
            console.log(`Cloudflare Turnstile solved: ${captchaToken}`);

            const inputExists = await page.evaluate(() => !!document.querySelector('input[name="cf-turnstile-response"]'));
            if (!inputExists) {
              console.error('No cf-turnstile-response input found');
              throw new Error('No cf-turnstile-response input found');
            }

            await page.evaluate(token => {
              const input = document.querySelector('input[name="cf-turnstile-response"]');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Cloudflare Turnstile, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'hCaptcha') {
            const sitekey = await page.$eval('.h-captcha', el => el.getAttribute('data-sitekey'));
            if (!sitekey) throw new Error('Could not extract sitekey for hCaptcha');
            console.log(`Extracted sitekey for hCaptcha: ${sitekey}`);

            const task = {
              type: 'HCaptchaTaskProxyless',
              websiteURL: currentPageUrl,
              websiteKey: sitekey,
              isInvisible: await page.evaluate(() => !document.querySelector('.h-captcha').classList.contains('visible')),
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.gRecaptchaResponse;
            console.log(`hCaptcha solved: ${captchaToken}`);

            const textareaExists = await page.evaluate(() => !!document.querySelector('#h-captcha-response'));
            if (!textareaExists) {
              console.error('No h-captcha-response textarea found');
              throw new Error('No h-captcha-response textarea found');
            }

            await page.evaluate(token => {
              const textarea = document.querySelector('#h-captcha-response');
              if (textarea) textarea.innerHTML = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for hCaptcha, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'FunCaptcha') {
            const sitekey = await page.evaluate(() => {
              const script = document.querySelector('script[src*="arkoselabs"]');
              return script ? new URL(script.src).searchParams.get('pk') : null;
            });
            if (!sitekey) throw new Error('Could not extract sitekey for FunCaptcha');
            console.log(`Extracted publickey for FunCaptcha: ${sitekey}`);

            const apiSubdomain = await page.evaluate(() => {
              const script = document.querySelector('script[src*="arkoselabs"]');
              return script ? new URL(script.src).hostname : null;
            });

            const task = {
              type: 'FunCaptchaTaskProxyless',
              websiteURL: currentPageUrl,
              websitePublicKey: sitekey,
              funcaptchaApiJSSubdomain: apiSubdomain || 'client-api.arkoselabs.com',
              userAgent: selectedAgent.ua,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.token;
            console.log(`FunCaptcha solved: ${captchaToken}`);

            const inputExists = await page.evaluate(() => !!document.querySelector('input[name="fc-token"]'));
            if (!inputExists) {
              console.error('No fc-token input found');
              throw new Error('No fc-token input found');
            }

            await page.evaluate(token => {
              const input = document.querySelector('input[name="fc-token"]');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for FunCaptcha, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'GeeTest') {
            const geeTestParams = await page.evaluate(() => {
              const gt = document.querySelector('script[src*="geetest"]')?.src.match(/gt=([^&]+)/)?.[1];
              const challenge = document.querySelector('script[src*="geetest"]')?.src.match(/challenge=([^&]+)/)?.[1];
              return { gt, challenge };
            });
            if (!geeTestParams.gt || !geeTestParams.challenge) throw new Error('Could not extract parameters for GeeTest');
            console.log(`Extracted parameters for GeeTest: gt=${geeTestParams.gt}, challenge=${geeTestParams.challenge}`);

            const task = {
              type: 'GeeTestTaskProxyless',
              websiteURL: currentPageUrl,
              gt: geeTestParams.gt,
              challenge: geeTestParams.challenge,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution;
            console.log(`GeeTest solved: ${JSON.stringify(captchaToken)}`);

            await page.evaluate(params => {
              Object.keys(params).forEach(key => {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = key;
                input.value = params[key];
                document.forms[0]?.appendChild(input);
              });
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for GeeTest, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Image CAPTCHA') {
            const captchaImageUrl = await page.$eval('img[src*="captcha"]', el => el.src);
            if (!captchaImageUrl) throw new Error('Could not extract CAPTCHA image URL');
            console.log(`Extracted CAPTCHA image URL: ${captchaImageUrl}`);

            const task = {
              type: 'ImageToTextTask',
              body: captchaImageUrl,
              phrase: false,
              case: true,
              numeric: 0,
              math: false,
              minLength: 1,
              maxLength: 5,
              comment: 'enter the text you see on the image',
              languagePool: 'en',
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.text;
            console.log(`Image CAPTCHA solved: ${captchaToken}`);

            const inputExists = await page.evaluate(() => !!document.querySelector('input[placeholder*="enter code"], input[name*="captcha"]'));
            if (!inputExists) {
              console.error('No input field found for Image CAPTCHA');
              throw new Error('No input field found for Image CAPTCHA');
            }

            await page.type('input[placeholder*="enter code"], input[name*="captcha"]', captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Image CAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Text CAPTCHA') {
            const comment = await page.evaluate(() => {
              const captchaText = document.querySelector('div[class*="captcha"]')?.innerText;
              return captchaText ? captchaText.match(/If tomorrow is \w+, what day is today\?/)?.[0] : null;
            });
            if (!comment) throw new Error('Could not extract text for Text CAPTCHA');
            console.log(`Extracted comment for Text CAPTCHA: ${comment}`);

            const task = {
              type: 'TextCaptchaTask',
              comment: comment,
              languagePool: 'en',
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.text;
            console.log(`Text CAPTCHA solved: ${captchaToken}`);

            const inputExists = await page.evaluate(() => !!document.querySelector('input[type="text"]'));
            if (!inputExists) {
              console.error('No input field found for Text CAPTCHA');
              throw new Error('No input field found for Text CAPTCHA');
            }

            await page.type('input[type="text"]', captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Text CAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Rotate CAPTCHA') {
            const captchaImageUrl = await page.$eval('img[src*="captcha"]', el => el.src);
            if (!captchaImageUrl) throw new Error('Could not extract CAPTCHA image URL for Rotate CAPTCHA');
            console.log(`Extracted CAPTCHA image URL for Rotate CAPTCHA: ${captchaImageUrl}`);

            const task = {
              type: 'RotateTask',
              body: captchaImageUrl,
              comment: 'position the image properly',
              angle: 60,
              languagePool: 'en',
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.angle; // Предполагаем, что API возвращает угол поворота
            console.log(`Rotate CAPTCHA solved: Angle ${captchaToken}`);

            // Применяем поворот (предполагаем, что на странице есть элемент для поворота)
            await page.evaluate(angle => {
              const img = document.querySelector('img[src*="captcha"]');
              if (img) img.style.transform = `rotate(${angle}deg)`;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Rotate CAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Grid CAPTCHA') {
            const captchaImageUrl = await page.$eval('img[src*="captcha"]', el => el.src);
            if (!captchaImageUrl) throw new Error('Could not extract CAPTCHA image URL for Grid CAPTCHA');
            console.log(`Extracted CAPTCHA image URL for Grid CAPTCHA: ${captchaImageUrl}`);

            const gridDimensions = await page.evaluate(() => {
              const grid = document.querySelector('div[class*="grid"]');
              const rows = grid?.getAttribute('data-rows') || 4;
              const columns = grid?.getAttribute('data-columns') || 4;
              return { rows: parseInt(rows), columns: parseInt(columns) };
            });

            const task = {
              type: 'GridTask',
              body: captchaImageUrl,
              comment: 'select all vehicles',
              rows: gridDimensions.rows,
              columns: gridDimensions.columns,
            };

            const solution = await solveCaptcha(task);
            const selectedCells = solution.cells; // Предполагаем, что API возвращает массив индексов клеток
            console.log(`Grid CAPTCHA solved: Selected cells ${JSON.stringify(selectedCells)}`);

            await page.evaluate(cells => {
              cells.forEach(cellIndex => {
                const cell = document.querySelector(`div[class*="grid"] div:nth-child(${cellIndex + 1})`);
                if (cell) cell.click();
              });
            }, selectedCells);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Grid CAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Draw Around CAPTCHA') {
            const captchaImageUrl = await page.$eval('img[src*="captcha"]', el => el.src);
            if (!captchaImageUrl) throw new Error('Could not extract CAPTCHA image URL for Draw Around CAPTCHA');
            console.log(`Extracted CAPTCHA image URL for Draw Around CAPTCHA: ${captchaImageUrl}`);

            const task = {
              type: 'DrawAroundTask',
              body: captchaImageUrl,
              comment: 'draw around an apple',
              languagePool: 'en',
            };

            const solution = await solveCaptcha(task);
            const path = solution.path; // Предполагаем, что API возвращает путь для рисования
            console.log(`Draw Around CAPTCHA solved: Path ${JSON.stringify(path)}`);

            await page.evaluate(path => {
              const canvas = document.querySelector('canvas');
              if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.beginPath();
                path.forEach((point, index) => {
                  if (index === 0) ctx.moveTo(point.x, point.y);
                  else ctx.lineTo(point.x, point.y);
                });
                ctx.stroke();
              }
            }, path);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Draw Around CAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Bounding Box CAPTCHA') {
            const captchaImageUrl = await page.$eval('img[src*="captcha"]', el => el.src);
            if (!captchaImageUrl) throw new Error('Could not extract CAPTCHA image URL for Bounding Box CAPTCHA');
            console.log(`Extracted CAPTCHA image URL for Bounding Box CAPTCHA: ${captchaImageUrl}`);

            const task = {
              type: 'BoundingBoxTask',
              body: captchaImageUrl,
              comment: 'draw a tight box around the green apple',
            };

            const solution = await solveCaptcha(task);
            const boundingBox = solution.coordinates; // Предполагаем, что API возвращает координаты
            console.log(`Bounding Box CAPTCHA solved: Coordinates ${JSON.stringify(boundingBox)}`);

            await page.evaluate(box => {
              const canvas = document.querySelector('canvas');
              if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.beginPath();
                ctx.rect(box.x, box.y, box.width, box.height);
                ctx.stroke();
              }
            }, boundingBox);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Bounding Box CAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Audio CAPTCHA') {
            const audioUrl = await page.$eval('audio[src*="captcha"]', el => el.src);
            if (!audioUrl) throw new Error('Could not extract audio URL for Audio CAPTCHA');
            console.log(`Extracted audio URL for Audio CAPTCHA: ${audioUrl}`);

            const task = {
              type: 'AudioTask',
              body: audioUrl,
              lang: 'en',
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.text;
            console.log(`Audio CAPTCHA solved: ${captchaToken}`);

            const inputExists = await page.evaluate(() => !!document.querySelector('input[type="text"]'));
            if (!inputExists) {
              console.error('No input field found for Audio CAPTCHA');
              throw new Error('No input field found for Audio CAPTCHA');
            }

            await page.type('input[type="text"]', captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Audio CAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'KeyCAPTCHA') {
            const keyCaptchaParams = await page.evaluate(() => {
              const s_s_c_user_id = document.querySelector('input[name="s_s_c_user_id"]')?.value;
              const s_s_c_session_id = document.querySelector('input[name="s_s_c_session_id"]')?.value;
              const s_s_c_web_server_sign = document.querySelector('input[name="s_s_c_web_server_sign"]')?.value;
              const s_s_c_web_server_sign2 = document.querySelector('input[name="s_s_c_web_server_sign2"]')?.value;
              return { s_s_c_user_id, s_s_c_session_id, s_s_c_web_server_sign, s_s_c_web_server_sign2 };
            });
            if (!keyCaptchaParams.s_s_c_user_id || !keyCaptchaParams.s_s_c_session_id || !keyCaptchaParams.s_s_c_web_server_sign || !keyCaptchaParams.s_s_c_web_server_sign2) {
              throw new Error('Could not extract parameters for KeyCAPTCHA');
            }
            console.log(`Extracted parameters for KeyCAPTCHA:`, keyCaptchaParams);

            const task = {
              type: 'KeyCaptchaTaskProxyless',
              s_s_c_user_id: keyCaptchaParams.s_s_c_user_id,
              s_s_c_session_id: keyCaptchaParams.s_s_c_session_id,
              s_s_c_web_server_sign: keyCaptchaParams.s_s_c_web_server_sign,
              s_s_c_web_server_sign2: keyCaptchaParams.s_s_c_web_server_sign2,
              websiteURL: currentPageUrl,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.token;
            console.log(`KeyCAPTCHA solved: ${captchaToken}`);

            await page.evaluate(token => {
              const input = document.querySelector('input[name="kc-response"]');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for KeyCAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Capy Puzzle CAPTCHA') {
            const sitekey = await page.evaluate(() => {
              const script = document.querySelector('script[src*="capy"]');
              return script ? script.src.match(/sitekey=([^&]+)/)?.[1] : null;
            });
            if (!sitekey) throw new Error('Could not extract sitekey for Capy Puzzle CAPTCHA');
            console.log(`Extracted sitekey for Capy Puzzle CAPTCHA: ${sitekey}`);

            const task = {
              type: 'CapyTaskProxyless',
              websiteURL: currentPageUrl,
              websiteKey: sitekey,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.token;
            console.log(`Capy Puzzle CAPTCHA solved: ${captchaToken}`);

            await page.evaluate(token => {
              const input = document.querySelector('input[name="capy-token"]');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Capy Puzzle CAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Lemin CAPTCHA') {
            const captchaId = await page.$eval('#lemin-cropped-captcha', el => el.getAttribute('data-captcha-id'));
            const divId = 'lemin-cropped-captcha';
            const apiServer = await page.evaluate(() => {
              const script = document.querySelector('script[src*="leminnow"]');
              return script ? new URL(script.src).hostname : null;
            });
            if (!captchaId || !divId) throw new Error('Could not extract parameters for Lemin CAPTCHA');
            console.log(`Extracted parameters for Lemin CAPTCHA: captchaId=${captchaId}, divId=${divId}`);

            const task = {
              type: 'LeminTaskProxyless',
              captchaId: captchaId,
              divId: divId,
              leminApiServerSubdomain: apiServer || 'api.leminnow.com',
              websiteURL: currentPageUrl,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.token;
            console.log(`Lemin CAPTCHA solved: ${captchaToken}`);

            await page.evaluate(token => {
              const input = document.querySelector('input[name="lemin-token"]');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Lemin CAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Amazon CAPTCHA') {
            const params = await page.evaluate(() => {
              const challengeScript = document.querySelector('script[src*="awswaf"]')?.src;
              const captchaScript = document.querySelector('script[src*="captcha.awswaf"]')?.src;
              const websiteKey = document.querySelector('input[name="aws-waf-token"]')?.value;
              const context = document.querySelector('input[name="context"]')?.value;
              const iv = document.querySelector('input[name="iv"]')?.value;
              return { challengeScript, captchaScript, websiteKey, context, iv };
            });
            if (!params.challengeScript || !params.captchaScript || !params.websiteKey || !params.context || !params.iv) {
              throw new Error('Could not extract parameters for Amazon CAPTCHA');
            }
            console.log(`Extracted parameters for Amazon CAPTCHA:`, params);

            const task = {
              type: 'AmazonTaskProxyless',
              websiteURL: currentPageUrl,
              challengeScript: params.challengeScript,
              captchaScript: params.captchaScript,
              websiteKey: params.websiteKey,
              context: params.context,
              iv: params.iv,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.token;
            console.log(`Amazon CAPTCHA solved: ${captchaToken}`);

            await page.evaluate(token => {
              const input = document.querySelector('input[name="aws-waf-token"]');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Amazon CAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'CyberSiARA') {
            const slideMasterUrlId = await page.evaluate(() => {
              const script = document.querySelector('script[src*="cybersiara"]');
              return script ? script.src.match(/slideMasterUrlId=([^&]+)/)?.[1] : null;
            });
            if (!slideMasterUrlId) throw new Error('Could not extract SlideMasterUrlId for CyberSiARA');
            console.log(`Extracted SlideMasterUrlId for CyberSiARA: ${slideMasterUrlId}`);

            const task = {
              type: 'AntiCyberSiAraTaskProxyless',
              websiteURL: currentPageUrl,
              SlideMasterUrlId: slideMasterUrlId,
              userAgent: selectedAgent.ua,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.token;
            console.log(`CyberSiARA solved: ${captchaToken}`);

            await page.evaluate(token => {
              const input = document.querySelector('input[name="cybersiara-token"]');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for CyberSiARA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'MTCaptcha') {
            const sitekey = await page.$eval('div[class*="mtcaptcha"]', el => el.getAttribute('data-sitekey'));
            if (!sitekey) throw new Error('Could not extract sitekey for MTCaptcha');
            console.log(`Extracted sitekey for MTCaptcha: ${sitekey}`);

            const task = {
              type: 'MtCaptchaTaskProxyless',
              websiteURL: currentPageUrl,
              websiteKey: sitekey,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.token;
            console.log(`MTCaptcha solved: ${captchaToken}`);

            await page.evaluate(token => {
              const input = document.querySelector('input[name="mtcaptcha-token"]');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for MTCaptcha, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Cutcaptcha') {
            const miseryKey = await page.$eval('div[class*="cutcaptcha"]', el => el.getAttribute('data-misery-key'));
            const apiKey = await page.$eval('div[class*="cutcaptcha"]', el => el.getAttribute('data-api-key'));
            if (!miseryKey || !apiKey) throw new Error('Could not extract parameters for Cutcaptcha');
            console.log(`Extracted parameters for Cutcaptcha: miseryKey=${miseryKey}, apiKey=${apiKey}`);

            const task = {
              type: 'CutCaptchaTaskProxyless',
              miseryKey: miseryKey,
              apiKey: apiKey,
              websiteURL: currentPageUrl,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.token;
            console.log(`Cutcaptcha solved: ${captchaToken}`);

            await page.evaluate(token => {
              const input = document.querySelector('input#cap_token');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Cutcaptcha, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Friendly Captcha') {
            const sitekey = await page.$eval('div[class*="frc-captcha"]', el => el.getAttribute('data-sitekey'));
            if (!sitekey) throw new Error('Could not extract sitekey for Friendly Captcha');
            console.log(`Extracted sitekey for Friendly Captcha: ${sitekey}`);

            const task = {
              type: 'FriendlyCaptchaTaskProxyless',
              websiteURL: currentPageUrl,
              websiteKey: sitekey,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.token;
            console.log(`Friendly Captcha solved: ${captchaToken}`);

            await page.evaluate(token => {
              const input = document.querySelector('input[name="frc-captcha-response"]');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Friendly Captcha, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'atbCAPTCHA') {
            const appId = await page.$eval('script[src*="aisecurius"]', el => el.src.match(/appId=([^&]+)/)?.[1]);
            const apiServer = await page.evaluate(() => {
              const script = document.querySelector('script[src*="aisecurius"]');
              return script ? new URL(script.src).hostname : null;
            });
            if (!appId || !apiServer) throw new Error('Could not extract parameters for atbCAPTCHA');
            console.log(`Extracted parameters for atbCAPTCHA: appId=${appId}, apiServer=${apiServer}`);

            const task = {
              type: 'AtbCaptchaTaskProxyless',
              appId: appId,
              apiServer: apiServer || 'https://cap.aisecurius.com',
              websiteURL: currentPageUrl,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.token;
            console.log(`atbCAPTCHA solved: ${captchaToken}`);

            await page.evaluate(token => {
              const input = document.querySelector('input[name="atb-captcha-response"]');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for atbCAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Tencent') {
            const appId = await page.$eval('#TencentCaptcha', el => el.getAttribute('data-appid'));
            if (!appId) throw new Error('Could not extract appId for Tencent CAPTCHA');
            console.log(`Extracted appId for Tencent CAPTCHA: ${appId}`);

            const task = {
              type: 'TencentTaskProxyless',
              appId: appId,
              websiteURL: currentPageUrl,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.ticket;
            console.log(`Tencent CAPTCHA solved: ${captchaToken}`);

            await page.evaluate(token => {
              const input = document.querySelector('input[name="tencent-ticket"]');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Tencent CAPTCHA, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Prosopo Procaptcha') {
            const sitekey = await page.$eval('script[src*="prosopo"]', el => el.src.match(/sitekey=([^&]+)/)?.[1]);
            if (!sitekey) throw new Error('Could not extract sitekey for Prosopo Procaptcha');
            console.log(`Extracted sitekey for Prosopo Procaptcha: ${sitekey}`);

            const task = {
              type: 'ProsopoTaskProxyless',
              websiteKey: sitekey,
              websiteURL: currentPageUrl,
            };

            const solution = await solveCaptcha(task);
            captchaToken = solution.token;
            console.log(`Prosopo Procaptcha solved: ${captchaToken}`);

            await page.evaluate(token => {
              const input = document.querySelector('input[name="prosopo-token"]');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await submitButton.click();
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            } else {
              console.log('No submit button found for Prosopo Procaptcha, assuming token submission via JavaScript');
              await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.submit();
              });
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Cloudflare Challenge Page') {
            await page.waitForSelector('input[name="cf_captcha_kind"]', { timeout: 10000 });
            const sitekey = await page.$eval('input[name="cf_captcha_kind"]', el => el.getAttribute('data-sitekey'));
            if (sitekey) {
              console.log(`Extracted sitekey for Cloudflare Challenge Page: ${sitekey}`);

              const task = {
                type: 'TurnstileTaskProxyless',
                websiteURL: currentPageUrl,
                websiteKey: sitekey,
              };

              const solution = await solveCaptcha(task);
              captchaToken = solution.token;
              console.log(`Cloudflare Challenge Page solved: ${captchaToken}`);

              const inputExists = await page.evaluate(() => !!document.querySelector('input[name="cf-turnstile-response"]'));
              if (!inputExists) {
                console.error('No cf-turnstile-response input found');
                throw new Error('No cf-turnstile-response input found');
              }

              await page.evaluate(token => {
                const input = document.querySelector('input[name="cf-turnstile-response"]');
                if (input) input.value = token;
              }, captchaToken);

              const submitButton = await page.$('button[type="submit"], input[type="submit"]');
              if (submitButton) {
                const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
                await submitButton.click();
                await navigationPromise;
                content = await page.evaluate(() => document.documentElement.outerHTML);
              } else {
                console.log('No submit button found for Cloudflare Challenge Page, assuming token submission via JavaScript');
                await page.evaluate(() => {
                  const form = document.querySelector('form');
                  if (form) form.submit();
                });
                await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
                content = await page.evaluate(() => document.documentElement.outerHTML);
              }
            } else {
              console.log('Cloudflare Challenge Page does not require CAPTCHA solving, waiting for redirect...');
              const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              await navigationPromise;
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else if (captchaType === 'Custom CAPTCHA') {
            console.log('Custom CAPTCHA detected, attempting to solve as Image CAPTCHA if possible...');
            const captchaImageUrl = await page.$eval('img[src*="captcha"]', el => el.src, { timeout: 5000 }).catch(() => null);
            if (captchaImageUrl) {
              console.log(`Extracted CAPTCHA image URL: ${captchaImageUrl}`);
              const task = {
                type: 'ImageToTextTask',
                body: captchaImageUrl,
                phrase: false,
                case: true,
                numeric: 0,
                math: false,
                minLength: 1,
                maxLength: 5,
                comment: 'enter the text you see on the image',
                languagePool: 'en',
              };

              const solution = await solveCaptcha(task);
              captchaToken = solution.text;
              console.log(`Custom CAPTCHA (Image) solved: ${captchaToken}`);

              const inputExists = await page.evaluate(() => !!document.querySelector('input[placeholder*="enter code"], input[name*="captcha"]'));
              if (!inputExists) {
                console.error('No input field found for Custom CAPTCHA');
                throw new Error('No input field found for Custom CAPTCHA');
              }

              await page.type('input[placeholder*="enter code"], input[name*="captcha"]', captchaToken);

              const submitButton = await page.$('button[type="submit"], input[type="submit"]');
              if (submitButton) {
                const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
                await submitButton.click();
                await navigationPromise;
                content = await page.evaluate(() => document.documentElement.outerHTML);
              } else {
                console.log('No submit button found for Custom CAPTCHA, assuming token submission via JavaScript');
                await page.evaluate(() => {
                  const form = document.querySelector('form');
                  if (form) form.submit();
                });
                await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
                content = await page.evaluate(() => document.documentElement.outerHTML);
              }
            } else {
              throw new Error('Custom CAPTCHA not supported for automated solving');
            }
          }

          $ = cheerio.load(content);
        } catch (error) {
          console.error(`Error solving CAPTCHA for ${link.url}:`, error.message);
          link.status = 'suspected-captcha';
          link.rel = 'blocked';
          link.linkType = 'unknown';
          link.anchorText = 'captcha suspected';
          link.errorDetails = `CAPTCHA solving failed: ${error.message}`;
          await link.save();
        }
      }

      const findLinkForDomains = (targetDomains) => {
        let foundLink = null;

        $('a').each((i, a) => {
          const href = $(a).attr('href')?.toLowerCase().trim();
          if (href) {
            const matchesDomain = targetDomains.some(domain => href.includes(domain));
            if (matchesDomain) {
              const anchorText = $(a).text().trim();
              const hasSvg = $(a).find('svg').length > 0;
              const hasImg = $(a).find('img').length > 0;
              const hasIcon = $(a).find('i').length > 0;
              const hasChildren = $(a).children().length > 0;
              foundLink = {
                href: href,
                rel: $(a).attr('rel') || '',
                anchorText: anchorText || (hasSvg ? 'SVG link' : hasImg ? 'Image link' : hasIcon ? 'Icon link' : hasChildren ? 'Element link' : 'no text'),
                source: 'a',
              };
              console.log(`Link found in <a>: ${JSON.stringify(foundLink)}`);
              return false;
            }
          }
        });

        if (foundLink) return foundLink;

        const eventAttributes = ['onclick', 'onmouseover', 'onmouseout', 'onchange'];
        eventAttributes.forEach(attr => {
          $(`[${attr}]`).each((i, el) => {
            const eventCode = $(el).attr(attr)?.toLowerCase();
            if (eventCode) {
              const matchesDomain = targetDomains.some(domain => eventCode.includes(domain));
              if (matchesDomain) {
                const urlMatch = eventCode.match(/(?:window\.location\.href\s*=\s*['"]([^'"]+)['"]|['"](https?:\/\/[^'"]+)['"])/i);
                if (urlMatch) {
                  const href = urlMatch[1] || urlMatch[2];
                  const tagName = $(el).prop('tagName').toLowerCase();
                  foundLink = {
                    href: href.toLowerCase(),
                    rel: '',
                    anchorText: `Link in ${tagName} ${attr}`,
                    source: `event_${attr}`,
                  };
                  console.log(`Link found in ${attr}: ${JSON.stringify(foundLink)}`);
                  return false;
                }
              }
            }
          });
        });

        if (foundLink) return foundLink;

        const tagsToCheck = ['img', 'i', 'svg'];
        tagsToCheck.forEach(tag => {
          $(tag).each((i, el) => {
            const parentA = $(el).closest('a');
            if (parentA.length) {
              const href = parentA.attr('href')?.toLowerCase().trim();
              if (href) {
                const matchesDomain = targetDomains.some(domain => href.includes(domain));
                if (matchesDomain) {
                  const anchorText = `Link in ${tag}`;
                  foundLink = {
                    href: href,
                    rel: parentA.attr('rel') || '',
                    anchorText: anchorText,
                    source: `${tag}_parent_a`,
                  };
                  console.log(`Link found in parent <a> of <${tag}>: ${JSON.stringify(foundLink)}`);
                  return false;
                }
              }
            }

            eventAttributes.forEach(attr => {
              const eventCode = $(el).attr(attr)?.toLowerCase();
              if (eventCode) {
                const matchesDomain = targetDomains.some(domain => eventCode.includes(domain));
                if (matchesDomain) {
                  const urlMatch = eventCode.match(/(?:window\.location\.href\s*=\s*['"]([^'"]+)['"]|['"](https?:\/\/[^'"]+)['"])/i);
                  if (urlMatch) {
                    const href = urlMatch[1] || urlMatch[2];
                    foundLink = {
                      href: href.toLowerCase(),
                      rel: '',
                      anchorText: `Link in ${tag} ${attr}`,
                      source: `${tag}_event_${attr}`,
                    };
                    console.log(`Link found in <${tag}> ${attr}: ${JSON.stringify(foundLink)}`);
                    return false;
                  }
                }
              }
            });
          });
        });

        if (foundLink) return foundLink;

        $('script').each((i, script) => {
          const scriptContent = $(script).html()?.toLowerCase();
          if (scriptContent) {
            const matchesDomain = targetDomains.some(domain => scriptContent.includes(domain));
            if (matchesDomain) {
              const urlMatch = scriptContent.match(/(?:window\.location\.href\s*=\s*['"]([^'"]+)['"]|['"](https?:\/\/[^'"]+)['"])/i);
              if (urlMatch) {
                const href = urlMatch[1] || urlMatch[2];
                foundLink = {
                  href: href.toLowerCase(),
                  rel: '',
                  anchorText: 'Link in JavaScript',
                  source: 'script',
                };
                console.log(`Link found in <script>: ${JSON.stringify(foundLink)}`);
                return false;
              }
            }
          }
        });

        return foundLink;
      };

      linksFound = findLinkForDomains(cleanTargetDomains);

      const isLinkFound = linksFound !== null;
      const hasUsefulData = isLinkFound || isMetaRobotsFound;

      if (hasUsefulData) {
        if (isLinkFound) {
          link.status = 'active';
          link.rel = linksFound.rel;
          link.anchorText = linksFound.anchorText;
          const relValues = linksFound.rel ? linksFound.rel.toLowerCase().split(' ') : [];
          link.linkType = relValues.some(value => ['nofollow', 'ugc', 'sponsored'].includes(value)) ? 'nofollow' : 'dofollow';
          link.errorDetails = captchaType !== 'none' ? `${captchaType} solved, token: ${captchaToken}` : link.errorDetails || '';
        } else {
          link.status = 'active';
          link.rel = 'not found';
          link.linkType = 'unknown';
          link.anchorText = 'not found';
          link.errorDetails = link.errorDetails || '';
        }
        link.overallStatus = link.isIndexable ? 'OK' : 'Problem';
      } else {
        link.status = 'broken';
        link.rel = 'not found';
        link.linkType = 'unknown';
        link.anchorText = 'not found';
        link.errorDetails = link.errorDetails || 'No useful data found';
        link.overallStatus = 'Problem';
      }

      link.lastChecked = new Date();
      await link.save();
      return link;
    } catch (error) {
      console.error(`Critical error in checkLinkStatus for ${link.url} on attempt ${attempt + 1}:`, error);
      attempt += 1;
      if (page) {
        await page.close().catch(err => console.error(`Error closing page for ${link.url}:`, err));
      }
      if (attempt === maxAttempts) {
        link.status = 'broken';
        link.errorDetails = `Failed after ${maxAttempts} attempts: ${error.message}`;
        link.rel = 'error';
        link.linkType = 'unknown';
        link.anchorText = 'error';
        link.isIndexable = false;
        link.indexabilityStatus = `check failed: ${error.message}`;
        link.responseCode = 'Error';
        link.overallStatus = 'Problem';
        await link.save();
        return link;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    } finally {
      if (page) {
        await page.close().catch(err => console.error(`Error closing page for ${link.url}:`, err));
      }
    }
  }
};

const processLinksInBatches = async (links, batchSize = 20, projectId, wss, spreadsheetId, taskId) => {
  const { default: pLimitModule } = await import('p-limit');
  const pLimit = pLimitModule;
  const results = [];
  const totalLinks = links.length;

  console.log(`Starting processLinksInBatches: taskId=${taskId}, totalLinks=${totalLinks}`);

  const limit = pLimit(10); // Ограничиваем параллельные проверки
  let processedLinks = 0;
  let totalProcessingTime = 0;

  // Инициализируем прогресс
  await AnalysisTask.findByIdAndUpdate(taskId, {
    $set: {
      totalLinks,
      processedLinks: 0,
      progress: 0,
      estimatedTimeRemaining: 0,
    },
  });
  console.log(`Initialized progress for task ${taskId}: totalLinks=${totalLinks}`);

  for (let i = 0; i < totalLinks; i += batchSize) {
    const batch = links.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(totalLinks / batchSize)}: links ${i + 1} to ${Math.min(i + batchSize, totalLinks)}`);

    const memoryUsage = process.memoryUsage();
    console.log(`Memory usage before batch: RSS=${(memoryUsage.rss / 1024 / 1024).toFixed(2)}MB, HeapTotal=${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)}MB, HeapUsed=${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);

    let browser;
    try {
      browser = await initializeBrowser();
      const startTime = Date.now();

      // Обрабатываем ссылки в батче параллельно
      const batchResults = await Promise.all(
        batch.map(link => limit(async () => {
          console.log(`Starting analysis for link: ${link.url}`);
          try {
            const updatedLink = await checkLinkStatus(link, browser);
            console.log(`Finished analysis for link: ${link.url}, status: ${updatedLink.status}, overallStatus: ${updatedLink.overallStatus}`);
            return updatedLink;
          } catch (error) {
            console.error(`Error processing link ${link.url}:`, error);
            link.status = 'broken';
            link.errorDetails = `Failed during analysis: ${error.message}`;
            link.overallStatus = 'Problem';
            await link.save();
            return link;
          }
        }))
      );

      // Обновляем прогресс после всего батча
      processedLinks += batchResults.length;
      const batchTime = Date.now() - startTime;
      totalProcessingTime += batchTime;
      const avgTimePerLink = totalProcessingTime / processedLinks;
      const remainingLinks = totalLinks - processedLinks;
      const estimatedTimeRemaining = Math.round((remainingLinks * avgTimePerLink) / 1000);
      const progress = Math.round((processedLinks / totalLinks) * 100);

      await AnalysisTask.findByIdAndUpdate(taskId, {
        $set: {
          progress,
          processedLinks,
          totalLinks,
          estimatedTimeRemaining,
        },
      });
      console.log(`Updated progress for task ${taskId}: progress=${progress}%, processedLinks=${processedLinks}, totalLinks=${totalLinks}, estimatedTimeRemaining=${estimatedTimeRemaining}s`);

      results.push(...batchResults);
      console.log(`Batch completed: ${i + batch.length} of ${totalLinks} links processed`);

      const memoryUsageAfter = process.memoryUsage();
      console.log(`Memory usage after batch: RSS=${(memoryUsageAfter.rss / 1024 / 1024).toFixed(2)}MB, HeapTotal=${(memoryUsageAfter.heapTotal / 1024 / 1024).toFixed(2)}MB, HeapUsed=${(memoryUsageAfter.heapUsed / 1024 / 1024).toFixed(2)}MB`);

      // Закрываем браузер и очищаем память
      await closeBrowser(browser);
      browser = null; // Помогаем сборщику мусора
      global.gc && global.gc(); // Принудительно вызываем сборку мусора, если доступно
      await new Promise(resolve => setTimeout(resolve, 1000)); // Уменьшаем задержку до 1 секунды
    } catch (error) {
      console.error(`Critical error in processLinksInBatches for batch ${Math.floor(i / batchSize) + 1}:`, error);
      if (browser) {
        await closeBrowser(browser);
      }
      throw error; // Передаём ошибку в очередь для корректной обработки
    }
  }

  const pendingLinks = await FrontendLink.find({ status: 'checking' });
  if (pendingLinks.length > 0) {
    console.log(`Found ${pendingLinks.length} links still in "checking" status after analysis. Updating...`);
    await Promise.all(pendingLinks.map(async (link) => {
      link.status = 'broken';
      link.errorDetails = 'Analysis incomplete: status not updated';
      link.overallStatus = 'Problem';
      await link.save();
      console.log(`Updated link ${link.url} to status: broken`);
    }));
  }

  return results;
};

const analyzeSpreadsheet = async (spreadsheet, maxLinks, projectId, wss, taskId) => {
  try {
    const existingSpreadsheet = await Spreadsheet.findOne({ _id: spreadsheet._id, userId: spreadsheet.userId, projectId: spreadsheet.projectId });
    if (!existingSpreadsheet) {
      throw new Error('Spreadsheet not found');
    }

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
        const newLink = new FrontendLink({
          url: link.url,
          targetDomains: link.targetDomains,
          userId: spreadsheet.userId,
          projectId: spreadsheet.projectId,
          spreadsheetId: spreadsheet.spreadsheetId,
          source: 'google_sheets',
          status: 'pending',
          rowIndex: link.rowIndex,
        });
        await newLink.save();
        return newLink;
      })
    );

    const updatedLinks = await processLinksInBatches(dbLinks, 20, projectId, wss, spreadsheet.spreadsheetId, taskId);

    if (cancelAnalysis) {
      throw new Error('Analysis cancelled');
    }

    const updatedSpreadsheet = await Spreadsheet.findOneAndUpdate(
      { _id: spreadsheet._id, userId: spreadsheet.userId, projectId: spreadsheet.projectId },
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
          })),
          gid: spreadsheet.gid,
        },
      },
      { new: true, runValidators: true },
    );

    if (!updatedSpreadsheet) {
      throw new Error('Spreadsheet not found during update');
    }

    const { default: pLimitModule } = await import('p-limit');
    const pLimit = pLimitModule;

    const limit = pLimit(5);
    await Promise.all(updatedLinks.map(link =>
      limit(() => exportLinkToGoogleSheets(spreadsheet.spreadsheetId, link, spreadsheet.resultRangeStart, spreadsheet.resultRangeEnd, sheetName))
    ));

    await formatGoogleSheet(spreadsheet.spreadsheetId, Math.max(...updatedLinks.map(link => link.rowIndex)) + 1, spreadsheet.gid, spreadsheet.resultRangeStart, spreadsheet.resultRangeEnd);
  } catch (error) {
    console.error(`Critical error in analyzeSpreadsheet for spreadsheet ${spreadsheet._id}:`, error);
    throw error; // Передаем ошибку в очередь для корректной обработки
  }
};

const importFromGoogleSheets = async (spreadsheetId, defaultTargetDomain, urlColumn, targetColumn, gid) => {
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const sheet = spreadsheet.data.sheets.find(sheet => sheet.properties.sheetId === parseInt(gid));
    if (!sheet) {
      console.error(`Sheet with GID ${gid} not found in spreadsheet ${spreadsheetId}`);
      return { links: [], sheetName: null };
    }

    const sheetName = sheet.properties.title;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!${urlColumn}2:${targetColumn}`,
    });

    const rows = response.data.values || [];
    console.log(`Imported rows from "${sheetName}" (${spreadsheetId}, GID: ${gid}): ${rows.length}`);
    const links = rows
      .map((row, index) => {
        const url = row[0];
        const targetDomainsRaw = row[row.length - 1] && row[row.length - 1].trim() ? row[row.length - 1] : defaultTargetDomain;
        const targetDomains = targetDomainsRaw.split('\n').map(domain => domain.trim()).filter(domain => domain);
        return {
          url,
          targetDomains: targetDomains.length > 0 ? targetDomains : [defaultTargetDomain],
          rowIndex: index + 2,
          spreadsheetId,
        };
      })
      .filter(link => link.url);
    return { links, sheetName };
  } catch (error) {
    console.error(`Error importing from Google Sheets ${spreadsheetId}:`, error);
    return { links: [], sheetName: null };
  }
};

const exportLinkToGoogleSheets = async (spreadsheetId, link, resultRangeStart, resultRangeEnd, sheetName) => {
  const responseCode = link.responseCode || (link.status === 'timeout' ? 'Timeout' : '200');
  const isLinkFound = link.status === 'active' && link.rel !== 'not found';
  const value = [
    responseCode === '200' && link.isIndexable && isLinkFound ? 'OK' : 'Problem',
    responseCode,
    link.isIndexable === null ? 'Unknown' : link.isIndexable ? 'Yes' : 'No',
    link.isIndexable === false ? link.indexabilityStatus : '',
    isLinkFound ? 'True' : 'False',
  ];
  const range = `${sheetName}!${resultRangeStart}${link.rowIndex}:${resultRangeEnd}${link.rowIndex}`;
  console.log(`Exporting to ${range} (${spreadsheetId}): ${value}`);

  let attempt = 1;
  while (true) {
    try {
      const response = await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        resource: { values: [value] },
      });
      console.log(`Successfully exported to ${range}: ${JSON.stringify(response.data)}`);
      return;
    } catch (error) {
      if (error.code === 429) {
        const delay = 30 * 1000;
        console.log(`Rate limit exceeded for ${range}, retrying in ${delay}ms (attempt ${attempt})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt++;
        continue;
      }
      console.error(`Error exporting to ${range} (${spreadsheetId}):`, error.response ? error.response.data : error.message);
      throw error;
    }
  }
};

const formatGoogleSheet = async (spreadsheetId, maxRows, gid, resultRangeStart, resultRangeEnd) => {
  console.log(`Formatting sheet ${spreadsheetId} (gid: ${gid})...`);
  const startColumnIndex = columnLetterToIndex(resultRangeStart);
  const endColumnIndex = columnLetterToIndex(resultRangeEnd) + 1; // +1, так как endColumnIndex не включён

  const requests = [
    {
      repeatCell: {
        range: { sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex, endColumnIndex },
        cell: { userEnteredFormat: { textFormat: { fontFamily: 'Arial', fontSize: 11 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      updateBorders: {
        range: { sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex, endColumnIndex },
        top: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        bottom: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        left: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        right: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        innerHorizontal: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        innerVertical: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: gid, dimension: 'COLUMNS', startIndex: startColumnIndex, endIndex: endColumnIndex },
        properties: { pixelSize: 120 },
        fields: 'pixelSize'
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex, endColumnIndex: startColumnIndex + 1 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'OK' }] }, format: { backgroundColor: { red: 0.83, green: 0.92, blue: 0.83 } } }
        },
        index: 0
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex, endColumnIndex: startColumnIndex + 1 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Problem' }] }, format: { backgroundColor: { red: 0.98, green: 0.82, blue: 0.82 } } }
        },
        index: 1
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: startColumnIndex + 2, endColumnIndex: startColumnIndex + 3 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Yes' }] }, format: { textFormat: { foregroundColor: { red: 0, green: 0.4, blue: 0 } } } }
        },
        index: 2
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: startColumnIndex + 2, endColumnIndex: startColumnIndex + 3 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'No' }] }, format: { textFormat: { foregroundColor: { red: 0.8, green: 0, blue: 0 } } } }
        },
        index: 3
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: startColumnIndex + 2, endColumnIndex: startColumnIndex + 3 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Unknown' }] }, format: { textFormat: { foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 } } } }
        },
        index: 4
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: startColumnIndex + 4, endColumnIndex: startColumnIndex + 5 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'True' }] }, format: { backgroundColor: { red: 0.83, green: 0.92, blue: 0.83 } } }
        },
        index: 5
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: startColumnIndex + 4, endColumnIndex: startColumnIndex + 5 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'False' }] }, format: { backgroundColor: { red: 1, green: 0.88, blue: 0.7 } } }
        },
        index: 6
      }
    }
  ];
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests }
    });
    console.log(`Sheet formatted: ${spreadsheetId} (gid: ${gid})`);
  } catch (error) {
    console.error(`Error formatting sheet ${spreadsheetId}:`, error);
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

        project.isAnalyzing = true;
        await project.save();

        try {
          spreadsheet.status = 'checking';
          await spreadsheet.save();

          await analyzeSpreadsheet(spreadsheet);
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
const getAnalysisStatus = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const tasks = await AnalysisTask.find({ projectId, status: { $in: ['pending', 'processing'] } });
    res.json({ isAnalyzing: project.isAnalyzing || tasks.length > 0 });
  } catch (error) {
    console.error('getAnalysisStatus: Error fetching analysis status', error);
    res.status(500).json({ error: 'Error fetching analysis status', details: error.message });
  }
};

const columnLetterToIndex = (letter) => {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index *= 26;
    index += letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1;
  }
  return index - 1; // Google Sheets columns are 0-based
};
const getTaskProgress = async (req, res) => {
  const { projectId, taskId } = req.params;
  try {
    const task = await AnalysisTask.findOne({ _id: taskId, projectId });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({
      progress: task.progress,
      processedLinks: task.processedLinks,
      totalLinks: task.totalLinks,
      estimatedTimeRemaining: task.estimatedTimeRemaining,
      status: task.status,
    });
  } catch (error) {
    console.error('getTaskProgress: Error fetching task progress', error);
    res.status(500).json({ error: 'Error fetching task progress', details: error.message });
  }
};
const getTaskProgressSSE = async (req, res) => {
  const { projectId, taskId } = req.params;
  console.log(`SSE request for project ${projectId}, task ${taskId}, userId: ${req.userId}`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const task = await AnalysisTask.findOne({ _id: taskId, projectId });
  if (!task) {
    console.log(`Task ${taskId} not found for project ${projectId}`);
    res.write(`data: ${JSON.stringify({ error: 'Task not found' })}\n\n`);
    res.end();
    return;
  }

  res.write(`data: ${JSON.stringify({
    progress: task.progress,
    processedLinks: task.processedLinks,
    totalLinks: task.totalLinks,
    estimatedTimeRemaining: task.estimatedTimeRemaining,
    status: task.status,
  })}\n\n`);

  const intervalId = setInterval(async () => {
    const updatedTask = await AnalysisTask.findOne({ _id: taskId, projectId });
    if (!updatedTask) {
      console.log(`Task ${taskId} no longer exists for project ${projectId}`);
      res.write(`data: ${JSON.stringify({ error: 'Task not found' })}\n\n`);
      clearInterval(intervalId);
      res.end();
      return;
    }

    console.log(`Sending SSE update for task ${taskId}: progress=${updatedTask.progress}%`);
    res.write(`data: ${JSON.stringify({
      progress: updatedTask.progress,
      processedLinks: updatedTask.processedLinks,
      totalLinks: updatedTask.totalLinks,
      estimatedTimeRemaining: updatedTask.estimatedTimeRemaining,
      status: updatedTask.status,
    })}\n\n`);

    if (updatedTask.status === 'completed' || updatedTask.status === 'failed') {
      console.log(`Task ${taskId} completed or failed, closing SSE connection`);
      clearInterval(intervalId);
      res.end();
    }
  }, 1000); // Уменьшаем интервал до 1 секунды

  req.on('close', () => {
    console.log(`SSE connection closed for task ${taskId}`);
    clearInterval(intervalId);
    res.end();
  });
};
const getUserTasks = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('activeTasks');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ activeTasks: user.activeTasks || {} });
  } catch (error) {
    console.error('getUserTasks: Error fetching user tasks', error);
    res.status(500).json({ error: 'Error fetching user tasks', details: error.message });
  }
};
// Экспортируем все функции
module.exports = {
  registerUser,
  loginUser,
  getUserInfo: [authMiddleware, getUserInfo],
  createProject: [authMiddleware, createProject],
  getProjects: [authMiddleware, getProjects],
  deleteProject: [authMiddleware, deleteProject],
  addLinks: [authMiddleware, addLinks],
  getLinks: [authMiddleware, getLinks],
  deleteLink: [authMiddleware, deleteLink],
  deleteAllLinks: [authMiddleware, deleteAllLinks],
  checkLinks: [authMiddleware, checkLinks],
  addSpreadsheet: [authMiddleware, addSpreadsheet],
  getSpreadsheets: [authMiddleware, getSpreadsheets],
  runSpreadsheetAnalysis: [authMiddleware, runSpreadsheetAnalysis],
  cancelSpreadsheetAnalysis: [authMiddleware, cancelSpreadsheetAnalysis],
  deleteSpreadsheet: [authMiddleware, deleteSpreadsheet],
  selectPlan: [authMiddleware, selectPlan],
  processPayment: [authMiddleware, processPayment],
  cancelSubscription: [authMiddleware, cancelSubscription],
  deleteAccount: [authMiddleware, deleteAccount],
  updateProfile: [authMiddleware, updateProfile],
  getAnalysisStatus: [authMiddleware, getAnalysisStatus], // Добавляем новый маршрут
  getTaskProgress: [authMiddleware, getTaskProgress],
  getTaskProgressSSE: [authMiddleware, getTaskProgressSSE],
  getUserTasks: [authMiddleware, getUserTasks],
  checkLinkStatus,
  analyzeSpreadsheet,
  scheduleSpreadsheetAnalysis,
};
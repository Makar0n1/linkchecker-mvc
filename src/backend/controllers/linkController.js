const authMiddleware = require('./middleware/authMiddleware');
const superAdminMiddleware = require('./middleware/superAdminMiddleware');
const {
  registerUser,
  loginUser,
  getUserInfo,
  selectPlan,
  processPayment,
  cancelSubscription,
  deleteAccount,
  updateProfile,
  refreshToken,
  getUserTasks,
  updatePassword,
} = require('./userController');
const {
  createProject,
  getProjects,
  deleteProject,
  addLinks,
  getLinks,
  deleteLink,
  deleteAllLinks,
} = require('./projectController');
const {
  checkLinkStatus,
  processLinksInBatches,
  checkLinks,
  getAnalysisStatus,
  getTaskProgress,
  getTaskProgressSSE,
  getActiveTasks,
  getProjectStats,
} = require('./linkAnalysisController');
const {
  addSpreadsheet,
  getSpreadsheets,
  deleteSpreadsheet,
  analyzeSpreadsheet,
  runSpreadsheetAnalysis,
  cancelSpreadsheetAnalysis,
  scheduleSpreadsheetAnalysis,
  getActiveSpreadsheetTasks,
} = require('./spreadsheetController');
const { loadPendingTasks } = require('./taskQueue');
const { encryptPassword, decryptPassword } = require('./authUtils');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const Spreadsheet = require('../models/Spreadsheet');
const mongoose = require('mongoose');

// Передаем analyzeSpreadsheet в loadPendingTasks
loadPendingTasks(analyzeSpreadsheet);

// Обновленная функция loginUser для поддержки "Remember Me"
const loginUserWithRememberMe = async (req, res) => {
  const { username, password, rememberMe } = req.body;
  const rememberMeToken = req.headers['x-remember-me-token'];

  console.log(`loginUser: Received username=${username}, rememberMe=${rememberMe}, hasToken=${!!rememberMeToken}`);

  if (!username || !password) {
    console.error('loginUser: Missing username or password');
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (!process.env.JWT_SECRET || !process.env.JWT_REMEMBER_ME_SECRET || !process.env.JWT_REFRESH_SECRET) {
    console.error('loginUser: JWT_SECRET, JWT_REMEMBER_ME_SECRET, or JWT_REFRESH_SECRET is not defined');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const user = await User.findOne({ username });
    if (!user) {
      console.error(`loginUser: User not found for username=${username}`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Проверяем только обычный пароль
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.error(`loginUser: Password mismatch for username=${username}`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const refreshToken = jwt.sign({ userId: user._id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

    // Создаем или проверяем rememberMeToken
    let newRememberMeToken = null;
    if (rememberMe || rememberMeToken) {
      if (rememberMeToken) {
        try {
          const decoded = jwt.verify(rememberMeToken, process.env.JWT_REMEMBER_ME_SECRET);
          if (decoded.userId === user._id.toString() && user.rememberMeToken === rememberMeToken) {
            newRememberMeToken = rememberMeToken;
            console.log(`loginUser: Reused existing rememberMeToken for userId=${user._id}`);
          } else {
            newRememberMeToken = jwt.sign({ userId: user._id }, process.env.JWT_REMEMBER_ME_SECRET, { expiresIn: '30d' });
            user.rememberMeToken = newRememberMeToken;
            console.log(`loginUser: Generated new rememberMeToken for userId=${user._id}`);
          }
        } catch (error) {
          console.error(`loginUser: Invalid rememberMeToken for userId=${user._id}: ${error.message}`);
          newRememberMeToken = jwt.sign({ userId: user._id }, process.env.JWT_REMEMBER_ME_SECRET, { expiresIn: '30d' });
          user.rememberMeToken = newRememberMeToken;
          console.log(`loginUser: Generated new rememberMeToken after invalid token for userId=${user._id}`);
        }
      } else if (rememberMe) {
        newRememberMeToken = jwt.sign({ userId: user._id }, process.env.JWT_REMEMBER_ME_SECRET, { expiresIn: '30d' });
        user.rememberMeToken = newRememberMeToken;
        console.log(`loginUser: Generated new rememberMeToken for userId=${user._id}`);
      }
      user.rememberMe = rememberMe || false;
    }

    user.refreshToken = refreshToken;
    await user.save();

    console.log(`loginUser: Success for username=${username}, token=${token.slice(0, 10)}..., rememberMeToken=${newRememberMeToken ? newRememberMeToken.slice(0, 10) + '...' : 'none'}`);
    res.json({ token, refreshToken, rememberMeToken: newRememberMeToken });
  } catch (error) {
    console.error(`loginUser: Error for username=${username}: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Эндпоинт для шифрования пароля
const encryptPasswordEndpoint = async (req, res) => {
  const { password } = req.body;
  console.log(`encryptPassword: Received password=${password ? 'provided' : 'missing'}`);

  if (!password) {
    console.error('encryptPassword: Password is required');
    return res.status(400).json({ error: 'Password is required' });
  }

  try {
    const encryptedPassword = encryptPassword(password);
    console.log(`encryptPassword: Success, encrypted=${encryptedPassword.slice(0, 10)}...`);
    res.json({ encryptedPassword });
  } catch (error) {
    console.error(`encryptPassword: Error: ${error.message}`);
    res.status(500).json({ error: 'Error encrypting password', details: error.message });
  }
};

// Эндпоинт для дешифрования пароля
const decryptPasswordEndpoint = async (req, res) => {
  const { encryptedPassword } = req.body;
  console.log(`decryptPassword: Received encryptedPassword=${encryptedPassword ? encryptedPassword.slice(0, 10) + '...' : 'missing'}`);

  if (!encryptedPassword) {
    console.error('decryptPassword: Encrypted password is required');
    return res.status(400).json({ error: 'Encrypted password is required' });
  }

  try {
    const decryptedPassword = decryptPassword(encryptedPassword);
    console.log(`decryptPassword: Success, decrypted=${decryptedPassword.slice(0, 5)}...`);
    res.json({ decryptedPassword });
  } catch (error) {
    console.error(`decryptPassword: Error: ${error.message}`);
    res.status(500).json({ error: 'Error decrypting password', details: error.message });
  }
};

// Проверка rememberMeToken
const verifyRememberMeToken = async (req, res) => {
  const { rememberMeToken } = req.body;
  console.log(`verifyRememberMeToken: Received token=${rememberMeToken ? rememberMeToken.slice(0, 10) + '...' : 'missing'}`);

  if (!rememberMeToken) {
    console.error('verifyRememberMeToken: RememberMe token is required');
    return res.status(400).json({ error: 'RememberMe token is required' });
  }

  if (!process.env.JWT_REMEMBER_ME_SECRET) {
    console.error('verifyRememberMeToken: JWT_REMEMBER_ME_SECRET is not defined');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const decoded = jwt.verify(rememberMeToken, process.env.JWT_REMEMBER_ME_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user || user.rememberMeToken !== rememberMeToken) {
      console.error(`verifyRememberMeToken: Invalid token for userId=${decoded.userId}`);
      return res.status(403).json({ error: 'Invalid rememberMe token' });
    }

    const newToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    console.log(`verifyRememberMeToken: Success, new token=${newToken.slice(0, 10)}... for userId=${user._id}`);
    res.json({ token: newToken });
  } catch (error) {
    console.error(`verifyRememberMeToken: Error: ${error.message}`);
    res.status(403).json({ error: 'Invalid rememberMe token' });
  }
};

// Обновленная функция addSpreadsheet с проверкой дубликатов
const addSpreadsheetWithDuplicateCheck = async (req, res) => {
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
      projectObjectId = mongoose.Types.ObjectId(projectId);
      console.log(`addSpreadsheet: Converted projectId=${projectId} to ObjectId=${projectObjectId}`);
    } catch (error) {
      console.error(`addSpreadsheet: Invalid projectId=${projectId}: ${error.message}`);
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    // Проверяем существование проекта
    const project = await Project.findOne({ _id: projectObjectId, userId: req.userId });
    if (!project) {
      console.error(`addSpreadsheet: Project not found for projectId=${projectId}, userId=${req.userId}`);
      // Дополнительная проверка: существует ли проект вообще
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
    res.status(500).json({ error: 'Error adding spreadsheet', details: error.message });
  }
};

module.exports = {
  getTaskProgress,
  getTaskProgressSSE,
  registerUser,
  loginUser: loginUserWithRememberMe,
  updatePassword,
  getUserInfo: [authMiddleware, getUserInfo],
  createProject: [authMiddleware, createProject],
  getProjects: [authMiddleware, getProjects],
  deleteProject: [authMiddleware, deleteProject],
  addLinks: [authMiddleware, addLinks],
  getLinks: [authMiddleware, getLinks],
  deleteLink: [authMiddleware, deleteLink],
  deleteAllLinks: [authMiddleware, deleteAllLinks],
  checkLinks: [authMiddleware, checkLinks],
  addSpreadsheet: [authMiddleware, addSpreadsheetWithDuplicateCheck],
  getSpreadsheets: [authMiddleware, getSpreadsheets],
  runSpreadsheetAnalysis: [authMiddleware, runSpreadsheetAnalysis],
  cancelSpreadsheetAnalysis: [authMiddleware, cancelSpreadsheetAnalysis],
  deleteSpreadsheet: [authMiddleware, deleteSpreadsheet],
  selectPlan: [authMiddleware, selectPlan],
  processPayment: [authMiddleware, processPayment],
  cancelSubscription: [authMiddleware, cancelSubscription],
  deleteAccount: [authMiddleware, deleteAccount],
  updateProfile: [authMiddleware, updateProfile],
  getAnalysisStatus: [authMiddleware, getAnalysisStatus],
  getTaskProgress: [authMiddleware, getTaskProgress],
  getTaskProgressSSE: [authMiddleware, getTaskProgressSSE],
  getUserTasks: [authMiddleware, getUserTasks],
  getActiveTasks: [authMiddleware, getActiveTasks],
  getActiveSpreadsheetTasks: [authMiddleware, getActiveSpreadsheetTasks],
  getProjectStats: [authMiddleware, getProjectStats],
  refreshToken: [refreshToken],
  encryptPassword: encryptPasswordEndpoint,
  decryptPassword: decryptPasswordEndpoint,
  verifyRememberMeToken: [verifyRememberMeToken],
  checkLinkStatus,
  analyzeSpreadsheet,
  scheduleSpreadsheetAnalysis,
};
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
  editSpreadsheet,
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
      return res.status(404).json({ error: 'Invalid rememberMe token' });
    }

    const newToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    console.log(`verifyRememberMeToken: Success, new token=${newToken.slice(0, 10)}... for userId=${user._id}`);
    res.json({ token: newToken });
  } catch (error) {
    console.error(`verifyRememberMeToken: Error: ${error.message}`);
    res.status(404).json({ error: 'Invalid rememberMe token' });
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
  addSpreadsheet: [authMiddleware, addSpreadsheet],
  editSpreadsheet: [authMiddleware, editSpreadsheet],
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
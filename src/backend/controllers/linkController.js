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

// Передаем analyzeSpreadsheet в loadPendingTasks
loadPendingTasks(analyzeSpreadsheet);

// Обновленная функция loginUser для поддержки "Remember Me"
const loginUserWithRememberMe = async (req, res) => {
  const { username, password, rememberMe } = req.body;
  const rememberMeToken = req.headers['x-remember-me-token'];

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    let isMatch = false;
    try {
      // Попробуем сравнить как зашифрованный пароль
      const decryptedPassword = decryptPassword(password);
      isMatch = await bcrypt.compare(decryptedPassword, user.password);
    } catch (error) {
      // Если это не зашифрованный пароль, пробуем сравнить напрямую
      isMatch = await bcrypt.compare(password, user.password);
    }

    if (!isMatch) {
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
            newRememberMeToken = rememberMeToken; // Сохраняем существующий токен
          } else {
            newRememberMeToken = jwt.sign({ userId: user._id }, process.env.JWT_REMEMBER_ME_SECRET, { expiresIn: '30d' });
            user.rememberMeToken = newRememberMeToken;
          }
        } catch (error) {
          console.error('Invalid rememberMeToken:', error.message);
          newRememberMeToken = jwt.sign({ userId: user._id }, process.env.JWT_REMEMBER_ME_SECRET, { expiresIn: '30d' });
          user.rememberMeToken = newRememberMeToken;
        }
      } else if (rememberMe) {
        newRememberMeToken = jwt.sign({ userId: user._id }, process.env.JWT_REMEMBER_ME_SECRET, { expiresIn: '30d' });
        user.rememberMeToken = newRememberMeToken;
      }
      user.rememberMe = rememberMe || false;
    }

    user.refreshToken = refreshToken;
    await user.save();

    res.json({ token, refreshToken, rememberMeToken: newRememberMeToken });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Эндпоинт для шифрования пароля
const encryptPasswordEndpoint = async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }
  try {
    const encryptedPassword = encryptPassword(password);
    res.json({ encryptedPassword });
  } catch (error) {
    console.error('encryptPassword: Error encrypting password', error);
    res.status(500).json({ error: 'Error encrypting password', details: error.message });
  }
};

// Эндпоинт для дешифрования пароля
const decryptPasswordEndpoint = async (req, res) => {
  const { encryptedPassword } = req.body;
  if (!encryptedPassword) {
    return res.status(400).json({ error: 'Encrypted password is required' });
  }
  try {
    const decryptedPassword = decryptPassword(encryptedPassword);
    res.json({ decryptedPassword });
  } catch (error) {
    console.error('decryptPassword: Error decrypting password', error);
    res.status(500).json({ error: 'Error decrypting password', details: error.message });
  }
};

// Проверка rememberMeToken
const verifyRememberMeToken = async (req, res) => {
  const { rememberMeToken } = req.body;
  if (!rememberMeToken) {
    return res.status(400).json({ error: 'RememberMe token is required' });
  }

  try {
    const decoded = jwt.verify(rememberMeToken, process.env.JWT_REMEMBER_ME_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user || user.rememberMeToken !== rememberMeToken) {
      return res.status(403).json({ error: 'Invalid rememberMe token' });
    }

    const newToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token: newToken });
  } catch (error) {
    console.error('verifyRememberMeToken: Error verifying token', error);
    res.status(403).json({ error: 'Invalid rememberMe token' });
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
  encryptPassword: [authMiddleware, encryptPasswordEndpoint],
  decryptPassword: [authMiddleware, decryptPasswordEndpoint],
  verifyRememberMeToken: [verifyRememberMeToken],
  checkLinkStatus,
  analyzeSpreadsheet,
  scheduleSpreadsheetAnalysis,
};
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

// Передаем analyzeSpreadsheet в loadPendingTasks
loadPendingTasks(analyzeSpreadsheet);

module.exports = {
  getTaskProgress,
  getTaskProgressSSE,
  registerUser,
  loginUser,
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
  checkLinkStatus,
  analyzeSpreadsheet,
  scheduleSpreadsheetAnalysis,
};
const Spreadsheet = require('../models/Spreadsheet');
const Project = require('../models/Project');
const User = require('../models/User');
const FrontendLink = require('../models/FrontendLink');

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

module.exports = {
  addSpreadsheet,
  getSpreadsheets,
  deleteSpreadsheet,
  scheduleSpreadsheetAnalysis,
};
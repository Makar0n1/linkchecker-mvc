const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const linkRoutes = require('./routes/linkRoutes');
const WebSocket = require('ws');
const Spreadsheet = require('./models/Spreadsheet');
const Project = require('./models/Project');
const User = require('./models/User');
const AnalysisTask = require('./models/AnalysisTask');
const { loadPendingTasks } = require('./controllers/analysisController');

const envPath = process.env.NODE_ENV === 'production'
  ? path.resolve(__dirname, '../../.env.prod')
  : path.resolve(__dirname, '../../.env');
console.log('Server.js - Loading .env from:', envPath);
dotenv.config({ path: envPath });

console.log('Server.js - NODE_ENV:', process.env.NODE_ENV);
console.log('Server.js - MONGODB_URI:', process.env.MONGODB_URI);
console.log('Server.js - JWT_SECRET:', process.env.JWT_SECRET);
console.log('Server.js - CORS origin:', process.env.FRONTEND_DOMAIN);

const app = express();
const port = process.env.BACKEND_PORT || 3000;

mongoose.set('strictQuery', true);
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(async () => {
    console.log('Connected to MongoDB');

    console.log('Checking database for missing userId in Spreadsheets and Projects...');
    const spreadsheetsWithoutUserId = await Spreadsheet.find({ userId: { $exists: false } });
    if (spreadsheetsWithoutUserId.length > 0) {
      console.log(`Found ${spreadsheetsWithoutUserId.length} Spreadsheets without userId`);
      for (const spreadsheet of spreadsheetsWithoutUserId) {
        const project = await Project.findById(spreadsheet.projectId);
        if (project && project.userId) {
          spreadsheet.userId = project.userId;
          await spreadsheet.save();
          console.log(`Updated Spreadsheet ${spreadsheet._id} with userId=${spreadsheet.userId}`);
        } else {
          console.error(`Cannot update Spreadsheet ${spreadsheet._id}: Project ${spreadsheet.projectId} not found or missing userId`);
        }
      }
    } else {
      console.log('All Spreadsheets have userId');
    }

    const projectsWithoutUserId = await Project.find({ userId: { $exists: false } });
    if (projectsWithoutUserId.length > 0) {
      console.error(`Found ${projectsWithoutUserId.length} Projects without userId:`, projectsWithoutUserId);
    } else {
      console.log('All Projects have userId');
    }

    console.log('Cleaning up stale tasks on server startup...');
    const users = await User.find();
    for (const user of users) {
      const activeTasks = user.activeTasks || new Map();
      const projectIds = Array.from(activeTasks.keys());
      const tasksToRemove = [];

      for (const projectId of projectIds) {
        const taskId = activeTasks.get(projectId);
        const task = await AnalysisTask.findById(taskId);
        if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
          tasksToRemove.push(projectId);
        }
      }

      for (const projectId of tasksToRemove) {
        const taskId = activeTasks.get(projectId);
        activeTasks.delete(projectId);
        const project = await Project.findOne({ _id: projectId, userId: user._id });
        if (project) {
          project.isAnalyzing = false;
          await project.save();
          console.log(`Cleared isAnalyzing for project ${projectId} on startup`);
        }
        await AnalysisTask.findByIdAndDelete(taskId);
        console.log(`Deleted stale AnalysisTask ${taskId} for project ${projectId} on startup`);
      }

      user.activeTasks = activeTasks;
      await user.save();
    }
    console.log('Stale tasks cleanup completed on server startup');

    await loadPendingTasks();
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      'https://link-check-pro.top',
      'http://localhost:3001',
      'http://localhost:3000',
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`CORS: Origin ${origin} not allowed. Allowed origins: ${allowedOrigins}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));

app.options('*', (req, res) => {
  console.log(`Handling OPTIONS request for ${req.url}`);
  res.set({
    'Access-Control-Allow-Origin': 'https://link-check-pro.top',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  });
  res.status(204).send();
});

app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} (Origin: ${req.headers.origin})`);
  next();
});

const server = app.listen(port, () => {
  const baseUrl = process.env.NODE_ENV === 'production'
    ? `https://api.link-check-pro.top`
    : `http://localhost:${port}`;
  console.log(`Backend running at ${baseUrl}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'subscribe' && data.projectId) {
        ws.projectId = data.projectId;
        console.log(`Client subscribed to project ${data.projectId}`);
      }
    } catch (error) {
      console.error('WebSocket message parsing error:', error);
    }
  });
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

app.use((req, res, next) => {
  req.wss = wss;
  next();
});

app.use('/api/links', linkRoutes);

app.use((err, req, res, next) => {
  console.error(`Server error: ${err.message}`);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = { app, wss };
const { spawn } = require('child_process');
const dotenv = require('dotenv');
const path = require('path');
const schedule = require('node-schedule');
const mongoose = require('mongoose');
const Spreadsheet = require('./backend/models/Spreadsheet');
const { scheduleSpreadsheetAnalysis } = require('./backend/controllers/spreadsheetController');

const envPath = process.env.NODE_ENV === 'production'
  ? path.resolve(__dirname, '../.env.prod')
  : path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const backend = spawn('node', ['src/backend/server.js'], { 
  stdio: 'inherit', 
  env: { ...process.env }
});

let frontend;
if (process.env.NODE_ENV === 'production') {
  frontend = spawn('node', [
    path.resolve(__dirname, '../node_modules/serve/build/main.js'),
    '-s', 'dist',
    '-l', process.env.FRONTEND_PORT || 3001
  ], { 
    stdio: 'inherit', 
    cwd: path.resolve(__dirname, '..'), 
    env: { ...process.env } 
  });
} else {
  frontend = spawn('node', [
    path.resolve(__dirname, '../node_modules/vite/bin/vite.js'),
    '--port', process.env.FRONTEND_PORT || 3001
  ], { 
    stdio: 'inherit', 
    cwd: path.resolve(__dirname, '..'), 
    env: { ...process.env, NODE_ENV: 'development' } 
  });
}

mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

schedule.gracefulShutdown().then(() => {
  console.log('Cleared all scheduled jobs on startup');
});

const runAnalysis = async () => {
  try {
    const spreadsheets = await Spreadsheet.find({ status: 'pending' });
    for (const spreadsheet of spreadsheets) {
      const now = new Date();
      const lastRun = spreadsheet.lastRun || new Date(0);
      const hoursSinceLastRun = (now - lastRun) / (1000 * 60 * 60);

      if (hoursSinceLastRun >= spreadsheet.intervalHours) {
        await scheduleSpreadsheetAnalysis(spreadsheet);
      }
    }
  } catch (error) {
    console.error('Error in runAnalysis:', error);
  }
};

schedule.scheduleJob('*/5 * * * *', runAnalysis);

process.on('SIGINT', () => {
  console.log('Shutting down...');
  backend.kill();
  frontend.kill();
  mongoose.connection.close();
  process.exit();
});
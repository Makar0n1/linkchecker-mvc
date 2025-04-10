const { spawn } = require('child_process');
const dotenv = require('dotenv');
const path = require('path');
const schedule = require('node-schedule');
const mongoose = require('mongoose');
const Spreadsheet = require('./backend/models/Spreadsheet');
const linkController = require('./backend/controllers/linkController');

dotenv.config({ path: path.resolve(__dirname, `../${process.env.NODE_ENV === 'production' ? '.env.prod' : '.env'}`) });

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
  ], { stdio: 'inherit', cwd: path.resolve(__dirname, '..'), env: { ...process.env } });
} else {
  frontend = spawn('node', [
    path.resolve(__dirname, '../node_modules/vite/bin/vite.js'),
    '--port', process.env.FRONTEND_PORT || 3001
  ], { stdio: 'inherit', cwd: path.resolve(__dirname, '..'), env: { ...process.env, NODE_ENV: 'development' } });
}

backend.on('spawn', () => console.log('Backend spawned'));
backend.on('error', (err) => console.error('Backend error:', err));
frontend.on('spawn', () => console.log('Frontend spawned'));
frontend.on('error', (err) => console.error('Frontend error:', err));

mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const runAnalysis = async () => {
  console.log('Checking scheduled spreadsheet analysis...');
  const spreadsheets = await Spreadsheet.find();
  for (const spreadsheet of spreadsheets) {
    const now = new Date();
    const lastRun = spreadsheet.lastRun || new Date(0);
    const hoursSinceLastRun = (now - lastRun) / (1000 * 60 * 60);
    if (hoursSinceLastRun >= spreadsheet.intervalHours) {
      console.log(`Running analysis for ${spreadsheet.spreadsheetId}`);
      spreadsheet.status = 'running';
      await spreadsheet.save();
      try {
        await linkController.analyzeSpreadsheet(spreadsheet);
        spreadsheet.status = 'completed';
      } catch (error) {
        spreadsheet.status = 'error';
        console.error(`Error analyzing ${spreadsheet.spreadsheetId}:`, error);
      }
      spreadsheet.lastRun = now;
      await spreadsheet.save();
    }
  }
};

runAnalysis();
schedule.scheduleJob('* * * * *', runAnalysis); // Проверка каждую минуту

process.on('SIGINT', () => {
  console.log('Shutting down...');
  backend.kill();
  frontend.kill();
  mongoose.connection.close();
  process.exit();
});
const { spawn } = require('child_process');
const dotenv = require('dotenv');
const path = require('path');

// Загружаем .env из корня проекта
const envPath = process.env.NODE_ENV === 'production'
  ? path.resolve(__dirname, '../.env.prod')
  : path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

console.log('Index.js - NODE_ENV:', process.env.NODE_ENV);
console.log('Index.js - FRONTEND_PORT:', process.env.FRONTEND_PORT);

// Запуск бэкенда
const backend = spawn('node', ['src/backend/server.js'], { 
  stdio: 'inherit', 
  env: { ...process.env }
});

// Запуск фронтенда
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

// Логирование запуска процессов
backend.on('spawn', () => console.log('✅ Backend spawned'));
backend.on('error', (err) => console.error('❌ Backend error:', err));
frontend.on('spawn', () => console.log('✅ Frontend spawned'));
frontend.on('error', (err) => console.error('❌ Frontend error:', err));

// Обработка graceful shutdown
process.on('SIGINT', () => {
  console.log('🔒 Shutting down...');
  backend.kill();
  frontend.kill();
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('🔒 Shutting down...');
  backend.kill();
  frontend.kill();
  process.exit();
});
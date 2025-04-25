const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const linkRoutes = require('./routes/linkRoutes');

// Загружаем .env в зависимости от окружения
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

// Настройка подключения к MongoDB
mongoose.set('strictQuery', true);
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Настройка CORS
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.FRONTEND_DOMAIN || 'https://link-check-pro.top', // Запасной вариант
      'http://localhost:3001',
      'http://localhost:3000',
    ];

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));

// Обработка preflight запросов
app.options('*', cors(corsOptions));

// Middleware для парсинга JSON
app.use(express.json());

// Маршруты API
app.use('/api/links', linkRoutes);

// Логирование всех запросов для отладки
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} (Origin: ${req.headers.origin})`);
  next();
});

// Запуск сервера
app.listen(port, () => {
  const baseUrl = process.env.NODE_ENV === 'production'
    ? `https://api.link-check-pro.top`
    : `http://localhost:${port}`;
  console.log(`Backend running at ${baseUrl}`);
});
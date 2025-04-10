const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const linkRoutes = require('./routes/linkRoutes');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

console.log('Server.js - MONGODB_URI:', process.env.MONGODB_URI);
console.log('Server.js - JWT_SECRET:', process.env.JWT_SECRET);
console.log('Server.js - CORS origin:', `http://${process.env.FRONTEND_DOMAIN}:${process.env.FRONTEND_PORT}`);

const app = express();
const port = process.env.BACKEND_PORT || 3000;

mongoose.set('strictQuery', true);
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

app.use(express.json());
app.use(cors({
  origin: `http://${process.env.FRONTEND_DOMAIN}:${process.env.FRONTEND_PORT}`,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use('/api/links', linkRoutes);

// Логирование всех запросов для отладки
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
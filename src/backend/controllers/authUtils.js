const crypto = require('crypto');
const dotenv = require('dotenv');
const path = require('path');

// Загружаем .env из корня проекта
const envPath = process.env.NODE_ENV === 'production'
  ? path.resolve(__dirname, '../../../.env.prod')
  : path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

// Ensure environment variables are loaded
const algorithm = 'aes-256-cbc';
const secretKey = process.env.AES_SECRET;
const ivHex = process.env.AES_IV;

// Проверяем наличие переменных окружения
if (!secretKey || !ivHex) {
  console.error('AES_SECRET or AES_IV is not defined in environment variables');
  throw new Error('AES_SECRET or AES_IV is not defined in environment variables');
}

// Convert hex IV to Buffer
const iv = Buffer.from(ivHex, 'hex');
if (iv.length !== 16) {
  console.error('AES_IV must be 16 bytes (32 hex characters)');
  throw new Error('AES_IV must be 16 bytes (32 hex characters)');
}

// Encrypt password using AES-256-CBC
const encryptPassword = (password) => {
  const key = crypto.scryptSync(secretKey, 'salt', 32);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(password, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

// Decrypt password using AES-256-CBC
const decryptPassword = (encrypted) => {
  try {
    const key = crypto.scryptSync(secretKey, 'salt', 32);
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('decryptPassword: Failed to decrypt password:', error.message);
    throw new Error('Failed to decrypt password');
  }
};

module.exports = {
  encryptPassword,
  decryptPassword,
};
const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema({
  url: { type: String, required: true },
  targetDomain: { type: String },
  status: { type: String, default: 'pending' },
  rel: { type: String, default: '' },
  linkType: { type: String, default: 'unknown' },
  anchorText: { type: String, default: '' },
  errorDetails: { type: String, default: '' },
  lastChecked: { type: Date },
  createdAt: { type: Date, default: Date.now },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Привязка к пользователю
  isIndexable: { type: Boolean, default: null }, // Может ли быть проиндексировано
  canonicalUrl: { type: String, default: null }, // Каноническая ссылка, если есть
  indexabilityStatus: { type: String, default: 'unknown' }, // Причина, если non-indexable
  loadTime: { type: Number, default: null }, // Время загрузки страницы в миллисекундах
  rowIndex: { type: Number }
});

module.exports = mongoose.model('Link', linkSchema);
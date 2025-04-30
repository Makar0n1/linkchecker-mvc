const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  links: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FrontendLink' }],
  isAnalyzing: { type: Boolean, default: false }, // Оставляем для обратной совместимости
  isAnalyzingManual: { type: Boolean, default: false }, // Для ручных ссылок
  isAnalyzingSpreadsheet: { type: Boolean, default: false }, // Для Google Sheets
});

module.exports = mongoose.model('Project', projectSchema);
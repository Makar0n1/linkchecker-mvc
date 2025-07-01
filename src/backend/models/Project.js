const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  links: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FrontendLink' }],
  isAnalyzing: { type: Boolean, default: false }, // Для обратной совместимости
  isAnalyzingManual: { type: Boolean, default: false }, // Для ручных ссылок
  isAnalyzingSpreadsheet: { type: Boolean, default: false }, // Для Google Sheets
});

// Индексы для оптимизации запросов
projectSchema.index({ _id: 1 });
projectSchema.index({ userId: 1 });

// Middleware для логирования изменений isAnalyzingSpreadsheet
projectSchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate();
  const projectId = this.getQuery()._id;

  if (update.$set && 'isAnalyzingSpreadsheet' in update.$set) {
    console.log(`Project ${projectId}: isAnalyzingSpreadsheet set to ${update.$set.isAnalyzingSpreadsheet}`);
  }
  next();
});

// Middleware для логирования создания/удаления проекта
projectSchema.pre('save', function(next) {
  console.log(`Project ${this._id}: Created with isAnalyzingSpreadsheet=${this.isAnalyzingSpreadsheet}`);
  next();
});

projectSchema.pre('remove', function(next) {
  console.log(`Project ${this._id}: Removed with isAnalyzingSpreadsheet=${this.isAnalyzingSpreadsheet}`);
  next();
});

module.exports = mongoose.model('Project', projectSchema);
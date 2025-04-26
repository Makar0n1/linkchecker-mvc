const mongoose = require('mongoose');

const analysisTaskSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  type: { type: String, required: true },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  data: { type: Object },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  progress: { type: Number, default: 0 }, // Прогресс в процентах
  processedLinks: { type: Number, default: 0 }, // Количество обработанных ссылок
  totalLinks: { type: Number, default: 0 }, // Общее количество ссылок
  estimatedTimeRemaining: { type: Number, default: 0 }, // Оставшееся время (в секундах)
});

analysisTaskSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('AnalysisTask', analysisTaskSchema);
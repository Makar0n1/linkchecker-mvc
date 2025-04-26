const mongoose = require('mongoose');

const analysisTaskSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  type: { type: String, required: true }, // 'checkLinks' или 'runSpreadsheetAnalysis'
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  data: { type: Object }, // Данные для задачи (например, ссылки или spreadsheetId)
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

analysisTaskSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('AnalysisTask', analysisTaskSchema);
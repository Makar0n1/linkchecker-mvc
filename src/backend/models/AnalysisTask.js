const mongoose = require('mongoose');

const analysisTaskSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'], default: 'pending' },
  data: { type: Object },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  progress: { type: Number, default: 0 },
  processedLinks: { type: Number, default: 0 },
  totalLinks: { type: Number, default: 0 },
  estimatedTimeRemaining: { type: Number, default: 0 },
});

analysisTaskSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('AnalysisTask', analysisTaskSchema);
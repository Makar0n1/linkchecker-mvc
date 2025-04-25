const mongoose = require('mongoose');

const frontendLinkSchema = new mongoose.Schema({
  url: { type: String, required: true },
  targetDomains: [{ type: String }], // Обновляем на массив
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  status: { type: String, default: 'pending' },
  responseCode: String,
  loadTime: Number,
  isIndexable: Boolean,
  indexabilityStatus: String,
  canonicalUrl: String,
  rel: String,
  linkType: String,
  anchorText: String,
  errorDetails: String,
  overallStatus: String, // Убедимся, что поле есть
  lastChecked: Date
});

// Для обратной совместимости: если используется targetDomain, конвертируем в targetDomains
frontendLinkSchema.pre('save', function(next) {
  if (this.targetDomain && !this.targetDomains) {
    this.targetDomains = [this.targetDomain];
    this.targetDomain = undefined;
  }
  next();
});

module.exports = mongoose.model('FrontendLink', frontendLinkSchema);
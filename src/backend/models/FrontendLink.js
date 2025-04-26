const mongoose = require('mongoose');

const frontendLinkSchema = new mongoose.Schema({
  url: { type: String, required: true },
  targetDomains: [{ type: String }],
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  spreadsheetId: { type: String },
  rowIndex: { type: Number }, // Для Google Sheets
  source: { type: String, enum: ['manual', 'google_sheets'], default: 'manual' }, // Новое поле
  status: { type: String, default: 'pending' },
  responseCode: { type: String },
  loadTime: { type: Number },
  isIndexable: { type: Boolean },
  indexabilityStatus: { type: String },
  rel: { type: String },
  linkType: { type: String },
  anchorText: { type: String },
  canonicalUrl: { type: String },
  redirectUrl: { type: String }, // Новое поле для хранения конечного URL после перенаправления
  overallStatus: { type: String },
  errorDetails: { type: String },
  lastChecked: { type: Date },
}, { timestamps: true });

// Для обратной совместимости: если используется targetDomain, конвертируем в targetDomains
frontendLinkSchema.pre('save', function(next) {
  if (this.targetDomain && !this.targetDomains) {
    this.targetDomains = [this.targetDomain];
    this.targetDomain = undefined;
  }
  next();
});

module.exports = mongoose.model('FrontendLink', frontendLinkSchema);
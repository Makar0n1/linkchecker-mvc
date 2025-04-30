const mongoose = require('mongoose');

const frontendLinkSchema = new mongoose.Schema({
  url: { type: String, required: true },
  targetDomains: [{ type: String }],
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  spreadsheetId: { type: String },
  rowIndex: { type: Number },
  source: { type: String, enum: ['manual', 'google_sheets'], default: 'manual' },
  status: { type: String, default: 'pending' },
  responseCode: { type: String },
  loadTime: { type: Number },
  isIndexable: { type: Boolean },
  indexabilityStatus: { type: String },
  rel: { type: String },
  linkType: { type: String },
  anchorText: { type: String },
  canonicalUrl: { type: String },
  redirectUrl: { type: String },
  overallStatus: { type: String },
  errorDetails: { type: String },
  lastChecked: { type: Date },
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'AnalysisTask' },
}, { timestamps: true });

frontendLinkSchema.pre('save', function(next) {
  console.log(`FrontendLink pre-save: userId=${this.userId}, url=${this.url}`);
  if (this.targetDomain && !this.targetDomains) {
    this.targetDomains = [this.targetDomain];
    this.targetDomain = undefined;
  }
  if (!this.userId) {
    console.error(`FrontendLink pre-save: userId is missing for URL ${this.url}`);
    throw new Error('userId is required in pre-save hook');
  }
  next();
});

module.exports = mongoose.model('FrontendLink', frontendLinkSchema);
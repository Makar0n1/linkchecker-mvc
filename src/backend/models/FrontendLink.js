const mongoose = require('mongoose');

const frontendLinkSchema = new mongoose.Schema({
  url: { type: String, required: true },
  targetDomain: { type: String, required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true }, // Привязываем к проекту
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
  lastChecked: Date
});

module.exports = mongoose.model('FrontendLink', frontendLinkSchema);
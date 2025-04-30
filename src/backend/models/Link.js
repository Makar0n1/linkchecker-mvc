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
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isIndexable: { type: Boolean, default: null },
  canonicalUrl: { type: String, default: null },
  indexabilityStatus: { type: String, default: 'unknown' },
  loadTime: { type: Number, default: null },
  rowIndex: { type: Number }
});

module.exports = mongoose.model('Link', linkSchema);
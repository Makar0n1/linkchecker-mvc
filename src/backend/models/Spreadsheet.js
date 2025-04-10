const mongoose = require('mongoose');

const spreadsheetSchema = new mongoose.Schema({
  spreadsheetId: { type: String, required: true },
  gid: { type: Number, required: true },
  targetDomain: { type: String, required: true },
  urlColumn: { type: String, required: true },
  targetColumn: { type: String, required: true },
  resultRangeStart: { type: String, required: true },
  resultRangeEnd: { type: String, required: true },
  intervalHours: { type: Number, required: true, min: 4, max: 24 },
  status: { type: String, enum: ['inactive', 'completed', 'running', 'error'], default: 'inactive' },
  lastRun: { type: Date },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  links: [{
    url: { type: String, required: true },
    targetDomain: { type: String, required: true },
    status: { type: String, default: 'pending' },
    responseCode: String,
    isIndexable: Boolean,
    canonicalUrl: String,
    rel: String,
    linkType: String,
    lastChecked: Date
  }]
});

module.exports = mongoose.model('Spreadsheet', spreadsheetSchema);
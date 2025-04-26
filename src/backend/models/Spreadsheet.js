const mongoose = require('mongoose');

const spreadsheetSchema = new mongoose.Schema({
  spreadsheetId: { type: String, required: true },
  gid: { type: Number, required: true, min: 0 },
  targetDomain: { type: String, required: true },
  urlColumn: { type: String, required: true },
  targetColumn: { type: String, required: true },
  resultRangeStart: { type: String, required: true },
  resultRangeEnd: { type: String, required: true },
  intervalHours: { type: Number, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  status: { type: String, enum: ['pending', 'checking', 'completed', 'error', 'inactive'], default: 'pending' },
  links: [{
    url: String,
    targetDomain: String,
    status: String,
    responseCode: String,
    isIndexable: Boolean,
    canonicalUrl: String,
    rel: String,
    linkType: String,
    lastChecked: Date
  }],
  lastRun: Date,
  scanCount: { type: Number, default: 0 } // Новое поле для подсчёта сканирований
});

module.exports = mongoose.model('Spreadsheet', spreadsheetSchema);
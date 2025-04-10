const mongoose = require('mongoose');

const spreadsheetSchema = new mongoose.Schema({
  spreadsheetId: { type: String, required: true },
  gid: { type: Number, required: true },
  targetDomain: { type: String, required: true },
  urlColumn: { type: String, required: true }, // Например, 'D'
  targetColumn: { type: String, required: true }, // Например, 'I'
  resultRangeStart: { type: String, required: true }, // Например, 'L'
  resultRangeEnd: { type: String, required: true }, // Например, 'P'
  intervalHours: { type: Number, required: true, min: 4, max: 24 }, // От 4 до 24 часов
  status: { type: String, enum: ['inactive', 'completed', 'running', 'error'], default: 'inactive' },
  lastRun: { type: Date },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});

module.exports = mongoose.model('Spreadsheet', spreadsheetSchema);
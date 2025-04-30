const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  links: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FrontendLink' }],
  isAnalyzing: { type: Boolean, default: false },
  isAnalyzingManual: { type: Boolean, default: false },
  isAnalyzingSpreadsheet: { type: Boolean, default: false },
});

module.exports = mongoose.model('Project', projectSchema);
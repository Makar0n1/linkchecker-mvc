const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  links: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FrontendLink' }],
  isAnalyzing: { type: Boolean, default: false } // Новое поле для отслеживания анализа
});

module.exports = mongoose.model('Project', projectSchema);
const mongoose = require('mongoose');

const pingSpreadsheetSchema = new mongoose.Schema({
  spreadsheetId: {
    type: String,
    required: true,
  },
  gid: {
    type: Number,
    required: true,
    min: 0,
  },
  urlColumn: {
    type: String,
    required: true,
  },
  statusColumn: {
    type: String,
    required: true,
  },
  intervalDays: {
    type: Number,
    required: true,
    enum: [1, 3, 7, 14],
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
  },
  status: {
    type: String,
    enum: ['ready', 'checking', 'error'],
    default: 'ready',
  },
  lastRun: {
    type: Date,
    default: null,
  },
  pingCount: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

// Индекс для предотвращения дубликатов
pingSpreadsheetSchema.index({ projectId: 1, spreadsheetId: 1, gid: 1 }, { unique: true });

// Middleware для логирования
pingSpreadsheetSchema.pre('save', function(next) {
  console.log('[PingSpreadsheet] Creating new ping spreadsheet:', this.spreadsheetId);
  next();
});

pingSpreadsheetSchema.pre('findOneAndUpdate', function(next) {
  console.log('[PingSpreadsheet] Updating ping spreadsheet');
  next();
});

const PingSpreadsheet = mongoose.model('PingSpreadsheet', pingSpreadsheetSchema);

module.exports = PingSpreadsheet;


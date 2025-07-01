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
  scanCount: { type: Number, default: 0 }
});

// Уникальный индекс для предотвращения дублирования таблиц в рамках проекта
spreadsheetSchema.index({ projectId: 1, spreadsheetId: 1, gid: 1 }, { unique: true });

// Middleware для проверки дубликатов при обновлении
spreadsheetSchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate();
  const query = this.getQuery();
  const { projectId, spreadsheetId, gid } = update.$set || update;

  if (projectId && spreadsheetId && gid) {
    console.log(`Spreadsheet pre-update: Checking for duplicates, projectId=${projectId}, spreadsheetId=${spreadsheetId}, gid=${gid}, currentDocId=${query._id}`);
    try {
      const existing = await this.model.findOne({
        projectId,
        spreadsheetId,
        gid,
        _id: { $ne: query._id } // Исключаем текущую запись
      });
      if (existing) {
        console.error(`Spreadsheet pre-update: Duplicate found, projectId=${projectId}, spreadsheetId=${spreadsheetId}, gid=${gid}, existingDocId=${existing._id}`);
        const error = new Error('Spreadsheet with this spreadsheetId and gid already exists in the project');
        error.name = 'DuplicateSpreadsheetError';
        return next(error);
      }
      console.log(`Spreadsheet pre-update: No duplicates found, proceeding with update`);
      next();
    } catch (error) {
      console.error(`Spreadsheet pre-update: Error checking duplicates: ${error.message}`);
      next(error);
    }
  } else {
    console.log(`Spreadsheet pre-update: No relevant fields to check for duplicates`);
    next();
  }
});

module.exports = mongoose.model('Spreadsheet', spreadsheetSchema);
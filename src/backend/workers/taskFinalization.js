/**
 * taskFinalization.js - Финализация задач после завершения анализа
 * 
 * Обрабатывает завершение задач:
 * - Для Google Sheets: экспорт результатов, обновление статуса, планирование следующего запуска
 * - Для Manual Links: просто обновление статусов
 */

const FrontendLink = require('../models/FrontendLink');
const Spreadsheet = require('../models/Spreadsheet');
const AnalysisTask = require('../models/AnalysisTask');
const Project = require('../models/Project');
const User = require('../models/User');
const { exportLinksToGoogleSheetsBatch, formatGoogleSheet } = require('../controllers/googleSheetsUtils');
const { scheduleSpreadsheet } = require('../schedulers/agendaScheduler');
const { google } = require('googleapis');

/**
 * Получение имени листа по GID из Google Sheets
 * @param {string} spreadsheetId - ID Google Sheets
 * @param {number} gid - GID листа
 * @returns {Promise<string|null>} - Имя листа или null
 */
const getSheetNameByGid = async (spreadsheetId, gid) => {
  try {
    const path = require('path');
    const keyFilePath = path.resolve(__dirname, '../../../service-account.json');
    
    const auth = new google.auth.GoogleAuth({
      keyFile: keyFilePath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(sheetId,title))',
    });
    
    const sheet = response.data.sheets.find(s => s.properties.sheetId === parseInt(gid));
    return sheet ? sheet.properties.title : null;
  } catch (error) {
    console.error(`[TaskFinalization] Error getting sheet name:`, error.message);
    return null;
  }
};

/**
 * Финализация задачи Google Sheets после завершения анализа
 * @param {string} taskId - ID задачи
 * @param {string} projectId - ID проекта
 * @param {string} userId - ID пользователя
 * @param {string} spreadsheetId - ID Google Sheets
 */
const finalizeSpreadsheetTask = async (taskId, projectId, userId, spreadsheetId) => {
  console.log(`[TaskFinalization] 📊 Finalizing Google Sheets task ${taskId}`);
  
  try {
    // Получаем spreadsheet
    const spreadsheet = await Spreadsheet.findOne({ 
      _id: spreadsheetId,
      projectId 
    });
    
    if (!spreadsheet) {
      console.error(`[TaskFinalization] ❌ Spreadsheet ${spreadsheetId} not found`);
      return;
    }
    
    // Получаем имя листа по GID
    const sheetName = await getSheetNameByGid(spreadsheet.spreadsheetId, spreadsheet.gid);
    if (!sheetName) {
      throw new Error(`Sheet with GID ${spreadsheet.gid} not found in spreadsheet`);
    }
    
    console.log(`[TaskFinalization] 📋 Sheet name: ${sheetName}`);
    
    // Получаем все обработанные ссылки для этой таблицы
    const links = await FrontendLink.find({
      projectId,
      spreadsheetId,
      source: 'google_sheets',
      taskId
    }).sort({ rowIndex: 1 });
    
    if (links.length === 0) {
      console.warn(`[TaskFinalization] ⚠️ No links found for spreadsheet ${spreadsheetId}`);
      return;
    }
    
    console.log(`[TaskFinalization] 📝 Found ${links.length} links to export`);
    
    // Обновляем Spreadsheet с результатами
    spreadsheet.links = links.map(link => ({
      url: link.url,
      targetDomains: link.targetDomains,
      status: link.status,
      responseCode: link.responseCode,
      overallStatus: link.overallStatus,
      isIndexable: link.isIndexable,
      indexabilityStatus: link.indexabilityStatus,
      linkType: link.linkType,
      anchorText: link.anchorText,
      canonicalUrl: link.canonicalUrl,
      lastChecked: link.lastChecked,
      rowIndex: link.rowIndex,
    }));
    
    // Экспортируем результаты в Google Sheets
    console.log(`[TaskFinalization] 📤 Exporting results to Google Sheets...`);
    
    await exportLinksToGoogleSheetsBatch(
      spreadsheet.spreadsheetId,
      links,
      spreadsheet.resultRangeStart,
      spreadsheet.resultRangeEnd,
      sheetName
    );
    
    console.log(`[TaskFinalization] ✅ Results exported successfully`);
    
    // Форматируем таблицу
    console.log(`[TaskFinalization] 🎨 Formatting Google Sheet...`);
    const maxRow = Math.max(...links.map(link => link.rowIndex)) + 1;
    await formatGoogleSheet(
      spreadsheet.spreadsheetId,
      maxRow,
      spreadsheet.gid,
      spreadsheet.resultRangeStart,
      spreadsheet.resultRangeEnd
    );
    
    console.log(`[TaskFinalization] ✅ Sheet formatted successfully`);
    
    // Обновляем статус spreadsheet
    spreadsheet.status = 'completed';
    spreadsheet.lastRun = new Date();
    spreadsheet.scanCount = (spreadsheet.scanCount || 0) + 1;
    await spreadsheet.save();
    
    console.log(`[TaskFinalization] ✅ Spreadsheet status updated: completed (scan #${spreadsheet.scanCount})`);
    
    // Планируем следующий запуск через Agenda
    console.log(`[TaskFinalization] 📅 Scheduling next run (interval: ${spreadsheet.intervalHours} hours)...`);
    await scheduleSpreadsheet(spreadsheet);
    
    console.log(`[TaskFinalization] 🎉 Google Sheets task finalized successfully`);
    
  } catch (error) {
    console.error(`[TaskFinalization] ❌ Error finalizing spreadsheet task:`, error.message);
    console.error(error.stack);
    
    // Обновляем статус на error
    try {
      await Spreadsheet.findByIdAndUpdate(spreadsheetId, {
        status: 'error',
        lastRun: new Date(),
      });
      console.log(`[TaskFinalization] ⚠️ Spreadsheet status set to 'error'`);
    } catch (updateError) {
      console.error(`[TaskFinalization] ❌ Failed to update spreadsheet status:`, updateError.message);
    }
    
    throw error;
  }
};

/**
 * Финализация задачи Manual Links после завершения анализа
 * @param {string} taskId - ID задачи
 * @param {string} projectId - ID проекта
 * @param {string} userId - ID пользователя
 */
const finalizeManualLinksTask = async (taskId, projectId, userId) => {
  console.log(`[TaskFinalization] 📋 Finalizing Manual Links task ${taskId}`);
  
  try {
    // Для manual links просто обновляем статусы (результаты уже сохранены)
    const task = await AnalysisTask.findById(taskId);
    
    if (!task) {
      console.error(`[TaskFinalization] ❌ Task ${taskId} not found`);
      return;
    }
    
    // Обновляем проект
    const project = await Project.findById(projectId);
    if (project) {
      project.isAnalyzingManual = false;
      await project.save();
      console.log(`[TaskFinalization] ✅ Project.isAnalyzingManual = false`);
    }
    
    // Очищаем активную задачу у пользователя
    const user = await User.findById(userId);
    if (user && user.activeTasks) {
      user.activeTasks.delete(projectId.toString());
      await user.save();
      console.log(`[TaskFinalization] ✅ User active task cleared`);
    }
    
    console.log(`[TaskFinalization] 🎉 Manual Links task finalized successfully`);
    
  } catch (error) {
    console.error(`[TaskFinalization] ❌ Error finalizing manual links task:`, error.message);
    console.error(error.stack);
    throw error;
  }
};

/**
 * Универсальная финализация задачи (автоматически определяет тип)
 * @param {string} taskId - ID задачи
 */
const finalizeTask = async (taskId) => {
  try {
    const task = await AnalysisTask.findById(taskId);
    
    if (!task) {
      console.error(`[TaskFinalization] ❌ Task ${taskId} not found`);
      return;
    }
    
    const { projectId, userId, type, data } = task;
    
    // Обновляем статус задачи
    await AnalysisTask.findByIdAndUpdate(taskId, {
      status: 'completed',
      progress: 100,
      updatedAt: new Date(),
    });
    
    console.log(`[TaskFinalization] ✅ Task ${taskId} status updated to 'completed'`);
    
    // Финализация в зависимости от типа
    if (type === 'runSpreadsheetAnalysis' && data?.spreadsheetId) {
      // Google Sheets
      await finalizeSpreadsheetTask(taskId, projectId, userId, data.spreadsheetId);
      
      // Обновляем проект
      const project = await Project.findById(projectId);
      if (project) {
        project.isAnalyzingSpreadsheet = false;
        await project.save();
      }
      
    } else if (type === 'checkLinks') {
      // Manual Links
      await finalizeManualLinksTask(taskId, projectId, userId);
    }
    
    // Отправляем WebSocket событие о завершении анализа
    const { broadcastAnalysisComplete } = require('../utils/websocketBroadcast');
    broadcastAnalysisComplete(projectId.toString(), taskId.toString());
    
    console.log(`[TaskFinalization] 🎉 Task ${taskId} fully finalized`);
    
  } catch (error) {
    console.error(`[TaskFinalization] ❌ Error in finalizeTask:`, error.message);
    console.error(error.stack);
    
    // Обновляем статус на failed
    try {
      await AnalysisTask.findByIdAndUpdate(taskId, {
        status: 'failed',
        updatedAt: new Date(),
      });
    } catch (updateError) {
      console.error(`[TaskFinalization] ❌ Failed to update task status:`, updateError.message);
    }
  }
};

module.exports = {
  finalizeTask,
  finalizeSpreadsheetTask,
  finalizeManualLinksTask,
};


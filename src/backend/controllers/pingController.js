const PingSpreadsheet = require('../models/PingSpreadsheet');
const Project = require('../models/Project');
const User = require('../models/User');
const axios = require('axios');
const { google } = require('googleapis');
const path = require('path');

// Google Sheets API setup
const auth = new google.auth.GoogleAuth({
  keyFile: path.resolve(__dirname, '../../../service-account.json'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// Функция для нормализации URL (добавление протокола если отсутствует)
const normalizeUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return url;
  }
  
  // Убираем пробелы
  url = url.trim();
  
  // Если уже есть протокол - возвращаем как есть
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // Если начинается с //, добавляем https:
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  
  // Иначе добавляем https://
  return `https://${url}`;
};

// User agents для ротации
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
];

// Функция для пинга одного URL с множественными стратегиями
const pingUrl = async (url) => {
  const normalizedUrl = normalizeUrl(url);
  console.log(`[PingController] 🔍 Pinging URL: ${normalizedUrl} (original: ${url})`);
  
  // Стратегии пинга (от быстрой к медленной)
  const strategies = [
    { timeout: 10000, name: 'Fast' },
    { timeout: 20000, name: 'Medium' },
    { timeout: 30000, name: 'Slow' },
  ];
  
  let lastError = null;
  
  // Пробуем каждую стратегию
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    const userAgent = userAgents[i % userAgents.length];
    const startTime = Date.now(); // Выносим за пределы try
    
    try {
      console.log(`[PingController] Attempt ${i + 1}/${strategies.length} (${strategy.name}, timeout: ${strategy.timeout}ms)`);
      
      const response = await axios.get(normalizedUrl, {
        timeout: strategy.timeout,
        validateStatus: () => true, // Принимаем любой статус код
        maxRedirects: 5,
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache',
        },
      });
      const loadTime = Date.now() - startTime;
      
      console.log(`[PingController] ✅ URL ${normalizedUrl} responded with status: ${response.status}, time: ${loadTime}ms`);
      
      return {
        url: normalizedUrl,
        status: response.status,
        loadTime,
        success: response.status >= 200 && response.status < 400,
      };
    } catch (error) {
      const loadTime = Date.now() - startTime;
      lastError = error;
      console.warn(`[PingController] ⚠️ Attempt ${i + 1} failed for ${normalizedUrl}: ${error.code || error.message}`);
      
      // Если получили response в ошибке (например, 404, 500), возвращаем его
      if (error.response) {
        console.log(`[PingController] ⚡ Got error response with status: ${error.response.status}`);
        
        return {
          url: normalizedUrl,
          status: error.response.status,
          loadTime,
          success: error.response.status >= 200 && error.response.status < 400,
        };
      }
      
      // Если это не последняя стратегия, пробуем следующую
      if (i < strategies.length - 1) {
        console.log(`[PingController] 🔄 Trying next strategy...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Задержка между попытками
        continue;
      }
    }
  }
  
  // Все стратегии провалились
  console.error(`[PingController] ❌ All strategies failed for ${normalizedUrl}:`, lastError?.code || lastError?.message);
  
  // Определяем статус ошибки
  let errorStatus = 'Error';
  if (lastError) {
    if (lastError.code === 'ECONNABORTED' || lastError.code === 'ETIMEDOUT') {
      errorStatus = 'Timeout';
    } else if (lastError.code === 'ENOTFOUND' || lastError.code === 'EAI_AGAIN') {
      errorStatus = 'DNS Error';
    } else if (lastError.code === 'ECONNREFUSED') {
      errorStatus = 'Connection Refused';
    } else if (lastError.code === 'ECONNRESET') {
      errorStatus = 'Connection Reset';
    } else if (lastError.message.includes('certificate') || lastError.message.includes('SSL') || lastError.code === 'CERT_HAS_EXPIRED') {
      errorStatus = 'SSL Error';
    } else {
      errorStatus = lastError.code || 'Error';
    }
  }
  
  return {
    url: normalizedUrl,
    status: errorStatus,
    loadTime: 0,
    success: false,
    error: lastError?.message || 'Unknown error',
  };
};

// Функция для импорта URLs из Google Sheets
const importUrlsFromSheet = async (spreadsheetId, gid, urlColumn) => {
  try {
    console.log(`[PingController] Importing URLs from spreadsheet ${spreadsheetId}, gid ${gid}, column ${urlColumn}`);
    
    // Получаем информацию о листе по GID
    const spreadsheetInfo = await sheets.spreadsheets.get({
      spreadsheetId,
    });
    
    const sheet = spreadsheetInfo.data.sheets.find(s => s.properties.sheetId === parseInt(gid));
    if (!sheet) {
      throw new Error(`Sheet with GID ${gid} not found`);
    }
    
    const sheetName = sheet.properties.title;
    console.log(`[PingController] Found sheet name: ${sheetName}`);
    
    // Читаем данные из столбца с URLs
    const range = `${sheetName}!${urlColumn}2:${urlColumn}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    
    const rows = response.data.values || [];
    
    // Сохраняем URLs с их оригинальными индексами строк
    const urlsWithRows = [];
    rows.forEach((row, index) => {
      const url = row[0];
      if (url && url.trim() !== '') {
        urlsWithRows.push({
          url: normalizeUrl(url),
          rowIndex: index + 2, // +2 потому что начинаем со 2-й строки (1-я - заголовок)
        });
      }
    });
    
    console.log(`[PingController] Imported ${urlsWithRows.length} URLs (normalized) with row indices`);
    return { urlsWithRows, sheetName };
  } catch (error) {
    console.error('[PingController] Error importing URLs:', error.message);
    throw error;
  }
};

// Функция для экспорта результатов в Google Sheets
const exportResultsToSheet = async (spreadsheetId, gid, statusColumn, results, sheetName) => {
  try {
    console.log(`[PingController] Exporting ${results.length} results to ${statusColumn} column`);
    
    // Подготавливаем данные для batch update (каждый результат в свою строку)
    const data = results.map(result => ({
      range: `${sheetName}!${statusColumn}${result.rowIndex}`,
      values: [[result.status.toString()]],
    }));
    
    // Записываем результаты с помощью batchUpdate
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      resource: {
        valueInputOption: 'RAW',
        data: data,
      },
    });
    
    console.log(`[PingController] Successfully exported ${results.length} results to correct rows`);
  } catch (error) {
    console.error('[PingController] Error exporting results:', error.message);
    throw error;
  }
};

// Функция для форматирования столбца статусов в Google Sheets
const formatPingStatusColumn = async (spreadsheetId, gid, statusColumn, maxRows) => {
  try {
    console.log(`[PingController] Formatting status column ${statusColumn} in spreadsheet ${spreadsheetId}`);
    
    // Конвертируем букву столбца в индекс (A=0, B=1, C=2, ...)
    const columnIndex = statusColumn.toUpperCase().charCodeAt(0) - 65;
    
    // Запросы на форматирование
    const requests = [
      // Добавляем границы
      {
        updateBorders: {
          range: {
            sheetId: gid,
            startRowIndex: 1,
            endRowIndex: maxRows,
            startColumnIndex: columnIndex,
            endColumnIndex: columnIndex + 1,
          },
          top: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          bottom: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          left: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          right: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          innerHorizontal: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
          innerVertical: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        },
      },
      // Устанавливаем ширину столбца
      {
        updateDimensionProperties: {
          range: {
            sheetId: gid,
            dimension: 'COLUMNS',
            startIndex: columnIndex,
            endIndex: columnIndex + 1,
          },
          properties: { pixelSize: 120 },
          fields: 'pixelSize',
        },
      },
      // Условное форматирование: 200 -> Зеленый фон
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{
              sheetId: gid,
              startRowIndex: 1,
              endRowIndex: maxRows,
              startColumnIndex: columnIndex,
              endColumnIndex: columnIndex + 1,
            }],
            booleanRule: {
              condition: {
                type: 'TEXT_EQ',
                values: [{ userEnteredValue: '200' }],
              },
              format: {
                backgroundColor: { red: 0.83, green: 0.92, blue: 0.83 }, // Зеленый #D4ECD4
              },
            },
          },
          index: 0,
        },
      },
      // Условное форматирование: 301, 302, 303, 307, 308 -> Желтый фон
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{
              sheetId: gid,
              startRowIndex: 1,
              endRowIndex: maxRows,
              startColumnIndex: columnIndex,
              endColumnIndex: columnIndex + 1,
            }],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ 
                  userEnteredValue: `=OR(${String.fromCharCode(65 + columnIndex)}2="301",${String.fromCharCode(65 + columnIndex)}2="302",${String.fromCharCode(65 + columnIndex)}2="303",${String.fromCharCode(65 + columnIndex)}2="307",${String.fromCharCode(65 + columnIndex)}2="308")` 
                }],
              },
              format: {
                backgroundColor: { red: 1, green: 0.88, blue: 0.7 }, // Желтый #FFE0B3
              },
            },
          },
          index: 1,
        },
      },
      // Условное форматирование: 4xx, 5xx, Error, Timeout, DNS Error, SSL Error и т.д. -> Красный фон
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{
              sheetId: gid,
              startRowIndex: 1,
              endRowIndex: maxRows,
              startColumnIndex: columnIndex,
              endColumnIndex: columnIndex + 1,
            }],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ 
                  userEnteredValue: `=OR(LEFT(${String.fromCharCode(65 + columnIndex)}2,1)="4",LEFT(${String.fromCharCode(65 + columnIndex)}2,1)="5",${String.fromCharCode(65 + columnIndex)}2="Error",${String.fromCharCode(65 + columnIndex)}2="Timeout",${String.fromCharCode(65 + columnIndex)}2="DNS Error",${String.fromCharCode(65 + columnIndex)}2="SSL Error",${String.fromCharCode(65 + columnIndex)}2="Connection Refused",${String.fromCharCode(65 + columnIndex)}2="Connection Reset",ISNUMBER(SEARCH("Error",${String.fromCharCode(65 + columnIndex)}2)))` 
                }],
              },
              format: {
                backgroundColor: { red: 0.98, green: 0.82, blue: 0.82 }, // Красный #FADCDC
              },
            },
          },
          index: 2,
        },
      },
    ];
    
    // Применяем форматирование
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests },
    });
    
    console.log(`[PingController] Successfully formatted status column ${statusColumn}`);
  } catch (error) {
    console.error('[PingController] Error formatting status column:', error.message);
    throw error;
  }
};

// Добавление новой таблицы для пинга
const addPingSpreadsheet = async (req, res) => {
  const { projectId } = req.params;
  const { spreadsheetId, gid, urlColumn, statusColumn, intervalDays } = req.body;
  const userId = req.userId;
  
  try {
    console.log('[PingController] Adding ping spreadsheet:', { projectId, spreadsheetId, gid, urlColumn, statusColumn, intervalDays });
    
    // Валидация
    if (!spreadsheetId || gid === undefined || !urlColumn || !statusColumn || !intervalDays) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (![1, 3, 7, 14].includes(intervalDays)) {
      return res.status(400).json({ error: 'Invalid interval. Must be 1, 3, 7, or 14 days' });
    }
    
    // Проверка существования проекта
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Проверка дубликатов
    const existing = await PingSpreadsheet.findOne({
      projectId,
      spreadsheetId,
      gid: parseInt(gid),
    });
    
    if (existing) {
      return res.status(409).json({ error: 'This spreadsheet has already been added to the project' });
    }
    
    // Создаем новую запись
    const pingSpreadsheet = new PingSpreadsheet({
      spreadsheetId,
      gid: parseInt(gid),
      urlColumn,
      statusColumn,
      intervalDays,
      userId,
      projectId,
      status: 'ready',
    });
    
    await pingSpreadsheet.save();
    
    // Планируем первый запуск
    const { schedulePingSpreadsheet } = require('../schedulers/agendaScheduler');
    await schedulePingSpreadsheet(pingSpreadsheet);
    
    console.log('[PingController] Ping spreadsheet added successfully');
    res.status(201).json(pingSpreadsheet);
  } catch (error) {
    console.error('[PingController] Error adding ping spreadsheet:', error);
    res.status(500).json({ error: 'Failed to add ping spreadsheet', details: error.message });
  }
};

// Получение списка таблиц для пинга
const getPingSpreadsheets = async (req, res) => {
  const { projectId } = req.params;
  const userId = req.userId;
  
  try {
    const pingSpreadsheets = await PingSpreadsheet.find({ projectId, userId });
    res.json(pingSpreadsheets);
  } catch (error) {
    console.error('[PingController] Error fetching ping spreadsheets:', error);
    res.status(500).json({ error: 'Failed to fetch ping spreadsheets' });
  }
};

// Редактирование таблицы для пинга
const editPingSpreadsheet = async (req, res) => {
  const { projectId, pingSpreadsheetId } = req.params;
  const { spreadsheetId, gid, urlColumn, statusColumn, intervalDays } = req.body;
  const userId = req.userId;
  
  try {
    console.log('[PingController] Editing ping spreadsheet:', pingSpreadsheetId);
    
    // Валидация
    if (!spreadsheetId || gid === undefined || !urlColumn || !statusColumn || !intervalDays) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (![1, 3, 7, 14].includes(intervalDays)) {
      return res.status(400).json({ error: 'Invalid interval. Must be 1, 3, 7, or 14 days' });
    }
    
    // Находим таблицу
    const pingSpreadsheet = await PingSpreadsheet.findOne({
      _id: pingSpreadsheetId,
      projectId,
      userId,
    });
    
    if (!pingSpreadsheet) {
      return res.status(404).json({ error: 'Ping spreadsheet not found' });
    }
    
    // Проверка на дубликаты (кроме текущей)
    const duplicate = await PingSpreadsheet.findOne({
      _id: { $ne: pingSpreadsheetId },
      projectId,
      spreadsheetId,
      gid: parseInt(gid),
    });
    
    if (duplicate) {
      return res.status(409).json({ error: 'This spreadsheet has already been added to the project' });
    }
    
    // Обновляем данные
    pingSpreadsheet.spreadsheetId = spreadsheetId;
    pingSpreadsheet.gid = parseInt(gid);
    pingSpreadsheet.urlColumn = urlColumn;
    pingSpreadsheet.statusColumn = statusColumn;
    pingSpreadsheet.intervalDays = intervalDays;
    
    await pingSpreadsheet.save();
    
    // Перепланируем задачу
    const { cancelPingSpreadsheetSchedule, schedulePingSpreadsheet } = require('../schedulers/agendaScheduler');
    await cancelPingSpreadsheetSchedule(pingSpreadsheet._id);
    await schedulePingSpreadsheet(pingSpreadsheet);
    
    console.log('[PingController] Ping spreadsheet updated successfully');
    res.json(pingSpreadsheet);
  } catch (error) {
    console.error('[PingController] Error editing ping spreadsheet:', error);
    res.status(500).json({ error: 'Failed to edit ping spreadsheet', details: error.message });
  }
};

// Удаление таблицы для пинга
const deletePingSpreadsheet = async (req, res) => {
  const { projectId, pingSpreadsheetId } = req.params;
  const userId = req.userId;
  
  try {
    console.log('[PingController] Deleting ping spreadsheet:', pingSpreadsheetId);
    
    const pingSpreadsheet = await PingSpreadsheet.findOne({
      _id: pingSpreadsheetId,
      projectId,
      userId,
    });
    
    if (!pingSpreadsheet) {
      return res.status(404).json({ error: 'Ping spreadsheet not found' });
    }
    
    // Отменяем планирование
    const { cancelPingSpreadsheetSchedule } = require('../schedulers/agendaScheduler');
    await cancelPingSpreadsheetSchedule(pingSpreadsheet._id);
    
    await PingSpreadsheet.deleteOne({ _id: pingSpreadsheetId });
    
    console.log('[PingController] Ping spreadsheet deleted successfully');
    res.json({ message: 'Ping spreadsheet deleted successfully' });
  } catch (error) {
    console.error('[PingController] Error deleting ping spreadsheet:', error);
    res.status(500).json({ error: 'Failed to delete ping spreadsheet' });
  }
};

// Запуск пинга вручную
const runPingAnalysis = async (req, res) => {
  const { projectId, pingSpreadsheetId } = req.params;
  const userId = req.userId;
  
  try {
    console.log('[PingController] Running ping analysis for:', pingSpreadsheetId);
    
    const pingSpreadsheet = await PingSpreadsheet.findOne({
      _id: pingSpreadsheetId,
      projectId,
      userId,
    });
    
    if (!pingSpreadsheet) {
      return res.status(404).json({ error: 'Ping spreadsheet not found' });
    }
    
    if (pingSpreadsheet.status === 'checking') {
      return res.status(409).json({ error: 'Ping analysis is already in progress' });
    }
    
    // Запускаем анализ в фоне
    executePingAnalysis(pingSpreadsheet._id);
    
    res.json({ message: 'Ping analysis started' });
  } catch (error) {
    console.error('[PingController] Error starting ping analysis:', error);
    res.status(500).json({ error: 'Failed to start ping analysis', details: error.message });
  }
};

// Функция выполнения пинга (используется и планировщиком, и ручным запуском)
const executePingAnalysis = async (pingSpreadsheetId) => {
  let pingSpreadsheet;
  
  try {
    pingSpreadsheet = await PingSpreadsheet.findById(pingSpreadsheetId);
    if (!pingSpreadsheet) {
      console.error('[PingController] Ping spreadsheet not found:', pingSpreadsheetId);
      return;
    }
    
    console.log(`[PingController] Starting ping analysis for ${pingSpreadsheet.spreadsheetId}`);
    
    // Обновляем статус на "checking"
    pingSpreadsheet.status = 'checking';
    await pingSpreadsheet.save();
    
    // Отправляем WebSocket событие о начале
    const { broadcastPingStarted } = require('../utils/websocketBroadcast');
    broadcastPingStarted(pingSpreadsheet.projectId.toString(), pingSpreadsheet._id.toString());
    
    // Импортируем URLs с индексами строк
    const { urlsWithRows, sheetName } = await importUrlsFromSheet(
      pingSpreadsheet.spreadsheetId,
      pingSpreadsheet.gid,
      pingSpreadsheet.urlColumn
    );
    
    if (urlsWithRows.length === 0) {
      console.log('[PingController] No URLs found to ping');
      pingSpreadsheet.status = 'ready';
      await pingSpreadsheet.save();
      
      const { broadcastPingComplete } = require('../utils/websocketBroadcast');
      broadcastPingComplete(pingSpreadsheet.projectId.toString(), pingSpreadsheet._id.toString());
      return;
    }
    
    console.log(`[PingController] Pinging ${urlsWithRows.length} URLs`);
    
    // Пингуем URLs с ограничением параллельности (максимум 10 одновременно)
    const { default: pLimitModule } = await import('p-limit');
    const pLimit = pLimitModule;
    const limit = pLimit(10); // Максимум 10 параллельных пингов
    
    const results = await Promise.all(
      urlsWithRows.map((urlData) => 
        limit(async () => {
          console.log(`[PingController] Processing ${urlData.url} (row ${urlData.rowIndex})`);
          const pingResult = await pingUrl(urlData.url);
          return {
            ...pingResult,
            rowIndex: urlData.rowIndex, // Сохраняем индекс строки
          };
        })
      )
    );
    
    console.log(`[PingController] Completed pinging ${results.length} URLs`);
    
    // Экспортируем результаты
    await exportResultsToSheet(
      pingSpreadsheet.spreadsheetId,
      pingSpreadsheet.gid,
      pingSpreadsheet.statusColumn,
      results,
      sheetName
    );
    
    // Применяем форматирование к столбцу статусов
    // Находим максимальный rowIndex для определения диапазона форматирования
    const maxRowIndex = Math.max(...results.map(r => r.rowIndex));
    await formatPingStatusColumn(
      pingSpreadsheet.spreadsheetId,
      pingSpreadsheet.gid,
      pingSpreadsheet.statusColumn,
      maxRowIndex + 10 // maxRows с запасом
    );
    
    // Обновляем статус на "ready"
    pingSpreadsheet.status = 'ready';
    pingSpreadsheet.lastRun = new Date();
    pingSpreadsheet.pingCount += 1;
    await pingSpreadsheet.save();
    
    console.log(`[PingController] Ping analysis completed for ${pingSpreadsheet.spreadsheetId}`);
    
    // Отправляем WebSocket событие о завершении
    const { broadcastPingComplete } = require('../utils/websocketBroadcast');
    broadcastPingComplete(pingSpreadsheet.projectId.toString(), pingSpreadsheet._id.toString());
    
    // Планируем следующий запуск
    const { schedulePingSpreadsheet } = require('../schedulers/agendaScheduler');
    await schedulePingSpreadsheet(pingSpreadsheet);
    
  } catch (error) {
    console.error('[PingController] Error in ping analysis:', error);
    
    if (pingSpreadsheet) {
      pingSpreadsheet.status = 'error';
      await pingSpreadsheet.save();
      
      const { broadcastPingComplete } = require('../utils/websocketBroadcast');
      broadcastPingComplete(pingSpreadsheet.projectId.toString(), pingSpreadsheet._id.toString());
    }
  }
};

module.exports = {
  addPingSpreadsheet,
  getPingSpreadsheets,
  editPingSpreadsheet,
  deletePingSpreadsheet,
  runPingAnalysis,
  executePingAnalysis,
};


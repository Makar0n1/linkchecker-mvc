/**
 * websocketBroadcast.js - Утилиты для отправки WebSocket событий
 * 
 * Отдельный модуль чтобы избежать циклических зависимостей и
 * запуска сервера при импорте в воркерах
 */

let wssInstance = null;

/**
 * Инициализация WebSocket сервера
 * @param {WebSocket.Server} wss - Экземпляр WebSocket сервера
 */
const initializeWebSocket = (wss) => {
  wssInstance = wss;
  console.log('[WebSocket] Broadcast utilities initialized');
};

/**
 * Отправка события начала анализа
 * @param {string} projectId - ID проекта
 * @param {string} taskId - ID задачи
 */
const broadcastAnalysisStarted = (projectId, taskId) => {
  if (!wssInstance) {
    console.warn('[WebSocket] WSS not initialized, skipping broadcastAnalysisStarted');
    return;
  }
  
  console.log(`[WebSocket] Broadcasting analysisStarted for project ${projectId}, task ${taskId}`);
  
  wssInstance.clients.forEach((client) => {
    if (client.readyState === 1 && client.projectId === projectId) { // 1 = OPEN
      client.send(JSON.stringify({
        type: 'analysisStarted',
        projectId: projectId,
        taskId: taskId,
      }));
    }
  });
};

/**
 * Отправка события завершения анализа
 * @param {string} projectId - ID проекта
 * @param {string} taskId - ID задачи
 */
const broadcastAnalysisComplete = (projectId, taskId) => {
  if (!wssInstance) {
    console.warn('[WebSocket] WSS not initialized, skipping broadcastAnalysisComplete');
    return;
  }
  
  console.log(`[WebSocket] Broadcasting analysisComplete for project ${projectId}, task ${taskId}`);
  
  wssInstance.clients.forEach((client) => {
    if (client.readyState === 1 && client.projectId === projectId) { // 1 = OPEN
      client.send(JSON.stringify({
        type: 'analysisComplete',
        projectId: projectId,
        taskId: taskId,
      }));
    }
  });
};

/**
 * Отправка обновления прогресса
 * @param {string} projectId - ID проекта
 * @param {object} progressData - Данные прогресса
 */
const broadcastProgress = (projectId, progressData) => {
  if (!wssInstance) {
    console.warn('[WebSocket] WSS not initialized, skipping broadcastProgress');
    return;
  }
  
  wssInstance.clients.forEach((client) => {
    if (client.readyState === 1 && client.projectId === projectId) { // 1 = OPEN
      client.send(JSON.stringify({
        type: 'progress',
        data: progressData,
      }));
    }
  });
};

/**
 * Отправка события начала пинга
 * @param {string} projectId - ID проекта
 * @param {string} pingSpreadsheetId - ID таблицы для пинга
 */
const broadcastPingStarted = (projectId, pingSpreadsheetId) => {
  if (!wssInstance) {
    console.warn('[WebSocket] WSS not initialized, skipping broadcastPingStarted');
    return;
  }
  
  console.log(`[WebSocket] Broadcasting pingStarted for project ${projectId}, pingSpreadsheet ${pingSpreadsheetId}`);
  
  wssInstance.clients.forEach((client) => {
    if (client.readyState === 1 && client.projectId === projectId) { // 1 = OPEN
      client.send(JSON.stringify({
        type: 'pingStarted',
        projectId: projectId,
        pingSpreadsheetId: pingSpreadsheetId,
      }));
    }
  });
};

/**
 * Отправка события завершения пинга
 * @param {string} projectId - ID проекта
 * @param {string} pingSpreadsheetId - ID таблицы для пинга
 */
const broadcastPingComplete = (projectId, pingSpreadsheetId) => {
  if (!wssInstance) {
    console.warn('[WebSocket] WSS not initialized, skipping broadcastPingComplete');
    return;
  }
  
  console.log(`[WebSocket] Broadcasting pingComplete for project ${projectId}, pingSpreadsheet ${pingSpreadsheetId}`);
  
  wssInstance.clients.forEach((client) => {
    if (client.readyState === 1 && client.projectId === projectId) { // 1 = OPEN
      client.send(JSON.stringify({
        type: 'pingComplete',
        projectId: projectId,
        pingSpreadsheetId: pingSpreadsheetId,
      }));
    }
  });
};

module.exports = {
  initializeWebSocket,
  broadcastAnalysisStarted,
  broadcastAnalysisComplete,
  broadcastProgress,
  broadcastPingStarted,
  broadcastPingComplete,
};


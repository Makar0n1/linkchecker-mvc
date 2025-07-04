const { google } = require('googleapis');
const path = require('path');

const sheets = google.sheets({
  version: 'v4',
  auth: new google.auth.GoogleAuth({
    keyFile: path.resolve(__dirname, '../../../service-account.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  }),
});

const importFromGoogleSheets = async (spreadsheetId, defaultTargetDomain, urlColumn, targetColumn, gid) => {
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const sheet = spreadsheet.data.sheets.find(sheet => sheet.properties.sheetId === parseInt(gid));
    if (!sheet) {
      console.error(`Sheet with GID ${gid} not found in spreadsheet ${spreadsheetId}`);
      return { links: [], sheetName: null };
    }

    const sheetName = sheet.properties.title;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!${urlColumn}2:${targetColumn}`,
    });

    const rows = response.data.values || [];
    console.log(`Imported rows from "${sheetName}" (${spreadsheetId}, GID: ${gid}): ${rows.length}`);
    const links = rows
      .map((row, index) => {
        const url = row[0];
        const targetDomainsRaw = row[row.length - 1] && row[row.length - 1].trim() ? row[row.length - 1] : defaultTargetDomain;
        const targetDomains = targetDomainsRaw.split('\n').map(domain => domain.trim()).filter(domain => domain);
        return {
          url,
          targetDomains: targetDomains.length > 0 ? targetDomains : [defaultTargetDomain],
          rowIndex: index + 2,
          spreadsheetId,
        };
      })
      .filter(link => link.url);
    return { links, sheetName };
  } catch (error) {
    console.error(`Error importing from Google Sheets ${spreadsheetId}:`, error);
    return { links: [], sheetName: null };
  }
};

const exportLinksToGoogleSheetsBatch = async (spreadsheetId, links, resultRangeStart, resultRangeEnd, sheetName) => {
  try {
    // Подготовка данных для экспорта
    const dataMap = {};
    const scanDate = new Date().toISOString().split('T')[0]; // Дата сканирования в формате YYYY-MM-DD
    links.forEach(link => {
      const responseCode = link.responseCode || (link.status === 'timeout' ? 'Timeout' : '200');
      const isLinkFound = link.status === 'active' && link.rel !== 'not found';
      dataMap[link.rowIndex] = [
        (responseCode === '200' || responseCode === '304') && link.isIndexable && isLinkFound ? 'OK' : 'Problem',
        responseCode,
        link.isIndexable === null ? 'Unknown' : link.isIndexable ? 'Yes' : 'No',
        link.isIndexable === false ? link.indexabilityStatus : '',
        isLinkFound ? `True  (${scanDate})` : `False (${scanDate})`, // Наличие ссылки с датой
      ];
    });

    // Определяем диапазоны для записи
    const rowIndices = Object.keys(dataMap).map(Number).sort((a, b) => a - b);
    if (rowIndices.length === 0) {
      console.log(`No data to export for spreadsheet ${spreadsheetId}`);
      return;
    }

    // Вычисляем конечный столбец (например, P)
    const startCol = resultRangeStart.match(/^[A-Z]+/)[0];
    const endCol = String.fromCharCode(resultRangeStart.charCodeAt(0) + 4); // L + 4 = P
    const batchUpdates = [];
    let currentStartRow = rowIndices[0];
    let currentValues = [];
    let previousRow = currentStartRow - 1;

    for (const rowIndex of rowIndices) {
      if (rowIndex !== previousRow + 1) {
        // Завершаем текущий диапазон и начинаем новый
        if (currentValues.length > 0) {
          const range = `${sheetName}!${startCol}${currentStartRow}:${endCol}${previousRow}`;
          batchUpdates.push({
            range,
            values: currentValues,
          });
        }
        currentStartRow = rowIndex;
        currentValues = [];
      }
      currentValues.push(dataMap[rowIndex]);
      previousRow = rowIndex;
    }

    // Добавляем последний диапазон
    if (currentValues.length > 0) {
      const range = `${sheetName}!${startCol}${currentStartRow}:${endCol}${previousRow}`;
      batchUpdates.push({
        range,
        values: currentValues,
      });
    }

    console.log(`Exporting ${links.length} rows to ${spreadsheetId}: ${JSON.stringify(batchUpdates)}`);

    // Формируем batch-запрос
    const request = {
      spreadsheetId,
      resource: {
        valueInputOption: 'RAW',
        data: batchUpdates,
      },
    };

    // Отправляем batch-запрос
    const response = await sheets.spreadsheets.values.batchUpdate(request);
    console.log(`Successfully updated ${response.data.totalUpdatedCells} cells in Google Sheets`);
  } catch (error) {
    console.error(`Error exporting to Google Sheets (${spreadsheetId}):`, error.message);
    throw error;
  }
};

const checkResultRangeEmpty = async (spreadsheetId, gid, resultRangeStart, resultRangeEnd) => {
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const sheet = spreadsheet.data.sheets.find(sheet => sheet.properties.sheetId === parseInt(gid));
    if (!sheet) {
      console.error(`checkResultRangeEmpty: Sheet with GID ${gid} not found in spreadsheet ${spreadsheetId}`);
      throw new Error(`Sheet with GID ${gid} not found`);
    }

    const sheetName = sheet.properties.title;
    const startCol = resultRangeStart.match(/^[A-Z]+/)[0];
    const endCol = resultRangeEnd.match(/^[A-Z]+/)[0];
    const range = `${sheetName}!${startCol}2:${endCol}`;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values || [];
    console.log(`checkResultRangeEmpty: Checked range ${range} in spreadsheet ${spreadsheetId}, found ${rows.length} rows`);

    const nonEmptyCells = [];
    rows.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (cell && cell.trim()) {
          const colLetter = String.fromCharCode(startCol.charCodeAt(0) + colIndex);
          nonEmptyCells.push(`${colLetter}${rowIndex + 2}`);
        }
      });
    });

    if (nonEmptyCells.length > 0) {
      console.warn(`checkResultRangeEmpty: Non-empty cells found in range ${range}: ${nonEmptyCells.join(', ')}`);
      return {
        isEmpty: false,
        warning: `Указанный диапазон (${range}) содержит данные в ячейках: ${nonEmptyCells.join(', ')}. Пожалуйста, сохраните ваши данные и очистите или переформатируйте этот диапазон перед анализом, так как он будет перезаписан результатами анализа ссылок.`,
      };
    }

    console.log(`checkResultRangeEmpty: Range ${range} is empty`);
    return { isEmpty: true };
  } catch (error) {
    console.error(`checkResultRangeEmpty: Error checking range in spreadsheet ${spreadsheetId}:`, error.message);
    return { isEmpty: true, warning: `Не удалось проверить диапазон ${range} из-за ошибки: ${error.message}. Добавление таблицы продолжается.` };
  }
};

const formatGoogleSheet = async (spreadsheetId, maxRows, gid, resultRangeStart, resultRangeEnd) => {
  console.log(`Formatting sheet ${spreadsheetId} (gid: ${gid})...`);
  const startColumnIndex = columnLetterToIndex(resultRangeStart);
  const endColumnIndex = columnLetterToIndex(resultRangeEnd) + 1; // +1, так как endColumnIndex не включён

  const requests = [
    {
      repeatCell: {
        range: { sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex, endColumnIndex },
        cell: { userEnteredFormat: { textFormat: { fontFamily: 'Arial', fontSize: 11 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      updateBorders: {
        range: { sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex, endColumnIndex },
        top: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        bottom: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        left: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        right: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        innerHorizontal: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        innerVertical: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: gid, dimension: 'COLUMNS', startIndex: startColumnIndex, endIndex: endColumnIndex },
        properties: { pixelSize: 120 },
        fields: 'pixelSize'
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex, endColumnIndex: startColumnIndex + 1 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'OK' }] }, format: { backgroundColor: { red: 0.83, green: 0.92, blue: 0.83 } } }
        },
        index: 0
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex, endColumnIndex: startColumnIndex + 1 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Problem' }] }, format: { backgroundColor: { red: 0.98, green: 0.82, blue: 0.82 } } }
        },
        index: 1
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: startColumnIndex + 2, endColumnIndex: startColumnIndex + 3 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Yes' }] }, format: { textFormat: { foregroundColor: { red: 0, green: 0.4, blue: 0 } } } }
        },
        index: 2
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: startColumnIndex + 2, endColumnIndex: startColumnIndex + 3 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'No' }] }, format: { textFormat: { foregroundColor: { red: 0.8, green: 0, blue: 0 } } } }
        },
        index: 3
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: startColumnIndex + 2, endColumnIndex: startColumnIndex + 3 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Unknown' }] }, format: { textFormat: { foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 } } } }
        },
        index: 4
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: startColumnIndex + 4, endColumnIndex: startColumnIndex + 5 }],
          booleanRule: { condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'True' }] }, format: { backgroundColor: { red: 0.83, green: 0.92, blue: 0.83 } } }
        },
        index: 5
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: startColumnIndex + 4, endColumnIndex: startColumnIndex + 5 }],
          booleanRule: { condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'False' }] }, format: { backgroundColor: { red: 1, green: 0.88, blue: 0.7 } } }
        },
        index: 6
      }
    }
  ];
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests }
    });
    console.log(`Sheet formatted: ${spreadsheetId} (gid: ${gid})`);
  } catch (error) {
    console.error(`Error formatting sheet ${spreadsheetId}:`, error);
  }
};

const columnLetterToIndex = (letter) => {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index *= 26;
    index += letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1;
  }
  return index - 1;
};

module.exports = {
  importFromGoogleSheets,
  exportLinksToGoogleSheetsBatch,
  formatGoogleSheet,
  columnLetterToIndex,
  checkResultRangeEmpty,
};
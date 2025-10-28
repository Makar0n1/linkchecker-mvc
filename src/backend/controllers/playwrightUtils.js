/**
 * playwrightUtils.js - Утилиты для работы с Playwright браузером
 * 
 * Заменяет browserUtils.js (Puppeteer) на более стабильный и быстрый Playwright.
 * 
 * Ключевые улучшения:
 * - Один браузер для всех задач (переиспользование через контексты)
 * - Ограничение количества контекстов для управления памятью
 * - Автоматическое закрытие при graceful shutdown
 * - Более стабильная работа с SSL и редиректами
 */

const { chromium } = require('playwright');

// Глобальный браузер (переиспользуется)
let browser = null;

// Максимум контекстов одновременно (для управления памятью)
const MAX_CONTEXTS = 5;

// Хранилище активных контекстов
const contexts = new Set();

/**
 * Инициализация браузера (создается один раз)
 * @returns {Promise<Browser>}
 */
const initializeBrowser = async () => {
  if (!browser || !browser.isConnected()) {
    console.log('[PlaywrightUtils] Initializing Playwright browser...');
    
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-gpu',
          '--disable-dev-shm-usage',
        ],
        timeout: 60000,
      });
      
      console.log('[PlaywrightUtils] ✅ Playwright browser initialized successfully');
    } catch (error) {
      console.error('[PlaywrightUtils] ❌ Failed to initialize browser:', error.message);
      throw error;
    }
  }
  
  return browser;
};

/**
 * Создание нового контекста браузера (изолированная сессия)
 * @param {Object} options - Опции контекста
 * @returns {Promise<BrowserContext>}
 */
const createContext = async (options = {}) => {
  const browser = await initializeBrowser();
  
  // Ограничиваем количество контекстов
  if (contexts.size >= MAX_CONTEXTS) {
    console.log(`[PlaywrightUtils] ⚠️ Max contexts (${MAX_CONTEXTS}) reached, closing oldest...`);
    const oldestContext = contexts.values().next().value;
    await oldestContext.close().catch(err => 
      console.error('[PlaywrightUtils] Error closing old context:', err.message)
    );
    contexts.delete(oldestContext);
  }
  
  // Создаем новый контекст
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
    ...options,
  });
  
  contexts.add(context);
  console.log(`[PlaywrightUtils] 📄 New context created (total: ${contexts.size}/${MAX_CONTEXTS})`);
  
  return context;
};

/**
 * Закрытие контекста
 * @param {BrowserContext} context
 */
const closeContext = async (context) => {
  if (context) {
    try {
      await context.close();
      contexts.delete(context);
      console.log(`[PlaywrightUtils] ✅ Context closed (remaining: ${contexts.size})`);
    } catch (err) {
      console.error('[PlaywrightUtils] ❌ Error closing context:', err.message);
    }
  }
};

/**
 * Закрытие всех контекстов
 */
const closeAllContexts = async () => {
  console.log(`[PlaywrightUtils] Closing all contexts (${contexts.size})...`);
  
  for (const context of contexts) {
    await context.close().catch(err => 
      console.error('[PlaywrightUtils] Error closing context:', err.message)
    );
  }
  
  contexts.clear();
  console.log('[PlaywrightUtils] ✅ All contexts closed');
};

/**
 * Закрытие браузера
 */
const closeBrowser = async () => {
  if (browser) {
    console.log('[PlaywrightUtils] Closing browser...');
    
    // Закрываем все контексты
    await closeAllContexts();
    
    // Закрываем браузер
    try {
      await browser.close();
      browser = null;
      console.log('[PlaywrightUtils] ✅ Browser closed successfully');
    } catch (err) {
      console.error('[PlaywrightUtils] ❌ Error closing browser:', err.message);
    }
  }
};

/**
 * Перезапуск браузера (при критических ошибках)
 */
const restartBrowser = async () => {
  console.log('[PlaywrightUtils] ⚠️ Restarting browser due to error...');
  await closeBrowser();
  return await initializeBrowser();
};

/**
 * Разрешение коротких URL (bit.ly, и т.д.)
 * @param {string} shortUrl - Короткий URL
 * @returns {Promise<string>} - Разрешенный URL
 */
const resolveShortUrl = async (shortUrl) => {
  let context;
  let page;
  
  try {
    console.log(`[PlaywrightUtils] Resolving short URL: ${shortUrl}`);
    
    context = await createContext();
    page = await context.newPage();
    
    const response = await page.goto(shortUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 10000 
    });
    
    const resolvedUrl = page.url();
    console.log(`[PlaywrightUtils] ✅ Resolved: ${shortUrl} -> ${resolvedUrl}`);
    
    return resolvedUrl;
  } catch (error) {
    console.error(`[PlaywrightUtils] ❌ Error resolving short URL ${shortUrl}:`, error.message);
    return shortUrl;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    if (context) {
      await closeContext(context);
    }
  }
};

/**
 * Получение информации о браузере
 * @returns {Object}
 */
const getBrowserInfo = () => {
  return {
    isInitialized: browser !== null && browser.isConnected(),
    activeContexts: contexts.size,
    maxContexts: MAX_CONTEXTS,
  };
};

// Graceful shutdown при SIGINT (Ctrl+C)
process.on('SIGINT', async () => {
  console.log('[PlaywrightUtils] SIGINT received, closing browser...');
  await closeBrowser();
});

// Graceful shutdown при SIGTERM
process.on('SIGTERM', async () => {
  console.log('[PlaywrightUtils] SIGTERM received, closing browser...');
  await closeBrowser();
});

// Обработка необработанных ошибок
process.on('unhandledRejection', async (reason, promise) => {
  console.error('[PlaywrightUtils] Unhandled Rejection:', reason);
  // Не закрываем браузер при необработанной ошибке, только логируем
});

module.exports = {
  initializeBrowser,
  createContext,
  closeContext,
  closeAllContexts,
  closeBrowser,
  restartBrowser,
  resolveShortUrl,
  getBrowserInfo,
};


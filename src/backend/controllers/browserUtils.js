const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin())

const initializeBrowser = async () => {
  console.log('Initializing new browser for task...');
  const browser = await puppeteer.launch({
    //executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: [
      '--no-sandbox',
      '--ignore-certificate-errors',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1920,1080',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--allow-running-insecure-content',
    ],
    ignoreHTTPSErrors: true,
    timeout: 60000,
  });
  console.log('New browser initialized');
  return browser;
};

const closeBrowser = async (browser) => {
  if (browser) {
    await browser.close();
    console.log('Browser closed');
  }
};

const restartBrowser = async () => {
  console.log('Restarting global browser due to error...');
  await closeBrowser();
  return await initializeBrowser();
};

const resolveShortUrl = async (shortUrl) => {
    let tempBrowser;
    try {
      tempBrowser = await initializeBrowser();
      const tempPage = await tempBrowser.newPage();
      const response = await tempPage.goto(shortUrl, { waitUntil: ['domcontentloaded', 'networkidle2'], timeout: 10000 });
      const resolvedUrl = response.url();
      await tempPage.close();
      return resolvedUrl;
    } catch (error) {
      console.error(`Error resolving short URL ${shortUrl}:`, error);
      return shortUrl;
    } finally {
      if (tempBrowser) {
        await tempBrowser.close().catch(err => console.error(`Error closing temp browser for short URL: ${err}`));
      }
    }
  };

module.exports = {
  initializeBrowser,
  closeBrowser,
  restartBrowser,
  resolveShortUrl,
};
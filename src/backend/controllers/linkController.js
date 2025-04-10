const Link = require('../models/Link');
const FrontendLink = require('../models/FrontendLink');
const Spreadsheet = require('../models/Spreadsheet');
const User = require('../models/User');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { Solver } = require('2captcha');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { google } = require('googleapis');
const path = require('path');

const solver = new Solver(process.env.TWOCAPTCHA_API_KEY);
const JWT_SECRET = process.env.JWT_SECRET;

const sheets = google.sheets({
  version: 'v4',
  auth: new google.auth.GoogleAuth({
    keyFile: path.resolve(__dirname, '../../../service-account.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  }),
});

let pLimit;
(async () => {
  pLimit = (await import('p-limit')).default;
})();

const authMiddleware = async (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const superAdminMiddleware = async (req, res, next) => {
  const user = await User.findById(req.userId);
  if (!user || !user.isSuperAdmin) return res.status(403).json({ error: 'SuperAdmin access required' });
  next();
};

const registerUser = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const user = new User({ username, password }); // Без isSuperAdmin, только через терминал
    await user.save();
    res.status(201).json({ message: 'User registered', userId: user._id });
  } catch (error) {
    res.status(400).json({ error: 'Username taken or invalid data' });
  }
};

const loginUser = async (req, res) => {
  const { username, password } = req.body;
  console.log('Login attempt:', { username, password });
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    console.log('Searching for user:', username);
    const user = await User.findOne({ username });
    if (!user) {
      console.log('User not found:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    console.log('User found:', user._id);
    console.log('Comparing password...');
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log('Password mismatch');
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    console.log('Password match');
    console.log('JWT_SECRET:', process.env.JWT_SECRET);
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });
    console.log('Token generated:', token);
    res.json({ token, isSuperAdmin: user.isSuperAdmin });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
};

const getUserInfo = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching user info' });
  }
};

const checkLinkStatus = async (link) => {
  let browser;
  try {
    console.log(`Checking URL: ${link.url} for domain: ${link.targetDomain}`);

    // Массив User-Agent'ов и заголовков
    const userAgents = [
      {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Connection': 'keep-alive',
          'Referer': 'https://www.google.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1'
        }
      },
      {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://www.bing.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"macOS"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-User': '?1'
        }
      },
      {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://duckduckgo.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1'
        }
      },
      {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.52',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Connection': 'keep-alive',
          'Referer': 'https://www.google.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Microsoft Edge";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1'
        }
      },
      {
        ua: 'Mozilla/5.0 (Linux; Android 14; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://www.google.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'Sec-Ch-Ua-Mobile': '?1',
          'Sec-Ch-Ua-Platform': '"Android"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1'
        }
      },
      {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://www.apple.com/',
          'Upgrade-Insecure-Requests': '1'
        }
      },
      {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://www.youtube.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Google Chrome";v="128", "Not;A=Brand";v="8", "Chromium";v="128"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-User': '?1'
        }
      },
      {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:130.0) Gecko/20100101 Firefox/130.0',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Referer': 'https://www.mozilla.org/',
          'Upgrade-Insecure-Requests': '1'
        }
      },
      {
        ua: 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 Edge/129.0.2792.52',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://www.microsoft.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Microsoft Edge";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'Sec-Ch-Ua-Mobile': '?1',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1'
        }
      },
      {
        ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Connection': 'keep-alive',
          'Referer': 'https://www.google.com/',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Linux"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1'
        }
      }
    ];

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1920,1080'
      ],
      timeout: 60000
    });
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);

    const randomAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    await page.setUserAgent(randomAgent.ua);
    await page.setExtraHTTPHeaders(randomAgent.headers);

    await page.setViewport({ width: 1920, height: 1080 });

    const startTime = Date.now();
    let response;
    try {
      response = await page.goto(link.url, { waitUntil: 'networkidle0', timeout: 60000 });
      console.log(`Page loaded with status: ${response.status()}`);
      link.responseCode = response.status().toString();
    } catch (error) {
      console.error(`Navigation failed for ${link.url}:`, error.message);
      link.status = 'timeout';
      link.errorDetails = error.message;
      link.isIndexable = false;
      link.indexabilityStatus = 'timeout';
      link.responseCode = 'Timeout';
    }
    const loadTime = Date.now() - startTime;
    link.loadTime = loadTime;

    if (response && response.status() !== 200) {
      link.isIndexable = false;
      link.indexabilityStatus = `HTTP ${response.status()}`;
      link.status = response.status() >= 400 ? 'broken' : 'redirect';
    }

    console.log('Waiting for meta robots or links (5 seconds)...');
    await page.waitForFunction(
      () => document.querySelector('meta[name="robots"]') || document.querySelector(`a[href*="${link.targetDomain}"]`),
      { timeout: 5000 }
    ).catch(() => console.log('Timeout waiting for meta or links, proceeding with evaluate...'));

    const randomDelay = Math.floor(Math.random() * 5000) + 5000;
    await new Promise(resolve => setTimeout(resolve, randomDelay));
    const content = await page.evaluate(() => document.documentElement.outerHTML);

    const $ = cheerio.load(content);
    console.log(`Total links found in HTML: ${$('a').length}`);

    let metaRobots = '';
    try {
      metaRobots = await page.$eval('meta[name="robots"]', el => el?.content) || '';
      const robotsValues = metaRobots.toLowerCase().split(',').map(val => val.trim());
      if (robotsValues.includes('noindex')) {
        link.isIndexable = false;
        link.indexabilityStatus = 'noindex';
      } else {
        link.isIndexable = link.responseCode === '200';
        link.indexabilityStatus = link.isIndexable ? 'indexable' : `HTTP ${link.responseCode}`;
      }
    } catch (error) {
      console.log('No meta robots tag found, assuming indexable if 200');
      link.isIndexable = link.responseCode === '200';
      link.indexabilityStatus = link.isIndexable ? 'indexable' : link.responseCode === 'Timeout' ? 'timeout' : `HTTP ${link.responseCode}`;
    }

    if (link.isIndexable) {
      try {
        const canonical = await page.$eval('link[rel="canonical"]', el => el?.href);
        if (canonical) {
          link.canonicalUrl = canonical;
          const currentUrl = link.url.toLowerCase().replace(/\/$/, '');
          const canonicalNormalized = canonical.toLowerCase().replace(/\/$/, '');
          if (currentUrl !== canonicalNormalized) {
            link.indexabilityStatus = 'canonical mismatch';
          }
        }
      } catch (error) {
        console.log('No canonical tag found');
        link.canonicalUrl = null;
      }
    }

    const cleanTargetDomain = link.targetDomain
      .replace(/^https?:\/\//, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    console.log(`Cleaned targetDomain: ${cleanTargetDomain}`);

    let linksFound = null;

    $('a').each((i, a) => {
      const href = $(a).attr('href')?.toLowerCase().trim();
      if (href && href.includes(cleanTargetDomain)) {
        const anchorText = $(a).text().trim();
        const hasSvg = $(a).find('svg').length > 0;
        const hasImg = $(a).find('img').length > 0;
        const hasIcon = $(a).find('i').length > 0;
        const hasChildren = $(a).children().length > 0;
        linksFound = {
          href: href,
          rel: $(a).attr('rel') || '',
          anchorText: anchorText || (hasSvg ? 'SVG link' : hasImg ? 'Image link' : hasIcon ? 'Icon link' : hasChildren ? 'Element link' : 'no text')
        };
        console.log(`Link found: ${JSON.stringify(linksFound)}`);
        return false;
      }
    });

    console.log('Links found:', linksFound ? JSON.stringify(linksFound) : 'None');

    let captchaType = 'none';
    if ($('.cf-turnstile').length > 0) captchaType = 'Cloudflare Turnstile';
    else if ($('.g-recaptcha').length > 0) captchaType = 'Google reCAPTCHA';
    else if ($('.h-captcha').length > 0) captchaType = 'hCaptcha';
    else if ($('form[action*="/cdn-cgi/"]').length > 0) captchaType = 'Cloudflare Challenge Page';
    else if ($('body').text().toLowerCase().includes('verify you are not a robot')) captchaType = 'Unknown CAPTCHA';

    if (captchaType !== 'none') console.log(`CAPTCHA detected: ${captchaType}`);

    if (linksFound) {
      link.status = 'active';
      link.rel = linksFound.rel;
      link.anchorText = linksFound.anchorText;
      const relValues = linksFound.rel ? linksFound.rel.toLowerCase().split(' ') : [];
      link.linkType = relValues.some(value => ['nofollow', 'ugc', 'sponsored'].includes(value)) ? 'nofollow' : 'dofollow';
      link.errorDetails = captchaType !== 'none' ? `${captchaType} detected but link found` : link.errorDetails || '';
    } else if (captchaType !== 'none') {
      link.status = 'suspected-captcha';
      link.rel = 'blocked';
      link.linkType = 'unknown';
      link.anchorText = 'captcha suspected';
      link.errorDetails = `CAPTCHA detected: ${captchaType}`;
    } else if (!link.status || link.status === 'pending') {
      link.status = 'active';
      link.rel = 'not found';
      link.linkType = 'unknown';
      link.anchorText = 'not found';
      link.errorDetails = link.errorDetails || '';
    }

    link.lastChecked = new Date();
    return link;
  } catch (error) {
    console.error(`Error checking ${link.url}:`, error.message);
    link.status = 'broken';
    link.errorDetails = error.message;
    link.rel = 'error';
    link.linkType = 'unknown';
    link.anchorText = 'error';
    link.isIndexable = false;
    link.indexabilityStatus = `check failed: ${error.message}`;
    link.responseCode = 'Error';
    return link;
  } finally {
    if (browser) await browser.close();
  }
};

const processLinksInBatches = async (links, batchSize = 5) => {
  if (!pLimit) await new Promise(resolve => setTimeout(resolve, 100));
  const limit = pLimit(10);
  const results = [];
  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize);
    console.log(`Processing batch of ${batch.length} links`);
    const batchResults = await Promise.all(batch.map(link => limit(() => checkLinkStatus(link))));
    results.push(...batchResults);
    console.log(`Batch completed, processed ${i + batch.length} of ${links.length} links`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return results;
};

const addLinks = async (req, res) => {
  const linksData = Array.isArray(req.body) ? req.body : [req.body];
  if (!linksData.every(item => item.url && item.targetDomain)) {
    return res.status(400).json({ error: 'Each item must have url and targetDomain' });
  }
  try {
    const newLinks = [];
    for (const { url, targetDomain } of linksData) {
      const newLink = new FrontendLink({ url, targetDomain, userId: req.userId });
      await newLink.save();
      newLinks.push(newLink);
    }
    res.status(201).json(newLinks);
  } catch (error) {
    res.status(500).json({ error: 'Error adding links' });
  }
};

const getLinks = async (req, res) => {
  try {
    const links = await FrontendLink.find({ userId: req.userId });
    res.json(links);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching links' });
  }
};

const deleteLink = async (req, res) => {
  const { id } = req.params;
  try {
    const deletedLink = await FrontendLink.findOneAndDelete({ _id: id, userId: req.userId });
    if (!deletedLink) return res.status(404).json({ error: 'Link not found' });
    res.json({ message: 'Link deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting link' });
  }
};

const deleteAllLinks = async (req, res) => {
  try {
    await FrontendLink.deleteMany({ userId: req.userId });
    res.json({ message: 'All links deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting all links' });
  }
};

const checkLinks = async (req, res) => {
  try {
    const links = await FrontendLink.find({ userId: req.userId });
    const updatedLinks = await processLinksInBatches(links, 5);
    await Promise.all(updatedLinks.map(link => link.save()));
    res.json(updatedLinks);
  } catch (error) {
    res.status(500).json({ error: 'Error checking links' });
  }
};

const addSpreadsheet = async (req, res) => {
  const { spreadsheetId, gid, targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours } = req.body;
  if (!spreadsheetId || !gid || !targetDomain || !urlColumn || !targetColumn || !resultRangeStart || !resultRangeEnd || !intervalHours) {
    return res.status(400).json({ error: 'All fields required' });
  }
  try {
    const spreadsheet = new Spreadsheet({
      spreadsheetId,
      gid: parseInt(gid),
      targetDomain,
      urlColumn,
      targetColumn,
      resultRangeStart,
      resultRangeEnd,
      intervalHours: parseInt(intervalHours),
      userId: req.userId
    });
    await spreadsheet.save();
    res.status(201).json(spreadsheet);
  } catch (error) {
    res.status(500).json({ error: 'Error adding spreadsheet' });
  }
};

const getSpreadsheets = async (req, res) => {
  try {
    const spreadsheets = await Spreadsheet.find({ userId: req.userId });
    res.json(spreadsheets);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching spreadsheets' });
  }
};

const deleteSpreadsheet = async (req, res) => {
  const { spreadsheetId } = req.params;
  try {
    const spreadsheet = await Spreadsheet.findOneAndDelete({ _id: spreadsheetId, userId: req.userId });
    if (!spreadsheet) return res.status(404).json({ error: 'Spreadsheet not found' });
    res.json({ message: 'Spreadsheet deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting spreadsheet' });
  }
};

const runSpreadsheetAnalysis = async (req, res) => {
  const { spreadsheetId } = req.params;
  try {
    const spreadsheet = await Spreadsheet.findOne({ _id: spreadsheetId, userId: req.userId });
    if (!spreadsheet) return res.status(404).json({ error: 'Spreadsheet not found' });
    spreadsheet.status = 'running';
    await spreadsheet.save();
    try {
      await analyzeSpreadsheet(spreadsheet);
      spreadsheet.status = 'completed';
    } catch (error) {
      spreadsheet.status = 'error';
      await spreadsheet.save();
      throw error;
    }
    spreadsheet.lastRun = new Date();
    await spreadsheet.save();
    res.json({ message: 'Analysis completed' });
  } catch (error) {
    console.error('Error in runSpreadsheetAnalysis:', error);
    res.status(500).json({ error: 'Error running analysis' });
  }
};

const analyzeSpreadsheet = async (spreadsheet) => {
  const links = await importFromGoogleSheets(spreadsheet.spreadsheetId, spreadsheet.targetDomain, spreadsheet.urlColumn, spreadsheet.targetColumn);
  await Link.deleteMany({ spreadsheetId: spreadsheet.spreadsheetId });
  await Link.insertMany(links);
  const dbLinks = await Link.find({ spreadsheetId: spreadsheet.spreadsheetId });
  await analyzeLinksBatch(dbLinks, spreadsheet.spreadsheetId, 10, spreadsheet.resultRangeStart, spreadsheet.resultRangeEnd);
  await formatGoogleSheet(spreadsheet.spreadsheetId, Math.max(...dbLinks.map(link => link.rowIndex)) + 1, spreadsheet.gid);
  await Link.deleteMany({ spreadsheetId: spreadsheet.spreadsheetId });
};

const importFromGoogleSheets = async (spreadsheetId, defaultTargetDomain, urlColumn, targetColumn) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `All links!${urlColumn}2:${targetColumn}`,
    });
    const rows = response.data.values || [];
    console.log(`Imported rows from "All links" (${spreadsheetId}): ${rows.length}`);
    return rows
      .map((row, index) => ({
        url: row[0],
        targetDomain: row[row.length - 1] && row[row.length - 1].trim() ? row[row.length - 1] : defaultTargetDomain,
        rowIndex: index + 2,
        spreadsheetId
      }))
      .filter(link => link.url);
  } catch (error) {
    console.error(`Error importing from Google Sheets ${spreadsheetId}:`, error);
    return [];
  }
};

const analyzeLinksBatch = async (links, spreadsheetId, batchSize, resultRangeStart, resultRangeEnd) => {
  if (!pLimit) await new Promise(resolve => setTimeout(resolve, 100));
  const limit = pLimit(10);
  const results = [];
  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize);
    console.log(`Processing batch of ${batch.length} links for ${spreadsheetId}`);
    const batchResults = await Promise.all(batch.map(link => limit(() => checkLinkStatus(link))));
    await Promise.all(batchResults.map(result => exportLinkToGoogleSheets(spreadsheetId, result, resultRangeStart, resultRangeEnd)));
    results.push(...batchResults);
    console.log(`Batch completed for ${spreadsheetId}, processed ${i + batch.length} of ${links.length} links`);
  }
  return results;
};

const exportLinkToGoogleSheets = async (spreadsheetId, link, resultRangeStart, resultRangeEnd) => {
  const responseCode = link.responseCode || (link.status === 'timeout' ? 'Timeout' : '200');
  const isLinkFound = link.status === 'active' && link.rel !== 'not found';
  const value = [
    responseCode === '200' && link.isIndexable && isLinkFound ? 'OK' : 'Problem',
    responseCode,
    link.isIndexable === null ? 'Unknown' : link.isIndexable ? 'Yes' : 'No',
    link.isIndexable === false ? link.indexabilityStatus : '',
    isLinkFound ? 'True' : 'False'
  ];
  const range = `All links!${resultRangeStart}${link.rowIndex}:${resultRangeEnd}${link.rowIndex}`;
  console.log(`Exporting to ${range} (${spreadsheetId}): ${value}`);
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      resource: { values: [value] }
    });
  } catch (error) {
    console.error(`Error exporting to ${range} (${spreadsheetId}):`, error);
  }
};

const formatGoogleSheet = async (spreadsheetId, maxRows, gid) => {
  console.log(`Formatting sheet ${spreadsheetId} (gid: ${gid})...`);
  const requests = [
    {
      repeatCell: {
        range: { sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: 11, endColumnIndex: 16 },
        cell: { userEnteredFormat: { textFormat: { fontFamily: 'Arial', fontSize: 11 } } },
        fields: 'userEnteredFormat.textFormat'
      }
    },
    {
      updateBorders: {
        range: { sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: 11, endColumnIndex: 16 },
        top: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        bottom: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        left: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        right: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        innerHorizontal: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } },
        innerVertical: { style: 'SOLID', width: 1, color: { red: 0, green: 0, blue: 0 } }
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 11, endIndex: 16 },
        properties: { pixelSize: 120 },
        fields: 'pixelSize'
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: 11, endColumnIndex: 12 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'OK' }] }, format: { backgroundColor: { red: 0.83, green: 0.92, blue: 0.83 } } }
        },
        index: 0
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: 11, endColumnIndex: 12 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Problem' }] }, format: { backgroundColor: { red: 0.98, green: 0.82, blue: 0.82 } } }
        },
        index: 1
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: 13, endColumnIndex: 14 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Yes' }] }, format: { textFormat: { foregroundColor: { red: 0, green: 0.4, blue: 0 } } } }
        },
        index: 2
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: 13, endColumnIndex: 14 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'No' }] }, format: { textFormat: { foregroundColor: { red: 0.8, green: 0, blue: 0 } } } }
        },
        index: 3
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: 13, endColumnIndex: 14 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Unknown' }] }, format: { textFormat: { foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 } } } }
        },
        index: 4
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: 15, endColumnIndex: 16 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'True' }] }, format: { backgroundColor: { red: 0.83, green: 0.92, blue: 0.83 } } }
        },
        index: 5
      }
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: maxRows, startColumnIndex: 15, endColumnIndex: 16 }],
          booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'False' }] }, format: { backgroundColor: { red: 1, green: 0.88, blue: 0.7 } } }
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

module.exports = {
  registerUser,
  loginUser,
  getUserInfo: [authMiddleware, getUserInfo],
  addLinks: [authMiddleware, addLinks],
  getLinks: [authMiddleware, getLinks],
  deleteLink: [authMiddleware, deleteLink],
  deleteAllLinks: [authMiddleware, deleteAllLinks],
  checkLinks: [authMiddleware, checkLinks],
  addSpreadsheet: [authMiddleware, superAdminMiddleware, addSpreadsheet],
  getSpreadsheets: [authMiddleware, superAdminMiddleware, getSpreadsheets],
  runSpreadsheetAnalysis: [authMiddleware, superAdminMiddleware, runSpreadsheetAnalysis],
  deleteSpreadsheet: [authMiddleware, superAdminMiddleware, deleteSpreadsheet],
  checkLinkStatus,
  analyzeSpreadsheet
};
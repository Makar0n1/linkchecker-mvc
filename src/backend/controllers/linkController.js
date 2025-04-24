const FrontendLink = require('../models/FrontendLink');
const Spreadsheet = require('../models/Spreadsheet');
const User = require('../models/User');
const Project = require('../models/Project'); // Добавляем модель Project
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
  if (!token) {
    console.log('authMiddleware: No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log(`authMiddleware: Token verified, userId: ${decoded.userId}`);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    console.error('authMiddleware: Invalid token', error);
    res.status(401).json({ error: 'Invalid token' });
  }
};

const superAdminMiddleware = async (req, res, next) => {
  const user = await User.findById(req.userId);
  if (!user || !user.isSuperAdmin) {
    console.log(`superAdminMiddleware: Access denied for user ${req.userId}`);
    return res.status(403).json({ error: 'SuperAdmin access required' });
  }
  next();
};

const registerUser = async (req, res) => {
  const { username, password, isSuperAdmin } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const user = new User({
      username,
      password,
      isSuperAdmin: isSuperAdmin || false,
      plan: isSuperAdmin ? 'enterprise' : 'free',
      subscriptionStatus: isSuperAdmin ? 'active' : 'inactive'
    });
    await user.save();
    res.status(201).json({ message: 'User registered', userId: user._id });
  } catch (error) {
    console.error('registerUser: Error registering user', error);
    res.status(400).json({ error: 'Username taken or invalid data' });
  }
};

const loginUser = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, isSuperAdmin: user.isSuperAdmin, plan: user.plan });
  } catch (error) {
    console.error('loginUser: Error logging in', error);
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
};

const getUserInfo = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    console.error('getUserInfo: Error fetching user info', error);
    res.status(500).json({ error: 'Error fetching user info', details: error.message });
  }
};

// Функции для работы с проектами
const createProject = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });

  try {
    const project = new Project({
      name,
      userId: req.userId,
      links: [],
    });
    await project.save();
    res.status(201).json(project);
  } catch (error) {
    console.error('createProject: Error creating project', error);
    res.status(500).json({ error: 'Error creating project', details: error.message });
  }
};

const getProjects = async (req, res) => {
  try {
    const projects = await Project.find({ userId: req.userId });
    res.json(projects);
  } catch (error) {
    console.error('getProjects: Error fetching projects', error);
    res.status(500).json({ error: 'Error fetching projects', details: error.message });
  }
};

const deleteProject = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Удаляем все ссылки, связанные с проектом
    await FrontendLink.deleteMany({ projectId });
    await Project.deleteOne({ _id: projectId, userId: req.userId });
    res.json({ message: 'Project deleted' });
  } catch (error) {
    console.error('deleteProject: Error deleting project', error);
    res.status(500).json({ error: 'Error deleting project', details: error.message });
  }
};

// Функции для работы с ссылками (в рамках проекта)
const addLinks = async (req, res) => {
  const { projectId } = req.params;
  const linksData = Array.isArray(req.body) ? req.body : [req.body];
  if (!linksData.every(item => item && typeof item.url === 'string' && item.url.trim() && item.targetDomain)) {
    return res.status(400).json({ error: 'Each item must have a valid url (non-empty string) and targetDomain' });
  }

  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const now = new Date();
    if (now.getMonth() !== user.lastReset.getMonth()) {
      user.linksCheckedThisMonth = 0;
      user.lastReset = now;
    }

    const planLimits = {
      free: 100,
      basic: 10000,
      pro: 50000,
      premium: 200000,
      enterprise: Infinity
    };
    const newLinksCount = linksData.length;
    if (!user.isSuperAdmin && user.linksCheckedThisMonth + newLinksCount > planLimits[user.plan]) {
      return res.status(403).json({ message: 'Link limit exceeded for your plan' });
    }

    const newLinks = [];
    for (const { url, targetDomain } of linksData) {
      const newLink = new FrontendLink({ url, targetDomain, projectId });
      await newLink.save();
      newLinks.push(newLink);
    }

    project.links.push(...newLinks.map(link => link._id));
    await project.save();

    user.linksCheckedThisMonth += newLinksCount;
    await user.save();
    res.status(201).json(newLinks);
  } catch (error) {
    console.error('addLinks: Error adding links', error);
    res.status(500).json({ error: 'Error adding links', details: error.message });
  }
};

const getLinks = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const links = await FrontendLink.find({ projectId });
    res.json(links);
  } catch (error) {
    console.error('getLinks: Error fetching links', error);
    res.status(500).json({ error: 'Error fetching links', details: error.message });
  }
};

const deleteLink = async (req, res) => {
  const { projectId, id } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const deletedLink = await FrontendLink.findOneAndDelete({ _id: id, projectId });
    if (!deletedLink) return res.status(404).json({ error: 'Link not found' });

    project.links = project.links.filter(linkId => linkId.toString() !== id);
    await project.save();

    res.json({ message: 'Link deleted' });
  } catch (error) {
    console.error('deleteLink: Error deleting link', error);
    res.status(500).json({ error: 'Error deleting link', details: error.message });
  }
};

const deleteAllLinks = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    await FrontendLink.deleteMany({ projectId });
    project.links = [];
    await project.save();

    res.json({ message: 'All links deleted' });
  } catch (error) {
    console.error('deleteAllLinks: Error deleting all links', error);
    res.status(500).json({ error: 'Error deleting all links', details: error.message });
  }
};

const checkLinks = async (req, res) => {
  const { projectId } = req.params;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const links = await FrontendLink.find({ projectId });

    const planConcurrency = {
      free: 5,
      basic: 20,
      pro: 50,
      premium: 100,
      enterprise: 200
    };
    const concurrency = user.isSuperAdmin ? 200 : planConcurrency[user.plan];

    const updatedLinks = await processLinksInBatches(links, 5, concurrency);
    await Promise.all(updatedLinks.map(link => link.save()));
    res.json(updatedLinks);
  } catch (error) {
    console.error('checkLinks: Error checking links', error);
    res.status(500).json({ error: 'Error checking links', details: error.message });
  }
};

// Остальные функции (без изменений)
const selectPlan = async (req, res) => {
  const { plan } = req.body;
  const validPlans = ['free', 'basic', 'pro', 'premium', 'enterprise'];
  if (!validPlans.includes(plan)) {
    return res.status(400).json({ message: 'Invalid plan' });
  }

  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isSuperAdmin) {
      return res.status(403).json({ message: 'SuperAdmin cannot change plan' });
    }
    user.plan = plan;
    user.subscriptionStatus = 'pending';
    await user.save();
    res.json({ message: 'Plan selected, please proceed to payment' });
  } catch (error) {
    console.error('selectPlan: Error selecting plan', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const processPayment = async (req, res) => {
  const { cardNumber, cardHolder, expiryDate, cvv, autoPay } = req.body;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.isSuperAdmin) {
      return res.status(403).json({ message: 'SuperAdmin does not need to pay' });
    }

    if (cardNumber && cardHolder && expiryDate && cvv) {
      user.paymentDetails = { cardNumber, cardHolder, expiryDate, cvv };
    }
    user.autoPay = autoPay || false;
    if (user.subscriptionStatus === 'pending') {
      user.subscriptionStatus = 'active';
      user.subscriptionEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    await user.save();
    res.json({ message: user.subscriptionStatus === 'pending' ? 'Payment successful, plan activated' : 'Payment details updated' });
  } catch (error) {
    console.error('processPayment: Error processing payment', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const cancelSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isSuperAdmin) {
      return res.status(403).json({ message: 'SuperAdmin cannot cancel subscription' });
    }

    const spreadsheets = await Spreadsheet.find({ userId: req.userId });
    for (const spreadsheet of spreadsheets) {
      spreadsheet.status = 'inactive';
      await spreadsheet.save();
    }
    await Spreadsheet.deleteMany({ userId: req.userId });

    user.plan = 'free';
    user.subscriptionStatus = 'inactive';
    user.subscriptionEnd = null;
    user.autoPay = false;
    await user.save();
    res.json({ message: 'Subscription cancelled, reverted to Free plan' });
  } catch (error) {
    console.error('cancelSubscription: Error cancelling subscription', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const deleteAccount = async (req, res) => {
  try {
    if (!req.userId) {
      console.error('deleteAccount: req.userId is undefined');
      return res.status(400).json({ error: 'User ID is missing' });
    }

    console.log(`deleteAccount: Starting account deletion for user ${req.userId}`);
    const user = await User.findById(req.userId);
    if (!user) {
      console.error(`deleteAccount: User not found for ID ${req.userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.isSuperAdmin) {
      console.log(`deleteAccount: Attempt to delete SuperAdmin account (ID: ${req.userId})`);
      return res.status(403).json({ message: 'SuperAdmin cannot delete their account' });
    }

    console.log(`deleteAccount: Deleting Projects and FrontendLinks for user ${req.userId}`);
    const projects = await Project.find({ userId: req.userId });
    const projectIds = projects.map(project => project._id);
    await FrontendLink.deleteMany({ projectId: { $in: projectIds } });
    await Project.deleteMany({ userId: req.userId });

    console.log(`deleteAccount: Deleting Spreadsheets for user ${req.userId}`);
    const spreadsheetsResult = await Spreadsheet.deleteMany({ userId: req.userId });
    console.log(`deleteAccount: Deleted ${spreadsheetsResult.deletedCount} Spreadsheets`);

    console.log(`deleteAccount: Deleting user ${req.userId}`);
    const userDeleteResult = await User.findByIdAndDelete(req.userId);
    if (!userDeleteResult) {
      console.error(`deleteAccount: Failed to delete user ${req.userId}, user not found`);
      return res.status(404).json({ error: 'User not found during deletion' });
    }

    console.log(`deleteAccount: Account deleted successfully for user ${req.userId}`);
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error(`deleteAccount: Error deleting account for user ${req.userId}:`, error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.profile = req.body;
    await user.save();
    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('updateProfile: Error updating profile', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const checkLinkStatus = async (link) => {
  let browser;
  try {
    console.log(`Checking URL: ${link.url} for domain: ${link.targetDomain}`);

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
    let content = await page.evaluate(() => document.documentElement.outerHTML);

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
    let captchaType = 'none';
    let captchaToken = null;

    if ($('.cf-turnstile').length > 0) captchaType = 'Cloudflare Turnstile';
    else if ($('.g-recaptcha').length > 0) captchaType = 'Google reCAPTCHA';
    else if ($('.h-captcha').length > 0) captchaType = 'hCaptcha';
    else if ($('form[action*="/cdn-cgi/"]').length > 0) captchaType = 'Cloudflare Challenge Page';
    else if ($('div[id*="arkose"]').length > 0 || $('script[src*="arkoselabs"]').length > 0) captchaType = 'FunCaptcha';
    else if ($('div[class*="geetest"]').length > 0) captchaType = 'GeeTest';
    else if ($('img[src*="captcha"]').length > 0 || $('input[placeholder*="enter code"]').length > 0) captchaType = 'Image CAPTCHA';
    else if ($('body').text().toLowerCase().includes('verify you are not a robot')) captchaType = 'Custom CAPTCHA';

    if (captchaType !== 'none') console.log(`CAPTCHA detected: ${captchaType}`);

    if (captchaType !== 'none') {
      try {
        const currentPageUrl = await page.url();
        console.log(`Current page URL after redirects: ${currentPageUrl}`);

        const captchaParams = {
          pageurl: currentPageUrl
        };

        if (captchaType === 'Google reCAPTCHA') {
          const sitekey = await page.$eval('.g-recaptcha', el => el.getAttribute('data-sitekey'));
          if (!sitekey) throw new Error('Could not extract sitekey for Google reCAPTCHA');
          captchaParams.sitekey = sitekey;
          console.log(`Extracted sitekey for Google reCAPTCHA: ${sitekey}`);

          const captchaResponse = await solver.recaptcha(captchaParams);
          captchaToken = captchaResponse.code;
          console.log(`Google reCAPTCHA solved: ${captchaToken}`);

          await page.evaluate(token => {
            const textarea = document.querySelector('#g-recaptcha-response');
            if (textarea) textarea.innerHTML = token;
          }, captchaToken);

          const submitButton = await page.$('button[type="submit"], input[type="submit"]');
          if (submitButton) {
            await submitButton.click();
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
            content = await page.evaluate(() => document.documentElement.outerHTML);
          }
        } else if (captchaType === 'Cloudflare Turnstile') {
          const sitekey = await page.$eval('.cf-turnstile', el => el.getAttribute('data-sitekey'));
          if (!sitekey) throw new Error('Could not extract sitekey for Cloudflare Turnstile');
          captchaParams.sitekey = sitekey;
          console.log(`Extracted sitekey for Cloudflare Turnstile: ${sitekey}`);

          const captchaResponse = await solver.turnstile(captchaParams);
          captchaToken = captchaResponse.code;
          console.log(`Cloudflare Turnstile solved: ${captchaToken}`);

          await page.evaluate(token => {
            const input = document.querySelector('input[name="cf-turnstile-response"]');
            if (input) input.value = token;
          }, captchaToken);

          const submitButton = await page.$('button[type="submit"], input[type="submit"]');
          if (submitButton) {
            await submitButton.click();
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
            content = await page.evaluate(() => document.documentElement.outerHTML);
          }
        } else if (captchaType === 'hCaptcha') {
          const sitekey = await page.$eval('.h-captcha', el => el.getAttribute('data-sitekey'));
          if (!sitekey) throw new Error('Could not extract sitekey for hCaptcha');
          captchaParams.sitekey = sitekey;
          console.log(`Extracted sitekey for hCaptcha: ${sitekey}`);

          captchaParams.invisible = await page.evaluate(() => !document.querySelector('.h-captcha').classList.contains('visible'));

          const captchaResponse = await solver.hcaptcha(captchaParams);
          captchaToken = captchaResponse.code;
          console.log(`hCaptcha solved: ${captchaToken}`);

          await page.evaluate(token => {
            const textarea = document.querySelector('#h-captcha-response');
            if (textarea) textarea.innerHTML = token;
          }, captchaToken);

          const submitButton = await page.$('button[type="submit"], input[type="submit"]');
          if (submitButton) {
            await submitButton.click();
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
            content = await page.evaluate(() => document.documentElement.outerHTML);
          }
        } else if (captchaType === 'FunCaptcha') {
          const sitekey = await page.evaluate(() => {
            const script = document.querySelector('script[src*="arkoselabs"]');
            return script ? new URL(script.src).searchParams.get('pk') : null;
          });
          if (!sitekey) throw new Error('Could not extract sitekey for FunCaptcha');
          captchaParams.publickey = sitekey;
          console.log(`Extracted publickey for FunCaptcha: ${sitekey}`);

          const captchaResponse = await solver.funcaptcha(captchaParams);
          captchaToken = captchaResponse.code;
          console.log(`FunCaptcha solved: ${captchaToken}`);

          await page.evaluate(token => {
            const input = document.querySelector('input[name="fc-token"]');
            if (input) input.value = token;
          }, captchaToken);

          const submitButton = await page.$('button[type="submit"], input[type="submit"]');
          if (submitButton) {
            await submitButton.click();
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
            content = await page.evaluate(() => document.documentElement.outerHTML);
          }
        } else if (captchaType === 'GeeTest') {
          const geeTestParams = await page.evaluate(() => {
            const gt = document.querySelector('script[src*="geetest"]')?.src.match(/gt=([^&]+)/)?.[1];
            const challenge = document.querySelector('script[src*="geetest"]')?.src.match(/challenge=([^&]+)/)?.[1];
            return { gt, challenge };
          });
          if (!geeTestParams.gt || !geeTestParams.challenge) throw new Error('Could not extract parameters for GeeTest');
          captchaParams.gt = geeTestParams.gt;
          captchaParams.challenge = geeTestParams.challenge;
          console.log(`Extracted parameters for GeeTest: gt=${geeTestParams.gt}, challenge=${geeTestParams.challenge}`);

          const captchaResponse = await solver.geetest(captchaParams);
          captchaToken = captchaResponse;
          console.log(`GeeTest solved: ${JSON.stringify(captchaToken)}`);

          await page.evaluate(params => {
            Object.keys(params).forEach(key => {
              const input = document.createElement('input');
              input.type = 'hidden';
              input.name = key;
              input.value = params[key];
              document.forms[0]?.appendChild(input);
            });
          }, captchaToken);

          const submitButton = await page.$('button[type="submit"], input[type="submit"]');
          if (submitButton) {
            await submitButton.click();
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
            content = await page.evaluate(() => document.documentElement.outerHTML);
          }
        } else if (captchaType === 'Image CAPTCHA') {
          const captchaImageUrl = await page.$eval('img[src*="captcha"]', el => el.src);
          if (!captchaImageUrl) throw new Error('Could not extract CAPTCHA image URL');
          console.log(`Extracted CAPTCHA image URL: ${captchaImageUrl}`);

          const captchaResponse = await solver.imageCaptcha({
            body: captchaImageUrl,
            numeric: false,
            min_len: 4,
            max_len: 6
          });
          captchaToken = captchaResponse.code;
          console.log(`Image CAPTCHA solved: ${captchaToken}`);

          await page.type('input[placeholder*="enter code"], input[name*="captcha"]', captchaToken);

          const submitButton = await page.$('button[type="submit"], input[type="submit"]');
          if (submitButton) {
            await submitButton.click();
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
            content = await page.evaluate(() => document.documentElement.outerHTML);
          }
        } else if (captchaType === 'Cloudflare Challenge Page') {
          await page.waitForSelector('input[name="cf_captcha_kind"]', { timeout: 10000 });
          const sitekey = await page.$eval('input[name="cf_captcha_kind"]', el => el.getAttribute('data-sitekey'));
          if (sitekey) {
            captchaParams.sitekey = sitekey;
            console.log(`Extracted sitekey for Cloudflare Challenge Page: ${sitekey}`);

            const captchaResponse = await solver.turnstile(captchaParams);
            captchaToken = captchaResponse.code;
            console.log(`Cloudflare Challenge Page solved: ${captchaToken}`);

            await page.evaluate(token => {
              const input = document.querySelector('input[name="cf-turnstile-response"]');
              if (input) input.value = token;
            }, captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              await submitButton.click();
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else {
            console.log('Cloudflare Challenge Page does not require CAPTCHA solving, waiting for redirect...');
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
            content = await page.evaluate(() => document.documentElement.outerHTML);
          }
        } else if (captchaType === 'Custom CAPTCHA') {
          console.log('Custom CAPTCHA detected, attempting to solve as Image CAPTCHA if possible...');
          const captchaImageUrl = await page.$eval('img[src*="captcha"]', el => el.src, { timeout: 5000 }).catch(() => null);
          if (captchaImageUrl) {
            console.log(`Extracted CAPTCHA image URL: ${captchaImageUrl}`);
            const captchaResponse = await solver.imageCaptcha({
              body: captchaImageUrl,
              numeric: false,
              min_len: 4,
              max_len: 6
            });
            captchaToken = captchaResponse.code;
            console.log(`Custom CAPTCHA (Image) solved: ${captchaToken}`);

            await page.type('input[placeholder*="enter code"], input[name*="captcha"]', captchaToken);

            const submitButton = await page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              await submitButton.click();
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
              content = await page.evaluate(() => document.documentElement.outerHTML);
            }
          } else {
            throw new Error('Custom CAPTCHA not supported for automated solving');
          }
        }

        $ = cheerio.load(content);
      } catch (error) {
        console.error(`Error solving CAPTCHA for ${link.url}:`, error.message);
        link.status = 'suspected-captcha';
        link.rel = 'blocked';
        link.linkType = 'unknown';
        link.anchorText = 'captcha suspected';
        link.errorDetails = `CAPTCHA solving failed: ${error.message}`;
        return link;
      }
    }

    $('a').each((i, a) => {
      const href = $(a).attr('href')?.toLowerCase().trim();
      if (href && href.includes(cleanTargetDomain)) {
        const anchorText = $(a).text().trim();
        const hasSvg = $(a).find('svg').length > 0;
        const hasImg = $(a).find('img').length > 0;
        const hasIcon = $(a).find('i').length > 0;
        const hasChildren = $(a).find('children').length > 0;
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

    if (linksFound) {
      link.status = 'active';
      link.rel = linksFound.rel;
      link.anchorText = linksFound.anchorText;
      const relValues = linksFound.rel ? linksFound.rel.toLowerCase().split(' ') : [];
      link.linkType = relValues.some(value => ['nofollow', 'ugc', 'sponsored'].includes(value)) ? 'nofollow' : 'dofollow';
      link.errorDetails = captchaType !== 'none' ? `${captchaType} solved, token: ${captchaToken}` : link.errorDetails || '';
    } else if (captchaType !== 'none') {
      link.status = 'suspected-captcha';
      link.rel = 'blocked';
      link.linkType = 'unknown';
      link.anchorText = 'captcha suspected';
      link.errorDetails = captchaToken ? `${captchaType} solved but no links found, token: ${captchaToken}` : `CAPTCHA detected: ${captchaType}`;
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

const processLinksInBatches = async (links, batchSize = 5, concurrency) => {
  if (!pLimit) await new Promise(resolve => setTimeout(resolve, 100));
  const limit = pLimit(concurrency);
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

const addSpreadsheet = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.isSuperAdmin && user.plan === 'free') {
      return res.status(403).json({ message: 'Google Sheets integration is not available on Free plan' });
    }

    const spreadsheets = await Spreadsheet.find({ userId: user.id });
    const planLimits = {
      basic: 1,
      pro: 5,
      premium: 20,
      enterprise: Infinity
    };
    const maxSpreadsheets = user.isSuperAdmin ? Infinity : planLimits[user.plan];
    if (spreadsheets.length >= maxSpreadsheets) {
      return res.status(403).json({ message: 'Spreadsheet limit exceeded for your plan' });
    }

    const { spreadsheetId, gid, targetDomain, urlColumn, targetColumn, resultRangeStart, resultRangeEnd, intervalHours } = req.body;
    if (!spreadsheetId || !gid || !targetDomain || !urlColumn || !targetColumn || !resultRangeStart || !resultRangeEnd || !intervalHours) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const planIntervalLimits = {
      basic: 24,
      pro: 4,
      premium: 1,
      enterprise: 1
    };
    const minInterval = user.isSuperAdmin ? 1 : planIntervalLimits[user.plan];
    if (parseInt(intervalHours) < minInterval) {
      return res.status(403).json({ message: `Interval must be at least ${minInterval} hours for your plan` });
    }

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
    console.error('addSpreadsheet: Error adding spreadsheet', error);
    res.status(500).json({ error: 'Error adding spreadsheet', details: error.message });
  }
};

const getSpreadsheets = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const spreadsheets = await Spreadsheet.find({ userId: req.userId });
    res.json(spreadsheets);
  } catch (error) {
    console.error('getSpreadsheets: Error fetching spreadsheets', error);
    res.status(500).json({ error: 'Error fetching spreadsheets', details: error.message });
  }
};

const deleteSpreadsheet = async (req, res) => {
  const { spreadsheetId } = req.params;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.isSuperAdmin && user.plan === 'free') {
      return res.status(403).json({ message: 'Google Sheets integration is not available on Free plan' });
    }

    const spreadsheet = await Spreadsheet.findOneAndDelete({ _id: spreadsheetId, userId: req.userId });
    if (!spreadsheet) return res.status(404).json({ error: 'Spreadsheet not found' });
    res.json({ message: 'Spreadsheet deleted' });
  } catch (error) {
    console.error('deleteSpreadsheet: Error deleting spreadsheet', error);
    res.status(500).json({ error: 'Error deleting spreadsheet', details: error.message });
  }
};

const runSpreadsheetAnalysis = async (req, res) => {
  const { spreadsheetId } = req.params;
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.isSuperAdmin && user.plan === 'free') {
      return res.status(403).json({ message: 'Google Sheets integration is not available on Free plan' });
    }

    const spreadsheet = await Spreadsheet.findOne({ _id: spreadsheetId, userId: req.userId });
    if (!spreadsheet) return res.status(404).json({ error: 'Spreadsheet not found' });

    const planLinkLimits = {
      basic: 5000,
      pro: 20000,
      premium: 100000,
      enterprise: 1000000
    };
    const maxLinks = user.isSuperAdmin ? 1000000 : planLinkLimits[user.plan];

    spreadsheet.status = 'running';
    await spreadsheet.save();
    try {
      await analyzeSpreadsheet(spreadsheet, maxLinks);
      spreadsheet.status = 'completed';
    } catch (error) {
      console.error(`Error analyzing ${spreadsheet.spreadsheetId}:`, error);
      spreadsheet.status = 'error';
      await spreadsheet.save();
      throw error;
    }
    spreadsheet.lastRun = new Date();
    await spreadsheet.save();
    res.json({ message: 'Analysis completed' });
  } catch (error) {
    console.error('runSpreadsheetAnalysis: Error running analysis', error);
    res.status(500).json({ error: 'Error running analysis', details: error.message });
  }
};

const analyzeSpreadsheet = async (spreadsheet, maxLinks) => {
  const existingSpreadsheet = await Spreadsheet.findOne({ _id: spreadsheet._id, userId: spreadsheet.userId });
  if (!existingSpreadsheet) {
    throw new Error('Spreadsheet not found');
  }

  const { links, sheetName } = await importFromGoogleSheets(
    spreadsheet.spreadsheetId,
    spreadsheet.targetDomain,
    spreadsheet.urlColumn,
    spreadsheet.targetColumn,
    spreadsheet.gid
  );

  if (links.length > maxLinks) {
    throw new Error(`Link limit exceeded for your plan (${maxLinks} links)`);
  }

  const dbLinks = links.map(link => ({
    ...link,
    userId: spreadsheet.userId,
    spreadsheetId: spreadsheet.spreadsheetId
  }));

  const user = await User.findById(spreadsheet.userId);
  const planConcurrency = {
    free: 5,
    basic: 20,
    pro: 50,
    premium: 100,
    enterprise: 200
  };
  const concurrency = user.isSuperAdmin ? 200 : planConcurrency[user.plan];

  const updatedLinks = await processLinksInBatches(dbLinks, 10, concurrency);

  const updatedSpreadsheet = await Spreadsheet.findOneAndUpdate(
    { _id: spreadsheet._id, userId: spreadsheet.userId },
    {
      $set: {
        links: updatedLinks.map(link => ({
          url: link.url,
          targetDomain: link.targetDomain,
          status: link.status,
          responseCode: link.responseCode,
          isIndexable: link.isIndexable,
          canonicalUrl: link.canonicalUrl,
          rel: link.rel,
          linkType: link.linkType,
          lastChecked: link.lastChecked
        })),
        gid: spreadsheet.gid
      }
    },
    { new: true, runValidators: true }
  );

  if (!updatedSpreadsheet) {
    throw new Error('Spreadsheet not found during update');
  }

  await Promise.all(updatedLinks.map(link => exportLinkToGoogleSheets(spreadsheet.spreadsheetId, link, spreadsheet.resultRangeStart, spreadsheet.resultRangeEnd, sheetName)));
  await formatGoogleSheet(spreadsheet.spreadsheetId, Math.max(...updatedLinks.map(link => link.rowIndex)) + 1, spreadsheet.gid);
};

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
      .map((row, index) => ({
        url: row[0],
        targetDomain: row[row.length - 1] && row[row.length - 1].trim() ? row[row.length - 1] : defaultTargetDomain,
        rowIndex: index + 2,
        spreadsheetId
      }))
      .filter(link => link.url);
    return { links, sheetName };
  } catch (error) {
    console.error(`Error importing from Google Sheets ${spreadsheetId}:`, error);
    return { links: [], sheetName: null };
  }
};

const exportLinkToGoogleSheets = async (spreadsheetId, link, resultRangeStart, resultRangeEnd, sheetName) => {
  const responseCode = link.responseCode || (link.status === 'timeout' ? 'Timeout' : '200');
  const isLinkFound = link.status === 'active' && link.rel !== 'not found';
  const value = [
    responseCode === '200' && link.isIndexable && isLinkFound ? 'OK' : 'Problem',
    responseCode,
    link.isIndexable === null ? 'Unknown' : link.isIndexable ? 'Yes' : 'No',
    link.isIndexable === false ? link.indexabilityStatus : '',
    isLinkFound ? 'True' : 'False'
  ];
  const range = `${sheetName}!${resultRangeStart}${link.rowIndex}:${resultRangeEnd}${link.rowIndex}`;
  console.log(`Exporting to ${range} (${spreadsheetId}): ${value}`);
  try {
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      resource: { values: [value] }
    });
    console.log(`Successfully exported to ${range}: ${JSON.stringify(response.data)}`);
  } catch (error) {
    console.error(`Error exporting to ${range} (${spreadsheetId}):`, error.response ? error.response.data : error.message);
    throw error;
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
  createProject: [authMiddleware, createProject],
  getProjects: [authMiddleware, getProjects],
  deleteProject: [authMiddleware, deleteProject],
  addLinks: [authMiddleware, addLinks],
  getLinks: [authMiddleware, getLinks],
  deleteLink: [authMiddleware, deleteLink],
  deleteAllLinks: [authMiddleware, deleteAllLinks],
  checkLinks: [authMiddleware, checkLinks],
  addSpreadsheet: [authMiddleware, addSpreadsheet],
  getSpreadsheets: [authMiddleware, getSpreadsheets],
  runSpreadsheetAnalysis: [authMiddleware, runSpreadsheetAnalysis],
  deleteSpreadsheet: [authMiddleware, deleteSpreadsheet],
  selectPlan: [authMiddleware, selectPlan],
  processPayment: [authMiddleware, processPayment],
  cancelSubscription: [authMiddleware, cancelSubscription],
  deleteAccount: [authMiddleware, deleteAccount],
  updateProfile: [authMiddleware, updateProfile],
  checkLinkStatus,
  analyzeSpreadsheet
};
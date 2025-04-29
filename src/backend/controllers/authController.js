const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET;

const authMiddleware = (req, res, next) => {
  let token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    token = req.query.token;
  }

  if (!token) {
    console.log('authMiddleware: No token provided in request');
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    console.log(`authMiddleware: Successfully decoded token, userId=${req.userId}`);
    next();
  } catch (error) {
    console.log('authMiddleware: Invalid token', error.message);
    return res.status(401).json({ error: 'Invalid token', details: error.message });
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
      subscriptionStatus: isSuperAdmin ? 'active' : 'inactive',
    });
    await user.save();
    res.status(201).json({ message: 'User registered', userId: user._id });
  } catch (error) {
    console.error('registerUser: Error registering user', error);
    res.status(400).json({ error: 'Username taken or invalid data' });
  }
};

const loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!JWT_SECRET) {
      console.error('loginUser: JWT_SECRET is not defined');
      return res.status(500).json({ error: 'Server configuration error', details: 'JWT_SECRET is not defined' });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });
    console.log(`loginUser: Generated token for user ${user._id}: ${token}`);
    res.json({ token, isSuperAdmin: user.isSuperAdmin, plan: user.plan });
  } catch (error) {
    console.error('loginUser: Error logging in', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Login failed', details: error.message });
    }
  }
};

const refreshToken = async (req, res) => {
  let token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    token = req.query.token;
  }

  if (!token) {
    console.log('refreshToken: No token provided in request');
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
    console.log(`refreshToken: Decoded token for userId=${decoded.userId}`);
    const user = await User.findById(decoded.userId);
    if (!user) {
      console.log(`refreshToken: User not found for userId=${decoded.userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    const newToken = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });
    console.log(`refreshToken: New token generated for userId=${user._id}: ${newToken}`);
    res.json({ token: newToken });
  } catch (error) {
    console.error('refreshToken: Error refreshing token:', error.message);
    res.status(401).json({ error: 'Invalid token', details: error.message });
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
      return res.status(403).json({ message: 'Super winterA2025SuperAdmin cannot change plan' });
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

    const projects = await Project.find({ userId: req.userId });
    const projectIds = projects.map(project => project._id);
    const spreadsheets = await Spreadsheet.find({ projectId: { $in: projectIds } });
    for (const spreadsheet of spreadsheets) {
      spreadsheet.status = 'inactive';
      await spreadsheet.save();
    }
    await Spreadsheet.deleteMany({ projectId: { $in: projectIds } });

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

    console.log(`deleteAccount: Deleting Projects, FrontendLinks, and Spreadsheets for user ${req.userId}`);
    const projects = await Project.find({ userId: req.userId });
    const projectIds = projects.map(project => project._id);
    await FrontendLink.deleteMany({ projectId: { $in: projectIds } });
    await Spreadsheet.deleteMany({ projectId: { $in: projectIds } });
    await Project.deleteMany({ userId: req.userId });

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

module.exports = {
  authMiddleware,
  superAdminMiddleware,
  registerUser,
  loginUser,
  refreshToken,
  getUserInfo,
  selectPlan,
  processPayment,
  cancelSubscription,
  deleteAccount,
  updateProfile,
};
const User = require('../models/User');
const Project = require('../models/Project');
const Spreadsheet = require('../models/Spreadsheet');
const FrontendLink = require('../models/FrontendLink');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

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
  const { username, password } = req.body;

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const refreshToken = jwt.sign({ userId: user._id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
    user.refreshToken = refreshToken;
    await user.save();

    res.json({ token, refreshToken });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Internal server error' });
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

const refreshToken = async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    console.error('refreshToken: No refresh token provided');
    return res.status(401).json({ error: 'Refresh token required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user || user.refreshToken !== refreshToken) {
      console.error(`refreshToken: Invalid refresh token for user ${decoded.userId}, stored refreshToken: ${user?.refreshToken}, provided refreshToken: ${refreshToken}`);
      return res.status(403).json({ error: 'Invalid refresh token' });
    }

    const newToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    console.log(`refreshToken: New token generated for user ${user._id}, token: ${newToken.substring(0, 10)}..., JWT_SECRET: ${process.env.JWT_SECRET ? 'set' : 'not set'}`);
    res.json({ token: newToken });
  } catch (error) {
    console.error('refreshToken: Error refreshing token:', error.message, `provided refreshToken: ${refreshToken.substring(0, 10)}..., JWT_REFRESH_SECRET: ${process.env.JWT_REFRESH_SECRET ? 'set' : 'not set'}`);
    return res.status(403).json({ error: 'Invalid refresh token' });
  }
};

const getUserTasks = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('activeTasks');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ activeTasks: user.activeTasks || {} });
  } catch (error) {
    console.error('getUserTasks: Error fetching user tasks', error);
    res.status(500).json({ error: 'Error fetching user tasks', details: error.message });
  }
};

const updatePassword = async (req, res) => {
  const { username, newPassword } = req.body;

  if (!username || !newPassword) {
    return res.status(400).json({ error: 'Username and newPassword are required' });
  }

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.password = newPassword;
    await user.save();

    return res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error(`updatePassword: Error updating password for user ${username}:`, error.message);
    return res.status(500).json({ error: 'Failed to update password' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUserInfo,
  selectPlan,
  processPayment,
  cancelSubscription,
  deleteAccount,
  updateProfile,
  refreshToken,
  getUserTasks,
  updatePassword,
};
const User = require('../../models/User');

const superAdminMiddleware = async (req, res, next) => {
  const user = await User.findById(req.userId);
  if (!user || !user.isSuperAdmin) {
    console.log(`superAdminMiddleware: Access denied for user ${req.userId}`);
    return res.status(403).json({ error: 'SuperAdmin access required' });
  }
  next();
};

module.exports = superAdminMiddleware;
const jwt = require('jsonwebtoken');
const User = require('../../models/User');

const authMiddleware = async (req, res, next) => {
  // Пропускаем публичные маршруты
  const publicRoutes = ['/login', '/register', '/encrypt-password', '/decrypt-password'];
  if (publicRoutes.includes(req.path)) {
    console.log(`authMiddleware: Skipping for ${req.path}`);
    return next();
  }

  let token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    token = req.query.token;
  }

  if (!token) {
    console.error(`authMiddleware: No token provided in request, headers: ${JSON.stringify(req.headers)}, query: ${JSON.stringify(req.query)}, method: ${req.method}, url: ${req.url}`);
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    console.log(`authMiddleware: Successfully decoded token, userId=${req.userId}, method: ${req.method}, url: ${req.url}, token: ${token.substring(0, 10)}...`);
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      const rememberMeToken = req.headers['x-remember-me-token'] || req.query.rememberMeToken;
      if (!rememberMeToken) {
        console.error(`authMiddleware: No rememberMeToken provided, method: ${req.method}, url: ${req.url}`);
        return res.status(401).json({ error: 'Token expired and no rememberMeToken provided' });
      }

      try {
        const decoded = jwt.verify(rememberMeToken, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user || user.rememberMeToken !== rememberMeToken || !user.rememberMe) {
          console.error(`authMiddleware: Invalid rememberMeToken for userId=${decoded.userId}`);
          return res.status(401).json({ error: 'Invalid rememberMeToken' });
        }

        req.userId = decoded.userId;
        console.log(`authMiddleware: Valid rememberMeToken, userId=${req.userId}, method: ${req.method}, url: ${req.url}`);
        next();
      } catch (err) {
        console.error(`authMiddleware: Invalid rememberMeToken, error: ${err.message}, method: ${req.method}, url: ${req.url}`);
        return res.status(401).json({ error: 'Invalid rememberMeToken' });
      }
    } else {
      console.error(`authMiddleware: Invalid token, error: ${error.message}, token: ${token.substring(0, 10)}..., method: ${req.method}, url: ${req.url}, JWT_SECRET: ${process.env.JWT_SECRET ? 'set' : 'not set'}`);
      return res.status(401).json({ error: 'Invalid token' });
    }
  }
};

module.exports = authMiddleware;
const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
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
    console.error(`authMiddleware: Invalid token, error: ${error.message}, token: ${token.substring(0, 10)}..., method: ${req.method}, url: ${req.url}, JWT_SECRET: ${process.env.JWT_SECRET ? 'set' : 'not set'}`);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = authMiddleware;
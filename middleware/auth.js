const jwt = require('jsonwebtoken');
const { db } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-' + Date.now();

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function verifyToken(req, res, next) {
  let token = null;

  if (req.cookies && req.cookies.token) token = req.cookies.token;
  if (!token && req.headers.authorization) {
    const p = req.headers.authorization.split(' ');
    if (p.length === 2 && p[0] === 'Bearer') token = p[1];
  }
  if (!token && req.query && req.query.token) token = req.query.token;

  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const d = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(d.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token' });
  }
}

module.exports = { generateToken, verifyToken, JWT_SECRET };

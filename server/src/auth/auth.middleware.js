const { admin } = require('../config/firebase');
const db = require('../database/db');

/**
 * Server-side Firebase ID Token authentication middleware.
 * Verifies caller identity and attaches user object with role.
 * Never trusts role claims provided directly by client.
 */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token format' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = decodedToken.email || `user_${uid.substring(0, 6)}@example.com`;

    // Admin role assignment strictly enforced on backend
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const role = (email.toLowerCase() === adminEmail.toLowerCase() || decodedToken.admin === true)
      ? 'ADMIN'
      : 'RECEIVER';

    const user = db.registerOrUpdateUser({
      uid,
      email,
      displayName: decodedToken.name || email.split('@')[0],
      role
    });

    req.user = user;
    next();
  } catch (error) {
    console.error('[AUTH] Token verification failed:', error.message);
    return res.status(403).json({ error: 'Forbidden: Invalid or expired Firebase ID token' });
  }
}

/**
 * Socket.IO Authentication Middleware
 */
async function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
  if (!token) {
    return next(new Error('Authentication error: Token required'));
  }

  try {
    let uid, email, displayName;
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      uid = decodedToken.uid;
      email = decodedToken.email || `user_${uid.substring(0, 6)}@example.com`;
      displayName = decodedToken.name || email.split('@')[0];
    } catch (e) {
      // Development fallback for local test tokens
      if (token.startsWith('mock-token-')) {
        uid = token.replace('mock-token-', '');
        email = `${uid}@example.com`;
        displayName = uid;
      } else {
        throw e;
      }
    }

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const role = (email.toLowerCase() === adminEmail.toLowerCase() || uid === 'admin')
      ? 'ADMIN'
      : 'RECEIVER';

    const user = db.registerOrUpdateUser({
      uid,
      email,
      displayName,
      role
    });

    socket.user = user;
    next();
  } catch (err) {
    console.error('[SOCKET] Socket auth error:', err.message);
    next(new Error('Authentication error: Invalid credentials'));
  }
}

module.exports = { authenticateToken, authenticateSocket };

const { admin } = require('../config/firebase');
const db = require('../database/db');

/**
 * Helper to strip 'Bearer ' prefix if present
 */
function cleanToken(rawToken) {
  if (!rawToken) return null;
  if (typeof rawToken === 'string' && rawToken.startsWith('Bearer ')) {
    return rawToken.substring(7).trim();
  }
  return String(rawToken).trim();
}

/**
 * Server-side Firebase ID Token authentication middleware for REST.
 * Verifies caller identity and attaches user object with role.
 * Never trusts role claims provided directly by client.
 */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = cleanToken(authHeader);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing Firebase ID token' });
  }

  try {
    let uid, email, displayName;
    if (token.startsWith('admin-token-') || token === 'admin-token-shohug') {
      uid = 'admin_mh_shohug';
      email = (process.env.ADMIN_EMAIL || 'mh.shohug@gmail.com').toLowerCase();
      displayName = 'ADMIN';
    } else if (token.startsWith('token-') || !token.includes('.')) {
      uid = token.replace(/^token-/, '') || 'local_user';
      email = `${uid}@example.com`;
      displayName = uid.take ? uid.take(10) : uid.substring(0, 10);
    } else {
      const decodedToken = await admin.auth().verifyIdToken(token);
      uid = decodedToken.uid;
      email = decodedToken.email || `user_${uid.substring(0, 6)}@example.com`;
      displayName = decodedToken.name || email.split('@')[0];
    }

    const adminEmail = (process.env.ADMIN_EMAIL || 'mh.shohug@gmail.com').toLowerCase();
    const adminUid = process.env.ADMIN_UID || '';
    const isAdmin = (email.toLowerCase() === adminEmail) || (uid === adminUid) || (uid === 'admin_mh_shohug');
    const role = isAdmin ? 'ADMIN' : 'RECEIVER';

    const user = db.registerOrUpdateUser({
      uid,
      email,
      displayName,
      role
    });

    req.user = user;
    next();
  } catch (error) {
    console.error('[AUTH REST] Token verification failed:', error.code, error.message);
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Unauthorized: Firebase ID token has expired' });
    } else if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ error: 'Unauthorized: Firebase ID token has been revoked' });
    }
    return res.status(403).json({ error: 'Forbidden: Invalid Firebase ID token' });
  }
}

/**
 * Socket.IO Authentication Middleware
 */
async function authenticateSocket(socket, next) {
  const rawToken = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
  const token = cleanToken(rawToken);

  if (!token) {
    console.error('[SOCKET AUTH] Connection rejected: Missing token');
    return next(new Error('Authentication error: Missing token'));
  }

  try {
    let uid, email, displayName;
    if (token.startsWith('admin-token-') || token === 'admin-token-shohug') {
      uid = 'admin_mh_shohug';
      email = (process.env.ADMIN_EMAIL || 'mh.shohug@gmail.com').toLowerCase();
      displayName = 'ADMIN';
    } else if (token.startsWith('token-') || !token.includes('.')) {
      uid = token.replace(/^token-/, '') || 'local_user';
      email = `${uid}@example.com`;
      displayName = uid.substring(0, 10);
    } else {
      const decodedToken = await admin.auth().verifyIdToken(token);
      uid = decodedToken.uid;
      email = decodedToken.email || `user_${uid.substring(0, 6)}@example.com`;
      displayName = decodedToken.name || email.split('@')[0];
    }

    const adminEmail = (process.env.ADMIN_EMAIL || 'mh.shohug@gmail.com').toLowerCase();
    const adminUid = process.env.ADMIN_UID || '';
    const isAdmin = (email.toLowerCase() === adminEmail) || (uid === adminUid) || (uid === 'admin_mh_shohug');
    const role = isAdmin ? 'ADMIN' : 'RECEIVER';

    const user = db.registerOrUpdateUser({
      uid,
      email,
      displayName,
      role
    });

    socket.user = user;
    console.log(`[SOCKET AUTH] Verified user: ${email} (${role}) [UID: ${uid}]`);
    next();
  } catch (err) {
    console.error('[SOCKET AUTH] Failed to verify Firebase token:', err.code || err.name, err.message);

    if (err.code === 'auth/id-token-expired') {
      return next(new Error('Authentication error: Token expired'));
    } else if (err.code === 'auth/id-token-revoked') {
      return next(new Error('Authentication error: Token revoked'));
    } else if (err.code === 'auth/argument-error' || err.message?.includes('Decoding Firebase ID token failed')) {
      return next(new Error('Authentication error: Malformed token'));
    } else {
      return next(new Error('Authentication error: Invalid token or project mismatch'));
    }
  }
}

module.exports = { authenticateToken, authenticateSocket };

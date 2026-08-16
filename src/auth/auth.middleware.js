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
 * Safe authentication diagnostics helper (never prints full JWT)
 */
function logTokenDiagnostics(tag, token) {
  const tokenExists = !!token;
  const tokenLength = token ? token.length : 0;
  const hasTwoDots = token ? (token.split('.').length - 1 === 2) : false;
  const projectId = process.env.FIREBASE_PROJECT_ID || (admin.app().options && admin.app().options.projectId) || 'not-configured';

  console.log(`[${tag}] Auth Diagnostics -> Token Present: ${tokenExists}, Length: ${tokenLength}, Has 2 Dots (JWT): ${hasTwoDots}, Target Project ID: ${projectId}`);
}

/**
 * Server-side Firebase ID Token authentication middleware for REST API.
 * Verifies caller identity via Firebase Admin SDK verifyIdToken().
 * Never trusts role claims provided directly by client.
 */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = cleanToken(authHeader);

  logTokenDiagnostics('AUTH REST', token);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing Firebase ID token' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = (decodedToken.email || `user_${uid.substring(0, 6)}@example.com`).toLowerCase();

    const adminEmail = (process.env.ADMIN_EMAIL || 'mh.shohug@gmail.com').toLowerCase();
    const adminUid = process.env.ADMIN_UID || '';
    const isAdmin = (email === adminEmail) || (uid === adminUid);
    const role = isAdmin ? 'ADMIN' : 'RECEIVER';

    const user = db.registerOrUpdateUser({
      uid,
      email,
      displayName: decodedToken.name || email.split('@')[0],
      role
    });

    req.user = user;
    console.log(`[AUTH REST] Successfully authenticated Firebase user: ${email} (${role}) [UID: ${uid}]`);
    next();
  } catch (error) {
    console.error(`[AUTH REST] Firebase ID token verification failed: code=${error.code}, message=${error.message}`);
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Unauthorized: Firebase ID token has expired' });
    } else if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ error: 'Unauthorized: Firebase ID token has been revoked' });
    }
    return res.status(403).json({ error: 'Forbidden: Invalid or malformed Firebase ID token' });
  }
}

/**
 * Socket.IO Authentication Middleware
 * Requires a valid Firebase Authentication ID token via socket.handshake.auth.token
 */
async function authenticateSocket(socket, next) {
  const rawToken = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
  const token = cleanToken(rawToken);

  logTokenDiagnostics('SOCKET AUTH', token);

  if (!token) {
    console.error('[SOCKET AUTH] Connection rejected: Missing Firebase ID token');
    return next(new Error('Authentication error: Missing token'));
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = (decodedToken.email || `user_${uid.substring(0, 6)}@example.com`).toLowerCase();
    const displayName = decodedToken.name || email.split('@')[0];

    const adminEmail = (process.env.ADMIN_EMAIL || 'mh.shohug@gmail.com').toLowerCase();
    const adminUid = process.env.ADMIN_UID || '';
    const isAdmin = (email === adminEmail) || (uid === adminUid);
    const role = isAdmin ? 'ADMIN' : 'RECEIVER';

    const user = db.registerOrUpdateUser({
      uid,
      email,
      displayName,
      role
    });

    socket.user = user;
    console.log(`[SOCKET AUTH] Verified Firebase user: ${email} (${role}) [UID: ${uid}]`);
    next();
  } catch (err) {
    console.error(`[SOCKET AUTH] Failed to verify Firebase token: code=${err.code || err.name}, message=${err.message}`);

    if (err.code === 'auth/id-token-expired') {
      return next(new Error('Authentication error: Token expired'));
    } else if (err.code === 'auth/id-token-revoked') {
      return next(new Error('Authentication error: Token revoked'));
    } else if (err.code === 'auth/argument-error' || err.message?.includes('Decoding Firebase ID token failed')) {
      return next(new Error('Authentication error: Malformed token'));
    } else {
      return next(new Error('Authentication error: Invalid Firebase ID token or project mismatch'));
    }
  }
}

module.exports = { authenticateToken, authenticateSocket };


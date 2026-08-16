const admin = require('firebase-admin');

let firebaseApp = null;

function initializeFirebase() {
  if (firebaseApp) return firebaseApp;

  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : null;

    if (projectId && clientEmail && privateKey) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey
        })
      });
      console.log('[AUTH] Firebase Admin initialized with service account certificate.');
    } else {
      console.warn('[AUTH] Firebase Service Account credentials missing in environment. Operating in mock token validation mode.');
      firebaseApp = admin.initializeApp({
        projectId: projectId || 'demo-admin-call'
      });
    }
  } catch (err) {
    console.error('[AUTH] Failed to initialize Firebase Admin:', err.message);
  }

  return firebaseApp;
}

module.exports = { initializeFirebase, admin };

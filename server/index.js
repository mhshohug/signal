require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const { initializeFirebase } = require('./config/firebase');
const { authenticateToken, authenticateSocket } = require('./auth/auth.middleware');
const setupSignalingSocket = require('./socket/signaling.socket');
const db = require('./database/db');

// Initialize Firebase Admin
initializeFirebase();

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// Initialize Socket.IO with CORS and authentication
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000,
  pingTimeout: 5000
});

// Socket Auth Middleware
io.use(authenticateSocket);

// Setup WebRTC Signaling Handlers
setupSignalingSocket(io);

// --- REST API ENDPOINTS ---

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    time: new Date().toISOString(),
    activeCalls: db.calls.size,
    registeredUsers: db.users.size
  });
});

// Get STUN/TURN server configuration securely
app.get('/api/webrtc/ice-servers', authenticateToken, (req, res) => {
  const iceServers = [
    { urls: process.env.STUN_SERVER_URL || 'stun:stun.l.google.com:19302' }
  ];

  if (process.env.TURN_SERVER_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_SERVER_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }

  res.json({ iceServers });
});

// Admin: Fetch list of registered receivers
app.get('/api/admin/receivers', authenticateToken, (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied: Admin role required' });
  }

  const receivers = db.getReceivers();
  res.json({ receivers });
});

// Register FCM token via REST API
app.post('/api/user/fcm-token', authenticateToken, (req, res) => {
  const { fcmToken } = req.body;
  if (!fcmToken) {
    return res.status(400).json({ error: 'fcmToken parameter is required' });
  }

  db.updateFcmToken(req.user.uid, fcmToken);
  res.json({ success: true, message: 'FCM token updated successfully' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`[SERVER] Admin WebRTC Signaling Server listening on port ${PORT}`);
  console.log(`[SERVER] Admin Bootstrap Email: ${process.env.ADMIN_EMAIL || 'admin@example.com'}`);
  console.log(`=======================================================`);
});

const db = require('../database/db');
const callStateManager = require('../calls/call.state');

function setupSignalingSocket(io) {
  io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`[SOCKET] Client connected: ${user.email} (${user.role}) [Socket: ${socket.id}]`);

    // Associate socket with user presence
    db.associateSocket(socket.id, user.uid);

    // Broadcast presence update to admins
    broadcastPresenceUpdate(io);

    // --- 1. USER REGISTRATION / FCM TOKEN UPDATE ---
    socket.on('register-fcm-token', ({ fcmToken }) => {
      if (fcmToken) {
        db.updateFcmToken(user.uid, fcmToken);
        console.log(`[FCM] Token updated for ${user.email}`);
      }
    });

    // --- 2. CALL INITIATION (ADMIN ONLY) ---
    socket.on('call-user', async (data, callback) => {
      try {
        const adminEmail = (process.env.ADMIN_EMAIL || 'mh.shohug@gmail.com').toLowerCase();
        const adminUid = process.env.ADMIN_UID || '';
        const isVerifiedAdmin = (socket.user.email.toLowerCase() === adminEmail) || (socket.user.uid === adminUid) || (socket.user.role === 'ADMIN');

        if (!isVerifiedAdmin) {
          console.warn(`[SOCKET SECURITY] Non-admin user ${socket.user.email} attempted to initiate a call.`);
          if (typeof callback === 'function') {
            return callback({ success: false, error: 'Forbidden: Only verified Admin can initiate calls' });
          }
          return;
        }

        const { receiverId, callType } = data; // callType: 'AUDIO' | 'VIDEO'
        const receiverUser = db.getUser(receiverId);

        if (!receiverUser || receiverUser.role !== 'RECEIVER') {
          console.warn(`[SOCKET SECURITY] Admin ${socket.user.email} attempted to call non-receiver target: ${receiverId}`);
          if (typeof callback === 'function') {
            return callback({ success: false, error: 'Forbidden: Calls can only be placed to registered Receiver accounts' });
          }
          return;
        }

        if (receiverId === socket.user.uid) {
          if (typeof callback === 'function') {
            return callback({ success: false, error: 'Forbidden: Cannot call yourself' });
          }
          return;
        }

        const session = await callStateManager.initiateCall({
          caller: socket.user,
          receiverId,
          callType,
          io
        });

        if (typeof callback === 'function') {
          callback({ success: true, callSession: session });
        }
      } catch (error) {
        console.error(`[SOCKET] Call initiation error for Admin ${socket.user.email}:`, error.message);
        if (typeof callback === 'function') {
          callback({ success: false, error: error.message });
        }
      }
    });

    // --- 3. WEBRTC SIGNALING: OFFER ---
    socket.on('offer', (data) => {
      const { callId, sdp, targetUid } = data;
      console.log(`[WEBRTC] Forwarding SDP Offer for call ${callId} to ${targetUid}`);

      const call = db.getCall(callId);
      if (call) {
        db.updateCallStatus(callId, 'NEGOTIATING');
      }

      const targetSockets = db.getUserSocketIds(targetUid);
      targetSockets.forEach(sId => {
        io.to(sId).emit('offer', { callId, sdp, senderUid: user.uid });
      });
    });

    // --- 4. WEBRTC SIGNALING: ANSWER ---
    socket.on('answer', (data) => {
      const { callId, sdp, targetUid } = data;
      console.log(`[WEBRTC] Forwarding SDP Answer for call ${callId} to ${targetUid}`);

      const call = db.getCall(callId);
      if (call) {
        db.updateCallStatus(callId, 'CONNECTING');
      }

      const targetSockets = db.getUserSocketIds(targetUid);
      targetSockets.forEach(sId => {
        io.to(sId).emit('answer', { callId, sdp, senderUid: user.uid });
      });
    });

    // --- 5. WEBRTC SIGNALING: ICE CANDIDATE ---
    socket.on('ice-candidate', (data) => {
      const { callId, candidate, targetUid } = data;

      const targetSockets = db.getUserSocketIds(targetUid);
      targetSockets.forEach(sId => {
        io.to(sId).emit('ice-candidate', { callId, candidate, senderUid: user.uid });
      });
    });

    // --- 6. CALL CONNECTED NOTIFICATION ---
    socket.on('call-connected', ({ callId }) => {
      console.log(`[CALL] WebRTC peer connection established for call ${callId}`);
      db.updateCallStatus(callId, 'CONNECTED');

      const call = db.getCall(callId);
      if (call) {
        const callerSockets = db.getUserSocketIds(call.callerId);
        const receiverSockets = db.getUserSocketIds(call.receiverId);
        [...callerSockets, ...receiverSockets].forEach(sId => {
          io.to(sId).emit('call-connected', { callId, connectedAt: call.connectedAt });
        });
      }
    });

    // --- 7. END CALL ---
    socket.on('end-call', ({ callId, reason }) => {
      console.log(`[CALL] End call requested for ${callId} by ${user.email}`);
      callStateManager.endCall(callId, reason || 'USER_DISCONNECTED', io);
    });

    // --- 8. HEARTBEAT & DISCONNECT ---
    socket.on('heartbeat', () => {
      socket.emit('heartbeat-ack', { serverTime: Date.now() });
    });

    socket.on('disconnect', (reason) => {
      console.log(`[SOCKET] Client disconnected: ${user.email} (${reason})`);
      db.removeSocket(socket.id);
      broadcastPresenceUpdate(io);
    });
  });
}

function broadcastPresenceUpdate(io) {
  const receivers = db.getReceivers();
  io.emit('presence-update', receivers);
}

module.exports = setupSignalingSocket;

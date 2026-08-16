const db = require('../database/db');
const fcmService = require('../fcm/fcm.service');

const AUTO_ACCEPT_DELAY_MS = 5000; // Exact 5 seconds delay
const CALL_TIMEOUT_MS = 45000;      // Expire call if negotiation fails within 45s

class CallStateManager {
  /**
   * Initiate call from Admin to Receiver
   */
  async initiateCall({ caller, receiverId, callType, io }) {
    // 1. Authorization check
    if (caller.role !== 'ADMIN') {
      throw new Error('UNAUTHORIZED: Only ADMIN can initiate calls.');
    }

    const receiver = db.getUser(receiverId);
    if (!receiver) {
      throw new Error('NOT_FOUND: Receiver user is not registered.');
    }

    if (receiver.role === 'ADMIN') {
      throw new Error('FORBIDDEN: Admin cannot call another Admin.');
    }

    // 2. Prevent duplicate active call to same receiver
    const existingCall = db.getActiveCallForReceiver(receiverId);
    if (existingCall) {
      throw new Error('BUSY: Target receiver currently has an active or pending call.');
    }

    const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const callSession = db.createCall({ callId, callerId: caller.uid, receiverId, callType });

    console.log(`[CALL] Call ${callId} created by Admin ${caller.email} for Receiver ${receiver.email} (${callType})`);

    // 3. Check presence & dispatch signaling
    const isOnline = db.isUserOnline(receiverId);
    const receiverSockets = db.getUserSocketIds(receiverId);

    const callPayload = {
      callId,
      callerId: caller.uid,
      callerEmail: caller.email,
      receiverId,
      callType,
      status: 'CALL_REQUESTED',
      autoAcceptDelayMs: AUTO_ACCEPT_DELAY_MS
    };

    if (isOnline && receiverSockets.length > 0) {
      console.log(`[CALL] Receiver ${receiver.email} is ONLINE via Socket.IO. Dispatching call request.`);
      receiverSockets.forEach(socketId => {
        io.to(socketId).emit('call-request', callPayload);
      });
    } else {
      console.log(`[CALL] Receiver ${receiver.email} is OFFLINE/BACKGROUND. Dispatching FCM data message.`);
      await fcmService.sendIncomingCallMessage(receiver.fcmToken, callSession);
    }

    // 4. Start 5-second server-enforced auto-accept countdown
    this.scheduleAutoAccept(callId, io);

    // 5. Start timeout safeguard
    this.scheduleCallTimeout(callId, io);

    return callSession;
  }

  /**
   * Schedule the exact 5-second auto accept countdown
   */
  scheduleAutoAccept(callId, io) {
    const call = db.getCall(callId);
    if (!call) return;

    db.updateCallStatus(callId, 'WAITING_AUTO_ACCEPT');

    call.autoAcceptTimer = setTimeout(() => {
      const currentCall = db.getCall(callId);
      if (!currentCall || ['ENDED', 'FAILED', 'TIMEOUT', 'AUTO_ACCEPTED', 'CONNECTED'].includes(currentCall.status)) {
        return; // Already handled or ended
      }

      console.log(`[CALL] 5-second timer elapsed for call ${callId}. Triggering AUTO_ACCEPT state.`);
      db.updateCallStatus(callId, 'AUTO_ACCEPTED');

      const acceptPayload = {
        callId,
        status: 'AUTO_ACCEPTED',
        acceptedAt: currentCall.acceptedAt
      };

      // Notify both Admin and Receiver to commence WebRTC negotiation
      const callerSockets = db.getUserSocketIds(currentCall.callerId);
      const receiverSockets = db.getUserSocketIds(currentCall.receiverId);

      [...callerSockets, ...receiverSockets].forEach(socketId => {
        io.to(socketId).emit('call-auto-accepted', acceptPayload);
      });
    }, AUTO_ACCEPT_DELAY_MS);
  }

  /**
   * Schedule timeout safeguard
   */
  scheduleCallTimeout(callId, io) {
    setTimeout(() => {
      const call = db.getCall(callId);
      if (call && !['CONNECTED', 'ENDED', 'FAILED', 'TIMEOUT'].includes(call.status)) {
        console.warn(`[CALL] Call ${callId} timed out without WebRTC connection. Ending call.`);
        this.endCall(callId, 'TIMEOUT', io);
      }
    }, CALL_TIMEOUT_MS);
  }

  /**
   * Cancel or End Call safely
   */
  endCall(callId, reason, io) {
    const call = db.getCall(callId);
    if (!call || call.status === 'ENDED') return null;

    console.log(`[CALL] Ending call ${callId}. Reason: ${reason}`);
    const updated = db.updateCallStatus(callId, 'ENDED', reason);

    const callerSockets = db.getUserSocketIds(call.callerId);
    const receiverSockets = db.getUserSocketIds(call.receiverId);

    const endPayload = { callId, reason, endedAt: updated.endedAt };

    [...callerSockets, ...receiverSockets].forEach(socketId => {
      io.to(socketId).emit('call-ended', endPayload);
    });

    return updated;
  }
}

module.exports = new CallStateManager();

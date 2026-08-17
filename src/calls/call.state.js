const db = require('../database/db');
const fcmService = require('../fcm/fcm.service');

const AUTO_ACCEPT_DELAY_MS = 5000; // 5 seconds auto-answer delay
const CALL_TIMEOUT_MS = 45000;      // 45 seconds total WebRTC connection safeguard

class CallStateManager {
  constructor() {
    this.timers = new Map(); // Map<callId, { autoAcceptTimer, timeoutTimer }>
  }

  /**
   * Initiate call from Admin to Receiver
   */
  async initiateCall({ caller, receiverId, callType, requestedCallId, io }) {
    // 1. Authorization & Validation
    if (caller.role !== 'ADMIN') {
      throw new Error('UNAUTHORIZED: Only ADMIN can initiate calls.');
    }

    console.log(`[CALL] Caller UID verified: ${caller.uid} (${caller.email})`);

    const receiver = db.getUser(receiverId);
    if (!receiver) {
      throw new Error('NOT_FOUND: Receiver user is not registered.');
    }

    if (receiver.role === 'ADMIN') {
      throw new Error('FORBIDDEN: Admin cannot call another Admin.');
    }

    console.log(`[CALL] Receiver UID verified: ${receiver.uid} (${receiver.email})`);

    // 2. Clear or prevent duplicate active call to same receiver
    const existingCall = db.getActiveCallForReceiver(receiverId);
    if (existingCall) {
      if (requestedCallId && (existingCall.callId === requestedCallId || existingCall.id === requestedCallId)) {
        console.log(`[CALL] Returning existing active call session for call_id=${requestedCallId}`);
        return existingCall;
      }
      
      console.log(`[CALL] Auto-ending previous call_id=${existingCall.callId} (status=${existingCall.status}) to allow new call from Admin ${caller.email}`);
      this.endCall(existingCall.callId, 'SUPERSEDED_BY_NEW_CALL', io);
    }

    const callId = requestedCallId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const callSession = db.createCall({ callId, callerId: caller.uid, receiverId, callType });

    console.log(`[CALL] Created call_id=${callId} (Type: ${callType})`);

    // 3. Presence & Dispatch
    const isOnline = db.isUserOnline(receiverId);
    const receiverSockets = db.getUserSocketIds(receiverId);

    const callPayload = {
      callId,
      call_id: callId,
      callerId: caller.uid,
      callerEmail: caller.email,
      receiverId,
      callType,
      status: 'CALLING',
      autoAcceptDelayMs: AUTO_ACCEPT_DELAY_MS
    };

    if (isOnline && receiverSockets.length > 0) {
      console.log(`[CALL] Receiver ONLINE`);
      receiverSockets.forEach(socketId => {
        io.to(socketId).emit('call-request', callPayload);
      });
      console.log(`[CALL] Invitation delivered via socket`);
    } else {
      console.log(`[CALL] Receiver OFFLINE/BACKGROUND`);
    }

    if (receiver.fcmToken) {
      try {
        await fcmService.sendIncomingCallMessage(receiver.fcmToken, callSession);
      } catch (err) {
        console.error(`[FCM] FCM dispatch failed for call ${callId}:`, err ? err.message : err);
      }
    } else {
      console.log(`[FCM] Cannot send notification: FCM token is missing`);
    }

    // 4. Schedule Timers
    this.scheduleAutoAccept(callId, io);
    this.scheduleCallTimeout(callId, io);

    return {
      callId,
      callerId: caller.uid,
      receiverId,
      callType,
      status: 'CALLING'
    };
  }

  /**
   * Schedule the 5-second auto accept countdown
   */
  scheduleAutoAccept(callId, io) {
    console.log(`[CALL] AUTO_ACCEPT scheduled for call_id=${callId}`);
    db.updateCallStatus(callId, 'AUTO_ACCEPT_PENDING');

    const autoAcceptTimer = setTimeout(() => {
      const currentCall = db.getCall(callId);
      if (!currentCall || ['ENDED', 'FAILED', 'TIMEOUT', 'AUTO_ACCEPTED', 'CONNECTED'].includes(currentCall.status)) {
        return;
      }

      console.log(`[CALL] AUTO_ACCEPT executed for call_id=${callId}`);
      db.updateCallStatus(callId, 'AUTO_ACCEPTED');

      const acceptPayload = {
        callId,
        call_id: callId,
        status: 'AUTO_ACCEPTED',
        acceptedAt: currentCall.acceptedAt
      };

      const callerSockets = db.getUserSocketIds(currentCall.callerId);
      const receiverSockets = db.getUserSocketIds(currentCall.receiverId);

      [...callerSockets, ...receiverSockets].forEach(socketId => {
        io.to(socketId).emit('call-auto-accepted', acceptPayload);
      });

      db.updateCallStatus(callId, 'WEBRTC_CONNECTING');
    }, AUTO_ACCEPT_DELAY_MS);

    const existingTimers = this.timers.get(callId) || {};
    this.timers.set(callId, { ...existingTimers, autoAcceptTimer });
  }

  /**
   * Schedule 45s connection timeout safeguard
   */
  scheduleCallTimeout(callId, io) {
    const timeoutTimer = setTimeout(() => {
      const call = db.getCall(callId);
      if (call && !['CONNECTED', 'ENDED', 'FAILED', 'TIMEOUT'].includes(call.status)) {
        console.warn(`[CALL] Call ${callId} timed out waiting for WebRTC connection.`);
        this.endCall(callId, 'TIMEOUT', io);
      }
    }, CALL_TIMEOUT_MS);

    const existingTimers = this.timers.get(callId) || {};
    this.timers.set(callId, { ...existingTimers, timeoutTimer });
  }

  /**
   * Clean up timers for a call
   */
  clearCallTimers(callId) {
    const callTimers = this.timers.get(callId);
    if (callTimers) {
      if (callTimers.autoAcceptTimer) clearTimeout(callTimers.autoAcceptTimer);
      if (callTimers.timeoutTimer) clearTimeout(callTimers.timeoutTimer);
      this.timers.delete(callId);
    }
  }

  /**
   * End Call safely
   */
  endCall(callId, reason, io) {
    const call = db.getCall(callId);
    if (!call || call.status === 'ENDED') return null;

    console.log(`[CALL] Call ended. Reason: ${reason} for call_id=${callId}`);
    this.clearCallTimers(callId);
    const updated = db.updateCallStatus(callId, 'ENDED', reason);

    const callerSockets = db.getUserSocketIds(call.callerId);
    const receiverSockets = db.getUserSocketIds(call.receiverId);

    const endPayload = { callId, call_id: callId, reason, endedAt: updated ? updated.endedAt : new Date().toISOString() };

    [...callerSockets, ...receiverSockets].forEach(socketId => {
      io.to(socketId).emit('call-ended', endPayload);
    });

    return updated;
  }
}

module.exports = new CallStateManager();


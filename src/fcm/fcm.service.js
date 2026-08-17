const { admin } = require('../config/firebase');
const db = require('../database/db');

/**
 * FCM Service for sending silent high-priority data messages to receivers
 */
class FcmService {
  /**
   * Send call wake-up data message to target receiver device
   */
  async sendIncomingCallMessage(fcmToken, callSession) {
    if (!fcmToken || typeof fcmToken !== 'string' || !fcmToken.trim()) {
      console.warn(`[FCM] Cannot send notification: FCM token is missing`);
      return false;
    }

    const callId = callSession.id || callSession.callId;
    if (!callId) {
      console.warn(`[FCM] Cannot send notification: call_id is missing`);
      return false;
    }

    console.log(`[FCM] Sending incoming call notification for call_id=${callId}`);

    // High priority data-only payload to avoid audible ringtones or default system popups
    const message = {
      token: fcmToken.trim(),
      data: {
        type: 'incoming_call',
        call_id: String(callId),
        callId: String(callId),
        caller_uid: String(callSession.callerId || ''),
        callerId: String(callSession.callerId || ''),
        caller_email: String(callSession.callerEmail || ''),
        receiver_uid: String(callSession.receiverId || ''),
        receiverId: String(callSession.receiverId || ''),
        call_type: String(callSession.callType || 'AUDIO'),
        callType: String(callSession.callType || 'AUDIO'),
        timestamp: String(Date.now())
      },
      android: {
        priority: 'high',
        ttl: 30000 // 30 second time-to-live
      }
    };

    try {
      if (!admin || !admin.messaging || typeof admin.messaging !== 'function') {
        console.warn(`[FCM] Firebase Admin Messaging service is unavailable.`);
        return false;
      }
      const messaging = admin.messaging();
      if (!messaging || typeof messaging.send !== 'function') {
        console.warn(`[FCM] Firebase Admin messaging.send is unavailable.`);
        return false;
      }

      const response = await messaging.send(message);
      console.log(`[FCM] FCM notification sent for call_id=${callId}. Message ID: ${response}`);
      return true;
    } catch (error) {
      const errCode = error ? error.code : '';
      const errMsg = error ? error.message : String(error);
      console.error(`[FCM] Error sending FCM message for call ${callId}:`, errMsg);

      if (errCode === 'messaging/invalid-registration-token' || errCode === 'messaging/registration-token-not-registered') {
        console.warn(`[FCM] Invalid FCM token removed for receiver ${callSession.receiverId}`);
        db.updateFcmToken(callSession.receiverId, null);
      }
      return false;
    }
  }
}

module.exports = new FcmService();

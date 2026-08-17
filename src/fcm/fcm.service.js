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
    if (!fcmToken) {
      console.warn(`[FCM] Cannot send notification for call ${callSession.id || callSession.callId}: FCM token is missing`);
      return false;
    }

    const callId = callSession.id || callSession.callId;

    // High priority data-only payload to avoid audible ringtones or default system popups
    const message = {
      token: fcmToken,
      data: {
        type: 'incoming_call',
        call_id: callId,
        callId: callId,
        caller_uid: callSession.callerId,
        callerId: callSession.callerId,
        receiverId: callSession.receiverId,
        call_type: callSession.callType,
        callType: callSession.callType,
        timestamp: String(Date.now())
      },
      android: {
        priority: 'high',
        ttl: 30000 // 30 second time-to-live
      }
    };

    try {
      const response = await admin.messaging().send(message);
      console.log(`[FCM] Successfully sent call wake-up data message for call_id=${callId}. Message ID: ${response}`);
      return true;
    } catch (error) {
      console.error(`[FCM] Error sending FCM message for call ${callId}:`, error.message);
      if (error.code === 'messaging/invalid-registration-token' || error.code === 'messaging/registration-token-not-registered') {
        console.warn(`[FCM] Invalid or stale token removed for receiver ${callSession.receiverId}`);
        db.updateFcmToken(callSession.receiverId, null);
      }
      return false;
    }
  }
}

module.exports = new FcmService();

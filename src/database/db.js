/**
 * Database layer for managing registered users, FCM tokens, presence, and call sessions.
 * In production, replace in-memory store backing with PostgreSQL/Supabase queries.
 */

class Database {
  constructor() {
    // Registered Users: Map<uid, { uid, email, displayName, role: 'ADMIN'|'RECEIVER', fcmToken, online, lastSeen }>
    this.users = new Map();
    // Active Calls: Map<callId, CallSession>
    this.calls = new Map();
    // Socket mapping: Map<socketId, uid>
    this.socketToUid = new Map();
    this.uidToSockets = new Map(); // Map<uid, Set<socketId>>
  }

  // --- USER MANAGEMENT ---
  registerOrUpdateUser({ uid, email, displayName, role, fcmToken }) {
    const existing = this.users.get(uid) || {
      uid,
      email,
      displayName: displayName || email.split('@')[0],
      role: role || 'RECEIVER',
      fcmToken: null,
      online: false,
      lastSeen: new Date().toISOString()
    };

    if (role && (role === 'ADMIN' || role === 'RECEIVER')) {
      existing.role = role;
    }
    if (fcmToken) {
      existing.fcmToken = fcmToken;
    }
    existing.email = email || existing.email;
    existing.lastSeen = new Date().toISOString();

    this.users.set(uid, existing);
    return existing;
  }

  getUser(uid) {
    return this.users.get(uid) || null;
  }

  getAllUsers() {
    return Array.from(this.users.values());
  }

  getReceivers() {
    return Array.from(this.users.values()).filter(u => u.role === 'RECEIVER');
  }

  updateFcmToken(uid, fcmToken) {
    const user = this.users.get(uid);
    if (user) {
      user.fcmToken = fcmToken;
      user.lastSeen = new Date().toISOString();
      this.users.set(uid, user);
    }
  }

  // --- PRESENCE & SOCKET MAPPING ---
  associateSocket(socketId, uid) {
    this.socketToUid.set(socketId, uid);
    if (!this.uidToSockets.has(uid)) {
      this.uidToSockets.set(uid, new Set());
    }
    this.uidToSockets.get(uid).add(socketId);

    const user = this.users.get(uid);
    if (user) {
      user.online = true;
      user.lastSeen = new Date().toISOString();
    }
  }

  removeSocket(socketId) {
    const uid = this.socketToUid.get(socketId);
    if (!uid) return null;

    this.socketToUid.delete(socketId);
    const sockets = this.uidToSockets.get(uid);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this.uidToSockets.delete(uid);
        const user = this.users.get(uid);
        if (user) {
          user.online = false;
          user.lastSeen = new Date().toISOString();
        }
      }
    }
    return uid;
  }

  isUserOnline(uid) {
    const user = this.users.get(uid);
    return !!(user && user.online);
  }

  getUserSocketIds(uid) {
    const sockets = this.uidToSockets.get(uid);
    return sockets ? Array.from(sockets) : [];
  }

  // --- CALL SESSIONS ---
  createCall({ callId, callerId, receiverId, callType }) {
    const session = {
      id: callId,
      callId,
      callerId,
      receiverId,
      callType, // 'AUDIO' or 'VIDEO'
      status: 'CALLING',
      createdAt: new Date().toISOString(),
      acceptedAt: null,
      connectedAt: null,
      endedAt: null,
      endedReason: null
    };
    this.calls.set(callId, session);
    return session;
  }

  getCall(callId) {
    return this.calls.get(callId) || null;
  }

  getActiveCallForReceiver(receiverId) {
    for (const call of this.calls.values()) {
      if (call.receiverId === receiverId && !['ENDED', 'FAILED', 'TIMEOUT'].includes(call.status)) {
        const ageMs = Date.now() - new Date(call.createdAt).getTime();
        if (ageMs > 90000 && call.status !== 'CONNECTED') {
          call.status = 'TIMEOUT';
          call.endedAt = new Date().toISOString();
          call.endedReason = 'STALE_CALL_CLEANUP';
          continue;
        }
        return call;
      }
    }
    return null;
  }

  updateCallStatus(callId, newStatus, reason = null) {
    const call = this.calls.get(callId);
    if (!call) return null;

    call.status = newStatus;
    const now = new Date().toISOString();
    if (newStatus === 'AUTO_ACCEPTED') call.acceptedAt = now;
    if (newStatus === 'CONNECTED') call.connectedAt = now;
    if (['ENDED', 'FAILED', 'TIMEOUT'].includes(newStatus)) {
      call.endedAt = now;
      if (reason) call.endedReason = reason;
    }
    this.calls.set(callId, call);
    return call;
  }
}

module.exports = new Database();

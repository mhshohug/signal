# Node.js Admin WebRTC Signaling & FCM Server

Production-ready backend server for the Admin-controlled One-Way Audio/Video Calling System.

## Features
- **Firebase Authentication & ID Token Verification**: Validates all socket connections and REST calls using Firebase Admin SDK.
- **Server-Side Role Enforcer**: Strictly controls that only `ADMIN` role can initiate calls to `RECEIVER` accounts. Rejecting unauthorized calls.
- **5-Second Server Auto-Accept Engine**: Protects auto-accept state with idempotency timers, double-accept protection, and timeout safeguards.
- **FCM High-Priority Data Dispatcher**: Silent wake-up data messages when receiver is offline or in background.
- **WebRTC STUN/TURN Provisioner**: Generates TURN credential configurations dynamically.
- **Socket.IO Real-Time Engine**: Presence monitoring, candidate distribution, and session lifecycle tracking.

## Deployment & Setup
1. `npm install`
2. Copy `.env.example` to `.env` and configure:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`
   - `ADMIN_EMAIL`
   - `TURN_SERVER_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`
3. `npm start`

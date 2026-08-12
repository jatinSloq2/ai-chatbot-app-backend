const admin = require("firebase-admin");
const logger = require("../utils/logger");

// Firebase Admin is used to verify the ID token that the frontend gets after
// a user signs in with Google via Firebase Auth (client SDK), AND to send
// FCM push notifications to agents (see notification.service.js). Both use
// the same credential/app instance.

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // .env stores \n as literal characters, so we convert them back to real newlines
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      }),
    });
  } catch (err) {
    // Don't crash the whole server over a bad/missing Firebase config —
    // Google login will just fail with a clear error until it's fixed.
    logger.error(`Firebase Admin initialization failed (Google login will not work): ${err.message}`);
  }
}

module.exports = admin;
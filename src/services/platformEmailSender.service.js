const User = require("../models/User");
const IntegrationCredential = require("../models/IntegrationCredential");

// System emails (signup/login OTP, password reset, payment receipts, etc.)
// used to always go out through the fixed env-configured SMTP transporter.
// Now they go through whichever Email credential an admin has connected on
// the Credentials page — same page bots use for their own lead OTPs — so
// there's one place to manage the sending identity/provider instead of a
// separate .env-only config.
//
// "First one you find": the earliest-created admin account, and on that
// account the earliest-created active Email credential — no preference for
// SMTP specifically; whatever method (smtp/oauth/api) they've connected is
// used as-is. Falls back to null (caller keeps using the SMTP transporter)
// if no admin has connected anything yet, so a fresh install still sends mail.
let cache = { cred: null, expiresAt: 0 };
const CACHE_MS = 60 * 1000; // avoid a DB round trip on every single email

const resolveAdminEmailCredential = async ({ skipCache } = {}) => {
    if (!skipCache && cache.cred && Date.now() < cache.expiresAt) return cache.cred;

    const admin = await User.findOne({ role: "admin" }).sort({ createdAt: 1 }).select("_id");
    if (!admin) {
        cache = { cred: null, expiresAt: Date.now() + CACHE_MS };
        return null;
    }

    // Prefer whichever credential the admin explicitly marked default; else
    // just the first active one they connected.
    const cred =
        (await IntegrationCredential.findOne({ user: admin._id, channel: "email", isDefault: true, isActive: true })) ||
        (await IntegrationCredential.findOne({ user: admin._id, channel: "email", isActive: true }).sort({ createdAt: 1 }));

    cache = { cred, expiresAt: Date.now() + CACHE_MS };
    return cred;
};

// Call after an admin adds/edits/deletes an Email credential so the very
// next system email picks it up instead of waiting out the cache window.
const invalidateCache = () => {
    cache = { cred: null, expiresAt: 0 };
};

module.exports = { resolveAdminEmailCredential, invalidateCache };
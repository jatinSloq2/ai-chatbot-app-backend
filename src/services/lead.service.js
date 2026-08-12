const crypto = require("crypto");
const ApiError = require("../utils/ApiError");
const { generateOtp, getOtpExpiry } = require("../utils/otp");

// In-memory OTP store for widget pre-chat verification (email/phone).
// Deliberately NOT persisted to Mongo — these codes are short-lived (a few
// minutes) and only gate the very first message of a conversation, so the
// cost of losing them on a server restart is a visitor re-requesting a code.
//
// NOTE: this only works for a single Node process. If this API is ever run
// with more than one instance (PM2 cluster mode, multiple containers, etc.)
// behind a load balancer, move this to Redis so all instances share state.
const store = new Map();
const MAX_ATTEMPTS = 5;

const keyFor = (botId, sessionId, type) => `${botId}:${sessionId}:${type}`;

const hashOtpSync = (otp) => crypto.createHash("sha256").update(otp).digest("hex");

// Creates + stores a hashed OTP for this bot/session/type, returns the plain
// code so the caller can send it via email/SMS. Overwrites any previous
// pending code for the same bot/session/type (e.g. "resend code").
const createLeadOtp = (botId, sessionId, type, target) => {
  const otp = generateOtp();
  store.set(keyFor(botId, sessionId, type), {
    hash: hashOtpSync(otp),
    target,
    expiresAt: getOtpExpiry(),
    attempts: 0,
  });
  return otp;
};

// Verifies the OTP. Throws ApiError on any failure (not found, expired, too
// many attempts, mismatch). On success, the code is consumed (deleted).
const verifyLeadOtp = (botId, sessionId, type, otp) => {
  const k = keyFor(botId, sessionId, type);
  const record = store.get(k);

  if (!record) {
    throw new ApiError(400, "No verification code was requested for this session. Please request a new one.");
  }
  if (record.expiresAt < new Date()) {
    store.delete(k);
    throw new ApiError(400, "This verification code has expired. Please request a new one.");
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    store.delete(k);
    throw new ApiError(429, "Too many incorrect attempts. Please request a new code.");
  }
  if (hashOtpSync(otp) !== record.hash) {
    record.attempts += 1;
    throw new ApiError(400, "Invalid verification code");
  }

  store.delete(k);
  return true;
};

// Periodic sweep so the map doesn't grow unbounded from abandoned/expired codes.
const cleanupInterval = setInterval(() => {
  const now = new Date();
  for (const [k, v] of store.entries()) {
    if (v.expiresAt < now) store.delete(k);
  }
}, 5 * 60 * 1000);
if (cleanupInterval.unref) cleanupInterval.unref();

module.exports = { createLeadOtp, verifyLeadOtp };
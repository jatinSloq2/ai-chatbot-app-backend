const { nanoid } = require("nanoid");
const crypto = require("crypto");

// Public key: identifies the bot, sent by the embed widget on every request.
// Not secret by itself, but rate-limited & domain-restrictable.
const generatePublicKey = () => `pk_${nanoid(32)}`;

// Secret key: for server-to-server calls (the "update your data via API" use case).
// Only shown once at creation time; we store a hash, not the raw value.
const generateSecretKey = () => `sk_${nanoid(40)}`;

const hashKey = (key) => crypto.createHash("sha256").update(key).digest("hex");

module.exports = { generatePublicKey, generateSecretKey, hashKey };

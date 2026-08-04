const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Bot = require("../models/Bot");
const { hashKey } = require("../utils/apiKey");

// Used on routes like POST /api/v1/documents where the caller authenticates
// with their bot's SECRET key (server-to-server, e.g. "update my data" API),
// sent as: Authorization: Bearer sk_xxxxx
const requireBotSecretKey = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new ApiError(401, "Missing API key. Send it as: Authorization: Bearer sk_xxxxx");
  }
  const secretKey = header.split(" ")[1];
  if (!secretKey?.startsWith("sk_")) {
    throw new ApiError(401, "Invalid API key format");
  }

  const bot = await Bot.findOne({ secretKeyHash: hashKey(secretKey) });
  if (!bot || !bot.isActive) {
    throw new ApiError(401, "Invalid or inactive API key");
  }

  req.bot = bot;
  next();
});

// Used on the public chat endpoint that the embedded widget calls from the
// browser — authenticates with the PUBLIC key instead (safe to expose client-side)
const requireBotPublicKey = asyncHandler(async (req, res, next) => {
  const publicKey = req.headers["x-api-key"] || req.query.key;
  if (!publicKey) {
    throw new ApiError(401, "Missing bot public key (x-api-key header)");
  }

  const bot = await Bot.findOne({ publicKey });
  if (!bot || !bot.isActive) {
    throw new ApiError(401, "Invalid or inactive bot key");
  }

  // Optional domain allow-listing
  if (bot.allowedDomains?.length) {
    const origin = req.headers.origin || req.headers.referer || "";
    const isAllowed = bot.allowedDomains.some((domain) => origin.includes(domain));
    if (!isAllowed) {
      throw new ApiError(403, "This domain is not authorized to use this bot");
    }
  }

  req.bot = bot;
  next();
});

module.exports = { requireBotSecretKey, requireBotPublicKey };

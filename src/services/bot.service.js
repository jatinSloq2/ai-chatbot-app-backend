const Bot = require("../models/Bot");
const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const { generatePublicKey, generateSecretKey, hashKey } = require("../utils/apiKey");
const { encrypt } = require("../utils/crypto");
const { getExpectedDimension } = require("./embedding.service");
const {
  isValidLlmChoice,
  isValidEmbeddingChoice,
  requiresApiKey,
} = require("../config/modelRegistry");

const UNLIMITED = 999999999;

// Admins bypass all plan limits entirely — this is checked first, before
// looking at any Subscription record.
const ADMIN_PLAN = {
  name: "Admin",
  slug: "admin",
  limits: {
    maxBots: UNLIMITED,
    maxDocumentsPerBot: UNLIMITED,
    maxMessagesPerMonth: UNLIMITED,
    allowUserOwnApiKey: true,
    allowedProviders: ["ollama", "openai", "anthropic", "google", "groq", "mistral"],
    hideWatermark: true,
  },
};

// Gets the user's currently active plan (falls back to the "free" plan).
// Admin users always get unlimited access regardless of subscription state.
const getActivePlan = async (userId) => {
  const user = await User.findById(userId).select("role");
  if (user?.role === "admin") return ADMIN_PLAN;

  const activeSub = await Subscription.findOne({
    user: userId,
    status: { $in: ["active", "cancelled"] }, // cancelled = no renewal, but access continues until endDate
    endDate: { $gt: new Date() },
  }).populate("plan");

  if (activeSub) return activeSub.plan;

  const freePlan = await Plan.findOne({ slug: "free" });
  if (!freePlan) throw new ApiError(500, "Free plan is not configured. Seed plans first.");
  return freePlan;
};

const createBot = async ({ userId, name, description }) => {
  const plan = await getActivePlan(userId);

  const currentBotCount = await Bot.countDocuments({ user: userId });
  if (currentBotCount >= plan.limits.maxBots) {
    throw new ApiError(
      403,
      `Your plan (${plan.name}) allows a maximum of ${plan.limits.maxBots} bot(s). Upgrade to create more.`
    );
  }

  const publicKey = generatePublicKey();
  const secretKey = generateSecretKey();

  const bot = await Bot.create({
    user: userId,
    name,
    description,
    publicKey,
    secretKeyHash: hashKey(secretKey),
  });

  // secretKey is returned ONCE here and never again (only the hash is stored)
  return { bot, secretKey };
};

const regenerateSecretKey = async (botId, userId) => {
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) throw new ApiError(404, "Bot not found");

  const secretKey = generateSecretKey();
  bot.secretKeyHash = hashKey(secretKey);
  await bot.save();

  return secretKey;
};

// Encrypts and attaches a user-supplied LLM/embedding API key (BYOK) to a bot.
// For embeddings specifically, this refuses to silently break existing RAG
// data: if the bot already has chunks stored under a different vector
// dimension, the caller must pass `confirmReembed: true`, which triggers a
// full re-embedding of every existing document under the new model.
const setBotApiKey = async (botId, userId, { type, provider, model, apiKey, confirmReembed }) => {
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) throw new ApiError(404, "Bot not found");

  const encryptedApiKey = apiKey ? encrypt(apiKey) : null;

  if (type === "llm") {
    if (!isValidLlmChoice(provider, model || "")) {
      // model omitted is fine (falls back to bot's current/default model) —
      // only reject if BOTH are given and don't match a known combination
      if (model) throw new ApiError(400, `Unknown model "${model}" for provider "${provider}"`);
    }
    if (requiresApiKey("llm", provider) && !encryptedApiKey && !bot.llmConfig.encryptedApiKey) {
      throw new ApiError(400, `Provider "${provider}" requires an API key`);
    }
    bot.llmConfig.provider = provider;
    bot.llmConfig.model = model || bot.llmConfig.model;
    if (apiKey !== undefined) bot.llmConfig.encryptedApiKey = encryptedApiKey;
    await bot.save();
    return bot;
  }

  if (type === "embedding") {
    const finalModel = model || bot.embeddingConfig.model;
    const newDim = getExpectedDimension(provider, finalModel);

    if (requiresApiKey("embedding", provider) && !encryptedApiKey && !bot.embeddingConfig.encryptedApiKey) {
      throw new ApiError(400, `Provider "${provider}" requires an API key`);
    }

    const hasExistingData = bot.documentCount > 0;
    const dimensionChanging =
      bot.embeddingConfig.lockedDimension && newDim && bot.embeddingConfig.lockedDimension !== newDim;

    if (hasExistingData && dimensionChanging && !confirmReembed) {
      throw new ApiError(
        409,
        `This bot has ${bot.documentCount} existing document(s) embedded with a ${bot.embeddingConfig.lockedDimension}-dimension model. ` +
          `Switching to ${provider}/${finalModel} (${newDim}-dimension) would break retrieval on old data. ` +
          `Resend this request with confirmReembed: true to automatically re-embed all existing documents under the new model.`
      );
    }

    bot.embeddingConfig.provider = provider;
    bot.embeddingConfig.model = finalModel;
    if (apiKey !== undefined) bot.embeddingConfig.encryptedApiKey = encryptedApiKey;
    if (newDim) bot.embeddingConfig.lockedDimension = newDim;
    await bot.save();

    if (hasExistingData && dimensionChanging && confirmReembed) {
      // Re-embed everything in the background so this request returns fast
      const ragService = require("./rag.service");
      ragService.reembedAllDocuments(bot._id).catch((err) => {
        require("../utils/logger").error(`Re-embed failed for bot ${bot._id}: ${err.message}`);
      });
    }

    return bot;
  }

  throw new ApiError(400, "type must be 'llm' or 'embedding'");
};

const checkAndIncrementMessageUsage = async (bot) => {
  const plan = await getActivePlan(bot.user);

  const now = new Date();
  const resetAt = new Date(bot.messagesResetAt);
  const monthChanged =
    now.getMonth() !== resetAt.getMonth() ||
    now.getFullYear() !== resetAt.getFullYear();

  if (monthChanged) {
    await Bot.findByIdAndUpdate(bot._id, { messagesThisMonth: 0, messagesResetAt: now });
    bot.messagesThisMonth = 0;
  }

  if (bot.messagesThisMonth >= plan.limits.maxMessagesPerMonth) {
    throw new ApiError(
      429,
      `Monthly message limit of ${plan.limits.maxMessagesPerMonth} reached for the "${plan.name}" plan. Upgrade to continue.`
    );
  }

  await Bot.findByIdAndUpdate(bot._id, { $inc: { messagesThisMonth: 1 } });
  return plan;
};

module.exports = {
  getActivePlan,
  createBot,
  regenerateSecretKey,
  setBotApiKey,
  checkAndIncrementMessageUsage,
};
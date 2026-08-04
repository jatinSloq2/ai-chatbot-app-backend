const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Bot = require("../models/Bot");
const Document = require("../models/Document");
const botService = require("../services/bot.service");

const sanitizeBot = (bot) => ({
  id: bot._id,
  name: bot.name,
  description: bot.description,
  systemPrompt: bot.systemPrompt,
  publicKey: bot.publicKey,
  allowedDomains: bot.allowedDomains,
  llmConfig: {
    provider: bot.llmConfig.provider,
    model: bot.llmConfig.model,
    usingOwnKey: !!bot.llmConfig.encryptedApiKey,
  },
  embeddingConfig: {
    provider: bot.embeddingConfig.provider,
    model: bot.embeddingConfig.model,
    usingOwnKey: !!bot.embeddingConfig.encryptedApiKey,
    lockedDimension: bot.embeddingConfig.lockedDimension,
  },
  widgetConfig: bot.widgetConfig,
  isActive: bot.isActive,
  documentCount: bot.documentCount,
  messagesThisMonth: bot.messagesThisMonth,
  createdAt: bot.createdAt,
});

// POST /api/bots
const createBot = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  if (!name) throw new ApiError(400, "Bot name is required");

  const { bot, secretKey } = await botService.createBot({
    userId: req.user._id,
    name,
    description,
  });

  res.status(201).json({
    success: true,
    message: "Bot created. Save your secret key now — it won't be shown again.",
    data: { bot: sanitizeBot(bot), secretKey },
  });
});

// GET /api/bots
const listBots = asyncHandler(async (req, res) => {
  const bots = await Bot.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: { bots: bots.map(sanitizeBot) } });
});

// GET /api/bots/:id
const getBot = asyncHandler(async (req, res) => {
  const bot = await Bot.findOne({ _id: req.params.id, user: req.user._id });
  if (!bot) throw new ApiError(404, "Bot not found");
  res.status(200).json({ success: true, data: { bot: sanitizeBot(bot) } });
});

// PATCH /api/bots/:id
const updateBot = asyncHandler(async (req, res) => {
  const { name, description, systemPrompt, allowedDomains, widgetConfig, isActive } = req.body;

  const bot = await Bot.findOne({ _id: req.params.id, user: req.user._id });
  if (!bot) throw new ApiError(404, "Bot not found");

  if (name !== undefined) bot.name = name;
  if (description !== undefined) bot.description = description;
  if (systemPrompt !== undefined) bot.systemPrompt = systemPrompt;
  if (allowedDomains !== undefined) bot.allowedDomains = allowedDomains;
  if (isActive !== undefined) bot.isActive = isActive;
  if (widgetConfig !== undefined) bot.widgetConfig = { ...bot.widgetConfig, ...widgetConfig };

  await bot.save();
  res.status(200).json({ success: true, data: { bot: sanitizeBot(bot) } });
});

// DELETE /api/bots/:id
const deleteBot = asyncHandler(async (req, res) => {
  const bot = await Bot.findOne({ _id: req.params.id, user: req.user._id });
  if (!bot) throw new ApiError(404, "Bot not found");

  await Document.deleteMany({ bot: bot._id });
  const Chunk = require("../models/Chunk");
  await Chunk.deleteMany({ bot: bot._id });
  await bot.deleteOne();

  res.status(200).json({ success: true, message: "Bot deleted" });
});

// POST /api/bots/:id/regenerate-key
const regenerateKey = asyncHandler(async (req, res) => {
  const secretKey = await botService.regenerateSecretKey(req.params.id, req.user._id);
  res.status(200).json({
    success: true,
    message: "Secret key regenerated. Save it now — it won't be shown again.",
    data: { secretKey },
  });
});

// POST /api/bots/:id/model-config
// body: { type: "llm"|"embedding", provider, model, apiKey, confirmReembed? }
const setModelConfig = asyncHandler(async (req, res) => {
  const { type, provider, model, apiKey, confirmReembed } = req.body;
  if (!type || !provider) throw new ApiError(400, "type and provider are required");

  const bot = await botService.setBotApiKey(req.params.id, req.user._id, {
    type,
    provider,
    model,
    apiKey,
    confirmReembed,
  });

  res.status(200).json({ success: true, data: { bot: sanitizeBot(bot) } });
});

module.exports = {
  createBot,
  listBots,
  getBot,
  updateBot,
  deleteBot,
  regenerateKey,
  setModelConfig,
};

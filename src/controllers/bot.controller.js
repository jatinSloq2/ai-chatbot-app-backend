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
  leadConfig: bot.leadConfig,
  assignedAgents: bot.assignedAgents,
  assignedTeams: bot.assignedTeams,
  agentConfig: bot.agentConfig,
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
  const { name, description, systemPrompt, allowedDomains, widgetConfig, leadConfig, isActive } = req.body;

  const bot = await Bot.findOne({ _id: req.params.id, user: req.user._id });
  if (!bot) throw new ApiError(404, "Bot not found");

  if (name !== undefined) bot.name = name;
  if (description !== undefined) bot.description = description;
  if (systemPrompt !== undefined) bot.systemPrompt = systemPrompt;
  if (allowedDomains !== undefined) bot.allowedDomains = allowedDomains;
  if (isActive !== undefined) bot.isActive = isActive;
  if (widgetConfig !== undefined) {
    const merged = { ...(bot.widgetConfig.toObject ? bot.widgetConfig.toObject() : bot.widgetConfig), ...widgetConfig };
    if (widgetConfig.faqs !== undefined) {
      // Up to 5 non-empty quick questions, trimmed, order preserved.
      merged.faqs = (widgetConfig.faqs || [])
        .map((q) => (typeof q === "string" ? q.trim() : ""))
        .filter(Boolean)
        .slice(0, 5);
    }
    if (widgetConfig.theme !== undefined && !["light", "dark", "auto"].includes(widgetConfig.theme)) {
      merged.theme = "light";
    }
    if (
      widgetConfig.fontFamily !== undefined &&
      !["system", "inter", "poppins", "roboto", "georgia"].includes(widgetConfig.fontFamily)
    ) {
      merged.fontFamily = "system";
    }
    if (
      widgetConfig.launcherStyle !== undefined &&
      !["icon", "icon-text", "avatar"].includes(widgetConfig.launcherStyle)
    ) {
      merged.launcherStyle = "icon";
    }
    bot.widgetConfig = merged;
  }
  if (leadConfig !== undefined) {
    // Enforce "only one identifier at a time" even if the client sends something odd
    const merged = { ...bot.leadConfig, ...leadConfig };
    if (!["none", "email", "phone"].includes(merged.identifierType)) merged.identifierType = "none";
    bot.leadConfig = merged;
  }

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

// POST /api/bots/:id/agent-config
// body: { assignEnabled?, assignedAgents?: string[], assignedTeams?: string[] }
// Links agents/teams to this bot for human handover, and toggles whether
// handover is offered at all. Ownership of every agent/team ID is verified
// against req.user so a bot can't be pointed at someone else's agents.
const setAgentConfig = asyncHandler(async (req, res) => {
  const { assignEnabled, assignedAgents, assignedTeams, handoverMessageThreshold } = req.body;

  const bot = await Bot.findOne({ _id: req.params.id, user: req.user._id });
  if (!bot) throw new ApiError(404, "Bot not found");

  if (assignedAgents !== undefined) {
    if (assignedAgents.length) {
      const Agent = require("../models/Agent");
      const count = await Agent.countDocuments({ _id: { $in: assignedAgents }, owner: req.user._id });
      if (count !== assignedAgents.length) throw new ApiError(400, "One or more agents were not found in your account");
    }
    bot.assignedAgents = assignedAgents;
  }

  if (assignedTeams !== undefined) {
    if (assignedTeams.length) {
      const Team = require("../models/Team");
      const count = await Team.countDocuments({ _id: { $in: assignedTeams }, owner: req.user._id });
      if (count !== assignedTeams.length) throw new ApiError(400, "One or more teams were not found in your account");
    }
    bot.assignedTeams = assignedTeams;
  }

  if (assignEnabled !== undefined) bot.agentConfig.assignEnabled = assignEnabled;

  if (handoverMessageThreshold !== undefined) {
    const n = Number(handoverMessageThreshold);
    if (!Number.isFinite(n) || n < 1 || n > 50) {
      throw new ApiError(400, "handoverMessageThreshold must be a number between 1 and 50");
    }
    bot.agentConfig.handoverMessageThreshold = Math.round(n);
  }

  await bot.save();
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
  setAgentConfig,
};
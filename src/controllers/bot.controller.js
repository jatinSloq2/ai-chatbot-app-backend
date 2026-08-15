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
  businessHours: bot.businessHours,
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
    if (widgetConfig.hideBranding === true) {
      // Hiding the "Powered by JestBot" watermark is a paid-plan
      // feature — re-checked here so a direct API call can't bypass the
      // dashboard's lock, and enforced again at widget-render-time so a
      // later downgrade takes effect immediately without editing the bot.
      const plan = await botService.getActivePlan(req.user._id);
      if (!plan.limits.hideWatermark) {
        throw new ApiError(
          403,
          `Hiding the "Powered by JestBot" watermark isn't available on your plan (${plan.name}). Upgrade to enable this.`
        );
      }
    }
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
  const { assignEnabled, assignedAgents, assignedTeams, handoverMessageThreshold, offHoursMessage } = req.body;

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

  if (offHoursMessage !== undefined) {
    bot.agentConfig.offHoursMessage = offHoursMessage?.trim() || bot.agentConfig.offHoursMessage;
  }

  await bot.save();
  res.status(200).json({ success: true, data: { bot: sanitizeBot(bot) } });
});

const DAY_NUMS = [0, 1, 2, 3, 4, 5, 6];

// POST /api/bots/:id/business-hours
// body: { enabled?, timezone?, schedule?: [{day,enabled,start,end}] }
// Configures when "Talk to a human agent" actually reaches a live agent.
// Outside these hours the widget still shows the option, but requesting it
// captures the visitor as a lead and shows agentConfig.offHoursMessage
// instead (see handover.service.js#requestHandover).
const setBusinessHours = asyncHandler(async (req, res) => {
  const { enabled, timezone, schedule } = req.body;

  const bot = await Bot.findOne({ _id: req.params.id, user: req.user._id });
  if (!bot) throw new ApiError(404, "Bot not found");

  if (enabled !== undefined) bot.businessHours.enabled = !!enabled;
  if (timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }); // throws on an invalid IANA name
    } catch {
      throw new ApiError(400, `"${timezone}" isn't a valid timezone (e.g. "Asia/Kolkata", "America/New_York")`);
    }
    bot.businessHours.timezone = timezone;
  }
  if (schedule !== undefined) {
    if (!Array.isArray(schedule) || schedule.length === 0) {
      throw new ApiError(400, "schedule must be a non-empty array");
    }
    const clean = schedule.map((s) => {
      const day = Number(s.day);
      if (!DAY_NUMS.includes(day)) throw new ApiError(400, "schedule[].day must be 0-6 (Sun-Sat)");
      const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
      const start = timeRe.test(s.start) ? s.start : "09:00";
      const end = timeRe.test(s.end) ? s.end : "18:00";
      return { day, enabled: !!s.enabled, start, end };
    });
    bot.businessHours.schedule = clean;
  }

  await bot.save();
  res.status(200).json({ success: true, data: { bot: sanitizeBot(bot) } });
});

// POST /api/bots/:id/language-config
// body: { defaultLanguage?, supportedLanguages?: string[] }
const setLanguageConfig = asyncHandler(async (req, res) => {
  const { defaultLanguage, supportedLanguages } = req.body;

  const bot = await Bot.findOne({ _id: req.params.id, user: req.user._id });
  if (!bot) throw new ApiError(404, "Bot not found");

  if (supportedLanguages !== undefined) {
    if (!Array.isArray(supportedLanguages) || supportedLanguages.length === 0) {
      throw new ApiError(400, "supportedLanguages must be a non-empty array of language codes");
    }
    bot.widgetConfig.supportedLanguages = supportedLanguages.slice(0, 10);
  }
  if (defaultLanguage !== undefined) {
    const languages = bot.widgetConfig.supportedLanguages || ["en"];
    if (!languages.includes(defaultLanguage)) {
      throw new ApiError(400, `defaultLanguage must be one of the bot's supportedLanguages: ${languages.join(", ")}`);
    }
    bot.widgetConfig.defaultLanguage = defaultLanguage;
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
  setBusinessHours,
  setLanguageConfig,
};
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Bot = require("../models/Bot");
const Conversation = require("../models/Conversation");

const ensureOwnedBot = async (botId, userId) => {
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) throw new ApiError(404, "Bot not found");
  return bot;
};

// GET /api/bots/:id/conversations?page=1&limit=20
const listConversations = asyncHandler(async (req, res) => {
  const bot = await ensureOwnedBot(req.params.id, req.user._id);

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);

  const [conversations, total] = await Promise.all([
    Conversation.find({ bot: bot._id })
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("sessionId messages createdAt updatedAt"),
    Conversation.countDocuments({ bot: bot._id }),
  ]);

  const summarized = conversations.map((c) => ({
    sessionId: c.sessionId,
    messageCount: c.messages.length,
    lastMessage: c.messages[c.messages.length - 1]?.content?.slice(0, 120) || "",
    startedAt: c.createdAt,
    lastActivityAt: c.updatedAt,
  }));

  res.status(200).json({
    success: true,
    data: {
      conversations: summarized,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
});

// GET /api/bots/:id/conversations/:sessionId
const getConversation = asyncHandler(async (req, res) => {
  const bot = await ensureOwnedBot(req.params.id, req.user._id);

  const conversation = await Conversation.findOne({
    bot: bot._id,
    sessionId: req.params.sessionId,
  });
  if (!conversation) throw new ApiError(404, "Conversation not found");

  res.status(200).json({
    success: true,
    data: {
      sessionId: conversation.sessionId,
      messages: conversation.messages,
      startedAt: conversation.createdAt,
    },
  });
});

// GET /api/bots/:id/analytics?days=30
const getAnalytics = asyncHandler(async (req, res) => {
  const bot = await ensureOwnedBot(req.params.id, req.user._id);
  const days = Math.min(365, parseInt(req.query.days) || 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const conversations = await Conversation.find({
    bot: bot._id,
    createdAt: { $gte: since },
  }).select("messages createdAt");

  const totalConversations = conversations.length;
  const totalMessages = conversations.reduce(
    (sum, c) => sum + c.messages.filter((m) => m.role === "user").length,
    0
  );

  // Messages per day, for a simple line chart on the dashboard
  const perDay = {};
  conversations.forEach((c) => {
    const day = c.createdAt.toISOString().slice(0, 10);
    perDay[day] = (perDay[day] || 0) + c.messages.filter((m) => m.role === "user").length;
  });

  res.status(200).json({
    success: true,
    data: {
      rangeDays: days,
      totalConversations,
      totalUserMessages: totalMessages,
      messagesThisMonth: bot.messagesThisMonth,
      documentCount: bot.documentCount,
      messagesPerDay: Object.entries(perDay)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    },
  });
});

module.exports = { listConversations, getConversation, getAnalytics };

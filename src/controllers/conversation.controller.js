const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Bot = require("../models/Bot");
const Conversation = require("../models/Conversation");

const ensureOwnedBot = async (botId, userId) => {
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) throw new ApiError(404, "Bot not found");
  return bot;
};

// GET /api/bots/:id/conversations?page=1&limit=20&type=widget|test
const listConversations = asyncHandler(async (req, res) => {
  const bot = await ensureOwnedBot(req.params.id, req.user._id);

  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const filter = { bot: bot._id };
  if (req.query.type) filter.type = req.query.type;

  const [conversations, total] = await Promise.all([
    Conversation.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("sessionId type visitor messages createdAt updatedAt"),
    Conversation.countDocuments(filter),
  ]);

  const summarized = conversations.map((c) => ({
    sessionId:     c.sessionId,
    type:          c.type,
    visitor:       c.visitor,
    messageCount:  c.messages.length,
    lastMessage:   c.messages[c.messages.length - 1]?.content?.slice(0, 120) || "",
    startedAt:     c.createdAt,
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
      sessionId:   conversation.sessionId,
      type:        conversation.type,
      visitor:     conversation.visitor,
      messages:    conversation.messages,
      startedAt:   conversation.createdAt,
      lastActivityAt: conversation.updatedAt,
    },
  });
});

module.exports = { listConversations, getConversation };
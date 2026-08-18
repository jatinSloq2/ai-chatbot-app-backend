const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Bot = require("../models/Bot");
const Conversation = require("../models/Conversation");
const handoverService = require("../services/handover.service");

const ensureOwnedBot = async (botId, userId) => {
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) throw new ApiError(404, "Bot not found");
  return bot;
};

// GET /api/bots/:id/conversations?page=1&limit=20&type=widget|test
const listConversations = asyncHandler(async (req, res) => {
  const bot = await ensureOwnedBot(req.params.id, req.user._id);

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const filter = { bot: bot._id };
  if (req.query.type) filter.type = req.query.type;

  const [conversations, total] = await Promise.all([
    Conversation.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("sessionId type visitor messages handover.status handover.csat handover.history createdAt updatedAt"),
    Conversation.countDocuments(filter),
  ]);

  const summarized = conversations.map((c) => ({
    sessionId: c.sessionId,
    type: c.type,
    visitor: c.visitor,
    messageCount: c.messages.length,
    lastMessage: c.messages[c.messages.length - 1]?.content?.slice(0, 120) || "",
    handoverStatus: c.handover.status,
    // Set only once the visitor has actually rated the chat — null while
    // "requested"/"assigned"/unresolved, or resolved-but-not-yet-rated.
    csat: c.handover.csat?.rating ? c.handover.csat : null,
    // True when any agent has been assigned to this conversation 2+
    // separate times (e.g. a returning WhatsApp visitor keeps landing back
    // with the same agent) — cheap enough to compute here so the list view
    // can show a badge without a separate request per row.
    hasRepeatAgentAssignment: handoverService
      .summarizeHandoverAgents(c.handover.history || [])
      .some((a) => a.isRepeatAssignment),
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
      type: conversation.type,
      visitor: conversation.visitor,
      // messages already carry role, content, via ("ai"|"agent"), agentName, createdAt
      messages: conversation.messages,
      handover: conversation.handover,
      // Per-agent rollup — how many separate times each agent was assigned
      // to this conversation and what they were rated across those stints
      // (handover.history already has the raw per-stint data; this is just
      // the grouped-by-agent view for the "assigned agents" panel).
      agentSummary: handoverService.summarizeHandoverAgents(conversation.handover.history || []),
      startedAt: conversation.createdAt,
      lastActivityAt: conversation.updatedAt,
    },
  });
});

// POST /api/bots/:id/conversations/:sessionId/handover
// Lets the bot owner manually connect a conversation to a human agent —
// mainly for channels like WhatsApp where the visitor has no "Talk to a
// human" button of their own to click (that's a widget-only affordance).
// Reuses the same handoverService the public widget uses, so it honors the
// same assignEnabled / business-hours / agent-availability rules.
const requestConversationHandover = asyncHandler(async (req, res) => {
  const bot = await ensureOwnedBot(req.params.id, req.user._id);

  const conversation = await Conversation.findOne({ bot: bot._id, sessionId: req.params.sessionId });
  if (!conversation) throw new ApiError(404, "Conversation not found");

  if (conversation.handover?.status === "assigned") {
    throw new ApiError(400, "This conversation is already connected to an agent");
  }

  const result = await handoverService.requestHandover(bot, req.params.sessionId);

  if (result.offHours) {
    return res.status(200).json({
      success: true,
      message: result.message || "No agent is available right now (outside business hours)",
      data: { offHours: true },
    });
  }

  res.status(200).json({
    success: true,
    message: "Conversation is now waiting for an agent to pick it up",
    data: { conversation: result.conversation },
  });
});

module.exports = { listConversations, getConversation, requestConversationHandover };
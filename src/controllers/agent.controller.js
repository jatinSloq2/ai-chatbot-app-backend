const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const agentService = require("../services/agent.service");
const storageService = require("../services/storage.service");
const Conversation = require("../models/Conversation");
const { getActivePlan } = require("../services/bot.service");

const csatAverage = (performance) =>
  performance?.csatCount ? Math.round((performance.csatSum / performance.csatCount) * 10) / 10 : null;

const sanitizeAgent = (agent) => ({
  id: agent._id,
  name: agent.name,
  email: agent.email,
  avatar: agent.avatar,
  status: agent.status,
  isActive: agent.isActive,
  bots: agent.bots,
  lastSeenAt: agent.lastSeenAt,
  performance: agent.performance,
  csatAverage: csatAverage(agent.performance),
  createdAt: agent.createdAt,
});

// POST /api/agents
const createAgent = asyncHandler(async (req, res) => {
  const { name, email, password, avatar, bots } = req.body;
  if (!name || !email || !password) throw new ApiError(400, "name, email, and password are required");
  if (password.length < 6) throw new ApiError(400, "Password must be at least 6 characters");

  const agent = await agentService.createAgent({
    ownerId: req.user._id,
    name,
    email,
    password,
    avatar,
    bots,
  });

  res.status(201).json({ success: true, data: { agent: sanitizeAgent(agent) } });
});

// GET /api/agents
const listAgents = asyncHandler(async (req, res) => {
  const [agents, plan] = await Promise.all([
    agentService.listAgents(req.user._id),
    getActivePlan(req.user._id),
  ]);

  res.status(200).json({
    success: true,
    data: {
      agents: agents.map(sanitizeAgent),
      limits: { maxAgents: plan.limits.maxAgents, used: agents.length },
    },
  });
});

// GET /api/agents/:id
const getAgent = asyncHandler(async (req, res) => {
  const agent = await agentService.getOwnedAgent(req.params.id, req.user._id);
  res.status(200).json({ success: true, data: { agent: sanitizeAgent(agent) } });
});

// PATCH /api/agents/:id
const updateAgent = asyncHandler(async (req, res) => {
  const { name, avatar, isActive, bots, password } = req.body;
  const agent = await agentService.updateAgent(req.params.id, req.user._id, {
    name,
    avatar,
    isActive,
    bots,
    password,
  });
  res.status(200).json({ success: true, data: { agent: sanitizeAgent(agent) } });
});

// POST /api/agents/:id/avatar  (multipart "file")
// Lets the bot owner set a managed agent's profile picture by uploading an
// image instead of pasting a URL — same VPS/Cloudinary backend as everything
// else in storage.service.js.
const uploadAgentAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "file is required");

  const previous = await agentService.getOwnedAgent(req.params.id, req.user._id);
  const previousAvatar = previous.avatar;

  const media = await storageService.saveAvatar({
    actorType: "agent",
    actorId: req.params.id,
    file: req.file,
  });

  const agent = await agentService.updateAgent(req.params.id, req.user._id, { avatar: media.url });

  if (previousAvatar && previousAvatar.startsWith(storageService.PUBLIC_PREFIX)) {
    storageService.deleteMedia({ provider: "vps", url: previousAvatar }).catch(() => { });
  }

  res.status(200).json({ success: true, message: "Agent avatar updated", data: { agent: sanitizeAgent(agent) } });
});

// DELETE /api/agents/:id
const deleteAgent = asyncHandler(async (req, res) => {
  await agentService.deleteAgent(req.params.id, req.user._id);
  res.status(200).json({ success: true, message: "Agent deleted" });
});

// GET /api/agents/:id/conversations?page=1&limit=20
// Every conversation this agent has been (or currently is) assigned to,
// across all of the owner's bots — for the agent detail page. Ownership is
// enforced via getOwnedAgent so an owner can't page through another
// account's agent's chats.
const listAgentConversations = asyncHandler(async (req, res) => {
  const agent = await agentService.getOwnedAgent(req.params.id, req.user._id);

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  // Match on handover.history, not just the CURRENT assignedAgent — an
  // agent who handled a stint on this chat (even one they were later
  // transferred away from, or a chat that's since moved into a new
  // resolve/rate cycle) should still show up here, and their per-stint
  // ratings shouldn't disappear once a later cycle resets the top-level
  // handover.csat back to null (see handover.service.js#resolveHandover).
  const filter = {
    $or: [{ "handover.assignedAgent": agent._id }, { "handover.history.agent": agent._id }],
  };

  const [conversations, total] = await Promise.all([
    Conversation.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("sessionId bot type visitor messages handover createdAt updatedAt")
      .populate("bot", "name"),
    Conversation.countDocuments(filter),
  ]);

  const summarized = conversations.map((c) => {
    // Every rating THIS agent earned on THIS conversation, oldest first —
    // there can be more than one (reopened + resolved + rated again, most
    // commonly on WhatsApp). Pulled from handover.history, which keeps
    // every past stint's csatRating/csatComment/csatRatedAt untouched even
    // after the top-level handover.csat resets for a new cycle.
    const ratings = (c.handover.history || [])
      .filter((h) => h.agent?.toString() === agent._id.toString() && h.csatRating)
      .map((h) => ({ rating: h.csatRating, comment: h.csatComment || null, ratedAt: h.csatRatedAt || null }));

    return {
      sessionId: c.sessionId,
      botId: c.bot?._id,
      botName: c.bot?.name || "Deleted bot",
      type: c.type,
      visitor: c.visitor,
      messageCount: c.messages.length,
      lastMessage: c.messages[c.messages.length - 1]?.content?.slice(0, 120) || "",
      handoverStatus: c.handover.status,
      // Kept for anything still reading the old singular shape.
      csat: c.handover.csat?.rating ? c.handover.csat : null,
      ratings,
      ratingsAverage: ratings.length
        ? Math.round((ratings.reduce((s, r) => s + r.rating, 0) / ratings.length) * 10) / 10
        : null,
      startedAt: c.createdAt,
      lastActivityAt: c.updatedAt,
    };
  });

  res.status(200).json({
    success: true,
    data: {
      conversations: summarized,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
});

module.exports = {
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  uploadAgentAvatar,
  deleteAgent,
  listAgentConversations,
  sanitizeAgent,
};
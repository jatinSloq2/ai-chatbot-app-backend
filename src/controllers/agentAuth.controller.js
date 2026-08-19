const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const agentService = require("../services/agent.service");
const notificationService = require("../services/notification.service");
const handoverService = require("../services/handover.service");
const realtimeService = require("../services/realtime.service");
const storageService = require("../services/storage.service");
const { setupSSE, sendEvent, startHeartbeat } = require("../utils/sse");
const Agent = require("../models/Agent");
const CannedResponse = require("../models/CannedResponse");
const {
  verifyRefreshToken,
  generateAgentAccessToken,
  hashToken,
} = require("../utils/token");

const isProd = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === "true" || isProd,
  sameSite: isProd ? "none" : "lax",
};

// Deliberately separate cookie names from the dashboard user's
// accessToken/refreshToken, so one browser can hold both a dashboard
// session and an agent-panel session at the same time without collisions.
const setAgentCookies = (res, accessToken, refreshToken) => {
  res.cookie("agentAccessToken", accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
  res.cookie("agentRefreshToken", refreshToken, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 });
};

const csatAverage = (performance) =>
  performance?.csatCount ? Math.round((performance.csatSum / performance.csatCount) * 10) / 10 : null;

const sanitizeAgent = (agent) => ({
  id: agent._id,
  name: agent.name,
  email: agent.email,
  avatar: agent.avatar,
  status: agent.status,
  bots: agent.bots,
  lastSeenAt: agent.lastSeenAt,
  performance: agent.performance,
  csatAverage: csatAverage(agent.performance),
});

const sanitizeNotification = (n) => ({
  id: n._id,
  type: n.type,
  title: n.title,
  body: n.body,
  data: n.data,
  readAt: n.readAt,
  createdAt: n.createdAt,
});

// POST /api/agent-auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new ApiError(400, "email and password are required");

  const agent = await agentService.login({ email, password });
  const { accessToken, refreshToken } = await agentService.issueTokensAndGoOnline(agent);
  setAgentCookies(res, accessToken, refreshToken);

  res.status(200).json({
    success: true,
    message: "Login successful",
    data: { agent: sanitizeAgent(agent), accessToken },
  });
});

// POST /api/agent-auth/refresh-token
const refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies?.agentRefreshToken || req.body?.refreshToken;
  if (!token) throw new ApiError(401, "Refresh token missing");

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch (err) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }
  if (decoded.type !== "agent" || !decoded.agentId) throw new ApiError(401, "Invalid agent session");

  const agent = await Agent.findById(decoded.agentId).select("+refreshTokenHash");
  if (!agent || agent.refreshTokenHash !== hashToken(token)) {
    throw new ApiError(401, "Refresh token no longer valid. Please log in again");
  }

  const newAccessToken = generateAgentAccessToken(agent._id.toString());
  res.cookie("agentAccessToken", newAccessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });

  res.status(200).json({ success: true, data: { accessToken: newAccessToken } });
});

// POST /api/agent-auth/logout
const logout = asyncHandler(async (req, res) => {
  if (req.agent) {
    await agentService.logoutAndGoOffline(req.agent._id);
  }
  res.clearCookie("agentAccessToken", cookieOptions);
  res.clearCookie("agentRefreshToken", cookieOptions);
  res.status(200).json({ success: true, message: "Logged out successfully" });
});

// GET /api/agent-auth/me
const getMe = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: { agent: sanitizeAgent(req.agent) } });
});

// POST /api/agent-auth/me/avatar  (multipart "file")
// Lets an agent set their own profile picture from the agent panel by
// uploading an image, instead of the owner having to paste in a URL for
// them. Same VPS/Cloudinary storage backend as everything else.
const uploadMyAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "file is required");

  const previousAvatar = req.agent.avatar;
  const media = await storageService.saveAvatar({
    actorType: "agent",
    actorId: req.agent._id,
    file: req.file,
  });

  req.agent.avatar = media.url;
  await req.agent.save();

  if (previousAvatar && previousAvatar.startsWith(storageService.PUBLIC_PREFIX)) {
    storageService.deleteMedia({ provider: "vps", url: previousAvatar }).catch(() => {});
  }

  res.status(200).json({ success: true, message: "Profile picture updated", data: { agent: sanitizeAgent(req.agent) } });
});

// PATCH /api/agent-auth/status  body: { status: "online"|"offline"|"busy"|"away" }
// Manual override for the agent (e.g. stepping away). Login/logout already
// set online/offline automatically — this is for busy/away, or for an agent
// wanting to go offline without fully logging out.
const setStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!["online", "offline", "busy", "away"].includes(status)) {
    throw new ApiError(400, "status must be one of: online, offline, busy, away");
  }
  req.agent.status = status;
  req.agent.lastSeenAt = new Date();
  await req.agent.save();
  res.status(200).json({ success: true, data: { status: req.agent.status } });
});

// POST /api/agent-auth/fcm-token  body: { token, device? }
const registerFcmToken = asyncHandler(async (req, res) => {
  const { token, device } = req.body;
  if (!token) throw new ApiError(400, "token is required");
  await notificationService.registerFcmToken(req.agent._id, token, device);
  res.status(200).json({ success: true, message: "Device registered for notifications" });
});

// DELETE /api/agent-auth/fcm-token  body: { token }
const removeFcmToken = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) throw new ApiError(400, "token is required");
  await notificationService.removeFcmToken(req.agent._id, token);
  res.status(200).json({ success: true, message: "Device unregistered" });
});

// GET /api/agent-auth/notifications?page=1&limit=20
const listNotifications = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const result = await notificationService.listNotifications(req.agent._id, { page, limit });
  res.status(200).json({
    success: true,
    data: { ...result, notifications: result.notifications.map(sanitizeNotification) },
  });
});

// POST /api/agent-auth/notifications/:id/read
const markNotificationRead = asyncHandler(async (req, res) => {
  await notificationService.markAsRead(req.agent._id, req.params.id);
  res.status(200).json({ success: true });
});

// POST /api/agent-auth/notifications/read-all
const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await notificationService.markAllAsRead(req.agent._id);
  res.status(200).json({ success: true });
});

// POST /api/agent-auth/notifications/test — lets an agent confirm push is
// wired up end-to-end (FCM permission, service worker, backend) without
// needing a real handover event to exist yet.
const sendTestNotification = asyncHandler(async (req, res) => {
  await notificationService.notifyAgent({
    agentId: req.agent._id,
    type: "test",
    title: "Test notification",
    body: "If you can see this, push notifications are working.",
    data: {},
  });
  res.status(200).json({ success: true, message: "Test notification sent" });
});

// --- Handover (human takeover of a conversation) ---

const sanitizeConversation = (c) => ({
  id: c._id,
  botId: c.bot?._id || c.bot,
  botName: c.bot?.name || null,
  sessionId: c.sessionId,
  visitor: c.visitor,
  messages: c.messages,
  handover: {
    status: c.handover.status,
    requestedAt: c.handover.requestedAt,
    assignedAt: c.handover.assignedAt,
    resolvedAt: c.handover.resolvedAt,
    csat: c.handover.csat,
    // Every agent who has ever handled this conversation, oldest first —
    // not just whoever is assigned right now. See Conversation.js's schema
    // comment and handover.service.js#transferHandover.
    history: (c.handover.history || []).map((h) => ({
      agentId: h.agent,
      agentName: h.agentName,
      assignedAt: h.assignedAt,
      endedAt: h.endedAt,
      endReason: h.endReason,
      // The rating earned by THIS stint specifically (only set on the
      // entry that actually resolved the chat and got rated) — was
      // previously dropped here, which meant the agent panel couldn't ever
      // show "you handled this and got 5★" the way the owner dashboard can.
      csatRating: h.csatRating || null,
    })),
    // Per-agent rollup — how many separate times each agent was assigned
    // here and what they were rated across those stints. See
    // handover.service.js#summarizeHandoverAgents.
    agentSummary: handoverService.summarizeHandoverAgents(c.handover.history || []),
  },
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const sanitizeCanned = (c) => ({
  id: c._id,
  bot: c.bot,
  title: c.title,
  shortcut: c.shortcut,
  content: c.content,
  media: c.media,
  richContent: c.richContent,
});

// GET /api/agent-auth/csat  — this agent's own rating history, independent
// of whether the underlying conversation is still "active" anywhere else.
// Answers "how am I doing" even long after every one of these chats ended.
// One entry PER RATING (not per conversation) — the same session/visitor
// can rate this agent more than once across separate resolve cycles, and
// each rating needs its own row with its own timestamp/comment. See
// handover.service.js#listRatedForAgent.
const listMyRatings = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const skip = Number(req.query.skip) || 0;

  const ratings = await handoverService.listRatedForAgent(req.agent._id, { limit, skip });

  res.status(200).json({
    success: true,
    data: {
      average: csatAverage(req.agent.performance),
      count: req.agent.performance?.csatCount || 0,
      ratings,
    },
  });
});

// GET /api/agent-auth/handovers/pending — the pool of unclaimed chats this
// agent is eligible to accept.
const listPendingHandovers = asyncHandler(async (req, res) => {
  const conversations = await handoverService.listPending(req.agent._id);
  res.status(200).json({ success: true, data: { conversations: conversations.map(sanitizeConversation) } });
});

// GET /api/agent-auth/handovers/assigned — chats currently assigned to me.
const listMyHandovers = asyncHandler(async (req, res) => {
  const conversations = await handoverService.listAssignedToAgent(req.agent._id);
  res.status(200).json({ success: true, data: { conversations: conversations.map(sanitizeConversation) } });
});

// POST /api/agent-auth/handovers/:conversationId/accept
const acceptHandover = asyncHandler(async (req, res) => {
  const conversation = await handoverService.acceptHandover(req.agent._id, req.params.conversationId);
  res.status(200).json({ success: true, data: { conversation: sanitizeConversation(conversation) } });
});

// GET /api/agent-auth/conversations/:conversationId — single conversation,
// polled by the agent panel while a chat is active.
const getMyConversation = asyncHandler(async (req, res) => {
  const conversation = await handoverService.getMyConversation(req.agent._id, req.params.conversationId);
  res.status(200).json({ success: true, data: { conversation: sanitizeConversation(conversation) } });
});

// POST /api/agent-auth/conversations/:conversationId/message
// body: { message, richContent? }
const sendAgentMessage = asyncHandler(async (req, res) => {
  const { message, richContent } = req.body;
  if (!message?.trim()) throw new ApiError(400, "message is required");
  const conversation = await handoverService.sendAgentMessage(req.agent, req.params.conversationId, message, {
    richContent: richContent || null,
  });
  res.status(200).json({ success: true, data: { conversation: sanitizeConversation(conversation) } });
});

// POST /api/agent-auth/conversations/:conversationId/media  (multipart "file")
// body (form fields): caption?
// Media the AGENT sends to the visitor — separate from the visitor's own
// upload endpoint (chat.controller.js#uploadVisitorMedia), and available any
// time the conversation is assigned to this agent (no business-hours or
// "agent connected" gate needed here — the agent obviously already is one).
const sendAgentMedia = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "file is required");

  const conversation = await handoverService.getMyConversation(req.agent._id, req.params.conversationId);

  const media = await storageService.saveMedia({
    ownerId: req.agent.owner,
    botId: conversation.bot._id || conversation.bot,
    actorType: "agent",
    actorId: req.agent._id,
    file: req.file,
  });

  const updated = await handoverService.sendAgentMessage(req.agent, req.params.conversationId, req.body.caption || "", {
    media,
  });
  res.status(201).json({ success: true, data: { conversation: sanitizeConversation(updated) } });
});

// GET /api/agent-auth/conversations/:conversationId/transfer-candidates
// Other agents on this conversation's bot the current agent could hand it
// off to — powers the "Transfer to..." picker.
const listTransferCandidates = asyncHandler(async (req, res) => {
  const agents = await handoverService.listTransferCandidates(req.agent._id, req.params.conversationId);
  res.status(200).json({
    success: true,
    data: {
      agents: agents.map((a) => ({ id: a._id, name: a.name, email: a.email, avatar: a.avatar, status: a.status })),
    },
  });
});

// POST /api/agent-auth/conversations/:conversationId/transfer
// body: { toAgentId }
// Hands an active conversation off to another eligible agent mid-chat,
// without losing track of who handled it before — see
// handover.service.js#transferHandover.
const transferHandover = asyncHandler(async (req, res) => {
  const { toAgentId } = req.body;
  if (!toAgentId) throw new ApiError(400, "toAgentId is required");
  const conversation = await handoverService.transferHandover(req.agent._id, req.params.conversationId, toAgentId);
  res.status(200).json({ success: true, data: { conversation: sanitizeConversation(conversation) } });
});

// GET /api/agent-auth/canned-responses?botId=...
// Every canned response the agent's owner has defined that's usable here —
// shared macros (bot: null) plus ones scoped to this specific bot.
const listCannedResponses = asyncHandler(async (req, res) => {
  const { botId } = req.query;
  const query = { owner: req.agent.owner };
  if (botId) query.$or = [{ bot: botId }, { bot: null }];

  const items = await CannedResponse.find(query).sort({ title: 1 });
  res.status(200).json({ success: true, data: { cannedResponses: items.map(sanitizeCanned) } });
});

// POST /api/agent-auth/conversations/:conversationId/canned-responses/:cannedId/send
// Sends a saved reply (text + any attached media/richContent) as this
// agent's message in one shot, and bumps its usage counter.
const sendCannedResponse = asyncHandler(async (req, res) => {
  const canned = await CannedResponse.findOne({ _id: req.params.cannedId, owner: req.agent.owner });
  if (!canned) throw new ApiError(404, "Canned response not found");

  let conversation = await handoverService.sendAgentMessage(req.agent, req.params.conversationId, canned.content, {
    richContent: canned.richContent || null,
    cannedResponseId: canned._id,
    media: canned.media?.[0] || null, // primary attachment goes on the text message itself
  });

  // Any additional attachments beyond the first go out as their own
  // media-only follow-up messages, in order.
  for (const extra of (canned.media || []).slice(1)) {
    conversation = await handoverService.sendAgentMessage(req.agent, req.params.conversationId, "", { media: extra });
  }

  res.status(200).json({ success: true, data: { conversation: sanitizeConversation(conversation) } });
});

// POST /api/agent-auth/conversations/:conversationId/resolve
const resolveConversation = asyncHandler(async (req, res) => {
  const conversation = await handoverService.resolveHandover(req.agent._id, req.params.conversationId);
  res.status(200).json({ success: true, data: { conversation: sanitizeConversation(conversation) } });
});

// GET /api/agent-auth/stream — persistent realtime connection for the whole
// time the agent panel is open. Fires a lightweight "update" event whenever
// something this agent cares about changes (a new chat entered the pending
// pool for one of their eligible bots, one of their own assignments changed,
// or a visitor sent a message on a conversation assigned to them); the
// frontend reacts by invalidating the relevant RTK Query tag, which
// refetches automatically. No business data is pushed over the stream
// itself — this replaces interval polling, not the REST endpoints.
const stream = asyncHandler(async (req, res) => {
  const agentId = req.agent._id;
  const botIds = await handoverService.eligibleBotIds(agentId);

  setupSSE(req, res);
  sendEvent(res, "connected", {});

  const channels = [`agent-assigned:${agentId}`, ...botIds.map((id) => `bot-handovers:${id}`)];
  channels.forEach((c) => realtimeService.subscribe(c, res));
  const stopHeartbeat = startHeartbeat(res);

  req.on("close", () => {
    channels.forEach((c) => realtimeService.unsubscribe(c, res));
    stopHeartbeat();
  });
});

module.exports = {
  login,
  refreshToken,
  logout,
  getMe,
  uploadMyAvatar,
  setStatus,
  registerFcmToken,
  removeFcmToken,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  sendTestNotification,
  listPendingHandovers,
  listMyHandovers,
  acceptHandover,
  getMyConversation,
  sendAgentMessage,
  sendAgentMedia,
  listTransferCandidates,
  transferHandover,
  listCannedResponses,
  sendCannedResponse,
  listMyRatings,
  resolveConversation,
  stream,
};
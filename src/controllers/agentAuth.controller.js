const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const agentService = require("../services/agent.service");
const notificationService = require("../services/notification.service");
const Agent = require("../models/Agent");
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

const sanitizeAgent = (agent) => ({
  id: agent._id,
  name: agent.name,
  email: agent.email,
  avatar: agent.avatar,
  status: agent.status,
  bots: agent.bots,
  lastSeenAt: agent.lastSeenAt,
  performance: agent.performance,
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

module.exports = {
  login,
  refreshToken,
  logout,
  getMe,
  setStatus,
  registerFcmToken,
  removeFcmToken,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  sendTestNotification,
};
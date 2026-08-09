const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Bot = require("../models/Bot");
const analyticsService = require("../services/analytics.service");

// GET /api/bots/:id/analytics?days=30
const getBotAnalytics = asyncHandler(async (req, res) => {
  const bot = await Bot.findOne({ _id: req.params.id, user: req.user._id });
  if (!bot) throw new ApiError(404, "Bot not found");

  const days = Math.min(365, parseInt(req.query.days) || 30);
  const data = await analyticsService.getBotAnalytics(bot._id, days);

  res.status(200).json({ success: true, data });
});

// GET /api/bots/:id/analytics/events?limit=20
const getRecentEvents = asyncHandler(async (req, res) => {
  const bot = await Bot.findOne({ _id: req.params.id, user: req.user._id });
  if (!bot) throw new ApiError(404, "Bot not found");

  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const events = await analyticsService.getRecentEvents(bot._id, limit);

  res.status(200).json({ success: true, data: { events } });
});

// GET /api/bots/:id/analytics/domains
const getBotDomains = asyncHandler(async (req, res) => {
  const bot = await Bot.findOne({ _id: req.params.id, user: req.user._id });
  if (!bot) throw new ApiError(404, "Bot not found");

  const days = Math.min(365, parseInt(req.query.days) || 30);
  const data = await analyticsService.getBotAnalytics(bot._id, days);

  res.status(200).json({ success: true, data: { domains: data.domains } });
});

// GET /api/admin/analytics?days=30
const getPlatformAnalytics = asyncHandler(async (req, res) => {
  const days = Math.min(365, parseInt(req.query.days) || 30);
  const data = await analyticsService.getPlatformAnalytics(days);

  res.status(200).json({ success: true, data });
});

module.exports = {
  getBotAnalytics,
  getRecentEvents,
  getBotDomains,
  getPlatformAnalytics,
};
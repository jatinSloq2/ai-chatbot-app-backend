const MessageEvent = require("../models/MessageEvent");
const WidgetSession = require("../models/WidgetSession");
const crypto = require("crypto");

// ----------------------------------------------------------------
// Tracking helpers (called from chat controller on every message)
// ----------------------------------------------------------------

const hashIp = (ip) => {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip + (process.env.IP_HASH_SALT || "jestbot")).digest("hex").slice(0, 16);
};

const parseDomain = (origin) => {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

// Log a single message event (widget or test)
const logMessageEvent = async ({
  bot,
  user,
  type,
  req,
  sessionId,
  promptText,
  responseText,
  chunksRetrieved,
  topChunkScore,
  embeddingMs,
  retrievalMs,
  llmMs,
  totalMs,
  success,
  errorMessage,
  planSlug,
}) => {
  const origin    = req?.headers?.origin || req?.headers?.referer || null;
  const domain    = parseDomain(origin);
  const ip        = hashIp(req?.ip || req?.headers?.["x-forwarded-for"]);
  const userAgent = req?.headers?.["user-agent"]?.slice(0, 300) || null;

  await MessageEvent.create({
    bot:     bot._id,
    user:    user || bot.user,
    type,
    origin,
    domain,
    ip,
    userAgent,
    sessionId,
    promptTokensEstimate:   Math.round((promptText?.length || 0) / 4),
    responseTokensEstimate: Math.round((responseText?.length || 0) / 4),
    chunksRetrieved:  chunksRetrieved || 0,
    topChunkScore:    topChunkScore   || null,
    embeddingMs,
    retrievalMs,
    llmMs,
    totalMs,
    success,
    errorMessage: errorMessage || null,
    planSlug: planSlug || null,
  });
};

// Upsert a widget session record
const trackWidgetSession = async ({ bot, req, sessionId }) => {
  const origin    = req?.headers?.origin || null;
  const domain    = parseDomain(origin);
  const referer   = req?.headers?.referer || null;
  const ipHash    = hashIp(req?.ip || req?.headers?.["x-forwarded-for"]);
  const userAgent = req?.headers?.["user-agent"]?.slice(0, 300) || null;
  const country   = req?.headers?.["cf-ipcountry"] || null; // populated if behind Cloudflare
  const now       = new Date();

  await WidgetSession.findOneAndUpdate(
    { bot: bot._id, sessionId },
    {
      $set:  { origin, domain, country, userAgent, ipHash, lastMessageAt: now },
      $setOnInsert: { firstMessageAt: now },
      $inc:  { messageCount: 1 },
      $addToSet: { referrerPages: referer || "direct" },
    },
    { upsert: true, new: true }
  );
};

// ----------------------------------------------------------------
// Analytics queries (called from analytics controller)
// ----------------------------------------------------------------

// Overview stats for one bot over a date range
const getBotAnalytics = async (botId, days = 30) => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [
    totalWidget,
    totalTest,
    uniqueSessions,
    uniqueDomains,
    successRate,
    avgResponseTime,
    messagesPerDay,
    topDomains,
    hourlyDistribution,
  ] = await Promise.all([
    // Total widget messages
    MessageEvent.countDocuments({ bot: botId, type: "widget", createdAt: { $gte: since } }),

    // Total test messages
    MessageEvent.countDocuments({ bot: botId, type: "test", createdAt: { $gte: since } }),

    // Unique visitor sessions
    WidgetSession.countDocuments({ bot: botId, createdAt: { $gte: since } }),

    // Unique domains using this bot
    MessageEvent.distinct("domain", { bot: botId, type: "widget", domain: { $ne: null } }),

    // Success rate
    MessageEvent.aggregate([
      { $match: { bot: botId, createdAt: { $gte: since } } },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        successful: { $sum: { $cond: ["$success", 1, 0] } },
      }},
    ]),

    // Average response time (ms)
    MessageEvent.aggregate([
      { $match: { bot: botId, type: "widget", createdAt: { $gte: since }, totalMs: { $ne: null } } },
      { $group: { _id: null, avgMs: { $avg: "$totalMs" } } },
    ]),

    // Messages per day (for chart)
    MessageEvent.aggregate([
      { $match: { bot: botId, createdAt: { $gte: since } } },
      { $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          type: "$type",
        },
        count: { $sum: 1 },
      }},
      { $sort: { "_id.date": 1 } },
    ]),

    // Top embedding domains
    MessageEvent.aggregate([
      { $match: { bot: botId, type: "widget", createdAt: { $gte: since }, domain: { $ne: null } } },
      { $group: { _id: "$domain", messages: { $sum: 1 }, sessions: { $addToSet: "$sessionId" } } },
      { $project: { domain: "$_id", messages: 1, uniqueSessions: { $size: "$sessions" } } },
      { $sort: { messages: -1 } },
      { $limit: 10 },
    ]),

    // Messages by hour of day (to see peak times)
    MessageEvent.aggregate([
      { $match: { bot: botId, type: "widget", createdAt: { $gte: since } } },
      { $group: {
        _id: { $hour: "$createdAt" },
        count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),
  ]);

  // Shape messagesPerDay into a clean array
  const dayMap = {};
  messagesPerDay.forEach((d) => {
    const date = d._id.date;
    if (!dayMap[date]) dayMap[date] = { date, widget: 0, test: 0 };
    dayMap[date][d._id.type] = d.count;
  });
  const dailyChart = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

  const successData = successRate[0] || { total: 0, successful: 0 };
  const avgMs = avgResponseTime[0]?.avgMs || null;

  return {
    rangeDays: days,
    messages: {
      widget:     totalWidget,
      test:       totalTest,
      total:      totalWidget + totalTest,
    },
    sessions: {
      unique:     uniqueSessions,
    },
    domains: {
      unique:     uniqueDomains.length,
      list:       uniqueDomains,
      top:        topDomains,
    },
    performance: {
      successRate: successData.total > 0
        ? Math.round((successData.successful / successData.total) * 100)
        : null,
      avgResponseMs: avgMs ? Math.round(avgMs) : null,
    },
    charts: {
      messagesPerDay: dailyChart,
      messagesByHour: hourlyDistribution.map((h) => ({
        hour: h._id,
        count: h.count,
      })),
    },
  };
};

// Platform-wide analytics for admin
const getPlatformAnalytics = async (days = 30) => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [
    totalMessages,
    totalSessions,
    topBots,
    messagesPerDay,
    errorRate,
  ] = await Promise.all([
    MessageEvent.countDocuments({ createdAt: { $gte: since } }),
    WidgetSession.countDocuments({ createdAt: { $gte: since } }),

    // Top bots by message volume
    MessageEvent.aggregate([
      { $match: { createdAt: { $gte: since }, type: "widget" } },
      { $group: { _id: "$bot", messages: { $sum: 1 } } },
      { $sort: { messages: -1 } },
      { $limit: 10 },
      { $lookup: { from: "bots", localField: "_id", foreignField: "_id", as: "bot" } },
      { $unwind: "$bot" },
      { $project: { botName: "$bot.name", messages: 1 } },
    ]),

    // Platform messages per day
    MessageEvent.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),

    // Platform error rate
    MessageEvent.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        errors: { $sum: { $cond: [{ $eq: ["$success", false] }, 1, 0] } },
      }},
    ]),
  ]);

  const errData = errorRate[0] || { total: 0, errors: 0 };

  return {
    rangeDays: days,
    totalMessages,
    totalSessions,
    errorRate: errData.total > 0
      ? Math.round((errData.errors / errData.total) * 100 * 10) / 10
      : 0,
    topBots,
    messagesPerDay: messagesPerDay.map((d) => ({ date: d._id, count: d.count })),
  };
};

// Recent events for a bot (for the live feed in the dashboard)
const getRecentEvents = async (botId, limit = 20) => {
  return MessageEvent.find({ bot: botId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("type domain sessionId chunksRetrieved topChunkScore totalMs success errorMessage createdAt")
    .lean();
};

module.exports = {
  logMessageEvent,
  trackWidgetSession,
  getBotAnalytics,
  getPlatformAnalytics,
  getRecentEvents,
  parseDomain,
};
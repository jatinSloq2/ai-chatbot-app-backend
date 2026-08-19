const MessageEvent = require("../models/MessageEvent");
const WidgetSession = require("../models/WidgetSession");
const Conversation = require("../models/Conversation");
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
    totalWhatsapp,
    uniqueSessions,
    uniqueDomains,
    successRate,
    avgResponseTime,
    messagesPerDay,
    topDomains,
    hourlyDistribution,
    csatBuckets,
  ] = await Promise.all([
    // Total widget messages
    MessageEvent.countDocuments({ bot: botId, type: "widget", createdAt: { $gte: since } }),

    // Total test messages
    MessageEvent.countDocuments({ bot: botId, type: "test", createdAt: { $gte: since } }),

    // Total WhatsApp messages — was previously never counted anywhere in
    // this dashboard (every query here was hardcoded to type:"widget"),
    // so a bot getting real WhatsApp traffic looked completely idle.
    MessageEvent.countDocuments({ bot: botId, type: "whatsapp", createdAt: { $gte: since } }),

    // Unique visitor sessions (widget only — WhatsApp sessions are
    // conversations, not WidgetSession docs; see sessions.whatsapp below)
    WidgetSession.countDocuments({ bot: botId, createdAt: { $gte: since } }),

    // Unique domains using this bot
    MessageEvent.distinct("domain", { bot: botId, type: "widget", domain: { $ne: null } }),

    // Success rate — across every channel
    MessageEvent.aggregate([
      { $match: { bot: botId, createdAt: { $gte: since } } },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        successful: { $sum: { $cond: ["$success", 1, 0] } },
      }},
    ]),

    // Average response time (ms) — across every channel, not just widget
    MessageEvent.aggregate([
      { $match: { bot: botId, createdAt: { $gte: since }, totalMs: { $ne: null } } },
      { $group: { _id: null, avgMs: { $avg: "$totalMs" } } },
    ]),

    // Messages per day (for chart) — grouped by type so widget/test/
    // whatsapp each get their own series instead of whatsapp being folded
    // in invisibly.
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

    // Top embedding domains (widget-only concept — WhatsApp has no domain)
    MessageEvent.aggregate([
      { $match: { bot: botId, type: "widget", createdAt: { $gte: since }, domain: { $ne: null } } },
      { $group: { _id: "$domain", messages: { $sum: 1 }, sessions: { $addToSet: "$sessionId" } } },
      { $project: { domain: "$_id", messages: 1, uniqueSessions: { $size: "$sessions" } } },
      { $sort: { messages: -1 } },
      { $limit: 10 },
    ]),

    // Messages by hour of day (to see peak times) — across every channel
    MessageEvent.aggregate([
      { $match: { bot: botId, createdAt: { $gte: since } } },
      { $group: {
        _id: { $hour: "$createdAt" },
        count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),

    // CSAT — average rating + 1-5 star distribution across every rated
    // conversation for this bot in the window, split by channel (widget vs
    // WhatsApp — a blended number was hiding the fact that WhatsApp
    // handovers often run at a very different satisfaction level than
    // widget ones). Reads from handover.history[].csatRating/csatRatedAt
    // rather than the top-level handover.csat, which only ever holds the
    // CURRENT resolve cycle's rating and resets to null every time a
    // conversation is resolved again (see handover.service.js#
    // resolveHandover) — the old query here had exactly that staleness
    // bug and could silently drop ratings from a conversation that had
    // since moved into a new, not-yet-rated cycle.
    Conversation.aggregate([
      { $match: { bot: botId, type: { $in: ["widget", "whatsapp"] } } },
      { $unwind: "$handover.history" },
      { $match: { "handover.history.csatRating": { $ne: null }, "handover.history.csatRatedAt": { $gte: since } } },
      { $group: {
        _id: { type: "$type", rating: "$handover.history.csatRating" },
        count: { $sum: 1 },
      }},
    ]),
  ]);

  // Shape messagesPerDay into a clean array
  const dayMap = {};
  messagesPerDay.forEach((d) => {
    const date = d._id.date;
    if (!dayMap[date]) dayMap[date] = { date, widget: 0, test: 0, whatsapp: 0 };
    dayMap[date][d._id.type] = d.count;
  });
  const dailyChart = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

  const successData = successRate[0] || { total: 0, successful: 0 };
  const avgMs = avgResponseTime[0]?.avgMs || null;

  // Builds { average, count, distribution } from a flat list of
  // { rating, count } buckets — shared by the combined csat block and each
  // per-channel one below so they're computed identically.
  const buildCsatBlock = (buckets) => {
    const distribution = [1, 2, 3, 4, 5].map((star) => ({
      rating: star,
      count: buckets.filter((b) => b.rating === star).reduce((s, b) => s + b.count, 0),
    }));
    const count = distribution.reduce((sum, b) => sum + b.count, 0);
    const average = count
      ? Math.round((distribution.reduce((sum, b) => sum + b.rating * b.count, 0) / count) * 10) / 10
      : null;
    return { average, count, distribution };
  };

  const bucketsFlat = csatBuckets.map((b) => ({ type: b._id.type, rating: b._id.rating, count: b.count }));

  return {
    rangeDays: days,
    messages: {
      widget:     totalWidget,
      test:       totalTest,
      whatsapp:   totalWhatsapp,
      total:      totalWidget + totalTest + totalWhatsapp,
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
    // Human-handover satisfaction — how visitors rated resolved agent
    // chats. Combined across channels for back-compat, plus a byChannel
    // split since widget and WhatsApp handovers can run at very different
    // satisfaction levels and a single blended number was hiding that.
    csat: {
      ...buildCsatBlock(bucketsFlat),
      byChannel: {
        widget: buildCsatBlock(bucketsFlat.filter((b) => b.type === "widget")),
        whatsapp: buildCsatBlock(bucketsFlat.filter((b) => b.type === "whatsapp")),
      },
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

    // Top bots by message volume — across every channel (widget, test,
    // whatsapp), not just widget, so a bot driven mostly by WhatsApp
    // traffic doesn't disappear from this leaderboard.
    MessageEvent.aggregate([
      { $match: { createdAt: { $gte: since } } },
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
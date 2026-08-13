const Bot = require("../models/Bot");
const Conversation = require("../models/Conversation");

// A "lead" is a distinct visitor identity (keyed by email, falling back to
// phone) captured via a bot's pre-chat form. The same person may message
// more than one of the owner's bots — this aggregates those into one row
// instead of showing duplicate entries.
const listLeads = async (ownerId, { page = 1, limit = 20 } = {}) => {
  const bots = await Bot.find({ user: ownerId }).select("_id name");
  if (!bots.length) return { leads: [], total: 0, page, totalPages: 0 };

  const botIds = bots.map((b) => b._id);
  const botNameById = Object.fromEntries(bots.map((b) => [b._id.toString(), b.name]));

  const conversations = await Conversation.find({
    bot: { $in: botIds },
    $or: [{ "visitor.email": { $ne: null } }, { "visitor.phone": { $ne: null } }],
  })
    .select("bot sessionId visitor messages createdAt updatedAt")
    .sort({ updatedAt: -1 })
    .lean();

  const leadsByKey = new Map();

  for (const c of conversations) {
    const key = c.visitor.email || c.visitor.phone;
    if (!key) continue;

    const botId = c.bot.toString();
    const entry = leadsByKey.get(key) || {
      key,
      name: c.visitor.name || null,
      email: c.visitor.email || null,
      phone: c.visitor.phone || null,
      emailVerified: false,
      phoneVerified: false,
      bots: new Map(), // botId -> { botId, botName, conversationCount }
      conversationCount: 0,
      lastActivityAt: c.updatedAt,
      firstSeenAt: c.createdAt,
    };

    // Conversations are sorted newest-first, so the first time we see this
    // key already carries the freshest name/verification/activity — only
    // backfill fields the newest record left blank.
    if (!entry.name && c.visitor.name) entry.name = c.visitor.name;
    if (!entry.email && c.visitor.email) entry.email = c.visitor.email;
    if (!entry.phone && c.visitor.phone) entry.phone = c.visitor.phone;
    entry.emailVerified = entry.emailVerified || c.visitor.emailVerified;
    entry.phoneVerified = entry.phoneVerified || c.visitor.phoneVerified;
    if (c.createdAt < entry.firstSeenAt) entry.firstSeenAt = c.createdAt;

    const botEntry = entry.bots.get(botId) || {
      botId,
      botName: botNameById[botId] || "Unknown bot",
      conversationCount: 0,
    };
    botEntry.conversationCount += 1;
    entry.bots.set(botId, botEntry);
    entry.conversationCount += 1;

    leadsByKey.set(key, entry);
  }

  const allLeads = Array.from(leadsByKey.values())
    .map((e) => ({ ...e, bots: Array.from(e.bots.values()) }))
    .sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));

  const total = allLeads.length;
  const start = (page - 1) * limit;
  const leads = allLeads.slice(start, start + limit);

  return { leads, total, page, totalPages: Math.ceil(total / limit) };
};

// All conversations (across every bot) tied to one lead identifier, so the
// owner can open any of them from the Leads page.
const getLeadConversations = async (ownerId, identifier) => {
  const bots = await Bot.find({ user: ownerId }).select("_id name");
  const botIds = bots.map((b) => b._id);
  const botNameById = Object.fromEntries(bots.map((b) => [b._id.toString(), b.name]));

  const conversations = await Conversation.find({
    bot: { $in: botIds },
    $or: [{ "visitor.email": identifier }, { "visitor.phone": identifier }],
  })
    .select("bot sessionId visitor messages createdAt updatedAt")
    .sort({ updatedAt: -1 })
    .lean();

  return conversations.map((c) => ({
    botId: c.bot.toString(),
    botName: botNameById[c.bot.toString()] || "Unknown bot",
    sessionId: c.sessionId,
    messageCount: c.messages.length,
    lastMessage: c.messages[c.messages.length - 1]?.content?.slice(0, 120) || "",
    startedAt: c.createdAt,
    lastActivityAt: c.updatedAt,
  }));
};

module.exports = { listLeads, getLeadConversations };
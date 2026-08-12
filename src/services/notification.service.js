const admin = require("../config/firebase");
const Agent = require("../models/Agent");
const AgentNotification = require("../models/AgentNotification");
const logger = require("../utils/logger");

// Registers (or refreshes) a device's FCM token for an agent. Safe to call
// repeatedly with the same token (e.g. on every app load) — it dedupes.
const registerFcmToken = async (agentId, token, device) => {
  await Agent.updateOne({ _id: agentId }, { $pull: { fcmTokens: { token } } });
  await Agent.updateOne(
    { _id: agentId },
    { $push: { fcmTokens: { token, device: device || null, addedAt: new Date() } } }
  );
};

// Removes a single device token, e.g. on logout so a shared/borrowed device
// stops receiving that agent's notifications.
const removeFcmToken = async (agentId, token) => {
  await Agent.updateOne({ _id: agentId }, { $pull: { fcmTokens: { token } } });
};

// Sends a push notification to every device an agent is logged in on, and
// persists an AgentNotification row regardless of whether the push itself
// succeeds (so the in-app notification list is always the source of truth).
// `type` is a free-form event key (e.g. "test", "handover_request" in later
// phases); `data` is an optional deep-link payload.
const notifyAgent = async ({ agentId, type, title, body, data = {} }) => {
  const record = await AgentNotification.create({ agent: agentId, type, title, body, data });

  const agent = await Agent.findById(agentId).select("fcmTokens");
  const tokens = (agent?.fcmTokens || []).map((t) => t.token);

  if (tokens.length) {
    try {
      const stringData = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])
      );
      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: stringData,
      });

      // Drop any tokens Firebase reports as dead (uninstalled app, expired
      // registration, etc.) so we stop wasting sends on them.
      const deadTokens = [];
      response.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error?.code;
          if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
            deadTokens.push(tokens[i]);
          }
        }
      });
      if (deadTokens.length) {
        await Agent.updateOne({ _id: agentId }, { $pull: { fcmTokens: { token: { $in: deadTokens } } } });
      }
    } catch (err) {
      // Never let a push-delivery failure break the caller's flow — the
      // AgentNotification row above is already saved either way.
      logger.error(`FCM send failed for agent ${agentId}: ${err.message}`);
    }
  }

  return record;
};

// Same as notifyAgent but fans out to several agents at once (e.g. "notify
// every agent eligible for this bot" in the handover phase).
const notifyAgents = async ({ agentIds, type, title, body, data = {} }) => {
  return Promise.all(agentIds.map((agentId) => notifyAgent({ agentId, type, title, body, data })));
};

const listNotifications = async (agentId, { page = 1, limit = 20 } = {}) => {
  const filter = { agent: agentId };
  const [notifications, total, unreadCount] = await Promise.all([
    AgentNotification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    AgentNotification.countDocuments(filter),
    AgentNotification.countDocuments({ ...filter, readAt: null }),
  ]);
  return { notifications, total, unreadCount, page, totalPages: Math.ceil(total / limit) };
};

const markAsRead = async (agentId, notificationId) => {
  await AgentNotification.updateOne(
    { _id: notificationId, agent: agentId, readAt: null },
    { $set: { readAt: new Date() } }
  );
};

const markAllAsRead = async (agentId) => {
  await AgentNotification.updateMany({ agent: agentId, readAt: null }, { $set: { readAt: new Date() } });
};

module.exports = {
  registerFcmToken,
  removeFcmToken,
  notifyAgent,
  notifyAgents,
  listNotifications,
  markAsRead,
  markAllAsRead,
};
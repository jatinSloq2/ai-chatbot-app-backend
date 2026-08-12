const mongoose = require("mongoose");

// Persisted copy of every notification sent to an agent, so the agent panel
// has a notification list/inbox even if the FCM push itself was missed
// (browser closed, permission denied, etc).
const agentNotificationSchema = new mongoose.Schema(
  {
    agent: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", required: true, index: true },

    // Free-form for now ("test" is the only type Phase 1 sends). Later
    // phases add "handover_request", "conversation_reassigned",
    // "customer_replied", "agent_timeout", "escalation", etc.
    type: { type: String, required: true },

    title: { type: String, required: true },
    body: { type: String, default: "" },
    // Arbitrary payload for deep-linking the agent to the right screen
    // (e.g. { botId, conversationSessionId }).
    data: { type: mongoose.Schema.Types.Mixed, default: {} },

    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

agentNotificationSchema.index({ agent: 1, createdAt: -1 });

module.exports = mongoose.model("AgentNotification", agentNotificationSchema);
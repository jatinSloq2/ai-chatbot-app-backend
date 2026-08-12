const mongoose = require("mongoose");

// An Agent is a real person the platform account owner adds to help handle
// conversations on their bot(s) — distinct from the owner's own User account.
// Agents log in separately (see agentAuth.controller.js) and only ever see
// conversations assigned to them.
const agentSchema = new mongoose.Schema(
  {
    // The platform account (dashboard User) this agent works for.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    avatar: { type: String, default: null },

    status: { type: String, enum: ["online", "offline", "busy", "away"], default: "offline" },
    // Owner can disable an agent (revoke access) without deleting their history.
    isActive: { type: Boolean, default: true },

    // Bots this agent can directly handle, independent of team membership.
    // (Team-based access is resolved via Team.members + Bot.assignedTeams.)
    bots: [{ type: mongoose.Schema.Types.ObjectId, ref: "Bot" }],

    lastSeenAt: { type: Date, default: null },

    // Web-push (FCM) device tokens. An agent may be logged in on more than
    // one device/browser at once, so this is a list, not a single token.
    fcmTokens: [
      {
        _id: false,
        token: { type: String, required: true },
        device: { type: String, default: null }, // optional user-agent/device label
        addedAt: { type: Date, default: Date.now },
      },
    ],

    refreshTokenHash: { type: String, select: false },

    // Performance counters. Populated by the assignment/handover engine in a
    // later phase — scaffolded now so the schema doesn't need another
    // migration once that phase lands.
    performance: {
      assignedCount: { type: Number, default: 0 },
      resolvedCount: { type: Number, default: 0 },
      missedCount: { type: Number, default: 0 },
      reassignedCount: { type: Number, default: 0 },
      points: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

agentSchema.index({ owner: 1, createdAt: -1 });

module.exports = mongoose.model("Agent", agentSchema);
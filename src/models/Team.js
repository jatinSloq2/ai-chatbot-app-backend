const mongoose = require("mongoose");

// A Team groups agents belonging to the same owner so a whole group can be
// assigned to a bot at once (Bot.assignedTeams). An agent may belong to
// multiple teams.
const teamSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "Agent" }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Team names only need to be unique within one owner's account.
teamSchema.index({ owner: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Team", teamSchema);
const mongoose = require("mongoose");

const richButtonSchema = new mongoose.Schema({ label: String, value: String }, { _id: false });

// Defined as a real Schema (not an inline object literal) specifically to
// avoid Mongoose's "type" key ambiguity: a plain object field named `type`
// nested inside another field's `{ type: ..., default: ... }` descriptor is
// indistinguishable from "this is the field's data type" to Mongoose, and
// throws at model-compile time. Wrapping it in mongoose.Schema(...) makes it
// an unambiguous type reference. See Conversation.js's richContentSchema for
// the same pattern.
const cannedRichContentSchema = new mongoose.Schema(
    {
        type: { type: String, enum: ["buttons", "quick_replies", "card"], default: null },
        buttons: { type: [richButtonSchema], default: [] },
    },
    { _id: false }
);

// A saved reply ("macro") an agent can drop into a conversation instead of
// retyping a common answer. Owned by the platform account (User), scoped
// either to a single bot or shared across every bot the owner has —
// available to ALL of that owner's agents (not per-agent), since these are
// meant to be a shared team playbook rather than personal notes.
const cannedResponseSchema = new mongoose.Schema(
    {
        owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        // null = usable on every bot this owner has. Otherwise scoped to one bot.
        bot: { type: mongoose.Schema.Types.ObjectId, ref: "Bot", default: null, index: true },

        title: { type: String, required: true, trim: true }, // shown in the macro picker list
        // Optional "/shortcut" the agent can type to filter/insert quickly,
        // e.g. "refund" -> matches "/refund" in the agent panel's macro search.
        shortcut: { type: String, default: null, trim: true, lowercase: true },

        content: { type: String, default: "", trim: true }, // the reply text itself

        // Agents can attach media to a canned response (e.g. a screenshot, a
        // PDF spec sheet) so the macro sends both text and the attachment(s)
        // together in one go.
        media: [
            {
                _id: false,
                url: { type: String, required: true },
                fileName: { type: String, default: null },
                mimeType: { type: String, default: null },
                size: { type: Number, default: null },
                kind: { type: String, enum: ["image", "file"], default: "file" },
                provider: { type: String, enum: ["vps", "cloudinary"], default: "vps" },
                publicId: { type: String, default: null },
            },
        ],

        // Optional buttons/quick-replies sent alongside the macro's text.
        richContent: { type: cannedRichContentSchema, default: null },

        usageCount: { type: Number, default: 0 }, // incremented each time an agent uses it

        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", default: null }, // agent who created it, if created from the agent panel
    },
    { timestamps: true }
);

cannedResponseSchema.index({ owner: 1, bot: 1, title: 1 });
cannedResponseSchema.index({ owner: 1, shortcut: 1 });

module.exports = mongoose.model("CannedResponse", cannedResponseSchema);
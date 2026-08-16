const mongoose = require("mongoose");

// Every webhook call Meta makes to us lands here first, as-is. This is
// deliberately a dumb append-only log rather than a parsed/normalized
// model — the real "route this message to a bot/conversation" pipeline
// doesn't exist yet, so this exists purely so nothing is lost between now
// and when that pipeline gets built. Once that pipeline exists, it should
// read from here (or straight off the request) and flip `processed`.
const whatsAppEventSchema = new mongoose.Schema(
    {
        // "messages" (inbound message or delivery/read status update) is the
        // only field WhatsApp Cloud API sends today, but keeping this generic
        // in case Meta adds other webhook fields (e.g. account alerts) later.
        field: { type: String, default: null, index: true },
        // What kind of payload this change actually contained — derived at
        // save time purely for easy filtering/searching, not from the API.
        kind: {
            type: String,
            enum: ["message", "status", "unknown"],
            default: "unknown",
            index: true,
        },

        // WhatsApp Business Account ID (entry[].id) and the specific phone
        // number the event is about (value.metadata.phone_number_id) — once
        // bots get their own WhatsApp numbers, phoneNumberId is what maps an
        // event back to a specific bot.
        wabaId: { type: String, default: null, index: true },
        phoneNumberId: { type: String, default: null, index: true },

        // Quick-glance fields pulled out of the payload for the admin log
        // view, without needing to open `raw` every time.
        from: { type: String, default: null }, // sender's wa_id, for inbound messages
        messageType: { type: String, default: null }, // "text", "image", "button", etc.
        preview: { type: String, default: null }, // short text snippet or status value

        // The full, untouched "change" object from Meta, exactly as received.
        raw: { type: mongoose.Schema.Types.Mixed, required: true },

        // Whether our webhook signature check passed. false doesn't mean the
        // event was rejected (we still 200 and store it for visibility) — see
        // whatsapp.controller.js for why we don't hard-fail on this yet.
        signatureValid: { type: Boolean, default: null },

        // Flipped true once a real processing pipeline (not built yet) has
        // consumed this event — exists now so that pipeline has something to
        // query against from day one instead of needing a migration later.
        processed: { type: Boolean, default: false, index: true },
    },
    { timestamps: true }
);

module.exports = mongoose.model("WhatsAppEvent", whatsAppEventSchema);
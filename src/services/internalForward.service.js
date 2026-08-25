const logger = require("../utils/logger");

// ---------------------------------------------------------------------------
// Internal event forwarding — relays WhatsApp activity to Jesty's
// /api/webhook endpoint so its own Conversation/Message/Contact records stay
// in sync with ours. Jesty does NOT verify Meta's hub.verify_token/
// signature — it trusts us via a shared secret instead (see
// verifyForwardSecret in Jesty's webhook.controller.ts), so we send that
// secret as x-webhook-secret rather than passing through
// X-Hub-Signature-256.
//
//   INTERNAL_WEBHOOK_FORWARD_URL    - Jesty's POST /api/webhook URL
//   INTERNAL_WEBHOOK_FORWARD_SECRET - must match Jesty's INTERNAL_WEBHOOK_SECRET
//
// Two kinds of events get relayed:
//
//   1. forwardRawWebhook  — the EXACT raw Meta payload we received on our
//      own /api/whatsapp/webhook, byte-for-byte. This is how Jesty learns
//      about INBOUND visitor messages/statuses (unchanged from before).
//
//   2. forwardOutboundMessage — a message WE sent out over the Cloud API
//      (an AI/bot reply, an agent's reply during handover, a system
//      notice/apology, etc). Meta's webhook never echoes these back to us,
//      so without this Jesty would only ever see half of every
//      conversation. Fired from whatsappSender.service.js right after a
//      send succeeds, for every outbound send regardless of who/what
//      triggered it — the AI pipeline, a human agent, or an automated
//      notice — so Jesty can save it with direction:"outbound" and the
//      right `sentBy`.
//
// Both are best-effort and fire-and-forget: forwarding must never block or
// fail our own webhook processing or message sending.
// ---------------------------------------------------------------------------
const FORWARD_URL = process.env.INTERNAL_WEBHOOK_FORWARD_URL || null;
const FORWARD_SECRET = process.env.INTERNAL_WEBHOOK_FORWARD_SECRET || null;
const FORWARD_TIMEOUT_MS = 5000;

const postToJesty = async (body, { isRaw }) => {
    if (!FORWARD_URL) return; // forwarding not configured — no-op

    if (!FORWARD_SECRET) {
        logger.warn("[internalForward] INTERNAL_WEBHOOK_FORWARD_SECRET is not set — skipping forward to Jesty");
        return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);

    try {
        const res = await fetch(FORWARD_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // This is what Jesty's verifyForwardSecret middleware checks —
                // NOT Meta's own X-Hub-Signature-256, which Jesty never sees.
                "x-webhook-secret": FORWARD_SECRET,
            },
            body,
            signal: controller.signal,
        });

        if (!res.ok) {
            logger.warn(`[internalForward] Forward to Jesty returned HTTP ${res.status}`);
        }
    } catch (err) {
        // Down/slow Jesty should never affect our own webhook processing or
        // message sending.
        logger.warn(
            `[internalForward] Failed to forward ${isRaw ? "raw webhook" : "outbound message"} to Jesty: ${err.message}`
        );
    } finally {
        clearTimeout(timeout);
    }
};

// Relays the exact raw Meta webhook body onward, untouched — same shape as
// what Meta sent us.
const forwardRawWebhook = async (rawBody) => {
    // rawBody is an untouched Buffer — same shape as Meta's own body.
    await postToJesty(rawBody, { isRaw: true });
};

// Relays a message WE sent out over the Cloud API. `event` is a plain
// object (NOT Meta-shaped, since Meta never gives us one of these) —
// Jesty's webhook handler distinguishes it from a raw Meta payload via the
// `event` discriminator field and maps it onto its own Message/Conversation/
// Contact records (direction:"outbound").
//
// Shape:
//   {
//     event: "whatsapp_outbound_message",
//     phoneNumberId,      // which of our WhatsApp numbers this was sent from
//     waId,                // recipient's WhatsApp id (no +), i.e. Conversation.waId
//     waMessageId,          // Meta's wamid for this send, or null if the send failed
//     type,                 // "text" | "image" | "video" | "audio" | "document"
//     text,                 // body text (text messages) / caption (media messages)
//     mediaUrl, mediaMimeType, fileName, // present for media sends only
//     sentBy,               // "ai" for bot replies, or the sending agent's id
//     status,               // "sent" | "failed"
//     errorMessage,         // present when status:"failed"
//     timestamp,            // ISO string, when we attempted the send
//   }
const forwardOutboundMessage = async (event) => {
    let body;
    try {
        body = JSON.stringify({ event: "whatsapp_outbound_message", timestamp: new Date().toISOString(), ...event });
    } catch (err) {
        logger.warn(`[internalForward] Failed to serialize outbound message for Jesty: ${err.message}`);
        return;
    }
    await postToJesty(body, { isRaw: false });
};

module.exports = { forwardRawWebhook, forwardOutboundMessage };
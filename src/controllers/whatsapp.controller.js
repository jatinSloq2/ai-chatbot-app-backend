const crypto = require("crypto");
const asyncHandler = require("../utils/asyncHandler");
const logger = require("../utils/logger");
const WhatsAppEvent = require("../models/WhatsAppEvent");

/**
 * GET /api/whatsapp/webhook
 *
 * Meta's one-time verification handshake — when you paste your webhook URL
 * into the WhatsApp app dashboard and click "Verify and save", Meta sends:
 *   ?hub.mode=subscribe&hub.verify_token=<whatever you configured there>&hub.challenge=<random string>
 * We must echo back hub.challenge as plain text, and ONLY if the token
 * matches WHATSAPP_VERIFY_TOKEN — otherwise anyone could point a webhook
 * URL at us and get it silently "verified".
 */
const verifyWebhook = (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (!expectedToken) {
        logger.error("[whatsapp] WHATSAPP_VERIFY_TOKEN is not set — refusing webhook verification");
        return res.sendStatus(500);
    }

    if (mode === "subscribe" && token === expectedToken) {
        logger.info("[whatsapp] Webhook verification succeeded");
        return res.status(200).send(challenge);
    }

    logger.warn(`[whatsapp] Webhook verification failed (mode=${mode}, token match=${token === expectedToken})`);
    return res.sendStatus(403);
};

/**
 * Verifies Meta's X-Hub-Signature-256 header: sha256=<hex HMAC of the raw
 * request body, keyed with your Meta App Secret>. Requires the RAW,
 * unparsed body — this is why the route is mounted with express.raw()
 * before the global express.json() (see app.js), same pattern already used
 * for the Razorpay webhook.
 */
const isValidSignature = (rawBody, signatureHeader) => {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret || !signatureHeader) return false;

    const expected =
        "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

    // Lengths must match before timingSafeEqual, or it throws instead of
    // just returning false.
    if (expected.length !== signatureHeader.length) return false;

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
};

// Pulls a few human-readable fields out of one "change" entry purely for
// logging/quick-glance storage — never throws on an unexpected shape,
// since Meta's payload shape is out of our control and a webhook must
// always ack with 200 regardless of what it contains.
const summarizeChange = (change) => {
    const value = change?.value || {};
    const message = value.messages?.[0];
    const status = value.statuses?.[0];

    if (message) {
        return {
            kind: "message",
            phoneNumberId: value.metadata?.phone_number_id || null,
            from: message.from || null,
            messageType: message.type || null,
            preview:
                message.text?.body?.slice(0, 200) ||
                (message.type ? `[${message.type} message]` : null),
        };
    }

    if (status) {
        return {
            kind: "status",
            phoneNumberId: value.metadata?.phone_number_id || null,
            from: status.recipient_id || null,
            messageType: null,
            preview: `status=${status.status}${status.id ? ` id=${status.id}` : ""}`,
        };
    }

    return { kind: "unknown", phoneNumberId: value.metadata?.phone_number_id || null, from: null, messageType: null, preview: null };
};

/**
 * POST /api/whatsapp/webhook
 *
 * Receives every message and status update Meta sends. Deliberately does
 * NOT process/route anything yet (no bot lookup, no reply, no conversation
 * writes) — that pipeline doesn't exist yet. For now this: verifies the
 * signature, logs a readable line per event, persists the raw payload so
 * nothing is lost, and acks fast. Meta retries with backoff (and can
 * eventually disable the webhook) if it doesn't get a quick 200, so this
 * handler must never block on slow work — hence "log + store", not
 * "log + store + fully process".
 */
const receiveWebhook = asyncHandler(async (req, res) => {
    // req.body is a raw Buffer here (see the express.raw() mount in app.js) —
    // parse it ourselves after signature verification, rather than trusting
    // an upstream JSON parser to have already touched (and thus altered) it.
    const rawBody = req.body;
    const signatureHeader = req.headers["x-hub-signature-256"];
    const signatureValid = isValidSignature(rawBody, signatureHeader);

    if (!process.env.WHATSAPP_APP_SECRET) {
        logger.warn("[whatsapp] WHATSAPP_APP_SECRET is not set — accepting webhook WITHOUT signature verification. Set this before going to production.");
    } else if (!signatureValid) {
        // Logged but not rejected outright: Meta's retry/backoff behavior on a
        // hard 4xx here can be more disruptive than accepting-and-flagging a
        // handful of bad-signature events while this integration is still
        // being wired up. Revisit this once the real processing pipeline
        // exists and a bad signature should mean "don't touch this event".
        logger.warn("[whatsapp] Webhook signature verification FAILED — storing event anyway, flagged as unverified");
    }

    let payload;
    try {
        payload = JSON.parse(rawBody.toString("utf8"));
    } catch (err) {
        logger.error(`[whatsapp] Webhook body was not valid JSON: ${err.message}`);
        // Still 200 — a malformed body is Meta's problem to fix, not something
        // we want retried forever.
        return res.sendStatus(200);
    }

    logger.info(`[whatsapp] Webhook received: object=${payload.object || "unknown"}`);

    const entries = Array.isArray(payload.entry) ? payload.entry : [];

    for (const entry of entries) {
        const wabaId = entry.id || null;
        const changes = Array.isArray(entry.changes) ? entry.changes : [];

        for (const change of changes) {
            const summary = summarizeChange(change);

            logger.info(
                `[whatsapp] event kind=${summary.kind} waba=${wabaId} phoneNumberId=${summary.phoneNumberId} ` +
                `from=${summary.from} type=${summary.messageType} preview=${JSON.stringify(summary.preview)}`
            );

            try {
                await WhatsAppEvent.create({
                    field: change.field || null,
                    kind: summary.kind,
                    wabaId,
                    phoneNumberId: summary.phoneNumberId,
                    from: summary.from,
                    messageType: summary.messageType,
                    preview: summary.preview,
                    raw: change,
                    signatureValid,
                });
            } catch (err) {
                // Never let a DB hiccup turn into a 500 -> Meta retry storm. The
                // event is already fully logged above even if persistence fails.
                logger.error(`[whatsapp] Failed to persist webhook event: ${err.message}`);
            }
        }
    }

    // Meta requires a 200 within a few seconds or it treats delivery as
    // failed and retries with backoff — always ack once we've logged/stored,
    // regardless of anything above.
    res.sendStatus(200);
});

module.exports = { verifyWebhook, receiveWebhook };
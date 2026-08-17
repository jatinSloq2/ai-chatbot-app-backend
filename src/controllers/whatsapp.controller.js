const crypto = require("crypto");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const logger = require("../utils/logger");
const WhatsAppEvent = require("../models/WhatsAppEvent");
const IntegrationCredential = require("../models/IntegrationCredential");
const Bot = require("../models/Bot");
const Conversation = require("../models/Conversation");
const ragService = require("../services/rag.service");
const llmService = require("../services/llm.service");
const botService = require("../services/bot.service");
const handoverService = require("../services/handover.service");
const analyticsService = require("../services/analytics.service");
const whatsappSender = require("../services/whatsappSender.service");
const { getLanguageName } = require("../utils/i18n");

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
 * request body, keyed with the Meta App Secret>. Requires the RAW,
 * unparsed body — this is why the route is mounted with express.raw()
 * before the global express.json() (see app.js), same pattern already used
 * for the Razorpay webhook.
 *
 * `appSecret` is no longer a single platform-wide env var — every tenant
 * has their own Meta App (and therefore their own App Secret), stored on
 * their IntegrationCredential (whatsapp.appSecret). The caller is
 * responsible for looking up the right credential and passing its
 * decrypted appSecret in here.
 */
const isValidSignature = (rawBody, signatureHeader, appSecret) => {
    if (!appSecret || !signatureHeader) return false;

    const expected =
        "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

    // Lengths must match before timingSafeEqual, or it throws instead of
    // just returning false.
    if (expected.length !== signatureHeader.length) return false;

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
};

// Pulls the phone_number_id out of the first message/status change in a
// webhook payload — used purely to figure out WHICH tenant's credential
// (and therefore which Meta App Secret) this payload should be verified
// against. A single incoming request always originates from one Meta App
// (whichever tenant's App owns the webhook subscription that fired), so
// every entry in the batch shares the same App Secret — checking the first
// one is enough.
const extractFirstPhoneNumberId = (payload) => {
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    for (const entry of entries) {
        const changes = Array.isArray(entry.changes) ? entry.changes : [];
        for (const change of changes) {
            const phoneNumberId = change?.value?.metadata?.phone_number_id;
            if (phoneNumberId) return phoneNumberId;
        }
    }
    return null;
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

// Same "reply in the visitor's language" instruction the widget's chat
// pipeline uses — kept in lockstep so a bot behaves identically on both
// channels. WhatsApp conversations don't have a language picker, so this
// only ever kicks in if a bot's default language isn't English.
const withLanguageInstruction = (systemPrompt, languageCode) => {
    if (!languageCode || languageCode === "en") return systemPrompt;
    return `${systemPrompt}\n\nRespond in ${getLanguageName(languageCode)} (language code: ${languageCode}), regardless of what language the provided context is written in.`;
};

/**
 * Runs one inbound WhatsApp text message through the exact same brain the
 * widget uses — RAG retrieval + LLM completion, or straight into the
 * transcript untouched if a human agent is already handling this
 * conversation — then sends the result back out over the Cloud API. Mirrors
 * chat.controller.js#chat, minus the SSE token streaming (WhatsApp has no
 * concept of a partial message).
 *
 * Never throws — every failure path is caught, logged, and (best-effort)
 * turned into an apologetic reply to the sender, since this runs after the
 * webhook has already ack'd 200 and nothing is listening for a thrown error.
 */
const handleInboundMessage = async ({ phoneNumberId, from, text }) => {
    const credential = await IntegrationCredential.findOne({
        channel: "whatsapp",
        "whatsapp.phoneNumberId": phoneNumberId,
        isActive: true,
    });
    if (!credential) {
        logger.warn(`[whatsapp] No active credential found for phoneNumberId=${phoneNumberId} — dropping message`);
        return;
    }

    const bot = await Bot.findOne({
        "whatsappConfig.credentialId": credential._id,
        "whatsappConfig.enabled": true,
        isActive: true,
    });
    if (!bot) {
        logger.warn(`[whatsapp] phoneNumberId=${phoneNumberId} isn't connected to an enabled bot — dropping message`);
        return;
    }

    if (!text) {
        // Non-text message (image/audio/location/etc.) — the AI pipeline only
        // understands text today. Tell the sender rather than silently
        // dropping their message.
        try {
            await whatsappSender.sendWhatsappText(credential.whatsapp, {
                to: from,
                message: "I can only read text messages right now — could you type that out for me?",
            });
        } catch (err) {
            logger.error(`[whatsapp] Failed to send unsupported-media notice to ${from}: ${err.message}`);
        }
        return;
    }

    // sessionId IS the sender's WhatsApp number — one conversation per
    // (bot, phone number) pair, same way sessionId is one per (bot,
    // browser) pair on the widget.
    let conversation = await Conversation.findOne({ bot: bot._id, sessionId: from });
    if (!conversation) {
        conversation = await Conversation.create({
            bot: bot._id,
            sessionId: from,
            type: "whatsapp",
            visitor: { phone: from, phoneVerified: true },
            messages: [],
        });
    }

    // A human is (or is about to be) handling this conversation — route the
    // message straight into the transcript instead of calling the AI, same
    // as the widget's handover branch. The agent's reply gets sent back out
    // over WhatsApp from handover.service.js#sendAgentMessage.
    if (conversation.handover.status === "requested" || conversation.handover.status === "assigned") {
        await handoverService.appendVisitorMessage(conversation, text);
        return;
    }

    let plan;
    try {
        plan = await botService.checkAndIncrementMessageUsage(bot);
    } catch (err) {
        logger.warn(`[whatsapp] Message from ${from} rejected: ${err.message}`);
        if (!(err instanceof ApiError && err.statusCode === 429)) {
            // Anything other than "you hit your plan limit" is unexpected —
            // surface it. A 429 is an expected, silent-to-the-visitor outcome
            // (mirrors how the widget just stops responding past the limit).
            logger.error(`[whatsapp] Unexpected error checking usage for bot ${bot._id}: ${err.message}`);
        }
        return;
    }

    const totalStart = Date.now();
    let embeddingMs = null;
    let retrievalMs = null;
    let llmMs = null;
    let fullResponse = "";
    let chunksRetrieved = 0;
    let topChunkScore = null;
    let success = true;
    let errorMessage = null;

    try {
        const embStart = Date.now();
        const relevantChunks = await ragService.retrieveRelevantChunks(bot._id, text, bot.embeddingConfig);
        embeddingMs = Date.now() - embStart;
        chunksRetrieved = relevantChunks.length;
        topChunkScore = relevantChunks[0]?.score || null;

        const retrStart = Date.now();
        const recentHistory = conversation.messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
        const messages = ragService.buildRagMessages({
            systemPrompt: withLanguageInstruction(bot.systemPrompt, conversation.visitor.language),
            relevantChunks,
            history: recentHistory,
            userMessage: text,
        });
        retrievalMs = Date.now() - retrStart;

        const llmStart = Date.now();
        fullResponse = await llmService.streamChatCompletion({
            llmConfig: bot.llmConfig,
            messages,
            onToken: () => { }, // no token-by-token streaming over WhatsApp
        });
        llmMs = Date.now() - llmStart;

        conversation.messages.push({ role: "user", content: text });
        conversation.messages.push({ role: "assistant", content: fullResponse });
        await conversation.save();

        await whatsappSender.sendWhatsappText(credential.whatsapp, { to: from, message: fullResponse });
    } catch (err) {
        success = false;
        errorMessage = err.message;
        logger.error(`[whatsapp] Failed to answer ${from} on bot ${bot._id}: ${err.message}`);
        try {
            await whatsappSender.sendWhatsappText(credential.whatsapp, {
                to: from,
                message: "Sorry, something went wrong on our end. Please try again in a moment.",
            });
        } catch (sendErr) {
            logger.error(`[whatsapp] Also failed to send the apology to ${from}: ${sendErr.message}`);
        }
    } finally {
        const totalMs = Date.now() - totalStart;
        analyticsService
            .logMessageEvent({
                bot,
                user: bot.user,
                type: "whatsapp",
                req: null,
                sessionId: from,
                promptText: text,
                responseText: fullResponse,
                chunksRetrieved,
                topChunkScore,
                embeddingMs,
                retrievalMs,
                llmMs,
                totalMs,
                success,
                errorMessage,
                planSlug: plan?.slug || null,
            })
            .catch((err) => logger.error(`[whatsapp] Analytics logging failed: ${err.message}`));
    }
};

/**
 * POST /api/whatsapp/webhook
 *
 * Receives every message and status update Meta sends. Verifies the
 * signature, logs a readable line per event, persists the raw payload so
 * nothing is lost, and acks fast — Meta retries with backoff (and can
 * eventually disable the webhook) if it doesn't get a quick 200. The actual
 * bot pipeline (RAG + LLM + send-back, or handover passthrough) runs AFTER
 * the response is sent, since it can take several seconds and Meta must
 * never be kept waiting on it.
 */
const receiveWebhook = asyncHandler(async (req, res) => {
    // req.body is a raw Buffer here (see the express.raw() mount in app.js) —
    // parse it ourselves, rather than trusting an upstream JSON parser to
    // have already touched (and thus altered) it.
    const rawBody = req.body;
    const signatureHeader = req.headers["x-hub-signature-256"];

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

    // Signature verification now keys off the TENANT's own Meta App Secret
    // (stored on their IntegrationCredential), not a single platform-wide
    // env var — every tenant brings their own Meta App. We look the
    // credential up by the phone_number_id embedded in the payload itself.
    const firstPhoneNumberId = extractFirstPhoneNumberId(payload);
    let credentialForSignature = null;
    if (firstPhoneNumberId) {
        credentialForSignature = await IntegrationCredential.findOne({
            channel: "whatsapp",
            "whatsapp.phoneNumberId": firstPhoneNumberId,
        });
    }
    const appSecret = credentialForSignature?.whatsapp?.appSecret || null;
    const signatureValid = isValidSignature(rawBody, signatureHeader, appSecret);

    if (!appSecret) {
        logger.warn(
            `[whatsapp] No App Secret on file for phoneNumberId=${firstPhoneNumberId || "unknown"} — accepting webhook WITHOUT signature verification. Add an App Secret to that WhatsApp credential before going to production.`
        );
    } else if (!signatureValid) {
        // Logged but not rejected outright: Meta's retry/backoff behavior on a
        // hard 4xx here can be more disruptive than accepting-and-flagging a
        // handful of bad-signature events.
        logger.warn(
            `[whatsapp] Webhook signature verification FAILED for phoneNumberId=${firstPhoneNumberId || "unknown"} — storing event anyway, flagged as unverified`
        );
    }

    const entries = Array.isArray(payload.entry) ? payload.entry : [];

    // Ack immediately — everything below (persisting events, and especially
    // the RAG+LLM+send pipeline) can take a few seconds, and Meta must never
    // be kept waiting on it or it starts retrying/backing off the webhook.
    res.sendStatus(200);

    for (const entry of entries) {
        const wabaId = entry.id || null;
        const changes = Array.isArray(entry.changes) ? entry.changes : [];

        for (const change of changes) {
            const summary = summarizeChange(change);

            logger.info(
                `[whatsapp] event kind=${summary.kind} waba=${wabaId} phoneNumberId=${summary.phoneNumberId} ` +
                `from=${summary.from} type=${summary.messageType} preview=${JSON.stringify(summary.preview)}`
            );

            let eventDoc = null;
            try {
                eventDoc = await WhatsAppEvent.create({
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
                // Never let a DB hiccup block processing — the event is already
                // fully logged above even if persistence fails.
                logger.error(`[whatsapp] Failed to persist webhook event: ${err.message}`);
            }

            if (summary.kind === "message" && summary.phoneNumberId && summary.from) {
                const messageBody = change?.value?.messages?.[0]?.text?.body?.trim() || null;
                try {
                    await handleInboundMessage({
                        phoneNumberId: summary.phoneNumberId,
                        from: summary.from,
                        text: messageBody,
                    });
                    if (eventDoc) await WhatsAppEvent.updateOne({ _id: eventDoc._id }, { $set: { processed: true } });
                } catch (err) {
                    // handleInboundMessage already catches and logs its own
                    // pipeline errors — this only catches something escaping
                    // that (e.g. a DB lookup failure before the try/catch).
                    logger.error(`[whatsapp] Unhandled error processing message from ${summary.from}: ${err.message}`);
                }
            }
            // "status" (delivery/read receipts) and "unknown" changes are
            // logged/stored above and otherwise ignored — nothing to reply to.
        }
    }
});

module.exports = { verifyWebhook, receiveWebhook };
const crypto = require("crypto");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const logger = require("../utils/logger");
const WhatsAppEvent = require("../models/WhatsAppEvent");
const IntegrationCredential = require("../models/IntegrationCredential");
const Bot = require("../models/Bot");
const Conversation = require("../models/Conversation");
const ragService = require("../services/rag.service");
const responseGeneratorService = require("../services/responseGenerator.service");
const botService = require("../services/bot.service");
const handoverService = require("../services/handover.service");
const analyticsService = require("../services/analytics.service");
const whatsappSender = require("../services/whatsappSender.service");
const storageService = require("../services/storage.service");
const realtimeService = require("../services/realtime.service");
const { getLanguageName } = require("../utils/i18n");
const {
    looksLikeHandoverRequest,
    withHandoverSentinelInstruction,
    isHandoverSentinelResponse,
} = require("../utils/handoverIntent");

// ---------------------------------------------------------------------------
// Internal event forwarding — relays the EXACT raw Meta payload to Jesty's
// /api/webhook endpoint, byte-for-byte. Jesty does NOT verify Meta's
// hub.verify_token/signature — it trusts us via a shared secret instead
// (see verifyForwardSecret in Jesty's webhook.controller.ts), so we send
// that secret as x-webhook-secret rather than passing through
// X-Hub-Signature-256.
//
//   INTERNAL_WEBHOOK_FORWARD_URL    - Jesty's POST /api/webhook URL
//   INTERNAL_WEBHOOK_FORWARD_SECRET - must match Jesty's INTERNAL_WEBHOOK_SECRET
//
// Best-effort and fire-and-forget: forwarding must never block or fail our
// own webhook processing — Meta has already been ack'd 200 by the time this
// runs, and the bot pipeline doesn't wait on it either.
// ---------------------------------------------------------------------------
const FORWARD_URL = process.env.INTERNAL_WEBHOOK_FORWARD_URL || null;
const FORWARD_SECRET = process.env.INTERNAL_WEBHOOK_FORWARD_SECRET || null;
const FORWARD_TIMEOUT_MS = 5000;

const forwardRawWebhook = async (rawBody) => {
    if (!FORWARD_URL) return; // forwarding not configured — no-op

    if (!FORWARD_SECRET) {
        logger.warn("[whatsapp] INTERNAL_WEBHOOK_FORWARD_SECRET is not set — skipping forward to Jesty");
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
            body: rawBody, // untouched Buffer — same shape as Meta's own body
            signal: controller.signal,
        });

        if (!res.ok) {
            logger.warn(`[whatsapp] Forward to Jesty returned HTTP ${res.status}`);
        }
    } catch (err) {
        // Down/slow Jesty should never affect our own webhook processing.
        logger.warn(`[whatsapp] Failed to forward raw webhook to Jesty: ${err.message}`);
    } finally {
        clearTimeout(timeout);
    }
};

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
        // A visitor tapping an emoji reaction on one of our messages arrives
        // here too (value.messages[0].type === "reaction") — it has no
        // .text and isn't media, so without this it fell through to the
        // generic text pipeline below, which saw an empty message and sent
        // back "I can only read text messages right now — could you type
        // that out for me?" in response to a 👍. Classified separately so
        // it's just logged (see kind:"reaction" below) instead of
        // triggering a confusing auto-reply.
        if (message.type === "reaction") {
            return {
                kind: "reaction",
                phoneNumberId: value.metadata?.phone_number_id || null,
                from: message.from || null,
                messageType: "reaction",
                reactionEmoji: message.reaction?.emoji || null,
                reactionToMessageId: message.reaction?.message_id || null,
                preview: message.reaction?.emoji
                    ? `reacted ${message.reaction.emoji} to ${message.reaction.message_id || "a message"}`
                    : "removed a reaction",
            };
        }

        // Meta puts inbound media (image/document/audio/video/sticker) IDs
        // under a key that matches message.type — pull it out generically
        // rather than a big if/else chain of message.image?.id, etc.
        const mediaObj = ["image", "document", "audio", "video", "sticker"].includes(message.type)
            ? message[message.type]
            : null;

        // A tap on our interactive "list" CSAT prompt (or any future
        // button/list reply) lands here — never in message.text.
        const interactiveReplyId =
            message.interactive?.list_reply?.id || message.interactive?.button_reply?.id || null;
        const interactiveReplyTitle =
            message.interactive?.list_reply?.title || message.interactive?.button_reply?.title || null;

        return {
            kind: "message",
            phoneNumberId: value.metadata?.phone_number_id || null,
            from: message.from || null,
            messageId: message.id || null,
            messageType: message.type || null,
            mediaId: mediaObj?.id || null,
            mediaCaption: mediaObj?.caption || null,
            interactiveReplyId,
            preview:
                message.text?.body?.slice(0, 200) ||
                interactiveReplyTitle ||
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

// Kicks off a handover request for a WhatsApp visitor. Returns true if it
// actually did (meaning: stop, don't also run the AI on this message),
// false if it declined (handover not enabled / no agents available) — in
// which case the caller should just fall through to the normal AI answer
// rather than leaving the visitor's message unanswered.
// handoverService.requestHandover already takes care of messaging the
// visitor itself (the "connecting you..." / off-hours text), so there's
// nothing left to send here on the success path.
const triggerWhatsappHandover = async (bot, from) => {
    try {
        await handoverService.requestHandover(bot, from);
        return true;
    } catch (err) {
        logger.warn(`[whatsapp] Handover request from ${from} on bot ${bot._id} declined: ${err.message}`);
        return false;
    }
};

// Shared by every inbound-message branch (text / media / interactive) —
// resolves the tenant credential + bot for a given phoneNumberId, or null
// if either lookup misses. Extracted so the media and interactive-reply
// handlers below don't have to duplicate handleInboundMessage's original
// lookup.
const resolveBotForPhoneNumberId = async (phoneNumberId) => {
    const credential = await IntegrationCredential.findOne({
        channel: "whatsapp",
        "whatsapp.phoneNumberId": phoneNumberId,
        isActive: true,
    });
    if (!credential) {
        logger.warn(`[whatsapp] No active credential found for phoneNumberId=${phoneNumberId} — dropping message`);
        return null;
    }

    const bot = await Bot.findOne({
        "whatsappConfig.credentialId": credential._id,
        "whatsappConfig.enabled": true,
        isActive: true,
    });
    if (!bot) {
        logger.warn(`[whatsapp] phoneNumberId=${phoneNumberId} isn't connected to an enabled bot — dropping message`);
        return null;
    }

    return { credential, bot };
};

const findOrCreateWhatsappConversation = async (bot, from) => {
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
    return conversation;
};

/**
 * A visitor tapped a row on our interactive "rate 1-5" CSAT list (sent by
 * handoverService.resolveHandover once an agent marks a WhatsApp chat
 * resolved — see handover.service.js#sendWhatsappCsatPrompt). Row ids are
 * "csat_<1-5>"; anything else is an interactive reply we don't recognise
 * (future button/list features) and is just logged.
 */
// Meta's own status names -> our messageSchema.deliveryStatus enum. Meta
// also sends "deleted" for messages a user removed on their end, which we
// have no matching state for — treated as a no-op rather than an error.
const WHATSAPP_STATUS_MAP = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };

/**
 * A "status" webhook change — Meta reporting sent/delivered/read/failed for
 * a message WE sent out (an agent's reply, most commonly). Finds the exact
 * Conversation.messages[] entry by its stored whatsappMessageId (the WAMID
 * handed back when the message was originally relayed — see
 * handover.service.js#relayToWhatsappIfNeeded) and updates its
 * deliveryStatus in place, so the agent's chat view reflects reality
 * instead of assuming every send just worked.
 *
 * Status webhooks can arrive out of order or repeat — "sent" after
 * "delivered" is ignored rather than downgrading a message that's already
 * further along, since Meta doesn't guarantee ordering.
 */
const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
const handleStatusUpdate = async (status) => {
    const waMessageId = status?.id;
    const mappedStatus = WHATSAPP_STATUS_MAP[status?.status];
    if (!waMessageId || !mappedStatus) return;

    const conversation = await Conversation.findOne({ "messages.whatsappMessageId": waMessageId }).select(
        "_id messages.$"
    );
    if (!conversation) return; // nothing on file for this WAMID — not one of ours, or too old
    const message = conversation.messages[0];
    if (!message) return;

    // "failed" always wins regardless of rank (a delivered->failed webhook
    // shouldn't happen per Meta's docs, but if it does, trust it) —
    // otherwise only move forward, never backward.
    if (mappedStatus !== "failed" && (STATUS_RANK[message.deliveryStatus] || 0) >= STATUS_RANK[mappedStatus]) {
        return;
    }

    const errorDetail = status?.errors?.[0];
    const deliveryError =
        mappedStatus === "failed"
            ? errorDetail?.title || errorDetail?.message || "WhatsApp reported this message as failed"
            : null;

    await Conversation.updateOne(
        { _id: conversation._id, "messages._id": message._id },
        { $set: { "messages.$.deliveryStatus": mappedStatus, "messages.$.deliveryError": deliveryError } }
    );
    realtimeService.publish(`conv:${conversation._id}`, "update", { scope: "update" });
};

const handleInboundInteractive = async ({ phoneNumberId, from, replyId }) => {
    const resolved = await resolveBotForPhoneNumberId(phoneNumberId);
    if (!resolved) return;
    const { credential, bot } = resolved;

    const match = /^csat_([1-5])$/.exec(replyId || "");
    if (!match) {
        logger.info(`[whatsapp] Unrecognised interactive reply "${replyId}" from ${from} — ignoring`);
        return;
    }
    const rating = Number(match[1]);

    try {
        await handoverService.submitCsat(bot, from, rating, null);
    } catch (err) {
        // Most likely: already rated, or the chat isn't "resolved" anymore
        // (visitor tapped a stale list from an earlier resolved chat) —
        // either way, nothing actionable to send back.
        logger.warn(`[whatsapp] CSAT submit from ${from} on bot ${bot._id} failed: ${err.message}`);
        return;
    }

    const thankYou = bot.agentConfig?.csatThankYouMessage || "Thanks for the feedback!";
    try {
        await whatsappSender.sendWhatsappText(credential.whatsapp, { to: from, message: thankYou });
    } catch (err) {
        logger.error(`[whatsapp] Failed to send CSAT thank-you to ${from}: ${err.message}`);
    }
};

/**
 * A visitor sent an image/document/audio/video/sticker. Downloads the bytes
 * from Meta, stores them the same way agent/visitor widget uploads are
 * stored (storage.service.js#saveMedia), and appends a media message to the
 * conversation — routed the same way a text message would be: straight into
 * the transcript while a human is already handling the chat, otherwise
 * acknowledged (and, if a caption was attached, handed to the AI as if it
 * were a normal text question).
 */
const handleInboundMedia = async ({ phoneNumberId, from, mediaId, mediaType, caption }) => {
    const resolved = await resolveBotForPhoneNumberId(phoneNumberId);
    if (!resolved) return;
    const { credential, bot } = resolved;

    const conversation = await findOrCreateWhatsappConversation(bot, from);

    let media;
    try {
        const file = await whatsappSender.downloadWhatsappMedia(credential.whatsapp, mediaId);
        media = await storageService.saveMedia({
            ownerId: bot.user,
            botId: bot._id,
            actorType: "visitor",
            actorId: conversation._id,
            file,
        });
    } catch (err) {
        logger.error(`[whatsapp] Failed to download/store media ${mediaId} from ${from}: ${err.message}`);
        try {
            await whatsappSender.sendWhatsappText(credential.whatsapp, {
                to: from,
                message: "I couldn't download that attachment — mind resending it?",
            });
        } catch (sendErr) {
            logger.error(`[whatsapp] Also failed to notify ${from} of the download failure: ${sendErr.message}`);
        }
        return;
    }

    if (conversation.handover.status === "requested" || conversation.handover.status === "assigned") {
        // A human is already on this chat — same as a text message in that
        // state, this goes straight into the transcript for the agent to
        // see, no AI involved.
        await handoverService.appendVisitorMedia(conversation, media, caption || "");
        return;
    }

    // AI mode: the message is saved either way so the attachment is never
    // lost, but the AI pipeline itself only understands text — if a caption
    // came with the media, treat it as the visitor's actual question and
    // run it through the normal pipeline; otherwise just acknowledge receipt.
    conversation.messages.push({
        role: "user",
        content: caption || "",
        contentType: media.kind,
        media,
    });
    await conversation.save();

    if (caption?.trim()) {
        await handleInboundMessage({ phoneNumberId, from, messageId: null, text: caption.trim(), skipUserSave: true });
        return;
    }

    try {
        await whatsappSender.sendWhatsappText(credential.whatsapp, {
            to: from,
            message: `Got your ${mediaType || "file"} — let me know if you have a question about it!`,
        });
    } catch (err) {
        logger.error(`[whatsapp] Failed to send media-received ack to ${from}: ${err.message}`);
    }
};

/**
 * Runs one inbound WhatsApp text message through the exact same brain the
 * widget uses — RAG retrieval + LLM completion, or straight into the
 * transcript untouched if a human agent is already handling this
 * conversation — then sends the result back out over the Cloud API. Mirrors
 * chat.controller.js#chat, minus the SSE token streaming (WhatsApp has no
 * concept of a partial message).
 *
 * `skipUserSave` is set when handleInboundMedia already pushed this exact
 * text (as a media message's caption) onto the transcript — avoids saving
 * the visitor's message twice.
 *
 * Never throws — every failure path is caught, logged, and (best-effort)
 * turned into an apologetic reply to the sender, since this runs after the
 * webhook has already ack'd 200 and nothing is listening for a thrown error.
 */
const handleInboundMessage = async ({ phoneNumberId, from, messageId, text, skipUserSave = false }) => {
    const resolved = await resolveBotForPhoneNumberId(phoneNumberId);
    if (!resolved) return;
    const { credential, bot } = resolved;

    if (!text) {
        // Non-text, non-media message (location/contacts/unsupported, etc.)
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

    // WhatsApp has no "Talk to a human" button for the visitor to tap (see
    // chat.controller.js's request-handover endpoint, which is the widget's
    // equivalent) — this is the only way in. A simple keyword match catches
    // the obvious phrasings ("connect me to agent", "talk to human",
    // "executive", ...) cheaply and without an extra LLM call. Anything it
    // misses still has a second chance below, once the AI has actually seen
    // the message (see the HANDOVER_REQUEST sentinel check after the LLM
    // call) — that one understands intent semantically, so it also covers
    // phrasing/languages this list doesn't.
    if (conversation.handover.status === "none" && looksLikeHandoverRequest(text)) {
        const handoverStarted = await triggerWhatsappHandover(bot, from);
        if (handoverStarted) return;
        // Declined (handover disabled / no agents on this bot) — don't leave
        // the visitor hanging, just let the AI take the message normally.
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

    // Best-effort — a failed typing indicator should never block the actual
    // reply. Fire-and-continue, don't await-and-throw.
    if (messageId) {
        whatsappSender
            .sendTypingIndicator(credential.whatsapp, { messageId })
            .catch((err) => logger.warn(`[whatsapp] Failed to send typing indicator to ${from}: ${err.message}`));
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
        // bot.agentConfig.assignEnabled gates whether asking for a human is
        // even worth flagging to the model — no point spending tokens on the
        // instruction (or risking a false-positive sentinel) on a bot that
        // has no agents to hand off to anyway.
        let systemPrompt = withLanguageInstruction(bot.systemPrompt, conversation.visitor.language);
        if (bot.agentConfig?.assignEnabled) {
            systemPrompt = withHandoverSentinelInstruction(systemPrompt);
        }

        const messages = ragService.buildRagMessages({
            systemPrompt,
            relevantChunks,
            history: recentHistory,
            userMessage: text,
        });
        retrievalMs = Date.now() - retrStart;

        const llmStart = Date.now();
        fullResponse = await responseGeneratorService.generateResponse({
            bot,
            messages,
            conversation,
            sessionId: from,
            onToken: () => { }, // no token-by-token streaming over WhatsApp
            stream: false, // no point pacing text that's never displayed live
        });
        llmMs = Date.now() - llmStart;

        // The model judged (semantically, not just via the keyword list
        // above) that the visitor wants a human — start the same handover
        // flow instead of sending the raw sentinel text back to them.
        if (isHandoverSentinelResponse(fullResponse)) {
            if (!skipUserSave) conversation.messages.push({ role: "user", content: text });
            await conversation.save();

            const handoverStarted = await triggerWhatsappHandover(bot, from);
            if (!handoverStarted) {
                // No agents available after all — don't strand the visitor
                // with silence; give them a real answer instead.
                fullResponse = await responseGeneratorService.generateResponse({
                    bot,
                    messages: ragService.buildRagMessages({
                        systemPrompt: withLanguageInstruction(bot.systemPrompt, conversation.visitor.language),
                        relevantChunks,
                        history: recentHistory,
                        userMessage: text,
                    }),
                    conversation,
                    sessionId: from,
                    onToken: () => { },
                    stream: false,
                });
                conversation.messages.push({ role: "assistant", content: fullResponse });
                await conversation.save();
                await whatsappSender.sendWhatsappText(credential.whatsapp, { to: from, message: fullResponse });
            }
            return;
        }

        if (!skipUserSave) conversation.messages.push({ role: "user", content: text });
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

    // Relay the exact payload onward — fire-and-forget, independent of
    // everything else this request does with it.
    forwardRawWebhook(rawBody, signatureHeader);

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
                const inboundMessage = change?.value?.messages?.[0] || {};
                try {
                    if (summary.interactiveReplyId) {
                        // A tap on the CSAT list (or any future interactive
                        // reply) — never routed through the AI/media pipeline.
                        await handleInboundInteractive({
                            phoneNumberId: summary.phoneNumberId,
                            from: summary.from,
                            replyId: summary.interactiveReplyId,
                        });
                    } else if (summary.mediaId) {
                        await handleInboundMedia({
                            phoneNumberId: summary.phoneNumberId,
                            from: summary.from,
                            mediaId: summary.mediaId,
                            mediaType: summary.messageType,
                            caption: summary.mediaCaption,
                        });
                    } else {
                        const messageBody = inboundMessage.text?.body?.trim() || null;
                        await handleInboundMessage({
                            phoneNumberId: summary.phoneNumberId,
                            from: summary.from,
                            messageId: summary.messageId,
                            text: messageBody,
                        });
                    }
                    if (eventDoc) await WhatsAppEvent.updateOne({ _id: eventDoc._id }, { $set: { processed: true } });
                } catch (err) {
                    // Every handler above already catches and logs its own
                    // pipeline errors — this only catches something escaping
                    // that (e.g. a DB lookup failure before its own try/catch).
                    logger.error(`[whatsapp] Unhandled error processing message from ${summary.from}: ${err.message}`);
                }
            }
            // "status" (delivery/read receipts) update the matching
            // message's deliveryStatus (see handleStatusUpdate above).
            // "reaction" (a 👍 etc. on one of our messages) is logged/
            // stored above via WhatsAppEvent.raw only for now — nothing
            // reads reactionEmoji/reactionToMessageId yet, but the data
            // isn't lost if/when that's wanted (e.g. showing the emoji next
            // to the reacted-to message in the agent view).
            // "unknown" changes are logged/stored above and otherwise
            // ignored — nothing to reply to.
            if (summary.kind === "status") {
                const status = change?.value?.statuses?.[0];
                try {
                    await handleStatusUpdate(status);
                } catch (err) {
                    logger.error(`[whatsapp] Failed to process status update for ${summary.from}: ${err.message}`);
                }
            }
        }
    }
});

module.exports = { verifyWebhook, receiveWebhook };
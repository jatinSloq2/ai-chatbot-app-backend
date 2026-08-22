const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Conversation = require("../models/Conversation");
const ragService = require("../services/rag.service");
const responseGeneratorService = require("../services/responseGenerator.service");
const botService = require("../services/bot.service");
const handoverService = require("../services/handover.service");
const realtimeService = require("../services/realtime.service");
const storageService = require("../services/storage.service");
const { getLanguageName } = require("../utils/i18n");
const Bot = require("../models/Bot");
const { nanoid } = require("nanoid");
const analyticsService = require("../services/analytics.service");
const { setupSSE, sendEvent, startHeartbeat } = require("../utils/sse");

// Appends a "please reply in <language>" instruction to the bot's system
// prompt when the visitor isn't using the bot's default language. Left
// untouched for "en"/unset so existing bots behave exactly as before.
const withLanguageInstruction = (systemPrompt, languageCode) => {
  if (!languageCode || languageCode === "en") return systemPrompt;
  return `${systemPrompt}\n\nRespond in ${getLanguageName(languageCode)} (language code: ${languageCode}), regardless of what language the provided context is written in.`;
};

// Up to 5 quick-reply chips attached to the FIRST assistant reply in a
// conversation, mirroring the bot's configured FAQs — turns the existing
// "quick questions" feature into a proper structured rich-reply instead of
// being purely a widget-side rendering trick.
const buildQuickReplyRichContent = (bot, conversation) => {
  const faqs = (bot.widgetConfig?.faqs || []).slice(0, 5);
  if (!faqs.length) return null;
  const alreadyReplied = conversation.messages.some((m) => m.role === "assistant");
  if (alreadyReplied) return null;
  return { type: "quick_replies", buttons: faqs.map((q) => ({ label: q, value: q })) };
};

// POST /api/v1/chat  (auth: bot public key)
const chat = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const { message, language } = req.body;
  let { sessionId } = req.body;

  if (!message?.trim()) throw new ApiError(400, "message is required");

  if (!sessionId) sessionId = nanoid(24);

  let conversation = await Conversation.findOne({ bot: bot._id, sessionId });
  if (!conversation) {
    conversation = await Conversation.create({ bot: bot._id, sessionId, type: "widget", messages: [] });
  }

  // Visitor's language choice (multi-language support) — sticky on the
  // conversation once set, updatable any time the widget sends a new one
  // (e.g. the visitor switches languages mid-chat via the picker).
  if (language && language !== conversation.visitor.language) {
    conversation.visitor.language = language;
    await conversation.save();
  }

  setupSSE(req, res, { "X-Session-Id": sessionId });
  sendEvent(res, "session", { sessionId });

  // A human is (or is about to be) handling this conversation — route the
  // message straight into the transcript instead of calling the AI. No
  // quota usage here; the widget switches to polling for the agent's reply.
  if (conversation.handover.status === "requested" || conversation.handover.status === "assigned") {
    await handoverService.appendVisitorMessage(conversation, message);
    sendEvent(res, "handover", { status: conversation.handover.status });
    res.end();
    return;
  }

  // --- Plan limit check + atomic counter increment (AI path only) ---
  const plan = await botService.checkAndIncrementMessageUsage(bot);

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
    // 1. Embed query + retrieve chunks
    const embStart = Date.now();
    const relevantChunks = await ragService.retrieveRelevantChunks(
      bot._id,
      message,
      bot.embeddingConfig
    );
    embeddingMs = Date.now() - embStart;
    chunksRetrieved = relevantChunks.length;
    topChunkScore = relevantChunks[0]?.score || null;

    // 2. Build prompt with history
    const retrStart = Date.now();
    const recentHistory = conversation.messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const messages = ragService.buildRagMessages({
      systemPrompt: withLanguageInstruction(bot.systemPrompt, conversation.visitor.language),
      relevantChunks,
      history: recentHistory,
      userMessage: message,
    });
    retrievalMs = Date.now() - retrStart;

    // 3. Generate LLM response (tool-calling loop if configured, else plain stream)
    const llmStart = Date.now();
    fullResponse = await responseGeneratorService.generateResponse({
      bot,
      messages,
      conversation,
      sessionId,
      onToken: (token) => sendEvent(res, "token", { token }),
    });
    llmMs = Date.now() - llmStart;

    // 4. Save conversation
    conversation.messages.push({ role: "user", content: message });
    const richContent = buildQuickReplyRichContent(bot, conversation);
    conversation.messages.push({ role: "assistant", content: fullResponse, richContent });
    await conversation.save();

    sendEvent(res, "done", { fullResponse, richContent });
  } catch (err) {
    success = false;
    errorMessage = err.message;
    sendEvent(res, "error", { message: err.message || "Something went wrong" });
  } finally {
    res.end();

    const totalMs = Date.now() - totalStart;

    // Fire-and-forget analytics — never block the response
    Promise.all([
      analyticsService.logMessageEvent({
        bot,
        user: bot.user,
        type: "widget",
        req,
        sessionId,
        promptText: message,
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
      }),
      analyticsService.trackWidgetSession({ bot, req, sessionId }),
    ]).catch((err) => {
      require("../utils/logger").error(`Analytics logging failed: ${err.message}`);
    });
  }
});

// POST /api/bots/:id/test-chat  (auth: user JWT, owner only)
// Does NOT count against quota but IS tracked separately.
const testChat = asyncHandler(async (req, res) => {
  const bot = await Bot.findOne({ _id: req.params.id, user: req.user._id });
  if (!bot) throw new ApiError(404, "Bot not found");

  const { message } = req.body;
  let { sessionId } = req.body;
  if (!message?.trim()) throw new ApiError(400, "message is required");

  if (!sessionId) sessionId = nanoid(24);

  let conversation = await Conversation.findOne({ bot: bot._id, sessionId, type: "test" });
  if (!conversation) {
    conversation = await Conversation.create({ bot: bot._id, sessionId, type: "test", messages: [] });
  }

  setupSSE(req, res, { "X-Session-Id": sessionId });
  sendEvent(res, "session", { sessionId });

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
    const relevantChunks = await ragService.retrieveRelevantChunks(
      bot._id,
      message,
      bot.embeddingConfig
    );
    embeddingMs = Date.now() - embStart;
    chunksRetrieved = relevantChunks.length;
    topChunkScore = relevantChunks[0]?.score || null;

    sendEvent(res, "retrieved", {
      chunkCount: relevantChunks.length,
      chunks: relevantChunks.map((c) => ({
        content: c.content.slice(0, 200),
        score: c.score,
      })),
    });

    const retrStart = Date.now();
    const recentHistory = conversation.messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const messages = ragService.buildRagMessages({
      systemPrompt: bot.systemPrompt,
      relevantChunks,
      history: recentHistory,
      userMessage: message,
    });
    retrievalMs = Date.now() - retrStart;

    const llmStart = Date.now();
    fullResponse = await responseGeneratorService.generateResponse({
      bot,
      messages,
      conversation,
      sessionId,
      onToken: (token) => sendEvent(res, "token", { token }),
    });
    llmMs = Date.now() - llmStart;

    // Save conversation (test chats are stored just like widget chats)
    conversation.messages.push({ role: "user", content: message });
    conversation.messages.push({ role: "assistant", content: fullResponse });
    await conversation.save();

    sendEvent(res, "done", { fullResponse });
  } catch (err) {
    success = false;
    errorMessage = err.message;
    sendEvent(res, "error", { message: err.message || "Something went wrong" });
  } finally {
    res.end();

    const totalMs = Date.now() - totalStart;

    // Track test messages separately (no quota impact, no widget session)
    analyticsService.logMessageEvent({
      bot,
      user: req.user._id,
      type: "test",
      req,
      sessionId: null,
      promptText: message,
      responseText: fullResponse,
      chunksRetrieved,
      topChunkScore,
      embeddingMs,
      retrievalMs,
      llmMs,
      totalMs,
      success,
      errorMessage,
      planSlug: null,
    }).catch((err) => {
      require("../utils/logger").error(`Test analytics logging failed: ${err.message}`);
    });

    // Also increment the bot's test counter atomically
    Bot.findByIdAndUpdate(bot._id, { $inc: { testMessagesTotal: 1 } }).catch(() => { });
  }
});

// POST /api/v1/chat/request-handover  (auth: bot public key)
// body: { sessionId }
// Outside business hours this still returns 200 — it's a normal, expected
// outcome, not an error — but with offHours:true and a message the widget
// shows in place of "Connecting you with an agent...".
const requestHandover = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const { sessionId } = req.body;
  if (!sessionId) throw new ApiError(400, "sessionId is required");

  const result = await handoverService.requestHandover(bot, sessionId);

  if (result.offHours) {
    return res.status(200).json({
      success: true,
      message: result.message,
      data: { offHours: true, hoursDescription: result.hoursDescription },
    });
  }

  res.status(200).json({ success: true, message: "We're connecting you with an agent", data: { offHours: false } });
});

// GET /api/v1/chat/poll?sessionId=...&since=ISO_DATE  (auth: bot public key)
// One-shot fetch — used for the initial history rehydration on page load.
// Ongoing updates come from streamChat below, not repeated calls to this.
const pollChat = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const { sessionId, since } = req.query;
  if (!sessionId) throw new ApiError(400, "sessionId is required");

  const result = await handoverService.pollUpdates(bot, sessionId, since);
  res.status(200).json({ success: true, data: result });
});

// GET /api/v1/chat/stream?sessionId=...  (auth: bot public key, via ?key= since
// EventSource can't set custom headers)
// Realtime push for an active handover: fires an "update" event whenever the
// agent replies or the handover status changes. The widget reacts by doing
// ONE poll fetch (above) to pull the delta — this stream carries no message
// data itself, it's purely "something changed, go check."
const streamChat = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const { sessionId } = req.query;
  if (!sessionId) throw new ApiError(400, "sessionId is required");

  const conversation = await Conversation.findOne({ bot: bot._id, sessionId });
  if (!conversation) throw new ApiError(404, "Conversation not found");

  setupSSE(req, res);
  sendEvent(res, "connected", {});

  const channel = `conv:${conversation._id}`;
  realtimeService.subscribe(channel, res);
  const stopHeartbeat = startHeartbeat(res);

  req.on("close", () => {
    realtimeService.unsubscribe(channel, res);
    stopHeartbeat();
  });
});

// POST /api/v1/chat/media  (auth: bot public key, multipart "file")
// Visitor media upload. Only accepted once a real agent is connected
// (handover.status === "assigned") — before that there's no one on the
// other end to receive it, and it keeps the AI path free of binary uploads
// it has no way to reason about.
const uploadVisitorMedia = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const { sessionId, caption } = req.body;
  if (!sessionId) throw new ApiError(400, "sessionId is required");
  if (!req.file) throw new ApiError(400, "file is required");

  const conversation = await Conversation.findOne({ bot: bot._id, sessionId });
  if (!conversation) throw new ApiError(404, "Conversation not found");
  if (conversation.handover.status !== "assigned") {
    throw new ApiError(400, "Media can only be shared once an agent has joined the chat");
  }

  const media = await storageService.saveMedia({
    ownerId: bot.user,
    botId: bot._id,
    actorType: "visitor",
    actorId: sessionId,
    file: req.file,
  });

  const updated = await handoverService.appendVisitorMedia(conversation, media, caption);
  const saved = updated.messages[updated.messages.length - 1];

  res.status(201).json({ success: true, data: { message: saved } });
});

// POST /api/v1/chat/csat  (auth: bot public key)
// body: { sessionId, rating (1-5), comment? }
const submitCsat = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const { sessionId, rating, comment } = req.body;
  if (!sessionId) throw new ApiError(400, "sessionId is required");

  const conversation = await handoverService.submitCsat(bot, sessionId, Number(rating), comment);
  res.status(200).json({ success: true, data: { csat: conversation.handover.csat } });
});

module.exports = {
  chat,
  testChat,
  requestHandover,
  pollChat,
  streamChat,
  uploadVisitorMedia,
  submitCsat,
};
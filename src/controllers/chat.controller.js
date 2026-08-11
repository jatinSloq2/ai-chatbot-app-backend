const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Conversation = require("../models/Conversation");
const ragService = require("../services/rag.service");
const llmService = require("../services/llm.service");
const botService = require("../services/bot.service");
const Bot = require("../models/Bot");
const { nanoid } = require("nanoid");
const analyticsService = require("../services/analytics.service");

function setupSSE(req, res, extraHeaders = {}) {
  const origin = req.headers.origin || "*";
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.setHeader("Vary", "Origin");
  Object.entries(extraHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (res.flushHeaders) res.flushHeaders();
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// POST /api/v1/chat  (auth: bot public key)
const chat = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const { message } = req.body;
  let { sessionId } = req.body;

  if (!message?.trim()) throw new ApiError(400, "message is required");

  // --- Plan limit check + atomic counter increment ---
  const plan = await botService.checkAndIncrementMessageUsage(bot);

  if (!sessionId) sessionId = nanoid(24);

  let conversation = await Conversation.findOne({ bot: bot._id, sessionId });
  if (!conversation) {
    conversation = await Conversation.create({ bot: bot._id, sessionId, type: "widget", messages: [] });
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
      systemPrompt: bot.systemPrompt,
      relevantChunks,
      history: recentHistory,
      userMessage: message,
    });
    retrievalMs = Date.now() - retrStart;

    // 3. Stream LLM response
    const llmStart = Date.now();
    fullResponse = await llmService.streamChatCompletion({
      llmConfig: bot.llmConfig,
      messages,
      onToken: (token) => sendEvent(res, "token", { token }),
    });
    llmMs = Date.now() - llmStart;

    // 4. Save conversation
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
    fullResponse = await llmService.streamChatCompletion({
      llmConfig: bot.llmConfig,
      messages,
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
    Bot.findByIdAndUpdate(bot._id, { $inc: { testMessagesTotal: 1 } }).catch(() => {});
  }
});

module.exports = { chat, testChat };
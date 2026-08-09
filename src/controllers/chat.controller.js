const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Conversation = require("../models/Conversation");
const ragService = require("../services/rag.service");
const llmService = require("../services/llm.service");
const botService = require("../services/bot.service");
const Bot = require("../models/Bot");
const { nanoid } = require("nanoid");

// Shared SSE setup — sets all required headers including explicit CORS headers
// so the stream works from any third-party domain (the widget's host site).
function setupSSE(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering if proxied
  // Explicit CORS headers on SSE — fetch() with EventSource-style streaming
  // requires these on the actual response, not just the pre-flight.
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.setHeader("Vary", "Origin");
  if (res.flushHeaders) res.flushHeaders();
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// POST /api/v1/chat  (auth: bot public key via x-api-key header)
// body: { message, sessionId? }
// Streams the response via Server-Sent Events.
const chat = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const { message } = req.body;
  // sessionId comes from the widget's localStorage (persisted across page loads).
  // If null/missing, we generate a fresh one and send it back in the "session" event
  // so the widget can save it.
  let { sessionId } = req.body;

  if (!message?.trim()) throw new ApiError(400, "message is required");

  await botService.checkAndIncrementMessageUsage(bot);

  if (!sessionId) sessionId = nanoid(24);

  let conversation = await Conversation.findOne({ bot: bot._id, sessionId });
  if (!conversation) {
    conversation = await Conversation.create({ bot: bot._id, sessionId, messages: [] });
  }

  setupSSE(req, res);
  res.setHeader("X-Session-Id", sessionId);

  // Always send the session event FIRST so the widget captures and saves the sessionId
  sendEvent(res, "session", { sessionId });

  try {
    const relevantChunks = await ragService.retrieveRelevantChunks(
      bot._id,
      message,
      bot.embeddingConfig
    );

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

    const fullResponse = await llmService.streamChatCompletion({
      llmConfig: bot.llmConfig,
      messages,
      onToken: (token) => sendEvent(res, "token", { token }),
    });

    conversation.messages.push({ role: "user", content: message });
    conversation.messages.push({ role: "assistant", content: fullResponse });
    await conversation.save();

    sendEvent(res, "done", { fullResponse });
  } catch (err) {
    sendEvent(res, "error", { message: err.message || "Something went wrong" });
  } finally {
    res.end();
  }
});

// POST /api/bots/:id/test-chat  (auth: user JWT, owner only)
// Does NOT count against message quota — for dashboard testing only.
const testChat = asyncHandler(async (req, res) => {
  const bot = await Bot.findOne({ _id: req.params.id, user: req.user._id });
  if (!bot) throw new ApiError(404, "Bot not found");

  const { message } = req.body;
  if (!message?.trim()) throw new ApiError(400, "message is required");

  setupSSE(req, res);

  try {
    const relevantChunks = await ragService.retrieveRelevantChunks(
      bot._id,
      message,
      bot.embeddingConfig
    );

    sendEvent(res, "retrieved", {
      chunkCount: relevantChunks.length,
      chunks: relevantChunks.map((c) => ({
        content: c.content.slice(0, 200),
        score: c.score,
      })),
    });

    const messages = ragService.buildRagMessages({
      systemPrompt: bot.systemPrompt,
      relevantChunks,
      history: [],
      userMessage: message,
    });

    const fullResponse = await llmService.streamChatCompletion({
      llmConfig: bot.llmConfig,
      messages,
      onToken: (token) => sendEvent(res, "token", { token }),
    });

    sendEvent(res, "done", { fullResponse });
  } catch (err) {
    sendEvent(res, "error", { message: err.message || "Something went wrong" });
  } finally {
    res.end();
  }
});

module.exports = { chat, testChat };
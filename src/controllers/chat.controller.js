const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Conversation = require("../models/Conversation");
const ragService = require("../services/rag.service");
const llmService = require("../services/llm.service");
const botService = require("../services/bot.service");
const Bot = require("../models/Bot");
const { nanoid } = require("nanoid");

function setupSSE(req, res, extraHeaders = {}) {
  const origin = req.headers.origin || "*";
  // Set ALL headers before flushHeaders — nothing can be set after
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.setHeader("Vary", "Origin");

  // Any extra headers (like X-Session-Id) must come BEFORE flushHeaders
  Object.entries(extraHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (res.flushHeaders) res.flushHeaders();
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

const chat = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const { message } = req.body;
  let { sessionId } = req.body;

  if (!message?.trim()) throw new ApiError(400, "message is required");

  await botService.checkAndIncrementMessageUsage(bot);

  if (!sessionId) sessionId = nanoid(24);

  let conversation = await Conversation.findOne({ bot: bot._id, sessionId });
  if (!conversation) {
    conversation = await Conversation.create({ bot: bot._id, sessionId, messages: [] });
  }

  // Pass X-Session-Id as an extra header BEFORE flushHeaders is called
  setupSSE(req, res, { "X-Session-Id": sessionId });

  // Always send session event first so widget saves the sessionId
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
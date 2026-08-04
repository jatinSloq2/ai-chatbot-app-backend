const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Conversation = require("../models/Conversation");
const ragService = require("../services/rag.service");
const llmService = require("../services/llm.service");
const botService = require("../services/bot.service");
const Bot = require("../models/Bot");
const { nanoid } = require("nanoid");

// POST /api/v1/chat  (auth: bot public key)
// body: { message, sessionId? }
// Streams the response via Server-Sent Events.
const chat = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const { message } = req.body;
  let { sessionId } = req.body;

  if (!message?.trim()) throw new ApiError(400, "message is required");

  // Enforce the monthly message quota for this bot's plan
  await botService.checkAndIncrementMessageUsage(bot);

  if (!sessionId) sessionId = nanoid(24);

  let conversation = await Conversation.findOne({ bot: bot._id, sessionId });
  if (!conversation) {
    conversation = await Conversation.create({ bot: bot._id, sessionId, messages: [] });
  }

  // --- Set up SSE ---
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Session-Id", sessionId);
  res.flushHeaders?.();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent("session", { sessionId });

  try {
    // 1. Retrieve relevant chunks from the bot's knowledge base
    const relevantChunks = await ragService.retrieveRelevantChunks(
      bot._id,
      message,
      bot.embeddingConfig
    );

    // 2. Build the prompt with retrieved context + recent conversation history
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

    // 3. Stream the LLM response token-by-token to the client
    const fullResponse = await llmService.streamChatCompletion({
      llmConfig: bot.llmConfig,
      messages,
      onToken: (token) => sendEvent("token", { token }),
    });

    // 4. Persist the exchange
    conversation.messages.push({ role: "user", content: message });
    conversation.messages.push({ role: "assistant", content: fullResponse });
    await conversation.save();

    sendEvent("done", { fullResponse });
  } catch (err) {
    sendEvent("error", { message: err.message || "Something went wrong" });
  } finally {
    res.end();
  }
});

// POST /api/bots/:id/test-chat  (auth: user JWT, owner only)
// Same RAG pipeline as the public chat endpoint, but authenticated as the bot's
// OWNER via the dashboard, and does NOT count against the plan's monthly
// message quota — this is for testing the bot while building it, not for
// production traffic (that path is /api/v1/chat with the public key).
const testChat = asyncHandler(async (req, res) => {
  const bot = await Bot.findOne({ _id: req.params.id, user: req.user._id });
  if (!bot) throw new ApiError(404, "Bot not found");

  const { message } = req.body;
  if (!message?.trim()) throw new ApiError(400, "message is required");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const relevantChunks = await ragService.retrieveRelevantChunks(
      bot._id,
      message,
      bot.embeddingConfig
    );

    sendEvent("retrieved", {
      chunkCount: relevantChunks.length,
      chunks: relevantChunks.map((c) => ({ content: c.content.slice(0, 200), score: c.score })),
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
      onToken: (token) => sendEvent("token", { token }),
    });

    sendEvent("done", { fullResponse });
  } catch (err) {
    sendEvent("error", { message: err.message || "Something went wrong" });
  } finally {
    res.end();
  }
});

module.exports = { chat, testChat };

const llmService = require("./llm.service");
const toolOrchestratorService = require("./toolOrchestrator.service");
const logger = require("../utils/logger");

// Shown instead of ever sending a blank message to a visitor — both a
// tool-call turn with no content and a plain LLM turn can legitimately come
// back empty (a provider hiccup, a model that only emitted a "thought"),
// and silently forwarding "" is what used to crash the WhatsApp send with
// "message is required". Better to say SOMETHING than nothing.
const FALLBACK_TEXT = "I wasn't able to come up with a response there — could you try rephrasing that?";

const streamTextInChunks = async (text, onToken) => {
  const words = text.split(/(\s+)/);
  for (const chunk of words) {
    if (chunk) onToken(chunk);
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
};

// Runs the tool-calling agent loop when the bot is set up for it (real
// provider support + tools enabled + at least one tool exposed — see
// toolOrchestrator.service.js#canRunTools), falling back to the plain
// RAG/streaming path on any failure or when tools aren't applicable. This is
// the ONE place that decision gets made — every channel (widget SSE,
// WhatsApp) must route through here instead of each re-implementing its own
// copy, which is how WhatsApp silently never got tools in the first place.
//
// `stream` controls whether the tool-loop's finished answer gets paced out
// token-by-token via onToken (useful for the widget's SSE UX) or delivered
// as one immediate call (WhatsApp has no use for the pacing — onToken is a
// no-op there, and the 12ms/word delay would just add pointless latency).
const generateResponse = async ({ bot, messages, conversation, sessionId, onToken, stream = true }) => {
  if (toolOrchestratorService.canRunTools(bot)) {
    try {
      const text = await toolOrchestratorService.runAgentTurn({ bot, messages, conversation, sessionId });
      const safeText = text?.trim() ? text : FALLBACK_TEXT;
      if (stream) {
        await streamTextInChunks(safeText, onToken);
      } else {
        onToken(safeText);
      }
      return safeText;
    } catch (err) {
      logger.error(`[responseGenerator] Tool orchestrator failed for bot ${bot._id}, falling back to plain chat: ${err.message}`);
    }
  }

  const plain = await llmService.streamChatCompletion({ llmConfig: bot.llmConfig, messages, onToken });
  return plain?.trim() ? plain : FALLBACK_TEXT;
};

module.exports = { generateResponse };
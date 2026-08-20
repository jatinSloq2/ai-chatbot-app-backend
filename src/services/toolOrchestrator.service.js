const llmService = require("./llm.service");
const botToolsService = require("./botTools.service");
const toolDefinitions = require("./toolDefinitions");
const logger = require("../utils/logger");

// Whether this bot is set up to actually run the tool loop right now:
// tools enabled, at least one tool exposed, and a provider that supports
// function calling. Everything else (no sheet connected, wrong provider,
// tools off) silently falls back to the plain RAG/streaming path.
const canRunTools = (bot) => {
  if (!bot.toolsConfig?.enabled) return false;
  if (!llmService.TOOL_CAPABLE_PROVIDERS.includes(bot.llmConfig?.provider)) return false;
  const tools = toolDefinitions.getToolsForBot(bot);
  return tools.length > 0;
};

// Runs the tool-call loop and returns the final assistant text. Never
// throws for a "normal" failure (a tool erroring, the model refusing) —
// those get folded into the conversation as a tool result so the model can
// recover; it only throws for genuine request failures (bad API key, etc),
// which the caller should catch and fall back to the plain chat path for.
//
// `messages` should already include the system prompt (+ RAG context) and
// conversation history + the new user message, same shape as
// ragService.buildRagMessages produces.
const runAgentTurn = async ({ bot, messages, conversation, sessionId }) => {
  const tools = toolDefinitions.getToolsForBot(bot);
  const provider = bot.llmConfig.provider;
  const maxIterations = bot.toolsConfig?.maxToolIterations || 4;

  const toolNote =
    "\n\nYou have tools available for looking up/creating real orders, bookings, and support tickets. " +
    "Use them whenever the user's request needs real data or a real action — don't guess or make up order " +
    "IDs, stock levels, or availability. Ask the user for any missing required info before calling a tool " +
    "that needs it.";
  const working = messages.map((m, i) => (i === 0 && m.role === "system" ? { ...m, content: m.content + toolNote } : m));

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const result = await llmService.chatCompletionWithTools({ llmConfig: bot.llmConfig, messages: working, tools });

    if (!result.toolCalls?.length) {
      return result.content || "I wasn't able to come up with a response — could you rephrase that?";
    }

    const results = [];
    for (const call of result.toolCalls) {
      const toolResult = await botToolsService.executeTool(bot, call.name, call.arguments, { conversation, sessionId });
      results.push(toolResult);
    }

    working.push(...llmService.buildToolResultMessages(provider, result.rawAssistantMessage, result.toolCalls, results));
  }

  logger.error(`[toolOrchestrator] Bot ${bot._id} hit max tool iterations (${maxIterations}) without a final answer`);
  return "I looked into that but I'm having trouble pulling everything together — could you try again, or ask for a human?";
};

module.exports = { canRunTools, runAgentTurn };
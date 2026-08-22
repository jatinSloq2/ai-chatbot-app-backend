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
    "that needs it.\n\n" +
    "The Context section above comes from uploaded documents and can be OUT OF DATE — it's fine for general " +
    "policy/FAQ questions (shipping, returns, how something works), but never treat it as the source of truth " +
    "for anything a tool can check: current price, current stock, an order's status, or whether a slot is " +
    "available. If the context and a tool result ever disagree, the tool result is correct — say so and go " +
    "with it, don't average the two or repeat the doc's number.";
  const working = messages.map((m, i) => (i === 0 && m.role === "system" ? { ...m, content: m.content + toolNote } : m));

  // Every tool call+result executed so far this turn, in order. Kept
  // outside the loop so that if a LATER model call blows up (timeout,
  // network error, etc) we still have everything that was already done —
  // e.g. a support ticket that was genuinely created — instead of losing
  // it when the error propagates up and responseGenerator falls back to a
  // fresh, tool-history-free chat call. See the catch block below and
  // buildDirectAnswerFromToolResults.
  const completedCalls = [];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let result;
    try {
      result = await llmService.chatCompletionWithTools({ llmConfig: bot.llmConfig, messages: working, tools });
    } catch (err) {
      if (completedCalls.length) {
        logger.error(
          `[toolOrchestrator] Bot ${bot._id} follow-up model call failed after ${completedCalls.length} completed tool call(s), answering directly from tool results: ${err.message}`
        );
        return buildDirectAnswerFromToolResults(completedCalls);
      }
      throw err;
    }

    if (!result.toolCalls?.length) {
      return result.content || "I wasn't able to come up with a response — could you rephrase that?";
    }

    const results = [];
    for (const call of result.toolCalls) {
      const toolResult = await botToolsService.executeTool(bot, call.name, call.arguments, { conversation, sessionId });
      results.push(toolResult);
      completedCalls.push({ name: call.name, args: call.arguments, result: toolResult });
    }

    working.push(...llmService.buildToolResultMessages(provider, result.rawAssistantMessage, result.toolCalls, results));
  }

  logger.error(`[toolOrchestrator] Bot ${bot._id} hit max tool iterations (${maxIterations}) without a final answer`);

  // Don't just give up here — the model has usually gathered SOMETHING
  // useful across those iterations (found the item but not stock, found the
  // user but the order failed, etc). Forcing one last no-tools call makes it
  // turn that into an actual answer instead of a dead-end apology. Only
  // fall back to the canned line if even this comes back empty or errors.
  try {
    const wrapUpNote = {
      role: "user",
      content:
        "You've used up your tool calls for this turn. Don't call any more tools — answer the customer now, " +
        "using only what you already found above. If you genuinely couldn't find or complete what they asked, " +
        "say so plainly and offer to connect them with a human, rather than repeating an apology with no content.",
    };
    const finalText = await llmService.streamChatCompletion({
      llmConfig: bot.llmConfig,
      messages: [...working, wrapUpNote],
      onToken: () => { },
    });
    if (finalText?.trim()) return finalText;
  } catch (err) {
    logger.error(`[toolOrchestrator] Forced wrap-up call also failed for bot ${bot._id}: ${err.message}`);
  }

  return "I looked into that but I'm having trouble pulling everything together — could you try again, or ask for a human?";
};

// Fast, deterministic, no-LLM-call answer built directly from whatever
// tools already ran successfully this turn. Used only when the model call
// that would normally phrase the final answer itself fails (timeout,
// network error) AFTER real work was already done — the alternative is
// silently discarding a completed action (e.g. a support ticket that now
// exists in the sheet) and leaving the customer with neither the result
// nor an explanation. Deliberately templated rather than routed through
// another LLM call: at this point we've already had one slow/failing
// upstream call this turn, so answering directly is both faster and one
// less thing that can time out.
//
// Only the last completed call is used for the headline message — if
// several tools ran this turn, the most recent one is almost always the
// one the customer is waiting on (e.g. list_items → check_availability →
// create_support_ticket: the ticket is the news, not the earlier lookups).
const buildDirectAnswerFromToolResults = (completedCalls) => {
  const last = completedCalls[completedCalls.length - 1];
  const r = last.result || {};

  switch (last.name) {
    case "create_support_ticket":
      if (r.ok && r.ticket_id) {
        return r.duplicate
          ? `You already have an open ticket — ID ${r.ticket_id}. I've added this to it, and our team will follow up.`
          : `Done — I've opened a support ticket for you. Your ticket ID is ${r.ticket_id}. Our team will follow up on it.`;
      }
      break;
    case "escalate_to_human":
      if (r.ok) {
        return r.message || "Connecting you with a human agent now.";
      }
      break;
    case "create_order":
      if (r.ok && r.order_id) {
        return `Your order is confirmed — order ID ${r.order_id}.${r.total ? ` Total: ${r.total}.` : ""}`;
      }
      break;
    case "create_payment_link":
      if (r.ok && r.payment_link) {
        return `Here's your payment link: ${r.payment_link}`;
      }
      break;
    case "cancel_order":
      if (r.ok) {
        return `Your order${last.args?.order_id ? ` ${last.args.order_id}` : ""} has been cancelled.`;
      }
      break;
    case "initiate_refund":
      if (r.ok) {
        return "Your refund request has been logged and is being processed.";
      }
      break;
  }

  // Generic fallback: don't claim success/failure we can't confirm, just
  // tell the customer what happened and point them to a human rather than
  // guessing at phrasing for a tool result shape we don't specifically
  // template above.
  if (r.error || r.ok === false) {
    return "I ran into an issue completing that just now. Let me connect you with a human agent who can help directly.";
  }
  return "That's been taken care of. Let me know if there's anything else you need.";
};

module.exports = { canRunTools, runAgentTurn };
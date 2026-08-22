const axios = require("axios");
const ApiError = require("../utils/ApiError");
const { decrypt } = require("../utils/crypto");
const logger = require("../utils/logger");

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

// Per-attempt timeout for tool-calling completions. Deliberately shorter
// than the old 60s: a hung request used to block the whole turn for a full
// minute before the customer saw anything. 15s per attempt, up to 3
// attempts — worst case ~45s instead of a silent 60s dead wait, and most
// slow/flaky requests recover well within a couple of retries (observed
// Gemini tool calls in the wild: ~0.5s–17s).
const TOOL_CALL_TIMEOUT_MS = 15000;
const TOOL_CALL_MAX_ATTEMPTS = 3;

// Retries `fn` on timeout/network-level failures only (ECONNABORTED, no
// response at all) — never on a real API error response (bad key, 4xx,
// rate limit), since retrying those just wastes the retry budget on
// something that will fail identically every time.
const withRetry = async (fn, { attempts = TOOL_CALL_MAX_ATTEMPTS, label = "request" } = {}) => {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isTimeoutOrNetwork = !err.response && (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT" || !err.status);
      if (!isTimeoutOrNetwork || i === attempts - 1) throw err;
      logger.error(`[${label}] attempt ${i + 1}/${attempts} failed (${err.message}), retrying`);
    }
  }
  throw lastErr;
};

// Full raw request/response bodies (which include entire RAG context + full
// conversation history) are only logged in full outside production — in prod
// they're truncated to keep PII/log-storage exposure bounded while still
// giving enough signal (first/last chars, length) to spot obvious issues.
const IS_DEV = process.env.NODE_ENV !== "production";
const MAX_PROD_LOG_CHARS = 500;

const forLog = (value) => {
  if (value == null) return value;
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (IS_DEV || str.length <= MAX_PROD_LOG_CHARS) return str;
  return `${str.slice(0, MAX_PROD_LOG_CHARS)}… [truncated, ${str.length} chars total — set NODE_ENV=development for full body]`;
};

const logRequest = (provider, { url, model, body }) => {
  logger.info(`[${provider}] Request → ${url}`, {
    model,
    requestBody: forLog(body),
  });
};

const logResponse = (provider, { url, model, raw, finalText, durationMs }) => {
  logger.info(`[${provider}] Response ← ${url} (${durationMs}ms)`, {
    model,
    rawResponse: forLog(raw),
    finalText: forLog(finalText),
  });
};

const logFailure = (provider, { url, model, body, status, rawError, durationMs }) => {
  // Errors are always logged in full, even in production — you need the real
  // failure body to diagnose 400/404/503s, and error bodies are much smaller
  // than full success payloads (no RAG context echoed back).
  logger.error(`[${provider}] Request FAILED ← ${url} (${durationMs}ms)`, {
    model,
    status,
    requestBody: typeof body === "string" ? body : JSON.stringify(body),
    rawErrorBody: rawError,
  });
};

/**
 * Streams a chat completion token-by-token.
 * `onToken(text)` is called for every chunk of generated text.
 * Returns the full accumulated text at the end (useful for saving to history).
 *
 * messages: [{ role: "system"|"user"|"assistant", content: "..." }]
 */
const streamChatCompletion = async ({ llmConfig, messages, onToken }) => {
  const { provider, model, encryptedApiKey, temperature } = llmConfig;

  if (provider === "openai") {
    if (!encryptedApiKey) throw new ApiError(400, "No OpenAI API key set on this bot");
    return streamOpenAICompatible({
      providerLabel: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model,
      apiKey: decrypt(encryptedApiKey),
      messages,
      temperature,
      onToken,
    });
  }

  if (provider === "groq") {
    if (!encryptedApiKey) throw new ApiError(400, "No Groq API key set on this bot");
    return streamOpenAICompatible({
      providerLabel: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      model,
      apiKey: decrypt(encryptedApiKey),
      messages,
      temperature,
      onToken,
    });
  }

  if (provider === "mistral") {
    if (!encryptedApiKey) throw new ApiError(400, "No Mistral API key set on this bot");
    return streamOpenAICompatible({
      providerLabel: "Mistral",
      baseUrl: "https://api.mistral.ai/v1",
      model,
      apiKey: decrypt(encryptedApiKey),
      messages,
      temperature,
      onToken,
    });
  }

  if (provider === "anthropic") {
    if (!encryptedApiKey) throw new ApiError(400, "No Anthropic API key set on this bot");
    return streamAnthropic({ model, apiKey: decrypt(encryptedApiKey), messages, temperature, onToken });
  }

  if (provider === "google") {
    if (!encryptedApiKey) throw new ApiError(400, "No Google API key set on this bot");
    return streamGoogle({ model, apiKey: decrypt(encryptedApiKey), messages, temperature, onToken });
  }

  // Default: Ollama (free, self-hosted)
  return streamOllama({ model, messages, temperature, onToken });
};

// --- Ollama ---
const streamOllama = async ({ model, messages, temperature, onToken }) => {
  const url = `${OLLAMA_BASE_URL}/api/chat`;
  const requestBody = { model, messages, stream: true, options: { temperature: temperature ?? 0.7 } };
  const start = Date.now();
  let fullText = "";
  let rawChunks = [];

  logRequest("Ollama", { url, model, body: requestBody });

  try {
    const response = await axios.post(url, requestBody, { responseType: "stream" });

    await new Promise((resolve, reject) => {
      let buffer = "";
      response.data.on("data", (chunk) => {
        rawChunks.push(chunk);
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete last line for next chunk
        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = JSON.parse(line);
          const token = parsed.message?.content || "";
          if (token) {
            fullText += token;
            onToken(token);
          }
          if (parsed.done) resolve();
        }
      });
      response.data.on("end", resolve);
      response.data.on("error", reject);
    });

    logResponse("Ollama", {
      url,
      model,
      raw: Buffer.concat(rawChunks).toString("utf8"),
      finalText: fullText,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    const status = err.response?.status;
    logFailure("Ollama", {
      url,
      model,
      body: requestBody,
      status,
      rawError: err.response?.data ? JSON.stringify(err.response.data) : err.message,
      durationMs: Date.now() - start,
    });

    if (status === 404) {
      throw new ApiError(
        502,
        `Ollama returned 404 for /api/chat. ` +
        `Make sure the model "${model}" is pulled (run: ollama pull ${model}), ` +
        `and that your Ollama version supports /api/chat (v0.1.14+). ` +
        `Run \`ollama --version\` to check.`
      );
    }
    throw new ApiError(502, `Failed to reach Ollama at ${OLLAMA_BASE_URL}. Is it running? (${err.message})`);
  }
  return fullText;
};

// --- Anthropic ---
const streamAnthropic = async ({ model, apiKey, messages, temperature, onToken }) => {
  const url = "https://api.anthropic.com/v1/messages";
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const chatMessages = messages.filter((m) => m.role !== "system");
  const requestBody = { model, system: systemMsg, messages: chatMessages, max_tokens: 1024, temperature, stream: true };
  const start = Date.now();
  let fullText = "";
  let rawChunks = [];

  logRequest("Anthropic", { url, model, body: requestBody });

  try {
    const response = await axios.post(url, requestBody, {
      headers: {
        "x-api-key": apiKey, // never logged
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      responseType: "stream",
    });

    await new Promise((resolve, reject) => {
      let buffer = "";
      response.data.on("data", (chunk) => {
        rawChunks.push(chunk);
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete trailing line for next chunk — DO NOT reprocess consumed lines
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.replace("data:", "").trim();
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.type === "content_block_delta") {
              const token = parsed.delta?.text || "";
              if (token) {
                fullText += token;
                onToken(token);
              }
            }
            if (parsed.type === "message_stop") resolve();
          } catch {
            /* ignore partial JSON chunks */
          }
        }
      });
      response.data.on("end", resolve);
      response.data.on("error", reject);
    });

    logResponse("Anthropic", {
      url,
      model,
      raw: Buffer.concat(rawChunks).toString("utf8"),
      finalText: fullText,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    let rawErrorBody = null;
    let msg = err.message;

    if (err.response?.data?.on) {
      try {
        const chunks = [];
        for await (const chunk of err.response.data) chunks.push(chunk);
        rawErrorBody = Buffer.concat(chunks).toString("utf8");
        const parsed = JSON.parse(rawErrorBody);
        msg = parsed?.error?.message || rawErrorBody;
      } catch {
        /* body wasn't JSON or already drained */
      }
    } else {
      rawErrorBody = err.response?.data ? JSON.stringify(err.response.data) : null;
      msg = err.response?.data?.error?.message || err.message;
    }

    logFailure("Anthropic", {
      url,
      model,
      body: requestBody,
      status: err.response?.status,
      rawError: rawErrorBody,
      durationMs: Date.now() - start,
    });

    throw new ApiError(502, `Anthropic request failed: ${msg}`);
  }
  return fullText;
};

// --- Generic OpenAI-compatible streaming (used by OpenAI, Groq, Mistral —
// all three implement the same /chat/completions SSE format) ---
const streamOpenAICompatible = async ({ providerLabel, baseUrl, model, apiKey, messages, temperature, onToken }) => {
  const url = `${baseUrl}/chat/completions`;
  const requestBody = { model, messages, temperature, stream: true };
  const start = Date.now();
  let fullText = "";
  let rawChunks = [];

  logRequest(providerLabel, { url, model, body: requestBody });

  try {
    const response = await axios.post(url, requestBody, {
      headers: { Authorization: `Bearer ${apiKey}` }, // never logged
      responseType: "stream",
    });

    await new Promise((resolve, reject) => {
      let buffer = "";
      response.data.on("data", (chunk) => {
        rawChunks.push(chunk);
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete trailing line for next chunk — DO NOT reprocess consumed lines
        for (const line of lines) {
          if (!line.trim().startsWith("data:")) continue;
          const payload = line.replace("data:", "").trim();
          if (payload === "[DONE]") return resolve();
          try {
            const parsed = JSON.parse(payload);
            const token = parsed.choices?.[0]?.delta?.content || "";
            if (token) {
              fullText += token;
              onToken(token);
            }
          } catch {
            /* ignore partial JSON chunks */
          }
        }
      });
      response.data.on("end", resolve);
      response.data.on("error", reject);
    });

    logResponse(providerLabel, {
      url,
      model,
      raw: Buffer.concat(rawChunks).toString("utf8"),
      finalText: fullText,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    let rawErrorBody = null;
    let msg = err.message;

    if (err.response?.data?.on) {
      try {
        const chunks = [];
        for await (const chunk of err.response.data) chunks.push(chunk);
        rawErrorBody = Buffer.concat(chunks).toString("utf8");
        const parsed = JSON.parse(rawErrorBody);
        msg = parsed?.error?.message || rawErrorBody;
      } catch {
        /* body wasn't JSON or already drained */
      }
    } else {
      rawErrorBody = err.response?.data ? JSON.stringify(err.response.data) : null;
      msg = err.response?.data?.error?.message || err.message;
    }

    logFailure(providerLabel, {
      url,
      model,
      body: requestBody,
      status: err.response?.status,
      rawError: rawErrorBody,
      durationMs: Date.now() - start,
    });

    throw new ApiError(502, `Request to ${baseUrl} failed: ${msg}`);
  }
  return fullText;
};

// --- Google Gemini (different request/response shape from OpenAI-style APIs) ---
const streamGoogle = async ({ model, apiKey, messages, temperature, onToken }) => {
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const contents = messages.filter((m) => m.role !== "system").map(toGeminiContent);

  const requestBody = {
    contents,
    systemInstruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
    generationConfig: { temperature },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
  const start = Date.now();
  let fullText = "";
  let rawChunks = [];

  logRequest("Gemini", { url, model, body: requestBody });

  try {
    const response = await axios.post(url, requestBody, {
      headers: { "X-goog-api-key": apiKey }, // never logged
      responseType: "stream",
      timeout: 60000,
    });

    await new Promise((resolve, reject) => {
      let buffer = "";
      response.data.on("data", (chunk) => {
        rawChunks.push(chunk);
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete trailing line for next chunk — DO NOT reprocess consumed lines
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.replace("data:", "").trim();
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload);
            const parts = parsed.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (part.thought) continue;
              if (part.text) {
                fullText += part.text;
                onToken(part.text);
              }
            }
          } catch {
            /* ignore partial JSON chunks */
          }
        }
      });
      response.data.on("end", resolve);
      response.data.on("error", reject);
    });

    logResponse("Gemini", {
      url,
      model,
      raw: Buffer.concat(rawChunks).toString("utf8"),
      finalText: fullText,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    let rawErrorBody = null;
    let msg = err.message;

    if (err.response?.data?.on) {
      try {
        const chunks = [];
        for await (const chunk of err.response.data) chunks.push(chunk);
        rawErrorBody = Buffer.concat(chunks).toString("utf8");
        const parsed = JSON.parse(rawErrorBody);
        msg = parsed?.error?.message || rawErrorBody;
      } catch {
        /* body wasn't JSON or already drained */
      }
    } else {
      rawErrorBody = err.response?.data ? JSON.stringify(err.response.data) : null;
      msg = err.response?.data?.error?.message || err.message;
    }

    logFailure("Gemini", {
      url,
      model,
      body: requestBody,
      status: err.response?.status,
      rawError: rawErrorBody,
      durationMs: Date.now() - start,
    });

    throw new ApiError(502, `Google Gemini request failed: ${msg}`);
  }
  return fullText;
};

// ---------------------------------------------------------------------------
// Tool / function calling (non-streaming). Used by toolOrchestrator.service.js
// to run the decide → call tool → feed result back loop before the final
// answer is streamed to the visitor. Only these four providers implement
// function calling in a way we support here — Ollama and Google are left on
// the plain streaming path (see TOOL_CAPABLE_PROVIDERS).
// ---------------------------------------------------------------------------
const TOOL_CAPABLE_PROVIDERS = ["openai", "groq", "mistral", "anthropic", "google"];

const PROVIDER_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
};

const safeJsonParse = (str) => {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
};

// OpenAI/Groq/Mistral all speak the same /chat/completions "tools" shape.
const openAICompatibleToolCompletion = async ({ providerLabel, baseUrl, model, apiKey, messages, temperature, tools }) => {
  const url = `${baseUrl}/chat/completions`;
  const requestBody = {
    model,
    messages,
    temperature,
    tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
    tool_choice: "auto",
  };
  const start = Date.now();

  logRequest(providerLabel, { url, model, body: requestBody });

  try {
    const { data } = await withRetry(
      () => axios.post(url, requestBody, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: TOOL_CALL_TIMEOUT_MS,
      }),
      { label: providerLabel }
    );
    const message = data.choices?.[0]?.message || {};
    logResponse(providerLabel, { url, model, raw: data, finalText: message.content, durationMs: Date.now() - start });

    return {
      content: message.content || "",
      toolCalls: (message.tool_calls || []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeJsonParse(tc.function.arguments),
      })),
      rawAssistantMessage: message,
    };
  } catch (err) {
    const rawErrorBody = err.response?.data ? JSON.stringify(err.response.data) : null;
    const msg = err.response?.data?.error?.message || err.message;
    logFailure(providerLabel, { url, model, body: requestBody, status: err.response?.status, rawError: rawErrorBody, durationMs: Date.now() - start });
    throw new ApiError(502, `${providerLabel} tool-call request failed: ${msg}`);
  }
};

const anthropicToolCompletion = async ({ model, apiKey, messages, temperature, tools }) => {
  const url = "https://api.anthropic.com/v1/messages";
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const chatMessages = messages.filter((m) => m.role !== "system");
  const requestBody = {
    model,
    system: systemMsg,
    messages: chatMessages,
    max_tokens: 1024,
    temperature,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
  };
  const start = Date.now();

  logRequest("Anthropic", { url, model, body: requestBody });

  try {
    const { data } = await withRetry(
      () => axios.post(url, requestBody, {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        timeout: TOOL_CALL_TIMEOUT_MS,
      }),
      { label: "Anthropic" }
    );
    const blocks = data.content || [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
    logResponse("Anthropic", { url, model, raw: data, finalText: text, durationMs: Date.now() - start });

    return {
      content: text,
      toolCalls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, arguments: b.input })),
      rawAssistantMessage: { role: "assistant", content: blocks },
    };
  } catch (err) {
    const rawErrorBody = err.response?.data ? JSON.stringify(err.response.data) : null;
    const msg = err.response?.data?.error?.message || err.message;
    logFailure("Anthropic", { url, model, body: requestBody, status: err.response?.status, rawError: rawErrorBody, durationMs: Date.now() - start });
    throw new ApiError(502, `Anthropic tool-call request failed: ${msg}`);
  }
};

// Gemini's `contents` entries don't share the plain {role, content:"..."}
// shape the rest of this file uses — a turn that carries a function call or
// function result is its own native shape (see rawAssistantMessage /
// buildToolResultMessages below), so once a message already has `.parts` we
// pass it straight through; anything else (plain history/system-stripped
// user/assistant turns) gets converted the same way streamGoogle does it.
const toGeminiContent = (m) => {
  if (m.parts) return { role: m.role, parts: m.parts };
  return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
};

const googleToolCompletion = async ({ model, apiKey, messages, temperature, tools }) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const contents = messages.filter((m) => m.role !== "system").map(toGeminiContent);
  const requestBody = {
    contents,
    systemInstruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
    tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
    generationConfig: { temperature },
  };
  const start = Date.now();

  logRequest("Gemini", { url, model, body: requestBody });

  try {
    const { data } = await withRetry(
      () => axios.post(url, requestBody, {
        headers: { "X-goog-api-key": apiKey, "content-type": "application/json" },
        timeout: TOOL_CALL_TIMEOUT_MS,
      }),
      { label: "Gemini" }
    );
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
    const functionCallParts = parts.filter((p) => p.functionCall);
    logResponse("Gemini", { url, model, raw: data, finalText: text, durationMs: Date.now() - start });

    return {
      content: text,
      // Gemini attaches its own id to each functionCall when a turn makes
      // more than one parallel call, precisely so the matching
      // functionResponse can reference it unambiguously — reuse that when
      // present, and only synthesize a fallback for older model responses
      // that don't include one.
      toolCalls: functionCallParts.map((p, i) => ({
        id: p.functionCall.id || `gemini_call_${Date.now()}_${i}`,
        name: p.functionCall.name,
        arguments: p.functionCall.args || {},
      })),
      // Kept in Gemini's own {role:"model", parts:[...]} shape — see
      // toGeminiContent above, which passes it straight through next turn.
      rawAssistantMessage: { role: "model", parts: parts.filter((p) => !p.thought) },
    };
  } catch (err) {
    let rawErrorBody = null;
    let msg = err.message;
    if (err.response?.data) {
      rawErrorBody = JSON.stringify(err.response.data);
      msg = err.response.data?.error?.message || err.message;
    }
    logFailure("Gemini", { url, model, body: requestBody, status: err.response?.status, rawError: rawErrorBody, durationMs: Date.now() - start });
    throw new ApiError(502, `Google Gemini tool-call request failed: ${msg}`);
  }
};

// Returns { content, toolCalls: [{id, name, arguments}], rawAssistantMessage }
const chatCompletionWithTools = async ({ llmConfig, messages, tools }) => {
  const { provider, model, encryptedApiKey, temperature } = llmConfig;
  if (!TOOL_CAPABLE_PROVIDERS.includes(provider)) {
    throw new ApiError(400, `Tool calling isn't supported for provider "${provider}"`);
  }
  if (!encryptedApiKey) throw new ApiError(400, `No ${provider} API key set on this bot`);
  const apiKey = decrypt(encryptedApiKey);

  if (provider === "anthropic") {
    return anthropicToolCompletion({ model, apiKey, messages, temperature, tools });
  }
  if (provider === "google") {
    return googleToolCompletion({ model, apiKey, messages, temperature, tools });
  }
  return openAICompatibleToolCompletion({
    providerLabel: provider,
    baseUrl: PROVIDER_BASE_URLS[provider],
    model,
    apiKey,
    messages,
    temperature,
    tools,
  });
};

// Builds the messages to append to the running conversation after executing
// a round of tool calls, in whichever shape the provider expects. `results`
// is a same-length array matching `toolCalls`, one JSON-serializable result
// per call (from botTools.service.js#executeTool).
const buildToolResultMessages = (provider, rawAssistantMessage, toolCalls, results) => {
  if (provider === "anthropic") {
    return [
      rawAssistantMessage,
      {
        role: "user",
        content: toolCalls.map((tc, i) => ({
          type: "tool_result",
          tool_use_id: tc.id,
          content: JSON.stringify(results[i]),
        })),
      },
    ];
  }
  if (provider === "google") {
    return [
      rawAssistantMessage,
      {
        // NOTE: role "function" is rejected outright by this API — confirmed
        // live: "Role 'function' is not supported. Please use a valid role:
        // SYSTEM, SYSTEM_1, USER, ASSISTANT, DEVELOPER, CONTEXT,
        // USER_CONTEXT, MODEL, USER." functionResponse parts go in a "user"
        // turn instead; Gemini identifies them by the functionResponse part
        // type, not by a dedicated role.
        role: "user",
        parts: toolCalls.map((tc, i) => ({
          functionResponse: {
            id: tc.id,
            name: tc.name,
            // functionResponse.response must be an object/struct — wrap
            // non-object results (strings, numbers, arrays) instead of
            // sending them raw, which Gemini rejects.
            response: results[i] && typeof results[i] === "object" && !Array.isArray(results[i])
              ? results[i]
              : { result: results[i] },
          },
        })),
      },
    ];
  }
  // OpenAI-compatible (openai/groq/mistral)
  return [
    rawAssistantMessage,
    ...toolCalls.map((tc, i) => ({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(results[i]) })),
  ];
};

module.exports = {
  streamChatCompletion,
  chatCompletionWithTools,
  buildToolResultMessages,
  TOOL_CAPABLE_PROVIDERS,
};
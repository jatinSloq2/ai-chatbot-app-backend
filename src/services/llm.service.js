const axios = require("axios");
const ApiError = require("../utils/ApiError");
const { decrypt } = require("../utils/crypto");
const logger = require("../utils/logger");

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

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
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

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

module.exports = { streamChatCompletion };
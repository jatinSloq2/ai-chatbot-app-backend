const axios = require("axios");
const ApiError = require("../utils/ApiError");
const { decrypt } = require("../utils/crypto");

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

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
  let fullText = "";
  try {
    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/chat`,
      { model, messages, stream: true, options: { temperature } },
      { responseType: "stream" }
    );

    await new Promise((resolve, reject) => {
      let buffer = "";
      response.data.on("data", (chunk) => {
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
  } catch (err) {
    throw new ApiError(
      502,
      `Failed to reach Ollama server at ${OLLAMA_BASE_URL}. Is it running? (${err.message})`
    );
  }
  return fullText;
};

// --- OpenAI-compatible providers (OpenAI, Groq, Mistral) implemented below via streamOpenAICompatible ---

// --- Anthropic ---
const streamAnthropic = async ({ model, apiKey, messages, temperature, onToken }) => {
  let fullText = "";
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const chatMessages = messages.filter((m) => m.role !== "system");

  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model,
        system: systemMsg,
        messages: chatMessages,
        max_tokens: 1024,
        temperature,
        stream: true,
      },
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        responseType: "stream",
      }
    );

    await new Promise((resolve, reject) => {
      let buffer = "";
      response.data.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n").filter((l) => l.startsWith("data:"));
        for (const line of lines) {
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
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new ApiError(502, `Anthropic request failed: ${msg}`);
  }
  return fullText;
};

// --- Generic OpenAI-compatible streaming (used by OpenAI, Groq, Mistral —
// all three implement the same /chat/completions SSE format) ---
const streamOpenAICompatible = async ({ baseUrl, model, apiKey, messages, temperature, onToken }) => {
  let fullText = "";
  try {
    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      { model, messages, temperature, stream: true },
      { headers: { Authorization: `Bearer ${apiKey}` }, responseType: "stream" }
    );

    await new Promise((resolve, reject) => {
      let buffer = "";
      response.data.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n").filter((l) => l.trim().startsWith("data:"));
        for (const line of lines) {
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
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new ApiError(502, `Request to ${baseUrl} failed: ${msg}`);
  }
  return fullText;
};

// --- Google Gemini (different request/response shape from OpenAI-style APIs) ---
const streamGoogle = async ({ model, apiKey, messages, temperature, onToken }) => {
  let fullText = "";
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        contents,
        systemInstruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
        generationConfig: { temperature },
      },
      { responseType: "stream" }
    );

    await new Promise((resolve, reject) => {
      let buffer = "";
      response.data.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n").filter((l) => l.startsWith("data:"));
        for (const line of lines) {
          const payload = line.replace("data:", "").trim();
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload);
            const token = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
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
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new ApiError(502, `Google Gemini request failed: ${msg}`);
  }
  return fullText;
};

module.exports = { streamChatCompletion };

const axios = require("axios");
const ApiError = require("../utils/ApiError");
const { decrypt } = require("../utils/crypto");
const { getEmbeddingDimension } = require("../config/modelRegistry");

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

// Returns embedding vectors for an array of text strings, using whichever
// provider is configured on the bot. Ollama is the free default; OpenAI/Google
// are used if the user has supplied their own key (BYOK).
const embedTexts = async (texts, embeddingConfig) => {
  const { provider, model, encryptedApiKey } = embeddingConfig;

  if (provider === "openai") {
    if (!encryptedApiKey) {
      throw new ApiError(400, "OpenAI embedding selected but no API key is set on this bot");
    }
    return embedWithOpenAI(texts, model || "text-embedding-3-small", decrypt(encryptedApiKey));
  }

  if (provider === "google") {
    if (!encryptedApiKey) {
      throw new ApiError(400, "Google embedding selected but no API key is set on this bot");
    }
    return embedWithGoogle(texts, model || "text-embedding-004", decrypt(encryptedApiKey));
  }

  // Default: Ollama (free, self-hosted)
  return embedWithOllama(texts, model || "nomic-embed-text");
};

const embedWithOllama = async (texts, model) => {
  const results = [];
  for (const text of texts) {
    try {
      const { data } = await axios.post(`${OLLAMA_BASE_URL}/api/embed`, { model, input: text });
      const vector = data.embeddings ? data.embeddings[0] : data.embedding;
      results.push(vector);
    } catch (err) {
      throw new ApiError(
        502,
        `Failed to generate embedding via Ollama. Is the Ollama server running and reachable at ${OLLAMA_BASE_URL}? (${err.message})`
      );
    }
  }
  return results;
};

const embedWithOpenAI = async (texts, model, apiKey) => {
  try {
    const { data } = await axios.post(
      "https://api.openai.com/v1/embeddings",
      { model, input: texts },
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    return data.data.map((d) => d.embedding);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new ApiError(502, `OpenAI embedding request failed: ${msg}`);
  }
};

const embedWithGoogle = async (texts, model, apiKey) => {
  const results = [];
  for (const text of texts) {
    try {
      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`,
        { content: { parts: [{ text }] } }
      );
      results.push(data.embedding.values);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      throw new ApiError(502, `Google embedding request failed: ${msg}`);
    }
  }
  return results;
};

// Returns the expected vector dimension for a given provider/model, used to
// detect a mismatch before it silently corrupts retrieval (see bot.service.js
// setBotApiKey / embeddingConfig.lockedDimension).
const getExpectedDimension = (provider, model) => getEmbeddingDimension(provider, model);

module.exports = { embedTexts, getExpectedDimension };

// Central source of truth for which providers/models the platform supports.
// Adding a new provider means: add it here, add a branch in llm.service.js or
// embedding.service.js, done — everything else (validation, the /models
// endpoint the frontend uses to build dropdowns) reads from this file.

const LLM_PROVIDERS = {
  ollama: {
    label: "Ollama (free, self-hosted)",
    requiresApiKey: false,
    models: ["llama3.1", "llama3.1:70b", "qwen2.5", "mistral", "phi3", "gemma2"],
  },
  openai: {
    label: "OpenAI",
    requiresApiKey: true,
    models: ["gpt-5.6", "gpt-5.6-mini", "gpt-5.4-nano", "gpt-4o-mini"],
  },
  anthropic: {
    label: "Anthropic",
    requiresApiKey: true,
    models: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
  },
  google: {
    label: "Google Gemini",
    requiresApiKey: true,
    models: ["gemini-flash-latest", "gemini-3.5-flash", "gemini-3.5-flash-lite"],
  },
  groq: {
    label: "Groq (fast inference)",
    requiresApiKey: true,
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"],
  },
  mistral: {
    label: "Mistral AI",
    requiresApiKey: true,
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
  },
};

const EMBEDDING_PROVIDERS = {
  ollama: {
    label: "Ollama (free, self-hosted)",
    requiresApiKey: false,
    models: {
      "nomic-embed-text": 768,
      "mxbai-embed-large": 1024,
      "all-minilm": 384,
    },
  },
  openai: {
    label: "OpenAI",
    requiresApiKey: true,
    models: {
      "text-embedding-3-small": 1536,
      "text-embedding-3-large": 3072,
      "text-embedding-ada-002": 1536, // legacy but still served; keep only if you want backward compat for old bots
    },
  },
  google: {
    label: "Google Gemini",
    requiresApiKey: true,
    models: {
      "gemini-embedding-001": 3072,
    },
  },
};

const isValidLlmChoice = (provider, model) =>
  !!LLM_PROVIDERS[provider] && LLM_PROVIDERS[provider].models.includes(model);

const isValidEmbeddingChoice = (provider, model) =>
  !!EMBEDDING_PROVIDERS[provider] && !!EMBEDDING_PROVIDERS[provider].models[model];

const getEmbeddingDimension = (provider, model) =>
  EMBEDDING_PROVIDERS[provider]?.models?.[model] ?? null;

const requiresApiKey = (kind, provider) =>
  kind === "llm" ? LLM_PROVIDERS[provider]?.requiresApiKey : EMBEDDING_PROVIDERS[provider]?.requiresApiKey;

module.exports = {
  LLM_PROVIDERS,
  EMBEDDING_PROVIDERS,
  isValidLlmChoice,
  isValidEmbeddingChoice,
  getEmbeddingDimension,
  requiresApiKey,
};

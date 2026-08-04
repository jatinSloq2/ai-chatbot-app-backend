const Document = require("../models/Document");
const Chunk = require("../models/Chunk");
const Bot = require("../models/Bot");
const { splitTextIntoChunks, sanitizeText } = require("../utils/textSplitter");
const { cosineSimilarity } = require("../utils/vectorMath");
const { embedTexts } = require("./embedding.service");
const { enqueueIngestion } = require("../jobs/ingestionQueue");

const TOP_K = 5;
const MIN_SIMILARITY = 0.3; // discard chunks that aren't meaningfully relevant

// --- Ingest a new document: chunk it, embed each chunk, store it ---
const ingestDocument = async ({ botId, title, sourceType, sourceRef, rawText }) => {
  const document = await Document.create({
    bot: botId,
    title,
    sourceType,
    sourceRef,
    rawText,
    status: "processing",
  });

  // Runs via BullMQ+Redis if REDIS_URL is configured, otherwise falls back to
  // in-process async execution — either way the API responds immediately.
  await enqueueIngestion(document._id.toString(), processDocument).catch(async (err) => {
    await Document.findByIdAndUpdate(document._id, {
      status: "failed",
      errorMessage: err.message,
    });
  });

  return document;
};

const processDocument = async (documentId) => {
  const document = await Document.findById(documentId);
  const bot = await Bot.findById(document.bot);

  const chunks = splitTextIntoChunks(sanitizeText(document.rawText), { chunkSize: 1500, overlap: 200 });
  if (chunks.length === 0) {
    await Document.findByIdAndUpdate(documentId, {
      status: "failed",
      errorMessage: "No extractable text content",
    });
    return;
  }

  // Embed in batches to avoid overwhelming Ollama/OpenAI with huge single requests
  const BATCH_SIZE = 20;
  const chunkDocs = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const vectors = await embedTexts(batch, bot.embeddingConfig);

    batch.forEach((content, idx) => {
      chunkDocs.push({
        bot: bot._id,
        document: document._id,
        content,
        order: i + idx,
        embedding: vectors[idx],
        embeddingDim: vectors[idx].length,
      });
    });
  }

  await Chunk.insertMany(chunkDocs);
  await Document.findByIdAndUpdate(documentId, {
    status: "ready",
    chunkCount: chunkDocs.length,
  });
  await Bot.findByIdAndUpdate(bot._id, { $inc: { documentCount: 1 } });

  // Lock in the vector dimension this bot's data is now stored under, the
  // first time any chunk is stored for it. This is what lets bot.service.js
  // detect and block a provider switch that would break existing retrieval.
  const dim = chunkDocs[0]?.embeddingDim;
  if (dim && !bot.embeddingConfig.lockedDimension) {
    await Bot.findByIdAndUpdate(bot._id, { "embeddingConfig.lockedDimension": dim });
  }
};

// Re-embeds every document belonging to a bot under its CURRENT embeddingConfig.
// Used after a confirmed provider/model switch (see bot.service.js
// setBotApiKey / confirmReembed) so old data stays retrievable instead of
// being silently orphaned with mismatched vector dimensions.
const reembedAllDocuments = async (botId) => {
  const documents = await Document.find({ bot: botId });
  for (const doc of documents) {
    await Chunk.deleteMany({ document: doc._id });
    await Document.findByIdAndUpdate(doc._id, { status: "processing", chunkCount: 0 });

    const bot = await Bot.findById(botId);
    const chunks = splitTextIntoChunks(sanitizeText(doc.rawText), { chunkSize: 1500, overlap: 200 });
    if (chunks.length === 0) {
      await Document.findByIdAndUpdate(doc._id, { status: "failed", errorMessage: "No extractable text content" });
      continue;
    }

    const BATCH_SIZE = 20;
    const chunkDocs = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const vectors = await embedTexts(batch, bot.embeddingConfig);
      batch.forEach((content, idx) => {
        chunkDocs.push({
          bot: bot._id,
          document: doc._id,
          content,
          order: i + idx,
          embedding: vectors[idx],
          embeddingDim: vectors[idx].length,
        });
      });
    }

    await Chunk.insertMany(chunkDocs);
    await Document.findByIdAndUpdate(doc._id, { status: "ready", chunkCount: chunkDocs.length });
  }
};

// --- Retrieve the most relevant chunks for a query ---
const retrieveRelevantChunks = async (botId, query, embeddingConfig) => {
  const [queryVector] = await embedTexts([query], embeddingConfig);

  // Brute-force similarity search across this bot's chunks.
  // select("+embedding") because the schema excludes it by default.
  const allChunks = await Chunk.find({ bot: botId }).select("+embedding content").lean();

  const scored = allChunks
    .map((chunk) => ({
      content: chunk.content,
      score: cosineSimilarity(queryVector, chunk.embedding),
    }))
    .filter((c) => c.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  return scored;
};

// --- Build the final prompt messages array for the LLM ---
const buildRagMessages = ({ systemPrompt, relevantChunks, history, userMessage }) => {
  const context = relevantChunks.length
    ? relevantChunks.map((c, i) => `[${i + 1}] ${c.content}`).join("\n\n")
    : "No relevant context was found in the knowledge base.";

  const systemMessage = `${systemPrompt}\n\nContext:\n${context}`;

  return [
    { role: "system", content: systemMessage },
    ...history, // [{role: "user"|"assistant", content: "..."}]
    { role: "user", content: userMessage },
  ];
};

// --- Delete all chunks belonging to a document (used when a doc is removed) ---
const deleteDocumentChunks = async (documentId) => {
  await Chunk.deleteMany({ document: documentId });
};

module.exports = {
  ingestDocument,
  processDocument,
  reembedAllDocuments,
  retrieveRelevantChunks,
  buildRagMessages,
  deleteDocumentChunks,
};

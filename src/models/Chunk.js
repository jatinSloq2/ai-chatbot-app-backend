const mongoose = require("mongoose");

const chunkSchema = new mongoose.Schema(
  {
    bot: { type: mongoose.Schema.Types.ObjectId, ref: "Bot", required: true, index: true },
    document: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, index: true },

    content: { type: String, required: true },
    order: { type: Number, default: 0 }, // position within the source document

    embedding: { type: [Number], required: true, select: false }, // large field, exclude by default
    embeddingDim: { type: Number, required: true },
  },
  { timestamps: true }
);

// NOTE: This does brute-force cosine similarity in application code (fine up to
// tens of thousands of chunks per bot). For larger scale, swap this collection's
// retrieval logic for MongoDB Atlas Vector Search, Pinecone, or Qdrant — the
// rest of the RAG pipeline (chunking, embedding, prompt building) stays the same.

module.exports = mongoose.model("Chunk", chunkSchema);

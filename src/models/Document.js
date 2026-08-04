const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    bot: { type: mongoose.Schema.Types.ObjectId, ref: "Bot", required: true, index: true },

    title: { type: String, required: true, trim: true },
    sourceType: { type: String, enum: ["text", "url", "file"], required: true },
    sourceRef: { type: String, default: null }, // original URL or filename, if applicable

    rawText: { type: String, required: true }, // full extracted text before chunking

    status: {
      type: String,
      enum: ["processing", "ready", "failed"],
      default: "processing",
    },
    errorMessage: { type: String, default: null },

    chunkCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

documentSchema.index({ bot: 1, createdAt: -1 });

module.exports = mongoose.model("Document", documentSchema);

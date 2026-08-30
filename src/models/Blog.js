const mongoose = require("mongoose");

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    content: { type: String, required: true },
    excerpt: { type: String },
    coverImage: { type: String },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    tags: [String],
    published: { type: Boolean, default: false },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Blog", blogSchema);

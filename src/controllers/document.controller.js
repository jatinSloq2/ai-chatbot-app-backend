const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Document = require("../models/Document");
const Bot = require("../models/Bot");
const botService = require("../services/bot.service");
const ragService = require("../services/rag.service");
const urlLoaderService = require("../services/urlLoader.service");
const fileLoaderService = require("../services/fileLoader.service");

const sanitizeDoc = (doc) => ({
  id: doc._id,
  title: doc.title,
  sourceType: doc.sourceType,
  sourceRef: doc.sourceRef,
  status: doc.status,
  errorMessage: doc.errorMessage,
  chunkCount: doc.chunkCount,
  createdAt: doc.createdAt,
});

const checkDocumentLimit = async (bot) => {
  const plan = await botService.getActivePlan(bot.user);
  if (bot.documentCount >= plan.limits.maxDocumentsPerBot) {
    throw new ApiError(
      403,
      `This bot's plan allows a maximum of ${plan.limits.maxDocumentsPerBot} documents. Upgrade to add more.`
    );
  }
};

// POST /api/v1/documents  (auth: bot secret key)
// body: { title, sourceType: "text"|"url", text?, url? }
const addDocument = asyncHandler(async (req, res) => {
  const bot = req.bot;
  await checkDocumentLimit(bot);

  const { title, sourceType, text, url } = req.body;
  if (!sourceType) throw new ApiError(400, "sourceType is required ('text' or 'url')");

  let finalTitle = title;
  let rawText;
  let sourceRef = null;

  if (sourceType === "text") {
    if (!text) throw new ApiError(400, "text is required for sourceType 'text'");
    rawText = text;
    finalTitle = title || "Untitled document";
  } else if (sourceType === "url") {
    if (!url) throw new ApiError(400, "url is required for sourceType 'url'");
    const extracted = await urlLoaderService.extractTextFromUrl(url);
    rawText = extracted.text;
    finalTitle = title || extracted.title;
    sourceRef = url;
  } else {
    throw new ApiError(400, "sourceType must be 'text' or 'url' (use file upload endpoint for files)");
  }

  const document = await ragService.ingestDocument({
    botId: bot._id,
    title: finalTitle,
    sourceType,
    sourceRef,
    rawText,
  });

  res.status(201).json({
    success: true,
    message: "Document received and is being processed (chunking + embedding in progress)",
    data: { document: sanitizeDoc(document) },
  });
});

// POST /api/v1/documents/upload  (auth: bot secret key, multipart/form-data, field name "file")
const uploadDocument = asyncHandler(async (req, res) => {
  const bot = req.bot;
  await checkDocumentLimit(bot);

  if (!req.file) throw new ApiError(400, "No file uploaded. Use field name 'file'");

  const rawText = await fileLoaderService.extractTextFromFile(req.file);
  if (!rawText || rawText.trim().length < 10) {
    throw new ApiError(400, "Could not extract meaningful text from this file");
  }

  const title = req.body.title || req.file.originalname;

  const document = await ragService.ingestDocument({
    botId: bot._id,
    title,
    sourceType: "file",
    sourceRef: req.file.originalname,
    rawText,
  });

  res.status(201).json({
    success: true,
    message: "File received and is being processed (chunking + embedding in progress)",
    data: { document: sanitizeDoc(document) },
  });
});

// GET /api/v1/documents  (auth: bot secret key)
const listDocuments = asyncHandler(async (req, res) => {
  const documents = await Document.find({ bot: req.bot._id })
    .select("-rawText")
    .sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: { documents: documents.map(sanitizeDoc) } });
});

// GET /api/v1/documents/:id  (auth: bot secret key)
const getDocument = asyncHandler(async (req, res) => {
  const document = await Document.findOne({ _id: req.params.id, bot: req.bot._id });
  if (!document) throw new ApiError(404, "Document not found");
  res.status(200).json({
    success: true,
    data: { document: { ...sanitizeDoc(document), rawText: document.rawText } },
  });
});

// PUT /api/v1/documents/:id  (auth: bot secret key) - replaces content & re-embeds
const updateDocument = asyncHandler(async (req, res) => {
  const { title, text } = req.body;
  const document = await Document.findOne({ _id: req.params.id, bot: req.bot._id });
  if (!document) throw new ApiError(404, "Document not found");

  if (title !== undefined) document.title = title;

  if (text !== undefined) {
    // Re-ingesting means dropping old chunks and creating fresh ones
    await ragService.deleteDocumentChunks(document._id);
    document.rawText = text;
    document.status = "processing";
    document.chunkCount = 0;
    await document.save();

    ragService
      .ingestDocument({
        botId: req.bot._id,
        title: document.title,
        sourceType: document.sourceType,
        sourceRef: document.sourceRef,
        rawText: text,
      })
      .then(async (newDoc) => {
        // Merge the freshly processed chunks into the existing document record,
        // then discard the duplicate document created by ingestDocument
        const Chunk = require("../models/Chunk");
        await Chunk.updateMany({ document: newDoc._id }, { document: document._id });
        await Document.findByIdAndUpdate(document._id, {
          status: newDoc.status,
          chunkCount: newDoc.chunkCount,
        });
        await Document.findByIdAndDelete(newDoc._id);
      })
      .catch(async (err) => {
        await Document.findByIdAndUpdate(document._id, {
          status: "failed",
          errorMessage: err.message,
        });
      });
  } else {
    await document.save();
  }

  res.status(200).json({
    success: true,
    message: "Document update accepted",
    data: { document: sanitizeDoc(document) },
  });
});

// DELETE /api/v1/documents/:id  (auth: bot secret key)
const deleteDocument = asyncHandler(async (req, res) => {
  const document = await Document.findOne({ _id: req.params.id, bot: req.bot._id });
  if (!document) throw new ApiError(404, "Document not found");

  await ragService.deleteDocumentChunks(document._id);
  await document.deleteOne();
  await Bot.findByIdAndUpdate(req.bot._id, { $inc: { documentCount: -1 } });

  res.status(200).json({ success: true, message: "Document deleted" });
});

module.exports = {
  addDocument,
  uploadDocument,
  listDocuments,
  getDocument,
  updateDocument,
  deleteDocument,
};

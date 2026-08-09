const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const documentController = require("../controllers/document.controller");
const chatController = require("../controllers/chat.controller");
const widgetController = require("../controllers/widget.controller");
const { requireBotSecretKey, requireBotPublicKey } = require("../middlewares/botAuth.middleware");
const { upload } = require("../middlewares/upload.middleware");

// Open CORS for widget-facing endpoints — these are called from any third-party site
const widgetCors = cors({
  origin: "*",
  credentials: false,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key", "Authorization"],
});

// --- Data management API (secret key, server-to-server — no CORS needed) ---
router.post("/documents", requireBotSecretKey, documentController.addDocument);
router.post("/documents/upload", requireBotSecretKey, upload.single("file"), documentController.uploadDocument);
router.get("/documents", requireBotSecretKey, documentController.listDocuments);
router.get("/documents/:id", requireBotSecretKey, documentController.getDocument);
router.put("/documents/:id", requireBotSecretKey, documentController.updateDocument);
router.delete("/documents/:id", requireBotSecretKey, documentController.deleteDocument);

// --- Chat API (browser-facing, public key) ---
// widgetCors applied directly here + on OPTIONS preflight
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const botChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.bot?._id?.toString() || req.ip,
});

// Handle OPTIONS preflight explicitly — browsers send this before the POST
router.options("/chat", widgetCors);
router.post("/chat", widgetCors, chatLimiter, requireBotPublicKey, botChatLimiter, chatController.chat);

// --- Widget config ---
router.options("/widget/config", widgetCors);
router.get("/widget/config", widgetCors, requireBotPublicKey, widgetController.getWidgetConfig);

module.exports = router;
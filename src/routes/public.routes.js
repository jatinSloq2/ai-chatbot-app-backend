const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const documentController = require("../controllers/document.controller");
const chatController = require("../controllers/chat.controller");
const widgetController = require("../controllers/widget.controller");
const { requireBotSecretKey, requireBotPublicKey } = require("../middlewares/botAuth.middleware");
const { upload } = require("../middlewares/upload.middleware");

// --- Data management API (server-to-server, secret key) ---
// e.g. a customer's backend calls these to keep the bot's knowledge base fresh
router.post("/documents", requireBotSecretKey, documentController.addDocument);
router.post(
  "/documents/upload",
  requireBotSecretKey,
  upload.single("file"),
  documentController.uploadDocument
);
router.get("/documents", requireBotSecretKey, documentController.listDocuments);
router.get("/documents/:id", requireBotSecretKey, documentController.getDocument);
router.put("/documents/:id", requireBotSecretKey, documentController.updateDocument);
router.delete("/documents/:id", requireBotSecretKey, documentController.deleteDocument);

// --- Chat API (browser-facing, public key, used by the embedded widget) ---
// IP-based limiter (stops a single visitor from hammering any bot)
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // 20 messages/minute per IP, generous but stops widget abuse
  standardHeaders: true,
  legacyHeaders: false,
});

// Bot-based limiter (stops a single bot's aggregate traffic from overwhelming
// the LLM/embedding backend, regardless of how many different visitors it's from)
const botChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60 messages/minute per bot across all visitors
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.bot?._id?.toString() || req.ip,
});

router.post(
  "/chat",
  chatLimiter,
  requireBotPublicKey,
  botChatLimiter,
  chatController.chat
);

// --- Widget config (browser-facing, public key) ---
router.get("/widget/config", requireBotPublicKey, widgetController.getWidgetConfig);

module.exports = router;

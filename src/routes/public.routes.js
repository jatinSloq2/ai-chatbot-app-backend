const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const documentController = require("../controllers/document.controller");
const chatController = require("../controllers/chat.controller");
const widgetController = require("../controllers/widget.controller");
const leadController = require("../controllers/lead.controller");
const { requireBotSecretKey, requireBotPublicKey } = require("../middlewares/botAuth.middleware");
const { upload } = require("../middlewares/upload.middleware");

// Open CORS for all widget-facing endpoints
const widgetCors = cors({
  origin: "*",
  credentials: false,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key", "Authorization"],
});

// --- Data management API (secret key, server-to-server) ---
router.post("/documents", requireBotSecretKey, documentController.addDocument);
router.post("/documents/upload", requireBotSecretKey, upload.single("file"), documentController.uploadDocument);
router.get("/documents", requireBotSecretKey, documentController.listDocuments);
router.get("/documents/:id", requireBotSecretKey, documentController.getDocument);
router.put("/documents/:id", requireBotSecretKey, documentController.updateDocument);
router.delete("/documents/:id", requireBotSecretKey, documentController.deleteDocument);

// --- Chat (public key, SSE streaming) ---
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const botChatLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.bot?._id?.toString() || req.ip,
});

router.options("/chat", widgetCors);
router.post("/chat", widgetCors, chatLimiter, requireBotPublicKey, botChatLimiter, chatController.chat);

router.options("/chat/request-handover", widgetCors);
router.post("/chat/request-handover", widgetCors, chatLimiter, requireBotPublicKey, chatController.requestHandover);

router.options("/chat/poll", widgetCors);
router.get("/chat/poll", widgetCors, requireBotPublicKey, chatController.pollChat);

// --- Lead capture (public key, called by widget pre-chat form) ---
const leadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

router.options("/lead/submit", widgetCors);
router.post("/lead/submit", widgetCors, leadLimiter, requireBotPublicKey, leadController.submitLead);

router.options("/lead/send-otp", widgetCors);
router.post("/lead/send-otp", widgetCors, leadLimiter, requireBotPublicKey, leadController.sendLeadOtp);

router.options("/lead/verify-otp", widgetCors);
router.post("/lead/verify-otp", widgetCors, leadLimiter, requireBotPublicKey, leadController.verifyLeadOtp);

// --- Widget config ---
router.options("/widget/config", widgetCors);
router.get("/widget/config", widgetCors, requireBotPublicKey, widgetController.getWidgetConfig);

module.exports = router;
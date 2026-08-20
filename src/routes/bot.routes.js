const express = require("express");
const router = express.Router();

const botController = require("../controllers/bot.controller");
const conversationController = require("../controllers/conversation.controller");
const chatController = require("../controllers/chat.controller");
const analyticsController = require("../controllers/analytics.controller");
const { protect } = require("../middlewares/auth.middleware");
const { avatarUpload } = require("../middlewares/upload.middleware");

router.use(protect);

router.post("/", botController.createBot);
router.get("/", botController.listBots);
router.get("/:id", botController.getBot);
router.patch("/:id", botController.updateBot);
router.post("/:id/avatar", avatarUpload.single("file"), botController.uploadWidgetAvatar);
router.delete("/:id", botController.deleteBot);
router.post("/:id/regenerate-key", botController.regenerateKey);
router.post("/:id/model-config", botController.setModelConfig);
router.post("/:id/agent-config", botController.setAgentConfig);
router.post("/:id/business-hours", botController.setBusinessHours);
router.post("/:id/language-config", botController.setLanguageConfig);
router.post("/:id/whatsapp-channel", botController.setWhatsappChannel);
router.post("/:id/tools-config", botController.setToolsConfig);
router.post("/:id/test-chat", chatController.testChat);

// Conversations
router.get("/:id/conversations", conversationController.listConversations);
router.get("/:id/conversations/:sessionId", conversationController.getConversation);
router.post("/:id/conversations/:sessionId/handover", conversationController.requestConversationHandover);

// Analytics (all from new analytics controller)
router.get("/:id/analytics", analyticsController.getBotAnalytics);
router.get("/:id/analytics/events", analyticsController.getRecentEvents);
router.get("/:id/analytics/domains", analyticsController.getBotDomains);

module.exports = router;
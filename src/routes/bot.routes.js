const express = require("express");
const router = express.Router();

const botController = require("../controllers/bot.controller");
const conversationController = require("../controllers/conversation.controller");
const chatController = require("../controllers/chat.controller");
const { protect } = require("../middlewares/auth.middleware");

router.use(protect); // every route below requires a logged-in user

router.post("/", botController.createBot);
router.get("/", botController.listBots);
router.get("/:id", botController.getBot);
router.patch("/:id", botController.updateBot);
router.delete("/:id", botController.deleteBot);
router.post("/:id/regenerate-key", botController.regenerateKey);
router.post("/:id/model-config", botController.setModelConfig);
router.post("/:id/test-chat", chatController.testChat);

router.get("/:id/conversations", conversationController.listConversations);
router.get("/:id/conversations/:sessionId", conversationController.getConversation);
router.get("/:id/analytics", conversationController.getAnalytics);

module.exports = router;

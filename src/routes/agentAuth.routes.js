const express = require("express");
const router = express.Router();

const agentAuthController = require("../controllers/agentAuth.controller");
const { protectAgent } = require("../middlewares/agentAuth.middleware");

// Public (no agent session yet)
router.post("/login", agentAuthController.login);
router.post("/refresh-token", agentAuthController.refreshToken);

// Everything below requires a valid agent session
router.use(protectAgent);

router.post("/logout", agentAuthController.logout);
router.get("/me", agentAuthController.getMe);
router.patch("/status", agentAuthController.setStatus);

router.post("/fcm-token", agentAuthController.registerFcmToken);
router.delete("/fcm-token", agentAuthController.removeFcmToken);

router.get("/notifications", agentAuthController.listNotifications);
router.post("/notifications/read-all", agentAuthController.markAllNotificationsRead);
router.post("/notifications/:id/read", agentAuthController.markNotificationRead);
router.post("/notifications/test", agentAuthController.sendTestNotification);

module.exports = router;
const express = require("express");
const router = express.Router();

const agentController = require("../controllers/agent.controller");
const { protect } = require("../middlewares/auth.middleware");
const { avatarUpload } = require("../middlewares/upload.middleware");

router.use(protect);

router.post("/", agentController.createAgent);
router.get("/", agentController.listAgents);
router.get("/:id", agentController.getAgent);
router.get("/:id/conversations", agentController.listAgentConversations);
router.patch("/:id", agentController.updateAgent);
router.post("/:id/avatar", avatarUpload.single("file"), agentController.uploadAgentAvatar);
router.delete("/:id", agentController.deleteAgent);

module.exports = router;
const express = require("express");
const router = express.Router();

const leadsController = require("../controllers/leads.controller");
const { protect } = require("../middlewares/auth.middleware");

router.use(protect);

router.get("/", leadsController.listLeads);
router.get("/:identifier/conversations", leadsController.getLeadConversations);

module.exports = router;
const express = require("express");
const router = express.Router();

const adminController = require("../controllers/admin.controller");
const analyticsController = require("../controllers/analytics.controller");
const { protect, requireAdmin } = require("../middlewares/auth.middleware");

router.use(protect, requireAdmin);

router.get("/overview", adminController.getOverview);
router.get("/users", adminController.listUsers);
router.patch("/users/:id/role", adminController.setUserRole);
router.patch("/users/:id/suspend", adminController.suspendUserBots);
router.get("/bots", adminController.listAllBots);
router.get("/subscriptions", adminController.listSubscriptions);
router.get("/analytics", analyticsController.getPlatformAnalytics);

module.exports = router;
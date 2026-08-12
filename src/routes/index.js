const express = require("express");
const router = express.Router();

const authRoutes = require("./auth.routes");
const botRoutes = require("./bot.routes");
const planRoutes = require("./plan.routes");
const paymentRoutes = require("./payment.routes");
const publicRoutes = require("./public.routes");
const dashboardRoutes = require("./dashboard.routes");
const adminRoutes = require("./admin.routes");
const modelRoutes = require("./model.routes");
const agentRoutes = require("./agent.routes");
const teamRoutes = require("./team.routes");
const agentAuthRoutes = require("./agentAuth.routes");

router.use("/auth", authRoutes);
router.use("/bots", botRoutes);
router.use("/plans", planRoutes);
router.use("/payments", paymentRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/admin", adminRoutes);
router.use("/models", modelRoutes);
router.use("/agents", agentRoutes); // owner-side agent management (dashboard)
router.use("/teams", teamRoutes); // owner-side team management (dashboard)
router.use("/agent-auth", agentAuthRoutes); // agent-facing login + panel APIs
router.use("/v1", publicRoutes); // public developer-facing API (secret/public key auth, not user JWT)

module.exports = router;
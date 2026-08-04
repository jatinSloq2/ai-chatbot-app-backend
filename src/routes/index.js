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

router.use("/auth", authRoutes);
router.use("/bots", botRoutes);
router.use("/plans", planRoutes);
router.use("/payments", paymentRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/admin", adminRoutes);
router.use("/models", modelRoutes);
router.use("/v1", publicRoutes); // public developer-facing API (secret/public key auth, not user JWT)

module.exports = router;

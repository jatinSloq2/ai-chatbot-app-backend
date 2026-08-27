const express = require("express");
const router = express.Router();

const authRoutes = require("./auth.routes");
const botRoutes = require("./bot.routes");
const planRoutes = require("./plan.routes");
const addonRoutes = require("./addon.routes");
const paymentRoutes = require("./payment.routes");
const publicRoutes = require("./public.routes");
const dashboardRoutes = require("./dashboard.routes");
const adminRoutes = require("./admin.routes");
const modelRoutes = require("./model.routes");
const agentRoutes = require("./agent.routes");
const teamRoutes = require("./team.routes");
const agentAuthRoutes = require("./agentAuth.routes");
const leadsRoutes = require("./leads.routes");
const cannedResponseRoutes = require("./cannedResponse.routes");
const integrationCredentialRoutes = require("./integrationCredential.routes");
const oauthRoutes = require("./oauth.routes");
const referralRoutes = require("./referral.routes");
const couponRoutes = require("./coupon.routes");

router.use("/auth", authRoutes);
router.use("/bots", botRoutes);
router.use("/plans", planRoutes);
router.use("/addons", addonRoutes); // purchasable add-ons sold alongside a plan (e.g. WhatsApp Inbox, message packs)
router.use("/payments", paymentRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/admin", adminRoutes);
router.use("/models", modelRoutes);
router.use("/agents", agentRoutes); // owner-side agent management (dashboard)
router.use("/teams", teamRoutes); // owner-side team management (dashboard)
router.use("/agent-auth", agentAuthRoutes); // agent-facing login + panel APIs
router.use("/leads", leadsRoutes); // owner-side lead aggregation across bots
router.use("/canned-responses", cannedResponseRoutes); // owner-side saved-reply (macro) management
router.use("/credentials", integrationCredentialRoutes); // owner-side integration credentials (email/whatsapp/sms/ai)
router.use("/oauth", oauthRoutes); // Google/Microsoft "Connect Gmail / Connect Outlook" real OAuth2 flow
router.use("/referral", referralRoutes); // referral codes, applying one, wallet balance/ledger, admin referral-offer settings
router.use("/coupons", couponRoutes); // admin-managed discount coupons + checkout-time validation
router.use("/v1", publicRoutes); // public developer-facing API (secret/public key auth, not user JWT)

module.exports = router;
const express = require("express");
const router = express.Router();

const referralController = require("../controllers/referral.controller");
const { protect, requireAdmin } = require("../middlewares/auth.middleware");

router.use(protect);

// --- User-facing ---
router.get("/me", referralController.getMyReferralOverview);
router.post("/apply", referralController.applyReferralCode);
router.get("/wallet/transactions", referralController.listWalletTransactions);

// --- Admin ---
router.get("/admin/settings", requireAdmin, referralController.getSettings);
router.put("/admin/settings", requireAdmin, referralController.updateSettings);
router.get("/admin/rewards", requireAdmin, referralController.listRewards);

module.exports = router;

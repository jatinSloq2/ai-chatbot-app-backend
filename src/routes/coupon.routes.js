const express = require("express");
const router = express.Router();

const couponController = require("../controllers/coupon.controller");
const { protect, requireAdmin } = require("../middlewares/auth.middleware");

router.use(protect);

// --- User-facing ---
router.post("/validate", couponController.validateCoupon);

// --- Admin ---
router.get("/admin", requireAdmin, couponController.listCoupons);
router.post("/admin", requireAdmin, couponController.createCoupon);
router.patch("/admin/:id", requireAdmin, couponController.updateCoupon);
router.delete("/admin/:id", requireAdmin, couponController.deleteCoupon);

module.exports = router;

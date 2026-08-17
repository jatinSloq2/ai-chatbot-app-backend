const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const couponService = require("../services/coupon.service");
const billingService = require("../services/billing.service");
const Plan = require("../models/Plan");

// --- Admin ---

// GET /api/coupons/admin
const listCoupons = asyncHandler(async (req, res) => {
  const coupons = await couponService.listCoupons();
  res.status(200).json({ success: true, data: { coupons } });
});

// POST /api/coupons/admin
const createCoupon = asyncHandler(async (req, res) => {
  const coupon = await couponService.createCoupon(req.user._id, req.body);
  res.status(201).json({ success: true, message: "Coupon created", data: { coupon } });
});

// PATCH /api/coupons/admin/:id
const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await couponService.updateCoupon(req.params.id, req.body);
  res.status(200).json({ success: true, message: "Coupon updated", data: { coupon } });
});

// DELETE /api/coupons/admin/:id
const deleteCoupon = asyncHandler(async (req, res) => {
  await couponService.deleteCoupon(req.params.id);
  res.status(200).json({ success: true, message: "Coupon deleted" });
});

// --- User-facing ---

// POST /api/coupons/validate  body: { code, planId, currency }
// Lets the checkout screen show the discounted price live, before the
// order is actually created. Mirrors the exact same charge-amount math
// createOrder uses so the number shown here matches what gets charged.
const validateCoupon = asyncHandler(async (req, res) => {
  const { code, planId, currency = "inr" } = req.body;
  const normalizedCurrency = currency.toLowerCase();
  if (!["inr", "usd"].includes(normalizedCurrency)) throw new ApiError(400, "currency must be 'inr' or 'usd'");

  const plan = await Plan.findById(planId);
  if (!plan || !plan.isActive) throw new ApiError(404, "Plan not found");

  const charge = await billingService.computeCharge({ userId: req.user._id, newPlan: plan, currency: normalizedCurrency });

  const { discountAmount } = await couponService.validateCoupon(code, {
    userId: req.user._id,
    plan,
    currency: normalizedCurrency,
    chargeAmount: charge.chargeAmount,
  });

  res.status(200).json({
    success: true,
    data: {
      valid: true,
      discountAmount,
      amountBeforeCoupon: charge.chargeAmount,
      amountAfterCoupon: Math.max(0, charge.chargeAmount - discountAmount),
    },
  });
});

module.exports = { listCoupons, createCoupon, updateCoupon, deleteCoupon, validateCoupon };

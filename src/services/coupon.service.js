const Coupon = require("../models/Coupon");
const CouponRedemption = require("../models/CouponRedemption");
const ApiError = require("../utils/ApiError");

const listCoupons = async () => Coupon.find().sort({ createdAt: -1 });

const createCoupon = async (adminUserId, body) => {
  const {
    code,
    description,
    discountType,
    discountValue,
    flatAmount,
    maxRedemptions,
    perUserLimit,
    minOrderAmount,
    applicablePlans,
    startsAt,
    expiresAt,
    isActive,
  } = body;

  if (!code?.trim()) throw new ApiError(400, "Coupon code is required");
  if (!["flat", "percent"].includes(discountType)) throw new ApiError(400, "discountType must be 'flat' or 'percent'");
  if (discountType === "percent" && (discountValue == null || discountValue <= 0 || discountValue > 100)) {
    throw new ApiError(400, "discountValue must be between 1 and 100 for a percent coupon");
  }
  if (discountType === "flat" && !(flatAmount?.inr > 0 || flatAmount?.usd > 0)) {
    throw new ApiError(400, "flatAmount.inr or flatAmount.usd is required for a flat coupon");
  }

  const existing = await Coupon.findOne({ code: code.trim().toUpperCase() });
  if (existing) throw new ApiError(409, "A coupon with this code already exists");

  return Coupon.create({
    code: code.trim().toUpperCase(),
    description,
    discountType,
    discountValue,
    flatAmount,
    maxRedemptions: maxRedemptions ?? null,
    perUserLimit: perUserLimit ?? 1,
    minOrderAmount,
    applicablePlans,
    startsAt,
    expiresAt,
    isActive: isActive ?? true,
    createdBy: adminUserId,
  });
};

const updateCoupon = async (id, updates) => {
  const coupon = await Coupon.findById(id);
  if (!coupon) throw new ApiError(404, "Coupon not found");

  const allowed = [
    "description",
    "discountType",
    "discountValue",
    "flatAmount",
    "maxRedemptions",
    "perUserLimit",
    "minOrderAmount",
    "applicablePlans",
    "startsAt",
    "expiresAt",
    "isActive",
  ];
  for (const key of allowed) {
    if (updates[key] !== undefined) coupon[key] = updates[key];
  }
  await coupon.save();
  return coupon;
};

const deleteCoupon = async (id) => {
  const coupon = await Coupon.findByIdAndDelete(id);
  if (!coupon) throw new ApiError(404, "Coupon not found");
  return coupon;
};

// Validates a coupon for `userId` buying `plan` in `currency`, against
// `chargeAmount` (the amount they'd otherwise pay, AFTER proration/upgrade
// discount but before any coupon). Returns { coupon, discountAmount } —
// never mutates redemption counters, since a coupon should only be
// "spent" once the payment actually succeeds (see redeemCoupon below).
const validateCoupon = async (rawCode, { userId, plan, currency, chargeAmount }) => {
  const code = (rawCode || "").trim().toUpperCase();
  if (!code) throw new ApiError(400, "Coupon code is required");

  const coupon = await Coupon.findOne({ code });
  if (!coupon || !coupon.isCurrentlyValid()) {
    throw new ApiError(400, "This coupon is invalid or has expired");
  }

  if (coupon.applicablePlans?.length && !coupon.applicablePlans.some((p) => p.toString() === plan._id.toString())) {
    throw new ApiError(400, "This coupon doesn't apply to the selected plan");
  }

  const minAmount = coupon.minOrderAmount?.[currency] || 0;
  if (chargeAmount < minAmount) {
    throw new ApiError(400, "Order amount is below this coupon's minimum");
  }

  const priorUses = await CouponRedemption.countDocuments({ coupon: coupon._id, user: userId });
  if (priorUses >= coupon.perUserLimit) {
    throw new ApiError(400, "You've already used this coupon the maximum number of times");
  }

  let discountAmount = 0;
  if (coupon.discountType === "percent") {
    discountAmount = Math.round(chargeAmount * (coupon.discountValue / 100));
  } else {
    discountAmount = coupon.flatAmount?.[currency] || 0;
  }
  discountAmount = Math.max(0, Math.min(discountAmount, chargeAmount));

  return { coupon, discountAmount };
};

// Finalizes coupon usage once a payment has actually succeeded — bumps the
// running total and writes the per-user redemption record that
// validateCoupon's perUserLimit check relies on.
const redeemCoupon = async ({ couponCode, userId, subscriptionId, discountAmount, currency }) => {
  if (!couponCode || !discountAmount) return null;

  const coupon = await Coupon.findOne({ code: couponCode });
  if (!coupon) return null; // shouldn't happen, but never block subscription activation over it

  coupon.redemptionsCount += 1;
  await coupon.save();

  return CouponRedemption.create({
    coupon: coupon._id,
    user: userId,
    subscription: subscriptionId,
    discountAmount,
    currency,
  });
};

module.exports = { listCoupons, createCoupon, updateCoupon, deleteCoupon, validateCoupon, redeemCoupon };

const mongoose = require("mongoose");

/**
 * Admin-managed discount coupons, entered manually by a user at checkout
 * (payment.controller.js#createOrder). Distinct from the referral offer:
 * a coupon is a general-purpose promo code anyone can use (subject to the
 * limits below), not tied to being referred by another user.
 */
const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    description: { type: String, trim: true },

    discountType: { type: String, enum: ["flat", "percent"], required: true },
    discountValue: { type: Number, min: 0, max: 100 }, // used when discountType === "percent"
    flatAmount: {
      inr: { type: Number, default: 0, min: 0 },
      usd: { type: Number, default: 0, min: 0 },
    },

    // null/undefined = unlimited
    maxRedemptions: { type: Number, default: null, min: 0 },
    redemptionsCount: { type: Number, default: 0, min: 0 },
    // How many times ONE user may use this same coupon. Default 1 so a
    // "flat discount" promo can't be replayed by the same account.
    perUserLimit: { type: Number, default: 1, min: 1 },

    minOrderAmount: {
      inr: { type: Number, default: 0, min: 0 },
      usd: { type: Number, default: 0, min: 0 },
    },

    // Empty array = valid on every plan.
    applicablePlans: [{ type: mongoose.Schema.Types.ObjectId, ref: "Plan" }],

    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },

    isActive: { type: Boolean, default: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

couponSchema.methods.isCurrentlyValid = function () {
  const now = new Date();
  if (!this.isActive) return false;
  if (this.startsAt && now < this.startsAt) return false;
  if (this.expiresAt && now > this.expiresAt) return false;
  if (this.maxRedemptions != null && this.redemptionsCount >= this.maxRedemptions) return false;
  return true;
};

module.exports = mongoose.model("Coupon", couponSchema);

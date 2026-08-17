const mongoose = require("mongoose");

/**
 * One row per successful (i.e. payment actually completed) use of a
 * coupon. Used to enforce Coupon.perUserLimit and to give admins a real
 * audit trail — Coupon.redemptionsCount is a fast running total, this is
 * the detail behind it.
 */
const couponRedemptionSchema = new mongoose.Schema(
  {
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", required: true },
    discountAmount: { type: Number, required: true }, // smallest currency unit
    currency: { type: String, enum: ["inr", "usd"], required: true },
  },
  { timestamps: true }
);

couponRedemptionSchema.index({ coupon: 1, user: 1 });

module.exports = mongoose.model("CouponRedemption", couponRedemptionSchema);

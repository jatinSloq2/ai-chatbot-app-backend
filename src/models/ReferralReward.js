const mongoose = require("mongoose");

/**
 * One row per referred user's FIRST successful plan purchase — the moment
 * a referral actually "converts". Recorded once per referredUser (unique
 * index below) regardless of how many plans they buy afterwards, which is
 * also what services/referral.service.js uses to decide whether a purchase
 * should trigger a reward at all.
 */
const referralRewardSchema = new mongoose.Schema(
  {
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    referredUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", required: true },

    // The discount the referred buddy received on this purchase — the
    // basis the bonus is a share of.
    discountGivenToReferred: { type: Number, required: true }, // smallest currency unit
    bonusCredited: { type: Number, required: true, default: 0 }, // smallest currency unit; 0 if capped_skipped
    currency: { type: String, enum: ["inr", "usd"], required: true },

    // "capped_skipped": the referrer had already hit maxReferralsPerMonth
    // for the calendar month this conversion happened in — the referred
    // user still keeps their discount, the referrer just earns nothing
    // for this one.
    status: { type: String, enum: ["credited", "capped_skipped"], default: "credited" },
  },
  { timestamps: true }
);

referralRewardSchema.index({ referrer: 1, createdAt: -1 });

module.exports = mongoose.model("ReferralReward", referralRewardSchema);

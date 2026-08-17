const mongoose = require("mongoose");

/**
 * Singleton document (there is only ever one) holding the admin-controlled
 * referral program configuration: what discount a newly referred user gets
 * on their first plan purchase, and how much of that discount their
 * referrer earns back as wallet credit. Admin can change this any time via
 * PUT /api/referral/admin/settings — every future referral discount picks
 * up the new value immediately (past ones are unaffected, since the amount
 * actually applied is snapshotted onto the Subscription record).
 */
const referralSettingSchema = new mongoose.Schema(
  {
    // "percent" -> discountValue is 0-100 off the charge amount.
    // "flat"    -> flatAmount.{inr,usd} is subtracted directly (smallest unit).
    discountType: { type: String, enum: ["flat", "percent"], default: "percent" },
    discountValue: { type: Number, default: 10, min: 0, max: 100 }, // used when discountType === "percent"
    flatAmount: {
      inr: { type: Number, default: 0, min: 0 },
      usd: { type: Number, default: 0, min: 0 },
    },

    // What fraction of the discount the referred buddy received gets
    // credited back to the referrer's wallet, e.g. 50 -> half of a ₹100
    // discount becomes a ₹50 wallet credit for the referrer.
    bonusSharePercent: { type: Number, default: 50, min: 0, max: 100 },

    // Referral bonus credits stop being awarded to a referrer once they've
    // hit this many in the current calendar month (referrals keep working,
    // the referred user still gets their discount — the referrer just stops
    // earning further wallet credit until next month).
    maxReferralsPerMonth: { type: Number, default: 20, min: 0 },

    isActive: { type: Boolean, default: true },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Always operate on the single settings doc, creating it with defaults the
// first time anything asks for it.
referralSettingSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) settings = await this.create({});
  return settings;
};

module.exports = mongoose.model("ReferralSetting", referralSettingSchema);

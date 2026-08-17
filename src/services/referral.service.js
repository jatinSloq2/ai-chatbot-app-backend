const User = require("../models/User");
const ReferralSetting = require("../models/ReferralSetting");
const ReferralReward = require("../models/ReferralReward");
const ApiError = require("../utils/ApiError");
const walletService = require("./wallet.service");

const getSettings = () => ReferralSetting.getSettings();

const updateSettings = async (adminUserId, updates) => {
  const settings = await ReferralSetting.getSettings();

  const allowed = ["discountType", "discountValue", "flatAmount", "bonusSharePercent", "maxReferralsPerMonth", "isActive"];
  for (const key of allowed) {
    if (updates[key] !== undefined) settings[key] = updates[key];
  }
  settings.updatedBy = adminUserId;
  await settings.save();
  return settings;
};

// Applies a referral code to `userId` — used both right after signup (if a
// code was entered on the form) and, later, once from the profile page.
// A code can only ever be applied once per account, for good: once
// referredBy is set it's immutable.
const applyReferralCode = async (userId, rawCode) => {
  const code = (rawCode || "").trim().toUpperCase();
  if (!code) throw new ApiError(400, "Referral code is required");

  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  if (user.referredBy || user.referralCodeAppliedAt) {
    throw new ApiError(400, "You've already used a referral code on this account");
  }

  if (user.referralCode === code) {
    throw new ApiError(400, "You can't use your own referral code");
  }

  const referrer = await User.findOne({ referralCode: code });
  if (!referrer) throw new ApiError(404, "Invalid referral code");

  // A referrer's code, by construction, only exists once their account
  // does — so referredBy always points at a user created before this one.
  // No extra check needed beyond that lookup succeeding.

  user.referredBy = referrer._id;
  user.referralCodeAppliedAt = new Date();
  await user.save();

  return user;
};

// What "getMe"/profile screens show: the user's own code, whether they've
// still got their one-time slot to enter someone else's, and their wallet.
const getReferralOverview = async (userId) => {
  const user = await User.findById(userId).populate("referredBy", "name referralCode");
  if (!user) throw new ApiError(404, "User not found");

  const [referralsCount, rewardsThisMonth, wallet] = await Promise.all([
    User.countDocuments({ referredBy: user._id }),
    ReferralReward.countDocuments({
      referrer: user._id,
      status: "credited",
      createdAt: { $gte: startOfMonth() },
    }),
    walletService.getBalance(user._id),
  ]);

  const settings = await getSettings();

  return {
    referralCode: user.referralCode,
    canApplyCode: !user.referredBy && !user.referralCodeAppliedAt,
    referredBy: user.referredBy ? { name: user.referredBy.name, code: user.referredBy.referralCode } : null,
    referralsCount,
    rewardsThisMonth,
    maxReferralsPerMonth: settings.maxReferralsPerMonth,
    wallet,
  };
};

const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

// Computes what discount a referred user should get on `chargeAmount`
// (their side of the referral offer), per the CURRENT admin settings.
// Returns 0 if the offer is inactive.
const computeReferralDiscount = (settings, chargeAmount, currency) => {
  if (!settings.isActive) return 0;

  let discount = 0;
  if (settings.discountType === "percent") {
    discount = Math.round(chargeAmount * (settings.discountValue / 100));
  } else {
    discount = settings.flatAmount?.[currency] || 0;
  }
  return Math.max(0, Math.min(discount, chargeAmount));
};

// Whether `user` is eligible for the automatic referral discount on their
// NEXT purchase — must have been referred, and must not have already spent
// their one-time discount.
const isEligibleForReferralDiscount = (user) => !!user.referredBy && !user.referralDiscountUsed;

// Called after a purchase is confirmed as paid. If this is the referred
// user's first-ever paid purchase and it carried a referral discount,
// credits the referrer's wallet with their share of that discount —
// subject to the monthly cap. Safe to call for every successful purchase;
// it no-ops for users who weren't referred, or who've already converted.
const awardReferralBonusIfEligible = async (user, subscription) => {
  if (!user.referredBy) return null;
  if (!subscription.referralDiscountApplied || subscription.referralDiscountApplied <= 0) return null;

  // Bonus is awarded once per referred user, on their first qualifying
  // purchase — never repeats even if referralDiscountUsed was somehow
  // reset by an admin later.
  const existing = await ReferralReward.findOne({ referredUser: user._id });
  if (existing) return existing;

  const settings = await getSettings();
  const bonusAmount = Math.round(subscription.referralDiscountApplied * (settings.bonusSharePercent / 100));

  const monthStart = startOfMonth();
  const rewardsThisMonth = await ReferralReward.countDocuments({
    referrer: user.referredBy,
    status: "credited",
    createdAt: { $gte: monthStart },
  });

  const capped = rewardsThisMonth >= settings.maxReferralsPerMonth;

  const reward = await ReferralReward.create({
    referrer: user.referredBy,
    referredUser: user._id,
    subscription: subscription._id,
    discountGivenToReferred: subscription.referralDiscountApplied,
    bonusCredited: capped ? 0 : bonusAmount,
    currency: subscription.currency,
    status: capped ? "capped_skipped" : "credited",
  });

  if (!capped && bonusAmount > 0) {
    await walletService.credit(user.referredBy, {
      amount: bonusAmount,
      currency: subscription.currency,
      reason: "referral_bonus",
      referenceModel: "ReferralReward",
      referenceId: reward._id,
      note: `Referral bonus for ${user.email || user._id} purchasing a plan`,
    });
  }

  return reward;
};

module.exports = {
  getSettings,
  updateSettings,
  applyReferralCode,
  getReferralOverview,
  computeReferralDiscount,
  isEligibleForReferralDiscount,
  awardReferralBonusIfEligible,
};

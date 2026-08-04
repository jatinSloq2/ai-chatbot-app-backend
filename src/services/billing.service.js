const Subscription = require("../models/Subscription");

// Same day-count approximation used consistently everywhere in billing math
const CYCLE_DAYS = { month: 30, year: 365 };

const daysBetween = (a, b) => Math.max(0, (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));

// A user gets the upgrade discount only when moving from one *paid, still-active*
// plan to a higher one — not on their very first paid purchase.
const UPGRADE_DISCOUNT_PERCENT = 10;

/**
 * Computes what a user should actually pay when subscribing to `newPlan`,
 * accounting for:
 *  - Per-day proration: if they have time remaining on a current paid plan,
 *    the unused value of that plan is credited against the new plan's price.
 *  - Upgrade discount: an additional 10% off the (post-credit) price, but
 *    ONLY if this is a genuine upgrade (they already have an active paid
 *    subscription) — first-time purchases pay full list price.
 *
 * Returns everything needed both to charge the right amount AND to record
 * a clear audit trail on the Subscription record.
 */
const computeCharge = async ({ userId, newPlan, currency }) => {
  const fullPrice = currency === "usd" ? newPlan.price.usd : newPlan.price.inr;

  const currentSub = await Subscription.findOne({
    user: userId,
    status: "active",
    endDate: { $gt: new Date() },
  }).populate("plan");

  // No existing paid plan -> straightforward first purchase, full price, no discount
  if (!currentSub) {
    return {
      chargeAmount: fullPrice,
      listPrice: fullPrice,
      proratedCredit: 0,
      discountApplied: 0,
      isUpgrade: false,
    };
  }

  const now = new Date();
  const oldCycleDays = CYCLE_DAYS[currentSub.plan.interval] || 30;
  const remainingDays = daysBetween(now, currentSub.endDate);

  const oldDailyRate = currentSub.amount / oldCycleDays;
  const proratedCredit = Math.round(oldDailyRate * remainingDays);

  const priceAfterCredit = Math.max(0, fullPrice - proratedCredit);

  const isUpgrade = fullPrice > currentSub.amount; // moving to a genuinely higher-priced plan
  const discountApplied = isUpgrade
    ? Math.round(priceAfterCredit * (UPGRADE_DISCOUNT_PERCENT / 100))
    : 0;

  const chargeAmount = Math.max(0, priceAfterCredit - discountApplied);

  return {
    chargeAmount,
    listPrice: fullPrice,
    proratedCredit,
    discountApplied,
    isUpgrade,
  };
};

module.exports = { computeCharge, UPGRADE_DISCOUNT_PERCENT, CYCLE_DAYS };

const cron = require("node-cron");
const Subscription = require("../models/Subscription");
const User = require("../models/User");
const emailService = require("../services/email.service");

// Runs once a day. Two jobs:
// 1. Expire subscriptions whose endDate has passed (user silently drops to Free plan
//    since bot/plan-limit checks always fall back to Free when no active sub exists)
// 2. Warn users whose subscription expires within the next 3 days
const runExpiryCheck = async () => {
  const now = new Date();

  // --- Expire ---
  const expiring = await Subscription.find({
    status: { $in: ["active", "cancelled"] },
    endDate: { $lte: now },
  }).populate("plan user");

  for (const sub of expiring) {
    sub.status = "expired";
    await sub.save();
    if (sub.user?.email) {
      emailService
        .sendSubscriptionExpiredEmail(sub.user.email, { planName: sub.plan.name })
        .catch((err) => console.error("Expiry email failed:", err.message));
    }
  }
  if (expiring.length) console.log(`[cron] Expired ${expiring.length} subscription(s)`);

  // --- Warn (3 days out, only once — guard with a flag would be better in
  // production; kept simple here since this runs daily and emails are cheap) ---
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const soonExpiring = await Subscription.find({
    status: "active",
    endDate: { $gt: now, $lte: threeDaysFromNow },
  }).populate("plan user");

  for (const sub of soonExpiring) {
    if (sub.user?.email) {
      emailService
        .sendSubscriptionExpiringEmail(sub.user.email, {
          planName: sub.plan.name,
          endDate: sub.endDate,
        })
        .catch((err) => console.error("Expiry warning email failed:", err.message));
    }
  }
};

const startCronJobs = () => {
  // Runs every day at 3:00 AM server time
  cron.schedule("0 3 * * *", () => {
    runExpiryCheck().catch((err) => console.error("[cron] Expiry check failed:", err));
  });
  console.log("Cron jobs scheduled (subscription expiry check: daily 3:00 AM)");
};

module.exports = { startCronJobs, runExpiryCheck };

const asyncHandler = require("../utils/asyncHandler");
const Plan = require("../models/Plan");

// GET /api/plans?currency=inr|usd
const listPlans = asyncHandler(async (req, res) => {
  const currency = (req.query.currency || "inr").toLowerCase();
  const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1 });

  const formatted = plans.map((p) => ({
    id: p._id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    interval: p.interval,
    price: {
      amount: currency === "usd" ? p.price.usd : p.price.inr,
      currency: currency === "usd" ? "USD" : "INR",
      // human-readable display value (divide out of paise/cents)
      display:
        currency === "usd"
          ? `$${(p.price.usd / 100).toFixed(2)}`
          : `₹${(p.price.inr / 100).toFixed(2)}`,
    },
    limits: p.limits,
  }));

  res.status(200).json({ success: true, data: { plans: formatted } });
});

module.exports = { listPlans };

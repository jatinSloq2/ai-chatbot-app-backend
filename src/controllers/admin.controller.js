const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const User = require("../models/User");
const Bot = require("../models/Bot");
const Subscription = require("../models/Subscription");
const Plan = require("../models/Plan");
const Document = require("../models/Document");

// GET /api/admin/overview
const getOverview = asyncHandler(async (req, res) => {
  const [totalUsers, totalBots, totalDocuments, activeSubscriptions, allActiveSubs] =
    await Promise.all([
      User.countDocuments(),
      Bot.countDocuments(),
      Document.countDocuments(),
      Subscription.countDocuments({ status: "active", endDate: { $gt: new Date() } }),
      Subscription.find({ status: "active", endDate: { $gt: new Date() } }),
    ]);

  // Revenue is tracked separately per currency since INR paise and USD cents
  // are not directly summable.
  const revenue = { inr: 0, usd: 0 };
  allActiveSubs.forEach((s) => {
    revenue[s.currency] += s.amount;
  });

  res.status(200).json({
    success: true,
    data: {
      totalUsers,
      totalBots,
      totalDocuments,
      activeSubscriptions,
      monthlyRecurringRevenue: {
        inr: `₹${(revenue.inr / 100).toFixed(2)}`,
        usd: `$${(revenue.usd / 100).toFixed(2)}`,
      },
    },
  });
});

// GET /api/admin/users?page=1&limit=20&search=
const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const search = req.query.search;

  const filter = search
    ? { $or: [{ email: new RegExp(search, "i") }, { name: new RegExp(search, "i") }] }
    : {};

  const [users, total] = await Promise.all([
    User.find(filter)
      .select("name email role authProvider isEmailVerified createdAt")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } },
  });
});

// PATCH /api/admin/users/:id/role   body: { role: "user"|"admin" }
const setUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!["user", "admin"].includes(role)) throw new ApiError(400, "role must be 'user' or 'admin'");

  const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select(
    "name email role"
  );
  if (!user) throw new ApiError(404, "User not found");

  res.status(200).json({ success: true, data: { user } });
});

// GET /api/admin/bots?page=1&limit=20
const listAllBots = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);

  const [bots, total] = await Promise.all([
    Bot.find()
      .populate("user", "name email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("name isActive documentCount messagesThisMonth llmConfig.provider user createdAt"),
    Bot.countDocuments(),
  ]);

  res.status(200).json({
    success: true,
    data: { bots, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } },
  });
});

// GET /api/admin/subscriptions?status=active
const listSubscriptions = asyncHandler(async (req, res) => {
  const filter = req.query.status ? { status: req.query.status } : {};
  const subscriptions = await Subscription.find(filter)
    .populate("user", "name email")
    .populate("plan", "name slug")
    .sort({ createdAt: -1 })
    .limit(200);

  res.status(200).json({ success: true, data: { subscriptions } });
});

// PATCH /api/admin/users/:id/suspend   body: { isActive: false }
const suspendUserBots = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  await Bot.updateMany({ user: req.params.id }, { isActive: !!isActive });
  res.status(200).json({
    success: true,
    message: `All bots for this user set to isActive=${!!isActive}`,
  });
});

module.exports = {
  getOverview,
  listUsers,
  setUserRole,
  listAllBots,
  listSubscriptions,
  suspendUserBots,
};

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const User = require("../models/User");
const Bot = require("../models/Bot");
const Subscription = require("../models/Subscription");
const Plan = require("../models/Plan");
const Document = require("../models/Document");
const AddOn = require("../models/AddOn");
const UserAddOn = require("../models/UserAddOn");

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

// GET /api/admin/addons
// Admin view of the catalog — includes inactive rows the public listing hides.
const listAllAddOns = asyncHandler(async (req, res) => {
  const addOns = await AddOn.find().sort({ sortOrder: 1 });
  res.status(200).json({ success: true, data: { addOns } });
});

// POST /api/admin/addons
const createAddOn = asyncHandler(async (req, res) => {
  const { name, slug, description, price, billingType, interval, limit, sampleSheetUrl, sortOrder } = req.body;

  if (!name || !slug || !price) throw new ApiError(400, "name, slug and price are required");
  if (billingType === "recurring" && !interval) {
    throw new ApiError(400, "interval is required when billingType is 'recurring'");
  }

  const addOn = await AddOn.create({
    name,
    slug,
    description,
    price,
    billingType: billingType || "lifetime",
    interval: billingType === "recurring" ? interval : null,
    limit,
    sampleSheetUrl,
    sortOrder,
  });

  res.status(201).json({ success: true, data: { addOn } });
});

// PATCH /api/admin/addons/:id
const updateAddOn = asyncHandler(async (req, res) => {
  const allowedFields = [
    "name",
    "description",
    "price",
    "billingType",
    "interval",
    "limit",
    "sampleSheetUrl",
    "isActive",
    "sortOrder",
  ];
  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  const addOn = await AddOn.findByIdAndUpdate(req.params.id, updates, { new: true });
  if (!addOn) throw new ApiError(404, "Add-on not found");

  res.status(200).json({ success: true, data: { addOn } });
});

// DELETE /api/admin/addons/:id
// Soft delete — deactivates rather than removing, so existing UserAddOn
// records purchased against it stay valid and referenceable.
const deleteAddOn = asyncHandler(async (req, res) => {
  const addOn = await AddOn.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!addOn) throw new ApiError(404, "Add-on not found");

  res.status(200).json({ success: true, message: "Add-on deactivated", data: { addOn } });
});

// GET /api/admin/user-addons?userId=&status=
const listUserAddOns = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.userId) filter.user = req.query.userId;
  if (req.query.status) filter.status = req.query.status;

  const userAddOns = await UserAddOn.find(filter)
    .populate("user", "name email")
    .populate("addOn", "name slug billingType")
    .sort({ createdAt: -1 })
    .limit(200);

  res.status(200).json({ success: true, data: { userAddOns } });
});

// POST /api/admin/user-addons/grant   body: { userId, addOnId, note? }
// Provisions an add-on directly, bypassing Razorpay — e.g. comped access or
// a manually-settled deal. Always active immediately; endDate follows the
// same lifetime/recurring rule a real purchase would.
const grantAddOn = asyncHandler(async (req, res) => {
  const { userId, addOnId, note } = req.body;
  if (!userId || !addOnId) throw new ApiError(400, "userId and addOnId are required");

  const addOn = await AddOn.findById(addOnId);
  if (!addOn) throw new ApiError(404, "Add-on not found");

  const addInterval = (date, interval) => {
    const d = new Date(date);
    if (interval === "year") d.setFullYear(d.getFullYear() + 1);
    else if (interval === "quarter") d.setMonth(d.getMonth() + 3);
    else d.setMonth(d.getMonth() + 1);
    return d;
  };

  const userAddOn = await UserAddOn.create({
    user: userId,
    addOn: addOn._id,
    source: "admin_grant",
    currency: "inr",
    amount: 0,
    status: "active",
    startDate: new Date(),
    endDate: addOn.billingType === "recurring" ? addInterval(new Date(), addOn.interval) : null,
    limit: addOn.limit,
    grantedBy: req.user._id,
    note,
  });

  res.status(201).json({ success: true, data: { userAddOn } });
});

// PATCH /api/admin/user-addons/:id/revoke
const revokeAddOn = asyncHandler(async (req, res) => {
  const userAddOn = await UserAddOn.findByIdAndUpdate(
    req.params.id,
    { status: "cancelled" },
    { new: true }
  );
  if (!userAddOn) throw new ApiError(404, "Add-on grant not found");

  res.status(200).json({ success: true, message: "Add-on revoked", data: { userAddOn } });
});

// POST /api/admin/users/:id/assign-plan   body: { planId, durationMonths? }
const assignUserPlan = asyncHandler(async (req, res) => {
  const { planId, durationMonths = 1 } = req.body;
  if (!planId) throw new ApiError(400, "planId is required");

  const plan = await Plan.findById(planId);
  if (!plan) throw new ApiError(404, "Plan not found");

  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(startDate.getMonth() + durationMonths);

  // Mark existing active subscriptions as cancelled to avoid conflicts
  await Subscription.updateMany(
    { user: req.params.id, status: { $in: ["active", "cancelled"] }, endDate: { $gt: new Date() } },
    { status: "cancelled" }
  );

  const subscription = await Subscription.create({
    user: req.params.id,
    plan: plan._id,
    status: "active",
    startDate,
    endDate,
    amount: 0, // Admin grant is free
    currency: "inr",
    grantedBy: req.user._id,
  });

  res.status(201).json({
    success: true,
    message: `Plan ${plan.name} assigned to user for ${durationMonths} month(s)`,
    data: { subscription },
  });
});

module.exports = {
  getOverview,
  listUsers,
  setUserRole,
  listAllBots,
  listSubscriptions,
  suspendUserBots,
  listAllAddOns,
  createAddOn,
  updateAddOn,
  deleteAddOn,
  listUserAddOns,
  grantAddOn,
  revokeAddOn,
  assignUserPlan,
};
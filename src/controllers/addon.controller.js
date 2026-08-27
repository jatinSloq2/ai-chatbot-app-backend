const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const AddOn = require("../models/AddOn");
const UserAddOn = require("../models/UserAddOn");
const Subscription = require("../models/Subscription");
const razorpayService = require("../services/razorpay.service");
const logger = require("../utils/logger");

// An "active plan" here means a real paid subscription still in its paid
// window — free-plan users have no Subscription record at all, so this
// naturally excludes them. A cancelled-but-not-yet-expired subscription
// still counts (cancelling only stops renewal, access continues until
// endDate), same rule used by GET /api/payments/my-subscription.
const hasActivePlan = async (userId) => {
  const subscription = await Subscription.findOne({
    user: userId,
    status: { $in: ["active", "cancelled"] },
    endDate: { $gt: new Date() },
  });
  return !!subscription;
};

const addInterval = (date, interval) => {
  const d = new Date(date);
  if (interval === "year") d.setFullYear(d.getFullYear() + 1);
  else if (interval === "quarter") d.setMonth(d.getMonth() + 3);
  else d.setMonth(d.getMonth() + 1);
  return d;
};

const formatAddOn = (a, currency) => ({
  id: a._id,
  name: a.name,
  slug: a.slug,
  description: a.description,
  billingType: a.billingType,
  interval: a.interval,
  limit: a.limit,
  sampleSheetUrl: a.sampleSheetUrl,
  price: {
    amount: currency === "usd" ? a.price.usd : a.price.inr,
    currency: currency === "usd" ? "USD" : "INR",
    display:
      currency === "usd" ? `$${(a.price.usd / 100).toFixed(2)}` : `₹${(a.price.inr / 100).toFixed(2)}`,
  },
});

// GET /api/addons?currency=inr|usd
// Public catalog — deliberately a flat list, not grouped by any category.
const listAddOns = asyncHandler(async (req, res) => {
  const currency = (req.query.currency || "inr").toLowerCase();
  const addOns = await AddOn.find({ isActive: true }).sort({ sortOrder: 1 });
  res.status(200).json({ success: true, data: { addOns: addOns.map((a) => formatAddOn(a, currency)) } });
});

// GET /api/addons/my
// Every add-on the current user owns that's still in force — active
// lifetime add-ons (endDate null) or recurring ones not yet past endDate.
// Ownership and usability are separate: an add-on stays "owned" even if
// the user's plan lapses, but `usable` goes false until they're back on an
// active plan — add-ons only work on top of a plan, never on their own.
const myAddOns = asyncHandler(async (req, res) => {
  const [userAddOns, planActive] = await Promise.all([
    UserAddOn.find({
      user: req.user._id,
      status: "active",
      $or: [{ endDate: null }, { endDate: { $gt: new Date() } }],
    })
      .populate("addOn")
      .sort({ createdAt: -1 }),
    hasActivePlan(req.user._id),
  ]);

  const withUsability = userAddOns.map((ua) => ({ ...ua.toObject(), usable: planActive }));

  res.status(200).json({ success: true, data: { addOns: withUsability, planActive } });
});

// POST /api/addons/create-order
// body: { addOnId, currency: "inr"|"usd" }
// No proration/coupon/wallet stacking here on purpose — add-ons are sold
// standalone, independent of whatever plan the user is on.
const createAddonOrder = asyncHandler(async (req, res) => {
  const { addOnId, currency = "inr" } = req.body;
  const normalizedCurrency = currency.toLowerCase();

  if (!["inr", "usd"].includes(normalizedCurrency)) {
    throw new ApiError(400, "currency must be 'inr' or 'usd'");
  }

  const addOn = await AddOn.findById(addOnId);
  if (!addOn || !addOn.isActive) throw new ApiError(404, "Add-on not found");

  // Add-ons are sold on top of a plan, not instead of one — a Free-plan
  // user (or someone whose paid plan has lapsed) can't buy one until
  // they're on an active paid plan again.
  if (!(await hasActivePlan(req.user._id))) {
    throw new ApiError(403, "An active paid plan is required to purchase add-ons");
  }

  const amount = normalizedCurrency === "usd" ? addOn.price.usd : addOn.price.inr;
  if (!amount || amount <= 0) throw new ApiError(400, "This add-on has no payable price configured");

  const receipt = `addon_${req.user._id}_${Date.now()}`;

  const order = await razorpayService.createOrder({
    amount,
    currency: normalizedCurrency,
    receipt,
    notes: { userId: req.user._id.toString(), addOnId: addOn._id.toString() },
  });

  const userAddOn = await UserAddOn.create({
    user: req.user._id,
    addOn: addOn._id,
    source: "razorpay",
    currency: normalizedCurrency,
    amount,
    status: "created",
    razorpayOrderId: order.id,
    limit: addOn.limit,
  });

  res.status(201).json({
    success: true,
    data: {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      userAddOnId: userAddOn._id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    },
  });
});

// POST /api/addons/verify
// body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
const verifyAddonPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new ApiError(400, "Missing Razorpay payment details");
  }

  const isValid = razorpayService.verifyPaymentSignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });
  if (!isValid) throw new ApiError(400, "Payment signature verification failed");

  const userAddOn = await UserAddOn.findOne({
    razorpayOrderId: razorpay_order_id,
    user: req.user._id,
  }).populate("addOn");
  if (!userAddOn) throw new ApiError(404, "Add-on purchase record not found");

  userAddOn.status = "active";
  userAddOn.razorpayPaymentId = razorpay_payment_id;
  userAddOn.razorpaySignature = razorpay_signature;
  userAddOn.startDate = new Date();
  userAddOn.endDate =
    userAddOn.addOn.billingType === "recurring" ? addInterval(new Date(), userAddOn.addOn.interval) : null;
  await userAddOn.save();

  logger.info(`[addons] ${req.user._id} activated add-on ${userAddOn.addOn.slug}`);

  res.status(200).json({
    success: true,
    message: "Payment verified. Add-on activated.",
    data: { userAddOn },
  });
});

module.exports = { listAddOns, myAddOns, createAddonOrder, verifyAddonPayment };
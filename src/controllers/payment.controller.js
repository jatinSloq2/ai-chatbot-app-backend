const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");
const razorpayService = require("../services/razorpay.service");
const emailService = require("../services/email.service");
const billingService = require("../services/billing.service");

const addInterval = (date, interval) => {
  const d = new Date(date);
  if (interval === "year") d.setFullYear(d.getFullYear() + 1);
  else if (interval === "quarter") d.setMonth(d.getMonth() + 3);
  else d.setMonth(d.getMonth() + 1);
  return d;
};

// POST /api/payments/create-order
// body: { planId, currency: "inr"|"usd" }
const createOrder = asyncHandler(async (req, res) => {
  const { planId, currency = "inr" } = req.body;
  const normalizedCurrency = currency.toLowerCase();

  if (!["inr", "usd"].includes(normalizedCurrency)) {
    throw new ApiError(400, "currency must be 'inr' or 'usd'");
  }

  const plan = await Plan.findById(planId);
  if (!plan || !plan.isActive) throw new ApiError(404, "Plan not found");

  const fullPrice = normalizedCurrency === "usd" ? plan.price.usd : plan.price.inr;
  if (!fullPrice || fullPrice <= 0) {
    throw new ApiError(400, "This plan is free and does not require payment");
  }

  // Per-day proration against any existing active plan, plus a 10% discount
  // if this is a genuine upgrade (not a first-time purchase).
  const charge = await billingService.computeCharge({
    userId: req.user._id,
    newPlan: plan,
    currency: normalizedCurrency,
  });

  // Razorpay requires amount > 0; a fully-covered-by-credit upgrade still
  // needs a token minimum charge to go through checkout, or you'd activate
  // it directly without payment. We go with a ₹1 / $0.01 minimum here.
  const amountToCharge = Math.max(charge.chargeAmount, 100);

  const receipt = `sub_${req.user._id}_${Date.now()}`;

  const order = await razorpayService.createOrder({
    amount: amountToCharge,
    currency: normalizedCurrency,
    receipt,
    notes: { userId: req.user._id.toString(), planId: plan._id.toString() },
  });

  const subscription = await Subscription.create({
    user: req.user._id,
    plan: plan._id,
    currency: normalizedCurrency,
    amount: amountToCharge,
    status: "created",
    razorpayOrderId: order.id,
    isUpgrade: charge.isUpgrade,
    proratedCreditApplied: charge.proratedCredit,
    upgradeDiscountApplied: charge.discountApplied,
    listPrice: charge.listPrice,
  });

  res.status(201).json({
    success: true,
    data: {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      subscriptionId: subscription._id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID, // frontend needs this to open Razorpay checkout
      billingBreakdown: {
        listPrice: charge.listPrice,
        proratedCredit: charge.proratedCredit,
        upgradeDiscount: charge.discountApplied,
        isUpgrade: charge.isUpgrade,
        amountCharged: amountToCharge,
      },
    },
  });
});

// POST /api/payments/verify
// body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
const verifyPayment = asyncHandler(async (req, res) => {
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

  const subscription = await Subscription.findOne({
    razorpayOrderId: razorpay_order_id,
    user: req.user._id,
  }).populate("plan");

  if (!subscription) throw new ApiError(404, "Subscription record not found");

  // Expire any previous active subscription before activating the new one
  await Subscription.updateMany(
    { user: req.user._id, status: "active" },
    { status: "expired" }
  );

  subscription.status = "active";
  subscription.razorpayPaymentId = razorpay_payment_id;
  subscription.razorpaySignature = razorpay_signature;
  subscription.startDate = new Date();
  subscription.endDate = addInterval(new Date(), subscription.plan.interval);
  await subscription.save();

  const amountDisplay =
    subscription.currency === "usd"
      ? `$${(subscription.amount / 100).toFixed(2)}`
      : `₹${(subscription.amount / 100).toFixed(2)}`;

  emailService
    .sendPaymentSuccessEmail(req.user.email, {
      planName: subscription.plan.name,
      amountDisplay,
      endDate: subscription.endDate,
    })
    .catch((err) => console.error("Failed to send payment success email:", err.message));

  res.status(200).json({
    success: true,
    message: "Payment verified. Subscription activated.",
    data: { subscription },
  });
});

// POST /api/payments/webhook
// Razorpay server-to-server webhook (payment.captured, payment.failed, etc.)
// Requires express.raw() body parsing on this route specifically (configured in routes file)
const webhook = asyncHandler(async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const isValid = razorpayService.verifyWebhookSignature(req.body, signature);

  if (!isValid) {
    return res.status(400).json({ success: false, message: "Invalid webhook signature" });
  }

  const payload = JSON.parse(req.body.toString());
  const event = payload.event;

  if (event === "payment.failed") {
    const orderId = payload.payload?.payment?.entity?.order_id;
    if (orderId) {
      const subscription = await Subscription.findOneAndUpdate(
        { razorpayOrderId: orderId },
        { status: "failed" },
        { new: true }
      ).populate("plan").populate("user");
      if (subscription?.user?.email) {
        emailService
          .sendPaymentFailedEmail(subscription.user.email, { planName: subscription.plan.name })
          .catch((err) => console.error("Failed to send payment failed email:", err.message));
      }
    }
  }

  // payment.captured is already handled synchronously via /verify, but this
  // webhook acts as a reliable fallback in case the client never calls /verify
  // (e.g. browser closed mid-checkout).
  if (event === "payment.captured") {
    const orderId = payload.payload?.payment?.entity?.order_id;
    const paymentId = payload.payload?.payment?.entity?.id;
    if (orderId) {
      const subscription = await Subscription.findOne({ razorpayOrderId: orderId }).populate("plan");
      if (subscription && subscription.status !== "active") {
        subscription.status = "active";
        subscription.razorpayPaymentId = paymentId;
        subscription.startDate = new Date();
        subscription.endDate = addInterval(new Date(), subscription.plan.interval);
        await subscription.save();
      }
    }
  }

  res.status(200).json({ success: true });
});

// GET /api/payments/my-subscription
const mySubscription = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findOne({
    user: req.user._id,
    status: { $in: ["active", "cancelled"] },
    endDate: { $gt: new Date() },
  }).populate("plan");

  res.status(200).json({ success: true, data: { subscription: subscription || null } });
});

// POST /api/payments/cancel
// Does not refund — cancels auto-consideration for renewal. Access continues
// until the already-paid-for endDate, then the user drops to Free automatically
// via the expiry cron.
const cancelSubscription = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findOne({
    user: req.user._id,
    status: "active",
    endDate: { $gt: new Date() },
  });

  if (!subscription) throw new ApiError(404, "No active subscription to cancel");

  subscription.status = "cancelled";
  await subscription.save();

  res.status(200).json({
    success: true,
    message: `Subscription cancelled. You'll retain access until ${subscription.endDate.toDateString()}.`,
    data: { subscription },
  });
});

module.exports = { createOrder, verifyPayment, webhook, mySubscription, cancelSubscription };
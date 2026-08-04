const Razorpay = require("razorpay");
const crypto = require("crypto");
const ApiError = require("../utils/ApiError");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Creates a Razorpay order.
 * amount must be in the smallest currency unit (paise for INR, cents for USD).
 * currency: "INR" or "USD"
 *
 * NOTE: To accept USD, your Razorpay account needs international payments
 * enabled (Razorpay International / Payment Links support USD settlement
 * for eligible business accounts). If it's not enabled on your account yet,
 * default new users to INR and gate USD behind that account feature.
 */
const createOrder = async ({ amount, currency, receipt, notes }) => {
  try {
    const order = await razorpay.orders.create({
      amount,
      currency: currency.toUpperCase(),
      receipt,
      notes,
    });
    return order;
  } catch (err) {
    throw new ApiError(502, `Razorpay order creation failed: ${err.message || err.error?.description}`);
  }
};

// Verifies the signature Razorpay sends back after checkout completes
const verifyPaymentSignature = ({ orderId, paymentId, signature }) => {
  const generated = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return generated === signature;
};

// Verifies the signature on incoming webhook payloads
const verifyWebhookSignature = (rawBody, signature) => {
  const generated = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  return generated === signature;
};

module.exports = { razorpay, createOrder, verifyPaymentSignature, verifyWebhookSignature };

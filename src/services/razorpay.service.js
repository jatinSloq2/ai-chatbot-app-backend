const Razorpay = require("razorpay");
const crypto = require("crypto");
const ApiError = require("../utils/ApiError");

// Default client — platform subscription billing (plan purchases, wallet
// top-ups etc). Keeps using the platform's own Razorpay account via env vars,
// completely unchanged from before.
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// BYOK client — used for bot-level real payments (see botTools.service.js),
// where each bot owner connects their own Razorpay account (channel:
// "razorpay" credential) rather than money flowing through the platform's
// account. A fresh client per call is cheap — the SDK is a thin wrapper, no
// connection/session to hold open.
const getClient = (keyId, keySecret) => new Razorpay({ key_id: keyId, key_secret: keySecret });

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
const createOrder = async ({ amount, currency, receipt, notes, keyId, keySecret }) => {
  const client = keyId && keySecret ? getClient(keyId, keySecret) : razorpay;
  try {
    const order = await client.orders.create({
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
const verifyPaymentSignature = ({ orderId, paymentId, signature, keySecret }) => {
  const generated = crypto
    .createHmac("sha256", keySecret || process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return generated === signature;
};

// Verifies the signature on incoming webhook payloads
const verifyWebhookSignature = (rawBody, signature, webhookSecret) => {
  const generated = crypto
    .createHmac("sha256", webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  return generated === signature;
};

// ---------------------------------------------------------------------------
// Payment Links — what botTools.service.js#create_payment_link/verify_payment_status
// /initiate_refund actually use. A Payment Link is a hosted Razorpay checkout
// page (short_url) with no return-URL/webhook plumbing required just to take
// one payment: its `status` field ("created"/"paid"/"expired"/"cancelled")
// and, once paid, its `payments[]` array (containing the real
// razorpay_payment_id) are queryable any time via a plain fetch — which is
// what lets verify_payment_status work as a simple poll instead of needing a
// webhook receiver per bot owner's Razorpay account.
// ---------------------------------------------------------------------------

// amount in the smallest currency unit (paise for INR).
const createPaymentLink = async ({ keyId, keySecret, amount, currency = "INR", description, customer, notes, referenceId }) => {
  const client = getClient(keyId, keySecret);
  try {
    const link = await client.paymentLink.create({
      amount,
      currency: currency.toUpperCase(),
      description,
      customer: customer && (customer.name || customer.contact || customer.email) ? customer : undefined,
      notify: { sms: !!customer?.contact, email: !!customer?.email },
      notes,
      reference_id: referenceId,
    });
    return link; // { id, short_url, status, ... }
  } catch (err) {
    throw new ApiError(502, `Couldn't create Razorpay payment link: ${err.message || err.error?.description}`);
  }
};

const getPaymentLink = async ({ keyId, keySecret, paymentLinkId }) => {
  const client = getClient(keyId, keySecret);
  try {
    return await client.paymentLink.fetch(paymentLinkId); // includes .payments[] once paid
  } catch (err) {
    throw new ApiError(502, `Couldn't fetch Razorpay payment link: ${err.message || err.error?.description}`);
  }
};

// amount omitted = full refund. Amount, if given, is in the smallest
// currency unit, same as createOrder/createPaymentLink.
const refundPayment = async ({ keyId, keySecret, paymentId, amount, notes }) => {
  const client = getClient(keyId, keySecret);
  try {
    return await client.payments.refund(paymentId, { amount, notes, speed: "normal" });
  } catch (err) {
    throw new ApiError(502, `Razorpay refund failed: ${err.message || err.error?.description}`);
  }
};

module.exports = {
  razorpay,
  getClient,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  createPaymentLink,
  getPaymentLink,
  refundPayment,
};
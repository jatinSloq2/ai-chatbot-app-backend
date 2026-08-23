const express = require("express");
const router = express.Router();

const paymentController = require("../controllers/payment.controller");
const { protect } = require("../middlewares/auth.middleware");

router.use(protect);

/**
 * @openapi
 * tags:
 *   - name: Payments
 *     description: Razorpay order creation, verification, subscription management
 * components:
 *   schemas:
 *     CreateOrderRequest:
 *       type: object
 *       required: [planId]
 *       properties:
 *         planId: { type: string, description: "Plan._id to subscribe to" }
 *         currency: { type: string, enum: [inr, usd], example: inr, default: inr }
 *         couponCode: { type: string, example: "WELCOME20", description: "Optional discount coupon" }
 *         useWallet: { type: boolean, example: false, description: "Redeem wallet balance toward the order" }
 *     CreateOrderResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         data:
 *           type: object
 *           properties:
 *             orderId: { type: string, description: "Razorpay order id", example: order_AbCdEf123456 }
 *             amount: { type: integer, description: "Final amount in paise/cents (after proration, coupon, referral, wallet)", example: 39900 }
 *             currency: { type: string, example: INR }
 *             key: { type: string, description: "Razorpay public key for the checkout widget", example: rzp_test_xxxx }
 *             appliedCoupon: { type: string, nullable: true, example: WELCOME20 }
 *             walletAmountApplied: { type: integer, example: 0 }
 *             referralDiscountApplied: { type: integer, example: 0 }
 *             upgradeDiscount: { type: integer, example: 0 }
 *             proratedCredit: { type: integer, example: 0 }
 *     VerifyPaymentRequest:
 *       type: object
 *       required: [razorpay_order_id, razorpay_payment_id, razorpay_signature]
 *       properties:
 *         razorpay_order_id: { type: string }
 *         razorpay_payment_id: { type: string }
 *         razorpay_signature: { type: string }
 *     CancelSubscriptionRequest:
 *       type: object
 *       properties:
 *         reason: { type: string, example: "Too expensive" }
 */

/**
 * @openapi
 * /api/payments/create-order:
 *   post:
 *     tags: [Payments]
 *     summary: Create a Razorpay order for a plan purchase
 *     description: |
 *       Computes the charge with stacked discounts: per-day proration against any current
 *       subscription → upgrade discount → either a manual coupon OR the automatic referral
 *       offer → wallet redemption (last, capped by the balance in the chosen currency).
 *       Returns a Razorpay order that the client checkout widget consumes.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/CreateOrderRequest" }
 *     responses:
 *       200:
 *         description: Order created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/CreateOrderResponse" }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { description: Plan not found }
 */
router.post("/create-order", paymentController.createOrder);

/**
 * @openapi
 * /api/payments/verify:
 *   post:
 *     tags: [Payments]
 *     summary: Verify a Razorpay payment and activate the subscription
 *     description: |
 *       Called by the checkout widget after the user completes payment on Razorpay. Verifies
 *       the HMAC signature, then activates the Subscription record (recording the final
 *       amount charged and the discount stack that was applied).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/VerifyPaymentRequest" }
 *     responses:
 *       200:
 *         description: Subscription activated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     subscription: { $ref: "#/components/schemas/Subscription" }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       402:
 *         description: Signature verification failed
 *         content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } }
 */
router.post("/verify", paymentController.verifyPayment);

/**
 * @openapi
 * /api/payments/cancel:
 *   post:
 *     tags: [Payments]
 *     summary: Cancel auto-renew on the current subscription
 *     description: |
 *       Disables auto-renew. The subscription remains `active` until `endDate`; it then
 *       transitions to `cancelled` (no `expired` grace period).
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/CancelSubscriptionRequest" }
 *     responses:
 *       200: { description: Auto-renew disabled }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { description: No active subscription }
 */
router.post("/cancel", paymentController.cancelSubscription);

/**
 * @openapi
 * /api/payments/my-subscription:
 *   get:
 *     tags: [Payments]
 *     summary: Get the current user's active subscription
 *     responses:
 *       200:
 *         description: Current subscription
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     subscription: { $ref: "#/components/schemas/Subscription" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { description: No active subscription }
 */
router.get("/my-subscription", paymentController.mySubscription);

/**
 * @openapi
 * /api/payments/webhook:
 *   post:
 *     tags: [Payments]
 *     summary: Razorpay webhook (server-to-server)
 *     description: |
 *       Called by Razorpay to deliver async events (subscription.activated, payment.failed,
 *       etc.). Signature is verified against the `X-Razorpay-Signature` header using the
 *       webhook secret. Mounted before the global JSON parser to keep the raw body.
 *     security: []
 *     responses:
 *       200: { description: Event processed }
 *       400: { description: Invalid signature }
 */
module.exports = router;

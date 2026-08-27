const express = require("express");
const router = express.Router();

const addonController = require("../controllers/addon.controller");
const { protect } = require("../middlewares/auth.middleware");

/**
 * @openapi
 * tags:
 *   - name: AddOns
 *     description: |
 *       Purchasable add-ons sold alongside a plan (e.g. WhatsApp Inbox,
 *       message packs). Flat catalog — not grouped by category. This module
 *       only sells and tracks ownership; it does not implement what any
 *       add-on unlocks.
 */

/**
 * @openapi
 * /api/addons:
 *   get:
 *     tags: [AddOns]
 *     summary: List the add-on catalog
 *     description: Public endpoint — no auth required.
 *     security: []
 *     parameters:
 *       - in: query
 *         name: currency
 *         schema: { type: string, enum: [inr, usd], default: inr }
 *     responses:
 *       200: { description: Add-on catalog }
 */
router.get("/", addonController.listAddOns);

router.use(protect);

/**
 * @openapi
 * /api/addons/my:
 *   get:
 *     tags: [AddOns]
 *     summary: List the current user's active add-ons
 *     responses:
 *       200: { description: Owned add-ons }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/my", addonController.myAddOns);

/**
 * @openapi
 * /api/addons/create-order:
 *   post:
 *     tags: [AddOns]
 *     summary: Create a Razorpay order for an add-on purchase
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [addOnId]
 *             properties:
 *               addOnId: { type: string }
 *               currency: { type: string, enum: [inr, usd], default: inr }
 *     responses:
 *       201: { description: Order created }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { description: Add-on not found }
 */
router.post("/create-order", addonController.createAddonOrder);

/**
 * @openapi
 * /api/addons/verify:
 *   post:
 *     tags: [AddOns]
 *     summary: Verify a Razorpay payment and activate the add-on
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [razorpay_order_id, razorpay_payment_id, razorpay_signature]
 *             properties:
 *               razorpay_order_id: { type: string }
 *               razorpay_payment_id: { type: string }
 *               razorpay_signature: { type: string }
 *     responses:
 *       200: { description: Add-on activated }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { description: Purchase record not found }
 */
router.post("/verify", addonController.verifyAddonPayment);

module.exports = router;
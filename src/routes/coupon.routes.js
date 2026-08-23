const express = require("express");
const router = express.Router();

const couponController = require("../controllers/coupon.controller");
const { protect, requireAdmin } = require("../middlewares/auth.middleware");

/**
 * @openapi
 * tags:
 *   - name: Coupons
 *     description: Discount coupons (admin-managed, validated at checkout)
 * components:
 *   schemas:
 *     Coupon:
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         code: { type: string, example: WELCOME20 }
 *         type: { type: string, enum: [percent, fixed] }
 *         value: { type: integer, example: 20, description: "Percent (0-100) or paise/cents" }
 *         currency: { type: string, enum: [inr, usd, both] }
 *         maxRedemptions: { type: integer, nullable: true, example: 100 }
 *         redeemedCount: { type: integer, example: 12 }
 *         minPlanAmount: { type: integer, nullable: true, example: 99900 }
 *         applicablePlans:
 *           type: array
 *           items: { type: string, description: "Plan _id" }
 *         startsAt: { type: string, format: date-time, nullable: true }
 *         expiresAt: { type: string, format: date-time, nullable: true }
 *         isActive: { type: boolean, example: true }
 *     ValidateCouponRequest:
 *       type: object
 *       required: [code, planId, currency, chargeAmount]
 *       properties:
 *         code: { type: string, example: WELCOME20 }
 *         planId: { type: string }
 *         currency: { type: string, enum: [inr, usd] }
 *         chargeAmount: { type: integer, description: "Pre-discount charge amount in paise/cents" }
 *     CreateCouponRequest:
 *       type: object
 *       required: [code, type, value]
 *       properties:
 *         code: { type: string, example: LAUNCH50 }
 *         type: { type: string, enum: [percent, fixed] }
 *         value: { type: integer }
 *         currency: { type: string, enum: [inr, usd, both] }
 *         maxRedemptions: { type: integer }
 *         minPlanAmount: { type: integer }
 *         applicablePlans:
 *           type: array
 *           items: { type: string }
 *         startsAt: { type: string, format: date-time }
 *         expiresAt: { type: string, format: date-time }
 *     UpdateCouponRequest:
 *       type: object
 *       properties:
 *         type: { type: string, enum: [percent, fixed] }
 *         value: { type: integer }
 *         maxRedemptions: { type: integer }
 *         minPlanAmount: { type: integer }
 *         applicablePlans:
 *           type: array
 *           items: { type: string }
 *         startsAt: { type: string, format: date-time }
 *         expiresAt: { type: string, format: date-time }
 *         isActive: { type: boolean }
 */

router.use(protect);

// --- User-facing ---

/**
 * @openapi
 * /api/coupons/validate:
 *   post:
 *     tags: [Coupons]
 *     summary: Validate a coupon code at checkout
 *     description: |
 *       Returns the discount amount that would be applied for the given code, plan, currency
 *       and pre-discount charge. Does **not** redeem the coupon.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/ValidateCouponRequest" }
 *     responses:
 *       200:
 *         description: Coupon is valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     coupon: { $ref: "#/components/schemas/Coupon" }
 *                     discountAmount: { type: integer, example: 5000 }
 *       400: { description: Expired / not yet active / min amount not met / wrong currency }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { description: Coupon not found or inactive }
 *       409: { description: Redemption cap reached or not applicable to this plan }
 */
router.post("/validate", couponController.validateCoupon);

// --- Admin ---

/**
 * @openapi
 * /api/coupons/admin:
 *   get:
 *     tags: [Coupons]
 *     summary: List all coupons (admin)
 *     responses:
 *       200:
 *         description: Coupon list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/Coupon" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.get("/admin", requireAdmin, couponController.listCoupons);

/**
 * @openapi
 * /api/coupons/admin:
 *   post:
 *     tags: [Coupons]
 *     summary: Create a coupon (admin)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/CreateCouponRequest" }
 *     responses:
 *       201: { description: Coupon created }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 *       409: { description: Code already in use }
 */
router.post("/admin", requireAdmin, couponController.createCoupon);

/**
 * @openapi
 * /api/coupons/admin/{id}:
 *   patch:
 *     tags: [Coupons]
 *     summary: Update a coupon (admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/UpdateCouponRequest" }
 *     responses:
 *       200: { description: Updated }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 *       404: { $ref: "#/components/responses/NotFound" }
 *   delete:
 *     tags: [Coupons]
 *     summary: Delete a coupon (admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.patch("/admin/:id", requireAdmin, couponController.updateCoupon);
router.delete("/admin/:id", requireAdmin, couponController.deleteCoupon);

module.exports = router;

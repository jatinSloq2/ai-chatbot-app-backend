const express = require("express");
const router = express.Router();

const referralController = require("../controllers/referral.controller");
const { protect, requireAdmin } = require("../middlewares/auth.middleware");

/**
 * @openapi
 * tags:
 *   - name: Referrals
 *     description: Referral codes, applying a code, wallet credits, admin settings
 * components:
 *   schemas:
 *     ReferralOverview:
 *       type: object
 *       properties:
 *         code: { type: string, example: "JANE50" }
 *         referralCount: { type: integer, example: 4 }
 *         totalEarned:
 *           type: object
 *           properties:
 *             inr: { type: integer, example: 40000 }
 *             usd: { type: integer, example: 0 }
 *         pendingRewards: { type: integer, example: 1 }
 *     ApplyReferralRequest:
 *       type: object
 *       required: [code]
 *       properties:
 *         code: { type: string, example: JANE50 }
 *     ReferralSettings:
 *       type: object
 *       properties:
 *         enabled: { type: boolean, example: true }
 *         referrerReward:
 *           type: object
 *           properties:
 *             type: { type: string, enum: [percent, fixed] }
 *             value: { type: integer, example: 10 }
 *             currency: { type: string, enum: [inr, usd] }
 *         refereeDiscount:
 *           type: object
 *           properties:
 *             type: { type: string, enum: [percent, fixed] }
 *             value: { type: integer, example: 10 }
 *             currency: { type: string, enum: [inr, usd] }
 *     WalletTransaction:
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         user: { type: string }
 *         type: { type: string, enum: [credit, debit, refund, referral] }
 *         currency: { type: string, enum: [inr, usd] }
 *         amount: { type: integer, example: 5000 }
 *         description: { type: string }
 *         createdAt: { type: string, format: date-time }
 */

router.use(protect);

// --- User-facing ---

/**
 * @openapi
 * /api/referral/me:
 *   get:
 *     tags: [Referrals]
 *     summary: Get the current user's referral code + earnings summary
 *     responses:
 *       200:
 *         description: Referral overview
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     overview: { $ref: "#/components/schemas/ReferralOverview" }
 *                     wallet:
 *                       type: object
 *                       properties:
 *                         inr: { type: integer, example: 5000 }
 *                         usd: { type: integer, example: 0 }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/me", referralController.getMyReferralOverview);

/**
 * @openapi
 * /api/referral/apply:
 *   post:
 *     tags: [Referrals]
 *     summary: Apply a referral code during / after signup
 *     description: |
 *       One-shot — a user can only ever apply one referral code, and only if they have
 *       never had a paid subscription. Stacks with the automatic discount on the first
 *       paid plan purchase.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/ApplyReferralRequest" }
 *     responses:
 *       200: { description: Code applied }
 *       400: { description: Invalid / already used / not eligible }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { description: Code not found }
 */
router.post("/apply", referralController.applyReferralCode);

/**
 * @openapi
 * /api/referral/wallet/transactions:
 *   get:
 *     tags: [Referrals]
 *     summary: List this user's wallet credit/debit transactions
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Wallet transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/WalletTransaction" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/wallet/transactions", referralController.listWalletTransactions);

// --- Admin ---

/**
 * @openapi
 * /api/referral/admin/settings:
 *   get:
 *     tags: [Referrals]
 *     summary: Get the platform referral program settings (admin)
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     settings: { $ref: "#/components/schemas/ReferralSettings" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.get("/admin/settings", requireAdmin, referralController.getSettings);

/**
 * @openapi
 * /api/referral/admin/settings:
 *   put:
 *     tags: [Referrals]
 *     summary: Update the platform referral program settings (admin)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/ReferralSettings" }
 *     responses:
 *       200: { description: Settings saved }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.put("/admin/settings", requireAdmin, referralController.updateSettings);

/**
 * @openapi
 * /api/referral/admin/rewards:
 *   get:
 *     tags: [Referrals]
 *     summary: List every referral reward issued (admin)
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, paid, void] }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200: { description: Reward list }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.get("/admin/rewards", requireAdmin, referralController.listRewards);

module.exports = router;

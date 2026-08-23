const express = require("express");
const router = express.Router();

const dashboardController = require("../controllers/dashboard.controller");
const { protect } = require("../middlewares/auth.middleware");

/**
 * @openapi
 * tags:
 *   - name: Dashboard
 *     description: Aggregated summary for the home dashboard
 */

router.use(protect);

/**
 * @openapi
 * /api/dashboard/summary:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get aggregated dashboard summary
 *     description: |
 *       Returns the headline numbers for the home dashboard: plan, message-usage this
 *       month vs. limit, total bots, total conversations, total leads, and recent
 *       activity.
 *     responses:
 *       200:
 *         description: Dashboard summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     plan: { $ref: "#/components/schemas/Plan" }
 *                     usage:
 *                       type: object
 *                       properties:
 *                         messagesThisMonth: { type: integer, example: 4218 }
 *                         messagesLimit: { type: integer, example: 50000 }
 *                     counts:
 *                       type: object
 *                       properties:
 *                         bots: { type: integer, example: 4 }
 *                         conversations: { type: integer, example: 312 }
 *                         leads: { type: integer, example: 87 }
 *                     recentActivity:
 *                       type: array
 *                       items: { type: object }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/summary", dashboardController.getSummary);

module.exports = router;

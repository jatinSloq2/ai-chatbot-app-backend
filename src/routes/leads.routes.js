const express = require("express");
const router = express.Router();

const leadsController = require("../controllers/leads.controller");
const { protect } = require("../middlewares/auth.middleware");

/**
 * @openapi
 * tags:
 *   - name: Leads
 *     description: Leads captured by bots, aggregated across the owner's bots
 * components:
 *   schemas:
 *     Lead:
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         bot: { type: string, description: "Bot _id that captured this lead" }
 *         email: { type: string, format: email }
 *         name: { type: string }
 *         phone: { type: string, nullable: true }
 *         message: { type: string, nullable: true }
 *         sessionId: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 */

router.use(protect);

/**
 * @openapi
 * /api/leads:
 *   get:
 *     tags: [Leads]
 *     summary: List all leads across the owner's bots
 *     parameters:
 *       - in: query
 *         name: bot
 *         schema: { type: string, description: "Filter by bot _id" }
 *       - in: query
 *         name: search
 *         schema: { type: string, description: "Email / name contains..." }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Lead list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/Lead" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/", leadsController.listLeads);

/**
 * @openapi
 * /api/leads/{identifier}/conversations:
 *   get:
 *     tags: [Leads]
 *     summary: Get all conversations associated with a lead
 *     description: |
 *       `identifier` may be either the lead's `email` or its `_id`. Useful for joining
 *       lead contact info with the underlying chat transcripts.
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema: { type: string, description: "Lead _id or email address" }
 *     responses:
 *       200:
 *         description: Conversation list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/Conversation" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.get("/:identifier/conversations", leadsController.getLeadConversations);

module.exports = router;

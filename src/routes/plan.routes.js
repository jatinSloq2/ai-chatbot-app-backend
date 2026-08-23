const express = require("express");
const router = express.Router();
const planController = require("../controllers/plan.controller");

/**
 * @openapi
 * /api/plans:
 *   get:
 *     tags: [Plans]
 *     summary: List all available subscription plans
 *     description: |
 *       Public endpoint — no auth required. Returns every plan (Free / Starter / Pro) with
 *       pricing for both `inr` and `usd`, plan-level limits (max bots, documents, monthly
 *       messages), and the list of allowed LLM providers per plan.
 *     security: []
 *     responses:
 *       200:
 *         description: Plan list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/Plan" }
 */
router.get("/", planController.listPlans);

module.exports = router;

const express = require("express");
const router = express.Router();

const teamController = require("../controllers/team.controller");
const { protect } = require("../middlewares/auth.middleware");

/**
 * @openapi
 * tags:
 *   - name: Teams
 *     description: Owner-side management of agent teams (groups of agents)
 * components:
 *   schemas:
 *     Team:
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         owner: { type: string, description: "Customer _id" }
 *         name: { type: string, example: "Tier-1 Support" }
 *         description: { type: string, example: "Frontline human agents" }
 *         members:
 *           type: array
 *           items: { type: string, description: "Agent _id" }
 *         createdAt: { type: string, format: date-time }
 *     CreateTeamRequest:
 *       type: object
 *       required: [name]
 *       properties:
 *         name: { type: string }
 *         description: { type: string }
 *         members:
 *           type: array
 *           items: { type: string, description: "Agent _id" }
 *     UpdateTeamRequest:
 *       type: object
 *       properties:
 *         name: { type: string }
 *         description: { type: string }
 *     AddMemberRequest:
 *       type: object
 *       required: [agentId]
 *       properties:
 *         agentId: { type: string }
 */

router.use(protect);

/**
 * @openapi
 * /api/teams:
 *   post:
 *     tags: [Teams]
 *     summary: Create a team
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/CreateTeamRequest" }
 *     responses:
 *       201:
 *         description: Team created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     team: { $ref: "#/components/schemas/Team" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *   get:
 *     tags: [Teams]
 *     summary: List teams owned by the current user
 *     responses:
 *       200:
 *         description: Team list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/Team" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/", teamController.createTeam);
router.get("/", teamController.listTeams);

/**
 * @openapi
 * /api/teams/{id}:
 *   patch:
 *     tags: [Teams]
 *     summary: Update team name / description
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/UpdateTeamRequest" }
 *     responses:
 *       200: { description: Updated }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 *   delete:
 *     tags: [Teams]
 *     summary: Delete a team
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.patch("/:id", teamController.updateTeam);
router.delete("/:id", teamController.deleteTeam);

/**
 * @openapi
 * /api/teams/{id}/members:
 *   post:
 *     tags: [Teams]
 *     summary: Add an agent to a team
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/AddMemberRequest" }
 *     responses:
 *       200: { description: Agent added }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.post("/:id/members", teamController.addMember);

/**
 * @openapi
 * /api/teams/{id}/members/{agentId}:
 *   delete:
 *     tags: [Teams]
 *     summary: Remove an agent from a team
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Removed }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.delete("/:id/members/:agentId", teamController.removeMember);

module.exports = router;

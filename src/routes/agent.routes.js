const express = require("express");
const router = express.Router();

const agentController = require("../controllers/agent.controller");
const { protect } = require("../middlewares/auth.middleware");
const { avatarUpload } = require("../middlewares/upload.middleware");

/**
 * @openapi
 * tags:
 *   - name: Agents
 *     description: Owner-side management of human live-chat agents (dashboard JWT)
 * components:
 *   schemas:
 *     Agent:
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         owner: { type: string, description: "Customer (dashboard user) _id" }
 *         team: { type: string, nullable: true, description: "Team _id this agent belongs to" }
 *         name: { type: string, example: "Alex Kim" }
 *         email: { type: string, format: email, example: alex@team.example }
 *         role: { type: string, enum: [agent, team_lead], example: agent }
 *         status: { type: string, enum: [online, away, busy, offline], example: offline }
 *         avatarUrl: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *     CreateAgentRequest:
 *       type: object
 *       required: [name, email, password]
 *       properties:
 *         name: { type: string, example: "Alex Kim" }
 *         email: { type: string, format: email }
 *         password: { type: string, format: password, minLength: 8 }
 *         team: { type: string, description: "Optional team _id" }
 *         role: { type: string, enum: [agent, team_lead], example: agent }
 *     UpdateAgentRequest:
 *       type: object
 *       properties:
 *         name: { type: string }
 *         team: { type: string, nullable: true }
 *         role: { type: string, enum: [agent, team_lead] }
 *         password: { type: string, format: password, minLength: 8, description: "Reset the agent's login password" }
 */

router.use(protect);

/**
 * @openapi
 * /api/agents:
 *   post:
 *     tags: [Agents]
 *     summary: Create a new agent
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/CreateAgentRequest" }
 *     responses:
 *       201:
 *         description: Agent created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     agent: { $ref: "#/components/schemas/Agent" }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       409: { description: Email already in use }
 *   get:
 *     tags: [Agents]
 *     summary: List all agents owned by the current user
 *     parameters:
 *       - in: query
 *         name: team
 *         schema: { type: string, description: "Filter by team _id" }
 *     responses:
 *       200:
 *         description: Agent list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/Agent" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/", agentController.createAgent);
router.get("/", agentController.listAgents);

/**
 * @openapi
 * /api/agents/{id}:
 *   get:
 *     tags: [Agents]
 *     summary: Get one agent
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Agent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     agent: { $ref: "#/components/schemas/Agent" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 *   patch:
 *     tags: [Agents]
 *     summary: Update agent name / team / role / password
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/UpdateAgentRequest" }
 *     responses:
 *       200: { description: Updated }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 *   delete:
 *     tags: [Agents]
 *     summary: Delete an agent
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
router.get("/:id", agentController.getAgent);
router.patch("/:id", agentController.updateAgent);
router.delete("/:id", agentController.deleteAgent);

/**
 * @openapi
 * /api/agents/{id}/avatar:
 *   post:
 *     tags: [Agents]
 *     summary: Upload / replace an agent's avatar
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200: { description: Avatar uploaded }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.post("/:id/avatar", avatarUpload.single("file"), agentController.uploadAgentAvatar);

/**
 * @openapi
 * /api/agents/{id}/conversations:
 *   get:
 *     tags: [Agents]
 *     summary: Conversations currently assigned to this agent
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
router.get("/:id/conversations", agentController.listAgentConversations);

module.exports = router;

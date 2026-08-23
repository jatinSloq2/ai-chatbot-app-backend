const express = require("express");
const router = express.Router();

const agentAuthController = require("../controllers/agentAuth.controller");
const { protectAgent } = require("../middlewares/agentAuth.middleware");
const { mediaUpload, avatarUpload } = require("../middlewares/upload.middleware");

/**
 * @openapi
 * tags:
 *   - name: Agent Auth
 *     description: |
 *       Agent (live-chat sub-user) authentication and panel APIs. All endpoints below
 *       `agentAuthMiddleware` use a separate-scope agent JWT (cookie or bearer).
 * components:
 *   securitySchemes:
 *     agentCookieAuth:
 *       type: apiKey
 *       in: cookie
 *       name: agentAccessToken
 *     agentBearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     AgentLoginRequest:
 *       type: object
 *       required: [email, password]
 *       properties:
 *         email: { type: string, format: email }
 *         password: { type: string, format: password }
 *     AgentSession:
 *       type: object
 *       properties:
 *         success: { type: boolean }
 *         data:
 *           type: object
 *           properties:
 *             agent: { $ref: "#/components/schemas/Agent" }
 *             accessToken: { type: string }
 *             refreshToken: { type: string }
 *     AgentMessageRequest:
 *       type: object
 *       required: [content]
 *       properties:
 *         content: { type: string, example: "Hi! Let me help you with that." }
 *     Handover:
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         conversation: { type: string }
 *         bot: { type: string }
 *         status: { type: string, enum: [pending, assigned, active, resolved] }
 *         assignedAgent: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 */

/**
 * @openapi
 * /api/agent-auth/login:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Agent login (sets agent access + refresh cookies)
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/AgentLoginRequest" }
 *     responses:
 *       200:
 *         description: Logged in
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/AgentSession" }
 *       401: { description: Wrong credentials }
 */
router.post("/login", agentAuthController.login);

/**
 * @openapi
 * /api/agent-auth/refresh-token:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Issue a new agent access token using the agent refresh cookie
 *     security: []
 *     responses:
 *       200: { description: New access token }
 *       401: { description: Refresh token missing / revoked / expired }
 */
router.post("/refresh-token", agentAuthController.refreshToken);

// Everything below requires a valid agent session
router.use(protectAgent);

/**
 * @openapi
 * /api/agent-auth/logout:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Log out the agent
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     responses:
 *       200: { description: Logged out }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/logout", agentAuthController.logout);

/**
 * @openapi
 * /api/agent-auth/me:
 *   get:
 *     tags: [Agent Auth]
 *     summary: Get the currently logged-in agent
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     responses:
 *       200:
 *         description: Current agent
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/AgentSession" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/me", agentAuthController.getMe);

/**
 * @openapi
 * /api/agent-auth/me/avatar:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Upload / replace the agent's own avatar
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
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
 */
router.post("/me/avatar", avatarUpload.single("file"), agentAuthController.uploadMyAvatar);

/**
 * @openapi
 * /api/agent-auth/status:
 *   patch:
 *     tags: [Agent Auth]
 *     summary: Set the agent's own presence status
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [online, away, busy, offline] }
 *     responses:
 *       200: { description: Status updated }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.patch("/status", agentAuthController.setStatus);

/**
 * @openapi
 * /api/agent-auth/fcm-token:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Register a Firebase Cloud Messaging device token for push
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, description: "FCM device token" }
 *     responses:
 *       200: { description: Registered }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/fcm-token", agentAuthController.registerFcmToken);

/**
 * @openapi
 * /api/agent-auth/fcm-token:
 *   delete:
 *     tags: [Agent Auth]
 *     summary: Unregister a FCM device token
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200: { description: Unregistered }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.delete("/fcm-token", agentAuthController.removeFcmToken);

/**
 * @openapi
 * /api/agent-auth/notifications:
 *   get:
 *     tags: [Agent Auth]
 *     summary: List notifications for the current agent
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unreadOnly
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200: { description: Notification list }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/notifications", agentAuthController.listNotifications);

/**
 * @openapi
 * /api/agent-auth/notifications/read-all:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Mark every unread notification as read
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     responses:
 *       200: { description: All marked read }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/notifications/read-all", agentAuthController.markAllNotificationsRead);

/**
 * @openapi
 * /api/agent-auth/notifications/{id}/read:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Mark a single notification as read
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Marked read }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.post("/notifications/:id/read", agentAuthController.markNotificationRead);

/**
 * @openapi
 * /api/agent-auth/notifications/test:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Send a test push notification to the current agent's registered devices
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     responses:
 *       200: { description: Test sent }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/notifications/test", agentAuthController.sendTestNotification);

/**
 * @openapi
 * /api/agent-auth/handovers/pending:
 *   get:
 *     tags: [Agent Auth]
 *     summary: List handovers awaiting assignment (across this agent's customer)
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     responses:
 *       200:
 *         description: Pending handovers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/Handover" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/handovers/pending", agentAuthController.listPendingHandovers);

/**
 * @openapi
 * /api/agent-auth/handovers/assigned:
 *   get:
 *     tags: [Agent Auth]
 *     summary: Handovers currently assigned to this agent
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     responses:
 *       200:
 *         description: Assigned handovers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/Handover" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/handovers/assigned", agentAuthController.listMyHandovers);

/**
 * @openapi
 * /api/agent-auth/handovers/{conversationId}/accept:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Self-claim a pending handover
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Handover accepted, conversation assigned to this agent }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       409: { description: Already claimed by another agent }
 */
router.post("/handovers/:conversationId/accept", agentAuthController.acceptHandover);

/**
 * @openapi
 * /api/agent-auth/conversations/{conversationId}:
 *   get:
 *     tags: [Agent Auth]
 *     summary: Get a conversation this agent is assigned to
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Conversation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     conversation: { $ref: "#/components/schemas/Conversation" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.get("/conversations/:conversationId", agentAuthController.getMyConversation);

/**
 * @openapi
 * /api/agent-auth/conversations/{conversationId}/message:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Send an agent message in the conversation
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/AgentMessageRequest" }
 *     responses:
 *       200: { description: Message delivered }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.post("/conversations/:conversationId/message", agentAuthController.sendAgentMessage);

/**
 * @openapi
 * /api/agent-auth/conversations/{conversationId}/media:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Send media (image/file) in the conversation
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
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
 *       200: { description: Media sent }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.post(
  "/conversations/:conversationId/media",
  mediaUpload.single("file"),
  agentAuthController.sendAgentMedia
);

/**
 * @openapi
 * /api/agent-auth/conversations/{conversationId}/messages/{messageId}/retry:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Retry a previously failed outbound agent message
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Retry queued }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.post("/conversations/:conversationId/messages/:messageId/retry", agentAuthController.retryAgentMessage);

/**
 * @openapi
 * /api/agent-auth/conversations/{conversationId}/resolve:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Mark the conversation as resolved and trigger CSAT
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Resolved }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.post("/conversations/:conversationId/resolve", agentAuthController.resolveConversation);

/**
 * @openapi
 * /api/agent-auth/conversations/{conversationId}/transfer-candidates:
 *   get:
 *     tags: [Agent Auth]
 *     summary: List agents eligible to receive a transfer
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Eligible agents
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
router.get("/conversations/:conversationId/transfer-candidates", agentAuthController.listTransferCandidates);

/**
 * @openapi
 * /api/agent-auth/conversations/{conversationId}/transfer:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Transfer this conversation to another agent
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [toAgentId]
 *             properties:
 *               toAgentId: { type: string }
 *               note: { type: string, example: "Specialist needed for billing question" }
 *     responses:
 *       200: { description: Transferred }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.post("/conversations/:conversationId/transfer", agentAuthController.transferHandover);

/**
 * @openapi
 * /api/agent-auth/canned-responses:
 *   get:
 *     tags: [Agent Auth]
 *     summary: List canned responses (macros) the agent can send
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     responses:
 *       200:
 *         description: Canned responses
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/CannedResponse" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/canned-responses", agentAuthController.listCannedResponses);

/**
 * @openapi
 * /api/agent-auth/conversations/{conversationId}/canned-responses/{cannedId}/send:
 *   post:
 *     tags: [Agent Auth]
 *     summary: Send a canned response in the conversation
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: cannedId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Sent }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.post(
  "/conversations/:conversationId/canned-responses/:cannedId/send",
  agentAuthController.sendCannedResponse
);

/**
 * @openapi
 * /api/agent-auth/csat:
 *   get:
 *     tags: [Agent Auth]
 *     summary: This agent's own CSAT rating history
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200: { description: CSAT history }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/csat", agentAuthController.listMyRatings);

/**
 * @openapi
 * /api/agent-auth/stream:
 *   get:
 *     tags: [Agent Auth]
 *     summary: SSE stream of agent-side events (new handovers, messages, notifications)
 *     security:
 *       - agentCookieAuth: []
 *       - agentBearerAuth: []
 *     responses:
 *       200:
 *         description: SSE stream
 *         content: { text/event-stream: {} }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/stream", agentAuthController.stream);

module.exports = router;

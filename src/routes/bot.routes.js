const express = require("express");
const router = express.Router();

const botController = require("../controllers/bot.controller");
const conversationController = require("../controllers/conversation.controller");
const chatController = require("../controllers/chat.controller");
const analyticsController = require("../controllers/analytics.controller");
const { protect } = require("../middlewares/auth.middleware");
const { avatarUpload } = require("../middlewares/upload.middleware");

/**
 * @openapi
 * tags:
 *   - name: Bots
 *     description: Bot CRUD, API keys, model config, test chat (dashboard JWT)
 *   - name: Conversations
 *     description: Chat transcripts and handovers per bot
 * components:
 *   schemas:
 *     CreateBotRequest:
 *       type: object
 *       required: [name]
 *       properties:
 *         name: { type: string, example: "Support Bot" }
 *         systemPrompt: { type: string, example: "You are a helpful support assistant for our product." }
 *         allowedDomains:
 *           type: array
 *           items: { type: string }
 *           example: ["example.com", "www.example.com"]
 *     UpdateBotRequest:
 *       type: object
 *       properties:
 *         name: { type: string }
 *         systemPrompt: { type: string }
 *         allowedDomains: { type: array, items: { type: string } }
 *         isActive: { type: boolean }
 *         widget: { type: object, description: "Widget theme overrides (colors, position, greeting...)" }
 *     ModelConfigRequest:
 *       type: object
 *       required: [type, provider]
 *       properties:
 *         type: { type: string, enum: [llm, embedding] }
 *         provider: { type: string, enum: [ollama, openai, anthropic, google, groq, mistral] }
 *         model: { type: string, example: gpt-4o-mini }
 *         apiKey: { type: string, description: "BYOK key (encrypted at rest). Required for paid providers.", example: sk-... }
 *         confirmReembed:
 *           type: boolean
 *           description: "Required=true when changing embedding dimension with existing documents. Will re-embed everything in the background."
 *     BotCreatedResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         data:
 *           type: object
 *           properties:
 *             bot: { $ref: "#/components/schemas/Bot" }
 *             secretKey:
 *               type: string
 *               description: "Shown ONCE — store it securely. Use it as `Authorization: Bearer sk_…`."
 *               example: sk_a1b2c3d4e5f6
 *     TestChatRequest:
 *       type: object
 *       required: [message]
 *       properties:
 *         message: { type: string, example: "What is your refund policy?" }
 *         sessionId: { type: string, description: "Optional — reuse to keep context", example: sess_abc123 }
 */

router.use(protect);

/**
 * @openapi
 * /api/bots:
 *   post:
 *     tags: [Bots]
 *     summary: Create a new bot
 *     description: Returns the bot with its `publicKey` and the `secretKey` (shown **once** — store it securely).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/CreateBotRequest" }
 *     responses:
 *       201:
 *         description: Bot created
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/BotCreatedResponse" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403:
 *         description: Plan limit reached (e.g. Free capped at 1 bot)
 *         content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } }
 *   get:
 *     tags: [Bots]
 *     summary: List bots owned by the current user
 *     responses:
 *       200:
 *         description: Bot list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/Bot" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/", botController.createBot);
router.get("/", botController.listBots);

/**
 * @openapi
 * /api/bots/{id}:
 *   get:
 *     tags: [Bots]
 *     summary: Get one bot
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Bot }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 *       404: { $ref: "#/components/responses/NotFound" }
 *   patch:
 *     tags: [Bots]
 *     summary: Update bot name / prompt / widget / domains
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/UpdateBotRequest" }
 *     responses:
 *       200: { description: Updated }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 *       404: { $ref: "#/components/responses/NotFound" }
 *   delete:
 *     tags: [Bots]
 *     summary: Delete a bot (cascades to documents, chunks, conversations)
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
router.get("/:id", botController.getBot);
router.patch("/:id", botController.updateBot);

/**
 * @openapi
 * /api/bots/{id}/avatar:
 *   post:
 *     tags: [Bots]
 *     summary: Upload widget avatar for the bot
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
 *       200: { description: Uploaded }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.post("/:id/avatar", avatarUpload.single("file"), botController.uploadWidgetAvatar);

/**
 * @openapi
 * /api/bots/{id}/regenerate-key:
 *   post:
 *     tags: [Bots]
 *     summary: Rotate the bot's secret key
 *     description: The old secret key stops working immediately. The new one is returned once.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: New secret key
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     secretKey: { type: string, example: sk_newvalue... }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.post("/:id/regenerate-key", botController.regenerateKey);

/**
 * @openapi
 * /api/bots/{id}/model-config:
 *   post:
 *     tags: [Bots]
 *     summary: Set BYOK LLM or embedding provider/model
 *     description: |
 *       Switching embedding provider/model may change the vector dimension. If the bot already
 *       has documents and the new dimension differs, this returns **409**. Resend with
 *       `confirmReembed: true` to automatically re-embed every document under the new model
 *       in the background.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/ModelConfigRequest" }
 *     responses:
 *       200: { description: Config saved }
 *       409:
 *         description: Embedding dimension mismatch — resend with confirmReembed:true
 *         content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.post("/:id/model-config", botController.setModelConfig);

/**
 * @openapi
 * /api/bots/{id}/agent-config:
 *   post:
 *     tags: [Bots]
 *     summary: Configure human-handover behaviour for this bot
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean }
 *               intentTriggers: { type: array, items: { type: string }, example: ["talk to human", "speak to agent"] }
 *               assignmentStrategy: { type: string, enum: [round_robin, least_busy, manual] }
 *               idleTimeoutSec: { type: integer, example: 300 }
 *     responses:
 *       200: { description: Saved }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/:id/agent-config", botController.setAgentConfig);

/**
 * @openapi
 * /api/bots/{id}/business-hours:
 *   post:
 *     tags: [Bots]
 *     summary: Set business hours so the bot can hand off only when open
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               timezone: { type: string, example: Asia/Kolkata }
 *               schedule:
 *                 type: object
 *                 description: "Map of day → [{ start, end }]"
 *                 example: { monday: [{ start: "09:00", end: "18:00" }] }
 *               awayMessage: { type: string, example: "We're offline. Leave a message and we'll reply tomorrow." }
 *     responses:
 *       200: { description: Saved }
 */
router.post("/:id/business-hours", botController.setBusinessHours);

/**
 * @openapi
 * /api/bots/{id}/language-config:
 *   post:
 *     tags: [Bots]
 *     summary: Configure auto-detection / supported languages
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               defaultLocale: { type: string, example: en }
 *               supported: { type: array, items: { type: string }, example: ["en", "hi"] }
 *               autoDetect: { type: boolean, example: true }
 *     responses:
 *       200: { description: Saved }
 */
router.post("/:id/language-config", botController.setLanguageConfig);

/**
 * @openapi
 * /api/bots/{id}/whatsapp-channel:
 *   post:
 *     tags: [Bots]
 *     summary: Connect this bot to a WhatsApp Cloud API channel
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               credentialId: { type: string, description: "IntegrationCredential._id for the WA Business account" }
 *               phoneNumberId: { type: string }
 *               displayName: { type: string }
 *     responses:
 *       200: { description: Channel attached }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.post("/:id/whatsapp-channel", botController.setWhatsappChannel);

/**
 * @openapi
 * /api/bots/{id}/tools-config:
 *   post:
 *     tags: [Bots]
 *     summary: Enable / disable LLM tools for this bot
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: array
 *                 items: { type: string, enum: [send_email, create_lead, handover_to_agent, get_google_sheet_data, send_whatsapp_template] }
 *     responses:
 *       200: { description: Saved }
 */
router.post("/:id/tools-config", botController.setToolsConfig);

/**
 * @openapi
 * /api/bots/{id}/test-chat:
 *   post:
 *     tags: [Bots]
 *     summary: Owner-only streaming playground chat
 *     description: Runs the full RAG pipeline and streams the response **plus** the retrieved chunks with their similarity scores. Does **not** count against the plan's monthly message quota.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/TestChatRequest" }
 *     responses:
 *       200:
 *         description: "SSE stream (event: token, event: chunks, event: done)"
 *         content:
 *           text/event-stream: {}
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403: { $ref: "#/components/responses/Forbidden" }
 */
router.post("/:id/test-chat", chatController.testChat);

/**
 * @openapi
 * /api/bots/{id}/conversations:
 *   get:
 *     tags: [Conversations]
 *     summary: List conversations for this bot
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200: { description: Conversation list }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.get("/:id/conversations", conversationController.listConversations);

/**
 * @openapi
 * /api/bots/{id}/conversations/{sessionId}:
 *   get:
 *     tags: [Conversations]
 *     summary: Get a single conversation (full transcript)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Conversation
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/Conversation" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.get("/:id/conversations/:sessionId", conversationController.getConversation);

/**
 * @openapi
 * /api/bots/{id}/conversations/{sessionId}/handover:
 *   post:
 *     tags: [Conversations]
 *     summary: Force a handover from the dashboard
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Handover queued }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.post("/:id/conversations/:sessionId/handover", conversationController.requestConversationHandover);

/**
 * @openapi
 * /api/bots/{id}/analytics:
 *   get:
 *     tags: [Bots]
 *     summary: Analytics for one bot (messages, unique visitors, resolution rate)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: Analytics object }
 */
router.get("/:id/analytics", analyticsController.getBotAnalytics);

/**
 * @openapi
 * /api/bots/{id}/analytics/events:
 *   get:
 *     tags: [Bots]
 *     summary: Recent analytics events
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200: { description: Event list }
 */
router.get("/:id/analytics/events", analyticsController.getRecentEvents);

/**
 * @openapi
 * /api/bots/{id}/analytics/domains:
 *   get:
 *     tags: [Bots]
 *     summary: Per-domain breakdown of widget traffic
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Domain stats }
 */
router.get("/:id/analytics/domains", analyticsController.getBotDomains);

module.exports = router;

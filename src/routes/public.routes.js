const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const documentController = require("../controllers/document.controller");
const chatController = require("../controllers/chat.controller");
const widgetController = require("../controllers/widget.controller");
const leadController = require("../controllers/lead.controller");
const { requireBotSecretKey, requireBotPublicKey } = require("../middlewares/botAuth.middleware");
const { upload, mediaUpload } = require("../middlewares/upload.middleware");

// Open CORS for all widget-facing endpoints
const widgetCors = cors({
  origin: "*",
  credentials: false,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key", "Authorization"],
});

/**
 * @openapi
 * tags:
 *   - name: Public Developer API
 *     description: |
 *       Bot key-authenticated public developer API — the third-party surface of JestBot.
 *       Use the bot's **secret key** (sk_…) for data management (server-to-server),
 *       and the **public key** (pk_…) for chat / lead / widget calls (safe in browser JS).
 * components:
 *   schemas:
 *     AddDocumentTextRequest:
 *       type: object
 *       required: [sourceType, title, text]
 *       properties:
 *         sourceType: { type: string, enum: [text], example: text }
 *         title: { type: string, example: "Refund Policy" }
 *         text: { type: string, example: "We offer a 30-day refund..." }
 *     AddDocumentUrlRequest:
 *       type: object
 *       required: [sourceType, url]
 *       properties:
 *         sourceType: { type: string, enum: [url], example: url }
 *         url: { type: string, format: uri, example: "https://example.com/faq" }
 *     ChatRequest:
 *       type: object
 *       required: [message]
 *       properties:
 *         message: { type: string, example: "What's your refund policy?" }
 *         sessionId: { type: string, description: "Reuse an existing session to keep context", example: sess_abc123 }
 *         metadata: { type: object, description: "Free-form visitor metadata (page URL, referrer, etc.)" }
 *     LeadSubmitRequest:
 *       type: object
 *       required: [email]
 *       properties:
 *         email: { type: string, format: email, example: visitor@example.com }
 *         name: { type: string, example: "Visitor" }
 *         phone: { type: string, example: "+91-9999999999" }
 *         message: { type: string, example: "I have a question about my order" }
 *         sessionId: { type: string }
 *     CsatRequest:
 *       type: object
 *       required: [rating, sessionId]
 *       properties:
 *         sessionId: { type: string }
 *         rating: { type: integer, minimum: 1, maximum: 5, example: 5 }
 *         comment: { type: string }
 */

// --- Data management API (secret key, server-to-server) ---

/**
 * @openapi
 * /api/v1/documents:
 *   post:
 *     tags: [Public Developer API]
 *     summary: Add RAG data (text or URL)
 *     description: |
 *       Ingestion runs in the BullMQ worker — the API responds immediately with `status: "processing"`,
 *       flipping to `"ready"` once chunking + embedding completes.
 *     security:
 *       - botSecretKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - $ref: "#/components/schemas/AddDocumentTextRequest"
 *               - $ref: "#/components/schemas/AddDocumentUrlRequest"
 *           examples:
 *             text:
 *               summary: Add plain text
 *               value: { sourceType: "text", title: "Refund Policy", text: "We offer a 30-day refund..." }
 *             url:
 *               summary: Fetch + ingest a URL
 *               value: { sourceType: "url", url: "https://example.com/faq" }
 *     responses:
 *       201:
 *         description: Document queued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: "#/components/schemas/Document"
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403:
 *         description: Plan document limit reached
 *         content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } }
 *   get:
 *     tags: [Public Developer API]
 *     summary: List documents for this bot
 *     security:
 *       - botSecretKey: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Document list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/Document" }
 */
router.post("/documents", requireBotSecretKey, documentController.addDocument);

/**
 * @openapi
 * /api/v1/documents/upload:
 *   post:
 *     tags: [Public Developer API]
 *     summary: Add RAG data by uploading a file (PDF, DOCX, TXT, CSV, or MD)
 *     description: |
 *       Extracts text server-side (see `fileLoader.service.js`) and ingests it the same way as
 *       `POST /api/v1/documents` — the API responds immediately with `status: "processing"` and the
 *       BullMQ worker flips it to `"ready"` once chunking + embedding completes.
 *
 *       Allowed extensions: `pdf`, `docx`, `txt`, `csv`, `md`. Max file size: 15MB.
 *     security:
 *       - botSecretKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The document file to upload (field name must be "file").
 *               title:
 *                 type: string
 *                 description: Optional display title; defaults to the uploaded filename.
 *     responses:
 *       201:
 *         description: File received and queued for processing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string, example: "File received and is being processed (chunking + embedding in progress)" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     document: { $ref: "#/components/schemas/Document" }
 *       400:
 *         description: No file uploaded, unsupported file type, or no extractable text
 *         content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       403:
 *         description: Plan document limit reached
 *         content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } }
 */
router.post("/documents/upload", requireBotSecretKey, upload.single("file"), documentController.uploadDocument);
router.get("/documents", requireBotSecretKey, documentController.listDocuments);

/**
 * @openapi
 * /api/v1/documents/{id}:
 *   get:
 *     tags: [Public Developer API]
 *     summary: Get one document (includes the raw text)
 *     security: [{ botSecretKey: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Document }
 *       404: { $ref: "#/components/responses/NotFound" }
 *   put:
 *     tags: [Public Developer API]
 *     summary: Replace content, re-chunk, re-embed
 *     security: [{ botSecretKey: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - $ref: "#/components/schemas/AddDocumentTextRequest"
 *               - $ref: "#/components/schemas/AddDocumentUrlRequest"
 *     responses:
 *       200: { description: Updated, status flips back to processing }
 *       404: { $ref: "#/components/responses/NotFound" }
 *   delete:
 *     tags: [Public Developer API]
 *     summary: Delete a document and all its chunks
 *     security: [{ botSecretKey: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.get("/documents/:id", requireBotSecretKey, documentController.getDocument);
router.put("/documents/:id", requireBotSecretKey, documentController.updateDocument);
router.delete("/documents/:id", requireBotSecretKey, documentController.deleteDocument);

// --- Chat (public key, SSE streaming) ---
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const botChatLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.bot?._id?.toString() || req.ip,
});

/**
 * @openapi
 * /api/v1/chat:
 *   post:
 *     tags: [Public Developer API]
 *     summary: Streaming RAG chat (Server-Sent Events)
 *     description: |
 *       Streams the LLM response via SSE. First event is `session` (with the new sessionId),
 *       then many `token` events, then a final `done` event with the full response.
 *       CORS is open (`*`) so the widget can be embedded on any third-party site.
 *     security:
 *       - botPublicKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/ChatRequest" }
 *     responses:
 *       200:
 *         description: SSE stream
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               example: |
 *                 event: session
 *                 data: {"sessionId":"sess_abc123"}
 *
 *                 event: token
 *                 data: {"token":"We "}
 *
 *                 event: token
 *                 data: {"token":"offer "}
 *
 *                 event: done
 *                 data: {"fullResponse":"We offer a 30-day refund..."}
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       429: { $ref: "#/components/responses/TooManyRequests" }
 *       403:
 *         description: Plan monthly message limit reached
 *         content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } }
 */
router.options("/chat", widgetCors);
router.post("/chat", widgetCors, chatLimiter, requireBotPublicKey, botChatLimiter, chatController.chat);

/**
 * @openapi
 * /api/v1/chat/request-handover:
 *   post:
 *     tags: [Public Developer API]
 *     summary: Visitor-initiated handover request (e.g. "talk to human")
 *     security: [{ botPublicKey: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sessionId: { type: string }
 *     responses:
 *       200: { description: Handover queued }
 */
router.options("/chat/request-handover", widgetCors);
router.post("/chat/request-handover", widgetCors, chatLimiter, requireBotPublicKey, chatController.requestHandover);

/**
 * @openapi
 * /api/v1/chat/poll:
 *   get:
 *     tags: [Public Developer API]
 *     summary: Long-poll for the latest agent reply (used as an SSE fallback)
 *     security: [{ botPublicKey: [] }]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Latest messages + handover state }
 */
router.options("/chat/poll", widgetCors);
router.get("/chat/poll", widgetCors, requireBotPublicKey, chatController.pollChat);

/**
 * @openapi
 * /api/v1/chat/stream:
 *   get:
 *     tags: [Public Developer API]
 *     summary: SSE stream of agent messages for a session
 *     security: [{ botPublicKey: [] }]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: SSE stream
 *         content: { text/event-stream: {} }
 */
router.options("/chat/stream", widgetCors);
router.get("/chat/stream", widgetCors, requireBotPublicKey, chatController.streamChat);

/**
 * @openapi
 * /api/v1/chat/media:
 *   post:
 *     tags: [Public Developer API]
 *     summary: Upload media from the visitor (only allowed once an agent has joined)
 *     security: [{ botPublicKey: [] }]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *               sessionId: { type: string }
 *     responses:
 *       200: { description: Media uploaded }
 *       403: { description: Not allowed before an agent joins }
 */
router.options("/chat/media", widgetCors);
router.post(
  "/chat/media",
  widgetCors,
  chatLimiter,
  requireBotPublicKey,
  mediaUpload.single("file"),
  chatController.uploadVisitorMedia
);

/**
 * @openapi
 * /api/v1/chat/csat:
 *   post:
 *     tags: [Public Developer API]
 *     summary: Submit CSAT rating after an agent resolves the chat
 *     security: [{ botPublicKey: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/CsatRequest" }
 *     responses:
 *       200: { description: CSAT saved }
 *       409: { description: Already rated }
 */
router.options("/chat/csat", widgetCors);
router.post("/chat/csat", widgetCors, chatLimiter, requireBotPublicKey, chatController.submitCsat);

// --- Lead capture (public key, called by widget pre-chat form) ---
const leadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

/**
 * @openapi
 * /api/v1/lead/submit:
 *   post:
 *     tags: [Public Developer API]
 *     summary: Submit a lead from the widget pre-chat form
 *     security: [{ botPublicKey: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/LeadSubmitRequest" }
 *     responses:
 *       200: { description: Lead captured }
 *       429: { $ref: "#/components/responses/TooManyRequests" }
 */
router.options("/lead/submit", widgetCors);
router.post("/lead/submit", widgetCors, leadLimiter, requireBotPublicKey, leadController.submitLead);

/**
 * @openapi
 * /api/v1/lead/send-otp:
 *   post:
 *     tags: [Public Developer API]
 *     summary: Send a verification OTP to a lead's email before persisting the lead
 *     security: [{ botPublicKey: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: OTP sent }
 */
router.options("/lead/send-otp", widgetCors);
router.post("/lead/send-otp", widgetCors, leadLimiter, requireBotPublicKey, leadController.sendLeadOtp);

/**
 * @openapi
 * /api/v1/lead/verify-otp:
 *   post:
 *     tags: [Public Developer API]
 *     summary: Verify a lead's email via OTP
 *     security: [{ botPublicKey: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string, format: email }
 *               otp: { type: string }
 *     responses:
 *       200: { description: Verified }
 *       401: { description: Invalid / expired OTP }
 */
router.options("/lead/verify-otp", widgetCors);
router.post("/lead/verify-otp", widgetCors, leadLimiter, requireBotPublicKey, leadController.verifyLeadOtp);

/**
 * @openapi
 * /api/v1/widget/config:
 *   get:
 *     tags: [Public Developer API]
 *     summary: Widget runtime config (theme, greeting, allowed tools, business hours, etc.)
 *     security: [{ botPublicKey: [] }]
 *     responses:
 *       200:
 *         description: Widget config
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   example: {
 *                     "theme": { "primaryColor": "#5b6cff" },
 *                     "greeting": "Hi! How can I help?",
 *                     "tools": ["handover_to_agent"],
 *                     "businessHours": { "enabled": true }
 *                   }
 */
router.options("/widget/config", widgetCors);
router.get("/widget/config", widgetCors, requireBotPublicKey, widgetController.getWidgetConfig);

module.exports = router;
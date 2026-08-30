const express = require("express");
const router = express.Router();

const credentialController = require("../controllers/integrationCredential.controller");
const whatsappEmbeddedSignupController = require("../controllers/whatsappEmbeddedSignup.controller");
const { protect } = require("../middlewares/auth.middleware");

/**
 * @openapi
 * tags:
 *   - name: Integrations
 *     description: |
 *       Per-tenant credentials for third-party services (SMTP, WhatsApp, SMS, AI, Google
 *       Sheets, Razorpay). OAuth email credentials are created via the real OAuth flow in
 *       `routes/oauth.routes.js` and do **not** have a manual "paste a token" endpoint.
 * components:
 *   schemas:
 *     IntegrationCredential:
 *       type: object
 *       properties:
 *         _id: { type: string }
 *         owner: { type: string, description: "Customer _id" }
 *         type: { type: string, enum: [email_smtp, email_api, email_oauth, whatsapp, sms, ai_provider, google_sheets, razorpay] }
 *         label: { type: string, example: "Primary Gmail" }
 *         isDefault: { type: boolean, example: false }
 *         isConnected: { type: boolean, example: true, description: "Last health check passed" }
 *         lastTestedAt: { type: string, format: date-time, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *     EmailSmtpRequest:
 *       type: object
 *       required: [label, host, port, username, password, fromEmail]
 *       properties:
 *         label: { type: string, example: "Primary SMTP" }
 *         host: { type: string, example: smtp.gmail.com }
 *         port: { type: integer, example: 587 }
 *         secure: { type: boolean, example: false }
 *         username: { type: string }
 *         password: { type: string, format: password }
 *         fromEmail: { type: string, format: email }
 *         fromName: { type: string, example: "Acme Support" }
 *     EmailApiRequest:
 *       type: object
 *       required: [label, provider, apiKey, fromEmail]
 *       properties:
 *         label: { type: string }
 *         provider: { type: string, enum: [sendgrid, mailgun, brevo, postmark, resend] }
 *         apiKey: { type: string, format: password }
 *         fromEmail: { type: string, format: email }
 *         fromName: { type: string }
 *     WhatsappRequest:
 *       type: object
 *       required: [label, phoneNumberId, businessAccountId, accessToken]
 *       properties:
 *         label: { type: string }
 *         phoneNumberId: { type: string }
 *         businessAccountId: { type: string }
 *         accessToken: { type: string, format: password, description: "System user / permanent access token" }
 *         webhookVerifyToken: { type: string }
 *     SmsRequest:
 *       type: object
 *       required: [label, provider, apiKey, fromNumber]
 *       properties:
 *         label: { type: string }
 *         provider: { type: string, enum: [twilio, msg91, plivo, textlocal] }
 *         apiKey: { type: string, format: password }
 *         apiSecret: { type: string, format: password }
 *         fromNumber: { type: string, example: "+919999999999" }
 *     AiProviderRequest:
 *       type: object
 *       required: [label, provider, apiKey]
 *       properties:
 *         label: { type: string, example: "OpenAI BYOK" }
 *         provider: { type: string, enum: [openai, anthropic, google, groq, mistral, cohere, ollama] }
 *         apiKey: { type: string, format: password }
 *         baseUrl: { type: string, nullable: true, description: "Override the provider base URL" }
 *     GoogleSheetsRequest:
 *       type: object
 *       required: [label, refreshToken, clientId, clientSecret, spreadsheetId]
 *       properties:
 *         label: { type: string }
 *         refreshToken: { type: string }
 *         clientId: { type: string }
 *         clientSecret: { type: string, format: password }
 *         spreadsheetId: { type: string }
 *     RazorpayRequest:
 *       type: object
 *       required: [label, keyId, keySecret]
 *       properties:
 *         label: { type: string }
 *         keyId: { type: string, example: rzp_test_xxxx }
 *         keySecret: { type: string, format: password }
 *         webhookSecret: { type: string, format: password }
 *     MeetingSchedulingRequest:
 *       type: object
 *       description: |
 *         Google Meet is NOT created via this endpoint — it's populated automatically by the
 *         shared "Connect Google" OAuth flow (`routes/oauth.routes.js`), same as Email/Sheets.
 *         Use this endpoint for cal_com or calendly only.
 *       required: [provider]
 *       properties:
 *         label: { type: string }
 *         provider: { type: string, enum: [cal_com, calendly] }
 *         apiKey: { type: string, format: password, description: "cal_com only" }
 *         baseUrl: { type: string, description: "cal_com only, defaults to https://api.cal.com" }
 *         username: { type: string, description: "cal_com only — cal.com/<username>" }
 *         apiToken: { type: string, format: password, description: "calendly only — Personal Access Token" }
 *         schedulingBaseUrl: { type: string, description: "calendly only, e.g. https://calendly.com/your-handle" }
 *     UpdateCredentialRequest:
 *       type: object
 *       description: "Patch any subset of the credential's fields."
 *     CreateSheetRequest:
 *       type: object
 *       required: [title]
 *       properties:
 *         title: { type: string, example: "Q1 Leads" }
 *     AttachSheetRequest:
 *       type: object
 *       required: [spreadsheetId]
 *       properties:
 *         spreadsheetId: { type: string }
 *         title: { type: string, description: "Optional display name" }
 *     RenameSheetRequest:
 *       type: object
 *       required: [title]
 *       properties:
 *         title: { type: string }
 */

router.use(protect);

/**
 * @openapi
 * /api/credentials:
 *   get:
 *     tags: [Integrations]
 *     summary: List all integration credentials owned by the current user
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string, description: "Filter by credential type" }
 *     responses:
 *       200:
 *         description: Credential list (secrets are redacted)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/IntegrationCredential" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
/**
 * @openapi
 * /api/credentials/whatsapp/embedded-signup/config:
 *   get:
 *     tags: [Integrations]
 *     summary: Public config for booting the WhatsApp Embedded Signup popup (Meta App ID + login config id)
 *     responses:
 *       200: { description: Config }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 * /api/credentials/whatsapp/embedded-signup/exchange:
 *   post:
 *     tags: [Integrations]
 *     summary: Complete WhatsApp Embedded Signup — exchange the popup's code for a token and create the credential
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, wabaId, phoneNumberId]
 *             properties:
 *               code: { type: string }
 *               wabaId: { type: string }
 *               phoneNumberId: { type: string }
 *               businessId: { type: string }
 *               label: { type: string }
 *               isDefault: { type: boolean }
 *     responses:
 *       201: { description: Created }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 * NOTE: these two must be registered before GET/PATCH/DELETE "/:id" below,
 * or Express would match "embedded-signup" itself as an :id.
 */
router.get("/whatsapp/embedded-signup/config", whatsappEmbeddedSignupController.getEmbeddedSignupConfig);
router.post("/whatsapp/embedded-signup/exchange", whatsappEmbeddedSignupController.exchangeEmbeddedSignup);

/**
 * @openapi
 * /api/credentials/whatsapp/{id}/inbox-sso:
 *   get:
 *     tags: [Integrations]
 *     summary: Get a one-time signed SSO redirect URL into the separately-hosted Inbox platform, scoped to this WhatsApp number
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ redirectUrl }" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 * Also registered before "/:id" for the same reason as above.
 */
router.get("/whatsapp/:id/inbox-sso", whatsappEmbeddedSignupController.getInboxSsoRedirect);

router.get("/", credentialController.listCredentials);

/**
 * @openapi
 * /api/credentials/{id}:
 *   get:
 *     tags: [Integrations]
 *     summary: Get a single integration credential (secrets redacted)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Credential
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     credential: { $ref: "#/components/schemas/IntegrationCredential" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 *   patch:
 *     tags: [Integrations]
 *     summary: Update credential fields
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/UpdateCredentialRequest" }
 *     responses:
 *       200: { description: Updated }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 *   delete:
 *     tags: [Integrations]
 *     summary: Delete a credential
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
router.get("/:id", credentialController.getCredential);
router.patch("/:id", credentialController.updateCredential);
router.delete("/:id", credentialController.deleteCredential);

/**
 * @openapi
 * /api/credentials/email/smtp:
 *   post:
 *     tags: [Integrations]
 *     summary: Create an SMTP email credential
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/EmailSmtpRequest" }
 *     responses:
 *       201: { description: Created }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/email/smtp", credentialController.createEmailSmtp);

/**
 * @openapi
 * /api/credentials/email/api:
 *   post:
 *     tags: [Integrations]
 *     summary: Create an API-based email credential (SendGrid / Mailgun / Brevo / etc.)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/EmailApiRequest" }
 *     responses:
 *       201: { description: Created }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/email/api", credentialController.createEmailApi);

/**
 * @openapi
 * /api/credentials/whatsapp:
 *   post:
 *     tags: [Integrations]
 *     summary: Create a WhatsApp Cloud API credential
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/WhatsappRequest" }
 *     responses:
 *       201: { description: Created }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/whatsapp", credentialController.createWhatsapp);

/**
 * @openapi
 * /api/credentials/sms:
 *   post:
 *     tags: [Integrations]
 *     summary: Create an SMS credential
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/SmsRequest" }
 *     responses:
 *       201: { description: Created }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/sms", credentialController.createSms);

/**
 * @openapi
 * /api/credentials/ai-provider:
 *   post:
 *     tags: [Integrations]
 *     summary: Create a BYOK AI provider credential
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/AiProviderRequest" }
 *     responses:
 *       201: { description: Created }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/ai-provider", credentialController.createAiProvider);

/**
 * @openapi
 * /api/credentials/google-sheets:
 *   post:
 *     tags: [Integrations]
 *     summary: Create a Google Sheets credential using a service-account or OAuth refresh token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/GoogleSheetsRequest" }
 *     responses:
 *       201: { description: Created }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/google-sheets", credentialController.createGoogleSheets);

/**
 * @openapi
 * /api/credentials/google-sheets/{id}/create-sheet:
 *   post:
 *     tags: [Integrations]
 *     summary: Create a new tab in the spreadsheet owned by this credential
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/CreateSheetRequest" }
 *     responses:
 *       200: { description: Sheet tab created }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.post("/google-sheets/:id/create-sheet", credentialController.createSheetForCredential);

/**
 * @openapi
 * /api/credentials/google-sheets/{id}/attach-sheet:
 *   post:
 *     tags: [Integrations]
 *     summary: Attach an existing spreadsheet (by ID) to this credential
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/AttachSheetRequest" }
 *     responses:
 *       200: { description: Attached }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.post("/google-sheets/:id/attach-sheet", credentialController.attachSheetForCredential);

/**
 * @openapi
 * /api/credentials/google-sheets/{id}/sheets/{sheetId}:
 *   patch:
 *     tags: [Integrations]
 *     summary: Rename a tab in the attached spreadsheet
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: sheetId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/RenameSheetRequest" }
 *     responses:
 *       200: { description: Renamed }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 *   delete:
 *     tags: [Integrations]
 *     summary: Delete a tab in the attached spreadsheet
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: sheetId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Tab deleted }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.patch("/google-sheets/:id/sheets/:sheetId", credentialController.renameSheetForCredential);
router.delete("/google-sheets/:id/sheets/:sheetId", credentialController.removeSheetForCredential);

/**
 * @openapi
 * /api/credentials/razorpay:
 *   post:
 *     tags: [Integrations]
 *     summary: Create a Razorpay credential (used as the merchant account for this customer's subscription billing)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/RazorpayRequest" }
 *     responses:
 *       201: { description: Created }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/razorpay", credentialController.createRazorpay);

/**
 * @openapi
 * /api/credentials/meeting-scheduling:
 *   post:
 *     tags: [Integrations]
 *     summary: Connect a meeting-scheduling provider for 1-on-1 bookings (cal_com or calendly — Google Meet connects via OAuth instead)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/MeetingSchedulingRequest" }
 *     responses:
 *       201: { description: Created }
 *       400: { $ref: "#/components/responses/ValidationError" }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 */
router.post("/meeting-scheduling", credentialController.createMeetingScheduling);

/**
 * @openapi
 * /api/credentials/{id}/set-default:
 *   patch:
 *     tags: [Integrations]
 *     summary: Mark a credential as the default for its type
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Marked as default }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 */
router.patch("/:id/set-default", credentialController.setDefault);

/**
 * @openapi
 * /api/credentials/{id}/test:
 *   post:
 *     tags: [Integrations]
 *     summary: Test that the credential still works (e.g. send a test email / WhatsApp message / API call)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Connection OK }
 *       401: { $ref: "#/components/responses/Unauthorized" }
 *       404: { $ref: "#/components/responses/NotFound" }
 *       502: { description: Upstream connection failed }
 */
router.post("/:id/test", credentialController.testConnection);

module.exports = router;
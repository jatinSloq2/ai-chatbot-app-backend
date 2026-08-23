const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const whatsappController = require("./controllers/whatsapp.controller")
const { MEDIA_ROOT, PUBLIC_PREFIX, STATIC_ASSETS_DIR, STATIC_PREFIX } = require("./services/storage.service");

const routes = require("./routes");
const { notFound, errorHandler } = require("./middlewares/error.middleware");
const paymentController = require("./controllers/payment.controller");
const widgetController = require("./controllers/widget.controller");
const swaggerSpec = require("./config/swagger");

const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
    contentSecurityPolicy: false,
  })
);

const DASHBOARD_ORIGIN = process.env.CLIENT_URL || "http://localhost:3000";

// Smart CORS — checks the path and applies the right policy per request
// instead of setting one global policy that conflicts with widget routes.
app.use((req, res, next) => {
  const isWidgetRoute =
    req.path === "/widget.js" ||
    req.path.startsWith("/api/v1/chat") ||
    req.path.startsWith("/api/v1/widget") ||
    req.path.startsWith("/api/v1/lead");

  if (isWidgetRoute) {
    // Widget routes: open to any origin, no cookies
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
  } else {
    // Dashboard routes: locked to your frontend origin, with cookies
    const origin = req.headers.origin;
    if (origin === DASHBOARD_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", DASHBOARD_ORIGIN);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
  }

  next();
});

app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  paymentController.webhook
);

/**
 * @openapi
 * /api/payments/webhook:
 *   post:
 *     tags: [Payments]
 *     summary: Razorpay webhook (server-to-server)
 *     description: |
 *       Called by Razorpay to deliver async events (subscription.activated, payment.failed,
 *       etc.). Signature is verified against the `X-Razorpay-Signature` header using the
 *       webhook secret. Mounted before the global JSON parser to keep the raw body.
 *     security: []
 *     responses:
 *       200: { description: Event processed }
 *       400: { description: Invalid signature }
 */

// --- WhatsApp Cloud API webhook ---
// GET: Meta's one-time verification handshake (query params only, no body).
// POST: actual message/status events — needs the RAW body for HMAC
// signature verification, same reasoning as the Razorpay webhook above, so
// this is mounted here too, before the global express.json() below strips
// that away.
/**
 * @openapi
 * /api/whatsapp/webhook:
 *   get:
 *     tags: [WhatsApp]
 *     summary: Meta verification handshake for the WhatsApp webhook
 *     description: |
 *       One-time URL verification — Meta calls this with `hub.mode=subscribe`,
 *       `hub.verify_token`, and `hub.challenge` after you register the webhook URL in
 *       the Meta developer console. The handler returns the `hub.challenge` if the
 *       verify token matches.
 *     security: []
 *     parameters:
 *       - in: query
 *         name: hub.mode
 *         schema: { type: string, example: subscribe }
 *       - in: query
 *         name: hub.verify_token
 *         schema: { type: string }
 *       - in: query
 *         name: hub.challenge
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Returns the `hub.challenge` text/plain
 *         content:
 *           text/plain:
 *             schema: { type: string }
 *       403: { description: Verify token mismatch }
 *   post:
 *     tags: [WhatsApp]
 *     summary: Inbound WhatsApp message / status events (Meta → us)
 *     description: |
 *       Server-to-server webhook from Meta. HMAC signature is verified against the
 *       `X-Hub-Signature-256` header using the credential's `appSecret`. Raw body is
 *       preserved by mounting `express.raw` before the global JSON parser.
 *     security: []
 *     responses:
 *       200: { description: Event acknowledged }
 *       401: { description: Invalid signature }
 */
app.get("/api/whatsapp/webhook", whatsappController.verifyWebhook);
app.post(
  "/api/whatsapp/webhook",
  express.raw({ type: "application/json" }),
  whatsappController.receiveWebhook
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

const globalLimiter = rateLimit({
  windowMs: (Number(process.env.RATE_LIMIT_WINDOW_MIN) || 15) * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 1000,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

app.get("/health", (req, res) => {
  res.status(200).json({ success: true, message: "Server is healthy" });
});

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Liveness probe
 *     description: |
 *       Cheap, unauthenticated endpoint used by load balancers / uptime monitors to check
 *       that the process is up and the HTTP stack is responding.
 *     security: []
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Server is healthy" }
 */

// --- Swagger / OpenAPI ---
// Mounted under /api so it lives next to the documented routes. The raw spec
// is served at /api/docs.json so Postman / Insomnia / external doc tools
// can import it without going through the UI.
app.get("/api/docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: "JestBot API Docs",
    swaggerOptions: { persistAuthorization: true },
  })
);

app.get("/widget.js", widgetController.serveWidgetScript);

// Chat/canned-response media (uploaded via storage.service.js) — served
// statically, open CORS since the embedded widget can be on any origin.
// URLs already contain a random, unguessable filename component, and
// nothing sensitive (documents, secrets) is ever written under this root.
app.use(
  PUBLIC_PREFIX,
  (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(MEDIA_ROOT)
);

app.use(
  STATIC_PREFIX,
  (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    next();
  },
  express.static(STATIC_ASSETS_DIR)
);

app.get("/favicon.ico", (req, res) => res.redirect(301, "/assets/favicon.ico"));
app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
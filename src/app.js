const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const routes = require("./routes");
const { notFound, errorHandler } = require("./middlewares/error.middleware");
const paymentController = require("./controllers/payment.controller");
const widgetController = require("./controllers/widget.controller");

const app = express();

// --- Helmet (relaxed for widget delivery) ---
// The widget.js script and /api/v1/chat SSE are consumed by third-party sites,
// so we cannot lock down cross-origin policies the way a same-origin app would.
app.use(
  helmet({
    crossOriginResourcePolicy: false,       // allow widget.js to be loaded cross-origin
    crossOriginOpenerPolicy: false,
    contentSecurityPolicy: false,           // embedding sites control their own CSP
  })
);

// --- CORS ---
// The dashboard frontend uses a fixed origin + credentials (cookies).
// The widget chat endpoint must accept ANY origin since it runs on customers' sites.
const DASHBOARD_ORIGIN = process.env.CLIENT_URL || "http://localhost:3000";

// Middleware that applies per-request: dashboard routes use strict origin,
// public widget/chat routes use permissive wildcard CORS.
const dashboardCors = cors({
  origin: DASHBOARD_ORIGIN,
  credentials: true,
});

const widgetCors = cors({
  origin: "*",          // widget runs on any third-party website
  credentials: false,   // cookies don't work cross-origin with wildcard; widget uses x-api-key header
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key", "Authorization"],
});

// Apply dashboard CORS globally first (covers /api/auth/*, /api/bots/*, etc.)
app.use(dashboardCors);

// Razorpay webhook — raw body before json parser
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  paymentController.webhook
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

// --- Global rate limiter ---
const globalLimiter = rateLimit({
  windowMs: (Number(process.env.RATE_LIMIT_WINDOW_MIN) || 15) * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// --- Health check ---
app.get("/health", (req, res) => {
  res.status(200).json({ success: true, message: "Server is healthy" });
});

// --- widget.js served with open CORS (any site can load it as a <script> tag) ---
app.get("/widget.js", widgetCors, widgetController.serveWidgetScript);

// --- Public widget/chat API — open CORS, no dashboard cookies needed ---
// Mount BEFORE the main /api routes so widgetCors applies here
app.use("/api/v1", widgetCors, (req, res, next) => {
  // Pre-flight OPTIONS handled automatically by cors()
  next();
});

// --- All API routes ---
app.use("/api", routes);

// --- 404 + error handling ---
app.use(notFound);
app.use(errorHandler);

module.exports = app;
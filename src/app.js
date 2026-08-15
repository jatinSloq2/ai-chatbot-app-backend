const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const { MEDIA_ROOT, PUBLIC_PREFIX } = require("./services/storage.service");

const routes = require("./routes");
const { notFound, errorHandler } = require("./middlewares/error.middleware");
const paymentController = require("./controllers/payment.controller");
const widgetController = require("./controllers/widget.controller");

const app = express();

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

app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
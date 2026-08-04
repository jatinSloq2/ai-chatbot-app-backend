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

// --- Security & core middleware ---
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true, // allows cookies to be sent cross-origin
  })
);

// Razorpay webhook needs the RAW request body to verify its HMAC signature,
// so it must be mounted BEFORE express.json() and given its own raw parser.
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

// --- Global rate limiter (light touch, per-route limiters handle sensitive endpoints) ---
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

// --- API routes ---
app.use("/api", routes);

// --- Embeddable widget script (served as a plain <script src="..."> tag) ---
app.get("/widget.js", widgetController.serveWidgetScript);

// --- 404 + error handling (must be last) ---
app.use(notFound);
app.use(errorHandler);

module.exports = app;

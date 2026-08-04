const ApiError = require("../utils/ApiError");
const logger = require("../utils/logger");

// Catches 404s for unmatched routes
const notFound = (req, res, next) => {
  next(new ApiError(404, `Route not found - ${req.originalUrl}`));
};

// Central error handler - every error in the app ends up here
const errorHandler = (err, req, res, next) => {
  let { statusCode, message, errors } = err;
  // Mongoose bad ObjectId
  if (err.name === "CastError") {
    statusCode = 400;
    message = "Invalid resource ID";
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0];
    message = `${field ? field : "Field"} already in use`;
  }

  // Mongoose validation error
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((val) => val.message)
      .join(", ");
  }

  statusCode = statusCode || 500;
  message = message || "Internal Server Error";

  if (!(err instanceof ApiError)) {
    logger.error(err.stack || err.message);
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors: errors || [],
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
};

module.exports = { notFound, errorHandler };

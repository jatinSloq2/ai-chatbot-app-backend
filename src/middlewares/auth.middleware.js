const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { verifyAccessToken } = require("../utils/token");
const User = require("../models/User");

// Protects routes - requires a valid access token (from cookie or Authorization header)
const protect = asyncHandler(async (req, res, next) => {
  let token = req.cookies?.accessToken;

  if (!token && req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    throw new ApiError(401, "Not authenticated. Please log in");
  }

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    throw new ApiError(401, "Session expired. Please log in again");
  }

  const user = await User.findById(decoded.userId);
  if (!user) {
    throw new ApiError(401, "User no longer exists");
  }

  req.user = user;
  next();
});

module.exports = { protect };

// Requires the logged-in user to have role "admin" AND be on the allowlist. Must run after `protect`.
const requireAdmin = (req, res, next) => {
  const allowedAdmins = ["jatinsingh098hp@gmail.com", "jestbotai@gmail.com"];
  if (req.user?.role !== "admin" || !allowedAdmins.includes(req.user.email)) {
    return next(new (require("../utils/ApiError"))(403, "Admin access required"));
  }
  next();
};

module.exports.requireAdmin = requireAdmin;

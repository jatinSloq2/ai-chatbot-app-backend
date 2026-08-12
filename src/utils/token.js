const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const generateAccessToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || "15m",
  });
};

const generateRefreshToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || "30d",
  });
};

// --- Agent tokens ---
// Separate payload shape (agentId + type: "agent") on the SAME secrets, so no
// new env vars are needed. The `type` claim is what lets agentAuth.middleware
// tell an agent token apart from a dashboard-user token — a leaked/misused
// user token can't be used to authenticate as an agent and vice versa.
const generateAgentAccessToken = (agentId) => {
  return jwt.sign({ agentId, type: "agent" }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || "15m",
  });
};

const generateAgentRefreshToken = (agentId) => {
  return jwt.sign({ agentId, type: "agent" }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || "30d",
  });
};

const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
};

// We store only a hash of the refresh token in DB, never the raw token
const hashToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateAgentAccessToken,
  generateAgentRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
};
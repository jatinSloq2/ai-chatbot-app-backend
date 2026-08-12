const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { verifyAccessToken } = require("../utils/token");
const Agent = require("../models/Agent");

// Protects agent-panel routes. Reads the agent-scoped cookie (kept separate
// from the dashboard user's "accessToken" cookie — see agentAuth.controller.js
// — so a browser can hold a dashboard session and an agent session at once
// without them clobbering each other) or an Authorization header.
const protectAgent = asyncHandler(async (req, res, next) => {
    let token = req.cookies?.agentAccessToken;

    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
        token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
        throw new ApiError(401, "Not authenticated. Please log in as an agent");
    }

    let decoded;
    try {
        decoded = verifyAccessToken(token);
    } catch (err) {
        throw new ApiError(401, "Session expired. Please log in again");
    }

    // Reject a dashboard-user token being replayed against agent routes.
    if (decoded.type !== "agent" || !decoded.agentId) {
        throw new ApiError(401, "Invalid agent session");
    }

    const agent = await Agent.findById(decoded.agentId);
    if (!agent) {
        throw new ApiError(401, "Agent no longer exists");
    }
    if (!agent.isActive) {
        throw new ApiError(403, "This agent account has been disabled");
    }

    req.agent = agent;
    next();
});

module.exports = { protectAgent };
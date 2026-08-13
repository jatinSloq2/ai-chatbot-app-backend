const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const leadsService = require("../services/leads.service");

// GET /api/leads?page=1&limit=20
const listLeads = asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const result = await leadsService.listLeads(req.user._id, { page, limit });
    res.status(200).json({ success: true, data: result });
});

// GET /api/leads/:identifier/conversations
// :identifier is URL-encoded email or phone (the lead's dedupe key).
const getLeadConversations = asyncHandler(async (req, res) => {
    const identifier = decodeURIComponent(req.params.identifier);
    if (!identifier) throw new ApiError(400, "identifier is required");
    const conversations = await leadsService.getLeadConversations(req.user._id, identifier);
    res.status(200).json({ success: true, data: { conversations } });
});

module.exports = { listLeads, getLeadConversations };
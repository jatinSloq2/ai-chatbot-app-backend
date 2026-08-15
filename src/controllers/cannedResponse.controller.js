const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const CannedResponse = require("../models/CannedResponse");
const Bot = require("../models/Bot");
const storageService = require("../services/storage.service");

const sanitize = (c) => ({
    id: c._id,
    bot: c.bot,
    title: c.title,
    shortcut: c.shortcut,
    content: c.content,
    media: c.media,
    richContent: c.richContent,
    usageCount: c.usageCount,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
});

const assertOwnedBot = async (botId, ownerId) => {
    if (!botId) return;
    const bot = await Bot.findOne({ _id: botId, user: ownerId }).select("_id");
    if (!bot) throw new ApiError(404, "Bot not found");
};

// POST /api/canned-responses
const createCannedResponse = asyncHandler(async (req, res) => {
    const { title, shortcut, content, bot, richContent } = req.body;
    if (!title?.trim()) throw new ApiError(400, "title is required");
    if (!content?.trim() && !req.files?.length) throw new ApiError(400, "content or media is required");

    await assertOwnedBot(bot, req.user._id);

    const media = [];
    if (req.files?.length) {
        for (const file of req.files) {
            const saved = await storageService.saveMedia({
                ownerId: req.user._id,
                botId: bot || "shared",
                actorType: "agent",
                actorId: "canned-responses",
                file,
            });
            media.push(saved);
        }
    }

    const canned = await CannedResponse.create({
        owner: req.user._id,
        bot: bot || null,
        title: title.trim(),
        shortcut: shortcut ? shortcut.trim().toLowerCase().replace(/^\//, "") : null,
        content: content || "",
        media,
        richContent: richContent ? JSON.parse(typeof richContent === "string" ? richContent : JSON.stringify(richContent)) : null,
    });

    res.status(201).json({ success: true, data: { cannedResponse: sanitize(canned) } });
});

// GET /api/canned-responses?botId=...  (botId optional — omit for the full shared+bot-specific list)
const listCannedResponses = asyncHandler(async (req, res) => {
    const { botId } = req.query;
    const query = { owner: req.user._id };
    if (botId) query.$or = [{ bot: botId }, { bot: null }];

    const items = await CannedResponse.find(query).sort({ title: 1 });
    res.status(200).json({ success: true, data: { cannedResponses: items.map(sanitize) } });
});

// PATCH /api/canned-responses/:id
const updateCannedResponse = asyncHandler(async (req, res) => {
    const canned = await CannedResponse.findOne({ _id: req.params.id, owner: req.user._id });
    if (!canned) throw new ApiError(404, "Canned response not found");

    const { title, shortcut, content, bot, richContent } = req.body;
    if (bot !== undefined) await assertOwnedBot(bot, req.user._id);

    if (title !== undefined) canned.title = title.trim();
    if (shortcut !== undefined) canned.shortcut = shortcut ? shortcut.trim().toLowerCase().replace(/^\//, "") : null;
    if (content !== undefined) canned.content = content;
    if (bot !== undefined) canned.bot = bot || null;
    if (richContent !== undefined) {
        canned.richContent = richContent
            ? JSON.parse(typeof richContent === "string" ? richContent : JSON.stringify(richContent))
            : null;
    }

    if (req.files?.length) {
        for (const file of req.files) {
            const saved = await storageService.saveMedia({
                ownerId: req.user._id,
                botId: canned.bot || "shared",
                actorType: "agent",
                actorId: "canned-responses",
                file,
            });
            canned.media.push(saved);
        }
    }

    await canned.save();
    res.status(200).json({ success: true, data: { cannedResponse: sanitize(canned) } });
});

// DELETE /api/canned-responses/:id
const deleteCannedResponse = asyncHandler(async (req, res) => {
    const result = await CannedResponse.deleteOne({ _id: req.params.id, owner: req.user._id });
    if (result.deletedCount === 0) throw new ApiError(404, "Canned response not found");
    res.status(200).json({ success: true, message: "Canned response deleted" });
});

module.exports = { createCannedResponse, listCannedResponses, updateCannedResponse, deleteCannedResponse };
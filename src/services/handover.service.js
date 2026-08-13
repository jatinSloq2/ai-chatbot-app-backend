const Agent = require("../models/Agent");
const Team = require("../models/Team");
const Bot = require("../models/Bot");
const Conversation = require("../models/Conversation");
const ApiError = require("../utils/ApiError");
const notificationService = require("./notification.service");

// Bots this agent is allowed to see conversations for: bots they're directly
// linked to, bots that directly assign them, or bots that assign a team
// they're a member of.
const eligibleBotIds = async (agentId) => {
    const [agent, teams] = await Promise.all([
        Agent.findById(agentId).select("bots"),
        Team.find({ members: agentId }).select("_id"),
    ]);
    const teamIds = teams.map((t) => t._id);

    const bots = await Bot.find({
        $or: [
            { _id: { $in: agent?.bots || [] } },
            { assignedAgents: agentId },
            { assignedTeams: { $in: teamIds } },
        ],
    }).select("_id");

    return bots.map((b) => b._id);
};

// --- Visitor (public widget) side ---

// Visitor clicks "Talk to a human". Fails soft with a friendly ApiError
// message the widget can show directly (handover disabled / no agents).
const requestHandover = async (bot, sessionId) => {
    if (!bot.agentConfig?.assignEnabled) {
        throw new ApiError(400, "Human handover isn't enabled for this chat");
    }

    const teams = await Team.find({ _id: { $in: bot.assignedTeams } }).select("members");
    const teamAgentIds = teams.flatMap((t) => t.members.map((m) => m.toString()));
    const agentIds = Array.from(new Set([...bot.assignedAgents.map((a) => a.toString()), ...teamAgentIds]));

    if (agentIds.length === 0) {
        throw new ApiError(400, "No agents are available for this chat right now");
    }

    const conversation = await Conversation.findOneAndUpdate(
        { bot: bot._id, sessionId },
        {
            $setOnInsert: { type: "widget", messages: [] },
            $set: { "handover.status": "requested", "handover.requestedAt": new Date() },
        },
        { upsert: true, new: true }
    );

    await notificationService.notifyAgents({
        agentIds,
        type: "handover_request",
        title: "A visitor needs an agent",
        body: `Someone chatting with ${bot.name} is waiting for a human.`,
        data: { botId: bot._id.toString(), conversationId: conversation._id.toString() },
    });

    return conversation;
};

// Visitor sends a message while handover is active — goes straight into the
// transcript, no AI call. Used by chat.controller.js instead of the normal
// AI path once handover.status is "requested" or "assigned".
const appendVisitorMessage = async (conversation, message) => {
    conversation.messages.push({ role: "user", content: message });
    await conversation.save();
    return conversation;
};

// Widget polls this while handover is active to pick up the agent's replies
// (and to notice when it's been accepted/resolved) without needing sockets.
const pollUpdates = async (bot, sessionId, since) => {
    const conversation = await Conversation.findOne({ bot: bot._id, sessionId }).populate(
        "handover.assignedAgent",
        "name"
    );
    if (!conversation) throw new ApiError(404, "Conversation not found");

    const sinceDate = since ? new Date(since) : new Date(0);
    const messages = conversation.messages.filter((m) => m.createdAt > sinceDate);

    return {
        status: conversation.handover.status,
        assignedAgentName: conversation.handover.assignedAgent?.name || null,
        messages,
    };
};

// --- Agent side ---

const listPending = async (agentId) => {
    const botIds = await eligibleBotIds(agentId);
    return Conversation.find({ bot: { $in: botIds }, "handover.status": "requested" })
        .sort({ "handover.requestedAt": 1 })
        .populate("bot", "name")
        .select("bot sessionId visitor messages handover createdAt updatedAt");
};

const listAssignedToAgent = async (agentId) => {
    return Conversation.find({ "handover.assignedAgent": agentId, "handover.status": "assigned" })
        .sort({ "handover.assignedAt": -1 })
        .populate("bot", "name")
        .select("bot sessionId visitor messages handover createdAt updatedAt");
};

// Atomic accept via a conditional findOneAndUpdate: only succeeds if the
// conversation is STILL "requested" and this agent is actually eligible for
// its bot. This is what resolves the "two agents click Accept at the same
// instant" race — Mongo only lets one of the two concurrent updates match.
const acceptHandover = async (agentId, conversationId) => {
    const botIds = await eligibleBotIds(agentId);

    const conversation = await Conversation.findOneAndUpdate(
        { _id: conversationId, bot: { $in: botIds }, "handover.status": "requested" },
        {
            $set: {
                "handover.status": "assigned",
                "handover.assignedAgent": agentId,
                "handover.assignedAt": new Date(),
            },
        },
        { new: true }
    );

    if (!conversation) {
        throw new ApiError(409, "This chat was already taken by another agent, or is no longer waiting");
    }

    await Agent.updateOne({ _id: agentId }, { $inc: { "performance.assignedCount": 1 } });
    return conversation;
};

const getMyConversation = async (agentId, conversationId) => {
    const conversation = await Conversation.findOne({
        _id: conversationId,
        "handover.assignedAgent": agentId,
    }).populate("bot", "name");
    if (!conversation) throw new ApiError(404, "Conversation not found");
    return conversation;
};

const sendAgentMessage = async (agent, conversationId, message) => {
    const conversation = await getMyConversation(agent._id, conversationId);
    if (conversation.handover.status !== "assigned") {
        throw new ApiError(400, "This conversation is no longer active");
    }
    conversation.messages.push({ role: "assistant", content: message, via: "agent", agentName: agent.name });
    await conversation.save();
    return conversation;
};

const resolveHandover = async (agentId, conversationId) => {
    const conversation = await getMyConversation(agentId, conversationId);
    conversation.handover.status = "resolved";
    conversation.handover.resolvedAt = new Date();
    await conversation.save();
    await Agent.updateOne({ _id: agentId }, { $inc: { "performance.resolvedCount": 1 } });
    return conversation;
};

module.exports = {
    eligibleBotIds,
    requestHandover,
    appendVisitorMessage,
    pollUpdates,
    listPending,
    listAssignedToAgent,
    acceptHandover,
    getMyConversation,
    sendAgentMessage,
    resolveHandover,
};
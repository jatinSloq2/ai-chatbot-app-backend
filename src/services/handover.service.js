const Agent = require("../models/Agent");
const Team = require("../models/Team");
const Bot = require("../models/Bot");
const Conversation = require("../models/Conversation");
const CannedResponse = require("../models/CannedResponse");
const IntegrationCredential = require("../models/IntegrationCredential");
const ApiError = require("../utils/ApiError");
const notificationService = require("./notification.service");
const realtimeService = require("./realtime.service");
const whatsappSender = require("./whatsappSender.service");
const logger = require("../utils/logger");
const { isWithinBusinessHours, describeBusinessHours } = require("./businessHours.service");

// Looks up the active WhatsApp credential for a bot, or null if this bot
// isn't WhatsApp-connected / the credential is missing. Shared by every
// relay/prompt helper below so there's one place that knows how to go from
// "a conversation" to "the Cloud API creds to send on it".
const getWhatsappCredential = async (botId) => {
    const bot = await Bot.findById(botId).select("whatsappConfig");
    const credentialId = bot?.whatsappConfig?.credentialId;
    if (!credentialId) return null;
    const credential = await IntegrationCredential.findOne({ _id: credentialId, channel: "whatsapp", isActive: true });
    return credential || null;
};

// A conversation with type:"whatsapp" has no SSE/poll listener on the other
// end — the visitor's only "client" is WhatsApp itself. So whenever an
// agent (or the AI, via appendVisitorMessage's counterpart) writes an
// assistant message into one of these, it also has to be pushed out over
// the Cloud API, or the visitor never sees it. Best-effort: a delivery
// failure here shouldn't roll back a message that's already saved and
// visible in the agent's dashboard.
//
// `media`, when present, is sent as a proper WhatsApp media message
// (image/document/audio/video) with `text` as its caption, instead of a
// plain text message — this is what makes an agent's file/image attachment
// actually reach a WhatsApp visitor rather than silently only showing up in
// the dashboard.
const relayToWhatsappIfNeeded = async (conversation, text, media = null) => {
    if (conversation.type !== "whatsapp") return;
    if (!text?.trim() && !media) return;
    try {
        const credential = await getWhatsappCredential(conversation.bot);
        if (!credential) return;
        if (media) {
            await whatsappSender.sendWhatsappMedia(credential.whatsapp, {
                to: conversation.sessionId,
                media,
                caption: text,
            });
        } else {
            await whatsappSender.sendWhatsappText(credential.whatsapp, { to: conversation.sessionId, message: text });
        }
    } catch (err) {
        logger.error(`[whatsapp] Failed to relay agent reply for conversation ${conversation._id}: ${err.message}`);
    }
};

// Sends the post-resolution CSAT prompt as a WhatsApp interactive list
// (rating 1-5) instead of a plain text message. Best-effort, same as
// relayToWhatsappIfNeeded — a delivery failure here shouldn't roll back the
// resolution itself.
const sendWhatsappCsatPrompt = async (conversation, bodyText) => {
    if (conversation.type !== "whatsapp") return;
    try {
        const credential = await getWhatsappCredential(conversation.bot);
        if (!credential) return;
        await whatsappSender.sendWhatsappList(credential.whatsapp, {
            to: conversation.sessionId,
            bodyText,
            buttonText: "Rate now",
            sectionTitle: "How did we do?",
            rows: [5, 4, 3, 2, 1].map((n) => ({
                id: `csat_${n}`,
                title: `${"⭐".repeat(n)} (${n}/5)`,
            })),
        });
    } catch (err) {
        logger.error(`[whatsapp] Failed to send CSAT prompt for conversation ${conversation._id}: ${err.message}`);
    }
};

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
//
// Outside configured business hours (see Bot.businessHours), this does NOT
// create a real handover request — there's no one to notify. Instead it
// marks the conversation "offHours" and returns a message telling the
// visitor to keep chatting with the AI and that the team will follow up by
// email. The visitor's existing lead info (captured via the pre-chat form,
// if enabled) is what "follow up by email" relies on.
const requestHandover = async (bot, sessionId) => {
    if (!bot.agentConfig?.assignEnabled) {
        throw new ApiError(400, "Human handover isn't enabled for this chat");
    }

    if (!isWithinBusinessHours(bot)) {
        const message =
            bot.agentConfig?.offHoursMessage ||
            "As of now, no agent is available — these are our off hours. You can continue chatting with our AI assistant, and we'll follow up by email as soon as we're back.";

        const conversation = await Conversation.findOneAndUpdate(
            { bot: bot._id, sessionId },
            {
                $setOnInsert: { type: "widget" },
                $set: { "handover.status": "offHours" },
                $push: { messages: { role: "assistant", content: message, via: "ai" } },
            },
            { upsert: true, new: true }
        );

        realtimeService.publish(`conv:${conversation._id}`, "update", { scope: "update" });
        await relayToWhatsappIfNeeded(conversation, message);

        return {
            conversation,
            offHours: true,
            message,
            hoursDescription: describeBusinessHours(bot),
        };
    }

    const teams = await Team.find({ _id: { $in: bot.assignedTeams } }).select("members");
    const teamAgentIds = teams.flatMap((t) => t.members.map((m) => m.toString()));
    const agentIds = Array.from(new Set([...bot.assignedAgents.map((a) => a.toString()), ...teamAgentIds]));

    if (agentIds.length === 0) {
        throw new ApiError(400, "No agents are available for this chat right now");
    }

    const requestedMessage =
        bot.agentConfig?.handoverRequestedMessage ||
        "Got it — connecting you to one of our team members. Someone will join the chat shortly.";

    const conversation = await Conversation.findOneAndUpdate(
        { bot: bot._id, sessionId },
        {
            $setOnInsert: { type: "widget" },
            $set: { "handover.status": "requested", "handover.requestedAt": new Date() },
            $push: { messages: { role: "assistant", content: requestedMessage, via: "ai" } },
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

    realtimeService.publish(`bot-handovers:${bot._id}`, "update", { scope: "pending" });

    await relayToWhatsappIfNeeded(conversation, requestedMessage);

    return { conversation, offHours: false, message: requestedMessage };
};

// Visitor sends a message while handover is active — goes straight into the
// transcript, no AI call. Used by chat.controller.js instead of the normal
// AI path once handover.status is "requested" or "assigned".
const appendVisitorMessage = async (conversation, message) => {
    conversation.messages.push({ role: "user", content: message });
    await conversation.save();

    realtimeService.publish(`conv:${conversation._id}`, "update", { scope: "update" });
    if (conversation.handover.assignedAgent) {
        realtimeService.publish(`agent-assigned:${conversation.handover.assignedAgent}`, "update", {
            scope: "conversation",
            conversationId: conversation._id.toString(),
        });
    }

    return conversation;
};

// Visitor uploads a media attachment while handover is "assigned" — chat
// media is only accepted once a real agent is connected (see chat.controller.js).
const appendVisitorMedia = async (conversation, media, caption) => {
    conversation.messages.push({
        role: "user",
        content: caption || "",
        contentType: media.kind,
        media,
    });
    await conversation.save();

    realtimeService.publish(`conv:${conversation._id}`, "update", { scope: "update" });
    if (conversation.handover.assignedAgent) {
        realtimeService.publish(`agent-assigned:${conversation.handover.assignedAgent}`, "update", {
            scope: "conversation",
            conversationId: conversation._id.toString(),
        });
    }

    return conversation;
};

// One-shot fetch of everything since `since` (or the full transcript if
// omitted) — used for the widget's initial history load, and as the "go
// check what changed" pull triggered by the realtime stream's "update" event.
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
        csat: conversation.handover.csat?.rating ? conversation.handover.csat : null,
    };
};

// Visitor submits a CSAT rating after the chat is marked resolved. Only
// allowed once per conversation, and only while status is "resolved" — a
// visitor can't rate a chat that's still in progress or wasn't resolved by
// an agent at all.
//
// Credit for the rating goes ONLY to whoever actually resolved the chat
// (conversation.handover.assignedAgent at the time of resolution) — CSAT
// measures how well a chat was closed out, not participation, so an
// earlier agent in handover.history who was transferred off before
// resolving it does NOT get any of the rating's points. Their entry in
// history is still visible for context, it just doesn't carry a
// csatRating — only the entry for whoever resolved it does (see below).
const submitCsat = async (bot, sessionId, rating, comment) => {
    const conversation = await Conversation.findOne({ bot: bot._id, sessionId });
    if (!conversation) throw new ApiError(404, "Conversation not found");
    if (conversation.handover.status !== "resolved") {
        throw new ApiError(400, "This chat hasn't been resolved by an agent yet");
    }
    if (conversation.handover.csat?.rating) {
        throw new ApiError(400, "You've already rated this chat");
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new ApiError(400, "rating must be an integer between 1 and 5");
    }

    conversation.handover.csat.rating = rating;
    conversation.handover.csat.comment = comment || null;
    conversation.handover.csat.ratedAt = new Date();

    const resolvingAgentId = conversation.handover.assignedAgent;

    // Tag the history entry that actually resolved this chat — by the time
    // CSAT is submitted, resolveHandover() has already closed it out with
    // endReason:"resolved", so it's the resolving agent's entry with the
    // most recent assignedAt (there's exactly one, never more).
    if (resolvingAgentId) {
        let latestResolvedIdx = -1;
        conversation.handover.history.forEach((h, i) => {
            if (h.endReason === "resolved" && h.agent?.toString() === resolvingAgentId.toString()) {
                if (latestResolvedIdx === -1 || h.assignedAt > conversation.handover.history[latestResolvedIdx].assignedAt) {
                    latestResolvedIdx = i;
                }
            }
        });
        if (latestResolvedIdx !== -1) {
            conversation.handover.history[latestResolvedIdx].csatRating = rating;
        }
    }

    await conversation.save();

    if (resolvingAgentId) {
        // Running sum/count on the agent — this is what powers the "CSAT"
        // column in the owner's Agents page and the agent's own ratings view,
        // without having to re-aggregate every conversation on every read.
        await Agent.updateOne(
            { _id: resolvingAgentId },
            { $inc: { "performance.csatSum": rating, "performance.csatCount": 1 } }
        );
        realtimeService.publish(`agent-assigned:${resolvingAgentId}`, "update", { scope: "assigned" });
    }

    return conversation;
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

    const [agent] = await Promise.all([
        Agent.findById(agentId).select("name"),
    ]);

    const conversation = await Conversation.findOneAndUpdate(
        { _id: conversationId, bot: { $in: botIds }, "handover.status": "requested" },
        {
            $set: {
                "handover.status": "assigned",
                "handover.assignedAgent": agentId,
                "handover.assignedAt": new Date(),
            },
            // Opens this agent's entry in the assignment-history log — see
            // the schema comment on Conversation.handover.history. This is
            // the FIRST assignment on a fresh "requested" chat, so there's
            // nothing to close out first (transferHandover is what closes
            // an existing open entry before pushing a new one).
            $push: {
                history: {
                    agent: agentId,
                    agentName: agent?.name || null,
                    assignedAt: new Date(),
                },
            },
        },
        { new: true }
    );

    if (!conversation) {
        throw new ApiError(409, "This chat was already taken by another agent, or is no longer waiting");
    }

    await Agent.updateOne({ _id: agentId }, { $inc: { "performance.assignedCount": 1 } });

    const bot = await Bot.findById(conversation.bot).select("agentConfig");
    const template =
        bot?.agentConfig?.handoverConnectedMessage || "You're now connected with {agentName}. They'll be right with you.";
    const message = template.replace("{agentName}", agent?.name || "an agent");

    conversation.messages.push({ role: "assistant", content: message, via: "ai" });
    await conversation.save();

    realtimeService.publish(`bot-handovers:${conversation.bot}`, "update", { scope: "pending" });
    realtimeService.publish(`agent-assigned:${agentId}`, "update", { scope: "assigned" });
    realtimeService.publish(`conv:${conversation._id}`, "update", { scope: "update" });

    await relayToWhatsappIfNeeded(conversation, message);

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

// Other agents this bot could hand the conversation off to — eligible
// agents on the bot (directly assigned or via an assigned team), minus the
// one requesting the transfer and minus deactivated agents. Powers the
// "Transfer to..." picker in the agent panel.
const listTransferCandidates = async (agentId, conversationId) => {
    const conversation = await getMyConversation(agentId, conversationId);
    const bot = await Bot.findById(conversation.bot).select("assignedAgents assignedTeams");
    if (!bot) return [];

    const teams = await Team.find({ _id: { $in: bot.assignedTeams } }).select("members");
    const teamAgentIds = teams.flatMap((t) => t.members.map((m) => m.toString()));
    const candidateIds = Array.from(
        new Set([...bot.assignedAgents.map((a) => a.toString()), ...teamAgentIds])
    ).filter((id) => id !== agentId.toString());

    return Agent.find({ _id: { $in: candidateIds }, isActive: true }).select("name email avatar status");
};

// Hands an already-assigned conversation from the current agent to another
// eligible agent, mid-conversation — this is the "multiple agents in one
// conversation" flow: rather than overwriting handover.assignedAgent and
// losing track of who else touched the chat, the outgoing agent's
// assignment-history entry is closed out (endReason:"transferred") and a
// fresh entry is opened for the incoming agent, so the full chain of
// agents who handled this conversation is always reconstructable from
// handover.history — not just whoever is assigned right now.
const transferHandover = async (fromAgentId, conversationId, toAgentId) => {
    if (String(fromAgentId) === String(toAgentId)) {
        throw new ApiError(400, "Can't transfer a conversation to yourself");
    }

    const conversation = await getMyConversation(fromAgentId, conversationId);
    if (conversation.handover.status !== "assigned") {
        throw new ApiError(400, "This conversation is no longer active");
    }

    const bot = await Bot.findById(conversation.bot).select("name assignedAgents assignedTeams agentConfig");
    const candidates = await listTransferCandidates(fromAgentId, conversationId);
    if (!candidates.some((c) => c._id.toString() === String(toAgentId))) {
        throw new ApiError(400, "That agent isn't eligible for this bot");
    }

    const [fromAgent, toAgent] = await Promise.all([
        Agent.findById(fromAgentId).select("name"),
        Agent.findById(toAgentId).select("name"),
    ]);

    const now = new Date();

    // Close the outgoing agent's open history entry (the one with no
    // endedAt yet) and open a fresh one for the incoming agent.
    conversation.handover.history = conversation.handover.history.map((h) =>
        !h.endedAt && h.agent.toString() === String(fromAgentId)
            ? { ...(h.toObject ? h.toObject() : h), endedAt: now, endReason: "transferred" }
            : h
    );
    conversation.handover.history.push({ agent: toAgentId, agentName: toAgent?.name || null, assignedAt: now });
    conversation.handover.assignedAgent = toAgentId;
    conversation.handover.assignedAt = now;

    const message = `${fromAgent?.name || "The agent"} transferred this chat to ${toAgent?.name || "another agent"}.`;
    conversation.messages.push({ role: "assistant", content: message, via: "ai" });

    await conversation.save();

    await Promise.all([
        Agent.updateOne({ _id: fromAgentId }, { $inc: { "performance.reassignedCount": 1 } }),
        Agent.updateOne({ _id: toAgentId }, { $inc: { "performance.assignedCount": 1 } }),
        notificationService.notifyAgents({
            agentIds: [toAgentId.toString()],
            type: "handover_request",
            title: "A conversation was transferred to you",
            body: `${fromAgent?.name || "An agent"} handed off a chat on ${bot?.name || "a bot"}.`,
            data: { botId: conversation.bot.toString(), conversationId: conversation._id.toString() },
        }),
    ]);

    realtimeService.publish(`agent-assigned:${fromAgentId}`, "update", { scope: "assigned" });
    realtimeService.publish(`agent-assigned:${toAgentId}`, "update", { scope: "assigned" });
    realtimeService.publish(`conv:${conversation._id}`, "update", { scope: "update" });

    await relayToWhatsappIfNeeded(conversation, message);

    return conversation;
};

// Every conversation this agent has been rated on, most recent first.
// Deliberately NOT filtered by handover.status — a rated conversation stays
// visible to the agent here forever, independent of whatever the pending/
// assigned lists show (which only ever show "currently active" work).
//
// Matches on handover.history.agent, not handover.assignedAgent — a
// conversation this agent handled and then got transferred away from
// BEFORE it was resolved/rated would otherwise silently vanish from their
// ratings view the moment the next agent took over (assignedAgent would
// already point at someone else by the time the visitor actually rates
// it). history keeps every agent who ever touched the chat, so this still
// finds it.
const listRatedForAgent = async (agentId, { limit = 50, skip = 0 } = {}) => {
    return Conversation.find({
        $or: [{ "handover.assignedAgent": agentId }, { "handover.history.agent": agentId }],
        "handover.csat.rating": { $ne: null },
    })
        .sort({ "handover.csat.ratedAt": -1 })
        .skip(skip)
        .limit(limit)
        .populate("bot", "name")
        .select("bot sessionId visitor handover createdAt updatedAt");
};

// options: { media, richContent, cannedResponseId } — all optional. A
// message needs at least one of `message` (text) or `media`.
const sendAgentMessage = async (agent, conversationId, message, options = {}) => {
    const conversation = await getMyConversation(agent._id, conversationId);
    if (conversation.handover.status !== "assigned") {
        throw new ApiError(400, "This conversation is no longer active");
    }
    if (!message?.trim() && !options.media) {
        throw new ApiError(400, "message or media is required");
    }

    const { media, richContent, cannedResponseId } = options;

    conversation.messages.push({
        role: "assistant",
        content: message || "",
        via: "agent",
        agentName: agent.name,
        contentType: media ? media.kind : "text",
        media: media || null,
        richContent: richContent || null,
        cannedResponse: cannedResponseId || null,
    });
    await conversation.save();

    if (cannedResponseId) {
        CannedResponse.updateOne({ _id: cannedResponseId }, { $inc: { usageCount: 1 } }).catch(() => { });
    }

    realtimeService.publish(`conv:${conversation._id}`, "update", { scope: "update" });

    // Fire-and-forget: WhatsApp conversations have no realtime listener on
    // the visitor's end, so this is the only way the agent's reply actually
    // reaches them (now including media — see relayToWhatsappIfNeeded).
    // Widget messages already reach the visitor via the realtime publish
    // above and don't need this.
    relayToWhatsappIfNeeded(conversation, message, media || null).catch(() => { });

    return conversation;
};

// Marks the conversation resolved and arms the CSAT prompt. On the widget
// this just flips a flag the widget polls for and shows its own in-UI star
// picker. On WhatsApp there's no such UI, so this also pushes out an
// interactive "rate 1-5" list message right after the resolved-chat text —
// the visitor's tap on a row is what actually records the rating (see
// whatsapp.controller.js's interactive/list_reply handling).
const resolveHandover = async (agentId, conversationId) => {
    const conversation = await getMyConversation(agentId, conversationId);
    conversation.handover.status = "resolved";
    conversation.handover.resolvedAt = new Date();
    conversation.handover.csat.promptedAt = new Date();

    // Close out this agent's open history entry — same bookkeeping
    // transferHandover does, just with endReason:"resolved" instead of
    // "transferred". Keeps handover.history a complete, gap-free record of
    // every agent who ever worked this conversation.
    conversation.handover.history = conversation.handover.history.map((h) =>
        !h.endedAt && h.agent.toString() === String(agentId)
            ? { ...(h.toObject ? h.toObject() : h), endedAt: conversation.handover.resolvedAt, endReason: "resolved" }
            : h
    );

    const [agent, bot] = await Promise.all([
        Agent.findById(agentId).select("name"),
        Bot.findById(conversation.bot).select("agentConfig"),
    ]);

    const message =
        bot?.agentConfig?.handoverResolvedMessage ||
        "This chat has been marked as resolved. Feel free to message us again anytime!";

    conversation.messages.push({ role: "assistant", content: message, via: "ai" });

    await conversation.save();
    await Agent.updateOne({ _id: agentId }, { $inc: { "performance.resolvedCount": 1 } });

    realtimeService.publish(`agent-assigned:${agentId}`, "update", { scope: "assigned" });
    realtimeService.publish(`conv:${conversation._id}`, "update", { scope: "update" });

    await relayToWhatsappIfNeeded(conversation, message);

    if (conversation.type === "whatsapp") {
        const promptTemplate =
            bot?.agentConfig?.csatPromptMessage || "How was your chat with {agentName}? Tap below to rate it.";
        await sendWhatsappCsatPrompt(conversation, promptTemplate.replace("{agentName}", agent?.name || "our team"));
    }

    return conversation;
};

module.exports = {
    eligibleBotIds,
    requestHandover,
    appendVisitorMessage,
    appendVisitorMedia,
    pollUpdates,
    submitCsat,
    listPending,
    listAssignedToAgent,
    acceptHandover,
    getMyConversation,
    listRatedForAgent,
    sendAgentMessage,
    resolveHandover,
    listTransferCandidates,
    transferHandover,
};
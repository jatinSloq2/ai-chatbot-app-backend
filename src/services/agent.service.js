const bcrypt = require("bcryptjs");
const Agent = require("../models/Agent");
const Team = require("../models/Team");
const Bot = require("../models/Bot");
const ApiError = require("../utils/ApiError");
const { getActivePlan } = require("./bot.service");
const {
  generateAgentAccessToken,
  generateAgentRefreshToken,
  hashToken,
} = require("../utils/token");

// --- Owner-side management ---

const createAgent = async ({ ownerId, name, email, password, avatar, bots }) => {
  const plan = await getActivePlan(ownerId);

  const currentCount = await Agent.countDocuments({ owner: ownerId });
  if (currentCount >= plan.limits.maxAgents) {
    throw new ApiError(
      403,
      `Your plan (${plan.name}) allows a maximum of ${plan.limits.maxAgents} agent(s). Upgrade to add more.`
    );
  }

  const existing = await Agent.findOne({ email });
  if (existing) throw new ApiError(409, "An agent with this email already exists");

  if (bots?.length) await assertOwnsBots(ownerId, bots);

  const hashedPassword = await bcrypt.hash(password, 10);

  const agent = await Agent.create({
    owner: ownerId,
    name,
    email,
    password: hashedPassword,
    avatar: avatar || null,
    bots: bots || [],
  });

  return agent;
};

const listAgents = async (ownerId) => {
  return Agent.find({ owner: ownerId }).sort({ createdAt: -1 });
};

const getOwnedAgent = async (agentId, ownerId) => {
  const agent = await Agent.findOne({ _id: agentId, owner: ownerId });
  if (!agent) throw new ApiError(404, "Agent not found");
  return agent;
};

const updateAgent = async (agentId, ownerId, { name, avatar, isActive, bots, password }) => {
  const agent = await getOwnedAgent(agentId, ownerId);

  if (bots !== undefined) await assertOwnsBots(ownerId, bots);

  if (name !== undefined) agent.name = name;
  if (avatar !== undefined) agent.avatar = avatar;
  if (isActive !== undefined) agent.isActive = isActive;
  if (bots !== undefined) agent.bots = bots;
  if (password) {
    if (password.length < 6) throw new ApiError(400, "Password must be at least 6 characters");
    agent.password = await bcrypt.hash(password, 10);
  }

  await agent.save();
  return agent;
};

const deleteAgent = async (agentId, ownerId) => {
  const agent = await getOwnedAgent(agentId, ownerId);

  // Pull this agent out of any teams it belonged to so no dangling refs remain.
  await Team.updateMany({ owner: ownerId, members: agent._id }, { $pull: { members: agent._id } });
  // Remove from any bot's direct-assignment list.
  await Bot.updateMany({ user: ownerId, assignedAgents: agent._id }, { $pull: { assignedAgents: agent._id } });

  await agent.deleteOne();
};

// Confirms every bot ID belongs to this owner before letting them be linked
// to an agent — prevents assigning someone else's bot by guessing an ID.
const assertOwnsBots = async (ownerId, botIds) => {
  if (!botIds.length) return;
  const count = await Bot.countDocuments({ _id: { $in: botIds }, user: ownerId });
  if (count !== botIds.length) throw new ApiError(400, "One or more bots were not found in your account");
};

// --- Agent-side auth ---

const login = async ({ email, password }) => {
  const agent = await Agent.findOne({ email }).select("+password");
  if (!agent) throw new ApiError(401, "Invalid email or password");
  if (!agent.isActive) throw new ApiError(403, "This agent account has been disabled. Contact your admin.");

  const isMatch = await bcrypt.compare(password, agent.password);
  if (!isMatch) throw new ApiError(401, "Invalid email or password");

  return agent;
};

// Issues tokens AND flips the agent online — login implies presence, per
// the "on successful login -> automatically Online" requirement.
const issueTokensAndGoOnline = async (agent) => {
  const accessToken = generateAgentAccessToken(agent._id.toString());
  const refreshToken = generateAgentRefreshToken(agent._id.toString());

  agent.refreshTokenHash = hashToken(refreshToken);
  agent.status = "online";
  agent.lastSeenAt = new Date();
  await agent.save();

  return { accessToken, refreshToken };
};

// Logout implies presence too — "on logout -> automatically Offline".
const logoutAndGoOffline = async (agentId) => {
  await Agent.findByIdAndUpdate(agentId, {
    refreshTokenHash: null,
    status: "offline",
    lastSeenAt: new Date(),
  });
};

module.exports = {
  createAgent,
  listAgents,
  getOwnedAgent,
  updateAgent,
  deleteAgent,
  login,
  issueTokensAndGoOnline,
  logoutAndGoOffline,
};
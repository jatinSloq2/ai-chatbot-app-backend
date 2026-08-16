const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const agentService = require("../services/agent.service");
const { getActivePlan } = require("../services/bot.service");

const csatAverage = (performance) =>
  performance?.csatCount ? Math.round((performance.csatSum / performance.csatCount) * 10) / 10 : null;

const sanitizeAgent = (agent) => ({
  id: agent._id,
  name: agent.name,
  email: agent.email,
  avatar: agent.avatar,
  status: agent.status,
  isActive: agent.isActive,
  bots: agent.bots,
  lastSeenAt: agent.lastSeenAt,
  performance: agent.performance,
  csatAverage: csatAverage(agent.performance),
  createdAt: agent.createdAt,
});

// POST /api/agents
const createAgent = asyncHandler(async (req, res) => {
  const { name, email, password, avatar, bots } = req.body;
  if (!name || !email || !password) throw new ApiError(400, "name, email, and password are required");
  if (password.length < 6) throw new ApiError(400, "Password must be at least 6 characters");

  const agent = await agentService.createAgent({
    ownerId: req.user._id,
    name,
    email,
    password,
    avatar,
    bots,
  });

  res.status(201).json({ success: true, data: { agent: sanitizeAgent(agent) } });
});

// GET /api/agents
const listAgents = asyncHandler(async (req, res) => {
  const [agents, plan] = await Promise.all([
    agentService.listAgents(req.user._id),
    getActivePlan(req.user._id),
  ]);

  res.status(200).json({
    success: true,
    data: {
      agents: agents.map(sanitizeAgent),
      limits: { maxAgents: plan.limits.maxAgents, used: agents.length },
    },
  });
});

// GET /api/agents/:id
const getAgent = asyncHandler(async (req, res) => {
  const agent = await agentService.getOwnedAgent(req.params.id, req.user._id);
  res.status(200).json({ success: true, data: { agent: sanitizeAgent(agent) } });
});

// PATCH /api/agents/:id
const updateAgent = asyncHandler(async (req, res) => {
  const { name, avatar, isActive, bots, password } = req.body;
  const agent = await agentService.updateAgent(req.params.id, req.user._id, {
    name,
    avatar,
    isActive,
    bots,
    password,
  });
  res.status(200).json({ success: true, data: { agent: sanitizeAgent(agent) } });
});

// DELETE /api/agents/:id
const deleteAgent = asyncHandler(async (req, res) => {
  await agentService.deleteAgent(req.params.id, req.user._id);
  res.status(200).json({ success: true, message: "Agent deleted" });
});

module.exports = { createAgent, listAgents, getAgent, updateAgent, deleteAgent, sanitizeAgent };
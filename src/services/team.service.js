const Team = require("../models/Team");
const Agent = require("../models/Agent");
const Bot = require("../models/Bot");
const ApiError = require("../utils/ApiError");
const { getActivePlan } = require("./bot.service");

const getOwnedTeam = async (teamId, ownerId) => {
  const team = await Team.findOne({ _id: teamId, owner: ownerId });
  if (!team) throw new ApiError(404, "Team not found");
  return team;
};

const assertOwnsAgents = async (ownerId, agentIds) => {
  if (!agentIds.length) return;
  const count = await Agent.countDocuments({ _id: { $in: agentIds }, owner: ownerId });
  if (count !== agentIds.length) throw new ApiError(400, "One or more agents were not found in your account");
};

const createTeam = async ({ ownerId, name, description, members }) => {
  const plan = await getActivePlan(ownerId);

  const currentCount = await Team.countDocuments({ owner: ownerId });
  if (currentCount >= plan.limits.maxTeams) {
    throw new ApiError(
      403,
      `Your plan (${plan.name}) allows a maximum of ${plan.limits.maxTeams} team(s). Upgrade to add more.`
    );
  }

  const memberIds = members || [];
  if (memberIds.length > plan.limits.maxAgentsPerTeam) {
    throw new ApiError(
      403,
      `Your plan (${plan.name}) allows a maximum of ${plan.limits.maxAgentsPerTeam} agent(s) per team.`
    );
  }
  await assertOwnsAgents(ownerId, memberIds);

  const existing = await Team.findOne({ owner: ownerId, name });
  if (existing) throw new ApiError(409, "A team with this name already exists");

  return Team.create({ owner: ownerId, name, description, members: memberIds });
};

const listTeams = async (ownerId) => {
  return Team.find({ owner: ownerId }).sort({ createdAt: -1 }).populate("members", "name email avatar status");
};

const updateTeam = async (teamId, ownerId, { name, description, isActive }) => {
  const team = await getOwnedTeam(teamId, ownerId);

  if (name !== undefined && name !== team.name) {
    const existing = await Team.findOne({ owner: ownerId, name, _id: { $ne: team._id } });
    if (existing) throw new ApiError(409, "A team with this name already exists");
    team.name = name;
  }
  if (description !== undefined) team.description = description;
  if (isActive !== undefined) team.isActive = isActive;

  await team.save();
  return team;
};

const deleteTeam = async (teamId, ownerId) => {
  const team = await getOwnedTeam(teamId, ownerId);
  // Unlink from any bot that had this team assigned, so no dangling refs remain.
  await Bot.updateMany({ user: ownerId, assignedTeams: team._id }, { $pull: { assignedTeams: team._id } });
  await team.deleteOne();
};

const addMember = async (teamId, ownerId, agentId) => {
  const plan = await getActivePlan(ownerId);
  const team = await getOwnedTeam(teamId, ownerId);

  if (team.members.some((m) => m.toString() === agentId)) {
    throw new ApiError(409, "This agent is already on the team");
  }
  if (team.members.length >= plan.limits.maxAgentsPerTeam) {
    throw new ApiError(
      403,
      `Your plan (${plan.name}) allows a maximum of ${plan.limits.maxAgentsPerTeam} agent(s) per team.`
    );
  }
  await assertOwnsAgents(ownerId, [agentId]);

  team.members.push(agentId);
  await team.save();
  return team;
};

const removeMember = async (teamId, ownerId, agentId) => {
  const team = await getOwnedTeam(teamId, ownerId);
  team.members = team.members.filter((m) => m.toString() !== agentId);
  await team.save();
  return team;
};

module.exports = {
  getOwnedTeam,
  createTeam,
  listTeams,
  updateTeam,
  deleteTeam,
  addMember,
  removeMember,
};
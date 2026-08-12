const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const teamService = require("../services/team.service");
const { getActivePlan } = require("../services/bot.service");

const sanitizeTeam = (team) => ({
  id: team._id,
  name: team.name,
  description: team.description,
  isActive: team.isActive,
  members: (team.members || []).map((m) =>
    m?.name
      ? { id: m._id, name: m.name, email: m.email, avatar: m.avatar, status: m.status }
      : { id: m } // not populated (e.g. right after create)
  ),
  createdAt: team.createdAt,
});

// POST /api/teams
const createTeam = asyncHandler(async (req, res) => {
  const { name, description, members } = req.body;
  if (!name?.trim()) throw new ApiError(400, "Team name is required");

  const team = await teamService.createTeam({
    ownerId: req.user._id,
    name: name.trim(),
    description,
    members,
  });

  res.status(201).json({ success: true, data: { team: sanitizeTeam(team) } });
});

// GET /api/teams
const listTeams = asyncHandler(async (req, res) => {
  const [teams, plan] = await Promise.all([
    teamService.listTeams(req.user._id),
    getActivePlan(req.user._id),
  ]);

  res.status(200).json({
    success: true,
    data: {
      teams: teams.map(sanitizeTeam),
      limits: {
        maxTeams: plan.limits.maxTeams,
        maxAgentsPerTeam: plan.limits.maxAgentsPerTeam,
        used: teams.length,
      },
    },
  });
});

// PATCH /api/teams/:id
const updateTeam = asyncHandler(async (req, res) => {
  const { name, description, isActive } = req.body;
  const team = await teamService.updateTeam(req.params.id, req.user._id, { name, description, isActive });
  res.status(200).json({ success: true, data: { team: sanitizeTeam(team) } });
});

// DELETE /api/teams/:id
const deleteTeam = asyncHandler(async (req, res) => {
  await teamService.deleteTeam(req.params.id, req.user._id);
  res.status(200).json({ success: true, message: "Team deleted" });
});

// POST /api/teams/:id/members  body: { agentId }
const addMember = asyncHandler(async (req, res) => {
  const { agentId } = req.body;
  if (!agentId) throw new ApiError(400, "agentId is required");
  const team = await teamService.addMember(req.params.id, req.user._id, agentId);
  res.status(200).json({ success: true, data: { team: sanitizeTeam(team) } });
});

// DELETE /api/teams/:id/members/:agentId
const removeMember = asyncHandler(async (req, res) => {
  const team = await teamService.removeMember(req.params.id, req.user._id, req.params.agentId);
  res.status(200).json({ success: true, data: { team: sanitizeTeam(team) } });
});

module.exports = { createTeam, listTeams, updateTeam, deleteTeam, addMember, removeMember };
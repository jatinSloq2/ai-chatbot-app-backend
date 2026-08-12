const express = require("express");
const router = express.Router();

const teamController = require("../controllers/team.controller");
const { protect } = require("../middlewares/auth.middleware");

router.use(protect);

router.post("/", teamController.createTeam);
router.get("/", teamController.listTeams);
router.patch("/:id", teamController.updateTeam);
router.delete("/:id", teamController.deleteTeam);
router.post("/:id/members", teamController.addMember);
router.delete("/:id/members/:agentId", teamController.removeMember);

module.exports = router;
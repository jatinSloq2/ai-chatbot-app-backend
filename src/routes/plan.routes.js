const express = require("express");
const router = express.Router();
const planController = require("../controllers/plan.controller");

router.get("/", planController.listPlans);

module.exports = router;

const express = require("express");
const router = express.Router();

const cannedResponseController = require("../controllers/cannedResponse.controller");
const { protect } = require("../middlewares/auth.middleware");
const { mediaUpload } = require("../middlewares/upload.middleware");

router.use(protect);

router.post("/", mediaUpload.array("media", 5), cannedResponseController.createCannedResponse);
router.get("/", cannedResponseController.listCannedResponses);
router.patch("/:id", mediaUpload.array("media", 5), cannedResponseController.updateCannedResponse);
router.delete("/:id", cannedResponseController.deleteCannedResponse);

module.exports = router;
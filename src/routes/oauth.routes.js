const express = require("express");
const router = express.Router();

const oauthController = require("../controllers/oauth.controller");
const { protect } = require("../middlewares/auth.middleware");

// Init routes are hit as a real browser navigation (window.location.href =
// this URL, not fetch/axios) from the "Connect Gmail / Connect Outlook"
// buttons, so the httpOnly accessToken cookie rides along and `protect`
// resolves req.user normally.
router.get("/google/init", protect, oauthController.initGoogle);
router.get("/microsoft/init", protect, oauthController.initMicrosoft);

// Callback routes are hit by Google/Microsoft redirecting the browser back
// to us — no auth cookie context expected/required here, identity comes
// from the signed `state` param instead (see emailOauth.service.js).
router.get("/google/callback", oauthController.callbackGoogle);
router.get("/microsoft/callback", oauthController.callbackMicrosoft);

module.exports = router;
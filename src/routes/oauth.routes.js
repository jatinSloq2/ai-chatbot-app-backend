const express = require("express");
const router = express.Router();

const oauthController = require("../controllers/oauth.controller");
const { protect } = require("../middlewares/auth.middleware");

// Init is hit as a real browser navigation (window.location.href = this URL,
// not fetch/axios) from the "Connect Gmail" button, so the httpOnly
// accessToken cookie rides along and `protect` resolves req.user normally.
router.get("/google/init", protect, oauthController.initGoogle);

// Callback is hit by Google redirecting the browser back to us — no auth
// cookie context expected/required here, identity comes from the signed
// `state` param instead (see emailOauth.service.js).
router.get("/google/callback", oauthController.callbackGoogle);

module.exports = router;
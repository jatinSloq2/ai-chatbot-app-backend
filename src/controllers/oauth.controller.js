const asyncHandler = require("../utils/asyncHandler");
const oauthService = require("../services/emailOauth.service");

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const REDIRECT_BACK = (params) => `${CLIENT_URL}/credentials?${new URLSearchParams(params).toString()}`;

// GET /api/oauth/google/init  (protected — needs a logged-in user)
const initGoogle = asyncHandler(async (req, res) => {
  const url = oauthService.buildAuthUrl("google", String(req.user._id));
  res.redirect(url);
});

// Callback handler — Google lands the user's browser here directly (not an
// API/XHR call), so on any failure we redirect back into the dashboard with
// an error message instead of returning raw JSON the user would never see.
const handleCallback = (provider) =>
  asyncHandler(async (req, res) => {
    const { code, error, state } = req.query;

    if (error) {
      return res.redirect(REDIRECT_BACK({ connected: provider, status: "error", message: String(error) }));
    }
    if (!code || !state) {
      return res.redirect(REDIRECT_BACK({ connected: provider, status: "error", message: "Missing code or state" }));
    }

    let userId;
    try {
      ({ userId } = oauthService.verifyState(String(state)));
    } catch (err) {
      return res.redirect(REDIRECT_BACK({ connected: provider, status: "error", message: err.message }));
    }

    try {
      const tokenData = await oauthService.exchangeCodeForTokens(provider, String(code));
      const email = await oauthService.fetchProfileEmail(provider, tokenData.access_token);
      await oauthService.upsertOauthCredential({ userId, provider, tokenData, email });
      return res.redirect(REDIRECT_BACK({ connected: provider, status: "success", email }));
    } catch (err) {
      const message =
        err?.response?.data?.error_description || err?.response?.data?.error || err?.message || "Connection failed";
      return res.redirect(REDIRECT_BACK({ connected: provider, status: "error", message }));
    }
  });

const callbackGoogle = handleCallback("google");

module.exports = { initGoogle, callbackGoogle };
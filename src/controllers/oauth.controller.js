const asyncHandler = require("../utils/asyncHandler");
const oauthService = require("../services/emailOauth.service");
const sheetsOauthService = require("../services/googleSheetsOauth.service");

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const REDIRECT_BACK = (params) => `${CLIENT_URL}/credentials?${new URLSearchParams(params).toString()}`;

// GET /api/oauth/google/init  (protected — needs a logged-in user)
// One flow, both permissions: the consent screen asks for gmail.send AND
// spreadsheets together (see config/oauthProviders.js), so connecting
// Google once is enough to power both the Email channel and the bot Tools'
// Google Sheets data layer — no separate "Connect Sheets" OAuth flow.
//
// `?intent=sheets` (passed by the "Connect with Google" button on the
// Google Sheets tab) just controls which tab/follow-up the user lands back
// on afterwards — it does not change what's requested or granted.
const initGoogle = asyncHandler(async (req, res) => {
  const intent = req.query.intent === "sheets" ? "sheets" : "email";
  const url = oauthService.buildAuthUrl("google", String(req.user._id), { intent });
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

    let userId, intent;
    try {
      ({ userId, intent } = oauthService.verifyState(String(state)));
    } catch (err) {
      return res.redirect(REDIRECT_BACK({ connected: provider, status: "error", message: err.message }));
    }

    try {
      const tokenData = await oauthService.exchangeCodeForTokens(provider, String(code));
      const email = await oauthService.fetchProfileEmail(provider, tokenData.access_token);
      await oauthService.upsertOauthCredential({ userId, provider, tokenData, email });

      const extraParams = {};
      if (provider === "google") {
        // Same token, same consent — also populate the Google Sheets
        // credential so it's ready for "create a new sheet"/"use an
        // existing one" without asking the user to sign in again.
        const sheetsCred = await sheetsOauthService.upsertOauthCredential({ userId, tokenData, email });
        extraParams.sheetsCredentialId = String(sheetsCred._id);
        if (intent) extraParams.intent = intent;
      }

      return res.redirect(REDIRECT_BACK({ connected: provider, status: "success", email, ...extraParams }));
    } catch (err) {
      const message =
        err?.response?.data?.error_description || err?.response?.data?.error || err?.message || "Connection failed";
      return res.redirect(REDIRECT_BACK({ connected: provider, status: "error", message }));
    }
  });

const callbackGoogle = handleCallback("google");

module.exports = { initGoogle, callbackGoogle };
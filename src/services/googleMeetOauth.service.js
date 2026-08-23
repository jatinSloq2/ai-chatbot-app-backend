const IntegrationCredential = require("../models/IntegrationCredential");
const ApiError = require("../utils/ApiError");
const emailOauthService = require("./emailOauth.service"); // for refreshAccessToken only — token exchange itself happens once, in oauth.controller.js's single "google" callback

// Step 4 (mirrors googleSheetsOauth.service.js#upsertOauthCredential,
// targeting credential.meetingScheduling.googleMeet instead of
// credential.googleSheets): called right after the *same* "Connect Google"
// callback that connects Gmail + Sheets — all three channels are populated
// from the one token exchange, since the single consent screen now also
// asks for the calendar.events scope (see config/oauthProviders.js). One
// Google account can only be attached to one google_meet credential per
// user; reconnecting updates tokens in place.
const upsertOauthCredential = async ({ userId, tokenData, email }) => {
  const oauthPayload = {
    email,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    tokenExpiry: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000),
  };

  const existing = await IntegrationCredential.findOne({
    user: userId,
    channel: "meeting_scheduling",
    "meetingScheduling.provider": "google_meet",
    "meetingScheduling.googleMeet.email": email,
  });

  if (existing) {
    existing.meetingScheduling.googleMeet.accessToken = oauthPayload.accessToken;
    if (oauthPayload.refreshToken) existing.meetingScheduling.googleMeet.refreshToken = oauthPayload.refreshToken;
    existing.meetingScheduling.googleMeet.tokenExpiry = oauthPayload.tokenExpiry;
    existing.status = "connected";
    existing.lastCheckedAt = new Date();
    existing.lastError = undefined;
    await existing.save();
    return existing;
  }

  const existingCount = await IntegrationCredential.countDocuments({ user: userId, channel: "meeting_scheduling" });

  return IntegrationCredential.create({
    user: userId,
    channel: "meeting_scheduling",
    label: `Google Meet · ${email}`,
    isDefault: existingCount === 0,
    status: "connected",
    lastCheckedAt: new Date(),
    meetingScheduling: {
      provider: "google_meet",
      googleMeet: { ...oauthPayload, calendarId: "primary" },
    },
  });
};

// Mirrors googleSheetsOauth.service.js#getValidAccessToken, targeting
// credentialDoc.meetingScheduling.googleMeet.* instead of
// credentialDoc.googleSheets.*. Same OAuth client/grant as Email/Sheets —
// this just refreshes and persists the token on this particular credential
// document.
const getValidAccessToken = async (credentialDoc) => {
  const oauth = credentialDoc.meetingScheduling?.googleMeet;
  if (!oauth?.accessToken) throw new ApiError(400, "No access token stored for this Google Meet connection");

  const expiresSoon = !oauth.tokenExpiry || new Date(oauth.tokenExpiry).getTime() - Date.now() < 60 * 1000;
  if (!expiresSoon) return oauth.accessToken;

  if (!oauth.refreshToken) {
    credentialDoc.status = "expired";
    credentialDoc.lastError = "No refresh token stored — please reconnect this account";
    await credentialDoc.save().catch(() => {});
    throw new ApiError(400, "Access token expired and no refresh token is stored — please reconnect this account");
  }

  let tokenData;
  try {
    tokenData = await emailOauthService.refreshAccessToken("google", oauth.refreshToken);
  } catch (err) {
    const code = err?.response?.data?.error;
    if (code === "invalid_grant") {
      credentialDoc.status = "expired";
      credentialDoc.lastError = "This account's access was revoked or expired — please reconnect it";
      await credentialDoc.save().catch(() => {});
      throw new ApiError(400, "This account's access was revoked or expired — please reconnect it from the Credentials page");
    }
    throw new ApiError(502, `Couldn't refresh Google access token: ${err.message}`);
  }

  credentialDoc.meetingScheduling.googleMeet.accessToken = tokenData.access_token;
  if (tokenData.refresh_token) credentialDoc.meetingScheduling.googleMeet.refreshToken = tokenData.refresh_token;
  credentialDoc.meetingScheduling.googleMeet.tokenExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);
  credentialDoc.status = "connected";
  credentialDoc.lastError = undefined;
  await credentialDoc.save();

  return tokenData.access_token;
};

module.exports = { upsertOauthCredential, getValidAccessToken };

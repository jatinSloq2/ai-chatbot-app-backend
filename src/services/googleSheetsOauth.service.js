const IntegrationCredential = require("../models/IntegrationCredential");
const googleSheetsService = require("./googleSheets.service");
const ApiError = require("../utils/ApiError");
const emailOauthService = require("./emailOauth.service"); // for refreshAccessToken only — token exchange itself happens once, in oauth.controller.js's single "google" callback

// Step 4 (mirrors emailOauth.service.js#upsertOauthCredential, targeting
// credential.googleSheets instead of credential.email): called right after
// the *same* "Connect Google" callback that connects Gmail — both channels
// are populated from the one token exchange, since the single consent
// screen now asks for both gmail.send and spreadsheets scopes together (see
// config/oauthProviders.js). One Google account can only be attached to one
// Sheets credential per user; reconnecting updates tokens in place. No
// spreadsheetId yet at this point — that's chosen in a follow-up step
// (createSpreadsheet/attachSpreadsheet below), same as picking a mailbox is
// separate from connecting Gmail.
const upsertOauthCredential = async ({ userId, tokenData, email }) => {
  const oauthPayload = {
    email,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    tokenExpiry: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000),
  };

  const existing = await IntegrationCredential.findOne({
    user: userId,
    channel: "google_sheets",
    "googleSheets.method": "oauth",
    "googleSheets.oauth.email": email,
  });

  if (existing) {
    existing.googleSheets.oauth.accessToken = oauthPayload.accessToken;
    if (oauthPayload.refreshToken) existing.googleSheets.oauth.refreshToken = oauthPayload.refreshToken;
    existing.googleSheets.oauth.tokenExpiry = oauthPayload.tokenExpiry;
    existing.status = "connected";
    existing.lastCheckedAt = new Date();
    existing.lastError = undefined;
    await existing.save();
    return existing;
  }

  const existingCount = await IntegrationCredential.countDocuments({ user: userId, channel: "google_sheets" });

  return IntegrationCredential.create({
    user: userId,
    channel: "google_sheets",
    label: `Google Sheets · ${email}`,
    isDefault: existingCount === 0,
    status: "connected",
    lastCheckedAt: new Date(),
    googleSheets: { method: "oauth", oauth: oauthPayload, sheets: [] },
  });
};

// Mirrors emailOauth.service.js#getValidAccessToken, targeting
// credentialDoc.googleSheets.oauth instead of credentialDoc.email.oauth.
// Google issues one token per grant, so a refresh here uses the exact same
// refreshAccessToken("google", ...) call the email side uses — it's the
// same OAuth client/grant, just stored under a different credential doc.
const getValidAccessToken = async (credentialDoc) => {
  const oauth = credentialDoc.googleSheets?.oauth;
  if (!oauth?.accessToken) throw new ApiError(400, "No access token stored for this Google Sheets connection");

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

  credentialDoc.googleSheets.oauth.accessToken = tokenData.access_token;
  if (tokenData.refresh_token) credentialDoc.googleSheets.oauth.refreshToken = tokenData.refresh_token;
  credentialDoc.googleSheets.oauth.tokenExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);
  credentialDoc.status = "connected";
  credentialDoc.lastError = undefined;
  await credentialDoc.save();

  return tokenData.access_token;
};

// "Create a new sheet" follow-up action — makes a brand-new spreadsheet
// under the connected Google account, sets up the 6 tabs, and adds it to
// this credential's `sheets` list (one Google account can back many sheets,
// each usable by a different bot).
const createSpreadsheet = async (credentialDoc, title, label) => {
  const accessToken = await getValidAccessToken(credentialDoc);
  const created = await googleSheetsService.createSpreadsheet(accessToken, title || "Bot Data");
  await googleSheetsService.ensureSheetStructure(accessToken, created.spreadsheetId);

  credentialDoc.googleSheets.sheets.push({
    label: label || title || "Bot Data",
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl: created.spreadsheetUrl,
    tabsInitialized: true,
  });
  await credentialDoc.save();
  return credentialDoc.googleSheets.sheets[credentialDoc.googleSheets.sheets.length - 1];
};

// "Use an existing sheet" follow-up action — validates the connected
// account actually has edit access to the pasted sheet, then adds it to
// this credential's `sheets` list. Re-attaching a sheet already on the list
// just refreshes it in place instead of creating a duplicate entry.
const attachSpreadsheet = async (credentialDoc, spreadsheetIdOrUrl, label) => {
  const accessToken = await getValidAccessToken(credentialDoc);
  const spreadsheetId = googleSheetsService.extractSpreadsheetId(spreadsheetIdOrUrl);
  await googleSheetsService.ensureSheetStructure(accessToken, spreadsheetId); // also validates access — throws 403/404 otherwise

  const existing = credentialDoc.googleSheets.sheets.find((s) => s.spreadsheetId === spreadsheetId);
  if (existing) {
    existing.tabsInitialized = true;
    if (label) existing.label = label;
    if (spreadsheetIdOrUrl.startsWith("http")) existing.spreadsheetUrl = spreadsheetIdOrUrl;
    await credentialDoc.save();
    return existing;
  }

  credentialDoc.googleSheets.sheets.push({
    label: label || `Sheet ${credentialDoc.googleSheets.sheets.length + 1}`,
    spreadsheetId,
    spreadsheetUrl: spreadsheetIdOrUrl.startsWith("http") ? spreadsheetIdOrUrl : undefined,
    tabsInitialized: true,
  });
  await credentialDoc.save();
  return credentialDoc.googleSheets.sheets[credentialDoc.googleSheets.sheets.length - 1];
};

// Relabels a sheet entry — purely our own metadata, doesn't rename the
// actual Google spreadsheet file.
const renameSheet = async (credentialDoc, sheetEntryId, label) => {
  const entry = credentialDoc.googleSheets.sheets.id(sheetEntryId);
  if (!entry) throw new ApiError(404, "Sheet not found on this credential");
  entry.label = label;
  await credentialDoc.save();
  return entry;
};

// Removes a sheet from this credential's list (doesn't delete or touch the
// actual Google spreadsheet — just stops offering it to bots here).
const removeSheet = async (credentialDoc, sheetEntryId) => {
  const entry = credentialDoc.googleSheets.sheets.id(sheetEntryId);
  if (!entry) throw new ApiError(404, "Sheet not found on this credential");
  entry.deleteOne();
  await credentialDoc.save();
};

module.exports = {
  upsertOauthCredential,
  getValidAccessToken,
  createSpreadsheet,
  attachSpreadsheet,
  renameSheet,
  removeSheet,
};
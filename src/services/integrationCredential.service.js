const IntegrationCredential = require("../models/IntegrationCredential");
const ApiError = require("../utils/ApiError");
const { runConnectionTest } = require("./integrationTest.service");

const CHANNEL_FIELD = {
  email: "email",
  whatsapp: "whatsapp",
  sms: "sms",
  ai_provider: "aiProvider",
  google_sheets: "googleSheets",
};

const getOwnedCredential = async (id, userId) => {
  const cred = await IntegrationCredential.findOne({ _id: id, user: userId });
  if (!cred) throw new ApiError(404, "Credential not found");
  return cred;
};

const listCredentials = async (userId, channel) => {
  const filter = { user: userId };
  if (channel) filter.channel = channel;
  return IntegrationCredential.find(filter).sort({ channel: 1, createdAt: -1 });
};

// Unsets isDefault on every other credential of the same channel.
const clearOtherDefaults = async (userId, channel, keepId) => {
  await IntegrationCredential.updateMany(
    { user: userId, channel, _id: { $ne: keepId } },
    { $set: { isDefault: false } }
  );
};

// Normalizes a pasted spreadsheet URL/ID down to just the ID, and pulls the
// service account's email out of the pasted JSON key so the UI can show
// "share your sheet with this address" without re-parsing it every render.
const normalizeGoogleSheetsPayload = (payload) => {
  if (!payload) return payload;
  const googleSheetsService = require("./googleSheets.service");
  const out = { ...payload };
  if (out.spreadsheetId) {
    out.spreadsheetUrl = out.spreadsheetUrl || out.spreadsheetId;
    out.spreadsheetId = googleSheetsService.extractSpreadsheetId(out.spreadsheetId);
  }
  if (out.serviceAccountJson) {
    const account = googleSheetsService.parseServiceAccount(out.serviceAccountJson);
    out.serviceAccountEmail = account.client_email;
  }
  return out;
};

const createCredential = async ({ userId, channel, label, payload, isDefault }) => {
  const field = CHANNEL_FIELD[channel];
  if (!field) throw new ApiError(400, "Invalid channel");

  if (channel === "google_sheets") payload = normalizeGoogleSheetsPayload(payload);

  const cred = await IntegrationCredential.create({
    user: userId,
    channel,
    label: label?.trim() || undefined,
    [field]: payload,
    isDefault: !!isDefault,
  });

  if (cred.isDefault) await clearOtherDefaults(userId, channel, cred._id);
  return cred;
};

// Shallow-merges new payload fields onto the existing sub-document, so a
// partial update (e.g. just replacing an API key) doesn't wipe other fields.
// A secret field explicitly sent as "" is treated as "leave unchanged" so
// the frontend never has to resend a value it can't see (it's masked).
const updateCredential = async (id, userId, { label, payload, isActive, isDefault }) => {
  const cred = await getOwnedCredential(id, userId);
  const field = CHANNEL_FIELD[cred.channel];

  if (label !== undefined) cred.label = label?.trim() || undefined;
  if (isActive !== undefined) cred.isActive = isActive;

  if (payload && typeof payload === "object") {
    if (cred.channel === "google_sheets") payload = normalizeGoogleSheetsPayload(payload);
    const current = cred[field]?.toObject ? cred[field].toObject({ getters: true }) : cred[field] || {};
    const merged = mergeDeep(current, payload);
    cred[field] = merged;
  }

  cred.status = "unverified";
  cred.lastError = undefined;

  await cred.save();

  if (isDefault) {
    await clearOtherDefaults(userId, cred.channel, cred._id);
  }
  if (isDefault !== undefined) cred.isDefault = isDefault;
  if (isDefault !== undefined) await cred.save();
  return cred;
};

// Small recursive merge that skips empty-string values (== "leave unchanged"
// for masked secret fields) and undefined values.
function mergeDeep(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (val === "" || val === undefined) continue;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      out[key] = mergeDeep(out[key] || {}, val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

const deleteCredential = async (id, userId) => {
  const cred = await getOwnedCredential(id, userId);
  await cred.deleteOne()
};

// Resolves which credential to actually use for a given user+channel at
// send time: the explicit default if it's active, otherwise the most
// recently created active credential on that channel, otherwise null (caller
// falls back to platform defaults / logs, depending on channel).
const getDefaultCredential = async (userId, channel) => {
  const preferred = await IntegrationCredential.findOne({ user: userId, channel, isDefault: true, isActive: true });
  if (preferred) return preferred;
  return IntegrationCredential.findOne({ user: userId, channel, isActive: true }).sort({ createdAt: -1 });
};

const setDefault = async (id, userId) => {
  const cred = await getOwnedCredential(id, userId);
  cred.isDefault = true;
  await cred.save();
  await clearOtherDefaults(userId, cred.channel, cred._id)
  return cred;
};

// Never throws on a failed *test* (a bad key is an expected outcome, not a
// server error) — it records status: 'failed' + lastError on the document
// and returns it so the frontend can render the failure inline. It only
// throws ApiError for things like "credential not found".
const testConnection = async (id, userId) => {
  const cred = await getOwnedCredential(id, userId);
  try {
    await runConnectionTest(cred);
    // For the service_account method this is the single sheet's flag; for
    // oauth, each sheet's own tabsInitialized is set individually when it's
    // created/attached (see googleSheetsOauth.service.js) — nothing to flip
    // here, "test connection" for oauth just confirms the account token works.
    if (cred.channel === "google_sheets" && cred.googleSheets.method === "service_account") {
      cred.googleSheets.tabsInitialized = true;
    }
    await cred.markVerified();
  } catch (err) {
    const message =
      err?.response?.data?.error?.message ||
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      "Connection test failed";
    await cred.markFailed(message);
  }
  return cred;
};

module.exports = {
  getOwnedCredential,
  listCredentials,
  createCredential,
  updateCredential,
  deleteCredential,
  getDefaultCredential,
  setDefault,
  testConnection,
};
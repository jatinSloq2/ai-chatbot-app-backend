const axios = require("axios");
const jwt = require("jsonwebtoken");
const ApiError = require("../utils/ApiError");

// ---------------------------------------------------------------------------
// Thin wrapper around the Google Sheets v4 REST API, authenticated as a
// Google service account (JSON key downloaded from GCP console → IAM →
// Service Accounts → Keys). No `googleapis` dependency needed — we sign our
// own JWT (RS256, using the already-installed `jsonwebtoken` package) and
// exchange it for a short-lived OAuth2 access token per request.
//
// The sheet itself must be shared as "Editor" with the service account's
// client_email — same as sharing a Google Doc with another person.
//
// This is the single data layer described in the master spec doc: one
// spreadsheet, six tabs (Items / Availability / Orders / Users / Payments /
// Tickets), read and written by services/botTools.service.js.
// ---------------------------------------------------------------------------

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

// The exact tab layout from the master spec (Part 1). Column order here IS
// the column order written to the sheet — keep it in sync with the doc.
const REQUIRED_TABS = {
  Items: [
    "item_id", "item_type", "name", "category", "description", "price", "currency",
    "stock_qty", "duration_mins", "capacity_per_slot", "image_url", "status",
  ],
  Availability: ["item_id", "date", "time_slot", "capacity", "booked_count", "status"],
  Orders: [
    "order_id", "user_id", "item_id", "qty_or_people", "date_or_slot", "delivery_address",
    "total_amount", "order_status", "payment_status", "created_at", "updated_at",
  ],
  Users: ["user_id", "name", "phone", "email", "address", "created_at"],
  Payments: [
    "payment_id", "order_id", "amount", "status", "method", "paid_at",
    "gateway_ref", "gateway_payment_id", "payment_link_url",
  ],
  Tickets: ["ticket_id", "user_id", "order_id", "category", "description", "status", "created_at"],
};

// Accepts either a bare spreadsheet ID or a full
// https://docs.google.com/spreadsheets/d/<ID>/edit... URL.
const extractSpreadsheetId = (input) => {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
};

const parseServiceAccount = (serviceAccountJson) => {
  let parsed;
  try {
    parsed = typeof serviceAccountJson === "string" ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  } catch {
    throw new ApiError(400, "Service account JSON is not valid JSON");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new ApiError(400, "Service account JSON is missing client_email or private_key");
  }
  return parsed;
};

// Exchanges the service account key for a short-lived (1hr) OAuth2 access
// token. Not cached across requests — each tool call is infrequent enough
// (a handful per chat message, at most) that re-minting a token is cheap
// and avoids any cross-request token-expiry bookkeeping.
const getAccessToken = async (serviceAccountJson) => {
  const account = parseServiceAccount(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const assertion = jwt.sign(
    {
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    },
    account.private_key,
    { algorithm: "RS256" }
  );

  try {
    const { data } = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 }
    );
    return data.access_token;
  } catch (err) {
    const msg = err.response?.data?.error_description || err.response?.data?.error || err.message;
    throw new ApiError(502, `Google auth failed: ${msg}`);
  }
};

const authHeaders = (accessToken) => ({ Authorization: `Bearer ${accessToken}` });

// Creates a brand-new spreadsheet under the authenticated account (used by
// the "Create a new sheet" OAuth follow-up flow — see
// googleSheetsOauth.service.js#createSpreadsheet).
const createSpreadsheet = async (accessToken, title) => {
  try {
    const { data } = await axios.post(
      SHEETS_API,
      { properties: { title: title || "Bot Data" } },
      { headers: authHeaders(accessToken), timeout: 15000 }
    );
    return {
      spreadsheetId: data.spreadsheetId,
      spreadsheetUrl: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}`,
    };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new ApiError(502, `Couldn't create a new spreadsheet: ${msg}`);
  }
};

// --- Spreadsheet-level ---

const getSpreadsheetMeta = async (accessToken, spreadsheetId) => {
  try {
    const { data } = await axios.get(`${SHEETS_API}/${spreadsheetId}`, {
      headers: authHeaders(accessToken),
      params: { fields: "spreadsheetId,properties.title,sheets.properties" },
      timeout: 10000,
    });
    return data;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    if (err.response?.status === 404) throw new ApiError(404, "Spreadsheet not found — check the ID/URL");
    if (err.response?.status === 403) {
      throw new ApiError(403, `Sheet isn't shared with the service account (Editor access required): ${msg}`);
    }
    throw new ApiError(502, `Google Sheets request failed: ${msg}`);
  }
};

// Creates any missing tabs and writes the header row into each, so a fresh
// spreadsheet ends up with the exact 6-tab layout the tool spec expects.
// Idempotent — safe to call every time a credential is saved/tested.
const ensureSheetStructure = async (accessToken, spreadsheetId) => {
  const meta = await getSpreadsheetMeta(accessToken, spreadsheetId);
  const existingSheets = meta.sheets || [];
  const existingTitles = new Set(existingSheets.map((s) => s.properties.title));
  const requiredTitles = Object.keys(REQUIRED_TABS);
  const missing = requiredTitles.filter((title) => !existingTitles.has(title));

  const requests = [];

  // Google always creates one default tab (usually "Sheet1") when a
  // spreadsheet is made via spreadsheets.create — left alone, that becomes
  // useless clutter sitting next to our 6 tabs on every new sheet. On a
  // genuinely fresh spreadsheet (exactly one sheet, and it isn't already
  // one of ours), rename that default tab straight into our layout instead
  // of leaving it behind and adding a 7th tab.
  if (existingSheets.length === 1 && !requiredTitles.includes(existingSheets[0].properties.title) && missing.length) {
    const firstMissing = missing.shift();
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: existingSheets[0].properties.sheetId, title: firstMissing },
        fields: "title",
      },
    });
  }

  requests.push(...missing.map((title) => ({ addSheet: { properties: { title } } })));

  if (requests.length) {
    try {
      await axios.post(
        `${SHEETS_API}/${spreadsheetId}:batchUpdate`,
        { requests },
        { headers: authHeaders(accessToken), timeout: 10000 }
      );
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      throw new ApiError(502, `Couldn't set up sheet tabs: ${msg}`);
    }
  }

  // Header rows — safe to re-write every time (values.update overwrites row 1
  // in place, doesn't touch existing data rows below it).
  const data = Object.entries(REQUIRED_TABS).map(([title, headers]) => ({
    range: `${title}!A1`,
    values: [headers],
  }));

  try {
    await axios.post(
      `${SHEETS_API}/${spreadsheetId}/values:batchUpdate`,
      { valueInputOption: "RAW", data },
      { headers: authHeaders(accessToken), timeout: 10000 }
    );
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new ApiError(502, `Couldn't write header rows: ${msg}`);
  }

  return { tabsCreated: missing };
};

// --- Row-level (tab = one of the REQUIRED_TABS keys) ---

// Reads every row in a tab and maps it to an array of plain objects keyed
// by the header row (row 1). Ignores completely blank rows.
const getRows = async (accessToken, spreadsheetId, tab) => {
  const headers = REQUIRED_TABS[tab];
  if (!headers) throw new ApiError(400, `Unknown sheet tab "${tab}"`);

  let data;
  try {
    ({ data } = await axios.get(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tab)}!A2:Z10000`, {
      headers: authHeaders(accessToken),
      params: { valueRenderOption: "UNFORMATTED_VALUE" },
      timeout: 15000,
    }));
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new ApiError(502, `Couldn't read "${tab}" tab: ${msg}`);
  }

  const rows = data.values || [];
  return rows
    .map((row, idx) => {
      const obj = { _row: idx + 2 }; // absolute sheet row number, for updates
      headers.forEach((h, i) => (obj[h] = row[i] !== undefined ? row[i] : ""));
      return obj;
    })
    .filter((obj) => headers.some((h) => obj[h] !== "" && obj[h] !== undefined));
};

// Appends one row, filling columns in the tab's fixed header order.
const appendRow = async (accessToken, spreadsheetId, tab, rowObject) => {
  const headers = REQUIRED_TABS[tab];
  if (!headers) throw new ApiError(400, `Unknown sheet tab "${tab}"`);

  const values = [headers.map((h) => (rowObject[h] !== undefined && rowObject[h] !== null ? rowObject[h] : ""))];

  try {
    await axios.post(
      `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tab)}!A:${String.fromCharCode(64 + headers.length)}:append`,
      { values },
      { headers: authHeaders(accessToken), params: { valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" }, timeout: 15000 }
    );
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new ApiError(502, `Couldn't write to "${tab}" tab: ${msg}`);
  }
};

// Finds a row by an exact match on `keyColumn`, patches only the given
// fields (leaves everything else in the row untouched), and writes it back.
const updateRowByKey = async (accessToken, spreadsheetId, tab, keyColumn, keyValue, patch) => {
  const headers = REQUIRED_TABS[tab];
  if (!headers) throw new ApiError(400, `Unknown sheet tab "${tab}"`);

  const rows = await getRows(accessToken, spreadsheetId, tab);
  const match = rows.find((r) => String(r[keyColumn]) === String(keyValue));
  if (!match) return null;

  const merged = { ...match, ...patch };
  const values = [headers.map((h) => (merged[h] !== undefined && merged[h] !== null ? merged[h] : ""))];

  try {
    await axios.put(
      `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tab)}!A${match._row}:${String.fromCharCode(64 + headers.length)}${match._row}`,
      { values },
      { headers: authHeaders(accessToken), params: { valueInputOption: "RAW" }, timeout: 15000 }
    );
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw new ApiError(502, `Couldn't update "${tab}" tab: ${msg}`);
  }

  return merged;
};

const findRow = async (accessToken, spreadsheetId, tab, keyColumn, keyValue) => {
  const rows = await getRows(accessToken, spreadsheetId, tab);
  return rows.find((r) => String(r[keyColumn]) === String(keyValue)) || null;
};

// Convenience: given a saved googleSheets credential sub-document (already
// decrypted via the model's getters), returns { accessToken, spreadsheetId }
// ready to pass into the helpers above.
const authFromCredential = async (googleSheetsCred) => {
  if (!googleSheetsCred?.spreadsheetId || !googleSheetsCred?.serviceAccountJson) {
    throw new ApiError(400, "Google Sheets isn't fully connected on this credential");
  }
  const accessToken = await getAccessToken(googleSheetsCred.serviceAccountJson);
  return { accessToken, spreadsheetId: googleSheetsCred.spreadsheetId };
};

module.exports = {
  REQUIRED_TABS,
  extractSpreadsheetId,
  parseServiceAccount,
  getAccessToken,
  getSpreadsheetMeta,
  createSpreadsheet,
  ensureSheetStructure,
  getRows,
  appendRow,
  updateRowByKey,
  findRow,
  authFromCredential,
};
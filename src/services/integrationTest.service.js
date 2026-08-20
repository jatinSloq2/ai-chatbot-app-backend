const axios = require("axios");
const nodemailer = require("nodemailer");
const { signGetRequest } = require("../utils/awsSigV4");
const { getValidAccessToken } = require("./emailOauth.service");

// Every tester resolves { ok: true } or throws an Error with a human-readable
// message (caught by the caller and stored as lastError).

async function testAwsCredentials(accessKeyId, secretAccessKey, region = "us-east-1") {
  const { url, headers } = signGetRequest({
    accessKeyId,
    secretAccessKey,
    region,
    service: "sts",
    host: "sts.amazonaws.com",
    path: "/",
    query: { Action: "GetCallerIdentity", Version: "2011-06-15" },
  });
  await axios.get(url, { headers, timeout: 10000 });
}

// ---------------- EMAIL ----------------

async function testEmailSmtp(smtp) {
  if (!smtp?.host || !smtp?.port || !smtp?.username || !smtp?.password) {
    throw new Error("Host, port, username and password are all required");
  }
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.encryption === "ssl",
    requireTLS: smtp.encryption === "tls",
    auth: { user: smtp.username, pass: smtp.password },
    connectionTimeout: 10000,
  });
  await transporter.verify();
}

// Takes the full credential document (not just the oauth sub-object) so it
// can transparently refresh + persist an expired access token before
// testing it — this is the "real" refresh path a manually-pasted token
// never had.
async function testEmailOauth(cred) {
  const oauth = cred.email?.oauth;
  if (!oauth?.accessToken) throw new Error("No access token stored for this account — connect the account first");

  const accessToken = await getValidAccessToken(cred);

  if (oauth.provider === "google") {
    await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000,
    });
    return;
  }
  throw new Error("Unsupported OAuth provider");
}

async function testEmailApi(apiCfg) {
  const { provider, apiKey, accessKeyId, secretAccessKey, region } = apiCfg || {};
  if (provider === "sendgrid") {
    if (!apiKey) throw new Error("API key is required");
    await axios.get("https://api.sendgrid.com/v3/user/account", {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });
    return;
  }
  if (provider === "mailgun") {
    if (!apiKey) throw new Error("API key is required");
    await axios.get("https://api.mailgun.net/v3/domains", {
      auth: { username: "api", password: apiKey },
      timeout: 10000,
    });
    return;
  }
  if (provider === "postmark") {
    if (!apiKey) throw new Error("Server API token is required");
    await axios.get("https://api.postmarkapp.com/server", {
      headers: { "X-Postmark-Server-Token": apiKey, Accept: "application/json" },
      timeout: 10000,
    });
    return;
  }
  if (provider === "resend") {
    if (!apiKey) throw new Error("API key is required");
    await axios.get("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });
    return;
  }
  if (provider === "ses") {
    if (!accessKeyId || !secretAccessKey) throw new Error("Access key ID and secret access key are required");
    await testAwsCredentials(accessKeyId, secretAccessKey, region || "us-east-1");
    return;
  }
  throw new Error("Unsupported email API provider");
}

async function testEmail(cred) {
  const { method, smtp, api } = cred.email || {};
  if (method === "smtp") return testEmailSmtp(smtp);
  if (method === "oauth") return testEmailOauth(cred);
  if (method === "api") return testEmailApi(api);
  throw new Error("Unknown email method");
}

// ---------------- WHATSAPP ----------------

async function testWhatsapp(cred) {
  const { phoneNumberId, accessToken } = cred.whatsapp || {};
  if (!phoneNumberId || !accessToken) throw new Error("Phone Number ID and access token are required");
  await axios.get(`https://graph.facebook.com/v20.0/${phoneNumberId}`, {
    params: { fields: "verified_name,display_phone_number,quality_rating" },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000,
  });
}

// ---------------- SMS ----------------

async function testSms(cred) {
  const s = cred.sms || {};
  if (s.provider === "twilio") {
    if (!s.accountSid || !s.authToken) throw new Error("Account SID and auth token are required");
    await axios.get(`https://api.twilio.com/2010-04-01/Accounts/${s.accountSid}.json`, {
      auth: { username: s.accountSid, password: s.authToken },
      timeout: 10000,
    });
    return;
  }
  if (s.provider === "aws_sns") {
    if (!s.accessKeyId || !s.secretAccessKey) throw new Error("Access key ID and secret access key are required");
    await testAwsCredentials(s.accessKeyId, s.secretAccessKey, s.region || "us-east-1");
    return;
  }
  if (s.provider === "vonage") {
    if (!s.apiKey || !s.authToken) throw new Error("API key and API secret are required");
    await axios.get("https://rest.nexmo.com/account/get-balance", {
      params: { api_key: s.apiKey, api_secret: s.authToken },
      timeout: 10000,
    });
    return;
  }
  if (s.provider === "msg91") {
    if (!s.apiKey) throw new Error("Auth key is required");
    await axios.get("https://control.msg91.com/api/v5/user", {
      headers: { authkey: s.apiKey },
      timeout: 10000,
    });
    return;
  }
  throw new Error("Unsupported SMS provider");
}

// ---------------- AI PROVIDER ----------------

async function testAiProvider(cred) {
  const a = cred.aiProvider || {};
  const { provider, apiKey, baseUrl, deploymentName, apiVersion, gcpProjectId, region } = a;

  if (provider === "openai" || provider === "groq" || provider === "openrouter" || provider === "mistral") {
    if (!apiKey) throw new Error("API key is required");
    const urls = {
      openai: "https://api.openai.com/v1/models",
      groq: "https://api.groq.com/openai/v1/models",
      openrouter: "https://openrouter.ai/api/v1/models",
      mistral: "https://api.mistral.ai/v1/models",
    };
    await axios.get(urls[provider], { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 });
    return;
  }
  if (provider === "anthropic") {
    if (!apiKey) throw new Error("API key is required");
    await axios.get("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      timeout: 10000,
    });
    return;
  }
  if (provider === "cohere") {
    if (!apiKey) throw new Error("API key is required");
    await axios.get("https://api.cohere.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });
    return;
  }
  if (provider === "google") {
    if (!apiKey) throw new Error("API key is required");
    await axios.get("https://generativelanguage.googleapis.com/v1beta/models", {
      params: { key: apiKey },
      timeout: 10000,
    });
    return;
  }
  if (provider === "azure_openai") {
    if (!apiKey || !baseUrl) throw new Error("API key and endpoint URL are required");
    const url = `${baseUrl.replace(/\/$/, "")}/openai/deployments${
      deploymentName ? `/${deploymentName}` : ""
    }?api-version=${apiVersion || "2024-02-01"}`;
    await axios.get(url, { headers: { "api-key": apiKey }, timeout: 10000 });
    return;
  }
  if (provider === "vertex_ai") {
    if (!a.serviceAccountJson) throw new Error("Service account JSON is required");
    try {
      JSON.parse(a.serviceAccountJson);
    } catch {
      throw new Error("Service account JSON is not valid JSON");
    }
    if (!gcpProjectId) throw new Error("GCP project ID is required");
    // Full OAuth2 token exchange from a service account needs a JWT signer;
    // for now we validate the JSON shape + required fields are present.
    return;
  }
  if (provider === "ollama") {
    const url = `${(baseUrl || "http://localhost:11434").replace(/\/$/, "")}/api/tags`;
    await axios.get(url, { timeout: 10000 });
    return;
  }
  // "other" / self-hosted / proxy — nothing standard to call.
  throw new Error("Live test isn't supported for this provider yet — credential was saved");
}

// ---------------- GOOGLE SHEETS ----------------

async function testGoogleSheets(cred) {
  const g = cred.googleSheets || {};
  const googleSheetsService = require("./googleSheets.service");

  if (g.method === "oauth") {
    if (!g.spreadsheetId) {
      throw new Error("No sheet chosen yet — create a new one or attach an existing one first");
    }
    const googleSheetsOauthService = require("./googleSheetsOauth.service");
    const accessToken = await googleSheetsOauthService.getValidAccessToken(cred);
    await googleSheetsService.ensureSheetStructure(accessToken, g.spreadsheetId);
    return;
  }

  if (!g.spreadsheetId || !g.serviceAccountJson) {
    throw new Error("Spreadsheet ID/URL and service account JSON are both required");
  }
  const { accessToken, spreadsheetId } = await googleSheetsService.authFromCredential(g);
  // Also creates any missing Items/Availability/Orders/Users/Payments/Tickets
  // tabs + header rows — this is the moment a brand-new sheet gets set up.
  await googleSheetsService.ensureSheetStructure(accessToken, spreadsheetId);
}

// ---------------- RAZORPAY ----------------

async function testRazorpay(cred) {
  const r = cred.razorpay || {};
  if (!r.keyId || !r.keySecret) throw new Error("Key ID and Key Secret are both required");
  const razorpayService = require("./razorpay.service");
  // A cheap authenticated call — fails clearly (401) on bad keys without
  // creating/touching anything.
  await razorpayService.getClient(r.keyId, r.keySecret).orders.all({ count: 1 });
}

async function runConnectionTest(cred) {
  if (cred.channel === "email") return testEmail(cred);
  if (cred.channel === "whatsapp") return testWhatsapp(cred);
  if (cred.channel === "sms") return testSms(cred);
  if (cred.channel === "ai_provider") return testAiProvider(cred);
  if (cred.channel === "google_sheets") return testGoogleSheets(cred);
  if (cred.channel === "razorpay") return testRazorpay(cred);
  throw new Error("Unknown channel");
}

module.exports = { runConnectionTest };
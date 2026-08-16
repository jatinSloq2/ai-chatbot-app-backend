const axios = require("axios");
const nodemailer = require("nodemailer");
const { signGetRequest } = require("../utils/awsSigV4");
const { getValidAccessToken } = require("./emailOauth.service");

// Sends { to, subject, html, text } using whichever method the credential is
// configured with. `cred` is a full IntegrationCredential document (not just
// the .email sub-object) so OAuth token refresh can persist back to it.

async function sendViaSmtp(cred, msg) {
    const smtp = cred.email?.smtp || {};
    if (!smtp.host || !smtp.port || !smtp.username || !smtp.password) {
        throw new Error("SMTP host, port, username and password are all required");
    }
    const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.encryption === "ssl",
        requireTLS: smtp.encryption === "tls",
        auth: { user: smtp.username, pass: smtp.password },
        connectionTimeout: 10000,
    });
    await transporter.sendMail({
        from: fromHeader(cred),
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
    });
}

function fromHeader(cred) {
    const { fromEmail, fromName } = cred.email || {};
    if (!fromEmail) return undefined; // let the provider fall back to its own default sender
    return fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
}

function base64Url(input) {
    return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendViaOauth(cred, msg) {
    const oauth = cred.email?.oauth;
    if (!oauth?.accessToken) throw new Error("No connected mailbox — connect an account first");
    const accessToken = await getValidAccessToken(cred);

    if (oauth.provider === "google") {
        const from = cred.email?.fromEmail || oauth.email;
        const raw = [
            `From: ${from}`,
            `To: ${msg.to}`,
            `Subject: ${msg.subject}`,
            "MIME-Version: 1.0",
            "Content-Type: text/html; charset=UTF-8",
            "",
            msg.html || msg.text || "",
        ].join("\r\n");
        await axios.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            { raw: base64Url(raw) },
            { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 }
        );
        return;
    }

    if (oauth.provider === "microsoft") {
        await axios.post(
            "https://graph.microsoft.com/v1.0/me/sendMail",
            {
                message: {
                    subject: msg.subject,
                    body: { contentType: "HTML", content: msg.html || msg.text || "" },
                    toRecipients: [{ emailAddress: { address: msg.to } }],
                },
                saveToSentItems: false,
            },
            { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 }
        );
        return;
    }

    throw new Error(`Unsupported OAuth provider "${oauth.provider}"`);
}

async function sendViaSendgrid(api, msg, cred) {
    await axios.post(
        "https://api.sendgrid.com/v3/mail/send",
        {
            personalizations: [{ to: [{ email: msg.to }] }],
            from: { email: cred.email?.fromEmail || "no-reply@jestbot.app", name: cred.email?.fromName },
            subject: msg.subject,
            content: [{ type: "text/html", value: msg.html || msg.text || "" }],
        },
        { headers: { Authorization: `Bearer ${api.apiKey}` }, timeout: 10000 }
    );
}

async function sendViaMailgun(api, msg, cred) {
    if (!api.verifiedDomain) throw new Error("A verified sending domain is required for Mailgun");
    const body = new URLSearchParams({
        from: fromHeader(cred) || `no-reply@${api.verifiedDomain}`,
        to: msg.to,
        subject: msg.subject,
        html: msg.html || "",
        text: msg.text || "",
    });
    await axios.post(`https://api.mailgun.net/v3/${api.verifiedDomain}/messages`, body.toString(), {
        auth: { username: "api", password: api.apiKey },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000,
    });
}

async function sendViaPostmark(api, msg, cred) {
    await axios.post(
        "https://api.postmarkapp.com/email",
        {
            From: cred.email?.fromEmail || "no-reply@jestbot.app",
            To: msg.to,
            Subject: msg.subject,
            HtmlBody: msg.html,
            TextBody: msg.text,
        },
        { headers: { "X-Postmark-Server-Token": api.apiKey, Accept: "application/json" }, timeout: 10000 }
    );
}

async function sendViaResend(api, msg, cred) {
    await axios.post(
        "https://api.resend.com/emails",
        {
            from: fromHeader(cred) || "no-reply@jestbot.app",
            to: [msg.to],
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
        },
        { headers: { Authorization: `Bearer ${api.apiKey}` }, timeout: 10000 }
    );
}

// SES's "Query" API accepts simple actions over signed GET requests, which
// lets us reuse the same lightweight SigV4 helper used for credential
// testing instead of pulling in the full AWS SDK.
async function sendViaSes(api, msg, cred) {
    if (!api.accessKeyId || !api.secretAccessKey) throw new Error("AWS access key ID and secret access key are required");
    const region = api.region || "us-east-1";
    const { url, headers } = signGetRequest({
        accessKeyId: api.accessKeyId,
        secretAccessKey: api.secretAccessKey,
        region,
        service: "ses",
        host: `email.${region}.amazonaws.com`,
        path: "/",
        query: {
            Action: "SendEmail",
            Version: "2010-12-01",
            Source: cred.email?.fromEmail || `no-reply@${api.verifiedDomain || "jestbot.app"}`,
            "Destination.ToAddresses.member.1": msg.to,
            "Message.Subject.Data": msg.subject,
            "Message.Body.Html.Data": msg.html || msg.text || "",
        },
    });
    await axios.get(url, { headers, timeout: 10000 });
}

async function sendViaApi(cred, msg) {
    const api = cred.email?.api || {};
    if (api.provider === "sendgrid") return sendViaSendgrid(api, msg, cred);
    if (api.provider === "mailgun") return sendViaMailgun(api, msg, cred);
    if (api.provider === "postmark") return sendViaPostmark(api, msg, cred);
    if (api.provider === "resend") return sendViaResend(api, msg, cred);
    if (api.provider === "ses") return sendViaSes(api, msg, cred);
    throw new Error(`Unsupported email API provider "${api.provider}"`);
}

// cred: full IntegrationCredential doc (channel "email"). msg: { to, subject, html, text }
async function sendEmail(cred, msg) {
    const method = cred.email?.method;
    if (method === "smtp") return sendViaSmtp(cred, msg);
    if (method === "oauth") return sendViaOauth(cred, msg);
    if (method === "api") return sendViaApi(cred, msg);
    throw new Error("Unknown email delivery method on this credential");
}

module.exports = { sendEmail };
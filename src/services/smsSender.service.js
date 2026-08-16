const axios = require("axios");
const { signGetRequest } = require("../utils/awsSigV4");

// Every sender takes the credential's `sms` sub-object (already decrypted —
// secret fields decrypt transparently on property access) plus { to, message }
// and resolves once the message has been accepted by the provider, or throws
// an Error with a human-readable message.

async function sendViaTwilio(s, { to, message }) {
    if (!s.accountSid || !s.authToken) throw new Error("Twilio Account SID and auth token are required");
    if (!s.fromNumber) throw new Error("A Twilio 'From' number is required");

    const body = new URLSearchParams({ To: to, From: s.fromNumber, Body: message });
    await axios.post(`https://api.twilio.com/2010-04-01/Accounts/${s.accountSid}/Messages.json`, body.toString(), {
        auth: { username: s.accountSid, password: s.authToken },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000,
    });
}

async function sendViaAwsSns(s, { to, message }) {
    if (!s.accessKeyId || !s.secretAccessKey) throw new Error("AWS access key ID and secret access key are required");
    const region = s.region || "us-east-1";
    const { url, headers } = signGetRequest({
        accessKeyId: s.accessKeyId,
        secretAccessKey: s.secretAccessKey,
        region,
        service: "sns",
        host: `sns.${region}.amazonaws.com`,
        path: "/",
        query: {
            Action: "Publish",
            Version: "2010-03-31",
            PhoneNumber: to,
            Message: message,
            ...(s.senderId
                ? {
                    "MessageAttributes.entry.1.Name": "AWS.SNS.SMS.SenderID",
                    "MessageAttributes.entry.1.Value.DataType": "String",
                    "MessageAttributes.entry.1.Value.StringValue": s.senderId,
                }
                : {}),
        },
    });
    await axios.get(url, { headers, timeout: 10000 });
}

async function sendViaVonage(s, { to, message }) {
    if (!s.apiKey || !s.authToken) throw new Error("Vonage API key and API secret are required");
    const body = new URLSearchParams({
        api_key: s.apiKey,
        api_secret: s.authToken,
        to: to.replace(/^\+/, ""),
        from: s.senderId || s.fromNumber || "Verify",
        text: message,
    });
    const { data } = await axios.post("https://rest.nexmo.com/sms/json", body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000,
    });
    const status = data?.messages?.[0]?.status;
    if (status && status !== "0") {
        throw new Error(data.messages[0]["error-text"] || `Vonage rejected the message (status ${status})`);
    }
}

// Legacy but still-supported MSG91 HTTP send endpoint — chosen over the
// newer "flow" API because it doesn't require pre-provisioning a template
// flow_id, and it accepts DLT entity/template IDs as plain query params,
// which lines up with the fields we already collect on the credential.
async function sendViaMsg91(s, { to, message }) {
    if (!s.apiKey) throw new Error("MSG91 auth key is required");
    const mobile = to.replace(/^\+/, "");
    const params = {
        authkey: s.apiKey,
        mobiles: mobile,
        message,
        sender: s.senderId || "JESTBT",
        route: "4",
    };
    if (s.dlt?.entityId) params.DLT_TE_ID = s.dlt.templateId || s.dlt.entityId;
    const { data } = await axios.get("https://api.msg91.com/api/sendhttp.php", { params, timeout: 10000 });
    const text = typeof data === "string" ? data : JSON.stringify(data);
    if (/error/i.test(text)) throw new Error(`MSG91 error: ${text}`);
}

async function sendSms(cred, { to, message }) {
    const s = cred.sms || {};
    if (!to) throw new Error("A destination phone number is required");
    if (s.provider === "twilio") return sendViaTwilio(s, { to, message });
    if (s.provider === "aws_sns") return sendViaAwsSns(s, { to, message });
    if (s.provider === "vonage") return sendViaVonage(s, { to, message });
    if (s.provider === "msg91") return sendViaMsg91(s, { to, message });
    throw new Error(`Unsupported SMS provider "${s.provider}"`);
}

module.exports = { sendSms };
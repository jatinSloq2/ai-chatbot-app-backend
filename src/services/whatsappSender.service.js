const axios = require("axios");

const GRAPH_VERSION = "v25.0";

// Sends a plain text message via the Meta WhatsApp Cloud API.
// `cred` is an IntegrationCredential's decrypted `whatsapp` sub-object
// (phoneNumberId + accessToken); `to` is the recipient's number in the
// "wa_id" format Meta's webhook gives us back on `message.from` (digits
// only, no leading "+" — Meta accepts that same format on send).
async function sendWhatsappText(cred, { to, message }) {
    const { phoneNumberId, accessToken } = cred || {};
    if (!phoneNumberId || !accessToken) {
        throw new Error("WhatsApp credential is missing a Phone Number ID or access token");
    }
    if (!to) throw new Error("A destination WhatsApp number is required");
    if (!message?.trim()) throw new Error("message is required");

    await axios.post(
        `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
        {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "text",
            text: { preview_url: true, body: message },
        },
        {
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            timeout: 15000,
        }
    );
}

module.exports = { sendWhatsappText };
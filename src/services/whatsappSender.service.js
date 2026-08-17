const axios = require("axios");

const GRAPH_VERSION = "v25.0";

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

// Marks the visitor's inbound message as read AND shows the "..." typing
// bubble in their chat — same Graph API call does both. There's no
// separate "stop typing" endpoint: WhatsApp clears the indicator on its
// own, either when sendWhatsappText's actual reply lands or after ~25s,
// whichever is first. Meant to be fired as soon as we've committed to
// actually answering (i.e. after the usage/plan check passes, right
// before the RAG+LLM call starts) so the visitor sees feedback during
// whatever the retrieval+generation latency turns out to be.
async function sendTypingIndicator(cred, { messageId }) {
    const { phoneNumberId, accessToken } = cred || {};
    if (!phoneNumberId || !accessToken) {
        throw new Error("WhatsApp credential is missing a Phone Number ID or access token");
    }
    if (!messageId) throw new Error("A message id is required to show a typing indicator");

    await axios.post(
        `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
        {
            messaging_product: "whatsapp",
            status: "read",
            message_id: messageId,
            typing_indicator: { type: "text" },
        },
        {
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            timeout: 15000,
        }
    );
}

module.exports = { sendWhatsappText, sendTypingIndicator };
const axios = require("axios");

const GRAPH_VERSION = "v25.0";

// The AI's replies (and the RAG/tool-call pipeline behind them) are ordinary
// GitHub-flavored Markdown — **bold**, ## headings, ```js fenced code,
// [label](url) links — because nothing tells the model to write anything
// else. WhatsApp has its own, much smaller formatting dialect: bold is a
// SINGLE asterisk (*bold*), italic is an underscore (_italic_), there's no
// heading syntax at all, and a fenced code block can't carry a language tag
// on the opening line. Sent through untouched, "**order ID**" doesn't
// render bold on WhatsApp — it shows up as the literal asterisks. This
// converts the common cases right before anything goes out, so it applies
// no matter who/what produced the text (the AI, the "something went wrong"
// fallback, or an agent's typed reply during handover).
const markdownToWhatsApp = (text) => {
  if (!text) return text;
  let out = text;

  // Fenced code blocks: WhatsApp renders ``` fine, but a language tag right
  // after the opening fence (```js, ```json, ...) has no meaning to it and
  // just shows up as a stray word on its own line inside the block.
  out = out.replace(/```[ \t]*[a-zA-Z0-9_+-]*\n/g, "```\n");

  // Bold (**text** / __text__) and Markdown headings (# / ## / ...) both
  // become WhatsApp's single-asterisk bold. Stashed behind a placeholder
  // first and restored at the very end, so the italic pass below can't
  // mistake one half of a already-bold "**pair**" for a lone "*"/"_".
  const stash = [];
  const stow = (inner) => {
    stash.push(inner);
    return `\u0000B${stash.length - 1}\u0000`;
  };
  out = out.replace(/\*\*(.+?)\*\*/gs, (_, inner) => stow(inner));
  out = out.replace(/__(.+?)__/gs, (_, inner) => stow(inner));
  out = out.replace(/^#{1,6}[ \t]*(.+)$/gm, (_, inner) => stow(inner));

  // Whatever single *text*/_text_ pairs are left are genuine Markdown
  // italic — WhatsApp's italic is an underscore, not an asterisk. (Real
  // bullet lines like "* item" only ever have ONE asterisk, so they never
  // match this pair pattern and are left alone.)
  out = out.replace(/(^|[^*\n])\*([^*\n]+?)\*(?!\*)/g, "$1_$2_");
  out = out.replace(/(^|[^_\n])_([^_\n]+?)_(?!_)/g, "$1_$2_");

  // Markdown links [label](url) don't render on WhatsApp at all — the
  // brackets/parens just show up literally. A bare URL still auto-links,
  // so keep it visible and tappable alongside the label.
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");

  // Horizontal rules (---, ***, ___ alone on a line) mean nothing to
  // WhatsApp and just show as stray punctuation.
  out = out.replace(/^(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "");

  out = out.replace(/\u0000B(\d+)\u0000/g, (_, i) => `*${stash[Number(i)]}*`);

  return out.trim();
};

const requireCred = (cred) => {
    const { phoneNumberId, accessToken } = cred || {};
    if (!phoneNumberId || !accessToken) {
        throw new Error("WhatsApp credential is missing a Phone Number ID or access token");
    }
    return { phoneNumberId, accessToken };
};

// Base URL our own media (uploads/...) is publicly reachable at. Meta's
// Cloud API "send by link" media types require a real, internet-reachable
// HTTPS URL — never localhost — so this MUST be set to the backend's public
// domain in any deployment that wants outbound WhatsApp media to work.
// Falls back to localhost only so local dev doesn't crash; it will still
// fail Meta's fetch if that's not actually public.
const PUBLIC_BASE_URL = (
    process.env.PUBLIC_BASE_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    `http://localhost:${process.env.PORT || 5000}`
).replace(/\/+$/, "");

const toAbsoluteUrl = (maybeRelativeUrl) => {
    if (!maybeRelativeUrl) return null;
    if (/^https?:\/\//i.test(maybeRelativeUrl)) return maybeRelativeUrl;
    return `${PUBLIC_BASE_URL}${maybeRelativeUrl.startsWith("/") ? "" : "/"}${maybeRelativeUrl}`;
};

async function sendWhatsappText(cred, { to, message }) {
    const { phoneNumberId, accessToken } = requireCred(cred);
    if (!to) throw new Error("A destination WhatsApp number is required");
    if (!message?.trim()) throw new Error("message is required");

    const formatted = markdownToWhatsApp(message);

    const { data } = await axios.post(
        `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
        {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "text",
            text: { preview_url: true, body: formatted },
        },
        {
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            timeout: 15000,
        }
    );
    return { id: data?.messages?.[0]?.id || null };
}

// Maps our internal media "kind" (image|file) + mimeType to the WhatsApp
// Cloud API media type bucket. Meta only has 4 media message types
// (image/document/audio/video) — everything that isn't an image, audio, or
// video clip is sent as a "document" (with its original filename
// preserved), which WhatsApp renders as a downloadable attachment.
const resolveWhatsappMediaType = (media) => {
    const mime = media?.mimeType || "";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
    return "document";
};

// Sends a media message (image/document/audio/video) by public link — the
// simplest of Meta's two upload paths (the other being a two-step "upload
// bytes to Meta, get back a media id, reference that id" flow). `media` is
// the same {url, fileName, mimeType, kind} shape stored on
// Conversation.messages[].media (see storage.service.js#saveMedia); `url`
// may be a relative /uploads/... path, which gets resolved against
// PUBLIC_BASE_URL.
async function sendWhatsappMedia(cred, { to, media, caption }) {
    const { phoneNumberId, accessToken } = requireCred(cred);
    if (!to) throw new Error("A destination WhatsApp number is required");
    if (!media?.url) throw new Error("media is required");

    const link = toAbsoluteUrl(media.url);
    const type = resolveWhatsappMediaType(media);

    const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type,
        [type]: {
            link,
            ...(type === "document" ? { filename: media.fileName || "file" } : {}),
            // Only image/document/video support a caption on WhatsApp — audio
            // does not. Omit rather than send an ignored field.
            ...(caption?.trim() && type !== "audio" ? { caption: markdownToWhatsApp(caption.trim()) } : {}),
        },
    };

    const { data } = await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, payload, {
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        timeout: 20000,
    });
    return { id: data?.messages?.[0]?.id || null };
}

// Sends an interactive "list" message — used for the post-resolution CSAT
// prompt (rate 1-5). `rows` is [{ id, title, description? }], max 10 per
// WhatsApp's own limit (we only ever send 5).
async function sendWhatsappList(cred, { to, bodyText, buttonText, rows, sectionTitle }) {
    const { phoneNumberId, accessToken } = requireCred(cred);
    if (!to) throw new Error("A destination WhatsApp number is required");
    if (!bodyText?.trim()) throw new Error("bodyText is required");
    if (!rows?.length) throw new Error("At least one row is required");

    await axios.post(
        `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
        {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "interactive",
            interactive: {
                type: "list",
                body: { text: markdownToWhatsApp(bodyText) },
                action: {
                    button: buttonText || "Rate now",
                    sections: [
                        {
                            title: sectionTitle || "Rating",
                            rows: rows.map((r) => ({
                                id: r.id,
                                title: r.title,
                                ...(r.description ? { description: r.description } : {}),
                            })),
                        },
                    ],
                },
            },
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
    const { phoneNumberId, accessToken } = requireCred(cred);
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

// --- Inbound media download ---
//
// Meta never sends us media bytes directly — an incoming image/document/
// audio/video message only carries a short-lived media *id*. Downloading it
// is a 2-step dance:
//   1. GET /{media-id} (with our access token) -> { url, mime_type, ... }
//      where `url` is itself a short-lived, auth-gated Graph URL.
//   2. GET that url, again with our access token, to get the actual bytes.
// Returns a Buffer + metadata shaped for storage.service.js#saveMedia's
// `file` argument ({ buffer, originalname, mimetype, size }).
async function downloadWhatsappMedia(cred, mediaId) {
    const { accessToken } = requireCred(cred);
    if (!mediaId) throw new Error("A media id is required");

    const { data: info } = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
    });
    if (!info?.url) throw new Error("WhatsApp did not return a download URL for this media");

    const { data: bytes } = await axios.get(info.url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        responseType: "arraybuffer",
        timeout: 30000,
    });

    const buffer = Buffer.from(bytes);
    const mimeType = info.mime_type || "application/octet-stream";
    const ext = (mimeType.split("/")[1] || "bin").split(";")[0];

    return {
        buffer,
        mimetype: mimeType,
        size: buffer.length,
        originalname: `${mediaId}.${ext}`,
    };
}

module.exports = {
    sendWhatsappText,
    sendWhatsappMedia,
    sendWhatsappList,
    sendTypingIndicator,
    downloadWhatsappMedia,
    toAbsoluteUrl,
    markdownToWhatsApp,
};
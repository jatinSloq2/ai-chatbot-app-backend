// WhatsApp has no "Talk to a human" button (see chat.controller.js's
// request-handover endpoint, which is what the widget uses instead) — the
// visitor's ONLY way to ask for a person is to say so in plain text. This
// is a cheap, deterministic first pass over that text.
//
// It's intentionally over-inclusive rather than clever: false positives
// just mean requestHandover() gets called (which fails soft — "handover
// isn't enabled" / "no agents available" — and the message falls through
// to the AI as normal, see whatsapp.controller.js). False negatives mean a
// visitor who typed something unusual gets no human at all, which is the
// worse failure mode. So this is deliberately paired with a second,
// semantic check (the HANDOVER_REQUEST sentinel the LLM can emit — see
// withHandoverSentinelInstruction below) that catches phrasing this list
// doesn't, in whatever language the visitor is writing in.
const KEYWORD_PATTERNS = [
    /\bagent\b/i,
    /\b(a |an |real |live |actual )?human\b/i,
    /\brepresentative\b/i,
    /\b(customer|support) (care|service|team)\b/i,
    /\bspeak (to|with)\b/i,
    /\btalk to\b/i,
    /\bconnect me\b/i,
    /\btransfer me\b/i,
    /\breal person\b/i,
    /\bexecutive\b/i, // common in Indian customer-support phrasing ("connect to executive")
];

const looksLikeHandoverRequest = (text) => {
    if (!text || typeof text !== "string") return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    return KEYWORD_PATTERNS.some((pattern) => pattern.test(trimmed));
};

// Exact marker the LLM is told to reply with, and only this, when it
// judges (semantically, so it isn't limited to the keyword list above) that
// the visitor wants a human. Deliberately unusual enough that it won't
// collide with a genuine AI answer.
const HANDOVER_SENTINEL = "HANDOVER_REQUEST";

const withHandoverSentinelInstruction = (systemPrompt) =>
    `${systemPrompt}\n\nSpecial instruction: if — and only if — the visitor's latest message is asking to speak with a human agent, a real person, or a customer support representative (in any language or phrasing), reply with exactly the text ${HANDOVER_SENTINEL} and nothing else. Do not add punctuation, translation, or any other words. Otherwise, ignore this instruction and answer normally.`;

const isHandoverSentinelResponse = (responseText) => {
    if (!responseText) return false;
    // Strip stray punctuation/quotes some models wrap single-token replies in.
    const cleaned = responseText.trim().replace(/^["'`.]+|["'`.]+$/g, "");
    return cleaned === HANDOVER_SENTINEL;
};

module.exports = {
    looksLikeHandoverRequest,
    withHandoverSentinelInstruction,
    isHandoverSentinelResponse,
};

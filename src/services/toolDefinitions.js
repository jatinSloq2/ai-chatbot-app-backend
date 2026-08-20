// ---------------------------------------------------------------------------
// Tool schemas for the unified Google-Sheets-backed toolkit described in the
// "Chatbot Master Spec" doc. Every tool here is executed by
// services/botTools.service.js against the bot's connected Sheet
// (IntegrationCredential channel:"google_sheets").
//
// `purposes` says which bot purpose(s) (Bot.toolsConfig.purposes) turn this
// tool on. "orders" and "bookings" intentionally map to the SAME commerce
// tool set — the spec's whole point is that item_type (product vs service)
// on the Items tab is what tells the tools apart, not separate tool lists.
// ---------------------------------------------------------------------------

const TOOLS = [
    // --- Catalog ---
    {
        name: "list_items",
        purposes: ["orders", "bookings"],
        description:
            "Browse available products or services, e.g. 'show me sarees', 'what safari packages do you have', 'what rooms are available'.",
        parameters: {
            type: "object",
            properties: {
                item_type: { type: "string", enum: ["product", "service"], description: "Filter to products or services only" },
                category: { type: "string", description: "Filter by category" },
                keyword: { type: "string", description: "Free-text search across name/description" },
                date: { type: "string", description: "For services only — YYYY-MM-DD to check same-day availability" },
            },
        },
    },
    {
        name: "get_item_details",
        purposes: ["orders", "bookings"],
        description: "Get full details for one specific product, package, or room the user asked about.",
        parameters: {
            type: "object",
            properties: { item_id: { type: "string", description: "The item_id from Items" } },
            required: ["item_id"],
        },
    },
    {
        name: "check_availability",
        purposes: ["orders", "bookings"],
        description: "Check stock (products) or open slots/seats (services) before confirming an order or booking.",
        parameters: {
            type: "object",
            properties: {
                item_id: { type: "string" },
                date: { type: "string", description: "Required for services — YYYY-MM-DD" },
                qty_or_people: { type: "number", description: "Quantity for a product, headcount for a service" },
            },
            required: ["item_id", "qty_or_people"],
        },
    },

    // --- Orders / Bookings ---
    {
        name: "create_order",
        purposes: ["orders", "bookings"],
        description:
            "Place a product order or a service booking once the user has confirmed the item, quantity/headcount, and (for services) date/slot. Works for both — same tool.",
        parameters: {
            type: "object",
            properties: {
                item_id: { type: "string" },
                qty_or_people: { type: "number" },
                date_or_slot: { type: "string", description: "Required for services, e.g. '2026-08-25 / 6:00 AM - 9:00 AM'" },
                delivery_address: { type: "string", description: "Required for products being shipped/delivered" },
                name: { type: "string", description: "Customer name, if not already on file" },
                phone: { type: "string", description: "Customer phone, used to identify/create their user record" },
            },
            required: ["item_id", "qty_or_people"],
        },
    },
    {
        name: "update_order",
        purposes: ["orders", "bookings"],
        description: "Change the quantity, date/slot, or delivery address on an existing pending/confirmed order.",
        parameters: {
            type: "object",
            properties: {
                order_id: { type: "string" },
                qty_or_people: { type: "number" },
                date_or_slot: { type: "string" },
                delivery_address: { type: "string" },
            },
            required: ["order_id"],
        },
    },
    {
        name: "cancel_order",
        purposes: ["orders", "bookings"],
        description: "Cancel an existing order/booking at the user's request.",
        parameters: {
            type: "object",
            properties: { order_id: { type: "string" }, reason: { type: "string" } },
            required: ["order_id"],
        },
    },
    {
        name: "get_order_status",
        purposes: ["orders", "bookings"],
        description: "Look up an order/booking's current status, e.g. 'where's my order', 'is my safari confirmed'.",
        parameters: {
            type: "object",
            properties: {
                order_id: { type: "string" },
                phone_number: { type: "string", description: "Fallback lookup if the user doesn't have their order ID" },
            },
        },
    },
    {
        name: "get_order_history",
        purposes: ["orders", "bookings"],
        description: "List a customer's past orders/bookings, e.g. 'my past orders'.",
        parameters: {
            type: "object",
            properties: { phone_number: { type: "string" } },
            required: ["phone_number"],
        },
    },

    // --- Payments (Sheet bookkeeping only — no live payment gateway wired in) ---
    {
        name: "create_payment_link",
        purposes: ["orders", "bookings"],
        description: "Record that the customer is ready to pay for an order and give them next steps.",
        parameters: {
            type: "object",
            properties: { order_id: { type: "string" }, amount: { type: "number" } },
            required: ["order_id", "amount"],
        },
    },
    {
        name: "verify_payment_status",
        purposes: ["orders", "bookings"],
        description: "Check whether a payment has been recorded as received for an order.",
        parameters: {
            type: "object",
            properties: { order_id: { type: "string" } },
            required: ["order_id"],
        },
    },
    {
        name: "initiate_refund",
        purposes: ["orders", "bookings"],
        description: "Log a refund request after a cancellation/return is approved and the order was paid.",
        parameters: {
            type: "object",
            properties: { order_id: { type: "string" }, reason: { type: "string" } },
            required: ["order_id"],
        },
    },

    // --- Users (cross-cutting — on whenever any purpose is enabled) ---
    {
        name: "capture_user_info",
        purposes: ["support", "orders", "bookings"],
        description: "Save the customer's name/phone/email/address when it's missing and needed to proceed.",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string" },
                phone: { type: "string" },
                email: { type: "string" },
                address: { type: "string" },
            },
        },
    },
    {
        name: "get_user_profile",
        purposes: ["support", "orders", "bookings"],
        description: "Look up a returning customer's saved profile by phone number, to avoid re-asking for their details.",
        parameters: {
            type: "object",
            properties: { phone_number: { type: "string" } },
            required: ["phone_number"],
        },
    },

    // --- Support ---
    {
        name: "create_support_ticket",
        purposes: ["support"],
        description: "Open a support ticket when the bot can't resolve the issue itself, or the user explicitly complains.",
        parameters: {
            type: "object",
            properties: {
                category: { type: "string" },
                description: { type: "string" },
                order_id: { type: "string" },
                phone: { type: "string", description: "Used to identify/create the customer's user record" },
            },
            required: ["category", "description"],
        },
    },
    {
        name: "escalate_to_human",
        purposes: ["support", "orders", "bookings"],
        description: "Connect the user to a live human agent — use for repeated failures, negative sentiment, or an explicit request for a person.",
        parameters: {
            type: "object",
            properties: { reason: { type: "string" } },
            required: ["reason"],
        },
    },
];

// Every bot with tools enabled gets search_faq_kb regardless of purpose —
// it's just the existing RAG knowledge-base lookup, exposed as a callable
// tool instead of being silently injected into every prompt.
const SEARCH_FAQ_TOOL = {
    name: "search_faq_kb",
    purposes: ["support", "orders", "bookings"],
    description: "Search the knowledge base for a general question that has nothing to do with a specific order/booking.",
    parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
    },
};

const ALL_TOOLS = [...TOOLS, SEARCH_FAQ_TOOL];

// Returns the OpenAI-style { name, description, parameters } schema list
// this bot should have available, given its toolsConfig.
const getToolsForBot = (bot) => {
    const cfg = bot.toolsConfig || {};
    if (!cfg.enabled) return [];

    if (cfg.enabledTools?.length) {
        return ALL_TOOLS.filter((t) => cfg.enabledTools.includes(t.name));
    }

    const purposes = cfg.purposes || [];
    if (!purposes.length) return [];

    return ALL_TOOLS.filter((t) => t.purposes.some((p) => purposes.includes(p)));
};

module.exports = { ALL_TOOLS, getToolsForBot };
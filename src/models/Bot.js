const mongoose = require("mongoose");

const botSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    systemPrompt: {
      type: String,
      default:
        "You are a helpful assistant. Answer the user's question using only the provided context. If the answer isn't in the context, say you don't know.",
    },

    // --- API keys for this bot ---
    publicKey: { type: String, required: true, unique: true, index: true }, // used by embed widget
    secretKeyHash: { type: String, required: true }, // used for data-management API (hashed)

    // Restrict which domains the public widget key can be used from (optional)
    allowedDomains: { type: [String], default: [] }, // empty = allow all

    // --- LLM config (chat generation) ---
    llmConfig: {
      provider: {
        type: String,
        default: "ollama",
      },
      model: { type: String, default: "llama3.1" },
      // Encrypted user-provided key (BYOK). Null = use platform default (Ollama, free)
      encryptedApiKey: { type: String, default: null },
      // If this key was copied from a saved Integration Credential (AI Provider
      // channel) rather than pasted directly, this points back to it so the
      // dashboard can show "using saved credential X" and re-sync on change.
      credentialId: { type: mongoose.Schema.Types.ObjectId, ref: "IntegrationCredential", default: null },
      temperature: { type: Number, default: 0.7 },
    },

    // --- Embedding config (for RAG) ---
    embeddingConfig: {
      provider: {
        type: String,
        default: "ollama",
      },
      model: { type: String, default: "nomic-embed-text" },
      encryptedApiKey: { type: String, default: null },
      credentialId: { type: mongoose.Schema.Types.ObjectId, ref: "IntegrationCredential", default: null },
      // Tracks the exact model+dimension used for THIS bot's currently stored
      // chunks. If a user changes provider/model, we compare against this to
      // detect a mismatch before it silently breaks retrieval.
      lockedDimension: { type: Number, default: null },
    },

    // --- Widget appearance (used by embed script) ---
    widgetConfig: {
      title: { type: String, default: "Chat with us" },
      primaryColor: { type: String, default: "#4F46E5" },
      welcomeMessage: { type: String, default: "Hi! How can I help you today?" },
      position: { type: String, enum: ["bottom-right", "bottom-left"], default: "bottom-right" },
      // Up to 5 quick-question bubbles shown inline in the conversation
      // panel (alongside the welcome message, before the visitor has sent
      // anything). Tapping one sends its text as the visitor's first
      // message, exactly as if they had typed it.
      faqs: {
        type: [String],
        default: [],
        validate: {
          validator: (arr) => arr.length <= 5,
          message: "You can add up to 5 quick questions",
        },
      },

      // --- Full widget redesign (v2) ---
      // Persisted theme. Still overridable per-embed via ?theme= for pages
      // that need to force light/dark regardless of the saved default.
      theme: { type: String, enum: ["light", "dark", "auto"], default: "light" },
      // Maps to a small set of safe, always-available web-font stacks —
      // never a raw font string, so the embed script never has to fetch or
      // trust arbitrary CSS.
      fontFamily: {
        type: String,
        enum: ["system", "inter", "poppins", "roboto", "georgia"],
        default: "system",
      },
      // How the closed-state launcher renders: a plain icon circle, a
      // pill with an icon + label, or the bot's avatar as the icon.
      launcherStyle: { type: String, enum: ["icon", "icon-text", "avatar"], default: "icon" },
      launcherText: { type: String, default: "Chat with us" },
      // URL of the bot's avatar/logo image, shown as the launcher icon
      // (when launcherStyle:"avatar") and in the chat header. Settable
      // either as a plain URL or by uploading a file (see
      // bot.controller.js#uploadWidgetAvatar) — same convention as
      // User.avatar / Agent.avatar.
      avatar: { type: String, default: null },
      // Short two-tone chime on new incoming bot/agent messages while the
      // widget is closed or the tab isn't focused. No audio file — the
      // script synthesizes it with the Web Audio API.
      soundEnabled: { type: Boolean, default: true },

      // --- Custom branding (paid plans only — enforced server-side against
      // the bot owner's live plan at both save-time and widget-render-time,
      // so a downgrade takes effect immediately even if this stays true) ---
      // When true AND the owner's plan allows it, the "Powered by JestBot"
      // footer is omitted from the embedded widget.
      hideBranding: { type: Boolean, default: false },

      // --- Multiple language support ---
      // Default language the widget boots in (visitor can switch via the
      // in-widget language picker when more than one is supported). Also
      // used to pick which translated UI-string set the widget script and
      // handover.service system messages render.
      defaultLanguage: { type: String, default: "en" },
      // Languages the visitor can pick from. The AI is instructed to reply
      // in whichever language the visitor is currently set to.
      supportedLanguages: {
        type: [String],
        default: ["en"],
        validate: { validator: (arr) => arr.length <= 10, message: "Up to 10 languages" },
      },
    },

    // --- Pre-chat lead capture (widget) ---
    // Controls the form shown to a visitor before they can start chatting.
    leadConfig: {
      enabled: { type: Boolean, default: false }, // show the pre-chat form at all

      collectName: { type: Boolean, default: true },
      nameRequired: { type: Boolean, default: false },

      // Only ONE identifier is collected at a time — email OR phone, never both.
      identifierType: { type: String, enum: ["none", "email", "phone"], default: "email" },
      identifierRequired: { type: Boolean, default: true },

      // If true, the visitor must enter an OTP (sent by email or SMS,
      // matching identifierType) before the chat unlocks.
      verifyIdentifier: { type: Boolean, default: false },

      // Message body used when sending the OTP. Supports {name} and {otp}
      // placeholders (also {botName}), filled in at send time. Used as the
      // SMS body verbatim, and as the message line inside the email template.
      otpMessageTemplate: {
        type: String,
        default: "Hi {name}, your {botName} verification code is {otp}. It expires in 10 minutes.",
      },
    },

    // --- WhatsApp channel (Meta Cloud API) ---
    // Links this bot to one of the owner's saved WhatsApp credentials
    // (Credentials → WhatsApp tab). Inbound messages to that number are
    // routed to this bot and answered the same way the widget is —
    // same RAG/LLM pipeline, same handover state machine — just delivered
    // back out over WhatsApp instead of SSE. See whatsapp.controller.js.
    whatsappConfig: {
      enabled: { type: Boolean, default: false },
      credentialId: { type: mongoose.Schema.Types.ObjectId, ref: "IntegrationCredential", default: null },
    },

    // --- Functional tools (unified support / orders / bookings toolkit) ---
    // Backs the "Chatbot Master Spec" unified tools — one Google Sheet (see
    // IntegrationCredential.googleSheets + services/googleSheets.service.js)
    // with Items/Availability/Orders/Users/Payments/Tickets tabs powers
    // catalog browsing, order/booking creation, and support tickets, all
    // through the same tool set (services/botTools.service.js). Which
    // tools are exposed to the LLM is derived from `purposes` unless
    // `enabledTools` is set explicitly. Tool-calling itself only works
    // when llmConfig.provider is one that supports function calling
    // (openai/groq/mistral/anthropic) — see llm.service.js#TOOL_CAPABLE_PROVIDERS.
    toolsConfig: {
      enabled: { type: Boolean, default: false },
      purposes: {
        type: [String],
        enum: ["support", "orders", "bookings", "meetings"],
        default: [],
      },
      // Points at an IntegrationCredential with channel:"google_sheets" —
      // the connected Google account (or service-account credential) this
      // bot's tools use.
      sheetsCredentialId: { type: mongoose.Schema.Types.ObjectId, ref: "IntegrationCredential", default: null },
      // Which spreadsheet under that credential this bot actually reads/
      // writes — required when the credential is OAuth-based (one account
      // can back many sheets, this is how a bot picks its own). Not needed
      // for a service_account credential, which is always exactly one sheet.
      spreadsheetId: { type: String, default: null },
      // Points at an IntegrationCredential with channel:"razorpay" — when
      // set, create_payment_link/verify_payment_status/initiate_refund take
      // real payments through the owner's own Razorpay account via Payment
      // Links (see razorpay.service.js + botTools.service.js). When unset,
      // those tools just log a pending-payment row and show
      // paymentInstructions instead — no money actually moves.
      razorpayCredentialId: { type: mongoose.Schema.Types.ObjectId, ref: "IntegrationCredential", default: null },
      // Points at an IntegrationCredential with channel:"meeting_scheduling"
      // — when set (and the "meetings" purpose is on), book_meeting/
      // cancel_meeting_booking actually create/cancel a real meeting
      // (Google Meet event, Cal.com booking, or a Calendly scheduling
      // link) via services/meetingProviders.service.js. Per-mentor config
      // (which item_id, host email, event type, etc.) lives on the
      // connected sheet's "Mentors" tab, not here.
      meetingCredentialId: { type: mongoose.Schema.Types.ObjectId, ref: "IntegrationCredential", default: null },
      // Optional manual override of the exact tool names exposed to the
      // LLM. Empty = derive automatically from `purposes` (recommended).
      enabledTools: { type: [String], default: [] },
      // Safety cap on how many tool-call ↔ tool-result round trips a
      // single reply can go through before we force a final answer.
      maxToolIterations: { type: Number, default: 4, min: 1, max: 8 },
      // Shown to the visitor in place of a real payment link when
      // create_payment_link fires and no Razorpay account is connected
      // (razorpayCredentialId unset) — just a logged pending-payment row on
      // the Payments tab in that case (see botTools.service.js). Free text
      // so an owner can say "we'll send a UPI/payment link over WhatsApp
      // shortly" or similar, until they connect Razorpay for real checkout.
      paymentInstructions: {
        type: String,
        default: "We've noted this order as pending payment — our team will share payment details shortly.",
      },
      // Master switch for every customer-facing transactional email this
      // toolkit sends (order confirmation, booking confirmation with the
      // meeting link, and payment-received) — sent via the bot owner's own
      // connected Email credential (falls back to the platform mailer if
      // none is connected), see services/botTransactionalEmail.service.js.
      // On by default; the owner can turn it off per bot.
      sendCustomerEmails: { type: Boolean, default: true },
    },

    // --- Human agent handover (Agent System) ---
    // Which agents/teams can be handed a conversation on this bot, and
    // whether handover is offered at all. The actual handover trigger logic
    // (context-fails detection, assignment engine, etc.) is a later phase —
    // this is just the config surface + ownership relationships.
    assignedAgents: [{ type: mongoose.Schema.Types.ObjectId, ref: "Agent" }],
    assignedTeams: [{ type: mongoose.Schema.Types.ObjectId, ref: "Team" }],
    agentConfig: {
      assignEnabled: { type: Boolean, default: false }, // "agents_assign_enabled"
      // Number of visitor messages that must be exchanged in a conversation
      // before the "Talk to a human agent" option is offered in the widget.
      // Keeps agents from being pulled in on message 1 — the AI gets a fair
      // shot first. Configurable per bot, shown next to the agent/team
      // selection in the dashboard.
      handoverMessageThreshold: { type: Number, default: 10, min: 1, max: 50 },
      // Shown to the visitor when they ask for a human outside business
      // hours (see businessHours below) instead of connecting them.
      offHoursMessage: {
        type: String,
        default:
          "As of now, no agent is available — these are our off hours. You can continue chatting with our AI assistant, and we'll follow up by email as soon as we're back.",
      },
      // Sent the moment a handover request is created (widget: right after
      // the "Talk to a human" click; WhatsApp: right after the visitor's
      // text is recognised as an agent request) — mainly to give the
      // WhatsApp visitor SOME acknowledgement, since they have no spinner
      // or "waiting for agent" UI the way the widget does.
      handoverRequestedMessage: {
        type: String,
        default: "Got it — connecting you to one of our team members. Someone will join the chat shortly.",
      },
      // Sent once an agent actually accepts the request. Same WhatsApp-only
      // reasoning as above — the widget shows this visually (assigned-agent
      // name/badge) so it doesn't need a text message.
      handoverConnectedMessage: {
        type: String,
        default: "You're now connected with {agentName}. They'll be right with you.",
      },
      // Sent when the agent marks the chat resolved.
      handoverResolvedMessage: {
        type: String,
        default: "This chat has been marked as resolved. Feel free to message us again anytime!",
      },
      // --- CSAT (WhatsApp only — the widget has its own in-UI star picker) ---
      // Sent as the body text of the interactive "rate 1-5" list message
      // right after an agent resolves a WhatsApp conversation. {agentName}
      // is replaced with the agent who resolved the chat, same as
      // handoverConnectedMessage above.
      csatPromptMessage: {
        type: String,
        default: "How was your chat with {agentName}? Tap below to rate it.",
      },
      // Sent once the visitor taps a rating in that list.
      csatThankYouMessage: {
        type: String,
        default: "Thanks for the feedback! Let us know if there's anything else we can help with.",
      },
    },

    // --- Business hours (human handover) ---
    // When enabled, "Talk to a human agent" is only actually offered a live
    // agent during the configured windows. Outside those windows the widget
    // still shows the option (so visitors aren't confused about why it's
    // gone), but requesting it captures a lead and returns agentConfig's
    // offHoursMessage instead of creating a real handover request.
    businessHours: {
      enabled: { type: Boolean, default: false },
      // IANA timezone the schedule below is interpreted in, e.g.
      // "Asia/Kolkata", "America/New_York". Defaults to UTC so an
      // unconfigured bot behaves predictably.
      timezone: { type: String, default: "UTC" },
      // One entry per weekday (0=Sunday..6=Saturday). `start`/`end` are
      // "HH:mm" 24h local time in `timezone`. A day with enabled:false has
      // no live-agent hours at all that day.
      schedule: {
        type: [
          {
            _id: false,
            day: { type: Number, min: 0, max: 6, required: true },
            enabled: { type: Boolean, default: true },
            start: { type: String, default: "09:00" },
            end: { type: String, default: "18:00" },
          },
        ],
        default: [
          { day: 0, enabled: false, start: "09:00", end: "18:00" },
          { day: 1, enabled: true, start: "09:00", end: "18:00" },
          { day: 2, enabled: true, start: "09:00", end: "18:00" },
          { day: 3, enabled: true, start: "09:00", end: "18:00" },
          { day: 4, enabled: true, start: "09:00", end: "18:00" },
          { day: 5, enabled: true, start: "09:00", end: "18:00" },
          { day: 6, enabled: false, start: "09:00", end: "18:00" },
        ],
      },
    },

    isActive: { type: Boolean, default: true },

    // Denormalized counters for quick limit checks (avoid COUNT queries on every request)
    documentCount: { type: Number, default: 0 },
    messagesThisMonth: { type: Number, default: 0 },
    messagesResetAt: { type: Date, default: Date.now },
    testMessagesTotal: { type: Number, default: 0 },
  },
  { timestamps: true }
);

botSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Bot", botSchema);
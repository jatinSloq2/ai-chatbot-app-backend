const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Bot = require("../models/Bot");
const botService = require("../services/bot.service");
const { describeBusinessHours } = require("../services/businessHours.service");
const { getStrings } = require("../utils/i18n");

// Hiding the "Powered by JestBot" watermark is a paid-plan feature.
// Re-checked against the owner's LIVE plan here rather than trusting the
// saved widgetConfig.hideBranding flag alone, so a downgrade takes effect
// immediately on every bot without needing to touch each one.
const resolveBrandingHidden = async (bot) => {
  if (!bot.widgetConfig?.hideBranding) return false;
  try {
    const plan = await botService.getActivePlan(bot.user);
    return !!plan.limits?.hideWatermark;
  } catch {
    return false;
  }
};

// GET /api/v1/widget/config  (auth: public key)
const getWidgetConfig = asyncHandler(async (req, res) => {
  const bot = req.bot;
  const hideBranding = await resolveBrandingHidden(bot);
  res.status(200).json({
    success: true,
    data: {
      name: bot.name,
      widgetConfig: { ...(bot.widgetConfig?.toObject ? bot.widgetConfig.toObject() : bot.widgetConfig), hideBranding },
      leadConfig: bot.leadConfig,
      agentConfig: bot.agentConfig,
      isActive: bot.isActive,
      faqs: bot.widgetConfig?.faqs || [],
      businessHoursDescription: describeBusinessHours(bot),
    },
  });
});

// GET /widget.js?key=pk_xxxxx&theme=dark&position=bottom-left&color=%23ff6600
// Query params override the saved widgetConfig for easy per-embed customization
// without needing a dashboard change.
//
// Supported query overrides:
//   theme      = "light" | "dark" | "auto"  (default: "light")
//   position   = "bottom-right" | "bottom-left"
//   color      = hex color e.g. %23ff6600 (URL-encoded #)
//   title      = chat window title
//   welcome    = welcome message
//   avatar     = URL to a bot avatar image
//   font       = "system" | "inter" | "poppins" | "roboto" | "georgia"
//   height     = chat window starting height in px (default 520, visitor can resize)
//   width      = chat window starting width in px (default 360, visitor can resize)
const serveWidgetScript = asyncHandler(async (req, res) => {
  const publicKey = req.query.key;
  if (!publicKey) throw new ApiError(400, "Missing ?key= parameter");

  const bot = await Bot.findOne({ publicKey });
  if (!bot || !bot.isActive) throw new ApiError(404, "Bot not found or inactive");

  const apiBaseUrl = process.env.API_BASE_URL || `${req.protocol}://${req.get("host")}`;

  // Merge saved config with per-embed query-string overrides
  const savedConfig = bot.widgetConfig || {};
  const hideBranding = await resolveBrandingHidden(bot);
  const config = {
    title: req.query.title || savedConfig.title || "Chat with us",
    primaryColor: req.query.color || savedConfig.primaryColor || "#f97316",
    welcomeMessage: req.query.welcome || savedConfig.welcomeMessage || "Hi! How can I help you today?",
    position: req.query.position || savedConfig.position || "bottom-right",
    theme: req.query.theme || savedConfig.theme || "light",
    avatar: req.query.avatar || savedConfig.avatar || null,
    // Starting size only — the visitor can drag-resize the window from the
    // corner handle, so these are just the initial width/height.
    height: parseInt(req.query.height) || 520,
    width: parseInt(req.query.width) || 360,
    botName: bot.name,
    // Up to 5 quick-question bubbles shown in the conversation panel.
    // Tapping one sends its text as the visitor's message.
    faqs: (savedConfig.faqs || []).slice(0, 5),
    // --- Full widget redesign (v2) ---
    fontFamily: req.query.font || savedConfig.fontFamily || "system",
    launcherStyle: savedConfig.launcherStyle || "icon",
    launcherText: savedConfig.launcherText || "Chat with us",
    soundEnabled: savedConfig.soundEnabled !== false,
    // Watermark removal — omit the "Powered by JestBot" footer. Only true
    // when BOTH the owner opted in AND their live plan allows it.
    hideBranding: hideBranding,
    // Pre-chat lead capture form settings (name/email/phone + verification)
    leadConfig: bot.leadConfig || {
      enabled: false,
      collectName: true,
      nameRequired: false,
      identifierType: "email",
      identifierRequired: true,
      verifyIdentifier: false,
    },
    // Human handover — whether the "Talk to a human" option is offered at
    // all, and after how many visitor messages it's offered.
    agentConfig: bot.agentConfig || { assignEnabled: false, handoverMessageThreshold: 10 },
    // Business hours — purely informational for the widget (the backend is
    // the source of truth and decides offHours vs. a real handover), shown
    // next to the handover button so visitors know when a human is around.
    businessHoursDescription: describeBusinessHours(bot),
    // Multiple language support — visitor can switch via the in-widget
    // picker (shown only when more than one language is configured). Each
    // supported language's UI strings are embedded so switching is instant,
    // no extra request.
    languages: {
      default: bot.widgetConfig?.defaultLanguage || "en",
      supported: bot.widgetConfig?.supportedLanguages?.length ? bot.widgetConfig.supportedLanguages : ["en"],
      strings: Object.fromEntries(
        (bot.widgetConfig?.supportedLanguages?.length ? bot.widgetConfig.supportedLanguages : ["en"]).map((code) => [
          code,
          getStrings(code),
        ])
      ),
    },
  };

  const script = buildWidgetScript({ apiBaseUrl, publicKey, config });

  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60"); // short cache so config changes propagate quickly
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(script);
});

const buildWidgetScript = ({ apiBaseUrl, publicKey, config }) => {
  // Serialize config safely for inline JS injection
  const cfg = JSON.stringify(config);
  const api = JSON.stringify(apiBaseUrl);
  const key = JSON.stringify(publicKey);

  return `
/* JestBot Widget v1.0 | https://jestbot.ai */
(function () {
  "use strict";

  // if (document.getElementById("jb-root")) return; // prevent double-init
  if (document.getElementById("jb-bubble")) return;

  var CONFIG   = ${cfg};
  var API_BASE = ${api};
  var PK       = ${key};
  var SK       = "jb_sid_" + PK; // sessionStorage key for the session token — cleared when the tab closes

  // ---------- helpers ----------
  function storageGet(k) { try { return localStorage.getItem(k); } catch(e) { return null; } }
  function storageSet(k,v) { try { localStorage.setItem(k,v); } catch(e) {} }
  // Session-scoped — cleared when the tab closes. Used only for the
  // sessionId/token, not for the other persisted widget state.
  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch(e) { return null; } }
  function sessionStorageSet(k,v) { try { sessionStorage.setItem(k,v); } catch(e) {} }
  function esc(s) {
    return String(s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;");
  }

  // ---------- fonts ----------
  var FONT_STACKS = {
    system: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    inter: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    poppins: "'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    roboto: "'Roboto',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    georgia: "Georgia,'Times New Roman',serif",
  };
  var fontStack = FONT_STACKS[CONFIG.fontFamily] || FONT_STACKS.system;
  // Google Fonts is only loaded for stacks that actually need a webfont —
  // "system" and "georgia" use fonts every browser already has.
  if (CONFIG.fontFamily === "inter" || CONFIG.fontFamily === "poppins" || CONFIG.fontFamily === "roboto") {
    var fontLinkFamily = CONFIG.fontFamily === "inter" ? "Inter:wght@400;500;600;700"
      : CONFIG.fontFamily === "poppins" ? "Poppins:wght@400;500;600;700"
      : "Roboto:wght@400;500;700";
    if (!document.getElementById("jb-font-link")) {
      var fontLink = document.createElement("link");
      fontLink.id = "jb-font-link";
      fontLink.rel = "stylesheet";
      fontLink.href = "https://fonts.googleapis.com/css2?family=" + fontLinkFamily + "&display=swap";
      document.head.appendChild(fontLink);
    }
  }

  // ---------- notification sound ----------
  // Synthesized two-tone chime (Web Audio API) — no audio file, no network
  // request. Only plays for messages that arrive while the widget is
  // closed or the tab isn't focused; a visitor actively looking at the
  // chat doesn't need an audio cue.
  var audioCtx = null;
  function playNotifySound() {
    if (!CONFIG.soundEnabled) return;
    if (isOpen && !document.hidden) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      var now = audioCtx.currentTime;
      [880, 1175].forEach(function (freq, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.11);
        gain.gain.linearRampToValueAtTime(0.12, now + i * 0.11 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.22);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + i * 0.11);
        osc.stop(now + i * 0.11 + 0.24);
      });
    } catch (e) { /* audio not available — silently skip */ }
  }

  // ---------- theme ----------
  var isDark = CONFIG.theme === "dark" ||
    (CONFIG.theme === "auto" && window.matchMedia &&
     window.matchMedia("(prefers-color-scheme: dark)").matches);

  var colors = {
    bg:        isDark ? "#1a1a2e" : "#ffffff",
    bgMsgs:    isDark ? "#16213e" : "#f7f7f8",
    border:    isDark ? "#0f3460" : "#e5e5e5",
    text:      isDark ? "#e0e0e0" : "#111111",
    textMuted: isDark ? "#9ca3af" : "#6b7280",
    userBg:    CONFIG.primaryColor,
    userText:  "#ffffff",
    botBg:     isDark ? "#1e293b" : "#ffffff",
    botText:   isDark ? "#e0e0e0" : "#111111",
    inputBg:   isDark ? "#1e293b" : "#ffffff",
    inputText: isDark ? "#e0e0e0" : "#111111",
    shadow:    isDark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.15)",
  };

  var isLeftPositioned = CONFIG.position === "bottom-left";
  var pos = isLeftPositioned ? "left:20px;" : "right:20px;";

  // ---------- size (resizable) ----------
  // The window opens at CONFIG.width/height, but the visitor can drag the
  // corner handle to resize it. We track the live size in JS and set it as
  // an inline style, which always wins over the CSS defaults below.
  var MIN_W = 300, MIN_H = 400;
  function maxW() { return Math.min(640, window.innerWidth - 32); }
  function maxH() { return Math.min(820, window.innerHeight - 120); }
  var winWidth  = Math.max(MIN_W, Math.min(maxW(), CONFIG.width));
  var winHeight = Math.max(MIN_H, Math.min(maxH(), CONFIG.height));

  // ---------- inject styles ----------
  var style = document.createElement("style");
  style.id = "jb-style";
  style.textContent = [
    // bubble
    "#jb-bubble{position:fixed;" + pos + "bottom:24px;width:56px;height:56px;border-radius:50%;",
    "background:" + CONFIG.primaryColor + ";cursor:pointer;display:flex;align-items:center;",
    "justify-content:center;z-index:2147483646;box-shadow:0 4px 20px " + colors.shadow + ";",
    "transition:transform .2s,box-shadow .2s;border:none;outline:none;}",
    "#jb-bubble:hover{transform:scale(1.08);box-shadow:0 8px 28px " + colors.shadow + ";}",
    "#jb-bubble svg{width:26px;height:26px;fill:#fff;transition:opacity .2s;flex-shrink:0;}",
    "#jb-bubble .jb-close{display:none;}",
    "#jb-bubble.open .jb-chat{display:none;}",
    "#jb-bubble.open .jb-close{display:block;}",

    // launcher style: icon-text pill (collapses to a plain circle once open)
    "#jb-bubble.jb-launcher-text{width:auto;height:50px;border-radius:25px;padding:0 20px 0 16px;gap:9px;}",
    "#jb-bubble.jb-launcher-text .jb-launcher-label{color:#fff;font-size:14px;font-weight:600;",
    "white-space:nowrap;font-family:" + fontStack + ";}",
    "#jb-bubble.jb-launcher-text.open{width:56px;height:56px;padding:0;border-radius:50%;}",
    "#jb-bubble.jb-launcher-text.open .jb-launcher-label{display:none;}",

    // launcher style: bot avatar as the closed-state icon
    "#jb-bubble.jb-launcher-avatar .jb-launcher-avatar-img{width:100%;height:100%;border-radius:50%;",
    "object-fit:cover;display:block;}",
    "#jb-bubble.jb-launcher-avatar .jb-chat{display:none;}",
    "#jb-bubble.jb-launcher-avatar.open .jb-launcher-avatar-img{display:none;}",
    "#jb-bubble.jb-launcher-avatar.open .jb-close{display:block;}",

    // window — single screen (chat, or the pre-chat lead form). Width/height
    // start from CONFIG but are overwritten inline once the visitor resizes.
    "#jb-win{position:fixed;" + pos + "bottom:92px;width:" + winWidth + "px;",
    "max-width:calc(100vw - 32px);height:" + winHeight + "px;max-height:calc(100vh - 120px);",
    "background:" + colors.bg + ";border-radius:16px;display:none;flex-direction:column;",
    "overflow:hidden;z-index:2147483645;box-shadow:0 8px 40px " + colors.shadow + ";",
    "font-family:" + fontStack + ";",
    "border:1px solid " + colors.border + ";}",
    "#jb-win.open{display:flex;}",

    // resize handle — sits at the corner farthest from the anchored edge, so
    // dragging it naturally grows the window (bottom/side stay pinned).
    "#jb-resize-handle{position:absolute;top:0;" + (isLeftPositioned ? "right:0;" : "left:0;") + "",
    "width:18px;height:18px;z-index:10;cursor:" + (isLeftPositioned ? "nesw-resize" : "nwse-resize") + ";",
    "display:flex;align-items:" + (isLeftPositioned ? "flex-start" : "flex-start") + ";",
    "justify-content:" + (isLeftPositioned ? "flex-end" : "flex-start") + ";padding:3px;",
    "opacity:.35;transition:opacity .15s;touch-action:none;}",
    "#jb-resize-handle:hover{opacity:.9;}",
    "#jb-resize-handle svg{width:11px;height:11px;fill:none;stroke:" + colors.textMuted + ";",
    "stroke-width:1.6;stroke-linecap:round;}",

    // header
    "#jb-head{background:" + CONFIG.primaryColor + ";padding:14px 16px;display:flex;",
    "align-items:center;gap:10px;flex-shrink:0;}",
    "#jb-head-avatar{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.25);",
    "display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;}",
    "#jb-head-avatar img{width:100%;height:100%;object-fit:cover;}",
    "#jb-head-avatar svg{width:18px;height:18px;fill:#fff;}",
    "#jb-head-info{flex:1;min-width:0;}",
    "#jb-head-title{color:#fff;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    "#jb-head-sub{color:rgba(255,255,255,.75);font-size:11px;margin-top:1px;}",
    "#jb-head-close{background:rgba(255,255,255,.2);border:none;cursor:pointer;",
    "width:28px;height:28px;border-radius:50%;display:flex;align-items:center;",
    "justify-content:center;flex-shrink:0;transition:background .15s;}",
    "#jb-head-close:hover{background:rgba(255,255,255,.35);}",
    "#jb-head-close svg{width:14px;height:14px;fill:#fff;}",

    // messages area
    "#jb-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;",
    "gap:12px;background:" + colors.bgMsgs + ";}",
    "#jb-msgs::-webkit-scrollbar{width:4px;}",
    "#jb-msgs::-webkit-scrollbar-track{background:transparent;}",
    "#jb-msgs::-webkit-scrollbar-thumb{background:rgba(150,150,150,.3);border-radius:4px;}",

    // message bubbles
    ".jb-msg{max-width:82%;padding:10px 14px;border-radius:16px;font-size:14px;",
    "line-height:1.5;white-space:pre-wrap;word-wrap:break-word;animation:jb-fadein .2s ease;}",
    "@keyframes jb-fadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}",
    ".jb-msg.user{align-self:flex-end;background:" + colors.userBg + ";color:" + colors.userText + ";",
    "border-bottom-right-radius:4px;}",
    ".jb-msg.bot{align-self:flex-start;background:" + colors.botBg + ";color:" + colors.botText + ";",
    "border:1px solid " + colors.border + ";border-bottom-left-radius:4px;}",

    // typing indicator
    ".jb-typing{display:flex;gap:4px;align-items:center;padding:12px 16px;}",
    ".jb-dot{width:7px;height:7px;border-radius:50%;background:" + colors.textMuted + ";",
    "animation:jb-bounce 1.2s infinite;}",
    ".jb-dot:nth-child(2){animation-delay:.2s;}",
    ".jb-dot:nth-child(3){animation-delay:.4s;}",
    "@keyframes jb-bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}",

    // timestamp
    ".jb-ts{font-size:10px;color:" + colors.textMuted + ";text-align:center;margin:4px 0;}",

    // FAQ / quick-question bubbles — shown inline in the conversation panel,
    // right under the welcome message, on a fresh conversation.
    "#jb-faqs{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start;max-width:100%;",
    "margin-top:2px;animation:jb-fadein .2s ease;}",
    ".jb-faq-btn{background:" + colors.botBg + ";border:1px solid " + colors.border + ";",
    "color:" + CONFIG.primaryColor + ";border-radius:14px;padding:7px 12px;font-size:12.5px;",
    "cursor:pointer;font-family:inherit;text-align:left;line-height:1.3;transition:border-color .15s,background .15s;}",
    ".jb-faq-btn:hover{border-color:" + CONFIG.primaryColor + ";background:" + colors.bgMsgs + ";}",
    ".jb-faq-btn:disabled{opacity:.5;cursor:default;}",

    // handover nudge fade-in for the bar itself
    "#jb-handover-bar{transition:opacity .2s;}",
    "#jb-handover-bar.jb-hidden{display:none;}",

    // powered by
    "#jb-powered{text-align:center;padding:4px 0 8px;font-size:10px;color:" + colors.textMuted + ";}",
    "#jb-powered a{color:" + CONFIG.primaryColor + ";text-decoration:none;}",

    // input row
    "#jb-input-row{display:flex;align-items:center;gap:8px;padding:10px 12px;",
    "border-top:1px solid " + colors.border + ";background:" + colors.bg + ";flex-shrink:0;}",
    "#jb-input{flex:1;background:" + colors.inputBg + ";color:" + colors.inputText + ";",
    "border:1px solid " + colors.border + ";border-radius:22px;padding:9px 16px;font-size:14px;",
    "outline:none;transition:border-color .15s;resize:none;line-height:1.4;",
    "font-family:inherit;max-height:120px;overflow-y:auto;}",
    "#jb-input:focus{border-color:" + CONFIG.primaryColor + ";}",
    "#jb-input::placeholder{color:" + colors.textMuted + ";}",
    "#jb-send{width:36px;height:36px;border-radius:50%;background:" + CONFIG.primaryColor + ";",
    "border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;",
    "flex-shrink:0;transition:opacity .15s;opacity:.5;}",
    "#jb-send.active{opacity:1;}",
    "#jb-send svg{width:16px;height:16px;fill:#fff;}",

    // pre-chat lead form
    "#jb-lead{display:none;flex:1;overflow-y:auto;padding:20px 16px;flex-direction:column;",
    "gap:12px;background:" + colors.bgMsgs + ";}",
    "#jb-win.jb-mode-lead #jb-lead{display:flex;}",
    "#jb-win.jb-mode-lead #jb-msgs,#jb-win.jb-mode-lead #jb-input-row,#jb-win.jb-mode-lead #jb-powered{display:none;}",
    "#jb-lead-title{font-size:14px;font-weight:600;color:" + colors.text + ";}",
    "#jb-lead-sub{font-size:12px;color:" + colors.textMuted + ";margin-bottom:4px;}",
    "#jb-lead-formpanel{display:flex;flex-direction:column;gap:10px;}",
    "#jb-lead input{width:100%;box-sizing:border-box;background:" + colors.inputBg + ";",
    "color:" + colors.inputText + ";border:1px solid " + colors.border + ";border-radius:10px;",
    "padding:10px 12px;font-size:14px;outline:none;font-family:inherit;transition:border-color .15s;}",
    "#jb-lead input:focus{border-color:" + CONFIG.primaryColor + ";}",
    "#jb-lead-err,#jb-lead-otp-err{font-size:12px;color:#e11d48;min-height:14px;}",
    "#jb-lead button{background:" + CONFIG.primaryColor + ";color:#fff;border:none;border-radius:10px;",
    "padding:10px 14px;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s;font-family:inherit;}",
    "#jb-lead button:disabled{opacity:.6;cursor:default;}",
    "#jb-lead-resend{background:none!important;color:" + CONFIG.primaryColor + "!important;",
    "font-weight:500!important;padding:0!important;text-decoration:underline;align-self:flex-start;}",
    "#jb-lead-otp{display:none;flex-direction:column;gap:10px;}",
    "#jb-lead-otp.show{display:flex;}",
    "#jb-lead-otp-msg{font-size:12px;color:" + colors.textMuted + ";}",

    // "continue a previous chat" chooser — shown after OTP verification
    // only when the now-verified visitor has past verified conversations.
    "#jb-lead-history{display:none;flex-direction:column;gap:10px;}",
    "#jb-lead-history.show{display:flex;}",
    "#jb-lead-history-msg{font-size:12px;color:" + colors.textMuted + ";}",
    "#jb-lead-history-list{display:flex;flex-direction:column;gap:8px;max-height:220px;overflow-y:auto;}",
    ".jb-lhi{display:flex;flex-direction:column;gap:2px;text-align:left;width:100%;box-sizing:border-box;",
    "background:" + colors.inputBg + ";border:1px solid " + colors.border + ";border-radius:10px;",
    "padding:9px 12px;cursor:pointer;font-family:inherit;transition:border-color .15s;}",
    ".jb-lhi:hover{border-color:" + CONFIG.primaryColor + ";}",
    ".jb-lhi-preview{font-size:13px;color:" + colors.text + ";overflow:hidden;",
    "text-overflow:ellipsis;white-space:nowrap;}",
    ".jb-lhi-meta{font-size:11px;color:" + colors.textMuted + ";}",
    "#jb-lead-history-new{background:none!important;color:" + CONFIG.primaryColor + "!important;",
    "font-weight:500!important;padding:0!important;text-decoration:underline;align-self:flex-start;}",

    // human handover
    "#jb-handover-bar{padding:8px 12px;border-top:1px solid " + colors.border + ";",
    "background:" + colors.bg + ";flex-shrink:0;}",
    "#jb-handover-btn{width:100%;background:none;border:1px dashed " + colors.border + ";",
    "border-radius:10px;padding:8px 10px;font-size:12px;color:" + colors.textMuted + ";",
    "cursor:pointer;font-family:inherit;transition:border-color .15s,color .15s;}",
    "#jb-handover-btn:hover{border-color:" + CONFIG.primaryColor + ";color:" + colors.text + ";}",
    "#jb-handover-btn:disabled{opacity:.6;cursor:default;}",
    ".jb-system-msg{align-self:center;font-size:11px;color:" + colors.textMuted + ";",
    "background:" + colors.bgMsgs + ";border:1px solid " + colors.border + ";border-radius:20px;",
    "padding:4px 12px;margin:4px 0;}",
    ".jb-agent-label{font-size:10px;font-weight:600;color:" + CONFIG.primaryColor + ";",
    "margin-bottom:2px;text-transform:uppercase;letter-spacing:.03em;}",

    // rich replies — quick-reply chips / buttons rendered under a message
    ".jb-rich{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;max-width:82%;align-self:flex-start;}",
    ".jb-rich.jb-rich-user{align-self:flex-end;}",
    ".jb-rich-btn{background:" + colors.bg + ";border:1px solid " + CONFIG.primaryColor + ";",
    "color:" + CONFIG.primaryColor + ";border-radius:14px;padding:6px 12px;font-size:12.5px;",
    "cursor:pointer;font-family:inherit;transition:background .15s,color .15s;}",
    ".jb-rich-btn:hover{background:" + CONFIG.primaryColor + ";color:#fff;}",
    ".jb-rich-btn:disabled{opacity:.5;cursor:default;}",

    // rich replies — simple card (image + title/subtitle + buttons)
    ".jb-card{max-width:82%;align-self:flex-start;border:1px solid " + colors.border + ";",
    "border-radius:12px;overflow:hidden;background:" + colors.botBg + ";margin-top:2px;}",
    ".jb-card img{width:100%;display:block;max-height:160px;object-fit:cover;}",
    ".jb-card-body{padding:10px 12px;}",
    ".jb-card-title{font-size:13.5px;font-weight:600;color:" + colors.text + ";}",
    ".jb-card-sub{font-size:12px;color:" + colors.textMuted + ";margin-top:2px;}",
    ".jb-card .jb-rich{padding:0 12px 10px;margin-top:0;max-width:100%;}",

    // media messages (images/files)
    ".jb-msg-media img{max-width:100%;border-radius:10px;display:block;margin-top:4px;cursor:pointer;}",
    ".jb-msg-media a.jb-file-link{display:flex;align-items:center;gap:8px;margin-top:4px;",
    "padding:8px 10px;border-radius:10px;background:rgba(127,127,127,.12);",
    "color:inherit;text-decoration:none;font-size:13px;word-break:break-all;}",

    // attach-media button (only shown once an agent has joined)
    "#jb-attach{width:36px;height:36px;border-radius:50%;background:none;flex-shrink:0;",
    "border:1px solid " + colors.border + ";cursor:pointer;display:none;align-items:center;justify-content:center;",
    "transition:border-color .15s;}",
    "#jb-attach.jb-show{display:flex;}",
    "#jb-attach:hover{border-color:" + CONFIG.primaryColor + ";}",
    "#jb-attach svg{width:16px;height:16px;stroke:" + colors.textMuted + ";fill:none;stroke-width:1.8;}",

    // CSAT (post-resolution rating) prompt
    "#jb-csat{align-self:center;max-width:92%;border:1px solid " + colors.border + ";border-radius:12px;",
    "padding:12px 14px;background:" + colors.botBg + ";margin:6px 0;text-align:center;}",
    "#jb-csat-label{font-size:12.5px;color:" + colors.text + ";margin-bottom:8px;}",
    "#jb-csat-stars{display:flex;justify-content:center;gap:4px;}",
    ".jb-star{cursor:pointer;background:none;border:none;padding:2px;line-height:1;}",
    ".jb-star svg{width:22px;height:22px;fill:none;stroke:" + colors.textMuted + ";stroke-width:1.6;transition:fill .15s,stroke .15s;}",
    ".jb-star.jb-star-active svg,.jb-star:hover svg{fill:" + CONFIG.primaryColor + ";stroke:" + CONFIG.primaryColor + ";}",
    "#jb-csat-thanks{font-size:12.5px;color:" + colors.textMuted + ";}",

    // language picker (shown in the header when >1 language is configured)
    "#jb-lang{background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;",
    "font-size:11px;padding:3px 6px;margin-right:2px;cursor:pointer;font-family:inherit;flex-shrink:0;}",
    "#jb-lang option{color:#111;}",
  ].join("");
  document.head.appendChild(style);

  // ---------- lead capture state ----------
  var LEAD = CONFIG.leadConfig || { enabled: false };
  var LEAD_DONE_KEY = "jb_lead_done_" + PK;

  function genId() {
    return "xxxxxxxxxxxx".replace(/x/g, function () {
      return Math.floor(Math.random() * 16).toString(16);
    }) + Date.now().toString(36);
  }

  // sessionId is created up-front (not just on first message) so the
  // pre-chat lead form can be tied to the same conversation the visitor
  // ends up chatting in. Session-scoped storage so it's cleared on tab close.
  var sessionId = sessionStorageGet(SK);
  if (!sessionId) {
    sessionId = genId();
    sessionStorageSet(SK, sessionId);
  }

  var leadDone = !LEAD.enabled || sessionStorageGet(LEAD_DONE_KEY) === "1";

  // ---------- human handover state ----------
  var AGENT_CONFIG = CONFIG.agentConfig || { assignEnabled: false };
  var handoverStatus = "none"; // none | requested | assigned | resolved
  var lastPollAt = null;
  var historyLoaded = false;

  // ---------- build DOM ----------
  // Bubble button — style depends on CONFIG.launcherStyle: a plain icon
  // circle (default), an icon+label pill, or the bot's avatar as the icon.
  var bubble = document.createElement("button");
  bubble.id = "jb-bubble";
  bubble.setAttribute("aria-label", "Open chat");

  var chatIconSvg = '<svg class="jb-chat" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  var closeIconSvg = '<svg class="jb-close" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  if (CONFIG.launcherStyle === "icon-text") {
    bubble.className = "jb-launcher-text";
    bubble.innerHTML = chatIconSvg + closeIconSvg +
      '<span class="jb-launcher-label">' + esc(CONFIG.launcherText || "Chat with us") + '</span>';
  } else if (CONFIG.launcherStyle === "avatar" && CONFIG.avatar) {
    bubble.className = "jb-launcher-avatar";
    bubble.innerHTML = '<img class="jb-launcher-avatar-img" src="' + esc(CONFIG.avatar) + '" alt="" />' +
      chatIconSvg + closeIconSvg;
  } else {
    bubble.innerHTML = chatIconSvg + closeIconSvg;
  }

  // Chat window — a single screen: either the pre-chat lead form, or the
  // conversation panel. There is no separate Home screen.
  var win = document.createElement("div");
  win.id = "jb-win";
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", esc(CONFIG.title));

  // Avatar HTML
  var avatarHTML = CONFIG.avatar
    ? '<img src="' + esc(CONFIG.avatar) + '" alt="Bot avatar" />'
    : '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';

  // ---------- multi-language support ----------
  var LANGS = CONFIG.languages || { default: "en", supported: ["en"], strings: { en: {} } };
  var LANG_KEY = "jb_lang_" + PK;
  var currentLang = storageGet(LANG_KEY) || LANGS.default || "en";
  if (LANGS.supported.indexOf(currentLang) === -1) currentLang = LANGS.default || "en";
  function t(key) {
    var set = LANGS.strings[currentLang] || LANGS.strings[LANGS.default] || {};
    return set[key] || key;
  }

  var langPickerHtml = "";
  if (LANGS.supported.length > 1) {
    langPickerHtml = '<select id="jb-lang" aria-label="' + esc(t("selectLanguage")) + '">' +
      LANGS.supported.map(function (code) {
        return '<option value="' + esc(code) + '"' + (code === currentLang ? " selected" : "") + '>' + esc(code.toUpperCase()) + '</option>';
      }).join("") +
      '</select>';
  }

  win.innerHTML =
    '<div id="jb-resize-handle" title="Drag to resize">' +
      '<svg viewBox="0 0 12 12"><path d="M1 11L11 1M5 11L11 5M9 11L11 9"/></svg>' +
    '</div>' +
    '<div id="jb-head">' +
      '<div id="jb-head-avatar">' + avatarHTML + '</div>' +
      '<div id="jb-head-info">' +
        '<div id="jb-head-title">' + esc(CONFIG.title) + '</div>' +
        '<div id="jb-head-sub">&#x25CF; Online</div>' +
      '</div>' +
      langPickerHtml +
      '<button id="jb-head-close" aria-label="Close chat">' +
        '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
      '</button>' +
    '</div>' +
    '<div id="jb-msgs" role="log" aria-live="polite" aria-label="Chat messages"></div>' +
    (CONFIG.hideBranding ? "" : '<div id="jb-powered">' + esc(t("poweredBy")) + ' <a href="https://jestbot.ai" target="_blank" rel="noopener">JestBot</a></div>') +
    '<div id="jb-input-row">' +
      '<input id="jb-file-input" type="file" style="display:none" accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xlsx,.ppt,.pptx" />' +
      '<button id="jb-attach" type="button" aria-label="' + esc(t("attachFile")) + '" title="' + esc(t("attachFile")) + '">' +
        '<svg viewBox="0 0 24 24"><path d="M21 12.5V7a4 4 0 0 0-8 0v9a2.5 2.5 0 0 0 5 0V9"/></svg>' +
      '</button>' +
      '<textarea id="jb-input" rows="1" placeholder="' + esc(t("inputPlaceholder")) + '" aria-label="Message input"></textarea>' +
      '<button id="jb-send" aria-label="' + esc(t("send")) + '">' +
        '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
      '</button>' +
    '</div>';

  win.className = !leadDone ? "jb-mode-lead" : "jb-mode-chat";

  document.body.appendChild(win);
  document.body.appendChild(bubble);

  // ---------- pre-chat lead form ----------
  var leadHtml =
    '<div id="jb-lead-title">' + esc(LEAD.title || "Before we start") + '</div>' +
    '<div id="jb-lead-sub">' + esc(LEAD.subtitle || "Tell us a bit about you so we can help.") + '</div>' +
    '<div id="jb-lead-formpanel">';
  if (LEAD.collectName) {
    leadHtml += '<input id="jb-lead-name" type="text" placeholder="Your name' +
      (LEAD.nameRequired ? '' : ' (optional)') + '" />';
  }
  if (LEAD.identifierType === "email") {
    leadHtml += '<input id="jb-lead-id" type="email" placeholder="Email address' +
      (LEAD.identifierRequired ? '' : ' (optional)') + '" />';
  } else if (LEAD.identifierType === "phone") {
    leadHtml += '<input id="jb-lead-id" type="tel" placeholder="Phone number' +
      (LEAD.identifierRequired ? '' : ' (optional)') + '" />';
  }
  leadHtml +=
    '<div id="jb-lead-err"></div>' +
    '<button id="jb-lead-submit" type="button">Continue</button>' +
    '</div>' +
    '<div id="jb-lead-otp">' +
      '<div id="jb-lead-otp-msg"></div>' +
      '<input id="jb-lead-otp-input" type="text" inputmode="numeric" placeholder="Enter verification code" />' +
      '<div id="jb-lead-otp-err"></div>' +
      '<button id="jb-lead-verify" type="button">Verify &amp; continue</button>' +
      '<button id="jb-lead-resend" type="button">Resend code</button>' +
    '</div>' +
    '<div id="jb-lead-history">' +
      '<div id="jb-lead-history-msg">Welcome back! Continue a previous conversation, or start a new one.</div>' +
      '<div id="jb-lead-history-list"></div>' +
      '<button id="jb-lead-history-new" type="button">Start a new conversation</button>' +
    '</div>';

  var leadEl = document.createElement("div");
  leadEl.id = "jb-lead";
  leadEl.innerHTML = leadHtml;
  win.appendChild(leadEl);

  // ---------- human handover bar ----------
  // Not shown from the first message — only once the visitor has exchanged
  // at least CONFIG.agentConfig.handoverMessageThreshold messages, so the AI
  // gets a fair shot before a human is offered.
  var handoverBarEl = null;
  if (AGENT_CONFIG.assignEnabled) {
    handoverBarEl = document.createElement("div");
    handoverBarEl.id = "jb-handover-bar";
    handoverBarEl.className = "jb-hidden";
    var hoursNote = CONFIG.businessHoursDescription
      ? '<div style="font-size:10px;color:' + colors.textMuted + ';text-align:center;margin-top:4px;">' + esc(CONFIG.businessHoursDescription) + '</div>'
      : "";
    handoverBarEl.innerHTML = '<button id="jb-handover-btn" type="button">' + esc(t("talkToHuman")) + '</button>' + hoursNote;
    win.appendChild(handoverBarEl);
  }
  var HANDOVER_THRESHOLD = Math.max(1, parseInt(AGENT_CONFIG.handoverMessageThreshold, 10) || 10);
  // Session-scoped (not localStorage) — these count messages in THIS
  // conversation only. Tied to the same lifecycle as sessionId (SK), so a
  // new session always starts the threshold fresh, instead of a browser
  // that crossed the threshold once, ever, immediately showing the human
  // handover option on every future conversation.
  var MSG_COUNT_KEY = "jb_msgcount_" + SK;
  var NUDGE_SHOWN_KEY = "jb_handover_nudged_" + SK;
  var userMsgCount = parseInt(sessionStorageGet(MSG_COUNT_KEY), 10) || 0;

  function revealHandoverBar() {
    if (!handoverBarEl || handoverStatus !== "none") return;
    handoverBarEl.classList.remove("jb-hidden");
    if (sessionStorageGet(NUDGE_SHOWN_KEY) !== "1") {
      sessionStorageSet(NUDGE_SHOWN_KEY, "1");
      addSystemMessage("Still need help? You can connect with a human agent below.");
    }
  }

  function maybeRevealHandoverBar() {
    if (userMsgCount >= HANDOVER_THRESHOLD) revealHandoverBar();
  }

  var msgsEl   = document.getElementById("jb-msgs");
  var inputEl  = document.getElementById("jb-input");
  var sendBtn  = document.getElementById("jb-send");
  var closeBtn = document.getElementById("jb-head-close");
  var resizeHandleEl = document.getElementById("jb-resize-handle");
  var attachBtn = document.getElementById("jb-attach");
  var fileInputEl = document.getElementById("jb-file-input");
  var langSelectEl = document.getElementById("jb-lang");
  var isOpen   = false;
  var isStreaming = false;

  var leadNameEl    = document.getElementById("jb-lead-name");
  var leadIdEl      = document.getElementById("jb-lead-id");
  var leadErrEl     = document.getElementById("jb-lead-err");
  var leadSubmitBtn = document.getElementById("jb-lead-submit");
  var leadFormPanel = document.getElementById("jb-lead-formpanel");
  var leadOtpPanel  = document.getElementById("jb-lead-otp");
  var leadOtpMsg    = document.getElementById("jb-lead-otp-msg");
  var leadOtpInput  = document.getElementById("jb-lead-otp-input");
  var leadOtpErr    = document.getElementById("jb-lead-otp-err");
  var leadVerifyBtn = document.getElementById("jb-lead-verify");
  var leadResendBtn = document.getElementById("jb-lead-resend");
  var leadTarget    = null; // { type: "email"|"phone", value: "..." }

  // "Continue a previous chat" chooser — only ever populated for a
  // verified lead (see leadVerify below); unverified visitors never see it.
  var leadHistoryPanel = document.getElementById("jb-lead-history");
  var leadHistoryList  = document.getElementById("jb-lead-history-list");
  var leadHistoryNewBtn = document.getElementById("jb-lead-history-new");

  var FAQS = (CONFIG.faqs || []).slice(0, 5);

  function removeFaqBubbles() {
    var el = document.getElementById("jb-faqs");
    if (el) el.remove();
  }

  // Renders up to 5 tappable quick-question bubbles under the welcome
  // message, right in the conversation panel. Only shown on a fresh
  // conversation (no messages exchanged yet) — once the visitor sends
  // anything, real or via a bubble tap, they disappear for good.
  function showFaqs() {
    if (!FAQS.length || userMsgCount > 0 || document.getElementById("jb-faqs")) return;

    var wrap = document.createElement("div");
    wrap.id = "jb-faqs";

    FAQS.forEach(function (q) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "jb-faq-btn";
      btn.textContent = q;
      btn.addEventListener("click", function () {
        if (isStreaming) return;
        sendMessage(q);
      });
      wrap.appendChild(btn);
    });

    msgsEl.appendChild(wrap);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function showWelcome() {
    if (msgsEl.children.length === 0 && CONFIG.welcomeMessage) {
      addTimestamp();
      addMessage("bot", CONFIG.welcomeMessage);
    }
    showFaqs();
  }

function leadComplete() {
  sessionStorageSet(LEAD_DONE_KEY, "1");   // was: sessionStorageGet(LEAD_DONE_KEY, "1")
  leadDone = true;
  win.classList.remove("jb-mode-lead");
  win.classList.add("jb-mode-chat");
  showWelcome();
  setTimeout(function () { inputEl.focus(); }, 100);
}

  // Visitor picked a past chat from the "continue a previous conversation"
  // list — switch the active sessionId to it and hydrate its full
  // transcript via loadHistory() (defined further below) instead of
  // showing the welcome message for what would look like a fresh chat.
function continueChat(pickedSessionId) {
  sessionId = pickedSessionId;
  sessionStorageSet(SK, sessionId);
  sessionStorageSet(LEAD_DONE_KEY, "1");   // was: sessionStorageGet(LEAD_DONE_KEY, "1")
  leadDone = true;
  win.classList.remove("jb-mode-lead");
  win.classList.add("jb-mode-chat");
  loadHistory();
  setTimeout(function () { inputEl.focus(); }, 100);
}

  function renderLeadHistory(previousChats) {
    leadHistoryList.innerHTML = "";
    previousChats.forEach(function (c) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "jb-lhi";
      var when = "";
      try { when = new Date(c.lastActivityAt).toLocaleDateString([], { month: "short", day: "numeric" }); } catch (e) {}
      item.innerHTML =
        '<span class="jb-lhi-preview">' + esc(c.lastMessage || "(no messages yet)") + '</span>' +
        '<span class="jb-lhi-meta">' + c.messageCount + ' message' + (c.messageCount === 1 ? "" : "s") +
        (when ? " &middot; " + esc(when) : "") + '</span>';
      item.addEventListener("click", function () { continueChat(c.sessionId); });
      leadHistoryList.appendChild(item);
    });
    leadFormPanel.style.display = "none";
    leadOtpPanel.classList.remove("show");
    leadHistoryPanel.classList.add("show");
  }

  function leadSubmit() {
    var name  = leadNameEl ? leadNameEl.value.trim() : "";
    var idVal = leadIdEl ? leadIdEl.value.trim() : "";

    if (LEAD.collectName && LEAD.nameRequired && !name) {
      leadErrEl.textContent = "Please enter your name.";
      return;
    }
    if (LEAD.identifierType !== "none" && LEAD.identifierRequired && !idVal) {
      leadErrEl.textContent = LEAD.identifierType === "email"
        ? "Please enter your email." : "Please enter your phone number.";
      return;
    }

    leadErrEl.textContent = "";
    leadSubmitBtn.disabled = true;
    leadSubmitBtn.textContent = "Please wait...";

    var payload = { sessionId: sessionId };
    if (LEAD.collectName && name) payload.name = name;
    if (LEAD.identifierType === "email" && idVal) payload.email = idVal;
    if (LEAD.identifierType === "phone" && idVal) payload.phone = idVal;

    fetch(API_BASE + "/api/v1/lead/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": PK },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.message || "Something went wrong"); });
      return r.json();
    }).then(function () {
      if (LEAD.verifyIdentifier && LEAD.identifierType !== "none" && idVal) {
        leadTarget = { type: LEAD.identifierType, value: idVal };
        return fetch(API_BASE + "/api/v1/lead/send-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": PK },
          body: JSON.stringify({ sessionId: sessionId, type: LEAD.identifierType, target: idVal })
        }).then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.message || "Could not send code"); });
          return r.json();
        }).then(function () {
          leadFormPanel.style.display = "none";
          leadOtpPanel.classList.add("show");
          leadOtpMsg.textContent = "We sent a verification code to " + idVal + ".";
          leadOtpInput.focus();
        });
      }
      leadComplete();
    }).catch(function (err) {
      leadErrEl.textContent = err.message || "Something went wrong. Please try again.";
      leadSubmitBtn.disabled = false;
      leadSubmitBtn.textContent = "Continue";
    });
  }

  function leadVerify() {
    var otp = leadOtpInput.value.trim();
    if (!otp) { leadOtpErr.textContent = "Please enter the code."; return; }
    leadOtpErr.textContent = "";
    leadVerifyBtn.disabled = true;
    leadVerifyBtn.textContent = "Verifying...";

    fetch(API_BASE + "/api/v1/lead/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": PK },
      body: JSON.stringify({ sessionId: sessionId, type: leadTarget.type, otp: otp })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.message || "Invalid code"); });
      return r.json();
    }).then(function (res) {
      // Only a verified identifier can ever surface previousChats — the
      // backend only returns them from this endpoint, after OTP success.
      var previousChats = (res.data && res.data.previousChats) || [];
      if (previousChats.length > 0) {
        renderLeadHistory(previousChats);
      } else {
        leadComplete();
      }
    }).catch(function (err) {
      leadOtpErr.textContent = err.message || "Invalid code. Please try again.";
      leadVerifyBtn.disabled = false;
      leadVerifyBtn.textContent = "Verify & continue";
    });
  }

  function leadResend() {
    if (!leadTarget) return;
    leadResendBtn.disabled = true;
    fetch(API_BASE + "/api/v1/lead/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": PK },
      body: JSON.stringify({ sessionId: sessionId, type: leadTarget.type, target: leadTarget.value })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.message || "Could not resend code"); });
      leadOtpErr.textContent = "";
      leadOtpMsg.textContent = "A new code was sent to " + leadTarget.value + ".";
    }).catch(function (err) {
      leadOtpErr.textContent = err.message || "Could not resend code.";
    }).then(function () { leadResendBtn.disabled = false; });
  }

  if (leadSubmitBtn) leadSubmitBtn.addEventListener("click", leadSubmit);
  if (leadVerifyBtn) leadVerifyBtn.addEventListener("click", leadVerify);
  if (leadResendBtn) leadResendBtn.addEventListener("click", leadResend);
  if (leadHistoryNewBtn) leadHistoryNewBtn.addEventListener("click", function () { leadComplete(); });
  if (leadNameEl) leadNameEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); leadSubmit(); }
  });
  if (leadIdEl) leadIdEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); leadSubmit(); }
  });
  if (leadOtpInput) leadOtpInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); leadVerify(); }
  });

  // ---------- auto-grow textarea ----------
  inputEl.addEventListener("input", function () {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
    sendBtn.classList.toggle("active", inputEl.value.trim().length > 0);
  });

  // ---------- resize ----------
  // Dragging the corner handle grows the window from the corner opposite
  // the anchored edge (top-left for bottom-right widgets, top-right for
  // bottom-left widgets), since #jb-win is pinned via bottom/right(left).
  function applySize(w, h) {
    winWidth = Math.max(MIN_W, Math.min(maxW(), w));
    winHeight = Math.max(MIN_H, Math.min(maxH(), h));
    win.style.width = winWidth + "px";
    win.style.height = winHeight + "px";
  }

  function startResize(e) {
    e.preventDefault();
    var point = e.touches ? e.touches[0] : e;
    var startX = point.clientX, startY = point.clientY;
    var startW = winWidth, startH = winHeight;

    function onMove(ev) {
      var p = ev.touches ? ev.touches[0] : ev;
      var dx = p.clientX - startX;
      var dy = p.clientY - startY;
      // Right-anchored: handle is top-left, dragging left/up grows the box.
      // Left-anchored: handle is top-right, dragging right/up grows the box.
      var newW = isLeftPositioned ? startW + dx : startW - dx;
      var newH = startH - dy;
      applySize(newW, newH);
      if (ev.cancelable) ev.preventDefault();
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  }

  if (resizeHandleEl) {
    resizeHandleEl.addEventListener("mousedown", startResize);
    resizeHandleEl.addEventListener("touchstart", startResize, { passive: false });
  }

  // Keep the window within bounds if the viewport shrinks (e.g. mobile
  // rotation, or resizing the browser itself).
  window.addEventListener("resize", function () {
    applySize(winWidth, winHeight);
  });

  // ---------- open / close ----------
  function openChat() {
    isOpen = true;
    win.classList.add("open");
    bubble.classList.add("open");
    bubble.setAttribute("aria-label", "Close chat");
    if (!leadDone) {
      setTimeout(function () {
        if (leadNameEl) leadNameEl.focus();
        else if (leadIdEl) leadIdEl.focus();
      }, 100);
      return;
    }
    loadHistory();
    setTimeout(function () { inputEl.focus(); }, 100);
  }

  function closeChat() {
    isOpen = false;
    win.classList.remove("open");
    bubble.classList.remove("open");
    bubble.setAttribute("aria-label", "Open chat");
  }

  bubble.addEventListener("click", function () {
    isOpen ? closeChat() : openChat();
  });
  closeBtn.addEventListener("click", closeChat);

  // ---------- DOM helpers ----------
  function addTimestamp() {
    var el = document.createElement("div");
    el.className = "jb-ts";
    el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    msgsEl.appendChild(el);
  }

  function renderMedia(container, media) {
    if (!media) return;
    var wrap = document.createElement("div");
    wrap.className = "jb-msg-media";
    if (media.kind === "image") {
      var img = document.createElement("img");
      img.src = media.url;
      img.alt = media.fileName || "attachment";
      img.addEventListener("click", function () { window.open(media.url, "_blank"); });
      wrap.appendChild(img);
    } else {
      var a = document.createElement("a");
      a.className = "jb-file-link";
      a.href = media.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.5V7a4 4 0 0 0-8 0v9a2.5 2.5 0 0 0 5 0V9"/></svg>' +
        '<span>' + esc(media.fileName || "Download attachment") + '</span>';
      wrap.appendChild(a);
    }
    container.appendChild(wrap);
  }

  // Renders quick-reply chips / buttons / a card, either right after a
  // message bubble (rich.type buttons/quick_replies) or as its own
  // standalone element (rich.type card). Tapping a button sends its value
  // as the visitor's next message.
  function renderRichContent(rich, alignUser) {
    if (!rich) return;

    if (rich.type === "card") {
      var card = document.createElement("div");
      card.className = "jb-card";
      if (rich.card && rich.card.imageUrl) {
        var img = document.createElement("img");
        img.src = rich.card.imageUrl;
        card.appendChild(img);
      }
      if (rich.card && (rich.card.title || rich.card.subtitle)) {
        var body = document.createElement("div");
        body.className = "jb-card-body";
        if (rich.card.title) body.innerHTML = '<div class="jb-card-title">' + esc(rich.card.title) + '</div>';
        if (rich.card.subtitle) body.innerHTML += '<div class="jb-card-sub">' + esc(rich.card.subtitle) + '</div>';
        card.appendChild(body);
      }
      msgsEl.appendChild(card);
      if (rich.card && rich.card.buttons && rich.card.buttons.length) {
        appendRichButtons(card, rich.card.buttons);
      }
      msgsEl.scrollTop = msgsEl.scrollHeight;
      return;
    }

    if ((rich.type === "buttons" || rich.type === "quick_replies") && rich.buttons && rich.buttons.length) {
      var row = document.createElement("div");
      row.className = "jb-rich" + (alignUser ? " jb-rich-user" : "");
      msgsEl.appendChild(row);
      appendRichButtons(row, rich.buttons);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
  }

  function appendRichButtons(container, buttons) {
    buttons.forEach(function (b) {
      var btn = document.createElement("button");
      btn.className = "jb-rich-btn";
      btn.type = "button";
      btn.textContent = b.label;
      btn.addEventListener("click", function () {
        Array.prototype.forEach.call(container.querySelectorAll(".jb-rich-btn"), function (x) { x.disabled = true; });
        sendMessage(b.value || b.label);
      });
      container.appendChild(btn);
    });
  }

  function addMessage(role, text, agentName, msg) {
    var el = document.createElement("div");
    el.className = "jb-msg " + role;
    if (agentName) {
      var label = document.createElement("div");
      label.className = "jb-agent-label";
      label.textContent = agentName;
      el.appendChild(label);
      var body = document.createElement("div");
      body.textContent = text;
      el.appendChild(body);
    } else {
      el.textContent = text;
    }
    if (msg && msg.media) renderMedia(el, msg.media);
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    if (msg && msg.richContent) renderRichContent(msg.richContent, role === "user");
    return el;
  }

  function addSystemMessage(text) {
    var el = document.createElement("div");
    el.className = "jb-system-msg";
    el.textContent = text;
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return el;
  }

  function showTyping() {
    var el = document.createElement("div");
    el.className = "jb-msg bot jb-typing";
    el.id = "jb-typing";
    el.innerHTML = '<div class="jb-dot"></div><div class="jb-dot"></div><div class="jb-dot"></div>';
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function removeTyping() {
    var t = document.getElementById("jb-typing");
    if (t) t.remove();
  }

  // ---------- human handover ----------
  function hideHandoverBar() {
    if (handoverBarEl) handoverBarEl.style.display = "none";
  }

  function requestHandover() {
    var btn = document.getElementById("jb-handover-btn");
    if (btn) { btn.disabled = true; btn.textContent = t("connecting"); }

    fetch(API_BASE + "/api/v1/chat/request-handover", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": PK },
      body: JSON.stringify({ sessionId: sessionId })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.message || "Could not connect to an agent"); });
      return r.json();
    }).then(function (json) {
      addTimestamp();
      if (json && json.data && json.data.offHours) {
        // Outside business hours — no real handover was created. Just show
        // the off-hours message and let the visitor keep chatting with the AI.
        addSystemMessage(json.message);
        if (btn) { btn.disabled = false; btn.textContent = t("talkToHuman"); }
        return;
      }
      handoverStatus = "requested";
      addSystemMessage(t("connectingAgent"));
      hideHandoverBar();
      openEventStream();
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = t("talkToHuman"); }
      addSystemMessage(err.message || "Could not connect to an agent right now.");
    });
  }

  var eventSource = null;

  function openEventStream() {
    if (eventSource || typeof EventSource === "undefined") return;
    var url = API_BASE + "/api/v1/chat/stream?sessionId=" + encodeURIComponent(sessionId) + "&key=" + encodeURIComponent(PK);
    eventSource = new EventSource(url);
    eventSource.addEventListener("update", function () {
      refreshFromServer();
    });
    // EventSource auto-reconnects on drop by default; nothing extra needed here.
  }

  function closeEventStream() {
    if (eventSource) { eventSource.close(); eventSource = null; }
  }

  function refreshFromServer() {
    var url = API_BASE + "/api/v1/chat/poll?sessionId=" + encodeURIComponent(sessionId);
    if (lastPollAt) url += "&since=" + encodeURIComponent(lastPollAt);

    fetch(url, { headers: { "x-api-key": PK } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        if (json && json.data) applyPollResult(json.data, false);
      })
      .catch(function () {});
  }

  // isInitialLoad: render the visitor's own past messages too (needed once,
  // right after a page reload) — during normal updates we skip role:"user"
  // since the visitor's own new messages are already rendered locally the
  // instant they're sent.
  function applyPollResult(data, isInitialLoad) {
    lastPollAt = new Date().toISOString();

    if (data.status !== handoverStatus) {
      if (data.status === "assigned" && handoverStatus !== "assigned" && !isInitialLoad) {
        addTimestamp();
        addSystemMessage(data.assignedAgentName ? "You're now connected with " + data.assignedAgentName + "." : t("agentJoined"));
      }
      if (data.status === "assigned") showAttachButton();
      if (data.status === "resolved") {
        closeEventStream();
        hideAttachButton();
        if (!isInitialLoad) { addTimestamp(); addSystemMessage(t("chatResolved")); }
        if (!data.csat) renderCsatPrompt();
      }
      handoverStatus = data.status;
      if (handoverStatus !== "none") hideHandoverBar();
    }

    (data.messages || []).forEach(function (m) {
      if (m.role === "user") {
        if (isInitialLoad) {
          addMessage("user", m.content, null, m);
          userMsgCount += 1;
        }
        return;
      }
      addMessage("bot", m.content, m.via === "agent" ? (m.agentName || "Agent") : null, m);
      if (!isInitialLoad) playNotifySound();
    });

    if (isInitialLoad) {
      sessionStorageSet(MSG_COUNT_KEY, String(userMsgCount));
      maybeRevealHandoverBar();
    }
  }

  // Rehydrates a returning visitor's conversation (messages + handover
  // state) on page load, then reveals the welcome message only if there's
  // nothing to show.
  function loadHistory() {
    if (historyLoaded) { showWelcome(); return; }
    historyLoaded = true;

    fetch(API_BASE + "/api/v1/chat/poll?sessionId=" + encodeURIComponent(sessionId), {
      headers: { "x-api-key": PK }
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (json) {
      if (json && json.data) {
        var data = json.data;
        if ((data.messages || []).length) addTimestamp();
        applyPollResult(data, true);
        if (handoverStatus === "requested" || handoverStatus === "assigned") openEventStream();
      }
      showWelcome();
    }).catch(function () {
      showWelcome();
    });
  }

  if (handoverBarEl) {
    document.getElementById("jb-handover-btn").addEventListener("click", requestHandover);
  }

  // ---------- send message ----------
  // presetText: used by FAQ bubble clicks, which send fixed text instead of
  // whatever is currently in the input box.
  function sendMessage(presetText) {
    var text = typeof presetText === "string" ? presetText.trim() : inputEl.value.trim();
    if (!text || isStreaming) return;

    if (typeof presetText !== "string") {
      inputEl.value = "";
      inputEl.style.height = "auto";
      sendBtn.classList.remove("active");
    }

    removeFaqBubbles();

    addTimestamp();
    addMessage("user", text);
    if (handoverStatus === "none") showTyping();
    isStreaming = true;

    userMsgCount += 1;
    sessionStorageSet(MSG_COUNT_KEY, String(userMsgCount));
    maybeRevealHandoverBar();

    var botEl = null;

    fetch(API_BASE + "/api/v1/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": PK
      },
      body: JSON.stringify({ message: text, sessionId: sessionId || undefined, language: currentLang }),
    })
    .then(function (response) {
      if (!response.ok) {
        return response.json().then(function (d) {
          throw new Error(d.message || "Request failed (" + response.status + ")");
        });
      }

      var reader  = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer  = "";

      function read() {
        reader.read().then(function (result) {
          if (result.done) {
            removeTyping();
            isStreaming = false;
            return;
          }

          buffer += decoder.decode(result.value, { stream: true });

          // SSE frames are separated by double newlines
          var frames = buffer.split("\\n\\n");
          buffer = frames.pop(); // keep incomplete trailing frame

          frames.forEach(function (frame) {
            if (!frame.trim()) return;
            var eventName = "";
            var dataStr   = "";

            frame.split("\\n").forEach(function (line) {
              if (line.indexOf("event:") === 0) {
                eventName = line.slice(6).trim();
              } else if (line.indexOf("data:") === 0) {
                dataStr = line.slice(5).trim();
              }
            });

            if (!dataStr) return;

            try {
              var payload = JSON.parse(dataStr);

              if (eventName === "session") {
                // Save sessionId so the next message continues the same conversation
                if (payload.sessionId) sessionStorageSet(SK, payload.sessionId);
              }

              if (eventName === "token") {
                if (!botEl) {
                  removeTyping();
                  botEl = addMessage("bot", "");
                }
                botEl.textContent += payload.token;
                msgsEl.scrollTop = msgsEl.scrollHeight;
              }

              if (eventName === "done") {
                removeTyping();
                isStreaming = false;
                playNotifySound();
                if (payload.richContent) renderRichContent(payload.richContent, false);
              }

              if (eventName === "error") {
                removeTyping();
                if (!botEl) botEl = addMessage("bot", "");
                botEl.textContent = "Sorry, something went wrong: " + (payload.message || "unknown error");
                isStreaming = false;
              }

              if (eventName === "handover") {
                removeTyping();
                isStreaming = false;
                if (payload.status === "requested" && handoverStatus === "none") {
                  handoverStatus = "requested";
                  addSystemMessage(t("connectingAgent"));
                  hideHandoverBar();
                }
                openEventStream();
              }
            } catch (e) {
              // Ignore malformed JSON in partial SSE frames
            }
          });

          read(); // continue reading
        }).catch(function (err) {
          removeTyping();
          addMessage("bot", "Connection lost. Please try again.");
          isStreaming = false;
        });
      }

      read();
    })
    .catch(function (err) {
      removeTyping();
      addMessage("bot", err.message || "Sorry, something went wrong. Please try again.");
      isStreaming = false;
    });
  }

  sendBtn.addEventListener("click", sendMessage);

  // ---------- media attach (only usable once an agent has joined) ----------
  function showAttachButton() { if (attachBtn) attachBtn.classList.add("jb-show"); }
  function hideAttachButton() { if (attachBtn) attachBtn.classList.remove("jb-show"); }

  if (attachBtn && fileInputEl) {
    attachBtn.addEventListener("click", function () { fileInputEl.click(); });

    fileInputEl.addEventListener("change", function () {
      var file = fileInputEl.files && fileInputEl.files[0];
      fileInputEl.value = "";
      if (!file) return;

      attachBtn.disabled = true;
      var isImg = file.type && file.type.indexOf("image/") === 0;
      var localEl = addMessage("user", "", null, {
        media: { url: URL.createObjectURL(file), kind: isImg ? "image" : "file", fileName: file.name },
      });

      var fd = new FormData();
      fd.append("file", file);
      fd.append("sessionId", sessionId);

      fetch(API_BASE + "/api/v1/chat/media", { method: "POST", headers: { "x-api-key": PK }, body: fd })
        .then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.message); }); })
        .then(function () { attachBtn.disabled = false; })
        .catch(function (err) {
          attachBtn.disabled = false;
          if (localEl) localEl.remove();
          addSystemMessage(err.message || "Couldn't send that file. Please try again.");
        });
    });
  }

  // ---------- language picker ----------
  if (langSelectEl) {
    langSelectEl.addEventListener("change", function () {
      currentLang = langSelectEl.value;
      storageSet(LANG_KEY, currentLang);
      inputEl.placeholder = t("inputPlaceholder");
      if (attachBtn) attachBtn.setAttribute("aria-label", t("attachFile"));
    });
  }

  // ---------- CSAT (post-resolution rating) ----------
  var csatShown = false;
  function renderCsatPrompt() {
    if (csatShown) return;
    csatShown = true;

    var wrap = document.createElement("div");
    wrap.id = "jb-csat";
    wrap.innerHTML =
      '<div id="jb-csat-label">' + esc(t("rateChat")) + '</div>' +
      '<div id="jb-csat-stars"></div>';
    msgsEl.appendChild(wrap);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    var starsEl = wrap.querySelector("#jb-csat-stars");
    for (var i = 1; i <= 5; i++) {
      (function (value) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "jb-star";
        b.setAttribute("aria-label", value + " star" + (value > 1 ? "s" : ""));
        b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>';
        b.addEventListener("mouseenter", function () { highlightStars(starsEl, value); });
        b.addEventListener("click", function () { submitCsat(value, wrap, starsEl); });
        starsEl.appendChild(b);
      })(i);
    }
    starsEl.addEventListener("mouseleave", function () { highlightStars(starsEl, 0); });
  }

  function highlightStars(starsEl, upTo) {
    Array.prototype.forEach.call(starsEl.children, function (el, idx) {
      el.classList.toggle("jb-star-active", idx < upTo);
    });
  }

  function submitCsat(rating, wrap, starsEl) {
    highlightStars(starsEl, rating);
    Array.prototype.forEach.call(starsEl.children, function (el) { el.disabled = true; });

    fetch(API_BASE + "/api/v1/chat/csat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": PK },
      body: JSON.stringify({ sessionId: sessionId, rating: rating })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function () {
        var thanks = document.createElement("div");
        thanks.id = "jb-csat-thanks";
        thanks.textContent = t("ratingThanks");
        wrap.appendChild(thanks);
      }).catch(function () {});
  }

  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    // Shift+Enter = newline (default textarea behaviour, no action needed)
  });

  // ---------- auto-open on delay if configured ----------
  // (future: CONFIG.autoOpenDelay = milliseconds)

})();
`;
};

module.exports = { getWidgetConfig, serveWidgetScript };
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Bot = require("../models/Bot");

// GET /api/v1/widget/config  (auth: public key)
const getWidgetConfig = asyncHandler(async (req, res) => {
  const bot = req.bot;
  res.status(200).json({
    success: true,
    data: {
      name: bot.name,
      widgetConfig: bot.widgetConfig,
      leadConfig: bot.leadConfig,
      agentConfig: bot.agentConfig,
      isActive: bot.isActive,
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
//   height     = chat window height in px (default 520)
//   width      = chat window width in px (default 360)
const serveWidgetScript = asyncHandler(async (req, res) => {
  const publicKey = req.query.key;
  if (!publicKey) throw new ApiError(400, "Missing ?key= parameter");

  const bot = await Bot.findOne({ publicKey });
  if (!bot || !bot.isActive) throw new ApiError(404, "Bot not found or inactive");

  const apiBaseUrl = process.env.API_BASE_URL || `${req.protocol}://${req.get("host")}`;

  // Merge saved config with per-embed query-string overrides
  const savedConfig = bot.widgetConfig || {};
  const config = {
    title: req.query.title || savedConfig.title || "Chat with us",
    primaryColor: req.query.color || savedConfig.primaryColor || "#f97316",
    welcomeMessage: req.query.welcome || savedConfig.welcomeMessage || "Hi! How can I help you today?",
    position: req.query.position || savedConfig.position || "bottom-right",
    theme: req.query.theme || "light",
    avatar: req.query.avatar || savedConfig.avatar || null,
    height: parseInt(req.query.height) || 520,
    width: parseInt(req.query.width) || 360,
    botName: bot.name,
    // Pre-chat lead capture form settings (name/email/phone + verification)
    leadConfig: bot.leadConfig || {
      enabled: false,
      collectName: true,
      nameRequired: false,
      identifierType: "email",
      identifierRequired: true,
      verifyIdentifier: false,
    },
    // Human handover — whether the "Talk to a human" option is offered at all.
    agentConfig: bot.agentConfig || { assignEnabled: false },
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

  if (document.getElementById("jb-root")) return; // prevent double-init

  var CONFIG   = ${cfg};
  var API_BASE = ${api};
  var PK       = ${key};
  var SK       = "jb_sid_" + PK; // localStorage key for persisting sessionId

  // ---------- helpers ----------
  function storageGet(k) { try { return localStorage.getItem(k); } catch(e) { return null; } }
  function storageSet(k,v) { try { localStorage.setItem(k,v); } catch(e) {} }
  function esc(s) {
    return String(s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;");
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

  var pos = CONFIG.position === "bottom-left"
    ? "left:20px;" : "right:20px;";

  // ---------- inject styles ----------
  var style = document.createElement("style");
  style.textContent = [
    // bubble
    "#jb-bubble{position:fixed;" + pos + "bottom:24px;width:56px;height:56px;border-radius:50%;",
    "background:" + CONFIG.primaryColor + ";cursor:pointer;display:flex;align-items:center;",
    "justify-content:center;z-index:2147483646;box-shadow:0 4px 20px " + colors.shadow + ";",
    "transition:transform .2s,box-shadow .2s;border:none;outline:none;}",
    "#jb-bubble:hover{transform:scale(1.08);box-shadow:0 8px 28px " + colors.shadow + ";}",
    "#jb-bubble svg{width:26px;height:26px;fill:#fff;transition:opacity .2s;}",
    "#jb-bubble .jb-close{display:none;}",
    "#jb-bubble.open .jb-chat{display:none;}",
    "#jb-bubble.open .jb-close{display:block;}",

    // window
    "#jb-win{position:fixed;" + pos + "bottom:92px;width:" + CONFIG.width + "px;",
    "max-width:calc(100vw - 32px);height:" + CONFIG.height + "px;max-height:calc(100vh - 120px);",
    "background:" + colors.bg + ";border-radius:16px;display:none;flex-direction:column;",
    "overflow:hidden;z-index:2147483645;box-shadow:0 8px 40px " + colors.shadow + ";",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;",
    "border:1px solid " + colors.border + ";}",
    "#jb-win.open{display:flex;}",

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
  // ends up chatting in.
  var sessionId = storageGet(SK);
  if (!sessionId) {
    sessionId = genId();
    storageSet(SK, sessionId);
  }

  var leadDone = !LEAD.enabled || storageGet(LEAD_DONE_KEY) === "1";

  // ---------- human handover state ----------
  var AGENT_CONFIG = CONFIG.agentConfig || { assignEnabled: false };
  var handoverStatus = "none"; // none | requested | assigned | resolved
  var lastPollAt = null;
  var historyLoaded = false;

  // ---------- build DOM ----------
  // Bubble button
  var bubble = document.createElement("button");
  bubble.id = "jb-bubble";
  bubble.setAttribute("aria-label", "Open chat");
  bubble.innerHTML =
    '<svg class="jb-chat" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>' +
    '<svg class="jb-close" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  // Chat window
  var win = document.createElement("div");
  win.id = "jb-win";
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", esc(CONFIG.title));

  // Avatar HTML
  var avatarHTML = CONFIG.avatar
    ? '<img src="' + esc(CONFIG.avatar) + '" alt="Bot avatar" />'
    : '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';

  win.innerHTML =
    '<div id="jb-head">' +
      '<div id="jb-head-avatar">' + avatarHTML + '</div>' +
      '<div id="jb-head-info">' +
        '<div id="jb-head-title">' + esc(CONFIG.title) + '</div>' +
        '<div id="jb-head-sub">&#x25CF; Online</div>' +
      '</div>' +
      '<button id="jb-head-close" aria-label="Close chat">' +
        '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
      '</button>' +
    '</div>' +
    '<div id="jb-msgs" role="log" aria-live="polite" aria-label="Chat messages"></div>' +
    '<div id="jb-powered">Powered by <a href="https://jestbot.ai" target="_blank" rel="noopener">JestBot</a></div>' +
    '<div id="jb-input-row">' +
      '<textarea id="jb-input" rows="1" placeholder="Type a message..." aria-label="Message input"></textarea>' +
      '<button id="jb-send" aria-label="Send message">' +
        '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
      '</button>' +
    '</div>';

  win.className = leadDone ? "jb-mode-chat" : "jb-mode-lead";

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
    '</div>';

  var leadEl = document.createElement("div");
  leadEl.id = "jb-lead";
  leadEl.innerHTML = leadHtml;
  win.appendChild(leadEl);

  // ---------- human handover bar ----------
  var handoverBarEl = null;
  if (AGENT_CONFIG.assignEnabled) {
    handoverBarEl = document.createElement("div");
    handoverBarEl.id = "jb-handover-bar";
    handoverBarEl.innerHTML = '<button id="jb-handover-btn" type="button">Talk to a human agent</button>';
    win.appendChild(handoverBarEl);
  }

  var msgsEl   = document.getElementById("jb-msgs");
  var inputEl  = document.getElementById("jb-input");
  var sendBtn  = document.getElementById("jb-send");
  var closeBtn = document.getElementById("jb-head-close");
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

  function showWelcome() {
    if (msgsEl.children.length === 0 && CONFIG.welcomeMessage) {
      addTimestamp();
      addMessage("bot", CONFIG.welcomeMessage);
    }
  }

  function leadComplete() {
    storageSet(LEAD_DONE_KEY, "1");
    leadDone = true;
    win.classList.remove("jb-mode-lead");
    win.classList.add("jb-mode-chat");
    showWelcome();
    setTimeout(function () { inputEl.focus(); }, 100);
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
    }).then(function () {
      leadComplete();
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

  // ---------- open / close ----------
  function openChat() {
    isOpen = true;
    win.classList.add("open");
    bubble.classList.add("open");
    bubble.setAttribute("aria-label", "Close chat");
    if (leadDone) {
      loadHistory();
      setTimeout(function () { inputEl.focus(); }, 100);
    } else {
      setTimeout(function () {
        if (leadNameEl) leadNameEl.focus();
        else if (leadIdEl) leadIdEl.focus();
      }, 100);
    }
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

  function addMessage(role, text, agentName) {
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
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
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
    if (btn) { btn.disabled = true; btn.textContent = "Connecting..."; }

    fetch(API_BASE + "/api/v1/chat/request-handover", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": PK },
      body: JSON.stringify({ sessionId: sessionId })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.message || "Could not connect to an agent"); });
      return r.json();
    }).then(function () {
      handoverStatus = "requested";
      addTimestamp();
      addSystemMessage("Connecting you with an agent...");
      hideHandoverBar();
      openEventStream();
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = "Talk to a human agent"; }
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
        addSystemMessage(data.assignedAgentName ? "You're now connected with " + data.assignedAgentName + "." : "An agent has joined the chat.");
      }
      if (data.status === "resolved") {
        closeEventStream();
      }
      handoverStatus = data.status;
      if (handoverStatus !== "none") hideHandoverBar();
    }

    (data.messages || []).forEach(function (m) {
      if (m.role === "user") {
        if (isInitialLoad) addMessage("user", m.content);
        return;
      }
      addMessage("bot", m.content, m.via === "agent" ? (m.agentName || "Agent") : null);
    });
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
  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || isStreaming) return;

    inputEl.value = "";
    inputEl.style.height = "auto";
    sendBtn.classList.remove("active");

    addTimestamp();
    addMessage("user", text);
    if (handoverStatus === "none") showTyping();
    isStreaming = true;

    var botEl = null;

    fetch(API_BASE + "/api/v1/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": PK
      },
      body: JSON.stringify({ message: text, sessionId: sessionId || undefined }),
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
                if (payload.sessionId) storageSet(SK, payload.sessionId);
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
                  addSystemMessage("Connecting you with an agent...");
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
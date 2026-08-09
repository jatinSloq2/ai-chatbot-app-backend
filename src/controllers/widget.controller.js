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
  ].join("");
  document.head.appendChild(style);

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

  document.body.appendChild(win);
  document.body.appendChild(bubble);

  var msgsEl   = document.getElementById("jb-msgs");
  var inputEl  = document.getElementById("jb-input");
  var sendBtn  = document.getElementById("jb-send");
  var closeBtn = document.getElementById("jb-head-close");
  var isOpen   = false;
  var isStreaming = false;

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
    if (msgsEl.children.length === 0 && CONFIG.welcomeMessage) {
      addTimestamp();
      addMessage("bot", CONFIG.welcomeMessage);
    }
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

  function addMessage(role, text) {
    var el = document.createElement("div");
    el.className = "jb-msg " + role;
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

  // ---------- send message ----------
  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || isStreaming) return;

    inputEl.value = "";
    inputEl.style.height = "auto";
    sendBtn.classList.remove("active");

    addTimestamp();
    addMessage("user", text);
    showTyping();
    isStreaming = true;

    var sessionId = storageGet(SK);
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
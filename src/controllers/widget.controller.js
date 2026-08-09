const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const Bot = require("../models/Bot");

// GET /api/v1/widget/config  (auth: public key via x-api-key or ?key=)
// Returns only what's safe to expose to a browser - no secrets, no LLM/embedding internals.
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

// GET /widget.js?key=pk_xxxxx
// Serves a self-contained script that any website can drop in with:
//   <script src="https://yourapi.com/widget.js?key=pk_xxxxx" async></script>
// It renders a floating chat bubble that talks to /api/v1/chat via SSE.
const serveWidgetScript = asyncHandler(async (req, res) => {
  const publicKey = req.query.key;
  if (!publicKey) throw new ApiError(400, "Missing ?key= parameter");

  const bot = await Bot.findOne({ publicKey });
  if (!bot || !bot.isActive) throw new ApiError(404, "Bot not found or inactive");

  const apiBaseUrl = process.env.API_BASE_URL || `${req.protocol}://${req.get("host")}`;

  const script = buildWidgetScript({
    apiBaseUrl,
    publicKey,
    widgetConfig: bot.widgetConfig,
  });

  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "public, max-age=300"); // 5 min cache, config changes propagate reasonably fast
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); // allow loading from any embedding site
  res.send(script);
});

// Builds the widget as a plain JS string (IIFE), safe to serve as a script tag.
// Kept dependency-free so it works on any website regardless of their stack.
const buildWidgetScript = ({ apiBaseUrl, publicKey, widgetConfig }) => `
(function () {
  var CONFIG = ${JSON.stringify(widgetConfig)};
  var API_BASE = ${JSON.stringify(apiBaseUrl)};
  var PUBLIC_KEY = ${JSON.stringify(publicKey)};
  var STORAGE_KEY = "ragbot_session_" + PUBLIC_KEY;

  function getSessionId() {
    try {
      return localStorage.getItem(STORAGE_KEY) || null;
    } catch (e) { return null; }
  }
  function setSessionId(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) {}
  }

  // --- Styles ---
  var style = document.createElement("style");
  style.textContent = [
    "#ragbot-bubble{position:fixed;" + (CONFIG.position === "bottom-left" ? "left:20px;" : "right:20px;") + "bottom:20px;width:60px;height:60px;border-radius:50%;background:" + CONFIG.primaryColor + ";box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:999999;}",
    "#ragbot-bubble svg{width:28px;height:28px;fill:#fff;}",
    "#ragbot-window{position:fixed;" + (CONFIG.position === "bottom-left" ? "left:20px;" : "right:20px;") + "bottom:90px;width:360px;max-width:90vw;height:520px;max-height:75vh;background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}",
    "#ragbot-header{background:" + CONFIG.primaryColor + ";color:#fff;padding:16px;font-weight:600;}",
    "#ragbot-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#f7f7f8;}",
    ".ragbot-msg{max-width:80%;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;}",
    ".ragbot-msg.user{align-self:flex-end;background:" + CONFIG.primaryColor + ";color:#fff;}",
    ".ragbot-msg.assistant{align-self:flex-start;background:#fff;color:#111;border:1px solid #e5e5e5;}",
    "#ragbot-input-row{display:flex;border-top:1px solid #eee;padding:10px;gap:8px;}",
    "#ragbot-input{flex:1;border:1px solid #ddd;border-radius:20px;padding:10px 14px;font-size:14px;outline:none;}",
    "#ragbot-send{background:" + CONFIG.primaryColor + ";color:#fff;border:none;border-radius:50%;width:38px;height:38px;cursor:pointer;flex-shrink:0;}"
  ].join("");
  document.head.appendChild(style);

  // --- DOM ---
  var bubble = document.createElement("div");
  bubble.id = "ragbot-bubble";
  bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h16v12H5.17L4 17.17V4m0-2c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2H4z"/></svg>';

  var win = document.createElement("div");
  win.id = "ragbot-window";
  win.innerHTML =
    '<div id="ragbot-header">' + CONFIG.title + '</div>' +
    '<div id="ragbot-messages"></div>' +
    '<div id="ragbot-input-row">' +
    '<input id="ragbot-input" type="text" placeholder="Type a message..." />' +
    '<button id="ragbot-send">&#8594;</button>' +
    '</div>';

  document.body.appendChild(bubble);
  document.body.appendChild(win);

  var messagesEl = win.querySelector("#ragbot-messages");
  var inputEl = win.querySelector("#ragbot-input");
  var sendBtn = win.querySelector("#ragbot-send");
  var isOpen = false;
  var isStreaming = false;

  function appendMessage(role, text) {
    var el = document.createElement("div");
    el.className = "ragbot-msg " + role;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  bubble.addEventListener("click", function () {
    isOpen = !isOpen;
    win.style.display = isOpen ? "flex" : "none";
    if (isOpen && messagesEl.children.length === 0 && CONFIG.welcomeMessage) {
      appendMessage("assistant", CONFIG.welcomeMessage);
    }
  });

  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || isStreaming) return;
    inputEl.value = "";
    appendMessage("user", text);
    var assistantEl = appendMessage("assistant", "");
    isStreaming = true;

    fetch(API_BASE + "/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": PUBLIC_KEY },
      body: JSON.stringify({ message: text, sessionId: getSessionId() }),
    }).then(function (response) {
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";

      function read() {
        reader.read().then(function (result) {
          if (result.done) { isStreaming = false; return; }
          buffer += decoder.decode(result.value, { stream: true });
          var parts = buffer.split("\\n\\n");
          buffer = parts.pop();
          parts.forEach(function (part) {
            var lines = part.split("\\n");
            var event = "", data = "";
            lines.forEach(function (line) {
              if (line.indexOf("event:") === 0) event = line.replace("event:", "").trim();
              if (line.indexOf("data:") === 0) data = line.replace("data:", "").trim();
            });
            if (!data) return;
            try {
              var parsed = JSON.parse(data);
              if (event === "session" && parsed.sessionId) setSessionId(parsed.sessionId);
              if (event === "token") assistantEl.textContent += parsed.token;
              if (event === "error") assistantEl.textContent = "Error: " + parsed.message;
            } catch (e) {}
            messagesEl.scrollTop = messagesEl.scrollHeight;
          });
          read();
        });
      }
      read();
    }).catch(function () {
      assistantEl.textContent = "Sorry, something went wrong. Please try again.";
      isStreaming = false;
    });
  }

  sendBtn.addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") sendMessage();
  });
})();
`;

module.exports = { getWidgetConfig, serveWidgetScript };

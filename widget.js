(function () {
  "use strict";

  // ── Config ─────────────────────────────────────────────────────────────────
  // Read backend URL from the script tag: <script src="widget.js" data-backend="https://yourserver.com">
  const scriptTag  = document.currentScript ||
    [...document.querySelectorAll("script")].find(s => s.src && s.src.includes("widget.js"));
  const BACKEND    = (scriptTag && scriptTag.getAttribute("data-backend")) || "http://localhost:3000";
  const API_URL    = BACKEND.replace(/\/$/, "") + "/api/chat";

  // Guard against loading twice
  if (window.__scalelabWidget) return;
  window.__scalelabWidget = true;

  // ── Conversation state ──────────────────────────────────────────────────────
  const history = [];
  let   isOpen  = false;
  let   isLoading = false;
  let   greeted = false;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const css = `
    #sla-launcher {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483646;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 12px;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    }

    /* ── Tooltip ── */
    #sla-tooltip {
      background: #020D18;
      color: #e8f4f8;
      font-size: 13px;
      padding: 8px 14px;
      border-radius: 20px;
      border: 1px solid rgba(0,212,255,0.25);
      white-space: nowrap;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      animation: sla-fade-in 0.3s ease;
      cursor: pointer;
    }

    /* ── Bubble button ── */
    #sla-bubble {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: #00D4FF;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 24px rgba(0,212,255,0.45);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      position: relative;
      flex-shrink: 0;
    }
    #sla-bubble:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 28px rgba(0,212,255,0.6);
    }
    #sla-bubble svg { width: 26px; height: 26px; fill: #020D18; transition: opacity 0.2s; }
    #sla-bubble .sla-icon-chat  { opacity: 1; position: absolute; }
    #sla-bubble .sla-icon-close { opacity: 0; position: absolute; }
    #sla-launcher.sla-open #sla-bubble .sla-icon-chat  { opacity: 0; }
    #sla-launcher.sla-open #sla-bubble .sla-icon-close { opacity: 1; }

    /* ── Unread badge ── */
    #sla-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 18px;
      height: 18px;
      background: #ff4d6d;
      border-radius: 50%;
      border: 2px solid #fff;
      font-size: 10px;
      font-weight: 700;
      color: #fff;
      display: none;
      align-items: center;
      justify-content: center;
      font-family: 'Segoe UI', sans-serif;
    }
    #sla-badge.sla-visible { display: flex; }

    /* ── Chat window ── */
    #sla-window {
      position: fixed;
      bottom: 98px;
      right: 24px;
      z-index: 2147483645;
      width: 360px;
      height: 520px;
      background: #020D18;
      border: 1px solid rgba(0,212,255,0.18);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 16px 48px rgba(0,0,0,0.55);
      transform: translateY(16px) scale(0.97);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    }
    #sla-window.sla-visible {
      transform: translateY(0) scale(1);
      opacity: 1;
      pointer-events: all;
    }

    /* ── Header ── */
    #sla-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      background: #071a2e;
      border-bottom: 1px solid rgba(0,212,255,0.15);
      flex-shrink: 0;
    }
    #sla-avatar {
      width: 36px;
      height: 36px;
      border-radius: 9px;
      background: rgba(0,212,255,0.12);
      border: 1px solid rgba(0,212,255,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    #sla-avatar svg { width: 18px; height: 18px; fill: #00D4FF; }
    #sla-header-text { flex: 1; min-width: 0; }
    #sla-header-text strong {
      display: block;
      font-size: 13px;
      font-weight: 700;
      color: #00D4FF;
      letter-spacing: 0.02em;
    }
    #sla-header-text span {
      font-size: 11px;
      color: #7da8be;
    }
    #sla-status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 6px #22c55e;
      flex-shrink: 0;
      animation: sla-pulse 2s infinite;
    }

    /* ── Messages ── */
    #sla-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scroll-behavior: smooth;
    }
    #sla-messages::-webkit-scrollbar { width: 4px; }
    #sla-messages::-webkit-scrollbar-track { background: transparent; }
    #sla-messages::-webkit-scrollbar-thumb { background: rgba(0,212,255,0.2); border-radius: 2px; }

    .sla-msg {
      display: flex;
      gap: 8px;
      max-width: 88%;
      animation: sla-fade-up 0.22s ease;
    }
    .sla-msg.sla-bot  { align-self: flex-start; }
    .sla-msg.sla-user { align-self: flex-end; flex-direction: row-reverse; }

    .sla-av {
      width: 28px;
      height: 28px;
      border-radius: 7px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .sla-msg.sla-bot .sla-av {
      background: rgba(0,212,255,0.1);
      border: 1px solid rgba(0,212,255,0.2);
      color: #00D4FF;
    }
    .sla-msg.sla-user .sla-av {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      color: #7da8be;
    }

    .sla-bubble {
      padding: 9px 13px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
    }
    .sla-msg.sla-bot .sla-bubble {
      background: #0d2440;
      border: 1px solid rgba(0,212,255,0.15);
      border-top-left-radius: 3px;
      color: #e8f4f8;
    }
    .sla-msg.sla-user .sla-bubble {
      background: #00D4FF;
      color: #020D18;
      font-weight: 500;
      border-top-right-radius: 3px;
    }

    /* ── Typing indicator ── */
    .sla-typing { display: flex; align-items: center; gap: 4px; padding: 10px 13px; }
    .sla-typing span {
      width: 6px; height: 6px; border-radius: 50%;
      background: #00D4FF; opacity: 0.4;
      animation: sla-bounce 1.2s infinite ease-in-out;
      display: block;
    }
    .sla-typing span:nth-child(2) { animation-delay: 0.15s; }
    .sla-typing span:nth-child(3) { animation-delay: 0.30s; }

    /* ── Input ── */
    #sla-input-area {
      padding: 10px 12px 14px;
      background: #071a2e;
      border-top: 1px solid rgba(0,212,255,0.12);
      flex-shrink: 0;
    }
    #sla-input-row { display: flex; gap: 8px; align-items: flex-end; }
    #sla-input {
      flex: 1;
      background: #0d2440;
      border: 1px solid rgba(0,212,255,0.18);
      border-radius: 8px;
      color: #e8f4f8;
      font-size: 13px;
      font-family: inherit;
      padding: 9px 12px;
      resize: none;
      min-height: 38px;
      max-height: 100px;
      outline: none;
      transition: border-color 0.2s;
      line-height: 1.4;
    }
    #sla-input::placeholder { color: #4a7a96; }
    #sla-input:focus { border-color: #00D4FF; }

    #sla-send {
      width: 38px;
      height: 38px;
      border-radius: 8px;
      background: #00D4FF;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.2s, transform 0.1s;
    }
    #sla-send:hover:not(:disabled) { background: #00a8cc; }
    #sla-send:active:not(:disabled) { transform: scale(0.93); }
    #sla-send:disabled { opacity: 0.38; cursor: not-allowed; }
    #sla-send svg { width: 15px; height: 15px; fill: #020D18; }

    #sla-footer {
      text-align: center;
      font-size: 10px;
      color: #3a6070;
      margin-top: 8px;
      letter-spacing: 0.02em;
    }

    /* ── Animations ── */
    @keyframes sla-fade-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes sla-fade-up {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes sla-pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.45; }
    }
    @keyframes sla-bounce {
      0%, 80%, 100% { transform: translateY(0);   opacity: 0.4; }
      40%            { transform: translateY(-5px); opacity: 1;   }
    }

    /* ── Mobile ── */
    @media (max-width: 420px) {
      #sla-window {
        right: 0; left: 0; bottom: 0;
        width: 100%; height: 70vh;
        border-radius: 16px 16px 0 0;
      }
      #sla-launcher { right: 16px; bottom: 16px; }
    }
  `;

  // ── Inject styles ───────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ── Build DOM ───────────────────────────────────────────────────────────────
  // Chat window
  const win = document.createElement("div");
  win.id = "sla-window";
  win.innerHTML = `
    <div id="sla-header">
      <div id="sla-avatar">
        <svg viewBox="0 0 24 24"><path d="M12 2L14.5 9H22L16 13.5L18.5 20.5L12 16L5.5 20.5L8 13.5L2 9H9.5L12 2Z"/></svg>
      </div>
      <div id="sla-header-text">
        <strong>ScaleLab AI</strong>
        <span>Lead Response Agent</span>
      </div>
      <div id="sla-status-dot"></div>
    </div>
    <div id="sla-messages"></div>
    <div id="sla-input-area">
      <div id="sla-input-row">
        <textarea id="sla-input" placeholder="Type a message..." rows="1"></textarea>
        <button id="sla-send">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
      <div id="sla-footer">Powered by ScaleLab AI</div>
    </div>
  `;

  // Launcher (bubble + tooltip)
  const launcher = document.createElement("div");
  launcher.id = "sla-launcher";
  launcher.innerHTML = `
    <div id="sla-tooltip">👋 Get a free quote!</div>
    <button id="sla-bubble" aria-label="Open chat">
      <svg class="sla-icon-chat" viewBox="0 0 24 24">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
      <svg class="sla-icon-close" viewBox="0 0 24 24">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
      <div id="sla-badge">1</div>
    </button>
  `;

  document.body.appendChild(win);
  document.body.appendChild(launcher);

  // ── Element refs ────────────────────────────────────────────────────────────
  const messagesEl = document.getElementById("sla-messages");
  const inputEl    = document.getElementById("sla-input");
  const sendBtn    = document.getElementById("sla-send");
  const bubble     = document.getElementById("sla-bubble");
  const badge      = document.getElementById("sla-badge");
  const tooltip    = document.getElementById("sla-tooltip");

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role, text) {
    const wrap = document.createElement("div");
    wrap.className = `sla-msg sla-${role}`;
    wrap.innerHTML = `
      <div class="sla-av">${role === "bot" ? "AI" : "You"}</div>
      <div class="sla-bubble">${text.replace(/\n/g, "<br>")}</div>
    `;
    messagesEl.appendChild(wrap);
    scrollBottom();
  }

  function showTyping() {
    const wrap = document.createElement("div");
    wrap.className = "sla-msg sla-bot";
    wrap.id = "sla-typing";
    wrap.innerHTML = `
      <div class="sla-av">AI</div>
      <div class="sla-bubble"><div class="sla-typing"><span></span><span></span><span></span></div></div>
    `;
    messagesEl.appendChild(wrap);
    scrollBottom();
  }

  function removeTyping() {
    const el = document.getElementById("sla-typing");
    if (el) el.remove();
  }

  function setLoading(state) {
    isLoading         = state;
    sendBtn.disabled  = state;
    inputEl.disabled  = state;
  }

  function autoResize() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + "px";
  }

  function showBadge() {
    if (!isOpen) badge.classList.add("sla-visible");
  }

  function hideBadge() {
    badge.classList.remove("sla-visible");
  }

  // ── API call ────────────────────────────────────────────────────────────────
  async function fetchAI(messages) {
    const res = await fetch(API_URL, {
      method  : "POST",
      headers : { "Content-Type": "application/json" },
      body    : JSON.stringify({ messages }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }
    const data = await res.json();
    return data.content || "";
  }

  // ── Send message ─────────────────────────────────────────────────────────────
  async function sendMessage(text) {
    text = text.trim();
    if (!text || isLoading) return;

    addMessage("user", text);
    history.push({ role: "user", content: text });

    inputEl.value = "";
    autoResize();
    setLoading(true);
    showTyping();

    try {
      const reply = await fetchAI(history);
      removeTyping();
      history.push({ role: "assistant", content: reply });
      addMessage("bot", reply);
      if (!isOpen) showBadge();
    } catch (err) {
      removeTyping();
      addMessage("bot", "Sorry, something went wrong. Please try again.");
      console.error("[ScaleLab Widget]", err.message);
    } finally {
      setLoading(false);
      inputEl.focus();
    }
  }

  // ── Open / close ────────────────────────────────────────────────────────────
  function openWidget() {
    isOpen = true;
    win.classList.add("sla-visible");
    launcher.classList.add("sla-open");
    tooltip.style.display = "none";
    hideBadge();
    inputEl.focus();

    // Fire greeting on first open
    if (!greeted) {
      greeted = true;
      setLoading(true);
      showTyping();
      fetchAI([{
        role: "user",
        content: "[System: The customer just opened the chat widget. Greet them warmly and ask your first qualifying question.]"
      }]).then(reply => {
        removeTyping();
        history.push({ role: "assistant", content: reply });
        addMessage("bot", reply);
      }).catch(() => {
        removeTyping();
        addMessage("bot", "Hi there! 👋 What type of service are you looking for today?");
      }).finally(() => setLoading(false));
    }
  }

  function closeWidget() {
    isOpen = false;
    win.classList.remove("sla-visible");
    launcher.classList.remove("sla-open");
  }

  function toggleWidget() {
    isOpen ? closeWidget() : openWidget();
  }

  // ── Event listeners ─────────────────────────────────────────────────────────
  bubble.addEventListener("click", toggleWidget);
  tooltip.addEventListener("click", openWidget);

  sendBtn.addEventListener("click", () => sendMessage(inputEl.value));

  inputEl.addEventListener("input", autoResize);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputEl.value);
    }
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) closeWidget();
  });

  // Auto-show tooltip after 3 seconds, hide after 6s
  setTimeout(() => {
    if (!isOpen) tooltip.style.display = "block";
    setTimeout(() => {
      if (!isOpen) tooltip.style.display = "none";
    }, 6000);
  }, 3000);

})();

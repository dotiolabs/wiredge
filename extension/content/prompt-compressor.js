// Wiredge — inline prompt compressor
// Injects a small button next to the send/enter button on LLM sites.
// Click -> reads the prompt -> compresses -> replaces with shorter version.
// by dotiolabs
(() => {
  const BTN_ID = "wiredge-compress-fab";
  const PANEL_ID = "wiredge-compress-panel";
  const MIN_CHARS = 30;

  // -- Per-site selectors --
  const HOST = location.host;
  const SITE = (() => {
    if (/claude\.ai$/.test(HOST)) return "claude";
    if (/chatgpt\.com$|openai\.com$/.test(HOST)) return "chatgpt";
    if (/gemini\.google\.com$/.test(HOST)) return "gemini";
    if (/grok\.com$|x\.ai$/.test(HOST)) return "grok";
    return null;
  })();
  if (!SITE) return;

  const INPUT_SELECTORS = {
    claude: [
      'div.ProseMirror[contenteditable="true"]',
      'fieldset div[contenteditable="true"]',
      'div[contenteditable="true"]',
    ],
    chatgpt: [
      "#prompt-textarea",
      'div[contenteditable="true"][id*="prompt"]',
      'div[contenteditable="true"]',
      "textarea",
    ],
    gemini: [
      'div.ql-editor[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"]',
      "textarea",
    ],
    grok: [
      'textarea[placeholder*="Ask"]',
      "textarea",
      'div[contenteditable="true"]',
    ],
  };

  // Send/enter button selectors per site
  const SEND_SELECTORS = {
    claude: [
      'button[aria-label="Send Message"]',
      'button[aria-label="Send message"]',
      'button[data-testid="send-button"]',
      'fieldset button:last-of-type',
    ],
    chatgpt: [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send"]',
      'form button[type="submit"]',
    ],
    gemini: [
      'button[aria-label="Send message"]',
      'button.send-button',
      'button[data-testid="send-button"]',
    ],
    grok: [
      'button[aria-label="Send"]',
      'button[aria-label="Submit"]',
      'button[type="submit"]',
    ],
  };

  // -- Helpers --

  function findInput() {
    for (const sel of INPUT_SELECTORS[SITE]) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function findSendBtn() {
    for (const sel of (SEND_SELECTORS[SITE] || [])) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function getInputText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
    return el.innerText || el.textContent || "";
  }

  function setInputText(el, text) {
    if (!el) return;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      var setter =
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set ||
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.focus();
      return;
    }
    // contenteditable
    el.focus();
    el.innerHTML = "";
    var lines = text.split("\n");
    var frag = document.createDocumentFragment();
    for (var i = 0; i < lines.length; i++) {
      var p = document.createElement("p");
      p.textContent = lines[i] || "\u200B";
      frag.appendChild(p);
    }
    el.appendChild(frag);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  }

  // -- Styles --

  function injectStyles() {
    if (document.getElementById("wiredge-compressor-styles")) return;
    var style = document.createElement("style");
    style.id = "wiredge-compressor-styles";
    style.textContent = [
      "#" + BTN_ID + " {",
      "  position:fixed; z-index:2147483646;",
      "  width:30px; height:30px; border-radius:8px;",
      "  background:linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%);",
      "  border:1px solid rgba(99,102,241,0.4);",
      "  box-shadow:0 2px 8px rgba(79,70,229,0.3);",
      "  cursor:pointer; display:flex; align-items:center; justify-content:center;",
      "  transition:all 0.2s ease; opacity:0; transform:scale(0.8); pointer-events:none;",
      "}",
      "#" + BTN_ID + ".visible { opacity:0.5; filter:grayscale(100%); transform:scale(1); pointer-events:auto; }",
      "#" + BTN_ID + ".has-text { opacity:1; filter:none; transform:scale(1.05); }",
      "#" + BTN_ID + ":hover { filter:brightness(1.15) !important; transform:scale(1.08) !important; box-shadow:0 4px 16px rgba(79,70,229,0.45); }",
      "#" + BTN_ID + ":active { transform:scale(0.95) !important; }",
      "#" + BTN_ID + " svg { pointer-events:none; }",
      "#" + BTN_ID + " .wiredge-fab-badge {",
      "  position:absolute; top:-3px; right:-3px; width:8px; height:8px;",
      "  border-radius:50%; background:#22C55E; border:1.5px solid #09090B; display:none;",
      "}",
      "#" + BTN_ID + ".has-text .wiredge-fab-badge { display:block; }",
      "",
      "#" + PANEL_ID + " {",
      "  position:fixed; z-index:2147483647; width:340px;",
      "  background:#0D0D10; border:1px solid rgba(255,255,255,0.08);",
      "  border-radius:12px; box-shadow:0 16px 48px rgba(0,0,0,0.5),0 0 0 1px rgba(99,102,241,0.15);",
      "  font-family:'Inter',-apple-system,system-ui,sans-serif; color:#E4E4E7;",
      "  overflow:hidden; opacity:0; transform:translateY(8px) scale(0.96);",
      "  pointer-events:none; transition:all 0.2s cubic-bezier(0.16,1,0.3,1);",
      "}",
      "#" + PANEL_ID + ".open { opacity:1; transform:translateY(0) scale(1); pointer-events:auto; }",
      "",
      ".wiredge-cp-head { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.06); background:rgba(99,102,241,0.04); }",
      ".wiredge-cp-brand { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:#E4E4E7; }",
      ".wiredge-cp-dot { width:6px; height:6px; border-radius:50%; background:#6366F1; box-shadow:0 0 6px rgba(99,102,241,0.6); }",
      ".wiredge-cp-close { background:none; border:none; color:#52525B; cursor:pointer; font-size:16px; line-height:1; padding:2px 4px; border-radius:4px; }",
      ".wiredge-cp-close:hover { color:#A1A1AA; background:rgba(255,255,255,0.06); }",
      ".wiredge-cp-body { padding:12px 14px; }",
      ".wiredge-cp-preview { background:#111113; border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:10px 12px; font-family:'JetBrains Mono',ui-monospace,monospace; font-size:11.5px; line-height:1.7; color:#A78BFA; max-height:200px; overflow-y:auto; white-space:pre-wrap; word-break:break-word; margin-bottom:10px; }",
      ".wiredge-cp-preview::-webkit-scrollbar { width:4px; }",
      ".wiredge-cp-preview::-webkit-scrollbar-track { background:transparent; }",
      ".wiredge-cp-preview::-webkit-scrollbar-thumb { background:#27272A; border-radius:2px; }",
      ".wiredge-cp-meta { display:flex; align-items:center; justify-content:space-between; font-size:11px; color:#52525B; margin-bottom:10px; }",
      ".wiredge-cp-savings { color:#22C55E; font-weight:600; }",
      ".wiredge-cp-actions { display:flex; gap:6px; }",
      ".wiredge-cp-btn { flex:1; padding:8px 12px; border-radius:7px; border:none; font-family:'Inter',system-ui; font-size:12px; font-weight:500; cursor:pointer; transition:all 0.15s; display:flex; align-items:center; justify-content:center; gap:5px; }",
      ".wiredge-cp-btn.primary { background:linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%); color:#fff; box-shadow:0 2px 10px rgba(79,70,229,0.25); }",
      ".wiredge-cp-btn.primary:hover { filter:brightness(1.1); }",
      ".wiredge-cp-btn.secondary { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); color:#A1A1AA; }",
      ".wiredge-cp-btn.secondary:hover { background:rgba(255,255,255,0.08); color:#E4E4E7; }",
      ".wiredge-cp-btn:disabled { opacity:0.5; cursor:not-allowed; }",
      ".wiredge-cp-btn.success { background:rgba(34,197,94,0.12)!important; border-color:rgba(34,197,94,0.3)!important; color:#22C55E!important; }",
      ".wiredge-cp-loading { padding:24px 14px; text-align:center; color:#52525B; font-size:12px; }",
      ".wiredge-cp-loading .wiredge-cp-spinner { display:inline-block; width:20px; height:20px; border:2px solid rgba(99,102,241,0.2); border-top-color:#6366F1; border-radius:50%; animation:wiredgeSpin 0.7s linear infinite; margin-bottom:8px; }",
      "@keyframes wiredgeSpin { to { transform:rotate(360deg); } }",
      ".wiredge-cp-err { padding:8px 10px; margin-bottom:10px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:6px; font-size:11.5px; color:#FCA5A5; line-height:1.45; }",
      ".wiredge-cp-empty { padding:20px 14px; text-align:center; color:#52525B; font-size:12px; line-height:1.5; }",
      ".wiredge-cp-empty strong { color:#A1A1AA; font-weight:500; }",
    ].join("\n");
    document.head.appendChild(style);
  }

  // -- FAB creation --

  function createFab() {
    if (document.getElementById(BTN_ID)) return;
    var btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.title = "Wiredge \u2014 Compress prompt";
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span class="wiredge-fab-badge"></span>';
    document.body.appendChild(btn);
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      togglePanel();
    });
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    var panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = '<div class="wiredge-cp-head"><span class="wiredge-cp-brand"><span class="wiredge-cp-dot"></span> Wiredge Compress</span><button class="wiredge-cp-close" id="wiredge-cp-close" title="Close">\u2715</button></div><div class="wiredge-cp-body" id="wiredge-cp-body"><div class="wiredge-cp-empty">Type a prompt in the chat input<br/>then click <strong>\u26A1 Compress</strong></div></div>';
    document.body.appendChild(panel);
    panel.querySelector("#wiredge-cp-close").addEventListener("click", closePanel);
    document.addEventListener("click", function(e) {
      var p = document.getElementById(PANEL_ID);
      var b = document.getElementById(BTN_ID);
      if (p && p.classList.contains("open") && !p.contains(e.target) && b && !b.contains(e.target)) {
        closePanel();
      }
    });
  }

  // -- Positioning: anchored next to the send/enter button --

  function positionUI() {
    var input = findInput();
    var fab = document.getElementById(BTN_ID);
    var panel = document.getElementById(PANEL_ID);
    if (!fab) return;

    if (!input) {
      fab.classList.remove("visible");
      return;
    }

    var sendBtn = findSendBtn();
    var fabSize = 30;
    var gap = 6;
    var fabLeft, fabTop;

    if (sendBtn) {
      // Place directly to the LEFT of the send button
      var sr = sendBtn.getBoundingClientRect();
      fabLeft = sr.left - fabSize - gap;
      fabTop = sr.top + (sr.height / 2) - (fabSize / 2);
    } else {
      // Fallback: bottom-right area of the input container
      var container = input.closest("form, fieldset, [class*='composer'], [class*='input-area']") || input.parentElement;
      var cr = (container || input).getBoundingClientRect();
      fabLeft = cr.right - fabSize - 52;
      fabTop = cr.bottom - fabSize - gap;
    }

    // Clamp to viewport
    fabTop = Math.max(10, Math.min(fabTop, window.innerHeight - fabSize - 10));
    fabLeft = Math.max(10, Math.min(fabLeft, window.innerWidth - fabSize - 10));

    fab.style.top = fabTop + "px";
    fab.style.left = fabLeft + "px";
    // Badge when input has enough text
    var text = getInputText(input).trim();
    if (text.length === 0) {
      fab.classList.add("visible");
      fab.classList.remove("has-text");
    } else {
      fab.classList.add("visible");
      fab.classList.toggle("has-text", text.length >= MIN_CHARS);
    }

    // Position panel ABOVE the fab
    if (panel) {
      var panelWidth = 340;
      var panelHeight = 320;
      var panelLeft = fabLeft + (fabSize / 2) - (panelWidth / 2);
      var panelTop = fabTop - panelHeight - 10;

      // If no room above, put below
      if (panelTop < 10) panelTop = fabTop + fabSize + 10;
      // Clamp horizontal
      if (panelLeft < 10) panelLeft = 10;
      if (panelLeft + panelWidth > window.innerWidth - 10) panelLeft = window.innerWidth - panelWidth - 10;

      panel.style.top = panelTop + "px";
      panel.style.left = panelLeft + "px";
    }
  }

  // -- Panel logic --

  var isOpen = false;
  var lastCompressed = null;

  function togglePanel() {
    if (isOpen) closePanel();
    else openPanel();
  }

  function openPanel() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    isOpen = true;
    panel.classList.add("open");
    positionUI();
    var input = findInput();
    var text = getInputText(input).trim();
    if (text.length >= MIN_CHARS) {
      doCompress(text);
    } else {
      showEmptyState();
    }
  }

  function closePanel() {
    var panel = document.getElementById(PANEL_ID);
    if (panel) panel.classList.remove("open");
    isOpen = false;
  }

  function showEmptyState() {
    var body = document.getElementById("wiredge-cp-body");
    if (!body) return;
    body.innerHTML = '<div class="wiredge-cp-empty" style="text-align:left; padding: 0 4px;">' +
      '<div style="margin-bottom:8px; color:#A1A1AA; font-size:11.5px;">Paste massive code blocks directly here:</div>' +
      '<textarea id="wiredge-cp-manual-input" style="width:100%; height:140px; background:#111113; border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#E4E4E7; padding:10px; font-family:monospace; font-size:11px; resize:none;" placeholder="Paste code to compress..."></textarea>' +
      '<button class="wiredge-cp-btn primary" id="wiredge-cp-manual-btn" style="width:100%; margin-top:10px;">\u26A1 Compress</button>' +
      '</div>';
      
    var manualBtn = document.getElementById("wiredge-cp-manual-btn");
    var manualInput = document.getElementById("wiredge-cp-manual-input");
    if (manualBtn && manualInput) {
      manualBtn.addEventListener("click", function() {
        var val = manualInput.value.trim();
        if (val.length >= MIN_CHARS) {
          doCompress(val);
        } else {
          manualInput.placeholder = "Please paste more code...";
        }
      });
    }
  }

  function showLoading() {
    var body = document.getElementById("wiredge-cp-body");
    if (!body) return;
    body.innerHTML = '<div class="wiredge-cp-loading"><div class="wiredge-cp-spinner"></div><div>Compressing prompt\u2026</div></div>';
  }

  function showError(msg) {
    var body = document.getElementById("wiredge-cp-body");
    if (!body) return;
    body.innerHTML = '<div class="wiredge-cp-err">' + escapeHtml(msg) + '</div><div class="wiredge-cp-actions"><button class="wiredge-cp-btn secondary" id="wiredge-cp-retry">Retry</button></div>';
    var retryBtn = body.querySelector("#wiredge-cp-retry");
    if (retryBtn) {
      retryBtn.addEventListener("click", function() {
        var input = findInput();
        var text = getInputText(input).trim();
        if (text.length >= MIN_CHARS) doCompress(text);
      });
    }
  }

  function estimateTokens(text) {
    return Math.max(1, Math.ceil((text || "").replace(/\s+/g, " ").length / 4));
  }

  function showResult(original, compressed) {
    var body = document.getElementById("wiredge-cp-body");
    if (!body) return;
    lastCompressed = compressed;

    var origTokens = estimateTokens(original);
    var compTokens = estimateTokens(compressed);
    var savings = origTokens > 5 ? Math.max(0, Math.round((1 - compTokens / origTokens) * 100)) : 0;

    var savingsHtml = savings > 0 ? '<span class="wiredge-cp-savings">\u2193 ' + savings + '% saved</span>' : "";

    body.innerHTML = '<div class="wiredge-cp-preview">' + escapeHtml(compressed) + '</div>' +
      '<div class="wiredge-cp-meta"><span>~' + compTokens + ' tokens</span>' + savingsHtml + '</div>' +
      '<div class="wiredge-cp-actions"><button class="wiredge-cp-btn primary" id="wiredge-cp-paste">\u26A1 Paste & Replace</button><button class="wiredge-cp-btn secondary" id="wiredge-cp-copy">Copy</button></div>';

    var pasteBtn = body.querySelector("#wiredge-cp-paste");
    if (pasteBtn) {
      pasteBtn.addEventListener("click", function() {
        var input = findInput();
        if (!input) return;
        setInputText(input, compressed);
        pasteBtn.classList.add("success");
        pasteBtn.innerHTML = "\u2713 Pasted!";
        setTimeout(function() { closePanel(); }, 900);
      });
    }

    var copyBtn = body.querySelector("#wiredge-cp-copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", function() {
        navigator.clipboard.writeText(compressed).then(function() {
          copyBtn.classList.add("success");
          copyBtn.textContent = "\u2713 Copied";
          setTimeout(function() {
            copyBtn.classList.remove("success");
            copyBtn.textContent = "Copy";
          }, 1500);
        });
      });
    }
  }

  // -- Error mapper --

  function mapError(raw) {
    var m = (raw || '').toLowerCase();
    if (m.includes('extension context invalidated') || m.includes('context invalidated'))
      return 'Extension was reloaded. Please refresh this page (F5).';
    if (m.includes('could not establish connection') || m.includes('receiving end does not exist'))
      return 'Cannot reach Wiredge. Refresh this page (F5).';
    if (m.includes('disconnected') || m.includes('port closed'))
      return 'Connection lost. Refresh this page (F5).';
    if (m.includes('network') || m.includes('failed to fetch'))
      return 'Network error. Check your internet and try again.';
    if (m.includes('429') || m.includes('rate limit'))
      return 'Rate limited. Wait 30 seconds and try again.';
    if (m.includes('503') || m.includes('overloaded'))
      return 'AI service is busy. Wait a minute and try again.';
    if (m.includes('401') || m.includes('unauthorized'))
      return 'Invalid API key. Check Wiredge Settings.';
    if (m.includes('timeout'))
      return 'Request timed out. Try again.';
    return raw;
  }

  async function doCompress(text) {
    showLoading();
    try {
      var response = await chrome.runtime.sendMessage({ action: "compress", prompt: text });
      if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
      if (!response) throw new Error("No response. Refresh this page (F5) and try again.");
      if (!response.success) throw new Error(response.error || "Compression failed.");
      var compressed = (response.data || "").trim();
      if (!compressed) throw new Error("Empty result \u2014 try a longer prompt.");
      showResult(text, compressed);
    } catch (e) {
      showError(mapError(e.message || "Compression failed."));
    }
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // -- Init --

  function init() {
    injectStyles();
    createFab();
    createPanel();
    positionUI();
  }

  var positionRaf = null;
  function schedulePosition() {
    if (positionRaf) return;
    positionRaf = requestAnimationFrame(function() {
      positionUI();
      positionRaf = null;
    });
  }
  window.addEventListener("scroll", schedulePosition, { passive: true, capture: true });
  window.addEventListener("resize", schedulePosition, { passive: true });

  var obsTimer = null;
  var obs = new MutationObserver(function() { 
    if (obsTimer) clearTimeout(obsTimer);
    obsTimer = setTimeout(schedulePosition, 100);
  });

  if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
    obs.observe(document.body, { childList: true, subtree: true });
  } else {
    window.addEventListener("DOMContentLoaded", function() {
      init();
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }
})();

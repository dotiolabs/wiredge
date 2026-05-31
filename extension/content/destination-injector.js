// Wiredge — destination injector.
// Runs on chatgpt.com / gemini.google.com / grok.com.
// On load, checks chrome.storage.local for a pending capsule whose `dest`
// matches this host. If found: finds the chat input, pastes the capsule text,
// and shows a small confirmation toast.
// by dotiolabs
(() => {
  const HOST = location.host;
  const STORAGE_KEY = "wiredge:pendingCapsule";

  const DEST_FOR_HOST = (() => {
    if (/chatgpt\.com$|openai\.com$/.test(HOST)) return "chatgpt";
    if (/gemini\.google\.com$/.test(HOST)) return "gemini";
    if (/grok\.com$|x\.ai$/.test(HOST)) return "grok";
    return null;
  })();
  if (!DEST_FOR_HOST) return;

  // Per-destination selectors — first match wins.
  const SELECTORS = {
    chatgpt: [
      "#prompt-textarea",
      'div[contenteditable="true"][id*="prompt"]',
      'textarea[data-testid*="prompt"]',
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

  const FRESH_MS = 90 * 1000; // ignore capsules older than 90s

  async function takePending() {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    const c = r[STORAGE_KEY];
    if (!c) return null;
    if (c.dest !== DEST_FOR_HOST) return null;
    if (Date.now() - (c.ts ?? 0) > FRESH_MS) {
      await chrome.storage.local.remove(STORAGE_KEY);
      return null;
    }
    await chrome.storage.local.remove(STORAGE_KEY);
    return c;
  }

  function findInput() {
    for (const sel of SELECTORS[DEST_FOR_HOST]) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  async function waitForInput(timeoutMs = 12000) {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const el = findInput();
        if (el) return resolve(el);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  function setInputValue(el, text) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.focus();
      return;
    }
    // contenteditable path
    el.focus();
    el.innerHTML = "";
    const lines = text.split("\n");
    const frag = document.createDocumentFragment();
    lines.forEach((line, i) => {
      if (i > 0) frag.appendChild(document.createElement("br"));
      if (line) frag.appendChild(document.createTextNode(line));
    });
    el.appendChild(frag);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  function injectToast(msg) {
    const t = document.createElement("div");
    t.id = "wiredge-injector-toast";
    t.textContent = msg;
    t.style.cssText = `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: rgba(10,10,12,0.96); color: #ededf0;
      border: 1px solid rgba(99,102,241,0.55);
      box-shadow: 0 12px 40px -8px rgba(99,102,241,0.4);
      padding: 10px 16px; border-radius: 8px;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      font-size: 13px; z-index: 2147483647; letter-spacing: -0.01em;
      opacity: 0; transition: opacity .25s ease, transform .25s ease;
      transform: translate(-50%, 12px);
    `;
    document.body.appendChild(t);
    requestAnimationFrame(() => {
      t.style.opacity = "1";
      t.style.transform = "translate(-50%, 0)";
    });
    setTimeout(() => {
      t.style.opacity = "0";
      t.style.transform = "translate(-50%, 12px)";
      setTimeout(() => t.remove(), 350);
    }, 4500);
  }

  async function run() {
    const pending = await takePending();
    if (!pending) return;
    const input = await waitForInput();
    if (!input) {
      injectToast("Wiredge: couldn't find the chat input. The text is still on your clipboard — paste with Ctrl+V.");
      return;
    }
    setInputValue(input, pending.text);
    injectToast(`Loaded ${pending.turnCount} turns from Claude · review then press Enter`);
  }

  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
})();

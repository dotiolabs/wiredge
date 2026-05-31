// Wiredge popup — by dotiolabs

const $ = (id) => document.getElementById(id);
const bind = (key) => document.querySelector('[data-bind="' + key + '"]');

// ── Friendly error mapper ──
// Maps raw Chrome/API errors to clear user messages with fixes.
function friendlyError(raw) {
  const m = (raw || '').toLowerCase();
  if (m.includes('extension context invalidated') || m.includes('context invalidated'))
    return 'Extension was reloaded. Fix: Close and re-open this popup.';
  if (m.includes('could not establish connection') || m.includes('receiving end does not exist'))
    return 'Cannot reach the page. Fix: Refresh the AI chat tab (F5), then try again.';
  if (m.includes('disconnected') || m.includes('port closed'))
    return 'Connection lost. Fix: Refresh the page (F5) and re-open Wiredge.';
  if (m.includes('no response') || m.includes('message channel closed'))
    return 'Background not responding. Fix: Reload Wiredge in chrome://extensions, then refresh.';
  if (m.includes('network') || m.includes('failed to fetch') || m.includes('networkerror'))
    return 'Network error. Fix: Check your internet connection and try again.';
  if (m.includes('429') || m.includes('rate limit') || m.includes('too many'))
    return 'Rate limited. Fix: Wait 30 seconds and try again.';
  if (m.includes('503') || m.includes('overloaded') || m.includes('unavailable'))
    return 'AI service is busy. Fix: Wait a minute and try again.';
  if (m.includes('401') || m.includes('unauthorized') || m.includes('invalid api'))
    return 'Invalid API key. Fix: Go to Settings and enter a valid Groq API key.';
  if (m.includes('403') || m.includes('forbidden'))
    return 'Access denied. Fix: Check your API key permissions in Settings.';
  if (m.includes('quota') || m.includes('exceeded'))
    return 'API quota exceeded. Fix: Wait for quota reset, or upgrade your plan.';
  if (m.includes('timeout') || m.includes('timed out'))
    return 'Request timed out. Fix: Check your connection and try again.';
  if (m.includes('not found') || m.includes('404'))
    return 'Service not found. Fix: Check for Wiredge updates.';
  if (m.includes('no api key') || m.includes('no key'))
    return 'No API key. Wiredge works free without one. For better results, add a Groq key in Settings.';
  if (m.includes('cannot read') || m.includes('undefined') || m.includes('null'))
    return 'Something went wrong. Fix: Refresh the page (F5) and try again.';
  return raw + ' \u2014 Try refreshing the page (F5).';
}

// ═══════════════════════════════════════════════════════════════
// ─── TAB SWITCHING ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const TAB_MAP = { compress: 'tabCompress', switch: 'tabSwitch', claude: 'tabClaude' };
    const tabId = TAB_MAP[btn.dataset.tab] || 'tabCompress';
    $(tabId).classList.add('active');
    if (btn.dataset.tab === 'claude') {
      loadUsage();
      initActiveChat();
      renderQuotaMeter();
    }
    if (btn.dataset.tab === 'switch') {
      initSwitchTab();
    }
  });
});


// ═══════════════════════════════════════════════════════════════
// ─── SECTION 1: UI COMPRESSION (existing logic) ──────────────
// ═══════════════════════════════════════════════════════════════

const SAMPLES = {
  saas:      "A modern SaaS landing page with a sticky dark navbar with logo and 4 nav links plus a CTA button, a full hero section with bold headline, subheadline, and two CTA buttons, a 3-column feature grid with icons, a stats row showing 3 key metrics, a pricing section with Free/Pro/Enterprise tiers, and a footer with links.",
  dashboard: "An admin dashboard with a left sidebar navigation with 5 links (Dashboard, Analytics, Users, Settings, Billing), a stats row showing 4 KPI metric cards, a large data table with 5 columns and 6 rows, and a tabbed section at the bottom with 3 tabs.",
  contact:   "A simple contact page with a navbar, a brief hero section, a contact form with name, email, company, and message fields with a submit button, and a minimal footer."
};

const RULES = {
  MIN_CHARS:    25,
  MAX_CHARS:    2000,
  MIN_WORDS:    4,
  COOLDOWN_MS:  8000,
};

const UI_KEYWORDS = [
  'page','section','nav','button','hero','form','grid','card','header','footer',
  'sidebar','table','tab','banner','menu','link','cta','image','text','layout',
  'column','row','feature','pricing','contact','dashboard','landing','login',
  'signup','profile','search','list','modal','icon','logo','app','site','ui',
  'design','block','component','widget'
];

let lastRequestTime = 0;

function validateInput(text) {
  const t    = text.trim();
  const len  = t.length;
  const words = t.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const isSpam = /(.)\\1{9,}/.test(text) || /^[^a-zA-Z]+$/.test(t);
  const hasUrlOrCode = /https?:\/\/|www\.|<[a-z]+>|\{|\}|=>|function\s*\(|import\s+/.test(text);
  const hasSensitive = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b|\b\d{10,}\b/.test(text);
  const cdLeft = Math.max(0, RULES.COOLDOWN_MS - (Date.now() - lastRequestTime));

  return {
    ok: len >= RULES.MIN_CHARS && len <= RULES.MAX_CHARS &&
        words.length >= RULES.MIN_WORDS && !isSpam &&
        !hasUrlOrCode && !hasSensitive && cdLeft === 0,
    cdLeft,
    reason: len < RULES.MIN_CHARS        ? 'Add a bit more detail (' + (RULES.MIN_CHARS - len) + ' chars)' :
            len > RULES.MAX_CHARS        ? 'Too long \u2014 keep it under 2000 chars' :
            words.length < RULES.MIN_WORDS ? 'Too few words \u2014 add more detail' :
            isSpam                       ? 'Invalid input detected' :
            hasUrlOrCode                 ? 'Remove code or URLs from the description' :
            hasSensitive                 ? 'Remove email addresses or phone numbers' :
            cdLeft > 0                   ? 'Wait ' + Math.ceil(cdLeft / 1000) + 's before next request' : '',
  };
}

const est = t => Math.max(1, Math.ceil((t || '').replace(/\s+/g, ' ').length / 4));

function buildPrompt(dsl, fw) {
  return `You are an expert ${fw} developer. Build a production-ready, fully responsive UI from this DSL layout spec.\n\n\`\`\`\n${dsl}\n\`\`\`\n\nREQUIREMENTS:\n- Framework: ${fw}\n- Styling: Tailwind CSS (mobile-first, responsive)\n- Hover states, focus states, smooth transitions\n- Semantic HTML, accessible, modular components\n- Replace placeholder text with realistic content\n- Subtle animations where appropriate\n\nOutput clean, well-commented ${fw} code. Begin immediately.`;
}

let currentDSL = '';

document.addEventListener('DOMContentLoaded', () => {
  const inputEl     = $('inputText');
  const compressBtn = $('compressBtn');
  const ctaText     = $('ctaText');
  const ctaIcon     = $('ctaIcon');
  const errMsg      = $('errMsg');
  const outputZone  = $('outputZone');
  const outputBox   = $('outputBox');
  const outputSavings = $('outputSavings');
  const exportBtn   = $('exportBtn');
  const fwSelect    = $('frameworkSelect');
  const settingsBtn = $('settingsBtn');

  // ── Settings link
  settingsBtn.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  });

  // ── Validate on input
  inputEl.addEventListener('input', () => {
    const { ok } = validateInput(inputEl.value);
    compressBtn.disabled = !ok;
  });

  // ── Cooldown ticker
  setInterval(() => {
    if (Date.now() - lastRequestTime < RULES.COOLDOWN_MS) {
      const { ok } = validateInput(inputEl.value);
      compressBtn.disabled = !ok;
    }
  }, 1000);

  // ── Quick fills
  document.querySelectorAll('.qf').forEach(btn => {
    btn.addEventListener('click', () => {
      inputEl.value = SAMPLES[btn.dataset.sample];
      const { ok } = validateInput(inputEl.value);
      compressBtn.disabled = !ok;
      errMsg.style.display = 'none';
      inputEl.focus();
    });
  });

  // ── Generate
  compressBtn.addEventListener('click', async () => {
    const prompt = inputEl.value.trim();
    const v = validateInput(prompt);
    if (!v.ok) {
      showError(v.reason || 'Please add more detail to your description.');
      return;
    }

    lastRequestTime = Date.now();
    compressBtn.disabled = true;
    ctaText.textContent  = 'Generating…';
    ctaIcon.innerHTML    = spinnerSVG();
    errMsg.style.display = 'none';

    outputZone.style.display  = 'flex';
    outputBox.innerHTML = shimmerHTML() + `<button class="copy-icon-btn" id="copyBtn" title="Copy to clipboard"><span id="copyIcon">${copySVG()}</span></button>`;

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'compress', prompt }, res => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!res) return reject(new Error('No response from background.'));
          resolve(res);
        });
      });

      if (!response.success) throw new Error(response.error || 'Generation failed.');

      const dsl = response.data.trim();
      if (!dsl) throw new Error('Empty result — try a more specific description.');

      currentDSL = dsl;

      const rawTok = est(prompt);
      const dslTok = est(dsl);
      const saved  = rawTok > 5 && dslTok > 0 ? Math.max(0, Math.round((1 - dslTok / rawTok) * 100)) : 0;

      outputBox.innerHTML = `<pre id="outputText">${escapeHtml(dsl)}</pre>
        <button class="copy-icon-btn" id="copyBtn" title="Copy to clipboard"><span id="copyIcon">${copySVG()}</span></button>`;

      outputSavings.textContent = saved > 0 ? `↓ ${saved}% tokens` : '';

      bindCopyBtn();
      bindExportBtn();

    } catch (e) {
      outputZone.style.display = 'none';
      showError(friendlyError(e.message));
    } finally {
      compressBtn.disabled = false;
      ctaText.textContent  = 'Generate DSL';
      ctaIcon.innerHTML    = boltSVG();
    }
  });

  // ── Export
  exportBtn && exportBtn.addEventListener('click', () => copyExport());

  // ── Initial state
  compressBtn.disabled = true;

  // ─── Helpers
  function showError(msg) {
    errMsg.textContent   = msg;
    errMsg.style.display = 'block';
  }

  function bindCopyBtn() {
    const btn = $('copyBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(currentDSL).then(() => {
        btn.classList.add('copied');
        $('copyIcon').innerHTML = checkSVG();
        setTimeout(() => {
          btn.classList.remove('copied');
          $('copyIcon').innerHTML = copySVG();
        }, 2000);
      });
    });
  }

  function bindExportBtn() {
    const btn = $('exportBtn');
    if (!btn) return;
    btn.addEventListener('click', () => copyExport());
  }

  function copyExport() {
    if (!currentDSL) return;
    navigator.clipboard.writeText(buildPrompt(currentDSL, fwSelect.value)).then(() => {
      const btn = $('exportBtn');
      if (!btn) return;
      btn.textContent = '✓ Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy Prompt';
        btn.classList.remove('copied');
      }, 2000);
    });
  }

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function shimmerHTML() {
    return `<div style="padding:2px 0">
      <div class="loading-line" style="width:90%"></div>
      <div class="loading-line" style="width:75%"></div>
      <div class="loading-line" style="width:82%"></div>
      <div class="loading-line"></div>
    </div>`;
  }

  function spinnerSVG() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="animation:spin .7s linear infinite">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>`;
  }

  function boltSVG() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
  }

  function copySVG() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  }

  function checkSVG() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  }


  // ═══════════════════════════════════════════════════════════════
  // ─── SECTION 2: CLAUDE USAGE TRACKER ──────────────────────────
  // ═══════════════════════════════════════════════════════════════

  const DEST_URLS = {
    chatgpt: "https://chatgpt.com/",
    gemini: "https://gemini.google.com/app",
    grok: "https://grok.com/",
  };
  const DEST_NAME = { chatgpt: "ChatGPT", gemini: "Gemini", grok: "Grok" };
  const PENDING_KEY = "wiredge:pendingCapsule";

  // ── Usage helpers
  function fmtUntil(iso) {
    if (!iso) return "—";
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return "resetting…";
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    if (h >= 24) {
      const d = new Date(iso);
      const day = d.toLocaleDateString(undefined, { weekday: "short" });
      const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      return `Resets ${day} ${time}`;
    }
    return `Resets in ${h}h ${m % 60}m`;
  }

  function fmtUpdated(ts) {
    if (!ts) return "—";
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return `updated ${s}s ago`;
    return `updated ${Math.round(s / 60)}m ago`;
  }

  function applyBar(el, pct) {
    el.style.width = `${Math.min(100, pct)}%`;
    el.classList.toggle("warn", pct >= 70 && pct < 90);
    el.classList.toggle("over", pct >= 90);
  }

  // ── Usage rendering
  function renderRow(prefix, win, estimate) {
    if (!win) return false;
    bind(`${prefix}Pct`).textContent = `${win.pct}%`;
    let sub = fmtUntil(win.resetsAt);
    if (estimate && estimate.msgs > 0) {
      const label = Number.isInteger(estimate.msgs) ? estimate.msgs : estimate.msgs.toFixed(1);
      const m = estimate.model ? ` ${estimate.model.toLowerCase()}` : "";
      sub += ` · ≈${label}${m} msgs left`;
    } else if (prefix === "session" && estimate === null) {
      sub += " · estimating…";
    }
    bind(`${prefix}Reset`).textContent = sub;
    applyBar(bind(`${prefix}Bar`), win.pct);
    return true;
  }

  function renderUsage(state) {
    $("errorState").hidden = true;
    $("sessionSection").hidden = true;
    $("weeklySection").hidden = true;

    if (!state || state.error) {
      $("errorState").hidden = false;
      const es = $("errorState");
      es.textContent = "";
      
      if (state?.error === "no-tab" || !state) {
        const a = document.createElement("a");
        a.href = "https://claude.ai"; a.target = "_blank"; a.textContent = "claude.ai";
        es.append("Open ", a, " in a tab so Wiredge can read your usage.");
      } else if (state.error === "no-org") {
        const a = document.createElement("a");
        a.href = "https://claude.ai"; a.target = "_blank"; a.textContent = "Sign in to claude.ai";
        es.append("No Claude org found. ", a, " first.");
      } else {
        const a = document.createElement("a");
        a.href = "https://claude.ai"; a.target = "_blank"; a.textContent = "Open claude.ai \u2192";
        es.append("Couldn't reach claude.ai \u2014 make sure you're signed in. ", a);
      }
      return;
    }

    $("org").textContent = state.orgName ? `/ ${state.orgName}` : "";
    $("planTag").textContent = state.plan ?? "";

    if (renderRow("session", state.fiveHour, state.estimate ?? null)) $("sessionSection").hidden = false;

    let weeklyShown = false;
    if (renderRow("weekly", state.sevenDay)) weeklyShown = true;
    $("rowSonnet").hidden = !renderRow("sonnet", state.sevenDaySonnet);
    $("rowOpus").hidden = !renderRow("opus", state.sevenDayOpus);
    if (weeklyShown) $("weeklySection").hidden = false;

    $("updated").textContent = fmtUpdated(state.updatedAt);
  }

  async function loadUsage() {
    const state = await chrome.runtime.sendMessage({ type: "wiredge:get" });
    renderUsage(state);
    if (!state || state.error === "no-tab" || (state.updatedAt && Date.now() - state.updatedAt > 60000)) {
      chrome.runtime.sendMessage({ type: "wiredge:refresh" });
    }
  }

  $("refreshUsage").addEventListener("click", async () => {
    $("refreshUsage").textContent = "…";
    await chrome.runtime.sendMessage({ type: "wiredge:refresh" });
    setTimeout(loadUsage, 700);
    setTimeout(() => ($("refreshUsage").textContent = "↻"), 700);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "wiredge:update") renderUsage(msg.state);
  });

  let lastUsageState = null;
  const _renderUsage = renderUsage;
  renderUsage = (s) => { lastUsageState = s; _renderUsage(s); };
  setInterval(() => { if (lastUsageState) _renderUsage(lastUsageState); }, 1000);

  // ── Capsule
  let activeChat = null;
  let cachedCapsule = null;

  async function detectActiveChat() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.url) return null;
    const m = tab.url.match(/https:\/\/claude\.ai\/chat\/([0-9a-f-]+)/);
    if (!m) return null;
    return { tabId: tab.id, convId: m[1] };
  }

  function showToast(text, isErr = false) {
    const el = $("capsuleToast");
    el.textContent = text;
    el.classList.toggle("err", isErr);
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 3500);
  }

  async function extractActiveChat() {
    if (cachedCapsule) return cachedCapsule;
    if (!activeChat) throw new Error("No Claude chat open in the active tab");
    const res = await chrome.tabs.sendMessage(activeChat.tabId, {
      type: "capsule:extract",
      convId: activeChat.convId,
    });
    if (!res?.ok) throw new Error(res?.error || "Couldn't read this chat");
    cachedCapsule = res;
    return res;
  }

  async function handoffTo(dest, capsule) {
    const text =
      capsule.markdown || capsule.markdownMd || capsule.fullMd || capsule.full || capsule.compact || capsule.compactMd || "";
    await chrome.storage.local.set({
      [PENDING_KEY]: {
        dest,
        text,
        title: capsule.title,
        turnCount: capsule.turnCount ?? capsule.turns,
        ts: Date.now(),
      },
    });
    chrome.tabs.create({ url: DEST_URLS[dest] });
  }

  async function handleActiveChatAction(dest, btn) {
    const isPaidAction = dest === "chatgpt" || dest === "gemini" || dest === "grok";
    if (isPaidAction && window.wiredgeBilling) {
      const check = await window.wiredgeBilling.consumeOneSend();
      if (!check.allowed) {
        revealUpsell();
        return;
      }
    }

    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = `<span class="cap-icon">…</span>`;
    try {
      const capsule = await extractActiveChat();
      const md = capsule.markdown || capsule.full || "";
      if (dest === "download") {
        const blob = new Blob([md], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const safe = capsule.title.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 60) || "claude-chat";
        const a = document.createElement("a");
        a.href = url; a.download = `${safe}.capsule.md`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        const artNote = capsule.artefactCount ? ` (incl. ${capsule.artefactCount} artefact${capsule.artefactCount === 1 ? "" : "s"})` : "";
        showToast(`Saved ${capsule.turnCount} turns as ${a.download}${artNote}`);
      } else if (dest === "copy") {
        await navigator.clipboard.writeText(md);
        const artNote = capsule.artefactCount ? ` + ${capsule.artefactCount} artefact${capsule.artefactCount === 1 ? "" : "s"}` : "";
        showToast(`Copied ${capsule.turnCount} turns${artNote} to clipboard`);
      } else if (DEST_URLS[dest]) {
        await handoffTo(dest, capsule);
        showToast(`Opening ${DEST_NAME[dest]} — will auto-paste on load`);
      }
    } catch (e) {
      showToast(friendlyError(e.message), true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
    if (isPaidAction) renderQuotaMeter();
  }

  // ── Quota / upsell
  async function renderQuotaMeter() {
    if (!window.wiredgeBilling) return;
    const tb = window.wiredgeBilling;
    const info = await tb.getPlanInfo();
    const box = $("quotaBox");
    const text = $("quotaText");
    const upgrade = $("quotaUpgrade");
    if (!box) return;
    box.hidden = false;

    if (info.plan === "pro" && info.source === "license") {
      text.textContent = "✓ pro · unlimited";
      text.className = "quota-text pro";
      upgrade.classList.add("hidden");
      $("upsell").hidden = true;
      return;
    }

    if (info.plan === "pro" && info.source === "trial") {
      text.textContent = `✓ trial · ${tb.fmtTrialRemaining(info.remainingMs)} left · unlimited`;
      text.className = "quota-text trial";
      upgrade.textContent = "Upgrade →";
      upgrade.classList.remove("hidden");
      $("upsell").hidden = true;
      return;
    }

    const status = await tb.checkCanSend();
    const used = status.limit - (status.remaining ?? 0);
    text.textContent = `${used} of ${status.limit} sends used today`;
    text.className = "quota-text" +
      (status.remaining === 0 ? " over" : status.remaining === 1 ? " warn" : "");
    upgrade.textContent = "Upgrade →";
    upgrade.classList.remove("hidden");
    if (status.remaining === 0) await revealUpsell();
  }

  async function revealUpsell() {
    const tb = window.wiredgeBilling;
    $("upsell").hidden = false;
    $("licenseForm").hidden = true;
    const trialBtn = $("startTrialBtn");
    if (trialBtn && tb) {
      const available = await tb.trialAvailable();
      trialBtn.hidden = !available;
    }
  }

  document.addEventListener("click", async (e) => {
    if (!window.wiredgeBilling) return;
    const tb = window.wiredgeBilling;
    if (e.target.matches("#quotaUpgrade")) {
      e.preventDefault();
      await revealUpsell();
    } else if (e.target.matches("#buyProBtn")) {
      e.preventDefault();
      tb.openCheckout();
    } else if (e.target.matches("#startTrialBtn")) {
      e.preventDefault();
      await handleStartTrial();
    } else if (e.target.matches("#haveKey")) {
      $("upsell").hidden = true;
      $("licenseForm").hidden = false;
      setTimeout(() => $("licenseInput")?.focus(), 50);
    } else if (e.target.matches("#cancelKey")) {
      $("licenseForm").hidden = true;
      renderQuotaMeter();
    } else if (e.target.matches("#activateKey")) {
      handleActivate();
    } else if (e.target.matches("#reviewLink")) {
      e.preventDefault();
      window.wiredgeBilling?.startReviewTrial().then((r) => {
        if (!r.ok) {
          switchToast(r.message, "err");
        } else {
          renderQuotaMeter();
        }
      });
      tb.openReviewPage();
    } else if (e.target.matches("#helpLink")) {
      e.preventDefault();
      chrome.tabs.create({ url: "https://wiredge.vercel.app" });
    }
  });

  async function handleStartTrial() {
    const tb = window.wiredgeBilling;
    const btn = $("startTrialBtn");
    btn.disabled = true;
    btn.textContent = "Opening review tab…";
    try {
      const r = await tb.startReviewTrial();
      if (r.ok) {
        $("upsell").hidden = true;
        await renderQuotaMeter();
        showToast("✓ 3-day trial active. Thanks for the review!");
      } else {
        btn.disabled = false;
        btn.textContent = "Leave a review · 3 days free →";
        showToast(r.message || "Couldn't start trial.", true);
      }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Leave a review · 3 days free →";
    }
  }

  async function handleActivate() {
    const input = $("licenseInput");
    const status = $("licenseStatus");
    const key = input.value.trim();
    if (!key) {
      status.hidden = false;
      status.className = "license-status err";
      status.textContent = "Paste your key first.";
      return;
    }
    status.hidden = false;
    status.className = "license-status";
    status.textContent = "Activating with Polar…";
    const result = await window.wiredgeBilling.activateLicense(key);
    if (result.ok) {
      status.textContent = "✓ Activated. Pro unlocked.";
      setTimeout(() => {
        $("licenseForm").hidden = true;
        $("upsell").hidden = true;
        renderQuotaMeter();
      }, 900);
    } else {
      status.className = "license-status err";
      status.textContent = result.message || "Couldn't activate.";
    }
  }

  async function initActiveChat() {
    activeChat = await detectActiveChat();
    if (!activeChat) return;
    $("capsuleSection").hidden = false;
    $("capsuleTitle").textContent = "Loading…";
    try {
      const capsule = await extractActiveChat();
      $("capsuleTitle").textContent = capsule.title;
      const meta = document.querySelector(".capsule-meta");
      let turnsEl = meta.querySelector(".capsule-turns");
      if (!turnsEl) {
        turnsEl = document.createElement("span");
        turnsEl.className = "capsule-turns mono";
        meta.appendChild(turnsEl);
      }
      turnsEl.textContent = ` · ${capsule.turnCount} turns`;
    } catch (e) {
      $("capsuleTitle").textContent = "(can't read this chat)";
      showToast(friendlyError(e.message), true);
    }
    document.querySelectorAll("#capsuleSection .cap-btn").forEach((btn) => {
      btn.addEventListener("click", () => handleActiveChatAction(btn.dataset.dest, btn));
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ─── SECTION 3: SWITCH AI TAB ─────────────────────────────────
  // ═══════════════════════════════════════════════════════════════

  const SWITCH_URLS = {
    claude: "https://claude.ai",
    chatgpt: "https://chatgpt.com",
    gemini: "https://gemini.google.com/app",
    grok: "https://grok.com",
  };
  const SWITCH_NAMES = {
    claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini", grok: "Grok",
  };
  const PENDING_KEY_SW = "wiredge:pendingCapsule";

  let switchCapturedData = null;
  let currentSite = null;

  function switchToast(text, type) {
    const el = $("switchToast");
    if (!el) return;
    el.textContent = text;
    el.className = "switch-toast" + (type === "err" ? " err" : type === "ok" ? " ok" : "");
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 4000);
  }

  async function initSwitchTab() {
    switchCapturedData = null;
    currentSite = null;

    const dot = $("captureDot");
    const label = $("captureLabel");
    const titleEl = $("captureTitle");
    const metaEl = $("captureMeta");

    dot.className = "switch-capture-dot";
    label.textContent = "Detecting active AI tab...";
    titleEl.hidden = true;
    metaEl.hidden = true;

    // Detect which AI sites have open tabs
    const detection = await chrome.runtime.sendMessage({ type: "wiredge:detect-sites" });
    const openSites = detection?.sites || {};

    // Update model cards with status
    document.querySelectorAll(".model-card").forEach(card => {
      const model = card.dataset.model;
      const statusEl = card.querySelector(".model-status");
      card.classList.remove("current");
      if (openSites[model]) {
        statusEl.textContent = "open";
        statusEl.className = "model-status open";
      } else {
        statusEl.textContent = "";
        statusEl.className = "model-status";
      }
    });

    // Try to capture from active tab
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.url) {
        const host = new URL(activeTab.url).host;
        const siteMatch =
          host.includes("claude.ai") ? "claude" :
          host.includes("chatgpt.com") || host.includes("openai.com") ? "chatgpt" :
          host.includes("gemini.google.com") ? "gemini" :
          host.includes("grok.com") || host.includes("x.ai") ? "grok" : null;

        if (siteMatch) {
          currentSite = siteMatch;
          // Mark as current
          const currentCard = document.querySelector('.model-card[data-model="' + siteMatch + '"]');
          if (currentCard) currentCard.classList.add("current");

          dot.classList.add("active");
          label.textContent = "Connected to " + SWITCH_NAMES[siteMatch];

          // Try to capture context
          const res = await chrome.tabs.sendMessage(activeTab.id, { type: "wiredge:capture" });
          if (res?.ok) {
            switchCapturedData = res;
            titleEl.textContent = res.title || "Active conversation";
            titleEl.hidden = false;
            metaEl.textContent = res.turnCount + " turns captured";
            metaEl.hidden = false;
          } else {
            metaEl.textContent = "Start chatting to capture context";
            metaEl.hidden = false;
          }
        } else {
          dot.className = "switch-capture-dot";
          label.textContent = "Open any AI chat to capture context";
        }
      }
    } catch {
      dot.className = "switch-capture-dot";
      label.textContent = "Open any AI chat to capture context";
    }
  }

  // Model card clicks
  document.querySelectorAll(".model-card").forEach(card => {
    card.addEventListener("click", async () => {
      const model = card.dataset.model;
      const url = card.dataset.url;

      // If this is the current site, do nothing
      if (card.classList.contains("current")) return;

      card.disabled = true;
      const origAction = card.querySelector(".model-action");
      const origText = origAction?.innerHTML;
      if (origAction) origAction.innerHTML = '<span class="arrow">...</span> Capturing & opening';

      try {
        // If we don't have captured data yet, try to capture from active tab
        if (!switchCapturedData) {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab) {
            try {
              const res = await chrome.tabs.sendMessage(activeTab.id, { type: "wiredge:capture" });
              if (res?.ok) switchCapturedData = res;
            } catch {}
          }
        }

        if (switchCapturedData?.markdown) {
          // Store for destination-injector to pick up
          await chrome.storage.local.set({
            [PENDING_KEY_SW]: {
              dest: model,
              text: switchCapturedData.markdown,
              title: switchCapturedData.title || "Conversation",
              turnCount: switchCapturedData.turnCount || 0,
              ts: Date.now(),
            },
          });
          chrome.tabs.create({ url });
          switchToast(
            "Opening " + SWITCH_NAMES[model] + " with " + (switchCapturedData.turnCount || 0) + " turns of context",
            "ok"
          );
        } else {
          // No context — just open the site
          chrome.tabs.create({ url });
          switchToast("Opened " + SWITCH_NAMES[model] + " (no conversation to transfer)", "");
        }
      } catch (e) {
        switchToast(friendlyError(e.message), "err");
      } finally {
        card.disabled = false;
        if (origAction && origText) origAction.innerHTML = origText;
      }
    });
  });

  // ── Boot
  // Load compress tab by default (it's already active)
  // Claude usage loads when user clicks the tab
  window.wiredgeBilling?.ensureLicenseFresh().then(renderQuotaMeter).catch(() => {});
});

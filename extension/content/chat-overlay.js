// Wiredge inline bar — injected just below Claude's chat input toolbar row.
// by dotiolabs
(() => {
  const BAR_ID = "wiredge-inline-bar";
  const MODEL_SELECTOR = '[data-testid="model-selector-dropdown"]';
  const TOOLBAR_ROW = ".flex.w-full.items-center";

  let lastState = null;

  function escapeHtml(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fmtCountdown(iso) {
    if (!iso) return "—";
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return "resetting";
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    return `${m}m`;
  }
  function fmtCalendar(iso) {
    if (!iso) return "—";
    const ms = new Date(iso).getTime() - Date.now();
    if (ms < 24 * 3600000) return fmtCountdown(iso);
    const d = new Date(iso);
    const day = d.toLocaleDateString(undefined, { weekday: "short" });
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `${day} ${time}`;
  }

  function buildBar() {
    const el = document.createElement("div");
    el.id = BAR_ID;
    el.className = "wiredge-bar-inline";
    el.innerHTML = `
      <span class="wiredge-bar-label">
        <span class="wiredge-bar-dot"></span>
        <span class="wiredge-bar-name">wiredge</span>
        <span class="wiredge-bar-sep">·</span>
        <span class="wiredge-bar-cap">session</span>
      </span>
      <span class="wiredge-bar-pct serif tab-num" data-bind="pct">—</span>
      <span class="wiredge-bar-track">
        <span class="wiredge-bar-fill" data-bind="fill"></span>
        <span class="wiredge-bar-marker" data-bind="marker"></span>
      </span>
      <span class="wiredge-bar-reset mono" data-bind="reset">—</span>
      <span class="wiredge-bar-week mono" data-bind="week">—</span>
    `;
    return el;
  }

  function render(state) {
    lastState = state;
    const el = document.getElementById(BAR_ID);
    if (!el) return;
    if (!state || state.error) {
      el.classList.add("wiredge-bar-err");
      el.querySelector('[data-bind="pct"]').textContent = "—";
      el.querySelector('[data-bind="reset"]').textContent =
        state?.error === "no-org" ? "sign in to claude.ai" : "couldn't load";
      el.querySelector('[data-bind="week"]').textContent = "";
      return;
    }
    el.classList.remove("wiredge-bar-err");
    const five = state.fiveHour;
    if (five) {
      el.querySelector('[data-bind="pct"]').textContent = `${five.pct}%`;
      const fill = el.querySelector('[data-bind="fill"]');
      const marker = el.querySelector('[data-bind="marker"]');
      fill.style.width = `${Math.min(100, five.pct)}%`;
      marker.style.left = `${Math.min(100, five.pct)}%`;
      const warn = five.pct >= 70 && five.pct < 90;
      const over = five.pct >= 90;
      fill.classList.toggle("warn", warn);
      fill.classList.toggle("over", over);
      marker.classList.toggle("warn", warn);
      marker.classList.toggle("over", over);
      const countdown = fmtCountdown(five.resetsAt);
      const est = state.estimate;
      const resetEl = el.querySelector('[data-bind="reset"]');
      let liveModel = est?.model;
      let liveMsgs = est?.msgs;
      if (window.__wiredgeEstimate && est?.baseUnit != null) {
        liveModel = window.__wiredgeEstimate.getCurrentModel() || est.model;
        liveMsgs = window.__wiredgeEstimate.predict(five.rawPct, est.baseUnit, liveModel);
      }
      if (liveMsgs != null && liveMsgs > 0) {
        const lowConf = (est?.samples ?? 0) < 3;
        const tone = liveMsgs <= 5 ? "over" : liveMsgs <= 20 ? "warn" : "";
        const tilde = lowConf ? "~" : "≈";
        const msgsLabel = Number.isInteger(liveMsgs) ? liveMsgs : liveMsgs.toFixed(1);
        const safeModel = liveModel ? escapeHtml(liveModel).toLowerCase() : "";
        const modelTag = safeModel ? ` <span class="wiredge-bar-modeltag">${safeModel}</span>` : "";
        resetEl.innerHTML =
          `<span class="wiredge-bar-msgs ${tone}">${tilde}${msgsLabel} msgs</span>${modelTag} \u00B7 ${countdown}`;
      } else {
        resetEl.textContent = `resets in ${countdown}`;
      }
    }
    if (state.sevenDay) {
      el.querySelector('[data-bind="week"]').textContent =
        `wk ${state.sevenDay.pct}% · ${fmtCalendar(state.sevenDay.resetsAt)}`;
    } else {
      el.querySelector('[data-bind="week"]').textContent = "";
    }
  }

  function tryMount() {
    if (document.getElementById(BAR_ID)) return true;
    const modelSelector = document.querySelector(MODEL_SELECTOR);
    if (!modelSelector) return false;
    const toolbarRow = modelSelector.closest(TOOLBAR_ROW);
    if (!toolbarRow) return false;
    const bar = buildBar();
    toolbarRow.parentElement.insertBefore(bar, toolbarRow.nextSibling);
    if (lastState) render(lastState);
    else {
      chrome.runtime.sendMessage({ type: "wiredge:get" }, (s) => s && render(s));
    }
    return true;
  }

  let mountObs = null;
  if (!tryMount()) {
    mountObs = new MutationObserver(() => {
      if (tryMount() && mountObs) {
        mountObs.disconnect();
        mountObs = null;
      }
    });
    mountObs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Local re-render every 2s so the countdown + LIVE model tag stay fresh.
  setInterval(() => {
    if (lastState) render(lastState);
  }, 2 * 1000);

  // Instant re-render when the model selector text changes
  window.addEventListener("wiredge:model-changed", () => {
    if (lastState) render(lastState);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "wiredge:update") render(msg.state);
  });
  window.addEventListener("wiredge:state", (e) => render(e.detail));
})();

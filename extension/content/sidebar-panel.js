// Wiredge — injects a usage card into claude.ai's left sidebar.
// by dotiolabs
(() => {
  const CARD_ID = "wiredge-sidebar-card";

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

  function buildCard() {
    const el = document.createElement("div");
    el.id = CARD_ID;
    el.className = "wiredge-card";
    el.innerHTML = `
      <div class="wiredge-card-cap">wiredge · current session</div>
      <div class="wiredge-card-num" data-bind="pct"><span class="wiredge-tab">—</span><span class="unit">%</span></div>
      <div class="wiredge-bar"><div class="wiredge-bar-fill" data-bind="bar"></div></div>
      <div class="wiredge-card-foot">
        <span data-bind="head">—</span>
        <span data-bind="reset">—</span>
      </div>
      <div class="wiredge-card-week">
        <div class="wiredge-card-week-row">
          <span class="wiredge-muted">weekly · all models</span>
          <span><span class="val wiredge-tab" data-bind="weekPct">—</span> <span class="wiredge-muted" data-bind="weekReset"></span></span>
        </div>
      </div>
    `;
    return el;
  }

  function render(state) {
    const card = document.getElementById(CARD_ID);
    if (!card || !state || state.error) return;
    const five = state.fiveHour;
    if (five) {
      const pctContainer = card.querySelector('[data-bind="pct"]');
      pctContainer.textContent = "";
      const valSpan = document.createElement("span");
      valSpan.className = "wiredge-tab";
      valSpan.textContent = five.pct;
      const unitSpan = document.createElement("span");
      unitSpan.className = "unit";
      unitSpan.textContent = "%";
      pctContainer.append(valSpan, unitSpan);
      const bar = card.querySelector('[data-bind="bar"]');
      bar.style.width = `${Math.min(100, five.pct)}%`;
      bar.classList.toggle("warn", five.pct >= 70 && five.pct < 90);
      bar.classList.toggle("over", five.pct >= 90);
      const est = state.estimate;
      let liveModel = est?.model;
      let liveMsgs = est?.msgs;
      if (window.__wiredgeEstimate && est?.baseUnit != null) {
        liveModel = window.__wiredgeEstimate.getCurrentModel() || est.model;
        liveMsgs = window.__wiredgeEstimate.predict(five.rawPct, est.baseUnit, liveModel);
      }
      const head = liveMsgs > 0
        ? `≈${(Number.isInteger(liveMsgs) ? liveMsgs : liveMsgs.toFixed(1))}${liveModel ? " " + liveModel.toLowerCase() : ""} msgs`
        : `${100 - five.pct}% headroom`;
      card.querySelector('[data-bind="head"]').textContent = head;
      card.querySelector('[data-bind="reset"]').textContent = `resets in ${fmtCountdown(five.resetsAt)}`;
    }
    const week = state.sevenDay;
    if (week) {
      card.querySelector('[data-bind="weekPct"]').textContent = `${week.pct}%`;
      card.querySelector('[data-bind="weekReset"]').textContent = `· ${fmtCalendar(week.resetsAt)}`;
    }
  }

  function findSidebar() {
    return (
      document.querySelector('nav[aria-label="Conversations"]') ||
      document.querySelector("nav[aria-label]") ||
      document.querySelector("aside nav") ||
      document.querySelector("nav")
    );
  }

  function tryMount() {
    if (document.getElementById(CARD_ID)) return true;
    const host = findSidebar();
    if (!host) return false;
    const card = buildCard();
    host.parentElement?.insertBefore(card, host) || host.prepend(card);
    chrome.runtime.sendMessage({ type: "wiredge:get" }, render);
    return true;
  }

  const obs = new MutationObserver(() => {
    tryMount();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  tryMount();

  let lastState = null;
  const _render = render;
  render = (s) => { lastState = s; _render(s); };

  // Local re-render every 10s so the countdown ticks
  setInterval(() => { if (lastState) _render(lastState); }, 10 * 1000);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "wiredge:update") render(msg.state);
  });
  window.addEventListener("wiredge:state", (e) => render(e.detail));
})();

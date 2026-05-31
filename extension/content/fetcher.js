// Wiredge fetcher — runs on claude.ai, fetches /api/organizations + /usage
// using the user's session cookies (Origin = https://claude.ai).
// by dotiolabs
//
// Estimate strategy:
//   - Two kinds of fetches:
//       "poll"       — every 30s, refreshes display, does NOT record a delta.
//       "completion" — fired ~7s after Claude finishes a chat completion. THIS
//                      is the only path that records a delta. The longer delay
//                      gives Claude's /usage counter time to fully propagate
//                      (it accrues gradually over ~30s after the message ends).
//   - Filter out deltas <0.8% — those are streaming artefacts from earlier
//     poll-based recordings, not real messages.
//   - Use only the LAST 3 significant deltas (most recent context length).
//   - Normalize by MODEL_WEIGHTS (Opus=5, Sonnet=3, Haiku=1) → base-unit cost.
//   - Publish baseUnit so the renderer multiplies by the LIVE DOM model weight.
//   - Re-render instantly when the model selector changes.
(() => {
  let pollTimer = null;
  let pendingTimer = null;

  const HISTORY_KEY = "wiredge:history";
  const MAX_DELTAS = 20;
  const RECENT_WINDOW = 3;
  const MIN_SIGNIFICANT_DELTA = 0.8; // % — anything smaller = streaming artefact
  const COMPLETION_DELAY_MS = 7000;
  const MODEL_WEIGHTS = { Opus: 5, Sonnet: 3, Haiku: 1 };
  const DEFAULT_MODEL = "Sonnet";

  function getCurrentModel() {
    const el = document.querySelector('[data-testid="model-selector-dropdown"]');
    if (!el) return null;
    const t = (el.textContent || "").toLowerCase();
    if (t.includes("opus")) return "Opus";
    if (t.includes("sonnet")) return "Sonnet";
    if (t.includes("haiku")) return "Haiku";
    return null;
  }

  function normaliseWindow(obj) {
    if (!obj) return null;
    return {
      pct: Math.round(obj.utilization ?? 0),
      rawPct: obj.utilization ?? 0,
      resetsAt: obj.resets_at,
    };
  }

  const HISTORY_VERSION = 2;

  async function readHistory() {
    const r = await chrome.storage.local.get(HISTORY_KEY);
    let h = r[HISTORY_KEY];
    if (!h || h.v !== HISTORY_VERSION) {
      h = { v: HISTORY_VERSION, lastPct: h?.lastPct ?? null, deltas: [] };
      await chrome.storage.local.set({ [HISTORY_KEY]: h });
    }
    return h;
  }

  async function writeHistory(h) {
    h.v = HISTORY_VERSION;
    await chrome.storage.local.set({ [HISTORY_KEY]: h });
  }

  // Record only fires from completion-triggered fetches.
  async function recordDelta(newRawPct, model) {
    if (newRawPct == null) return null;
    let h = await readHistory();
    h.deltas = h.deltas.map((d) =>
      typeof d === "number" ? { d, model: DEFAULT_MODEL, ts: 0 } : d
    );
    if (h.lastPct == null) {
      h.lastPct = newRawPct;
    } else {
      const d = newRawPct - h.lastPct;
      if (d < -0.5) {
        // window reset
        h = { lastPct: newRawPct, deltas: [] };
      } else if (d > 0.001) {
        h.deltas.push({ d, model: model || DEFAULT_MODEL, ts: Date.now() });
        if (h.deltas.length > MAX_DELTAS) h.deltas.shift();
        h.lastPct = newRawPct;
      } else {
        h.lastPct = newRawPct;
      }
    }
    await writeHistory(h);
    return h;
  }

  // Update lastPct (for poll-driven fetches) without ever recording a delta
  async function updateLastPct(newRawPct) {
    if (newRawPct == null) return null;
    const h = await readHistory();
    h.lastPct = newRawPct;
    await writeHistory(h);
    return h;
  }

  function computeBaseUnit(history) {
    if (!history?.deltas?.length) return null;
    const significant = history.deltas.filter((entry) => {
      const d = typeof entry === "number" ? entry : entry.d;
      return d >= MIN_SIGNIFICANT_DELTA;
    });
    if (!significant.length) return null;
    const recent = significant.slice(-RECENT_WINDOW);
    const baseUnits = recent.map((entry) => {
      const d = typeof entry === "number" ? entry : entry.d;
      const m = typeof entry === "number" ? DEFAULT_MODEL : entry.model || DEFAULT_MODEL;
      const w = MODEL_WEIGHTS[m] || MODEL_WEIGHTS[DEFAULT_MODEL];
      return d / w;
    });
    const avg = baseUnits.reduce((a, b) => a + b, 0) / baseUnits.length;
    return avg > 0 ? avg : null;
  }

  function predictMsgsLeft(currentRawPct, baseUnit, currentModel) {
    if (currentRawPct == null || !baseUnit) return null;
    const w = MODEL_WEIGHTS[currentModel || DEFAULT_MODEL] || MODEL_WEIGHTS[DEFAULT_MODEL];
    const predicted = baseUnit * w;
    if (predicted <= 0) return null;
    const remaining = Math.max(0, 100 - currentRawPct);
    const raw = remaining / predicted;
    return raw < 20 ? Math.round(raw * 10) / 10 : Math.round(raw);
  }

  // shouldRecord = true only on completion-triggered fetches.
  async function fetchUsage(shouldRecord) {
    const orgsR = await fetch("/api/organizations", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!orgsR.ok) throw new Error(`orgs ${orgsR.status}`);
    const orgs = await orgsR.json();
    if (!Array.isArray(orgs) || orgs.length === 0) throw new Error("no-org");

    const org = orgs[0];
    const useR = await fetch(`/api/organizations/${org.uuid}/usage`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!useR.ok) throw new Error(`usage ${useR.status}`);
    const u = await useR.json();

    const fiveHour = normaliseWindow(u.five_hour);
    const currentModel = getCurrentModel();
    const history = shouldRecord
      ? await recordDelta(fiveHour?.rawPct, currentModel)
      : await updateLastPct(fiveHour?.rawPct);
    const baseUnit = computeBaseUnit(history);
    const msgs = fiveHour ? predictMsgsLeft(fiveHour.rawPct, baseUnit, currentModel) : null;

    return {
      orgName: org.name,
      plan: u.subscription_tier || u.plan || undefined,
      model: currentModel,
      fiveHour,
      sevenDay: normaliseWindow(u.seven_day),
      sevenDaySonnet: normaliseWindow(u.seven_day_sonnet),
      sevenDayOpus: normaliseWindow(u.seven_day_opus),
      estimate: baseUnit != null
        ? { msgs, model: currentModel, baseUnit, samples: history?.deltas?.length ?? 0 }
        : null,
    };
  }

  async function report(triggerType = "poll") {
    try {
      const shouldRecord = triggerType === "completion";
      const state = await fetchUsage(shouldRecord);
      chrome.runtime.sendMessage({ type: "wiredge:report", state });
      window.dispatchEvent(new CustomEvent("wiredge:state", { detail: { ok: true, ...state } }));
    } catch (e) {
      const errState = { error: e.message };
      chrome.runtime.sendMessage({ type: "wiredge:report", state: errState });
      window.dispatchEvent(new CustomEvent("wiredge:state", { detail: errState }));
    }
  }

  function reportSoonAfterCompletion() {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => report("completion"), COMPLETION_DELAY_MS);
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => report("poll"), 30 * 1000);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPolling();
    else { report("poll"); startPolling(); }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "wiredge:fetch") report("poll");
    if (msg?.type === "wiredge:reset-history") {
      chrome.storage.local.remove(HISTORY_KEY).then(() => report("poll"));
    }
  });

  // Watch model selector text for changes → instant re-render via custom event.
  let lastSelectorText = "";
  setInterval(() => {
    const el = document.querySelector('[data-testid="model-selector-dropdown"]');
    if (!el) return;
    const t = el.textContent || "";
    if (t !== lastSelectorText) {
      lastSelectorText = t;
      window.dispatchEvent(new CustomEvent("wiredge:model-changed", { detail: getCurrentModel() }));
    }
  }, 1000);

  // PerformanceObserver: schedules completion-triggered fetch (records a delta).
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const u = e.name;
        if (
          /\/append_message/.test(u) ||
          /\/completion/.test(u) ||
          /\/chat_conversations\/[^/]+\/(messages|completion)/.test(u) ||
          /\/retry_completion/.test(u)
        ) {
          reportSoonAfterCompletion();
          return;
        }
      }
    });
    po.observe({ type: "resource", buffered: false });
  } catch {}

  // Sibling-script helpers — live model + on-the-fly predict.
  window.__wiredgeEstimate = {
    getCurrentModel,
    MODEL_WEIGHTS,
    DEFAULT_MODEL,
    predict(currentRawPct, baseUnit, model) {
      return predictMsgsLeft(currentRawPct, baseUnit, model);
    },
  };

  setTimeout(() => report("poll"), 1200);
  startPolling();
})();

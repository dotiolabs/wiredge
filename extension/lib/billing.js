// Wiredge billing — free tier, 3-day review trial, Polar.sh license.
// by dotiolabs
//
// Plan resolution (in order):
//   1. Pro license key (paid, validated against Polar, per-device activation)
//   2. Active 3-day review trial (granted when user clicks "Try 3 days free")
//   3. Free tier — 2 cross-LLM sends per day, copy/download unlimited
//
// Storage schema (chrome.storage.local):
//   wiredge:billing = {
//     plan: 'pro' | 'free'
//     license: { key, activationId, validatedAt, customerId? } | null
//     trial: { expiresAt, used: true } | null
//     quota: { date: 'YYYY-MM-DD', count: N }
//   }
//
// Exposes window.wiredgeBilling for popup + onboarding.
(() => {
  const BILLING_KEY = "wiredge:billing";
  const DAILY_FREE_LIMIT = 2;
  const REVALIDATE_MS = 7 * 24 * 3600 * 1000;
  const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

  // ── Polar.sh (production) ─────────────────────────────────
  // Replace these with your own Polar.sh org details when ready.
  const POLAR_ORG_ID = "REPLACE_WITH_YOUR_POLAR_ORG_ID";
  const POLAR_ORG_SLUG = "dotiolabs";
  const POLAR_API_BASE = "https://api.polar.sh";

  // Wiredge Pro checkout link (replace with your actual link)
  const PAYMENT_LINK = "REPLACE_WITH_YOUR_POLAR_PAYMENT_LINK";
  const CUSTOMER_PORTAL_URL = `https://polar.sh/${POLAR_ORG_SLUG}/portal`;
  const POLAR_VALIDATE_URL = `${POLAR_API_BASE}/v1/customer-portal/license-keys/validate`;
  const POLAR_ACTIVATE_URL = `${POLAR_API_BASE}/v1/customer-portal/license-keys/activate`;

  // ── Chrome Web Store review ───────────────────────────────
  const EXTENSION_ID = "REPLACE_WITH_WIREDGE_CHROME_EXTENSION_ID";
  const REVIEW_URL = EXTENSION_ID.startsWith("REPLACE")
    ? "https://wiredge.vercel.app/?review=1"
    : `https://chromewebstore.google.com/detail/wiredge/${EXTENSION_ID}/reviews`;

  // ── Storage ───────────────────────────────────────────────

  async function readState() {
    const r = await chrome.storage.local.get(BILLING_KEY);
    return r[BILLING_KEY] ?? { plan: "free", license: null, trial: null, quota: null };
  }
  async function writeState(s) {
    await chrome.storage.local.set({ [BILLING_KEY]: s });
  }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // ── Plan resolution ───────────────────────────────────────

  function isTrialActive(state) {
    return state?.trial?.expiresAt > Date.now();
  }
  function trialRemainingMs(state) {
    return Math.max(0, (state?.trial?.expiresAt ?? 0) - Date.now());
  }
  function fmtTrialRemaining(ms) {
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (days >= 1) return `${days}d ${hours}h`;
    if (hours >= 1) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }
  function isLicenseValid(state) {
    return state?.plan === "pro" && state?.license && state.license.activationId;
  }

  async function getPlanInfo() {
    const s = await readState();
    if (isLicenseValid(s)) return { plan: "pro", source: "license", license: s.license };
    if (isTrialActive(s)) return {
      plan: "pro",
      source: "trial",
      trial: s.trial,
      remainingMs: trialRemainingMs(s),
    };
    return { plan: "free", source: "free" };
  }

  // ── Quota (daily free-tier counter) ───────────────────────

  async function getQuota() {
    const s = await readState();
    const today = todayKey();
    if (!s.quota || s.quota.date !== today) {
      return { date: today, count: 0, limit: DAILY_FREE_LIMIT, remaining: DAILY_FREE_LIMIT };
    }
    return {
      date: s.quota.date,
      count: s.quota.count,
      limit: DAILY_FREE_LIMIT,
      remaining: Math.max(0, DAILY_FREE_LIMIT - s.quota.count),
    };
  }

  async function checkCanSend() {
    const info = await getPlanInfo();
    if (info.plan === "pro") return { allowed: true, ...info };
    const q = await getQuota();
    return q.remaining > 0
      ? { allowed: true, plan: "free", source: "free", remaining: q.remaining, limit: q.limit }
      : { allowed: false, plan: "free", source: "free", reason: "daily-limit", limit: q.limit };
  }

  async function consumeOneSend() {
    const info = await getPlanInfo();
    if (info.plan === "pro") return { allowed: true, ...info };
    const s = await readState();
    const today = todayKey();
    if (!s.quota || s.quota.date !== today) s.quota = { date: today, count: 0 };
    if (s.quota.count >= DAILY_FREE_LIMIT) {
      return { allowed: false, reason: "daily-limit", limit: DAILY_FREE_LIMIT };
    }
    s.quota.count += 1;
    await writeState(s);
    return {
      allowed: true,
      plan: "free",
      source: "free",
      remaining: DAILY_FREE_LIMIT - s.quota.count,
      limit: DAILY_FREE_LIMIT,
    };
  }

  // ── 3-day review trial ────────────────────────────────────

  async function trialAvailable() {
    const s = await readState();
    return !s.trial?.used;
  }

  async function startReviewTrial() {
    const s = await readState();
    if (s.trial?.used) {
      return { ok: false, message: "You've already used the 3-day trial." };
    }
    const expires = Date.now() + TRIAL_DURATION_MS;
    s.trial = { expiresAt: expires, used: true, startedAt: Date.now() };
    await writeState(s);
    chrome.tabs.create({ url: REVIEW_URL });
    return { ok: true, expiresAt: expires };
  }

  function openReviewPage() {
    chrome.tabs.create({ url: REVIEW_URL });
  }

  // ── Polar activation + validation ─────────────────────────

  function detectDeviceLabel() {
    const ua = navigator.userAgent || "";
    const os = ua.includes("Mac") ? "Mac"
             : ua.includes("Windows") ? "Windows"
             : ua.includes("Linux") ? "Linux"
             : ua.includes("Android") ? "Android"
             : "Unknown";
    const browser = ua.includes("Edg") ? "Edge"
                  : ua.includes("OPR") ? "Opera"
                  : ua.includes("Chrome") ? "Chrome"
                  : "Browser";
    const date = new Date().toISOString().slice(0, 10);
    return `${browser} on ${os} (activated ${date})`;
  }

  async function callPolarViaSW(type, body) {
    try {
      const r = await chrome.runtime.sendMessage({ type, body });
      if (r && typeof r === "object" && ("ok" in r || "data" in r || "error" in r)) return r;
    } catch {}
    return null;
  }

  async function callPolarDirect(url, body) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { _raw: text }; }
      return { ok: r.ok, status: r.status, data };
    } catch (e) {
      return { ok: false, error: e?.message || "network" };
    }
  }

  function interpretActivate(r) {
    if (!r) return { ok: false, message: "No response from Polar." };
    if (r.error && !r.status) {
      const why = r.error.includes("Failed to fetch") || r.error.includes("Load failed")
        ? "CORS / host permission not active — fully toggle the extension OFF then ON in chrome://extensions."
        : `Network: ${r.error}`;
      return { ok: false, message: why };
    }
    if (r.status === 403 || r.status === 422) {
      return {
        ok: false,
        message: `All license activation slots are in use. Two ways to fix:\n• Free a slot at ${CUSTOMER_PORTAL_URL}\n• Or raise the activations limit in your Polar dashboard → Products → Wiredge Pro → License Keys.`,
      };
    }
    if (r.status === 404 || r.status === 400) {
      const detail = r.data?.detail || r.data?.message;
      return { ok: false, message: detail || "Invalid license key for this product." };
    }
    if (!r.ok) {
      return { ok: false, message: r.data?.detail || `Polar returned ${r.status}.` };
    }
    const data = r.data;
    if (data?.id) return { ok: true, activationId: data.id, customerId: data?.license_key?.customer_id ?? null };
    return { ok: false, message: "Unexpected activation response from Polar." };
  }

  async function polarActivate(key) {
    const body = { key, organization_id: POLAR_ORG_ID, label: detectDeviceLabel() };
    let r = await callPolarViaSW("polar:activate", body);
    if (!r) r = await callPolarDirect(POLAR_ACTIVATE_URL, body);
    return interpretActivate(r);
  }

  async function polarValidate(key, activationId) {
    const body = { key, organization_id: POLAR_ORG_ID, activation_id: activationId };
    let r = await callPolarViaSW("polar:validate", body);
    if (!r) r = await callPolarDirect(POLAR_VALIDATE_URL, body);
    if (!r || !r.ok) return { valid: false, error: !!r?.error };
    return { valid: r.data?.status === "granted" };
  }

  async function activateLicense(key) {
    const trimmed = (key || "").trim();
    if (!trimmed) return { ok: false, message: "Paste your key first." };

    const existing = await readState();
    let activationId =
      existing?.license?.key === trimmed && existing?.license?.activationId
        ? existing.license.activationId
        : null;

    if (!activationId) {
      const activation = await polarActivate(trimmed);
      if (!activation.ok) return activation;
      activationId = activation.activationId;
    }

    const validation = await polarValidate(trimmed, activationId);
    if (validation.error) {
      // Network failed during validate, but activation succeeded — accept optimistically
    } else if (!validation.valid) {
      return { ok: false, message: "License is no longer active. Check your Polar portal." };
    }

    const s = await readState();
    s.license = {
      key: trimmed,
      activationId,
      validatedAt: Date.now(),
    };
    s.plan = "pro";
    await writeState(s);
    return { ok: true };
  }

  async function revokeLicense() {
    const s = await readState();
    s.license = null;
    s.plan = "free";
    await writeState(s);
  }

  async function ensureLicenseFresh() {
    const s = await readState();
    if (!s.license) return;
    const age = Date.now() - (s.license.validatedAt ?? 0);
    if (age < REVALIDATE_MS) return;
    const r = await polarValidate(s.license.key, s.license.activationId);
    if (r.error) return;
    if (!r.valid) {
      s.license = null;
      s.plan = "free";
      await writeState(s);
    } else {
      s.license.validatedAt = Date.now();
      await writeState(s);
    }
  }

  function openCheckout() {
    chrome.tabs.create({ url: PAYMENT_LINK });
  }
  function openCustomerPortal() {
    chrome.tabs.create({ url: CUSTOMER_PORTAL_URL });
  }

  async function resetForTesting() {
    await chrome.storage.local.remove(BILLING_KEY);
  }

  window.wiredgeBilling = {
    DAILY_FREE_LIMIT,
    PAYMENT_LINK,
    CUSTOMER_PORTAL_URL,
    REVIEW_URL,

    getPlanInfo,
    getQuota,
    checkCanSend,
    consumeOneSend,

    trialAvailable,
    startReviewTrial,
    fmtTrialRemaining,

    activateLicense,
    revokeLicense,
    ensureLicenseFresh,

    openCheckout,
    openCustomerPortal,
    openReviewPage,
  };
})();

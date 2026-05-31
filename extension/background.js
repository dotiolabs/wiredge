// Wiredge background service worker
// by dotiolabs
//
// Combines:
//   1. Prompt compression engine (local FREE + optional Groq API)
//   2. Claude usage tracker (cache + message broker)
//   3. Capsule library helpers
//   4. Polar.sh API proxy for licensing

// ═══════════════════════════════════════════════════════════════
// ─── SECTION 1: PROMPT COMPRESSION ENGINE ─────────────────────
// ═══════════════════════════════════════════════════════════════

// ── Built-in local compressor (FREE — no API key needed) ─────

const FILLER_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could',
  'should','may','might','shall','can','need','dare','ought',
  'used','am','just','very','really','quite','rather',
  'somewhat','pretty','fairly','simply','merely','basically',
  'actually','essentially','practically','virtually','literally',
  'definitely','certainly','obviously','clearly','surely',
  'probably','possibly','maybe','perhaps','like',
  'also','too','well','much','many','more','most',
  'other','another','some','any','each','every','all',
  'both','few','several','enough','own','same','able',
  'already','although','always','among','because','before',
  'between','however','either','still','upon','within','without',
  'please','kindly','thanks','thank','you','your','my',
  'me','i','we','our','us','he','she','they','them',
  'his','her','their','its',
]);

const PHRASE_MAP = {
  'i want you to':'','i would like you to':'','i need you to':'',
  'can you please':'','could you please':'','would you please':'',
  'please make sure to':'','please make sure that':'',
  'make sure to':'','make sure that':'',
  'i want to':'','i would like to':'','i need to':'',
  'as well as':'+','in addition to':'+','along with':'+',
  'in order to':'to','so that':'to',
  'as soon as possible':'ASAP','for example':'e.g.',
  'for instance':'e.g.','that is':'i.e.','in other words':'i.e.',
  'et cetera':'etc','and so on':'etc','and so forth':'etc',
  'a lot of':'many','lots of':'many','a number of':'several',
  'a variety of':'various','a wide range of':'various',
  'at this point in time':'now','at the present time':'now',
  'at this time':'now','at the moment':'now',
  'due to the fact that':'because','on account of':'because',
  'in the event that':'if','in case of':'if',
  'with regard to':'re:','with respect to':'re:',
  'in regard to':'re:','pertaining to':'re:','relating to':'re:',
  'in terms of':'for','on the basis of':'based on',
  'take into account':'consider','take into consideration':'consider',
  'it is important to note that':'note:','keep in mind that':'note:',
  'it is worth mentioning that':'','as a matter of fact':'',
  'the fact that':'','the thing is':'','you know':'',
  'i think':'','i believe':'','i feel like':'',
  'i guess':'','i suppose':'','kind of':'','sort of':'',
  'each and every':'each','first and foremost':'first',
  'over and over':'repeatedly','by and large':'generally',
  'all in all':'overall',
};

function localCompress(text) {
  let r = text.trim();
  for (const [phrase, rep] of Object.entries(PHRASE_MAP)) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    r = r.replace(re, rep);
  }
  r = r.replace(/\b\w+\b/g, w => FILLER_WORDS.has(w.toLowerCase()) ? '' : w);
  r = r.replace(/[ \t]+/g, ' ').replace(/ ([.,;:!?])/g, '$1')
       .replace(/\n\s*\n\s*\n/g, '\n\n').replace(/^\s+/gm, '').replace(/\s+$/gm, '').trim();
  r = r.split('\n').filter(l => l.trim().length > 1).join('\n');
  return r;
}

// ── Groq API compressor (optional — used when API key is set) ─

async function getApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(['groqApiKey'], result => {
      resolve(result.groqApiKey || null);
    });
  });
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama3-8b-8192', 'mixtral-8x7b-32768'];

const SYSTEM_PROMPT = [
  'You are a Prompt Compression Engine. Shorten the user\'s prompt to convey the same intent with fewer tokens.',
  '',
  'RULES:',
  '- Keep all technical requirements, constraints, and specific details',
  '- Remove filler words, pleasantries, redundant explanations',
  '- Use abbreviations where clear (impl=implement, fn=function, cfg=config)',
  '- Use bullet points instead of paragraphs where possible',
  '- Preserve code snippets, file names, and technical terms exactly',
  '- Output ONLY the compressed prompt, no explanations or meta-commentary',
  '- The compressed prompt must be directly usable as-is by an AI assistant',
].join('\n');

async function groqCompress(prompt) {
  const key = await getApiKey();
  if (!key) return null;
  for (const model of GROQ_MODELS) {
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model, temperature: 0.2, max_tokens: 1024,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt }
          ]
        })
      });
      if (!res.ok) { if ([429, 503, 404].includes(res.status)) continue; return null; }
      const d = await res.json();
      let t = d.choices?.[0]?.message?.content?.trim() || '';
      if (t.startsWith('```')) {
        const l = t.split('\n'); l.shift();
        if (l[l.length - 1]?.startsWith('```')) l.pop();
        t = l.join('\n').trim();
      }
      return t || null;
    } catch { continue; }
  }
  return null;
}

// ── Main handler: Groq if key exists, else local (always works) ──

async function compressPrompt(userPrompt) {
  try {
    const groqResult = await groqCompress(userPrompt);
    if (groqResult && groqResult.length > 10) return groqResult;
  } catch {}
  const localResult = localCompress(userPrompt);
  if (localResult && localResult.length > 5) return localResult;
  throw new Error('Could not compress. Try a longer prompt.');
}


// ═══════════════════════════════════════════════════════════════
// ─── SECTION 2: CLAUDE USAGE TRACKER ──────────────────────────
// ═══════════════════════════════════════════════════════════════

const POLL_MINUTES = 5;
const ALARM = "wiredge-poll";

function updateBadge(pct) {
  if (pct == null) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  chrome.action.setBadgeText({ text: "" + pct });
  const color = pct >= 90 ? "#FF6B6B" : pct >= 70 ? "#FFB547" : "#6366F1";
  chrome.action.setBadgeBackgroundColor({ color });
}

async function getState() {
  const r = await chrome.storage.session.get("wiredgeState");
  return r.wiredgeState ?? null;
}

async function setState(state) {
  await chrome.storage.session.set({ wiredgeState: state });
  updateBadge(state?.fiveHour?.pct);
  chrome.runtime.sendMessage({ type: "wiredge:update", state }).catch(() => {});
}

async function requestRefresh() {
  const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
  if (tabs.length === 0) {
    await setState({ error: "no-tab" });
    return false;
  }
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "wiredge:fetch" });
      return true;
    } catch {}
  }
  return false;
}


// ═══════════════════════════════════════════════════════════════
// ─── SECTION 3: CAPSULE LIBRARY ───────────────────────────────
// ═══════════════════════════════════════════════════════════════

const LIBRARY_KEY = "wiredge:library";
const MAX_LIBRARY = 50;

const LIBRARY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function getLibrary() {
  const r = await chrome.storage.local.get(LIBRARY_KEY);
  let lib = Array.isArray(r[LIBRARY_KEY]) ? r[LIBRARY_KEY] : [];
  
  // Clean up old entries
  const now = Date.now();
  const initialLength = lib.length;
  lib = lib.filter(c => (now - (c.capturedAt || 0)) < LIBRARY_TTL_MS);
  if (lib.length !== initialLength) {
    chrome.storage.local.set({ [LIBRARY_KEY]: lib });
  }
  return lib;
}
async function setLibrary(items) {
  await chrome.storage.local.set({ [LIBRARY_KEY]: items.slice(0, MAX_LIBRARY) });
}

async function saveCapsule(capsule, sourceConvId) {
  const lib = await getLibrary();
  const existingIdx = sourceConvId ? lib.findIndex((c) => c.sourceConvId === sourceConvId) : -1;
  const md = capsule.markdown || capsule.full || capsule.compact || "";
  const entry = {
    id: existingIdx >= 0 ? lib[existingIdx].id : crypto.randomUUID(),
    title: capsule.title || "(untitled)",
    source: "Claude",
    sourceConvId: sourceConvId || null,
    capturedAt: Date.now(),
    turns: capsule.turnCount || 0,
    artefacts: capsule.artefactCount || 0,
    markdownMd: md,
  };
  if (existingIdx >= 0) lib.splice(existingIdx, 1);
  lib.unshift(entry);
  await setLibrary(lib);
  return { entry, libraryCount: lib.length };
}


// ═══════════════════════════════════════════════════════════════
// ─── SECTION 4: EVENT LISTENERS ───────────────────────────────
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(ALARM, { periodInMinutes: POLL_MINUTES });
  requestRefresh();
  getLibrary(); // Trigger cleanup
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/welcome.html") }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: POLL_MINUTES });
  getLibrary(); // Trigger cleanup
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) requestRefresh();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // CRITICAL SECURITY: Only accept messages from our own extension
  if (sender.id !== chrome.runtime.id) return;

  // ── Prompt Compression ──
  if (msg?.action === 'compress') {
    compressPrompt(msg.prompt)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ── Claude Usage Tracker ──
  if (msg?.type === "wiredge:report") {
    setState({ ok: true, ...msg.state, updatedAt: Date.now() }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "wiredge:get") {
    getState().then(sendResponse);
    return true;
  }
  if (msg?.type === "wiredge:refresh") {
    requestRefresh().then((ok) => sendResponse({ ok }));
    return true;
  }

  // ── Universal capture (from any AI tab) ──
  if (msg?.type === "wiredge:capture-active") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) { sendResponse({ ok: false, error: "No active tab" }); return; }
        const res = await chrome.tabs.sendMessage(tab.id, { type: "wiredge:capture" });
        sendResponse(res);
      } catch (e) {
        sendResponse({ ok: false, error: e.message || "Can't reach this page" });
      }
    })();
    return true;
  }

  // ── Check which AI sites are open ──
  if (msg?.type === "wiredge:detect-sites") {
    (async () => {
      const patterns = [
        "https://claude.ai/*",
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://gemini.google.com/*",
        "https://grok.com/*",
        "https://x.ai/*",
      ];
      const sites = {};
      for (const p of patterns) {
        const tabs = await chrome.tabs.query({ url: p });
        if (tabs.length > 0) {
          const name = p.includes("claude") ? "claude"
            : p.includes("chatgpt") || p.includes("openai") ? "chatgpt"
            : p.includes("gemini") ? "gemini"
            : "grok";
          sites[name] = { tabId: tabs[0].id, url: tabs[0].url };
        }
      }
      sendResponse({ ok: true, sites });
    })();
    return true;
  }

  // ── Polar.sh API proxy ──
  if (msg?.type === "polar:activate") {
    (async () => {
      try {
        if (!msg.body?.key || typeof msg.body.key !== 'string') {
          sendResponse({ ok: false, error: "Invalid payload" });
          return;
        }
        const r = await fetch("https://api.polar.sh/v1/customer-portal/license-keys/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(msg.body),
        });
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch { data = { _raw: text }; }
        sendResponse({ ok: r.ok, status: r.status, data });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || "network" });
      }
    })();
    return true;
  }
  if (msg?.type === "polar:validate") {
    (async () => {
      try {
        if (!msg.body?.key || typeof msg.body.key !== 'string') {
          sendResponse({ ok: false, error: "Invalid payload" });
          return;
        }
        const r = await fetch("https://api.polar.sh/v1/customer-portal/license-keys/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(msg.body),
        });
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch { data = { _raw: text }; }
        sendResponse({ ok: r.ok, status: r.status, data });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || "network" });
      }
    })();
    return true;
  }
});

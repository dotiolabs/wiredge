// Wiredge — universal conversation capturer
// Runs on ALL AI chat sites: Claude, ChatGPT, Gemini, Grok
// Scrapes the visible conversation from the DOM and formats it as a handoff prompt
// by dotiolabs
(() => {
  const HOST = location.host;
  const SITE = (() => {
    if (/claude\.ai$/.test(HOST)) return "claude";
    if (/chatgpt\.com$|openai\.com$/.test(HOST)) return "chatgpt";
    if (/gemini\.google\.com$/.test(HOST)) return "gemini";
    if (/grok\.com$|x\.ai$/.test(HOST)) return "grok";
    return null;
  })();
  if (!SITE) return;

  const SITE_NAMES = {
    claude: "Claude",
    chatgpt: "ChatGPT",
    gemini: "Gemini",
    grok: "Grok",
  };

  // ── Per-site DOM selectors for chat messages ────────────────

  const MSG_SELECTORS = {
    claude: {
      container: '[data-testid="conversation-turn-pair"], .font-claude-message, div[data-is-streaming]',
      userMsg: '.font-user-message, [data-testid="user-message"]',
      assistantMsg: '.font-claude-message, [data-testid="ai-message"]',
      allMsgs: 'div[class*="font-"][class*="message"], [data-testid*="message"]',
      turnPairs: '.group\\/turn, [data-testid="conversation-turn-pair"]',
    },
    chatgpt: {
      allMsgs: '[data-message-author-role]',
      userRole: 'user',
      assistantRole: 'assistant',
    },
    gemini: {
      allMsgs: 'message-content, .conversation-container .response-container, .query-content, .model-response-text',
      userMsg: '.query-content, user-query, message-content[data-message-author="user"]',
      assistantMsg: '.model-response-text, model-response, message-content[data-message-author="model"]',
    },
    grok: {
      allMsgs: '[class*="message"], [data-testid*="message"]',
      userMsg: '[class*="user"], [data-testid*="user"]',
      assistantMsg: '[class*="assistant"], [class*="grok"], [data-testid*="assistant"]',
    },
  };

  // ── Generic DOM conversation extraction ─────────────────────

  function extractFromClaude() {
    const turns = [];
    // Try structured extraction first
    const groups = document.querySelectorAll('.group\\/turn, [data-testid="conversation-turn-pair"]');
    if (groups.length > 0) {
      groups.forEach(g => {
        const userEl = g.querySelector('.font-user-message, [data-testid="user-message"]');
        const aiEl = g.querySelector('.font-claude-message, [data-testid="ai-message"]');
        if (userEl) turns.push({ role: "user", text: cleanText(userEl.innerText) });
        if (aiEl) turns.push({ role: "assistant", text: cleanText(aiEl.innerText) });
      });
    }
    // Fallback: grab all message-like divs
    if (turns.length === 0) {
      const allDivs = document.querySelectorAll('[data-testid*="message"], .whitespace-pre-wrap');
      allDivs.forEach(d => {
        const text = cleanText(d.innerText);
        if (text.length < 5) return;
        const isUser = d.closest('.font-user-message, [data-testid="user-message"]') ||
                       d.closest('[data-is-user]');
        turns.push({ role: isUser ? "user" : "assistant", text });
      });
    }
    return dedup(turns);
  }

  function extractFromChatGPT() {
    const turns = [];
    const msgs = document.querySelectorAll('[data-message-author-role]');
    msgs.forEach(m => {
      const role = m.getAttribute('data-message-author-role');
      const textEl = m.querySelector('.markdown, .whitespace-pre-wrap, .text-message');
      const text = cleanText(textEl?.innerText || m.innerText);
      if (text.length > 3) {
        turns.push({ role: role === 'user' ? 'user' : 'assistant', text });
      }
    });
    // Fallback
    if (turns.length === 0) {
      const articles = document.querySelectorAll('article, [data-testid*="conversation-turn"]');
      articles.forEach(a => {
        const text = cleanText(a.innerText);
        if (text.length < 5) return;
        const isUser = a.querySelector('[data-message-author-role="user"]') ||
                       a.classList.contains('user') ||
                       a.textContent?.includes('You said');
        turns.push({ role: isUser ? 'user' : 'assistant', text });
      });
    }
    return dedup(turns);
  }

  function extractFromGemini() {
    const turns = [];
    // Try query/response pairs
    const queries = document.querySelectorAll('.query-content, user-query, [data-query]');
    const responses = document.querySelectorAll('.model-response-text, model-response, [data-response]');
    if (queries.length > 0) {
      const max = Math.max(queries.length, responses.length);
      for (let i = 0; i < max; i++) {
        if (i < queries.length) {
          const text = cleanText(queries[i].innerText);
          if (text.length > 3) turns.push({ role: 'user', text });
        }
        if (i < responses.length) {
          const text = cleanText(responses[i].innerText);
          if (text.length > 3) turns.push({ role: 'assistant', text });
        }
      }
    }
    // Fallback: grab all message-content elements
    if (turns.length === 0) {
      const messages = document.querySelectorAll('message-content, [class*="message"]');
      messages.forEach(m => {
        const text = cleanText(m.innerText);
        if (text.length < 5) return;
        const isUser = m.getAttribute('data-message-author') === 'user' ||
                       m.closest('user-query') || m.closest('.query-content');
        turns.push({ role: isUser ? 'user' : 'assistant', text });
      });
    }
    return dedup(turns);
  }

  function extractFromGrok() {
    const turns = [];
    const messages = document.querySelectorAll('[class*="message"], article, [role="article"]');
    messages.forEach(m => {
      const text = cleanText(m.innerText);
      if (text.length < 5) return;
      const isUser = m.querySelector('[class*="user"]') ||
                     m.classList.toString().includes('user') ||
                     m.getAttribute('data-testid')?.includes('user');
      turns.push({ role: isUser ? 'user' : 'assistant', text });
    });
    return dedup(turns);
  }

  function cleanText(s) {
    if (!s) return "";
    return s
      .replace(/^\s+|\s+$/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\t+/g, ' ');
  }

  function dedup(turns) {
    const seen = new Set();
    return turns.filter(t => {
      const key = t.role + ':' + t.text.slice(0, 100);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Build handoff markdown ──────────────────────────────────

  function buildHandoff(turns, fromSite) {
    const fromName = SITE_NAMES[fromSite] || fromSite;
    const lines = [];
    lines.push(`# Conversation handoff from ${fromName} (via Wiredge)`);
    lines.push("");
    lines.push(`**Turns:** ${turns.length}  ·  **Source:** ${fromName}`);
    lines.push("");
    lines.push("## Briefing");
    lines.push("");
    lines.push("You are continuing a working session that began in " + fromName + ". Read the conversation below and pick up where the previous assistant left off — don't re-introduce yourself, match the user's working style.");
    lines.push("");

    // Include first user message as "Original ask"
    const firstUser = turns.find(t => t.role === "user");
    if (firstUser) {
      const clipped = firstUser.text.length > 500 ? firstUser.text.slice(0, 497) + "…" : firstUser.text;
      lines.push("**Original ask:**");
      lines.push("> " + clipped.replace(/\n/g, "\n> "));
      lines.push("");
    }

    // Last assistant message
    const lastAssistant = [...turns].reverse().find(t => t.role === "assistant");
    if (lastAssistant) {
      const clipped = lastAssistant.text.length > 300 ? lastAssistant.text.slice(0, 297) + "…" : lastAssistant.text;
      lines.push("**Where the previous assistant left off:**");
      lines.push("> " + clipped.replace(/\n/g, "\n> "));
      lines.push("");
    }

    lines.push("---");
    lines.push("");

    // Recent turns (last 8)
    const recent = turns.slice(-8);
    const omitted = turns.length - recent.length;
    if (omitted > 0) {
      lines.push(`## Recent conversation (last ${recent.length} of ${turns.length} turns; ${omitted} earlier omitted)`);
    } else {
      lines.push(`## Conversation (${turns.length} turns)`);
    }
    lines.push("");

    for (const t of recent) {
      const label = t.role === "user" ? "**User:**" : "**Assistant:**";
      lines.push(label);
      lines.push(t.text);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
    lines.push("_Continue from here. The user's next message will follow._");

    return lines.join("\n");
  }

  // ── Get current page title ──────────────────────────────────

  function getPageTitle() {
    // Try to get chat title from page
    const titleEl =
      document.querySelector('title') ||
      document.querySelector('[data-testid="conversation-title"]') ||
      document.querySelector('h1');
    let title = titleEl?.textContent?.trim() || document.title || "";
    // Clean up common prefixes
    title = title.replace(/^(Claude|ChatGPT|Gemini|Grok)\s*[-–—|:]\s*/i, "").trim();
    return title || "(untitled chat)";
  }

  // ── Message handler ─────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "wiredge:capture") return; // do not return true here

    try {
      let turns;
      switch (SITE) {
        case "claude": turns = extractFromClaude(); break;
        case "chatgpt": turns = extractFromChatGPT(); break;
        case "gemini": turns = extractFromGemini(); break;
        case "grok": turns = extractFromGrok(); break;
        default: turns = [];
      }

      if (turns.length === 0) {
        sendResponse({ ok: false, error: "No conversation found on this page. Start chatting first." });
        return;
      }

      const markdown = buildHandoff(turns, SITE);
      const title = getPageTitle();

      sendResponse({
        ok: true,
        site: SITE,
        siteName: SITE_NAMES[SITE],
        title,
        turnCount: turns.length,
        markdown,
      });
    } catch (e) {
      sendResponse({ ok: false, error: e.message || "Failed to capture conversation" });
    }
    // sendResponse called synchronously, so no need to return true
  });

  // Also respond to status checks
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "wiredge:site-status") {
      sendResponse({ ok: true, site: SITE, siteName: SITE_NAMES[SITE], url: location.href });
      // return false to close channel (we respond synchronously)
    }
  });
})();

// Wiredge Capsule — extracts a Claude conversation as portable Markdown.
// Lives in the content-script world so it inherits claude.ai's session cookies.
// by dotiolabs
//
// Output structure (three acts):
//   1. Briefing  — title/date/turns, original ask, where we left off, artefact list
//   2. Artefacts — dedup'd by filename, latest body only, full text in fenced code
//   3. Recent    — last ~6 turns with [Tool: …] breadcrumbs where bodies were lifted
(() => {
  const SOURCE_TAG = "Claude (via Wiredge)";
  const RECENT_TURNS = 6;
  const MAX_ASK_CHARS = 500;
  const MAX_LAST_CHARS = 300;

  // ── HTTP ─────────────────────────────────────────────────

  async function fetchOrgId() {
    const r = await fetch("/api/organizations", { credentials: "include" });
    if (!r.ok) throw new Error(`orgs ${r.status}`);
    const orgs = await r.json();
    if (!Array.isArray(orgs) || !orgs.length) throw new Error("no-org");
    return orgs[0].uuid;
  }

  async function fetchConversation(orgId, convId) {
    const url = `/api/organizations/${orgId}/chat_conversations/${convId}?tree=True&rendering_mode=raw&render_all_tools=true`;
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(`conv ${r.status}`);
    return r.json();
  }

  // ── Tree walk ────────────────────────────────────────────

  function linearise(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    const byId = new Map(messages.map((m) => [m.uuid, m]));
    const childrenOf = new Map();
    for (const m of messages) {
      const p = m.parent_message_uuid;
      if (!p) continue;
      if (!childrenOf.has(p)) childrenOf.set(p, []);
      childrenOf.get(p).push(m);
    }
    const leaves = messages.filter((m) => !childrenOf.has(m.uuid));
    if (!leaves.length) return [...messages].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const leaf = leaves.reduce((a, b) => (new Date(a.created_at) > new Date(b.created_at) ? a : b));
    const chain = [];
    let cur = leaf;
    const seen = new Set();
    while (cur && !seen.has(cur.uuid)) {
      seen.add(cur.uuid);
      chain.push(cur);
      cur = cur.parent_message_uuid ? byId.get(cur.parent_message_uuid) : null;
    }
    return chain.reverse();
  }

  // ── Block-typed content extraction ───────────────────────

  function isArtefactTool(name) {
    return /artifact/i.test(name || "");
  }
  function isFileEditTool(name) {
    return /text_editor|str_replace|edit_file|edit/i.test(name || "");
  }

  function extractBlocks(msg) {
    const blocks = [];

    if (typeof msg.text === "string" && msg.text.trim()) {
      blocks.push({ kind: "text", text: msg.text });
    }
    if (!Array.isArray(msg.content)) return blocks;

    for (const c of msg.content) {
      if (!c?.type) continue;

      if (c.type === "text" && c.text) {
        blocks.push({ kind: "text", text: c.text });
        continue;
      }

      if (c.type === "tool_use") {
        const name = c.name || "(unknown tool)";
        const input = c.input || {};

        if (isArtefactTool(name) && typeof input.content === "string" && input.content.length) {
          blocks.push({
            kind: "artefact",
            id: input.id || c.id || null,
            title: input.title || input.id || "(untitled)",
            mime: input.type || "text/plain",
            command: input.command || "create",
            body: input.content,
          });
          continue;
        }

        if (isFileEditTool(name)) {
          const path = input.path || input.file_path || "(unknown path)";
          const command = input.command || "edit";
          const body = input.file_text || input.new_str || input.content || null;
          if (typeof body === "string" && body.length) {
            blocks.push({ kind: "file", path, command, mime: guessMimeFromPath(path), body });
            continue;
          }
        }

        blocks.push({ kind: "tool-note", name, command: input.command || null });
        continue;
      }

      if (c.type === "knowledge") {
        const text = (c.text || "").trim();
        if (text) {
          blocks.push({
            kind: "knowledge",
            title: c.title || c.metadata?.title || c.url || "(attached)",
            text: text.length > 400 ? text.slice(0, 400) + "…" : text,
          });
        }
        continue;
      }
    }

    return blocks;
  }

  // ── MIME / language helpers ──────────────────────────────

  const MIME_LANG = {
    "text/html": "html",
    "text/css": "css",
    "text/javascript": "javascript",
    "application/javascript": "javascript",
    "text/markdown": "markdown",
    "text/plain": "",
    "application/json": "json",
    "application/vnd.ant.react": "jsx",
    "application/vnd.ant.code": "",
    "application/vnd.ant.mermaid": "mermaid",
    "image/svg+xml": "svg",
  };
  function mimeToLang(mime) {
    if (!mime) return "";
    return MIME_LANG[mime] ?? "";
  }
  const EXT_LANG = {
    html: "html", htm: "html",
    css: "css",
    js: "javascript", mjs: "javascript", cjs: "javascript",
    jsx: "jsx", tsx: "tsx", ts: "typescript",
    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", swift: "swift",
    md: "markdown", json: "json", yml: "yaml", yaml: "yaml",
    sh: "bash", bash: "bash",
    sql: "sql",
  };
  function guessMimeFromPath(path) {
    if (!path) return "text/plain";
    const ext = path.split(".").pop()?.toLowerCase();
    const lang = EXT_LANG[ext];
    if (!lang) return "text/plain";
    if (lang === "html") return "text/html";
    if (lang === "css") return "text/css";
    if (lang === "javascript") return "text/javascript";
    if (lang === "markdown") return "text/markdown";
    if (lang === "json") return "application/json";
    return `text/${lang}`;
  }
  function langFor(block) {
    if (block.kind === "file") {
      const ext = (block.path || "").split(".").pop()?.toLowerCase();
      return EXT_LANG[ext] ?? mimeToLang(block.mime);
    }
    return mimeToLang(block.mime);
  }
  function byteLen(s) {
    return new TextEncoder().encode(s).length;
  }
  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  // ── Artefact collection (dedup by name + kind, keep latest) ──

  function collectArtefacts(chain) {
    const ordered = [];
    const map = new Map();
    for (const m of chain) {
      for (const b of extractBlocks(m)) {
        if (b.kind !== "artefact" && b.kind !== "file") continue;
        const key = b.kind === "artefact" ? `art:${b.title}` : `file:${b.path}`;
        if (!map.has(key)) ordered.push(key);
        map.set(key, b);
      }
    }
    return ordered.map((k) => map.get(k));
  }

  // ── Turn rendering ───────────────────────────────────────

  function turnInlineText(msg, artefactKeys) {
    const parts = [];
    for (const b of extractBlocks(msg)) {
      if (b.kind === "text") parts.push(b.text);
      else if (b.kind === "artefact") parts.push(`_[Tool: artifacts · ${b.command} · \`${b.title}\`]_`);
      else if (b.kind === "file") parts.push(`_[Tool: file ${b.command} · \`${b.path}\`]_`);
      else if (b.kind === "tool-note") parts.push(`_[Tool: ${b.name}${b.command ? " · " + b.command : ""}]_`);
      else if (b.kind === "knowledge") parts.push(`> **Attached:** ${b.title}\n>\n> ${b.text.replace(/\n/g, "\n> ")}`);
    }
    return parts.join("\n\n").trim();
  }

  function firstUserText(chain) {
    const first = chain.find((m) => m.sender === "human");
    if (!first) return "";
    const blocks = extractBlocks(first);
    return blocks.filter((b) => b.kind === "text").map((b) => b.text).join("\n\n").trim();
  }
  function lastAssistantText(chain) {
    for (let i = chain.length - 1; i >= 0; i--) {
      if (chain[i].sender !== "human") {
        const blocks = extractBlocks(chain[i]);
        const txt = blocks.filter((b) => b.kind === "text").map((b) => b.text).join("\n\n").trim();
        if (txt) return txt;
      }
    }
    return "";
  }
  function clip(s, max) {
    if (!s) return "";
    const oneLine = s.replace(/\s+/g, " ").trim();
    return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
  }
  function blockquote(s) {
    return s.split("\n").map((l) => "> " + l).join("\n");
  }

  // ── Main render ──────────────────────────────────────────

  function buildMarkdown(conv) {
    const title = conv?.name?.trim() || "(untitled)";
    const created = conv?.created_at ? new Date(conv.created_at) : null;
    const dateStr = created
      ? created.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
      : "";
    const chain = linearise(conv.chat_messages || []);

    const turnsWithContent = chain
      .map((m) => ({ m, blocks: extractBlocks(m) }))
      .filter((t) => t.blocks.length > 0);
    const N = turnsWithContent.length;

    const artefacts = collectArtefacts(chain);
    const recent = turnsWithContent.slice(-RECENT_TURNS);
    const omitted = N - recent.length;

    const firstAsk = clip(firstUserText(chain), MAX_ASK_CHARS);
    const lastWork = clip(lastAssistantText(chain), MAX_LAST_CHARS);

    const lines = [];
    lines.push(`# Conversation handoff from ${SOURCE_TAG}`);
    lines.push("");
    const metaParts = [`**Title:** ${title}`];
    if (dateStr) metaParts.push(`**Started:** ${dateStr}`);
    metaParts.push(`**Turns:** ${N}`);
    if (artefacts.length) metaParts.push(`**Artefacts:** ${artefacts.length}`);
    lines.push(metaParts.join("  ·  "));
    lines.push("");

    lines.push("## Briefing");
    lines.push("");
    lines.push("You are continuing a working session that began in Claude. Read the briefing, the artefacts, and the recent turns below. Pick up where the previous assistant left off — don't re-introduce yourself, match the user's working style.");
    lines.push("");
    if (firstAsk) {
      lines.push("**Original ask:**");
      lines.push(blockquote(firstAsk));
      lines.push("");
    }
    if (lastWork) {
      lines.push("**Where the previous assistant left off:**");
      lines.push(blockquote(lastWork));
      lines.push("");
    }
    if (artefacts.length) {
      lines.push("**Artefacts produced** (full bodies below):");
      for (const a of artefacts) {
        const name = a.kind === "file" ? a.path : a.title;
        const mime = a.mime || (a.kind === "file" ? guessMimeFromPath(a.path) : "text/plain");
        lines.push(`- \`${name}\` — ${mime}, ${fmtBytes(byteLen(a.body || ""))}`);
      }
      lines.push("");
    }

    if (artefacts.length) {
      lines.push("## Artefacts");
      lines.push("");
      for (const a of artefacts) {
        const name = a.kind === "file" ? a.path : a.title;
        const labelMime = a.mime || (a.kind === "file" ? guessMimeFromPath(a.path) : "text/plain");
        lines.push(`### \`${name}\` (${labelMime}, ${a.command})`);
        lines.push("");
        const lang = langFor(a);
        lines.push("```" + lang);
        lines.push(a.body || "");
        lines.push("```");
        lines.push("");
      }
    }

    lines.push("---");
    lines.push("");
    lines.push(omitted > 0
      ? `## Recent conversation (last ${recent.length} of ${N} turns; ${omitted} earlier omitted)`
      : `## Conversation (${N} turns)`);
    lines.push("");
    for (const t of recent) {
      const role = t.m.sender === "human" ? "User" : "Assistant";
      const body = turnInlineText(t.m, null);
      if (!body) continue;
      lines.push(`**${role}:**`);
      lines.push(body);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
    lines.push("_Continue from here. The user's next message will follow._");

    const markdown = lines.join("\n");
    return { title, turnCount: N, artefactCount: artefacts.length, markdown };
  }

  async function extractCapsule(convId) {
    const orgId = await fetchOrgId();
    const conv = await fetchConversation(orgId, convId);
    return buildMarkdown(conv);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "capsule:extract" && msg.convId) {
      extractCapsule(msg.convId)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
  });
})();

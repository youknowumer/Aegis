/* Meeting assistant, Otter-style extras: interactive transcript (speakers, highlights, comments, search), Ask AI over one
   or all meetings, search across history, share link, exports, AI follow-up email, keywords and talk time, custom vocabulary.
   Loaded after meetings.js. Needs an Aegis server account (these features live on the server). */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const M = () => window.AegisMeetings, G = () => window.AegisGroq;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const toast = (t) => { if (window.AegisApp && AegisApp.toast) AegisApp.toast(t); };
  const mmss = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600); return (h ? h + ":" : "") + String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0") + ":" + String(s % 60).padStart(2, "0"); };
  const sget = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const sset = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };
  const COLORS = ["#dedafa", "#ff3d9a", "#ffb21c", "#2ee59d", "#8f86ff", "#ff7a45", "#b3a8ff", "#e0e65a"];

  const serverId = () => { const c = M() && M().current(); return c && !c.local && Number.isFinite(+c.id) ? +c.id : 0; };
  async function api(path, opts = {}) {
    const headers = Object.assign({ Authorization: "Bearer " + G().token() }, opts.json ? { "Content-Type": "application/json" } : {});
    if (G().getKey && G().getKey()) headers["X-Groq-Key"] = G().getKey();
    const r = await fetch(G().apiBase() + path, { method: opts.method || "GET", headers, body: opts.json ? JSON.stringify(opts.json) : undefined });
    if (!r.ok) { let m = ""; try { const j = await r.json(); m = j.detail || ""; } catch {} throw new Error(typeof m === "string" && m ? m : "Something went wrong (" + r.status + ").") ; }
    return opts.raw ? r : r.json();
  }

  // ------------------------------------------------------------ state for the open meeting
  let st = { id: 0, lines: [], ex: null, ins: null, q: "", loaded: 0, busy: false };
  let saveT = 0;
  const parseLines = (t) => String(t || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map((raw) => {
    const m = raw.match(/^\[((?:\d+:)?\d{1,2}:\d{2})\]\s*(.*)$/);
    if (!m) return { t: null, text: raw };
    const p = m[1].split(":").map(Number);
    return { t: p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1], text: m[2] };
  });
  const spName = (n) => (n ? (st.ex.names[String(n)] || "Speaker " + n) : "");
  function queueSave() {
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      try { const j = await api("/api/meetings/" + st.id + "/extra", { method: "PUT", json: { labels: st.ex.labels, names: st.ex.names, highlights: st.ex.highlights, comments: st.ex.comments, tags: st.ex.tags } }); st.ins = j.insights; renderInsights(); }
      catch (e) { toast("Couldn't save: " + e.message); }
    }, 500);
  }

  // ------------------------------------------------------------ inject tabs + panes
  function build() {
    const tabs = document.querySelector("#meetings .mt-tabs");
    if (!tabs || $("mp-pane-tr")) return;
    const mk = (id, label, after) => { const b = el("button", "mt-tab", label); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", "false"); b.dataset.tab = id; b.addEventListener("click", () => M().showTab(id)); after.after(b); return b; };
    const notesTab = tabs.querySelector('[data-tab="notes"]');
    const trTab = mk("transcript", "Transcript", notesTab); mk("ask", "Ask AI", trTab);

    const histPane = document.querySelector('#meetings [data-pane="history"]');
    const pane = (id, html) => { const p = el("div", "mt-pane hidden"); p.dataset.pane = id; p.id = "mp-pane-" + (id === "transcript" ? "tr" : id); p.innerHTML = html; histPane.before(p); return p; };

    pane("transcript", `
      <p id="mp-tr-empty" class="empty muted">Open a saved meeting (Notes or History) to see its interactive transcript. This needs your Aegis account.</p>
      <div id="mp-tr-body" class="hidden">
        <div class="mp-bar">
          <input id="mp-find" type="search" placeholder="Search this transcript..." aria-label="Search this transcript" autocomplete="off">
          <button id="mp-spk" class="btn ghost small-btn" type="button" title="Aegis reads the conversation and estimates who said each line">Identify speakers</button>
          <select id="mp-fmt" aria-label="Export format"><option value="">Export...</option><option value="txt">Text (.txt)</option><option value="srt">Subtitles (.srt)</option><option value="vtt">Subtitles (.vtt)</option><option value="md">Markdown (.md)</option><option value="json">Data (.json)</option></select>
          <button id="mp-share" class="btn ghost small-btn" type="button">Share link</button>
        </div>
        <div id="mp-share-box" class="mp-share hidden"></div>
        <div id="mp-ins" class="mp-ins"></div>
        <div id="mp-tags" class="mp-tags"></div>
        <p id="mp-note" class="mt-hint"></p>
        <div id="mp-lines" class="mp-lines" dir="auto"></div>
      </div>`);

    pane("ask", `
      <div class="mp-bar">
        <select id="mp-scope" aria-label="What to ask about"><option value="one">This meeting</option><option value="all">All my meetings</option></select>
        <span class="grow"></span><button id="mp-ask-clear" class="btn ghost small-btn" type="button">Clear chat</button>
      </div>
      <div id="mp-sugg" class="mp-sugg"></div>
      <div id="mp-chat" class="mp-chat" aria-live="polite"></div>
      <form id="mp-askform" class="mp-askform"><input id="mp-q" maxlength="800" placeholder="Ask anything about your meetings..." autocomplete="off" dir="auto"><button class="btn primary small-btn" type="submit">Ask</button></form>`);

    // history search
    const ul = $("mt-hist");
    const sb = el("div", "mp-hsearch"); sb.innerHTML = '<input id="mp-hq" type="search" placeholder="Search every meeting: words said, decisions, names..." aria-label="Search all meetings" autocomplete="off"><ul id="mp-hres" class="mt-histlist"></ul>';
    ul.before(sb);

    // follow-up email + insights on the notes tab
    const acts = $("mt-notes-actions");
    const fb = el("button", "btn ghost small-btn", "AI follow-up email"); fb.type = "button"; fb.id = "mp-fu-btn";
    $("mt-email").after(fb);
    const fu = el("div", "mp-fu hidden"); fu.id = "mp-fu";
    fu.innerHTML = `<div class="mp-bar"><select id="mp-fu-tone" aria-label="Tone"><option value="friendly and professional">Friendly</option><option value="formal">Formal</option><option value="short and direct">Short</option></select><select id="mp-fu-lang" aria-label="Language"><option>English</option><option>Roman Urdu</option><option>Urdu</option><option>Hindi</option></select><button id="mp-fu-go" class="btn primary small-btn" type="button">Write it</button></div>
      <input id="mp-fu-sub" placeholder="Subject" aria-label="Email subject" dir="auto"><textarea id="mp-fu-body" rows="9" placeholder="Your email will appear here, ready to edit." dir="auto"></textarea>
      <div class="mp-bar"><button id="mp-fu-copy" class="btn ghost small-btn" type="button">Copy</button><button id="mp-fu-mail" class="btn ghost small-btn" type="button">Open in mail app</button></div>`;
    acts.after(fu);

    // custom vocabulary in the record setup
    const title = $("mt-title");
    if (title) {
      const f = el("label", "field"); f.append("Custom words (names, product terms, jargon; helps spelling)");
      const i = el("input"); i.id = "mp-vocab"; i.maxLength = 100; i.placeholder = "e.g. Aegis, Ayesha, Kubernetes, Q3 roadmap"; i.autocomplete = "off"; i.value = sget("aegis_meet_vocab") || "";
      i.addEventListener("change", () => sset("aegis_meet_vocab", i.value.trim())); f.appendChild(i);
      title.closest("label").after(f);
    }
    bind();
  }

  // ------------------------------------------------------------ transcript tab
  async function loadTranscript(force) {
    const id = serverId();
    $("mp-tr-empty").classList.toggle("hidden", !!id); $("mp-tr-body").classList.toggle("hidden", !id);
    if (!id) return;
    if (!force && st.id === id && st.ex) return render();
    $("mp-note").textContent = "Loading...";
    try {
      const [ex, full] = await Promise.all([api("/api/meetings/" + id + "/extra"), Promise.resolve(M().current())]);
      st = { id, lines: parseLines(full.transcript), ex: { labels: ex.labels || [], names: ex.names || {}, highlights: ex.highlights || [], comments: ex.comments || [], tags: ex.tags || [] }, ins: ex.insights, q: "", share: ex.share };
      $("mp-find").value = "";
      $("mp-note").textContent = "";
      render();
    } catch (e) { $("mp-note").textContent = "Couldn't load the transcript: " + e.message; }
  }
  function render() { renderShare(); renderInsights(); renderTags(); renderLines(); }

  function renderInsights() {
    const host = $("mp-ins"); host.textContent = ""; const i = st.ins; if (!i) return;
    const stats = el("p", "mt-hint", i.lines + " lines · " + i.words + " words · " + i.questions + " question" + (i.questions === 1 ? "" : "s")); host.appendChild(stats);
    if (i.speakers && i.speakers.length && !(i.speakers.length === 1 && i.speakers[0].id === 0)) {
      const bar = el("div", "mp-talk"); bar.setAttribute("role", "img"); bar.setAttribute("aria-label", "Talk time: " + i.speakers.map((s) => s.name + " " + s.share + "%").join(", "));
      i.speakers.forEach((s, k) => { const seg = el("i"); seg.style.flexGrow = Math.max(1, s.share); seg.style.background = COLORS[(s.id || 0) % COLORS.length]; seg.title = s.name + ": " + s.share + "% (" + mmss(s.seconds) + ")"; bar.appendChild(seg); });
      host.appendChild(bar);
      const lg = el("div", "mp-legend"); i.speakers.forEach((s) => { const x = el("span"); const dot = el("i"); dot.style.background = COLORS[(s.id || 0) % COLORS.length]; x.append(dot, s.name + " " + s.share + "%"); lg.appendChild(x); }); host.appendChild(lg);
    }
    if (i.keywords && i.keywords.length) { const kw = el("div", "mt-chips"); i.keywords.forEach((k) => { const c = el("button", "mt-chip topic", k); c.type = "button"; c.title = "Find in transcript"; c.addEventListener("click", () => { $("mp-find").value = k; st.q = k; renderLines(); }); kw.appendChild(c); }); host.appendChild(kw); }
  }
  function renderTags() {
    const host = $("mp-tags"); host.textContent = "";
    st.ex.tags.forEach((t, i) => { const c = el("span", "mt-chip topic", "#" + t); const x = el("button", "mp-x", "×"); x.type = "button"; x.setAttribute("aria-label", "Remove tag " + t); x.addEventListener("click", () => { st.ex.tags.splice(i, 1); renderTags(); queueSave(); }); c.appendChild(x); host.appendChild(c); });
    const inp = el("input"); inp.placeholder = "+ tag"; inp.maxLength = 30; inp.setAttribute("aria-label", "Add a tag");
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && inp.value.trim()) { e.preventDefault(); st.ex.tags.push(inp.value.trim().replace(/^#/, "")); renderTags(); queueSave(); $("mp-tags").querySelector("input").focus(); } });
    host.appendChild(inp);
  }
  function renderLines() {
    const host = $("mp-lines"); host.textContent = "";
    const q = st.q.trim().toLowerCase(), hl = new Set(st.ex.highlights);
    let shown = 0, last = -1;
    st.lines.forEach((ln, i) => {
      if (q && !ln.text.toLowerCase().includes(q)) return;
      shown++;
      const sp = st.ex.labels[i] || 0;
      const row = el("div", "mp-line" + (hl.has(i) ? " hl" : "")); row.dataset.i = i;
      if (ln.t != null) row.appendChild(el("time", "", mmss(ln.t)));
      if (sp) {
        const chip = el("button", "mp-spk" + (sp === last && !q ? " same" : ""), spName(sp)); chip.type = "button"; chip.style.setProperty("--c", COLORS[sp % COLORS.length]); chip.title = "Rename this speaker";
        chip.addEventListener("click", () => { const n = prompt("Name for " + spName(sp) + ":", st.ex.names[String(sp)] || ""); if (n === null) return; if (n.trim()) st.ex.names[String(sp)] = n.trim().slice(0, 40); else delete st.ex.names[String(sp)]; renderLines(); queueSave(); });
        row.appendChild(chip);
      }
      last = sp;
      const txt = el("span", "mp-txt");
      if (q) { const k = ln.text.toLowerCase().indexOf(q); txt.append(ln.text.slice(0, k)); const m = el("mark", "", ln.text.slice(k, k + q.length)); txt.append(m, ln.text.slice(k + q.length)); } else txt.textContent = ln.text;
      row.appendChild(txt);
      const star = el("button", "mp-ic" + (hl.has(i) ? " on" : ""), hl.has(i) ? "★" : "☆"); star.type = "button"; star.title = "Highlight"; star.setAttribute("aria-label", "Highlight this line"); star.setAttribute("aria-pressed", hl.has(i));
      star.addEventListener("click", () => { const k = st.ex.highlights.indexOf(i); k >= 0 ? st.ex.highlights.splice(k, 1) : st.ex.highlights.push(i); renderLines(); queueSave(); });
      const cm = el("button", "mp-ic", "💬"); cm.type = "button"; cm.title = "Add a comment"; cm.setAttribute("aria-label", "Comment on this line");
      cm.addEventListener("click", () => { const t = prompt("Comment:"); if (t && t.trim()) { st.ex.comments.push({ line: i, text: t.trim().slice(0, 500), at: Date.now() / 1000 }); renderLines(); queueSave(); } });
      row.append(star, cm);
      host.appendChild(row);
      st.ex.comments.forEach((c, ci) => { if (c.line !== i) return; const cr = el("div", "mp-comment"); cr.append(el("span", "", c.text)); const x = el("button", "mp-x", "×"); x.type = "button"; x.setAttribute("aria-label", "Delete comment"); x.addEventListener("click", () => { st.ex.comments.splice(ci, 1); renderLines(); queueSave(); }); cr.appendChild(x); host.appendChild(cr); });
    });
    if (!shown) host.appendChild(el("p", "empty muted", q ? "No line contains \"" + st.q + "\"." : "This transcript is empty."));
  }
  function jumpTo(sec) {
    M().showTab("transcript");
    setTimeout(() => {
      let best = -1, bd = 1e9;
      st.lines.forEach((l, i) => { if (l.t != null && Math.abs(l.t - sec) < bd) { bd = Math.abs(l.t - sec); best = i; } });
      const row = $("mp-lines").querySelector('[data-i="' + best + '"]');
      if (row) { row.scrollIntoView({ block: "center", behavior: "smooth" }); row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 1800); }
    }, 250);
  }

  // ------------------------------------------------------------ share
  function renderShare() {
    const box = $("mp-share-box"); box.textContent = "";
    $("mp-share").textContent = st.share ? "Sharing on" : "Share link";
    if (!st.share) return box.classList.add("hidden");
    box.classList.remove("hidden");
    const url = location.origin + "/shared/" + st.share;
    const inp = el("input"); inp.readOnly = true; inp.value = url; inp.setAttribute("aria-label", "Share link"); inp.addEventListener("focus", () => inp.select());
    const copy = el("button", "btn ghost small-btn", "Copy"); copy.type = "button"; copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(url); toast("Link copied."); } catch { inp.select(); } });
    const off = el("button", "btn ghost small-btn", "Stop sharing"); off.type = "button"; off.addEventListener("click", async () => { try { await api("/api/meetings/" + st.id + "/share", { method: "DELETE" }); st.share = ""; renderShare(); toast("Link turned off."); } catch (e) { toast(e.message); } });
    box.append(el("small", "muted", "Anyone with this link can read the notes and transcript (not edit)."), inp, copy, off);
  }

  // ------------------------------------------------------------ ask AI
  const chat = []; // {role, text, sources}
  const SUGG_ONE = ["Summarize this in 3 bullets", "What are my action items?", "What decisions were made?", "Any deadlines mentioned?"];
  const SUGG_ALL = ["What did we decide about pricing?", "Which action items are still open?", "What did Ali say last week?"];
  function renderChat() {
    const host = $("mp-chat"); host.textContent = "";
    chat.forEach((m) => {
      const b = el("div", "mp-msg " + m.role);
      if (m.role === "ai") {
        String(m.text).split(/(\[(?:\d+:)?\d{1,2}:\d{2}\])/).forEach((part) => {
          const t = part.match(/^\[((?:\d+:)?\d{1,2}:\d{2})\]$/);
          if (t && m.scope === "one") { const p = t[1].split(":").map(Number); const sec = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; const a = el("button", "mp-ts", part); a.type = "button"; a.title = "Jump to this moment"; a.addEventListener("click", () => jumpTo(sec)); b.appendChild(a); }
          else b.append(part);
        });
        if (m.sources && m.scope === "all" && m.sources.length) { const s = el("div", "mp-src", "From: "); m.sources.forEach((x) => { const a = el("button", "mp-ts", x.title); a.type = "button"; a.addEventListener("click", () => M().openSaved({ id: x.id })); s.appendChild(a); }); b.appendChild(s); }
      } else b.textContent = m.text;
      host.appendChild(b);
    });
    host.scrollTop = host.scrollHeight;
    const sc = $("mp-scope").value;
    const sg = $("mp-sugg"); sg.textContent = "";
    if (!chat.length) (sc === "one" ? SUGG_ONE : SUGG_ALL).forEach((t) => { const c = el("button", "mt-chip topic", t); c.type = "button"; c.addEventListener("click", () => { $("mp-q").value = t; $("mp-askform").requestSubmit(); }); sg.appendChild(c); });
  }
  async function ask(q) {
    const scope = $("mp-scope").value, id = serverId();
    if (scope === "one" && !id) { toast("Open a saved meeting first, or switch to All my meetings."); return; }
    const hist = []; for (let i = 0; i < chat.length - 1; i++) if (chat[i].role === "me" && chat[i + 1] && chat[i + 1].role === "ai") hist.push({ q: chat[i].text, a: chat[i + 1].text });
    chat.push({ role: "me", text: q }); const wait = { role: "ai", text: "Thinking...", scope }; chat.push(wait); renderChat();
    try {
      const r = await api("/api/meetings/ask", { method: "POST", json: { question: q, mid: scope === "one" ? id : 0, history: scope === "one" ? hist.slice(-4) : [] } });
      wait.text = r.answer; wait.sources = r.sources;
    } catch (e) { wait.text = "Couldn't answer: " + e.message; }
    renderChat();
  }

  // ------------------------------------------------------------ history search
  let hqT = 0;
  async function histSearch(q) {
    const ul = $("mp-hres"); ul.textContent = "";
    const list = $("mt-hist"); list.classList.toggle("hidden", !!q.trim());
    if (!q.trim()) return;
    try {
      const rows = await api("/api/meetings/search?q=" + encodeURIComponent(q));
      if (!rows.length) { ul.appendChild(el("li", "empty muted", "No meeting mentions that.")); return; }
      rows.forEach((m) => {
        const li = el("li"); const b = el("button", "mt-hist-open"); b.type = "button";
        const t = el("b", "", m.title); t.dir = "auto";
        const sn = el("small", "muted", m.snippet); sn.dir = "auto";
        b.append(t, sn); b.addEventListener("click", () => { $("mp-hq").value = ""; histSearch(""); M().openSaved(m); });
        li.appendChild(b); ul.appendChild(li);
      });
    } catch (e) { ul.appendChild(el("li", "empty muted", "Search failed: " + e.message)); }
  }

  // ------------------------------------------------------------ wiring
  function bind() {
    $("mp-find").addEventListener("input", (e) => { st.q = e.target.value; renderLines(); });
    $("mp-spk").addEventListener("click", async () => {
      if (!st.id || st.busy) return; st.busy = true; const b = $("mp-spk"); b.disabled = true; $("mp-note").textContent = "Reading the conversation to tell speakers apart...";
      try { const j = await api("/api/meetings/" + st.id + "/speakers", { method: "POST" }); st.ex.labels = j.labels; st.ex.names = j.names; st.ins = j.insights; render(); $("mp-note").textContent = "Speakers are estimated from the conversation, not from voices. Click a name to fix or rename it."; }
      catch (e) { $("mp-note").textContent = "Couldn't identify speakers: " + e.message; }
      st.busy = false; b.disabled = false;
    });
    $("mp-fmt").addEventListener("change", async (e) => {
      const fmt = e.target.value; e.target.value = ""; if (!fmt || !st.id) return;
      try { const r = await api("/api/meetings/" + st.id + "/export?fmt=" + fmt, { raw: true }); const blob = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = ((M().current().title || "meeting").toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "meeting") + "." + fmt; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
      catch (err) { toast("Export failed: " + err.message); }
    });
    $("mp-share").addEventListener("click", async () => {
      if (!st.id) return;
      if (st.share) { $("mp-share-box").classList.toggle("hidden"); return; }
      try { const j = await api("/api/meetings/" + st.id + "/share", { method: "POST" }); st.share = j.token; renderShare(); } catch (e) { toast(e.message); }
    });
    $("mp-scope").addEventListener("change", renderChat);
    $("mp-ask-clear").addEventListener("click", () => { chat.length = 0; renderChat(); });
    $("mp-askform").addEventListener("submit", (e) => { e.preventDefault(); const q = $("mp-q").value.trim(); if (q.length < 2) return; $("mp-q").value = ""; ask(q); });
    $("mp-hq").addEventListener("input", (e) => { clearTimeout(hqT); const v = e.target.value; hqT = setTimeout(() => histSearch(v), 280); });
    $("mp-fu-btn").addEventListener("click", () => { if (!serverId()) return toast("Open a saved meeting first (this needs your account)."); $("mp-fu").classList.toggle("hidden"); });
    $("mp-fu-go").addEventListener("click", async () => {
      const id = serverId(); if (!id) return; const b = $("mp-fu-go"); b.disabled = true; b.textContent = "Writing...";
      try { const j = await api("/api/meetings/" + id + "/followup", { method: "POST", json: { tone: $("mp-fu-tone").value, language: $("mp-fu-lang").value } }); $("mp-fu-sub").value = j.subject; $("mp-fu-body").value = j.body; }
      catch (e) { toast("Couldn't write it: " + e.message); }
      b.disabled = false; b.textContent = "Write it";
    });
    $("mp-fu-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("mp-fu-sub").value + "\n\n" + $("mp-fu-body").value); toast("Email copied."); } catch { toast("Your browser blocked copying."); } });
    $("mp-fu-mail").addEventListener("click", () => { location.href = "mailto:?subject=" + encodeURIComponent($("mp-fu-sub").value) + "&body=" + encodeURIComponent($("mp-fu-body").value); });
  }

  document.addEventListener("aegis-meeting-tab", (e) => {
    if (e.detail === "transcript") loadTranscript(false);
    if (e.detail === "ask") { renderChat(); const c = M().current(); if (!serverId()) $("mp-scope").value = "all"; else if (chat.length === 0 && c) $("mp-scope").value = "one"; renderChat(); }
  });
  document.addEventListener("aegis-meeting-render", () => { st = { id: 0, lines: [], ex: null, ins: null, q: "" }; chat.length = 0; const fu = $("mp-fu"); if (fu) { fu.classList.add("hidden"); $("mp-fu-sub").value = ""; $("mp-fu-body").value = ""; } });

  function init() { if (!$("meetings") || !G()) return; if (G().isLocal && G().isLocal()) return; build(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

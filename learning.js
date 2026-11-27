/* Aegis learning (v19): the "What Aegis has learned" card in Settings, and voice shortcuts you teach by speaking.
 *
 *  - Card: switch learning on/off, see and delete the rules Aegis learned about how you like to be helped, add one by hand,
 *    see how many chats can be used as training data, and download that data (JSONL) or an Ollama Modelfile.
 *  - Shortcuts: "when I say work mode, open github" saves a phrase -> action on this device. Later, saying the phrase runs the action
 *    exactly as if you had said it ("work mode" -> "open github"). Works in English and Roman Urdu. Stored in this browser only.
 * Needs app.js (AegisApp) and commands.js (AegisCommands.extend). */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const KEY = "aegis_shortcuts";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toast = (t) => { try { (window.AegisApp && AegisApp.toast || (() => {}))(t); } catch {} };

  // ------------------------------------------------------------------ voice shortcuts (this device only)
  function load() { try { const o = JSON.parse(localStorage.getItem(KEY) || "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch { return false; } }
  const clean = (s) => (window.AegisCommands ? AegisCommands.norm(s) : String(s || "").toLowerCase().trim()).replace(/^(?:the|a)\s+/, "");
  const strip = (t) => t.replace(/^(?:open|start|run|launch|do|activate|go to|chalao|kholo)\s+/, "").replace(/\s+(?:karo|kholo|chalao|mode on|please)$/, "").trim();
  let depth = 0;

  function lookup(t) {
    const all = load();
    const k = Object.keys(all);
    return k.find((p) => p === t) || k.find((p) => p === strip(t)) || null;
  }

  const cmds = [
    { name: "sc-teach",
      test: (t) => {
        const m = t.match(/^(?:when i say|if i say|jab main kahoon|jab main kahun|jab mein kahun) (.{2,40}?),? (?:then |you |please |to |tab )?(?:should )?(.{3,150})$/);
        return m && !/\?$/.test(t) ? { phrase: clean(m[1]), action: m[2].replace(/^(?:do|run|say)\s+/, "").trim() } : null;
      },
      run: (m, c) => {
        const all = load();
        if (Object.keys(all).length >= 40 && !all[m.phrase]) return c.say("You already have 40 shortcuts. Forget one first.", { silent: true });
        if (!m.phrase || m.phrase === clean(m.action)) return c.say("That shortcut would loop. Pick a different phrase.", { silent: true });
        all[m.phrase] = m.action;
        return c.say(save(all) ? `Done. When you say "${m.phrase}", I will ${m.action}.` : "I could not save that on this device.", { silent: true });
      } },
    { name: "sc-list", test: (t) => /^(?:what|which|list|show|read)(?: are| is)?(?: me)?(?: all)?(?: my)? (?:voice )?shortcuts?(?: do i have)?$|^(?:mere )?shortcuts? (?:dikhao|batao)$/.test(t),
      run: (m, c) => { const k = Object.entries(load()); return c.say(k.length ? "Your shortcuts: " + k.slice(0, 8).map(([p, a]) => `"${p}" does ${a}`).join("; ") + "." : 'You have no shortcuts yet. Say: when I say work mode, open github.', { silent: false }); } },
    { name: "sc-forget",
      test: (t) => { const m = t.match(/^(?:forget|delete|remove) (?:the )?(?:shortcut|alias) (.{2,40})$/) || t.match(/^(?:shortcut|alias) (.{2,40}) (?:hata do|delete karo|bhool jao)$/); return m ? { phrase: clean(m[1]) } : null; },
      run: (m, c) => { const all = load(); if (!(m.phrase in all)) return c.say(`I have no shortcut called "${m.phrase}".`, { silent: true }); delete all[m.phrase]; save(all); return c.say("Forgotten.", { silent: true }); } },
    { name: "sc-run",
      test: (t) => { const p = lookup(t); return p ? { phrase: p } : null; },
      run: (m, c) => {
        const action = load()[m.phrase];
        if (!action || depth > 0 || !window.AegisApp) return null;
        depth++;
        try { AegisApp.submitText(action); } finally { setTimeout(() => { depth = 0; }, 800); }
        return Promise.resolve();
      } },
  ];
  if (window.AegisCommands && AegisCommands.extend) AegisCommands.extend(cmds, { first: true });

  // ------------------------------------------------------------------ the Settings card
  let state = null;
  async function call(path, opts) {
    const app = window.AegisApp || {};
    if (!app.token) throw new Error("login");
    const r = await fetch((app.apiBase || "") + path, Object.assign({}, opts, { headers: Object.assign({ "Content-Type": "application/json", Authorization: "Bearer " + app.token }, (opts && opts.headers) || {}) }));
    if (!r.ok) { let d = ""; try { d = (await r.json()).detail; } catch {} throw new Error(d || "failed"); }
    return r;
  }
  async function saveFile(path, name) {
    try {
      const r = await call(path);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await r.blob());
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { toast(e.message === "login" ? "Log in to your Aegis server first." : e.message); }
  }

  function paint() {
    const box = $("learning-card");
    if (!box) return;
    const body = box.querySelector(".lc-body");
    if (!state) { body.innerHTML = '<p class="muted small">Log in to your Aegis server to see what it has learned.</p>'; return; }
    const st = state.stats;
    body.innerHTML =
      '<label class="row"><span class="label">Learn from our chats</span><input id="lc-on" type="checkbox"' + (state.enabled ? " checked" : "") + (state.server_enabled ? "" : " disabled") + "></label>" +
      (state.server_enabled ? "" : '<p class="muted small">The server owner turned learning off (AEGIS_LEARNING=0).</p>') +
      '<p class="muted small">' + st.logged + " chats logged (" + st.trainable + " usable as training data), " + st.up + " 👍, " + st.down + " 👎, " + st.instant + " instant commands.</p>" +
      '<ul id="lc-list" class="lc-list">' + (state.lessons.length ? state.lessons.map((l) => '<li><span>' + esc(l.text) + '</span> <button class="lc-del" data-id="' + l.id + '" type="button" aria-label="Forget this">✕</button></li>').join("") : '<li class="muted small">Nothing yet. Say things like "from now on keep answers short", or rate replies with 👍 👎.</li>') + "</ul>" +
      '<div class="row"><input id="lc-new" type="text" maxlength="200" placeholder="Teach a rule: always reply in Roman Urdu" style="flex:1"><button id="lc-add" class="btn ghost small-btn" type="button">Add</button></div>' +
      '<div class="row" style="gap:6px;flex-wrap:wrap"><select id="lc-fmt" aria-label="Training data format"><option value="openai">Chat JSONL (OpenAI, Together, Unsloth)</option><option value="alpaca">Alpaca JSONL</option><option value="kto">Thumbs JSONL (KTO)</option></select>' +
      '<button id="lc-export" class="btn ghost small-btn" type="button">Download training data</button>' +
      '<button id="lc-model" class="btn ghost small-btn" type="button">Ollama Modelfile</button>' +
      '<button id="lc-clear" class="btn ghost small-btn" type="button">Clear the log</button></div>' +
      '<p class="muted small">Passwords, emails, phone and card numbers are removed before anything is exported. See LEARNING.md.</p>';
    $("lc-on").addEventListener("change", async (e) => { try { await call("/api/learning/settings", { method: "POST", body: JSON.stringify({ enabled: e.target.checked }) }); } catch { toast("Could not change that."); } refresh(); });
    body.querySelectorAll(".lc-del").forEach((b) => b.addEventListener("click", async () => { try { await call("/api/learning/lessons/" + b.dataset.id, { method: "DELETE" }); } catch {} refresh(); }));
    $("lc-add").addEventListener("click", async () => {
      const v = $("lc-new").value.trim();
      if (v.length < 4) return toast("Write the rule in a few words.");
      try { await call("/api/learning/lessons", { method: "POST", body: JSON.stringify({ text: v }) }); toast("Learned."); } catch (e) { toast(e.message); }
      refresh();
    });
    $("lc-export").addEventListener("click", () => saveFile("/api/learning/export?fmt=" + $("lc-fmt").value, "aegis-training-" + $("lc-fmt").value + ".jsonl"));
    $("lc-model").addEventListener("click", () => saveFile("/api/learning/modelfile", "Modelfile"));
    $("lc-clear").addEventListener("click", async () => { if (!confirm("Delete the logged chats used for training data? Lessons and memories stay.")) return; try { await call("/api/learning/data", { method: "DELETE" }); } catch {} refresh(); });
  }
  async function refresh() {
    try { state = await (await call("/api/learning")).json(); } catch { state = null; }
    paint();
  }
  function mount() {
    const dlg = $("settings");
    if (!dlg || $("learning-card")) return;
    const box = document.createElement("div");
    box.className = "set-group";
    box.id = "learning-card";
    box.innerHTML = "<h4>What Aegis has learned</h4><p class=\"muted small\">Rules and habits Aegis picked up from you. They shape every answer and you can delete any of them.</p><div class=\"lc-body\"></div>";
    const first = dlg.querySelector(".set-group");
    if (first) first.parentNode.insertBefore(box, first.nextSibling); else dlg.appendChild(box);
    new MutationObserver(() => { if (dlg.open) refresh(); }).observe(dlg, { attributes: true, attributeFilter: ["open"] });
    paint();
  }
  const css = document.createElement("style");
  css.textContent = ".lc-list{list-style:none;margin:8px 0;padding:0;display:grid;gap:4px}.lc-list li{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:13px}" +
    ".lc-del{background:none;border:0;color:var(--muted);cursor:pointer}.msg-actions .rate.on{color:var(--accent,#6c63ff);opacity:1}";
  document.head.appendChild(css);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
  window.addEventListener("aegis:status", (e) => { if (e.detail && e.detail.type === "hello") refresh(); });

  window.AegisLearning = { shortcuts: load, refresh, commands: cmds };
})();

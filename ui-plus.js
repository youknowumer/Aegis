// Aegis UI+ : interface polish layered on top of app.js. Purely additive: every feature is optional and
// guarded, so if anything here fails the core app keeps working. No innerHTML, no inline handlers (strict CSP safe).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  const guard = (fn) => { try { fn(); } catch (e) { /* UI polish must never break the app */ } };

  // ------------------------------------------------------------ avatar (initial of the signed-in email)
  guard(() => {
    const mail = $("user-email"), av = $("user-avatar");
    if (!mail || !av) return;
    const sync = () => {
      const t = (mail.textContent || "").trim();
      av.textContent = t ? t[0].toUpperCase() : "A";
      const plan = $("plan-name");
      const meta = document.querySelector(".user-plan");
      if (meta && plan && plan.textContent.trim()) meta.textContent = plan.textContent.trim() + " plan";
    };
    new MutationObserver(sync).observe(mail, { childList: true, characterData: true, subtree: true });
    const plan = $("plan-name");
    if (plan) new MutationObserver(sync).observe(plan, { childList: true, characterData: true, subtree: true });
    sync();
  });

  // ------------------------------------------------------------ welcome date line
  guard(() => {
    const el = $("greeting-date");
    if (!el) return;
    const set = () => { el.textContent = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }); };
    set(); setInterval(set, 60000);
  });

  // ------------------------------------------------------------ collapsible sidebar panels (remembered)
  guard(() => {
    const KEY = "aegis_collapsed";
    let state = {};
    const saved = store.get(KEY);
    try { state = saved ? JSON.parse(saved) || {} : { shortcuts: true }; } catch { state = {}; }
    document.querySelectorAll(".blk[data-collapse]").forEach((blk) => {
      const id = blk.dataset.collapse, head = blk.querySelector(".blk-head");
      if (!head) return;
      head.setAttribute("role", "button");
      head.setAttribute("tabindex", "0");
      const apply = (v) => { blk.classList.toggle("collapsed", v); head.setAttribute("aria-expanded", String(!v)); };
      apply(!!state[id]);
      const flip = () => { const v = !blk.classList.contains("collapsed"); apply(v); state[id] = v; store.set(KEY, JSON.stringify(state)); };
      head.addEventListener("click", flip);
      head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
    });
  });

  // ------------------------------------------------------------ jump to latest
  guard(() => {
    const box = $("messages"), btn = $("jump-btn");
    if (!box || !btn) return;
    const far = () => box.scrollHeight - box.scrollTop - box.clientHeight > 160;
    const update = () => btn.classList.toggle("hidden", !far() || !box.querySelector(".msg"));
    box.addEventListener("scroll", update, { passive: true });
    new MutationObserver(update).observe(box, { childList: true, subtree: true });
    btn.addEventListener("click", () => { box.scrollTop = box.scrollHeight; update(); });
  });

  // ------------------------------------------------------------ message polish: code copy + time stamps
  guard(() => {
    const box = $("messages");
    if (!box) return;
    const clock = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    let queued = false;
    const polish = () => {
      queued = false;
      box.querySelectorAll(".msg.ai:not(.streaming)").forEach((m) => {
        m.querySelectorAll("pre").forEach((pre) => {
          if (pre.querySelector(".code-copy")) return;
          const b = document.createElement("button");
          b.type = "button"; b.className = "code-copy"; b.textContent = "Copy"; b.setAttribute("aria-label", "Copy code");
          b.addEventListener("click", async () => {
            const code = pre.querySelector("code");
            try { await navigator.clipboard.writeText(code ? code.textContent : ""); b.textContent = "Copied"; } catch { b.textContent = "Can't copy"; }
            setTimeout(() => (b.textContent = "Copy"), 1400);
          });
          pre.appendChild(b);
        });
        const bar = m.querySelector(".msg-actions");
        if (bar && !bar.querySelector(".msg-time")) {
          const t = document.createElement("span");
          t.className = "msg-time"; t.textContent = clock(new Date());
          bar.appendChild(t);
        }
      });
      box.querySelectorAll(".msg.user:not([title])").forEach((m) => { m.title = clock(new Date()); });
    };
    new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(polish); } })
      .observe(box, { childList: true, subtree: true });
  });

  // ------------------------------------------------------------ composer: character count
  guard(() => {
    const input = $("input"), cc = $("char-count");
    if (!input || !cc) return;
    const LIMIT = 4000;
    const update = () => {
      const n = input.value.length;
      cc.classList.toggle("hidden", n < 500);
      cc.textContent = n + " / " + LIMIT;
      cc.classList.toggle("over", n > LIMIT);
    };
    input.addEventListener("input", update);
    input.addEventListener("blur", update);
    update();
  });

  // ------------------------------------------------------------ usage meter turns amber / red near the limit
  guard(() => {
    const txt = $("usage-text"), bar = $("usage-bar");
    if (!txt || !bar) return;
    const sync = () => {
      const m = (txt.textContent || "").match(/(\d+)\s*\/\s*(\d+)/);
      if (!m) return;
      const r = Number(m[1]) / Math.max(1, Number(m[2]));
      bar.classList.toggle("warn", r >= 0.7 && r < 1);
      bar.classList.toggle("full", r >= 1);
    };
    new MutationObserver(sync).observe(txt, { childList: true, characterData: true, subtree: true });
    sync();
  });

  // ------------------------------------------------------------ appearance settings (density, text size, effects)
  guard(() => {
    const dens = $("ui-density"), fs = $("ui-fontsize"), fx = $("ui-fx");
    const applyDensity = (v) => document.body.classList.toggle("compact", v === "compact");
    const applySize = (v) => document.documentElement.style.setProperty("--msg-size", v + "px");
    const applyFx = (on) => document.body.classList.toggle("calm", !on);

    const d = store.get("aegis_density") || "comfortable";
    const s = Number(store.get("aegis_fontsize")) || 15;
    const f = store.get("aegis_fx") !== "off";
    applyDensity(d); applySize(s); applyFx(f);
    if (dens) { dens.value = d; dens.addEventListener("change", () => { applyDensity(dens.value); store.set("aegis_density", dens.value); }); }
    if (fs) { fs.value = String(s); fs.addEventListener("input", () => { applySize(fs.value); store.set("aegis_fontsize", fs.value); }); }
    if (fx) { fx.checked = f; fx.addEventListener("change", () => { applyFx(fx.checked); store.set("aegis_fx", fx.checked ? "on" : "off"); }); }
  });

  // ------------------------------------------------------------ keyboard shortcuts dialog
  guard(() => {
    const dlg = $("shortcuts");
    if (!dlg || typeof dlg.showModal !== "function") return;
    const open = () => { if (!dlg.open) dlg.showModal(); };
    const hb = $("help-btn"); if (hb) hb.addEventListener("click", open);
    const cb = $("shortcuts-close"); if (cb) cb.addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    document.addEventListener("keydown", (e) => {
      const t = e.target, typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "?" && !typing && !document.querySelector("dialog[open]") && !$("app").classList.contains("hidden")) { e.preventDefault(); open(); }
    });
    // click outside also closes the other simple dialogs
    ["settings", "palette"].forEach((id) => { const d = $(id); if (d) d.addEventListener("click", (e) => { if (e.target === d) d.close(); }); });
  });

  // ------------------------------------------------------------ export conversation as Markdown
  guard(() => {
    const btn = $("export-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const msgs = [...document.querySelectorAll("#messages .msg.user, #messages .msg.ai")];
      const toast = (m) => { const t = $("toast"); if (!t) return; t.textContent = m; t.classList.remove("hidden"); setTimeout(() => t.classList.add("hidden"), 2600); };
      if (!msgs.length) return toast("Nothing to export yet.");
      const lines = ["# Aegis conversation", "", "_Exported " + new Date().toLocaleString() + "_", ""];
      msgs.forEach((m) => {
        const c = m.cloneNode(true);
        c.querySelectorAll(".msg-actions, .code-copy").forEach((n) => n.remove());
        lines.push("**" + (m.classList.contains("user") ? "You" : "Aegis") + ":**", "", (c.innerText || c.textContent || "").trim(), "");
      });
      const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "aegis-conversation-" + new Date().toISOString().slice(0, 10) + ".md";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("Conversation exported.");
    });
  });
})();

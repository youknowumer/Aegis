/* Aegis web control (v17): voice commands that drive THIS web page, plus the "Browser control" card in Settings
 * that links the Aegis Web Hands extension (which lets Aegis use your other tabs).
 * Everything here runs locally in the page: no server, no quota. Needs commands.js (AegisCommands.extend). */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const num = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, ek: 1, do: 2, teen: 3, char: 4, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10 };
  const toNum = (s) => (/^\d+$/.test(s) ? +s : num[s] || 0);

  function visible(el) {
    if (!el || el.closest("[hidden],.hidden,[inert]")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }
  function labelOf(el) {
    return String(el.getAttribute("aria-label") || el.innerText || el.value || el.title || el.placeholder || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
  }
  function clickables() {
    const open = document.querySelector("dialog[open]");
    const root = open || document;
    return Array.from(root.querySelectorAll("button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=menuitem],[role=switch],[role=checkbox],label[for]"))
      .filter((e) => !e.disabled && visible(e) && !e.closest(".wc-badges"));
  }
  function words(s) { return String(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim(); }
  function findByName(name) {
    const q = words(name);
    if (!q) return null;
    const list = clickables().map((e) => ({ e, l: words(labelOf(e)) })).filter((x) => x.l);
    return (list.find((x) => x.l === q) || list.find((x) => x.l.startsWith(q)) || list.find((x) => x.l.includes(q)) ||
      list.find((x) => q.split(" ").every((w) => x.l.includes(w))) || {}).e || null;
  }
  function press(el) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/^(checkbox|radio|button|submit)$/.test(el.type || "")) { el.focus(); return "focus"; }
    el.click();
    return "click";
  }

  // ---- numbered badges ("show numbers", then "click 4")
  let badges = null;
  function showNumbers() {
    hideNumbers();
    const list = clickables().slice(0, 60);
    badges = document.createElement("div");
    badges.className = "wc-badges";
    badges.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483000";
    list.forEach((e, i) => {
      const r = e.getBoundingClientRect();
      const b = document.createElement("span");
      b.textContent = String(i + 1);
      b.style.cssText = `position:fixed;left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top)}px;background:#f59e0b;color:#111;font:700 11px/1 system-ui;padding:2px 5px;border-radius:6px;box-shadow:0 1px 4px #0008`;
      badges.appendChild(b);
    });
    badges._list = list;
    document.body.appendChild(badges);
    return list.length;
  }
  function hideNumbers() { if (badges) { badges.remove(); badges = null; } }

  // ---- zoom
  let zoom = 1;
  try { zoom = Math.min(2, Math.max(0.6, parseFloat(localStorage.getItem("aegis_zoom")) || 1)); } catch {}
  function setZoom(z) {
    zoom = Math.round(Math.min(2, Math.max(0.6, z)) * 100) / 100;
    document.documentElement.style.zoom = zoom === 1 ? "" : String(zoom);
    try { localStorage.setItem("aegis_zoom", String(zoom)); } catch {}
    return Math.round(zoom * 100);
  }
  if (zoom !== 1) document.documentElement.style.zoom = String(zoom);

  function scrollTarget() {
    const m = $("messages");
    const el = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const dlg = document.querySelector("dialog[open]");
    if (dlg && dlg.scrollHeight > dlg.clientHeight) return dlg;
    if (m && m.scrollHeight > m.clientHeight + 20 && (!el || m.contains(el) || document.scrollingElement.scrollHeight <= innerHeight + 20)) return m;
    return document.scrollingElement || document.documentElement;
  }

  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  const T = (re) => (t) => re.test(t);
  const C = [];
  const add = (name, test, run) => C.push({ name, test, run });

  // ---- scrolling
  add("wc-scroll", (t) => {
    let m = t.match(/^(?:scroll|go|move|page)\s*(up|down)(?: a (?:bit|little))?(?: (a lot|fast|more))?$/) || t.match(/^(?:scroll )?(?:page )?(up|down)$/) ||
      t.match(/^(?:neeche|niche|upar|oopar|up) (?:scroll )?(?:karo|kro|jao|le jao|chalo)$/) || t.match(/^scroll (?:karo )?(neeche|niche|upar|oopar)$/);
    if (!m) return null;
    const w = m[1] || t;
    return { dir: /up|upar|oopar/.test(w) && !/down/.test(w) ? -1 : 1, big: /lot|fast|more/.test(t) || /^page/.test(t) };
  }, (m, c) => {
    const el = scrollTarget();
    el.scrollBy({ top: m.dir * el.clientHeight * (m.big ? 0.9 : 0.5), behavior: "smooth" });
    return c.say(m.dir > 0 ? "Scrolling down." : "Scrolling up.", { silent: true });
  });
  add("wc-edge", (t) => { const m = t.match(/^(?:scroll |go |jump )?(?:to )?(?:the )?(top|bottom|end|beginning|start)(?: of (?:the )?page)?$/); return m ? { top: /top|beginning|start/.test(m[1]) } : null; },
    (m, c) => { const el = scrollTarget(); el.scrollTo({ top: m.top ? 0 : el.scrollHeight, behavior: "smooth" }); return c.say(m.top ? "Top." : "Bottom.", { silent: true }); });

  // ---- history / reload / zoom
  add("wc-back", T(/^(?:go )?back$|^(?:go to )?(?:the )?previous page$|^wapas jao$|^peeche jao$/), (m, c) => { history.back(); return c.say("Going back.", { silent: true }); });
  add("wc-forward", T(/^go forward$|^forward$|^next page$|^aage jao$/), (m, c) => { history.forward(); return c.say("Going forward.", { silent: true }); });
  add("wc-reload", T(/^(?:reload|refresh)(?: (?:the )?page)?$|^page (?:reload|refresh) karo$/), (m, c) => { c.say("Reloading.", { silent: true }); setTimeout(() => location.reload(), 300); return Promise.resolve(); });
  add("wc-zoom", (t) => {
    const m = t.match(/^(?:zoom|make (?:the )?(?:text|page|everything)) ?(in|out|bigger|larger|smaller|reset|normal)$/) || t.match(/^(?:text|page|screen) (?:bara|bada|chota|chhota|normal) karo$/) || t.match(/^(zoom (?:in|out)|reset zoom)$/);
    if (!m) return null;
    const w = m[1] || t;
    return { d: /reset|normal/.test(w) ? 0 : /out|smaller|chota|chhota/.test(w) ? -1 : 1 };
  }, (m, c) => c.say(m.d === 0 ? `Zoom reset to ${setZoom(1)}%.` : `Zoom ${setZoom(zoom + m.d * 0.1)}%.`, { silent: true }));

  // ---- click by name or number
  add("wc-numbers", T(/^(?:show|display) (?:the )?numbers$|^number(?:s)? (?:dikhao|show)$|^label (?:the )?(?:buttons|links)$/),
    (m, c) => { const n = showNumbers(); return c.say(n ? `Showing ${n} numbers. Say "click" and a number.` : "I could not find anything to click here.", { silent: true }); });
  add("wc-numbers-off", T(/^(?:hide|remove|clear|close) (?:the )?numbers$|^numbers? (?:hatao|band karo)$/), (m, c) => { hideNumbers(); return c.say("Numbers hidden.", { silent: true }); });
  add("wc-click-num", (t) => { const m = t.match(/^(?:click|press|tap|open|select|choose)(?: on)?(?: (?:number|no|item))? (\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/); return m ? { n: toNum(m[1]) } : null; },
    (m, c) => {
      const list = (badges && badges._list) || clickables();
      const el = list[m.n - 1];
      hideNumbers();
      if (!el) return c.say(`There is no number ${m.n}. Say "show numbers" first.`, { silent: true });
      press(el);
      return c.say(`Clicked ${labelOf(el).slice(0, 40) || "number " + m.n}.`, { silent: true });
    });
  add("wc-click", (t) => {
    const m = t.match(/^(?:click|press|tap|hit|select|choose|activate)(?: on)?(?: the)? (.{2,40}?)(?: button| link| tab| option)?$/) || t.match(/^(.{2,40}?) (?:button |ko )?(?:dabao|click karo|press karo|tap karo|kholo)$/);
    if (!m || /^\d+$/.test(m[1]) || /^(?:it|that|this|here|enter|return|tab|escape|esc|space|backspace)$/.test(m[1])) return null;
    return { name: m[1] };
  }, (m, c) => {
    const el = findByName(m.name);
    if (!el) return c.say(`I can't see a button called "${m.name}" on this page. Try "show numbers".`, { silent: true });
    hideNumbers();
    const act = press(el);
    return c.say((act === "focus" ? "Focused " : "Clicked ") + (labelOf(el).slice(0, 40) || m.name) + ".", { silent: true });
  });

  // ---- typing by voice into whatever field is focused (or the message box)
  function field() {
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA)$/.test(a.tagName) || a.isContentEditable) && a.type !== "password") return a;
    return null;
  }
  function insert(el, text, replace) {
    el.focus();
    if (el.isContentEditable) { document.execCommand("insertText", false, text); return; }
    const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, replace ? text : el.value + text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  add("wc-type", (t, raw) => { const m = t.match(/^(?:type|write|dictate|likho|likh do)(?: in)?[: ]+(.{1,300})$/); return m ? { text: m[1] } : null; },
    (m, c) => {
      const el = field() || $("input") || $("text") || document.querySelector("#composer textarea, #composer input[type=text], textarea");
      if (!el) return c.say("Tap a text box first, then tell me what to type.", { silent: true });
      insert(el, (el.value && !el.isContentEditable ? " " : "") + m.text);
      return c.say("Typed.", { silent: true });
    });
  add("wc-clear", T(/^(?:clear|erase|empty) (?:the )?(?:field|box|text|input)$|^(?:field|box) (?:saaf|clear) karo$/),
    (m, c) => { const el = field() || $("input"); if (!el) return c.say("There is no text box selected.", { silent: true }); insert(el, "", true); return c.say("Cleared.", { silent: true }); });
  add("wc-key", (t) => { const m = t.match(/^(?:press |hit )(enter|return|tab|escape|esc|space|backspace)$/); return m ? { k: m[1] } : null; },
    (m, c) => {
      const el = document.activeElement || document.body;
      const key = { enter: "Enter", return: "Enter", tab: "Tab", escape: "Escape", esc: "Escape", space: " ", backspace: "Backspace" }[m.k];
      const ev = { key, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent("keydown", ev));
      if (key === "Enter" && el.form) { try { el.form.requestSubmit(); } catch {} }
      else if (key === "Enter" && /^(BUTTON|A|SUMMARY)$/.test(el.tagName)) el.click();
      else if (key === "Escape") { const d = document.querySelector("dialog[open]"); if (d) d.close(); else el.blur && el.blur(); }
      el.dispatchEvent(new KeyboardEvent("keyup", ev));
      return c.say("Done.", { silent: true });
    });

  // ---- reading the screen aloud
  add("wc-read-selection", T(/^read (?:the )?(?:selected|selection|highlighted)(?: text)?$|^(?:selected|highlighted) (?:text )?(?:padho|sunao)$/),
    (m, c) => { const s = String(getSelection() || "").trim(); return s ? c.say(s.slice(0, 1500)) : c.say("Nothing is selected.", { silent: true }); });
  add("wc-read-screen", T(/^(?:what(?:'s| is) on (?:the |my )?screen|what can i (?:click|say|do here)|list (?:the )?(?:buttons|options)|read (?:the )?(?:screen|buttons|options))$|^screen (?:par kya hai|padho|sunao)$/),
    (m, c) => {
      const names = [...new Set(clickables().map(labelOf).filter((x) => x && x.length < 40))].slice(0, 14);
      return c.say(names.length ? "You can say: " + names.join(", ") + "." : "I don't see any buttons here.");
    });

  // ---- page tools
  add("wc-copy-link", T(/^copy (?:the )?(?:page )?(?:link|url|address)$|^link copy karo$/), async (m, c) => c.say((await c.copy(location.href)) ? "Link copied." : "I could not copy it here.", { silent: true }));
  add("wc-print", T(/^print(?: this| the)? (?:page|chat|screen)$|^print karo$/), (m, c) => { c.say("Opening print.", { silent: true }); setTimeout(() => print(), 300); return Promise.resolve(); });
  add("wc-fullscreen", T(/^(?:go )?full ?screen$|^(?:enter|exit|leave) full ?screen$|^full ?screen (?:karo|on|off)$/),
    (m, c) => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); return c.say("Toggled fullscreen.", { silent: true }); });
  add("wc-export-memory", T(/^(?:download|export|save|back ?up) (?:my |all )?(?:memory|memories)$|^(?:meri )?memory (?:download|export|save) karo$/),
    async (m, c) => {
      const app = window.AegisApp || {};
      if (!app.token || !app.apiBase && !app.wsUrl) return c.say("Log in to the server first, then I can export your memory.", { silent: true });
      try {
        const base = app.apiBase || location.origin;
        const r = await fetch(base + "/api/memory/export", { headers: { Authorization: "Bearer " + app.token } });
        if (!r.ok) throw new Error();
        download("aegis-memory.json", await r.text(), "application/json");
        return c.say("Your memory file is downloading.");
      } catch { return c.say("I could not export your memory right now."); }
    });
  add("wc-save-chat", T(/^(?:download|export|save) (?:this |the |my )?(?:chat|conversation)$/), (m, c) => {
    const lines = Array.from(document.querySelectorAll("#messages .msg")).map((n) => (n.classList.contains("user") ? "You: " : "Aegis: ") + n.innerText.trim());
    if (!lines.length) return c.say("There is no conversation to save yet.", { silent: true });
    download("aegis-chat.txt", lines.join("\n\n"));
    return c.say("Chat saved as a file.", { silent: true });
  });

  // The matcher passes only the normalised text; keep the (t, raw) signature simple by wrapping.
  const wrapped = C.map((e) => ({ name: e.name, test: (t) => e.test(t), run: e.run }));
  if (window.AegisCommands && AegisCommands.extend) AegisCommands.extend(wrapped, { first: true });

  // ------------------------------------------------------------------ Settings: Browser control card
  function connectionCode() {
    const app = window.AegisApp || {};
    const server = (app.apiBase || location.origin || "").replace(/\/+$/, "");
    if (!app.token || !/^https?:/i.test(server)) return "";
    return btoa(JSON.stringify({ s: server, t: app.token }));
  }
  function mountCard() {
    const dlg = $("settings");
    if (!dlg || $("browser-ctl")) return;
    const box = document.createElement("div");
    box.className = "set-group";
    box.id = "browser-ctl";
    box.innerHTML = '<h4>Browser control</h4>' +
      '<p class="muted small">Let Aegis use your real browser by voice: open sites, read them, click, type, scroll and play YouTube, with your own sign-ins. Install the <b>Aegis Web Hands</b> extension (see the <code>extension</code> folder, or <a href="downloads/aegis-web-hands.zip">download it</a>), then copy the code below into it.</p>' +
      '<div class="row"><span class="label">Extension</span><span id="browser-pill" class="pill off">Not connected</span></div>' +
      '<button id="browser-code" class="btn ghost small-btn" type="button">Copy connection code</button>' +
      '<p class="muted small">The code contains your login. Do not share it.</p>';
    const first = dlg.querySelector(".set-group");
    if (first) first.parentNode.insertBefore(box, first); else dlg.appendChild(box);
    $("browser-code").addEventListener("click", async () => {
      const code = connectionCode();
      const toast = (window.AegisApp && AegisApp.toast) || (() => {});
      if (!code) return toast("Log in to your Aegis server first.");
      try { await navigator.clipboard.writeText(code); toast("Connection code copied. Paste it into the extension."); }
      catch { window.prompt("Copy this connection code:", code); }
    });
  }
  function setBrowser(on) {
    const p = $("browser-pill");
    if (!p) return;
    p.textContent = on ? "Connected" : "Not connected";
    p.className = "pill " + (on ? "on" : "off");
  }
  window.addEventListener("aegis:status", (e) => setBrowser(!!(e.detail && e.detail.browser)));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountCard); else mountCard();

  window.AegisWebCtl = { findByName, clickables, showNumbers, hideNumbers, setZoom, connectionCode, commands: wrapped };
})();

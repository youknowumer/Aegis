"use strict";
/**
 * Aegis Web Hands: the browser-side tools. Same names, arguments and answers as the desktop app's Chrome control
 * (desktop/browser.js), so the AI uses them the same way, but here they run inside the user's own browser through
 * the extension APIs (tabs + scripting), with their own sign-ins.
 *
 * Safety (identical rules):
 *  - only http(s) pages can be opened
 *  - password fields are never typed into
 *  - clicks that look like buying, sending, posting, deleting or accepting need the user's approval
 *  - running your own JavaScript always needs approval (the server asks)
 * Limits of a browser extension: top frame only, no chrome:// pages, key presses are synthetic events,
 * and the full-page screenshot is the visible area.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AegisWebTools = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const SENSITIVE = /\b(buy|buy now|purchase|pay|pay now|payment|checkout|check out|place (?:your )?order|order now|complete (?:order|purchase)|subscribe|upgrade|donate|delete|remove|erase|discard|confirm|submit|send|post|publish|tweet|reply|share|transfer|withdraw|deposit|sign out|log out|logout|unsubscribe|cancel (?:order|subscription|booking)|deactivate|close account|accept|agree|authorize|grant|install|download|apply now|book now|reserve|invite|follow|block|report)\b/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const trim = (s, n) => (s.length > n ? s.slice(0, n) + "\n...(cut)" : s);
  const need = (what) => `NEEDS_APPROVAL: ${what} Ask the user, then call this tool again with approved=true (the user will get an approval prompt).`;

  function allowedUrl(raw) {
    let u = String(raw || "").trim();
    if (!u) throw new Error("missing url");
    if (/^(?:javascript|data|file|blob|vbscript|view-source|chrome-extension|moz-extension|chrome|edge|about|ftp):/i.test(u)) throw new Error("only http(s) pages can be opened");
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    const parsed = new URL(u);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("only http(s) pages can be opened");
    return parsed.toString();
  }

  // ---------------------------------------------------------------- functions that run INSIDE the page (self-contained: no closures)
  const PAGE = {
    mark(filter) {
      document.querySelectorAll("[data-aegis-i]").forEach((e) => e.removeAttribute("data-aegis-i"));
      const sel = "a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=option],[contenteditable=''],[contenteditable=true],[onclick],[tabindex]:not([tabindex='-1'])";
      const seen = new Set(), items = [];
      const vh = window.innerHeight, vw = window.innerWidth;
      const f = String(filter || "").toLowerCase();
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
        if (el.type === "hidden") continue;
        const text = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 80);
        const label = el.labels && el.labels[0] ? el.labels[0].innerText.replace(/\s+/g, " ").trim().slice(0, 60) : "";
        const kind = el.tagName === "A" ? "link" : el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "INPUT" ? ("input:" + (el.type || "text")) : (el.getAttribute("role") || el.tagName.toLowerCase());
        const d = { kind, text: text || label || el.placeholder || el.name || "", y: r.top };
        if (label && label !== d.text) d.label = label;
        if (el.placeholder) d.placeholder = el.placeholder.slice(0, 50);
        if (el.tagName === "A") d.href = (el.href || "").slice(0, 100);
        if (el.type === "checkbox" || el.type === "radio") d.checked = !!el.checked;
        if (el.tagName === "SELECT") d.options = Array.from(el.options).slice(0, 12).map((o) => o.text.trim().slice(0, 30));
        if (["INPUT", "TEXTAREA"].includes(el.tagName) && el.value && el.type !== "password") d.value = String(el.value).slice(0, 40);
        if (el.disabled) d.disabled = true;
        d.inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
        if (f && !(d.text + " " + (d.label || "") + " " + (d.placeholder || "") + " " + (d.href || "")).toLowerCase().includes(f)) continue;
        items.push({ el, d });
        if (items.length >= 400) break;
      }
      items.sort((a, b) => (b.d.inView - a.d.inView) || (a.d.y - b.d.y));
      return items.slice(0, 120).map((x, i) => { x.el.setAttribute("data-aegis-i", String(i + 1)); const { y, ...rest } = x.d; return { i: i + 1, ...rest }; });
    },

    media: async (action, value) => {
      const vs = Array.from(document.querySelectorAll("video,audio"));
      const v = vs.find((x) => !x.paused) || vs.sort((a, b) => (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight))[0];
      const a = String(action || "").toLowerCase(), val = String(value || "").toLowerCase();
      const click = (sel) => { const b = document.querySelector(sel); if (b) { b.click(); return true; } return false; };
      if (a === "next") return click(".ytp-next-button") ? { msg: "Next video." } : { error: "there is no next-video button here" };
      if (a === "captions") return click(".ytp-subtitles-button") ? { msg: "Toggled captions." } : { error: "this player has no captions button" };
      if (!v) return { error: "there is no video or audio on this page" };
      if (a === "play") { try { await v.play(); } catch (e) { return { error: "the browser blocked playback until you press play once" }; } return { msg: "Playing." }; }
      if (a === "pause") { v.pause(); return { msg: "Paused." }; }
      if (a === "mute") { v.muted = true; return { msg: "Muted." }; }
      if (a === "unmute") { v.muted = false; return { msg: "Unmuted." }; }
      if (a === "seek") { const s = parseFloat(val); if (!isFinite(s)) return { error: "seek needs a number of seconds" }; v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + s)); return { msg: (s >= 0 ? "Skipped ahead " : "Went back ") + Math.abs(Math.round(s)) + " seconds." }; }
      if (a === "speed") { const s = parseFloat(val); if (!isFinite(s)) return { error: "speed needs a number like 1.5" }; v.playbackRate = Math.max(0.25, Math.min(4, s)); return { msg: "Speed " + v.playbackRate + "x." }; }
      if (a === "volume") {
        if (val === "up") v.volume = Math.min(1, v.volume + 0.15);
        else if (val === "down") v.volume = Math.max(0, v.volume - 0.15);
        else { const n = parseFloat(val); if (!isFinite(n)) return { error: "volume needs up, down or a number 0-100" }; v.volume = Math.max(0, Math.min(1, n / 100)); }
        v.muted = false;
        return { msg: "Volume " + Math.round(v.volume * 100) + " percent." };
      }
      if (a === "fullscreen") {
        try { if (document.fullscreenElement) await document.exitFullscreen(); else await (v.closest(".html5-video-player") || v).requestFullscreen(); return { msg: "Toggled fullscreen." }; }
        catch (e) { return { error: "the browser only allows fullscreen from a real key press: press F in the video" }; }
      }
      return { error: "unknown media action " + a };
    },

    badges: (on) => {
      document.querySelectorAll("[data-aegis-badges]").forEach((e) => e.remove());
      if (!on) return 0;
      const box = document.createElement("div");
      box.setAttribute("data-aegis-badges", "1");
      box.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
      let n = 0;
      document.querySelectorAll("[data-aegis-i]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
        const b = document.createElement("span");
        b.textContent = el.getAttribute("data-aegis-i");
        b.style.cssText = `position:fixed;left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top)}px;background:#f59e0b;color:#111;font:700 11px/1 system-ui;padding:2px 5px;border-radius:6px;box-shadow:0 1px 4px #0008`;
        box.appendChild(b); n++;
      });
      document.documentElement.appendChild(box);
      return n;
    },

    resolve(q) {
      let el = null;
      if (q.index != null) el = document.querySelector(`[data-aegis-i="${Number(q.index)}"]`);
      else if (!q.selector && !q.text) {
        const ae = document.activeElement;
        el = ae && ae !== document.body && (/^(INPUT|TEXTAREA)$/.test(ae.tagName) || ae.isContentEditable) ? ae
          : Array.from(document.querySelectorAll("input[type=search],input[type=text],input:not([type]),textarea,[contenteditable=true]")).find((e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 8 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).visibility !== "hidden"; }) || null;
      }
      else if (q.selector) { try { el = document.querySelector(q.selector); } catch (e) { return { error: "that CSS selector is not valid" }; } }
      else if (q.text) {
        const t = String(q.text).toLowerCase();
        const cands = Array.from(document.querySelectorAll("a,button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[onclick],h1,h2,h3,li,span,div,p")).filter((e) => {
          const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
          const own = (e.innerText || e.value || e.getAttribute("aria-label") || e.placeholder || e.title || "").replace(/\s+/g, " ").trim().toLowerCase();
          return own && own.includes(t) && own.length <= t.length + 40;
        });
        const rank = (e) => (/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(e.tagName) || e.getAttribute("role") ? 0 : 1) * 1000 + (e.innerText || e.value || "").length;
        cands.sort((a, b) => rank(a) - rank(b));
        el = cands[0] || null;
      }
      if (!el) return { error: "I couldn't find that element. Call chrome_elements to see what is on the page (the numbers change after the page changes)." };
      if (el.tagName === "LABEL" && el.control) el = el.control;
      el.scrollIntoView({ block: "center", inline: "center" });
      document.querySelectorAll("[data-aegis-target]").forEach((e) => e.removeAttribute("data-aegis-target"));
      el.setAttribute("data-aegis-target", "1");
      const label = (el.innerText || el.value || el.getAttribute("aria-label") || el.title || el.placeholder || el.name || el.tagName).replace(/\s+/g, " ").trim().slice(0, 80);
      return { tag: el.tagName, type: el.type || "", label, href: el.href || "", form: el.form ? (el.form.action || "") : "", disabled: !!el.disabled, editable: !!el.isContentEditable };
    },

    click(double) {
      const el = document.querySelector("[data-aegis-target]");
      if (!el) return { error: "element lost" };
      const r = el.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
      try { el.focus({ preventScroll: true }); } catch (e) {}
      for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(new (t.startsWith("pointer") ? PointerEvent : MouseEvent)(t, o));
      el.click();
      if (double) { el.click(); el.dispatchEvent(new MouseEvent("dblclick", o)); }
      return { ok: true };
    },

    type(text, clear) {
      const el = document.querySelector("[data-aegis-target]");
      if (!el) return { error: "element lost" };
      el.focus();
      if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) {
        const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(el, (clear ? "" : el.value) + text);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (el.isContentEditable) {
        if (clear) { const s = getSelection(), r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); }
        document.execCommand("insertText", false, text);
      } else return { error: "not a text field" };
      return { ok: true };
    },

    select(value) {
      const el = document.querySelector("[data-aegis-target]");
      if (!el || el.tagName !== "SELECT") return { error: "not a dropdown" };
      const v = String(value).toLowerCase();
      const o = Array.from(el.options).find((x) => x.text.trim().toLowerCase() === v || x.value.toLowerCase() === v) || Array.from(el.options).find((x) => x.text.toLowerCase().includes(v));
      if (!o) return { error: "no option matches. Options: " + Array.from(el.options).slice(0, 15).map((x) => x.text.trim()).join(" | ") };
      el.value = o.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, chose: o.text.trim() };
    },

    text() {
      const t = (document.body && document.body.innerText) || "";
      return { title: document.title, url: location.href, text: t.replace(/\n{3,}/g, "\n\n").trim() };
    },

    scroll(dir, pages) {
      const h = window.innerHeight * 0.85;
      if (dir === "top") window.scrollTo(0, 0);
      else if (dir === "bottom") window.scrollTo(0, document.documentElement.scrollHeight);
      else window.scrollBy(0, (dir === "up" ? -1 : 1) * h * pages);
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      return { pct: Math.round((window.scrollY / max) * 100), atEnd: window.scrollY >= max - 2 };
    },

    find(q) {
      const body = document.body.innerText, low = body.toLowerCase(), n = q.toLowerCase();
      const out = []; let i = 0, count = 0;
      while ((i = low.indexOf(n, i)) !== -1) { count++; if (out.length < 8) out.push(body.slice(Math.max(0, i - 60), i + n.length + 80).replace(/\s+/g, " ")); i += n.length; }
      return { count, out };
    },

    waitFor(t, s) {
      try { return !!((s && document.querySelector(s)) || (t && document.body.innerText.toLowerCase().includes(String(t).toLowerCase()))); } catch (e) { return false; }
    },

    // Synthetic keys: they reach the page's own handlers, and the common ones also do what the real key does.
    key(combo) {
      const parts = String(combo || "").toLowerCase().split("+").map((s) => s.trim()).filter(Boolean);
      const main = parts.pop();
      const mods = { ctrlKey: parts.includes("ctrl") || parts.includes("control"), altKey: parts.includes("alt"), shiftKey: parts.includes("shift"), metaKey: parts.includes("meta") || parts.includes("cmd") };
      const NAMES = { enter: "Enter", tab: "Tab", escape: "Escape", esc: "Escape", backspace: "Backspace", delete: "Delete", space: " ", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
        arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight", pageup: "PageUp", pagedown: "PageDown", home: "Home", end: "End" };
      const key = NAMES[main] || (main && main.length === 1 ? main : /^f([1-9]|1[0-2])$/.test(main) ? main.toUpperCase() : null);
      if (!key) return { error: `unknown key "${main}"` };
      const el = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
      const init = Object.assign({ key, bubbles: true, cancelable: true }, mods);
      const down = el.dispatchEvent(new KeyboardEvent("keydown", init));
      if (key.length === 1 || key === "Enter") el.dispatchEvent(new KeyboardEvent("keypress", init));
      if (down) {
        const h = window.innerHeight * 0.85;
        const editable = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
        if (key === "Enter" && el.tagName === "INPUT" && el.form) { try { el.form.requestSubmit(); } catch (e) { el.form.submit(); } }
        else if (key === "Enter" && /^(BUTTON|A|SUMMARY)$/.test(el.tagName)) el.click();
        else if (key === "PageDown" || (key === " " && !editable)) window.scrollBy(0, h);
        else if (key === "PageUp") window.scrollBy(0, -h);
        else if (key === "Home" && !editable) window.scrollTo(0, 0);
        else if (key === "End" && !editable) window.scrollTo(0, document.documentElement.scrollHeight);
        else if (key === "ArrowDown" && !editable) window.scrollBy(0, 60);
        else if (key === "ArrowUp" && !editable) window.scrollBy(0, -60);
        else if (key === "Escape") { if (document.activeElement) document.activeElement.blur(); }
        else if (key === "Tab") {
          const f = Array.from(document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])")).filter((x) => !x.disabled && x.getBoundingClientRect().width > 0);
          const i = f.indexOf(document.activeElement), n = f[(i + (mods.shiftKey ? -1 : 1) + f.length) % f.length];
          if (n) n.focus();
        } else if (key.toLowerCase() === "a" && mods.ctrlKey && /^(INPUT|TEXTAREA)$/.test(el.tagName)) el.select();
      }
      el.dispatchEvent(new KeyboardEvent("keyup", init));
      return { ok: true };
    },

    ytResults() {
      const out = [];
      for (const a of document.querySelectorAll("ytd-video-renderer a#video-title")) {
        if (a.closest("ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer")) continue;
        out.push({ href: a.getAttribute("href") || "", title: a.getAttribute("title") || a.textContent || "" });
        if (out.length >= 8) break;
      }
      return { host: location.hostname, results: out };
    },

    playVideo() {
      const v = document.querySelector("video");
      if (!v) return null;
      if (v.paused) { try { v.play(); } catch (e) {} }
      return { paused: v.paused, ad: !!document.querySelector(".ad-showing"), title: document.title.replace(/ - YouTube$/, "") };
    },
  };

  function pickYoutubeResult(list) {
    for (const r of Array.isArray(list) ? list : []) {
      if (r && typeof r.href === "string" && /^\/watch\?v=[\w-]{6,20}(?:&|$)/.test(r.href)) return { title: String(r.title || "").trim(), url: "https://www.youtube.com" + r.href };
    }
    return null;
  }

  // ---------------------------------------------------------------- the tools, built on a `chrome` API object (so tests can pass a fake)
  function createTools(chrome, store) {
    const state = store || { activeId: null };

    async function listTabs() {
      const tabs = (await chrome.tabs.query({})).filter((t) => t.id != null);
      tabs.sort((a, b) => a.windowId - b.windowId || a.index - b.index);
      return tabs;
    }
    async function resolveTab(spec) {
      const list = await listTabs();
      if (!list.length) throw new Error("the browser has no open tabs");
      if (spec != null && spec !== "") {
        const n = Number(spec);
        if (Number.isInteger(n) && String(spec).trim() === String(n)) { if (n < 1 || n > list.length) throw new Error(`there is no tab ${n}; there are ${list.length}`); return list[n - 1]; }
        const q = String(spec).toLowerCase();
        const hit = list.find((t) => (t.title || "").toLowerCase().includes(q) || (t.url || "").toLowerCase().includes(q));
        if (!hit) throw new Error(`no tab matches "${spec}"`);
        return hit;
      }
      return list.find((t) => t.id === state.activeId) || list.find((t) => t.active && /^https?:/.test(t.url || "")) || list.find((t) => /^https?:/.test(t.url || "")) || list[0];
    }
    async function pick(spec) {
      const t = await resolveTab(spec);
      if (spec != null && spec !== "") state.activeId = t.id;
      else if (state.activeId == null) state.activeId = t.id;
      return t;
    }
    async function run(tabId, func, ...args) {
      let res;
      try { res = await chrome.scripting.executeScript({ target: { tabId }, func, args }); }
      catch (e) { throw new Error(/cannot access|extensions gallery|chrome:|edge:|about:|error page/i.test(String(e && e.message)) ? "this page cannot be controlled (browser pages, the extension store and error pages are protected). Open a normal website first." : (e && e.message) || "script error"); }
      const r = res && res[0];
      if (r && r.error) throw new Error(r.error.message || "script error");
      return r ? r.result : undefined;
    }
    async function waitComplete(tabId, ms = 20000) {
      const t0 = Date.now();
      await sleep(150);
      while (Date.now() - t0 < ms) {
        try { const t = await chrome.tabs.get(tabId); if (t.status === "complete") return true; } catch (e) { return false; }
        await sleep(200);
      }
      return false;
    }
    async function describe(tabId) {
      const t = await chrome.tabs.get(tabId);
      return `${t.title || "(untitled)"} — ${t.url || ""}`;
    }
    async function focusTab(t) {
      await chrome.tabs.update(t.id, { active: true });
      try { await chrome.windows.update(t.windowId, { focused: true }); } catch (e) {}
    }

    const tools = {
      async chrome_tabs() {
        const list = await listTabs();
        if (!list.length) return "The browser has no tabs.";
        const cur = await resolveTab();
        return list.map((t, i) => `${i + 1}${t.id === cur.id ? "*" : " "} ${(t.title || "(untitled)").slice(0, 70)} — ${(t.url || "").slice(0, 100)}`).join("\n") + "\n(* = the tab Aegis is working in)";
      },

      async chrome_open({ url }) {
        const u = allowedUrl(url);
        const t = await chrome.tabs.create({ url: u, active: true });
        state.activeId = t.id;
        await waitComplete(t.id);
        return `Opened in a new tab: ${await describe(t.id)}`;
      },

      async chrome_go({ url, tab }) {
        const u = allowedUrl(url);
        const t = await pick(tab);
        await chrome.tabs.update(t.id, { url: u });
        await waitComplete(t.id);
        return `Now at: ${await describe(t.id)}`;
      },

      async chrome_nav({ action, tab }) {
        const a = String(action || "").toLowerCase();
        const t = await pick(tab);
        if (a === "reload" || a === "refresh") await chrome.tabs.reload(t.id);
        else if (a === "back") { try { await chrome.tabs.goBack(t.id); } catch (e) { return "There is no page to go back to."; } }
        else if (a === "forward") { try { await chrome.tabs.goForward(t.id); } catch (e) { return "There is no page to go forward to."; } }
        else throw new Error("action must be back, forward or reload");
        await waitComplete(t.id);
        return `${a}: ${await describe(t.id)}`;
      },

      async chrome_switch({ tab }) {
        const t = await resolveTab(tab);
        state.activeId = t.id;
        await focusTab(t);
        return `Switched to: ${t.title || "(untitled)"} — ${t.url}`;
      },

      async chrome_close({ tab }) {
        const t = await resolveTab(tab);
        await chrome.tabs.remove(t.id);
        if (state.activeId === t.id) state.activeId = null;
        return `Closed: ${t.title || t.url}`;
      },

      async chrome_read({ page, tab }) {
        const t = await pick(tab);
        const p = await run(t.id, PAGE.text);
        const size = 8000, total = Math.max(1, Math.ceil(p.text.length / size)), n = Math.min(total, Math.max(1, Number(page) || 1));
        return `${p.title}\n${p.url}\n(page ${n} of ${total})\n\n${p.text.slice((n - 1) * size, n * size) || "(the page has no readable text)"}`;
      },

      async chrome_elements({ filter, tab, badges, hide }) {
        const t = await pick(tab);
        if (hide) { await run(t.id, PAGE.badges, false); return "Numbers hidden."; }
        const els = await run(t.id, PAGE.mark, filter || "");
        if (badges) await run(t.id, PAGE.badges, true);
        if (!els.length) return "No clickable or editable elements found" + (filter ? ` matching "${filter}"` : "") + ". Try chrome_read or scroll.";
        const line = (e) => `${e.i} [${e.kind}${e.disabled ? ", disabled" : ""}${e.checked != null ? (e.checked ? ", checked" : ", unchecked") : ""}${e.inView ? "" : ", off-screen"}] ${e.text}` +
          (e.label ? ` (label: ${e.label})` : "") + (e.placeholder ? ` (placeholder: ${e.placeholder})` : "") + (e.value ? ` = "${e.value}"` : "") + (e.options ? ` {${e.options.join(" | ")}}` : "") + (e.href ? ` → ${e.href}` : "");
        return `${await describe(t.id)}\n` + els.map(line).join("\n") + "\n(Use these numbers with chrome_click / chrome_type. They are only valid until the page changes.)";
      },

      async chrome_click({ index, selector, text, approved, double, tab }) {
        const t = await pick(tab);
        const r = await run(t.id, PAGE.resolve, { index, selector, text });
        if (r.error) throw new Error(r.error);
        if (r.disabled) throw new Error(`"${r.label}" is disabled`);
        if (!approved && (SENSITIVE.test(r.label) || (r.type === "submit" && SENSITIVE.test(r.label + " " + r.form)))) {
          return need(`Clicking "${r.label}" looks like it could buy, send, post, delete or accept something.`);
        }
        const c = await run(t.id, PAGE.click, !!double);
        if (c && c.error) throw new Error(c.error);
        await sleep(400);
        await waitComplete(t.id, 8000);
        return `Clicked "${r.label}". Now: ${await describe(t.id)}`;
      },

      async chrome_type({ text, index, selector, field, clear, submit, tab }) {
        const t = await pick(tab);
        const typed = String(text ?? "");
        const r = await run(t.id, PAGE.resolve, { index, selector, text: field });
        if (r.error) throw new Error(r.error);
        if (r.type === "password") throw new Error("I never type into password fields. Please type the password yourself, then tell me to continue.");
        if (r.tag === "SELECT") {
          const s = await run(t.id, PAGE.select, typed);
          if (s.error) throw new Error(s.error);
          return `Chose "${s.chose}" in the dropdown "${r.label}".`;
        }
        if (r.tag === "INPUT" && /^(checkbox|radio|button|submit|file|image|reset)$/.test(r.type)) throw new Error(`that is a ${r.type}, not a text field. Use chrome_click.`);
        if (!/^(INPUT|TEXTAREA)$/.test(r.tag) && !r.editable) throw new Error(`"${r.label}" is not something I can type into`);
        if (!typed && !submit) throw new Error("nothing to type");
        if (typed) { const w = await run(t.id, PAGE.type, typed, clear !== false); if (w && w.error) throw new Error(w.error); }
        if (submit) { await run(t.id, PAGE.key, "enter"); await sleep(500); await waitComplete(t.id, 8000); }
        return `Typed ${typed.length} characters into "${r.label}"${submit ? " and pressed Enter. Now: " + (await describe(t.id)) : "."}`;
      },

      async chrome_key({ keys, approved, tab }) {
        const t = await pick(tab);
        if (/(?:ctrl|cmd|meta|control)\s*\+\s*enter/i.test(keys || "") && !approved) return need(`${keys} usually sends or submits what is on the page.`);
        const r = await run(t.id, PAGE.key, String(keys || ""));
        if (r && r.error) throw new Error(r.error);
        await sleep(200);
        return `Pressed ${keys}.`;
      },

      async chrome_scroll({ direction, amount, tab }) {
        const t = await pick(tab);
        const d = String(direction || "down").toLowerCase();
        const r = await run(t.id, PAGE.scroll, d, Math.max(0.1, Math.min(10, Number(amount) || 1)));
        await sleep(250);
        return `Scrolled ${d}: now ${r.pct}% down the page${r.atEnd ? " (the end)" : ""}.`;
      },

      async chrome_find({ text, tab }) {
        if (!String(text || "").trim()) throw new Error("nothing to search for");
        const t = await pick(tab);
        const r = await run(t.id, PAGE.find, String(text));
        return r.count ? `Found ${r.count} match${r.count > 1 ? "es" : ""}:\n` + r.out.map((s, i) => `${i + 1}. …${s}…`).join("\n") : `"${text}" is not on this page.`;
      },

      async chrome_wait({ ms, text, selector, tab }) {
        const t = await pick(tab);
        if (!text && !selector) { const n = Math.max(0, Math.min(30000, Number(ms) || 1000)); await sleep(n); return `Waited ${n} ms.`; }
        const limit = Math.max(1000, Math.min(30000, Number(ms) || 15000)), t0 = Date.now();
        while (Date.now() - t0 < limit) {
          if (await run(t.id, PAGE.waitFor, text || "", selector || "")) return `It appeared after ${Math.round((Date.now() - t0) / 100) / 10} s.`;
          await sleep(300);
        }
        return `Still not there after ${Math.round(limit / 1000)} s.`;
      },

      async chrome_screenshot({ full_page, tab }) {
        const t = await pick(tab);
        await focusTab(t);
        await sleep(250);
        const data = await chrome.tabs.captureVisibleTab(t.windowId, { format: "png" });
        const name = `Aegis/aegis_chrome_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
        await chrome.downloads.download({ url: data, filename: name, conflictAction: "uniquify" });
        return `Screenshot of "${await describe(t.id)}" saved to your Downloads folder as ${name}` + (full_page ? " (a browser extension can only capture the visible part of the page)." : ".");
      },

      async chrome_youtube_play({ query }) {
        const q = String(query || "").replace(/\s+/g, " ").trim();
        if (!q) throw new Error("say which song or video to play");
        if (q.length > 200) throw new Error("that search is too long");
        const list = await listTabs();
        let t = list.find((p) => /^https?:\/\/(?:www\.)?youtube\.com\//i.test(p.url || ""));
        if (!t) t = await chrome.tabs.create({ url: "about:blank", active: true });
        state.activeId = t.id;
        await focusTab(t);
        const go = async (url) => { await chrome.tabs.update(t.id, { url }); await waitComplete(t.id); };
        await go("https://www.youtube.com/results?search_query=" + encodeURIComponent(q));
        let found = null;
        for (let i = 0; i < 40 && !found; i++) {
          const r = await run(t.id, PAGE.ytResults);
          if (r && /^consent\./.test(r.host)) return "YouTube is showing its cookie notice. Click Accept or Reject there once, then ask me again.";
          found = pickYoutubeResult(r && r.results);
          if (!found) await sleep(300);
        }
        if (!found) return `YouTube showed no playable video for "${q}". Try different words.`;
        await go(found.url);
        let st = null;
        for (let i = 0; i < 40 && !st; i++) { st = await run(t.id, PAGE.playVideo); if (!st) await sleep(250); }
        if (!st) return `Opened "${found.title}" (${found.url}) but the video player did not appear. Press play in the tab.`;
        await sleep(1200);
        st = (await run(t.id, PAGE.playVideo)) || st;
        return st.paused
          ? `Opened "${found.title}" on YouTube (${found.url}) but it is paused: the browser blocked autoplay. Press play in the tab.`
          : `Playing "${found.title}" on YouTube.${st.ad ? " An ad is playing first; the song starts right after it." : ""}`;
      },

      async chrome_media({ action, value, tab }) {
        const t = await pick(tab);
        const r = await run(t.id, PAGE.media, String(action || ""), String(value ?? ""));
        if (r && r.error) throw new Error(r.error);
        return (r && r.msg) || "Done.";
      },

      async chrome_eval({ js, tab }) {
        if (!String(js || "").trim()) throw new Error("no JavaScript given");
        const t = await pick(tab);
        const res = await chrome.scripting.executeScript({
          target: { tabId: t.id }, world: "MAIN", args: [String(js)],
          func: (code) => { try { const v = (0, eval)(code); return { v: typeof v === "string" ? v : JSON.stringify(v) }; } catch (e) { return { e: String(e) }; } },
        });
        const r = res && res[0] && res[0].result;
        if (!r) throw new Error("the page did not run the script");
        if (r.e) throw new Error(r.e + " (some sites block running scripts)");
        return trim(r.v === undefined ? "(no value)" : r.v, 4000);
      },
    };

    // the server only ever sends chrome_* names here; anything else is answered politely
    async function handle(name, args) {
      const fn = tools[name];
      if (!fn) return `Error: the browser extension can only run chrome_* tools, not ${name}. That needs the Aegis desktop app.`;
      try { return String(await fn(args && typeof args === "object" ? args : {})); }
      catch (e) { return "Error: " + ((e && e.message) || String(e)); }
    }
    return { tools, handle, state };
  }

  return { createTools, PAGE, allowedUrl, SENSITIVE, pickYoutubeResult };
});

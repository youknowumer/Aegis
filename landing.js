(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  $("year").textContent = new Date().getFullYear();

  // ---------- already signed in? point the buttons at the app ----------
  let signedIn = false;
  try { signedIn = !!localStorage.getItem("aegis_token"); } catch {}
  if (signedIn) {
    $("signin-link").textContent = "Open app";
    $("start-link").textContent = "Open app";
    $("start-link").href = "app.html";
  }

  // ---------- Windows download button (relative path: works on GitHub Pages sub-folders too) ----------
  fetch("downloads/Aegis-Setup.exe", { method: "HEAD" })
    .then((r) => {
      if (!r.ok) return;
      const b = $("dl-btn");
      b.textContent = "Download for Windows";
      b.classList.remove("disabled", "outline");
      b.classList.add("solid");
      b.setAttribute("aria-disabled", "false");
    })
    .catch(() => {});

  // ---------- hero demo: one short conversation that ends on an approval ----------
  const body = $("demo-body");
  const replay = $("replay");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };
  const add = (node) => {
    node.classList.add("enter");
    body.appendChild(node);
    return node;
  };

  function approval() {
    const box = el("div", "ask");
    box.appendChild(el("p", "ask-title", "Aegis wants to sort 23 files in Downloads"));
    box.appendChild(el("p", "ask-sub", "Images, Documents, Videos, Audio, Archives, Other"));
    const row = el("div", "ask-actions");
    const allow = el("button", "btn allow", "Allow");
    const deny = el("button", "btn deny", "Deny");
    allow.type = deny.type = "button";
    row.append(allow, deny);
    box.appendChild(row);

    const finish = (ok) => {
      box.className = "ask done" + (ok ? "" : " no");
      box.replaceChildren(
        el("p", "ask-title", ok ? "Allowed" : "Denied"),
        el("p", "ask-sub", ok ? "Sorting Downloads…" : "Nothing was changed.")
      );
      later(() => {
        add(el("div", "bubble ai",
          ok ? "Done. 23 files are now in Images, Documents, Videos, Audio and Archives."
             : "Okay, I left your Downloads folder as it was."));
        replay.hidden = false;
      }, reduce ? 0 : 600);
    };
    allow.addEventListener("click", () => finish(true));
    deny.addEventListener("click", () => finish(false));
    return box;
  }

  function play() {
    timers.forEach(clearTimeout);
    timers = [];
    replay.hidden = true;
    body.replaceChildren();
    const me = el("div", "bubble me", "Organize my Downloads folder");
    me.dir = "auto";
    const step = el("div", "step", "list_files · Downloads");
    if (reduce) {
      body.append(me, step, approval());
      return;
    }
    add(me);
    later(() => add(step), 700);
    later(() => add(approval()), 1500);
  }

  replay.addEventListener("click", play);
  play();
})();

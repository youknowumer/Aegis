(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  $("year").textContent = new Date().getFullYear();

  // ------------------------------------------------------------ account state
  let signedIn = false;
  try { signedIn = !!localStorage.getItem("aegis_token"); } catch {}
  if (signedIn) {
    $("signin-link").textContent = "Open app";
    $("start-link").textContent = "Open app";
    $("start-link").href = "app.html";
  }

  // Relative path, so it also works under github.io/<repo>/
  fetch("downloads/Aegis-Setup.exe", { method: "HEAD" })
    .then((r) => {
      if (!r.ok) return;
      const b = $("dl-btn");
      b.textContent = "Download for Windows";
      b.classList.remove("disabled", "glass");
      b.classList.add("solid");
      b.setAttribute("aria-disabled", "false");
    })
    .catch(() => {});

  // ------------------------------------------------------------ hero headline: words blur in once
  const h1 = document.querySelector(".hero h1");
  if (!reduce && h1) {
    const words = h1.textContent.trim().split(/\s+/);
    const nodes = [];
    words.forEach((w, i) => {
      const s = document.createElement("span");
      s.className = "w";
      s.style.setProperty("--i", i);
      s.textContent = w;
      nodes.push(s, document.createTextNode(" "));
    });
    h1.replaceChildren(...nodes);
  }

  // ------------------------------------------------------------ reveal on scroll (blur to sharp)
  document.querySelectorAll("[data-stagger]").forEach((box) => {
    [...box.children].forEach((kid, i) => {
      kid.setAttribute("data-reveal", "");
      kid.style.setProperty("--d", i * 80 + "ms");
    });
  });

  function countUp(el) {
    const end = Number(el.dataset.count);
    if (!end || reduce) return;
    const sep = el.dataset.sep;
    const t0 = performance.now();
    const dur = 1100;
    const fmt = (n) => (sep ? n.toLocaleString("en-US") : String(n));
    const tick = (now) => {
      const k = clamp((now - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(end * eased));
      if (k < 1) requestAnimationFrame(tick);
    };
    el.textContent = fmt(0);
    requestAnimationFrame(tick);
  }

  const revealables = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        e.target.querySelectorAll("[data-count]").forEach(countUp);
        if (e.target.matches("[data-count]")) countUp(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    revealables.forEach((el) => io.observe(el));

    // stats sit in the hero, so they are not revealed: count them when visible
    const sio = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.querySelectorAll("[data-count]").forEach(countUp);
        e.target.classList.add("in");
        sio.disconnect();
      });
    }, { threshold: 0.6 });
    const stats = document.querySelector(".stats");
    if (stats) sio.observe(stats);
  } else {
    revealables.forEach((el) => el.classList.add("in"));
  }

  // ------------------------------------------------------------ scroll-linked effects
  const nav = $("nav");
  const bar = $("progress");
  const heroSec = $("top");
  const steps = $("steps");
  const dock = $("dock");
  const dl = $("download");
  const blobs = [...document.querySelectorAll(".aurora i")];
  let ticking = false;

  function update() {
    ticking = false;
    const y = window.scrollY;
    nav.classList.toggle("scrolled", y > 8);

    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? clamp(y / max) : 0})`;

    if (!reduce) {
      // hero text and demo soften and drift as you scroll past, like a sheet going out of focus
      heroSec.style.setProperty("--p", clamp(y / (heroSec.offsetHeight * 0.7)).toFixed(3));
      blobs.forEach((b) => {
        const s = Number(b.dataset.speed) || 0;
        b.style.transform = `translate3d(0, ${(y * s).toFixed(1)}px, 0)`;
      });
    }

    // numbered line fills as the steps scroll through the viewport
    const r = steps.getBoundingClientRect();
    steps.style.setProperty("--sp", clamp((window.innerHeight * 0.85 - r.top) / (r.height + 120)).toFixed(3));

    // phone dock: after the hero, hidden once the download section is on screen
    const pastHero = y > heroSec.offsetHeight * 0.8;
    const dr = dl.getBoundingClientRect();
    const atDownload = dr.top < window.innerHeight * 0.85 && dr.bottom > 0;
    const show = pastHero && !atDownload;
    dock.classList.toggle("show", show);
    dock.setAttribute("aria-hidden", show ? "false" : "true");
    dock.querySelectorAll("a").forEach((a) => (a.tabIndex = show ? 0 : -1));
  }
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  update();

  // highlight the nav link of the section you are reading
  const links = [...document.querySelectorAll("#links a")];
  if ("IntersectionObserver" in window) {
    const targets = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
    const lio = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        links.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === "#" + e.target.id)));
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    targets.forEach((t) => lio.observe(t));
    const topIO = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) links.forEach((a) => a.setAttribute("aria-current", "false"));
    }, { threshold: 0.5 });
    topIO.observe(heroSec);
  }

  // ------------------------------------------------------------ demo: four short conversations
  const SCENES = [
    {
      user: "Organize my Downloads folder",
      steps: [["list_files", "Downloads", "Found 23 files"]],
      ask: { title: "Aegis wants to sort 23 files in Downloads", sub: "Into Images, Documents, Videos, Audio, Archives" },
      yes: { note: "Sorting Downloads…", reply: "Done. 23 files are now in Images, Documents, Videos, Audio and Archives.", viz: "sort" },
      no: { note: "Nothing was changed.", reply: "Okay, I left your Downloads folder as it was." },
    },
    {
      user: "Open Chrome and search for SpaceX launches",
      steps: [["open_app", "chrome", "Opened"], ["browser_search", "SpaceX launches", "Done"]],
      reply: "Done. I opened Chrome and searched for SpaceX launches.",
    },
    {
      user: "Mere sister ki birthday Friday ko hai, yaad rakhna",
      steps: [["remember", "Sister’s birthday is Friday", "Saved"]],
      reply: "Theek hai, yaad rakh liya.",
      viz: "memory",
    },
    {
      user: "میرا کمپیوٹر کیسا چل رہا ہے؟",
      steps: [["system_health", "", "Checked"]],
      reply: "آپ کا کمپیوٹر ٹھیک چل رہا ہے۔ ڈسک میں ابھی کافی جگہ ہے۔",
      viz: "health",
    },
  ];

  const body = $("demo-body");
  const seg = $("seg");
  const tabs = [...seg.querySelectorAll("button")];
  const replay = $("replay");
  const demoEl = $("demo");

  let runId = 0;
  let current = 0;
  let auto = true;
  let visible = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const put = (node) => {
    node.classList.add("enter");
    body.appendChild(node);
    body.scrollTop = body.scrollHeight;
    return node;
  };

  function setTab(i) {
    current = i;
    seg.style.setProperty("--i", i);
    tabs.forEach((t, k) => {
      t.setAttribute("aria-selected", String(k === i));
      t.tabIndex = k === i ? 0 : -1;
    });
  }

  async function typeInto(node, text, alive) {
    if (reduce) { node.textContent = text; return; }
    for (let k = 1; k <= text.length; k++) {
      if (!alive()) return;
      node.textContent = text.slice(0, k);
      await sleep(26);
    }
  }

  async function runStep(def, alive) {
    const [name, arg, res] = def;
    const s = el("div", "step");
    s.append(el("span", "spin"), el("code", "", name));
    if (arg) s.append(el("span", "arg", arg));
    s.append(el("span", "res", res));
    put(s);
    await sleep(800);
    if (!alive()) return;
    s.querySelector(".spin").replaceWith(el("span", "tick"));
    s.classList.add("done");
    await sleep(350);
  }

  function viz(kind) {
    const box = el("div", "viz");
    if (kind === "sort") {
      [["Images", 9], ["Documents", 7], ["Videos", 3], ["Audio", 2], ["Archives", 2]].forEach(([n, c]) => {
        const row = el("div", "viz-row");
        const bar = el("div", "bar"); const b = el("b"); b.dataset.w = Math.round((c / 9) * 100); bar.append(b);
        row.append(el("span", "", n), bar, el("span", "n", String(c)));
        box.append(row);
      });
    } else if (kind === "health") {
      [["CPU", 23], ["Memory", 61], ["Disk", 48]].forEach(([n, c]) => {
        const row = el("div", "viz-row");
        const bar = el("div", "bar"); const b = el("b"); b.dataset.w = c; bar.append(b);
        row.append(el("span", "", n), bar, el("span", "n", c + "%"));
        box.append(row);
      });
    } else if (kind === "memory") {
      const m = el("div", "mem");
      const t = el("div");
      t.append(el("span", "", "Sister’s birthday is Friday"), el("small", "", "Saved to your memory. You can delete it any time."));
      m.append(el("span", "pin", "✓"), t);
      box.append(m);
    }
    put(box);
    requestAnimationFrame(() => requestAnimationFrame(() =>
      box.querySelectorAll(".bar b").forEach((b) => (b.style.width = b.dataset.w + "%"))));
    return box;
  }

  function waitForDecision(box, alive) {
    return new Promise((resolve) => {
      const allow = box.querySelector(".allow");
      const deny = box.querySelector(".deny");
      const done = (v) => { auto = false; resolve(v); };
      allow.addEventListener("click", () => done(true));
      deny.addEventListener("click", () => done(false));
      // nobody clicking? show how it works by pressing Allow ourselves
      if (auto && !reduce) {
        setTimeout(() => {
          if (!alive() || !auto) return;
          allow.classList.add("press");
          setTimeout(() => { if (alive() && auto) resolve(true); }, 260);
        }, 4200);
      }
    });
  }

  async function run(i) {
    const id = ++runId;
    const alive = () => id === runId;
    setTab(i);
    body.replaceChildren();
    replay.hidden = true;
    const sc = SCENES[i];

    await sleep(350);
    if (!alive()) return;

    const me = el("div", "bubble me");
    me.dir = "auto";
    put(me);
    await typeInto(me, sc.user, alive);
    if (!alive()) return;
    await sleep(350);

    for (const st of sc.steps) {
      await runStep(st, alive);
      if (!alive()) return;
    }

    const answer = async (text, vizKind) => {
      const dots = put(el("div", "bubble ai typing"));
      dots.append(el("i"), el("i"), el("i"));
      await sleep(850);
      if (!alive()) return;
      const msg = el("div", "bubble ai", text);
      msg.dir = "auto";
      dots.replaceWith(msg);
      msg.classList.add("enter");
      body.scrollTop = body.scrollHeight;
      if (vizKind) { await sleep(250); if (alive()) viz(vizKind); }
    };

    if (sc.ask) {
      const box = el("div", "ask waiting");
      box.append(el("p", "ask-title", sc.ask.title), el("p", "ask-sub", sc.ask.sub));
      const row = el("div", "ask-actions");
      const allow = el("button", "btn allow", "Allow");
      const deny = el("button", "btn deny", "Deny");
      allow.type = deny.type = "button";
      row.append(allow, deny);
      box.append(row);
      put(box);

      const ok = await waitForDecision(box, alive);
      if (!alive()) return;
      const out = ok ? sc.yes : sc.no;
      box.className = "ask done" + (ok ? "" : " no");
      box.replaceChildren(el("p", "ask-title", ok ? "Allowed" : "Denied"), el("p", "ask-sub", out.note));
      await sleep(700);
      if (!alive()) return;
      await answer(out.reply, ok ? out.viz : null);
    } else {
      await answer(sc.reply, sc.viz);
    }
    if (!alive()) return;

    replay.hidden = false;
    if (auto && !reduce) {
      await sleep(4200);
      while (alive() && (!visible || document.hidden)) await new Promise((r) => setTimeout(r, 400));
      if (alive() && auto) run((i + 1) % SCENES.length);
    }
  }

  tabs.forEach((t, i) => {
    t.addEventListener("click", () => { auto = false; run(i); });
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const n = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      auto = false;
      tabs[n].focus();
      run(n);
    });
  });
  replay.addEventListener("click", () => { auto = false; run(current); });

  // start when the demo is on screen, and pause the loop while it is not
  if ("IntersectionObserver" in window) {
    let started = false;
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !started) { started = true; run(0); }
    }, { threshold: 0.25 }).observe(demoEl);
  } else {
    visible = true;
    run(0);
  }
})();

// ---- v3: manual theme toggle (remembered) + back-to-top
(() => {
  const root = document.documentElement;
  const btn = document.getElementById("theme-toggle");
  const isDark = () => {
    const t = root.getAttribute("data-theme");
    return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  };
  if (btn) btn.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("aegis_site_theme", next); } catch {}
  });
  const top = document.getElementById("to-top");
  if (top) {
    const upd = () => top.classList.toggle("show", window.scrollY > 900);
    window.addEventListener("scroll", upd, { passive: true }); upd();
    top.addEventListener("click", () => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  }
})();

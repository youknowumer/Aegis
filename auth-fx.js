// Sign-in screen details: live email check, caps-lock notice, password strength, sliding tab thumb, card light.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const email = $("email"), pw = $("password");
  if (!email || !pw) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // email: green tick once it looks right, gentle hint once the field is left
  const emailOk = () => /^\S+@\S+\.\S+$/.test(email.value.trim());
  const fld = (el) => el.closest(".fld");
  email.addEventListener("input", () => {
    fld(email).classList.toggle("valid", emailOk());
    if (emailOk()) { fld(email).classList.remove("invalid"); $("email-hint").textContent = ""; }
  });
  email.addEventListener("blur", () => {
    const bad = email.value.trim() !== "" && !emailOk();
    fld(email).classList.toggle("invalid", bad);
    $("email-hint").textContent = bad ? "That email does not look complete." : "";
  });

  // caps lock
  const caps = $("caps-hint");
  const capsCheck = (e) => { if (e.getModifierState) caps.hidden = !e.getModifierState("CapsLock"); };
  pw.addEventListener("keydown", capsCheck);
  pw.addEventListener("keyup", capsCheck);
  pw.addEventListener("blur", () => { caps.hidden = true; });

  // password strength (register only)
  const labels = ["Use 8 or more characters", "Weak", "Fair", "Good", "Strong"];
  const meter = $("strength");
  const rules = $("rules");
  function score(v) {
    const len = v.length >= 8, mix = /[A-Za-z]/.test(v) && /\d/.test(v), cs = /[a-z]/.test(v) && /[A-Z]/.test(v);
    const long = v.length >= 12 || /[^A-Za-z0-9]/.test(v);
    rules.querySelector('[data-rule="len"]').classList.toggle("ok", len);
    rules.querySelector('[data-rule="mix"]').classList.toggle("ok", mix);
    rules.querySelector('[data-rule="case"]').classList.toggle("ok", cs);
    if (!v) return 0;
    if (!len) return 1;
    return Math.min(4, 1 + (mix ? 1 : 0) + (cs ? 1 : 0) + (long ? 1 : 0));
  }
  pw.addEventListener("input", () => {
    const sc = score(pw.value);
    meter.dataset.level = sc;
    $("strength-text").textContent = pw.value && sc === 1 ? "Too short" : labels[sc];
  });
  document.addEventListener("aegis:authmode", () => { pw.dispatchEvent(new Event("input")); });

  // sliding thumb behind the active tab is pure CSS (data-mode); card light follows the pointer
  const card = $("auth-card");
  if (card && !reduce && window.matchMedia("(hover: hover)").matches) {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", e.clientX - r.left + "px");
      card.style.setProperty("--my", e.clientY - r.top + "px");
    }, { passive: true });
  }

  // ---------------------------------------------------------------- sign-up details (register mode only)
  const pw2 = $("password2"), terms = $("terms"), sug = $("email-suggest"), gen = $("pw-gen");
  const isReg = () => card0().dataset.mode === "register";
  function card0() { return $("auth-card"); }

  // 1) typo helper: gmial.com -> gmail.com
  const DOMAINS = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "live.com"];
  const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length]; };
  function suggest() {
    const v = email.value.trim(), at = v.indexOf("@");
    sug.hidden = true;
    if (!isReg() || at < 1) return;
    const dom = v.slice(at + 1).toLowerCase();
    if (dom.length < 4 || DOMAINS.includes(dom)) return;
    const best = DOMAINS.map((d) => [d, lev(dom, d)]).sort((a, b) => a[1] - b[1])[0];
    if (best && best[1] > 0 && best[1] <= 2) {
      sug.textContent = "Did you mean " + v.slice(0, at + 1) + best[0] + "?";
      sug.dataset.fix = v.slice(0, at + 1) + best[0];
      sug.hidden = false;
    }
  }
  email.addEventListener("input", suggest);
  email.addEventListener("blur", suggest);
  sug.addEventListener("click", () => { email.value = sug.dataset.fix; sug.hidden = true; email.dispatchEvent(new Event("input")); email.dispatchEvent(new Event("blur")); pw.focus(); });

  // 2) crack-time estimate (rough, honest: based on length and character mix)
  const crack = $("crack");
  function crackText(v) {
    if (!v) return "";
    let pool = 0;
    if (/[a-z]/.test(v)) pool += 26; if (/[A-Z]/.test(v)) pool += 26; if (/\d/.test(v)) pool += 10; if (/[^A-Za-z0-9]/.test(v)) pool += 32;
    const common = /^(password|12345678|qwerty|letmein|iloveyou|admin|welcome)/i.test(v);
    const secs = Math.pow(pool || 1, v.length) / 2 / 1e10;
    if (common || secs < 1) return "Guessable in seconds. Make it longer.";
    const u = [[31557600 * 1e3, "centuries"], [31557600, "years"], [86400, "days"], [3600, "hours"], [60, "minutes"]];
    if (secs > 31557600 * 1e3) return "Would take centuries to guess.";
    for (const [n, name] of u.slice(1)) if (secs >= n) return "About " + Math.round(secs / n).toLocaleString() + " " + name + " to guess.";
    return "Would take under a minute to guess.";
  }

  // 3) match indicator + sign-up checklist + progress
  const steps = $("reg-steps"), fill = $("reg-fill");
  const matchHint = $("match-hint");
  function checklist() {
    if (!isReg()) return;
    crack.textContent = crackText(pw.value);
    crack.hidden = !pw.value;
    const e = emailOk(), p = pw.value.length >= 8 && /[A-Za-z]/.test(pw.value) && /\d/.test(pw.value);
    const m = !!pw2.value && pw2.value === pw.value;
    const t = terms.checked;
    const f2 = fld(pw2);
    f2.classList.toggle("valid", m);
    f2.classList.toggle("invalid", !!pw2.value && !m && pw2.value.length >= pw.value.length);
    matchHint.textContent = f2.classList.contains("invalid") ? "Passwords do not match yet." : "";
    const done = { email: e, pw: p, match: m, terms: t };
    let n = 0;
    steps.querySelectorAll("li").forEach((li) => { const ok = done[li.dataset.step]; li.classList.toggle("ok", ok); if (ok) n++; });
    fill.style.transform = "scaleX(" + n / 4 + ")";
    steps.dataset.n = n;
  }
  [email, pw, pw2].forEach((el) => el.addEventListener("input", checklist));
  terms.addEventListener("change", checklist);
  document.addEventListener("aegis:authmode", () => { checklist(); suggest(); });

  // 4) password suggestion: readable passphrase-style, crypto-random
  const WORDS = ["amber","brook","cedar","delta","ember","flint","grove","harbor","iris","jade","kite","lunar","maple","north","olive","pearl","quartz","river","stone","tidal","umber","vivid","willow","xenon","yonder","zephyr","cobalt","dune","falcon","glacier","hazel","indigo"];
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  gen.addEventListener("click", () => {
    const sym = "!#$%*+-=?@"[rnd(10)];
    const v = [WORDS[rnd(32)], WORDS[rnd(32)], WORDS[rnd(32)]].map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join("-") + sym + (10 + rnd(90));
    pw.value = v; pw2.value = v;
    if (pw.type === "password") $("pw-toggle").click();
    pw.dispatchEvent(new Event("input")); pw2.dispatchEvent(new Event("input"));
    const note = $("gen-note");
    note.textContent = "Filled in both fields. Save it in your password manager.";
    gen.classList.remove("pop"); void gen.offsetWidth; gen.classList.add("pop");
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(v).then(() => { note.textContent = "Filled in and copied to your clipboard."; }).catch(() => {});
  });

  // 5) success burst around the card
  document.addEventListener("aegis:authok", () => {
    if (reduce || !card) return;
    const b = document.createElement("span"); b.className = "burst"; b.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 18; i++) { const d = document.createElement("i"); const a = (i / 18) * 6.283, r = 90 + Math.random() * 70;
      d.style.setProperty("--x", Math.cos(a) * r + "px"); d.style.setProperty("--y", Math.sin(a) * r + "px"); d.style.setProperty("--h", (170 + Math.random() * 40) | 0); b.appendChild(d); }
    card.appendChild(b); setTimeout(() => b.remove(), 1200);
  });
})();

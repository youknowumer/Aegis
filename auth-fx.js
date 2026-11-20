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
})();

/* Aegis landing: looping voice conversation + live meeting timer. Static when reduced motion is on. */
(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const vm = document.getElementById("vmock");
  const label = document.getElementById("vm-state");
  const T = { sleep: "Sleeping", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };
  const set = (s) => { if (!vm) return; vm.dataset.s = s; if (label) label.textContent = T[s]; };

  if (vm) {
    const msgs = [...vm.querySelectorAll(".m")];
    if (reduce) { msgs.forEach((m) => m.classList.add("show")); set("sleep"); }
    else {
      set("sleep");
      let on = false, timers = [];
      const at = (ms, fn) => timers.push(setTimeout(fn, ms));
      const run = () => {
        timers.forEach(clearTimeout); timers = [];
        msgs.forEach((m) => m.classList.remove("show")); set("sleep");
        at(600, () => { set("listening"); msgs[0].classList.add("show"); });
        at(1700, () => { set("speaking"); msgs[1].classList.add("show"); });
        at(3000, () => set("listening"));
        at(3400, () => msgs[2].classList.add("show"));
        at(4500, () => set("thinking"));
        at(5300, () => { set("speaking"); msgs[3].classList.add("show"); });
        at(9500, () => set("sleep"));
        at(11500, () => on && run());
      };
      new IntersectionObserver(([e]) => {
        const was = on; on = e.isIntersecting;
        if (on && !was) run();
        if (!on) { timers.forEach(clearTimeout); }
      }, { threshold: 0.35 }).observe(vm);
    }
  }

  const mt = document.getElementById("mtmock");
  const clock = document.getElementById("mt-time");
  if (mt && clock) {
    let t = 0, iv = null;
    const fmt = (n) => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
    clock.textContent = reduce ? "12:48" : fmt(744);
    if (!reduce) {
      new IntersectionObserver(([e]) => {
        if (e.isIntersecting && !iv) iv = setInterval(() => { t = (t + 1) % 3600; clock.textContent = fmt(t + 744); }, 1000);
        if (!e.isIntersecting && iv) { clearInterval(iv); iv = null; }
      }, { threshold: 0.2 }).observe(mt);
    }
  }
})();

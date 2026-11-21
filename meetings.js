// Aegis meeting assistant: record (or upload / paste), transcribe with Groq Whisper, and get notes:
// summary, important points, decisions, action items, enhancement ideas, risks, open questions, next steps.
//
//   AegisMeetings.open(tab?)  AegisMeetings.start()  AegisMeetings.stop()  AegisMeetings.pause()  AegisMeetings.resume()
//   AegisMeetings.state() -> "idle" | "recording" | "paused" | "working"
//   AegisMeetings.present(opts?)   Present mode: Aegis attends the running meeting silently (no voice, no replies, voice mode off).
//   AegisMeetings.extract()        "Extract the meeting points": ends the meeting, writes the notes and READS them out loud with feeling.
//   AegisMeetings.isPresent()
//
// Long meetings are recorded in ~75 second segments. Each segment is transcribed as soon as it ends, so the transcript
// fills in live, nothing hits Groq's per-file size limit, and a failed segment can be retried without losing the rest.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const G = () => window.AegisGroq;
  const SEG_MS = 75000, SILENT_RMS = 0.012;
  const DRAFT = "aegis_meet_draft", LOCAL_HIST = "aegis_meetings_local", PREFS = "aegis_meet_prefs";
  const sget = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const sset = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
  const toast = (t, ms) => { if (window.AegisApp && AegisApp.toast) AegisApp.toast(t, ms); };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); return (h ? h + ":" : "") + String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0") + ":" + String(s % 60).padStart(2, "0"); };

  // ---------------------------------------------------------------- state
  let dlg, tab = "record", phase = "idle";   // phase: idle | recording | paused | working
  let lines = [];                             // [{t: ms from start, text}]
  let failed = [];                            // segments that could not be transcribed yet
  let notes = null, current = null;           // current = {id?, title, notes, transcript, created}
  let R = null;                               // live recording resources
  let present = false, wantRead = false, resumeVoiceMode = false, pill = null;   // present mode (silent attendance) + read-out after notes
  const queue = []; let pumping = false, queueDone = [];

  const prefs = (() => { try { return Object.assign({ src: "mic", lang: "", out: "en" }, JSON.parse(sget(PREFS) || "{}")); } catch { return { src: "mic", lang: "", out: "en" }; } })();
  const savePrefs = () => sset(PREFS, JSON.stringify(prefs));

  // ---------------------------------------------------------------- transcript helpers
  const sortedLines = () => lines.slice().sort((a, b) => a.t - b.t);
  const transcriptText = () => sortedLines().map((l) => "[" + mmss(l.t) + "] " + l.text).join("\n");
  function addSegments(offsetMs, r) {
    // merge Whisper's short segments into readable paragraphs (~25 s each)
    let cur = null;
    (r.segments && r.segments.length ? r.segments : (r.text ? [{ start: 0, end: 0, text: r.text }] : [])).forEach((s) => {
      if (cur && s.end - cur.start < 25) { cur.text += " " + s.text; cur.end = s.end; }
      else { if (cur) lines.push({ t: offsetMs + cur.start * 1000, text: cur.text }); cur = { start: s.start, end: s.end, text: s.text }; }
    });
    if (cur) lines.push({ t: offsetMs + cur.start * 1000, text: cur.text });
  }
  function saveDraft() {
    if (!lines.length || !R) return;
    sset(DRAFT, JSON.stringify({ title: $("mt-title").value, lines, duration: activeMs(), at: Date.now(), out: prefs.out }));
  }

  // ---------------------------------------------------------------- recording
  const activeMs = () => (R ? R.accum + (R.running ? performance.now() - R.runStart : 0) : 0);

  async function getStreams(src) {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    let tabStream = null;
    if ((src || prefs.src) === "mic+tab") {
      try {
        tabStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        if (!tabStream.getAudioTracks().length) { toast("No tab audio was shared. Next time tick \"Share tab audio\". Recording your microphone only.", 8000); tabStream.getTracks().forEach((t) => t.stop()); tabStream = null; }
      } catch { toast("Tab audio wasn't shared. Recording your microphone only.", 6000); }
    }
    return { mic, tabStream };
  }

  function mime() {
    return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || "";
  }

  async function start(opts) {
    opts = opts || {};
    const quiet = !!opts.present;                  // present mode never pops the dialog over the meeting
    if (phase !== "idle") { if (!quiet) open("record"); return false; }
    if (!G() || !G().hasMic()) { toast("This browser can't record audio. Use Chrome, Edge or Safari.", 7000); return false; }
    if (!quiet) open("record");
    if (!G().hasKey()) {
      G().refreshStatus(true);
      if (!G().hasKey()) {
        if (quiet) { open("record"); }
        setHint("Add your Groq key first (Settings > Voice & meetings). It's free at console.groq.com/keys.", true);
        return false;
      }
    }
    if (lines.length && !quiet && !confirm("Start a new meeting? The current transcript will be cleared.")) return false;
    let streams;
    try { streams = await getStreams(opts.src); }
    catch (e) {
      const msg = e && e.name === "NotFoundError" ? "No microphone found." : "Microphone access is blocked. Allow it in the address bar and try again.";
      if (quiet) toast(msg, 7000);
      setHint(msg, true);
      return false;
    }
    lines = []; failed = []; notes = null; current = null; queue.length = 0; queueDone = [];
    renderLive();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const dest = ac.createMediaStreamDestination(), mix = ac.createGain(), an = ac.createAnalyser();
    an.fftSize = 1024;
    ac.createMediaStreamSource(streams.mic).connect(mix);
    if (streams.tabStream) ac.createMediaStreamSource(new MediaStream(streams.tabStream.getAudioTracks())).connect(mix);
    mix.connect(dest); mix.connect(an);
    R = { ac, dest, an, streams, accum: 0, runStart: 0, running: false, cur: null, mime: mime(), timer: 0, segTimer: 0, buf: new Float32Array(an.fftSize), level: 0, wake: null, title: "" };
    if (streams.tabStream) streams.tabStream.getVideoTracks().forEach((t) => { t.onended = () => {}; });
    try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then((w) => { if (R) R.wake = w; else w.release(); }).catch(() => {}); } catch {}
    R.runStart = performance.now(); R.running = true;
    beginSegment();
    R.segTimer = setInterval(rotateSegment, SEG_MS);
    R.timer = setInterval(tick, 200);
    setPhase("recording");
    window.addEventListener("beforeunload", guard);
    return true;
  }
  const guard = (e) => { if (phase === "recording" || phase === "paused") { e.preventDefault(); e.returnValue = ""; } };

  function beginSegment() {
    const mr = new MediaRecorder(R.dest.stream, R.mime ? { mimeType: R.mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
    const seg = { mr, start: activeMs(), peak: 0, chunks: [] };
    seg.stopped = new Promise((res) => { seg.done = res; });   // resolves once this segment is queued (or skipped)
    mr.ondataavailable = (e) => { if (e.data && e.data.size) seg.chunks.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(seg.chunks, { type: (mr.mimeType || R && R.mime || "audio/webm").split(";")[0] });
      if (blob.size < 1200) setStatus("");
      else if (seg.peak < SILENT_RMS) setStatus("Skipped a silent stretch.");
      else enqueue({ blob, start: seg.start, end: seg.end || seg.start, tries: 0 });
      seg.done();
    };
    mr.start(1000);
    R.cur = seg;
  }
  function rotateSegment() {
    if (!R || !R.running) return;
    const old = R.cur;
    beginSegment();                 // new recorder starts BEFORE the old one stops: no gap, no lost word
    old.end = activeMs();
    try { old.mr.stop(); } catch {}
  }
  function endSegment() {
    if (!R || !R.cur) return Promise.resolve();
    const seg = R.cur;
    seg.end = activeMs();
    try { seg.mr.stop(); } catch { seg.done(); }
    R.cur = null;
    return seg.stopped;
  }
  function tick() {
    if (!R) return;
    R.an.getFloatTimeDomainData(R.buf);
    let sum = 0; for (let i = 0; i < R.buf.length; i++) sum += R.buf[i] * R.buf[i];
    const rms = Math.sqrt(sum / R.buf.length);
    if (R.cur && rms > R.cur.peak) R.cur.peak = rms;
    R.level = R.level * 0.6 + Math.min(1, rms * 9) * 0.4;
    $("mt-meter-i").style.transform = "scaleX(" + (R.running ? R.level.toFixed(3) : 0) + ")";
    $("mt-clock").textContent = mmss(activeMs());
    if (pill) { pill.clock.textContent = mmss(activeMs()); pill.bar.style.transform = "scaleX(" + (R.running ? R.level.toFixed(3) : 0) + ")"; }
  }

  function pause() {
    if (phase !== "recording" || !R) return;
    endSegment(); R.accum += performance.now() - R.runStart; R.running = false;
    clearInterval(R.segTimer);
    setPhase("paused");
  }
  function resume() {
    if (phase !== "paused" || !R) return;
    R.runStart = performance.now(); R.running = true;
    beginSegment(); R.segTimer = setInterval(rotateSegment, SEG_MS);
    setPhase("recording");
  }
  function teardown() {
    if (!R) return;
    clearInterval(R.timer); clearInterval(R.segTimer);
    try { R.streams.mic.getTracks().forEach((t) => t.stop()); } catch {}
    try { R.streams.tabStream && R.streams.tabStream.getTracks().forEach((t) => t.stop()); } catch {}
    try { R.ac.close(); } catch {}
    try { R.wake && R.wake.release(); } catch {}
    window.removeEventListener("beforeunload", guard);
  }
  async function stop() {
    if (phase !== "recording" && phase !== "paused") return;
    if (present) wantRead = true;                   // ending a meeting you were attending = "give me the points"
    const duration = activeMs();
    const last = phase === "recording" ? endSegment() : Promise.resolve();
    setPhase("working");
    setStatus("Transcribing the last part...");
    await last;                                  // the final segment is queued only after MediaRecorder fires its stop event
    teardown();
    const title = $("mt-title").value.trim();
    R = null;
    leavePresent();
    await drainQueue();
    if (!lines.length) { wantRead = false; setPhase("idle"); setHint(failed.length ? "Couldn't transcribe the audio (see the retry button below)." : "I didn't hear any speech, so there is nothing to summarise.", true); return; }
    await makeNotes({ title, duration: duration / 1000, transcript: transcriptText() });
  }

  // ---------------------------------------------------------------- transcription queue
  function enqueue(item) { queue.push(item); pump(); }
  function drainQueue() { return new Promise((res) => { if (!pumping && !queue.length) return res(); queueDone.push(res); }); }
  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length) {
      const it = queue.shift();
      setStatus("Transcribing " + mmss(it.start) + "–" + mmss(it.end) + (queue.length ? " (" + queue.length + " more waiting)" : "") + "...");
      try {
        const prev = sortedLines().slice(-2).map((l) => l.text).join(" ").slice(-300);
        const r = await G().transcribe(it.blob, { lang: prefs.lang, prompt: prev, best: true });
        failed = failed.filter((f) => f !== it);
        if (r.text) { addSegments(it.start, r); renderLive(); saveDraft(); }
        setStatus("Live transcript up to " + mmss(it.end) + ".");
      } catch (e) {
        if (++it.tries < 3 && !(e.status === 401 || e.status === 400 || e.status === 413)) {
          const wait = e.status === 429 ? 15000 : it.tries * 3000;
          setStatus("Groq is busy, retrying in " + Math.round(wait / 1000) + "s...");
          await new Promise((r) => setTimeout(r, wait));
          queue.unshift(it);
        } else {
          it.error = e.message;
          if (!failed.includes(it)) failed.push(it);
          renderLive();
          setStatus("A part couldn't be transcribed: " + e.message);
        }
      }
    }
    pumping = false;
    queueDone.splice(0).forEach((f) => f());
  }
  function retryFailed() { const items = failed.slice(); failed = []; items.forEach((it) => { it.tries = 0; enqueue(it); }); renderLive(); }

  // ---------------------------------------------------------------- notes
  async function makeNotes({ title, duration, transcript }) {
    setPhase("working");
    setStatus("Writing the notes (summary, key points, action items, enhancements)...");
    try {
      const r = await G().analyze(transcript, { title, duration, lang: prefs.out });
      const n = r.notes;
      const id = r.id || localSave({ title: n.title, notes: n, transcript, duration });
      current = { id, title: n.title, notes: n, transcript, duration, created: Date.now() / 1000, local: !r.id };
      sset(DRAFT, null);
      setPhase("idle");
      showTab("notes");
      renderNotes();
      loadHistory();
      if (wantRead) { wantRead = false; open("notes"); readOut(n); }
    } catch (e) {
      wantRead = false;
      setPhase("idle");
      sset(DRAFT, JSON.stringify({ title, lines, duration: duration * 1000, at: Date.now(), out: prefs.out }));
      setHint("Couldn't write the notes: " + e.message + " Your transcript is safe; press \"Write notes\" to try again.", true);
      showRetryNotes({ title, duration, transcript });
    }
  }
  function localSave(m) {
    let arr = []; try { arr = JSON.parse(sget(LOCAL_HIST) || "[]"); } catch {}
    const id = "L" + Date.now();
    arr.unshift({ id, title: m.title, duration: m.duration, created: Date.now() / 1000, notes: m.notes, transcript: m.transcript.slice(0, 120000) });
    sset(LOCAL_HIST, JSON.stringify(arr.slice(0, 15)));
    return id;
  }

  // ---------------------------------------------------------------- UI
  function setPhase(p) {
    phase = p;
    document.documentElement.dataset.meeting = p === "recording" ? "rec" : p;
    const rec = p === "recording", pa = p === "paused", work = p === "working";
    $("mt-setup").classList.toggle("hidden", p !== "idle");
    $("mt-session").classList.toggle("hidden", p === "idle");
    $("mt-start").disabled = work;
    $("mt-start").classList.toggle("hidden", rec || pa);
    $("mt-present").classList.toggle("hidden", rec || pa);
    $("mt-present").disabled = work;
    $("mt-pause").classList.toggle("hidden", !(rec || pa));
    $("mt-pause").textContent = pa ? "Resume" : "Pause";
    $("mt-stop").classList.toggle("hidden", !(rec || pa));
    $("mt-keypoints").disabled = work || !lines.length;
    $("mt-dot").className = "mt-dot " + (rec ? "on" : pa ? "pa" : work ? "wk" : "");
    $("mt-state").textContent = rec ? "Recording" : pa ? "Paused" : work ? "Working..." : "Ready";
    const b = $("meet-btn"); if (b) b.classList.toggle("live", rec || pa);
    if (!rec && !pa) $("mt-meter-i").style.transform = "scaleX(0)";
  }
  function setStatus(t) { const s = $("mt-status"); if (s) s.textContent = t || ""; }
  function setHint(t, bad) { const h = $("mt-hint"); h.textContent = t || ""; h.className = "mt-hint" + (bad ? " bad" : ""); }

  function renderLive() {
    const box = $("mt-live");
    box.textContent = "";
    sortedLines().forEach((l) => { const p = el("p"); const t = el("time", "", mmss(l.t)); const s = el("span", "", l.text); s.dir = "auto"; p.append(t, s); box.appendChild(p); });
    failed.forEach((f) => { const p = el("p", "mt-fail"); p.append(el("time", "", mmss(f.start)), el("span", "", "Couldn't transcribe this part: " + (f.error || "unknown error") + " ")); const b = el("button", "linkbtn", "Retry"); b.type = "button"; b.addEventListener("click", retryFailed); p.appendChild(b); box.appendChild(p); });
    if (!lines.length && !failed.length) box.appendChild(el("p", "muted small", "The transcript appears here about a minute after you start speaking, and keeps growing."));
    box.scrollTop = box.scrollHeight;
    $("mt-keypoints").disabled = phase === "working" || !lines.length;
    $("mt-words").textContent = lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0) + " words";
    if (pill) { const last = sortedLines().slice(-1)[0]; pill.cap.textContent = last ? last.text : "Listening quietly. Say \"meeting points extract karo\" when it ends."; pill.cap.dir = "auto"; }
  }

  function chip(text, kind) { return el("span", "mt-chip " + (kind || ""), text); }
  function section(title, iconPath, count) {
    const s = el("section", "mt-sec");
    const h = el("h4"); h.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + iconPath + '"/></svg>'; h.appendChild(document.createTextNode(title));
    if (count != null) h.appendChild(el("span", "mt-n", String(count)));
    s.appendChild(h);
    return s;
  }
  const ICONS = { sum: "M4 6h16M4 12h16M4 18h10", star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z", ok: "M5 12.5l4.5 4.5L19 7.5", task: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2", up: "M12 19V5M5 12l7-7 7 7", warn: "M12 3l10 18H2zM12 10v5M12 18h.01", q: "M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17h.01", go: "M5 12h14M13 6l6 6-6 6" };

  function renderNotesInto(host, n, opts) {
    opts = opts || {};
    host.textContent = "";
    const head = el("div", "mt-nhead");
    const h = el("h3", "", n.title || "Meeting notes"); h.dir = "auto";
    head.appendChild(h);
    if ((n.topics || []).length) { const t = el("div", "mt-chips"); n.topics.forEach((x) => t.appendChild(chip(x, "topic"))); head.appendChild(t); }
    if ((n.participants || []).length) head.appendChild(el("p", "muted small", "Participants: " + n.participants.join(", ")));
    host.appendChild(head);
    if (n.summary) { const s = section("Summary", ICONS.sum); const p = el("p", "mt-summary", n.summary); p.dir = "auto"; s.appendChild(p); host.appendChild(s); }
    const list = (name, icon, items, mk, cls) => {
      if (!items || !items.length) return;
      const s = section(name, icon, items.length); const ul = el("ul", "mt-list " + (cls || ""));
      items.forEach((x) => { const li = el("li"); li.dir = "auto"; mk(li, x); ul.appendChild(li); });
      s.appendChild(ul); host.appendChild(s);
    };
    list("Important points", ICONS.star, n.important_points, (li, p) => { li.append(chip(p.importance, "imp-" + p.importance), document.createTextNode(" " + p.point)); });
    list("Decisions", ICONS.ok, n.decisions, (li, x) => { li.textContent = x; });
    // action items: pick which ones to send to the to-do list
    if ((n.action_items || []).length) {
      const s = section("Action items", ICONS.task, n.action_items.length); const ul = el("ul", "mt-list acts");
      n.action_items.forEach((a, i) => {
        const li = el("li"); li.dir = "auto";
        const cb = el("input"); cb.type = "checkbox"; cb.checked = true; cb.dataset.i = i; cb.setAttribute("aria-label", "Include: " + a.task);
        const body = el("span", "", a.task);
        li.append(cb, body);
        if (a.owner) li.appendChild(chip("👤 " + a.owner, "who"));
        if (a.due) li.appendChild(chip("⏰ " + a.due, "due"));
        li.appendChild(chip(a.priority, "imp-" + a.priority));
        ul.appendChild(li);
      });
      s.appendChild(ul);
      if (opts.actions !== false) {
        const row = el("div", "mt-row");
        const b = el("button", "btn primary small-btn", "Add selected to my tasks"); b.type = "button";
        b.addEventListener("click", () => addTasks(n, ul));
        row.appendChild(b); s.appendChild(row);
      }
      host.appendChild(s);
    }
    list("Enhancements", ICONS.up, n.enhancements, (li, e) => {
      li.append(chip(e.impact + " impact", "imp-" + e.impact), document.createTextNode(" " + e.idea));
      if (e.why) li.appendChild(el("small", "mt-why", e.why));
      if (e.source === "suggested") li.appendChild(chip("suggested by Aegis", "sug"));
    }, "enh");
    list("Risks and blockers", ICONS.warn, n.risks, (li, x) => { li.textContent = x; });
    list("Open questions", ICONS.q, n.open_questions, (li, x) => { li.textContent = x; });
    list("Next steps", ICONS.go, n.next_steps, (li, x) => { li.textContent = x; });
  }

  function renderNotes() {
    const host = $("mt-notes-body"), empty = $("mt-notes-empty");
    if (!current) { host.textContent = ""; empty.classList.remove("hidden"); $("mt-notes-actions").classList.add("hidden"); return; }
    empty.classList.add("hidden"); $("mt-notes-actions").classList.remove("hidden");
    renderNotesInto(host, current.notes);
    const det = $("mt-transcript-box");
    det.classList.toggle("hidden", !current.transcript);
    $("mt-transcript").textContent = current.transcript || "";
    $("mt-notes-meta").textContent = new Date(current.created * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) + (current.duration ? " · " + Math.max(1, Math.round(current.duration / 60)) + " min" : "");
  }

  async function addTasks(n, ul) {
    const picks = Array.from(ul.querySelectorAll("input:checked")).map((c) => n.action_items[+c.dataset.i]).filter(Boolean);
    if (!picks.length) return toast("Tick at least one action item.");
    if (G().isLocal()) {
      const t = picks.map((a) => "- " + a.task + (a.owner ? " (" + a.owner + ")" : "")).join("\n");
      try { await navigator.clipboard.writeText(t); toast("Copied. Tasks need the Aegis server; paste these into your notes."); } catch { toast("Tasks need the Aegis server."); }
      return;
    }
    let ok = 0;
    for (const a of picks) {
      try {
        const r = await fetch(G().apiBase() + "/api/tasks", { method: "POST", headers: { Authorization: "Bearer " + G().token(), "Content-Type": "application/json" }, body: JSON.stringify({ text: a.task + (a.owner ? " (" + a.owner + ")" : ""), due: a.due || "" }) });
        if (r.ok) ok++;
      } catch {}
    }
    toast(ok ? "Added " + ok + " task" + (ok > 1 ? "s" : "") + " to your to-do list." : "Couldn't add the tasks.");
    if (window.AegisApp && AegisApp.loadTasks) AegisApp.loadTasks();
  }

  function download(name, text, type) {
    const a = el("a"); a.href = URL.createObjectURL(new Blob([text], { type: type || "text/markdown" })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const slug = (t) => String(t || "meeting").toLowerCase().replace(/[^\w؀-ۿ]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "meeting";
  const currentMd = () => G().toMarkdown(current.notes, new Date(current.created * 1000).toLocaleDateString([], { dateStyle: "long" }));

  // ---------------------------------------------------------------- upload / paste
  async function fromFile() {
    const f = $("mt-file").files[0];
    if (!f) return toast("Choose an audio or video file first.");
    if (!G().hasKey()) return setUpMsg("Add your Groq key first (Settings > Voice & meetings).", true);
    if (f.size > 24 * 1024 * 1024) return setUpMsg("That file is " + Math.round(f.size / 1048576) + " MB. Groq accepts about 24 MB per file (roughly 25 minutes of normal mp3). Split it, or record the meeting live instead (live recording has no length limit).", true);
    prefs.lang = $("mt-lang-up").value; prefs.out = $("mt-out-up").value; savePrefs();
    setPhase("working"); setUpMsg("Transcribing " + f.name + "... this can take a minute.");
    lines = []; failed = [];
    try {
      const r = await G().transcribe(f, { lang: prefs.lang, best: true });
      if (!r.text) { setPhase("idle"); return setUpMsg("No speech was found in that file.", true); }
      addSegments(0, r);
      setUpMsg("");
      await makeNotes({ title: $("mt-title-up").value.trim() || f.name.replace(/\.[^.]+$/, ""), duration: r.duration || 0, transcript: transcriptText() });
    } catch (e) { setPhase("idle"); setUpMsg(e.message, true); }
  }
  async function fromPaste() {
    const t = $("mt-paste").value.trim();
    if (t.length < 30) return setUpMsg("Paste the transcript first (at least a few sentences).", true);
    if (!G().hasKey()) return setUpMsg("Add your Groq key first (Settings > Voice & meetings).", true);
    prefs.out = $("mt-out-up").value; savePrefs();
    setPhase("working"); setUpMsg("Writing the notes...");
    await makeNotes({ title: $("mt-title-up").value.trim(), duration: 0, transcript: t });
    setUpMsg("");
  }
  function setUpMsg(t, bad) { const m = $("mt-up-msg"); m.textContent = t || ""; m.className = "mt-hint" + (bad ? " bad" : ""); }
  function showRetryNotes(args) {
    const h = $("mt-hint"); const b = el("button", "btn primary small-btn", "Write notes"); b.type = "button"; b.style.marginLeft = "8px";
    b.addEventListener("click", () => { b.remove(); makeNotes(args); }); h.appendChild(b);
  }

  // ---------------------------------------------------------------- history
  async function loadHistory() {
    const ul = $("mt-hist"); if (!ul) return;
    let rows = [];
    if (G().isLocal()) { try { rows = JSON.parse(sget(LOCAL_HIST) || "[]"); } catch {} }
    else if (G().token()) {
      try { const r = await fetch(G().apiBase() + "/api/meetings", { headers: { Authorization: "Bearer " + G().token() } }); if (r.ok) rows = await r.json(); } catch {}
    }
    ul.textContent = "";
    $("mt-hist-empty").classList.toggle("hidden", rows.length > 0);
    rows.forEach((m) => {
      const li = el("li");
      const b = el("button", "mt-hist-open"); b.type = "button";
      const t = el("b", "", m.title || "Meeting"); t.dir = "auto";
      b.append(t, el("small", "muted", new Date(m.created * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) + (m.duration ? " · " + Math.max(1, Math.round(m.duration / 60)) + " min" : "")));
      b.addEventListener("click", () => openSaved(m));
      const x = el("button", "x", "×"); x.type = "button"; x.title = "Delete this meeting"; x.setAttribute("aria-label", "Delete meeting");
      x.addEventListener("click", async () => {
        if (!confirm("Delete this meeting and its transcript?")) return;
        if (G().isLocal()) { let a = []; try { a = JSON.parse(sget(LOCAL_HIST) || "[]"); } catch {} sset(LOCAL_HIST, JSON.stringify(a.filter((z) => z.id !== m.id))); }
        else { try { await fetch(G().apiBase() + "/api/meetings/" + m.id, { method: "DELETE", headers: { Authorization: "Bearer " + G().token() } }); } catch {} }
        if (current && current.id === m.id) { current = null; renderNotes(); }
        loadHistory();
      });
      li.append(b, x); ul.appendChild(li);
    });
  }
  async function openSaved(m) {
    if (G().isLocal()) current = { id: m.id, title: m.title, notes: m.notes, transcript: m.transcript, duration: m.duration, created: m.created, local: true };
    else {
      try {
        const r = await fetch(G().apiBase() + "/api/meetings/" + m.id, { headers: { Authorization: "Bearer " + G().token() } });
        if (!r.ok) throw 0; const j = await r.json();
        current = { id: j.id, title: j.title, notes: j.notes, transcript: j.transcript, duration: j.duration, created: j.created };
      } catch { return toast("Couldn't open that meeting."); }
    }
    showTab("notes"); renderNotes();
  }

  // ---------------------------------------------------------------- present mode + read-out
  // Present mode = Aegis sits in on a meeting that is already running. It listens (microphone, and the call's audio when the
  // browser / desktop app can share it), stays completely silent, keeps voice mode off so it never answers your colleagues, and
  // shows a small floating pill. When the meeting ends you say "meeting points extract karo" and it writes the notes and reads them to you.
  const L10N = {
    en: { intro: "The meeting is over. Here are the key points.", summary: "In short.", points: "The most important points.", decisions: "Decisions that were made.", actions: "Action items.", risks: "Things to watch out for.", next: "Next steps.", outro: "The full notes are on your screen.", none: "I didn't catch enough to summarise.", owner: " is on it", due: ", due " },
    roman: { intro: "Meeting khatam ho gayi. Ye rahe meeting ke main points.", summary: "Mukhtasar yeh ke.", points: "Sab se zaroori baatein.", decisions: "Jo faisle hue.", actions: "Action items.", risks: "In baaton ka khayal rakhna.", next: "Agle qadam.", outro: "Poore notes aap ki screen par hain.", none: "Mujhe summary ke liye kaafi baat sunai nahi di.", owner: " ke zimme", due: ", deadline " },
    ur: { intro: "میٹنگ ختم ہو گئی۔ یہ رہے اہم نکات۔", summary: "مختصراً۔", points: "سب سے اہم باتیں۔", decisions: "جو فیصلے ہوئے۔", actions: "کرنے کے کام۔", risks: "ان باتوں کا خیال رکھیں۔", next: "اگلے اقدامات۔", outro: "مکمل نوٹس آپ کی سکرین پر ہیں۔", none: "خلاصے کے لیے کافی گفتگو نہیں سنائی دی۔", owner: " کے ذمے", due: "، آخری تاریخ " },
    hi: { intro: "मीटिंग खत्म हुई। ये रहे मुख्य बिंदु।", summary: "संक्षेप में।", points: "सबसे ज़रूरी बातें।", decisions: "जो फैसले हुए।", actions: "करने के काम।", risks: "इन बातों का ध्यान रखें।", next: "अगले कदम।", outro: "पूरे नोट्स आपकी स्क्रीन पर हैं।", none: "सारांश के लिए पर्याप्त बातचीत नहीं सुनाई दी।", owner: " के ज़िम्मे", due: ", समय सीमा " },
  };
  // notes -> [{ text, emotion }]: every section is spoken with its own feeling (calm summary, confident decisions, concerned risks...)
  function scriptFor(n, lang) {
    const T = L10N[lang] || L10N.en;
    const out = [];
    const add = (text, emotion) => { text = String(text || "").trim(); if (text) out.push({ text, emotion }); };
    add(T.intro, "warm");
    if (n.summary) { add(T.summary, "calm"); add(n.summary, "calm"); }
    const pts = (n.important_points || []).slice(0, 5);
    if (pts.length) { add(T.points, "confident"); pts.forEach((p) => add(p.point.replace(/[.!?]*$/, "."), p.importance === "high" ? "urgent" : "calm")); }
    const dec = (n.decisions || []).slice(0, 4);
    if (dec.length) { add(T.decisions, "confident"); dec.forEach((d) => add(String(d).replace(/[.!?]*$/, "."), "confident")); }
    const acts = (n.action_items || []).slice(0, 5);
    if (acts.length) { add(T.actions, "calm"); acts.forEach((a) => add(a.task.replace(/[.!?]*$/, "") + (a.owner ? ", " + a.owner + T.owner : "") + (a.due ? T.due + a.due : "") + ".", "calm")); }
    const risks = (n.risks || []).slice(0, 3);
    if (risks.length) { add(T.risks, "concern"); risks.forEach((r) => add(String(r).replace(/[.!?]*$/, "."), "concern")); }
    const nxt = (n.next_steps || []).slice(0, 3);
    if (nxt.length) { add(T.next, "warm"); nxt.forEach((x) => add(String(x).replace(/[.!?]*$/, "."), "warm")); }
    if (out.length <= 1) add(T.none, "empathy");
    add(T.outro, "warm");
    return out;
  }
  function readOut(n) {
    if (!n || !window.AegisApp || !AegisApp.speakScript) return false;
    const lang = prefs.out === "auto" ? "en" : prefs.out;
    AegisApp.speakScript(scriptFor(n, lang), { onend: () => { if (resumeVoiceMode && AegisApp.setVoiceMode) { resumeVoiceMode = false; AegisApp.setVoiceMode(true); } } });
    return true;
  }

  function buildPill() {
    if (pill) return pill;
    const root = el("div", "present-pill");
    root.setAttribute("role", "status"); root.setAttribute("aria-live", "polite");
    const top = el("div", "pp-top");
    const dot = el("i", "pp-dot");
    const title = el("b", "", "Aegis is present");
    const clock = el("span", "pp-clock tnum", "0:00");
    top.append(dot, title, clock);
    const meter = el("div", "pp-meter"); const bar = el("i"); meter.appendChild(bar);
    const cap = el("p", "pp-cap muted small", "");
    const row = el("div", "pp-row");
    const ex = el("button", "btn primary small-btn", "Extract points"); ex.type = "button"; ex.addEventListener("click", () => extract());
    const pa = el("button", "btn ghost small-btn", "Pause"); pa.type = "button";
    pa.addEventListener("click", () => { if (phase === "paused") { resume(); pa.textContent = "Pause"; } else { pause(); pa.textContent = "Resume"; } });
    const op = el("button", "btn ghost small-btn", "Transcript"); op.type = "button"; op.addEventListener("click", () => open("record"));
    row.append(ex, pa, op);
    root.append(top, meter, cap, row);
    document.body.appendChild(root);
    pill = { root, clock, bar, cap, pause: pa };
    return pill;
  }
  function leavePresent() {
    present = false;
    delete document.documentElement.dataset.present;
    if (pill) { pill.root.remove(); pill = null; }
  }

  async function startPresent(opts) {
    opts = opts || {};
    if (present || phase === "recording" || phase === "paused") {
      toast(present ? "I'm already attending this meeting." : "A meeting is already being recorded.");
      return present;
    }
    present = true;                                   // set first: from here on Aegis never speaks (app.js checks isPresent)
    if (window.AegisApp && AegisApp.stopSpeaking) AegisApp.stopSpeaking();
    if (window.AegisApp && AegisApp.isVoiceMode && AegisApp.isVoiceMode()) { resumeVoiceMode = true; AegisApp.setVoiceMode(false); }
    document.documentElement.dataset.present = "1";
    const ok = await start({ present: true, src: opts.src || (prefs.src === "mic+tab" ? "mic+tab" : "mic") });
    if (!ok) {
      leavePresent();
      if (resumeVoiceMode && window.AegisApp) { resumeVoiceMode = false; AegisApp.setVoiceMode(true); }
      return false;
    }
    buildPill(); renderLive();
    toast("Present mode: I'm listening quietly. Say \"meeting points extract karo\" at the end.", 6000);
    return true;
  }

  // "Extract the meeting points": works while the meeting is still going, while it is being transcribed, or afterwards.
  async function extract() {
    if (phase === "recording" || phase === "paused") { wantRead = true; await stop(); return true; }
    if (phase === "working") { wantRead = true; return true; }
    if (current) { open("notes"); return readOut(current.notes); }
    return false;
  }

  // ---------------------------------------------------------------- key points so far
  async function keyPoints() {
    if (!lines.length) return;
    const box = $("mt-kp"); box.classList.remove("hidden"); box.textContent = "Reading the conversation so far...";
    $("mt-keypoints").disabled = true;
    try {
      const r = await G().analyze(transcriptText(), { lang: prefs.out, quick: true, save: false });
      renderNotesInto(box, r.notes, { actions: false });
      const x = el("button", "linkbtn small", "Hide"); x.type = "button"; x.addEventListener("click", () => box.classList.add("hidden")); box.appendChild(x);
    } catch (e) { box.textContent = e.message; }
    $("mt-keypoints").disabled = phase === "working" || !lines.length;
  }

  // ---------------------------------------------------------------- tabs + dialog
  function showTab(t) {
    tab = t;
    document.querySelectorAll("#meetings .mt-tab").forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    document.querySelectorAll("#meetings .mt-pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== t));
    if (t === "history") loadHistory();
  }
  function open(t) {
    if (!dlg) return;
    if (G() && G().refreshStatus) G().refreshStatus();
    if (!dlg.open) dlg.showModal();
    showTab(t || (current && phase === "idle" && tab === "notes" ? "notes" : tab) || "record");
    checkDraft();
    renderLive();
  }
  function checkDraft() {
    const box = $("mt-draft"); box.textContent = "";
    box.classList.add("hidden");
    if (phase !== "idle" || lines.length) return;
    let d = null; try { d = JSON.parse(sget(DRAFT) || "null"); } catch {}
    if (!d || !d.lines || !d.lines.length) return;
    box.classList.remove("hidden");
    box.appendChild(el("span", "", "You have an unfinished meeting (" + Math.max(1, Math.round((d.duration || 0) / 60000)) + " min, saved " + new Date(d.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) + ")."));
    const a = el("button", "btn primary small-btn", "Write its notes"); a.type = "button";
    a.addEventListener("click", () => { lines = d.lines; prefs.out = d.out || prefs.out; box.classList.add("hidden"); makeNotes({ title: d.title || "", duration: (d.duration || 0) / 1000, transcript: transcriptText() }); });
    const b = el("button", "btn ghost small-btn", "Discard"); b.type = "button"; b.addEventListener("click", () => { sset(DRAFT, null); box.classList.add("hidden"); });
    box.append(a, b);
  }

  function init() {
    dlg = $("meetings");
    if (!dlg || !G()) return;
    $("meet-btn").addEventListener("click", () => open());
    $("mt-close").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    document.querySelectorAll("#meetings .mt-tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    // setup controls
    const bind = (id, key) => { const s = $(id); s.value = prefs[key]; s.addEventListener("change", () => { prefs[key] = s.value; savePrefs(); }); };
    bind("mt-src", "src"); bind("mt-lang", "lang"); bind("mt-out", "out");
    $("mt-lang-up").value = prefs.lang; $("mt-out-up").value = prefs.out;
    $("mt-start").addEventListener("click", () => start());
    $("mt-present").addEventListener("click", () => { dlg.close(); startPresent({ src: prefs.src }); });
    $("mt-pause").addEventListener("click", () => (phase === "paused" ? resume() : pause()));
    $("mt-stop").addEventListener("click", stop);
    $("mt-keypoints").addEventListener("click", keyPoints);
    $("mt-up-go").addEventListener("click", fromFile);
    $("mt-paste-go").addEventListener("click", fromPaste);
    $("mt-copy").addEventListener("click", async () => { if (!current) return; try { await navigator.clipboard.writeText(currentMd()); toast("Notes copied."); } catch { toast("Your browser blocked copying."); } });
    $("mt-dl").addEventListener("click", () => current && download(slug(current.title) + "-notes.md", currentMd()));
    $("mt-dl-tr").addEventListener("click", () => current && download(slug(current.title) + "-transcript.txt", current.transcript || "", "text/plain"));
    $("mt-email").addEventListener("click", () => { if (!current) return; dlg.close(); if (window.AegisApp && AegisApp.submitText) AegisApp.submitText("Draft a follow-up email to everyone in my latest meeting \"" + current.title + "\" with the summary, decisions and action items."); });
    $("mt-src-note").textContent = "To capture a Zoom / Meet / Teams call running in a browser tab, choose \"Microphone + browser tab audio\", then pick that tab and tick \"Share tab audio\".";
    setPhase("idle"); renderLive(); renderNotes();
    document.addEventListener("keydown", (e) => { if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "m" || e.key === "M")) { e.preventDefault(); open(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.AegisMeetings = { open, start, stop, pause, resume, present: startPresent, extract, isPresent: () => present, state: () => phase, hasNotes: () => !!current, scriptFor };
})();

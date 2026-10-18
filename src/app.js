// ON-CALL — UI + controller. Depends on engine.js (pure) and pool.js (data).
import { createRun, clockFor, shareText, verdictFor, seedFromString, isValidSeed } from "./engine.js";
import { POOL, POOL_STATS } from "./pool.js";

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const SHIFT_START = 2 * 60 + 11; // 02:11
const SHIFT_SIZE = 6;
const KEY_BEST = "oncall.best.v1";
const KEY_SOUND = "oncall.sound.v1";

const MARKS = { cmd: "›", good: "✓", bad: "✕", warn: "!", note: "∴", said: "»" };

const state = {
  run: null,
  token: 0,
  timer: null,
  busy: false,
  sound: false,
  audio: null,
  typing: null,
  skipTyping: false,
  lastResult: null
};

/* ───────────────────────── audio ───────────────────────── */
function audioCtx() {
  if (!state.audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    state.audio = new Ctx();
  }
  return state.audio;
}
function beep(kind) {
  if (!state.sound) return;
  const ctx = audioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
  const now = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const spec = {
    page: [182, 0.16, "square", 0.05],
    click: [330, 0.05, "triangle", 0.045],
    good: [520, 0.09, "sine", 0.05],
    bad: [110, 0.2, "sawtooth", 0.045],
    end: [392, 0.5, "sine", 0.05]
  }[kind] || [300, 0.05, "sine", 0.04];
  o.type = spec[2];
  o.frequency.setValueAtTime(spec[0], now);
  if (kind === "bad") o.frequency.exponentialRampToValueAtTime(70, now + spec[1]);
  g.gain.setValueAtTime(spec[3], now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + spec[1]);
  o.connect(g).connect(ctx.destination);
  o.start(now);
  o.stop(now + spec[1] + 0.02);
}

/* ───────────────────────── helpers ───────────────────────── */
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

function readBest() {
  try {
    const raw = localStorage.getItem(KEY_BEST);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeBest(result) {
  const best = readBest();
  if (!best || result.pct > best.pct) {
    try { localStorage.setItem(KEY_BEST, JSON.stringify({ pct: result.pct, grade: result.grade, seed: result.seed })); } catch {}
    return true;
  }
  return false;
}

function seedFromUrl() {
  const s = new URLSearchParams(location.search).get("s");
  if (!s) return null;
  if (!/^\d{6}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return isValidSeed(n) ? n : null;
}

function seedFromInput(raw) {
  const t = String(raw || "").trim();
  if (!/^\d{6}$/.test(t)) return null;
  const n = parseInt(t, 10);
  return isValidSeed(n) ? n : null;
}

/* ───────────────────────── screens ───────────────────────── */
function show(screen) {
  document.querySelectorAll(".screen").forEach((s) => {
    const on = s.id === "screen-" + screen;
    s.classList.toggle("is-active", on);
  });
  document.body.dataset.screen = screen;
  const focusTarget = $("#screen-" + screen).querySelector("[data-autofocus]");
  if (focusTarget) focusTarget.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
}

/* ───────────────────────── title ───────────────────────── */
function renderTitle() {
  $("#pool-stats").textContent = `${POOL_STATS.incidents} incidents · ${POOL_STATS.choices} decisions`;
  const best = readBest();
  const bestLine = $("#best-line");
  if (best) {
    bestLine.hidden = false;
    bestLine.textContent = `Personal best: grade ${best.grade} · ${best.pct}/100 · shift #${best.seed}`;
  } else {
    bestLine.hidden = true;
  }
  const s = seedFromUrl();
  $("#seed-input").value = s ? String(s) : "";
}

/* ───────────────────────── log rendering ───────────────────────── */
function logBox() { return $("#log"); }

function clearLog() {
  const box = logBox();
  box.innerHTML = "";
}

function appendLine(cls, text, opts = {}) {
  const line = el("p", "ln " + cls);
  const mark = MARKS[cls] ? el("span", "mark", MARKS[cls]) : null;
  const body = el("span", null, "");
  if (mark) line.appendChild(mark);
  line.appendChild(body);
  logBox().appendChild(line);
  scrollLog();

  const announce = () => {
    const live = document.getElementById("announcer");
    if (live && text) live.textContent = text;
  };

  const instant = reducedMotion() || opts.instant || cls === "gap";
  if (instant || !text) {
    body.textContent = text || "";
    announce();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let i = 0;
    // ~150-220ms per line: readable, but never a reason to wait on the game
    const step = Math.max(2, Math.ceil(text.length / 16));
    const id = Math.random();
    const tick = () => {
      if (state.skipTyping) i = text.length;
      i += step;
      body.textContent = text.slice(0, i);
      scrollLog();
      if (i < text.length) {
        state.typing = id;
        state._timer = setTimeout(tick, 9);
      } else {
        state.typing = null;
        announce();
        resolve();
      }
    };
    state.typing = id;
    state.skipTyping = false;
    tick();
  });
}

async function appendLines(lines) {
  for (const [cls, text] of lines) {
    if (cls === "gap") { logBox().appendChild(el("div", "ln gap")); continue; }
    await appendLine(cls, text);
    if (state.skipTyping) state.skipTyping = false;
  }
}

let scrollQueued = false;
function scrollLog() {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    const box = logBox();
    if (box) box.scrollTop = box.scrollHeight;
  });
}

/* ───────────────────────── HUD ───────────────────────── */
function updateHud(flashKey) {
  const st = state.run.state;
  const total = st.queue.length;
  $("#hud-clock").textContent = clockFor(SHIFT_START, st.minutes);
  $("#hud-inc").textContent = `${Math.min(st.idx + 1, total)} / ${total}`;
  $("#hud-min").textContent = st.minutes + "m";

  const drag = st.decisions.reduce((n, d) => n + Math.min(0, d.pts), 0);
  const budget = Math.max(0, 100 + drag);
  const bEl = $("#hud-budget");
  bEl.textContent = budget + "%";
  bEl.className = "v" + (budget < 40 ? " bad" : budget < 70 ? " warn" : "");

  const peak = st.peak || 0;
  const pEl = $("#hud-peak");
  pEl.textContent = peak >= 1000 ? Math.round(peak / 1000) + "k" : String(peak);
  pEl.className = "v" + (peak >= 100000 ? " bad" : peak >= 20000 ? " warn" : "");

  if (flashKey) {
    const node = $("#hud-" + flashKey);
    if (node) {
      node.classList.add("flash");
      setTimeout(() => node.classList.remove("flash"), 620);
    }
  }
}

/* ───────────────────────── play ───────────────────────── */
function startShift(seed) {
  const token = ++state.token;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  state.typing = null;
  state.skipTyping = false;
  state.busy = false;
  const useSeed = isValidSeed(seed) ? seed : Math.floor(100000 + Math.random() * 899999);
  state.run = createRun({ pool: POOL, seed: useSeed, size: SHIFT_SIZE });
  state.lastResult = null;
  clearLog();
  hideChoices();
  $("#hint-btn").disabled = false;
  $("#hint-btn").hidden = false;
  updateHud();
  show("play");
  renderStageHeader();
  beep("page");
  openIncident(token);
}

function renderStageHeader() {
  const cur = state.run.current();
  if (!cur) return;
  const inst = cur.instance;
  $("#stage-title").textContent = cur.incident.title;
  const sev = $("#stage-sev");
  sev.textContent = inst.sev;
  sev.className = "sev " + inst.sev.toLowerCase();
  $("#stage-recur").hidden = !inst.recurrent;
}

async function openIncident(token) {
  if (token !== state.token) return;
  const cur = state.run.current();
  if (!cur) return endShift();
  clearLog();
  renderStageHeader();
  updateHud();
  state.busy = true;
  hideChoices();
  await appendLine("head", `${clockFor(SHIFT_START, state.run.state.minutes)}  ${cur.incident.title}  [${cur.instance.sev}]`);
  if (token !== state.token) return;

  if (cur.instance.recurrent) {
    const prior = cur.instance.priorLabel;
    await appendLine("warn", "RECURRENCE — this incident came back. Severity " + cur.instance.sev + ", penalties and minutes x1.5.");
    if (prior) {
      await appendLine("warn", "You closed it with: \u201c" + prior + "\u201d, which handled the symptom and left the cause in place.");
    }
    await appendLine("note", "The runbook line for this one: " + cur.incident.hint);
    if (token !== state.token) return;
  }

  await appendLines(cur.incident.open);
  if (token !== state.token) return;
  state.busy = false;
  renderStep();
}

function renderStep() {
  const cur = state.run.current();
  if (!cur) return endShift();
  const prompt = el("div", "prompt", "› " + cur.prompt);
  prompt.id = "prompt";
  const box = $("#choices");
  box.innerHTML = "";
  box.appendChild(prompt);
  cur.choices.forEach((c, i) => {
    const b = el("button", "choice");
    b.type = "button";
    b.dataset.index = String(i);
    b.appendChild(el("span", "num", String(i + 1)));
    b.appendChild(el("span", "txt", c.label));
    b.appendChild(el("span", "go", "▸"));
    b.setAttribute("aria-label", `Option ${i + 1}: ${c.label}`);
    b.addEventListener("click", () => pick(i));
    box.appendChild(b);
  });
  box.hidden = false;
  updateHud();
  scrollLog();
  const first = box.querySelector(".choice");
  if (first) {
    first.focus({ preventScroll: true });
    if (window.innerWidth < 680) box.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }
}

function hideChoices() {
  const box = $("#choices");
  box.hidden = true;
  box.innerHTML = "";
}

async function pick(index) {
  if (state.busy || !state.run || state.run.isOver()) return;
  const token = state.token;
  const res = state.run.choose(index);
  if (!res) return;
  state.busy = true;
  hideChoices();

  const cls = res.pts >= 5 ? "cmd" : res.pts >= 1 ? "cmd" : res.pts === 0 ? "warn" : "bad";
  await appendLine(cls, "▸ " + res.choice.label);
  if (token !== state.token) return;
  await appendLines(res.say);
  if (token !== state.token) return;

  if (res.customers > 0) {
    await appendLine("note", `Blast radius this decision: ${res.customers.toLocaleString("en-US")} customers.`);
  }

  updateHud(res.customers > 0 ? "peak" : res.pts < 0 ? "budget" : null);
  beep(res.pts >= 5 ? "good" : res.pts < 0 ? "bad" : "click");

  if (res.done && res.finished) {
    await appendLine(
      res.finished.fixed ? "good" : "warn",
      res.finished.fixed
        ? "Incident closed — cause fixed, not just hidden."
        : "Closed on symptoms. The cause is still in the system."
    );
  }

  if (token !== state.token) return;
  state.busy = false;

  if (state.run.isOver()) return endShift();
  if (res.done) {
    await new Promise((r) => setTimeout(r, 420));
    if (token !== state.token) return;
    return openIncident(token);
  }
  renderStep();
}

function consultHint() {
  if (!state.run || state.run.isOver() || state.busy) return;
  const hint = state.run.hint();
  const btn = $("#hint-btn");
  btn.disabled = true;
  if (!hint) return;
  appendLine("note", "Runbook (−2 pts, +3 min): " + hint);
  updateHud("min");
  beep("click");
}

/* ───────────────────────── end ───────────────────────── */
function endShift() {
  const result = state.run.result();
  state.lastResult = result;
  const gradeCls = "g-" + result.grade.toLowerCase();

  const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };

  set("pm-grade", result.grade);
  const gradeEl = $("#pm-grade");
  gradeEl.className = "grade-letter " + gradeCls;
  gradeEl.setAttribute("aria-label", "Grade " + result.grade + ", " + result.pct + " out of 100");
  set("pm-tagline", result.tagline);
  set("pm-sub", `Shift #${result.seed} · ${result.fixedIncidents} of ${result.closed} causes actually fixed · decisions ${result.decisionPct}/100, closure ${result.closurePct}%`);

  set("pm-pts", `${result.pts} / ${result.maxPts}`);
  set("pm-mttr", result.minutes + " min");
  set("pm-peak", result.peak.toLocaleString("en-US"));
  set("pm-fixes", String(result.fixed));
  set("pm-recur", String(result.recurrences));

  const tbody = $("#pm-tbody");
  tbody.innerHTML = "";
  result.decisions.forEach((d, i) => {
    const v = verdictFor(d.pts);
    const tr = el("tr");
    if (d.recurrent) tr.className = "rec";
    tr.appendChild(el("td", "num", String(i + 1)));
    const nameCell = el("td", null, d.incident.length > 26 ? d.incident.slice(0, 24) + "…" : d.incident);
    if (d.recurrent) nameCell.appendChild(el("span", "recur-tag", "×1.5"));
    tr.appendChild(nameCell);
    tr.appendChild(el("td", "move", d.label));
    const vd = el("td");
    vd.appendChild(el("span", "vd " + v.cls, v.word));
    tr.appendChild(vd);
    tr.appendChild(el("td", "num", (d.pts > 0 ? "+" : "") + d.pts));
    tbody.appendChild(tr);
  });

  const hadBest = !!readBest();
  const isBest = writeBest(result);
  $("#share-state").textContent = "";
  const nb = $("#new-best");
  if (nb) {
    nb.hidden = !isBest;
    if (isBest) nb.textContent = hadBest ? "New personal best." : "First shift logged.";
  }

  show("end");
  beep("end");
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1200px;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand ? document.execCommand("copy") : false;
    ta.remove();
    return !!ok;
  } catch { return false; }
}

function showShareBox(text) {
  const box = $("#share-box");
  if (!box) return;
  box.hidden = false;
  box.value = text;
  box.focus();
  box.select();
}

async function shareResult() {
  const r = state.lastResult;
  if (!r) return;
  const url = location.origin + location.pathname + "?s=" + r.seed;
  const text = shareText(r, url);
  const out = $("#share-state");
  if (navigator.share) {
    try {
      await navigator.share({ title: "ON-CALL", text, url });
      out.textContent = "Shared.";
      return;
    } catch { /* fall through to clipboard */ }
  }
  if (await copyText(text)) {
    out.textContent = "Result copied to clipboard.";
    return;
  }
  showShareBox(text);
  out.textContent = "Copy already selected below.";
}

async function copyLink() {
  const r = state.lastResult;
  const url = location.origin + location.pathname + "?s=" + (r ? r.seed : "");
  if (await copyText(url)) toast("Shift link copied");
  else { showShareBox(url); toast("Select and copy the link below"); }
}

/* ───────────────────────── bindings ───────────────────────── */
function setSound(on) {
  state.sound = on;
  try { localStorage.setItem(KEY_SOUND, on ? "1" : "0"); } catch {}
  const b = $("#sound-btn");
  b.setAttribute("aria-pressed", String(on));
  b.textContent = on ? "SOUND ON" : "SOUND OFF";
  if (on) {
    audioCtx();
    beep("click");
  }
}

function bind() {
  $("#start-btn").addEventListener("click", () => startShift());
  const replay = () => {
    const raw = $("#seed-input").value.trim();
    if (!raw) return toast("Enter a shift number (6 digits)");
    const seed = seedFromInput(raw);
    if (!seed) return toast("Shift numbers are 6 digits, e.g. 123456");
    startShift(seed);
  };
  $("#start-seed-btn").addEventListener("click", replay);
  $("#seed-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); replay(); }
  });
  $("#again-btn").addEventListener("click", () => startShift());
  $("#share-btn").addEventListener("click", shareResult);
  $("#link-btn").addEventListener("click", copyLink);
  $("#quit-btn").addEventListener("click", () => {
    if (!state.run || state.run.isOver()) return show("title");
    if (confirm("End this shift and go back? The current run will be lost.")) {
      state.token++;
      state.busy = false;
      state.typing = null;
      if (state.timer) { clearTimeout(state.timer); state.timer = null; }
      state.run.finish();
      renderTitle();
      show("title");
    }
  });
  $("#hint-btn").addEventListener("click", consultHint);
  $("#sound-btn").addEventListener("click", () => setSound(!state.sound));

  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const screen = document.body.dataset.screen;
    if (screen === "play") {
      if (e.key >= "1" && e.key <= "4") {
        const b = document.querySelector(`.choice[data-index="${Number(e.key) - 1}"]`);
        if (b && !state.busy) { e.preventDefault(); b.click(); }
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        consultHint();
      } else if (e.key === " " || e.key === "Enter") {
        if (state.typing) { e.preventDefault(); state.skipTyping = true; }
      }
    } else if (screen === "title") {
      if (e.key === "Enter") { e.preventDefault(); startShift(); }
    } else if (screen === "end") {
      if (e.key === "Enter") { e.preventDefault(); startShift(); }
    }
  });

  // skip typewriter on any click inside the log
  $("#log").addEventListener("click", () => { if (state.typing) state.skipTyping = true; });

  document.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => show(b.dataset.goto))
  );
}

function init() {
  let savedSound = false;
  try { savedSound = localStorage.getItem(KEY_SOUND) === "1"; } catch {}
  setSound(savedSound);
  bind();
  renderTitle();
  show("title");

  const s = seedFromUrl();
  if (s) {
    toast("Shift #" + s + " loaded — press Start");
  }
  // expose for tests / debugging
  window.__oncall = { state, startShift, pick, POOL, POOL_STATS };
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

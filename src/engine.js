// ON-CALL engine — pure state machine, no DOM, no globals.
// Everything here is deterministic given (pool, seed) so a shift can be shared by URL.

export const SEV_LABEL = { SEV1: "SEV1", SEV2: "SEV2", SEV3: "SEV3" };

/** Deterministic PRNG (mulberry32). Same seed -> same shift, forever. */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 900000 + 100000;
}

function weightedPick(items, rnd) {
  const total = items.reduce((s, it) => s + (it.weigh || 1), 0);
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    r -= items[i].weigh || 1;
    if (r <= 0) return i;
  }
  return items.length - 1;
}

function bumpSev(sev) {
  if (sev === "SEV3") return "SEV2";
  if (sev === "SEV2") return "SEV1";
  return "SEV1";
}

/** A recurrence is the same incident, angrier: more penalty, more minutes, more damage. */
function makeInstance(inc, { mult = 1, sev = inc.sev, recurrent = false } = {}) {
  return { inc, mult, sev, recurrent, key: recurrent ? inc.id + "#r" + Math.random().toString(36).slice(2, 6) : inc.id };
}

export function pickIncidents(pool, seed, size) {
  const rnd = mulberry32(seed);
  const remaining = pool.slice();
  const chosen = [];
  while (chosen.length < size && remaining.length) {
    const i = weightedPick(remaining, rnd);
    chosen.push(remaining.splice(i, 1)[0]);
  }
  return chosen;
}

export function createRun({ pool, seed, size = 6 }) {
  const picked = pickIncidents(pool, seed, size);
  const st = {
    seed,
    size,
    queue: picked.map((inc) => makeInstance(inc)),
    idx: 0,
    step: 0,
    pts: 0,
    maxPts: 0,
    minutes: 0,
    peak: 0,
    fixed: 0,
    recurrences: 0,
    scheduled: 0,
    decisions: [],
    hintUsed: false,
    stepMaxCounted: false,
    over: false,
    startedAt: Date.now()
  };

  function instance() { return st.queue[st.idx] || null; }
  function stepObj() {
    const inst = instance();
    if (!inst) return null;
    return inst.inc.steps[st.step] || null;
  }

  function countStepMax() {
    const s = stepObj();
    if (!s || st.stepMaxCounted) return;
    let best = 0;
    for (const c of s.choices) best = Math.max(best, c.pts || 0);
    st.maxPts += best;
    st.stepMaxCounted = true;
  }

  function current() {
    if (st.over) return null;
    const inst = instance();
    if (!inst) { finish(); return null; }
    countStepMax();
    const s = stepObj();
    if (!s) { finish(); return null; }
    return {
      incident: inst.inc,
      instance: inst,
      stepIndex: st.step,
      stepCount: inst.inc.steps.length,
      prompt: s.prompt,
      choices: s.choices.map((c, i) => ({ index: i, label: c.label }))
    };
  }

  function hint() {
    const inst = instance();
    if (!inst || st.hintUsed) return null;
    st.hintUsed = true;
    st.pts -= 2;
    st.minutes += 3;
    return inst.inc.hint;
  }

  function choose(index) {
    const inst = instance();
    const s = stepObj();
    if (!inst || !s) return null;
    const choice = s.choices[index];
    if (!choice) return null;

    const pts = Math.round((choice.pts || 0) * inst.mult);
    const minutes = Math.round((choice.min || 0) * inst.mult);
    const customers = Math.round((choice.customers || 0) * inst.mult);

    st.pts += pts;
    st.minutes += minutes;
    st.peak = Math.max(st.peak, customers);
    if (choice.fixesCause) st.fixedThisIncident = true;

    st.decisions.push({
      incident: inst.inc.title,
      recurrent: inst.recurrent,
      step: st.step,
      label: choice.label,
      pts,
      minutes,
      customers,
      fixesCause: !!choice.fixesCause
    });

    st.step++;
    st.stepMaxCounted = false;

    const done = st.step >= inst.inc.steps.length;
    let finished = null;
    if (done) finished = closeIncident();

    return {
      choice,
      say: choice.say,
      pts,
      minutes,
      customers,
      done,
      finished,
      next: done ? null : current()
    };
  }

  function closeIncident() {
    const inst = instance();
    const fixed = !!st.fixedThisIncident;
    const out = {
      id: inst.inc.id,
      title: inst.inc.title,
      sev: inst.sev,
      recurrent: inst.recurrent,
      fixed,
      rootCauses: st.decisions.filter((d) => d.incident === inst.inc.title && d.fixesCause).length
    };
    st.fixedThisIncident = false;
    if (!fixed) {
      st.recurrences++;
      // An unfixed incident comes back once, at a higher severity. A recurrence that
      // you also fail to fix is not an escalator — the shift has to end.
      if (!inst.recurrent && st.scheduled < 3) {
        st.scheduled++;
        const later = Math.min(st.queue.length, st.idx + 3);
        st.queue.splice(later, 0, makeInstance(inst.inc, {
          mult: 1.5,
          sev: bumpSev(inst.sev),
          recurrent: true
        }));
      }
    }
    st.idx++;
    st.step = 0;
    st.stepMaxCounted = false;
    st.hintUsed = false;
    if (st.idx >= st.queue.length) finish();
    return out;
  }

  function finish() {
    st.over = true;
  }

  function isOver() {
    return st.over || st.idx >= st.queue.length;
  }

  function result() {
    const pct = Math.max(0, Math.min(100, Math.round((100 * (st.pts + 45)) / (st.maxPts + 45))));
    const grade = gradeFor(pct);
    const causeFixes = st.decisions.filter((d) => d.fixesCause).length;
    return {
      seed: st.seed,
      grade: grade.letter,
      tagline: grade.tagline,
      pct,
      pts: st.pts,
      maxPts: st.maxPts,
      minutes: st.minutes,
      peak: st.peak,
      fixed: causeFixes,
      recurrences: st.recurrences,
      decisions: st.decisions.slice(),
      incidentCount: st.decisions.length ? st.decisions.length : 0,
      durationMs: Date.now() - st.startedAt
    };
  }

  return { state: st, current, choose, hint, isOver, result, finish };
}

export function gradeFor(pct) {
  if (pct >= 90) return { letter: "S", tagline: "Textbook night. Mitigate, contain, prevent — in that order, every time." };
  if (pct >= 74) return { letter: "A", tagline: "Strong recovery instinct. A couple of fixes were temporary, and you knew it." };
  if (pct >= 58) return { letter: "B", tagline: "Everything went green. The platform still has some of the same bugs in it." };
  if (pct >= 42) return { letter: "C", tagline: "Firefighting all night. The roof stayed on, nothing got built." };
  if (pct >= 24) return { letter: "D", tagline: "You were the incident more than once. That happens — the pattern is what matters." };
  return { letter: "F", tagline: "The pager won. Read the postmortem table, that is where the points were." };
}

export function clockFor(startMinutes, extra) {
  const base = (startMinutes + extra) % (24 * 60);
  const h = Math.floor(base / 60);
  const m = base % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/** Compact share text for clipboard / share sheet. */
export function shareText(result, url) {
  const lines = [
    "ON-CALL — shift #" + result.seed,
    "Grade " + result.grade + " · " + result.pct + "/100 · " + result.minutes + " min on the clock",
    "Peak blast radius " + result.peak.toLocaleString("en-US") + " customers · " + result.fixed + " root-cause fixes · " + result.recurrences + " re-paged",
    url
  ];
  return lines.join("\n");
}

/** Human label for a decision, used by the postmortem table. */
export function verdictFor(pts) {
  if (pts >= 9) return { cls: "good", word: "Best play" };
  if (pts >= 5) return { cls: "good", word: "Solid" };
  if (pts >= 1) return { cls: "warn", word: "Incomplete" };
  if (pts === 0) return { cls: "warn", word: "Neutral" };
  if (pts >= -6) return { cls: "bad", word: "Costly" };
  return { cls: "bad", word: "Blunder" };
}

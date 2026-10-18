// ON-CALL engine — pure state machine, no DOM, no globals.
// Everything here is deterministic given (pool, seed) so a shift can be shared by URL.

export const GRADES = { S: 90, A: 74, B: 58, C: 42, D: 24 };

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

export function isValidSeed(n) {
  return Number.isInteger(n) && n >= 100000 && n <= 999999;
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
  return sev === "SEV3" ? "SEV2" : "SEV1";
}

/** Fisher-Yates over a seeded stream. The right answer is never in the same slot twice. */
function shuffledOrder(n, seedString) {
  const rnd = mulberry32(seedFromString(seedString));
  const order = [];
  for (let i = 0; i < n; i++) order.push(i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  return order;
}

/** A recurrence is the same incident, angrier: more penalty, more minutes, more damage. */
function makeInstance(inc, { mult = 1, sev = inc.sev, recurrent = false, priorLabel = null } = {}) {
  return { inc, mult, sev, recurrent, priorLabel, key: inc.id + (recurrent ? "#r" : "") };
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
    picked: picked.map((i) => i.id),
    idx: 0,
    step: 0,
    pts: 0,
    maxPts: 0,
    minutes: 0,
    peak: 0,
    fixedDecisions: 0,
    fixedIncidents: 0,
    closed: 0,
    recurrences: 0,
    scheduled: 0,
    decisions: [],
    hintUsed: false,
    stepMaxCounted: false,
    orderCache: {},
    over: false,
    startedAt: Date.now()
  };

  const instance = () => st.queue[st.idx] || null;
  const stepObj = () => {
    const inst = instance();
    return inst ? inst.inc.steps[st.step] || null : null;
  };

  /** Per-step display order, memoised so a re-render never reshuffles under the player. */
  function order() {
    const s = stepObj();
    if (!s) return [];
    const inst = instance();
    const key = inst.inc.id + ":" + st.step;
    if (!st.orderCache[key]) {
      st.orderCache[key] = shuffledOrder(s.choices.length, st.seed + "|" + inst.inc.id + "|" + st.step);
    }
    return st.orderCache[key];
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
    if (!inst) { st.over = true; return null; }
    countStepMax();
    const s = stepObj();
    if (!s) { st.over = true; return null; }
    return {
      incident: inst.inc,
      instance: inst,
      stepIndex: st.step,
      stepCount: inst.inc.steps.length,
      prompt: s.prompt,
      choices: order().map((origIndex, viewIndex) => ({
        index: viewIndex,
        origIndex,
        label: s.choices[origIndex].label
      }))
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

  function choose(viewIndex) {
    const inst = instance();
    const s = stepObj();
    if (!inst || !s) return null;
    const origIndex = order()[viewIndex];
    if (origIndex === undefined) return null;
    const choice = s.choices[origIndex];
    if (!choice) return null;

    const pts = Math.round((choice.pts || 0) * inst.mult);
    const minutes = Math.round((choice.min || 0) * inst.mult);
    const customers = Math.round((choice.customers || 0) * inst.mult);

    st.pts += pts;
    st.minutes += minutes;
    st.peak = Math.max(st.peak, customers);
    if (choice.fixesCause) {
      st.fixedDecisions++;
      st.fixedThisIncident = true;
    }

    st.decisions.push({
      incident: inst.inc.title,
      incidentId: inst.inc.id,
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
    const finished = done ? closeIncident() : null;

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
    const lastLabel = st.decisions.length ? st.decisions[st.decisions.length - 1].label : null;
    st.closed++;
    if (fixed) st.fixedIncidents++;

    const out = {
      id: inst.inc.id,
      title: inst.inc.title,
      sev: inst.sev,
      recurrent: inst.recurrent,
      fixed
    };

    st.fixedThisIncident = false;
    if (!fixed) {
      st.recurrences++;
      // An unfixed incident comes back once, at a higher severity. A recurrence you also
      // fail to fix is not an escalator — the shift has to end.
      if (!inst.recurrent && st.scheduled < 3) {
        st.scheduled++;
        const later = Math.min(st.queue.length, st.idx + 3);
        st.queue.splice(later, 0, makeInstance(inst.inc, {
          mult: 1.5,
          sev: bumpSev(inst.sev),
          recurrent: true,
          priorLabel: lastLabel
        }));
      }
    }

    st.idx++;
    st.step = 0;
    st.stepMaxCounted = false;
    st.hintUsed = false;
    if (st.idx >= st.queue.length) st.over = true;
    return out;
  }

  function finish() { st.over = true; }
  const isOver = () => st.over || st.idx >= st.queue.length;

  function result() {
    const decisionPct = Math.max(0, Math.min(100, Math.round((100 * (st.pts + 45)) / (st.maxPts + 45))));
    const closurePct = st.closed ? Math.round((100 * st.fixedIncidents) / st.closed) : 100;
    // 70% of the grade is what you chose, 30% is whether the cause actually got fixed.
    const pct = Math.max(0, Math.min(100, Math.round(decisionPct * 0.7 + closurePct * 0.3)));
    const grade = gradeFor(pct);
    return {
      seed: st.seed,
      grade: grade.letter,
      tagline: grade.tagline,
      pct,
      decisionPct,
      closurePct,
      pts: st.pts,
      maxPts: st.maxPts,
      minutes: st.minutes,
      peak: st.peak,
      fixed: st.fixedDecisions,
      fixedIncidents: st.fixedIncidents,
      closed: st.closed,
      recurrences: st.recurrences,
      decisions: st.decisions.slice(),
      picked: st.picked.slice(),
      durationMs: Date.now() - st.startedAt
    };
  }

  return { state: st, current, choose, hint, isOver, result, finish };
}

export function gradeFor(pct) {
  if (pct >= 90) return { letter: "S", tagline: "Every incident closed properly, and nothing caught fire on the way." };
  if (pct >= 74) return { letter: "A", tagline: "Strong night. A couple of fixes were temporary, and you knew it at the time." };
  if (pct >= 58) return { letter: "B", tagline: "Everything went green. Some of the causes are still in the system." };
  if (pct >= 42) return { letter: "C", tagline: "Firefighting all night. The roof stayed on, nothing got built." };
  if (pct >= 24) return { letter: "D", tagline: "You were the incident more than once. That happens. The pattern is what matters." };
  return { letter: "F", tagline: "The pager won. The postmortem table shows exactly where it went." };
}

export function clockFor(startMinutes, extra) {
  const base = (startMinutes + extra) % (24 * 60);
  const h = Math.floor(base / 60);
  const m = base % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/** Share text — a challenge, not a receipt. */
export function shareText(result, url) {
  return [
    `I got ${result.grade} on six incidents — ${result.pct}/100, ${result.fixedIncidents} of ${result.closed} causes actually fixed.`,
    `Can you beat it? Same shift, same incidents: ${url}`,
    `Peak blast ${result.peak.toLocaleString("en-US")} customers · ${result.recurrences} re-paged`
  ].join("\n");
}

export function verdictFor(pts) {
  if (pts >= 9) return { cls: "good", word: "Best play" };
  if (pts >= 5) return { cls: "good", word: "Solid" };
  if (pts >= 1) return { cls: "warn", word: "Incomplete" };
  if (pts === 0) return { cls: "warn", word: "Neutral" };
  if (pts >= -6) return { cls: "bad", word: "Costly" };
  return { cls: "bad", word: "Blunder" };
}

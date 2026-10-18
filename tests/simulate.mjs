#!/usr/bin/env node
// Headless playthrough simulator — proves the game cannot dead-end, stall, or score out of range.
// Usage: node tests/simulate.mjs [--runs=200]
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRun, gradeFor, mulberry32, pickIncidents } from "../src/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

const argRuns = process.argv.find((a) => a.startsWith("--runs="));
const RUNS = argRuns ? parseInt(argRuns.slice(7), 10) : 200;

const files = readdirSync(DATA).filter((f) => f.endsWith(".js"));
const pool = [];
for (const f of files) {
  const mod = await import(pathToFileURL(join(DATA, f)).href);
  if (Array.isArray(mod.pack)) pool.push(...mod.pack);
}
console.log(`pool: ${pool.length} incidents from ${files.length} packs`);

const fail = (msg) => { console.error("✗ " + msg); process.exitCode = 1; };

// ── 1. every incident is playable from start to finish, all paths ──────────────
for (const inc of pool) {
  for (let si = 0; si < inc.steps.length; si++) {
    if (!inc.steps[si].choices.length) fail(`${inc.id} step ${si} has no choices`);
  }
  // play the single-incident run with each strategy
  for (const strategy of ["best", "worst", "middle"]) {
    const run = createRun({ pool: [inc], seed: 1234, size: 1 });
    let guard = 0;
    while (!run.isOver() && guard++ < 50) {
      const cur = run.current();
      if (!cur) break;
      if (!cur.choices.length) { fail(`${inc.id} dead end at step ${cur.stepIndex}`); break; }
      // choices are served in a seeded shuffled order — map the view index back to the data
      const pts = cur.choices.map((c) => inc.steps[cur.stepIndex].choices[c.origIndex].pts);
      let idx = 0;
      if (strategy === "best") idx = pts.indexOf(Math.max(...pts));
      if (strategy === "worst") idx = pts.indexOf(Math.min(...pts));
      if (strategy === "middle") idx = Math.floor(cur.choices.length / 2);
      const res = run.choose(idx);
      if (!res) { fail(`${inc.id} choose() returned null at step ${guard}`); break; }
    }
    if (!run.isOver()) fail(`${inc.id} did not terminate under ${strategy} play`);
    const r = run.result();
    if (!/^[SABCDF]$/.test(r.grade)) fail(`${inc.id} invalid grade ${r.grade}`);
    if (strategy === "best" && !["S", "A"].includes(r.grade)) fail(`${inc.id} best play graded ${r.grade} (${r.pct}) — reward curve too harsh`);
    if (strategy === "worst" && !["D", "F", "C"].includes(r.grade)) fail(`${inc.id} worst play graded ${r.grade} (${r.pct}) — punishment too soft`);
  }
}

// ── 2. random multi-incident shifts: no crash, no stall, bounded score ────────
const rnd = mulberry32(7);
let worstPts = Infinity, bestPts = -Infinity;
const grades = {};
let totalStepsPlayed = 0;
let recursionSeen = 0;

for (let i = 0; i < RUNS; i++) {
  const seed = 100000 + Math.floor(rnd() * 899999);
  const run = createRun({ pool, seed, size: 6 });
  let guard = 0;
  let sawRecurrence = false;
  while (!run.isOver() && guard++ < 400) {
    const cur = run.current();
    if (!cur) break;
    if (cur.instance.recurrent) sawRecurrence = true;
    const n = cur.choices.length;
    if (n < 2) fail(`seed ${seed}: step with ${n} choice(s)`);
    // favour decent play most of the time, blunder sometimes
    const roll = rnd();
    let idx;
    if (roll < 0.55) idx = 0;               // content convention: best play is often first
    else if (roll < 0.8) idx = Math.min(1, n - 1);
    else idx = n - 1;                        // usually the blunder
    run.choose(idx);
    totalStepsPlayed++;
  }
  if (!run.isOver()) fail(`seed ${seed}: shift did not terminate after 400 steps`);
  const r = run.result();
  if (r.pts < -600 || r.pts > 900) fail(`seed ${seed}: absurd score ${r.pts} (max ${r.maxPts})`);
  if (r.pct < 0 || r.pct > 100) fail(`seed ${seed}: pct out of range ${r.pct}`);
  if (r.minutes < 0 || r.minutes > 1200) fail(`seed ${seed}: absurd minutes ${r.minutes}`);
  if (r.decisions.length < 6) fail(`seed ${seed}: only ${r.decisions.length} decisions in a shift`);
  grades[r.grade] = (grades[r.grade] || 0) + 1;
  worstPts = Math.min(worstPts, r.pts);
  bestPts = Math.max(bestPts, r.pts);
  if (sawRecurrence) recursionSeen++;
}

// ── 3. coverage: over many seeds every pool incident must appear at least once ─
const seen = new Set();
for (let s = 0; s < 400; s++) pickIncidents(pool, 100000 + s * 7919, 6).forEach((i) => seen.add(i.id));
const unseen = pool.map((i) => i.id).filter((id) => !seen.has(id));
if (unseen.length) fail(`never selected in 400 seeds: ${unseen.join(", ")}`);

// ── 4. all three severities exist in the pool ─────────────────────────────────
const sevs = new Set(pool.map((i) => i.sev));
if (sevs.size < 3) fail(`pool only covers severities: ${[...sevs].join(", ")}`);

// ── 5. the answer is not always in the same slot (regression: was first 45/46) ─
const posCounts = [0, 0, 0, 0];
let posTotal = 0;
for (let s = 0; s < 60; s++) {
  for (const inc of pool) {
    const run = createRun({ pool: [inc], seed: 100000 + s, size: 1 });
    let guard = 0;
    while (!run.isOver() && guard++ < 20) {
      const cur = run.current();
      if (!cur) break;
      const pts = cur.choices.map((c) => inc.steps[cur.stepIndex].choices[c.origIndex].pts);
      const bestPos = pts.indexOf(Math.max(...pts));
      posCounts[bestPos]++;
      posTotal++;
      run.choose(bestPos);
    }
  }
}
const posShare = posCounts.map((n) => n / posTotal);
console.log(`best-choice position share: ${posShare.map((p, i) => i + ":" + (p * 100).toFixed(1) + "%").join("  ")}`);
if (Math.max(...posShare) > 0.45) fail(`positional bias: ${(Math.max(...posShare) * 100).toFixed(0)}% of best plays land in one slot`);

// ── 6. "always pick the first option" must not be a winning strategy ──────────
let firstPct = 0, firstCount = 0, firstAllS = true;
for (let i = 0; i < 40; i++) {
  const run = createRun({ pool, seed: 200000 + i, size: 6 });
  let guard = 0;
  while (!run.isOver() && guard++ < 200) {
    const cur = run.current();
    if (!cur) break;
    run.choose(0);
  }
  const r = run.result();
  firstPct += r.pct; firstCount++;
  if (r.grade !== "S") firstAllS = false;
}
const firstMean = firstPct / Math.max(1, firstCount);
console.log(`always-pick-first: mean ${firstMean.toFixed(1)}/100, all-S=${firstAllS}`);
if (firstMean > 85) fail(`always picking the first option averages ${firstMean.toFixed(1)} — answer key is positional`);
if (firstAllS) fail("always picking the first option grades S every time");

console.log(`\nshifts simulated: ${RUNS} · decisions played: ${totalStepsPlayed}`);
console.log(`score range: ${worstPts} .. ${bestPts}`);
console.log(`grades: ${Object.entries(grades).sort().map(([g, n]) => g + "=" + n).join("  ")}`);
console.log(`shifts that hit a recurrence: ${recursionSeen}/${RUNS}`);
console.log(`pool coverage: ${seen.size}/${pool.length} incidents reachable`);

if (!process.exitCode) console.log("\n✓ simulation clean");

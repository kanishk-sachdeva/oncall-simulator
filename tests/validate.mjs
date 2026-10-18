#!/usr/bin/env node
// Content validator — checks every incident pack against CONTENT-SPEC.md.
// Usage: node tests/validate.mjs [--strict]
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

const LINE_CLASSES = new Set(["cmd", "out", "good", "bad", "warn", "note", "said", "head"]);
const TAGS = new Set(["k8s", "aws", "deploy", "database", "network", "tls", "cost", "queue", "observability", "comms", "iac", "security", "oncall"]);
const SEVS = new Set(["SEV1", "SEV2", "SEV3"]);

const errors = [];
const warnings = [];
let totalIncidents = 0;
let totalSteps = 0;
let totalChoices = 0;
const ids = new Map();
const files = [];

function err(file, id, msg) { errors.push(`${file}${id ? " [" + id + "]" : ""}: ${msg}`); }
function warn(file, id, msg) { warnings.push(`${file}${id ? " [" + id + "]" : ""}: ${msg}`); }

const isInt = (n) => typeof n === "number" && Number.isInteger(n);

function validateIncident(file, inc, seenIds) {
  const id = inc && inc.id;
  if (!inc || typeof inc !== "object") return err(file, "", "incident is not an object");
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{2,60}$/.test(id)) err(file, id, "id must be kebab-case, 3-61 chars");
  else if (seenIds.has(id) || ids.has(id)) err(file, id, "duplicate id");
  seenIds.add(id);
  ids.set(id, file);

  if (typeof inc.title !== "string" || inc.title.length < 4 || inc.title.length > 42) err(file, id, `title must be 4-42 chars (got ${inc.title ? inc.title.length : "none"})`);
  if (!SEVS.has(inc.sev)) err(file, id, `sev must be SEV1|SEV2|SEV3 (got ${inc.sev})`);
  if (!Array.isArray(inc.tags) || inc.tags.length < 1 || inc.tags.length > 4) err(file, id, "tags must be 1-4 items");
  else inc.tags.forEach((t) => { if (!TAGS.has(t)) err(file, id, `unknown tag "${t}"`); });
  if (!isInt(inc.weigh) || inc.weigh < 1 || inc.weigh > 3) err(file, id, "weigh must be 1..3");
  if (typeof inc.hint !== "string" || inc.hint.length < 20) err(file, id, "hint must be a sentence (>=20 chars)");
  if (!Array.isArray(inc.open) || inc.open.length < 2 || inc.open.length > 6) err(file, id, "open must be 2-6 lines");

  (inc.open || []).forEach((l, i) => lineCheck(file, id, l, `open[${i}]`));

  if (!Array.isArray(inc.steps) || inc.steps.length < 1 || inc.steps.length > 4) {
    return err(file, id, "steps must be 1-4");
  }

  inc.steps.forEach((step, si) => {
    totalSteps++;
    if (!step.prompt || step.prompt.length > 60) err(file, id, `steps[${si}].prompt missing or >60 chars`);
    if (!Array.isArray(step.choices) || step.choices.length < 2 || step.choices.length > 4) {
      return err(file, id, `steps[${si}] must have 2-4 choices`);
    }
    let best = -99, worst = 99, bestCount = 0, blunderCount = 0;
    const labels = new Set();
    step.choices.forEach((c, ci) => {
      totalChoices++;
      const where = `steps[${si}].choices[${ci}]`;
      if (!c || typeof c !== "object") return err(file, id, `${where} is not an object`);
      if (typeof c.label !== "string" || c.label.length < 6 || c.label.length > 78) err(file, id, `${where}.label must be 6-78 chars (got ${c.label ? c.label.length : "none"})`);
      if (labels.has(c.label)) err(file, id, `${where}.label duplicates another choice in the same step`);
      labels.add(c.label);
      if (!isInt(c.pts) || c.pts < -15 || c.pts > 10) err(file, id, `${where}.pts must be integer -15..10 (got ${c.pts})`);
      if (!isInt(c.min) || c.min < 1 || c.min > 40) err(file, id, `${where}.min must be integer 1..40 (got ${c.min})`);
      if (!isInt(c.customers) || c.customers < 0) err(file, id, `${where}.customers must be integer >= 0`);
      if (typeof c.fixesCause !== "boolean") err(file, id, `${where}.fixesCause must be boolean`);
      if (!Array.isArray(c.say) || c.say.length < 2 || c.say.length > 6) err(file, id, `${where}.say must be 2-6 lines`);
      else c.say.forEach((l, li) => lineCheck(file, id, l, `${where}.say[${li}]`));
      if (isInt(c.pts)) {
        best = Math.max(best, c.pts);
        worst = Math.min(worst, c.pts);
      }
    });
    step.choices.forEach((c) => {
      if (c.pts >= 9) bestCount++;
      if (c.pts <= -6) blunderCount++;
    });
    if (bestCount === 0) err(file, id, `steps[${si}] has no best-play choice (pts >= 9)`);
    if (bestCount > 1) err(file, id, `steps[${si}] has ${bestCount} choices scoring >= 9 (want exactly 1)`);
    if (step.choices.length >= 3 && blunderCount === 0) err(file, id, `steps[${si}] has no blunder (pts <= -6)`);
  });

  const anyFix = inc.steps.some((s) => s.choices.some((c) => c.fixesCause));
  if (!anyFix) warn(file, id, "no choice anywhere fixes the cause — the incident can never be closed out");
}

function lineCheck(file, id, line, where) {
  if (!Array.isArray(line) || line.length !== 2) return err(file, id, `${where} must be a [class, text] pair`);
  const [cls, text] = line;
  if (!LINE_CLASSES.has(cls)) err(file, id, `${where} class "${cls}" not allowed`);
  if (typeof text !== "string" || text.length < 2) err(file, id, `${where} text missing`);
  if (text.length > 170) warn(file, id, `${where} is ${text.length} chars (phone-hostile, aim <=160)`);
  if (/[!]{1,}/.test(text) && cls !== "said") warn(file, id, `${where} contains an exclamation mark`);
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) err(file, id, `${where} contains an emoji`);
}

const only = process.argv.find((a) => a.startsWith("--file="));
let entries = [];
try {
  entries = readdirSync(DATA).filter((f) => f.endsWith(".js") && (!only || f === only.slice(7)));
} catch (e) {
  console.error("No data directory:", DATA);
  process.exit(1);
}

if (!entries.length) {
  console.error("No pack files found in " + DATA);
  process.exit(1);
}

for (const file of entries.sort()) {
  let mod;
  try {
    mod = await import(pathToFileURL(join(DATA, file)).href);
  } catch (e) {
    err(file, "", "failed to import: " + e.message);
    continue;
  }
  const pack = mod.pack;
  if (!Array.isArray(pack)) { err(file, "", "does not export `pack` as an array"); continue; }
  const seen = new Set();
  for (const inc of pack) {
    totalIncidents++;
    validateIncident(file, inc, seen);
  }
  files.push(`${file}: ${pack.length} incidents`);
}

console.log("── packs ──");
files.forEach((f) => console.log("  " + f));
console.log(`\ntotals: ${totalIncidents} incidents · ${totalSteps} steps · ${totalChoices} choices · ${ids.size} unique ids`);

const bestPerStep = Math.round((totalChoices / Math.max(totalSteps, 1)) * 10) / 10;
console.log(`avg choices per step: ${bestPerStep}`);

if (warnings.length) {
  console.log(`\n── ${warnings.length} warning(s) ──`);
  warnings.slice(0, 40).forEach((w) => console.log("  ~ " + w));
  if (warnings.length > 40) console.log(`  ... ${warnings.length - 40} more`);
}

if (errors.length) {
  console.log(`\n✗ ${errors.length} error(s)`);
  errors.slice(0, 60).forEach((e) => console.log("  ✗ " + e));
  if (errors.length > 60) console.log(`  ... ${errors.length - 60} more`);
  process.exit(1);
}

console.log("\n✓ all packs valid");

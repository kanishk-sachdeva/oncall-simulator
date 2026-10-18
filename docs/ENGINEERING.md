# Engineering notes — ON-CALL

Read this before changing anything. It exists so an agent (or a human) can make a correct change
without reverse-engineering the project.

## What this is

A static, dependency-free browser game. `index.html` + `assets/app.css` + ES modules under `src/`
and `data/`. No build step, no framework, no package.json, no runtime network calls.

## The one hard rule

**Content lives in `data/`, logic in `src/engine.js`, DOM in `src/app.js`.** Do not put incident
text in `app.js`, and do not put DOM access in `engine.js` — the test harness imports the engine in
Node, where `document` does not exist.

## Data contract

`CONTENT-SPEC.md` is frozen. Every incident is:

```
{ id, title, sev, tags, weigh, open[], hint,
  steps[{ prompt, choices[{ label, pts, min, customers, fixesCause, say[[cls,text]] }] }] }
```

Per step: 3-4 choices, exactly one scoring ≥ 9 (the right play) and exactly one ≤ −6 (the blunder a
tired engineer actually makes). Line classes are limited to `cmd | out | good | bad | warn | note |
said | head`.

`fixesCause: true` is the spine of the game: it is what stops the incident being re-queued as a
recurrence. A choice that hides the symptom well scores points but must leave `fixesCause: false`.

## Verify before claiming done

```bash
node tests/validate.mjs      # schema + quality gates, exit 1 on failure
node tests/simulate.mjs      # 200 shifts x 3 strategies; dead ends, stalls, score bounds, coverage
python3 -m http.server 8125  # then play a full shift in a real browser
```

A green `node --check` is not verification. Play a shift to the postmortem screen.

## Engine invariants (do not break these)

- Deterministic: same `seed` → same shift, forever.
- Terminating: an unfixed incident recurs **once**, and at most 3 recurrences are scheduled per
  shift. Removing that cap creates an infinite shift — the tests will hang.
- `maxPts` accumulates from the steps actually served, so the grade stays fair when recurrences add
  steps mid-shift.

## Style

Dark neutral palette, monospace, amber accent, table-first; no glassmorphism, no decorative
gradients, no colour-only meaning (good/bad lines also carry ✓ / ✕ marks). Respect
`prefers-reduced-motion` for anything animated.

## Deploy

```bash
vercel deploy --prod --yes
curl -sL https://oncall-simulator.vercel.app | grep -o '<title>[^<]*</title>'
```

The production alias is the public URL; the per-deployment `<project>-<hash>-<team>.vercel.app` URL
can be auth-walled. Never print secret values.

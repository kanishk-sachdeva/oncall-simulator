# Gameplay and balance audit

Scope: 23 incidents, 46 steps, 40 seeded shifts, plus exhaustive data inspection.

## Ranked findings

### HIGH — positional answer key is effectively “press 1”
**Player experience:** 45/46 steps put the highest-point choice first; only `core-checkout-oom` step 1 puts it second. No best choice is third or fourth. The first option is therefore a reliable S-grade strategy, not a consequence of reasoning. In 100 six-incident shifts, always-first graded S 100/100 (99–100%). Always-highest-points also graded S 100/100.

**Positional distribution:** first 45 (97.8%), second 1 (2.2%), third 0 (0%), fourth 0 (0%). Per-step list: `core-checkout-oom`: 2,1,1; every other incident’s steps: 1. (Steps are incident order in each data file.)

**Fix:** rebalance every `data/*.js` step so the best play is distributed roughly 25/25/25/25 across positions, while preserving one best and one blunder. Add a validator in `tests/validate.mjs` that fails if any position exceeds 50% across the pool.

### HIGH — scoring rewards diagnosis even when it does not fix the incident
**Player experience:** The highest-point choice is often a diagnosis with `fixesCause:false`; the player can select option 1 repeatedly and still reach S because later “best” choices carry enough points. Since `pts` is the only scoring input, a player can optimize the visible number rather than mitigation, containment, and prevention. The simulation’s “best” and always-first results confirm the exploit.

**Fix:** `src/engine.js` / `data/*.js`: make the grade reward root-cause closure explicitly (for example, a recurrence penalty or fixed-incident bonus), and ensure the intended best play is not merely the largest `pts` value. Keep diagnosis valuable but not grade-optimal by itself. Extend `tests/simulate.mjs` with an always-first and diagnosis-only strategy assertion.

### HIGH — recurrence is legible only after the player has already failed
**Player experience:** The recurrence banner says “the incident you did not finish properly,” but does not identify which earlier choice left the cause active, what changed, or why severity and penalties increased. A first-time player can understand that it is punishment, but not the causal lesson. The end screen shows a recurrence count, not a per-incident explanation.

**Fix:** `src/app.js` and `src/engine.js`: retain the prior incident’s unresolved cause/last incomplete choice and render it in the recurrence opening, e.g. “You rolled back symptoms but did not remove X; this returns at SEV1, penalties ×1.5.” Add the multiplier and a short “how to prevent recurrence” line to the postmortem row.

### MED — careless play is harsher than the stated difficulty promise
**Player experience:** A 100-seed worst-choice run produced F 100/100 and 0% every time; the 40-run mixed simulation ranged from -21 points and included F/D, while attentive play is uniformly S. There is no meaningful learning band between “press the obvious first answer” and catastrophic failure.

**Fix:** `src/engine.js`: reduce the number/weight of catastrophic blunders or make some wrong choices recoverable in later steps. Preserve real damage, but target careless multi-incident play mostly at C–D, with F reserved for repeated high-blast-radius blunders and failed recurrences. Re-run the 200-shift simulation after tuning.

### MED — runbook hoarding is usually correct
**Player experience:** The hint costs only 2 points and 3 minutes, once per incident. It gives the intended root-cause direction without consuming a decision. Because the grade is point-based and time is not a grade threshold, consulting it is usually a safe purchase whenever uncertain; the only downside is a small fixed score loss.

**Fix:** `src/engine.js` / `src/app.js`: make the trade consequential but fair—e.g. charge a modest severity-scaled time cost, or make the runbook consume a limited shift-level budget while clearly showing the trade. Alternatively add a small bonus for solving without it. Test that cautious use remains viable for A, not mandatory for S.

### MED — incident shapes repeat more than the pool count suggests
**Player experience:** Many incidents follow the same three-beat template: inspect the recently changed/configured artifact, choose a scoped mitigation, then make the fix durable. The vocabulary changes (Kubernetes, DNS, TLS, database, Kafka), but the interaction rhythm and answer ordering are nearly identical. First steps are especially repetitive diagnosis prompts and often have no customer impact.

**Fix:** `data/*.js`: vary decision structure and consequence timing: include at least a few incidents with a communication-vs-mitigation fork, competing partial fixes, or a reversible action whose value depends on observed telemetry. Keep 2–3 steps, but make later prompts respond to the chosen earlier action rather than replaying the same pattern.

### LOW — long opening/log text delays the first meaningful choice
**Player experience:** Each incident opens with 3–5 typewritten lines, then every choice emits 2–6 more lines. Across a six-incident shift this can feel like reading a postmortem instead of operating, especially when the player already understands the domain.

**Fix:** `data/*.js` and `src/app.js`: cap routine opening narration at 3 short lines and expose “skip/continue” consistently for typewriter output. Put the teaching sentence after the decision, where it earns attention.

### LOW — one incident can legitimately display peak blast radius as 0
**Player experience:** `core-statuspage-comms` has no choice with `customers > 0`, so a complete run of it alone shows Peak blast radius `0`, even though communication choices describe customer impact. That can read as “no customers were affected” rather than “this incident measured no direct decision blast radius.”

**Fix:** `data/core.js` and `src/app.js`: give the incident’s direct-impact decision an explicit customer count, or label the metric “decision blast radius” and add a separate reported-impact field. Add a regression test for nonzero-impact incidents and clarify the zero case in the HUD/postmortem.

## Verification notes

`node tests/simulate.mjs --runs=40` passed: 670 decisions, all 23 incidents reachable, recurrence in 40/40 shifts. The harness validates termination and score bounds, but does not detect positional bias, always-first play, or recurrence comprehension; add those checks alongside the fixes.

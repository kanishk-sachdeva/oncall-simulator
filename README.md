# ON-CALL — the platform incident simulator

A small, free, dependency-free browser game about being the on-call platform engineer.
Six incidents, one night, one shift. Every decision moves the clock, burns error budget, and
decides whether the incident comes back before the shift ends.

**Live:** https://oncall-simulator.vercel.app

## Why it exists

Most "SRE training" is a slide deck about blameless postmortems. This is the other thing: the
muscle memory of mitigate → contain → prevent, learned by making the tempting mistake in a
sandbox instead of in production at 02:11.

The teaching mechanism is not a quiz. It is **recurrence**: if you only patched the symptom,
the same incident is scheduled back into your shift, at a higher severity, with every penalty
multiplied by 1.5. You feel the cost of a shallow fix inside the same run.

## Stack

No framework, no bundler, no dependencies, no network calls at runtime.

```
index.html            markup + SEO/OG metadata + JSON-LD
assets/app.css        the whole design system
assets/og.png         1200x630 social card
assets/og-card.html   the source of that card (rendered in a browser, screenshotted)
src/engine.js         pure state machine: seeded RNG, queue, recurrence, scoring, grading
src/pool.js           merges the data packs into one pool
src/app.js            DOM, typewriter, HUD, keyboard, share, localStorage
data/core.js          the six original incidents
data/pack-*.js       k8s / db / net / change / observability packs
tests/validate.mjs    schema + content-quality checks over every pack
tests/simulate.mjs    headless playthroughs: dead ends, stalls, score bounds, coverage
CONTENT-SPEC.md       the frozen data contract (read this before adding an incident)
```

## Run it

```bash
python3 -m http.server 8125    # then open http://127.0.0.1:8125
```

ES modules require a server; `file://` will not work.

## Test it

```bash
node tests/validate.mjs        # exits 1 on any schema or quality violation
node tests/simulate.mjs        # 200 seeded shifts, three strategies each
```

`simulate.mjs` asserts the things a player would notice: every incident terminates under best,
worst and middle play, no step is a dead end, scores stay in a sane range, and every incident in
the pool is actually reachable over 400 seeds.

## Deploy

```bash
vercel deploy --prod --yes
```

Static, zero-config. `vercel.json` adds cache headers and a strict CSP.

## Adding an incident

1. Read `CONTENT-SPEC.md`.
2. Add it to the most fitting `data/pack-*.js`.
3. `node tests/validate.mjs && node tests/simulate.mjs`.
4. Bump nothing manually — pool stats on the title screen read from the data.

## Scoring

`pct = 100 * (pts + 45) / (maxPts + 45)`, clamped to 0..100, then graded
S ≥ 90, A ≥ 74, B ≥ 58, C ≥ 42, D ≥ 24, else F. The offset keeps a cautious, non-optimal
night from grading F; only real damage does that.

## Credits

Built by [Kanishk Sachdeva](https://kanishksachdeva.com). Every incident is a composite of
stories people tell in postmortems — no single company, team or individual is depicted.

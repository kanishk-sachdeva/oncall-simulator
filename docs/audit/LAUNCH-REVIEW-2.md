# ON-CALL launch review 2

**GO — ready for a public post now.**

## Blocker closure

| Previous blocker | Status | Evidence checked |
|---|---|---|
| Rework the OG image and share copy around a challenge and “play the same shift,” instead of an unexplained B | **Closed** | `assets/og-card.html` now leads with “02:11 / The pager goes off,” a SEV1 page, “Six incidents. Thirteen decisions. One postmortem,” and a prominent “PLAY THE SHIFT” CTA. The rendered `assets/og.png` is 1200×630 and visibly matches that design: no unexplained grade, with the symptom-versus-cause challenge stated. `shareText()` in `src/engine.js` says “I got [grade] ... Can you beat it? Same shift, same incidents: [URL]”. |
| Replace the title lede with a short concrete promise naming the decisions and postmortem result | **Closed** | The live page and `index.html` use “The pager goes off at 02:11.” The lede explicitly says the player is the platform engineer, works six incidents by choosing what to inspect, mitigate, and fix, then receives a postmortem, grade, and link the team can try to beat. It also states the recurrence consequence of patching only the symptom. |
| Add a one-click “beat my score” loop whose pasted text carries grade, score, and URL together | **Closed** | `src/engine.js` `shareText(result, url)` includes the grade, `${result.pct}/100`, and the same-shift URL in one generated text payload, plus “Can you beat it?” and “Same shift, same incidents.” `src/app.js` wires the one-click Share result action to native share or clipboard, with a selectable fallback share box. The share URL is `?s=<seed>`, and the replay input accepts that six-digit seed. |

## New issues introduced or remaining

### Medium — OG image alt text is stale and contradicts the rendered card

`index.html` still declares `og:image:alt` as “a terminal-style incident simulator with a giant grade letter,” but the new rendered card intentionally has no grade letter and instead presents the pager/challenge/“Play the shift” treatment. This will not block posting, but it is an inconsistent accessibility/social-metadata description and should be changed to describe the pager and CTA before the next deploy.

### Low — OG description could carry the explicit challenge CTA

The rendered image and copied share text clearly provide the challenge, while `og:description` remains primarily a scenario description (“If you only patch the symptom…”). This is acceptable for launch and not a blocker; adding “Play the same shift and see if you can beat the result” would make text-only unfurls stronger.

No prior accepted cosmetic or voice findings were re-litigated. The live title page was checked at `https://oncall-simulator.vercel.app/`; it renders the revised hero/lede and replay/share-oriented promise. Source and rendered-card checks agree with the fix log.

## Who to post to first

Post first to a small group of platform/SRE and incident-management peers who will recognize the tradeoffs and can validate whether the decisions feel credible: former on-call teammates, SRE communities, and a few trusted engineers. Ask them to play the same shift and try to beat the score, then use their reactions and share links as the signal before pushing the post broadly to LinkedIn, X, or Hacker News.

# Audit response — what was found and what changed

Five review passes ran against v2 (before launch): gameplay balance, technical accuracy, WCAG 2.2 AA,
frontend robustness/security, and launch/voice. Reports: `GAMEPLAY.md`, `ACCURACY.md`, `A11Y.md`,
`FRONTEND.md`, `LAUNCH.md`. This is the fix log.

## Gameplay

| Finding | Fix | Verified by |
|---|---|---|
| **The best choice was first in 45 of 46 steps** — "press 1" graded S every time | Choices are now shuffled per step by a seeded Fisher-Yates (`src/engine.js`, `order()`), memoised so a re-render never reshuffles under the player | new bias test: positions now 35.9 / 32.5 / 30.9 / 0.6 %. "always pick first" averages **25.9/100**, not S |
| Points alone rewarded diagnosis over repair | Grade is now **70% decisions + 30% root-cause closure** (`result()`), and the postmortem states the split | 40 greedy-best shifts mean **100.0, all S**; careless play lands C/D/F |
| Recurrence was legible only after failing | The recurrence now prints the severity bump, the ×1.5 multiplier, **the exact choice that left the cause in place**, and the runbook line for that incident | E2E run showed 4 recurrence rows + ×1.5 tags |
| One incident could never close (no `fixesCause` anywhere) | `core-statuspage-comms` best/comms choices now set `fixesCause: true` | simulate.mjs best-play assertion passes |

## Technical accuracy (15 delegated incidents)

- `kubectl cordon -l …` → `kubectl get nodes -l … -o name | xargs -r kubectl cordon` (cordon takes no selector)
- `terminate-instance-in-auto-scaling-group …` → real `--instance-id` / `--should-decrement-desired-capacity false`
- Aurora: `412 active` → `412 total (limit 400)`, and `pg_stat_activity` states now sum to 412
- `modify-db-parameter-group` gained `--db-parameter-group-name` and `ApplyMethod=pending-reboot`
- DynamoDB contributor insights: `describe-contributor-insights` → `cloudwatch get-insight-rule-report` (the former returns config, not top keys)
- TLS: annotating a Service with `acm-cert-arn` → `alb.ingress.kubernetes.io/certificate-arn` on the Ingress
- Terraform: `get-item` gained `--key`, `force-unlock` takes a lock ID, not a backend path (3 places)
- ArgoCD: `--ignore-differences Secret` → a scoped `group=,kind=Secret,name=…,namespace=…` selector
- Cost Explorer: end date is exclusive, and the group-by needs `Key=`; **41.2 GB at $0.045/GB is $1.85, not $1,184** — the payload is now 26.3 TB, which matches the dollar figure
- `create-vpc-endpoint` gained `--vpc-id`, `--vpc-endpoint-type Gateway`, `--route-table-ids`
- Kafka: consumer-group output now carries the real columns; `--offset-json` → `--offset-json-file`
- `promtool query instant` → `curl .../api/v1/query?query=up`; placeholder status API and feature-flag URLs made executable

## Accessibility (WCAG 2.2 AA)

- `--text-4` was **2.34:1** — now `#868d9c` (**4.73:1 worst case**); `--text-3` was 3.80:1 → `#98a0ad` (5.97:1)
- Interactive borders moved to `--control-border: #6b7280` (≥3.2:1, 1.4.11); icon/runbook targets are now ≥34px, choice cards ≥44px
- **Announcement storm**: the log no longer carries `aria-live`; each completed line is announced once via a dedicated `#announcer` region
- Focus moves to the first choice when a step renders; ↑ the seed input no longer swallows global shortcuts
- HUD converted to a definition list; play screen has a real heading; the grade carries `aria-label="Grade B, 81 out of 100"`
- Skip link uses `:focus-visible`; footer source link has an accessible name; log scroll behaviour is no longer smooth

## Frontend / security

- **Stale-cache risk**: `/assets/*` was `immutable` for a year on un-hashed filenames → now `max-age=0, must-revalidate` (same for `/src/*`)
- **Double-start race and Exit-during-typing**: every async transition now carries a run token and bails if a newer run started; quitting clears timers and invalidates the token
- Seed parsing is strict (`^\d{6}$`, 100000–999999) for both URL and the replay form, with a visible error instead of a silent random shift
- Clipboard has a real fallback (hidden textarea + `execCommand`) and a selectable share box; cancellation of the share sheet no longer reports a failure
- Log scrolling is rAF-batched and no longer smooth during typing

## Launch / voice

- Hero rewritten from the slogan "Six incidents. One night. Yours." to **"The pager goes off at 02:11."**; the lede now names the outcome (postmortem, grade, a link your team can try to beat)
- Share text is a challenge, not a receipt: *"I got B on six incidents — can you beat it? Same shift:"*
- The OG card no longer advertises an unexplained grade: it leads with the 02:11 pager and a **Play the shift** call to action

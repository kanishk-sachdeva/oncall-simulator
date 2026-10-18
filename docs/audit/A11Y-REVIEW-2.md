AA not met — one WCAG 2.2 AA focus failure remains after the three previously-HIGH fixes.

# Re-verification scope

Fresh read-only measurements of `assets/app.css`, `src/app.js`, `index.html`, `A11Y.md`, and `FIXES.md`. Contrast ratios below are sRGB relative-luminance ratios, rounded to two decimals.

## Previously-HIGH findings

| Finding | New measurement | Result |
|---|---|---|
| 1.4.3 contrast: `--text-4` and `--text-3` | `--text-4` is now `#868d9c`: 5.83:1 (`--bg`), 5.43:1 (`--panel`), 5.12:1 (`--panel-2`), **4.73:1 (`--panel-3`, worst)**. `--text-3` is now `#98a0ad`: 7.37, 6.86, 6.47, **5.97:1 (worst)** respectively. | Fixed: normal text meets 4.5:1. |
| 4.1.2/4.1.3 log announcement storm | `#log` has `aria-live="off"`; `appendLine()` mutates only the non-live log body during typing. The separate `#announcer` is `role="status" aria-live="polite" aria-atomic="true"`, and `announce()` writes only once at the instant path or after the final typewriter tick. | Fixed: no per-character live announcements; each completed non-empty line is announced once. |
| 2.4.3/2.4.7 focus management | `renderStep()` creates native `.choice` buttons and focuses the first one (`first.focus({ preventScroll: true })`) after choices render. `startShift()` blurs the initiating control, then `openIncident()` → `renderStep()` places focus on the first choice. `show("title")` focuses `#start-btn` (`data-autofocus`). `endShift()` calls `show("end")`, but `#screen-end` has no `[data-autofocus]`; the removed final choice is not replaced with focus on `#again-btn` or `#pm-heading`. | Partially fixed; one end-of-shift focus failure remains (see below). |

## Exact measured CSS values

| Token / color | Actual use | Worst-case tested background | Ratio |
|---|---|---:|---:|
| `--text #e9ebef` | primary text | `--panel-3 #1f232b` | 13.19:1 |
| `--text-2 #a7adb8` | body/table text | `--panel-3 #1f232b` | 6.98:1 |
| `--text-3 #98a0ad` | stage/prompt/control-adjacent text | `--panel-3 #1f232b` | 5.97:1 |
| `--text-4 #868d9c` | labels, captions, notes | `--panel-3 #1f232b` | 4.73:1 |
| `--control-border #6b7280` | icon, hint, ghost-button borders | `--panel-3 #1f232b` | 3.26:1 |
| `--control-border-soft #666d7c` | choice-card borders | `--panel-3 #1f232b` | 3.03:1 |
| `--line-2 #2d313b` | non-boundary separators/keycaps | `--panel #14161c` | 1.39:1 |
| `--line-3 #3a3f4b` | non-boundary accent border | `--panel-3 #1f232b` | 1.49:1 |
| `--amber #ffb020` | status/links/borders | `--panel-3 #1f232b` | 8.61:1 |
| `--red #f0526b` | severity/status | `--panel-3 #1f232b` | 4.59:1 |
| `--green #3fbf7f` | status | `--panel-3 #1f232b` | 6.73:1 |
| `--blue #6ba4f8` | links/notes | `--panel-3 #1f232b` | 6.22:1 |
| `--violet #a98bf5` | recurrence labels | `--panel-3 #1f232b` | 5.77:1 |
| `#14120a` | text on `.btn` `--amber` background | `--amber #ffb020` | 10.62:1 |
| `#12131a` | skip-link text on `--amber` background | `--amber #ffb020` | 10.28:1 |

The control-boundary measurements meet WCAG 1.4.11's 3:1 threshold, including the worst `--control-border-soft` result of 3.03:1. Target sizes measured from CSS: `.choice` `min-height:44px`; `.icon-btn` `min-width:44px`, `min-height:34px`; `.hint-btn` `min-height:34px`; `.btn-sm` has `8px` vertical padding plus `11px` line-height (27px content box plus borders, approximately 29px total). These satisfy WCAG 2.2 AA 2.5.8's 24×24 minimum. Focus indication remains `:focus-visible { outline:2px solid var(--amber); outline-offset:2px; }`.

## Remaining failures, ranked

### 1. HIGH — 2.4.3 Focus Order (and 2.4.7 Focus Visible)

- **Element:** `#again-btn` / postmortem screen after the final decision.
- **Measurement:** `endShift()` calls `show("end")`; `show()` focuses only `[data-autofocus]`. `#screen-end` contains no `[data-autofocus]`; the focused final `.choice` is removed by `hideChoices()` before the end screen is shown, so focus is not moved to a visible end-screen control or heading.
- **Fix:** add `data-autofocus` to `#again-btn` (or a focusable `#pm-heading` with `tabindex="-1"`), or explicitly focus `#again-btn`/`#pm-heading` after `show("end")`. Verify focus after start, every step render, end, and replay.

## Verdict

WCAG 2.2 AA is **not met** because the end-of-shift focus placement remains non-compliant. The contrast, live-region, target-size, and control-boundary fixes are verified; no other previously reported failure is repeated here.

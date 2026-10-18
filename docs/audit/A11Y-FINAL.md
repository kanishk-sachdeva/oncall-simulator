# WCAG 2.2 AA final sign-off

**Verdict: AA met.**

- **Start focus — verified.** Live build starts the shift and `renderStep()` focuses the first `.choice` button.
- **Per-step focus — verified in source.** Every step render calls `renderStep()`; each render creates choices, unhides `#choices`, and focuses its first `.choice`.
- **End-of-shift focus — verified.** `show("end")` focuses visible `#pm-heading`; it is an `h2`, has `tabindex="-1"`, and is not visually hidden. CSS provides a 2px amber `:focus-visible` outline with 4px offset.
- **Replay — verified.** `New shift` calls `startShift()`, which returns to play and the next rendered step focuses its first choice.
- **EXIT — verified in source.** EXIT ends the active run, renders the title, and `show("title")` focuses `#start-btn`; EXIT from an inactive/end state returns to the title.
- **Previously checked regressions — none found.** Live DOM has exactly one `#announcer`; `#log` is `aria-live="off"`. Source retains `--text-4: #868d9c`, `--text-3: #98a0ad`, `--control-border: #6b7280` (documented >=3:1), and choice/button sizing remains at least 24px; primary controls are larger.

**Remaining issues:** none identified. Criteria covered: 2.4.3, 2.4.7, 2.4.11, 1.4.3, 1.4.11, 2.5.8, 4.1.3.
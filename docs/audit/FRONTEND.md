# ON-CALL frontend audit

Scope: source review plus `node tests/validate.mjs` and `node tests/simulate.mjs` (both pass). First-load source/data bytes are 147,202 bytes before compression (HTML 10,092; CSS 16,508; JS 25,864; data 94,738), with CSS and module JS render-blocking/critical to first usable screen. Findings are ranked by user/security impact.

## HIGH

### H1 — stale immutable CSS after redeploy
- **File:line:** `vercel.json:7-9`
- **Trigger:** Deploy a changed `assets/app.css`; a browser/CDN that cached the old filename still has it for up to a year.
- **Impact:** New HTML/JS can run with old layout/interaction styling indefinitely; asset filenames are not content-hashed.
- **Fix:** Either fingerprint/version asset URLs (preferred), or change the assets rule to a short revalidated policy such as `public, max-age=0, must-revalidate` (at minimum remove `immutable`). Keep truly immutable caching only for content-hashed files.

### H2 — starting twice races two async runs
- **File:line:** `src/app.js:213-226,239-254,422-429,451-453`
- **Trigger:** Double-click Start, press Enter twice quickly, or click New shift repeatedly.
- **Impact:** `startShift()` replaces `state.run` while the first `openIncident()` is awaiting typewriter promises. The old continuation reads the new run, clears/re-renders its log, and multiple continuations can append duplicate prompts or leave `busy`/screen state inconsistent.
- **Fix:** Add a monotonically increasing run token/AbortController. Capture it in `startShift`/`openIncident`/`pick`; after every await, return if the token is stale. Also disable start/replay controls while transitioning (and make the handler idempotent).

### H3 — Exit during typing is not cancelled
- **File:line:** `src/app.js:239-254,432-435`
- **Trigger:** Start a shift, then click EXIT/confirm while the opening typewriter is running.
- **Impact:** `finish()` changes the run, but the pending `openIncident()` continues; after its awaits it sets `busy=false` and calls `renderStep()` against an over run, which can call `endShift()` and switch away from the title or produce an invalid postmortem. Pending timers also continue mutating the hidden log.
- **Fix:** Cancel/invalidate the current transition on Exit and before every post-`await` mutation; clear the typewriter timer and set `typing=null`. Treat navigation as a state transition with one owner.

## MED

### M1 — clipboard API absence throws before the promise handler
- **File:line:** `src/app.js:400-406`
- **Trigger:** Click Copy shift link in HTTP, an older browser, or a context where `navigator.clipboard` is undefined.
- **Impact:** `navigator.clipboard.writeText` throws synchronously, so the intended “Copy failed” toast is never shown and an uncaught error is reported.
- **Fix:** Guard `navigator.clipboard?.writeText`; use `try/catch` around the call and provide a manual-copy fallback (or render the URL in selectable text).

### M2 — invalid/hostile seed input is silently accepted as a different seed
- **File:line:** `src/app.js:424-428`, `src/app.js:90-95`
- **Trigger:** Enter `?s=abc`, `?s=999999999`, `?s=-5`, or a replay value with a numeric prefix such as `123abc`.
- **Impact:** URL values are ignored (no clear user feedback), while the replay form hashes arbitrary text or `parseInt` accepts a prefix; users cannot reliably reproduce the displayed URL seed and malformed share links look valid.
- **Fix:** Validate a canonical decimal seed with a strict regex and explicit range (for example `100000..999999`), reject with a toast/error, and use the same parser for URL and form. Do not fall back to a random run on malformed explicit input.

### M3 — long-log rendering forces repeated layout/scroll work
- **File:line:** `src/app.js:132-167,178-182`; `assets/app.css:290-295`
- **Trigger:** Incidents with many lines or slow devices; each typewriter tick calls `scrollLog()` while smooth scrolling is enabled.
- **Impact:** Repeated `scrollHeight` reads followed by writes can cause layout thrash; `scroll-behavior:smooth` queues competing animations and can make the log lag behind or feel stuck.
- **Fix:** Use one rAF-batched scroll scheduler, disable smooth scrolling during typewriter updates, and append/build a line off-DOM where practical. Keep a bounded log or only auto-scroll when the user was already at the bottom.

### M4 — mobile keyboard can obscure choices after seed entry
- **File:line:** `index.html:105-107`; `src/app.js:213-226`; `assets/app.css:450-462`
- **Trigger:** At 360x640/390x844, focus the seed input and activate Replay while the virtual keyboard is still open.
- **Impact:** The play screen uses a sticky HUD and a 46vh log, but no keyboard/inset handling or post-navigation focus/scroll. On mobile browsers the keyboard/visual viewport can cover lower choice buttons, requiring a manual dismiss/scroll.
- **Fix:** Blur the seed input before starting; after showing play, scroll the first choice into the visual viewport. Use `100dvh`/`env(safe-area-inset-bottom)` where appropriate and test with the visual viewport API on iOS/Android.

### M5 — media/share failures are handled inconsistently
- **File:line:** `src/app.js:382-397,400-406`
- **Trigger:** `navigator.share` exists but rejects (user cancellation is common), or share/clipboard APIs are unavailable.
- **Impact:** Share result gets a generic copy failure even when the user merely cancelled; Copy link can throw synchronously as above. The UI gives no robust fallback URL/text selection.
- **Fix:** Distinguish `AbortError` from actual failure, feature-detect both APIs, and expose a selectable fallback containing the result/link.

## LOW

### L1 — inline styles require CSP exception
- **File:line:** `index.html:105-106,165-169,196`; `vercel.json:22-24`
- **Trigger:** Tighten CSP to remove `'unsafe-inline'` without moving presentation styles.
- **Impact:** The current CSP is compatible because `style-src 'self' 'unsafe-inline'` permits these attributes. JSON-LD is non-executable and `script-src 'self'` permits the external module; no CSP block is expected in a real browser today.
- **Fix:** Move inline style attributes to CSS classes, then remove `'unsafe-inline'`. Keep the JSON-LD block (or add a nonce only if it becomes executable script).

### L2 — full data pool is shipped on first load
- **File:line:** `src/pool.js:1` and imported data modules; `index.html:201`
- **Trigger:** Any first visit, even before Start.
- **Impact:** ~94.7 KB of incident data plus ~25.9 KB JS is transferred/parsed up front; this is acceptable for a small game but is avoidable on slow mobile connections.
- **Fix:** Lazy-load the pool on Start, or build a production bundle/code-split the data. Keep the title screen independent of the full pool (store stats separately).

### L3 — typewriter state is global rather than per transition
- **File:line:** `src/app.js:20-27,146-166`
- **Trigger:** Overlapping transitions or a stale timer from a prior run.
- **Impact:** `state._timer`, `typing`, and `skipTyping` are shared; a skip/click intended for one line can affect another transition. This amplifies H2/H3 and makes future UI changes fragile.
- **Fix:** Return a cancellable typing task from `appendLine`; keep timer/skip state local and cancel it through the run token.

## Cache conclusion
`/src/*` is `max-age=300, must-revalidate`, so stale code is possible for up to roughly five minutes but should revalidate thereafter; it is not an indefinite immutable-cache risk. `/assets/*` is `max-age=31536000, immutable` despite un-hashed names, so CSS/static asset changes can remain stale for a year. The concrete stale-cache finding is H1.

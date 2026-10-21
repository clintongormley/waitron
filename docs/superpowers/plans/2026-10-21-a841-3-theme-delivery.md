# A841 slice 3 — delivering the theme to the screens: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL.** `/api/theme`'s answer is a contract between `apps/server` and both front
ends, and this slice is where both start reading it (a cross-package contract, global CLAUDE.md
"risk trigger"). Implementers are dispatched as `subagent_type: "implementer"`. An implementer that
passes about 150 tool calls with its task unfinished stops at a passing or cleanly failing point,
commits, and hands over: done, left, files, each check's state.

**Goal:** the dashboard and the till show the venue's theme in use: from the browser's stored copy
on the first frame, from `/api/theme` as soon as it answers, and again whenever the theme in use
changes — an open dashboard at once, a signed-in till within one menu-state poll.

**Architecture:** one small module in `@waitron/ui`, `venue-theme.ts`, beside `theme-choice.ts`,
owns a second constructed stylesheet on the document, the stored copy under `waitron-venue-theme`,
and every fetch of `/api/theme`. Each app's `main.ts` starts it right after `applyTokens`. The
dashboard's shell hands it each answer of a passive live read that depends on `custom_themes`; the
till asks it to follow the `themeHash` its start read carries. No server code changes.

**Tech stack:** TypeScript, Lit, Vitest 4.1.11 browser mode in real Chromium (Playwright 1.64.1),
a Vitest browser command that opens the app's real `index.html` in a fresh browser context, Stryker
for `@waitron/ui`.

**Spec:** `docs/superpowers/specs/2026-10-19-a841-theme-editor-design.md` — section 16 item 3 (the
scope, lines 2530-2532) and section 12 (lines 2168-2254), resting on section 7's three blocks
(lines 1355-1367) and how a version is picked (lines 1284-1290, 1382-1388), section 8's table (setup
wizard: no theme, line 1395), section 13's "Applying the look" (lines 2282-2284), section 15's
delivery cases (lines 2393-2395, 2472-2477) and section 17's "First visit" and "WebKit" risks
(lines 2658-2661).

**Slice 2:** `docs/superpowers/plans/2026-10-21-a841-2-stored-themes.md`, "Left for later slices"
(lines 1143-1147), and the code it landed: `/api/theme` (`apps/server/src/themes-api.ts:79-84`,
answering `venueThemeAnswer`, `apps/server/src/venue-theme.ts:6-37`, with `Cache-Control: no-store`)
and the till's `themeHash` (`apps/server/src/till-setup.ts:129`; typed at
`apps/till/src/api/client.ts:210-211`).

Every `file:line` outside the design was read on 2026-10-21 in this worktree at `35be254d6`, unless
it names a command that was run. Probes ran in `~/waitron-campaign/a841-plan3/probes/`; their
outputs are the `output-*.txt` files there.

---

## Decisions this plan makes (the design left them open)

**D1. Which start-up paths get the theme: the dashboard's and the till's `main.ts`, and no other.**
`git grep -ln applyTokens` over non-test files under `apps/` and `packages/` found five callers that
start a page:

| Caller | Theme? | Why |
| --- | --- | --- |
| `apps/dashboard/src/main.ts:17-18` | Yes | The dashboard, signed in and out (design line 1393). |
| `apps/till/src/main.ts:16-17` | Yes | The till, and in the same app the handheld, the kitchen and station screens (design line 1394). |
| `apps/setup/src/main.ts:6-7` | No | The setup wizard "runs before a theme exists" (design line 1395). |
| `packages/fiscal-verifactu/src/custodian/offline-app.ts:157,360` | No | The custodian's offline tool, run away from any box: there is no `/api/theme` to ask. |
| `packages/ui/demo/main.ts` | No | The component workbench, not a product page. |

`apps/print-agent` has no page. The equipment label (`apps/dashboard/src/widgets/equipment-label.ts:42-44`)
marks its print iframe a theme root inside the dashboard's document, so the venue's sheet reaches
that element on screen; it copies only font tokens (design line 1398), which no theme writes until
slices 10-11, so nothing printed changes in this slice ("Left for later slices"). (The sheet's
`@media screen` wrapper is no protection here: the label copies the frame's computed tokens into its
own document at `load`, while the page is on screen, `equipment-label.ts:52-59` — design section 7
says the wrapper does not cover such a copy. Only the font-token reason holds.)

**D2. The shared code lives in `@waitron/ui` (`packages/ui/src/venue-theme.ts`), not `@waitron/ui-core`.**
Both apps already take `applyTokens` and `startThemeChoice` from `@waitron/ui`
(`apps/dashboard/src/main.ts:2`, `apps/till/src/main.ts:2`), and `theme-choice.ts`, whose shape this
module follows (module-level state, one start function), is there (`packages/ui/src/theme-choice.ts`,
exported at `packages/ui/src/index.ts:127-138`). `@waitron/ui-core` carries a `publishConfig` export
map and a package-consumer test (`packages/ui-core/package.json:13,60-138`); a module that fetches
from the box and writes to `localStorage` is app glue, not a published component (the one pure
piece, the answer's shape check, does go in `@waitron/ui-core/theme`, D3, so the server can run it;
it is mutation-tested there under the same nightly floor). Consequences:
`packages/ui` measures `src/**/*.ts` at 98/98/98/95 (`packages/ui/vitest.config.ts:114-131`) and
mutates `src/**/*.ts` (`packages/ui/stryker.config.json:9`), so the new file is mutation-tested; that
floor of 90 bites only in the nightly merged run (`docs/developers/ci-and-gates.md:326`), so Task 2
runs Stryker on the file locally and records the score. The test-side files both apps share (a
browser command and a fixture answer) go in `packages/ui/test/`, outside the coverage `include`, as
`apps/till/test/native-reload.ts` sits outside the till's.

**D3. The stored copy and the answer are accepted only in `/api/theme`'s shape: an object, not an
array, with a string `hash`, a string `css` and a `logo` key.** The check, `isVenueThemeAnswer`, and
its type live in `@waitron/ui-core/theme` (`packages/ui-core/src/theme/answer.ts`, pure, no DOM), not
in `@waitron/ui`, so that `apps/server` — which depends on `@waitron/ui-core`
(`apps/server/package.json:74`) but not on `@waitron/ui` — can run it over its real `/api/theme`
answer (Task 1). Without that, a later change to the answer's shape would pass every test while every
page quietly fell back to Waitron's colours. The value of `logo` is stored as
received and never read in this slice: slice 8, which draws it, checks its shape first ("Left for
later slices"). Anything else — text that is not JSON, `null`, `[]`, `42`, a missing or non-string
`hash` or `css`, no `logo` key — is treated as no stored copy (the page shows Waitron's colours) or,
for an answer, as a failed fetch (the page keeps what it shows). The CSS text itself is not
re-checked in the browser: only `/api/theme` writes it, from `themeSheet`, which refuses anything but
derived values (`sheet.ts:4-17`), and only this origin's own script can write the stored copy.

**D4. The fetch's time limit is 5 s (`VENUE_THEME_TIME_LIMIT_MS = 5_000`), bounding the request and
its body together.** The design names a time limit but no number; probe7 used 2 s (design line
2211). Nothing waits on the fetch, so a longer limit costs nothing on screen, and a box slow to
answer at start (a first visit while it is busy) still gets the theme applied: with 2 s, an answer at
3 s would be dropped until the next start or sign-in. 5 s stays short enough for slice 8's logo place,
which waits for "the answer … or the fetch's time limit" (design lines 2203-2204); slice 8 may shorten it.

**D5. The dashboard's live read reads `/api/theme` itself, through a new `DashboardApi.getVenueTheme()`,
always passively, depending on `custom_themes` alone.** No new route: `/api/theme` needs no session
(`themes-api.ts:79-84`) and answers exactly what the shell applies. "Open to every signed-in person
with no permission" (design lines 2232-2233) holds because the live stream checks a session and nothing
else (`apps/server/src/live-api.ts:97-105`), and `custom_themes` is already a change source
(`packages/db/src/classification.ts:141,268-274`), so `scripts/live-subscriptions.test.ts` accepts the
name. The method calls `this.background.#request`, as `getVenueClockPreview` does
(`apps/dashboard/src/api/client.ts:2983-2989`), so the FIRST read is passive too: `DashboardQueries`
otherwise sends a query's first read through the active client
(`apps/dashboard/src/api/query-controller.ts:11-16`), whose success counts as activity
(`packages/dashboard-kit/src/request.ts:75-80,135`). The design's dependency on `media_images`
(lines 2230-2231) arrives with the logo, in slice 7 (design lines 2552-2553, "the dashboard theme read's
dependency on `media_images`"): it is one more name in the same `QUERY_DEPENDENCIES` entry.

**D6. The signed-out dashboard gets the theme at start-up only; at sign-in the live read's first read
applies the latest answer.** A signed-out shell runs no live stream (`liveUpdates.start()` is called
from `#applyMe`, `apps/dashboard/src/dashboard-app.ts:1171`), and a passive poll for a signed-out
page would be a new request pattern the design does not ask for.

**D7. The till follows through `followVenueTheme(hash)`, called from `#applyVenueSetup` and on every
menu-state answer, and it fetches only when the hash differs from the one applied.** `#applyVenueSetup`
(`apps/till/src/till-app.ts:9286-9308`) runs after every start read and every read a moved
`setupRevision` triggers (`#noteSetupRevision`, `till-app.ts:9311-9327`). Calling it again from
`#onMenuState` (`till-app.ts:5562-5563`) with the last `themeHash` the till applied costs nothing when
the hashes agree, and retries a theme fetch that failed: without it, a till whose fetch failed right
after a switch would keep the old colours until its next restart, because the revision it applied
already names the new theme. The fetch goes to the page's own origin, not through the till's
`ServerRouter`: a venue has one node today (CLAUDE.md §5, "TODAY a venue has ONE node"), so the
origin is the primary.

**D8. An older fetch never undoes a newer answer.** Every fetch is numbered when sent; its answer
applies only if nothing was applied after it was sent (a later fetch's answer, or an answer the
dashboard's live read handed in). The same rule as the till's setup reads ("an answer is skipped once
a read sent after it has been applied", `docs/developers/conventions-ui.md:1491-1493`).

**D9. Before `startVenueTheme` has run on a page, `applyVenueTheme` and `followVenueTheme` do
nothing.** So the setup app, and every existing dashboard and till test that mounts the shell
without starting the theme, adopt no sheet and send no request. A second `startVenueTheme` resets the
module (the sheet takes the stored copy's text, or none; fetches in flight are dropped), which is
also how a test file starts each case clean without a test-only export.

**D10. The start-up probes are committed tests in both apps, run in Chromium in CI; WebKit runs the
same tests on request, locally, as a recorded measurement.** Section 15 lists "probe7's three cases
against the real dashboard and till" among its browser tests "(real Chromium, and WebKit for the
start-up probe)" (design lines 2393-2394). A Vitest browser command opens the app's real `index.html`,
which loads the real `src/main.ts`, in a fresh browser context, routes `/api/theme` per case, and
samples `--wt-color-bg` on every animation frame — the shape of `apps/till/test/native-reload.ts`.
The test file reads its engine list from Vitest's `provide` (`WAITRON_STARTUP_ENGINES`, default
`chromium`); with `chromium,webkit` the command launches Playwright's WebKit itself. WebKit is not in
CI: CI installs Chromium alone, without `--with-deps` (`.github/workflows/ci.yml:1256-1276,1356,1486`),
and — an assumption, not run here — WebKit on Linux needs system libraries Chromium does not, which
would mean a bounded, retried apt step (CLAUDE.md §2) and a Playwright cache whose one key
(`ci.yml:1345-1349`) every Chromium-only job also saves. The controller ruled (2026-10-21): WebKit
stays out of CI in this slice, and a driver step adds a backlog entry for it ("Departures from the
design"). The review ran the Task 3 command shape through Vitest's own server
(`~/waitron-campaign/a841-plan3/review-probes/vt/`): Chromium 156.0.8078.4 and a separately launched
WebKit 27.2 both rendered the dashboard and the till in about 1 s per case.

Probes, 2026-10-21 (`~/waitron-campaign/a841-plan3/probes/`):

- `node webkit-launch.mjs <apps/dashboard>` first printed `chromium launched 156.0.8078.4` and
  `webkit failed browserType.launch: Executable doesn't exist at …/ms-playwright/webkit-2370/pw_run.sh`
  (`output-webkit-launch.txt`). `playwright install webkit` (Playwright 1.64.1, from
  `apps/dashboard`) downloaded `WebKit 27.2 (playwright webkit v2370)`, exit 0; the re-run printed
  `webkit launched 27.2` (`output-webkit-launch-after-install.txt`). WebKit is now installed in this
  machine's shared Playwright cache.
- `node startup-harness.mjs <apps/till>`: a Vite dev server on `apps/till`'s own config, the real
  `index.html` and `src/main.ts`, `/api/*` routed by Playwright, `--wt-color-bg` sampled per frame.
  Chromium 156.0.8078.4: first frame `rgba(0, 0, 0, 0)` at 1 ms, first frame with the theme root
  `rgb(247, 247, 248)` at 326 ms; WebKit 27.2: `rgba(0, 0, 0, 0)` at 64 ms, then `rgb(247, 247, 248)`
  at 267 ms; `/api/theme` asked 0 times in both, as `main.ts` does not ask yet
  (`output-startup-harness-till.txt`). So the real app loads and paints Waitron's colours in both
  engines under this harness. A first run routed the glob `**/api/**`, which also caught
  `/src/api/client.ts` and left the page never themed; routing must test the URL's path
  (`pathname.startsWith("/api/")`), noted in Task 3.

**D11. Failures are silent in the module, and the dashboard records a failed live read.** A refused,
failed, timed-out or malformed fetch leaves the page as it is and writes nothing; there is no screen
to tell. The dashboard's live read reports its failures as `diag.record("warn", "theme.load_failed",
{ code })`, as the alerts read does (`dashboard-app.ts:940-944`).

---

## Departures from the design

- **WebKit is measured, not gated** (D10). The design asks for the start-up probe in WebKit among
  section 15's tests; this plan commits the tests with WebKit selectable, runs them in WebKit once,
  locally, in both apps, and records the result in the PR and in the design (Task 4), while CI runs
  them in Chromium only. The controller ruled (2026-10-21) that WebKit stays out of CI in this slice;
  a driver step adds the backlog entry for it (bounded apt, a cache key per engine).

---

## Global Constraints

- **The storage key** is `waitron-venue-theme` (design line 2198); the stored copy is "the whole
  answer, `logo` included" (lines 2199-2200).
- **The answer** is `{ hash, css, logo }` (line 2177); `hash` is SHA-256 of `css` and `logo`
  together (`themeHashOf`, `apps/server/src/venue-theme.ts:12-14`); `css` is empty while Waitron's
  theme is in use (lines 2178-2179).
- **Order at start:** "right after `applyTokens`, adopts a second sheet holding the copy stored …
  then fetches `/api/theme` with a time limit; a newer answer replaces the sheet's text and the stored
  copy. Nothing waits on the fetch" (lines 2196-2199).
- **Versions:** switching Light, Dark or Follow device, or the device's own mode, makes no request
  (lines 2247-2252); the sheet's three blocks do it (lines 1355-1367).
- **Permission:** the dashboard's live read "needs a session but no permission" (line 2283).
- **Passive:** "It is passive (house rule: automatic reads do not keep a session alive)" (line 2232).
- **Signed-out tills** follow "at their next start-up, or at the next sign-in" (lines 2245-2246); a
  kitchen screen in device mode is fixed until reload (lines 2253-2254).
- **General code is English only** (CLAUDE.md §3); every colour in a test fixture is a `--wt-*` value
  written as data, not styling.
- **Coverage 98/98/98/95** in every package touched (`packages/ui-core`, `packages/ui`,
  `apps/dashboard`, `apps/till`; `apps/server` gains a test only);
  `main.ts` is outside both apps' coverage (`apps/dashboard/vitest.config.ts:105-115` coverage `exclude`,
  `apps/till/vitest.config.ts:69-71`).

## Review Focus

1. **A till whose theme fetch fails right after a switch.** The person expects the new colours
   within a poll or two, not at the next restart. Pinned in Task 6 ("a failed theme fetch is tried
   again on the next poll").
2. **A start-up fetch that answers after the dashboard's live read applied a newer theme.** The page
   must keep the newer one. Pinned in Task 2 ("an older fetch never undoes a newer answer").
3. **A browser that refuses `localStorage`** (a private window, a full quota, a policy). The page
   must still show the theme from the answer. Pinned in Task 1 ("storage that throws").
4. **Switching back to Waitron's theme.** The answer's `css` is empty; the page must drop the venue's
   colours and the stored copy must say so, or the next start shows the old theme. Pinned in Task 1
   ("an empty answer empties the sheet and is stored").
5. **A supervisor or staff member's open dashboard during a switch.** No permission is needed; their
   screen must repaint too. Pinned in Task 5 ("a staff session follows the theme too").

---

## File map

| File | Change |
| --- | --- |
| `packages/ui-core/src/theme/answer.ts`, `answer.test.ts`, `index.ts` | New: `isVenueThemeAnswer` and its type, pure, shared with the server (D3) |
| `apps/server/src/themes-api.public.test.ts` | One case: the real answer passes `isVenueThemeAnswer` (Task 1) |
| `packages/ui/tsconfig.json` | `include` gains `test`, if its typecheck stays clean (Task 3 step 5) |
| `packages/ui/src/venue-theme.ts` | New: the sheet, the stored copy, the fetch, `startVenueTheme`, `applyVenueTheme`, `followVenueTheme` |
| `packages/ui/src/venue-theme.test.ts` | New: start-up, answers, failures (Task 1); following and order (Task 2) |
| `packages/ui/src/venue-theme.unstarted.test.ts` | New: before start nothing happens (Task 1) |
| `packages/ui/src/venue-theme.follow-device.test.ts` | New: the version each setting picks, with no request (Task 2) |
| `packages/ui/src/index.ts` | Export the module (after `theme-choice.js`, `:127-138`) |
| `packages/ui/test/venue-theme-startup.ts` | New: the Vitest browser command (Task 3) |
| `packages/ui/test/venue-theme-fixture.ts` | New: the fixture answer both apps' tests use (Task 3) |
| `apps/dashboard/src/main.ts`, `apps/till/src/main.ts` | Call `startVenueTheme` after `applyTokens` |
| `apps/dashboard/vitest.config.ts`, `apps/till/vitest.config.ts` | Register the command; `provide` the engine list; `optimizeDeps.entries: ["src/main.ts"]` |
| `apps/dashboard/src/venue-theme-startup.test.ts`, `apps/till/src/venue-theme-startup.test.ts` | New: the start-up cases |
| `apps/dashboard/src/api/client.ts`, `live-queries.ts` | `getVenueTheme`, its dependency |
| `apps/dashboard/src/api/client.test.ts` | The read is a passive GET of `/api/theme` |
| `apps/dashboard/src/dashboard-app.ts` | `#watchVenueTheme`, released on return to login |
| `apps/dashboard/src/dashboard-app.venue-theme.test.ts` | New: the shell follows the theme |
| `apps/till/src/till-app.ts` | Follow `themeHash` in `#applyVenueSetup` and `#onMenuState` |
| `apps/till/src/api/client.ts:210` | The `themeHash` comment |
| `apps/till/src/till-app-setup-refresh.test.ts` | New describe: the till follows the theme in use |
| `docs/developers/conventions-ui.md`, `design-system.md`, `testing-guide.md`, `dashboard-live-updates.md` | Tasks 4-6 |
| `docs/superpowers/specs/2026-10-19-a841-theme-editor-design.md` | A dated receipt of the WebKit measurement (Task 4) |

---

### Task 1: The venue theme module — start-up, answers and failures (`@waitron/ui`)

**Files:**
- Create: `packages/ui-core/src/theme/answer.ts`, `packages/ui-core/src/theme/answer.test.ts`
- Modify: `packages/ui-core/src/theme/index.ts` (export `answer.js`)
- Modify: `apps/server/src/themes-api.public.test.ts` (one case: the real answer passes the check)
- Create: `packages/ui/src/venue-theme.ts`
- Create: `packages/ui/src/venue-theme.test.ts`, `packages/ui/src/venue-theme.unstarted.test.ts`
- Modify: `packages/ui/src/index.ts:127-138` (export beside `theme-choice.js`)

**Interfaces:**
- Produces (later tasks rely on these names exactly):

```ts
// packages/ui-core/src/theme/answer.ts (exported from @waitron/ui-core/theme)
export interface VenueThemeAnswer {
  readonly hash: string;
  readonly css: string;
  readonly logo: unknown;
}
export function isVenueThemeAnswer(value: unknown): value is VenueThemeAnswer;

// packages/ui/src/venue-theme.ts (exported from @waitron/ui, which re-exports the two above)
export const VENUE_THEME_STORAGE_KEY = "waitron-venue-theme";
export const VENUE_THEME_TIME_LIMIT_MS = 5_000;
export interface VenueThemeOptions {
  /** Defaults to the global `fetch`, read when each request is sent. */
  readonly fetchImpl?: typeof fetch;
  readonly timeLimitMs?: number;
}
export function startVenueTheme(root: HTMLElement, options?: VenueThemeOptions): void;
export function applyVenueTheme(answer: unknown): void;
```

`followVenueTheme(hash: string): void` is Task 2's.

Behaviour (D3, D4, D8, D9): `startVenueTheme` adopts ONE module-level `CSSStyleSheet` onto
`root.getRootNode()` (document or shadow root, as `applyTokens` picks,
`packages/ui-core/src/tokens/index.ts:18-25`), appended after what is already adopted and never
twice; replaces its text synchronously with the stored copy's `css` when the stored copy parses and
passes `isVenueThemeAnswer`, else with `""`; records that copy's `hash` as applied (or none); drops
any fetch in flight; then sends `fetchImpl("/api/theme", { cache: "no-store", signal })` without
awaiting it. The whole read (request and `response.json()`) is bounded by `timeLimitMs`: the limit is a
`setTimeout` that aborts an `AbortController` (whose `signal` the request carries) and is cleared once
the body is read — never `AbortSignal.timeout`, which the fake-timer case below cannot move; on
expiry the answer is dropped. A response that is not `ok`, a rejected fetch,
a body that is not JSON, or JSON that fails `isVenueThemeAnswer` changes nothing. An accepted answer
goes through the same path as `applyVenueTheme`: when its `hash` differs from the applied one,
`replaceSync(answer.css)` and `localStorage.setItem(VENUE_THEME_STORAGE_KEY, JSON.stringify(answer))`
inside a `try` (a refusal is ignored); when equal, nothing is written. Reading `localStorage` is
inside a `try` too.

- [ ] **Step 1a: Write the failing contract tests.**
  - `packages/ui-core/src/theme/answer.test.ts`, "accepts only /api/theme's shape": `true` for
    `{ hash: "h", css: "", logo: null }` and for `{ hash: "h", css: "x", logo: { light: "a", dark: null } }`;
    `false` for `null`, `[]`, `42`, `"text"`, `{ css: "", logo: null }`, `{ hash: 1, css: "", logo: null }`,
    `{ hash: "h", logo: null }`, `{ hash: "h", css: 7, logo: null }` and `{ hash: "h", css: "" }`.
  - `apps/server/src/themes-api.public.test.ts`, "the answer passes the browser's check, with and
    without a theme in use": the bodies the two existing cases read (`:31-37` no theme, `:38-…` the
    lemon in use) each satisfy `isVenueThemeAnswer` from `@waitron/ui-core/theme`. The failing run
    (before `answer.ts` exists) fails to resolve the import; once it exists, the case is the guard a
    later reshaping of the answer trips.

- [ ] **Step 1b: Write the failing module tests** in `venue-theme.test.ts`. Each case starts on
  `document.documentElement` after `applyTokens(document.documentElement)` and
  `localStorage.removeItem(VENUE_THEME_STORAGE_KEY)`; `afterEach` clears the key, restores mocks and
  calls `startVenueTheme(document.documentElement, { fetchImpl: never })` with no stored copy, which
  empties the sheet (D9). Helpers: `bg = () => getComputedStyle(document.documentElement).getPropertyValue("--wt-color-bg").trim()`;
  `GREEN` and `LEMON` answers built with `themeSheet(deriveTheme(…))` from
  `@waitron/ui-core/theme` and `@waitron/ui-core/theme/waitron` and a fixed `hash` string each —
  `GREEN` from `{ ...WAITRON_CHOICES, brandColor: "#1e5b3a", background: "tinted" }` (light page
  `#f0f9f3`; a NEUTRAL green gives `#f7f7f8`, Waitron's own, which the review measured, so the
  background must be tinted) and `LEMON` from `{ ...WAITRON_CHOICES, brandColor: "#f2d300", background: "tinted" }`,
  with `expect(LEMON_LIGHT_BG).not.toBe(GREEN_LIGHT_BG)` as a precondition;
  `never = vi.fn(() => new Promise<Response>(() => {}))`; `answering(body, init?)` returns a
  `vi.fn` resolving `new Response(body, init)`.
  - "the stored copy paints before the fetch answers": store GREEN, start with `never`;
    `expect(bg()).toBe(GREEN_LIGHT_BG)` synchronously after the call, and
    `expect(GREEN_LIGHT_BG).not.toBe("#f7f7f8")` (the control: Waitron's light page).
  - "with no stored copy the page shows Waitron's colours": start with `never`; `bg()` is `"#f7f7f8"`.
  - "it asks `/api/theme` once, uncached, and waits for nothing":
    `expect(fetchImpl).toHaveBeenCalledTimes(1)`; first argument `"/api/theme"`; second
    `expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) })`;
    `startVenueTheme` returns `undefined` (not a promise).
  - "a newer answer replaces the sheet and the stored copy": store GREEN, answer LEMON;
    `await vi.waitFor(() => expect(bg()).toBe(LEMON_LIGHT_BG))`;
    `JSON.parse(localStorage.getItem(KEY)!)` equals the LEMON answer, `logo` included.
  - "the same answer writes nothing": store GREEN, answer GREEN; spy `Storage.prototype.setItem`;
    after the fetch settles (`await vi.waitFor(() => expect(json).toHaveBeenCalled())` on a spied
    `Response.prototype.json`, then one macrotask), `setItem` was not called and `bg()` is GREEN's.
  - "an empty answer empties the sheet and is stored": store GREEN, answer
    `{ hash: "waitron", css: "", logo: null }`; `bg()` becomes `"#f7f7f8"`; the stored copy's `css`
    is `""`.
  - "a malformed stored copy counts as none" — `it.each` over `"{broken"`, `"null"`, `"[]"`,
    `"42"`, `'{"hash":1,"css":"","logo":null}'`, `'{"hash":"h","css":7,"logo":null}'`,
    `'{"hash":"h","css":""}'`: `bg()` is `"#f7f7f8"` and the fetch is still sent once; then a GREEN
    answer paints GREEN and overwrites the stored value.
  - "a refused, failed or unreadable answer keeps the stored copy" — `it.each` over
    `answering('{"error":{"code":"server.internal"}}', { status: 500 })`, a fetch that rejects
    `new TypeError("Failed to fetch")`, `answering("<html>", { status: 200, headers: { "content-type": "text/html" } })`,
    and `answering('{"hash":"h"}')`: with GREEN stored, after the fetch settles `bg()` is GREEN's and
    `localStorage.getItem(KEY)` is byte-for-byte the stored text.
  - "a fetch that outlasts the time limit is abandoned": `vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })`
    (no animation frame is awaited, so testing-guide's frame trap does not apply); GREEN stored,
    `never`; capture the `signal`; `vi.advanceTimersByTime(VENUE_THEME_TIME_LIMIT_MS - 1)` →
    `signal.aborted` false; advance 1 → true; `bg()` still GREEN's; `expect(VENUE_THEME_TIME_LIMIT_MS).toBe(5_000)`.
    A second case with `timeLimitMs: 50` and a fetch that answers LEMON after 100 ms (real timers):
    `bg()` stays GREEN's after 150 ms (the control that a late answer is dropped, not applied).
  - "storage that throws still lets the answer paint": `vi.spyOn(Storage.prototype, "getItem")` and
    `setItem` both throwing `new DOMException("denied", "SecurityError")`; answer GREEN; `bg()`
    becomes GREEN's and nothing throws out of `startVenueTheme`.
  - "applyVenueTheme takes an answer only when its hash is new": after a start with `never`,
    `applyVenueTheme(GREEN)` paints GREEN and stores it; `applyVenueTheme({ hash: GREEN.hash, css: "", logo: null })`
    changes nothing (same hash); `applyVenueTheme("nonsense")` changes nothing.
  - "the sheet is adopted once, after the token sheet": two `startVenueTheme` calls leave
    `document.adoptedStyleSheets.length` one more than after `applyTokens` alone, and the venue
    sheet is the last entry.

  In `venue-theme.unstarted.test.ts` (its own file, so the module is fresh): "before start nothing
  is adopted or applied": `applyVenueTheme(GREEN)` leaves `document.adoptedStyleSheets` unchanged
  and `localStorage.getItem(KEY)` `null`.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/ui-core exec vitest run src/theme/answer.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/themes-api.public.test.ts` and
  `pnpm --filter @waitron/ui exec vitest run src/venue-theme`
  Expected: FAIL — each cannot resolve its import (`./answer.js`, `isVenueThemeAnswer` from
  `@waitron/ui-core/theme`, `./venue-theme.js`), every case in those files failing.

- [ ] **Step 3: Implement** `packages/ui-core/src/theme/answer.ts` (exported from the theme index)
  and `packages/ui/src/venue-theme.ts` with the interface and behaviour above, and export
  `VENUE_THEME_STORAGE_KEY`, `VENUE_THEME_TIME_LIMIT_MS`, `startVenueTheme`, `applyVenueTheme`,
  `VenueThemeOptions`, and the re-exported `isVenueThemeAnswer` and `VenueThemeAnswer`, from
  `packages/ui/src/index.ts`.

- [ ] **Step 4: Run them and watch them pass**

  Run: the three commands of Step 2.
  Expected: PASS, each with a `Tests` line counting its cases (read the count, CLAUDE.md §4).

- [ ] **Step 5: Focused checks**

  Run: `pnpm --filter @waitron/ui exec vitest run src/venue-theme --coverage --coverage.include=src/venue-theme.ts`
  Expected: the per-file table shows `venue-theme.ts` at 100 % lines and functions and ≥ 95 % branches.
  Run: `pnpm --filter @waitron/ui-core exec vitest run src/theme/answer.test.ts --coverage --coverage.include=src/theme/answer.ts`
  Expected: `answer.ts` at 100 % on every column.
  Run: `pnpm --filter @waitron/ui-core typecheck && pnpm --filter @waitron/ui typecheck && pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/ui-core lint && pnpm --filter @waitron/ui lint && pnpm format:check`
  Expected: each exits 0.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/ui-core/src/theme/answer.ts packages/ui-core/src/theme/answer.test.ts packages/ui-core/src/theme/index.ts apps/server/src/themes-api.public.test.ts packages/ui/src/venue-theme.ts packages/ui/src/venue-theme.test.ts packages/ui/src/venue-theme.unstarted.test.ts packages/ui/src/index.ts
  git commit -s -m "ui: apply the venue's stored theme at start and fetch the current one"
  ```

---

### Task 2: Following a hash, answer order, and Follow device (`@waitron/ui`)

**Files:**
- Modify: `packages/ui/src/venue-theme.ts`, `packages/ui/src/venue-theme.test.ts`, `packages/ui/src/index.ts`
- Create: `packages/ui/src/venue-theme.follow-device.test.ts`

**Interfaces:**
- Consumes: Task 1's module.
- Produces: `export function followVenueTheme(hash: string): void` — nothing before start (D9);
  nothing when `hash` equals the applied hash; otherwise one fetch through the same path as the
  start-up fetch. While a fetch is in flight, a call remembers the latest hash asked for and sends
  nothing; when the fetch settles, if that remembered hash still differs from the applied one, one
  more fetch is sent, and **the remembered hash is cleared when that follow-up is SENT**. A
  follow-up that fails, or answers another hash, sends nothing more until the next call (for the
  till, the next menu-state answer). Kept instead of cleared, every settle would re-check it and a
  down server would be asked again at once, forever: the review's `follow-loop.mjs` counted 157
  fetches in 200 ms that way, and 2 with the hash cleared on send. Order (D8): every fetch is numbered when sent, and `applyVenueTheme` counts as
  an application at the moment it is called; a fetch's answer is applied only if no application
  happened after that fetch was sent.

- [ ] **Step 1: Write the failing tests** (in `venue-theme.test.ts`, same helpers as Task 1):
  - "following the applied hash sends nothing": GREEN stored, start with a fetch answering GREEN;
    after it settles, `followVenueTheme(GREEN.hash)` → fetch still called once.
  - "following a new hash fetches and paints": then `followVenueTheme("other")` with the fetch now
    answering LEMON → called twice, `bg()` becomes LEMON's.
  - "following while a fetch is out waits for it, then asks once more if still behind": start with a
    deferred fetch (resolve by hand); call `followVenueTheme("x")` twice → still one call; resolve the
    first with GREEN → exactly one more call is sent; resolving that with LEMON paints LEMON. Control:
    same, but the first fetch answers with hash `"x"` → no second call.
  - "a follow-up that fails asks no more until the next call": deferred first fetch;
    `followVenueTheme("x")` twice; the first fetch rejects; the follow-up rejects too → after a
    macrotask and 100 ms more (real timers), the fetch was called exactly 2 times. A failing
    implementation (the hash kept) prints a call count far above 2. The success case above is its
    control.
  - "an older fetch never undoes a newer answer": start with a deferred fetch; `applyVenueTheme(LEMON)`;
    resolve the start-up fetch with GREEN → `bg()` stays LEMON's and the stored copy is LEMON. Control:
    without the `applyVenueTheme` call, the same GREEN answer paints GREEN.
  - "an answer from before a restart applies nothing": start (deferred fetch A), start again (fetch B
    `never`); resolve A with GREEN → `bg()` stays `"#f7f7f8"`.
  - In `venue-theme.unstarted.test.ts`: "following before start sends nothing" —
    `vi.stubGlobal("fetch", spy)`; `followVenueTheme("x")`; `spy` not called.

  In `venue-theme.follow-device.test.ts` — the Follow device probe slice 2 left here
  (`2026-10-21-a841-2-stored-themes.md:1145-1147`). Register
  `emulateColorScheme` as `packages/ui/src/theme-choice.test.ts` does
  (`packages/ui/vitest.config.ts:17-23` provides it). A theme whose versions differ: `GREEN` with
  `brandFix: { dark: true }` derived by `deriveTheme`, precondition
  `expect(theme.light["--wt-color-primary"]).not.toBe(theme.dark["--wt-color-primary"])`. Start with
  its answer stored and `fetchImpl` a counting fetch that never answers; `startThemeChoice(document.documentElement)`.
  - "each setting paints the version it picks": `it.each` over the six pairs of system mode
    (`"light"`, `"dark"`) × setting (`"light"`, `"dark"`, `"device"`) through
    `commands.emulateColorScheme` and `chooseTheme`: `--wt-color-primary` on the root equals
    `theme.dark[...]` exactly when (setting `"dark"`) or (setting `"device"` and system `"dark"`),
    else `theme.light[...]`.
  - "the control without a venue theme paints Waitron's own": the same six with no stored copy
    give `#1f6feb` and `#4c8dff` (`packages/ui-core/src/tokens/colors.css:14,149`).
  - "changing the setting or the system mode sends no request": after cycling every setting and
    both modes, the counting fetch was called exactly once (the start-up fetch).
  - `afterEach`: `chooseTheme("device")`, `commands.emulateColorScheme(null)`, clear the key, empty
    the sheet as in Task 1.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/ui exec vitest run src/venue-theme`
  Expected: FAIL — `venue-theme.test.ts` and `venue-theme.unstarted.test.ts` fail to load, every case
  in them failing with `does not provide an export named 'followVenueTheme'` (a missing named import
  is a link error, so no single case's own message prints). The Follow device cases import nothing new
  and may already pass: they test Task 1's sheet with the real three blocks, and their failing case
  would print the light value where the dark one is expected. To see the order rule fail on its own,
  run that one case against Task 1's code with the `followVenueTheme` import removed from the file:
  it prints `expected '#f0f9f3' to be '<LEMON's light page>'`.

- [ ] **Step 3: Implement `followVenueTheme` and the numbering** in `venue-theme.ts`; export it
  from `index.ts`.

- [ ] **Step 4: Run them and watch them pass**

  Run: `pnpm --filter @waitron/ui exec vitest run src/venue-theme`
  Expected: PASS, with the `Tests` count.

- [ ] **Step 5: Focused checks, and the mutation score of the one file**

  Run: `pnpm --filter @waitron/ui exec vitest run src/venue-theme --coverage --coverage.include=src/venue-theme.ts`
  Expected: as Task 1.
  Run: `pnpm --filter @waitron/ui exec stryker run --mutate src/venue-theme.ts`
  Expected: a mutation score of 90 or more for `venue-theme.ts`. A local run gates nothing
  (`ci-and-gates.md:326`); record the score in the commit message, and add an assertion for each
  survivor that a person could notice (for example the storage key or the request's `cache`).
  Run: `pnpm --filter @waitron/ui typecheck && pnpm --filter @waitron/ui lint && pnpm format:check`

- [ ] **Step 6: Commit**

  ```bash
  git add packages/ui/src/venue-theme.ts packages/ui/src/venue-theme.test.ts packages/ui/src/venue-theme.unstarted.test.ts packages/ui/src/venue-theme.follow-device.test.ts packages/ui/src/index.ts
  git commit -s -m "ui: follow a new theme hash, never let an older answer win, and test Follow device"
  ```

---

### Task 3: The start-up probe, and the dashboard starts the theme

**Files:**
- Create: `packages/ui/test/venue-theme-startup.ts`, `packages/ui/test/venue-theme-fixture.ts`
- Create: `apps/dashboard/src/venue-theme-startup.test.ts`
- Modify: `apps/dashboard/src/main.ts:17-18`, `apps/dashboard/vitest.config.ts:50-61`

**Interfaces:**
- Consumes: `startVenueTheme`, `VENUE_THEME_STORAGE_KEY` (Task 1).
- Produces (Task 4 reuses both files):

```ts
// packages/ui/test/venue-theme-fixture.ts — browser side
export const FIXTURE_ANSWER: { hash: string; css: string; logo: null };
// css: section 7's three blocks setting only --wt-color-bg, light #edf6f0, dark #0b110d
export const FIXTURE_LIGHT_BG = "#edf6f0";
export const WAITRON_LIGHT_BG = "#f7f7f8";
export const FIXTURE_DARK_BG = "#0b110d";

// packages/ui/test/venue-theme-startup.ts — Node side
export type StartupAnswer = "never" | "late" | "refused" | "failed" | "not-json";
export interface StartupScenario {
  readonly stored: string | null;   // the raw localStorage value, or none
  readonly answer: StartupAnswer;
  readonly answerBody: string;      // what "late" answers, JSON text
  readonly colorScheme: "light" | "dark"; // the new context's emulated system mode
  readonly engine: "chromium" | "webkit";
}
export interface StartupProbeResult {
  readonly engine: string;              // browser name and version
  readonly firstThemedBg: string | null; // --wt-color-bg on the first frame whose <html> has data-wt-theme-root
  readonly bgAfter: string;              // once settled
  readonly storedAfter: string | null;   // localStorage["waitron-venue-theme"] once settled
  readonly themeRequests: number;
  readonly appRendered: boolean;         // #app holds an element once settled
}
export function venueThemeStartupProbe(indexHtml: URL): BrowserCommand<[StartupScenario]>;
```

How the command works (the shape of `apps/till/test/native-reload.ts:8-60`): for `"chromium"` it
opens a NEW context on the runner's browser (`runner.context().browser()!.newContext({ colorScheme: scenario.colorScheme })`),
so the subject's `localStorage` is not the runner's; for `"webkit"` it launches
`(await import("playwright")).webkit` with the same option and closes it after. It navigates to
`new URL("/__a841_startup__", runner.url())`, fulfilling that navigation with the text of
`indexHtml` (read with `readFileSync`), whose `<script type="module" src="/src/main.ts">` the Vitest
server then serves. Routes match on the URL's PATH — `url.pathname.startsWith("/api/")` or
`"/management-api/"` — never a `**/api/**` glob, which also catches `/src/api/client.ts` (D10's
probe). `/api/theme`: `"never"` holds the route; `"late"` fulfils `answerBody` after 500 ms;
`"refused"` fulfils status 500 with `{"error":{"code":"server.internal"}}`; `"failed"` aborts;
`"not-json"` fulfils 200 `text/html` `<html></html>`. Every other API path answers 401 with
`{"error":{"code":"management_session.required"}}`. An init script sets or removes the stored copy
before any page script, and samples `--wt-color-bg` on `document.documentElement` on every
animation frame from the first. Settled means: `appRendered`, and the `/api/theme` route has been
handled (for `"never"`, received), and then 500 ms more; for `"late"`, also either the colour has
changed or 5 s have passed.

- [ ] **Step 1: Write the failing test** `apps/dashboard/src/venue-theme-startup.test.ts`. Engines
  from `inject("startupEngines")` (declare `ProvidedContext.startupEngines: string[]`);
  `describe.each(engines)` naming the engine; each case calls
  `commands.probeVenueThemeStartup(scenario)`:
  - "a stored copy paints on the first frame while the server never answers": stored
    `JSON.stringify(FIXTURE_ANSWER)`, `"never"` → `firstThemedBg` `FIXTURE_LIGHT_BG`, `bgAfter` the
    same, `appRendered` true, `themeRequests` 1.
  - "with no stored copy the first frame is Waitron's" (the control): stored `null`, `"never"` →
    `firstThemedBg` `WAITRON_LIGHT_BG`, `appRendered` true.
  - "an answer after 500 ms repaints and is stored": stored `null`, `"late"` → `firstThemedBg`
    `WAITRON_LIGHT_BG`, `bgAfter` `FIXTURE_LIGHT_BG`, `JSON.parse(storedAfter!)` equals `FIXTURE_ANSWER`.
  - "a refused, failed or non-JSON answer keeps the stored copy and the page": `it.each` over
    `"refused"`, `"failed"`, `"not-json"` with the fixture stored → `bgAfter` `FIXTURE_LIGHT_BG`,
    `storedAfter` equal to the stored text, `appRendered` true.
  - "a malformed stored copy leaves a working page in Waitron's colours": stored `"{broken"`,
    `"never"` → `firstThemedBg` `WAITRON_LIGHT_BG`, `appRendered` true.
  - "on a dark device the stored copy paints its dark version on the first frame": `colorScheme:
    "dark"`, the fixture stored, `"never"` → `firstThemedBg` `FIXTURE_DARK_BG`. This is the case that
    measures the dark block nested inside `@media screen` in a `replaceSync` sheet, the one construct
    new to WebKit; the first case (light) is its control. Every other case uses `colorScheme: "light"`.

  In `apps/dashboard/vitest.config.ts`, add `probeVenueThemeStartup: venueThemeStartupProbe(new URL("./index.html", import.meta.url))`
  to `browserProject.test.browser.commands` and
  `provide: { startupEngines: (process.env.WAITRON_STARTUP_ENGINES ?? "chromium").split(",") }` to
  `browserProject.test`. Also add `entries: ["src/main.ts"]` to the config's top-level `optimizeDeps`
  (beside `include: ["axe-core"]`). Why: Vitest hands Vite's dependency scan only the browser test
  files (`@vitest/browser/dist/index.js:1048-1056`, `entries = [...browserTestFiles, …]`, returned as a
  plugin's `optimizeDeps.entries`, which Vite merges with the config's own). A package that only
  `main.ts` imports would be found only when this test loads `main.ts` mid-run; Vite then
  re-optimises and reloads every browser test in flight. The review's control run, with the scan
  missing what `main.ts` needs, printed `optimized dependencies changed. reloading`, `Vite unexpectedly
  reloaded a test` and two `504 (Outdated Optimize Dep)`, and the page never rendered in 60 s
  (`review-probes/vt/output-dashboard.txt`). Naming `main.ts` as an entry makes the scan find every
  package it reaches before the run. Check it once: `rm -rf node_modules/.vite` in the app, then
  `DEBUG=vite:deps pnpm --filter @waitron/dashboard exec vitest run src/venue-theme-startup.test.ts 2>&1 | /usr/bin/grep -n 'main.ts\|reloaded\|Outdated'`
  must list `src/main.ts` among the crawled entries and print no `reloaded` or `Outdated` line; if
  the merged entries turn out not to include it, fall back to listing in `optimizeDeps.include` each
  package `main.ts` reaches that no test imports, and say which.

- [ ] **Step 2: Run it and watch it fail**

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/venue-theme-startup.test.ts`
  Expected: FAIL — the stored-copy case prints `expected '#f7f7f8' to be '#edf6f0'` and the late case
  `expected '#f7f7f8' to be '#edf6f0'` for `bgAfter`, and the refused, failed and non-JSON cases the
  same for `bgAfter`; the no-copy case and the malformed case pass (today's `main.ts` shows Waitron's
  colours, which is what they expect), and the dark case prints `expected '#101216' to be '#0b110d'`.
  `themeRequests` is 0.

- [ ] **Step 3: Implement** — in `apps/dashboard/src/main.ts`, import `startVenueTheme` from
  `@waitron/ui` and call `startVenueTheme(document.documentElement)` on the line after
  `applyTokens(document.documentElement)` and before `startThemeChoice`.

- [ ] **Step 4: Run it and watch it pass**

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/venue-theme-startup.test.ts`
  Expected: PASS, `Tests 8 passed (8)`. Note the file's duration from the summary; if it is over
  60 s, say so in the handover (a CI shard should stay near 4 minutes, CLAUDE.md §2).

- [ ] **Step 5: Focused checks**

  Run: `pnpm --filter @waitron/dashboard typecheck && pnpm --filter @waitron/dashboard lint && pnpm --filter @waitron/ui lint && pnpm format:check`
  Expected: each exits 0.
  The typecheck gap: `apps/dashboard/tsconfig.json`, `apps/till/tsconfig.json` and
  `packages/ui/tsconfig.json` all `include` `src` only (the review ran `tsc --noEmit --listFilesOnly`
  in `apps/till`: 2040 files, none of `native-reload`, `vitest.config` or `hold-draft`), so no package
  typechecks a `vitest.config.ts` or a Node-side command file today, `apps/till/test/native-reload.ts`
  included. The browser-side fixture IS typechecked, through its import from `src/*.test.ts`. Try
  closing the gap for the new file: add `"test"` to `packages/ui/tsconfig.json`'s `include`, then run
  `pnpm --filter @waitron/ui exec tsc --noEmit --listFilesOnly | /usr/bin/grep -c 'packages/ui/test/'`
  (must print 2) and `pnpm --filter @waitron/ui typecheck`. Keep the change only if the typecheck
  passes with no change outside `packages/ui/test/` (the command file needs Node's and Playwright's
  types, which `"types": ["vitest/globals"]` may not bring in); otherwise revert it and write in the
  handover and the PR that the command file is linted and formatted but not typechecked, as
  `native-reload.ts` is not.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/ui/test packages/ui/tsconfig.json apps/dashboard/src/main.ts apps/dashboard/vitest.config.ts apps/dashboard/src/venue-theme-startup.test.ts
  git commit -s -m "dashboard: start the venue theme with the token layer, and probe its first frames"
  ```

---

### Task 4: The till starts the theme, and the WebKit measurement in both apps

**Files:**
- Create: `apps/till/src/venue-theme-startup.test.ts`
- Modify: `apps/till/src/main.ts:16-17`, `apps/till/vitest.config.ts:48-62`
- Modify: `docs/developers/testing-guide.md` (a new section), `docs/superpowers/specs/2026-10-19-a841-theme-editor-design.md` (dated receipts at section 12's WebKit sentence, lines 2222-2224, and section 17's "WebKit not yet measured", line 2661)

**Interfaces:**
- Consumes: Task 3's command and fixture; `startVenueTheme`.

- [ ] **Step 1: Write the failing test** `apps/till/src/venue-theme-startup.test.ts`: the same eight
  cases as Task 3's, against the till's `index.html`; register the command, `provide` and
  `optimizeDeps.entries: ["src/main.ts"]` in the till's config as Task 3 did (the till's config
  already has a top-level `optimizeDeps.include`), with the same `DEBUG=vite:deps` check. The till's `main.ts` checks trust before booting
  (`apps/till/src/main.ts:24-28`), and with every API path answering 401 it shows an error screen;
  `appRendered` still holds, because `#app` receives an element either way.

- [ ] **Step 2: Run it and watch it fail**

  Run: `pnpm --filter @waitron/till exec vitest run src/venue-theme-startup.test.ts`
  Expected: FAIL as in Task 3 (`expected '#f7f7f8' to be '#edf6f0'` on the stored-copy and late
  cases).

- [ ] **Step 3: Implement** — `startVenueTheme(document.documentElement)` after `applyTokens` in
  `apps/till/src/main.ts`.

- [ ] **Step 4: Run it and watch it pass**

  Run: `pnpm --filter @waitron/till exec vitest run src/venue-theme-startup.test.ts`
  Expected: PASS, `Tests 8 passed (8)`.

- [ ] **Step 5: The WebKit measurement, both apps**

  Run (from `apps/till`): `node -e "const p=require('playwright').webkit.executablePath();console.log(p, require('fs').existsSync(p))"`
  — it prints the path and `true` when WebKit is installed; on `false`, `pnpm --filter @waitron/till exec playwright install webkit` (it downloads into the
  shared Playwright cache, as D10's probe did).
  Run: `WAITRON_STARTUP_ENGINES=chromium,webkit pnpm --filter @waitron/dashboard exec vitest run src/venue-theme-startup.test.ts`
  and the same for `@waitron/till`.
  Expected: `Tests 16 passed (16)` in each, the WebKit cases named `webkit`. A WebKit case that
  fails is a finding about WebKit, not a reason to drop it: record its message. If WebKit cannot
  load modules from the Vitest server at all, run
  `~/waitron-campaign/a841-plan3/probes/startup-harness.mjs` adapted to seed the stored copy (it
  starts its own Vite server on the app, D10) and record that instead, saying so.
  Record, for the PR description: each engine's name and version, the eight results per app, and the
  frame time of `firstThemedBg` in the stored-copy case (add it to `StartupProbeResult` only if it
  costs one line; otherwise read it from a console line the command prints).

- [ ] **Step 6: Write the receipts**
  - `docs/developers/testing-guide.md`: a section "The start-up probe runs WebKit only when asked" —
    the command, `WAITRON_STARTUP_ENGINES=chromium,webkit`, that CI installs Chromium alone so CI's
    count is eight per app and a WebKit run's is sixteen, how to install WebKit locally, the
    path-not-glob routing trap, and that the probe loads the real `main.ts` through Vitest's server,
    so `optimizeDeps.entries` names `src/main.ts` — without it a package only `main.ts` imports sets
    off "Vite unexpectedly reloaded a test" (cite the review's control run).
  - The design, section 12 and section 17: a dated line each, "Measured 2026-10-2x in slice 3:" with
    the engines' versions and what the eight cases printed in WebKit, pointing at the test files. No
    rewrite of the surrounding text (CLAUDE.md §6: historical docs take a dated pointer).

- [ ] **Step 7: Focused checks**

  Run: `pnpm --filter @waitron/till typecheck && pnpm --filter @waitron/till lint && pnpm format:check`
  Expected: each exits 0. `docs/` is ignored by Prettier whole (CLAUDE.md §2), so the docs need no
  format run.

- [ ] **Step 8: Commit**

  ```bash
  git add apps/till/src/main.ts apps/till/vitest.config.ts apps/till/src/venue-theme-startup.test.ts docs/developers/testing-guide.md docs/superpowers/specs/2026-10-19-a841-theme-editor-design.md
  git commit -s -m "till: start the venue theme with the token layer; measure start-up in WebKit"
  ```

---

### Task 5: The dashboard's live theme read

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (a method beside `getContentLanguages`, `:2418-2420`)
- Modify: `apps/dashboard/src/api/live-queries.ts:96` area (`QUERY_DEPENDENCIES`)
- Modify: `apps/dashboard/src/dashboard-app.ts` (`#applyMe` `:1141-1192`, `#returnToLogin` `:1335-1345`, a `DashboardQueries` beside `#alertQueries` `:940-944`)
- Modify: `apps/dashboard/src/api/client.test.ts`
- Create: `apps/dashboard/src/dashboard-app.venue-theme.test.ts`
- Modify: `docs/developers/design-system.md:202-205`, `docs/developers/dashboard-live-updates.md`
- Modify: the shared `stubApi` builders of every suite that mounts the shell (Step 3)

**Interfaces:**
- Consumes: `applyVenueTheme`, `startVenueTheme`, `VenueThemeAnswer` (Task 1).
- Produces: `DashboardApi.getVenueTheme(): Promise<VenueThemeAnswer>` —
  `return this.background.#request<VenueThemeAnswer>("/api/theme", "GET")` (D5);
  `QUERY_DEPENDENCIES.getVenueTheme: ["custom_themes"]`, with a one-line comment that slice 7 adds
  `media_images`.

- [ ] **Step 1: Write the failing tests**
  - `client.test.ts`, "the venue theme read is a passive GET of /api/theme, even from the active
    client": `new DashboardApi("", fetchImpl, undefined, active)`; `await api.getVenueTheme()`
    resolves the reply; path `/api/theme`, method `GET`, header `x-waitron-live` `"1"`, `active` not
    called (the pattern of `client.test.ts:3270-3285`).
  - `dashboard-app.venue-theme.test.ts` — each case: `applyTokens(document.documentElement)`;
    `startVenueTheme(document.documentElement, { fetchImpl: rejecting })` (so the start-up fetch
    changes nothing); mount `dashboard-app` with a stub api whose `getMe` resolves a manager session
    (the `meResponse` shape `dashboard-app.test.ts` uses), `liveData: new LiveData()` and
    `getVenueTheme: vi.fn()` resolving a GREEN-like fixture answer (`FIXTURE_ANSWER` from
    `packages/ui/test/venue-theme-fixture.ts`, plus a second answer with another `hash` and
    `--wt-color-bg: #fff3f3`). `afterEach`: `cleanupWidgets()`, clear the stored key, and start the
    theme again with no stored copy to empty the sheet.
    - "a signed-in shell paints the theme in use": after flush, `bg()` is `FIXTURE_LIGHT_BG`.
    - "a change to the custom themes repaints without a reload": the stub now answers the second
      answer; `liveData.invalidate([{ type: "custom_themes" }])`; `await vi.waitFor(() => expect(bg()).toBe("#fff3f3"))`.
    - "a change elsewhere reads nothing": record `getVenueTheme`'s call count;
      `liveData.invalidate([{ type: "incidents" }])`, flush → count unchanged.
    - "a staff session follows the theme too": `getMe` with the staff role → `getVenueTheme` called
      and `bg()` is `FIXTURE_LIGHT_BG`.
    - "a signed-out shell does not read it": `getMe` rejecting `management_session.required` →
      `getVenueTheme` never called.
    - "after returning to sign-in, changes read nothing": sign in, then dispatch
      `waitron-session-invalid` with `management_session.expired` (the event
      `dashboard-app.ts:952-962` handles); invalidate `custom_themes` → call count unchanged.
    - "a failed read keeps the page and is recorded": `getVenueTheme` rejecting `{ code: "connection.failed" }`
      after a first good read; invalidate → `bg()` unchanged; `diag.record` spied called with
      `("warn", "theme.load_failed", { code: "connection.failed" })`.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts src/dashboard-app.venue-theme.test.ts`
  Expected: FAIL — `api.getVenueTheme is not a function` in the client case; the shell cases print
  `expected '#f7f7f8' to be '#edf6f0'` and `getVenueTheme` called 0 times where 1 is expected.

- [ ] **Step 3: Implement**
  - `getVenueTheme` and its `QUERY_DEPENDENCIES` entry.
  - In `dashboard-app.ts`: `readonly #venueThemeQueries = new DashboardQueries(this, () => this.api, (error) => diag.record("warn", "theme.load_failed", { code: codeOf(error) }))`;
    `#watchVenueTheme()` calls `void this.#venueThemeQueries.watch("getVenueTheme", [], (answer) => applyVenueTheme(answer)).catch(() => undefined)`,
    called from `#applyMe` beside `this.#watchAlerts()` (`:1191`) for every role;
    `this.#venueThemeQueries.release("getVenueTheme")` in `#returnToLogin` beside the content
    languages' release (`:1339`).
  - Up front, before running anything: add
    `getVenueTheme: vi.fn().mockResolvedValue({ hash: "waitron", css: "", logo: null })` to every
    shared `stubApi` builder of a suite that mounts the shell — find them with
    `git grep -l '"dashboard-app"' -- 'apps/**/*.test.ts' 'packages/**/*.test.ts'`, which lists the
    `apps/dashboard/src/dashboard-app*.test.ts` files and also `screens/menus-screen.test.ts` and
    `screens/floor-plan-editor.unsaved.test.ts`. Without it, a stub lacking the method records a
    `theme.load_failed` on the diagnostics trail, and `dashboard-app.test.ts:6700-6709` compares that
    trail's last entry before and after an action, so its result would depend on when the record
    lands. This is set-up, not an assertion. List each stub changed in the handover.

- [ ] **Step 4: Run them and watch them pass**

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts src/dashboard-app.venue-theme.test.ts`
  Expected: PASS, with the `Tests` count.

- [ ] **Step 5: Docs** — `design-system.md:202-205`: replace "no screen applies a venue's theme yet
  (A841)" with a sentence that the dashboard and the till apply the theme in use
  (`packages/ui/src/venue-theme.ts`), and that until the editor lands (A841 slice 5) nothing writes
  one. Grep the whole file for other sentences saying a venue theme is not applied, and fix each.
  `docs/developers/dashboard-live-updates.md`: a dated line (2026-10-2x, A841 slice 3) that the shell's
  theme read sends EVERY read passively, its first included, through `DashboardApi.background`
  (`getVenueTheme`), unlike `DashboardQueries`' usual active first read, because it starts on its own
  at sign-in and must not count as activity — so a later session does not "fix" it back.

- [ ] **Step 6: Focused checks**

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app src/api/live-queries.test.ts src/screens/menus-screen.test.ts src/screens/floor-plan-editor.unsaved.test.ts`
  (every suite that mounts the shell: the shell's session start changed, and memory note "seed/gating change → full
  package suite" applies to a change at the session's start).
  Run: `pnpm exec vitest run scripts/live-subscriptions.test.ts`
  Expected: PASS; the second prints `Tests 1 passed (1)` — `custom_themes` is a declared resource.
  Run: `pnpm --filter @waitron/dashboard typecheck && pnpm --filter @waitron/dashboard lint && pnpm format:check`

- [ ] **Step 7: Commit**

  ```bash
  git add apps/dashboard/src docs/developers/design-system.md docs/developers/dashboard-live-updates.md
  git commit -s -m "dashboard: an open dashboard follows the theme in use through a passive live read"
  ```

---

### Task 6: The till follows the theme in use

**Files:**
- Modify: `apps/till/src/till-app.ts` (`#applyVenueSetup` `:9286-9308`, `#onMenuState` `:5562-5563`, a `#themeHash` field beside `#setupRevision` `:2207`)
- Modify: `apps/till/src/api/client.ts:210` (the comment "the till does not read it")
- Modify: `apps/till/src/till-app-setup-refresh.test.ts` (a new `describe` after `:394-699`)
- Modify: `docs/developers/conventions-ui.md:1494-1496,1519`

**Interfaces:**
- Consumes: `followVenueTheme`, `startVenueTheme` (Tasks 1-2).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests** — `describe("A841 the till follows the theme in use")`
  in `till-app-setup-refresh.test.ts`, reusing its `mountApp`, `openMesa`, `poll`, `state` and
  `till` helpers (`:296`, `:340-347`, `:405-408`, `:125-139`, `:206-226`). `beforeEach`: as the A768 describe (fake
  `setInterval` only), plus `applyTokens(document.documentElement)` — the till's `mountWidget` makes
  only its own host `<div>` a theme root (`apps/till/src/widgets/test-helpers.ts:66-73`), and the
  venue sheet matches `[data-wt-theme-root]` (`sheet.ts:24-30`), so without it `bg()` read from
  `<html>` is empty — then `startVenueTheme(document.documentElement, { fetchImpl: themeFetch })`
  where `themeFetch` is a `vi.fn` answering by a variable the test sets; `afterEach` empties the
  sheet as Task 1 and clears the stored key. `till()` answers gain `themeHash`.
  - "a moved theme hash repaints an open till without a reload": start read `themeHash: "h1"`
    (and `themeFetch` first answering `{ hash: "h1", css: "", logo: null }`); then `getTill` answers
    `{ ...moved, themeHash: "h2" }`, menu-state names `"s2"`, `themeFetch` answers the fixture with
    `hash: "h2"` → after `poll`, `await vi.waitFor(() => expect(bg()).toBe(FIXTURE_LIGHT_BG))` (the
    chain `getTill` → `#applyVenueSetup` → fetch → `json()` → apply can outlast `flush`'s rounds),
    and `themeFetch` was called once more.
  - "a setup change that keeps the theme fetches nothing": revision moves to `"s2"` with the same
    `themeHash` → `themeFetch` call count unchanged.
  - "the same revision fetches nothing" (the control for the per-poll follow): two polls naming
    `"s1"` → count unchanged.
  - "a failed theme fetch is tried again on the next poll": the fetch after the move rejects;
    `bg()` unchanged; next `poll` (same revision `"s2"`) → one more call, which answers the fixture
    → `await vi.waitFor` until `bg()` is `FIXTURE_LIGHT_BG`.
  - "a theme read from before a newer one never wins": covered by Task 2's order case; not repeated.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/till exec vitest run src/till-app-setup-refresh.test.ts -t "A841"`
  Expected: FAIL — `vi.waitFor` times out with `expected '#f7f7f8' to be '#edf6f0'` (the
  `applyTokens` above makes `<html>` a theme root, so Waitron's own page colour is what it reads), and
  `themeFetch` was called 1 time where 2 are expected.
  The two "fetches nothing" cases pass today (nothing fetches); they are the controls.

- [ ] **Step 3: Implement** — in `#applyVenueSetup`, when `typeof till.themeHash === "string"`,
  set `this.#themeHash = till.themeHash` and call `followVenueTheme(till.themeHash)`; in
  `#onMenuState`, after `#noteSetupRevision`, `if (this.#themeHash !== undefined) followVenueTheme(this.#themeHash)`.
  Change the comment at `client.ts:210` to say the till follows it through `followVenueTheme`.

- [ ] **Step 4: Run them and watch them pass**

  Run: `pnpm --filter @waitron/till exec vitest run src/till-app-setup-refresh.test.ts`
  Expected: PASS, the whole file (the A768 cases unchanged), with the `Tests` count.

- [ ] **Step 5: Docs** — `conventions-ui.md`:
  - `:1494-1496`: replace "the till reads neither it nor `/api/theme`" with: `#applyVenueSetup`
    hands `themeHash` to `followVenueTheme`, which fetches `/api/theme` and replaces the venue's
    sheet when it differs from the one applied, and each menu-state answer asks again, so a failed
    fetch is retried within a poll; pinned by "A841 the till follows the theme in use".
  - `:1519`: "A kitchen screen in device mode: nothing, the theme included. Nobody signs in on it, so
    it runs no poll (backlog A785); it takes the theme in use when it starts." Check the list's other
    entries still read true with the theme added.

- [ ] **Step 6: Focused checks**

  Run: `pnpm --filter @waitron/till exec vitest run src/till-app-setup-refresh.test.ts src/till-app.test.ts`
  Run: `pnpm --filter @waitron/till typecheck && pnpm --filter @waitron/till lint && pnpm format:check`
  Expected: each exits 0, with `Tests` counts read.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/till/src/till-app.ts apps/till/src/api/client.ts apps/till/src/till-app-setup-refresh.test.ts docs/developers/conventions-ui.md
  git commit -s -m "till: follow the theme in use when its hash moves, retrying on each poll"
  ```

---

## Driver steps (not implementer tasks)

- **Backlog** (`docs/backlog.md`, CLAUDE.md §6; "How to keep this file honest", `:7027-7039`):
  - The A841 entry (`:3190-3206`): its last sentence "Next: slice 3 (delivery)." becomes a line that
    slice 3 landed (#PR): the stored copy and fetch at start in the dashboard and the till, the
    dashboard's live read, the till's swap; "Next: slice 4 (primary-coloured text), then slice 5 (the
    editor)." Add "WebKit in CI for the A841 start-up probe" as its own short entry in the same area
    (controller ruling, 2026-10-21, D10): install WebKit in the dashboard and till shards with its
    system libraries under a bounded, retried apt step (CLAUDE.md §2), give the Playwright cache a
    key per engine so Chromium-only jobs do not save a cache without WebKit, and set
    `WAITRON_STARTUP_ENGINES=chromium,webkit` for those suites; whether WebKit's Linux libraries are
    missing from `ubuntu-latest` is an assumption to check first.
  - The entry "A841 slice 2 points its review left — decide before slice 3" (`:3217-3225`): the
    controller decided to KEEP all three — the nullable `in_use` with a CHECK of 1 is the design's
    deliberate choice; a malformed theme id answers `theme.not_found` so the permission check runs
    first; the token files stay shipped beside the bundle. Move it, as a decision, to the area's
    "Decisions and deliberate limits" — the entry sits under "The till, devices and table service"
    (`:2100`), whose detail file is `docs/backlog/till.md` (`## Decisions and deliberate limits`,
    `:1597`) — and delete it from the open list. The "optional tidy-ups" it mentions, not recorded
    individually, are dropped with it.
- **PR description:** the WebKit measurement (Task 4 step 5), the open point of D10, and that no
  server code changed.

---

## What was checked

- Every page start that applies the token layer (D1).
- Every reader of `themeHash`: `git grep -n themeHash -- apps packages` (non-test) found
  `apps/server/src/till-setup.ts:129`, `apps/server/src/venue-theme.ts:12,17,34` and
  `apps/till/src/api/client.ts:211`; the till fixture `apps/till/test/clock-app.ts:99` carries
  `themeHash: "theme"`, which reaches `followVenueTheme` only on a page that started the theme (D9),
  and no clock test does.
- Docs naming the delivery: `git grep -n -i 'api/theme\|themeHash\|waitron-venue-theme'` over
  `docs/developers`, `CLAUDE.md`, the guides and the backlog found `conventions-ui.md:1494-1496`
  (Task 6) and the backlog entries (driver step); `design-system.md:204-205` says no screen applies a
  theme (Task 5). The user guides mention no theme (`git grep -n -i theme -- 'apps/server/src/guide/en/*'`
  printed nothing); the guide gains the Appearance page in slice 5. CLAUDE.md needs no change: §3's
  rule "a value the till takes from its start read either refreshes through `setupRevision` or is
  listed as fixed until reload" holds with the theme refreshing.

## Changed test checks

None. No existing assertion changes. Every shared `stubApi` builder of a suite that mounts the
dashboard shell gains a `getVenueTheme` stub (Task 5 step 3) — set-up, not an assertion — the till's
`till()` fixture gains a `themeHash` field in the new describe only, and
`themes-api.public.test.ts` gains a case (Task 1) without changing its existing two.

## Left for later slices

- **Slice 7** adds `media_images` to `QUERY_DEPENDENCIES.getVenueTheme` (D5).
- **Slice 8** draws `logo` from the stored copy and the answer; it must check the value's shape
  (`null` or `{ light, dark }` of strings) before drawing, since this slice stores it unchecked (D3),
  and may give the logo's place a shorter wait than D4's 5 s. The module as planned exposes no way to
  ask for the current answer or whether the start-up fetch has finished, which the logo's place needs
  (design section 8a: empty "until the answer arrives or the fetch's time limit passes"): slice 8 adds
  a subscription to `venue-theme.ts` (the current answer, and finished or not). Slice 7, which
  reshapes `logo`, extends `isVenueThemeAnswer` and Task 1's server case with it.
- **Slices 10-11** add type tokens to the sheet; the equipment label's print frame is a theme root in
  the dashboard's document (D1) and copies font tokens, so those slices make it print in Waitron's
  type (design line 1398).
- **WebKit in CI** for the start-up probe (D10): out of this slice by the controller's ruling; the
  driver step's backlog entry carries it.

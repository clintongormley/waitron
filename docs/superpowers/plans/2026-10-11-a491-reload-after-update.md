# An open tab notices a box update and offers to reload — implementation plan (A491)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Every task is test-first: write the failing test, run it, watch it fail
> for the reason the step states, then write the smallest code that passes.

**Status:** plan, 2026-10-11. Not started. Nothing here is built.

**Goal:** after a box update, an already-open dashboard tab shows a bar "Waitron was updated.
[Reload]" / "Waitron se ha actualizado. [Recargar]", and an open till reloads by itself when nothing
would be lost, otherwise shows the same bar.

**Architecture:** the server names its build (`applicationVersion(process.env)`, A490's commit) in
one response header, `x-waitron-build`, on every response after `/health`. Each app wraps the fetch
it already routes every request through with a small watcher (`watchBuild`, in
`@waitron/diagnostics`): the first build a response from the page's own origin names is the page's
build; the first different one after it sends one window event. The dashboard shows a new shared
`wt-banner` under its brand banner; the till asks one `#busyForReload()` question and either reloads
or shows the same bar. No new request, poll or endpoint is added.

**Tech stack:** TypeScript, Hono (server middleware), Lit (apps and the `wt-*` primitive), Vitest
(node projects for server, shared and diagnostics; real headless Chromium for `ui`, `dashboard`,
`till`), Playwright (the final look and the end-to-end probe).

**Spec:** the owner's queue text for A491 in `~/waitron-campaign-b/queue.md`. There is no backlog
entry (`grep -rn A491 docs/backlog.md docs/backlog/` finds nothing on main `69fd9f0e1`). The text,
verbatim:

> A491. An open dashboard or till tab notices the box was updated and offers to reload (OWNER
> 2026-10-11: "yes, show a reload bar").
> - Why: after a box update an already-open tab keeps running the code it loaded until someone
>   refreshes (the owner hit this 2026-10-11). Caching is already right (`apps/server/src/spa-api.ts`:
>   hashed assets `immutable`, `index.html` `no-cache`), so a fresh load is fine — only an OPEN tab
>   is stale.
> - Build: the server exposes its build identity (A490's commit, e.g. on `/health` or a header on
>   API responses or the live stream — pick the cheapest that both apps already read, state why); the
>   page records the build it loaded with; when an open tab sees a different build, the dashboard
>   shows a bar "Waitron was updated. [Reload]" / "Waitron se ha actualizado. [Recargar]" (concise;
>   owner rule), and the till reloads by itself only when no order, payment or unsaved draft is open,
>   otherwise shows the same bar. Automatic reads stay passive (CLAUDE.md §3); a box RESET stays
>   A485's path (sign out), not this bar.
> - Tests first (Chromium): a changed build shows the bar; the same build never does; the till's busy
>   case shows the bar instead of reloading; Reload loads the new build. A `wt-*` primitive if the
>   bar is shared (token + axe tests, CLAUDE.md §3). LOOK EN/ES, both themes, 390 and 1280. Path by
>   risk (sessions/till state → FULL if a review says so). One-line FYI when it lands.

**Audited base.** Every pointer below was READ on main `69fd9f0e1` (2026-10-11) in the worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-service-reload-after-update`, branch
`feat/service-reload-after-update`. Line numbers are approximate and drift; search by the quoted
text. The author ran only the greps and file reads that found these pointers. A fresh-context plan
review on 2026-10-11 then ran probes where a claim decides the design; each is stated where it
applies (Decision 1, Task 1 Step 8, Task 2 Step 5, Task 5 Step 1, Task 6 Step 2), and everything
else is still reading.

**Rebase first.** `main` moved to `a66e4f06a` after this base (#1557 and a docs commit). It touches
`dashboard-app.test.ts`, the dashboard strings, `boot.ts`, the docs files and the END of
`till-app-boot-and-counter.test.ts` (a new `describe`, where Task 5 also appends), but none of the
lines the tasks anchor on. Rebase the branch onto `main` before Task 1.

**Review path: FULL** (per-task reviews, then the full `/finish-branch` wave with the two Codex
run-it reviews side by side). Risk triggers: a cross-package contract (a response header the server
writes and two apps read), and the till's sale state (the predicate that decides whether a reload
would lose an order, a payment or a draft).

---

## Decisions (defaults — answer any to override)

Decisions 1–8 came from the lane runner; where this plan changes one it says **CHANGED** and why.

1. **Transport: one response header, `x-waitron-build: <applicationVersion(process.env)>`, on
   every response after `/health`, in trading and setup mode.** Both apps already send every request
   through one fetch wrapper, and both already make automatic reads (the dashboard re-reads its
   screens when its live stream reconnects after a restart, `LiveConnection` `open`/`error` →
   `data.refresh()` in `packages/dashboard-kit/src/live-connection.ts`, and when a hidden tab comes
   back into view, `#onVisibilityChange` in `apps/dashboard/src/dashboard-app.ts`; the till's
   `ServerRouter` probes `<origin>/api/node` every 5 s, `apps/till/src/api/server-router.ts`
   `start()`/`#probe`). So no request, poll or endpoint is added and passivity is unchanged.
   `/health` was rejected: neither app reads it. The live stream was rejected: `EventSource` exposes
   no response headers, and the till does not open one.
   - **CHANGED — the header is set AFTER the handler runs**, not before like `x-request-id`.
     Measured 2026-10-11 by the plan reviewer with a Node script against the installed
     `hono@4.13.9` (`node_modules/.pnpm/hono@4.13.9`), one `app.use("*")` middleware, `app.request`:
     set BEFORE `next()`, `c.json`, `c.body`, a thrown error (500, with and without `onError`) and an
     unmatched path (404) all carried the header, and a handler returning its own
     `new Response("raw", { headers: { "x-own": "kept" } })` did NOT (`null`; `x-own` kept). Set
     AFTER `next()`, all six carried it, including `/raw`, and so did a `Response.redirect(...)`
     (immutable headers) and a `fetch()` response passed straight through (its own `x-up` kept).
     Task 1's `/raw` case is the committed test of it.
   - **Exposure, for the owner (FYI default: accepted).** Today no HTTP surface names the build
     (`grep -rn "applicationVersion\|WAITRON_BUILD_ID" apps/server/src` outside tests finds only the
     fiscal-readiness record and boot's own calls). With this header every response after `/health`
     names the image's commit to anyone who can reach the box, signed in or not, including the cloud
     public routes `mountCloudPublic` registers after the middleware. Limiting it to signed-in
     responses would cost the idle till its only signal: its 5 s `/api/node` probe carries no
     operator session.
   - **CHANGED — the `corsForVenue` `exposeHeaders` change is dropped.** The watcher compares only
     responses to requests for the page's own origin (decision 2), so a cross-origin response's
     header is never read. Reason: a till whose `ServerRouter` points at another server
     (`withServerTarget` rewrites `/...` to `${router.current}/...`) would otherwise compare THAT
     server's build with the page's. If they differ, an idle till reloads, loads the page from its
     own origin again, records that origin's build, follows the router to the other server again,
     and reloads again — a loop. Another server's build also says nothing about whether THIS page is
     stale: the page came from its own origin. `apps/server/src/cors.ts` and its test are untouched.
2. **Detector: `watchBuild(fetch, { origin, onChange })` in `packages/diagnostics`** (both apps
   depend on it; it already holds `createInstrumentedFetch`; it is browser-safe and tested in Node).
   The first non-empty build named by a response to a request for `origin` is the page's own; the
   first different one after it calls `onChange(build)` once, and nothing after that does. A missing
   or empty header changes nothing, and is never recorded as the page's build. A rejected fetch
   rejects unchanged; the response is returned unchanged.
   - **The page's build is the first one it SEES, not the one it loaded with.** If the box updates
     between serving `index.html` and the page's first request, the page records the new build while
     running the old code, and never shows the bar. Accepted: the window is one boot's length.
   - **Dev servers** answer `applicationVersion(process.env)` = `npm_package_version` or
     `"development"`, which does not change between requests, so the bar never shows in dev unless
     someone restarts the server with a different `WAITRON_BUILD_ID`.
   - **The header name lives once, as `BUILD_HEADER` in `@waitron/shared`**, imported by the server
     middleware and by the watcher, so the two sides cannot drift. `@waitron/diagnostics` gains a
     dependency on `@waitron/shared` (it has none today); the apps and the server already depend on
     it.
   - **The till also hands the watched fetch to its `ServerRouter`** (decision added here), so its
     5 s probe of its own origin's `/api/node` is read too. That is what lets an idle till on the lock
     screen, which may make no other request, notice the update. It adds no request.
   - **On a one-node box the till's API calls are own-origin too** (by reading
     `apps/till/src/api/server-router.ts`): `current` starts at `opts.origin` (`location.origin`),
     `#merge` always lists the page's own origin first, and `#runRound` moves only to a primary
     whose `term` is strictly higher (`reduce` with `>`), so a box that lists itself under a second
     URL with the same term does not move it. `withServerTarget` then turns `/api/...` into
     `${location.origin}/api/...`, which the watcher reads. If the router ever does move, the 5 s
     probe of the page's own origin still carries the header.
3. **A new shared primitive, `wt-banner`, in `packages/ui/src/components/`.** A full-width strip:
   `message`, `action-label`; when an action label is set it draws one native button, and pressing
   it stops the click and sends `wt-banner-action` (`detail: {}`, `bubbles: true, composed: true`).
   The host takes `role="status"` unless given a role (as `wt-notice` does). Reads only `--wt-*`
   tokens. Token-painting test plus a sibling `wt-banner.a11y.test.ts` over each state in both
   themes.
4. **Dashboard:** on the event it shows `wt-banner` "Waitron was updated." / "Waitron se ha
   actualizado." with "Reload" / "Recargar", which calls an injected `reload` (default
   `() => location.reload()`, the login screen's own pattern, `login-screen.ts`
   `@property … reload`). Shown on the sign-in page and on signed-in screens; NOT while the A485 reset
   notice (`sessionNoticeCode === "node.reset"`) is shown — reset wins, in either order, and the reset
   view already has its own Reload. Not dismissable.
   - **CHANGED — the bar sits directly UNDER the brand banner, not above it.** CLAUDE.md §3 ("The
     dashboard banner is persistent identity chrome — top of the page, full width") and
     `conventions-ui.md` keep the brand banner at the top. Signed in, the bar goes inside
     `.banner-row` after the banner, so the alerts toast (positioned at `100%` of `.banner-row`)
     opens below the bar rather than over its Reload button.
   - A Reload pressed while a dashboard form holds unsaved changes meets the browser's own "leave
     site?" prompt: the leave coordinator adds a `beforeunload` guard while any draft is dirty
     (`createLeaveCoordinator` → `refreshUnload`, `packages/ui-core/src/unsaved-changes.ts`). That is
     wanted.
5. **Till:** on the event, `#busyForReload()` decides once: idle → `this.reload()` and no bar; busy →
   the bar (till strings), which stays until someone presses Reload. The till never reloads later by
   itself.
   - **CHANGED — a signed-in person counts as busy.** A reload signs the operator out: the page
     starts on `screen = "lock"` (`till-app.ts`, `@state() private screen: Screen = "lock"`, and
     `#boot` sets it again), and the only writer of a non-empty `operatorName` is `#enterSignedIn`.
     Its two callers are `#onLoggedIn`, answering the lock screen's `logged-in` event, which only
     `#submit` sends, after `api.login(personId, pin)` succeeds (`screens/till-lock-screen.ts`), and
     `#enterSwitchedProfile`, which passes the name already signed in. `#boot` reads locales, the
     till, the dev device list and the device identity; none of them restores a person. Found by
     grep and reading on 2026-10-11, not run against a real reload; Task 6 Step 3.5 is that run.
     So an idle till reloads by itself only with nobody signed in: on the lock screen, or as a
     kitchen display (no sign-in at all).
   - The spec's "reloads by itself only when no order, payment or unsaved draft is open" names
     conditions a reload must meet, not a promise to reload whenever they hold, so adding "nobody
     signed in" keeps to its words; it is still a product choice, and goes to the owner as an FYI
     default (Task 7 Step 2). Alternative: reload a signed-in till with nothing open, and the
     operator types their PIN again.
   - **Busy** = someone signed in (`operatorName !== ""`), or a sign-in still loading
     (`#loginPending`), or the basket or the table-free draft holds a line (`#store.lines`,
     `#partylessDraft.lines` — a retrieved held order is clean but still an order on screen), or any
     unsaved draft (`this.leave.coordinator.isDirty()` with no arguments, so the basket's scope
     counts), or a payment or refund not yet answered (`submitting`, `#cardAttemptsRunning > 0`,
     `#unansweredPayment`, `#unansweredRefund`). The last two are wider than "not yet answered":
     `unansweredAfter` (`apps/till/src/state/bill-payment.ts`) keeps the submission after an
     unanswered send AND after any refusal outside `FRESH_ID_AFTER`, and only a later send's answer
     replaces it (`till-app.ts` writes the two fields nowhere else), so an
     idle till that once had a bill payment or refund refused shows the bar instead of reloading.
     Accepted: the bar loses nothing, and a reload would drop the id a resend must reuse. A payment sent before an idle sign-out keeps
     `submitting` true until the server answers (it is cleared only in each payment's `finally`, not
     by `#endOperatorSession`), which is why the in-flight terms are there even though sign-out
     already counts.
   - **FYI default:** a person halfway through typing a PIN is NOT busy — typed PIN digits are not a
     draft (`till-lock-screen.unsaved.test.ts`, "typed PIN never protects page departure or unload"),
     so the till reloads and they type it again. Alternative: treat an open PIN pad as busy.
   - **FYI default:** once the bar shows it stays; the alternative is to reload by itself the next
     time the till goes idle (for example after its idle sign-out).
   - Reload from the bar while the basket's scope is dirty meets the browser's `beforeunload`
     prompt, as any reload does (the W69 native-reload tests in `till-app.unsaved-changes.test.ts`
     run that path). Wanted: it warns before the basket, which lives only in memory, is lost.
6. **Strings** `update.message` and `update.reload` in `apps/dashboard/src/i18n/strings.ts` and
   `apps/till/src/i18n/strings.ts`, English and Spanish. Key parity is enforced by the type
   (`export const es: Record<StringKey, string>` in both files), so a missing Spanish key fails
   `typecheck`.
7. **Docs:** `design-system.md` (the `wt-banner` row, the a11y-verified list, the dashboard banner
   paragraph and a till sentence); `conventions-ui.md` (a section on the header and the busy rule);
   the backlog has no A491 entry to delete; this item's deliberate limits go in
   `docs/backlog/dashboard.md` → "Decisions and deliberate limits". No CLAUDE.md line.
8. **Review path: FULL**, as above. The CORS change that was one reason for it is gone (decision 1);
   the header contract and the till's sale-state predicate remain.

---

## Global Constraints

- Bar wording, exactly: English "Waitron was updated." with button "Reload"; Spanish "Waitron se ha
  actualizado." with button "Recargar" (concise; owner rule).
- Automatic reads stay passive (CLAUDE.md §3). No new request, poll, endpoint or timer.
- A box RESET stays A485's path (sign out, the login screen's reset notice), never this bar.
- Caching is not changed (`apps/server/src/spa-api.ts`).
- Tests first, in real Chromium for the UI (`ui`, `dashboard`, `till`), in Node for `server`,
  `shared`, `diagnostics`.
- A new `wt-*` primitive: a token-painting test and a sibling `*.a11y.test.ts` covering each state
  in both themes; its custom event is named `wt-*`, carries `detail`, is dispatched
  `bubbles: true, composed: true`, and the native click is stopped first (CLAUDE.md §3).
- Every colour, spacing, radius and font reads a declared `--wt-*` token; no hex, no named colours,
  no `rem`/`em`, no `px` above 1.
- LOOK: English and Spanish, light and dark, 390 px and 1280 px wide.
- Coverage holds `98/98/98/95` in every package touched; `ui` and `shared` hold a mutation floor of
  90.
- Comments only for an invariant or a non-obvious why the code cannot show; never history.
- Every commit `git commit -s`, message in plain English. Never `--no-verify`. Do not push from a
  task; `/finish-branch` pushes.
- Browser runs: check `memory_pressure | grep free` first; run beside another session's browser run
  only when free memory is well above 15%. Kill only processes you started, by pid.
- One-line FYI to the owner when it lands (Task 7 drafts it).

## Review Focus

The five conditions most likely to bite a person that the spec implies but does not name, each with
the test that pins it in the task that owns the code:

1. **A till operator mid-order or mid-payment when the box updates** — the till must never reload
   under them; it shows the bar. Pinned in Task 5: signed in with an empty basket; a sign-in still
   loading; a cash payment still waiting for the server after an idle sign-out emptied the screen.
2. **A response with no build header** (a reverse proxy's 502 while the box restarts, the failed-start
   recovery page served by `recoveryApp`, which this change does not touch, a tunnel that drops
   headers) — nothing changes, and it never becomes the page's own build. Pinned in Task 2: a missing
   header and an empty header, first and in the middle.
3. **A till whose router points at another server with another build** — no bar and no reload loop.
   Pinned in Task 2: a response from another origin naming a different build is ignored, and is never
   recorded as the page's build.
4. **A box reset that is also an update** — the reset notice wins, whichever response arrives first.
   Pinned in Task 4: reset then new build, and new build then reset.
5. **Two updates in quick succession** (or a build read once and then again) — one decision, one bar.
   Pinned in Task 2: builds `a, b, b, c` call `onChange` once, with `b`.

Known limits that are not tested, and are written into the backlog's deliberate limits in Task 7: a
signed-out dashboard tab that makes no automatic read notices the update only on its next request; a
page that first sees the new build records it as its own (decision 2); a half-typed PIN is lost to an
automatic reload (decision 5); an idle till that once had a bill payment or refund refused shows the
bar instead of reloading (decision 5); every response
after `/health` names the build to callers who are not signed in (decision 1).

---

## File map

| File | Change |
| --- | --- |
| `packages/shared/src/build-header.ts` (+ `.test.ts`) | New: `BUILD_HEADER = "x-waitron-build"` |
| `packages/shared/src/index.ts`, `index.test.ts` | Export it; pin the re-export |
| `apps/server/src/build-header.ts` (+ `.test.ts`) | New: `buildHeaderMiddleware(build)` |
| `apps/server/src/boot.ts` | Register it beside `requestIdMiddleware` |
| `apps/server/src/boot.test.ts` | Assert the header in trading, setup and SPA boots |
| `packages/diagnostics/package.json`, `pnpm-lock.yaml` | Depend on `@waitron/shared` |
| `packages/diagnostics/src/build-watch.ts` (+ `.test.ts`), `index.ts` | New: `watchBuild`, `BUILD_CHANGED_EVENT` |
| `packages/ui/src/components/wt-banner.ts` (+ `.test.ts`, `.a11y.test.ts`) | New primitive |
| `packages/ui/src/index.ts`, `packages/ui/demo/main.ts` | Export it; show it in the workbench |
| `apps/dashboard/src/i18n/strings.ts`, `dashboard-app.ts`, `main.ts`, `dashboard-app.test.ts` | The dashboard bar |
| `apps/till/src/i18n/strings.ts`, `till-app.ts`, `main.ts`, `till-app-boot-and-counter.test.ts` | The till's decision and bar |
| `docs/developers/design-system.md`, `conventions-ui.md`, `docs/backlog/dashboard.md` | Docs |

Existing tests that pin a whole shape this change could touch, and what each needs:

- `packages/ui/src/tap-target-and-focus.test.ts`, "the interactive set is exactly wt-button, …" —
  lists every primitive that reflects `disabled`. `wt-banner` reflects no `disabled`, so the list must
  stay unchanged; run it to show that.
- `packages/ui/src/no-hardcoded-chrome.test.ts` and `scripts/style-token-names.test.ts` — discover
  every `src/components/*.ts` themselves; `wt-banner` is covered as soon as the file exists.
- `packages/shared/src/index.test.ts` — pins named re-exports one group per case; add one case.
- `apps/server/src/cors.test.ts` — untouched (decision 1); no change expected.
- `boot.test.ts`'s setup-mode case asserts `node.reset`'s body with `toEqual`; this plan adds header
  assertions only, never touches a body.
- `scripts/workspace-cycles.test.ts` — reads every `package.json`; run it after diagnostics gains
  its dependency.

---

## Task 1: The server names its build on every response

**Files:**
- Create: `packages/shared/src/build-header.ts`, `packages/shared/src/build-header.test.ts`
- Modify: `packages/shared/src/index.ts` (beside the other re-exports), `packages/shared/src/index.test.ts`
- Create: `apps/server/src/build-header.ts`, `apps/server/src/build-header.test.ts`
- Modify: `apps/server/src/boot.ts` (~line 866–868: the comment and `app.use("*", requestIdMiddleware(log, now));`)
- Modify: `apps/server/src/boot.test.ts` (three existing cases, named below)

**Interfaces:**
- Produces: `export const BUILD_HEADER = "x-waitron-build";` from `@waitron/shared`.
- Produces: `export function buildHeaderMiddleware(build: string): MiddlewareHandler` from
  `apps/server/src/build-header.ts`.

- [ ] **Step 1: Write the failing shared test**

`packages/shared/src/build-header.test.ts`:

```ts
import { expect, it } from "vitest";
import { BUILD_HEADER } from "./build-header.js";

it("names the build header in lower case, as fetch's Headers report it", () => {
  expect(BUILD_HEADER).toBe("x-waitron-build");
});
```

Add a case to `packages/shared/src/index.test.ts` (import `BUILD_HEADER` in its import list):

```ts
  it("re-exports the build header name", () => {
    expect(BUILD_HEADER).toBe("x-waitron-build");
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/shared exec vitest run src/build-header.test.ts src/index.test.ts`
Expected: FAIL — `build-header.js` cannot be resolved, and `BUILD_HEADER` is `undefined` in the
index case.

- [ ] **Step 3: Write the constant and export it**

`packages/shared/src/build-header.ts`:

```ts
/** The response header naming the server build that answered. */
export const BUILD_HEADER = "x-waitron-build";
```

In `packages/shared/src/index.ts` add `export { BUILD_HEADER } from "./build-header.js";`.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @waitron/shared exec vitest run src/build-header.test.ts src/index.test.ts`
Expected: PASS, with a `Tests` count (a run with no count proves nothing).

- [ ] **Step 5: Write the failing middleware test**

`apps/server/src/build-header.test.ts`:

```ts
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { buildHeaderMiddleware } from "./build-header.js";

function app(): Hono {
  const a = new Hono();
  a.get("/health", (c) => c.json({ ok: true }));
  a.use("*", buildHeaderMiddleware("1c57940"));
  a.get("/api/staff", (c) => c.json([]));
  a.get("/manage/", (c) =>
    c.body("<html>dashboard</html>", 200, {
      "Content-Type": "text/html",
      "Cache-Control": "no-cache",
    }),
  );
  a.get("/raw", () => new Response("raw", { headers: { "x-own": "kept" } }));
  a.get("/boom", () => {
    throw new Error("boom");
  });
  return a;
}

describe("buildHeaderMiddleware", () => {
  it.each([
    ["/api/staff", 200],
    ["/manage/", 200],
    ["/raw", 200],
    ["/boom", 500],
    ["/nowhere", 404],
  ])("names the build on %s (%i)", async (path, status) => {
    const res = await app().request(path);
    expect(res.status).toBe(status);
    expect(res.headers.get("x-waitron-build")).toBe("1c57940");
  });

  it("keeps the headers and body of a handler that returns its own Response", async () => {
    const res = await app().request("/raw");
    expect(res.headers.get("x-own")).toBe("kept");
    expect(await res.text()).toBe("raw");
  });

  it("leaves a route registered before it without the header", async () => {
    const res = await app().request("/health");
    expect(res.headers.get("x-waitron-build")).toBeNull();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/build-header.test.ts`
Expected: FAIL — `./build-header.js` cannot be resolved.

- [ ] **Step 7: Write the middleware**

`apps/server/src/build-header.ts`:

```ts
import type { MiddlewareHandler } from "hono";
import { BUILD_HEADER } from "@waitron/shared";

export function buildHeaderMiddleware(build: string): MiddlewareHandler {
  return async (c, next) => {
    await next();
    // After `next`: a handler that returns its own Response does not inherit headers set before it.
    c.header(BUILD_HEADER, build);
  };
}
```

- [ ] **Step 8: Run it and watch it pass; then prove the "after" claim**

Run: `pnpm --filter @waitron/server exec vitest run src/build-header.test.ts`
Expected: PASS.

Then, as an experiment and not a commit: move `c.header(BUILD_HEADER, build);` above
`await next();`, run the same command, and record which cases fail. The plan reviewer's Node
script against the same `hono@4.13.9` (Decision 1) predicts exactly one: `names the build on /raw`,
with `null`. Put the result in the commit message. If NO case fails, the comment in Step 7 is
false: delete it, and say so in the commit message. Restore the line after `next`.

- [ ] **Step 9: Write the failing boot assertions**

In `apps/server/src/boot.test.ts`, import `applicationVersion` from `@waitron/db` (add it to the
existing `@waitron/db` import list), and add:

1. In "boots, pins the tick-clamp mapping, … serves /health and shuts down cleanly", after
   `expect(staff.headers.get("x-request-id"))…`:

   ```ts
      expect(staff.headers.get("x-waitron-build")).toBe(applicationVersion(process.env));
   ```

   and after `expect(catalogues.status).toBe(401);`:

   ```ts
      expect(catalogues.headers.get("x-waitron-build")).toBe(applicationVersion(process.env));
   ```

   and after `const response = await fetchHealthOk(…/health)`:

   ```ts
      expect(response.headers.get("x-waitron-build")).toBeNull();
   ```

2. In "boots in setup mode over HTTPS …", after `expect(management.status).toBe(404);`:

   ```ts
      expect(management.headers.get("x-waitron-build")).toBe(applicationVersion(process.env));
   ```

   and after `expect(root.status).toBe(200);`:

   ```ts
      expect(root.headers.get("x-waitron-build")).toBe(applicationVersion(process.env));
   ```

3. In "serves the built till at / and dashboard at /manage …", after `expect(till.status).toBe(200);`
   and after `expect(asset.status).toBe(200);`:

   ```ts
      expect(till.headers.get("x-waitron-build")).toBe(applicationVersion(process.env));
   ```

   ```ts
      expect(asset.headers.get("x-waitron-build")).toBe(applicationVersion(process.env));
   ```

The failing case prints `null` against a non-empty expected value, so the probe can tell the two
apart. `applicationVersion` is `env.WAITRON_BUILD_ID ?? env.npm_package_version ?? "development"`
(`packages/db/src/venue-holder-identity.ts`): it is empty only when one of those variables is SET to
the empty string, which none of these commands does. (On a box that happened, every response would
carry an empty header, which the watcher ignores: no bar, ever.)

- [ ] **Step 10: Run them and watch them fail**

Run: `pnpm --filter @waitron/server exec vitest run src/boot.test.ts -t "serves /health and shuts down cleanly|boots in setup mode over HTTPS from a minted|serves the built till at"`
Expected: FAIL in all three cases, each with `expected null to be '<version>'` (the `/health` line
passes already).

- [ ] **Step 11: Register the middleware in boot**

In `apps/server/src/boot.ts`, import `buildHeaderMiddleware` from `./build-header.js` and change:

```ts
  // Registered before every surface below, so it wraps all of them; `/health`, registered above, is
  // deliberately left out of the request log.
  app.use("*", requestIdMiddleware(log, now));
```

to:

```ts
  // Registered before every surface below, so they wrap all of them; `/health`, registered above, is
  // deliberately left out of the request log and names no build.
  app.use("*", requestIdMiddleware(log, now));
  app.use("*", buildHeaderMiddleware(applicationVersion(process.env)));
```

(`applicationVersion` is already imported there from `@waitron/db`; its two other calls also read
`process.env`.)

- [ ] **Step 12: Run them and watch them pass**

Run the Step 10 command again. Expected: PASS, three tests.
Then run `pnpm --filter @waitron/server exec vitest run src/cors.test.ts src/request-id.test.ts`
(untouched neighbours) — PASS.

- [ ] **Step 13: Checks**

Run: `pnpm --filter @waitron/shared typecheck && pnpm --filter @waitron/server typecheck && pnpm exec eslint packages/shared/src/build-header.ts packages/shared/src/index.ts apps/server/src/build-header.ts apps/server/src/build-header.test.ts apps/server/src/boot.ts && pnpm exec prettier --check packages/shared/src apps/server/src/build-header.ts apps/server/src/build-header.test.ts apps/server/src/boot.ts apps/server/src/boot.test.ts`
Expected: each exits 0.

- [ ] **Step 14: Commit**

```bash
git add packages/shared/src/build-header.ts packages/shared/src/build-header.test.ts \
  packages/shared/src/index.ts packages/shared/src/index.test.ts \
  apps/server/src/build-header.ts apps/server/src/build-header.test.ts \
  apps/server/src/boot.ts apps/server/src/boot.test.ts
git commit -s -m "Every server response after /health names the build that answered it (A491)" \
  -m "<one paragraph in plain English: the x-waitron-build header, set after the handler runs; the Step 8 experiment and what it printed>"
```

---

## Task 2: A fetch watcher that notices when the server's build changes

**Files:**
- Modify: `packages/diagnostics/package.json` (add `"dependencies": { "@waitron/shared": "workspace:*" }`), `pnpm-lock.yaml` (by `pnpm install`)
- Create: `packages/diagnostics/src/build-watch.ts`, `packages/diagnostics/src/build-watch.test.ts`
- Modify: `packages/diagnostics/src/index.ts`

**Interfaces:**
- Consumes: `BUILD_HEADER` from `@waitron/shared` (Task 1).
- Produces, from `@waitron/diagnostics`:
  - `export const BUILD_CHANGED_EVENT = "waitron-build-changed";`
  - `export interface BuildWatchOptions { origin: string; onChange: (build: string) => void }`
  - `export function watchBuild(baseFetch: typeof fetch, options: BuildWatchOptions): typeof fetch`

- [ ] **Step 1: Add the dependency**

Add to `packages/diagnostics/package.json`, after `"scripts"`:

```json
  "dependencies": {
    "@waitron/shared": "workspace:*"
  },
```

Run: `pnpm install` (from the worktree root). Expected: exits 0 and `pnpm-lock.yaml` changes only in
the `packages/diagnostics` importer. Then run
`pnpm exec vitest run scripts/workspace-cycles.test.ts` — PASS (`@waitron/shared` depends on no
workspace package that depends on diagnostics).

- [ ] **Step 2: Write the failing tests**

`packages/diagnostics/src/build-watch.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { watchBuild } from "./build-watch.js";

const ORIGIN = "https://waitron.local";

/** Answers each call with the next build in turn; `null` answers with no build header. */
function serving(...builds: (string | null)[]) {
  const queue = [...builds];
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const build = queue.shift() ?? null;
    return new Response("{}", { headers: build === null ? {} : { "x-waitron-build": build } });
  });
}

function watched(base: typeof fetch) {
  const onChange = vi.fn();
  return { fetch: watchBuild(base, { origin: ORIGIN, onChange }), onChange };
}

describe("watchBuild", () => {
  it("records the first build and stays quiet while it repeats", async () => {
    const { fetch, onChange } = watched(serving("a", "a", "a") as unknown as typeof globalThis.fetch);
    for (let i = 0; i < 3; i++) await fetch("/api/node");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("tells once, with the new build, however many builds follow", async () => {
    const { fetch, onChange } = watched(
      serving("a", "b", "b", "c") as unknown as typeof globalThis.fetch,
    );
    for (let i = 0; i < 4; i++) await fetch("/api/node");
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("ignores a response with no build header or an empty one, first or later", async () => {
    const { fetch, onChange } = watched(
      serving(null, "", "a", null, "", "a", "b") as unknown as typeof globalThis.fetch,
    );
    for (let i = 0; i < 6; i++) await fetch("/api/node");
    expect(onChange).not.toHaveBeenCalled();
    await fetch("/api/node");
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("ignores another origin's build, and never takes it as the page's own", async () => {
    const { fetch, onChange } = watched(
      serving("z", "a", "z", "a") as unknown as typeof globalThis.fetch,
    );
    await fetch("https://standby.local/api/node");
    await fetch(`${ORIGIN}/api/node`);
    await fetch("https://standby.local/api/node");
    await fetch(`${ORIGIN}/api/node`);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reads a relative path, a URL and a Request as the page's origin", async () => {
    const { fetch, onChange } = watched(
      serving("a", "a", "b") as unknown as typeof globalThis.fetch,
    );
    await fetch("/management-api/session/me");
    await fetch(new URL(`${ORIGIN}/api/till`));
    await fetch(new Request(`${ORIGIN}/api/till`));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("treats a URL it cannot parse as another origin, without throwing", async () => {
    const { fetch, onChange } = watched(serving("a", "b") as unknown as typeof globalThis.fetch);
    await fetch("http://[");
    await fetch("/api/node");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("passes the request through and hands back the very response it got", async () => {
    const response = new Response("{}", { headers: { "x-waitron-build": "a" } });
    const base = vi.fn(async () => response);
    const { fetch } = watched(base as unknown as typeof globalThis.fetch);
    const init = { method: "POST", body: "{}" };
    expect(await fetch("/api/session", init)).toBe(response);
    expect(base).toHaveBeenCalledWith("/api/session", init);
  });

  it("rejects with the same error when the request fails", async () => {
    const failure = new TypeError("Failed to fetch");
    const { fetch, onChange } = watched(
      vi.fn(async () => {
        throw failure;
      }) as unknown as typeof globalThis.fetch,
    );
    await expect(fetch("/api/node")).rejects.toBe(failure);
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @waitron/diagnostics exec vitest run src/build-watch.test.ts`
Expected: FAIL — `./build-watch.js` cannot be resolved.

- [ ] **Step 4: Write the watcher**

`packages/diagnostics/src/build-watch.ts`:

```ts
import { BUILD_HEADER } from "@waitron/shared";

export const BUILD_CHANGED_EVENT = "waitron-build-changed";

export interface BuildWatchOptions {
  /** The page's own origin. Another server's build says nothing about the code this page runs. */
  origin: string;
  onChange: (build: string) => void;
}

/**
 * The first build a response from `origin` names is the page's own; the first different one after
 * it calls `onChange`, once.
 */
export function watchBuild(
  baseFetch: typeof fetch,
  { origin, onChange }: BuildWatchOptions,
): typeof fetch {
  let own: string | undefined;
  let told = false;
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await baseFetch(input, init);
    if (told || !fromOrigin(input, origin)) return response;
    const build = response.headers.get(BUILD_HEADER);
    if (build === null || build === "") return response;
    if (own === undefined) own = build;
    else if (build !== own) {
      told = true;
      onChange(build);
    }
    return response;
  }) as typeof fetch;
}

function fromOrigin(input: RequestInfo | URL, origin: string): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
}
```

In `packages/diagnostics/src/index.ts` add:

```ts
export { BUILD_CHANGED_EVENT, watchBuild } from "./build-watch.js";
export type { BuildWatchOptions } from "./build-watch.js";
```

- [ ] **Step 5: Run them and watch them pass**

Run: `pnpm --filter @waitron/diagnostics exec vitest run src/build-watch.test.ts`
Expected: PASS, 8 tests. (The plan reviewer ran this step's code against Step 2's tests on
2026-10-11, in a scratch copy with the header name inlined because the dependency was not added:
8 passed, and `tsc --noEmit` was clean. Deleting `told ||` failed "tells once"; deleting
`|| build === ""` failed "ignores a response with no build header or an empty one"; dropping the
origin check failed the other-origin and unparseable-URL cases.)

- [ ] **Step 6: Coverage and checks**

Run: `pnpm --filter @waitron/diagnostics test:coverage` — read the per-file table: `build-watch.ts`
at 100% lines and branches is expected; the package must stay at or above `98/98/98/95`.
Run: `pnpm --filter @waitron/diagnostics typecheck && pnpm exec eslint packages/diagnostics && pnpm exec prettier --check packages/diagnostics`
Expected: each exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/diagnostics/package.json pnpm-lock.yaml packages/diagnostics/src/build-watch.ts \
  packages/diagnostics/src/build-watch.test.ts packages/diagnostics/src/index.ts
git commit -s -m "A fetch wrapper notices when the page's own server answers with a new build (A491)"
```

---

## Task 3: The `wt-banner` primitive

**Files:**
- Create: `packages/ui/src/components/wt-banner.ts`, `wt-banner.test.ts`, `wt-banner.a11y.test.ts` (same folder)
- Modify: `packages/ui/src/index.ts` (beside `export { WtNotice } …`), `packages/ui/demo/main.ts` (import beside `wt-notice.js`; an element beside the `wt-toast` examples)
- Modify: `docs/developers/design-system.md` — the Primitives table (add a row after `wt-demo-bar`) and the "Accessibility testing (axe)" verified list (add a clause after the `wt-notice` clause)

**Interfaces:**
- Produces: `<wt-banner message="…" action-label="…">` (`WtBanner`, properties `message: string`,
  `actionLabel: string`); event `wt-banner-action`, `detail: {}`, bubbles, composed. Host takes
  `role="status"` unless it was given a role. No action label → no button.

- [ ] **Step 1: Write the failing behaviour and token tests**

`packages/ui/src/components/wt-banner.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import type { WtBanner } from "./wt-banner.js";
import "./wt-banner.js";

afterEach(cleanup);

const button = (el: WtBanner) => el.shadowRoot!.querySelector("button");

test("shows its message and its action, and is announced politely", async () => {
  const el = (await mount(
    '<wt-banner message="Waitron was updated." action-label="Reload"></wt-banner>',
  )) as WtBanner;
  expect(el.getAttribute("role")).toBe("status");
  expect(el.shadowRoot!.querySelector(".message")!.textContent).toBe("Waitron was updated.");
  expect(button(el)!.textContent!.trim()).toBe("Reload");
});

test("keeps a role it was given", async () => {
  const el = (await mount('<wt-banner role="alert" message="x"></wt-banner>')) as WtBanner;
  expect(el.getAttribute("role")).toBe("alert");
});

test("draws no button without an action label", async () => {
  const el = (await mount('<wt-banner message="Waitron was updated."></wt-banner>')) as WtBanner;
  expect(button(el)).toBeNull();
});

test("pressing the action sends one wt-banner-action and stops the click", async () => {
  const el = (await mount(
    '<wt-banner message="Waitron was updated." action-label="Reload"></wt-banner>',
  )) as WtBanner;
  const seen: Event[] = [];
  const record = (event: Event) => seen.push(event);
  for (const type of ["click", "wt-banner-action"]) document.addEventListener(type, record);
  try {
    await userEvent.click(button(el)!);
  } finally {
    for (const type of ["click", "wt-banner-action"]) document.removeEventListener(type, record);
  }
  expect(seen.map((event) => event.type)).toEqual(["wt-banner-action"]);
  const action = seen[0] as CustomEvent;
  expect(action.bubbles).toBe(true);
  expect(action.composed).toBe(true);
  expect(action.detail).toEqual({});
});

test("the keyboard presses the action too", async () => {
  const el = (await mount(
    '<wt-banner message="Waitron was updated." action-label="Reload"></wt-banner>',
  )) as WtBanner;
  const pressed = vi.fn();
  el.addEventListener("wt-banner-action", pressed);
  button(el)!.focus();
  await userEvent.keyboard("{Enter}");
  expect(pressed).toHaveBeenCalledOnce();
});

test("paints the strip and its action from tokens", async () => {
  const el = (await mount(
    '<wt-banner message="Waitron was updated." action-label="Reload"></wt-banner>',
  )) as WtBanner;
  host.style.setProperty("--wt-color-surface-raised", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-border", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-primary", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-on-primary", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-tap-min", "51px");
  const strip = getComputedStyle(el);
  expect(strip.backgroundColor).toBe("rgb(1, 2, 3)");
  expect(strip.color).toBe("rgb(4, 5, 6)");
  expect(strip.borderBottomColor).toBe("rgb(7, 8, 9)");
  expect(strip.borderLeftColor).toBe("rgb(10, 11, 12)");
  const action = getComputedStyle(button(el)!);
  expect(action.backgroundColor).toBe("rgb(10, 11, 12)");
  expect(action.color).toBe("rgb(13, 14, 15)");
  expect(action.minHeight).toBe("51px");
});
```

(`borderLeftColor` is the inline-start edge in the shipped left-to-right locales.)

- [ ] **Step 2: Write the failing accessibility test**

`packages/ui/src/components/wt-banner.a11y.test.ts`:

```ts
import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtBanner } from "./wt-banner.js";
import "./wt-banner.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-banner a11y (%s theme)", (theme) => {
  test("message only", async () => {
    await mountThemed('<wt-banner message="Waitron was updated."></wt-banner>', theme);
    await expectNoA11yViolations(host);
  });

  test("message and action", async () => {
    await mountThemed(
      '<wt-banner message="Waitron se ha actualizado." action-label="Recargar"></wt-banner>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("action focused", async () => {
    const el = (await mountThemed(
      '<wt-banner message="Waitron was updated." action-label="Reload"></wt-banner>',
      theme,
    )) as WtBanner;
    el.shadowRoot!.querySelector("button")!.focus();
    await expectNoA11yViolations(host);
  });
});
```

- [ ] **Step 3: Run both and watch them fail**

Run (after `memory_pressure | grep free`):
`pnpm --filter @waitron/ui exec vitest run src/components/wt-banner.test.ts src/components/wt-banner.a11y.test.ts`
Expected: FAIL — `./wt-banner.js` cannot be resolved.

- [ ] **Step 4: Write the primitive**

`packages/ui/src/components/wt-banner.ts`:

```ts
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

/** A full-width strip with one message and, when given an action label, one action. */
@customElement("wt-banner")
export class WtBanner extends LitElement {
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border-block-end: 1px solid var(--wt-color-border);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-primary);
      }

      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
      }

      .message {
        flex: 1 1 auto;
        margin: 0;
      }

      button {
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: 0 var(--wt-space-3);
        border: 0;
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        cursor: pointer;
      }

      button:hover {
        background: var(--wt-color-primary-hover);
      }

      button:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
    `,
  ];

  @property() message = "";
  @property({ attribute: "action-label" }) actionLabel = "";

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute("role")) this.setAttribute("role", "status");
  }

  readonly #onAction = (event: Event): void => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-banner-action", { bubbles: true, composed: true, detail: {} }),
    );
  };

  override render(): TemplateResult {
    return html`<div class="bar">
      <p class="message">${this.message}</p>
      ${this.actionLabel === ""
        ? nothing
        : html`<button type="button" @click=${this.#onAction}>${this.actionLabel}</button>`}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-banner": WtBanner;
  }
}
```

In `packages/ui/src/index.ts` add `export { WtBanner } from "./components/wt-banner.js";` after the
`WtNotice` export. In `packages/ui/demo/main.ts` add `import "../src/components/wt-banner.js";` after
the `wt-notice.js` import, and after the two `<wt-toast …>` examples:

```html
    <wt-banner message="Waitron was updated." action-label="Reload"></wt-banner>
```

- [ ] **Step 5: Run them and watch them pass; then break the accessibility on purpose**

Run the Step 3 command. Expected: PASS (6 behaviour tests, 6 a11y tests).
Then, as an experiment and not a commit: remove `${this.actionLabel}` from inside the `<button>` in
`render()`, so the button has no text, re-run the a11y file, and confirm it FAILS on the two action
states with axe's `button-name` rule. Restore the label. Record the result in the commit message.

- [ ] **Step 6: Run the guards that discover primitives**

Run: `pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts src/tap-target-and-focus.test.ts src/core-compatibility.test.ts`
Expected: PASS; "the interactive set is exactly …" unchanged (wt-banner reflects no `disabled`).
Run: `pnpm exec vitest run scripts/style-token-names.test.ts` — PASS.

- [ ] **Step 7: Document the primitive**

In `docs/developers/design-system.md`, Primitives table, add this row after the `wt-demo-bar` row
(keep the table's three columns; `docs/` is not formatted by prettier):

```markdown
| `wt-banner`             | `message`, `action-label` (property `actionLabel`; empty draws no button). A full-width strip with one message and at most one action, drawn as a filled primary button at least `--wt-tap-min` tall. The host takes `role="status"` unless given a role, so its message is announced politely. It paints the raised surface, a bottom border and a primary-coloured inline-start edge; placement belongs to the consumer. Used for the update bar on the dashboard (under the brand banner) and the till (above its screens) | `wt-banner-action` — `detail: {}` (the action was pressed; the click itself is stopped) |
```

In the "Accessibility testing (axe)" verified list, after the `wt-notice` clause, add (with the
date the run happened):

```markdown
`wt-banner` with a message only, with an action, and with its action focused — verified
2026-10-1x by running `packages/ui/src/components/wt-banner.a11y.test.ts`, both themes;
```

- [ ] **Step 8: Checks and coverage**

Run: `pnpm --filter @waitron/ui typecheck && pnpm exec eslint packages/ui/src/components/wt-banner*.ts packages/ui/src/index.ts packages/ui/demo/main.ts && pnpm exec prettier --check packages/ui/src/components/wt-banner.ts packages/ui/src/components/wt-banner.test.ts packages/ui/src/components/wt-banner.a11y.test.ts packages/ui/src/index.ts packages/ui/demo/main.ts`
Expected: each exits 0. Coverage and mutation run in CI; locally run
`pnpm --filter @waitron/ui test:coverage` only if a CI coverage job fails later.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/components/wt-banner.ts packages/ui/src/components/wt-banner.test.ts \
  packages/ui/src/components/wt-banner.a11y.test.ts packages/ui/src/index.ts packages/ui/demo/main.ts \
  docs/developers/design-system.md
git commit -s -m "A shared full-width bar with one message and one action, wt-banner (A491)" \
  -m "<plain-English paragraph; the Step 5 experiment and what axe reported>"
```

---

## Task 4: The dashboard shows the update bar

**Files:**
- Modify: `apps/dashboard/src/i18n/strings.ts` (English after `"login.reload": "Reload",` ~line 845; Spanish after `"login.reload": "Recargar",` ~line 3479)
- Modify: `apps/dashboard/src/dashboard-app.ts` (imports; properties near `@property({ attribute: false }) liveUpdates` ~line 698; state near `sessionNoticeCode` ~line 771; `connectedCallback`/`disconnectedCallback` ~lines 860–885; `render()` ~line 1352)
- Modify: `apps/dashboard/src/main.ts`
- Test: `apps/dashboard/src/dashboard-app.test.ts` (a new `describe` after "dashboard-app: session signals", ~line 5803)

**Interfaces:**
- Consumes: `BUILD_CHANGED_EVENT`, `watchBuild` from `@waitron/diagnostics` (Task 2); `wt-banner`
  and `wt-banner-action` (Task 3).
- Produces: `DashboardApp.reload: () => void` (default `() => location.reload()`); string keys
  `update.message`, `update.reload`.

- [ ] **Step 1: Write the failing tests**

In `apps/dashboard/src/dashboard-app.test.ts`, add `import { BUILD_CHANGED_EVENT } from "@waitron/diagnostics";`
to the imports, and after the "dashboard-app: session signals" `describe` add:

```ts
describe("dashboard-app: build updates", () => {
  type Banner = HTMLElement & { message: string; actionLabel: string };
  const bar = (el: DashboardApp) =>
    el.shadowRoot!.querySelector<Banner>("wt-banner[data-test=update-bar]");
  const updated = () => window.dispatchEvent(new Event(BUILD_CHANGED_EVENT));
  const sessionInvalid = (code: string) =>
    window.dispatchEvent(new CustomEvent("waitron-session-invalid", { detail: { code } }));

  async function signedIn() {
    const reload = vi.fn();
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi(),
      request: stubRequest,
      reload,
    });
    await flush(el);
    expect(overview(el)).not.toBeNull();
    return { el, reload };
  }

  async function signedOut() {
    const reload = vi.fn();
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi({ getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }) }),
      request: stubRequest,
      reload,
    });
    await flush(el);
    expect(login(el)).not.toBeNull();
    return { el, reload };
  }

  it("shows no update bar while the server's build has not changed", async () => {
    const { el } = await signedIn();
    expect(bar(el)).toBeNull();
  });

  it("shows the update bar under the banner once the server reports another build", async () => {
    const { el } = await signedIn();
    updated();
    await flush(el);
    expect(bar(el)!.message).toBe("Waitron se ha actualizado.");
    expect(bar(el)!.actionLabel).toBe("Recargar");
    expect(bar(el)!.closest(".banner-row")).not.toBeNull();
    expect(
      bar(el)!.compareDocumentPosition(el.shadowRoot!.querySelector("[data-test=brand-banner]")!) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("words the bar in English for an English page", async () => {
    const { el } = await signedIn();
    setLocale("en-GB");
    updated();
    await flush(el);
    expect(bar(el)!.message).toBe("Waitron was updated.");
    expect(bar(el)!.actionLabel).toBe("Reload");
  });

  it("shows the bar on the sign-in page too", async () => {
    const { el } = await signedOut();
    updated();
    await flush(el);
    expect(bar(el)).not.toBeNull();
  });

  it.each(["before", "after"] as const)(
    "shows the reset notice and no update bar when the reset arrives %s the new build",
    async (order) => {
      const { el } = await signedIn();
      if (order === "before") sessionInvalid("node.reset");
      updated();
      if (order === "after") sessionInvalid("node.reset");
      await flush(el);
      expect(bar(el)).toBeNull();
      expect(login(el)!.shadowRoot!.querySelector("[data-test=reload]")).not.toBeNull();
    },
  );

  it("reloads the page when Reload is pressed", async () => {
    const { el, reload } = await signedIn();
    updated();
    await flush(el);
    expect(reload).not.toHaveBeenCalled();
    await userEvent.click(bar(el)!.shadowRoot!.querySelector("button")!);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("stops listening once taken off the page", async () => {
    const { el } = await signedIn();
    el.remove();
    updated();
    await el.updateComplete;
    expect((el as unknown as { updateAvailable: boolean }).updateAvailable).toBe(false);
  });
});
```

(`stubApi`, `stubRequest`, `flush`, `login`, `overview`, `mountWidget`, `setLocale` and `userEvent`
are already in scope in this file; the file's own `beforeEach`/`afterEach` reset the locale to
`es-ES` and clean up the widgets.)

- [ ] **Step 2: Run them and watch them fail**

Run (after `memory_pressure | grep free`):
`pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "build updates"`
Expected: FAIL — `bar(el)` is `null` where a bar is expected (the "no bar" and the two reset cases
pass already, which is right: nothing draws a bar yet). If the strings are missing, `typecheck`
would also fail; the run itself does not typecheck.

- [ ] **Step 3: Add the strings**

`apps/dashboard/src/i18n/strings.ts`, English, after `"login.reload": "Reload",`:

```ts
  "update.message": "Waitron was updated.",
  "update.reload": "Reload",
```

Spanish, after `"login.reload": "Recargar",`:

```ts
  "update.message": "Waitron se ha actualizado.",
  "update.reload": "Recargar",
```

- [ ] **Step 4: Draw the bar in the dashboard shell**

In `apps/dashboard/src/dashboard-app.ts`:

1. Imports: add `import "@waitron/ui/src/components/wt-banner.js";` beside the other
   `@waitron/ui/src/components/…` imports, and `import { BUILD_CHANGED_EVENT } from "@waitron/diagnostics";`.
2. After `@property({ attribute: false }) liveUpdates?: …;` add:

   ```ts
  @property({ attribute: false }) reload: () => void = () => location.reload();
   ```

3. After `@state() private sessionNoticeCode: string | null = null;` add:

   ```ts
  @state() private updateAvailable = false;
  readonly #onBuildChanged = (): void => {
    this.updateAvailable = true;
  };
   ```

4. In `connectedCallback`, after `window.addEventListener("waitron-session-active", …);` add
   `window.addEventListener(BUILD_CHANGED_EVENT, this.#onBuildChanged);`; in `disconnectedCallback`,
   after the matching `removeEventListener("waitron-session-active", …)`, add
   `window.removeEventListener(BUILD_CHANGED_EVENT, this.#onBuildChanged);`.
5. Add a method beside `#demoBar`:

   ```ts
  #updateBar(): TemplateResult | typeof nothing {
    // A reset box has its own notice, with its own Reload, on the sign-in page.
    if (!this.updateAvailable || this.sessionNoticeCode === "node.reset") return nothing;
    return html`<wt-banner
      data-test="update-bar"
      message=${t("update.message")}
      action-label=${t("update.reload")}
      @wt-banner-action=${() => this.reload()}
    ></wt-banner>`;
  }
   ```

6. In `render()`: on the login page change `${this.#demoBar(false)} ${this.#banner(false, false)}`
   to `${this.#demoBar(false)} ${this.#banner(false, false)} ${this.#updateBar()}`; signed in, inside
   `<div class="banner-row">` change `${this.#banner(true, true)}` to
   `${this.#banner(true, true)} ${this.#updateBar()}` (before the `<wt-toast class="alert-toast" …>`).

- [ ] **Step 5: Run them and watch them pass**

Run the Step 2 command. Expected: PASS, 8 tests.
Then run the neighbours that read the shell's top: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "session signals|banner|alert"`
and `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.a11y.test.ts` — PASS.

- [ ] **Step 6: Wire the watcher in `main.ts`**

`apps/dashboard/src/main.ts`: change the import to
`import { BUILD_CHANGED_EVENT, createInstrumentedFetch, installErrorCapture, watchBuild } from "@waitron/diagnostics";`
and the fetch line to:

```ts
const instrumentedFetch = createInstrumentedFetch(
  watchBuild(fetch, {
    origin: location.origin,
    onChange: () => window.dispatchEvent(new Event(BUILD_CHANGED_EVENT)),
  }),
  diag,
);
```

`main.ts` is outside coverage and no test loads it (`apps/dashboard/vitest.config.ts`); Task 6's
end-to-end probe is what checks this line.

- [ ] **Step 7: Checks**

Run: `pnpm --filter @waitron/dashboard typecheck && pnpm exec eslint apps/dashboard/src/dashboard-app.ts apps/dashboard/src/main.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/dashboard-app.test.ts && pnpm exec prettier --check apps/dashboard/src/dashboard-app.ts apps/dashboard/src/main.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/dashboard-app.test.ts`
Expected: each exits 0.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/i18n/strings.ts apps/dashboard/src/dashboard-app.ts \
  apps/dashboard/src/main.ts apps/dashboard/src/dashboard-app.test.ts
git commit -s -m "The dashboard offers to reload when the box has been updated (A491)"
```

---

## Task 5: The till reloads itself when idle, otherwise shows the bar

**Files:**
- Modify: `apps/till/src/i18n/strings.ts` (English after `"server.switched": …,` ~line 1194; Spanish after its `"server.switched": …,` ~line 2345)
- Modify: `apps/till/src/till-app.ts` (imports; `.app` styles ~line 1062; properties near `@property({ attribute: false }) router?` ~line 1180; `connectedCallback` ~line 1416, `disconnectedCallback` ~line 1429; a new method; `render()` ~line 9051)
- Modify: `apps/till/src/main.ts`
- Test: `apps/till/src/till-app-boot-and-counter.test.ts` (a new `describe` at the end of the file)

**Interfaces:**
- Consumes: `BUILD_CHANGED_EVENT`, `watchBuild` (Task 2); `wt-banner` (Task 3).
- Produces: `TillApp.reload: () => void` (default `() => location.reload()`); till string keys
  `update.message`, `update.reload`.

- [ ] **Step 1: Write the failing tests**

In `apps/till/src/till-app-boot-and-counter.test.ts` add
`import { BUILD_CHANGED_EVENT } from "@waitron/diagnostics";` to the imports and, at the end of the
file:

```ts
describe("till-app when the server reports another build", () => {
  type Banner = HTMLElement & { message: string; actionLabel: string };
  const updateBar = (el: TillApp) =>
    el.shadowRoot!.querySelector<Banner>("wt-banner[data-test=update-bar]");
  const updated = () => window.dispatchEvent(new Event(BUILD_CHANGED_EVENT));
  function unloadGuarded(): boolean {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it("reloads by itself on the lock screen with nobody signed in and nothing open", async () => {
    const reload = vi.fn();
    const { el } = await mountApp({}, { reload });
    await flush(el);
    expect(lock(el)).not.toBeNull();
    updated();
    await flush(el);
    expect(reload).toHaveBeenCalledOnce();
    expect(updateBar(el)).toBeNull();
  });

  it("shows the bar instead of reloading while someone is signed in", async () => {
    const reload = vi.fn();
    const { el } = await mountApp({}, { reload });
    await toCounter(el);
    updated();
    await flush(el);
    expect(reload).not.toHaveBeenCalled();
    expect(updateBar(el)!.message).toBe("Waitron se ha actualizado.");
    expect(updateBar(el)!.actionLabel).toBe("Recargar");
  });

  it("words the bar in English for an English till", async () => {
    const { el } = await mountApp({}, { reload: vi.fn() });
    await toCounter(el);
    setLocale("en-GB");
    updated();
    await flush(el);
    expect(updateBar(el)!.message).toBe("Waitron was updated.");
    expect(updateBar(el)!.actionLabel).toBe("Reload");
  });

  it("shows the bar while a sign-in is still loading", async () => {
    const reload = vi.fn();
    const { el } = await mountApp(
      { listDefaultZoneOffers: vi.fn(() => new Promise(() => {})) },
      { reload },
    );
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    updated();
    await flush(el);
    expect(reload).not.toHaveBeenCalled();
    expect(updateBar(el)).not.toBeNull();
  });

  it("shows the bar on the lock screen while a retrieved order is still in the basket", async () => {
    const reload = vi.fn();
    const { el } = await mountApp(
      {
        retrieveWorkingOrder: vi.fn().mockResolvedValue({
          id: "wo-1",
          orderNumber: 5,
          label: null,
          lines: [{ quantity: "1.000", product: cafe }],
        }),
      },
      { reload },
    );
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(c.store.lines).toHaveLength(1);
    emit(shell(el)!, "logout");
    await flush(el);
    expect(lock(el)).not.toBeNull();
    // A retrieved order is saved, so no draft guards the page: only its lines make the till busy.
    expect(unloadGuarded()).toBe(false);
    updated();
    await flush(el);
    expect(reload).not.toHaveBeenCalled();
    expect(updateBar(el)).not.toBeNull();
  });

  it("shows the bar on the lock screen while the basket holds an unsaved change but no line", async () => {
    const reload = vi.fn();
    const { el } = await mountApp({}, { reload });
    const c = await toCounter(el);
    c.store.label = "Mesa 4";
    await flush(el);
    emit(shell(el)!, "logout");
    await flush(el);
    expect(c.store.lines).toHaveLength(0);
    expect(unloadGuarded()).toBe(true);
    updated();
    await flush(el);
    expect(reload).not.toHaveBeenCalled();
    expect(updateBar(el)).not.toBeNull();
  });

  it("shows the bar while a payment still waits for the server after sign-out emptied the screen", async () => {
    const reload = vi.fn();
    const { el } = await mountApp({ recordSale: vi.fn(() => new Promise(() => {})) }, { reload });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(api.recordSale).toHaveBeenCalledOnce();
    emit(shell(el)!, "logout");
    await flush(el);
    c.store.clear();
    await flush(el);
    expect(lock(el)).not.toBeNull();
    expect(unloadGuarded()).toBe(false);
    updated();
    await flush(el);
    expect(reload).not.toHaveBeenCalled();
    expect(updateBar(el)).not.toBeNull();
  });

  it("reloads when Reload on the bar is pressed", async () => {
    const reload = vi.fn();
    const { el } = await mountApp({}, { reload });
    await toCounter(el);
    updated();
    await flush(el);
    await userEvent.click(updateBar(el)!.shadowRoot!.querySelector("button")!);
    expect(reload).toHaveBeenCalledOnce();
  });
});
```

(`mountApp`, `toCounter`, `flush`, `emit`, `lock`, `shell`, `api`, `cafe`, `setLocale`, `vi` and
`userEvent` are already in scope in this file; its `beforeEach` sets `es-ES`. A test that changes
the locale must restore it — the file's `beforeEach` sets it before every case, which is that
restore; check it still does before relying on it.)

Each busy case is chosen so one term of `#busyForReload()` holds it alone where that was possible:
signed in (`operatorName`), a sign-in loading (`#loginPending`), a saved order's lines (`#store.lines`,
with no draft guarding the page), a label typed into an empty basket (`isDirty()`, with no line),
and a payment waiting with the basket cleared (`submitting`, with no line and no draft).
`#partylessDraft.lines`, `#cardAttemptsRunning`, `#unansweredPayment` and `#unansweredRefund` have
no isolating case; they are held by reading only, and the review should know it.

The plan reviewer ran the SETUP half of each busy case on 2026-10-11 (a scratch copy of this file's
helpers, real Chromium, no build event, nothing committed): idle lock screen, `operatorName ""`,
no unload guard; a sign-in left loading, still on the lock screen with `operatorName ""`; a
retrieved order, 1 line before and after logout, lock screen, no unload guard; a typed label, 0
lines, unload guarded before and after logout; a waiting cash payment, `recordSale` called once,
lock screen after logout and `clear()`, 0 lines, no unload guard, `submitting` still `true`. So
each case reaches the state it claims before the build event is sent.

- [ ] **Step 2: Run them and watch them fail**

Run (after `memory_pressure | grep free`):
`pnpm --filter @waitron/till exec vitest run src/till-app-boot-and-counter.test.ts -t "reports another build"`
Expected: FAIL — `reload` is never called in the first case and `updateBar(el)` is `null` in the
rest. If a setup assertion fails instead (for example `c.store.lines` not 1 after the retrieve, or
`unloadGuarded()` not what the case expects), stop: the case is not testing what it claims, and the
fixture must be fixed before any implementation.

- [ ] **Step 3: Add the strings**

`apps/till/src/i18n/strings.ts`, English after `"server.switched": "Moved to another server. Enter your PIN.",`:

```ts
  "update.message": "Waitron was updated.",
  "update.reload": "Reload",
```

Spanish after `"server.switched": "Cambiado a otro servidor. Introduce tu PIN.",`:

```ts
  "update.message": "Waitron se ha actualizado.",
  "update.reload": "Recargar",
```

- [ ] **Step 4: Decide, and draw the bar, in the till**

In `apps/till/src/till-app.ts`:

1. Imports: add `import "@waitron/ui/src/components/wt-banner.js";` beside
   `import "@waitron/ui/src/components/wt-toast.js";`, and
   `import { BUILD_CHANGED_EVENT } from "@waitron/diagnostics";`.
2. In the styles, after the `.app { … }` rule:

   ```css
      .app > wt-banner {
        flex: none;
      }
   ```

3. After `@property({ attribute: false }) router?: ServerRouter;`:

   ```ts
  @property({ attribute: false }) reload: () => void = () => location.reload();
  @state() private updateAvailable = false;

  readonly #onBuildChanged = (): void => {
    if (this.#busyForReload()) this.updateAvailable = true;
    else this.reload();
  };

  /** A reload signs the operator out and drops whatever is only in this page's memory. */
  #busyForReload(): boolean {
    return (
      this.operatorName !== "" ||
      this.#loginPending ||
      this.#store.lines.length > 0 ||
      this.#partylessDraft.lines.length > 0 ||
      this.leave.coordinator.isDirty() ||
      this.submitting ||
      this.#cardAttemptsRunning > 0 ||
      this.#unansweredPayment !== null ||
      this.#unansweredRefund !== null
    );
  }
   ```

   (If TypeScript complains that a private field is used before its declaration, move the method
   below the last field it reads, `#unansweredRefund`; behaviour does not change.)
4. `connectedCallback`: after `document.addEventListener("visibilitychange", this.#onVisibility);`
   add `window.addEventListener(BUILD_CHANGED_EVENT, this.#onBuildChanged);`.
   `disconnectedCallback`: after `document.removeEventListener("visibilitychange", this.#onVisibility);`
   add `window.removeEventListener(BUILD_CHANGED_EVENT, this.#onBuildChanged);`.
5. `render()`: first thing inside `<div class="app" …>`, before the `this.onboardingIntent`
   mode-indicator block:

   ```ts
        ${
          this.updateAvailable
            ? html`<wt-banner
                data-test="update-bar"
                message=${t("update.message")}
                action-label=${t("update.reload")}
                @wt-banner-action=${() => this.reload()}
              ></wt-banner>`
            : nothing
        }
   ```

- [ ] **Step 5: Run them and watch them pass; then delete one term at a time**

Run the Step 2 command. Expected: PASS, 8 tests.
Then, as an experiment and not a commit, delete each of these terms in turn, re-run, and record
which case fails: `this.operatorName !== ""`, `this.#loginPending`, `this.#store.lines.length > 0`,
`this.leave.coordinator.isDirty()`, `this.submitting`. Each deletion should fail exactly the case
named for it in Step 1. Any deletion that leaves every case green means that case is not isolating
what it claims: say so in the commit message rather than in a comment. Restore every term.

- [ ] **Step 6: Run the neighbours**

Run: `pnpm --filter @waitron/till exec vitest run src/till-app-boot-and-counter.test.ts src/till-app.unsaved-changes.test.ts src/till-app.a11y.test.ts src/screens/device-screens.phone-margin.test.ts`
Expected: PASS (the bar is absent in all of them, so layout and a11y cases are unchanged).

- [ ] **Step 7: Wire the watcher in `main.ts`**

`apps/till/src/main.ts`: import `BUILD_CHANGED_EVENT` and `watchBuild` beside
`createInstrumentedFetch`, and in `bootTill()` replace the router and fetch construction with:

```ts
  const watchedFetch = watchBuild(fetch, {
    origin: location.origin,
    onChange: () => window.dispatchEvent(new Event(BUILD_CHANGED_EVENT)),
  });
  const router = new ServerRouter({ origin: location.origin, fetchImpl: watchedFetch });
  const fetchImpl = createInstrumentedFetch(
    withDevDeviceHeader(withServerTarget(watchedFetch, router)),
    diag,
  );
```

One watcher feeds both, so the router's own-origin probe and every API call share one recorded
build. `main.ts` is outside coverage (`apps/till/vitest.config.ts`); Task 6's probe checks it.

- [ ] **Step 8: Checks**

Run: `pnpm --filter @waitron/till typecheck && pnpm exec eslint apps/till/src/till-app.ts apps/till/src/main.ts apps/till/src/i18n/strings.ts apps/till/src/till-app-boot-and-counter.test.ts && pnpm exec prettier --check apps/till/src/till-app.ts apps/till/src/main.ts apps/till/src/i18n/strings.ts apps/till/src/till-app-boot-and-counter.test.ts`
Expected: each exits 0.

- [ ] **Step 9: Commit**

```bash
git add apps/till/src/i18n/strings.ts apps/till/src/till-app.ts apps/till/src/main.ts \
  apps/till/src/till-app-boot-and-counter.test.ts
git commit -s -m "The till reloads itself after a box update when nothing would be lost, otherwise offers to (A491)" \
  -m "<plain-English paragraph; the Step 5 deletions and which case each one failed>"
```

---

## Task 6: Look at it, and prove the wiring end to end

Split from the docs (Task 7) so neither runs long: this task starts a dev stack, debugs a Playwright
script and reads 16 screenshots. It commits nothing. Its outcomes go in the work's ledger,
`docs/handoffs/2026-10-11-a491-reload-after-update.md` (gitignored), one line per Step 3
experiment, for Task 7 to put in its commit message and docs.

**Files:**
- Scratch only, outside the worktree: `$(mktemp -d)/look.mjs` and its screenshots
- Modify (not committed): the ledger above

**Interfaces:**
- Consumes: everything from Tasks 1–5, running in the dev stack.
- Produces: one ledger line per Step 3 experiment, each saying what it printed.

- [ ] **Step 1: Start this worktree's dev stack**

Check what is running first: `wa-wt ls`, `lsof -nP -iTCP:8080 -sTCP:LISTEN`. Start it with
`wa-wt demo waitron-feat-service-reload-after-update` (never `wa-wt reset`; never a bare `pnpm dev`).
Read the till and dashboard ports from `wa-wt ls`. Dashboard sign-in: `owner@demo.waitron.local` /
`dashPass123`; till PIN `5555`.

- [ ] **Step 2: Write the probe**

`look.mjs` in a fresh `mktemp -d` directory. It loads Playwright from the dashboard package so it
uses the workspace's Chromium. Its shape (adapt selectors to what the screens draw; Playwright CSS
locators reach into open shadow roots):

```js
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "package.json"));
const { chromium } = require("playwright");
const [dashboardUrl, tillUrl, outDir] = process.argv.slice(2);
const browser = await chromium.launch();

/** Serves every response as the server sent it, except that while `faking` is set a response that
 * names a build names "a491-probe" instead — what the page would see after a box update. */
async function openWatched(url, { width, scheme, locale }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale, colorScheme: scheme });
  const page = await context.newPage();
  const state = { faking: false, realBuild: null };
  await page.route("**/*", async (route) => {
    // The dashboard's live stream never ends; route.fetch() on it starves the stream.
    if (route.request().resourceType() === "eventsource") return route.continue();
    const response = await route.fetch();
    const headers = response.headers();
    if (headers["x-waitron-build"] !== undefined) {
      state.realBuild ??= headers["x-waitron-build"];
      if (state.faking) headers["x-waitron-build"] = "a491-probe";
    }
    await route.fulfill({ response, headers });
  });
  await page.goto(url);
  return { context, page, state };
}
// … sign in, set state.faking = true, cause an automatic read, wait for the bar, screenshot,
// press Reload, wait for the navigation, confirm no bar — per Step 3.
await browser.close();
```

Run it from `apps/dashboard`: `cd <worktree>/apps/dashboard && node <scratch>/look.mjs <dashboard-url> <till-url> <scratch>`.

Two receipts behind this shape, from the plan reviewer on 2026-10-11:
- The `eventsource` line: in real Playwright Chromium (the dashboard package's `playwright`), a page
  whose `EventSource` reads a stream that never ends got no message within 3 s when every request
  went through `route.fetch()`, and closing the page then threw `route.fetch: Request context
  disposed`; with `eventsource` requests passed to `route.continue()` the message arrived.
- The dev proxy keeps the header: a Node script starting Vite 8.3.1 (`createServer`, proxy
  `/api` → a local server answering `x-waitron-build: 1c57940`) read `1c57940` through the proxy, and
  `null` on Vite's own `index.html` (the control). The dev stack's till and dashboard call their
  API through these same-origin proxies, so the page's own origin is the Vite port, and the
  watcher's own-origin check holds there.

- [ ] **Step 3: Run these experiments, and say beforehand what failing looks like**

1. **The header reaches the browser through the dev servers.** Print `state.realBuild` after the
   first load. Failing looks like `null` — then nothing below can work, and the bar not showing would
   be expected, not a pass.
2. **Dashboard, signed in, an automatic read after the "update".** Sign in, set `faking = true`,
   then make the tab come back into view (`page.evaluate` defining `document.visibilityState` as
   `"visible"` and dispatching `visibilitychange`, which `#onVisibilityChange` answers with a
   session read). Expect the bar within a few seconds. Failing looks like no bar. Control: before
   setting `faking`, the same trigger shows no bar.
3. **Dashboard Reload loads the new build.** Press the bar's Reload; wait for the page's `load`
   event; with `faking` still set (the box "is" now on `a491-probe`), trigger step 2's read again and
   expect NO bar — the reloaded page took `a491-probe` as its own build.
4. **Till idle on the lock screen reloads itself.** Open the till (in dev mode a fresh tab first
   shows the device picker: choose a till; the choice is kept in `sessionStorage`, which a reload
   keeps), wait for the lock screen, set
   `faking = true`; expect a page navigation within about 10 s (the router probes every 5 s) and no
   bar afterwards. Failing looks like no navigation.
5. **Till signed in shows the bar and does not reload.** Sign in with `5555`, set `faking = true`;
   expect the bar within about 10 s and NO navigation for 15 s after it. Press Reload; expect a
   navigation and the lock screen. This is also the receipt for Decision 5's "a reload signs the
   operator out", which until now rests on reading: failing looks like the reloaded till coming
   back signed in (the counter or the shell, not `till-lock-screen`). If it does, stop and report:
   the "signed in counts as busy" term then has no reason, and `#busyForReload` and its first test
   must change before this branch finishes.
6. **LOOK.** Screenshot the dashboard bar (signed in) and the till bar (signed in) in English and
   Spanish (switch with each app's language chooser), light and dark, at 390 and 1280 wide: 16
   images. Open every one with the Read tool. Check: the dashboard bar sits directly under the brand
   banner and above the page; the till bar sits above the till's screens without pushing the shell
   off-screen; the button wraps under the message at 390 rather than overflowing; text contrast is
   readable in dark.

Write each experiment's outcome in one line in the ledger (with the date and what it printed). Then
stop the stack: `wa-wt down <slug>`, and kill any process this task started by the pid you
recorded. Delete the scratch directory. No commit.

---

## Task 7: Write the docs, and draft the FYI

**Files:**
- Modify: `docs/developers/design-system.md` ("Dashboard banner" section, ~line 2593; and the till's
  "Counter basket and payment space" section, ~line 3761, or the nearest till section)
- Modify: `docs/developers/conventions-ui.md` (a new section after "The dashboard banner is persistent identity chrome", ~line 374)
- Modify: `docs/backlog/dashboard.md` ("Decisions and deliberate limits", ~line 891)

**Interfaces:**
- Consumes: Task 6's ledger lines, one per experiment.

- [ ] **Step 1: Write the docs**

1. `docs/developers/design-system.md`, "Dashboard banner": add a paragraph:
   "When the server reports a different build from the one the page first saw, an update bar
   (`wt-banner`, "Waitron was updated." / "Waitron se ha actualizado." with Reload / Recargar)
   appears directly under the banner, signed in and signed out, and stays until Reload. It never
   shows beside the box-reset notice, which has its own Reload." In the till's section, one sentence:
   "After a box update a till with nobody signed in and nothing open reloads by itself; otherwise
   the same bar shows above its screens."
2. `docs/developers/conventions-ui.md`, a new section after "The dashboard banner is persistent
   identity chrome":

   ```markdown
   ## An open page notices a box update from one response header

   Every server response after `/health` carries `x-waitron-build` (`BUILD_HEADER`,
   `@waitron/shared`; set by `buildHeaderMiddleware`, `apps/server/src/build-header.ts`, after the
   handler runs). Each app's fetch passes through `watchBuild` (`@waitron/diagnostics`): the first
   build a response from the page's own origin names is the page's; the first different one sends
   `BUILD_CHANGED_EVENT` once. Another origin's build is ignored, because a till's router can point
   at another server whose build says nothing about this page — comparing it would reload an idle
   till in a loop. No request is added for it: the dashboard's automatic re-reads and the till
   router's 5 s probe carry the header. The till reloads by itself only when `#busyForReload()`
   (`apps/till/src/till-app.ts`) is false — nobody signed in, nothing in the basket, no unsaved
   draft, no payment waiting. Guards: `build-watch.test.ts`, `build-header.test.ts`, the "build
   updates" cases in `dashboard-app.test.ts` and the "reports another build" cases in
   `till-app-boot-and-counter.test.ts`; `main.ts` wiring in both apps is checked by no test.
   ```

   (Adjust the last sentence to what Task 6 Step 3 actually showed, read from the ledger: name the
   probe and its date if it passed.)
3. `docs/backlog/dashboard.md`, "Decisions and deliberate limits", add:

   ```markdown
   - **An open tab offers to reload after a box update (A491, owner 2026-10-11).** Limits kept on
     purpose: a signed-out dashboard tab that makes no automatic read sees the update only on its
     next request; a page that first hears from the box after the update takes the new build as its
     own and never shows the bar; a till with nobody signed in reloads even while someone is typing a
     PIN (typed digits are not a draft); a signed-in till with nothing open shows the bar rather
     than signing its operator out; once the till shows the bar it does not reload later by itself;
     an idle till that once had a bill payment or refund refused shows the bar rather than
     reloading, because it keeps that send's id for a resend. Every response after `/health` names
     the box's build to whoever can reach it, signed in or not. The failed-start recovery page
     sends no build header.
   ```

4. Confirm the backlog has nothing to delete: `grep -rn "A491" docs/backlog.md docs/backlog/` lists
   only the new limits entry.

- [ ] **Step 2: Commit and draft the FYI**

```bash
git add docs/developers/design-system.md docs/developers/conventions-ui.md docs/backlog/dashboard.md
git commit -s -m "Docs: the update bar, the build header and what a till counts as busy (A491)" \
  -m "<one line per Task 6 Step 3 experiment and what it showed, from the ledger>"
```

Draft, for the PR description and the owner's one-line FYI when it lands: "A491 landed: after a box
update an open dashboard shows 'Waitron was updated. [Reload]', and a till reloads by itself when
nobody is signed in and nothing is open, otherwise shows the same bar." Put these FYI defaults in
the PR description as questions the owner may answer: a half-typed PIN is lost to an automatic
reload; the bar does not turn into a reload later; a signed-in till with nothing open shows the bar
instead of reloading (Decision 5); the build is named to unauthenticated callers (Decision 1).

Then announce the branch ready for `/finish-branch` (FULL path).

---

## Self-review (done while writing)

- **Spec coverage:** server build identity (Task 1, with the reason for the header in Decision 1);
  the page records its build (Task 2); dashboard bar with exact wording (Task 4); till reload-or-bar
  (Task 5); passive reads (no new request, Decisions 1–2); reset stays A485's path (Task 4 tests);
  tests first in Chromium (Tasks 3–5) and Node (Tasks 1–2); a changed build shows the bar, the same
  build never does (Task 2 "stays quiet while it repeats"; Task 4 "no update bar"); the till's busy
  case shows the bar (Task 5); Reload loads the new build (Task 4/5 call `reload`; Task 6 Step 3.3
  shows a reloaded page takes the new build as its own); `wt-*` primitive with token and axe tests
  (Task 3); LOOK EN/ES × themes × 390/1280 (Task 6); path by risk FULL (header); docs and FYI (Task 7).
- **Placeholders:** the only `<…>` left are commit-message bodies that depend on what an experiment
  prints, and the date in the a11y-verified line.
- **Names used across tasks:** `BUILD_HEADER`, `buildHeaderMiddleware`, `watchBuild`,
  `BuildWatchOptions { origin, onChange }`, `BUILD_CHANGED_EVENT`, `wt-banner` / `WtBanner` /
  `message` / `action-label` / `actionLabel` / `wt-banner-action`, `reload`, `updateAvailable`,
  `#busyForReload`, `update.message` / `update.reload`, `data-test="update-bar"` — checked to match.

# Logging & Diagnostics Foundation — design

- **Date:** 2026-08-31
- **Status:** Draft for review
- **Scope:** Slice 1 of 3 of the *Logging & one-touch bug-report* subsystem.

---

## 1. Why

When something goes wrong on a Waitron box, there is today no way for a
non-technical user to report it with the technical detail a developer needs, and
no durable technical record to attach even if they could. Concretely:

- The server has one tiny logger (`apps/server/src/logger.ts`) that writes a JSON
  line per event to **stdout and nowhere else** — a restart loses everything, and
  the moment you most want the logs is right after a crash/restart.
- There are **no request/correlation ids** anywhere, so a client-side symptom
  cannot be tied to the server-side lines that explain it.
- The browser apps (`apps/till`, `apps/dashboard`, `apps/setup`, all Lit 3) have
  **no logging and no crash capture at all** — an unhandled error vanishes.
- Nothing resembling bug-reporting, diagnostics, or telemetry exists. This is
  greenfield.

This is a fiscal POS with card payments, so the hard constraint running through
the whole design is: **capture enough to debug, leak nothing.** Fiscal records,
card tokens, credentials and customer PII must never enter a log line or a
report — and the safe way to guarantee that is to never *read* them, not to scrub
them afterwards.

## 2. The whole subsystem, in brief

The full feature is a **staff → manager → vendor** pipeline: a non-technical user
taps *Report a problem*, a manager triages it on the dashboard, and a
GitHub-ready bundle is forwarded to the vendor. It splits into three slices, each
its own spec → plan → implementation cycle:

- **Slice 1 — Logging foundation (this spec).** The durable, correlated,
  runtime-tunable logging substrate a report will read from, on both server and
  client, plus the diagnostic-mode mechanism and a live log viewer. No report
  button, no storage table yet.
- **Slice 2 — One-touch bug report.** The `bug_reports` table, the capture
  endpoint that freezes a self-contained bundle, the `wt-report-dialog` + trigger
  in the till and dashboard, and the copy-pastable GitHub-ready markdown
  serialiser.
- **Slice 3 — Triage & forwarding.** The dashboard *Problem reports* screen
  (list, view, copy, status transitions) and automated GitHub-issue creation.

Delivery decision (recorded): the eventual vendor destination is **GitHub
issues**; for now the bundle only needs to be **copy-pastable**, which removes any
dependency on the still-deferred cloud-sync work.

**In scope for this spec (Slice 1):** everything in §4–§10 below. **Out of scope:**
the report button, the `bug_reports` table, the report bundle, triage, and GitHub
forwarding (Slices 2–3).

## 3. Requirements

### Functional

1. Every HTTP request to the server carries a **request-id**, correlatable with
   the browser activity that caused it.
2. Server logs are **durable across restarts** — written to a rotating file on the
   box, readable as "recent tail" and "lines matching these request-ids".
3. The server logger supports a **`debug` level** and **level filtering** (today it
   emits every event unconditionally). Default threshold is `info`.
4. A **diagnostic mode**: an authenticated manager can raise verbosity to `debug`
   for a bounded window (auto-reverting), and watch logs **live** from a dashboard
   screen.
5. The browser apps gain a **bounded in-memory activity trail** and **global crash
   capture** (`window.onerror` / `unhandledrejection`).
6. The client trail records **codes and request-ids, never request/response
   bodies**.

### Invariants (from the house rules)

- **Nothing may block a sale.** Logging is best-effort; a sink or disk failure
  degrades to stdout and never throws into a request path, and client
  instrumentation never breaks the app.
- **Redaction by construction.** Logs carry only: level, event name, request-id,
  HTTP method, matched **route pattern** (not the concrete path), status,
  duration, and caller-chosen enums/codes. Request/response bodies, query strings,
  concrete path segments (which can be UUIDs/PII), fiscal rows, secrets and card
  data are never read into a log line. Enforced by an allowlist guard on the
  client and a no-body/no-query test on the server, both proven by deletion.
- **Spanish domain vocabulary** does not apply here — this is infrastructure, not
  fiscal schema; identifiers are English (the `english-only` guard covers the new
  package).

## 4. Architecture overview

```
 Browser app (Lit)                         Server (Hono)                 Disk
 ─────────────────                         ─────────────                 ────
 @waitron/diagnostics                      request-id middleware
   ├ ring buffer (trail)   x-request-id →    ├ reuse/generate + sanitise
   ├ error boundary        ← x-request-id    ├ stash in context
   ├ api-client hook                         ├ echo header
   └ verbosity toggle                        └ log request start/end ──┐
        ▲                                                              │
        │ (Slice 2 reads snapshot)          logger                     │
                                              ├ level filter (debug…)   │
 dashboard live-viewer  ── SSE ──────────────┤ tee sink ───────────────┼─→ waitron.log
   screen (Lit)         verbosity POST        └ pub/sub → SSE           │   (rotating)
                                              reader ← tail / by-id ────┘
```

Four components, described in §5–§8. Nothing here writes to the database.

## 5. Server: request correlation

A Hono middleware, mounted **early** — before the mirror read-only gate so it
covers every route, including `/health` — that on each request:

- reads an inbound `x-request-id` header if present (so a client can supply its
  own and the two trails share one key), otherwise generates one with
  `crypto.randomUUID()`;
- **sanitises** the id regardless of origin: cap length (e.g. 64 chars) and strip
  to `[A-Za-z0-9._-]`, so a hostile client cannot forge log lines by injecting
  newlines or control characters (log-injection defence);
- stashes it in the Hono context (`c.set("requestId", id)`, via a `hono`
  `ContextVariableMap` augmentation) so any handler and the error boundary can read
  it with `c.get("requestId")`. There is **no per-handler child logger** in this
  slice — the existing DI'd `log` is untouched and remains the logger for the duty
  loop and boot; the middleware line plus the error-boundary enrichment (§6d) carry
  the request-id, which is enough to stitch the trail, so this is additive, not a
  cross-tree refactor;
- echoes it back as an `x-request-id` **response header**;
- logs one request line on completion **at `debug`**:
  `{ event: "http.request", requestId, method, routePath, status, durationMs }`.
  It logs **`c.req.routePath`** (Hono's matched pattern, e.g. `/api/sales/:id`) —
  never the concrete path, so no dynamic segment is ever recorded. No query
  string, no body. Logging it at `debug` keeps normal operation quiet (the default
  threshold drops it) and surfaces the full request trace only under diagnostic
  mode; **errors stay correlated regardless**, because the error boundary (§6d)
  adds the request-id to every `warn`/`error` line it writes.

**Correlation model:** the browser generates a request-id per call and sends it;
the server reuses it. So the client can log both `api:start` and `api:end` under
the same id it chose, and the server line shares it — the trail is
self-correlated without the client waiting for a response to learn the id.

## 6. Server: durable + tunable logging

Three additions to `apps/server/src/logger.ts`, all backward-compatible with the
injected-sink design.

### 6a. Level filtering

- Add `debug` to `LogLevel` (`debug < info < warn < error`).
- `createLogger` gains a threshold source: `createLogger(sink, now, getThreshold)`
  where `getThreshold(): LogLevel` is read **at each call** so verbosity can change
  at runtime. Events below the threshold are dropped before the sink is touched.
- Default `getThreshold` returns `"info"`, so today's `info`/`warn`/`error` calls
  are unaffected and `debug` is dropped until diagnostic mode raises it.

### 6b. Rotating-file sink + reader

- A `RotatingFileSink` (pure Node, no heavy dependency) that appends each JSON
  line to `<dataDir>/logs/waitron.log`, rotating on a size cap and keeping a
  bounded number of rotated files (e.g. 10 MB × 5), auto-pruning the oldest. The
  box process is the single sequential writer, so rotation is simple and needs no
  cross-process locking.
- The production sink is `tee(stdoutSink, rotatingFileSink)` — **stdout behaviour
  is unchanged** (container logs still work); the file is additive.
- **Failure is swallowed:** an IO error (disk full, permissions) degrades to
  stdout-only and is surfaced once as a `warn`, never thrown. Tested.
- A `LogReader` over the same directory exposes:
  - `recent({ limit | sinceMs })` → the last N parsed events across current +
    rotated files;
  - `byRequestIds(ids)` → parsed events whose `requestId` ∈ `ids`.
  This is the interface Slice 2's capture endpoint consumes; it is built and
  tested here.

### 6c. Diagnostic mode (verbosity control + live stream)

- A `VerbosityController` holding the current threshold and an optional
  auto-revert timer. `raise("debug", ttlMs)` lowers the threshold and schedules a
  revert to the default after `ttlMs`; `current()` feeds `getThreshold`. State is
  **in-memory** — a restart reverts to the safe default, which is correct (we
  never want debug stuck on).
- **Live viewing is by polling, not streaming.** The codebase has no SSE or
  streaming anywhere, and the dashboard already live-updates other tiles by polling
  on an interval. The viewer polls the `LogReader` and replaces its buffer each
  tick — no pub/sub, no subscriber backpressure, no new streaming pattern, and it
  reuses the reader built in §6b.
- Three endpoints under `/management-api/diagnostics`, all behind the **existing
  authenticated manager session/permission gate** (the `diagnostics.view`
  permission, added to the `manager` + `admin` roles):
  - `POST …/verbosity` `{ level, ttlMinutes }` → calls the controller; validates
    input, throwing `diagnostics.invalid_verbosity` on a bad level/ttl.
  - `GET …/verbosity` → the current level and its auto-revert time, so the viewer
    can show the countdown.
  - `GET …/recent?limit=200` → the last N parsed log lines, for the viewer to poll
    and re-render.

### 6d. Error-boundary enrichment

`createErrorBoundary` (`apps/server/src/error-boundary.ts`) reads
`c.get("requestId")` and includes it on the `warn` (AppError) and `error`
(unexpected) log lines it already writes, so a failed request is always
correlatable with the client trail even at the default threshold. The request-id
is a log field, never an error param, so the "no raw values in params" discipline
is untouched.

## 7. Client: the `@waitron/diagnostics` package

A **new browser-safe leaf package** (`packages/diagnostics`), **zero dependencies**
(it throws no `AppError`, so it needs no `@waitron/shared` and no `errors.ts` — see
§12), consumable by all three Lit apps. Exports plain TypeScript (no Lit
dependency — the report dialog and viewer are app/`ui` code, not here).

Contents:

- **Ring buffer** — a bounded trail (default ~200 events) of
  `{ at, level, event, requestId?, code?, fields? }`, evicting oldest first. Cheap
  and in-memory, scoped to the app session. `snapshot()` returns a copy (Slice 2
  sends it; the method lives here now).
- **Redaction guard** — the *only* way to push an event. It validates `fields`
  against an **allowlist of key names and primitive value types**; anything
  nested, or any non-allowlisted key, is dropped (and throws in test mode so the
  guard is provable). This is what makes "never a body" a property of the code,
  not of the caller. Proven by deletion: remove the allowlist check, feed a body,
  assert it leaks.
- **Error boundary** — an installer that takes a `Window`-like target (injected, so
  the package tests under Node without a DOM) and attaches `error` /
  `unhandledrejection` listeners, recording an `error` event with the error
  **name** and **stack** (our own client stacks, non-sensitive). When the thrown
  value carries a string `code` (the shape the app clients already throw,
  `{ code }` — a plain object, **not** an `AppError` instance), it records that
  code by **duck-typing**, never the thrown value verbatim.
- **Instrumented `fetch`** — `createInstrumentedFetch(baseFetch, log, …)` returns a
  drop-in `fetch` the apps pass into their existing api-client constructor
  (`#fetchImpl` is already injectable, so the `#request` choke point is **not**
  edited). It generates a request-id, sets the `x-request-id` request header, masks
  dynamic path segments (`maskPath`), logs `{ event: "api", phase:
  "start"|"end", method, path, status?, code?, error?, requestId }` — logging
  `api:end` under the **same request-id it minted** for the call (correlation
  holds because the server reuses that id; it does not read `res.headers`) — and
  captures the domain `code` on failure via `res.clone()` (so the real
  `#request` still reads the body). **Codes and ids only, never bodies.**
- **Navigation hook** — apps log a `nav` event on screen change (screen key only).

There is **no client-side verbosity toggle** in this slice — nothing on the client
emits `debug` yet, so it would be dead config (deferred). Every hook is
`try`/`catch` best-effort: diagnostics never breaks the app.

## 8. Dashboard: live log viewer (folded into Slice 1)

A minimal Lit screen in `apps/dashboard` — a new nav entry shown only to a
`manager`/`admin` session (the roles holding `diagnostics.view`; the endpoints
enforce the permission server-side regardless, so the nav gate is UX only) — that:

- **polls** `GET …/recent` on an interval and re-renders the last N lines newest
  first with level colouring and a pause/clear control (same polling pattern the
  overview screen already uses);
- offers a **diagnostic-mode** control: raise verbosity to `debug` for a chosen
  window (calls `POST …/verbosity`), showing the countdown to auto-revert read from
  `GET …/verbosity`.

Kept deliberately small; the richer *Problem reports* triage screen is Slice 3.

## 9. Data flow

1. Browser calls the api client. The diagnostics hook generates `reqId`, logs
   `api:start`, sets `x-request-id: reqId`.
2. Server middleware sanitises/reuses `reqId`, stashes it, echoes the header, and
   (on completion) logs `http.request` with `reqId` + `routePath` + status +
   duration.
3. The logger filters by threshold and tees the line to stdout + the rotating
   file. (The `http.request` line is `debug`, so it lands only under diagnostic
   mode; an error line from the boundary is `warn`/`error` and always lands.)
4. Response returns; the instrumented fetch logs `api:end` under the same `reqId`
   it minted for the request (not read back from the echoed header), with status
   + `code?`.
5. The client trail and the server file now share `reqId`. (Slice 2 will read the
   client `snapshot()` + `LogReader.byRequestIds()` to freeze a bundle.)

No database writes occur in this slice. Diagnostic-mode state is in-memory and
reverts safely on restart.

## 10. Failure modes & security

- **Sink/disk failure** → stdout-only, one `warn`, never thrown. Request path
  unaffected (sale-safety invariant).
- **Client instrumentation failure** → swallowed; app unaffected.
- **Log injection** → inbound request-id sanitised (charset + length); events are
  structured JSON with escaped strings, never string-concatenated log lines.
- **Endpoint exposure** → verbosity + recent behind the authenticated manager gate
  (`diagnostics.view`); not loopback-only, but not public.
- **Polling cost** → `GET …/recent` returns a bounded last-N and the reader reads
  only the tail; no unbounded work per poll.
- **Debug-left-on** → verbosity auto-reverts after its TTL and on restart.

## 11. Testing strategy

**Server (Hono / Node):**
- request-id middleware: generates when absent; reuses + sanitises a supplied one
  (strips control chars, caps length); echoes the header; logs `routePath` not the
  concrete path.
- level filtering: `debug` dropped at the `info` default; emitted after
  `raise("debug", ttl)`; auto-reverts after the TTL (fake timers).
- `RotatingFileSink`: rotates at the size cap; prunes to the file cap; `LogReader`
  returns the recent tail and `byRequestIds`; **degrades to stdout on an IO
  error** without throwing.
- **no-body / no-query assertion:** a request with a body and a query string
  produces a log line containing neither — proven by deletion (drop the
  route-pattern/omit-body logic, assert it now leaks).
- diagnostics endpoints: auth-gated (401 no session / 403 wrong role) on all three;
  invalid input → `diagnostics.invalid_verbosity`; `POST …/verbosity` raises the
  level; `GET …/recent` returns the last-N lines; `GET …/verbosity` returns the
  level + revert time.
- error-boundary enrichment: a `warn`/`error` line carries the `requestId` from
  context.

**Client (`@waitron/diagnostics`, plain Node vitest — DOM is dependency-injected):**
- ring buffer bounds + oldest-eviction; `snapshot()` is a copy.
- redaction guard: allowlisted primitives pass; a nested/body field is dropped
  (throws in test mode) — proven by deletion.
- error boundary: a dispatched `error` and an `unhandledrejection` on the injected
  target each push an `error` event; a thrown `{ code }` records that code.
- instrumented fetch (fake `fetch` + Node `Response`): sets and reads
  `x-request-id`; masks dynamic path segments; records `code` on failure via
  `res.clone()`; **never records a body**.

**Dashboard viewer (Lit / browser mode + axe):**
- polls and renders `recent` lines; diagnostic-mode control posts verbosity and
  shows the auto-revert countdown; nav entry hidden for a non-manager session.

Coverage at the package's configured thresholds; the browser apps keep their
documented `95/95/90/88`.

## 12. Repo-convention checklist (so review doesn't bounce it)

A new package touches several repo-wide lists — enumerated here because the house
rules record that a hardcoded cross-package list going stale is invisible to
scoped CI:

- `packages/diagnostics` throws **no** `AppError`, so it ships **no `src/errors.ts`**
  and does **not** augment `@waitron/shared` — the `errors-reachable` guard only
  fires on a package that has both `src/index.ts` and `src/errors.ts`, so it does
  not apply here.
- English-only identifiers (the guard scopes `packages/`; this package is not
  exempt). Add `"diagnostics"` to `GENERIC_PACKAGES` in
  `packages/db/src/english-only.ts` **and** update the pinned assertion in
  `scripts/english-only.test.ts` (the expected array and its "sixteen" → "seventeen"
  wording), or that test fails.
- CI scoping: add `"@waitron/diagnostics"` to **exactly one** of `LIGHT_A_PACKAGES`
  / `LIGHT_B_PACKAGES` in `scripts/changed-scope.mjs` (it is a light pure-TS,
  test-bearing leaf — not `OWN_SHARD_PACKAGES`, not `PACKAGES_WITHOUT_TESTS`).
  `scripts/ci-workflow.test.mjs` / `changed-scope.test.mjs` pin these against the
  real workspace and will fail if it is missing or double-listed.
- No edit to the root `vitest.config.ts` (it measures only `scripts/**` +
  `english-only.ts`), `pnpm-workspace.yaml` (`packages/*` glob auto-includes it),
  or `OWN_SHARD_PACKAGES`.
- A new `diagnostics.view` permission is added to `PERMISSIONS`
  (`packages/identity/src/permissions.ts`) and to the `MANAGER` role set (so
  manager + admin hold it). The server code `diagnostics.invalid_verbosity` is
  registered in `apps/server/src/errors.ts` (the server host's registry), **not** in
  the client package.
- Server changes stay within `apps/server`; no new tenant-scoped DB table in this
  slice, so no RLS/FORCE/grants work and no migration.

## 13. Deferred to later slices

- `bug_reports` table + capture endpoint + frozen bundle (Slice 2).
- `wt-report-dialog` + "Report a problem" trigger in till/dashboard (Slice 2).
- Copy-pastable GitHub-ready markdown serialiser (Slice 2).
- *Problem reports* triage screen + status transitions (Slice 3).
- Automated GitHub-issue creation, which needs a stored token in
  `@waitron/credentials` (Slice 3).
- Rolling out the button/trail to `apps/setup` (later).

## 14. Resolved decisions

- **Permission:** `diagnostics.view`, added to `PERMISSIONS` and the `MANAGER` role
  set (manager + admin). One permission covers both viewing recent logs and
  toggling verbosity in this slice.
- **No per-handler child logger** — the middleware `http.request` line and the
  error-boundary `requestId` enrichment carry correlation; handlers are untouched.
- **Live view is polling, not SSE** — reuses the `LogReader`, matches the existing
  dashboard polling pattern, no new streaming dependency.
- **The client package throws nothing** — duck-types the `{ code }` shape the app
  clients already throw; no `errors.ts`, no `@waitron/shared` dependency.

Defaults to confirm during implementation (sensible values chosen in the plan, not
blockers): rotation size/count (`10 MB × 5`), the client ring-buffer size (`200`),
and the viewer poll interval (`~1.5 s`) — all tunable via config where they touch
the box's disk budget.

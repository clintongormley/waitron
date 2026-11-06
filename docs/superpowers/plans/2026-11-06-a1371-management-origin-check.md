# A1371: every management change checks which page sent it

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** A request that changes something and carries the dashboard's sign-in cookie
(`waitron_management_session`) is refused, 403 `management.origin_refused`, unless the page that
sent it is the box's own (or one the box already trusts for credentialed requests). One check,
mounted once in `startServer` ahead of every route, so a route added later is covered without
anyone remembering.

**Architecture:** A new `apps/server/src/own-page.ts` holds the page test (one function in place
of the six copies the tree has today) and a Hono middleware. `boot.ts` mounts the middleware on the
one app every start serves, straight after the request-id middleware. The middleware acts only on
`POST`, `PUT`, `PATCH` and `DELETE` requests that carry the management cookie; everything else
passes untouched. B3 PR 9's route-level check in `box-host-api.ts` is removed, because the shared
one now covers its routes.

**Tech Stack:** Hono 4.13.16 and `@hono/node-server` 2.1.5 (`ls node_modules/.pnpm | grep hono`,
2026-11-06), TypeScript 7 in `apps/server`, Vitest 4.1.12.

**Spec:** the A1371 item as queued by the watcher on 2026-11-06, and its backlog entry
[`docs/backlog/box.md` "Management changes do not check which page sent them"](../../backlog/box.md#management-changes-do-not-check-which-page-sent-them)
(line 732 on `4d1500bbf8`), with its pointer at `docs/backlog.md:5326`.

**Branch:** `feat/a1371-management-origin-check`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a1371-management-origin-check`, off main
`4d1500bbf8`. The executing session keeps the ledger
`docs/handoffs/2026-11-06-a1371-management-origin-check.md`.

## Global Constraints

- No table, no migration, no schema change. The A1308 hold is in force: if any step turns out to
  need one, stop and report; do not work around it.
- Auth is a risk trigger: the branch takes the FULL `/finish-branch` wave, with the Codex run-it
  seat as two reviews side by side (the second told to set this plan's checklist aside).
- English only in code, comments, identifiers and tests (CLAUDE.md §3).
- Every commit `git commit -s`. Commit messages in plain English (global CLAUDE.md).
- Error code: `management.origin_refused`, HTTP 403, params `{}`. Answer shape
  `{ error: { code: "management.origin_refused", params: {} } }`, the shape `readOnlyGate`
  (`apps/server/src/read-only-gate.ts:33-36`) returns from a middleware.
- Log line on refusal: `log("warn", "management.origin_refused", { requestId, method, origin, site })`,
  where `origin` and `site` are the raw `Origin` and `Sec-Fetch-Site` header values or `null` when
  absent. Never the path (a path can carry a token) and never the cookie.
- Comments: only for an invariant or a non-obvious why (CLAUDE.md §1, last rule). No history.
- Each implementer runs `pnpm format:check` and `pnpm --filter @waitron/server typecheck` before
  committing, plus the focused tests its task names. CI owns the package suites.
- A browser-mode run (Task 5's dashboard test) and the boot suites in Task 6 start real processes:
  check `memory_pressure | grep free` first and scale to what is free.

## Review Focus

The inputs most likely to refuse a real caller, which is the costly failure here:

1. **The dev dashboard over HTTPS.** When the box leaf exists as Vite starts, the dashboard's proxy
   targets `https://127.0.0.1:<port>` (`scripts/dev-server-proxy.ts:31-35`) and keeps the browser's
   `Host` (the proxy entries in `apps/dashboard/vite.config.ts:17-22` set no `changeOrigin`), and
   `@hono/node-server` takes the scheme from the socket and the host from `Host`
   (`node_modules/.pnpm/@hono+node-server@2.1.5_hono@4.13.16/node_modules/@hono/node-server/dist/index.mjs:599-605`).
   So the browser sends `Origin: http://localhost:5191` and the server sees
   `https://localhost:5191`. Expected: taken, through `managementOrigin`. Pinned by Task 2's
   "the dashboard on `managementOrigin`" case (an `Origin` that differs from the request's own).
2. **A till page served by another of the venue's servers**, under a shared tenant domain, so the
   browser treats both servers as one site and sends this server's host-only management cookie
   with the till's cross-origin request (`apps/till/src/api/server-router.ts:286-299` sends till
   requests to whichever server is current; `apps/till/src/api/client.ts:4905-4908` sends them
   `credentials: "include"`; `config.tenantDomain` exists so "one credential reaches every one of
   the venue's servers after a promotion", `apps/server/src/config.ts` `tenantDomain`). Expected:
   taken, through the CORS allow-list. Pinned by Task 2's "a page on the advertised origin" case.
3. **The dashboard's own requests despite its `<meta name="referrer" content="no-referrer">`**
   (`apps/dashboard/index.html:9`). Under that policy a request whose mode is not `cors` sends
   `Origin: null`; a `fetch()` is `cors` mode and keeps its real origin (Fetch spec quote below).
   No dashboard code uses a native form submit, `sendBeacon` or a fetch `mode`
   (`grep -rn "sendBeacon\|\.submit()\|requestSubmit\|method=\"post\"\|mode: \"no-cors\"\|mode: \"same-origin\"\|keepalive"`
   over `apps/dashboard/src apps/till/src apps/setup/src packages/ui/src packages/ui-core/src packages/dashboard-kit/src`
   printed nothing, 2026-11-06). Expected: taken. Pinned by Task 8's real-Chromium control,
   since no Node test can show what Chromium sends.
4. **A stale management cookie on the box's own form posts** (`/carry-on`, the recovery page's
   start-again, the setup wizard after Start again): the cookie is `path=/`
   (`packages/server-kit/src/management-cookie.ts:11-18`), so it rides these posts for as long as
   the browser keeps it. Expected: taken, because their `Origin` is the box's own. Pinned by Task 1's
   "a form post from the box's own page" case.
5. **The box reached by IP address or by the Cloud staff hostname.** `Origin` and `Host` both carry
   whatever name the browser used, and the Cloud tunnel splices raw bytes with TLS end to end
   (`packages/tunnel/src/client.ts:1-3`), so `Host` arrives as the browser sent it. Expected: taken.
   Pinned by Task 1's "the box by IP address" case.

---

## Decisions, with receipts

### D1. Where the check lives and how it covers every route

`app.use("*", requireManagementChangeFromOwnPage(...))` in `apps/server/src/boot.ts`, directly
after `app.use("*", buildHeaderMiddleware(build))` (line 1309 on `4d1500bbf8`), so its refusals
carry a request id and it runs before `mountCloudPublic`, discovery, guide pages, every mode's
routes, the read-only gate (line 2035), the disk-full gates and CORS (line 2229).

Why not per prefix or per route: the management session is read inside each handler, not by a
middleware (`requireManagementSession(c)` is called per route in more than fifty files under
`apps/server/src` and `packages/*/src`; `grep -rn "requireManagementSession("` on 2026-11-06), and
the write routes sit under `/management-api`, `/api`, `/print-api`, `/setup-api`, `/webhooks` and
`/carry-on` (`grep -rhoE "\.(post|put|patch|delete)\(\s*[\`\"]/[a-z0-9_-]+"` over those trees).
A `use("*")` registered before any route on the app runs ahead of every route registered later,
including those merged in by `app.route()` (the till API, `disk-full-gate.ts:31`). The full,
waiting and restricted starts and setup mode all register on this same `app` (`boot.ts:1288`
comment, and setup mode mounts on `app` at line 1398). The recovery listener wraps this app with
`surface.route("/", app)` (`recovery-listener.ts:152`), so the check still runs inside it.

Apps that do NOT get it, and why that is safe: `first-setup-entry.ts`, `recovery-surface.ts`,
`recovery-listener.ts`'s own surface, `landing-app.ts`, `first-setup-launch.ts` and
`node-entry.ts` build their own `Hono` apps, and none of them reads the management cookie
(`grep -c 'ManagementSession\|management_session\|MANAGEMENT_COOKIE\|managementSession'` printed
0 for each, 2026-11-06).

A future route is covered automatically. Task 2's sweep test walks the started app's route table
and fails if any write route answers the attack with anything else, which catches a route
registered ahead of the middleware or on an app it does not wrap.

### D2. Which requests it judges

Only `POST`, `PUT`, `PATCH` and `DELETE` that carry a `waitron_management_session` cookie, any
value. `GET`, `HEAD` and `OPTIONS` pass (another page cannot read the answers, and CORS
preflights must reach `corsForVenue`). A request with no management cookie passes: it cannot be
acting as a signed-in manager through the cookie, and the paths that legitimately post from another
origin without it (a till on another venue server, Stripe's webhook, the print agent) must keep
working.

Presence, not a live session, decides: checking the session would cost a database read on every
write, and nothing outside tests sends that cookie except a browser. Receipt:
`grep -rln "waitron_management_session\|MANAGEMENT_COOKIE"` over this repository, excluding
`.test.` and `/testing/` files, printed only `packages/server-kit/src/management-cookie.ts`,
`packages/server-kit/src/index.ts` and four plan/spec documents (2026-11-06); the same grep over
`~/workspace/repos/waitron-cloud` at `9842f2910` printed nothing. So scripts, `waitron.sh`, the box
host service, the print agent and Cloud never send it.

### D3. What counts as the box's own page

Two functions in `own-page.ts`:

- `sentFromThisOrigin(c)`: true when `Origin` is absent or equals `new URL(c.req.url).origin`, AND
  `Sec-Fetch-Site` is absent, `same-origin` or `none`. This is exactly the test six files already
  copy (D5).
- `sentFromOwnPage(c, trusted)`: true when `sentFromThisOrigin(c)` is true, OR `Origin` is present,
  is not the literal `null`, differs from the request's own origin, and `await trusted(origin)` is
  true. In that second branch any `Sec-Fetch-Site` is accepted, because a browser correctly calls a
  trusted page on another origin `same-site` or `cross-site`.

Boot passes `trusted = async (origin) => origin === config.managementOrigin || (await allowOrigin(origin))`,
where `allowOrigin` is the CORS allow-list already built at `boot.ts:1289` (`createOriginAllowlist`,
`apps/server/src/allowed-origins.ts`): this server's `advertisedOrigin` (which defaults to
`managementOrigin`, `config.ts:539-541`), every routable venue server's `contactUrl` origin from the
held membership document, and, in dev mode only, the dev Vite origins (`allowed-origins.ts:44-50` and `:58`).
Those are already allowed to make credentialed cross-origin requests to `/api/*` and read the
answers (`boot.ts:2229`), so refusing their writes here would be inconsistent; and Review Focus 1
and 2 need them. Dev mode is `WAITRON_ENV=dev`, which `dev-setup.ts:152` and `dev-onboard.ts:75`
write for the dev stack.

Consequences, each intended:

- A page on another port of the box's own name is refused unless that port is a trusted origin.
- The box's own origin with `Sec-Fetch-Site: same-site` is refused (a browser contradicting itself).
  This keeps B3 PR 9's tested case "the box's own origin with a same-site fetch"
  (`box-host-api.test.ts`, the `OTHER_PAGES` table).
- `Origin: null` is refused.
- No `Origin` and no `Sec-Fetch-Site` passes. That is a non-browser tool, and it is safe because a
  browser always sends `Origin` on a request whose method is not `GET` or `HEAD`. The Fetch
  standard's "append a request `Origin` header" (`curl -sL https://fetch.spec.whatwg.org/`,
  2026-11-06): "Otherwise, if request’s method is neither `GET` nor `HEAD`, then: If request’s mode
  is not "cors", then switch on request’s referrer policy: "no-referrer" Set serializedOrigin to
  `null`. … Append (`Origin`, serializedOrigin) to request’s header list." So a cross-page post
  arrives with its real origin or `null`, never with none. `Sec-Fetch-Site` is a second signal only:
  Fetch Metadata sends it only to "a potentially trustworthy URL" (`curl -sL
  https://w3c.github.io/webappsec-fetch-metadata/`, 2026-11-06: "Assert: r’s current URL is a
  potentially trustworthy URL."), so a box served over plain HTTP on a LAN address gets none, and
  the check rests on `Origin` there.

Why the port matters at all: SameSite ignores it. HTML's "Sites" definition is "(origin's scheme,
origin's host's registrable domain)", with no port (quoted in the backlog entry, read 2026-11-06),
and Codex showed Chromium sending the manager's cookie from another port. Different `.local` names
are different sites: `local` is not on the public suffix list (`grep -n "^local$"` over
`https://publicsuffix.org/list/public_suffix_list.dat` printed nothing, 2026-11-06), and the list's
algorithm says "If no rules match, the prevailing rule is "*"." (`https://github.com/publicsuffix/list/wiki/Format`),
so `waitron.local` is its own registrable domain.

### D4. One general code; B3 PR 9's code goes

`management.origin_refused`, registered in `apps/server/src/errors.ts` (the server's registry; the
middleware lives in `apps/server`). It names the concept, a management change from another page,
not the throwing file (CLAUDE.md §3). Before go-live renaming and deleting codes is free
(CLAUDE.md §3, "Error codes name the domain concept").

`box_host.origin_refused` is deleted (Task 3): #2501 added it (`git log -S "box_host.origin_refused"`
names only `4d1500bbf8`) as the stopgap for exactly this item, and the shared check now answers
first for every cookie-carrying request to those routes. No dashboard wording exists for it
(`grep -rn "box_host" apps/dashboard/src/i18n/*.ts` printed nothing).

`scripts/errors-reachable.test.ts` does not apply (it checks package barrels under `packages/`,
lines 7-12 and 52-59). `scripts/alert-codes.test.ts` does not apply (no incident is recorded; the
refusal is a log line only).

### D5. Which existing checks fold in, and which stay different on purpose

Fold the predicate (identical behaviour, codes unchanged) in Task 4, replacing each inline copy
with `sentFromThisOrigin(c)`:

| File | Function | Keeps, on purpose |
| --- | --- | --- |
| `box-host-api.ts` | `insecureJoin` (via `fromOtherPage`) | the TLS socket check and `box_network.join_connection_insecure` |
| `backup-recovery-pack-api.ts` | `requireSecurePackRequest` | the TLS check, `recovery.pack_origin_refused`, the JSON check; a recovery pack carries secrets, so it refuses another page even with no cookie |
| `node-operation-https.ts` | `requireNodeOperationHttps` | the TLS check and `authorization.not_permitted` |
| `recovery-start-again.ts` | `fromThisPage` | used on the recovery page, which has no management session |
| `setup-first-fiscal-api.ts` | `assertFirstFiscalRequest` | `setup.owner_required` and the JSON check; setup has no management session |
| `setup-recovery-preparation-api.ts` | `assertOwnerTransport` | the TLS check and `setup.owner_required` |

All six compute the same thing today (read at `box-host-api.ts:138-145`,
`backup-recovery-pack-api.ts:158-166`, `node-operation-https.ts:6-16`,
`recovery-start-again.ts:301-308`, `setup-first-fiscal-api.ts:98-105`,
`setup-recovery-preparation-api.ts:111-122`); their existing tests must pass unchanged, which is the
proof.

Remove entirely (Task 3): `box-host-api.ts` `requireOwnPage` and its `app.on("POST", [...])`
mount (lines 168-173, 191-195).

Leave unchanged, stricter than the shared check: `cloud-api.ts:115,151`,
`content-suggestions-api.ts:97`, `content-translations-api.ts:165` and
`venue-zone-repair-api.ts:42-49,69`. They require `Origin` to equal `managementOrigin` exactly, so
they refuse a tool with no `Origin` and the box's own origin when it is not `managementOrigin`.
Loosening or folding them is not this item.

### D6. No JSON-only rule

The backlog entry asked "checks `Origin` and `Sec-Fetch-Site` …, requires JSON, or both". The page
check alone stops both attack shapes the entry names (a plain-text body and no body). A JSON rule
would not cover the body-less routes (`/api/box/retire`, `/api/box/free-space`,
`/api/box/clock-challenge`) and would refuse the box's own form posts (`carry-on.ts`,
`recovery-start-again.ts` `formBody`). Routes that already demand JSON keep doing so.

### D7. What changes for the box-host routes' "before the session" case

B3 PR 9 refused a request from another port with NO cookie before the session check (403
`box_host.origin_refused`, the "from another port is refused before the session is checked" case).
With D2 that request now passes the shared check and the route refuses it as
`management_session.required` (401). The property the test was there for, that nothing reaches the
host, still holds and stays asserted (Task 3).

### D8. In scope and out of scope

| Caller | How it reaches the box | After this change |
| --- | --- | --- |
| Dashboard on the box (`/manage/`, same origin as the API) | relative `fetch`, `credentials: "include"` (`packages/dashboard-kit/src/request.ts:92-97`; `DashboardApi` default `baseUrl = ""`, `apps/dashboard/src/api/client.ts:2523`) | taken: `Origin` is the request's own |
| Dashboard by IP, by `waitron.local`, by the Cloud staff hostname through the tunnel | same | taken: `Host` and `Origin` carry the same name (Review Focus 5) |
| Dev dashboard on Vite 5191 (and other slots) | Vite proxy for `/api`, `/management-api`, `/media`, `/help` | taken: same origin, or `managementOrigin` / dev origins when the proxy speaks HTTPS (Review Focus 1) |
| Till on the box, same origin | relative `fetch` | taken |
| Till on another venue server | cross-origin `fetch` with CORS | taken if it carries the management cookie (trusted origin); untouched if not |
| Setup wizard, recovery page, waiting page `/carry-on` | same-origin `fetch` or form post; no management session | untouched, or taken when a stale cookie rides along (Review Focus 4) |
| Login, passkey and password-reset posts | no session yet | untouched without a cookie; refused from another page with a stale cookie (login forgery is a separate class and not a goal here) |
| Logout `DELETE /management-api/session` | carries the cookie | taken from the box's page; refused from another page |
| Google callback `GET /management-api/google/callback` | cross-site top-level GET | untouched (GET). No POST callback exists (`grep -rn "form_post\|response_mode"` printed nothing) |
| Device and till routes | device and till cookies | untouched unless a management cookie rides along |
| Print agent `/print-api/agent/*`, Stripe `/webhooks/stripe`, box-to-box `/api/node/*`, Cloud | server-side, no management cookie (D2) | untouched |
| Scripts, `waitron.sh`, curl | no cookie, no `Origin` | untouched |
| Landing listener pages (port 80) | `fetch` with `credentials: "omit"` (`connection-bootstrap-page.ts:126`) | untouched |

Left open, for a new backlog entry (Task 7): the till's own cookies (`waitron_till_session`,
`till-session.ts:45-51`, and `waitron_device`, `device-session.ts:60-67`) are `SameSite=Strict`
too, so a page on another port can post to till routes with them. That needs a till-side trusted
set and is not this item.

---

## File structure

- Create `apps/server/src/own-page.ts`: `sentFromThisOrigin`, `sentFromOwnPage`,
  `requireManagementChangeFromOwnPage`. One responsibility: is this request from the box's own page.
- Create `apps/server/src/own-page.test.ts`: the module's unit tests on a bare Hono app.
- Create `apps/server/src/boot.management-origin.test.ts`: the attack, the legitimate callers and
  the route sweep against a started server.
- Modify `apps/server/src/errors.ts`: add `management.origin_refused`; delete
  `box_host.origin_refused`.
- Modify `apps/server/src/boot.ts`: one `app.use`, and a test seam `observeApp`.
- Modify `apps/server/src/box-host-api.ts` and its three unit test files plus
  `boot.box-host.test.ts`.
- Modify the five other files of D5 (predicate only).
- Modify `apps/dashboard/src/i18n/codes.ts` and `codes.test.ts`.
- Modify `docs/backlog/box.md`, `docs/backlog.md`, `CLAUDE.md`, `docs/developers/conventions-data.md`.

---

### Task 1: The page check and its middleware

**Files:**
- Create: `apps/server/src/own-page.ts`
- Create: `apps/server/src/own-page.test.ts`
- Modify: `apps/server/src/errors.ts` (add `management.origin_refused`, beside the other request
  refusals, with a one-line doc comment: "A change carrying the dashboard's sign-in cookie was sent
  by a page other than the box's own (`Origin` or `Sec-Fetch-Site`), so it was not run.")

**Interfaces:**
- Produces:
  - `export type TrustedOrigin = (origin: string) => Promise<boolean>;`
  - `export function sentFromThisOrigin(c: Context): boolean`
  - `export async function sentFromOwnPage(c: Context, trusted: TrustedOrigin): Promise<boolean>`
  - `export function requireManagementChangeFromOwnPage(trusted: TrustedOrigin, log: Logger): MiddlewareHandler`
    (`Logger` from `./logger.js`; reads the cookie with `readManagementSessionToken` from
    `@waitron/server-kit`; imports `./errors.js`; builds `new AppError("management.origin_refused", {})`
    and returns its code and params as JSON with status 403, as `readOnlyGate` does)

- [ ] **Step 1: Write the failing tests** in `own-page.test.ts`. A bare `Hono` app with the
  middleware on `"*"` and a `POST`, `PUT`, `PATCH`, `DELETE` and `GET` route on `/x` that each
  answer 200 and count calls; requests through `app.request("https://box.test/x", …)`. Constants:
  `BOX = "https://box.test"`, `COOKIE = "waitron_management_session=" + randomUUID()`, a `trusted`
  spy that answers true only for `"https://till.example.test"`.

  Refused (403, the exact body, route not called, `trusted` not consulted where the origin is the
  box's own, and the log called with `("warn", "management.origin_refused", { requestId: undefined, method: "POST", origin: <header or null>, site: <header or null> })`):
  - `"another port of the box's own name"`: `origin: "https://box.test:8443"`, `sec-fetch-site: same-site`
  - `"the box's own name over plain HTTP"`: `origin: "http://box.test"`
  - `"another site"`: `origin: "https://elsewhere.example"`, `sec-fetch-site: cross-site`
  - `"a null origin"`: `origin: "null"` (assert `trusted` was not called)
  - `"a same-site fetch with no Origin"`: `sec-fetch-site: same-site`
  - `"a cross-site fetch with no Origin"`: `sec-fetch-site: cross-site`
  - `"the box's own origin with a same-site fetch"`: `origin: BOX`, `sec-fetch-site: same-site`
  - each of `PUT`, `PATCH`, `DELETE` with the first row's headers
  - `"without reading one byte of its body"`: a `ReadableStream` body whose `pull` counts, as in
    `box-host-api.test.ts`'s "is refused without reading one byte of its body"; assert pulls `0`.

  Taken (200, route called once):
  - `"the box's own page"`: `origin: BOX`, `sec-fetch-site: same-origin`
  - `"a page the person opened themselves"`: `origin: BOX`, `sec-fetch-site: none`
  - `"a tool sending neither header"`: `{}`
  - `"a trusted page on another origin"`: `origin: "https://till.example.test"`, `sec-fetch-site: cross-site`;
    assert `trusted` was called with exactly that origin
  - `"a form post from the box's own page"`: `origin: BOX`, `content-type: application/x-www-form-urlencoded`, body `a=1`
  - `"the box by IP address"`: request URL `http://192.168.1.10:8080/x`, `origin: "http://192.168.1.10:8080"`
  - `"another page with no management cookie"`: no cookie, `origin: "https://elsewhere.example"`
    (the no-cookie pass, D2)
  - `"a GET from another page"`: `GET`, cookie, `origin: "https://box.test:8443"`, `sec-fetch-site: same-site`
  - `"an OPTIONS from another page"`: same headers, `OPTIONS` (route `app.options("/x", …)`)

  Pure-function cases for `sentFromThisOrigin` (true for the three "taken" header sets above, false
  for each "refused" one with no trusted origin), so Task 4's callers have their own pins.

- [ ] **Step 2: Run, and watch it fail** because the module does not exist.
  Run: `pnpm --filter @waitron/server exec vitest run src/own-page.test.ts`
  Expected: FAIL, "Failed to load url ./own-page.js" (or the equivalent import error), no `Tests` count of passes.

- [ ] **Step 3: Implement `own-page.ts`** per D2 and D3, and the `errors.ts` entry. The middleware
  checks the method first, then the cookie, then `await sentFromOwnPage(c, trusted)`.

- [ ] **Step 4: Run, and see it pass**, then prove the guard by deletion: comment out the
  method test, then the cookie test, then the `null` test, then the `Origin !== own` condition of
  the trusted branch, each alone; each must turn at least one named case red. Restore.
  Run: `pnpm --filter @waitron/server exec vitest run src/own-page.test.ts`
  Expected: PASS with a `Tests` count equal to the cases written.

- [ ] **Step 5: Commit** `own-page.ts`, `own-page.test.ts`, `errors.ts`.

### Task 2: Mount it in every start, and prove the attack is refused

**Files:**
- Modify: `apps/server/src/boot.ts` (the `app.use` after line 1309; the seam)
- Create: `apps/server/src/boot.management-origin.test.ts`
- Modify: `apps/server/src/boot.box-host.test.ts:219-243` (expected code)

**Interfaces:**
- Consumes: `requireManagementChangeFromOwnPage`, `TrustedOrigin` from Task 1.
- Produces: `StartServerSeams.observeApp?: (app: Hono) => void`, doc comment "Hands a test the app
  every route is registered on; production leaves it unset." Called once, straight after
  `healthApp(...)` (boot.ts:1284).

- [ ] **Step 1: Write the failing tests** in `boot.management-origin.test.ts`. Copy the
  `withServer`, `@hono/node-server` mock and `answerOf` shape from `boot.box-host.test.ts:18-131`
  (useVenueDb with `migrationOptionsFor(manifestSets(), null)`, `setupVenue`, one `freePorts` call),
  adding to the env `WAITRON_ADVERTISED_ORIGIN: "https://till.example.test"` and to the seams
  `boxHostRequests: fakeHost()`, `requestFromBox: () => false` (so `/api/box/clock-*` do not refuse
  127.0.0.1 as the box itself) and `observeApp: (app) => (seen = app)`. `otherPort` is
  `http://127.0.0.1:<port + 1>`; the manager cookie is `venue.managerCookie`.

  Case `"refuses a change from another port of the box's own address, for a signed-in manager"`:
  for each of `POST /api/box/free-space` (no body), `POST /api/box/retire` (no body),
  `POST /api/box/clock-challenge` (no body), `POST /api/box/clock-confirm` and
  `POST /api/box/clock-set` (body `"{}"`), `POST /api/box/screen` (body `{"start":"till"}`),
  `POST /management-api/catalogues` (body `{"name":"From another page"}`), and one route under
  `/print-api` (`POST /print-api/agent/jobs`, no body), each with `cookie`, `origin: otherPort`,
  `sec-fetch-site: same-site`, `content-type: text/plain;charset=UTF-8`: expect
  `{ status: 403, body: { error: { code: "management.origin_refused", params: {} } } }`. Then assert
  no catalogue named "From another page" exists (read the table through `suite.db`) and the fake
  host's `screenSet` was called 0 times.

  Case `"takes a change from every page that is the box's own"`: `POST /management-api/catalogues`
  with a minimal valid JSON body (take it from an existing `catalogue-api` test's create call) and
  `content-type: application/json`, once per row, each with its own name, expecting 201:
  - `"the box's own page"`: `origin: http://127.0.0.1:<port>`, `sec-fetch-site: same-origin`
  - `"the dashboard on managementOrigin"`: `origin: "http://localhost:5191"` (the default,
    `config.ts:151`), `sec-fetch-site: same-origin`
  - `"a page on the advertised origin"`: `origin: "https://till.example.test"`, `sec-fetch-site: cross-site`
  - `"a tool sending neither header"`: no `origin`, no `sec-fetch-site`
  - `"a page the person opened themselves"`: own origin, `sec-fetch-site: none`
  Then assert all five catalogues exist.

  Case `"refuses the attack on every write route the start registers"`: after the server is up
  (await `fullyStarted` if present), take `seen.routes`, keep `method` in POST/PUT/PATCH/DELETE,
  dedupe on `method path`, replace each `:name` segment (with any `{…}` pattern) by a fixed UUID and
  each `*` by `x`, and send each with `cookie: "waitron_management_session=" + randomUUID()` (a
  value that names no session, so a route left uncovered refuses for want of a session and changes
  nothing even before the fix), `origin: otherPort`, `sec-fetch-site: same-site` and no body.
  Collect every `method path` whose answer is not 403 `management.origin_refused` and
  `expect(uncovered).toEqual([])`. Also assert the swept list contains
  `"POST /management-api/catalogues"`, `"POST /api/box/free-space"` and `"POST /api/box/screen"`,
  so a filter that sweeps nothing cannot pass.

  In `boot.box-host.test.ts:239`, change the expected code to `management.origin_refused` (the
  shared check now answers first; the host-call counts at 241-243 stay).

- [ ] **Step 2: Run, and watch them fail.**
  Run: `pnpm --filter @waitron/server exec vitest run src/boot.management-origin.test.ts src/boot.box-host.test.ts`
  Expected: FAIL. The attack case shows other answers (expected by reading: 200 for
  `/api/box/free-space`, 201 for `/management-api/catalogues`, 403 `box_host.origin_refused` for
  `/api/box/screen`; record each route's actual answer in the commit message, as the before half
  of the attack). The sweep lists many uncovered routes. The legitimate-callers case passes already
  (nothing refuses them yet), which is expected.

- [ ] **Step 3: Implement.** Add the seam, then in `boot.ts` directly after the
  `buildHeaderMiddleware` line:
  `app.use("*", requireManagementChangeFromOwnPage(async (origin) => origin === config.managementOrigin || (await allowOrigin(origin)), log));`
  One comment line above it, the invariant only: it must stay ahead of every route so routes added
  later are covered.

- [ ] **Step 4: Run, and see them pass.** Then prove by deletion: comment out the `app.use` line;
  the attack and sweep cases must fail; restore. Pass `trusted = async () => false` instead; the
  "managementOrigin" and "advertised origin" rows must fail; restore.
  Run: the Step 2 command. Expected: PASS, with the `Tests` count printed.

- [ ] **Step 5: Commit** `boot.ts`, `boot.management-origin.test.ts`, `boot.box-host.test.ts`,
  with the before-answers from Step 2 in the message.

### Task 3: Remove B3 PR 9's own page check from the box-host routes

**Files:**
- Modify: `apps/server/src/box-host-api.ts` (delete `requireOwnPage`, its `app.on("POST", …)` mount,
  the `"box_host.origin_refused": 403` STATUS row; keep `refuse` and `requireSecureJoin`)
- Modify: `apps/server/src/errors.ts` (delete `box_host.origin_refused` and its comment)
- Modify: `apps/server/src/box-host-api.test.ts`, `box-host-api.calls.test.ts`,
  `box-host-api.join.test.ts`

**Interfaces:**
- Consumes: `requireManagementChangeFromOwnPage` from Task 1.

- [ ] **Step 1: Change the tests first.** In each of the three files' `mount` helpers
  (`box-host-api.test.ts:98-111`, `box-host-api.calls.test.ts:93`, `box-host-api.join.test.ts:98`),
  add, before `mountBoxHostApi`, `app.use("*", requireManagementChangeFromOwnPage(async () => false, log))`
  (the same order boot uses; `log` is the helper's logger, or `() => {}` where it has none). In
  `box-host-api.test.ts`'s "a change sent by a page other than the box's own" block
  (lines 749-834): expected code becomes `management.origin_refused`; the log assertion becomes
  `("warn", "management.origin_refused", { requestId: undefined, method: "POST", origin: …, site: … })`
  with each row's header values or `null`; rename the "refused before the session is checked" case
  to "from another port without a cookie asks the host nothing" and expect 401
  `management_session.required` with `changeAsked(host)` still `0` (D7). In
  `box-host-api.calls.test.ts:280-288` expect `management.origin_refused`. The join file's
  "connection, checked before the session" rows send no cookie, so they keep
  `box_network.join_connection_insecure`; leave them.

- [ ] **Step 2: Run.** The tests pass even before the deletion (the shared check answers first),
  so this run proves the move kept every refusal.
  Run: `pnpm --filter @waitron/server exec vitest run src/box-host-api.test.ts src/box-host-api.calls.test.ts src/box-host-api.join.test.ts src/boot.box-host.test.ts`
  Expected: PASS.

- [ ] **Step 3: Delete** `requireOwnPage`, its mount, the STATUS row and the `errors.ts` entry.
  `grep -rn "box_host.origin_refused" apps packages scripts` must print nothing.

- [ ] **Step 4: Run** the Step 2 command and `pnpm --filter @waitron/server typecheck`.
  Expected: PASS, and no type errors.

- [ ] **Step 5: Commit** the four test files, `box-host-api.ts`, `errors.ts`.

### Task 4: One page test in place of six copies

**Files:**
- Modify: `apps/server/src/box-host-api.ts` (`fromOtherPage` deleted; `insecureJoin` uses
  `!sentFromThisOrigin(c)`), `backup-recovery-pack-api.ts`, `node-operation-https.ts`,
  `recovery-start-again.ts`, `setup-first-fiscal-api.ts`, `setup-recovery-preparation-api.ts`

**Interfaces:**
- Consumes: `sentFromThisOrigin(c: Context): boolean` from Task 1.

- [ ] **Step 1: Run the existing tests first, unchanged, and keep the output.** These are the
  behavioural pins; none is edited in this task.
  Run: `pnpm --filter @waitron/server exec vitest run src/box-host-api.join.test.ts src/backup-recovery-pack-api.make.test.ts src/node-operation-https.test.ts src/recovery-start-again.test.ts src/setup-recovery-preparation-api.test.ts`
  plus every test file that `grep -ln "setup-first-fiscal-api\|assertFirstFiscalRequest\|setup.owner_required" apps/server/src/*.test.ts`
  lists. Use the file names that exist (`ls apps/server/src | grep -E "recovery-start-again|first-fiscal"`).
  Expected: PASS.

- [ ] **Step 2: Replace each inline `Origin`/`Sec-Fetch-Site` expression** with
  `sentFromThisOrigin(c)` (negated where the site refuses), keeping each file's TLS check, codes and
  JSON or form checks exactly as they are.

- [ ] **Step 3: Run the Step 1 commands again.** Expected: PASS with the same `Tests` counts.
  Then `grep -rn 'header("Sec-Fetch-Site")\|header("sec-fetch-site")' apps/server/src --include='*.ts' | grep -v test`
  must print only `own-page.ts` and `venue-zone-repair-api.ts` (D5 leaves the latter).

- [ ] **Step 4: Commit** the six files.

### Task 5: Dashboard wording for the refusal

**Files:**
- Modify: `apps/dashboard/src/i18n/codes.ts` (beside `recovery.pack_origin_refused`, line 1126)
- Modify: `apps/dashboard/src/i18n/codes.test.ts` (beside the case at line 798)

- [ ] **Step 1: Write the failing test** `"has English and Spanish copy for a change sent from another page"`:
  for `management.origin_refused`, English and Spanish each differ from
  `codeMessage("test.unmapped_code", <locale>)`, and Spanish differs from English (the shape of
  the case at `codes.test.ts:798-804`).

- [ ] **Step 2: Run, and watch it fail.** Check `memory_pressure | grep free` first (browser mode).
  Run: `pnpm --filter @waitron/dashboard exec vitest run src/i18n/codes.test.ts`
  Expected: FAIL on the new case only.

- [ ] **Step 3: Add the entry**, exact copy (refusal rule: what happened and what to do, nobody to
  send the person to, CLAUDE.md §3):
  - en: `"This change came from a page that is not this box's dashboard, so it was not made. Open the dashboard at its own address and make the change there."`
  - es: `"Este cambio llegó desde una página que no es el panel de esta caja, así que no se ha hecho. Abre el panel en su propia dirección y haz el cambio allí."`

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit** both files.

### Task 6: Every started-server suite that sends an `Origin` still passes

The shared check changes the answer of any started-server test that posts with a management cookie
and an `Origin` that is not the request's own, `managementOrigin` or the advertised origin. Unit
tests that mount routes on a bare app do not run it.

**Files:** whichever tests the run below turns red, and nothing else unless a defect is found.

- [ ] **Step 1: List the suites.**
  Run: `cd /Users/clintongormley/workspace/worktrees/waitron-feat-a1371-management-origin-check/apps/server && /usr/bin/grep -lE "startServer|ephemeralServerFixture|boot-harness" src/*.test.ts | xargs /usr/bin/grep -liE "[\"']?origin[\"']?\s*:"`
  (59 files on `4d1500bbf8`; the number is not a pin).

- [ ] **Step 2: Run them**, at the concurrency the free memory allows (CLAUDE.md §4, global
  "Test concurrency follows measured headroom"), with
  `pnpm --filter @waitron/server exec vitest run <files>`. Read the `Tests` count.

- [ ] **Step 3: Triage each failure by one rule.** If the test sent a page that is NOT the box's
  own and asserted some other refusal, the shared check now answers first: change the expected code
  to `management.origin_refused` and keep every "nothing changed" assertion. If the test sent a
  legitimate caller (the request's own origin, `managementOrigin`, the advertised origin, a venue
  server's `contactUrl`, no headers) and it is now refused, that is a defect in Task 1 or 2: stop,
  write it in the ledger, and report it rather than editing the test.

- [ ] **Step 4: Re-run the failed files** until green. Commit with a message listing each changed
  test and which rule applied.

### Task 7: Docs, the convention line, the backlog

**Files:**
- Modify: `docs/backlog/box.md` (delete the section at lines 732-750; rewrite B3's "Built so far"
  bullet at lines 1137-1145; edit line 1414's word list; add the left-open entry)
- Modify: `docs/backlog.md` (delete the pointer at 5326-5327; add the left-open pointer in the same
  place)
- Modify: `CLAUDE.md` §3, "Data, modules and migrations" list
- Modify: `docs/developers/conventions-data.md` (new section after "Anything that works as a live
  login is stored as a hash", line 1544)

- [ ] **Step 1: Backlog.** Delete "## Management changes do not check which page sent them" and its
  pointer (the PR finishes it; `docs/backlog.md` "How to keep this file honest", line 7562). In its
  place in both files, the one point left open, titled from its own words: "Till changes do not
  check which page sent them (left open by A1371, #<PR>)": the till and device cookies are
  `SameSite=Strict` (`till-session.ts:45-51`, `device-session.ts:60-67`), so a page on another port
  of the box's name can post to till routes with them; a fix needs a till-side trusted set that
  keeps the venue's other servers (CORS allow-list) and the tenant-domain device cookie working.
  Rewrite box.md 1137-1145 to say the scan, forget and start screen are refused from another page
  by the server-wide check (`management.origin_refused`, `apps/server/src/own-page.ts`) when the
  request carries the management cookie; drop `box_host.origin_refused` from line 1414's list.
  Read the whole B3 section and `docs/developers/*.md` for any other sentence naming
  `box_host.origin_refused` or `requireOwnPage` (`grep -rn "box_host.origin_refused\|requireOwnPage" docs CLAUDE.md`,
  ignoring `docs/superpowers/`, which is historical).

- [ ] **Step 2: Convention.** CLAUDE.md §3, one entry:
  "**A change that carries the dashboard's sign-in cookie is checked for the page that sent it, by
  `requireManagementChangeFromOwnPage`, mounted once in `startServer` ahead of every route; a new
  route needs nothing, and must not be registered on the app ahead of it.** Cost: a page on another
  port of the box's name could change the start screen (B3 PR 9's review). Guard: the sweep in
  `apps/server/src/boot.management-origin.test.ts`, weaker than its name: one attack shape, and only
  the routes a full primary start registers, not the waiting, restricted, mirror or setup starts'.
  [Receipt](docs/developers/conventions-data.md#a-change-carrying-the-dashboards-sign-in-cookie-is-checked-for-the-page-that-sent-it)."
  The topic section holds D2, D3's rule and its Fetch quotes, the trusted set, the stricter checks
  D5 leaves, and the till gap.

- [ ] **Step 3: Check.**
  Run: `pnpm exec vitest run scripts/claude-md-pointers.test.ts && pnpm exec prettier --check CLAUDE.md && pnpm format:check`
  Expected: each exits 0 (check each status; `docs/` is prettier-ignored, so
  `pnpm exec prettier --file-info docs/backlog.md` printing `"ignored": true` is expected).

- [ ] **Step 4: Commit** the four files.

### Task 8: The attack in real Chromium, after the change, with a control

Not committed; the result goes in the PR description. Node tests set the headers themselves, so
only a browser shows what Chromium actually sends (Review Focus 3).

- [ ] **Step 1:** Start the dev stack: `wa-wt demo waitron-feat-a1371-management-origin-check`
  (`wa-wt ls` for its ports; slot 1 is dashboard 5191, server 8080). Record the server's process
  group as `wa-wt` reports it; stop only that at the end (`wa-wt down <name>`).
- [ ] **Step 2:** In a scratch directory from `mktemp -d`, write `attack.html` that runs
  `fetch("http://localhost:5191/management-api/catalogues", { method: "POST", mode: "no-cors", credentials: "include", headers: { "content-type": "text/plain" }, body: JSON.stringify({ name: "Chromium attack" }) })`,
  and serve it with `python3 -m http.server 8099` from that directory (8099 is not a dev Vite
  port, so it is not trusted, D3).
- [ ] **Step 3:** With the workspace's Playwright Chromium, sign in to
  `http://localhost:5191/manage/` as `owner@demo.waitron.local` / `dashPass123`, then open
  `http://localhost:8099/attack.html` in the same context. Expected: no catalogue named "Chromium
  attack" (read it through the dashboard's menus list or `GET /management-api/catalogues` from the
  dashboard tab), and the server log (`wa-wt logs <name>`) shows `management.origin_refused` with
  `origin: "http://localhost:8099"` and `site: "same-site"`. If the log shows no line at all, the
  cookie did not ride along and the run proves nothing: say so instead of reporting a pass.
- [ ] **Step 4 (control):** From the dashboard tab, `page.evaluate` the same `fetch` with
  `mode: "cors"`, `content-type: application/json` and name "Chromium control". Expected: a 201 and
  the catalogue listed. This is the case that would fail if the dashboard's `no-referrer` policy
  made Chromium send `Origin: null` (Review Focus 3).
- [ ] **Step 5:** Stop the stack and the `http.server` by the process ids you started. Put both
  results, with the log lines, in the ledger for the PR description.

---

## After the tasks

Run `/finish-branch` with the worktree path and a note naming this plan: the full wave (risk
trigger: auth), the Codex run-it seat as two reviews side by side. Then announce readiness to land.

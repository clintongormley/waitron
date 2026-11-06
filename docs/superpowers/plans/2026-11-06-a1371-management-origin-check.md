# A1371: every management change checks which page sent it

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

> 2026-11-06, after the fresh-context plan review (0 critical, 4 important, 8 minor): the waiting
> start builds its own app, so it gets the check too (new Task 3); the dev till and setup apps are
> named and tested; Task 7's triage rule keeps each route's own guard tested; Task 4 proves each
> fold site by inversion. The changes are listed under "Review fold" at the end.

**Goal:** A request that changes something and carries the dashboard's sign-in cookie
(`waitron_management_session`) is refused, 403 `management.origin_refused`, unless the page that
sent it is the box's own (or one the box already trusts for credentialed requests). One check,
mounted ahead of every route on each app `startServer` serves (the main app and the waiting
start's app), so a route added later is covered without anyone remembering.

**Architecture:** A new `apps/server/src/own-page.ts` holds the page test (one function in place
of the six copies the tree has today) and a Hono middleware. `boot.ts` builds the middleware once
and mounts it on the main app straight after the request-id middleware, and hands the same
middleware to `startWaiting`, which mounts it on its own app after its handover gate. The middleware
judges every request whose method is not `GET`, `HEAD` or `OPTIONS` that carries the management
cookie; everything else passes untouched. B3 PR 9's route-level check in `box-host-api.ts` is removed,
because the shared one now covers its routes.

**Tech Stack:** Hono 4.13.16 and `@hono/node-server` 2.1.5 (`ls node_modules/.pnpm | grep hono`,
2026-11-06), TypeScript 7 in `apps/server`, Vitest 4.1.12.

**Spec:** the A1371 item as queued by the watcher on 2026-11-06, and its backlog entry
`docs/backlog/box.md` "Management changes do not check which page sent them"
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
  the header is absent (`=== undefined`); when the trusted-origin lookup threw, the params also
  carry `lookupFailed: true`. Never the path (a path can carry a token) and never the cookie.
- Comments: only for an invariant or a non-obvious why (CLAUDE.md §1, last rule). No history.
- Each implementer runs `pnpm format:check` and `pnpm --filter @waitron/server typecheck` before
  committing, plus the focused tests its task names. CI owns the package suites.
- A browser-mode run (Task 6's dashboard test) and the started-server suites in Task 7 start real
  processes: check `memory_pressure | grep free` first and scale to what is free.

## Review Focus

The inputs most likely to refuse a real caller, which is the costly failure here:

1. **The dev apps over HTTPS.** When the box leaf exists as Vite starts, each app's proxy targets
   `https://127.0.0.1:<port>` (`scripts/dev-server-proxy.ts:31-35`) and keeps the browser's `Host`
   (the proxy entries in `apps/dashboard/vite.config.ts:17-22`, `apps/till/vite.config.ts:37-43`
   and `apps/setup/vite.config.ts:18-20` set no `changeOrigin`), and `@hono/node-server` takes the
   scheme from the socket and the host from `Host`
   (`node_modules/.pnpm/@hono+node-server@2.1.5_hono@4.13.16/node_modules/@hono/node-server/dist/index.mjs:599-605`).
   So the browser sends `Origin: http://localhost:5191` (dashboard), `http://localhost:5190`
   (till) or `http://localhost:5192` (setup), and the server sees the same name with `https`. In
   dev every app shares `localhost` and cookies ignore the port, so once someone signs in to the
   dashboard, every till write and setup post carries the management cookie. Expected: taken. The
   dashboard passes through `managementOrigin`; the till and setup pass only through the dev Vite
   origins in the allow-list (`allowed-origins.ts:44-50,58`), present only when `WAITRON_ENV=dev`
   (`dev-setup.ts:152`, `dev-onboard.ts:75`). Pinned by Task 2's "the dashboard on
   `managementOrigin`" case and its dev-mode case (till and setup origins against an `https`
   request URL).
2. **A till page served by another of the venue's servers**, under a shared tenant domain, so the
   browser treats both servers as one site and sends this server's host-only management cookie
   with the till's cross-origin request (`apps/till/src/api/server-router.ts:286-299` sends till
   requests to whichever server is current; `apps/till/src/api/client.ts:4905-4908` sends them
   `credentials: "include"`; `config.tenantDomain` exists so "one credential reaches every one of
   the venue's servers after a promotion", `apps/server/src/config.ts` `tenantDomain`). Expected:
   taken, through the allow-list's membership origins. Task 2's "a page on the advertised origin"
   case proves only that boot consults the allow-list: the advertised origin is answered at
   `allowed-origins.ts:57`, before the membership document is read. A sibling server's
   `contactUrl` origin rests on `allowed-origins.test.ts:22`'s own case; no started-server test
   sends one (a stated gap, in Task 8's limits).
3. **The dashboard's own requests despite its `<meta name="referrer" content="no-referrer">`**
   (`apps/dashboard/index.html:9`). Under that policy a request whose mode is not `cors` sends
   `Origin: null`; a `fetch()` is `cors` mode and keeps its real origin (Fetch spec quote in D3).
   No dashboard code uses a native form submit, `sendBeacon` or a fetch `mode`
   (`grep -rn "sendBeacon\|\.submit()\|requestSubmit\|method=\"post\"\|mode: \"no-cors\"\|mode: \"same-origin\"\|keepalive"`
   over `apps/dashboard/src apps/till/src apps/setup/src packages/ui/src packages/ui-core/src packages/dashboard-kit/src`
   printed nothing, 2026-11-06). Expected: taken. Pinned by Task 9's real-Chromium control,
   since no Node test can show what Chromium sends.
4. **A stale management cookie on the box's own form posts.** The cookie is `path=/`
   (`packages/server-kit/src/management-cookie.ts:11-18`), so it rides every post to the box while
   the browser keeps it. Two of those posts reach the check: `/carry-on` on the waiting page
   (once Task 3 mounts the check on the waiting app) and the setup wizard when setup mode runs
   inside `startServer` (`boot.ts:1340-1398`, on the main app). Expected: taken, because their
   `Origin` is the box's own. Pinned by Task 1's "a form post from the box's own page" case and
   Task 3's carry-on case. The recovery page's start-again post never reaches the check: it is
   served by the recovery listener's own app (D1).
5. **The box reached by IP address or by the Cloud staff hostname.** `Origin` and `Host` both carry
   whatever name the browser used, and the Cloud tunnel splices raw bytes with TLS end to end
   (`packages/tunnel/src/client.ts:1-3`), so `Host` arrives as the browser sent it. Expected: taken.
   Pinned by Task 1's "the box by IP address" case.

---

## Decisions, with receipts

### D1. Where the check lives and how it covers every route

`startServer` builds one middleware, `const ownPageCheck = requireManagementChangeFromOwnPage(...)`,
and mounts it in two places:

- **The main app**, with `app.use("*", ownPageCheck)` directly after
  `app.use("*", buildHeaderMiddleware(build))` (`boot.ts:1309` on `4d1500bbf8`), so its refusals
  carry a request id and it runs before `mountCloudPublic`, discovery, guide pages, every mode's
  routes, the read-only gate (line 2035), the disk-full gates and CORS (line 2229). The full start,
  the restricted start (`restricted-start.ts:28-40` mounts on `deps.app`, the main app) and setup
  mode (`boot.ts:1340-1398`) all register their routes on this app after that line. Routes merged in
  with `app.route()` (the till API, `disk-full-gate.ts:31`) are covered too, because a `use("*")`
  registered first runs ahead of every handler added later.
- **The waiting start's app.** `startWaiting` builds its own app with `healthApp(...)`
  (`waiting-start.ts:90-95`), adds its own handover gate and CORS, mounts the node API,
  `/carry-on`, the waiting page and the peer routes on it, and `boot.ts:1885` serves that app.
  Today none of those routes reads the management cookie (`grep -c 'requireManagementSession\|readManagementSessionToken\|ManagementSession'`
  printed 0 for `peer-status-api.ts`, `node-membership-api.ts`, `node-api.ts` and `waiting-page.ts`;
  `carry-on.ts` signs the person in from a typed password, `carry-on.ts:262-285`, and reads no
  cookie). It still gets the check, through a new `WaitingStartDeps.pageCheck`, so that a
  management route added there later is covered without anyone remembering (Task 3).

Why not per prefix or per route: the management session is read inside each handler, not by a
middleware (`requireManagementSession(c)` is called per route in more than fifty files under
`apps/server/src` and `packages/*/src`; `grep -rn "requireManagementSession("` on 2026-11-06), and
the write routes sit under `/management-api`, `/api`, `/print-api`, `/setup-api`, `/webhooks` and
`/carry-on` (`grep -rhoE "\.(post|put|patch|delete)\(\s*[\`\"]/[a-z0-9_-]+"` over those trees).

Apps that get neither, and why that is safe today: `recovery-surface.ts`, `recovery-start-again.ts`
(mounted on the recovery page), `recovery-listener.ts`'s own surface, `first-setup-entry.ts`,
`first-setup-launch.ts`, `landing-app.ts` and `node-entry.ts`. `serveRecovery` is called only from
`node-entry.ts` (lines 388, 412, 458) and `first-setup-launch.ts:64`, never from `boot.ts`, so the
recovery listener never wraps the main app. None of these files reads the management cookie
(`grep -c 'ManagementSession\|management_session\|MANAGEMENT_COOKIE\|managementSession'` printed 0
for each, 2026-11-06). The CLAUDE.md rule (Task 8) names them as seen by neither the check nor the
sweep.

What the tests catch: Task 2's sweep walks the main app's route table only, and catches a write
route registered on that app AHEAD of the middleware. It cannot see a route on another app (the
middleware refuses a cookie-carrying write to any path, matched or not, so an unregistered path
looks covered). Task 3 walks the waiting app's table the same way. Routes cannot be added after the
first request: Hono's default `SmartRouter` throws "Can not add a route since the matcher is already
built." once it has matched (`node_modules/.pnpm/hono@4.13.16/node_modules/hono/dist/router/smart-router/router.js:10-11,34-36`;
`hono.js:23` makes it the default), so the table read after the start answers `/health` is the
whole table.

### D2. Which requests it judges

Every method except `GET`, `HEAD` and `OPTIONS` (the shape `readOnlyGate` uses, so an unusual
method such as `PROPFIND` is judged too), when it carries a `waitron_management_session` cookie,
any value. `GET`, `HEAD` and `OPTIONS` pass (another page cannot read the answers, and CORS
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

**What a GET from another page can still change.** It is not true that no management GET writes
stored data. A text search of the `GET` handlers in every file that reads the management session
(a script matching insert, update and delete calls and write-named functions in each handler's
text; a search, not an audit) found these, each checked by reading:

- Every authenticated, non-passive GET moves the session's last-seen time
  (`packages/identity/src/management-session.ts:88-93`). So a page on another port can keep a
  signed-in session from going idle while that page stays open in the same browser. It changes no
  venue data. Named as a deliberate limit (Task 8).
- `GET /management-api/google/callback` sets a session cookie (`management-api.ts:831`): the
  Google sign-in's return, a cross-site top-level navigation by design, guarded by its own state
  cookie. Out of scope (sign-in, not a change by a signed-in person).
- `GET /management-api/membership` writes and ends a session row (`management-api.ts:1040-1065`),
  but authenticates by an `x-waitron-peer-credential` header, not the cookie. Another page cannot
  send a custom header without a preflight, and `/management-api/*` has no CORS (CORS is mounted on
  `/api/*` and `/media/*` only, `boot.ts:2229,2231`).
- `GET /management-api/discovered-printers` prunes an in-memory list (`print-api.ts:936-939`), not
  stored data.

The only streaming route is the server-sent events route (`live-api.ts:95-106`); no WebSocket route
exists (`grep -rn "upgradeWebSocket\|WebSocket" apps/server/src packages/*/src --include='*.ts' | grep -v '\.test\.'`
printed nothing, 2026-11-06).

### D3. What counts as the box's own page

Two functions in `own-page.ts`. "Absent" means the header value `=== undefined`. Hono returns `""`
for a header sent empty (a script running `app.request` with `Origin: ""` and
`Sec-Fetch-Site: ""` printed `{"origin":"","site":""}`, 2026-11-06), and `""` counts as present and
foreign, never as absent:

- `sentFromThisOrigin(c)`: true when `Origin` is absent or equals `new URL(c.req.url).origin`, AND
  `Sec-Fetch-Site` is absent, `same-origin` or `none`. This is exactly the test six files already
  copy (D5).
- `sentFromOwnPage(c, trusted)`: true when `sentFromThisOrigin(c)` is true, OR `Origin` is present,
  is neither `""` nor the literal `null` (both are refused without asking `trusted`), differs from
  the request's own origin, and `await trusted(origin)` is true. In that second branch any `Sec-Fetch-Site` is accepted, because a browser correctly calls a
  trusted page on another origin `same-site` or `cross-site`. If `trusted` throws or rejects, the
  request is refused (403 `management.origin_refused`, log param `lookupFailed: true`). The
  middleware runs outside every route's error boundary, and the app sets no `onError`
  (`grep -n "onError" apps/server/src/health.ts` printed nothing; the `onError` lines in `boot.ts`
  are duty callbacks), so an escaping rejection would otherwise answer Hono's bare 500. The lookup
  can reject: `createOriginAllowlist` reads the membership document and lets a failed read reject
  (`allowed-origins.test.ts:164`, "retries the membership read on the next call after a failed one").

Boot passes `trusted = async (origin) => origin === config.managementOrigin || (await allowOrigin(origin))`,
where `allowOrigin` is the CORS allow-list already built at `boot.ts:1289` (`createOriginAllowlist`,
`apps/server/src/allowed-origins.ts`): this server's `advertisedOrigin` (which defaults to
`managementOrigin`, `config.ts:539-541`), every routable venue server's `contactUrl` origin from the
held membership document, and, in dev mode only, the dev Vite origins (`allowed-origins.ts:44-50`
and `:58`; the ports come from `process.env.WAITRON_*_VITE_PORT`, `boot.ts:1293-1297`). Those
origins may already make credentialed cross-origin requests to `/api/*` and read the answers
(`boot.ts:2229`), so refusing their writes here would be inconsistent, and Review Focus 1 and 2
need them.

Consequences, each intended:

- A page on another port of the box's own name is refused unless that port is a trusted origin.
- The box's own origin with `Sec-Fetch-Site: same-site` is refused (a browser contradicting itself).
  This keeps B3 PR 9's tested case "the box's own origin with a same-site fetch"
  (`box-host-api.test.ts:756`).
- `Origin: null`, `Origin: ""` and `Sec-Fetch-Site: ""` are refused.
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

`box_host.origin_refused` is deleted (Task 4): #2501 added it (`git log -S "box_host.origin_refused"`
names only `4d1500bbf8`) as the stopgap for exactly this item, and the shared check now answers
first for every cookie-carrying request to those routes. No dashboard wording exists for it
(`grep -rn "box_host" apps/dashboard/src/i18n/*.ts` printed nothing).

`scripts/errors-reachable.test.ts` does not apply (it checks package barrels under `packages/`,
lines 7-12 and 52-59). `scripts/alert-codes.test.ts` does not apply (no incident is recorded; the
refusal is a log line only).

### D5. Which existing checks fold in, and which stay different on purpose

Fold the predicate (identical behaviour, codes unchanged) in Task 5, replacing each inline copy
with `sentFromThisOrigin(c)`:

| File | Function | Keeps, on purpose |
| --- | --- | --- |
| `box-host-api.ts` | `insecureJoin` (via `fromOtherPage`) | the TLS socket check and `box_network.join_connection_insecure` |
| `backup-recovery-pack-api.ts` | `requireSecurePackRequest` | the TLS check, `recovery.pack_origin_refused`, the JSON check; a recovery pack carries secrets, so it refuses another page even with no cookie |
| `node-operation-https.ts` | `requireNodeOperationHttps` | the TLS check and `authorization.not_permitted` |
| `recovery-start-again.ts` | `fromThisPage` | used on the recovery page, which has no management session and is not behind the shared check |
| `setup-first-fiscal-api.ts` | `assertFirstFiscalRequest` | `setup.owner_required` and the JSON check; setup has no management session |
| `setup-recovery-preparation-api.ts` | `assertOwnerTransport` | the TLS check and `setup.owner_required` |

All six compute the same thing today (read at `box-host-api.ts:138-145`,
`backup-recovery-pack-api.ts:158-166`, `node-operation-https.ts:6-16`,
`recovery-start-again.ts:301-308`, `setup-first-fiscal-api.ts:98-105`,
`setup-recovery-preparation-api.ts:111-122`). Existing tests passing unchanged is not enough proof
on its own: some of these suites never send a foreign `Sec-Fetch-Site`
(`grep -ci "sec-fetch-site"` printed 1 for `setup-recovery-preparation-api.test.ts`, and no file
among `setup-first-fiscal*.test.ts` and `first-fiscal*.test.ts` names it), so a rewrite that drops a
negation could pass. Task 5 proves each site by inverting it.

Remove entirely (Task 4): `box-host-api.ts` `requireOwnPage` and its `app.on("POST", [...])`
mount (lines 168-173, 191-195).

Leave unchanged, stricter than the shared check: `cloud-api.ts:115,151`,
`content-suggestions-api.ts:97`, `content-translations-api.ts:165` and
`venue-zone-repair-api.ts:42-49,69`. They require `Origin` to equal `managementOrigin` exactly, so
they refuse a tool with no `Origin` and the box's own origin when it is not `managementOrigin`.
Loosening or folding them is not this item, and Task 7 keeps their tests pointed at them.

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
host, still holds and stays asserted (Task 4).

### D8. In scope and out of scope

| Caller | How it reaches the box | After this change |
| --- | --- | --- |
| Dashboard on the box (`/manage/`, same origin as the API) | relative `fetch`, `credentials: "include"` (`packages/dashboard-kit/src/request.ts:92-97`; `DashboardApi` default `baseUrl = ""`, `apps/dashboard/src/api/client.ts:2523`) | taken: `Origin` is the request's own |
| Dashboard by IP, by `waitron.local`, by the Cloud staff hostname through the tunnel | same | taken: `Host` and `Origin` carry the same name (Review Focus 5) |
| Dev dashboard on Vite 5191 (and other slots) | Vite proxy for `/api`, `/management-api`, `/media`, `/help` | taken: same origin over an HTTP proxy, or `managementOrigin` over an HTTPS proxy (Review Focus 1) |
| Dev till on Vite 5190 (and other slots), signed in to the dev dashboard in the same browser | Vite proxy for `/api`, `/help`, `/media`; carries the management cookie | taken: same origin over an HTTP proxy, or the dev Vite origins (dev mode only) over an HTTPS proxy (Review Focus 1) |
| Dev setup on Vite 5192 (and other slots), same browser | Vite proxy for `/setup-api` | taken: as for the dev till |
| Till on the box, same origin | relative `fetch` | taken |
| Till on another venue server | cross-origin `fetch` with CORS | taken if it carries the management cookie and the allow-list names that server; untouched if no cookie. Only the allow-list's own unit test sends a sibling's address (Review Focus 2) |
| Setup wizard in setup mode inside `startServer` | same-origin `fetch` on the main app; no management session | untouched, or taken when a stale cookie rides along (Review Focus 4) |
| Waiting page `/carry-on` | same-origin form post on the waiting app; typed password | untouched, or taken when a stale cookie rides along (Task 3) |
| Recovery page, first-setup app | their own apps | never reach the check (D1) |
| Login, passkey and password-reset posts | no session yet | untouched without a cookie; refused from another page with a stale cookie (login forgery is a separate class and not a goal here) |
| Logout `DELETE /management-api/session` | carries the cookie | taken from the box's page; refused from another page |
| Google callback `GET /management-api/google/callback` | cross-site top-level GET | untouched (GET; D2). No POST callback exists (`grep -rn "form_post\|response_mode"` printed nothing) |
| Device and till routes | device and till cookies | untouched unless a management cookie rides along |
| Print agent `/print-api/agent/*`, Stripe `/webhooks/stripe`, box-to-box `/api/node/*`, Cloud | server-side, no management cookie (D2) | untouched |
| Scripts, `waitron.sh`, curl | no cookie, no `Origin` | untouched |
| Landing listener pages (port 80) | `fetch` with `credentials: "omit"` (`connection-bootstrap-page.ts:126`) | untouched |

Left open, for a new backlog entry (Task 8): the till's own cookies (`waitron_till_session`,
`till-session.ts:45-51`, and `waitron_device`, `device-session.ts:60-67`) are `SameSite=Strict`
too, so a page on another port can post to till routes with them. That needs a till-side trusted
set and is not this item.

---

## File structure

- Create `apps/server/src/own-page.ts`: `sentFromThisOrigin`, `sentFromOwnPage`,
  `requireManagementChangeFromOwnPage`. One responsibility: is this request from the box's own page.
- Create `apps/server/src/own-page.test.ts`: the module's unit tests on a bare Hono app.
- Create `apps/server/src/boot.management-origin.test.ts`: the attack, the legitimate callers, the
  dev apps and the route sweep against a started server.
- Modify `apps/server/src/errors.ts`: add `management.origin_refused`; delete
  `box_host.origin_refused`.
- Modify `apps/server/src/boot.ts`: build the middleware once, mount it, hand it to
  `startWaiting`; a test seam `observeApp`.
- Modify `apps/server/src/waiting-start.ts` and `waiting-start.test.ts`: `pageCheck`.
- Modify `apps/server/src/box-host-api.ts` and its three unit test files plus
  `boot.box-host.test.ts`.
- Modify the five other files of D5 (predicate only), and their suites where Task 5 adds a case.
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
    (rejects if `trusted` rejects; the middleware turns that into a refusal)
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
  - `"an empty origin"`: `origin: ""` (log param `origin: ""`, not `null`)
  - `"an empty Sec-Fetch-Site"`: `origin: BOX`, `sec-fetch-site: ""`
  - `"a same-site fetch with no Origin"`: `sec-fetch-site: same-site`
  - `"a cross-site fetch with no Origin"`: `sec-fetch-site: cross-site`
  - `"the box's own origin with a same-site fetch"`: `origin: BOX`, `sec-fetch-site: same-site`
  - `"a trusted-origin lookup that fails"`: `trusted` rejects with an `Error`;
    `origin: "https://till.example.test"`; log params also carry `lookupFailed: true`
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

  Pure-function cases for `sentFromThisOrigin` (true for the three "taken" header sets with no
  trusted origin, false for each "refused" header set), so Task 5's callers have their own pins.

- [ ] **Step 2: Run, and watch it fail** because the module does not exist.
  Run: `pnpm --filter @waitron/server exec vitest run src/own-page.test.ts`
  Expected: FAIL, "Failed to load url ./own-page.js" (or the equivalent import error), no `Tests` count of passes.

- [ ] **Step 3: Implement `own-page.ts`** per D2 and D3, and the `errors.ts` entry. The middleware
  checks the method first, then the cookie, then `await sentFromOwnPage(c, trusted)` inside a
  `try`, refusing with `lookupFailed: true` when it rejects.

- [ ] **Step 4: Run, and see it pass**, then prove the guard by deletion: comment out the
  method test, then the cookie test, then the `null` test, then the `Origin !== own` condition of
  the trusted branch, then the `try`, each alone; each must turn at least one named case red.
  Restore.
  Run: `pnpm --filter @waitron/server exec vitest run src/own-page.test.ts`
  Expected: PASS with a `Tests` count equal to the cases written.

- [ ] **Step 5: Commit** `own-page.ts`, `own-page.test.ts`, `errors.ts`.

### Task 2: Mount it on the main app, and prove the attack is refused

**Files:**
- Modify: `apps/server/src/boot.ts` (build `ownPageCheck` and mount it after line 1309; the seam)
- Create: `apps/server/src/boot.management-origin.test.ts`
- Modify: `apps/server/src/boot.box-host.test.ts:219-243` (expected code)

**Interfaces:**
- Consumes: `requireManagementChangeFromOwnPage`, `TrustedOrigin` from Task 1.
- Produces: `const ownPageCheck: MiddlewareHandler` in `bootServer`, in scope for Task 3's
  `startWaiting` call; `StartServerSeams.observeApp?: (app: Hono) => void`, doc comment "Hands a
  test the main app every route is registered on; production leaves it unset." Called once,
  straight after `healthApp(...)` (`boot.ts:1284`).

- [ ] **Step 1: Write the failing tests** in `boot.management-origin.test.ts`. Copy the
  `withServer`, the `@hono/node-server` mock that keeps `served.fetch`, and `answerOf` from
  `boot.box-host.test.ts:18-131` (useVenueDb with `migrationOptionsFor(manifestSets(), null)`,
  `setupVenue`, one `freePorts` call). Give `withServer` an `env` override parameter. The default
  env adds `WAITRON_ADVERTISED_ORIGIN: "https://till.example.test"`; the default seams are
  `boxHostRequests: fakeHost()`, `requestFromBox: () => false` (so `/api/box/clock-*` do not refuse
  127.0.0.1 as the box itself, `box-health-api.ts:53`, wired at `boot.ts:3186`) and
  `observeApp: (app) => (seen = app)`. `otherPort` is `http://127.0.0.1:<port + 1>`; the manager
  cookie is `venue.managerCookie`.

  Case `"refuses a change from another port of the box's own address, for a signed-in manager"`:
  send each of `POST /api/box/free-space` (no body), `POST /api/box/retire` (no body),
  `POST /api/box/clock-challenge` (no body), `POST /api/box/clock-confirm` and
  `POST /api/box/clock-set` (body `"{}"`), `POST /api/box/screen` (body `{"start":"till"}`),
  `POST /management-api/catalogues` (body `{"name":"From another page"}`), and one route under
  `/print-api` (`POST /print-api/agent/jobs`, no body), each with `cookie`, `origin: otherPort`,
  `sec-fetch-site: same-site`, `content-type: text/plain;charset=UTF-8`. Collect every answer
  into one record keyed by `method path`, then make ONE assertion: `expect(answers).toEqual(<the
  same keys, each { status: 403, body: { error: { code: "management.origin_refused", params: {} } } }>)`,
  so the red run prints every route's actual answer at once. Then assert no catalogue named "From
  another page" exists (read the table through `suite.db`) and the fake host's `screenSet` was
  called 0 times.

  Case `"takes a change from every page that is the box's own"`: `POST /management-api/catalogues`
  with a minimal valid JSON body (take it from an existing `catalogue-api` test's create call) and
  `content-type: application/json`, once per row, each with its own name, expecting 201:
  - `"the box's own page"`: `origin: http://127.0.0.1:<port>`, `sec-fetch-site: same-origin`
  - `"the dashboard on managementOrigin"`: `origin: "http://localhost:5191"` (the default,
    `config.ts:151`), `sec-fetch-site: same-origin`
  - `"a page on the advertised origin"`: `origin: "https://till.example.test"`, `sec-fetch-site: cross-site`
    (proves boot consults the allow-list; Review Focus 2 says what it does not prove)
  - `"a tool sending neither header"`: no `origin`, no `sec-fetch-site`
  - `"a page the person opened themselves"`: own origin, `sec-fetch-site: none`
  Then assert all five catalogues exist.

  Case `"in dev mode, takes the dev till's and setup app's writes through an HTTPS proxy"`: start
  with `WAITRON_ENV: "dev"` (as `boot.backup-recovery-pack.test.ts:148` does). The till and setup
  ports are `process.env.WAITRON_TILL_VITE_PORT || "5190"` and
  `process.env.WAITRON_SETUP_VITE_PORT || "5192"`, because boot reads those variables from the
  process (`boot.ts:1293-1297`) and a developer's shell may set them. For each of the two origins,
  call `served.fetch!(new Request("https://localhost:<port>/api/session", { method: "POST",
  headers }), { incoming: { socket: new Socket() } })` twice: once with headers
  `{ cookie: venue.managerCookie, origin: "http://localhost:<port>", "sec-fetch-site": "same-origin" }`,
  once with the same headers minus the cookie. Expect the two answers to be equal and the first not
  to be 403 `management.origin_refused` (the route answers the same with or without the management
  cookie, so the check took the request). Destroy each socket in a `finally`.

  Case `"refuses the attack on every write route the main app registers"`: once `/health` answers
  200, take `seen.routes`, keep `method` in POST/PUT/PATCH/DELETE, dedupe on `method path`, replace
  each `:name` segment (with any `{…}` pattern) by a fixed UUID and each `*` by `x`, and send each
  with `cookie: "waitron_management_session=" + randomUUID()` (a value that names no session, so a
  route left uncovered refuses for want of a session and changes nothing even before the fix),
  `origin: otherPort`, `sec-fetch-site: same-site` and no body. Collect every `method path` whose
  answer is not 403 `management.origin_refused` and `expect(uncovered).toEqual([])`. Also assert
  the swept list contains `"POST /management-api/catalogues"`, `"POST /api/box/free-space"` and
  `"POST /api/box/screen"`, so a filter that sweeps nothing cannot pass.

  In `boot.box-host.test.ts:239`, change the expected code to `management.origin_refused` (the
  shared check now answers first; the host-call counts at 241-243 stay).

- [ ] **Step 2: Run, and watch them fail.**
  Run: `pnpm --filter @waitron/server exec vitest run src/boot.management-origin.test.ts src/boot.box-host.test.ts`
  Expected: FAIL. The attack case's one `toEqual` prints every route's actual answer (expected by
  reading: 200 for `/api/box/free-space`, 201 for `/management-api/catalogues`, 403
  `box_host.origin_refused` for `/api/box/screen`); copy that whole record into the commit message
  as the before half of the attack. The sweep lists many uncovered routes. The legitimate-callers
  and dev-mode cases pass already (nothing refuses them yet), which is expected.

- [ ] **Step 3: Implement.** Add the seam. In `boot.ts`, directly after the
  `buildHeaderMiddleware` line, build
  `const ownPageCheck = requireManagementChangeFromOwnPage(async (origin) => origin === config.managementOrigin || (await allowOrigin(origin)), log);`
  and `app.use("*", ownPageCheck);`. One comment line above the `use`, the invariant only: it must
  stay ahead of every route so routes added later are covered.

- [ ] **Step 4: Run, and see them pass.** Then prove by deletion: comment out the `app.use` line;
  the attack and sweep cases must fail; restore. Pass `async () => false` as the trusted function
  instead; the "managementOrigin", "advertised origin" and both dev-mode rows must fail; restore.
  Run: the Step 2 command. Expected: PASS, with the `Tests` count printed.

- [ ] **Step 5: Commit** `boot.ts`, `boot.management-origin.test.ts`, `boot.box-host.test.ts`,
  with the before-answers from Step 2 in the message.

### Task 3: Mount it on the waiting start's own app

**Files:**
- Modify: `apps/server/src/waiting-start.ts` (`WaitingStartDeps.pageCheck: MiddlewareHandler`,
  mounted with `app.use("*", deps.pageCheck)` straight after `app.use("*", gate.middleware)`,
  `waiting-start.ts:93-94`)
- Modify: `apps/server/src/boot.ts` (pass `pageCheck: ownPageCheck` in the `startWaiting` call,
  line 1843)
- Modify: `apps/server/src/waiting-start.test.ts` (and any other caller of `startWaiting` the
  typecheck names)

**Interfaces:**
- Consumes: `ownPageCheck` from Task 2; `requireManagementChangeFromOwnPage` from Task 1.
- Produces: `WaitingStartDeps.pageCheck: MiddlewareHandler` (required, so no caller can forget it),
  doc comment "The check that a change carrying the dashboard's sign-in cookie came from the box's
  own page; the full start's, so both apps answer it the same."

- [ ] **Step 1: Write the failing tests** in `waiting-start.test.ts`, using the suite's existing
  `startWaiting` setup (`waiting-start.test.ts:68-90`, which captures the app through `listen`),
  with `pageCheck: requireManagementChangeFromOwnPage(async () => false, () => {})`:
  - `"refuses a carry-on posted from another page while a management cookie rides along"`:
    `POST /carry-on` on the captured app, with a management cookie, `origin: "https://box.test:8443"`,
    `sec-fetch-site: same-site`, a form body; expect 403 `management.origin_refused`.
  - `"takes a carry-on posted from its own page while a stale management cookie rides along"`:
    the same with the request's own origin and `sec-fetch-site: same-origin`; expect the carry-on
    route's own answer (not `management.origin_refused`), the same as without the cookie.
  - `"refuses the attack on every write route the waiting app registers"`: the Task 2 sweep, over
    the captured app's `routes`, through `app.request`.

- [ ] **Step 2: Run, and watch them fail** (a type error for the missing field, or the attack
  answered by the carry-on route).
  Run: `pnpm --filter @waitron/server exec vitest run src/waiting-start.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** the field, the mount and the boot argument.

- [ ] **Step 4: Run** the Step 2 command, plus every suite that starts a waiting box:
  `pnpm --filter @waitron/server exec vitest run src/boot.start-check.test.ts src/waiting-start.test.ts`
  and `pnpm --filter @waitron/server typecheck`. Prove by deletion: comment out the new `use`; the
  attack and sweep cases must fail; restore. Expected: PASS.

- [ ] **Step 5: Commit** `waiting-start.ts`, `waiting-start.test.ts`, `boot.ts`.

### Task 4: Remove B3 PR 9's own page check from the box-host routes

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

### Task 5: One page test in place of six copies, each site proved by inversion

**Files:**
- Modify: `apps/server/src/box-host-api.ts` (`fromOtherPage` deleted; `insecureJoin` uses
  `!sentFromThisOrigin(c)`), `backup-recovery-pack-api.ts`, `node-operation-https.ts`,
  `recovery-start-again.ts`, `setup-first-fiscal-api.ts`, `setup-recovery-preparation-api.ts`
- Modify, only where Step 2 finds no red: the matching suite (named in Step 1)

**Interfaces:**
- Consumes: `sentFromThisOrigin(c: Context): boolean` from Task 1.

- [ ] **Step 1: Name each site's suite and run them unchanged.** The suites:
  `box-host-api.join.test.ts`, `backup-recovery-pack-api.make.test.ts`,
  `node-operation-https.test.ts`, `recovery-start-again.test.ts`,
  `setup-recovery-preparation-api.test.ts`, and for `setup-first-fiscal-api.ts` the files
  `grep -ln "assertFirstFiscalRequest\|setup-first-fiscal-api" apps/server/src/*.test.ts` lists
  (ten on `4d1500bbf8`, among them `setup-first-fiscal.route.test.ts`).
  Run: `pnpm --filter @waitron/server exec vitest run <those files>`. Expected: PASS.

- [ ] **Step 2: Invert each site, one at a time, before folding.** At each of the six sites,
  temporarily make the page test always pass for a foreign `Origin` (delete the `Origin`
  comparison), run that site's suite, then restore and do the same for the `Sec-Fetch-Site`
  comparison. Each inversion must turn at least one case red. Where one does not, add the missing
  case to that site's suite first: one request with a foreign `Origin` (`https://elsewhere.example`)
  and one with `Sec-Fetch-Site: cross-site`, each asserting that site's own refusal code and that
  nothing was written or sent. Watch the new case fail under the inversion, then restore. Record in
  the ledger which sites needed a new case.

- [ ] **Step 3: Fold.** Replace each inline `Origin`/`Sec-Fetch-Site` expression with
  `sentFromThisOrigin(c)` (negated where the site refuses), keeping each file's TLS check, codes and
  JSON or form checks exactly as they are.

- [ ] **Step 4: Invert again, through the shared function.** At each call site, temporarily drop
  the negation (or add one); that site's suite must turn red. Restore. Then run the Step 1 command
  plus any suite Step 2 changed. Expected: PASS. Then
  `grep -rn 'header("Sec-Fetch-Site")\|header("sec-fetch-site")' apps/server/src --include='*.ts' | grep -v test`
  must print only `own-page.ts` and `venue-zone-repair-api.ts` (D5 leaves the latter).

- [ ] **Step 5: Commit** the six files and any suite Step 2 changed.

### Task 6: Dashboard wording for the refusal

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

### Task 7: Started-server suites that send an `Origin`: keep each route's own guard tested

The shared check changes the answer of any started-server test that posts with a management cookie
and an `Origin` that is not the request's own, `managementOrigin` or an allow-listed origin. Unit
tests that mount routes on a bare app do not run it. A local run here is feedback; CI's
`apps/server` shards are the complete check, because the list below is built by a text search that
misses suites building their headers in a helper.

**Files:** whichever tests the run below turns red, and nothing else unless a defect is found.

- [ ] **Step 1: List the suites.**
  Run: `cd /Users/clintongormley/workspace/worktrees/waitron-feat-a1371-management-origin-check/apps/server && /usr/bin/grep -lE "startServer|ephemeralServerFixture|boot-harness" src/*.test.ts | xargs /usr/bin/grep -liE "[\"']?origin[\"']?\s*:"`
  (59 files on `4d1500bbf8`; the number is not a pin).

- [ ] **Step 2: Run them**, at the concurrency the free memory allows (global CLAUDE.md "Test
  concurrency follows measured headroom"), with
  `pnpm --filter @waitron/server exec vitest run <files>`. Read the `Tests` count.

- [ ] **Step 3: Triage each failure by these rules, in order.**
  1. **The test sent a foreign origin and expected success.** Stop. Either the test exercised a
     legitimate caller the plan did not name, or the check is wrong. Write it in the ledger and
     report; do not edit the test.
  2. **The test sent a legitimate caller** (the request's own origin, `managementOrigin`, the
     advertised origin, a venue server's `contactUrl`, the dev Vite origins in dev mode, or no
     headers) **and it is now refused.** A defect in Task 1, 2 or 3: stop and report.
  3. **The test is about the route's own guard** (for example the exact-`managementOrigin` checks
     in `cloud-api.ts:115,151` and `content-suggestions-api.ts:97`, or `recovery.pack_origin_refused`).
     Keep its original assertion and re-point the request so the shared check passes and the
     route's guard still refuses. For an exact-`managementOrigin` guard, send the request's own
     origin (the shared check takes it, the route refuses it). For a `sentFromThisOrigin` guard,
     send `managementOrigin` with `Sec-Fetch-Site: cross-site` (the shared check takes a trusted
     origin with any site value; the route's same-origin test refuses it).
  4. **Only where the route's guard keeps another, independent test** in the same suite may the
     expected code change to `management.origin_refused`, keeping every "nothing changed" assertion.

- [ ] **Step 4: Re-run the failed files** until green. Commit with a message listing each changed
  test and which rule applied.

### Task 8: Docs, the convention line, the backlog

**Files:**
- Modify: `docs/backlog/box.md` (delete the section at lines 732-750; rewrite B3's "Built so far"
  bullet at lines 1137-1145; drop `box_host.origin_refused` from the screen pull request's word
  list at lines 1412-1416; add the left-open entry; add entries under `## Decisions and deliberate
  limits`, line 1531)
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
  request carries the management cookie. Read the whole B3 section and `docs/developers/*.md` for
  any other sentence naming `box_host.origin_refused` or `requireOwnPage`
  (`grep -rn "box_host.origin_refused\|requireOwnPage" docs CLAUDE.md`, ignoring
  `docs/superpowers/`, which is historical).

- [ ] **Step 2: Decisions and deliberate limits** in `docs/backlog/box.md` (line 1531), one entry
  each, dated 2026-11-06 and naming A1371:
  - The check judges the cookie's presence, not a live session (D2's receipt).
  - `GET`, `HEAD` and `OPTIONS` are not checked; a `GET` from another page still moves the
    session's last-seen time, and the Google callback is a cross-site sign-in by design (D2's list
    and its WebSocket grep).
  - The exact-`managementOrigin` checks in `cloud-api.ts`, `content-suggestions-api.ts`,
    `content-translations-api.ts` and `venue-zone-repair-api.ts` are left stricter than the shared
    check (D5).
  - A sibling venue server's `contactUrl` origin is trusted through the allow-list, and only the
    allow-list's own unit test sends one (Review Focus 2).

- [ ] **Step 3: Convention.** CLAUDE.md §3, one entry:
  "**A change that carries the dashboard's sign-in cookie is checked for the page that sent it, by
  `requireManagementChangeFromOwnPage`, which `startServer` mounts ahead of every route on its main
  app and on the waiting start's app; a new route on either needs nothing, and must not be
  registered ahead of it.** Cost: a page on another port of the box's name could change the start
  screen (B3 PR 9's review). Guards: the sweeps in `apps/server/src/boot.management-origin.test.ts`
  and `waiting-start.test.ts`, weaker than their names: one attack shape; each reads only its own
  app's route table and only the routes the harness's modules and configuration mount; the recovery
  listener's and first-setup's separate apps are seen by neither the check nor the sweeps.
  [Receipt](docs/developers/conventions-data.md#a-change-carrying-the-dashboards-sign-in-cookie-is-checked-for-the-page-that-sent-it)."
  The topic section holds D1's coverage and limits, D2, D3's rule and its Fetch quotes, the trusted
  set, the stricter checks D5 leaves, and the till gap.

- [ ] **Step 4: Check.**
  Run: `pnpm exec vitest run scripts/claude-md-pointers.test.ts && pnpm exec prettier --check CLAUDE.md && pnpm format:check`
  Expected: each exits 0 (check each status; `docs/` is prettier-ignored, so
  `pnpm exec prettier --file-info docs/backlog.md` printing `"ignored": true` is expected).

- [ ] **Step 5: Commit** the four files.

### Task 9: The attack in real Chromium, after the change, with controls

Not committed; the result goes in the PR description. Node tests set the headers themselves, so
only a browser shows what Chromium actually sends (Review Focus 3).

- [ ] **Step 1:** Start the dev stack: `wa-wt demo waitron-feat-a1371-management-origin-check`
  (`wa-wt ls` for its ports; slot 1 is till 5190, dashboard 5191, server 8080). Record whether the
  Vite proxies speak HTTPS: they do when `<state>/tls/server.crt` and `server.key` existed as Vite
  started (`scripts/dev-server-proxy.ts:27-35`; `<state>` is the `WAITRON_STATE_DIR` `wa-wt`
  passes, `$HOME/workspace/.waitron-dev/box` on slot 1). This decides which branch of D3 the
  controls exercise: an HTTP proxy takes them as the request's own origin, an HTTPS proxy through
  `managementOrigin` (dashboard) or the dev Vite origins (till). Stop only the stack you started
  (`wa-wt down <name>`).
- [ ] **Step 2:** In a scratch directory from `mktemp -d`, write `attack.html` that runs
  `fetch("http://localhost:5191/management-api/catalogues", { method: "POST", mode: "no-cors", credentials: "include", headers: { "content-type": "text/plain" }, body: JSON.stringify({ name: "Chromium attack" }) })`,
  and serve it with `python3 -m http.server 8099` from that directory (8099 is not a dev Vite
  port, so it is not trusted, D3). Record its process id.
- [ ] **Step 3:** With the workspace's Playwright Chromium, sign in to
  `http://localhost:5191/manage/` as `owner@demo.waitron.local` / `dashPass123`, then open
  `http://localhost:8099/attack.html` in the same context. Expected: no catalogue named "Chromium
  attack" (read it through the dashboard's menus list or `GET /management-api/catalogues` from the
  dashboard tab), and the server log (`wa-wt logs <name>`) shows `management.origin_refused` with
  `origin: "http://localhost:8099"` and `site: "same-site"`. If the log shows no line at all, the
  cookie did not ride along and the run proves nothing: say so instead of reporting a pass.
- [ ] **Step 4 (dashboard control):** From the dashboard tab, `page.evaluate` the same `fetch` with
  `mode: "cors"`, `content-type: application/json` and name "Chromium control". Expected: a 201 and
  the catalogue listed. This is the case that would fail if the dashboard's `no-referrer` policy
  made Chromium send `Origin: null` (Review Focus 3).
- [ ] **Step 5 (till control):** In the same context (so the management cookie rides along), open
  the dev till at `http://localhost:5190`, let it enrol itself, and sign in with PIN 5555 (a
  `POST /api/session` through the till's proxy). Expected: the sign-in succeeds and the server log
  shows no `management.origin_refused` for it.
- [ ] **Step 6:** Stop the stack and the `http.server` by the process ids you recorded. Put the
  results, the log lines and the Step 1 proxy branch in the ledger for the PR description.

---

## After the tasks

Run `/finish-branch` with the worktree path and a note naming this plan: the full wave (risk
trigger: auth), the Codex run-it seat as two reviews side by side. Then announce readiness to land.

## Review fold (2026-11-06)

What the fresh-context plan review changed, one line each:

- I1: the waiting start serves its own app (`waiting-start.ts:90-95`, served at `boot.ts:1885`), and
  `serveRecovery` never wraps the main app; D1 is rewritten, new Task 3 mounts the check on the
  waiting app, Review Focus 4 and the CLAUDE.md hedge are corrected.
- I2: dev till and dev setup rows in D8 and Review Focus 1, a dev-mode case in Task 2, a till
  sign-in in Task 9.
- I3: Task 7's triage keeps each route's own guard tested and stops on a foreign origin that
  expected success; CI's shards are named as the complete check.
- I4: Task 5 inverts each fold site before and after folding, adding cases where no test turns red.
- Minor 5: Review Focus 2 says the advertised-origin case proves only the allow-list wiring; the
  sibling-server gap is stated and recorded as a deliberate limit.
- Minor 6: "absent" means `=== undefined`; empty headers are refused, with cases.
- Minor 7: a failing trusted-origin lookup refuses with 403, with a case.
- Minor 8: the sweep's limits (main app only, any-path refusal, harness modules) are stated, and
  the "after boot" wording is gone (Hono refuses new routes after the first match).
- Minor 9: the attack case collects every answer and makes one assertion.
- Minor 10: D2 lists the GETs that still write (the session's last-seen time, the Google callback;
  the membership GET authenticates by header), and the limit goes in Decisions.
- Minor 11: Task 9 records which proxy branch its controls ran.
- Minor 12: Task 8 drops `box_host.origin_refused` from box.md 1412-1416 and adds the Decisions
  entries.

# Plan — cloud-mirror C2a/C2b hardening follow-ups

**Date:** 2026-08-29
**Branch:** `feat/cloud-mirror-hardening-followups`

Four deferred follow-ups from the landed cloud-mirror work (C2a #155, C2b #162), all
foundation-free hardening of the mirror deployment/adopt surface. Recorded in `docs/backlog.md`
(the "Deferred" blocks under C2a and C2b). The other C2a/C2b deferrals — mirror fidelity
(config replication) and the first-contact trust bootstrap — are **out of scope** here by owner
decision (2026-08-29): they are gated on unbuilt foundations.

Source assessments: the three exploration reports summarised in the session that produced this
plan. Specs:
`docs/superpowers/specs/2026-08-28-sync-cloud-mirror-c2a-mirror-server-design.md`,
`docs/superpowers/specs/2026-08-29-sync-cloud-mirror-c2b-operator-flow-design.md`.

## Global Constraints

- **No backwards-compat / data-migration code** — pre-production (CLAUDE.md §3). Schema/env
  changes are clean; no backfill.
- **Error codes name the DOMAIN CONCEPT, not the throwing package** (CLAUDE.md §3). Before adding
  any code, grep the siblings in `apps/server/src/errors.ts` and match the existing shape. Every
  file that throws a code imports its registry (`import "./errors.js"`). Codes are never renamed
  once shipped — get it right the first time.
- **TDD** — failing test first, watch it fail, minimal implementation (CLAUDE.md, user pref).
- **Never widen a grant / never weaken a fiscal or tenancy invariant** to make a test pass.
- **The verify step for every task runs, from the package dir:**
  `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test:coverage` (coverage, not `test`).
  `apps/server` and `packages/provisioning` both carry the 98/98/98/95 thresholds.
- **Real Postgres vs PGlite** (CLAUDE.md §4): these tasks are mostly config/boot/HTTP wiring. Use
  the lightest target that exercises the behaviour; a booted-server assertion (the existing
  `boot.*.test.ts` harness) is the right level for the mount/bind/gate tasks. Say why in a comment
  where the choice is non-obvious.
- **`TESTCONTAINERS_RYUK_DISABLED=true`** for any real-PG suite locally.

## Rulings made in this plan (carried into dispatches)

1. **Task 1 fails loud at ADOPT, not at reboot.** An adopted mirror MUST end up with
   `WAITRON_SYNC_DATABASE_URL` in `trading.env`; if the deploy-level env lacks it at adopt time,
   adopt throws (fail-closed) rather than persisting nothing and letting the reboot fail with
   `server.config_missing`. Cost if wrong: adopt refuses in an env that could have supplied the URL
   only at reboot — but a mirror MUST pull, so requiring it at the one interactive moment the
   operator can fix it is strictly the better failure mode.
2. **Task 2 SSRF policy:** allow `https:` to any host; allow `http:`/`https:` to a **loopback**
   host only (`127.0.0.0/8`, `::1`, `localhost`) — the localhost stand-in; reject every other
   scheme and any non-loopback literal IP in private/link-local/carrier ranges (notably the
   `169.254.169.254` cloud-metadata address). Cost if wrong: too strict blocks an http non-loopback
   primary — but real hosting uses `https:` + public-CA, so no real target is excluded.
3. **Task 3 opt-in escape hatch:** a mirror bound to a non-loopback host is refused at boot unless
   an explicit env acknowledgement is set. This is a deliberate forced acknowledgement, not a
   default. Cost if wrong: an intentionally-exposed mirror deployment must set one env var.
4. **Task 4 scope:** the operational agent/device groups (`mountPrintApi`, `mountDeviceApi`, and any
   kitchen-station group with an operational write-GET) are NOT mounted under `mode='mirror'`. A
   read-only cloud mirror has no printers/devices, so the guarantee rests on the gate, not on the
   backing tables being unsynced. Cost if wrong: a mirror 404s an operational route it never needs.

---

## Task 1 — Persist `WAITRON_SYNC_DATABASE_URL` through adopt into `trading.env`

**Problem.** `writeTradingEnv` (`apps/server/src/trading-config.ts:28-42`) emits the five
`WAITRON_TILL_*_ID`, `DATABASE_URL`, `WAITRON_MIGRATIONS_DATABASE_URL`, `WAITRON_ENV` — but **not**
`WAITRON_SYNC_DATABASE_URL`. A wizard-adopted mirror reboots into the trading branch, calls
`loadMirrorSyncConfig(env)` (`config.ts:420-436`), which does
`required(env, "WAITRON_SYNC_DATABASE_URL")` and throws `server.config_missing` — so the adopted
mirror never boots into mirror mode. This is the flagged *most material* C2b gap.

**Current shape.**
- `TradingConfig` interface + `writeTradingEnv`: `apps/server/src/trading-config.ts:11-42`.
- `AdoptDeps` (carries `databaseUrl`, `migrationsDatabaseUrl`; no sync url):
  `apps/server/src/adopt.ts:31-51`. `adoptFromPrimary`'s `persistTrading({...})` call:
  `adopt.ts:87-98`.
- Setup-boot env reads: `loadConfig` reads `DATABASE_URL` (`config.ts:563`) and
  `WAITRON_MIGRATIONS_DATABASE_URL` (`config.ts:564`) into `ServerConfig`. `ServerConfig` shape:
  `config.ts:~20-100`. `WAITRON_SYNC_DATABASE_URL` is NOT in `ServerConfig` today (read only lazily
  by `loadMirrorSyncConfig` in the trading branch).
- Boot wires `AdoptDeps` from `config.databaseUrl`/`config.migrationsDatabaseUrl`:
  `apps/server/src/boot.ts:573-584` (inside `mountSetup`'s `adopt` closure).

**Change.**
1. Add `syncDatabaseUrl: string` to `TradingConfig` (`trading-config.ts`) and emit
   `WAITRON_SYNC_DATABASE_URL: cfg.syncDatabaseUrl` in `writeTradingEnv`'s `formatEnvFile` map.
   Update the interface doc-comment to name it.
2. Add `syncDatabaseUrl: string` to `AdoptDeps` (`adopt.ts`), and pass
   `syncDatabaseUrl: deps.syncDatabaseUrl` in the `persistTrading({...})` call.
3. Read `WAITRON_SYNC_DATABASE_URL` at setup boot in `loadConfig` and expose it on `ServerConfig`
   (e.g. `syncDatabaseUrl?: string`). It is **optional at setup boot** (a primary provision path
   does not need it there), so read it with `isUnset`, not `required`.
4. Wire it in `boot.ts:573-584`: pass `syncDatabaseUrl` into the `adopt` closure's `AdoptDeps`.
   Per **Ruling 1**, the adopt closure must fail loud when it is absent: throw
   `server.config_missing` (`{ variable: "WAITRON_SYNC_DATABASE_URL" }`) BEFORE running the adopt
   orchestration if `config.syncDatabaseUrl` is unset. (Reuse the existing `required`/error shape;
   do not invent a new code — `server.config_missing` is exactly this fact.)

**Tests (TDD).**
- `trading-config.test.ts`: `writeTradingEnv` emits `WAITRON_SYNC_DATABASE_URL=<value>`. Update the
  existing assertion that pins the emitted key set (find it; it likely enumerates the keys — add the
  new one, do not loosen it).
- `adopt.test.ts` (or the orchestrator test): `adoptFromPrimary` threads `syncDatabaseUrl` into the
  `persistTrading` args. Assert the persisted `TradingConfig` includes it.
- A boot/adopt test proving the fail-loud path: adopt with `WAITRON_SYNC_DATABASE_URL` unset throws
  `server.config_missing` naming that variable. Prove the guard by deletion.
- Config test: `loadConfig` reads `WAITRON_SYNC_DATABASE_URL` into `ServerConfig` when set, leaves
  it unset otherwise.

**Files:** `apps/server/src/trading-config.ts`, `apps/server/src/adopt.ts`,
`apps/server/src/config.ts`, `apps/server/src/boot.ts`, + their tests. `apps/server` only.

**Size:** Small.

---

## Task 2 — SSRF guard on the operator-supplied `primaryUrl`

**Problem.** `POST /setup-api/adopt` validates `primaryUrl` only as a non-empty string
(`apps/server/src/setup-api.ts:432`, `asString(body.primaryUrl, "primaryUrl")`), which flows
unmodified into `fetchMirrorBundle` (`apps/server/src/mirror-bundle-fetch.ts:25-55`) where the URL
is built by raw concat and fetched directly — no `new URL()` parse, no scheme allowlist, no
private-IP guard. setup-api is unauthenticated (mounted only in setup mode). So anyone who can reach
a mirror-in-setup can drive it to POST an admin credential body to any operator-chosen URL
(including `http://169.254.169.254/…`).

**Change (per Ruling 2).** Add a self-contained validator (a new small module, e.g.
`apps/server/src/primary-url.ts`, exporting `assertSafePrimaryUrl(raw: string): URL`) that:
- parses with `new URL(raw)` (throw on unparseable);
- accepts scheme `https:` to any host;
- accepts scheme `http:`/`https:` only when the host is loopback (`127.0.0.0/8`, `::1`,
  `localhost`);
- rejects every other scheme, and rejects a non-loopback host that is a literal IP in a
  private/link-local/carrier-grade/metadata range (`10/8`, `172.16/12`, `192.168/16`,
  `169.254/16`, `fc00::/7`, `::1` already covered by loopback allow, etc.);
- throws a single domain error on rejection. **Grep `errors.ts` for the right domain concept** —
  this is about the adopt/primary URL, not about "setup" the process. A candidate is
  `adopt.primary_url_invalid` or `mirror.primary_url_invalid` — match the sibling shape (the
  `mirror.*` / `adopt.*` families already exist; check which and follow it). Register it and
  `import "./errors.js"` in the throwing file.

Apply the validator at the setup-api handler (`setup-api.ts` where `primaryUrl` is read, ~432) so a
bad URL is refused before any fetch, AND (defense in depth) keep `fetchMirrorBundle` building its URL
from the returned parsed `URL` object rather than re-concatenating the raw string. Prefer validating
once at the boundary and passing the validated value forward.

**Tests (TDD).** A table of URLs → allowed/rejected: `https://primary.example` (allow),
`http://127.0.0.1:3000` (allow), `http://localhost` (allow), `http://169.254.169.254/latest` (reject),
`http://10.0.0.5` (reject), `http://192.168.1.1` (reject), `http://primary.example` (reject — http
non-loopback), `file:///etc/passwd` (reject), `ftp://x` (reject), `not-a-url` (reject). Assert the
thrown code. A setup-api-level test that a rejected `primaryUrl` returns the error without any
fetch attempt (stub `fetchBundle`, assert it was not called). Prove by deletion.

**Files:** new `apps/server/src/primary-url.ts` (+ test), `apps/server/src/setup-api.ts`,
`apps/server/src/mirror-bundle-fetch.ts`, `apps/server/src/errors.ts`. `apps/server` only.

**Size:** Small.

---

## Task 3 — Refuse a non-loopback bind under `mode='mirror'` without explicit opt-in

**Problem.** A mirror serves the dashboard **unauthenticated** — `ensureMirrorViewer` seeds a
full-`admin` viewer and `mirrorSession` auto-injects its cookie (`apps/server/src/mirror-session.ts`,
wired at `boot.ts:697-712`). The only thing keeping that unauthenticated admin surface off the
network is that the server binds to `config.httpHost`, default `127.0.0.1` (`config.ts:162`, from
`WAITRON_HTTP_HOST`, `config.ts:565,594`). Setting `WAITRON_HTTP_HOST=0.0.0.0` exposes it with no
auth. There is no guard. (Real per-user auth/TLS is the hosting slice and is NOT in scope; this is
the fail-closed stopgap the backlog mandates: "MUST be network-gated before any reachable
deployment".)

**Change (per Ruling 3).** After `isMirror` is resolved (`boot.ts:687`) and BEFORE the `serve()`
bind (`boot.ts:258-267` / wherever the trading branch listens), if `isMirror` and `config.httpHost`
is not loopback and an explicit opt-in env is not set, throw a fail-closed boot error naming the
unsafe host. Loopback = `127.0.0.0/8`, `::1`, `localhost`.
- **Opt-in env:** `WAITRON_MIRROR_ALLOW_EXPOSED` (truthy). Grep for an existing boolean-env
  convention in `config.ts` (there is a truthy/`isUnset` pattern) and match it. Document at the
  read site that this only silences the guard and that real per-user auth/TLS is still owed
  (hosting slice).
- **Error code:** a process-fact — the server refuses to bind. `server.*` is for facts about the
  process (CLAUDE.md §3). Grep `apps/server/src/errors.ts` for the closest sibling; a candidate is
  `server.mirror_bind_exposed`. Match the sibling shape, register, `import "./errors.js"`.

**Tests (TDD).** Unit the loopback classifier (`127.0.0.1`, `127.5.5.5`, `::1`, `localhost` → safe;
`0.0.0.0`, `::`, `10.0.0.1`, a hostname → not safe). A booted/boot-path test: `mode='mirror'` +
`httpHost` non-loopback + no opt-in → throws the code; + opt-in set → boots. `mode='primary'` +
non-loopback → boots (guard is mirror-only). Prove by deletion.

**Files:** `apps/server/src/config.ts` and/or `apps/server/src/boot.ts`,
`apps/server/src/errors.ts`, + tests. `apps/server` only. Reuse the loopback classifier from Task 2
if Task 2 landed one that fits — otherwise a small shared helper; do not duplicate the range logic
(if both tasks need it, factor one classifier and have both import it — note this cross-task reuse
in the dispatch).

**Size:** Small.

---

## Task 4 — Do not mount operational agent/device groups under `mode='mirror'`

**Problem.** The read-only gate (`apps/server/src/read-only-gate.ts:31-39`) refuses non-GET methods
under mirror mode, but it gates the HTTP verb, not the SQL. `GET /print-api/agent/jobs`
(`apps/server/src/print-api.ts:269-295`) runs `claimPrintJobs`
(`packages/printing/src/runtime.ts:140`), a locking UPDATE — a write behind a GET. It is inert on a
mirror today **only** because `print_agents`/`print_jobs`/`devices` are not synced/provisioned, so
the agent 401s before the write. The gate's own comment (`read-only-gate.ts:6-18`) says a later
slice that syncs/provisions those tables MUST revisit this. Make the read-only guarantee rest on the
gate now.

**Change (per Ruling 4).** In the trading branch of `boot.ts`, do NOT mount the operational
agent/device groups when `isMirror`:
- `mountPrintApi(app, …)` — `boot.ts:821`
- `mountDeviceApi(app, …)` — `boot.ts:810`
- any kitchen-station group that exposes an operational write-GET (audit — grep the mounts and the
  route files for a `app.get(` whose handler calls `update(`/`insert(`/`delete(` or a `claim*`
  helper). The management/catalogue/report/me groups are dashboard reads and stay mounted; internal
  session-keepalive writes inside a GET are acceptable (the gate comment says so) — the target is
  *operational* writes like `claimPrintJobs`.

Guard the mounts with `if (!isMirror) { … }`. Add a doc-comment at the guard citing the write-GET
reason and the `read-only-gate.ts` comment.

**Tests (TDD).** A booted-server test (the existing `boot.*.test.ts` harness): a mirror-mode server
returns 404 for `GET /print-api/agent/jobs` (route not mounted), while a primary-mode server mounts
it (assert non-404 — 401/whatever the auth returns, i.e. the route exists). Same for the device
group's agent route. Prove by deletion (remove the `if (!isMirror)` guard → the mirror test that
expects 404 fails).

Confirm no cross-cutting guard (the fiscal `inmutabilidad` suite, etc.) depends on those routes
being mounted on a mirror.

**Files:** `apps/server/src/boot.ts` + boot test. `apps/server` only.

**Size:** Small.

---

## Sequencing

Tasks 1, 3, 4 all touch `boot.ts`; Task 2 is largely independent. Dispatch sequentially (never
parallel implementers). Suggested order: **1 → 2 → 3 → 4**. Task 3 may reuse Task 2's loopback
classifier — dispatch Task 3 with a pointer to whatever Task 2 landed.

## Out of scope (owner decision 2026-08-29)

- C2b #3 mirror fidelity (nulled `catalogue_id`/`receipt_printer_id`) — the nulling is deliberately
  correct; restoring needs config replication. Deferred.
- C2b #4 first-contact trust bootstrap — gated on real hosting; constraint already recorded in
  `mirror-bundle-fetch.ts`. Deferred.
- The promote action (mirror→primary) — gated on reserved-SIF staging. A separate branch does the
  foundation-free promotion #158 re-gating only.

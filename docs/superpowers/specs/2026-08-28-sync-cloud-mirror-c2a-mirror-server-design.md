# Sync cloud-mirror — sub-project C2a: the mirror-mode server (the mechanism)

**Status:** design, awaiting owner review · **Date:** 2026-08-28 · **Branch:** `feat/sync-cloud-mirror-c2a-mirror-server`

## 0. Where this sits

"Build the sync cloud-mirror peer" (backlog top-tier #2) is three subsystems, proven against a
**local stand-in cloud** (no real hosting, DNS or TLS yet — none exists):

- **A — Peer identity & auth. LANDED (#144).** Each subscriber has its own DB-backed identity and a
  per-peer scrypt bearer token; the source derives `subscriberId` from the token
  ([spec](2026-08-27-sync-cloud-mirror-peer-identity-design.md)).
- **B — Outbound tunnel. LANDED (#150).** The box dials outbound; the cloud's pull rides back down a
  blind byte-splice relay, TLS end-to-end. `@waitron/tunnel` + a cloud-side `tunnelHttpClient`
  ([spec](2026-08-27-sync-cloud-mirror-tunnel-design.md)).
- **C — Cloud read-mirror.** A "mirror mode" of `apps/server` that pulls + applies into its own
  Postgres and serves the dashboard read-only. Split (owner, 2026-08-27) into **C1 (LANDED #153)** and
  **C2**. C1 enrolled `dining_tables` and its runtime-mutable FK closure into the ordered lane
  ([spec](2026-08-27-sync-cloud-mirror-c1-enrolment-design.md)).

C2 splits again, at the owner's decision (2026-08-28), because provisioning a mirror with
**matching identity** and building the **setup-wizard flow** is a self-contained slice on top of the
runtime mechanism:

- **C2a — the mirror-mode server mechanism (THIS spec).** The third boot path, the runtime
  read-only mode gate, the pull-through-tunnel + apply wiring, the unauthenticated read-only dashboard,
  and the primary-only workers the mirror does **not** run. Proven **end-to-end** against a second
  local Postgres + a reader on another port, with the mirror's **matching identity and connection
  details supplied by env/hand** (there is no wizard yet).
- **C2b — the operator flow (later).** The primary emits a **"mirror bundle"** (the primary's five
  identity ids + its CA + a minted per-peer sync token + relay coords); the setup wizard gains a
  **primary/mirror** choice whose mirror path consumes the bundle, runs an **"adopt existing venue"**
  provisioning (matching ids, **no `registerSif`**), and stores the connection config in the DB. Its
  own spec → plan → build.

This spec is **only C2a**. C2b and everything past it is out of scope (§11).

## 1. The scenario, in plain terms

A restaurant runs a box on the premises — the **primary**. Offsite, in the cloud, we keep a
**mirror**: a second Waitron process, holding the **same venue** (same tenant/location/node/till/series
ids), that continuously **pulls** the primary's committed rows through B's tunnel and **applies** them
into its **own** Postgres. The mirror is a disaster-recovery copy: if the box is lost, the owner can
still **see** the venue's data through the mirror's dashboard, and (a later slice) **promote** the
mirror to become the new primary.

C2a builds the running mirror: a process that, told "you are a mirror," pulls + applies + serves the
dashboard **read-only** and refuses every write, while never doing any of the things only a primary
does (originating sales, filing fiscal, serving other subscribers). It is **provable today** against a
second local Postgres and a reader on another port — the same "local stand-in cloud" A/B/C1 were
proven against.

## 2. Locked decisions (owner answers, 2026-08-28)

1. **Mode is a runtime-read flag, not a boot-time partition.** A mirror can be **promoted to primary
   later without a restart** (owner), so "am I a mirror?" is read at runtime (cached, refreshed), and
   promotion is a flag flip — not a re-mount of routes or a process restart. C2a builds the flag and
   the gate; the **promote action itself is deferred** (§10).
2. **The flag lives on `deployment`, not `nodes`.** `deployment` is the per-database singleton stamp
   ("what is this database"), never synced, already read at boot. A mirror **copies** the primary's
   `nodes` row (same `node_id`, for FK resolution), so a per-node `role` would sit on a copied row and
   read confusingly; and `nodes.role` is reserved for the *active-active/failover* concept the table
   comment names ([nodes.ts:6-8](../../../packages/db/src/schema/nodes.ts)), a different, later thing.
   New column **`deployment.mode` ∈ {`primary`, `mirror`}**, default `primary` (§3).
3. **Writes are refused at runtime by a method gate, not a read-only DB role.** A SELECT-only serving
   role fights the `asAppUser` pattern every gated read already uses (each read route runs under
   `withTenant` + `asAppUser`), and would need cross-cutting surgery; a middleware that refuses non-GET
   when `deployment.mode = mirror` is one chokepoint, promotion-ready, and touches no route.
4. **The dashboard is served unauthenticated in v1** — a boot-seeded read-only viewer session, so the
   existing `requireManagementSession`/`authorizeManager` gates pass unchanged. Real per-user auth
   defers to the real-cloud-hosting slice (which brings DNS/TLS/access control — none of which exists).
5. **The mirror mounts the same user-facing route surface a trading primary mounts** — the till +
   dashboard API mounts — with the write gate in front (owner). Promotion becomes a pure flag-flip of
   the whole HTTP layer, and it reuses the exact boot mount sequence rather than duplicating a curated
   read subset. The sync-api **source** and the transport workers are config-gated separately and are
   **not** part of this surface — a mirror is a subscriber, not a source (§8).
6. **v1 = single-tenant DR mirror**, matching A/B/C1. The multi-tenant whole-log reader and the
   fiscal/hash-chain lane stay deferred.

## 3. `deployment.mode` — the runtime mode flag

`deployment` is a singleton (`CHECK id = 1`) carrying `environment` and `stamped_at`
([deployment.ts:19-27](../../../packages/db/src/schema/deployment.ts)), read by
`readDeploymentEnvironment` and written by `stampDeployment`
([packages/db/src/deployment.ts:35,54](../../../packages/db/src/deployment.ts)). It is deliberately
**out of the schema barrel**, with accessors exported from the package barrel instead
(deployment.ts:6-17), and it carries **no RLS** and **no `tenant_id`** (a whole-database operational
record) — so, like `sync_cursor`, it is out of the fiscal `inmutabilidad` FORCE-RLS scan by
construction, and plain object grants are its whole mechanism.

- **Schema:** add `mode text NOT NULL DEFAULT 'primary'` with a
  `CHECK (mode IN ('primary','mirror'))`, in a new hand-written custom migration
  `packages/db/drizzle/00XX_deployment_mode.sql` (drizzle-kit models no grants; the deployment table's
  migrations are already hand-written). **Pre-production, so no backfill** (CLAUDE.md §3): the default
  makes every existing deployment `primary`, which is exactly today's behaviour, so every existing boot
  is unchanged.
- **Read accessor:** `readDeploymentMode(db) → 'primary' | 'mirror'` beside `readDeploymentEnvironment`
  — the `to_regclass` guard the sibling uses, defaulting to `primary` when the table/row is absent (an
  unstamped DB is a primary, never a mirror).
- **Grants:** the app pool needs `SELECT (mode)` — covered by the existing table-wide
  `GRANT SELECT ON deployment TO app_user` ([0010_deployment_stamp.sql:18](../../../packages/db/drizzle/0010_deployment_stamp.sql)),
  so **no new grant**. Writing `mode` (stamping a mirror, and later promotion) is an **owner-role**
  write — the same role that runs `stampDeployment` at provision — never `app_user` (which holds no
  INSERT/UPDATE on `deployment`; the read-back test asserts this negative).

**How the mirror's `mode` gets set in C2a:** by the same owner-connection write that stamps the
environment. C2a does **not** build the wizard, so its tests and its hand-provisioned mirror stamp
`mode = 'mirror'` directly (a `stampDeployment`-adjacent helper). C2b wires it into "adopt venue".
The deferred promote action is a single owner-role `UPDATE deployment SET mode = 'primary'` (§10).

## 4. Boot — the third path, nested inside trading

Boot decides mode in two nested steps, and **only the inner one is new**:

- **Setup vs trading (unchanged).** `config.till === undefined` → setup mode; else trading
  ([boot.ts:441](../../../apps/server/src/boot.ts)). A mirror holds the primary's five
  `WAITRON_TILL_*_ID` (its matching identity), so `config.till` is **set** → it takes the **trading**
  branch, exactly like a primary.
- **Primary vs mirror (new).** Inside the trading branch — after the app pool is open
  ([boot.ts:432](../../../apps/server/src/boot.ts)) — read `readDeploymentMode(db)`. `primary` → the
  wiring exactly as today. `mirror` → the mirror wiring below. The pool is already open at this point
  (the trading branch reads `readOrderFlow` from it too), so the DB read is free.

The mirror wiring differs from the primary's in exactly four ways, everything else identical:

1. **Install the read-only gate middleware first** (§5), so it fronts every route mounted after it.
2. **Install the ambient-session middleware** (§6), so the dashboard's gated reads see a viewer.
3. **Start the pull-through-tunnel + apply worker** (§7) — the mirror pulls only from its primary
   through the tunnel — and **do not** start the primary-only workers (§8).
4. **Serve the dashboard SPA** (`dashboardAppDir`), **not** the till/setup SPAs — same as a primary
   that only sets `dashboardAppDir`.

The **user-facing** mount sequence is reused verbatim (decision 5): the mirror calls the same till +
dashboard `mount*` functions the primary does, in the same order. It does **not** call `mountSyncApi`
(the source) — a mirror is a subscriber, not a source (§8). It is the two middlewares and the worker
set that differ, not the user-facing routes.

## 5. The read-only write gate

A Hono middleware installed at the top of the mirror's app, before any route:

- When `deployment.mode = mirror`, a request whose method is **not** `GET`/`HEAD`/`OPTIONS` is
  refused with **`node.read_only` → 403**, before it reaches any handler. `GET`/`HEAD` pass through.
- The mode is read **once at boot** into a small holder the middleware closes over, and the holder is
  **refreshable** (a `getMode()` seam) so a future promotion flips it live without a restart
  (decision 1). C2a wires the holder to boot's single read; the refresh trigger is the promote
  action's job (§10).

**Why method-based.** On the dashboard surface, non-GET is a faithful proxy for "write": the read
routes are `GET` (`report-api` is GET-only; the `/session/me` + schedule reads are GET), and every
mutation is `POST`/`PUT`/`PATCH`/`DELETE` (a method survey across `report-api`/`me-api`/`catalogue-api`/
`schedule-api` at design time found no read behind a non-GET verb). Any `POST`-shaped *read* discovered
during implementation gets an explicit allowlist entry, pinned by the method-gate matrix (§12) — **not**
assumed away (CLAUDE.md §1).

**What it deliberately does not block.** Internal, non-HTTP writes inside a `GET` handler's own
transaction still run — notably `resolveManagementSession` bumping `last_seen_at`
([identity/management-session.ts:39-70](../../../packages/identity/src/management-session.ts)) and the
ambient-session keepalive (§6). This is another reason a read-only **DB role** was rejected (decision
3): it would break these legitimate keepalive writes; the method gate does not, because it gates the
**HTTP verb**, not the SQL.

**Error code.** `node.read_only` joins the existing `node.*` family (sibling `node.not_found`,
[errors.ts:103](../../../apps/server/src/errors.ts)); it names the domain concept — *this node refuses
writes because it is a mirror* — not a process fact (`server.*` is reserved for those,
errors.ts:19-144). Params `Record<string, never>` (no row content in a log line — the `sync.*`/`tunnel.*`
discipline). Codes are never renamed once shipped (CLAUDE.md §3), so the plan greps the `node.` siblings
and registers it in `apps/server/src/errors.ts` with an `import "./errors.js"` from the middleware's file.

## 6. The unauthenticated read-only dashboard

The dashboard's read routes gate on a **management session** (`requireManagementSession(c)` →
`authorizeManager(tx, { managementSessionId, permission })`,
[report-api.ts:102-119](../../../apps/server/src/report-api.ts)), and login is a DB write that reads
`persons`/`passkeys` — **none of which is synced** (only the 17 commercial tables are;
[registry.ts](../../../packages/sync/src/registry.ts)). So the mirror has no credentials to log in
with. Decision 4 serves it unauthenticated by giving every request an **ambient viewer session**:

- **At mirror boot, ensure one viewer identity exists** in the mirror's own DB (mirror-local, never
  synced): a `persons` row with role **`admin`** (the `admin` set is `ALL` permissions,
  [permissions.ts:88-92](../../../packages/identity/src/permissions.ts)), so **every** gated read
  passes `roleHasPermission` regardless of which permission the route demands — and a **live**
  `management_sessions` row for it. The person's broad role is not what enforces read-only; the **§5
  gate** is. Seeded under the mirror's tenant via `withTenant` + `app_user` (which already holds the
  INSERTs the login path uses), so no new grant.
- **A middleware injects the ambient session cookie** when the request carries none, so the browser
  never sees a login screen and the existing gates resolve a real, live session. The session's
  `last_seen_at` is bumped by `resolveManagementSession` on each request (the sliding window,
  [management-sessions.ts:8,21](../../../packages/identity/src/schema/management-sessions.ts)); the
  boot seed sets it live, and the middleware **re-ensures** a live session if it has expired during an
  idle spell — the exact keepalive shape (bump vs re-seed) is pinned by the implementing test.
- **The viewer is visibly a mirror artifact** — a fixed display name (e.g. `"mirror viewer"`) so its
  appearance in a staff list reads as what it is. It is mirror-local and cannot reach the primary
  (persons is not synced), so it introduces no cross-node identity.

**Accepted wart (named, not hidden):** the ambient viewer appears as a phantom `admin` in the mirror's
own staff list, and its role is broader than the reads strictly need. Both are acceptable for a
read-only DR copy whose writes are gated shut (§5), and both disappear when real auth arrives with the
hosting slice. The alternative — teaching `authorizeManager` a "mirror ambient identity" that needs no
`persons` row — was rejected: it modifies a security-critical core function for every deployment to
save one mirror-local seed row.

## 7. Pull through the tunnel + apply — reuse, no new sync code

The mirror is a **subscriber**, and the whole subscriber path already exists. It runs the same
`runSyncPull` the box runs ([boot.ts:848-862](../../../apps/server/src/boot.ts)), with two differences,
both already supported by existing seams:

- **`http: tunnelHttpClient({ ca, servername })`** instead of `fetchHttpClient`
  ([tunnel-http.ts:25-33](../../../apps/server/src/tunnel-http.ts)), and **`peer.url` = the relay's
  address** with **`servername` = the box hostname** and **`ca` = the box's CA** — exactly the
  composition B's headline e2e already drives
  ([tunnel-e2e.test.ts:186-201](../../../apps/server/src/tunnel-e2e.test.ts):
  `tunnelHttpClient({ ca, servername: "box.test" })`, `peerUrl = https://…:${relay.clientPort}/`). TLS
  terminates on the box; the relay only splices. **No `runSyncPull` change** — this is its existing
  `deps.http` seam.
- **Apply happens inside `runSyncPull`** already (`applyBatch`,
  [pull.ts:11,115](../../../packages/sync/src/pull.ts)), running each row as `app_user` under
  `withTenant` and writing `sync_cursor` as `sync_tailer`
  ([apply.ts:2-9](../../../packages/sync/src/apply.ts)). So the mirror needs **no apply code**; it
  needs its DB pool to be an **`app_user` + `sync_tailer` member** — the **same** membership the box's
  sync pool already has ([boot.ts:814-822](../../../apps/server/src/boot.ts)), and `app_user` is
  **never** widened to reach `sync_cursor` (apply.ts:8-9). **No new grant** (§9).

Like the box, the mirror runs **both lanes** — `ordered` and `fast` — under one `AbortController`
torn down by `close()`, the exact `Promise.all([runLane("ordered", …), runLane("fast", …)])` shape
([boot.ts:869-872](../../../apps/server/src/boot.ts)).

**The mirror's connection config, in C2a, is env** (C2b moves it to DB-stored, wizard-entered). The
mirror needs: the relay address (→ `peer.url`), the box hostname (→ `servername`), the box CA (→ `ca`),
and the per-peer sync token (→ `peer.token`), plus its matching identity (the five `WAITRON_TILL_*_ID`).
The plan pins the exact env shape (extending `loadSyncConfig`'s `WAITRON_SYNC_PEERS` with the CA +
servername the tunnel client needs, or a sibling `loadMirrorConfig`), fail-closed like `loadTunnelConfig`
(a partial set is a loud error; an empty relay URL is refused — the empty-connection-string trap,
CLAUDE.md §3).

## 8. Workers the mirror does NOT run

A mirror is a subscriber and a read surface, nothing else. It **does not** start, and the plan asserts
each is absent under `mode = mirror`:

- **the fiscal `drain`** and **reconcile** duties — a mirror files nothing and settles nothing;
- **the sync-api SOURCE** (`mountSyncApi`) — a mirror serves no downstream subscriber (single-tenant DR,
  decision 6); it is a *client* of the primary's source, not a source itself;
- **the retention sweep** — pruning belongs to the log's owner (the primary); a mirror holds no
  `sync_log` of its own to prune (it applies, it does not capture — it never writes `sync_log`);
- **the tunnel CLIENT** (`runTunnelClient`) — that is the **box** dialing out from behind NAT
  ([boot.ts:920-956](../../../apps/server/src/boot.ts)); the mirror is the cloud end and *uses*
  `tunnelHttpClient` to reach in, it does not dial out;
- **origination** — the till/sale/payment write paths exist as mounted routes but are **write-gated**
  (§5); no sale can be created on a mirror.

Starting the deferred workers is what a **promotion** must do (§10) — which is precisely why promotion
is its own slice and why C2a's job is to make the mode a runtime flag, not to build the promotion.

## 9. Roles & grants (no new grants)

C2a introduces **no** grant and **no** role:

- **Apply + serve pool** = the existing `app_user` + `sync_tailer` member (§7): `app_user` reaches the
  17 tables under FORCE-RLS `withTenant` and reads them for the dashboard; `sync_tailer` reaches
  `sync_cursor`. Both grants already exist (the C1/sync migrations; `sync_tailer` SELECT/INSERT/UPDATE
  on `sync_cursor`, [0000_sync_outbox.sql:109](../../../packages/sync/drizzle/0000_sync_outbox.sql)).
- **`deployment.mode` read** = the existing `GRANT SELECT ON deployment TO app_user` (§3). The `mode`
  **write** (stamp-mirror, promote) is an **owner-role** write, never `app_user` — asserted by a
  negative read-back (`app_user` holds no INSERT/UPDATE on `deployment`), per CLAUDE.md §3's "an object
  privilege GRANT is verified by reading the ACL back."
- **Ambient viewer seed** = `app_user` INSERT on `persons`/`management_sessions` under `withTenant`,
  the same grants the login path uses — no widening.

The mirror is **not** provisioned by C2a to hold any write grant it does not already have as a normal
trading node; it simply refuses writes at the HTTP layer.

## 10. Promotion — designed for, not built

Decision 1 requires that a mirror can become a primary **without a restart**. C2a makes that
**possible** without building the button:

- **What a flag-flip already achieves:** the §5 gate reads a refreshable holder, so
  `UPDATE deployment SET mode='primary'` + a refresh **opens every write route** live — the whole HTTP
  layer promotes with no re-mount (decision 5's payoff).
- **What promotion still needs (the deferred slice's job):** start the primary-only workers (§8) —
  the fiscal drain/reconcile, the sync source, retention, and (for the box role) the tunnel client —
  and stop pulling from the now-defunct primary. None of this is startable per-request; it is the
  promote action's work, and it is **explicitly out of C2a** (§11).
- **What C2a must not do:** nothing that makes no-restart promotion *impossible* — i.e. no boot-time
  decision that can only be reversed by a restart on the **HTTP** layer. Worker start/stop on promotion
  is tractable and deferred; route (un)mounting is not, which is why decision 5 mounts the full surface.

## 11. Out of scope (named, not dropped)

- **C2b — the operator flow.** The **"adopt existing venue"** provisioning (insert `tenants`/
  `locations`/`nodes`/`tills`/`invoice_series` with the primary's **explicit** ids, **no `registerSif`**
  — re-registering a SIF mints a second unrecoverable hash chain, CLAUDE.md §5); the **primary-side
  mirror bundle** (five ids + CA + minted per-peer token + relay coords); the **setup-wizard
  primary/mirror** screen; and **DB-stored** connection config replacing C2a's env. Its own spec.
- **The promote action** — the runtime mirror→primary switch and the worker start/stop it entails
  (§10). Deferred to its own slice.
- **Config-flow-down** of `tenants`/`locations`/`nodes`/`tills` — the mirror is provisioned once with
  matching ids; auto-replication of config is a separate later slice (C1 §8).
- **Multi-tenant whole-log reader** and the **fiscal hash-chain lane** — later slices, unchanged.
- **Real cloud hosting / DNS / TLS certs / per-user mirror auth** — the real T1 relay + hosting slice;
  C2a is proven against the local stand-in, and its unauthenticated dashboard (decision 4) is explicitly
  a stand-in posture that the hosting slice replaces.

## 12. Testing

Real Postgres, not PGlite, for anything touching the role split, RLS-as-`app_user`, or the
apply-under-FORCE-RLS path (PGlite connects every session as superuser and serialises queries, so it
cannot show the `app_user`/`sync_tailer` split; CLAUDE.md §4). `TESTCONTAINERS_RYUK_DISABLED=true`
locally. The mirror surface + gate that touch no roles may use the lighter target where a comment says
why.

- **Headline e2e — a real mirror pulls, applies, and serves read-only.** Stand up two real Postgres
  DBs (a primary source with seeded `sync_log`, and a fresh mirror), the B relay stand-in +
  `runTunnelClient` in front of the source's HTTPS `sync-api`, and boot `apps/server` in **mirror
  mode** against the mirror DB (matching identity + `tunnelHttpClient` config, env-supplied). Assert:
  the mirror **pulls + applies** the seeded rows and its **cursor advances** (through the tunnel); a
  **`GET`** dashboard read (e.g. `report-api`) returns the applied data **with no login** (the ambient
  session); and a **`POST`**/`PUT`/`DELETE` to any mounted mutation returns **`node.read_only` 403**.
  This is C2a end to end against "a second local Postgres + a reader on another port."
- **Proven by deletion** (CLAUDE.md §4), three gates:
  1. remove the §5 gate → the `POST` write **succeeds** (or reaches the handler) instead of 403; restore
     → 403. (The gate is what makes the node read-only.)
  2. drop the ambient-session middleware → the `GET` read returns **`management_session.required` 401**
     instead of data; restore → data. (The ambient session is what makes it unauthenticated-yet-gated.)
  3. set `deployment.mode = 'primary'` on the same tree → the `POST` **succeeds** and the primary
     workers/wiring engage; set `mirror` → refused. (The flag is the switch, and the promotion-readiness
     receipt.)
- **`deployment.mode` unit + grant tests:** `readDeploymentMode` returns `mirror`/`primary`/(absent →
  `primary`); the `CHECK` rejects a third value; **read-back** asserts `app_user` holds `SELECT` on
  `deployment` and **not** INSERT/UPDATE (`has_table_privilege`/`aclexplode`, both directions,
  CLAUDE.md §3), i.e. `app_user` cannot flip the mode.
- **Method-gate matrix:** every HTTP method against a representative mounted route under `mirror` and
  under `primary`; the allowlist (if any `POST`-shaped read exists) is pinned here, and a negative
  control (a genuine write) still 403s under `mirror`.
- **Worker-absence assertions (§8):** under `mirror`, the boot wiring starts no drain/reconcile/source/
  retention/tunnel-client — asserted by the boot test's worker set, the same way `boot.test.ts` asserts
  today's wiring, proven by a control that a `primary` boot *does* start them.
- **Run unfiltered.** `pnpm --filter @waitron/server test:coverage` and
  `pnpm --filter @waitron/db test:coverage` for the 98/98/98/95 thresholds, and the whole `apps/server`
  + `@waitron/db` suites **unfiltered** (cross-cutting guards — teardown, english-only, errors-reachable
  — do not load under a name filter, CLAUDE.md §2/§4). The `inmutabilidad` FORCE-RLS scan is unaffected
  (C2a adds no `tenant_id`-bearing table — `deployment` has none), but the plan runs
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` anyway if it touches any tenant-scoped
  table.

## 13. Security review

C2a stands up a distrusting-peer read surface, so a security review is part of the slice (the
cloud-mirror boundary, owner note). Points it must confirm:

- **A mirror cannot write.** No mounted mutation reaches its handler under `mode = mirror` — proven by
  the method-gate matrix + the deletion control, not asserted. The gate is fail-**closed** on method
  (anything not explicitly-GET/allowlisted is refused).
- **`app_user` cannot flip the mode.** The read-back proves `app_user` holds no INSERT/UPDATE on
  `deployment`, so a compromised app path cannot self-promote a mirror to writable. Only the owner role
  can.
- **The ambient viewer cannot escape the mirror.** It is mirror-local (persons is not synced), so it is
  not a credential on the primary; and it can perform no write (the gate), so its broad `admin` role
  buys no capability beyond reading the local copy.
- **No credential or row content in any log line** — `node.read_only` carries no params; the mirror's
  pull reuses B/A's already-reviewed transport and token handling unchanged.
- **A's cloud→box auth and B's blindness are unchanged** — C2a is a *consumer* of the existing pull +
  tunnel path; it adds no transport and weakens none.

## 14. Docs & comments this change touches (editing a file is not auditing it, CLAUDE.md §1/§3)

- The boot trading-branch comment gains the primary-vs-mirror `deployment.mode` fork and the mirror
  wiring; the sync-block and tunnel-block comments note the mirror is the pull/`tunnelHttpClient`
  consumer.
- `deployment.ts`'s doc (the singleton's purpose) gains `mode`; `config.ts`/`till-config.ts` gain the
  mirror connection env (C2a) beside the sync/tunnel config.
- The `nodes.ts` "a `role` column … later specs" comment gains a dated pointer that mirror-vs-primary
  landed on `deployment.mode`, **not** `nodes.role` (so a future reader does not add a second flag).
- The **backlog** "C2 — the mirror-mode server" thread ([backlog.md:185-189](../../../docs/backlog.md))
  moves to "split into C2a (mechanism) + C2b (operator flow); C2a in flight/landed", and the
  `sync-cloud-mirror-peer-identity` memory records C2a's state. (Backlog + memory updated at land, per
  `/land-branch`.)

## 15. Provenance

Internal receipts are cited inline as `file:line` against the branch tree and were read from the
current code, not from memory: the boot mode decision and mount/worker wiring
([boot.ts:432,441,814-956](../../../apps/server/src/boot.ts)), the pull/apply seam and roles
([pull.ts](../../../packages/sync/src/pull.ts), [apply.ts:2-9](../../../packages/sync/src/apply.ts)),
the tunnel client + its e2e composition ([tunnel-http.ts](../../../apps/server/src/tunnel-http.ts),
[tunnel-e2e.test.ts:186-201](../../../apps/server/src/tunnel-e2e.test.ts)), the session gate
([report-api.ts:102-119](../../../apps/server/src/report-api.ts),
[management-session.ts](../../../apps/server/src/management-session.ts)), the permission model
([permissions.ts:67,88-98](../../../packages/identity/src/permissions.ts)), the deployment singleton +
accessors + grant ([deployment.ts](../../../packages/db/src/schema/deployment.ts),
[packages/db/src/deployment.ts](../../../packages/db/src/deployment.ts),
[0010_deployment_stamp.sql:18](../../../packages/db/drizzle/0010_deployment_stamp.sql)), the sync
registry's 17 tables and the config-only set ([registry.ts](../../../packages/sync/src/registry.ts)),
and the provisioning id-generation facts that force C2b's "adopt venue"
([venue-apply.ts](../../../packages/provisioning/src/venue-apply.ts),
[tenant-id.ts](../../../packages/provisioning/src/tenant-id.ts)). External claims: none — C2a is
entirely internal. The seeding memories (`sync-cloud-mirror-peer-identity`,
`sync-cloud-mirror-connection-direction`, `replication-is-shared-infra`) are point-in-time notes and
were re-verified against code before use.

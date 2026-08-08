# Sync Slice 1 — Commercial-lane outbox + apply loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the application-level cross-server sync mechanism for the **commercial lane only** — a
`sync_log` outbox (one table + one generic capture trigger over the 14 enrolled non-fiscal tables)
and an idempotent, seq-ordered apply loop that writes each captured row as the non-superuser app role
under `withTenant`. Leave the fiscal lane a documented seam; touch nothing hash-chained or immutable.

**Architecture:** A new `@waitron/sync` package owns the apply code (registry → static per-table
apply SQL → `applyBatch`) and one migration (`packages/sync/drizzle/0000_sync_outbox.sql`) that
creates `sync_log`/`sync_cursor`/`sync_capture()` and attaches a capture trigger to each enrolled
table. Because the triggers span `@waitron/db` and `@waitron/payments` tables, the migration runs
**last** in the manifest (a new `sync` entry, after `payments`/`credentials`, so every enrolled table
already exists). Apply is proven on real Postgres as the app role — the mechanism the container gates
already validated (`2026-08-06-sync-container-gates-findings.md`), now productionised into committed
code + tests.

**Tech Stack:** TypeScript, Drizzle ORM (raw `sql`/`.execute` — the apply path uses
`jsonb_populate_record`, not the query builder), PostgreSQL 18 via Testcontainers (real-PG for
RLS/non-superuser/concurrency — PGlite is a false pass here, `CLAUDE.md` §4), Vitest, `@waitron/db`
testing harness (`useRealPostgres`, `withTenant`, `asAppUser`), `@waitron/migrations` (full manifest
in tests).

**Spec:** [../specs/2026-08-08-sync-slice1-commercial-outbox-spec.md](../specs/2026-08-08-sync-slice1-commercial-outbox-spec.md).
**Design:** [../specs/2026-08-02-app-level-sync-design.md](../specs/2026-08-02-app-level-sync-design.md)
(§3 outbox, §5 apply, §6 enrolment, §10 handshake). **Gates:**
[../specs/2026-08-06-sync-container-gates-findings.md](../specs/2026-08-06-sync-container-gates-findings.md)
(9 gates ran, all pass).

## Global Constraints

- **DO NOT touch the fiscal lane.** No edits to `computeHuella`, the chain, the immutable
  `registros_facturacion` triggers, or any table in `packages/fiscal-verifactu`, and no enrolment of
  `registros_facturacion`/`envios`/`envio_flujo`/`acks`/`cadenas`/`registro_sif`/`invoice_series`/
  `contadores_instalacion`. Do NOT enrol `order_amendments` (hash-chained), `working_order_counters`,
  `order_prep`, or `incidents` either (spec §2).
- **Real Postgres for every RLS / non-superuser-app-role / concurrency / DELETE-under-grant test.**
  PGlite is superuser and serialises onto one backend (false pass). Locally set
  `TESTCONTAINERS_RYUK_DISABLED=true` or container suites hang at the 180s hook timeout (`CLAUDE.md`
  §4). A filtered run does not load a package's tree-wide guard suites — run the package unfiltered
  before believing a pass.
- **Idempotency is a first-class, tested property.** Every apply-mode test proves a first delivery and
  a re-delivery **visibly differ** (`rowCount 1` then `0`, stored bytes unchanged), per `CLAUDE.md`
  §1's "a measurement where both answers look alike measures nothing." State the failing case before
  each probe.
- **A new `tenant_id`-bearing table (`sync_log`) needs the full recipe by hand** — FORCE ROW LEVEL
  SECURITY + a tenant-isolation policy + explicit grants, hand-written in the custom migration
  (`CLAUDE.md` §3). `.enableRLS()` emits only `ENABLE`; a missing FORCE leaves the fiscal
  `inmutabilidad` guard red (as `nodes` once did). `sync_cursor` carries no `tenant_id` and is not RLS
  (whole-DB operational, like `deployment`).
- **Never build SQL by string-concatenating untrusted identifiers** (`CLAUDE.md` §3). Table names come
  only from the fixed `registry`; `row_image` binds as one `$1` via `jsonb_populate_record`. No
  `quoteIdent` needed because no identifier is runtime-derived, but assert that in a test.
- **Error codes name the domain concept, never the package** (`CLAUDE.md` §3): `sync.peer_environment_mismatch`,
  not `sync.trigger_failed`. Every file that throws a code does `import "./errors.js"`.
- **English-only:** `@waitron/sync` is regime-neutral; keep Spanish fiscal tokens
  (`registros`/`envios`/`huella`) out of its `src/` — every enrolled table is English-named, and the
  fiscal-seam discussion lives in the spec/design docs, not in code.
- **No backwards-compat / no backfill** (pre-production): schema drops and recreates; adding
  `sync_log` and the triggers to fresh DBs is free.
- **Every commit `-s`.** Before green: `pnpm --filter <pkg> test:coverage` for each touched package
  (CI runs coverage, not plain `test` — `CLAUDE.md` §2). Coverage thresholds 98/98/98/95.

---

### Task 1: Scaffold `@waitron/sync` + error registry + workspace registration

**Files:**
- Create: `packages/sync/package.json`, `packages/sync/tsconfig.json`, `packages/sync/vitest.config.ts`,
  `packages/sync/src/index.ts`, `packages/sync/src/errors.ts`, `packages/sync/src/errors.test.ts`,
  `packages/sync/src/errors.reachability.test.ts`
- Modify: `packages/db/src/english-only.ts` (add `"sync"` to `GENERIC_PACKAGES`),
  `packages/fiscal-verifactu/src/vocabulary-scope.test.ts` (its pin of `GENERIC_PACKAGES`),
  `scripts/changed-scope.mjs` (register the package so its tests run in CI scope),
  and any `scripts/changed-scope.*.test.*` that pins the package/gate list.

**Interfaces:**
- Produces `@waitron/sync` (Node ESM package, `"type": "module"`), coverage 98/98/98/95.
- `errors.ts` declaration-merges `@waitron/shared`'s `ErrorParams` with: `sync.peer_environment_mismatch`
  (`{ local: string; peer: string }`), `sync.table_not_enrolled` (`{ table: string }`),
  `sync.stream_stalled` (`{ subscriberId: string; originId: string; lag: number }`).

- [ ] **Step 1: `package.json`** — clone a Node package (e.g. `packages/migrations/package.json`)
  renamed `@waitron/sync`; scripts `test`/`test:coverage`/`typecheck`/`lint` identical; dependencies
  `@waitron/shared`, `@waitron/db`, `drizzle-orm`; devDependencies `@waitron/migrations` (to run the
  full manifest in tests), `vitest`, `@vitest/coverage-v8`, `typescript`, and whatever
  `@waitron/db/testing` needs (`pg`, `testcontainers` — copy from `packages/payments/package.json`,
  which already dev-depends on the harness).

- [ ] **Step 2: `tsconfig.json` + `vitest.config.ts`** — clone a Node package's pair; set coverage
  thresholds `98/98/98/95`; `include: ["src"]`. Coverage-exclude nothing dot-prefixed (`CLAUDE.md`
  §4).

- [ ] **Step 3: Write the failing errors-reachability + errors test** — `errors.reachability.test.ts`
  cloned from a sibling (asserts the barrel augments `@waitron/shared`); `errors.test.ts` asserts each
  `sync.*` code is constructible via `new AppError(code, params)` with the typed params. Run:
  `pnpm --filter @waitron/sync test errors` · Expected: FAIL (module missing).

- [ ] **Step 4: Implement `errors.ts` + `index.ts`** — `import "@waitron/shared";` then
  `declare module "@waitron/shared" { interface ErrorParams { … } }` with the three codes (spec §4).
  `index.ts` re-exports and does `import "./errors.js";`.

- [ ] **Step 5: Register in the workspace guards** — add `"sync"` to `GENERIC_PACKAGES`
  (`english-only.ts:8`) and update `packages/fiscal-verifactu/src/vocabulary-scope.test.ts`'s pinned
  copy of that list in the SAME change (`CLAUDE.md` §2 — a hardcoded cross-package list goes stale and
  scoped CI hides it). Add `@waitron/sync` to `scripts/changed-scope.mjs` so its (container-heavy)
  suite runs; if its real-PG suites prove too heavy for `test-light` under Docker contention, give it
  its own shard like the browser packages (`OWN_SHARD_PACKAGES`) — decide when Task 4's suite exists,
  note it here.

- [ ] **Step 6: Run + commit** — Run: `pnpm install && pnpm --filter @waitron/sync test:coverage` and
  `pnpm vitest run scripts/changed-scope` · Expected: PASS. Then:
```bash
git add packages/sync packages/db/src/english-only.ts \
        packages/fiscal-verifactu/src/vocabulary-scope.test.ts scripts/changed-scope.mjs ../../pnpm-lock.yaml
git commit -s -m "feat(sync): scaffold @waitron/sync package + sync.* error registry"
```

---

### Task 2: The outbox migration — `sync_log` + `sync_cursor` + `sync_capture()` + capture triggers

The single migration that creates the transport, the cursor, the generic capture function, and one
trigger per enrolled table. Real-PG gate suite written first (red), green at the end.

**Files:**
- Create: `packages/sync/drizzle/0000_sync_outbox.sql`, plus the drizzle journal/snapshot skeleton
  the migrator expects (mirror an existing hand-written custom migration set; this migration is
  entirely hand-written SQL — `sync_log` is not a Drizzle table).
- Modify: `migrations.manifest.json` (append `{ "name": "sync", "table":
  "__drizzle_migrations_sync", "from": "../sync/drizzle" }` **LAST**),
  `packages/migrations/src/manifest.test.ts` (if it pins the set list),
  `packages/provisioning/src/instance-apply.rls.test.ts` (its `migratedSets` pin — `CLAUDE.md` §2
  named this exact test going red when the manifest changed).
- Create: `packages/sync/src/capture.gate.test.ts` (real-PG).

**Interfaces (the SQL objects):**
```sql
create table sync_log (
  seq          bigint generated always as identity primary key,
  origin_id    uuid   not null,
  table_name   text   not null,
  op           text   not null check (op in ('insert','update','delete')),   -- 'delete' added (spec §2)
  tenant_id    uuid   not null,
  row_image    jsonb  not null,
  txid         xid8   not null default pg_current_xact_id(),
  committed_at timestamptz not null default clock_timestamp()
);
alter table sync_log enable row level security;
alter table sync_log force  row level security;
create policy sync_log_tenant_isolation on sync_log for all
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
revoke all on sync_log from app_user;
grant insert on sync_log to app_user;                 -- capture trigger only; it never reads
create role sync_tailer nologin;                      -- dedicated reader (spec §7)
grant select on sync_log to sync_tailer;

create table sync_cursor (                            -- operational, NO tenant_id, NO RLS (like deployment)
  subscriber_id   text not null,
  origin_id       uuid not null,
  last_applied_seq bigint not null default 0,
  alive           boolean not null default true,
  updated_at      timestamptz not null default now(),
  primary key (subscriber_id, origin_id)
);
grant select, insert, update on sync_cursor to sync_tailer;

create function sync_capture() returns trigger language plpgsql as $fn$
declare rec jsonb; ten uuid;
begin
  if tg_op = 'DELETE' then rec := to_jsonb(old); ten := old.tenant_id;
  else                     rec := to_jsonb(new); ten := new.tenant_id;
  end if;
  insert into sync_log (origin_id, table_name, op, tenant_id, row_image)
  values (coalesce(nullif(current_setting('app.node_id', true),'')::uuid,
                   '00000000-0000-0000-0000-000000000000'::uuid),
          tg_table_name, lower(tg_op), ten, rec);
  return null;   -- AFTER trigger
end; $fn$;
-- then, per enrolled table, a trigger with the WHEN echo-guard and the right ops (spec §2):
--   Group A (append-only):  after insert
--   Group B (mutable+wm):   after insert or update
--   Group C (wo/lines):     after insert or update or delete
-- create trigger <t>_capture after <ops> on <t>
--   for each row when (current_setting('app.sync_apply', true) is distinct from 'on')
--   execute function sync_capture();
```
Enrolled tables (spec §2, all 14): `sales`, `sale_lines`, `tenders`, `sale_settlements`,
`sale_substitutions`, `sale_voids`, `payment_refunds` (A, after insert); `catalogues`, `categories`,
`products`, `payments`, `payment_policy` (B, after insert or update); `working_orders`,
`working_order_lines` (C, after insert or update or delete).

- [ ] **Step 1: Write the capture gate suite (failing), real-PG** — `capture.gate.test.ts` using
  `useRealPostgres` + the full manifest (`migrationOptionsFor(manifestSets(), null)` via
  `@waitron/migrations`, as the gate findings describe). Seed fixtures as superuser; run writes as the
  app role (`asAppUser` in a real-PG txn, or a dedicated `app_login` login role as the gates did).
  Assert, each with its failing case stated:
    1. **Byte-identical capture** (gate 1): a domain INSERT of a `products` row (numeric `unit_price`,
       jsonb `descriptions`) with `app.node_id` set writes one `sync_log` row whose `row_image`
       restores identically and whose `origin_id` equals the GUC; the numeric stays a JSON string.
    2. **Echo suppression + its control** (gate 1): an apply-style write with
       `app.sync_apply='on'` set in the same txn is **not** re-captured (count unchanged); reinstall
       the trigger without the `WHEN` clause and show it **is** re-captured — proving the clause
       load-bearing.
    3. **DELETE capture** (spec §2 finding): delete a `working_order_lines` row (open parent) as the
       app role → one `sync_log` row `op='delete'` carrying `to_jsonb(OLD)` and `OLD.tenant_id`. This
       is the op the fiscal-lane-shaped design omitted; prove it fires.
    4. **`sync_log` FORCE RLS + grant shape**: as the app role, a cross-tenant `sync_log` row is
       invisible (SELECT under tenant B returns nothing for a tenant-A row — but note the app role has
       no SELECT at all, so assert `42501` on app-role SELECT and that `sync_tailer` under
       `withTenant` sees only its tenant); an app-role attempt to UPDATE/DELETE `sync_log` is refused.
  Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test capture.gate` · Expected:
  FAIL (no `sync_log`).

- [ ] **Step 2: Write the migration** — `packages/sync/drizzle/0000_sync_outbox.sql` exactly as the
  Interfaces block, with all 14 triggers. Add the manifest entry + journal/snapshot skeleton. Update
  `manifest.test.ts` and `instance-apply.rls.test.ts`'s `migratedSets` pin in the SAME change.

- [ ] **Step 3: Run the gate suite — expect PASS** — Run:
  `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test capture.gate` · Expected: PASS.
  Prove each guard by deletion where cheap (remove the `WHEN` clause → echo re-captures; that is
  sub-test 2's own control).

- [ ] **Step 4: MANDATORY new-tenant-table guard** — Run:
  `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` ·
  Expected: PASS (`sync_log` is a new `tenant_id` table and MUST show `relforcerowsecurity=true`; this
  is the guard that caught `nodes` shipping FORCE-less — `CLAUDE.md` §3). If red, the migration is
  missing `FORCE ROW LEVEL SECURITY` on `sync_log`.

- [ ] **Step 5: Run provisioning + migrations packages unfiltered** — Run:
  `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/migrations --filter @waitron/provisioning test:coverage` ·
  Expected: PASS (the `migratedSets` pin and manifest test now include `sync`).

- [ ] **Step 6: Commit**
```bash
git add packages/sync/drizzle migrations.manifest.json packages/migrations/src/manifest.test.ts \
        packages/provisioning/src/instance-apply.rls.test.ts packages/sync/src/capture.gate.test.ts
git commit -s -m "feat(sync): sync_log outbox + generic capture trigger over the commercial lane"
```

---

### Task 3: The enrolment registry + static per-table apply SQL

**Files:**
- Create: `packages/sync/src/registry.ts`, `packages/sync/src/registry.test.ts`,
  `packages/sync/src/apply-sql.ts`, `packages/sync/src/apply-sql.test.ts`

**Interfaces:**
- `registry.ts` exports `ENROLLED: readonly EnrolledTable[]` where
  `EnrolledTable = { table: string; mode: "insert-only" | "watermark-upsert"; conflictKey: string[];
  watermarkColumn: string | null; captureOps: ("insert"|"update"|"delete")[]; fkRank: number }` — the
  14 rows of spec §2, `fkRank` a static topological rank (parents < children; e.g. `sales` <
  `sale_lines`/`tenders`; `working_orders` < `working_order_lines`; `payments` <
  `payment_refunds`). Group C (`working_orders`/`working_order_lines`) is `watermark-upsert` with
  `watermarkColumn: null` and `captureOps` including `delete`.
- `apply-sql.ts` exports `applyStatementFor(entry): string` producing the static statement:
    - insert-only: `insert into <t> select * from jsonb_populate_record(null::<t>, $1) on conflict (<key>) do nothing`
    - watermark-upsert **with** a column: `… on conflict (<key>) do update set <cols>=excluded.<cols> where excluded.<wm> > <t>.<wm>`
    - watermark-upsert **null** column (Group C): `… on conflict (<key>) do update set <cols>=excluded.<cols>` (unconditional; monotonicity comes from the seq cursor, spec §3)
    - and `deleteStatementFor(entry): string` for Group C: `delete from <t> where id = ($1->>'id')::uuid`

- [ ] **Step 1: Write the failing tests** — `registry.test.ts`: assert `ENROLLED` has exactly the 14
  tables of spec §2 with the modes/keys/ops/watermarks named there, that every enrolled table name is
  ASCII-lowercase-and-underscore (no Spanish token — a mini in-package guard mirroring `english-only`),
  and that `fkRank` orders each child after its parent. `apply-sql.test.ts`: assert
  `applyStatementFor`/`deleteStatementFor` emit the exact expected SQL per mode (string match), and a
  guard test that the generated SQL contains **no** value from outside the fixed registry (identifiers
  are literal, `$1` is the only bind) — the `CLAUDE.md` §3 "identifiers are static, reviewed" property.
  Run: `pnpm --filter @waitron/sync test registry apply-sql` · Expected: FAIL.

- [ ] **Step 2: Implement `registry.ts` + `apply-sql.ts`** — derive the mutable `set` column list per
  table from the registry (all columns except the conflict key). Keep every table identifier a literal
  drawn from `ENROLLED`.

- [ ] **Step 3: Run — expect PASS** — Run: `pnpm --filter @waitron/sync test registry apply-sql` ·
  Expected: PASS. (These are pure-unit; no container needed.)

- [ ] **Step 4: Commit**
```bash
git add packages/sync/src/registry.ts packages/sync/src/registry.test.ts \
        packages/sync/src/apply-sql.ts packages/sync/src/apply-sql.test.ts
git commit -s -m "feat(sync): enrolment registry + static per-table apply SQL"
```

---

### Task 4: The apply loop — idempotent, seq-ordered, as the app role under `withTenant`

The heart of the slice. Real-PG gate suite is the gate — written first (red), green at the end.

**Files:**
- Create: `packages/sync/src/apply.ts`, `packages/sync/src/apply.gate.test.ts` (real-PG)

**Interfaces:**
- `applyBatch(subscriberDb, rows: SyncLogRow[], opts: { subscriberId: string; localEnvironment: string;
  sourceEnvironment: string }): Promise<{ applied: number; deferred: number }>` where
  `SyncLogRow = { seq: bigint; originId: string; table: string; op: "insert"|"update"|"delete";
  tenantId: string; rowImage: unknown }`.
  - **First**, if `sourceEnvironment !== localEnvironment` (compared against `deployment.environment`
    read once), throw `sync.peer_environment_mismatch` **before any row applies** (gate 8).
  - Group rows by `(originId, txid)` — or simply process ascending `seq` — and per group open
    `withTenant(subscriberDb, tenantId, tx => …)`; inside, `set_config('app.sync_apply','on',true)`
    (echo guard), then for each row in `seq` order run the registry's `applyStatementFor` (insert/
    update) or `deleteStatementFor` (delete) binding `rowImage` as `$1`; on success advance
    `sync_cursor.last_applied_seq` to the row's `seq`.
  - **Idempotency:** insert-only → `DO NOTHING`; watermark → the `WHERE excluded.<wm> > …` no-op;
    Group C → the cursor refuses a `seq <= last_applied_seq` (never re-apply an older/equal seq), and a
    delete of an absent row is a 0-row no-op.
  - **`23503`-defer backstop** (belt-and-suspenders for snapshot/stream overlap): a row raising
    `23503 foreign_key_violation` is parked and retried after the referenced parent's `seq` lands;
    never widen a grant or drop a constraint to make it land (`CLAUDE.md` §3, design §4).

- [ ] **Step 1: Write the apply gate suite (failing), real-PG** — `apply.gate.test.ts`, full manifest
  + sync objects, writes/reads as the app role. Model a source→mirror flow inside one container (two
  tenants, or capture on tenant A then apply into a truncated mirror set — mirror the gate suites'
  shape; their SQL is quoted in the findings doc). Cover, each with a stated failing case and a
  control in the other direction:
    1. **Append-only INSERT idempotent** (gate 3): apply a `sales` row → `1`; re-apply the SAME id
       carrying **different bytes** (different `total`) → `0`, stored row unchanged. First-vs-repeat
       visibly differ.
    2. **Watermark upsert non-regress** (gate 2/3): `payments` — first insert applies; a newer
       `updated_at` image applies; an older image is a **no-op** (state does not regress); an equal
       image is a no-op. Control: the newer image DID move the row.
    3. **Group C — no-watermark, seq-cursor monotonic, DELETE** (spec §3): apply a `working_orders`
       insert then an update (open→placed) in seq order → both land; a re-apply of the older `seq` is
       refused by the cursor; apply a `working_order_lines` DELETE → the line is gone; re-apply the
       same DELETE → 0-row no-op (idempotent).
    4. **Seq-order preserves FK across a batch** (gate 4 part 1): a batch containing a `sales` insert
       (seq n) and its `payments` update setting `sale_id` (seq n+1), and a `working_orders` insert
       (seq m) before its `working_order_lines` insert (seq m+1), applied ascending → **zero**
       `23503`. Control: shuffling one child before its parent raises `23503` and the defer lands it
       after the parent.
    5. **Environment handshake, both directions** (gate 8): a production subscriber refuses a
       preproduction source and vice-versa with `sync.peer_environment_mismatch`, and **no row
       applies** on the refused direction (`applied === 0`); the matching direction applies.
    6. **RLS + verbatim under the app role** (Experiment 1 generalised): apply runs as the
       non-BYPASSRLS app role under `withTenant`; a row whose `tenant_id` differs from the applying
       tenant context is rejected by the FORCE-RLS `WITH CHECK`; a same-tenant row stores byte-verbatim.
  Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test apply.gate` · Expected:
  FAIL (`applyBatch` missing).

- [ ] **Step 2: Implement `apply.ts`** — as the Interfaces block. Use `withTenant` for tenant scope;
  read `deployment.environment` once for the handshake; advance `sync_cursor`. Keep the apply
  statement lookups off the fixed registry.

- [ ] **Step 3: Run the gate suite — expect PASS** — Run:
  `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test apply.gate` · Expected: PASS.
  Prove the handshake guard by deletion (remove the env check → sub-test 5 fails), then restore it.

- [ ] **Step 4: Commit**
```bash
git add packages/sync/src/apply.ts packages/sync/src/apply.gate.test.ts
git commit -s -m "feat(sync): idempotent seq-ordered apply loop (app role, withTenant, env handshake)"
```

---

### Task 5: Origin attribution — thread `app.node_id` through the app write path

So a locally-originated write carries its producing node in `sync_log.origin_id` (spec §3.5, §4).

**Files:**
- Modify: the DB tenant-transaction helper (`packages/db/src/tenancy.ts` — currently sets only
  `app.tenant_id`, `tenancy.ts:40`) to also set `app.node_id` when a node id is supplied, and the
  server write path (`apps/server`) to pass its configured local node id.
- Test: `packages/db/src/tenancy.test.ts` (or a new real-PG test) + a capture assertion.

**Interfaces:**
- Add an optional node context to the tenant helper — e.g. `withTenant(db, tenantId, fn, { nodeId })`
  or a sibling `withTenantAsNode(db, tenantId, nodeId, fn)` — that additionally issues
  `select set_config('app.node_id', $nodeId, true)`. Keep the existing `withTenant(db, tenantId, fn)`
  signature working (optional arg) so no caller breaks.
- **ASSUMPTION to confirm at build (spec §4/§6):** where the running server reads its own node id.
  Trace it before wiring (`CLAUDE.md` §1 — do not assert). If there is no local-node config yet, wire
  the helper change and its unit test, leave the server passing the id as a follow-up, and record that
  precisely — capture still works (origin defaults to the all-zero uuid).

- [ ] **Step 1: Failing test** — assert that a write done through the node-aware helper produces a
  `sync_log` row whose `origin_id` equals the supplied node id (real-PG; reuses Task 2's fixture),
  and that the plain `withTenant` path still leaves `origin_id` at the all-zero default. Run:
  `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test origin` · Expected: FAIL.

- [ ] **Step 2: Implement the helper change** — additive; do not change the existing signature's
  behaviour (preserve the existing `tenancy.test.ts` assertions — `CLAUDE.md`/global "preserve
  behavioural assertions"). Update the server write path to pass its node id where the local node is
  known.

- [ ] **Step 3: Run — expect PASS, unfiltered `@waitron/db`** — Run:
  `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage` (unfiltered — loads the
  tree-wide guards) and `pnpm --filter @waitron/sync test:coverage` · Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add packages/db/src/tenancy.ts packages/db/src/tenancy.test.ts apps/server packages/sync
git commit -s -m "feat(sync): set app.node_id so locally-originated writes carry their origin"
```

---

### Task 6: Retention / lag — bounded prune under a down subscriber

**Files:**
- Create: `packages/sync/src/retention.ts`, `packages/sync/src/retention.gate.test.ts` (real-PG)

**Interfaces:**
- `pruneSyncLog(db): Promise<{ pruned: number; highWater: bigint }>` — deletes `sync_log` rows with
  `seq <= min(last_applied_seq)` across all **alive** subscribers; if any alive subscriber is behind,
  the log is held (bounded growth). A live-only min that ignored a down subscriber would delete rows
  it has not applied — the exact data-loss bug gate 7 controls for.
- `lagFor(db): Promise<{ subscriberId: string; originId: string; lag: number; alive: boolean }[]>` —
  `lag = origin max(seq) − last_applied_seq`; a threshold over it is the `sync.stream_stalled` signal.

- [ ] **Step 1: Failing test** — reproduce gate 7: one origin `seq 1..10`; `peerB` caught up (10),
  `cloud` down (4). Assert `pruneSyncLog` retains `seq 5..10` (min across all = 4), the naive
  live-only prune WOULD delete all 10 (the control that makes the data-loss direction concrete), and
  after `cloud` confirms 10 the log drains to 0. Assert `lagFor` reports lag 6 for `cloud`, 0 for
  `peerB`. Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test retention` ·
  Expected: FAIL.

- [ ] **Step 2: Implement `retention.ts`.**

- [ ] **Step 3: Run — expect PASS.** Run:
  `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test retention` · Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add packages/sync/src/retention.ts packages/sync/src/retention.gate.test.ts
git commit -s -m "feat(sync): bounded sync_log retention + per-subscriber lag"
```

---

### Task 7: Full green + guard sweep + docs pointers

- [ ] **Step 1: Package coverage** — Run:
  `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage` · Expected: PASS at
  98/98/98/95.
- [ ] **Step 2: MANDATORY cross-package guards, unfiltered** — Run (each expected PASS):
  - `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
    (the new `sync_log` tenant-table FORCE-RLS scan — `CLAUDE.md` §3)
  - `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db --filter @waitron/payments --filter @waitron/migrations --filter @waitron/provisioning test:coverage`
    (RLS suites + the `migratedSets`/manifest pins)
  - `pnpm vitest run --coverage` from root (the tree-wide `english-only`, guarded-teardowns, and
    changed-scope guards — `@waitron/sync` now in `GENERIC_PACKAGES`)
- [ ] **Step 3: The four-command gate** — Run:
  `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test` · Expected: PASS. Then run
  `pnpm install` and confirm the lockfile is committed (a new package changed it — `CLAUDE.md` §2's
  `--frozen-lockfile` trap).
- [ ] **Step 4: Docs pointers** — append a dated pointer to
  `docs/superpowers/specs/2026-08-02-app-level-sync-design.md` recording that Slice 1 (commercial
  lane) landed, that `sync_log.op` gained `delete` for the commercial lane (correcting §3/§6's
  fiscal-only "no delete" premise), and that the fiscal lane + `payments` fast lane + active-active
  topology remain deferred. Do NOT rewrite the design's body (`CLAUDE.md` §6 — add a pointer, don't
  relitigate history). The `docs/backlog.md` SIF-follow-ups update and any pending-issue record are
  `/land-branch`'s step, not a plan task (`CLAUDE.md` §6).
- [ ] **Step 5:** no commit — verification only. Any commit for the docs pointer:
```bash
git add docs/superpowers/specs/2026-08-02-app-level-sync-design.md
git commit -s -m "docs(sync): dated pointer — commercial-lane sync slice 1 landed"
```

---

## Self-Review

**Spec coverage:**
- §1 fiscal deferral / out-of-scope → Global Constraints + no fiscal enrolment anywhere; §2 the 14
  enrolled tables + the `delete`-op finding → Tasks 2 (triggers/op) + 3 (registry); §3 requirements
  (app-level apply, idempotency, verbatim, echo, origin, ordering, handshake, tenant-fenced
  `sync_log`) → Tasks 2 (capture/RLS/echo) + 4 (apply/idempotency/ordering/handshake) + 5 (origin);
  §4 interfaces (`sync_log`/`sync_cursor`/`sync_capture`/`registry`/`applyBatch`/apply-SQL/retention/
  errors/node-id) → Tasks 1–6 one-to-one; §5 guard suites → Tasks 2 step 4, 4, 7; §6 decisions/risks
  → recorded in the plan (delete-op receipt, single lane, `sync_cursor` no-RLS, park-at-A/retrieve-at-B
  risk, `app.node_id` assumption). ✅
- **Explicitly untouched:** `computeHuella`, the chain, immutable `registros_facturacion`, every
  `packages/fiscal-verifactu` table, `invoice_series`/`envios`/`cadenas`/`registro_sif`/`acks`, and
  `order_amendments`/`working_order_counters`/`order_prep`/`incidents`. ✅

**Idempotency is first-class:** Task 4 sub-tests 1–3 each prove a first delivery and a re-delivery
visibly differ, across all three apply modes incl. DELETE, with controls in the other direction. ✅

**Real-PG where it must be:** every RLS / app-role / concurrency / DELETE-under-grant test uses
`useRealPostgres` (PGlite is a false pass — superuser bypasses RLS); `TESTCONTAINERS_RYUK_DISABLED=true`
on every container command. ✅

**Migrations added (one), and the new-tenant-table rule:** `packages/sync/drizzle/0000_sync_outbox.sql`
creates `sync_log` with hand-written **FORCE RLS + tenant policy + grants** (not `.enableRLS()`), plus
`sync_cursor` (no `tenant_id`, no RLS) and the 14 capture triggers; Task 2 step 4 runs the fiscal
`inmutabilidad` guard that catches a missing FORCE. Adding the manifest `sync` set updates the
`migratedSets`/manifest pins in the same change (`CLAUDE.md` §2). ✅

**Claims carry receipts:** every grant/watermark/FK/DELETE claim in the spec cites a `file:line` I
read; the `app.node_id` source and the exact source→mirror fixture shape are marked assumptions to
confirm at build, not asserted. ✅

**Placeholder scan:** no "TBD"/"similar to". Each task names its files, the exact SQL/interface, the
failing-first test, and the exact verify command. The apply-SQL and trigger DDL are written out; the
fixture shape references the gate suites' quoted SQL as the concrete template. ✅

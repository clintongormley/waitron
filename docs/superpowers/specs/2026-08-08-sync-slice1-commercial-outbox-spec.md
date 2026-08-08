# Sync Slice 1 — the commercial-lane outbox and apply loop

**Date:** 2026-08-08
**Status:** scoping spec for an autonomous implementation run. Boundary FIXED by an owner decision
(build the commercial lane; defer the fiscal lane for personal review).
**Implements a first slice of:** [`2026-08-02-app-level-sync-design.md`](2026-08-02-app-level-sync-design.md)
(the authoritative mechanism design — §3 outbox, §5 apply, §6 enrolment, §10 environment handshake).
**Rests on:** [`2026-08-02-replication-force-rls-prototype-findings.md`](2026-08-02-replication-force-rls-prototype-findings.md)
(native logical apply is categorically refused under FORCE RLS + non-BYPASSRLS — so apply is
application-level) and [`2026-08-06-sync-container-gates-findings.md`](2026-08-06-sync-container-gates-findings.md)
(**nine container gates ran and all pass** on `postgres:18-alpine` as the non-superuser `app_login`
role: capture, echo-suppression, byte-identity, watermark upsert, idempotent re-delivery, the
`23503` FK-defer, retention, and the environment handshake — no new privilege).

**Plan:** [`../plans/2026-08-08-sync-slice1-commercial-outbox-plan.md`](../plans/2026-08-08-sync-slice1-commercial-outbox-plan.md).

---

## 1. What this slice builds, and what it deliberately does not

The design decided the whole cross-server sync mechanism. This slice builds **only the first,
non-fiscal half of it, end to end**: the outbox (a `sync_log` transport table + one generic capture
trigger) and the application-level apply loop (apply each captured row as the ordinary app role
under `withTenant`), for the **commercial lane** — the tenant-scoped, non-fiscal domain tables.

**The fiscal lane is EXPLICITLY DEFERRED to its own later slice, for personal owner review.** That
lane is the unrepairable fiscal core (`CLAUDE.md` §5): the hash-chained, immutable
`registros_facturacion` and its submission state (`envios`, `envio_flujo`, `acks`), the chain head
`cadenas`, the SIF identity `registro_sif`, the fiscal counter `invoice_series`, and the
cloud-allocated `contadores_instalacion`. **This slice does NOT touch `computeHuella`, the chain, the
immutable `registros_facturacion` triggers, or any fiscal table.** It leaves the fiscal lane as a
documented seam that the same enrolment mechanism will later opt into unchanged (design §6): the
apply path proven here for append-only commercial tables is byte-for-byte the same one the fiscal
lane needs (design §5, Experiment 1), so building it first de-risks the fiscal slice without
committing any of its irreversible decisions.

Also out of scope, and why:

- **The wire transport and protocol versioning** — design §15 puts version skew in a separate spec.
  This slice tests apply by reading a source's `sync_log` and applying to a mirror inside one
  container, exactly as the gate suites did; the network serialisation of `row_image` is separate
  (gate finding (ii)).
- **The `payments` fast lane and its cross-lane FK-defer backstop** (design §9/§12) — a performance
  refinement. This slice runs a **single ordered lane** (seq-ascending), which gate 4 proved is a
  topological order of the FK graph for one origin, so no reorder and no cross-lane defer arises.
- **The active-active topology, promotion/failover, the relocatable submitter, disjoint-series
  codes** (design §8, #33) — this slice does not deploy a second node. It builds the capture+apply
  mechanism and records each row's origin, so the topology enrols later without a rewrite.
- **Config-flow-down of the reference tables** (`tenants`, `locations`, `tills`, `nodes`, and the
  `invoice_series` definitions) — a separate slice. This slice ASSUMES they are provisioned
  identically on both peers (they are the FK parents the commercial rows reference); it does not
  enrol or replicate them.

---

## 2. Exactly which tables are in scope

Enrolled = a capture trigger is attached and an apply mode is registered. Every table below is
**tenant-scoped, non-fiscal, and English-named** (so `@waitron/sync` stays inside the `english-only`
guard, `CLAUDE.md` §3). The apply mode is a **grant fact**, cited to the migration that set the
grant — not a design intention (`CLAUDE.md` §1/§3):

### Group A — append-only → INSERT-only apply (`ON CONFLICT (<pk>) DO NOTHING`)

Capture `AFTER INSERT`. The app role holds only `SELECT, INSERT`, so INSERT-only is what the grant
permits — exactly right for an append-only table.

| Table | App-role grant (receipt) | Conflict key |
| --- | --- | --- |
| `sales` | `SELECT, INSERT` (`packages/db/drizzle/0005_sales.sql:113`) | `(id)` |
| `sale_lines` | `SELECT, INSERT` (`0005_sales.sql:115`) | `(id)` |
| `tenders` | `SELECT, INSERT` (`0005_sales.sql:117`) | `(id)` |
| `sale_settlements` | `SELECT, INSERT` (`0012_sale_settlement.sql:41`) | `(id)` |
| `sale_substitutions` | `SELECT, INSERT` (`0014_sale_substitutions.sql:48`) | `(id)` |
| `sale_voids` | `SELECT, INSERT` (`0006_sale_voids.sql:36`) | `(id)` |
| `payment_refunds` | `SELECT, INSERT` (`packages/payments/drizzle/0001_payments_rls.sql:32`) | `(id)` |

### Group B — mutable with a monotonic watermark → watermark upsert

Capture `AFTER INSERT OR UPDATE`. Apply `ON CONFLICT (<key>) DO UPDATE … WHERE excluded.<wm> >
<t>.<wm>`, so a late or re-delivered older image is a no-op and the mirror never moves backward
(design §5; gate 2). The watermark column is verified present in the schema.

| Table | Grant (receipt) | Watermark | Conflict key |
| --- | --- | --- | --- |
| `catalogues` | `SELECT, INSERT, UPDATE` (`0027_light_smiling_tiger.sql:24`) | `updated_at` (`catalogue.ts:30`) | `(id)` |
| `categories` | `SELECT, INSERT, UPDATE` (`0027_light_smiling_tiger.sql:30`) | `updated_at` (`catalogue.ts:46`) | `(id)` |
| `products` | `SELECT, INSERT, UPDATE` (`0027_light_smiling_tiger.sql:36`) | `updated_at` (`catalogue.ts:78`) | `(id)` |
| `payments` | `SELECT, INSERT, UPDATE` (`payments/drizzle/0001_payments_rls.sql:30`) | `updated_at` (`payments.ts:91`) | `(id)` |
| `payment_policy` | `SELECT, INSERT, UPDATE` (`payments/drizzle/0005_payment_policy_rls.sql:17`) | `updated_at` (`payment-policy.ts:22`) | `(tenant_id)` |

`payment_policy`'s primary key is `tenant_id` (one row per tenant, `payment-policy.ts:16`), so its
conflict key is `(tenant_id)`, not `(id)` — the per-table registry (§4) carries the key, so this is
data, not a special case.

### Group C — mutable, NO watermark column, DELETE-capable → single ordered lane

Capture `AFTER INSERT OR UPDATE OR DELETE`. These two tables carry **no monotonic column** (verified:
`working_orders` has `opened_at`/`settled_at`/`status`, `working_order_lines` has no timestamp at all
— `orders.ts`), so the row-level watermark guard **cannot be written for them** — the same shape as
the design's `envios`/`acks` gate-2 finding. Their non-regression therefore rests entirely on the
subscriber's `seq` cursor never re-applying an older `seq`; they ride the **single ordered lane** and
are ineligible for any reordering lane. And they hold **DELETE** — see the finding below.

| Table | Grant (receipt) | Conflict key | Capture ops |
| --- | --- | --- | --- |
| `working_orders` | `SELECT, INSERT, UPDATE, DELETE` (`0004_working_orders.sql:73`) | `(id)` | insert, update, delete |
| `working_order_lines` | `SELECT, INSERT, UPDATE, DELETE` (`0004_working_orders.sql:75`) | `(id)` | insert, update, delete |

**Why `working_orders`/`working_order_lines` are in scope even though they are the hardest tables:**
the FK graph forces them in. `payments.working_order_id` is **NOT NULL** → `working_orders`
(`payments.ts:56`, FK `payments_working_order_fk` `payments.ts:101-105`), and `sales.working_order_id`
is a set-on-park FK → `working_orders` (`sales.ts:159`, FK `sales_working_order_fk`
`sales.ts:194-198`). So a mirror that carries `payments` or park-filed `sales` but not their
`working_orders` parent would fail `23503` on every such row. Including `payments` and `sales` (both
owner-named) requires including `working_orders`.

### A finding this slice must act on: the commercial lane needs a `delete` op

The design's `sync_log` schema pins `op ... check (op in ('insert','update'))` with the note *"no
'delete': no table grants DELETE"* (design §6; gate findings). **That premise is true for the fiscal
lane the schema was gate-tested against, and false for the commercial lane.**
`working_orders`/`working_order_lines` hold DELETE (`0004_working_orders.sql:73,75`, with the only
prior REVOKE being the `REVOKE ALL` immediately above at `:69,71`; grep found no later REVOKE), the
lines FK is `ON DELETE cascade` (`0004_working_orders.sql:31`), and the `require_open_parent` trigger
fires `BEFORE INSERT OR UPDATE OR DELETE` with the in-tree comment *"Covers DELETE too, which is the
transition that would otherwise slip past"* (`0004_working_orders.sql:101-124`) — i.e. a line removed
from an open order is a real, exercised DELETE. Replicating a table that permits DELETE without
capturing deletes leaves stale rows on the mirror. So this slice **extends `sync_log.op` to
`check (op in ('insert','update','delete'))`** and makes the capture function branch on `TG_OP`
(`to_jsonb(NEW)`/`NEW.tenant_id` for insert/update, `to_jsonb(OLD)`/`OLD.tenant_id` for delete), and
the apply path perform an idempotent delete (`DELETE … WHERE id = …`, a 0-row no-op if already
absent) for Group C.

### Deferred within the commercial lane (safe seams — nothing FKs *into* them)

- **`order_amendments`** — a tamper-evident **hash chain** (`SHA-256(content ‖ prev)`,
  `order-amendments.ts`; append-only, `0030_prepare_collect.sql:126`). It is non-fiscal but it is one
  of *"the hash-chained records"* the owner reserved for personal review, so it rides with the
  fiscal-adjacent deferral. Safe to defer: nothing references it.
- **`working_order_counters`** (per-node park-number counter) and **`order_prep`** (kitchen-prep
  state, `0030_prepare_collect.sql:140`) — order-lifecycle satellites of `working_orders`. Neither is
  an FK parent of an enrolled table, so deferring them replicates a working order without its counter
  reservation / prep state, which is acceptable for this slice. Enrol in a follow-up once Group C's
  ownership question (below) is settled.
- **`incidents`** — column-level UPDATE grant (`0008_incidents_privileges.sql`); operational, not
  owner-named, not an FK parent. Enrol later.

---

## 3. The requirements this slice must satisfy

1. **Apply is application-level, as the non-superuser app role, under `withTenant`.** Never native
   logical replication (categorically RLS-blocked, findings doc). Every apply runs inside
   `withTenant(db, row.tenant_id, …)` so `current_tenant_id()` matches the FORCE-RLS `WITH CHECK`
   (`tenancy.ts:40`).

2. **Idempotency is a first-class, tested requirement.** A replayed captured row must never
   double-apply. Concretely: append-only → `ON CONFLICT DO NOTHING` (a re-delivery carrying
   *different bytes* must NOT overwrite the stored row); watermark tables → the `WHERE excluded.<wm> >
   <t>.<wm>` guard makes an older/equal image a no-op; Group C (no watermark) → the seq cursor never
   re-applies an older or equal `seq`, and a DELETE of an already-absent row is a 0-row no-op. Each is
   proven with a control where a first delivery and a re-delivery **visibly differ** (`CLAUDE.md` §1).

3. **Verbatim capture and apply — byte-identical.** `to_jsonb(NEW)` keeps `text`/`numeric` columns as
   JSON strings and `jsonb_populate_record` restores them, so a replicated row is stored exactly as
   supplied (gate 1). Nothing is recomputed on apply. (This matters most for the fiscal lane later; it
   is proven here on commercial tables so the fiscal slice inherits a proven path.)

4. **Echo suppression.** The apply worker sets `select set_config('app.sync_apply','on',true)` in its
   transaction, and every capture trigger carries
   `WHEN (current_setting('app.sync_apply', true) is distinct from 'on')`, so a replicated write is
   not re-captured (no A→B→A loop). Proven load-bearing by a control that re-captures without the
   `WHEN` clause (gate 1).

5. **Single-writer-per-row groundwork.** Each `sync_log` row records `origin_id` (the producing
   node's id, from `app.node_id`). This slice threads `app.node_id` through the app write path so
   locally-originated rows carry the local node, and applies rows in seq order per origin. It does not
   deploy a second node, so it does not *enforce* one-writer; it makes the data ready for the topology
   that will.

6. **Ordering & referential integrity for free.** Apply strictly in `sync_log.seq` ascending on a
   single lane. Because the origin committed each parent before/with its child and `seq` is assigned
   at write time, seq-order is a topological order of the FK graph (gate 4 part 1) — no runtime
   topological sort. A defensive `23503`-defer (park, retry after the parent's seq) is included as a
   belt-and-suspenders for snapshot/stream overlap, though the single lane should not produce one.

7. **Environment isolation holds across apply** (`CLAUDE.md` §5). Before applying a peer's rows, the
   loop compares the source environment to the local `deployment.environment` (`0010_deployment_stamp.sql`,
   singleton `id=1`) and refuses a mismatch with `sync.peer_environment_mismatch` **before any row
   applies** (gate 8, both directions), so a pre-production database can never seed a production
   mirror.

8. **`sync_log` is tenant-fenced.** It holds every enrolled row's `row_image`, so it carries **FORCE
   ROW LEVEL SECURITY + a tenant-isolation policy** (a new `tenant_id`-bearing table, so the full
   recipe per `CLAUDE.md` §3, hand-written — not `.enableRLS()` alone). The app role holds **INSERT
   only** on it (the capture trigger never reads); a dedicated **`sync_tailer`** role holds SELECT and
   reads per-tenant under `withTenant`. A no-RLS or app-readable `sync_log` would be a cross-tenant
   side-channel (design §6, Copilot 2026-08-02).

---

## 4. Interfaces this slice produces

A new package **`@waitron/sync`** (Node, English/regime-neutral, coverage 98/98/98/95). It owns the
apply code and the outbox migration; the migration attaches triggers to tables in `@waitron/db` and
`@waitron/payments`, so it runs **last** in the migration manifest (all enrolled tables exist by
then).

- **Migration objects** (`packages/sync/drizzle/0000_sync_outbox.sql`, run as the migrator/owner):
  - `sync_log(seq bigint GAI PK, origin_id uuid, table_name text, op text CHECK insert|update|delete,
    tenant_id uuid NOT NULL, row_image jsonb, txid xid8 default pg_current_xact_id(), committed_at
    timestamptz)` — FORCE RLS + `sync_log_tenant_isolation` policy; `GRANT INSERT` to `app_user`,
    `GRANT SELECT` to a new NOLOGIN `sync_tailer` role.
  - `sync_cursor(subscriber_id text, origin_id uuid, last_applied_seq bigint, alive boolean,
    updated_at timestamptz, PRIMARY KEY (subscriber_id, origin_id))` — operational, **no `tenant_id`,
    no RLS** (whole-DB, like `deployment`); readable/writable by `sync_tailer` only. (No `tenant_id`
    keeps it out of the `inmutabilidad` FORCE-RLS scan by construction — §5.)
  - `sync_capture()` — one shared `plpgsql` function, not `SECURITY DEFINER` (runs as the writing app
    role, which holds INSERT on `sync_log`); branches on `TG_OP`; reads `app.node_id` → `origin_id`.
  - One capture trigger per enrolled table, with the ops of §2 and the `WHEN app.sync_apply` guard.
- **`registry`** (`packages/sync/src/registry.ts`) — the enrolment table: per enrolled table its
  `mode` (`insert-only` | `watermark-upsert`), `conflictKey`, `watermarkColumn | null`,
  `captureOps`, and its FK-order rank (derived from the schema, static). The audit surface for "what
  crosses the wire."
- **`applyBatch(subscriberDb, rows, { localEnvironment, sourceEnvironment, subscriberId })`**
  (`packages/sync/src/apply.ts`) — groups rows by `(origin_id, txid)`, and per group opens a
  `withTenant` transaction on `row.tenant_id`, sets `app.sync_apply='on'`, applies each row in `seq`
  order via the registry's static statement, and advances `sync_cursor`. Idempotent; refuses a
  mismatched environment first (`sync.peer_environment_mismatch`); parks-and-retries on `23503`.
- **Apply-SQL generation** (`packages/sync/src/apply-sql.ts`) — the static per-table statement built
  once from the registry (`insert into <t> select * from jsonb_populate_record(null::<t>, $1) …`).
  Table identifiers come only from the fixed registry (reviewed, never runtime-interpolated), so the
  `CLAUDE.md` §3 identifier-escaping question does not arise; the `row_image` binds as one `$1`.
- **Retention/lag** (`packages/sync/src/retention.ts`) — prune `sync_log` to
  `min(last_applied_seq)` across all **alive** subscribers (a down subscriber holds the log; a
  live-only min would lose its unapplied rows — gate 7); `lag = origin_max − last_applied_seq`.
- **Error codes** (`packages/sync/src/errors.ts`, declaration-merged into `@waitron/shared`, domain
  names per `CLAUDE.md` §3): `sync.peer_environment_mismatch`, `sync.table_not_enrolled`,
  `sync.stream_stalled`. Never `sync.trigger_failed`. Each throwing file `import "./errors.js"`.
- **App-path plumbing** — the DB tenant-transaction helper sets `app.node_id` from the server's
  configured local node id, so a locally-originated write carries its origin. (**Assumption to
  confirm at build:** where the running server reads its own node id from. If not yet wired, the
  capture still works — `origin_id` defaults to the all-zero uuid, as the gate function does — but
  origin attribution is incomplete until it is set.)

---

## 5. The guard suites that must pass (the runner MUST run these)

Real Postgres via Testcontainers is REQUIRED for every RLS / non-superuser-app-role / concurrency
test — PGlite connects as superuser and bypasses RLS, so it is a false pass here (`CLAUDE.md` §4).
`TESTCONTAINERS_RYUK_DISABLED=true` is required locally.

- **`pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`** — MANDATORY after adding `sync_log`
  (a new `tenant_id`-bearing table). That suite scans every table with a `tenant_id` column for FORCE
  RLS and would go red if `sync_log` shipped with `.enableRLS()`-equivalent alone
  (`nodes` did exactly that once — `CLAUDE.md` §3). `sync_cursor` carries no `tenant_id`, so it is out
  of that scan by construction.
- **The RLS isolation suites** — `sync_log`'s own tenant-isolation test (cross-tenant row invisible to
  the app role; app role INSERT-only, `sync_tailer` SELECT), plus the existing
  `packages/payments/src/payments.rls.test.ts` and `packages/db` RLS suites unbroken.
- **`@waitron/sync`'s own real-PG suites** — capture + echo-suppression + byte-identity (gate 1),
  the three apply modes incl. DELETE (gates 2/3), seq-order FK integrity (gate 4 part 1), idempotent
  re-delivery with visibly-differing first-vs-repeat deliveries (gate 3), the environment handshake in
  **both** directions (gate 8), and retention under a down subscriber (gate 7) — each with the
  failing case stated before running and a control in the other direction (`CLAUDE.md` §1).
- **`pnpm test:coverage`** for every touched package: `@waitron/sync`, `@waitron/db`,
  `@waitron/payments`, `@waitron/migrations`, and `@waitron/provisioning` (its `instance-apply` RLS
  test may pin migration facts — §6 warns).
- **The tree-wide guards, unfiltered** — `english-only` (adding `@waitron/sync` to `GENERIC_PACKAGES`
  makes `packages/fiscal-verifactu/src/vocabulary-scope.test.ts` red until updated — `CLAUDE.md` §2's
  hardcoded-list trap), the guarded-teardowns guard, and the errors-reachability guard for
  `@waitron/sync`. Run the WHOLE workspace, not just the changed package, because these live in the
  root project and cross-package pins go stale silently under scoped CI.
- **The four-command gate** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, and the
  pre-push hook (which runs `test:coverage` on the changed set).

---

## 6. Decisions resolved, and risks left open

- **Scope boundary (resolved).** Slice 1 = the sales subtree (append-only) + catalogue + the payments
  subtree + `working_orders`/`working_order_lines`; defer `order_amendments` (hash-chained),
  `working_order_counters`, `order_prep`, `incidents`, and the whole fiscal lane. This is the only
  FK-coherent scope that includes the owner-named `payments` and `sales` (both depend on
  `working_orders`), and it exercises all three apply shapes.
- **`sync_log.op` gains `delete` (resolved, with a receipt).** Forced by the commercial lane's DELETE
  grant on working orders — see §2. This corrects the design's fiscal-lane-only "no delete" premise;
  the fiscal lane still enrols with insert/update only.
- **Single ordered lane (resolved).** No `payments` fast lane in this slice; that + the cross-lane
  defer are deferred. Keeps ordering trivially correct (gate 4 part 1).
- **`sync_cursor` is not tenant-scoped (resolved).** It is per-(subscriber, origin) operational state,
  owned by `sync_tailer`, no RLS — mirroring `deployment`. This also keeps it out of the fiscal
  `inmutabilidad` FORCE-RLS scan cleanly.
- **RISK — Group C ownership (park-at-A / retrieve-at-B).** A working order can be parked at one node
  and retrieved/settled at another (design allows retrieve "at any register"), which is a
  cross-origin UPDATE — genuinely *not* single-writer-per-row. This slice does not deploy a second
  node, so it does not hit it; the capture records `origin_id` and apply is seq-ordered and
  idempotent, which is correct for a single origin. The active-active topology slice MUST resolve this
  (route retrieve/settle to the owning node, or model settle as an append-only fact) before two nodes
  write concurrently. Flagged, not solved here.
- **RISK — `app.node_id` source (assumption).** Where the running server reads its own node id is not
  yet traced in this spec; §4 marks it an assumption to confirm at build. Capture degrades gracefully
  (all-zero origin) until it is wired.
- **RISK — catalogue/`payment_policy` writer in active-active.** These are primary-owned
  config-flow-down (design §2). This slice's watermark-upsert apply is correct for a single writer;
  "who may edit config on which node" is the config-flow-down slice's to enforce, not this one's.

# The application-level cross-server sync layer

**Date:** 2026-08-02
**Status:** reviewed with the product owner (2026-08-02); §12 decisions 2/3/5 settled (explicit
`server_id` on the commercial tables, a `payments` fast lane, true active-active for the deli). Not
yet implemented — built after the `server_id` rekey and once the feature schemas settle; the 9
container gates in §11 come first.
**Supersedes:** the held first draft `2026-08-01-sif-sync-replication-protocol-design.md` (branch
`docs/sif-sync-protocol-design`, not on `main`). This document carries that draft forward, corrects
it where a container prototype and a since-settled schema decision change it, and adds the three
things it did not resolve: **how a change is captured from the peer**, **the apply-ordering rule the
FK graph forces**, and **the single reusable enrolment mechanism** every domain opts into.

**Decides:** how the two active-active local servers (each its own SIF) and the cloud mirror carry
each other's rows — what captures a change, what applies it, in what order, idempotently,
conflict-free — over an append-only, immutable, FORCE-RLS ledger, using **only the non-superuser,
non-BYPASSRLS deployment role**.

This spec inherits its topology from `2026-08-01-local-server-sif-and-failover-design.md` (#33) and
does not relitigate it. Where a fiscal fact is load-bearing it is cited to #33's sourced §12 table or
to the real schema by `file:line`, per `CLAUDE.md` §1.

> **Landing log — 2026-08-11: Slice 1 (commercial lane) landed** on branch
> `feat/sync-slice1-commercial-outbox`. Built the `@waitron/sync` package — the `sync_log` outbox
> (`0000_sync_outbox.sql`) with one generic `sync_capture()` trigger over the **14 non-fiscal enrolled
> tables** (spec `2026-08-08-sync-slice1-commercial-outbox-spec.md` §2), the enrolment `registry`,
> static per-table apply SQL, an idempotent seq-ordered `applyBatch` loop (app role under `withTenant`,
> echo-suppressed, with the environment handshake and the `23503`-defer), bounded retention, and
> `app.node_id` origin attribution threaded through the till write path. Proven on real Postgres as the
> non-superuser app role. Body of this design NOT rewritten — corrections and receipts below.
>
> **Corrections this implementation made to the design/spec (each with a receipt, `CLAUDE.md` §1):**
> - **`sync_log.op` gained `'delete'`** (`check (op in ('insert','update','delete'))`), correcting the
>   §6 schema's fiscal-lane-only *"no delete: no table grants DELETE"* premise. The commercial lane's
>   `working_orders`/`working_order_lines` hold DELETE (`0004_working_orders.sql:73,75`) and a line
>   removed from an open order is a real exercised DELETE, so the capture branches on `TG_OP` and the
>   apply path performs an idempotent delete. The fiscal lane still enrols insert/update only.
> - **The `inmutabilidad` FORCE-RLS guard does NOT cover `sync_log`.** The 2026-08-08 spec §5 asserted
>   it would; verified false — `inmutabilidad.test.ts` migrates only `core+identity+fiscal` on PGlite,
>   so `sync_log` is never in its database (and cannot be: the capture triggers reference `payments`
>   etc., absent there). The real FORCE-RLS guard for `sync_log` lives in the sync package itself
>   (`capture.gate.test.ts` asserts `relforcerowsecurity=true` on `sync_log` directly).
> - **Retention prunes to `min(last_applied_seq)` across ALL `sync_cursor` rows, not "alive only."** The
>   spec §4 prose said "across all alive subscribers", which is self-contradictory (its own next clause
>   calls the live-only min the data-loss bug). Gate 7's measured numbers are authoritative: a
>   down-but-present subscriber HOLDS the log at its cursor; `alive` is alarm metadata, never a prune
>   filter. Cross-tenant prune needs a dedicated `sync_retention` NOLOGIN role + a per-role permissive
>   policy (`0001_sync_retention.sql`, the `payments_webhook_resolver` house pattern) — `sync_tailer`
>   stays per-tenant fenced.
>
> **Still deferred to later slices (unchanged):** the whole **fiscal lane** (hash-chained/immutable
> `registros_facturacion` + submission state), the **`payments` fast lane** and its cross-lane defer
> (§9/§12), the **active-active topology / promotion / failover** (§8, #33), and **config-flow-down**
> of the reference tables (`tenants`/`locations`/`tills`/`nodes`/`invoice_series`). Slice 1 records
> `origin_id` per row so the topology enrols later without a rewrite.

---

## 0. The one thing the prototype settled, and why it drives everything below

A container prototype (`replication-force-rls-prototype-findings.md`, 2026-08-02, `postgres:18-alpine`
/ PostgreSQL 18.4, two instances, `wal_level=logical`) proved, with a re-runnable receipt:

- **Native Postgres logical-replication _apply_ cannot write into an RLS-enabled relation as a
  non-BYPASSRLS role.** The apply worker fails `cannot replicate into relation with row-level
  security enabled: "registros_facturacion"` *before evaluating the policy* — so a per-role
  `app.tenant_id` default does not rescue it (Stage 2), and there is a *second, independent* gate:
  with the table owned by someone else, apply fails `cannot SET ROLE to "postgres"` (Stage 3b). Both
  clear only under BYPASSRLS/superuser (Stage 3) — exactly the constraint the deployment role forbids
  (`packages/db/drizzle/0001_tenancy_rls.sql:15-26`; `packages/provisioning/src/instance-plan.ts:217`
  refuses a superuser/BYPASSRLS role outright). This is categorical and applies to **all ~8
  RLS-enabled tables**, not just the fiscal chain.
- **Application-level INSERT works** (Experiment 1): the non-BYPASSRLS `app_login` role, with
  `app.tenant_id` set the way `withTenant` sets it (`packages/db/src/tenancy.ts:39-42`), inserts a
  foreign server's same-tenant registro **verbatim** under FORCE RLS — huella and chain pointers
  stored exactly as supplied, no recompute — while a cross-tenant insert is correctly rejected (1b
  fails, 1c succeeds: the control disagrees, so RLS was genuinely in force).

**Consequence, taken as fixed for this whole document:** the sync layer's *apply* path is
application-level — our process inserts each foreign row as the ordinary app role with that row's
tenant context set. The only remaining design freedom is in **change capture** (§3), and every other
section is written to keep the apply path inside the box Experiment 1 proved.

---

## 1. What this must satisfy (inherited from #33, not re-decided)

- **Partitioned-write active-active with full cross-replication, NOT multi-master** (#33 §4). Each
  local server is one SIF and the *sole writer of its own half*; both hold the union; every row has
  exactly one writer, so no conflict-resolution rule ever comes near the chain.
- **Async replication is sufficient for chain correctness** (#33 §3): a standby never resumes a dead
  server's chain, so a fork or a reused number is structurally impossible across two SIF identities.
  Lag costs only a durability tail — a tuning knob, not a correctness question.
- **A single relocatable submitter** holds the certificate and files every chain's records (#33 §6);
  one flow-control clock per obligado (60 s / 1,000 per envío — #33 §12).
- **Human-driven failover**, at most one primary at a time (#33 §8); selling never blocks on the
  primary role.
- **A dedicated cloud server may hold any role, including issuing** (#33 §9) — the §11 hosting
  question, referenced not answered.
- **Nothing external blocks a sale** (#33 §2, rewriting `CLAUDE.md` §5): the sync layer must never sit
  on the sale path. Capture is same-transaction and cheap; *shipping and applying* are asynchronous.

**The settled schema decision this draft is built on.** #33 says the SIF is the **server**; the schema
today keys the fiscal identity per **till** and has no server concept. That gap is now closed by a
recorded decision (2026-08-01, backlog PR #40): the server-as-SIF implementation adds a real
**`server_id` column** and re-keys the fiscal tables (`registro_sif`, `cadenas`,
`registros_facturacion`, `invoice_series`) to the server — it does **not** overload `till_id`. No
backwards-compat (pre-production). **This corrects the held draft's §4, which recommended reusing
`till_id`.** Throughout this document the write-partition key is the **owning server** (`server_id`);
where a fiscal table's uniqueness index reads `till_id` today, read it as `server_id` post-rekey. The
rekey is still a prototype gate for the *implementation* spec (confirm the chain-append path and
`record-sale.ts`'s series↔till check behave under server-keying); it is not this protocol's to prove,
but §11 lists it because the partition map depends on it.

---

## 2. The ownership map — one writer per row, named per table

Replication is one-way *per row*, from its owner to every mirror; the owner is fixed at write time.
This table is the spine of the protocol. It **corrects the held draft's omission of `sales` and
`working_orders`** — both carry NOT-NULL foreign keys *into which* other replicated rows point
(`registros_facturacion.sale_id` NOT NULL → `sales.id`, `registros.ts:61-63`;
`payments.working_order_id` NOT NULL → `working_orders.id`, `payments.ts:56,94-98`), so they must
replicate before their referents (§4).

Mutability is a **grant fact**, verified in the migrations, not a design intention — it decides
whether the apply path may `UPDATE` at all:

| Table | Owner (sole writer) | Partition key | App-role grant (mirror capability) | Apply mode (§5) |
| --- | --- | --- | --- | --- |
| `tenants`, `locations`, `tills` | **primary** (config flows down, #33 §5/§7) | tenant | `SELECT,INSERT,UPDATE` (`0001_tenancy_rls.sql:102-106`) | config-flow-down, watermark upsert |
| `invoice_series` (definition + `next_number`) | the **owning server** | `(tenant, server, code)` (today `till`, `series.ts:52`) | `SELECT,INSERT,UPDATE` (mutable counter) | watermark upsert |
| `working_orders`, `working_order_lines` | the **selling server** | server (via till) | mutable (state machine, `orders.ts:33-65`) | watermark upsert |
| `sales`, `sale_lines`, `tenders`, `sale_settlements` | the **selling server** | server (via series/till) | **`SELECT,INSERT` only — no UPDATE** (append-only, `sales.ts:66-68,116`) | **INSERT-only**, `ON CONFLICT DO NOTHING` |
| `sale_voids` | the selling server | server | append-only, full four-part recipe (`sale-voids.ts`) | **INSERT-only** |
| `registro_sif` (SIF identity) | the **server** that minted it | `(tenant, server)` live-partial-unique (today `till`, `sif.ts:53-55`) | `SELECT,INSERT,UPDATE` (`0001_registros_inmutables.sql:60`) | watermark upsert (revocation) |
| `cadenas` (chain head) | the server that owns that chain | `(tenant, server)` (today `till`, `cadenas.ts:44`) | `SELECT,INSERT,UPDATE` (`:58`) | watermark upsert **or derive** (§5) |
| `registros_facturacion` | the **selling server** whose SIF chained it | server / chain | **`SELECT,INSERT` only — no UPDATE** (`:50-51`); FORCE RLS (`:16`); append-only trigger `BEFORE UPDATE OR DELETE` (`:75-77`) + TRUNCATE block (`:81-83`), SQLSTATE WT001 | **INSERT-only, verbatim**, `ON CONFLICT (id) DO NOTHING` |
| `envios` (submission state) | the **submitter** (primary) — one global writer for *both* chains | whole table | `SELECT,INSERT,UPDATE` (`:62`) | watermark upsert; ownership **relocates with the submitter** (§8) |
| `envio_flujo` (flow control) | the submitter | `tenant` (`envio-flujo.ts`) | `SELECT,INSERT,UPDATE` (`0003_envio_flujo_rls.sql:32`) | watermark upsert; relocates with submitter |
| `acks` (ack outbox) | the submitter (written with the estado it reflects) | `tenant` (`acks.ts`) | `SELECT,INSERT,UPDATE` (`0006_acks_rls.sql:32`) | watermark upsert |
| `payments`, `payment_refunds`, `payment_policy` | the **initiating** server (`resolvePending` is per-initiator, #33 §10) | `(tenant, provider, payment_ref)` unique (`payments.ts:92`) | `SELECT,INSERT,UPDATE` (`0001_payments_rls.sql:30`) | watermark upsert on `updated_at` |
| `incidents` | the server that raised it; reconcile-incidents on the primary | tenant / raiser | mutable via **column-level** GRANT (`acknowledged_at/_by` only, `incidents.ts` + `0008_incidents_privileges.sql`) | watermark upsert (ack fields only) |
| sealed credentials (`tenant_credentials`) | the **primary** | tenant | config-flow-down; **key ring never in cloud** (#33 §9) | watermark upsert of the *sealed blob* (§8) |
| `contadores_instalacion` | the **cloud allocator** (cloud-storage §6a) | `(nif, id_sistema_informatico)` — **no `tenant_id`, no RLS** (`sif.ts:75-83`) | pre-allocated ahead of time (#33 §8) | **not peer-streamed** — §7 |
| `deployment` (env stamp) | provisioning, once | whole DB — **no RLS** (`0010_deployment_stamp.sql`) | **not replicated as data** — it is the §10 handshake guard | n/a |

Two facts fall straight out and drive the rest:

1. **The immutable ledger fans _out_ from many writers; its submission state funnels _in_ to one.**
   `registros_facturacion` is written by every selling server; `envios`/`envio_flujo`/`acks` are
   written only by the submitter, for *every* record including ones a peer chained. §8 is that funnel.
2. **The append-only tables carry no UPDATE grant to the app role** (`sales`, its children,
   `sale_voids`, `registros_facturacion`). On the mirror this is not a discipline — it is enforced by
   the same grant that protects the origin. An INSERT-only apply path is therefore the *only* path the
   grant permits, which is exactly right for an append-only ledger.

---

## 3. Decision — change capture: an application outbox (change-log), tailed by the peer

Three mechanisms were considered. Apply is application-level regardless (§0); this is only about how a
peer *learns* a row changed.

### (a) Native logical DECODING + application-level apply

A replication slot (`pgoutput`/`wal2json`) consumed by **our** process, which then INSERTs each change
as the app role with tenant context. The prototype's block was on the native apply *worker writing*;
*reading* a slot is a different operation and was **not** tested — so this is not ruled out by the
prototype. It is attractive: WAL-sourced capture is exact, totally ordered, transactional, and
**couples to no domain write path**.

**But it is gated on an unproven, wide privilege.** Consuming a logical slot needs the `REPLICATION`
role attribute (for the streaming `START_REPLICATION` path) or `pg_create_subscription` +
`EXECUTE` on the slot functions (for the SQL `pg_logical_slot_get_changes` path). **Prototype-gated
assumption — do NOT assert it works:** whether a non-superuser can create and drain a logical slot at
all under PG16+ must be *measured in a container*, not reasoned about (`CLAUDE.md` §1). Even if
grantable, `REPLICATION` is a cluster-wide privilege that also permits physical base-backup of the
*entire* cluster — a security-posture widening in the same spirit as the BYPASSRLS the design
forbids, and one the provisioner would have to be taught to grant. That cost is real and is the reason
this is not the recommendation.

### (b) Application outbox / change-log table, tailed by the peer — RECOMMENDED

A single append-only **`sync_log`** table, one row per change to an *enrolled* table, written **in the
same transaction as the domain write** by a generic capture trigger (§6), and tailed by each
subscriber. This is the transactional-outbox pattern, and it is the shape the architecture already
speaks in: `2026-07-18-pos-architecture-design.md` §5 defines "a local store, an outbox, and
optionally an upstream … one sync implementation, tested once," and `envios`/`acks` are already
described in-tree as outboxes (`envios.ts:22-28`, `acks.ts:6-12`).

Why it wins here specifically:

- **It stays entirely inside the proven model.** The trigger writes `sync_log` as the same app role,
  in the same txn; the tailer reads it and applies via `withTenant` (§0, Experiment 1). **No new
  privilege, no `REPLICATION`, no BYPASSRLS, no policy carve-out.** Nothing that the prototype or the
  provisioner refuses.
- **It is one reusable mechanism** (§6) — the whole point of the exercise (design Q6). A domain enrols
  a table by attaching the trigger and registering an apply mode; fiscal, payments, config, workforce
  all use the identical path.
- **Capture is exact and totally ordered for free.** `sync_log.seq` (a `bigint GENERATED ALWAYS AS
  IDENTITY`) gives a per-origin total order that already respects causality: a child row is written in
  the same or a later transaction than its parent, so its `seq` is strictly higher — which §4 turns
  into referential-integrity-for-free.
- **It makes the peer path and the cloud-ingest path identical** (cloud-storage §9): the cloud is
  just a third subscriber to the same streams (§9).

Cost, stated honestly: capture is coupled to the **schema** (a trigger + one log table + an echo-guard
GUC), and `sync_log` is write-amplification on every domain write (one extra insert per row). Both are
bounded and are the price of staying inside the non-superuser box.

### (c) Polling a monotonic change marker

Each table carries an `updated_at`/sequence; the peer polls for rows past its high-water. Rejected as
the primary mechanism: it needs a marker column on *every* table (several append-only tables have only
`creado_en`/`created_at`, workable, but the mutable ones need a reliable monotonic `updated_at` that
the write path must never forget to bump — a per-domain coupling worse than a trigger), it gives no
transactional grouping, and its ordering is per-table not causal, so it reintroduces the FK-ordering
problem (§4) that (b)'s single `seq` removes. It is, however, the natural **fallback inside** (b): the
subscriber's cursor *is* a monotonic-marker poll over the one `sync_log` table, which is why (b) needs
markers on exactly one table instead of twenty.

### Recommendation

**(b), the application outbox.** It is the only option that stays entirely within the proven
non-superuser + `withTenant` model with no new privilege, is one mechanism every domain enrols into,
and gets exact transactional capture and a causal total order for free. **(a) is left open as a
possible transport optimisation for the one-time bulk backfill only** (§7), where the RLS/trigger
concerns are supervised and one-off — and only if prototype gate §11.6 (non-superuser slot
consumption) passes. **(c) survives as the subscriber's cursor over `sync_log`**, not as table-wide
capture.

---

## 4. Ordering & referential integrity — parent rows before their referents

The held draft had no apply-ordering rule; the FK graph forces one, and this is the gap the scout
flagged (`registros`/`payments` carry NOT-NULL FKs into `sales`/`working_orders`, which the held
ownership map omitted).

**The FK graph (parents → children), derived by inspection of the schema:**

```
deployment            (env stamp — handshake only, not replicated, §10)
tenants               (root; nif unique)
 └─ locations         → tenants
     └─ tills         → tenants, locations
invoice_series        → tenants, tills(→server)
registro_sif          → tenants, tills(→server)
working_orders        → tenants, tills(→server)
 └─ working_order_lines → working_orders (composite tenant+order)
sales                 → tenants, tills, invoice_series           (all NOT NULL)
 ├─ sale_lines / tenders / sale_settlements / sale_voids → sales (composite, NOT NULL)
registros_facturacion → tenants, tills, registro_sif, sales      (ALL NOT NULL — registros.ts:49-63)
 ├─ envios            → registros (PK = registro_id), tenants     (envios.ts:35-40)
 ├─ acks              → registros, tenants                        (acks.ts:16-19)
 └─ cadenas.ultimo_registro_id → registros (NULLABLE — cadenas.ts:29)
payments              → tenants, working_orders(NOT NULL), sales(NULLABLE)  (payments.ts:56-59,94-104)
incidents             → tenants, tills, sales(NULLABLE)           (incidents.ts:32-37)
```

**The rule.** *Apply changes in the origin's commit order (`sync_log.seq` ascending), in a single
ordered lane per origin.* Because the origin committed each parent before (or with) its child, and
`seq` is assigned at write time, seq-order **is** a topological order of the FK graph — no separate
topological sort is needed at apply time. This is the primary guarantee.

**The backstop, for when a lane is split.** If a subscriber runs more than one lane (§9 recommends a
faster lane for `payments`), two lanes can reorder a cross-lane parent/child pair. Handle it by
*deferring on a foreign-key violation*: an apply that raises `23503 foreign_key_violation` is parked
and retried after the referenced parent's `seq` has been applied. Never widen a grant or drop a
constraint to make it land — the constraint is the thing proving the copy is complete. A
`cadenas.ultimo_registro_id` pointing at a registro not yet mirrored is the common transient case; it
resolves on the next sweep because the head only ever advances forward.

Derive the enrolled-table order (and the deferred-retry parent lookup) from the FK graph **once, at
enrolment**, not at runtime — it is a static property of the schema (§6).

---

## 5. Applying a foreign row: as the app role, with tenant context

The apply primitive, proven in Experiment 1 and generalised here. Every apply runs inside
`withTenant(db, row.tenant_id, …)` (`packages/db/src/tenancy.ts:34-43`), which issues
`select set_config('app.tenant_id', $1, true)` — so `current_tenant_id()` resolves to the row's
tenant and the FORCE-RLS `WITH CHECK (tenant_id = current_tenant_id())` passes
(`0001_registros_inmutables.sql:25-28`). For the non-tenant tables (`contadores`, `deployment`) this
path is not used (§7, §10).

**Both servers of a venue share one `tenant_id`** — one NIF, one obligado (`tenants.ts:5-17`); the two
SIFs are distinguished by `server_id`/series, not by tenant. That shared tenant is what makes the RLS
check pass symmetrically in both directions and lets the cloud mirror hold both SIFs' rows under one
tenant. (The "same NIF in several databases" case, cloud-storage §6a, is *multi-venue* — a different
axis.)

**Reconstruct the row generically, but with a static per-table statement.** The apply worker does not
string-concatenate SQL (`CLAUDE.md` §3). It parameterises the whole `row_image` jsonb and lets
Postgres expand it:

```
-- INSERT-only (append-only tables): idempotent, verbatim
insert into registros_facturacion
select * from jsonb_populate_record(null::registros_facturacion, ${rowImage})
on conflict (id) do nothing;
```

`${rowImage}` binds as one `$1` parameter; `jsonb_populate_record` maps keys→columns with the table's
own types. The **statement text is generated once per enrolled table at enrolment** (static
identifiers, reviewed — never runtime-interpolated), so the generic machinery carries no dynamic
identifier and the §3 identifier-escaping question never arises.

### Append-only tables — INSERT-only, verbatim, no recompute

`registros_facturacion`, `sales`, `sale_lines`, `tenders`, `sale_settlements`, `sale_voids`. The
mirror's app role holds **only `SELECT,INSERT`** on these (`0001_registros_inmutables.sql:50-51`;
`sales.ts:66-68`), so INSERT-only is enforced by the grant, and the append-only trigger fires
`BEFORE UPDATE OR DELETE` only (`:75-77`) — it never obstructs an INSERT.

- **Replicate the source primary key; never regenerate it.** `registros.id` is
  `uuid().defaultRandom()` (`registros.ts:48`); the mirror inserts the *same* `id`, so re-delivery is
  idempotent via `ON CONFLICT (id) DO NOTHING` **and** cross-row references survive the copy
  (`envios.registro_id`, `acks.registro_id`, `cadenas.ultimo_registro_id` all point at it —
  regenerating the id would orphan all three).
- **Copy `huella`, the four `anterior_*` fields, and `entorno` verbatim; never recompute.** The stored
  `huella` *is* the hash and `cuota_total`/`importe_total` are `text` for exactly that byte-identity
  reason (`registros.ts:79-89,106`); `entorno` is ours and deliberately **not** in the huella
  (`registros.ts:113-118`; `CLAUDE.md` §5 — "never put our own metadata into a hash"). Experiment 1
  confirmed the row lands with `BBB…B1`/`CCC…C2` stored exactly as supplied. INSERT-verbatim honours
  both without the apply path knowing the hash rules at all.

### Mutable tables — upsert by owner-assigned key, guarded by a watermark

`cadenas`, `registro_sif`, `invoice_series`, `envios`, `envio_flujo`, `acks`, `payments`,
`payment_refunds`, `payment_policy`, `incidents`, config/catalogue. The mirror holds `UPDATE` on these
(verified per row in §2). Apply is:

```
insert into payments (...) select * from jsonb_populate_record(null::payments, ${rowImage})
on conflict (id) do update set ... = excluded....
where excluded.updated_at > payments.updated_at;      -- watermark: never regress
```

The `WHERE excluded.updated_at > …` guard makes a late or re-delivered older image a no-op — the
mirror never moves backward. `payments.updated_at` exists for this (`payments.ts:84`); `cadenas` has
`actualizado_en`, `envios` has no single monotonic column, so the watermark for `envios`/`acks` is the
originating `sync_log.seq` carried on the log row (monotonic by construction), not a table column.
`incidents` is special: the app role may UPDATE **only** `acknowledged_at/_by` (column-level grant,
`0008_incidents_privileges.sql`), so its apply statement sets only those columns on conflict.

**`cadenas` may instead be _derived_, not replicated.** The chain head is a cache of "max `secuencia`,
last `huella`, last registro id" over the mirrored `registros` of that chain (`cadenas.ts:6-14`
documents it as derivable). On a mirror — which never appends to a foreign chain — deriving it from
the already-mirrored registros is drift-proof (single source of truth = the immutable rows) and avoids
a mutable-table apply for the one place a mutable head shadows an append-only body. **Recommendation:
replicate `cadenas` via the watermark upsert for uniformity, but treat derive-from-registros as the
sanctioned fallback if watermark drift ever appears in the prototype.** Either keeps the mirror's head
consistent; deriving cannot drift.

---

## 6. The generic enrolment mechanism — "server-owned-and-cross-replicated" as one thing

This is the reuse the whole exercise is for (design Q6). A table becomes a replicated, server-owned
partition by **three** declarations, and nothing bespoke per domain.

**(i) A `sync_log` transport table (one, whole DB), tenant-fenced.** It holds every enrolled row's
`row_image`, so it MUST carry **FORCE ROW LEVEL SECURITY with tenant isolation** (`tenant_id NOT NULL`
— only tenant-scoped tables are enrolled, per "not enrolled by construction" below; the `WITH CHECK
(tenant_id = current_tenant_id())` policy mirrors the source tables). This is the opposite of the
no-RLS `deployment`/`contadores` pattern: a no-RLS `sync_log` the app role could `SELECT` would be a
**cross-tenant side-channel** — one tenant's app role reading another tenant's data, bypassing the RLS
that protects the source tables (Copilot review, 2026-08-02). Grants: the writing **app role holds
`INSERT` only** (for the capture trigger — it never needs to read the log); `SELECT` is held by a
dedicated **sync-tailer role** that reads per-tenant under `withTenant` (one tenant on a local server;
the cloud mirror iterates tenants). Owned by the migrator:

```
sync_log (
  seq          bigint generated always as identity primary key,  -- per-origin total order (§4)
  origin_id    uuid   not null,          -- which server produced this change (server_id / node id)
  table_name   text   not null,
  op           text   not null check (op in ('insert','update')),  -- no 'delete': no table grants DELETE
  tenant_id    uuid   not null,          -- FORCE RLS tenant isolation; for withTenant on apply (only tenant-scoped tables are enrolled)
  row_image    jsonb  not null,           -- to_jsonb(NEW); text columns stay text → byte-identical huella
  txid         xid8   not null default pg_current_xact_id(),   -- group one source txn's rows
  committed_at timestamptz not null default clock_timestamp()
)
```

**(ii) A generic capture trigger, attached per enrolled table.** `AFTER INSERT` (append-only tables)
or `AFTER INSERT OR UPDATE` (mutable tables), `FOR EACH ROW`, calling one shared function that writes
one `sync_log` row from `to_jsonb(NEW)` and `NEW.tenant_id`. `to_jsonb` preserves `text` columns as
JSON strings, so `huella` and the amounts stay byte-identical (the §5 verbatim requirement). The
function raises no new privilege — it runs as the writing app role, which holds `INSERT` on
`sync_log`. This mirrors the shared `reject_mutation()` design: one function, keyed on
`TG_TABLE_NAME`/`TG_OP`, covering every enrolled table with no per-table body
(`0001_registros_inmutables.sql:70-77`).

**Echo suppression (the A→B→A guard #33 §4 named).** The apply worker sets a txn-local GUC before it
writes — `select set_config('app.sync_apply', 'on', true)` — and the capture trigger is declared
`WHEN (current_setting('app.sync_apply', true) is distinct from 'on')`, so a *replicated* write is
**not** re-captured into the local `sync_log`. This is the origin filter, done inside the proven model
with a GUC exactly like `app.tenant_id`. Prototype-gated: confirm the `WHEN` clause reads the GUC set
in the *same* transaction (§11.1).

**(iii) An enrolment registry (code, generated once).** Per enrolled table: its **apply mode**
(`insert-only` | `watermark-upsert` | `config-flow-down`), its **watermark column** (or "use
sync_log.seq"), its **conflict key**, and its **FK-order rank** (§4, derived from the schema). From
this registry the build generates: the static per-table apply statement (§5), the capture-trigger DDL,
and the deferred-retry parent map (§4). A new domain enrolls a table by adding a registry entry and a
migration that attaches the trigger — it writes no sync code.

**Not enrolled, by construction:** `deployment` (handshake, §10), `contadores_instalacion`
(cloud-allocator-owned, pre-allocated, §7), and any table with no `tenant_id` that is not
single-writer-global. Enrolment is opt-in; the registry is the audit surface for "what crosses the
wire."

Error codes this layer raises follow `CLAUDE.md` §3 — name the **domain concept**, not the package:
`sync.peer_environment_mismatch` (§10), `sync.origin_series_overlap` (§8), `sync.apply_deferred` — not
`sync.trigger_failed`. Each throwing file imports its registry (`import "./errors.js"`).

---

## 7. Bootstrapping / initial sync — full copy, then stream

A fresh or reimaged second server (or a new cloud mirror) catches up before it streams:

1. **Reserve identity first.** A reimaged/new server mints a **fresh SIF** — a new
   `numero_instalacion` from the cloud allocator's `contadores_instalacion`
   (`sif.ts:75-83`), pre-allocated while the link is up (#33 §8). Re-registering a till/server starts
   a *new* chain (`CLAUDE.md` §5); it never resumes the peer's.
2. **Snapshot the peer's owned partition.** Read the peer's rows (a consistent `SELECT`/`COPY` at one
   snapshot LSN) **in FK order** (§4) and apply them through the *same* app-level apply path (§5) —
   INSERT-only for append-only tables, upsert for mutable — under `withTenant`. Record the peer's
   `max(sync_log.seq)` at snapshot time as the streaming start cursor.
3. **Switch to streaming** from that cursor: tail `sync_log` past the high-water. Because apply is
   idempotent (§5) and ordered (§4), a small snapshot/stream overlap is harmless — re-delivered rows
   hit `ON CONFLICT DO NOTHING` or the watermark no-op.

**Option (a) native decoding may serve step 2's bulk backfill** if §11.6 passes — a one-time,
supervised copy where the RLS-under-apply concern is bounded — while step 3 stays on the outbox. This
is the one place the native path is worth keeping open.

The snapshot itself is subject to the §10 environment handshake: a mismatched-environment peer is
refused *before* any row is read, so a pre-production database can never seed a production mirror.

---

## 8. The relocatable submitter — the funnel-in, cert resolution, no double-submit

`envios`/`envio_flujo`/`acks` have a single global writer, the submitter (§2), which files *every*
chain's records including a peer's. Two guarantees across a relocation:

**Certificate resolution — unseal a replicated blob with a node-local key ring.** The certificate
lives in `tenant_credentials` as an AES-GCM sealed blob and **the cloud never holds the key ring**
(cloud-storage §6; #33 §9). So the sealed blob is ordinary replicated config data (watermark upsert,
§5), but only a node with the operator's key ring *present* can unseal it. The submitter resolves its
certificate by unsealing the mirrored blob with the node-local key ring; a node without it cannot
submit, by construction — which is why the submitter role and the key ring co-locate on the primary
(#33 §9). No certificate ever travels *as a secret* over the sync channel.

**No double-submission across a move — defence in depth, not a new mechanism.**

1. **The one-primary invariant is the primary guard** (#33 §8): the submitter is a singleton role;
   two submitters coexist only in the same window as two primaries (§ below), which is detected and
   collapsed.
2. **Replicated `envios` state is the soft coordinator.** `envios` already claims each record —
   `pendiente → enviando → aceptado/…`, a stuck-`enviando` row reclaimed only after
   `RECUPERACION_ENVIANDO_MS` = 5 min (`packages/fiscal-verifactu/src/drain.ts`). Because `envios`
   mirrors, a row a departing submitter marked `enviando` is visible to the arriving one, which does
   not re-claim it inside the window. This holds only while replication lag < the reclaim window — a
   **tuning relationship to prototype** (§11.4), not a correctness guarantee.
3. **AEAT error 3000 is the hard backstop.** A record submitted twice is rejected as duplicate
   (#33 §12), which the drainer already handles. Worst case of a botched relocation is a wasted
   round-trip and a 3000 — never a corrupted chain or a lost record.

The no-orphans duty (#33 §6/§12) makes draining the *dead server's* un-submitted tail mandatory; the
relocated submitter sweeps every chain's backlog, which it can because those registros mirrored to it
(§5) and `envios` is written by whoever currently holds the submitter role.

**Conflict detection and the one-primary invariant** (this spec fixes *what* is detected; #33 §8 fixed
*that* it is continuous and human-arbitrated). Three divergences, descending severity:

1. **Two primaries** (dual-designation / healed partition). The "I am primary" claim rides the sync
   channel; on detection, #33 §8's fixed tie-break demotes the loser (still selling). Shown to a
   human: which node held the submitter, what each filed in the overlap.
2. **Series overlap** — the *only* thing that breaks #33 §3's non-catastrophic guarantee. If a
   mirrored registro's `num_serie_factura` falls in a series this server owns, the disjoint-series
   invariant (below) was violated by misconfiguration. Caught as a `registros_identidad_uq` conflict
   (`registros.ts:143-149`) or an explicit range check on ingest, raised as
   `sync.origin_series_overlap`. Unrepairable in the chain (numbers never reused, `CLAUDE.md` §5), so
   the signal is a provisioning alarm, not a fix. Shown to a human: the colliding records and AEAT's
   3000 responses.
3. **Config divergence** — non-fiscal, versioned, merge-resolvable by hand (#33 §8). Shown to a human:
   a merge view of the two config versions.

**Disjoint series is enforced by distinct series _codes_ per server, not numeric ranges** (carried
forward from the held draft §3, still correct). AEAT identity is `(NIF, NumSerieFactura,
FechaExpedicionFactura)`; two servers issuing "series A, number 1005" on one day collide even with
separate chains (#33 §3/§12). Give each server its own series *codes* (an A-marker vs a B-marker) so
`NumSerieFactura` differs at the coarsest, most legible dimension — the collision is removed
structurally, not by arithmetic a mis-set boundary can silently reintroduce. `IdEmisorFactura` cannot
distinguish them (it is the NIF, identical). The series set is allocated at provisioning (config, owned
by the primary, flowed down); thereafter each server advances only its own `next_number`, single-writer,
so the mirror copy is never merged — a counter that looks "behind" is lag, never a value to reconcile.
**The marker convention is a product decision** (§12): it appears on the customer's factura and
interacts with the asesor's reshaped Q5(a) (#33 §11). Do **not** edit `asesor-questions.md` until #33
lands.

---

## 9. Conflict-freedom, the cloud mirror, and monitoring

### Conflict-freedom by construction

Because server A is one SIF and server B another, **their write-sets are disjoint** (#33 §4): the
partition key is the **owning server** (`server_id`, §1), and each server writes only its own
partition. There is no row two servers both write, so no conflict-resolution rule exists anywhere —
last-write-wins never touches the chain. The apply path's `ON CONFLICT` clauses (§5) therefore only
ever de-duplicate *re-deliveries of one owner's row*, never adjudicate between two writers. The
**single-writer-global exceptions** (§2) flow one way and so are also conflict-free: config/catalogue
and sealed credentials flow *down* from the primary (read-only on receivers); `envios`/`envio_flujo`/
`acks` funnel *in* to the submitter; `contadores_instalacion` is written only by the cloud allocator
and pre-allocated (§7). The two places this can *break* are exactly the two the design already fences:
a botched dual-primary (§8, config divergence, merge-resolvable) and a series-code misconfiguration
(§8 class 2, alarmed). Neither is silent.

### The cloud mirror

Same mechanism, differing only downstream (design Q8):

- **Recommended default — passive cloud tertiary.** A third subscriber to the same per-owner
  `sync_log` streams, applying via the cloud-ingest role (cloud-storage §9: `INSERT`-only on the
  append-only ledger, derived grants on the mutable tables). It holds the union, **files nothing**,
  and is promoted only if both local boxes die (#33 §9) — at which point role resolution makes it a
  primary with the key ring injected (§8). It is **read-only downstream**: it never originates a
  change, so it runs no capture trigger and writes no `sync_log`.
- **Dedicated single-tenant cloud server holding a write role** participates as a *full peer* in §2's
  ownership map — it can own a write partition (active-active secondary) or hold the primary/submitter
  role with the certificate standing in the cloud. Then it *does* capture and originate, identically
  to a local peer; it differs only in reachability (unreachable during an internet outage, #33 §9) and
  in where the key ring sits. This is the §12 hosting question.

The cloud never introduces a conflict-resolution rule — it is a read-only mirror of every owner's
partition, exactly like a local peer's mirror half.

### Monitoring, lag, back-pressure, failure

- **Lag** per subscriber = `origin max(sync_log.seq) − subscriber last_applied_seq`, tracked in a
  `sync_cursor(subscriber_id, origin_id, last_applied_seq, updated_at)` table. The **durability tail**
  (#33 §3/§5) is the origin rows committed but not yet shipped — bounded by this lag; a fast
  `payments` lane (§ below) shrinks the customer-money slice of it.
- **Stuck-stream detection.** `last_applied_seq` not advancing while origin `seq` climbs, or a growing
  count of FK-deferred rows (§4), raises `sync.stream_stalled`. The pre-push/monitoring surface reads
  the cursor, not a log file (`CLAUDE.md` §4 — reproduce, do not read a stale log).
- **Back-pressure / retention.** `sync_log` is pruned only up to `min(last_applied_seq)` **across all
  live subscribers** — the confirmed-flush discipline a native slot uses, done in the application. A
  **down subscriber therefore holds the log** and it grows on disk until it returns or is declared
  dead. This is bounded by disk and **monitored**, and *when to alarm vs when to evict a dead
  subscriber is a product decision* (§12). This is the deliberate trade for at-least-once delivery
  with no data loss.
- **A separate fast lane for `payments`.** `payments` directly bounds a customer-money exposure (the
  double-charge window, #33 §10), while the fiscal chain is indifferent to lag (#33 §3). Recommend a
  tighter replication interval for the `payments` partition than the fiscal lane — a real second
  cadence to build and tune, and the reason §4 needs the cross-lane FK-defer backstop.

---

## 10. Environment isolation carries across the sync boundary

The one-database-per-environment invariant (`CLAUDE.md` §5) must hold across replication, or a
pre-production server's records leak into a production peer's series and burn numbers permanently.

- **Peers refuse a mismatched environment stamp before replicating anything.** `deployment.environment`
  (`0010_deployment_stamp.sql`, `id=1` singleton, not RLS) is the stamp; the sync handshake compares
  the two and rejects a peer whose stamp disagrees (`sync.peer_environment_mismatch`) — the same
  discipline cloud-storage §9 applies at cloud ingest. `deployment` is therefore **not replicated as
  data** (§2, §6): it is the guard, checked once per connection, never copied.
- **A registro carries `entorno` and the submitter refuses to file it to the wrong environment**
  (`registros.ts:107-118`; `drain.ts` reads `entorno`). Since apply copies `entorno` verbatim (§5), a
  mirrored record keeps its origin environment and cannot be laundered by crossing a node boundary.

---

## 11. What must be prototyped against the real migrations (not assumed from config)

Each is a *container experiment*, not a paragraph (`CLAUDE.md` §1). State the failing case before
running each (§1's "a measurement where both answers look alike measures nothing").

### Gate results — run 2026-08-06 (all pass; one design change)

The nine gates below **ran** against real `postgres:18-alpine` (PostgreSQL 18.4) as a non-superuser,
non-BYPASSRLS `app_login` role with the full migrations applied — receipts in
[`2026-08-06-sync-container-gates-findings.md`](2026-08-06-sync-container-gates-findings.md). Every
mechanism the chosen outbox path needs works **with no new privilege**: the capture trigger,
echo-suppression (the `WHEN app.sync_apply` GUC clause, proven load-bearing by a control that
re-captured the echo without it), byte-identical `to_jsonb`, the non-regressing watermark upsert,
`ON CONFLICT DO NOTHING` idempotency, the `23503` fast-lane defer, and the environment handshake
refusing a mismatched peer in both directions.

**One design-changing finding.** `envios` and `acks` carry **no monotonic column**, so the row-level
watermark guard (`WHERE excluded.updated_at > …`) cannot be written for them — their non-regression
rests entirely on the subscriber's `seq` cursor never re-applying an older `seq`. That makes them
**ineligible for the `payments` fast lane** (§3(3), §4): they must ride the single ordered lane. **The
enrolment registry (§6) must encode this as a routing rule** — the refinement is deferred to the
build, recorded here so it is not lost.

**Two corrections to the gate premises below.** Gate 2's "a stray direct UPDATE still trips WT001"
holds only for the table **owner**; the `app_login` role is stopped first by `42501` (no UPDATE
grant), and WT001 is the owner-level backstop. And (build-time) these gates granted `sync_log` SELECT
to `app_user` for read-back, whereas the design wants a dedicated **tailer role** to hold SELECT (the
app role INSERT-only) — settle at build time.

**Gate 6 (native decoding) stays N/A even for the §7 backfill:** a non-superuser can drain a
`pgoutput` slot only with the cluster-wide `REPLICATION` attribute (which also opens a base-backup
reach), and `pg_create_subscription` is insufficient — confirming §3(a)'s concern. Native decoding is
out unless `REPLICATION` is later judged acceptable.

1. **The generic capture trigger under FORCE RLS, with echo suppression.** Prove the `AFTER
   INSERT/UPDATE` trigger writes a byte-identical `sync_log` row as `app_user` (huella/amount `text`
   preserved through `to_jsonb`), and that the `WHEN (current_setting('app.sync_apply', true) is
   distinct from 'on')` clause reads the GUC set in the *same* transaction — so a replicated write is
   **not** re-captured (no A→B→A loop). Failing case: the apply path's own write reappears in
   `sync_log`.
2. **INSERT-apply of a foreign registro under FORCE RLS as a non-BYPASSRLS role — DONE, cite; extend
   to the mutable tables.** Experiment 1 already proved the append-only case verbatim. Still to prove:
   the **watermark upsert** (`ON CONFLICT DO UPDATE WHERE excluded.updated_at > …`) on `payments`,
   `cadenas`, `registro_sif`, `envios`/`acks` (seq-watermark) as the non-BYPASSRLS role under FORCE
   RLS, and that a stray *direct* UPDATE on `registros_facturacion` on the mirror still trips the
   append-only trigger (WT001).
3. **Idempotent re-delivery, in a state where a duplicate and a first delivery visibly differ.** Prove
   `ON CONFLICT (id) DO NOTHING` (append-only) and the watermark upsert (mutable) are genuinely
   re-deliverable and that the watermark never regresses on a late older image.
4. **Apply-in-seq-order preserves FK integrity under concurrent disjoint writes**, and the
   `23503`-defer backstop works when a `payments` fast lane reorders a cross-lane parent/child pair
   (§4, §9).
5. **`payments` real-role ownership** — a real-role test that the initiator writes and the mirror is
   read-only (the #34 lesson: Stripe adapters behaved differently under the non-superuser role;
   `CLAUDE.md` memory). "Who may write what" here is a grant fact, not a design intention.
6. **(Gates option (a) only) Non-superuser consumption of a logical replication slot** on PG16+: can a
   non-superuser create and drain a `pgoutput`/`wal2json` slot at all, and is the `REPLICATION` /
   `pg_create_subscription` privilege an acceptable widening? Do **not** assume — measure. If it fails
   or the privilege is unacceptable, (a) is out even for the backfill and §7 step 2 stays on the
   outbox.
7. **`sync_log` retention/back-pressure under a down subscriber** — bounded growth, correct
   high-water pruning only after all live subscribers confirm, and a stalled-subscriber alarm
   (§9).
8. **The environment handshake refuses a mismatched peer before any row applies** (§10), in both
   directions (a production node refuses a preproduction peer *and* vice-versa) — a control in the
   other direction, per §1.
9. **The `server_id` rekey** (inherited from the implementation spec, listed because the partition map
   depends on it): the chain-append path and `record-sale.ts`'s series↔till check behave under
   server-keying.

---

## 12. Decisions — settled and still open

**Settled with the product owner (2026-08-02):**

- **(2) Commercial-subtree attribution → EXPLICIT `server_id`.** `sales` / `working_orders` /
  `payments` get an explicit `server_id` column too, like the fiscal tables — so the one generic
  capture trigger reads the owner directly (no per-row join to the series/order), routing stays
  legible, and every enrolled table is uniform. The `server_id` rekey adds these columns alongside the
  fiscal ones. (Not derived.)
- **(3) A separate fast replication lane for `payments` → BUILD IT.** A tighter cadence for the
  `payments` partition than the fiscal lane, shrinking the customer-money (double-charge) exposure —
  which matters precisely because the deli runs true active-active (below). This is what makes the §4
  cross-lane FK-defer backstop necessary.
- **(5) Deli deployment → TRUE ACTIVE-ACTIVE** (not warm-standby). Both local servers sell and issue
  concurrently, with automatic partition-tolerance and no promotion step — so the full bidirectional
  sync machinery in this spec is in scope for the deli, not just a one-way standby.

**Still open (deferred — not this spec's to answer now):**

1. **Series-marker convention (§8).** Distinct series *codes* per server is recommended; the exact
   marker shape (code prefix? reserved namespace? `purpose`-like discriminator?) is a fiscal-
   presentation choice on the customer's factura and interacts with the asesor's reshaped Q5(a)
   (#33 §11). Product + asesor.
4. **`sync_log` retention policy under a down subscriber (§9).** How long to hold the log for an absent
   peer, when to alarm, and when an operator may declare a subscriber dead and prune past it. Trades
   disk against never-lose-a-row. Ops policy — settle at build time.
6. **Where an *active* cloud SIF may run (§9; #33 §13; cloud-storage §8a).** The hosting/legal
   question — an asesor question, blocking the cloud-primary and cloud-standalone topologies only.
   Referenced, not answered here.

---

## 13. The rejected alternative, documented (so the decision is explicit, not silent)

**Turning RLS OFF on the subscriber's replica copies would let native logical replication apply.** It
is genuinely viable *because the local database is single-tenant* — with no RLS on the subscriber, the
prototype's categorical apply block does not fire, and native pub/sub could carry the whole database.
It is **rejected** for three reasons, each checked in the prototype's own "surprises" section:

1. **It strips the fiscal tables' defence-in-depth.** FORCE RLS on `registros_facturacion` et al. is
   deliberate isolation the design carries on purpose (`0001_registros_inmutables.sql:16`;
   `CLAUDE.md` §5); dropping it on the replica means a stray query on the mirror is no longer tenant-
   fenced. The mirror holds real fiscal records — it is not a throwaway copy.
2. **It diverges the replica's schema/security posture from the primary's.** The two databases are
   meant to be interchangeable ("each a complete copy of the other", #33 §4) and a mirror can be
   *promoted* to primary (§8, §9). A replica with RLS off is not the same database with the safety on;
   promotion would carry the weakened posture into production.
3. **The second gate still bites.** Even with RLS off, the prototype's Stage 3b showed apply switches
   to the *table owner's* role and fails `cannot SET ROLE to "postgres"` unless ownership is also
   changed — so "RLS off" alone does not even make native apply work against the repo's
   migrate-as-superuser ownership model without *further* privilege surgery.

Recorded here so a future session does not silently reintroduce it as an optimisation.

---

## 14. What this supersedes and interacts with

- **Finalises** the held draft `2026-08-01-sif-sync-replication-protocol-design.md`: carries forward
  its ownership map (§2), disjoint-series-codes decision (§8), immutability-apply rules (§5),
  cert/submitter and conflict-detection (§8), environment isolation (§10) and cloud-mirror role (§9);
  **corrects** its §4 (the `server_id` rekey is settled, not "reuse `till_id`"), **adds** the change-
  capture mechanism (§3), the FK apply-ordering rule (§4, the scout's flagged gap — `sales`/
  `working_orders` were missing from the map), and the generic enrolment mechanism (§6).
- **Depends on** #33 (topology, submitter, failover, double-charge path), cloud-storage §9's cloud-
  ingest role and §6a's installation-number allocator, and the server-as-SIF `server_id` rekey
  decision (2026-08-01).
- **Extends** architecture §5's tree-shaped sync ("one sync implementation, tested once") to a
  server↔server edge; it does not contradict it — a till→server sync is the same protocol.
- **Does not touch** `docs/backlog.md`, `docs/compliance/asesor-questions.md` (owned by `/land-branch`
  / #33), or any code. Docs-only draft.

## 15. Out of scope

- The **wire format and versioning** of the sync protocol (cloud-storage §2 puts all version skew
  here) — its own detailed treatment once the mechanism (§3) is chosen.
- The **promotion/fencing tooling and the till-side failover list** (#33 §14) — this spec defines the
  *inputs* to its failover screen (§8), not the tool.
- The **`server_id` schema rekey migration itself** — the server-as-SIF *implementation* spec owns it;
  this protocol only assumes its result.
- The **double-charge remediation UI** (#33 §10/§13), the **analytics/reporting projection**, the
  **remote-admin read surface**, the **local restore flow**, and **data export** (cloud-storage §10).

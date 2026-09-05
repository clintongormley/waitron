# SP-3a — Fiscal-record sync lane (the fiscal module's sync enrolment)

**Date:** 2026-09-05
**Status:** design. **Owner-reviewed:** the SP-3 decomposition (four slices), the BR-4 fold-in, the H2
deferral inheritance, and the capture-DDL-location principle were all decided 2026-09-05 (the brainstorm
that produced this spec).

**Implements:** [module-system-architecture §8 SP-3](2026-09-04-module-system-architecture-design.md) —
the first of **four** slices SP-3 is split into (owner decision, 2026-09-05):

- **SP-3a (this spec)** — the fiscal module's **sync enrolment**: enrol the six fiscal tables onto the
  ordered lane so a subscriber becomes a verbatim copy of the immutable, hash-chained ledger. This is
  H2's fiscal-record lane, realised on the post-SP-2a/2b module-enrolment shape. **No fiscal write-path
  code changes.**
- **SP-3b (later)** — module-owned **vocabulary**: fiscal's Spanish terms move out of the centralized
  `packages/db/src/english-only.ts` into the module's own `vocabulary` seat.
- **SP-3c (later)** — module-owned **gated provisioning**: sever the direct
  `@waitron/provisioning → @waitron/fiscal-verifactu` import, route `registerSif` through the descriptor's
  `provisioningSeeds` seat, and make `makeFiscalBackend`'s choice module-driven.
- **SP-3d (later, = BR-4)** — the fiscal module's **backup/restore contribution**: fill the `backup.restore`
  seat with the fresh-chain / disjoint-series behaviour that lets a restored box trade again as primary
  (cold-DR), never resuming the dead chain. Folded into SP-3 by owner decision 2026-09-05.

**Reference material:** the standalone H2 spec/plan on the unmerged branch `feat/h2-fiscal-record-sync`
(`docs/superpowers/specs/2026-09-04-h2-fiscal-record-sync-design.md`,
`docs/superpowers/plans/2026-09-04-h2-fiscal-record-sync.md`). H2's **design** (apply semantics,
verbatim-not-reconstruct, the six-table modes, the invariants, the gate list) is sound and carried forward
here verbatim. H2's **file-level wiring** predates SP-2a and is obsolete: it modified a central
`packages/sync/src/registry.ts` (deleted by SP-2a) and imported fiscal schema into `apply-sql.ts` (which
now reads `entry.columns`, not domain-schema imports). SP-3a re-expresses the same lane on the
module-declared-enrolment model.

---

## 1. What this is, and its scope

Enrol six fiscal tables — `registros_facturacion`, `registro_sif`, `cadenas`, `envios`, `envio_flujo`,
`acks` — into the existing app-level sync outbox on the **`ordered`** lane, so a subscriber (a cloud
mirror, or a local secondary) becomes a **verbatim** copy of the primary's fiscal ledger, chain identity,
and AEAT-submission state.

**In scope:** a package-owned `FISCAL_ENROLMENT` declaration; a capture-trigger migration in the fiscal
package; wiring the enrolment into the fiscal module descriptor; the `fiscal → sync` module dependency
edge and a guard extension that keeps that edge honest; the SP-2b module-version park integration for
fiscal; and the real-Postgres gate suite (§9).

**Out of scope (inherited, not resolved — owner decision 2026-09-05):** the secondary→survivor transport
*path* (relay-via-primary vs direct multi-origin, H2 §7); whether a *promoted* node files the dead
primary's replicated-but-unsubmitted `envios` tail (H2 §8, an R3 / promote-action policy); the
disposal-guard durability≠convergence gap (H2 review, `63cabb8b`); and the bulk/initial-snapshot backfill
for a fresh mirror (H2 §2). SP-3a delivers *the rows*; these remain upstream dependencies tracked in the
R-series / promotion-failover work. Also out of scope: fiscal's vocabulary (SP-3b), provisioning seam
(SP-3c), and backup/restore hook (SP-3d).

**No fiscal write-path change.** Nothing in `packages/fiscal-verifactu`'s write path (`chain.ts`,
`drain.ts`, `reconcile.ts`, `registro-row.ts`) is touched. SP-3a adds a migration (capture triggers), an
enrolment declaration, a descriptor field, and gates.

## 2. The enrolled tables

All six ride the **`ordered`** lane. The fiscal chain is indifferent to replication lag, and `envios`/
`acks` carry no monotonic column, so they are `fast`-lane-ineligible regardless. The enrolment metadata is
the `EnrolledTable` shape from `@waitron/sync-enrolment` (`packages/sync-enrolment/src/enrolment.ts`), built
by `enrol(table, meta)` — which derives the physical column list off the Drizzle table so it cannot drift.

The modes/keys below are verified against the schema (`packages/fiscal-verifactu/src/schema/*.ts`) and the
app-role grants in `packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql` /
`0003_envio_flujo_rls.sql` / `0006_acks_rls.sql` / `0008_acks_delete_grant.sql`. (The plan pins the exact
grant lines; the receipt that matters here is that `app_user` already holds precisely the DML each mode
needs, and **no new grant is added** by SP-3a.)

| table | `mode` | `captureOps` | `conflictKey` | `watermarkColumn` | `fkRank` | app-role DML held |
| --- | --- | --- | --- | --- | --- | --- |
| `registro_sif` | `watermark-upsert` | insert, update | `["id"]` | `null` (seq-cursor) | 4 | SELECT, INSERT, UPDATE |
| `registros_facturacion` | **`insert-only`** | insert | `["id"]` | — | 5 | **SELECT, INSERT only** |
| `cadenas` | `watermark-upsert` | insert, update | `["tenant_id","node_id"]` | `"actualizado_en"` | 6 | SELECT, INSERT, UPDATE |
| `envios` | `watermark-upsert` | insert, update | `["registro_id"]` | `null` (seq-cursor) | 6 | SELECT, INSERT, UPDATE |
| `envio_flujo` | `watermark-upsert` | insert, update | `["tenant_id"]` | `null` (seq-cursor) | 2 | SELECT, INSERT, UPDATE |
| `acks` | `watermark-upsert` | insert, update, **delete** | `["registro_id"]` | `null` (seq-cursor) | 6 | SELECT, INSERT, UPDATE, DELETE |

Notes:

- **`registros_facturacion` insert-only is grant-enforced, not merely declared.** `app_user` holds only
  `SELECT, INSERT` (`0001_registros_inmutables.sql`), and the apply statement is `… ON CONFLICT (id) DO
  NOTHING`, which never issues the UPDATE that the append-only trigger `registros_facturacion_enforce_immutability`
  (`BEFORE UPDATE OR DELETE`, SQLSTATE `WT001`) would reject. The verbatim insert stores `huella`, the four
  `anterior_*` pointers, and `entorno` exactly as supplied and recomputes nothing (the amount columns
  `cuota_total`/`importe_total` are `text` for exactly this byte-identity reason,
  `schema/registros.ts`).
- **`watermarkColumn: null` on a `watermark-upsert` table means seq-cursor ordering, not "no guard".** The
  ordered lane applies rows in `sync_log.seq` order per `(subscriber, origin, lane)` cursor, so a late
  older image cannot arrive after a newer one on the same origin. `cadenas` additionally carries a real
  monotonic column (`actualizado_en`) and uses it. The plan must confirm the built `applyBatch` accepts
  `mode: "watermark-upsert"` with `watermarkColumn: null` and emits an unconditional `DO UPDATE SET …`;
  this is asserted, not assumed, by gate 3 (§9).
- **`registro_sif` "update" is revocation-in-place** (`revocado_en` set non-null when a node
  re-registers). Its cross-tenant uniqueness (`registro_sif_instalacion_uq`) is preserved on the mirror
  because the replicated rows are the origin's own (§8).
- **`acks` is the one fiscal table that deletes** — a delivered ack in a terminal state is pruned, so its
  capture is `AFTER INSERT OR UPDATE OR DELETE` and the apply path uses the existing idempotent delete
  statement. `app_user` holds DELETE on `acks` (`0008_acks_delete_grant.sql`).
- **FK-order ranks** are the static parent-before-child hint. `registros_facturacion` FK-references `sales`
  (already enrolled), `registro_sif`, `tenants`, `nodes`, `tills`; `tenants`/`nodes`/`tills` arrive via the
  adopt bundle, not this lane. `cadenas.ultimo_registro_id → registros_facturacion` is **nullable**, so a
  chain head arriving before its record is the common transient case, resolved by the existing `23503`-defer
  — never by dropping a constraint (gate 4).
- The `sync_log.op` CHECK already permits `insert`/`update`/`delete` (`0000_sync_outbox.sql`), so **no
  change to the outbox schema** is required.

`FISCAL_ENROLMENT` lives in `packages/fiscal-verifactu/src/enrolment.ts` (an **exempt** package, so the
Spanish table names are fine) and is re-exported from the package barrel, then referenced by the fiscal
descriptor's `sync` field in `apps/server/src/modules.ts` — exactly the shape `PAYMENTS_ENROLMENT` /
`IDENTITY_ENROLMENT` already follow. `fiscal-verifactu` gains a `@waitron/sync-enrolment` **package**
dependency (for `enrol()`); it does **not** import `@waitron/sync`.

## 3. Verbatim replication, not reconstruction

The mirror already holds `sales`/`sale_lines`, so a tempting alternative is to *rebuild* each registro on
the mirror by re-running the chain-append. **Rejected, categorically** (H2 §4):

- It would **recompute the huella.** `computeHuella` hashes `FechaHoraHusoGenRegistro` among its inputs
  (`packages/verifactu/src/huella.ts`); a re-run at a different instant yields a different hash, so the
  copy would be a *different record*, not a mirror.
- It would make the mirror a **second writer of the chain**, violating the single-writer-per-`(tenant,
  node)` contract and the append-only grant.

So the ledger replicates **verbatim** — the stored `huella` and the `anterior_*` pointers copy as opaque
bytes, and the apply path never needs to know the hash rules. This honours the fiscal invariant "never
recompute a hash" (CLAUDE.md §5) and "never put our own metadata into a hash": `entorno` copies as a stored
column and never enters `computeHuella`.

## 4. Applying a fiscal row on the mirror (verified mechanics)

Unchanged from the built `applyBatch` (`packages/sync/src/apply.ts`). The receipts below were traced and
verified against the code, not reasoned:

- **Apply runs as the `sync_applier` LOGIN role** — a member of BOTH `app_user` and `sync_tailer`,
  non-superuser and non-BYPASSRLS (`apply.ts` header; `pull.ts` `localDb`; `apps/server/src/config.ts` the
  mirror's own sync pool; test provisioning `apps/server/src/testing/global-setup.ts` — `sync_applier`
  `inRole: ["app_user", "sync_tailer"]`). So apply's grants on the fiscal tables are exactly `app_user`'s
  (§2) — enough for each table's mode, and no more.
- **Tenant context / RLS is set per row.** `applyOneRow` wraps each write in `withTenant(db, row.tenantId,
  …)`, which sets `app.tenant_id` transaction-locally (`packages/db/src/tenancy.ts`). Every fiscal table
  carries FORCE RLS + `WITH CHECK (tenant_id = current_tenant_id())` (`0001`), and because the role is
  non-BYPASSRLS the `WITH CHECK` fences every apply write to the row's own tenant; a cross-tenant image
  fails `42501` and propagates (never silently parks).
- **The immutability triggers travel and are honoured, not gated.** The mirror runs the same schema, so
  `registros_facturacion` keeps its append-only + TRUNCATE-blocking triggers on the mirror side. The fiscal
  lane needs **no** `app.sync_apply` trigger-gating (the mechanism `0037_gate_triggers_on_sync_apply.sql`
  applies to three *commercial* state-machine triggers only, and its own header records that it touches no
  fiscal table): the ledger's only trigger fires `BEFORE UPDATE OR DELETE`, which the insert-only apply
  never issues; and the five mutable tables carry **no** BEFORE business trigger that an apply-path upsert
  could misfire (grep of `packages/fiscal-verifactu/drizzle/*.sql` for `CREATE TRIGGER` returns only the
  two `registros_facturacion` triggers). This makes the fiscal lane *cleaner* than the commercial one, not
  harder — but note the H2 framing "insert-only never issues UPDATE/DELETE" is **incomplete** for the
  five-table set: enrolling them means enrolling UPDATE (and, for `acks`, DELETE) apply, whose correctness
  rests on there being no trigger to trip (gates 2, 3).
- **The environment handshake is orthogonal to the per-record `entorno`.** The batch-level handshake reads
  the singleton `deployment.environment` stamp and refuses a mismatched peer before any row applies
  (`apply.ts` ~`sync.peer_environment_mismatch`). `registros_facturacion.entorno` is a per-record immutable
  Waitron-metadata column consulted only by the fiscal *drain* path (`drain.ts`), never by apply — apply
  binds the verbatim `row_image::jsonb`, so `entorno` copies byte-identically with no interaction with the
  handshake (gate 7).

## 5. Capture lives in the fiscal package (owner principle)

**Owner decision, 2026-09-05:** the fiscal package must be completely outside core and independent,
interfacing with the rest of the system only via an API. Applied to capture: the six `CREATE TRIGGER …
EXECUTE FUNCTION sync_capture()` statements live in a **new `packages/fiscal-verifactu/drizzle/0014_*.sql`**
migration (on fiscal's own tables; the fiscal set is at `0013_rekey_chain_to_node.sql` today), **not** in
`packages/sync/drizzle`. `sync_capture()` is treated as
sync's stable **SPI** (a DB-level API): sync publishes the function; each module installs its own capture
triggers against it.

This inverts a coupling SP-2a left behind. SP-2a moved the enrolment *data* into owning packages but left
every capture-trigger *migration* in `packages/sync/drizzle` (base 14 in `0000_sync_outbox.sql`, then
`0006_enrol_table_service.sql`, `0007_sync_identity_capture.sql`, `0008_enrol_kitchen.sql`) — so `sync`
reaches *into* other modules' tables. Fiscal does it the other way: fiscal owns its capture, calling the
sync SPI.

Consequences:

- **Capture semantics.** `sync_capture()` is **not** `SECURITY DEFINER`; it runs as the writing app role,
  which holds `INSERT ON sync_log` (`0000_sync_outbox.sql`). The `REVOKE ALL … FROM app_user` on
  `registros_facturacion` does **not** block capture: the writer already succeeded its INSERT into the
  fiscal table (app_user holds INSERT there), and the trigger writes to `sync_log` (app_user holds INSERT
  there). Per-table capture ops match the grants: `registros_facturacion` → `AFTER INSERT`;
  `registro_sif`/`cadenas`/`envios`/`envio_flujo` → `AFTER INSERT OR UPDATE`; `acks` → `AFTER INSERT OR
  UPDATE OR DELETE`. Each trigger carries the echo guard `WHEN (current_setting('app.sync_apply', true) IS
  DISTINCT FROM 'on')` so an apply-path write is not re-captured (mirroring
  `0007_sync_identity_capture.sql`).
- **A `fiscal → sync` module dependency edge.** Fiscal's capture migration needs `sync_capture()` to
  pre-exist, so the fiscal descriptor's `requires` becomes `{ core: "*", modules: { sync: "*" } }`. The
  resolver then orders `core → identity → payments → sync → fiscal` (verified against
  `apps/server/src/modules.ts`: `sync` requires `{core, identity, payments}` and does **not** require
  fiscal, so no cycle). The edge is a **DB-level** dependency (the SPI function), expressed as a module
  edge — `fiscal-verifactu` the package still does not import `@waitron/sync`.
- **Guard extension (new SP-3a work).** The SP-2a graph-honesty guard
  (`scripts/module-graph-honesty.test.ts`) matches only `CREATE TRIGGER … ON <table>` and maps `<table>`
  to its owning module. Fiscal's triggers are `ON` fiscal's **own** tables, so the guard sees an
  intra-module edge and is **blind** to the `EXECUTE FUNCTION sync_capture()` → `sync` dependency. SP-3a
  extends the guard to also detect a cross-module SPI-function reference (`sync_capture` is owned by
  `sync`) and assert the descriptor's `requires` names `sync` — otherwise that edge is unguarded prose,
  which this repo's conventions reject (CLAUDE.md §3, "a written rule with standing violations needs a
  guard"). Proven by deletion: drop the `sync` edge from fiscal's `requires` → the guard goes red.

**Deliberate, bounded inconsistency:** after SP-3a, fiscal owns its capture DDL (the pattern the owner
principle wants) while `identity`/`payments`/`table-service`/`kitchen` capture still lives in
`sync/drizzle` (the old SP-2a pattern, `sync → …` edges). Retrofitting those to own their capture is a
separate cleanup, **named here, not done** — SP-3a establishes the correct pattern on the fiscal exemplar.

## 6. The API boundary — stated honestly, not overclaimed

"Fiscal interfaces with core only via an API" holds for **control flow**:

- Core→fiscal only through the `FiscalBackend` contract (`packages/fiscal/src/backend.ts`); `recordSale`
  (`packages/core/src/record-sale.ts`) takes a `FiscalBackend` and the caller's `tx`, so core depends on
  the regime-neutral contract, never on `fiscal-verifactu` (already true before SP-3).
- Sync consumes fiscal's **declared** enrolment (`FISCAL_ENROLMENT`) generically; `@waitron/sync` imports
  no fiscal schema (SP-2a). Fiscal calls the `sync_capture()` SPI; it does not reach into sync's internals.

It does **not** mean zero coupling. `registros_facturacion` FK-references core's `sales`, `tenants`,
`nodes`, `tills`, imported from `@waitron/db` at the **schema** level (`schema/registros.ts`). That
FK topology is fundamental (a fiscal record is *about* a sale) and unavoidable; SP-3a does not remove it,
and this spec records the boundary so the principle is not asserted beyond what the code delivers.

## 7. SP-2b module-version park integration

SP-2b added a schema-version handshake: `/sync-api/hello` advertises `moduleVersions: Record<string,
number>` (each module's *applied* schema version), and a subscriber parks — never applies, never drops — a
row whose owning module the source has migrated ahead of it, resolving the owner via a `table → module`
map (`MODULE_BY_TABLE`) threaded into `applyBatch`.

For fiscal this is **largely automatic** once the descriptor carries `sync: FISCAL_ENROLMENT`:
`MODULE_BY_TABLE` and the advertised versions are assembled at the composition root from the descriptor set
(`apps/server/src/modules.ts`). SP-3a's obligation is to **prove** it for fiscal: a subscriber whose fiscal
schema version is behind the source parks the source-ahead fiscal rows and applies them after it reboots
and migrates (gate 10). Equal versions never park; an older peer that omits `moduleVersions` gates nothing.

## 8. Coexistence with the reserved standby SIF (R2)

After R2 a cloud mirror holds a **dormant** reserved identity — its own `nodes` row, a reserved
`registro_sif` and an empty `cadenas` head keyed to the cloud's **own** nodeId, and disjoint
`invoice_series`. SP-3a replicates the **primary's** `registro_sif`/`cadenas`, keyed to the **primary's**
nodeId. The two sets never collide because every relevant constraint is node-keyed:

- `cadenas` PK is `(tenant_id, node_id)` — different nodes, distinct rows.
- `registro_sif_activo_uq (tenant_id, node_id) WHERE revocado_en IS NULL` — different nodes, both may be
  live.
- `registro_sif_instalacion_uq (nif, id_sistema_informatico, numero_instalacion)` — the primary's number
  and the cloud's reserved number are distinct by construction (the primary is the sole allocator).

Gate 5 proves it on real Postgres.

## 9. What must be proven — real-Postgres, proven-by-deletion

Each gate is a container experiment as the non-superuser, non-BYPASSRLS `app_user`+`sync_tailer` role
against the full migration manifest (PGlite connects as superuser and is a false pass — CLAUDE.md §4).
These extend the existing `apply.gate`/`capture.gate` suites in `packages/sync`, and each guard is proven
by deletion (remove it → the test goes red → restore). Every measurement must be taken in a state where a
working and a broken implementation visibly **disagree** (CLAUDE.md §1).

1. **Verbatim `registro` insert under FORCE RLS.** A foreign `registros_facturacion` row applies
   byte-identical (huella + four `anterior_*` + `entorno` preserved), idempotent on re-delivery via
   `ON CONFLICT (id) DO NOTHING`.
2. **Immutability intact on the mirror.** Two layers, verified on `postgres:18-alpine` (Task 6): a stray
   UPDATE/DELETE/TRUNCATE by the apply role (`sync_applier`, a non-superuser `app_user` member) is refused
   with `42501` — the grant is checked before the trigger ever fires — while the append-only `WT001` trigger
   fires only for a grant/RLS-bypassing superuser (an UPDATE, or a `TRUNCATE … CASCADE`; a plain `TRUNCATE`
   is refused earlier with `0A000` via the FK references). The insert-only apply path is unobstructed.
3. **Mutable-table upsert non-regression.** `registro_sif` (revocation), `cadenas` (`actualizado_en`
   watermark), `envios`/`envio_flujo` (seq-cursor watermark) and `acks` (insert/update/delete) apply and
   never regress on a late older image — measured where a first delivery and a re-delivery visibly differ.
   Includes the receipt that `watermark-upsert` + `watermarkColumn: null` emits an unconditional
   `DO UPDATE SET`.
4. **FK ordering / `23503`-defer.** A `registro` arriving before its `sale`, and a `cadenas` head before
   its `ultimo_registro_id` record, park on `23503` and land on the next sweep — never by widening a grant
   or dropping a constraint.
5. **Reserved-SIF coexistence** (§8): a mirror carrying an R2 reserved SIF applies the primary's identity
   rows with no unique-constraint conflict, and both identities stay independently resolvable.
6. **The mirror does not submit.** A node booted as a mirror, holding replicated `pendiente` `envios`,
   issues no AEAT submission (the drain pass runs only when `singleton_role='primary'`; the drainer's
   `entorno` guard is the second rail).
7. **Environment handshake.** A mismatched-environment peer is refused before any fiscal row applies,
   proven in **both** directions.
8. **`capture.gate` extended** to the six fiscal triggers: byte-identical `to_jsonb` capture, and the echo
   guard suppresses an apply-path write from re-entering `sync_log`.
9. **`inmutabilidad` re-run** after enrolment confirms the six fiscal tables (and `sync_log`) keep FORCE
   RLS (`pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`, CLAUDE.md §3).
10. **Fiscal module-version park** (§7): a subscriber behind the source's fiscal schema version parks the
    source-ahead fiscal rows (never applies, never drops) and applies them after it migrates; equal
    versions never park.
11. **Graph-honesty guard extension** (§5): the guard asserts fiscal's `requires` names `sync`, proven by
    deletion of the `sync` edge.

## 10. Fiscal invariants preserved (receipts)

- **Immutability** — `registros_facturacion` REVOKE ALL + append-only trigger + TRUNCATE block are
  unchanged and honoured on the subscriber; insert-only apply never issues an UPDATE (§2, §4; gate 2).
- **Never recompute a hash** — the ledger replicates verbatim; nothing on the apply path calls
  `computeHuella` (§3). `entorno` copies as a stored column, never entering the hash.
- **Never reuse an installation number** — `contadores_instalacion` is **not** enrolled; the primary
  remains the sole allocator. The mirror only ever reads a copy of a `registro_sif` the primary minted.
- **Never resume the dead chain** — SP-3a is durability only. A promoted node starting a fresh chain, and
  whether it files the dead primary's tail, are SP-3d / R3 decisions (§1 out of scope).
- **One database per environment** — the environment handshake refuses a mismatched stream (§4, gate 7).

## 11. Interactions

- **SP-2a / SP-2b** — SP-3a is the first *domain* enrolment on SP-2a's inverted model and the first
  provision-only module to advertise a version through SP-2b's handshake.
- **SP-3b/c/d** — independent; SP-3b (vocabulary) does not gate SP-3a because fiscal's enrolment and
  capture live in the exempt `fiscal-verifactu` package and the guard does not scan `drizzle/*.sql`.
- **R2 (reserved SIF)** — coexists collision-free (§8); no ordering dependency.
- **R3 (cloud promotion)** — consumes SP-3a's replicated tail; decides the promoted-node-submits-tail
  policy (§1 out of scope). SP-3a does not depend on R3.
- **The disposal guard / drain-then-restore tooling** — SP-3a is their precondition (it makes the fiscal
  `sync_log.seq` cursor measurable); the tooling that *reads* that cursor lives with the promote-action /
  rejoin work, not here.
- **Docs** — the backlog's module-system and Sync / SIF-topology menus gain an SP-3a landing row at land.

## 12. What this does not touch

`packages/fiscal-verifactu`'s write path (`chain.ts`, `drain.ts`, `reconcile.ts`, `registro-row.ts`),
`docs/compliance/*`, the transport/tunnel code, the drainer, `contadores_instalacion`, and the
centralized `english-only.ts` vocabulary (SP-3b). SP-3a adds a fiscal capture migration, an enrolment
declaration + descriptor field, the `fiscal → sync` edge + guard extension, and gates — nothing else.

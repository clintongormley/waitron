# Node identity rekey — the fiscal chain/series/SIF move from `till` to `node`

**Date: 2026-08-03. Status: design, approved in brainstorming.** Implements the schema gap #33 left
open. Scope is deliberately narrow; §10 lists what it is NOT.

## 1. What this is — and the term

Today every fiscal identity is keyed per **till**: the hash chain, the invoice-numbering series, and
the SIF registration all hang off `till_id`. [#33](2026-08-01-local-server-sif-and-failover-design.md)
decided the SIF is the **compute node** that runs a venue's POS (the local box, or a cloud box), not
each till — but the schema has no node concept at all. This design introduces one: a `nodes` table, a
`NodeId` branded type, and a re-key of the four fiscal-identity tables from `till_id` to `node_id`. It
also adds the replication-owner column `node_id` to the commercial tables the app-level sync layer
needs (§5).

**The term.** #33, the backlog, the memory note and two in-tree comments all say "**server**." This
document calls the same thing a **`node`**, and every identifier below is `node_*`. Reasons: in US
restaurant English "server" means a *waiter*, and Waitron is a restaurant POS whose staff concept is
already `persons`/`employments` (`packages/workforce`) — so "server" would read as a person; `node` is
already floated as the synonym in the sync design (`2026-08-02-app-level-sync-design.md`'s `origin_id`
comment reads `-- which server produced this change (server_id / node id)`); and `node` is the precise
word for a replication/failover participant, which is exactly this entity's role. **Mapping, recorded
once so the committed vocabulary stays connected: the "server" of #33 and the "server_id rekey" of the
backlog IS this `node` / `node_id`.** The backlog and memory get a dated pointer at land time (§11).

**No backwards compatibility.** Waitron is pre-production; schema changes drop and recreate, CI builds
fresh (`CLAUDE.md` §3). There is no chain-migration and no backfill — which is what removes the one
genuinely dangerous part of re-keying a hash-chained table. We define the new shape; dev and CI rebuild.

## 2. What moves, what does not

Verified against the schema in this worktree (file:line receipts in §13).

**Moves from `till_id` to `node_id`:**

| Table | Package | The key that moves |
| --- | --- | --- |
| `registro_sif` | fiscal-verifactu | partial-unique `registro_sif_activo_uq (tenant, till) WHERE revocado_en IS NULL` → `(tenant, node)` — "one live SIF per node" |
| `cadenas` | fiscal-verifactu | PK `(tenant, till)` → `(tenant, node)` — one chain per node |
| `registros_facturacion` | fiscal-verifactu | unique `registros_tenant_till_secuencia_uq (tenant, till, secuencia)` → `(tenant, node, secuencia)` — the concurrency backstop; and the `registros_till_secuencia_idx` index |
| `invoice_series` | db | unique `invoice_series_till_code_key (tenant, till, code)` → `(tenant, node, code)` — series identity |

**Explicitly untouched** (checked, so the rekey does not over-reach):

- `contadores_instalacion` — keyed by `(nif, id_sistema_informatico)` only, no `till_id`/`tenant_id`/RLS
  (`sif.ts:75-83`). The número-de-instalación allocator is per-NIF, so two nodes under one NIF already
  get distinct install numbers — exactly the "SIF virtuales" shape #33 §3 wants, for free.
- `registro_sif_instalacion_uq` on `(nif, id_sistema_informatico, numero_instalacion)` (`sif.ts:47-51`)
  — the "NºInstalación never repeats" guarantee; not till-keyed.
- `registros_identidad_uq` on `(tenant, id_emisor, num_serie, fecha_exp, tipo_registro)`
  (`registros.ts:166-172`) — AEAT's identity triple; not till-keyed.
- `tills` — stays exactly as it is. A till is **not** pinned to a node (see §4d): under active-active a
  till can talk to either node, so the owning node is request-context, not a property of the till.

## 3. The `nodes` table (new, `packages/db`)

A compute node that operates as a SIF for a venue:

```
nodes:
  id           uuid  primary key default random
  tenant_id    uuid  not null references tenants.id
  location_id  uuid  not null references locations.id
  name         text  not null
  created_at   timestamptz not null default now
  · unique (tenant_id, id)         -- composite-FK target, matching invoice_series_tenant_id_key
  · index  (tenant_id)
  · enableRLS()
```

**Deliberately no `role` column** (primary/standby/cloud). With one node per venue there is no role to
distinguish; roles arrive with the failover spec (YAGNI). `location_id` is `NOT NULL`, mirroring
`tills`; a location-less cloud node is a later, no-bwc change if cloud-primary is ever built. The
`unique (tenant_id, id)` exists so a **tenant-consistent composite FK** `(tenant_id, node_id) →
nodes(tenant_id, id)` is available — the same pattern `invoice_series` already uses as the FK target for
`sales` (`series.ts:55`). Whether each `node_id` FK is composite or plain `→ nodes.id` follows its
table's existing sibling FK: today's `till_id` references are plain (`cadenas.ts:22-24`,
`sif.ts:27-29`), so those stay plain, while `sales` — which already uses a composite FK to
`invoice_series` — takes the composite. The plan settles this per table; the `nodes` unique makes the
composite possible where wanted.

## 4. The four fiscal-table rekeys

### 4a. `registro_sif`
`till_id` → `node_id` (FK to `nodes`). `registro_sif_activo_uq` becomes partial-unique
`(tenant_id, node_id) WHERE revocado_en IS NULL` — one live SIF identity per node. `numero_instalacion`,
`nif`, `id_sistema_informatico` and the `registro_sif_instalacion_uq` guarantee are unchanged. The
doc-comment "a till that re-registers gets a new row" becomes "a node that re-registers" — the same
append-mostly, revoke-not-update behaviour, now per node. (Re-registering a node starts a new chain and
mints a fresh install number, the node-level form of `CLAUDE.md` §5's till rule.)

### 4b. `cadenas`
PK `(tenant_id, till_id)` → `(tenant_id, node_id)`. One mutable chain head per node, row-locked
`FOR UPDATE` during append. Nothing else on the table changes.

### 4c. `registros_facturacion`
Add `node_id` (FK to `nodes`, `NOT NULL`) as the **chain key**. The concurrency backstop
`registros_tenant_till_secuencia_uq` and the `registros_till_secuencia_idx` index move to
`(tenant_id, node_id, secuencia)`.

`sif_id` already records which SIF identity generated the record (`registros.ts:58-60`), and
`registro_sif` is now node-keyed, so the node is *derivable* via `sif_id` — but a uniqueness index
cannot be built through a FK, and the sync layer wants the partition key explicit on the row, so
`node_id` is a real column, stamped by the chain-append.

**`till_id` STAYS on this immutable table as an informational snapshot** (`NOT NULL` — every sale rings
at a till). Rationale: it is a self-contained fact on an immutable record; `reconcile.ts` and `drain.ts`
read it directly; and removing a column from the unrepairable fiscal table to save a derivable field is
churn with no fiscal benefit and non-zero risk. The **chain/uniqueness key is `node_id`**; `till_id` is
never read for chaining or contention after this change — the void/correction path reads `node_id` from
the original record (today it reads `till_id` from the original in `backend.ts`; exact line pinned in
the plan).

### 4d. `invoice_series`
`till_id` → `node_id`. `invoice_series_till_code_key` becomes `(tenant_id, node_id, code)`. The
doc-comment "a till may own N series and has exactly one chain … deliberately no unique on
`(tenant, till)`" becomes "a **node** may own N series…" — the same non-constraint, now per node.

**A node, not a till, owns a series** — this is the point of the rekey for numbering. A sale processed
by node A must draw a series owned by node A; the series↔node guard (§6) enforces it. Note the latent
two-node hazard #33 §3 names: `(tenant, node, code)` lets two *different* nodes reuse the same code,
and two nodes issuing the same code + number on the same date would collide on AEAT's identity triple
(error 3000). With one node per venue this cannot happen; **disjoint-series enforcement across nodes is
deferred to the active-active build** (§10). This design does not add a constraint that would block it.

## 5. Commercial tables — `sales` threaded, `working_orders`/`payments` column-only

The app-level sync layer partitions every replicated row by its owning `node_id` (memory note
`server-as-sif-uses-server-column`, sync design §1). This slice adds the column where a real writer
exists and defers it where none does yet, to avoid dead columns nothing populates:

- **`sales`** (`packages/db`) — add `node_id` `NOT NULL`, FK `(tenant_id, node_id) → nodes`. `sales`
  keeps `till_id` (where it rang) **and** gains `node_id` (which node processed/chained it).
  **Populated now**, by `record-sale.ts` — this is the fiscal write path.
- **`working_orders`** (`packages/db`) — add `node_id`, **nullable**, column only. Nothing writes
  working orders yet (backlog: "nothing writes working orders yet"), so there is no writer to thread and
  a `NOT NULL` would be unfillable. The producer, when built, populates and tightens it.
- **`payments`** (`packages/payments`) — add `node_id`, **nullable**, column only. Its writer is the
  inbound-webhook/settle path, whose node-attribution is the deferred "`recordSale` sale-chaining
  hand-off" (backlog payments follow-up). Populated and tightened when that hand-off is built.

This honours the recorded "the rekey adds commercial `node_id`" decision (the schema is uniform and
ready for the sync build) while keeping the only real write-path work in this slice to the fiscal path
plus `sales`. **Nullability is the flagged sub-decision here** — reversible if review prefers all three
`NOT NULL` now, but that would pull `working_orders`/`payments` writers into scope.

## 6. Threading the write path

`NodeId = Branded<string, "NodeId">` + `nodeId()` constructor in `packages/shared/src/ids.ts`, exported
from the barrel, alongside `TillId`.

`node_id` then flows through, replacing or joining `till_id` at each site (full consumer list in §13,
from the schema map):

- **`record-sale.ts`** — `RecordSaleInput` gains `nodeId`. The series↔till guard (`:182-188`) becomes a
  **series↔node** guard: `series.nodeId !== input.nodeId` → `sale.series_wrong_node` (§7). `checkIntegrity`
  is called with the node; `allocateInvoiceNumber(tx, seriesId)` is unchanged (keyed by series id). The
  chain-then-series **lock ordering** (`:201-206`) is unchanged — it just locks the per-node chain head.
  `input.nodeId` is written into the `sales` row.
- **`chain.ts`** — `lockChainHead`/`selectHeadForUpdate`/`attemptAppend` key the `cadenas` head on
  `(tenant, node)`; `toRegistroRow` stamps `node_id` (and still the `till_id` snapshot).
- **`registro-sif.ts`** — `currentSif(tx, tenant, node)`, `registerSif` keyed to node, `esPrimerRegistro`
  keyed to node.
- **`FiscalBackend` contract** (`packages/fiscal/src/backend.ts`) — `registerTill(...)` →
  **`registerNode(...)`**; `checkIntegrity`/`pendingCount` take a node.
- **Sibling core paths** — `record-correction.ts`, `record-substitution.ts`, `record-void.ts`,
  `settle-sale.ts` thread `nodeId` the same way; the void/correction path reads the original record's
  `node_id` (not `till_id`) to pin the correction to the same chain. All three carry the **same**
  series↔till guard as `record-sale` (`record-correction.ts:126-142`, `record-substitution.ts:168-184`),
  so all three flip to series↔node — the backlog named only the `record-sale` copy.

## 7. Error codes and the two flagged sub-decisions

**Rename `sale.series_wrong_till` → `sale.series_wrong_node`.** The guard now checks the node, so a code
saying "till" would be a claim the code no longer honours (`CLAUDE.md` §1). Codes are normally never
renamed once *shipped*, but nothing is in production and there is no bwc, so we rename rather than ship a
lying code. Error codes name the **domain concept** (`CLAUDE.md` §3): the concept is "this series belongs
to a different SIF/node." The three copies (`record-sale`, `record-correction`, `record-substitution`)
all move together. The `errors.ts` registry entry and its reachability import move with it.

**Other codes/params that now mean node, renamed for the same reason** (pinned exactly in the plan):
`sif.not_registered`'s param `{tenantId, tillId}` → `{tenantId, nodeId}`; `chain.append_contention`'s
`tillId` param → `nodeId`; `fiscal.till_not_registered` → `fiscal.node_not_registered` if it is
node/SIF-scoped. **`clock.degraded` KEEPS `tillId`** — a degraded clock is a fact about the physical
till's time source, not about the SIF/node, so it genuinely still means till.

**`incidents` stays till-keyed.** It is keyed `(tenant, till, code, sale_id)` and references the sale,
which now carries `node_id` — so the node is reachable via the sale, and an incident is legitimately
"this sale had a fiscal incident at this till." Not rekeyed. Flagged for review in case node-keying is
preferred; the default is minimal churn on a non-chain table.

## 8. How a node learns its own id (one node per venue)

For this slice the running node process knows its own `node_id` from configuration, exactly as callers
supply `tillId` today — `node_id` is an input to the write path, not inferred. A `nodes` row is created
by provisioning; the minimum this slice builds is whatever the write path and tests require plus
`registerNode` (the renamed `registerTill`) to mint the node's SIF identity. **A first-class
`provision node` CLI command is a follow-up**, not this slice — consistent with the "wire one node per
venue" scope. (The existing tenant/till provisioning is the natural home to also create a node; the plan
decides whether to extend it now or use a test fixture, but does not build a new CLI surface.)

## 9. The container-prototype gate = the first tests (TDD)

The backlog and the memory note gate this rekey on a container prototype confirming the two hot paths
behave under node-keying, *before* build. TDD wants a failing test first. These are the same thing: the
first tests written are **real-Postgres** (Testcontainers, non-superuser deployment role, RLS) —
PGlite serialises every query onto one backend, so a concurrency test there is a false pass
(`CLAUDE.md` §4), and PGlite is superuser, so it cannot show the deployment role. The gate/tests prove:

1. **Concurrency backstop under `(tenant, node, secuencia)`.** Several concurrent `record-sale` calls on
   one node produce distinct `secuencia` with no gap or duplicate — the property `registros.ts:158-162`
   documents as holding "ONLY because of this constraint," re-proven under the node key. Prove by
   deletion: dropping the unique index lets a naive append double-claim a position.
2. **series↔node guard.** A sale whose `input.nodeId` ≠ the series' `node_id` throws
   `sale.series_wrong_node`; the matching case succeeds.
3. **RLS / `withTenant`.** The non-superuser app role can INSERT the node-keyed rows under the tenant
   context; the composite `(tenant_id, node_id)` FK blocks a cross-tenant node reference.
4. **`currentSif` per node.** `currentSif` resolves the one live SIF for a node, and two nodes under one
   tenant resolve to distinct SIFs / distinct chains.

Each guard is proven by deletion and each negative control confirmed to fail for the stated reason
(`CLAUDE.md` §4).

## 10. Out of scope (each its own spec / follow-up)

- **Active-active replication** and the app-level sync build — its own spec
  (`2026-08-02-app-level-sync-design.md`); this slice only delivers the `node_id` columns it partitions on.
- **Failover / promotion / fencing** and the till-side failover list; the `nodes.role` column lands there.
- **Two concurrent SIFs + disjoint-series enforcement across nodes** — latent under one node per venue.
- **The submitter as a relocatable role** and certificate resolution.
- **`working_orders` / `payments` node attribution** (their writers) — columns only here (§5).
- **`CLAUDE.md` §5's "nothing blocks a sale" rewrite** — deferred deliberately. This slice does not change
  sale-blocking behaviour (no failover yet), so rewriting that wording now would describe behaviour that
  is not built. It lands with the server-as-SIF *behaviour*, per the backlog.
- **A `provision node` CLI command** (§8).

## 11. Docs and vocabulary to update at land

- `docs/backlog.md` — move the rekey out of the SIF-topology follow-ups; record that #33's "server" is
  the code's `node`, and that the commercial `node_id` on `working_orders`/`payments` is column-only
  pending their writers. (Owned by `/land-branch`'s backlog step.)
- The memory note `server-as-sif-uses-server-column` — add a dated line that the implementation used the
  term `node` (server→node mapping), so memory and code agree.
- Add a dated pointer in #33's spec (`CLAUDE.md` §6: leave its text, add a pointer) that the schema gap
  it left open is closed here under the term `node`.

## 12. Open questions

- **Nullability of `working_orders`/`payments` `node_id`** (§5) — nullable-now vs NOT-NULL-now; the latter
  pulls their writers into scope. Default: nullable.
- **`incidents` keying** (§7) — stays till-keyed by default; node-keying is the alternative.
- Everything #33 left open (cloud-issued-SIF hosting, warm-standby-vs-active-active, NO VERI\*FACTU cert
  coupling) is unaffected by this schema slice and stays with their specs.

## 13. Receipts — verified in this worktree

Schema (read 2026-08-03):
- `packages/fiscal-verifactu/src/schema/cadenas.ts:44` — PK `(tenant_id, till_id)`.
- `packages/fiscal-verifactu/src/schema/sif.ts:47-51` — `registro_sif_instalacion_uq (nif, id_sistema, numero)`; `:53-55` — partial `registro_sif_activo_uq (tenant, till) WHERE revocado_en IS NULL`; `:75-83` — `contadores_instalacion` NIF-keyed, no RLS.
- `packages/fiscal-verifactu/src/schema/registros.ts:52-54` — `till_id NOT NULL`; `:58-60` — `sif_id`; `:162` — `registros_tenant_till_secuencia_uq`; `:166-172` — `registros_identidad_uq`; `:174` — `registros_till_secuencia_idx`.
- `packages/db/src/schema/series.ts:43-46` — `till_id`; `:52` — `invoice_series_till_code_key (tenant, till, code)`; `:55` — `invoice_series_tenant_id_key (tenant, id)`.
- `packages/db/src/schema/tenants.ts` — `tills` (no server column); `locations`.
- `packages/shared/src/ids.ts:25,47` — `TillId` / `tillId()`; no `NodeId`.

Write path (from the schema map, spot-verified):
- `packages/core/src/record-sale.ts:167-188` — series select + `series.tillId !== input.tillId` → `sale.series_wrong_till`; `:201-206` — chain-then-series lock ordering, `allocateInvoiceNumber(tx, seriesId)`.
- `packages/core/src/record-correction.ts:126-142`, `record-substitution.ts:168-184` — the same series↔till guard (sibling copies).
- `packages/fiscal-verifactu/src/chain.ts` — `lockChainHead`/`attemptAppend` keyed `(tenant, till)`; `registro-sif.ts` — `currentSif`/`registerSif`/`esPrimerRegistro` keyed `(tenant, till)`; `backend.ts` — `registerTill`, void/correction reads original `till_id`.
- Migrations: `packages/db/drizzle/` (journal `__drizzle_migrations_db`), `packages/fiscal-verifactu/drizzle/` (`__drizzle_migrations_fiscal`), `packages/payments/drizzle/`; central applier `packages/migrations/migrations.manifest.json`.

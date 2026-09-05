# SP-2a — Sync enrolment inversion + graph-honesty guard

**Date:** 2026-09-05
**Status:** design. **Owner-reviewed:** decomposition (two slices) and the flow-down deferral decided
2026-09-05 (the brainstorm that produced this spec).

**Implements:** [module-system-architecture §5 / §8 SP-2](2026-09-04-module-system-architecture-design.md)
— the first of **two** slices SP-2 is split into (owner decision, 2026-09-05):

- **SP-2a (this spec)** — the sync **enrolment inversion**: every domain package declares its own
  enrolment, `@waitron/sync` imports no domain schema, and the SP-1c-deferred **graph-honesty guard**
  gets its home now that enrolment lives in the packages. **Behaviour-preserving** — the same 22 tables
  are captured and applied identically; the change is *where the enrolment is declared*, nothing on the
  wire or in the DB moves.
- **SP-2b (next spec)** — the **schema-version handshake + park gate** (§6 below sketches it): the
  subscriber advertises each module's migrated schema version and parks a module's rows when the source
  is ahead of it. New behaviour, built on the table→module map this slice establishes.

**Decides:** the enrolment-contract type and where it lives (a leaf, §2); that each domain package owns
its **enrolment** (not yet its whole `WaitronModule` descriptor — the dependency graph forbids that for
`core`, §2); that `@waitron/sync` consumes an **injected** enrolment set assembled by the composition
root, imports no domain schema, and drops its `@waitron/payments` dependency (keeping `@waitron/identity`
only for a non-schema crypto helper — §2e); and the shape of the graph-honesty guard (§4).

---

## 1. Why this slice, and what it does not touch

The generic sync layer imports domain schema — the exact structural fact that started the whole module
initiative (`packages/sync/src/apply-sql.ts` imports Drizzle tables from `@waitron/db`,
`@waitron/payments/src/schema` and `@waitron/identity/src/schema`; the architecture §1 quotes this as the
first place the coupling showed through). SP-2a inverts it: **each domain package declares its own
enrolment, and `@waitron/sync` reads no domain schema at all.**

**What SP-2a does NOT change — stated first, because the inversion is smaller than it looks:**

- **The capture side is untouched.** `sync_capture()` is a generic, schema-agnostic plpgsql trigger
  function (`packages/sync/drizzle/0000_sync_outbox.sql:126-146`), and every `CREATE TRIGGER … EXECUTE
  FUNCTION sync_capture()` is hand-written per-table in sync's own migrations
  (`0000_sync_outbox.sql:158-217`, `0006_enrol_table_service.sql`, `0007_sync_identity_capture.sql`,
  `0008_enrol_kitchen.sql`). **Migration order forces these to stay in `@waitron/sync`'s migrations:** a
  trigger cannot reference `sync_capture()` before the sync set has run, and sync's set is last (it
  `requires` identity + payments, `apps/server/src/modules.ts:112-114`). So the trigger DDL — and
  therefore sync's migration-level `CREATE TRIGGER … ON persons`/`payments` — **does not move**. The
  inversion removes sync's *TypeScript import* of domain schema, not its migration-level trigger
  attachment. Anyone reading "full inversion" as "triggers move into each module" is reading it wrong;
  the graph-honesty guard (§4) exists precisely because those cross-module trigger edges persist.

- **The wire, the cursor, the apply loop, and the environment handshake are byte-for-byte unchanged.**
  `sync_log`, the `(subscriber, origin, lane)` cursor, the `23503` FK-defer parking, the echo guard, the
  NDJSON codec, `applyBatch`'s seq-ordered idempotent apply, and the environment gate
  (`packages/sync/src/apply.ts:126-145`) all stay. This slice is a **source-of-truth move for the
  enrolment metadata**, nothing more. The schema-version gate that *does* change apply behaviour is
  SP-2b.

- **No migration, no grant, no error code.** Grants ride each table's own `CREATE TABLE` migration
  (architecture §9); this slice writes no SQL. It moves TypeScript and deletes two `package.json`
  dependency lines.

## 2. The enrolment contract and where it lives

### 2a. The dependency graph forbids the naive "descriptor moves into its package"

SP-1a's §8 wrote that at SP-2 "each domain's descriptor moves into its own package." Grounded against the
actual dependency graph (`package.json` survey, 2026-09-05), that is **not possible for `core`**:

```text
@waitron/module  → @waitron/migrations → @waitron/db → @waitron/membership, @waitron/shared
@waitron/sync    → @waitron/db, @waitron/identity, @waitron/payments, @waitron/shared
@waitron/payments→ @waitron/db, @waitron/shared
@waitron/identity→ @waitron/db, @waitron/shared
```

`@waitron/module` sits **above** `@waitron/db` (through `@waitron/migrations`), so `@waitron/db` importing
`@waitron/module` — which exporting a `WaitronModule` from `@waitron/db` requires — is a cycle
(`db → module → migrations → db`). `@waitron/identity` and `@waitron/payments` *could* export a full
descriptor (`@waitron/db` does not import them, so no cycle there), but there is **no swappability gain in
SP-2a from doing so** — `identity`/`payments` are not swappable slots in the Spain exemplar (fiscal is the
swap driver, and its full-descriptor move is SP-3). Moving their descriptors now would touch two packages
for no behaviour gain, exactly the "rides the slice that first needs it" argument SP-1a §2 used to *keep*
the nine generic descriptors central.

**So SP-2a moves the domain *content sync needs* — the enrolment — into each package, and leaves the
`WaitronModule` objects assembled in the composition root.** This is the honest reading of the
architecture's own words (§5): *"every package declares its own **enrolment** in place — including
`@waitron/db` for its `core`-resident tables … (the `core` package simply declares enrolment for its own
tables)."* The architecture says *enrolment*, not *descriptor*; §1a records why the difference is load-
bearing.

### 2b. The enrolment-contract type — a leaf both directions can import

The per-table metadata already lives in `EnrolledTable` (`packages/sync/src/registry.ts:36-55`): `table`,
`mode`, `conflictKey`, `watermarkColumn`, `captureOps`, `fkRank`, `lane`. The **only** thing the apply
path reads off the Drizzle schema object is the **ordered physical column-name list**
(`columnNamesFor`, `apply-sql.ts:74-81`, `getTableColumns(t).map(c => c.name)`). So the enrolment entry
gains one field:

```ts
export interface EnrolledTable {
  table: string;
  mode: SyncMode;              // "insert-only" | "watermark-upsert"
  conflictKey: string[];
  watermarkColumn: string | null;
  captureOps: CaptureOp[];     // ("insert"|"update"|"delete")[]
  fkRank: number;
  lane: SyncLane;              // "ordered" | "fast"
  /** The ordered physical column list — what apply-sql read from Drizzle centrally. Derived at the
   * owning module's declaration site from its OWN schema, so it cannot drift (pinned, §5). */
  columns: string[];
}
```

`EnrolledTable` (plus `SyncMode`/`CaptureOp`/`SyncLane`/`SYNC_LANES`) is **pure data — no Drizzle type in
the contract.** It moves down to a **leaf** every domain package can import without a cycle. `@waitron/db`
already imports `@waitron/shared`, and so does everyone else, so `@waitron/shared` is the zero-new-edge
home; but a sync-enrolment contract does not belong in the error-registry leaf. **Decision: a new tiny
leaf `@waitron/sync-enrolment`** holding the types above and one builder (§2c), depending only on
`@waitron/shared` and `drizzle-orm` (a regular runtime dependency — the `enrol` builder calls
`getTableColumns`; the *type* `EnrolledTable` itself references no Drizzle type, so a consumer that only
reads enrolments tree-shakes the builder away). `@waitron/db`,
`@waitron/identity`, `@waitron/payments`, `@waitron/sync` and `@waitron/module` all import from it; none
of them forms a cycle (it is a leaf). This keeps `@waitron/shared` focused and gives the contract an
obvious name. (The plan may still fold it into `@waitron/shared` if the review prefers one fewer package;
the type location is an implementation detail, the *leaf-ness* is the constraint.)

### 2c. Deriving `columns` at the declaration site

The owning package builds each entry with a helper so the column list cannot drift from the real table:

```ts
// @waitron/sync-enrolment
export function enrol(table: Table, meta: Omit<EnrolledTable, "table" | "columns">): EnrolledTable {
  return {
    table: getTableName(table),
    columns: Object.values(getTableColumns(table)).map((c) => c.name),
    ...meta,
  };
}
```

`enrol` takes the Drizzle `Table` (which the owning package has — `@waitron/db` owns `sales`,
`@waitron/payments` owns `payments`, etc.) and reads its name + column list exactly as `columnNamesFor`
does today, so the generated apply SQL is identical (pinned, §5). `drizzle-orm` is imported **inside the
builder**, which runs only in packages that already depend on it; the *type* `EnrolledTable` stays
Drizzle-free, so a consumer that only reads enrolments (the guard, tests) needs no Drizzle.

### 2d. What each package exports

- **`@waitron/db`** → `export const CORE_ENROLMENT: readonly EnrolledTable[]` — the 17 core-resident
  tables (`sales`, `sale_lines`, `tenders`, `sale_settlements`, `sale_substitutions`, `sale_voids`,
  `catalogues`, `categories`, `products`, `working_orders`, `working_order_lines`, `dining_tables`,
  `floor_zones`, `table_service_statuses`, `kitchen_stations`, `kitchen_courses`, `ticket_items`), each
  built with `enrol(<its drizzle table>, {mode, conflictKey, watermarkColumn, captureOps, fkRank, lane})`
  from the metadata currently in `ENROLLED`. Added to `@waitron/db`'s **enumerated** `exports` map as
  a new entry (`./enrolment.js`) — the map is deliberately not a wildcard (CLAUDE.md §3), so this is an
  explicit new export.
- **`@waitron/identity`** → `IDENTITY_ENROLMENT` (`persons`, `webauthn_credentials`).
- **`@waitron/payments`** → `PAYMENTS_ENROLMENT` (`payments`, `payment_refunds`, `payment_policy`).

The metadata (mode/conflictKey/watermark/captureOps/fkRank/lane) for each table is **copied verbatim from
today's `ENROLLED`** (`registry.ts:81-327`) — the six groups A–F described in the survey. Nothing about the
values changes; they move package-ward.

### 2e. `@waitron/sync` consumes an injected enrolment set

Today `@waitron/sync` builds its dispatch at import time from the static `ENROLLED`
(`apply.ts:264-269`) and reads columns from the statically-imported `SYNC_SCHEMA_TABLES`
(`apply-sql.ts:49-72`). Inverted:

- `apply-sql.ts` **deletes** the three domain imports (`apply-sql.ts:11-40`) and `SYNC_SCHEMA_TABLES`;
  `columnNamesFor` becomes `entry.columns` (read off the enrolment, no Drizzle lookup).
- The apply machinery is built from an **enrolment set passed in**, not a module-level constant.
  `applyBatch` already takes an options object; the enrolment set (or the derived `DISPATCH` map) is
  threaded through the same way, assembled once by the caller. `readSyncLogSince`/`tablesForLane` take the
  enrolment set too. `registry.ts`'s `ENROLLED` constant is removed from `@waitron/sync`; the type
  definitions it held (`EnrolledTable` etc.) now live in `@waitron/sync-enrolment` and are re-exported
  from the sync barrel for existing consumers.
- **The composition root assembles it.** `apps/server` (already the module composition root, holding
  `ALL_MODULES`) computes `const ENROLMENTS = ALL_MODULES.flatMap(m => m.sync ?? [])` and injects it where
  it constructs the sync pull loop / apply / source (`sync-api.ts`, the pull wiring). This is the DI seam
  the architecture §4 names — swapping a module changes only what the composition root registers, nothing
  in `@waitron/sync`.
- **`@waitron/sync` drops `@waitron/payments` and every `/src/schema` deep import.** (Corrected
  2026-09-05, during SP-2a Task 6: the first draft claimed it drops **both** `@waitron/identity` and
  `@waitron/payments` "entirely" — a claim that outran its evidence. `packages/sync/src/peers.ts:11`
  imports `hashSecret`/`verifySecret` from `@waitron/identity` — pure scrypt helpers from
  `identity/src/secret-hash.ts`, `node:crypto` only, a pre-existing #144 coupling that is **not** domain
  schema. So `@waitron/identity` **stays** as a dependency, for that crypto helper alone; `@waitron/payments`
  drops cleanly because `apply-sql.ts`'s schema deep-import was its only use.) It keeps `@waitron/db` (it
  still uses `withTenant`, `apply.ts`). **The observable proof of the inversion** is therefore: `@waitron/sync`
  imports **no domain schema** — no `@waitron/*/src/schema` deep import remains anywhere in `packages/sync/src`
  — and `@waitron/payments` is gone from its `package.json`; the single surviving `@waitron/identity` import
  is the `peers.ts` crypto helper, asserted by a test (§5). **Deferred follow-up:** relocating those scrypt
  helpers to a leaf (`@waitron/shared`) so `@waitron/sync` depends on no domain package at all is a genuine
  improvement, but it touches `@waitron/identity`'s public surface and every `hashSecret` consumer, so it is
  its own change, out of scope for this schema-inversion slice.

The `WaitronModule.sync` field (today `sync?: unknown`, `packages/module/src/module.ts:37`) is tightened to
`readonly sync?: readonly EnrolledTable[]`, importing the type from `@waitron/sync-enrolment` — the first
of the deferred seats to gain its real type, exactly as SP-1a §3 anticipated ("each slice tightens its own
field's type when it lands").

## 3. The composition-root wiring (apps/server)

`apps/server/src/modules.ts` keeps `ALL_MODULES`, now wiring each enrolment-bearing descriptor's `sync`
field from the owning package:

```ts
import { CORE_ENROLMENT } from "@waitron/db";
import { IDENTITY_ENROLMENT } from "@waitron/identity";
import { PAYMENTS_ENROLMENT } from "@waitron/payments";
// …
{ name: "core", …, sync: CORE_ENROLMENT },
{ name: "identity", …, sync: IDENTITY_ENROLMENT },
{ name: "payments", …, sync: PAYMENTS_ENROLMENT },
// every other descriptor: no sync field (nothing enrolled yet; fiscal's is SP-3)
```

The assembled `ENROLMENTS` set is derived once and injected into the sync runtime wiring. Because
`apps/server` is exempt from the english-only guard and already imports every package, no Spanish name and
no domain schema reaches a generic package — the english-only clash the whole initiative started from
stays dissolved (architecture §4).

## 4. The graph-honesty guard (SP-1c deferred item (a))

SP-1c verified the cross-module `requires` graph **by hand** and recorded the recipe as a CLAUDE.md §3
lesson: a module depends on another when it FK-`REFERENCES` the other's table **or** `CREATE TRIGGER … ON`
against it, and the FK-only first pass missed `sync → {identity, payments}` (the trigger edges). SP-1c
deferred the automated guard to "where descriptor package-ownership begins" — here.

**The guard** — a new root-Vitest program `scripts/module-graph-honesty.test.ts`, matching the house style
of `scripts/errors-reachable.test.ts` and `scripts/guarded-teardowns.test.ts` (root project because it
reads the whole tree; §Testing in CLAUDE.md §4):

1. **Discover** every package shipping a `drizzle/` dir (filesystem-driven, not hand-listed — the drift the
   hand-copied guards showed is the thing to avoid). Build a **table→owning-module** map by scanning each
   package's `drizzle/*.sql` for `CREATE TABLE "<name>"` and attributing `<name>` to that package's module.
2. **Scan** each package's `drizzle/*.sql` for the two cross-module edge kinds — `REFERENCES
   "<schema>"."<table>"` and `CREATE TRIGGER … ON "<schema>"."<table>"` — resolve each target table to its
   owning module via the map, and collect the set of modules each module depends on.
3. **Assert** every discovered cross-module edge is named in the depending descriptor's `requires`
   (`ALL_MODULES`, imported from `apps/server`). A missing edge is a finding.
4. **Vacuous-pass anchor** (CLAUDE.md §2): assert the discovered package set contains known members
   (`db`, `identity`, `payments`, `sync`, …) and clears a loose floor, and that at least the known
   `sync → identity`, `sync → payments`, `workforce → identity` edges are *found by the scan* — so a scan
   that silently matches nothing fails rather than passing empty.
5. **The detector itself** — an inline-fixture unit block feeding SQL strings: a `REFERENCES` across
   packages is caught; a `CREATE TRIGGER … ON` across packages is caught; a same-package reference is
   ignored; a reference inside a SQL comment or string literal is ignored (negative control).
6. **Tree-wide**: flatten findings to `"<module> requires <dep> (via <edge> on <table>) — not declared"`
   and `expect(findings).toEqual([])`.

**Proven by deletion** (CLAUDE.md §4): drop `identity` from `sync`'s `requires` in a fixture/temporarily →
the guard reports the missing trigger edge → restore → green. The scan reads **text** (like the other root
guards); its limitation — a `CREATE TRIGGER` spelled across lines or with unusual quoting could be missed —
is stated in its own header rather than papered over, and the known real edges in step 4 are the live proof
it parses the tree's actual spelling.

This guard closes the gap that cost SP-1c a review round: from now on a new cross-module FK or capture
trigger with no matching `requires` fails a test instead of shipping.

## 5. Behaviour-preserving proof (receipts, all provable-by-deletion)

- **Enrolment equivalence.** `ALL_MODULES.flatMap(m => m.sync ?? [])` **deep-equals** today's `ENROLLED`
  — same 22 tables, same `mode`/`conflictKey`/`watermarkColumn`/`captureOps`/`fkRank`/`lane`, and each
  entry's `columns` equals the old `columnNamesFor(table)`. A test asserts the assembled set equals a
  frozen snapshot of the pre-inversion registry (the `registry.test.ts` `SPEC` table repurposed as the
  oracle). Proven by deletion: drop one table from a package's enrolment → the equality fails.
- **Generated SQL unchanged.** `apply-sql.test.ts` keeps pinning `applyStatementFor`/`deleteStatementFor`
  output for the representative tables (`sales`, `payment_policy`, `working_orders`); the only input change
  is `columns` sourced from the enrolment rather than Drizzle, and the assertion is that the emitted SQL
  string is identical to today's.
- **`columns` cannot drift.** For every enrolment entry, `entry.columns` equals
  `getTableColumns(<its schema>).map(c => c.name)` — a test in each owning package (`@waitron/db`,
  `@waitron/identity`, `@waitron/payments`) that re-derives from the live schema and compares. This is the
  guard that a hand-edited `columns` (there is none — `enrol` derives it — but a future refactor could
  introduce one) stays honest.
- **Enrolment matches the installed triggers (real-PG completeness).** After a full migrate, query
  `pg_trigger` for the tables carrying a `sync_capture` trigger and assert that set **equals** the assembled
  enrolment's table set. This is the invariant that the TS enrolment list and the DDL trigger list agree —
  the one consistency the manual convention (survey §4) previously left unguarded. Extends the existing
  `capture.gate.test.ts` real-PG suite.
- **Inversion proof.** `@waitron/sync`'s `package.json` names neither `@waitron/identity` nor
  `@waitron/payments` (a unit test reads the manifest), and `apply-sql.ts` contains no `@waitron/*/src/schema`
  import (asserted by the same test or by the fact that the deep-import lines are deleted and typecheck
  passes without them).
- **Whole-package + tree-wide guards.** Because tables move between packages' declared surfaces, run the
  guards CLAUDE.md §2/§4 name: `pnpm --filter @waitron/sync test:coverage`,
  `pnpm --filter @waitron/db test:coverage`, `pnpm --filter @waitron/identity test:coverage`,
  `pnpm --filter @waitron/payments test:coverage`, `pnpm --filter @waitron/module test:coverage`; and the
  root guards `pnpm vitest run scripts/english-only.test.ts scripts/errors-reachable.test.ts
  scripts/module-graph-honesty.test.ts`. No `tenant_id`-bearing table is added, so the fiscal
  `inmutabilidad` scan is unaffected — but the enrolment set is the list of tenant-scoped sync tables, so
  run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` to confirm nothing about the scanned
  set moved.

## 6. SP-2b, sketched (not built here)

SP-2b adds the **schema-version handshake + park gate** (architecture §6). Recorded here only so SP-2a does
not foreclose it — the detail is SP-2b's own spec.

- **Handshake.** The hello document (`{ nodeId, environment, membership }`, `sync-api.ts:123`) gains
  `moduleVersions: Record<string, number>` — each enabled module's **applied** schema version
  (`appliedSchemaVersion`, the count-of-journal-rows primitive SP-1a proved, `schema-version.ts:50`),
  computed exactly as boot already computes the migrated set (`boot.ts:575-576`).
- **The gate is coarse, per-module, at pull time.** The silent-corruption case is the source being
  **ahead** of the subscriber: `jsonb_populate_record(null::<my_table>, row_image)` silently drops a column
  the source added and the subscriber's older table lacks. So the subscriber, per module in **its own
  enabled set**, applies that module's rows only when `myVersion >= sourceVersion`; when the source is
  ahead it **parks** the module's rows — skips them without advancing the cursor — until the subscriber
  reboots and migrates. Rows are never silently dropped and never wedge a table the subscriber lacks; the
  skew window is closed by the existing rolling-reboot convergence. This is "one axis over from the
  environment handshake" (`apply.ts:126-145`), and it needs the **table→module map** SP-2a establishes (a
  row's table → its owning module → that module's advertised vs local version).
- **Flow-down stays deferred** (§7).

## 7. Deferred: ongoing flow-down (receipt refreshed, owner decision 2026-09-05)

The backlog listed SP-2 as picking up SP-1d's deferred ongoing enable/disable flow-down. It **defers
again**, on the same two receipts, both re-verified for SP-2a:

1. **No config channel exists to carry it.** `@waitron/sync` replicates tenant-scoped, RLS'd rows;
   `deployment` and `mirror_config` are whole-DB singletons with no `tenant_id` and no RLS
   (`packages/db/src/schema/mirror-config.ts`), so they cannot ride that lane; `modules.json` is an on-box
   file, and the only primary→mirror config handoff is the **one-shot** adopt bundle (SP-1d). Building
   flow-down means building a new push/poll or reversing SP-1b's on-box-file decision.
2. **Nothing is genuinely disableable, and SP-2a introduces no toggleable module.** The seven
   `tier: "toggleable"` descriptors are toggleable-in-contract only — identity/sync/payments are still
   statically wired and fail boot loudly if disabled (SP-1b deferred follow-up (a)). **SP-2a inverts sync's
   enrolment imports but does not cut any module's static runtime wiring**, so it does not make a module
   safely disableable. The live case flow-down needs — a primary re-enabling a module a mirror inherited as
   disabled — remains unreachable.

**When to build it:** alongside the first genuinely-toggleable module (the runtime wiring inversion /
core-extraction, deferred past SP-2). The two candidate designs SP-1d recorded (a tenant-scoped module-
config table on the sync ordered lane, or a mirror-side periodic re-fetch) stand. The backlog's SP-2 row is
updated to say flow-down defers again with this receipt, so a future session does not read "SP-2 picks it
up" and rediscover the absence of a channel.

## 8. Invariants preserved (receipts)

- **Capture, wire, cursor, apply loop, environment gate — all unchanged** (§1). The change is the
  source-of-truth for enrolment metadata, not the mechanism.
- **English-only preserved, not exempted-around.** `@waitron/sync-enrolment` is a new generic (scanned)
  package holding English types only; `@waitron/sync` stays generic and now imports **no** domain schema.
  Spanish names stay in the exempt fiscal package + composition root. No new whole-package exemption
  (architecture §9). Run `scripts/english-only.test.ts` green.
- **Grants stay colocated with `CREATE TABLE`** — this slice writes no migration and touches no grant, so a
  future disabled module still carries no orphaned grant loop.
- **Fiscal untouched.** Fiscal enrols nothing yet (SP-3); the chain, provisioning, immutability guards and
  reserved-standby identity are not in this slice's blast radius. The `inmutabilidad` scan is run only to
  confirm the tenant-scoped table set did not move.
- **No behaviour change on the wire or in the DB** — pinned six ways (§5); the two mirrors and the trading
  path capture and apply exactly the same rows as before.

## 9. Interactions

- **SP-1a** — tightens the `sync?: unknown` seat (`module.ts:37`) to `readonly EnrolledTable[]`, the first
  deferred field to gain its real type; consumes `expectedSchemaVersion`/`appliedSchemaVersion` in SP-2b,
  not here.
- **SP-1b/SP-1c** — the `requires` graph SP-1c populated by hand is now guarded by §4; SP-1b's enabled-set
  filter is untouched (SP-2b is the first to make the subscriber *pull* by enabled set).
- **SP-1d** — the mirror's inherited enabled set is the input SP-2b's subscriber pull reads; SP-2a does not
  touch adopt. Flow-down defers again (§7).
- **SP-2b** — built on this slice's table→module map and the tightened `sync` field.
- **SP-3** — fiscal declares its own enrolment the same way (H2's fiscal-record lane), now that the
  mechanism reads module-declared enrolments; SP-3 is the slice where fiscal's *full descriptor* (its
  `vocabulary`/gated `provisioningSeeds`) moves into `@waitron/fiscal-verifactu`.
- **No UI** — parallel-safe with the SP-B3.2 layout-editor session (architecture §7).

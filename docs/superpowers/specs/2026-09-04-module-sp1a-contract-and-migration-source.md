# SP-1a — Module contract + migration source-of-truth inversion

**Date:** 2026-09-04
**Status:** design. **Owner-reviewed:** shape + bounded scope approved 2026-09-04.

**Implements:** [module-system-architecture §8 SP-1a](2026-09-04-module-system-architecture-design.md)
— the first, deliberately narrow slice of SP-1: the `WaitronModule` contract, the static composition
list, and the conversion of the migration seam so **modules are the source of truth for which migration
sets run**. Enablement gating (SP-1b), the versioned dependency ordering (SP-1c), cross-node config
replication (SP-1d), and the route/worker/duty/sync/card registries are later slices.

**Decides:** the `WaitronModule` descriptor shape and the composition mechanism; that `boot.ts`'s
migration set list is derived from the module list rather than a hand-kept JSON manifest; and how a
per-module **schema version** is derived (the input SP-2's version gate will read). It is
**behaviour-preserving**: the same nine sets run, in the same order, in both trading and setup mode.

---

## 1. Why this slice, and why narrow

The generic sync layer imports domain schema, the card catalogue enumerates every domain's cards, and
`boot.ts` wires ~24 domains by hand — all symptoms of the same thing: the core knows every module. The
module system inverts that. This slice lays the **foundation** — a descriptor each module owns and a
composition list the core derives from — and proves it on the **one lowest-risk seam**: the migration
set list (`apps/server/src/boot.ts:505-508`, today `migrationOptionsFor(manifestSets(), …)`).

It is narrow **on purpose**: `startServer` is a single 1678-line function and converting its ~24
route/worker sites is a high-risk refactor that the fiscal exemplar does not need (fiscal's runtime rides
`till-api`, not a per-module mount). This slice touches only the migration seam and adds the contract +
composition scaffolding the later slices extend.

## 2. Scope

**In scope:**
- A new `@waitron/module` package: the `WaitronModule` type (§3) and a pure `orderedMigrationSets(modules)`
  helper (§4).
- Nine `WaitronModule` descriptors, one per current migration set (core, identity, workforce, workforce-es,
  fiscal, payments, scheduler, credentials, sync), each carrying its migration info + `tier` + `version`.
  Each descriptor is **owned by its package** (exported from it) where the package exists; the composition
  root assembles them into `ALL_MODULES`.
- Converting the migration seam: `boot.ts:505` derives its set list from `ALL_MODULES` (§4). This is
  **boot-only** — `migrations.manifest.json` stays a live runtime source for its other consumers
  (provisioning's `instance-apply`/`instance-state`/`status-command`, the dev scripts, the test harnesses,
  and the bundle-layout scripts), so this slice adds a second encoding, not a replacement; the §4 pin
  guards the two against drift.
- Deriving a **per-module schema version** from the drizzle journal (§5).

**Out of scope (later slices, named):**
- **Enablement / filtering** — `ALL_MODULES` is used whole here; the config-file + reconcile + filter is
  SP-1b. (So `tier` is *recorded* on the descriptor now but not yet *acted on*.)
- **Dependency-graph / version-gated ordering** — the order stays an explicit list matching today's
  manifest; SP-1c replaces it with the derived graph. `requires` is recorded but inert.
- **Route/worker/duty/sync/card/permission/theme registries** — each its own slice; the descriptor
  declares those fields as optional and unpopulated here.
- **Cross-node replication** — SP-1d.

## 3. The `WaitronModule` contract

Defined in a new `@waitron/module` package (a low-level leaf so every module package and the composition
root can import it; for this slice it depends only on `@waitron/migrations` for `MigrationSet`). A module
is a **plain descriptor object** — no global registry, no `register()` side effects; the composition root
collects descriptors and derives each surface by mapping (§4).

```ts
export interface WaitronModule {
  /** Stable id; equals the migration-set name and the drizzle table suffix. */
  readonly name: string;
  /** Module version. Every package is 0.0.0 today (workspace-locked); real once modules distribute. */
  readonly version: string;
  /** Compatibility — recorded now, enforced in SP-1c. Inert while everything is workspace-locked. */
  readonly requires?: { readonly core?: string; readonly modules?: Readonly<Record<string, string>> };
  /** mandatory (core) | provision-only (fiscal) | toggleable (rest). Recorded now; acted on in SP-1b. */
  readonly tier: "mandatory" | "provision-only" | "toggleable";
  /** Manifest-shaped migration info — NOT an import.meta.url-derived folder (§4). */
  readonly migrations: MigrationSet;
  // --- declared for later slices; unpopulated here ---
  readonly sync?: unknown;          // SP-2
  readonly cards?: unknown;         // SP-4
  readonly vocabulary?: readonly string[];
  readonly permissions?: readonly string[];
  readonly duties?: unknown;        // cronjobs
  readonly theme?: unknown;
  readonly provisioningSeeds?: unknown;  // SP-1b
  readonly routes?: unknown;        // incremental
}
```

The later-slice fields are `unknown` here rather than fully typed, so `@waitron/module` does not yet
depend on `sync`/`layouts`/`scheduler`/`identity`; each slice tightens its own field's type when it
lands. (Recorded so a reviewer does not read the `unknown`s as sloppiness — they are the deferred slices'
seats.)

## 4. Migration source inversion

**The runtime source today is `migrations.manifest.json`**, an ordered array of `{ name, table, from }`
read by `manifestSets()` and resolved by `migrationOptionsFor(sets, root)` — and it is **not** the
packages' `X_MIGRATIONS` descriptors, because those compute `migrationsFolder` from `import.meta.url`,
which esbuild collapses to one wrong path in the bundle (`packages/migrations/src/manifest.ts:57`
documents exactly this). So the descriptor's `migrations` field must be the **manifest-shaped**
`{ name, table, from }`, carrying the same relative `from` the manifest resolves — not the
`import.meta.url` descriptor.

**The change:** `ALL_MODULES` (composition root) carries the nine descriptors in the manifest's order;
`orderedMigrationSets(ALL_MODULES)` returns `modules.map(m => m.migrations)`; and `boot.ts:505` feeds that
into the unchanged `migrationOptionsFor(…, config.migrationsRoot)`. The `from`-path resolution and the
`set_missing` guard are reused verbatim — only the *origin of the list* moves from JSON to the module
descriptors.

**Behaviour-preserving, pinned two ways:**
1. `orderedMigrationSets(ALL_MODULES)` **deep-equals** the current `manifestSets()` (same nine entries,
   same order, same `from`/`table`) — a test asserting the inversion changed nothing.
2. Boot still migrates all nine sets in both trading and setup mode (setup migrates the full schema for
   the provisioning wizard, `boot.ts:531` — unchanged here; enablement gating that would narrow it is
   SP-1b, and must preserve setup-migrates-all).

`migrations.manifest.json` is **kept** — a tree grep (done at build) found many non-test consumers of
`manifestSets()` that this slice does not touch (provisioning's `instance-apply.ts:185` migrate path,
`instance-state.ts`, `status-command.ts`; the `dev-setup`/`dev-onboard` scripts; the server and sync test
`global-setup`s; and the `copy-migrations.mjs` bundle-layout scripts + the `package.json` exports map). So
after this slice `boot` reads `ALL_MODULES` while everything else still reads `manifestSets()` — two
encodings of the same nine sets, held equal by pin (1). **Forward-warning for SP-1b:** the pin compares the
*full* `ALL_MODULES` to the *full* manifest, so it holds now; but once SP-1b filters `ALL_MODULES` by
enablement, `boot` (filtered) and provisioning (unfiltered `manifestSets()`) diverge — so SP-1b must gate
provisioning's migrate/seed path by the same enablement, in lockstep, per the architecture's provisioning
gate. Recorded here by the SP-1a whole-branch review.

## 5. Per-module schema version

SP-2's version gate needs, per module, an **expected** schema version (what a node's code ships) and an
**applied** one (what its DB has). Both are derivable today, nothing computes them yet:

- **Expected** = the module's drizzle journal head — `entries.length` (equivalently the latest `idx + 1`)
  in `packages/<pkg>/drizzle/meta/_journal.json`. A static property of the shipped folder.
- **Applied** = the row count in the module's `__drizzle_migrations_<name>` table (drizzle writes one row
  per applied migration).

SP-1a adds a **pure `expectedSchemaVersion(module)`** (reads the journal head) and a
**`appliedSchemaVersion(db, module)`** (reads the drizzle table), with tests. It does **not** wire them
into any gate (that is SP-2) — it only makes the two numbers available and proven, so SP-2 builds on a
tested primitive rather than inventing it.

## 6. Testing

- **Contract + composition unit tests** (`@waitron/module`): `orderedMigrationSets` maps in order; the
  descriptor shape holds.
- **The inversion pin:** `orderedMigrationSets(ALL_MODULES)` deep-equals `manifestSets()` — proven by
  deletion (drop a module from `ALL_MODULES` → the equality fails), then restored.
- **Boot still migrates all nine, both modes** — a real-Postgres boot/migration test that every
  `__drizzle_migrations_<name>` table is present and populated after boot (extends the existing
  boot/migration coverage; the manifest-run is already exercised).
- **Schema-version primitives:** `expectedSchemaVersion` equals the journal head for each module;
  `appliedSchemaVersion` equals it after a full migrate, and is lower on a partially-migrated fixture DB
  (a state where the two answers visibly differ, CLAUDE.md §1). Proven by deletion for each guard.
- **english-only:** `@waitron/module` is a new generic (scanned) package holding only the *type* — no
  domain vocabulary. The composition `ALL_MODULES`, which carries the `from` folder strings (e.g.
  `"../fiscal-verifactu/drizzle"`), lives in `apps/server` (the composition root, already exempt). **Run
  `pnpm vitest run scripts/english-only.test.ts` to confirm green** — this slice should need no
  `SPANISH_WORDS` change, which is the point of the inversion (Spanish names never enter the generic
  layer), but that is a claim to verify, not assert.

## 7. Invariants preserved (receipts)

- **No behaviour change:** the nine sets run in the same order in both modes (§4 pin); `migrationOptionsFor`
  and its `set_missing` guard are reused unchanged.
- **Setup mode still migrates the full schema** for the provisioning wizard (`boot.ts:531`).
- **No new privilege, no schema change** — this slice adds a package and moves a list's origin; it writes
  no migration and touches no grant.
- **Fiscal untouched** — fiscal's descriptor records its existing set; nothing about the fiscal chain,
  provisioning, or immutability moves here.

## 8. Interactions

- **SP-1b** consumes `ALL_MODULES` + `tier` to filter by the reconciled enabled set — and **must gate
  provisioning's migrate/seed path (still on unfiltered `manifestSets()`) by the same enablement**, or
  filtered-boot and unfiltered-provisioning diverge (§4 forward-warning).
- **SP-1c** replaces the explicit `ALL_MODULES` order with the derived dependency graph + version gates
  (`requires`).
- **SP-2** consumes `expectedSchemaVersion`/`appliedSchemaVersion` for the skew gate, and adds the typed
  `sync` field to the descriptor.
- **SP-3** turns `fiscal`'s descriptor into the full fiscal module (its `sync` enrolment = H2's lane, its
  `vocabulary`, its gated `provisioningSeeds`).
- **No UI**, so **parallel-safe with the B3.2 session.**

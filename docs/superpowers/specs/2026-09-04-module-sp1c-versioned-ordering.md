# SP-1c — Versioned migration ordering (dependency graph + compatibility check)

**Date:** 2026-09-04
**Status:** design. **Owner-reviewed:** the two scope forks below were taken with the owner on
2026-09-04 (full semver ranges; schema-version gate deferred).

**Implements:** [module-system-architecture §4a / §8 SP-1](2026-09-04-module-system-architecture-design.md)
— the third slice of SP-1. It replaces the hand-maintained linear migration order (today: "the
`ALL_MODULES` list order **is** the migration order", `packages/module/src/module.ts:51`) with an order
**derived from a declared dependency graph**, and adds a **compatibility check** that refuses an
incompatible or dependency-incomplete module set **loudly, before migrating anything**.

**Builds on:** SP-1a ([spec](2026-09-04-module-sp1a-contract-and-migration-source.md)) added the
`WaitronModule` contract with a `requires` field it recorded but left **inert** ("Compatibility —
recorded now, enforced in SP-1c", `module.ts:20`). SP-1b
([spec](2026-09-04-module-sp1b-enablement-and-reconcile.md)) added the on-box `modules.json` enablement
filter (`enabledModules`), which is what makes SP-1c's dependency-presence check **tripable today** (§4).

**Decides:** that `requires` is populated for the first time (from the *verified* FK/function graph, not
an invented one); that `orderedMigrationSets` becomes a single resolve-validate-and-order entry point
(so the check cannot be forgotten); the four new `module.*` error codes; and that the `semver` package
is pinned to do full-range comparison. It is **behaviour-preserving**: the same nine sets run in the same
order in both trading and setup mode.

---

## 1. Why this slice

`packages/migrations/src/apply.ts:43-44` states the problem out loud: "Ordering is the runtime's
responsibility and nothing enforces it — core carries `tenants`, which every other set has a foreign key
to. The manifest states that order out loud." The order is correct today only because a human keeps
`migrations.manifest.json` (and SP-1a's `ALL_MODULES`, pinned equal to it) in the right sequence by hand.
Nothing detects a wrong order, and nothing detects an **enabled set that is missing a dependency** —
which SP-1b's `modules.json` now makes reachable (§4).

SP-1c makes the order a **derived** property of a declared graph, and turns "the operator disabled a
module something else depends on" from a cryptic mid-migration FK failure into a clear, pre-migration
refusal.

## 2. Scope

**In scope:**
- Populate `requires` on the nine descriptors in `apps/server/src/modules.ts`, from the **verified**
  cross-set dependency graph (§3).
- Rewrite `orderedMigrationSets(modules)` in `@waitron/module` into a **resolve-validate-and-order**
  function (§5): version-compatibility check + dependency-presence check + cycle detection + a stable
  topological sort, throwing loud `module.*` errors on any violation.
- Four new `module.*` error codes (§6).
- Pin the `semver` package into `@waitron/module` for full-range comparison (§7).
- Tests, including a real-Postgres boot test proving the dependency-presence refusal (§8).

**Out of scope (named, per owner decision and architecture boundaries):**
- **The schema-version gate** ("core must reach migration version X before this module runs"). Deferred:
  within a single node's boot, topological order already guarantees core migrates fully before any
  dependent, so the gate adds nothing here; where it bites is *across independently-versioned distributed
  modules*, which overlaps SP-2's cross-node schema-version handshake. Owner decision, 2026-09-04.
- **Provisioning's migrate path.** `instance-apply.ts` still runs the linear, full `manifestSets()`,
  which is already a valid topological order — SP-1c does not route it through the new resolver. A
  forward-warning for when provisioning gains per-module enablement is recorded in §9, exactly as SP-1a
  recorded its own.
- **Cross-node config replication** — SP-1d.
- **Sync inversion / schema-version handshake** — SP-2. **UI** — SP-4.

## 3. The dependency graph (verified, not invented)

Read off the drizzle SQL on 2026-09-04 — each non-core set's `REFERENCES "public"."<table>"` targets and
its use of core functions (`current_tenant_id()`), mapped to the set that `CREATE TABLE`s each target:

| module | requires | receipt |
| --- | --- | --- |
| core | — | owns `tenants`/`tills`/`locations`/`sales`/`nodes`/`working_orders`; depends on nothing |
| identity | core | `packages/identity/drizzle/*` FKs `tenants`, `tills` |
| workforce | core, **identity** | `packages/workforce/drizzle/0000_time_attendance.sql:33,35,38` FK `persons`, which **identity** owns (`CREATE TABLE persons` is in `packages/identity/drizzle`) |
| workforce-es | core | FKs `locations`, `tenants` only |
| fiscal | core | FKs `nodes`, `sales`, `tills` (all core) + own tables |
| payments | core | FKs `nodes`, `sales`, `working_orders` (all core) + own tables |
| scheduler | core | FK `tenants` |
| credentials | core | FK `tenants` |
| sync | core | no FKs, but uses `current_tenant_id()` (a core function) in `0000_sync_outbox.sql` etc. |

The single inter-module edge is **workforce → identity**. Every other non-core module depends only on
`core`. Absence of a declared inter-module edge means "no hard ordering constraint beyond core" — the
stable tie-break (§5) then reproduces today's sequence. **The graph is read from the tree; it is not a
convenience.** If a future FK adds a cross-set edge, its `requires` entry is added in the same change (a
guard for this is discussed in §8).

**Version ranges are `"*"`.** Every module is workspace-locked at `version: "0.0.0"` (SP-1a §3). The
*true* current constraint is "any version" — there is no independent distribution yet, so no real bound
exists. Writing a fake range (`">=0.0.0 <1"`) would assert a compatibility fact that is not grounded
(CLAUDE.md §1). So the descriptors carry `"*"`; the **machinery** is full-semver, and the **tests**
(§8) exercise real ranges through fixtures where the two answers visibly differ. When versions become
real (independent distribution, §6 of the architecture), the ranges become real in the same change.

Populated shape (`modules.ts`):

```ts
{ name: "identity",  /* … */ requires: { core: "*" } },
{ name: "workforce", /* … */ requires: { core: "*", modules: { identity: "*" } } },
// core: no `requires` field at all
```

## 4. The dependency-presence check is tripable TODAY

This is the concrete safety SP-1c buys **now**, and it is worth stating plainly because it is the one
part that is *not* "enforced-but-never-tripped". SP-1b's `modules.json` is a default-on sparse override
that can disable any `toggleable` module — including `identity`. Disabling `identity` while leaving
`workforce` enabled produces an enabled set `[core, workforce, …]` whose `workforce` migrations FK
`persons`, a table `identity` owns and that is now never created. Today (post-SP-1b) that set would be
handed straight to `applyMigrations` and **fail mid-run** on a missing-relation FK error, cryptically,
after having already migrated core.

SP-1c's `orderedMigrationSets` refuses that set **before the first migration runs**, with
`module.dependency_missing { module: "workforce", requires: "identity" }`. The version-range half of the
compatibility check remains never-tripped (all `"*"` against `0.0.0`); the **dependency-presence** half
is live.

## 5. `orderedMigrationSets`: resolve, validate, order

One function, because there is exactly one call site that matters (`boot.ts:543`) and the SP-1a pin
(`modules.test.ts:8`) already calls it — folding validation in means the boot path cannot skip it. It
stays **pure** (no DB, no I/O) and keeps its signature `(modules: readonly WaitronModule[]) =>
MigrationSet[]`, so boot and the pin are unchanged at the call site. New behaviour:

1. **Version compatibility.** For each module `m` and each `(dep, range)` in `m.requires` (the `core`
   key plus every `modules` entry): the dependency must be present in the input set, and
   `semver.satisfies(dep.version, range)` must hold. A `range` that `semver.validRange` rejects throws
   `module.requires_invalid` (a descriptor bug — descriptors are code, not operator input, so this is
   fail-loud on a programming error).
2. **Dependency presence.** A required module absent from the input set throws `module.dependency_missing`
   `{ module, requires }` (§4). (Version-compat and presence are checked together per edge; presence is
   reported first because a missing module has no version to compare.)
3. **Cycle detection + ordering.** Kahn's algorithm over the edge set, with the **input list order as the
   tie-break** among ready nodes (a stable topological sort). If nodes remain when no node has in-degree
   0, throw `module.dependency_cycle { modules }` naming the unresolved members.
4. **Return** `orderedModules.map((m) => m.migrations)` — the same projection as today, over the
   topologically-sorted list.

**Why Kahn-with-input-order reproduces the manifest (the pin holds).** Traced over the §3 graph with
`ALL_MODULES` input order: `core` drains first (only in-degree-0 node); then among the newly-ready set
the input order picks `identity` before the others; emitting `identity` makes `workforce` ready, and the
input order then yields `workforce, workforce-es, fiscal, payments, scheduler, credentials, sync` — i.e.
`core, identity, workforce, workforce-es, fiscal, payments, scheduler, credentials, sync`, byte-for-byte
today's manifest. So `orderedMigrationSets(ALL_MODULES)` still deep-equals `manifestSets()` (SP-1a §4
pin), and that assertion now **also** proves the sort reproduces the manifest — it gains meaning rather
than needing a change.

**`from`-path resolution and the `set_missing` guard stay in `@waitron/migrations`'
`migrationOptionsFor`** — SP-1c only reorders and validates the set list, exactly as SP-1a's version
only projected it.

## 6. Error codes

Following the `module.*` siblings already in `packages/module/src/errors.ts` (facts about the module
system; the codes name the concept, never a specific module — CLAUDE.md §3):

- **`module.dependency_missing`** `{ module: string; requires: string }` — an enabled/migrating module
  declares a dependency (`core` or a `modules` entry) that is not in the set being migrated. The
  tripable-today case (§4).
- **`module.dependency_cycle`** `{ modules: string[] }` — the dependency graph has a cycle; `modules`
  lists the members that could not be ordered. Unreachable with today's graph (a tree rooted at core),
  guarded against a future edit that introduces one.
- **`module.incompatible_version`** `{ module: string; dependency: string; required: string; actual: string }`
  — a dependency is present but its `version` does not satisfy the declared `range`. Never-tripped today
  (all ranges `"*"`); proven by fixture.
- **`module.requires_invalid`** `{ module: string; dependency: string; range: string }` — a `requires`
  range string is not a valid semver range. A descriptor (code) bug, failed loud rather than silently
  treated as "any".

All four carry only our own English descriptions and module/range identifiers — no file content, no
domain vocabulary — so `@waitron/module` stays english-only-clean.

## 7. Dependency: pin `semver`

Full semver ranges (`^`, `~`, x-ranges, `||`, hyphen ranges, prerelease precedence) are exactly the kind
of subtly-wrong-by-hand code the repo warns against; the battle-tested `semver` package is the correct
source. It is added as a **production dependency** of `@waitron/module` (`"semver": "^7"`) with
`@types/semver` as a dev dependency, and `pnpm install` + the committed lockfile follow (CI runs
`--frozen-lockfile`). Flagged explicitly because a new production dep on a leaf package is what Copilot
caught in SP-1a (`drizzle-orm`), so it is called out here rather than slipped in. `@waitron/module` today
depends only on `@waitron/migrations` and `@waitron/shared`; `semver` is the first external runtime dep,
justified by "correctness of a security-adjacent parser beats hand-rolling".

Only `satisfies`, `validRange` (and, for the fixture tests, ordinary version strings) are used — a
minimal surface of a well-known API.

## 8. Testing

**`@waitron/module` unit tests** (pure, fast; the package carries 98/98/98/95 thresholds, so every branch
is covered), each guard **proven by deletion** (remove the check → the test fails → restore):

- **The pin repro.** `orderedMigrationSets(<descriptors in a shuffled input order>)` returns the
  dependency-correct order (core first, identity before workforce), demonstrating the sort *reorders* a
  wrong input — not just that it passes a correct one through. The existing `modules.test.ts` pin
  (`=== manifestSets()`) stays and now doubly asserts the sort reproduces the manifest.
- **Dependency-free inputs unchanged.** The existing `module.test.ts` case
  (`orderedMigrationSets(mods) === mods.map(m => m.migrations)` for `requires`-less fixtures) still holds
  — no edges → input order preserved.
- **`module.dependency_missing`** — a fixture set `[core, workforce]` (workforce requires identity,
  identity absent) throws, with the right `{ module, requires }`.
- **`module.dependency_cycle`** — a fixture `a requires b`, `b requires a` throws naming both.
- **`module.incompatible_version`** — a fixture module requires `">=1.0.0"` of a dependency present at
  `0.0.0` → throws (**a state where the version answer visibly differs**, CLAUDE.md §1: `"*"` would pass,
  `">=1.0.0"` fails). And the positive control: the same fixture at a satisfying version passes.
- **`module.requires_invalid`** — a fixture with `requires: { core: "not-a-range" }` throws.

**Real-Postgres boot test** (`apps/server`, extends the existing boot/migration coverage): boot in
trading mode with a `modules.json` disabling `identity` but not `workforce` **throws
`module.dependency_missing` before any migration runs** — asserted by confirming no
`__drizzle_migrations_*` table exists after the failed boot (the refusal precedes `applyMigrations`).
Its negative control: the same boot with the default (all-enabled) `modules.json` migrates all nine sets,
as today.

**Graph-honesty guard (considered, and its outcome recorded).** A test could scan each package's drizzle
SQL for cross-set FK targets and assert the descriptor's `requires` names the owning module — closing the
"someone adds an FK but forgets the `requires` edge" hole. This is **valuable but deferred to SP-2**,
where package-ownership of descriptors begins and the SQL-scanning guard has a natural home beside the
enrolment declarations it will already be validating; wiring it in `apps/server` now, against
centralized descriptors that SP-2 immediately moves, would be built to be relocated. Recorded here so the
hole is a known, dated decision rather than an oversight. Until then, §3's table is the receipt and a
reviewer checks a new cross-set FK against it.

**english-only** — `pnpm vitest run scripts/english-only.test.ts` stays green: no new Spanish tokens
enter the generic layer (the `requires` values are module names + `"*"`, all English/neutral; the Spanish
`from` folder strings already live in the exempt `apps/server`).

## 9. Invariants preserved (receipts)

- **No behaviour change.** The nine sets run in the same order in both modes (§5 pin trace);
  `migrationOptionsFor` and its `set_missing` guard are reused unchanged; boot's call site is untouched.
- **Setup mode still migrates the full schema** for the provisioning wizard (`boot.ts:531`) — the full
  set is dependency-complete, so the new check passes it unchanged.
- **No schema change, no new privilege, no migration written.** SP-1c adds a dependency, populates a
  recorded field, and rewrites a pure function.
- **Fiscal untouched.** Fiscal's descriptor gains `requires: { core: "*" }`; nothing about the fiscal
  chain, its provisioning, or its immutability moves.
- **Forward-warning for provisioning (mirrors SP-1a §4).** Once provisioning gains per-module enablement
  (a later slice), its migrate path must route through the same resolver or a filtered-but-unvalidated
  provisioning set could reintroduce exactly the dependency-incomplete failure SP-1c closes for boot.
  Recorded, not built here.

## 10. Interactions

- **SP-1a** — consumes the `requires` field SP-1a declared inert; the `ALL_MODULES` order it fixed
  becomes the tie-break rather than the source of truth. Its pin gains meaning (§5).
- **SP-1b** — `enabledModules` produces the set SP-1c validates; SP-1c's dependency-presence check is the
  safety net over SP-1b's enablement (§4).
- **SP-1d** — cross-node config replication must flow a dependency-consistent enabled set to each peer;
  SP-1c's check runs at each peer's boot, so an inconsistent flowed-down set is refused there too.
- **SP-2** — package-ownership of descriptors begins; the graph-honesty guard (§8) relocates there; the
  schema-version handshake (deferred here) lands there.
- **No UI**, so **parallel-safe with the B3.2 session.**

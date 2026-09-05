# SP-3c — Module-owned gated provisioning (the fiscal module's `provisioning` and `fiscal` seats)

**Date:** 2026-09-05
**Status:** design. **Owner-reviewed:** the three shaping decisions below were taken 2026-09-05 (the
brainstorm that produced this spec): (1) SP-3c covers every provisioning-time seam plus the backend
slot, and defers the runtime fiscal pass to the `fiscal-none` slice; (2) the composition list moves
into a new `@waitron/composition` package; (3) `FiscalBackend` gains an `id`, and the caller-supplied
`fiscalBackend` input to `packages/core` is removed.

**Implements:** [module-system-architecture §8 SP-3](2026-09-04-module-system-architecture-design.md) —
the third of the four slices SP-3 was split into (owner decision 2026-09-05; see
[SP-3a](2026-09-05-module-sp3a-fiscal-record-lane-design.md) for the split):

- **SP-3a — LANDED #238** — the fiscal module's sync enrolment.
- **SP-3b — LANDED #240** — module-owned vocabulary.
- **SP-3c (this spec)** — module-owned **gated provisioning**: sever the direct
  `@waitron/provisioning → @waitron/fiscal-verifactu` import, route `registerSif` through a typed
  `provisioning` seat, and make the till's fiscal-backend choice module-driven through a typed `fiscal`
  seat. Country selection stays out of scope: Spain remains the one populated territory in
  `resolveFiscalModules`, but the composition root no longer names `VerifactuBackend`, `registerSif`,
  `writeReservedSif` or `"verifactu"` anywhere except the composition list.
- **SP-3d (= BR-4, independent)** — the fiscal module's backup/restore contribution.

**Consumers after this slice:** `fiscal-none` (Track C item 2) fills the same two seats with a
no-regime backend and, in its own slice, designs the **runtime-duty** seat this spec defers (§12).

---

## 1. What this is, and its scope

Today the generic provisioning package imports the Spanish regime directly
(`packages/provisioning/src/venue-apply.ts:4` — `registerSif` from `@waitron/fiscal-verifactu`), and
the composition root reaches into the same package from five more files. Measured on `main` at
`ff37904d` with `grep -rn 'from "@waitron/fiscal-verifactu"' packages/provisioning/src apps/server/src`
over non-test files:

| Site                                                   | Calls                                                                  | Family                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------- |
| `packages/provisioning/src/venue-apply.ts`             | `registerSif`                                                          | venue provisioning                  |
| `apps/server/src/provision-till.ts` (+ `register-till`) | `registerSif`                                                          | standalone node (re-)registration   |
| `apps/server/src/mirror-bundle.ts`                     | `currentSif`, `reserveInstallationNumber`, `deriveReservedSeriesCodes` | standby reservation (primary side)  |
| `apps/server/src/reserved-identity.ts`                 | `writeReservedSif`                                                     | standby establishment (mirror side) |
| `apps/server/src/till-backend.ts`                      | `new VerifactuBackend(...)`                                            | backend selection                   |
| `apps/server/src/boot.ts`                              | `drain`                                                                | runtime fiscal pass                 |
| `apps/server/src/modules.ts`                           | `FISCAL_ENROLMENT`, `FISCAL_VOCABULARY`                                | the composition list (stays)        |

Regime knowledge also sits in the composition root without an import: `fiscalBackend: "verifactu"` is
hardcoded at every sale/correction/substitution site (`apps/server/src/till-sale.ts:609,976,1149`,
`working-order.ts:3115`); `WAITRON_ID_SISTEMA` (Waitron's AEAT software id) and its validator live in
generic provisioning (`packages/provisioning/src/fiscal-modules.ts`); and the AEAT transport, the cert
sealing and the wizard's cert gate are regime-specific runtime wiring (`aeat-transport.ts`,
`aeat-credential.ts`, `setup-api.ts:393-399`).

`fiscal-none` cannot land while any of these names the Spanish regime. **The owner's allocation
(decision 1):** this slice takes the whole **provisioning family** (the first four rows) and the
**backend slot** (row five plus the hardcoded backend id); the **runtime pass** (row six, the
transport, the cert flow) is deferred to `fiscal-none`, where the no-transport case makes that seat's
shape obvious rather than guessed (§12). The import-boundary guard (§9) allowlists the deferred files
with that reason, so the deferral is a ratchet, not a leak.

**In scope:** the typed `provisioning` seat and its runner in `@waitron/provisioning`; the typed
`fiscal` seat, its selection rule and `FiscalBackend.id`; the fiscal package's two contributions and
the code that moves into it (`WAITRON_ID_SISTEMA`, the tenant-NIF read, the standby reservation and
establishment); the composition list's move to `@waitron/composition`; the standalone node
registration path (`provisionNode` / `register-till`) rebuilt on the seat; the `MirrorBundle` wire
shape; the root guard; every receipt the move falsifies (§11); CLAUDE.md §3 and the backlog.

**Out of scope, named:** the runtime-duty seat (§12); country selection and any second territory in
`resolveFiscalModules`; `packages/migrations`' devDependency on `@waitron/fiscal-verifactu` (it exists
for `manifest.test.ts` only, and a dev-only cycle through `@waitron/migrations` is already recorded —
SP-3a's backlog entry); the enabled-set pull filter (still deferred to the first toggleable module);
any migration; any change to what `registerSif` writes.

## 2. The `provisioning` seat

`WaitronModule.provisioningSeeds?: unknown` (reserved by SP-1b, never typed) is replaced by:

```ts
// packages/module/src/provisioning.ts (new)
import type { Transaction } from "@waitron/db";
import type { LocationId, NodeId, TenantId } from "@waitron/shared";

/** The node a seed runs for. Built by the RUNNER from rows it just inserted or read — never from
 * operator input (an operator-supplied identity would file a real tenant's sales under someone
 * else's; the tenant's own tax id is read from `tenants` by whoever needs it). */
export interface ProvisionedNode {
  readonly tenantId: TenantId;
  readonly locationId: LocationId;
  readonly nodeId: NodeId;
}

/** A per-node seed: what a module establishes for a freshly created (or reimaged) node. */
export interface NodeSeed {
  /** One line for the operator's plan summary (`waitron-provision venue` prints the plan before
   * applying it). Names the effect, not the mechanism. */
  readonly summary: string;
  /** Runs INSIDE the caller's provisioning transaction, after the core rows exist. Returns a
   * one-line report of what it minted, for the CLI and `register-till` to print. Re-running it for
   * an existing node is meaningful, not an error — a module decides what a re-seed means (for the
   * fiscal module: a fresh installation number and a new chain, which is what a reimaged box needs). */
  run(tx: Transaction, node: ProvisionedNode): Promise<string>;
}

/** What a module contributes when a STANDBY is stood up: the primary reserves, the mirror
 * establishes. Declared together — a module that reserves state must know how to establish it. */
export interface StandbyProvisioning {
  /** Primary side, inside the bundle-minting transaction. `state` is module-owned, opaque to the
   * carrier and JSON-serialisable (it rides the `MirrorBundle`); `series` are the standby's invoice
   * series, whose codes the module derives disjoint from the primary's — the carrier inserts them
   * (`invoice_series` is core's table; the DISJOINTNESS rule is the regime's). */
  reserve(tx: Transaction, primary: ProvisionedNode): Promise<StandbyReservation>;
  /** Mirror side, inside the adopt transaction, after the standby's own node row exists. `state` is
   * wire input the module VALIDATES before writing anything (CLAUDE.md §3). */
  establish(tx: Transaction, standby: ProvisionedNode, state: unknown): Promise<void>;
}

export interface StandbyReservation {
  readonly state: unknown;
  readonly series?: readonly { readonly code: string; readonly purpose: string }[];
}

export interface ModuleProvisioning {
  readonly seed?: NodeSeed;
  readonly standby?: StandbyProvisioning;
}
```

`WaitronModule` gains `readonly provisioning?: ModuleProvisioning`. Omit the seat rather than declare
`{}`, as with `vocabulary`.

**Why the context is three ids and nothing more.** The fiscal seed needs the obligado's NIF and
Waitron's software id. The first is `tenants.tax_id` for an ES tenant — that mapping is the fiscal
module's knowledge, so the seed reads it itself (the exact `select tax_id from tenants where id = …`
that `provision-till.ts`'s `obligadoNif` and `venue-apply.ts`'s `registerSifForNode` each do today,
now in one place); the second is a product constant of that module (§8). A generic context that
carried `taxId` would be a fiscal fact on a generic seat, and one that carried a software id would be
a generic seat that knows about AEAT.

**Where the type lives, and the dependency direction.** `@waitron/module` gains `@waitron/db`
(the `Transaction` type — a type-only import, but pnpm resolves only declared dependencies). Verified
acyclic in the production graph: `@waitron/db` depends on `@electric-sql/pglite`, `@waitron/membership`,
`@waitron/shared`, `@waitron/sync-enrolment`, `drizzle-orm`, `pg` (its `package.json`), none of which
depend on `@waitron/module` (only `apps/server` does — `grep -l '"@waitron/module"' packages/*/package.json apps/*/package.json`).
`@waitron/fiscal-verifactu` gains `@waitron/module` for the seat types; its production path is
`module → migrations → db/shared`, and `@waitron/migrations` lists `@waitron/fiscal-verifactu` only under
`devDependencies` (`packages/migrations/package.json`), so the cycle this creates is **dev-only** —
the same shape SP-3a already records for fiscal's PGlite harnesses migrating the full manifest. The
english-only guard scans `packages/module` (`GENERIC_PACKAGES`, `packages/db/src/english-only.ts:13-`),
so every identifier and comment in the seat file is English; the fiscal words stay in the fiscal
package.

## 3. The `fiscal` seat and the backend slot

```ts
// packages/fiscal/src/contribution.ts (new — the regime-neutral contract package)
import type { Database, DeploymentEnvironment } from "@waitron/db";
import type { TrustedClock } from "./clock.js";
import type { FiscalBackend } from "./backend.js";

export interface FiscalBackendDeps {
  readonly db: Database;
  readonly clock: TrustedClock;
  /** Which deployment this host is — the value a regime stamps on what it records. */
  readonly environment: DeploymentEnvironment;
}

/** What a module contributes to the fiscal SLOT — the one provision-only, swappable slot the
 * architecture names (§2 tiers). Exactly one enabled module fills it (§3 selection). */
export interface FiscalContribution {
  /** The backend's identifying string: what `sales.fiscal_backend` records and what
   * `resolveFiscalModules` stamps into `nodes.filing_module` at provisioning. Equals
   * `makeBackend(...).id` — a test pins the two together. */
  readonly id: string;
  /** The SALE-PATH backend: files locally and never contacts an authority (spec §4 — nothing
   * external may block a sale). The runtime duty that does contact one is a later seat (§12). */
  makeBackend(deps: FiscalBackendDeps): FiscalBackend;
}
```

`WaitronModule` gains `readonly fiscal?: FiscalContribution`, and `@waitron/module` gains
`@waitron/fiscal` for the type (acyclic: `@waitron/fiscal` depends on `@waitron/db`, `@waitron/shared`
and `drizzle-orm` only). `packages/fiscal`'s `no-regime-vocabulary.test.ts` scans the new file: it names
no chain, hash, authority or regime.

**`FiscalBackend.id`** (decision 3). The interface gains `readonly id: string`. `VerifactuBackend`
returns its existing `BACKEND_ID` (`"verifactu"`, `backend.ts:49`); the fake returns `"fake"`. In
`packages/core`, `recordSale`, `recordCorrection` and `recordSubstitution` drop their `fiscalBackend`
input and write `backend.id` into `sales.fiscal_backend`. The doc on that input (`record-sale.ts:113-119`)
justified a caller-supplied value because the sale row is written before `backend.recordSale` returns
its `FiscalRecordRef.backend`; `backend.id` is known before either. Measured churn: `fiscalBackend:`
appears in 40 files (22 non-test lines) — one deleted line per call site.

**Selection — `fiscalSlot(modules, stamped)`** in `packages/module/src/fiscal-slot.ts`:

1. Among `modules` (the composition root passes the **enabled** set), collect those declaring
   `fiscal`.
2. Zero → throw `module.fiscal_slot_empty` (a trading node with no fiscal module is not a
   configuration this product supports; `fiscal-none` is how "no regime" is expressed).
3. Two or more → throw `module.fiscal_slot_ambiguous { candidates }` (today's list can never produce
   this; it is the guard that makes a second regime package an explicit decision, and the point at
   which the node's stamped filing module would become the selector rather than a cross-check).
4. `stamped` — the node's `nodes.filing_module` — non-null and ≠ the candidate's `id` → throw
   `module.fiscal_slot_mismatch { stamped, enabled }`: a node provisioned under one regime booting
   under another would file records the first regime cannot take back. `null` skips the check:
   `filing_module` is nullable (`packages/db/src/schema/nodes.ts:21-38`) and bare-node fixtures leave
   it so; every venue `applyVenue` provisions stamps it (`venue-apply.ts:163-164`), and a standby's
   reserved node copies the primary's (`adopt.ts:140`).

`apps/server/src/till-backend.ts` keeps its name and its `systemClock`, and `makeFiscalBackend`
becomes `makeFiscalBackend(modules, stamped, db, env)`: `fiscalSlot(...)` then
`makeBackend({ db, clock: systemClock(), environment: deploymentEnvironment(env) })`. The
never-called AEAT resolver (`rejectResolveClient`) moves into the fiscal module's `makeBackend` — it
was always that module's invariant ("recordSale never resolves a client", `backend.ts:104-106`), and
the composition root no longer knows a resolver exists. Boot reads the node's `filing_module` once
beside `readOrderFlow` (`till-config.ts:243`) and passes it as `stamped`.

`resolveFiscalModules` (`packages/provisioning/src/fiscal-modules.ts`) is unchanged: it still stamps
`{ filing: "verifactu", tax: "iva" }` for `ES-common`. What ties it to the slot is a **root-project
test** (§9): every `filing` value in the registry names the `id` of a `fiscal` contribution in
`ALL_MODULES`. The registry and the list cannot drift apart silently.

## 4. The composition list moves to `@waitron/composition`

`waitron-provision venue` (`packages/provisioning/src/bin.ts` → `cli.ts` → `applyVenue`) must run the
module seeds, so it needs the module list — and a package cannot import
`apps/server/src/modules.ts`. Two lists would drift; the list moves (decision 2).

- **New package `packages/composition`** (`@waitron/composition`): exports `ALL_MODULES` only, with the
  descriptor list and its doc moved verbatim from `apps/server/src/modules.ts` (thinned on the way —
  CLAUDE.md §1 — its narrative on which slice populated which seat is history). Dependencies: every
  package whose seat value it references (`@waitron/db` for `CORE_ENROLMENT`, `identity`, `payments`,
  `workforce-es`, `fiscal-verifactu`) plus `@waitron/module`. Nothing it depends on depends on it, and
  `@waitron/provisioning` is depended on by `apps/server` alone, so the graph stays acyclic.
- **`apps/server/src/modules.ts` stays** for the derived values (`ALL_SYNC_ENROLMENTS`,
  `MODULE_BY_TABLE`) and re-exports `ALL_MODULES`, so its nine in-package importers and
  `packages/sync`'s comments keep their path; the root guards (`english-only`,
  `module-graph-honesty`) and the moved pins import the package directly.
- **`apps/server/src/modules.test.ts` splits:** the list pins (manifest byte-for-byte, the module
  names in order, the backup and vocabulary seats) move to `packages/composition/src/composition.test.ts`;
  the `MODULE_BY_TABLE` tests stay.
- **Not a generic package.** A composition list names every module by construction, like
  `apps/server`; it is **not** added to `GENERIC_PACKAGES` (the SP-3b decision that the list stays
  explicit, `2026-09-05-module-sp3b-vocabulary-design.md` §8), so `scripts/english-only.test.ts`'s
  pin of that list does not change.
- **CI registration, three places, by the `@waitron/sync-enrolment` precedent:** `LIGHT_B_PACKAGES`
  in `scripts/changed-scope.mjs`, the matching `--filter "!@waitron/…"` exclusion list in
  `.github/workflows/ci.yml` (`test-light-a`'s), and `scripts/changed-packages.mjs`'s expectations if
  any test pins the bin membership. `scripts/coverage-thresholds.test.ts` derives the member list from
  `pnpm` and assigns every non-listed package the `90/90/85/85` floor, so the new package's
  `vitest.config.ts` declares exactly that bar.
- **`packages/provisioning` dependencies:** `@waitron/fiscal-verifactu` leaves `dependencies`
  (`bin.ts` imports `@waitron/composition` instead; `@waitron/module` is added for the seat types) and
  re-enters under `devDependencies` for `venue-apply.e2e.test.ts`, which still drives the real
  `VerifactuBackend` against a venue the real `applyVenue` provisioned. Run `pnpm install` and commit the
  lockfile — the hook's `--frozen-lockfile` fails otherwise (CLAUDE.md §2).

## 5. Venue provisioning after the change

**`planVenue(request, modules)`** takes the module list (it reads `name` and `provisioning?.seed` only)
and emits, LAST in the plan, one `{ kind: "seed-module", module, summary }` per module declaring a
seed — in list order. `register-sif` is gone, and so are `WAITRON_ID_SISTEMA` and
`assertUsableIdSistema` in this package (§8). `describeVenueAction` prints
`seed module fiscal: register the node as a Veri*Factu SIF and start its chain` — the operator
confirming the plan sees the same fact the old line showed.

**`applyVenue(actions, { db, modules })`** handles `seed-module` by looking the module up in
`deps.modules` and calling `provisioning.seed.run(tx, { tenantId, locationId, nodeId })` inside the
one `withTenant` transaction, after every core row (the plan orders it last; the runner also refuses
`seed-module` before `create-node`, the way it refuses `create-series` before `create-node`). A plan
naming a module the deps do not hold, or one without a seed, is a plan-integrity `Error` like the
ordering guards, never an `AppError`. The `sif === undefined` completeness check goes with the action:
a plan with no seeds is legal for a module set with none.

**`VenueResult`** loses `sif` (its only non-test consumer is the CLI's one print line, `cli.ts:498`)
and gains `seeded: readonly { module: string; report: string }[]`, in plan order. The CLI prints one
`seeded:  fiscal — <report>` line per entry. Tests that read `result.sif.id` read `registro_sif` by
`node_id` instead — an assertion on the database, not on a return value.

**Callers that pass the list:** `apps/server/src/provision.ts` (from `ALL_MODULES`, filtered by the
enabled set — the same `moduleConfig` its SP-1b gate already reads), `cli.ts` via a new `CliDeps.modules`
(`bin.ts` supplies `ALL_MODULES`; the CLI has no `modules.json`, so it seeds every module in the list),
`apps/server/scripts/dev-setup.ts` and the four demo scripts (`ALL_MODULES`), and every test that builds
a plan (a fake module with a recording seed where the fiscal seed's side effects are not the point).

**Standalone node registration** (`apps/server/src/provision-till.ts`, `scripts/register-till.ts`):
`provisionNode(db, { tenantId, nodeId }, modules)` keeps its ownership guard
(`assertNodeBelongsToTenant`), reads the node's `location_id`, and runs every module's seed for that
node, returning the `{ module, report }` list the script prints. The `idSistemaInformatico` argument
is gone (it is the fiscal module's constant, §8), so `register-till` takes two arguments. The "re-run
= reimaged node gets a fresh chain" semantics are unchanged and now documented on the fiscal seed
where they belong.

## 6. Standby provisioning after the change

**Primary side** (`assembleMirrorBundle`, `apps/server/src/mirror-bundle.ts`): inside the existing
`withTenant(appDb)` transaction, for each enabled module declaring `provisioning.standby`, call
`reserve(tx, { tenantId, locationId, nodeId: designated.nodeId })`, collecting `state` by module name
and concatenating `series`. The fiscal module's `reserve` is today's inline block moved verbatim:
`currentSif` → `reserveInstallationNumber` → read the primary's series → `deriveReservedSeriesCodes`,
returning `{ state: { nif, idSistemaInformatico, numeroInstalacion }, series }`. The endorsement stays
in the composition root (it is membership, not fiscal).

**Wire shape.** `ReservedIdentity` becomes

```ts
export interface ReservedIdentity {
  modules: Record<string, unknown>; // module name → its opaque reservation state
  series: { code: string; purpose: string }[];
  endorsement: Endorsement;
}
```

`nif`/`idSistemaInformatico`/`numeroInstalacion` no longer appear on the bundle type; they live inside
`modules.fiscal`. No backwards compatibility (nothing is deployed): the bundle is minted and consumed
by the same version.

**Mirror side** (`establishReservedStandbyIdentity`, `apps/server/src/reserved-identity.ts`): after
`insertReservedNodeTx`, for each enabled module declaring `standby`, call
`establish(tx, standbyNode, reserved.modules[name])`; then `insertReservedSeriesTx(reserved.series)` as
today. The fiscal `establish` validates its state — three fields, the number a positive integer — and
throws `sif.reservation_invalid { reason }` otherwise, before `writeReservedSif`. A module declaring
`standby` whose state is absent from the bundle is the same refusal (the reason names the module):
a standby that silently skipped its dormant fiscal identity would be promotable with no SIF to
activate. `adopt.ts` reads the enabled set from the bundle's `moduleOverrides` it already parses
(`adopt.ts:118`).

Idempotency is unchanged: the membership-key latch at the top of `establishReservedStandbyIdentity`
still returns before any module runs on a re-adopt.

## 7. The fiscal package's contributions

`packages/fiscal-verifactu/src/provisioning.ts` (new) exports:

- **`FISCAL_PROVISIONING: ModuleProvisioning`** — `seed` (summary + `run`: read the tenant's `tax_id`,
  `registerSif` with `WAITRON_ID_SISTEMA`, return `"SIF <id> (installation <n>)"`) and `standby`
  (`reserve`/`establish` as §6).
- **`FISCAL_SLOT: FiscalContribution`** — `{ id: "verifactu", makeBackend }`, where `makeBackend` is
  today's `till-backend.ts` body: a `VerifactuBackend` with the host's clock and db, both environment
  fields from `deps.environment`, and the rejecting `resolveClient` now owned here. `Environment` (the
  QR host) and `Entorno` (the stamped deployment) both take the same value, exactly as
  `till-backend.ts:72-73` does today.

`packages/fiscal-verifactu/src/index.ts` exports both. `registerSif`, `writeReservedSif`,
`reserveInstallationNumber`, `currentSif` and `deriveReservedSeriesCodes` stay exported (their tests and
the provisioning e2e use them); the guard (§9) is what stops the composition root reaching for them.

`apps/server/src/modules.ts` (soon `packages/composition`) adds `provisioning: FISCAL_PROVISIONING` and
`fiscal: FISCAL_SLOT` to the `fiscal` descriptor. That is the whole of what the composition list learns.

## 8. What moves into the fiscal package, and the error codes

- **`WAITRON_ID_SISTEMA = "W1"`** moves from `packages/provisioning/src/fiscal-modules.ts` to the fiscal
  package: it is Waitron's AEAT-registered identifier, a fact about this regime's filing, not about
  provisioning. `assertUsableIdSistema` is deleted from provisioning; **`registerSif` validates its
  `idSistemaInformatico` itself** (non-empty, ≤ 2 chars — `packages/verifactu`'s `ID_SISTEMA_LENGTH`
  rule, which `apps/server/src/errors.ts:114-128` records has no production caller), throwing
  **`sif.id_sistema_invalid`**, whose declaration moves from `apps/server/src/errors.ts` into the fiscal
  package's registry — the move that file's own doc comment asked for ("this code belongs there once
  that package validates its own input"). Same code string, one declaring file; `apps/server`'s
  `provisionNode` no longer throws it.
- **`provisioning.id_sistema_invalid`** is deleted from `packages/provisioning/src/errors.ts`: its only
  throw site is deleted, and the concept now has its one home above. Nothing is shipped (CLAUDE.md
  §3, no-backwards-compatibility), so this is a deletion, not a rename; the errors.ts doc that cites it
  as a `value`-param sibling (`errors.ts:93`) is edited.
- **New:** `sif.reservation_invalid { reason: string }` (fiscal package — a bundle's reservation state
  failed validation on the mirror); `module.fiscal_slot_empty {}`,
  `module.fiscal_slot_ambiguous { candidates: readonly string[] }`,
  `module.fiscal_slot_mismatch { stamped: string; enabled: string }` (`@waitron/module`). Every file
  that throws one imports its registry; reachability is guarded once in `scripts/errors-reachable.test.ts`.

## 9. Guards and tests

**Root-project import-boundary guard — `scripts/module-seams.test.ts` (new).** Reads text like
`module-graph-honesty` and says so in its header. Asserts:

1. No non-test file under `packages/provisioning/src` except `bin.ts` imports `@waitron/composition` or
   any package a descriptor's `migrations.from` names (derived through `packageDirOf`, so the module
   set is the list's, never a hand-copied one), and `packages/provisioning/package.json` lists no such
   package under `dependencies`.
2. No non-test file under `apps/server/src` (excluding `src/testing/`) except `modules.ts` imports
   `@waitron/fiscal-verifactu` or `@waitron/verifactu`, **with an explicit allowlist** —
   `boot.ts` (`drain`), `aeat-transport.ts`, `aeat-credential.ts` — each entry carrying the deferral
   reason (§12). The `fiscal-none` slice shrinks the allowlist to empty and the assertion to
   `modules.ts` only.
3. A **positive control**: a synthetic source line `import { x } from "@waitron/fiscal-verifactu"` in a
   non-allowlisted path is detected (the guard is not vacuous).
4. Every `filing` value `resolveFiscalModules` can return names a `fiscal.id` in `ALL_MODULES` (§3).
   `fiscal-modules.ts` exports the registry's keys as `FISCAL_TERRITORIES` so the test enumerates the
   real set rather than a hand-copied one (`ES-common` today), and asserts the set is non-empty — a
   registry with no territory would otherwise pass vacuously.

**Proven by deletion (each stated as the experiment, run before the PR):**

- Remove `provisioning: FISCAL_PROVISIONING` from the `fiscal` descriptor → `packages/provisioning`'s
  e2e "sellable" test fails at `recordSale` with `sif.not_registered` (no seed ran), and `provision.test.ts`'s
  `registro_sif` count is 0.
- Remove `fiscal: FISCAL_SLOT` → `till-backend.test.ts` and the boot suite fail with
  `module.fiscal_slot_empty`.
- Stamp a fixture node `filing_module = "other"` → `module.fiscal_slot_mismatch`.
- Delete the fiscal `standby.establish` write → the mirror e2e's reserved-SIF assertion
  (`adopt-e2e.rls.test.ts`) fails.
- Pass `"WTX"` to `registerSif` → `sif.id_sistema_invalid`.

**Per package:**

- `@waitron/module`: `fiscalSlot` — zero/one/two candidates, null and matching and mismatching
  `stamped`; the seat types compile against a fake module.
- `@waitron/fiscal`: `contribution.ts` passes `no-regime-vocabulary`; the fake backend carries `id`.
- `@waitron/fiscal-verifactu` (PGlite, full manifest — its harnesses already migrate it): the seed
  registers a SIF whose `nif` is the tenant's `tax_id`; a second run mints a fresh installation number
  and a new chain; `reserve` → `establish` round-trips into a reserved `registro_sif` row and disjoint
  series codes; a malformed state throws `sif.reservation_invalid` and writes nothing; `FISCAL_SLOT.id`
  equals `makeBackend(...).id`; the built backend's `drain` rejects (the resolver is the never-called
  stub).
- `@waitron/provisioning`: `planVenue` emits one `seed-module` per seeding module, last, in list order,
  and none for a list without seeds; `applyVenue` runs the seed inside the transaction (a fake seed that
  throws rolls the venue back — the tenant row is absent afterwards) and refuses an unknown module or
  a pre-`create-node` seed; the CLI prints the `seeded:` lines (fixture updated); the e2e is unchanged in
  intent and now passes `FISCAL_PROVISIONING` through a minimal list.
- `@waitron/composition`: the moved pins.
- `packages/core`: `sales.fiscal_backend` equals `backend.id` for a sale, a correction and a
  substitution (the fake's `"fake"`).
- `apps/server`: `provision.test.ts` asserts the `registro_sif` row rather than `result.sif`;
  `provision-till.test.ts` runs the seed path and the ownership refusal; `till-backend.test.ts` asserts
  the selection outcomes; `mirror-bundle.rls.test.ts` / `reserved-identity.test.ts` / `adopt.rls.test.ts`
  / `adopt-e2e.rls.test.ts` carry the new wire shape (real PG where they are real PG today — the
  reserved-SIF write runs as the owner under FORCE RLS, which PGlite cannot exercise, CLAUDE.md §4).

**Coverage bars:** `module`, `fiscal-verifactu`, `core`, `db` hold `98/98/98/95`; `provisioning`,
`composition`, `fiscal`, `apps/server` the floor — unchanged assignments
(`scripts/coverage-thresholds.test.ts`).

## 10. Invariants preserved (receipts)

- **One SIF per node at provision, minted in the venue's one transaction** (CLAUDE.md §5; architecture
  §9). The seed runs inside `applyVenue`'s `withTenant` — the same transaction, one position later in
  the plan. `registerSif` itself is untouched; its allocator and chain-head reset are unchanged.
- **Nothing external on the sale path.** `makeBackend` builds the same `VerifactuBackend` with the same
  rejecting resolver; `recordSale` never resolves a client. The only change is who constructs it.
- **The SP-1b gate stands.** `provisionVenue` still refuses when a provision-only module is disabled,
  before `planVenue`; the seed can only run for a module in the enabled set it was given.
- **The mirror never mints.** `adoptVenue` still runs no seed; the standby's identity is reserved by the
  primary (its own counter) and merely written by the mirror, as `reserved-standby-identity-and-promotion`
  §6 R2 designs it.
- **`entorno` is not in the hash; `sales.fiscal_backend` is the backend's own id.** `VerifactuBackend`'s
  `BACKEND_ID` is the value every sale row carried before (`till-sale.ts:609`), now read from the
  instance rather than restated.
- **English-only unchanged in verdict.** No generic package gains a Spanish token: the seat files in
  `packages/module` and `packages/fiscal` are English; the fiscal words move INTO the fiscal package.

## 11. Receipts this change retires (edit in the same PR)

- `packages/provisioning/src/venue-apply.e2e.test.ts:26-31` — "provisioning already depends on
  `@waitron/fiscal-verifactu` (for `registerSif`), so a fiscal-verifactu test importing `applyVenue`
  would be a dependency cycle": the production dependency is gone; the suite stays here because the
  e2e is provisioning's success criterion, with the fiscal package as a devDependency.
- `packages/provisioning/src/fiscal-modules.ts` header — the `WAITRON_ID_SISTEMA` doc and its
  "`provision-till.ts` still takes it as an argument … converging the two is a noted follow-up": converged.
- `packages/module/src/module.ts` — `provisioningSeeds?: unknown // SP-1b`, and the header's "Where the
  descriptors LIVE … centralized in the composition root (`apps/server/src/modules.ts`)".
- `apps/server/src/modules.ts` header — the narrative of which slice populated which seat (thinned,
  CLAUDE.md §1), and "this list is the source of truth Task 4 hands to boot".
- `apps/server/src/provision-till.ts` and `apps/server/scripts/register-till.ts` headers and usage
  (three arguments → two; `registerSif` named as the mechanism).
- `apps/server/src/errors.ts` `sif.id_sistema_invalid` (moved); `packages/provisioning/src/errors.ts`
  `provisioning.id_sistema_invalid` (deleted) and the `value`-param list at `:93`.
- `apps/server/src/provision.ts` header step 4 ("mints tenant/location/till/node/SIF/series") and the
  `ProvisionDeps` doc.
- `apps/server/src/till-backend.ts` header ("a `VerifactuBackend` built exactly as
  `scripts/record-one-sale.ts` does") and `till-backend.test.ts` ("builds a VerifactuBackend").
- `apps/server/src/mirror-bundle.ts` `ReservedIdentity` doc; `reserved-identity.ts` header;
  `adopt.ts:123-130`.
- `packages/core/src/record-sale.ts:113-119` (the deleted input's doc) and its two siblings.
- `docs/superpowers/specs/2026-09-04-module-system-architecture-design.md` §9 ("provisioning still
  mints exactly one SIF per node at provision (`venue-apply.ts:158`)") — a dated pointer, not a rewrite.
- `.github/instructions/waitron.instructions.md` — read in full for any claim about provisioning, the
  composition root or `apps/server/src/modules.ts` (SP-3b's lesson: the receipt sweep must include it).
- CLAUDE.md §3: one entry — the composition list lives in `@waitron/composition`; only `bin.ts` and
  `modules.ts` import module packages, and `scripts/module-seams.test.ts` says so; a module's seed runs
  inside `applyVenue`'s one transaction.

## 12. Deferred to the `fiscal-none` slice — the runtime-duty seat

Named here so the next brainstorm starts from a list, not a rediscovery:

- **`boot.ts`'s `drain` call** (`boot.ts:25,1931`). `FiscalBackend.drain(now)` exists and
  `VerifactuBackend.drain` is a one-line delegation to the same `runDrain` (`backend.ts:831-838`), but
  boot bypasses it to build a per-pass AEAT resolver it can close (`aeatClientResolver`, closed in
  `finally`). A module-driven pass needs the transport to be module-owned or injected through a generic
  hook — a design with two implementations in hand (`verifactu` with a transport, `none` without).
- **`aeat-transport.ts`** (236 lines, `@waitron/verifactu`'s SOAP endpoints and mTLS) and
  **`aeat-credential.ts`** (`fiscal.aeat` sealing).
- **The wizard's cert gate** (`setup-api.ts:393-399`: `mode === "live" && fiscalTerritory === "ES-common"`)
  and the `sealAeat` dependency — a regime's provisioning-time INPUT (a certificate) that the generic
  wizard currently knows the shape of.
- **`FiscalBackend.reconcile`** has no production caller today (`grep -rn "\.reconcile(" apps/server/src`
  finds only the payments reconciler); it rides along with the duty seat.

`fiscal-none` fills `provisioning` (a seed, if any — probably none: a no-regime node needs no
identity; a `standby` that derives disjoint series by some non-fiscal rule) and `fiscal` (`id: "none"`,
a backend whose `recordSale` writes nothing and whose `checkIntegrity` answers `checked: 0`), adds a
territory to `resolveFiscalModules`, and lands the two CLAUDE.md rules the backlog assigns to it.

## 13. Interactions

- **SP-3d (BR-4)** — independent; it fills `backup.restore`. If both are in flight, the only shared
  file is the `fiscal` descriptor entry (textual).
- **Track A (data layer)** — no shared files; `nodes.filing_module` is read, not changed.
- **Track B** — the `MirrorBundle` wire shape changes (§6). Measured 2026-09-05 with
  `git diff --name-only main...<branch>` over the three open worktree branches (`ui/till-login`,
  `feat/till-reroute-s1-server-truth`, `feat/drop-rls-step1`): none touches `mirror-bundle.ts`,
  `adopt.ts`, `reserved-identity.ts` or any other file this slice edits. If a later Track B branch
  does, whoever lands second rebases (CLAUDE.md §6).
- **Track 1 area 19 (device management)** — `provisionNode` / `register-till` change signature; the
  same measurement shows the till-login branch does not touch them.

## 14. What this does not touch

`registerSif`'s writes, the chain, `contadores_instalacion`; any migration; `resolveFiscalModules`'s
registry contents; the SP-1b gate; `adoptVenue`; the sync enrolment and vocabulary seats; the AEAT
transport, cert sealing and wizard cert gate (§12); `packages/migrations`' devDependency on the fiscal
package; `GENERIC_PACKAGES`; the enabled-set pull filter.

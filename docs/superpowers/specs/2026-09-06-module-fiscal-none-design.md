# `fiscal-none` — the no-regime fiscal module (Track C item 2)

**Date:** 2026-09-06
**Status:** design. **Owner-reviewed:** the four shaping decisions in §2 were taken 2026-09-06 (the
brainstorm that produced this spec).

**Implements:** the backlog's Track C item 2 — a tiny second fiscal module (the UK case) that forces
every chain / huella / `entorno` assumption through the `FiscalBackend` seam, a better pluggability
proof than TicketBAI. It follows SP-3c
([gated provisioning](2026-09-05-module-sp3c-gated-provisioning-design.md)), which left the
provisioning-time seats in place and **deferred the runtime-duty seat to this slice** (SP-3c §12).

**What SP-3 already built and this reuses unchanged:** the `fiscal` slot on the module contract
(`FiscalContribution`, `@waitron/fiscal`), the `provisioning` seat (`ModuleProvisioning`), the
`fiscalSlot` selector (`@waitron/module`) that refuses zero, two, or a node stamped for another
regime, and `ALL_MODULES` in `@waitron/composition`. This slice adds the SECOND module that fills the
slot and, in doing so, completes the seam SP-3c deferred.

---

## 1. Scope

Four pieces, in dependency order:

1. **The fiscal SLOT becomes a real choice.** Today exactly one module carries a `fiscal`
   contribution, so the slot is trivially unambiguous. Adding a second means a deployment must end up
   with exactly one ENABLED — a selection mechanism the default-on model does not provide today.
2. **`@waitron/fiscal-none`** — a no-regime module: `fiscal` seat (`id: "none"`, a backend that
   records nothing), a `provisioning` seat (no per-node seed — a no-regime node needs no fiscal
   identity), and a no-op runtime duty. It owns no domain tables.
3. **The runtime-duty seat (SP-3c §12).** `FiscalContribution` gains a `drain` method; the AEAT
   transport moves OUT of `apps/server` and INTO `@waitron/fiscal-verifactu`. `boot.ts` stops
   importing any regime package.
4. **The provisioning-input seat.** The wizard stops hardcoding "a live ES-common venue needs an AEAT
   certificate"; the resolved fiscal contribution answers whether it needs a provisioning secret and
   owns validating and sealing it. `apps/server/src/setup-api.ts` stops naming the cert shape and
   `aeat-credential.ts` moves behind the seat.

Plus the two CLAUDE.md §3 rules the backlog assigns to this slice, and emptying the
`DEFERRED_RUNTIME_PASS` allowlist in `scripts/module-seams.test.ts`.

**Out of scope:** country selection beyond adding one no-regime territory; a fiscal-none dashboard
card (SP-4); any change to the Spanish regime's SALE-PATH or filing BEHAVIOUR (the transport relocates
package, but verifactu still files identically — regression-guarded); wiring any host caller for
fiscal `reconcile` (it has none and is removed as dead surface — §7.4).

---

## 2. Owner decisions (2026-09-06)

1. **Selection: explicit slot + provisioning writes it.** The fiscal slot is a named exclusive slot;
   provisioning derives the fiscal module from the location's territory and writes `modules.json`
   enabling exactly that one. The provision-only gate changes from "no provision-only module disabled"
   to "the fiscal slot resolves to exactly one enabled member". (§3, §4, §5.)
2. **Runtime-duty seat: full.** Move `drain`, the AEAT SOAP/mTLS transport, and the wizard's cert gate
   all behind module-owned seats. `boot.ts` and `setup-api.ts` stop importing / hardcoding the regime;
   `DEFERRED_RUNTIME_PASS` goes to empty. (§7, §8.)
3. **Cert-required error: generic, renamed outright.** `setup.aeat_cert_required` becomes the generic
   `setup.provisioning_secret_required`. Nothing is in production (CLAUDE.md §3's no-BWC rule), so the
   old code is deleted, NOT deprecated with a sibling. (§9.)
4. **Both fiscal modules stay `provision-only` tier.** A node stamped `"none"` cannot later switch
   regime — `fiscalSlot`'s stamped-mismatch check blocks it — the safe default, consistent with
   `"verifactu"`. (§3.)

---

## 3. The fiscal slot and its selection

**The slot is the set of modules carrying a `fiscal` contribution** — `m.fiscal !== undefined`. After
this slice that set is `["fiscal-verifactu", "fiscal-none"]` (descriptor names; their contribution ids
are `"verifactu"` and `"none"`). `fiscalSlot(enabled, stamped)` already enforces the invariant at boot:
exactly one member of the ENABLED set fills the slot, and its id must match the node's stamped
`filing_module`.

**The Veri\*Factu descriptor is renamed `fiscal` → `fiscal-verifactu` (§3.1).** Adding a sibling
exposes that the descriptor named `"fiscal"` was really the name of the SLOT wrongly attached to one
member; the rename is a behaviour-preserving first slice (S1).

**Descriptor name vs contribution id.** These differ and both matter:

| descriptor `name` (modules.json key, manifest) | `fiscal.id` (`sales.fiscal_backend`, `nodes.filing_module`) |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `fiscal-verifactu`                              | `verifactu`                                                 |
| `fiscal-none`                                   | `none`                                                      |

`resolveFiscalModules(territory).filing` returns the **id**; `modules.json` is keyed by **name**. The
composition root (which already imports `ALL_MODULES`) maps id → descriptor:
`ALL_MODULES.find((m) => m.fiscal?.id === filing)`. `resolveFiscalModules` stays unchanged — it needs
no `module` field, and adding one would duplicate a fact the composition root can derive. (Considered
and rejected: extending `FiscalModules` with a `module` name; it puts the same fact in two places and
needs its own agreement guard.)

**The territory registry gains one no-regime territory.** `resolveFiscalModules`
(`packages/provisioning/src/fiscal-modules.ts`) adds a `GB-…` entry → `{ filing: "none", tax: "none" }`.
`tax` is recorded on `nodes.tax_module` and has no consumer today (traced: only stamped, never read),
so `"none"` is a placeholder, not a UK VAT decision. The territory string is country-prefixed
(`venue-plan.ts` requires `fiscalTerritory` start with `<country>-`), so a UK venue is `country: "GB"`,
`fiscalTerritory: "GB-…"`. The exact suffix is a naming detail settled in the plan.

**No Spanish-NIF footgun for `none`.** `venue-plan.ts` warns that `applyVenue` writes `tax_id` into
`registro_sif.nif`; `fiscal-none` registers no `registro_sif`, so that concern does not arise for a
no-regime node.

### 3.1 Rename `fiscal` → `fiscal-verifactu` (behaviour-preserving, S1)

Owner decision 2026-09-06: descriptor names match their package directories, so the slot's two members
read `["fiscal-verifactu", "fiscal-none"]`. Only the LOGICAL module name changes; two things
deliberately do NOT:

- **The contribution `id` stays `"verifactu"`.** It is stored in `nodes.filing_module` and every
  immutable `sales.fiscal_backend` — never renamed (CLAUDE.md §3), and already correct.
- **The migrations tracking table stays `__drizzle_migrations_fiscal`.** `MigrationSet.name` and
  `MigrationSet.table` are decoupled by design (core's name is `"core"`, its table
  `__drizzle_migrations_db`), so the name changes while the table does not — renaming a drizzle
  tracking table would orphan the dev DB's applied-migration record for no gain.

What changes: the `name` field in `packages/composition/src/modules.ts` and the `name` in
`migrations.manifest.json`; `composition.test.ts`'s name/slot pins; `MODULE_BY_TABLE`'s module-name
value; and any test that looks a module up by `name === "fiscal"`. The `english-only.ts` base-list
word `"fiscal"` is the Spanish/generic TERM, not the module name — it stays. No `requires` edge names
`"fiscal"` (nothing depends on it — verified), so the topological order is unaffected. Because a
rename retires every receipt about the old name (CLAUDE.md §1), S1 includes a base-to-tip sweep of
docs, READMEs and comments that call the module `"fiscal"`.

---

## 4. Provisioning writes `modules.json` (and is authoritative for the slot)

**Today nothing writes `modules.json` for a fresh primary.** It is written only at adopt (SP-1d,
`writeModuleConfig`); a fresh primary relies on the absent-file default (everything enabled). That is
safe with one fiscal module. **The moment a second fiscal module exists, default-on enables both**,
which fails boot as `module.fiscal_slot_ambiguous` and — worse — would make `planVenue` emit BOTH
fiscal seeds (verifactu's SIF mint plus none's). So provisioning MUST resolve the slot and persist it.

**Mechanism.** For the fiscal slot, the TERRITORY is authoritative, not any pre-existing
`modules.json`. The provision path:

1. resolves `filing = resolveFiscalModules(territory).filing` and maps it to its descriptor name;
2. starts from the operator's `ModuleConfig` (or empty) and sets the fiscal-slot overrides so exactly
   the selected fiscal module is enabled and every other fiscal-slot member is `false`;
3. uses THAT config for the provision-only gate (§5), `planVenue`, and `applyVenue`;
4. writes it to `<stateDir>/modules.json` via `writeModuleConfig`, so the trading boot reads a set
   whose slot already resolves.

**Both entry points do this:** the setup wizard (`apps/server/src/setup-api.ts` → `provision.ts`,
which has `stateDir`) and the CLI (`packages/provisioning/src/bin.ts`, the composition root). The
slot-resolution helper is generic (it iterates `m.fiscal?.id`, names no module) and lives where both
can reach it — candidate homes settled in the plan (`@waitron/module` beside `fiscalSlot`, taking the
selected id + the module list).

**Existing Spanish boxes.** A Spanish provision resolves `filing: "verifactu"` → enables `fiscal`,
disables `fiscal-none`, writes `modules.json`. `verifactu`'s behaviour is unchanged; the only new fact
on disk is a `modules.json` that was previously absent. Setup still migrates all modules
(SP-1b), so `fiscal-none`'s (empty) schema is migrated on a Spanish box and simply carries no rows.

---

## 5. The slot-aware provision-only gate

`disabledProvisionOnly(ALL_MODULES, config)` (`@waitron/module`) currently returns every disabled
`provision-only` module, and `provisionVenue` refuses if the list is non-empty. With two
`provision-only` fiscal modules, one is ALWAYS disabled, so this would always refuse. The gate splits
into two independent checks:

1. **Non-slot provision-only modules must stay enabled.** A `provision-only` module WITHOUT a `fiscal`
   contribution that is disabled still refuses (it mints unrecoverable state and has no alternative).
   None exist today, so this is empty — but it is the real reason the tier exists, kept explicit.
2. **The fiscal slot must resolve.** Reuse `fiscalSlot(enabledModules(ALL_MODULES, config), null)`:
   it throws `fiscal_slot_empty` (both fiscal modules disabled) or `fiscal_slot_ambiguous` (both
   enabled) and is a no-op when exactly one is enabled. `stamped = null` here — provisioning has not
   minted a node yet.

Implementation: `disabledProvisionOnly` narrows to "provision-only modules with no `fiscal`
contribution that are disabled"; the fiscal-slot resolution is a separate `fiscalSlot` call in
`provisionVenue` (or a small `assertFiscalSlot` wrapper). Generic — names no module, reads the tier
and the `fiscal` seat. The `module.provision_only_disabled` code stays for case 1.

---

## 6. The `@waitron/fiscal-none` package

**Structure**, mirroring `@waitron/fiscal-verifactu` at a fraction of the size:

- `src/index.ts` — the barrel, exporting the seats the composition root wires:
  `FISCAL_NONE_SLOT`, `FISCAL_NONE_PROVISIONING` (if any — see below), and its migration constant.
- `src/slot.ts` — `FISCAL_NONE_SLOT: FiscalContribution` (`id: "none"`, `makeBackend`, `drain`).
- `src/backend.ts` — `NoneBackend implements FiscalBackend` (§6.1).
- `src/drizzle/` — an EMPTY migration set (§6.2).
- test files colocated.

**`ALL_MODULES` gains a `fiscal-none` descriptor**, listed LAST (after `fiscal-verifactu`), `tier:
"provision-only"`, `requires: { core: "*" }` (it enrols nothing and depends on no other module). The
migration manifest gains the matching entry last (`{ name: "fiscal-none", table:
"__drizzle_migrations_fiscal_none", from: "../fiscal-none/drizzle" }`), so
`orderedMigrationSets(ALL_MODULES)` still equals `manifestSets()` byte-for-byte (Kahn's input-order
tie-break emits a core-only dependant last when it is listed last — verified by the composition pin).
`composition.test.ts`'s "exactly one module fills the fiscal slot" assertion changes to expect
`["fiscal-verifactu", "fiscal-none"]`.

### 6.1 The no-regime backend

Every `FiscalBackend` method has a defined empty answer already documented on the interface
(`@waitron/fiscal`'s `backend.ts`), so `NoneBackend` is the interface's own "nothing to do" shape made
concrete:

| method                                                    | behaviour                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `registerNode`                                            | returns `{ backend: "none", nodeId, registrationId: "", registeredAt }`; no write |
| `recordSale` / `recordVoid` / `recordCorrection` / `recordSubstitution` | writes NOTHING; returns a `FiscalRecordRef` `{ backend: "none", recordId: <saleId or a derived stable string>, state: "recorded", issuedAt, offsetMinutes, verificationUrl: undefined }` |
| `filedReceiptFor`                                         | `undefined` (no filed record to reprint; caller keeps its fallback)             |
| `checkIntegrity`                                          | `{ ok: true, checked: 0, issues: [] }`                                          |
| `pendingCount`                                            | `0`                                                                             |

The runtime pass (`drain`) is NOT a backend method — it moves to the contribution seat (§7), so
`NoneBackend` does not implement it. `state: "recorded"` is the regime-neutral meaning "the
legally-required record exists locally" — for a
no-regime venue that is vacuously true the moment the sale is written, which is what lets the generic
sale path treat a `none` sale exactly like a `verifactu` one with no branch. The `recordId` is opaque
to the POS (interface contract); a stable derived value keeps a replay idempotent without inventing a
table. No transaction work happens in the write methods, but they still TAKE the `tx` (interface
shape) — a no-op that keeps the seam identical.

**The key property the proof rests on:** with `fiscal-none` enabled, a sale writes its core `sales`
row (core's concern, not fiscal) with `fiscal_backend = "none"`, and **no `registros_facturacion`,
`registro_sif`, `cadenas`, `envios` or chain row is ever written**. Proven by inspection in a real-PG
test after a sale/correction/void/substitution.

### 6.2 Provisioning seat and migrations

**Provisioning seat.** A no-regime node needs no fiscal identity, so `fiscal-none`'s
`provisioning.seed` is almost certainly ABSENT (the module contributes no `seed-module` action, and
`planVenue` emits none for it). **Open (plan probe):** whether `fiscal-none` needs a `standby` seat.
`StandbyProvisioning` reserves the standby's disjoint invoice series; a no-regime venue still SELLS and
so still needs invoice series, which core's `invoice_series` owns and the standby carrier expects a
module to derive disjoint. The plan resolves whether that duty belongs to `fiscal-none` or to a generic
default; the sale path does not reach it, so it is not on the go-live-critical path for the proof.

**Migrations.** `fiscal-none` owns no tables, but the contract requires a `migrations` set and the
composition pin requires a manifest entry. The plan's FIRST task is a PROBE: does an empty drizzle set
(a `meta/_journal.json` with no entries, no SQL files) run clean through `runMigrations` and satisfy
`manifestSets()`? Expected yes (the migrator is a no-op with zero migrations; `manifestSets` reads the
manifest, not the dir). **Fallback if not:** relax `WaitronModule.migrations` to optional for a
slot-only module — a change to SP-1a's owner-reviewed contract, so taken only if the probe forces it,
and flagged for owner review if so.

---

## 7. The runtime-duty seat (empties `boot.ts` of the regime)

Today `boot.ts` imports `drain` from `@waitron/fiscal-verifactu` (line 25) and builds the AEAT
transport inline via `aeat-transport.ts` (which imports `@waitron/verifactu`). Both are the only
`apps/server` regime imports left, allowlisted in `DEFERRED_RUNTIME_PASS`.

### 7.1 The seat

`FiscalContribution` (`@waitron/fiscal`) gains:

```ts
interface FiscalContribution {
  readonly id: string;
  makeBackend(deps: FiscalBackendDeps): FiscalBackend;
  /** The runtime submission pass. Host injects generic deps; the module owns its transport. A
   * regime with nothing to submit (id "none") returns the empty DrainResult. */
  drain(deps: FiscalDutyDeps, now: Date): Promise<DrainResult>;
}

interface FiscalDutyDeps {
  readonly db: Database;
  readonly ring: KeyRing;            // @waitron/credentials — generic infra, type-only import
  readonly environment: DeploymentEnvironment;
  readonly skipRetryMs: number;
  readonly log?: FiscalDutyLog;      // a minimal generic log callback, defined in @waitron/fiscal
}
```

`@waitron/fiscal` gaining a type-only dependency on `@waitron/credentials` (`KeyRing`) is acceptable —
credentials is generic infra, not a regime package, and `@waitron/fiscal` already type-depends on
`@waitron/db`. The `log` shape is a small generic callback so the module need not import
`apps/server`'s `Logger`.

**Why the seat, not `FiscalBackend.drain`.** The sale-path backend is built by `makeBackend(deps)`
with `deps = { db, clock, environment }` — no `ring`, no transport, deliberately (a sale must never
build an AEAT client). The runtime pass NEEDS the ring to decrypt the tenant certificate, which is
exactly why `boot.ts` bypasses `FiscalBackend.drain` today and builds its own resolver. Putting the
duty on the CONTRIBUTION (which the host calls with the heavier `FiscalDutyDeps`) is what lets the
sale-path backend stay transport-free. So `FiscalBackend.drain` loses its last rationale and is
**removed** in this slice (its only would-be caller now goes through the seat, and it was already
uncalled). `VerifactuBackend` drops its delegating `drain`; the package's standalone
`drain(DrainDeps, now)` function stays and is what `FISCAL_SLOT.drain` calls.

### 7.2 Verifactu's `drain` and the transport relocation

`FISCAL_SLOT.drain` (in `@waitron/fiscal-verifactu`) builds the AEAT client resolver internally and
calls the package's existing `drain(DrainDeps, now)`. To make that possible without `apps/server`
importing the regime, **`apps/server/src/aeat-transport.ts` moves into `@waitron/fiscal-verifactu`**
(e.g. `src/aeat-transport.ts`). Its dependencies resolve there:

- `@waitron/verifactu` (`createClient`, `SOAP_ENDPOINTS`, `SOAP_ENDPOINTS_SELLO`) — the regime already
  depends on it.
- `@waitron/credentials` (`KeyRing`, `getCredential`) — a new (generic) dependency of the regime; the
  `readCredential` helper (`withTenant` + `getCredential`) is generic and is reinlined here.
- `DeploymentEnvironment` — from `@waitron/db` (as `FiscalBackendDeps` already uses).
- the per-transport close-failure logging — via the generic `log` callback, not `apps/server`'s
  `codeOf`/`Logger` (a small helper for the error code, or the log payload carries the raw message).

`boot.ts`'s drain pass then becomes: `enabledFiscal.drain({ db, ring, environment, skipRetryMs, log },
at)` where `enabledFiscal = fiscalSlot(setsToMigrate, filingModule)`. The per-pass transport lifetime
(`closeAll` in `finally`) moves inside the module's `drain`, which is where it belongs — the module
built the transports.

### 7.3 `fiscal-none`'s `drain`

Returns the empty `DrainResult` immediately; builds no transport, reads no credential.

### 7.4 `FiscalBackend.reconcile`

Has NO production caller today (`boot.ts`'s `reconcile` pass is the payments/scheduler settlement
duty, unrelated) and gains none here. Since this slice already edits the `FiscalBackend` interface to
remove `drain`, `reconcile`'s orphan status makes it dead surface — exactly what `backend.ts`'s own
header warns against ("an interface method with no caller and no meaningful fake is dead surface")
— so it is **removed in the same edit**. The plan first greps `ReconcileResult` / `ReconcileMismatch`
/ `AckState` usage: any of those types still used by verifactu's internal `drain` stays as a type;
only the interface METHOD and any now-unused type are removed. This removal is a judgement the owner
can veto at spec review; if kept, it stays dormant and empty-shaped on both backends. No runtime seat
for reconcile is added either way.

### 7.5 Result

`boot.ts` imports no regime package. `DEFERRED_RUNTIME_PASS`'s `boot.ts` and `aeat-transport.ts`
entries are removed.

---

## 8. The provisioning-input seat (empties `setup-api.ts` of the cert hardcode)

`setup-api.ts` hardcodes `certExpected = mode === "live" && fiscalTerritory === "ES-common"`, parses
the cert, and seals it (`aeat-credential.ts`'s `sealAeatCredential`). None of these import a regime
package (so the seams guard does not flag `setup-api.ts` today), but the OWNER wants the generic wizard
to stop knowing the regime's provisioning input.

### 8.1 The seat

The resolved fiscal contribution answers whether it needs a provisioning secret for this environment
and owns validating + sealing the opaque blob:

```ts
interface FiscalContribution {
  // …
  /** Present when the regime needs a provisioning-time secret. Absent = the regime needs none
   * (fiscal-none). The wizard passes the opaque blob through; the module validates and seals it. */
  readonly provisioningSecret?: {
    /** Whether this environment requires the secret (verifactu: production only). */
    required(environment: DeploymentEnvironment): boolean;
    /** Validate + seal the blob into the module's own vault purpose, inside a tenant scope. Throws
     * setup.request_invalid (naming the field, never the value) on a malformed blob. */
    seal(deps: { db: Database; ring: KeyRing }, tenantId: TenantId, raw: unknown): Promise<void>;
  };
}
```

Territory drops out of the condition: the territory already selected the module, so
`verifactu.provisioningSecret.required(production) === true` subsumes the old `ES-common` half.

**2026-09-07 (as built):** the seat gained a third member, `validate(raw): void`, beside `required`
and `seal`. `validate` runs PRE-mint (before `provisionVenue` mints the unrepairable SIF/hash chain,
CLAUDE.md §5) and refuses a malformed blob with nothing written; `seal` runs post-mint inside the
tenant transaction and re-validates as defense-in-depth. See `packages/fiscal/src/contribution.ts`.

### 8.2 The wizard

`setup-api.ts` resolves the fiscal contribution for the territory, then:

- `expected = contribution.provisioningSecret?.required(environment) ?? false`;
- `expected && !present` → `setup.provisioning_secret_required` (§9);
- `!expected && present` → `setup.request_invalid` naming the input field;
- after `provision` mints the tenant, `contribution.provisioningSecret?.seal({ db, ring }, tenantId,
  raw)`.

The blob (`body.aeatCert` today; a generic `body.provisioningSecret` field) is opaque to the wizard —
it never names `pfxBase64`/`passphrase`/`certKind`. `aeat-credential.ts`'s validation and sealing move
into `@waitron/fiscal-verifactu` behind `FISCAL_SLOT.provisioningSecret.seal`. `fiscal-none` declares
no `provisioningSecret`, so a UK provision needs no secret and rejects one if sent.

### 8.3 Cert kinds and the vault purpose

`CertKind`, `certMaterialFrom`, `readCertMaterial`, the `fiscal.aeat` purpose — all regime-owned —
move with the transport (§7.2) and the sealing (§8.2) into `@waitron/fiscal-verifactu`. The
`@waitron/credentials` `PURPOSES` registry entry for `fiscal.aeat` is the one shared touch-point;
whether that stays generic or the purpose becomes module-declared is a plan detail (leaning: leave the
purpose string in `credentials`, as it is a vault-schema fact, not regime logic).

---

## 9. Error-code changes

- **Rename** `setup.aeat_cert_required` → `setup.provisioning_secret_required` (generic; params name
  the module, not the cert). Delete the old code — nothing is in production (owner decision §2.3;
  CLAUDE.md §3's no-BWC rule). Grep every consumer (the 2c setup client, tests) and update.
- **Keep** `setup.request_invalid` (already generic; the module throws it, naming the offending field).
- The regime-owned codes that move packages (`server.credential_unusable`,
  `fiscal.environment_mismatch`, etc.) keep their strings — moving a file does not rename a code — and
  their registries move with them. `errors-reachable.test.ts` re-derives the import graph, so a code's
  new home is fine as long as it stays reachable from its package barrel.

---

## 10. Guards and CLAUDE.md rules

- **`scripts/module-seams.test.ts`:** empty `DEFERRED_RUNTIME_PASS`. The "no `apps/server` file
  imports a regime package" assertion then holds with no allowlist, and the "allowlist names only
  files that still import the regime" meta-check passes vacuously over an empty map (adjust it to
  assert emptiness, or keep it — an empty map iterates zero times). Extend "every filing value names
  an enabled fiscal contribution" to cover both `verifactu` and `none` (it already iterates
  `FISCAL_TERRITORIES`, so adding the `GB-…` territory extends it automatically).
- **`composition.test.ts`:** update the fiscal-slot listing to `["fiscal-verifactu", "fiscal-none"]`
  and the name pins for the rename (§3.1); the manifest-equality pins hold once the manifest gains the
  `fiscal-none` entry.
- **CLAUDE.md §3 — two new rules** (the backlog assigns them here):
  1. **New product domains land as modules.** A new domain (a bookings system, a loyalty scheme) is a
     module package filling contract seats, never new code trapped in the core.
  2. **No new table enters the core migration set without a stated reason.** A `tenant_id`-bearing
     domain table belongs to a module's own migration set; a core-set addition needs the reason in the
     commit.
- **`english-only.ts`:** `fiscal-none` is a new package. It contains no Spanish (its whole point is the
  no-regime case), so it needs NO vocabulary seat and is scanned as a generic package like any other —
  confirm it is not accidentally added to `GENERIC_PACKAGES` exemptions and that the guard passes.

---

## 11. Testing and the proofs

TDD throughout; failing test first. The proofs, by layer:

1. **`fiscal-none` unit** (`packages/fiscal-none`): each `NoneBackend` method returns its empty shape;
   `FISCAL_NONE_SLOT.drain` returns the empty `DrainResult`. PGlite is enough — no privilege/RLS
   concern in the no-op backend itself.
2. **The slot + gate** (`@waitron/module`, `apps/server`): `fiscalSlot` picks the enabled member and
   refuses zero/two/mismatch (extend existing tests for the two-candidate case); the slot-aware
   provision-only gate accepts exactly-one-enabled and refuses both-disabled / both-enabled.
3. **The no-fiscal-write proof (real-PG, proven by deletion)** — the one that matters. A GB-configured
   box (fiscal-none enabled, verifactu disabled) provisions, then a sale / correction / void /
   substitution writes its `sales` row with `fiscal_backend = "none"` and **zero** rows in
   `registros_facturacion` / `registro_sif` / `cadenas` / `envios`. Delete the "records nothing"
   behaviour and the row-count assertion must fail.
4. **Spanish regression (real-PG):** an ES-common box still mints the SIF and files exactly as before —
   the sale-path and drain behaviour of `verifactu` is unchanged after the transport relocation. Reuse
   the existing verifactu e2e suites; they must stay green with the transport in its new home.
5. **`boot.ts` drain via the seat:** the verifactu drain pass still submits (existing boot/drain
   real-PG suites green after the seat indirection); a fiscal-none boot's drain pass is a no-op that
   contacts nothing.
6. **The wizard input seat:** a live GB provision needs no secret; a live ES-common provision still
   requires the cert (now via the seat) and rejects a malformed one with `setup.request_invalid`
   naming the field; a demo/preproduction provision rejects a present secret.
7. **Guards:** `module-seams` passes with an empty allowlist; `composition` pins hold; `english-only`
   passes for the new package; `errors-reachable` passes with the relocated codes.

Real-PG (Testcontainers) for anything touching the deployment role, RLS, or the vault; PGlite for the
pure backend and pure planner logic (CLAUDE.md §4). Whole-workspace `pnpm test` before the PR, and the
browser-package caution (CLAUDE.md §2) applies to any UI-touching change (none expected).

---

## 12. Open questions / plan probes

1. **Empty migration set** (§6.2) — probe first; fallback is a contract relaxation flagged to the owner.
2. **`fiscal-none` standby seat** (§6.2) — does disjoint-series derivation for a no-regime standby
   belong to `fiscal-none` or a generic default? Not on the sale path; resolved in the plan.
3. **`fiscal.aeat` vault purpose home** (§8.3) — leave the purpose string in `@waitron/credentials`
   (leaning yes; it is a vault-schema fact).
4. **Slot-resolution helper home** (§4) — `@waitron/module` beside `fiscalSlot` is the leaning.

None blocks the design; each is a bounded implementation choice.

---

## 13. Interactions with other tracks

- **Track A (data layer)** owns `packages/*/drizzle`, tenancy, RLS. `fiscal-none` adds an EMPTY
  migration set — no table, no RLS, no `*.rls.test.ts` — so it does not collide with A3's squash
  (which regenerates baselines). If A3 lands first, `fiscal-none`'s (empty) baseline regenerates
  trivially per CLAUDE.md §3's recipe. No new CORE table (the module rule this slice writes into §3).
- **Track B (failover)** owns `boot.ts`'s role/promote wiring. This slice edits `boot.ts`'s FISCAL
  DRAIN wiring only (the seat indirection), a different region from B6's worker-lifecycle refactor;
  whoever lands second takes a textual rebase.
- **Track C** is this track. SP-3 (fiscal as a module) is complete; `fiscal-none` completes the
  swappability proof and the runtime-duty seat SP-3c deferred. It unblocks nothing else directly, but
  it is the first evidence that the fiscal slot is genuinely swappable (the backlog's stated purpose).

---

## 14. Slices for the plan

Sequenced so each lands green on its own; the plan may merge adjacent ones:

- **S0 — the empty-migration probe** (§6.2). Resolve the feasibility question before building the
  package around it.
- **S1 — rename `fiscal` → `fiscal-verifactu`** (§3.1). Behaviour-preserving: the descriptor/manifest
  name, `composition.test.ts` pins, `MODULE_BY_TABLE`, name-lookup tests, and the base-to-tip doc/
  comment sweep. Contribution id and migration table unchanged. Provable green before anything else.
- **S2 — the runtime-duty seat + transport relocation** (§7). `FiscalContribution.drain`, remove
  `FiscalBackend.drain`/`reconcile`, move `aeat-transport.ts` into `@waitron/fiscal-verifactu`, rewire
  `boot.ts`, empty the `boot.ts` / `aeat-transport.ts` allowlist entries. Behaviour-preserving for
  verifactu; provable green before `fiscal-none` exists.
- **S3 — the provisioning-input seat** (§8, §9). Move the cert gate/validation/sealing behind
  `provisioningSecret`, rename the error code, `setup-api.ts` stops naming the cert.
- **S4 — the `fiscal-none` package** (§6). The no-regime backend + slot + drain + provisioning seat +
  descriptor + manifest entry; `composition.test.ts` update.
- **S5 — slot selection + slot-aware gate + territory** (§3, §4, §5). Provisioning writes
  `modules.json`, the gate splits, the `GB-…` territory, the no-fiscal-write real-PG proof.
- **S6 — guards + CLAUDE.md rules + whole-workspace green** (§10). Confirm the now-empty
  `DEFERRED_RUNTIME_PASS` (emptied in S2), extend the seams territory/slot check, the two §3 rules,
  final gate.

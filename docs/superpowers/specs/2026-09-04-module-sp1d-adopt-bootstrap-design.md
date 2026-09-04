# SP-1d — Module-set adopt bootstrap

**Date:** 2026-09-04
**Status:** design. **Owner-reviewed:** scope decided 2026-09-04 (the brainstorm that produced this
spec) — **build the adopt bootstrap now; defer ongoing flow-down** with a receipt.

**Implements:** [module-system-architecture §6 / §8 SP-1](2026-09-04-module-system-architecture-design.md)
and the [SP-1b deferred follow-up (b)](2026-09-04-module-sp1b-enablement-and-reconcile.md#5-soft-disable-in-sp-1b-bounded)
— the fourth slice of SP-1. SP-1b reads an on-box `modules.json` on **each node independently** and
flagged that a mirror, having no such file, defaults to all-enabled and so can diverge from its
primary. SP-1d closes that: a mirror **inherits the primary's module set at adopt**, carried on the
existing mirror-bundle handshake, written to the mirror's own `modules.json` before it first enters
trading mode.

**Decides (the owner fork from the brainstorm):**

- **Adopt bootstrap now; ongoing flow-down deferred.** The mirror learns the primary's enabled set
  **once, at adopt**. Ongoing enable/disable propagation (architecture §6's "flows down from the
  primary through the existing config channel") is **not built here** — see §6 for the two receipts
  (no channel exists; nothing is disableable today).

It is **behaviour-preserving** under the default (no module disabled anywhere): the bundle carries an
empty override map, the mirror writes `{ "modules": {} }`, and its enabled set is all-enabled — exactly
today's mirror behaviour, now written down explicitly.

---

## 1. What this actually fixes — stated honestly (no wedge on a fresh mirror)

It is tempting to say "the mirror must migrate the primary's set or its sync applies wedge on a table
it lacks." **On a fresh mirror that is false, and the spec must not claim it.** The sequence, grounded:

1. A fresh mirror box has no `trading.env`, so its first boot is **setup mode**
   (`apps/server/src/boot.ts:528`, `config.till === undefined`).
2. Setup mode migrates **ALL** sets, not the enabled subset —
   `config.till === undefined ? ALL_MODULES : enabledModules(ALL_MODULES, moduleConfig)`
   (`apps/server/src/boot.ts:542-543`; the SP-1b §4 "setup-migrates-all" invariant). So **every**
   module's tables exist on the mirror before adopt runs.
3. The operator runs adopt (`POST /setup-api/adopt` → `adoptFromPrimary`), which persists `trading.env`
   and restarts. The **second** boot is trading/mirror mode, where the migration filter applies — but
   every set is already migrated, so a filtered migrate is a no-op for the enabled ones and simply
   does not **re-run** a disabled one that is already present. No table is ever missing.

So the bootstrap does **not** prevent a fresh-mirror migration wedge — setup already migrated
everything. **What it fixes is that the mirror's *enabled set* equals the primary's**, which matters
for the consumers of that set, not for table existence:

- **Honest reconcile drift.** Boot's reconcile (`boot.ts:574-579`, SP-1b §3) compares enabled vs.
  migrated and logs `module.reconcile`. Without the bootstrap a mirror defaults to all-enabled, so a
  module the primary has **soft-disabled** reads on the mirror as `steady` (enabled+migrated) — the
  mirror's operational log disagrees with the primary's about what is on. With the bootstrap it reads
  as `softDisabled`, matching the primary.
- **The set's real consumer arrives in SP-2.** SP-2's schema-version handshake has the subscriber
  **pull only the modules in its own enabled set** (architecture §6). For that to be correct the
  mirror's enabled set must be the primary's — which is what this slice establishes. SP-1d makes the
  set right **now**; SP-2 is the first slice to depend on it. Building it now (rather than folding it
  into SP-2) keeps the adopt-handshake change with the other adopt work and lands the SP-1b-flagged
  gap on its own reviewable slice.

Recording this honestly is the point: the bootstrap is a correctness **seam** whose principal consumer
is one slice away, plus a drift-log honesty fix today — **not** a fix for a wedge that
setup-migrates-all already prevents.

## 2. The seams this touches (grounded)

- **Mirror bundle (mint).** `assembleMirrorBundle` (`apps/server/src/mirror-bundle.ts:105-188`) builds
  the `MirrorBundle` on the primary when the mirror calls `POST /management-api/mirror-bundle`
  (`apps/server/src/mirror-bundle-api.ts`). It already reads on-box state — `boxCaPem` is
  `readFile(caCertPath(stateDir))` (`mirror-bundle.ts:171`) — so `stateDir` is already in its deps and
  it can read the primary's own `modules.json` at mint time with no new plumbing.
- **Mirror bundle (fetch).** `fetchMirrorBundle` (`apps/server/src/mirror-bundle-fetch.ts:38-78`) POSTs
  the standby's credential + nodeId/publicKey and parses the JSON bundle. A new typed field flows
  through with no logic change.
- **Adopt orchestration.** `adoptFromPrimary` (`apps/server/src/adopt.ts:84-153`) already reads the
  primary's designated node row off the bundle and copies its `filingModule`/`taxModule` down
  (`adopt.ts:108-119`) — the existing precedent for module-ish config riding the adopt bundle. SP-1d
  adds one more step: parse-and-persist the enabled-set overrides.
- **On-box config file.** `<stateDir>/modules.json`, read by `readModuleConfig(stateDir)`
  (`apps/server/src/module-config.ts:13-30`), sibling to `trading.env`/`secrets.env`. It has a
  **reader but no writer** today (grep-verified: nothing writes it). SP-1d adds the writer.
- **Pure config primitives.** `@waitron/module`'s `parseModuleConfig` / `isEnabled` /
  `enabledModules` (`packages/module/src/config.ts`). SP-1d adds `serializeModuleConfig`, the pure
  inverse of `parseModuleConfig`.

## 3. The bundle field and the data flow

**Bundle field.** Add to `MirrorBundle` (`mirror-bundle.ts:63-72`):

```ts
/** The primary's enabled-module set as a sparse override map (SP-1b's modules.json inner map),
 * read fresh at mint time. `{}` when nothing is disabled (default-on). The mirror re-validates it
 * against its own ALL_MODULES and writes its own modules.json from it (SP-1d). */
moduleOverrides: Record<string, boolean>;
```

It carries the **inner override map** (`{ "fiscal": false }`, or `{}`), not the `{ modules: … }`
file envelope — the envelope is the on-box file's shape, reconstructed on the mirror. A plain object
(not the `ReadonlyMap` of `ModuleConfig`) because the bundle is JSON over HTTP.

**Mint (primary).** `assembleMirrorBundle` calls `readModuleConfig(deps.stateDir)` and
`serializeModuleConfig(config)` → `moduleOverrides`. Read **fresh at mint**, not from boot: the
operator may have edited `modules.json` since the primary booted, and the mint should reflect the
current file (the primary applies that edit on its own next reboot; the mirror applies it on its first
boot — a benign, self-correcting skew, both reboot). `readModuleConfig` already throws the classified
`module.config_*` codes on a malformed primary file, so a mint over a broken file fails loud rather
than shipping garbage.

**Fetch (mirror).** Unchanged beyond the type: `fetchMirrorBundle` returns the bundle with the new
field.

**Adopt (mirror).** In `adoptFromPrimary`, **before** `persistTrading` (grouping the on-box files the
next boot reads), re-validate and persist:

```ts
// Bootstrap the mirror's own modules.json from the primary's set (SP-1d). Re-validate against THIS
// node's ALL_MODULES — fail-closed: an unknown or malformed override refuses adopt rather than
// writing an unparseable file. In the monorepo build both nodes share ALL_MODULES so this cannot
// fire; it is the defense the file being external input demands (CLAUDE.md §3, "validate rather
// than trust").
const moduleConfig = parseModuleConfig({ modules: bundle.moduleOverrides }, ALL_MODULES);
await deps.persistModuleConfig(moduleConfig);
```

> **Refined in implementation (2026-09-05, finish-branch review — the code is the source of truth;
> this block records the design as written).** Adopt uses a bare-map entry point,
> `parseModuleOverrides(bundle.moduleOverrides, ALL_MODULES)` — added during the simplify pass so a
> non-file caller validates the override map without fabricating a `{ modules: … }` envelope (and it
> makes `serializeModuleConfig`'s inverse literal). It also runs **immediately after `fetchBundle`,
> before any DB write** (fail fast, so a bad bundle never half-adopts the mirror — Copilot + whole-branch
> review), holding the validated `ModuleConfig` to persist just before `persistTrading`.

`parseModuleOverrides` + `ALL_MODULES` are imported directly into `adopt.ts` (both are static/pure — no
new injected dep, and adopt already imports app-local statics). The **fs write** is injected as
`persistModuleConfig`, mirroring `persistTrading`, so the orchestration stays testable against a
hand-built bundle.

**Written unconditionally, even when `{}`.** Every adopted mirror gets an explicit `modules.json`
(`{ "modules": {} }` in the default case). This is a small behaviour change — mirrors had no such file
before — chosen for explicitness (the mirror's set is visibly the primary's) and idempotence (a
re-adopt overwrites in place, matching the rest of `adoptFromPrimary`'s idempotent re-run,
`adopt.ts:80-83`). An empty file and an absent file are semantically identical to `readModuleConfig`
(both → all-enabled), so this changes no enabled set.

## 4. The two new functions

**`serializeModuleConfig` (pure, `@waitron/module`).** The inverse of `parseModuleConfig`:

```ts
/** Serialize a ModuleConfig back to the sparse override object (the modules.json inner map).
 * The inverse of parseModuleConfig: parseModuleConfig({ modules: serializeModuleConfig(c) }, M)
 * yields the same enabled set as c for every module in M. */
export function serializeModuleConfig(config: ModuleConfig): Record<string, boolean> {
  return Object.fromEntries(config.overrides);
}
```

Generic — no module name, no domain vocabulary; `@waitron/module` stays a scanned English package.

**`writeModuleConfig` (`apps/server/src/module-config.ts`).** Symmetric with `readModuleConfig`:

```ts
/** Write <stateDir>/modules.json from a validated ModuleConfig (SP-1d adopt bootstrap). Atomic,
 * mode 0600 to match the state-dir siblings (trading.env/secrets.env). The inverse write of
 * readModuleConfig — it serializes the override map back into the { modules: … } file envelope. */
export async function writeModuleConfig(stateDir: string, config: ModuleConfig): Promise<string> {
  const body = JSON.stringify({ modules: serializeModuleConfig(config) }, null, 2) + "\n";
  return writeFileAtomic(join(stateDir, "modules.json"), body, 0o600);
}
```

Uses the existing `writeFileAtomic` (`apps/server/src/fs-atomic.ts:19`, remove-tmp → write → rename,
mode required) exactly as `writeTradingEnv` does. `modules.json` holds no secret (module names), but
0600 matches its siblings and avoids a surprising mode difference in one directory.

**Boot binding.** `persistTrading` is bound at `boot.ts:682-683`
(`writeTradingEnv(config.stateDir, …)`) and passed into both setup verbs (provision `:720`, adopt
`:733`). Bind `persistModuleConfig: (c) => writeModuleConfig(config.stateDir, c)` beside it and pass it
into the **adopt** closure only — a fresh primary's provisioning does not bootstrap a module set from
anywhere, so only adopt needs it.

## 5. Testing

- **`serializeModuleConfig` (pure, `@waitron/module`).** Round-trips `parseModuleConfig`:
  `parseModuleConfig({ modules: serializeModuleConfig(c) }, ALL_MODULES)` yields the same
  `isEnabled(_, name)` for every module, over a config that **disables one** and leaves the rest
  default (so the two directions visibly differ — CLAUDE.md §1, a fixture where both answers do not
  look alike). Empty config → `{}`.
- **`writeModuleConfig` ↔ `readModuleConfig` (temp dir).** Write a config disabling a toggleable
  module, read it back, assert the same enabled set; write an empty config, read back all-enabled;
  assert the file is `<stateDir>/modules.json` at mode 0600. Order-independent (own temp dir per
  test).
- **`assembleMirrorBundle` carries the on-box overrides (real-PG, extends the mirror-bundle suite).**
  With a `modules.json` disabling a **toggleable fixture** module in the primary's stateDir, the bundle
  carries `moduleOverrides` with that entry; with no file, `moduleOverrides === {}`. Prove-by-deletion
  of the mint-side read → the bundle carries `{}` when the file disables a module → the assertion
  fails.
- **`adoptFromPrimary` parses + persists (adopt suite, hand-built bundle).**
  - A bundle with `moduleOverrides: { <toggleable>: false }` → `deps.persistModuleConfig` receives a
    `ModuleConfig` whose enabled set excludes that module. **Prove-by-deletion** of the
    parse-and-persist step → `persistModuleConfig` is never called → the "mirror inherited the set"
    assertion fails.
  - A bundle with an **unknown** module name in `moduleOverrides` → `adoptFromPrimary` **throws**
    (`module.config_unknown`) and never reaches `persistTrading` (fail-closed). Prove-by-deletion of
    the re-validation (persist the raw object without parsing) → the unknown-module case reaches
    `persistModuleConfig` instead of throwing → the "refused, nothing persisted" assertion fails.
- **Adopt e2e (`apps/server/src/adopt-e2e.rls.test.ts`, extend).** After a full adopt against a primary
  whose `modules.json` disables a toggleable fixture, the mirror's `<stateDir>/modules.json` exists and
  reads back to the same enabled set as the primary's. The default case (primary all-enabled) writes
  `{ "modules": {} }`.
- **Guards run whole-package, unfiltered** (CLAUDE.md §2/§4). After touching `adopt.ts`/`boot.ts`:
  `pnpm --filter @waitron/server test:coverage` and `pnpm --filter @waitron/module test:coverage`.
  No schema table is added, so the fiscal `inmutabilidad` scan is unaffected, but adopt sits near the
  fiscal identity path — run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` to confirm
  nothing about the chain moved. Run `pnpm vitest run scripts/english-only.test.ts` and
  `scripts/errors-reachable.test.ts` green (no new Spanish, no new error code).

## 6. Deferred: ongoing flow-down (two receipts)

Architecture §6 wants ongoing enable/disable to "flow down from the primary through the existing config
channel into each peer's on-box file." SP-1d builds the adopt bootstrap and **defers the ongoing
channel**, on two grounded receipts:

1. **There is no existing config channel to ride.** The only replication channel is `@waitron/sync`,
   which carries **tenant-scoped, RLS'd rows** (`packages/sync/src/registry.ts`, the `ENROLLED` set).
   `deployment` and `mirror_config` are whole-DB singletons with **no `tenant_id` and no RLS**
   (`packages/db/src/schema/mirror-config.ts`), so they physically cannot ride that lane; and
   `modules.json` is an **on-box file**, not a DB row at all (SP-1b decision 3, deliberately). The
   primary→mirror config handoff that exists is the **one-shot** mirror-bundle at adopt — there is no
   poll loop and no re-fetch (`mirror-bundle-fetch.ts` is called once, in the adopt path). So "flows
   down through the existing config channel" describes a channel that does not exist for box config;
   building ongoing flow-down means building a **new** push/poll, or moving the desired set into a
   replicated tenant table (reversing SP-1b's on-box-file decision). Either is disproportionate to a
   need that does not exist yet (receipt 2).

2. **Nothing is disableable today, so there is nothing to flow.** SP-1b decision 2: the practical
   toggleable set is **empty** — the eight non-fiscal modules are effectively core (never disabled),
   and fiscal is `provision-only` and always-on (provisioning is **refused** when fiscal is disabled,
   SP-1b §4, so a fiscal-disabled venue cannot provision, let alone adopt a mirror). So in the Spain
   exemplar no override is ever set: the bootstrap carries `{}`, and an ongoing channel would carry
   nothing. The one case ongoing flow-down is actually needed for — a primary **re-enabling** a module
   the mirror had inherited as disabled, which without propagation could later wedge the mirror's pull
   — is unreachable until a genuinely-toggleable module exists.

**When to build it.** The ongoing channel is built alongside the first genuinely-toggleable module
(SP-2's wiring inversion makes a module safely disableable; SP-4 the same for UI). At that point the
natural design — decide then, not now — is either enrolling a **tenant-scoped** module-config table
into the existing sync ordered lane (the identity-config flow-down shape,
`2026-08-16-identity-config-flow-down-design.md`) so it rides sync for free, or a mirror-side periodic
re-fetch of a primary config endpoint. Both are recorded here so the slice that needs it does not
rediscover the absence of a channel.

## 7. Invariants preserved (receipts)

- **Behaviour-preserving under default-on** — nothing disabled anywhere → bundle carries `{}` → mirror
  writes `{ "modules": {} }` → enabled set all-enabled, identical to today's mirror (§3).
- **SP-1b's on-box-file / no-DB-row decision is untouched.** The module set stays an on-box file on
  every node; the bundle carries a **snapshot** at adopt, not a replicated table. No `deployment`
  column, no schema change, no new grant (§6 receipt 1).
- **Fiscal chain untouched.** SP-1d touches only the enabled-set file and one bundle field; it changes
  nothing about `registerSif`, the chain, the immutability guards, or the reserved-standby identity
  (`establishReservedStandbyIdentity` is unchanged). The fiscal-slot columns
  (`nodes.filingModule`/`taxModule`, copied at `adopt.ts:118-119`) are a **separate** artifact from
  the enabled set and are not touched.
- **Adopt idempotency preserved.** The new step is a validated overwrite of `modules.json`; a re-run
  overwrites in place, consistent with `adoptFromPrimary`'s documented idempotent re-run
  (`adopt.ts:80-83`).
- **English-only preserved, not exempted-around.** `serializeModuleConfig` is generic (no module name,
  no vocabulary); `@waitron/module` stays a scanned English package. The Spanish names stay in the
  exempt fiscal package + composition root.
- **No new error code.** Re-validation reuses `parseModuleConfig`'s existing `module.config_*` codes;
  `writeModuleConfig` throws only fs errors.

## 8. Interactions

- **SP-1b** — consumes the on-box `modules.json` reader (`readModuleConfig`) and the enabled-set
  filter it built; SP-1d adds the **writer** and the adopt bootstrap SP-1b's deferred follow-up (b)
  named. The mirror-consistency concern SP-1b flagged (§5) is closed for adopt; ongoing is deferred
  with SP-1b's own "nothing disableable today" receipt.
- **SP-1c** — the bootstrapped set is whatever the primary's file declares; SP-1c's dependency graph
  validates it on the mirror at the mirror's own boot (a disabled dependency is refused there), so the
  bootstrap need not re-run the graph check — it persists, and boot validates as it already does.
- **SP-2** — the **first consumer** of the mirror's enabled set (the subscriber pulls only its own
  enabled modules). SP-1d makes that set equal the primary's; SP-2 relies on it. SP-2 is also the
  natural home for the deferred ongoing flow-down (§6).
- **R-series (adopt handshake)** — SP-1d adds one field to the same `MirrorBundle` R2/R3a/R3b use and
  one step to `adoptFromPrimary`; it does **not** touch promotion (`promote.ts`) or the reserved
  identity. The handshake is landed and stable through R3b (Slice 5 complete), so this is an additive
  change to a settled path.
- **No UI** — parallel-safe with the SP-B3.2 layout-editor session (architecture §7).

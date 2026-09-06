# SP-3d — The fiscal module's restore hook (fresh SIF, disjoint series; = BR-4)

**Date:** 2026-09-06
**Status:** design. **Owner-reviewed:** not yet — written in an unattended session. The four shaping
decisions in §3 are the ones to challenge at PR review; each states what it costs to reverse.

**Implements:** [module-system-architecture §8 SP-3](2026-09-04-module-system-architecture-design.md)
— the last of the four SP-3 slices (SP-3a #238, SP-3b #240, SP-3c #245 landed) — and the backup
regime's BR-4 ([backup-restore-regime §7](2026-09-04-backup-restore-regime-design.md)), folded into
SP-3 by owner decision 2026-09-05. It fills the `backup.restore` seat BR-2 declared and BR-3 left
empty, and closes the cold-restore follow-up the onboarding 4b-iii runbook recorded (`docs/backlog.md`,
"Cold-restore follow-up": `registerSif` does not freshen the invoice series).

**Unblocks:** promote-action Slice 4 (cold restore → primary): after this slice, the disaster-recovery
CLI alone makes a restored box trade-ready as a primary
([promotion-runbook §5d](2026-08-29-promotion-runbook-design.md)).

---

## 1. What this is, and its scope

A box is destroyed (dead disk, theft, fire) and no peer survives to promote. The operator installs
Waitron on new hardware and runs `waitron-restore restore <artifact>`. BR-3 restores the database,
the media and the box's secrets — including `trading.env`, so the new box boots as the **same node**
the backup came from — and restores the fiscal ledger **verbatim**: the chain head, the live SIF and
the invoice series are exactly what the backup held. Trading again in that state would be the one
unrecoverable fiscal failure: the next record would chain from the backup's last huella while AEAT
already holds the lost tail chained from that same huella — a fork (`CLAUDE.md` §5; #33 §3).

This slice makes the restore finish the job. When the box takes the backup's identity, each enabled
module's `backup.restore` hook runs inside one tenant transaction, and the fiscal module's hook:

1. **revokes the node's live SIF and registers a fresh one** — a fresh installation number from the
   never-reused counter and a reset chain head (`registerSif`, the existing re-registration
   primitive; the next sale is a genuine first record of a new chain);
2. **derives disjoint invoice series** for the node — `<code>-<installation number>`, the scheme a
   reserved standby already uses (`deriveReservedSeriesCodes`) — and returns them;

and the generic orchestrator then **retires** the node's old series, **inserts** the new ones, and
rewrites `trading.env`'s `WAITRON_TILL_SERIES_ID` to the new standard series, so the restored box
boots selling under a series AEAT has never seen a number of.

**In scope:** the typed `backup.restore` seat on `@waitron/module`; the fiscal hook
(`packages/fiscal-verifactu`); the orchestrator's hook phase (`apps/server/src/restore.ts`) and its
identity gate; a `retired_at` column on `invoice_series` and the reads that must honour it; the CLI's
reporting; tests that prove each guarantee on real Postgres; the receipts this retires.

**Out of scope, named:** the rejoin path's semantics (it restores with `skipSecrets: true` and after
this slice runs **no** hook, §5); a fresh **node** identity on restore (§3.1); the promote-action
Slice 4 *wrapper* (an authenticated endpoint / runbook step around this CLI — this slice delivers the
mechanism, not the operator surface); the AEAT `consultar` month-end reconciliation of the lost tail
(promotion-failover §5.2, reporting subsystem); resolving `config.till.seriesId` at **boot** (§12).

---

## 2. The scenario, and when it is the wrong tool

Cold restore is for the venue with **no surviving peer** — the sole-box venue or the cloud-standalone
basic tier ([promotion-failover §7.4](2026-08-29-promotion-failover-and-node-lifecycle-design.md)).
The posture is decided (owner, 2026-08-29): **going live again is an unblocked path; data loss is the
accepted price; being stuck offline is not.** The lost tail's *submitted* records come back from AEAT
at month-end; the un-submitted, un-replicated remainder is the customer's paper factura only.

If a mirror or a local secondary **survived**, cold-restoring the primary is the wrong recovery: the
survivor holds more of the venue's history than any backup, and it is promotable (runbook §5a/§5b).
The CLI cannot see whether a peer survived — the restored membership document names the peers as of
the backup, not their fate — so this is an operator precondition, stated in the CLI's output and the
runbook, not a guard. The one hazard of ignoring it is stated in §12.

---

## 3. Decisions (each reversible at the cost named)

### 3.1 The restored box keeps the dead box's node id

BR-3 already makes this so: `restoreSecrets` puts back `trading.env` (`WAITRON_TILL_NODE_ID`,
`WAITRON_TILL_TENANT_ID`, `WAITRON_TILL_SERIES_ID`, `WAITRON_TILL_LOCATION_ID` —
`apps/server/src/trading-config.ts`) and `secrets.env` (the box key that unseals
`membership.node_key`), so the new hardware boots as the same node with the same signing key. This
slice does not change that; it makes it fiscally safe.

Why the same node, not a fresh one: the fiscal identity is the SIF triple
`(NIF, id_sistema_informatico, numero_instalacion)` and the chain is keyed by the SIF row, not by the
node id — re-registering a node **is** the reimaged-box path (`CLAUDE.md` §5: "Re-registering a node
starts a new chain and mints a fresh installation number. Correct for a reimaged box"). Keeping the
node id keeps every till enrolled (a device row references its node), keeps the restored membership
document valid (the node signs with the same key it is named under), and keeps any `sync_cursor` or
`mirror_config.origin_node_id` a peer holds pointing at a node that exists. A fresh node id would
orphan all three and require re-enrolling every till and re-minting the membership chart — for no
fiscal gain.

The earlier "fresh `node_id`, install number and series" wording (promotion-failover §6.2 step 2; the
cold-recovery note of 2026-08-29) describes **adding** a node from another node's backup while that
owner is still alive — Server 3 restoring Server 1's backup must not write into Server 1's
partition. Cold restore has no living owner; the restored node is the partition's owner. The two
cases agree on what matters: the chain is fresh.

*Cost to reverse:* a fresh node id needs a node-row insert, till re-enrolment, a new membership
document and a new membership key — a different slice.

### 3.2 Series are retired, never rewritten

`registerSif` leaves `invoice_series` untouched, and the restored series carry the backup's
`next_number`. AEAT deduplicates on `(NIF, NumSerieFactura, FechaExpedicion, NumFactura)` — the
installation number is **not** in that key — so the first post-restore sale would re-issue an invoice
identity the dead box may already have filed: rejected with error `3000`, the outbox stuck on it.
Nothing external blocks a *sale* (§5), but a filing that can never succeed is not acceptable either.
So the node's series must be fresh, and the old ones must stop numbering.

Three ways to do that were weighed:

- **Rewrite the old row's `code` in place** (`FA` → `FA-7`), keeping its id so `trading.env` need not
  change. Rejected: every past sale references that series by id, and every read that joins
  `invoice_series.code` (`apps/server/src/till-sale.ts`, the receipt and report paths) would render
  history under a code it was never issued under. The immutable `registros_facturacion` rows carry the
  serie inline and would disagree with the join — a §5-class defect.
- **Bump `next_number` past the lost tail.** Rejected: the size of the lost tail is exactly what nobody
  knows; a guessed watermark is the backfill-that-can-only-guess the settlement design threw out
  (`CLAUDE.md` §3).
- **Insert new series and retire the old — chosen.** `invoice_series` gains
  `retired_at timestamptz null`. A retired series exists for history and refuses to number anything
  new. The node's *live* series are those with `retired_at IS NULL`, and every read that assumes "one
  standard series per node" (`readStandardSeriesId`, `standby.reserve`) reads the live set — which
  keeps that invariant true after a restore instead of making it reachable-false (§7).

*Cost to reverse:* a column drop and the four reads in §7.

### 3.3 Hooks run only when the box assumes the backup's identity

`writeValidated` today invokes every module's hook unconditionally, and the rejoin CLI
(`apps/server/src/rejoin-command.ts`) restores with `modules: ALL_MODULES, skipSecrets: true`. With
a fiscal hook in the list, wipe-and-restore R3 would re-register the **primary's** node on a fenced
secondary — a fresh SIF minted under the primary's node id, on a box that must keep its own identity
and never mint. That is a defect of the current seat that this slice happens to be the first to
reach, and the fix is a rule, not a special case: **a restore hook exists to make an assumed identity
trade-safe, so it runs iff the identity is assumed — iff secrets are restored.** `skipSecrets: true`
skips the hooks. Pinned by test (§9).

*Cost to reverse:* none foreseeable — a hook that should run on a box that is *not* the backup's node
has no known use.

### 3.4 The module derives; core writes the series and the env

`invoice_series` is core's table and `trading.env` is the server's file; the *disjointness rule* is
the regime's. SP-3c drew this line for standbys — the module derives the codes, the carrier inserts
them — and the hook follows it: the fiscal hook returns `{ report, series }`, and the orchestrator
retires the node's live series, inserts the returned ones (`next_number = 1`), and rewrites the env.
A module that returns no `series` leaves the series and the env alone (the `fiscal-none` module,
which has no SIF to freshen, will return none).

All of it — `registerSif`, the retire, the insert — is **one** `withTenant` transaction the
orchestrator opens; the hook takes the `tx` exactly as the provisioning seed does
(`NodeSeed.run(tx, node)`). The env rewrite is a filesystem step after the commit (§5).

---

## 4. The seat

`packages/module/src/module.ts` replaces `restore?: unknown` with a typed hook, alongside the
provisioning types it mirrors (`packages/module/src/provisioning.ts` exports `ProvisionedNode`):

```ts
// packages/module/src/restore.ts (new)
import type { Transaction } from "@waitron/db";
import type { ProvisionedNode } from "./provisioning.js";

/** What a module hands back from its restore hook. `series`, when present, REPLACES the node's live
 * invoice series: the orchestrator retires every live series of the node and inserts these
 * (`invoice_series` is core's table; the disjointness rule is the module's). Absent = leave the
 * series alone. */
export interface RestoreOutcome {
  /** One line for the operator (`"SIF … (installation 7); series FA-7, RE-7"`). */
  readonly report: string;
  readonly series?: readonly { readonly code: string; readonly purpose: string }[];
}

/** A module's restore hook: what it does so a box that has just RESTORED this node's backup and
 * TAKEN its identity can trade again as that node. Runs INSIDE the orchestrator's tenant
 * transaction, after the database, media and secrets are back and before the box boots. Never
 * runs for a restore that keeps the box's own identity (rejoin). */
export type RestoreHook = (tx: Transaction, node: ProvisionedNode) => Promise<RestoreOutcome>;
```

```ts
export interface ModuleBackupContribution {
  readonly nonDbState?: readonly NonDbSource[];
  readonly restore?: RestoreHook;
}
```

The BR-3 `RestoreHookContext` (`mediaDir`, `stateDir`, `log`) is deleted: no module puts non-DB
state back through it, the fiscal hook needs a transaction and a node, and a `Logger` on a module
seat would pull the server's type into the contract. Should a module later need a directory, the
outcome/argument shapes are open sets (BR-2's rule).

The dependency direction is unchanged from SP-3c: `@waitron/module` already imports `@waitron/db`
for `Transaction`.

---

## 5. The orchestrator after this change

`writeValidated` (`apps/server/src/restore.ts`), in order:

1. `restoreDatabase` → `restoreMedia` → `restoreSecrets` (unless `skipSecrets`) — unchanged.
2. **If `skipSecrets`, stop here** (§3.3). The rejoin CLI's flow is otherwise untouched.
3. **Read the restored identity** from `<stateDir>/trading.env` (`parseEnvFile`,
   `apps/server/src/env-file.ts`): `WAITRON_TILL_TENANT_ID`, `WAITRON_TILL_NODE_ID`,
   `WAITRON_TILL_LOCATION_ID`. Any of the three unset → `restore.identity_incomplete { missing }`
   (a backup of a box that never finished provisioning has no node to re-register; refusing is
   right). The `isUnset` rule applies: an empty value is missing.
4. **One tenant transaction** on the privileged restore connection (`createPostgresDb(databaseUrl)`
   → `withTenant(db, tenantId, …)`, closed in a `finally`). `withTenant` sets the tenant GUC by
   parameter binding whatever the role, so the FORCE-RLS policies on `registro_sif` / `cadenas` /
   `invoice_series` resolve the tenant exactly as they do for `app_user`; the counter table
   `contadores_instalacion` has no RLS by design. Inside it, for each module in list order with a
   `backup.restore` hook: `const outcome = await hook(tx, node)`; log the report; if
   `outcome.series` is present, `retireNodeSeries(tx, node)` then `insertNodeSeries(tx, node,
   outcome.series)` (both new in `@waitron/db`, beside `insertReservedSeriesTx`). The hooks and the
   series writes commit together or not at all — a hook that throws rolls back every module's work.
5. **Rewrite the env** — after the commit, `readStandardSeriesId(db, tenantId, nodeId)` (now
   reading only live series, §7) and, if it differs from `WAITRON_TILL_SERIES_ID`, rewrite that one
   key of `trading.env` (`writeFileAtomic`, 0600; the existing line order and every other key
   preserved). A module set that returned no series leaves the file byte-identical.
6. Staging cleanup in the `finally` — unchanged.

**Why the env write is after the commit, and what the window costs.** The commit is the
point-of-no-return (runbook §7: for a cold restore the PONR is minting the fresh SIF). R3b's
promotion writes its env *before* its PONR because a promoted-but-not-rebooted mirror sits inert;
here nothing exists to point the env at until the transaction has inserted the series, and
pre-minting the id to write it first would leave a `trading.env` naming a series that does not exist
if the transaction fails. The window is: commit succeeds, the env write fails (disk full, permissions).
Its failure mode is **loud**: the CLI exits 1 reporting the code and printing the new series id; a box
booted regardless would refuse every sale with `sale.series_retired` (§7) — never a silent sale under
the old numbers. `writeFileAtomic` does not fsync (R3b's carry-in); the restore CLI is run by a
present operator who reboots afterwards, and the same fix (fsync in `fs-atomic.ts`, or resolving the
series at boot) closes both windows — §12.

**Re-runs.** A second `waitron-restore` against the same target fails at `pg_restore` (the database
is no longer fresh), so the hook runs once per successful restore; a fresh target is a fresh
run. `registerSif` is deliberately non-idempotent (every call burns a number — gaps are permitted,
reuse never is), which is why the orchestrator never retries the transaction.

---

## 6. The fiscal hook

`packages/fiscal-verifactu/src/restore.ts` (new) exports `FISCAL_RESTORE: RestoreHook`, and the
composition list adds `backup: { restore: FISCAL_RESTORE }` to the `fiscal` descriptor
(`packages/composition/src/modules.ts`). The body:

1. **Is there a live SIF?** `currentSif(tx, tenantId, nodeId)`; on `sif.not_registered`, return
   `{ report: "no live SIF for node …; nothing to re-register" }` with no `series`. A node that never
   registered never filed, so it has neither a chain to fork nor a filed invoice identity to collide
   with; minting one would *make* it a filing node, which a restore must not decide.
2. **Read the live series** of the node — `select code, purpose from invoice_series where node_id = …
   and retired_at is null` — before re-registering, so the derived codes come from the codes that
   were in use (`FA`, `RE`), not from an earlier restore's derived ones. Read from the node's series,
   not from `trading.env`: the env names one standard series; the node may also own a rectificative
   one, and both must be fresh.
3. **`registerSif(tx, { tenantId, nodeId, nif: obligadoNif(tx, node), idSistemaInformatico:
   WAITRON_ID_SISTEMA })`** — revokes the live row, mints the next installation number, inserts the
   new SIF, resets the chain head to the both-null pointer. Exactly the seed's call; `obligadoNif`
   moves to a shared internal helper both use.
4. **Return** `{ report: "SIF <id> (installation <n>); series <codes>", series:
   deriveReservedSeriesCodes(liveSeries, n) }`.

Nothing in the hook touches `invoice_series` or the filesystem. Everything it writes goes through
`registerSif`, which the fiscal package already owns and tests; the new code is the branch in step 1
and the derivation in step 4.

**`entorno`.** Not a hook concern: the deployment environment is stamped per record at sale time from
the running config, and the restore gate has already refused a cross-environment artifact before any
hook runs.

---

## 7. Series retirement — the schema change and every read that must honour it

**Schema.** `invoice_series.retired_at timestamptz null` (`packages/db/src/schema/series.ts`; a
drizzle-generated migration in `packages/db/drizzle`, no RLS change — the table's policy and grants
are unchanged). `app_user`'s UPDATE on this table is column-level, `next_number` only
(`packages/db/drizzle/0003_invoice_series.sql`), and stays so: the retire runs on the restore CLI's
privileged connection — the table OWNER, which holds UPDATE implicitly — and no runtime path retires a
series. Never widen a grant to make this work (`CLAUDE.md` §3). No backfill: nothing is deployed.

**Reads that change** (found by grepping `invoiceSeries` across `packages/*/src` and `apps/*/src`;
the implementer re-runs that grep and lists every hit in the PR):

| Read | Today | After |
| --- | --- | --- |
| `recordSale` / `recordCorrection` / `recordSubstitution` (`packages/core`) series guard | exists, node, purpose | + `retired_at IS NULL`, else **`sale.series_retired { seriesId, retiredAt }`** — the write path is where a stale env is caught, loudly |
| `readStandardSeriesId` (`packages/db/src/reserved-identity.ts`) | all standard series of the node, loud on >1 | live standard series only; the >1 guard stays and stays unreachable |
| `FISCAL_PROVISIONING.standby.reserve` (`packages/fiscal-verifactu/src/provisioning.ts`) | every series of the primary node | live series only — a standby reserved after a restore derives `FA-<n>` from `FA-7`, giving `FA-7-<n>`: still disjoint, and the *live* code is the one a human would recognise |
| `allocateInvoiceNumber` (`packages/db/src/allocate-number.ts`) | `UPDATE … RETURNING` by id | unchanged: the three write paths guard before allocating, and the helper is never called on a series they have not just checked |

**Reads that do not change:** `till-sale.ts`'s receipt join (history must render the code the sale
was issued under — retired or not); `mirror-bundle.ts`'s `select().from(invoiceSeries)` (the bundle
carries the whole table so `venue-adopt` can `ON CONFLICT DO NOTHING`-copy it; a retired series is
part of that history); `venue-adopt.ts`.

**Dashboard / setup surfaces** that list or create series (`setup-api.ts`'s
`rectificativeSeriesCode`, any dashboard series screen): the implementer greps `invoice_series` and
`invoiceSeries` in `apps/*/src` and reports each; a listing surface shows retired series marked as
such or hides them — either is acceptable, silently offering one for a new sale is not (the write
path refuses it anyway).

---

## 8. Errors

- **`restore.identity_incomplete { missing: string }`** (`apps/server/src/errors.ts`) — a key the
  hook phase needs is absent or empty in the restored `trading.env`.
- **`restore.hook_failed { module: string; code: string }`** — a module's hook (or the series write
  for it) threw an `AppError`; the orchestrator wraps it so the CLI's `restore.*` reporting shows the
  module and the inner code without the generic CLI learning fiscal namespaces, and a non-`AppError`
  throw stays wrapped by the CLI's existing secret-safe "restore failed" branch.
- **`sale.series_retired { seriesId: string; retiredAt: string }`** (`packages/core/src/errors.ts`)
  — a sale, correction or substitution named a retired series. Sibling of `sale.series_not_found` /
  `sale.series_wrong_node` / `sale.series_wrong_purpose`; same prefix, same shape.

Codes are never renamed; none is.

---

## 9. Guards and tests — each proven by deletion

**`packages/fiscal-verifactu`** (`restore.test.ts`, `describeEachTarget` — the SIF/chain behaviour
does not depend on the role, so PGlite is the primary target and the real-Postgres leg is the
receipt):

- With a live SIF, one appended registro and series `FA`/`RE`: the hook returns a new SIF id, the old
  row is `revocado_en IS NOT NULL`, the new row is live with `numero_instalacion` one higher, the
  chain head is both-null (`esPrimerRegistro` true), `cadenas.secuencia` is **not** reset, the
  registro row is untouched, and `series` is `[FA-<n> standard, RE-<n> rectificative]`.
- Without a live SIF: no new row, no `series`, a report that says so. Delete the `currentSif` branch →
  the test sees a minted SIF → red.
- Live-series read ignores a retired series (seed one) → derived codes come only from live ones.

**`apps/server`** (`restore.test.ts`, unit, fake modules and an injected tx factory):

- The hook receives `(tx, node)` with the three ids parsed from the restored `trading.env`.
- `skipSecrets: true` invokes **no** hook (delete the gate → red).
- `series` present → the orchestrator retires the node's live series and inserts the new ones in the
  same transaction as the hook; a throwing hook leaves the series untouched (rollback).
- `series` absent → env byte-identical; present → only `WAITRON_TILL_SERIES_ID` changes.
- Missing env key → `restore.identity_incomplete`; a hook throwing an `AppError` →
  `restore.hook_failed` with the inner code; the CLI reports both by code.

**`apps/server` real-Postgres e2e** (`restore-fiscal-e2e.rls.test.ts`, the `rejoin-e2e` harness —
real artifact, `docker exec pg_restore`, shipped code):

- Seed a tenant / node / till / series `FA` (`next_number` 5) / live SIF / one `registros_facturacion`
  row; back up; restore onto a fresh clone through `restoreFromArtifact`. Assert: the registro row is
  present **and immutable** (`UPDATE` rejected `WT001`, BR-3's receipt kept); the old SIF revoked,
  the new one live; `FA` retired, `FA-<n>` live with `next_number` 1; `trading.env` in the test's
  stateDir names the new series; `readStandardSeriesId` returns it.
- **Negative control:** the same artifact restored with `skipSecrets: true` (the rejoin shape) leaves
  the SIF, series and `trading.env` untouched.

**`packages/core`**: `sale.series_retired` from each of the three write paths, proven by deleting the
predicate.

**`packages/db`**: `readStandardSeriesId` ignores a retired standard series; still loud on two live
ones.

**Root guards, run unfiltered before the PR:** `module-seams` (`restore.ts` gains no regime import —
it reaches the hook through the descriptor; `packages/db`'s series helpers are generic),
`english-only` (`packages/module/src/restore.ts` is English; the Spanish stays in the fiscal package
— `report` strings included), `errors-reachable` (three new codes, each thrown from a file that
imports its registry), `module-graph-honesty` (no new cross-set SQL edge — the column is core's),
`composition.test.ts` (the descriptor list is still manifest-exact), and the fiscal package's
`inmutabilidad` suite (a column on a `tenant_id` table; FORCE RLS unchanged).

---

## 10. Invariants preserved (receipts)

- **Never resume the dead chain.** `registerSif` resets `cadenas` to the both-null pointer
  (`resetChainHead`, `packages/fiscal-verifactu/src/registro-sif.ts`), so the first post-restore
  record is a first record (`esPrimerRegistro`) under a new SIF — the chain AEAT holds for the old
  SIF is frozen at the backup's last record and never extended. Proven by the §9 e2e.
- **Installation numbers are never reused.** The counter row is in the dump, so the restored counter
  is at least the backup's value; `registro_sif_instalacion_uq` backstops the rows the dump holds.
  The one residual is §12.
- **Disjoint series.** `<code>-<n>` with the fresh installation number; the same reasoning as R2's
  reserved series — provably distinct from every code the node used, and from every reserved
  standby's (`<code>-<m>`, `m ≠ n`) — with AEAT error `3000` the sole cross-node backstop, as before.
- **`registros_facturacion` immutable.** Untouched: the hook inserts a `registro_sif` row and updates
  `cadenas` and `invoice_series`, all mutable by design; BR-3's post-restore `WT001` receipt is kept
  in the e2e.
- **Nothing external blocks a sale.** The hook runs offline: no AEAT call, no network. The restored
  box trades the moment it boots.
- **One transaction for one logical change.** Hooks and series writes share the orchestrator's
  `withTenant`; the env rewrite is the one non-DB step, after the commit, with its window and
  failure mode stated (§5).
- **The generic core reaches into no module.** `restore.ts` iterates descriptors; the fiscal hook is
  wired in the composition list. The regime packages stay behind `module-seams`.
- **Our metadata stays out of the hash.** Nothing here touches `computeHuella` or `entorno`.

---

## 11. Receipts this change retires (edit in the same PR)

- `apps/server/src/restore.ts`: the `RestoreHookContext` header ("Deliberately NO database/chain
  handle … a restore hook has no business touching the fiscal chain"), `writeValidated`'s and
  `restoreFromArtifact`'s "mints NO fresh chain … no trade-readier", `invokeRestoreHooks`'s "EMPTY in
  v1 … touches NO fiscal chain".
- `apps/server/src/restore-command.ts`: "the restore-hook seat is empty in v1 … nothing to narrow
  yet". (`modules: ALL_MODULES` stays — the reason changes: a hook must run for every module whose
  tables are in the backup, and the descriptor list is that set.)
- `packages/module/src/module.ts`: `restore?: unknown // seat — … body lands in BR-3/BR-4`.
- `packages/composition/src/modules.ts`: the header's "populated seats today" list and `core`'s
  "`restore` is a later slice's seat" note.
- `packages/db/src/reserved-identity.ts`: `readStandardSeriesId`'s "unreachable today (R2 mints
  exactly one standard series per node)" — after this slice it is *kept* unreachable by the live
  filter; say so.
- `docs/superpowers/plans/2026-08-30-onboarding-slice4b-iii-cold-restore-runbook.md`: the "Known gap
  — the invoice SERIES is not freshened" block and the `register-till` step it describes (the CLI now
  does both) — a dated pointer, not a rewrite.
- `docs/superpowers/specs/2026-09-04-backup-restore-regime-design.md` §7 BR-4 and §8 first bullet;
  `docs/superpowers/specs/2026-09-05-membership-rejoin-r3-wipe-and-restore-design.md` §4 step 6
  (rejoin now also skips hooks — dated pointer).
- `docs/backlog.md`: SP-3d / BR-4 rows; the "Cold-restore follow-up" note; promote-Slice-4's gate.
- `CLAUDE.md` §5, "Re-registering a node starts a new chain": add that a cold restore does this
  automatically and retires the node's series.
- `apps/server/src/restore.test.ts`'s "(v1: none in ALL_MODULES)" test title and its exact-context
  assertion.

---

## 12. Residuals, stated

- **A surviving peer's cursors.** If a mirror survived and the operator cold-restores anyway (§2),
  the mirror's `sync_cursor` for this origin is *ahead* of the restored `sync_log`; the restored
  node's new records reuse sequence numbers the mirror already consumed and are silently skipped
  until the sequence passes the old cursor (promotion-failover §6.2 condition 1, in reverse). This is
  not new to this slice — it is true of BR-3 today and of any "restore an origin that has a live
  subscriber" — and the answer is the runbook's: promote the survivor. A guard would need the
  survivor to be reachable to be asked; not built.
- **Installation numbers minted after the last backup.** A standby that adopted after the backup
  holds a reserved number `m` the restored counter has not seen; the restore may mint `m` again. Two
  SIFs under one `(NIF, W1, m)` is a compliance defect only if that standby is ever promoted, and a
  promotable standby means cold restore was the wrong path (§2). The same applies to its reserved
  series `<code>-<m>`. Accepted; no mitigation buys anything a backup-age bound does not.
- **The env-write window** (§5) and `writeFileAtomic`'s missing fsync (R3b carry-in): both close by
  resolving the box's series at boot (a `config.till.seriesId` that is retired → the node's live
  standard series) or by fsync in `fs-atomic.ts`. Named for Track A, not built here.
- **`cadenas.secuencia` continues** across the SIF change (never reset — it is ours, and the unique
  on `(tenant, node, secuencia)` forbids a reset). Correct and unchanged; stated so nobody "fixes" it.

---

## 13. Interactions

- **BR-3 / R3 wipe-and-restore (#232, #237):** the shared `writeValidated` gains the identity gate;
  the rejoin CLI's behaviour is unchanged except that it can no longer fire a module hook — which it
  never intended to (its spec §4 step 6: "the node keeps its own identity").
- **SP-3c (#245):** the seed and the hook share `obligadoNif` and `registerSif`; the standby
  reservation reads live series. `fiscal-none` fills `backup.restore` with a hook that returns no
  `series` (or omits the seat).
- **Promote-action Slice 4:** its remaining work is the operator surface (attestation-free — no old
  node runs — but the same authenticated entry as the other promote paths); the mechanism is this
  CLI.
- **Till-reroute S2 / boot:** a promoted-not-yet-rebooted box briefly opening writes under a stale
  series (R3b's carry-in) and this slice's env window share one fix — series resolution at boot.
- **Reporting / month-end `consultar`:** unaffected; the lost tail's recovery is that subsystem's.

## 14. What this does not touch

`computeHuella`; `registros_facturacion` and its triggers; the AEAT transport; the backup producer
(manifest, archive, encryption, destinations); the compatibility gate and the traversal guard; the
provisioning runners; `nodes`, `node_membership`, `mirror_config`; the till and dashboard sale paths
beyond the one added guard.

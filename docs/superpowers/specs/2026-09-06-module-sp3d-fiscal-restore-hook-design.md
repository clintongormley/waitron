# SP-3d — The fiscal module's restore hook (fresh SIF, disjoint series; = BR-4)

**Date:** 2026-09-06
**Status:** design. **Owner-reviewed:** not yet — written in an unattended session, then reviewed
fresh-context by Fable and read-only by Astra (both 2026-09-06; the findings that changed this text
are folded in and named where they matter). The decisions in §3 are the ones to challenge at PR
review; each states what it costs to reverse.

**Implements:** [module-system-architecture §8 SP-3](2026-09-04-module-system-architecture-design.md)
— the last of the four SP-3 slices (SP-3a #238, SP-3b #240, SP-3c #245 landed) — and the backup
regime's BR-4 ([backup-restore-regime §7](2026-09-04-backup-restore-regime-design.md)), folded into
SP-3 by owner decision 2026-09-05. It fills the `backup.restore` seat BR-2 declared and BR-3 left
empty, and closes the cold-restore follow-up the onboarding 4b-iii runbook recorded (`docs/backlog.md`,
"Cold-restore follow-up": `registerSif` does not freshen the invoice series).

**Unblocks:** promote-action Slice 4 (cold restore → primary): after this slice the disaster-recovery
CLI leaves nothing *fiscal* for the operator to do
([promotion-runbook §5d](2026-08-29-promotion-runbook-design.md)). The platform steps that remain
are named in §2.

---

## 1. What this is, and its scope

A box is destroyed (dead disk, theft, fire) and no peer survives to promote. The operator installs
Waitron on new hardware and runs `waitron-restore restore <artifact>`. BR-3 restores the database,
the media and the box's secrets — including `trading.env`, so the new box boots as the **same node**
the backup came from — and restores the fiscal ledger **verbatim**: the chain head, the live SIF and
the invoice series are exactly what the backup held. Trading in that state would be the one
unrecoverable fiscal failure: the next record would chain from the backup's last huella while AEAT
already holds the lost tail chained from that same huella — a fork (`CLAUDE.md` §5; #33 §3).

This slice makes the restore finish the job. When the box takes the backup's identity, each enabled
module's `backup.restore` hook runs inside one tenant transaction **before the identity is written
to disk**, and the fiscal module's hook:

1. **revokes the node's live SIF and registers a fresh one** — a fresh installation number from the
   never-reused counter, floored so a later restore can never re-mint it (§3.5), and a reset chain
   head (`registerSif`, the existing re-registration primitive; the next sale is a genuine first
   record of a new chain);
2. **derives disjoint invoice series** for the node — `<base>-<installation number>`, the scheme a
   reserved standby already uses (`deriveReservedSeriesCodes`) with a base rule that keeps the code
   bounded across repeated restores (§6) — and returns them;

and the generic orchestrator then **retires** the node's old series, **inserts** the new ones, checks
the node has exactly one live standard series, commits, and only then writes the secrets — with
`trading.env`'s `WAITRON_TILL_SERIES_ID` pointing at the new standard series. A restore whose hook
fails leaves **no** `trading.env` on the box, so the old identity is never bootable.

**In scope:** the typed `backup.restore` seat on `@waitron/module`; the fiscal hook
(`packages/fiscal-verifactu`); the orchestrator's hook phase in `apps/server/src/restore.ts` — its
ordering, its identity gate, and a migrate step so hooks see the binary's schema; a `retired_at`
column on `invoice_series` and the reads that must honour it; the CLI's reporting; tests that prove
each guarantee; the receipts this retires.

**Out of scope, named:** the rejoin path's semantics (it restores with `skipSecrets: true` and after
this slice runs **no** hook, §3.3); a fresh **node** identity on restore (§3.1); the promote-action
Slice 4 operator surface (an authenticated endpoint / runbook step around this CLI — this slice is
the mechanism); rebinding the restored `trading.env`'s connection strings and advertised origin to
the new hardware (§2); AEAT `consultar` month-end reconciliation of the lost tail
(promotion-failover §5.2); resolving `config.till.seriesId` at **boot** (§12).

---

## 2. The scenario, and what the CLI does not do

Cold restore is for the venue with **no surviving peer** — the sole-box venue or the cloud-standalone
basic tier ([promotion-failover §7.4](2026-08-29-promotion-failover-and-node-lifecycle-design.md)).
The posture is decided (owner, 2026-08-29): **going live again is an unblocked path; data loss is the
accepted price; being stuck offline is not.** The lost tail's *submitted* records come back from AEAT
at month-end; the un-submitted, un-replicated remainder is the customer's paper factura only.

**Every artifact is a primary's.** The backup duty is a singleton-primary duty (`apps/server/src/boot.ts`,
the `runBackupSweep` wiring takes the `isSingletonPrimary` gate), so the restored `deployment` row
reads `(primary, primary)` and the restored `node_membership` document names this node
serving-primary — unless the node was already fenced when the backup was taken, in which case it
boots fenced (R1 #214) exactly as it would have before it died. Restore does not decide authority;
it restores the authority the node had.

**If a mirror or a local secondary survived**, cold-restoring the primary is the wrong recovery: the
survivor holds more history than any backup and is promotable (runbook §5a/§5b). The CLI cannot see
whether a peer survived — the restored document names the peers as of the backup, not their fate —
so this is an operator precondition, stated in the CLI's output and the runbook, not a guard. The
hazard of ignoring it is in §12.

**What the CLI leaves to the operator (platform, not fiscal).** The restored `trading.env` carries
the dead box's `DATABASE_URL` / `WAITRON_MIGRATIONS_DATABASE_URL` (`apps/server/src/trading-config.ts`)
— role names and passwords of the dead cluster — and `pg_dump` carries no roles. New hardware
either recreates those roles with those passwords (the reinstall image's job) or the operator rebinds
the URLs; the advertised origin (#244) is the same class of edit. The restore CLI checks the target
it was pointed at (`WAITRON_RESTORE_DATABASE_URL`) and nothing else; it does not verify that the
restored `DATABASE_URL` reaches that target. These belong to the promote-Slice-4 operator surface;
naming them here is what keeps "fiscally trade-ready" an honest claim.

---

## 3. Decisions (each reversible at the cost named)

### 3.1 The restored box keeps the dead box's node id

BR-3 already makes this so: `restoreSecrets` puts back `trading.env` (the `WAITRON_TILL_*_ID` keys,
the connection strings and `WAITRON_ENV` — `trading-config.ts`) and `secrets.env` (the box key that
unseals `membership.node_key`, `box-secrets.ts` / `node-identity.ts`), so the new hardware boots as
the same node with the same signing key. This slice does not change that; it makes it fiscally safe.

Why the same node: the node id is the key of everything the backup holds about this box —
`registro_sif`, `cadenas` (keyed `(tenant_id, node_id)` — the chain head `registerSif` resets),
`sales.node_id`, `registros_facturacion.node_id`, `sync_log.origin_id`, the standing under which the
restored membership document names it, and any peer's `mirror_config.origin_node_id` and
`sync_cursor`. Re-registering that node **is** the reimaged-box path (`CLAUDE.md` §5: "Re-registering
a node starts a new chain and mints a fresh installation number. Correct for a reimaged box"). A
fresh node id would orphan every one of those rows and need a new node row, a new membership
document and a new key — for no fiscal gain: the fiscal identity is the SIF triple
`(NIF, id_sistema_informatico, numero_instalacion)`, and that is what the hook freshens. (Devices
and tills carry no node column — `packages/db/src/schema/devices.ts`, `tenants.ts` — so till
enrolment is not among the reasons; the earlier draft claimed it was.)

The "fresh `node_id`, install number and series" wording of promotion-failover §6.2 step 2 and the
cold-recovery note of 2026-08-29 describes **adding** a node from another node's backup while that
owner is alive — Server 3 restoring Server 1's backup must not write into Server 1's partition. Cold
restore has no living owner; the restored node is the partition's owner. Both cases agree on what
matters: the chain is fresh.

*Cost to reverse:* a node-row insert, a new membership document and key, and a peer re-point — a
different slice.

### 3.2 Series are retired, never rewritten

`registerSif` leaves `invoice_series` untouched, and the restored series carry the backup's
`next_number`. AEAT's record identity is `IDEmisorFactura` + `NumSerieFactura` +
`FechaExpedicionFactura` (`packages/verifactu/src/records.ts:55-57`; mirrored by
`registros_identidad_uq`, `packages/fiscal-verifactu/src/schema/registros.ts:174-179`), where
`NumSerieFactura` is the series code and the counter joined as `<code>/<n>` (`formatInvoiceNumber`,
`packages/core/src/record-sale.ts:133`). The installation number is **not** in that key, so the
first post-restore sale would re-issue an identity the dead box may already have filed. What AEAT
does then is worse than "stuck": a `3000` whose `EstadoRegistroDuplicado` is `Correcta` is mapped to
**accepted** with no huella comparison (`packages/verifactu/src/xml/parse-suministro.ts:141-148`),
so the local record is marked `aceptado` while AEAT holds the dead box's *different* record under
that identity — a silently wrong "filed". Only a duplicate AEAT reports without state goes to the
`consultar` compare and halts on `fiscal.huella_divergente` (`drain.ts`, `handleDuplicate`). So the
node's series must be fresh, and the old ones must stop numbering.

Three ways to do that were weighed:

- **Rewrite the old row's `code` in place** (`FA` → `FA-7`), keeping its id. Rejected: every past
  sale references that series by id, and every read that joins `invoice_series.code`
  (`till-sale.ts`'s receipt join, `working-order.ts`'s `readInvoiceNumber`) would render history
  under a code it was never issued under, disagreeing with the immutable record's inline serie.
- **Bump `next_number` past the lost tail.** Rejected: the size of the lost tail is exactly what
  nobody knows; a guessed watermark is the backfill-that-can-only-guess the settlement design threw
  out (`CLAUDE.md` §3).
- **Insert new series and retire the old — chosen.** `invoice_series` gains
  `retired_at timestamptz null`. A retired series exists for history and refuses to number anything
  new. The node's *live* series are those with `retired_at IS NULL`, and every read that assumes
  "one standard series per node" (`readStandardSeriesId`, `standby.reserve`) reads the live set —
  which keeps that invariant true after a restore instead of making it reachable-false (§7).

*Cost to reverse:* a column drop and the reads in §7.

### 3.3 Hooks run only when the box assumes the backup's identity

`writeValidated` today invokes every module's hook unconditionally, and the rejoin CLI
(`apps/server/src/rejoin-command.ts`) restores with `modules: ALL_MODULES, skipSecrets: true`. A
rejoining secondary keeps its **own** `trading.env`; a hook keyed on that identity would run for the
*secondary's* node against the *primary's* dump — and whether it minted would depend on whether the
dump happened to carry the secondary's reserved SIF row (`registro_sif` rides the ordered lane both
ways since SP-3a). A fenced node that must keep its identity and never mint would be one dump-shape
away from minting. That is a defect of the current seat that this slice is the first to reach, and
the fix is a rule, not a special case: **a restore hook exists to make an assumed identity
trade-safe, so it runs iff the identity is assumed — iff secrets are restored.** `skipSecrets: true`
skips the hooks. Pinned by test (§9).

*Cost to reverse:* none foreseeable — a hook that should run on a box that is *not* the backup's node
has no known use.

### 3.4 The module derives; core writes the series and the env — and the identity is written last

`invoice_series` is core's table and `trading.env` is the server's file; the *disjointness rule* is
the regime's. SP-3c drew this line for standbys — the module derives the codes, the carrier inserts
them — and the hook follows it: the fiscal hook returns `{ report, series }`, and the orchestrator
retires the node's live series, inserts the returned ones (`next_number = 1`), and points the env at
the new standard series. A module that returns no `series` leaves the series alone (the
`fiscal-none` module, which has no SIF to freshen, will return none).

Ordering is the safety mechanism (Astra's Critical 2): the hooks and series writes commit **before**
`restoreSecrets` runs, and the orchestrator writes `trading.env` from the artifact's entry with the
series key already rewritten. A pre-existing `trading.env` on the target (a box that was partly
provisioned before the restore) is **set aside first** — renamed to `trading.env.replaced`, which
boot never reads — before anything irreversible (the plan review's Critical 1). A restore that fails
anywhere before the secrets write therefore leaves the box with **no** `trading.env` at all — neither
the artifact's nor the target's old one — so the verbatim ledger is never tradable under any
identity. The only remaining non-atomic step is the secrets write after the commit (§5).

Boot-time series resolution (a `config.till.seriesId` that is retired → the node's live standard
series) would make even that step unnecessary and would also close R3b's power-loss carry-in. It is
deliberately **not** in this slice: it changes `boot.ts`'s trading-config path, which Track A owns
and which every deployment shape boots through; this slice's ordering removes the window on the
restore path without touching boot. Named in §12 for Track A.

### 3.5 Installation numbers minted at restore are floored by the clock

Astra's Critical 1, reproduced on a PGlite snapshot: the counter row is in the dump, so a restore
of an artifact **older** than a previous restore's minting re-mints the same installation number
(`backupInstallation: 1 → afterBackupInstallation: 2 → restoredInstallation: 2`). No standby needed
— restoring the same artifact twice does it, and a first restoration whose own backups never left
the box is exactly when an operator reaches for the older artifact again. The unique index
`registro_sif_instalacion_uq` cannot help: the row it would collide with is not in the restored DB.

The counter's never-reuse guarantee rests on one writer per NIF and monotonic state; a restore
rolls that state back. The only monotonic state a sole box has that the dump does not roll back is
the **wall clock**. So the hook, before `registerSif`, raises the counter floor:

```sql
update contadores_instalacion
   set proximo_numero = greatest(proximo_numero, <floor>)
 where nif = $1 and id_sistema_informatico = $2
```

with `floor = seconds since 2020-01-01T00:00:00Z` at the restore (an `int` until 2088;
`numero_instalacion` is `integer` and the wire field `NumeroInstalacion` is a string — no format
limit is reached). A second restore of the same artifact then mints a strictly larger number
unless it happens within the same second or the clock runs backwards — and a clock behind its
previous self already breaks every fiscal timestamp on the box, so it is not a new dependency.
Reservations after the restore continue sequentially from the floor. AEAT recommends a sequential
autonumber and permits gaps (reserved-standby §7); one large gap per restore is that permission
used once.

What this does not cover: a standby reserved after the backup holds a number `m` below the floor
and its series `<code>-<m>`; a restore never re-mints `m` (the floor is far above it), so the
earlier draft's residual is closed too. The derived series code inherits the floor's size
(`FA-210441234`); §6 bounds it.

*Cost to reverse:* delete the floor statement; the reuse experiment in §9 goes red.

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
 * series alone. At most one module may return it; an empty list is a module error (a node with no
 * live standard series cannot sell). */
export interface RestoreOutcome {
  /** One line for the operator (`"SIF … (installation 210441234); series FA-210441234, RE-210441234"`). */
  readonly report: string;
  readonly series?: readonly { readonly code: string; readonly purpose: string }[];
}

/** A module's restore hook: what it does so a box that has just RESTORED this node's backup and is
 * about to TAKE its identity can trade again as that node. Runs INSIDE the orchestrator's tenant
 * transaction (origin-stamped with the node), after the database is restored and migrated and
 * before the identity is written to disk. Never runs for a restore that keeps the box's own
 * identity (rejoin). */
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
outcome/argument shapes are open sets (BR-2's rule). `@waitron/module` already depends on
`@waitron/db` for `Transaction` (`packages/module/package.json`).

---

## 5. The orchestrator after this change

`writeValidated` (`apps/server/src/restore.ts`), in order:

1. **Set aside any existing identity** (unless `skipSecrets`): `<stateDir>/trading.env` →
   `trading.env.replaced` (boot reads only the former; a missing file is the normal fresh-box
   case). Then `restoreDatabase` → `restoreMedia` — unchanged.
2. **Migrate the restored database to this binary's schema** (Astra's Major 3): the compatibility
   gate admits an artifact whose module schema versions are *older* than the target's
   (`restore-gate.ts` refuses only newer), and a hook written against today's schema — this one
   reads `retired_at` — must not run against yesterday's. `applyMigrations(databaseUrl,
   migrationOptionsFor(orderedMigrationSets(ALL_MODULES), migrationsRoot))` (`@waitron/migrations`,
   the call boot makes; `ALL_MODULES` because the CLI, like setup mode, has no enabled-set config and
   every module whose tables are in the dump must be current). Boot's own migration becomes a
   no-op. Injected as `deps.migrate` (default `applyMigrations`) so the unit tests assert the order
   without a database.
3. **If `skipSecrets`, stop here** (§3.3). The rejoin CLI's flow is otherwise untouched.
4. **Read the identity from the artifact** — `validated.secretEntries`' `trading.env` (never the
   target box's file: the target may hold a stale or foreign identity; Astra's Minor 11), parsed
   with `parseEnvFile` (`env-file.ts`): `WAITRON_TILL_TENANT_ID`, `WAITRON_TILL_NODE_ID`,
   `WAITRON_TILL_LOCATION_ID`, `WAITRON_TILL_SERIES_ID`. Any unset or empty (`isUnset`) →
   `restore.identity_incomplete { missing }`. Then check the `nodes` row `(tenantId, nodeId)`
   exists in the restored DB → else `restore.identity_unknown { tenantId, nodeId }`: the identity
   must be one this backup knows.
5. **One tenant transaction** on the privileged restore connection: `deps.openDb(databaseUrl)`
   (default `createPostgresDb`, closed in a `finally`) → `withTenant(db, tenantId, fn, { nodeId })`.
   The `{ nodeId }` is not optional (Fable's Major 1 / Astra's Major 8): `registro_sif` and
   `cadenas` are enrolled on the ordered fiscal lane (`packages/fiscal-verifactu/src/enrolment.ts`),
   so the revoke, the new SIF row and the chain-head reset are captured, and a subscriber pulls only
   rows whose `origin_id` is its peer's node (`packages/sync/src/source.ts`); without the GUC they
   would carry the all-zero origin and a later standby of this node would never receive the SIF it
   files under. Inside the transaction, for each module in list order with a `backup.restore` hook:
   `outcome = await hook(tx, node)`; collect the report; if `outcome.series` is present, remember
   it with the module name. After the loop: more than one module returned `series` →
   `restore.series_conflict { modules }`; exactly one → `retireNodeSeriesTx(tx, node)` then
   `insertNodeSeriesTx(tx, node, series)` (both new in `@waitron/db`, beside
   `insertReservedSeriesTx`; the insert refuses a code the node already holds, live or retired, with
   `series.code_collision { code }` — the unique key includes retired rows, so this is a check, not
   a constraint surprise). Then, **on every path**, `readStandardSeriesIdTx(tx, node)` (the
   live-filtered read of §7, in-transaction) — zero or two live standard series aborts the
   transaction whether or not a module returned series, so the commit never leaves a node that
   cannot sell (the plan review's Major 2). A failure in this settling step is reported as
   `restore.hook_failed` naming the module that returned the series, or `core` when none did —
   `invoice_series` is core's contract. The resolved standard series id is the transaction's result.
6. **Write the secrets** — `restoreSecrets` as today, except that the `trading.env` entry is
   rewritten in memory first when the id from step 5 differs from the artifact's
   `WAITRON_TILL_SERIES_ID` (so an artifact whose env named a series that is not the node's live
   standard one is corrected too); byte-identical otherwise. Every other key and the line order are
   preserved.
7. Staging cleanup in the `finally` — unchanged.

The **role**. `WAITRON_RESTORE_DATABASE_URL` is the superuser/BYPASSRLS-class role the backup was
taken with (BR-3 plan §"the restore connection"; 4b-iii runbook) — it must be, to recreate FORCE-RLS
objects. So RLS does not apply to this transaction and this spec claims nothing about the policy
path; `withTenant` is used because it is the house's one write-transaction primitive and because
its `{ nodeId }` is what stamps the origin. `contadores_instalacion` has no RLS by design.

**The one non-atomic step, and what it costs.** The commit is the point-of-no-return (runbook §7:
for a cold restore the PONR is minting the fresh SIF). If the secrets write then fails (disk full,
permissions), the DB holds a fresh SIF and the box holds no `trading.env`: it cannot boot into
trading, the CLI exits 1 by code, and the restore is redone from a fresh database — the minted
number is a burned gap, never filed under (the floor makes the redo mint a larger one). Nothing in
that window can trade under the old identity. `writeFileAtomic` does not fsync (R3b's carry-in); a
power cut after a successful write but before the page reaches disk could leave the box with the
artifact's *unrewritten* `trading.env` — a retired series id — which `sale.series_retired` (§7)
refuses loudly at the first sale. Boot-time resolution (§3.4, §12) would self-heal it.

**Re-runs.** `pg_restore` into a non-empty target errors per object and exits non-zero
(`pg-restore.ts` passes no `--exit-on-error`, so it does not refuse up front; the rejection is what
stops the flow), so the hook never runs twice against one target. Only *committed* `registerSif`
calls consume a number (the counter update is transactional — Astra rolled one back and watched
the next commit reuse it), which is why the orchestrator never retries the transaction and why a
rolled-back hook leaves no gap.

---

## 6. The fiscal hook

`packages/fiscal-verifactu/src/restore.ts` (new) exports `FISCAL_RESTORE: RestoreHook`, and the
composition list adds `backup: { restore: FISCAL_RESTORE }` to the `fiscal` descriptor
(`packages/composition/src/modules.ts`). The body:

1. **Is there a live SIF?** `currentSif(tx, tenantId, nodeId)`; on `sif.not_registered`, return
   `{ report: "node … holds no live SIF; nothing re-registered, series unchanged" }` with no
   `series`. A node with no live SIF is not currently a filing node — it cannot sell
   (`recordSale` needs `currentSif`) — and a restore must not decide that it becomes one. (This says
   nothing about whether it *ever* filed: a revoked SIF may have. It does not matter here — with no
   live SIF no new identity can be issued, so nothing collides.)
2. **Read the live series** of the node — `select code, purpose from invoice_series where node_id =
   … and retired_at is null` — before re-registering. From the node's series, not from
   `trading.env`: the env names one standard series; the node may also own a rectificative one, and
   both must be fresh.
3. **Raise the counter floor** (§3.5) for the live SIF's `(nif, id_sistema_informatico)`.
4. **`registerSif(tx, { tenantId, nodeId, nif: live.nif, idSistemaInformatico:
   live.idSistemaInformatico })`** — the identity **in use**, read from the live row as
   `standby.reserve` does (Fable's Minor 10), not the product constant plus `tenants.tax_id`: the
   counter is keyed by that pair, and re-registering under a different pair would mint from a
   different counter. Revokes the live row, mints `max(counter, floor)`, inserts the new SIF, resets
   the chain head to the both-null pointer.
5. **Derive the codes.** For each live series, `base` is its code with every trailing `-<digits>`
   group **whose digits equal an installation number this tenant has registered** (`registro_sif`,
   any node, live or revoked) stripped — so `FA` → `FA`, `FA-7` (a promoted standby's) → `FA`,
   `FA-210441234` (an earlier restore's) → `FA`, and a human's `FA-2026` stays `FA-2026` unless
   `2026` was an installation number. Then `deriveReservedSeriesCodes(bases, n)` = `<base>-<n>`.
   The code is bounded by one suffix regardless of how many restores a node survives (Astra's
   Major 5: unbounded suffixing walked a 60-character `NumSerieFactura` to 62). Refuse with
   `series.code_too_long { code }` if `base.length + 1 + 10 + 1 + 10 > 60` — one suffix of at most
   ten digits, the `/`, and ten digits of counter, against `NUMSERIE_LENGTH`
   (`packages/verifactu/src/validate.ts`); a base over 38 characters is not a real code.
6. **Return** `{ report: "SIF <id> (installation <n>); series <codes>", series }`.

Nothing in the hook touches `invoice_series` or the filesystem. What it writes goes through
`registerSif` and the one counter-floor statement; the new code is the branch in step 1, the floor,
the derivation rule and its bound.

**`entorno`.** Not a hook concern: the deployment environment is stamped per record at sale time from
the running config, and the restore gate has already refused a cross-environment artifact before any
hook runs.

---

## 7. Series retirement — the schema change and every consumer

**Schema.** `invoice_series.retired_at timestamptz null` (`packages/db/src/schema/series.ts`; a
drizzle-generated migration in `packages/db/drizzle`, no RLS change — the table's policy and grants
are unchanged). `app_user`'s UPDATE on this table is column-level, `next_number` only
(`packages/db/drizzle/0003_invoice_series.sql`), and stays so: the retire runs on the restore CLI's
privileged connection, and no runtime path retires a series. Never widen a grant to make this work
(`CLAUDE.md` §3). No backfill: nothing is deployed.

**Every consumer** (both reviewers' greps of `invoiceSeries` / `invoice_series` / `seriesId` across
`packages/*/src` and `apps/*/src`, non-test; no hit in the browser apps; the implementer re-runs the
grep and lists any new hit in the PR):

| Consumer | Disposition |
| --- | --- |
| `recordSale` / `recordCorrection` / `recordSubstitution` (`packages/core`) series guard | + `retired_at IS NULL`, else **`sale.series_retired { seriesId, retiredAt }`** — the write path is where a stale env is caught, loudly |
| `readStandardSeriesId` (`packages/db/src/reserved-identity.ts`) | live standard series only; the >1 guard stays, its `v8 ignore` dropped because §9 makes it reachable; a `Tx` variant for §5 step 5 |
| `FISCAL_PROVISIONING.standby.reserve` (`fiscal-verifactu/src/provisioning.ts`) | derives from the node's live series **bases** — the same `liveSeriesBases` the hook uses (§6 step 5), so a standby reserved after a restore holds `FA-<m>`, never `FA-210441234-<m>` (the plan review's Major 3) |
| `promote.ts` (`readStandardSeriesId` for the promoting mirror) | unchanged code; benefits from the live filter |
| `allocateInvoiceNumber` (`packages/db/src/allocate-number.ts`) | unchanged: only the three guarded write paths call it, after their check |
| `till-config.ts` (`WAITRON_TILL_SERIES_ID`), `device-session.ts`, `till-api.ts`, `working-order.ts` (sale config) | unchanged: they read the env this slice rewrites; a device carries no series |
| `till-sale.ts` receipt join, `working-order.ts` `readInvoiceNumber` | unchanged: history renders the code the sale was issued under, retired or not |
| `mirror-bundle.ts` (whole-table select), `venue-adopt.ts` (copy with `ON CONFLICT DO NOTHING`) | unchanged: the bundle carries the whole table, `reviveRow` revives every date-mode column generically, so `retired_at` crosses the bundle — the first timestamp on this table, so say so in a test |
| `venue-apply.ts` (`insert … on conflict (tenant_id, node_id, code) do nothing`) | unchanged: a retired code cannot be re-created under the same node — correct, that identity was used |
| `adopt.ts`, `boot.ts` `persistTradingEnv` | unchanged |
| `setup-api.ts` `rectificativeSeriesCode` | creation input, not a listing; unchanged |

No runtime path resolves a rectificative series by purpose (grep `rectificative`, non-test: only the
setup input and a type comment), so there is no hidden purpose-based consumer.

---

## 8. Errors

`apps/server/src/errors.ts`:

- **`restore.identity_incomplete { missing }`** — a key the hook phase needs is absent or empty in
  the artifact's `trading.env`.
- **`restore.identity_unknown { tenantId, nodeId }`** — the artifact's identity names a node the
  restored database does not hold.
- **`restore.series_conflict { modules }`** — more than one module returned `series`.
- **`restore.hook_failed { module, code }`** — a module's hook, or the series write for it, threw an
  `AppError`; wrapped so the CLI's `restore.*` reporting shows the module and the inner code without
  the generic CLI learning fiscal namespaces. A non-`AppError` throw stays under the CLI's existing
  secret-safe "restore failed" branch.

`packages/db/src/errors.ts`:

- **`series.code_collision { code }`** — the derived code already exists for the node (live or
  retired). Requires a human-chosen code equal to `<base>-<seconds-since-2020>`; the restore is redone
  a second later.

`packages/fiscal-verifactu/src/errors.ts`:

- **`series.code_too_long { code }`** — §6 step 5's bound. (`series.` is the domain prefix
  `series.not_found` / `series.no_standard_for_node` already use; the code names the concept, not
  the package.)

`packages/core/src/errors.ts`:

- **`sale.series_retired { seriesId, retiredAt }`** — a sale, correction or substitution named a
  retired series. Sibling of `sale.series_not_found` / `sale.series_wrong_node` /
  `sale.series_wrong_purpose`; same prefix, same shape.

Codes are never renamed; none is.

---

## 9. Guards and tests — each proven by deletion

The tests below are **required evidence**, not receipts: nothing in §10 is proven until they exist
and run.

**`packages/fiscal-verifactu`** (`restore.test.ts`; PGlite via the package's own harness and
`seedTill` (`src/testing/seed.ts`), plus a real-Postgres leg on `useTemplateDb({ template:
"manifest" })` as the `.rls.test.ts` siblings do — `describeEachTarget` is `@waitron/db`'s
core-only harness and does not apply here):

- With a live SIF, one appended registro and series `FA`/`RE`: the hook returns a new SIF id, the
  old row is `revocado_en IS NOT NULL`, the new row is live with `numero_instalacion ≥ floor` and
  greater than every number in the seeded rows, the chain head is both-null (`esPrimerRegistro`
  true), `cadenas.secuencia` is **not** reset, the registro row is untouched, and `series` is
  `[FA-<n> standard, RE-<n> rectificative]`.
- **The reuse experiment** (§3.5): register at counter 1 (state A, the backup); register again (2 —
  a previous restore's minting); then rebuild state A exactly — delete the row for 2, un-revoke 1,
  reset the counter (what restoring the older artifact does; leaving the row for 2 in place would
  make the unique index, not the floor, refuse the reuse); run the hook → the minted number is not
  2 and exceeds it. Delete the floor statement → the hook mints 2 → red.
- Without a live SIF: no new row, no `series`, a report that says so. Delete the `currentSif`
  branch → red.
- The base rule: live `FA-7` (7 a revoked number of this tenant) derives `FA-<n>`; live `FA-2026`
  (no such number) derives `FA-2026-<n>`; a 39-character base → `series.code_too_long`.
- The live-series read ignores a retired series.
- The first post-restore record, through the **real append path** (`appendToChain`, which computes
  the huella and derives `primer_registro`) both before and after the hook — never a fixture that
  writes the hash by hand, which the verifier would reject as a predecessor-hash mismatch:
  `primer_registro = true`, null `anterior_*`, `sif_id` = the fresh SIF, the sequence continued,
  `verifyChain` ok across the boundary.
- A real-Postgres leg (`restore.rls.test.ts`, `useTemplateDb({ template: "manifest" })`) runs the
  happy path once on real PostgreSQL — the `greatest(...)` upsert, the partial unique index, the
  head reset — as the superuser-class role the production restore is.

**`apps/server`** (`restore.test.ts`, unit; fake modules, `openDb` and `migrate` seams):

- Order: migrate runs after `restoreDatabase` and before any hook; hooks run before
  `restoreSecrets`; `skipSecrets: true` runs neither hooks nor the identity read — proven with an
  artifact that carries **no** `trading.env` at all (delete the gate → red).
- A pre-existing `trading.env` on the target is set aside before anything irreversible: after a
  failing hook the box holds no `trading.env` and `trading.env.replaced` holds the old bytes; under
  `skipSecrets` the existing file is untouched (delete the set-aside → red).
- The hook receives `(tx, node)` with the ids parsed from the **artifact's** `trading.env`, not the
  target's (seed a different file in the target `stateDir` → the hook sees the artifact's).
- Two modules returning `series` → `restore.series_conflict`; `[]` → the transaction aborts with the
  no-standard code wrapped in `restore.hook_failed`; no module returning series while the restored
  node has no live standard series → the same refusal naming `core`; a returned code the node
  already holds → `series.code_collision` **after** the retire started, and the retire rolls back
  with it (a real PGlite transaction, not a fake).
- `series` present → the written `trading.env` differs from the artifact's in exactly
  `WAITRON_TILL_SERIES_ID`; absent and the artifact's id is the live standard one → byte-identical;
  absent but the artifact's id is not the live standard one → corrected.
- The CLI prints `restore.hook_failed` with the module and the inner code, and prints the §2
  operator precondition before restoring.
- Missing key → `restore.identity_incomplete`; unknown node → `restore.identity_unknown`; a hook
  `AppError` → `restore.hook_failed` with the inner code; the CLI reports each by code.

**`apps/server` real-Postgres e2e** (`restore-fiscal-e2e.rls.test.ts`, on the `rejoin-e2e` harness's
mechanics — real encrypted artifact, `docker exec pg_restore` runner, shipped orchestrator — but
into a **fresh** database created for the test as `pg-restore.test.ts` does, with a realistic
fixture: `W1`, the counter row seeded, a `trading.env` entry in the artifact):

- Seed tenant / node / till / series `FA` (`next_number` 5) / live SIF / one `registros_facturacion`
  row; back up; restore. Assert: the registro row is present **and immutable** (`UPDATE` rejected
  `WT001`, BR-3's receipt kept); the old SIF revoked, the new one live; `FA` retired, `FA-<n>` live
  with `next_number` 1; the test `stateDir`'s `trading.env` names the new series; the hook's
  `sync_log` rows carry `origin_id = nodeId` (delete `{ nodeId }` → all-zero → red); the migrated
  module versions equal the binary's (`schemaVersionsByModule`); a throwing second hook rolls the
  SIF and series back (real transaction, not a fake).
- **An older artifact** (a second baseline downgraded one core migration — `retired_at` dropped and
  the last journal row deleted — which the gate admits) is migrated before the hook runs and restores
  cleanly; with the migrate step stubbed out, the same artifact fails at the hook and leaves no
  `trading.env` — the receipt that migration is what makes the hook safe.
- **A failure after the fiscal hook minted and the series were retired** (the real hook's outcome
  replaced by a code the node already holds) rolls back the SIF row, the counter floor and the
  retire together, and writes no identity.
- **Negative control:** the same artifact restored with `skipSecrets: true` (the rejoin shape)
  leaves the SIF, series and `trading.env` untouched.
- The e2e connects as the shared container's superuser — the class the production restore role is
  (§5). It proves the privileged path; it does not, and this spec does not, claim an RLS receipt.

**`packages/core`**: `sale.series_retired` from each of the three write paths, by deleting the
predicate. **`packages/db`**: `readStandardSeriesId` ignores a retired standard series; loud on
two live ones (the guard is now reachable — drop its `v8 ignore`); `series.code_collision` on an
existing retired code.

**Root guards, run unfiltered before the PR:** `module-seams` (`restore.ts` gains no regime import —
it reaches the hook through the descriptor; `packages/db`'s series helpers are generic),
`english-only` (`packages/module/src/restore.ts` and the `packages/db` helpers are English; the
Spanish stays in the fiscal package — `report` strings included), `errors-reachable` (every new
code thrown from a file that imports its registry), `module-graph-honesty` (no new cross-set SQL
edge — the column is core's), `composition.test.ts` (the descriptor list is still manifest-exact),
and the fiscal package's `inmutabilidad` suite (a column on a `tenant_id` table; FORCE RLS
unchanged).

---

## 10. Invariants preserved (what the tests must show)

- **Never resume the dead chain.** `registerSif` resets `cadenas` to the both-null pointer
  (`resetChainHead`, `packages/fiscal-verifactu/src/registro-sif.ts`), so the first post-restore
  record is a first record under a new SIF. The restored local prefix ends at the backup's last
  record; AEAT holds the lost tail beyond it under the old SIF; neither is ever extended.
- **Installation numbers are never reused.** The restored counter is at least the backup's value;
  the floor (§3.5) puts every restore-minted number above anything a previous restore of an older
  artifact can have minted; `registro_sif_instalacion_uq` backstops the rows the dump holds.
- **Disjoint series.** `<base>-<n>` with the fresh installation number: distinct from every code the
  node used (the base rule strips only *our* suffixes; `series.code_collision` refuses the rest) and
  from every reserved standby's `<base>-<m>`, `m < floor ≤ n`. AEAT's `3000` is a backstop only when
  it reports the duplicate without state (§3.2); the local `registros_identidad_uq` is the other.
- **`registros_facturacion` immutable.** Untouched: the hook inserts a `registro_sif` row and
  updates `contadores_instalacion`, `cadenas` and `invoice_series`, all mutable by design.
- **Nothing external blocks a sale.** The hook runs offline: no AEAT call, no network.
- **One transaction for one logical change.** Hooks, series writes and the standard-series check
  share the orchestrator's `withTenant`; the secrets write is the one non-DB step, after the commit,
  with its window and failure mode stated (§5).
- **The generic core reaches into no module.** `restore.ts` iterates descriptors; the fiscal hook is
  wired in the composition list. The regime packages stay behind `module-seams`.
- **Our metadata stays out of the hash.** Nothing here touches `computeHuella` or `entorno`.

---

## 11. Receipts this change retires (edit in the same PR)

- `apps/server/src/restore.ts`: the `RestoreHookContext` header ("Deliberately NO database/chain
  handle … no business touching the fiscal chain"); `writeValidated`'s and `restoreFromArtifact`'s
  "mints NO fresh chain … no trade-readier"; `invokeRestoreHooks`'s "EMPTY in v1 … touches NO fiscal
  chain"; the `skipSecrets` field doc ("only the `restoreSecrets` write is elided" — now hooks too).
- `apps/server/src/rejoin.ts` and `rejoin-command.ts`: the same `skipSecrets` wording.
- `apps/server/src/restore-command.ts`: "the restore-hook seat is empty in v1 … nothing to narrow
  yet". (`modules: ALL_MODULES` stays; the reason changes: a hook must run for every module whose
  tables are in the backup, and the descriptor list is that set.)
- `packages/module/src/module.ts`: `restore?: unknown // seat — … body lands in BR-3/BR-4`.
- `packages/composition/src/modules.ts`: the header's "populated seats today" list and `core`'s
  "`restore` is a later slice's seat" note.
- `packages/db/src/reserved-identity.ts`: `readStandardSeriesId`'s "unreachable today" and its
  `v8 ignore`.
- `docs/superpowers/plans/2026-08-30-onboarding-slice4b-iii-cold-restore-runbook.md`: the "Known gap
  — the invoice SERIES is not freshened" block and the `register-till` step (the CLI now does both)
  — a dated pointer, not a rewrite. Its and the backup-restore regime §8's "backstopped by AEAT
  error `3000`" carry §3.2's overstatement — the same pointer.
- `docs/superpowers/specs/2026-09-04-backup-restore-regime-design.md` §7 BR-4 and §8 first bullet;
  `docs/superpowers/specs/2026-09-05-membership-rejoin-r3-wipe-and-restore-design.md` §4 step 6
  (rejoin now also skips hooks — dated pointer).
- `docs/backlog.md`: SP-3d / BR-4 rows; the "Cold-restore follow-up" note; promote-Slice-4's gate;
  a new line for the provisioning seed's all-zero sync origin (`venue-apply.ts` opens `withTenant`
  without `nodeId` — same class as Fable's Major 1, not this slice's fix).
- `CLAUDE.md` §5, "Re-registering a node starts a new chain": add that a cold restore does this
  automatically, floors the installation counter by the clock, and retires the node's series.
- `apps/server/src/restore.test.ts`'s "(v1: none in ALL_MODULES)" test title and its exact-context
  assertion.

---

## 12. Residuals, stated

- **A surviving peer's cursors.** If a mirror survived and the operator cold-restores anyway (§2),
  the mirror's `sync_cursor` for this origin is *ahead* of the restored `sync_log`; the restored
  node's new records reuse sequence numbers the mirror already consumed and are silently skipped
  until the sequence passes the old cursor (promotion-failover §6.2 condition 1, in reverse). Not
  new to this slice — true of BR-3 today — and the answer is the runbook's: promote the survivor. A
  guard would need the survivor to be reachable to be asked; not built.
- **Platform rebinding** (§2): connection strings and advertised origin in the restored
  `trading.env` are the dead cluster's. Promote-Slice-4's operator surface.
- **The secrets-write window and `writeFileAtomic`'s missing fsync** (§5): both close by resolving
  the box's series at boot (§3.4) or by fsync in `fs-atomic.ts`. Named for Track A, not built here.
- **The clock** (§3.5): a restore performed on a box whose clock is behind a previous restore's can
  re-mint. No monotonic state survives a rollback except the clock; accepted and stated.
- **`cadenas.secuencia` continues** across the SIF change (never reset — it is ours, and
  `registros_tenant_node_secuencia_uq` on `registros_facturacion` forbids a reset). Correct and
  unchanged; stated so nobody "fixes" it.

---

## 13. Interactions

- **BR-3 / R3 wipe-and-restore (#232, #237):** the shared `writeValidated` gains the migrate step,
  the identity gate and the reordering; the rejoin CLI's behaviour is unchanged except that it can
  no longer fire a module hook — which it never intended to (its spec §4 step 6: "the node keeps
  its own identity"). The migrate step does run for rejoin (it precedes the gate) — harmless, and
  boot would have done it.
- **SP-3c (#245):** the hook and `standby.reserve` share the live-series read and the identity-from-
  the-live-row shape; `fiscal-none` fills `backup.restore` with a hook that returns no `series` (or
  omits the seat).
- **Promote-action Slice 4:** its remaining work is the operator surface (§2's platform steps and an
  authenticated entry); the mechanism is this CLI.
- **Till-reroute S2 / boot:** R3b's promoted-not-yet-rebooted stale-series carry-in and this slice's
  fsync residual share one fix — series resolution at boot.
- **Reporting / month-end `consultar`:** unaffected; the lost tail's recovery is that subsystem's.

## 14. What this does not touch

`computeHuella`; `registros_facturacion` and its triggers; the AEAT transport; the backup producer
(manifest, archive, encryption, destinations); the compatibility gate and the traversal guard; the
provisioning runners; `nodes`, `node_membership`, `mirror_config`; the till and dashboard sale paths
beyond the one added guard.

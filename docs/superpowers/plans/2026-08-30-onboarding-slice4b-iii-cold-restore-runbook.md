# Cold-restore runbook — rebuild a single box after total loss (onboarding slice 4b-iii)

> **2026-09-06 (SP-3d):** This is the historical manual procedure. For an encrypted `.backup.enc`
> archive, use `waitron-restore restore <artifact-path>` into a fresh database before booting; it
> restores the database and media, migrates, opens a fresh chain and disjoint series, and writes
> `trading.env` last. Do not run step 3 after the CLI. Set the replacement box's connection strings
> and advertised origin before boot; the CLI preserves those artifact values. See the [SP-3d
> design](../specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md) §2 and §5. The manual steps
> below remain as history, not the current procedure.

> **This is an operator runbook, executed by a human at a terminal during a disaster.** It turns the
> approved design (`docs/superpowers/specs/2026-08-29-promotion-runbook-design.md` §5d) into a concrete
> step-by-step procedure against the tooling that is **actually built today** (4b-i recovery bundle
> #161, 4b-ii scheduled `pg_dump` backup #163). Read the whole thing before touching anything.

## When this applies

A single-box venue with **no hot-failover peer or mirror** has lost its only node — dead disk, theft,
fire, unbootable hardware. You are rebuilding onto new/reinstalled hardware from the two artifacts the
onboarding backup posture produces:

- the latest **`pg_dump` database backup** the scheduled backup worker wrote to the box's backup
  directory / attached storage (slice 4b-ii — `waitron-<timestamp>.dump`, custom format); and
- the **recovery bundle** the operator downloaded at claim time (slice 4b-i — the passphrase-encrypted
  `waitron-recovery-<date>.wrb`, holding the vault master key, the venue identity, and the box CA/leaf).

If a surviving peer or read-mirror exists, this is **not** your procedure — promote it instead
(promotion-runbook §5a–§5c). This runbook is the majority single-box case only.

## The one thing that must not go wrong — read this first

**Trading never blocks on filing or reconciliation** (the huella is a plain hash; there is no AEAT
filing deadline). So the goal is simple: get the box trading again. Data loss between the last backup
and the crash is **accepted**; being unable to trade is not.

**But there is exactly one unrecoverable mistake, and this runbook exists to prevent it: you must mint
a FRESH fiscal chain before the box makes a single sale, and must NEVER resume the old chain.**

Why: the restored database still contains the dead box's `registros_facturacion` / `cadenas` rows, so
the restored chain head carries the **old `huella`**. If the box trades before a fresh SIF is minted,
the fiscal write path (`packages/fiscal-verifactu/src/chain.ts`) reads that restored head and chains
the next record from the old huella — while AEAT already saw the records written after the last backup
chain from *that same huella*. That is a **fork**: two different records claiming the same predecessor.
It is the single unrecoverable Veri*Factu failure (CLAUDE.md §5, #33 §3), and it is exactly what the
tax agency's hash-chain verification is designed to detect.

**The box cannot detect this for you.** A normal restart also reads the existing chain head and
continues it — and that is correct. Software cannot tell "I was just restored from a backup and must
start a new chain" apart from "I rebooted and must keep my own chain going", because nothing in the
restored bytes distinguishes them. That is why minting the fresh SIF is a mandatory **operator** step
in this runbook and not an automatic guard — the ordering is enforced by you following these steps in
order, with step 3 as the point of no return.

## Procedure

### 0. Preconditions
- New/reinstalled hardware with the same Postgres major version as the backup (18+).
- The latest `waitron-<timestamp>.dump` from the backup directory (verify it is the newest and
  non-empty; a `.partial` file is an incomplete dump — never restore one).
- The recovery bundle `.wrb` and the passphrase you set when you downloaded it.
- The intended environment (`WAITRON_ENV`) — this **must** match the environment the dead box ran, and
  the restored `deployment.environment` stamp enforces it (step 2). A preproduction backup can never
  seed a production box, and vice-versa.

### 1. Restore the database
Create the target database and restore the custom-format dump into it (as the privileged role that
owns the tables — the same superuser/BYPASSRLS class the backup was taken with; a least-privileged
`app_user` restore cannot recreate the FORCE-RLS objects):

```
createdb waitron
pg_restore --no-owner --dbname="$WAITRON_ADMIN_DATABASE_URL" waitron-<timestamp>.dump
```

The dump includes `sync_log`, so subscriber cursors are exact if this box later re-enrols in
replication. (Note: `pg_dump` is a point-in-time snapshot — everything after the last completed dump
is lost. Finer-grained WAL/PITR restore, which would shrink that loss window, is a deferred richer
backup regime; §5d step 1 describes it, 4b-ii does not implement it.)

### 2. Restore the box secrets + pass the environment handshake
Unpack the recovery bundle into the box's state directory so the vault master key, the venue identity
(`trading.env`), and the box CA/leaf are back in place:

```
WAITRON_RECOVERY_PASSPHRASE=… waitron-recovery unpack waitron-recovery-<date>.wrb "$WAITRON_STATE_DIR"
```

Bring the box up far enough to run its boot deployment check. The boot-time deployment guard
(`apps/server/src/deployment-guard.ts`) refuses to proceed if the restored `deployment.environment`
stamp disagrees with the host's `WAITRON_ENV` — this is the environment handshake, and it is a
legitimate fence, not an obstacle: restore into the **same** environment the box ran in.

### 3. Mint a FRESH SIF — THE POINT OF NO RETURN

> **2026-09-06 (SP-3d):** `waitron-restore` now performs the fresh-chain step inside restore, floors
> the installation allocator by the clock, retires the old series and selects a fresh live series in
> `trading.env`. Do not follow it with `register-till`; see the [SP-3d
> design](../specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md) §3–§5.

Before the box serves a single sale, mint a new fiscal identity for the node. Use the standalone
**`register-till`** script — **not** the setup wizard. The wizard's `POST /setup-api/provision`
deliberately refuses on a restored database (`setup.already_provisioned` — the tenant already exists),
precisely so you cannot accidentally re-onboard on top of live fiscal data. `register-till` is the
sanctioned re-registration path and is unguarded by design (re-registering a reimaged node is its whole
purpose). It takes the restored node's own `tenantId` and `nodeId` (read them from the restored
`trading.env`: `WAITRON_TILL_TENANT_ID` / `WAITRON_TILL_NODE_ID`), and nothing else:

```
pnpm --filter @waitron/server build   # if restoring from source rather than a built image
DATABASE_URL=<box database connection> node apps/server/dist/register-till.js \
    <tenantId> <nodeId>
```

> **2026-09-06 (SP-3c):** `register-till` now takes two arguments — `<tenantId> <nodeId>` — and runs
> every module's seed; the software identifier is the fiscal package's own constant.

(The connection string is read only from `DATABASE_URL`, never passed as an argument, so it stays out
of shell history and process listings; the obligado's NIF is read from the tenant row, not supplied.)
This runs `provisionNode`, which runs every module's seed (the fiscal seed registers the SIF).

`registerSif` (`packages/fiscal-verifactu/src/registro-sif.ts`) revokes the restored node's live SIF,
mints a **fresh installation number** from the never-reused `contadores_instalacion` allocator, and
**resets the chain head** (`cadenas.ultimo_registro_id = NULL`, `ultima_huella = NULL`) — so the next
sale is a genuine first record of a new chain, not a continuation of the old one. The same NIF files
the new chain (the AEAT certificate is reused); the **installation number** and the **chain head** are
what `register-till` freshens.

**Once this step runs, you are committed:** a new chain now exists under this NIF. Do not run it twice
casually — each run mints yet another installation number and starts yet another chain.

> **Known gap — the invoice SERIES is not freshened, and today's tooling cannot freshen it.**
> `register-till` resets the hash chain and the installation number, which is what prevents the
> unrecoverable huella fork. It does **not** touch the invoice series or `invoice_series.next_number`:
> the restored `trading.env` keeps the old `WAITRON_TILL_SERIES_ID`, and `next_number` carries across
> in the dump (CLAUDE.md §5). The approved design (promotion-runbook §5d step 3;
> `2026-08-01-local-server-sif-and-failover-design.md` §12) calls for a **disjoint series** on a
> re-minted SIF, because AEAT's duplicate-detection identity is `(NIF, numSerieFactura,
> fechaExpedicionFactura, número)` — it does **not** include the installation number, so reusing the
> same series+NIF can re-issue an invoice identity the dead box already submitted for a lost-tail
> record. This is **not** the unrecoverable chain fork (that is fully prevented above); the blast radius
> is an invoice-number **collision** for records the dead box issued after the last backup, backstopped
> by AEAT's own duplicate handling (error `3000`). But it is a real gap: minting a disjoint series on
> cold-restore is **not yet supported by `register-till`**, and the wizard path that would mint one
> (`applyVenue`) is blocked by `setup.already_provisioned`. Until that gap is closed, treat any
> same-day post-backup invoices as at risk of a number collision and reconcile them at month-end
> alongside the lost tail (step 6). *(Backlog follow-up: a disjoint-series option for the cold-restore
> re-registration path.)*

> **2026-09-06 (SP-3d):** The gap above is closed by `waitron-restore` on this branch. Its statement
> that error `3000` backstops collisions overstates the protection: our parser maps a duplicate
> reported as `Correcta` to accepted without comparing the hash. Fresh, disjoint series prevent
> reusing that invoice identity; see the [SP-3d
> design](../specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md) §3.2 and the code
> references there.

### 4. Unlock the key ring (only if you set a boot passphrase)
If the box was configured with an optional boot passphrase, enter it now so the vault unseals and the
node can file its new chain. **If the passphrase is lost, skip this step** — the box still trades
(step 5); filing simply waits until a cert is re-provisioned. Filing is never on the critical path to
trading.

### 5. Go live
A sole node with zero configured peers self-assumes `(mode, singleton_role) = (primary, primary)`
(#158). The only preconditions to trading are: a successful restore (step 1), a passed environment
handshake (step 2), and a minted fresh SIF (step 3). Nothing waits on reconciliation or on a human
decision about the lost data. **Start trading.**

### 6. Reconcile the lost tail at month-end (not a gate on going live)
The records the dead box **submitted** to AEAT after the last backup are recoverable into the reporting
view later, via a Veri*Factu `consultar` query against the tax agency (lifecycle §5.2). The
irreducible gap — records that were both un-submitted **and** un-replicated when the box died — survives
only as the customer's paper factura. This reconciliation belongs to the reporting/close subsystem and
is **future work**; it is explicitly **not** a precondition for trading and must never delay step 5.

## What this runbook deliberately does NOT do

- **It does not resume the old chain.** Same-series resume is safe only when data loss is provably zero
  (a synchronous-replication guarantee this single-box posture does not have); with an async snapshot
  backup, resuming is the fork above. Never do it here.
- **It does not gate trading on the backup being fresh, on filing, or on reconciliation.** A till that
  cannot sell is a shop that cannot trade.
- **It is not a factory reset, and the (design-only) disposal guard does not apply.** The disposal
  guard (promotion-failover-and-node-lifecycle design §5.1) governs *voluntary* retirement of a box
  whose data must first fully replicate elsewhere — "discard the box, not sell the shop." Cold recovery
  is the opposite verb: the box is already destroyed, there is nothing to replicate first, and recovery
  must be **unblocked**. Do not let a future disposal check stand in the way of this procedure.

## Provenance

- Design: `docs/superpowers/specs/2026-08-29-promotion-runbook-design.md` §5d (the six-step sequence),
  §7 (the point-of-no-return), §8 (a cold-restore e2e test — planned, not yet built).
- Fresh-chain mechanism: `registro-sif.ts` `registerSif` / `mintNumeroInstalacion`;
  `provision-till.ts` `provisionNode`; the `register-till` script (`node apps/server/dist/register-till.js`).
- Fork hazard: `chain.ts` `lockChainHead` continues from the restored `ultima_huella`; CLAUDE.md §5.
- Tooling: recovery bundle `waitron-recovery unpack` (#161); scheduled `pg_dump` backup (#163).

# Backup & restore regime — architecture design

**Date:** 2026-09-04
**Status:** architecture design. **Owner-reviewed:** the decisions in §3 were taken with the owner on
2026-09-04, in the session that traced the existing partial backup subsystem and scoped the regime.

**What this is.** A top-level design for a **generic core backup-and-restore subsystem** — a sibling to
`@waitron/sync` and `@waitron/migrations` that imports no domain — which captures a box's full state into
encrypted artifacts, fans them out to pluggable storage destinations, and restores them onto a fresh box.
It has two extension points: **`StorageBackend` plugins** decide *where* artifacts land, and a **`backup`
contribution on the module contract** lets each module declare *what extra* state it owns and *how* it
reintegrates on restore. This document fixes the contract, the interfaces, the data-flow rules, and the
decomposition. Each sub-project below gets its **own** spec → plan → build; this is the shared frame they
argue from, not itself an implementation plan.

**How we got here.** Backup is **not greenfield** — a partial subsystem already exists, and the regime
grows it rather than replacing it:

- **A scheduled DB dump** (`apps/server/src/backup-config.ts`, "slice 4b-ii"). Opt-in and fail-closed:
  `WAITRON_BACKUP_DIR` is the off-switch, `WAITRON_BACKUP_DATABASE_URL` is the privileged connection
  `pg_dump` runs over, plus interval / retain / stale-after. It writes timestamped dumps to **one local
  directory** and prunes to a retain count.
- **A fiscal-completeness probe** (`apps/server/src/backup-probe.ts`). It refuses to enable scheduled
  backup unless the backup role can read the FORCE-RLS fiscal tables — under `pg_dump`'s default
  `row_security = off` a fenced role's dump ERRORS loudly, and the alternative would be a silently
  per-tenant-truncated fiscal dump. Turns a recurring per-run failure into one boot-time cause
  (`backup.role_rls_fenced`).
- **A secrets/recovery bundle** (`apps/server/src/recovery-bundle.ts`, `collectStateSecrets` +
  `encryptBundle`). Packs the box's sealed on-box secret files into a passphrase-encrypted envelope,
  because the **box key cannot decrypt them after a re-image** — the exact disaster-recovery case.

What is **missing**, and what this regime is about: there is no restore side at all (the `pg_restore`
consumer that R3 rejoin and promote-Slice-4 are gated on); no storage-media plugins (it is one local
dir, no offsite); no module-system integration (today's dump is a monolithic whole-DB `pg_dump` that
knows nothing of modules); no `sync_log`-in-backup; and none of the media blob store (below).

---

## 1. The current reality this must fit (grounded, not aspirational)

A box holds **three separate state stores**, and today's `pg_dump` covers only the first.

1. **The database.** Rows, captured by `pg_dump` over the privileged connection. Note that a product's
   photo is a **path reference only** — `products.image` holds a content-addressed `<sha256>.<ext>`
   filename, "never bytes" (`packages/db/src/schema/catalogue.ts:106-111`). So the database dump records
   *which* image each product uses but not the image itself.

2. **The media blob store.** A **content-addressed filesystem store** at `config.mediaDir` (default
   `<dist>/media`, overridable by `WAITRON_MEDIA_DIR`, set explicitly to a persistent path by deployment;
   `apps/server/src/boot.ts:185-186,1005`). Uploads are written as `<sha256>.<ext>`
   (`apps/server/src/catalogue-api.ts:864-865`) and served at `/media/<image>`
   (`apps/server/src/media-api.ts`). A DB dump alone restores a menu whose every image is broken.

3. **On-box secrets & config.** The `config.stateDir` tree — sealed credentials (AEAT cert, mirror
   tokens, box keys), `trading.env`, `modules.json`. Already collected by
   `collectStateSecrets(stateDir)` and encryptable under a passphrase (`recovery-bundle.ts`).

The media store maps cleanly onto the module model: the **catalogue domain owns the media store** and
declares it as non-DB backup state — the same shape as fiscal owning the AEAT cert. Content-addressing is
a gift for the deferred incremental path (§4): blobs are immutable and dedupable, so a store is naturally
a set you only ever add to, and restore is set-reconciliation.

---

## 2. Scope

**Build now: the generic backup/restore mechanism, complete for the box's own state, with the module and
storage seams in place — but not the fiscal fresh-chain reintegration.** Concretely: pluggable storage
with fan-out, recovery-key encryption, the manifest, a `backup` contribution kind on the module contract,
the media + secrets capture, and a restore-from-artifact consumer that fully unblocks **R3 rejoin**. The
fiscal-specific reintegration (mint a fresh chain, disjoint series, never resume the old chain) ships as
a **module `restore` hook whose interface exists in v1 but whose body lands with fiscal-as-a-module**
(module-system SP-3), which is where promote-Slice-4 cold-DR is unblocked.

**Deferred, named not gated (§7):** the fiscal `restore` hook body; incremental backups (v1 is full
snapshots); offsite `StorageBackend` implementations beyond the local filesystem.

---

## 3. Decisions (owner, 2026-09-04)

Each was a fork put to the owner this session.

1. **Backup unit = whole-DB snapshot + per-module hooks**, not per-module logical backup. One physical
   whole-database backup (grows today's `pg_dump`); modules contribute only (i) non-DB state they own and
   (ii) a post-restore reintegration hook. A per-backup **manifest** records which modules and schema
   versions the backup contains so restore can refuse an incompatible target. One consistent snapshot; no
   partial restore.

2. **Restore mechanism now; fiscal fresh-chain deferred to the fiscal module's hook.** The generic
   restore-from-artifact path is built here and unblocks R3 rejoin (restore + `sync_log` drain, returns
   **fenced-secondary** per R1 #214, **no new chain**). The trade-again-as-primary fresh-chain / disjoint-
   series reintegration is the fiscal module's contributed `restore` hook (§7), keeping the unrepairable-
   core work behind the module seam so **nothing owner-gated lands in this chunk**.

3. **Incremental = a designed seam, full snapshots in v1.** The artifact + manifest model is shaped so a
   backup *can* later be a base plus an ordered chain of `sync_log` deltas (`manifest.baseRef`), and a
   storage plugin can opt into incremental transport — but v1 ships full snapshots (one artifact = one
   full DB), keeping restore dead-simple. Built when offsite cost or backup frequency demands it.

4. **Fan-out to all configured destinations** (the 3-2-1 rule), not a single active destination. Each
   backup artifact is written to every configured `StorageBackend` at once; a dead box still has offsite
   copies. A per-destination success/freshness signal feeds `/health`.

5. **Encrypt every artifact under an operator recovery key**, derived from a passphrase / printed
   recovery key — **not the box key**. Forced by the DR case: a box-key-encrypted backup is unrecoverable
   after the box dies. Reuses the existing `encryptBundle` cipher and passphrase model. Storage backends
   may add their own at-rest encryption on top (additive, free); this recovery-key layer is the floor, so
   offsite storage only ever sees ciphertext.

6. **Backup is a generic core service; modules declare their needs via a new `backup` contribution kind
   on the module contract** (module-system option A), not via a standalone backup-owned registry. This is
   exactly the "the contribution set is open" extension the module-system architecture anticipates
   (2026-09-04-module-system-architecture-design.md §3). The generic subsystem still owns the box-level
   concerns (the DB dump and the `stateDir` secrets) directly; the registry adds only module-owned extras.

---

## 4. Components & interfaces

### `StorageBackend` — the storage-media plugin

```ts
interface StorageBackend {
  readonly id: string;                                   // "local-fs", "s3", "sftp"
  put(key: string, bytes: Uint8Array | Readable): Promise<void>;
  get(key: string): Promise<Readable>;
  list(prefix: string): Promise<StoredObject[]>;         // { key, size, mtime }
  delete(key: string): Promise<void>;
}
```

v1 ships **`LocalFsBackend`**, wrapping today's `WAITRON_BACKUP_DIR` write-and-prune. S3 / SFTP / cloud
are later backends behind the same interface — no core change. Backends are configured on-box and are
**plugins to the backup subsystem, not Waitron domain modules**. The orchestrator fans out to all
configured backends (decision 4). Artifact keys are stable paths, e.g.
`<tenant>/<timestamp>/db.dump.enc`, `<tenant>/<timestamp>/manifest.json`, `<tenant>/blobs/<sha256>`.

### `backup` — the new module contribution kind

Grouped as a **single contribution key** on the descriptor — `backup?: BackupContribution` — so the
descriptor's top level stays a list of contribution kinds (matching how the module-system architecture
§3 frames sync / UI / vocabulary / theme, each as one declared contribution). Shape coordinated with the
module-system session, 2026-09-05.

```ts
interface WaitronModule {
  // ...existing contribution kinds (schema, sync, ui, vocabulary, theme, privileges, cronjobs, ...)
  backup?: BackupContribution;
}

interface BackupContribution {
  // Declaration-only DATA: the extra state this module owns, as path/handle descriptors the
  // orchestrator resolves — NOT a closure the generic core invokes. Assembled by the composition
  // root (which holds config) at registration, e.g. catalogue -> { kind: "blob-dir", path: mediaDir }.
  nonDbState?: BackupSource[];
  // A callable RESTORE hook the module's OWN package exports and the composition root wires when the
  // module is enabled (the same pattern as the provisioning-seed / runtime-wiring contributions) —
  // never behaviour the generic core reaches into. fiscal -> fresh chain (body deferred, BR-4).
  restore?: (ctx: RestoreContext) => Promise<void>;
}
```

`core` declares the media store as `nonDbState` **data** (catalogue is still `core`-resident, so it is
registered in the composition root the same way `core` declares its own sync enrolment; the root supplies
the config-resolved `mediaDir`). `fiscal`'s package **exports** the `restore` hook the root wires. **In v1
the hook interface ships but fiscal's body does not** — that is the deferred fiscal slice.

Two shape choices, both to keep the descriptor guard-friendly: `nonDbState` is **pure data** (paths /
handles) rather than a closure, so the descriptor stays declarative; `restore` is a **module-exported,
root-wired hook**, so the generic core reaches into no module and stays domain-free.

### The manifest

Written with every backup and read first on restore:

```jsonc
{
  "createdAt": "...", "tenantId": "...", "environment": "preproduction" | "production",
  "modules": { "core": "<schemaVersion>", "fiscal": "<schemaVersion>", ... },
  "artifacts": [ { "kind": "db-dump" | "blobs" | "secrets", "key": "...", "sha256": "...", "bytes": 0 } ],
  "encryption": { "kdf": "...", "params": { } },   // parameters only, never the key or secret
  "baseRef": null                                    // incremental seam (§3 decision 3)
}
```

Restore refuses an incompatible target: a module set the target does not run, a schema version **newer**
than the target has migrated (the same anti-silent-corruption stance as the module-system schema-version
gate), or an `environment` mismatch (the one-DB-per-environment invariant, §6).

### The orchestrator

Grows today's scheduler backup duty. Each run: dump the DB over the privileged connection (RLS probe
already guards completeness) → collect module non-DB state (media blobs) → collect `stateDir` secrets →
encrypt each artifact under the recovery key → write the manifest → fan out every artifact to every
backend → prune per `retain` → report per-destination freshness to `/health`.

### The restore consumer (new)

Read + verify the manifest → compatibility gate → decrypt → `pg_restore` into the fresh database →
restore blobs into `mediaDir` → restore secrets into `stateDir` → run each enabled module's `restore`
hook. Exposed as a CLI verb and as the programmatic entry that R3 rejoin and the onboarding/adopt paths
call.

---

## 5. Data flow & the rules that keep it correct

- **Backup order: dump the DB first, then sweep media.** Media is captured as a **superset** of what the
  dump references, so every `products.image` reference in the dump has its blob. A blob with no reference
  is a harmless GC-able orphan; a reference with no blob is a broken image. Secrets are independent.
- **`sync_log` rides inside the DB dump for free** (it is a table), so R3 rejoin gets its drain tail with
  no extra artifact.
- **Restore order:** DB → blobs → secrets → module `restore` hooks.
- **Each artifact is encrypted independently** under the recovery key, so a later incremental delta or a
  newly-added blob can be written without re-encrypting the base.
- **R3 rejoin** = restore + the caller drains `sync_log`; the node returns **fenced-secondary** (R1 #214),
  **no new chain**. **Cold-DR-as-primary** is the fiscal `restore` hook's fresh-chain job — deferred (§7).

---

## 6. Invariants preserved (receipts)

- **Fiscal immutability untouched.** Restore never resurrects or mutates the immutable ledger to "resume"
  an old chain: a box restored to trade again as a primary mints a **fresh** chain (the cold-recovery
  posture — data loss accepted, month-end AEAT `consultar` reconciles), and that minting is the fiscal
  module's own `restore` hook (§7), not core's business. The append-only / FORCE-RLS / TRUNCATE guards on
  the restored tables are unchanged.
- **One database per environment.** The manifest carries `environment`, and restore refuses to load a
  `preproduction` backup onto a `production` target or vice versa — the invariant Veri*Factu exists to
  detect, enforced at the restore boundary.
- **The RLS-fenced probe stays.** `backup-probe.ts`'s `backup.role_rls_fenced` guard is retained so a
  fenced backup role can never ship a silently-truncated fiscal dump.
- **The generic packages stay English.** The subsystem is generic core, imports no domain, and holds
  no Spanish vocabulary; the module-owned Spanish state (fiscal's cert, its restore hook) lives in the
  exempt module + composition root — no new whole-package english-only exemption.
- **Reuse over reinvention.** Encryption reuses `encryptBundle`; secrets capture reuses
  `collectStateSecrets`; the scheduled duty and its config grow rather than being replaced.

---

## 7. Decomposition and build order

Each is its own spec → plan → build → PR. Build order BR-1 → BR-2 → BR-3, each landing standalone value.

- **BR-1 — Storage abstraction + fan-out + encryption.** Extract today's local-dir write behind
  `StorageBackend`; add multi-destination fan-out; add recovery-key encryption of artifacts; per-
  destination `/health` freshness. Ships `LocalFsBackend` only. *Value: encrypted, multi-destination
  backups. No restore, no module contributions yet.*
- **BR-2 — Manifest + module `backup` contribution.** Add the `backup` kind to the module contract;
  capture media (core's `nonDbState`) + `stateDir` secrets into the backup; write the manifest. *Value: a
  backup becomes complete (DB + media + secrets), not DB-only.*
- **BR-3 — The restore consumer.** `pg_restore` + blob/secret restore + the compatibility gate + the
  (empty-body) module restore-hook invocation. **Unblocks R3 rejoin — the named gate clears here.**
- **BR-4 — Fiscal restore hook (fresh-chain).** Lands with fiscal-as-a-module (module-system SP-3);
  unblocks promote-Slice-4 cold-DR. Owner-gated (H2); the hook interface already exists from BR-2.

---

## 8. Out of scope (named, not gated)

- **The fiscal `restore` hook body** — fresh chain + disjoint series (see the cold-restore follow-up in
  `docs/backlog.md`: `registerSif` does not freshen the invoice **series**, and AEAT dedups on
  `(NIF, series, date, número)`, so a same-day post-backup number collision needs a **disjoint-series
  option** on the re-registration path, backstopped by AEAT error `3000`). Delivered in BR-4 / with SP-3.
- **Incremental backups** — base + `sync_log` deltas; content-addressed blobs are already dedupable. The
  artifact model and `manifest.baseRef` keep it open; v1 is full snapshots.
- **Offsite `StorageBackend` implementations** — S3 / object-store / SFTP / cloud. The interface ships;
  `LocalFsBackend` is the v1 implementation. One real offsite backend is a clean fast-follow on BR-1.
- **Point-in-time / operator config rollback** (menu wiped, catalogue half-deleted) — a distinct restore
  scenario; the fiscal chain cannot roll backward, so this is a later, config-scoped design.

---

## 9. Interactions

- **Module system** (coordinated with that session, 2026-09-05) — SP-1a's `WaitronModule` contract exists
  (landed #212); BR-2 adds a `backup` contribution kind, **additive** to SP-2's sync-enrolment kind with
  no collision by the §3 open-set rule. **SP-1d never touches the descriptor** (config parsing + adopt
  bootstrap only). **The one thing to sequence around is package-ownership, not the field:** SP-2 moves
  descriptors out of the centralized `ALL_MODULES` (`apps/server/src/modules.ts`) into each package. If
  BR-2 lands **before** SP-2, the `backup` fields sit on the centralized descriptors and SP-2 carries them
  into the packages as part of the move; if **after**, BR-2 adds them per-package. Whoever lands second
  carries the other's fields across — flag it in the PR. BR-2 is gated behind BR-1 and SP-2 is unstarted,
  so there is runway either way.
- **Membership rejoin R3 (wipe-and-restore)** — BR-3 is its `pg_restore` consumer + `sync_log`-in-backup
  dependency; R3 restores then drains, returning fenced-secondary (R1 #214 already landed).
- **Promote-action Slice 4 (cold restore)** — unblocked by BR-4 (the fiscal fresh-chain hook), not BR-3.
- **Cloud mirror / sync** — the mirror already consumes the `sync_log` stream continuously, so
  "incremental offsite" largely *is* the mirror; the backup regime's non-overlapping job is cold,
  restorable point-in-time artifacts the live mirror is not.
- **Docs** — `docs/backlog.md`'s Track-2 "Ready to build now" and SIF-topology menus gain a
  backup-restore row at BR-1 land; the cold-restore follow-up note is subsumed by BR-4.

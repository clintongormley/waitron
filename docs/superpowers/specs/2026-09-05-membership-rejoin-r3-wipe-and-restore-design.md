# Membership Rejoin R3 — wipe-and-restore (rejoin-as-secondary)

**Status:** design. **Owner-reviewed:** yes — the central decisions below were taken with the owner
on 2026-09-05, in the session after BR-3 (#232) landed the restore consumer.

**Refines** [membership-and-rejoin-wire-protocol](2026-09-02-membership-and-rejoin-wire-protocol-design.md)
**§6 step 4** ("rebuild from the primary's baseline") and **§7** (the returning node adopts the
primary's config wholesale in the restore). That spec settled the *sequence* — drain to completion,
then wipe-and-restore; this doc settles the *mechanism* now that the pieces it composes have all
landed: the restore consumer (BR-3 #232), the fence (R1 #214), and the drain / disposal guard
(R2 #219). It is the last slice of the Slice 6 rejoin arc, which is otherwise complete (fence,
drain, retire/evict, conflict surface).

---

## 1. What this is, in one paragraph

A box that was the old **serving-primary**, got partitioned, was superseded by a promoted successor,
and has now come back must rejoin as a **secondary** rather than resume as primary. It boots **fenced**
(R1): `sell-only`, singleton duties suppressed, all write verbs 403. Its own un-replicated tail then
**drains** to the current primary (R2): the primary pulls `origin = <returned node>` until the disposal
guard reports `drained`. Only then does this slice run: the returning node **discards its diverged
database, restores the current primary's baseline, and comes back up still fenced but now streaming the
primary's log as a clean subscriber**. The rows it drained in R2 come *back down* inside the restored
baseline (as returned-node-origin rows), so nothing the drain protected is lost by the wipe
(wire-protocol §6 step 4).

## 2. What this slice does NOT do (scope fence)

- **It does not un-fence the node to `serving-secondary`.** The end state is a *restored, re-streaming,
  still-`sell-only`* node. Re-admission (the `sell-only → serving-secondary` transition that makes the
  box sell again) is a **separate, primary-minted slice**: there is no `sell-only → serving-secondary`
  producer today (`@waitron/membership` mints only `nextStandings` — self-promote to primary — and
  `evictNode` — self-demote to evicted), and the parent's **demote-never-promote asymmetry** (§5,
  witness safety) forbids a node from promoting *its own* standing. Only the serving-primary may mint
  that document. Deferred deliberately; the wire-protocol §6's "returns as serving-secondary" is the
  *arc's* end state, reached by this slice **plus** that later re-admission.
- **It does not fetch the baseline over the wire.** The operator supplies the primary's encrypted
  backup artifact and its recovery key. Network storage backends are a named BR-1 deferral; the backup
  regime is `LocalFsBackend`-only today, and this is a human-in-the-loop recovery action.
- **It does not touch the fiscal chain's completeness itself** — see §5. Fiscal safety is delegated
  entirely to the drain guarantee.

## 3. The decisions (owner, 2026-09-05)

1. **End state = restored + re-streaming, still fenced.** (Smallest safe cut; re-admission is its own
   slice — §2.)
2. **Operator CLI, operator-supplied artifact.** A new verb sibling to BR-3's `restore`
   ([`restore-command.ts`](../../../apps/server/src/restore-command.ts) / `bin-restore.ts`) and the
   decommission CLI (`bin-sync-evict.ts`). URLs and the recovery key arrive by **env**, never argv (the
   BR-3 Critical: a leaked admin password in the process table).
3. **Wipe = `DROP DATABASE` + `CREATE DATABASE`** over a privileged maintenance connection, handing
   BR-3's restore the *fresh* DB it already expects. (The DROP/wipe primitive was an explicit BR-3
   carry-forward — BR-3 targets a fresh DB and does not create one.)
4. **Fiscal safety is the drain guarantee, with no extra R3 machinery** — see §5.

## 4. The flow — an ordered guard ladder, then the destructive part

`rejoinAsSecondary` refuses **loud, before anything irreversible**, in the same discipline
[`retire.ts`](../../../apps/server/src/retire.ts) uses for its eviction ladder. The guards, in order:

1. **`rejoin.not_fenced`** — refuse unless this node's own standing in its held `node_membership`
   document is fenced (`isFencedStanding`, i.e. `sell-only` | `evicted`). A *serving* node must never be
   wiped. (`standingOf` / `isFencedStanding`,
   [`packages/membership/src/fence.ts`](../../../packages/membership/src/fence.ts).)
2. **`rejoin.no_carrier`** — refuse if the held chart names no serving-primary (`servingPrimaryNodeId`
   returns `undefined`): with no carrier there is no one the tail could have drained *to*.
3. **`rejoin.not_drained`** — reuse R2's disposal guard
   ([`readDrainProgress`, `packages/sync/src/disposal.ts`](../../../packages/sync/src/disposal.ts)) and
   refuse unless `drained` is `true`. This is the whole of the safety gate — **§5**.

**Why there is no `carrier_changed` guard here (unlike `retire.ts`).** `retire.ts` carries a
`node.retire_carrier_changed` guard because its drain reader is bound at **boot** and re-checked at
**request** time — a fenced node does not restart on a carrier change, so the boot-bound reader could
measure against a stale carrier by the time the request arrives (the I1 whole-branch-review fact). R3
has no such gap: the CLI reads the held document **once** and threads that **same** document into both
consumers — it keys `readDrainProgress` on the carrier derived from it, and passes the document itself
into `rejoinAsSecondary` as `deps.held` for the standing guards (which no longer re-read
`node_membership`). One read, two consumers, so no membership rewrite can slip between them and leave
the drain reader keyed on an old carrier while the guards see a new one. A `carrier_changed` code here
would be **unreachable** — dead
code the repo's error-reachability discipline forbids — so it is deliberately omitted. The staleness it
guards against is instead closed by the node having rebooted into the fence after the failover (R1),
which is what produced the held document the CLI reads. (`readDrainProgress`'s carrier-cursor keying
still relies on the house `subscriberId === nodeId` convention documented in `boot.ts`; a violation is
fail-safe — a false `drained:false`, never a false `drained:true`.)

Only past the ladder:

4. **Wipe** — `dropAndCreateDatabase({ maintenanceUrl, dbName })`: `DROP DATABASE <db> WITH (FORCE)`
   (terminate any lingering backend) then `CREATE DATABASE <db>`, both identifier-quoted with
   `quoteIdent` ([`packages/provisioning/src/identifiers.ts`](../../../packages/provisioning/src/identifiers.ts)) —
   utility statements take no placeholders (CLAUDE.md §3), so the DB name reaches the statement as
   escaped text.
6. **Restore** — run BR-3's orchestrator against the fresh DB, **skipping secrets** so the node keeps
   its **own** identity (its `stateDir` secrets — identity keypair, box key — are untouched; the
   restored DB is the *primary's*, its secrets are not). The mechanism is a **one-field extension** to
   BR-3's `restoreFromArtifact`: a `skipSecrets?: boolean` (default `false`) that guards the single
   `restoreSecrets` call ([`restore.ts:163`](../../../apps/server/src/restore.ts)); R3 passes `true`.
   This is deliberately **not** "R3 hand-calls the composable `restoreDatabase`/`restoreMedia` steps" —
   those steps do **not** include the decrypt/unpack, the **compatibility gate**, or the **all-entries
   traversal guard** (the security-critical pass that runs before any write); reimplementing that in R3
   would duplicate exactly the code that must never drift. R3 reuses the orchestrator's single up-front
   pass and only elides the secrets write. (BR-3 already exposes the composable steps and its
   `restoreSecrets` header notes "R3 … SKIPS this step"; the `skipSecrets` flag is the cleaner
   realisation of that intent, keeping the gate + guard as one source of truth.)

   > **2026-09-06 (SP-3d):** `skipSecrets` also skips setting aside the existing identity and
   > running module restore hooks. The shared write phase migrates the restored database before
   > returning; rejoin still keeps its own identity. See the [SP-3d
   > design](2026-09-06-module-sp3d-fiscal-restore-hook-design.md) §3.3 and §5.

5. **Finish** — clean the staging dump (whether or not restore succeeded — it holds whole-DB
   plaintext), then instruct the operator to restart the node. On reboot the node reads its held
   membership document, finds itself still `sell-only`, and **fences again (R1)** — but now over the
   primary's clean baseline, pulling the primary's log as an ordinary subscriber
   (`subscriber = self, origin = primary`).

**Atomicity, stated honestly (CLAUDE.md §3 convention).** This is deliberately **not** one transaction —
a `DROP DATABASE` cannot live inside one, and the media/secrets writes are filesystem steps. A failure
after the wipe leaves the box wiped-but-not-restored, and this does **not** self-recover on a re-run:
the guards read `node_membership` from the SAME database the wipe destroys, so a re-run of `waitron-rejoin`
fails at connect (if the `CREATE DATABASE` never ran) or at `rejoin.not_fenced` (against the emptied db,
which holds no membership). No data is lost — the drained tail is safe on the carrier and the artifact is
unchanged — but an operator must complete the restore into the emptied database by hand. An automatic
resume-at-restore (detect an emptied/wiped target and skip straight to restore) is a possible follow-up,
deferred because distinguishing a wiped-mid-restore box from a never-provisioned one needs a persisted
marker (owner's call at sign-off). This shares `adoptFromPrimary`'s documented multi-step, non-atomic
posture ([`apps/server/src/adopt.ts`](../../../apps/server/src/adopt.ts)) and is called out in the
orchestrator's own header.

## 5. Fiscal safety — delegated to the drain, no R3 machinery

The returning node was primary, so during the partition it filed sales under its **own** fiscal chain
(`registros_facturacion`, its own SIF, disjoint series). Wiping the database destroys that chain, so
its safety must be established *before* the wipe.

The safety is **the drain guarantee, and nothing else**: the returning node's records are safe once the
current primary holds them. That is precisely what guard #4 (`rejoin.not_drained`) asserts — the primary
has caught up on every lane the returning node carries. The new primary then owns onward submission to
AEAT. R3 needs **no** AEAT-outbox check, no fiscal safety-dump, no separate fiscal gate: draining
old-primary → new-primary *is* the mechanism (owner, 2026-09-05).

**Known gap, named honestly, not coded around.** The fiscal chain does **not** replicate *yet*:
`registros_facturacion` carries only its immutability and block-truncate triggers — **no sync capture
trigger** — and it is enrolled in no sync lane, so R2's disposal guard says nothing about it today.
Fiscal-record sync (**H2 = module-system SP-3**, in flight on `feat/h2-fiscal-record-sync` /
`feat/module-sp3a-fiscal-record-lane`) is what enrols it.

The seam is designed so this closes **with zero R3 change**: the disposal guard is already
**lane-agnostic** — it ANDs `drained` across `SYNC_LANES` (R2), so the day SP-3 adds a fiscal lane,
guard #4 automatically begins requiring the fiscal tail to have drained too, and R3 becomes fully
fiscally safe on its own. Until then R3 correctly protects the non-fiscal data and simply does not
protect a fiscal chain that does not move — **harmless pre-production** (nothing is deployed, no real
fiscal data exists; CLAUDE.md §3). We accept R3 being briefly not-fully-safe rather than build a
fail-closed tripwire to enforce an ordering pre-production does not need (owner, 2026-09-05). The
**fiscal-adjacent → owner sign-off before land** flag on this slice stays; do not self-land.

## 6. Components

- **`apps/server/src/rejoin.ts`** — `rejoinAsSecondary(deps)`: the guard ladder (§4 1–3) then the
  destructive composition (§4 4–5). Injected `readDrainProgress` (carrier-keyed) and
  `dropAndCreateDatabase`, plus the BR-3 restore inputs (artifact, recovery key, target DB URL, media /
  state / staging dirs, module list, environment). Registers `rejoin.*` on the shared registry via
  `import "./errors.js"`.
- **`apps/server/src/db-wipe.ts`** — `dropAndCreateDatabase`: its own small unit (single
  responsibility), `quoteIdent`-escaped, over the maintenance connection.
- **`apps/server/src/rejoin-command.ts`** + **`bin-rejoin.ts`** — the operator CLI, env-driven
  (`WAITRON_RESTORE_DATABASE_URL` for the target, a maintenance URL for the wipe, the recovery key, the
  artifact path), fail-closed on empty values (`isUnset`, the BR-3 pattern). URLs/keys never in argv.
- **`apps/server/src/errors.ts`** — new `rejoin.not_fenced` / `rejoin.no_carrier` /
  `rejoin.not_drained` (no `carrier_changed` — §4). Domain-concept names (CLAUDE.md §3); grep the
  `node.retire_*` siblings for the shape (`retire.ts` uses `node.retire_no_carrier` /
  `node.retire_not_fenced` / `node.retire_not_drained`) and stay consistent with them.
- **Reused unchanged:** `@waitron/membership` (`isFencedStanding`, `servingPrimaryNodeId`, `standingOf`);
  `@waitron/sync` (`readDrainProgress`, `DrainProgress`); BR-3's `restoreDatabase` / `restoreMedia` and
  the entry-guard / compatibility-gate (`restore.ts`, `restore-gate.ts`, `restore-entry-guard.ts`).

## 7. Testing

- **Guard ladder** — unit tests, each guard **proven by deletion**: remove the check, confirm the test
  fails, restore it (CLAUDE.md §4). Cover each `rejoin.*` code and the pass-through case.
- **`db-wipe`** — **real Postgres** (Testcontainers, `describeEachTarget` is inapplicable — PGlite is a
  single superuser backend and cannot `DROP DATABASE` the connected DB): create a DB with data, wipe it,
  assert it is empty and re-usable; assert `WITH (FORCE)` terminates a live backend.
- **End-to-end** — real PG: build a "diverged" DB + a baseline artifact from BR-3's fixtures, run
  `rejoinAsSecondary`, assert the DB now matches the baseline, media restored, **`stateDir` secrets
  untouched** (own identity preserved — the point of skipping `restoreSecrets`), staging cleaned even on
  a forced restore failure.
- **Fiscal immutability survives the round-trip** — the BR-3 receipt shape, re-pinned here: a
  `registros_facturacion` row present in the restored baseline rejects a post-restore `UPDATE` with
  `WT001` (the trigger is restored active). Restore mints no chain and makes the box no trade-readier.

  > **2026-09-06 (SP-3d):** The no-new-chain statement applies to rejoin with `skipSecrets:true`.
  > Cold restore now runs the fiscal hook and opens disjoint series before writing the identity; see
  > the [SP-3d design](2026-09-06-module-sp3d-fiscal-restore-hook-design.md) §5–§6.

- **Package suites unfiltered** — run `@waitron/fiscal-verifactu`'s `inmutabilidad` suite after any
  schema-touching change and the full `apps/server` suite (a wire-body or boot change is invisible to a
  name-filtered run — CLAUDE.md §2/§4). This slice adds **no migration** (it reads existing membership /
  sync state and composes existing restore steps), so there is no new RLS / FORCE-RLS / `english-only`
  surface; all `rejoin.*` codes and standing values are English.

## 8. Dependencies & sequencing

- **Buildable now:** BR-3 #232 (restore steps + wipe carry-forward), R1 #214 (fence), R2 #219 (drain +
  lane-agnostic disposal guard) are all landed on `main`.
- **Full fiscal safety** arrives **free** when H2 / SP-3 fiscal-record sync enrols `registros_facturacion`
  as a lane (§5) — no R3 change required.
- **Owner sign-off at land** (fiscal-adjacent). Not self-landed.

## 9. What this supersedes / interacts with

- **Resolves** the wire-protocol spec's §6 step 4 mechanism and closes the Slice 6 rejoin arc bar the
  deferred re-admission (§2). A dated pointer should be added to the wire-protocol §6 at land noting this
  slice supplies the mechanism.
- **Clears with** the promote-action cold-restore slice (Slice 4): both consume BR-3's restore, and the
  `dropAndCreateDatabase` primitive this slice adds is reusable there.
- **Backlog:** the Slice 6 row and the backup-regime row should be updated at land to mark
  wipe-and-restore LANDED and note the fiscal-lane seam.
- **Does not touch** `docs/compliance/*`.

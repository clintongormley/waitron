# Whole-state capture implementation plan

**Status:** The watcher cleared Claude's smaller disposition-table recommendation on 2026-11-16 at 05:37. The executable scope is the dated amendment below; the original recursive proposal is retained as a superseded record, not an implementation instruction. No owner design approval claimed.

**Current result:** the layout drives the existing backup path lists, and a missing disposition fails a guard. The original recursive proposal below is withdrawn in full.

## Original recursive proposal — superseded, not executable

**Original goal:** One PR captures every declared, non-excluded state path and restores that material through the real cold-restore path, using SQLite snapshots rather than copying live databases.

**Authority:** Lane K’s `WHOLE-STATE-CAPTURE` request in `/Users/clintongormley/waitron-campaign-k/queue.md` authorises planning: “capture the whole state directory EXCEPT an explicit exclusion set, with a completeness guard that fails when a new top-level entry is neither captured nor excluded — the curated list went stale on `modules.json` already.” Claude must review this plan with `claude-seat.sh review-branch`, then the watcher must clear it before building. This is not owner design approval. Execute inline with TDD after clearance; this invocation drafts only.

**Architecture:** Extend `packages/store/src/state-layout.ts`, retaining reset behaviour. Reuse archive framing, encryption, `ArchiveReadBudget`, module evidence, database snapshots and staged publication. No new ledger, protocol, persistence or capacity allowance.

## Decision needed before build

B2 excludes `scratch/`, `logs/`, `instance.env`, `recovery.json`, `recovery.lock` and `recovery.lock-journal`. That is insufficient as a restore policy: `restore.ts:337` and `state-secrets.ts:111` refuse setup-host paths; `packages/provisioning/src/first-setup-state.ts:119` includes `flows/` and `records/`. `backup-data-placement.ts:48` and `backup-verification-compatibility.ts:171` separately whitelist material. The former is verification placement, not the real restore.

**Watcher question:** Approve explicit operational exclusions beyond B2, rather than capturing protected operations without restoring them? Recommend excluding `flows/`, `records/`, `stream/`, `handover/`, `pair-store/`, `pair-copy/`, `cloud/`, `fiscal-readiness-db-*`, spare-space/reserve-release files, backup-room notes, reset/adoption/environment-move/clock-step markers, checked-address cache, replaced trading identity, and their declared temporary files. Exclude TLS join/client/install/repair state, retaining the existing CA and server recovery material. These exclusions avoid replaying operations or adopting another hardware/cloud identity; they are proposed policy, not existing authorisation. Watcher changes require revising the forecast before build.

`cloud/` includes private connection/recovery/replacement requests, staff keys and snapshot staging: their consumers are `cloud-client.ts:createCloudConnection`, `cloud-recovery.ts:createCloudRecoveryClient`, `cloud-replacement.ts:createCloudReplacement`, `cloud-remote.ts:readStaffKey`, and `cloud-snapshot-archive.ts:30`. Preserve destination cloud binding and the managed-cloud `backup.env` filter (`restore.ts:578`). Also seek watcher clearance to retain module history through existing evidence conversion while excluding source preparation; never copy raw module records over destination preparation.

## Build and behavioural checks

Paths below are under `apps/server/src/` unless qualified.

- **Withdrawn:** **Declare policy.** Modify `packages/store/src/state-layout.ts` and its `state-layout.test.ts`; extend `scripts/state-layout.test.ts`. Every layout entry requires an explicit capture, exclusion-with-reason, or snapshot disposition. Register missing B2/legacy names without resurrecting obsolete `modules.json`. Unknown top-level names fail collection; a declared captured directory includes new descendants automatically. `venue/` is special: venue/node databases use current snapshot APIs; locks, journals, WAL/SHM and Litestream metadata never enter the archive. Honour an external `venueDir` without walking it raw. Preserve other venue material unless explicitly excluded.

- **Withdrawn:** **Collect bytes.** Modify `state-secrets.ts`, `archive-entries.ts` and retire redundant optional collection in `backup-optional-state.ts`. Recursively collect regular files in deterministic order, preserving binary bytes through assembly and unpacking. Keep mandatory `RECOVERY_FILES` validation, optional absence, read-error propagation, budget limits and all-settled node cleanup. Refuse symlinks/special files; exclude recursive staging before traversal. Keep module evidence once, with no raw-module-record collision. Tests: `state-secrets.test.ts`, `archive-entries.test.ts`, `archive-entries.node.test.ts`, `backup-optional-state.test.ts`, `backup-sweep-file.test.ts`; check named exclusions, binary content, unknown roots, missing required files and no destination publication after refusal.

- **Withdrawn:** **Restore actual material.** Modify `restore.ts`, `restore-secrets.ts`, `backup-data-placement.ts`, `backup-verification-compatibility.ts` to consume the same path policy. Keep traversal, duplicate/case-alias, host-path and working-suffix refusals; owner-only modes; durable staging/rollback; identity-last publication. Tests: corresponding `*.test.ts` for the latter three files and `restore-artifact-file.test.ts`. Extend its existing sweep → local backend → `restoreFromArtifactFile` roundtrip with nested binary state, both database rows, exclusions and unchanged destination identities. Exercise Cloud and sealed recovery consumers in `cloud-snapshot-archive.test.ts` and `sealed-state.test.ts`; keep managed-cloud backup settings distinct. Sign-in, fiscal and non-editable invariants remain unchanged.

## Verification, scope and finish

For each behaviour, add a failing assertion, observe the expected failure, implement minimally, then rerun. Delete the traversal inclusion and completeness rejection independently: the roundtrip and unknown-root tests must fail respectively; a declared new descendant must still succeed. Run the named suites with `pnpm --filter @waitron/server exec vitest run src/<file>`; store policy tests use `@waitron/store`; root guard uses `pnpm exec vitest run scripts/state-layout.test.ts`. Preserve existing behavioural assertions.

Forecast added/removed lines: production **240/70**, tests **300/60**, fixture/support **20/10**, prose **80/20**: approximately **800 total churn**. Past 1,200 changed lines, stop for the watcher's outside opinion; material policy changes return before build. Prose updates: `docs/developers/conventions-data.md`, `docs/backlog.md` (delete this entry), `docs/backlog/box.md` (retain unrelated B2 carry-forwards). No database-placement durability project or other carry-forward work.

After focused checks, run `finish-branch`: two Claude run-it angles covering capture/completeness and restore/identity safety, then a fresh read of fixes, normal push hook and current-head CI. One PR; the user authorised finish and land, subject to watcher clearance and the normal gates.

## Executable amendment: watcher 2026-11-16 05:37

The watcher: “A disposition table in state-layout.ts naming every top-level entry as captured (required/optional) or excluded with its reason, driving the existing capture, plus a completeness guard that fails when a new entry has no disposition, fixes exactly that. No recursive collector and no binary rewrite until a real captured file needs them. Venue snapshots only; explicit current cloud/operation exclusions; file-level TLS recovery entries.” This adopts Claude's 203-second review recommendation; it is not owner design approval.

- Add a mandatory `backup` disposition to `StateEntry` in `packages/store/src/state-layout.ts`: required/optional file, excluded with a reason, database snapshot, module evidence, or named required TLS files with a reason for the rest being excluded. Derive the required/optional archive path arrays from that same table, preserving current order and bytes. Reset policy stays separate.
- `apps/server/src/state-secrets.ts` keeps its `RECOVERY_FILES` export as an alias of the derived required list; `backup-optional-state.ts` keeps its optional export as an alias of the derived optional list. Trace every consumer of both names; no verifier, restore writer, archive format or runtime filesystem admission change.
- TDD: add a store guard test that every declared entry has a disposition and every exclusion/snapshot/evidence has a reason. Observe it fail on current missing dispositions. Pin the existing five required paths, optional backup.env, TLS file subset, snapshot venue and module-evidence policy. Implement the table and aliases minimally.
- Run store state-layout.test.ts and the root scripts/state-layout.test.ts; server state-secrets.test.ts, backup-optional-state.test.ts, archive-entries.test.ts, archive-entries.node.test.ts, backup-sweep.test.ts and restore-artifact-file.test.ts. Existing real capture/restore cases retain their assertions. Prove the completeness guard by deleting one disposition in an installed disposable checkout and confirming its named failure, then restore.
- Delete the now-closed index entry in docs/backlog.md and rewrite only the whole-state paragraph of B2 in docs/backlog/box.md, preserving unrelated carry-forwards; add the policy/guard description to conventions-data.md. No runtime unknown-file refusal, recursion, binary rewrite or extra files solely for architecture.
- Forecast about 250 changed lines: production +90/−12, tests +55/−0, support files +0/−0, prose +70/−23. Outside opinion past 375. The normal two-angle backup/restore run-it wave, one fixes read if needed, hook and current-head CI remain required.

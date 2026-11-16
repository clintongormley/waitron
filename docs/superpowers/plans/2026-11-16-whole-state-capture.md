# Backup disposition table: implementation plan

**Goal:** A new declared state entry cannot silently miss its backup decision: the layout names required/optional files, snapshots, module evidence or an exclusion reason, and drives the current archive path lists.
**Authority:** Lane K WHOLE-STATE-CAPTURE, narrowed by the watcher on 2026-11-16 at 05:37: “A disposition table in state-layout.ts naming every top-level entry as captured (required/optional) or excluded with its reason, driving the existing capture, plus a completeness guard that fails when a new entry has no disposition, fixes exactly that.” Claude's 203-second source review recommended this form. No owner design approval is claimed. The watcher required this current-scope rewrite at 06:01.
**Original proposal:** signed commit `94bb3928b8`; Claude report `~/waitron-campaign-k/receipts/whole-state-capture/plan-review-report.md`. That recursive proposal is withdrawn.

## Result and boundaries

The server's existing required and optional archive path exports come from one state-layout table. Current archive paths, order and file contents stay the same: required `secrets.env`, `trading.env`, `tls/ca.crt`, `tls/ca.key`, `tls/server.pem`; optional `backup.env`. TLS capture is file-level. Venue/node snapshots and module evidence keep their existing collectors. Every excluded entry carries a reason, including cloud/operation state. No new layout names are added.

The completeness guard examines declared entries, not a live directory or the correctness of their reasons. No recursive collector, binary rewrite, runtime unknown-file refusal, new archive format, persistence or schema. Reset behavior, managed-cloud backup settings, restore identity checks and fiscal behavior stay outside this change. Other B2 carry-forwards stay open.

## Files and steps

- [x] **RED:** add completeness and current-path tests in `packages/store/src/state-layout.test.ts`. Observe missing dispositions and missing derived exports on current code (two failures, four existing cases pass).
- [x] **GREEN:** add mandatory `StateEntry.backup` in `packages/store/src/state-layout.ts`, with required/optional file, named required TLS files plus an exclusion reason, snapshot, module-evidence and exclusion variants. Derive `REQUIRED_BACKUP_STATE` and `OPTIONAL_BACKUP_STATE`; keep the existing names and `reset` fates unchanged.
- [x] **Reuse current consumers:** `apps/server/src/state-secrets.ts` re-exports the required array as `RECOVERY_FILES`; `backup-optional-state.ts` re-exports the optional array. Trace both exports through collection, verification and restore. No second literal list or new restore routing.
- [x] **Guard controls:** in an installed disposable checkout, remove one disposition and require the completeness assertion to fail naming that entry. A new explicitly excluded entry must pass; restoring the source must pass. Preserve the current five required and one optional paths and snapshot/evidence categories.
- [x] **Prose:** update the state-layout section in `docs/developers/conventions-data.md`, naming the guard's limits. Remove the closed capture ask from `docs/backlog.md`, retaining the existing B2 carry-forward link; remove only the old capture proposal in `docs/backlog/box.md`.
- [ ] **Finish:** two independent Claude run-it angles (capture/guard and restore/identity), one fresh read of fixes if needed, focused checks, normal pre-push hook and current-head CI; then the user's authorised landing. No additional review cycle solely for rebasing.

## Verification responsibilities

The store file checks completeness, non-empty reasons, the existing path contract and snapshot/evidence categories. The root `scripts/state-layout.test.ts` retains its name/reset guard. Existing server tests keep collection, required/optional absence, node snapshots, archive assembly and real cold restore assertions: `state-secrets.test.ts`, `backup-optional-state.test.ts`, `archive-entries.test.ts`, `archive-entries.node.test.ts`, `backup-sweep.test.ts`, `restore-artifact-file.test.ts`.

Commands: `pnpm --filter @waitron/store exec vitest run src/state-layout.test.ts`; `pnpm exec vitest run scripts/state-layout.test.ts`; `pnpm --filter @waitron/server exec vitest run` followed by those six `src/` paths. Read the test counts. No whole-package or workspace test run. The normal hook owns formatting, lint and selected types; CI owns scoped package suites and root guards.

**Forecast:** production +90/−12; tests +55/−0; support files +0/−0; prose +70/−23 = about 250 changed lines. Seek an outside opinion past 375.

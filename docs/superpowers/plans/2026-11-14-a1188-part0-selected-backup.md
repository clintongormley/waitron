# A1188 part 0: selected-backup placement

**Status:** bounded prerequisite/scope decision for Claude review, then watcher clearance before build. The queue authorises the work; Lane J’s runbook requires watcher clearance before build.

**Request**, recorded in `~/waitron-campaign-j/queue.md`, A1188:
“when the venue's box has died, the venue can be started in Waitron Cloud (emergency start). Design approved by the owner 2026-10-29: docs/superpowers/specs/2026-10-29-a1188-cloud-emergency-start-design.md.”
The watcher’s 2026-11-14 02:12 instruction moves A1018 Slice 14 here first, plan first.

**Scope:** local placement on an already admitted spare, retaining its existing identity. A1188 design §§5,9,11 still reserve full Cloud restore/new identity for the contract amendment; [A1425 design](../specs/2026-11-07-restore-takes-new-identity-design.md) §§4,7,8 and `docs/backlog.md:1844–1854` leave part 3 unbuilt. [A1018 plan](2026-11-02-a1018-handover-build.md), Slice 14 and following dependency table, distinguishes these paths. A hosted machine absent from the source chart is outside this local scope.

## Smallest usable outcome and missing prerequisite

You open the spare’s existing HTTPS `/handover/emergency`, select an encrypted archive and its backup key, review that specific copy, then use the existing declaration and activation. Placement must retain the spare’s `node.db`, node id, signing key and secrets, refuse a backup whose chart does not admit that spare, and activate nothing itself. A helper with no reachable entry is insufficient.

**Recommendation: hold the build until the watcher settles the authenticated selection-to-restart placement path.** The source inspected at `51bd22780c` does not supply that path:

- `apps/setup/src/main.ts:23–32` mounts `screens/handover-screen.ts`; `apps/setup/src/api/client.ts:347–352` sends sign-in to preview and a declaration, without an archive-selection input. `apps/server/src/handover-emergency-api.ts:239–274` uses `mirrorSource` and checks the live database. `EmergencyCopy` in `handover-emergency-check.ts:10–21` admits only `mirror-copy`.
- `validateArtifactFile` in `apps/server/src/restore.ts:1051` is a reusable archive reader. There, `skipSecrets` skips identity/secrets replacement, source-node placement and restore hooks (`:401–449`), but `writeValidated` still calls `assertVenueFirstSetupAllowed` (`:476`). That guard is not emergency admission; it permits completed setup records (`packages/provisioning/src/first-setup-state.ts:453–461`).
- `placeAcceptedCopyForStart` in `apps/server/src/handover-place-copy.ts` runs before the store opens (`boot.ts:1266–1274`), but requires `filing_assumed` and an accepted final-state indicator (`handover-place-copy.ts:59–81`). Do not manufacture controlled-handover evidence for an emergency. The route uses the long-lived store opened at `boot.ts:1336`.
- `stageRestoreRequest`/`runStagedRestore` in `restore-request.ts` and `publishRestoreFlow` in `restore-flow.ts` bridge cold restoration across restart. Their setup gates and identity-restoring path are not an existing emergency-placement contract.

These are source observations, not production verification. Before build, use `~/workspace/tools/claude-seat.sh review-branch`: Claude assesses whether this delivers the request by the simplest route, what it adds, then correctness/buildability. Resolve the entry and restart lifecycle in this plan before watcher clearance; invent no endpoint, record, protocol or mode here.

## Future build checks, after clearance

Write each behavioural test first, observe its expected failure, then implement:

- Placement: proposed `apps/server/src/handover-copy-from-backup.test.ts` must assert local identity survives, the backup-room note goes before replacement, and missing/wrong keys, damaged copies and absent chart membership refuse. Reuse `validateArtifactFile` and its returned source id, `checkHandoverCopy` and `deleteBackupRoomNote`; do not assume `writeValidated` supplies admission.
- Routes: extend `handover-emergency-declare.test.ts` for selected-source binding and changed-copy refusal. Browser: extend `apps/setup/src/screens/handover-screen.emergency.test.ts` for reachable selection, review and refusals. Expected initial reds: selected-source requests are unsupported and the archive chooser is absent. Extend `boot.place-copy.test.ts` for placement before opening and retry after interruption; the cleared entry needs declaration/activation integration too.

Future focused commands: `pnpm --filter @waitron/server exec vitest run src/handover-copy-from-backup.test.ts src/handover-emergency-declare.test.ts`; `pnpm --filter @waitron/setup exec vitest run src/screens/handover-screen.emergency.test.ts`. Add the settled restart suite and replacement-file guard. None were run here.

**Limits and size:** this decision changes zero production and zero test/support lines. Estimate the cleared implementation separately; split into usable PRs before build if over three active hours. R40 remains open for 3b-F Task F.2: `finish-adoption.ts:18–24` still gates Veri*Factu joining. No fixture bypass or completed fiscal two-box claim. Exclude Cloud services, A1425 part 3, fiscal goldens, hashes/chains/numbers, `registerSif` and `restoreFiscal`. Any required protected change is blocked for watcher/owner clearance; no H2 exception exists.

# A1406-2: work-time policies — proposal

**BLOCKED BEFORE BUILD.** Driver resolves these questions and obtains Claude plan review before inline TDD. Basis: [labour research §2](../../compliance/research/2026-11-06-adviser-labour.md#2-l2-the-agreement-and-overtime) and supplied watcher instructions. Read-only inspection; no runtime verification.

## Three business decisions

1. **Approve this continuous-break definition?** Propose one clock-in/out session, gross duration >300 minutes, credit `min(recordedBreakMinutes,20)` once; no invented break when none was recorded. Split gaps use clock-out/in, never break-start/end. `docs/operations/working-time.md` does not establish split-gap semantics.
2. **Annual planned or actual hours?** Propose planned-only calendar-year advisory warnings: local start-date attribution, draft replaces published per week, unattached shifts counted once; no actual/planned mixing. Actual annual reconciliation is outside this proposal.
3. **Part-year and part-time limits?** Propose the unscaled agreement ceiling for everyone, explicitly labelled “agreement ceiling”, without claiming individual allowance or guessing full-time status/proration. Is that sufficient for this build?

These are recommendations, not approved policy; different answers require revising the affected steps.

## Smallest build after answers

- Extend `packages/workforce-es/src/schema/convenio-config.ts`, `convenio.ts` and workforce `WorkTimeRuleset`: five nullable `count` columns, neutral default null: `annual_work_minutes=106980` (1783 hours, supplied for 2026–2028), `split_min_segment_minutes=180`, `split_max_segment_minutes=300`, `split_min_gap_minutes=90`, `continuous_paid_break_minutes=20`. Validate positive safe whole-minute values, coherent/all-present split bounds; null disables each policy. Preserve `breaks_count_as_worked` and existing statutory defaults. First-venue row keeps 2880/300/20 rest/break values.
- Add one accounting helper beside workforce `projection.ts`; keep recorded break duration intact. Thread its policy through `WorkSummaryRuleset`/`workSummary`, `timeRecord`/`record-reads.ts`, `hours-reads.ts`, `getPlannedVsActual`, and new `pay-period-close.ts` snapshots. Resolve at server attendance/workforce boundaries and workforce-es `record-export.ts`, never import Spain into generic workforce. Staff see credited Hours/My hours and PDF/CSV totals. Preserve saved closures, canonical hashing and replay; policy changes alone must not manufacture correction impacts in `record-projection.ts`.
- Extend workforce `roster-validation.ts`/`RosterBreach` with split-segment/gap (multiple same-person, same-local-day shifts) and annual-planned warnings. Extend server `workforce-api.ts` beyond its three-week window with full-year context; pass that context through staffing `dashboard/client.ts` to `rota-warnings.ts`/slot picker. Add EN/ES `strings.ts` wording; retain advisory publication. Update operator recipe, relevant EN/ES guides and backlog. A586 retains complementary-hour classification. No new settings surface or preparation mechanism; operator applies an available bundle using existing decode/encode/import. PR2588 recipe is currently read-only at `a36836c541`.

## Checks and migration

Watch focused tests fail, then pass: 300/301-minute sessions; 400-span/20-break →400 worked, break20; disabled→380; missing/short/long breaks; split segments179/180/300/301, gaps89/90; ordinary single shift; annual106980/106981, year boundaries/version deduplication; actual staff/export totals and unchanged frozen closure/hash/replay.

Extend resolver, schema-conformance, backup validation (types/ranges/missing/tampered fields, added-column policies) and server configuration-transfer round trips. Regenerate workforce-es migrations on current main: add columns before CHECK rebuild; inspect inbound foreign keys/triggers and compare populated upgrades on `node:sqlite`, including preserved row values. Never hand-edit snapshots/journal/baselines. A1308 protection-list includes this set (`apps/server/scripts/protection-list/build.ts:61`); compare before/after. Its fresh-schema comparison does not verify upgrade writes.

Run focused suites plus root schema-constraints, migrations-match-schema, migration-upgrade, append-only/behavioural-triggers, column-vocabulary/journal guards; unchanged fiscal `write-path.e2e.test.ts`/`inmutabilidad.test.ts`. Then normal finish-branch review, push hook and current-head scoped CI; no whole-workspace run.

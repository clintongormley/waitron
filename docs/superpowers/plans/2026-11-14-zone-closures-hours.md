# Zone closures and department hours

**One PR:** save a zone closure beyond department hours, apply only its intersection with resolved department hours, then close the demo Terrace 23:00–05:00. Authority: the owner's 6 November rule and A1542 in `docs/backlog/service-periods.md`, quoted by Lane K's queue. A separate Sol-high invocation drafted this; the driver condensed it. No behavior was run or design cleared yet. `V/` means `packages/venue-service/src/`.

1. **Check the premise first.** In `V/{zone-own-hours,keep-open}.test.ts` and `V/dashboard/opening-hours-day.test.ts`, compare raw and intersected closures: department 18:00–00:00, closure 23:00–05:00; wholly outside; inside-overlap control. Calendar rows and remaining service must agree; dropping all closures must fail the overlap control. Compare `readZoneClosingStates` and rendered till messages/controls at 22:00, 23:30 and 00:30, using existing fixtures. Source predicts a difference outside hours (`V/zone-closed-times.ts`, `V/operations.ts`, `apps/till/src/{widgets/service-period,screens/till-floor-screen}.ts`). **Question for the watcher:** accept department-closed wording/controls replacing zone-closed outside department hours, if the small check confirms it? Recommend that direct consequence only; settle it before the affected edit.

2. **One effective read, raw storage kept.** In `V/zone-closed-times.ts`, intersect `zoneClosureDays` with resolved department hours using existing `V/zone-own-hours.ts:closuresInHours`; batch the zone/department lookup and `resolveDepartmentsDays`, with each date's clock/plan/context. Preserve extension subtraction. Reuse Calendar and planned-service subtraction; add no per-zone database loop or second algorithm.

3. **Retire the write-time rule.** Delete `V/zone-closure-hours.ts` and its sole-purpose checks/callbacks in `V/{routes,season-weeks,special-days,configuration-transfer}.ts`; remove `closureOutsideHours` and `outside_hours` alternatives in `V/{zone-own-hours,errors}.ts`. Preserve shape, ownership, overlap, quarter-hour, skipped-time, stale-clock, waiting-change and transaction refusals. Remove closure trimming/paint-outside handling for strokes, Copy, recolour and department edits in `V/dashboard/{paint-grid,season-painter,special-day-painter,painter-labels,strings}.ts`. Keep underlays, Open paint, drafts, ordinary refusal markers and the mixed-changeover notice.

| Bundle entry, in order | Disposition |
| --- | --- |
| Department-only writes leave closures outside hours | Retain stored tails; read their effective intersection. No repair write. |
| Checks live at routes rather than writers | Delete those checks, not move them. |
| Unticking Closed all day revives unchecked paint | No new check; resolve reopened-date hours. |
| Season edits strand special-date closures | Resolve the current layered day when read. |
| Yearly paint checked only on stored date | Use the actual occurrence's hours; no prospective validation. |
| First-date changeover cuts other dates | Remove closure-specific authoring cuts; retain independent time validity and the existing drawing/notice. General mixed-changeover drawing stays unresolved. |
| Cut-away stroke hides another refusal | Delete that notification path; preserve the other marker. |
| Season closure exceeds special-date hours | Intersect after the full day is layered. |
| A1542 demo Terrace | Last, change only its 23:00 closure's end to 05:00 in `apps/server/scripts/demo-seed/seed.ts`; no automatic closures elsewhere. |

4. **TDD, with one owner per assertion.** Observe red, make the smallest edit, observe green. Old containment/clipping checks deliberately change under the owner's rule; retain unrelated assertions. Reads: `V/{zone-own-hours,keep-open,day-resolver}.test.ts` own intersection, extensions, current/later-year/Closed-all-day layering. Boundaries: `V/{menu-timetable-routes,special-days-routes,configuration-transfer}.test.ts` own accepted raw tails and remaining invalid-input/atomicity refusals; preserve independent assertions before deleting `zone-closure-hours.test.ts`. Browser: `V/dashboard/{paint-grid,season-painter.save,special-day-painter.paint,special-day-painter.save}.test.ts` own saved tails, payloads and refusal markers. Retain `apps/server/src/till-api.zone-closed.test.ts` admission checks. `apps/server/scripts/demo-seed/seed.test.ts` owns the 23:00–05:00 seed, both changeovers and a past-midnight special day where Terrace stays closed and another zone is available. Inspect phone/desktop in both themes. Run named files with `pnpm --filter <package> exec vitest run <files>`; no whole-package suite.

5. **Close the documents.** Update the EN/ES opening-hours guide with one actionable painting instruction and matching section id; supersede old containment prose in `docs/developers/conventions-data.md`. Remove resolved bundle/details/index, keep the owner's rule and the independent mixed-changeover limit in `docs/backlog/service-periods.md`. No migration, new state/protocol, compatibility path, fiscal/payment work or `CLAUDE.md` change.

**Unmeasured size forecast:** production +60/−300; tests +200/−750; support +0/−0: 1,310 changes, mostly retired checks. Report actual additions/removals separately; seek an outside opinion past 1,965. Claude review and watcher clearance precede build.

# D-PAINT-CHANGEOVER-EDGE plan

**Finish line:** with a fixed 05:50 changeover, Opening hours paints, saves and reads 05:50–06:00 and 05:45–05:50; sale routing follows those periods. Interior 05:47 remains refused. Reuse existing minute arithmetic, range representation, painters and database fixtures.

**Paths:** V=`packages/venue-service/src`, S=`packages/staffing/src`, D=`packages/db/src/schema`.

**Storage:** retire quarter-only `opening_hours_step_ck` in `D/venue-service/opening-hours.ts` and its inventory entry in `scripts/schema-constraints.test.ts`. Keep other constraints; `timeOfDay` is plain text, so `parseRanges` and configuration-transfer validation own clock-format and quarter-or-changeover checks. Delete only the two retired step rows in `D/venue-service/opening-hours.test.ts`; the save/read test below proves acceptance. Keep-open copies a closure start into `keptOpenFrom`: narrow the existing CHECK in `D/floor-zones.ts` to `keptOpenUntil` only, preserving its name/inventory and end-step assertion. Delete only the start-step row in `D/floor-zones.test.ts`.

Rebuild core with `pnpm --filter @waitron/server migration-baseline rebuild --set core`; commit generated SQL/snapshot/journal/epoch outputs actually written, without hand edits. State the test-venue reset in the PR's first line. No new tables, triggers or compatibility handling.

**Behavior:**

- `V/service-day.ts`: accept either endpoint exactly at the supplied changeover or a clock quarter. Preserve ordering, overlap, full-day and multi-changeover checks; trace department weeks, zones, special days and configuration transfer.
- `V/paint-model.ts`: `stepMinuteAt`/`stepAt` choose the nearest of 0, interior clock quarters and 1440, later on ties; zero-height boundary mode answers 0. Add optional `includeChangeover=true`, passed through `ColumnStrokeOptions` in `V/dashboard/paint-grid-parts.ts`.
- `S/dashboard/staffing-grid.ts`: opt out. Staffing keeps its own quarter-only parser, workforce CHECK and backup verifier. Leave `block-model.ts` minimum/maximum and resize rules unchanged. Trace `slotsForDay`'s minute arithmetic; no change or extra test there.
- `V/business-day-schedule.ts`: classify an in-strip crossing rejection as `transition_strip` before the generic range label, retaining refusal.

**TDD and focused tests:** observe each new regression fail before minimal implementation. Existing passing consumer controls stay.

- `V/service-day.test.ts`: both boundary endpoints accepted; interior 05:47 refused with domain code/step reason, including closures.
- `V/paint-model.test.ts`: update intentional boundary expectations; retain interior rounding and quarter-only-mode assertions.
- `V/season-weeks.test.ts`: real `useVenueDb` save/read of both fragments. `V/routing-store.test.ts`: two periods with distinct routing-cell makers resolve correctly at 05:49/05:50/05:59.
- `V/keep-open.test.ts`: saved closure 05:50–07:00 can be kept open until a valid quarter. `V/business-day-schedule.test.ts`: moving 05:50 to 06:00 refuses saved 05:45–05:50 as `transition_strip`.
- `V/dashboard/paint-grid.test.ts`: drags/rendered boxes reach both edges. `S/dashboard/staffing-grid.test.ts`: creation/resizing stay parser-accepted quarters. Run existing `S/paint-rules.test.ts` and `S/block-model.test.ts` controls.

Run named files via package `exec vitest run`; browsers sequentially. Inspect EN/ES, both themes, phone/desktop. Run root `schema-constraints`, `append-only-triggers`, `behavioural-triggers`, `starting-migrations` tests and unedited fiscal `inmutabilidad` unconditionally. Golden `write-path.e2e` also runs if near fiscal invariants. Two run-it reviews cover migration/cross-package risk.

**Scope/size:** no fiscal changes, A644/A708 or guide corner-case prose. Remove only the named service-periods backlog section and its index after acceptance. Forecast handwritten production +50/−30, tests +160/−30, support 0/0, plan +30/0, backlog 0/−10; generated about +3/−13, counted separately from actual diff. Stop at 500 handwritten changed lines for watcher review.

**Authority/limits:** separate Sol-high draft, driver corrections, Claude approach read 2026-11-17 (476s); watcher cleared the corrected plan at 04:41 on 2026-11-17 in Lane D questions.md; no owner design approval claimed. PR explicitly states Staffing stays on quarters, Keep-open still offers quarter-only ends, and five-minute edge boxes are small to tap. Build nothing extra for those limits.

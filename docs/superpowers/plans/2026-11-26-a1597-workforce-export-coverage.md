# Restore workforce-es coverage (A1597)

The nightly workforce-es check passes its existing coverage floors once the exporter tests exercise
how the monthly close reads working-time rules. The queue asks for a test of
`record-export.ts:240–244` and a manual run of the nightly CI workflow on main after landing.

- Extend `packages/workforce-es/src/record-export.test.ts` using its existing `useVenueDb` fixture
  and transaction helper. Call `WORKFORCE_ES_RECORD_EXPORT.workSummaryRules` through the package
  export, as the attendance loop calls the exporter through its interface.
- Check that a venue without an agreement gets `null`. Insert a real agreement with six working
  days and `period_net`, then check for six working days and `period-net` in the result. In a
  separate case, make the transaction's first select throw and check that the seat rejects with
  the same error. The existing convenio tests cover the full mapping of agreement fields.
- Capture the failing package coverage before editing. Run the changed test file, then
  `pnpm --filter @waitron/workforce-es test:coverage` to confirm the floors and the formerly
  uncovered lines. Keep production and coverage settings as they are. Expect about 25 added test
  lines and zero production lines. Remove an A1597 backlog entry if one was added before landing.
- After the required PR checks pass and the change lands, dispatch `ci.yml` on main and record the
  run's head and result, including the workforce-es coverage result in `test-light-b`.

Queue source: Lane I, A1597, queued by the watcher on 26 November 2026 at 03:31.

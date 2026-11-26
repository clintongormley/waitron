# Restore workforce-es coverage (A1597)

The nightly workforce-es check passes its existing coverage floors once the exporter tests exercise
how the monthly close reads working-time rules. The queue asks for a test of
`record-export.ts:240–244` and a manual run of the nightly CI workflow on main after landing.

- Extend `packages/workforce-es/src/record-export.test.ts` using its existing `useVenueDb` fixture
  and transaction helper. Call `WORKFORCE_ES_RECORD_EXPORT.workSummaryRules` through the package
  export, as the attendance loop calls the exporter through its interface.
- Check that a venue without an agreement gets `null`. Insert the agreement row through
  `api.convenioConfig`, as this suite does for the enabled agreement policy. Set six working days,
  `period_net`, and 420 daily target minutes. Assert those three fields, with the model returned
  as `period-net`. The existing convenio tests cover the full field mapping.
- In a separate case, use `vi.spyOn(tx, "select").mockImplementationOnce` inside the transaction
  callback to throw a registered `AppError("setup.request_invalid", { field: "agreement" })`.
  Check that the exporter rejects with the same error object. In a disposable checkout, remove
  the code comparison once and confirm this case fails because the exporter returns `null`.
- The baseline `pnpm --filter @waitron/workforce-es test:coverage` failed at 97.9% statements
  with 139 tests passing. Run the changed test file and the same coverage command to confirm the
  floors and the formerly uncovered lines. Expect about 25 added test lines and zero production
  or coverage configuration changes.
- After required PR checks pass and the change lands, run `gh workflow run ci.yml --ref main`
  with the probe option at its default of false. Record the run's head, confirm it contains the
  merge, and record its result and the workforce-es coverage from `test-light-b` in progress.log.

Queue source in Lane I, A1597, queued by the watcher on 26 November 2026 at 03:31.

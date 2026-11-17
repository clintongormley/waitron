# English list comma

**Scope:** ENGLISH-LIST-COMMA in `~/waitron-campaign-i/queue.md`. Smallest usable
result: the till and printed kitchen cues say “Grill, Fryer and Pastry”, matching
the dashboard. This is a plan only; the campaign driver owns review and execution.

**Reuse and boundary:** Keep `conjunctionList(items: readonly string[], locale: string): string`
in `packages/shared/src/list.ts`, its formatter cache and `Intl.ListFormat`.
Normalize exactly `en` to `en-GB` before the existing cache lookup/construction.
Preserve explicit English region locales, including `en-US`, and every other locale.
No locale parser, new helper, framework or test suite; no caller implementation changes.

The inspected callers justify that boundary: `apps/till/src/widgets/station-queue.ts:160`
and `apps/till/src/screens/till-table-order-screen.ts:6303,6462` pass `currentLocale()`;
`apps/server/src/kitchen-ticket.ts:328` passes the ticket locale. The dashboard wrapper
(`apps/dashboard/src/i18n/list.ts:4`) also passes its current locale, whose supported
English spelling is `en-GB` (`packages/shared/src/locales.ts:7`). Staffing's
`packages/staffing/src/dashboard/staffing-season-painter.ts:280` passes the current locale;
its `painter-parts.ts:101` already uses `formatLocale()`. Venue-service's
`packages/venue-service/src/dashboard/floor-plan-set-delete-dialog.ts:21` already selects
`en-GB` explicitly. Bare `en` is the only additional input these paths need normalized.

- [ ] In `packages/shared/src/list.test.ts`, add one `en` row expecting
  `Wine, Beer and Soup` to the existing “joins the items as an 'and' list in the locale
  given” table. Run `pnpm --filter @waitron/shared exec vitest run src/list.test.ts`;
  require this case to fail because the actual string contains `Beer, and`.
  Make the minimal helper change above, then rerun and require all cases to pass.
  This suite owns punctuation, the existing Spanish/region cases and formatter reuse.
- [ ] Audit caller expectations for literal `, and` and commas split across lines.
  Inspect `apps/till/src/widgets/station-queue.test.ts`,
  `apps/till/src/screens/till-table-order-screen.split-table.test.ts`,
  `apps/server/src/kitchen-ticket.test.ts`,
  `packages/staffing/src/dashboard/staffing-season-painter.test.ts`,
  `packages/staffing/src/dashboard/staffing-special-day-painter.test.ts` and
  `packages/venue-service/src/dashboard/floor-plan-set-delete-dialog.test.ts`.
  Change only assertions pinning the deliberate new punctuation. In the kitchen
  case “A773 fire paper: a wrapped cue takes words down…”, several English expectations
  end a line with the serial comma; one says `Rotisserie, and Bar`. Update affected
  strings while retaining exact line arrays, both paper widths and the station-name
  wrapping assertions. Do not remove punctuation belonging to a stored station name.
  Caller tests own rendering and wrapping; add no duplicate punctuation regressions.
- [ ] Run those caller files with `pnpm --filter <package> exec vitest run <src/path>`
  using `@waitron/till`, `@waitron/server`, `@waitron/staffing` and
  `@waitron/venue-service` respectively. Also run
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/list.test.ts`.
  Require passing test counts; run browser packages sequentially with the house memory gate.
- [ ] In `docs/backlog/till.md`, delete only the serial-comma entry under
  `Bundle: The "Goes with" line` and change its count to 1. Change the matching
  `docs/backlog.md` index count to 1. Leave the counter-order owner question intact.

**Exclusions:** Spanish behavior, explicit region preferences, counter-order cue rules,
guide changes and unrelated cleanup. **Expected size:** production about 1–3 added lines;
tests one added table row plus about 5–10 replaced expectation lines; docs this one-page
plan plus two count replacements and deletion of the two-line backlog entry.

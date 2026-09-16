# Printer setup implementation

1. Add failing browser tests for the list, naming, read-only identifiers and separate test dialog.
2. Implement the forms, responsive rows, pairing instructions and English/Spanish copy.
3. Reproduce fetch-error classification in the request tests and add localized connection feedback.
4. Pin single-byte initialization and preview handling with failing tests, then update the builder
   and decoder. Run the test-page and document consumers affected by the command prefix.
5. Reproduce the development mDNS collision with a fake socket and suppress advertising for
   development and loopback listeners in all boot modes. Update the development instructions.
6. Reproduce the test-page language mismatch, then use the same saved-user/browser/venue selection
   as the dashboard. Clarify the printed QR instructions in both languages.
7. Run focused browser and accessibility suites, inspect desktop/phone renders in both themes,
   and run changed-package types and formatting. Record physical-test and incident-diagnosis limits.

## Verification, 2026-09-16

- Dashboard: `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts
  src/screens/printers-screen.a11y.test.ts src/api/client.test.ts src/i18n/codes.test.ts`: 362 passed.
  Chromium covered both themes at 1280 and 390 pixels. Captured and inspected the setup dialogs.
- Printing: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/printing exec vitest run
  src/escpos.test.ts src/charset.test.ts src/index.test.ts`: 44 passed.
- Document consumers: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run
  src/print-job-preview.test.ts src/test-page.test.ts src/receipt-ticket.test.ts
  src/payment-slip.test.ts src/kitchen-ticket.test.ts`: 113 passed.
- Request primitive: `pnpm --filter @waitron/dashboard-kit exec vitest run src/request.test.ts`:
  14 passed, including the connection rejection regression.
- `tsc --noEmit` passed in dashboard, dashboard-kit, printing and server. ESLint passed for changed
  TypeScript files; Prettier and `git diff --check` passed.
- Before implementation, the new UI assertions failed; the fetch rejection had no domain code;
  configured initialization lacked FS .; preview stopped at FS .; successful-add feedback was absent;
  reopening a pending print dialog skipped its new print request. Each regression passed after its fix.

Physical NT-806 output remains unverified. The design records the confirmed duplicate name answers
and their disappearance after the laptop server stopped; individual historical browser destinations
were not captured.
The implementation checks above precede the `finish-branch` review and CI.


## Rebase and follow-up verification

Rebased onto `0ef10258` (including #378's tenant-column removal), restored all working changes,
adapted the new language fixture to the new schema, and ran `pnpm install --frozen-lockfile`.
After the rebase:

- The dashboard command above: 362 passed; printing: 44 passed; request primitive: 14 passed.
- `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run
  src/mdns.test.ts src/primary-url.test.ts src/print-api.test.ts src/test-page.test.ts
  src/print-job-preview.test.ts src/receipt-ticket.test.ts src/payment-slip.test.ts
  src/kitchen-ticket.test.ts`: 220 passed. Language tests cover saved preference overriding both
  browser and venue, browser fallback in both languages, and venue fallback with neither preference.
- `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/boot.test.ts
  -t 'under devMode|boots, pins|setup mode'`: 13 passed, 26 outside the filter. The development
  case binds `0.0.0.0`, answers its HTTP request, and emits no `mdns.responding` event.
- `pnpm exec vitest run scripts/claude-md-pointers.test.ts scripts/no-tenant-column.test.ts`:
  14 passed. Changed-package typechecks, changed-TypeScript ESLint, formatting and diff whitespace
  checks passed again.
- Before the language fix, four route cases printed the venue language instead of the expected
  user/browser language, and the QR-caption assertion failed. These failures were observed both
  before and after adapting to main's schema, then all passed after implementation.


## Finish-branch review

The isolated Claude run-it review completed in 239 seconds, with no blockers. Accepted follow-ups:

- Move the character samples and their answer-to-charset mapping into the browser-safe
  `packages/printing/src/test-page-samples.ts`, consumed by the printed page and dashboard. Keep the
  existing literal output assertions and add rendered label assertions.
- Extend the successful-add regression through a later discovery poll. Removing
  `#registeredDevices.add(...)` now fails because the Add button reappears; restoring it passes.
- Remove the unused test-print translation and obsolete modal classes.

The follow-up browser and accessibility suites passed (146 tests); charset tests passed (14), and
printed-page tests passed (5). The dashboard production build also passed. A probe using the actual
request primitive and the session-error callback extracted from `main.ts` confirmed that a fetch
rejection has no HTTP status and emits no session-invalid event; its expired-session 401 control
retains the status and emits the event. No change was needed for that review question.

Review artifacts: `/tmp/waitron-printers-review-xycqpvw0/` holds the brief, report, timing, usage,
triage and session probe. Physical NT-806 behavior is still unverified. The reviewer did not repeat
the historical LAN probes; their original readings are recorded in the design.


The first CI run found one additional prefix assertion in `till-api.receipt.test.ts`: it expected
plain text immediately after ESC @. Reproduced locally with `-t 'lays the payment slip out'`, then
updated the expected prefix to include FS . while retaining the no-table-selection, paper-width
and EUR assertions. `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run
src/till-api.receipt.test.ts` then passed all 29 tests. The other jobs in that CI run passed; the
corrected commit requires a fresh current-head CI run.

## Owner follow-up review, 2026-09-16

After the NT-806 physical table probe, the owner requested generic table identification and a sample
receipt. A second isolated run-it review of that new production work completed in 204 seconds. It
found that supplying the printer's configured encoding to preview prevented later `ESC t` commands
from changing encoding and hid unknown-table failures. A new regression failed with mojibake, then
passed after the configured encoding became only the starting/reset state. A second regression then
proved that preview also needs the saved numeric table to decode model-specific mappings outside the
three common test-page numbers.

Other accepted findings added table-6 byte assertions to the kitchen and payment renderers, localized
the table finder, made its final block cover all sixteen values, tested every printed line at 58 mm,
changed DPI calibration to choose the measurement closer to 40 or 45 mm, refused an empty table
field, repeated the sample warning at the tear-off edge, and committed a real-PostgreSQL assertion
that `app_user` can update the new column. Automatic backfill of old `pc858` rows was rejected because
this repository forbids compatibility and data migrations before production; every existing
pre-production printer must be recalibrated through the new test flow.

Review artifacts: `/tmp/waitron-printers-review-0SKhyV/` holds the brief, report, timing, usage and
triage. The physical table probe itself is recorded in the design rather than repeated by review.

The owner then clarified that calibration must follow the site's language rather than assume Western
Europe forever. The character-set type now derives from the database enum, and exhaustive locale and
encoding records own the calibration samples, finder candidates and localized setting labels.
Instructions retain the operator's locale, while the site locale selects those samples and travels
back to the dashboard with the queued job. English and Spanish intentionally share today's profile.
Adding a future locale produces type errors until its printer calibration entry and setting labels
are supplied; a Ukrainian entry must deliberately add and test its Cyrillic encoding path.

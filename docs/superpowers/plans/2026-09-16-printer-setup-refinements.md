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
CI and whole-branch review belong to `finish-branch`, which has not been invoked.


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

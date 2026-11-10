# A982 PR3: setup report implementation plan

**Goal/finish line.** From setup’s persistent header, preview and download this browser’s activity before discovery answers, after a request refusal, and while an already-loaded page is offline, including HTTP before certificate setup.

**Authority.** Follow the approved [mother plan](2026-11-08-a982-client-only-report-first.md), watcher 2026-11-08 12:57, and owner-supplied RUNNER §0/queue scope. PR1 landed at `b0251c78cd39163baa4f1ee770813d6d4be422c2`. Only PR2 is parked for its unavailable installed-device interface. Driver receipt: Lane I `RUNNER.md` §0 and `queue.md` A982 permit PR3 while only the installed-till slice waits; the 2026-11-08 12:57 approval is recorded in the mother plan and Lane I questions archive. Send this slice once to Claude, then watcher under current RUNNER before building; neither gate is claimed complete here.

**Implementation.** Reuse dashboard `problem-report.ts`’s capture/render/download and scoped-draft pattern in a setup-owned element using `wt-report-dialog`. Keep existing EN/ES copy, frozen opening metadata/ID/activity, exact editable-description preview/download bytes, failed-download retry, fresh reopen and cleanup. Preserve current limits: 200 events/15 minutes/64 KiB/100 request IDs; 2,000 description code points and existing control-character rejection. Shared diagnostics/dialog retain validation, bounds and generic dialog assertions.

Use a text `wt-button`, with token spacing, before theme/language. Let the header wrap the report onto its own row when needed; keep logo and adjacent theme/language controls, language trailing. No new shared UI API. Setup-local `makeSetupId(): string` uses `crypto.randomUUID` when available, otherwise UUID-v4 bytes from `crypto.getRandomValues`, with version/variant bits; never `Math.random`. Pass it to both instrumented fetch and `captureClientReport`.

In `main.ts`, wrap fetch with `watchBuild` and `createInstrumentedFetch`, install existing error capture before rendering, then inject that transport into the real `SetupApi`. Keep first valid same-origin build metadata in setup diagnostics; use a no-op build-change callback. Leave `SetupApi`’s default transport unchanged. Existing unknown-route masking remains; this is not a rich trail.

**Excluded.** PR4 route templates/resolved-screen vocabulary and richer privacy/trail; stored PR5–7; dashboard/till HTTP changes or refactoring. No network submission/storage, endpoint, schema, controller, export protocol, framework or new design/spec.

**Exact implementation files** (paths below are relative; no other edits without deviation approval):

- Create under `apps/setup/src/`: `diagnostics.ts`, `problem-report.ts`, `random-id.ts`, `diagnostics.test.ts`, `problem-report.test.ts`, `problem-report.unsaved.test.ts`, `setup-app.problem-report.test.ts`, `random-id.test.ts`.
- Modify `apps/setup/src/main.ts`, `apps/setup/src/setup-app.ts`, `apps/setup/src/i18n/strings/shell.ts`, `apps/setup/src/setup-app.theme.test.ts`.
- Modify `apps/setup/package.json` and `pnpm-lock.yaml` to declare diagnostics directly; modify `apps/setup/vitest.config.ts` to remove the `main.ts` coverage exclusion.
- Modify `apps/server/src/guide/en/box-status.md`, `apps/server/src/guide/es/box-status.md` at existing `{#open}`; update `docs/backlog.md` and `docs/backlog/alerts.md` together, leaving later slices open. Include `docs/superpowers/plans/2026-11-10-a982-setup-report.md`; this is the only authoring-turn edit. Driver adds its backlog pointer later.

**Test-first responsibilities.** For each behavior, write its assertion, observe the expected failure, implement minimally, rerun green. Helper tests pin native/fallback UUIDs and bits, with `Math.random` forbidden. `diagnostics.test.ts` imports real `main.ts`, intercepts only network transport, and exercises real `SetupApi` over HTTP with `randomUUID` absent: startup IDs matching captured request IDs, fallback report IDs, first same-origin build, foreign-build rejection, masked paths and captured errors. No source-scanner substitute.

Setup header tests own pending discovery/refusal/offline entry; report tests own frozen capture, exact preview-byte download, retained retry and fresh reopen without report requests/storage. Unsaved tests own local leaving and unchanged underlying setup drafts. Theme/header tests own EN/ES, both themes, accessible controls and overflow at 390/1280px. Restore globals/locales and await close events. Reuse existing diagnostics/dialog behavioral suites; do not duplicate their generic assertions.

**Estimate/stop.** Added/removed lines: production 330/15; tests/config 520/5; docs 40/5; generated lockfile 10/0. Total ~900 added/~25 removed; stop for deviation approval before exceeding 1,350 changed lines or the file list.

**Finish verification, during implementation only.** Run focused setup files with `pnpm --filter @waitron/setup exec vitest run <file>` and read test counts; rerun existing `src/api/client.test.ts` and theme checks. Run diagnostics report/fetch/build/error suites, UI report-dialog/accessibility suites, server `src/guide-content.test.ts`, root `scripts/guide-links.test.ts`, setup typecheck/build. Inspect actual EN/ES header/dialog at both widths/themes and retrieve an HTTP download. Finish through `finish-branch`, normal push hook and required current-head CI. Reading here verifies no behavior; no tests/builds/reviews run in this authoring turn.

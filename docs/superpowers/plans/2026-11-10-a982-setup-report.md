# A982 PR3: setup report implementation plan

**Goal/finish line.** From setup’s persistent header, preview and download this browser’s activity before discovery answers, after a request refusal, and while an already-loaded page is offline, including HTTP before certificate setup.

**Authority.** Follow the approved [mother plan](2026-11-08-a982-client-only-report-first.md), watcher 2026-11-08 12:57, and owner-supplied Lane I RUNNER §0/queue scope permitting PR3 while PR2 waits for its installed-device interface. PR1 landed at `b0251c78cd39163baa4f1ee770813d6d4be422c2`. The single Claude read is complete: `/Users/clintongormley/waitron-campaign-i/receipts/a982-setup-plan-20261110/plan-review.md`. This correction addresses its six findings; watcher approval under current RUNNER remains unclaimed.

**Implementation.** Reuse dashboard `problem-report.ts`’s capture/render/download and scoped-draft pattern in a setup-owned element using `wt-report-dialog`. Explicitly omit dashboard’s HTTPS/`isSecureContext` gate: real non-localhost plain HTTP must expose the button. Keep EN/ES copy, frozen opening metadata/ID/activity, exact editable-description preview/download bytes, retry, fresh reopen and cleanup. Retain 200 events/15 minutes/64 KiB/100 request IDs; 2,000 description code points and control-character rejection. Shared suites retain validation/bounds/dialog assertions.

Place the report element as a direct child of the header, before `.header-controls`; theme/language remain inside those controls. Add `flex-wrap` to the header; at the narrow breakpoint, report takes its own row while logo and controls stay together in the first row, language trailing. Use existing tokens/primitives and a text `wt-button`; no shared UI API. `makeSetupId(): string` uses `crypto.randomUUID` when available, otherwise UUID-v4 bytes from `crypto.getRandomValues`, with version/variant bits; never `Math.random`. Inject into instrumented fetch and `captureClientReport`.

In `main.ts`, wrap fetch with `watchBuild`/`createInstrumentedFetch`, install error capture before rendering and inject transport into real `SetupApi`. Keep first valid same-origin build; use a no-op change callback. Build may be `null` in server modes lacking the header; do not guarantee every setup mode supplies it or change servers. Keep default transport and unknown-route masking.

**Excluded.** PR4 route templates/resolved-screen vocabulary, richer privacy/trail; stored PR5–7; dashboard/till HTTP changes or shared refactoring. No submission/storage, endpoint, schema, controller, export protocol, framework or new design/spec.

**Exact implementation files** (paths below are relative; no other edits without deviation approval):

- Create under `apps/setup/src/`: `diagnostics.ts`, `problem-report.ts`, `random-id.ts`, `main.diagnostics.test.ts`, `problem-report.test.ts`, `problem-report.unsaved.test.ts`, `setup-app.problem-report.test.ts`, `random-id.test.ts`.
- Modify `apps/setup/src/main.ts`, `apps/setup/src/setup-app.ts`, `apps/setup/src/i18n/strings/shell.ts`, `apps/setup/src/setup-app.theme.test.ts`.
- Modify `apps/setup/package.json` and `pnpm-lock.yaml` to declare diagnostics directly; modify `apps/setup/vitest.config.ts` to remove the `main.ts` coverage exclusion.
- Modify `apps/server/src/guide/en/box-status.md`, `apps/server/src/guide/es/box-status.md` at `{#open}`: preserve dashboard-only HTTPS instruction; add setup wording without applying it to setup. Update `docs/backlog.md` and `docs/backlog/alerts.md` together, leaving later slices open. Include this plan, the only authoring-turn edit; `f6314c4978` already added its backlog pointer.

**Test-first responsibilities.** Observe expected failure before minimal implementation, then green. Helper tests pin native/fallback lowercase canonical hyphenated UUID-v4 format and version/variant bits; forbid `Math.random`. In `main.diagnostics.test.ts`, stub network, create `#app` and remove `randomUUID` before dynamic `main.ts` import; restore globals during cleanup. Exercise real `SetupApi` over HTTP: startup/captured request-ID agreement, fallback report IDs, first same-origin build, foreign-build rejection, masked paths and errors. No source-scanner substitute.

Header tests stub nonsecure context and a foreign network hostname, rather than relying on localhost; cover pending discovery/refusal/offline entry. Report tests cover frozen capture, exact preview/download bytes, retry, reopen, no requests/storage. Unsaved tests preserve setup drafts. Theme/header tests cover EN/ES, both themes, accessibility/overflow at 390/1280px. Restore globals/locales; await close events. Reuse shared assertions.

**Estimate/stop.** Added/removed lines: production 330/15; tests/config 520/5; docs 40/5; generated lockfile 10/0. Total ~900 added/~25 removed; stop for deviation approval before exceeding 1,350 changed lines or the file list.

**Finish verification, implementation only.** Run focused setup tests, existing API/theme checks, diagnostics report/fetch/build/error, UI report-dialog/accessibility, server guide-content and root guide-links suites; setup typecheck/build. LOOK at EN/ES header/dialog at both widths/themes on real non-localhost plain HTTP; retrieve download and compare build against expected header: first valid same-origin value, otherwise `null`. Finish through `finish-branch`, normal hook/current-head CI. Source-only correction; no behavior verified here.

# A982: download button first

**APPROVED with changes: watcher 2026-11-08 12:57.** No further Claude read/approval. A1113 **PR #2592 must merge with required current-head CI green before PR1 build**. Build budget: three hours from actual PR1 build start to open PR. Execute inline; reports→`progress.log`.

Reuse signed held pieces in a registered main worktree; no invisible foundation PR. Checkpoint `5292553cb3` versus `1f1d02fa`: 526 code/664 tests/37 docs/0 generated=1,227 additions. All 1,190 held code/test lines remain accounted: privacy 356/386 split across PR1/PR4 without double-counting; upload 170/278 stays PR5. Preserve behavioral assertions. Rounded estimates include held pieces:

| PR | CODE | TEST | DOC | GENERATED | Total |
|---|---:|---:|---:|---:|---:|
| 1 Dashboard preview/download/build exposure | ~500 | ~570 | ~60 | 0 | ~1,130 |
| 2 Till button | ~370 | ~550 | ~40 | 0 | ~960 |
| 3 Setup button | ~330 | ~520 | ~40 | ~10 | ~900 |
| 4 Richer trail | ~340 | ~430 | ~30 | 0 | ~800 |
| 5 Stored till capture | ~470 | ~480 | ~40 | ~60 | ~1,050 |
| 6 Stored dashboard capture | ~200 | ~300 | ~30 | 0 | ~530 |
| 7 Manager list/read/download | ~420 | ~500 | ~40 | 0 | ~960 |

PR4's old ~920 envelope changes with selection; ~800 awaits actual piece accounting. Each PR delivers something usable. Storage is separately planned; retain validator checkpoint for later stored capture, drop from delivery if storage is unapproved. PR5–7 need separate plans/review. Historical plan stays historical; no diagram.

**PR1 finish line:** a dashboard person can preview and download a sanitized browser activity file from a signed-in/out screen without network submission or storage.

PR1 files: diagnostics `report-description.ts`, `client-report.ts`, `path-patterns.ts`, `instrument-fetch.ts` maskPath, `report-codes.ts`, needed `trail-policy.ts`, barrel/tests; shared `wt-report-dialog`/labels/read-only-preview accessibility/export/demo/contract; dashboard `problem-report.ts`, common banner, diagnostics/main/i18n; diagnostics build-watch.ts/tests; EN/ES `box-status.md#open` guides/tests. onFirstBuild exposes first valid same-origin build, queues observers safely; preserve onChange semantics. Dashboard uses HTTPS/localhost only.

Environment: build null or ≤64 characters matching `/^(?:development|[a-f0-9]{7,64}|v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)$/`; locale en/es, effective light/dark, integer viewport width/height 1–10000, online boolean, browser chromium/firefox/safari/other. `problem-report.ts:81–90` is the supplied source receipt, not a PR1 dependency.

Include masked routes/allowlisted codes initially. Closed events api/nav/window.error/window.unhandledrejection/alerts.load_failed/theme.load_failed/server-switch retain allowlisted fields and canonical UUID-only request IDs; discard john.smith. Add disk_stop.load_failed to the allowed codes because the dashboard records it; never include arbitrary messages. Initially exclude raw paths/messages/stacks/screens/origins. Opening snapshot ≤200 events/15 minutes/64 KiB/100 request IDs; flag truncation. Description ≤2,000 code points; reject C0/C1 except tab/newline. No native maxlength. Keep pure validation reusable; bypass stored-capture age admission for downloads.

Freeze opening base metadata/id/trail. Pure rendering from current description updates the exact read-only file preview before Download; preview never calls input or freezes description. Download the visible valid bytes; regenerate no clock fields at click. Budget ~20 code/~20 test lines within PR1. Extend current shared labels for accessible read-only preview; no new record/framework/unused mode props. Synchronous Blob/anchor cleanup; failure retains editable text/retry. Preserve report-only draft scope, underlying drafts, saved-close, fresh reopen and lifecycle cleanup.

**PR2 checks:** Verify that both menus (#tillMenu and #menu) and the persistent strip beside lock, enrolment, chooser, clock and attendance open the dialog. Check dialog tracking, leaving, locale, theme and secure entry points. Verify download and file retrieval on an installed till before building; an unavailable device parks only PR2.

**PR3 checks:** Test the random-ID helper and its injection into the real SetupApi on HTTP here. Check the button before discovery, after a refusal and while an already loaded setup page is offline. Verify the header, instrumentation, dependencies and lockfile. Do not refactor dashboard or till HTTP support.

**PR4 checks:** Preserve and run the privacy assertions. Check application and origin wiring, setup route templates and resolved transitions. **PR5 checks:** Verify upload validation and stored capture. PR6 and PR7 name their checks in their separate plans before building.

**Copy:** trigger “Report a problem”; action “Download report”; problem-report-<uuid>.md, fenced JSON, Markdown/bidi escaping. Scope: “Save only this browser's activity to a file you keep; nothing is stored on the box or sent anywhere.” Warning: “Your description may identify someone. Do not include passwords, payment details or personal information.” ES scope: “Guarda solo la actividad de este navegador en un archivo que conservas; no se guarda nada en el servidor ni se envía a ningún sitio.” ES warning: “Tu descripción puede identificar a alguien. No incluyas contraseñas, datos de pago ni información personal.”

**PR1 checks:** Observe a failing test before each fix, then verify that description edits update the preview and downloaded bytes match it exactly. Check download failure and retry, old and future clocks, rejection of john.smith as a request ID, allowed disk_stop.load_failed, privacy and stated bounds. Verify the first build, rejection of foreign origins and isolation of throwing observers. Assert that reporting makes no network request, cleans up resources, reopens fresh and preserves underlying dirty forms. Run the diagnostics, dialog, accessibility, dashboard, unsaved-change and guide checks, then build. Inspect English and Spanish in both themes at 390 and 1280 pixels. Complete finish-branch, the normal push hook and current-head CI.

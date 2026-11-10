# A1315: shorten Transfers help

Owner decision, recorded by watcher 2026-11-10 17:19 in
`/Users/clintongormley/waitron-campaign-k/questions.md:733`: "Drop the third sentence (Rec.)".
Finish line: opening Transfers help shows exactly its existing first two sentences in English
and Spanish. Reuse the bubble, button and link wiring in `apps/till/src/widgets/till-shell.ts:1084`.

1. In `apps/till/src/i18n/help-strings.test.ts:82`, remove only `help.more.transfers` from the
   count-word matrix; retain the Parked and Waiting assertions. Replace the Transfers assertion
   at line 99 with exact EN/ES equality against each translation's existing first two sentences,
   copied verbatim from `help-strings.ts:46,109`. This checks both preservation and removal without
   a new sentence parser. Quote the owner in the PR's Changed test checks section, with the
   changed assertion's file and line; put no history comment in the test.
   Run `pnpm --filter @waitron/till exec vitest run src/i18n/help-strings.test.ts` before editing
   production copy: require a failure showing the old third sentence as unexpected text.
2. In `apps/till/src/i18n/help-strings.ts:45,108`, delete only sentence three of
   `help.more.transfers` in EN/ES. Preserve sentences one and two exactly. Rerun that command;
   require the whole changed test file to pass, with a reported test count.
3. In `docs/backlog.md:1429`, remove only the resolved Transfers wording/status from A1315.
   In `docs/backlog/dashboard.md:973`, delete only its resolved Transfers bullet. Retain the
   missing-guide work and A1247. No guides, helpers, frameworks, harnesses, history or CLAUDE.md edits.
4. Run the existing `till-shell.menu-help.test.ts` behavior harness. For visual inspection,
   reuse its mounting/opening support and `till-shell.help.a11y.test.ts:161` theme/locale setup
   to open Transfers help in EN/ES, light/dark, phone/desktop. Inspect the two sentences and
   existing controls; keep screenshots local and uncommitted. Add no permanent harness changes.
5. In the PR, show every changed copy before/after in EN/ES with source receipts, quote the owner
   for the changed assertions, and state that missing guide destinations remain outside this slice.

Forecast, added/removed lines: production +2/-2; tests +8/-12; docs including this plan +40/-10
(74 total). Stop for watcher assessment before exceeding 1.5 times that total (111 lines).
Expect under three hours to an open PR; apply RUNNER's waiting exclusions and over-budget stop.

This plan grants no build permission. The runner obtains the sole Claude plan read, addresses
findings, then obtains watcher clearance before building. Follow with `finish-branch` and
`land-branch` under Lane K's existing authority; add no owner confirmation step.

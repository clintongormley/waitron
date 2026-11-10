# A1315: shorten Transfers help

Status, 2026-11-10 18:02: the watcher cleared this revised plan and its simpler count/absence
check in Lane K questions.md; the waiting instruction below records the earlier plan stage.

Owner decision, recorded by watcher 2026-11-10 17:19 in
`/Users/clintongormley/waitron-campaign-k/questions.md:733`: "Drop the third sentence (Rec.)".
Finish line: opening Transfers help in the handheld form shows its existing first two sentences
in English and Spanish. Reuse the bubble, button and link wiring in `apps/till/src/widgets/till-shell.ts:1084`.

1. In `apps/till/src/i18n/help-strings.test.ts:87-91`, remove only `help.more.transfers` from
   the count-word matrix; retain the Parked and Waiting assertions. Replace the Transfers check
   at `:99-106` with a two-sentence count for EN and ES using its existing `sentences` split,
   plus absence of the old English third sentence. Preserve the first two sentences through
   the copy diff and PR before/after listing, without new permanent exact-word pins. Name the
   owner decision in the test title: `drops its third sentence (owner, 2026-11-10: "Drop the third
   sentence (Rec.)")`, and quote it with the changed check's file/line in the PR too.
   Run `pnpm --filter @waitron/till exec vitest run src/i18n/help-strings.test.ts` before editing
   production copy: require the old three-sentence copy to fail the new two-sentence count.
2. In `apps/till/src/i18n/help-strings.ts:45,108`, delete only sentence three of
   `help.more.transfers` in EN/ES. Preserve sentences one and two exactly. Rerun that command;
   require the whole changed test file to pass, with a reported test count.
3. In `docs/backlog.md:1429`, remove only the resolved Transfers wording/status from A1315.
   In `docs/backlog/dashboard.md:973`, delete only its resolved Transfers bullet. Retain the
   missing-guide work, its existing A1315 heading/anchor and A1247. The item-count fact is dropped
   by the owner's choice; it is not moved to a guide because that destination remains open.
   No guides, helpers, frameworks, harnesses, history or CLAUDE.md edits.
4. Run the existing `till-shell.menu-help.test.ts` behavior harness. Reuse its badge-tap pattern
   at `:196-219` to inspect Transfers help in the handheld form at 320 and 1280 pixels, EN/ES
   and light/dark. The till form has no Transfers bubble. Keep screenshots local and uncommitted;
   add no permanent harness changes.
5. In the PR, show every changed copy before/after in EN/ES with source receipts, quote the owner
   for the changed assertions, and state that missing guide destinations remain outside this slice.

Forecast, added/removed lines: production +2/-2; tests +8/-12; docs including this plan +40/-10
(74 total). Stop for watcher assessment before exceeding 1.5 times that total (111 lines).
Expect under three hours to an open PR; apply RUNNER's waiting exclusions and over-budget stop.

This plan grants no build permission. The runner obtains the sole Claude plan read, addresses
findings, then obtains watcher clearance before building. Follow with `finish-branch` and
`land-branch` under Lane K's existing authority; add no owner confirmation step.

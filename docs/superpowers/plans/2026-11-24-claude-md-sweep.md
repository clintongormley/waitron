# Sweep the root CLAUDE.md

Future sessions open a shorter `CLAUDE.md` with every active rule, its brief cost, its guard names and hedges, and a link to the evidence.

1. Read the introduction and §§1–7 in one pass. Keep operative commands, thresholds, exceptions and approval attributions with their rules. Move supporting words verbatim into dated “Root receipts moved on” sections in the existing guides for writing claims (§§1, 7), CI (§2), UI and data (§3), testing (§4), fiscal data (§5), and workflow (§6). Reuse an exact passage already in a guide. Adjust relative link destinations that change with the move. Merge exact duplicates and delete superseded wording only with a later rule as evidence. Name each deletion and its reason in the signed-off commit. Update the instruction-housekeeping pointer in `docs/backlog.md` if it becomes stale.
2. Keep one row in the PR table for every touched entry, with its old location, what changed, and the surviving rule or receipt link. Run `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and check the new heading links against the guide headings. Ask Claude to sample twenty moved entries against their old text across the sections, including fiscal and workflow rules. Rebase onto current main before opening the PR, preserve intervening edits, and refresh the table and checks against that base.

Expect roughly 90–100 KB in the root file after one documentation PR. Measure the result with `wc -c`. The 71 KB guide sets no gate. Product code, workflows, tests and guard definitions are outside the sweep.

# Product file size guard

CI reports the path, count and limit when a tracked product TypeScript file exceeds 1,000 lines or its recorded cap. It also reports allowances that need lowering or removal. Seed allowances from the branch's main base by rounding each count over 1,000 up to a multiple of 250.

## Scope

Add `scripts/product-file-size.test.ts` to the root Vitest project and store caps in `scripts/product-file-size-limits.json`. Follow the bounded `git ls-files -z` pattern and Git environment check in `scripts/style-token-names.test.ts`. Read selected regular files once. Count physical lines, including blanks, comments and a final unterminated line.

Select `.ts` files under `apps/*/src/` and `packages/*/src/`. Exclude `.test.ts`, `testing/`, `test-helpers.ts`, `.test-helpers.ts`, `.test-support.ts`, `.test-fixture.ts` and `.fixtures.ts`. Translation tables use `strings.ts`, `i18n/strings/`, package `src/starter-content.ts`, dashboard and till `i18n/codes.ts`, dashboard `i18n/alert-messages.ts`, till `i18n/help-strings.ts` and VeriFactu dashboard `conflict-recovery-strings.ts`. Exclude country packs' `src/demo/` data and the two verified generated paths `packages/printing/src/glyphs.ts` and `packages/reporting/src/dr303-layout.ts`.

Put the rule, test name and “weaker than its name” in `CLAUDE.md`. Give the exact exclusions in the CI guide. The scan misses untracked files, other extensions, code outside `src/`, and resolver code mixed into excluded catalogues. Changes to the caps themselves need human review. A later pair of PRs can each fit a cap and exceed it together. Main's guard evaluates the combined result. File splits and CI workflow changes are outside this item.

## Build and verify

- Start with failing cases for the comparison of `{path, lines}` records against the caps. An unlisted file fails at 1,001 and passes at 1,000. A listed file fails one line over its cap and passes at the cap. A gap of 250 below the cap passes and 251 calls for lowering. Below 1,000 or removal calls for deleting the entry.
- Check that the named exclusions accept oversized examples. Include `filing-cases.ts`, `popup-helpers.ts`, `test-page.ts` and the locale controller as oversized product examples that must fail. Use the real checkout for the main guard and the poisoned Git environment case. Run `pnpm exec vitest run scripts/product-file-size.test.ts`. Prove both sides by dropping each comparison and exclusion in a disposable copy and observing its case fail. Restore and rerun.
- Run normal finish-branch and require current-head root guards. Before landing this guard, run it on a disposable merge of the current `origin/main` and the PR. Record both SHAs. Repeat if the landing lock's re-fetch finds changed product inputs. A failure goes back through finish-branch before landing.

About 60 lines for scanning and comparison, 95 cap rows, 65 lines of tests and short rule and evidence notes. The queue supplies the request. There is no matching open backlog entry to retire.

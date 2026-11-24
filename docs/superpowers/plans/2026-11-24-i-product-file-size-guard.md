# Product file size guard

CI will report the path, line count and limit when a tracked product TypeScript file grows past 1,000 lines or its existing allowance. It will also report when a file has shrunk enough to lower or remove its allowance. The existing files get allowances in 250-line steps, giving in-flight work room to land.

## Scope

Add `scripts/product-file-size.test.ts` to the existing root Vitest project and put the initial allowances in `scripts/product-file-size-limits.json`. Keep the scan in the guard. Reuse the bounded `git ls-files -z` pattern from `scripts/style-token-names.test.ts`, including clearing Git location variables. Read each selected working-tree file once. Count physical lines, including comments, blank lines and a final line without a newline.

Select tracked regular `.ts` files under `apps/*/src/` and `packages/*/src/`. Omit test files and test-support paths, translation catalogues (`strings.ts`, `starter-content.ts`, and the app `i18n/codes.ts` tables), demo data under `src/demo/`, and generated files in designated generated paths or with a generated header such as `packages/printing/src/glyphs.ts`. Include app logic such as the locale controller and demo-seed code. Document the named path and header conventions in `CLAUDE.md` and the CI guide. The check can miss data or test support under unfamiliar names, and a limit change is visible for human review. It measures file length. Splitting current files and changing CI jobs are separate work.

## Build and check

- Start with failing guard cases in a disposable Git fixture. A 1,001-line new product file fails and a 1,000-line file passes. A listed file passes at its recorded limit and fails one line over. A drop of 250 lines passes, a drop of 251 calls for a lower limit, and a listed file below 1,000 or removed calls for removing its entry. An oversized file from each excluded class passes, while oversized test-like or locale-related product code still fails.
- Seed the JSON from the selected files on the captured main base. Include only those over 1,000 lines and round their counts up to a multiple of 250. Use the same scan for the fixture and the actual checkout. Confirm a clean run with `pnpm exec vitest run scripts/product-file-size.test.ts` and repeat with `GIT_DIR` set to prove the fixture uses its own index.
- In the disposable checkout, prove both directions. Stage a new oversized file and grow a listed one past its cap, then restore them. Shorten a listed file far enough to make its allowance stale, then lower or delete its row as directed. Record the expected failures and restored pass. Run the normal pre-push hook and require the current-head root guard job before landing.

About 75 lines for the scan, 95 lines of allowances, 75 lines of tests and short rule and evidence notes. The queue item supplies the request. There is no matching open backlog entry to remove.

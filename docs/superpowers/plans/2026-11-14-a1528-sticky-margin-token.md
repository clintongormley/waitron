# A1528 regression: token-only sticky margin

**Finish:** Setup's unchanged token-only style check passes, while fields under sticky tabs still scroll below their measured strip and ordinary fields keep zero extra margin. Watcher20:21 (14 November), Lane I questions.md: “Fix it next, ahead of A1527 PR1: make the fallback a token (or declare the variable where the test expects), never a guard exception that hides it, and run apps/setup's and every other consumer's token tests locally … One small PR”. The watcher requests the repair; no owner design approval claimed.

**Smallest change/reuse:** Declare `--wt-tabs-sticky-height: 0px` with structural defaults in `packages/ui-core/src/tokens/structure.css`; change `packages/ui-core/src/base-styles.ts` to read that variable without a fallback. `wt-tabs` already sets its measured value on its own host and passes it down. Do not put the default on each component host: that would replace an inherited measured value. No guard exception, new helper or UI behavior. Add the token to the existing structural-contract list in `tokens/structure.test.ts`; preserve every existing assertion.

Drive inline with TDD; this is a repair to A1528-4, not a new product feature.

- [ ] Reproduce the unchanged `apps/setup/src/screens/done-screen.test.ts` “writes its styles in tokens only” failure first. A startup/project-selection error is not a reproduction.
- [ ] Apply the two production-line changes and the one structural-contract entry.
- [ ] Run the whole changed structural test file plus ui-core's `base-styles.test.ts`, `no-hardcoded-chrome.test.ts`, `tokens/apply-tokens.test.ts`, `tokens/multi-root.test.ts` and `theme/tokens.test.ts`; run ui's `no-hardcoded-chrome.test.ts` and existing sticky-tab suite; run setup's whole `done-screen.test.ts`.
- [ ] Run root `scripts/style-token-names.test.ts`, `scripts/no-hardcoded-chrome-views.test.ts` and `scripts/guide-page-tokens.test.ts`. These are the cross-tree token readers. Trace other tests matching the inherited-styles/fallback check before claiming all consumers covered; run any additional matching guard found.
- [ ] Keep the full-branch Claude review, normal hook and current-head CI, then land before A1527 PR1 and append the merge receipt to questions.md for lane F. No new guide text/layout: this restores the intended existing presentation. No backlog regression entry exists to remove; A1528's finished entry was already deleted by #3218.

Expected physical production +2/−1, tests +1/−0, plan about20lines. If a runtime consumer needs more than this repair, ask the watcher before growing it. A1527 PR3227 stays green and unmerged while this priority repair lands.

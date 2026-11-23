# Lane D stale-comment guard

The Lane D watcher queued the `docs/backlog/ci.md` entry “A throwaway script found six comments
that described code that was no longer there, and it is not a guard yet”. Codex wrote this plan.
The lane driver checks it and sends it to Claude for review. The watcher clears the build after
Claude’s review.

**Scope.** Keep the scanner and its tests in `scripts/stale-comment-guard.test.ts`, following
`scripts/help-tooltip-mode.test.ts` in the root Vitest project. List checked-in `.ts` files under
`apps/` and `packages/` with `git ls-files -z -- apps packages`, using the bounded call and cleared
Git location variables from `scripts/primary-coloured-text.test.ts`. Use the root TypeScript parser
to read leading block comments attached to property signatures. Take a backticked camelCase or
snake_case name at the start of the comment on an inline object-typed property, or at the start
of a comment line immediately followed by `below` on any property signature. Use the first match.
Look for an exact identifier token in the attached property’s syntax tree. Text in strings and
other comments is ignored. Report missing names as `path:subject-line name`. For `below` headers,
allow the immediately following sibling property to supply the name. The comment on `origin` at
`packages/fiscal-verifactu/src/registro-row.ts:29` also describes `nodeId` at line 34.

- [ ] **Start with a failing test.** Name the cases `accepts a live subject` and `reports a removed
  subject`. Use the `MeApiDeps.cfg` excerpt from `git show 91caf00d9a^:apps/server/src/me-api.ts`,
  preserving line numbers. Expect `[]` with `tenantId: string` present. Delete only that field and
  expect exactly `apps/server/src/me-api.ts:63 tenantId`. Check the refusal fails on the missing
  diagnostic before implementing it, then passes. Add `accepts a block header for the next member`
  using the `origin`/`nodeId` excerpt. Watch it report `nodeId` before adding the allowance, then pass.
  Delete `nodeId` from that excerpt and expect the diagnostic to return.
- [ ] **Prove the tests.** Run `pnpm exec vitest run scripts/stale-comment-guard.test.ts` with `-t`
  and the exact case name for each red/green check. In a disposable checkout, disable the missing
  subject report, the live identifier check and the header allowance one at a time. Rerun the
  corresponding case and confirm each fails at its assertion. Restore each change before the next.
- [ ] **Clean up from a fresh report.** Run the file without `-t` to run `reports no stale subjects
  in the tracked tree`. Verify each current hit against its code and delete confirmed stale
  comments. If legitimate hits fall outside the header rule, revisit the trigger with Claude
  before adding exceptions. Rerun to zero hits and check the test count. Delete the backlog entry
  in the PR and name the guard in `CLAUDE.md` §1 as “weaker than its name”, limited to those
  property-comment shapes.

**Estimate.** 45–65 added implementation lines and 30–40 added test lines. Write **OVER BUDGET**
before the PR if tests exceed 60 added lines.

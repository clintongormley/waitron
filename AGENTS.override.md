# Codex instructions for Waitron

Read `AGENTS.md` (the symlink to `CLAUDE.md`) for the repository rules. Apply the
Codex-only owner decisions below in place of blanket pre-PR test and browser
serialization requirements in that file and its referenced repository guidance,
including the coordination rules in `docs/backlog.md`. All other rules, including fiscal invariants,
sign-offs, normal hooks and merge approval, remain in force.

These exceptions govern Codex-hosted work and workers assigned by that session.
A Codex worker dispatched by Claude follows its parent's workflow and brief;
these exceptions do not change Claude's work.

- Before a PR, run tests appropriate to the changes and affected consumers. Use
  focused failing regressions during development and the normal scoped hook for
  final package coverage. Do not add a full workspace test run or duplicate
  coverage solely because a PR is next. Re-run affected checks when code or
  dependencies change, a check fails, or a concrete concern remains unresolved.
- Browser suites may overlap when resources permit. Check other active heavy
  test runs and machine pressure first, bound concurrency, isolate conflicting
  ports/outputs/resources, and scale back when several sessions are testing.
  The owner's 2026-09-06 clarification attributes the memory incident to several
  sessions running browser tests simultaneously; it does not justify a permanent
  serial-only rule. Use the normal approval mechanism for host browser execution
  when the sandbox blocks it.
- Use the Codex-hosted `$finish-branch` overrides: cleanup during implementation,
  two concurrent independent reviews, independent checks during the frozen review
  phase, focused reviewer experiments, and direct handling of small corrections.
  Do not modify the reviewed source, index or HEAD until both reviewers return.

# A1610 sent-order-open guard implementation plan

Keep the scan for literal writes that reopen orders comfortably inside its 30-second CI limit.
GitHub-hosted job 140003829093 spent 36.995 seconds in the whole-tree case and 274 seconds in the
root suite, compared with 161 and 182 seconds in jobs 139990239876 and 140005724171. Among 119 files
that took at least 100 ms in the next hosted run, the median time ratio was 1.57; the TypeScript move
suite took 72 versus 43 seconds. The reopen case took 7.2 seconds locally without coverage and 22.5
with it. In the local profile, parsing took 2.06 of 2.42 seconds after reads. The two-stage text
check selected 486 of 3,584 files and kept the same finding.

The watcher assigned this in Lane I `questions.md` at 16:37 on 26 November 2026: “A1610, the
sent-order-open guard timeout, is yours (queued first). Root cause, not a retry or a bare limit raise.”
Lane I reported the failure, parsing cost and slower root-suite timings to Lane C in its
`questions.md`. The watcher cleared the plan with these timing checks at 16:50 on 26 November 2026.

1. Edit `scripts/sent-order-open.test.ts`. Write `skips parsing text missing either required word`
   first, using the TypeScript spy pattern from `scripts/no-history-length.test.ts`. Assert that a
   file mentioning only `open` and a file mentioning only `status` with an unrelated Unicode escape
   both yield no findings and together make zero real `ts.createSourceFile` calls. Watch the old
   guard fail on the call count. Retain this test to catch a return to unnecessary parsing.
2. At the start of `openingWrites`, require both `status` and `open` case-insensitively in the raw
   text or, when the source includes a backslash, in the text from `decodeEscapes` in
   `scripts/no-till-as-issuer.mjs`. Let the existing parser examine the original source for any
   candidate. Extend the existing cases with an escaped TypeScript key and value, an escaped
   `sql.raw` string, and uppercase SQL. Use `String.raw` for escaped examples and confirm the words
   are absent from their raw input. Leave existing assertions, traversal, file selection, timeout,
   and CI job intact. Expect about six scanner lines and 15–20 test and spy lines.
3. Run the focused file. Measure the whole-tree case against the original and candidate trees on
   the same Mac with `pnpm exec vitest run --coverage
   --reporter=verbose scripts/sent-order-open.test.ts`, using separate coverage report directories.
   A one-file coverage diagnostic checks time while CI checks aggregate coverage. Aim for a local
   case at most 15 seconds so the 30-second limit still has room for the observed hosted slowdown.
   If the candidate misses that target, investigate before pushing. Record the current-head CI
   runner, selected root-guards result and case time. Use a CI result to judge timing only when
   GitHub Status shows no relevant incident during the run, logs show no download 5xx, and the
   run's slowest checkout step takes under about 10 seconds. Name the runs in the PR and check the
   merge's own run after landing.
   Recheck the backlog for A1610 and remove any completed entry. It has no entry as of this review.

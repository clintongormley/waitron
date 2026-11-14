# A1398-2: share syntax in the combined table-write detector

**Ask and authority.** Lane I `~/waitron-campaign-i/queue.md`, A1398-2:
“every CI test job finishes in about four minutes (owner, 2026-10-09 and 2026-10-11; CLAUDE.md §2: "Fix the cause, never cut a check"). Measure the cause before a performance plan; at most one page, Claude review and watcher clearance.”
A separate high-effort Sol invocation drafted this plan; Claude reviewed it on 14 November (177 s),
and the driver accepted its scope and test corrections. The watcher cleared the corrected plan
at 13:01 on 14 November in Lane I questions.md; no owner design approval is recorded.

**Measured cause.** Driver measurements at `30e1703a68f3625510fb35ae2211d7cb00070c30`: hosted PR run `43590761440` root 278 s/test step 250 s; write-path suite 23 cases/13.838 s.
Its 11 s checkout makes hosted timing diagnostic only. Local unchanged focused run: 23/23 pass,
zero skipped, 9,107.375 ms summed case time. Profile with two other guards: 37/37 pass;
7,173.360 ms directly in the combined `ANY_TABLE` regexp, 393.487 ms in this worker's comment blanking.
`ANY_TABLE` repeats statement and builder prefixes through `detector(table)` for 18 listed tables.
Receipts: `~/waitron-campaign-i/receipts/root-cause-20261114-1253/{scanners-cpu-summary.json,write-path-original.json,write-path-timing.log}`.
Timing-only instrumentation passed 23/23 and was fully removed. No candidate has been built or tested.

**Smallest result and files.** Change only the combined `ANY_TABLE` construction in
`scripts/write-path-tables.test.ts` to `detector(` followed by the non-capturing SQL-name group
`(?:${TABLES.join("|")})`. Keep `detector(table)` and `schemaObject(table)` unchanged:
the latter already converts each underscore name inside that group to its camel-case object name.
Add one clause to the helper's comment explaining its grouped input. Preserve per-table `DETECTORS`,
allowances, flags `im`, boundaries, comment blanking, source inventory and every existing assertion.
No helper, module, table change, exemption, cache, capacity/shard/routing change, reduced test count,
timeout change or dependency. Expected scanner/comment +2/-2, behavioural tests +20/-0,
runtime production +0/-0 (all counts are lines). Change only its own summary in `docs/backlog.md`
and 2–4 detail lines in `docs/backlog/ci.md`; retain A1398-2 pending whole-job qualification.

- [ ] **Red first.** Keep timing checks outside the committed suite. Retain the original 23-pass,
  zero-skip receipt above: its sum exceeds 3,000 ms. Focused command for comparable JSON receipts:
  `pnpm exec vitest run scripts/write-path-tables.test.ts --pool=forks --reporter=json --outputFile="$receipts/write-path.json"`.
  Set `$receipts` outside the repo; retain exit status and sum `assertionResults[].duration` in ms.
- [ ] **Pin the changed predicate, then factor.** Add two tests calling
  `ANY_TABLE.test(blankComments(source))` directly. One loops over `TABLES`, accepting
  `INSERT INTO ${table}` and `database()\n  .insert(${schemaObject(table)})`: uppercase SQL
  distinguishes `i`; text before the chained line distinguishes `m`. The other refuses the existing
  prose, `nodeMembership`, `this.cache.delete(nodes)`, read and comment-only near-misses.
  Existing per-table cases retain responsibility for syntax. Then group the names; no second detector.
- [ ] **Bounded controls and green.** In a disposable copy remove one name from the shared group:
  the SQL/builder loop must fail; restore it. Insert one existing forbidden write in a production
  source there, without executing it: the inventory assertion must fail; restore and pass.
  Run three sequential unprofiled focused candidates, all cases passing/zero skipped and summed
  case time <3,000 ms each. A miss returns to the watcher, without enlarging scope.
  This local target predicts no hosted or whole-job saving.
- [ ] **Finish and qualify.** Driver runs `finish-branch` Claude review, fresh fixes read as required,
  normal hook and this PR's own current-head CI. No extra dispatch, rerun, hosted marker or routing change.
  Read actual runner type, root inventory/coverage, test-step and whole-job time against 240 s; self-hosted
  data cannot substitute for hosted qualification. Keep the overall goal open unless qualified evidence closes it.

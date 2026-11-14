# A1398-2: share syntax in the combined table-write detector

**Ask and authority.** Lane I `~/waitron-campaign-i/queue.md`, A1398-2:
“every CI test job finishes in about four minutes (owner, 2026-10-09 and 2026-10-11; CLAUDE.md §2: "Fix the cause, never cut a check"). Measure the cause before a performance plan; at most one page, Claude review and watcher clearance.”
This is a new draft: no Claude plan review, watcher clearance or owner design approval is recorded.
The owner's current prompt authorises finish/land, not this new design. The driver obtains one Claude plan review and watcher clearance before implementation; this writing task ends at the draft.

**Measured cause.** Driver measurements at `30e1703a68f3625510fb35ae2211d7cb00070c30`: hosted PR run `43590761440` root 278 s/test step 250 s; write-path suite 23 cases/13.838 s.
Its 11 s checkout makes hosted timing diagnostic only. Local unchanged focused run: 23/23 pass,
zero skipped, 9,107.375 ms summed case time. Profile with two other guards: 37/37 pass;
7,173.360 ms directly in the combined `ANY_TABLE` regexp, 393.487 ms in this worker's comment blanking.
`ANY_TABLE` repeats statement and builder prefixes through `detector(table)` for 18 listed tables.
Receipts: `~/waitron-campaign-i/receipts/root-cause-20261114-1253/{scanners-cpu-summary.json,write-path-original.json,write-path-timing.log}`.
Timing-only instrumentation passed 23/23 and was fully removed. No candidate has been built or tested.

**Smallest result and files.** In `scripts/write-path-tables.test.ts`, extend `detector(table, object = schemaObject(table))` to accept grouped SQL names and, separately, grouped
camel-case object names. Build `ANY_TABLE` through that grouped form, sharing its syntax prefixes.
Keep each per-table `DETECTORS` expression and allowance enforcement exactly as before.
Only if needed, add a tiny callable any-listed-write helper in this file for literal cases; the existing scan must use that same combined predicate, retaining its single comment-blanking pass.
Preserve flags `im`, name boundaries, comment blanking, source inventory and every old assertion.
Tables, layout and shared tokenizer stay unchanged. No new scan, module, allowlist, exemption,
SQL runtime change, cache, capacity/shard/routing change, disabled test, test-count reduction,
timeout change or dependency. Expected scanner support +8/-3, behavioural cases +15/-0, runtime production +0/-0. Later change only its own short sentence in `docs/backlog.md` and
2–4 detail lines in `docs/backlog/ci.md`; retain A1398-2 pending whole-job qualification.

- [ ] **Red first.** Keep timing checks outside the committed suite. Retain the original 23-pass,
  zero-skip receipt above: its sum exceeds 3,000 ms. Focused command for comparable JSON receipts:
  `pnpm exec vitest run scripts/write-path-tables.test.ts --pool=forks --reporter=json --outputFile="$receipts/write-path.json"`.
  Set `$receipts` outside the repo; retain exit status and sum `assertionResults[].duration` in ms.
- [ ] **Pin behaviour, then factor.** Preserve every old assertion. Add a compact literal matrix for
  combined SQL insert/update/delete/truncate, qualified/aliased SQL and listed names; namespaced/cast
  builders; case-insensitivity; comment-separated syntax; comment-only, unlisted and prefix near-miss
  negatives. Reuse existing examples where possible; no second detector implementation. Include literal
  `insert into node_pair_link` and `tx.insert(nodePairLink)` acceptance rows. Then factor shared syntax.
- [ ] **Bounded controls and green.** In a disposable candidate, separately remove that grouped SQL
  name and object alternative: their explicit acceptance rows must fail; restore and confirm pass.
  Insert an existing forbidden write in a production source there, without executing it: the existing
  inventory assertion must fail; restore and pass. Run three sequential unprofiled focused candidates,
  each all cases passing/zero skipped and summed case time <3,000 ms. A miss returns to the watcher;
  do not enlarge scope. This local target predicts no hosted or whole-job saving.
- [ ] **Finish and qualify.** Driver runs `finish-branch` Claude review, fresh fixes read as required,
  normal hook and this PR's own current-head CI. No extra dispatch, rerun, hosted marker or routing change.
  Read actual runner type, root inventory/coverage, test-step and whole-job time against 240 s; self-hosted
  data cannot substitute for hosted qualification. Keep the overall goal open unless qualified evidence closes it.

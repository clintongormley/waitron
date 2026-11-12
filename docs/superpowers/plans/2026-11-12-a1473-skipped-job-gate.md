# A1473: accept an omitted skipped job in the final CI gate

Superseded 2026-11-12 19:33 (CI-gate-skipped): the exception now covers every needed job.

**Request:** Watcher, Lane I `questions.md`, 2026-11-12 15:23:
“New small fix, before the drill: the final ci gate failed #2935 (run 43229439512) after 21 polls with "no job in the jobs API for: server-probe", though its needs result says skipped; GitHub's jobs API omitted the skipped record (an earlier run had it). Make the gate accept the saved needs result "skipped" when the API has no record for it, with a test, one small PR.”

**Finish line:** ordinary CI can finish when `server-probe` is absent from the
complete jobs inventory and its saved `needs` result is exactly `skipped`.
An API record, when present, still receives every existing check. Missing
successful jobs still wait and fail; failed or cancelled jobs still fail.
Every other missing job still waits and fails, even when saved as skipped.
`server-probe` runs only on an explicit manual probe; its ordinary-run
condition is false.

**Reuse and scope:** keep the existing shell/jq gate, paging, retry limits,
selected-coverage checks and `runCrossCheck` test harness. No new collector,
workflow, API request, routing change or controller change. This does not
complete A1473's publication or overflow drill. Codex wrote this plan; the
watcher requested the fix and cleared the server-probe-only scope in Lane I
`questions.md`, 2026-11-12 15:32: “Take the Claude read's narrower route: the
absent-record exception applies to server-probe only”. Claude's
109-second read accepted the approach subject to the scope decision above;
its report is Lane I `receipts/firing-20261112-1524/plan-review.md`.

**Files:** `.github/workflows/ci.yml` owns the missing-job decision and its
diagnostic; `scripts/ci-workflow.test.mjs` owns executable shell regression
cases. Update the corresponding claims in `docs/developers/ci-and-gates.md`
and the existing CI bundle in `docs/backlog.md` / `docs/backlog/ci.md`.
Retire the blanket missing-job claim in the step's comment and the guide's
API polling / delayed-record paragraphs. Keep reusable caller naming
unchanged; the observed omission and exception concern only `server-probe`.

**Build and verification:**
- [ ] Add a shell case with successful lint plus absent skipped server-probe;
  observe the gate fail for the missing job before implementing the exception.
- [ ] Filter the existing `missing` list by the
  cleared server-probe-only scope and print why that absence passes. Leave verdict ordering
  and present-record checks unchanged.
- [ ] Check incomplete inventory still refuses with absent skipped jobs.
  Reuse existing bad API conclusion, missing success, bad-needs and
  selected-coverage tests rather than duplicate them.
- [ ] Run the changed workflow test file, normal hook, Claude built-work review
  and current-head required CI. The shell regression must fail with the
  exception removed; green PR CI alone cannot prove an API omission occurred.
  Land before the staged overflow drill.

**Expected size:** production +8/-5 lines; tests about +50/-0, no new test support;
documentation about 65 lines including this plan. One small PR.

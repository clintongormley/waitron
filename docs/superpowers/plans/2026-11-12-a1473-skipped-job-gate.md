# A1473: accept an omitted skipped job in the final CI gate

**Request:** Watcher, Lane I `questions.md`, 2026-11-12 15:23:
“New small fix, before the drill: the final ci gate failed #2935 (run 43229439512) after 21 polls with "no job in the jobs API for: server-probe", though its needs result says skipped; GitHub's jobs API omitted the skipped record (an earlier run had it). Make the gate accept the saved needs result "skipped" when the API has no record for it, with a test, one small PR.”

**Finish line:** ordinary CI can finish when a needed job is absent from the
complete jobs inventory and its saved `needs` result is exactly `skipped`.
An API record, when present, still receives every existing check. Missing
successful jobs still wait and fail; failed or cancelled jobs still fail.

**Reuse and scope:** keep the existing shell/jq gate, paging, retry limits,
selected-coverage checks and `runCrossCheck` test harness. No new collector,
workflow, API request, routing change or controller change. This does not
complete A1473's publication or overflow drill. Codex wrote this plan; the
watcher requested the fix, but has not yet cleared this plan.

**Files:** `.github/workflows/ci.yml` owns the missing-job decision and its
diagnostic; `scripts/ci-workflow.test.mjs` owns executable shell regression
cases. Update the corresponding claims in `docs/developers/ci-and-gates.md`
and the existing CI bundle in `docs/backlog.md` / `docs/backlog/ci.md`.

**Build and verification:**
- [ ] Add a shell case with successful lint plus absent skipped server-probe;
  observe the gate fail for the missing job before implementing the exception.
- [ ] Exempt only absent jobs with saved `skipped` results from the missing
  list, and print why that absence passes. Keep all present records checked.
- [ ] Check that a failed/cancelled API record still refuses despite saved
  `skipped`, and incomplete inventory still refuses. Reuse existing missing
  success, bad-needs and selected-coverage tests rather than duplicate them.
- [ ] Run the changed workflow test file, normal hook, Claude built-work review
  and current-head required CI. Use the first red/green run as the deletion
  control for this exception. Land before the staged overflow drill.

**Expected size:** production +5/-2 lines; tests +40/-0, no new test support;
documentation about 50 lines including this plan. One small PR.

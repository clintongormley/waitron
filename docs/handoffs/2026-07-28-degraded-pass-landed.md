# Handoff — the degraded pass is legible, and the previous handoff was wrong about two of its own deferrals

**Date:** 2026-07-28
**Type:** *Backward-looking* — what shipped, what the review layers caught that the tests could not, and what is genuinely left.
**Main at handoff:** `4819f83`.

| PR | Squash | What |
| --- | --- | --- |
| #36 | `4819f83` | **The degraded-pass cycle** — skip cadence, `Agent` lifetime, pass duration, and `duty.degraded` |

27 files, +3278/−173. `apps/server` is 12 suites / 130 tests, still 100% on all four coverage metrics; `@waitron/scheduler` 87, `@waitron/fiscal-verifactu` 185.

Spec: [`2026-07-27-degraded-pass-design.md`](../superpowers/specs/2026-07-27-degraded-pass-design.md).
Plan: [`2026-07-27-degraded-pass.md`](../superpowers/plans/2026-07-27-degraded-pass.md) — 8 tasks.
Amended: server-host design §7, §8, §9, §10, §14; recurring-work-scheduler design §280's `TickResult.nextDueAt` contract.

---

## 1. What this is, in one idea

**`apps/server` was correct about a degraded pass and unreadable about one.** #35 taught it to flip 503 when a tenant is skipped or a run is parked. It then retried the unfixable at the 5-second floor forever, reported no pass duration, and said nothing about a duty's cumulative state.

That mattered more than it sounds, because **the degraded state is what the first deployment boots into** — no qualified certificate exists, so every `drain` pass skips every tenant while `apps/till` writes sales against the same host.

Now: both duties report `now + skipRetryMs` instead of `now`, **folded as a minimum**; each tenant's mTLS `Agent` is closed at end of pass; `pass.complete` carries `durationMs` (pass-level and per duty); and a new `duty.degraded` line escalates on staleness.

| | passes/day | log lines/day (one skipped tenant) |
| --- | --- | --- |
| Before | 17,280 | ~86,400 |
| After | 288 | ~1,728 |

## 2. The previous handoff was wrong about two of its own deferrals

Both errors were found by reading the code against the handoff before planning, and both changed the cycle's shape. **Check a handoff's claims before costing work from them — this one's were written from memory of the branch, not from a re-read of it.**

**Terminal-outcome logging was already done.** §7 said "*a `failed` or `parked` reconcile run appears in no log line beyond the new counts; `RunRecord.errorCode` is never read*". It was read — `logNonSucceededRun` had landed in #35's own fix wave, and the server-host spec's §9 amendment documented it. The cycle was three items, not four.

**The unclosed `Agent` was not coupled to the skip cadence.** §7 argued "*5 seconds × an unclosed pool is different arithmetic from one per hour*", so the two had to be done together. They did not: on the missing-certificate path `aeatClientResolver` throws inside `readCertMaterial` **before** reaching `createClient`, so `mtlsFetch` is never called and **no `Agent` is ever constructed**. The leak is real, but its worst case is a *healthy* multi-tenant deployment. The final review confirmed this empirically: in the first-deployment state, zero `Agent`s are built and `closeAll` iterates an empty list.

**The volume estimate was ~17× too high** (~1.5M lines/day claimed, ~86,400 actual). Same conclusion, wrong arithmetic.

## 3. One knob could silently defeat the entire cycle, in both directions

`sleepMsFor` clamps the reported instant into `[minTickMs, maxTickMs]`. So `WAITRON_SKIP_RETRY_MS` could be clamped away at **either** end — and being clamped does not merely lose the operator's setting, **it restores the exact 5-second spin the cycle exists to remove.**

The spec explicitly declined to validate this: *"a value below the floor clamps up and a value above the ceiling clamps down, both harmlessly."* That reasoning was wrong twice over.

- **Below the floor** was caught by `/code-review` and escalated as a decision, since it contradicted an approved spec line. Ruling: refuse to boot.
- **Above the ceiling** was caught by the fresh-context review afterwards — and the spec, by then amended, had acquired a *new* absolute claim that this half could "**never**" restore the pathology. `WAITRON_MAX_TICK_MS=5000` alone passes every pre-existing guard and clamps a 5-minute retry to 5 seconds.

Both now throw `server.config_invalid` (`below_min_tick`, `above_max_tick`), naming **both** variables and both effective values — the one at fault is frequently the one the operator *did* set. **Shipping a false safety assertion is worse than shipping the unguarded knob**, and this cycle did it once, in a document written to correct exactly that class of error.

## 4. Defects found, and by what

**Every task was individually reviewed and green before any of this.** All of the following came after.

| Layer | Raised | Actioned | Notable |
| --- | --- | --- | --- |
| Whole-branch review | 10 | 9 | Nothing pinned which config field reached which duty |
| `simplify` (4 angles) | 7 | 2 | `drain.ts` re-implementing its own helper |
| `/code-review` | 12 | 11 + 1 escalated | The `below_min_tick` hole; an order-dependent test |
| Fresh-context review | 7 | 7 | The `above_max_tick` hole; a regression from our own fix |
| Copilot | 7 | 3 | A rule applied in one place and missed in another |

The four worth carrying forward:

**`drain.ts` was re-implementing `bumpNextDue`** — the helper it names *in the comment directly above*, already used three times in the same file. Three of four `simplify` agents converged on it independently. **No correctness review saw it**, across two whole-branch passes: `simplify` is not redundant with `/code-review`.

**A fix wave introduced a regression.** Making `closeAll` concurrent (an efficiency finding) lost containment of a *synchronous* throw from `close()`: `.map(t => t.close().catch(…))` intercepts rejections only, so a synchronous throw escapes `Promise.allSettled` entirely, rejects into `boot.ts`'s `finally` — replacing the sweep's own error — and abandons every transport queued after it, with `open.splice(0)` having already dropped the handles. Caught by the next review layer, not by the wave's own verification.

**Nothing pinned the wiring.** Writing `skipRetryMs: config.minTickMs` in `boot.ts` would have kept 13/13 typecheck, every unit test, and 100% coverage green while reintroducing the whole defect. Fixed with an end-to-end boot test, verified by actually making that edit and watching it fail. The same standard then had to be applied a second time, to the `finally { closeAll() }` — the branch had applied it to one change and not the other.

**Copilot's best finding was, for the second cycle running, "a rule this branch already applied elsewhere and missed in one place."** A review corrected a too-absolute claim in `runDue`'s fold comment; the identical claim sat in `drain.ts`'s twin comment and was missed. Copilot found it hours later. **This is now a reliable pattern, not a coincidence: when a review corrects something, grep for its twin before committing.**

## 5. Patterns worth carrying

*First:* **the plan's own text was the defect source again**, and the biggest instance was discovered at planning time, not design time. The spec mandated "one literal, no package-level default" — unworkable, because `VerifactuBackendOptions` has **57 construction sites across 10 files** and `DEFAULTS` is spread as a *complete* `SchedulerDeps` in five places. Planning is a real review of the design; budget for the spec changing during it.

*Second:* **two documentation corrections silently overwrote historical records** instead of amending them, in a repo whose specs use dated supersession blocks throughout — once in §8 while the *same commit* correctly amended §7. Both were caught. When correcting a dated design doc, the question is always "amend or overwrite", and the answer is always amend.

*Third:* **`format:check` broke the branch twice.** It is not covered by `lint`, and both gates are required. This is the second cycle it has bitten.

*Fourth:* **a narrow grep is a false negative generator.** The first documentation pass grepped `5 second|5s|hot loop|MIN_TICK|log volume|due now` and missed "retries next pass" — a stale claim that then contradicted a paragraph 16 lines below it in the same file. Widening the pattern found two more in a different file.

*Fifth:* **two of Copilot's seven comments were false positives on already-fixed code**, re-surfacing because surrounding lines changed. Verify before acting; reply with the evidence rather than silently resolving.

## 6. What remains

### The one coherent next cycle

**C3, the webhook endpoint** — the last piece of sub-project C. It has a genuine unresolved design decision first: verifying a Stripe signature needs *that tenant's* secret, while the tenant is only discoverable from the unverified payload. Tenant-in-the-path versus per-secret trial. `/health` already gives it a server to attach to.

### Small, and blocking more than it looks

- **`@waitron/db` has no `exports` map.** This is the prerequisite behind the sixth copies of `startRealPostgres` and `test/seed.ts`. Worth its own task before a seventh appears.
- **A `withAeatTransport` RAII helper.** `boot.ts` hand-writes the `try`/`finally` that releases the per-pass transports; nothing in `ClientResolver`'s shape stops a second call site forgetting it and reintroducing the leak. The repo already has the convention (`withTenant`). Deferred as scope creep with one call site — the webhook cycle plausibly adds the second.

### Still open from #35

- The empty-database grant recipe in the README is hand-verified, not test-covered.
- Nothing validates that `WAITRON_MIGRATIONS_DATABASE_URL` and `DATABASE_URL` address the same database.
- `server.listen_failed` is not bind-scoped.
- `bin.ts` still has no `try`/`catch`.
- `packages/db`'s `createPostgresDb` swallows pool `'error'` events; an optional `onPoolError` would close it.

### Accepted, recorded, not a defect

A whole-duty **throw** still reports `now` deliberately, so a database outage keeps the 5-second cadence — and now emits two extra `duty.degraded` lines per pass: ~69,120 → ~103,680 lines/day. **This cycle reduces the skip case ~50× and increases the outage case ~1.5×**, on the same single-node disk. Recorded in the spec rather than left to be discovered during an outage.

### Unchanged

**`drain` still cannot submit.** Per [`getting-to-production.md`](../compliance/getting-to-production.md) the qualified seal certificate is unobtained, unpriced, and its exportability for unattended server use explicitly unverified. **That is the real critical path, and no code shortens it.** The tab/tip lifecycle, the refund/void role-gate, and the drift-orphan fund-hold policy are unchanged deferrals.

## 7. Environment notes

- **The `git pull --ff-only` trap did not fire this time.** The spec and plan commits were created on `main` locally, then moved onto the feature branch before pushing (`git reset --mixed origin/main`, then re-commit on the branch) — so `main` never carried commits that only reached the remote through the squash. **Do this from the start next cycle**; it costs nothing and removes the trap entirely. Use `--mixed`, never `--hard`: tracked compliance docs were being edited by another process throughout.
- **`--delete-branch` left the remote branch behind again** — third cycle running — because the worktree still held the local one, which aborts the whole delete step. `gh api -X DELETE repos/:owner/:repo/git/refs/heads/<branch>` afterwards, then `git fetch --prune`.
- **Plain `gh pr merge --squash` worked, no `--admin`** — fourth cycle running. Resolved conversations are the gate; resolve Copilot threads via the GraphQL `resolveReviewThread` mutation, passing the id as a variable.
- **Confirm the CI run belongs to the current head SHA** before trusting it — `gh run list --json databaseId,headSha`, then `gh run watch <id> --exit-status`.
- Nine stale remote branches from earlier cycles are still on the server (`payment-reconcile-slice-a`, `workforce-time-record`, and others). Harmless, but worth a sweep.
- **Coordination note:** running `/code-review` as a local slash command produced three commits on the branch that the driving session had not authored, and only noticed while verifying an unrelated claim. If both a session and a local command can write to the same branch, re-read `git log` before reasoning about branch state.

## 8. Next

1. **C3, the webhook endpoint** — the last piece of sub-project C, and it needs a design decision before code.
2. **`@waitron/db`'s exports map** — small, and it unblocks a duplication that has now recurred six times.
3. **The certificate.** Everything else is code; this is not.

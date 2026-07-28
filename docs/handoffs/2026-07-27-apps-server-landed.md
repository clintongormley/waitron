# Handoff — the repository has a process, and `/health` lied twice before it didn't

**Date:** 2026-07-27
**Type:** *Backward-looking* — what shipped, what the reviews caught that the tests could not, and what is genuinely left.
**Main at handoff:** `f757bd6`.

| PR | Squash | What |
| --- | --- | --- |
| #35 | `f757bd6` | **`apps/server`** — the host process and its scheduler loop, plus two correctness fixes outside it |

64 files, +9578/−166. `apps/server` is 26 source files, 12 of them suites, 108 tests, 100% coverage on all four metrics.

Spec: [`2026-07-26-server-host-design.md`](../superpowers/specs/2026-07-26-server-host-design.md).
Plan: [`2026-07-26-server-host.md`](../superpowers/plans/2026-07-26-server-host.md) — 12 tasks.
Operator documentation: [`apps/server/README.md`](../../apps/server/README.md) — **new, and the thing to read first in October.**
Amended: [`2026-07-25-recurring-work-scheduler-design.md`](../superpowers/specs/2026-07-25-recurring-work-scheduler-design.md) §2 and §8.

---

## 1. What this is, in one idea

**Nine packages of tested behaviour had no process to run in.** `runDue` had no production caller, the credential vault had no consumer, and nothing called the fiscal `drain`. That is now closed: `apps/server` boots, applies five migration sets behind an advisory lock, resolves per-tenant AEAT transports and Stripe accounts from the vault, runs `drain` then the payments reconcile, sleeps on the folded `nextDueAt`, and serves `GET /health`.

**The legally load-bearing hourly submission duty (art. 16.4) has a caller.** It still cannot submit — the qualified certificate is unobtained — but the transport is built and verified against a real client-certificate handshake, so nothing but the certificate is missing.

## 2. Two correctness fixes outside `apps/server`

**`drain` submitted every tenant's invoices under one certificate.** `DrainDeps.client` was a single `VerifactuClient` handed to every tenant `envios_tenants_with_work` returned. A Veri\*Factu certificate identifies one presenter and the vault provisions per tenant, so every tenant but one was submitted under the wrong seal — the wrong presenter for the `Cabecera`'s declared obligado. There was also no per-tenant `try`, so one unusable certificate aborted every *later* tenant's legally-timed sweep. Now `resolveClient: (tenantId) => Promise<VerifactuClient>`, resolved lazily, with per-tenant containment and a `skipped` list.

Nothing caught it because `drain`'s whole test surface ran one certificate, and **one certificate is indistinguishable from the right number when there is only one tenant.**

**`fiscal.aeat` gained `certKind`.** A *sello de entidad* certificate submits to a different AEAT host (`www10`/`prewww10`). Adding it forced the `rotate`-vs-`PURPOSES` decision the credentials cycle deferred: the host validates what it reads at its own read site, failing one tenant loudly rather than taking the whole vault offline.

## 3. `/health` reported 200 while work was abandoned — twice, once per duty

This is the finding worth carrying forward, because it happened **twice, in the same shape, and neither instance was visible from inside a single task's diff.**

**First (fiscal).** A tenant with due work and no usable certificate: `drain` contained the skip and returned normally, `pass.ts` marked a duty failed only on a *throw*, and health read nothing but that flag. So `pendiente` rows accumulated past their legal hour indefinitely while the host reported itself healthy — the one condition spec §6 calls "the single most important thing this process can say".

**Second (money).** A `parked` reconcile run. `TickResult.ran` holds every completed run including `outcome: "parked"`, which `completeRun` writes with `next_attempt_at = null` — terminal, never re-claimed. An operator ending a key-rotation window early throws `credentials.key_version_unknown` on every `payments.stripe` read; three attempts over ~45 minutes park that day's period **forever**, and the settlement audit that finds charges the customer paid for with no local record is never performed. `/health` said 200 and the log said `ran: 1`.

**The asymmetry is what proved it an oversight rather than a decision:** identical root cause, loud on the fiscal side, silent on the payments side.

Both now flip 503 via `DutyReport.skipped` and `DutyReport.parked`. **`failed` deliberately does not** — it is still retrying, and a false 503 on a transient retry is how the one signal that matters gets ignored. Drain's `recordsHalted` also deliberately does not: a halted record already leaves a queryable trail in `incidents`, which a parked run has no equivalent of, and it can be a legitimate per-invoice rejection. The README's opening claim was narrowed to what 200 actually means rather than the code stretched to fit it.

## 4. The host could not start under the role its own spec named

Drizzle's migrator issues `CREATE SCHEMA IF NOT EXISTS "public"` and `CREATE TABLE IF NOT EXISTS`, and **Postgres checks the privilege before evaluating the `IF NOT EXISTS`** — so a least-privileged connection fails on every boot, even against a fully-migrated database. It also needs `SELECT` on five journal tables it does not own, and against an empty database `CREATEROLE` for five support roles.

The required grants existed **only inside a test's `beforeAll`.** Fixed by splitting `WAITRON_MIGRATIONS_DATABASE_URL` (defaulting to `DATABASE_URL`) so migrations run privileged while the pool stays least-privileged, proven by a test whose runtime role holds nothing but `app_user` membership — plus the README, which is the real mitigation.

## 5. Decisions worth knowing before you touch it

**Long-running, sleeping on `nextDueAt`.** Both duties compute it; this host obeys it rather than logging it. `MAX_TICK` = 1h is a **liveness floor**, not a tuning knob — and a duty's staleness budget must exceed the longest possible sleep, which is now enforced at boot rather than documented (raise `WAITRON_MAX_TICK_MS` past drain's budget and boot refuses).

**Boot failures escape; in-loop failures do not.** A host that boots half-configured and retries invisibly is one whose operator believes it works. In the loop, nothing escapes — a throw would end the hourly retry on one transient blip.

**Credentials are read per pass, never cached.** A decrypted secret lives one pass; a rotation or a new tenant takes effect without a restart.

**The migrations manifest is not taste.** Every `*_MIGRATIONS` descriptor computes its folder from its own `import.meta.url`, and esbuild collapses all five onto the bundle's directory — so using them directly works in development and fails at boot in the artefact. Only `migrationsFolder` collapses; `migrationsTable` is taken from the packages themselves.

**`forward` is not this host's, and the previous handoff was wrong about that.** Its work is `syncOfflineQueue` against the *device-local* queue; its consumer is `apps/till`.

## 6. Defects found, and by what

**None of the following were found by a green suite.**

| Defect | Found by |
| --- | --- |
| `drain` submitting every tenant under one certificate | reading the option doc against the vault's per-tenant model |
| `/health` 200 with a tenant permanently unsubmittable | whole-branch review (composition of three tasks) |
| `/health` 200 with a day's settlement audit parked forever | fresh-context pre-merge review |
| the host unable to start under its own spec's role | whole-branch review |
| two plan tests that passed for the wrong reason | the implementer, tracing `submit`'s call order |
| nothing pinned that the resolver forwards *the tenant's* `certKind` | task review |
| a concurrency test whose key assertion compared a count to itself | task review |
| eager client resolve turning a no-op reconcile into a hard failure | **Copilot** |
| the mTLS fixture handing clients an address it had not bound | **Copilot** |
| `String(error)` on the shutdown path, and an exit racing its own write | **Copilot** |

**Copilot earned its keep on this PR** — four substantive findings across five threads, after a task review, a whole-branch review, a fresh-context review and two fix waves had all passed. Two of its findings were rules this branch had already applied elsewhere and missed in one place.

**Five patterns worth carrying.**

*First:* **a comment asserting something the code does not do appeared in eleven of twelve task reviews.** Including a docblock that moved packages and kept claiming facts true only of its old home; a guard comment that justified the bug it sat above; and a test named "carrying both summaries" that asserted only a line count.

*Second:* **my own plan text was the defect source at least six times** — a `codeOf` that didn't exist where I said, test code that didn't typecheck, a test error code that would have forced a circular dependency, a "reason below" that was above, two tests that passed for the wrong reason, and a `string` where a brand belonged.

*Third:* **"fix it with a test" was twice the wrong instruction.** A structural test I asked for compared a hardcoded literal against itself; the honest closure was the type system (`Record<Duty, number>` with an `as const`-derived union). Prefer an enforcement mechanism over a test that polices a copy.

*Fourth:* **a fix round introduced a regression once**, and the implementer flagged it rather than hiding it: narrowing `realSleep`'s catch made an unforeseen sleep failure *fatal*, trading invisible for fatal. Ask "what does this now do on the path I did not change?"

*Fifth:* **agents disagreed with each other twice**, and both times deferring was right — `codeOf`'s four copies (defect or convention?) and container sharing (the concurrency suite needs an *unmigrated* database).

## 7. What remains

### The one coherent next cycle

Three deferrals that are one piece of work — **"what a persistently-degraded pass looks like from outside"**:

- **A permanently-unresolvable tenant pins the loop at the 5-second floor forever.** `drain` reports `nextDueAt = now` whenever anything was skipped, borrowed from `runDue` where a skip is *transient*. Drain's skips are not: a missing certificate only a human can fix produces the same answer every pass. ~1.5M log lines/day, a disk-fill risk on a single-node deli host — **and this is the expected state of the first deployment**, since no certificate exists yet and `apps/till` will start writing sales against this host.
- **A `failed` or `parked` reconcile run appears in no log line** beyond the new counts; `RunRecord.errorCode` is never read.
- **Spec §9 promises a pass `duration` that does not exist** and a log level that escalates with `consecutiveFailures`, which lives in `health.ts` where `pass.ts` cannot see it.

The unclosed undici `Agent` (one per tenant per pass) is **coupled to the first of these** — 5 seconds × an unclosed pool is different arithmetic from one per hour. Do them together.

### Still open from this cycle

- **C3, the webhook endpoint.** Deferred deliberately: verifying a Stripe signature needs *that tenant's* secret while the tenant is only discoverable from the unverified payload. Tenant-in-the-path versus per-secret trial is a real decision. `/health` gives it a server to attach to.
- The empty-database grant recipe in the README is hand-verified against a real Postgres 18 container, not test-covered.
- Nothing validates that `WAITRON_MIGRATIONS_DATABASE_URL` and `DATABASE_URL` address the same database — a typo migrates one and queries another, failing at the first query rather than at boot.
- `server.listen_failed` is not bind-scoped: `net.Server` also emits `'error'` after a successful bind on fd exhaustion, reported as a bind failure.
- `bin.ts` still has no `try`/`catch`, so four of five boot failures reach stderr as an unhandled rejection rather than a JSON line. The README states this accurately rather than claiming otherwise.
- `packages/db`'s `createPostgresDb` swallows pool `'error'` events with a comment deferring to "app-level monitoring". That app now exists and cannot do it — the pool is not reachable through `Database`. An optional `onPoolError` would close it.
- Spec §14 carries 11 recorded deferrals, including the sixth copies of `startRealPostgres` and `test/seed.ts` (blocked on `@waitron/db` having no `exports` map — the real prerequisite, and worth its own small task before a seventh appears).

### Unchanged

**`drain` still cannot submit.** It needs cert material a `VerifactuClient`'s `fetch` can carry, and per [`getting-to-production.md`](../compliance/getting-to-production.md) the qualified seal certificate is unobtained, unpriced, and its exportability for unattended server use explicitly unverified. **That is the real critical path, and no code shortens it.** The tab/tip lifecycle, the refund/void role-gate, and the drift-orphan fund-hold policy are unchanged deferrals.

## 8. Environment notes

- `pnpm --filter @waitron/server test` runs 108 tests in ~7s; three suites need Docker and **`TESTCONTAINERS_RYUK_DISABLED=true` locally**. Never commit it.
- The pre-push hook runs the full workspace gates in ~90s. It passed on every push here. Do not bypass it.
- **CI now gates the built bundle**, not only its TypeScript source — a new `static-analysis` step builds `@waitron/server`, asserts `dist/drizzle/core/meta/_journal.json` landed beside `dist/server.js`, and smoke-runs the artefact expecting a non-zero exit with `server.config_missing`. This exists because the `import.meta.url` collapse is a bundle-only failure.
- **`gh pr checks --watch` can report the PREVIOUS run's results** and exit 0 while a new run is still pending. Confirm the run id belongs to the current head SHA — `gh run watch <id> --exit-status` after checking `gh pr view --json headRefOid`.
- **Plain `gh pr merge --squash` worked again, no `--admin`** — third cycle running. Resolved conversations, not admin rights, are the gate.
- **`--delete-branch` again left the remote branch behind**, because the worktree still held the local one; it aborts the whole delete step. Delete the ref afterwards with `gh api -X DELETE repos/:owner/:repo/git/refs/heads/<branch>`, which also sidesteps the pre-push hook.
- **New trap: after a squash merge, `git pull --ff-only` on main fails** if main carried commits that only reached the remote *through* the branch (here the spec and plan). The squash collapsed them, so main diverges. Verify the squash contains their content, then `git reset --hard origin/main`.

## 9. Next

1. **The degraded-pass cycle** (§7's first block) — skip cadence, terminal-outcome logging, pass duration, escalating level, and the `Agent` lifecycle coupled to the first.
2. **C3, the webhook endpoint** — the last piece of sub-project C.
3. **The certificate.** Everything else is code; this is not.

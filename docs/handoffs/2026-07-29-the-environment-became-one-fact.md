# Handoff — the environment became one fact, and a till learned to sell

**Date:** 2026-07-29
**Type:** *Backward-looking.* No live branch — the working tree is clean, `main` is `4fb3db0`, and
`origin` carries nothing but `main`.

| PR | Squash | What |
| --- | --- | --- |
| #3 | `4fb3f2c` | The first AEAT submission: probe, bootstrapped tenant, and **a till that can sell** |
| #4 | `d3bfb9e` | The superuser requirement in `bootstrap-tenant.sql` is that file's, not the schema's |
| #5 | `4fb3db0` | One deployment environment, enforced in three places |

69 files, +6923/−79 since `c41dc8e`.

---

## 1. What actually changed

**A till can sell.** `registerSif` had been exported since the chain was built and had **no
production caller anywhere** — every reference outside its own module was a doc comment. A till
created by `bootstrap-tenant.sql` threw `sif.not_registered` on its first sale. `provisionTill`
(`apps/server/src/provision-till.ts`) plus its CLI shim `scripts/register-till.ts` close that.

**The environment is one system-wide fact.** `WAITRON_ENV` replaced `WAITRON_AEAT_ENV` and now
governs both the AEAT endpoint family and the Stripe key mode a tenant's credential must match.
Three guards, failing at three different moments:

| | Catches | When |
| --- | --- | --- |
| `deployment` stamp row | host meets the wrong database | boot, before migrations |
| Stripe `sk_live_`/`sk_test_` check | credential sealed from the wrong dashboard | per tenant, on use |
| `entorno` on `registros_facturacion` | record created here, submitted elsewhere | submission |

**Superuser is not required to provision a tenant.** Proven on PostgreSQL 18: a LOGIN role with
`rolsuper = f` and `rolbypassrls = f` inserts tenant/location/till/series, given it picks the
tenant's uuid itself and sets `app.tenant_id` to that value before inserting, and holds `INSERT ON
tenants`. This matters beyond tidiness — managed Postgres (Neon, Supabase, RDS) grants
`CREATEDB`/`CREATEROLE` but never true superuser, so the old belief read as "Waitron is not
deployable there".

## 2. Decisions worth not relitigating

- **One database per environment, and a pre-production database is never promoted.** Not a
  preference: `invoice_series.next_number` carries across, so five pre-production sales make the
  first production filing `A/6` with `A/1`–`A/5` never filed. `registerSif` resets the chain head
  but never the numbering. Nothing can repair it afterwards.
- **Pre-production is for testing Waitron, not for onboarding customers.** Certificate verification
  is a read-only `consultar` that writes nothing, so a customer's certificate is proven *from the
  production deployment* before their first sale. Promotion was never available anyway.
- **`entorno` is fiscal-only.** Fiscal has an outbox — written now, submitted later, possibly by a
  differently-configured host. Payments have no such window (one API call, one key), so a mode
  column on the payments tables would guard nothing.
- **`entorno` is never hashed.** Verified structurally (it rides on `PendingRegistro` beside
  `saleId`; only `.input` is spread into the record builder) **and** by negative control — leaking
  it into `NumSerieFactura`, watching the invariance test fail on a digest mismatch, reverting.
- **The NIF is read from the tenant row, never an argument.** It reaches `ObligadoEmision.NIF` on
  every registro; an argument is a way to file one tenant's sales under another's.
- **Unclassifiable Stripe keys are accepted.** `rk_…` and any future prefix pass. Refusing what we
  cannot classify would break a working deployment to enforce a check we cannot perform.
- **`WAITRON_ENV` replaced `WAITRON_AEAT_ENV` outright** rather than deriving one from the other.
  Two switches that must agree is the mistake the design removes.

## 3. The dominant defect class, again — and where it now bites

Corrections keep shipping fresh false claims. This session produced four of them, all mine:

1. `bootstrap-tenant.sql` claimed superuser was unavoidable "because the first INSERT creates the
   very tenant whose id `app.tenant_id` would need to be set to". False — the caller can choose the
   id. **PR #4 fixed it and introduced a new one**: that psql "cannot generate a uuid into a
   variable", when the script already used `\gset` three times. Copilot caught it.
2. "PGlite is the *stronger* harness because a container test would pass with the guard deleted" —
   disproved empirically by a reviewer: FK checks bypass RLS, so both harnesses kill that mutant.
3. Two plan defects the reviewers caught and I ruled on rather than asking: `payments.*` where all
   12 sibling codes are `payment.*`, and `recordId` where the file is 7-0 on `registroId`.

**What worked:** verifying against a container instead of reasoning. Every real finding this session
came from someone running the code, not reading it. The superuser claim had survived a correction
pass, a four-agent simplify, a fresh-context review and Copilot — because each checked whether it
was *self-consistent*, not whether it was *true*. Ninety seconds with a non-superuser role settled it.

**Copilot earned its keep twice**, both times as the only layer to find its issue: `seed.test.ts`'s
unclosed `Database` on PR #2, and on PR #5 a PGlite database leaked per test in
`deployment-guard.test.ts` that seven task reviews and a whole-branch review all missed. Before
dismissing a Copilot comment, check the sibling files.

## 4. What the review layers caught on #5

Seven tasks, each independently reviewed, then a whole-branch review and one fix wave. Worth naming:

- **A real fiscal bug my plan created.** The first drain guard left a refused record `pendiente`,
  but `haltOpenChainClaims` only halts chains carrying `rechazado`/`detenido` — so records *after*
  it still submitted, carrying `RegistroAnterior` pointing at a huella AEAT never received. Fixed by
  halting the chain behind any refusal, keyed on `sif_id`.
- **Starvation.** Refused rows satisfy `claimBatch`'s predicate forever; ≥1000 sorting first would
  permanently starve the sendable rows behind them. Fixed at the SQL layer.
- **An unrecoverable one-liner.** `record-one-sale.ts` defaulted its environment while its own
  documented invocation set only `DATABASE_URL` — a forgotten shell variable would write an
  *immutable* `preproduction` record into a production chain and block that till forever. It now
  requires `WAITRON_ENV` explicitly.
- **My plan's `claimBatch` placement was wrong** and the implementer caught it: partitioning after
  `claimBatch` would have stranded rows as `enviando`, not left them `pendiente`.

## 5. Known limitation, recorded not hidden

`drain`'s no-successor-submitted guarantee is **per-drainer within one pass**. Two concurrent
drainers can still submit a successor whose predecessor another refused — it needs the claim window
to cut a chain *and* the second drainer to read inside the first's open transaction. **Not a
regression**: before #5 every successor submitted in every topology. Unreachable today (one loop,
one process). Closing it needs persisted block state rather than an in-memory Set; the code comment
says exactly that.

## 6. Where the human gate stands — unchanged, and still yours

`docs/superpowers/plans/2026-07-28-first-aeat-submission.md` has 8 `[HUMAN]` steps left. What blocks
each is a secret or a decision about real fiscal data, nothing else:

1. **Generate the credential key ring** (`openssl rand -base64 32` + a version). Losing it makes
   every sealed credential unrecoverable, and the host will not migrate without it.
2. **Create the deli's database** via `apps/server/README.md`'s grant recipe. Note the assurance
   split: the deployment-role and already-migrated grants are test-covered; the **empty-database**
   grants — the ones a brand-new database needs — are hand-verified only, by that README's own
   admission. Failures there are findings.
3. **Seal the certificate** into the vault. Build the credentials CLI first.
4. **Register the till** — `dist/register-till.js` now exists and is built.
5. **Record one sale, start the host, watch drain submit.** Then write down what AEAT did.

**Two things that changed under this gate today, and will bite if missed:**

- `bootstrap-tenant.sql` now takes an **eighth** psql variable, `-v environment="…"`, which stamps
  the deployment. Two historical docs still show the seven-variable invocation.
- `record-one-sale.ts` now **requires `WAITRON_ENV`** and exits non-zero without it, deliberately.

## 7. What remains

**Immediately plannable — the spec is written:**
[`2026-07-29-provisioning-tool-design.md`](../superpowers/specs/2026-07-29-provisioning-tool-design.md).
A `waitron-provision` CLI with four commands split on a privilege boundary: `keyring` (yours alone),
`instance` (admin connection, once per deployment), `tenant` (provisioning role, once per customer),
`status`. It answers the complaint that started this: `instance` and every step of `tenant` except
sealing the certificate involve **no secrets**, so an agent can run them. Resume reads the database,
so the secret and non-secret steps interleave in any order. It also turns the README's untested
grant recipe into code with a real-Postgres suite behind it.

**Follow-ups recorded during #5**, none blocking:

- "superuser DDL" overstates the privilege needed to repair a NULL `entorno` — the table **owner**
  can `DISABLE TRIGGER` + `UPDATE`. Same over-claimed-superuser class as §3.
- `bootstrap-tenant.sql`'s eighth variable vs. the seven-variable invocations still in
  `2026-07-28-first-aeat-submission.md` and the provisioning-tool spec.
- A wholesale drain refusal never reaches `recordsHalted`, so it is invisible to `/health` — a
  wedged host serves `200 OK`.
- `result.incidentsRaised` increments even when `recordIncident` de-duplicates (pre-existing).
- The refused envío gets no `incidencia = true`, unlike every other stop in `drain.ts`.

**Older, still open:** C3 the webhook endpoint (designed, scoped, not started); the unguarded
`afterAll` pattern across ten `.rls.test.ts` and seven `.concurrency.test.ts` files; #35's leftovers;
`payments.stripe` unprovisioned for the deli; **certificate renewal before 2027-10-03** with no
warning mechanism.

## 8. Environment notes

- **CI's `test` job runs `pnpm test:coverage`, not `pnpm test`.** The pre-push hook runs plain
  `pnpm test`, so a coverage-threshold regression passes locally and fails in CI. Run
  `pnpm --filter <pkg> test:coverage` before claiming a package is green.
- **The pre-push hook does not run `--frozen-lockfile`.** Moving a dependency between sections
  passes locally and fails three CI jobs at the install step. Cost a round trip on #3.
- **Docker contention is real here.** A full `pnpm test` hit `EADDRINUSE` twice and passed on retry;
  CI has never reproduced it. `TESTCONTAINERS_RYUK_DISABLED=true` is still required.
- **Merging needs resolved conversations.** `mergeStateStatus: BLOCKED` with green checks means
  unresolved Copilot threads — read them, act, then resolve via the GraphQL `resolveReviewThread`
  mutation with the id passed as a variable. Both times this session the threads were real.
- **After pulling a branch that added a workspace dependency, run `pnpm install`** in the main
  checkout, or typecheck fails on a module that exists.
- `/land-branch` still must not carry `--delete-branch`; both branch deletions were explicit and
  verified, and on both PRs the remote branch was still present after merge.

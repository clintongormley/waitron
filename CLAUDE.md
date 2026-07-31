# Waitron — working notes for Claude

A Spanish restaurant POS with Veri*Factu fiscal compliance. It files invoice records with AEAT (the
Spanish tax agency) and takes card payments through Stripe.

**What makes this codebase unusual:** some mistakes here cannot be fixed afterwards. Fiscal records
are append-only and hash-chained, invoice numbers are never reused, and chains cannot be merged or
migrated. A wrong filing is not repairable by editing data. That is why the conventions below are
strict and why claims in comments are held to an unusual standard.

---

## 1. Writing claims — the house's dominant defect class

**Comments and docs that assert more than the code delivers are this repo's most common defect**, by
a wide margin. Every retrospective names it. Read this section before writing an explanatory comment.

### A claim of necessity or impossibility needs a receipt

Any sentence of the form _"X is required"_, _"only Y can"_, _"Z cannot"_ must carry either the
command that was run or a cited `file:line`. The good pattern already exists in the tree:

> `-- Proven on PostgreSQL 18 against the real migrations, as a LOGIN role with rolsuper = f and`
> `-- rolbypassrls = f: the four tenant-scoped inserts below succeed.`

Two false claims shipped in one day for want of this. `bootstrap-tenant.sql` asserted superuser was
unavoidable — it is not, and ninety seconds with a container disproved it. Its _correction_ then
asserted psql "cannot generate a uuid into a variable", contradicted by the same file's own four
uses of `\gset`.

That correction's own _replacement_ then went on to claim "no non-superuser role holds INSERT on
`deployment`" and built two independent blockers on it. Also false — a non-superuser role that
**owns** the table holds INSERT implicitly, and `deployment` carries no RLS to strip its exemption —
and it stood for three commits. When a claim names a privilege, name the role SHAPE it holds it by:
owner, grantee, or member. "Non-superuser role" unqualified is how that one got through. (The same
round also found the `\gset` count was three in two files at once, this one included. A count
repeated in a second place is a count to recheck in both.)

**Reading is not verification.** That superuser claim survived a correction pass, a four-agent
simplify, a fresh-context review and Copilot — four layers, all reading, all checking whether it was
_self-consistent_ rather than whether it was _true_. Adding a fifth reader would not have helped.
Run the thing.

### State the experiment, not the conclusion

"I deleted the tenant predicate and the test failed" is checkable. "The guard is proven" is not, and
is how a third false claim happened — an experiment on one mutation, written up as a claim about a
different mutation that was never run. If the sentence describes more than what you ran, narrow it.

### "Pre-existing" and "not a regression" are claims too

Both are load-bearing — they decide whether something gets fixed now or deferred — and both are
routinely asserted from impression. Check with `git log`/`git blame` before saying either, and if you
have not checked, say so: "I believe this predates the branch" is honest, "this is pre-existing" is a
finding. The same goes for "harmless", "unreachable" and "narrow": each is a claim about behaviour
under conditions you may not have enumerated.

### The correction is a new claim

Both false claims above were born _while fixing someone else's_. Attention goes to the old text
being wrong, and the replacement is written with the confidence of having just discovered something.
Apply the same "what would make this false?" pass to your correction that you applied to the
original.

`feat/provisioning-instance` produced three more in one cycle, each written while correcting an
adjacent claim: a transaction claim in a rewritten `applyMigrations` comment, a "`pg` authenticates
lazily on first use" justification that a container disproved within a minute, and a teardown
comment blaming a failed `DROP ROLE` on the role being a GRANTOR when it was simultaneously a
grantee, so the two could not be separated. This is the single most productive source of false
claims in the repository's history — more than first drafts. Budget review effort accordingly: the
_replacement_ text deserves more scrutiny than the text it replaces, not less.

### Before asserting a convention, grep the siblings

Two defects landed this way: an error code prefixed `payments.` where all twelve siblings use
`payment.`, and a param named `recordId` in a file that is 7-0 on `registroId`. Both were one grep
from being avoided. Error codes are **never renamed once shipped** (see below), so these are free to
fix before merge and permanent after.

The rule covers **prose, not just identifiers**. A spec described an outage path as manufacturing
reconciliation _orphans_; in `packages/payments/src/reconcile.ts` an `orphan` is a local captured row
with no sale, classified without ever consulting the processor's report — the opposite direction from
what was meant (that is `unmatched`). Borrowing the codebase's vocabulary in a sentence is asserting
a convention.

### A behaviour change retires every receipt about the old behaviour — editing a file is not auditing it

`fix/provisioning-migrate-gate` made `instance` plan `migrate` on every run, corrected the comment
sitting on top of the gate, and left three stale claims standing in two READMEs. Only one was in a
file the branch never opened (`apps/server/README.md`). The other two were in
`packages/provisioning/README.md`, which the branch **had already edited**: `4c9409d`'s only hunk
there opens at line 109, and the `**Idempotency.**` paragraph still asserting the retired behaviour
sat at line 88 — **21 lines above that hunk**. So "grep the files your diff never opened" is the
wrong rule; it misses two of the three. A diff carries three lines of context, so a file you edited
is a file you have not read.

The expensive receipt was a documented **procedure**, not descriptive prose: that README told an
operator three `GRANT`s let a second admin run `instance` to completion, with an end-to-end receipt
saying it had been tested. Run in both directions on `postgres:18-alpine`, that procedure now dies at
`42501 permission denied for database` on `CREATE SCHEMA IF NOT EXISTS "public"`, while the
pre-change build (`deea09f^`) completes it — a recovery path an operator executes, turned into a
broken one. So read the **runbooks and the test-assertion summaries** first, not only the prose
describing the thing you changed. A README paraphrase of a test assertion is a receipt too, and goes
stale the moment the assertion is inverted: `apps/server/README.md` said a second plan "carries no
create and no migrate" while the branch was inverting that very assertion.

Four per-task reviews and a re-review of the fix round missed all three, each scoped to its own diff.
The whole-branch review — the first pass whose range was base-to-tip — found all three. This class is
invisible to per-task review by construction, so budget one base-to-tip pass before the PR.

### Claims about the outside world need receipts too — and the source's own words

Everything above is illustrated with repo-internal examples, and that framing is why the deli
hardware cycle produced two defects in one document: the discipline did not feel like it applied to
vendor docs, pricing pages and browser-support tables. It applies identically, and those claims are
**harder**, because there is no `grep` or container to fall back on — only the source.

- **A spec's provenance table covers every external claim, not just its numbers.**
  `docs/superpowers/specs/2026-07-30-deli-hardware-design.md` sourced eight prices and API shapes,
  then asserted unsourced that "iOS Safari implements none of those APIs" — the claim its
  load-bearing decision rested on. Copilot caught it; MDN's `browser-compat-data` happened to confirm
  it. Writing the provenance row is the step that makes you discover you have no URL.
- **Quote the source, then paraphrase — never only paraphrase.** The same document compressed
  Square's _"doesn't support splitting a checkout into multiple payments for a single checkout
  request"_ into "no splitting one checkout into multiple payments". Dropping five words turned a
  limit on one API call into a product limitation, and would have sent the payment spec designing
  around a constraint that does not exist. Qualifiers carry the meaning and are exactly what
  compression removes.
- **Two sources that appear to contradict each other usually describe different paths.** SumUp's
  Cloud API docs say the target device must be online; the Solo's product page advertises an offline
  mode. Both true: the API _push_ needs the device reachable, while offline mode belongs to the
  device's own standalone flow. Reading either alone gives a wrong design.

---

## 2. The gate

```bash
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
```

Traps that each cost a round trip (deliberately uncounted — the last version of this line said
"four" and went stale the moment one was added):

- **CI's test shards run `test:coverage`, not `test`.** The pre-push hook runs plain `pnpm test`, so
  a coverage-threshold regression passes locally and fails in CI. Before claiming a package is green,
  run `pnpm --filter <pkg> test:coverage`. There is no `test` job to name any more:
  `.github/workflows/ci.yml` splits it into `test-heavy` (`packages/db` alone) and `test-light`
  (everything else, `--no-sort`).
- **CI does not run every check on every push.** `ci.yml`'s `changes` job skips the expensive jobs
  outright when every changed path is documentation, and on a pull request narrows the two test
  shards and both mutation jobs to the changed packages and their dependents. A merge to `main` runs
  the full unfiltered suite **whenever anything but documentation changed**, and that run is what
  verifies the narrowing was right — a documentation-only merge skips there too, which is the whole
  point of the two decisions being separate. So a green pull
  request is evidence about the packages that RAN — read the `changes` job's log for its `code` and
  `scope` outputs and its per-job `heavy` / `verifactu` / `shared` gates before treating it as
  evidence about the workspace. Design:
  `docs/superpowers/specs/2026-07-31-scoped-ci-design.md`.
- **A cheap job can still be the critical path, and only the whole-run measurement shows it.**
  `mutation-verifactu` was gated on `code` alone because a mutation run over a pure-Node package is
  cheap _per mutant_. Read off the first scoped run
  (`gh run view 30650089655 --json createdAt,updatedAt,jobs`, head `4926cf5`): 4m8s wall clock, of
  which that one job was 3m26s, with every other job finished 1m39s in. It was therefore the floor
  for every pull request in the repository, including the ones nowhere near `packages/verifactu` —
  and the per-job reasoning that put it there could not have shown that, because the number it
  turned on is a property of the run, not of the job. Before calling a job cheap enough to leave
  ungated, sort that run's jobs by duration.
- **The scoping filter silently matches nothing in a `git worktree`, and all feature work here
  happens in one**, so it is the first thing anyone testing that filter will hit. Measured on pnpm
  9.15.0 in `waitron-feat-ci-scoped-testing`: `pnpm --filter "...[main]" ls --depth -1` printed
  `No projects matched the filters` while `git diff --name-only main...HEAD` in the same directory
  listed every changed file. It reads as "the filter is broken" rather than "you are in the wrong
  kind of checkout". Verify anything touching the filter in a clone or on a real pull request.
  (Deliberately not a file count: the first version of this entry said "seven", which stopped being
  true on the branch's next commit. A number that moves is a receipt that goes stale.)
- **`pnpm --filter ""` is a hard error, not a no-op.** Measured on pnpm 9.15.0 in this workspace:
  `pnpm --filter "" --filter "!@waitron/db" --no-sort exec node -e "0"` exits **1** with
  `ERROR  Unsupported package selector: {"exclude":false,…}` before selecting anything, while the same
  command with the empty filter dropped exits 0. That is exactly the shape of `test-light`'s `SCOPE`
  — empty on `main`, non-empty on a pull request — so its `[ -n "$SCOPE" ]` guard is load-bearing,
  not decoration: without it every `main` run would fail that shard outright. The plan for this
  change asserted the opposite, that an empty filter "matches nothing rather than everything". It
  fails loudly, which is the better of the two directions, but a possibly-empty interpolated filter
  still needs the guard.
- **The workspace root is outside `pnpm -r`, so root config is linted and never typechecked.**
  `pnpm typecheck` is `pnpm -r typecheck`, and `pnpm -r exec node -e "console.log(process.cwd())"`
  visits the fifteen workspace members and never the root; there is no root `tsconfig.json` either,
  only `tsconfig.base.json` for packages to extend. Proven by mutation, twice, because the first
  probe flattered the situation. Appending `const brokenProbe: number = "not a number";` to the root
  `vitest.config.ts` gives `pnpm typecheck` exit 0 and `pnpm lint` exit **1** — which looks like
  lint covering the gap, and does not: the rule that fired is
  `@typescript-eslint/no-unused-vars`, on the unused binding. `eslint.config.js` uses
  `tseslint.configs.recommended`, which is **not** type-aware, so it never saw the type error at
  all. Make the binding used — `export const brokenProbe: number = "not a number";` — and
  `pnpm typecheck`, `pnpm lint` AND `pnpm vitest run` all exit **0**. Nothing in this repository
  typechecks root config, so a type error there reaches `main` unremarked.
- **The pre-push hook does not run `--frozen-lockfile`.** Moving a dependency between
  `dependencies` and `devDependencies` passes locally and fails CI at the install step. Run
  `pnpm install` and commit the lockfile.
- **A filtered test run does not load a package's guard suites.**
  `pnpm --filter @waitron/db test provisioner-role` was green while
  `pnpm --filter @waitron/db test:coverage` failed on the same tree: the filter never loaded
  `english-only.test.ts`, which rejected `'Venta en establecimiento'` in a new fixture (`venta` is in
  `SPANISH_WORDS`). Cross-cutting suites that police the WHOLE package — the vocabulary guard, the
  error-code reachability tests, schema-ownership — are invisible to a name-filtered run, so a
  filtered green says nothing about them. Run the package unfiltered before believing a pass. Same
  false-green shape as the `test:coverage` and `--frozen-lockfile` traps above, in a third place.
  (Named rather than counted: an earlier version said "the two traps above" and stopped being true
  the moment a bullet was inserted between them.)

- **The pre-push log file can be days stale — reproduce, do not read it.** A rejected push pointed
  at `/tmp/waitron-root-test-run.log`; that file was two days old and named
  `apps/server/src/migrations.test.ts`, which the branch being pushed had deleted. The real cause was
  `EADDRINUSE` under Docker contention (§4) and the retry passed. Run the failing command yourself
  before believing the log names your failure.

On bypassing the hook, see §6 — the hook's own header sanctions `--no-verify` in an emergency, and
the underlying failure still has to be fixed because CI runs the same checks. On a pull request it
runs them over a narrower set of packages, so a hook failure the pull request does not reproduce is
not a hook that is wrong; it is a check CI has deferred to the unfiltered `main` run.

**Coverage thresholds** are `statements 98 / lines 98 / functions 98 / branches 95` in every package
except `packages/ui`, which is `95/95/90/88` with a documented reason in its own config.

---

## 3. Conventions reviewers enforce

**Error codes name the DOMAIN CONCEPT, never the throwing package.** `series.not_found`, not
`db.series_not_found` — see the design note atop `packages/shared/src/errors.ts`. That one code was
renamed twice to converge on the rule. Codes are **never renamed once shipped**; a wrong one is
deprecated and a new one added beside it. `server.*` is reserved for facts about the process itself
(`apps/server/src/errors.ts` says so in its own doc comment) — "no such tenant" is a fact about a
tenant, not about the process.

Every file that throws a code imports its registry (`import "./errors.js"`) directly.

**Spanish domain terms are deliberate**, guarded by `packages/db/src/english-only.ts`. Fiscal tables
and columns use the Veri*Factu vocabulary (`envios`, `estado`, `huella`, `secuencia`, `entorno`). Add
new Spanish schema tokens to `SPANISH_WORDS`. `packages/verifactu` and `packages/fiscal-verifactu`
are exempt from the guard; `apps/*` is out of scope by a recorded decision.

**`@waitron/db`'s `exports` map is enumerated, not a wildcard** — `.`, `./testing/postgres.js`,
`./testing/seed.js`. A wildcard would publish the harness and give `asAppUser` a second import path.
A consequence worth knowing: `apps/server` cannot deep-import `packages/db`'s `errors.ts`.

**Never build SQL by string concatenation — and know the one case where you must.** Drizzle
parameterises every interpolated value in a `sql` template automatically, so `` sql`… ${value}` ``
emits `$1` and binds it. Verified against a real server on 2026-07-31: `` sql`select ${x}::text` ``
with `x = "o'brien; drop table x --"` returns that string intact.

The exception is **utility statements, which PostgreSQL will not bind at all**. Same experiment,
same server:

```
create role $1 login                    → syntax error at or near "$1"
create role probe_b login password $1   → syntax error at or near "$1"
```

`CREATE ROLE`, `CREATE DATABASE`, `GRANT` and friends take no placeholders, so the value has to
reach the statement as text and there is no parameterised form to reach for. When that happens the
defence is explicit, never implicit:

- **escape** — `quoteIdent`/`quoteLiteral` (`packages/provisioning/src/identifiers.ts`), for values
  that may legitimately be arbitrary, such as a generated password;
- **validate and throw** — `probeRoleStatement` (`packages/db/src/testing/lifecycle.ts`), for values
  that should only ever be fixtures, where anything needing an escape is a bug worth failing on.

Either is acceptable; **neither being present is not**, and "the callers only pass safe values" is a
property of the callers rather than of the code — precisely the §1 defect class, since these
parameters are typed plain `string`.

**Never widen a grant to make a test pass.** `app_user` holds `SELECT` on `tenants` and not `INSERT`
deliberately — the running POS cannot create tenants.

**An object-privilege `GRANT` PostgreSQL accepted is not a `GRANT` that did anything.** Whether an
ineffective `GRANT` is loud or silent turns on what the GRANTOR holds, and the quiet cases are the
common ones. Run on `postgres:18-alpine` (PostgreSQL 18.4), granting on a database owned by
`owner_a` from a non-owning `login createdb createrole` admin:

| What the grantor holds on the object | `grant create on database acl_db to r_app`               |
| ------------------------------------ | -------------------------------------------------------- |
| nothing at all                       | `ERROR: 42501: permission denied for database acl_db`    |
| some privilege, no grant option      | `WARNING: no privileges were granted`, tag `GRANT`, rc 0 |
| grant option on part of the list     | `WARNING: not all privileges were granted`, rc 0         |
| ditto, but written `GRANT ALL …`     | **no diagnostic at all**, tag `GRANT`, rc 0              |

Three traps in that table. First, the hard error is **harder to reach than it looks**: `PUBLIC` holds
`CONNECT`/`TEMP` on every database by default, and `aclmask` counts a `PUBLIC` grant as held, so
every role is in row 2 until someone runs `revoke all on database … from public` — which is what
made row 1 reachable in the transcript. Second, the partial rows still **land the grantable subset**
(`r_app=c/mid_role` appeared), so "it warned" does not mean "it did nothing". Third,
`GRANT ALL PRIVILEGES` suppresses the partial warning entirely — PostgreSQL only raises
`not all privileges were granted` when the statement listed privileges explicitly.

So read the ACL back rather than trusting the command tag or the absence of a warning. Two things
the first version of this entry got wrong, both checked here rather than reasoned about:

- **The failing `GRANT` does not leave the ACL untouched.** `datacl` was `NULL` before and
  `{=Tc/owner_a,owner_a=CTc/owner_a}` after — the privileges are unchanged, but the column is
  materialised from the implicit default. Never read `datacl IS NULL` as "nothing has been granted
  here"; a `GRANT` that granted nothing flips it.
- **`has_*` functions DO see the grant option**, via the `'<PRIV> WITH GRANT OPTION'` spelling.
  Measured in both directions for three of them — `has_table_privilege(…, 'SELECT WITH GRANT
OPTION')`, `has_schema_privilege(…, 'CREATE WITH GRANT OPTION')` and
  `pg_has_role(…, 'MEMBER WITH ADMIN OPTION')` each returned `t` for the role holding the option and
  `f` for one holding the bare privilege or a plain membership — and in the positive direction for
  `has_database_privilege(…, 'CONNECT WITH GRANT OPTION')`. The real reason to read
  `pg_database.datacl` / `pg_namespace.nspacl` directly is **the recursive closure**:
  `has_database_privilege('r_direct','acl_db2','CREATE')` was `t` while `aclexplode(datacl)` had
  **zero** entries naming `r_direct`, which held it only through a group. That is a false positive a
  provisioner must not accept.

**Role-membership `GRANT`s are not in this family at all** — they always ERROR, never warn:
`grant grp to r_app` from a non-member and from a member without `ADMIN OPTION` both gave
`ERROR: 42501: permission denied to grant role "grp"`. Code that catches membership failures is
catching a throw; only object-privilege grants need the read-back.

Cost: a Critical finding on `feat/provisioning-instance` plus two fix rounds — the first fix then
refused **working** deployments, because a grantee holds one ACL entry **per grantor**
(`r_y=c/owner_a` and `r_y=C/r_mig` coexist, which is exactly what `WITH GRANT OPTION` delegation
produces) and the check read only the first match. Then a third round, for this entry: its own
first version stated row 2 as the unconditional rule and asserted the `has_*` blindness above,
and four sites had copied the sentence.

**No backwards-compatibility or data-migration code until Waitron is in production.** Nothing is
deployed, so there is no data anyone needs preserved: schema changes drop and recreate, developer
databases are recreated, and CI builds fresh every run. A backfill for an empty database is code
that must still be written, reviewed, tested and maintained, and it buys nothing.

The cost that produced this rule was worse than wasted effort. The first draft of
`2026-07-31-sale-settlement-model-design.md` §6 carried a backfill moving each sale's tip onto one of
its tenders — and it could only ever be a **guess**, because the old schema recorded one tip per sale
and never which payer left it. A migration that invents data is worse than one that discards it: the
invented values are indistinguishable from real ones afterwards. Delete the backfill; do not write a
cleverer one.

This rule expires the day a real venue is live. Add the entry that replaces it in the same change.

**An empty connection string is a valid connection string.** `new Client({ connectionString: "" })`
resolves to `{host:"localhost",port:5432,user:"<OS user>"}` — the empty string is falsy, so `pg`
parses nothing and every default applies (run against `pg@8.22.0`; `pg-pool` builds its clients from
the same options object, `pg-pool/index.js:241`). Anything that reads a connection string from an
environment variable or a prompt must refuse `""` explicitly. Cost: an Important finding —
`waitron-provision instance` would have created, migrated and **stamped** a database on whatever
answers on localhost whenever `WAITRON_ADMIN_DATABASE_URL` was unset and stdin was non-interactive,
which is the documented CI shape.

---

## 4. Testing

Two targets, and the choice matters:

- **PGlite** (`createPgliteDb` + `runMigrations`) — hermetic and fast. Every connection is a
  superuser, so it cannot show behaviour under the non-superuser deployment role, and it serialises
  every query onto one backend, so a contention test on PGlite is a **false pass**, not a weak one.
- **Real Postgres** via Testcontainers — required for anything about privileges, RLS as the
  deployment role, or concurrency. `packages/db` offers `describeEachTarget`
  (`src/testing/harness.ts`) to run a suite against both.

Pick the lighter one when the heavier one's justification does not apply to your suite, and say why
in a comment.

**`TESTCONTAINERS_RYUK_DISABLED=true` is required locally.** Without it, container suites hang until
the 180s `hookTimeout` in `apps/server/vitest.config.ts` fires — observed repeatedly on this machine,
never in CI, which is why no config default papers over it. Docker contention on a full `pnpm test`
shows up separately as `EADDRINUSE` and passes on retry.

**A probe that needs a Unix SOCKET must run inside the container, not on this host.** Bind-mounting
the socket directory out of a `postgres:18-alpine` container and connecting to it from macOS does not
work: the socket is created inside Docker Desktop's VM, and `pg` got `connect ECONNREFUSED
/tmp/c1s/.s.PGSQL.5432` against a server that `pg_isready` reported as accepting connections. A
scratchpad path also blows the 104-byte `sun_path` limit first — the same probe against a full
scratchpad path failed `EINVAL` before it could even reach `ECONNREFUSED`. Two wasted rounds on the
`provisioning.admin_uri_not_a_url` receipt. Run the probe in the container instead
(`apk add --no-cache nodejs npm && npm i pg@<version>`), where node and the server share a
namespace; everything that is only PARSING — `new URL` versus `pg`'s own parse — is fine on the host.

**Don't own a database in a suite — let a helper own it.** `usePgliteDb` and `useRealPostgres`
(`@waitron/db/testing/lifecycle.js`) register their own `beforeAll`/`afterAll` and hand back an
accessor that **throws** rather than returning `undefined` if read before setup. A suite using them
cannot write a broken teardown, because it writes no teardown. Reach for a raw
`beforeAll`/`afterAll` pair only when the suite legitimately builds its own resource — a unit test
_of_ the constructor, or a race needing several distinct connections.

**Where you must, guard it**: `if (db !== undefined) await db.close()`. **Enforced** by
`packages/db/src/guarded-teardowns.test.ts`, which also records what an unguarded teardown costs,
why an ESLint rule was rejected, and the two things the guard cannot see. Read it before changing
it — a convention this file had already stated was violated in 94 places, which is the general
lesson: **a written rule with standing violations needs a guard, not another paragraph.**

Suites sharing a database must clean up in a `finally` so they are order-independent, not
order-reliant — several tests have been fixed for exactly this.

**Prove a guard by deletion.** Remove the check, confirm the test fails, restore it. A test that
still passes with the guard removed is not testing the guard. Do the same for a negative control:
confirm it fails for the reason you think it does.

**Vitest's default coverage excludes swallow the whole of `.github/`.** Coverage `include` and
`exclude` replace rather than merge, so the house style spreads `coverageConfigDefaults.exclude`
back in — and one of its seventeen entries, `**/[.]**`, matches any dot-prefixed path segment. The
root `vitest.config.ts`'s first version spread them verbatim and measured
**nothing**: `vitest run --coverage` printed `All files | 0 | 0 | 0 | 0`, wrote a
`coverage-summary.json` whose every `pct` was the string `"Unknown"`, and **exited 0** — the
98/98/98/95 thresholds passed without a line of source being read. Both configs were re-run here
against `vitest@3.2.7`: the verbatim spread exits 0 at zero coverage, the committed one (which
filters that one pattern out) reports `changed-scope.mjs` at 100/100/100/100. A coverage gate cannot
fail on a file it never opened, so whenever `include` points anywhere dot-prefixed, read the per-file
table rather than the exit code.

**`errors.reachability.test.ts` does not test reachability.** The rule it exists to enforce is real —
an `errors.ts` unreachable from its package's own barrel is invisible to external consumers — but the
test does not enforce it. Proven by deletion in `packages/migrations`: remove `import "./errors.js"`
from the barrel **and** from every other file, and it still passes, because `tsconfig`'s
`include: ["src"]` makes every file a compilation root regardless of the import graph and
`vitest run` does not typecheck at all. **Eight packages carry a copy** (`core`, `credentials`, `db`,
`fiscal`, `fiscal-verifactu`, `migrations`, `payments`, `payments-stripe`) and every one of their
`include` arrays starts with `"src"` — verified by inspection, so the mechanism is uniform even
though the deletion was run in one. Closing it needs a `tsc`-based downstream-consumer probe, or an
`include` narrowed to the barrel's transitive closure. Until then, do not cite these tests as
evidence that an augmentation is reachable.

**`toMatchObject` checks only the keys you list — a key you never list is never checked at all.**
That is the loophole, not type-blindness: `expect({memberOf: "{}"}).toMatchObject({memberOf: []})`
does fail (run under this repo's vitest). The bug survived because `memberOf` appeared in neither
assertion, so tightening to `toEqual` — which requires every field — is what put it under a matcher
for the first time.

What it was hiding: `pg_roles.rolname` is PostgreSQL's `name` type, so `array(select g.rolname …)`
is `name[]` (OID 1003), for which `node-postgres` has no parser — it hands back the wire literal
(`"{}"`, or `"{app_user}"` when populated) through a field declared `string[]`. `text[]` (OID 1009)
_is_ parsed, hence the `::text`/`::text[]` casts now in `instance-state.ts`.

**Work the failure out case by case rather than assuming a broken type breaks everything.** The
sole consumer was `!facts.memberOf.includes(of)` (`instance-plan.ts:151`), and
`String.prototype.includes` agrees with `Array.prototype.includes` on every input the planner
actually sees: `"{}".includes("app_user")` is `false` and `"{app_user}".includes("app_user")` is
`true`, both correct by luck. It diverges in exactly one shape — **substring collision between role
names**: `"{app_user_probe}".includes("app_user")` is `true` where the array answer is `false`. So
the failure was a false POSITIVE that silently SKIPS a needed `grant-membership`, not the "reads
false forever, spurious grants on every run" this entry first claimed — the opposite direction, and
the quieter one. (`status-command.ts` would have thrown `"{}".join is not a function`, but it
landed after the fix, so nothing ever hit that.)

---

## 5. Fiscal invariants — the unrecoverable ones

- **One database per environment.** A pre-production database is never promoted.
  `invoice_series.next_number` carries across, so pre-production sales leave a permanent hole in the
  production series — and detecting exactly that is what Veri*Factu is for. `WAITRON_ENV` governs
  this; unset means `preproduction` and `production` must be typed out.
- **Nothing may block a sale** on anything but the sale itself. A till that cannot sell is a shop
  that cannot trade. Fiscal submission is an outbox, never inline.
- **`registros_facturacion` is immutable**: `REVOKE ALL`, an append-only trigger, and a
  TRUNCATE-blocking trigger. Do not work around them; a value written wrong there stays wrong.
- **Never put our own metadata into a hash.** `entorno` is ours, not AEAT's, and a test pins that two
  records differing only in it hash identically. If it entered `computeHuella`, every chain written
  under one environment would become unverifiable under the other.
- **Re-registering a till starts a new chain** and mints a fresh installation number. Correct for a
  reimaged till, destructive for a working one.

---

## 6. Workflow

**Branches and merging:**

- **Never commit directly to `main`** — always create a feature branch first. Feature work happens
  in a worktree (`worktree.py new waitron <branch>`), not the main checkout.
- **Branch names are descriptive**, e.g. `feat/provisioning-cli`, `fix/rls-superuser-claim`.
- **Do not merge a PR automatically — wait for the user's approval.** Invoking `/land-branch`
  _is_ that approval; nothing else is.
- **After merging, delete the feature branch**, local and remote. Verify the remote one is actually
  gone — it has repeatedly survived the merge (`git ls-remote --heads origin <branch>` must print
  nothing).
- **Every commit needs `git commit -s`.** CI's `dco` job walks the whole PR range.
- **Merging requires resolved conversations.** `mergeStateStatus: BLOCKED` with green checks means
  unresolved Copilot threads. Read them before resolving — on two consecutive PRs Copilot's single
  comment was the only real finding no other layer caught, both times by checking sibling files.
  Resolve via the GraphQL `resolveReviewThread` mutation with the id passed as a variable.
- **Verify CI runs belong to the current head SHA** (`gh run list --json databaseId,headSha`).
- **Name the branch correctly when creating the worktree — renaming it afterwards breaks teardown.**
  `worktree.py` and `/land-branch` both derive the worktree directory from the branch name, so a
  branch renamed after the fact desynchronises the two. `/land-branch` then looked for
  `waitron-feat-provisioning-cli` while the directory was still `waitron-provisioning-instance`,
  printed `No such file or directory`, and reported `commits: , files: 0` — which reads as an empty
  branch rather than as a broken path. `worktree.py rm waitron <ORIGINAL-name>` finds it.
- **An untracked file in the main checkout can block the post-merge `git pull --ff-only`.** A scratch
  copy of a plan doc, made while planning, stopped the fast-forward once the merge added the tracked
  version. Diff before deleting — the scratch copy was 113 lines behind what had actually landed.

**Before a PR**, run the gate in §2 yourself rather than relying on the pre-push hook. The hook
mirrors CI's fast checks but is **not** identical to it — see §2 for where they diverge, in both
directions: the hook is broader (it runs the whole workspace, while CI's shards narrow to what a
pull request can reach) and shallower (no coverage thresholds, no `--frozen-lockfile`, no mutation).
Bypassing the hook with `--no-verify` is for emergencies only, and the underlying failure still
needs fixing because CI runs the same checks.

**Before a release** (when there is a release process — there is none yet), update the docs and
tests alongside the code.

**Docs:**

- **`docs/backlog.md` answers "what should I work on?"** — what is in flight, what is next, and the
  reasoning for the order. Read it before starting anything unprompted, and **update it in the same
  change that makes it stale**. It exists because nothing else did: priorities lived in session
  memory, which drifts and cannot be reviewed, and several of those notes still point at pull
  request numbers that no longer exist. The legal and administrative track is separate, in
  `docs/compliance/action-plan.md`.
- Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`, session handoffs in
  `docs/handoffs/`.
- **Specs and plans are committed here, deliberately** — unlike some sibling repos, where
  `docs/superpowers/` is gitignored as local scratch. In Waitron a plan doubles as the operator's
  runbook (the AEAT submission plan is executed by a human at a terminal), so it belongs in history.
  Do not gitignore them.
- **Handoffs are NOT.** `docs/handoffs/` is gitignored: a handoff is scratch that carries context to
  the next session, not a record anyone reads twice. Write one, leave it uncommitted, and delete it
  once the work it describes is finished. Do not branch for one and **do not open a PR for one** —
  that spends a CI run and a review cycle on a document whose whole life is one session. The
  intended end state is that `docs/superpowers/` joins it; until that happens, only handoffs are
  ignored.
- **A handoff is therefore the wrong place for anything durable.** If a lesson would still matter in
  three sessions, it belongs in this file (§7); if a follow-up is unclaimed work, it belongs
  somewhere that outlives the directory it is written in.
- Historical docs record what was true when written. Add a dated pointer rather than rewriting their
  history to pretend they always said the current thing.

**The main checkout goes stale in a way the worktrees do not**, because `worktree.py new` installs
dependencies for each new worktree and nothing installs here. Observed symptom: `tsc: command not
found` in `packages/migrations` with `WARN Local package.json exists, but node_modules missing` — on
a `git push --delete` that carried no TypeScript whatsoever, because the hook checks the working
tree rather than the push. The failure surfaces nowhere near its cause.

`/land-branch` now runs `pnpm install` immediately after `git pull --ff-only` (2026-07-31), on the
principle that the merge is what makes the checkout stale, so the merge is where the refresh
belongs. **Run it yourself after any other pull** — a `git pull` outside that flow still leaves the
checkout stale, and a branch that added a workspace dependency will fail typecheck on a module that
demonstrably exists.

**The pre-push hook skips a push that only deletes refs** (2026-07-31). Git feeds it
`<local ref> <local sha> <remote ref> <remote sha>` per ref; a deletion carries the all-zero local
sha, uploads no objects, and changes no code, so gating it tested the working tree instead. It
**fails closed**: no refs on stdin means the gate runs. Deleting a merged branch is the common case
and it was blocked by the stale-checkout failure above — a push that could not have broken anything,
refused for a reason it did not cause.

---

## 7. Keep this file current — it is part of the work, not a chore

**This file is maintained continuously, not rewritten occasionally.** Every rule above was paid for
by a defect, a wasted round trip, or a review finding. When you pay that price again, the lesson goes
here in the same change that fixes it — not into a handoff that the next session may not read.

**Add an entry when any of these happens:**

- A review finds a defect whose _shape_ could recur — a convention nobody wrote down, a claim that
  outran its evidence, a test that passed for the wrong reason.
- A trap costs real time: a gate that behaves differently locally than in CI, a command that fails
  in this shell, a tool that needs a flag here and nowhere else.
- You discover a convention by grepping rather than by reading — that is precisely the convention
  that was missing from this file.
- A decision gets made that a future session would otherwise relitigate, or worse, silently reverse.

**Do not add:** one-off bugs with no reusable shape, anything the code or types already state
plainly, or the narrative of what a session did. The last of those belongs in `docs/handoffs/`; this
file carries only what changes how the _next_ piece of work is done.

**The receipt rule in §1 applies to this file too.** An entry states the rule and what it cost —
"CI's test shards run `test:coverage`, not `test`" is followed by the consequence that made it worth
writing. A rule with no evidence behind it reads as opinion and gets ignored by the session that
most needs it. Quoting another entry here makes this paragraph go stale when that entry is
rewritten, which is what happened to its predecessor: it quoted "CI's `test` job", and `test` is not
a job any more.

**Prune as well as append.** A rule that has been superseded, or whose underlying trap was fixed in
the code, is worse than no rule: it teaches a session to work around something that no longer
exists. Delete it rather than leaving it to rot, and say so in the commit.

Natural moments to do this: while addressing review findings (the lesson is freshest and the branch
is already open), and when writing a handoff — anything in the handoff phrased as "next time,
remember to…" belongs here instead, because a handoff is read once and this file is read every
session.

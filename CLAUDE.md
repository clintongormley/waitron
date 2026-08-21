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

### A measurement taken where both answers look alike measures nothing

`pnpm --filter "...[origin/main]" ls --depth -1 --json` printing **zero bytes** in a worktree was
handed to `feat/scoped-pre-push-hook` as the receipt that pnpm's changed-since filter does not work
there. The conclusion is right. The run was not: it was made on a branch whose HEAD **equalled**
`origin/main`, and zero bytes is also the correct answer for a filter with nothing to match, so it
separated the two hypotheses not at all. Re-running it in the same state reproduces the number and
still proves nothing.

The real receipt needs a state where a working filter and a broken one disagree — one commit
touching `packages/db/README.md`, then the identical commands in a `git worktree` (0 bytes) and in a
plain `git clone` (2760 bytes, 11 packages), with `git diff --name-only main...HEAD` naming the path
in both. **Before running a probe, say what the FAILING case would print**; if that is what you
already expect to see, you are not running a probe. A control in the other direction is the cheapest
way to get one, and neither of these took a minute.

Note where this one came from: the zero-byte reading arrived in the task brief as already verified.
A receipt someone hands you is still a claim.

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

- **CI's test shards run `test:coverage`, not `test`.** The four-command gate above ends in plain
  `pnpm test`, so a coverage-threshold regression passes there and fails in CI. Before claiming a
  package is green, run `pnpm --filter <pkg> test:coverage`. The PRE-PUSH HOOK no longer has this
  gap — `.husky/pre-push` has run `test:coverage` since `feat/scoped-pre-push-hook`, which is what
  closed it — but the hook narrows to the changed packages and their dependents, so its green is
  evidence about those and not about the workspace. There is no `test` job to name any more:
  `.github/workflows/ci.yml` splits it across per-package and grouped shards — `test-heavy`
  (`packages/db`), `test-server` (`apps/server`), `test-fiscal-verifactu`, the three browser shards
  (`test-ui`/`test-till`/`test-dashboard`), and `test-light-a`/`test-light-b` (everything else, split
  in two by measured duration, `--no-sort`). Each maxForks:4 suite (db, apps/server, fiscal-verifactu)
  gets a runner of its own because it wants all four cores; see `OWN_SHARD_PACKAGES` and the two
  `LIGHT_*_PACKAGES` bins in `scripts/changed-scope.mjs`.
- **CI does not run every check on every push.** `ci.yml`'s `changes` job skips the expensive jobs
  outright when every changed path is documentation, and on a pull request narrows the test
  shards and both mutation jobs to the changed packages and their dependents. A merge to `main` runs
  the full unfiltered suite **whenever anything but documentation changed**, and that run is what
  verifies the narrowing was right — a documentation-only merge skips there too, which is the whole
  point of the two decisions being separate. So a green pull
  request is evidence about the packages that RAN — read the `changes` job's log for its `code`,
  `scope` and `packages` outputs and its per-job gates (`heavy`, `server`, `fiscal_verifactu`,
  `light_a`, `light_b`, `verifactu`, `shared`, and the browser gates)
  before treating it as evidence about the workspace. Design:
  `docs/superpowers/specs/2026-07-31-scoped-ci-design.md`. Since 2026-08-01 the `changes` job and
  the pre-push hook resolve that scope with the SAME script (`scripts/changed-packages.mjs`); before
  that they used two mechanisms, and CI's one attributed root config and the lockfile to the
  workspace root, so no package's tests ran at all on such a pull request.
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
  command with the empty filter dropped exits 0. The plan for that change asserted the opposite,
  that an empty filter "matches nothing rather than everything". It fails loudly, which is the
  better of the two directions, but never interpolate a possibly-empty value into a `--filter`:
  build the argument list so the filter is absent when there is nothing to narrow to. Both `ci.yml`
  and `.husky/pre-push` now accumulate `--filter "...<pkg>"` as positional parameters and simply
  append none, which removes THAT question — there is no empty filter left to pass. It does not
  remove the next one.
- **Dropping `eval` does not make an unquoted expansion safe — it still globs.** Both gates build
  their filters with `for pkg in $PACKAGES; do set -- "$@" --filter "...$pkg"; done`, and three
  comments plus the bullet above asserted that accumulating positional parameters rather than
  `eval`-ing a string had removed the word-splitting question. It removes half of it. `eval` was the
  SECOND shell pass, and losing it genuinely does make a quote, a `$` or a backtick in a name reach
  pnpm literally — but the FIRST pass is still there, and an unquoted expansion undergoes PATHNAME
  EXPANSION as well as field splitting. Measured on 2026-08-01 from a directory holding
  `package.json` and `packages/`, in bash 3.2.57 in `sh` mode (the `/bin/sh` husky invokes here),
  busybox `ash`, and bash 5.3.15 (`docker run --rm bash:5`) — all three line for line:

  ```
  PKGS="pack*"; set --; for pkg in $PKGS; do set -- "$@" --filter "...$pkg"; done; echo "$*"
    → --filter ...package.json --filter ...packages
  the same loop wrapped in set -f … set +f
    → --filter ...pack*
  ```

  The guard is `set -f` before the loop and `set +f` after it — checked in the same run that
  `echo pack*` expands again afterwards, so it does not leak into later commands. Run end to end as
  well, in a throwaway pnpm workspace holding a member literally named `pack*`, where the two filter
  lists visibly DISAGREE (§1's "a measurement taken where both answers look alike measures
  nothing"): `--filter "...pack*"` selects that member and prints it, while
  `--filter "...package.json" --filter "...packages"` prints zero bytes on both streams at exit 0.
  In CI that zero-byte reading is the SILENT direction — `packagesInScope` reads it as the definite
  empty set, not as the `null` that fails closed, so every scope gate goes false and all three test
  shards and both mutation jobs skip while `bundle-smoke` and `typecheck` still run (they gate on
  `code` alone), and `ci` counts a skip as a pass. (Re-measured on 2026-08-01 after `test-ui` was
  split out of `test-light`: `printf '' | node scripts/changed-scope.mjs` prints
  `heavy=false ui=false light=false verifactu=false shared=false`, exit 0. The count in this
  paragraph was `four` and `both`, written when there were two shards — a receipt that a behaviour
  change retires, §1.) The hook can catch it, but only when the
  corrupted name was the WHOLE scope: then the selection is empty and its "scope is runnable" step
  exits 1; with a surviving name beside it the run proceeds having quietly dropped one package.

  **What makes it unreachable today is a naming convention, not a rule.** Do not repeat the
  reachability claim this entry first carried — that no npm-valid name holds `*`, `?` or `[`. npm's
  registry rules never apply here: every member is `"private": true`, `pnpm ls -r --depth -1 --json`
  listed the `pack*` member without complaint, and `npm pack --dry-run` did not validate the name
  either (it wrote `pack*-1.0.0.tgz`). All that stands between this loop and a corrupted filter is
  that the fifteen members happen to be named `@waitron/<lowercase-and-hyphens>` — a property of
  today's manifests, which is the argument the `eval` version was defended with. Hence a guard.

- **A scoped `pnpm` run that selects nothing REPORTS SUCCESS.** Two different ways, both on stdout,
  both exit **0**, both measured in this workspace on 2026-08-01 (pnpm 9.15.0):
  `pnpm --filter "@waitron/nope" test:coverage` prints `No projects matched the filters in "…"`, and
  `pnpm --filter "...@waitron/bench-pglite" test:coverage` prints
  `None of the selected packages has a "test:coverage" script`. So a green test shard is not
  evidence that a test ran, and "the filter is wrong" looks identical to "everything passed". This
  cost a real defect — CI's whole `test-light` shard reporting green having executed nothing on a
  root-config pull request. Both gates now run
  `pnpm <the same filters> ls --depth -1 --json | node scripts/changed-packages.mjs runnable
test:coverage` first, which refuses a selection that would run nothing **unless every member of it
  is declared test-less**, where it passes and says so instead. Measured on 2026-08-01:
  `pnpm --filter "...@waitron/bench-pglite" --filter "!@waitron/db" ls --depth -1 --json | node
scripts/changed-packages.mjs runnable test:coverage` exits **0** with
  `nothing to run: no tests declared in @waitron/bench-pglite, by design`. So a member that
  deliberately has no tests must be named in `PACKAGES_WITHOUT_TESTS` (`scripts/changed-scope.mjs`),
  and a green from this guard still does not imply a test ran — only that nobody added a package
  that quietly runs none. (`.husky/pre-push` states it with that qualifier; this entry dropped it,
  which is how a guard gets cited for more than it does.) The guard reads the SELECTION, not pnpm's
  wording — a message that changes would switch a grep-based guard off silently.
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
- **`--frozen-lockfile` is not in the gate above either.** Moving a dependency between
  `dependencies` and `devDependencies` passes a plain `pnpm install` and fails CI at the install
  step. Run `pnpm install` and commit the lockfile. The pre-push hook DOES run
  `pnpm install --frozen-lockfile`, added on `feat/scoped-pre-push-hook`, so what is left uncovered
  is the four-command gate rather than the hook.
- **A filtered test run does not load a package's guard suites.**
  `pnpm --filter @waitron/db test provisioner-role` was green while
  `pnpm --filter @waitron/db test:coverage` failed on the same tree: the filter never loaded
  `english-only.test.ts`, which rejected `'Venta en establecimiento'` in a new fixture (`venta` is in
  `SPANISH_WORDS`). Cross-cutting suites that police the WHOLE package — the error-code reachability
  tests, schema-ownership — are invisible to a name-filtered run, so a filtered green says nothing
  about them. Run the package unfiltered before believing a pass. (The vocabulary guard was the
  example this entry was written about and is no longer one: it polices the whole TREE rather than
  one package, and moved to the root Vitest project on 2026-08-01 — §4.) Same
  false-green shape as the `test:coverage` and `--frozen-lockfile` traps above, in a third place.
  (Named rather than counted: an earlier version said "the two traps above" and stopped being true
  the moment a bullet was inserted between them.)

- **A hardcoded cross-package list goes stale when a manifest or scope changes, and scoped CI hides
  it.** Adding `identity` to `migrations.manifest.json` and to `packages/db/src/english-only.ts`'s
  `GENERIC_PACKAGES` (both on `feat/identity`) left two tests asserting the OLD list red —
  `packages/fiscal-verifactu/src/vocabulary-scope.test.ts` (pins `GENERIC_PACKAGES`) and
  `packages/provisioning/src/instance-apply.rls.test.ts` (pins the manifest's `migratedSets`).
  Neither package was in the changing task's scope, so its scoped `test:coverage` never ran them;
  both went red only when a LATER, unrelated task happened to run those packages — costing a fix
  round each, in the wrong task. `pnpm typecheck` catches a compile break but NOT a stale hardcoded
  array. When you add a member to a repo-wide list (the migration manifest, `GENERIC_PACKAGES`,
  `OWN_SHARD_PACKAGES`), grep every package for a test that pins that list and run the WHOLE
  workspace's suites, not just the changed package's.

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
except the two browser packages, `packages/ui` and `apps/till`, which each carry `95/95/90/88` with a
documented reason in their own config.

---

## 3. Conventions reviewers enforce

**Error codes name the DOMAIN CONCEPT, never the throwing package.** `series.not_found`, not
`db.series_not_found` — see the design note atop `packages/shared/src/errors.ts`. That one code was
renamed twice to converge on the rule. Codes are **never renamed once shipped**; a wrong one is
deprecated and a new one added beside it. `server.*` is reserved for facts about the process itself
(`apps/server/src/errors.ts` says so in its own doc comment) — "no such tenant" is a fact about a
tenant, not about the process.

Every file that throws a code imports its registry (`import "./errors.js"`) directly.

**Spanish domain terms are deliberate**, guarded by `packages/db/src/english-only.ts` — whose suite
is `scripts/english-only.test.ts`, in the root Vitest project rather than beside it (§4). Fiscal
tables and columns use the Veri*Factu vocabulary (`envios`, `estado`, `huella`, `secuencia`,
`entorno`). Add new Spanish schema tokens to `SPANISH_WORDS`. `packages/verifactu` and
`packages/fiscal-verifactu` are exempt from the guard; `apps/*` is out of scope by a recorded
decision.

**`@waitron/db`'s `exports` map is enumerated, not a wildcard** — `.`, `./testing/postgres.js`,
`./testing/seed.js`, plus `./testing/lifecycle.js` and `./testing/shared-container.js` (the last two
added by the shared-container test-tier rollout, #112/#114, so every package's `globalSetup` can
import `useTemplateDb` / `startSharedContainer`). A wildcard would publish the whole harness and give
`asAppUser` a second import path; enumerating exposes exactly the entry points that are needed and
nothing more. A consequence worth knowing: `apps/server` cannot deep-import `packages/db`'s `errors.ts`.

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
- **validate and throw** — `probeRoleStatement` (`packages/db/src/testing/identifiers.ts`), for values
  that should only ever be fixtures, where anything needing an escape is a bug worth failing on.

Either is acceptable; **neither being present is not**, and "the callers only pass safe values" is a
property of the callers rather than of the code — precisely the §1 defect class, since these
parameters are typed plain `string`.

**Never widen a grant to make a test pass.** `app_user` holds `SELECT` on `tenants` and not `INSERT`
deliberately — the running POS cannot create tenants.

**A new `tenant_id`-bearing table needs FORCE RLS + a tenant-isolation policy + grants, and
`.enableRLS()` gives only the first.** Drizzle's `.enableRLS()` emits `ENABLE ROW LEVEL SECURITY` and
nothing more; the `FORCE ROW LEVEL SECURITY`, the
`CREATE POLICY <t>_tenant_isolation … USING/WITH CHECK (tenant_id = current_tenant_id())`, and the
`GRANT`s to `app_user` are hand-written in a custom migration (`drizzle-kit generate --custom`), the
way `0001_tenancy_rls.sql` does for `tenants`/`locations`/`tills`. ENABLE with no policy denies the app
role everything; no FORCE lets the table owner bypass. **The guard that catches a missing FORCE lives
in another package:** `packages/fiscal-verifactu`'s `inmutabilidad` suite scans every table in the
database that HAS a `tenant_id` column (keyed on the column, not on "is in this package"), so a
tenant-scoped table added in `packages/db` leaves that guard red while `packages/db`'s own suite is
green. Cost: `nodes` shipped with `.enableRLS()` alone and its task review passed on the `@waitron/db`
suite; the gap surfaced only when a later task ran the fiscal suite (`nodes: relforcerowsecurity=false`).
Run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after adding any tenant-scoped table,
in any package.

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

**A test that shells out to `git` must clear `GIT_DIR`, or it writes to the repository running it.**
`GIT_DIR` outranks a child process's `cwd`, and **git exports it for every hook it runs** — so a
fixture that builds a throwaway repo with `mkdtemp` and commits into it with `cwd` set is isolated
when you run it by hand and destructive when `.husky/pre-push` runs it. Measured on
`scripts/check-signoff.test.mjs`, same command, the variable the only difference:

```text
$ pnpm vitest run scripts/check-signoff.test.mjs                  → HEAD unchanged
$ GIT_DIR=$(git rev-parse --absolute-git-dir) pnpm vitest run …   → HEAD +7 commits
```

Cost: seven fixture commits landed on `fix/repo-wide-guards-and-signoff` and were **pushed three
times** before the cause was found — five of them failing the DCO check that same script exists to
enforce, so the suite testing the sign-off gate was breaking it. It also wrote `user.name` and
`user.email` into the shared `.git/config`, which every worktree inherits, and one commit went out
authored by `Fixture Author`. The tell is a branch that gains commits **during `git push`**: the hook
mutates the ref and git pushes the moved value, so the push reports a SHA that is no longer the tip.

**The config damage outlasts the commits, and is worse.** A fixture's `git init` under a redirected
`GIT_DIR` re-initialises the real repository, and it set **`core.bare = true`** on the main checkout —
after which `git checkout`, `git pull` and `git status` all fail with
`fatal: this operation must be run in a work tree`, in a directory whose files are all still present.
`git worktree list` reports the checkout as `(bare)`, which is the quickest way to spot it.
`git config --unset core.bare` restores it; nothing is lost, but the failure names the operation
rather than the cause and reads like a corrupted repository. Check `core.bare`, `user.name` and
`user.email` on the shared config after any suite that shells out to `git` has run inside a hook.

`GIT_DIR` is the one that bites, but clear the whole family — `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
`GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_NAMESPACE` —
since each relocates a write just as effectively. Pointing `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` at
`/dev/null`, which that suite already did, does nothing about any of them. And run such a suite once
under `GIT_DIR` before trusting it: by hand is the one way the bug cannot appear.

**Don't own a database in a suite — let a helper own it.** `usePgliteDb` and `useRealPostgres`
(`@waitron/db/testing/lifecycle.js`) register their own `beforeAll`/`afterAll` and hand back an
accessor that **throws** rather than returning `undefined` if read before setup. A suite using them
cannot write a broken teardown, because it writes no teardown. Reach for a raw
`beforeAll`/`afterAll` pair only when the suite legitimately builds its own resource — a unit test
_of_ the constructor, or a race needing several distinct connections.

**Where you must, guard it**: `if (db !== undefined) await db.close()`. **Enforced** by
`scripts/guarded-teardowns.test.ts`, which also records what an unguarded teardown costs, why an
ESLint rule was rejected, and the two things the guard cannot see. Read it before changing it — a
convention this file had already stated was violated in 94 places, which is the general lesson:
**a written rule with standing violations needs a guard, not another paragraph.**

**A guard that reads the whole tree belongs in the ROOT Vitest project, not in a package.** Both of
this repo's tree-wide guards lived in `packages/db` — the teardown guard above, which scans every
`*.test.ts` under `packages/` and `apps/`, and `english-only`, which scans the eleven generic
packages' `src/`. A suite only loads when its package is in scope, and once both gates started
scoping by package, most pushes stopped reaching `packages/db`: measured on 2026-08-01,
`pnpm --filter "...@waitron/ui" ls -r --depth -1 --json` lists one package and
`--filter "...@waitron/payments"` lists six, none of them `@waitron/db`, while CI gates its
`test-heavy` shard on `@waitron/db` being in scope. So a `packages/payments` pull request ran
neither guard in either place and their first run was the unfiltered `main` merge — the §2 trap
below, one level up, with the filter over PACKAGES rather than over test names. They now live in
`scripts/`, which `pnpm vitest run --coverage` runs from ci.yml's ungated `lint` job and from
`.husky/pre-push` on every push that is not documentation-only. Two things to know before putting a
third guard there: **the root project does not typecheck** (`pnpm typecheck` is `pnpm -r typecheck`
and never visits the workspace root, §2 — so a type error in one of those files is caught only when
it is also a runtime error), and a module tested only from there has to be named in the root
`vitest.config.ts`'s `coverage.include` and excluded from its own package's, or it is measured twice
or not at all.

Suites sharing a database must clean up in a `finally` so they are order-independent, not
order-reliant — several tests have been fixed for exactly this.

**Prove a guard by deletion.** Remove the check, confirm the test fails, restore it. A test that
still passes with the guard removed is not testing the guard. Do the same for a negative control:
confirm it fails for the reason you think it does.

**Vitest's default coverage excludes swallow the whole of `.github/`.** Coverage `include` and
`exclude` replace rather than merge, so a config that spreads `coverageConfigDefaults.exclude` back
in inherits all seventeen entries — one of which, `**/[.]**`, matches any dot-prefixed path segment.
The root `vitest.config.ts`'s first version spread them verbatim and measured
**nothing**: `vitest run --coverage` printed `All files | 0 | 0 | 0 | 0`, wrote a
`coverage-summary.json` whose every `pct` was the string `"Unknown"`, and **exited 0** — the
98/98/98/95 thresholds passed without a line of source being read. Both configs were re-run against
`vitest@3.2.7`: the verbatim spread exits 0 at zero coverage, the one that filtered that single
pattern out reported `changed-scope.mjs` at 100/100/100/100. A coverage gate cannot fail on a file it
never opened, so whenever `include` points anywhere dot-prefixed, read the per-file table rather than
the exit code.

That workaround is **gone from the tree** as of 2026-08-01: both classifiers moved to `scripts/`,
nothing measured is dot-prefixed any more, and the root config now carries no `exclude` at all —
measured there rather than reasoned about, in three spellings that all printed the identical
three-row table at 100/100/100/100: no `exclude` key, `exclude: []`, and
`exclude: ["**/*.test.mjs"]`. So an explicit one would be dead config _here_, where `include` already
narrows to three files — `packages/db/src/english-only.ts` and the two classifiers. (This sentence
said "two" from `6d30ed2`, which is where it landed, until the very next commit put
`english-only.ts` into that `include` and left it standing. Re-run on 2026-08-01.) Three
spellings is not "both directions", which an earlier version of this sentence called it: every one of
those runs pointed the same way, and a control would need a config where the `exclude` does change
the table. The trap is a property of Vitest's defaults, not of that config, so it is waiting for the
next `include` that points inside a dot-directory.

**`errors.ts` reachability is guarded once, in the root Vitest project — `scripts/errors-reachable.test.ts`.**
The rule is real: an `errors.ts` unreachable from its package's own barrel is invisible to external
consumers, because the package's own `pnpm typecheck` loads it anyway (`tsconfig` `include`s all of
`src`) so nothing that runs from inside the package ever notices. Until 2026-08-11 thirteen packages
each hand-copied a per-package `src/errors.reachability.test.ts`, in **two shapes**, and six of them
did not test reachability at all — the shape (constructing an `AppError`, checking the barrel loads)
inspects no import graph. Proven by deletion in `test/reachability-import-graph`, `import "./errors.js"`
stripped from every file that reaches it: `packages/migrations` (a smoke copy) passed **2/2 with
`errors.ts` fully unreachable** — `AppError` validates nothing against `ErrorParams` at runtime and
`vitest run` does not typecheck — while `packages/db` (a _text-walk_ copy, which reads source as text
and walks the import graph from `index.ts`) **failed correctly**, `expected false to be true`, and
passed again once restored. So the old CLAUDE.md claim "the test does not test reachability" was true
for the six smoke copies and **false for the seven text-walk copies**; it conflated them, and its
"eight packages" list mixed the two. Two augmenting packages (`catalogue`, `provisioning`) had no
copy at all.

All thirteen copies are deleted. The single root guard discovers every `packages/*` that ships both
`src/index.ts` and `src/errors.ts` — **sixteen today**, including the two that were uncovered and
`shared` itself — and asserts reachability with the proven text-walk. It is **proven by deletion
through the new guard**: delete both of `db`'s reachable `import "./errors.js"` lines and the `db`
case fails while the other fifteen pass; restore and all green. It reads **text, not types**, so a
`from "./errors.js"` sitting in a _comment_ on a still-reachable file would fake an edge — a limitation
stated in the guard's own header, not papered over. Comment-stripping was rejected: a block stripper
mishandles a slash-star opener inside a string literal (a glob), which would drop a **real** import and
misfire the guard, a worse failure than the hole it closes. The tree already carried the working
mechanism, so the earlier idea of a `tsc` downstream-consumer probe or a narrowed `include` was not
needed. Living in the root project, the guard **auto-covers packages added later** — which is what the
hand-copied version's drift shows was needed: eight in this file's own former count, thirteen actually
in the tree, and `catalogue` and `provisioning` never copied at all. Like the other root guards it is
**not typechecked** (§2), so keep it plain.

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
- **A `docs/backlog.md` change is exempt from the PR ceremony** — user decision, 2026-08-02. Use a
  plain `git worktree add <path> -b <branch>` (NOT `worktree.py new`, whose `pnpm install` a docs
  edit does not need), commit `-s`, and merge to `main` directly: **no PR, no CI wait, no Copilot,
  no `/land-branch`.** The gate has nothing to run on such a change, measured on 2026-08-02:
  `pnpm exec eslint . --format json` lints **0 Markdown files and 0 files under `docs/`** (the total
  moves per commit; the zeros are the load-bearing part); `prettier --file-info docs/backlog.md`
  reports `ignored: true` (it is under `.prettierignore`'s `docs/`), while the same command on
  `CLAUDE.md` and `README.md` reports `ignored: false`; and on the `docs/backlog.md`-only PR #44,
  CI's `changes` job classified it documentation-only and `test-heavy`, `test-light`, `test-ui`,
  `typecheck`, both `mutation-*` and `bundle-smoke` all reported `skipping`. So a PR + CI + Copilot +
  land-branch gate is disproportionate; the cost that produced the rule was running the whole
  apparatus for a 12-line _Debt and odd jobs_ entry (#44). Still branch — do not commit on `main`
  directly — and still `-s` every commit. The carve-out is exactly the `docs/` prose that
  `.prettierignore` covers: a **root-level** `CLAUDE.md` or `README.md` is format-checked (the
  `ignored: false` above — this very edit is one), so an edit to either still runs the normal flow,
  as does all feature/code work.
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
mirrors CI's fast checks but is **not** identical to it — see §2 for where they diverge. Since
`feat/scoped-pre-push-hook` the differences are narrower than this paragraph used to claim, and in
the opposite direction: the hook **narrows** too (`typecheck` and `test:coverage` run over the
changed packages and their dependents, the same shape as CI's shards), it **does** run coverage
thresholds (`test:coverage`, not `test`) and it **does** run `pnpm install --frozen-lockfile`. What
is still CI-only is **mutation testing** and the **`bundle-smoke` builds**, so a green hook does not
imply a green CI. Both narrow, so a green from either is evidence about the packages that ran; the
unfiltered `main` merge is the only run that covers the rest. Bypassing the hook with `--no-verify`
is for emergencies only, and the underlying failure still needs fixing because CI runs the same
checks.

The four-command gate at the top of §2 is now the **shallower** of the two — it ends in plain
`pnpm test`, with no coverage thresholds and no `--frozen-lockfile`. Run it for the whole-workspace
breadth the hook no longer gives you, not for depth.

**Before a release** (when there is a release process — there is none yet), update the docs and
tests alongside the code.

**Docs:**

- **`docs/backlog.md` answers "what should I work on?"** — what is in flight, what is next, and the
  reasoning for the order. Read it before starting anything unprompted, and **update it in the same
  change that makes it stale**. It exists because nothing else did: priorities lived in session
  memory, which drifts and cannot be reviewed, and several of those notes still point at pull
  request numbers that no longer exist. The legal and administrative track is separate, in
  `docs/compliance/action-plan.md`.

  **The moment it goes stale most reliably is a MERGE**, and that is not covered by the sentence
  above, because the change that lands the work is written before the work has landed. The scoped-CI
  cycle left two rows describing #27 as "in flight on `feat/ci-scoped-testing`" — a branch deleted by
  the merge itself — and the same merge produced follow-ups that lived only in pull-request comments,
  which is nowhere anyone looks later. `/land-branch` now carries a step for this (update the
  backlog, record every pending issue, then report what changed). That step is the guard; this
  paragraph is only the receipt for why it exists. **A written rule with standing violations needs a
  guard, not another paragraph** — §7 says so, and this rule had just violated itself.

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

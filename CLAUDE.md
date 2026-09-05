# Waitron — working notes for Claude

A Spanish restaurant POS with Veri\*Factu fiscal compliance. It files invoice records with AEAT (the
Spanish tax agency) and takes card payments through Stripe.

**What makes this codebase unusual:** some mistakes here cannot be fixed afterwards. Fiscal records
are append-only and hash-chained, invoice numbers are never reused, and chains cannot be merged or
migrated. A wrong filing is not repairable by editing data. That is why the conventions below are
strict and why claims in comments are held to an unusual standard.

**How to read this file.** Each entry is a rule, then the one incident that paid for it, then a
pointer. The pointer (a commit, a PR, a spec) holds the full receipt; this file does not repeat it.
`docs/backlog.md` answers "what should I work on?"; this file answers "how".

---

## 1. Writing claims — the house's dominant defect class

Comments and docs that assert more than the code delivers are this repo's most common defect, by a
wide margin.

- **A claim of necessity or impossibility needs a receipt** — the command that was run, or a cited
  `file:line`. Good shape: _"Proven on PostgreSQL 18 against the real migrations, as a LOGIN role with
  rolsuper = f: the four inserts succeed."_ Paid for three times in one day on `bootstrap-tenant.sql`:
  "superuser is unavoidable" (false — ninety seconds with a container), its correction "psql cannot
  `\gset` a uuid" (false — the same file used `\gset`), and _its_ replacement "no non-superuser role
  holds INSERT on `deployment`" (false — the table OWNER holds it implicitly). When a claim names a
  privilege, name the role SHAPE that holds it: owner, grantee, or member.
- **Reading is not verification.** That superuser claim survived a correction pass, a four-agent
  simplify, a fresh-context review and Copilot — all reading. Run the thing.
- **State the experiment, not the conclusion.** "I deleted the tenant predicate and the test failed"
  is checkable; "the guard is proven" is not. If the sentence describes more than what you ran, narrow
  it.
- **A measurement taken where both answers look alike measures nothing.** Before running a probe,
  say what the FAILING case would print; if that is what you expect to see, you are not running a
  probe. A control in the other direction is the cheapest way to get one. (A zero-byte
  `pnpm --filter "...[origin/main]"` reading was handed to `feat/scoped-pre-push-hook` as proof the
  filter was broken — taken on a branch whose HEAD equalled `origin/main`, where zero is also the
  correct answer.) A receipt someone hands you is still a claim.
- **"Pre-existing", "not a regression", "harmless", "unreachable" and "narrow" are claims.** Check
  with `git log`/`git blame` before saying any of them; unchecked, say "I believe this predates the
  branch".
- **The correction is a new claim.** Both false claims above were born while fixing someone else's,
  and `feat/provisioning-instance` produced three more the same way. The replacement text deserves
  MORE scrutiny than the text it replaces — this is the single most productive source of false claims
  in the repository's history.
- **Before asserting a convention, grep the siblings** — identifiers AND prose. An error code
  prefixed `payments.` landed beside twelve `payment.` siblings (codes are never renamed once shipped);
  a spec used `orphan` to mean what `packages/payments/src/reconcile.ts` calls `unmatched`.
- **A behaviour change retires every receipt about the old behaviour — editing a file is not
  auditing it.** `fix/provisioning-migrate-gate` corrected the comment on the gate it changed and left
  three stale claims in two READMEs, two of them in a file the branch had already edited 21 lines below
  its hunk — one a documented operator procedure that the change had turned into a `42501`. Read the
  runbooks and README paraphrases of test assertions across the whole base-to-tip range; a diff shows
  three lines of context. Per-task review cannot see this class; budget one base-to-tip pass before the
  PR (`/finish-branch` step 2's convention reviewer does it).
- **Claims about the outside world need receipts too — and the source's own words.** Every external
  claim gets a provenance row (`2026-07-30-deli-hardware-design.md` sourced eight prices and then
  asserted unsourced that "iOS Safari implements none of those APIs" — its decisive claim). Quote,
  then paraphrase: compressing Square's _"doesn't support splitting a checkout into multiple payments
  for a single checkout request"_ to "no splitting a checkout" turned an API limit into a product
  limitation. Two sources that seem to contradict usually describe different paths (SumUp's API needs
  the device online; the Solo's offline mode is the device's own flow).
- **A comment carries the invariant, not the history.** Comments state what the code guarantees and
  the non-obvious reason; the receipt (PR number, review round, experiment) lives in the commit
  message and PR thread, with at most a one-line pointer. Measured 2026-09-05: comment lines were
  43–48% of non-test source in `apps/server`, `packages/db`, `packages/core` and `packages/sync`,
  nearly all narrative — which doubles the tokens of every file read and goes stale exactly the way
  this section documents. Thin on touch; do not sweep. (Owner decision after the whole-project review.)

---

## 2. The gate

```bash
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
```

That is the shallow, whole-workspace check. The pre-push hook (`.husky/pre-push`) is deeper but
narrower: `pnpm reap`, `pnpm install --frozen-lockfile`, `format:check`, then `typecheck` and
`test:coverage` over the CHANGED packages and their dependents (resolved by
`scripts/changed-packages.mjs`, the same script CI's `changes` job uses). CI adds mutation testing
and `bundle-smoke`, which nothing local runs. A green from any one of the three is evidence about
what it ran.

**Coverage thresholds** are split (owner decision 2026-09-05): `statements 98 / lines 98 /
functions 98 / branches 95` in `verifactu`, `fiscal-verifactu`, `core`, `db`, `sync` and `payments`
— the fiscal core and the data-layer foundations — and the `90/90/85/85` floor in every other
package, browser packages included. The six are the owner's list, not a rule that derives them
(`apps/server` holds the AEAT transport and sits at the floor). The root project keeps the high
bar: its coverage table is the root `scripts/*.mjs` plus the vocabulary module, two of them the
classifiers that decide what CI and the hook run. Which package holds which bar is pinned by
`scripts/coverage-thresholds.test.ts` — a hardcoded list, safe only because the root project is
the one gate never narrowed away; moving a package is an edit to that list, with the reason in
the commit.

Traps, each of which cost a round trip:

- **CI's shards run `test:coverage`, not `test`.** Before calling a package green, run
  `pnpm --filter <pkg> test:coverage`. There is no single `test` job: `.github/workflows/ci.yml` runs
  `test-heavy` (`packages/db`) and `test-server` (`apps/server`) as three-way file shards each with a
  `-merge` job that enforces the thresholds on the merged blob (#216), plus `test-fiscal-verifactu`,
  the browser shards (`test-ui`, `test-till`, `test-dashboard`, `test-setup`) and `test-light-a` /
  `test-light-b` for everything else (bins in `scripts/changed-scope.mjs`). Vitest `--shard` splits
  by FILE COUNT, so shard imbalance is the real limit, and `N` must never exceed a package's test-file
  count.
- **CI does not run every check on every push.** The `changes` job skips the expensive jobs when
  every changed path is documentation, and on a pull request narrows the shards and mutation jobs to
  the changed packages and their dependents. A merge to `main` runs the unfiltered suite whenever
  anything but documentation changed — that run verifies the narrowing. Read the `changes` job's
  `code`, `scope` and `packages` outputs before treating a green PR as evidence about the workspace.
  Design: `docs/superpowers/specs/2026-07-31-scoped-ci-design.md`.
- **A cheap job can still be the critical path.** `mutation-verifactu` was ungated because a mutant
  is cheap; on run 30650089655 it was 3m26s of a 4m8s run. Sort a run's jobs by duration before
  calling a job cheap enough to leave ungated.
- **The pnpm changed-since filter silently matches nothing in a `git worktree`** (measured on pnpm
  9.15.0), and all feature work here happens in one. Verify anything touching the filter in a clone or
  on a real PR.
- **`pnpm --filter ""` is a hard error**, and an unquoted `$PACKAGES` expansion still GLOBS even with
  `eval` gone (`pack*` → `package.json packages`, measured in bash 3.2, busybox ash and bash 5.3).
  Both gates build filters as positional parameters under `set -f … set +f`. What keeps that loop
  safe is that every member is named `@waitron/<lowercase-and-hyphens>` — a property of today's
  manifests, not a rule (`npm pack` accepts `pack*`).
- **A scoped `pnpm` run that selects nothing REPORTS SUCCESS** (`No projects matched` and
  `None of the selected packages has a "test:coverage" script` both exit 0). Both gates first pipe the
  selection through `scripts/changed-packages.mjs runnable test:coverage`, which refuses an empty run
  unless every member is in `PACKAGES_WITHOUT_TESTS` (`scripts/changed-scope.mjs`). A green from that
  guard still does not mean a test ran.
- **The workspace root is outside `pnpm -r`**, so root config (`vitest.config.ts`, `scripts/`) is
  linted but never typechecked, and `eslint.config.js` is not type-aware. Proven by mutation: an
  exported `const x: number = "no"` in root config passes lint, typecheck and vitest.
- **`--frozen-lockfile` is not in the four-command gate.** Moving a dependency between
  `dependencies` and `devDependencies` fails CI at install. The hook runs it; the gate does not.
- **A name-filtered test run does not load the package's guard suites** (schema ownership, error-code
  reachability) nor any e2e suite pinning a shared wire body with `toEqual` — SP-2b's `/hello` change
  passed `test sync-api` (11 tests) and broke two boot suites for two tasks. Run the package unfiltered
  before believing a pass, and the whole workspace when you touch a value more than one suite asserts.
- **A hardcoded cross-package list goes stale when a manifest or scope changes, and scoped CI hides
  it.** Adding a member to `migrations.manifest.json`, `GENERIC_PACKAGES` or `OWN_SHARD_PACKAGES`
  left tests in two OTHER packages red until an unrelated task ran them. Grep for tests that pin the
  list; run the whole workspace.
- **After a rebase + `--force-with-lease`, the hook can scope the WRONG package.** Restacking a
  dashboard-only branch, it printed `all checks passed (@waitron/till + dependents)`. Mechanism
  unconfirmed (plausibly the stale remote SHA git feeds a force-update). Confirm what changed with
  `git diff --name-only origin/main..HEAD` and run THAT package's `typecheck` + `test:coverage`; the
  PR's own CI scopes off the PR diff and is the trustworthy signal.
- **The pre-push log file can be days stale** (`/tmp/waitron-root-test-run.log` once named a test the
  branch had deleted). Reproduce; do not read it.
- **The four browser packages run vitest in real headless Chromium.** Never run two browser-mode
  gates at once, and never background `pnpm -r test:coverage` beside running subagents — two 65 GB
  RAM spikes and a force-quit on 2026-08-30. Lean on the scoped hook and CI; a whole-workspace local
  run, if genuinely needed, runs alone with `--workspace-concurrency=2`.

Bypassing the hook with `--no-verify` is for emergencies; the failure still has to be fixed because
CI runs the same checks. A hook failure the PR does not reproduce is a check CI has deferred to the
unfiltered `main` run, not a wrong hook.

---

## 3. Conventions reviewers enforce

- **Error codes name the DOMAIN CONCEPT, never the throwing package** — `series.not_found`, not
  `db.series_not_found` (design note atop `packages/shared/src/errors.ts`). Codes are **never renamed
  once shipped**; deprecate and add a sibling. `server.*` is reserved for facts about the process
  itself (`apps/server/src/errors.ts`). Every file that throws a code imports its registry
  (`import "./errors.js"`); reachability is guarded once, in the root project (§4).
- **Spanish domain terms are deliberate, and a module declares its own.** The guard is
  `packages/db/src/english-only.ts` (suite `scripts/english-only.test.ts`, root project); its
  `SPANISH_WORDS` is only the BASE list of generic POS Spanish no module owns. A module's terms live
  on its descriptor's `vocabulary` seat — `FISCAL_VOCABULARY` (`packages/fiscal-verifactu`),
  `WORKFORCE_ES_VOCABULARY` (`packages/workforce-es`), wired in `apps/server/src/modules.ts` — and
  the suite assembles the forbidden set from the descriptors, deriving each owner's package from
  `migrations.from` (`@waitron/module`'s `vocabularyOwners`). One declaring home per word: a new
  fiscal term goes in the fiscal list, never the base (the suite fails on a clash). Fiscal tables
  and columns use the Veri\*Factu vocabulary (`envios`, `huella`, `secuencia`, `entorno`).
  `packages/verifactu` is an unlisted library (in no list, never scanned); `apps/*` is out of scope
  by a recorded decision, so Spanish IDENTIFIERS in app UI code are caught only by review. Design:
  `docs/superpowers/specs/2026-09-05-module-sp3b-vocabulary-design.md`.
- **`@waitron/db`'s `exports` map is enumerated, not a wildcard** — `.`, `./testing/postgres.js`,
  `./testing/seed.js`, `./testing/lifecycle.js`, `./testing/shared-container.js`. A wildcard would
  publish the whole harness and give `asAppUser` a second import path. Consequence: `apps/server`
  cannot deep-import `packages/db`'s `errors.ts`.
- **Never build SQL by string concatenation — except for utility statements, which PostgreSQL will
  not bind.** Drizzle's `` sql`… ${value}` `` parameterises (verified: `o'brien; drop table x --`
  round-trips intact), but `CREATE ROLE … $1`, `CREATE DATABASE`, `GRANT` are syntax errors. For those,
  either **escape** (`quoteIdent`/`quoteLiteral`, `packages/provisioning/src/identifiers.ts`) or
  **validate and throw** (`probeRoleStatement`, `packages/db/src/testing/identifiers.ts`). Neither is
  not acceptable; "the callers only pass safe values" is the §1 defect class.
- **A `sql` scalar subquery correlated to the OUTER query's table breaks silently when that table is
  the `.from()` base rather than a join.** Drizzle renders `` `${table.column}` `` as the bare quoted
  column; joined tables are aliased so it resolves outward, but a base table's bare `"id"` binds to
  the SUBQUERY's table — no error, a wrong answer (#152: a null table label). Copying a correlated
  subquery: check base-vs-join and READ the emitted SQL with `.toSQL()`.
- **Never widen a grant to make a test pass.** `app_user` holds `SELECT` on `tenants` and not `INSERT`
  deliberately.
- **A new `tenant_id`-bearing table needs FORCE RLS + a tenant-isolation policy + grants; Drizzle's
  `.enableRLS()` gives only `ENABLE`.** The rest is a hand-written custom migration, the way
  `0001_tenancy_rls.sql` does it. ENABLE with no policy denies the app role everything; no FORCE lets
  the owner bypass. **The guard lives in another package:** `packages/fiscal-verifactu`'s
  `inmutabilidad` suite scans every table carrying a `tenant_id` column — run
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after adding one anywhere (`nodes`
  shipped without FORCE and its own package's suite was green). _Removing FORCE RLS altogether is a
  pending owner decision — `docs/backlog.md`, design review 2026-09-05._
- **A module/migration dependency graph has TWO kinds of cross-set edge**: FK `REFERENCES` and
  `CREATE [CONSTRAINT] TRIGGER … ON <table>`. `sync` enrols other modules' tables by installing capture
  triggers on them, so it depends on `identity` and `payments` with no FK between them; SP-1c's first
  graph missed both. Guarded by `scripts/module-graph-honesty.test.ts`, which reads text and says so.
- **An object-privilege `GRANT` PostgreSQL accepted is not a `GRANT` that did anything.** Measured on
  PostgreSQL 18.4 from a non-owning `createdb createrole` admin: no privilege held → `42501`; some
  privilege without grant option → `WARNING: no privileges were granted`, rc 0; grant option on part
  of the list → `WARNING: not all privileges were granted` (and `GRANT ALL` suppresses even that).
  `PUBLIC`'s default `CONNECT`/`TEMP` counts as "held", so the hard error is rarely reached. Read the
  ACL back (`pg_database.datacl` / `pg_namespace.nspacl`): a failed `GRANT` still materialises
  `datacl` from NULL, a grantee holds one entry PER GRANTOR, and `has_*` functions see grant options
  but also count privileges held only through group membership — a false positive a provisioner must
  not accept. Role-membership grants are different: they always ERROR. Cost: a Critical plus three fix
  rounds on `feat/provisioning-instance`.
- **Multi-table writes share ONE transaction, and `withTenant` IS that transaction**
  (`packages/db/src/tenancy.ts`). Write-path functions take a `tx: Transaction` and never open their
  own; a route handler opens exactly one `withTenant` per request (`recordSale`'s header says why —
  `packages/core/src/record-sale.ts`). A convention, not a compiler guarantee: `Database` is
  assignable to `Transaction`, and an ESLint backstop was declined (2026-09-03). **Splitting one
  logical change across transactions is a commented decision, never a default** — the two that do it
  (`provisionVenue`'s latch, `adoptFromPrimary`'s idempotent steps) say so in their headers because a
  non-DB step sits between the writes.
- **No backwards-compatibility or data-migration code until Waitron is in production.** Nothing is
  deployed; schema changes drop and recreate. A backfill for an empty database is code to maintain
  that buys nothing — and the first draft of the settlement design carried one that could only ever
  GUESS which tender a tip belonged to, which is worse than discarding. This rule expires the day a
  real venue is live; add its replacement in the same change.
- **An empty connection string is a valid connection string.** `new Client({ connectionString: "" })`
  resolves to localhost with every default (`pg@8.22.0`). Anything reading a URL from env or a prompt
  refuses `""` explicitly (`isUnset`); `waitron-provision instance` would otherwise have stamped
  whatever answered on localhost.
- **A drizzle migration-number collision on rebase is fixed by regeneration, never by hand-editing
  the snapshots or `_journal.json`.** At the paused rebase, reset the migrations dir to main's exact state
  (`git checkout origin/main -- packages/db/drizzle/`; keep the branch's `src/schema/*.ts`), then
  `pnpm --filter @waitron/db db:generate --name <foo>` (and `db:generate:custom --name <foo>_rls`,
  pasting back the RLS SQL you saved first), stage only your migrations, `rebase --continue`, and
  verify by RUNNING the package's RLS suite plus `inmutabilidad`. Works because the snapshot chain
  deliberately lags the DB (custom migrations are snapshot-less). Paid for on #165.

---

## 4. Testing

- **Two targets.** **PGlite** (`createPgliteDb` + `runMigrations`) is hermetic and fast, but every
  connection is a superuser (RLS bypassed) and every query serialises onto one backend, so a
  contention test on PGlite is a **false pass**. **Real Postgres** via Testcontainers is required for
  anything about privileges, RLS as the deployment role, or concurrency; `describeEachTarget`
  (`packages/db/src/testing/harness.ts`) runs a suite against both. Pick the lighter one when the
  heavier one's justification does not apply, and say why in a comment.
- **`TESTCONTAINERS_RYUK_DISABLED=true` is required locally**, or container suites hang until the
  180 s `hookTimeout`. Docker contention on a full `pnpm test` shows up as `EADDRINUSE` and passes on
  retry.
- **With Ryuk off, INTERRUPTED runs leak containers** (a clean vitest exit self-reaps via
  `globalTeardown`). The bloat (once: 173 volumes, 23 GB) starves PGlite `beforeAll`s and the
  `freePort` race, while an isolated re-run passes and proves nothing. `pnpm reap`
  (`scripts/reap-testcontainers.mjs`, also first in the hook) removes only containers labelled
  `com.waitron.reapable` (stamped by `startPostgresContainer`, pinned by test) AND older than 2 h —
  so another repo's or a live watch-mode container survives — with their anon volumes. It never
  touches images and there is no blanket `docker volume prune` (it would reach other projects and
  the named dev volumes). `docker volume inspect` before any manual `rm`.
- **A probe that needs a Unix SOCKET runs inside the container.** Bind-mounting a `postgres` socket
  dir out of Docker Desktop's VM gives `ECONNREFUSED` on macOS (and a scratchpad path blows the
  104-byte `sun_path` first). `apk add nodejs npm && npm i pg` in the container; parsing-only probes
  are fine on the host.
- **A test that shells out to `git` must clear `GIT_DIR` and its family** (`GIT_WORK_TREE`,
  `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`,
  `GIT_NAMESPACE`). Git exports `GIT_DIR` to every hook, so a `mkdtemp` fixture that is isolated by
  hand writes into the real repo under `.husky/pre-push`: seven fixture commits pushed three times,
  `user.name` rewritten in the shared config, and `core.bare = true` set on the main checkout (`git worktree list` shows `(bare)`;
  `git config --unset core.bare` restores it). Run such a suite once
  under `GIT_DIR` before trusting it.
- **Don't own a database in a suite — let a helper own it.** `usePgliteDb` / `useRealPostgres`
  (`@waitron/db/testing/lifecycle.js`) register their own hooks and return an accessor that throws
  before setup. Raw `beforeAll`/`afterAll` only when the suite legitimately builds its own resource,
  and then guarded (`if (db !== undefined) await db.close()`) — enforced by
  `scripts/guarded-teardowns.test.ts`, whose header records why an ESLint rule was rejected. Suites
  sharing a database clean up in a `finally`, order-independent.
- **A guard that reads the whole tree belongs in the ROOT Vitest project** (`scripts/`), run by
  ci.yml's ungated `lint` job and by the hook on every non-docs push — a package-resident guard only
  runs when its package is in scope, and most pushes never reach `packages/db`. Two costs of living
  there: the root project does not typecheck (§2), and a module tested only from there must be in the
  root `coverage.include` and excluded from its package's.
- **Prove a guard by deletion**, and confirm a negative control fails for the reason you think.
- **Vitest's default coverage excludes swallow every dot-prefixed path** (`**/[.]**`), and
  `include`/`exclude` replace rather than merge. The root config's first version measured
  `All files | 0 | 0 | 0 | 0`, wrote `"Unknown"` percentages and **exited 0** with the thresholds
  intact. Whenever `include` points inside a dot-directory, read the per-file table, not the exit
  code. (The root config now carries no `exclude`; nothing it measures is dot-prefixed.)
- **`errors.ts` reachability is guarded once, in `scripts/errors-reachable.test.ts`**, which
  discovers every `packages/*` shipping `src/index.ts` + `src/errors.ts` and text-walks the import
  graph from the barrel. The thirteen hand-copied per-package versions were deleted on 2026-08-11:
  six of them (the "construct an `AppError`" shape) passed with `errors.ts` fully unreachable. It
  reads text, so a `from "./errors.js"` inside a comment fakes an edge — stated in its header;
  comment-stripping was rejected because a block stripper mis-parses a `/*` inside a string.
- **`toMatchObject` checks only the keys you list.** A key you never list is never checked at all;
  `toEqual` is what put `memberOf` under a matcher for the first time. What it hid: `pg_roles.rolname`
  is `name`, so `array(select rolname …)` is `name[]`, which `node-postgres` hands back as the wire
  literal `"{app_user}"` through a field typed `string[]` — hence the `::text[]` casts in
  `instance-state.ts`. Work such a failure out case by case: `"{app_user_probe}".includes("app_user")`
  is the one shape where string and array disagree, a false positive that SKIPS a needed grant.

Adding a new real-PG test package: the shared-container pattern and its knobs (`useTemplateDb`,
`cloneTemplate`, `singleFork` vs `maxForks`, template-key naming) are in `docs/backlog.md` →
_Reference_.

---

## 5. Fiscal invariants — the unrecoverable ones

- **One database per environment.** A pre-production database is never promoted:
  `invoice_series.next_number` carries across and pre-production sales would leave a permanent hole
  in the production series — which is what Veri\*Factu detects. `WAITRON_ENV` governs this; unset
  means `preproduction`, `production` must be typed out, and `dev` is preproduction plus
  `config.devMode`.
- **Nothing EXTERNAL may block a sale.** AEAT, the card network and the internet are never on the
  sale path: records chain locally and the outbox drains later; a card falls back to 4G, a standalone
  terminal or cash. What a till DOES need is the on-site SIF node, because producing the chained
  record is part of the sale (server-as-SIF, `2026-08-01-local-server-sif-and-failover-design.md` §2;
  the node-id rekey #54 made it the schema's shape). The failover work exists to keep "the SIF is
  reachable" true through a box death. Fiscal submission is an outbox, never inline.
- **`registros_facturacion` is immutable**: `REVOKE ALL`, an append-only trigger, and a
  TRUNCATE-blocking trigger. Do not work around them; a value written wrong there stays wrong.
- **Never put our own metadata into a hash.** `entorno` is ours, not AEAT's; a test pins that two
  records differing only in it hash identically. In `computeHuella` it would make every chain
  unverifiable under the other environment.
- **Re-registering a node starts a new chain** and mints a fresh installation number. Correct for a
  reimaged box, destructive for a working one.

---

## 6. Workflow

**Branches and merging:**

- **Never commit directly to `main`.** Feature work happens in a worktree
  (`python3 ~/workspace/tools/worktree.py new waitron <branch>` — not a plain `git worktree add`,
  which `/land-branch` cannot tear down). Name the branch right at creation; renaming it afterwards
  desynchronises the worktree directory from the name both commands derive.
- **A `docs/`-only change is exempt from the PR ceremony** (owner decision 2026-08-02): plain
  `git worktree add`, `commit -s`, fast-forward `main`, push direct — no PR, no CI wait, no Copilot.
  Measured: eslint lints 0 files under `docs/`, `prettier --file-info docs/backlog.md` is
  `ignored: true`, and CI classifies it documentation-only. A ROOT `CLAUDE.md` or `README.md` is
  format-checked (`ignored: false`) and takes the normal flow.
- **Every commit needs `git commit -s`**; CI's `dco` job walks the whole PR range. So a PR that goes
  `BEHIND` is cleared with a local rebase in the worktree (fetch, `git rebase origin/main`,
  `git push --force-with-lease`), **never `gh pr update-branch`**, whose merge commit carries no sign-off and
  fails DCO (#160).
- **Do not merge a PR automatically — wait for the user's approval.** Invoking `/land-branch` is that
  approval; nothing else is.
- **Merging requires resolved conversations** (`mergeStateStatus: BLOCKED` with green checks). Read
  them first — Copilot's single comment has repeatedly been the only real finding no other layer
  caught, usually by checking sibling files. Resolve via the GraphQL `resolveReviewThread` mutation
  with the id passed as a variable. Verify CI runs belong to the current head SHA
  (`gh run list --json databaseId,headSha`).
- **After merging, delete the feature branch, local and remote, and verify the remote one is gone**
  (`git ls-remote --exit-code --heads origin <branch>` must fail) — it has repeatedly survived.
- **An untracked file in the main checkout can block the post-merge `git pull --ff-only`.** Diff
  before deleting; the scratch copy was 113 lines behind what landed.

**Model selection (trial from 2026-09-05, owner decision after the whole-project review):** the rule
itself — Fable 5.1 main session and reviewer seats, `opus` implementers and `/simplify` lenses, skip
subagent-driven-development's final whole-branch reviewer because `/finish-branch` step 2 is that
pass — lives in the global `~/.claude/CLAUDE.md` so every repo shares it. What is waitron-specific is
the yardstick: the till-reroute slice against the previous five PRs on fix rounds before land,
Copilot findings no internal layer caught, and false claims found at whole-branch review. If none of
the three drops, move Fable back to reviewer-only seats (`model: "fable"` from an Opus session) and
retire the trial.

**Before a PR**, run the §2 gate yourself rather than relying on the hook, then `/finish-branch`.
Both the hook and CI narrow to changed packages; the unfiltered `main` merge is the only run that
covers the rest.

**Docs:**

- **`docs/backlog.md` answers "what should I work on?"** — what is in flight, what is next, and why
  in that order. Read it before starting anything unprompted, and **update it in the same change
  that makes it stale**. The moment it goes stale most reliably is a MERGE, so `/land-branch` carries
  an explicit step for it (the rule alone was violated within a cycle of being written). The legal
  track is separate, in `docs/compliance/action-plan.md`.
- Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/` — **committed,
  deliberately**, because a plan doubles as an operator's runbook here. Session handoffs in
  `docs/handoffs/` are **gitignored**: write one, leave it uncommitted, delete it when the work is
  done; never open a PR for one. Anything durable in a handoff belongs here (§7) or in the backlog.
- Historical docs record what was true when written. Add a dated pointer rather than rewriting them.

**The main checkout goes stale in a way the worktrees do not** — `worktree.py new` installs
dependencies per worktree and nothing installs here, so `tsc: command not found` can surface on a
push that carried no TypeScript. `/land-branch` runs `pnpm install` right after `git pull --ff-only`;
run it yourself after any other pull. The hook skips a push that only deletes refs (all-zero local
sha) and fails closed when stdin is empty.

---

## 7. Keep this file current — it is part of the work, not a chore

Every rule above was paid for by a defect, a wasted round trip, or a review finding. When you pay
that price again, the lesson goes here in the same change that fixes it.

**Add an entry when:** a review finds a defect whose _shape_ could recur; a trap costs real time
(a gate that differs locally from CI, a command that fails in this shell); you discover a convention
by grepping rather than reading; a decision gets made that a future session would otherwise
relitigate.

**Do not add:** one-off bugs with no reusable shape, anything the code or types already state
plainly, or the narrative of what a session did — that belongs in the commit or the PR thread. An
entry is the rule, one line on what it cost, and a pointer; **a count is a receipt that goes stale**
(three "fifteen members" and one "sixteen packages" survived here for weeks), so describe the
property, not the number.

**Prune as well as append.** A superseded rule teaches a session to work around something that no
longer exists; delete it and say so in the commit. Natural moments: while addressing review findings,
and when writing a handoff — anything phrased "next time, remember to…" belongs here instead. A
written rule with standing violations needs a guard, not another paragraph.

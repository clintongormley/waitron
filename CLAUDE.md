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
  PR (`/finish-branch` step 2's convention reviewer does it). The PATH SET matters: SP-3b's receipt
  sweep grepped `packages/` and `apps/` and could not see
  `.github/instructions/waitron.instructions.md` — the prose Copilot reviews every PR against —
  which kept describing a deleted exclusion list; a base-to-tip pass reads that file and every claim
  stated in prose without the identifier.
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

That is the shallow, whole-workspace check. Root `test` / `test:coverage` and the pre-push
coverage phase cap package concurrency at two and enforce a 20-minute process deadline
(`scripts/run-with-deadline.mjs`). CI test jobs have a 15-minute job deadline; each light bin
also caps package concurrency at two. Direct package commands retain their Vitest timers.

The pre-push hook (`.husky/pre-push`) is deeper but
narrower: `pnpm reap`, `pnpm install --frozen-lockfile`, `format:check`, then `typecheck` and
`test:coverage` over the CHANGED packages and their dependents (resolved by
`scripts/changed-packages.mjs`, the same script CI's `changes` job uses). A push that touches only
the repository's own machinery — `scripts/`, `.husky/`, `.github/`, which no workspace member reads
— is `scope=root`: lint, format:check and the repo-level Vitest project, no package typecheck or
tests. CI adds mutation testing and `bundle-smoke`, which nothing local runs. A green from any one
of the three is evidence about what it ran.

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
  dedicated `test-bookings` and `test-sync` jobs, the browser shards (`test-ui`, `test-till`,
  `test-dashboard`, `test-setup`) and `test-light-a` /
  `test-light-b` for everything else (bins in `scripts/changed-scope.mjs`). Vitest `--shard` splits
  by FILE COUNT, so shard imbalance is the real limit, and `N` must never exceed a package's test-file
  count.
- **CI does not run every check on every push.** The `changes` job skips the expensive `code`-gated
  jobs when every changed path is inert — documentation, or root config no `code`-gated job reads
  (`.codex/`, `.vscode/`, the root `.gitignore`, the root `.editorconfig`) — or is the repository's
  own machinery (`scope=root`: `scripts/`, `.husky/`, `.github/`), and on a pull request narrows the
  shards and mutation jobs to the changed packages and their dependents. `lint` is ungated and runs
  on every push — eslint, `format:check` AND the repo-level Vitest project, which is the suite that
  does read the machinery — so a regression in a skipped path is still caught there. A merge to
  `main` runs the unfiltered suite whenever anything outside those two sets changed; that run
  verifies the narrowing, and a root-only or docs-only merge does not get one. Read the `changes`
  job's `code`, `scope` and `packages` outputs before treating a green PR as evidence about the
  workspace. Design: `docs/superpowers/specs/2026-07-31-scoped-ci-design.md`.
- **A cheap job can still be the critical path.** `mutation-verifactu` was ungated because a mutant
  is cheap; on run 30650089655 it was 3m26s of a 4m8s run. Sort a run's jobs by duration before
  calling a job cheap enough to leave ungated.
- **The GHA cache is a shared per-repository budget and this repo sits AT it**, so a new
  `cache-to: type=gha,mode=max` exporter does not merely cost its own bytes — it competes for space
  against every other job's entries, and GitHub reclaims by evicting the least recently used.
  Docker layers are what fill it here: measured 2026-09-12, the total was at GitHub's 10 GB limit
  and image blobs were roughly nine tenths of it, leaving the Playwright browser download and the
  pnpm store caches that the test jobs restore to share the remainder. That is the second reason
  `publish` dropped arm64 (`linux/amd64` alone, ci.yml): an emulated second platform's `mode=max`
  export put a second set of image layers in on every merge to `main`. The total is
  `gh api repos/:owner/:repo/actions/cache/usage`, but it answers only "how full" — for WHICH
  entries a new export competes with, list them with sizes and last-access times
  (`gh api "repos/:owner/:repo/actions/caches?per_page=100" --paginate`, or `gh cache list`) and
  name them before adding the export.
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
- **The four browser packages run vitest in real headless Chromium.** Browser-mode gates may run
  concurrently; what is not allowed is adding one beside OTHER SESSIONS' browser runs or beside a
  backgrounded whole-workspace `pnpm -r test:coverage` — check what else is testing on the machine
  first. The receipt is two 65 GB RAM spikes and a force-quit on 2026-08-30, with several sessions
  testing at once; one session running its own package gates in parallel was never the problem
  (owner decision 2026-09-06, retiring "one gate at a time"). Concurrency is decided by measured
  headroom, never by a count: before a heavy run check free memory (`memory_pressure | grep free`)
  and the heaviest processes (`ps -axo rss,command | sort -nr | head`), then scale
  `--workspace-concurrency` to what is free. Receipt: 77% of 64 GB free tonight with two review
  sessions, four vitest workers and two Chromiums running. **Chromium's launch depends on the
  Codex seat's PERMISSIONS, not on Codex.** Sandboxed, it cannot start
  (`bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer: Permission denied (1100)`,
  measured 2026-09-06); with approved host execution, a direct Codex driver can run browser tests.
  Receipt: on 2026-09-12,
  `pnpm --filter @waitron/dashboard test src/screens/payments-screen.test.ts` passed in Chromium.
  Check host execution before deferring browser testing to another agent.
- **Only the `core` migration set has an upgrade test; every module set is still migrated from a
  VIRGIN database only, so a green gate is no evidence that a module set can upgrade a box.** Drizzle
  applies a set's PENDING migrations in one transaction, and PostgreSQL refuses to name a label added
  by `ALTER TYPE … ADD VALUE` in that same transaction unless the type was created there too — a
  virgin database, which creates the type in that batch, is the one shape where it is legal. Cost: a
  bricked box, an hour of guesswork, and a wipe that destroyed the evidence. The static guard covers
  every set (`scripts/enum-add-value-safety.test.ts`); the upgrade regression that migrates real
  databases from each release point covers `core` alone
  (`packages/db/src/migrate-upgrade.pg.test.ts`).

Bypassing the hook with `--no-verify` is for emergencies; the failure still has to be fixed because
CI runs the same checks. A hook failure the PR does not reproduce is a check CI has deferred to the
unfiltered `main` run, not a wrong hook.

---

## 3. Conventions reviewers enforce

- **New or changed forms use the shared UI contract in `docs/developers/design-system.md` → Forms.** Required fields
  are visibly marked; an attempted invalid submission shows explanatory text beside every bad field
  and one localized “problem with this form” summary. Every input has a semantic `name` (plus the
  standard `autocomplete` purpose when one exists), never a generated widget id as its identity.
  Password reveal buttons use the input's `end` slot and an action-specific accessible label.
  An inline confirmation suspends the enclosing form's Save and implicit Enter submission until
  resolved. The user-admin review reproduced Enter saving details behind a pending login-reset
  confirmation (`apps/dashboard/src/widgets/person-edit.test.ts`, “suspends detail submission…”).
  `wt-form-actions` keeps the primary action bottom-right and Cancel/Back bottom-left. Optional field
  explanations use `wt-help-tooltip`, whose button closes on outside click or Escape. Cost: the
  dashboard login exposed `wt-input-N` to password safes and disabled incomplete forms without saying
  what was missing (`ui-login`, owner review 2026-09-09).
- **A replay reports the original transaction facts; side effects are gated separately.** Cash change
  was returned as zero on a retry because the receipt reader treated displaying change as dispensing
  it. Persist the tendered cash and reconstruct the same ticket; keep drawer opening on the fresh
  settlement path. Regression: `apps/server/src/till-api.receipt.test.ts`, “replays and reprints the
  original cash handed over and change”.
- **A successful write followed by a failed refresh is a load failure, not a failed save.** Close
  the editor after the write succeeds, then refresh the list separately; retaining a create form with
  a save error invites a duplicate submission. The Venue operations regression resolves creation,
  rejects the following load and checks the closed modal plus load error
  (`packages/venue-service/src/dashboard/venue-operations-screen.test.ts`, “refreshing the list fails”).
- **Automatic dashboard reads are passive session activity.** Use the shared query controller or
  the request primitive's `passive` option for event refreshes and timers. A normal GET touches the
  management session, so polling it would keep an unattended dashboard signed in. Observer callbacks
  assign snapshots; they do not rerun loaders that reset drafts or mint recovery keys. See
  `docs/developers/dashboard-live-updates.md` and the passive-session and backup-screen regressions.
- **A background API client does not make POST requests passive.** The request primitive marks only
  GETs as passive. Automatic pairing renewal uses an explicit authenticated route that resolves the
  session without touching its activity time. Cost: renewing the Add print agent dialog through the
  ordinary Open route moved session expiry forward by ten minutes in the regression; the renewal
  route leaves it unchanged and still refuses expired sessions (`apps/server/src/join-api.pg.test.ts`,
  “renews the window without extending the session”).
- **Dashboard subscription names travel with their server sources.** Core and contributed screens
  export `QUERY_DEPENDENCIES`; `scripts/live-subscriptions.test.ts` checks those names against shipped
  resources. A rejected subscription closes the whole tab's stream, so a misspelled name affects
  other screens too. The guard catches unknown names, not missing SQL dependencies or disabled-module
  combinations. Cost: the live-updates run-it review found this unguarded coupling.
- **The dashboard banner is persistent identity chrome.** Put it at the very top of the page at full
  width, with the menu and content underneath. Show the canonical Waitron lockup and the deployment
  tenant's legal name on login and every authenticated screen. Put Logout at the trailing edge only
  when a session exists. Use the tenant name, not a location: a deployment database has one tenant
  and that tenant can contain several locations (`packages/db/src/schema/tenants.ts`).
- **Dashboard sign-in matches the browser's `Accept-Language` preferences.** The public locale
  response carries a separate `loginDefault`; `venueDefault` still describes the venue and remains
  the fallback for signed-in people without a saved language. Returning to login after logout or
  session expiry uses the last browser match, or the venue default until that match is available.
  Guard late locale responses so they cannot overwrite a newly authenticated person's language
  or an explicit choice on sign-in (`apps/dashboard/src/dashboard-app.test.ts`).
- **Dashboard login offers methods without revealing account enrolment.** Offer passive browser
  passkey autofill on email entry, then open the password form after Continue unless an opted-in
  local preference selects another method. A modal passkey prompt requires an explicit action;
  navigation, refresh, logout and session expiry never open one. Do not query account status or
  passkey enrolment to choose the public screen. Save the authenticated email and successful method
  only with Remember selected, never in tab storage. The change-account icon clears the saved
  shortcut and current attempt. Recovery uses one public entry for pending-account setup and
  active-account reset, with the same acknowledgement for every address. Owner decision:
  `docs/superpowers/specs/2026-09-11-login-flow-refinements-design.md`.
- **Error codes name the DOMAIN CONCEPT, never the throwing package** — `series.not_found`, not
  `db.series_not_found` (design note atop `packages/shared/src/errors.ts`). Codes are **never renamed
  once shipped**; deprecate and add a sibling. `server.*` is reserved for facts about the process
  itself (`apps/server/src/errors.ts`). Every file that throws a code imports its registry
  (`import "./errors.js"`); reachability is guarded once, in the root project (§4).
- **Spanish domain terms are deliberate, and a module declares its own.** The guard
  (`packages/db/src/english-only.ts`; suite `scripts/english-only.test.ts`, root project) forbids,
  in every generic package, a base list of generic Spanish plus every module's declared
  `vocabulary` seat; an owner's own package (derived from `migrations.from`) is never scanned. One
  declaring home per word: a fiscal term goes in `FISCAL_VOCABULARY` (`packages/fiscal-verifactu`),
  a labour term in `WORKFORCE_ES_VOCABULARY` (`packages/workforce-es`), never the base list — the
  suite fails on a clash. `packages/verifactu` is an unlisted library (in no list, never scanned);
  `apps/*` is out of scope by a recorded decision, so Spanish IDENTIFIERS in app UI code are caught
  only by review. Design: `docs/superpowers/specs/2026-09-05-module-sp3b-vocabulary-design.md`.
- **The composition list lives in `@waitron/composition`, and it is the only place that names every
  module.** Generic provisioning code imports neither that list nor a REGIME package
  (`@waitron/fiscal-verifactu`, `@waitron/verifactu`) — `packages/provisioning/src/bin.ts`
  excepted, it is the CLI's composition root — and no file under `apps/server/src` imports a
  regime package outside the allowlisted runtime pass. The regime is reached through the
  descriptor's `provisioning` and `fiscal` seats. The boundary is the swappable SLOT, not "any
  module": provisioning's `@waitron/identity` and `@waitron/layouts` imports are legitimate.
  `scripts/module-seams.test.ts` (root project, reads text) pins it, each allowlist entry carrying
  its deferral reason — shrink that list in `fiscal-none`, never grow it. A module's per-node seed
  runs INSIDE `applyVenue`'s one transaction: a seed that throws rolls the venue back. Cost of the
  old shape: the generic venue runner, the node runner, the standby reservation and establishment,
  and the till's backend construction imported the Spanish regime directly, and `fiscal-none` could
  not land. Design: `docs/superpowers/specs/2026-09-05-module-sp3c-gated-provisioning-design.md`.
  On the browser side `@waitron/dashboard-modules` is the composition list's twin — the one place that
  names every UI-bearing module (guarded by `module-seams` + `dashboard-browser-purity`), so
  `apps/dashboard` mounts modules without naming one, exactly as generic provisioning does not.
- **A retained hardware registration must remain re-addable after deactivation.** Discovery matches
  disabled records as well as active ones; the dashboard offers disabled matches as Add again and
  reactivates their existing id, preserving history and routing. Only active matches disappear from
  the add list. Cost: deleting a USB printer left it in the registered table and hid it from discovery,
  blocking re-add. The table now defaults to Active with Disabled/All filters. Pointer:
  `docs/superpowers/specs/2026-09-11-printer-followups.md`.
- **The hardware transport seam is `@waitron/print-agent`, and it is database-free.** It becomes a
  standalone LAN process that reaches a server over HTTP only, so it imports no other package in this
  repo; `@waitron/printing` depends on IT, never the reverse. An empty `dependencies` block is not the
  guard — `main` points at TS source with no build step, so `../../db/src/index.js` resolves and runs
  while the manifest still reads dependency-free (measured: with the zone removed that import lints
  clean). The guard is the `import-x/no-restricted-paths` zone in `eslint.config.js`, alongside
  `packages/verifactu`'s and `packages/shared`'s. Design:
  `docs/superpowers/specs/2026-09-08-print-agent-process-design.md` §2.1.
- **A container that must reach a hot-plugged USB printer mounts `/dev:/dev:ro`, not `/dev/usb`.** A
  `/dev/usb` subdirectory bind goes stale when the printer is re-plugged (the node vanishes and does
  not return); a hard `devices: /dev/usb/lp0` line refuses to start when no printer is attached. The
  shape that survives both — measured on the real box 2026-09-10 — is the whole `/dev` mounted
  read-only plus `device_cgroup_rules: ["c 180:* rwm"]` (the usblp major) and `group_add: ["7"]` (the
  `lp` group's write bit); `:ro` still permits writing an existing device node but refuses `mknod`.
  The cgroup rule ADDS major 180 to Docker's default device whitelist (null, zero, full, random,
  tty, …); a class that is neither a Docker default nor 180 (e.g. hidraw) is what gets denied. Pinned
  by `scripts/deploy-image-env.test.ts`; spec
  `docs/superpowers/specs/2026-09-10-print-agent-box-wiring-design.md` §5.
- **A command name is declared under `waitron.commands`, never `bin`.** pnpm links a `bin` while it
  INSTALLS and skips one whose target is missing, and nothing here builds at install time, so a
  `bin` under `dist/` is never linked by the install that reads it. Every CLI is run by path anyway
  (`node /app/bin-restore.js` in the image). Cost: repeated `Failed to create bin` warnings on every
  install, in every worktree and in the image build, plus an AEAT runbook whose
  `pnpm --filter … exec waitron-credentials` steps could never have run; the measurements are in that
  runbook's dated note (`docs/superpowers/plans/2026-07-28-first-aeat-submission.md`, Task 3).
  Guards: `scripts/manifest-commands.test.ts` (a declared `bin` target must be tracked by git; a
  `waitron.commands` target must appear as an `--outfile=` in its own package's `build` script, which
  is a text match) and `scripts/deploy-image-env.test.ts` (the image ships every name the server
  declares).
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
- **A new table is classified `ledger`, `state` or `local` (swap design §2.1) in its module's
  `<MODULE>_CLASSIFICATION` list via `classify()` (`@waitron/sync-enrolment`), and an append-only
  table's `reject_mutation()` triggers are `ENABLE ALWAYS`** — the replication apply worker skips
  ordinary triggers, and a copy of a corrupted row is exactly what those triggers exist to refuse.
  No policies, no `ROW LEVEL SECURITY`: one tenant per database (owner decision 2026-09-05). Two root
  guards enforce this on every non-docs push: `scripts/classification-complete.test.ts` (every table
  in every module's `drizzle/` is classified exactly once) and
  `scripts/append-only-enable-always.test.ts` (every `reject_mutation` trigger is `ENABLE ALWAYS`);
  `packages/fiscal-verifactu`'s `inmutabilidad` suite still scans the triggers themselves. Run them
  after adding any table anywhere.
- **The two publications a node holds are created by the table OWNER, and the replication role is a
  bootstrap the app provisioner only verifies.** `waitron_migrator` creates `waitron_<env>_ledger` /
  `_state` from the module classification (`@waitron/sync`). A SUPERUSER/box-image bootstrap holds
  the rest, each on its own role SHAPE: `waitron_repl` is a `LOGIN REPLICATION` role; the migrator
  (`waitron_migrator`) is granted `pg_create_subscription`; and `wal_level=logical` /
  `track_commit_timestamp=on` are restart-required CLUSTER settings held by no role (the box image's
  `postgresql.conf`). The app performs none of it — `assertReplicationReady`
  (`provisioning.replication_not_ready`) verifies it instead. A subscription's connection string
  carries the `waitron_repl` password, so its statement is never logged and a failure throws only a
  SQLSTATE (`sync.subscription_failed`), like `CREATE ROLE`; `sqlStateOf` lives in `@waitron/shared`.
  Pointer: `docs/superpowers/specs/2026-09-05-outbox-to-native-replication-swap-design.md` §2.2/§3.
- **`waitron-provision instance` migrates AS the migrator, via a `role=` session option, never as a
  plain admin.** The migrator (`waitron_migrator`) OWNS the instance's database, and native
  replication's `CREATE PUBLICATION … FOR TABLE` is owner-only, so every table must be migrator-owned:
  a plain admin connection to a migrator-owned database cannot even `CREATE TABLE` in `public` (probe
  A — `permission denied for schema public`). Any new provisioning path that creates schema carries
  `withRole(uri, waitron_migrator)` (`@waitron/provisioning`); `apps/server/scripts/dev-setup.ts` does
  the same on the shared dev `postgres` database, granting the migrator the CREATE privileges db
  ownership would otherwise confer. Receipt: `feat/outbox-swap-s4-s5`, probe A.
- **A module/migration dependency graph has TWO kinds of cross-set edge**: FK `REFERENCES` and a
  `CREATE [CONSTRAINT] TRIGGER … EXECUTE FUNCTION <f>` where `<f>` is owned by a DIFFERENT migration
  set. Today NO module creates such a cross-set trigger — the outbox's capture triggers, which
  enrolled other modules' tables, were deleted with the application outbox (swap S5) — so every
  surviving migration cross-set edge is an ordinary FK. The generic live-update trigger is installed
  at boot and sits outside this migration-text guard; its behavior is exercised by
  `packages/db/src/change-feed-replication.pg.test.ts`. `scripts/module-graph-honesty.test.ts` still derives the
  trigger edge (reads text and says so), so a future one is caught.
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
- **A by-id read still needs its own `eq(table.tenantId, cfg.tenantId)` — one-tenant-per-database is
  NOT the query's isolation boundary.** Since RLS was dropped (#255) `withTenant` no longer isolates
  SELECTs, so every read scopes to the tenant itself — a by-id read as much as a list read, never
  trusting a globally-unique UUID or the deployment invariant. Cost: `getHeldOrder`/`abandonHeldOrder`
  keyed on the `working_orders.id` UUID alone, so tenant A could read AND abandon tenant B's order in a
  multi-tenant DB (till-reroute S3). The per-task review and four quality lenses all reasoned it "safe
  under one-tenant-per-db"; only the run-it seat, which RAN a two-tenant probe as `app_user`
  (rolsuper=f), caught it — reading missed it, running caught it (§1, §4).
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
  `pnpm --filter @waitron/db db:generate --name <foo>` (and `db:generate:custom --name <foo>_sql`,
  pasting back the triggers and grants you saved first), stage only your migrations,
  `rebase --continue`, and verify by RUNNING the package's grant assertions and `privileges.test.ts`
  plus `inmutabilidad`. Works because the snapshot chain deliberately lags the DB (custom migrations
  are snapshot-less). Paid for on #165.
- **Drizzle picks what to apply from `max(created_at)` alone**, never from a position in the journal
  file, so an entry whose `when` sits AT OR BELOW one the database already recorded never runs, and
  DRIZZLE raises nothing — it applies part of a set and returns cleanly
  (`drizzle-orm@0.45.2/pg-core/dialect.js:57` reads the watermark; `:62` applies only where
  `recorded < candidate`, so an EQUAL value is skipped too). **Waitron no longer exits 0 on that**:
  `applyMigrations` counts the journal afterwards and throws `migrations.incomplete` (next entry).
  The two error registries this branch touched — `packages/migrations/src/errors.ts` and
  `packages/provisioning/src/errors.ts` — point here instead of repeating the `dialect.js` citation.
  That is where the pointer stops: the citation is still restated under `packages/`, `scripts/`,
  `docs/` and `packages/provisioning/README.md`, and nothing enforces the pointer, so a drizzle bump
  starts with `grep -rn 'dialect.js'` and fixes every copy by hand. The core journal is already in
  that shape, and no edit repairs it: a database at release point 2 and one at release point 3 both
  carry entry 1's `when` as their watermark, because entry 2's RECORDED value sits below it — so
  point 2 needs entry 2's `when` ABOVE that watermark or `0002` is skipped, while point 3 needs it
  AT OR BELOW or `0002` re-applies. Contradictory for any single value. Cost: a database at core release points 1–6 cannot
  reach HEAD at all — since `migrations.incomplete` the attempt fails LOUDLY rather than serving a
  half-migrated schema, but it still fails; found only while investigating the 2026-09-10 bricked box.
  Guard: `scripts/journal-monotonic.test.ts`.
- **`applyMigrations` refuses to report success on a short set.** It compares the journal rows a set
  recorded against the entries the image ships and throws `migrations.incomplete` when fewer applied,
  so a boot against an old release point fails loudly instead of serving a half-migrated schema. Cost:
  a database at the core set's entry 1 reached HEAD with 10 of 15 applied and no error, and the wrong
  schema surfaced later as an unclassified driver failure. Pointer:
  `packages/migrations/src/apply-complete.pg.test.ts`.
- **The box's BOOT path carries an ahead-of-image check; no other migrating path does, and
  `waitron.sh install <ref>` is a one-way door.** `assertNotAhead` (`@waitron/provisioning`) compares
  the database's journal hashes against the image's files and throws `provisioning.database_ahead`;
  there is no backward migration, so installing an older ref after a newer one has already migrated
  the database can fail to boot with this error. `waitron.sh`'s advice on that failure depends on the
  box: on one that is not stamped production, `waitron.sh reset` wipes the database and is the clean
  way back to a working box; on a production box the script refuses to suggest that (a reset there
  would destroy the fiscal chain) and says to install a newer ref instead
  (`docs/superpowers/specs/2026-09-11-waitron-sh-box-command-design.md` §3 step 6, §4.1). Its only caller anywhere is
  `apps/server/src/node-entry.ts`, which runs it after `ensureInstance` and before `startServer`
  (`grep -rn assertNotAhead` before believing otherwise). The GAP, stated so nobody assumes coverage:
  `waitron-provision instance` (`packages/provisioning/src/instance-apply.ts`), the cold restore
  (`apps/server/src/restore.ts`), `apps/server/src/rejoin-command.ts` and
  `apps/server/scripts/dev-setup.ts` each call `applyMigrations` against a live database with no
  ahead check, so an ahead database reached through any of them is still undetected. Cost: without
  the check, an ahead database re-migrates CLEANLY — drizzle applies nothing and throws nothing
  (measured with a control, 2026-09-10) — so the mismatch showed up only as an unclassified driver
  error in whatever query first touched the changed schema. Pointer:
  `docs/superpowers/specs/2026-09-10-boot-failure-diagnosability-design.md` §4.2/§4.5/§9.
- **The unauthenticated recovery page renders fixed strings chosen by code, never the caught error's
  words.** The error's own text goes to the container's stdout only, through `redactSecrets` — the
  installer's channel. Exactly two values on the page come from outside the image: the error CODE and
  the LOG TAIL, and the tail is the wider one, because the shared error boundary writes an
  `AppError`'s params into `waitron.log`. So the convention that params never carry a secret (stated
  per-code in `apps/server/src/errors.ts`) is what keeps a page anyone on the venue's LAN can open
  safe. A page edit that interpolated a caught message, or a new code carrying a credential in its
  params, breaks a security boundary nothing outside the design states. Pointer: same design, §5;
  `apps/server/src/recovery-surface.ts`.
- **A new product domain lands as a MODULE, not as new code in the core.** A domain is a package that
  fills the contract seats (schema, sync, provisioning, fiscal, vocabulary…) and is named only by
  `@waitron/composition`; generic code never learns it exists. Cost of the other shape: a whole regime
  wired straight into `apps/server`, the till backend and the venue runners, so `fiscal-none` could
  not be added until SP-3 pulled it back behind the slot — after which the no-op regime was a package
  with an empty runtime duty and `apps/server` imported no regime at all (`fiscal-none`, this branch;
  design `docs/superpowers/specs/2026-09-06-module-fiscal-none-design.md`, SP-3).
- **A country pack is a browser-safe preset over modules, not a module.** Generic contracts live in
  `@waitron/country`; each country owns its validation and geography in a separate package; and
  `@waitron/country-packs` is the only package that names every installed country implementation.
  Packs name module and fiscal contribution ids as strings and never carry an external-provider
  credential. Setup derives geography-dependent values in the browser and repeats the derivation at
  the server boundary. Guarded by `scripts/module-seams.test.ts`; design:
  `docs/superpowers/specs/2026-09-09-country-packs-and-address-entry-design.md`.
- **No new table enters the core migration set without a stated reason in the commit.** A
  `tenant_id`-bearing domain table belongs to its module's own migration set (`migrations.from`), where
  its grants travel with it; a core-set addition is a deliberate exception and says why it is
  not a module's. Same defect class as §1's unstated claims — an unexplained core table is a boundary
  decision no future reader can audit.

---

## 4. Testing

- **Test provider HTTP refusals through the real client, as well as a throwing fake seat.** The
  SumUp unpair route's fake proved that a thrown error preserved the local reader, but the HTTP
  client silently accepted 401/403/409. The reader-deletion regressions now reject those responses
  and separately retain the already-absent 404 retry (`packages/payments-sumup/src/sumup-client.test.ts`).
- **Source scanners check filesystem type as well as the filename suffix.** Vitest stores failure
  screenshots in directories named `*.test.ts`; treating those directories as TypeScript files made
  the vocabulary guard throw `EISDIR` after browser failures. Keep real nested source files in scope;
  regression: `scripts/english-only.test.ts`, “scans real TypeScript files…”.
- **Browser passkey tests stub `navigator.credentials`, keeping the WebAuthn library real.**
  Preloading that library before the old module mocks reproduces `startRegistration is not a spy`
  and `mockClear is not a function`; the credential stubs pass with the same preload. Do not rely
  on a module mock replacing an already-loaded browser ES module. Evidence and limits:
  `docs/superpowers/specs/2026-09-10-ci-test-failures.md`.
- **A container port-binding timeout needs Docker state as well as database logs.** Save
  `docker inspect`'s `HostConfig.PortBindings` and `NetworkSettings.Ports` before removing the failed
  test fixture. The reader-adoption gate found a healthy PostgreSQL container with a requested TCP
  binding but an empty published-port list; a focused rerun passed without explaining the first
  failure. Receipt: `docs/superpowers/plans/2026-09-12-card-reader-adoption-and-status.md`.
- **Reuse a supplied test container before probing Docker again.** A failing `docker info` command
  is not evidence that a container global setup already started is absent. Run 34507423350 failed
  `deployment.test.ts` at this redundant check; `harness.docker.test.ts` injects a CLI timeout to
  verify the shared-container path and retains the required-Docker failure without either signal.
- **Two targets.** **PGlite** (`createPgliteDb` + `runMigrations`) is hermetic and fast, but every
  connection is a superuser (grants are not enforced; triggers still fire) and every query serialises
  onto one backend, so a contention test on PGlite is a **false pass**. **Real Postgres** via
  Testcontainers is required for anything about privileges, triggers as the deployment role, or
  concurrency; `describeEachTarget`
  (`packages/db/src/testing/harness.ts`) runs a suite against both. Pick the lighter one when the
  heavier one's justification does not apply, and say why in a comment.
- **Locate the unfinished package before diagnosing a silent shard as PostgreSQL contention.**
  Four inspected `test-light-a` hangs left only Bookings' browser files unfinished while Sync and
  every database file completed; two jobs ran for about six hours. A Vitest test timer does not
  bound a browser whose event loop has stopped. Preserve the job log and use an outer process/job
  deadline, not a retry as proof of repair. Evidence and limits:
  `docs/superpowers/specs/2026-09-09-test-load-design.md`.
- **Vitest 3's fork limit belongs on the outer config, even with projects.** Its shared pool
  reads `vitest.config.poolOptions`; per-project `singleFork` is a separate scheduling choice.
  Moving `maxForks: 4` inside fiscal-verifactu's project in #286 started 17 workers on the local
  host, observed during a Sync migration stall. `scripts/fiscal-test-budget.test.ts` pins the
  corrected location; the test-load design records the live process and database probes.
- **Networked PostgreSQL fixtures use one Docker network and unique container names for DNS.**
  Testcontainers 12's `withNetworkAliases()` also attaches the default bridge. On this Docker
  Desktop host that produced interfaces with MTUs 65535 and 1500: a 1,400-byte query passed,
  a 1,600-byte query stalled, and removing the unused bridge made queries up to 100 KB pass.
  Use `networkedPostgresContainer` (`packages/db/src/testing/postgres.ts`); its real-Docker guard
  checks one interface, name resolution and a large query. WireGuard peers use `node.networkHost`.
  Evidence: `docs/superpowers/specs/2026-09-09-test-load-design.md`.
- **`TESTCONTAINERS_RYUK_DISABLED=true` is required locally. A recurrent real-PG stall needs a
  retained log and a live database snapshot.** The #286 boot retry and cluster mutex did not
  eliminate the later migration stall; its PostgreSQL backend was waiting for client input,
  with no blocking backend. Reducing concurrency alone did not fix the dual-network defect above.
  Keep the boot bounds and the package/worker caps, but locate the stalled operation before
  assigning its cause to resource contention.
- **With Ryuk off, INTERRUPTED runs leak containers** (a clean vitest exit self-reaps via
  `globalTeardown`). The bloat (once: 173 volumes, 23 GB) starves PGlite `beforeAll`s and the
  `freePort` race, while an isolated re-run passes and proves nothing. `pnpm reap`
  (`scripts/reap-testcontainers.mjs`, also first in the hook) removes containers labelled
  `com.waitron.reapable` (stamped by `startPostgresContainer`, pinned by test) AND older than 2 h —
  so another repo's or a live watch-mode container survives — with their anon volumes. It never
  touches images and there is no blanket `docker volume prune` (it would reach other projects and
  the named dev volumes). `docker volume inspect` before any manual `rm`. Once a leaked container is
  gone its anon VOLUME is orphaned (no `com.waitron.reapable` label to find it by), so `pnpm reap`
  cannot reclaim it — a dangling-anon prune would reach the HA repos' testcontainers on this machine,
  so those stay a clean-exit-plus-manual-targeted sweep.
- **An interrupted run also ORPHANS its vitest workers**, and `pnpm reap` sweeps these too. A hard
  interrupt (an Esc, a killed parent, a timeout signal) can take the orchestrator while its tinypool
  workers reparent to launchd (ppid 1) and spin at ~100% CPU indefinitely — SIGTERM did not stop them,
  `kill -9` did (cost: four burned the fan for hours on 2026-09-07). The sweep is scoped by ppid 1 AND
  the `node (vitest N)` process TITLE (its parens), NOT a bare `vitest` word anywhere in the line —
  that broader match killed a real orphan whose argv only held a `vitest` log path (run-it review).
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
- **Browser recovery tests read the native control inside a shared component.** A host's `checked`
  property can report the expected value while its inner checkbox remains visibly wrong. The printer
  follow-up review reproduced that split by preserving the emitted change while suppressing the host
  update; the old assertion passed and the inner-input assertion failed. Pointer:
  `apps/dashboard/src/screens/printing-rules-screen.test.ts` (`switchChecked`).
- **Source scanners select files, not just paths ending in `.ts`.** A failing browser test creates
  a screenshot directory named after its test file; the vocabulary guard tried to read that directory
  and failed with `EISDIR` after an intentional TDD failure. `sourceFilesIn` now checks `isFile()`,
  with a fixture preserving an actual nested source file (`scripts/english-only.test.ts`).
- **A reopened polling dialog owns a new in-flight gate.** Reset that gate on close and guard its
  release with the request's generation as well as guarding the response. Otherwise an old read
  blocks the reopened dialog, or its `finally` releases the new read's gate. The printer review
  reproduced both shapes (`apps/dashboard/src/screens/printers-screen.test.ts`, “starts a fresh agent
  read immediately after reopening”).
- **A browser test using fake timers must advance an awaited animation frame or restore real timers
  first.** The printer modal close test stalled on its own paused `requestAnimationFrame`; asserting
  the native dialog's closed state avoids mixing that clock with the browser's queued close event
  (`apps/dashboard/src/screens/printers-screen.test.ts`, “closing Add printer…”).
- **Dispatch events when testing a `composedPath()` guard.** An undispatched `KeyboardEvent` has an
  empty path, so a missing-action test can pass at the input-type guard without reaching the branch it
  claims to check. Exercise the event from the real input and prove the target guard by deletion.
  Receipt: `packages/ui/src/submit-on-enter.test.ts` (UI keyboard review, 2026-09-06).
- **Position a native popover before its first paint.** In Chromium, positioning from the asynchronous
  `toggle` event left the row menu at `(0, 0)` for its first frame. Open it synchronously, then measure
  and position it; the first-frame regression is in `packages/ui/src/components/wt-row-actions.test.ts`; the dashboard wrapper retains its compatibility tests.
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

- **Printing never opens the cash drawer.** Cash settlement at a till enqueues a separate audited
  `drawer` job; receipt jobs are `document` jobs and contain no drawer command. Handhelds cannot
  open the drawer, even with a profile capability, and drawer jobs cannot be manually resent.
  The receipt review reproduced a resent cash receipt opening the drawer without a new audit row.
  Pointer: `docs/superpowers/specs/2026-09-12-receipts-payment-slips-and-duplicates-design.md` §3.

- **One database per environment.** A pre-production database is never promoted:
  `invoice_series.next_number` carries across and pre-production sales would leave a permanent hole
  in the production series — which is what Veri\*Factu detects. `WAITRON_ENV` governs this; unset
  means `preproduction`, `production` must be typed out, and `dev` is preproduction plus
  `config.devMode`.
- **Nothing EXTERNAL may block a sale — and a till needs the venue's PRIMARY.** AEAT, the card network
  and the internet are never on the sale path of whichever node is primary: records chain locally and
  the outbox drains later; a card falls back to 4G, a standalone terminal or cash. What a till DOES
  need is the one node accepting sales — the on-site box when the internet is down; a promoted cloud
  when the box is dead (which needs the internet); box-down AND internet-down together is no failover,
  the MVP's accepted case (`docs/backlog.md` → _MVP for go-live_). The till follows the primary and
  never chooses (`2026-09-05-till-reroute-design.md` §2); only the primary sells. Fiscal submission is
  an outbox, never inline.
- **`registros_facturacion` is immutable**: `REVOKE ALL`, an append-only trigger, and a
  TRUNCATE-blocking trigger. Do not work around them; a value written wrong there stays wrong.
- **Never put our own metadata into a hash.** `entorno` is ours, not AEAT's; a test pins that two
  records differing only in it hash identically. In `computeHuella` it would make every chain
  unverifiable under the other environment.
- **Re-registering a node starts a new chain** and mints a fresh installation number. Correct for a
  reimaged box, destructive for a working one. A cold restore (`waitron-restore`) does it
  automatically for a node that was filing: it floors the installation counter by the clock (the counter is in
  the dump, so an older artifact would otherwise re-mint a number a previous restore used), retires
  the node's invoice series and opens disjoint ones, and writes the box's identity only after that
  commits — `docs/superpowers/specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md`. UNLIKE the
  fiscal chain, the working-time chain is NOT reset on a cold restore — it continues from the backup's
  head, and a fork with a surviving copy surfaces as a loud drain stall, because the fiscal reset
  exists to mint a fresh SIF for AEAT and the working-time record has no equivalent.

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
- **Every commit needs `git commit -s`**; CI's `dco` job walks the whole PR range. **A PR that goes
  `BEHIND` is not rebased for that alone** (owner decision 2026-09-05): with every check green on
  the current head and every conversation resolved, when GitHub still reports it `MERGEABLE` and
  what `main` gained since the merge-base is documentation, or code only in files this branch did
  not touch, it lands as it is with `gh pr merge --squash --admin`. `--admin` there bypasses
  the up-to-date requirement and nothing else — never a failing check or an open review. The
  up-to-date rule guards against semantic conflicts, which documentation cannot cause, and the
  post-merge unfiltered `main` run tests the merged tree (verified #119 with code, #240 with five
  docs commits; `/land-branch` step 2 classifies it). Rebase in the worktree only for
  `CONFLICTING`, or when `main` touched a code file this branch also changed — `pnpm install`, then
  push through the hook, never `--no-verify`. **Never `gh pr update-branch`**, whose merge commit
  carries no sign-off and fails DCO (#160).
- **Do not merge a PR automatically — wait for the user's approval.** Invoking `/land-branch` is that
  approval; nothing else is.
- **Merging requires resolved conversations** (`mergeStateStatus: BLOCKED` with green checks). Copilot
  is switched off here (2026-09-06): the second model on the diff is Codex (Sol) in
  `/finish-branch`'s run-it seat, before the PR exists, so its findings are triaged with the others and leave no
  thread. Copilot's lesson stands — its one reliable class was the sibling-file convention the branch
  missed — so the convention reviewer's brief asks for siblings. A thread that does appear is resolved
  via the GraphQL `resolveReviewThread` mutation with the id passed as a variable. Verify CI runs belong to the current head SHA
  (`gh run list --json databaseId,headSha`).
- **After merging, delete the feature branch, local and remote, and verify the remote one is gone**
  (`git ls-remote --exit-code --heads origin <branch>` must fail) — it has repeatedly survived.
- **An untracked file in the main checkout can block the post-merge `git pull --ff-only`.** Diff
  before deleting; the scratch copy was 113 lines behind what landed.

**Model selection (owner decision 2026-09-06, revised the same evening for cost):** the rule lives in
the global `~/.claude/CLAUDE.md` so every repo shares it. In short: Claude and Codex are separated.
Opus 4.8 is the default and drives everything the owner reads (spec, plan, execution driver);
Fable 5.1 is opt-in for the brainstorm plus two short dispatched reads (a spec touching §5, fix
round five) and never drives execution — a hook denies it; dispatched seats run on Opus 5; Codex
(`gpt-6-astra` at medium effort — measured against Sol on one commit with one bounded brief: faster,
fewer tokens, and it found the real defect that Sol at low missed; the process log is the tripwire)
holds exactly one seat **in a Claude-driven session** — when Codex drives, the roles reverse and
Codex implements while Claude reviews (owner, 2026-09-12), so a Codex implementation is not a rule
violation; ask who is driving. That one seat is `/finish-branch`'s run-it reviewer, dispatched through
`~/workspace/tools/codex-seat.sh review-run`, which is the second model family on the diff now that
Copilot's automatic review is off (its rule was removed from the main ruleset 2026-09-06). The
repository carries no Codex file: the seat script passes the model, the effort, the doc-size cap
(this file exceeds Codex's default and would be silently truncated), the sandbox's network switch
(the Docker socket and DNS are closed by default; measured 2026-09-05) and the fallback that makes
Codex read this file when there is no `AGENTS.md` (measured 2026-09-06, with a control). What is
waitron-specific is the yardstick: each slice against the
previous five PRs on fix rounds before land, false claims found at whole-branch review, and Codex
tasks that needed a Claude fix round (the last is zero by construction from here on; the SP-3c and
SP-3d rows in `docs/backlog.md` hold the two data points taken under the earlier rules). The
seat-by-seat probe that informed this is `docs/superpowers/specs/2026-09-05-model-seats-experiment.md`.

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

**The dev stack from a worktree is started with `wa-wt demo <worktree-name>` or
`wa-wt onboarding <worktree-name>`** (`~/workspace/tools`),
never with a bare `pnpm dev*`. The dev Postgres is ONE compose service shared by every checkout, and
`apps/server/.env` describes that DATABASE (venue ids, credentials key) — gitignored and absent from
a fresh worktree. Compose names its project after the directory, so an unqualified
`docker compose up` from a worktree starts a SECOND `db` with an empty volume on the same port.
`wa-wt` brings the shared db up under `COMPOSE_PROJECT_NAME=waitron`, copies only the current target's
`.env`, and follows the log. Changing target wipes the application volume while keeping the shared
development CA. `wa-wt reset demo [name]` and `wa-wt reset onboarding [name]` rebuild the selected
target and copy its new `.env` to every checkout. Cost: a
round trip each on 2026-09-05 and 2026-09-06 while the two rules were manual. Detail:
`docs/ui-review.md` → _Running the stack from a worktree_.

Since swap step 4 the compose `db` service passes `wal_level=logical` + `track_commit_timestamp=on`
(restart-required cluster settings) plus `max_slot_wal_keep_size=4GB` on its `command:`, so a dev box
is publishable/subscribable exactly as the box image's `postgresql.conf` makes it. `dev-setup` then
bootstraps the migrator-owned, replication-ready shape (`waitron_migrator` owns every table, the
`waitron_repl` bootstrap runs) so a `wa-wt reset demo` boot exercises the real replication provisioning —
that boot IS the live smoke that the unit suite (`apps/server/scripts/dev-setup.test.ts`) cannot cover
(`CREATE PUBLICATION` runs only at boot). A dev DB provisioned before this change is refused; run
`wa-wt reset demo`.

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

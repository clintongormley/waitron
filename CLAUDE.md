# Waitron — working notes for Claude

A Spanish restaurant POS with Veri\*Factu fiscal compliance. It files invoice records with AEAT (the
Spanish tax agency) and takes card payments through Stripe.

**What makes this codebase unusual:** some mistakes here cannot be fixed afterwards. Fiscal records
are append-only and hash-chained, invoice numbers are never reused, and chains cannot be merged or
migrated. A wrong filing is not repairable by editing data. That is why the conventions below are
strict and why claims in comments are held to an unusual standard.

**How to read this file.** Each entry is the rule, one line on what it cost, and a pointer. This file
holds the RULES; the receipts that paid for them — the mechanism, the measurement, the incident —
live in the topic files below. Read the topic file before you work in its area, and whenever you need
to check a claim rather than follow it.

| Topic file                                                 | Read it before you touch                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [ci-and-gates.md](docs/developers/ci-and-gates.md)         | CI, the pre-push hook, shards, coverage, test concurrency                     |
| [conventions-ui.md](docs/developers/conventions-ui.md)     | a screen, a form, a `wt-*` primitive, the dashboard shell, printing, hardware |
| [conventions-data.md](docs/developers/conventions-data.md) | the database, SQL, grants, migrations, module boundaries, provisioning        |
| [testing-guide.md](docs/developers/testing-guide.md)       | a test — especially real-PostgreSQL, container or browser tests               |
| [workflow-guide.md](docs/developers/workflow-guide.md)     | starting or landing a branch, or running the dev stack from a worktree        |
| [design-system.md](docs/developers/design-system.md)       | anything visual — it is the UI contract and it grows as screens land          |

`docs/backlog.md` answers "what should I work on?"; this file answers "how".

---

## 1. Writing claims — the house's dominant defect class

Comments and docs that assert more than the code delivers are this repo's most common defect, by a
wide margin. This section stays in full deliberately: it applies to every change, in every area.

- **A claim of necessity or impossibility needs a receipt** — the command that was run, or a cited
  `file:line`. Good shape: _"Proven on PostgreSQL 18 against the real migrations, as a LOGIN role with
  rolsuper = f: the four inserts succeed."_ When a claim names a privilege, name the role SHAPE that
  holds it: owner, grantee, or member. Cost: three false claims in one day on `bootstrap-tenant.sql`,
  each one born correcting the last.
- **Reading is not verification.** Run the thing. Cost: a false "superuser is unavoidable" survived a
  correction pass, a four-agent simplify, a fresh-context review and Copilot — all of them reading.
- **State the experiment, not the conclusion.** "I deleted the tenant predicate and the test failed"
  is checkable; "the guard is proven" is not. If the sentence describes more than what you ran, narrow
  it.
- **A measurement taken where both answers look alike measures nothing.** Before running a probe, say
  what the FAILING case would print; if that is what you expect to see anyway, you are not running a
  probe. A control in the other direction is the cheapest fix. A receipt someone hands you is still a
  claim. Cost: a zero-byte `pnpm --filter "...[origin/main]"` reading offered as proof the filter was
  broken, taken where zero was also the correct answer.
- **"Pre-existing", "not a regression", "harmless", "unreachable" and "narrow" are claims.** Check
  with `git log`/`git blame` first; unchecked, say "I believe this predates the branch".
- **The correction is a new claim, and deserves MORE scrutiny than the text it replaces.** This is the
  single most productive source of false claims in the repository's history.
- **Before asserting a convention, grep the siblings** — identifiers AND prose. Cost: an error code
  prefixed `payments.` landed beside twelve `payment.` siblings (codes are never renamed once
  shipped), and a spec used `orphan` to mean what `packages/payments/src/reconcile.ts` calls
  `unmatched`.
- **A behaviour change retires every receipt about the old behaviour — editing a file is not auditing
  it.** Read the runbooks and the README paraphrases across the whole base-to-tip range, not the three
  lines of context a diff shows; per-task review cannot see this class. Cost:
  `fix/provisioning-migrate-gate` left three stale claims in two READMEs, one of them a documented
  operator procedure the change had turned into a `42501`. **The PATH SET matters:** a sweep scoped to
  `packages/` and `apps/` cannot see a claim stated in prose somewhere else — SP-3b's did exactly
  that and left a file describing a deleted exclusion list. Read every claim stated in prose,
  wherever it lives, not only the ones written beside an identifier.
- **Claims about the outside world need receipts too — and the source's own words.** Every external
  claim gets a provenance row (`2026-07-30-deli-hardware-design.md` sourced eight prices, then
  asserted unsourced that "iOS Safari implements none of those APIs" — its decisive claim). Quote,
  then paraphrase. Cost: compressing Square's _"doesn't support splitting a checkout into multiple payments
  for a single checkout request"_ into "no splitting a checkout" turned an API limit into a product
  limitation. Two sources that seem to contradict usually describe different paths.
- **A comment carries the invariant, not the history.** The receipt lives in the commit message and
  the PR thread, with at most a one-line pointer. Thin on touch; do not sweep. Cost: comment lines
  measured 43–48% of non-test source in four packages, nearly all narrative, which doubles the tokens
  of every read and goes stale exactly the way this section documents (`apps/server`, `packages/db`,
  `packages/core`, `packages/sync`).

---

## 2. The gate

```bash
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
```

That is the shallow, whole-workspace check. The pre-push hook (`.husky/pre-push`) is deeper but
narrower — it runs `pnpm reap`, `pnpm install --frozen-lockfile`, `format:check`, then `typecheck`
and `test:coverage` over the CHANGED packages and their dependents. CI adds mutation testing and
`bundle-smoke`, which nothing local runs. **A green from any one of the three is evidence about what
it ran, and nothing more.**

**Coverage thresholds** are split (owner decision 2026-09-05): `98/98/98/95` in `verifactu`,
`fiscal-verifactu`, `core`, `db`, `sync` and `payments`; the `90/90/85/85` floor everywhere else,
browser packages included. Which package holds which bar is pinned by
`scripts/coverage-thresholds.test.ts`.

Traps, each of which cost a round trip. The mechanism behind every one is in
[ci-and-gates.md](docs/developers/ci-and-gates.md) — read it before changing anything about CI, the
hook, or how tests are scheduled:

- **Check every command's exit status.** A shell sequence separated by newlines reports only its
  LAST command's status. Use `&&` for dependent validation steps, or capture each status separately.
  Cost: a review-fix command ran a successful build after a failed server typecheck and reported
  success.
- **CI's shards run `test:coverage`, not `test`.** Before calling a package green, run
  `pnpm --filter <pkg> test:coverage`. There is no single `test` job.
- **CI does not run every check on every push.** Read the `changes` job's `code`, `scope` and
  `packages` outputs before treating a green PR as evidence about the workspace.
- **A cheap job can still be the critical path.** Sort a run's jobs by duration before calling one
  cheap enough to leave ungated.
- **The GHA cache is a shared per-repository budget and this repo sits AT it.** Name the entries a new
  exporter would compete with before adding it.
- **The pnpm changed-since filter silently matches nothing in a `git worktree`**, and all feature work
  happens in one. Verify anything touching the filter in a clone or on a real PR.
- **`pnpm --filter ""` is a hard error**, and an unquoted `$PACKAGES` expansion still GLOBS. Both
  gates build filters as positional parameters under `set -f … set +f`.
- **A scoped `pnpm` run that selects nothing REPORTS SUCCESS.** Both gates pipe the selection through
  `scripts/changed-packages.mjs runnable test:coverage` first; a green from that guard still does not
  mean a test ran.
- **The workspace root is outside `pnpm -r`**, so root config is linted but never typechecked, and
  `eslint.config.js` is not type-aware. Proven by mutation.
- **`--frozen-lockfile` is not in the four-command gate.** Moving a dependency between `dependencies`
  and `devDependencies` fails CI at install. The hook runs it; the gate does not.
- **A name-filtered test run does not load the package's guard suites** nor any e2e suite pinning a
  shared wire body with `toEqual`. Run the package unfiltered before believing a pass, and the whole
  workspace when you touch a value more than one suite asserts.
- **A hardcoded cross-package list goes stale when a manifest or scope changes, and scoped CI hides
  it.** Grep for tests that pin the list; run the whole workspace.
- **After a rebase + `--force-with-lease`, the hook can scope the WRONG package** (mechanism
  unconfirmed). Confirm with `git diff --name-only origin/main..HEAD` and run THAT package's gates;
  the PR's own CI is the trustworthy signal.
- **The pre-push log file can be days stale.** Reproduce; do not read it.
- **The four browser packages run vitest in real headless Chromium.** Concurrency is decided by
  measured headroom, never by a count: check free memory and the heaviest processes first, then scale
  `--workspace-concurrency` to what is free. Chromium's launch depends on a Codex seat's PERMISSIONS,
  not on Codex — check host execution before deferring browser testing to another agent.
- **Only the `core` migration set has an upgrade test; every module set is still migrated from a
  VIRGIN database only**, so a green gate is no evidence that a module set can upgrade a box. Cost: a
  bricked box, an hour of guesswork, and a wipe that destroyed the evidence.

Bypassing the hook with `--no-verify` is for emergencies; the failure still has to be fixed because
CI runs the same checks. A hook failure the PR does not reproduce is a check CI has deferred to the
unfiltered `main` run, not a wrong hook.

---

## 3. Conventions reviewers enforce

One line each; the receipt for every one is in its topic file. **Read that file before working in the
area** — these lines tell you what the rule is, not why it exists or how it broke.

### Screens, forms and the dashboard — [conventions-ui.md](docs/developers/conventions-ui.md)

- **New or changed forms use the shared UI contract in [design-system.md](docs/developers/design-system.md) → Forms.**
  Required fields visibly marked; an invalid submission explains itself beside every bad field and in
  one localized summary; every input has a semantic `name`, never a generated widget id.
- **A replay reports the original transaction facts; side effects are gated separately.** Cost: cash
  change returned as zero on a retry, because displaying change was treated as dispensing it.
- **A successful write followed by a failed refresh is a load failure, not a failed save.** Close the
  editor after the write succeeds, then refresh separately — a retained create form invites a
  duplicate submission.
- **Automatic dashboard reads are passive session activity.** Use the shared query controller or the
  request primitive's `passive` option, or polling keeps an unattended dashboard signed in.
- **A background API client does not make POST requests passive.** Only GETs are marked passive;
  automatic pairing renewal uses its own authenticated route.
- **Dashboard subscription names travel with their server sources.** A rejected subscription closes
  the whole tab's stream, so a misspelled name breaks other screens too. Guard:
  `scripts/live-subscriptions.test.ts`.
- **The dashboard banner is persistent identity chrome** — top of the page, full width, the tenant's
  legal name (not a location), Logout at the trailing edge only when a session exists.
- **Dashboard sign-in matches the browser's `Accept-Language` preferences.** Guard against a late
  locale response overwriting an authenticated person's language or an explicit choice.
- **Dashboard login offers methods without revealing account enrolment.** Never query account status
  or passkey enrolment to choose the public screen.
- **Every colour, spacing, radius and font in a `packages/ui` component reads a `--wt-*` token.** No
  hex, no named colours, no `rem`/`em`. Guard: `packages/ui/src/no-hardcoded-chrome.test.ts`.
- **A new `wt-*` primitive needs two specific tests**, not "some tests": a token-painting test, and an
  axe accessibility test in a sibling `*.a11y.test.ts` covering each distinct state in both themes.
- **Custom events are named `wt-*`, carry `detail`, and are dispatched `bubbles: true, composed: true`
  — and the triggering event is stopped with `event.stopPropagation()` before re-emitting**, or the
  consumer observes the change twice.
- **A retained hardware registration must remain re-addable after deactivation.** Discovery matches
  disabled records too; the dashboard offers them as Add again and reactivates the existing id.
- **The hardware transport seam is `@waitron/print-agent`, and it is database-free.** The guard is the
  `import-x/no-restricted-paths` zone in `eslint.config.js`, not the empty `dependencies` block.
- **A container that must reach a hot-plugged USB printer mounts `/dev:/dev:ro`**, plus
  `device_cgroup_rules: ["c 180:* rwm"]` and `group_add: ["7"]` — not a `/dev/usb` subdirectory bind
  and not a hard `devices:` line.
- **The unauthenticated recovery page renders fixed strings chosen by code, never the caught error's
  words.** Only the error CODE and the LOG TAIL come from outside the image, which is why no code's
  params may carry a secret. A page edit that interpolates a caught message breaks a security
  boundary nothing outside the design states.

### Data, modules and migrations — [conventions-data.md](docs/developers/conventions-data.md)

- **Error codes name the DOMAIN CONCEPT, never the throwing package** — `series.not_found`, not
  `db.series_not_found`. **Never renamed once shipped**; deprecate and add a sibling. `server.*` is
  reserved for facts about the process itself. Every file that throws a code imports its registry.
- **Spanish domain terms are deliberate, and a module declares its own.** One declaring home per word;
  a fiscal term never goes in the base list. Guard: `scripts/english-only.test.ts`. `apps/*` is out of
  scope by a recorded decision, so Spanish identifiers in app UI code are caught only by review.
- **The composition list lives in `@waitron/composition`, and it is the only place that names every
  module.** Generic code reaches the regime through the descriptor's `provisioning` and `fiscal`
  seats. The boundary is the swappable SLOT, not "any module". Guard: `scripts/module-seams.test.ts`
  — shrink its allowlist, never grow it. `@waitron/dashboard-modules` is the browser-side twin.
- **A new product domain lands as a MODULE, not as new code in the core**, filling the contract seats;
  generic code never learns it exists.
- **A country pack is a browser-safe preset over modules, not a module.** Packs name contribution ids
  as strings and never carry an external-provider credential.
- **A command name is declared under `waitron.commands`, never `bin`.** Nothing builds at install
  time, so a `bin` under `dist/` is never linked by the install that reads it.
- **`@waitron/db`'s `exports` map is enumerated, not a wildcard**, so `apps/server` cannot deep-import
  its `errors.ts` and `asAppUser` has one import path.
- **Never build SQL by string concatenation — except for utility statements, which PostgreSQL will not
  bind.** For those, either escape (`quoteIdent`/`quoteLiteral`) or validate and throw
  (`probeRoleStatement`). Neither is not acceptable; "the callers only pass safe values" is the §1
  defect class.
- **A `sql` scalar subquery correlated to the OUTER query's table breaks silently when that table is
  the `.from()` base rather than a join** — no error, a wrong answer. Check base-vs-join and READ the
  emitted SQL with `.toSQL()`.
- **Never widen a grant to make a test pass.** `app_user` holds `SELECT` on `tenants` and not `INSERT`
  deliberately. If a test needs a privilege the role does not have, the test is asserting the wrong
  thing or the code is reaching somewhere it should not — establish which before touching any grant.
- **An object-privilege `GRANT` PostgreSQL accepted is not a `GRANT` that did anything.** A partial
  grant WARNs and exits 0, and `PUBLIC`'s default `CONNECT`/`TEMP` counts as "held" so the hard error
  is rarely reached. Read the ACL back rather than trusting the exit code; `has_*` functions also
  count privileges held only through group membership, which a provisioner must not accept.
  Role-membership grants are different: they always ERROR.
- **Multi-table writes share ONE transaction, and `withTenant` IS that transaction.** Write-path
  functions take a `tx: Transaction` and never open their own; a route handler opens exactly one
  `withTenant` per request. This is a convention, not a compiler guarantee — `Database` is assignable
  to `Transaction`. **Splitting one logical change across transactions is a commented decision, never
  a default.**
- **A by-id read still needs its own `eq(table.tenantId, cfg.tenantId)` — one-tenant-per-database is
  NOT the query's isolation boundary.** Since RLS was dropped, `withTenant` no longer isolates
  SELECTs, so every read scopes to the tenant itself, a by-id read as much as a list read, never
  trusting a globally-unique UUID. Cost: a by-id read on `working_orders.id` alone let tenant A read
  AND abandon tenant B's order. Four reading review layers called it safe; only the seat that RAN a
  two-tenant probe caught it.
- **A configuration route checks the TENANT returned by `authorizeManager`, as well as scoping its
  queries.** The permission check returns the session's tenant; it does not compare it with the
  configured one. Printer routes enforce the same check. Cost: a two-tenant route probe returned 200
  for the other tenant's manager until the caller compared them.
- **A new table is classified `ledger`, `state` or `local` in its module's `<MODULE>_CLASSIFICATION`
  list, and an append-only table's `reject_mutation()` triggers are `ENABLE ALWAYS`** — the
  replication apply worker skips ordinary triggers. No policies, no RLS: one tenant per database.
  Guards: `scripts/classification-complete.test.ts`, `scripts/append-only-enable-always.test.ts`.
- **The two publications a node holds are created by the table OWNER, and the replication role is a
  bootstrap the app provisioner only verifies** (`assertReplicationReady`). A subscription's
  connection string carries a password, so its statement is never logged and a failure throws only a
  SQLSTATE.
- **`waitron-provision instance` migrates AS the migrator, via a `role=` session option, never as a
  plain admin** — `CREATE PUBLICATION … FOR TABLE` is owner-only, so every table must be
  migrator-owned. Any new provisioning path that creates schema carries `withRole`.
- **A module/migration dependency graph has TWO kinds of cross-set edge**: an FK `REFERENCES`, and a
  trigger executing a function owned by a different migration set. No module creates the second kind
  today. Guard: `scripts/module-graph-honesty.test.ts`.
- **No new table enters the core migration set without a stated reason in the commit.** A
  `tenant_id`-bearing domain table belongs to its module's own set, where its grants travel with it.
- **A drizzle migration-number collision on rebase is fixed by regeneration, never by hand-editing the
  snapshots or `_journal.json`.** Reset the migrations dir to main's state, regenerate, and verify by
  RUNNING the grant assertions and `inmutabilidad`.
- **Drizzle picks what to apply from `max(created_at)` alone**, never from a position in the journal,
  so an entry at or below a recorded watermark never runs and drizzle raises nothing. The core journal
  is already in a shape no edit repairs — a database at core release points 1–6 cannot reach HEAD.
  Guard: `scripts/journal-monotonic.test.ts`. A drizzle bump starts with `grep -rn 'dialect.js'`.
- **`applyMigrations` refuses to report success on a short set**, throwing `migrations.incomplete`
  rather than serving a half-migrated schema.
- **The box's BOOT path carries an ahead-of-image check; no other migrating path does, and
  `waitron.sh install <ref>` is a one-way door.** `assertNotAhead` throws
  `provisioning.database_ahead`. The GAP, stated so nobody assumes coverage: `waitron-provision
instance`, the cold restore, `rejoin-command` and `dev-setup` each migrate a live database with no
  ahead check. Cost: without it an ahead database re-migrates CLEANLY and surfaces later as an
  unclassified driver error.
- **An empty connection string is a valid connection string** — it resolves to localhost with every
  default. Anything reading a URL from env or a prompt refuses `""` explicitly.
- **No backwards-compatibility or data-migration code until Waitron is in production.** Schema changes
  drop and recreate. This rule expires the day a real venue is live; add its replacement in the same
  change.

---

## 4. Testing

One line each; the mechanism, the measurement and the incident behind every one are in
[testing-guide.md](docs/developers/testing-guide.md). **Read it before writing a real-PostgreSQL,
container or browser test** — most of these rules exist because a test passed while proving nothing.

- **Two targets.** **PGlite** is hermetic and fast, but every connection is a superuser (grants are
  not enforced) and every query serialises onto one backend, so a contention test on PGlite is a
  **false pass**. **Real Postgres** via Testcontainers is required for privileges, triggers as the
  deployment role, or concurrency. `describeEachTarget` runs a suite against both. Pick the lighter
  one when the heavier one's justification does not apply, and say why in a comment.
- **A grant assertion must call `asAppUser(tx)` before the query under test.** Without it the test
  runs as the owner and asserts nothing, however much it asserts.
- **Don't own a database in a suite — let a helper own it** (`usePgliteDb` / `useRealPostgres`). Raw
  `beforeAll`/`afterAll` only when the suite legitimately builds its own resource, and then guarded.
  Guard: `scripts/guarded-teardowns.test.ts`.
- **`TESTCONTAINERS_RYUK_DISABLED=true` is required locally**, and with Ryuk off an INTERRUPTED run
  leaks containers; `pnpm reap` removes them by label and age. Never a blanket `docker volume prune`.
- **An interrupted run also ORPHANS its vitest workers**, which spin at ~100% CPU until `kill -9`.
  `pnpm reap` sweeps these, scoped by ppid 1 AND the process TITLE — not a bare `vitest` match.
- **Networked PostgreSQL fixtures use one Docker network and unique container names for DNS.** A
  second bridge with a different MTU stalled larger queries while small ones passed. Use
  `networkedPostgresContainer`.
- **Concurrent coverage runs must not share a package's report directory.** Vitest cleans that
  shared directory, so two overlapping runs over the same package end in `ENOENT`. Inspect the
  resolved selection first, or give an intentional second run its own
  `--coverage.reportsDirectory`.
- **Reuse a supplied test container before probing Docker again.** A failing `docker info` is not
  evidence that a container global setup already started is absent.
- **A container port-binding timeout needs Docker state as well as database logs.** Save
  `docker inspect`'s `HostConfig.PortBindings` and `NetworkSettings.Ports` before removing the fixture.
- **Locate the unfinished package before diagnosing a silent shard as PostgreSQL contention.** A
  Vitest test timer does not bound a browser whose event loop has stopped; use an outer deadline, and
  never a retry as proof of repair.
- **A recurrent real-PG stall needs a retained log and a live database snapshot.** Locate the stalled
  operation before assigning its cause to resource contention.
- **Vitest 3's fork limit belongs on the outer config, even with projects.** Moving `maxForks` inside
  a project started 17 workers on the local host. Guard: `scripts/fiscal-test-budget.test.ts`.
- **A probe that needs a Unix SOCKET runs inside the container.** Bind-mounting a socket dir out of
  Docker Desktop's VM gives `ECONNREFUSED` on macOS.
- **A test that shells out to `git` must clear `GIT_DIR` and its family.** Git exports `GIT_DIR` to
  every hook, so a hand-isolated fixture writes into the real repo. Run such a suite once under
  `GIT_DIR` before trusting it.
- **The four browser packages run vitest in real headless Chromium** — see §2 for the concurrency rule.
- **Browser passkey tests stub `navigator.credentials`, keeping the WebAuthn library real.** A module
  mock cannot replace an already-loaded browser ES module.
- **Browser recovery tests read the native control inside a shared component.** A host's `checked`
  property can report the expected value while its inner checkbox is visibly wrong.
- **A reopened polling dialog owns a new in-flight gate.** Reset it on close and guard its release
  with the request's generation, or an old read blocks the reopened dialog.
- **A browser test using fake timers must advance an awaited animation frame or restore real timers
  first**, or it stalls on its own paused `requestAnimationFrame`.
- **Dispatch events when testing a `composedPath()` guard.** An undispatched `KeyboardEvent` has an
  empty path, so the test can pass without reaching the branch it claims to check.
- **Position a native popover before its first paint.** Positioning from the asynchronous `toggle`
  event left the menu at `(0, 0)` for its first frame.
- **Test public recovery links through the real boot modes that serve them.** Mounting a route on a
  bare Hono app cannot establish that trading or recovery boot installs it.
- **Test provider HTTP refusals through the real client, as well as a throwing fake seat.** A fake
  proved the thrown error preserved the local reader while the HTTP client silently accepted 401/403/409.
- **Local reactivation cannot restore a removed provider registration.** Successful unpair records a
  marker that only provider-verified adoption clears.
- **Source scanners select files, not just paths ending in `.ts`.** A failing browser test creates a
  screenshot DIRECTORY named `*.test.ts`; treating it as a source file made the vocabulary guard throw
  `EISDIR`. `sourceFilesIn` checks `isFile()`, with a fixture preserving a real nested source file.
- **A guard that reads the whole tree belongs in the ROOT Vitest project**, which the ungated `lint`
  job and the hook run on every non-docs push. Two costs of living there: the root project does not
  typecheck, and the module must be in the root `coverage.include`.
- **Prove a guard by deletion**, and confirm a negative control fails for the reason you think.
- **A fixture no check reads is unverified data, and a green suite resting on it proves nothing.**
  Cost: the shared alta fixture had drifted into a record AEAT would reject, masking a real defect in
  `recordSale`; correcting it took 42 tests red-to-green across eight files and left three red that
  were the bug. When a fixture describes something an authority will judge, run the real check over it.
- **Treat "there is a test" as an unfinished sentence.** Coverage proves a line executed, not that
  anything asserted on the result. Ask which assertion would fail if the behaviour were deleted; "it
  doesn't throw" is not an answer. `pnpm --filter @waitron/ui mutation` checks this systematically.
- **`errors.ts` reachability is guarded once, in `scripts/errors-reachable.test.ts`.** Thirteen
  hand-copied per-package versions were deleted; six of them passed with `errors.ts` fully unreachable.
- **`toMatchObject` checks only the keys you list**; a key you never list is never checked at all.
  `toEqual` is what put `memberOf` under a matcher for the first time.

Adding a new real-PG test package: the shared-container pattern and its knobs are in
`docs/backlog.md` → _Reference_.
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

The commands, the dev stack and the receipts are in
[workflow-guide.md](docs/developers/workflow-guide.md). **Model selection is not a waitron rule** —
it lives in the global `~/.claude/CLAUDE.md` and is shared by every repo. In short: Opus 4.8 drives,
Fable is opt-in for brainstorming, dispatched seats run Opus 5, and Codex holds one seat when Claude
drives. When CODEX drives, the roles reverse and Codex implements — so establish who is driving
before treating an implementation as a rule violation.

- **Never commit directly to `main`.** Feature work happens in a worktree
  (`python3 ~/workspace/tools/worktree.py new waitron <branch>` — not a plain `git worktree add`,
  which `/land-branch` cannot tear down). Name the branch right at creation.
- **A `docs/`-only change is exempt from the PR ceremony**: branch, `commit -s`, fast-forward `main`,
  push direct. A ROOT `CLAUDE.md` or `README.md` is format-checked and takes the normal flow.
- **Every commit needs `git commit -s`.** **A PR that goes `BEHIND` is not rebased for that alone**
  (owner decision 2026-09-05): if what `main` gained is documentation, or code only in files this
  branch did not touch, land it with `gh pr merge --squash --admin`. Rebase only for `CONFLICTING`,
  or when `main` touched a code file this branch also changed. **Never `gh pr update-branch`** — its
  merge commit carries no sign-off and fails DCO.
- **Do not merge a PR automatically — wait for the user's approval.** Invoking `/land-branch` is that
  approval; nothing else is.
- **Merging requires resolved conversations.** Copilot is off here; the second model on the diff is
  Codex in `/finish-branch`'s run-it seat, before the PR exists. Verify CI runs belong to the current
  head SHA.
- **After merging, delete the feature branch, local and remote, and verify the remote one is gone** —
  it has repeatedly survived.
- **The main checkout goes stale in a way the worktrees do not**, because nothing installs there.
  `/land-branch` runs `pnpm install` after the pull; run it yourself after any other pull.
- **The dev stack from a worktree is started with `wa-wt demo <worktree-name>` or
  `wa-wt onboarding <worktree-name>`**, never a bare `pnpm dev*` — compose names its project after the
  directory, so an unqualified `docker compose up` starts a SECOND `db` on the same port.

**Docs.** `docs/backlog.md` answers "what should I work on?" — read it before starting anything
unprompted, and **update it in the same change that makes it stale** (the moment it goes stale most
reliably is a MERGE). Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`,
both committed deliberately because a plan doubles as an operator's runbook. Session handoffs in
`docs/handoffs/` are gitignored — never open a PR for one. Historical docs record what was true when
written: add a dated pointer rather than rewriting them.

---

## 7. Keep this file current — it is part of the work, not a chore

Every rule above was paid for by a defect, a wasted round trip, or a review finding. When you pay
that price again, the lesson goes here in the same change that fixes it.

**Add an entry when:** a review finds a defect whose _shape_ could recur; a trap costs real time; you
discover a convention by grepping rather than reading; a decision gets made that a future session
would otherwise relitigate.

**Where it goes.** This file holds the RULE — one to three lines, plus what it cost and a pointer.
The receipt goes in the matching topic file under `docs/developers/`. That split is what keeps this
file loadable: it is read into every session, so a paragraph here is paid for on every turn of every
session, while a paragraph in a topic file is paid for only when somebody needs it.
`scripts/claude-md-pointers.test.ts` fails if a file this one points at does not exist.

**Do not add:** one-off bugs with no reusable shape, anything the code or types already state plainly,
or the narrative of what a session did — that belongs in the commit or the PR thread. **A count is a
receipt that goes stale**, so describe the property, not the number. **If a guard enforces the rule,
name the guard and stop** — do not also explain what the guard checks, because the failing test says
that better and never goes stale.

**Prune as well as append.** A superseded rule teaches a session to work around something that no
longer exists; delete it and say so in the commit. Natural moments: while addressing review findings,
and when writing a handoff — anything phrased "next time, remember to…" belongs here instead. A
written rule with standing violations needs a guard, not another paragraph.

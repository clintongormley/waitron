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
| [conventions-data.md](docs/developers/conventions-data.md) | the database, SQL, migrations, module boundaries, provisioning                |
| [testing-guide.md](docs/developers/testing-guide.md)       | a test — especially a database or browser test                                |
| [workflow-guide.md](docs/developers/workflow-guide.md)     | starting or landing a branch, or running the dev stack from a worktree        |
| [design-system.md](docs/developers/design-system.md)       | anything visual — it is the UI contract and it grows as screens land          |
| [products.md](docs/developers/products.md)                 | a product's three names, what each surface shows, the translation gap report  |
| [writing-claims.md](docs/developers/writing-claims.md)     | writing a sentence about how something behaves — a comment, a doc, a spec     |

`docs/backlog.md` answers "what should I work on?"; this file answers "how".

---

## 1. Writing claims — the house's dominant defect class

Comments and docs that assert more than the code delivers are this repo's most common defect, by a
wide margin. This section stays in full deliberately: it applies to every change, in every area.

- **A claim of necessity or impossibility needs a receipt** — the command that was run, or a cited
  `file:line`. Good shape: _"Measured 2026-09-22 on `node:sqlite`, Node v26.7.0, inside one
  transaction: a duplicate key, a null in a `not null` column and an append-only trigger's
  `raise(abort)` each left the transaction usable, and the rows written beside them committed."_ —
  it names the engine, the version, the conditions and what happened, so a reader can re-run it.
  Cost: three false claims in one day on one file, each one born correcting the last.
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
- **A sentence about what ANOTHER part of the system does is checked by following the call chain to
  that part, not by reading the boundary you just edited.** The fix can be right and the sentence
  describing it still too wide: you had one edge open, and you wrote about the whole path. Cost: this
  shape kept reaching review on one branch, the commit that wrote the rule down included; the
  instances are in [writing-claims.md](docs/developers/writing-claims.md).
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
  operator procedure the change had turned into a permission refusal. **The PATH SET matters:** a sweep scoped to
  `packages/` and `apps/` cannot see a claim stated in prose somewhere else — SP-3b's did exactly
  that and left a file describing a deleted exclusion list. Read every claim stated in prose,
  wherever it lives, not only the ones written beside an identifier.
- **Claims about the outside world need receipts too — and the source's own words.** Every external
  claim gets a provenance row (`2026-07-30-deli-hardware-design.md` sourced eight prices, then
  asserted unsourced that "iOS Safari implements none of those APIs" — its decisive claim). Quote,
  then paraphrase. Cost: compressing Square's _"doesn't support splitting a checkout into multiple payments
  for a single checkout request"_ into "no splitting a checkout" turned an API limit into a product
  limitation. Two sources that seem to contradict usually describe different paths.
- **A class's representative has to be a value the two sides could treat differently.** Enumerating
  edge cases from a changelog is only as good as the example chosen per class — pick it from what
  the FORMAT allows, not from the first value that comes to mind. Cost: a `fast-xml-parser` 4 → 5
  equivalence probe over every AEAT document the suites could be made to yield, plus a hand-built
  edge case per changelog entry, found one difference of four and missed that version 5 had stopped
  decoding `&#38;` — because the case standing for "numeric entity" was `&#233;`, which NEITHER
  version decodes. Instance in [writing-claims.md](docs/developers/writing-claims.md).
- **The code is what matters; comments go stale.** Keep a comment only for an invariant, or a
  non-obvious why, that the code cannot show — never history, narrative, or a restatement of the
  code. The receipt lives in the commit message and the PR thread, with at most a one-line pointer.
  Cut on touch, and deliberate pruning sweeps are wanted (owner decision 2026-09-23). Prefer deleting
  to rewording: a rewording is a new claim. A comment another rule here requires at its site stays:
  a guard's "weaker than its name" hedge, a decision "stated at its site", a "commented decision".
  A sweep shows it changed nothing but comments with `node scripts/comments-only.mjs <base>`, weaker
  than its name: it reads committed changes only; a changed `.md` file is listed as not compared
  and never read; a comment read by a tool its hand-written list does not name is dropped unseen;
  and a listed tool comment moved to another line without crossing a token passes. Cost: about
  three in ten non-blank lines of non-test code were comment-only on 2026-09-24
  ([writing-claims.md](docs/developers/writing-claims.md)).

---

## 2. The gate

Run focused behavioral tests while implementing, including a failing test before a fix. Let the
normal pre-push hook run the local checks once; mandatory package tests and coverage run in CI.
Do not add a whole-workspace local run solely to finish a branch. Broader local runs remain useful
for investigating failures or behavior across packages. Required CI checks must pass on the current head.

The pre-push hook (`.husky/pre-push`) checks sign-offs, frozen install, formatting, lint, root
guards with coverage, and scoped package types. It runs no package tests. Documentation stops after
formatting; machinery-only changes stop after root guards, unless they touch a root script a package
reads or its CI test job runs (`ROOT_SCOPE_CONSUMERS` in `scripts/changed-scope.mjs`); deletion-only
pushes skip checks. Unknown ranges keep the full local gate, including workspace typechecking. See
[ci-and-gates.md](docs/developers/ci-and-gates.md) for commands and scope details.

**Coverage thresholds: every package, and the root project, holds `98/98/98/95`** (owner decision
2026-09-23, retiring the 2026-09-05 split that reserved it for the fiscal core and the data layer;
the lower floor is gone). A new package holds it from its first commit. The bar is negotiable only
where the rest of a gap could be closed solely by tests that assert nothing useful, and a gap is
never closed by hiding code a test could reach — adding an exclude or an ignore comment over it, or
moving it under `src/testing/`. Guard:
`scripts/coverage-thresholds.test.ts`, weaker than its name — it reads each config's `thresholds`
literal as TEXT; it never reads `coverage.exclude` or an ignore comment, so an added exclude passes;
it skips the members `PACKAGES_WITHOUT_TESTS` names (`scripts/changed-scope.mjs`); and it checks the
`pnpm ls` listing only for the names in `EXPECTED_MEMBERS` and a loose `MIN_TESTED_MEMBERS`, so a
listing that drops a few others passes. More:
[ci-and-gates.md](docs/developers/ci-and-gates.md).

**A mutation floor of 90 breaks the run in every mutation-tested package — `ui`,
`ui-core`, `shared`, `fiscal` and `db`** (`shared` since July 2026; `fiscal`, `ui` and `db`
under the owner's 90-everywhere decision of 2026-09-19). WHERE it bites differs:
`shared` fails a pull request whose resolved scope contains it (on `main` the scope
is `global`, so it always runs); `ui`, `ui-core` and `db` fail only the weekly
`.github/workflows/mutation.yml` run, so thinning one of their tests goes green and reddens on
Monday; and `fiscal` has no CI job at all, so only a local `pnpm --filter @waitron/fiscal mutation`
sees it — and its `mutate` list covers two named files, not the package. **`db`'s bar is not in its
own stryker config**, because CI splits its run across ten shards and a `thresholds.break` there
would gate a slice: the ten reports are merged and scored once by the `mutation-db-aggregate` job,
so a LOCAL `pnpm --filter @waitron/db mutation` prints a score and gates nothing. Like `fiscal`'s,
db's 90 is not quite package-wide — one file is out of its `mutate` set, `src/english-only.ts`,
whose only suite is in the root project and which nothing under `packages/db` imports today.
Receipts: `scripts/mutation-shard.mjs`'s `NOT_MUTATED`. Which package
holds which bar is pinned by `scripts/mutation-break-thresholds.test.mjs`, weaker than its name in
one way — it reads the workflow as TEXT for db's bar. More:
[ci-and-gates.md](docs/developers/ci-and-gates.md).

Traps, each of which cost a round trip. The mechanism behind every one is in
[ci-and-gates.md](docs/developers/ci-and-gates.md) — read it before changing anything about CI, the
hook, or how tests are scheduled:

- **`prettier --check` on an IGNORED path prints the same line as a clean one.** `docs/` is ignored
  whole (`.prettierignore`), so a format check over it reports
  `All matched files use Prettier code style!` and exits 0 having checked nothing — CLAUDE.md §1's
  "both answers look alike" with a command attached, and the same two lines a genuinely clean path
  prints. `pnpm exec prettier --file-info <file>` is the
  one that discriminates; it prints `"ignored": true`. Cost: a dated pointer scripted into a plan
  matched a line-wrapped `**Run`, split the bold span and left the paragraph rendering wrong; a
  format check over that directory reported clean, and a review seat found it by reading.
- **Check every command's exit status.** A shell sequence separated by newlines reports only its
  LAST command's status. Use `&&` for dependent validation steps, or capture each status separately.
  Cost: a review-fix command ran a successful build after a failed server typecheck and reported
  success.
- **CI's shards run `test:coverage`, not `test`.** Verify that package’s coverage job on the
  current head; run `pnpm --filter <pkg> test:coverage` locally when investigating a failure.
  There is no single `test` job. Vitest `--shard` splits by FILE COUNT, so `N` must never exceed a package's test-file count.
- **Moving harness code out of a `.test.ts` and into `src/testing/` puts it under coverage, and
  under mutation too in the few packages that run one.** A test file is measured by neither; an
  ordinary file under `src/` falls inside whatever its package's `coverage.include` names, and is
  ALSO a mutation subject only where that package has a Stryker config —
  `ls packages/*/stryker.config.json` says which, and it is a short list. `packages/db` is on it,
  and neither its coverage `include` nor its `mutate` list leaves `src/testing/` out. Cost: one
  branch moved a suite's
  machinery out of a 505-line test file and `packages/db`'s branch coverage fell from 97.2 to 93.03
  against a bar of 95 — red until a unit suite was written for the moved code — and the file became
  the package's largest mutation subject, whose shard runtime nobody has measured. Receipt:
  [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **CI does not run every check on every push.** Read the `changes` job's `code`, `scope` and
  `packages` outputs before treating a green PR as evidence about the workspace.
- **No front-end bundle is built by a pull request that did not touch `deploy/`.** In CI the SPAs
  are `vite build`-ed only inside `deploy/Dockerfile`, which on a pull request runs only when
  `deploy/` changed — and wherever it does run it builds them without opening one, so a bundle that
  renders nothing passes anyway. Cost: the vite 6 → 8 bundler replacement had to take its build
  evidence locally. See [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **esbuild bundles sharp without complaint, and the bundle it builds cannot be loaded.** Every
  Node bundle is built by `scripts/bundle-node.mjs`, which leaves sharp out of all of them, and the
  box image copies sharp into `/app/node_modules`. Guards: `scripts/deploy-image-env.test.ts`,
  weaker than its name (it finds a direct `esbuild` call by reading package.json TEXT, so a package
  script that runs its own file calling esbuild is invisible, and it pins only server and
  provisioning to the shared script, so a new package reaching `@waitron/media` that bundles
  through something that TEXT match cannot see — a file of its own, another bundler, or esbuild
  reached by path — passes); the bundle-smoke grep in `.github/workflows/ci.yml`, which reads
  `dist/server.js` alone, not the other server bundles or `waitron-provision`; and image-smoke's
  sharp step. Receipt: [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **Two pushes to `main` must never share a CI concurrency group.** GitHub keeps only one PENDING
  run per group and a newer push cancels the waiting one, which `cancel-in-progress` never reaches.
  Cost: a code merge that got NO run at all — no image published, no unfiltered main suite, and
  nothing red anywhere, so check after a merge that its own run exists. The pushes now overlap, so
  publishing asks `scripts/main-tag-guard.sh` before moving `:main`. Guards:
  `scripts/ci-workflow.test.mjs` (reads ci.yml as TEXT, and sees no other workflow) and
  `scripts/main-tag-guard.test.mjs`.
- **A cheap job can still be the critical path.** Sort a run's jobs by duration before calling one
  cheap enough to leave ungated.
- **The GHA cache is a shared per-repository budget and this repo sits AT it.** Name the entries a new
  exporter would compete with before adding it.
- **The pnpm changed-since filter silently matches nothing in a `git worktree`**, and all feature work
  happens in one. Verify anything touching the filter in a clone or on a real PR.
- **`pnpm --filter ""` is a hard error**, and an unquoted `$PACKAGES` expansion still GLOBS. Both
  gates build filters as positional parameters under `set -f … set +f`.
- **A scoped `pnpm` run that selects nothing REPORTS SUCCESS.** CI checks the selection with
  `scripts/changed-packages.mjs runnable test:coverage`; the hook checks `runnable typecheck`.
  A green selection guard alone does not mean a check ran.
- **The workspace root is outside `pnpm -r`**, so root config is linted but never typechecked, and
  `eslint.config.js` is not type-aware. Proven by mutation.
- **Two TypeScript compilers are installed on purpose, and there is no `tsc` at the ROOT.** A
  package's `tsc` is version 7; the root resolves `typescript` to the version 6 API typescript-eslint
  and `scripts/comments-only.mjs` still need, and its only binary is `tsc6`. Cost: typescript-eslint
  refuses version 7 by its major alone, before loading its parser, so raising the root to it makes `pnpm lint` refuse to start with
  no results at all — and version 7 rejected the one typechecked file reaching into another package by
  relative path (`TS6059`). See [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **`--frozen-lockfile` is not in the four-command gate.** Moving a dependency between `dependencies`
  and `devDependencies` fails CI at install. The hook runs it; the gate does not.
- **A name-filtered test run does not load the package's guard suites** nor any e2e suite pinning a
  shared wire body with `toEqual`. A focused pass proves only those cases; CI supplies package-wide
  coverage. Run additional consumer tests locally when they help investigate shared behavior.
- **Adding a workspace package fails three root guards until it is named in the shard lists**, and
  one of the three CRASHES rather than asserting, so the message names a missing `vitest.config.ts`
  and reads like a broken checkout. See [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **A hardcoded cross-package list goes stale when a manifest or scope changes, and scoped CI hides
  it.** Grep for tests that pin the list, run those guards, and verify CI selects every affected consumer.
- **After a rebase + `--force-with-lease`, the hook can scope the WRONG package** (mechanism
  unconfirmed). Confirm with `git diff --name-only origin/main..HEAD` that the hook typechecked the
  packages the changed paths select (a root script `ROOT_SCOPE_CONSUMERS` lists selects the packages
  listed against it); run any missing typechecks and verify the PR’s CI scope and results.
- **The pre-push log file can be days stale.** Reproduce; do not read it.
- **Every package whose vitest config enables browser mode runs in real headless Chromium.**
  Concurrency is decided by measured headroom, never by a count: check free memory
  (`memory_pressure | grep free`) and the heaviest processes first, then scale
  `--workspace-concurrency` to what is free. A browser run may start beside ANOTHER SESSION's
  browser run when `memory_pressure` reports free memory well above 15% (owner decision
  2026-09-24). What is NOT allowed is adding one beside a backgrounded whole-workspace
  `pnpm -r test:coverage` — check what else is testing on the machine first. Chromium's launch depends on a Codex seat's PERMISSIONS,
  not on Codex — check host execution before deferring browser testing to another agent.
- **A migration can fail on a box that already has a trigger naming what it changes**, which a
  fresh database migrated in one go never has — so most suites cannot see it. `applyMigrations`
  removes the change feed first for that reason (`installChangeFeed` in `apps/server/src/boot.ts` reinstalls it); a rebuild of a table
  another set's trigger BODY reads still fails (measured on core `0003`). Guard:
  `scripts/migration-upgrade.test.ts`, weaker than its name — its tables hold no rows; it installs
  today's change-feed list, and today's append-only list less the tables the previous step lacked, at every step; it applies everything up to core's
  `0003` in one go; and it asserts only that each step does not throw, so a rebuild that silently
  drops a trigger ON the rebuilt table passes it (SQLite drops one silently:
  [conventions-data.md](docs/developers/conventions-data.md)). Cost: an earlier bricked box that
  was wiped, and a box that failed three starts on 2026-09-26. See
  [ci-and-gates.md](docs/developers/ci-and-gates.md).

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
- **Resolve live content and receipt snapshots separately.** Filtering snapshots by enabled content
  languages hid recorded names. See [conventions-ui.md](docs/developers/conventions-ui.md).
- **Each surface shows ONE of a product's three names — staff, customer-facing or kitchen — and a
  fixture gives the three DIFFERENT text**, or the test passes whether the surface reads the right
  name or the wrong one. Cost: a report reading the diner's wording, recorded above the fixtures in
  `packages/reporting/src/top-sellers.test.ts`. Which surface reads which:
  [products.md](docs/developers/products.md).
- **A replay reports the original transaction facts; side effects are gated separately.** Cost: cash
  change returned as zero on a retry, because displaying change was treated as dispensing it.
- **Compare saved selections by values — not by JSON key order, not by the order they were sent, and
  not by the order they were OFFERED in either.** The offered order reads as fixed and is a stored
  position a save re-numbers. Cost: a quantity-only held-order edit deleted every line, re-issued it
  under a new id and re-priced the dish. Then: a comparison that cannot see which LIST a stored row
  came from bills a moved pick at the other list's price. Guard: the quantity-only held-order edit
  case in `apps/server/src/working-order.test.ts`; both receipts in
  [conventions-ui.md](docs/developers/conventions-ui.md).
- **A screen puts a refusal beside a field by what the error CARRIES, checked where it is thrown.**
  `product.invalid` names a `field`; `content.translation_required` names only a LANGUAGE, and one
  product save submits several translated values. Cost: the product editor mapped `params.field`
  alone, so the one refusal its own translated inputs produce stayed folded away with focus on Save.
  See [conventions-ui.md](docs/developers/conventions-ui.md).
- **A successful write followed by a failed refresh is a load failure, not a failed save.** Close the
  editor after the write succeeds, then refresh separately — a retained create form invites a
  duplicate submission.
- **Automatic dashboard reads are passive session activity.** Use the shared query controller or the
  request primitive's `passive` option, or polling keeps an unattended dashboard signed in. Observer
  callbacks assign snapshots; they do not rerun loaders that reset drafts. The Backups screen's
  status watcher asks for a recovery key at most once, only while the screen has made none, and
  shares a request already in flight, so a refresh never replaces a key the screen made.
- **A background API client does not make POST requests passive.** Only GETs are marked passive;
  automatic pairing renewal uses its own authenticated route.
- **Dashboard subscription names travel with their server sources.** A rejected subscription closes
  the whole tab's stream, so a misspelled name breaks other screens too. Guard:
  `scripts/live-subscriptions.test.ts` — it catches unknown names, NOT missing SQL dependencies or
  disabled-module combinations.
- **The dashboard banner is persistent identity chrome** — top of the page, full width, the tenant's
  legal name (not a location). The account menu (a person-icon `wt-row-actions` popover holding
  Account settings and Log out) sits at the trailing edge only when a session exists.
- **The dashboard matches the browser's `Accept-Language` when no language is saved.** Guard against
  a late locale response overwriting an authenticated person's language or an explicit choice.
- **Dashboard login offers methods without revealing account enrolment.** Never query account status
  or passkey enrolment to choose the public screen. A modal passkey prompt requires an explicit
  action: navigation, refresh, logout and session expiry never open one. Save the authenticated email
  and the successful method only with Remember selected, never in tab storage.
- **Markup a screen hands to `wt-data-table` as a cell is styled with `part=`/`::part()`, never a CSS
  class.** The cell's nodes live in the TABLE's shadow root, so the screen's own class rules reach
  nothing and the element renders unstyled while every attribute assertion still passes. Cost: the
  categories screen's colour swatches, thumbnails and ancestor-row muting never rendered at all,
  through review and a green suite. See [design-system.md](docs/developers/design-system.md).
- **A Lit `<select>` whose `<option>`s come from a `${…}` expression marks the chosen option with
  `.selected`; a `.value` binding alone runs before those options exist and the dropdown shows its
  first option.** Nothing guards it. Cost: a restored `wt-data-table` filter hid rows while its
  dropdown read "all". See [conventions-ui.md](docs/developers/conventions-ui.md).
- **Every colour, spacing, radius and font reads a `--wt-*` token.** No hex, no named colours, no
  `rem`/`em`. Guard: `packages/ui/src/no-hardcoded-chrome.test.ts`, which scans `packages/ui`
  components; [design-system.md](docs/developers/design-system.md) states the rule for any component
  or view, which is the wider scope a reviewer should apply.
- **A new `wt-*` primitive needs two specific tests**, not "some tests": a token-painting test, and an
  axe accessibility test in a sibling `*.a11y.test.ts` covering each distinct state in both themes.
- **Custom events are named `wt-*`, carry `detail`, and are dispatched `bubbles: true, composed: true`
  — and the triggering event is stopped with `event.stopPropagation()` before re-emitting**, or the
  consumer observes the change twice.
- **A retained hardware registration must remain re-addable after deactivation.** Discovery matches
  disabled records too; the dashboard offers them as Add again and reactivates the existing id.
- **A narrower roll in a wider receipt printer needs an explicit print area before native centring.**
  Native centring without `GS L`/`GS W` shifted and clipped a 58mm receipt on the owner's printer.
  Guard: `apps/server/src/receipt-ticket.test.ts`; see [conventions-ui.md](docs/developers/conventions-ui.md).
- **The hardware transport seam is `@waitron/print-agent`, and it is database-free.** It imports no
  other package in this repo, and `@waitron/printing` depends on IT, never the reverse. The guard is
  the `import-x/no-restricted-paths` zone in `eslint.config.js`, not the empty `dependencies` block.
- **A container that must reach a hot-plugged USB printer mounts `/dev:/dev:ro`**, plus
  `device_cgroup_rules: ["c 180:* rwm"]` and `group_add: ["7"]` — not a `/dev/usb` subdirectory bind
  and not a hard `devices:` line.
- **The unauthenticated recovery page's title and action are fixed strings chosen by the error
  code; its log tail shows the failed start's own lines — the error, its cause chain (up to five
  levels in all), the stack and an `AppError`'s params — through `redactSecrets` and
  HTML-escaped** (owner decision 2026-09-26: a failure the page could not show took `docker logs`
  to diagnose, which the operator cannot read).
  The code, `lastFailureAt` and the log file's lines are the text from outside the image; the log
  file's `redactSecrets` masks only a password in a URL, which is why no code's params and no
  logged message may carry a secret. See [conventions-ui.md](docs/developers/conventions-ui.md).
  The shared package also runs `packages/ui-core/src/no-hardcoded-chrome.test.ts` and
  `packages/ui-core/src/tap-target-and-focus.test.ts` directly over its own controls.

### Data, modules and migrations — [conventions-data.md](docs/developers/conventions-data.md)

- **Default optional request fields only when absent, and check enum types before comparing values.**
  Explicit null and coerced arrays passed modifier validation. Regression: the two
  `refuses an explicit null where a default is only taken on absence` cases, in
  `packages/catalogue/src/extra-contract.test.ts` and `packages/catalogue/src/option-contract.test.ts`
  — each proven by widening `=== undefined` to `== null`. One field is deliberately outside the rule
  and pinned separately: an extras list's `maxPicks` null MEANS uncapped.
- **Error codes name the DOMAIN CONCEPT, never the throwing package** — `series.not_found`, not
  `db.series_not_found`. **Never renamed once shipped**; deprecate and add a sibling. `server.*` is
  reserved for facts about the process itself. Every file that throws a code imports its registry.
- **A recorded incident code needs an area claim and English and Spanish alert wording.** Guard:
  `scripts/alert-codes.test.ts`, which reads only double-quoted, one-dot, lowercase-and-underscore literals
  in hand-listed files and counts a code recorded even if production never raises it; more: [conventions-data.md](docs/developers/conventions-data.md).
- **Spanish domain terms are deliberate, and a module declares its own.** One declaring home per word;
  a fiscal term never goes in the base list. Guard: `scripts/english-only.test.ts`. `apps/*` is out of
  scope by a recorded decision, so Spanish identifiers in app UI code are caught only by review.
  **A `/*` inside a `//` comment breaks it and blames the wrong lines** — a glob path such as
  `drizzle/meta/` followed by `*_snapshot.json` opens a block comment as far as its scrubber is
  concerned, which then blanks everything to the next real `*/` and reports Spanish words in
  UNRELATED comments hundreds of lines further down. Reword the path; the reported lines are not
  the offender.
- **The composition list lives in `@waitron/composition`, and it is the only place that names every
  module.** Generic code reaches the regime through the descriptor's `provisioning` and `fiscal`
  seats. The boundary is the swappable SLOT, not "any module". Guard: `scripts/module-seams.test.ts`
  (root project, reads text)
  — shrink its allowlist, never grow it. `@waitron/dashboard-modules` is the browser-side twin.
- **A test-only dependency closes a workspace dependency loop as surely as a runtime one.** A suite
  needing packages from both ends of a loop goes in a package nothing depends on. Guard:
  `scripts/workspace-cycles.test.ts` — it reads each `package.json`, not pnpm's own graph.
- **A new product domain lands as a MODULE, not as new code in the core**, filling the contract seats;
  generic code never learns it exists.
- **A country pack is a browser-safe preset over modules, not a module.** Packs name contribution ids
  as strings and never carry an external-provider credential. Setup derives geography-dependent values
  in the browser and repeats the derivation at the server boundary.
- **A command name is declared under `waitron.commands`, never `bin`.** Nothing builds at install
  time, so a `bin` under `dist/` is never linked by the install that reads it.
- **A change adding third-party code or a binary to the image carries its licence notices, shipped
  in `/app/third-party/`** (owner, 2026-09-24). Cost: Litestream shipped without its Go modules'
  notices. Guard: the third-party blocks in `scripts/deploy-image-env.test.ts`, weaker than their
  name — they read text, cover libvips and Litestream only, and for Litestream compare the version
  line, not the module list. Receipt: [conventions-data.md](docs/developers/conventions-data.md).
- **`@waitron/db`'s `exports` map is enumerated, not a wildcard**, so `apps/server` cannot deep-import
  its `errors.ts`.
- **Never build SQL by string concatenation — except where the engine takes no bound value**: an
  identifier, and the body of a generated trigger. For those, either escape
  (`quoteIdent`/`quoteLiteral`, as the change feed does with each source's type,
  `packages/db/src/change-feed.ts`) or validate and throw (as the append-only installer does with
  each table name, `packages/store/src/append-only.ts`). Neither is not acceptable; "the callers
  only pass safe values" is the §1 defect class.
- **A `sql` scalar subquery correlated to the OUTER query's table breaks silently when that table is
  the `.from()` base rather than a join** — no error, a wrong answer. Check base-vs-join and READ the
  emitted SQL with `.toSQL()`.
- **An untargeted `.onConflictDoNothing()` absorbs EVERY unique conflict, not only the primary
  key's.** Name the target when the table has more than one unique constraint and the code reads an
  empty result as a specific cause. Untargeted calls remain in the tree and nothing guards this.
  See [conventions-data.md](docs/developers/conventions-data.md).
- **Rewriting rows one at a time inside a transaction can break a unique index the FINAL state
  satisfies.** Two items swapping products were refused midway through — on this engine
  `UNIQUE constraint failed: <table>.<column>`, errcode 2067. Replacing the set — delete then
  insert — needs the `REFERENCES` grep first: nothing outside the table may hold a key into it. The
  writers are already serialised: one write transaction at a time per file, because
  `withTransaction` IS `withWriteLock` (`packages/db/src/tenancy.ts`). See
  [conventions-data.md](docs/developers/conventions-data.md).
- **Resolve shared catalogue data once before a basket's line loop.** Never await a zone, product or
  variant read per line. Guard: `apps/server/src/working-order.test.ts` (one zone snapshot, no
  per-line resolver).
- **The tables `scripts/write-path-tables.json` lists — `tenants`, `nodes`, `deployment`,
  `mirror_config`, `node_roles` — request code may read and never write, and the database does not
  refuse the write.** The engine is a
  file with no roles or permissions, so the guard below is the whole of the enforcement. A write of
  one of them belongs on a path that opens the store deliberately for it, never on the handle a
  request is served on. Guard: `scripts/write-path-tables.test.ts`, weaker than its name in three
  ways its own header states — it reads TEXT, so a table name reached through a variable is
  invisible to it; it judges a FILE against an allowance list rather than a call chain, so a request
  path that calls into an allowed file writes through it unseen; and it walks `<member>/src` under
  `apps` and `packages` alone, so a package's `test/` directory and `apps/<app>/scripts` are outside
  it.
- **Multi-table writes share ONE transaction, and `withTransaction` IS that transaction.** Write-path
  functions take a `tx: Transaction` and never open their own; a route handler opens exactly one
  `withTransaction` per request. This is a convention, not a compiler guarantee — `Database` is assignable
  to `Transaction`. **Splitting one logical change across transactions is a commented decision, never
  a default.** **Queries on one transaction are awaited in turn, never `Promise.all`** — this engine
  is synchronous, so two statements issued together run one after the other in an order nothing
  states. Measured
  2026-09-22: two reads and two `create table`s issued with `Promise.all` inside one
  `withTransaction` all completed, so the hazard is ORDER, not loss. No guard enforces it.
- **A read taken while ANOTHER caller's write transaction is open sees committed rows only.** The
  store opens a read-only connection per file beside the single writer and routes by ASYNCHRONOUS
  CONTEXT and per-body identity, so a read written inside the body still sees that body's own rows
  (`packages/store/src/connections.ts`). Three shapes are outside the rule and each is stated at its
  site: a transaction opened by RUNNING `begin`, a write issued from outside a running body, and a
  statement that changes a CONNECTION rather than the file — a temporary table, an `ATTACH`, a
  connection-scoped pragma — which a read-only connection does not refuse. Cost: the flip landed one
  connection per file and a concurrent read returned rows a rollback then removed; then keying the
  routing on the engine's own `isTransaction` instead reddened most of `packages/db`'s suite,
  because Drizzle's migrator runs `begin` as an ordinary statement. Guard: the routing cases in
  `packages/store/src/index.test.ts` and `connections.test.ts` — weaker than the set looks, because
  not every case in it fails when the routing is deleted. See
  [conventions-data.md](docs/developers/conventions-data.md).
- **A statement this engine refuses backs out ITSELF, not the transaction around it** — so catching
  a refusal and carrying on in the same `tx` is safe. Measured 2026-09-22 on `node:sqlite` (Node v26.7.0): inside one
  transaction a duplicate key (errcode 2067), a null in a `not null` column (1299) and an
  append-only trigger's `raise(abort)` (1811) each left the transaction usable and the rows written
  beside them committed. The nested `tx.transaction(...)` in each `appendToChain`
  (`packages/fiscal-verifactu/src/chain.ts`, `packages/workforce/src/chain.ts`) stays for a
  different reason, stated at each site: it confines a losing attempt's own writes. The ones in
  `enqueueSuccessor` (`packages/scheduler/src/store.ts`) and `insertClose`
  (`packages/reporting/src/record-daily-close.ts`) wrap one insert, which the engine backs out by
  itself when refused, so today they confine nothing. **A TEST still catches such a
  refusal OUTSIDE the transaction**, around the whole `withTransaction`, and no guard enforces that.
  Receipt: [conventions-data.md](docs/developers/conventions-data.md).
- **One process owns a venue folder at a time.** `openVenueStore` holds `venue.lock` (a SQLite
  `begin immediate`, released when the process dies — measured with `SIGKILL`) and refuses a second
  PROCESS at once with `VenueInUseError`, which `@waitron/db`'s `openVenueDatabase` and
  `lockVenueDatabase` turn into `provisioning.database_in_use`; opens inside one process share the
  hold. A tool documented to run beside the server passes `exclusive: false`; a command that changes
  the folder's files takes `lockVenueDatabase` before its first change. Never unlink `venue.lock`.
  The server's own Litestream child also opens `venue.db` and takes no lock; the server stops it
  before the store closes. Every holder also writes `venue.holder.json`, and a watchdog thread,
  while it runs, SIGKILLs the process about `WATCHDOG_KILL_MS` (two minutes,
  `packages/store/src/venue-liveness.ts`) after its main thread's last timer turn. An entry point
  names itself with `setVenueHolderIdentity` (`packages/db/src/venue-holder-identity.ts`); nothing
  checks that a new one does. Guard: `packages/store/src/venue-lock.test.ts`, weaker than its name —
  it proves the lock, not that each caller takes it, so a caller passing `exclusive: false` wrongly
  is seen by nothing. Every change to `recovery.json` goes through `updateRecoveryState` under
  `recovery.lock`; never unlink `recovery.lock` either. Guard:
  `apps/server/src/recovery-race.test.ts`, weaker than its name — it proves the lock, not that every
  writer of the file takes it. Receipt:
  [conventions-data.md](docs/developers/conventions-data.md).
- **A duty `bootServer` starts pushes its stop onto `undoOnFailure` as soon as it exists, before
  the next step that can throw** (`apps/server/src/boot.ts`), or a failed start leaves it running on
  a store the unwind has just closed. The landing listener, started last, is the one step not on the
  list. Guard: `apps/server/src/boot.failed-start.test.ts`, weaker than its name — it covers only
  the duties it names, so a new one that forgets is seen by nothing, and it does not observe the
  ORDER (work stopping before the store closes) or that the waits finish before the store closes:
  removing `await loop` or `liveEvents.close()` from the undos still passes. Receipt:
  [conventions-data.md](docs/developers/conventions-data.md).
- **There is no tenant column. The taxpayer is the one row in `tenants` (id = 1, singleton check); a
  query that wants "this tenant's rows" reads the table.** (2026-09-14, spec
  [2026-09-14-drop-tenant-id-design.md](docs/superpowers/specs/2026-09-14-drop-tenant-id-design.md).)
  This retired two rules a reader may still meet in older text — that a by-id read needs its own
  tenant clause, and that a configuration route compares `authorizeManager`'s tenant with the
  configured one; both are marked superseded in
  [conventions-data.md](docs/developers/conventions-data.md). Guard:
  `scripts/no-tenant-column.test.ts`, which is weaker than its name in three ways, among those its
  own header states — it matches the column's SPELLINGS, so a column reintroduced under an unrelated name
  passes; it does not read test files; and it exempts, whole, each of the core migration files that
  historically carried the column, so a column re-added inside one of those is seen by nothing.
- **`packages/db/src/schema/columns.ts` is the only file that names the engine's column and table
  types.** A table declares `id`, `money`, `label`, `table` and the rest from there, never `text()`
  or `integer()` straight from `drizzle-orm/sqlite-core`, so the NEXT engine change replaces one
  file rather than every column in the tree. One scoped exception: `text` in
  `packages/fiscal-verifactu/src/schema/registros.ts`, whose two amount columns store the bytes the
  huella hashed. Guard: `scripts/column-vocabulary.test.ts`, weaker than its name — it reads the
  IMPORT or re-export line as text, so a builder reached through `import * as` is invisible to it,
  and it forbids only the builders the vocabulary ITSELF imports, so one it does not — `blob`, a
  real `drizzle-orm/sqlite-core` column builder — is in no forbidden set and passes anywhere
  (measured 2026-09-23: a file importing `blob` and a file importing `text` added side by side
  under `packages/fiscal-verifactu/src`, and the guard reported only the `text` one). A builder the
  vocabulary STOPS importing would leave the set the same day; the hand-written list that holds
  such a name forbidden sits beside the derived one, and it is empty.
- **A money column holds a count of whole cents, and the conversion happens AT THE ROW**
  (`packages/shared/src/cents.ts`: `decimalToCents` in (`stringToCents` when the value is still a
  decimal string), `centsToDecimal` out, `rawCentsToDecimal` for a raw-SQL read of an AMOUNT, which
  casts the expression `cast(x as text)` — this engine has no `::` operator, and an uncast integer
  arrives as a JavaScript number, which that reader refuses). Above the row every amount stays the
  exact `Decimal`. A money total summed out of JSON is summed in JavaScript at the money scale,
  because this engine has no exact decimal type (`packages/reporting/src/vat-summary.ts`). **Nothing guards the boundary itself, and there is no
  LOUD form of getting it wrong.** A money column is a plain
  `integer` column with no strictness, so every one of these is accepted, measured 2026-09-22 on
  `node:sqlite` (Node v26.7.0), bound parameter and raw SQL alike: `25.00` and `"25.00"` store the
  integer 25, `"21.50"` stores the REAL 21.5, and `"abc"` stores the text `abc`. Guards, both
  narrower than their names:
  `packages/db/src/schema/columns.test.ts` (`money` and `bigCount` emit the SAME SQL type, so only
  its read-mode case separates them) and `packages/shared/src/conventions.test.ts` (reads
  `cents.ts` as TEXT, and nothing outside `packages/shared/src`, so a second file crossing into the
  number type is seen by nobody). Receipts:
  [conventions-data.md](docs/developers/conventions-data.md).
- **A quantity column counts whole thousandths and a rate column whole basis points; neither is the
  money scale** (`packages/shared/src/scales.ts`, beside `cents.ts`, with the same two raw-SQL
  readers and the same cast-to-text rule). A blanket "every numeric becomes cents" does not EMPTY a
  quantity, it misreads one — `decimalToCents` rounds the third place rather than dropping it, so
  0.005 kg is the count 5 at the quantity scale and the count 1 at the money scale. The converters
  hold the bound — nine integer digits for a quantity, three for a rate — because an integer column
  does not enforce them; the raw quantity reader reads totals, so like the money one it bounds only
  at what a number counts exactly. The
  money rule's two guards and both its hedges apply unchanged, and `quantity`, `money` and
  `bigCount` are all `integer(name)`, so only the caller separates them. A rate's CHECK constraint
  is written against 10000: one written as `rate <= 100` refuses every rate above one percent. Guard: the shared schema-conformance suite,
  `packages/db/src/testing/schema-conformance.ts`, which a migration set opts into with a small call
  site — `ls packages/*/src/schema/schema-conformance.test.ts` says which sets have one, and a set
  with none is unguarded. `scripts/claude-md-pointers.test.ts` cannot keep this sentence honest: it
  checks only that a backticked path exists on disk, which the old pointer still did after the
  machinery moved out of it.
- **The database never rounds a quantity — `decimalToThousandths` owns the third place.** The
  column stores what the converter already decided, so no SQL rounding stands behind it and a test
  asking storage to round is testing something no product path does — this engine has no exact
  decimal type. Receipt: [conventions-data.md](docs/developers/conventions-data.md).
- **A new table is classified `ledger`, `state` or `local` in its module's `<MODULE>_CLASSIFICATION`
  list, and a table that must never be corrected is declared with `appendOnly()` instead of
  `classify()`** — `applyMigrations` turns those declarations into a `RAISE(ABORT)` trigger pair
  after each set migrates (`installAppendOnlyTriggers`, `packages/store/src/append-only.ts`), so
  every migrating path installs them and none can forget. **The CLASS is not the trigger set.**
  Nine `ledger` tables are updated or deleted by ordinary product code — `payments` records a card
  payment's progress, `cadenas` and `workforce_chains` hold chain heads — and `order_amendments` is
  `state` and must still refuse both; deriving the triggers from the class refused a card capture
  and left an amendment rewritable, measured 2026-09-22. It needs `PRAGMA recursive_triggers`,
  which the store turns on: without it `INSERT OR REPLACE` rewrites a protected row silently, while
  the other three mutation shapes are refused either way — so a suite that omits the replace case
  passes with the hole open. What a trigger cannot refuse is `DROP TABLE`: SQLite has no trigger
  event for it. Guards, on a new table:
  `scripts/classification-complete.test.ts`, `scripts/append-only-triggers.test.ts` — which migrates
  a real database through `applyMigrations` and then tries a plain `UPDATE` and `DELETE` on every
  declared table, and leaves the other two shapes to `packages/store/src/append-only.test.ts`, where
  a conflicting key is available.
- **A streamed `venue.db` holds two tables no migration created, and its folder a directory no
  store opened.** Litestream adds `_litestream_seq` and `_litestream_lock` to the database it
  streams, a restore of the stream carries both, and it keeps `.venue.db-litestream/` beside the
  file; a freshly migrated database has neither. Code that lists a live or restored database's
  tables, or that empties, copies or restores the venue folder, must expect them; no guard finds a
  new site that does not. Receipt: [conventions-data.md](docs/developers/conventions-data.md).
- **A `local` row belongs to one node, so no foreign key may join a `local` table to a
  `ledger`/`state` one, in either direction.** Every table is in `venue.db`, which a primary streams
  whole to the owner's bucket once one is set up (slice-2 spec §2); `node.db` is reserved and empty, and a key across the classes would stop
  a later slice moving `local` tables into it. A `local` row that needs a venue row keeps the plain
  id and names, at the column, what establishes the target exists — or that nothing does, and where
  the refusal moved to. Guard: `scripts/two-file-foreign-keys.test.ts`, weaker than its name — it
  reads drizzle's GENERATED snapshots, so a key added only in hand-written migration SQL is
  invisible to it; one declared in TypeScript but not yet generated fails
  `scripts/migrations-match-schema.test.ts` instead. Cost of the shape it replaced: six such keys
  existed and nothing would have failed at the flip; see
  [conventions-data.md](docs/developers/conventions-data.md).
- **A `local` table says what ties a row to its node** — a `node_id` column that every read and
  write names (`node_roles`, `mirror_config`, `join_requests`, `node_sealed_state`), a seal only that node's key opens
  (`tenant_credentials`), or rows the transaction that wrote them deletes (`change_log`). A node
  holding another node's copy of `venue.db` must read its own rows or none. No guard makes a new
  `local` table say which. Which node filters a deletion pins:
  [conventions-data.md](docs/developers/conventions-data.md).
- **Anything that works as a live login is stored as a hash, because a primary streams the whole
  database to the owner's bucket once one is set up.** The dashboard and till session cookies carry a random token and the row
  keeps its SHA-256 (`hashSessionToken`, `@waitron/identity`), as pairing tokens and the Google
  sign-in state already did: reading the bucket must never let anyone into the live box. Guards,
  weaker than the rule: the "what a copy of the database holds" cases in
  `apps/server/src/me-api.test.ts` and `apps/server/src/till-api.test.ts` present the row's id
  alone, and only the dashboard's stored hash is tried as a token
  (`packages/identity/src/management-session.test.ts`); a new login table is seen by nothing.
- **A module depends on another migration set when its SQL `REFERENCES` one of that set's tables,
  puts a `CREATE TRIGGER … ON` one of them, or names one inside a trigger's body — and its
  descriptor's `requires` must name it.** `packages/media/drizzle/0001_image_references.sql` has
  triggers on tables core and catalogue create, and others whose bodies read them. Guard:
  `scripts/module-graph-honesty.test.ts`, weaker than its name — it reads SQL as TEXT and never reads
  a trigger's BODY, so a table named only between `BEGIN` and `END`, read or written, is an edge
  nothing checks. The engine will not catch it either: measured 2026-09-23 on `node:sqlite` (Node
  v26.7.0), a trigger whose body names a missing table is created without complaint and fails only
  when it fires, with `no such table`. Cost: the first `requires` graph was derived from `REFERENCES`
  alone and missed two edges made by triggers ON another module's tables, caught by hand in review. See
  [conventions-data.md](docs/developers/conventions-data.md).
- **No new table enters the core migration set without a stated reason in the commit.** A domain
  table a module owns belongs to that module's own set, where its append-only classification
  travels with it — `applyMigrations` installs each set's triggers from the `appendOnlyTables` the
  module declared.
- **A constraint that lives only in hand-written migration SQL is one regeneration away from gone,
  and nothing else in the tree notices.** Declare every foreign key and every unique index in the
  TypeScript schema, so `drizzle-kit generate` carries it; where one genuinely cannot be declared,
  say at the column what it cost and where the refusal moved to. Cost: regenerating the thirteen
  sets for the storage switch dropped 33 foreign keys and 13 unique indexes, so an insert naming a
  `device_profile_id` that exists nowhere was accepted and stored the dangling id; the first thing
  that would have failed was a route test several step groups later. Guard:
  `scripts/schema-constraints.test.ts`, weaker than its name in ways its header states — it reads
  the schema the migrations BUILD rather than trying an offending insert, so it cannot tell a key
  SQLite records from a key SQLite enforces, and it matches a unique index by NAME, so an index
  whose columns changed under a kept name passes.
- **A drizzle migration-number collision on rebase is fixed by regeneration, never by hand-editing the
  snapshots or `_journal.json`.** Reset the migrations dir to main's state, regenerate, and verify by
  RUNNING `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/migrations-match-schema.test.ts` and `inmutabilidad` — the first two because a regeneration is exactly what has dropped constraints and
  triggers declared outside the TypeScript schema before.
- **A drizzle table rebuild on this engine runs with foreign keys ON, so its `DROP TABLE` silently
  deletes every cascading child's rows, and fails on a `no action` or `restrict` child holding rows.**
  Drizzle rebuilds a SQLite table to change a column's nullability, and the `PRAGMA foreign_keys=OFF`
  it generates does nothing inside the migrator's transaction. Before shipping a rebuild, list the
  foreign keys that point at the table. Cost: the variants plan's `products` rebuild emptied
  `product_categories` on a scratch venue without the media triggers, and its `menu_items` rebuild
  emptied three menu tables while reporting success or, once the venue had sold from a menu, refused
  to run. Receipt: [conventions-data.md](docs/developers/conventions-data.md).
- **A foreign key whose target has no unique index is refused at the first WRITE, not at migrate
  time.** This engine creates a table naming a parent that does not exist yet, and a whole migration
  set applies clean; the first insert then fails `foreign key mismatch - "child" referencing
"parent"` (errcode 1), and it keeps failing until a unique index over the parent's columns exists.
  Measured 2026-09-22 on `node:sqlite` (Node v26.7.0), with the control: the same insert passes the
  moment the index is created. So a green migrate is no evidence a new key is sound — write through
  it. See
  [conventions-data.md](docs/developers/conventions-data.md).
- **Drizzle picks what to apply from `max(created_at)` alone**, never from a position in the journal,
  so an entry at or below a recorded watermark never runs and drizzle raises nothing. Guard:
  `scripts/journal-monotonic.test.ts`, weaker than its name today — most sets are a single baseline
  entry, which cannot be out of order, so it bites only on a set with more than one entry. A drizzle bump
  starts with `grep -rn 'dialect.js'`.
- **`applyMigrations` refuses to report success on a short set**, throwing `migrations.incomplete`
  rather than serving a half-migrated schema.
- **The box's BOOT path and the bucket rebuild carry an ahead-of-image check; no other migrating
  path does, and `waitron.sh install <ref>` is a one-way door.** `assertNotAhead` throws
  `provisioning.database_ahead`. The GAP, stated so nobody assumes coverage: every other migrating
  path runs without the check — the cold restore from an archive, `rejoin-command` and `dev-setup`
  among them, and
  [conventions-data.md](docs/developers/conventions-data.md) holds the full list. Cost: without it an
  ahead database re-migrates CLEANLY and surfaces later as an unclassified driver error.
- **An empty value is a valid value** — to whatever receives it, so a reader must turn `""` into
  "unset" itself. An env or prompt value set to `""` falls back to its default exactly as an unset
  one does (in `apps/server`, through `isUnset` in `apps/server/src/env-value.ts`; the log folder through
  `resolveLogDir` in `packages/db/src/venue-holder-identity.ts`); a path never goes through `resolve("")`,
  which is the working directory; and a reader with no default refuses `""` explicitly, as
  `resolveVenueDir` does with `provisioning.venue_dir_missing`. See
  [conventions-data.md](docs/developers/conventions-data.md).
- **No backwards-compatibility or data-migration code until Waitron is in production.** Schema changes
  drop and recreate. This rule expires the day a real venue is live; add its replacement in the same
  change.

---

## 4. Testing

One line each; the mechanism, the measurement and the incident behind every one are in
[testing-guide.md](docs/developers/testing-guide.md). **Read it before writing a database or
browser test** — most of these rules exist because a test passed while proving nothing.

- **One target.** A suite that needs a database gets a REAL one: `useVenueDb` makes a temporary
  directory, opens it with the product's own opener, applies the migration sets it was given and
  installs the append-only triggers. There is nothing lighter to pick and nothing heavier to justify.
  Guard: `scripts/venue-db-helper.test.ts`, weaker than its name — it holds only that no `.ts` file
  under `packages/` or `apps/` names the retired helper `usePgliteDb`, not that a suite opens its
  database sensibly.
- **Don't own a database in a suite — let `useVenueDb` own it.** Raw `beforeAll`/`afterAll` only
  when the suite legitimately builds its own resource, and then guarded. Guard:
  `scripts/guarded-teardowns.test.ts`.
- **No test suite under `packages/` or `apps/` starts a container; the rigs under `bench/` do**, so
  a package suite that seems to hang is not waiting on Docker. **`TESTCONTAINERS_RYUK_DISABLED=true`
  is required locally** — Ryuk hangs on this machine — and with it off an INTERRUPTED run leaks
  containers; `pnpm reap`
  removes them by label and age — but not every rig stamps the label. Never a blanket
  `docker volume prune`, and `docker volume inspect` before any manual `rm`. Which rig is which:
  [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **The stream loop test (`apps/server/src/stream-loop.e2e.test.ts`) needs two pinned binaries:
  without them it is SKIPPED locally and FAILS in CI** — and so does the stream pause test,
  `apps/server/src/stream-pause.e2e.test.ts`. Each runs the real Litestream against
  versitygw started as a plain child process. Install both with
  `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`; with `CI=true` or
  `WAITRON_REQUIRE_STREAM_BINARIES=1` a missing one fails the case. **Vitest's default reporter
  prints a skipped run as `1 skipped` and nothing else** — the reason shows only under
  `--reporter=verbose` — so a local green run of `apps/server` may not have run them. CI runs both in
  `test-server-stream`. Guard: `scripts/ci-workflow.test.mjs`, which reads `ci.yml` as TEXT, so the
  install commands left only in a YAML comment, or in a step an `if:` switches off, pass it. See
  [testing-guide.md](docs/developers/testing-guide.md).
- **A container port-binding timeout needs Docker state as well as the container's own logs.** Save
  `docker inspect`'s `HostConfig.PortBindings` and `NetworkSettings.Ports` before removing the
  container. The live subjects are the two `bench/` rigs that start a container, both of which
  publish a port. See [testing-guide.md](docs/developers/testing-guide.md).
- **An interrupted run also ORPHANS its vitest workers**, which spin at ~100% CPU until `kill -9`.
  `pnpm reap` sweeps these, scoped by ppid 1 AND one of the two shapes vitest leaves in `ps` — a
  Vitest 3 process TITLE or a Vitest 4 entrypoint PATH — never a bare `vitest` match.
- **Concurrent coverage runs must not share a package's report directory, and an intentional second
  one belongs OUTSIDE the package.** Vitest cleans a shared directory, so two overlapping runs over
  the same package end in `ENOENT`; and a leftover directory inside the package under a non-dot name
  is measured as SOURCE by the next package run, sinking the ratio for reasons unrelated to the code.
  Inspect the resolved selection first. See [testing-guide.md](docs/developers/testing-guide.md).
- **Locate the unfinished package before diagnosing a silent shard as database contention.** A
  Vitest test timer does not bound a browser whose event loop has stopped; use an outer deadline, and
  never a retry as proof of repair.
- **A recurrent stall needs a retained log and a snapshot of whatever it was waiting on.** Locate the
  stalled operation before assigning its cause to resource contention.
- **On Vitest 4 a project's own `maxWorkers` wins, and the outer config's is only the fallback** —
  so `packages/bookings`, `payments-stripe`, `payments-sumup` and `venue-service` each set
  `maxWorkers: 1` inside a project. **A cap that must apply to every project still belongs on the
  outer config**, which a project setting none of its own falls back to. Guard:
  `scripts/fiscal-test-budget.test.ts`, weaker than its name — it pins the arrangement
  fiscal-verifactu and media chose, not how Vitest resolves the limit. Measurement (and the Vitest 3
  history this replaced): [testing-guide.md](docs/developers/testing-guide.md).
- **A package that pins one worker inside one of several projects numbers its `groupOrder`s from 1,
  never 0.** Vitest 4 lifts a `groupOrder: 0` project that runs one isolated worker out of its group
  and appends it after every other group, so a database project numbered 0 runs AFTER the browser
  project it was ordered before. Two of the lift's three conditions are DEFAULTS — `groupOrder` is 0
  when unset and isolation is on — so stating no `groupOrder` at all does not avoid it. The condition
  a package can actually be outside is the third: `packages/media` and `apps/dashboard` split into
  projects too, and are unaffected because neither pins a project-level `maxWorkers: 1`.
  Measured on `packages/bookings` against the same run on Vitest 3. Guard:
  `scripts/bookings-test-budget.test.ts` — which pins bookings alone, not the three other packages
  with the same shape.
- **A suite whose test outlasts Vitest's per-test timeout fails HEALTHY runs**, and that timeout
  defaults to 5s. It does not shorten a `spawnSync` timeout or interrupt a blocking child — the kill
  still fires — it fails the test for its duration alone. Set the bound above the longest a healthy
  test can take, which is the SUM of its waits plus its untimed work, not the largest one. **Under
  `packages/` and `apps/` the bound usually comes from the package's `vitest.config.ts`, not the
  file** — and an `expect.poll` or `vi.waitFor` is a wait like any other. Guard:
  `scripts/spawn-timeout-budget.test.ts`, which scans `scripts/` ALONE — **the rule holds under
  `packages/` and `apps/` and nothing checks it there**, so the trap returns unguarded the day a
  suite under either root waits longer than its budget. Weaker than its name over the half it does
  cover, too: it reads TEXT, cannot tell code from strings, checks only the largest SINGLE wait, and
  declines wherever a bound cannot be resolved rather than risk failing a correct file. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md).
- **A `spawnSync` timeout must clear the CHILD's own worst case, retry loops included.** Getting the
  Vitest bound right says nothing about this one: the test timeout fails a healthy test for its
  duration, while the spawn timeout KILLS the child and returns `status: null`, which reads as a
  broken test. Cut the WAIT, not the retrying (`WAITRON_SH_HEALTH_DELAY`) — which reduces the
  exposure rather than removing it, since the probes' own cost stays. **`scripts/spawn-timeout-budget.test.ts`
  does not cover this** — it reads a `scripts/` suite's own declared waits, never the child's, so
  nothing guards the rule in general. Receipt (the `deploy/waitron.sh` health-probe case):
  [testing-guide.md](docs/developers/testing-guide.md).
- **A suite's executable stubs are built ONCE per file, not once per test** — move what each case
  varies into environment variables the stub reads. It pays only where the stubs are a large share of
  the runtime, and only on macOS (no Linux penalty), so it speeds the local hook and not CI — measure
  first. Receipt (the per-file cost table, why `scripts/pre-push.test.mjs` was left alone, and how to
  prove the knobs still arrive): [testing-guide.md](docs/developers/testing-guide.md).
- **A test that shells out to `git` must clear `GIT_DIR` and its family.** Git exports `GIT_DIR` to
  every hook, so a hand-isolated fixture writes into the real repo. Run such a suite once under
  `GIT_DIR` before trusting it.
- **Browser-mode packages run vitest in real headless Chromium** — see §2 for the concurrency rule.
  Which packages those are is a property to check (`grep -l browser */*/vitest.config.ts` — two
  levels, not one), never a number to remember: the count has already gone stale once.
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
  typecheck, and a module tested only from there must be in the root `coverage.include` IF IT IS TO BE
  MEASURED AT ALL, and excluded from its own package's. **That `include` is one file-type glob plus the explicit paths added to
  it, so root-level source of another type is measured only when somebody names it** —
  `scripts/dev-server-proxy.ts` is imported by all three front-ends' `vite.config.ts` and exercised
  by `scripts/dev-proxy-config.test.ts`, and nobody named it, so it appears in no coverage table. Left that
  way deliberately, and the cost of the alternative is measured:
  [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **Prove a guard by deletion**, and confirm a negative control fails for the reason you think.
- **A proof by deletion says nothing about what the guard wrongly REFUSES, and that needs its own
  case.** Deletion shows the guard catches what it was written for; only a case in the other
  direction — the legitimate call that must still be served — shows it is not too wide. Cost: a
  write-queue re-entrancy guard written as a flag passed every case in its own file, including the
  one about queued callers (whose three callers are dispatched in ONE tick, before any body starts,
  so the flag is still false when each checks it), and turned every concurrent request in
  `packages/payments` into a 500. The distinction the flag could not make — nested INSIDE a running
  body, versus merely waiting BEHIND one — is now read from asynchronous context, and the missing
  case is the second caller in `packages/store/src/write-queue.test.ts`.
- **A proof-by-deletion belongs to the SHAPE of the code it was taken against.** Restructure that
  code and the deletion can stop failing while every test stays green — re-run the control, and move
  the proof to whatever still catches it. Cost: rewriting a job claim as one statement left
  `packages/printing`'s race suite passing with its locking clause deleted, while the suite's header
  still recorded the old shape failing. The suite that then held the proof went with PostgreSQL, and
  nothing holds it today. Receipt: [testing-guide.md](docs/developers/testing-guide.md).
- **A fixture no check reads is unverified data, and a green suite resting on it proves nothing.**
  Cost: the shared alta fixture had drifted into a record AEAT would reject, masking a real defect in
  `recordSale`; correcting it took 42 tests red-to-green across eight files and left three red that
  were the bug. When a fixture describes something an authority will judge, run the real check over it.
- **Treat "there is a test" as an unfinished sentence.** Coverage proves a line executed, not that
  anything asserted on the result. Ask which assertion would fail if the behaviour were deleted; "it
  doesn't throw" is not an answer. `pnpm --filter @waitron/ui mutation` checks this systematically.
- **Rejected writes assert the domain error code.** A database constraint error also satisfies
  `toBeInstanceOf(Error)`. The duplicate-category mutation escaped that assertion; receipt in
  [testing-guide.md](docs/developers/testing-guide.md).
- **`errors.ts` reachability is guarded once, in `scripts/errors-reachable.test.ts`.** Thirteen
  hand-copied per-package versions were deleted; six of them passed with `errors.ts` fully
  unreachable. It reads TEXT, so a `from "./errors.js"` inside a comment fakes an edge.
- **Vitest 4 ships no default coverage excludes at all.** `coverageConfigDefaults.exclude` is `[]`
  in 4.1.11 and there is no `all` key, where 3.2.7 carried a 17-entry list (`**/[.]**` among them)
  and `all: true`. What scopes a package's report now is its own `coverage.include`.
  `include`/`exclude` still replace rather than merge, and a config measuring nothing still exits 0
  with the thresholds intact, so read the per-file table rather than the exit code.
- **A package config must name its own source tree in `coverage.include`, or an untested file stops
  being counted.** Without one, Vitest 4 counts only the files a test loaded, so a file nobody
  imports is invisible rather than a zero in the denominator: it can never pull the ratio down, and
  moving code into one RAISES the percentage. Guard: `scripts/coverage-thresholds.test.ts`, which reads the configs as
  TEXT and looks for one exact string, so a config that spells the same include differently fails
  it. **That include is not anchored to the package**: Vitest 4 matches it against the whole
  absolute path and calls a file external only when it does not `startsWith` the package directory —
  no trailing slash — so a SIBLING package whose directory name extends this one's lands in this
  package's report. Cost: `packages/sync` read 81.57% statements on files belonging to
  `packages/sync-enrolment`. See [testing-guide.md](docs/developers/testing-guide.md).
- **Use the `/* v8 ignore start */` … `/* v8 ignore stop */` pair, not `/* v8 ignore next */`.**
  Measured both ways for #437 (2026-09-19) on `packages/sync-enrolment/src/migration-tables.ts` as
  it stood then, with two guard pairs (#511 later added a third), under
  `@vitest/coverage-v8@4.1.11`: with the pair the package read 2 of 2 branches and passed; with the
  same two guards marked `next` it read 4 of 6 and failed the package's branch bar. Whether `next`
  can ever work is not established — the provider's `ast-v8-to-istanbul@1.0.6` does parse `next`
  hints — but it did not here, and it fails silently, with no message naming the marker. Nothing
  guards it.
- **A page asserted as a STRING, or reached only through its API, has nothing checking that it
  renders.** An invalid CSS value, an unclosed tag, an unreadable dark-theme colour and a screen that
  throws on open all pass every such assertion. Cost: a corrupted colour value on `/setup/trust` that
  every test accepted, caught only by opening the page; and, on another branch, an image library
  that reached a green gate through review and CI and then answered 500 to the first person who
  opened it. Open it and LOOK, in both themes and at phone width. A browser-mode package has the
  harness already; `apps/server`'s string-rendered pages have none, so write the rendered string to a
  file and open it with the workspace's playwright Chromium.
- **`toMatchObject` checks only the keys you list**; a key you never list is never checked at all.
  `toEqual` is what put `memberOf` under a matcher for the first time.
- **A default you did not state is not a value you tested**, and a library default can be computed
  from the RUNNING runtime, where reading the types tells you the wrong answer. State it at every call
  site that shares it — the two ends of one ceremony drift apart while each looks right. Guard: the
  two `supportedAlgorithmIDs` assertions in `packages/identity/src/passkey.test.ts`. Receipt (the
  `@simplewebauthn/server` 14 case): [testing-guide.md](docs/developers/testing-guide.md).

Adding a database test to a new package: give it `useVenueDb` and the migration sets it needs.

---

## 5. Fiscal invariants — the unrecoverable ones

- **Printing never opens the cash drawer.** Cash settlement at a till whose receipt printer has an
  attached drawer enqueues a separate audited `drawer` job; receipt jobs are `document` jobs and contain no drawer command. Handhelds cannot
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
  need is the one node accepting sales. INTENDED: the on-site box when the internet is down, a
  promoted cloud when the box is dead (which needs the internet), box-down AND internet-down together
  being no failover — the MVP's accepted case. TODAY there is none of it: a venue has ONE node and no
  failover at all until slice 3 (2026-09-19, `docs/backlog.md` → _Replication, membership & failover —
  residuals_). The till follows the primary and never chooses
  (`2026-09-05-till-reroute-design.md` §2); only the primary sells. Fiscal submission is an outbox,
  never inline.
- **The bucket stream is external too: it never blocks a sale and never fails `/health`.** A copy
  fifteen minutes behind raises `backup.stream_behind`, unless a stopped, refused or
  unusable-settings alert already explains it (`apps/server/src/alert-sources.ts`). The side file is bounded by stopping
  Litestream at a size limit (`backup.stream_paused`) and then folding the file back; that
  checkpoint takes its turn in the write queue with no busy wait (`checkpointTruncate`,
  `packages/store/src/index.ts`), so a sale can queue behind it but never waits on the bucket. Guards,
  narrower than the rule: `apps/server/src/stream-pause.e2e.test.ts` freezes the bucket, then times
  the sales of three concurrent sellers on one till session through the server's own route against
  a bound while the side file passes a 16 MiB limit, the server folds it back and the pause holds —
  it does not observe whether a sale's write waited behind the fold-back rather than landing
  before it, nor time the fold-back of a 256 MiB file; the frozen-server stage of
  `apps/server/src/stream-loop.e2e.test.ts` records its sales through `recordOneSale`, a second
  store with its own write queue; both are skipped locally without their binaries (§4); the
  bucket-copy cases in `apps/server/src/health.test.ts` hold `/health`.
- **`registros_facturacion` is immutable**: it is the table declared `appendOnly()`
  (`packages/fiscal-verifactu/src/classification.ts`), so `applyMigrations` puts a `RAISE(ABORT)`
  trigger on its updates and its deletes. Do not work around them; a value written wrong there stays
  wrong. That trigger pair is the WHOLE of the enforcement — the engine has no permissions, and a
  `DROP TABLE` is refused by nothing at all.
- **Never put our own metadata into a hash.** `entorno` is ours, not AEAT's; a test pins that two
  records differing only in it hash identically. In `computeHuella` it would make every chain
  unverifiable under the other environment.
- **Re-registering a node starts a new chain** and mints a fresh installation number. Correct for a
  reimaged box, destructive for a working one. A cold restore (`waitron-restore`) does it
  automatically for a node that was filing, and so does a rebuild from the bucket
  (`waitron-restore restore --from-bucket`, or the setup wizard's "Restore from my bucket"), which
  places its copy through the same path — one restore takes one source, never both, or one event
  would mint two installation numbers. It floors the installation counter by the clock (the counter is in
  the backup, so an older artifact would otherwise re-mint a number a previous restore used), retires
  the node's invoice series and opens disjoint ones, and writes the box's identity only after that
  commits — `docs/superpowers/specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md`. UNLIKE the
  fiscal chain, the working-time chain is NOT reset on a cold restore — it continues from the backup's
  head, because the fiscal reset exists to mint a fresh SIF for AEAT and the working-time record has
  no equivalent. A survivor's forked row is refused by the chain-position unique index
  (`time_entries_chain_position_uq`, reported by this engine as
  `UNIQUE constraint failed: time_entries.node_id, …`, errcode 2067 — it names the COLUMNS, never
  the index) however it reaches the database; nothing
  carries rows between nodes today. Guard:
  `packages/workforce/src/restore-continuation.test.ts`.
- **On a node that files, every start puts each sale left "being sent" back to waiting before its
  first filing pass** (`resetInFlightClaims`, `packages/fiscal-verifactu/src/drain.ts`, run by
  `resetBeforeFirstDrain`, `apps/server/src/restart-reset.ts`) — safe only while no second process
  files from the database: the server opens the folder exclusively (`provisioning.database_in_use`),
  and the tools that open it with `exclusive: false` file nothing. Guards:
  `apps/server/src/restart-reset.test.ts`, which holds that the reset runs before the first pass,
  and the case in `apps/server/src/boot.test.ts` that returns a previous run's in-flight claim to
  `pendiente` on a start's first pass — weaker than the rule, because nothing checks that a tool
  opening the folder with `exclusive: false` never files.

---

## 6. Workflow

The commands, the dev stack and the receipts are in
[workflow-guide.md](docs/developers/workflow-guide.md). **Model selection is not a waitron rule** —
it lives in the global `~/.claude/CLAUDE.md` and is shared by every repo. In short: every Claude
seat — brainstorming, driver, dispatched seats, reviews and the campaign runners — runs on the
default model, Opus 5.5 with the 1M window at high effort (`xhigh` only when a task needs it), with
no per-task model pin and no Fable (owner decision 2026-09-23); and Codex holds one seat when Claude
drives. When CODEX drives, the roles reverse and Codex implements — so establish who is driving
before treating an implementation as a rule violation.

- **Never commit directly to `main`.** Feature work happens in a worktree
  (`python3 ~/workspace/tools/worktree.py new waitron <branch>` — not a plain `git worktree add`,
  which `/land-branch` cannot tear down). Name the branch right at creation.
- **A `docs/`-only change is exempt from the PR ceremony**: branch, `commit -s`, fast-forward `main`,
  push direct. A ROOT `CLAUDE.md` or `README.md` is format-checked and takes the normal flow.
- **Every commit needs `git commit -s`.** **A PR that goes `BEHIND` is not rebased for that alone**
  (owner decision 2026-09-05): if what `main` gained is documentation, or code only in files this
  branch did not touch, land it with `gh pr merge --squash --admin` — which bypasses the up-to-date
  requirement and NOTHING else, never a failing check or an open review. Rebase only for `CONFLICTING`,
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
  `/land-branch` runs `pnpm install` after the pull; run it yourself after any other pull. An
  untracked file there can block the post-merge `git pull --ff-only` — diff it before deleting.
- **Before a PR, run focused behavior checks, then `/finish-branch`.** Let the normal hook run
  the §2 local checks once and CI run mandatory package tests and coverage. Verify the current-head
  CI scope and results; no whole-workspace local run is required solely to finish the branch.
- **Development and loopback-only servers must not advertise the appliance's LAN name.** A laptop
  and box both answered `waitron.local`, sending some lookups to the laptop. Guard:
  `apps/server/src/mdns.test.ts`; receipt in [workflow-guide.md](docs/developers/workflow-guide.md).
- **The dev stack from a worktree is started with `wa-wt demo <worktree-name>` or
  `wa-wt onboarding <worktree-name>`**, never a bare `pnpm dev*` — compose names its project after the
  directory, so an unqualified `docker compose up` starts a SECOND `mailpit` fighting for the fixed
  1025 and 8025 ports.
- **The dev venue is a directory of SQLite files on the host, shared by every checkout and seeded,
  and moving between worktrees on the same target does not wipe it — so a branch's migrations can
  fail on the rows already in it.** Migrations carry no data-preservation code (§3);
  `wa-wt reset demo <name>` rebuilds it, and boot points at that conditionally
  (`migrations.dev_constraint_violation`, `WAITRON_ENV=dev` only). Detail, including what that line
  may NOT claim: [workflow-guide.md](docs/developers/workflow-guide.md). Cost: repeated dead boots
  with only a driver stack trace to read.

**Docs.** `docs/backlog.md` answers "what should I work on?" — read it before starting anything
unprompted, and **update it in the same change that makes it stale** (the moment it goes stale most
reliably is a MERGE). Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`,
both committed deliberately because a plan doubles as an operator's runbook. Session handoffs in
`docs/handoffs/` are gitignored — never open a PR for one. Historical docs record what was true when
written: add a dated pointer rather than rewriting them. The legal track is separate, in
`docs/compliance/action-plan.md`.

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
`scripts/claude-md-pointers.test.ts` fails if a topic file goes missing or if a path it names does
not exist — every markdown link, and backticked paths under
`apps/`, `packages/`, `docs/`, `scripts/`, `deploy/`, `bench/`, `.github/` or `.husky/`. It does NOT
check a root-level filename such as `eslint.config.js`, nor a bare directory: the guard is narrower
than "every pointer", which is exactly the hedge the rule above asks for.

**Do not add:** one-off bugs with no reusable shape, anything the code or types already state plainly,
or the narrative of what a session did — that belongs in the commit or the PR thread. **A count is a
receipt that goes stale**, so describe the property, not the number. **If a guard enforces the rule, name the
guard and stop** — do not also explain what the guard checks, because the failing test says that
better and never goes stale. **The exception is a guard that is WEAKER than its name suggests**: one
that reads text rather than running code, or that covers only part of what a reader would assume.
Say so in the same line: a hedge is the one thing a failing test can never restore, because the case
it never checks is the case you needed to know about.

**Prune as well as append.** A superseded rule teaches a session to work around something that no
longer exists; delete it and say so in the commit. Natural moments: while addressing review findings,
and when writing a handoff — anything phrased "next time, remember to…" belongs here instead. A
written rule with standing violations needs a guard, not another paragraph.

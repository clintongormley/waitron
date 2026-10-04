# Waitron — working notes for Claude

A Spanish restaurant POS with Veri\*Factu fiscal compliance. It files invoice records with AEAT (the
Spanish tax agency) and takes card payments.

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
  prefixed `payments.` landed beside its `payment.` siblings, and a spec used `orphan` to mean what `packages/payments/src/reconcile.ts`
  calls `unmatched`.
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
  probe missed that version 5 had stopped decoding `&#38;`, because the case standing for "numeric
  entity" was `&#233;`, which NEITHER version decodes. Instance in
  [writing-claims.md](docs/developers/writing-claims.md).
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
2026-09-23). A new package holds it from its first commit. The bar is negotiable only
where the rest of a gap could be closed solely by tests that assert nothing useful, and a gap is
never closed by hiding code a test could reach — adding an exclude or an ignore comment over it, or
moving it under `src/testing/`. Guard:
`scripts/coverage-thresholds.test.ts`, weaker than its name — it reads each config's `thresholds`
literal as TEXT; it never reads `coverage.exclude` or an ignore comment, so an added exclude passes;
it skips the members `PACKAGES_WITHOUT_TESTS` names (`scripts/changed-scope.mjs`); and it checks the
`pnpm ls` listing only for the names in `EXPECTED_MEMBERS` and a loose `MIN_TESTED_MEMBERS`, so a
listing that drops a few others passes. More:
[ci-and-gates.md](docs/developers/ci-and-gates.md).

**A mutation floor of 90 breaks the run in every mutation-tested package — `ui`, `ui-core`,
`shared`, `fiscal` and `db`** (the owner's 90-everywhere decision of 2026-09-19). WHERE it bites
differs: `shared` fails a pull request whose resolved scope contains it; `ui`, `ui-core` and `db`
fail only the weekly `.github/workflows/mutation.yml` run, so thinning one of their tests goes green
and reddens on Monday; and `fiscal` has no CI job at all, so only a local
`pnpm --filter @waitron/fiscal mutation` sees it. **`db`'s bar is not in its own stryker config** but
in the `mutation-db-aggregate` job, so a LOCAL `pnpm --filter @waitron/db mutation` prints a score
and gates nothing. Neither floor is package-wide: `fiscal`'s `mutate` list names two files, and
`db`'s leaves out `src/english-only.ts` (`scripts/mutation-shard.mjs`'s `NOT_MUTATED`). Which package
holds which bar is pinned by `scripts/mutation-break-thresholds.test.mjs`, weaker than its name in
one way — it reads the workflow as TEXT for db's bar. More:
[ci-and-gates.md](docs/developers/ci-and-gates.md).

Traps, each of which cost a round trip. The mechanism behind every one is in
[ci-and-gates.md](docs/developers/ci-and-gates.md) — read it before changing anything about CI, the
hook, or how tests are scheduled:

- **`prettier --check` on an IGNORED path prints the same line as a clean one.** `docs/` is ignored
  whole (`.prettierignore`), so a format check over it exits 0 having checked nothing;
  `pnpm exec prettier --file-info <file>` is the one that discriminates — it prints
  `"ignored": true`. Cost: a broken bold span in a plan passed a format check and was found by
  reading.
- **Check every command's exit status.** A shell sequence separated by newlines reports only its
  LAST command's status. Use `&&` for dependent validation steps, or capture each status separately.
  Cost: a review-fix command ran a successful build after a failed server typecheck and reported
  success.
- **CI's shards run `test:coverage`, not `test`.** Verify that package’s coverage job on the
  current head; run `pnpm --filter <pkg> test:coverage` locally when investigating a failure.
  There is no single `test` job. Vitest `--shard` splits by FILE COUNT, so `N` must never exceed a package's test-file count.
- **Moving harness code out of a `.test.ts` and into `src/testing/` puts it under coverage where
  the package's coverage settings reach `src/testing/` (several exclude it), and under mutation too
  where the package's Stryker `mutate` list reaches it (`ls packages/*/stryker.config.json`, then
  read its `mutate` list).**
  A test file is measured by neither. Cost: one such move took `packages/db`'s branch coverage
  below its bar until a unit suite was written for the moved code. Receipt:
  [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **CI does not run every check on every push.** Read the `changes` job's `code`, `scope` and
  `packages` outputs before treating a green PR as evidence about the workspace.
- **No front-end bundle is built by a pull request that changed no image input.** In CI the SPAs
  are `vite build`-ed only inside `deploy/Dockerfile`, which on a pull request runs only when
  `deploy/` or a file `IMAGE_SMOKE_FILES` names (`scripts/changed-scope.mjs`) changed
  (`isImageInputPath`, in the same file) — and wherever it does run it builds them
  without opening one, so a bundle that renders nothing passes anyway. Cost: the vite 6 → 8 bundler
  replacement had to take its build evidence locally. See [ci-and-gates.md](docs/developers/ci-and-gates.md).
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
  `scripts/ci-workflow.test.mjs` (whose concurrency cases read ci.yml alone, as TEXT, so another
  workflow's group is not seen) and `scripts/main-tag-guard.test.mjs`.
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
  package's `tsc` is version 7; the root resolves `typescript` to the version 6 API that
  typescript-eslint and the root scripts importing it still need, and its only binary is `tsc6`.
  Cost: raising the root to version 7 makes `pnpm lint` refuse to start with no results at all. See [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **A name-filtered test run does not load the package's guard suites** nor any e2e suite pinning a
  shared wire body with `toEqual`. A focused pass proves only those cases; CI supplies package-wide
  coverage. Run additional consumer tests locally when they help investigate shared behavior.
- **Adding a workspace package fails root guards until it is named in the shard lists**, and
  one of them CRASHES rather than asserting, so the message names a missing `vitest.config.ts`
  and reads like a broken checkout. See [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **A hardcoded cross-package list goes stale when a manifest or scope changes, and scoped CI hides
  it.** Grep for tests that pin the list, run those guards, and verify CI selects every affected consumer.
- **After a rebase + `--force-with-lease`, the hook can scope the WRONG package** (mechanism
  unconfirmed). Confirm with `git diff --name-only origin/main..HEAD` that the hook typechecked the
  packages the changed paths select (a root script `ROOT_SCOPE_CONSUMERS` lists selects the packages
  listed against it); run any missing typechecks and verify the PR’s CI scope and results.
- **Every package whose vitest config enables browser mode runs in real headless Chromium**
  (`grep -l browser */*/vitest.config.ts` — two levels, not one — says which).
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
  `scripts/migration-upgrade.test.ts`, weaker than its name — the rows it carries through each step
  are synthetic,
  read from each step's schema rather than written by the product, so a migration that fails only
  on values the product writes and they lack passes; a step that cannot carry them goes in its
  `RESETS`, where the walk restarts empty, and at one a constraint refuses, nothing else the step
  does to the rows is seen; it installs
  today's change-feed list, and today's append-only list less the tables the previous step lacked, at every step; it applies everything up to core's
  `0003` in one go; rows are counted, not compared, so a step that rewrites a value passes; and
  after the final step it also checks the `products_*` triggers it lists, but a rebuild that drops
  any other trigger passes it (SQLite drops one silently:
  [conventions-data.md](docs/developers/conventions-data.md)). Cost: an earlier bricked box that
  was wiped, and a box that failed three starts on 2026-09-26. See
  [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **The upgrade test makes its scratch directory under `scratchParent()` (`scripts/scratch-dir.mjs`),
  which picks `/dev/shm` when it exists, because every commit waits for the disk** — the store
  leaves `synchronous` at full. Cost: it timed out in CI five times. Nothing guards it. Receipt:
  [ci-and-gates.md](docs/developers/ci-and-gates.md#the-upgrade-test-keeps-its-database-in-memory-on-linux).
- **The stream loop and pause tests' CI step sets `TMPDIR=/dev/shm`, in CI only.** Cost: a main run
  failed the pause test's bound of at least 1000 ms; a probe reproduced it on one runner in 20,
  catching a disk stall that held one commit for about a second. Guard: `scripts/ci-workflow.test.mjs`, weaker than
  its name — it reads `ci.yml` as text, so a step an `if:` switches off, or a `run:` that sets
  `TMPDIR` again, passes; and it never reads the step's test files, so one that makes its scratch
  somewhere other than `tmpdir()` passes too. Receipt: [testing-guide.md](docs/developers/testing-guide.md),
  "In CI their temporary files are in memory".

**Claude never pushes with `--no-verify`**; the owner may, in an emergency (owner decision
2026-10-03), and the failure still has to be fixed because CI runs the same checks. The hook's
failure message says so beside its skip hint, pinned by `scripts/pre-push.test.mjs`. A hook failure the PR does not reproduce is a check CI has deferred to the
unfiltered `main` run, not a wrong hook.

---

## 3. Conventions reviewers enforce

One line each; the receipt for every one is in its topic file. **Read that file before working in the
area** — these lines tell you what the rule is, not why it exists or how it broke.

### Screens, forms and the dashboard — [conventions-ui.md](docs/developers/conventions-ui.md)

- **New or changed forms use the shared UI contract in [design-system.md](docs/developers/design-system.md) → Forms.**
  Required fields visibly marked; an invalid submission explains itself beside every bad field and in
  one localized message at the bottom of the form, on its own line above the buttons (in a dialog, at
  the end of its body — owner, 2026-09-30), and the action stays disabled until the fields are fixed —
  no summary at the top (owner, 2026-09-28). A refusal from a request never disables the action by
  itself, and one that names a shown field says so under that field (owner, 2026-09-29) — except a
  sign-in's refusal, which marks no field (below). A field's hint is its placeholder, not a line
  under it (owner, 2026-09-30); a placeholder set as well wins, leaving the hint to screen readers
  (design-system.md → Forms). A short explanation is a hint, not a "?" button; the "?" is only for
  one too long for a hint or a field that starts filled in (owner, 2026-10-03); nothing guards it
  across screens, and other setup screens may still break it (backlog A237). Every input has a
  semantic `name`, never a generated widget id.
- **A screen does not draw its own form field**: a `<select>`, a `<textarea>` or a text `<input>`
  comes from a field primitive; where none fits, add to one or add one (owner, 2026-10-01). Cost:
  a native dropdown cannot take the approved look, and hand-drawn fields did not follow the shared
  ones (A178). Guard: `scripts/native-form-fields.test.ts`, weaker than its name — it reads the
  literals of non-test `.ts` files under `apps/` and `packages/` only, so a field made with
  `createElement`, from markup no single literal holds, or with its tag name split across a `${…}`
  is unseen; the files it exempts are not read at all, so a field added inside one passes; and the files it allows by name are held only to how many lines draw a
  field, so a field swapped for another, a hidden input made visible, or one added on a line that
  already has one passes. See [conventions-ui.md](docs/developers/conventions-ui.md).
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
  callbacks assign snapshots; they do not rerun loaders that reset drafts.
- **A screen that shows a read's and an action's failure in one field remembers which one set it:
  the reads' recovery clears only a read's message, a reload that can finish after another action
  failed clears only a read's message, and a read's failure does not replace an action's** (Devices'
  queue reload after a wrong-number refusal replaces the refusal on purpose). Cost: a recovery that
  matched the message's code, or cleared on any successful read, wiped a save's `connection.failed`
  (A224). Nothing guards it across screens. See
  [dashboard-live-updates.md](docs/developers/dashboard-live-updates.md).
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
- **A login's refusal never says whether the account exists** (owner, 2026-09-30): unknown,
  suspended, pending, wrong password or PIN and wrong code all answer one code (`password.invalid`
  or `pin.invalid`) after the same hashing work, shown as one sentence for every cause, marking no
  field on a sign-in form — only a missing or malformed value is marked there; identity's refusals
  carry the real cause as a log-only `reason`, which `createErrorBoundary` logs. One owner-approved
  exception: a passkey Waitron holds no row for answers `passkey.not_registered` so the browser can
  be told to forget it — it says only whether that credential id has a row; a suspended owner's
  passkey stays generic. Guards: the one-answer cases in identity's login suites and the route
  suites conventions-ui.md names, weaker than the set looks — some sign-in routes have no case of
  their own, and a new one is seen by none. See
  [conventions-ui.md](docs/developers/conventions-ui.md).
- **A `wt-data-table` row-menu column is keyed `actions` and declared `pinned: "end"`**, so the
  menu stays on a phone's screen (owner decision, A155). Cost: most tables put the menu past a
  phone's right edge. Guard: `scripts/pinned-actions-column.test.ts`, weaker than its name — it
  knows a menu column only by the key `actions`, reads only non-test `.ts` files under `apps/` and `packages/`, misses a key
  not written as the literal `key: "actions"` (a variable, a shorthand, a computed name, an
  `as const`), and never checks that the column is the table's last. It does not know which objects
  are table columns, so every object with that literal key is held to the rule and a data column must take
  another key. See [design-system.md](docs/developers/design-system.md).
- **Markup a screen hands to `wt-data-table` as a cell is styled with `part=`/`::part()`, never a CSS
  class.** The cell's nodes live in the TABLE's shadow root, so the screen's own class rules reach
  nothing and the element renders unstyled while every attribute assertion still passes. Cost: the
  categories screen's colour swatches, thumbnails and ancestor-row muting never rendered at all,
  through review and a green suite. See [design-system.md](docs/developers/design-system.md).
- **Every colour, spacing, radius and font reads a `--wt-*` token.** No hex, no named colours, no
  `rem`/`em`. Guard: `packages/ui/src/no-hardcoded-chrome.test.ts`, which scans `packages/ui`
  components; [design-system.md](docs/developers/design-system.md) states the rule for any component
  or view, which is the wider scope a reviewer should apply. The name read must also be declared,
  and CSS reports nothing when it is not (cost: the Cloud services screen's labels drew at the body
  weight). Guard: `scripts/style-token-names.test.ts`,
  weaker than its name — it reads text and matches a read against declarations anywhere in the
  tree, not the ones the reading page loads, and it excuses the till reads its `FALLBACK_READS`
  lists.
- **A new `wt-*` primitive needs two specific tests**, not "some tests": a token-painting test, and an
  axe accessibility test in a sibling `*.a11y.test.ts` covering each distinct state in both themes.
- **A shared `wt-*` component's custom events are named `wt-*`, carry `detail`, and are dispatched
  `bubbles: true, composed: true` — and the triggering event is stopped with
  `event.stopPropagation()` before re-emitting**, or, for a composed trigger such as `input`, the
  consumer observes the change twice. App screens and app-owned components may name their own
  events plainly.
- **A retained hardware registration must remain re-addable after deactivation.** Discovery matches
  disabled records too; the dashboard offers them as Add again and reactivates the existing id.
- **A narrower roll in a wider receipt printer needs an explicit print area before native centring.**
  Cost: a shifted, clipped 58mm receipt; whether the printer's own width setting also contributed
  is unverified, and a corrected reprint is owed. Guard: `apps/server/src/receipt-ticket.test.ts`; see
  [conventions-ui.md](docs/developers/conventions-ui.md).
- **The hardware transport seam is `@waitron/print-agent`, and it is database-free.** It imports no
  other package in this repo, and `@waitron/printing` depends on IT, never the reverse. The guard is
  the `import-x/no-restricted-paths` zone in `eslint.config.js`, not the empty `dependencies` block.
- **A container that must reach a hot-plugged USB printer mounts `/dev:/dev:ro`**, plus
  `device_cgroup_rules: ["c 180:* rwm"]` and `group_add: ["7"]` — not a `/dev/usb` subdirectory bind
  and not a hard `devices:` line.
- **The print agent runs under `deploy/apparmor/waitron-print-agent`, named through
  `WAITRON_PRINT_AGENT_APPARMOR` only after `waitron.sh` has loaded it; a `bluetoothctl` call that
  sends a bus message the profile does not list is refused until the profile gains a rule for it.**
  Cost: on the owner's box (2026-09-29) Docker's default profile refused
  the agent's first bus message and it silently listed no Bluetooth printers. Guards, weaker than
  their names: image-smoke runs only the agent's paired listing and the commands its Bluetooth steps
  name, pairing through its own driver rather than the agent's Pair code, plus the Bluetooth sender
  invoked directly and only as far as creating its socket (the runner has no Bluetooth), and not on
  a pull request that changed no image input (`apps/print-agent/src/rfcomm-send.py` is one);
  `scripts/deploy-image-env.test.ts` reads the profile as TEXT for globbed bus rules, not for a grown literal list. See
  [conventions-ui.md](docs/developers/conventions-ui.md).
- **The unauthenticated recovery page's title and action are fixed strings chosen by the error
  code; its log tail shows the failed start's own lines — the error, its cause chain (up to five
  levels in all), the stack and an `AppError`'s params — through `redactSecrets` and
  HTML-escaped** (owner decision 2026-09-26: a failure the page could not show took `docker logs`
  to diagnose, which the operator cannot read).
  The code, `lastFailureAt` and the log file's lines are the text from outside the image; the log
  file's `redactSecrets` masks only a password in a URL, which is why no code's params and no
  logged message may carry a secret. See [conventions-ui.md](docs/developers/conventions-ui.md).

### Data, modules and migrations — [conventions-data.md](docs/developers/conventions-data.md)

- **Default optional request fields only when absent, and check enum types before comparing values.**
  Explicit null and coerced arrays passed modifier validation. Regression: the two
  `refuses an explicit null where a default is only taken on absence` cases, in
  `packages/catalogue/src/extra-contract.test.ts` and `packages/catalogue/src/option-contract.test.ts`.
  Two fields are deliberately outside the
  rule and pinned separately: an extras list's `maxPicks` null MEANS uncapped, and the seat-a-table
  route's `guestCount` null means no count.
- **Error codes name the DOMAIN CONCEPT, never the throwing package** — `series.not_found`, not
  `db.series_not_found`. **Before a venue is live, a code may be renamed or deleted freely; once one
  is live, either is a migration** (owner decision 2026-09-26). Either way it is one change in which every copy in the tree moves or
  goes; once live, stored copies are rewritten too and a reader outside this repository accepts both
  names until both sides are deployed. Stored copies and prefix matchers, which a grep for the code
  cannot find, are listed in [conventions-data.md](docs/developers/conventions-data.md). `server.*`
  is reserved for facts about the process itself. Every file that throws a code imports its registry.
- **A recorded incident code needs an area claim and English and Spanish alert wording.** Guard:
  `scripts/alert-codes.test.ts`, which reads only double-quoted, one-dot, lowercase-and-underscore literals
  in hand-listed files and counts a code recorded even if production never raises it; more: [conventions-data.md](docs/developers/conventions-data.md).
- **Spanish domain terms are deliberate, and a module declares its own.** One declaring home per
  word; a fiscal term never goes in the base list. Guard: `scripts/english-only.test.ts`, weaker
  than its name — it finds comments without a parser, guessing from the code before a `/` whether it
  opens a regular expression, and a wrong guess can hide a Spanish word in code on a later line.
  `apps/*` is out of scope by a recorded decision, so Spanish identifiers in app UI code are caught
  only by review.
- **The composition list lives in `@waitron/composition`, and it is the only place that names every
  module.** Generic code reaches the regime through the descriptor's `provisioning` and `fiscal`
  seats. The boundary is the swappable SLOT, not "any module". Guard: `scripts/module-seams.test.ts`
  (root project, blanks comments then reads text; the shared reader guesses whether `/` opens a
  regular expression, and import-like strings can still match)
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
  name — they read text, every block but the npm one covers one named component, so a new binary or
  system package is seen by none of them (npm notices are generated per bundle; that block reads the
  Dockerfile and image-smoke as text for a hand-written list of apps, so it checks that each app's
  notice folder is named, not that each generated file is copied); for Litestream they compare the
  version line, not the module list, for Iosevka tie the licence to the table's header, not the
  table to the font, and for Google Sans match the source file's SHA-256 to the notice, not that a
  build serves the font. Receipt: [conventions-data.md](docs/developers/conventions-data.md).
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
  satisfies.** Replacing the set — delete then insert — needs the `REFERENCES` grep first:
  nothing outside the table may hold a key into it. See
  [conventions-data.md](docs/developers/conventions-data.md).
- **Resolve shared catalogue data once before a basket's line loop.** Never await a zone, product or
  variant read per line. Guard: `apps/server/src/working-order.test.ts` (one zone snapshot, no
  per-line resolver).
- **The tables `scripts/write-path-tables.json` lists — `tenants`, `nodes`, `deployment`,
  `mirror_config`, `node_roles` — request code may read and never write, and the database does not
  refuse the write.** The engine is a
  file with no roles or permissions, so the guard below is the whole of the enforcement. A write of
  one of them belongs on a path that opens the store deliberately for it, never on the handle a
  request is served on. Guard: `scripts/write-path-tables.test.ts`, weaker than its name in
  ways its own header states, among them — it reads TEXT, so a table name reached through a variable is
  invisible to it; it judges a FILE against an allowance list rather than a call chain, so a request
  path that calls into an allowed file writes through it unseen; and it walks `<member>/src` under
  `apps` and `packages` alone, so a package's `test/` directory and `apps/<app>/scripts` are outside
  it.
- **Multi-table writes share ONE transaction, and `withTransaction` IS that transaction.** Write-path
  functions take a `tx: Transaction` and never open their own; a route handler opens exactly one
  `withTransaction` per request. This is a convention, not a compiler guarantee — `Database` is assignable
  to `Transaction`. A secret check should be the exception: it takes the `Database` and derives its
  key with no transaction open. The PIN, manager-login and profile checks do so through identity's
  `checkPin`, `checkManagerPassword` and `checkOwnPassword`, whose result the check inside the
  transaction reuses only while the person, the secret and the stored hash it was derived against
  are the same — weaker than it looks: those inner checks still
  take a `tx` and derive inside it when handed no result, so a new route that forgets the early check,
  or forgets to take turns (`inTurn`, `apps/server/src/attempt-turns.ts`), derives under the lock or
  once per attempt in a burst, and nothing notices ([conventions-data.md](docs/developers/conventions-data.md)).
  **Splitting one logical change across transactions is a commented decision, never a default.**
  **Queries on one transaction are awaited in turn, never `Promise.all`** — this engine is
  synchronous, so two statements issued together run one after the other in an order nothing
  states. No guard enforces it.
- **A read taken while ANOTHER caller's write transaction is open sees committed rows only.** The
  store opens a read-only connection per file beside the single writer and routes by ASYNCHRONOUS
  CONTEXT and per-body identity, so a read written inside the body still sees that body's own rows
  (`packages/store/src/connections.ts`). Three shapes are outside the rule and each is stated at its
  site: a transaction opened by RUNNING `begin`, a write issued from outside a running body, and a
  statement that changes a CONNECTION rather than the file — a temporary table, an `ATTACH`, a
  connection-scoped pragma — which a read-only connection does not refuse. Cost: the flip landed one
  connection per file and a concurrent read returned rows a rollback then removed. Guard: the routing cases in
  `packages/store/src/index.test.ts` and `connections.test.ts` — weaker than the set looks, because
  not every case in it fails when the routing is deleted. See
  [conventions-data.md](docs/developers/conventions-data.md).
- **A statement this engine refuses backs out ITSELF, not the transaction around it** — so catching
  a refusal and carrying on in the same `tx` is safe. **A TEST still catches such a
  refusal OUTSIDE the transaction**, around the whole `withTransaction`, and no guard enforces that.
  Receipt: [conventions-data.md](docs/developers/conventions-data.md).
- **A refusal under result code 1811 is identified by its words, never by `isRefusal` alone.** An
  `ON DELETE RESTRICT` key and every trigger's `RAISE(ABORT)` share the code; `restrictRefused` and
  `triggerRaised` (`packages/db/src/constraint-target.ts`) read the message too. Cost: the two
  layouts stores asked for the code alone, so a second refusing trigger on either path would have
  been reported as `canvas.in_use` or `device_profile.in_use`. Nothing guards it. See
  [conventions-data.md](docs/developers/conventions-data.md).
- **One process owns a venue folder at a time.** `openVenueStore` holds `venue.lock` and refuses a second
  PROCESS at once with `VenueInUseError`, which `@waitron/db`'s `openVenueDatabase` and
  `lockVenueDatabase` turn into `provisioning.database_in_use`; opens inside one process share the
  hold. A tool documented to run beside the server passes `exclusive: false`; a command that changes
  the folder's files takes `lockVenueDatabase` before its first change. Never unlink `venue.lock`.
  The server's own Litestream child also opens `venue.db` and takes no lock; the server awaits its
  stop before closing the store, and closes the store even if that stop fails. Every holder also
  writes `venue.holder.json`, and a watchdog thread, while it runs, SIGKILLs the process about
  `WATCHDOG_KILL_MS` (two minutes, `packages/store/src/venue-liveness.ts`) after its main thread's
  last timer turn. An entry point names itself with `setVenueHolderIdentity`
  (`packages/db/src/venue-holder-identity.ts`); nothing checks that a new one does. Guard:
  `packages/store/src/venue-lock.test.ts`, weaker than its name — it proves the lock, not that each
  caller takes it, so a caller passing `exclusive: false` wrongly is seen by nothing. Every change
  to `recovery.json` goes through `updateRecoveryState` under `recovery.lock`; never unlink
  `recovery.lock` either. Guard: `apps/server/src/recovery-race.test.ts`, weaker than its name — it
  proves the lock, not that every writer of the file takes it. Receipt:
  [conventions-data.md](docs/developers/conventions-data.md).
- **A duty `bootServer` starts pushes its stop onto `undoOnFailure` as soon as it exists, before
  the next step that can throw** (`apps/server/src/boot.ts`), or a failed start leaves it running on
  a store the unwind has just closed. The landing listener, started last, is the one step not on the
  list. Guard: `apps/server/src/boot.failed-start.test.ts`, weaker than its name — it covers only
  the duties it names, so a new one that forgets is seen by nothing. Removing `await loop` still
  passes, so not every
  stop is proven to finish before the store closes. Receipt:
  [conventions-data.md](docs/developers/conventions-data.md).
- **There is no tenant column. The taxpayer is the one row in `tenants` (id = 1, singleton check); a
  query that wants "this tenant's rows" reads the table.** (2026-09-14, #378.) Guard:
  `scripts/no-tenant-column.test.ts`, weaker than its name in ways its own header states, among
  them — it matches the column's SPELLINGS, so a column reintroduced under an unrelated name passes,
  and it does not read test files.
- **`packages/db/src/schema/columns.ts` is the only file that names the engine's column and table
  types.** A table declares `id`, `money`, `label`, `table` and the rest from there, never `text()`
  or `integer()` straight from `drizzle-orm/sqlite-core`, so the NEXT engine change replaces one
  file rather than every column in the tree. One scoped exception: `text` in
  `packages/fiscal-verifactu/src/schema/registros.ts`, whose two amount columns store the bytes the
  huella hashed. Guard: `scripts/column-vocabulary.test.ts`, weaker than its name — it reads the
  IMPORT or re-export line as text, so a builder reached through `import * as` is invisible to it,
  and it forbids only the builders the vocabulary ITSELF imports, so one it does not — `blob`, a
  real `drizzle-orm/sqlite-core` column builder — is in no forbidden set and passes anywhere. A builder the
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
  `integer` column with no strictness, so every one of these is accepted, bound parameter and raw SQL
  alike: `25.00` and `"25.00"` store the
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
  quantity, it misreads one. The converters
  hold the bound — nine integer digits for a quantity, three for a rate — because an integer column
  does not enforce them; the raw quantity reader reads totals, so like the money one it bounds only
  at what a number counts exactly. The
  money rule's two guards and both its hedges apply unchanged, and `quantity`, `money` and
  `bigCount` are all `integer(name)`, so only the caller separates them. A rate's CHECK constraint
  is written against 10000: one written as `rate <= 100` refuses every rate above one percent. Guard: the shared schema-conformance suite,
  `packages/db/src/testing/schema-conformance.ts`, which a migration set opts into with a small call
  site — `ls packages/*/src/schema/schema-conformance.test.ts` says which sets have one, and a set
  with none is unguarded.
- **The database never rounds a quantity — `decimalToThousandths` owns the third place.** The
  column stores what the converter already decided, so no SQL rounding stands behind it and a test
  asking storage to round is testing something no product path does — this engine has no exact
  decimal type. Receipt: [conventions-data.md](docs/developers/conventions-data.md).
- **A time stored as text and compared or sorted as text is right only while every writer stores
  one spelling**, because the engine compares characters: `10:00:00Z` sorts after `10:00:00.500Z`,
  and `09:00+02:00` after `07:30Z`, though each is the earlier time. Normalise at the writer, as
  `shiftInterval` (`packages/workforce/src/clocking.ts`) and the `storedTime` helpers do. Cost: W22
  (#1134) — shifts kept the caller's spelling, so a valid shift was refused with a raw CHECK error
  or listed out of order. Nothing guards the one-spelling rule across the columns; `time_entries`
  and `order_amendments.event_at` pin theirs with a CHECK. Receipt, and which columns have which
  writers: [conventions-data.md](docs/developers/conventions-data.md).
- **A new table is classified `ledger`, `state` or `local` in its module's `<MODULE>_CLASSIFICATION`
  list, and a table that must never be corrected is declared with `appendOnly()` instead of
  `classify()`** — `applyMigrations` turns those declarations into a `RAISE(ABORT)` trigger pair
  after each set migrates (`installAppendOnlyTriggers`, `packages/store/src/append-only.ts`), from
  the `appendOnlyTables` a `migrationOptionsFor(...)` result carries; a plain options array carries
  none, and gets none of those triggers, silently. **The CLASS is not the trigger set**:
  deriving the triggers from the class refused a card capture and left an amendment rewritable. It
  needs `PRAGMA recursive_triggers`,
  which the store turns on: without it `INSERT OR REPLACE` rewrites a protected row silently, while
  the other three mutation shapes are refused either way — so a suite that omits the replace case
  passes with the hole open. What a trigger cannot refuse is `DROP TABLE`: SQLite has no trigger
  event for it. Guards, on a new table:
  `scripts/classification-complete.test.ts`, `scripts/append-only-triggers.test.ts` — which migrates
  a real database through `applyMigrations` and then tries a plain `UPDATE` and `DELETE` on every
  declared table, and leaves the other two shapes to `packages/store/src/append-only.test.ts`, where
  a conflicting key is available. On a new caller: `scripts/apply-migrations-callers.test.ts`, that
  every non-test `applyMigrations` call under `packages/` and `apps/` passes a
  `migrationOptionsFor(...)` result — weaker than its name in the ways its header lists, among them:
  it checks the call's shape and trusts what that function returns, never reading the sets handed
  to it; a `const` it accepts can be changed after it is declared; a function injected beside it
  through `??` runs unseen; and a path that migrates without `applyMigrations` (`runMigrations`
  called directly) is invisible to it.
- **A streamed `venue.db` holds two tables no migration created, and its folder a directory no
  store opened.** Litestream adds `_litestream_seq` and `_litestream_lock` to the database it
  streams, a restore of the stream carries both, and it keeps `.venue.db-litestream/` beside the
  file; a freshly migrated database has neither. Code that lists a live or restored database's
  tables, or that empties, copies or restores the venue folder, must expect them; no guard finds a
  new site that does not. Receipt: [conventions-data.md](docs/developers/conventions-data.md).
- **A `local` row belongs to one node, so no foreign key may join a `local` table to a
  `ledger`/`state` one, in either direction.** Every table is in `venue.db`, which a primary streams
  whole to the owner's bucket once one is set up (#548); `node.db` is reserved and empty, and a key across the classes would stop
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
  puts a `CREATE TRIGGER … ON` one of them, names one inside a trigger's body, or writes one
  at top level — and its descriptor's `requires` must name it.** `packages/media/drizzle/0001_image_references.sql` has
  triggers on tables core and catalogue create, and others whose bodies read them. Guard:
  `scripts/module-graph-honesty.test.ts`, weaker than its name — it reads SQL as TEXT and recognizes
  `FROM`, `JOIN`, `INSERT INTO`, `UPDATE` and `DELETE FROM` in a trigger body, plus plain
  `INSERT INTO`, `UPDATE` and `DELETE FROM` at the start of a top-level statement. It does not
  recognize arbitrary SQL, top-level reads, WITH-prefixed writes, REPLACE or INSERT/UPDATE OR
  variants. The engine will not catch a missing body target either: a trigger whose body names a missing table is created without complaint and fails only
  when it fires, with `no such table`. Cost: the first `requires` graph was derived from `REFERENCES`
  alone and missed two edges made by triggers ON another module's tables, caught by hand in review. See
  [conventions-data.md](docs/developers/conventions-data.md).
- **No new table enters the core migration set without a stated reason in the commit.** A domain
  table a module owns belongs to that module's own set, where its append-only classification
  travels with it.
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
  `scripts/behavioural-triggers.test.ts`, `scripts/migrations-match-schema.test.ts` and
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
- **A drizzle table rebuild on this engine runs with foreign keys ON, so its `DROP TABLE` silently
  deletes every cascading child's rows, and fails on a `no action` or `restrict` child holding rows.**
  Drizzle rebuilds a SQLite table to change a column's nullability, and the `PRAGMA foreign_keys=OFF`
  it generates does nothing inside the migrator's transaction. Before shipping a rebuild, list the
  foreign keys that point at the table. Cost: the variants plan's `products` rebuild emptied
  `product_categories` on a scratch venue without the media triggers, and its `menu_items` rebuild
  emptied three menu tables while reporting success or, once the venue had sold from a menu, refused
  to run. Receipt: [conventions-data.md](docs/developers/conventions-data.md).
- **A drizzle-kit 0.31.10–0.31.11 generation that rebuilds a table must not also add a column to
  it.** The rebuild's `INSERT … SELECT` names every column of the NEW schema, so it reads the added
  one from the old table, and this engine refuses that even on an empty table (`no such column`). A
  new CHECK, a
  changed nullability or a changed foreign key forces a rebuild, so add the column in one
  generation and its CHECK in the next. Cost: paid three times — #721, #750 and A238's `incidents`
  migration (2026-10-03). Receipt: [conventions-data.md](docs/developers/conventions-data.md).
- **A drizzle-kit 0.31.11 table rebuild writes an expression index back as quoted column names,
  which this engine refuses** (`no such column: case when …`). Take the index out of the schema for
  every generation that rebuilds its table and add it back in a generation of its own, with a note
  at the index (core `0077` to `0079`; `packages/db/src/schema/incidents.ts`). Cost: A238's
  `incidents` migration failed until the index moved (2026-10-03). Receipt:
  [conventions-data.md](docs/developers/conventions-data.md).
- **A foreign key whose target has no unique index is refused at the first WRITE, not at migrate
  time.** This engine creates a table naming a parent that does not exist yet, and a whole migration
  set applies clean; the first insert then fails `foreign key mismatch - "child" referencing
"parent"` (errcode 1), and it keeps failing until a unique index over the parent's columns exists. So a green migrate is no evidence a new key is sound — write through
  it. See
  [conventions-data.md](docs/developers/conventions-data.md).
- **Editing a shipped migration file — even only its comments — makes every venue it already
  migrated refuse to start** with `provisioning.database_ahead`: drizzle stores a hash of the whole
  file, and the ahead check on the boot path and the bucket rebuild reads a hash the image does not
  ship as a newer image's. Such an edit ships only with a venue reset, said in the PR's first line.
  Nothing guards it. Cost: #1036 restored two edited files byte for byte. See
  [conventions-data.md](docs/developers/conventions-data.md).
- **Drizzle picks what to apply from `max(created_at)` alone**, never from a position in the journal,
  so an entry at or below a recorded watermark never runs and drizzle raises nothing. Guard:
  `scripts/journal-monotonic.test.ts`, weaker than its name — a one-entry journal cannot be out of
  order, so the guard bites only on a set with more than one entry. A drizzle bump starts with
  `grep -rn 'dialect.js'`.
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
- **No backwards-compatibility or data-migration code until Waitron is in production.** Until then
  any installation may be reset at any time instead of carrying its data forward (owner,
  2026-10-03). This rule expires the day a real venue is live; add its replacement in the same
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
- **The stream loop test (`apps/server/src/stream-loop.e2e.test.ts`) and the stream pause test
  (`apps/server/src/stream-pause.e2e.test.ts`) need two pinned binaries: without them they are
  SKIPPED locally and FAIL in CI.** Install both with
  `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`. **Vitest's default
  reporter prints a skipped run as `1 skipped` and nothing else** — the reason shows only under
  `--reporter=verbose` — so a local green run of `apps/server` may not have run them. Guard: `scripts/ci-workflow.test.mjs`, which reads `ci.yml` as TEXT, so the
  install commands left only in a YAML comment, or in a step an `if:` switches off, pass it. See
  [testing-guide.md](docs/developers/testing-guide.md).
- **Under an AI agent (`AI_AGENT` or `CLAUDECODE` set), Vitest hides a passing test's console
  output**; unset both to see it. See
  [testing-guide.md](docs/developers/testing-guide.md#vitest-hides-a-passing-tests-console-output-under-an-ai-agent).
- **A Vitest run that shows no `Tests` count is no evidence that anything passed, whatever its exit
  status** — an unknown `--reporter` name prints none, and some real reporters never print one
  (`hanging-process` printed nothing, measured 2026-10-03); under those, read the reporter's own
  result. Read the count, never a blank output or the exit status of a pipe. Cost: an unknown reporter name was read as a clean pass, and a `*/` inside a doc
  comment and a run beside another agent's in the same package each reported no tests without saying
  why. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md).
- **A container port-binding timeout needs Docker state as well as the container's own logs.** Save
  `docker inspect`'s `HostConfig.PortBindings` and `NetworkSettings.Ports` before removing the
  container. The live subjects are the two `bench/` rigs that start a container, both of which
  publish a port. See [testing-guide.md](docs/developers/testing-guide.md).
- **Draw every port a test needs in one `freePorts(n)` call, before binding any of them**
  (`apps/server/src/testing/free-ports.ts`), never two single draws before either is bound: Linux
  can hand a just-released port straight back, which put a boot's HTTPS server and its landing
  listener on one port in CI. Nothing guards it. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md).
- **An interrupted run also ORPHANS its vitest workers**, which spin at ~100% CPU until `kill -9`.
  `pnpm reap` sweeps these, scoped by ppid 1 AND the shapes vitest leaves in `ps`, never a bare `vitest` match.
- **Concurrent coverage runs must not share a package's report directory, and an intentional second
  one belongs OUTSIDE the package.** Vitest cleans a shared directory, so two overlapping runs over
  the same package end in `ENOENT`.
  Inspect the resolved selection first. See [testing-guide.md](docs/developers/testing-guide.md).
- **Locate the unfinished package before diagnosing a silent shard as database contention.** A
  Vitest test timer does not bound a browser whose event loop has stopped; use an outer deadline, and
  never a retry as proof of repair.
- **A recurrent stall needs a retained log and a snapshot of whatever it was waiting on.** Locate the
  stalled operation before assigning its cause to resource contention.
- **On Vitest 4 a project's own `maxWorkers` wins, and the outer config's is only the fallback**. **A cap that must apply to every project still belongs on the
  outer config**, which a project setting none of its own falls back to. Guard:
  `scripts/fiscal-test-budget.test.ts`, weaker than its name — it pins the arrangement
  fiscal-verifactu and media chose, not how Vitest resolves the limit. Measurement (and the Vitest 3
  history this replaced): [testing-guide.md](docs/developers/testing-guide.md).
- **A package that pins one worker inside one of several projects numbers its `groupOrder`s from 1,
  never 0**: Vitest 4 runs a `groupOrder: 0` project that runs one isolated worker AFTER every
  other group, and stating no `groupOrder` at all does not avoid it. Guard:
  `scripts/bookings-test-budget.test.ts` — which pins bookings alone, not the other packages with
  the same shape. Receipt: [testing-guide.md](docs/developers/testing-guide.md).
- **A suite whose test outlasts Vitest's per-test timeout fails HEALTHY runs.** Set the bound above the longest a healthy
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
  MEASURED AT ALL, and excluded from its own package's. **That `include` is one file-type glob plus
  the explicit paths added to it, so root-level source of another type is measured only when
  somebody names it.** See [testing-guide.md](docs/developers/testing-guide.md).
- **Prove a guard by deletion**, and confirm a negative control fails for the reason you think.
- **A proof by deletion says nothing about what the guard wrongly REFUSES, and that needs its own
  case.** Deletion shows the guard catches what it was written for; only a case in the other
  direction — the legitimate call that must still be served — shows it is not too wide. Cost: a
  write-queue re-entrancy guard passed every case in its own file and turned every concurrent
  request in `packages/payments` into a 500. Receipt: [testing-guide.md](docs/developers/testing-guide.md).
- **A proof-by-deletion belongs to the SHAPE of the code it was taken against.** Restructure that
  code and the deletion can stop failing while every test stays green — re-run the control, and move
  the proof to whatever still catches it. Cost: rewriting a job claim as one statement left
  `packages/printing`'s race suite passing with its locking clause deleted, while the suite's header
  still recorded the old shape failing. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md).
- **Measure the old version in a throwaway worktree, never by swapping files in the working one.**
  `git worktree add --detach <dir> <base-sha>` (a measuring copy, not a feature worktree: run
  `pnpm install` in it before running tests, and `git worktree remove` it after) gives the before
  state without touching your edits;
  a copy set aside that cannot be avoided goes in `mktemp -d`. Cost: a `git stash` pop that took
  another session's stash (the stash list is shared by every worktree), a `git checkout <path>` that
  discarded an uncommitted rewrite, a swap to HEAD that deleted new test files, a probe removal that
  ate a final newline, and two agents saving into the same hand-named `/tmp` folder. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md).
- **A fixture no check reads is unverified data, and a green suite resting on it proves nothing.**
  Cost: the shared alta fixture had drifted into a record AEAT would reject, masking a real defect in
  `recordSale`. When a fixture describes something an authority will judge, run the real check over it.
- **Treat "there is a test" as an unfinished sentence.** Coverage proves a line executed, not that
  anything asserted on the result. Ask which assertion would fail if the behaviour were deleted; "it
  doesn't throw" is not an answer. `pnpm --filter @waitron/ui mutation` checks this systematically.
- **Rejected writes assert the domain error code.** A database constraint error also satisfies
  `toBeInstanceOf(Error)`. The duplicate-category mutation escaped that assertion; receipt in
  [testing-guide.md](docs/developers/testing-guide.md).
- **`errors.ts` reachability is guarded once, in `scripts/errors-reachable.test.ts`.** It blanks comments before reading TEXT; the shared reader guesses whether `/` opens
  a regular expression, and an import-like string can still fake an edge.
- **Vitest 4 ships no default coverage excludes at all.** What scopes a package's report now is its own `coverage.include`.
  `include`/`exclude` still replace rather than merge, and a config measuring nothing still exits 0
  with the thresholds intact, so read the per-file table rather than the exit code. See
  [testing-guide.md](docs/developers/testing-guide.md).
- **A package config must name its own source tree in `coverage.include`, or an untested file stops
  being counted.** Without one, Vitest 4 counts only the files a test loaded, so a file nobody
  imports is invisible rather than a zero in the denominator: it can never pull the ratio down, and
  moving code into one RAISES the percentage. Guard: `scripts/coverage-thresholds.test.ts`, which reads the configs as
  TEXT and looks for one exact string, so a config that spells the same include differently fails
  it. **That include is not anchored to the package**: a SIBLING package whose directory name
  extends this one's can land in this package's report. See [testing-guide.md](docs/developers/testing-guide.md).
- **Use the `/* v8 ignore start */` … `/* v8 ignore stop */` pair, not `/* v8 ignore next */`.**
  Measured for #437 (2026-09-19): marked `next`, a package's guards failed its branch bar silently,
  with no message naming the marker, where the pair passed. Nothing guards it. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md).
- **A page asserted as a STRING, or reached only through its API, has nothing checking that it
  renders.** An invalid CSS value, an unclosed tag, an unreadable dark-theme colour and a screen that
  throws on open all pass every such assertion. Cost: a corrupted colour value on `/setup/trust` that
  every test accepted, caught only by opening the page; and, on another branch, an image library
  that reached a green gate through review and CI and then answered 500 to the first person who
  opened it. Open it and LOOK, in both themes and at phone width. A browser-mode package has the
  harness already; `apps/server`'s string-rendered pages have none, so write the rendered string to a
  file and open it with the workspace's playwright Chromium.
- **`toMatchObject` checks only the keys you list**; a key you never list is never checked at all. See
  [testing-guide.md](docs/developers/testing-guide.md).
- **A default you did not state is not a value you tested**, and a library default can be computed
  from the RUNNING runtime, where reading the types tells you the wrong answer. State it at every call
  site that shares it — the two ends of one ceremony drift apart while each looks right. Guard: the
  two pinned-algorithm cases in `packages/identity/src/passkey.test.ts`, one on what registration
  offers and one on what it verifies. Receipt (the
  `@simplewebauthn/server` 14 case): [testing-guide.md](docs/developers/testing-guide.md).

---

## 5. Fiscal invariants — the unrecoverable ones

- **Printing never opens the cash drawer, and a device opens it only when its profile allows it.** A
  cash payment, or a card hand-keyed on a machine Waitron does not talk to (its slip is kept in the
  drawer, owner 2026-10-01), enqueues a separate audited `drawer` job; receipt jobs are `document`
  jobs and contain no drawer command. A card on a connected machine opens nothing. A device opens
  its current receipt printer's drawer only when its profile has `open-cash-drawer` and that
  printer has a drawer, handhelds included (`drawerPrinter`, `apps/server/src/receipt-print.ts`);
  nothing per till decides it, and a till that must not open a drawer it shares gets a profile of
  its own (approved by the owner 2026-10-03, A238). `take-cash` decides whether a device takes cash
  at all: a cash sale, collection or bill payment from a profile without it is refused
  `device.cash_not_allowed` (`assertTakesCash`, `apps/server/src/device-session.ts`). The manual open needs a session on an
  active device, the profile's `open-cash-drawer`, and under the `gated` drawer policy `cash.drawer`
  or the PIN of someone holding it. The one exception is the dashboard's "Test open drawer"
  calibration (`POST /management-api/printers/:id/test-drawer`), which opens any active printer's
  drawer for a manager holding `printer.manage` and `cash.drawer`. Drawer jobs cannot be manually
  resent. The receipt review reproduced a resent cash receipt opening the drawer without a new
  audit row. Guards, weaker than the rule: the drawer cases in
  `apps/server/src/receipt-print.test.ts`, `apps/server/src/till-api.receipt.test.ts` and
  `apps/server/src/bill-payments-api.test.ts`, the `device.cash_not_allowed` cases in
  `apps/server/src/till-api.fiscal-sale-paths.test.ts` and `bill-payments-api.test.ts`, the
  calibration case in `apps/server/src/print-api.test.ts` and the drawer resend refusal in
  `packages/printing/src/outbox.test.ts` — each holds only the routes or functions it names, and
  nothing stops a new route queuing a `drawer` job without `drawerPrinter`
  or taking cash without `assertTakesCash`. Pointer: #324; the card slip, B30; A238;
  [conventions-ui.md](docs/developers/conventions-ui.md#a-device-opens-the-drawer-when-its-profile-allows-it-a-handheld-does-what-a-till-does).

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
  (till reroute, #244 to #265); only the primary sells. Fiscal submission is an outbox,
  never inline.
- **The bucket stream never makes a sale wait on the BUCKET and never fails `/health` — but a sale
  can wait behind Litestream's own local checkpoint, for as long as that checkpoint holds the write
  lock.** Cost: measured 2026-09-29, one seller's writes waited up to 831 ms to begin on a slowed
  disk and up to 629 ms on a CI runner's normal disk. Litestream's routine checkpoints stay at its
  defaults (owner decision 2026-09-30; `docs/backlog.md`, A130's entry, A135). Receipt (the
  mechanism, the figures, and what was not measured):
  [testing-guide.md](docs/developers/testing-guide.md#a-sale-can-wait-behind-litestreams-own-checkpoint).
  A copy fifteen minutes behind raises
  `backup.stream_behind`, unless a stopped, refused or unusable-settings alert already explains it
  (`apps/server/src/alert-sources.ts`). The side file is bounded by stopping Litestream at a size
  limit (`backup.stream_paused`) and then folding the file back; that fold-back is the server's own
  checkpoint, and it takes its turn in the write queue with no busy wait (`checkpointTruncate`,
  `packages/store/src/index.ts`), so a sale can queue behind it but never waits on the bucket.
  Guards, narrower than the rule: `apps/server/src/stream-pause.e2e.test.ts` freezes the bucket,
  then times the sales of three concurrent sellers on one till session through the server's own
  route against a bound while the side file passes a 16 MiB limit, the server folds it back and the
  pause holds — it does not observe whether a sale's write waited behind the fold-back rather than
  landing before it, nor time the fold-back of a 256 MiB file; the frozen-server stage of
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
  automatically for a node that was filing (#248), and so does a rebuild from the bucket
  (`waitron-restore restore --from-bucket`, or the setup wizard's "Restore from my bucket"), which
  places its copy through the same path — one restore takes one source, never both, or one event
  would mint two installation numbers. UNLIKE the fiscal chain, the working-time chain is NOT
  reset on a cold restore — it continues from the backup's head, because the fiscal reset exists to
  mint a fresh SIF for AEAT and the working-time record has no equivalent. A survivor's forked row
  is refused by the chain-position unique index however it reaches the database; nothing carries
  rows between nodes today. Guard: `packages/workforce/src/restore-continuation.test.ts`. How a
  restore mints: [conventions-data.md](docs/developers/conventions-data.md).
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
it lives in the global `~/.claude/CLAUDE.md` and is shared by every repo. When CODEX drives, the roles reverse: Codex implements and Claude reviews — so establish who is driving
before treating an implementation as a rule violation.

- **Never commit directly to `main`.** Feature work happens in a worktree
  (`python3 ~/workspace/tools/worktree.py new waitron <branch> --headless` — not a plain
  `git worktree add`, which `/land-branch` cannot tear down). Claude always passes `--headless`;
  only the owner runs it without (owner decision 2026-09-27). Name the branch right at creation.
- **A `docs/`-only change is exempt from the PR ceremony**: branch, `commit -s`, fast-forward `main`,
  push direct. A ROOT `CLAUDE.md` or `README.md` is format-checked and takes the normal flow.
- **Every commit needs `git commit -s`.** **A PR that goes `BEHIND` is not rebased for that alone**
  (owner decision 2026-09-05): if what `main` gained is documentation, or code only in files this
  branch did not touch, land it with `gh pr merge --squash --admin` — which bypasses the up-to-date
  requirement and NOTHING else, never a failing check or an open review. Rebase only for `CONFLICTING`,
  or when `main` touched a code file this branch also changed. **Never `gh pr update-branch`** — its
  merge commit carries no sign-off and fails DCO.
- **Treat a Dependabot pull request like any other: an npm-only one's green CI builds no front-end,
  and a guard that pins a version number fails its bump** (#764's mailpit bump failed
  `scripts/dev-email.test.ts`). A bot gets no exemption from the strict sign-off check (owner
  decision 2026-09-27). How to land one: [workflow-guide.md](docs/developers/workflow-guide.md) →
  _Dependabot pull requests_. Config: `.github/dependabot.yml`.
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
- **Before a PR, run focused behavior checks, then `/finish-branch`.** §2 says what runs where.
- **Every agent that edits files or runs tests works in its own worktree**, or the agents take
  turns. Cost: one agent's commit carried another's staged renames (`git commit` takes the whole
  index), and a test run beside another agent's in the same package printed `no tests`. Receipt:
  [workflow-guide.md](docs/developers/workflow-guide.md).
- **Development and loopback-only servers must not advertise the appliance's LAN name.** A laptop
  and box both answered `waitron.local`, sending some lookups to the laptop. Guard:
  `apps/server/src/mdns.test.ts`; receipt in [workflow-guide.md](docs/developers/workflow-guide.md).
- **The dev stack from a worktree is started with `wa-wt demo <worktree-name>` or
  `wa-wt onboarding <worktree-name>`**, never a bare `pnpm dev*` — compose names its project after the
  directory, so an unqualified `docker compose up` starts a SECOND `mailpit` fighting for the fixed
  1025 and 8025 ports.
- **The first dev stack's venue is a seeded directory of SQLite files on the host, shared by
  worktrees that take the first port slot; a second stack running beside it has its own venue.
  Moving between worktrees on the same target does not wipe that slot's venue — so a branch's
  migrations can fail on the rows already in it.** Migrations carry no data-preservation code (§3);
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
check a root-level filename such as `eslint.config.js`, a bare directory, or a path whose extension
is not on its list (`apps/print-agent/src/rfcomm-send.py` and `deploy/apparmor/waitron-print-agent`
go unchecked), nor the `#anchor` part of a link: the guard is narrower
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

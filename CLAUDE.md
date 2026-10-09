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
The instances behind each rule are in [writing-claims.md](docs/developers/writing-claims.md).

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
  claim. Cost: a zero-byte filter reading offered as proof, taken where zero was also the correct
  answer.
- **A sentence about what ANOTHER part of the system does is checked by following the call chain to
  that part, not by reading the boundary you just edited.** The fix can be right and the sentence
  describing it still too wide: you had one edge open, and you wrote about the whole path.
- **"Pre-existing", "not a regression", "harmless", "unreachable" and "narrow" are claims.** Check
  with `git log`/`git blame` first; unchecked, say "I believe this predates the branch".
- **The correction is a new claim, and deserves MORE scrutiny than the text it replaces.** This is the
  single most productive source of false claims in the repository's history.
- **Before asserting a convention, grep the siblings** — identifiers AND prose. Cost: an error code
  prefixed `payments.` landed beside its `payment.` siblings.
- **A behaviour change retires every receipt about the old behaviour — editing a file is not auditing
  it.** Read the runbooks and the README paraphrases across the whole base-to-tip range, not the three
  lines of context a diff shows; per-task review cannot see this class. **The PATH SET matters:** read
  every claim stated in prose, wherever it lives, not only the ones written beside an identifier.
  Cost: three stale claims in two READMEs, one a documented operator procedure.
- **Claims about the outside world need receipts too — and the source's own words.** Every external
  claim gets a provenance row. Quote, then paraphrase. Two sources that seem to contradict usually
  describe different paths. Cost: an API limit of Square's paraphrased into a product limitation.
- **A class's representative has to be a value the two sides could treat differently.** Pick it from
  what the FORMAT allows, not from the first value that comes to mind. Cost: a `fast-xml-parser`
  4 → 5 probe missed a decoding change because its example was one neither version decodes.
- **The code is what matters; comments go stale.** Keep a comment only for an invariant, or a
  non-obvious why, that the code cannot show — never history, narrative, or a restatement of the
  code. The receipt lives in the commit message and the PR thread, with at most a one-line pointer.
  Cut on touch, and deliberate pruning sweeps are wanted (owner decision 2026-09-23). Prefer deleting
  to rewording: a rewording is a new claim. A comment another rule here requires at its site stays:
  a guard's "weaker than its name" hedge, a decision "stated at its site", a "commented decision".
  A sweep shows it changed nothing but comments with `node scripts/comments-only.mjs <base>`, weaker
  than its name: it reads committed changes only and never reads a changed `.md` file — its full
  limits are in [writing-claims.md](docs/developers/writing-claims.md). Cost: about three in ten non-blank lines of non-test code were
  comment-only on 2026-09-24.

---

## 2. The gate

Run focused behavioral tests while implementing, including a failing test before a fix. Let the
normal pre-push hook run the local checks once; mandatory package tests and coverage run in CI.
Do not add a whole-workspace local run solely to finish a branch. Broader local runs remain useful
for investigating failures or behavior across packages. Required CI checks must pass on the current head.

The pre-push hook (`.husky/pre-push`) checks sign-offs, frozen install, formatting, lint, root
guards with coverage, and scoped package types. It runs no package tests. Which pushes stop early,
and which keep the full gate: [ci-and-gates.md](docs/developers/ci-and-gates.md).

**Coverage thresholds: every package, and the root project, holds `98/98/98/95`** (owner decision
2026-09-23). A new package holds it from its first commit. The bar is negotiable only
where the rest of a gap could be closed solely by tests that assert nothing useful, and a gap is
never closed by hiding code a test could reach — adding an exclude or an ignore comment over it, or
moving it under `src/testing/`. Guard: `scripts/coverage-thresholds.test.ts`, weaker than its name —
it reads each config's `thresholds` literal as TEXT and never reads an exclude or an ignore comment.
More: [ci-and-gates.md](docs/developers/ci-and-gates.md).

**A mutation floor of 90 breaks the run in every mutation-tested package — `ui`, `ui-core`,
`shared`, `fiscal` and `db`** (the owner's 90-everywhere decision of 2026-09-19). WHERE it bites
differs — on a pull request, only in the weekly run, or only locally — and neither `fiscal`'s nor
`db`'s floor is package-wide. Guard: `scripts/mutation-break-thresholds.test.mjs`, weaker than its
name — it reads the workflow as TEXT for db's bar. Which package bites where:
[ci-and-gates.md](docs/developers/ci-and-gates.md).

Traps, each of which cost a round trip. The mechanism behind every one is in
[ci-and-gates.md](docs/developers/ci-and-gates.md) — read it before changing anything about CI, the
hook, or how tests are scheduled:

- **`prettier --check` on an IGNORED path prints the same line as a clean one.** `docs/` is ignored
  whole, so `pnpm exec prettier --file-info <file>` is the one that discriminates — it prints
  `"ignored": true`.
- **Check every command's exit status.** A shell sequence separated by newlines reports only its
  LAST command's status. Use `&&` for dependent validation steps, or capture each status separately.
- **CI's test jobs measure coverage, never plain `test`**: `test:coverage`, or `test:shard` with
  the package's `-merge` job enforcing the bar. Verify that package’s coverage or merge job on the
  current head; run `pnpm --filter <pkg> test:coverage` locally when investigating a failure.
  Vitest `--shard` splits by FILE COUNT, so `N` must never exceed a package's test-file count.
  Guard: the "run no more shards than the package has test files" case in
  `scripts/ci-workflow.test.mjs`, weaker than its name — it counts files named `*.test.ts` under the
  package, not what the package's Vitest config includes.
- **A browser package's shard coverage merges through `scripts/vitest-shard-coverage-merge.mjs`,
  never a plain `--merge-reports`**, which on Vitest 4.1.11 counts a file some shards never loaded
  twice and reads functions low. Cost: the venue-service merge failed at 97.44% functions against
  99.32% unsharded. Guard: the browser-merge case in `scripts/ci-workflow.test.mjs`, weaker than its
  name — it reads `ci.yml` and package.json as text, and counts a package as browser-mode when its
  `devDependencies` name `@vitest/browser-playwright`, not by reading its Vitest config. Receipt:
  [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **Moving harness code out of a `.test.ts` and into `src/testing/` can put it under coverage and
  mutation**, depending on the package's coverage settings and Stryker `mutate` list; a test file is
  measured by neither. Cost: `packages/db`'s branch coverage fell below its bar.
- **CI does not run every check on every push.** Read the `changes` job's `code`, `scope` and
  `packages` outputs before treating a green PR as evidence about the workspace.
- **No front-end bundle is built by a pull request that changed no image input**
  (`isImageInputPath`, `scripts/changed-scope.mjs`), and wherever one is built nothing opens it, so
  a bundle that renders nothing passes anyway.
- **esbuild bundles sharp without complaint, and the bundle it builds cannot be loaded.** Every
  Node bundle is built by `scripts/bundle-node.mjs`, which leaves sharp out of all of them, and the
  box image copies sharp into `/app/node_modules`. Guards: `scripts/deploy-image-env.test.ts`,
  weaker than its name (it finds a direct `esbuild` call by reading package.json TEXT); the
  bundle-smoke grep in `.github/workflows/ci.yml`, which reads `dist/server.js` alone; and
  image-smoke's sharp step.
- **Two pushes to `main` must never share a CI concurrency group.** Cost: a code merge that got NO
  run at all, so check after a merge that its own run exists. Publishing asks
  `scripts/main-tag-guard.sh` before moving `:main`. Guards: `scripts/ci-workflow.test.mjs` (reads
  ci.yml alone, as TEXT) and `scripts/main-tag-guard.test.mjs`.
- **A cheap job can still be the critical path.** Sort a run's jobs by duration before calling one
  cheap enough to leave ungated.
- **The GHA cache is a shared per-repository budget, evicted least-recently-used.** Name the entries
  a new exporter would compete with before adding it.
- **Every workflow job carries `timeout-minutes`, except one that calls a reusable workflow, whose
  called jobs carry it**; GitHub's default is six hours. Cost: PR #1399's image smoke sat 46 minutes
  on one cache download. Guard: the job-time-limit cases in `scripts/ci-workflow.test.mjs`, weaker
  than its name — it reads text, does not judge the number, and never reads a called workflow kept
  in another repository.
- **An apt-get in a workflow, `deploy/Dockerfile`, `deploy/waitron.sh` or the bench's CA probe image
  runs under an outer `timeout`, and is retried when it stalls or exits non-zero**, because apt's own
  read timeout did not end a wait on a mirror sending a byte every 5 s. A workflow's
  `playwright install --with-deps` runs apt too, so it takes the same outer `timeout`. Cost: main run
  37771042263's image smoke sat silent in `apt-get update` until its 15-minute limit, and `publish`
  was cancelled with it. Guards: the apt-wait and `--with-deps` cases in `scripts/ci-workflow.test.mjs`
  and the apt-wait cases in `scripts/deploy-image-env.test.ts`, weaker than their names — they read
  text and do not check the retries; the `apt_get` wrapper cases in `scripts/waitron-sh.test.mjs` run
  waitron.sh's retries under stubs. Receipt:
  [ci-and-gates.md](docs/developers/ci-and-gates.md#every-apt-wait-is-bounded).
- **The pnpm changed-since filter silently matches nothing in a `git worktree`**, and all feature work
  happens in one. Verify anything touching the filter in a clone or on a real PR.
- **`pnpm --filter ""` is a hard error**, and an unquoted `$PACKAGES` expansion still GLOBS. Both
  gates build filters as positional parameters under `set -f … set +f`.
- **A scoped `pnpm` run that selects nothing REPORTS SUCCESS.** CI checks the selection with
  `scripts/changed-packages.mjs runnable test:coverage`; the hook checks `runnable typecheck`.
  A green selection guard alone does not mean a check ran.
- **The workspace root is outside `pnpm -r`**, so root config is linted but never typechecked, and
  `eslint.config.js` is not type-aware.
- **Two TypeScript compilers are installed on purpose, and there is no `tsc` at the ROOT.** A
  package's `tsc` is version 7; the root resolves `typescript` to the version 6 API (binary `tsc6`).
  Cost: raising the root to version 7 makes `pnpm lint` refuse to start with no results at all.
- **A name-filtered test run does not load the package's guard suites** nor any e2e suite pinning a
  shared wire body with `toEqual`. A focused pass proves only those cases; CI supplies package-wide
  coverage.
- **Adding a workspace package fails root guards until it is named in the shard lists**, and
  one of them CRASHES rather than asserting, so the message names a missing `vitest.config.ts`
  and reads like a broken checkout.
- **A hardcoded cross-package list goes stale when a manifest or scope changes, and scoped CI hides
  it.** Grep for tests that pin the list, run those guards, and verify CI selects every affected consumer.
- **Every package whose vitest config enables browser mode runs in real headless Chromium**
  (`grep -l browser */*/vitest.config.ts` — two levels, not one — says which). Concurrency is
  decided by measured headroom (`memory_pressure | grep free`), never by a count: beside ANOTHER
  SESSION's browser run when free memory is well above 15% (owner decision 2026-09-24), never beside
  a backgrounded whole-workspace `pnpm -r test:coverage`. Chromium's launch depends on a Codex
  seat's PERMISSIONS, not on Codex.
- **A migration can fail on a box that already has a trigger naming what it changes**, which a
  fresh database migrated in one go never has. `applyMigrations` removes the change feed first for
  that reason (`installChangeFeed` in `apps/server/src/boot.ts` reinstalls it); a rebuild of a table
  another set's trigger BODY reads still fails. Guard: `scripts/migration-upgrade.test.ts`, weaker
  than its name — its rows are synthetic and counted, not compared, and it installs today's
  change-feed list, and today's append-only list less the tables the previous step lacked, at every
  step. Cost: an earlier bricked box that was wiped, and a box that failed three
  starts on 2026-09-26.
- **The upgrade test makes its scratch directory under `scratchParent()` (`scripts/scratch-dir.mjs`),
  which picks `/dev/shm` when it exists, because every commit waits for the disk.** Cost: it timed
  out in CI five times. Nothing guards it. Receipt:
  [ci-and-gates.md](docs/developers/ci-and-gates.md#the-upgrade-test-keeps-its-database-in-memory-on-linux).
- **The stream loop and pause tests' CI step sets `TMPDIR=/dev/shm`, in CI only.** Cost: a main
  run failed the pause test's bound of at least 1000 ms; a probe reproduced it on one runner in 20,
  catching a disk stall that held one commit for about a second. Guard:
  `scripts/ci-workflow.test.mjs`, weaker than its name — it reads `ci.yml` as text and never reads
  the step's test files. Receipt: [testing-guide.md](docs/developers/testing-guide.md), "In CI their
  temporary files are in memory".
- **The stream tests' CI job sets loopback's MTU to 1500 before they run, in CI only.** Cost: the
  pause test's last restore failed twice in CI, each about 31 s after the stream resumed, just past
  its 30 s ceiling.
  Guard: `scripts/ci-workflow.test.mjs`, weaker than its name — it reads `ci.yml` as text. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md#the-stream-tests-ci-job-gives-loopback-a-normal-networks-packet-size).

**Claude never pushes with `--no-verify`**; the owner may, in an emergency (owner decision
2026-10-03), and the failure still has to be fixed because CI runs the same checks. The hook's
failure message says so beside its skip hint, pinned by `scripts/pre-push.test.mjs`. A hook failure the PR does not reproduce is a check CI has deferred to the
unfiltered `main` run, not a wrong hook.

---

## 3. Conventions reviewers enforce

One line each; the receipt for every one is in its topic file. **Read that file before working in the
area** — these lines tell you what the rule is, not why it exists or how it broke. Where a guard is
called weaker than its name, the topic file lists what it does not see.

### Screens, forms and the dashboard — [conventions-ui.md](docs/developers/conventions-ui.md)

- **New or changed forms use the shared UI contract in [design-system.md](docs/developers/design-system.md) → Forms.**
  Required fields visibly marked; an invalid submission explains itself beside every bad field and in
  one localized message at the bottom of the form, on its own line above the buttons, and the action
  stays disabled until the fields are fixed — no summary at the top. A refusal from a request never
  disables the action by itself, and one that names a shown field says so under that field (owner,
  2026-09-29). A form that saves opens with its action quiet and disabled until its draft changes,
  through `draftScopeFor` and `saveActionState` plus an early return in its save handler (owner,
  2026-10-07, A331); the forms that follow it are listed in design-system.md, and nothing guards it
  across screens. A button that is not a save is drawn quiet while it waits for a choice, a
  selection or a load, or while its row's own state rules it out, and in its own colour once it can
  act or while its own request is sent (owner, 2026-10-08, A416 and A427); its exceptions are in design-system.md → Forms, and nothing guards it
  across screens. A field's hint is its placeholder. A short explanation is a hint, not a "?"
  button (owner, 2026-10-03); nothing guards that across screens (backlog A237). Every input has a
  semantic `name`, never a generated widget id. The owner's other dated decisions, and the sign-in
  exception, are in [conventions-ui.md](docs/developers/conventions-ui.md).
- **A screen does not draw its own form field**: a `<select>`, a `<textarea>` or a text `<input>`
  comes from a field primitive; where none fits, add to one or add one (owner, 2026-10-01). Cost:
  a native dropdown cannot take the approved look (A178). Guard: `scripts/native-form-fields.test.ts`,
  weaker than its name — it reads string literals, and holds the files it allows by name only to a
  line count.
- **Before treating a numeric field as whole numbers, follow its checks and wire conversion and
  try a fraction.** Cost: A284 almost skipped a logout timer because its comment said whole minutes;
  receipt: [conventions-ui.md](docs/developers/conventions-ui.md).
- **Normalising a field while typing preserves the native selection.** Cost: A284's decimal-mark
  conversion moved the cursor to the end during a middle edit. Guards: the EN/ES caret cases in
  `wt-input.test.ts` and `wt-price-input.test.ts`; see [conventions-ui.md](docs/developers/conventions-ui.md).
- **A new dashboard dialog or page holding staged input takes a draft scope from `draftScopeFor`
  (which resolves `leaveCoordinatorFor`) and has a `*.unsaved.test.ts`.** Cost: W98's Menu timetable screen reached review without one.
  Nothing checks it across screens. See [design-system.md](docs/developers/design-system.md).
- **Resolve live content and receipt snapshots separately.** Filtering snapshots by enabled content
  languages hid recorded names.
- **Each surface shows ONE of a product's three names — staff, customer-facing or kitchen — and a
  fixture gives the three DIFFERENT text**, or the test passes whether the surface reads the right
  name or the wrong one. Which surface reads which: [products.md](docs/developers/products.md).
- **A replay reports the original transaction facts; side effects are gated separately.** Cost: cash
  change returned as zero on a retry, because displaying change was treated as dispensing it.
- **Compare saved selections by values — not by JSON key order, not by the order they were sent, and
  not by the order they were OFFERED in either**, and see which LIST a stored row came from. Cost: a
  quantity-only held-order edit deleted every line and re-priced the dish. Guard: the quantity-only
  held-order edit case in `apps/server/src/working-order.test.ts`.
- **A screen puts a refusal beside a field by what the error CARRIES, checked where it is thrown.**
  `product.invalid` names a `field`; `content.translation_required` names only a LANGUAGE.
- **A successful write followed by a failed refresh is a load failure, not a failed save.** Close the
  editor after the write succeeds, then refresh separately — a retained create form invites a
  duplicate submission.
- **Automatic dashboard reads are passive session activity.** Use the shared query controller or the
  request primitive's `passive` option, or polling keeps an unattended dashboard signed in. Observer
  callbacks assign snapshots; they do not rerun loaders that reset drafts.
- **A screen that shows a read's and an action's failure in one field remembers which one set it:
  the reads' recovery clears only a read's message, a reload that can finish after another action
  failed clears only a read's message, and a read's failure does not replace an action's**. Nothing
  guards it across screens. See
  [dashboard-live-updates.md](docs/developers/dashboard-live-updates.md).
- **A one-off reload beside a live subscription keeps a snapshot delivered after the reload began,
  and both paths apply the same replacement checks.** Cost: A413's reopening read hid a newer ask
  and left its replaced Pair dialog open. Covered in `apps/dashboard/src/screens/devices-screen.test.ts`;
  the receipt is in [conventions-ui.md](docs/developers/conventions-ui.md).
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
- **A login's refusal never says whether the account exists** (owner, 2026-09-30): an unknown,
  suspended or pending account, a wrong password, PIN or code and, on a till's PIN sign-in, a person
  the device's profile does not admit all answer one code
  (`password.invalid` or `pin.invalid`) after the same hashing work, shown as one sentence, marking
  no field on a sign-in form — only a missing or malformed value is marked there; identity's
  refusals carry the real cause as a log-only `reason`. One owner-approved exception:
  `passkey.not_registered`. Guards: the one-answer cases in identity's login suites and the route
  suites [conventions-ui.md](docs/developers/conventions-ui.md) names, weaker than the set looks — a new sign-in route is seen by none.
- **A device's profile and the signed-in person must both allow what a till does.** A till route
  that orders, takes a payment, prepares, hands over, prints or opens the drawer checks the
  profile's action beside the person's permission, except the routes the map atop
  `apps/server/src/till-api.profile-actions.test.ts` leaves unchecked by decision; the profile's
  zones bound where it serves, and its admission list who may sign in. A new till route adds a row
  to that map and to the zone map atop `apps/server/src/till-api.profile-zones.test.ts`, and a
  refusing case — weaker than that sounds: both route maps are comments. Cost: W97's per-task
  review found a bill refund route checking no action.
- **A `wt-data-table` row-menu column is keyed `actions` and declared `pinned: "end"`**, so the
  menu stays on a phone's screen (owner decision, A155). Guard: `scripts/pinned-actions-column.test.ts`,
  weaker than its name — it knows a menu column only by the literal `key: "actions"`, so every
  object with that key is held to the rule and a data column must take another key. See
  [design-system.md](docs/developers/design-system.md).
- **Markup a screen hands to `wt-data-table` as a cell is styled with `part=`/`::part()`, never a CSS
  class.** The cell's nodes live in the TABLE's shadow root, so the screen's own class rules reach
  nothing. Cost: the categories screen's swatches and thumbnails never rendered, through review and
  a green suite.
- **Every colour, spacing, radius and font reads a `--wt-*` token**, and the name read must be
  declared. No hex, no named colours, no `rem`/`em`. Guards: `packages/ui/src/no-hardcoded-chrome.test.ts`
  (scans `packages/ui` alone; the rule covers any component or view) and
  `scripts/style-token-names.test.ts`, weaker than its name — it reads text and matches a read
  against declarations anywhere in the tree.
- **A new `wt-*` primitive needs two specific tests**, not "some tests": a token-painting test, and an
  axe accessibility test in a sibling `*.a11y.test.ts` covering each distinct state in both themes.
- **A shared `wt-*` component's custom events are named `wt-*`, carry `detail`, and are dispatched
  `bubbles: true, composed: true` — and the triggering event is stopped with
  `event.stopPropagation()` before re-emitting**, or, for a composed trigger such as `input`, the
  consumer observes the change twice. App screens and app-owned components may name their own
  events plainly.
- **A retained hardware registration must remain re-addable after deactivation.** Discovery matches
  disabled printers and card readers too; each reactivates the existing id (printers, devices and
  card readers offer Enable).
- **A narrower roll in a wider receipt printer needs an explicit print area before native centring.**
  Cost: a shifted, clipped 58mm receipt. Guard: `apps/server/src/receipt-ticket.test.ts`.
- **The hardware transport seam is `@waitron/print-agent`, and it is database-free.** It imports no
  other package in this repo, and `@waitron/printing` depends on IT, never the reverse. The guard is
  the `import-x/no-restricted-paths` zone in `eslint.config.js`, not the empty `dependencies` block.
- **A container that must reach a hot-plugged USB printer mounts `/dev:/dev:ro`**, plus
  `device_cgroup_rules: ["c 180:* rwm"]` and `group_add: ["7"]` — not a `/dev/usb` subdirectory bind
  and not a hard `devices:` line.
- **The print agent runs under `deploy/apparmor/waitron-print-agent`, named through
  `WAITRON_PRINT_AGENT_APPARMOR` only after `waitron.sh` has loaded it; a `bluetoothctl` call that
  sends a bus message the profile does not list is refused until the profile gains a rule for it.**
  Cost: the agent silently listed no Bluetooth printers on the owner's box. Guards, weaker than
  their names: image-smoke (no Bluetooth on the runner) and `scripts/deploy-image-env.test.ts`
  (reads the profile as TEXT).
- **The unauthenticated recovery page's title and action are fixed strings chosen by the error
  code; its log tail shows the failed start's own lines through `redactSecrets` and HTML-escaped**
  (owner decision 2026-09-26). That redaction masks only a password in a URL, which is why no
  code's params and no logged message may carry a secret.

### Data, modules and migrations — [conventions-data.md](docs/developers/conventions-data.md)

- **Default optional request fields only when absent, and check enum types before comparing values.**
  Explicit null and coerced arrays passed modifier validation. An extras list's `maxPicks` null and
  the seat-a-table route's `guestCount` null are deliberately outside the rule.
- **Error codes name the DOMAIN CONCEPT, never the throwing package** — `series.not_found`, not
  `db.series_not_found`. **Before a venue is live, a code may be renamed or deleted freely; once one
  is live, either is a migration** (owner decision 2026-09-26). Either way it is one change in which
  every copy in the tree moves or goes; once live, stored copies are rewritten too and a reader
  outside this repository accepts both names until both sides are deployed. Stored copies and prefix
  matchers, which a grep for the code cannot find, are listed in
  [conventions-data.md](docs/developers/conventions-data.md).
  `server.*` is reserved for facts about the process itself. Every file that throws a code imports its registry.
- **A recorded incident code needs an area claim and English and Spanish alert wording.** Guard:
  `scripts/alert-codes.test.ts`, weaker than its name — it reads literals in hand-listed files.
- **Spanish domain terms are deliberate, and a module declares its own.** One declaring home per
  word; a fiscal term never goes in the base list. Guard: `scripts/english-only.test.ts`, weaker
  than its name — it finds comments without a parser. `apps/*` is out of scope by a recorded
  decision, so Spanish identifiers in app UI code are caught only by review.
- **The composition list lives in `@waitron/composition`, and it is the only place that names every
  module.** Generic code reaches the regime through the descriptor's `provisioning` and `fiscal`
  seats. The boundary is the swappable SLOT, not "any module". Guard: `scripts/module-seams.test.ts`,
  weaker than its name (it reads text) — shrink its allowlist, never grow it.
  `@waitron/dashboard-modules` is the browser-side twin.
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
  name — they read text, and a new binary or system package is seen by none of them.
- **`@waitron/db`'s `exports` map is enumerated, not a wildcard**, so `apps/server` cannot deep-import
  its `errors.ts`.
- **Never build SQL by string concatenation — except where the engine takes no bound value**: an
  identifier, and the body of a generated trigger. For those, either escape
  (`quoteIdent`/`quoteLiteral`, as the change feed does, `packages/db/src/change-feed.ts`) or
  validate and throw (as the append-only installer does, `packages/store/src/append-only.ts`).
  Neither is not acceptable; "the callers only pass safe values" is the §1 defect class.
- **A `sql` scalar subquery correlated to the OUTER query's table breaks silently when that table is
  the `.from()` base rather than a join** — no error, a wrong answer. Check base-vs-join and READ the
  emitted SQL with `.toSQL()`.
- **An untargeted `.onConflictDoNothing()` absorbs EVERY unique conflict, not only the primary
  key's.** Name the target when the table has more than one unique constraint and the code reads an
  empty result as a specific cause. Nothing guards this.
- **Rewriting rows one at a time inside a transaction can break a unique index the FINAL state
  satisfies.** Replacing the set — delete then insert — needs the `REFERENCES` grep first:
  nothing outside the table may hold a key into it.
- **Resolve shared catalogue data once before a basket's line loop.** Never await a zone, product or
  variant read per line. Guard: `apps/server/src/working-order.test.ts` (one zone snapshot, no
  per-line resolver).
- **The tables `scripts/write-path-tables.json` lists — `tenants`, `nodes`, `deployment`,
  `mirror_config`, `node_roles` — request code may read and never write, and the database does not
  refuse the write.** A write of one of them lives only in the files that JSON names: requests
  and the paths that write these tables share one venue handle (`ownerDb` is a name, not a separate
  handle), so that file list is the only separation. Guard: `scripts/write-path-tables.test.ts` is
  the whole of the enforcement, and weaker than its name — it reads TEXT and judges a FILE, not a
  call chain.
- **Multi-table writes share ONE transaction, and `withTransaction` IS that transaction.** Write-path
  functions take a `tx: Transaction` and never open their own; a route handler opens exactly one
  `withTransaction` per request. This is a convention, not a compiler guarantee — `Database` is
  assignable to `Transaction`. A secret check should be the exception: it takes the `Database` and derives
  its key with no transaction open (identity's `checkPin`, `checkManagerPassword`,
  `checkOwnPassword`), and a new route that forgets the early check, or forgets to take turns
  (`inTurn`, `apps/server/src/attempt-turns.ts`), derives under the lock or once per attempt in a
  burst, unnoticed. **Splitting one logical change across transactions is a commented decision,
  never a default.** **Queries on one transaction are awaited in turn, never `Promise.all`** — this
  engine is synchronous, so two statements issued together run one after the other in an order
  nothing states. No guard enforces it.
- **A read taken while ANOTHER caller's write transaction is open sees committed rows only.** The
  store routes by ASYNCHRONOUS CONTEXT and per-body identity, so a read written inside the body
  still sees that body's own rows (`packages/store/src/connections.ts`); three shapes are outside
  the rule, each stated at its site. Cost: a concurrent read returned rows a rollback then removed.
  Guard: the routing cases in `packages/store/src/index.test.ts` and `connections.test.ts`, weaker
  than the set looks.
- **A statement this engine refuses backs out ITSELF, not the transaction around it** — so catching
  a refusal and carrying on in the same `tx` is safe. **A TEST still catches such a
  refusal OUTSIDE the transaction**, around the whole `withTransaction`, and no guard enforces that.
- **A refusal under result code 1811 is identified by its words, never by `isRefusal` alone.** An
  `ON DELETE RESTRICT` key and every trigger's `RAISE(ABORT)` share the code; `restrictRefused` and
  `triggerRaised` (`packages/db/src/constraint-target.ts`) read the message too. Nothing guards it.
- **One process owns a venue folder at a time.** `openVenueStore` holds `venue.lock` and refuses a
  second PROCESS (`provisioning.database_in_use`); opens inside one process share the hold. A tool
  documented to run beside the server passes `exclusive: false`; a command that changes the
  folder's files takes `lockVenueDatabase` before its first change. Never unlink `venue.lock` or
  `recovery.lock`; every change to `recovery.json` goes through `updateRecoveryState`. Guards:
  `packages/store/src/venue-lock.test.ts` and `apps/server/src/recovery-race.test.ts`, weaker than
  their names — each proves the lock, not that every caller takes it. The Litestream child, the
  holder file and the watchdog are in [conventions-data.md](docs/developers/conventions-data.md).
- **A duty `bootServer` starts pushes its stop onto `undoOnFailure` as soon as it exists, before
  the next step that can throw** (`apps/server/src/boot.ts`), or a failed start leaves it running on
  a store the unwind has just closed. The landing listener, started last, is the one step not on the
  list. Guard: `apps/server/src/boot.failed-start.test.ts`, weaker
  than its name — it covers only the duties it names.
- **There is no tenant column. The taxpayer is the one row in `tenants` (id = 1, singleton check); a
  query that wants "this tenant's rows" reads the table.** (2026-09-14, #378.) Guard:
  `scripts/no-tenant-column.test.ts`, weaker than its name — it matches the column's spellings and
  skips test files.
- **`packages/db/src/schema/columns.ts` is the only file that names the engine's column and table
  types.** A table declares `id`, `money`, `label`, `table` and the rest from there, never `text()`
  or `integer()` straight from `drizzle-orm/sqlite-core`. One scoped exception: `text` in
  `packages/fiscal-verifactu/src/schema/registros.ts`. Guard: `scripts/column-vocabulary.test.ts`,
  weaker than its name — it reads the import line as text and forbids only the builders the
  vocabulary itself imports, so `blob` passes anywhere.
- **A money column holds a count of whole cents, and the conversion happens AT THE ROW**
  (`packages/shared/src/cents.ts`: `decimalToCents` in, `centsToDecimal` out, `rawCentsToDecimal`
  for a raw-SQL read, which casts `cast(x as text)`). Above the row every amount stays the exact
  `Decimal`; a money total summed out of JSON is summed in JavaScript at the money scale. **Nothing
  guards the boundary itself, and there is no LOUD form of getting it wrong**: a money column
  accepts `25.00`, `"21.50"` and `"abc"` alike. Guards, both narrower than their names:
  `packages/db/src/schema/columns.test.ts` and `packages/shared/src/conventions.test.ts`.
- **A quantity column counts whole thousandths and a rate column whole basis points; neither is the
  money scale** (`packages/shared/src/scales.ts`, beside `cents.ts`). A blanket "every numeric
  becomes cents" does not EMPTY a quantity, it misreads one. The converters hold the bound, because
  an integer column does not; the raw quantity reader reads totals, so like the money one it bounds
  only at what a number counts exactly. A rate's CHECK constraint is written against 10000. Guard: the shared
  schema-conformance suite, `packages/db/src/testing/schema-conformance.ts`, which a migration set
  opts into — a set with none is unguarded.
- **The database never rounds a quantity — `decimalToThousandths` owns the third place.** A test
  asking storage to round is testing something no product path does.
- **A time stored as text and compared or sorted as text is right only while every writer stores
  one spelling**, because the engine compares characters. Normalise at the writer, as
  `shiftInterval` (`packages/workforce/src/clocking.ts`) and the `storedTime` helpers do. Cost: W22
  (#1134), a valid shift refused or listed out of order. Nothing guards the one-spelling rule across
  the columns.
- **A new table is classified `ledger`, `state` or `local` in its module's `<MODULE>_CLASSIFICATION`
  list, and a table that must never be corrected is declared with `appendOnly()` instead of
  `classify()`** — `applyMigrations` turns those declarations into a `RAISE(ABORT)` trigger pair,
  but only from a `migrationOptionsFor(...)` result; a plain options array gets none of those
  triggers, silently. **The CLASS is not the trigger set.** A trigger cannot refuse `DROP TABLE`.
  Guards: `scripts/classification-complete.test.ts`, `scripts/append-only-triggers.test.ts` and
  `scripts/apply-migrations-callers.test.ts`, the last weaker than its name — it checks the call's
  shape, not the sets handed to it.
- **A new append-only table travels in both its module's exported migration descriptor and
  `packages/migrations/migrations.manifest.json`.** Guards:
  `scripts/append-only-migration-sets.test.ts` and `packages/composition/src/composition.test.ts`.
- **A streamed `venue.db` holds two tables no migration created, and its folder a directory no
  store opened** (Litestream's `_litestream_seq`, `_litestream_lock` and `.venue.db-litestream/`).
  Code that lists a live or restored database's tables, or that empties, copies or restores the
  venue folder, must expect them; no guard finds a new site that does not.
- **A `local` row belongs to one node, so no foreign key may join a `local` table to a
  `ledger`/`state` one, in either direction.** A `local` row that needs a venue row keeps the plain
  id and names, at the column, what establishes the target exists — or that nothing does, and where
  the refusal moved to. Guard: `scripts/two-file-foreign-keys.test.ts`, weaker than its name — it
  reads drizzle's generated snapshots, not hand-written SQL.
- **A `local` table says what ties a row to its node** — a `node_id` column that every read and
  write names, a seal only that node's key opens, or rows the transaction that wrote them deletes.
  A node holding another node's copy of `venue.db` must read its own rows or none. No guard makes a
  new `local` table say which.
- **Anything that works as a live login is stored as a hash, because a primary streams the whole
  database to the owner's bucket once one is set up** (`hashSessionToken`, `@waitron/identity`).
  Guards, weaker than the rule: the "what a copy of the database holds" cases in
  `apps/server/src/me-api.test.ts` and `apps/server/src/till-api.test.ts` present the row's id
  alone, and only the dashboard's stored hash is tried as a token
  (`packages/identity/src/management-session.test.ts`); a new login table is seen by nothing.
- **A module depends on another migration set when its SQL `REFERENCES` one of that set's tables,
  puts a `CREATE TRIGGER … ON` one of them, names one inside a trigger's body, or writes one
  at top level — and its descriptor's `requires` must name it.** The engine will not catch a
  missing body target. Guard: `scripts/module-graph-honesty.test.ts`, weaker than its name — it
  reads SQL as TEXT and recognizes a fixed set of statement shapes.
- **A column of a transferred table that holds another row's id is a foreign key, a declared
  `references` entry, a location column or left out of the export** (`locationColumns`, `omit`);
  any other column the export carries arrives holding the exporting venue's id. Guard:
  `scripts/id-columns-are-references.test.ts`, weaker than its name — it knows an id column only by
  a name ending `_id` or `_ids`.
- **No new table enters the core migration set without a stated reason in the commit.** A domain
  table a module owns belongs to that module's own set, where its append-only classification
  travels with it.
- **A constraint that lives only in hand-written migration SQL is one regeneration away from gone,
  and nothing else in the tree notices.** Declare every foreign key and every unique index in the
  TypeScript schema; where one genuinely cannot be declared, say at the column what it cost and
  where the refusal moved to. Cost: a regeneration dropped 33 foreign keys and 13 unique indexes.
  Guard: `scripts/schema-constraints.test.ts`, weaker than its name — it reads the built schema
  rather than trying an offending insert, and matches a unique index by NAME.
- **A drizzle migration-number collision on rebase is fixed by regeneration, never by hand-editing the
  snapshots or `_journal.json`.** Reset the migrations dir to main's state, regenerate, and verify by
  RUNNING `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/migrations-match-schema.test.ts` and
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
- **A drizzle table rebuild on this engine runs with foreign keys ON, so its `DROP TABLE` silently
  deletes every cascading child's rows, and fails on a `no action` or `restrict` child holding rows.**
  Before shipping a rebuild, list the foreign keys that point at the table. Cost: rebuilds emptied
  `product_categories` and three menu tables while reporting success.
- **A drizzle-kit 0.31.10–0.31.11 generation that rebuilds a table must not also add a column to
  it** (`no such column`). Add the column in one generation and its CHECK in the next. Cost: paid
  three times — #721, #750 and A238's `incidents` migration.
- **A drizzle-kit 0.31.11 table rebuild writes an expression index back as quoted column names,
  which this engine refuses.** Take the index out of the schema for every generation that rebuilds
  its table and add it back in a generation of its own, with a note at the index.
- **A foreign key whose target has no unique index is refused at the first WRITE, not at migrate
  time** (`foreign key mismatch`). So a green migrate is no evidence a new key is sound — write
  through it.
- **Editing a shipped migration file — even only its comments — makes every venue it already
  migrated refuse to start** with `provisioning.database_ahead`: drizzle stores a hash of the whole
  file. Such an edit ships only with a venue reset, said in the PR's first line. Nothing guards it.
  Cost: #1036 restored two edited files byte for byte.
- **Drizzle picks what to apply from `max(created_at)` alone**, never from a position in the journal,
  so an entry at or below a recorded watermark never runs and drizzle raises nothing. Guard:
  `scripts/journal-monotonic.test.ts`, which bites only on a set with more than one entry. A drizzle
  bump starts with `grep -rn 'dialect.js'`.
- **`applyMigrations` refuses to report success on a short set**, throwing `migrations.incomplete`
  rather than serving a half-migrated schema.
- **The box's BOOT path and the bucket rebuild carry an ahead-of-image check; no other migrating
  path does, and `waitron.sh install <ref>` is a one-way door.** `assertNotAhead` throws
  `provisioning.database_ahead`. Every other migrating path runs without the check; the full list is
  in [conventions-data.md](docs/developers/conventions-data.md).
- **An empty value is a valid value** — to whatever receives it, so a reader must turn `""` into
  "unset" itself. An env or prompt value set to `""` falls back to its default exactly as an unset
  one does (`isUnset`, `apps/server/src/env-value.ts`); a path never goes through `resolve("")`,
  which is the working directory; and a reader with no default refuses `""` explicitly.
- **No backwards-compatibility or data-migration code until Waitron is in production.** Until then
  any installation may be reset at any time instead of carrying its data forward (owner,
  2026-10-03). This rule expires the day a real venue is live; add its replacement in the same
  change.

---

## 4. Testing

One line each; the mechanism, the measurement and the incident behind every one are in
[testing-guide.md](docs/developers/testing-guide.md). **Read it before writing a database or
browser test** — most of these rules exist because a test passed while proving nothing.

- **One target.** A suite that needs a database gets a REAL one: `useVenueDb` opens a temporary
  directory with the product's own opener, applies the migration sets it was given and installs the
  append-only triggers. Guard: `scripts/venue-db-helper.test.ts`, weaker than its name — it holds
  only that nothing names the retired helper `usePgliteDb`.
- **Don't own a database in a suite — let `useVenueDb` own it.** Raw `beforeAll`/`afterAll` only
  when the suite legitimately builds its own resource, and then guarded. Guard:
  `scripts/guarded-teardowns.test.ts`.
- **No test suite under `packages/` or `apps/` starts a container; the rigs under `bench/` do.**
  **`TESTCONTAINERS_RYUK_DISABLED=true` is required locally**, and with it off an INTERRUPTED run
  leaks containers; `pnpm reap` removes them by label and age — but not every rig stamps the label.
  Never a blanket `docker volume prune`, and `docker volume inspect` before any manual `rm`.
- **The stream loop test and the stream pause test need two pinned binaries: without them they are
  SKIPPED locally and FAIL in CI.** Install both with
  `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`. A skipped run prints
  `1 skipped` and nothing else, so a local green run of `apps/server` may not have run them. Guard:
  `scripts/ci-workflow.test.mjs`, weaker than its name — it reads `ci.yml` as TEXT, so install
  commands left only in a YAML comment, or in a step an `if:` switches off, pass it.
- **Under an AI agent (`AI_AGENT` or `CLAUDECODE` set), Vitest hides a passing test's console
  output**; unset both to see it.
- **A Vitest run that shows no `Tests` count is no evidence that anything passed, whatever its exit
  status.** Read the count, never a blank output or the exit status of a pipe; under a reporter
  that prints none, read the reporter's own result.
- **A container port-binding timeout needs Docker state as well as the container's own logs.** Save
  `docker inspect`'s `HostConfig.PortBindings` and `NetworkSettings.Ports` before removing the
  container.
- **Draw every port a test needs in one `freePorts(n)` call, before binding any of them**
  (`apps/server/src/testing/free-ports.ts`), never two single draws before either is bound. Nothing
  guards it.
- **An interrupted run also ORPHANS its vitest workers**, which spin at ~100% CPU until `kill -9`.
  `pnpm reap` sweeps these, scoped by ppid 1 AND the shapes vitest leaves in `ps`, never a bare `vitest` match.
- **Concurrent coverage runs must not share a package's report directory, and an intentional second
  one belongs OUTSIDE the package.** Vitest cleans a shared directory, so two overlapping runs over
  the same package end in `ENOENT`.
- **Locate the unfinished package before diagnosing a silent shard as database contention.** A
  Vitest test timer does not bound a browser whose event loop has stopped; use an outer deadline, and
  never a retry as proof of repair.
- **A recurrent stall needs a retained log and a snapshot of whatever it was waiting on.** Locate the
  stalled operation before assigning its cause to resource contention.
- **On Vitest 4 a project's own `maxWorkers` wins, and the outer config's is only the fallback**. **A
  cap that must apply to every project still belongs on the outer config.** Guard:
  `scripts/fiscal-test-budget.test.ts`, weaker than its name — it pins one arrangement, not how
  Vitest resolves the limit.
- **A package that pins one worker inside one of several projects numbers its `groupOrder`s from 1,
  never 0**: Vitest 4 runs a `groupOrder: 0` project that runs one isolated worker AFTER every
  other group. Guard: `scripts/bookings-test-budget.test.ts` — which pins bookings alone.
- **A suite whose test outlasts Vitest's per-test timeout fails HEALTHY runs.** Set the bound above
  the SUM of its waits plus its untimed work, not the largest one; under `packages/` and `apps/` the
  bound usually comes from the package's `vitest.config.ts`. Guard:
  `scripts/spawn-timeout-budget.test.ts`, which scans `scripts/` ALONE — nothing checks the rule
  under `packages/` and `apps/` — and is weaker than its name over the half it covers: it reads
  TEXT and checks only the largest SINGLE wait.
- **A `spawnSync` timeout must clear the CHILD's own worst case, retry loops included**, or it kills
  the child and returns `status: null`, which reads as a broken test. Cut the WAIT, not the retrying
  (`WAITRON_SH_HEALTH_DELAY`). Nothing guards the rule in general.
- **A suite's executable stubs are built ONCE per file, not once per test** — move what each case
  varies into environment variables the stub reads. It pays only on macOS and only where the stubs
  are a large share of the runtime — measure first.
- **A test that shells out to `git` must clear `GIT_DIR` and its family.** Git exports `GIT_DIR` to
  every hook, so a hand-isolated fixture writes into the real repo. Run such a suite once under
  `GIT_DIR` before trusting it.
- **A test that changes the screen's global language restores it before the next case.** Cost:
  A284's split test changed the labels in later transfer cases; receipt: [testing-guide.md](docs/developers/testing-guide.md).
- **Browser passkey tests stub `navigator.credentials`, keeping the WebAuthn library real.** A module
  mock cannot replace an already-loaded browser ES module.
- **Browser recovery tests read the native control inside a shared component.** A host's `checked`
  property can report the expected value while its inner checkbox is visibly wrong.
- **A reopened polling dialog owns a new in-flight gate.** Reset it on close and guard its release
  with the request's generation, or an old read blocks the reopened dialog.
- **A browser test using fake timers must advance an awaited animation frame or restore real timers
  first**, or it stalls on its own paused `requestAnimationFrame`.
- **A browser test that checks what closing a dialog does waits for that dialog's `wt-close` first,
  never for `vi.waitFor`'s one second alone.** `wt-dialog` sends it only when Chromium reports the
  native close, which Chromium queues for the next rendered frame. Cost: a devices-screen test failed
  A441's CI (#1477). Nothing guards it. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md#a-browser-test-waits-for-a-dialogs-close-event-not-a-timer).
- **A test waits for a browser grant, such as a Web Lock, by tracking the request until it is
  answered — never by a fixed sleep.** Cost: the Payments screen's reader-status tests failed CI on
  a late grant, fixed twice — W59 (#1168), then A320 (#1342). Nothing guards it. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md#a-test-waits-for-a-browser-grant-by-tracking-the-request-never-by-a-fixed-sleep).
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
  screenshot DIRECTORY named `*.test.ts`; `sourceFilesIn` checks `isFile()`.
- **A guard that reads the whole tree belongs in the ROOT Vitest project**, which the ungated
  `root-guards` job and the hook run on every non-docs push. The root project does not typecheck, and a module
  tested only from there must be in the root `coverage.include` (a `scripts/**/*.mjs` pattern plus named
  paths) to be measured at all, and excluded from its own package's.
- **Prove a guard by deletion**, and confirm a negative control fails for the reason you think.
- **A proof by deletion says nothing about what the guard wrongly REFUSES, and that needs its own
  case** — the legitimate call that must still be served. Cost: a write-queue re-entrancy guard
  turned every concurrent request in `packages/payments` into a 500.
- **A proof-by-deletion belongs to the SHAPE of the code it was taken against.** Restructure that
  code and the deletion can stop failing while every test stays green — re-run the control, and move
  the proof to whatever still catches it.
- **Measure the old version in a throwaway worktree, never by swapping files in the working one.**
  `git worktree add --detach <dir> <base-sha>`, `pnpm install` in it, and `git worktree remove` it
  after; a copy set aside that cannot be avoided goes in `mktemp -d`. Cost: a stash pop that took
  another session's stash, and edits and test files lost to swaps.
- **A fixture no check reads is unverified data, and a green suite resting on it proves nothing.**
  Cost: the shared alta fixture had drifted into a record AEAT would reject, masking a real defect in
  `recordSale`. When a fixture describes something an authority will judge, run the real check over it.
- **Treat "there is a test" as an unfinished sentence.** Coverage proves a line executed, not that
  anything asserted on the result. Ask which assertion would fail if the behaviour were deleted; "it
  doesn't throw" is not an answer. `pnpm --filter @waitron/ui mutation` checks this systematically.
- **Rejected writes assert the domain error code.** A database constraint error also satisfies
  `toBeInstanceOf(Error)`.
- **`errors.ts` reachability is guarded once, in `scripts/errors-reachable.test.ts`**, weaker than
  its name — it reads text.
- **Vitest 4 ships no default coverage excludes at all.** What scopes a package's report now is its own `coverage.include`.
  `include`/`exclude` still replace rather than merge, and a config measuring nothing still exits 0
  with the thresholds intact, so read the per-file table rather than the exit code.
- **A package config must name its own source tree in `coverage.include`, or an untested file stops
  being counted** — and moving code into one RAISES the percentage. Guard:
  `scripts/coverage-thresholds.test.ts`, which looks for one exact string. That include is not
  anchored to the package, so a sibling whose name extends this one's can land in its report.
- **Use the `/* v8 ignore start */` … `/* v8 ignore stop */` pair, not `/* v8 ignore next */`.**
  Marked `next`, a package's guards failed its branch bar silently (#437). Nothing guards it.
- **A page asserted as a STRING, or reached only through its API, has nothing checking that it
  renders.** Open it and LOOK, in both themes and at phone width. `apps/server`'s string-rendered
  pages have no harness: write the rendered string to a file and open it with the workspace's
  playwright Chromium. Cost: a corrupted colour on `/setup/trust`, and an image library that
  answered 500 to the first person who opened it.
- **`toMatchObject` checks only the keys you list**; a key you never list is never checked at all.
- **A default you did not state is not a value you tested**, and a library default can be computed
  from the RUNNING runtime. State it at every call site that shares it. Guard: the two
  pinned-algorithm cases in `packages/identity/src/passkey.test.ts`.

---

## 5. Fiscal invariants — the unrecoverable ones

- **Printing never opens the cash drawer, and a device opens it only when its profile allows it.** A
  cash payment, or a card hand-keyed on a machine Waitron does not talk to, enqueues a separate
  audited `drawer` job; receipt jobs are `document` jobs and contain no drawer command. A card on a
  connected machine opens nothing. A device opens the drawer of its own drawer choice, else its
  profile's default drawer, not by following its receipt printer, and only when its profile has
  `open-cash-drawer` and that printer is active and has a drawer (`drawerPrinter` and
  `resolveDrawerPrinter`, `apps/server/src/receipt-print.ts`). `take-cash` decides whether a device
  takes cash at all (`assertTakesCash`, `apps/server/src/device-session.ts`, refusing
  `device.cash_not_allowed`). The manual open needs a session on an active device, the profile's
  `open-cash-drawer`, and always `cash.drawer` or the PIN of someone holding it, and opens the same
  drawer the automatic paths would; the one exception is the dashboard's "Test open drawer"
  calibration. Drawer jobs cannot be manually resent. Guards, weaker than the rule: the
  drawer cases in `apps/server/src/receipt-print.test.ts`, `apps/server/src/till-api.receipt.test.ts`
  and `apps/server/src/bill-payments-api.test.ts`, the `device.cash_not_allowed` cases in
  `apps/server/src/till-api.fiscal-sale-paths.test.ts` and `bill-payments-api.test.ts`, the cash
  refund case in `apps/server/src/till-api.profile-actions.test.ts`, the calibration case in
  `apps/server/src/print-api.test.ts` and the drawer resend refusal in
  `packages/printing/src/outbox.test.ts` — each holds only the routes or functions it names, and
  nothing stops a new route queuing a `drawer` job without `drawerPrinter` or taking cash without
  `assertTakesCash`. Detail:
  [conventions-ui.md](docs/developers/conventions-ui.md#a-device-opens-the-drawer-when-its-profile-allows-it-a-handheld-does-what-a-till-does).

- **One database per environment.** A pre-production database is never promoted:
  `invoice_series.next_number` carries across and pre-production sales would leave a permanent hole
  in the production series — which is what Veri\*Factu detects. `WAITRON_ENV` governs this; unset
  means `preproduction`, `production` must be typed out, and `dev` is preproduction plus
  `config.devMode`.
- **Nothing EXTERNAL may block a sale — and a till needs the venue's PRIMARY.** AEAT, the card network
  and the internet are never on the sale path of whichever node is primary: records chain locally and
  the outbox drains later; a card falls back to 4G, a standalone terminal or cash. The till follows
  the primary and never chooses; only the primary sells. Fiscal submission is an outbox, never
  inline. TODAY a venue has ONE node and no failover at all; the intended failover is in
  `docs/backlog.md` → _Replication, membership & failover — residuals_. Detail:
  [conventions-data.md](docs/developers/conventions-data.md).
- **The bucket stream never makes a sale wait on the BUCKET and never fails `/health` — but a sale
  can wait behind Litestream's own local checkpoint, for as long as that checkpoint holds the write
  lock** (measured up to 831 ms on a slowed disk). A copy fifteen minutes behind raises
  `backup.stream_behind`, unless a stopped, refused or unusable-settings alert already explains it
  (`apps/server/src/alert-sources.ts`). The side file is bounded by stopping Litestream at a size limit
  (`backup.stream_paused`) and folding the file back in the write queue
  (`checkpointTruncate`, `packages/store/src/index.ts`). Guards, narrower than the rule:
  `apps/server/src/stream-pause.e2e.test.ts`, `apps/server/src/stream-loop.e2e.test.ts` (both
  skipped locally without their binaries) and the bucket-copy cases in
  `apps/server/src/health.test.ts`. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md#a-sale-can-wait-behind-litestreams-own-checkpoint).
- **`registros_facturacion` is immutable**: it is declared `appendOnly()`
  (`packages/fiscal-verifactu/src/classification.ts`, beside the two filing-case tables), so `applyMigrations` puts a `RAISE(ABORT)`
  trigger on its updates and its deletes. Do not work around them; a value written wrong there stays
  wrong. That trigger pair is the WHOLE of the enforcement — the engine has no permissions, and a
  `DROP TABLE` is refused by nothing at all.
- **Never put our own metadata into a hash.** `entorno` is ours, not AEAT's; a test pins that two
  records differing only in it hash identically. In `computeHuella` it would make every chain
  unverifiable under the other environment.
- **Re-registering a node starts a new chain** and mints a fresh installation number. Correct for a
  reimaged box, destructive for a working one. A cold restore (`waitron-restore`) and a rebuild from
  the bucket both do it automatically for a node that was filing (#248); one restore takes one
  source, never both, or one event would mint two installation numbers. The working-time chain is
  NOT reset on a cold restore — it continues from the backup's head. Guard:
  `packages/workforce/src/restore-continuation.test.ts`. How a restore mints:
  [conventions-data.md](docs/developers/conventions-data.md).
- **On a node that files, every start puts each sale left "being sent" back to waiting before its
  first filing pass** (`resetInFlightClaims`, `packages/fiscal-verifactu/src/drain.ts`) — safe only
  while no second process files from the database: the server opens the folder exclusively, and the
  tools that open it with `exclusive: false` file nothing. Guards: `apps/server/src/restart-reset.test.ts`
  and a case in `apps/server/src/boot.test.ts`, weaker than the rule — nothing checks that a
  non-exclusive tool never files. Detail: [conventions-data.md](docs/developers/conventions-data.md).

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
  and a guard that pins a version number fails its bump.** A bot gets no exemption from the strict
  sign-off check (owner decision 2026-09-27). How to land one:
  [workflow-guide.md](docs/developers/workflow-guide.md) → _Dependabot pull requests_.
- **Do not merge a PR automatically — wait for the user's approval.** Invoking `/land-branch` is that
  approval; nothing else is.
- **Read a review report for completed findings, not just a successful wrapper exit.** Cost: A284's
  first report was only pending prose. Receipt: [workflow-guide.md](docs/developers/workflow-guide.md).
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
  turns. Cost: one agent's commit carried another's staged renames, and a test run beside another
  agent's in the same package printed `no tests`.
- **Development and loopback-only servers must not advertise the appliance's LAN name.** A laptop
  and box both answered `waitron.local`, sending some lookups to the laptop. Guard:
  `apps/server/src/mdns.test.ts`.
- **The dev stack from a worktree is started with `wa-wt demo <worktree-name>` or
  `wa-wt onboarding <worktree-name>`**, never a bare `pnpm dev*` — compose names its project after the
  directory, so an unqualified `docker compose up` starts a SECOND `mailpit` fighting for the fixed
  1025 and 8025 ports.
- **The first dev stack's venue is a seeded directory of SQLite files on the host, shared by
  worktrees that take the first port slot. Moving between worktrees on the same target does not
  wipe that slot's venue — so a branch's migrations can fail on the rows already in it.**
  `wa-wt reset demo <name>` rebuilds it. Cost: repeated dead boots with only a driver stack trace
  to read.

**Docs.** `docs/backlog.md` answers "what should I work on?" — read it before starting anything
unprompted, and **update it in the same change that makes it stale** (the moment it goes stale most
reliably is a MERGE). A change that finishes an entry DELETES it rather than marking it done, and
each point it leaves open becomes its own short entry in the same area; an entry's long detail goes
in its area's file under `docs/backlog/`. A decision a comment or doc cites moves to its area's
`## Decisions and deliberate limits` instead of being deleted, and entries there are never deleted
for being finished. How: `docs/backlog.md` → _How to keep this file honest_.
Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`,
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
Say so in the same line, briefly — "weaker than its name: reads text, not code" — and list what it
misses in the topic file: a hedge is the one thing a failing test can never restore, because the
case it never checks is the case you needed to know about.

**Prune as well as append.** A superseded rule teaches a session to work around something that no
longer exists; delete it and say so in the commit. Natural moments: while addressing review findings,
and when writing a handoff — anything phrased "next time, remember to…" belongs here instead. A
written rule with standing violations needs a guard, not another paragraph.

**Contained, not capped** (owner decision 2026-10-07). This file has no byte limit and no gate on
its size, and is never purged because it is a few bytes over a number. Keeping it small is regular
housekeeping: move a receipt to its topic file and delete a superseded rule whenever you touch an
entry, and run a pruning sweep when the file has grown noticeably — as a loose guide, past roughly
the size the 2026-10-07 sweep left it (about 71 KB). Cost: this file is re-read on every step of
every session and subagent; on 2026-10-07 the always-loaded files were ESTIMATED, not measured, at
roughly 14% of the campaign lanes' subagent cost (their size times the lanes' step count since
2026-10-05, at the cache-read price).

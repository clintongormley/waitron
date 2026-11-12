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
The instances behind each rule are in [writing-claims.md](docs/developers/writing-claims.md#root-receipt-excerpts-moved-on-2026-10-23).

- **A claim of necessity or impossibility needs a receipt** — the command that was run, or a cited
  `file:line`.
- **Reading is not verification.** Run the thing.
- **State the experiment, not the conclusion.** If the sentence describes more than what you ran,
  narrow it.
- **A measurement taken where both answers look alike measures nothing.** Before running a probe,
  say what the FAILING case would print; if that is what you expect to see anyway, you are not
  running a probe. A control in the other direction is the cheapest fix. A receipt someone hands you
  is still a claim.
- **A sentence about what ANOTHER part of the system does is checked by following the call chain to
  that part, not by reading the boundary you just edited.**
- **"Pre-existing", "not a regression", "harmless", "unreachable" and "narrow" are claims.** Check
  with `git log`/`git blame` first; unchecked, say "I believe this predates the branch".
- **The correction is a new claim, and deserves MORE scrutiny than the text it replaces.**
- **Before asserting a convention, grep the siblings** — identifiers AND prose.
- **A behaviour change retires every receipt about the old behaviour — editing a file is not
  auditing it.** Read the runbooks and the README paraphrases across the whole base-to-tip range,
  not the three lines of context a diff shows; per-task review cannot see this class. **The PATH SET
  matters:** read every claim stated in prose, wherever it lives, not only the ones written beside
  an identifier.
- **Claims about the outside world need receipts too — and the source's own words.** Every external
  claim gets a provenance row. Quote, then paraphrase. Two sources that seem to contradict usually
  describe different paths.
- **A class's representative has to be a value the two sides could treat differently.** Pick it from
  what the FORMAT allows, not from the first value that comes to mind.
- **The code is what matters; comments go stale.** Keep a comment only for an invariant, or a
  non-obvious why, that the code cannot show — never history, narrative, or a restatement of the
  code. The receipt lives in the commit message and the PR thread, with at most a one-line pointer.
  Cut on touch, and deliberate pruning sweeps are wanted (owner decision 2026-09-23). Prefer
  deleting to rewording: a rewording is a new claim. A comment another rule here requires at its
  site stays: a guard's "weaker than its name" hedge, a decision "stated at its site", a "commented
  decision". A sweep shows it changed nothing but comments with
  `node scripts/comments-only.mjs <base>`, weaker than its name: it reads committed changes only and
  never reads a changed `.md` file — its full limits are in
  [writing-claims.md](docs/developers/writing-claims.md).

---

## 2. The gate

Run focused behavioral tests while implementing, including a failing test before a fix. Let the
normal pre-push hook run the local checks once; scoped package tests run in PR CI; main pushes run quick checks; the nightly or manual full run enforces package coverage.
Do not add a whole-workspace local run solely to finish a branch. Broader local runs remain useful
for investigating failures or behavior across packages. Required CI checks must pass on the current head.

The pre-push hook (`.husky/pre-push`) checks sign-offs, frozen install, changed-file formatting and
lint, and scoped package types. Global or unknown scopes keep whole-repository formatting and lint.
Tests and coverage, including root guards, run in CI. Which pushes stop early,
and which keep the full gate: [ci-and-gates.md](docs/developers/ci-and-gates.md).

**Coverage thresholds: every package, and the root project, holds `98/98/98/95`** (owner decision
2026-09-23). A new package holds it from its first commit. The bar is negotiable only
where the rest of a gap could be closed solely by tests that assert nothing useful, and a gap is
never closed by hiding code a test could reach — adding an exclude or an ignore comment over it, or
moving it under `src/testing/`. Guard: `scripts/coverage-thresholds.test.ts`, weaker than its name —
it reads each config's `thresholds` literal as TEXT and never reads an exclude or an ignore comment.
More: [ci-and-gates.md](docs/developers/ci-and-gates.md).

**A mutation floor of 90 breaks the run in every mutation-tested package — `ui`, `ui-core`,
`shared`, `fiscal`, `db`, `node-db` and `handover`** (the owner's 90-everywhere decision of 2026-09-19). WHERE it bites
differs, and neither `fiscal`'s nor `db`'s floor is package-wide. Guard:
`scripts/mutation-break-thresholds.test.mjs`, weaker than its name — it reads the workflow as TEXT
for the sharded packages' bars (db, ui and ui-core). Which package bites where:
[ci-and-gates.md](docs/developers/ci-and-gates.md).

Traps, each of which cost a round trip. The mechanism behind every one is in
[ci-and-gates.md](docs/developers/ci-and-gates.md#root-detail-moved-on-2026-10-26) — read it before changing anything about CI, the
hook, or how tests are scheduled. What named guards miss:
[ci-and-gates.md](docs/developers/ci-and-gates.md#root-receipts-moved-on-2026-11-11).

- **`prettier --check` on an IGNORED path prints the same line as a clean one.** `docs/` is ignored
  whole, so `pnpm exec prettier --file-info <file>` is the one that discriminates — it prints
  `"ignored": true`.
- **Check every command's exit status.** Use `&&` for dependent validation steps, or capture each
  status separately.
- **PR CI runs scoped package tests without package-wide coverage; ordinary main pushes run no
  package tests in `ci.yml`; nightly, manual and release runs enforce `98/98/98/95` coverage.** A PR
  tests only the changed packages, not their dependents (owner, 2026-11-08, A1461); those are
  typechecked on the PR and tested nightly. Root coverage remains on every run. Verify the current
  head's selected jobs, and the full run's coverage or merge jobs before claiming full coverage.
  Shard counts must not exceed the package's test-file count. Guard: `scripts/ci-workflow.test.mjs`,
  weaker than the rule. [Modes and
  limits](docs/developers/ci-and-gates.md#scoped-tests-and-full-verification).
- **`apps/server`'s shards are packed by the committed duration table, not Vitest's hash split.**
  Refresh it with `scripts/test-durations.mjs` when a shard drifts past 4 minutes. Guard:
  `scripts/vitest-duration-sequencer.test.mjs`, weaker than its name: checks packing, not a Vitest run or freshness.
- **`mutation-db`'s whole files are packed by the committed `packages/db/mutation-costs.json`, not
  by bytes.** Refresh it with `scripts/mutation-costs.mjs` from a nightly run's reports when a shard
  nears its 25-minute limit or `packages/db` gains files. Guard: the cost-table cases in `scripts/mutation-shard.test.mjs`,
  weaker than their name.
  [Receipt](docs/developers/ci-and-gates.md#dbs-mutation-shards-are-packed-by-estimated-cost).
- **Every CI test job should finish in about 4 minutes** (owner, 2026-10-09 and 2026-10-11).
  Fix the cause, never cut a check. Guards, weaker than the rule: the reporter only warns;
  `scripts/ci-workflow.test.mjs` pins shard counts and 10-minute limits.
- **A browser package's shard coverage merges through `scripts/vitest-shard-coverage-merge.mjs`,
  never a plain `--merge-reports`**. Guard: the browser-merge case in
  `scripts/ci-workflow.test.mjs`, weaker than its name — reads text, not the Vitest config. Receipt:
  [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **Moving harness code out of a `.test.ts` and into `src/testing/` can put it under coverage and
  mutation**, depending on the package's coverage settings and Stryker `mutate` list.
- **CI does not run every check on every push.** Read `changes` outputs `code`, `scope`, `packages`
  and `full`. Main's named package gates are false even when `scope` and `packages` name code
  changes. PR evidence is not reused. Container publication, including `:main`, follows
  full scheduled/manual main verification or a fully checked release tag, never an ordinary main
  push. [Modes and limits](docs/developers/ci-and-gates.md#scoped-tests-and-full-verification).
- **`bundle-smoke` builds dashboard, setup and till but opens only setup in Chromium with server
  reads intercepted**; PRs whose scope is `documentation` or `root` skip it. Guard:
  `scripts/bundle-smoke.test.mjs`, weaker than its name.
  [Detail](docs/developers/ci-and-gates.md#built-applications-in-bundle-smoke).
- **Every Node bundle is built by `scripts/bundle-node.mjs`, which leaves sharp out; the box image
  copies sharp into `/app/node_modules`.** Guards: `scripts/deploy-image-env.test.ts` and bundle-smoke
  (weaker than their names: read text; bundle-smoke reads only `dist/server.js`), and image-smoke's sharp step.
- **Two pushes to `main` must never share a CI concurrency group.** Check after a merge that its own
  run exists. Publishing asks `scripts/main-tag-guard.sh` before moving `:main`. Guards:
  `scripts/ci-workflow.test.mjs` (reads ci.yml alone, as TEXT) and
  `scripts/main-tag-guard.test.mjs`.
- **A cheap job can still be the critical path.** Sort a run's jobs by duration before calling one
  cheap enough to leave ungated.
- **The GHA cache is a shared per-repository budget, evicted least-recently-used.** Name the entries
  a new exporter would compete with before adding it.
- **Every workflow job carries `timeout-minutes`; a reusable workflow's called jobs carry it.**
  Guard: `scripts/ci-workflow.test.mjs`, weaker than its name: reads text.
- **An apt-get in a workflow, `deploy/Dockerfile`, `deploy/waitron.sh` or the bench's CA probe image
  runs under an outer `timeout` and retries stalls and failures; so does `playwright install --with-deps`,
  and every `curl` in `deploy/Dockerfile` carries `--retry`, `--connect-timeout` and `--max-time`.**
  Guards: `scripts/ci-workflow.test.mjs` and `scripts/deploy-image-env.test.ts`, weaker than their names:
  read text, not retries; `scripts/waitron-sh.test.mjs` runs waitron.sh's retries under stubs.
- **Every workflow pnpm setup runs `scripts/ci-setup-pnpm.sh`: three attempts, each under `timeout`,
  then fail. Never use `pnpm/action-setup`.** Guards: `scripts/ci-workflow.test.mjs` (weaker than its
  name: reads text) and `scripts/ci-setup-pnpm.test.mjs`.
- **On GitHub's ubuntu-26.04 runners `timeout` is uutils', not GNU's, and its `-k` forced kill
  reaches the command alone, never its children; a script that relies on `-k` to stop a process tree
  looks for `gnutimeout` first.** Cost: root-guards failed on 26.04 runners. Guards: the "prefers
  gnutimeout" and "kills an attempt that ignores the polite stop" cases in `scripts/ci-setup-pnpm.test.mjs`, weaker than the
  rule: that script only; `scripts/ci-diff-paths.sh` never looks for `gnutimeout` (backlog).
  [Receipt](docs/developers/ci-and-gates.md#every-pnpm-setup-is-bounded).
- **Every `actions/setup-node` has two bounded attempts; only a failed first attempt runs the retry,
  and a second failure fails the job.** Guard: `scripts/ci-workflow.test.mjs`, weaker than its name:
  reads workflow text. Receipt: [ci-and-gates.md](docs/developers/ci-and-gates.md#every-node-setup-is-bounded).
- **Every `actions/checkout` uses a bounded first attempt with git's low-speed limit and
  `continue-on-error`, a leftover-git stop, then a failure-only second attempt.** Guard:
  `scripts/ci-workflow.test.mjs`, weaker than its name: reads text, never runs a workflow.
- **Every artifact download has two bounded attempts, clearing its partial directory before the
  second; only the first failure is tolerated.** Guard: the artifact-download cases in
  `scripts/ci-workflow.test.mjs`, weaker than their name: read workflow text, never run it.
  Receipt and limits: [ci-and-gates.md](docs/developers/ci-and-gates.md#every-artifact-download-is-bounded).
- **Every artifact upload has two bounded attempts; only a failed first attempt runs the retry,
  with `overwrite: true`, and a second failure fails the job.** Guard:
  `scripts/ci-workflow.test.mjs`, weaker than its name: reads workflow text, never runs an upload.
  Receipt: [ci-and-gates.md](docs/developers/ci-and-gates.md#every-artifact-upload-is-bounded).
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
- **A name-filtered test run does not load the package's guard suites** nor any e2e suite pinning a
  shared wire body with `toEqual`. A focused pass proves only those cases; CI supplies package-wide
  coverage.
- **Adding a workspace package requires naming it in the root guards' shard lists.**
  A missing entry can crash a guard rather than assert.
- **A hardcoded cross-package list goes stale when a manifest or scope changes, and scoped CI hides
  it.** Grep for tests that pin the list and run those guards. A PR only typechecks dependents and
  the nightly tests them, so run the affected consumers' tests locally.
- **Browser-mode packages run real headless Chromium.** Decide concurrency by measured headroom
  (`memory_pressure | grep free`): beside another session only well above 15% free (owner, 2026-09-24),
  never beside background whole-workspace coverage. Chromium launch depends on seat permissions.
- **A migration can fail on a box with an earlier trigger naming what it changes, including in the
  body of a trigger on another table.** Guard: `scripts/migration-upgrade.test.ts`, weaker than its
  name.
- **The upgrade test uses `scratchParent()` from `scripts/scratch-dir.mjs` for its scratch directory.**
  It prefers `/dev/shm` when present. Nothing guards it.
- **CI's stream loop/pause tests and each `test-venue-service` shard set `TMPDIR=/dev/shm`, in CI only.**
  Guard: `scripts/ci-workflow.test.mjs`, weaker than its name: reads workflow text, not the tests.
- **The stream tests' CI job sets loopback's MTU to 1500 before they run, in CI only.** Guard:
  `scripts/ci-workflow.test.mjs`, weaker than its name — it reads `ci.yml` as text. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md#the-stream-tests-ci-job-gives-loopback-a-normal-networks-packet-size).

**Claude never pushes with `--no-verify`**; the owner may, in an emergency (owner decision
2026-10-03), and the failure still has to be fixed because CI runs the same checks. The hook's
failure message says so beside its skip hint, pinned by `scripts/pre-push.test.mjs`. A hook failure
the PR does not reproduce still needs investigation: package scoping may skip that
check in CI. A green scoped run does not overrule the hook's failure.

---

## 3. Conventions reviewers enforce

One line each; the receipt for every one is in its topic file. **Read that file before working in the
area** — these lines tell you what the rule is, not why it exists or how it broke. Where a guard is
called weaker than its name, the topic file lists what it does not see.

### Screens, forms and the dashboard — [conventions-ui.md](docs/developers/conventions-ui.md#root-detail-moved-on-2026-10-26)

- **A refusal explains what happened and what each choice does; offer any needed administrator or
  owner sign-in there, and a safe Stop for destructive choices. Never send the person to somebody
  else.** Nothing guards it. Receipt and the owner's few exceptions:
  [conventions-ui.md](docs/developers/conventions-ui.md#refusals-name-a-self-service-next-step).
- **New or changed forms use [design-system.md](docs/developers/design-system.md) → Forms.**
  Required fields are marked; invalid fields get inline errors and one localized bottom message on its
  own line above buttons, never a top summary, with the action disabled until fixed. Request refusals alone never disable it; field refusals appear under that field (owner,
  2026-09-29). Saves stay quiet and disabled until the draft changes, using `draftScopeFor`,
  `saveActionState` and a save-handler early return (owner, 2026-10-07, A331). Other actions stay quiet while awaiting a choice,
  selection or load, or barred by row state; use their own colour when actionable or sending (owner,
  2026-10-08, A416/A427). Exceptions are in the Forms contract; nothing guards these across screens.
  A hint is the placeholder; short explanations are hints, not “?” buttons (owner, 2026-10-03; unguarded,
  A237). Inputs have semantic `name`s, never widget ids. Other dated decisions and the sign-in exception:
  [conventions-ui.md](docs/developers/conventions-ui.md).
- **A screen does not draw its own form field**: a `<select>`, a `<textarea>` or a text `<input>`
  comes from a field primitive; where none fits, add to one or add one (owner, 2026-10-01). Guard:
  `scripts/native-form-fields.test.ts`, weaker than its name — it reads string literals.
- **A form that asks for a postal address puts `wt-address-lookup` above its address fields**
  (the owner's ask, 2026-10-28, A1171); it stays hidden until the form is handed an address
  provider. Guard: `scripts/address-lookup-forms.test.ts`, weaker than its name: reads text, not
  placement or provider. [Limits](docs/developers/conventions-ui.md#root-receipts-moved-on-2026-10-31).
- **A `wt-help-tooltip` outside the setup wizard carries `mode="help-mode"`**, so it shows only while
  help is on (owner, 2026-10-18, A582 design §7). Guard: `scripts/help-tooltip-mode.test.ts`, weaker than its name — it reads
  literals as text; what it misses is in [conventions-ui.md](docs/developers/conventions-ui.md).
- **A help bubble orients: the main points in a few short sentences, anything people would not find
  by trying, and a link to the guide for the rest** (owner, 2026-11-03, A1315). Write it from the
  code that does what it describes, never from memory. Nothing guards it.
  [Receipt](docs/developers/conventions-ui.md#a-help-bubble-orients).
- **A guide sentence earns its place by changing what staff do; never explain exceptions and corner
  cases the code handles by itself** (owner, 2026-11-04, A803 4b). Cut it, do not reword it. Nothing
  guards it. [Receipt](docs/developers/conventions-ui.md#a-guide-says-what-to-do-not-how-the-code-decides).
- **A screen change updates its guide in English and, where a twin exists, Spanish.** Every section
  heading carries a shared `{#id}`; dashboard/till links use each app's `help-guide.ts`. Guards:
  `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`, weaker than their
  names. [Limits](docs/developers/conventions-ui.md#root-receipts-moved-on-2026-11-02).
- **Before treating a numeric field as whole numbers, follow its checks and wire conversion and try
  a fraction.** Receipt: [conventions-ui.md](docs/developers/conventions-ui.md).
- **Normalising a field while typing preserves the native selection.** Guards: the EN/ES caret cases
  in `wt-input.test.ts` and `wt-price-input.test.ts`; see
  [conventions-ui.md](docs/developers/conventions-ui.md).
- **A new dashboard dialog or page holding staged input takes a draft scope from `draftScopeFor`
  (which resolves `leaveCoordinatorFor`) and has a `*.unsaved.test.ts`.** Nothing checks it across
  screens. See [design-system.md](docs/developers/design-system.md).
- **Resolve live content and receipt snapshots separately.** Filtering snapshots by enabled content
  languages hid recorded names.
- **Each surface shows ONE of a product's three names — staff, customer-facing or kitchen — and a fixture gives the three DIFFERENT text**. Which surface reads which: [products.md](docs/developers/products.md).
- **A replay reports the original transaction facts; side effects are gated separately.**
- **Compare saved selections by values — not by JSON key order, not by the order they were sent, and
  not by the order they were OFFERED in either**, and see which LIST a stored row came from. Guard:
  the quantity-only held-order edit case in `apps/server/src/working-order.test.ts`.
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
  and both paths apply the same replacement checks.** Covered in
  `apps/dashboard/src/screens/devices-screen.test.ts`; the receipt is in
  [conventions-ui.md](docs/developers/conventions-ui.md).
- **A value the till takes from its start read either refreshes through `setupRevision` or is listed
  as fixed until reload**, with why, in [conventions-ui.md](docs/developers/conventions-ui.md).
  Nothing guards it.
- **Every staff-notice code a source sends is worded by the till's `staffNoticeText`**; a code it
  does not name is drawn as "The server needs attention". Guard:
  `scripts/staff-notice-codes.test.ts`, weaker than its name — it reads `code: "…"` literals as
  text. See [conventions-ui.md](docs/developers/conventions-ui.md).
- **A background API client does not make POST requests passive.** Only GETs are marked passive;
  automatic pairing renewal uses its own authenticated route.
- **Dashboard subscription names travel with their server sources.** Guard: `scripts/live-subscriptions.test.ts` — it catches unknown names, NOT missing SQL dependencies or disabled-module combinations. [Detail](docs/developers/conventions-ui.md).
- **A module adds a Calendar view through `calendarViews` on its `DashboardContribution`, never by
  venue-service importing it, and never names its address words in `apps/dashboard/src/navigation.ts`**.
  Nothing guards the second half. See [conventions-ui.md](docs/developers/conventions-ui.md).
- **The dashboard banner is persistent identity chrome** — top of the page, full width, the tenant's
  legal name. The account menu sits at the trailing edge only when a session exists.
  [Detail](docs/developers/conventions-ui.md#root-receipts-moved-on-2026-11-02).
- **The dashboard matches the browser's `Accept-Language` when no language is saved.** Guard against
  a late locale response overwriting an authenticated person's language or an explicit choice.
- **Dashboard login offers methods without revealing account enrolment.** Never query account status
  or passkey enrolment to choose the public screen. A modal passkey prompt requires an explicit
  action: navigation, refresh, logout and session expiry never open one. Save the authenticated email and the successful method only with Remember selected, never
  in tab storage.
- **A login refusal never reveals account existence** (owner, 2026-09-30): unknown, suspended,
  pending, wrong-secret and till-profile-inadmissible accounts answer `password.invalid` or `pin.invalid`
  after the same hashing work, as one sentence with no field marked. Only missing/malformed
  input marks a field; the real cause is a log-only `reason`. Owner-approved exception: `passkey.not_registered`.
  An email sign-in through a queue keyed by person id takes its id from `personIdForLoginEmail`,
  stable per address, or attempts sent at once finish sooner for an unknown address.
  Guards: identity login and route suites, weaker than the set looks: no new sign-in route is covered.
  [Detail](docs/developers/conventions-ui.md#a-logins-refusal-never-says-whether-the-account-exists).
- **A device's profile and the signed-in person must both allow a till action; profile zones bound
  service and its admission list bounds sign-in.** Preserve the stated action exceptions. New routes
  add refusing cases and inventory rows to `apps/server/src/till-api.profile-actions.test.ts` and
  zone rows to `apps/server/src/till-api.profile-zones.test.ts`. The inventory guard is weaker than
  its name.
  [Limits](docs/developers/conventions-ui.md#a-devices-profile-and-the-signed-in-person-must-both-allow-what-the-device-does).
- **A `wt-data-table` row-menu column is keyed `actions` and declared `pinned: "end"`** (owner, A155).
  Guard: `scripts/pinned-actions-column.test.ts`, weaker than its name: identifies menus only by that
  literal key; a data column must use another key.
- **Markup a screen hands to `wt-data-table` as a cell is styled with `part=`/`::part()`, never a
  CSS class.** Receipt: [design-system.md](docs/developers/design-system.md#primitives).
- **Every colour, spacing, radius and font reads a declared `--wt-*` token; no hex, named colours,
  `rem` or `em`.** Guards: `packages/ui/src/no-hardcoded-chrome.test.ts` (UI package only) and
  `scripts/style-token-names.test.ts`, weaker than its name: text match against declarations anywhere.
- **Text in the brand colour reads `--wt-color-primary-text`; `--wt-color-primary` paints fills,
  lines and icons.** Guard: `scripts/primary-coloured-text.test.ts`, weaker than its name — it reads
  `color:` declarations as text, in tracked files only; what it misses is in
  [design-system.md](docs/developers/design-system.md).
- **A new `wt-*` primitive needs two specific tests**, not "some tests": a token-painting test, and an
  axe accessibility test in a sibling `*.a11y.test.ts` covering each distinct state in both themes.
- **A shared `wt-*` component's custom events are named `wt-*`, carry `detail`, and are dispatched
  `bubbles: true, composed: true` — and the triggering event is stopped with
  `event.stopPropagation()` before re-emitting**, or, for a composed trigger such as `input`, the
  consumer observes the change twice. App screens and app-owned components may name their own
  events plainly.
- **A deleted receipt or kitchen printer comes back under its existing id when discovery or a manual receipt/kitchen Add finds the same USB or Bluetooth key, network host and port, or cloud-poll id and no active printer already holds it; it keeps its name, settings and history but none of its assignments. An office (A4) printer never takes over a deleted receipt printer's registration. A deleted device keeps its row and settings; its browser, still holding its device proof, asks to rejoin, and a manager's acceptance brings it back under its existing id, with its ended sign-ins still ended. A device whose proof is gone joins with a new id. A deleted card reader comes back under its existing id, name and slip setting when a provider-verified Add finds the same provider reference and the provider registration was left in place; its assignments stay cleared. A deleted reader whose provider registration was unpaired is not brought back; an unpaired reader that was not deleted returns under its id only through a provider-verified Add once the provider lists it again; a new provider reference gets a new id. Unpair stays available where the provider supports it** (owner, 2026-11-10, A1484, "1").
- **A narrower roll in a wider receipt printer needs an explicit print area before native
  centring.** Guard: `apps/server/src/receipt-ticket.test.ts`.
- **The hardware transport seam is `@waitron/print-agent`, and it is database-free.** It imports no
  other package in this repo, and `@waitron/printing` depends on IT, never the reverse. The guard is
  the `import-x/no-restricted-paths` zone in `eslint.config.js`.
- **A container that must reach a hot-plugged USB printer mounts `/dev:/dev:ro`**, plus
  `device_cgroup_rules: ["c 180:* rwm"]` and `group_add: ["7"]` — not a `/dev/usb` subdirectory bind
  and not a hard `devices:` line.
- **The print agent runs under `deploy/apparmor/waitron-print-agent`, named through
  `WAITRON_PRINT_AGENT_APPARMOR` only after `waitron.sh` has loaded it; a `bluetoothctl` call that
  sends a bus message the profile does not list is refused until the profile gains a rule for it.**
  Guards, weaker than their names: image-smoke (no Bluetooth on the runner) and
  `scripts/deploy-image-env.test.ts` (reads the profile as TEXT).
- **The unauthenticated recovery page's title and action are fixed strings chosen by the error
  code (after a Start again Move, an answer naming the set-aside folder takes their place); its log
  tail is written through `redactSecrets` and the personal-data mask (except the frozen-process
  watchdog's own line, which goes through neither), and HTML-escaped** (owner decision 2026-09-26;
  the personal-data mask is A980 S10's default, open to the owner). `redactSecrets` masks only a
  password in a URL, which is why no code's params and no logged message may carry a secret. Its
  password forms, for `setup.start_again_files_found` and `deployment.environment_mismatch`, take
  the administrator password over HTTPS only; their Move choices are the exceptions to never
  suggesting removal (A1098, A1501). The
  tail's span and the cost of taking that password without HTTPS:
  [conventions-ui.md](docs/developers/conventions-ui.md#root-receipts-moved-on-2026-11-06). Guard:
  the never-delete cases in `apps/server/src/recovery-surface.test.ts`, weaker than their name: they
  read the text tables, not the page.

### Data, modules and migrations — [conventions-data.md](docs/developers/conventions-data.md#root-detail-moved-on-2026-10-26)

- **Validate a saved time zone as stored; normalize new input separately.** Cost: a padded name
  admitted duties while repair refused it. Guards: `packages/shared/src/time-zone.test.ts` and
  `apps/server/src/boot.zone-admission.test.ts` (the latter covers named duties only).
  [Receipt](docs/developers/conventions-data.md#saved-zone-validity-uses-the-stored-spelling).
- **Default optional request fields only when absent, and check enum types before comparing values.**
  Explicit null and coerced arrays passed modifier validation. A field whose null is itself a value
  is deliberately outside the rule — an extras list's `maxPicks`, an extras item's `maxQuantity`,
  the seat-a-table route's `guestCount` and the setup request's `taxpayerDomicile` among them.
- **Error codes name the domain concept, never the throwing package; `server.*` names process facts.**
  Every throwing file imports its registry. Before a venue is live, rename/delete freely; afterwards
  either is a migration (owner, 2026-09-26). Move every tree copy together; once live, rewrite stored
  copies and keep external readers accepting both names until both sides deploy. Stored-copy and
  prefix-matcher locations: [conventions-data.md](docs/developers/conventions-data.md).
- **A detail or log field holding a person's name, email or tax number uses a name on
  `PERSONAL_LOG_KEYS` or a path on `PERSONAL_LOG_PATHS` (`apps/server/src/log-personal-data.ts`),
  which the server's logger masks in every line it writes; the answer keeps it. Name it for whose
  it is (`guestName`, `customerTaxId`), never a bare `name` or `taxId` (the listed bare `taxId` is
  the venue's own): the list is flat across every code.** Cost: staff names and
  emails reached the sign-in-free recovery page. Guard: `scripts/personal-log-params.test.ts`, weaker than its name:
  reads text. [Limits](docs/developers/conventions-data.md#root-receipts-moved-on-2026-10-31).
- **A recorded incident code needs an area claim and English and Spanish alert wording.** Guard:
  `scripts/alert-codes.test.ts`, weaker than its name — it reads literals in hand-listed files.
- **General code is English only** (owner, 2026-09-07 and 2026-10-19), including literals, comments,
  identifiers, file names, seeds, starter content and tests. Exceptions:
  `packages/fiscal-verifactu`, AEAT wire names, translation files/guides and Spain-specific packages
  (`country-es`, `workforce-es`, reporting's modelo 303) for official Spain-only text/terms (owner,
  2026-10-20, A913).
  [Receipt](docs/developers/conventions-data.md#root-receipts-moved-on-2026-11-02). Country packs
  also provide English and own demo data; Spain receipts use the venue's receipt language, never
  English. Starter content is English in code and translated at setup; its words in other languages
  go in the writing package's `src/starter-content.ts`, which the guard skips by exact path (owner,
  2026-10-20, A918); non-English screen tests read expected strings. Domain terms have one declaring
  module vocabulary; fiscal terms never enter the base. Guard: `scripts/english-only.test.ts`,
  weaker than its name.
  [Limits](docs/developers/conventions-data.md#spanish-domain-terms-are-deliberate-and-a-module-declares-its-own).
- **The composition list lives in `@waitron/composition`, and it is the only place that names every
  module.** Generic code reaches the regime through the descriptor's `provisioning` and `fiscal`
  seats. The boundary is the swappable SLOT, not "any module". Guard: `scripts/module-seams.test.ts`,
  weaker than its name (it reads text) — shrink its allowlist, never grow it.
  `@waitron/dashboard-modules` is the browser-side twin.
- **A configuration bundle value that is not a setup field stays out of `venue`'s own keys** (the
  privacy contact and content languages travel as top-level fields). Cost: from #1752 to A980 S1a2
  no production box could be set up from an export. Guards:
  `apps/server/src/first-fiscal-setup.e2e.test.ts` and `apps/setup/src/setup-app-first-fiscal.test.ts`,
  weaker than the rule: one export shape.
  [Limits](docs/developers/conventions-data.md#root-receipts-moved-on-2026-10-31).
- **A test-only dependency closes a workspace dependency loop as surely as a runtime one.** A suite
  needing packages from both ends of a loop goes in a package nothing depends on. Guard:
  `scripts/workspace-cycles.test.ts` — it reads each `package.json`, not pnpm's own graph.
- **A new product domain lands as a MODULE, not as new code in the core**, filling the contract seats;
  generic code never learns it exists.
- **A country pack is a browser-safe preset over modules, not a module.** Packs name contribution ids
  as strings and never carry an external-provider credential. Setup derives geography-dependent values
  in the browser and repeats the derivation at the server boundary.
- **A command name is declared under `waitron.commands`, never `bin`.**
- **A change adding third-party code or a binary to the image carries its licence notices, shipped
  in `/app/third-party/`** (owner, 2026-09-24). Guard: the third-party blocks in
  `scripts/deploy-image-env.test.ts`, weaker than their name.
- **`@waitron/db`'s `exports` map is enumerated, not a wildcard**, so `apps/server` cannot deep-import
  its `errors.ts`.
- **Never build SQL by string concatenation — except where the engine takes no bound value**: an
  identifier, and the body of a generated trigger. For those, either escape
  (`quoteIdent`/`quoteLiteral`) or validate and throw. Neither is not acceptable.
- **A `sql` scalar subquery correlated to the OUTER query's table breaks silently when that table is
  the `.from()` base rather than a join** — no error, a wrong answer. Check base-vs-join and READ the
  emitted SQL with `.toSQL()`.
- **A box gathers no SQLite planner statistics (no `ANALYZE`, no `PRAGMA optimize`); a read that
  picks a worse index without them names its index with `indexed by`** (watcher, 2026-11-10,
  A1469). Cost: on the bench's year, gathering them took a day from 0.35 to 1.63 s a bill (#2704).
  Nothing guards it. [Receipt](docs/backlog/architecture.md#decisions-and-deliberate-limits).
- **An untargeted `.onConflictDoNothing()` absorbs EVERY unique conflict, not only the primary
  key's.** Name the target when the table has more than one unique constraint and the code reads an
  empty result as a specific cause. Nothing guards this.
- **Rewriting rows one at a time inside a transaction can break a unique index the FINAL state
  satisfies.** Replacing the set — delete then insert — needs the `REFERENCES` grep first:
  nothing outside the table may hold a key into it.
- **Resolve shared catalogue data once before a basket's line loop.** Never await a zone, product or
  variant read per line. Guard: `apps/server/src/working-order.test.ts` (one zone snapshot, no
  per-line resolver).
- **A write of a table `scripts/write-path-tables.json` lists lives only in the files that
  JSON names; the database refuses no write elsewhere.** Guard: `scripts/write-path-tables.test.ts`
  is the whole of the enforcement, weaker than its name: it reads TEXT and judges a FILE, not a call
  chain. Receipt: [conventions-data.md](docs/developers/conventions-data.md#a-write-of-a-table-scriptswrite-path-tablesjson-lists-lives-only-in-the-files-it-names).
- **`activity_log` is for people to read: no product decision reads it, though a screen may join
  other tables to its entries for display** (owner, 2026-11-04). Write it through `recordActivity`,
  declaring each kind in `packages/db/src/activity-kinds.ts`; `data` names people by id only.
  Nothing guards the readers' callers. [Receipt](docs/developers/conventions-data.md#activity_log-is-for-people-to-read-and-one-function-writes-it).
- **A module's configuration is one document in the shared `settings` table, declared with
  `defineSettingsDocument` and saved only through `saveSettings`; its shape changes on read, never
  in a migration (and not at all before go-live), and a per-module database rule is a trigger on
  `settings`, never a CHECK.** Guards: `scripts/settings-not-migrated.test.ts` and the pinned-CHECK
  case in `packages/db/src/settings.test.ts`, both weaker than the rule: they read text.
  [Detail](docs/developers/conventions-data.md#a-modules-settings-are-one-document-in-the-shared-settings-table).
- **Multi-table writes share ONE transaction: `withTransaction`.** Write-path functions take `tx: Transaction`, never open their own; handlers open one per request. Secret checks take `Database` and derive outside it,
  taking turns through `inTurn`. **Splitting one logical change across transactions is a commented
  decision, never a default.** **Await queries on one transaction in turn, never `Promise.all`.**
  No guard enforces this convention.
- **Across `venue.db` and `node.db`, take `node.db`'s write lock outside `venue.db`'s; save
  `venue.db` first and `node.db` after, so a re-run repairs `node.db` (a signing key is the stated
  exception); write `node.db` through `withNodeTransaction`, since `withTransaction` refuses the node
  handle at compile time.** Nothing guards the first two. [Rules and sites](docs/developers/conventions-data.md#a-local-row-belongs-to-one-node-so-no-foreign-key-may-join-a-local-table-to-a-ledgerstate-one).
- **Housekeeping writes must not take reads down on a full disk.** Last-seen stamps give way;
  reads that must answer while a change waits use `withWriteLock` turns without draining, a stated
  exception to one transaction per route. Guard: `apps/server/src/start-full-disk.e2e.test.ts`,
  weaker than the rule: covers only named routes.
- **A read taken while ANOTHER caller's write transaction is open sees committed rows only.** Three
  shapes are outside the rule, each stated at its site. Guard: the routing cases in
  `packages/store/src/index.test.ts` and `connections.test.ts`, weaker than the set looks. Receipt:
  [conventions-data.md](docs/developers/conventions-data.md#a-read-taken-while-another-callers-write-transaction-is-open-sees-committed-rows-only).
- **A refused statement normally backs out itself, not its transaction; full-disk and explicit
  ROLLBACK/FAIL variants are exceptions.** Catch full-disk refusals outside the whole `withTransaction`
  in tests. After `storage.disk_full` ends a transaction, later statements in its body must remain
  refused inside the write queue; an intervening outside transaction defeats that protection.
  Guards: `packages/store/src/disk-full.test.ts` and
  `write-queue.test.ts`, weaker than their names: page limits, not a real disk; at-commit cases are
  stand-ins. No guard enforces
  the test catch rule.
- **Identify result-code 1811 refusals by their words, never `isRefusal` alone.**
  Use `restrictRefused`/`triggerRaised` in `packages/db/src/constraint-target.ts`. Nothing guards it.
- **A full disk is not one error code; code 14 also names a missing folder.**
  `fullDiskFailure` in `apps/server/src/boot-failure.ts` classifies 13 always, 14/4874/`ENOSPC` only
  under 16 MiB free. Guard: its test suite,
  weaker than the rule: stubbed errors, no real `ENOSPC` case.
- **Within the server, only the start (on a nearly full disk, before first-setup resolution)
  deletes `<state>/spare-space` (`waitron.sh reset` deletes it too); a release writes
  `spare-space.released` (exceptions in the topic file), which holds the till stop, across
  restarts, until the spare is written back whole. It is never venue data.**
  Guard: `scripts/spare-space.test.ts`, weaker than its name: reads text.
  [Cost and detail](docs/developers/conventions-data.md#the-boxs-spare-file).
- **Every server path that replaces or removes the live `venue.db` deletes
  `<state>/backup-room-note.json` first; `waitron.sh reset` removes both together.**
  Guard: `scripts/backup-room-note.test.ts`, weaker than its name: reads text, two hand-kept lists.
  [Cost and detail](docs/developers/conventions-data.md#the-backup-room-note).
- **State-folder names live in `packages/store/src/state-layout.ts`, except legacy setup names awaiting their layout slice; a plain reset keeps exactly its `kept` entries.** Guard:
  `scripts/state-layout.test.ts`, weaker than its name.
  [Detail](docs/developers/conventions-data.md#one-state-folder-layout).
- **Start again's choice records and the set-aside folder, in `<state>/records/`, are removed only by
  `waitron.sh reset --all`** (A1042, A1098). Guard: `scripts/start-again-records-writers.test.ts`,
  weaker than its name: reads text, never what a listed file does.
  [Cost and detail](docs/developers/conventions-data.md#root-receipts-moved-on-2026-10-31).
- **A state file is replaced through `writeFileDurable`; the guard names existing exceptions,
  without checking whether they flush, and the venue-holder heartbeat stays unflushed on purpose.**
  Guard: `scripts/durable-writes.test.ts`, weaker than its name.
  [Receipt](docs/developers/conventions-data.md#state-file-replacements-flush-the-file-before-replacement-and-its-folder-afterward).

- **One process owns a venue folder at a time.** Tools documented to run beside the server use
  `exclusive: false`; file-changing commands take `lockVenueDatabase` before changing anything.
  Never unlink `venue.lock`/`recovery.lock`; change `recovery.json` only through `updateRecoveryState`.
  Guards: `packages/store/src/venue-lock.test.ts` and `apps/server/src/recovery-race.test.ts`, weaker
  than their names: prove the locks, not that every caller takes them.
- **Anything that writes or deletes in `<state>/scratch/backup` does it inside the staging turn**
  (`apps/server/src/backup-staging-turn.ts`), **except the start's sweeps (`freeSpaceAtStart` and `bootServer`'s `emptyScratch`),
  which run while no backup supervisor is running in this process**. Guard:
  `scripts/backup-staging-touchers.test.ts`, weaker than its name. Receipt:
  [conventions-data.md](docs/developers/conventions-data.md#backup-staging-is-touched-only-inside-the-staging-turn).
- **Backup/restore staging, stream/entry restore working folders, setup-holdings copies and node
  snapshots use `<state>/scratch/`, made only while the process holds the venue folder; every start
  empties `scratch/` once it holds the venue folder (`emptyScratch`).** Nothing guards the first half; `scripts/no-tmpdir-scratch.test.ts`
  guards production calls of `tmpdir`, weaker than its name: reads text. Cloud snapshots keep
  their own staging until the one backup service lands (fl2's explicit exception).
  [Detail](docs/developers/conventions-data.md#one-process-per-venue-folder).
- **An open `FileHandle` ends the process when it is collected, so one a route streams also closes
  on `c.req.raw.signal`'s abort: nothing reads or cancels the body of a connection already gone.**
  A test that reads only an `app.request()` status leaks the same way. Guard: "every file the copy
  route opens is closed" in `apps/server/src/handover-source-api.test.ts`, weaker than the rule: this
  route only. [Receipt](docs/developers/conventions-data.md#an-open-filehandle-ends-the-process-when-it-is-collected).
- **A duty `bootServer` starts registers its stop on `undoOnFailure` before the next throwing step.**
  The landing listener, started last, is the exception. Guard: `apps/server/src/boot.failed-start.test.ts`,
  weaker than its name: covers only named duties.
- **There is no tenant column. The taxpayer is the one row in `tenants` (id = 1, singleton check); a
  query that wants "this tenant's rows" reads the table.** Guard:
  `scripts/no-tenant-column.test.ts`, weaker than its name — it matches the column's spellings and
  skips test files.
- **Declare table/column types through `packages/db/src/schema/columns.ts`, never direct engine
  builders.** Exception: `text` in `packages/fiscal-verifactu/src/schema/registros.ts`. Guard:
  `scripts/column-vocabulary.test.ts`, weaker than its name: reads imports and forbids only listed builders.
- **Money columns hold whole cents; convert at the row with `decimalToCents`, `centsToDecimal`,
  or `rawCentsToDecimal` for raw SQL (`cast(x as text)`).** Above it use exact `Decimal`; sum JSON
  amounts in JavaScript at money scale. Nothing guards this boundary or makes mistakes loud.
  Narrower guards: `packages/db/src/schema/columns.test.ts`, `packages/shared/src/conventions.test.ts`.
- **Quantity columns hold whole thousandths and rates whole basis points, never money scale.**
  Use `packages/shared/src/scales.ts` converters for bounds; raw total readers bound exact-number
  capacity, and rate CHECKs use 10000. Guard: `packages/db/src/testing/schema-conformance.ts`,
  weaker than a universal check: only migration sets opting in are covered.
- **The database never rounds a quantity — `decimalToThousandths` owns the third place.** A test
  asking storage to round is testing something no product path does.
- **A time stored as text and compared or sorted as text is right only while every writer stores one
  spelling**. Normalise at the writer, as `shiftInterval` and the `storedTime` helpers do. Nothing
  guards the one-spelling rule across the columns.
- **Classify new tables `ledger`, `state` or `local` in the classification of the package holding
  their migration set (`packages/db/src/classification.ts` for core's); use `appendOnly()` for
  uncorrectable tables and `migrationOptionsFor(...)` when migrating.** Classification alone is not
  the trigger set; triggers cannot prevent `DROP TABLE`. Marking an existing table
  append-only must be disclosed in the PR because first start can raise `append_only.triggers_restored`.
  Guards: `scripts/classification-complete.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/apply-migrations-callers.test.ts`; the last is weaker than its name: call shape, not sets.
- **A new append-only table travels in both its set's exported migration descriptor (the host
  set's, such as `CORE_MIGRATIONS`, for a module with no set) and
  `packages/migrations/migrations.manifest.json`.** Guards:
  `scripts/append-only-migration-sets.test.ts` and `packages/composition/src/composition.test.ts`.
- **Live/restored database and venue-folder operations must expect Litestream's `_litestream_seq`,
  `_litestream_lock` and `.venue.db-litestream/`.** No guard finds a new site that omits them.
- **A `local` row belongs to one node, so no foreign key may join a `local` table to a
  `ledger`/`state` one, in either direction.** A `local` row that needs a venue row keeps the plain
  id and names, at the column, what establishes the target exists — or that nothing does, and where
  the refusal moved to. Guard: `scripts/two-file-foreign-keys.test.ts`, weaker than its name.
- **A `local` table says what ties a row to its node** — a `node_id` column that every read and
  write names, as this box's id or one of the boxes in its takeover history, a seal only a box
  holding the key ring opens, or rows the transaction that wrote them deletes. No guard makes a new `local` table say which.
- **Store anything that works as a live login as a hash.** Guards: database-copy cases in
  `apps/server/src/me-api.test.ts`, `apps/server/src/till-api.test.ts` and the stored-hash cases in
  `packages/identity/src/management-session.test.ts` and
  `packages/identity/src/device-token.test.ts`, weaker than the rule.
- **`requireManagementChangeFromOwnPage` checks the page of a change carrying the dashboard's
  cookie, ahead of every main-app route after the request-id middleware and every waiting-app write
  route; register none ahead of it.** Cost: another port's page changed the start screen (B3 PR 9).
  Guards: sweeps in `apps/server/src/boot.management-origin.test.ts` and
  `apps/server/src/waiting-start.test.ts`, weaker than their names.
  [Receipt](docs/developers/conventions-data.md#a-change-carrying-the-dashboards-sign-in-cookie-is-checked-for-the-page-that-sent-it).
- **A till request that needs a signed-in person is checked against the `x-waitron-person` header
  inside `requireSession`, `signedInPersonOn` and sign-out; read the session's person only through
  them.** Guard: `apps/server/src/till-api.session-person.test.ts`, weaker than its name: only the
  till, device and schedule mounts' routes. A new route the walk sees answered as with nobody signed
  in goes in its `BLIND` list, and one that needs a body in `BODIES`.
  [Receipt](docs/developers/conventions-data.md#a-till-requests-person-is-checked-where-the-sign-in-is-read).
- **A module with a migration set names in `requires` every other set its SQL references, puts a
  trigger on, names in a trigger body or writes at top level.** Guard: `scripts/module-graph-honesty.test.ts`,
  weaker than its name: text scan recognising fixed SQL shapes.
- **A column of a transferred table that holds another row's id is a foreign key, a declared
  `references` entry or left out of the export** (`omit`); any other column the export carries
  arrives holding the exporting venue's id. A short id list kept as JSON (design R4) declares
  `jsonReferences`. Guard: `scripts/id-columns-are-references.test.ts`, weaker than its name.
  [Detail](docs/developers/conventions-data.md#a-column-of-a-transferred-table-that-holds-another-rows-id-is-a-foreign-key-a-declared-references-entry-or-left-out-of-the-export).
- **A module that can be switched off or swapped keeps a migration set of its own; any other adds
  its tables to core's set, and the commit says which.** Stated exceptions: staffing, switchable
  with its tables in workforce's set, and `node`, whose set is applied to `node.db`. Append-only
  classification travels with the set. Guard: the eight-sets cases in
  `packages/composition/src/composition.test.ts`, weaker than the rule: they pin today's sets and
  hosted modules.
- **Declare every foreign key and unique index in the TypeScript schema.** If impossible, say at the
  column what it cost and where the refusal moved. Guard: `scripts/schema-constraints.test.ts`,
  weaker than its name: reads built schema.
- **A schema change rebuilds the set's one starting migration, never a new migration or a hand edit:**
  change the TypeScript schema (hand-written SQL only in `<package>/triggers/<set>.sql`) and run
  `migration-baseline rebuild --set <name>`; on a rebase conflict take main's copy
  (`git checkout --ours` during the rebase) and rerun it. Until go-live; from go-live, incremental
  migrations and the rebuild hazards below apply again. Guard: `scripts/starting-migrations.test.ts`,
  weaker than its name: trusts drizzle-kit. Verify by RUNNING `scripts/schema-constraints.test.ts`,
  `scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts`,
  `scripts/starting-migrations.test.ts` and `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
- **A drizzle table rebuild on this engine runs with foreign keys ON, so its `DROP TABLE` silently
  deletes every cascading child's rows, and fails on a `no action` or `restrict` child holding
  rows.** Before shipping a rebuild, list the foreign keys that point at the table.
- **A drizzle-kit 0.31.10–0.31.11 generation that rebuilds a table must not also add a column to
  it** (`no such column`). Add the column in one generation and its CHECK in the next.
- **A drizzle-kit 0.31.11 table rebuild writes an expression index back as quoted column names,
  which this engine refuses.** Take the index out of the schema for every generation that rebuilds
  its table and add it back in a generation of its own, with a note at the index.
- **Rehearse a drizzle table rebuild on `node:sqlite`, never the `sqlite3` command line**: the
  `sqlite3` rehearsal fails a sound migration. Nothing guards it.
  [Receipt](docs/developers/conventions-data.md#a-drizzle-table-rebuild-is-rehearsed-on-nodesqlite-never-the-sqlite3-cli).
- **From go-live, a migration that rebuilds a table first drops every trigger on another table
  whose body reads it. After the rename it creates again each of those it still needs, and the
  table's own triggers that `DROP TABLE` removed, rewritten for any column the rebuild changed.
  It drops one of the table's own triggers by hand only when that trigger is meant to go**, or
  the box refuses the rename (`no such table`). Guard: `scripts/migration-upgrade.test.ts`,
  weaker than the rule: a reading trigger dropped and never created again passes it.
  [Receipt](docs/developers/conventions-data.md#from-go-live-a-rebuild-drops-and-recreates-every-trigger-whose-body-reads-the-table).
- **A foreign key whose target has no unique index is refused at the first WRITE, not at migrate
  time** (`foreign key mismatch`). So a green migrate is no evidence a new key is sound — write
  through it.
- **Editing a shipped migration file — even only its comments — makes every venue it already
  migrated refuse to start** with `provisioning.database_ahead`. Such an edit ships only with a
  venue reset, said in the PR's first line. Nothing guards it.
- **Drizzle selects migrations by `max(created_at)` alone; keep journal times strictly increasing.**
  Guard: `scripts/journal-monotonic.test.ts`, weaker than a universal check: only sets with multiple
  entries. Start a drizzle bump with `grep -rn 'dialect.js'`.
- **`applyMigrations` refuses to report success on a short set**, throwing `migrations.incomplete`
  rather than serving a half-migrated schema.
- **Only boot, a resumed restore and bucket rebuild call `assertNotAhead` (a handover's compare refuses such a copy itself); `waitron.sh install <ref>`
  is a one-way door.** `assertNotAhead` throws `provisioning.database_ahead`; other migrating paths
  do not carry that check. Their list: [conventions-data.md](docs/developers/conventions-data.md).
- **An empty value is a valid value** — to whatever receives it, so a reader must turn `""` into
  "unset" itself. An env or prompt value set to `""` falls back to its default exactly as an unset
  one does (`isUnset`, `apps/server/src/env-value.ts`); a path never goes through `resolve("")`; and a reader with no default refuses `""`
  explicitly.
- **No backwards-compatibility or data-migration code until Waitron is in production.** Until then
  any installation may be reset at any time instead of carrying its data forward (owner,
  2026-10-03). This rule expires the day a real venue is live; add its replacement in the same
  change. Its replacement: from go-live, retiring a module also ships a way for an older export that
  names it to load, by ignoring or converting its configuration, so an export always moves forwards
  (owner, 2026-11-07).

---

## 4. Testing

One line each; the mechanism, the measurement and the incident behind every one are in
[testing-guide.md](docs/developers/testing-guide.md#root-detail-moved-on-2026-10-26),
[its 2026-11-02 excerpts](docs/developers/testing-guide.md#root-receipts-moved-on-2026-11-02) and
[what named guards miss](docs/developers/testing-guide.md#root-receipts-moved-on-2026-11-11).
**Read it before writing a database or browser test** — most of these rules exist because a test
passed while proving nothing.

- **One target.** A suite that needs a database gets a REAL one: `useVenueDb`. Guard:
  `scripts/venue-db-helper.test.ts`, weaker than its name.
- **Don't own a database in a suite — let `useVenueDb` own it.** Raw `beforeAll`/`afterAll` only
  when the suite legitimately builds its own resource, and then guarded. Guard:
  `scripts/guarded-teardowns.test.ts`.
- **Server tests send the till's person header through `apps/server/src/testing/tab-person-setup.ts`;
  a test of a request naming nobody leaves its session alone.** Nothing guards it.
  [Detail](docs/developers/testing-guide.md#server-tests-send-the-tills-person-header-through-one-setup-file).
- **An insert whose rows grow with an order must go through `insertInChunks` or `statementChunks`**;
  the table round's `insertTabRound` does not yet, and no sweep has read every insert (see the
  backlog). Cost: a 2,001-dish order passed locally and failed CI. Guard: the bound-value case in
  `packages/store/src/index.test.ts`, weaker than the rule. [Runtime limits and
  receipt](docs/developers/testing-guide.md#root-receipts-moved-on-2026-10-31).
- **Synchronous `node:sqlite` tests need a real timer turn for the venue watchdog; `useVenueDb`
  yields after each test.** Guards: `packages/db/src/testing/venue-db.test.ts` and
  `packages/store/src/venue-liveness.test.ts`, weaker than the rule.
- **No test suite under `packages/` or `apps/` starts a container; the rigs under `bench/` do.**
  **`TESTCONTAINERS_RYUK_DISABLED=true` is required locally**, and with it off an INTERRUPTED run
  leaks containers; `pnpm reap` removes them by label and age — but not every rig stamps the label.
  Never a blanket `docker volume prune`, and `docker volume inspect` before any
  manual `rm`.
- **Install pinned Litestream and versitygw before stream loop/pause tests:**
  `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`. Missing binaries
  skip locally and fail CI. Guard: `scripts/ci-workflow.test.mjs`, weaker than its name: text reads
  accept commented or disabled setup.
- **Full-disk tests use a small real filesystem:** macOS makes one with `hdiutil`; Linux
  needs `WAITRON_FULL_DISK_DIR`, otherwise skips locally and fails CI. Guard:
  `scripts/ci-workflow.test.mjs`, weaker than its name: reads workflow text.
  [Separate filesystems and variables](docs/developers/testing-guide.md#root-receipts-moved-on-2026-10-31).
- **On Vitest 4.1.12 a browser configured inside a project reads `connectTimeout` only from the
  OUTER config's `test.browser` block**. Nothing guards it. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md#vitest-reads-a-browsers-connecttimeout-from-the-outer-config-only).
- **Under an AI agent (`AI_AGENT` or `CLAUDECODE` set), Vitest hides a passing test's console
  output**; unset both to see it.
- **A Vitest run that shows no `Tests` count is no evidence that anything passed, whatever its exit
  status.** Read the count, never a blank output or the exit status of a pipe; under a reporter
  that prints none, read the reporter's own result.
- **A container port-binding timeout needs Docker state as well as the container's own logs.** Save
  `docker inspect`'s `HostConfig.PortBindings` and `NetworkSettings.Ports` before removing the
  container.
- **A test that starts the server in its own process writes to the venue database only before
  `startServer` or after `close()`**. Guard: `apps/server/src/boot.backup-network.test.ts`'s
  `beforeServerStarts`, weaker than the rule — it covers the file's two write helpers only. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md#a-test-that-runs-the-server-in-its-own-process-writes-to-the-database-only-while-the-server-is-down).
- **A test child process that freezes `Date` freezes `performance.now` with it**. Guard: the
  one-time 1.1-second holds in the hour test children, weaker than the rule: those children only.
  [Receipt and paths](docs/developers/testing-guide.md#root-receipts-moved-on-2026-10-31).
- **A process-started HTTP or landing fixture, and its matching in-process fixture, keeps a
  retained socket (`retainHttpListener`); `freePorts(n)` is only for a test that needs released
  configured ports, keeping its origin, refusal and listener-release checks; no `apps/server` suite
  draws such a port by binding port 0 and releasing it.** Guard: `apps/server/src/testing/retained-http-listener.test.ts`,
  weaker than the rule: the helper only, not which fixture uses which.
  [Detail](docs/developers/testing-guide.md#keep-a-process-fixtures-socket-bound-through-handoff).
- **With `useVenueDb({ resetPerTest: false })`, a row found by a drawn port must be checked as
  this test's own row.** Guard: `apps/server/src/print-agent-e2e.test.ts`'s `portsNoPrinterNames` and
  pre-discovery check, weaker than the rule: this file only.
- **A fiscal fixture must not be over a minute ahead of a later recording write's clock.**
  In a shared database, every write and helper takes its clock from the latest record time;
  otherwise give the case its own database. Nothing guards it.
- **A suite that sends a room's revision to a today's-floor write route pins the API's clock at its
  own fixed time and seeds at that time**. Nothing guards it. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md#a-floor-test-pins-the-till-apis-clock-away-from-the-day-change).
- **An interrupted run also ORPHANS its vitest workers**, which spin at ~100% CPU until `kill -9`.
  `pnpm reap` sweeps these, scoped by ppid 1 AND the shapes vitest leaves in `ps`, never a bare `vitest` match.
- **Concurrent coverage runs must not share a package's report directory, and an intentional second
  one belongs OUTSIDE the package.**
- **A diagnostic pauses a browser test page only after its file has been silent for 60 seconds
  beyond its running cases' time limits and the project's hook time limit, and cancels a pause left
  waiting**: a `page.viewport` call hung (A1307). Guard: `scripts/vitest-file-progress.test.mjs`,
  weaker than its name: this reporter only, fake pages, not Chromium. Receipt:
  [ci-and-gates.md](docs/developers/ci-and-gates.md#a-browser-file-silent-past-its-time-limits-gets-a-stack-sample).
- **Locate the unfinished package before diagnosing a silent shard as database contention.** A
  Vitest test timer does not bound a browser whose event loop has stopped; use an outer deadline,
  and never a retry as proof of repair. Browser shards use the diagnostic deadline wrapper; guard:
  `scripts/ci-workflow.test.mjs`, weaker than its name — reads text, never runs the deadline.
- **A recurrent stall needs a retained log and a snapshot of whatever it was waiting on.** Locate
  the stalled operation before assigning its cause to resource contention.
- **On Vitest 4.1.12 a project's own `maxWorkers` wins, and the outer config's is only the fallback**.
  **A cap that must apply to every project still belongs on the outer config.** Guard:
  `scripts/fiscal-test-budget.test.ts`, weaker than its name — it pins one arrangement, not how
  Vitest resolves the limit.
- **A package that pins one worker inside one of several projects numbers its `groupOrder`s from 1,
  never 0**. Guard: `scripts/bookings-test-budget.test.ts` — which pins bookings alone.
- **A test's timeout must exceed the SUM of its waits plus untimed work.** Guard:
  `scripts/spawn-timeout-budget.test.ts`, weaker than its name.
- **A `spawnSync` timeout must clear the child's own worst case, retries included.**
  Cut the wait (`WAITRON_SH_HEALTH_DELAY`), not retries. Nothing guards this generally.
- **Stop a finished command's leftover workers on `exit`, not on its output pipes' `close`;
  bound pipe draining too.** Guard: `scripts/run-with-deadline.test.mjs`. Cost and receipt:
  [ci-and-gates.md](docs/developers/ci-and-gates.md#a-browser-shard-reports-before-its-job-limit).
- **A `spawnSync` timeout leaves the script's children running; keep each run's files apart.**
  Guard: the leftover-call case in `scripts/ci-workflow.test.mjs`, weaker than the rule: one script only;
  no general guard.
- **A suite's executable stubs are built ONCE per file, not once per test** — move what each case
  varies into environment variables the stub reads. It pays only on macOS and only where the stubs
  are a large share of the runtime — measure first.
- **A test shelling out to git clears `GIT_DIR` and its family.** Run it once under `GIT_DIR`
  before trusting it.
- **A test that changes the screen's global language restores it before the next case.** Receipt:
  [testing-guide.md](docs/developers/testing-guide.md#restore-the-screen-language-after-a-test).
- **Browser passkey tests stub `navigator.credentials`, keeping the WebAuthn library real.**
- **Browser recovery tests read the native control inside a shared component**, not only its host
  property.
- **A reopened polling dialog owns a new in-flight gate.** Reset it on close and guard its release
  with the request's generation, or an old read blocks the reopened dialog.
- **A browser test using fake timers must advance an awaited animation frame or restore real timers
  first**, or it stalls on its own paused `requestAnimationFrame`.
- **For a dialog's `wt-close` effects, wait for that event or the screen's resulting close event.**
  Neither `vi.waitFor`'s second nor `open=false` proves it. Nothing guards it.
- **Observe navigation with spies on `history.pushState`/`replaceState`, never `history.length`.**
  Nothing guards it.
- **A test waits for a browser grant, such as a Web Lock, by tracking the request until it is
  answered — never by a fixed sleep.** Nothing guards it. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md#a-test-waits-for-a-browser-grant-by-tracking-the-request-never-by-a-fixed-sleep).
- **Dispatch events when testing a `composedPath()` guard.** [Detail](docs/developers/testing-guide.md).
- **A click whose outcome depends on whether an update one listener schedules has run before a later
  listener sees the click is tested with `userEvent.click`, not `element.click()`.** Nothing guards
  it. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md#a-scripted-click-runs-microtasks-only-after-the-whole-dispatch).
- **Position a native popover before its first paint.** [Detail](docs/developers/testing-guide.md).
- **A placement check measures a box after the content that sizes it arrives, with room for CI's
  larger fonts on the side it expects the box.** Nothing guards it. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md#a-placement-check-measures-a-box-at-its-final-size-with-room-for-cis-fonts).
- **Test public recovery links through the real boot modes that serve them.** [Detail](docs/developers/testing-guide.md).
- **Test provider HTTP refusals through the real client, as well as a throwing fake seat.** [Detail](docs/developers/testing-guide.md).
- **Local reactivation cannot restore a removed provider registration.** Successful unpair records a
  marker that only provider-verified adoption clears.
- **Source scanners select files, not just paths ending in `.ts`.** `sourceFilesIn` checks
  `isFile()`.
- **A guard that reads the whole tree belongs in the ROOT Vitest project.** The root project does
  not typecheck, and a module tested only from there must be in the root `coverage.include` to be
  measured at all, and excluded from its own package's.
- **Prove a guard by deletion**, and confirm a negative control fails for the reason you think.
- **A proof by deletion says nothing about what the guard wrongly REFUSES, and that needs its own
  case** — the legitimate call that must still be served.
- **Re-run deletion controls after restructuring the code they tested, and move the proof to the
  guard that still catches it.**
- **Measure the old version in a throwaway worktree, never by swapping files in the working one.**
  `git worktree add --detach <dir> <base-sha>`, `pnpm install` in it, and `git worktree remove` it
  after; a copy set aside that cannot be avoided goes in `mktemp -d`.
- **Every A1308 slice runs `apps/server`'s `pnpm protection-list` before and after its change, never
  in CI. `pnpm bench` runs from time to time, not per slice (owner, 2026-11-10): a slice that
  changes a sale-path read says so in its PR, in a line starting `Sale-path read changed:`, and a
  30-day run follows once three such slices have landed or on request (watcher, 2026-11-10,
  A1480). `bench compare` exits 0 whenever it can read and parse both files, so read what it
  prints.** Nothing guards it.
  [How and limits](docs/developers/testing-guide.md#the-protection-list),
  [when the bench runs](docs/developers/testing-guide.md#when-the-bench-runs).
- **A claim about how SQLite plans a query, or what it was built with, is measured where
  `node:sqlite` reports the same SQLite and STAT4 as the box image's base (`node:26-slim`), never
  with a Mac's Homebrew Node, which links its own SQLite** (watcher, 2026-11-10, A1474). Cost: the
  Mac's SQLite was taken for the box's, and a wrong correction about A1469's figures reached the
  owner. Nothing guards it. [Command](docs/developers/testing-guide.md#the-bench).
- **A fixture no check reads is unverified data, and a green suite resting on it proves nothing.**
  When a fixture describes something an authority will judge, run the real check over it.
- **Treat “there is a test” as unfinished: name the assertion that fails if behaviour is deleted.**
  Coverage alone and “doesn't throw” do not answer it; `pnpm --filter @waitron/ui mutation` checks it.
- **Rejected writes assert the domain error code.** A database constraint error also satisfies
  `toBeInstanceOf(Error)`.
- **`errors.ts` reachability is guarded once, in `scripts/errors-reachable.test.ts`**, weaker than
  its name — it reads text.
- **Vitest 4 ships no default coverage excludes at all.** `include`/`exclude` replace rather than
  merge, and a config measuring nothing still exits 0 with the thresholds intact, so read the
  per-file table rather than the exit code.
- **A package config names its own source tree in `coverage.include`.** Guard:
  `scripts/coverage-thresholds.test.ts`, weaker than its name.
- **Use `/* v8 ignore start */` … `/* v8 ignore stop */`, never `/* v8 ignore next */`.**
  Nothing guards it.
- **A page asserted as a STRING, or reached only through its API, has nothing checking that it
  renders.** Open it and LOOK, in both themes and at phone width. `apps/server`'s string-rendered
  pages have no harness: write the rendered string to a file and open it with the workspace's
  playwright Chromium.
- **Code every database test runs — `useVenueDb`'s hooks — never checks something already
  guaranteed**. Nothing guards it.
  [Receipt](docs/developers/ci-and-gates.md#dbs-mutation-shards-are-packed-by-estimated-cost).
- **In `packages/db`, import inside a case only to assert what a source module builds on load;
  otherwise import at the top.** Its Stryker config uses `ignoreStatic`; nothing guards this.
- **`toMatchObject` checks only the keys you list**; a key you never list is never checked at all.
- **A default you did not state is not a value you tested.** State it at every call site that
  shares it; a library can derive its default from the running runtime. Guard: the pinned-algorithm cases in `packages/identity/src/passkey.test.ts`.

---

## 5. Fiscal invariants — the unrecoverable ones

- **The node owns the fiscal identity, chain and invoice series; a till is a cash register.**
  Guard: `scripts/no-till-as-issuer.test.ts`, weaker than its name: reads text.
  [Limits](docs/developers/conventions-data.md#the-node-owns-fiscal-identity).

Mechanisms and full guard limits: [data](docs/developers/conventions-data.md#root-detail-moved-on-2026-10-26),
[data, 2026-11-02](docs/developers/conventions-data.md#root-receipts-moved-on-2026-11-02),
[printing](docs/developers/conventions-ui.md#root-detail-moved-on-2026-10-26),
[stream tests](docs/developers/testing-guide.md#root-detail-moved-on-2026-10-26) and
[data, 2026-11-11](docs/developers/conventions-data.md#root-receipts-moved-on-2026-11-11).

- **Printing never opens the drawer. Cash and hand-keyed card enqueue separate audited `drawer`
  jobs; documents contain no drawer commands and connected-card payments open nothing.** Taking cash
  separately requires `take-cash` through `assertTakesCash`. Never manually resend drawer jobs.
  Which drawer opens and who may open it:
  [conventions-ui.md](docs/developers/conventions-ui.md#root-receipts-moved-on-2026-11-06). Guards,
  weaker than the rule.

- **One database per environment.** A pre-production database is never promoted. `WAITRON_ENV`
  governs this; unset means `preproduction`, `production` must be typed out, and `dev` is
  preproduction plus `config.devMode`.
- **Nothing EXTERNAL may block a sale, though a start must have its time confirmed first — and a till
  needs the venue's PRIMARY.** AEAT, the card network and the internet are never on the sale path of
  whichever node is primary, except that, on a box that files records, a start the internet cannot
  confirm waits for two devices or a person to confirm its time before its first payment (owner,
  2026-11-10): records chain locally and the outbox drains later; a card falls back to 4G, a standalone terminal or cash. The till follows
  the primary and never chooses; only the primary sells. Fiscal submission is an outbox, never
  inline. TODAY a venue has ONE node and no failover at all. Detail:
  [conventions-data.md](docs/developers/conventions-data.md).
- **A box that is not a mirror, whose held chart lists another box that finished joining, asks it
  by signed query before selling or filing, and waits while every box it counts is silent (a box
  it took over from, or demoted by its own promotion, it asks but never waits for), until one
  answers or an administrator carries on over HTTPS for that start only. Carrying on is refused
  once this box's `node.db` records that it handed over.** Guards: `apps/server/src/boot-peer-check.test.ts`,
  `boot.start-check.test.ts` and `waiting-start.test.ts`, weaker than the rule: named cases only.
  [Detail](docs/superpowers/plans/2026-11-02-a1018-handover-build.md#slice-3-as-built-2026-11-03).
- **The bucket stream never waits on the bucket to sell or fails `/health`; its local checkpoint
  can hold the write lock and delay sales.** Fifteen minutes behind raises `backup.stream_behind`
  unless a stopped/refused/unusable-settings alert explains it. Guards: stream loop/pause e2e and
  health bucket-copy cases, weaker than the rule: named cases only; stream cases skip without binaries.
- **`registros_facturacion` is immutable: never work around its append-only update/delete triggers.**
  Triggers are the whole enforcement and cannot prevent `DROP TABLE`. Boot restores missing triggers
  on existing tables; boot and the trading watch refuse changed/missing triggers. `append-only-watch`
  is weaker than its name: stored text only, only tables migrated at start.
- **Every start of a box that files records writes no fiscal record and moves no money until its
  time is confirmed: by the box's internet time service being synchronised, by two enrolled devices
  at different addresses reading within 5 seconds of it, or by a person confirming or correcting the
  date and time on a till; AEAT is not asked, and orders still reach the kitchen** (owner,
  2026-11-10: "we rely on NTP only, we don't bother about AEAT … If we are not on the internet then
  we either wait for two devices … Or we stop and ask a user to confirm that our current date+time
  is correct (or we ask them to correct it)"; "Orders still go"). Guards:
  `apps/server/src/start-clock-check.test.ts`, `apps/server/src/clock-unconfirmed-gate.test.ts` and
  `apps/server/src/boot.start-clock-gate.test.ts`, weaker than the rule: the money routes in the
  gate table only; the record remedies, off in production, are outside it.
  [Detail](docs/developers/conventions-data.md#every-start-confirms-the-boxs-time-before-it-trades).
- **More than a minute behind the latest fiscal record, write no record and take/refund no new money
  unless a clock confirmation covers it.** After replay, call `refuseWhileClockBehind` before
  reader/refund/drawer work; pause both refund recovery loops. Recheck card-refund send/outcome in
  their dating transaction after provider waits. Still store money already moved. **Clock
  confirmation lifts the stop for one step back, with no gap limit; once a record is written under
  it, readings stay within a minute of the latest record written since.** Sources, never a box
  device outside development:
  [conventions-data.md](docs/developers/conventions-data.md#root-receipts-moved-on-2026-11-06).
  Guards: clock-behind-stop, payments clock-behind, fiscal chain/restart/confirmation, clock-confirm
  route and `apps/server/src/clock-watch.start-up.test.ts` suites, weaker than the rule. **The box's
  internet time service keeps its clock; Waitron sets it only through the host service, from a till's
  time (a staff member's while the start waits for its time, or during a stop until the internet
  confirms that start or during start-up; an administrator's at any time), an administrator's own
  device, or AEAT only inside the clock-behind stop — never from devices alone and never while it
  keeps time over the internet — and every step it verifies, or sees move the clock by over a second,
  is alerted and emailed** (owner, 2026-11-10: "we rely on NTP only, we don't bother about AEAT").
  Guards:
  `apps/server/src/clock-correction.test.ts`, `apps/server/src/clock-set.route.test.ts`,
  `apps/server/src/till-box-clock-api.test.ts`, `scripts/waitron-box-sh.test.mjs`, weaker than the
  rule. [Detail](docs/developers/conventions-data.md#the-box-sets-its-own-clock).
- **Never put our own metadata into a hash.** `entorno` must not enter `computeHuella`;
  differing only in it must leave hashes identical.
- **The producer's tax number does not change before A993 lands** (owner, 2026-11-06): a
  production start whose chain names another refuses `sif.producer_changed`, and the publish job
  refuses a new one unless `WAITRON_PRODUCER_CHANGE_ALLOWED` holds it. Exception (owner,
  2026-11-08): today's placeholder values may be replaced by the real ones once, before any
  production start, with that variable set to the real number. Guards:
  `apps/server/src/boot.producer-change.test.ts` and the publish cases in
  `scripts/ci-workflow.test.mjs`, weaker than the rule: a stand-in `docker`, never a real publish.
  [Detail](docs/developers/ci-and-gates.md#the-publish-job-requires-guards-and-checks-the-producers-settings)
- **Restore and promotion start a new chain under a new installation name.** Setup/restore/promotion
  use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds
  (no confirmation); a minute whose name is already in a history the box reads is not taken. Its
  waits, its other refusals and when a name can repeat:
  [conventions-data.md](docs/developers/conventions-data.md#root-receipts-moved-on-2026-11-06). Only
  preproduction throwaway skips second-clock/history checks; refuse it outside preproduction.
  Restore takes one source; working-time chain continues from its head. Guards:
  hour-selection/hour-clock/minute-selection-unknown-name suites (the last weaker than its name)
  and `packages/workforce/src/restore-continuation.test.ts`.
- **A box holding a `node_handover_restriction` row starts restricted, before every worker; a
  background duty is stopped through `apps/server/src/background-duties.ts`, or is a job on the
  runner whose mark in `apps/server/src/job-catalogue.ts` says it stops at a stepdown or why it
  keeps running.** Guards: `apps/server/src/boot.restricted-quiet.test.ts` and
  `apps/server/src/handover-stepdown.test.ts`'s "every closer is either atStepdown or carries a
  reason" and `apps/server/src/job-catalogue.test.ts`, weaker than their names.
- **Every filing-node start resets sales left “being sent” to waiting before the first filing pass.**
  Only one process may file; tools using `exclusive: false` file nothing. Guards:
  `apps/server/src/restart-reset.test.ts` and `apps/server/src/boot.test.ts`, weaker than the rule:
  no check proves that every non-exclusive tool abstains.

---

## 6. Workflow

The commands, the dev stack and the receipts are in
[workflow-guide.md](docs/developers/workflow-guide.md#root-detail-moved-on-2026-10-26). **Model selection is not a waitron rule** —
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
  or when `main` touched a code file this branch also changed. Package-level failures caused only
  by combining branches are checked at the next full run, not at merge; the owner accepted this
  delay on 2026-11-08 (A1452). **Never `gh pr update-branch`** — its
  merge commit carries no sign-off and fails DCO.
- **Treat Dependabot PRs like any other, including strict sign-off** (owner, 2026-09-27).
  Check version-pinning guards and front-end qualification for npm-only bumps.
  Procedure: [workflow-guide.md](docs/developers/workflow-guide.md).
- **Do not merge a PR automatically — wait for the user's approval.** Invoking `/land-branch` is that
  approval; nothing else is.
- **Keep a plan-review checkout fixed until its wrapper returns; driver commits invalidate it too.**
  Receipt: [workflow-guide.md](docs/developers/workflow-guide.md#keep-a-plan-review-checkout-fixed-until-the-wrapper-returns).
- **Read a review report for completed findings, not just a successful wrapper exit.** Receipt:
  [workflow-guide.md](docs/developers/workflow-guide.md).
- **Merging requires resolved conversations.** Copilot is off here; the second model on the diff is
  Codex in `/finish-branch`'s run-it seat, before the PR exists. Verify CI runs belong to the current
  head SHA.
- **After merging, delete the feature branch, local and remote, and verify the remote one is gone** —
  it has repeatedly survived.
- **Run `pnpm install` in main after every pull**, as `/land-branch` does.
  Diff an untracked file that blocks the pull before deleting it.
- **Before a PR, run focused behavior checks, then `/finish-branch`.** §2 says what runs where.
- **Every agent that edits files or runs tests works in its own worktree**, or the agents take
  turns.
- **Development and loopback-only servers never advertise the appliance's LAN name.**
  Guard: `apps/server/src/mdns.test.ts`.
- **The dev stack from a worktree is started with `wa-wt demo <worktree-name>` or
  `wa-wt onboarding <worktree-name>`**, never a bare `pnpm dev*`.
- **The first dev stack's venue is a seeded directory of SQLite files on the host, shared by
  worktrees that take the first port slot. Moving between worktrees on the same target does not wipe
  that slot's venue — so a branch's migrations can fail on the rows already in it.**
  `wa-wt reset demo <name>` rebuilds it.
- **Mock-ups and screenshots are never committed, and not copied to Drive** (owner, 2026-11-02):
  they stay in the working folder of whoever made them and are shown to the owner directly. Cost:
  184 MiB of them in the tree when removed. Guard:
  `scripts/no-mockups-in-docs.test.ts`, weaker than its name: reads tracked file names, not
  content. [Limits](docs/developers/workflow-guide.md#mock-ups-and-screenshots-are-never-committed).

**Docs.** `docs/backlog.md` answers "what should I work on?" — read it before starting anything
unprompted, and **update it in the same change that makes it stale**. A change that finishes an
entry DELETES it rather than marking it done. **A loose end found in review is fixed in that pull
request; if that really cannot be done, it joins an existing bundle in its area. It, or a point a
finished entry leaves open, gets a short entry of its own in the same area only if a person would
notice it, it could cost money or a filing, or it breaks a written rule. Everything else stays in
the pull request thread** (owner, 2026-11-06). Cost: the list grew by about 25 entries a day, about
half of them from reviews. A decision a comment or doc cites moves to its area's
`## Decisions and deliberate limits` instead of being deleted. How, and where long detail goes:
`docs/backlog.md` → _How to keep this file honest_. Specs live in `docs/superpowers/specs/`, plans in
`docs/superpowers/plans/`, both committed deliberately. Session handoffs in `docs/handoffs/` are
gitignored — never open a PR for one. Historical docs record what was true when written: add a dated
pointer rather than rewriting them. The legal track is separate, in
`docs/compliance/action-plan.md`. [Receipt](docs/developers/workflow-guide.md#documentation-rules).

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
Guard: `scripts/claude-md-pointers.test.ts`, weaker than "every pointer": it reads text
and skips root-level filenames, bare directories, unlisted extensions and link anchors.
Its path rules and examples are in [writing-claims.md](docs/developers/writing-claims.md).

**Do not add:** one-off bugs with no reusable shape, anything the code or types already state plainly,
or the narrative of what a session did — that belongs in the commit or the PR thread. **A count is a
receipt that goes stale**, so describe the property, not the number. **If a guard enforces the rule,
name the guard and stop; a guard WEAKER than its name says so in the same line**, with what it misses
in the topic file. **Prune as well as append**: delete a superseded rule and say so in the commit; a
written rule with standing violations needs a guard, not another paragraph. **Contained, not capped**
(owner decision 2026-10-07): no byte limit and no gate on its size, and never purged because it is a few bytes over a number; move a receipt to its topic file
and delete a superseded rule whenever you touch an entry, and sweep when the file has grown
noticeably, as a loose guide past about 71 KB. The whole of this:
[writing-claims.md](docs/developers/writing-claims.md#root-receipts-moved-on-2026-11-06).

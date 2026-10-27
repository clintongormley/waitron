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
differs — on a pull request, only in the nightly run, or only locally — and neither `fiscal`'s nor
`db`'s floor is package-wide. Guard: `scripts/mutation-break-thresholds.test.mjs`, weaker than its
name — it reads the workflow as TEXT for the sharded packages' bars (db, ui and ui-core). Which
package bites where: [ci-and-gates.md](docs/developers/ci-and-gates.md).

Traps, each of which cost a round trip. The mechanism behind every one is in
[ci-and-gates.md](docs/developers/ci-and-gates.md#root-detail-moved-on-2026-10-26) — read it before changing anything about CI, the
hook, or how tests are scheduled:

- **`prettier --check` on an IGNORED path prints the same line as a clean one.** `docs/` is ignored
  whole, so `pnpm exec prettier --file-info <file>` is the one that discriminates — it prints
  `"ignored": true`.
- **Check every command's exit status.** A shell sequence separated by newlines reports only its
  LAST command's status. Use `&&` for dependent validation steps, or capture each status separately.
- **CI's test jobs measure coverage, never plain `test`**: `test:coverage`, or `test:shard` with
  the package's `-merge` job enforcing the bar. Verify that package’s coverage or merge job on the
  current head; run `pnpm --filter <pkg> test:coverage` locally when investigating a failure.
  Vitest `--shard` splits by FILE COUNT (`apps/server` excepted: its shards are packed by duration),
  so `N` must never exceed a package's test-file count.
  Guard: the "run no more shards than the package has test files" case in
  `scripts/ci-workflow.test.mjs`, weaker than its name — it counts files named `*.test.ts` under the
  package, not what the package's Vitest config includes.
- **`apps/server`'s shards are packed by the committed duration table, not Vitest's hash split.**
  Refresh it with `scripts/test-durations.mjs` when a shard drifts past 4 minutes. Guard:
  `scripts/vitest-duration-sequencer.test.mjs`, weaker than its name: checks packing, not a Vitest run or freshness.
- **Every CI test job should finish in about 4 minutes** (owner, 2026-10-09 and 2026-10-11).
  Fix the cause, never cut a check. Guards, weaker than the rule: the reporter only warns;
  `scripts/ci-workflow.test.mjs` pins shard counts and 10-minute limits.
- **A browser package's shard coverage merges through `scripts/vitest-shard-coverage-merge.mjs`,
  never a plain `--merge-reports`**. Guard: the browser-merge case in
  `scripts/ci-workflow.test.mjs`, weaker than its name — reads text, not the Vitest config. Receipt:
  [ci-and-gates.md](docs/developers/ci-and-gates.md).
- **Moving harness code out of a `.test.ts` and into `src/testing/` can put it under coverage and
  mutation**, depending on the package's coverage settings and Stryker `mutate` list.
- **CI does not run every check on every push.** Read the `changes` job's `code`, `scope` and
  `packages` outputs before treating a green PR as evidence about the workspace.
- **No front-end bundle is built by a pull request that changed no image input**, and wherever one
  is built nothing opens it, so a bundle that renders nothing passes anyway.
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
  Guard: `scripts/ci-workflow.test.mjs`, weaker than its name: reads text, does not judge the limit
  or read an external called workflow.
- **An apt-get in a workflow, `deploy/Dockerfile`, `deploy/waitron.sh` or the bench's CA probe image
  runs under an outer `timeout` and retries stalls and failures; so does `playwright install --with-deps`.**
  Guards: `scripts/ci-workflow.test.mjs` and `scripts/deploy-image-env.test.ts`, weaker than their names:
  read text, not retries; `scripts/waitron-sh.test.mjs` runs waitron.sh's retries under stubs.
- **Every workflow pnpm setup runs `scripts/ci-setup-pnpm.sh`: three attempts, each under `timeout`,
  then fail. Never use `pnpm/action-setup`.** Guards: `scripts/ci-workflow.test.mjs` (weaker than its
  name: reads text) and `scripts/ci-setup-pnpm.test.mjs`.
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
  it.** Grep for tests that pin the list, run those guards, and verify CI selects every affected consumer.
- **Browser-mode packages run real headless Chromium.** Decide concurrency by measured headroom
  (`memory_pressure | grep free`): beside another session only well above 15% free (owner, 2026-09-24),
  never beside background whole-workspace coverage. Chromium launch depends on seat permissions.
- **A migration can fail on a box with an earlier trigger naming what it changes, including in
  another set's trigger body.** Guard: `scripts/migration-upgrade.test.ts`, weaker than its name:
  synthetic counted rows, not compared; today's trigger lists, not each historical boot's.
- **The upgrade test uses `scratchParent()` from `scripts/scratch-dir.mjs` for its scratch directory.**
  It prefers `/dev/shm` when present. Nothing guards it.
- **CI's stream loop/pause tests and each `test-venue-service` shard set `TMPDIR=/dev/shm`, in CI only.**
  Guard: `scripts/ci-workflow.test.mjs`, weaker than its name: reads workflow text, not the tests.
- **The stream tests' CI job sets loopback's MTU to 1500 before they run, in CI only.** Guard:
  `scripts/ci-workflow.test.mjs`, weaker than its name — it reads `ci.yml` as text. Receipt:
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

### Screens, forms and the dashboard — [conventions-ui.md](docs/developers/conventions-ui.md#root-detail-moved-on-2026-10-26)

- **A refusal explains what happened and what each choice does; offer any needed administrator or owner sign-in there, and a safe Stop for destructive choices. Never send the person to somebody else.** The only exception is a state only a bug can produce, identified at the site as a fault in Waitron (owner, 2026-10-25). Nothing guards it. Receipt: [conventions-ui.md](docs/developers/conventions-ui.md#refusals-name-a-self-service-next-step).
- **New or changed forms use [design-system.md](docs/developers/design-system.md) → Forms.**
  Required fields are marked; invalid fields get inline errors and one localized bottom message on its
  own line above buttons, never a top summary, with the action disabled until fixed. Request refusals alone never disable it; field refusals
  appear under that field (owner, 2026-09-29).
  Saves stay quiet and disabled until the draft changes, using `draftScopeFor`, `saveActionState` and
  a save-handler early return (owner, 2026-10-07, A331). Other actions stay quiet while awaiting a choice,
  selection or load, or barred by row state; use their own colour when actionable or sending (owner,
  2026-10-08, A416/A427). Exceptions are in the Forms contract; nothing guards these across screens.
  A hint is the placeholder; short explanations are hints, not “?” buttons (owner, 2026-10-03; unguarded,
  A237). Inputs have semantic `name`s, never widget ids. Other dated decisions and the sign-in exception:
  [conventions-ui.md](docs/developers/conventions-ui.md).
- **A screen does not draw its own form field**: a `<select>`, a `<textarea>` or a text `<input>`
  comes from a field primitive; where none fits, add to one or add one (owner, 2026-10-01). Guard:
  `scripts/native-form-fields.test.ts`, weaker than its name — it reads string literals, and holds
  the files it allows by name only to a line count.
- **A `wt-help-tooltip` outside the setup wizard carries `mode="help-mode"`**, so it shows only while
  help is on (owner, 2026-10-18, A582 design §7). Guard: `scripts/help-tooltip-mode.test.ts`, weaker than its name — it reads
  literals as text; what it misses is in [conventions-ui.md](docs/developers/conventions-ui.md).
- **A screen change updates its guide in English and, where a twin exists, Spanish.**
  Every section heading carries a shared `{#id}`; dashboard/till links use each app's `help-guide.ts`. Guides live in
  `apps/server/src/guide/<language>/`, served at `/help/<language>/<page>`.
  Guards: `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`, weaker than their
  names: render/link/id checks and scoped text scans, not accuracy or proof the guide was updated.
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
- **Every staff-notice code a source sends is worded by the till's `staffNoticeText`**
  (`apps/till/src/i18n/staff-notices.ts`, from `staff_notice.<code>` in English and Spanish); a
  code it does not name is drawn as "The box needs attention". Guard:
  `scripts/staff-notice-codes.test.ts`, weaker than its name — it reads `code: "…"` literals as
  text, in source files it lists by hand. See [conventions-ui.md](docs/developers/conventions-ui.md).
- **A background API client does not make POST requests passive.** Only GETs are marked passive;
  automatic pairing renewal uses its own authenticated route.
- **Dashboard subscription names travel with their server sources.** Guard: `scripts/live-subscriptions.test.ts` — it catches unknown names, NOT missing SQL dependencies or disabled-module combinations. [Detail](docs/developers/conventions-ui.md).
- **A module adds a Calendar view through `calendarViews` on its `DashboardContribution`, never by
  venue-service importing it, and never names its address words in `apps/dashboard/src/navigation.ts`**,
  whose `keepUnlisted` already keeps them. Nothing guards the second half. See
  [conventions-ui.md](docs/developers/conventions-ui.md).
- **The dashboard banner is persistent identity chrome** — top of the page, full width, the tenant's
  legal name (not a location). The account menu (a person-icon `wt-row-actions` popover holding
  Account settings, Theme, Language and Log out) sits at the trailing edge only when a session exists.
- **The dashboard matches the browser's `Accept-Language` when no language is saved.** Guard against
  a late locale response overwriting an authenticated person's language or an explicit choice.
- **Dashboard login offers methods without revealing account enrolment.** Never query account status
  or passkey enrolment to choose the public screen. A modal passkey prompt requires an explicit
  action: navigation, refresh, logout and session expiry never open one. Save the authenticated email
  and the successful method only with Remember selected, never in tab storage.
- **A login refusal never reveals account existence** (owner, 2026-09-30): unknown, suspended,
  pending, wrong-secret and till-profile-inadmissible accounts answer `password.invalid` or `pin.invalid`
  after the same hashing work, as one sentence with no field marked. Only missing/malformed input marks
  a field; the real cause is a log-only `reason`. Owner-approved exception: `passkey.not_registered`.
  Guards: identity login and route suites, weaker than the set looks: no new sign-in route is covered.
- **A device's profile and the signed-in person must both allow a till action; profile zones bound
  service and its admission list bounds sign-in.** Preserve the stated action-map exceptions. New routes
  add refusing cases and rows to `apps/server/src/till-api.profile-actions.test.ts` and
  `apps/server/src/till-api.profile-zones.test.ts`; weaker than that sounds: the maps are comments.
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
- **A retained hardware registration must remain re-addable after deactivation.** Discovery finds
  disabled printers and card readers, and a disabled device's browser asks to rejoin; Enable brings
  each back under its existing id. A deleted printer, card reader or device is matched by neither
  and returns with a new id.
- **A narrower roll in a wider receipt printer needs an explicit print area before native
  centring.** Guard: `apps/server/src/receipt-ticket.test.ts`.
- **The hardware transport seam is `@waitron/print-agent`, and it is database-free.** It imports no
  other package in this repo, and `@waitron/printing` depends on IT, never the reverse. The guard is
  the `import-x/no-restricted-paths` zone in `eslint.config.js`, not the empty `dependencies` block.
- **A container that must reach a hot-plugged USB printer mounts `/dev:/dev:ro`**, plus
  `device_cgroup_rules: ["c 180:* rwm"]` and `group_add: ["7"]` — not a `/dev/usb` subdirectory bind
  and not a hard `devices:` line.
- **The print agent runs under `deploy/apparmor/waitron-print-agent`, named through
  `WAITRON_PRINT_AGENT_APPARMOR` only after `waitron.sh` has loaded it; a `bluetoothctl` call that
  sends a bus message the profile does not list is refused until the profile gains a rule for it.**
  Guards, weaker than their names: image-smoke (no Bluetooth on the runner) and
  `scripts/deploy-image-env.test.ts` (reads the profile as TEXT).
- **The unauthenticated recovery page's title and action are fixed strings chosen by the error
  code; its log tail is the file's last lines, whichever start or running server wrote them,
  written through `redactSecrets` and the personal-data mask (except the frozen-process watchdog's
  own line, which goes through neither), and HTML-escaped** (owner decision 2026-09-26; the tail's span and the personal-data mask are A980
  S10's defaults, open to the owner).
  `redactSecrets` masks only a password in a URL, which is why no code's params and no logged
  message may carry a secret.

### Data, modules and migrations — [conventions-data.md](docs/developers/conventions-data.md#root-detail-moved-on-2026-10-26)

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
  the venue's own): the list is flat across every code.** Cost: staff names and emails reached the
  sign-in-free recovery page. Guard:
  `scripts/personal-log-params.test.ts`, weaker than its name: reads text, judges keys by a word
  list and a named type only by its name, sees no spread at a throw site or in a log call, no free
  text and not the watchdog's own line. Limits: [conventions-ui.md](docs/developers/conventions-ui.md#the-unauthenticated-recovery-page-curated-title-and-action-the-failed-starts-report-and-the-logs-last-lines).
- **A recorded incident code needs an area claim and English and Spanish alert wording.** Guard:
  `scripts/alert-codes.test.ts`, weaker than its name — it reads literals in hand-listed files.
- **General code is English only** (owner, 2026-09-07 and 2026-10-19), including literals, comments,
  identifiers, file names, seeds, starter content and tests. Exceptions: `packages/fiscal-verifactu`,
  AEAT wire names, translation files/guides and Spain-specific packages (`country-es`, `workforce-es`,
  reporting's modelo 303) for official Spain-only text/terms (owner, 2026-10-20, A913).
  Country packs also provide English and own demo data; Spain receipts use the venue's receipt language,
  never English. Starter content (module seeds, core setup) is English in code and translated at
  setup; its words in other languages go in the writing package's `src/starter-content.ts`, which
  the guard skips by exact path (owner, 2026-10-20, A918); non-English screen tests read expected
  strings. Domain terms have one declaring module vocabulary; fiscal terms
  never enter the base.
  Guard: `scripts/english-only.test.ts`, weaker than its name: listed words and packages only, no apps;
  review greps the diff. Standing gaps and details: [conventions-data.md](docs/developers/conventions-data.md).
- **The composition list lives in `@waitron/composition`, and it is the only place that names every
  module.** Generic code reaches the regime through the descriptor's `provisioning` and `fiscal`
  seats. The boundary is the swappable SLOT, not "any module". Guard: `scripts/module-seams.test.ts`,
  weaker than its name (it reads text) — shrink its allowlist, never grow it.
  `@waitron/dashboard-modules` is the browser-side twin.
- **A configuration bundle value that is not a setup field stays out of `venue`'s own keys; the
  setup app copies `venue.location` by `LocationDraft`'s fields.** Cost: from #1752 to A980 S1a2 no
  production box could be set up from an export. Guard: the preview row in
  `apps/server/src/first-fiscal-setup.e2e.test.ts` and `apps/setup/src/setup-app-first-fiscal.test.ts`,
  weaker than the rule: the e2e row cuts the location by its own keys, so only the setup-app case
  catches a copied `fireControl`. [Detail](docs/developers/conventions-data.md#a-configuration-bundle-value-that-is-not-a-setup-field-stays-out-of-the-venues-own-keys).
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
  `scripts/deploy-image-env.test.ts`, weaker than their name — they read text, and a new binary or
  system package is seen by none of them.
- **`@waitron/db`'s `exports` map is enumerated, not a wildcard**, so `apps/server` cannot deep-import
  its `errors.ts`.
- **Never build SQL by string concatenation — except where the engine takes no bound value**: an
  identifier, and the body of a generated trigger. For those, either escape
  (`quoteIdent`/`quoteLiteral`) or validate and throw.
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
- **The tables `scripts/write-path-tables.json` lists request code may read and never write, and
  the database does not refuse the write.** A write of one of them lives only in the files that
  JSON names. Guard: `scripts/write-path-tables.test.ts` is
  the whole of the enforcement, and weaker than its name — it reads TEXT and judges a FILE, not a
  call chain. Receipt:
  [conventions-data.md](docs/developers/conventions-data.md#the-tables-scriptswrite-path-tablesjson-lists-are-read-only-to-the-application-and-one-guard-is-the-whole-of-the-enforcement).
- **Multi-table writes share ONE transaction: `withTransaction`.** Write-path functions take `tx: Transaction`, never open their own; handlers open one per request. Secret checks take `Database` and derive outside it,
  taking turns through `inTurn`. **Splitting one logical change across transactions is a commented
  decision, never a default.** **Await queries on one transaction in turn, never `Promise.all`.**
  No guard enforces this convention.
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
  Guards: `packages/store/src/disk-full.test.ts` and `write-queue.test.ts`, weaker than their names:
  page limits, not a real disk; at-commit cases are stand-ins. No guard enforces the test catch rule.
- **Identify result-code 1811 refusals by their words, never `isRefusal` alone.**
  Use `restrictRefused`/`triggerRaised` in `packages/db/src/constraint-target.ts`. Nothing guards it.
- **A full disk is not one error code; code 14 also names a missing folder.**
  `fullDiskFailure` in `apps/server/src/boot-failure.ts` classifies 13 always, 14/4874/`ENOSPC` only
  under 16 MiB free. Guard: its test suite, weaker than the rule: stubbed errors, no real `ENOSPC` case.
- **One process owns a venue folder at a time.** Tools documented to run beside the server use
  `exclusive: false`; file-changing commands take `lockVenueDatabase` before changing anything.
  Never unlink `venue.lock`/`recovery.lock`; change `recovery.json` only through `updateRecoveryState`.
  Guards: `packages/store/src/venue-lock.test.ts` and `apps/server/src/recovery-race.test.ts`, weaker
  than their names: prove the locks, not that every caller takes them.
- **Anything that writes or deletes in `<state>/backup-staging` does it inside the staging turn**
  (`apps/server/src/backup-staging-turn.ts`), **except the start's clean-up (`freeSpaceAtStart`),
  which runs while no backup supervisor is running in this process**. Guard:
  `scripts/backup-staging-touchers.test.ts`, weaker than its name — it reads text and never checks
  that a file takes the turn; the turn is in-process only. Receipt:
  [conventions-data.md](docs/developers/conventions-data.md#backup-staging-is-touched-only-inside-the-staging-turn).
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
- **Classify new tables `ledger`, `state` or `local` in their module; use `appendOnly()` for
  uncorrectable tables and `migrationOptionsFor(...)` when migrating.** Classification alone is not
  the trigger set; triggers cannot prevent `DROP TABLE`. Marking an existing table append-only must
  be disclosed in the PR because first start can raise `append_only.triggers_restored`.
  Guards: `scripts/classification-complete.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/apply-migrations-callers.test.ts`; the last is weaker than its name: call shape, not sets.
- **A new append-only table travels in both its module's exported migration descriptor and
  `packages/migrations/migrations.manifest.json`.** Guards:
  `scripts/append-only-migration-sets.test.ts` and `packages/composition/src/composition.test.ts`.
- **Live/restored database and venue-folder operations must expect Litestream's `_litestream_seq`,
  `_litestream_lock` and `.venue.db-litestream/`.** No guard finds a new site that omits them.
- **A `local` row belongs to one node, so no foreign key may join a `local` table to a
  `ledger`/`state` one, in either direction.** A `local` row that needs a venue row keeps the plain
  id and names, at the column, what establishes the target exists — or that nothing does, and where
  the refusal moved to. Guard: `scripts/two-file-foreign-keys.test.ts`, weaker than its name — it
  reads drizzle's generated snapshots, not hand-written SQL.
- **A `local` table says what ties a row to its node** — a `node_id` column that every read and
  write names, a seal only that node's key opens, or rows the transaction that wrote them deletes.
  A node holding another node's copy of `venue.db` must read its own rows or none. No guard makes a
  new `local` table say which.
- **Store anything that works as a live login as a hash.** Guards: database-copy cases in
  `apps/server/src/me-api.test.ts`, `apps/server/src/till-api.test.ts` and the stored-hash case in
  `packages/identity/src/management-session.test.ts`, weaker than the rule: limited credentials,
  only the dashboard hash tried as a token; new login tables unguarded.
- **Declare a migration-set dependency in `requires` for SQL references, trigger targets/body
  tables and top-level writes into that set.** Guard: `scripts/module-graph-honesty.test.ts`,
  weaker than its name: text scan recognising fixed SQL shapes.
- **A column of a transferred table that holds another row's id is a foreign key, a declared
  `references` entry, a location column or left out of the export** (`locationColumns`, `omit`);
  any other column the export carries arrives holding the exporting venue's id. Guard:
  `scripts/id-columns-are-references.test.ts`, weaker than its name — it knows an id column only by
  a name ending `_id` or `_ids`.
- **No new table enters the core migration set without a stated reason in the commit.** A domain
  table a module owns belongs to that module's own set, where its append-only classification
  travels with it.
- **Declare every foreign key and unique index in the TypeScript schema.** If impossible, say at
  the column what it cost and where the refusal moved. Guard: `scripts/schema-constraints.test.ts`,
  weaker than its name: reads built schema, never offending writes; matches unique indexes by name.
- **A drizzle migration-number collision on rebase is fixed by regeneration, never by hand-editing the
  snapshots or `_journal.json`.** Reset the migrations dir to main's state, regenerate, and verify by
  RUNNING `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/migrations-match-schema.test.ts` and
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
- **A drizzle table rebuild on this engine runs with foreign keys ON, so its `DROP TABLE` silently
  deletes every cascading child's rows, and fails on a `no action` or `restrict` child holding
  rows.** Before shipping a rebuild, list the foreign keys that point at the table.
- **A drizzle-kit 0.31.10–0.31.11 generation that rebuilds a table must not also add a column to
  it** (`no such column`). Add the column in one generation and its CHECK in the next.
- **A drizzle-kit 0.31.11 table rebuild writes an expression index back as quoted column names,
  which this engine refuses.** Take the index out of the schema for every generation that rebuilds
  its table and add it back in a generation of its own, with a note at the index.
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
- **Only boot and bucket rebuild check for an ahead-of-image database; `waitron.sh install <ref>`
  is a one-way door.** `assertNotAhead` throws `provisioning.database_ahead`; other migrating paths
  do not carry that check. Their list: [conventions-data.md](docs/developers/conventions-data.md).
- **An empty value is a valid value** — to whatever receives it, so a reader must turn `""` into
  "unset" itself. An env or prompt value set to `""` falls back to its default exactly as an unset
  one does (`isUnset`, `apps/server/src/env-value.ts`); a path never goes through `resolve("")`; and a reader with no default refuses `""`
  explicitly.
- **No backwards-compatibility or data-migration code until Waitron is in production.** Until then
  any installation may be reset at any time instead of carrying its data forward (owner,
  2026-10-03). This rule expires the day a real venue is live; add its replacement in the same
  change.

---

## 4. Testing

One line each; the mechanism, the measurement and the incident behind every one are in
[testing-guide.md](docs/developers/testing-guide.md#root-detail-moved-on-2026-10-26). **Read it before writing a database or
browser test** — most of these rules exist because a test passed while proving nothing.

- **One target.** A suite that needs a database gets a REAL one: `useVenueDb`. Guard:
  `scripts/venue-db-helper.test.ts`, weaker than its name — it holds only that nothing names the
  retired helper `usePgliteDb`.
- **Don't own a database in a suite — let `useVenueDb` own it.** Raw `beforeAll`/`afterAll` only
  when the suite legitimately builds its own resource, and then guarded. Guard:
  `scripts/guarded-teardowns.test.ts`.
- **Synchronous `node:sqlite` tests need a real timer turn for the venue watchdog; `useVenueDb`
  yields after each test.** Guards: `packages/db/src/testing/venue-db.test.ts` and
  `packages/store/src/venue-liveness.test.ts`, weaker than the rule: only the helper/default options
  and store loaded before fake clocks; manually opened folders get no helper turn.
- **No test suite under `packages/` or `apps/` starts a container; the rigs under `bench/` do.**
  **`TESTCONTAINERS_RYUK_DISABLED=true` is required locally**, and with it off an INTERRUPTED run
  leaks containers; `pnpm reap` removes them by label and age — but not every rig stamps the label.
  Never a blanket `docker volume prune`, and `docker volume inspect` before any manual `rm`.
- **Install pinned Litestream and versitygw before stream loop/pause tests:**
  `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`. S3 rehearsal/send-gate/
  interrupt suites need versitygw alone. Missing binaries skip locally and fail CI. Guard:
  `scripts/ci-workflow.test.mjs`, weaker than its name: text reads accept commented or disabled setup.
- **Full-disk start tests use a small real filesystem:** macOS makes one with `hdiutil`; Linux
  needs `WAITRON_FULL_DISK_DIR`, otherwise skips locally and fails CI. Interrupted macOS images
  can remain attached; `pnpm reap` does not detach them. Guard: `scripts/ci-workflow.test.mjs`,
  weaker than its name: reads workflow text.
- **On Vitest 4.1.12 a browser configured inside a project reads `connectTimeout` only from the
  OUTER config's `test.browser` block**; the command-line flag and that project's own `browser`
  block are ignored without a word. Nothing guards it. Receipt:
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
- **Draw every port a test needs in one `freePorts(n)` call, before binding any of them**
  (`apps/server/src/testing/free-ports.ts`), never two single draws before either is bound. Nothing
  guards it.
- **With `useVenueDb({ resetPerTest: false })`, a row found by a drawn port must be checked as
  this test's own row.** Guard: `apps/server/src/print-agent-e2e.test.ts`'s `portsNoPrinterNames` and
  pre-discovery check, weaker than the rule: this file only.
- **A fiscal fixture must not be over a minute ahead of a later recording write's clock.**
  In a shared database, every write and helper takes its clock from the latest record time;
  otherwise give the case its own database. Nothing guards it.
- **A suite that sends a room's revision to a today's-floor write route pins the API's clock at its
  own fixed time and seeds at that time**, or a run across the venue's day change can be refused
  `floor_today.out_of_date`. Nothing guards it. Receipt:
  [testing-guide.md](docs/developers/testing-guide.md#a-floor-test-pins-the-till-apis-clock-away-from-the-day-change).
- **An interrupted run also ORPHANS its vitest workers**, which spin at ~100% CPU until `kill -9`.
  `pnpm reap` sweeps these, scoped by ppid 1 AND the shapes vitest leaves in `ps`, never a bare `vitest` match.
- **Concurrent coverage runs must not share a package's report directory, and an intentional second
  one belongs OUTSIDE the package.**
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
  never 0**: Vitest 4 runs a `groupOrder: 0` project that runs one isolated worker AFTER every other
  group. Guard: `scripts/bookings-test-budget.test.ts` — which pins bookings alone.
- **A test's timeout must exceed the SUM of its waits plus untimed work.** Guard:
  `scripts/spawn-timeout-budget.test.ts`, weaker than its name: text scan of `scripts/` only,
  checks only the largest single wait; packages/apps unguarded.
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
- **Browser passkey tests stub `navigator.credentials`, keeping the WebAuthn library real.** A
  module mock cannot replace an already-loaded browser ES module.
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
- **Source scanners select files, not just paths ending in `.ts`.** A failing browser test creates a
  screenshot DIRECTORY named `*.test.ts`; `sourceFilesIn` checks `isFile()`.
- **A guard that reads the whole tree belongs in the ROOT Vitest project**, which the ungated
  `root-guards` job and the hook run on every non-docs push. The root project does
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
- **A fixture no check reads is unverified data, and a green suite resting on it proves nothing.**
  When a fixture describes something an authority will judge, run the real check over it.
- **Treat “there is a test” as unfinished: name the assertion that fails if behaviour is deleted.**
  Coverage alone and “doesn't throw” do not answer it; `pnpm --filter @waitron/ui mutation` checks it.
- **Rejected writes assert the domain error code.** A database constraint error also satisfies
  `toBeInstanceOf(Error)`.
- **`errors.ts` reachability is guarded once, in `scripts/errors-reachable.test.ts`**, weaker than
  its name — it reads text.
- **Vitest 4 ships no default coverage excludes at all.** What scopes a package's report now is its
  own `coverage.include`. `include`/`exclude` still replace rather than merge, and a config
  measuring nothing still exits 0 with the thresholds intact, so read the per-file table rather than
  the exit code.
- **A package config names its own source tree in `coverage.include`.** Guard:
  `scripts/coverage-thresholds.test.ts`, weaker than its name: looks for one exact string;
  include paths are not package-anchored.
- **Use `/* v8 ignore start */` … `/* v8 ignore stop */`, never `/* v8 ignore next */`.**
  Nothing guards it.
- **A page asserted as a STRING, or reached only through its API, has nothing checking that it
  renders.** Open it and LOOK, in both themes and at phone width. `apps/server`'s string-rendered
  pages have no harness: write the rendered string to a file and open it with the workspace's
  playwright Chromium.
- **In `packages/db`, import inside a case only to assert what a source module builds on load;
  otherwise import at the top.** Its Stryker config uses `ignoreStatic`; nothing guards this.
- **`toMatchObject` checks only the keys you list**; a key you never list is never checked at all.
- **A default you did not state is not a value you tested.** State it at every call site that
  shares it; a library can derive its default from the running runtime. Guard: the pinned-algorithm cases in `packages/identity/src/passkey.test.ts`.

---

## 5. Fiscal invariants — the unrecoverable ones

Mechanisms and full guard limits: [data](docs/developers/conventions-data.md#root-detail-moved-on-2026-10-26),
[printing](docs/developers/conventions-ui.md#root-detail-moved-on-2026-10-26) and
[stream tests](docs/developers/testing-guide.md#root-detail-moved-on-2026-10-26).

- **Printing never opens the drawer. Cash and hand-keyed card enqueue separate audited `drawer`
  jobs; documents contain no drawer commands and connected-card payments open nothing.** Device drawer
  choice precedes profile default, never follows receipt printer; require active printer with drawer
  and profile `open-cash-drawer`. Taking cash separately requires `take-cash` through `assertTakesCash`.
  Manual open needs an active device/session plus `cash.drawer` or the PIN of someone holding it and uses that same
  drawer; dashboard calibration is the exception. Never manually resend drawer jobs.
  Guards, weaker than the rule: named drawer/cash/refund/calibration/resend suites only; new routes
  unguarded. [Detail](docs/developers/conventions-ui.md).

- **One database per environment.** A pre-production database is never promoted. `WAITRON_ENV`
  governs this; unset means `preproduction`, `production` must be typed out, and `dev` is
  preproduction plus `config.devMode`.
- **Nothing EXTERNAL may block a sale — and a till needs the venue's PRIMARY.** AEAT, the card network
  and the internet are never on the sale path of whichever node is primary: records chain locally and
  the outbox drains later; a card falls back to 4G, a standalone terminal or cash. The till follows
  the primary and never chooses; only the primary sells. Fiscal submission is an outbox, never
  inline. TODAY a venue has ONE node and no failover at all; the intended failover is in
  `docs/backlog.md` → _Replication, membership & failover — residuals_. Detail:
  [conventions-data.md](docs/developers/conventions-data.md).
- **The bucket stream never waits on the bucket to sell or fails `/health`; its local checkpoint
  can hold the write lock and delay sales.** Fifteen minutes behind raises `backup.stream_behind`
  unless a stopped/refused/unusable-settings alert explains it. Guards: stream loop/pause e2e and
  health bucket-copy cases, weaker than the rule: named cases only; stream cases skip without binaries.
- **`registros_facturacion` is immutable: never work around its append-only update/delete triggers.**
  Triggers are the whole enforcement and cannot prevent `DROP TABLE`. Boot restores missing triggers
  on existing tables; boot and the trading watch refuse changed/missing triggers. `append-only-watch`
  is weaker than its name: stored text only, only tables migrated at start.
- **More than a minute behind the latest fiscal record, write no record and take/refund no new
  money unless a clock confirmation covers it.** After replay, call `refuseWhileClockBehind` before
  reader/refund/drawer work; pause both refund recovery loops. Recheck card-refund send/outcome in
  their dating transaction after provider waits. Still store money already moved.
  **Clock confirmation lifts the stop for one step back, with no gap limit; once a record is written
  under it, readings stay within a minute of the latest record written since.** Sources: AEAT, two agreeing devices at different
  addresses or an administrator's own device, never a box device outside development.
  Guards: clock-behind-stop, payments clock-behind, fiscal chain/restart/confirmation and clock-confirm
  route suites, weaker than the rule: only named routes/readings/requests; new money routes unguarded.
- **Never put our own metadata into a hash.** `entorno` must not enter `computeHuella`;
  differing only in it must leave hashes identical.
- **Re-registering starts a new chain under a new installation name; it is destructive for a
  working node.** Setup/restore/re-registration/promotion use five symbols for the box's UTC minute,
  after another machine's clock agrees within 30 seconds (no confirmation) and strictly later than
  all readable historical names and the name the start-again note keeps (`first-setup-start-again.json` in the state
  folder), which only `waitron.sh reset --all` removes (owner, 2026-10-24, A1042); guard
  `scripts/start-again-note-writers.test.ts`, weaker than its name: reads which files name the note. Setup/restore wait 90–150 seconds. Only preproduction throwaway
  skips second-clock/history checks; refuse it outside preproduction. Restore takes one source;
  working-time chain continues from its head. Guards: hour-selection/hour-clock/minute-selection-
  unknown-name suites (the last weaker than its name) and `packages/workforce/src/restore-continuation.test.ts`.
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
  or when `main` touched a code file this branch also changed. **Never `gh pr update-branch`** — its
  merge commit carries no sign-off and fails DCO.
- **Treat Dependabot PRs like any other, including strict sign-off** (owner, 2026-09-27).
  Check version-pinning guards and front-end qualification for npm-only bumps.
  Procedure: [workflow-guide.md](docs/developers/workflow-guide.md).
- **Do not merge a PR automatically — wait for the user's approval.** Invoking `/land-branch` is that
  approval; nothing else is.
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
Guard: `scripts/claude-md-pointers.test.ts`, weaker than "every pointer": it reads text
and skips root-level filenames, bare directories, unlisted extensions and link anchors.
Its path rules and examples are in [writing-claims.md](docs/developers/writing-claims.md).

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
the size the 2026-10-07 sweep left it (about 71 KB). Cost: this file is re-read on every step of every session and subagent. The 2026-10-07
cost estimate is in [writing-claims.md](docs/developers/writing-claims.md).

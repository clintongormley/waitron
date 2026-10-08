# Workflow guide

This file holds the evidence and reasoning behind the branch, commit, merge, documentation and
dev-stack rules in the repo root `CLAUDE.md` section 6 — that section keeps one to three lines per
rule plus a pointer here. Read this file when you are starting a branch, landing one, or trying to
run the development stack from a worktree.

## Branches and worktrees

**Never commit directly to `main`.** Feature work happens in a worktree
(`python3 ~/workspace/tools/worktree.py new waitron <branch> --headless` — not a plain
`git worktree add`, which `/land-branch` cannot tear down). Claude always passes `--headless`; only
the owner runs it without (owner decision 2026-09-27). Headless stops after git and the dependency
install, with no VS Code workspace file and no editor window; those are for the owner's own
interactive use. Name the branch right at creation; renaming it afterwards desynchronises the
worktree directory from the name both commands derive.

**A `docs/`-only change is exempt from the PR ceremony** (owner decision 2026-08-02): plain
`git worktree add`, `commit -s`, fast-forward `main`, push direct — no PR, no CI wait, no Copilot.
Measured: eslint lints 0 files under `docs/`, `prettier --file-info docs/backlog.md` is
`ignored: true`, and CI classifies it documentation-only. A ROOT `CLAUDE.md` or `README.md` is
format-checked (`ignored: false`) and takes the normal flow.

**The main checkout goes stale in a way the worktrees do not** — `worktree.py new` installs
dependencies per worktree and nothing installs here, so `tsc: command not found` can surface on a
push that carried no TypeScript. That is the message from a PACKAGE's script; the same words from
`pnpm exec tsc` at the repository ROOT mean nothing is wrong, because there is no `tsc` there by
design ([ci-and-gates.md](ci-and-gates.md) → *Two TypeScript compilers are installed, and that is
deliberate*). `/land-branch` runs `pnpm install` right after `git pull --ff-only`;
run it yourself after any other pull. The hook skips a push that only deletes refs (all-zero local
sha) and fails closed when stdin is empty.

**Every agent that edits files or runs tests works in its own worktree, or the agents take turns.**
The index belongs to the worktree, not to an agent: `git add <my paths>` adds to an index another
agent may already have written to (a `git mv` stages its rename at once), and `git commit` commits
the whole index. On 2026-09-21, on `feat/sqlite-slice1-flip`, a commit meant to hold two
`packages/db` files also carried three renames from two other agents' unfinished work, and its
message described none of them. Before committing in a shared worktree, check that
`git diff --cached --name-only` is empty before you stage, or pass the paths to the commit itself
(`git commit -- <paths>`). Tests collide too: a run started while another agent ran Vitest in the
same package of the same worktree printed `no tests` or nothing, and passed when re-run
(2026-09-29; [testing-guide.md](testing-guide.md)). On 2026-10-03 a reviewer of
#1139 ran one check in a disposable repository: a commit took two paths staged separately into the
index. Nothing else here was re-run.

## Commits, pull requests and merging

**Every commit needs `git commit -s`**; CI's `dco` job walks the whole PR range, and every push to `main` from its previous tip. **A PR that goes
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

**Dependabot pull requests** (owner decision 2026-09-27). `.github/dependabot.yml` asks for weekly
version updates for npm (the pnpm workspace at the root), GitHub Actions, the base images in
`deploy/Dockerfile`, and the images in `docker-compose.yml` and `deploy/compose.yml`. Version
updates arrive like this: minor and patch bumps grouped, one PR per ecosystem, except that `vitest`
and `@vitest/*` bumps at every level, majors included, get their own `vitest` group PR; any other
major bump comes alone. The compose entry lists two directories, and its first run still opened ONE
pull request for both (#764, _"Bump the compose-minor-and-patch group across 2 directories with 1
update"_). Security-fix PRs are switched on in the repository settings.

Dependabot's commits up to 2026-09-27 each carried their own sign-off, so the strict sign-off check
passed: Dependabot's commit in each of #764 (compose), #765 and #766 (npm) carried
`Signed-off-by: dependabot[bot] <support@github.com>`, and each PR's `Every commit is signed off`
check passed (with the repository's "Require contributors to sign off on web-based commits" setting
off). The GitHub Actions and Dockerfile update jobs also ran that day and opened no pull request, so
no commit of theirs has been seen. A commit without the line fails that check; the repair is the one
the pre-push hook prints, `git rebase --signoff <base>`, run on the Dependabot branch (checked out as
the next item describes) and pushed with `--force-with-lease` through the hook.

What still needs a person:

- **A guard that pins a version fails the bump.** #764's mailpit bump failed
  `scripts/dev-email.test.ts`, which checked for the literal old tag; it now checks for an exact
  `vX.Y.Z` tag and that both compose files agree. Fix such a guard to test the property rather than
  the number, on the Dependabot branch: `git fetch origin <branch>:<branch>`, then
  `python3 ~/workspace/tools/worktree.py new waitron <branch> --headless` (it checks out the
  existing branch; done with #764's slash-containing name), commit with `-s`, push through the
  hook. GitHub's docs say _"By default, Dependabot will stop rebasing a pull request once extra
  commits have been pushed to it"_
  (`content/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/manage-dependabot-prs.md`
  in github/docs, line 37, read 2026-09-27), so after such a push Dependabot no longer rebases it
  on its own.
- **A green CI result does not prove the build.** An npm-only Dependabot PR does not touch
  `deploy/`, so CI builds no front-end bundle (CLAUDE.md §2); any Dependabot PR that bumps a
  bundler or compiler (vite, esbuild, typescript) needs a local build with the root `build` script,
  its output compared with `main`'s, before landing — why CI does not do it:
  [ci-and-gates.md](ci-and-gates.md) → *What `bundle-smoke` does NOT cover: the three front-end
  bundles*.
- **A major bump is a migration, not an update.** #766 moved `@vitest/browser-playwright` alone to
  5.0.1 while every `vitest` stayed on 4, and failed CI; an earlier Vitest 5 move was abandoned on
  2026-09-19 because Stryker killed almost no mutants under it, and a retry has to re-measure
  mutation: [backlog/dependencies.md](../backlog/dependencies.md#a-vitest-5-retry-has-to-re-measure-mutation--nothing-about-stryker-10-settles-it),
  left behind by the Stryker upgrade (#447, 2026-09-19). The `vitest` group moves `vitest` and
  `@vitest/*` together, but #766 was closed with `@dependabot ignore this major version`, which Dependabot answered _"OK, I won't notify you about
  version 5.x.x again, unless you re-open this PR"_. GitHub's docs describe such ignores as stored
  per dependency
  (`content/code-security/reference/supply-chain-security/dependabot-pull-request-comment-commands.md`
  in github/docs, lines 29 and 42, read 2026-09-27) but do not say whether a grouped PR obeys one
  set on a single-dependency PR, so whether a Vitest 5 PR from the group leaves
  `@vitest/browser-playwright` behind is untested. Check with
  `@dependabot show @vitest/browser-playwright ignore conditions`. To clear it, the same file (line
  42) gives `@dependabot unignore @vitest/browser-playwright` on a grouped PR, which closes that PR
  and opens a new one, and
  `content/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/controlling-dependencies-updated.md`
  (line 117, read 2026-09-27) says reopening the PR also un-ignores it.
- **An alert whose fixed version no allowed release of its parent accepts gets no Dependabot
  PR.** Its security-update job fails with `security_update_not_possible`, as the `qs` one did on
  2026-09-27: `typed-rest-client` 2.3.1 pins `qs` 6.15.1 exactly, and `@stryker-mutator/core`
  allows only `typed-rest-client` `~2.3.0`, while `typed-rest-client` 3.1.2 declares `qs`
  `^6.16.0`. Fix it with a root `pnpm.overrides` entry scoped to that parent (`parent>child`), after
  running the parent's code that uses the child on both versions, as the 2026-09-28 security-alert
  fix did; receipts: _The receipt for the two overrides_, below.

  **The receipt for the two overrides** (A107, PR #796, 2026-09-28): four alerted packages were
  moved inside the ranges their parents already declare, and two are forced by root
  `pnpm.overrides` entries — `typed-rest-client>qs` to `^6.16.0` (6.16.0), and
  `@esbuild-kit/core-utils>esbuild` to `^0.25.0` (the 0.25.12 already in the tree). What was run for
  the two overrides: `typed-rest-client`'s query-string builder over eight parameter shapes gave the
  same URLs under `qs` 6.15.1 and 6.16.0 except one, where 6.15.1 threw a `TypeError` and 6.16.0
  does not (the `arrayFormat: 'comma'` null-entry fix in `qs` 6.15.2's changelog); a search of
  Stryker's installed `dist` found `typed-rest-client` imported in two of its JavaScript files,
  `initializer/npm-registry.js` and `reporters/dashboard-reporter/index.js`, and no
  `stryker.config.json` here names the dashboard reporter. `drizzle-kit` 0.31.11's shipped code never
  names `@esbuild-kit` (only its `package.json` does): with both `@esbuild-kit` folders renamed away,
  `drizzle-kit generate` in all fourteen migration sets printed the same as before; each set
  generated from nothing gave the same SQL and snapshots before and after the override (ids and
  timestamps aside); and the loader itself still runs a TypeScript file on esbuild 0.25.12. A full
  Stryker run over `packages/shared` gave the same 990 mutants with the same results on the old and
  new lockfile.

**Do not merge a PR automatically — wait for the user's approval.** Invoking `/land-branch` is that
approval; nothing else is.

**Merging requires resolved conversations** (`mergeStateStatus: BLOCKED` with green checks). Copilot
is switched off here (2026-09-06): the second model on the diff is Codex (`gpt-6.1-sol`) in
`/finish-branch`'s run-it seat, before the PR exists, so its findings are triaged with the others and leave no
thread. Copilot's lesson stands — its one reliable class was the sibling-file convention the branch
missed — so the convention reviewer's brief asks for siblings. A thread that does appear is resolved
via the GraphQL `resolveReviewThread` mutation with the id passed as a variable. Verify CI runs belong to the current head SHA
(`gh run list --json databaseId,headSha`).

**After merging, delete the feature branch, local and remote, and verify the remote one is gone**
(`git ls-remote --exit-code --heads origin <branch>` must fail) — it has repeatedly survived.

**An untracked file in the main checkout can block the post-merge `git pull --ff-only`.** Diff
before deleting; the scratch copy was 113 lines behind what landed.

**Before a PR**, run focused tests for the behavior you changed, then `/finish-branch`. Let the
normal hook run the §2 local checks once; let CI run mandatory package tests and coverage. Do not
add a whole-workspace local run solely because the branch is being finished. Verify the current-head
CI scope and results; the unfiltered `main` merge checks the combined tree when code is in scope.

## Documentation rules

**`docs/backlog.md` answers "what should I work on?"** — what is in flight, what is next, and why
in that order. Read it before starting anything unprompted, and **update it in the same change
that makes it stale**. The moment it goes stale most reliably is a MERGE, so `/land-branch` carries
an explicit step for it (the rule alone was violated within a cycle of being written). The legal
track is separate, in `docs/compliance/action-plan.md`.

Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/` — **committed,
deliberately**, because a plan doubles as an operator's runbook here. Session handoffs in
`docs/handoffs/` are **gitignored**: write one, leave it uncommitted, delete it when the work is
done; never open a PR for one. Anything durable in a handoff belongs in the root `CLAUDE.md` (§7) or in the backlog.

Historical docs record what was true when written. Add a dated pointer rather than rewriting them.

## The development stack from a worktree

Use localhost for laptop development. Development servers (`WAITRON_ENV=dev`) and loopback-only
HTTP listeners do not advertise the appliance's `waitron.local` name. On 2026-09-16,
`dns-sd -G v4 waitron.local` returned both the laptop (`192.168.10.101`) and box (`192.168.10.10`)
while the dashboard reported refused connections. After the laptop server stopped, the same probe
returned only the box. `apps/server/src/mdns.test.ts` covers the advertisement guard, and
`apps/server/src/boot.test.ts` checks a development HTTP listener still serves requests without
logging `mdns.responding`. The guard landed in #380.

**The dev stack from a worktree is started with `wa-wt demo <worktree-name>` or
`wa-wt onboarding <worktree-name>`** (`~/workspace/tools`),
never with a bare `pnpm dev*`. The first port slot uses
`$HOME/workspace/.waitron-dev/box`, including its venue across worktrees that take that slot. The
venue directory is derived from that state directory by
`defaultDevVenueDir` (`apps/server/scripts/dev-setup.ts`). The gitignored `apps/server/.env`
describes that venue (venue ids, credentials key), so `wa-wt` copies its newest copy into another
worktree that takes the first slot. Starting a second worktree while the first runs gives it ports
5290, 5291, 5292, 8180 and 9210 for till, dashboard, setup, server and print agent. Its own
`$HOME/workspace/.waitron-dev/instances/<name>/box/venue` and `.env` are provisioned separately.
`WAITRON_MANAGEMENT_ORIGIN` points at `http://localhost:5291`, so passkeys and account links stay
with that venue. Provisioning writes its shifted server port to that checkout's `.env`.
The two venues are directories of SQLite files on the host, not containers.

For side-by-side visual checks, start the first worktree, then start the second without taking the
first down. `wa-wt ls` shows which name owns each URL. While both run, name the instance in
`wa-wt logs <name>`, `wa-wt down <name>`, and `wa-wt reset demo <name>`; a bare command refuses to
guess. Stopping one leaves the other's listeners and venue open. A third start refuses until a port
slot is free.

**Compose holds nothing but the practice email inbox.** `docker-compose.yml` declares one service,
`mailpit`, and no container holds any part of a venue, so there is no volume a reset could clear.
It is started because `pnpm dev:setup` and `pnpm dev:reset` each begin
`docker compose up -d --wait mailpit`. Compose names its project after the directory, so an
unqualified `docker compose up` from a worktree starts a SECOND mailpit fighting for the fixed 1025
and 8025 ports, which is the reason the rule at the top of this paragraph exists — `wa-wt` brings
the shared one up under `COMPOSE_PROJECT_NAME=waitron`. It copies `.env` between worktrees sharing
the first slot and keeps the second slot's `.env` with its own venue.

Changing target REMOVES THAT INSTANCE'S VENUE DIRECTORY, keeping its development CA. Two steps do
it: `wa-wt`'s `reset_target` clears that instance's box state except `tls`, and the `dev:reset` it
then runs calls `resetVenueDir` (`apps/server/scripts/dev-setup.ts`), an `rm -rf` of the venue
directory whole. That comment says why the whole directory rather than
`venue.db`: the engine keeps write-ahead sidecars beside each file, and a venue file removed while
its `-wal` stays behind reopens on the OLD tail and answers wrongly without erroring.
`wa-wt reset demo [name]` and `wa-wt reset onboarding [name]` rebuild the selected target. The first
slot copies its new `.env` to other first-slot checkouts; the second keeps its own. Cost: a round
trip each on 2026-09-05 and 2026-09-06 while the original copy and reset rules were manual. Detail:
`docs/ui-review.md` → _Running the stack from a worktree_.

Writing to that database from outside the server — a seeding script, or any other process that
opens the venue directory — no longer puts your change on an open dashboard at the moment you write
it. The change trigger writes a row into
`change_log`, and the transaction that caused the change takes that row out again and hands it to
the dashboard once it has committed. What decides delivery is therefore `withTransaction` in the
process serving the dashboard, not "the server": promotion and deployment stamping write in a bare
`db.transaction`, and provisioning, the cold restore and the dev scripts write a venue database from
their own process. A write outside `withTransaction` is late rather than lost, because the drain
takes every row it finds — for an open dashboard, at worst the fifteen seconds between its event
stream's session re-checks (`apps/server/src/live-api.test.ts`, "delivers a write made outside
withTransaction"). A write through `withTransaction` in a DIFFERENT process is the one that is lost:
it drains the rows into a process with no dashboard attached.

What does NOT remove the first slot's directory is switching it between worktrees on the same
target. A target change removes the selected instance's directory, and so does `wa-wt reset` (read the script before assuming that
is the whole list — `ensure_env` has a third path). What `dev:setup` leaves behind is seeded, so
between removals the directory keeps demo rows written weeks and branches ago. A branch's migrations can then be unable to run over them:
migrations here carry no data-preservation code on purpose (`CLAUDE.md` §3 — no
backwards-compatibility or data-migration code until Waitron is in production), so one that adds a
column no existing row can fill stops the boot dead inside `applyMigrations`. Vite keeps serving the pages, so the dashboard still loads
while its calls fail — vite logs each one as `http proxy error … ECONNREFUSED`. On screen it shows
nothing: `#probeSession` (`apps/dashboard/src/dashboard-app.ts`) catches the rejection and drops to
the login screen without a banner. The failure only becomes words at sign-in, where no code comes
back and the dashboard falls back to `server.internal` — "Something went wrong, try again"
(`apps/dashboard/src/screens/login-screen.ts`, `apps/dashboard/src/i18n/codes.ts`; the fallback is
carried both by the request primitive and by `codeOf`). `wa-wt reset demo <name>` rebuilds the
database.

Boot now says so rather than leaving a driver stack trace to read: `apps/server/src/dev-migration-hint.ts`
logs `migrations.dev_constraint_violation` with the engine's result code and that command, then
re-throws the original error untouched — including when the log sink itself throws. It fires only when
`WAITRON_ENV=dev` (`isDevMode`, `apps/server/src/config.ts`), which both `dev-setup` and
`dev-onboard` write, though a `.env` copied from `.env.example` does not; and only for a pinned list
of result codes where a constraint met row data (`MIGRATION_CONSTRAINT_RESULT_CODES`). A null in a
`not null` column, for instance, is `NOT NULL constraint failed: <table>.<column>`, errcode 1299
(measured 2026-10-02 on `node:sqlite`, Node v26.7.0); the case `names the remedy for a real refusal
from the engine` in `apps/server/src/dev-migration-hint.test.ts` drives that refusal through the
line.

**What that line may and may not claim.** A constraint violation says a rule was broken. It does not
say whether the offending rows were already in the table or were inserted by the same migration —
and a migration free to write rows can produce any state on the list against a database that was
empty a moment earlier, which a wipe would not fix and a second wipe would not fix either. So the
line reports the failure as fact and offers the reset as a CONDITIONAL remedy; naming it outright
would send a developer to wipe a healthy database over a broken migration, twice.
`classifyBootFailure` (`apps/server/src/boot-failure.ts`) classifies a box's boot failures, and a
dev database is cheap to rebuild where a box's is not. The two share no result code, which a test
pins rather than a comment asserting it (``never names a code `boot-failure.ts` classifies``, in
`apps/server/src/dev-migration-hint.test.ts`): their remedies are opposites. The other
version-mismatch failure — a database NEWER than the image, not older — does not reach this line at
all: it throws `provisioning.database_ahead`, an `AppError` with no engine result code, and its
operator text deliberately never suggests wiping anything ("Restore it from a backup, or
reinstall", `apps/server/src/recovery-surface.ts` — owner decision 2026-09-10, because a real
venue's fiscal records cannot be re-created).

The print agent's dev launcher treats the inherited `WAITRON_STATE_DIR` as the server's box state
and nests its own state under `print-agent/`, so worktree switches retain its token and target
resets clear it. Wait for the server listener before choosing HTTP or HTTPS: onboarding can mint
the leaf during boot. Read the local public CA for dev trust; the unprivileged landing listener
can fail to bind port 80 (`landing.listen_failed`, `EACCES`). Regressions:
`apps/print-agent/src/dev.test.ts`.

## Iterating against a local checkout of `@waitron/verifactu`

`@waitron/verifactu` is no longer a package in this workspace — it was extracted into its own
repository and Waitron now installs the published release from the npm registry, the same as any
other outside dependency. When you need to change the library and the change together, point Waitron
at a local checkout instead of publishing a release for every edit.

Use a root **`pnpm.overrides`** entry. A `pnpm.overrides` entry in the workspace root `package.json`
applies across the whole workspace, the nested packages included — and every consumer of this
library here (`apps/server`, `packages/fiscal-verifactu`, `packages/provisioning`) is a nested
workspace package, so this is the method that actually reaches them. Add
`"@waitron/verifactu": "file:../../repos/verifactu"` (a path to your checkout) under
`pnpm.overrides` in the root `package.json` and run `pnpm install`; remove it again before you
commit.

Verified on 2026-09-21 in a throwaway install of this branch: before the override, resolving the
package from the nested `@waitron/fiscal-verifactu` returned the published
`@waitron+verifactu@0.1.0`; after the override plus `pnpm install`, the same command
(`pnpm --filter @waitron/fiscal-verifactu exec node -e "console.log(require.resolve('@waitron/verifactu'))"`)
returned the local checkout under `.../repos/verifactu`.

Do NOT use a root-level `pnpm link --global @waitron/verifactu` here. At the workspace root it exits
0 but does NOT redirect the workspace-nested consumers — `apps/server`, `packages/fiscal-verifactu`
and `packages/provisioning` go on resolving the published release — so it looks applied while
changing nothing that matters. (This was proven by the extraction branch's run-it reviewer.)

Keep that entry out of the commit (the other `pnpm.overrides` entries are committed security fixes;
see _The receipt for the two overrides_ under _Commits, pull requests and merging_): the manifests
that land always reference the published version, and CI installs that version, so an override left
in a diff would make CI and the box build a version they cannot fetch.

## Model selection

This paragraph summarises a rule defined in full in the user's global `~/.claude/CLAUDE.md`, which
every repo shares; it is not its own source of truth.

**Model selection (owner decision 2026-09-06; the Claude seats by owner decision 2026-09-23):**
the rule lives in the global `~/.claude/CLAUDE.md` so every repo shares it. In short: Claude and
Codex are separated. Every Claude seat — brainstorming, the driver, every dispatched subagent,
every review, and the unattended campaign runners — runs on the default model, Opus 5.5 at high
effort (switched to `xhigh` only when a task needs it), with no per-task model pin; Fable is not
used at all. The runners' `claude` has to accept that model. Measured 2026-09-23:
on 2.1.278, `claude -p --model 'claude-opus-5-5[1m]'` failed with "API Error: 400 Claude Code
2.1.278 does not support this model; version 2.1.280 or newer is required"; after `claude update`
to 2.1.280, `claude -p` with no `--model` under the runners' `~/.claude` profile reported
`claude-opus-5-5[1m]`. What 2.1.278 does with the runners' own call (no `--model`, profile alias
`opus[1m]`) was not measured. Codex
(`gpt-6.1-sol` at medium effort, owner decision 2026-09-30)
holds exactly one seat **in a Claude-driven session** — when Codex drives, the roles reverse and
Codex implements while Claude reviews (owner, 2026-09-12), so a Codex implementation is not a rule
violation; ask who is driving. That one seat is `/finish-branch`'s run-it reviewer, dispatched through
`~/workspace/tools/codex-seat.sh review-run`, which is the second model family on the diff now that
Copilot's automatic review is off (its rule was removed from the main ruleset 2026-09-06). The
repository carries no Codex file: the seat script passes the model, the effort, the doc-size cap
(`CLAUDE.md` exceeds Codex's default and would be silently truncated), the sandbox's network switch
(the Docker socket and DNS are closed by default; measured 2026-09-05) and the fallback that makes
Codex read `CLAUDE.md` when there is no `AGENTS.md` (measured 2026-09-06, with a control). The
probe that informed the Codex seat (2026-09-05, #242) planted three defects in one file and gave
Fable, Opus and `gpt-6-astra` the same run-it brief: all three found every planted defect and
refused the merge, and Astra took 14 minutes to their 5.5 but was billed to the ChatGPT plan, not
to Claude.


### Read the review report before treating it as complete

On 2026-10-07, A284's first `claude-seat.sh review-run` exited 0 after 539 seconds and wrote a
49-byte report: “Still running. I'll pick it up when it finishes.” Its nonempty report and usage
receipt did not contain findings or the running checks' results. After checking that those
subprocesses had exited, the driver retried the incomplete dispatch in the same installed
candidate with synchronous bounded checks. The retry published completed findings in 81 seconds.
Keep both reports and their timing/usage receipts; a pending response is no approval to push or land.

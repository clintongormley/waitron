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

**Every commit needs `git commit -s`**; the sign-off step of CI's `changes` job walks the whole PR range, and every push to `main` from its previous tip. **A PR that goes
`BEHIND` is not rebased for that alone** (owner decision 2026-09-05): with every check green on
the current head and every conversation resolved, when GitHub still reports it `MERGEABLE` and
what `main` gained since the merge-base is documentation, or code only in files this branch did
not touch, it lands as it is with `gh pr merge --squash --admin`. `--admin` there bypasses
the up-to-date requirement and nothing else — never a failing check or an open review. The
post-merge `main` run checks lint, types, root guards and builds as selected, but runs no package
tests in `ci.yml`. Two branches that break each other only when combined are checked by the next
full package run, not at merge. The owner accepted this delay on 8 November 2026 (A1452), retaining
the BEHIND rule; `/land-branch` step 2 still classifies the changed paths.

**A code overlap lands without a rebase when three checks pass** (owner, 2026-11-12, A1520). When
`main` changed a code file this branch also changed, a `BEHIND` PR that meets the conditions above
(every check green on the current head, every conversation resolved, `MERGEABLE`) still lands with
`--admin` if all three hold, and their results go in a PR comment before the merge:

1. It merges cleanly: `git merge-tree --write-tree origin/main origin/<branch>` exits 0.
2. It uses nothing `main` removed: for each shared file, no identifier or error code that `main`
   removed or renamed there (the `-` lines of `git diff <merge-base>..origin/main -- <file>`)
   appears on a line the branch adds (the `+` lines of `git diff <merge-base>..origin/<branch>`).
   Searching the branch's whole changed files instead also finds the name in the branch's own copy
   of the shared file, which still holds the lines `main` changed, so it fails a branch that never
   uses the name.
3. The merged tree typechecks: in a throwaway checkout of `origin/main` with the branch merged in,
   `pnpm install --frozen-lockfile`, then `pnpm --filter "...<package>" typecheck` for every package
   both sides changed. "No projects matched" is a failure, since pnpm exits 0 when it selects
   nothing.

The post-merge `main` run and the next full run then check it, with the same delay as above.
Rebase in the worktree only for `CONFLICTING` or a failed check — `pnpm install`, then push through
the hook, never `--no-verify`. **Never `gh pr update-branch`**, whose merge commit carries no
sign-off and fails DCO (#160).

**Dependabot pull requests** (owner decision 2026-09-27). `.github/dependabot.yml` asks for weekly
version updates for npm (the pnpm workspace at the root), GitHub Actions, the base images in
`deploy/Dockerfile`, and the images in `docker-compose.yml` and `deploy/compose.yml`. Version
updates arrive like this: minor and patch bumps grouped, one PR per ecosystem, except that `vitest`
and `@vitest/*` minor and patch bumps get their own `vitest` group PR, and their majors are ignored
until the Vitest 5 retry below; any other major bump comes alone. The compose entry lists two
directories, and its first run still opened ONE pull request for both (#764, _"Bump the
compose-minor-and-patch group across 2 directories with 1 update"_). Security-fix PRs are switched
on in the repository settings.

Dependabot's commits up to 2026-09-27 each carried their own sign-off, so the strict sign-off check
passed: Dependabot's commit in each of #764 (compose), #765 and #766 (npm) carried
`Signed-off-by: dependabot[bot] <support@github.com>`, and each PR's `Every commit is signed off`
check passed (with the repository's "Require contributors to sign off on web-based commits" setting
off). The GitHub Actions and Dockerfile update jobs also ran that day and opened no pull request, so
no commit of theirs has been seen. A commit without the line fails the sign-off step of CI's `changes` job,
and with it the required `ci` check; the repair is the one
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
- **A green build does not compare its output with the previous version.** The code-gated
  `bundle-smoke` job builds the three front-ends and opens setup with intercepted reads, including
  on npm-only Dependabot PRs. It does not open dashboard or till or compare any output with `main`.
  For a bundler or compiler upgrade (vite, esbuild, typescript), run the root `build` script locally
  and compare its output with `main` before landing.
  [What the CI check covers](ci-and-gates.md#built-applications-in-bundle-smoke).
- **A bundled package with no licence file of its own fails every bundle build that includes it,
  Node or front-end, once it moves to a version with no fallback.**
  `scripts/npm-bundle-notices.mjs` looks in `deploy/third-party/npm-fallback/` for a file named
  after the package and version, with `/` written as `+` (`@aws-sdk+nested-clients@3.997.50.txt`,
  `brotli@1.3.3.txt`), and throws `No licence notices found for: …` when there is none. An
  `@aws-sdk/client-s3` bump can move three such internal AWS SDK packages: #1760 renamed their
  fallbacks, and #2061's first CI run hit that error. Check that each new tarball still has no
  licence file and that its manifest's licence is unchanged, then rename the fallback to the new
  version; [deploy/third-party/README.md](../../deploy/third-party/README.md) asks for a new pinned
  fallback whenever the new tarball still has none.
- **A major bump is a migration, not an update.** #766 moved `@vitest/browser-playwright` alone to
  5.0.1 while every `vitest` stayed on 4, and failed CI; an earlier Vitest 5 move was abandoned on
  2026-09-19 because Stryker killed almost no mutants under it, and a retry has to re-measure
  mutation: [backlog/dependencies.md](../backlog/dependencies.md#a-vitest-5-retry-has-to-re-measure-mutation--nothing-about-stryker-10-settles-it),
  left behind by the Stryker upgrade (#447, 2026-09-19). Until that retry,
  `.github/dependabot.yml` ignores `vitest` and `@vitest/*` majors (A779: the Vitest 5 PR #1179's
  latest 30 CI runs, each on a new head, all failed or were cancelled, and #1179 was closed on
  2026-10-17); the retry removes that ignore. The `vitest` group has no `update-types`, so without
  the ignore it moves `vitest` and `@vitest/*` together, majors included, but #766 was closed with
  `@dependabot ignore this major version`, which Dependabot answered _"OK, I won't notify you about
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
  fix did; receipts: _The receipt for the two overrides_, below. The same failure also came when
  the parent's range already allowed the fix: on 2026-11-11 Dependabot's run 43045775511 reported
  `fast-xml-parser` 5.11.1 as the latest it could reach, although `@waitron/verifactu` 0.2.1 asks
  for `^5.11.1`. Its log shows it ran `pnpm update fast-xml-parser@5.12.0 --lockfile-only --no-save
  -r`, which leaves 5.11.1 in place; `pnpm update -r --depth Infinity fast-xml-parser` moved it to
  5.12.0 in the lockfile alone (A1504). Read the parent's range first; an override is for a range
  that leaves the fix out.

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
CI scope and results. Main uses the newest successful main baseline to select quick checks;
it runs no package tests in `ci.yml`. Full scheduled/manual runs enforce package coverage and
publish main images.
[Modes and limits](ci-and-gates.md#scoped-tests-and-full-verification).

### First Live setup qualification

For the A679 candidate, follow [first Live setup](../operations/first-live-fiscal-setup.md)
and [recovering a box](../operations/hour-recovery.md). Use an isolated production-shaped
host when the managed development stack enables dev mode. The owner's 19 October viewing
approval covered the recovery sheet as generated then, which still carried the installation code; automated download/entry checks and final branch
review remain distinct evidence. No physical-paper acceptance exercise remains under the
approved hour-code design.

Historical qualification, 2026-10-15: the compiled wizard/local host/saved-tool checks covered
both launch paths and custody choices with synthetic outside responses. Those results describe
the former signed-custodian route, not hour-based setup. Preserve them without repeating its
cancelled paper-check requirement.

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

### Mock-ups and screenshots are never committed

Owner decision 2026-11-02: a mock-up, design board or screenshot stays in the working folder of
whoever made it (a lane's campaign folder, a session's scratch space) and is shown to the owner
directly; it is not committed and not copied to Google Drive. The removal took 184 MiB out of the
tree; backlog item A1306 holds the history measurement and the rewrite.

The guard, `scripts/no-mockups-in-docs.test.ts`, reads `git ls-files` names only. It refuses
anything under `docs/backlog/mockups/` and a raster image (PNG, JPEG, GIF, WebP, BMP, TIFF, AVIF,
HEIC, HEIF) anywhere under `docs/`. It does not see:

- a PDF, SVG or HTML board under `docs/` outside `docs/backlog/mockups/` (a source PDF and a
  research tool's icon and page are tracked there legitimately);
- any image tracked outside `docs/`;
- an image with an extension the list does not name.

## The development stack from a worktree

Use localhost for laptop development. Development servers (`WAITRON_ENV=dev`) and loopback-only
HTTP listeners do not advertise the appliance's `waitron.local` name. On 2026-09-16,
`dns-sd -G v4 waitron.local` returned both the laptop (`192.168.10.101`) and box (`192.168.10.10`)
while the dashboard reported refused connections. After the laptop server stopped, the same probe
returned only the box. `apps/server/src/mdns.test.ts` covers the advertisement guard, and
`apps/server/src/boot.test.ts` checks a development HTTP listener still serves requests without
logging `mdns.responding`. The guard landed in #380.

**The dev stack from a worktree is started with `wa-wt demo <worktree-name>` or
`wa-wt onboarding <worktree-name>`** (`~/workspace/tools`), never with a bare `pnpm dev*`. Every
venue is a directory of SQLite files on the host, not a container. There are eight port slots:
slot _k_ serves the till, dashboard, setup, server and print agent on 5190, 5191, 5192, 8080 and
9110 plus 100 × _k_, so the second slot is 5290, 5291, 5292, 8180 and 9210.

**Compose holds nothing but the practice email inbox.** `docker-compose.yml` declares one service,
`mailpit`, and no container holds any part of a venue, so there is no volume a reset could clear.
It is started because `pnpm dev:setup` and `pnpm dev:reset` each begin
`docker compose up -d --wait mailpit`. Compose names its project after the directory, so an
unqualified `docker compose up` from a worktree starts a SECOND mailpit fighting for the fixed 1025
and 8025 ports, which is the reason the rule at the top of this section exists — `wa-wt` brings
the shared one up under `COMPOSE_PROJECT_NAME=waitron`.

Changing target REMOVES THAT INSTANCE'S VENUE DIRECTORY, keeping its development CA. Two steps do
it: `wa-wt`'s `reset_target` clears that instance's box state except `tls`, and the `dev:reset` it
then runs calls `resetVenueDir` (`apps/server/scripts/dev-setup.ts`), an `rm -rf` of the venue
directory whole. That comment says why the whole directory rather than
`venue.db`: the engine keeps write-ahead sidecars beside each file, and a venue file removed while
its `-wal` stays behind reopens on the OLD tail and answers wrongly without erroring. An
own-venue checkout is never reset this way; it has its own rebuild. A rebuild of the shared venue
copies its new `.env` to the other shared checkouts and `box/server.env`. Cost: a round trip each
on 2026-09-05 and 2026-09-06 while the original copy and reset rules were manual. Detail:
`docs/ui-review.md` → _Running the stack from a worktree_.

Writing to that database from outside the server — a seeding script, or any other process that
opens the venue directory — no longer puts your change on an open dashboard at the moment you write
it. The change trigger writes a row into
`change_log`, and the transaction that caused the change takes that row out again and hands it to
the dashboard once it has committed. What decides delivery is therefore `withTransaction` in the
process serving the dashboard, not "the server": promotion and deployment stamping write in a bare
`db.transaction`, and provisioning, the cold restore and the dev scripts write a venue database from
their own process. A write outside `withTransaction` is late rather than lost, because the drain
takes every row it finds on the next `withTransaction` in the serving process
(`apps/server/src/live-api.test.ts`, "delivers a write made outside withTransaction"). The event
stream's session re-checks are read-only and do not drain those rows. A write through
`withTransaction` in a DIFFERENT process is the one that is lost: it drains the rows into a process
with no dashboard attached.

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
reinstall", `apps/server/src/i18n/recovery-page.ts` — owner decision 2026-09-10, because a real
venue's fiscal records cannot be re-created).

The print agent's dev launcher treats the inherited `WAITRON_STATE_DIR` as the server's box state
and nests its own state under `print-agent/`, so worktree switches retain its token and target
resets clear it. Wait for the server listener before choosing HTTP or HTTPS: onboarding can mint
the leaf during boot. Read the local public CA for dev trust; the unprivileged landing listener
can fail to bind port 80 (`landing.listen_failed`, `EACCES`). Regressions:
`apps/print-agent/src/dev.test.ts`.

### The owner's dev stack and Claude's

Since 2026-11-14 `wa-wt` keeps the owner's stack and Claude's apart (owner's request, after a
Claude reset on slot 2 rewrote the main checkout's `.env` with port 8280 and the owner's next start
on slot 0 got a dashboard that could not reach its server). Design:
`~/workspace/tools/docs/superpowers/specs/2026-11-14-wa-wt-owner-and-claude-stacks-design.md`.

- **Who is starting.** A run is Claude's when `WA_WT_STARTER=agent` (every campaign lane exports
  it) or when `CLAUDECODE`, `AI_AGENT`, `CODEX_SANDBOX` or `CODEX_THREAD_ID` is set; otherwise
  the owner's. `WA_WT_STARTER=owner` forces the owner's side.
- **The owner's stacks** run on slot 0 only, one at a time: a start stops the owner's previous
  stack and starts the one asked for, after checking Docker, slot 0's ports and the checkout's
  `apps/server/.env`, so a refusal never leaves the owner with nothing running. Most checkouts
  share the venue in `$HOME/workspace/.waitron-dev/box` (its directory is derived by
  `defaultDevVenueDir`, `apps/server/scripts/dev-setup.ts`), and their `apps/server/.env`
  describes it (venue ids, credentials key); `wa-wt` keeps a copy in `box/server.env` and repairs
  a checkout's `.env` from it when it names another port or venue. A checkout marked
  `.waitron-dev/<name>.own-venue` (the owner's Santet data) keeps its own venue in
  `.waitron-dev/instances/<name>` and its own `.env`, still on slot 0's ports.
- **Claude's stacks** take slots 1–7 and never stop an owner stack. Each keeps its venue and
  settings in `.waitron-dev/claude/<name>`; `wa-wt` passes the settings file to the dev scripts as
  `WAITRON_DEV_ENV_FILE` (read by `dev-setup.ts`, `dev-onboard.ts` and `dev-server.mjs`), so the
  checkout's `.env` is never written. Its `WAITRON_MANAGEMENT_ORIGIN` points at its own dashboard
  port, so passkeys and account links stay with that venue. `wa-wt reset own demo <name>` rebuilds
  Claude's copy.
- **Rebuilding the owner's demo venue.** The owner runs `wa-wt reset demo [<name>]`. Claude may run
  it too, from the main checkout only (`wa-wt reset demo waitron`): it stops the owner's
  shared-demo stack, rebuilds, restarts it and waits for its server to answer, or checks the
  rebuilt venue on one of its own slots when nothing of the owner's was running. A lock
  (`.waitron-dev/box.lock`) keeps these from overlapping.

For side-by-side visual checks, Claude starts more worktrees beside the owner's; `wa-wt ls` shows
which name owns each URL and who started it. Bare `wa-wt down` and `wa-wt logs` act on the
caller's own side; name the instance when more than one of that side runs. When every slot a start
may use is held, it refuses and lists what holds each.

### Disposable preproduction setup and owned Live setup

Demo, Preparation and isolated readiness use the fiscal module's disposable preproduction
preparation (`packages/fiscal-verifactu/src/hour-throwaway-allocation.ts`), which names from the
box's clock with no second clock and no history check. Through the setup page, Live on a
development box (`config.devMode`) takes it too (`apps/server/src/setup-api.throwaway.test.ts`,
"marks Live on a dev box, whose request is stamped preproduction"). Any other Live setup,
and the terminal's, uses the owned flow: five symbols for the UTC minute, after a second clock on
another machine agrees within 30 seconds (`packages/fiscal-verifactu/src/hour-clock.test.ts`, "a
name needs a second clock within 30 seconds of the box"), not a minute a name in the history it
can read already holds (`packages/provisioning/src/first-setup-runtime.test.ts`, "the hosted
selector refuses a minute another node's revoked identity already uses", which covers a name in
the box's own database only; a later name does not refuse it,
`packages/fiscal-verifactu/src/hour-selection.test.ts`, "$action selects as with an empty history
beside $later", A1207), and after a 90 to 150 second
wait
(`packages/fiscal-verifactu/src/hour-selection.test.ts`, "every setup wait over a minute of box
readings lies in (90 000, 150 000]"). The terminal asks no recent-setup question
(`packages/fiscal-verifactu/src/initial-hour-setup.test.ts`, "the terminal asks nothing, prints
why it waits and until when, and keeps the wait"), and neither does the setup page, which has no
such field (`packages/fiscal-verifactu/src/setup/first-hour.browser.test.ts`, "asks no last-hour question and offers no clock confirmation").
Signed allocation files do not replace that flow.

Production and preproduction remain separate databases. A disposable preproduction allocation
is not production authority. Follow the [first Live procedure](../operations/first-live-fiscal-setup.md)
for ownership, readiness and kept-PDF requirements.

### A Veri\*Factu venue without a signed allocation

**Historical policy, 2026-10-15.** The following describes the earlier implementation and its measurements. Its S/P naming,
signer and supplied-allocation instructions are superseded by the hour-code design.

A Veri\*Factu venue's setup has to carry a fiscal allocation: the installation number and invoice
series a custodian (the person or service that hands out installation numbers and keeps the
register of them) has signed for that taxpayer. When a Demo or Preparation setup, or Live on a
development box (one started with `WAITRON_ENV=dev`), supplies no allocation, the box makes its
own: a throwaway allocation, signed by a key made in memory for that one setup and never written
anywhere (`packages/fiscal-verifactu/src/throwaway-allocation.ts`).

**When the box makes one.** On a non-production box, the setup route asks for a throwaway allocation
when the request carries no `initialOperations` (no supplied allocation) and the mode is Demo or
Preparation, or Live on a development box (`throwawayMarker`, `apps/server/src/setup-api.ts`). All three
are stamped preproduction: the database records which environment it belongs to, and Waitron
refuses to change it afterwards (`stampDeployment`, `packages/db/src/deployment.ts`);
`parseProvisionPayload` in the same file picks it. A request that supplies an
allocation uses the supplied operations after the route's mode check.

**When the setup route refuses it.** On a box started with `WAITRON_ENV=production`, the provision
route refuses Demo and Preparation after parsing, before calling provisioning. It answers HTTP 400
with `setup.mode_not_allowed`, including when you supply `initialOperations`; the check
does not depend on a module offering a throwaway allocation. The wizard hides both choices and
offers Reload if either is requested anyway. The development USB recipe writes
`WAITRON_INSTALLATION_ORIGIN=usb` to its `.env`; compose passes it to the app. USB
preproduction setup hides and refuses Demo, including supplied operations, while
retaining Prepare, Live and Join or recover. Production takes precedence and also
refuses Prepare. Missing or empty origin retains hand-installed choices; other
values fail configuration parsing. The USB Demo refusal offers Reload and names
the available choices. Same-box production re-setup remains part of B3.

The throwaway signer also refuses unless both the box's environment and the request's are
preproduction, before making a key. `provisionVenue` (`apps/server/src/provision.ts`) asks the
enabled module for that allocation before writing the deployment stamp.

**2026-10-15 A679 candidate:** the refusal below describes an unclaimed request. The claimed
wizard runs its separate preproduction readiness check before collecting email settings or a
production allocation. Activation still requires both. Follow the [guided first Live procedure](../operations/first-live-fiscal-setup.md)
for that path; `apps/server/src/first-fiscal-setup.e2e.test.ts` checks readiness before email and
refusal of production activation without email.

**Live on a real box needs a supplied allocation** (A679). On a box that is not a development box,
a Live setup that is otherwise complete but has no allocation stops at `setup.fiscal_test_required`
(HTTP 409) before its fiscal test, and past the test at `sif.allocation_invalid` with `reason:
reauthentication_required` (HTTP 400), as `apps/server/src/setup-api.throwaway.test.ts` shows.

**How to recognise a throwaway venue.** Its `fiscal_allocations` row has an `allocation_key`
beginning `throwaway-` and environment `preproduction`, the deployment is stamped `preproduction`,
and a setup through the wizard logged `setup.throwaway_allocation` with the mode. In what the signer
produces, the allocation, generation and block ids begin `throwaway-`, the custodian is
`waitron-throwaway-preproduction`, and the recipient venue and setup source are
`throwaway-preproduction`; the setup's event id is an ordinary UUID. The installation number
(`S000001`) and the series (`<code>-S000001`) are ordinary too, because they reach AEAT. A setup
replayed after a lost answer logs no line of its own.

**In-process scripts.** A script that provisions a venue database directly, without a server, calls
`applyDevelopmentVenue(actions, deps)` (`apps/server/scripts/throwaway-venue.ts`) where it would call
`applyVenue`. It refuses with `sif.throwaway_allocation_refused` before writing anything when its
own process runs with `WAITRON_ENV=production`, whether or not an enabled module offers a throwaway
allocation. With `WAITRON_ENV` unset, empty, `dev` or `preproduction` it goes through the same
throwaway step and stamps the database preproduction; any other value is refused as
`server.config_invalid`. `dev-setup.ts` uses it through `applyDeveloperDemoVenue`
(`apps/server/scripts/demo-seed/allocation.ts`). `apps/server/scripts/cloud-integration-fixture.ts`
does not: it calls `provisionVenue` with `initialAllocation`, as the setup route does, naming
preproduction as the host's environment because the server it then starts runs with
`WAITRON_ENV=dev`. It never reads its own process's `WAITRON_ENV`. What keeps it off a real venue
is that it refuses any `CLOUD_TEST_ROOT` outside the system's temporary directory, or without
`cloud-integration-` in its path.

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


### Keep a plan-review checkout fixed until the wrapper returns

`claude-seat.sh review-branch` compares the checkout's head and porcelain status before and after
its read. A driver commit during that read also triggers “reviewer changed the candidate checkout”
and discards the unpublished report. Use a fixed disposable snapshot when independent work must
continue. On 7 November 2026, A1393's amendment read started at `f1a0675ea0`; the driver committed
`c03db64c92` during it and the wrapper refused the result. The retry used an installed disposable
clone and returned the completed 397-second plan report.

### Read the review report before treating it as complete

On 2026-10-07, A284's first `claude-seat.sh review-run` exited 0 after 539 seconds and wrote a
49-byte report: “Still running. I'll pick it up when it finishes.” Its nonempty report and usage
receipt did not contain findings or the running checks' results. After checking that those
subprocesses had exited, the driver retried the incomplete dispatch in the same installed
candidate with synchronous bounded checks. The retry published completed findings in 81 seconds.
Keep both reports and their timing/usage receipts; a pending response is no approval to push or land.

Wait for the background task's completion status, and put an outer deadline on any polling loop.
Do not recognise completion by grepping the last output line. In A10-3's 2026-10-15 review, the
experiments had finished, but `until grep ... <(tail -1 ...)` accepted only an empty line or Git
status while the task output ended `[exited with code 0]`. `ps -p 54448 -o pid,ppid,etime,command`
showed that wait still running at 8:58. The driver retained the output and stopped that recorded
wait process and its recorded sleep child; the same review then published its completed findings.

Keep a probe's input bounded too. In A682's 2026-10-20 review, the command placed `cat >
/dev/null` before the Bash script containing its per-test timeouts. After 5:29, `ps -p
47263,47264 -o pid,ppid,etime,stat,wchan,command` showed only that shell and its `cat` child; no
test had started. The driver retained the process snapshot and sent SIGTERM to the recorded
`cat` pid 47264. The following snapshot showed Bash running the probe. A test timeout does not
cover a command waiting before the test is launched.


An ignored scratch file can still run through a tool. A682's 2026-10-20 pre-push hook stopped
at `pnpm lint` on an explicit `any` in its completed `.superpowers/sdd/.../guide-visual.mts`
probe. `git ls-files` returned no entry and `git check-ignore` named the file: Git ignored it,
but `eslint .` still read it. Keep completed executable probes outside the checkout; the driver
preserved this one in the campaign receipts before rerunning the normal hook.


## Root receipt excerpts moved on 2026-10-23

These passages retain the root instruction receipts moved by A1026. They are excerpts
from `CLAUDE.md` at `0285925d8c0ff55c1e4b86423a0471e78ab6e9b8`, not new measurements.

### Read a review report for completed findings, not just a successful wrapper exit

Cost: A284's first report was only pending prose.

### Every agent that edits files or runs tests works in its own worktree

Cost: one agent's commit carried another's staged renames, and a test run beside another agent's in the same package printed `no tests`.

### The dev stack from a worktree is started with `wa-wt demo <worktree-name>` or `wa-wt onboarding <worktree-name>`

The dev stack from a worktree is started with `wa-wt demo <worktree-name>` or `wa-wt onboarding <worktree-name>`, never a bare `pnpm dev*` — compose names its project after the directory, so an unqualified `docker compose up` starts a SECOND `mailpit` fighting for the fixed 1025 and 8025 ports.

### The first dev stack's venue is a seeded directory of SQLite files on the host, shared by worktrees that take the first port slot. Moving between worktrees on the same target does not wipe that slot's venue — so a branch's migrations can fail on the rows already in it

Cost: repeated dead boots with only a driver stack trace to read.


## Root detail moved on 2026-10-26

These excerpts retain the supporting detail and full guard limits from `CLAUDE.md` at
`fa3e76787188a08a8367477202cb03e5840d1b7d` before A1114 shortened the root entries.
They are source excerpts, not new experiments or changes to the rules.

### Treat a Dependabot pull request like any other: an npm-only one's green CI builds no front-end, and a guard that pins a version number fails its bump.

Updated 2026-11-07 by A1402: the front-end build gap in this historical excerpt is closed.
Use the current [Dependabot guidance](#dependabot-pull-requests) above; CI builds all three
front-ends and opens setup, while output comparisons and dashboard/till rendering remain outside it.

**Treat a Dependabot pull request like any other: an npm-only one's green CI builds no front-end,
and a guard that pins a version number fails its bump.** A bot gets no exemption from the strict
sign-off check (owner decision 2026-09-27). How to land one:
[workflow-guide.md](workflow-guide.md) → _Dependabot pull requests_.

### The main checkout goes stale in a way the worktrees do not

**The main checkout goes stale in a way the worktrees do not**, because nothing installs there.
`/land-branch` runs `pnpm install` after the pull; run it yourself after any other pull. An
untracked file there can block the post-merge `git pull --ff-only` — diff it before deleting.

### Development and loopback-only servers must not advertise the appliance's LAN name.

**Development and loopback-only servers must not advertise the appliance's LAN name.** A laptop
and box both answered `waitron.local`, sending some lookups to the laptop. Guard:
`apps/server/src/mdns.test.ts`.


### Regional developer demos

For a fresh practice venue in Catalonia, run
`WAITRON_DEMO_REGION=catalonia wa-wt demo <worktree-name>`. Use `balearic` for
Palma, `valencia` for València, `galicia` for A Coruña, or `madrid` for the Madrid demo. An unset, empty or whitespace-only selector
uses Madrid; an unknown selector refuses before database or settings work.

Catalonia and the Balearic Islands share Can Delgado's regional dishes and cava.
The Valencian preset uses Casa Delgado de l'Horta; Galicia uses A Casa Delgado,
with regional dishes and Albariño. Staff and kitchen names, menus, departments
and stations follow the seed's English or Spanish language.
Customer wording keeps each region's translations. A new Catalonia venue uses
Catalan receipts; the Madrid, Balearic, Valencian and Galician presets use Spanish receipts.
Screens remain English or Spanish.

Changing `WAITRON_DEMO_REGION` keeps an existing venue's stored geography and data.
To replace a throwaway venue you own, run
`WAITRON_DEMO_REGION=catalonia wa-wt reset demo <worktree-name>` (the owner's shared demo venue), or,
from Claude, `WAITRON_DEMO_REGION=catalonia wa-wt reset own demo <worktree-name>` (Claude's own copy).

## Root receipts moved on 2026-11-02

These excerpts retain the root instruction receipts from `CLAUDE.md` at
`1d03a7c42142478f6ecabc834f08ffd58bd04d07`. They are not new measurements.

### Mock-ups and screenshots are never committed (root entry)

- **Mock-ups and screenshots are never committed, and not copied to Drive** (owner, 2026-11-02):
  they stay in the working folder of whoever made them and are shown to the owner directly. Cost:
  184 MiB of them in the tree when removed; A1306 rewrites the history. Guard:
  `scripts/no-mockups-in-docs.test.ts`, weaker than its name: reads tracked file names, not
  content. [Limits](workflow-guide.md#mock-ups-and-screenshots-are-never-committed).

### Docs: the backlog, specs, plans and handoffs

Changed on 2026-11-06, unlike the rest of this section: the sentences on loose ends are the owner's
rule of that date, not text from `1d03a7c`.

- **Docs.** `docs/backlog.md` answers "what should I work on?" — read it before starting anything
  unprompted, and **update it in the same change that makes it stale** (the moment it goes stale most
  reliably is a MERGE). A change that finishes an entry DELETES it rather than marking it done. A
  loose end found in review is fixed in that pull request; if that really cannot be done, it joins
  an existing bundle in its area. It, or a point a finished entry leaves open, gets a short entry of
  its own in the same area only if a person would notice it, it could cost money or a filing, or it
  breaks a written rule. Everything else stays in the pull request thread (owner, 2026-11-06). An
  entry's long detail goes in its area's file under `docs/backlog/`. A decision a comment or doc cites moves to its area's
  `## Decisions and deliberate limits` instead of being deleted, and entries there are never deleted
  for being finished. How: `docs/backlog.md` → _How to keep this file honest_.
  Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`,
  both committed deliberately because a plan doubles as an operator's runbook. Session handoffs in
  `docs/handoffs/` are gitignored — never open a PR for one. Historical docs record what was true when
  written: add a dated pointer rather than rewriting them. The legal track is separate, in
  `docs/compliance/action-plan.md`.

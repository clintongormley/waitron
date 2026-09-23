# Workflow guide

This file holds the evidence and reasoning behind the branch, commit, merge, documentation and
dev-stack rules in the repo root `CLAUDE.md` section 6 — that section keeps one to three lines per
rule plus a pointer here. Read this file when you are starting a branch, landing one, or trying to
run the development stack from a worktree.

## Branches and worktrees

**Never commit directly to `main`.** Feature work happens in a worktree
(`python3 ~/workspace/tools/worktree.py new waitron <branch>` — not a plain `git worktree add`,
which `/land-branch` cannot tear down). Name the branch right at creation; renaming it afterwards
desynchronises the worktree directory from the name both commands derive.

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

## Commits, pull requests and merging

**Every commit needs `git commit -s`**; CI's `dco` job walks the whole PR range. **A PR that goes
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

**Do not merge a PR automatically — wait for the user's approval.** Invoking `/land-branch` is that
approval; nothing else is.

**Merging requires resolved conversations** (`mergeStateStatus: BLOCKED` with green checks). Copilot
is switched off here (2026-09-06): the second model on the diff is Codex (`gpt-6-astra`) in
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
done; never open a PR for one. Anything durable in a handoff belongs here (§7) or in the backlog.

Historical docs record what was true when written. Add a dated pointer rather than rewriting them.

## The development stack from a worktree

Use localhost for laptop development. Development servers (`WAITRON_ENV=dev`) and loopback-only
HTTP listeners do not advertise the appliance's `waitron.local` name. On 2026-09-16,
`dns-sd -G v4 waitron.local` returned both the laptop (`192.168.10.101`) and box (`192.168.10.10`)
while the dashboard reported refused connections. After the laptop server stopped, the same probe
returned only the box. `apps/server/src/mdns.test.ts` covers the advertisement guard, and
`apps/server/src/boot.test.ts` checks a development HTTP listener still serves requests without
logging `mdns.responding`. Full probe record:
[printer setup incident](../superpowers/specs/2026-09-16-printer-setup-refinements.md).

**The dev stack from a worktree is started with `wa-wt demo <worktree-name>` or
`wa-wt onboarding <worktree-name>`** (`~/workspace/tools`),
never with a bare `pnpm dev*`. **The dev database is shared by every checkout** — that part has not
changed — but what shares it is a STATE DIRECTORY on the host, not a container. `wa-wt` runs every
worktree's `pnpm dev` and `pnpm dev:setup` with `WAITRON_STATE_DIR` pointing at the same
`$HOME/workspace/.waitron-dev/box`, and the venue directory, two SQLite files, is derived from that
state directory by `defaultDevVenueDir` (`apps/server/scripts/dev-setup.ts`) — so every worktree
opens the same files by construction rather than by two settings agreeing. `apps/server/.env`
describes that venue (venue ids, credentials key); it is gitignored and absent from a fresh
worktree, which is why `wa-wt` copies the newest copy any checkout holds.

**Compose holds nothing but the practice email inbox.** `docker-compose.yml` declares one service,
`mailpit`, and no container holds any part of a venue, so there is no volume a reset could clear.
It is started because `pnpm dev:setup` and `pnpm dev:reset` each begin
`docker compose up -d --wait mailpit`. Compose names its project after the directory, so an
unqualified `docker compose up` from a worktree starts a SECOND mailpit fighting for the fixed 1025
and 8025 ports, which is the reason the rule at the top of this paragraph exists — `wa-wt` brings
the shared one up under `COMPOSE_PROJECT_NAME=waitron`, copies only the current target's `.env`, and
follows the log.

Changing target REMOVES THE VENUE DIRECTORY, keeping the shared development CA. Two steps do it:
`wa-wt`'s `reset_target` clears everything under `$HOME/workspace/.waitron-dev/box` except `tls`,
and the `dev:reset` it then runs calls `resetVenueDir` (`apps/server/scripts/dev-setup.ts`), an
`rm -rf` of the venue directory whole. That comment says why the whole directory rather than
`venue.db`: the engine keeps write-ahead sidecars beside each file, and a venue file removed while
its `-wal` stays behind reopens on the OLD tail and answers wrongly without erroring.
`wa-wt reset demo [name]` and `wa-wt reset onboarding [name]` rebuild the selected target and copy
its new `.env` to every checkout. Cost: a round trip each on 2026-09-05 and 2026-09-06 while the
two rules were manual. Detail: `docs/ui-review.md` → _Running the stack from a worktree_.

Writing to that database from outside the server — a seeding script, or any other process that
opens the venue directory — no longer puts your change on an open dashboard at the moment you write
it. (`psql` is not one of the ways: it speaks the PostgreSQL wire protocol and cannot open a SQLite
file.) The change trigger writes a row into
`change_log`, and the transaction that caused the change takes that row out again and hands it to
the dashboard once it has committed. What decides delivery is therefore `withTransaction` in the
process serving the dashboard, not "the server": promotion and deployment stamping write in a bare
`db.transaction`, and provisioning, the cold restore and the dev scripts write a venue database from
their own process. A write outside `withTransaction` is late rather than lost, because the drain
takes every row it finds — for an open dashboard, at worst the fifteen seconds between its event
stream's session re-checks (`apps/server/src/live-api.test.ts`, "delivers a write made outside
withTransaction"). A write through `withTransaction` in a DIFFERENT process is the one that is lost:
it drains the rows into a process with no dashboard attached.

What does NOT remove that directory is the common case: switching between worktrees on the same
target. A target change removes it, and so does `wa-wt reset` (read the script before assuming that
is the whole list — `ensure_env` has a third path). What `dev:setup` leaves behind is seeded, so
between removals the directory keeps demo rows written weeks and branches ago. A branch's migrations can then be unable to run over them:
migrations here carry no data-preservation code on purpose (`CLAUDE.md` §3 — schema changes drop and
recreate until Waitron is in production), so one that adds a column no existing row can fill stops
the boot dead inside `applyMigrations`. Vite keeps serving the pages, so the dashboard still loads
while its calls fail — vite logs each one as `http proxy error … ECONNREFUSED`. On screen it shows
nothing: `#probeSession` (`apps/dashboard/src/dashboard-app.ts`) catches the rejection and drops to
the login screen without a banner. The failure only becomes words at sign-in, where no code comes
back and the dashboard falls back to `server.internal` — "Something went wrong, try again"
(`apps/dashboard/src/screens/login-screen.ts`, `apps/dashboard/src/i18n/codes.ts`; the fallback is
carried both by the request primitive and by `codeOf`).
The core set's migration 0020_category_names did exactly this on 2026-09-13: it dropped the old text
`categories.name` and recreated it as `jsonb NOT NULL`, which the seeded demo categories cannot
satisfy — SQLSTATE `23502`. `wa-wt reset demo <name>` rebuilds the database. (That file was deleted by
the SQLite flip on 2026-09-21, which regenerated every set as one baseline; it is named here without a
backticked path because `scripts/claude-md-pointers.test.ts` would read one as a live pointer. The
trap it illustrates is unchanged — a migration a shared seeded database cannot satisfy.)

Boot now says so rather than leaving a driver stack trace to read: `apps/server/src/dev-migration-hint.ts`
logs `migrations.dev_constraint_violation` with the engine's result code and that command, then
re-throws the original error untouched — including when the log sink itself throws. It fires only when
`WAITRON_ENV=dev` (`isDevMode`, `apps/server/src/config.ts`), which both `dev-setup` and
`dev-onboard` write, though a `.env` copied from `.env.example` does not; and only for a pinned list
of result codes where a constraint met row data. (It read a PostgreSQL SQLSTATE until the storage
switch; `23502` in the example above is what the old engine reported, and this one reports
`NOT NULL constraint failed: <table>.<column>`, errcode 1299.)

**What that line may and may not claim.** A constraint violation says a rule was broken. It does not
say whether the offending rows were already in the table or were inserted by the same migration —
and a migration free to write rows can produce any state on the list against a database that was
empty a moment earlier, which a wipe would not fix and a second wipe would not fix either. The
review put each listed state through the real migration runner on PostgreSQL 18 on 2026-09-13,
using SQL written for the experiment, and got the same SQLSTATE both when the offending rows were
already in the table and when the migration inserted them itself. Only `23502` was also reproduced
against this repository's own migrations (below); no migration here declares an exclusion constraint
at all, so `23P01` is on the list from that experiment and from what the state means, not from a
case seen in this tree. So the
line reports the failure as fact and offers the reset as a CONDITIONAL remedy; naming it outright
would send a developer to wipe a healthy database over a broken migration, twice.
`classifyBootFailure` (`apps/server/src/boot-failure.ts`) answered the same problem the other way,
by DROPPING the ambiguous `22P02` from its table so the ambiguous case gets no advice at all — same
principle, opposite move, because a dev database is cheap to rebuild and a box's is not. That is also
why the two share no SQLSTATE table, which a test pins rather than a comment asserting it: their
remedies are opposites. The other version-mismatch failure — a database NEWER than the image, not
older — does not reach this line at all: it throws `provisioning.database_ahead`, an `AppError` with no
SQLSTATE, and its operator text deliberately never suggests wiping anything ("Restore it from a
backup, or reinstall", `apps/server/src/recovery-surface.ts` — owner decision 2026-09-10, because a
real venue's fiscal records cannot be re-created).

Reproduced end to end before the line was written: the pre-#340 migration root migrated into a
scratch database, one category row seeded, then this branch's root applied over it — the hint printed
and the original error still arrived intact.

`dev-setup` bootstraps no ownership of any kind. There is no migrator role and no owner to be:
`grep -niE "waitron_migrator|migrator|psql|postgres|role" apps/server/scripts/dev-setup.ts` returned
nothing on 2026-09-23, and `packages/provisioning/README.md` records that the command this sentence
used to compare against, `waitron-provision instance` — which created a database, created the
`waitron_migrator` and `waitron_app` roles, migrated and stamped it — was deleted with the
PostgreSQL deployment model. What `dev-setup` does instead is call the product's own
`applyMigrations` and `openVenueDatabase` over the venue directory
(`apps/server/scripts/dev-setup.ts`, the same two entry points `apps/server/src/boot.ts` uses), and
then provision into it. So a `wa-wt reset demo` boot still migrates through the code a box migrates
through; what has no counterpart any more is the ownership the old sentence was really about.

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
and `packages/provisioning` go on resolving the published `0.1.0` — so it looks applied while
changing nothing that matters. (This was proven by the extraction branch's run-it reviewer.)

Keep the override out of the commit: the manifests that land always reference the published version,
and CI installs that version, so an override left in a diff would make CI and the box build a version
they cannot fetch.

## Model selection

This paragraph summarises a rule defined in full in the user's global `~/.claude/CLAUDE.md`, which
every repo shares; it is not its own source of truth.

**Model selection (owner decision 2026-09-06; the Claude seats by owner decision 2026-09-23):**
the rule lives in the global `~/.claude/CLAUDE.md` so every repo shares it. In short: Claude and
Codex are separated. Every Claude seat — the driver, every dispatched subagent, every review, and
the unattended campaign runners — runs on the default model, Opus 5.5 at high effort, with no
per-task model pin; Fable 5.1 is opt-in for the brainstorm only, does no reviews, and never drives
execution — a hook denies it. The runners' `claude` has to accept that model. Measured 2026-09-23:
on 2.1.278, `claude -p --model 'claude-opus-5-5[1m]'` failed with "API Error: 400 Claude Code
2.1.278 does not support this model; version 2.1.280 or newer is required"; after `claude update`
to 2.1.280, `claude -p` with no `--model` under the runners' `~/.claude` profile reported
`claude-opus-5-5[1m]`. What 2.1.278 does with the runners' own call (no `--model`, profile alias
`opus[1m]`) was not measured. Codex
(`gpt-6-astra` at medium effort — measured against Sol on one commit with one bounded brief: faster,
fewer tokens, and it found the real defect that Sol at low missed)
holds exactly one seat **in a Claude-driven session** — when Codex drives, the roles reverse and
Codex implements while Claude reviews (owner, 2026-09-12), so a Codex implementation is not a rule
violation; ask who is driving. That one seat is `/finish-branch`'s run-it reviewer, dispatched through
`~/workspace/tools/codex-seat.sh review-run`, which is the second model family on the diff now that
Copilot's automatic review is off (its rule was removed from the main ruleset 2026-09-06). The
repository carries no Codex file: the seat script passes the model, the effort, the doc-size cap
(`CLAUDE.md` exceeds Codex's default and would be silently truncated), the sandbox's network switch
(the Docker socket and DNS are closed by default; measured 2026-09-05) and the fallback that makes
Codex read `CLAUDE.md` when there is no `AGENTS.md` (measured 2026-09-06, with a control). The
seat-by-seat probe that informed the Codex seat is
`docs/superpowers/specs/2026-09-05-model-seats-experiment.md`.

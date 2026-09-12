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
push that carried no TypeScript. `/land-branch` runs `pnpm install` right after `git pull --ff-only`;
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
is switched off here (2026-09-06): the second model on the diff is Codex (Sol) in
`/finish-branch`'s run-it seat, before the PR exists, so its findings are triaged with the others and leave no
thread. Copilot's lesson stands — its one reliable class was the sibling-file convention the branch
missed — so the convention reviewer's brief asks for siblings. A thread that does appear is resolved
via the GraphQL `resolveReviewThread` mutation with the id passed as a variable. Verify CI runs belong to the current head SHA
(`gh run list --json databaseId,headSha`).

**After merging, delete the feature branch, local and remote, and verify the remote one is gone**
(`git ls-remote --exit-code --heads origin <branch>` must fail) — it has repeatedly survived.

**An untracked file in the main checkout can block the post-merge `git pull --ff-only`.** Diff
before deleting; the scratch copy was 113 lines behind what landed.

**Before a PR**, run the §2 gate yourself rather than relying on the hook, then `/finish-branch`.
Both the hook and CI narrow to changed packages; the unfiltered `main` merge is the only run that
covers the rest.

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

The print agent's dev launcher treats the inherited `WAITRON_STATE_DIR` as the server's box state
and nests its own state under `print-agent/`, so worktree switches retain its token and target
resets clear it. Wait for the server listener before choosing HTTP or HTTPS: onboarding can mint
the leaf during boot. Read the local public CA for dev trust; the unprivileged landing listener
can fail to bind port 80 (`landing.listen_failed`, `EACCES`). Regressions:
`apps/print-agent/src/dev.test.ts`.

## Model selection

This paragraph is copied verbatim from the source `CLAUDE.md`. It summarises a rule that is defined
in full in the user's global `~/.claude/CLAUDE.md`, which every repo shares — this copy duplicates
that file rather than being its own source of truth.

**Model selection (owner decision 2026-09-06, revised the same evening for cost):** the rule lives in
the global `~/.claude/CLAUDE.md` so every repo shares it. In short: Claude and Codex are separated.
Opus 4.8 is the default and drives everything the owner reads (spec, plan, execution driver);
Fable 5.1 is opt-in for the brainstorm plus two short dispatched reads (a spec touching §5, fix
round five) and never drives execution — a hook denies it; dispatched seats run on Opus 5; Codex
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
Codex read `CLAUDE.md` when there is no `AGENTS.md` (measured 2026-09-06, with a control). What is
waitron-specific is the yardstick: each slice against the
previous five PRs on fix rounds before land, false claims found at whole-branch review, and Codex
tasks that needed a Claude fix round (the last is zero by construction from here on; the SP-3c and
SP-3d rows in `docs/backlog.md` hold the two data points taken under the earlier rules). The
seat-by-seat probe that informed this is `docs/superpowers/specs/2026-09-05-model-seats-experiment.md`.

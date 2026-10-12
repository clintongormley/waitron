# Campaign Account Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the campaign watcher decide which login each of the five campaign lanes uses, from a pool
of one login folder per account, so the lanes keep working while the owner is away (17 October to
2 November 2026).

**Architecture:** A small program, the picker (`~/workspace/tools/assign-accounts.py`), reads the pool,
every account's usage and the runners' pause files, and writes one line per lane to an assignment file.
Its rules live in a separate module with no input or output of its own (`account_pool.py`), so they can
be tested with made-up usage figures. Each lane's runner reads its line at the start of every firing and
falls back to its own `run.sh` folders when anything about the line is wrong. The watcher's change-watch
loop runs the picker every pass and acts on what it prints; `lane-status.py` shows the whole pool.

**Tech Stack:** Python 3 (standard library only; `~/.venv/bin/python3` is 3.14), bash, launchd, the
`workspace-tools` git repository (default branch `master`, no CI, no hooks).

**Spec:** `docs/superpowers/specs/2026-10-12-campaign-account-pool-design.md` (approved by the owner
2026-10-12). Read it before starting any task.

**Where the code lives.** None of it is in the waitron repository; only the spec and this plan are.

| What | Where | How it is changed |
| --- | --- | --- |
| The picker, its rules, `lane-status.py`, their tests and docs | `~/workspace/tools` (git, branch `account-pool`, worktree `~/workspace/tools/.worktrees/account-pool`) | Tasks 1–4, 4b and 6, one branch, one pull request |
| The runner library and its tests | `~/waitron-campaign-shared/runner-lib.sh`, `tests/runner.test.sh` (not in git) | Tasks 5 and 5b, each in a staging folder, installed by an atomic rename |
| The watcher's skill and memory | `~/.claude/skills/watch-campaigns/SKILL.md`, `~/.claude/projects/-Users-clintongormley-workspace-repos-waitron/memory/` (not in git) | Task 7 writes the new versions to a staging folder; Task 8 step 4 installs them |
| The pool file, each lane's `run.sh` defaults, the switch-over | `~/waitron-campaign-shared/accounts/`, `~/waitron-campaign*/run.sh` | Task 8, run by the controller, not an implementer |

**Execution notes for the controller.**

- Dispatch Tasks 1, 2, 3, 4, 4b, 5, 5b, 6 and 7 as `subagent_type: "implementer"`, one at a time, in
  that order. Each task names the folder it works in. Task 8 is yours, run with the owner's knowledge.
- **Task 7 changes nothing the live watcher reads.** It writes the edited skill and the new memory
  files to `~/waitron-account-pool-staging/watcher/`, and Task 8 step 4 installs them by rename once
  the pool exists. Two reasons. A live watcher reloads this skill whenever its safety-net cron invokes
  it (about every three hours), so an early edit would put the picker in its loop before the tools
  pull request has landed (every pass an error) or before the pool exists. And before the switch-over
  `~/waitron-campaign-shared/accounts/` does not exist, so the picker has nowhere to save what it has
  already said, and its `ACCOUNTS ERROR: no pool file` line would repeat every four minutes. So Task 7
  can run before the tools pull request lands, and the loop line reaches the watcher only at Task 8
  step 4, after the pool file (and with it `accounts/`) exists.
- **The picker stays in the watcher's change-watch loop, not in a launchd job of its own** (owner,
  2026-10-12, keeping the spec). A live watcher session keeps arming the loop text it already holds,
  so Task 8 step 4 tells it to stop its Monitor and arm the new loop text from the installed skill,
  and the skill itself (Task 7) says that a restarted session arms the loop from the skill's current
  text.
- Keep the ledger `docs/handoffs/2026-10-12-campaign-account-pool.md` in the waitron main checkout's
  `docs/handoffs/` (gitignored) current after every task.
- After Task 6, run `/finish-branch ~/workspace/tools/.worktrees/account-pool` on the tools branch.
  Memory `workspace-tools-no-ci-hooks-copilot` says what that repository lacks: run its gates by hand,
  rebase on `origin/master`, skip the CI and Copilot waits. None of the waitron risk triggers applies,
  so it takes the light review path; the Codex run-it seat still runs. Landing it needs the owner's
  approval (`/land-branch`), and Task 8 cannot start before it has landed.
- The runner library (Tasks 5 and 5b) is outside git, so its only review is the per-task review. Ask
  that reviewer to run the staged suite itself, not to read it.
- **Task 8 starts after 01:00 on 13 October** (Europe/Madrid). The gmail Claude account was at 100% of
  its week on 12 October and resets then, and Task 8 step 0 needs every pool folder able to answer.

## Global Constraints

Copied from the spec; every task's requirements include these.

- Pool file: `~/waitron-campaign-shared/accounts/pool`, one line per folder: engine (`claude` or
  `codex`), then the folder. The watcher's folder is not in it.
- Assignment file: `~/waitron-campaign-shared/accounts/assignments`, one line per lane: the lane letter,
  the driver's folder, the reviewer seat's folder. Only the picker writes it, through a temporary file
  and a rename.
- Pins: `~/waitron-campaign-shared/accounts/pins`. What the picker has announced:
  `~/waitron-campaign-shared/accounts/state.json`.
- A runner reads its line at the start of every firing, before the usage-limit check. A missing file, a
  missing line or a folder that does not exist keeps `run.sh`'s own folders and writes one line saying
  why to the run log.
- "Paused" is the runner's own marker under `~/waitron-campaign-shared/limits/`. Claude lanes run their
  account to 100%: a lane moves when a run is refused, not before.
- "Sign-in broken" is a second runner marker, `~/waitron-campaign-shared/limits/<account_name>.signin`
  (line 1: epoch when first noticed; line 2: the message), written when a firing fails with a sign-in
  error and removed by the next firing on that folder that exits 0, or by the picker once the folder's
  stored sign-in has changed (the owner signed it in again). The picker treats it as a pause with no
  end. Tasks 4b and 5b.
- One picker at a time: a run that writes takes a non-blocking `fcntl.flock` on
  `~/waitron-campaign-shared/accounts/.lock` and exits silently, status 0, when another run holds it
  (macOS has no `flock` program by default). A `--dry-run` takes no lock. Task 4b.
- Every program the picker or `lane-status.py` starts has a time limit: `security` 10 s, `launchctl`
  30 s (Python's `subprocess.run(..., timeout=...)`, which kills only the child it started). Task 4.
- Allowance left per day = (100 − weekly percent used) ÷ days until the weekly reset. A paused lane moves
  to the account with the most, among the lane's engine's pool accounts that are not paused and below
  100% in both windows; a tie goes to the account fewer lanes use.
- The Claude review seat of a Codex lane is always `~/.claude-waitron`. The watcher's account
  (info@waitron.io) is never handed to a lane.
- Usage is read at most every ten minutes per account, and at once when a new pause marker appears. If an
  endpoint refuses, the picker keeps the last answer and says so.
- Kick: `launchctl kickstart gui/<uid>/<label>`, only for a lane the picker moved because its account was
  paused, never for a lane that is running or has a `STOP` file. Labels: `com.waitron.campaign` (A),
  `com.waitron.campaign.b`, `.c`, `.d`, `.e` (read from `~/Library/LaunchAgents/com.waitron.campaign*.plist`).
- Output: nothing when nothing changed; otherwise one line per change, in these exact shapes:
  - `ACCOUNTS: lane A claude → ~/.claude-dev (was ~/.claude-support, paused until Fri 16 Oct 22:00)`
  - `ACCOUNTS: lane C stays paused — no Claude account has allowance left (next reset Sun 18 Oct 18:00)`
  - `CODEX 85%: dev@waitron.io at 86%, weekly reset Sun 18 Oct 06:00 — offer the owner a spare reset`
  - `SIGN-IN BROKEN: ~/.claude-dev (dev@waitron.io) — no lane is given it until it is signed in again: CLAUDE_CONFIG_DIR=~/.claude-dev claude, then /login (noticed Wed 14 Oct 09:50: Not logged in · Please run /login)`
    (for a Codex folder the command is `CODEX_HOME=~/.codex-dev codex login`)
  - `ACCOUNTS: ~/.claude-dev is signed in again — it can be handed out`
  The `CODEX 85%` line appears once per account per weekly window; the "stays paused" and
  `SIGN-IN BROKEN` lines once each.
- Shared scripts are edited atomically: write a temporary file beside the target, then `mv` it over.
  Live runners source `runner-lib.sh` at every firing.
- Plain English in everything written for the owner, commit messages included. Exact file and function
  names appear as pointers.
- Every commit is `git commit -s`. Stage explicit paths, never `git add -A`.
- The Bash tool's shell is zsh and its `grep` is a ugrep wrapper: where an exit status decides anything in
  a command you type, use `/usr/bin/grep`. Inside the `.sh` test files `grep` is the real one. There is no
  `timeout` on macOS; use `gtimeout`.

## Review Focus

The five inputs the spec implies but does not name that are most likely to bite, each with the test
that pins it:

1. **An idle Claude folder whose stored sign-in has expired.** Measured 2026-10-12 17:21: `~/.claude`'s
   stored access token had expired at 17:00:40 and Anthropic's usage endpoint answered
   `HTTP Error 401: Unauthorized` for it; the five pool folders' tokens, signed in that day, all expire
   between 00:40 and 00:52 on 2026-10-13. Only Claude itself renews the token, when it runs. So a spare
   account nobody is using becomes unreadable about eight hours after its last use. Expected: the picker
   does not ask the endpoint with an expired token, keeps the last answer it had (a window whose reset
   has passed counts as 0%), prints nothing for it, and can still hand the account to a paused lane.
   Tests: Task 1 `test_a_figure_read_before_its_window_reset_counts_as_zero`,
   `test_an_account_whose_usage_was_never_read_is_a_last_resort`; Task 4 "expired token" cases.
2. **A pool line for a second folder signed in to the watcher's account** (`~/.claude-info` is one, made
   2026-10-12). Expected: never handed out, even with the most allowance. Tests: Task 1
   `test_the_watchers_account_is_never_handed_out`; Task 3's first-run case.
3. **Two pool folders signed in to one account.** A pause marker belongs to a folder, so without care a
   lane refused on one would be moved to the other and refused again. Expected: a pause on one counts for
   both. Test: Task 1 `test_a_pause_on_one_folder_counts_for_another_folder_of_the_same_account`.
4. **A malformed assignment line**: two fields, `~/...` instead of an absolute path, a folder that does
   not exist. Expected: the runner keeps `run.sh`'s folders, says why in the run log, and alerts nobody.
   Tests: Task 5 cases.
5. **A Codex account that reports only a weekly window.** Measured 2026-10-12: both `~/.codex-dev` and
   `~/.codex-gmail` answered with a single `weekly` window and no five-hour one. Expected: the missing
   window does not stop the account qualifying. Tests: Task 1
   `test_a_codex_account_with_only_a_weekly_window_qualifies`; Task 3's fixtures are weekly-only.

## Decisions this plan makes where the spec is silent

A reviewer may overturn any of these; each is pinned by a named test so the change is visible.

- **A lane's letter comes from its campaign folder** (`~/waitron-campaign` is A, `~/waitron-campaign-x` is
  X), with `RUNNER_LANE` as the test override, so no `run.sh` has to change. The assignment is read inside
  `lane_settings_ok`, which every `run.sh` already calls at the start of every firing, before the pause
  check.
- **A runner also logs a line when the assignment applies**, not only when it falls back. Task 8 needs it
  to see which folder a firing used.
- **A Claude lane's Codex review seat stays where it is while its account qualifies**: not paused, its
  sign-in not broken, and below 100% in both windows. Re-choosing the best account on every four-minute
  pass would move seats back and forth as the two Codex accounts' figures cross, printing a line each
  time. The 100% condition is needed because a Codex account gets a pause marker only from a Codex lane
  it drives: with lanes D and E stopped, nothing would ever pause a used-up seat. Tests: Task 2
  `test_a_codex_seat_stays_until_its_account_pauses` and
  `test_a_codex_seat_at_100_percent_moves_even_with_no_pause`.
- **Lanes that move in the same pass all go to the single best account.** The spec's tie rule ("a tie
  goes to the account fewer lanes use") is kept and pinned by `test_a_tie_goes_to_the_account_fewer_lanes_use`,
  but allowance left per day is computed from live percentages and reset times, so two accounts never
  tie exactly in practice and the tie rule does not spread lanes that move together. That is what the
  spec's wording implies: each paused lane goes to "the account with the most allowance left per day".
  Spreading applies only to lanes given their first account (rule 4).
- **The picker stays in the watcher's change-watch loop** (owner, 2026-10-12: keep as specified), not
  in a launchd job of its own. See the execution notes for what that means for a live watcher session.
- **A broken sign-in is caught by the runner and handled by the picker.** A sign-in expires about
  eight hours after its last use and its refresh token lasts until about 8–11 November; a revoked one
  (memory `chatgpt-security-change-revokes-codex-lanes`) fails every firing. Without a marker that
  failure is silent: the lane stays on the folder and fails every 30 minutes for two weeks. The runner
  marks the folder (Task 5b), the picker moves the lane off it like a pause with no end, never hands
  the folder out, says one `SIGN-IN BROKEN` line naming the re-login command, and clears the marker
  itself once the folder's stored sign-in changes (Task 4b). The watcher turns that line into one
  phone message (Task 7). The runner never writes the usage-limit marker for a sign-in failure.
- **The shapes a sign-in failure prints** were measured, not guessed, where possible:
  - Claude: `Not logged in · Please run /login`, exit 1. Measured 2026-10-12 18:16 by running
    `claude -p "say hi"` with `CLAUDE_CONFIG_DIR` set to an empty folder. No Claude sign-in failure
    survives in the Claude lanes' run logs (pruned to the last few days; searched for `401`, `login`,
    `OAuth`, `Invalid API key`, `authentication`, `Unauthorized`, `expired`, `credential`). The other
    Claude shapes matched (`Invalid API key`, `API Error: 401`, `OAuth token has expired`) are
    inferred, not measured.
  - Codex, revoked: lane D's `logs/run-20261012-124050.log` (the owner's ChatGPT security change)
    has stderr lines `... ERROR codex_models_manager::manager: ... auth error code: token_revoked`
    and `... ERROR codex_login::auth::manager: Failed to refresh token status=401 ... refresh_token_invalidated
    ... Please log in again.`, and ends `{"type":"turn.failed","error":{"message":"workspace routing discovery unauthorized (401)"}}`, exit 1.
  - Codex, never signed in: `codex exec` with `CODEX_HOME` set to an empty folder, measured 2026-10-12
    18:17, ends `{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, ..."}}`, exit 1.
  A Codex run log is an event stream that also carries tool output, which in this repository often
  mentions 401; tool output sits inside an `item.*` event's escaped string, so only a line that
  STARTS `{"type":"turn.failed"` or with a timestamp and ` ERROR ` is read. Measured 2026-10-12 with
  Task 5b's Codex pattern over lanes D's and E's run logs since 5 October: 247 of them contain `401`
  somewhere; the pattern matched two, `run-20261012-124050.log` (the revoked firing, exit 1) and
  `run-20261012-120546.log`, the firing that was running when the revocation happened, which logged
  the `token_revoked` lines but exited 0. That is why the runner reads the log only when the firing
  failed: a firing that exits 0 marks nothing and clears any marker.
- **An account whose usage has never been read qualifies only after every account whose usage is
  known**, and only when its folder is signed in. A folder with no sign-in at all never qualifies.
- **A lane with a `STOP` file keeps its line untouched** and is not counted when spreading lanes.
- **Spreading on first run puts "fewer lanes" before "more allowance per day".** With the figures read
  on 2026-10-12 that sends one Claude lane to clint@ at 99% of its week; its first refusal moves it at
  once. A pin written at cutover avoids that if the owner prefers.
- **Every line the picker prints is also appended, with the time, to
  `~/waitron-campaign-shared/accounts/log`.** The spec says the watcher logs `ACCOUNTS` lines in its own
  notes; a file the picker writes itself costs no AI time and is what Task 8 reads to tell a kicked
  firing from a scheduled one.
- **The spare Codex resets are read from memory `owner-accounts-and-weekly-resets`**, which already
  lists them (gmail one expiring 7 Nov; dev two, expiring 29 Oct and 7 Nov). The watcher updates that
  memory when the owner applies one.
- **A lane with no line and no account to give it gets no line** (its runner keeps `run.sh`'s folders)
  and a "stays paused" line.

---

## Task 1: The rules for drivers, as pure functions

**Work in:** a new worktree of `~/workspace/tools`:

```bash
git -C ~/workspace/tools fetch origin
git -C ~/workspace/tools worktree add ~/workspace/tools/.worktrees/account-pool -b account-pool origin/master
```

(`.worktrees/` is gitignored there. Do not touch `codex-workflow/AGENTS.md`, which has the owner's
uncommitted change in the main checkout.)

**Files:**
- Create: `~/workspace/tools/.worktrees/account-pool/account_pool.py`
- Create: `~/workspace/tools/.worktrees/account-pool/test_account_pool.py`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks import these by name):
  - `Account(folder, engine, email=None, logged_in=True, known=True, five_hour=None, five_hour_reset=None, weekly=None, weekly_reset=None, paused_until=None)` — frozen dataclass; percentages are `int`, times are timezone-aware `datetime`.
  - `Lane(name, engine, stopped=False)`; `Move(lane, role, engine, old, new, reason, paused_until=None)` with `role` `"driver"`/`"reviewer"` and `reason` one of `"new"`, `"paused"`, `"pinned"`, `"not in the pool"`, `"watcher"` (Task 2 adds `"full"`, Task 4b `"sign-in broken"`); `Stuck(lane, engine, next_reset)`.
  - `effective_usage(account, now) -> (five_hour_pct, weekly_pct, days_to_weekly_reset)`
  - `per_day(account, now) -> float`
  - `pause_end(account, accounts, now) -> datetime | None`
  - `handed_out(account, watcher_folder, watcher_email) -> bool`
  - `qualifies(account, accounts, now, watcher_folder, watcher_email) -> bool`
  - `next_reset(engine, accounts, now, watcher_folder, watcher_email) -> datetime | None`
  - `decide_drivers(lanes, accounts, current, pins, watcher_folder, watcher_email, now) -> (drivers: dict[str, str], moves: list[Move], stuck: list[Stuck])` where `current` maps a lane letter to `(driver, reviewer)` and `pins` maps a lane letter to a folder.

- [ ] **Step 1: Write the failing tests**

`test_account_pool.py`:

```python
"""Tests for account_pool.py, the picker's rules. Run: python3 -m unittest test_account_pool -v"""
import datetime as dt
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import account_pool as ap  # noqa: E402

os.environ["TZ"] = "Europe/Madrid"  # the printed times are local time
time.tzset()

TZ = dt.timezone(dt.timedelta(hours=2))  # Madrid in October
NOW = dt.datetime(2026, 10, 14, 10, 0, tzinfo=TZ)  # a Wednesday
H = "/home/o"
W = H + "/.claude-waitron"
WE = "info@waitron.io"


def at(day, hour, minute=0):
    return dt.datetime(2026, 10, day, hour, minute, tzinfo=TZ)


def claude(name, weekly=20, reset=None, five=0, five_reset=None, email=None, **kw):
    return ap.Account(
        folder="%s/.claude-%s" % (H, name), engine="claude", email=email or "%s@waitron.io" % name,
        five_hour=five, five_hour_reset=five_reset or at(14, 15), weekly=weekly,
        weekly_reset=reset or at(18, 18), **kw)


def codex(name, weekly=20, reset=None, **kw):
    return ap.Account(folder="%s/.codex-%s" % (H, name), engine="codex", email="%s@codex" % name,
                      weekly=weekly, weekly_reset=reset or at(18, 6), **kw)


def f(name):
    return "%s/.claude-%s" % (H, name)


def lanes(*specs):
    return [ap.Lane(*s) if isinstance(s, tuple) else ap.Lane(s, "claude") for s in specs]


def drivers(lanes_, accounts, current=None, pins=None):
    return ap.decide_drivers(lanes_, accounts, current or {}, pins or {}, W, WE, NOW)


class Usage(unittest.TestCase):
    def test_allowance_per_day_divides_what_is_left_by_the_days_to_the_weekly_reset(self):
        self.assertAlmostEqual(ap.per_day(claude("x", weekly=10, reset=at(20, 10)), NOW), 15.0)

    def test_a_figure_read_before_its_window_reset_counts_as_zero(self):
        a = claude("x", five=100, five_reset=at(14, 9), weekly=100, reset=at(13, 22))
        self.assertEqual(ap.effective_usage(a, NOW), (0, 0, 7.0))

    def test_a_reset_a_minute_away_does_not_divide_by_zero(self):
        a = claude("x", weekly=50, reset=at(14, 10, 1))
        self.assertAlmostEqual(ap.per_day(a, NOW), 50 * 24)

    def test_a_missing_window_counts_as_zero(self):
        a = ap.Account(H + "/.codex-x", "codex", weekly=None, weekly_reset=None)
        self.assertEqual(ap.effective_usage(a, NOW), (0, 0, 7.0))

    def test_an_account_at_100_percent_in_either_window_does_not_qualify(self):
        accounts = [claude("five", five=100), claude("week", weekly=100), claude("ok", weekly=99)]
        self.assertEqual([ap.qualifies(a, accounts, NOW, W, WE) for a in accounts], [False, False, True])


class Drivers(unittest.TestCase):
    def test_a_lane_on_an_unpaused_account_stays(self):
        accounts = [claude("support", weekly=90), claude("dev", weekly=0)]
        d, moves, stuck = drivers(lanes("A"), accounts, {"A": (f("support"), None)})
        self.assertEqual((d, moves, stuck), ({"A": f("support")}, [], []))

    def test_a_paused_lane_moves_to_the_account_with_most_allowance_left_per_day(self):
        # dev has more left in all (90 against 60) but clint's resets tomorrow: 60 a day against 15.
        accounts = [claude("support", paused_until=at(16, 22)), claude("dev", weekly=10, reset=at(20, 10)),
                    claude("clint", weekly=40, reset=at(15, 10))]
        d, moves, _ = drivers(lanes("A"), accounts, {"A": (f("support"), None)})
        self.assertEqual(d, {"A": f("clint")})
        self.assertEqual(moves, [ap.Move("A", "driver", "claude", f("support"), f("clint"), "paused", at(16, 22))])

    def test_a_tie_goes_to_the_account_fewer_lanes_use(self):
        accounts = [claude("support", paused_until=at(16, 22)), claude("dev"), claude("clint")]
        d, _, _ = drivers(lanes("A", "B"), accounts, {"A": (f("support"), None), "B": (f("dev"), None)})
        self.assertEqual(d["A"], f("clint"))
        d, _, _ = drivers(lanes("A", "B"), accounts, {"A": (f("support"), None), "B": (f("clint"), None)})
        self.assertEqual(d["A"], f("dev"))

    def test_with_no_account_to_move_to_the_lane_stays_where_it_is_and_is_reported_once(self):
        accounts = [claude("support", paused_until=at(16, 22)), claude("dev", weekly=100),
                    claude("clint", five=100, five_reset=at(14, 15))]
        d, moves, stuck = drivers(lanes("A"), accounts, {"A": (f("support"), None)})
        self.assertEqual((d, moves), ({"A": f("support")}, []))
        self.assertEqual(stuck, [ap.Stuck("A", "claude", at(14, 15))])

    def test_a_pin_holds_until_its_account_pauses(self):
        accounts = [claude("support"), claude("dev", weekly=0), claude("clint", weekly=90)]
        d, moves, _ = drivers(lanes("A"), accounts, {"A": (f("support"), None)}, {"A": f("clint")})
        self.assertEqual(d["A"], f("clint"))
        self.assertEqual(moves[0].reason, "pinned")
        paused = [claude("support"), claude("dev", weekly=0), claude("clint", weekly=90, paused_until=at(16, 12))]
        d, moves, _ = drivers(lanes("A"), paused, {"A": (f("clint"), None)}, {"A": f("clint")})
        self.assertEqual((d["A"], moves[0].reason), (f("dev"), "paused"))
        d, moves, _ = drivers(lanes("A"), paused, {"A": (f("support"), None)}, {"A": f("clint")})
        self.assertEqual((d["A"], moves), (f("support"), []))

    def test_a_pin_on_a_folder_outside_the_pool_or_of_the_other_engine_is_ignored(self):
        accounts = [claude("support"), codex("dev")]
        for pin in (f("elsewhere"), H + "/.codex-dev"):
            d, moves, _ = drivers(lanes("A"), accounts, {"A": (f("support"), None)}, {"A": pin})
            self.assertEqual((d["A"], moves), (f("support"), []))

    def test_the_watchers_account_is_never_handed_out(self):
        accounts = [claude("support", paused_until=at(16, 22)), claude("waitron", weekly=0, email=WE),
                    claude("info", weekly=0, email=WE), claude("dev", weekly=50)]
        d, _, _ = drivers(lanes("A", "B"), accounts, {"A": (f("support"), None)})
        self.assertEqual(d, {"A": f("dev"), "B": f("dev")})

    def test_a_pause_on_one_folder_counts_for_another_folder_of_the_same_account(self):
        accounts = [claude("support", paused_until=at(16, 22)),
                    claude("lane-a", weekly=0, email="support@waitron.io"), claude("dev", weekly=50)]
        d, _, _ = drivers(lanes("A"), accounts, {"A": (f("support"), None)})
        self.assertEqual(d["A"], f("dev"))

    def test_on_first_run_lanes_are_spread_across_accounts(self):
        accounts = [claude("support", weekly=60, reset=at(16, 22)), claude("dev", weekly=22),
                    claude("clint", weekly=99, reset=at(16, 12))]
        d, moves, _ = drivers(lanes("A", "B", "C"), accounts)
        self.assertEqual(d, {"A": f("dev"), "B": f("support"), "C": f("clint")})
        self.assertEqual([m.reason for m in moves], ["new", "new", "new"])

    def test_an_account_whose_usage_was_never_read_is_a_last_resort(self):
        accounts = [claude("support", paused_until=at(16, 22)), ap.Account(f("x"), "claude", known=False),
                    claude("dev", weekly=95)]
        d, _, _ = drivers(lanes("A"), accounts, {"A": (f("support"), None)})
        self.assertEqual(d["A"], f("dev"))
        accounts[2] = claude("dev", weekly=95, paused_until=at(18, 18))
        d, _, _ = drivers(lanes("A"), accounts, {"A": (f("support"), None)})
        self.assertEqual(d["A"], f("x"))

    def test_a_folder_that_is_not_signed_in_never_qualifies(self):
        accounts = [claude("support", paused_until=at(16, 22)),
                    ap.Account(f("x"), "claude", logged_in=False, known=False)]
        d, _, stuck = drivers(lanes("A"), accounts, {"A": (f("support"), None)})
        self.assertEqual((d["A"], [s.lane for s in stuck]), (f("support"), ["A"]))

    def test_a_driver_outside_the_pool_moves(self):
        d, moves, _ = drivers(lanes("A"), [claude("dev")], {"A": (f("lane-a"), None)})
        self.assertEqual((d["A"], moves[0].reason, moves[0].old), (f("dev"), "not in the pool", f("lane-a")))

    def test_a_stopped_lane_keeps_its_line_and_is_not_counted_when_spreading(self):
        accounts = [claude("dev"), claude("clint"), claude("support", paused_until=at(16, 22))]
        current = {"A": (f("support"), None)}
        d, moves, _ = drivers([ap.Lane("A", "claude", stopped=True), ap.Lane("B", "claude")], accounts, current)
        self.assertEqual(d["A"], f("support"))
        self.assertEqual([m.lane for m in moves], ["B"])
        current = {"A": (f("dev"), None)}
        d, _, _ = drivers([ap.Lane("A", "claude", stopped=True), ap.Lane("B", "claude")], accounts, current)
        self.assertEqual(d["B"], f("dev"))

    def test_a_codex_account_with_only_a_weekly_window_qualifies(self):
        d, _, _ = drivers(lanes(("D", "codex")), [codex("dev", weekly=20)])
        self.assertEqual(d, {"D": H + "/.codex-dev"})

    def test_a_lane_is_never_given_the_other_engines_account(self):
        d, moves, stuck = drivers(lanes("A"), [codex("dev")])
        self.assertEqual((d, moves, [s.lane for s in stuck]), ({}, [], ["A"]))

    def test_the_next_reset_is_when_the_first_account_could_be_handed_out_again(self):
        accounts = [claude("support", paused_until=at(16, 22)), claude("dev", weekly=100, reset=at(18, 18)),
                    claude("both", five=100, five_reset=at(14, 15), weekly=100, reset=at(19, 7)),
                    claude("waitron", weekly=100, reset=at(14, 11), email=WE)]
        self.assertEqual(ap.next_reset("claude", accounts, NOW, W, WE), at(16, 22))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `cd ~/workspace/tools/.worktrees/account-pool && python3 -m unittest test_account_pool -v`
Expected: an error, `ModuleNotFoundError: No module named 'account_pool'`.

- [ ] **Step 3: Write the minimal implementation**

`account_pool.py`:

```python
"""The rules that decide which login folder each campaign lane uses.

Pure functions for assign-accounts.py and lane-status.py: nothing here reads the network, the Keychain,
a file or the clock. Spec: docs/superpowers/specs/2026-10-12-campaign-account-pool-design.md in the
waitron repository.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

DAY = dt.timedelta(days=1)
MIN_DAYS = 1 / 24  # keeps the division finite in the last hour before a reset
NEW_WEEK_DAYS = 7.0


@dataclass(frozen=True)
class Account:
    folder: str
    engine: str
    email: str | None = None
    logged_in: bool = True
    known: bool = True
    five_hour: int | None = None
    five_hour_reset: dt.datetime | None = None
    weekly: int | None = None
    weekly_reset: dt.datetime | None = None
    paused_until: dt.datetime | None = None


@dataclass(frozen=True)
class Lane:
    name: str
    engine: str
    stopped: bool = False


@dataclass(frozen=True)
class Move:
    lane: str
    role: str
    engine: str
    old: str | None
    new: str
    reason: str
    paused_until: dt.datetime | None = None


@dataclass(frozen=True)
class Stuck:
    lane: str
    engine: str
    next_reset: dt.datetime | None


def effective_usage(a, now):
    """(five-hour %, weekly %, days to the weekly reset) as they stand at `now`.

    A figure read before its window reset counts as 0%, so an idle account's last answer stays usable.
    """
    five = a.five_hour or 0
    if a.five_hour_reset is not None and a.five_hour_reset <= now:
        five = 0
    weekly = a.weekly or 0
    if a.weekly_reset is None or a.weekly_reset <= now:
        if a.weekly_reset is not None:
            weekly = 0
        return five, weekly, NEW_WEEK_DAYS
    return five, weekly, max((a.weekly_reset - now) / DAY, MIN_DAYS)


def per_day(a, now):
    if not a.known:
        return 0.0
    _, weekly, days = effective_usage(a, now)
    return (100 - weekly) / days


def pause_end(a, accounts, now):
    """When this account's pause ends, or None. A pause on another pool folder signed in to the same
    account counts, because a pause marker belongs to a folder."""
    ends = [b.paused_until for b in accounts
            if b.paused_until is not None and b.paused_until > now
            and (b.folder == a.folder or (a.email and b.engine == a.engine and b.email == a.email))]
    return max(ends) if ends else None


def handed_out(a, watcher_folder, watcher_email):
    return a.folder != watcher_folder and not (watcher_email and a.engine == "claude" and a.email == watcher_email)


def qualifies(a, accounts, now, watcher_folder, watcher_email):
    if not a.logged_in or not handed_out(a, watcher_folder, watcher_email) or pause_end(a, accounts, now):
        return False
    if not a.known:
        return True
    five, weekly, _ = effective_usage(a, now)
    return five < 100 and weekly < 100


def next_reset(engine, accounts, now, watcher_folder, watcher_email):
    """The earliest time an account of this engine could be handed out again, or None."""
    times = []
    for a in accounts:
        if a.engine != engine or not a.logged_in or not handed_out(a, watcher_folder, watcher_email):
            continue
        five, weekly, _ = effective_usage(a, now)
        waits = [t for t in (pause_end(a, accounts, now),
                             a.five_hour_reset if five >= 100 else None,
                             a.weekly_reset if weekly >= 100 else None) if t is not None]
        if waits:
            times.append(max(waits))
    return min(times) if times else None


def decide_drivers(lanes, accounts, current, pins, watcher_folder, watcher_email, now):
    """The spec's rules 1–4 for each lane's driver: (drivers, moves, stuck)."""
    by_folder = {a.folder: a for a in accounts}

    def usable(folder, engine):
        a = by_folder.get(folder)
        return a is not None and a.engine == engine and a.logged_in and handed_out(a, watcher_folder, watcher_email)

    def choices(engine):
        return [a for a in accounts if a.engine == engine and qualifies(a, accounts, now, watcher_folder, watcher_email)]

    drivers, moves, stuck, moving, new = {}, [], [], [], []
    for lane in sorted(lanes, key=lambda l: l.name):
        old = current.get(lane.name, (None, None))[0]
        pin = pins.get(lane.name)
        if lane.stopped and old:
            drivers[lane.name] = old
        elif pin and usable(pin, lane.engine) and not pause_end(by_folder[pin], accounts, now):
            drivers[lane.name] = pin
            if pin != old:
                moves.append(Move(lane.name, "driver", lane.engine, old, pin, "pinned" if old else "new"))
        elif old is None:
            new.append(lane)
        elif not usable(old, lane.engine):
            moving.append((lane, old, "not in the pool", None))
        elif (end := pause_end(by_folder[old], accounts, now)) is not None:
            moving.append((lane, old, "paused", end))
        else:
            drivers[lane.name] = old

    active = {l.name for l in lanes if not l.stopped}

    def load(folder):
        return sum(1 for name, f in drivers.items() if f == folder and name in active)

    def stuck_at(lane):
        return Stuck(lane.name, lane.engine, next_reset(lane.engine, accounts, now, watcher_folder, watcher_email))

    for lane, old, reason, end in moving:
        pool = choices(lane.engine)
        if not pool:
            drivers[lane.name] = old
            stuck.append(stuck_at(lane))
            continue
        best = max(pool, key=lambda a: (a.known, per_day(a, now), -load(a.folder)))
        drivers[lane.name] = best.folder
        moves.append(Move(lane.name, "driver", lane.engine, old, best.folder, reason, end))
    for lane in new:
        pool = choices(lane.engine)
        if not pool:
            stuck.append(stuck_at(lane))
            continue
        best = min(pool, key=lambda a: (load(a.folder), not a.known, -per_day(a, now)))
        drivers[lane.name] = best.folder
        moves.append(Move(lane.name, "driver", lane.engine, None, best.folder, "new"))
    return drivers, moves, stuck
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `cd ~/workspace/tools/.worktrees/account-pool && python3 -m unittest test_account_pool -v`
Expected: every test `ok`, the last line `OK`. Read the count: 21 tests.

- [ ] **Step 5: Prove two tests by deletion**

Delete the email clause from `handed_out` (keep only `a.folder != watcher_folder`), run the tests, and
confirm `test_the_watchers_account_is_never_handed_out` fails because lane A got `~/.claude-info`. Then
in `pause_end` drop the same-account clause, keeping only `b.folder == a.folder`, and confirm
`test_a_pause_on_one_folder_counts_for_another_folder_of_the_same_account` fails. Restore both and rerun
to green.

- [ ] **Step 6: Commit**

```bash
cd ~/workspace/tools/.worktrees/account-pool
git add account_pool.py test_account_pool.py
git commit -s -m "account pool: the rules that choose each campaign lane's login

A new module holds the picker's rules with no input or output of its own: a lane stays on its
account until that account is paused, then moves to the account with the most allowance left
per day until its weekly reset; a pin holds until its account pauses; lanes with no account yet
are spread across accounts; the watcher's account is never handed out."
```

**Done when:** `python3 -m unittest test_account_pool -v` prints 21 tests and `OK`, both deletion
checks failed for the stated reason before being restored, and the commit exists on `account-pool`.

---

## Task 2: Reviewer seats, the printed lines and the Codex 85% check

**Work in:** `~/workspace/tools/.worktrees/account-pool`.

**Files:**
- Modify: `account_pool.py` (append)
- Modify: `test_account_pool.py` (append test classes)

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces:
  - `Decision(assignments: dict[str, tuple[str, str]], moves: list[Move], stuck: list[Stuck])`
  - `decide(lanes, accounts, current, pins, watcher_folder, watcher_email, now) -> Decision`
  - `when(at) -> str` (`"Fri 16 Oct 22:00"`, in the machine's local time zone, so a time after a clock change reads right)
  - `tilde(path, home) -> str`
  - `format_move(move, now, home) -> str`, `format_stuck(stuck, now) -> str`
  - `codex_alerts(accounts, announced: dict[str, str], now) -> (lines: list[str], announced: dict[str, str])`
  - `launchd_label(lane) -> str`
  - `full_until(account, now) -> datetime | None` (when an account at 100% in a window can be used again)
  - `Move.reason` `"full"`: a Codex seat moved off an account at 100% that no pause marker names.

- [ ] **Step 1: Write the failing tests** (append to `test_account_pool.py`, above the `if __name__` line)

```python
def decide(lanes_, accounts, current=None, pins=None):
    return ap.decide(lanes_, accounts, current or {}, pins or {}, W, WE, NOW)


CX = lambda name: H + "/.codex-" + name  # noqa: E731


class Reviewers(unittest.TestCase):
    def test_a_codex_lanes_reviewer_is_always_the_watchers_folder(self):
        result = decide(lanes(("D", "codex")), [codex("dev")])
        self.assertEqual(result.assignments, {"D": (CX("dev"), W)})
        result = decide(lanes(("D", "codex")), [codex("dev")], {"D": (CX("dev"), f("lane-a"))})
        self.assertEqual([(m.role, m.old, m.new, m.reason) for m in result.moves],
                         [("reviewer", f("lane-a"), W, "watcher")])

    def test_a_claude_lanes_first_seat_is_the_codex_account_with_most_allowance_per_day(self):
        result = decide(lanes("A"), [claude("dev"), codex("dev", weekly=20, reset=at(18, 6)),
                                     codex("gmail", weekly=27, reset=at(18, 9, 27))])
        self.assertEqual(result.assignments["A"], (f("dev"), CX("dev")))

    def test_a_codex_seat_stays_until_its_account_pauses(self):
        accounts = [claude("dev"), codex("dev", weekly=0), codex("gmail", weekly=80)]
        result = decide(lanes("A"), accounts, {"A": (f("dev"), CX("gmail"))})
        self.assertEqual((result.assignments["A"][1], result.moves), (CX("gmail"), []))

    def test_a_codex_seat_at_100_percent_moves_even_with_no_pause(self):
        # With lanes D and E stopped no Codex lane drives either account, so no pause marker is written.
        accounts = [claude("dev"), codex("dev", weekly=20), codex("gmail", weekly=100, reset=at(18, 9, 27))]
        current = {"A": (f("dev"), CX("gmail")), "D": (CX("gmail"), W), "E": (CX("dev"), W)}
        result = decide([ap.Lane("A", "claude"), ap.Lane("D", "codex", stopped=True),
                         ap.Lane("E", "codex", stopped=True)], accounts, current)
        self.assertEqual(result.moves, [ap.Move("A", "reviewer", "codex", CX("gmail"), CX("dev"), "full", at(18, 9, 27))])

    def test_a_paused_codex_seat_moves(self):
        accounts = [claude("dev"), codex("dev"), codex("gmail", paused_until=at(15, 9))]
        result = decide(lanes("A"), accounts, {"A": (f("dev"), CX("gmail"))})
        self.assertEqual(result.moves, [ap.Move("A", "reviewer", "codex", CX("gmail"), CX("dev"), "paused", at(15, 9))])

    def test_with_every_codex_account_paused_a_seat_keeps_its_last_account(self):
        accounts = [claude("dev"), codex("dev", paused_until=at(15, 9)), codex("gmail", paused_until=at(16, 9))]
        result = decide(lanes("A"), accounts, {"A": (f("dev"), CX("gmail"))})
        self.assertEqual((result.assignments["A"][1], result.moves), (CX("gmail"), []))

    def test_with_every_codex_account_paused_and_no_earlier_seat_it_takes_the_first_to_resume(self):
        accounts = [claude("dev"), codex("dev", paused_until=at(16, 9)), codex("gmail", paused_until=at(15, 9))]
        self.assertEqual(decide(lanes("A"), accounts).assignments["A"][1], CX("gmail"))

    def test_a_lane_with_no_driver_gets_no_line(self):
        result = decide(lanes("A"), [codex("dev")])
        self.assertEqual((result.assignments, [s.lane for s in result.stuck]), ({}, ["A"]))


class Lines(unittest.TestCase):
    def test_a_move_off_a_paused_account_reads_as_the_spec_says(self):
        m = ap.Move("A", "driver", "claude", H + "/.claude-support", H + "/.claude-dev", "paused", at(16, 22))
        self.assertEqual(ap.format_move(m, NOW, H),
                         "ACCOUNTS: lane A claude → ~/.claude-dev (was ~/.claude-support, paused until Fri 16 Oct 22:00)")

    def test_the_other_moves(self):
        self.assertEqual(ap.format_move(ap.Move("A", "driver", "claude", None, f("dev"), "new"), NOW, H),
                         "ACCOUNTS: lane A claude → ~/.claude-dev (new)")
        self.assertEqual(ap.format_move(ap.Move("A", "driver", "claude", f("x"), f("dev"), "pinned"), NOW, H),
                         "ACCOUNTS: lane A claude → ~/.claude-dev (was ~/.claude-x, pinned)")
        self.assertEqual(ap.format_move(ap.Move("A", "driver", "claude", f("lane-a"), f("dev"), "not in the pool"), NOW, H),
                         "ACCOUNTS: lane A claude → ~/.claude-dev (was ~/.claude-lane-a, not in the pool)")
        self.assertEqual(ap.format_move(ap.Move("A", "reviewer", "codex", CX("gmail"), CX("dev"), "paused", at(15, 9)), NOW, H),
                         "ACCOUNTS: lane A codex reviewer → ~/.codex-dev (was ~/.codex-gmail, paused until Thu 15 Oct 09:00)")
        self.assertEqual(ap.format_move(ap.Move("D", "reviewer", "claude", f("lane-a"), W, "watcher"), NOW, H),
                         "ACCOUNTS: lane D claude reviewer → ~/.claude-waitron (was ~/.claude-lane-a, Codex lanes are reviewed from the watcher's account)")
        self.assertEqual(ap.format_move(ap.Move("A", "reviewer", "codex", CX("gmail"), CX("dev"), "full", at(18, 9, 27)), NOW, H),
                         "ACCOUNTS: lane A codex reviewer → ~/.codex-dev (was ~/.codex-gmail, at 100% until Sun 18 Oct 09:27)")

    def test_a_stuck_lane_reads_as_the_spec_says(self):
        self.assertEqual(ap.format_stuck(ap.Stuck("C", "claude", at(18, 18)), NOW),
                         "ACCOUNTS: lane C stays paused — no Claude account has allowance left (next reset Sun 18 Oct 18:00)")
        self.assertEqual(ap.format_stuck(ap.Stuck("D", "codex", None), NOW),
                         "ACCOUNTS: lane D stays paused — no Codex account has allowance left (next reset not known)")

    def test_a_time_after_the_clock_change_reads_in_local_time(self):
        after = dt.datetime(2026, 10, 25, 6, 0, tzinfo=dt.timezone(dt.timedelta(hours=1)))
        self.assertEqual(ap.when(after), "Sun 25 Oct 06:00")

    def test_launchd_labels(self):
        self.assertEqual([ap.launchd_label(l) for l in "ABE"],
                         ["com.waitron.campaign", "com.waitron.campaign.b", "com.waitron.campaign.e"])


class CodexAlert(unittest.TestCase):
    def dev(self, weekly, reset=None):
        return ap.Account(CX("dev"), "codex", email="dev@waitron.io", weekly=weekly, weekly_reset=reset or at(18, 6))

    def test_at_85_percent_the_owner_is_offered_a_reset_once_per_weekly_window(self):
        lines, seen = ap.codex_alerts([self.dev(86)], {}, NOW)
        self.assertEqual(lines, ["CODEX 85%: dev@waitron.io at 86%, weekly reset Sun 18 Oct 06:00 — offer the owner a spare reset"])
        self.assertEqual(ap.codex_alerts([self.dev(90)], seen, NOW)[0], [])
        later = at(18, 6) + dt.timedelta(seconds=40)
        self.assertEqual(ap.codex_alerts([self.dev(90, later)], seen, NOW)[0], [])
        next_week = at(25, 6)
        self.assertEqual(len(ap.codex_alerts([self.dev(86, next_week)], seen, NOW)[0]), 1)

    def test_below_85_percent_or_on_claude_nothing_is_said(self):
        self.assertEqual(ap.codex_alerts([self.dev(84), claude("dev", weekly=99)], {}, NOW), ([], {}))
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `cd ~/workspace/tools/.worktrees/account-pool && python3 -m unittest test_account_pool -v`
Expected: the new tests error with `AttributeError: module 'account_pool' has no attribute 'decide'`
(and `format_move`, `format_stuck`, `when`, `launchd_label`, `codex_alerts`); Task 1's 21 tests still pass.
(`full_until` is not called by a test directly; the 100% seat test reaches it through `decide`.)

- [ ] **Step 3: Write the minimal implementation** (append to `account_pool.py`)

```python
CODEX_ALERT_PERCENT = 85
ENGINE_NAMES = {"claude": "Claude", "codex": "Codex"}


@dataclass
class Decision:
    assignments: dict
    moves: list
    stuck: list


def full_until(a, now):
    """When an account at 100% in a window can be used again (the latest such window's reset), or None."""
    five, weekly, _ = effective_usage(a, now)
    times = [t for t, pct in ((a.five_hour_reset, five), (a.weekly_reset, weekly)) if pct >= 100 and t is not None]
    return max(times) if times else None


def decide(lanes, accounts, current, pins, watcher_folder, watcher_email, now):
    """Drivers by rules 1–4, then reviewer seats by rules 5 and 6."""
    drivers, moves, stuck = decide_drivers(lanes, accounts, current, pins, watcher_folder, watcher_email, now)
    by_folder = {a.folder: a for a in accounts}
    codex = [a for a in accounts if a.engine == "codex" and a.logged_in]
    reviewers = {}

    def seat_load(folder):
        return sum(1 for f in list(drivers.values()) + list(reviewers.values()) if f == folder)

    for lane in sorted(lanes, key=lambda l: l.name):
        if lane.name not in drivers:
            continue
        old = current.get(lane.name, (None, None))[1]
        reason, end = None, None
        if lane.engine == "codex":
            new, reason = watcher_folder, "watcher"
        elif lane.stopped and old:
            new = old
        else:
            seat = by_folder.get(old)
            end = pause_end(seat, accounts, now) if seat else None
            # A seat stays while its account qualifies: not paused AND below 100% in both windows. A
            # Codex account is paused only by a Codex lane it drives, so 100% has to be checked here.
            if seat is not None and seat.engine == "codex" and qualifies(seat, accounts, now, watcher_folder, watcher_email):
                new = old
            else:
                pool = [a for a in codex if qualifies(a, accounts, now, watcher_folder, watcher_email)]
                if pool:
                    new = max(pool, key=lambda a: (a.known, per_day(a, now), -seat_load(a.folder))).folder
                elif old:
                    new = old  # finish-branch falls back to a Claude reviewer when Codex is unavailable
                elif codex:
                    new = min(codex, key=lambda a: pause_end(a, accounts, now) or now).folder
                else:
                    drivers.pop(lane.name)
                    moves = [m for m in moves if m.lane != lane.name]
                    continue
                if end:
                    reason = "paused"
                elif seat is not None and seat.engine == "codex" and seat.logged_in and full_until(seat, now):
                    reason, end = "full", full_until(seat, now)
                else:
                    reason = "not in the pool"
        reviewers[lane.name] = new
        if new != old:
            moves.append(Move(lane.name, "reviewer", "claude" if lane.engine == "codex" else "codex", old, new,
                              "new" if old is None else reason, end))
    return Decision({n: (drivers[n], reviewers[n]) for n in drivers}, moves, stuck)


def when(at):
    # The local zone, not now's offset: a reset after the 25 October clock change would otherwise read
    # an hour out.
    return at.astimezone().strftime("%a %-d %b %H:%M")


def tilde(path, home):
    return "~" + path[len(home):] if path.startswith(home + "/") else path


def format_move(m, now, home):
    role = m.engine if m.role == "driver" else m.engine + " reviewer"
    if m.old is None:
        detail = "new"
    elif m.reason == "paused":
        detail = "was %s, paused until %s" % (tilde(m.old, home), when(m.paused_until))
    elif m.reason == "watcher":
        detail = "was %s, Codex lanes are reviewed from the watcher's account" % tilde(m.old, home)
    elif m.reason == "full":
        detail = "was %s, at 100%% until %s" % (tilde(m.old, home), when(m.paused_until) if m.paused_until else "not known")
    else:
        detail = "was %s, %s" % (tilde(m.old, home), m.reason)
    return "ACCOUNTS: lane %s %s → %s (%s)" % (m.lane, role, tilde(m.new, home), detail)


def format_stuck(s, now):
    nxt = when(s.next_reset) if s.next_reset else "not known"
    return "ACCOUNTS: lane %s stays paused — no %s account has allowance left (next reset %s)" % (
        s.lane, ENGINE_NAMES[s.engine], nxt)


def codex_alerts(accounts, announced, now):
    """CODEX 85% lines for accounts not yet announced in this weekly window, and the updated record."""
    record, lines = dict(announced), []
    for a in accounts:
        if a.engine != "codex" or not a.known:
            continue
        _, weekly, _ = effective_usage(a, now)
        if weekly < CODEX_ALERT_PERCENT:
            continue
        # The window is named by its reset hour, so a reset time read a few seconds differently later
        # would still name the same window.
        window = str(round(a.weekly_reset.timestamp() / 3600)) if a.weekly_reset else "unknown"
        if record.get(a.folder) == window:
            continue
        record[a.folder] = window
        reset = when(a.weekly_reset) if a.weekly_reset else "not known"
        lines.append("CODEX 85%%: %s at %d%%, weekly reset %s — offer the owner a spare reset" % (a.email or a.folder, weekly, reset))
    return lines, record


def launchd_label(lane):
    return "com.waitron.campaign" if lane == "A" else "com.waitron.campaign." + lane.lower()
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `cd ~/workspace/tools/.worktrees/account-pool && python3 -m unittest test_account_pool -v`
Expected: `OK`, 36 tests.

- [ ] **Step 5: Prove the seat rule by deletion**

Replace the `if seat is not None and ... qualifies(seat, ...): new = old` branch's condition with
`False`, run the tests, and confirm `test_a_codex_seat_stays_until_its_account_pauses` fails because the
seat moved to `~/.codex-dev`. Then put the condition back but with `qualifies(...)` replaced by
`seat.logged_in and end is None` (the rule before the 100% check), and confirm
`test_a_codex_seat_at_100_percent_moves_even_with_no_pause` fails because the seat stayed on
`~/.codex-gmail`. Restore and rerun to green.

- [ ] **Step 6: Commit**

```bash
cd ~/workspace/tools/.worktrees/account-pool
git add account_pool.py test_account_pool.py
git commit -s -m "account pool: reviewer seats, the lines the watcher reads, the Codex 85% offer

A Codex lane is always reviewed from the watcher's folder. A Claude lane's Codex reviewer seat
starts on the Codex account with the most allowance left per day and stays there until that
account is paused or used up, so seats do not swap back and forth every few minutes. The lines the picker
prints are written here in the exact shapes the spec gives, and the 85% offer is made once per
Codex account per weekly window."
```

**Done when:** 36 tests pass, both deletion checks failed for the stated reason before being restored,
and the commit exists.

---

## Task 3: The picker program — files in, assignment file out

**Work in:** `~/workspace/tools/.worktrees/account-pool`.

**Files:**
- Modify: `account_pool.py` (append the file formats)
- Modify: `test_account_pool.py` (append a `Files` class)
- Create: `assign-accounts.py` (executable)
- Create: `assign-accounts.test.sh` (executable)

**Interfaces:**
- Consumes: `account_pool.decide`, `format_move`, `format_stuck`, `codex_alerts`, `tilde`, `when`; from
  `lane-status.py`, loaded by file path as `codex-quota.py` already does: `DEFAULT_LANES`,
  `lane_settings(lane_dir)`, `stored_token(folder)`, `account_email(folder)`, `claude_windows(token, now)`,
  `codex_login(folder)`, `codex_windows(token, account_id, now)`, `pause(shared, folder, now)`,
  `parse_iso(s)`.
- Produces:
  - `account_pool.parse_pool(text, home) -> (list[(engine, folder)], list[problem str])`
  - `account_pool.parse_pins(text, home) -> dict[lane, folder]`
  - `account_pool.parse_assignments(text) -> dict[lane, (driver, reviewer)]` (lines with exactly three fields; `#` lines skipped)
  - `account_pool.format_assignments(assignments) -> str` (a `#` header line, then `<lane> <driver> <reviewer>` sorted by lane)
  - `assign-accounts.py [--shared DIR] [--lane NAME=DIR ...] [--watcher FOLDER] [--now ISO8601] [--dry-run]`, exit status always 0
  - In `assign-accounts.py`: `read_account(ls, engine, folder, now) -> (Account, error str | None)` and a `Said` class with `once(key, text, value=None)`, which Task 4 changes.

- [ ] **Step 1: Write the failing unit tests for the file formats** (append to `test_account_pool.py`)

```python
class Files(unittest.TestCase):
    def test_the_pool_file(self):
        text = "# the pool\nclaude ~/.claude-dev\n\ncodex /x/.codex-dev/  # trailing slash\ngemini ~/.g\nclaude\n"
        entries, problems = ap.parse_pool(text, H)
        self.assertEqual(entries, [("claude", H + "/.claude-dev"), ("codex", "/x/.codex-dev")])
        self.assertEqual(problems, ["pool line 5 is not '<claude|codex> <folder>', so it is skipped: gemini ~/.g",
                                    "pool line 6 is not '<claude|codex> <folder>', so it is skipped: claude"])

    def test_pins(self):
        self.assertEqual(ap.parse_pins("A ~/.claude-dev  # owner asked\n# none\nB\n", H), {"A": H + "/.claude-dev"})

    def test_the_assignment_file_round_trips_and_skips_what_is_not_a_whole_line(self):
        text = ap.format_assignments({"B": ("/b", "/r"), "A": ("/a", "/r")})
        self.assertTrue(text.startswith("# "))
        self.assertEqual(text.splitlines()[1:], ["A /a /r", "B /b /r"])
        self.assertEqual(ap.parse_assignments(text + "C /c\nD /d /r extra\n"), {"A": ("/a", "/r"), "B": ("/b", "/r")})
```

- [ ] **Step 2: Write the failing program tests** — `assign-accounts.test.sh`

The fixtures follow `lane-status.test.sh`: a fake `HOME`, one JSON file per stored Claude login standing
in for the Keychain, and `file://` usage answers. Whenever a fixture changes between two runs of the
picker, the second run is at least eleven minutes later (`run_at`) or follows `fresh`, so the usage cache
Task 4 adds cannot hide the change.

```sh
#!/bin/sh
# assign-accounts.py decides which login folder drives each campaign lane and which holds its reviewer
# seat. As in lane-status.test.sh: LANE_STATUS_KEYCHAIN_DIR holds one <service>.json per stored Claude
# login instead of the Keychain, LANE_STATUS_USAGE_URL and LANE_STATUS_CODEX_USAGE_URL are file://
# templates with {token} standing in for the two usage endpoints, and LANE_STATUS_PS stands in for ps.
set -eu
unset COLUMNS
here=$(cd "$(dirname "$0")" && pwd); tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1"; exit 1; }
export HOME="$tmp/home"; mkdir -p "$HOME"
export TZ=Europe/Madrid
export LANE_STATUS_KEYCHAIN_DIR="$tmp/keychain"; mkdir -p "$LANE_STATUS_KEYCHAIN_DIR"
export LANE_STATUS_USAGE_URL="file://$tmp/usage/{token}.json"; mkdir -p "$tmp/usage"
export LANE_STATUS_CODEX_USAGE_URL="file://$tmp/codex-usage/{token}.json"; mkdir -p "$tmp/codex-usage"
export LANE_STATUS_PS="$tmp/ps.txt"; : > "$LANE_STATUS_PS"

service_for() { if [ "$1" = "$HOME/.claude" ]; then echo "Claude Code-credentials"
  else echo "Claude Code-credentials-$(printf '%s' "$1" | shasum -a 256 | cut -c1-8)"; fi; }
login() { # $1 folder $2 email $3 token
  mkdir -p "$1"
  printf '{"oauthAccount":{"emailAddress":"%s"}}\n' "$2" > "$1/.claude.json"
  printf '{"claudeAiOauth":{"accessToken":"%s"}}\n' "$3" > "$LANE_STATUS_KEYCHAIN_DIR/$(service_for "$1").json"
}
usage() { # $1 token $2 5-hour % $3 its reset $4 weekly % $5 its reset (ISO, UTC)
  printf '{"five_hour":{"utilization":%s,"resets_at":"%s"},"seven_day":{"utilization":%s,"resets_at":"%s"}}\n' "$2" "$3" "$4" "$5" > "$tmp/usage/$1.json"
}
codex_login() { # $1 folder $2 email $3 token
  mkdir -p "$1"
  payload=$(printf '{"email":"%s"}' "$2" | base64 | tr '+/' '-_' | tr -d '=')
  printf '{"auth_mode":"chatgpt","tokens":{"id_token":"eyJhbGciOiJSUzI1NiJ9.%s.sig","access_token":"%s","account_id":"acct-1"}}\n' "$payload" "$3" > "$1/auth.json"
}
epoch() { date -j -f '%Y-%m-%d %H:%M:%S' "$1:00" +%s; }   # $1 Madrid local time "YYYY-MM-DD HH:MM"; without :00, date fills the seconds from the clock
codex_usage() { # $1 token $2 weekly % $3 its reset (epoch). Weekly only, as both real Codex accounts answered on 2026-10-12.
  printf '{"rate_limit":{"primary_window":{"used_percent":%s,"limit_window_seconds":604800,"reset_at":%s},"secondary_window":null}}\n' "$2" "$3" > "$tmp/codex-usage/$1.json"
}
lane() { # $1 dir $2 engine
  mkdir -p "$1"
  printf 'ENGINE="${RUNNER_ENGINE:-%s}"\nCLAUDE_ACCOUNT="${RUNNER_CLAUDE_ACCOUNT:-%s}"\nCODEX_ACCOUNT="${RUNNER_CODEX_ACCOUNT:-%s}"\n' "$2" "$HOME/.claude-old" "$HOME/.codex-old" > "$1/run.sh"
}
account_name() { echo "$1" | sed 's|[/.]|-|g'; }
mark() { # $1 folder $2 Madrid local time the pause ends: the marker runner-lib.sh writes
  printf '%s\n%s\n' "$(epoch "$2")" "You've hit your weekly limit" > "$SHARED/limits/$(account_name "$1").until"
}
SHARED="$tmp/shared"; ACC="$SHARED/accounts"
fresh() { rm -rf "$SHARED"; mkdir -p "$SHARED/limits" "$ACC"; cp "$tmp/pool" "$ACC/pool"; }
NOW=2026-10-14T10:00:00+02:00   # a Wednesday
# A later run is run_at <time>, never AT=<time> run: under sh an assignment in front of a function call
# stays set after it.
run_at() { at=$1; shift; python3 "$here/assign-accounts.py" --shared "$SHARED" --now "$at" \
  --lane "A=$tmp/camp-a" --lane "B=$tmp/camp-b" --lane "D=$tmp/camp-d" "$@"; }
run() { run_at "$NOW" "$@"; }
line_of() { grep "^$1 " "$ACC/assignments"; }

login "$HOME/.claude-support" support@waitron.io tokS
login "$HOME/.claude-dev" dev@waitron.io tokV
login "$HOME/.claude-clint" clint@waitron.io tokC
login "$HOME/.claude-info" info@waitron.io tokI       # the watcher's account in a second folder
login "$HOME/.claude-waitron" info@waitron.io tokW    # the watcher's own folder
usage tokS 10 2026-10-14T13:00:00+00:00 60 2026-10-16T20:00:00+00:00   # 40 left over 2.5 days: 16 a day
usage tokV 10 2026-10-14T13:00:00+00:00 22 2026-10-18T16:00:00+00:00   # 78 left over 4 1/3 days: 18 a day
usage tokC 0 2026-10-14T13:00:00+00:00 99 2026-10-16T10:00:00+00:00    # 1 left over 2 days
usage tokI 0 2026-10-14T13:00:00+00:00 7 2026-10-19T05:00:00+00:00     # the most left of all
usage tokW 0 2026-10-14T13:00:00+00:00 7 2026-10-19T05:00:00+00:00
codex_login "$HOME/.codex-dev" dev@waitron.io tokXD
codex_login "$HOME/.codex-gmail" clintongormley@gmail.com tokXG
codex_usage tokXD 20 "$(epoch '2026-10-18 06:00')"   # about 21 a day
codex_usage tokXG 27 "$(epoch '2026-10-18 09:27')"   # about 18 a day
lane "$tmp/camp-a" claude; lane "$tmp/camp-b" claude; lane "$tmp/camp-d" codex
printf 'claude ~/.claude-support\nclaude ~/.claude-dev\nclaude ~/.claude-clint\nclaude ~/.claude-info\nclaude ~/.claude-waitron\ncodex ~/.codex-dev\ncodex ~/.codex-gmail\n' > "$tmp/pool"

# first run: every lane gets a line, one Claude lane per account, Codex lanes reviewed from the watcher's folder
fresh
out=$(run)
[ "$(line_of A)" = "A $HOME/.claude-dev $HOME/.codex-dev" ] || fail "lane A takes the Claude account with most allowance a day (got: $(line_of A))"
[ "$(line_of B)" = "B $HOME/.claude-support $HOME/.codex-dev" ] || fail "lane B takes an account no other lane uses (got: $(line_of B))"
[ "$(line_of D)" = "D $HOME/.codex-dev $HOME/.claude-waitron" ] || fail "a Codex lane is reviewed from the watcher's folder (got: $(line_of D))"
grep -Eq "^[A-Z] $HOME/.claude-(info|waitron) " "$ACC/assignments" && fail "the watcher's account drives no lane"
echo "$out" | grep -qx 'ACCOUNTS: lane A claude → ~/.claude-dev (new)' || fail "a first assignment is announced (got: $out)"
[ "$(echo "$out" | grep -c '^ACCOUNTS: ')" -eq 6 ] || fail "one line per new driver and reviewer (got: $out)"

# a run that changes nothing prints nothing and leaves the file alone
inode=$(stat -f %i "$ACC/assignments")
out=$(run)
[ -z "$out" ] || fail "nothing changed, nothing printed (got: $out)"
[ "$(stat -f %i "$ACC/assignments")" = "$inode" ] || fail "an unchanged assignment file is not rewritten"

# a paused lane moves, through a rename
fresh
printf 'A %s %s\nB %s %s\nD %s %s\n' "$HOME/.claude-support" "$HOME/.codex-dev" "$HOME/.claude-clint" "$HOME/.codex-dev" "$HOME/.codex-dev" "$HOME/.claude-waitron" > "$ACC/assignments"
inode=$(stat -f %i "$ACC/assignments")
mark "$HOME/.claude-support" "2026-10-16 22:00"
out=$(run)
[ "$out" = "ACCOUNTS: lane A claude → ~/.claude-dev (was ~/.claude-support, paused until Fri 16 Oct 22:00)" ] || fail "a paused lane moves to the best account, said as the spec says (got: $out)"
[ "$(line_of A)" = "A $HOME/.claude-dev $HOME/.codex-dev" ] || fail "the move is written (got: $(line_of A))"
[ "$(stat -f %i "$ACC/assignments")" != "$inode" ] || fail "the assignment file is replaced through a rename, not written in place"
ls -A "$ACC" | grep -q tmp && fail "no temporary file is left behind"

# with every Claude account paused the lanes stay where they are, said once
mark "$HOME/.claude-dev" "2026-10-18 18:00"; mark "$HOME/.claude-clint" "2026-10-16 12:00"
out=$(run)
echo "$out" | grep -qx 'ACCOUNTS: lane A stays paused — no Claude account has allowance left (next reset Fri 16 Oct 12:00)' || fail "a lane with nowhere to go is reported (got: $out)"
echo "$out" | grep -qx 'ACCOUNTS: lane B stays paused — no Claude account has allowance left (next reset Fri 16 Oct 12:00)' || fail "each such lane is reported (got: $out)"
[ "$(line_of A)" = "A $HOME/.claude-dev $HOME/.codex-dev" ] || fail "a lane with nowhere to go keeps its line, and is not handed the watcher's account (got: $(line_of A))"
out=$(run)
[ -z "$out" ] || fail "a lane with nowhere to go is reported once (got: $out)"

# the Codex 85% offer, once per account per weekly window
fresh
codex_usage tokXD 86 "$(epoch '2026-10-18 06:00')"
run | grep -qx 'CODEX 85%: dev@waitron.io at 86%, weekly reset Sun 18 Oct 06:00 — offer the owner a spare reset' || fail "a Codex account at 85% or more is announced"
run_at 2026-10-14T10:20:00+02:00 | grep -q '^CODEX 85%' && fail "the same window is announced once"
codex_usage tokXD 90 "$(epoch '2026-10-25 06:00')"
run_at 2026-10-14T10:40:00+02:00 | grep -qx 'CODEX 85%: dev@waitron.io at 90%, weekly reset Sun 25 Oct 06:00 — offer the owner a spare reset' || fail "the next window is announced again"
codex_usage tokXD 20 "$(epoch '2026-10-18 06:00')"

# a dry run prints what it would write and writes nothing
fresh
out=$(run --dry-run)
[ "$(ls -A "$ACC")" = "pool" ] || fail "a dry run writes nothing (found: $(ls -A "$ACC"))"
echo "$out" | grep -qx "DRY RUN: would write $ACC/assignments:" || fail "a dry run says what it would write (got: $out)"
echo "$out" | grep -qx 'lane A  driver ~/.claude-dev  reviewer ~/.codex-dev' || fail "a dry run lists each lane's folders (got: $out)"

# a missing pool is said once; a pool line it cannot read is said once
fresh; rm "$ACC/pool"
[ "$(run)" = "ACCOUNTS ERROR: no pool file at $ACC/pool — no lane is assigned or moved" ] || fail "a missing pool is reported"
[ -z "$(run)" ] || fail "a missing pool is reported once"
fresh; echo 'gemini ~/.gemini' >> "$ACC/pool"
run | grep -qx "ACCOUNTS: pool line 8 is not '<claude|codex> <folder>', so it is skipped: gemini ~/.gemini" || fail "an unreadable pool line is reported"
run | grep -q 'pool line' && fail "an unreadable pool line is reported once"

echo "assign-accounts: all checks passed"
```

- [ ] **Step 3: Run both to watch them fail**

Run: `cd ~/workspace/tools/.worktrees/account-pool && chmod +x assign-accounts.test.sh && python3 -m unittest test_account_pool -v; sh assign-accounts.test.sh`
Expected: the `Files` tests error with `AttributeError: ... 'parse_pool'`; the shell test prints
`python3: can't open file '.../assign-accounts.py'` and then `FAIL: lane A takes the Claude account ...`.

- [ ] **Step 4: Write the minimal implementation**

Append to `account_pool.py`:

```python
ENGINES = ("claude", "codex")
ASSIGNMENTS_HEADER = ("# Written by ~/workspace/tools/assign-accounts.py; do not edit. "
                      "Lane, the driver's login folder, the reviewer seat's login folder.\n")


def _expand(folder, home):
    if folder == "~" or folder.startswith("~/"):
        folder = home + folder[1:]
    return folder.rstrip("/") or "/"


def parse_pool(text, home):
    entries, problems = [], []
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 2 or parts[0] not in ENGINES:
            problems.append("pool line %d is not '<claude|codex> <folder>', so it is skipped: %s" % (n, line))
            continue
        entries.append((parts[0], _expand(parts[1], home)))
    return entries, problems


def parse_pins(text, home):
    pins = {}
    for raw in text.splitlines():
        parts = raw.split("#", 1)[0].split()
        if len(parts) == 2:
            pins[parts[0]] = _expand(parts[1], home)
    return pins


def parse_assignments(text):
    found = {}
    for raw in text.splitlines():
        parts = raw.split()
        if len(parts) == 3 and not parts[0].startswith("#"):
            found[parts[0]] = (parts[1], parts[2])
    return found


def format_assignments(assignments):
    return ASSIGNMENTS_HEADER + "".join("%s %s %s\n" % (n, d, r) for n, (d, r) in sorted(assignments.items()))
```

Create `assign-accounts.py`:

```python
#!/usr/bin/env python3
"""Which login folder each Waitron campaign lane uses.

    assign-accounts.py [--shared DIR] [--lane NAME=DIR ...] [--watcher FOLDER] [--now ISO8601] [--dry-run]

Reads <shared>/accounts/pool, pins and assignments, the pause markers runner-lib.sh writes under
<shared>/limits, each lane's run.sh (for its engine) and STOP file, and each pool account's login and
usage through lane-status.py's readers. The rules are in account_pool.py. Writes the assignment file
through a rename, prints one line per change and nothing when nothing changed, and keeps what it has
already announced in <shared>/accounts/state.json. --dry-run writes nothing. The watcher's change-watch
loop runs it every pass. Spec: docs/superpowers/specs/2026-10-12-campaign-account-pool-design.md.
"""
import argparse
import dataclasses
import datetime as dt
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, HERE)
import account_pool as ap  # noqa: E402

HOME = os.path.expanduser("~")


def lane_status():
    spec = importlib.util.spec_from_file_location("lane_status", os.path.join(HERE, "lane-status.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None


def write_atomic(path, text):
    tmp = "%s.tmp-%d" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def load_json(path):
    try:
        return json.loads(read(path) or "{}")
    except ValueError:
        return {}


def windows_to_usage(windows):
    found = {label: (pct, at) for label, pct, at in windows}
    five, five_at = found.get("5-hour", (None, None))
    weekly, weekly_at = found.get("weekly", (None, None))
    return dict(five_hour=five, five_hour_reset=five_at, weekly=weekly, weekly_reset=weekly_at)


def read_account(ls, engine, folder, now):
    """(Account without its pause, the endpoint's error or None)."""
    if engine == "claude":
        token = ls.stored_token(folder)
        if not token:
            return ap.Account(folder, engine, logged_in=False, known=False), None
        email, fetch = ls.account_email(folder), (lambda: ls.claude_windows(token, now))
    else:
        login = ls.codex_login(folder)
        if not login:
            return ap.Account(folder, engine, logged_in=False, known=False), None
        email, fetch = login[0], (lambda: ls.codex_windows(login[1], login[2], now))
    try:
        return ap.Account(folder, engine, email=email, **windows_to_usage(fetch())), None
    except Exception as e:  # one account's endpoint failing must not stop the others
        return ap.Account(folder, engine, email=email, known=False), str(e)


class Said:
    """Lines to print. A line given to once() is printed only when it was not said on the last run;
    a condition that clears and returns is said again."""

    def __init__(self, before):
        self.before, self.now, self.lines = before, {}, []

    def once(self, key, text, value=None):
        value = text if value is None else value
        self.now[key] = value
        if self.before.get(key) != value:
            self.lines.append(text)


def assign(a, ls, now, state):
    acc = os.path.join(a.shared, "accounts")
    said = Said(state.get("said", {}))
    pool_text = read(os.path.join(acc, "pool"))
    if pool_text is None:
        said.once("pool", "ACCOUNTS ERROR: no pool file at %s — no lane is assigned or moved" % os.path.join(acc, "pool"))
        return said, None
    pool, problems = ap.parse_pool(pool_text, HOME)
    for p in problems:
        said.once("pool:" + p, "ACCOUNTS: " + p)
    pairs = [tuple(l.split("=", 1)) for l in a.lane] if a.lane else [(n, os.path.expanduser(d)) for n, d in ls.DEFAULT_LANES]
    lanes = [(ap.Lane(n, ls.lane_settings(d)["ENGINE"] or "claude", os.path.exists(os.path.join(d, "STOP"))), d) for n, d in pairs]
    accounts = []
    for engine, folder in pool:
        account, error = read_account(ls, engine, folder, now)
        if error:
            said.once("usage:" + folder, "ACCOUNTS: usage for %s unreadable (%s) — no earlier answer" % (ap.tilde(folder, HOME), error), "unreadable")
        p = ls.pause(a.shared, folder, now)
        accounts.append(dataclasses.replace(account, paused_until=p[0] if p else None))
    current = ap.parse_assignments(read(os.path.join(acc, "assignments")) or "")
    pins = ap.parse_pins(read(os.path.join(acc, "pins")) or "", HOME)
    watcher = a.watcher.rstrip("/")
    decision = ap.decide([l for l, _ in lanes], accounts, current, pins, watcher, ls.account_email(watcher), now)
    said.lines.extend(ap.format_move(m, now, HOME) for m in decision.moves)
    for s in decision.stuck:
        said.once("stuck:" + s.lane, ap.format_stuck(s, now), "stuck")
    alerts, announced = ap.codex_alerts(accounts, state.get("codex85", {}), now)
    said.lines.extend(alerts)
    return said, dict(decision=decision, current=current, announced=announced, lanes=lanes)


def main(argv):
    p = argparse.ArgumentParser()
    p.add_argument("--shared", default=os.path.expanduser("~/waitron-campaign-shared"))
    p.add_argument("--lane", action="append", help="NAME=DIR; default: the five lanes under ~")
    p.add_argument("--watcher", default=os.path.expanduser("~/.claude-waitron"))
    p.add_argument("--now", help="ISO 8601 with offset, for a reproducible run")
    p.add_argument("--dry-run", action="store_true", help="print what would be written; write nothing")
    a = p.parse_args(argv)
    ls = lane_status()
    now = ls.parse_iso(a.now) if a.now else dt.datetime.now().astimezone()
    acc = os.path.join(a.shared, "accounts")
    state_path = os.path.join(acc, "state.json")
    state = load_json(state_path)
    said, result = assign(a, ls, now, state)
    path = os.path.join(acc, "assignments")
    if a.dry_run:
        for line in said.lines:
            print(line)
        if result:
            print("DRY RUN: would write %s:" % path)
            for lane, (driver, reviewer) in sorted(result["decision"].assignments.items()):
                print("lane %s  driver %s  reviewer %s" % (lane, ap.tilde(driver, HOME), ap.tilde(reviewer, HOME)))
        return
    if result and result["decision"].assignments != result["current"]:
        write_atomic(path, ap.format_assignments(result["decision"].assignments))
    new_state = dict(state, said=said.now)
    if result:
        new_state["codex85"] = result["announced"]
    if new_state != state and os.path.isdir(acc):
        write_atomic(state_path, json.dumps(new_state, indent=1, sort_keys=True) + "\n")
    for line in said.lines:
        print(line)


if __name__ == "__main__":
    main(sys.argv[1:])
```

- [ ] **Step 5: Run both to watch them pass**

Run: `cd ~/workspace/tools/.worktrees/account-pool && chmod +x assign-accounts.py && python3 -m unittest test_account_pool -v && sh assign-accounts.test.sh`
Expected: `OK` (39 tests), then `assign-accounts: all checks passed`.

- [ ] **Step 6: Prove the rename check by deletion**

Replace the body of `write_atomic` with a plain `open(path, "w")` write, run `sh assign-accounts.test.sh`,
and confirm it stops at `FAIL: the assignment file is replaced through a rename, not written in place`.
Restore and rerun to green.

- [ ] **Step 7: Commit**

```bash
cd ~/workspace/tools/.worktrees/account-pool
git add account_pool.py test_account_pool.py assign-accounts.py assign-accounts.test.sh
git commit -s -m "assign-accounts: write each campaign lane's login folders from the pool

The picker reads the pool of login folders, the pins, the current assignments, the runners' pause
files and every pool account's usage (through lane-status.py's readers), and writes the
assignment file through a rename. It prints one line per change and nothing when nothing changed,
reports a lane with nowhere to go and the Codex 85% offer once each, and with --dry-run writes
nothing."
```

**Done when:** both suites pass, the deletion check failed for the stated reason before being restored,
and the commit exists.

---

## Task 4: The picker — usage cache, expired sign-ins, kicking a moved lane, its own log

**Work in:** `~/workspace/tools/.worktrees/account-pool`.

**Files:**
- Modify: `lane-status.py:72-89` (`stored_token` split into `stored_credential` and `stored_token`; the
  `security` call gets a time limit)
- Modify: `assign-accounts.py`
- Modify: `assign-accounts.test.sh` (append before the final `echo`)
- Modify: `README.md` (a section for the picker, and its test in the Tests list)

**Interfaces:**
- Consumes: Task 3's `assign-accounts.py`; from `lane-status.py` also `ps_lines()` and `running_for(lane_dir, lines)`.
- Produces:
  - `lane-status.stored_credential(folder) -> dict | None` (the stored `claudeAiOauth` record); raises
    `RuntimeError("the Keychain did not answer within N s")` when `security` takes longer than
    `LANE_STATUS_KEYCHAIN_SECONDS` (default 10). `stored_token` keeps its behaviour, and returns None on
    that timeout, so `lane-status.py` still prints its report.
  - Environment variables `LANE_STATUS_SECURITY` (default `security`) and `LANE_STATUS_KEYCHAIN_SECONDS`,
    for the test.
  - `<shared>/accounts/usage.json`: `{"fetched_at": iso, "markers": {folder: until epoch}, "accounts": {folder: {"logged_in", "email", "five_hour", "five_hour_reset", "weekly", "weekly_reset", "read_at"}}, "errors": {folder: text}}`
  - `<shared>/accounts/log`: every printed line, prefixed with `YYYY-MM-DD HH:MM `.
  - Environment variables `ASSIGN_ACCOUNTS_LAUNCHCTL` (default `launchctl`) and
    `ASSIGN_ACCOUNTS_LAUNCHCTL_SECONDS` (default 30), for the test.

- [ ] **Step 1: Write the failing tests** (append to `assign-accounts.test.sh`, before the final `echo`)

```sh
# usage is read at most every ten minutes, and at once when a new pause marker appears
fetched() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["fetched_at"])' "$ACC/usage.json"; }
fresh; run >/dev/null
[ "$(fetched)" = "2026-10-14T10:00:00+02:00" ] || fail "the first run reads every account (got: $(fetched))"
run_at 2026-10-14T10:05:00+02:00 >/dev/null
[ "$(fetched)" = "2026-10-14T10:00:00+02:00" ] || fail "within ten minutes the last answers are reused (got: $(fetched))"
run_at 2026-10-14T10:11:00+02:00 >/dev/null
[ "$(fetched)" = "2026-10-14T10:11:00+02:00" ] || fail "after ten minutes every account is read again (got: $(fetched))"
fresh; run >/dev/null   # A on dev, B on support
usage tokC 0 2026-10-14T13:00:00+00:00 10 2026-10-16T10:00:00+00:00   # clint now has 45 a day; the cached answer says 0.5
mark "$HOME/.claude-dev" "2026-10-18 18:00"
out=$(run_at 2026-10-14T10:05:00+02:00)
[ "$(fetched)" = "2026-10-14T10:05:00+02:00" ] || fail "a new pause marker makes every account be read again at once (got: $(fetched))"
echo "$out" | grep -qx 'ACCOUNTS: lane A claude → ~/.claude-clint (was ~/.claude-dev, paused until Sun 18 Oct 18:00)' || fail "the move uses the fresh answers; the cached ones would have chosen ~/.claude-support (got: $out)"
usage tokC 0 2026-10-14T13:00:00+00:00 99 2026-10-16T10:00:00+00:00

# a stored sign-in that has expired is not sent to the endpoint: only Claude renews it, and the
# endpoint answered 401 for one such folder on 2026-10-12
login_expiring() { # $1 folder $2 email $3 token $4 expiry, epoch milliseconds
  mkdir -p "$1"
  printf '{"oauthAccount":{"emailAddress":"%s"}}\n' "$2" > "$1/.claude.json"
  printf '{"claudeAiOauth":{"accessToken":"%s","expiresAt":%s}}\n' "$3" "$4" > "$LANE_STATUS_KEYCHAIN_DIR/$(service_for "$1").json"
}
fresh
login_expiring "$HOME/.claude-clint" clint@waitron.io tokGone "$(( $(epoch '2026-10-14 09:00') * 1000 ))"   # no answer exists for tokGone
out=$(run)
echo "$out" | grep -q 'clint.*unreadable' && fail "an expired sign-in is not asked, so nothing is reported for it (got: $out)"
python3 - "$ACC/usage.json" <<'PY' || fail "an expired sign-in leaves the account signed in with no answer yet"
import json, sys; e = json.load(open(sys.argv[1]))["accounts"][sys.argv[1].rsplit("/shared/", 1)[0] + "/home/.claude-clint"]
assert e["logged_in"] is True and "read_at" not in e, e
PY
fresh
login_expiring "$HOME/.claude-clint" clint@waitron.io tokGone "$(( $(epoch '2026-10-14 18:00') * 1000 ))"
run | grep -q '^ACCOUNTS: usage for ~/.claude-clint unreadable (' || fail "control: a live sign-in whose endpoint fails is reported"
run_at 2026-10-14T10:11:00+02:00 | grep -q 'unreadable' && fail "an unreadable account is reported once"
login "$HOME/.claude-clint" clint@waitron.io tokC

# when a read fails the last answer is kept, and the line says when it was read
fresh; run >/dev/null
mv "$tmp/usage/tokC.json" "$tmp/usage/tokC.json.away"
out=$(run_at 2026-10-14T10:11:00+02:00)
echo "$out" | grep -q '^ACCOUNTS: usage for ~/.claude-clint unreadable (.*) — using the answer read Wed 14 Oct 10:00$' || fail "a failed read keeps the last answer and says so (got: $out)"
python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["accounts"][sys.argv[2]]["weekly"] == 99' "$ACC/usage.json" "$HOME/.claude-clint" || fail "the last answer is kept in the cache"
mv "$tmp/usage/tokC.json.away" "$tmp/usage/tokC.json"

# a lane moved off a paused account is started at once, unless it is running or stopped
export ASSIGN_ACCOUNTS_LAUNCHCTL="$tmp/launchctl"
printf '#!/bin/sh\necho "$*" >> "%s/launchctl.calls"\nexit ${FAKE_LAUNCHCTL_EXIT:-0}\n' "$tmp" > "$tmp/launchctl"; chmod +x "$tmp/launchctl"
kicks() { cat "$tmp/launchctl.calls" 2>/dev/null || true; }
fresh; rm -f "$tmp/launchctl.calls"
run >/dev/null
[ -z "$(kicks)" ] || fail "a lane given its first account is not started (got: $(kicks))"
mark "$HOME/.claude-dev" "2026-10-18 18:00"
run >/dev/null
[ "$(kicks)" = "kickstart gui/$(id -u)/com.waitron.campaign" ] || fail "an idle lane moved off a paused account is started (got: $(kicks))"
fresh; rm -f "$tmp/launchctl.calls"; run >/dev/null
mark "$HOME/.codex-dev" "2026-10-18 06:00"
run >/dev/null
[ "$(kicks)" = "kickstart gui/$(id -u)/com.waitron.campaign.d" ] || fail "only the lane whose driver moved is started, not lanes whose reviewer seat moved (got: $(kicks))"
fresh; rm -f "$tmp/launchctl.calls"; run >/dev/null
mkdir "$tmp/camp-a/run.lock"; mark "$HOME/.claude-dev" "2026-10-18 18:00"
run >/dev/null; rmdir "$tmp/camp-a/run.lock"
[ -z "$(kicks)" ] || fail "a lane holding its run lock is not started (got: $(kicks))"
fresh; rm -f "$tmp/launchctl.calls"; run >/dev/null
printf '   41:12 claude -p Read and follow %s/RUNNER.md exactly --dangerously-skip-permissions\n' "$tmp/camp-b" > "$LANE_STATUS_PS"
mark "$HOME/.claude-support" "2026-10-16 22:00"
out=$(run); : > "$LANE_STATUS_PS"
echo "$out" | grep -q '^ACCOUNTS: lane B claude → ' || fail "a running lane is still moved (got: $out)"
[ -z "$(kicks)" ] || fail "a running lane is not started again (got: $(kicks))"
fresh; rm -f "$tmp/launchctl.calls"; run >/dev/null
touch "$tmp/camp-a/STOP"; mark "$HOME/.claude-dev" "2026-10-18 18:00"
out=$(run); rm "$tmp/camp-a/STOP"
echo "$out" | grep -q 'lane A' && fail "a stopped lane is left where it is (got: $out)"
[ -z "$(kicks)" ] || fail "a stopped lane is not started (got: $(kicks))"
fresh; rm -f "$tmp/launchctl.calls"; run >/dev/null
mark "$HOME/.claude-dev" "2026-10-18 18:00"
export FAKE_LAUNCHCTL_EXIT=3; run | grep -qx 'ACCOUNTS: could not start lane A now (launchctl exit 3) — it starts at its next 30-minute firing' || fail "a failed start is reported"
unset FAKE_LAUNCHCTL_EXIT
fresh; rm -f "$tmp/launchctl.calls"; run >/dev/null
mark "$HOME/.claude-dev" "2026-10-18 18:00"
printf '#!/bin/sh\nexec sleep 5\n' > "$tmp/slow-launchctl"; chmod +x "$tmp/slow-launchctl"
out=$(ASSIGN_ACCOUNTS_LAUNCHCTL="$tmp/slow-launchctl" ASSIGN_ACCOUNTS_LAUNCHCTL_SECONDS=1 run)
echo "$out" | grep -qx 'ACCOUNTS: could not start lane A now (launchctl did not answer within 1 s) — it starts at its next 30-minute firing' || fail "a launchctl that does not answer is given a time limit (got: $out)"

# a Keychain that does not answer is given a time limit, and the last answer is kept
fresh; run >/dev/null
printf '#!/bin/sh\nexec sleep 5\n' > "$tmp/slow-security"; chmod +x "$tmp/slow-security"
out=$(LANE_STATUS_KEYCHAIN_DIR= LANE_STATUS_SECURITY="$tmp/slow-security" LANE_STATUS_KEYCHAIN_SECONDS=1 run_at 2026-10-14T10:11:00+02:00)
echo "$out" | grep -qx 'ACCOUNTS: usage for ~/.claude-support unreadable (the Keychain did not answer within 1 s) — using the answer read Wed 14 Oct 10:00' || fail "a Keychain that does not answer is given a time limit (got: $out)"
[ "$(line_of A)" = "A $HOME/.claude-dev $HOME/.codex-dev" ] || fail "a Keychain that does not answer moves no lane (got: $(line_of A))"

# a lane-status.py that cannot be loaded is one line, said once, never a traceback
mkdir -p "$tmp/broken"; cp "$here/assign-accounts.py" "$here/account_pool.py" "$tmp/broken/"
echo 'def (' > "$tmp/broken/lane-status.py"
fresh
out=$(python3 "$tmp/broken/assign-accounts.py" --shared "$SHARED" --now "$NOW" --lane "A=$tmp/camp-a" 2>&1) || fail "a broken lane-status.py still exits 0"
echo "$out" | grep -q '^ACCOUNTS ERROR: SyntaxError: ' || fail "a broken lane-status.py is one ACCOUNTS ERROR line (got: $out)"
[ "$(echo "$out" | wc -l | tr -d ' ')" = 1 ] || fail "and only one line, no traceback (got: $out)"
[ -z "$(python3 "$tmp/broken/assign-accounts.py" --shared "$SHARED" --now "$NOW" --lane "A=$tmp/camp-a" 2>&1)" ] || fail "a broken lane-status.py is said once"

# every printed line is also kept, with the time, in accounts/log
grep -q '^2026-10-14 10:00 ACCOUNTS: lane A claude → ' "$ACC/log" || fail "printed lines are appended to accounts/log (got: $(cat "$ACC/log"))"

# anything unexpected is one line, said once, and the run still exits 0
fresh; rm "$ACC/pool"; mkdir "$ACC/pool"
out=$(run) || fail "the picker exits 0 even when it fails"
echo "$out" | grep -q '^ACCOUNTS ERROR: IsADirectoryError: ' || fail "an unexpected failure is one ACCOUNTS ERROR line (got: $out)"
[ "$(echo "$out" | wc -l | tr -d ' ')" = 1 ] || fail "and only one line (got: $out)"
[ -z "$(run)" ] || fail "the same failure is said once"
```

- [ ] **Step 2: Run to watch them fail**

Run: `cd ~/workspace/tools/.worktrees/account-pool && sh assign-accounts.test.sh`
Expected: `FAIL: the first run reads every account (got: ...)` with a `No such file` traceback for
`usage.json`.

- [ ] **Step 3: Write the minimal implementation**

In `lane-status.py`, replace `stored_token` (lines 72–89) with:

```python
def stored_credential(folder):
    """The record Claude stored for this login folder (claudeAiOauth), or None when it never logged in.
    Raises RuntimeError when the Keychain does not answer in time."""
    service = keychain_service(folder)
    fixture = os.environ.get("LANE_STATUS_KEYCHAIN_DIR")
    if fixture:
        path = os.path.join(fixture, service + ".json")
        if not os.path.exists(path):
            return None
        raw = open(path, encoding="utf-8").read()
    else:
        seconds = int(os.environ.get("LANE_STATUS_KEYCHAIN_SECONDS") or 10)
        try:
            r = subprocess.run([os.environ.get("LANE_STATUS_SECURITY") or "security", "find-generic-password", "-s", service, "-w"],
                               capture_output=True, text=True, timeout=seconds)
        except subprocess.TimeoutExpired:
            raise RuntimeError("the Keychain did not answer within %d s" % seconds)
        if r.returncode != 0:
            return None
        raw = r.stdout.strip()
    try:
        record = json.loads(raw)["claudeAiOauth"]
    except (ValueError, KeyError, TypeError):
        return None
    return record if isinstance(record, dict) else None


def stored_token(folder):
    """The access token Claude stored for this login folder, or None when it never logged in or the
    Keychain did not answer in time."""
    try:
        return (stored_credential(folder) or {}).get("accessToken")
    except RuntimeError:
        return None
```

Replace `assign-accounts.py` with this complete version. Against Task 3's it adds the usage cache
(`usage_json`, `account_from`, `needs_reading`, `read_usage`, which replace `read_account`), `kick`,
`emit` (prints and appends to `accounts/log`), `run` (the old body of `main`), and the guard in
`main` that turns any unexpected failure into one `ACCOUNTS ERROR` line. The usage cache is written
only on a pass that re-read it.

```python
#!/usr/bin/env python3
"""Which login folder each Waitron campaign lane uses.

    assign-accounts.py [--shared DIR] [--lane NAME=DIR ...] [--watcher FOLDER] [--now ISO8601] [--dry-run]

Reads <shared>/accounts/pool, pins and assignments, the pause markers runner-lib.sh writes under
<shared>/limits, each lane's run.sh (for its engine) and STOP file, and each pool account's login and
usage through lane-status.py's readers. The rules are in account_pool.py. Writes the assignment file
through a rename, prints one line per change and nothing when nothing changed, keeps what it has
already announced in <shared>/accounts/state.json, every printed line in <shared>/accounts/log and the
last usage answers in <shared>/accounts/usage.json, and starts a lane it moved off a paused account.
--dry-run writes and starts nothing. The watcher's change-watch loop runs it every pass. Spec:
docs/superpowers/specs/2026-10-12-campaign-account-pool-design.md in the waitron repository.

Override, for the test: ASSIGN_ACCOUNTS_LAUNCHCTL (the program run as launchctl).
"""
import argparse
import dataclasses
import datetime as dt
import importlib.util
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, HERE)
import account_pool as ap  # noqa: E402

HOME = os.path.expanduser("~")
CACHE_SECONDS = 600


def lane_status():
    spec = importlib.util.spec_from_file_location("lane_status", os.path.join(HERE, "lane-status.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None


def write_atomic(path, text):
    tmp = "%s.tmp-%d" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def write_json(path, value):
    write_atomic(path, json.dumps(value, indent=1, sort_keys=True) + "\n")


def load_json(path):
    try:
        return json.loads(read(path) or "{}")
    except ValueError:
        return {}


def windows_to_usage(windows):
    found = {label: (pct, at) for label, pct, at in windows}
    five, five_at = found.get("5-hour", (None, None))
    weekly, weekly_at = found.get("weekly", (None, None))
    return dict(five_hour=five, five_hour_reset=five_at, weekly=weekly, weekly_reset=weekly_at)


def usage_json(usage):
    return {k: (v.isoformat() if isinstance(v, dt.datetime) else v) for k, v in usage.items()}


def account_from(engine, folder, entry):
    if not entry.get("logged_in"):
        return ap.Account(folder, engine, logged_in=False, known=False)

    def t(key):
        return dt.datetime.fromisoformat(entry[key]) if entry.get(key) else None
    return ap.Account(folder, engine, email=entry.get("email"), known="read_at" in entry,
                      five_hour=entry.get("five_hour"), five_hour_reset=t("five_hour_reset"),
                      weekly=entry.get("weekly"), weekly_reset=t("weekly_reset"))


def needs_reading(cache, pool, markers, now):
    try:
        age = (now - dt.datetime.fromisoformat(cache["fetched_at"])).total_seconds()
    except (KeyError, TypeError, ValueError):
        return True
    if not 0 <= age < CACHE_SECONDS:
        return True
    if any(cache.get("markers", {}).get(f) != until for f, until in markers.items()):
        return True
    return any(f not in cache.get("accounts", {}) for _, f in pool)


def read_usage(ls, pool, cache, now):
    """Every pool account's login and usage, keeping the last answer when a read fails. A Claude
    sign-in whose stored access token has expired is not sent: only Claude renews it, when it runs."""
    old = cache.get("accounts", {})
    entries, errors = {}, {}
    for engine, folder in pool:
        entry = dict(old.get(folder, {}))
        if engine == "claude":
            try:
                record = ls.stored_credential(folder) or {}
            except RuntimeError as e:  # the Keychain did not answer: keep the last answer
                errors[folder] = str(e)
                entries[folder] = entry
                continue
            token = record.get("accessToken")
            if not token:
                entries[folder] = {"logged_in": False}
                continue
            entry.update(logged_in=True, email=ls.account_email(folder))
            expires = record.get("expiresAt")
            if isinstance(expires, (int, float)) and expires / 1000 <= now.timestamp():
                entries[folder] = entry
                continue

            def fetch(token=token):
                return ls.claude_windows(token, now)
        else:
            login = ls.codex_login(folder)
            if not login:
                entries[folder] = {"logged_in": False}
                continue
            entry.update(logged_in=True, email=login[0])

            def fetch(login=login):
                return ls.codex_windows(login[1], login[2], now)
        try:
            entry.update(usage_json(windows_to_usage(fetch())), read_at=now.isoformat())
        except Exception as e:  # one account's endpoint failing must not stop the others
            errors[folder] = str(e)
        entries[folder] = entry
    return entries, errors


class Said:
    """Lines to print. A line given to once() is printed only when it was not said on the last run;
    a condition that clears and returns is said again."""

    def __init__(self, before):
        self.before, self.now, self.lines = before, {}, []

    def once(self, key, text, value=None):
        value = text if value is None else value
        self.now[key] = value
        if self.before.get(key) != value:
            self.lines.append(text)


def assign(a, ls, now, state):
    acc = os.path.join(a.shared, "accounts")
    said = Said(state.get("said", {}))
    pool_text = read(os.path.join(acc, "pool"))
    if pool_text is None:
        said.once("pool", "ACCOUNTS ERROR: no pool file at %s — no lane is assigned or moved" % os.path.join(acc, "pool"))
        return said, None
    pool, problems = ap.parse_pool(pool_text, HOME)
    for p in problems:
        said.once("pool:" + p, "ACCOUNTS: " + p)
    pairs = [tuple(l.split("=", 1)) for l in a.lane] if a.lane else [(n, os.path.expanduser(d)) for n, d in ls.DEFAULT_LANES]
    lanes = [(ap.Lane(n, ls.lane_settings(d)["ENGINE"] or "claude", os.path.exists(os.path.join(d, "STOP"))), d) for n, d in pairs]
    markers = {}
    for _, folder in pool:
        p = ls.pause(a.shared, folder, now)
        if p:
            markers[folder] = int(p[0].timestamp())
    cache = load_json(os.path.join(acc, "usage.json"))
    reread = needs_reading(cache, pool, markers, now)
    if reread:
        entries, errors = read_usage(ls, pool, cache, now)
        cache = {"fetched_at": now.isoformat(), "markers": markers, "accounts": entries, "errors": errors}
    accounts = []
    for engine, folder in pool:
        entry = cache["accounts"].get(folder, {})
        error = cache.get("errors", {}).get(folder)
        if error:
            since = ("using the answer read " + ap.when(dt.datetime.fromisoformat(entry["read_at"]))) if "read_at" in entry else "no earlier answer"
            said.once("usage:" + folder, "ACCOUNTS: usage for %s unreadable (%s) — %s" % (ap.tilde(folder, HOME), error, since), "unreadable")
        until = markers.get(folder)
        accounts.append(dataclasses.replace(account_from(engine, folder, entry),
                                            paused_until=dt.datetime.fromtimestamp(until, now.tzinfo) if until else None))
    current = ap.parse_assignments(read(os.path.join(acc, "assignments")) or "")
    pins = ap.parse_pins(read(os.path.join(acc, "pins")) or "", HOME)
    watcher = a.watcher.rstrip("/")
    decision = ap.decide([l for l, _ in lanes], accounts, current, pins, watcher, ls.account_email(watcher), now)
    said.lines.extend(ap.format_move(m, now, HOME) for m in decision.moves)
    for s in decision.stuck:
        said.once("stuck:" + s.lane, ap.format_stuck(s, now), "stuck")
    alerts, announced = ap.codex_alerts(accounts, state.get("codex85", {}), now)
    said.lines.extend(alerts)
    return said, dict(decision=decision, current=current, announced=announced, lanes=lanes,
                      cache=cache if reread else None)


def kick(ls, moves, lanes, said):
    """Start a lane moved off a paused account now, rather than at its next 30-minute firing."""
    dirs = {lane.name: d for lane, d in lanes}
    ps = None
    for m in moves:
        if m.role != "driver" or m.reason != "paused":
            continue
        d = dirs[m.lane]
        if os.path.exists(os.path.join(d, "STOP")) or os.path.isdir(os.path.join(d, "run.lock")):
            continue
        ps = ls.ps_lines() if ps is None else ps
        if ls.running_for(d, ps):
            continue
        cmd = [os.environ.get("ASSIGN_ACCOUNTS_LAUNCHCTL", "launchctl"), "kickstart",
               "gui/%d/%s" % (os.getuid(), ap.launchd_label(m.lane))]
        seconds = int(os.environ.get("ASSIGN_ACCOUNTS_LAUNCHCTL_SECONDS") or 30)
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=seconds)
        except subprocess.TimeoutExpired:
            said.lines.append("ACCOUNTS: could not start lane %s now (launchctl did not answer within %d s) — it starts at its next 30-minute firing" % (m.lane, seconds))
            continue
        if r.returncode:
            said.lines.append("ACCOUNTS: could not start lane %s now (launchctl exit %d) — it starts at its next 30-minute firing" % (m.lane, r.returncode))


def emit(acc, lines, now):
    for line in lines:
        print(line)
    if lines and os.path.isdir(acc):
        with open(os.path.join(acc, "log"), "a", encoding="utf-8") as f:
            f.writelines("%s %s\n" % (now.strftime("%Y-%m-%d %H:%M"), line) for line in lines)


def run(a, ls, now):
    acc = os.path.join(a.shared, "accounts")
    state_path = os.path.join(acc, "state.json")
    state = load_json(state_path)
    said, result = assign(a, ls, now, state)
    path = os.path.join(acc, "assignments")
    if a.dry_run:
        for line in said.lines:
            print(line)
        if result:
            print("DRY RUN: would write %s:" % path)
            for lane, (driver, reviewer) in sorted(result["decision"].assignments.items()):
                print("lane %s  driver %s  reviewer %s" % (lane, ap.tilde(driver, HOME), ap.tilde(reviewer, HOME)))
        return
    if result and result["decision"].assignments != result["current"]:
        write_atomic(path, ap.format_assignments(result["decision"].assignments))
        kick(ls, result["decision"].moves, result["lanes"], said)
    if result and result["cache"] is not None:
        write_json(os.path.join(acc, "usage.json"), result["cache"])
    new_state = dict(state, said=said.now)
    if result:
        new_state["codex85"] = result["announced"]
    if new_state != state and os.path.isdir(acc):
        write_json(state_path, new_state)
    emit(acc, said.lines, now)


def main(argv):
    p = argparse.ArgumentParser()
    p.add_argument("--shared", default=os.path.expanduser("~/waitron-campaign-shared"))
    p.add_argument("--lane", action="append", help="NAME=DIR; default: the five lanes under ~")
    p.add_argument("--watcher", default=os.path.expanduser("~/.claude-waitron"))
    p.add_argument("--now", help="ISO 8601 with offset, for a reproducible run")
    p.add_argument("--dry-run", action="store_true", help="print what would be written; write and start nothing")
    a = p.parse_args(argv)
    try:
        ls = lane_status()  # inside the guard: a lane-status.py that cannot load is one line, not a traceback every pass
        now = ls.parse_iso(a.now) if a.now else dt.datetime.now().astimezone()
        run(a, ls, now)
    except Exception as e:  # the watcher's loop runs this every pass: one line, said once, never a traceback
        acc = os.path.join(a.shared, "accounts")
        state = load_json(os.path.join(acc, "state.json"))
        said = state.get("said", {})
        message = "ACCOUNTS ERROR: %s: %s" % (type(e).__name__, e)
        if said.get("error") == message:
            return
        if not a.dry_run and os.path.isdir(acc):
            try:
                write_json(os.path.join(acc, "state.json"), dict(state, said=dict(said, error=message)))
            except OSError:
                pass
        print(message)


if __name__ == "__main__":
    main(sys.argv[1:])
```

In `README.md`, after the `lane-status.py` section, add:

````markdown
### `assign-accounts.py` — which login folder each campaign lane uses

```bash
python3 ~/workspace/tools/assign-accounts.py             # decide, write, print what changed
python3 ~/workspace/tools/assign-accounts.py --dry-run   # print what it would write; write nothing
```

Reads the pool of login folders (`~/waitron-campaign-shared/accounts/pool`: `claude` or `codex`, then
the folder, one per line), the watcher's pins (`accounts/pins`: a lane letter, then a folder), the
runners' pause files under `limits/` and every pool account's usage, and writes
`accounts/assignments`, which each lane's runner reads at the start of every firing. A lane stays on
its account until that account is paused, then moves to the account with the most allowance left per
day before its weekly reset, and is started at once if it is idle. It prints nothing when nothing
changed, and keeps every line it prints in `accounts/log`. Usage is read at most every ten minutes, and
at once when a new pause appears; a Claude sign-in whose stored token has expired is not asked, and its
last answer is used instead. The campaign watcher runs it every pass. The rules are in
`account_pool.py`. Tests: `python3 -m unittest test_account_pool` and `sh assign-accounts.test.sh`.
````

and add these two lines to the Tests list:

```
python3 -m unittest test_account_pool -v   # the picker's rules
./assign-accounts.test.sh                    # the picker over fake lanes, a fake Keychain folder and file:// usage fixtures
```

- [ ] **Step 4: Run everything to watch it pass**

Run: `cd ~/workspace/tools/.worktrees/account-pool && python3 -m unittest test_account_pool -v && sh assign-accounts.test.sh && sh lane-status.test.sh && sh codex-quota.test.sh`
Expected: `OK` (39 tests), `assign-accounts: all checks passed`, `lane-status: all checks passed`, and
codex-quota's own pass line. Each command's status is checked by `&&`.

- [ ] **Step 5: Prove two checks by deletion**

Delete the `expires / 1000 <= now.timestamp()` skip and confirm the run stops at `FAIL: an expired
sign-in is not asked ...`. Delete the `run.lock` condition in `kick` and confirm `FAIL: a lane holding
its run lock is not started`. Delete `timeout=seconds` from the `launchctl` call and confirm `FAIL: a
launchctl that does not answer is given a time limit`. Move `ls = lane_status()` back above the `try`
and confirm `FAIL: a broken lane-status.py is one ACCOUNTS ERROR line`. Restore all four and rerun to
green.

- [ ] **Step 6: Commit**

```bash
cd ~/workspace/tools/.worktrees/account-pool
git add lane-status.py assign-accounts.py assign-accounts.test.sh README.md
git commit -s -m "assign-accounts: read usage every ten minutes, start a moved lane at once

The picker keeps every account's last usage answer in accounts/usage.json and reads again after
ten minutes, or at once when a new pause appears. A Claude sign-in whose stored token has expired
is not asked: only Claude renews that token, and on 2026-10-12 the endpoint refused one such
folder. A lane moved off a paused account is started with launchctl unless it is running or
stopped. Every printed line also goes to accounts/log, and an unexpected failure, including a
lane-status.py that cannot load, is one line, said once. The Keychain and launchctl calls have
time limits."
```

**Done when:** all four suites pass, the four deletion checks failed for the stated reason before being
restored, and the commit exists.

---

## Task 4b: The picker — one run at a time, and broken sign-ins

**Work in:** `~/workspace/tools/.worktrees/account-pool`.

**Files:**
- Modify: `account_pool.py` (`Account.signin_broken`; `qualifies`, `next_reset`, `decide_drivers`,
  `decide` honour it)
- Modify: `test_account_pool.py` (append a `SignIn` class)
- Modify: `assign-accounts.py` (the lock; reading, announcing and clearing sign-in markers)
- Modify: `assign-accounts.test.sh` (append before the final `echo`)
- Modify: `README.md` (two sentences in the picker's section)

**Interfaces:**
- Consumes: Task 4's `assign-accounts.py`; the marker Task 5b's runner writes,
  `<shared>/limits/<account_name>.signin` (line 1 epoch first noticed, line 2 the message).
- Produces:
  - `Account(..., signin_broken=False)`: a folder whose sign-in is broken never qualifies, is not a reset
    to wait for, and a driver or Codex seat on it moves with reason `"sign-in broken"`.
  - In `assign-accounts.py`: `take_lock(acc)` (an open file holding the lock, `True` when there is no
    `accounts` folder to lock, or `None` when another run holds it); `signin_path(ls, shared, folder)`
    and `signin_marker(ls, shared, folder)` (`(epoch, message)` or None); `fingerprint(ls, engine, folder)` (a short hash of the folder's stored
    sign-in: the Keychain record for Claude, `auth.json`'s bytes for Codex, `"none"` without one).
  - `state.json` gains `"signin": {folder: fingerprint when the marker was first seen}`.
  - Lines: `SIGN-IN BROKEN: …` and `ACCOUNTS: <folder> is signed in again — it can be handed out`, in the
    shapes under Global Constraints.

- [ ] **Step 1: Write the failing unit tests** (append to `test_account_pool.py`, above the `if __name__` line)

```python
class SignIn(unittest.TestCase):
    def test_a_lane_whose_sign_in_broke_moves_and_the_folder_is_not_handed_out(self):
        accounts = [claude("support", weekly=0, signin_broken=True), claude("dev", weekly=50)]
        d, moves, _ = drivers(lanes("A", "B"), accounts, {"A": (f("support"), None)})
        self.assertEqual(d, {"A": f("dev"), "B": f("dev")})
        self.assertEqual(moves[0], ap.Move("A", "driver", "claude", f("support"), f("dev"), "sign-in broken"))

    def test_a_broken_sign_in_is_not_a_reset_to_wait_for(self):
        accounts = [claude("support", signin_broken=True, paused_until=at(15, 9)),
                    claude("dev", paused_until=at(16, 22))]
        self.assertEqual(ap.next_reset("claude", accounts, NOW, W, WE), at(16, 22))

    def test_a_pin_on_a_folder_whose_sign_in_broke_is_ignored(self):
        accounts = [claude("support", signin_broken=True), claude("dev")]
        d, moves, _ = drivers(lanes("A"), accounts, {"A": (f("dev"), None)}, {"A": f("support")})
        self.assertEqual((d["A"], moves), (f("dev"), []))

    def test_a_codex_seat_whose_sign_in_broke_moves(self):
        accounts = [claude("dev"), codex("dev"), codex("gmail", signin_broken=True)]
        result = decide(lanes("A"), accounts, {"A": (f("dev"), CX("gmail"))})
        self.assertEqual(result.moves, [ap.Move("A", "reviewer", "codex", CX("gmail"), CX("dev"), "sign-in broken")])

    def test_a_sign_in_move_reads_plainly(self):
        m = ap.Move("A", "driver", "claude", f("support"), f("dev"), "sign-in broken")
        self.assertEqual(ap.format_move(m, NOW, H), "ACCOUNTS: lane A claude → ~/.claude-dev (was ~/.claude-support, sign-in broken)")
```

- [ ] **Step 2: Write the failing program tests** (append to `assign-accounts.test.sh`, before the final `echo`)

Extend the file's `EXIT` trap so it also stops the lock holder below by its process id
(`holder=""` near the top; the trap becomes `trap '[ -n "$holder" ] && kill "$holder" 2>/dev/null; rm -rf "$tmp"' EXIT`).

```sh
# one picker at a time: a run that finds the lock held exits at once, silently, and changes nothing
fresh; run >/dev/null
mark "$HOME/.claude-dev" "2026-10-18 18:00"
python3 -c 'import fcntl, sys, time
f = open(sys.argv[1], "a"); fcntl.flock(f, fcntl.LOCK_EX); print("held", flush=True); time.sleep(60)' "$ACC/.lock" > "$tmp/holder.out" &
holder=$!
n=0; until [ -s "$tmp/holder.out" ] || [ $n -ge 100 ]; do sleep 0.1; n=$((n + 1)); done
[ -s "$tmp/holder.out" ] || fail "the test's lock holder started"
before=$(cat "$ACC/assignments")
out=$(run) || fail "a run that finds the lock held exits 0"
[ -z "$out" ] || fail "a run that finds the lock held prints nothing (got: $out)"
[ "$(cat "$ACC/assignments")" = "$before" ] || fail "a run that finds the lock held changes nothing"
kill "$holder"; wait "$holder" 2>/dev/null; holder=""
run | grep -q '^ACCOUNTS: lane A claude → ' || fail "once the lock is free the move happens"
python3 -c 'import fcntl, sys
f = open(sys.argv[1], "a"); fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)' "$ACC/.lock" || fail "a finished run leaves the lock free"

# a broken sign-in: the lane moves and starts, the watcher is told once how to sign it in again,
# and a new sign-in clears it
signin_mark() { # $1 folder $2 Madrid local time noticed $3 message: the marker runner-lib.sh writes
  printf '%s\n%s\n' "$(epoch "$2")" "$3" > "$SHARED/limits/$(account_name "$1").signin"
}
fresh; rm -f "$tmp/launchctl.calls"; run >/dev/null   # A on dev, B on support
signin_mark "$HOME/.claude-dev" "2026-10-14 09:50" "Not logged in · Please run /login"
mv "$tmp/usage/tokV.json" "$tmp/usage/tokV.json.away"   # a signed-out folder's usage read fails too
out=$(run_at 2026-10-14T10:11:00+02:00)                 # past the cache, so every account is read
echo "$out" | grep -qx 'ACCOUNTS: lane A claude → ~/.claude-support (was ~/.claude-dev, sign-in broken)' || fail "a lane on a broken sign-in moves (got: $out)"
echo "$out" | grep -qx 'SIGN-IN BROKEN: ~/.claude-dev (dev@waitron.io) — no lane is given it until it is signed in again: CLAUDE_CONFIG_DIR=~/.claude-dev claude, then /login (noticed Wed 14 Oct 09:50: Not logged in · Please run /login)' || fail "a broken sign-in is announced with its re-login command (got: $out)"
echo "$out" | grep -q 'usage for ~/.claude-dev unreadable' && fail "a broken sign-in is announced once, not also as unreadable usage (got: $out)"
[ "$(kicks)" = "kickstart gui/$(id -u)/com.waitron.campaign" ] || fail "a lane moved off a broken sign-in is started at once (got: $(kicks))"
out=$(run_at 2026-10-14T10:22:00+02:00)
[ -z "$out" ] || fail "a broken sign-in is announced once (got: $out)"
[ -e "$SHARED/limits/$(account_name "$HOME/.claude-dev").signin" ] || fail "an unchanged sign-in keeps its marker"
login "$HOME/.claude-dev" dev@waitron.io tokV2; cp "$tmp/usage/tokV.json.away" "$tmp/usage/tokV2.json"
out=$(run_at 2026-10-14T10:33:00+02:00)
echo "$out" | grep -qx 'ACCOUNTS: ~/.claude-dev is signed in again — it can be handed out' || fail "a new sign-in clears the marker (got: $out)"
[ -e "$SHARED/limits/$(account_name "$HOME/.claude-dev").signin" ] && fail "the cleared marker is removed"
mv "$tmp/usage/tokV.json.away" "$tmp/usage/tokV.json"; login "$HOME/.claude-dev" dev@waitron.io tokV

# a broken Codex sign-in names the Codex re-login command
fresh; run >/dev/null   # D on codex-dev
signin_mark "$HOME/.codex-dev" "2026-10-14 09:50" '{"type":"turn.failed","error":{"message":"workspace routing discovery unauthorized (401)"}}'
out=$(run)
echo "$out" | grep -qx 'ACCOUNTS: lane D codex → ~/.codex-gmail (was ~/.codex-dev, sign-in broken)' || fail "a Codex lane on a broken sign-in moves (got: $out)"
echo "$out" | grep -q '^SIGN-IN BROKEN: ~/.codex-dev (dev@waitron.io) — no lane is given it until it is signed in again: CODEX_HOME=~/.codex-dev codex login (noticed ' || fail "the Codex re-login command is named (got: $out)"
```

- [ ] **Step 3: Run both to watch them fail**

Run: `cd ~/workspace/tools/.worktrees/account-pool && python3 -m unittest test_account_pool -v; sh assign-accounts.test.sh`
Expected: the `SignIn` tests error with `TypeError: ... unexpected keyword argument 'signin_broken'`;
the shell test stops at `FAIL: a run that finds the lock held prints nothing`.

- [ ] **Step 4: Write the minimal implementation**

In `account_pool.py`:
- `Account` gains a last field `signin_broken: bool = False`.
- `qualifies`: return False when `a.signin_broken`, before anything else.
- `next_reset`: skip an account with `signin_broken` (it does not come back by itself).
- `decide_drivers`: the pin branch also requires `not by_folder[pin].signin_broken`; after the
  `not usable(old, ...)` branch add
  `elif by_folder[old].signin_broken: moving.append((lane, old, "sign-in broken", None))`, before the
  pause branch.
- `decide`: when a Claude lane's seat moves, the reason is `"paused"` when `end`, else `"sign-in broken"`
  when `seat is not None and seat.signin_broken`, else `"full"` as before, else `"not in the pool"`.
  `format_move` needs no change: its last branch prints `was <old>, sign-in broken`.

In `assign-accounts.py`:

```python
import fcntl
import hashlib


def take_lock(acc):
    """This run's hold on <acc>/.lock, True when there is no accounts folder (nothing to write), or
    None when another run holds it. Two runs at once (a manual run during the switch-over, two watcher
    sessions during a handover) would each rewrite the assignment file and could start a lane twice."""
    if not os.path.isdir(acc):
        return True
    f = open(os.path.join(acc, ".lock"), "a")
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        f.close()
        return None
    return f


def signin_path(ls, shared, folder):
    return os.path.join(shared, "limits", ls.account_name(folder) + ".signin")


def signin_marker(ls, shared, folder):
    """(epoch first noticed, message) from the runner's sign-in marker for this folder, or None."""
    try:
        epoch, message = read(signin_path(ls, shared, folder)).split("\n")[:2]
        return int(epoch), message
    except (AttributeError, ValueError):
        return None


def fingerprint(ls, engine, folder):
    if engine == "claude":
        record = ls.stored_credential(folder)
        raw = json.dumps(record, sort_keys=True) if record else ""
    else:
        raw = read(os.path.join(folder, "auth.json")) or ""
    return hashlib.sha256(raw.encode()).hexdigest()[:12] if raw else "none"
```

In `assign`, after the `if reread:` block (so `cache` holds every pool folder's last answer) and
before the accounts are built:

```python
    recorded = dict(state.get("signin", {}))
    broken = {}
    for engine, folder in pool:
        marker = signin_marker(ls, a.shared, folder)
        if marker is None:
            recorded.pop(folder, None)
            continue
        fp = fingerprint(ls, engine, folder)
        if folder in recorded and recorded[folder] != fp:
            # Signed in again since the marker was first seen: the marker is stale.
            if not a.dry_run:
                os.remove(signin_path(ls, a.shared, folder))
            recorded.pop(folder)
            said.lines.append("ACCOUNTS: %s is signed in again — it can be handed out" % ap.tilde(folder, HOME))
            continue
        recorded.setdefault(folder, fp)
        broken[folder] = marker
        email = cache["accounts"].get(folder, {}).get("email") or "account not known"
        command = ("CLAUDE_CONFIG_DIR=%s claude, then /login" if engine == "claude" else "CODEX_HOME=%s codex login") % ap.tilde(folder, HOME)
        noticed = ap.when(dt.datetime.fromtimestamp(marker[0], now.tzinfo))
        said.once("signin:" + folder,
                  "SIGN-IN BROKEN: %s (%s) — no lane is given it until it is signed in again: %s (noticed %s: %s)"
                  % (ap.tilde(folder, HOME), email, command, noticed, marker[1]),
                  str(marker[0]))
```

Build each account with `signin_broken=folder in broken`, skip the "usage … unreadable" line for a
folder in `broken`, return `recorded` in the result, and in `run` save it as `new_state["signin"]`
(not on a dry run). Kick a lane moved for
`"sign-in broken"` as for `"paused"` (change `kick`'s reason test to `m.reason not in ("paused", "sign-in broken")`).

In `main`, inside the `try` and after `a` is parsed: `lock = take_lock(os.path.join(a.shared, "accounts")) if not a.dry_run else True`;
`if lock is None: return` (silently, status 0); keep `lock` referenced until `run` returns.

In `README.md`'s picker section, add: "Only one run works at a time; a run that finds another holding
`accounts/.lock` exits silently. A folder a runner marked as signed out (`limits/<folder>.signin`) is
never handed out; the picker names the command that signs it in again, and clears the marker itself
once the folder's stored sign-in changes."

- [ ] **Step 5: Run everything to watch it pass**

Run: `cd ~/workspace/tools/.worktrees/account-pool && python3 -m unittest test_account_pool -v && sh assign-accounts.test.sh && sh lane-status.test.sh && sh codex-quota.test.sh`
Expected: `OK` (44 tests), then each suite's pass line.

- [ ] **Step 6: Prove three checks by deletion**

Replace the `fcntl.flock(...)` line with `pass` and confirm `FAIL: a run that finds the lock held prints
nothing`. Delete the `signin_broken` test from `qualifies` and confirm
`test_a_lane_whose_sign_in_broke_moves_and_the_folder_is_not_handed_out` fails because lane B was given
`~/.claude-support`. Delete the fingerprint comparison (`recorded[folder] != fp`, so the branch never
runs) and confirm `FAIL: a new sign-in clears the marker`. Restore all three and rerun to green.

- [ ] **Step 7: Commit**

```bash
cd ~/workspace/tools/.worktrees/account-pool
git add account_pool.py test_account_pool.py assign-accounts.py assign-accounts.test.sh README.md
git commit -s -m "assign-accounts: one run at a time, and move lanes off a broken sign-in

Two runs of the picker at once could each rewrite the assignment file and start a lane twice, so a
run now takes a lock and a run that finds it held exits silently. A folder the runner marked as
signed out is treated like a paused account that never resumes: its lanes move, it is not handed
out, and the picker says once which command signs it in again. It clears the marker itself once
the folder's stored sign-in changes."
```

**Done when:** all four suites pass, the three deletion checks failed for the stated reason before
being restored, and the commit exists.

---

## Task 5: The runners read the assignment file

**Work in:** a staging folder. `~/waitron-campaign-shared` is not in git, and the five live runners
source `runner-lib.sh` at every firing (every 30 minutes, sometimes more often when a firing chains), so
nothing is edited in place: the staged files are installed with a rename at the end. No `run.sh` changes.

```bash
STAGE=~/waitron-account-pool-staging
mkdir -p "$STAGE/tests" "$STAGE/base"
cp ~/waitron-campaign-shared/runner-lib.sh "$STAGE/base/runner-lib.sh"
cp ~/waitron-campaign-shared/tests/runner.test.sh "$STAGE/base/runner.test.sh"
cp "$STAGE/base/runner-lib.sh" "$STAGE/runner-lib.sh"
cp "$STAGE/base/runner.test.sh" "$STAGE/tests/runner.test.sh"
```

The test file finds the library beside its own folder (`SHARED_SRC`), so the staged test runs the
staged library against the five live `run.sh` files, with fake `claude`, `codex` and `docker`.

**Files:**
- Modify: `$STAGE/runner-lib.sh:15-27` (account settings become a function), `:31-55` (`lane_settings_ok`)
- Modify: `$STAGE/tests/runner.test.sh` (`fire()`, new cases inside the per-lane loop, a unit section at the end)
- Install over: `~/waitron-campaign-shared/runner-lib.sh`, `~/waitron-campaign-shared/tests/runner.test.sh`

**Interfaces:**
- Consumes: the assignment file format of Task 3 (a `#` header, then `<lane> <driver> <reviewer>`).
- Produces: `set_accounts <claude folder> <codex folder>`, `lane_letter <campaign folder>`,
  `use_assigned_accounts`, variables `LANE_LETTER`, `ASSIGNMENTS`, `RUNSH_CLAUDE_ACCOUNT`,
  `RUNSH_CODEX_ACCOUNT`. Log lines, which Task 8 greps for:
  `Accounts: driver <folder>, reviewer <folder> (from <file>).` and
  `Accounts: <why> — using run.sh's folders.`

- [ ] **Step 1: Write the failing tests**

In `$STAGE/tests/runner.test.sh`, in `fire()`, add `RUNNER_LANE="${LN:-}" \` to the environment lines,
and in its comment add "LN sets the lane letter".

Inside the per-lane loop, after the `ENG=gemini` case and before `done`, add:

```bash
  # ── account assignment: the picker's file, read at the start of every firing ──
  assign() { mkdir -p "$SB/shared/accounts"; printf '%s\n' "$@" > "$SB/shared/accounts/assignments"; }

  sandbox
  mkdir -p "$SB/claude-2" "$SB/codex-2"
  assign "# written by the picker" "A $SB/claude-2 $SB/codex-2"
  LN=A fire "$RUN"
  eq "$lane: a Claude lane's driver comes from its assignment line" "$(sed -n 1p "$SB/claude.env" 2>/dev/null)" "$SB/claude-2"
  eq "$lane: its Codex reviewer seat comes from the same line" "$(sed -n 2p "$SB/claude.env" 2>/dev/null)" "$SB/codex-2"
  if inlogs "Accounts: driver $SB/claude-2, reviewer $SB/codex-2 (from $SB/shared/accounts/assignments)."; then ok "$lane: the firing log names the assigned folders"
  else bad "$lane: the firing log names the assigned folders"; fi
  rm -rf "$SB"

  sandbox
  mkdir -p "$SB/claude-2" "$SB/codex-2"
  assign "A $SB/codex-2 $SB/claude-2"
  ENG=codex LN=A fire "$RUN"
  eq "$lane: a Codex lane's driver comes from its assignment line" "$(sed -n 2p "$SB/codex.env" 2>/dev/null)" "$SB/codex-2"
  eq "$lane: a Codex lane's Claude reviewer seat comes from the same line" "$(sed -n 1p "$SB/codex.env" 2>/dev/null)" "$SB/claude-2"
  rm -rf "$SB"

  sandbox
  LN=A fire "$RUN"
  eq "$lane: with no assignment file the lane keeps run.sh's folders" "$(sed -n 1p "$SB/claude.env" 2>/dev/null)" "$SB/claude-acct"
  if inlogs "Accounts: no assignment file at $SB/shared/accounts/assignments — using run.sh's folders."; then ok "$lane: the log says there is no assignment file"
  else bad "$lane: the log says there is no assignment file"; fi
  rm -rf "$SB"

  sandbox
  mkdir -p "$SB/claude-2" "$SB/codex-2"
  assign "B $SB/claude-2 $SB/codex-2"
  LN=A fire "$RUN"
  eq "$lane: another lane's line is not used" "$(sed -n 1p "$SB/claude.env" 2>/dev/null)" "$SB/claude-acct"
  if inlogs "Accounts: no line for lane A in "; then ok "$lane: the log says the lane has no line"
  else bad "$lane: the log says the lane has no line"; fi
  rm -rf "$SB"

  sandbox
  mkdir -p "$SB/codex-2"
  assign "A $SB/no-such-folder $SB/codex-2"
  LN=A fire "$RUN"
  eq "$lane: a line naming a missing folder is not used" "$(sed -n 1p "$SB/claude.env" 2>/dev/null)" "$SB/claude-acct"
  if inlogs "names $SB/no-such-folder, which does not exist"; then ok "$lane: the log names the missing folder"
  else bad "$lane: the log names the missing folder"; fi
  eq "$lane: falling back to run.sh's folders alerts nobody" "$(notices)" "0"
  rm -rf "$SB"

  sandbox
  mkdir -p "$SB/codex-2"
  assign "A ~/.claude-dev $SB/codex-2"
  LN=A fire "$RUN"
  eq "$lane: a line with a ~ path is not used" "$(sed -n 1p "$SB/claude.env" 2>/dev/null)" "$SB/claude-acct"
  if inlogs "which is not an absolute path"; then ok "$lane: the log says the path is not absolute"
  else bad "$lane: the log says the path is not absolute"; fi
  rm -rf "$SB"

  sandbox
  mkdir -p "$SB/claude-2"
  assign "A $SB/claude-2"
  LN=A fire "$RUN"
  eq "$lane: a line with two fields is not used" "$(sed -n 1p "$SB/claude.env" 2>/dev/null)" "$SB/claude-acct"
  if inlogs "is not 'lane driver reviewer'"; then ok "$lane: the log says the line is malformed"
  else bad "$lane: the log says the line is malformed"; fi
  rm -rf "$SB"

  sandbox
  mkdir -p "$SB/claude-2" "$SB/codex-2"
  assign "A $SB/claude-2 $SB/codex-2"
  printf '%s\n%s\n' $(( $(date +%s) + 3600 )) "paused" > "$(mark "$SB/claude-2")"
  LN=A fire "$RUN"
  eq "$lane: a pause on the assigned folder stops the firing (the line is read before the pause check)" "$(calls)" "0"
  rm -rf "$SB"

  sandbox
  mkdir -p "$SB/claude-2" "$SB/codex-2"
  assign "A $SB/claude-2 $SB/codex-2"
  printf '%s\n%s\n' $(( $(date +%s) + 3600 )) "paused" > "$(mark "$SB/claude-acct")"
  LN=A fire "$RUN"
  eq "$lane: a pause on run.sh's folder does not stop a lane assigned elsewhere" "$(calls)" "1"
  rm -rf "$SB"

  sandbox
  mkdir -p "$SB/claude-2" "$SB/codex-2"
  assign "A $SB/claude-2 $SB/codex-2"
  RESET_DAY=$(LC_ALL=C date -v+2d '+%b %-d')
  echo "1|You've hit your weekly limit · resets $RESET_DAY at 1am (Europe/Madrid)" > "$SB/claude.script"
  LN=A fire "$RUN"
  if [ -f "$(mark "$SB/claude-2")" ] && [ ! -f "$(mark "$SB/claude-acct")" ]; then ok "$lane: a usage-limit refusal pauses the assigned folder, not run.sh's"
  else bad "$lane: a usage-limit refusal pauses the assigned folder, not run.sh's"; fi
  rm -rf "$SB"

  sandbox
  git -C "$SB/repo" worktree add -q -b feat/owned "$SB/owned"
  echo '### A1. Active item — `in-progress` — branch `feat/owned`' > "$SB/camp/queue.md"
  mkdir -p "$SB/claude-2" "$SB/claude-3" "$SB/codex-2"
  assign "A $SB/claude-2 $SB/codex-2"
  printf '%s\n' "0|committed|fake_owned_commit; echo 'A $SB/claude-3 $SB/codex-2' > '$SB/shared/accounts/assignments'" "0|nothing to do" > "$SB/claude.script"
  LN=A fire "$RUN"
  eq "$lane: a chained firing reads the assignment file again" "$(calls) $(sed -n 1p "$SB/claude.env" 2>/dev/null)" "2 $SB/claude-3"
  rm -rf "$SB"
```

After the reset-time section (after its `rm -rf "$SHARED"`) and before the final summary, add:

```bash
echo "== account assignment, sourced"
SB=$(mktemp -d "${TMPDIR:-/tmp}/runner-test.XXXXXX")
mkdir -p "$SB/shared/accounts" "$SB/c1" "$SB/x1" "$SB/c2" "$SB/x2"
SHARED="$SB/shared"; LOG="$SB/log"; ENGINE=claude
CAMP=/Users/x/waitron-campaign-c CLAUDE_ACCOUNT="$SB/c1" CODEX_ACCOUNT="$SB/x1"
# shellcheck source=/dev/null
. "$SHARED_SRC/runner-lib.sh"
eq "lane A's campaign folder gives the letter A" "$(lane_letter /Users/x/waitron-campaign)" "A"
eq "a lettered campaign folder gives its letter" "$(lane_letter /Users/x/waitron-campaign-c)" "C"
eq "any other folder gives no letter" "$(lane_letter /tmp/camp)" ""
eq "the letter comes from CAMP when RUNNER_LANE is unset" "$LANE_LETTER" "C"
echo "C $SB/c2 $SB/x2" > "$SHARED/accounts/assignments"
use_assigned_accounts
eq "an assignment sets the Claude folder" "$CLAUDE_ACCOUNT" "$SB/c2"
eq "an assignment moves the pause marker with it" "$LIMIT_MARKER" "$SHARED/limits/$(acct "$SB/c2").until"
eq "an assignment moves the transcript folder with it" "$CLAUDE_PROJECTS" "$SB/c2/projects"
rm "$SHARED/accounts/assignments"
use_assigned_accounts
eq "a later firing without the file goes back to run.sh's Claude folder" "$CLAUDE_ACCOUNT" "$SB/c1"
eq "and to run.sh's pause marker" "$LIMIT_MARKER" "$SHARED/limits/$(acct "$SB/c1").until"
RUNNER_LANE=B
. "$SHARED_SRC/runner-lib.sh"
eq "RUNNER_LANE overrides the folder's letter" "$LANE_LETTER" "B"
unset RUNNER_LANE
rm -rf "$SB"
```

- [ ] **Step 2: Run against one lane to watch them fail**

Run: `RUNNER_TEST_LANES=/Users/clintongormley/waitron-campaign/run.sh bash ~/waitron-account-pool-staging/tests/runner.test.sh 2>&1 | tail -40`
Expected: the new per-lane cases print `FAIL` (for example `FAIL waitron-campaign: a Claude lane's
driver comes from its assignment line`); the sourced section prints `lane_letter: command not found`
and then stops at `LANE_LETTER: unbound variable` (the test runs under `set -u`), so no summary line
appears. Every case that existed before still prints `ok`. (Checked while writing this plan: that is
what the unchanged library gives, and the changed one gives `127 passed, 0 failed` for lane A in about
two minutes.)

- [ ] **Step 3: Write the minimal implementation** in `$STAGE/runner-lib.sh`

Replace lines 16–27 (from `CLAUDE_ACCOUNT="${CLAUDE_ACCOUNT:-$HOME/.claude}"` through the
`LIMIT_ALERTED=` line) with:

```bash
RETRIES=5
account_name() { echo "$1" | sed 's|[/.]|-|g'; }

# set_accounts <claude folder> <codex folder>: the lane's two login folders and every name derived
# from them. A trailing slash must not name a second account (a separate pause file, or for Claude a
# separate stored login).
set_accounts() {
  CLAUDE_ACCOUNT="${1%/}"
  CODEX_ACCOUNT="${2%/}"
  CLAUDE_PROJECTS="$CLAUDE_ACCOUNT/projects"
  CODEX_SESSIONS="$CODEX_ACCOUNT/sessions"
  case "$ENGINE" in codex) DRIVER_ACCOUNT=$CODEX_ACCOUNT ;; *) DRIVER_ACCOUNT=$CLAUDE_ACCOUNT ;; esac
  LIMIT_MARKER="$SHARED/limits/$(account_name "$DRIVER_ACCOUNT").until"     # line 1: epoch the pause ends; line 2: the message
  LIMIT_ALERTED="$SHARED/limits/$(account_name "$DRIVER_ACCOUNT").alerted"  # the last message the owner was alerted about
}
set_accounts "${CLAUDE_ACCOUNT:-$HOME/.claude}" "${CODEX_ACCOUNT:-$HOME/.codex}"
RUNSH_CLAUDE_ACCOUNT=$CLAUDE_ACCOUNT
RUNSH_CODEX_ACCOUNT=$CODEX_ACCOUNT

# lane_letter <campaign folder>: A for ~/waitron-campaign, X for ~/waitron-campaign-x, else nothing.
lane_letter() {
  case "${1##*/}" in
    waitron-campaign) echo A ;;
    waitron-campaign-?) echo "${1##*-}" | tr '[:lower:]' '[:upper:]' ;;
  esac
}
LANE_LETTER="${RUNNER_LANE:-$(lane_letter "${CAMP-}")}"
ASSIGNMENTS="$SHARED/accounts/assignments"

# use_assigned_accounts: the lane's folders for this firing, from the line the account picker
# (~/workspace/tools/assign-accounts.py) wrote for it. Anything wrong with that line keeps run.sh's
# own folders, so a bad file can never put a lane on a folder nobody signed in. One line to $LOG
# either way.
use_assigned_accounts() {
  local line driver reviewer extra d why=""
  if [ -z "$LANE_LETTER" ]; then
    why="this lane has no letter"
  elif [ ! -f "$ASSIGNMENTS" ]; then
    why="no assignment file at $ASSIGNMENTS"
  else
    line=$(awk -v l="$LANE_LETTER" '$1 == l { print; exit }' "$ASSIGNMENTS" 2>/dev/null)
    if [ -z "$line" ]; then
      why="no line for lane $LANE_LETTER in $ASSIGNMENTS"
    else
      read -r _ driver reviewer extra <<< "$line"
      if [ -z "$reviewer" ] || [ -n "$extra" ]; then
        why="the line for lane $LANE_LETTER is not 'lane driver reviewer': $line"
      else
        for d in "$driver" "$reviewer"; do
          case "$d" in /*) ;; *) why="the line for lane $LANE_LETTER names $d, which is not an absolute path"; break ;; esac
          [ -d "$d" ] || { why="the line for lane $LANE_LETTER names $d, which does not exist"; break; }
        done
      fi
    fi
  fi
  if [ -n "$why" ]; then
    set_accounts "$RUNSH_CLAUDE_ACCOUNT" "$RUNSH_CODEX_ACCOUNT"
    echo "Accounts: $why — using run.sh's folders." >> "$LOG"
    return 0
  fi
  if [ "$ENGINE" = codex ]; then set_accounts "$reviewer" "$driver"; else set_accounts "$driver" "$reviewer"; fi
  echo "Accounts: driver $driver, reviewer $reviewer (from $ASSIGNMENTS)." >> "$LOG"
}
```

Keep `RETRIES=5` and `account_name` only once (they move into this block from lines 23–24). Then in
`lane_settings_ok`, make `use_assigned_accounts` the first command after `local d msg=""`, and change its
header comment to:

```bash
# lane_settings_ok: takes this firing's login folders from the assignment file (use_assigned_accounts),
# then is true when ENGINE names a known engine and both folders exist. A missing folder skips the
# firing rather than falling back to the default login, so a typo cannot put a lane on the wrong account.
```

- [ ] **Step 4: Run against one lane to watch them pass**

Run: `RUNNER_TEST_LANES=/Users/clintongormley/waitron-campaign/run.sh bash ~/waitron-account-pool-staging/tests/runner.test.sh 2>&1 | tail -5`
Expected: last line `<n> passed, 0 failed`.

- [ ] **Step 5: Prove a case by deletion**

Delete the `[ -d "$d" ] || { ... }` line, rerun the one-lane command and confirm
`FAIL waitron-campaign: a line naming a missing folder is not used`. Restore and rerun to green.

- [ ] **Step 6: Run the whole suite against all five lanes**

It takes about ten minutes (one lane took 2 min 13 s; the watchdog cases wait on purpose), so run it
in the background:

```bash
gtimeout 2400 bash ~/waitron-account-pool-staging/tests/runner.test.sh > ~/waitron-account-pool-staging/full.out 2>&1; echo "exit $?" >> ~/waitron-account-pool-staging/full.out
```

Then `tail -3 ~/waitron-account-pool-staging/full.out`. Expected: `<n> passed, 0 failed` and `exit 0`.
An `exit 124` means `gtimeout` stopped it; report that rather than calling the suite green.

- [ ] **Step 7: Install atomically**

```bash
STAGE=~/waitron-account-pool-staging
L=~/waitron-campaign-shared
cmp -s "$L/runner-lib.sh" "$STAGE/base/runner-lib.sh" && cmp -s "$L/tests/runner.test.sh" "$STAGE/base/runner.test.sh" \
  || { echo "the live files changed since staging: stop, and fold that change in first"; exit 1; }
bash -n "$STAGE/runner-lib.sh" && bash -n "$STAGE/tests/runner.test.sh" \
  && mkdir -p "$L/backups/2026-10-12-account-pool" \
  && cp "$STAGE/base/runner-lib.sh" "$L/backups/2026-10-12-account-pool/runner-lib.sh.before-account-pool" \
  && cp "$STAGE/base/runner.test.sh" "$L/backups/2026-10-12-account-pool/runner.test.sh.before-account-pool" \
  && cp "$STAGE/runner-lib.sh" "$L/.runner-lib.sh.new" && mv -f "$L/.runner-lib.sh.new" "$L/runner-lib.sh" \
  && cp "$STAGE/tests/runner.test.sh" "$L/tests/.runner.test.sh.new" && mv -f "$L/tests/.runner.test.sh.new" "$L/tests/runner.test.sh" \
  && cmp "$STAGE/runner-lib.sh" "$L/runner-lib.sh" && echo installed
```

Expected: `installed`. Until Task 8 writes the assignment file, every firing logs
`Accounts: no assignment file at ... — using run.sh's folders.` and otherwise behaves exactly as
before. To roll back: `cp ~/waitron-campaign-shared/backups/2026-10-12-account-pool/runner-lib.sh.before-account-pool ~/waitron-campaign-shared/.runner-lib.sh.new && mv -f ~/waitron-campaign-shared/.runner-lib.sh.new ~/waitron-campaign-shared/runner-lib.sh`.

There is no commit: `~/waitron-campaign-shared` is not in git. Leave `$STAGE` in place for the reviewer.

**Done when:** the full five-lane suite printed `0 failed` and `exit 0`, the deletion check failed for
the stated reason before being restored, and both files are installed (the `cmp` printed nothing and
`installed` was printed).

---

## Task 5b: The runners mark a broken sign-in

**Work in:** a fresh staging folder, made from the files Task 5 installed:

```bash
STAGE=~/waitron-account-pool-staging/5b
mkdir -p "$STAGE/tests" "$STAGE/base"
cp ~/waitron-campaign-shared/runner-lib.sh "$STAGE/base/runner-lib.sh"
cp ~/waitron-campaign-shared/tests/runner.test.sh "$STAGE/base/runner.test.sh"
cp "$STAGE/base/runner-lib.sh" "$STAGE/runner-lib.sh"
cp "$STAGE/base/runner.test.sh" "$STAGE/tests/runner.test.sh"
```

**Why:** a sign-in that stops working (expired with no refresh, or revoked by a security change on the
account) fails every firing of every lane on that folder, silently, until someone reads a run log. See
Decisions, "A broken sign-in is caught by the runner", for the measured message shapes.

**Files:**
- Modify: `$STAGE/runner-lib.sh` (a new `note_signin`, called first from `note_usage_limit`, which every
  `run.sh` already calls after each firing, so no `run.sh` changes)
- Modify: `$STAGE/tests/runner.test.sh` (new cases inside the per-lane loop)
- Install over: `~/waitron-campaign-shared/runner-lib.sh`, `~/waitron-campaign-shared/tests/runner.test.sh`

**Interfaces:**
- Consumes: `LOG`, `ENGINE`, `DRIVER_ACCOUNT`, `SHARED`, `CAMP`, `account_name`, `runner_now`.
- Produces: `note_signin <log> <exit status>`; variable `SIGNIN_MARKER`
  (`$SHARED/limits/<account_name of the driver folder>.signin`, set by `set_accounts` beside
  `LIMIT_MARKER`); the marker (line 1 epoch first noticed, line 2 the matching line, cut to 300
  characters); the run-log line `=== sign-in broken for <folder>: <message> ===`; a `progress.log` line
  `<date> — sign-in broken on <folder>: <message>` (the watcher relays progress lines).

Rules, in order:
1. Exit status 0: remove `SIGNIN_MARKER` if present (a clean firing proves the sign-in works) and stop.
2. Find the first sign-in failure in `<log>`:
   - Claude: a line matching `^(Not logged in|Invalid API key|API Error: 401|OAuth token has expired)`
     or containing `Please run /login`. Only `Not logged in · Please run /login` is measured.
   - Codex: a line starting `{"type":"turn.failed"` that contains `401` or `nauthorized`, or a line
     starting with an ISO timestamp followed by ` ERROR ` that contains `token_revoked` or
     `refresh_token_invalidated`. Tool output never starts a line, so it cannot match.
3. None found: stop. Found: append the run-log line; if `SIGNIN_MARKER` already exists, stop (it keeps
   the time first noticed, so the picker announces it once); otherwise write the marker and the
   `progress.log` line. Never write the usage-limit marker and never call `notify`: the owner is away,
   and the watcher's phone message is the channel.

- [ ] **Step 1: Write the failing tests**

Inside the per-lane loop, after the account-assignment cases Task 5 added and before `done`, add:

```bash
  # ── a broken sign-in is marked for the picker ──
  signin() { mkdir -p "$SB/shared/limits"; echo "$SB/shared/limits/$(acct "$1").signin"; }

  sandbox
  echo "1|Not logged in · Please run /login" > "$SB/claude.script"
  fire "$RUN"
  eq "$lane: a Claude firing refused for its sign-in marks the folder" "$(sed -n 2p "$(signin "$SB/claude-acct")" 2>/dev/null)" "Not logged in · Please run /login"
  if inlogs "=== sign-in broken for $SB/claude-acct: Not logged in · Please run /login ==="; then ok "$lane: the firing log says the sign-in is broken"
  else bad "$lane: the firing log says the sign-in is broken"; fi
  if [ -e "$(mark "$SB/claude-acct")" ]; then bad "$lane: a broken sign-in is not a usage-limit pause"
  else ok "$lane: a broken sign-in is not a usage-limit pause"; fi
  eq "$lane: a broken sign-in sends no Mac notification" "$(notices)" "0"
  if grep -q "sign-in broken on $SB/claude-acct" "$SB/camp/progress.log" 2>/dev/null; then ok "$lane: a broken sign-in is written to the progress log"
  else bad "$lane: a broken sign-in is written to the progress log"; fi
  rm -rf "$SB"

  sandbox
  echo '1|API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}' > "$SB/claude.script"   # shape inferred, not measured
  fire "$RUN"
  if [ -s "$(signin "$SB/claude-acct")" ]; then ok "$lane: an API 401 marks the folder"
  else bad "$lane: an API 401 marks the folder"; fi
  rm -rf "$SB"

  sandbox
  echo "1|The refund route answers 401 Unauthorized when the session is gone; tests updated." > "$SB/claude.script"
  fire "$RUN"
  if [ -e "$(signin "$SB/claude-acct")" ]; then bad "$lane: a failed firing that mentions 401 in its prose is not a broken sign-in"
  else ok "$lane: a failed firing that mentions 401 in its prose is not a broken sign-in"; fi
  rm -rf "$SB"

  sandbox
  printf '%s\n%s\n' 1 "Not logged in · Please run /login" > "$(signin "$SB/claude-acct")"
  fire "$RUN"
  if [ -e "$(signin "$SB/claude-acct")" ]; then bad "$lane: a clean firing clears the folder's sign-in marker"
  else ok "$lane: a clean firing clears the folder's sign-in marker"; fi
  rm -rf "$SB"

  sandbox
  printf '%s\n%s\n' 1 "first" > "$(signin "$SB/claude-acct")"
  echo "1|Not logged in · Please run /login" > "$SB/claude.script"
  fire "$RUN"
  eq "$lane: an existing marker keeps the time it was first noticed" "$(head -1 "$(signin "$SB/claude-acct")")" "1"
  rm -rf "$SB"

  sandbox
  mkdir -p "$SB/claude-2" "$SB/codex-2"
  assign "A $SB/claude-2 $SB/codex-2"
  echo "1|Not logged in · Please run /login" > "$SB/claude.script"
  LN=A fire "$RUN"
  if [ -s "$(signin "$SB/claude-2")" ] && [ ! -e "$(signin "$SB/claude-acct")" ]; then ok "$lane: the assigned folder is marked, not run.sh's"
  else bad "$lane: the assigned folder is marked, not run.sh's"; fi
  rm -rf "$SB"

  sandbox
  printf '%s\n' '1|{"type":"turn.failed","error":{"message":"workspace routing discovery unauthorized (401)"}}' > "$SB/codex.script"
  ENG=codex fire "$RUN"
  if [ -s "$(signin "$SB/codex-acct")" ] && [ ! -e "$(signin "$SB/claude-acct")" ]; then ok "$lane: a Codex turn refused with 401 marks the Codex folder"
  else bad "$lane: a Codex turn refused with 401 marks the Codex folder"; fi
  rm -rf "$SB"

  sandbox
  printf '%s\n' '1|2026-10-12T10:40:51.621686Z ERROR codex_login::auth::manager: Failed to refresh token status=401 Unauthorized detail=TokenErrorDetail { error_code: Some("refresh_token_invalidated") }' > "$SB/codex.script"
  ENG=codex fire "$RUN"
  if [ -s "$(signin "$SB/codex-acct")" ]; then ok "$lane: a revoked Codex sign-in marks the Codex folder"
  else bad "$lane: a revoked Codex sign-in marks the Codex folder"; fi
  rm -rf "$SB"

  sandbox
  printf '%s\n' '1|{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"{\"type\":\"turn.failed\",\"error\":{\"message\":\"401\"}}"}}' > "$SB/codex.script"
  ENG=codex fire "$RUN"
  if [ -e "$(signin "$SB/codex-acct")" ]; then bad "$lane: a 401 inside a Codex tool's output is not a broken sign-in"
  else ok "$lane: a 401 inside a Codex tool's output is not a broken sign-in"; fi
  rm -rf "$SB"
```

The `assign` helper is the one Task 5 defined in the same loop.

- [ ] **Step 2: Run against one lane to watch them fail**

Run: `RUNNER_TEST_LANES=/Users/clintongormley/waitron-campaign/run.sh bash ~/waitron-account-pool-staging/5b/tests/runner.test.sh 2>&1 | tail -30`
Expected: every case that expects a marker to be written, and "a clean firing clears the folder's
sign-in marker", print `FAIL`. The three "is not a broken sign-in" cases and "an existing marker keeps
the time it was first noticed" already pass, because nothing writes a marker yet: they are the controls,
and they must still pass after Step 3. Every earlier case still prints `ok`.

- [ ] **Step 3: Write the minimal implementation** in `$STAGE/runner-lib.sh`

In `set_accounts`, after the `LIMIT_ALERTED=` line, add
`SIGNIN_MARKER="$SHARED/limits/$(account_name "$DRIVER_ACCOUNT").signin"  # line 1: epoch first noticed; line 2: the message`.
Add before `note_usage_limit`:

```bash
# note_signin <log> <exit status>: a firing that failed because its driver's sign-in no longer works
# marks the folder for the account picker, which moves the lane and tells the watcher. A clean firing
# clears the mark. Never the usage-limit marker, and no Mac notification: the watcher tells the owner.
note_signin() {
  local line
  if [ "${2:-1}" -eq 0 ]; then rm -f "$SIGNIN_MARKER"; return 0; fi
  if [ "$ENGINE" = codex ]; then
    line=$(grep -E '^\{"type":"turn\.failed".*(401|nauthorized)|^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z ERROR .*(token_revoked|refresh_token_invalidated)' "$1" | head -1)
  else
    line=$(grep -E '^(Not logged in|Invalid API key|API Error: 401|OAuth token has expired)|Please run /login' "$1" | head -1)
  fi
  [ -z "$line" ] && return 0
  line=$(printf '%s' "$line" | cut -c1-300)
  echo "=== sign-in broken for $DRIVER_ACCOUNT: $line ===" >> "$1"
  [ -e "$SIGNIN_MARKER" ] && return 0
  mkdir -p "$SHARED/limits"
  printf '%s\n%s\n' "$(runner_now)" "$line" > "$SIGNIN_MARKER"
  echo "$(date '+%Y-%m-%d %H:%M') — sign-in broken on $DRIVER_ACCOUNT: $line" >> "$CAMP/progress.log"
}
```

and make `note_signin "$1" "${2:-1}"` the first command of `note_usage_limit` (after its `local` line).

- [ ] **Step 4: Run against one lane to watch them pass**

Same command as Step 2. Expected: last line `<n> passed, 0 failed`.

- [ ] **Step 5: Prove a case by deletion**

Remove `^\{"type":"turn\.failed"` from the Codex pattern (leaving `.*(401|nauthorized)` unanchored), rerun,
and confirm `FAIL waitron-campaign: a 401 inside a Codex tool's output is not a broken sign-in`.
Restore and rerun to green.

- [ ] **Step 6: Run the whole suite against all five lanes**, as Task 5 step 6 but with the `5b` paths:

```bash
gtimeout 2400 bash ~/waitron-account-pool-staging/5b/tests/runner.test.sh > ~/waitron-account-pool-staging/5b/full.out 2>&1; echo "exit $?" >> ~/waitron-account-pool-staging/5b/full.out
```

Expected: `<n> passed, 0 failed` and `exit 0`.

- [ ] **Step 7: Install atomically**, exactly as Task 5 step 7 with `STAGE=~/waitron-account-pool-staging/5b`
  and the backup copies named `runner-lib.sh.before-signin-marker` and
  `runner.test.sh.before-signin-marker`. Expected: `installed`. Rollback goes back to Task 5's
  version, the `.before-signin-marker` copy.

**Done when:** the full five-lane suite printed `0 failed` and `exit 0`, the deletion check failed for
the stated reason before being restored, and both files are installed.

---

## Task 6: lane-status shows assigned folders and the whole pool

**Work in:** `~/workspace/tools/.worktrees/account-pool`.

**Files:**
- Modify: `lane-status.py` (import `account_pool`; `lane_accounts`; `login_of` and `usage_details`
  shared by lanes and accounts; the pool section; `--watcher`; `when` in local time)
- Modify: `lane-status.test.sh` (append before the final `echo`)
- Modify: `README.md` (the `lane-status.py` paragraph)
- Modify: `docs/campaign-runner.md` (the lane table, "How a firing runs", step 2 of "Setting up a new
  lane", "Engines and logins")
- Modify, outside this repository: `~/.claude/commands/lane-status.md`

**Interfaces:**
- Consumes: `account_pool.parse_assignments`, `account_pool.parse_pool`; the assignment and pool files.
- Produces: `lane_accounts(name, lane_dir, shared) -> (engine, claude_folder, codex_folder, note)`; the
  report's `Account  <engine>  <folder>  <email>  <roles>` blocks.

- [ ] **Step 1: Write the failing tests** (append to `lane-status.test.sh` before the final `echo`)

```sh
# the assignment file decides a lane's folders, as the runners read it
: > "$LANE_STATUS_PS"
rm -f "$SHARED"/limits/*.until
mkdir -p "$SHARED/accounts"
login "$HOME/.claude-pool1" pool1@example.com tokP1
usage tokP1 10 2026-09-25T13:00:00+00:00 20 2026-09-28T23:00:00+00:00
printf '# header\nA %s %s\n' "$HOME/.claude-pool1" "$HOME/.codex-lane-d" > "$SHARED/accounts/assignments"
out=$(run --lane "A=$tmp/camp-a" --lane "B=$tmp/camp-b")
echo "$out" | grep -q '^Lane A  claude  [a-z]* *~/.claude-pool1  pool1@example.com$' || fail "a lane's driver comes from its assignment line (got: $(echo "$out" | grep '^Lane A'))"
echo "$out" | grep -q '^Lane B  claude  idle  ~/.claude-lane-b  dev@example.com  (run.sh folders: no line for lane B)$' || fail "a lane with no line shows run.sh's folder and why (got: $(echo "$out" | grep '^Lane B'))"
printf 'A %s %s\n' "$HOME/.claude-missing" "$HOME/.codex-lane-d" > "$SHARED/accounts/assignments"
run --lane "A=$tmp/camp-a" | grep -q '^Lane A  claude  .*~/.claude-lane-a  .*(run.sh folders: ~/.claude-missing does not exist)$' || fail "a line naming a missing folder falls back as the runner does"

# the pool section: every pool account, its usage and pause, which lanes use it, and the watcher's
printf 'A %s %s\n' "$HOME/.claude-pool1" "$HOME/.codex-lane-d" > "$SHARED/accounts/assignments"
login "$HOME/.claude-waitron" watcher@example.com tokW
usage tokW 5 2026-09-25T13:00:00+00:00 7 2026-09-28T23:00:00+00:00
printf 'claude ~/.claude-pool1\nclaude %s\ncodex ~/.codex-lane-d\n' "$HOME/.claude-pool2" > "$SHARED/accounts/pool"
printf '%s\n%s\n' "$(( NOW_EPOCH + 1320 ))" "You've hit your session limit · resets 3pm (Europe/Madrid)" > "$SHARED/limits/$(account_name "$HOME/.claude-pool1").until"
out=$(run --lane "A=$tmp/camp-a")
echo "$out" > "$tmp/out.txt"
grep -q '^Account  claude  ~/.claude-pool1  pool1@example.com  drives A$' "$tmp/out.txt" || fail "a pool account names the lanes it drives (got: $(grep '^Account' "$tmp/out.txt"))"
grep -A3 '^Account  claude  ~/.claude-pool1' "$tmp/out.txt" | grep -q '^        5-hour   \[██░░░░░░░░░░░░░░░░░░\]  10% used, resets 15:00 (in 22m)$' || fail "a pool account shows its usage"
grep -A3 '^Account  claude  ~/.claude-pool1' "$tmp/out.txt" | grep -q '^        paused until 15:00 (in 22m) — You.ve hit your session limit' || fail "a pool account shows its pause"
grep -q '^Account  claude  ~/.claude-pool2  (not logged in)  unused$' "$tmp/out.txt" || fail "a pool folder nobody signed in says so"
grep -q '^Account  codex  ~/.codex-lane-d  dev@example.com  reviews A$' "$tmp/out.txt" || fail "a pool account names the lanes it reviews"
grep -q '^Account  claude  ~/.claude-waitron  watcher@example.com  unused  (the watcher)$' "$tmp/out.txt" || fail "the watcher's folder is listed too"
printf '%s\n' "$out" | grep -B1 '^Account  claude  ~/.claude-pool1' | head -1 | grep -q '^$' || fail "a blank line comes before each account"
# a reset after the 25 October clock change is shown in that day's local time, not today's offset
usage tokP1 10 2026-09-25T13:00:00+00:00 20 2026-10-25T05:00:00+00:00
run --lane "A=$tmp/camp-a" | grep -q 'resets Sun 25 Oct 06:00 (in ' || fail "a reset after the clock change reads in that day's local time (got: $(run --lane "A=$tmp/camp-a" | grep weekly | head -1))"
rm -rf "$SHARED/accounts" "$SHARED"/limits/*.until
run --lane "A=$tmp/camp-a" | grep -q '^Account' && fail "without a pool file there is no pool section"
```

- [ ] **Step 2: Run to watch them fail**

Run: `cd ~/workspace/tools/.worktrees/account-pool && sh lane-status.test.sh`
Expected: `FAIL: a lane's driver comes from its assignment line (got: Lane A  claude  idle  ~/.claude-lane-a ...)`.

- [ ] **Step 3: Write the minimal implementation** in `lane-status.py`

1. After the imports: `sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))` then
   `import account_pool  # noqa: E402`. It must be `realpath`: the README installs this script as a
   symbolic link in `~/.local/bin`, where `account_pool.py` is not.
2. Add, after `lane_settings`:

```python
def lane_accounts(name, lane_dir, shared):
    """(engine, Claude folder, Codex folder, note) for the lane's next firing, decided as runner-lib.sh
    decides: its assignment line when both folders exist, otherwise run.sh's own. note says why run.sh's
    are used when an assignment file exists, and is "" otherwise."""
    s = lane_settings(lane_dir)
    engine = s["ENGINE"] or "claude"
    fallback = (engine, s["CLAUDE_ACCOUNT"], s["CODEX_ACCOUNT"])
    try:
        text = open(os.path.join(shared, "accounts", "assignments"), encoding="utf-8").read()
    except OSError:
        return fallback + ("",)
    line = account_pool.parse_assignments(text).get(name)
    if not line:
        return fallback + ("no line for lane %s" % name,)
    for folder in line:
        if not (os.path.isabs(folder) and os.path.isdir(folder)):
            return fallback + ("%s does not exist" % tilde(folder),)
    driver, reviewer = line
    return (engine, reviewer, driver, "") if engine == "codex" else (engine, driver, reviewer, "")


def login_of(engine, folder, now, memo):
    """(email, fetch) for a login folder; fetch is None when it never logged in. memo holds each
    folder's answer, so a folder used by a lane and listed in the pool is read once per report."""
    if engine == "codex":
        login = codex_login(folder)
        email = login[0] if login else None
        read = (lambda: codex_windows(login[1], login[2], now)) if login else None
    else:
        token = stored_token(folder)
        email = account_email(folder) if token else None
        read = (lambda: claude_windows(token, now)) if token else None
    if read is None:
        return email, None

    def fetch():
        if folder not in memo:
            try:
                memo[folder] = (read(), None)
            except Exception as e:
                memo[folder] = (None, e)
        windows, error = memo[folder]
        if error is not None:
            raise error
        return windows
    return email, fetch


def usage_details(fetch, now):
    details = []
    try:
        for label, pct, at in fetch():
            used = "%s %3d%% used" % (meter(pct), pct)
            details.append("%-7s  %s, resets %s (in %s)" % (label, used, when(at, now), wait(at - now)) if at else "%-7s  %s" % (label, used))
    except Exception as e:  # one login's usage failing must not hide the rest of the report
        details.append("usage unavailable: %s" % e)
    return details
```

3. Replace `report` with this version, which takes the lane's folders from `lane_accounts`, reads each
   folder's usage once through `login_of`, shows the fallback note, and ends with the pool:

```python
def report(lanes, shared, now, out, watcher):
    width = shutil.get_terminal_size((0, 0)).columns
    lines = ps_lines()
    memo = {}
    rows = []
    for name, lane_dir in lanes:
        engine, claude, codex, note = lane_accounts(name, lane_dir, shared)
        folder, reviewer = (codex, claude) if engine == "codex" else (claude, codex)
        running = running_for(lane_dir, lines)
        state = "running " + humanize(running) if running else ("stopped" if os.path.exists(os.path.join(lane_dir, "STOP")) else "idle")
        email, fetch = login_of(engine, folder, now, memo)
        rows.append(dict(name=name, dir=lane_dir, engine=engine, folder=folder, reviewer=reviewer, note=note,
                         state=state, email=email, fetch=fetch))
    for n, row in enumerate(rows):
        if n:
            out.write("\n")
        head = "Lane %s  %s  %s  %s" % (row["name"], row["engine"], row["state"], tilde(row["folder"]))
        details = []
        if row["fetch"] is None:
            head += "  (not logged in)"
        else:
            head += "  " + (row["email"] or "(email unknown)")
            # One allowance per (engine, email): the same address on Claude and on Codex is two allowances.
            peers = [r["name"] for r in rows if r is not row and r["email"] and (r["engine"], r["email"]) == (row["engine"], row["email"])]
            if peers:
                head += "  (shares this login with lane %s)" % ", ".join(peers)
            details.extend(usage_details(row["fetch"], now))
        if row["note"]:
            head += "  (run.sh folders: %s)" % row["note"]
        p = pause(shared, row["folder"], now)
        if p:
            details.append("paused until %s (in %s) — %s" % (when(p[0], now), wait(p[0] - now), p[1]))
        details.extend(queue_lines(queue_items(row["dir"]), now, width))
        out.write(fit(head, width) + "\n")
        for d in details:
            out.write(fit(INDENT + d, width) + "\n")
    pool_report(shared, rows, watcher, now, memo, width, out)
```

   and add `pool_report` beside it:

```python
def pool_report(shared, rows, watcher, now, memo, width, out):
    try:
        text = open(os.path.join(shared, "accounts", "pool"), encoding="utf-8").read()
    except OSError:
        return
    entries, _ = account_pool.parse_pool(text, HOME)
    if watcher not in [f for _, f in entries]:
        entries.append(("claude", watcher))
    for engine, folder in entries:
        email, fetch = login_of(engine, folder, now, memo)
        drives = [r["name"] for r in rows if r["folder"] == folder]
        reviews = [r["name"] for r in rows if r["reviewer"] == folder]
        roles = "; ".join(p for p in ("drives " + ", ".join(drives) if drives else "",
                                      "reviews " + ", ".join(reviews) if reviews else "") if p) or "unused"
        who = (email or "(email unknown)") if fetch else "(not logged in)"
        head = "Account  %s  %s  %s  %s" % (engine, tilde(folder), who, roles)
        if folder == watcher:
            head += "  (the watcher)"
        details = usage_details(fetch, now) if fetch else []
        p = pause(shared, folder, now)
        if p:
            details.append("paused until %s (in %s) — %s" % (when(p[0], now), wait(p[0] - now), p[1]))
        out.write("\n" + fit(head, width) + "\n")
        for d in details:
            out.write(fit(INDENT + d, width) + "\n")
```

4. In `when`, convert with `at.astimezone()` (the machine's zone) instead of
   `at.astimezone(now.tzinfo)`: `now` carries a fixed offset, so on 2026-10-12 a reset on Sunday
   25 October, after the clocks go back, printed as 07:00 instead of 06:00.
5. In `main`: add `ap.add_argument("--watcher", default=os.path.expanduser("~/.claude-waitron"))` and
   pass `a.watcher.rstrip("/")` to both `report(...)` calls. Update the module docstring's second
   paragraph: the lane's folders come from `<shared>/accounts/assignments` when its line is whole, else
   from `run.sh`; with a pool file, the report ends with one block per pool account and the watcher's.

- [ ] **Step 4: Run to watch them pass**

Run: `cd ~/workspace/tools/.worktrees/account-pool && sh lane-status.test.sh && sh assign-accounts.test.sh && python3 -m unittest test_account_pool && sh codex-quota.test.sh`
Expected: each prints its pass line; `&&` stops at the first failure.

- [ ] **Step 5: Update the docs**

- `README.md`, the `lane-status.py` paragraph: replace "It reads the lane's `run.sh` to learn which engine
  drives it and from which login folder." with "It reads the lane's `run.sh` for its engine, and its login
  folders from `~/waitron-campaign-shared/accounts/assignments` (falling back to `run.sh`'s, as the
  runners do, and saying why). When a pool file exists it ends with one block per pool account and the
  watcher's: its email, usage, any pause, and which lanes it drives or reviews."
- `docs/campaign-runner.md`:
  - The lane table: drop the `Login folder` column and add below the table: "Which login a lane uses is
    not fixed: the account picker assigns one, see Engines and logins."
  - "How a firing runs", the pause paragraph: add a first sentence, "Each firing first takes its login
    folders from its line in `~/waitron-campaign-shared/accounts/assignments`, falling back to `run.sh`'s
    own and saying why in its log."
  - "Setting up a new lane", step 2: replace with "Logins come from the account pool (Engines and logins);
    nothing to do here unless the pool needs another account."
  - Replace the whole "Engines and logins" section with:

```markdown
## Engines and logins

Each `run.sh` names `ENGINE` (`claude` or `codex`, the engine that drives the lane) and two login
folders, `CLAUDE_ACCOUNT` and `CODEX_ACCOUNT`. Those two are only defaults. Since 2026-10-12 there is
one login folder per account, listed in `~/waitron-campaign-shared/accounts/pool` (`claude` or `codex`,
then the folder), and `~/workspace/tools/assign-accounts.py` writes each lane's driver and reviewer
folders to `~/waitron-campaign-shared/accounts/assignments`. The campaign watcher runs it every few
minutes. A lane stays on its account until a run is refused for a usage limit, then moves to the pool
account with the most allowance left per day before its weekly reset. A Codex lane's Claude reviewer
seat is always `~/.claude-waitron`, the watcher's own login, which is never in the pool. The watcher
can hold a lane on an account by writing `<lane> <folder>` in `accounts/pins`.

To add an account: `~/waitron-campaign-shared/new-account.sh claude ~/.claude-<name>` (or `codex`),
sign it in (`CLAUDE_CONFIG_DIR=~/.claude-<name> claude`, then `/login`; for Codex
`CODEX_HOME=~/.codex-<name> codex login`), then add its line to the pool.
```

- `~/.claude/commands/lane-status.md`: append to the paragraph: "After the lanes, when the account pool
  exists, one block per pool account (and the watcher's) shows its email, usage, any pause and which
  lanes it drives or reviews; relay those as printed too. A lane marked "(run.sh folders: …)" is not
  using the picker's assignment, and the note says why." Commit it in `~/.claude` on its own:
  `git -C ~/.claude commit -s -m "lane-status: say what the account pool section is" -- commands/lane-status.md`
  (that repository has the owner's other uncommitted changes; the `--` path limits the commit to this
  file).

- [ ] **Step 6: Commit, push and open the pull request**

```bash
cd ~/workspace/tools/.worktrees/account-pool
git add lane-status.py lane-status.test.sh README.md docs/campaign-runner.md
git commit -s -m "lane-status: show each lane's assigned login and the whole account pool

A lane's login folders now come from the account picker's assignment file, falling back to
run.sh's as the runners do, with the reason shown. With a pool file the report ends with one block
per account: its usage, any pause, and which lanes it drives or reviews. The campaign runner guide
describes the pool."
git push -u origin account-pool
gh pr create --base master --title "Campaign account pool: a picker that assigns each lane's login" --body "$(cat <<'EOF'
Adds the account picker for the Waitron campaign lanes, following the spec in the waitron repository,
docs/superpowers/specs/2026-10-12-campaign-account-pool-design.md, and its plan,
docs/superpowers/plans/2026-10-12-campaign-account-pool.md.

- account_pool.py: the rules, with no input or output of their own.
- assign-accounts.py: reads the pool, pins, pauses and usage; writes the assignment file through a
  rename; prints one line per change; starts a lane it moved off a paused account.
- lane-status.py: shows each lane's assigned folders and every pool account.

The runner library that reads the assignment file lives in ~/waitron-campaign-shared, outside this
repository, and was changed separately.

Tests: python3 -m unittest test_account_pool -v; sh assign-accounts.test.sh; sh lane-status.test.sh;
sh codex-quota.test.sh.
EOF
)"
```

**Done when:** all four suites pass, the pull request is open, and the `~/.claude` commit holds only
`commands/lane-status.md` (`git -C ~/.claude show --stat HEAD`).

---

## Task 7: The watcher's skill and memory

**Work in:** a staging folder, `~/waitron-account-pool-staging/watcher/`. Nothing the live watcher reads
changes in this task (see the execution notes: a live watcher reloads the skill from its safety-net
cron, and before the switch-over there is no `accounts/` folder for the picker's state). The live files
are `~/.claude/skills/watch-campaigns/SKILL.md` and
`~/.claude/projects/-Users-clintongormley-workspace-repos-waitron/memory/` (`~/.claude-waitron`'s copies
are symbolic links to these); the skill is not tracked in `~/.claude`'s git repository and the memory
folder is not in git. Task 8 step 4 installs the staged files by rename.

```bash
W=~/waitron-account-pool-staging/watcher; M=~/.claude/projects/-Users-clintongormley-workspace-repos-waitron/memory
mkdir -p "$W/before" "$W/memory"
cp ~/.claude/skills/watch-campaigns/SKILL.md "$W/before/SKILL.md"; cp "$W/before/SKILL.md" "$W/SKILL.md"
for f in MEMORY.md chatgpt-security-change-revokes-codex-lanes.md owner-accounts-and-weekly-resets.md watcher-never-repoints-lane-logins.md; do
  cp "$M/$f" "$W/before/$f"; done
for f in MEMORY.md chatgpt-security-change-revokes-codex-lanes.md owner-accounts-and-weekly-resets.md; do cp "$M/$f" "$W/memory/$f"; done
```

**Files** (all under `$W`; line numbers are the live skill's on 2026-10-12):
- Modify: `SKILL.md` — the re-arm paragraph (lines 82–90), the change-watch loop (lines 91–120), "Cost
  model" (lines 136–163), the lane D/E paragraph ("driven by Codex from `~/.codex` … from `~/.claude`"),
  the launchd bullet, the usage-limit pause bullet, "Operator commands"
- Create: `memory/watcher-assigns-lane-accounts.md`
- Modify: `memory/MEMORY.md` (the `watcher-never-repoints-lane-logins` line),
  `memory/chatgpt-security-change-revokes-codex-lanes.md`, `memory/owner-accounts-and-weekly-resets.md`
  (their `[[watcher-never-repoints-lane-logins]]` links)
- Write: `INSTALL.md`, the exact commands Task 8 step 4 runs (Step 7 below)

There is nothing to unit-test here; the check is the loop run in Step 4.

- [ ] **Step 1: The change-watch loop.** In the fenced command of the staged `$W/SKILL.md`, after the
  `/Users/clintongormley/waitron-campaign-shared/watch-stalls.sh "$ST" 2>/dev/null` line, add:

```
  python3 /Users/clintongormley/workspace/tools/assign-accounts.py 2>&1 | while IFS= read -r l; do echo "[$(date +%H:%M)] $l"; done
```

  and below the block, after the paragraph on `MAIN MOVED`, add: "Every pass also runs the account picker
  (`~/workspace/tools/assign-accounts.py`; see "Which login each lane uses"). It prints nothing when
  nothing changed. This changes the command, so a session armed before 2026-10-13's switch-over must
  re-arm with this one."

  In the re-arm paragraph above the block, replace "re-arm it with the SAME command" with "re-arm it
  with the command as this skill's text gives it NOW", and add after that sentence: "**Arm from the
  skill's current text, never from the command you armed last.** When this session starts or restarts,
  when the safety-net cron reloads this skill, or when the owner says the skill changed, compare the
  loop you have armed with the block below; if they differ, TaskStop the armed Monitor and arm the
  block below. A session that keeps re-arming the command it remembers keeps an old loop for as long
  as it lives (the account picker joined the loop at the 2026-10-13 switch-over)."

- [ ] **Step 2: Cost model.** Add these bullets to the list under "On a change line from the Monitor":

```markdown
- An `ACCOUNTS: lane … → …` line (a lane moved, or given its first account) → relay it in one plain
  line, no push: moving lanes is the watcher's job now (owner, 2026-10-12). The picker keeps its own
  record in `~/waitron-campaign-shared/accounts/log`, and starts a lane it moved off a paused account
  itself. **For a driver moved off a paused account or a broken sign-in, check that lane's next run
  log** (`ls -t <lane folder>/logs/run-*.log | head -1`, once a firing after the move has ended): it
  must hold `Accounts: driver <the new folder>, …` and an engine run with no sign-in error
  (`/usr/bin/grep -nE 'Not logged in|Please run /login|Invalid API key|API Error: 401|token_revoked|refresh_token_invalidated|sign-in broken' <log>`
  prints nothing). Note the result in `watcher-handoff.md`. A failure there is handled as in the
  `SIGN-IN BROKEN` bullet below, even before the picker says so.
- An `ACCOUNTS: lane … stays paused — no Claude|Codex account has allowance left` line → work on that
  engine has stopped: send ONE PushNotification for the batch (several lanes arrive together), naming
  the lanes and the next reset the line gives, e.g. "All Claude accounts are out of allowance; lanes A
  and B wait until Fri 16 Oct 12:00." The picker says it once; do not repeat it.
- A `CODEX 85%: <email> at N%, weekly reset … — offer the owner a spare reset` line → read the spare
  resets in memory `owner-accounts-and-weekly-resets`, then send ONE PushNotification naming the
  account, its usage, its reset and the spare resets left for it with their expiry dates, asking the
  owner to apply one from the phone (owner, 2026-10-12: "i can"). Example: "Codex dev@waitron.io is at
  86%, resets Sun 18 Oct 06:00. Apply the spare reset that expires 29 Oct now, from your phone? (yes /
  no)". When the owner says one was applied, strike it from that memory. With none left for that
  account, say so in the same message. Applying a reset is the owner's action, never the watcher's.
- An `ACCOUNTS: usage for … unreadable` line → relay it. Act only when every account of one engine is
  unreadable; then check `python3 ~/workspace/tools/lane-status.py`'s Account blocks.
- An `ACCOUNTS: could not start lane …` line → kick it yourself:
  `launchctl kickstart gui/$(id -u)/<label>`.
- An `ACCOUNTS ERROR:` line → the picker failed and is assigning nothing; until it is fixed the runners
  keep their last assignment. Read the message. A malformed pins file is yours to fix. Anything else,
  push the owner once. Never create a missing pool file: the pool is written at the switch-over (plan
  Task 8) and changed only to add or retire an account.
- A `SIGN-IN BROKEN: <folder> (<email>) — … : <command> (noticed …)` line → a login folder stopped
  working (expired with no renewal, or revoked by a security change on the account); the picker has
  already moved its lanes and will not hand it out. Send ONE PushNotification naming the folder, the
  account and the command from the line, e.g. "The Claude login ~/.claude-dev (dev@waitron.io) has
  signed out. Lanes were moved off it. To sign it in again, on the Mac run:
  CLAUDE_CONFIG_DIR=~/.claude-dev claude, then /login." The picker says it once per marker; do not
  repeat it. Several in one batch go in one message.
- An `ACCOUNTS: <folder> is signed in again` line → relay it; the folder is back in the pool.
```

- [ ] **Step 3: The login sections.**
  - Lane D/E paragraph: replace "Both are driven by Codex from `~/.codex` (one shared allowance) with a
    Claude run-it seat from `~/.claude`." with "Both are driven by Codex from the account pool's Codex
    logins, with a Claude run-it seat from `~/.claude-waitron` (see "Which login each lane uses")."
  - launchd bullet: the labels list gains `com.waitron.campaign.d` (Lane D) and `com.waitron.campaign.e`
    (Lane E).
  - In the usage-limit pause bullet, replace "Each lane's `run.sh` names its `ENGINE` (`claude` or
    `codex`) and its two login folders, `CLAUDE_ACCOUNT` and `CODEX_ACCOUNT`." with "Each lane's
    `run.sh` names its `ENGINE` and default login folders; the folders a firing actually uses come from
    the account picker (next bullet)." and replace "every lane DRIVEN FROM THAT ACCOUNT skips firings
    until then" with "every lane DRIVEN FROM THAT FOLDER skips firings until then, and the picker moves
    those lanes to another account".
  - Add a new bullet right after it:

```markdown
- **Which login each lane uses — the account pool (owner, 2026-10-12, reversing 2026-10-09).** One login
  folder per account. `~/waitron-campaign-shared/accounts/pool` lists the folders lanes may use (`claude`
  or `codex`, then the folder); the watcher's own `~/.claude-waitron` (info@waitron.io) is never in it,
  and neither is `~/.claude-info`, the same account. `~/workspace/tools/assign-accounts.py`, run by the
  change-watch loop every pass, writes `accounts/assignments` (lane, driver folder, reviewer folder), and
  each firing reads its lane's line before the pause check, logging `Accounts: …` in its run log. Rules:
  a lane stays on its account until a run is refused for a usage limit (Claude lanes run to 100%), then
  moves to the pool account with the most allowance left per day before its weekly reset, and is
  started at once if idle; a Codex lane is reviewed from `~/.claude-waitron`; a Claude lane's Codex seat
  stays until its account pauses. **Never edit the assignment file or a `run.sh`'s folders by hand.** To
  hold a lane on an account for a reason the rules cannot see, write `<lane> <folder>` in
  `accounts/pins`, and remove the pin when the reason ends. To add an account:
  `~/waitron-campaign-shared/new-account.sh claude|codex <folder>`, the owner signs it in, then one pool
  line. Each `run.sh`'s own default folders, used only when its assignment line is missing or wrong,
  were pointed at pool folders at the switch-over (never `~/.claude-waitron` or `~/.claude-info` for a
  driver; a Codex lane's Claude seat stays `~/.claude-waitron`). The old per-lane folders
  (`~/.claude-lane-a`, `-b`, `-c`, `~/.codex-lane-d`, `-e`, `~/.codex`, `~/.codex-waitron`) stay signed
  in until the owner is back but nothing uses them; `~/.claude-lane-b` is signed in as info@, the
  watcher's account, so never point a lane back at it.
- **A broken sign-in.** When a firing fails because its login no longer works, the runner writes
  `limits/<folder>.signin`; the picker moves the lanes off that folder, never hands it out, prints one
  `SIGN-IN BROKEN` line with the command that signs it in again, and removes the marker itself once
  the folder's stored sign-in changes. To clear a marker you know is wrong, delete the file.
```

  - Operator commands: add `- **What the picker would do, without doing it:** python3
    ~/workspace/tools/assign-accounts.py --dry-run`, and to the lane-status bullet add "and, after the
    lanes, one block per pool account with its usage, any pause and which lanes it drives or reviews".

- [ ] **Step 4: Check the staged loop runs, and says a missing pool once.** Before the tools pull
  request lands, `~/workspace/tools/assign-accounts.py` does not exist, so the check runs the worktree's
  picker against a scratch shared folder, never the real one. Copy the fenced loop from `$W/SKILL.md` to
  `$W/loop.sh`, then in the copy: set `ME` to the claim's current contents
  (`cat ~/waitron-campaign-shared/watcher.claim`) so the copy is not told it was superseded; replace the
  `watch-stalls.sh` line with `:` (that script records what it has reported in the real
  `stall-state/`, and a test pass must not use up the real watcher's reports); in the picker line
  replace `/Users/clintongormley/workspace/tools/assign-accounts.py` with
  `/Users/clintongormley/workspace/tools/.worktrees/account-pool/assign-accounts.py --shared "$SCRATCH"`;
  and replace `sleep 240` with `pass=$((${pass:-0} + 1)); [ "$pass" -ge 2 ] && exit 0` (two passes).
  Then, under zsh as the Monitor runs it:

```bash
W=~/waitron-account-pool-staging/watcher
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/loop-check.XXXXXX"); mkdir -p "$SCRATCH/accounts" "$SCRATCH/limits"
SCRATCH="$SCRATCH" gtimeout 120 zsh "$W/loop.sh"; echo "exit $?"
rm -rf "$SCRATCH/accounts"   # the control: no accounts folder, as before the switch-over
SCRATCH="$SCRATCH" gtimeout 120 zsh "$W/loop.sh"; echo "exit $?"
rm -rf "$SCRATCH"; ls ~/waitron-campaign-shared/accounts
```

  (`$W/loop.sh` must read `SCRATCH` from its environment.) Expected: the first run prints exactly ONE
  line, `[HH:MM] ACCOUNTS ERROR: no pool file at <scratch>/accounts/pool — no lane is assigned or moved`,
  over its two passes, then `exit 0`; the control prints that line TWICE (with no `accounts` folder the
  picker cannot save what it said, which is why the loop line reaches the watcher only after Task 8
  writes the pool); no shell error; and the last `ls` fails with `No such file or directory` (nothing
  touched the real shared folder).

- [ ] **Step 5: The memory, staged.** Create `$W/memory/watcher-assigns-lane-accounts.md`:

```markdown
---
name: watcher-assigns-lane-accounts
description: "owner 2026-10-12, reversing 2026-10-09 — the watcher manages which login each campaign lane uses, through the account picker; one login folder per account"
metadata:
  node_type: memory
  type: feedback
---

The watcher decides which account each campaign lane runs on, and does it only through the picker,
`~/workspace/tools/assign-accounts.py`, which its change-watch loop runs every pass. The picker writes
`~/waitron-campaign-shared/accounts/assignments`; each lane's runner reads its line at the start of
every firing. One login folder per account, listed in `~/waitron-campaign-shared/accounts/pool`; the
watcher's own `~/.claude-waitron` (info@waitron.io) is never in it.

**Why:** owner, 2026-10-12, before being away 17 Oct – 2 Nov: "i need you to manage which queue gets
which account to keep things running", and "i think what i need is a ~/.claude-* account for each login,
and then you can link each lane to the appropriate login directory. and maintain one for the watcher and
for reviews". This reverses 2026-10-09's "i'm not sure i want you switching lane c to point at a
different claude directory".

**How to apply:** never edit the assignment file or a `run.sh`'s folders by hand. To steer the picker,
write `<lane> <folder>` in `~/waitron-campaign-shared/accounts/pins` and remove it when the reason ends.
Claude lanes run an account to 100% before moving; Codex lanes are reviewed from `~/.claude-waitron`.
At 85% of a Codex account's week, push the owner once offering a spare reset, which the owner applies
from the phone ("i can", 2026-10-12); the spare resets are listed in [[owner-accounts-and-weekly-resets]].
A `SIGN-IN BROKEN` line from the picker is one push to the owner with the re-login command it names.
After a lane is moved off a paused account, check its next run log names the new folder and signed in.
Spec: `docs/superpowers/specs/2026-10-12-campaign-account-pool-design.md` in the waitron repository.
Related: [[campaign-runners-auth-and-2026-09-20-quota-episode]], [[lane-status-command]].
```

  Do not delete the live `watcher-never-repoints-lane-logins.md`; the install script (Step 7) does it.
  In `$W/memory/MEMORY.md` replace the `watcher-never-repoints-lane-logins` line with:

```markdown
- [watcher assigns lane accounts](watcher-assigns-lane-accounts.md) — reversed 2026-10-12: the picker moves lanes between pool accounts; steer it with a pin, never by hand
```

  and in the two other staged memories replace `[[watcher-never-repoints-lane-logins]]` with
  `[[watcher-assigns-lane-accounts]]`.

- [ ] **Step 6: Check no stale reference is left.**

Run:

```bash
W=~/waitron-account-pool-staging/watcher; M=~/.claude/projects/-Users-clintongormley-workspace-repos-waitron/memory
/usr/bin/grep -rn 'watcher-never-repoints\|never re-points\|from `~/.codex` (one shared' "$W/SKILL.md" "$W/memory/"; echo "staged: exit $?"
/usr/bin/grep -rl 'watcher-never-repoints' "$M" | /usr/bin/grep -v -e '/MEMORY.md$' -e '/chatgpt-security-change-revokes-codex-lanes.md$' \
  -e '/owner-accounts-and-weekly-resets.md$' -e '/watcher-never-repoints-lane-logins.md$'; echo "other live memories: exit $?"
```

Expected: no matches and `staged: exit 1`; no file names and `other live memories: exit 1` (no live
memory outside the three staged ones links to the memory being retired).

- [ ] **Step 7: Write the install script.** `$W/install.sh`, run under bash by Task 8 step 4, never by
  this task. It must, in this order, stopping at the first failure:
  1. refuse (print which file and exit 1) if any live file differs from its copy in `$W/before/`: the
     skill, and the four memory files. `MEMORY.md` changes often; if it moved, the controller re-applies
     the one-line change to a fresh copy rather than overwriting someone's edit;
  2. copy each live file it will replace or delete to `~/waitron-campaign-shared/backups/2026-10-12-account-pool/`;
  3. install `$W/SKILL.md` and each file in `$W/memory/` by writing a temporary file in the target
     folder and renaming it over the target;
  4. remove the live `watcher-never-repoints-lane-logins.md`;
  5. print `installed`, and the one-line rollback (copy the backups back the same way, and remove
     `watcher-assigns-lane-accounts.md`).
  Check it with `bash -n "$W/install.sh"`, and by running it against a scratch copy: make it take the
  skill folder and the memory folder from `INSTALL_SKILL_DIR` and `INSTALL_MEMORY_DIR` (defaults: the
  live ones) and the backup folder from `INSTALL_BACKUP_DIR`, copy the live folders to a scratch
  folder, run it there, and `diff -r` the result against what you expect. Never run it against the live
  folders.

**Done when:** the loop check printed one line and its control two, with no shell error; the
stale-reference search found nothing; `diff "$W/before/SKILL.md" "$W/SKILL.md"` shows only the changes
above; the install script passed its scratch run; and every live file is unchanged
(`cmp ~/.claude/skills/watch-campaigns/SKILL.md "$W/before/SKILL.md"` and the same for the four memory
files print nothing).

---

## Task 8: The switch-over — run by the controller, with the owner's knowledge

Not for an implementer. Each step says what failure looks like; stop at the first one and tell the
owner. Do it before the owner leaves on 17 October, and **not before 01:00 on 13 October**
(Europe/Madrid): the gmail Claude account was at 100% of its week on 12 October and resets then.

- [ ] **Step 0a: Renew every sign-in, from launchd.** A stored Claude sign-in expires about eight hours
  after it was last used (the five pool folders' tokens, signed in on 12 October, expire between 00:40
  and 00:52 on 13 October); its refresh token lasts until about 8–11 November. One short run per folder
  renews it, and running it as a launchd job, not from a terminal, also answers the question the
  2026-09-20 episode left open: does a folder authenticate when launchd starts the program? Folders: the
  four Claude pool folders, `~/.claude-waitron` (the Codex lanes' Claude review seat, which also runs
  under launchd) and `~/.claude-info` (the spare folder of the watcher's account), then the two Codex
  pool folders.

```bash
bash <<'EOF'
set -u
D=~/waitron-account-pool-staging/signin-check; mkdir -p "$D"; U=$(id -u)
ENVLINE='export HOME=/Users/clintongormley PATH=/opt/homebrew/bin:/usr/local/bin:/Users/clintongormley/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin; cd /tmp'
labels=()
start() { # $1 name $2 engine $3 folder
  local label="com.waitron.signin-check.$1"
  if [ "$2" = claude ]; then
    printf '%s\nexport CLAUDE_CONFIG_DIR=%s\nclaude -p "Reply with the single word ok."\necho "exit $?"\n' "$ENVLINE" "$3" > "$D/$1.sh"
  else
    printf '%s\nexport CODEX_HOME=%s\ncodex exec --skip-git-repo-check "Reply with the single word ok."\necho "exit $?"\n' "$ENVLINE" "$3" > "$D/$1.sh"
  fi
  rm -f "$D/$1.log"
  cat > "$D/$1.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$label</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$D/$1.sh</string></array>
<key>StandardOutPath</key><string>$D/$1.log</string><key>StandardErrorPath</key><string>$D/$1.log</string>
<key>RunAtLoad</key><true/>
</dict></plist>
PL
  launchctl bootstrap "gui/$U" "$D/$1.plist" && labels+=("$label")
}
for n in support dev clint gmail waitron info; do start "claude-$n" claude "/Users/clintongormley/.claude-$n"; done
for n in dev gmail; do start "codex-$n" codex "/Users/clintongormley/.codex-$n"; done
end=$((SECONDS + 300))
until [ $SECONDS -ge $end ] || [ "$(cat "$D"/*.log 2>/dev/null | /usr/bin/grep -c '^exit ')" -ge 8 ]; do sleep 5; done
for l in "${labels[@]}"; do launchctl bootout "gui/$U/$l" 2>/dev/null; done
for f in "$D"/*.log; do echo "== $f"; tail -3 "$f"; done
EOF
```

  (`printf`'s `$?` is inside single quotes, so it is written into each job's script as is.) Expected:
  eight logs, each ending with the engine's answer (`ok`) and `exit 0`. Failure looks like:
  `Not logged in · Please run /login`, a `401`, `token_revoked` or `exit 1` in a log. Then the owner
  signs that folder in again (`CLAUDE_CONFIG_DIR=<folder> claude`, then `/login`; or
  `CODEX_HOME=<folder> codex login`) and you rerun the check for that folder alone. A folder that fails
  here when started by launchd but works from a terminal is the launchd and Keychain problem the
  2026-09-20 memory suspected: tell the owner before going further. A usage-limit message is not a
  sign-in failure; it means that account has not reset yet. A job that never wrote `exit` within five
  minutes was stopped by `bootout`; report it. Record each folder's result in the ledger and in memory
  `campaign-runners-auth-and-2026-09-20-quota-episode`, which can then close its open question.

- [ ] **Step 0b: Preconditions.**
  - The tools pull request has landed and the main checkout has it:
    `git -C ~/workspace/tools pull --ff-only && ls ~/workspace/tools/assign-accounts.py ~/workspace/tools/account_pool.py`.
  - The runner library is live: `cmp ~/waitron-account-pool-staging/5b/runner-lib.sh ~/waitron-campaign-shared/runner-lib.sh`
    prints nothing (Task 5b's version), and the newest run log of each lane that has fired since Task 5 holds the line
    `Accounts: no assignment file at /Users/clintongormley/waitron-campaign-shared/accounts/assignments — using run.sh's folders.`
    and otherwise reads like the logs before it:
    `for d in ~/waitron-campaign ~/waitron-campaign-{b,c,d,e}; do f=$(ls -t $d/logs/run-*.log | head -1); echo "$f"; /usr/bin/grep -h '^Accounts:' "$f"; done`.
    Failure looks like: no `Accounts:` line in a log written after Task 5, or a firing that stopped at
    a shell error.
  - Task 7 is done: `~/waitron-account-pool-staging/watcher/` holds the staged skill, memory and
    `install.sh`, and the live skill still matches `watcher/before/SKILL.md`.
  - It is after 01:00 on 13 October, step 0a passed for every folder, and the owner knows the switch
    is happening now.

- [ ] **Step 1: Write the pool file**, exactly the spec's table less the watcher's folder, through a
  rename:

```bash
A=~/waitron-campaign-shared/accounts
mkdir -p "$A"
cat > "$A/.pool.new" <<'EOF'
# One login folder per account (spec 2026-10-12). Never the watcher's ~/.claude-waitron or ~/.claude-info.
claude /Users/clintongormley/.claude-support
claude /Users/clintongormley/.claude-dev
claude /Users/clintongormley/.claude-clint
claude /Users/clintongormley/.claude-gmail
codex /Users/clintongormley/.codex-dev
codex /Users/clintongormley/.codex-gmail
EOF
mv -f "$A/.pool.new" "$A/pool"
rm -f "$A/state.json"
```

- [ ] **Step 2: Check every pool folder is signed in to the right account.**
  Run `python3 ~/workspace/tools/lane-status.py` and read the Account blocks. Expected: the six folders
  with support@waitron.io, dev@waitron.io, clint@waitron.io, clintongormley@gmail.com (Claude), then
  dev@waitron.io and clintongormley@gmail.com (Codex), and `~/.claude-waitron` with info@waitron.io
  marked `(the watcher)`. Failure looks like: `(not logged in)`, a different email, or `usage
  unavailable` on a folder whose sign-in should be fresh. A spare folder unused for about eight hours
  answering `usage unavailable: HTTP Error 401` is expected (Review Focus 1); the picker handles it.

- [ ] **Step 3: Dry run against the real accounts.**

```bash
ls -A ~/waitron-campaign-shared/accounts
python3 ~/workspace/tools/assign-accounts.py --dry-run
ls -A ~/waitron-campaign-shared/accounts
```

  Expected: both listings show only `pool`; the output ends with `DRY RUN: would write …/assignments:`
  and five `lane X  driver …  reviewer …` lines; Claude lanes A, B and C on three different Claude pool
  folders where three qualify; lanes D and E on the two Codex folders with reviewer `~/.claude-waitron`.
  Failure looks like: any new file in the listing (the dry run wrote something), a driver on
  `~/.claude-waitron` or `~/.claude-info`, a Claude lane given a Codex folder, or an `ACCOUNTS ERROR`
  line. Show the owner the table. If a lane lands on an account nearly used up (clint@ was at 99% of its
  week on 2026-10-12) and the owner would rather it did not, write a pin for it in
  `~/waitron-campaign-shared/accounts/pins` and repeat the dry run.

- [ ] **Step 4: Switch.**
  1. **Point every `run.sh`'s own defaults at pool folders first**, so that a lane falling back (no
     assignment file, no line, a missing folder, or the rollback below) lands on a pool folder, never
     on the watcher's account: today lane B's default `~/.claude-lane-b` is signed in as info@.
     Use the dry run's table (step 3): a Claude lane's `CLAUDE_ACCOUNT` default becomes its driver and
     its `CODEX_ACCOUNT` default its reviewer; a Codex lane's `CODEX_ACCOUNT` default becomes its driver
     and its `CLAUDE_ACCOUNT` default stays `/Users/clintongormley/.claude-waitron`. Each file is
     backed up, rewritten into a temporary file beside it, checked with `bash -n`, and renamed over the
     original (a firing in progress keeps reading the file it opened). Save this as
     `~/waitron-account-pool-staging/lane-defaults.sh` and run it once per lane under bash, e.g.
     `bash ~/waitron-account-pool-staging/lane-defaults.sh ~/waitron-campaign /Users/clintongormley/.claude-dev /Users/clintongormley/.codex-dev`:

```bash
#!/bin/bash
# lane-defaults.sh <lane folder> <Claude folder> <Codex folder>: rewrite run.sh's two default login folders.
set -eu
B=~/waitron-campaign-shared/backups/2026-10-12-account-pool; mkdir -p "$B"
cp -p "$1/run.sh" "$B/run.sh.$(basename "$1")"
python3 - "$1" "$2" "$3" <<'PY'
import os, re, shutil, sys
d, claude, codex = sys.argv[1:]
f, n = os.path.join(d, "run.sh"), os.path.join(d, ".run.sh.new")
text = open(f, encoding="utf-8").read()
text, a = re.subn(r'^(CLAUDE_ACCOUNT="\$\{RUNNER_CLAUDE_ACCOUNT:-)[^}]*\}', lambda m: m.group(1) + claude + "}", text, flags=re.M)
text, b = re.subn(r'^(CODEX_ACCOUNT="\$\{RUNNER_CODEX_ACCOUNT:-)[^}]*\}', lambda m: m.group(1) + codex + "}", text, flags=re.M)
assert a == 1 and b == 1, (a, b)
open(n, "w", encoding="utf-8").write(text)
shutil.copymode(f, n)
PY
bash -n "$1/.run.sh.new"
mv -f "$1/.run.sh.new" "$1/run.sh"
echo "$1/run.sh: Claude $2, Codex $3"
```

     Check: `for d in ~/waitron-campaign ~/waitron-campaign-{b,c,d,e}; do echo "== $d"; /usr/bin/grep -E '^(ENGINE|CLAUDE_ACCOUNT|CODEX_ACCOUNT)=' $d/run.sh; done`.
     Failure looks like: a Claude lane whose `CLAUDE_ACCOUNT` default is `~/.claude-waitron`,
     `~/.claude-info` or an old `~/.claude-lane-*` folder; any lane whose Codex default is not a pool
     Codex folder; or `bash -n` complaining (then the original is untouched).
  2. Note the time (`date '+%Y-%m-%d %H:%M'`; call it T), then `python3 ~/workspace/tools/assign-accounts.py`.
     Expected: ten `ACCOUNTS: … (new)` lines (a driver and a reviewer per lane),
     `cat ~/waitron-campaign-shared/accounts/assignments` matching the dry run's table, and a second run
     printing nothing.
  3. Install the watcher's staged skill and memory: `bash ~/waitron-account-pool-staging/watcher/install.sh`.
     Expected: `installed`. If it refuses because a live file changed since Task 7 staged it, fold that
     change into the staged copy and run it again; never overwrite someone else's edit.
  4. In the watcher session: tell it the skill changed, so it reloads the skill, TaskStops its
     change-watch Monitor, and arms the loop from the skill's new text (the skill now says a session
     arms from its current text). Check the new loop is the one running: `~/waitron-campaign-shared/accounts/usage.json`'s
     modification time moves at least every ten minutes or so (the picker re-reads usage that often).

  Rollback, if anything below fails: `mv ~/waitron-campaign-shared/accounts/assignments ~/waitron-campaign-shared/accounts/assignments.off`;
  every lane falls back to its `run.sh` folders at its next firing, and says so in its log. Since
  part 1 those are pool folders, so the rollback moves no lane onto info@. **Never restore the
  `run.sh` backups as a rollback**: lane B's old default is `~/.claude-lane-b`, signed in as info@,
  the watcher's account. To take the picker out of the watcher's loop as well, restore the skill and
  memory with the rollback line `install.sh` printed.

- [ ] **Step 5: The first SCHEDULED firing of each lane authenticates.** This is the question left open
  by the 2026-09-20 episode (memory `campaign-runners-auth-and-2026-09-20-quota-episode`): only a
  kicked firing was seen to work on a new login. A scheduled firing is one launchd started on its
  30-minute timer after T: not a kick (`~/waitron-campaign-shared/accounts/log` shows no move of that
  lane off a paused account since T, and nobody ran `launchctl kickstart` for it), and not a chained
  firing (the log before it does not end with `=== the firing committed work; starting the next one now ===`),
  since a chained firing belongs to a process started before T. Within about 40 minutes of T, for each
  lane:

```bash
for d in ~/waitron-campaign ~/waitron-campaign-{b,c,d,e}; do
  for f in $(ls -tr $d/logs/run-*.log); do [ "$f" -nt ~/waitron-campaign-shared/accounts/assignments ] && echo "$f"; done | head -3
done
```

  Take the first listed log of each lane that is a scheduled firing and that ran the engine (it has an
  `=== firing … exited rc=` line; a firing skipped for a pause, low memory or Docker does not count, so
  wait for the next). It must hold `Accounts: driver <the assigned folder>, reviewer <…> (from …)` and
  must not hold a sign-in error: `/usr/bin/grep -nE 'Please run /login|Invalid API key|OAuth|401|Unauthorized|[Nn]ot logged in|refresh.?token' <log>`
  should print nothing. A working firing shows the engine's own output and usually `exited rc=0`. Failure
  looks like: one of those sign-in messages and `exited rc=1`; then sign that folder in again
  (`CLAUDE_CONFIG_DIR=<folder> claude`, `/login`; or `CODEX_HOME=<folder> codex login`), and if a
  scheduled firing still fails where a kicked one works, that is the launchd and Keychain problem the
  2026-09-20 memory suspected: tell the owner before they leave. Record each lane's result in the ledger
  and in that memory, which can then close its open question.

- [ ] **Step 6: One forced move, on a test copy of the shared folder.** Never write a pause marker into
  the real `~/waitron-campaign-shared/limits/`. Run it as one bash script (the Bash tool's shell is zsh,
  which treats an unmatched glob as an error and would source the runner library differently):

```bash
bash <<'EOF'
set -u
PICKER=~/workspace/tools/assign-accounts.py
LIVE=~/waitron-campaign-shared
T=$(mktemp -d "${TMPDIR:-/tmp}/account-pool-forced.XXXXXX")
cp -R "$LIVE/accounts" "$T/accounts"
mkdir "$T/limits"
for f in "$LIVE"/limits/*.until; do [ -e "$f" ] && cp "$f" "$T/limits/"; done
before=$(shasum "$LIVE/accounts/assignments")
X=$(awk '$1 == "A" { print $2 }' "$T/accounts/assignments")
printf '%s\n%s\n' $(( $(date +%s) + 3600 )) "forced-move test" > "$T/limits/$(echo "$X" | sed 's|[/.]|-|g').until"
printf '#!/bin/sh\necho "$*" >> "%s/launchctl.calls"\n' "$T" > "$T/launchctl"; chmod +x "$T/launchctl"
echo "--- the picker on the copy"
ASSIGN_ACCOUNTS_LAUNCHCTL="$T/launchctl" python3 "$PICKER" --shared "$T"
echo "--- lane A's line in the copy, and what would have been started"
awk '$1 == "A"' "$T/accounts/assignments"; cat "$T/launchctl.calls" 2>/dev/null
[ "$(shasum "$LIVE/accounts/assignments")" = "$before" ] && echo "real file untouched"
echo "--- what the runner library makes of the copy (no firing starts)"
( SHARED="$T"; CAMP=/Users/clintongormley/waitron-campaign; ENGINE=claude; LOG="$T/log"
  CLAUDE_ACCOUNT=/Users/clintongormley/.claude-lane-a; CODEX_ACCOUNT=/Users/clintongormley/.codex
  . "$LIVE/runner-lib.sh"; use_assigned_accounts
  echo "$CLAUDE_ACCOUNT"; echo "$LIMIT_MARKER"; cat "$LOG" )
rm -rf "$T"
EOF
```

  Expected, in order: one line `ACCOUNTS: lane A claude → <another Claude pool folder> (was <X>, paused
  until …)` (and possibly `CODEX 85%` or `stays paused` lines the real figures call for); lane A's line in
  the copy naming that folder; `kickstart gui/<uid>/com.waitron.campaign` if lane A was idle with no
  `STOP` file, and nothing if it was running (both are right; say which); `real file untouched`; then the
  new folder, a pause-marker path named after the new folder, and an `Accounts: driver <new folder>, …`
  line. Failure looks like: no move line, the real file changed, or the runner library printing the old
  folder.

  This proves the picker moves a paused lane and that the runner library reads the move. It does not
  prove a real firing ran on the new account, and this step is not finished until one has: when the
  first real `ACCOUNTS: lane … (was …, paused until …)` line arrives, check that lane's next run log as
  in Step 5 (it names the new folder in its `Accounts: driver …` line, ran the engine, and holds no
  sign-in error), and record the result in the ledger. Until then the ledger lists this check as open.
  The watcher's skill (Task 7) carries the same check as a standing rule for every later move.

- [ ] **Step 7: Close.** Set the ledger to `Status: done` once the step 6 real-move check is recorded
  (until then, `Status: in progress` with that check as the next step). Tell the owner in plain words
  what each lane now runs on, what steps 0a and 5 found for each folder and lane, that every `run.sh`
  default is now a pool folder, and that the old per-lane folders are still signed in but unused.

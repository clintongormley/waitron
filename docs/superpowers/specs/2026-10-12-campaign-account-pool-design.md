# Campaign account pool — which login each lane uses

Date: 2026-10-12. Status: approved by the owner, 2026-10-12. Plan:
`docs/superpowers/plans/2026-10-12-campaign-account-pool.md`.

## Why

The owner is away from 17 October to 2 November 2026. During that time they can answer questions
from their phone through the campaign watcher session, and do nothing else. The five campaign lanes
(A, B and C driven by Claude; D and E driven by Codex) must keep working across the owner's five
Claude accounts and two Codex accounts, the watcher must never run out, and each engine must stay
available to review the other's branches.

Until now each lane had its own login folder and only the owner chose the account behind it
("i'm not sure i want you switching lane c to point at a different claude directory", 2026-10-09).
The owner has reversed that: "i need you to manage which queue gets which account to keep things
running" (2026-10-12).

## Decisions (owner, 2026-10-12)

1. **One login folder per account, not per lane.** "i think what i need is a ~/.claude-* account for
   each login, and then you can link each lane to the appropriate login directory. and maintain one
   for the watcher and for reviews."
2. **The watcher assigns accounts to lanes** (option B of the question "who decides"), through a file
   the runners read.
3. **Claude lanes run their account to 100%** before moving: "we can run them to 100% before
   switching". A lane moves when a run is refused for a usage limit, not before.
4. **Codex: tell the owner, offer a spare reset.** At 85% of a Codex account's weekly allowance the
   owner gets a phone message offering one of the spare resets ("send me a notification about using
   the reset"). No Codex reserve is kept: "codex won't run out, not with the resets we have".
5. **Claude reviews of the Codex lanes run on the watcher's account**, `~/.claude-waitron`.
6. **The watcher's account is info@waitron.io**, signed in to `~/.claude-waitron` on 2026-10-12. No
   lane is assigned to it.

## The accounts (2026-10-12)

| Folder | Account | Role |
| --- | --- | --- |
| `~/.claude-waitron` | info@waitron.io | the watcher, and the Claude review seat for lanes D and E |
| `~/.claude-support` | support@waitron.io | Claude lanes |
| `~/.claude-dev` | dev@waitron.io | Claude lanes |
| `~/.claude-clint` | clint@waitron.io | Claude lanes |
| `~/.claude-gmail` | clintongormley@gmail.com | Claude lanes |
| `~/.codex-dev` | dev@waitron.io | Codex lanes and the Codex review seat for lanes A, B and C |
| `~/.codex-gmail` | clintongormley@gmail.com | Codex lanes and the Codex review seat for lanes A, B and C |

`~/.claude-info` is also info@waitron.io. It stays out of the lane pool, because a lane on it would
spend the watcher's allowance. The old per-lane folders (`~/.claude-lane-a`, `-b`, `-c`,
`~/.codex-lane-d`, `-e`, `~/.codex`, `~/.codex-waitron`) stop being used at cutover and are left in
place, signed in, until the owner is back.

## Design

### The pool file

`~/waitron-campaign-shared/accounts/pool` lists the folders the picker may hand out, one per line:
engine (`claude` or `codex`), then the folder. The watcher's folder is not in it. Adding an account
later means signing a new folder in (`new-account.sh`) and adding one line.

### The assignment file

`~/waitron-campaign-shared/accounts/assignments` holds one line per lane: the lane letter, the
driver's folder, and the reviewer seat's folder (for a Claude lane the Codex folder, and the other
way round). Only the picker writes it, through a temporary file and a rename, so a runner never
reads half a file.

Each `run.sh` reads its lane's line at the start of every firing, before the usage-limit check, and
uses those two folders as `CLAUDE_ACCOUNT` and `CODEX_ACCOUNT`. If the file is missing, the lane has
no line, or a folder named there does not exist, the runner keeps the defaults in its own `run.sh`
and writes one line saying why to its run log. A mistake in the file can never put a lane on an
account nobody signed in, because `lane_settings_ok` already refuses a missing folder.

Because a pause marker belongs to a folder, and every folder is now one account, two lanes on the
same account now see the same pause. Before this change two folders signed in to one account each
kept their own.

### The picker

`~/workspace/tools/assign-accounts.py`, beside `lane-status.py`, whose usage readers it reuses. It
decides; it never starts or stops anything except the one kick below. The watcher's change-watch
loop runs it on every pass (about every four minutes), so it costs no AI time. It reads each
account's usage at most every ten minutes, and at once when a new pause marker appears.

Rules, in order:

1. **A pinned lane stays where it is pinned**, unless that account is paused. Pins live in
   `~/waitron-campaign-shared/accounts/pins`; the watcher writes one when it knows something the rules
   do not, and removes it when that stops being true.
2. **A driver stays on its account until that account is paused.** "Paused" is the runner's own
   marker under `~/waitron-campaign-shared/limits/`, written when a run is refused for a usage limit
   (decision 3).
3. **A paused lane moves to the account with the most allowance left per day until its weekly
   reset**: (100 − weekly percent used) divided by the days until the weekly reset, among the pool
   accounts of the lane's engine that are not paused and below 100% in both the five-hour and the
   weekly window. A tie goes to the account fewer lanes use. If no account qualifies, the lane stays
   assigned and paused, and the runner keeps skipping until the pause ends.
4. **On first run, and whenever a lane has no line yet**, lanes of one engine are spread across
   different accounts where there are enough, using the same measure.
   _Changed 2026-10-12 (workspace-tools PR #18): a new lane takes the account whose allowance per
   day, divided among the lanes it would then drive, is largest, so it shares a healthy account
   rather than take a nearly used one; an account whose usage was never read is the last resort._
5. **The Codex review seat of a Claude lane** is the Codex account with the most allowance left per
   day. If both are paused, the seat keeps its last account and `finish-branch`'s existing fallback
   applies ("If Codex is unavailable, dispatch it as an Opus subagent and say so in the report").
6. **The Claude review seat of a Codex lane is always `~/.claude-waitron`** (decision 5).

When the picker moves a paused lane it also kicks that lane's launchd job
(`launchctl kickstart gui/<uid>/<label>`), so the lane starts again on its new account instead of
waiting up to 30 minutes for its next scheduled firing. It never kicks a lane that is running or has
a `STOP` file.

**Output.** The picker prints nothing when nothing changed. Otherwise it prints one line per change,
which the watcher's change-watch Monitor shows as an event:

- `ACCOUNTS: lane A claude → ~/.claude-dev (was ~/.claude-support, paused until Fri 16 Oct 22:00)`
- `ACCOUNTS: lane C stays paused — no Claude account has allowance left (next reset Sun 18 Oct 18:00)`
- `CODEX 85%: dev@waitron.io at 86%, weekly reset Sun 18 Oct 06:00 — offer the owner a spare reset`

The `CODEX 85%` line appears once per account per weekly window. The picker keeps what it has already
announced in `~/waitron-campaign-shared/accounts/state.json`.

### What the watcher does with those lines

- An `ACCOUNTS` line is logged in the watcher's own notes. The owner is not told: moving lanes is the
  watcher's job now.
- A `CODEX 85%` line becomes one phone notification to the owner, in plain words, naming the account,
  its usage, its reset time and the spare resets left with their expiry dates. Example: "Codex
  dev@waitron.io is at 86% with three days to its reset. Use the reset that expires 29 Oct? (yes /
  no)". Applying a reset is the owner's action.
- A "stays paused" line for a whole engine is the one case worth telling the owner, because work has
  stopped. The watcher says when the next account resets.

The watcher's skill (`~/.claude/skills/watch-campaigns/SKILL.md`) gains these three rules, and its
section on login folders, which today says the watcher never changes a lane's login, is rewritten to
describe the pool. Memory `watcher-never-repoints-lane-logins` is replaced by one recording the
reversal.

### lane-status

`lane-status.py` reads each lane's folders from the assignment file (falling back to `run.sh`, as the
runners do), and gains a section listing every pool account: its email, five-hour and weekly usage
with reset times, any pause, and which lanes use it as driver or reviewer. The owner sees the whole
pool in one command.

## Testing

- **The picker**, unit tests with recorded usage answers and pause markers. Cases: a lane on an
  unpaused account stays; a paused lane moves to the best account; a tie goes to the less used one;
  no qualifying account leaves the lane paused and prints the "stays paused" line once; a pin holds
  until its account pauses; the watcher's account is never handed out; the Codex 85% line prints
  once per account per weekly window; the file is written through a rename; a running or stopped
  lane is never kicked.
- **The runner**, new cases in `~/waitron-campaign-shared/tests/runner.test.sh`: a lane reads its line;
  a missing file, a missing line and a missing folder each fall back to `run.sh`'s defaults and log
  why.
- **lane-status**, its existing tests extended for the assignment file and the pool section.
- **Live checks before arming**, each with what failure would look like:
  - one dry run of the picker against the real accounts, printing the assignments it would write
    without writing them;
  - after cutover, the first SCHEDULED (not kicked) firing of each lane on a new folder authenticates.
    A failure here prints a login error in the run log. This is the open question left by the
    2026-09-20 episode (memory `campaign-runners-auth-and-2026-09-20-quota-episode`), where only a
    kicked firing was seen to work;
  - one forced move: give a lane a pause marker by hand on a test copy of the shared folder, and check
    the picker moves it and the next firing runs on the new account.

## Limits and open points

- **Several programs on one account at once.** Today this session, the watcher and the Codex lanes'
  Claude review seat all run on one folder, and three Codex folders signed in as dev@ all answer
  their usage checks. That is everyday use, not proof that two programs renewing their sign-in at
  the same moment can never clash.
- **The owner can apply a spare Codex reset from the phone** (owner, 2026-10-12: "i can"). So the 85%
  message asks the owner to apply the reset from the phone, there and then; it is never put off until
  the owner is back.
- **A lane moved mid-item** restarts from what is on disk: the branch, its commits, the plan's
  ledger and the queue. It loses the refused run's conversation and any uncommitted half-step
  (lane B recovered from exactly this on 2026-10-12, when a watchdog stop cut A13 short).
- **The usage endpoints are called every ten minutes per account** (seven accounts). Their rate
  limits are not documented here; if they refuse, the picker keeps the last answer and says so.

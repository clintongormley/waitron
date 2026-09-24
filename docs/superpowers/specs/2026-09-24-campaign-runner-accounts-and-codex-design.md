# Campaign runners: a login per lane, and Codex as a driver

Status: approved in conversation 2026-09-24, awaiting review of this written form.

## What the owner asked for

1. Each campaign lane can run under a different Claude login (its own config folder), so lanes on
   different accounts run in parallel.
2. A lane can be driven by Codex instead of Claude.

## Decisions made in the conversation

- **A Codex lane runs the whole firing itself.** The runner starts Codex with the same "read and
  follow `RUNNER.md`" prompt; Codex already carries `finish-branch`, `land-branch` and `new-worktree`
  in `~/.codex/skills`, so no runbook changes.
- **Roles reverse by driver, as the global `CLAUDE.md` already says.** When Claude drives, Codex holds
  the one reviewer seat (`codex-seat.sh`); when Codex drives, Claude holds it (Codex's
  `finish-branch` calls `~/workspace/tools/claude-seat.sh`). No rule text changes.
- **Codex gets a login per lane too**, not only Claude.

## Where the runner stands today

The runner is outside the repository: three lanes (`~/waitron-campaign`, `-b`, `-c`), each with a
`run.sh` fired every 30 minutes by launchd, sharing `~/waitron-campaign-shared/runner-lib.sh` and
its tests in `~/waitron-campaign-shared/tests/runner.test.sh`.

`run.sh` does not know about `finish-branch` or `land-branch`. It gates the firing (STOP file, date
window, lock, free memory, usage-limit pause), starts one `claude -p` told to follow the lane's
`RUNNER.md`, watches it for stalls, retries Anthropic server errors, and starts the next firing at
once if any git branch moved. Everything else is the agent following the runbook.

No lane sets `CLAUDE_CONFIG_DIR`, so all three use `~/.claude`. The usage-limit pause is one file,
`~/waitron-campaign-shared/usage-limit-until`, read by every lane and by the `watch-campaigns`
skill.

Neither seat script chooses a login: `claude-seat.sh` runs `claude -p` and `codex-seat.sh` runs
`codex exec` with whatever `CLAUDE_CONFIG_DIR` and `CODEX_HOME` they inherit. So a lane uses two
logins: one for the driver and one for the other engine's reviewer seat.

## Design

### 1. Lane settings

Each lane's `run.sh` gains three settings near the top:

```bash
ENGINE=claude                                  # which engine drives: claude or codex
CLAUDE_ACCOUNT=/Users/clintongormley/.claude   # Claude login: the driver, or the reviewer seat when Codex drives
CODEX_ACCOUNT=/Users/clintongormley/.codex     # Codex login: the driver, or the reviewer seat when Claude drives
```

These defaults are today's behaviour, so an unedited lane behaves as it does now. The runner exports
`CLAUDE_CONFIG_DIR="$CLAUDE_ACCOUNT"` and `CODEX_HOME="$CODEX_ACCOUNT"` for every firing, so the
reviewer seat inherits its login from the lane without either seat script changing.

If either folder does not exist, the firing writes one line to its log saying which, and skips. It
never falls back to the default login, because a typo would otherwise put a lane quietly on the
wrong account.

### 2. Launching

`run_claude` in `runner-lib.sh` becomes `run_agent`, which picks the command by `ENGINE`:

- **claude:** unchanged — `claude -p "$PROMPT" --dangerously-skip-permissions --add-dir <lane dirs>
  --session-id <id>`, under `caffeinate`.
- **codex:** `codex exec --dangerously-bypass-approvals-and-sandbox -C "$REPO" --add-dir <lane dirs>
  --json` with the prompt on standard input, under `caffeinate`. It passes the same settings
  `codex-seat.sh` passes so the repository's instructions reach Codex whole:
  `project_doc_fallback_filenames=["CLAUDE.md"]`, `project_doc_max_bytes=131072` and
  `shell_environment_policy.inherit="all"`. It passes no `--model`: the account's own `config.toml`
  decides (`gpt-5.6-sol` at high effort in `~/.codex/config.toml` today), matching the rule that the
  Claude runners pass no `--model` either.

Any other `ENGINE` value skips the firing with a log line.

### 3. Watchdog

The stall check keeps its three signals, with two changes:

- A Claude driver's session log is looked for under `$CLAUDE_ACCOUNT/projects`, not a hard-coded
  `~/.claude`.
- A Codex driver's event stream (`--json`) is written straight into the lane's own log, so "the
  lane's log grew" counts as activity. Today's Codex signal — any file under `~/.codex/sessions`
  written while a codex process is running — cannot tell two Codex lanes apart. It stays, pointed at
  `$CODEX_ACCOUNT/sessions`, for the Codex reviewer seat inside a Claude-driven firing.

The CPU-use signal is unchanged for both engines.

### 4. Usage-limit pause, per account

The single pause file becomes one per account folder, under `~/waitron-campaign-shared/limits/`:
`<name>.until` (line 1 the epoch the pause ends, line 2 the message) and `<name>.alerted`, where
`<name>` is the account folder's path with `/` and `.` replaced by `-`. A lane checks only its
DRIVER's account before firing, and the macOS notification and the `progress.log` line name the
account.

- **Claude's** message is recognised as today (`You've hit your … limit · resets …`), with the
  existing reset-time parser.
- **Codex's** wording is unknown. A search of `~/.codex/sessions` and `~/.codex/archived_sessions`
  for "usage limit" and "hit your" on 2026-09-24 found only unrelated prose, so there is no real
  message to match against. A line in a Codex firing's output containing "usage limit" pauses that
  account for one hour — the existing fallback for a reset time that cannot be read — and the full
  line is written to `progress.log`, so a real example can tighten the match later.

The runner only sees the driver's output, so only the driver's limit pauses a lane. When the
reviewer seat's account runs out mid-firing, the skill's own handling applies: the seat's checks are
reported as unverified. That does not pause the lane.

The `watch-campaigns` skill (`~/.claude/skills/watch-campaigns/SKILL.md`) reads the old pause file
and moves to the per-account files in the same change.

### 5. Retries

The retry on Anthropic's overloaded and server errors (`API Error: 5xx`) stays Claude-only. What a
Codex server failure prints and how it exits is not known, so a failed Codex firing waits for the
lane's next scheduled firing, 30 minutes later.

### 6. Chaining

Unchanged: a firing that exited cleanly and moved a git branch starts the next one at once, for
either engine.

### 7. New account folders

A one-time manual step, helped by `~/waitron-campaign-shared/new-account.sh claude|codex <folder>`:

- **claude:** symlinks `CLAUDE.md`, `commands`, `skills`, `agents`, `docs-writing-style.md` and the
  waitron memory folders to `~/.claude`, the way `~/.claude-waitron` does, and copies
  `settings.json`. Plugins (superpowers among them) are installed per folder; whether a copy or link
  of `~/.claude/plugins` works is to be checked with one real firing, not assumed.
- **codex:** symlinks `AGENTS.md`, `skills` and `config.toml` to `~/.codex`.

The script refuses a folder that already exists. Logging in stays manual:
`CLAUDE_CONFIG_DIR=<folder> claude` then `/login`, or `CODEX_HOME=<folder> codex login`.

## Testing

New cases in `runner.test.sh`, each run against the real `run.sh` and `runner-lib.sh` in a sandbox,
with a fake `codex` beside the existing fake `claude`, and each watched failing first:

- a Codex lane starts `codex` with `CODEX_HOME` set to its account, and never starts `claude`;
- a Claude lane starts `claude` with `CLAUDE_CONFIG_DIR` set to its account;
- both variables reach the driver whichever engine drives (the reviewer seat's login);
- account A's limit pauses a lane on A and not a lane on B;
- a Codex "usage limit" line pauses its account for one hour and logs the line;
- a missing account folder, and an unknown `ENGINE`, each skip the firing with a log line;
- a Codex lane that keeps writing its event stream is not stopped, and a silent one is;
- the existing cases still pass unchanged against the default settings.

Then one real firing per new configuration before a lane is switched over.

## Out of scope

- Runbook (`RUNNER.md`) changes.
- Choosing which lanes move to which account or engine — the owner edits the three settings.
- Retrying Codex server errors, and parsing a Codex reset time, until a real message is seen.

# Campaign runners: a login per lane, and Codex as a driver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each campaign lane's `run.sh` names which engine drives it (`claude` or `codex`) and which Claude and Codex login folders it uses, and the usage-limit pause is kept per account.

**Architecture:** The three lanes' `run.sh` gain three settings and call a new `run_agent` in the shared `runner-lib.sh`, which exports `CODEX_HOME` and `CLAUDE_CONFIG_DIR` (leaving the latter unset for the default folder) and starts either `claude -p` or `codex exec`. The watchdog and the usage-limit pause learn the two engines. All work happens in a git-tracked STAGING copy; the live files are replaced only in the last task, after real firings from staging.

**Tech Stack:** bash 3.2 (`/bin/bash` on macOS — launchd runs `run.sh` with it), `claude` CLI, `codex-cli` 0.156.1, the existing bash test harness `runner.test.sh`.

**Spec:** `docs/superpowers/specs/2026-09-24-campaign-runner-accounts-and-codex-design.md` — read it before starting any task.

## Global Constraints

- **Never edit a live runner file in place.** The live files are `~/waitron-campaign/run.sh`, `~/waitron-campaign-b/run.sh`, `~/waitron-campaign-c/run.sh`, and everything in `~/waitron-campaign-shared/`. Three lanes fire every 30 minutes and read them. Tasks 1–6 work only in the staging folder `/Users/clintongormley/waitron-runner-dev/`; Task 7 installs by writing `<dest>.new` and then `mv <dest>.new <dest>`, so a firing already running keeps the old file.
- **bash 3.2.** No `declare -A`, no `${var,,}`, no `mapfile`. With `set -u`, an empty array must be expanded as `${arr[@]+"${arr[@]}"}`.
- **Defaults are today's behaviour:** `ENGINE=claude`, `CLAUDE_ACCOUNT=/Users/clintongormley/.claude`, `CODEX_ACCOUNT=/Users/clintongormley/.codex`.
- **The default Claude folder is never exported.** When `CLAUDE_ACCOUNT` is `$HOME/.claude`, `CLAUDE_CONFIG_DIR` is left UNSET. Claude keeps a separate stored login per value of that variable, and unset and `~/.claude` are different values (spec §1: Keychain entries `Claude Code-credentials` vs `Claude Code-credentials-1bf14bbf`). Exporting it would silently move all three lanes onto another login.
- **No `--model` on either engine** (spec §2).
- **Codex's flags, verified 2026-09-24 on codex-cli 0.156.1** by a real `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C <dir> --add-dir /tmp --json -` run: every flag parsed, and the event stream is compact JSON, one event per line, with progress events starting `{"type":"item.`.
- **Comments:** only for a non-obvious why; no history. Keep each file's existing comment density.
- **The runner folders are not git repositories.** Commits happen in the staging folder, which Task 0 makes a git repository.
- **Plain English** in every commit message and log line.

## Review Focus

1. **A running lane reading a half-edited file.** Expected: live files are replaced whole by `mv`, never edited, and only after the full suite and real firings from staging pass (Global Constraints; Tasks 6–7).
2. **Codex output that merely MENTIONS usage limits** (it reads this repository's specs, which say "usage limits"). Expected: no pause. Test in Task 3 (`an agent message about usage limits does not pause`).
3. **Two Claude lanes on the same account.** Expected: one lane's transcripts never keep another, stuck lane alive. Test in Task 3 (`another session's transcripts do not keep a Claude lane alive`).
4. **A Codex lane whose Claude account is paused.** Expected: it still fires, because only the driver's account gates it. Test in Task 3.
5. **A Codex lane's Claude reviewer seat working quietly for longer than the idle limit.** Expected: not killed. Test in Task 3 (`a Claude reviewer seat writing its transcript keeps a Codex lane alive`).

---

## File map (staging folder `/Users/clintongormley/waitron-runner-dev/`)

| Staging path | Installs to | Responsibility |
| --- | --- | --- |
| `shared/runner-lib.sh` | `~/waitron-campaign-shared/runner-lib.sh` | settings check, per-account pause, `run_agent`, watchdog |
| `shared/tests/runner.test.sh` | `~/waitron-campaign-shared/tests/runner.test.sh` | every case, run against each lane's real `run.sh` |
| `shared/new-account.sh` | `~/waitron-campaign-shared/new-account.sh` | makes a new login folder |
| `shared/tests/new-account.test.sh` | `~/waitron-campaign-shared/tests/new-account.test.sh` | its tests |
| `lane-a/run.sh`, `lane-b/run.sh`, `lane-c/run.sh` | `~/waitron-campaign{,-b,-c}/run.sh` | the three lanes |
| — | `~/.claude/skills/watch-campaigns/SKILL.md` | edited in Task 7 (not versioned; back it up first) |

Run the whole suite from staging with:

```bash
RUNNER_TEST_LANES="/Users/clintongormley/waitron-runner-dev/lane-a/run.sh /Users/clintongormley/waitron-runner-dev/lane-b/run.sh /Users/clintongormley/waitron-runner-dev/lane-c/run.sh" \
  bash /Users/clintongormley/waitron-runner-dev/shared/tests/runner.test.sh 2>&1 | tail -40
```

It ends `N passed, M failed` and exits non-zero on any failure. It sleeps a lot (watchdog cases); expect several minutes. Call this **"the staging suite"** below.

---

### Task 0: Staging copy, and a green baseline

**Files:**
- Create: `/Users/clintongormley/waitron-runner-dev/` (copies of the live files)
- Modify: `shared/tests/runner.test.sh` (lane list overridable)

**Interfaces:**
- Produces: `RUNNER_TEST_LANES` — a space-separated list of `run.sh` paths the suite runs against instead of the live three.

- [ ] **Step 1: Copy the live files into staging and start a git history**

```bash
D=/Users/clintongormley/waitron-runner-dev
mkdir -p "$D/shared/tests" "$D/lane-a" "$D/lane-b" "$D/lane-c"
cp ~/waitron-campaign-shared/runner-lib.sh "$D/shared/"
cp ~/waitron-campaign-shared/tests/runner.test.sh "$D/shared/tests/"
cp ~/waitron-campaign/run.sh "$D/lane-a/run.sh"
cp ~/waitron-campaign-b/run.sh "$D/lane-b/run.sh"
cp ~/waitron-campaign-c/run.sh "$D/lane-c/run.sh"
git -C "$D" init -q && git -C "$D" add -A && git -C "$D" commit -q -m "Copy of the live campaign runner files, 2026-09-24"
```

- [ ] **Step 2: Make the lane list overridable**

In `shared/tests/runner.test.sh`, directly after the `LANES=(…)` assignment (lines 12–13), add:

```bash
# RUNNER_TEST_LANES runs the suite against other copies (the staging folder) instead of the live lanes.
[ -n "${RUNNER_TEST_LANES:-}" ] && read -ra LANES <<< "$RUNNER_TEST_LANES"
```

And extend the existing `unset GIT_DIR …` line so the session running the suite cannot lend it a real login folder (in the owner's interactive session `CLAUDE_CONFIG_DIR` is `~/.claude-waitron`, and fakes would write into it):

```bash
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR CLAUDE_CONFIG_DIR CODEX_HOME
```

- [ ] **Step 3: Run the staging suite and confirm it is green before any change**

Run: the staging suite (command above).
Expected: `… passed, 0 failed`, and the `== lane-a` / `== lane-b` / `== lane-c` headers (the directory names of the staging copies). If anything fails here, STOP and report: the baseline is broken, not the change.

- [ ] **Step 4: Commit**

```bash
git -C /Users/clintongormley/waitron-runner-dev commit -qam "Tests: the lane list can point at staging copies"
```

---

### Task 1: Login folders per lane, and `run_agent`

**Files:**
- Modify: `shared/runner-lib.sh`, `lane-a/run.sh`, `lane-b/run.sh`, `lane-c/run.sh`
- Test: `shared/tests/runner.test.sh`

**Interfaces:**
- Consumes: from `run.sh`, the variables `ENGINE`, `CLAUDE_ACCOUNT`, `CODEX_ACCOUNT` (set before the library is sourced), `LOG` (set per firing), `CAMP`, `SHARED`, `REPO`.
- Produces:
  - `lane_settings_ok` — returns 0 when `ENGINE` is `claude` or `codex` and both folders exist; otherwise writes one line to `$LOG` and returns 1.
  - `run_agent <prompt> <extra dir>…` — replaces `run_claude`; same return codes; exports `CODEX_HOME="$CODEX_ACCOUNT"`, and `CLAUDE_CONFIG_DIR="$CLAUDE_ACCOUNT"` unless `CLAUDE_ACCOUNT` is `$HOME/.claude`, in which case it UNSETS `CLAUDE_CONFIG_DIR`. Task 1 implements the `claude` branch only.
  - Library variables `CLAUDE_PROJECTS="$CLAUDE_ACCOUNT/projects"` and `CODEX_SESSIONS="$CODEX_ACCOUNT/sessions"` (the `RUNNER_CLAUDE_PROJECTS` and `RUNNER_CODEX_SESSIONS` overrides are removed).
  - Test-only overrides read by `run.sh`: `RUNNER_ENGINE`, `RUNNER_CLAUDE_ACCOUNT`, `RUNNER_CODEX_ACCOUNT`; test knobs for `fire`: `ENG`, `CL_ACCT`, `CX_ACCT`.

- [ ] **Step 1: Update the harness (sandbox accounts, fake claude records its environment)**

In `shared/tests/runner.test.sh`:

1. In `sandbox()`, change the `mkdir -p` line to also create the two login folders:

```bash
  mkdir -p "$SB/bin" "$SB/camp" "$SB/repo" "$SB/shared" "$SB/claude-acct" "$SB/codex-acct"
```

2. In the fake `claude` heredoc, directly after the line that writes `claude.args`, add:

```bash
printf '%s\n%s\n' "\${CLAUDE_CONFIG_DIR-unset}" "\${CODEX_HOME-unset}" > "$SB/claude.env"
```

3. In the `actions.sh` heredoc, replace the `fake_transcript` and `fake_codex_logs` lines with (they now write where the lane's login folders say, not where a test override said):

```bash
fake_transcript() { local d="\$CLAUDE_CONFIG_DIR/projects/\$(echo "\$PWD" | sed 's|[/.]|-|g')/\$SID/subagents"
                    mkdir -p "\$d"; for i in 1 2 3 4 5 6 7; do echo x >> "\$d/agent.jsonl"; sleep 1; done; }
fake_codex_logs() { mkdir -p "\$CODEX_HOME/sessions"; for i in 1 2 3 4 5 6 7; do echo x >> "\$CODEX_HOME/sessions/r.jsonl"; sleep 1; done; }
```

4. Replace `fire()` with:

```bash
fire() { # fire <run.sh>; IDLE and MAXRUN (seconds) tune the watchdog; ENG, CL_ACCT, CX_ACCT pick the lane's settings
  RUNNER_CAMP="$SB/camp" RUNNER_REPO="$SB/repo" RUNNER_SHARED="$SB/shared" \
    RUNNER_TEST_BIN="$SB/bin" RUNNER_RETRY_DELAY=0 \
    RUNNER_IDLE_LIMIT="${IDLE:-30}" RUNNER_MAX_RUN="${MAXRUN:-600}" \
    RUNNER_WATCH_INTERVAL=1 RUNNER_KILL_GRACE=1 \
    RUNNER_ENGINE="${ENG:-claude}" \
    RUNNER_CLAUDE_ACCOUNT="${CL_ACCT:-$SB/claude-acct}" RUNNER_CODEX_ACCOUNT="${CX_ACCT:-$SB/codex-acct}" \
    bash "$1" >/dev/null 2>&1
}
```

5. Extend the interlock so a `run.sh` that ignores the account overrides is never fired against the real logins. Replace the interlock `if` with:

```bash
  if ! grep -q 'RUNNER_TEST_BIN' "$RUN" || ! grep -q 'RUNNER_CAMP' "$RUN" \
     || ! grep -q 'RUNNER_CLAUDE_ACCOUNT' "$RUN" || ! grep -q 'RUNNER_CODEX_ACCOUNT' "$RUN"; then
    bad "$lane: run.sh honours the test overrides (not firing it)"
    continue
  fi
```

- [ ] **Step 2: Add the failing cases**

Inside the per-lane loop, directly after the first block (the one ending with the `exited rc=0` check and `rm -rf "$SB"`), add:

```bash
  sandbox
  fire "$RUN"
  eq "$lane: claude is given the lane's Claude login folder" "$(sed -n 1p "$SB/claude.env" 2>/dev/null)" "$SB/claude-acct"
  eq "$lane: claude is given the lane's Codex login folder, for its reviewer seat" "$(sed -n 2p "$SB/claude.env" 2>/dev/null)" "$SB/codex-acct"
  if grep -qx -- "--dangerously-skip-permissions" "$SB/claude.args" && grep -qx -- "$SB/camp" "$SB/claude.args"; then
    ok "$lane: claude keeps its permissions flag and the campaign folder"
  else bad "$lane: claude keeps its permissions flag and the campaign folder"; fi
  rm -rf "$SB"

  sandbox
  CL_ACCT=/Users/clintongormley/.claude fire "$RUN"
  eq "$lane: the default Claude folder is not exported (it has its own stored login)" "$(sed -n 1p "$SB/claude.env" 2>/dev/null)" "unset"
  rm -rf "$SB"

  sandbox
  CL_ACCT="$SB/no-such-claude" fire "$RUN"
  eq "$lane: a missing Claude login folder skips the firing" "$(calls)" "0"
  if inlogs "no-such-claude does not exist"; then ok "$lane: the skipped firing names the missing folder"
  else bad "$lane: the skipped firing names the missing folder"; fi
  rm -rf "$SB"

  sandbox
  CX_ACCT="$SB/no-such-codex" fire "$RUN"
  eq "$lane: a missing Codex login folder skips the firing" "$(calls)" "0"
  rm -rf "$SB"
```

- [ ] **Step 3: Run the staging suite and watch the interlock bite**

Expected, per lane: exactly one FAIL, `run.sh honours the test overrides (not firing it)`, and none of that lane's cases run — the staging `run.sh` does not mention the account overrides yet.

- [ ] **Step 4: Add ONLY the three settings to each staging `run.sh`**

In all three staging copies, directly after the `SHARED=` line, add (nothing reads them yet):

```bash
ENGINE="${RUNNER_ENGINE:-claude}"                                       # which engine drives: claude or codex
CLAUDE_ACCOUNT="${RUNNER_CLAUDE_ACCOUNT:-/Users/clintongormley/.claude}" # Claude login: the driver, or the reviewer seat when Codex drives
CODEX_ACCOUNT="${RUNNER_CODEX_ACCOUNT:-/Users/clintongormley/.codex}"    # Codex login: the driver, or the reviewer seat when Claude drives
```

Run the staging suite. Expected FAILs per lane: `claude is given the lane's Claude login folder` (got `unset`), `…Codex login folder…` (got `unset`), `a missing Claude login folder skips the firing` (got `1`), `the skipped firing names the missing folder`, `a missing Codex login folder skips the firing` (got `1`), and `transcript writes keep a firing alive` (the fake now writes under the login folder, which the library does not watch yet). `the default Claude folder is not exported` PASSES already (nothing exports it yet); it guards Step 5. One case is UNRELIABLE at this checkpoint only: `a running Codex seat writing its log keeps a firing alive` — its fake has no `CODEX_HOME` to write under, and the old library watches the real `~/.codex/sessions`, so it passes or fails with whatever else Codex is doing on the machine. Ignore it here; it must pass from Step 7 on. Everything else passes.

- [ ] **Step 5: Implement in the library**

In `shared/runner-lib.sh`:

1. Replace the two lines defining `CLAUDE_PROJECTS` and `CODEX_SESSIONS` with:

```bash
ENGINE="${ENGINE:-claude}"
CLAUDE_ACCOUNT="${CLAUDE_ACCOUNT:-$HOME/.claude}"
CODEX_ACCOUNT="${CODEX_ACCOUNT:-$HOME/.codex}"
CLAUDE_PROJECTS="$CLAUDE_ACCOUNT/projects"
CODEX_SESSIONS="$CODEX_ACCOUNT/sessions"
```

2. Directly after `runner_now() …`, add:

```bash
# lane_settings_ok: true when ENGINE names a known engine and both login
# folders exist. A missing folder skips the firing rather than falling back to
# the default login, so a typo cannot put a lane on the wrong account.
lane_settings_ok() {
  local d
  case "$ENGINE" in
    claude|codex) ;;
    *) echo "Unknown ENGINE '$ENGINE' — skipping this firing." >> "$LOG"; return 1 ;;
  esac
  for d in "$CLAUDE_ACCOUNT" "$CODEX_ACCOUNT"; do
    [ -d "$d" ] || { echo "Login folder $d does not exist — skipping this firing." >> "$LOG"; return 1; }
  done
}
```

3. Replace the whole `run_claude` function (and its comment) with:

```bash
# run_agent <prompt> <extra dir>…: runs one firing of $ENGINE into $LOG under
# the watchdog. The other engine's reviewer seat inherits its login from the
# two exported folders. A server-side API error (the "overloaded" 529 and its
# 5xx siblings) is retried up to RETRIES times; the runbook re-orients from the
# repo, so a retry is only an earlier next firing. A firing the watchdog
# stopped is not retried.
run_agent() {
  local prompt=$1 attempt=0 rc start sid pid dir d dirs=()
  shift
  for d in "$@"; do dirs+=(--add-dir "$d"); done
  export CODEX_HOME="$CODEX_ACCOUNT"
  # Claude keys its stored login on this variable's value, and "unset" is the
  # login the default folder already has; setting it to ~/.claude picks another.
  if [ "$CLAUDE_ACCOUNT" = "$HOME/.claude" ]; then unset CLAUDE_CONFIG_DIR
  else export CLAUDE_CONFIG_DIR="$CLAUDE_ACCOUNT"; fi
  export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS="$RUNNER_CEILING_MS"
  dir="$CLAUDE_PROJECTS/$(echo "$PWD" | sed 's|[/.]|-|g')"
  while :; do
    start=$(wc -c < "$LOG")
    sid=$(uuidgen | tr 'A-Z' 'a-z')
    caffeinate -is claude -p "$prompt" --dangerously-skip-permissions \
      ${dirs[@]+"${dirs[@]}"} --session-id "$sid" >> "$LOG" 2>&1 &
    pid=$!
    watch_firing "$pid" "$sid" "$dir"
    wait "$pid"
    rc=$?
    [ "$rc" -eq 0 ] && return 0
    tail -c +$((start + 1)) "$LOG" | grep -q '^=== watchdog:' && return "$rc"
    tail -c +$((start + 1)) "$LOG" | grep -qE 'API Error: 5(00|02|03|04|29)' || return "$rc"
    attempt=$((attempt + 1))
    [ "$attempt" -gt "$RETRIES" ] && return "$rc"
    echo "=== server-side API error; retry $attempt of $RETRIES in ${RUNNER_RETRY_DELAY:-120}s ===" >> "$LOG"
    sleep "${RUNNER_RETRY_DELAY:-120}"
  done
}
```

- [ ] **Step 6: Finish each lane's `run.sh`** (all three staging copies; the edits are identical except where noted)

1. The three settings are already in place from Step 4.

2. Directly after the `echo "=== … firing $TS ===" >> "$LOG"` line inside the loop, add:

```bash
  lane_settings_ok || exit 0
```

3. Replace the `run_claude -p "$PROMPT" \ … --add-dir …` call with `run_agent`, keeping exactly the folders that lane passes today. Lane A passes only the campaign folder; lanes B and C pass both:

```bash
  run_agent "$PROMPT" "$CAMP"             # lane A
  run_agent "$PROMPT" "$CAMP" "$SHARED"   # lanes B and C
```

4. In each file's header comment, replace `claude -p` with `the lane's engine`, where the header describes what the wrapper launches.

- [ ] **Step 7: Run the staging suite**

Expected: `… passed, 0 failed`.

- [ ] **Step 8: Commit**

```bash
git -C /Users/clintongormley/waitron-runner-dev commit -qam "Runner: each lane names its Claude and Codex login folders"
```

---

### Task 2: The usage-limit pause is kept per account

**Files:**
- Modify: `shared/runner-lib.sh`, the three `run.sh`
- Test: `shared/tests/runner.test.sh`

**Interfaces:**
- Consumes: `ENGINE`, `CLAUDE_ACCOUNT`, `CODEX_ACCOUNT` (Task 1).
- Produces:
  - `account_name <folder>` — the folder path with every `/` and `.` replaced by `-` (e.g. `/Users/x/.claude` → `-Users-x--claude`).
  - `DRIVER_ACCOUNT` — `$CODEX_ACCOUNT` when `ENGINE=codex`, else `$CLAUDE_ACCOUNT`.
  - `LIMIT_MARKER="$SHARED/limits/$(account_name "$DRIVER_ACCOUNT").until"` and `LIMIT_ALERTED="$SHARED/limits/$(account_name "$DRIVER_ACCOUNT").alerted"`, with the same line format as today.

- [ ] **Step 1: Move the existing pause cases to the per-account file, and add the new ones**

In `shared/tests/runner.test.sh`:

1. After the `eq()` helper, add:

```bash
acct() { echo "$1" | sed 's|[/.]|-|g'; }
mark() { mkdir -p "$SB/shared/limits"; echo "$SB/shared/limits/$(acct "$1").until"; } # mark <login folder>: its pause file
```

2. In the existing usage-limit cases, replace every `"$SB/shared/usage-limit-until"` with `"$(mark "$SB/claude-acct")"`, and rename the first check from `writes the shared pause marker` to `writes the account's pause marker`. The assertions themselves (reset time, one alert, progress-log line, skipped firing, expired marker removed, no second alert) stay exactly as they are.

3. Directly after the case that ends `the same limit message seen again after the pause does not alert twice`, add:

```bash
  sandbox
  mkdir -p "$SB/other-acct"
  printf '%s\n%s\n' $(( $(date +%s) + 3600 )) "You've hit your weekly limit · resets Sep 22 at 1am (Europe/Madrid)" > "$(mark "$SB/other-acct")"
  fire "$RUN"
  eq "$lane: another account's pause does not stop this lane" "$(calls)" "1"
  rm -rf "$SB"

  sandbox
  RESET_DAY=$(LC_ALL=C date -v+2d '+%b %-d')
  echo "1|You've hit your weekly limit · resets $RESET_DAY at 1am (Europe/Madrid)" > "$SB/claude.script"
  fire "$RUN"
  if grep -q "$SB/claude-acct" "$SB/camp/progress.log" 2>/dev/null; then ok "$lane: the progress-log line names the paused account"
  else bad "$lane: the progress-log line names the paused account"; fi
  rm -rf "$SB"
```

- [ ] **Step 2: Run the staging suite and watch them fail**

Expected FAILs per lane: `a usage-limit refusal writes the account's pause marker`, `the pause marker holds the reset time`, `an expired pause marker is removed` (the old code never reads, so never removes, the new file) and `the progress-log line names the paused account`. Expected PASSES already: `another account's pause does not stop this lane` (the old code never reads that file — it guards the next step against over-reaching), and `a firing inside the pause does not start claude`, which passes for the wrong reason at this checkpoint: the first firing's OLD-location pause, two days out, is what holds it.

- [ ] **Step 3: Implement**

In `shared/runner-lib.sh`:

1. Replace the `LIMIT_MARKER=` and `LIMIT_ALERTED=` lines with:

```bash
account_name() { echo "$1" | sed 's|[/.]|-|g'; }
case "$ENGINE" in codex) DRIVER_ACCOUNT=$CODEX_ACCOUNT ;; *) DRIVER_ACCOUNT=$CLAUDE_ACCOUNT ;; esac
# One pause per login folder: only lanes driven from the exhausted account wait.
LIMIT_MARKER="$SHARED/limits/$(account_name "$DRIVER_ACCOUNT").until"     # line 1: epoch the pause ends; line 2: the message
LIMIT_ALERTED="$SHARED/limits/$(account_name "$DRIVER_ACCOUNT").alerted"  # the last message the owner was alerted about
```

2. In `note_usage_limit`, directly before `printf '%s\n%s\n' "$until" "$line" > "$LIMIT_MARKER"`, add `mkdir -p "$SHARED/limits"`, and replace the progress-log and notification lines with:

```bash
  echo "$(date '+%Y-%m-%d %H:%M') — usage limit hit on $DRIVER_ACCOUNT; lanes driven from it pause until $when. ($line)" \
    >> "$CAMP/progress.log"
  notify "Waitron runners paused: $DRIVER_ACCOUNT" "$line"
```

3. Replace the file's opening comment paragraph ("Both lanes log in through the same account, so a usage-limit pause is SHARED …") with:

```bash
# A usage-limit pause belongs to a login folder: every lane driven from that
# folder waits, and the owner is alerted once per distinct message.
```

In each lane's `run.sh`, replace the comment line `# ── account usage limit: both lanes share one account, so one pause covers both ─` with `# ── usage limit of the account driving this lane ──`.

- [ ] **Step 4: Run the staging suite**

Expected: `… passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git -C /Users/clintongormley/waitron-runner-dev commit -qam "Runner: a usage-limit pause belongs to one login folder"
```

---

### Task 3: Codex as a driver

**Files:**
- Modify: `shared/runner-lib.sh`
- Test: `shared/tests/runner.test.sh`

**Interfaces:**
- Consumes: `run_agent`, `lane_settings_ok`, `DRIVER_ACCOUNT`, `LIMIT_MARKER` (Tasks 1–2).
- Produces: the `codex` branch of `run_agent`; `tree_has <pid> <program>` (replaces `tree_has_codex <pid>`); the watchdog's "lane log grew" signal; Codex usage-limit detection in `note_usage_limit`.

- [ ] **Step 1: Make the fake `codex` able to drive**

In `sandbox()`, replace the fake `codex` heredoc with the version below. With `exec` as its first argument it plays `$SB/codex.script` the way the fake `claude` plays `claude.script`; with no arguments it stays the silent reviewer seat the existing cases use. Also add a fake Claude reviewer seat in its own folder, so its process is named `claude` without playing the driver's script.

```bash
  cat > "$SB/bin/codex" <<EOF
#!/bin/bash
if [ "\${1:-}" != exec ]; then . "$SB/actions.sh"; fake_codex_logs; exit 0; fi
n=\$(( \$(cat "$SB/codex.count" 2>/dev/null || echo 0) + 1 ))
echo \$n > "$SB/codex.count"
[ \$n -gt 20 ] && { echo "fake codex: too many calls"; exit 1; }
printf '%s\n' "\$@" > "$SB/codex.args"
printf '%s\n%s\n' "\${CLAUDE_CONFIG_DIR-unset}" "\${CODEX_HOME-unset}" > "$SB/codex.env"
cat > "$SB/codex.stdin"
line=\$(sed -n "\${n}p" "$SB/codex.script" 2>/dev/null)
[ -z "\$line" ] && line="0|did some work"
rc=\${line%%|*}; rest=\${line#*|}; out=\$rest; action=""
case "\$rest" in *"|"*) out=\${rest%%|*}; action=\${rest#*|} ;; esac
echo "\$out"
. "$SB/actions.sh"
[ -n "\$action" ] && eval "\$action"
exit "\$rc"
EOF
  mkdir -p "$SB/seat"
  cat > "$SB/seat/claude" <<EOF
#!/bin/bash
d="\$CLAUDE_CONFIG_DIR/projects/-seat"; mkdir -p "\$d"
for i in 1 2 3 4 5 6 7; do echo x >> "\$d/seat.jsonl"; sleep 1; done
EOF
  chmod +x "$SB/seat/claude"
  : > "$SB/codex.script"
```

Add these to the `actions.sh` heredoc:

```bash
fake_stream()       { for i in 1 2 3 4 5 6 7; do echo '{"type":"item.started"}'; sleep 1; done; }
fake_claude_seat()  { "$SB/seat/claude"; }
fake_other_transcript() { local d="\$CLAUDE_CONFIG_DIR/projects/-other-session"
                          mkdir -p "\$d"; for i in 1 2 3 4 5 6 7; do echo x >> "\$d/other.jsonl"; sleep 1; done; }
```

And a counter helper beside `calls()`:

```bash
ccalls()  { cat "$SB/codex.count" 2>/dev/null || echo 0; }
```

- [ ] **Step 2: Add the failing cases**

Inside the per-lane loop, after the chaining cases and before the loop's `done`, add:

```bash
  # ── codex as the driver ──
  sandbox
  ENG=codex fire "$RUN"
  eq "$lane: a Codex lane runs codex once" "$(ccalls)" "1"
  eq "$lane: a Codex lane never starts claude" "$(calls)" "0"
  for flag in exec --dangerously-bypass-approvals-and-sandbox --json -C "$SB/repo" --add-dir "$SB/camp"; do
    if grep -qx -- "$flag" "$SB/codex.args" 2>/dev/null; then ok "$lane: codex is given $flag"
    else bad "$lane: codex is given $flag"; fi
  done
  if grep -q 'project_doc_fallback_filenames=\["CLAUDE.md"\]' "$SB/codex.args" 2>/dev/null; then ok "$lane: codex reads CLAUDE.md"
  else bad "$lane: codex reads CLAUDE.md"; fi
  if grep -qx -- "--model" "$SB/codex.args" 2>/dev/null || grep -qx -- "-m" "$SB/codex.args" 2>/dev/null; then
    bad "$lane: codex is given no model (the account's config decides)"
  else ok "$lane: codex is given no model (the account's config decides)"; fi
  if grep -q "RUNNER.md" "$SB/codex.stdin" 2>/dev/null; then ok "$lane: codex gets the runbook prompt on standard input"
  else bad "$lane: codex gets the runbook prompt on standard input"; fi
  eq "$lane: codex is given the lane's Codex login folder" "$(sed -n 2p "$SB/codex.env" 2>/dev/null)" "$SB/codex-acct"
  eq "$lane: codex is given the lane's Claude login folder, for its reviewer seat" "$(sed -n 1p "$SB/codex.env" 2>/dev/null)" "$SB/claude-acct"
  rm -rf "$SB"

  sandbox
  printf '%s\n' "0|committed|fake_commit" "0|nothing to do" > "$SB/codex.script"
  ENG=codex fire "$RUN"
  eq "$lane: a Codex firing that commits starts the next one at once" "$(ccalls)" "2"
  rm -rf "$SB"

  sandbox
  printf '%s\n' "1|stream error: 503 Service Unavailable" "0|should not run" > "$SB/codex.script"
  ENG=codex fire "$RUN"
  eq "$lane: a failed Codex firing is not retried" "$(ccalls)" "1"
  rm -rf "$SB"

  sandbox
  echo "0|{\"type\":\"turn.started\"}|fake_stream" > "$SB/codex.script"
  t0=$SECONDS; ENG=codex IDLE=3 fire "$RUN"
  if [ "$(ccalls)" = 1 ] && [ $((SECONDS - t0)) -ge 7 ] && inlogs "exited rc=0"; then ok "$lane: a Codex firing streaming events is kept alive"
  else bad "$lane: a Codex firing streaming events is kept alive" "codex calls $(ccalls), took $((SECONDS - t0))s"; fi
  rm -rf "$SB"

  sandbox
  echo "0|{\"type\":\"turn.started\"}|fake_silent" > "$SB/codex.script"
  t0=$SECONDS; ENG=codex IDLE=3 fire "$RUN"
  if [ $((SECONDS - t0)) -lt 15 ] && inlogs "no activity"; then ok "$lane: a silent Codex firing is stopped"
  else bad "$lane: a silent Codex firing is stopped" "took $((SECONDS - t0))s"; fi
  rm -rf "$SB"

  sandbox
  echo "0|{\"type\":\"item.started\"}|fake_claude_seat" > "$SB/codex.script"
  t0=$SECONDS; ENG=codex IDLE=3 fire "$RUN"
  if [ "$(ccalls)" = 1 ] && [ $((SECONDS - t0)) -ge 7 ] && inlogs "exited rc=0"; then ok "$lane: a Claude reviewer seat writing its transcript keeps a Codex lane alive"
  else bad "$lane: a Claude reviewer seat writing its transcript keeps a Codex lane alive" "codex calls $(ccalls), took $((SECONDS - t0))s"; fi
  rm -rf "$SB"

  sandbox
  echo "0|idle|fake_other_transcript" > "$SB/claude.script"
  IDLE=3 fire "$RUN"
  if inlogs "no activity"; then ok "$lane: another session's transcripts do not keep a Claude lane alive"
  else bad "$lane: another session's transcripts do not keep a Claude lane alive"; fi
  rm -rf "$SB"

  sandbox
  echo "1|{\"type\":\"error\",\"message\":\"You've hit your usage limit. Try again later.\"}" > "$SB/codex.script"
  ENG=codex fire "$RUN"
  until_=$(head -1 "$(mark "$SB/codex-acct")" 2>/dev/null || echo 0)
  now_=$(date +%s)
  if [ "$until_" -gt $((now_ + 3500)) ] && [ "$until_" -le $((now_ + 3600)) ]; then ok "$lane: a Codex usage-limit error pauses its account for an hour"
  else bad "$lane: a Codex usage-limit error pauses its account for an hour" "marker held [$until_], now $now_"; fi
  if grep -q 'hit your usage limit' "$SB/camp/progress.log" 2>/dev/null; then ok "$lane: the Codex limit message is kept in the progress log"
  else bad "$lane: the Codex limit message is kept in the progress log"; fi
  if [ -f "$(mark "$SB/claude-acct")" ] && [ -s "$(mark "$SB/claude-acct")" ]; then bad "$lane: a Codex limit does not pause the Claude account"
  else ok "$lane: a Codex limit does not pause the Claude account"; fi
  rm -rf "$SB"

  sandbox
  echo "0|{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"usage limits, trial terms\"}}" > "$SB/codex.script"
  ENG=codex fire "$RUN"
  if [ -s "$(mark "$SB/codex-acct")" ]; then bad "$lane: an agent message about usage limits does not pause"
  else ok "$lane: an agent message about usage limits does not pause"; fi
  rm -rf "$SB"

  sandbox
  printf '%s\n%s\n' $(( $(date +%s) + 3600 )) "paused" > "$(mark "$SB/claude-acct")"
  ENG=codex fire "$RUN"
  eq "$lane: a Codex lane ignores a pause on its Claude account" "$(ccalls)" "1"
  rm -rf "$SB"

  sandbox
  printf '%s\n%s\n' $(( $(date +%s) + 3600 )) "paused" > "$(mark "$SB/codex-acct")"
  ENG=codex fire "$RUN"
  eq "$lane: a Codex lane waits out a pause on its Codex account" "$(ccalls)" "0"
  rm -rf "$SB"

  sandbox
  ENG=gemini fire "$RUN"
  eq "$lane: an unknown engine starts neither claude nor codex" "$(calls)$(ccalls)" "00"
  if inlogs "Unknown ENGINE 'gemini'"; then ok "$lane: the unknown engine is named in the log"
  else bad "$lane: the unknown engine is named in the log"; fi
  rm -rf "$SB"
```

Note on the `mark` helper: it creates `limits/` as a side effect; the checks above therefore test the file's SIZE (`-s`), never only its existence.

- [ ] **Step 3: Run the staging suite and watch them fail**

Expected FAILs per lane: every `a Codex lane …`/`codex is given …` case (codex is never started: `ccalls` is `0`, and `calls` is `1`), `a failed Codex firing is not retried`, `a silent Codex firing is stopped`, `a Codex firing streaming events is kept alive`, `a Claude reviewer seat …`, the three Codex usage-limit checks except `a Codex limit does not pause the Claude account`, and `a Codex lane ignores a pause on its Claude account`. Expected PASSES already: `another session's transcripts do not keep a Claude lane alive`, `an agent message about usage limits does not pause`, `a Codex limit does not pause the Claude account` and `an unknown engine …` (Task 1's `lane_settings_ok` already refuses it) — these guard the implementation below against over-reaching — and two that pass only vacuously here, because codex is never started at all yet: `a Codex lane waits out a pause on its Codex account` and `codex is given no model`. Both mean something only after Step 4.

- [ ] **Step 4: Implement**

In `shared/runner-lib.sh`:

1. Replace `tree_has_codex` (and its comment) with:

```bash
# tree_has <pid> <program>: true if that program (or a script by that name) runs in the tree.
tree_has() {
  ps -axo pid=,ppid=,command= | awk -v root="$1" -v prog="$2" '
    { par[$1] = $2; cmd = $0; sub(/^ *[0-9]+ +[0-9]+ +/, "", cmd); c[$1] = cmd }
    END { re = "(^|/)" prog "( |$)"
          for (p in par) { q = p; while (q != "" && q > 1) { if (q == root) { if (c[p] ~ re) found = 1; break } q = par[q] } }
          exit !found }'
}
```

2. In `watch_firing`, replace its comment's "Work is any of: …" sentence and the two activity lines (the session-transcript `find` and the `tree_has_codex` block) with:

```bash
# Work is any of: a write to this firing's log (a Codex driver streams its
# events there), a write to this Claude session's transcripts (subagents
# included), a write by the OTHER engine's reviewer seat to its own logs while
# that seat runs in the tree, or the tree using more than a tenth of a core. A
# firing that is only waiting measured ~2%.
```

```bash
    [ -n "$(find "$LOG" -newer "$stamp" 2>/dev/null)" ] && active=1
    [ $active -eq 0 ] && [ -n "$(find "$dir/$sid.jsonl" "$dir/$sid" -type f -newer "$stamp" 2>/dev/null | head -1)" ] && active=1
    if [ $active -eq 0 ] && tree_has "$pid" "$seat"; then
      [ -n "$(find "$seat_logs" -type f -newer "$stamp" 2>/dev/null | head -1)" ] && active=1
    fi
```

and, before the `while` loop in `watch_firing`, add (and add `seat seat_logs` to its `local` line):

```bash
  if [ "$ENGINE" = codex ]; then seat=claude seat_logs=$CLAUDE_PROJECTS; else seat=codex seat_logs=$CODEX_SESSIONS; fi
```

The seat check is keyed to the OTHER engine on purpose: in a Claude lane, `claude` is always in the tree, so watching all of `$CLAUDE_PROJECTS` would let another lane on the same account keep a stuck firing alive.

3. In `run_agent`, replace the single `caffeinate -is claude …` launch with:

```bash
    if [ "$ENGINE" = codex ]; then
      caffeinate -is codex exec --dangerously-bypass-approvals-and-sandbox -C "$REPO" \
        ${dirs[@]+"${dirs[@]}"} -c 'shell_environment_policy.inherit="all"' \
        -c project_doc_max_bytes=131072 -c 'project_doc_fallback_filenames=["CLAUDE.md"]' \
        --json - <<< "$prompt" >> "$LOG" 2>&1 &
    else
      caffeinate -is claude -p "$prompt" --dangerously-skip-permissions \
        ${dirs[@]+"${dirs[@]}"} --session-id "$sid" >> "$LOG" 2>&1 &
    fi
```

and, directly after the `grep -q '^=== watchdog:'` line, add:

```bash
    [ "$ENGINE" = claude ] || return "$rc"   # what a Codex server failure prints is not known; wait for the next tick
```

4. In `note_usage_limit`, replace its first two lines (`line=$(grep -o …)` and `[ -z "$line" ] && return 0`) and the `until=$(reset_epoch …)` line with:

```bash
  if [ "$ENGINE" = codex ]; then
    # Codex's limit wording has not been seen on this machine: match loosely, but
    # skip item events, which carry text Codex merely read or wrote.
    line=$(grep -i 'usage limit' "$1" | grep -v '^{"type":"item\.' | tail -1)
    [ -z "$line" ] && return 0
    until=$(( $(runner_now) + 3600 ))
  else
    line=$(grep -o "You've hit your [a-z ]*limit · resets .*" "$1" | tail -1)
    [ -z "$line" ] && return 0
    until=$(reset_epoch "${line#*resets }")
  fi
```

- [ ] **Step 5: Run the staging suite**

Expected: `… passed, 0 failed`.

- [ ] **Step 6: Prove the two watchdog guards by deletion**

a) In `watch_firing`, temporarily replace the `if [ "$ENGINE" = codex ]; then seat=claude …` line with `seat=claude seat_logs=$CLAUDE_PROJECTS` (the seat check keyed to the driver's own engine). Run the staging suite. Expected FAILs: `another session's transcripts do not keep a Claude lane alive` and `a running Codex seat writing its log keeps a firing alive`. Restore. (Replacing `tree_has "$pid" "$seat"` with `true` instead does NOT fail the first case — measured by the plan review — because in a Claude lane `claude` is always in the tree anyway.)
b) Temporarily delete the `grep -v '^{"type":"item\.'` stage in `note_usage_limit`. Expected FAIL: `an agent message about usage limits does not pause`. Restore.
Run the staging suite once more: `0 failed`.

- [ ] **Step 7: Commit**

```bash
git -C /Users/clintongormley/waitron-runner-dev commit -qam "Runner: a lane can be driven by Codex"
```

---

### Task 4: `new-account.sh`

**Files:**
- Create: `shared/new-account.sh`, `shared/tests/new-account.test.sh`

**Interfaces:**
- Produces: `new-account.sh claude|codex <folder>`; exit 0 on success, 1 when refused (folder exists, or a source item is missing), 2 on bad usage. Test overrides: `NEW_ACCOUNT_CLAUDE_SRC`, `NEW_ACCOUNT_CODEX_SRC`.

- [ ] **Step 1: Write the failing tests**

Create `shared/tests/new-account.test.sh`:

```bash
#!/bin/bash
# Tests for new-account.sh, against fake source folders.
# Run: bash ~/waitron-campaign-shared/tests/new-account.test.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$(dirname "$HERE")/new-account.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; [ $# -gt 1 ] && echo "       $2"; }
eq()  { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

MEM="- -Users-clintongormley-workspace-repos-waitron -Users-clintongormley-workspace-waitron"

sources() {
  T=$(mktemp -d "${TMPDIR:-/tmp}/new-account-test.XXXXXX")
  C="$T/claude-src"; X="$T/codex-src"
  mkdir -p "$C/commands" "$C/skills" "$C/agents" "$X/skills"
  echo i > "$C/CLAUDE.md"; echo d > "$C/docs-writing-style.md"; echo '{"s":1}' > "$C/settings.json"
  for m in $MEM; do mkdir -p "$C/projects/$m/memory"; done
  echo a > "$X/AGENTS.md"; echo 'model = "x"' > "$X/config.toml"
}
run() { NEW_ACCOUNT_CLAUDE_SRC="$C" NEW_ACCOUNT_CODEX_SRC="$X" bash "$SCRIPT" "$@" >/dev/null 2>&1; }

echo "== claude"
sources
run claude "$T/acct"; eq "a claude folder is made" "$?" "0"
for f in CLAUDE.md commands skills agents docs-writing-style.md; do
  eq "$f is linked to the source" "$(readlink "$T/acct/$f")" "$C/$f"
done
if [ -f "$T/acct/settings.json" ] && [ ! -L "$T/acct/settings.json" ]; then ok "settings.json is a copy, not a link"
else bad "settings.json is a copy, not a link"; fi
eq "settings.json keeps the source's content" "$(cat "$T/acct/settings.json")" '{"s":1}'
for m in $MEM; do eq "memory folder $m is linked" "$(readlink "$T/acct/projects/$m/memory")" "$C/projects/$m/memory"; done
if [ -e "$T/acct/plugins" ]; then bad "plugins are left for the owner to install"; else ok "plugins are left for the owner to install"; fi
rm -rf "$T"

echo "== codex"
sources
run codex "$T/cx"; eq "a codex folder is made" "$?" "0"
for f in AGENTS.md skills config.toml; do eq "$f is linked to the source" "$(readlink "$T/cx/$f")" "$X/$f"; done
if [ -e "$T/cx/auth.json" ]; then bad "the login is not copied"; else ok "the login is not copied"; fi
rm -rf "$T"

echo "== refusals"
sources
mkdir "$T/exists"; echo keep > "$T/exists/f"
run claude "$T/exists"; eq "an existing folder is refused" "$?" "1"
eq "the existing folder is untouched" "$(ls "$T/exists")" "f"
run gemini "$T/g"; eq "an unknown kind is a usage error" "$?" "2"
run claude; eq "a missing folder argument is a usage error" "$?" "2"
rm "$C/docs-writing-style.md"
run claude "$T/partial"; eq "a missing source item is refused" "$?" "1"
if [ -e "$T/partial" ]; then bad "a refused run creates nothing"; else ok "a refused run creates nothing"; fi
rm -rf "$T"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bash /Users/clintongormley/waitron-runner-dev/shared/tests/new-account.test.sh`
Expected: every case FAILs except four — the three that expect something to be ABSENT (`plugins …`, `the login is not copied`, `a refused run creates nothing`) and `the existing folder is untouched` — because the script does not exist (`bash` exits 127).

- [ ] **Step 3: Implement**

Create `shared/new-account.sh`:

```bash
#!/bin/bash
# new-account.sh claude|codex <folder>: a new login folder for a campaign lane,
# sharing instructions, skills and waitron memories with the default one.
# Logging in, and for claude installing plugins, stay manual (see the spec,
# docs/superpowers/specs/2026-09-24-campaign-runner-accounts-and-codex-design.md §7).
set -eu
SRC_CLAUDE="${NEW_ACCOUNT_CLAUDE_SRC:-$HOME/.claude}"
SRC_CODEX="${NEW_ACCOUNT_CODEX_SRC:-$HOME/.codex}"
MEMORY_FOLDERS="- -Users-clintongormley-workspace-repos-waitron -Users-clintongormley-workspace-waitron"

usage() { echo "usage: new-account.sh claude|codex <folder>" >&2; exit 2; }
[ $# -eq 2 ] || usage
kind=$1 dir=$2
case "$kind" in
  claude) src=$SRC_CLAUDE links="CLAUDE.md commands skills agents docs-writing-style.md" ;;
  codex)  src=$SRC_CODEX  links="AGENTS.md skills config.toml" ;;
  *) usage ;;
esac
[ -e "$dir" ] && { echo "new-account.sh: $dir already exists" >&2; exit 1; }

# Check every source before creating anything, so a refusal leaves nothing behind.
need="$links"
[ "$kind" = claude ] && need="$need settings.json"
for f in $need; do
  [ -e "$src/$f" ] || { echo "new-account.sh: $src/$f is missing" >&2; exit 1; }
done
if [ "$kind" = claude ]; then
  for m in $MEMORY_FOLDERS; do
    [ -d "$src/projects/$m/memory" ] || { echo "new-account.sh: $src/projects/$m/memory is missing" >&2; exit 1; }
  done
fi

mkdir -p "$dir"
for f in $links; do ln -s "$src/$f" "$dir/$f"; done
if [ "$kind" = claude ]; then
  cp "$src/settings.json" "$dir/settings.json"
  for m in $MEMORY_FOLDERS; do
    mkdir -p "$dir/projects/$m"
    ln -s "$src/projects/$m/memory" "$dir/projects/$m/memory"
  done
  echo "Made $dir. Next: CLAUDE_CONFIG_DIR=$dir claude, then /login, then /plugin install for each plugin $src has."
else
  echo "Made $dir. Next: CODEX_HOME=$dir codex login"
fi
```

The loop variable `m` holds `-` for the root memory folder; `ln -s` and `mkdir -p` receive it inside a path (`$dir/projects/-`), never as a bare argument, so it is not read as an option.

- [ ] **Step 4: Run it**

Run: `bash /Users/clintongormley/waitron-runner-dev/shared/tests/new-account.test.sh`
Expected: `… passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
chmod +x /Users/clintongormley/waitron-runner-dev/shared/new-account.sh
git -C /Users/clintongormley/waitron-runner-dev add -A && git -C /Users/clintongormley/waitron-runner-dev commit -qm "new-account.sh: make a login folder for a lane"
```

---

### Task 5: Whole-suite check of the staging copy

**Files:** none changed.

- [ ] **Step 1: Run both suites from staging**

```bash
RUNNER_TEST_LANES="/Users/clintongormley/waitron-runner-dev/lane-a/run.sh /Users/clintongormley/waitron-runner-dev/lane-b/run.sh /Users/clintongormley/waitron-runner-dev/lane-c/run.sh" \
  bash /Users/clintongormley/waitron-runner-dev/shared/tests/runner.test.sh 2>&1 | tail -5; echo "runner suite exit: ${PIPESTATUS[0]}"
bash /Users/clintongormley/waitron-runner-dev/shared/tests/new-account.test.sh 2>&1 | tail -2; echo "new-account suite exit: ${PIPESTATUS[0]}"
```

Expected: both `0 failed`, both exits `0`.

- [ ] **Step 2: Check that no orphaned fake process was left behind**

Run: `pgrep -fl 'runner-test\.' || echo none`
Expected: `none`.

- [ ] **Step 3: Diff each staging `run.sh` against its live original**

Run: `for l in a b c; do s=$([ $l = a ] && echo "" || echo "-$l"); diff ~/waitron-campaign$s/run.sh /Users/clintongormley/waitron-runner-dev/lane-$l/run.sh; done`
Expected: only the Task 1 and Task 2 edits (three settings, `lane_settings_ok`, `run_agent`, two comment lines). If a live `run.sh` changed since Task 0 (someone edited it during the work), the diff shows a line this plan did not write — STOP and merge that change into staging first, then rerun Step 1.

---

### Task 6: Real firings from the staging copy, before anything is installed

The suites prove the wrapper against FAKE engines. This task starts the REAL `claude` and `codex` through the STAGING `run.sh` and library, in a scratch campaign folder whose runbook only records which login folders the engine was given. It runs BEFORE the install, so a wrong login is found while the live lanes are still on the old code.

**Files:** a scratch folder only: `/Users/clintongormley/waitron-runner-dev/smoke/`.

- [ ] **Step 1: Make the scratch campaign**

```bash
D=/Users/clintongormley/waitron-runner-dev; S=$D/smoke && mkdir -p "$S/camp" "$S/shared"
cp "$D/shared/runner-lib.sh" "$S/shared/"
cat > "$S/camp/RUNNER.md" <<'EOF'
This is a smoke test of the campaign runner, not a campaign. Do exactly this and nothing else:
run the shell command  echo "${CLAUDE_CONFIG_DIR-unset} ${CODEX_HOME-unset}" > /Users/clintongormley/waitron-runner-dev/smoke/camp/done.txt
and then stop.
EOF
sed "s|/Users/clintongormley/waitron-campaign-b/RUNNER.md|$S/camp/RUNNER.md|" "$D/lane-b/run.sh" > "$S/run.sh"
grep -c "$S/camp/RUNNER.md" "$S/run.sh"
```

Expected: `1` (the prompt now points at the smoke runbook). If `0`, lane B's prompt text changed: edit `$S/run.sh`'s `PROMPT=` line by hand to name `$S/camp/RUNNER.md`.

- [ ] **Step 2: Three real firings**

Run these from a shell where `CLAUDE_CONFIG_DIR` is SET to something else (in the owner's interactive session it is `~/.claude-waitron`; check with `echo "${CLAUDE_CONFIG_DIR-unset}"`, and if it is unset, prefix each command with `CLAUDE_CONFIG_DIR=/Users/clintongormley/.claude-waitron`). That makes the probe discriminate: a runner that forgot to unset it for the default folder would print `~/.claude-waitron` below, not `unset`.

```bash
S=/Users/clintongormley/waitron-runner-dev/smoke
smoke() { rm -rf "$S/camp/logs" "$S/camp/done.txt"; RUNNER_CAMP="$S/camp" RUNNER_SHARED="$S/shared" RUNNER_REPO=/Users/clintongormley/workspace/repos/waitron "$@" bash "$S/run.sh"; echo "done.txt: $(cat "$S/camp/done.txt" 2>/dev/null)"; tail -1 "$(ls -t "$S"/camp/logs/run-*.log | head -1)"; }
smoke env                                                               # a default Claude lane
smoke env RUNNER_ENGINE=codex                                           # a default Codex lane
smoke env RUNNER_CLAUDE_ACCOUNT=/Users/clintongormley/.claude-waitron   # a Claude lane on another login folder
```

Expected, in order:

| Firing | `done.txt` | last log line |
| --- | --- | --- |
| default Claude | `unset /Users/clintongormley/.codex` | `=== firing … exited rc=0 ===` |
| default Codex | `unset /Users/clintongormley/.codex` | `=== firing … exited rc=0 ===` |
| Claude on `~/.claude-waitron` | `/Users/clintongormley/.claude-waitron /Users/clintongormley/.codex` | `=== firing … exited rc=0 ===` |

The third firing is the feature itself working end to end: `~/.claude-waitron` is a separate, logged-in config folder. If any firing writes no `done.txt` and exits 0, suspect the prompt path in Step 1, not the engine. If the first shows `/Users/clintongormley/.claude-waitron`, the default-folder unset is broken: STOP, fix it in staging (Task 1), rerun the suites, then this step.

- [ ] **Step 3: Keep the three log tails for the owner's report, then delete `smoke/`.**

---

### Task 7: Install, and bring the `watch-campaigns` skill up to date

**Files:**
- Install: the seven staging files (file map).
- Modify: `~/.claude/skills/watch-campaigns/SKILL.md` — the `## The lanes` opening (around line 99), the skip-reasons sentence in the `Logs and lock` bullet (around line 158), the watchdog bullet, and the `Usage-limit pause` bullet (around lines 170–176).
- Move: `~/waitron-campaign-shared/usage-limit-alerted` (and `usage-limit-until`, if present) into `~/waitron-campaign-shared/limits/` under the default folder's name.
- Leave alone: `~/waitron-campaign-b/run-slice1.sh`. It is the retired slice-1 wrapper, not scheduled by launchd, and it calls `run_claude`, which the new library no longer has — so it would fail if run by hand. Say so in the report to the owner; do not change it.

- [ ] **Step 1: Back up everything this task replaces**

```bash
B=/Users/clintongormley/waitron-runner-dev/backup-live && mkdir -p "$B"
cp ~/waitron-campaign-shared/runner-lib.sh "$B/runner-lib.sh"
cp ~/waitron-campaign-shared/tests/runner.test.sh "$B/runner.test.sh"
for l in "" -b -c; do cp ~/waitron-campaign$l/run.sh "$B/run$l.sh"; done
cp ~/.claude/skills/watch-campaigns/SKILL.md "$B/watch-campaigns-SKILL.md"
```

- [ ] **Step 2: Install by rename, library first**

```bash
D=/Users/clintongormley/waitron-runner-dev
cp "$D/shared/runner-lib.sh" ~/waitron-campaign-shared/runner-lib.sh.new && mv ~/waitron-campaign-shared/runner-lib.sh.new ~/waitron-campaign-shared/runner-lib.sh
cp "$D/shared/tests/runner.test.sh" ~/waitron-campaign-shared/tests/runner.test.sh.new && mv ~/waitron-campaign-shared/tests/runner.test.sh.new ~/waitron-campaign-shared/tests/runner.test.sh
cp "$D/shared/tests/new-account.test.sh" ~/waitron-campaign-shared/tests/new-account.test.sh
cp "$D/shared/new-account.sh" ~/waitron-campaign-shared/new-account.sh && chmod +x ~/waitron-campaign-shared/new-account.sh
cp "$D/lane-a/run.sh" ~/waitron-campaign/run.sh.new   && mv ~/waitron-campaign/run.sh.new ~/waitron-campaign/run.sh
cp "$D/lane-b/run.sh" ~/waitron-campaign-b/run.sh.new && mv ~/waitron-campaign-b/run.sh.new ~/waitron-campaign-b/run.sh
cp "$D/lane-c/run.sh" ~/waitron-campaign-c/run.sh.new && mv ~/waitron-campaign-c/run.sh.new ~/waitron-campaign-c/run.sh
mkdir -p ~/waitron-campaign-shared/limits
[ -f ~/waitron-campaign-shared/usage-limit-alerted ] && mv ~/waitron-campaign-shared/usage-limit-alerted ~/waitron-campaign-shared/limits/-Users-clintongormley--claude.alerted
[ -f ~/waitron-campaign-shared/usage-limit-until ] && mv ~/waitron-campaign-shared/usage-limit-until ~/waitron-campaign-shared/limits/-Users-clintongormley--claude.until
ls -la ~/waitron-campaign/run.sh ~/waitron-campaign-b/run.sh ~/waitron-campaign-c/run.sh ~/waitron-campaign-shared/limits/
```

What the renames leave running: a firing already under way holds the OLD `run.sh` open and sourced the OLD library when it started, and its chained firings stay in that same bash process, so it finishes on old code throughout. The one mismatch is a firing that starts in the moment between the library's rename and its own `run.sh`'s rename: old `run.sh`, new library, so `run_claude: command not found`. That firing exits non-zero, does not chain, and the lane's next scheduled firing runs on new code. Accepted rather than guarded.

- [ ] **Step 3: Run the installed suites against the live lanes' `run.sh`**

```bash
bash ~/waitron-campaign-shared/tests/runner.test.sh 2>&1 | tail -3
bash ~/waitron-campaign-shared/tests/new-account.test.sh 2>&1 | tail -2
```

Expected: both `0 failed`. (The runner suite never fires a real engine: its interlock refuses a `run.sh` that ignores the overrides, and every case runs with fake binaries first on `PATH`.)

- [ ] **Step 4: Update the `watch-campaigns` skill**

In `~/.claude/skills/watch-campaigns/SKILL.md`:

1. In `## The lanes`, replace `All lanes are unattended \`claude -p\` runners` with `All lanes are unattended runners — \`claude -p\` or \`codex exec\`, as each lane's \`ENGINE\` setting says —`.

2. In the `Logs and lock` bullet, replace `A
  firing skipped for Docker down (lane A), low memory (lanes B and C) or a usage-limit pause writes a
  short log saying which.` with `A firing skipped for Docker down (lane A), low memory (lanes B and C), a usage-limit pause, a
  missing login folder or an unknown \`ENGINE\` writes a short log saying which.`

3. In the watchdog bullet, replace `the run's transcripts, its Codex seat's log and its CPU use all went quiet` with `the firing's log, its transcripts, its reviewer seat's log and its CPU use all went quiet`.

4. Replace the whole `- **Usage-limit pause = …**` bullet with:

```markdown
- **Usage-limit pause = one file per login folder, `~/waitron-campaign-shared/limits/<name>.until`**,
  where `<name>` is the folder's path with `/` and `.` replaced by `-` (`~/.claude` is
  `-Users-clintongormley--claude`). Each lane's `run.sh` names its `ENGINE` (`claude` or `codex`)
  and its two login folders, `CLAUDE_ACCOUNT` and `CODEX_ACCOUNT`. When the DRIVER's account is
  refused for its limit, `run.sh` (via `~/waitron-campaign-shared/runner-lib.sh`) writes that file —
  line 1 the reset time in epoch seconds, line 2 the message — and every lane DRIVEN FROM THAT
  ACCOUNT skips firings until then; lanes on other accounts carry on. It also appends one line
  naming the account to the lane's `progress.log` and sends one macOS notification per distinct
  message. A Codex limit pauses its account for one hour, because Codex's reset wording has not been
  seen yet. The pause lifts on its own; do not delete the file to "unstick" a lane before the reset
  time, since the next firing just hits the limit again. A lane on the default `~/.claude` runs with
  `CLAUDE_CONFIG_DIR` UNSET — Claude keeps a separate stored login for "unset" and for
  "`~/.claude`", so a fresh login for the default lanes is `claude` then `/login` with the variable
  unset, never `CLAUDE_CONFIG_DIR=~/.claude claude`.
```

Check afterwards: `grep -n 'usage-limit-until\|claude -p. runners' ~/.claude/skills/watch-campaigns/SKILL.md` prints nothing.

- [ ] **Step 5: Confirm the next real firing of each lane ran on the new files**

For each lane, wait for its next scheduled firing (or, if the owner agrees, `launchctl kickstart gui/$(id -u)/<label>` — labels `com.waitron.campaign`, `com.waitron.campaign.b`, `com.waitron.campaign.c`), then read its newest log:

```bash
for l in "" -b -c; do f=$(ls -t ~/waitron-campaign$l/logs/run-*.log | head -1); echo "== $f"; head -3 "$f"; grep -E 'does not exist|Unknown ENGINE|command not found|exited rc=' "$f"; done
```

Expected: no `does not exist`, `Unknown ENGINE` or `command not found` line; the firing either is still running or ends `exited rc=…`. A firing that started before the install shows the old behaviour and proves nothing: check its start time is after the `mv`s in Step 2.

- [ ] **Step 6: Report to the owner**: the Task 6 table as observed, each lane's first post-install log line, and the `run-slice1.sh` note.

Setting a lane to a NEW account (making the folder with `new-account.sh`, logging in, installing plugins, then editing that lane's `CLAUDE_ACCOUNT`/`CODEX_ACCOUNT`/`ENGINE`) is the owner's step and is not part of this plan.

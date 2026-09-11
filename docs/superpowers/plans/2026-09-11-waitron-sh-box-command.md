# waitron.sh box command — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three `deploy/` scripts with one `deploy/waitron.sh` carrying two verbs, `install [ref]` and `reset [--all]`, and add the same reachability links to the setup wizard's finish screen.

**Architecture:** `waitron.sh` folds together what `install.sh` (run-from-web fetch), `prepare.sh` (Docker + password + start) and `try-branch.sh` (build a branch image) do today. `install` records its image choice in `.env` so the box stays on what was installed; `reset` wipes the box back to a clean state, keeping the certificate, and refuses on a production box because a wipe re-mints the AEAT fiscal chain. All box shell behaviour is proven by a run-it test that executes the script under stub `docker`/`curl` on `PATH`, the pattern `scripts/reap-testcontainers.test.mjs` already uses.

**Tech Stack:** Bash, Docker Compose, Vitest (root project, `scripts/**`), Lit (`apps/setup`).

**Spec:** `docs/superpowers/specs/2026-09-11-waitron-sh-box-command-design.md`

## Global Constraints

- **Box hostname is `waitron.local`.** The QR/reach URL is `https://waitron.local`, one copy of `boot.ts`'s `BOX_HOSTNAME`, pinned across the image env, compose and this script by `scripts/deploy-image-env.test.ts`.
- **Compose project name is `waitron`** (`deploy/compose.yml` `name: waitron`), so the named volumes are `waitron_db`, `waitron_state`, `waitron_logs`, `waitron_media`, `waitron_backups`, `waitron_mailpit`, `waitron_print_agent`.
- **`WAITRON_DIR` defaults to `/opt/waitron`** and holds the box's `compose.yml`, `.env`, `.env.example`.
- **The public repo is `clintongormley/waitron`.** Raw base `https://raw.githubusercontent.com/clintongormley/waitron`; git context `https://github.com/clintongormley/waitron.git#<ref>`.
- **`.env`'s `POSTGRES_PASSWORD` line is written once and never touched again.** No verb overwrites it.
- **Repo-wide guards live in the root Vitest project** (`scripts/**`, run by ci.yml's `lint` job and the pre-push hook on every non-docs push); it is not typechecked (CLAUDE.md §2/§4).
- **Every commit is `git commit -s`.**

---

## File Structure

- `deploy/waitron.sh` — **new**, the one box command.
- `deploy/install.sh`, `deploy/prepare.sh`, `deploy/try-branch.sh` — **deleted**.
- `deploy/README.md` — **modified**, new usage + reset section, try-branch section removed.
- `deploy/compose.yml`, `deploy/.env.example`, `deploy/Dockerfile` — **modified** comments only (names of the deleted scripts).
- `apps/server/src/boot.ts` — **modified** comment only (hostname-copy list).
- `scripts/changed-scope.mjs` — **modified** comment only (image-input file list).
- `scripts/deploy-image-env.test.ts` — **modified**, the installer + try-branch describe-blocks become one `waitron.sh` block; the `PREPARE` read moves to `waitron.sh`.
- `scripts/changed-scope.test.mjs` — **modified**, `deploy/prepare.sh` → `deploy/waitron.sh` in the image-input list.
- `scripts/waitron-sh.test.mjs` — **new**, the run-it test that executes the script under stubs.
- `apps/setup/src/screens/done-screen.ts` + `done-screen.test.ts` — **modified**, add the reachability links.
- `CLAUDE.md`, `docs/backlog.md` — **modified**, reword the entries naming the deleted scripts.

The spec is committed already (branch's first commit); this plan is committed with it.

---

## Task 1: `waitron.sh` with `install` (published main image), old scripts retired

Creates the script with argument dispatch and the whole `install` flow for `main`: install Docker if missing, mint the password once, fetch `compose.yml`/`.env.example` from the ref, remove any image-override lines, pull, start, wait healthy, print the links. Deletes the three old scripts and rewrites the guards so the suite stays green.

**Files:**
- Create: `deploy/waitron.sh`
- Create: `scripts/waitron-sh.test.mjs`
- Delete: `deploy/install.sh`, `deploy/prepare.sh`, `deploy/try-branch.sh`
- Modify: `scripts/deploy-image-env.test.ts` (remove the two old describe-blocks + `PREPARE` const; move the hostname read to `waitron.sh`; add a `waitron.sh` block with the assertions true after this task)
- Modify: `scripts/changed-scope.test.mjs:132` (`deploy/prepare.sh` → `deploy/waitron.sh`)

**Interfaces:**
- Produces: `deploy/waitron.sh` with a `install [ref]` verb (this task: `ref` defaults to `main`; the branch path is Task 2) and helper functions `die`, `usage`, `fetch`, `ensure_docker`, `ensure_env_password`, `env_set`, `env_unset`, `fetch_box_files`, `select_image`, `print_links`, `wait_healthy`, `report_unhealthy`, `is_production`. Task 2 extends `select_image`/`report_unhealthy`; Task 3 adds `cmd_reset`.

- [ ] **Step 1: Write the failing run-it test**

Create `scripts/waitron-sh.test.mjs`. It puts stub `docker`, `curl`, `qrencode` first on `PATH`, runs `waitron.sh install` against a temp `WAITRON_DIR`, and asserts the pull/up happened, no image line was written, and the links printed. Model: `scripts/reap-testcontainers.test.mjs`.

```javascript
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "deploy", "waitron.sh");

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A sandbox: a fresh WAITRON_DIR, a bin/ of stub executables placed first on PATH, and a log file
// every stub appends its argv to. `docker` answers `compose version` (so Docker looks installed),
// prints `healthy` for `compose ps`, and returns empty for everything else. `curl`/`wget` write a
// marker to their -o/-O target so fetched files exist. `qrencode` is a no-op.
function sandbox({ tradingEnv = "", dockerPs = "healthy" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "waitron-sh-"));
  dirs.push(root);
  const boxDir = join(root, "box");
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  mkdirSync(boxDir, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const stub = (name, body) => {
    const p = join(bin, name);
    writeFileSync(p, `#!/usr/bin/env bash\nprintf '%s ' "${name}" >> "${log}"; printf '%s\\n' "$*" >> "${log}"\n${body}\n`);
    chmodSync(p, 0o755);
  };
  stub("docker", `
case "$1 $2" in
  "compose version") exit 0 ;;
esac
if [ "$1" = "compose" ]; then
  shift
  # find the subcommand after the -f <file> pair
  while [ "$1" = "-f" ]; do shift 2; done
  case "$1" in
    ps) echo "${dockerPs}" ;;
    logs) echo "${tradingEnv:+}" ;;
  esac
  exit 0
fi
if [ "$1" = "run" ]; then echo "${tradingEnv}"; exit 0; fi
exit 0
`);
  stub("curl", `
out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; *) shift;; esac; done
[ -n "$out" ] && printf 'stub\\n' > "$out"
exit 0
`);
  stub("qrencode", "exit 0");
  return { boxDir, bin, log, root };
}

function run(sb, args, extraEnv = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${sb.bin}${delimiter}${process.env.PATH}`, WAITRON_DIR: sb.boxDir, ...extraEnv },
    timeout: 20000,
  });
}

describe("waitron.sh install (published main)", () => {
  it("pulls, starts, records no image override, and prints the links", () => {
    const sb = sandbox();
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    const calls = readFileSync(sb.log, "utf8");
    expect(calls).toMatch(/docker compose .*pull/);
    expect(calls).toMatch(/docker compose .*up -d/);
    const env = readFileSync(join(sb.boxDir, ".env"), "utf8");
    expect(env).toMatch(/^POSTGRES_PASSWORD=.+/m);
    expect(env).not.toMatch(/WAITRON_IMAGE=/);
    expect(r.stdout).toContain("https://waitron.local/manage/email");
    expect(r.stdout).toContain("http://waitron.local:9110");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/clintongormley/workspace/worktrees/waitron-feat-waitron-sh-box-command && pnpm vitest run scripts/waitron-sh.test.mjs`
Expected: FAIL — `deploy/waitron.sh` does not exist yet.

- [ ] **Step 3: Write `deploy/waitron.sh`**

```bash
#!/usr/bin/env bash
#
# One command to run a Waitron box: install/upgrade it, or reset it to a clean state.
#
#   curl -fsSL https://raw.githubusercontent.com/clintongormley/waitron/main/deploy/waitron.sh -o waitron.sh
#   sudo bash waitron.sh install            # published main image
#   sudo bash waitron.sh install <ref>      # build and run a branch or commit on the box
#   sudo bash waitron.sh reset [--all]      # wipe back to a clean box (keeps the certificate)
#
# Operating this file is deploy/README.md. It replaces the old install.sh / prepare.sh /
# try-branch.sh trio; scripts/deploy-image-env.test.ts and scripts/waitron-sh.test.mjs pin it.
set -euo pipefail

WAITRON_DIR="${WAITRON_DIR:-/opt/waitron}"
REPO="clintongormley/waitron"
RAW_BASE="https://raw.githubusercontent.com/${REPO}"
GIT_URL="https://github.com/${REPO}.git"
# One copy of boot.ts's BOX_HOSTNAME, pinned by scripts/deploy-image-env.test.ts to the image env,
# compose's defaults and the QR the restaurant scans.
BOX_URL="https://waitron.local"
# The db image compose runs, present on any installed box; used for the throwaway containers that
# read and edit the state volume without a network pull. Kept in step with deploy/compose.yml's db.
HELPER_IMAGE="postgres:18-alpine"

die() { echo "waitron.sh: $1" >&2; exit "${2:-1}"; }

usage() {
  cat >&2 <<'USAGE'
waitron.sh: usage:
  waitron.sh install [ref]     install or upgrade the box (ref defaults to main)
  waitron.sh reset [--all]     wipe the box to a clean state (keeps the certificate; --all drops it too)
USAGE
  exit 2
}

# curl preferred, wget the minimal-Debian fallback; neither present is a clear failure.
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
else
  fetch() { die "need curl or wget to download the box files — install one and re-run"; }
fi

as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -n "$@"; fi; }
# apt, never interactive: sudo's env_reset discards an exported DEBIAN_FRONTEND, so pass it inline.
apt_get() { as_root env DEBIAN_FRONTEND=noninteractive apt-get "$@"; }

# 1. Docker Engine + the compose plugin, and the daemon enabled on boot. `docker compose version`
#    is the test, because the v1 docker-compose binary cannot run this compose file.
ensure_docker() {
  if ! docker compose version >/dev/null 2>&1; then
    [ -r /etc/os-release ] || die "no /etc/os-release — install Docker Engine and the compose plugin first" 2
    # shellcheck disable=SC1091
    . /etc/os-release
    local distro codename
    case " ${ID:-} ${ID_LIKE:-} " in
      *" ubuntu "*) distro=ubuntu ;;
      *" debian "*) distro=debian ;;
      *) die "Docker is missing and ${ID:-this distro} is not Debian or Ubuntu — install it first" 2 ;;
    esac
    codename="${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"
    [ -n "$codename" ] || die "/etc/os-release names no VERSION_CODENAME — install Docker Engine first" 2
    apt_get update
    apt_get install -y --no-install-recommends ca-certificates curl
    as_root install -m 0755 -d /etc/apt/keyrings
    as_root curl -fsSL "https://download.docker.com/linux/${distro}/gpg" -o /etc/apt/keyrings/docker.asc
    as_root chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
      "$(dpkg --print-architecture)" "$distro" "$codename" | as_root tee /etc/apt/sources.list.d/docker.list >/dev/null
    apt_get update
    apt_get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  if ! command -v qrencode >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
    apt_get install -y --no-install-recommends qrencode
  fi
  if command -v systemctl >/dev/null 2>&1; then as_root systemctl enable --now docker; fi
}

# 2. The box's one pre-boot secret, generated once and never overwritten or printed. Checked BEFORE
#    the write so a failed generator cannot leave an empty password the guard then skips for ever.
ensure_env_password() {
  [ -f "$WAITRON_DIR/.env" ] && grep -q '^POSTGRES_PASSWORD=' "$WAITRON_DIR/.env" && return 0
  local secret; secret="$(openssl rand -hex 32 2>/dev/null || true)"
  [ -n "$secret" ] || die "could not generate POSTGRES_PASSWORD — is openssl installed?"
  ( umask 077; printf 'POSTGRES_PASSWORD=%s\n' "$secret" >> "$WAITRON_DIR/.env" )
  unset secret
}

# .env line editing: set/replace or remove a KEY, preserving 0600 and never touching other lines.
# `grep -v` exits 1 when it removes every line, which `set -e` would abort on — hence `|| true`.
env_set() {
  local key="$1" value="$2" file="$WAITRON_DIR/.env" tmp; tmp="$(mktemp)"
  [ -f "$file" ] && { grep -v "^${key}=" "$file" > "$tmp" || true; }
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  ( umask 077; cat "$tmp" > "$file" ); rm -f "$tmp"
}
env_unset() {
  local key="$1" file="$WAITRON_DIR/.env" tmp
  [ -f "$file" ] || return 0
  tmp="$(mktemp)"; grep -v "^${key}=" "$file" > "$tmp" || true
  ( umask 077; cat "$tmp" > "$file" ); rm -f "$tmp"
}

# 3. compose.yml + .env.example always from the INSTALLED ref, so compose and the image share a
#    commit. Overwrites an operator's compose edits (rare); the choice is stated aloud.
fetch_box_files() {
  local ref="$1"
  fetch "${RAW_BASE}/${ref}/deploy/compose.yml" "$WAITRON_DIR/compose.yml"
  fetch "${RAW_BASE}/${ref}/deploy/.env.example" "$WAITRON_DIR/.env.example"
  echo "waitron.sh: wrote compose.yml from ${ref} (any local compose.yml edits were overwritten)"
}

# 4. main pulls the published image and records no override; a branch/commit builds both images on
#    the box from the git context and records the tags in .env so the box stays on them.
select_image() {
  local ref="$1"
  if [ "$ref" = "main" ]; then
    env_unset WAITRON_IMAGE
    env_unset WAITRON_PRINT_AGENT_IMAGE
    docker compose -f "$WAITRON_DIR/compose.yml" pull --ignore-pull-failures
  else
    local safe tag agent_tag
    safe="$(printf '%s' "$ref" | tr -c 'A-Za-z0-9._-' '-')"; safe="${safe:0:100}"
    tag="waitron:${safe}"; agent_tag="waitron-print-agent:${safe}"
    docker build -t "$tag" -f deploy/Dockerfile "${GIT_URL}#${ref}"
    docker build -t "$agent_tag" -f deploy/Dockerfile --target print-agent "${GIT_URL}#${ref}"
    env_set WAITRON_IMAGE "$tag"
    env_set WAITRON_PRINT_AGENT_IMAGE "$agent_tag"
  fi
}

# The whole console instruction after a box comes up: where to go, plus the QR of the setup URL.
print_links() {
  cat <<EOF

  Waitron is ready.

  Set up:        ${BOX_URL}
  Once set up:
    Till         ${BOX_URL}
    Dashboard    ${BOX_URL}/manage
    Email inbox  ${BOX_URL}/manage/email
    Print agent  http://waitron.local:9110

EOF
  if command -v qrencode >/dev/null 2>&1; then qrencode -t ANSIUTF8 "$BOX_URL"; echo; fi
}

# Is this box stamped production? Two signals, production from EITHER. trading.env is read from the
# state volume with a throwaway container so no database need be up; the db stamp is the box's own
# authority when the cluster is reachable. A never-provisioned box has neither and is safe to wipe.
is_production() {
  local env_line stamp
  env_line="$(docker run --rm -v waitron_state:/s "$HELPER_IMAGE" cat /s/trading.env 2>/dev/null | grep '^WAITRON_ENV=' || true)"
  case "$env_line" in *=production) return 0 ;; esac
  stamp="$(docker compose -f "$WAITRON_DIR/compose.yml" exec -T db psql -U postgres -tAc \
    'select environment from deployment where id = 1' 2>/dev/null | tr -d '[:space:]' || true)"
  [ "$stamp" = "production" ]
}

# ~3 minutes for the app container to report healthy (setup mode is healthy on /setup-api/status).
wait_healthy() {
  local tries=36
  while [ "$tries" -gt 0 ]; do
    if docker compose -f "$WAITRON_DIR/compose.yml" ps --format '{{.Health}}' app 2>/dev/null | grep -q healthy; then
      return 0
    fi
    tries=$((tries - 1)); sleep 5
  done
  return 1
}

# A box that never came up healthy: show the last app log lines. database_ahead advice is scoped to
# the box — never tell a production box to reset (Task 2 extends this).
report_unhealthy() {
  docker compose -f "$WAITRON_DIR/compose.yml" logs --tail 40 app 2>&1 || true
  die "the box did not come up healthy — see the log lines above"
}

cmd_install() {
  local ref="${1:-main}"
  ensure_docker
  mkdir -p "$WAITRON_DIR" || die "cannot create $WAITRON_DIR — run as root, or set WAITRON_DIR to a writable path"
  ensure_env_password
  fetch_box_files "$ref"
  select_image "$ref"
  cd "$WAITRON_DIR"
  docker compose up -d
  if wait_healthy; then print_links; else report_unhealthy; fi
}

main() {
  local verb="${1:-}"
  case "$verb" in
    install) shift; cmd_install "$@" ;;
    reset)   die "reset is not implemented yet" ;;  # Task 3
    ""|-h|--help) usage ;;
    *) die "unknown command '$verb'" 2 ;;
  esac
}

main "$@"
```

- [ ] **Step 4: Run the run-it test to verify it passes**

Run: `pnpm vitest run scripts/waitron-sh.test.mjs`
Expected: PASS.

- [ ] **Step 5: Delete the three old scripts and rewrite the guards**

```bash
git rm deploy/install.sh deploy/prepare.sh deploy/try-branch.sh
```

In `scripts/deploy-image-env.test.ts`: remove the `const PREPARE = read("deploy/prepare.sh");` line and add `const WAITRON_SH = read("deploy/waitron.sh");`. Delete the two describe-blocks `"the run-from-web installer"` and `"the try-a-branch helper"`. In the `"every copy of the box's hostname"` block, change the `PREPARE`/`BOX_URL` assertion to read from `WAITRON_SH`:

```typescript
    // The URL in the QR code the restaurant actually scans.
    expect(only(WAITRON_SH, /BOX_URL="([^"]+)"/, "waitron.sh BOX_URL")).toBe(`https://${HOSTNAME}`);
```

Add a new describe-block with the assertions true after this task:

```typescript
describe("the waitron.sh box command", () => {
  it("is a bash script", () => {
    expect(WAITRON_SH).toMatch(/^#!.*\bbash\b/);
  });

  it("fetches the box files from the repository's public raw endpoint", () => {
    expect(WAITRON_SH).toContain("raw.githubusercontent.com/clintongormley/waitron");
  });

  it("defaults the install ref to main", () => {
    expect(WAITRON_SH).toMatch(/ref="\$\{1:-main\}"/);
  });

  it("honours WAITRON_DIR, defaulting to /opt/waitron", () => {
    expect(WAITRON_SH).toMatch(/WAITRON_DIR:-\/opt\/waitron/);
  });

  it("reports a script-prefixed error to stderr when misused", () => {
    expect(WAITRON_SH).toMatch(/echo "waitron\.sh: [^\n]*>&2/);
  });
});
```

In `scripts/changed-scope.test.mjs`, change `"deploy/prepare.sh"` to `"deploy/waitron.sh"` in the `it.each([...])` image-input list.

- [ ] **Step 6: Run the guards to verify green**

Run: `pnpm vitest run scripts/deploy-image-env.test.ts scripts/changed-scope.test.mjs scripts/waitron-sh.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add deploy/waitron.sh scripts/waitron-sh.test.mjs scripts/deploy-image-env.test.ts scripts/changed-scope.test.mjs
git commit -s -m "feat(deploy): waitron.sh install for the published main image

Fold install.sh/prepare.sh/try-branch.sh into one waitron.sh. This task
carries the install verb for the published main image; the branch build and
reset follow. A run-it test executes the script under stub docker/curl."
```

---

## Task 2: `install <ref>` builds a branch image; env-aware `database_ahead` advice

Adds the branch/commit path (already coded in `select_image` in Task 1) coverage, and makes the unhealthy report read the box's environment so it never tells a production box to reset.

**Files:**
- Modify: `deploy/waitron.sh` (`report_unhealthy`)
- Modify: `scripts/waitron-sh.test.mjs` (branch-build + ahead-advice tests)
- Modify: `scripts/deploy-image-env.test.ts` (branch-build + image-line guard assertions)

**Interfaces:**
- Consumes: `select_image`, `is_production`, `env_set` from Task 1.
- Produces: `report_unhealthy` extended to branch on `is_production` for the `provisioning.database_ahead` case.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/waitron-sh.test.mjs`:

```javascript
describe("waitron.sh install <ref>", () => {
  it("builds both images from the git context and records them in .env", () => {
    const sb = sandbox();
    const r = run(sb, ["install", "my-branch"]);
    expect(r.status).toBe(0);
    const calls = readFileSync(sb.log, "utf8");
    expect(calls).toMatch(/docker build .*-f deploy\/Dockerfile .*github\.com\/clintongormley\/waitron\.git#my-branch/);
    expect(calls).toMatch(/docker build .*--target print-agent .*waitron\.git#my-branch/);
    const env = readFileSync(join(sb.boxDir, ".env"), "utf8");
    expect(env).toMatch(/^WAITRON_IMAGE=waitron:my-branch$/m);
    expect(env).toMatch(/^WAITRON_PRINT_AGENT_IMAGE=waitron-print-agent:my-branch$/m);
  });
});

describe("waitron.sh database_ahead advice", () => {
  // A box that never goes healthy and whose logs carry database_ahead: on a non-production box the
  // advice is to reset; the stub docker returns the ahead log line and never-healthy ps.
  it("tells a non-production box to reset", () => {
    const sb = sandbox({ dockerPs: "starting", aheadLogs: true, healthTries: 1 });
    const r = run(sb, ["install"], { WAITRON_SH_MAX_HEALTH_TRIES: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/reset.*then install/i);
  });

  it("never tells a production box to reset", () => {
    const sb = sandbox({ dockerPs: "starting", aheadLogs: true, tradingEnv: "WAITRON_ENV=production", healthTries: 1 });
    const r = run(sb, ["install"], { WAITRON_SH_MAX_HEALTH_TRIES: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/newer ref/i);
    expect(r.stderr).not.toMatch(/run 'waitron\.sh reset'/);
  });
});
```

Extend the `sandbox()` stub so `docker compose logs` prints the ahead line when `aheadLogs` is set, and `docker run ... cat /s/trading.env` prints `tradingEnv`. Add a `WAITRON_SH_MAX_HEALTH_TRIES` env override so the health loop does not take three minutes in the test (read it in `wait_healthy`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run scripts/waitron-sh.test.mjs`
Expected: the two `database_ahead` tests FAIL (current `report_unhealthy` prints no ahead advice); the branch-build test PASSES (already coded).

- [ ] **Step 3: Extend `report_unhealthy` and make the health loop test-bounded**

In `deploy/waitron.sh`, replace `report_unhealthy` and the `tries=36` line:

```bash
wait_healthy() {
  local tries="${WAITRON_SH_MAX_HEALTH_TRIES:-36}"
  while [ "$tries" -gt 0 ]; do
    if docker compose -f "$WAITRON_DIR/compose.yml" ps --format '{{.Health}}' app 2>/dev/null | grep -q healthy; then
      return 0
    fi
    tries=$((tries - 1)); [ "$tries" -gt 0 ] && sleep 5
  done
  return 1
}

report_unhealthy() {
  local logs
  logs="$(docker compose -f "$WAITRON_DIR/compose.yml" logs --tail 40 app 2>&1 || true)"
  printf '%s\n' "$logs" >&2
  if printf '%s' "$logs" | grep -q 'provisioning.database_ahead'; then
    if is_production; then
      die "the database is newer than this image. On a box with real records install a NEWER ref — do NOT reset, it would destroy the fiscal ledger."
    fi
    die "the database is newer than this image (provisioning.database_ahead). Run 'waitron.sh reset' then install again."
  fi
  die "the box did not come up healthy — see the log lines above"
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run scripts/waitron-sh.test.mjs`
Expected: PASS.

- [ ] **Step 5: Add the branch-build guard assertions**

In `scripts/deploy-image-env.test.ts`, inside the `"the waitron.sh box command"` block:

```typescript
  it("builds a branch image from the repo git context with deploy/Dockerfile", () => {
    expect(WAITRON_SH).toMatch(/docker build[^\n]*-f deploy\/Dockerfile/);
    expect(WAITRON_SH).toContain("github.com/clintongormley/waitron.git");
    expect(WAITRON_SH).toMatch(/waitron\.git#\$\{?\w+\}?/);
  });

  it("records the branch image in .env rather than only inline on compose up", () => {
    expect(WAITRON_SH).toMatch(/env_set WAITRON_IMAGE/);
  });
```

- [ ] **Step 6: Run the guard, then commit**

Run: `pnpm vitest run scripts/deploy-image-env.test.ts scripts/waitron-sh.test.mjs`
Expected: PASS.

```bash
git add deploy/waitron.sh scripts/waitron-sh.test.mjs scripts/deploy-image-env.test.ts
git commit -s -m "feat(deploy): waitron.sh install <ref> builds a branch image; ahead advice knows production

install <ref> builds both images on the box from the git context and records
the tags in .env so the box stays on them. A database_ahead failure tells a
demo box to reset but a production box to install a newer ref, never to wipe."
```

---

## Task 3: `reset [--all]` with the production refusal

Adds the `reset` verb: refuse if uninstalled or production, confirm, wipe the transient volumes, empty `state` except `tls/` (or drop it with `--all`), and boot back into setup.

**Files:**
- Modify: `deploy/waitron.sh` (add `cmd_reset`, wire it into `main`)
- Modify: `scripts/waitron-sh.test.mjs` (reset tests)
- Modify: `scripts/deploy-image-env.test.ts` (reset guard assertions)

**Interfaces:**
- Consumes: `is_production`, `wait_healthy`, `report_unhealthy`, `print_links`, `HELPER_IMAGE` from Tasks 1-2.
- Produces: `cmd_reset` handling `--all`, `--yes`, `--force-production`.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/waitron-sh.test.mjs`. The stub `docker` records `volume rm` and `run` calls; the tests assert exactly which volumes are removed and that `.env` and `tls/` survive.

```javascript
describe("waitron.sh reset", () => {
  const installedBox = (sb) => {
    // A box that looks installed: compose.yml + .env present.
    writeFileSync(join(sb.boxDir, "compose.yml"), "name: waitron\n");
    writeFileSync(join(sb.boxDir, ".env"), "POSTGRES_PASSWORD=keepme\n");
  };

  it("refuses when the box was never installed", () => {
    const sb = sandbox();
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no box at/);
  });

  it("removes the transient volumes, empties state except tls, keeps .env", () => {
    const sb = sandbox();
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).toBe(0);
    const calls = readFileSync(sb.log, "utf8");
    for (const v of ["db", "logs", "media", "backups", "mailpit", "print_agent"]) {
      expect(calls).toMatch(new RegExp(`docker volume rm .*waitron_${v}\\b`));
    }
    expect(calls).not.toMatch(/docker volume rm .*waitron_state\b/);
    // state emptied except tls, via a throwaway container.
    expect(calls).toMatch(/docker run .*waitron_state.* find \/s .*! -name tls/);
    expect(readFileSync(join(sb.boxDir, ".env"), "utf8")).toContain("POSTGRES_PASSWORD=keepme");
    expect(calls).toMatch(/docker compose .*up -d/);
  });

  it("--all also removes the state volume", () => {
    const sb = sandbox();
    installedBox(sb);
    const r = run(sb, ["reset", "--all", "--yes"]);
    expect(r.status).toBe(0);
    expect(readFileSync(sb.log, "utf8")).toMatch(/docker volume rm .*waitron_state\b/);
  });

  it("refuses on a production box and removes no volume", () => {
    const sb = sandbox({ tradingEnv: "WAITRON_ENV=production" });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/PRODUCTION/);
    expect(readFileSync(sb.log, "utf8")).not.toMatch(/docker volume rm/);
  });

  it("--force-production --yes proceeds on a production box", () => {
    const sb = sandbox({ tradingEnv: "WAITRON_ENV=production" });
    installedBox(sb);
    const r = run(sb, ["reset", "--force-production", "--yes"]);
    expect(r.status).toBe(0);
    expect(readFileSync(sb.log, "utf8")).toMatch(/docker volume rm .*waitron_db\b/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run scripts/waitron-sh.test.mjs`
Expected: the reset tests FAIL (`reset is not implemented yet`).

- [ ] **Step 3: Implement `cmd_reset` and wire it in**

In `deploy/waitron.sh`, add before `main` and replace the `reset)` line:

```bash
cmd_reset() {
  local all=0 yes=0 force_prod=0 a ans
  for a in "$@"; do
    case "$a" in
      --all) all=1 ;;
      --yes) yes=1 ;;
      --force-production) force_prod=1 ;;
      *) die "reset: unknown option '$a'" 2 ;;
    esac
  done
  [ -f "$WAITRON_DIR/compose.yml" ] || die "no box at $WAITRON_DIR — run 'waitron.sh install' first"

  if is_production; then
    [ "$force_prod" -eq 1 ] || die "this box is stamped PRODUCTION and holds real fiscal records that cannot be recreated — a reset would cut the AEAT chain. Recover a broken production box from a backup. To wipe anyway, re-run with --force-production."
    if [ -t 0 ]; then
      printf 'waitron.sh: type "production" to wipe this PRODUCTION box: ' >&2
      read -r ans; [ "$ans" = "production" ] || die "not confirmed — nothing wiped"
    fi
  elif [ "$yes" -ne 1 ]; then
    [ -t 0 ] || die "reset needs confirmation — re-run with --yes for a non-interactive box"
    printf 'waitron.sh: type "reset" to wipe this box: ' >&2
    read -r ans; [ "$ans" = "reset" ] || die "not confirmed — nothing wiped"
  fi

  cd "$WAITRON_DIR"
  docker compose down
  local v
  for v in db logs media backups mailpit print_agent; do
    docker volume rm -f "waitron_${v}" >/dev/null 2>&1 || true
  done
  if [ "$all" -eq 1 ]; then
    docker volume rm -f waitron_state >/dev/null 2>&1 || true
  else
    # Empty state except tls/, keeping the CA + leaf so an already-trusting phone needs no new step.
    docker run --rm -v waitron_state:/s "$HELPER_IMAGE" \
      find /s -mindepth 1 -maxdepth 1 ! -name tls -exec rm -rf {} +
  fi
  docker compose up -d
  if wait_healthy; then print_links; else report_unhealthy; fi
}
```

Change the `main` dispatch line from `reset) die "reset is not implemented yet" ;;` to:

```bash
    reset) shift; cmd_reset "$@" ;;
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run scripts/waitron-sh.test.mjs`
Expected: PASS.

- [ ] **Step 5: Add reset guard assertions**

In `scripts/deploy-image-env.test.ts`, inside the `"the waitron.sh box command"` block:

```typescript
  it("keeps the tls certificate when it empties the state volume on a plain reset", () => {
    expect(WAITRON_SH).toMatch(/find \/s .*! -name tls/);
  });

  it("refuses a reset on a production box unless forced", () => {
    expect(WAITRON_SH).toMatch(/--force-production/);
    expect(WAITRON_SH).toMatch(/stamped PRODUCTION/);
  });
```

- [ ] **Step 6: Run the guard + the whole root project, then commit**

Run: `pnpm vitest run scripts/deploy-image-env.test.ts scripts/waitron-sh.test.mjs`
Then the whole root project (this branch changes files more than one suite reads): `pnpm --filter @waitron/root test:coverage 2>/dev/null || pnpm vitest run scripts/`
Expected: PASS.

```bash
git add deploy/waitron.sh scripts/waitron-sh.test.mjs scripts/deploy-image-env.test.ts
git commit -s -m "feat(deploy): waitron.sh reset, refusing on a production box

reset wipes the transient volumes and empties state except tls/, so the
phone still trusts the box; --all drops the certificate too. It refuses on a
box stamped production, where a wipe would cut the AEAT chain, unless
--force-production is given and the operator types the word."
```

---

## Task 4: The setup wizard's finish screen shows the reachability links

Adds the same four links to `done-screen.ts`, built from the page's own address.

**Files:**
- Modify: `apps/setup/src/screens/done-screen.ts`
- Modify: `apps/setup/src/screens/done-screen.test.ts`

**Interfaces:**
- Produces: a links block in the done screen with `data-test="links"`, and an injectable `hostname` property (default `location.hostname`) so the print-agent absolute URL is testable.

- [ ] **Step 1: Write the failing test**

Add to `apps/setup/src/screens/done-screen.test.ts`:

```typescript
it("lists the box's reachability links", async () => {
  const el = await mountDone(() => new Promise(() => {}), { hostname: "waitron.local" });
  const links = el.shadowRoot!.querySelector("[data-test=links]")!;
  const hrefs = [...links.querySelectorAll("a")].map((a) => (a as HTMLAnchorElement).getAttribute("href"));
  expect(hrefs).toContain("/");
  expect(hrefs).toContain("/manage");
  expect(hrefs).toContain("/manage/email");
  expect(hrefs).toContain("http://waitron.local:9110");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/setup && pnpm vitest run src/screens/done-screen.test.ts` (from the worktree root: `pnpm --filter @waitron/setup vitest run src/screens/done-screen.test.ts`)
Expected: FAIL — no `[data-test=links]` element.

- [ ] **Step 3: Add the links block and the `hostname` property**

In `done-screen.ts`, add the property near `reload`:

```typescript
  /** The box's own hostname, used only for the print-agent link (a different port, so an absolute
   * URL). Injectable so a test does not depend on the runner's location. */
  @property() hostname: string = location.hostname;
```

In `render()`, add a links block after the `<p>The box is restarting into trading mode.</p>` line:

```typescript
        <div class="links" data-test="links">
          <p>Once the box is trading, reach it here:</p>
          <ul>
            <li><a href="/">Till</a></li>
            <li><a href="/manage">Dashboard</a></li>
            <li><a href="/manage/email">Email inbox</a></li>
            <li><a href=${`http://${this.hostname}:9110`}>Print agent</a></li>
          </ul>
        </div>
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @waitron/setup vitest run src/screens/done-screen.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the package's full gate (browser mode) + a11y, then commit**

Run: `pnpm --filter @waitron/setup test:coverage`
Expected: PASS. (This is a browser-mode package; check machine headroom first per CLAUDE.md.)

```bash
git add apps/setup/src/screens/done-screen.ts apps/setup/src/screens/done-screen.test.ts
git commit -s -m "feat(setup): the finish screen lists the box's reachability links

Till, Dashboard, Email inbox and Print agent, built from the page's own
address, so the operator has the same links the console banner prints."
```

---

## Task 5: Docs and comments

Updates the README, the comments naming the deleted scripts, `CLAUDE.md`, and the backlog. Docs-only, no test cycle; committed as one change.

**Files:**
- Modify: `deploy/README.md`, `deploy/compose.yml`, `deploy/.env.example`, `deploy/Dockerfile`, `apps/server/src/boot.ts`, `scripts/changed-scope.mjs`, `CLAUDE.md`, `docs/backlog.md`

- [ ] **Step 1: README**

In `deploy/README.md`: replace the setup one-liner and the "Trying a branch before it merges" section with the `waitron.sh install [ref]` usage; add a "Resetting a box" section documenting `reset` and `reset --all`, the tls/`--all` distinction, and the production refusal; keep the volume table. Remove references to `install.sh`/`prepare.sh`/`try-branch.sh`.

- [ ] **Step 2: Code comments naming the deleted scripts**

- `deploy/compose.yml:5` and `:101`: `deploy/prepare.sh` → `deploy/waitron.sh`.
- `deploy/.env.example:1-8`: the `prepare.sh copies/generates` lines → `waitron.sh`.
- `deploy/Dockerfile:151`: the `prepare.sh` hostname-copy mention → `waitron.sh`.
- `apps/server/src/boot.ts:291`: the hostname-copy list mentions `prepare.sh`'s QR URL → `waitron.sh`.
- `scripts/changed-scope.mjs:79`: the image-input comment lists `prepare.sh` → `waitron.sh`.

- [ ] **Step 3: CLAUDE.md**

Reword the §2 entry at `CLAUDE.md:388-390` ("`deploy/try-branch.sh` is a one-way door"): the one-way migration fact now attaches to `waitron.sh install <ref>`, and add that `waitron.sh reset` is the clean recovery on a demo box while a production box refuses (pointer to the spec).

- [ ] **Step 4: Backlog**

In `docs/backlog.md`, update the rows that name the three scripts (around lines 105-107, 202, 221, 232, 302-304) to name `waitron.sh` and its two verbs. Add a one-line pointer to the spec.

- [ ] **Step 5: Verify docs lint clean, then commit**

Run: `pnpm format:check` (README/CLAUDE.md are format-checked; `docs/**` is ignored).
Then confirm the deleted-script names are gone from tracked non-spec files: `git grep -n 'prepare\.sh\|try-branch\.sh\|install\.sh' -- ':!docs/superpowers'` should return nothing outside this plan and spec.

```bash
git add deploy/README.md deploy/compose.yml deploy/.env.example deploy/Dockerfile apps/server/src/boot.ts scripts/changed-scope.mjs CLAUDE.md docs/backlog.md
git commit -s -m "docs(deploy): describe waitron.sh install and reset; retire the three-script names"
```

---

## Self-Review

**Spec coverage:**
- §2 one script, three deleted → Task 1 (script + deletions).
- §3 install: Docker/password/fetch/select/start/banner → Task 1; branch build + `.env` image lines → Tasks 1-2; ahead advice → Task 2.
- §4 reset + §4.1 production refusal → Task 3.
- §5 / §5.1 migrations + ahead advice → Task 2 (`report_unhealthy`).
- §6 finish banner (terminal) → Task 1 (`print_links`).
- §7 wizard finish screen links → Task 4.
- §8 guards + run-it test → Tasks 1-3 (`deploy-image-env.test.ts`, `waitron-sh.test.mjs`), changed-scope list → Task 1.
- §9 docs + comments → Task 5.
- §10 out of scope (CI branch images) → no task, correct.

**Placeholder scan:** every code step carries real bash / TypeScript / test code; no TBDs.

**Type/name consistency:** `is_production`, `select_image`, `report_unhealthy`, `wait_healthy`, `print_links`, `env_set`/`env_unset`, `HELPER_IMAGE`, `cmd_install`/`cmd_reset` are defined in Task 1 and reused by name in Tasks 2-3. The volume set `db logs media backups mailpit print_agent` matches the spec and compose. `WAITRON_SH_MAX_HEALTH_TRIES` is introduced in Task 2 and used only there and in the reset path.

**Note for the executor:** the run-it test's stub `docker` must be extended in Task 2 (ahead logs, trading.env read) and its coverage of `volume rm`/`run` relied on in Task 3 — grow the single `sandbox()` helper rather than forking it.

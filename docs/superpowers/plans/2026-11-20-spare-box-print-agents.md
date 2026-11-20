# Print agents after a swap between the main box and the spare — plan

Status: approved by the owner on 2026-11-20 ("yes" to all five changes below). Branch
`spare-box-print-agents`, worktree `~/workspace/worktrees/waitron-spare-box-print-agents`.

## What the owner saw (2026-11-20, two-box test after a swap)

The Lenovo (`waitron-spare`, now the main box) lists two print agents, both marked "On this box".
The old main box (now the spare) shows on its agent page "Can't reach `https://127.0.0.1` right now —
retrying. no accepting primary in environment preproduction". The Bluetooth dongle moved to the
Lenovo finds no Bluetooth printer. A scan for printers lists the already-added A4 printer, marked
"Added as A4 printer".

## Causes, as found

1. `printers-screen.ts` (host column, ~2749-2758, and the saved-agents list, ~2842) shows
   "On this box" for every agent with a `nodeId`, i.e. every agent ANY box enrolled for itself. The
   venue database moved with the swap, so the old main box's agent row (enrolled under the old box's
   node id by `selfEnrolNodeAgent`, `apps/server/src/join-requests.ts`) is listed too.
   `GET /management-api/print-agents` (`apps/server/src/print-api.ts` ~1051) already compares
   `row.nodeId === deps.cfg.nodeId` to decide the setup link, but does not send that answer.
   The row must stay: if the boxes swap back, that box's agent self-enrols into the same row and
   keeps its id.
2. A print agent only talks to its own box (`127.0.0.1`). The spare's server answers
   `GET /api/node` with `standing: "serving-secondary"`, `acceptingSales: false` (measured
   2026-11-20 against the old box, 192.168.10.10; the Lenovo answers `serving-primary`, `true`). The
   agent's probe parser (`packages/print-agent/src/client.ts`, `parseNodeProbe`) drops `standing`,
   and `agent.ts` ~647 reports `phase: "unreachable"` with `no accepting primary in environment …`.
   A spare's agent reaching the main box is the backlog's "Cross-box print-agent TLS" item and is
   NOT part of this plan.
3. `deploy/waitron.sh` never installs BlueZ; `disable_bluetooth_autopair` just prints "no
   bluetooth.service on this host". The Lenovo was hand-installed from a minimal Debian and has no
   `bluez` package (`dpkg -l bluez`: none; `systemctl status bluetooth`: unit not found), so the
   agent's `bluetoothctl` calls fail. The ready-made disk (`deploy/box/mkosi.conf`) already lists
   `bluez` and `dbus`.
4. The agent knows Bluetooth is unavailable (`apps/print-agent/src/bluetooth-availability.ts`,
   shown on its own setup page) but never tells the server, so the dashboard's scan just finds
   nothing.
5. The add-printer scan hides receipt printers already added, but keeps an office printer added
   through the same agent, as a row with the text "Added as A4 printer" and nothing to do
   (`#officeRow` → `{ kind: "added" }`, `printers-screen.ts` ~1783 and ~5083).

## Tasks

Every task: test first (watch it fail), then the change. English and Spanish strings together
(`apps/dashboard/src/i18n/strings.ts` has both). If a dashboard guide (English and Spanish twin)
describes the changed behaviour, update it in the same task (`git grep` the guide sources for
"On this box", "Added as A4", the agent page wording). Run each touched package's focused tests,
`pnpm --filter <pkg> typecheck`, and `pnpm exec prettier --check` on changed files.

### Task 1 — "On this box" only on this box's own agent

- Server: `GET /management-api/print-agents` adds `onThisBox: boolean` to each row
  (`row.nodeId !== null && row.nodeId === deps.cfg.nodeId`). Keep `nodeId` as it is.
  Test in the print-api suite: a row enrolled under this box's node id → `true`; a row enrolled
  under another node id → `false`; a row with `nodeId` null → `false`.
- Dashboard: the agent type in `apps/dashboard/src/api/client.ts` gains `onThisBox`. In
  `printers-screen.ts` the host cell, its search value and the saved-agents line show
  `printers.provenance_self` ("On this box" / "En este servidor") only when `onThisBox`; an agent
  with a `nodeId` that is not on this box shows a new string `printers.provenance_other_box`:
  English "On another box", Spanish "En otro servidor" (not "the other": a retired box's or a
  reinstalled box's row gets it too). Its badge keeps the same `part` and gets its own `data-test`
  so tests can tell the two apart. Screen tests cover both badges.

### Task 2 — the spare's agent page says why it is waiting

- `packages/print-agent/src/client.ts`: `NodeProbe` gains optional `standing?: string`
  (parsed when it is a string; absent otherwise).
- `packages/print-agent/src/router.ts`: from the configured address's result IN THE CURRENT probe
  round only, set a flag "configured server is a spare": its probe succeeded, its environment is the
  pinned one, `acceptingSales` is false and `standing === "serving-secondary"`. Any failure or other
  answer in a round clears it. Expose it on `ProbeRound` (e.g. `configuredIsSpare`).
- `packages/print-agent/src/agent.ts` ~647: when no server accepts and the round says the configured
  server is a spare, report a new phase `"spare_box"` (add to `AgentPhase` in `host.ts`) with
  `lastError: undefined` written explicitly (`report()` merges into the previous status,
  `agent.ts:199-200`). It must still set `outOfTouch = true` exactly as today: the reset logic
  depends on it AND it is what lets the setup page answer from the network
  (`apps/print-agent/src/setup-page.ts:59-61`). It still never sends the token.
  Agent tests: the spare answer gives `spare_box` with no `lastError`, also after an earlier
  unreachable round that set one; a spare round followed by an unreachable round gives
  `unreachable` with today's text; an answer from another environment, and a not-accepting answer
  with any other or no `standing`, give `unreachable` with today's text.
- `apps/print-agent/src/setup-page.ts`: `statusCard` renders `spare_box` as
  "This box is the venue's spare. Printing goes through the main box's own print agent. This agent
  starts printing again if this box becomes the main box." `renderRoot` (~209) does NOT show the
  reset card ("This agent cannot reach its venue… Join a new network") while the phase is
  `spare_box`: the agent is not lost, and a reset would make it forget its approval for nothing.
  Setup-page tests for both. The phase's other consumers were checked in review: only
  `setup-page.ts` maps phases (its `switch` must return, so TypeScript flags a missing case);
  `/status.json` passes it through and the compose healthcheck reads only HTTP 200.
- Server: add to `apps/server/src/boot.mirror.test.ts` (~517, the mirror's `/api/node` case) an
  assertion that a mirror answers `standing: "serving-secondary"` alongside
  `acceptingSales: false` and its environment, so the agent's new dependency is pinned.
- Which boxes show the new message: a mirror (spare), and an old main box stepping down after a
  handover, whose answer comes from the venue's chart (`restricted-start.ts:48`,
  `waiting-start.ts:111`) — correct for both. A box whose opening checks are not finished answers
  only `{acceptingSales:false}` (`node-api.ts:52-53`), which the agent cannot parse, so it keeps
  today's "unreachable" text; out of scope.

### Task 3a — the agent sends whether it can use Bluetooth

- `packages/print-agent/src/client.ts`: export `BLUETOOTH_UNAVAILABLE_REASONS =
  ["dbus_unreachable", "bluez_not_answering", "no_controller", "failed"] as const` and its type,
  beside `BLUETOOTH_FAILURE_REASONS` (~39-49). `apps/print-agent/src/bluetooth-availability.ts`
  takes its `BluetoothUnavailableReason` from there instead of declaring its own.
- `AgentInventory` gains `bluetooth?: { available: true } | { available: false; reason }`; never
  `detail`. Built in `agent.ts` (~730-763) from a new optional host method (e.g.
  `bluetoothAvailability?(): …` on the host interface in `packages/print-agent/src/host.ts`),
  implemented in `apps/print-agent/src/host.ts` (`createContainerHost`, `devices?: LinuxDevices`
  ~36, mapping ~95-100) from `linux-devices.ts`'s `bluetoothAvailability()`, and in
  `src/testing/fake-host.ts`. Omit the field while availability is unknown.
  Tests: the pull body carries each state; unknown → no field.

### Task 3b — the server keeps and lists it

- Pull route (`apps/server/src/print-api.ts` ~815): screen `bluetooth` with `oneOf` against
  `BLUETOOTH_UNAVAILABLE_REASONS`, as ~450 does for the other list. Anything unrecognised is
  ignored, never a refusal: older and newer agents must keep pulling. Absent → stored value
  unchanged. Keep the latest value and its time per agent id in memory beside `discovered`.
- `GET /management-api/print-agents` adds `bluetooth: "available" | <reason> | null`: null when
  nothing was reported since this server started, or the last report is older than
  `DISCOVERED_TTL_MS` (the scan list's own freshness limit).
- When an agent's stored value CHANGES, notify the dashboard the way the agents list already
  refreshes (it reloads on `print_agents` changes, `apps/server/src/live-queries.ts` ~114; a pull
  only touches that table about once a minute, `packages/printing/src/agent.ts:33-42`). Find the
  existing publish path for that subscription and use it; do not add a new poll.
- Tests: each reason stored and listed; field absent keeps the last value; malformed field ignored
  and the pull still answers 200; a stale report lists as null; a change publishes, a repeat does
  not.

### Task 4 — the scan says when an agent cannot look for Bluetooth printers

- Dashboard: the agent type gains `bluetooth`; repeat the reason list with a pointer back to
  `BLUETOOTH_UNAVAILABLE_REASONS`, as `apps/dashboard/src/api/client.ts:1316` does for the other
  list. The add-printer dialog (`#renderNewPrinter`, `printers-screen.ts` ~5142) shows one line per
  ACTIVE agent whose `bluetooth` is a reason, under the "Searching for…" line:
  English "Bluetooth printers can't be found through {agent}: {reason}" /
  Spanish "No se pueden encontrar impresoras Bluetooth a través de {agent}: {reason}". Reasons:
  - `no_controller`: "its computer has no Bluetooth adapter. Plug one in." /
    "su equipo no tiene adaptador Bluetooth. Conecta uno."
  - `bluez_not_answering`, `failed`: "its computer's Bluetooth service isn't working." /
    "el servicio Bluetooth de su equipo no funciona."
  - `dbus_unreachable`: "its computer isn't letting Waitron use Bluetooth." /
    "su equipo no permite que Waitron use Bluetooth."
  (Wording for the owner to confirm on the PR.) Nothing shows for `available` or `null`, or for an
  inactive agent. Screen tests: each reason shows its line with the agent's name; the others show
  nothing.

### Task 5 — the scan hides office printers already added through that agent

- `printers-screen.ts`: in the scan list, drop rows whose `#officeRow` is `{ kind: "added" }`, as
  receipt printers already added are dropped. Keep `repoint` rows (added through another agent, or
  one that is gone), so a printer can still be moved after a swap.
- The "Check a known address" result (~1634-1638) today maps every office printer to
  `page_printer` ("…see its row below"). For `{kind: "added"}` map it to `registered` ("Printer
  reachable. This printer is already added.") so it never points at a hidden row; test it.
- The `added` render branch (~5083-5086), the `page-printer-added` CSS part (~479) and the
  `printers.page_printer_added` strings (EN ~2124, ES ~6705) become unreachable: delete them, and
  rework `printers-screen.a11y.test.ts` ~618 to cover the remaining states. Update existing tests
  that expected the added row in the scan list; add a test that it is gone and that a `repoint` row
  still shows.

### Task 6 — `waitron.sh install` installs BlueZ when it is missing

- `deploy/waitron.sh`: a new step before `disable_bluetooth_autopair` (every call site — grep).
  Detect a missing BlueZ as the libatomic step does (~1023-1028):
  `dpkg-query -W -f '${db:Status-Status}' bluez`. When it is not installed and `apt-get` and
  `systemctl` exist: `apt_get update`, `apt_get install -y --no-install-recommends bluez`, then
  `systemctl enable --now bluetooth` best-effort. A failure must NOT stop the install (Bluetooth is
  optional): run it so `apt_get`'s `die` cannot end the script (e.g. a subshell) and print one plain
  warning that Bluetooth printers will not be found until BlueZ is installed. Installed → nothing.
- Tests in `scripts/waitron-sh.test.mjs`: the test `dpkg-query` stand-in answers "installed" by
  default, so existing cases keep their meaning; add a flag (e.g. `WT_BLUEZ_MISSING`) for the new
  cases: missing → update + install + enable; installed → no apt call; apt fails three times →
  warning, install carries on. No existing assertion is loosened: in review, a version detecting
  through `systemctl` broke "leaves apt alone on an upgrade when libatomic1 is already installed"
  (~986) and silently changed what "installs a missing metadata reader, with apt failure = true"
  (~1195) tests. Keep `scripts/deploy-image-env.test.ts` and `scripts/ci-workflow.test.mjs` green.
- `deploy/README.md` ~113-114 ("A box with no bluetooth.service gets one line saying so") and the
  upgrade sentence ~282-284 change to say install now adds BlueZ when it is missing.

### After tasks 3a-4

- `docs/backlog/printers.md` ~122-124 (the agent page refuses network requests once joined, so the
  dashboard cannot show its Bluetooth reason): update it to say the dashboard's scan now shows it.

## Not in this plan

- A spare's agent printing through the main box (backlog: "Cross-box print-agent TLS").
- Removing the other box's agent row: it is kept on purpose (see cause 1).
- A box whose opening checks are not finished still reads as "unreachable" on its agent page.

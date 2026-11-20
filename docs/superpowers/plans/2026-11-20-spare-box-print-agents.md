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
  English "On the other box", Spanish "En el otro servidor". Its badge keeps the same `part` and
  gets its own `data-test` so tests can tell the two apart. Screen tests cover both badges.

### Task 2 — the spare's agent page says why it is waiting

- `packages/print-agent/src/client.ts`: `NodeProbe` gains optional `standing?: string`
  (parsed when it is a string; absent otherwise — older servers do not send it).
- `packages/print-agent/src/router.ts`: remember, for the configured address only, whether its last
  successful probe was same-environment, not accepting sales, with `standing === "serving-secondary"`.
  Expose it (e.g. `configuredIsSpare: boolean` on `ProbeRound` or a getter).
- `packages/print-agent/src/agent.ts` ~647: when no server accepts and the configured server is a
  spare, report a new phase `"spare_box"` (add to `AgentPhase` in `host.ts`) instead of
  `"unreachable"`, with no `lastError`. It must still set `outOfTouch` exactly as today (the reset
  logic depends on it) and still never send the token. Agent tests: the spare answer gives
  `spare_box`; an answer from another environment, an unreachable server, and a not-accepting
  answer with any other or no `standing` still give `unreachable` with today's text.
- `apps/print-agent/src/setup-page.ts` `statusCard`: `spare_box` renders
  "This box is the venue's spare. Printing goes through the main box's own print agent. This agent
  starts printing again if this box becomes the main box." Keep the page's other cards as they are.
  Setup-page test for the new card. Check every other consumer of `AgentPhase` (`git grep
  AgentPhase`, `phase ===`, and anything that maps phases to health or logs) handles the new value.

### Task 3 — the agent tells the server whether it can use Bluetooth

- Agent: the pull inventory (`AgentInventory` in `packages/print-agent/src/client.ts`, built in
  `agent.ts` ~730-763) carries `bluetooth?: { available: true } | { available: false; reason }`
  from the host's existing availability (`bluetoothAvailability()` in
  `apps/print-agent/src/linux-devices.ts`; thread it through the `host` interface in
  `packages/print-agent/src/host.ts` and the fake host in `src/testing/fake-host.ts`). Omit the
  field while availability is still unknown. `reason` is one of `BluetoothUnavailableReason`
  (`dbus_unreachable`, `bluez_not_answering`, `no_controller`, `failed`); never send `detail`.
- Server: the pull route (`apps/server/src/print-api.ts` ~815) screens the field (anything
  unrecognised → ignored, never a refusal: older and newer agents must keep pulling) and keeps the
  latest value per agent id in memory beside the `discovered` map. `GET
  /management-api/print-agents` adds `bluetooth: "available" | <reason> | null` (null: nothing
  reported since this server started). Tests: a pull with each reason, a pull without the field
  (absent means "not known yet": the stored value stays unchanged), a malformed
  field (ignored, pull still answers 200), and the list showing the value per agent.

### Task 4 — the scan says when an agent cannot look for Bluetooth printers

- Dashboard: the add-printer dialog (`#renderNewPrinter`, `printers-screen.ts` ~5142), while it is
  open, shows one line per ACTIVE agent whose `bluetooth` is a reason, under the "Searching for…"
  line: "Bluetooth printers can't be found through {agent}: {reason}". Reasons (English / Spanish):
  - `no_controller`: "its computer has no Bluetooth adapter. Plug one in." /
    "su equipo no tiene adaptador Bluetooth. Conecta uno."
  - `bluez_not_answering`, `dbus_unreachable`, `failed`: "its computer's Bluetooth service isn't
    working. Restarting that computer may fix it." / "el servicio Bluetooth de su equipo no
    funciona. Reiniciar ese equipo puede solucionarlo."
  Nothing shows for `available` or `null`. The agents list must be fresh enough when the dialog
  opens: reuse whatever load or subscription the screen already has for agents; do not add a new
  poll. Screen tests: each reason shows its line with the agent's name; available/null/inactive
  agents show nothing.

### Task 5 — the scan hides office printers already added through that agent

- `printers-screen.ts`: in the scan list, drop rows whose `#officeRow` is `{ kind: "added" }`, as
  receipt printers already added are dropped. Keep `repoint` rows (added through another agent, or
  one that is gone), so a printer can still be moved after a swap. Keep "Added as A4 printer" for
  the "Check a known address" probe result (`probeStatus`, ~1634): the person typed that address
  and needs an answer. Update existing tests that expected the added row in the scan list; add a
  test that it is gone and that a `repoint` row still shows.

### Task 6 — `waitron.sh install` installs BlueZ when it is missing

- `deploy/waitron.sh`: a new step before `disable_bluetooth_autopair` (both call sites — grep
  for it): when `bluetooth.service` is unknown to systemd and `apt-get` exists, install `bluez`
  with `apt_get install -y --no-install-recommends bluez` (the bounded, retried helper), then
  `systemctl enable --now bluetooth` best-effort. A failure must NOT stop the install: Bluetooth is
  optional, so run it so that `apt_get`'s `die` cannot end the script (e.g. a subshell) and print one
  plain warning saying Bluetooth printers will not be found until BlueZ is installed. When the unit
  already exists, do nothing. Tests in `scripts/waitron-sh.test.mjs` under its existing stubs: no
  unit → installs bluez; unit present → no apt call; apt fails → warning, install carries on.
  Check `scripts/deploy-image-env.test.ts` and `scripts/ci-workflow.test.mjs` for rules about
  apt calls in `waitron.sh` (CLAUDE.md §2: outer timeout and retries) and keep them green.
- `deploy/README.md` or the install docs: if they list what `waitron.sh install` puts on the host,
  add BlueZ.

## Not in this plan

- A spare's agent printing through the main box (backlog: "Cross-box print-agent TLS").
- Removing the other box's agent row: it is kept on purpose (see cause 1).

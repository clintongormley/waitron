# Print agent setup page: closed once joined, Bluetooth pairing from the dashboard

Status: design approved by the owner in conversation, 2026-09-27. Written spec awaiting the owner's
review.

## The problem

The print agent (`apps/print-agent`) is the small program beside the printers that fetches print jobs
from the venue's server and sends them to USB, network and Bluetooth printers. It also serves a setup
page on port 9110 (`apps/print-agent/src/setup-page.ts`), and today that page:

- listens on every network connection the machine has (`hostname: "0.0.0.0"` in
  `apps/print-agent/src/bin.ts`), over plain HTTP, with no sign-in of any kind;
- lets anyone who can reach it change which server the agent talks to (`POST /setup`). On the box
  this is already refused, because the box's container fixes the address (`WAITRON_SERVER_URL` in
  `deploy/compose.yml`); on an agent running on a separate computer it is open, so someone on the
  venue network could point that agent at a server of their own and it would stop printing the
  venue's tickets;
- lets anyone scan for Bluetooth devices (`POST /bluetooth/scan`) and pair ANY Bluetooth device with
  the machine (`POST /bluetooth/pair`, which runs `bluetoothctl pair <address>` with whatever address
  was posted). Pairing there does not make the device a Waitron printer — a manager still adds a
  printer in the dashboard, behind their sign-in — but it does pair an arbitrary device with the box
  at the operating-system level. What a paired device such as a keyboard could then do on the box has
  not been tested; the design does not depend on the answer.

Anyone on the venue network includes a guest Wi-Fi that is not kept apart from the staff network.
The page reaches the internet only if a router forwards port 9110; nothing in this repository does.

## What the owner decided (2026-09-27)

1. **Setup actions live in the dashboard.** Bluetooth pairing moves behind the manager's sign-in and
   HTTPS; the agent's page stops offering it.
2. **An agent's page is open to the network only until the agent has joined.** Before a manager lets
   it in, anyone on the network may open it, enter the server address and read the number to match —
   nothing is printing yet and the page holds nothing worth taking. Once it has joined, the page
   answers only the computer it runs on and accepts no changes.
3. **No certificate for the agent's page.** Considered: the primary's own certificate issuer (the
   private one in `apps/server/src/self-signed-cert.ts`, limited to `waitron.local`, `localhost` and
   private addresses) could sign one — the box's agent could even reuse the node's. It is left out
   because under decision 2 no certificate would ever be used: the page is open to the network only
   before joining, which is exactly when a separate agent cannot yet have one, and after joining the
   page's traffic never leaves the machine. A certificate also encrypts rather than authorises, so on
   its own it would not have stopped a stranger pairing a device. Revisit only if the page is ever
   kept reachable from the network after joining, or ever asks for a password.

## Design

### 1. Pairing a Bluetooth printer from the dashboard

What exists: the dashboard's **Scan for printers** (`POST /management-api/printer-discovery/start`)
opens a discovery window; every agent that pulls during it scans all transports, Bluetooth included,
and reports what it found in the `scanned` field of its job pull (`POST /print-api/agent/jobs`). The
server keeps that list in memory (`discovered` in `apps/server/src/print-api.ts`) and the dashboard
shows it (`GET /management-api/discovered-printers`). An unpaired Bluetooth printer therefore already
appears in the dashboard; only the pairing step is missing.

What changes:

- **Dashboard.** A discovered Bluetooth device that is not yet paired shows a **Pair** button. Pressing
  it sends a pair request for that device on the agent that saw it, shows that pairing is under way,
  and then shows the result — paired, or the reason it failed. On success the device is treated like
  any other visible printer: the manager adds it as today. The instruction that sends people to port
  9110 to pair (`printers.bluetooth_pair_note`, English and Spanish, in
  `apps/dashboard/src/i18n/strings.ts`) is rewritten to point at the Pair button.
- **Server.** A new management route accepts a pair request naming an agent and a Bluetooth address.
  It is refused unless that address is in the `discovered` list **as a Bluetooth device reported by
  that same agent's own scan** and still fresh, so the button cannot be used to pair an arbitrary
  device. It takes the same permission as starting a discovery scan. An accepted request is held in
  memory, like the network probes (`apps/server/src/printer-probes.ts`), with a short expiry, and is
  handed to that agent in its next job-pull answer. The error code follows the `printer_discovery` /
  `agent` siblings — grep them before naming it.
- **Agent.** On receiving a pair request in a pull answer, the agent runs the pairing it already knows
  how to do (`Host.pair` in `packages/print-agent/src/host.ts`), and reports each outcome in its next
  job pull, beside `visible` and `scanned`. A pairing failure never stops the job pull, the same way a
  failed scan does not today.
- **Result.** The server keeps the latest outcome per agent and address in memory for the dashboard to
  read, and drops it after a short expiry. Nothing is written to the database: like the discovered
  list, it is rebuilt from the agents' pulls, and a server restart only loses an in-flight request,
  which the manager presses again.

### 2. The page closes to the network once the agent has joined

- **"Joined"** means the agent holds a token the server has approved. The agent already persists what
  it needs to know this across a restart: a saved token with no saved `pendingVerificationNumber` is an
  approved one (the number is saved while a manager has yet to approve, and cleared on approval; the
  box's own agent approves itself over loopback and never saves one). A denied or revoked agent has its
  token cleared (`halt` in `packages/print-agent/src/agent.ts`), so it is no longer joined. The
  implementation plan confirms this reading against the code before relying on it. One gap to close:
  after a join the agent saves the token and THEN the number, in two writes, so a crash between them
  leaves a token with no number — which this reading would take for an approved agent and close the
  page on an agent nobody has let in. The plan saves the number first, or both in one write, and
  tests the order.
- **Before joining**, the page behaves as today, from anywhere on the network, minus the Bluetooth
  controls.
- **Once joined**, a request that does not come from the machine itself (a loopback address) is
  refused, whatever the path, and the page accepts no changes at all — `POST /setup` is refused even
  from the machine itself. It keeps listening on every connection, so that reopening needs no restart;
  the refusal is decided per request. The box's container health check reads `/status.json` from
  `127.0.0.1` and keeps working.
- **When a manager removes or denies the agent**, it stops being joined and its page opens to the
  network again, so it can be set up afresh from a browser. Saving a new server address on the
  reopened page must let the agent try again without a restart; today a denied agent asks again only
  after a restart (`halted` in `packages/print-agent/src/agent.ts`), and the plan says what it changes
  there. The box's own agent is unchanged in this respect: its address is fixed, so its page never
  accepts one.
- The box's own agent joins by itself within seconds of starting, so its page is closed to the network
  almost all the time. No rule is special to the box.
- The page's Bluetooth card, its two routes and the two dependencies that serve them
  (`scanBluetooth`, `pairBluetooth` in `createSetupApp`) are removed. The dashboard's other pointers
  to port 9110 — for setting up an agent on a separate computer (`printers.join_hint`,
  `printers.agent_step_open`) — stay, because that is still where a separate agent is set up.

### 3. What this does not change

- How an agent joins: the number-matching step and the manager's approval in the dashboard.
- How a printer is added, and how jobs travel.
- The agent's own connection to the server, which is already HTTPS and already trusts the box's
  certificate issuer (`apps/print-agent/src/server-ca.ts`).

## Testing

Tests first, each failing on today's code:

- **Server:** a pair request for an address the agent did not report is refused with the new code; one
  for an address another agent reported is refused; an accepted one reaches the named agent's next pull
  and no other agent's; a reported outcome is readable by the dashboard; the route refuses a caller
  without the discovery permission.
- **Agent package:** a pair request in a pull answer runs `Host.pair` and the outcome travels in the
  next pull; a throwing pair still lets the pull happen.
- **Setup page:** once joined, a request from a non-loopback address is refused on every route and a
  loopback one is served; `POST /setup` is refused once joined, from anywhere; before joining, and
  again after the agent is denied or revoked, a non-loopback request is served; the Bluetooth routes
  no longer exist.
- **Dashboard:** the Pair button appears only for an unpaired Bluetooth device, shows progress, and
  shows both outcomes. Open the screen and look — English and Spanish, light and dark, phone and
  desktop.
- **Proof by deletion** for the loopback check and for the "reported by this agent" check.

The loopback check must be tested with a real request arriving from a non-loopback address, not a
faked header: the decision reads the connection's own remote address, never a forwarded-for header.

## Open points for the plan

- Where exactly the agent's page reads the connection's remote address under `@hono/node-server`.
- Whether a paired device should also be marked trusted in BlueZ for reconnection after a reboot, and
  whether today's page does so. Measure on the real box; do not assume.
- The permission name the pair route shares with discovery, read from the existing routes.

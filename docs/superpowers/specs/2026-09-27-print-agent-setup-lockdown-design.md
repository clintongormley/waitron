# Print agent setup page: closed once joined, Bluetooth pairing from the dashboard

Status: design approved by the owner in conversation, 2026-09-27 (revised the same day after the
owner's questions on failover, restores, printers-only lists and unpairing). Written spec awaiting
the owner's review.

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

**Bluetooth printing itself does not work today.** Pairing succeeds, but turning a paired printer
into something the agent can write to is a placeholder that always throws (`liveBtDevicePath` in
`apps/print-agent/src/linux-devices.ts`), so every paired Bluetooth printer is left out of the list
the agent reports. That delivery step stays a separate backlog item ("Printer discovery and the
Bluetooth model", `docs/backlog.md`): it needs a real Bluetooth receipt printer on the box, whose
radio path is itself unconfirmed on hardware. This spec builds pairing, the printers-only list and
forgetting a pairing knowing that a paired printer still cannot print until that item lands.

## What the owner decided (2026-09-27)

1. **Setup actions live in the dashboard.** Bluetooth pairing, and forgetting a pairing, move behind
   the manager's sign-in and HTTPS; the agent's page stops offering them.
2. **An agent's page is open to the network only while the agent is not joined, or has lost every
   server.** Before a manager lets it in, anyone on the network may open it, enter the server address
   and read the number to match — nothing is printing yet and the page holds nothing worth taking.
   Once it has joined and can reach a server, the page answers only the computer it runs on and
   accepts no changes. While it can reach no server, the network sees its status and one button,
   **Join a new network** (section 3).
3. **No certificate for the agent's page.** Considered: the primary's own certificate issuer (the
   private one in `apps/server/src/self-signed-cert.ts`, limited to `waitron.local`, `localhost` and
   private addresses) could sign one — the box's agent could even reuse the node's. It is left out
   because it would protect nothing: the page asks for no password, the matching number is useful
   only to the manager who taps it in the dashboard, and after joining the page's traffic normally
   never leaves the machine. A certificate also encrypts rather than authorises, so on its own it
   would not have stopped a stranger pairing a device. Revisit if the page ever asks for a password.
4. **The dashboard lists only Bluetooth devices that look like printers**, with a way to show the
   rest.
5. **Forgetting a pairing is its own action.** Switching a printer off in the dashboard never unpairs
   it: a printer taken out of service for a day should not need re-pairing at the printer.

## Design

### 1. Pairing and forgetting a Bluetooth printer from the dashboard

What exists: the dashboard's **Scan for printers** (`POST /management-api/printer-discovery/start`)
opens a discovery window; every agent that pulls during it scans all transports, Bluetooth included,
and reports what it found in the `scanned` field of its job pull (`POST /print-api/agent/jobs`). The
server keeps that list in memory (`discovered` in `apps/server/src/print-api.ts`) and the dashboard
shows it (`GET /management-api/discovered-printers`). An unpaired Bluetooth printer therefore already
appears in the dashboard; only the pairing step is missing.

**One channel for both commands.** The server holds a short list of commands per agent — "pair this
address", "forget this address" — in memory, like the network probes
(`apps/server/src/printer-probes.ts`), each with a short expiry, and hands them to that agent in its
next job-pull answer. The agent carries each out and reports the outcome in its next job pull, beside
`visible` and `scanned`. The server keeps the latest outcome per agent and address in memory for the
dashboard to read, and drops it after a short expiry. Nothing is written to the database: a server
restart loses only an in-flight command, which the manager presses again. A failing command never
stops the job pull, the same way a failed scan does not today.

- **Pair.** A discovered Bluetooth device that is not yet paired shows a **Pair** button. The server
  refuses the command unless that address is in the `discovered` list as a Bluetooth device **reported
  by that same agent's own scan** and still fresh, so the button cannot pair an arbitrary device. The
  agent runs the pairing it already knows how to do (`Host.pair`, `packages/print-agent/src/host.ts`).
  The dashboard shows that pairing is under way, then the result — paired, or the reason it failed.
  _2026-09-29 (P2b): `BluetoothCommand` also carries an optional `pin` (1–16 printable ASCII
  characters, no spaces), and waitron.sh install switches off bluetoothd's autopair plugin where it
  can (`deploy/README.md` says when it leaves Bluetooth alone); the dashboard's Pair must ask for the PIN, and the server must never store, log or echo it. See the
  P2c entry in `docs/backlog.md`._
  _2026-09-30 (A138): the button is Pair and add, and a succeeded pairing opens the add form. (A141: for a switched-on printer the button is Pair, and no form opens.)_
- **Forget pairing.** A switched-off Bluetooth printer (`POST /management-api/printers/:id/deactivate`
  already exists) shows a **Forget pairing** action. The server refuses it unless that agent reports
  the address among its paired devices. The agent removes the pairing (`bluetoothctl remove <address>`
  is the expected command; the plan confirms it on the box). The printer's registration stays, as
  every switched-off printer's does, so it can be paired and switched on again later.
  _2026-09-30 (A138): a listed paired device with no printer row also offers Forget pairing._
  _2026-09-30 (A141): an added Bluetooth printer's row offers Forget pairing whether it is switched on or off; in Spanish it is "Desvincular". A printer forgotten while switched on stays switched on. While no agent reports it paired, Add a printer lists it once an agent's scan finds it, without Show all devices, and offers **Pair** (Spanish "Emparejar"), which pairs it again without adding anything; the row keeps Pair so an unconfirmed pairing can be retried, and loses its Pair button once an agent reports it paired (its Paired status stays until dismissed)._
- **Both commands** take the same permission as starting a discovery scan, read from the existing
  route. Their error codes follow the `printer_discovery` / `agent` siblings — grep them before naming
  them.
- **Wording.** The instruction that sends people to port 9110 to pair (`printers.bluetooth_pair_note`,
  English and Spanish, in `apps/dashboard/src/i18n/strings.ts`) is rewritten to point at the Pair
  button, and says that Bluetooth printing is not available yet until the delivery item lands.

### 2. Only printers in the Bluetooth list

Bluetooth devices announce what kind of device they are. A printer announces the "imaging" major
class with the "printer" flag, which BlueZ reports as `Icon: printer`; most Bluetooth receipt printers
also offer the Serial Port service. When scanning, the agent asks BlueZ about each device it found
(`bluetoothctl info <address>` is the expected source) and reports, beside each device, whether it
looks like a printer: the printer icon or class, or the Serial Port service.

The dashboard lists only the devices that look like printers, with a **Show all devices** link for
the rest — a printer that describes itself wrongly must still be reachable. How real receipt printers
describe themselves has not been measured; the plan records what the box reports for the first real
Bluetooth printer tried, and the decoder's tests are labelled as built from BlueZ's documented output
until then, as `apps/print-agent/src/bluetooth.ts` already does for its other decoders.

### 3. The agent's page and the network

The page answers in one of three ways, decided afresh on every request from the agent's current state.
It keeps listening on every connection so that changing state needs no restart. A request counts as
coming from the machine itself only by the connection's own remote address being a loopback address —
never by a forwarded-for header.

| The agent is…                                     | From the machine itself            | From the network                                        |
| ------------------------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| **not joined** (no approved token)                | the setup page as today            | the setup page as today                                 |
| **joined, and a primary answers**                 | status only; no changes            | refused                                                 |
| **joined, and no primary answers** (out of touch) | status and **Join a new network**  | status and **Join a new network**                       |

"The setup page as today" means the server-address form (still refused on the box, whose address is
fixed) and the number to match, without the Bluetooth card, whose two routes and two dependencies
(`scanBluetooth`, `pairBluetooth` in `createSetupApp`) are removed.

**Joined** means the agent holds a token the server has approved. The agent already persists what it
needs to know this across a restart: a saved token with no saved `pendingVerificationNumber` is an
approved one (the number is saved while a manager has yet to approve and cleared on approval; the
box's own agent approves itself over loopback and never saves one). A denied or revoked agent has its
token cleared (`halt` in `packages/print-agent/src/agent.ts`), so it is no longer joined. The plan
confirms this reading against the code before relying on it. One gap to close: after a join the agent
saves the token and THEN the number, in two writes, so a crash between them leaves a token with no
number — which this reading would take for an approved agent. The plan saves the number first, or
both in one write, and tests the order.

**Out of touch** means the agent's latest attempt found no primary accepting it in its environment, or
its job pull failed for a reason other than being refused. Being refused (`unauthorized`) already
clears the token, which makes the agent not joined, so it never counts as out of touch.

**Join a new network.** Pressing it starts a five-minute countdown, shown on the page with a
**Cancel** button:

- the agent looks for a primary again straight away, and keeps trying for the whole five minutes;
- if a primary accepts it at any point, the countdown is called off and the page closes to the
  network again — a server that is only briefly down never loses its agent;
- **Cancel** calls it off too;
- if the countdown ends with no primary found, the agent resets: it discards its token and its saved
  list of nodes (below), and starts again. An agent on a separate computer then shows the
  server-address form, and a manager must approve its new join on whichever server it is pointed at.
  The box's own agent, whose address is fixed, joins its box again by itself.

Today a denied agent asks again only after a restart (`halted` in `packages/print-agent/src/agent.ts`).
After a reset, or after a new address is saved on the page, the agent must try again without one; the
plan says what it changes there.

**The risk this keeps, stated so nobody assumes otherwise:** someone who can cut an agent off from
every server, press the button and wait out the five minutes can then point a separate agent at a
server of their own and send its printers whatever they like. They gain nothing else — the venue's
server never accepts that agent again without a manager approving a fresh join.

### 4. The agent remembers the venue's nodes across a restart

Every job-pull answer carries the venue's nodes that can serve (`servers`, from `routableServers` in
`packages/membership/src/fence.ts`), and the agent follows whichever is primary, as the till does
(`packages/print-agent/src/router.ts`). Its token lives in `print_agents`, a `state` table in the
venue's database, which a standby or a restore from the bucket holds too, so the same token is
expected to work on a promoted node — expected, not measured: today a venue has one node and no
failover. The router keeps that list in memory only, so an agent that restarts while its configured
server is down knows only that one address. The agent saves the list in its state file whenever it
changes and loads it on start. The configured address always stays first, as today, and the
environment check that never sends a token to another environment is unchanged.

### 5. What this does not change

- How an agent joins: the number-matching step and the manager's approval in the dashboard.
- How a printer is added, and how jobs travel.
- The agent's own connection to the server, which is already HTTPS and already trusts the box's
  certificate issuer (`apps/print-agent/src/server-ca.ts`).
- Bluetooth delivery, which stays unbuilt (see "The problem").

## Testing

Tests first, each failing on today's code:

- **Server:** a pair command for an address the agent did not report is refused with its code; one for
  an address another agent reported is refused; a forget command for an address the agent does not
  report as paired is refused; an accepted command reaches the named agent's next pull and no other
  agent's; a reported outcome is readable by the dashboard; both routes refuse a caller without the
  discovery permission.
- **Agent package:** a pair or forget command in a pull answer is carried out and its outcome travels
  in the next pull; a throwing command still lets the pull happen; the node list survives a restart,
  with the configured address still first.
- **Setup page:** each cell of the table in section 3, from a loopback and a non-loopback address; a
  countdown that finds a primary is called off; Cancel calls it off; a countdown that ends resets the
  agent and it tries again without a restart; the Bluetooth routes no longer exist.
- **Bluetooth decoder:** a device with the printer icon, one with only the Serial Port service, and
  one with neither.
- **Dashboard:** Pair appears only for an unpaired Bluetooth device and shows progress and both
  outcomes; Forget pairing appears only on a switched-off Bluetooth printer; the list hides non-printers
  until Show all devices. Open the screen and look — English and Spanish, light and dark, phone and
  desktop.
  _2026-09-30 (A141): Forget pairing now appears on an added Bluetooth printer whether it is switched
  on or off._
- **Proof by deletion** for the loopback check, the "reported by this agent" checks and the countdown's
  call-off.

The loopback check is tested with a real request arriving from a non-loopback address, not a faked
header.

## Open points for the plan

- Where the agent's page reads the connection's remote address under `@hono/node-server`.
- Whether a paired device should also be marked trusted in BlueZ for reconnection after a reboot, and
  whether `bluetoothctl remove` is the right way to forget one. Measure on the real box; do not assume.
  _2026-09-29 (A129): on the real box the agent could not reach BlueZ at all — Docker's default
  AppArmor profile refuses the system bus. It now runs under `deploy/apparmor/waitron-print-agent`,
  whose bus rules cover what `list`, `devices` and `scan` were measured to need. The pairing call
  itself, what BlueZ calls back into bluetoothctl while pairing, and `trust` (a property write), are
  not allowed yet; the real-box measurement decides them. See `docs/backlog.md`, B6._
  _2026-09-29 (P2b): the owner's box showed a bond is enough to reconnect, with `Trusted: no`, and
  `remove` forgets a printer. The profile now allows pairing with a PIN through interactive
  bluetoothctl, and `remove`, measured on a CI runner against the stand-in BlueZ; `trust` stays
  refused. Receipts in the profile's header._
- The permission name the two routes share with discovery, read from the existing route.

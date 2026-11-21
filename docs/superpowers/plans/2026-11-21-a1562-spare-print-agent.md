# A1562 — the spare box's print agent prints through the main box

Status: approved by the owner on 2026-11-21 and built in branch `feat/a1562-spare-print-agent`. Lane A, 2026-11-21.

As built (2026-11-21), where the code differs from the tasks below: the `.local` lookup is its own
file (`apps/print-agent/src/local-name-lookup.ts`), listening on port 5353 in the multicast group
because the box's server answers to the group; it asks again at 250 ms and 1 s, hands every address
in the answer to the connection, and passes the name to the normal lookup when no answer comes
within 1.5 s; the main box counts a request against its rate limit only once the signature checks,
and refuses a request signed by itself; every print agent's sign-in (`requireAgent`,
`apps/server/src/print-agent-session.ts`) refuses an agent whose box the held chart has removed,
before it is marked as seen; and an agent stopped after its token was refused asks its own box for
a new one again, at most every 30 seconds, as does a spare's agent its box refuses.

## What the owner asked for

The owner, 2026-11-21, after #3902 landed: "A print agent on the spare should be able to print. It
should connect to the main server (hopefully automatically, using info from the spare server)."

**When this lands:** a printer plugged into the spare box (USB or Bluetooth) prints, with nobody
approving anything by hand. The spare's print agent sends its pulls to the main box. If the boxes
swap, it carries on printing through whichever box is now the main one.

**Still not covered:** an agent on a separate machine that is not a Waitron box (A1203) still needs
someone to approve it once. It does get the `.local` lookup below.

## What is in the way today

Measured on the owner's two boxes on 2026-11-21 (lane A's queue entry has the commands):

1. **The certificate is not a problem.** Both boxes use the same venue certificate authority, and
   the spare's agent already trusts it.
2. **Nobody tells the agent where the main box is.** The spare's server knows the address and
   already serves it at `GET /api/node/main` (`apps/server/src/node-api.ts`, mounted only on a
   spare). The agent never asks for it. It hears about other boxes only from a pull answer
   (`servers`), and a spare never answers a pull.
3. **The agent cannot look up `.local` names.** The chart gives the main box's address as
   `https://box-0793.waitron.local`. Inside the agent's container that name does not resolve. The
   box's own system lookup fails for a name with three parts, too.
4. **The agent has no approval.** It approves itself only by asking its own box over loopback
   (`POST /api/node/enrol-self`), and only the main box agrees to that.

## The change: one pull request, built in two tasks

One pull request, not two. With only the first half, the spare's agent would ask a manager for
approval (it "knocks"), and once it has knocked it never tries to approve itself again
(`packages/print-agent/src/agent.ts`, the self-enrol step runs only while it holds no token). So the
first half on its own would leave the spare waiting for a person for good.

### Task 1 — the agent finds the main box and reaches it (print agent)

- **Ask the spare where the main box is.** When the agent's own box answers as the spare
  (`configuredIsSpare` in `packages/print-agent/src/router.ts`), the agent reads
  `GET /api/node/main` on that same loopback address within the same round, and adds the answer to
  the boxes it already follows. (`Router.merge` replaces the list, so it is given the boxes it knows
  plus the main box.) The configured address stays first, so the agent goes back to its own box if
  that box becomes the main one. Pull answers then keep the main box on the list, as they name every
  box the chart lists.
- **A spare's agent never knocks.** While its own box answers as the spare and it holds no token, the
  agent keeps asking its own box to vouch for it (Task 2) and shows the spare message, rather than
  asking a manager. Its wait for that answer grows from 3 to 10 seconds, so the spare has time to look
  up and ask the main box (which can take 2 seconds for the lookup and up to 5 for the request).
- **Look up `.local` names itself.** The agent's trusted HTTPS connection
  (`apps/print-agent/src/server-ca.ts`, the one built once the venue's certificate authority is held,
  which the owner's spare's agent holds: its state folder has `server-ca.crt`, measured 2026-11-21) gets its own name lookup. A name ending in `.local` is asked on the
  local network by multicast DNS, taking the first answer; any other name goes to the normal lookup.
  The agent already sends multicast DNS questions for printer discovery
  (`apps/print-agent/src/linux-devices.ts`), so this extends that code and adds no library.
  The certificate is still checked against the name, not the address, so a box whose address changes
  (a new DHCP lease) keeps working once it answers under its name again.
  Tried on 2026-11-21: with a lookup function, undici reached a test server under a `.local` name
  over HTTP, and the plan's reviewer repeated it over HTTPS with a test certificate authority. The
  right certificate passed; a certificate for another name failed (`ERR_TLS_CERT_ALTNAME_INVALID`);
  with no lookup the request failed, and with no authority it failed on trust. undici asks with
  `all: true` and expects a list of addresses back.
- **Not shared with the server's lookup** (`apps/server/src/box-lookup.ts`). The `@waitron/print-agent`
  package imports no other package in this repository (CLAUDE.md §3), and the server's lookup waits
  for every answer within 2 seconds, which suits checking for other boxes but not a connection.
  A1203 uses the agent's lookup.

### Task 2 — the spare vouches for its own agent (server)

- **On the spare:** `POST /api/node/enrol-self` from loopback no longer refuses. The spare signs a
  short request with its own box key (`signAsThisBox`, the key boxes already use to ask each other
  questions). The request carries the agent's name. The signature names its purpose, from a fixed
  list (`packages/shared/src/handover-envelope-types.ts`, `packages/handover/src/envelope.ts`); this
  adds a new purpose, `agent-enrol`, so a request signed for one route cannot be used on another.
  The spare sends it to the main box with `postToBox` (`apps/server/src/boot-peer-check.ts`), which
  checks the main box's certificate under the venue's authority and finds `.local` names through the
  server's own lookup. The token the main box sends back goes straight to the agent; the spare stores
  nothing. A spare is a read-only box, so this one loopback request gains a row in
  `apps/server/src/read-only-exemptions.ts` (boxes: mirror), saying it authenticates by coming from
  loopback and is signed onward by this box's key.
- **On the main box:** a new box-to-box route, `POST /api/node/print-agent`, listed in
  `apps/server/test/peer-route-inventory.ts` and `apps/server/src/peer-route-limits.ts` like the
  others. It checks the signature against the keys `peerKeyOf` vouches for (a box its chart lists and
  has not removed), as `POST /api/node/peer-status` does. Then it runs the same database step
  self-enrolment runs today (`selfEnrolNodeAgent`, `apps/server/src/join-requests.ts`), under the
  SPARE's box id. That makes or reuses the one agent row the spare may have, and returns a new token.
  A box that is not the serving main box refuses it, as `enrol-self` does today.
- **No replay check.** The request travels only over a certificate-checked connection between two
  boxes, so a copy exists only on boxes that already hold more than the token gives.
- **Why trust a box's signature:** a box the chart lists already holds a copy of the venue's
  database (lane A read the owner's spare's `venue.db` on 2026-11-21). An agent token lets its holder
  print and see print jobs, which is less than that, so issuing one adds no new exposure.
- **No new error codes.** When the main box cannot be reached or says no, the spare answers "refused",
  and the agent shows the spare message and asks again on its next round.

### After the boxes swap

The agent's row lives in the venue database (`print_agents` is classed `state`), which moves with
the handover. So the token keeps working at whichever box is the main one. On the box that has just
become the spare, its agent already holds its own token, and Task 1 points it at the new main box.

### The old agent row on the owner's main box

The main box's database still holds an agent row made under the old box's id. Each box keeps at
most one agent row, matched by its box id.

- If the spare's box id is the same as that row's, the spare's request reuses the row and gives it a
  new token. If that row was deleted on the dashboard, the main box refuses and the spare keeps
  showing its message. Delete keeps the row, marked unusable, and lists it among deleted agents with
  an Add button (`apps/dashboard/src/screens/printers-screen.ts`); Add fixes it.
- If the id is different, the row stays as it is. Nobody holds its token, so it cannot pull. Print
  jobs for a USB or Bluetooth printer go to whichever agent sees that printer (`claimPrintJobs`,
  `packages/printing/src/runtime.ts`), so the printer is not stuck on the old row. The row shows on
  the Print agents list as last seen on 20 November; Delete takes it off, as for any agent.

No code is written for the old row.

## What people see

- **The agent's setup page on the spare** says today: "This box is the venue's spare. This agent
  starts printing again if this box becomes the main box." While the agent prints through the main
  box, the page shows the normal printing state, naming the main box. The spare message stays only for
  when the main box cannot be reached or will not approve it, and becomes: "This box is the venue's
  spare and cannot reach the main box. This agent prints again when it can, or when this box becomes
  the main box."
- **The main box's dashboard** lists the spare's agent under Print agents as on another box. It shows
  no link to the agent's setup page, because that link is built only for an agent on the same box.
  This plan leaves that as it is.

## Tests

- Task 1: the router adds the main box when its own box answers as the spare, keeps the boxes it
  already knew, and goes back to its own box when that box answers as the main one (`router.test.ts`,
  `agent.test.ts`). A spare's agent with no token asks its own box again rather than knocking. The
  lookup answers `.local` names from the first reply of a fake multicast socket and passes other names
  on. The setup page's spare text.
- Task 2: the main box gives a token to a request a listed box signed, and refuses one that is
  unsigned, signed for another purpose, or signed by a box the chart does not list or has removed. It
  refuses on a box that is not the main box. The spare passes the token on, and says "refused" when
  the main box is silent. One end-to-end case on the two-box test setup
  (`apps/server/src/testing/spare-join-scenario.ts`): the spare's token works for a pull at the main
  box.
- Physical proof is the owner's: plug a printer into the spare, open the spare agent's setup page, and
  print a test page from the dashboard.

## Size

Estimated at 750 to 1,000 lines with tests across about 20 files (the reviewer's estimate, higher
than this plan's first one; not measured). That is larger than a small item, so the watcher may want
to give the build to another lane.

## Backlog

The pull request deletes the A1562 entry in `docs/backlog.md` (Printers) and the pointer to it beside
"The mirror as a backup destination".

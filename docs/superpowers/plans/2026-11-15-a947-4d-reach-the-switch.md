# A947 slice 4d — reaching the switch from any device: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** revision 2, 2026-11-15 (lane A). Revision 2 takes a fresh-context Claude plan read
(`~/waitron-campaign/receipts/a947-4d-plan-review.md`: 2 Critical, 9 Important, 11 Minor; every
Critical and Important taken, the Minors as noted at their steps). Queued by the campaign watcher on
2026-11-15 at 00:36 (`~/waitron-campaign/queue.md`, "A947-4d-plan"): plan only, no build until 4c
has landed. The design it implements: the owner approved its second revision on 2026-10-22 at about
02:40 (the design's header; `~/waitron-campaign/archive/questions-to-2026-10-23.md`, "OWNER ANSWER —
A947 second revision"). The owner has NOT approved this plan.

**Goal:** when the main server dies, any device at the venue reaches the spare's switch page, even
one that has reloaded its page or was never open. A till or phone that opens the venue's usual
address lands on the switch page. A phone that scans the spare's label opens it at the spare's own
address. The spare's own page says the main server is silent and links to the switch. A manager can
prove who they are there with a passkey as well as with a password.

**Architecture:** the spare already serves its switch page at its own name
(`https://box-<id>.waitron.local/handover/emergency`, A1018 Slice 6 and A947 4b). Its leaf
certificate already names the venue's name as well as its own (`leafHostnamesFor`,
`apps/server/src/box-name.ts:22-27`). Every spare already runs one gate, `spareReadGate`
(`apps/server/src/spare-read-gate.ts`, registered at `boot.ts:2404`), which serves its "closed"
page at `/` and `/manage/*` and refuses other reads with `node.spare`. 4d adds one watch to the
spare: every 5 seconds it asks the main box, by the same signed query the switch uses to refuse
(`askPeerStatus`, `apps/server/src/boot-peer-check.ts:447-505`). After 20 seconds in which every ask
was "unreachable", the spare's name responder adds the venue's name and announces it, and
`spareReadGate` sends a page opened at the venue's name to the switch page. The first ask with any
other result withdraws the venue's name. The same watch puts a line on the spare's own page. Labels
are printed from Servers. Passkeys are checked against the venue's name and both boxes' own names,
and the switch takes a passkey, carrying a short signed proof between its steps.

**Tech stack:** TypeScript, Hono (`apps/server`), Lit (`apps/dashboard`, `apps/setup`), Vitest (Node
and browser mode), Playwright's Chromium for one measurement.

**Spec:** [`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md`](../specs/2026-10-21-a947-two-box-failover-design.md):
§11's 4d line, §6.6 (all of it), §6.5 "Every wait explains itself" (the switch rows), §6.1's last
sentence (the spare's banner), §6.2's proof and its last paragraph (both sides try the main box),
§6.3 step 4 (the same-site cookie), §13's measurement lines, and the A1018 block at the top. Read
with the 4b plan ([`2026-11-14-a947-4b-promote-from-followed-copy.md`](2026-11-14-a947-4b-promote-from-followed-copy.md)),
#3219's body, and the 4c plan ([`2026-11-14-a947-4c-devices-follow.md`](2026-11-14-a947-4c-devices-follow.md)).

**What 4c handed to 4d.** The watcher cleared 4c's plan on 2026-11-14 at 22:01 and moved these here
(`~/waitron-campaign/questions.md`, "PLAN FOR APPROVAL: A947-4c", numbered as there): (1) no
dashboard entry in 4c: a reloaded dashboard reaches the switch through 4d (Task 3's redirect);
(2) the spare's own banner (Task 4); (3) the same-site cookie measurement (Task 8); (4) the till says
"server", not «equipo» (applied to every 4d word); (5) no "ask for help" sentence when the clocks
differ (4d adds none); and 4c's Q1, the switch's passkey (Tasks 6 and 7).

**Not fiscal.** No task changes a record, chain, series, filing, promotion or activation step. The
golden huella test and `inmutabilidad` are not touched. Lane A lands each pull request once green.
Tasks 6 and 7 change sign-in, a risk trigger in the owner's review rules, so PR 4d-3 takes the full
review ceremony; 4d-1 and 4d-2 take the light path.

## What the design's 4d line asks, and where each part stands

Read on `main` at 4ffb0fe9bb, plus #3219's branch (4b) and the 4c plan.

| §11 4d asks | Today | 4d does |
| --- | --- | --- |
| The spare's switch page | Built: `/handover/emergency` on a box whose `node.db` mode is `mirror` (`handover-page-mount.ts:24-25`); the take, catch-up and held-copy button are 4b's | The page's own check of the main box (Task 3) |
| The spare answers the venue's name with only that page while the main box is silent, and stops when it answers | A mirror answers only its own name (`boot.ts:4481-4483`). Nothing on the spare asks the main box between switches: the main box writes to the spare's store, and the spare follows its own store | PR 4d-1, Tasks 1–3 |
| The QR labels | None. Equipment labels for printers and readers exist (`apps/dashboard/src/widgets/equipment-label.ts`, `printEquipmentLabel` at `:39`), but their QR holds an equipment code, not an address | PR 4d-2, Task 5 |
| The switch page's explained waits, with the "no second clock" text on the spare's own screen | Built: the wait says "This screen is on the box itself, so it does not count" when the browser runs on the box, judged by network address (`clock-wait.ts:64,100,442`); 4c Task 2 sets the switch's what-to-do words | Nothing: a page reached at the venue's name is the same page, and the on-box judgement does not read the name |
| Passkeys checked against the venue's and both boxes' own names | Every passkey check passes one origin, `WAITRON_MANAGEMENT_ORIGIN` (`config.ts:456-458`; `passkey.ts:210,309,412`) | PR 4d-3, Task 6 |
| The switch's passkey (owner, design §6.2: "passkey or password (+authenticator code if configured)") | The switch takes email, password and code with each request (`handover-preparation.ts:94-121`) | PR 4d-3, Task 7 |
| Measured on the till hardware: two-part `.local` names, the name cache after the main box dies, a passkey at each way in | Not measured. The design's one run is macOS 26.6 for the name and Playwright's Chromium 156 for the passkey (§6.6) | Task 8 |

## Decisions

- **D1 — "silent" means what the switch already calls silent, and it needs a main box the spare has
  reached before.** The watch uses `askPeerStatus` and counts an ask as silent only when its reason
  is `unreachable`, the one reason the switch's own check lets a switch go on (`sourceSilent`,
  `handover-emergency-api.ts:187-215`). `unreachable` comes from `CheckedAddressUnreached`
  (`boot-peer-check.ts:484`): the box transport tried the address it last reached the main box at,
  under the venue's authority, and got no answer. The reviewer measured it: a remembered address that
  drops packets, and one that refuses, both give `unreachable` after 5,000 ms, and with no remembered
  address the same drop gives `not_established`. So:
  - a dead main box, whether it refuses or drops, is silent;
  - a main box the spare has **never** reached at its own name is never silent, so the spare never
    takes the venue's name and its switch refuses with `handover.source_not_established`. The watch
    removes that gap while both boxes are up: its first answered ask stores the address
    (`CheckedAddresses`, persisted in the state folder, `mirror-bundle-fetch.ts:191-213`);
  - a main box that is up but that the spare cannot reach stays "not reached", and the spare's page
    says so (Task 4), because in that state a failover would refuse.
  A main box that answers slowly, refuses the query, or answers unsigned is not silent.
- **D2 — the spare asks every 5 seconds and takes the venue's name after 20.** 5 seconds is the
  till router's probe interval (4c plan); 20 seconds is §6.1's strip delay, a starting value (§13).
  Constants `MAIN_ASK_INTERVAL_MS = 5_000` and `MAIN_SILENT_MS = 20_000`, both overridable through a
  boot seam for tests. Silence is timed from the start of the first `unreachable` ask after an
  answer or after the watch starts. Each ask to a dead box takes the transport's 5 seconds, so the
  spare takes the name about 20 to 30 seconds after the main box dies. The watch runs only on a box
  whose mode is `mirror` and whose held chart names a `serving-primary` other than itself; a box
  still joining (the adoption latch, `boot.ts:1974-2066`) does not run it.
- **D3 — the venue's name is announced when taken and withdrawn when dropped.** Today's responder
  only answers questions (`mdns.ts:56-80`), and its answers last `MDNS_TTL_SECONDS` = 120
  (`box-lookup.ts:13`) in a device's cache. Without a withdrawal, after a main box's reboot both
  boxes would be cached under `waitron.local` for up to two minutes, and a reloading till could land
  on the switch page during routine work. So the responder gains `announce(name)` (an unsolicited
  answer) and `withdraw(name)` (the same answer with a lifetime of 0, which tells devices to drop it),
  and the watch calls them when it takes and drops the name. Whether every till platform obeys either
  is Task 8's measurement.
- **D4 — `spareReadGate` decides what the venue's name serves; no second gate.** Two changes to its
  page branch, judged by the request's host name (`new URL(c.req.url).hostname`; production listens
  on 443, so a browser sends `Host: waitron.local` with no port, `deploy/Dockerfile:325`):
  - while the watch is silent, a page (`/`, `/manage`, `/manage/*`) asked for at the venue's name gets
    `302` to `/handover/emergency`, instead of the closed page. This is how a reloaded till, a
    reloaded dashboard (4c's (1)) and a browser on the box itself pointed at the venue's name reach
    the switch;
  - while the watch is not silent, the same request (a device with the spare's address still
    cached) gets `302` to the main box's own address, from the held chart.
  Every other path behaves as today, at either name: `/ca.crt`, `/setup/trust`, `/help/*` and
  `/legal/*` stay open, which a phone needs to trust the venue's certificate (Task 8, item 4); other
  reads keep `node.spare`. No new error code.
- **D5 — both sides try the main box, and the page's own try is a check only an enrolled device can
  make.** §6.2: "Before the dialog opens, the spare and the till both try the main box". 4c's till
  does its side. A page reached by the venue's name or a label was opened by no till, so it tries
  itself: on load it reads `GET /api/node/main` (new, Task 3: `{ mainUrl }`, the held chart's
  `serving-primary` contact address, or `null`) and fetches `<mainUrl>/api/node` with
  `mode: "no-cors"` and a 3-second limit. A fetch that resolves is an answer (4c's `probeMain` rule);
  the page then says the main server is still answering, links to its own address, and offers the
  switch only after "Check again" finds it silent. A fetch that rejects or times out lets the page go
  on. On a device that does not trust the venue's certificate, or cannot resolve the main box's own
  name, the fetch always fails, so the page treats the main box as silent; the spare's own check (D1)
  still guards every step of the switch. The check costs one route and one fetch, and it covers a
  main box that the spare cannot reach but devices can.
- **D6 — labels are printed from Servers, not at joining.** §6.6 way 2 says "printed at joining". The
  join finishes on the spare's setup page, which knows no printer, and the main box's Servers screen
  already lists both boxes with a row menu (`servers-screen.ts:505-530`). Each row gets "Print switch
  label", printed through the browser as equipment labels are (`printEquipmentLabel`). A receipt
  printer is not offered: the equipment-label route (`print-api.ts:1506-1540`) prints an equipment
  code, and a box's label is printed once or twice in its life. The join's last screen and the
  Servers guide say to print one for each box.
- **D7 — the label carries the box's own name, not an address.** The QR holds
  `<the box's contactUrl>/handover/emergency`, and the text beneath repeats it. An IP address would
  open on a phone that cannot resolve `.local`, but it changes with the router's leases, and a
  passkey never works at an address (§6.6, trap (a)). `box-reach.ts:13-15` records that `.local` is
  unreliable on iOS for the trust page's QR; Task 8 measures it for this label.
- **D8 — a label opened on the box that sells goes to Servers.** Both boxes carry a label, so the
  main box's is scanned while it sells. Today `/handover/emergency` answers `404` on a box not in mode
  `mirror` (`handover-page-mount.ts:24-25`). On a box accepting sales it now redirects to
  `/manage/servers`, where a manager sees both boxes and the controlled handover; every other mode
  (waiting, fenced, restricted) keeps the `404`.
- **D9 — the switch's passkey: one unlock per step that needs it, carried by a signed proof in a
  cookie the page cannot read.** The switch page sends the person's sign-in with each request: take,
  preview, declaration, preparation and activation (`handover-screen.ts:182`), and the take restarts
  the spare (4b's D3). So:
  - a passkey sign-in is accepted at any emergency step. Its challenge is made by a new
    `POST /api/node/handover/emergency/passkey-challenge` and kept in the spare's memory for two
    minutes, never in `webauthn_challenges` (whose sign-in insert is `passkey.ts:263-266`), because
    that table streams with the database the follower writes (design §6.3 step 1);
  - a request that passes with a passkey gets back a switch proof as a cookie: `HttpOnly`, `Secure`,
    `SameSite=Strict`, host-only, `Path=/api/node/handover`, valid 15 minutes. It survives a page
    reload and the take's restart, and the page's own scripts cannot read it;
  - the proof is a statement `{ personId, nodeId, expiresAtMs }` signed with this box's node key
    (`signAsThisBox`, `handover-signing.ts`), so nothing is stored and no `node.db` table is added.
    Each use checks the signature with this box's own key, the expiry, that this box is still in mode
    `mirror`, and, against the venue database the request reads, that the person is active and holds
    `node.manage`. A proof that fails any of them is refused as `password.invalid` would be, and the
    page offers the passkey again. Activation ends the mirror mode, so no proof outlives the switch;
  - verifying an assertion without writing anything needs a new identity function,
    `verifyPasskeyAssertion` (the existing `finishPasskeyAuthentication`, `passkey.ts:270-336`,
    deletes its challenge row, writes the key's counter and starts a session). The new function checks
    the counter against the stored one and does not write it: on this one sign-in, the check that
    catches a copied key does not advance. Stated at its site;
  - the controlled handover keeps the password: only the emergency switch takes a passkey.

## Departures from the approved design

1. §6.6 way 2, "printed at joining": printed from Servers (D6).
2. §6.6 way 2's words «Si el equipo principal falla, escanea esto desde cualquier caja o móvil del
   local» and the path `/cambiar`: the till's word is "server" (owner, 2026-11-07, #2542), and the
   page's path is the A1018 page's, `/handover/emergency`. The label reads «Si el servidor principal
   falla, escanea esto con cualquier caja o móvil conectado a la red del local» / "If the main server
   fails, scan this with any till or phone on the venue's network".
3. §6.6 way 3, the spare's own screen: nothing beyond D4. A browser on the box that opens the venue's
   name lands on the switch page and sees the existing on-box wait. B3 decides whether a box has a
   screen.
4. §6.2's passkey for the controlled handover (§6.4, now A1018's): not built (D9).
5. §6.6 way 1's "shortens the lifetime if needed": 4d announces and withdraws the name (D3) and
   measures (Task 8), and does not change `MDNS_TTL_SECONDS`. A change, if the measurement asks for
   one, is its own small pull request with the measurement as its receipt.
6. §6.1's "The spare box also shows a banner on its own status page": the spare's status page is its
   closed page (`renderSparePage`), not the dashboard's Box status, which a spare never serves
   (`spareReadGate` refuses `/api/box/status`). The line goes there (Task 4).

## Questions

None. The passkey was the owner's answer to the design's question 2; D9 is the mechanism.

## Global constraints

- Wording (English in code, Spanish in the translation files):
  - spare page, silent: "The main server has not answered for {duration}." / «El servidor principal
    no responde desde hace {duration}.», then the link "Open the switch page" / «Abrir la página de
    cambio».
  - spare page, never reached: "This spare cannot reach the main server, so it could not take over if
    the main server failed. Check the network cable of each server." / «Este servidor de reserva no
    llega al principal, así que no podría sustituirlo si fallara. Revisa el cable de red de cada
    servidor.»
  - the page's check (D5): "The main server is still answering. Open it at its own address, or hand
    over from Servers there." / «El servidor principal todavía responde. Ábrelo en su propia dirección
    o haz el traspaso desde Servidores allí.», the address as a link, and "Check again" / «Comprobar
    otra vez».
  - the label: departure 2's words, the address beneath the QR, and the box's name above it.
  - Servers row action: "Print switch label" / «Imprimir etiqueta de cambio».
  - the switch's sign-in: "Use my passkey" / «Usar mi llave de acceso» beside "Use my password" /
    «Usar mi contraseña» (§6.6).
- CLAUDE.md §3: "A refusal explains what happened and what each choice does"; every colour reads a
  `--wt-*` token; a screen change updates its guide in English and Spanish; a page asserted as a
  string is opened and looked at (CLAUDE.md §4).
- Sizes: 4d-1 about 650 changed lines of code and tests (stop and report at 950); 4d-2 about 300 (stop
  at 450); 4d-3 about 700 (stop at 1,000).
- H1 (the campaign runbook's rule against starting a migration-adding item while one of the lane's
  pull requests is parked) does not apply: 4d adds no migration.

## Review focus

1. **Two answers for the venue's name.** If the watch is wrong, both boxes answer `waitron.local`.
   Task 1 tests that an answered ask during silence withdraws the name at once. The page's own check
   (D5) and the person's "switched off" statement still stand before any switch.
2. **The take's restart.** The take restarts the spare (4b's D3) and the watch starts again. The
   remembered address persists, so the first ask after the restart answers `unreachable` within its 5
   seconds. A spare holding a taken copy (4b's staged followed copy) counts itself silent from that
   first `unreachable` ask, not 20 seconds later. Test (Task 1).
3. **A spare that has stopped following for a take.** The watch keeps running; the take asks the main
   box again before it stops (#3219, fix 6).
4. **Nothing changes on a box that sells, waits or is fenced.** `spareReadGate` is mounted only on a
   mirror boot (`boot.ts:2404`), and the watch only on a mirror.
5. **The proof (4d-3).** Never logged, never in a URL or page storage, signed by this box and
   worthless on the other, refused after 15 minutes and once the box is no longer a spare.

---

## PR 4d-1: the spare answers the venue's name while the main server is silent

### Task 1: the spare's main-server watch, and the name it takes

**Files:**
- Create: `apps/server/src/main-silence-watch.ts`, `apps/server/src/main-silence-watch.test.ts`
- Modify: `apps/server/src/mdns.ts` (`announce` and `withdraw` on `MdnsResponder`) and
  `apps/server/src/mdns.test.ts`
- Modify: `apps/server/src/boot.ts` (start the watch on a mirror's trading start and register its stop
  on `undoOnFailure`; the mirror's `names` at `:4481-4483` add `BOX_HOSTNAME` while the watch is
  silent; a seam `seams.mainSilence` for the interval and the delay)
- Modify: whichever of `apps/server/src/background-duties.ts` and `apps/server/src/job-catalogue.ts`
  CLAUDE.md §5's restriction rule asks of a new background duty (the guard is
  `apps/server/src/handover-stepdown.test.ts:307`, "every closer is either atStepdown or carries a
  reason")

**Interfaces:**
- Produces: `startMainSilenceWatch(deps: { ask: () => Promise<"answered" | SilentReason>; now: () => number; intervalMs: number; silentAfterMs: number; silentFromFirst: boolean; onChange: (silent: boolean) => void; log: Logger }): { state(): { silentSinceMs: number | null; reached: boolean; silent: boolean }; stop(): Promise<void> }`.
  `ask` is built in `boot.ts` from `askPeerStatus` exactly as `sourceSilent` builds it
  (`handover-emergency-api.ts:191-205`). `reached` is false until an ask has answered or reported
  `unreachable` (an ask that never got past `not_established` leaves it false). `silentFromFirst` is
  true when 4b's staged taken copy exists at start.
- Produces: `MdnsResponder.announce(name: string): void` and `withdraw(name: string): void`.

- [ ] **Step 1: tests first** (`main-silence-watch.test.ts`, fake timers from
  `Date.UTC(2026, 10, 15, 21, 0)`, a scripted `ask`):
  - `"silent 20 seconds after the first unreachable ask, not before"`.
  - `"any other result ends the silence at once"`: `refused`, `not_established`, `certificate` and
    `answered`, each after 25 s of silence.
  - `"a box never reached is never silent"`: only `not_established`; `reached` stays false.
  - `"silentFromFirst counts the first unreachable ask as silent"`.
  - `"a throwing ask counts as not silent and is logged"`.
  - `"stop() waits for the ask in flight and asks no more"`.
  - `"onChange fires when silent flips, and only then"`.
  - `mdns.test.ts`: `announce` sends the name's answers with its lifetime; `withdraw` sends them with
    a lifetime of 0; neither sends anything in development mode.
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/main-silence-watch.test.ts src/mdns.test.ts`.
  Expect FAIL.
- [ ] **Step 3:** implement: one timer, one ask in flight at a time.
- [ ] **Step 4:** wire it in `boot.ts`, tests first in `apps/server/src/boot.mirror.test.ts` (its
  names cases are at `:830-848`), with the ask seam answering as a reached-then-dead main box:
  - `"a mirror answers and announces the venue's name once its main box is silent"`.
  - `"and withdraws it when the main box answers"`.
  - `"a box still joining never runs the watch"`.
  Control, recorded in the commit message: make `silent` always false; the first case fails on the
  names.
- [ ] **Step 5:** run those files and `src/handover-stepdown.test.ts`. Expect PASS.
- [ ] **Step 6:** commit with `git commit -s`: "A947 4d: a spare watches its main server and takes
  the venue's name while it is silent".

### Task 2: a label opened on the selling box goes to Servers

**Files:**
- Modify: `apps/server/src/handover-page-mount.ts` (D8), and its existing test (find it with
  `grep -rln mountHandoverPage apps/server/src`)

- [ ] **Step 1:** tests first: `"on a box that sells, /handover/emergency goes to Servers"` (302 to
  `/manage/servers`); `"on a waiting or fenced box it stays 404"`. FAIL, implement, PASS.
- [ ] **Step 2:** commit: "A947 4d: a switch label opened on the selling server goes to Servers".

### Task 3: the venue's name leads to the switch page, and the page tries the main server

**Files:**
- Modify: `apps/server/src/spare-read-gate.ts` (D4: `spareReadGate(deps: { silent: () => boolean; mainUrl: () => Promise<string | null> })`)
  and `apps/server/src/spare-read-gate.test.ts`
- Create: the `GET /api/node/main` route, mounted on a mirror boot only (put it beside `mountNodeApi`,
  `apps/server/src/node-api.ts`), let through by `spareReadGate`
- Modify: `apps/server/src/boot.mirror-surface.test.ts` (its list of what a mirror serves gains
  `GET /api/node/main`; record it under "Changed test checks")
- Modify: `apps/setup/src/screens/handover-screen.ts` (D5's check, its message and "Check again") and
  the strings file its other emergency words live in
- Test: `apps/setup/src/screens/handover-screen.emergency.test.ts`

- [ ] **Step 1: tests first.**
  - `spare-read-gate.test.ts`:
    - `"at the venue's name a silent main server's spare sends pages to the switch page"`: `/`,
      `/manage`, `/manage/servers` → 302 `/handover/emergency`.
    - `"at the venue's name, with the main server answering, pages go to the main server"`: 302 to
      `https://box-aaaa.waitron.local/` (the stubbed `mainUrl`).
    - `"at the box's own name the closed page is served as before"`, silent or not.
    - `"certificate, trust, help and legal pages stay open at the venue's name"`.
    - `"other reads keep node.spare"`.
  - the route: `{ mainUrl }` is the held chart's `serving-primary` `contactUrl`, `null` with none.
  - `handover-screen.emergency.test.ts`, `fetch` stubbed per URL:
    - `"when the main server answers, the page refuses and links to it"`; the first step's button is
      not shown.
    - `"Check again after the main server stops answering lets the switch go on"`.
    - `"a main server that does not answer within 3 seconds lets the switch go on"` (fake timers).
    - `"no mainUrl lets the switch go on"`.
- [ ] **Step 2:** run the files. Expect FAIL.
- [ ] **Step 3:** implement. The page's fetch is
  `fetch(new URL("/api/node", mainUrl), { mode: "no-cors", signal: AbortSignal.timeout(3000) })`.
- [ ] **Step 4:** run them again, plus `src/boot.mirror-surface.test.ts`,
  `src/boot.management-origin.test.ts` and `pnpm --filter @waitron/setup exec tsc --noEmit -p .`.
  Expect PASS and exit 0.
- [ ] **Step 5:** open the page and LOOK: the refusal and the normal first step, light and dark, 1280
  and 390 wide, English and Spanish. Screenshots go to `~/waitron-campaign/a947-4d-shots/`, never
  committed.
- [ ] **Step 6:** commit: "A947 4d: the venue's name leads to a silent main server's switch page,
  which checks the main server itself".

### Task 4: the spare's own page says how the main server is

**Files:**
- Modify: `apps/server/src/spare-read-gate.ts` (`renderSparePage(locale, main: { silentSinceMs: number | null; reached: boolean })`)
  and `apps/server/src/i18n/spare.ts`
- Modify: `apps/server/src/guide/en/servers.md`, `apps/server/src/guide/es/servers.md` (the
  emergency section: a reloaded till, phone or dashboard at the usual address lands on the switch page
  once the main server has been silent for about half a minute; the spare's own page says so; print a
  label for each server from Servers, Task 5)
- Test: `apps/server/src/spare-read-gate.test.ts`

- [ ] **Step 1: tests first:** silent → the duration line and a link to `/handover/emergency`;
  not reached → the "cannot reach" line; reached and answering → neither line; the words are escaped
  as the page's other words are.
- [ ] **Step 2:** FAIL, implement, PASS. Then run
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts scripts/english-only.test.ts`.
- [ ] **Step 3:** LOOK: the page is a string, so write each of the three renderings to a file and open
  it in the workspace's Playwright Chromium, light and dark, 1280 and 390, English and Spanish
  (CLAUDE.md §4).
- [ ] **Step 4:** commit: "A947 4d: the spare's page says when the main server is silent or out of
  reach".

### Close of 4d-1

- `docs/backlog/replication-cloud.md`, the A947 entry: 4d-1 built; 4d-2, 4d-3 and the measurements
  left.
- The design's §11 4d line: a dated pointer to this plan naming departures 1–6.

## PR 4d-2: the switch labels

### Task 5: "Print switch label" on Servers

**Files:**
- Create: `apps/dashboard/src/widgets/switch-label.ts` (`dashboard-switch-label`: the QR from the
  `qrcode` package the equipment label uses, the box's name, the address, departure 2's words, and
  Print through `printEquipmentLabel`), `switch-label.test.ts`, `switch-label.a11y.test.ts`
- Modify: `apps/dashboard/src/widgets/equipment-label.ts` only if `printEquipmentLabel` needs a third
  line of text; its two callers' output stays the same
- Modify: `apps/dashboard/src/screens/servers-screen.ts` (the row action, for every box the chart
  lists whose `contactUrl` is a name under the venue's name), its strings and test
- Modify: the spare's join-complete words in `apps/setup` (find them with
  `grep -rn "joined" apps/setup/src/i18n`): "Print a switch label for each server from Servers on the
  dashboard."
- Modify: `apps/server/src/guide/en/servers.md`, `apps/server/src/guide/es/servers.md`

- [ ] **Step 1: tests first:** the label's image equals `toDataURL` of
  `https://box-abcd.waitron.local/handover/emergency` (the package cannot decode an image, so compare
  what it makes); the row action shows for both boxes and opens the label; Print calls the injected
  `printFrame`; axe in both themes; the equipment label's tests pass unedited.
- [ ] **Step 2:** FAIL, implement, PASS. LOOK at the dialog and a printed page (print to PDF from
  Playwright's Chromium), both themes.
- [ ] **Step 3:** commit: "A947 4d: Servers prints a switch label for each server".

## PR 4d-3: passkeys at the switch (full review ceremony)

### Task 6: passkeys are accepted at the venue's name and at both boxes' own names

**Files:**
- Modify: `packages/identity/src/passkey.ts` (`origin: string | readonly string[]` in the three verify
  inputs at `:210`, `:309`, `:412`; `@simplewebauthn/server` 14.0.3 takes
  `expectedOrigin: string | string[]`, design §6.6)
- Modify: the callers that pass `config.managementOrigin` (`boot.ts:2513-2514`, `:2536-2537`,
  `:3177-3178`; find every `rpId: config.managementRpId`): pass a function read per request that
  gives the management origin plus, when it is `https://waitron.local`, every box's own origin in the
  held chart (`ownContactUrl`). Per request, so a spare that joins after a start counts at once.
- Test: `packages/identity/src/passkey.test.ts` (each of two listed origins is accepted; an unlisted
  third is refused); one server case where an assertion made at `https://box-abcd.waitron.local` signs
  in to the dashboard, with the control that it is refused when the chart does not list that box

- [ ] **Step 1:** tests first; FAIL; implement; PASS. The pinned-algorithm cases in
  `passkey.test.ts` pass unedited (CLAUDE.md §4).
- [ ] **Step 2:** commit: "A947 4d: passkeys are accepted at the venue's name and each server's own
  name".

### Task 7a: the switch's passkey and proof, on the server

**Files:**
- Modify: `packages/identity/src/passkey.ts` (`verifyPasskeyAssertion`, D9: reads the credential and
  person, verifies against a given challenge and origin list, writes nothing) and its test
- Create: `apps/server/src/handover-switch-proof.ts` (make and check the signed proof; the cookie) and
  its test
- Modify: `apps/server/src/handover-emergency-api.ts` (the challenge route, kept in memory; the take,
  preview, backup and declaration accept a passkey assertion or the proof cookie in place of email
  and password), `apps/server/src/handover-preparation.ts` (`signInCredentials` accepts the proof for
  an emergency operation only), and the activation route (accepts it the same way)
- Modify: `apps/server/src/peer-route-limits.ts` and its inventory test for the new route (#3219 added
  the same row for its take route)
- Test: beside 4b's take cases in `apps/server/src/handover-emergency-*.test.ts`

- [ ] **Step 1: tests first:**
  - a passkey take signs in against the staged copy's passkey rows (a person enrolled after joining
    can switch, as 4b's password case shows);
  - `webauthn_challenges` holds no new row after a challenge and a take (read the table);
  - a request that passes with a passkey sets the cookie with each listed attribute, and the answer's
    body does not carry the proof;
  - the proof is accepted by preview, declaration, preparation and activation; refused after 15
    minutes, on a box no longer in mode `mirror`, when signed by the other box, on a controlled
    handover's routes, and for a person who lost `node.manage` in the copy;
  - a challenge older than two minutes is refused.
  Control, recorded in the commit message: drop the expiry check; the 15-minute case fails.
- [ ] **Step 2:** FAIL; implement; PASS. Run `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`
  (unedited).
- [ ] **Step 3:** commit: "A947 4d: the switch accepts a passkey and carries a 15-minute signed
  proof".

### Task 7b: the switch's passkey, on the page

**Files:**
- Modify: `apps/setup/src/screens/handover-screen.ts` ("Use my passkey" beside "Use my password"; a
  refused or expired proof offers the passkey again) and its strings
- Test: `apps/setup/src/screens/handover-screen.emergency.test.ts` (browser passkey tests stub
  `navigator.credentials` and keep the WebAuthn library real, CLAUDE.md §4)

- [ ] **Step 1:** tests first: both choices show; a passkey sign-in goes through take to activation
  with one unlock per step that the server asks it for; a reload after the take carries on without a
  new unlock while the cookie holds; the page never writes the proof to a URL or to storage.
- [ ] **Step 2:** FAIL; implement; PASS. LOOK at the sign-in step with both choices, both themes,
  1280 and 390.
- [ ] **Step 3:** commit: "A947 4d: the switch page offers a passkey".

## Task 8: the measurements (no pull request of code)

The results go in `docs/research/2026-11-xx-a947-4d-measurements.md`, committed docs-only, and the
design's §13 lines get a dated pointer to it.

**The lane runs, in Playwright's Chromium on the Mac** (with `--host-resolver-rules` mapping both
names to a local server holding a leaf under a throwaway authority the browser trusts). Before each
run, write down what the failing case would print:
- the same-site cookie (§6.3 step 4, 4c's (3)): a device cookie set by `https://waitron.local` with
  the domain `cookieDomainFor` gives (`device-session.ts:35`) is sent to
  `https://box-abcd.waitron.local` and back after a redirect. Control: a cookie set with no domain is
  not sent.
- a passkey made at `https://waitron.local` signs in at `https://box-abcd.waitron.local` against Task
  6's list, and is refused with the box's name left out.

**The owner runs, on the venue's tills and phones** (no implementer; like 3b's Task 6.11), for each
till platform the venue uses, an iPhone and an Android phone:
1. Does `https://box-<id>.waitron.local` open? (two-part `.local` names)
2. With a till open at `https://waitron.local`, pull the main box's power. How long until the till's
   reloaded page shows the switch page? Then plug it back in: how long until a reload reaches the main
   box again? (the name cache, the announcement and the withdrawal)
3. During a switch from a page opened at `https://waitron.local`: does the page keep working across
   the take's restart?
4. A passkey at each way in: at the venue's name, at the label's address, and the phone's own passkey
   from the label.
5. A phone that has not installed the venue's certificate opens the label: does the page open, and
   does a passkey work? (a browser refuses a passkey on a page with a certificate warning; the answer
   decides whether the guide asks managers to install the certificate on their phone, at
   `/setup/trust`.)

The lane writes the owner's steps as a checklist in the research note and adds a
`## WATCHER-NEEDED:` line asking the watcher to put it to the owner.

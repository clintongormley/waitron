# A947 slice 4d — reaching the switch from any device: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** revision 1, 2026-11-15 (lane A). Queued by the campaign watcher on 2026-11-15 at 00:36
(`~/waitron-campaign/queue.md`, "A947-4d-plan"): plan only, no build until 4c has landed. The
design it implements: the owner approved its second revision on 2026-10-22 at about 02:40 (the
design's header). The owner has NOT approved this plan.

**Goal:** when the main server dies, any device at the venue reaches the spare's switch page, even
one that has reloaded its page or was never open: a till or phone that opens the venue's usual
address lands on the switch page; a phone that scans the spare's label opens it at the spare's own
address; the spare's own Box status page says the main server is silent and links to it; and a
manager can prove who they are there with a passkey as well as with a password.

**Architecture:** the spare already serves its switch page at its own name
(`https://box-<id>.waitron.local/handover/emergency`, A1018 Slice 6 and A947 4b) and already has a
leaf certificate naming the venue's name as well as its own (`leafHostnamesFor`,
`apps/server/src/box-name.ts:22-27`). 4d adds one watch to the spare: every 5 seconds it asks the
main box, by the same signed query the switch uses to refuse (`askPeerStatus`,
`apps/server/src/boot-peer-check.ts:448-505`). After 20 seconds in which every answer was
"unreachable", the spare's name responder adds the venue's name, and a request that reaches the
spare at the venue's name gets only the switch page. The first answer of any other kind removes the
venue's name again. The same watch feeds a banner on the spare's Box status page. The labels are
printed from Servers. Passkeys are checked against the venue's name and both boxes' own names, and
the switch takes a passkey once, at the take, and carries that proof across the take's restart.

**Tech stack:** TypeScript, Hono (`apps/server`), Lit (`apps/dashboard`, `apps/setup`), node.db
(`packages/node-db`), Vitest (Node and browser mode), Playwright's Chromium for one measurement.

**Spec:** [`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md`](../specs/2026-10-21-a947-two-box-failover-design.md):
§11's 4d line, §6.6 (all of it), §6.5 "Every wait explains itself" (the switch rows), §6.1's last
sentence (the spare's banner), §6.2's last paragraph (both sides try the main box before the
switch), §6.3 step 4 (the same-site cookie), §13's measurement lines, and the A1018 block at the
top. Read with the 4b plan ([`2026-11-14-a947-4b-promote-from-followed-copy.md`](2026-11-14-a947-4b-promote-from-followed-copy.md)),
#3219's body, and the 4c plan ([`2026-11-14-a947-4c-devices-follow.md`](2026-11-14-a947-4c-devices-follow.md)),
whose departures 1–3 and question Q1 the watcher moved here on 2026-11-14 at 22:01.

**Not fiscal.** No task changes a record, chain, series, filing, promotion or activation step. The
golden huella test and `inmutabilidad` are not touched. Lane A lands each pull request once green.
4d-3 adds a `node.db` table, so H1's migration rule applies to it.

## What the design's 4d line asks, and where each part stands

Read on `main` at 4ffb0fe9bb, plus #3219's branch (4b) and the 4c plan.

| §11 4d asks | Today | 4d does |
| --- | --- | --- |
| The spare's switch page | Built: `/handover/emergency` on a box whose `node.db` mode is `mirror` (`apps/server/src/handover-page-mount.ts:24-25`); the take, catch-up and held-copy button are 4b's | Nothing new on the page itself, except the browser's own check of the main box (Task 3) |
| The spare answers the venue's name with only that page while the main box is silent, and stops when it answers | A mirror answers only its own name (`boot.ts:4481-4483`: the venue's name only while accepting sales). Nothing on the spare watches the main box between switches; it reads the stream the main box writes to the spare's own store | PR 4d-1, Tasks 1–3 |
| The QR labels | Nothing. Equipment labels for printers and readers exist (`apps/dashboard/src/widgets/equipment-label.ts`, `printEquipmentLabel` at `:39`), but their QR is an equipment code, not an address | PR 4d-2, Task 5 |
| The switch page's explained waits, with the "no second clock" text on the spare's own screen | Built: the wait already says "This screen is on the box itself, so it does not count" when the page runs on the box (`packages/fiscal-verifactu/src/setup/clock-wait.ts:64,100,442`); 4c Task 2 sets the switch's what-to-do words | A test that the page served at the venue's name shows the same wait (Task 3) |
| Passkeys checked against the venue's and both boxes' own names | Every passkey check passes one origin, the configured `WAITRON_MANAGEMENT_ORIGIN` (`apps/server/src/config.ts:456-458`; `packages/identity/src/passkey.ts:210,309,412`) | PR 4d-3, Task 6 |
| The switch's passkey (4c's Q1, moved here) | The switch takes email, password and code on each of its requests (`handoverSignInAttempt`, `apps/server/src/handover-preparation.ts:94-121`) | PR 4d-3, Task 7, if Q1 is answered yes |
| Measured on the till hardware: two-part `.local` names, the name cache after the main box dies, a passkey at each way in | Not measured. The design's one run is macOS 26.6 for the name and Playwright's Chromium 156 for the passkey (§6.6) | Task 8: what the lane can run in Chromium, then the owner's own run on the tills |
| 4c departure 1: no dashboard entry | — | A reloaded dashboard at the venue's name lands on the switch page (Task 2) |
| 4c departure 2: the spare's banner | — | Task 4 |
| 4c departure 3: the same-site cookie receipt from #257 | — | Task 8 |

## Decisions

- **D1 — "silent" means what the switch already calls silent.** The watch uses `askPeerStatus`, and
  counts an ask as silent only when its reason is `unreachable`. That is the one reason the switch's
  own check lets a switch go on (`sourceSilent`, `apps/server/src/handover-emergency-api.ts:187-215`:
  `answer === null && reason === "unreachable"`). So the spare answers the venue's name only in the
  state in which its switch would not refuse with `handover.source_still_answering` or
  `handover.source_not_established`. A main box that answers slowly, refuses, or answers something
  unsigned is not silent, and the spare stays off the venue's name. The cost: a main box that drops
  packets without refusing them (no `ECONNREFUSED`, a timeout instead) never makes the spare take the
  venue's name. #3219's notes already record that the switch itself refuses that case with
  `handover.source_not_established`, so the page would refuse it anyway.
- **D2 — the spare asks every 5 seconds, and goes silent after 20.** 5 seconds is the till router's
  probe interval (4c plan, "Architecture"); 20 seconds is §6.1's strip delay, a starting value (§13).
  Constants `MAIN_ASK_INTERVAL_MS = 5_000` and `MAIN_SILENT_MS = 20_000` in the new watch module.
  Silence starts at the first `unreachable` ask after an answer or after the watch starts, and ends at
  the first ask with any other result. The watch runs only on a box whose mode is `mirror` and whose
  held chart names a `serving-primary` other than itself. A box still joining (the adoption latch,
  `boot.ts:1974-2066`) does not run it.
- **D3 — at the venue's name, the spare serves only the switch page.** A request whose `Host` is the
  venue's name (`BOX_HOSTNAME`, without a port) reaching a box in mode `mirror`:
  - `GET` or `HEAD` of `/handover/*`, and the routes the switch page calls (`/api/node/*`,
    `/api/box/status`, `/health`): served as at the spare's own name;
  - any other navigation (`GET` with `Accept` naming `text/html`): `302` to `/handover/emergency`.
    This is how a reloaded till (`/`), a reloaded dashboard (`/manage/...`, 4c departure 1) and a
    browser kiosk pointed at the venue's name all land on the switch page;
  - anything else: `503` with `{ error: { code: "handover.spare_switch_only" } }`, a new code whose
    words say this server is the spare and only its switch page answers here.
  The gate runs only while the watch says silent; otherwise a mirror is not answering the venue's
  name anyway, and a request arriving with that `Host` (a stale cache) gets the same gate, which is
  harmless. A box accepting sales is never gated.
- **D4 — both sides try the main box before the switch, also on a page opened at the venue's name.**
  §6.2: "Before the dialog opens, the spare and the till both try the main box". 4c's till does its
  side before it opens the page. A page reached by way 1 or way 2 was opened by no till, so the page
  does it: on load, the switch page reads the main box's own address from the spare (Task 3 adds it
  to the page's existing status read) and fetches `<main>/api/node` with `mode: "no-cors"` and a
  3-second limit. A fetch that resolves is an answer (the same rule as 4c's `probeMain`); then the page
  shows "The main server is still answering" and a link to the main server's own address, and does
  not offer the switch until a check made by pressing "Check again" finds it silent. A fetch that
  rejects or times out lets the page go on; the spare's own check (D1) still runs at each step. This
  covers the one case D1 cannot see: a main box the spare cannot reach but the device can.
- **D5 — labels are printed from Servers, not at joining.** §6.6 way 2 says "printed at joining". The
  spare's join finishes on the spare's setup page, which knows no printer, and the main box's
  Servers screen already lists both boxes with a row menu (`servers-screen.ts:521-529`). So each row
  gets "Print switch label", which prints through the browser, the way equipment labels print
  (`printEquipmentLabel`). Printing on a receipt printer is left out: the equipment label route
  (`print-api.ts:1506-1540`) prints an equipment code, and a label is printed twice in a box's life.
  The join's last screen and the Servers guide say to print one for each box.
- **D6 — the label carries the box's own name, not its address.** The QR encodes
  `<the box's contactUrl>/handover/emergency`, and the text beneath repeats it. An IP address would
  survive a phone that cannot resolve `.local`, but it changes with the router's leases, and a passkey
  never works at an address (§6.6, trap (a)). `box-reach.ts:13-15` records that `.local` is
  unreliable on iOS for the trust page's QR; Task 8 measures it for this label, and the guide says the
  venue's own Wi-Fi is required.
- **D7 — a label opened on the box that sells goes to its till.** Both boxes carry a label, so the
  main box's label is scanned while it sells. Today `/handover/emergency` answers `404` on any box
  not in mode `mirror` (`handover-page-mount.ts:24-25`). 4d makes that one path redirect to `/` on a
  box accepting sales; the `404` stays for every other mode (a box waiting, fenced or restricted).
- **D8 — the switch's passkey is checked once, at the take, and carried as a short proof.** (Only if
  Q1 is answered yes.) The switch page sends the person's sign-in with each of its requests: take,
  preview, declaration, preparation and activation (4c plan, Q1; `handover-screen.ts:182`). A passkey
  cannot be asked five times without five unlocks, and the take restarts the spare (4b's D3), so a
  proof held in memory dies before the next request. So a take signed in with a passkey returns a
  switch proof: 32 random bytes, valid 15 minutes, of which `node.db` keeps only the SHA-256 (CLAUDE.md
  §3, "Store anything that works as a live login as a hash"), with the person's id and this box's
  `node_id`. The later emergency requests accept `{ proof }` in place of email and password. Each use
  checks again, against the venue database the request reads, that the person is active and holds
  `node.manage`. Activation deletes the proof; an expired one is refused and deleted. The passkey's
  challenge is kept in the spare's memory, never in `webauthn_challenges`
  (`packages/identity/src/passkey.ts:182`), because that table streams with the database the
  follower is writing (design §6.3 step 1). The controlled handover keeps its password sign-in; only
  the emergency switch takes a passkey.

## Departures from the approved design

1. §6.6 way 2, "printed at joining": printed from Servers (D5).
2. §6.6 way 2's label words «Si el equipo principal falla, escanea esto desde cualquier caja o móvil
   del local» and the path `/cambiar`: the till's word is "server" (owner, 2026-11-07, #2542), and the
   page's path is the A1018 page's, `/handover/emergency`. The label reads «Si el servidor principal
   falla, escanea esto con cualquier caja o móvil conectado a la red del local» / "If the main server
   fails, scan this with any till or phone on the venue's network".
3. §6.6 way 3, the spare's own screen: 4d builds nothing for it beyond D3. A browser on the box that
   opens the venue's name lands on the switch page and sees the existing on-box wait. B3 decides
   whether a box has a screen.
4. §6.2's passkey for the controlled handover (§6.4 → A1018): not built; the controlled handover
   keeps the password (D8).
5. §6.6 way 1's "120 seconds in a device's cache … shortens the lifetime if needed": 4d measures
   (Task 8) and does not change `MDNS_TTL_SECONDS` in this slice. A change, if the measurement asks
   for one, is its own small pull request with the measurement as its receipt.

## Questions

- **Q1 — build the switch's passkey (PR 4d-3, Task 7)?** The owner's answer to the design's question
  2 was "passkey or password (+authenticator code if configured)", and §6.6's table makes the
  manager's own phone, scanning the label, "the quickest path in practice". The cost is a `node.db`
  table for the proof, an in-memory challenge, and the proof's checks on four routes: about 650 lines
  with Task 6. Until it lands the switch takes the password and, when one is enrolled, the code,
  which works with no internet (§6.6's table). Recommended: yes, as its own pull request after 4d-1
  and 4d-2, so the owner can stop it without holding the rest.
- **Q2 — the 503 at the venue's name (D3) for non-page requests?** An alternative is to let a
  mirror's normal answers through (a mirror refuses selling routes already). Recommended: the 503,
  because a till that reloaded and lost its router state would otherwise show its own error screens
  rather than the switch page's explanation.

## Global constraints

- Wording (English in code, Spanish in the translation files):
  - Box status banner on the spare: "The main server has not answered for {duration}." / «El
    servidor principal no responde desde hace {duration}.», with the link "Open the switch page" /
    «Abrir la página de cambio».
  - D4's page check: "The main server is still answering. Open it at its own address, or hand over
    from Servers there." / «El servidor principal todavía responde. Ábrelo en su propia dirección o
    haz el traspaso desde Servidores allí.», then the main server's address as a link, and "Check
    again" / «Comprobar otra vez».
  - `handover.spare_switch_only`: "This is the spare server. Only its switch page answers at this
    address while the main server is silent." / «Este es el servidor de reserva. Mientras el principal
    no responde, aquí solo se abre su página de cambio.»
  - the label: departure 2's words, the address beneath the QR, and the box's name above it.
  - Servers row action: "Print switch label" / «Imprimir etiqueta de cambio».
- CLAUDE.md §3: "A refusal explains what happened and what each choice does"; every colour reads a
  `--wt-*` token; a screen change updates its guide in English and Spanish; a new error code is named
  for the domain (`handover.*`) and listed where `scripts/alert-codes.test.ts` and
  `scripts/errors-reachable.test.ts` look.
- Sizes: 4d-1 about 700 changed lines of code and tests (stop and report at 1,000); 4d-2 about 300
  (stop at 450); 4d-3 about 650 (stop at 950), generated migration files counted apart.

## Review focus

1. **Two answers for the venue's name.** If the spare's watch is wrong (D1 fails), both boxes answer
   `waitron.local` and a reloading till may land on the switch page while the main box sells. The
   page's own check (D4) then refuses, and the switch still needs the person's "switched off"
   statement. Test (Task 1): a non-`unreachable` answer during silence removes the venue's name at
   once, not after 20 seconds.
2. **The take's restart.** The take restarts the spare (4b's D3). The watch starts again with no
   silence, so for 20 seconds the spare does not answer the venue's name. A page opened at the venue's
   name keeps working only while the device still holds the spare's address (its name cache, up to
   `MDNS_TTL_SECONDS` = 120, `box-lookup.ts:13`). Task 8 measures it on a till; until then the page's
   requests after the take are expected to keep working, which is the claim to check.
3. **A spare that has stopped following for a take.** The watch keeps running; the take itself asks
   the main box again before stopping (#3219, fix 6).
4. **Nothing reaches the venue's name on a box that sells, waits, or is fenced.** Task 2's gate
   checks `readNodeMode` on each request, not a value read at start.
5. **The proof (4d-3).** It is never logged, never in a URL, compared as a hash, refused after
   15 minutes and after activation, and worthless on another box (`node_id`).

---

## PR 4d-1: the spare answers the venue's name while the main server is silent

### Task 1: the spare's main-server watch

**Files:**
- Create: `apps/server/src/main-silence-watch.ts`, `apps/server/src/main-silence-watch.test.ts`
- Modify: `apps/server/src/boot.ts` (start the watch on a mirror's trading start, stop it on
  `undoOnFailure`; the mirror's `names` at `:4481-4483` add `BOX_HOSTNAME` while the watch is silent)
- Modify: `apps/server/src/background-duties.ts` or `apps/server/src/job-catalogue.ts`, whichever
  CLAUDE.md §5's restriction rule asks of a new background duty (read both; the guard is
  `apps/server/src/handover-stepdown.test.ts`, "every closer is either atStepdown or carries a reason")

**Interfaces:**
- Produces: `startMainSilenceWatch(deps: { ask: () => Promise<"answered" | SilentReason>; now: () => number; intervalMs?: number; silentAfterMs?: number; onChange?: () => void; log: Logger }): { silentSince(): number | null; isSilent(): boolean; stop(): Promise<void> }`.
  `ask` is built in `boot.ts` from `askPeerStatus` exactly as `sourceSilent` builds it
  (`handover-emergency-api.ts:191-205`), returning the `onSilent` reason or `"answered"`.
  `isSilent()` is `silentSince() !== null && now() - silentSince() >= silentAfterMs`.
- Produces, on `BoxStatusDeps.readSpare`'s view: `mainSilentSinceMs: number | null`, read from the
  watch (Task 4 draws it).

- [ ] **Step 1: tests first** (`main-silence-watch.test.ts`, fake timers from
  `Date.UTC(2026, 10, 15, 21, 0)`, a scripted `ask`):
  - `"silent after 20 seconds of unreachable answers, not before"`: at 19.999 s `isSilent()` is
    false, at 20 s true; `silentSince()` is the first unreachable ask's time.
  - `"any other result ends the silence at once"`: one of each of `refused`, `not_established`,
    `certificate`, `answered` after 25 s of silence makes `isSilent()` false at that ask.
  - `"a throwing ask counts as not silent and is logged"`.
  - `"stop() waits for the ask in flight and asks no more"`.
  - `"onChange fires when isSilent flips, and only then"`.
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/main-silence-watch.test.ts`.
  Expect FAIL (no module).
- [ ] **Step 3:** implement with one timer; one ask in flight at a time.
- [ ] **Step 4:** wire it in `boot.ts`. Add to the existing mirror cases in
  `apps/server/src/boot.mirror.test.ts` (it already asserts the mirror's names at `:830-833`):
  - `"a mirror answers the venue's name after its main box is unreachable for 20 seconds"`: drive
    `seams.boxLookup` or the ask seam so the main box is unreachable; the responder's names include
    `waitron.local` once the watch is silent.
  - `"and stops when the main box answers"`.
  - `"a box still joining never runs the watch"`.
  Control, recorded in the commit message: make `isSilent()` always false; the first case fails on
  the names.
- [ ] **Step 5:** run the two files and `apps/server/src/handover-stepdown.test.ts`. Expect PASS.
- [ ] **Step 6:** commit with `git commit -s`: "A947 4d: a spare watches its main server and answers
  the venue's name while it is silent".

### Task 2: at the venue's name, only the switch page

**Files:**
- Create: `apps/server/src/spare-venue-name-gate.ts`, `apps/server/src/spare-venue-name-gate.test.ts`
- Modify: `apps/server/src/boot.ts` (register the gate on a mirror's trading app, after the
  request-id middleware and after `requireManagementChangeFromOwnPage` (CLAUDE.md §3 forbids
  registering ahead of it), before every route)
- Modify: `apps/server/src/errors.ts` (`handover.spare_switch_only`, HTTP 503) and its English and
  Spanish words wherever the sibling `handover.source_still_answering` has them (grep the code)
- Modify: `apps/server/src/handover-page-mount.ts` (D7)

**Interfaces:**
- Produces: `spareVenueNameGate(deps: { node: NodeDatabase; nodeId: string; silent: () => boolean }): MiddlewareHandler`,
  D3's rules, judging `new URL(c.req.url).hostname === BOX_HOSTNAME`.

- [ ] **Step 1: tests first** (`spare-venue-name-gate.test.ts`, a Hono app with the gate and stub
  routes, a real `node.db` from the file's sibling tests' helper):
  - `"a navigation to / at the venue's name goes to the switch page"` (302, `Location:
    /handover/emergency`); the same for `/manage/servers` and `/tabs`.
  - `"the switch page, its assets and its API pass"`: `/handover/emergency`,
    `/handover/assets/x.js`, `POST /api/node/handover/emergency/preview`, `/api/box/status`,
    `/health`.
  - `"other requests at the venue's name get handover.spare_switch_only"`: `POST /api/tabs`, a
    `GET /api/menu` with `Accept: application/json`.
  - `"at the box's own name nothing changes"`: `box-abcd.waitron.local` passes every one of the
    above.
  - `"a box not in mode mirror is never gated"`: the same requests at the venue's name pass on a
    box whose mode is `primary`.
- [ ] **Step 2:** run the file. Expect FAIL.
- [ ] **Step 3:** implement and register it.
- [ ] **Step 4:** D7, tests first in the handover page mount's existing test file (find it with
  `grep -rln mountHandoverPage apps/server/src`): `"on a box that sells, /handover/emergency goes to
  the till"` (302 to `/`), and `"on a waiting or fenced box it stays 404"`. Expect FAIL, then
  implement, then PASS.
- [ ] **Step 5:** run `pnpm exec vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/boot.management-origin.test.ts`. Expect
  PASS.
- [ ] **Step 6:** commit: "A947 4d: at the venue's name a silent main server's spare serves only its
  switch page".

### Task 3: the switch page tries the main server too

**Files:**
- Modify: the spare's status read the emergency page already makes (read
  `apps/setup/src/screens/handover-screen.ts`'s emergency flow to find it; if it has none, the
  existing `/api/node/handover/status` answer) to include the chart's `serving-primary` contact
  address as `mainUrl`
- Modify: `apps/setup/src/screens/handover-screen.ts` (D4's check, its message and "Check again")
- Modify: `apps/setup/src/i18n` strings for the new words (find the file the screen's other
  emergency words live in)
- Test: `apps/setup/src/screens/handover-screen.emergency.test.ts`, and the server route's test for
  `mainUrl`

- [ ] **Step 1: tests first.**
  - Server: the status answer carries `mainUrl` equal to the held chart's `serving-primary`
    `contactUrl`, and `null` when the chart has none.
  - Page, with `fetch` stubbed per URL:
    - `"when the main server answers, the page refuses and links to it"`: the main's `/api/node`
      resolves; the page shows the refusal with a link whose `href` is `mainUrl`, and the first
      step's button is not shown.
    - `"Check again after the main server stops answering lets the switch go on"`.
    - `"a main server that does not answer within 3 seconds lets the switch go on"` (fake timers).
    - `"no mainUrl lets the switch go on"`.
    - `"at the venue's name the page shows the existing on-box wait"`: with the clock wait's
      on-box flag set by the stubbed preparation answer, the words "This screen is on the box
      itself" show with 4c's switch wording.
- [ ] **Step 2:** run the files. Expect FAIL.
- [ ] **Step 3:** implement. The fetch is `fetch(new URL("/api/node", mainUrl), { mode: "no-cors",
  signal: AbortSignal.timeout(3000) })`.
- [ ] **Step 4:** run the files again, plus `pnpm --filter @waitron/setup exec tsc --noEmit -p .`.
  Expect PASS and exit 0.
- [ ] **Step 5:** open the page and LOOK: the refusal and the normal first step, light and dark,
  1280 and 390 wide, English and Spanish. Screenshots go to `~/waitron-campaign/a947-4d-shots/` and
  are never committed.
- [ ] **Step 6:** commit: "A947 4d: the switch page checks the main server itself before it offers
  the switch".

### Task 4: the spare's Box status banner (4c departure 2)

**Files:**
- Modify: `apps/server/src/box-status.ts` (`mainSilentSinceMs` in the spare view)
- Modify: `apps/dashboard/src/screens/box-status-screen.ts` and `box-status-rows.ts` (the banner,
  through the existing notice or strip primitive the screen already uses for warnings; do not draw a
  new one)
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Modify: `apps/server/src/guide/en/servers.md`, `apps/server/src/guide/es/servers.md` (the
  emergency section: a reloaded till or phone at the venue's usual address now lands on the switch
  page; the spare's Box status says when the main server is silent; print a label for each box from
  Servers, Task 5)
- Test: `apps/server/src/box-status.test.ts`, `apps/dashboard/src/screens/box-status-screen.test.ts`,
  `box-status-screen.a11y.test.ts`

- [ ] **Step 1: tests first:** the status answer carries `mainSilentSinceMs` from the watch; the
  screen shows the banner with the duration and a link to `/handover/emergency` only while it is not
  `null` and the box is a spare; axe in both themes with the banner.
- [ ] **Step 2:** run; expect FAIL. Implement. Run again; expect PASS. Run
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts scripts/no-hardcoded-chrome-views.test.ts scripts/english-only.test.ts`.
- [ ] **Step 3:** LOOK at the banner, both themes, 1280 and 390, English and Spanish.
- [ ] **Step 4:** commit: "A947 4d: the spare's Box status says when the main server is silent".

### Close of 4d-1

- `docs/backlog/replication-cloud.md`, the A947 entry: 4d-1 built; 4d-2 to 4d-4 left.
- The design's §11 4d line: a dated pointer to this plan naming departures 1–5.

## PR 4d-2: the switch labels

### Task 5: "Print switch label" on Servers

**Files:**
- Create: `apps/dashboard/src/widgets/switch-label.ts` (`dashboard-switch-label`: the QR from the
  `qrcode` package the equipment label already uses, the box's name, the address, departure 2's words,
  and Print through `printEquipmentLabel`), `switch-label.test.ts`, `switch-label.a11y.test.ts`
- Modify: `apps/dashboard/src/widgets/equipment-label.ts` only if `printEquipmentLabel` needs a third
  line of text; keep its existing two callers' output byte for byte
- Modify: `apps/dashboard/src/screens/servers-screen.ts` (the row action, for every box the chart
  lists with a `contactUrl` at a name under the venue's name), its strings and test
- Modify: the spare's join-complete words in `apps/setup` (find them with
  `grep -rn "joined" apps/setup/src/i18n`): one sentence, "Print a switch label for each server from
  Servers on the dashboard."
- Modify: `apps/server/src/guide/en/servers.md`, `apps/server/src/guide/es/servers.md`

- [ ] **Step 1: tests first:** the QR decodes (decode the generated image with the same package's
  test helper, or compare `toDataURL` of the expected text) to
  `https://box-abcd.waitron.local/handover/emergency`; the row action shows for both boxes and opens
  the label; Print calls the injected `printFrame`; axe in both themes; the equipment label's
  existing tests pass unedited.
- [ ] **Step 2:** FAIL, implement, PASS. LOOK at the dialog and at a printed page (print to PDF from
  Playwright's Chromium), both themes.
- [ ] **Step 3:** commit: "A947 4d: Servers prints a switch label for each server".

## PR 4d-3: passkeys at the switch (only if Q1 is yes)

### Task 6: passkeys are accepted at the venue's name and at both boxes' own names

**Files:**
- Modify: `packages/identity/src/passkey.ts` (`origin: string | readonly string[]` in the three
  verify inputs at `:210`, `:309`, `:412`; `@simplewebauthn/server` takes
  `expectedOrigin: string | string[]`, design §6.6)
- Modify: `apps/server/src/boot.ts` and the callers at `:2513-2514`, `:2536-2537`, `:3177-3178`
  (find every `rpId: config.managementRpId` caller): pass the management origin plus, when it is
  `https://waitron.local`, every chart box's own origin from `ownContactUrl`
- Test: `packages/identity/src/passkey.test.ts` (a list of two origins accepts each; a third origin
  is refused), and one server case where an assertion made at `https://box-abcd.waitron.local` signs
  in, with the control that the same assertion is refused when that origin is not listed

- [ ] **Step 1:** tests first; FAIL; implement; PASS. Check the pinned-algorithm cases in
  `passkey.test.ts` still pass unedited (CLAUDE.md §4, "A default you did not state is not a value
  you tested").
- [ ] **Step 2:** commit: "A947 4d: passkeys are accepted at the venue's name and each server's own
  name".

### Task 7: the switch takes a passkey once and carries its proof

**Files:**
- Modify: `packages/node-db/src/schema/…` (a `node_switch_proofs` table: `node_id`, `person_id`,
  `proof_sha256`, `expires_at_ms`; classified `local`), then `migration-baseline rebuild --set node`
  (CLAUDE.md §3: rebuild the set's one starting migration, never a new migration)
- Modify: `apps/server/src/handover-emergency-api.ts` (a challenge route kept in memory for two
  minutes; the take accepts a passkey assertion; the later emergency routes accept `{ proof }`),
  `apps/server/src/handover-preparation.ts` (`signInCredentials` accepts a proof for an emergency
  operation only), the activation route (deletes the proof)
- Modify: `apps/setup/src/screens/handover-screen.ts` ("Use my passkey" beside the password, as §6.6
  asks; the page keeps the proof in memory only)
- Modify: `scripts/write-path-tables.json` and every list guard the new table trips (the 4b PR body's
  "Changed test checks" lists the same set for `node_take_failures`)
- Test: `apps/server/src/handover-emergency-*.test.ts` beside 4b's take cases,
  `apps/setup/src/screens/handover-screen.emergency.test.ts`

- [ ] **Step 1: tests first:**
  - a passkey take signs in against the staged copy's passkey rows (the person enrolled after joining
    can switch, as 4b's password case);
  - the challenge is never written to `webauthn_challenges` (read the table after the take);
  - the proof is stored only as its SHA-256 (read `node.db`), is accepted by preview, declaration,
    preparation and activation, is refused after 15 minutes and after activation, and is refused on a
    controlled handover's routes;
  - a person who lost `node.manage` in the copy is refused with their proof;
  - the page offers both ways and never puts the proof in a URL or storage.
  Control, recorded in the commit message: accept the proof without the expiry check; the 15-minute
  case fails.
- [ ] **Step 2:** FAIL; implement; PASS. Run the schema guards:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/starting-migrations.test.ts scripts/write-path-tables.test.ts`,
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`
  (unedited).
- [ ] **Step 3:** LOOK at the sign-in step with both choices, both themes, 1280 and 390.
- [ ] **Step 4:** commit: "A947 4d: the switch takes a passkey once and carries a 15-minute proof".

## Task 8: the measurements (4d-4; no pull request of code)

Two parts. The results go in a research note, `docs/research/2026-11-xx-a947-4d-measurements.md`,
committed docs-only, and the design's §13 lines get a dated pointer to it.

**The lane runs, in Playwright's Chromium on the Mac** (with `--host-resolver-rules` mapping both
names to a local server holding a leaf under a throwaway authority the browser trusts):
- the same-site cookie (§6.3 step 4, 4c departure 3): a device cookie set by `https://waitron.local`
  with the domain `cookieDomainFor` gives (`device-session.ts`) is sent to
  `https://box-abcd.waitron.local` and back after a redirect. State what the failing case would print
  before running it, and run the control (a cookie set with no domain is not sent).
- a passkey made at `https://waitron.local` signs in at `https://box-abcd.waitron.local` against
  Task 6's list, and is refused with the box's name left out of the list.

**The owner runs, on the venue's tills and phones** (no implementer; like 3b's Task 6.11): for each
till platform the venue uses (and an iPhone and an Android phone):
1. Does `https://box-<id>.waitron.local` open? (two-part `.local` names)
2. With a till open at `https://waitron.local`, pull the main box's power. How long until the till's
   reloaded page shows the switch page? (the name cache; the spare answers after 20 seconds)
3. A passkey at each way in: at the venue's name, at the label's address, and the phone's own passkey
   from the label.
4. The phone opening the label without the venue's certificate installed: does the page open, and
   does a passkey work? (a browser refuses a passkey on a page with a certificate warning; the
   answer decides whether the guide asks managers to install the certificate on their phone.)

The lane writes the owner's steps as a checklist in the research note, and a `## WATCHER-NEEDED:`
line asking the watcher to put it to the owner.

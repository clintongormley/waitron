# A947 slice 4c — a till offers the switch when the main server goes silent: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** revision 2, 2026-11-14 (lane A). Revision 2 takes a fresh-context Claude plan read
(`~/waitron-campaign/receipts/a947-4c-plan-review.md`: no Critical, 6 Important, 10 Minor; every
Important taken, the Minors as noted at their steps). Queued by the campaign watcher on 2026-11-14
at 21:27 (`~/waitron-campaign/questions.md`, "WATCHER 2026-11-14 21:27"): plan now, build on `main`
once #3219 (4b) has landed. The design it implements: the owner approved its second revision on
2026-10-22 at about 02:40 (the design's header). The owner has NOT approved this plan.

**Goal:** when the main server stops answering, a till or handheld shows a red strip, "The main
server is not answering", and while the spare answers, its "Switch to the spare server" button takes
the person to the spare's switch page, where the switch already built in A1018 Slices 6–8 and A947
4b runs, and back to the till when it is done.

**Architecture:** the till's server router already probes every box in the venue's chart every 5
seconds and moves to the box that accepts sales (`apps/till/src/api/server-router.ts`). 4c reads
two more things from those probes: how long the chart's main box, at its own address, has answered
nothing, and whether the spare answers. The till draws the strip after 20 seconds of silence. The
button checks the main box once more and then opens the spare's own page at `/handover/emergency`.
That page is "the dialog of §6.2" (design §6.6): it already asks for the switch-off statements,
compares clocks, signs the person in, brings the spare's copy up to date (4b) and explains its
waits. 4c does not build a second dialog.

**Tech stack:** TypeScript, Lit (`apps/till`, `apps/setup`, `packages/fiscal-verifactu` setup
screens), Vitest browser mode.

**Spec:** [`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md`](../specs/2026-10-21-a947-two-box-failover-design.md):
§11's 4c line, §6.1, §6.2, §6.3 step 4, §6.5 "Every wait explains itself" (the switch row), §6.6,
§6.7, and the A1018 block at the top. Read with the 4b plan
([`2026-11-14-a947-4b-promote-from-followed-copy.md`](2026-11-14-a947-4b-promote-from-followed-copy.md))
and #3219's body.

**Not fiscal.** It changes no record, chain, series, filing or promotion step. The golden huella test
and `inmutabilidad` are not touched. Lane A lands it once green, after #3219.

## What the design's 4c line asks, and where each part stands

Read on `main` at f44d6694c4, plus #3219's branch.

| §11 4c asks | Today | 4c does |
| --- | --- | --- |
| The strip (§6.1): red, after 20 s without the main box, «El equipo principal no responde», and the switch button for a manager | The till shows only a muted line, "Local server unreachable — waiting for the standby to be promoted" (`till-app.ts:22443-22449`, `till-lock-screen.ts:438`), within about 3 s. A798's strip draws only notices the box sends (`widgets/notice-strip.ts`) | Task 1, in the till's own words (departure 5) |
| The dialog and its refusals: a till, or the spare, still reaching the main box | The spare's page and its routes refuse with `handover.source_still_answering` when the spare reaches the main box (`handover-emergency-api.ts:186-215`). No till check exists | Task 1: the till checks once more when the button is pressed. The spare's own refusal is unchanged |
| The switch's proof: a passkey, or a password plus a code when one is enrolled, on a till as on the dashboard (§6.2) | The spare's page takes email, password and code (`handover-screen.ts:575-610`); no switch route accepts a passkey | Password and code: nothing (the till opens the same page). Passkey: **not here**, question Q1 |
| The dialog's explained waits and countdown (§6.5) | The page shows the minute wait with a countdown, the no-second-clock wait with a 15-second recheck, and the clock disagreement with its "which time is correct" choices (`clock-wait.ts:447-486`). Its promote-mode no-second-clock wording is not the design's switch row (`recovery-hour.ts:426-436`) | Task 2, the no-second-clock row only (departure 6) |
| `node.promote` at the till | A1002 renamed it to `node.manage` (`packages/identity/src/permissions.ts:29`); the spare's routes check `node.manage` | Task 1 hides the button from signed-in staff without `node.manage` (D2) |
| The venue name and certificate on the spare after promotion | Built: a box accepting sales answers `waitron.local` (`boot.ts:4475-4482`; `boot.mirror.test.ts:830-833`, whose control starts the same identity as primary); every start that is not fenced issues a leaf naming it under the box's `tls/ca.crt` (`box-secrets.ts:229-248`), which a joined spare received from the venue (`adopt.ts` → `installVenueAuthority`) | Task 1's way back to the till relies on it; Task 3 adds the one check that a till reaches the promoted spare at the venue's name |
| The router's switch; no "print a new sheet" prompt (§6.7) | Built: the router moves to the highest-term box accepting sales, signs the person out and drops drafts (`server-router.ts:172-177`, `till-app.ts:2531-2547`; `till-reroute-e2e.test.ts`). No such prompt exists anywhere | Nothing |
| The card-payment ownership rule A764 asks for | Built by A1018's Slice 4b (`docs/backlog/payments.md`, "Uncertain Stripe reader payments stay unknown": `payments.node_id`, `sweepOwners`, `readTakenOverFrom`) | Nothing |
| The #257 same-site cookie receipt (§6.3 step 4) | The device cookie is set for the venue's domain (`device-session.ts`, `cookieDomainFor`); `till-reroute-e2e.test.ts` has the cookie follow a reroute, in Node, not in a browser | **Not here**: a real browser on two `.local` names is 4d's till-hardware measurement (departure 3) |
| The decision 4b left: restart only the follower after a refused take? | 4b restarts the whole box and counts failed takes in `node_take_failures` | Decision D5: keep it |

## Decisions

- **D1 — the till opens the spare's page and does not draw its own dialog.** The spare's emergency
  routes accept only a page from the spare's own origin (`node-operation-https.ts:7-11`,
  `own-page.ts:10-17`). A dialog inside the till would need those checks widened to another origin,
  and would repeat the page's clock, wait and catch-up logic. Opening the page keeps one dialog, as
  §6.2 and §6.6 ask. The dashboard already does the same for a controlled handover
  (`servers-screen.ts:222`, `handover-open`). The page is opened in the same tab: a till runs as one
  full-screen page, and a second window is not available on every till. The person loses nothing
  the switch itself would not drop: the main box is not answering, so nothing unsaved can be saved,
  and the router's move after the switch drops unsaved drafts and signs everyone out anyway
  (`till-app.ts:2531-2547`).
- **D2 — who sees the button.** A person signed in on the till sees it only when their permissions
  include `node.manage`. With nobody signed in (the lock screen) everyone sees it: a till whose main
  box is dead cannot sign anyone in, so a manager could otherwise never reach it. This only decides
  what the till shows. The spare's page is what refuses: it requires a `node.manage` sign-in. A
  device-mode screen (a kitchen display) shows the strip without the button.
- **D3 — "the main box" is the chart's `serving-primary` entry at its own address; "the spare" is the
  first `serving-secondary` entry.** The router's list comes from `routableServers`, whose entries
  carry each box's own `contactUrl` (`box-<id>.waitron.local`, `box-name.ts:12-13`, `ownContactUrl`)
  and standing. The router's `current`, which starts as the page's origin (`main.ts:42`), is not
  used for this: from 4d the spare answers `waitron.local` while the main box is silent (§6.6), so
  the origin would stop telling the two apart. After a switch the till boots again against the new
  chart (`#onServerChanged` → `#boot`), whose `serving-primary` is the promoted spare, so the strip
  clears.
- **D4 — no strip on the dashboard.** A dashboard is served by the main box and dies with it. A
  dashboard that reloads reaches the switch the way §6.6 gives every reloaded device, which is 4d's.
  This is departure 1.
- **D5 — a refused take still restarts the whole box (the watcher's question from #3219).** The cost
  is real: while the main box is dead the venue sells nothing, and a mistyped password restarts the
  spare, which must rebuild its followed copy before a corrected retry can take it. An in-process
  restart would not remove that wait. A new `startSpareFollow` starts with no binding, so its first
  pass deletes the follow folder and restores the copy again (4b `spare-follow.ts:158-162`). It
  saves only the process's start time. Removing the rebuild means resuming the stopped follower at
  its own position (measured in 155 ms on a fixture, 4b `docs/research/2026-11-14-a947-follow-mode.md:135`),
  which changes 3c's follower and its binding check. 4c leaves the take route and the follower
  alone, and `node_take_failures` stays. Rebuilding is the cost of a mistyped password. 4c's guide
  text says so in one sentence: type the password carefully, because a wrong one restarts the spare.

## Departures from the approved design

1. §6.2 "the same on a till, a handheld or the dashboard": no dashboard entry point in 4c (D4).
2. §6.1 "The spare box also shows a banner on its own status page": moved to 4d. The banner needs the
   spare to know that the main box has been silent for 20 seconds. 4d builds that same detection to
   decide when the spare answers the venue's name (§6.6, way 1).
3. §6.3 step 4's same-site cookie receipt: moved to 4d's measurements on till hardware. It needs a
   real browser resolving two `.local` names, which 4d measures for the same reason.
4. §6.2's passkey: Q1.
5. §6.1's wording «El equipo principal no responde» / «Cambiar al equipo de reserva»: the till says
   "server" (owner, 2026-11-07, #2542; memory "till says server and log in"), and on the till
   «equipo» already names the device's own hardware (`apps/till/src/i18n/strings.ts:3009-3010`). The
   strip reads «El servidor principal no responde» and the button «Cambiar al servidor de reserva».
6. §6.5's switch row, "clocks differ: what to do" («… pide ayuda»): not added. The page already
   answers a disagreement with its "which time is correct" choices (`clock-wait.ts:447-486`, owner
   2026-11-12 on setting the clock from the handover page), and a sentence sending the person to
   somebody else breaks CLAUDE.md §3 and `clock-wait.browser.test.ts:592-595`.

## Questions

- **Q1 — the switch's passkey moves to 4d?** The 4b plan's Q1 moved the in-memory passkey challenge
  here. Three facts point to 4d instead:
  - Passkeys are checked against `https://waitron.local` only (`apps/server/src/config.ts:450-457`).
    The spare's page is at its own name, `box-<id>.waitron.local`. "Passkeys checked against the
    venue's and both boxes' own origins" is §11's 4d line.
  - The till signs in by PIN and offers no passkey today (`apps/till/src/api/client.ts:2816`).
  - The spare's page sends the person's sign-in with each of its five requests: take, preview,
    declaration, preparation and activation (`handover-screen.ts:182`, `#signIn()`). A passkey would
    ask the person to unlock the key five times, or needs a short-lived proof the box carries across
    its restart. That is a design choice of its own.

  Recommended: 4d, with the multi-request question settled in 4d's plan. Until then the switch takes
  the password and, when one is enrolled, the code (§6.2's other branch).

## Global constraints

- Strip delay: 20 seconds (§6.1, "a starting value" per §13). Constant `MAIN_SILENT_MS = 20_000` in
  `apps/till/src/api/server-router.ts`.
- Wording (English in code, Spanish in the translation files):
  - strip: "The main server is not answering" / «El servidor principal no responde»
  - button: "Switch to the spare server" / «Cambiar al servidor de reserva»
  - strip, when the spare does not answer either: "No server is answering. Check this device's
    network connection." / «Ningún servidor responde. Revisa la conexión de red de este dispositivo.»
  - till refusal: "The main server is still answering. To move to the spare, hand over from Servers
    on the dashboard." / «El servidor principal todavía responde. Para pasar al de reserva, haz el
    traspaso desde Servidores en el panel.»
  - page, no second clock, what to do: "Switch from a till or phone on the venue's network, or
    connect the box to the internet." / «Cambia desde una caja o un móvil del local, o conecta el
    equipo a internet.»
  - page, no second clock, what ends it: "It carries on by itself once the box reaches the
    internet, while this page stays open." / «Sigue sola cuando el equipo tenga internet, mientras
    esta página siga abierta.»
- CLAUDE.md §3: "A refusal explains what happened and what each choice does". Colours read
  `--wt-*` tokens only. The guide is updated in English and Spanish.
- Size: about 650 changed lines of code and tests. Stop and report at 900.

## Review focus

1. **The till itself loses its network.** Neither box answers, so the strip says no server is
   answering and offers no button: opening another page would only show a browser error. Test
   (Task 1).
2. **A main box that answers slowly but is alive.** A probe that times out at 3 s counts as silent,
   so the strip can appear. Pressing the button checks again with the same rule as the router (an
   answer from `/api/node` is "answering", whatever its status). If that check also times out, the
   till opens the spare's page, and the spare's own check (`sourceSilent`) refuses unless the main
   box is `unreachable`. Test (Task 1): the press check and the router agree on a 503 and on a
   timeout.
3. **A venue with one box.** There is no spare, so there is no button, and today's muted line stays.
   Test (Task 1).
4. **The main box comes back after the strip appears.** The next answering probe clears the strip
   and any refusal message. Test (Task 1).
5. **A spare that has not finished joining.** It is listed before its page can switch. The button
   shows only while the spare's probe answers; a page that refuses explains itself (the spare's
   existing refusals), and its Stop link returns to the till (Task 1's `back`). Test (Task 1): the
   button hides while the spare's probe is unreachable.

---

### Task 1: the till's strip and switch button, and the way back

**Files:**
- Modify: `apps/till/src/api/server-router.ts` (keep each server's `standing` from `setServers`;
  include standing in the `state-changed` signature; the main box's silence; the spare; a single
  probe of the main box)
- Create: `apps/till/src/widgets/main-server-strip.ts` (`till-main-server-strip`)
- Modify: `apps/till/src/till-app.ts` (render the strip in the shell, hide the muted waiting line
  while the strip shows, handle the button), `apps/till/src/screens/till-lock-screen.ts` (the strip
  on the lock screen)
- Modify: `apps/till/src/i18n/strings.ts` (English and Spanish: `server.main_silent`,
  `server.none_answering`, `server.switch_to_spare`, `server.main_still_answering`)
- Modify: `apps/setup/src/screens/handover-screen.ts` (the `back` link) and its strings
- Modify: `apps/server/src/guide/en/servers.md` and `apps/server/src/guide/es/servers.md` (the
  emergency section, today `:51-83`: on a till, the red strip's button opens this page and brings
  you back; typing the spare's address stays the way from any other device; a wrong password
  restarts the spare, which then rebuilds its copy (D5))
- Test: `apps/till/src/api/server-router.test.ts`, `apps/till/src/widgets/main-server-strip.test.ts`,
  `apps/till/src/widgets/main-server-strip.a11y.test.ts`, `apps/till/src/till-app.test.ts`,
  `apps/till/src/screens/till-lock-screen.test.ts`, `apps/setup/src/screens/handover-screen.emergency.test.ts`

**Interfaces:**
- Produces, on `ServerRouter`:
  - `get mainSilentSince(): number | null`: when the chart's `serving-primary` entry first failed to
    answer since it last answered; `null` while it answers or when the list has no such entry.
  - `get spare(): { url: string; answering: boolean } | undefined`: the first `serving-secondary`
    entry. `answering` is true while its last probe answered.
  - `probeMain(): Promise<boolean>`: one probe of the `serving-primary` entry's `/api/node`, under
    the router's existing 3 s timeout. It is `true` for any HTTP answer, matching what a round
    counts as an answer, and `false` for a network error or a timeout. It does not move the router
    or change stored states.
- Produces: `<till-main-server-strip .spareAnswering=${boolean} .showSwitch=${boolean} .refused=${boolean}>`,
  which dispatches `switch-to-spare` (bubbles, composed) when its button is pressed.
- `till-app` owns the press: `router.probeMain()`. When `true`, it sets `refused`, which clears on
  the next `state-changed` in which the strip is gone. When `false`, it calls
  `this.navigate(url)`, where `url` is `new URL("/handover/emergency", spare.url)` with the search
  parameter `back` set to `location.href`. `navigate` is a seam that defaults to `location.assign`,
  so tests can watch it.
- Produces, on the setup page: when `/handover/emergency` carries `back`, and `back` is an `https:`
  URL whose hostname is the page's own hostname without its first label (the venue's name, since a
  box's own name is `box-<id>.<venue name>`, `box-name.ts:12-13`), the emergency flow's Stop link
  (`handover-screen.ts:693`) and its final Continue link (`:711`) go to `back` rather than `/`. Any
  other `back` is ignored.

- [ ] **Step 1: router tests first** (`server-router.test.ts`, fake timers starting at
  `Date.UTC(2026, 10, 14, 21, 0)` rather than 0, and a stub fetch, the file's existing pattern):
  - `"mainSilentSince starts at the main box's first failed probe and clears when it answers"`:
    `serving-primary` A fails at t0 and t0+5 s, then answers at t0+10 s. Expect t0, then t0, then
    `null`.
  - `"mainSilentSince reads the chart's serving-primary entry, not the page's origin"`: the origin
    answers, and A's own address fails. Expect a time, not `null`.
  - `"spare is the serving-secondary entry and says whether it answers"`, plus with only A: expect
    `undefined`.
  - `"a change of standing alone repaints"`: `setServers` with the same urls and swapped standings
    dispatches `state-changed`.
  - `"probeMain answers true for any HTTP answer and false for a timeout or network error"`: a 503
    gives `true`, a 3.1 s hang `false`, a rejected fetch `false`. `current` and the stored states
    stay unchanged.
- [ ] **Step 2:** run `pnpm --filter @waitron/till exec vitest run src/api/server-router.test.ts`.
  Expect the new cases to FAIL because the members do not exist.
- [ ] **Step 3:** implement. `setServers` keeps `standing` beside `url` and `label`. A saved
  `waitron.servers` entry without one reads as no standing (neither main nor spare).
- [ ] **Step 4:** run the router tests again. Expect PASS.
- [ ] **Step 5: strip, shell and page tests first.**
  - `main-server-strip.test.ts`:
    - With `spareAnswering`, it renders `t("server.main_silent")`. The button shows only with
      `showSwitch`. A press dispatches `switch-to-spare`. With `refused` it shows
      `t("server.main_still_answering")`.
    - Without `spareAnswering`, it renders `t("server.none_answering")` and no button.
    - It paints with `--wt-color-danger` (the test reads the computed style).
  - `main-server-strip.a11y.test.ts`: axe in light and dark, for the three states.
  - `till-app.test.ts`, beside the `server.waiting_promotion` case at `:16255`:
    - `"shows the main-server strip after 20 seconds of silence, not before"`: at 19.9 s there is no
      strip and the muted line shows. At 20 s the strip shows and the muted line is gone.
    - `"offers the switch on a locked till and to a node.manage holder, not to other signed-in staff"`.
    - `"a kitchen display shows the strip without the switch"`.
    - `"a press while the main server answers shows the refusal and does not navigate"`.
    - `"a press while the main server is silent opens the spare's switch page with the way back"`:
      `navigate` gets `https://box-b.waitron.local/handover/emergency?back=<encoded location.href>`.
    - `"a till that reaches no server shows no switch"`.
    - `"a venue with no spare shows today's waiting line and no strip"`.
    - `"the strip and its refusal clear when the main server answers again"`.
  - `till-lock-screen.test.ts`: the strip shows on the lock screen at 20 s.
  - `handover-screen.emergency.test.ts`: `"Stop and Continue go back to the till named in back"`
    (page at `box-b.waitron.local`, `back=https://waitron.local/tabs`). `"a back on another site,
    or not https, is ignored"` (`https://evil.example/`, `http://waitron.local/`), and the links
    stay `/`.
- [ ] **Step 6:** run those files and expect FAIL. Then implement:
  - the widget;
  - its rendering in `till-app`'s shell, where the muted banner is today, and on the lock screen;
  - the press handler with the `navigate` seam;
  - the page's `back`.

  For the 20 seconds, `till-app` sets one timer for the time left (`MAIN_SILENT_MS` minus the
  silence so far) when the router reports silence, and clears it when the silence ends.
- [ ] **Step 7:** run every file named in this task, plus
  `pnpm --filter @waitron/till exec tsc --noEmit -p .` and
  `pnpm --filter @waitron/setup exec tsc --noEmit -p .`. Expect PASS and exit 0. Then run
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts scripts/no-hardcoded-chrome-views.test.ts scripts/style-token-names.test.ts scripts/english-only.test.ts`.
- [ ] **Step 8:** open the strip and LOOK. Take screenshots at phone width and at till width, in
  both themes, for the three states. They stay in `~/waitron-campaign/a947-4c-shots/` and are never
  committed.
- [ ] **Step 9:** commit with `git commit -s`: "A947 4c: a till shows the main-server strip and
  opens the spare's switch page".

### Task 2: the switch page's no-second-clock wait in the design's words

**Files:**
- Modify: `packages/fiscal-verifactu/src/setup/recovery-hour.ts:426-436` (the promote-mode
  `secondClockDo` and `secondClockEnds`)
- Test: `packages/fiscal-verifactu/src/setup/recovery-hour.browser.test.ts`

**Interfaces:** none new. `vf-recovery-hour` in `mode: "promote"` changes two texts. The same screen
serves the controlled handover's page (`handover-screen.ts:206-248`), and the new words fit it too:
on both pages, a till or phone on the venue's network is the second clock.

- [ ] **Step 1:** in the promote-mode cases, change the expectations for `secondClockDo` and
  `secondClockEnds` to the Global Constraints wording, in English and Spanish. Record each change
  under "Changed test checks" in the PR, citing §6.5's switch row.
- [ ] **Step 2:** run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/setup/recovery-hour.browser.test.ts`.
  Expect FAIL on the new words.
- [ ] **Step 3:** set the two texts.
- [ ] **Step 4:** run the file again, plus
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/setup/recovery-hour.a11y.browser.test.ts src/setup/clock-wait.browser.test.ts`.
  Expect PASS.
- [ ] **Step 5:** commit: "A947 4c: the switch page's no-second-clock wait uses the design's
  switch wording".

### Task 3: a till reaches the promoted spare at the venue's name

**Files:**
- Test: `apps/server/src/till-reroute-e2e.test.ts` (the case at `:324-325`, "A primary, B standby;
  A goes down; B promoted+restarted; the device cookie follows")

- [ ] **Step 1:** in that case, after B's restart, add the assertions the design's §6.3 step 4
  relies on: B's mDNS names include `waitron.local`, and the certificate B serves names
  `DNS:waitron.local` and is issued by the venue authority B received at joining. Use the file's own
  promoted B; if the case builds B without a joined spare's authority, say so and assert on the
  authority it has.
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/till-reroute-e2e.test.ts`.
  Expect PASS with no code change. Then the control: start B as a mirror (no promotion) in a copy of
  the case. The names assertion must FAIL, because a mirror answers only its own name. Record the
  control in one sentence in the commit message. If the case fails without the control, stop and
  report.
- [ ] **Step 3:** commit: "A947 4c: a promoted spare answers the venue's name with a certificate
  naming it".

### Close

- `docs/backlog/replication-cloud.md`: in the A947 entry, record 4c as built. Add departures 1–3 and
  Q1's answer to 4d's line.
- The design's §11 4c line gets a dated pointer to this plan, naming the departures.
- Delete nothing else from the backlog.

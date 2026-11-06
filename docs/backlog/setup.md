# The setup wizard, onboarding and the demo venue — detail

The open entries are listed in [the backlog](../backlog.md), under "The setup wizard, onboarding and the demo venue". This file holds
their full text.

## `#onGoto` in `setup-app.ts` keeps `fiscalTestStatus`

- `apps/setup` code, found by #567. `#onGoto` in `setup-app.ts` keeps `fiscalTestStatus`, so a
  rejected or uncertain fiscal-test banner, and an accepted result, survive leaving that screen and
  coming back, even after the certificate changes (found by reading, not run; whether that is
  wanted is undecided); a cloud restore opens the provisioning screen (`#onCloudRestoreAction`)
  without `#clearProvisionOutcome()`, which the four other ways onto that screen call first, so an
  earlier attempt's message could show there (found by reading, not run); `AdoptOutcome`'s
  `breakGlassSecret` is typed as required, but a replayed adopt answers without it
  (`apps/server/src/setup-api.ts`); the mode screen's own text says a live server files real
  invoices, which a live run on a development box does not; `setup-app.test.ts`
  has two test titles naming a `SyntaxError` from a non-JSON error body that `apiError` turns into
  `server.internal`; `events.test.ts` has no case for the restore and fiscal-test dispatchers; the
  `*.css?inline` declaration in `vite-env.d.ts` is redundant (vite/client declares it);
  `vitest.config.ts` excludes `.stryker-tmp` in a package with no Stryker config; `paintCanvas` in
  `widgets/test-helpers.ts` has no accessibility suite that fails without it; and `connection-screen.ts`'s `connection-continue` event is not named `wt-*`
  and carries no `detail`.

## Setup wizard — the constraints A2's rework left behind (A2)

What constrains the next change to the wizard:

- **Detection must PROMOTE the match, not pre-open it in a full list.** The matched guide is
  lifted out with the rest behind one closed disclosure.
- **The demo tax ID is fixed and must never reach Prepare or Live.** Since W108 it is the country
  pack's demo value (`CountryPack.demo`; Spain's, `B00000000`, in `packages/country-es/src/spain.ts`),
  which passes Spain's own check as a company's: it is safe only because a demo box files nothing.
  Prepare and Live start with an empty tax ID and legal name, and leaving Demo for either clears both
  from the draft (`#onPatch`, `apps/setup/src/setup-app.ts`). Leaving Demo also clears an explicitly
  automatic venue name with its draft ownership marker; a name you authored remains. The
  Demo/Live/Demo cases in `apps/setup/src/setup-app-venue.unsaved-changes.test.ts` cover both paths.
- **Default both series codes to values that survive a cold restore.** A cold restore appends
  `-<installation number>` and `stripOwnSuffixes` would then re-number a trailing `-<digits>`, so
  default to **FS** (factura simplificada — every till sale is `TipoFactura` F2) and **FR**
  (rectificativa). Nothing in the dashboard can change or add a series today.
- **`operation_description` comes from the installed fiscal contribution.** The setup routes fill
  in the filing module's default when the request has none (`parseVenue`,
  `apps/server/src/setup-api.ts`). The wizard's venue form never adds it; a first setup carried
  over from an earlier attempt copies that attempt's stored venue, which holds it
  (`#acceptFirstIdentity` and `#replaceFirstSetup` in `apps/setup/src/setup-app.ts`). Product
  sales use the description you save in the **Receipts** tab of each department's dialog, or the
  fiscal module's default description when the department has none; the venue's own description is
  not their fallback.

## The configuration preview names what it will copy by database table

**Left open by C42 (#837):**

- _The configuration preview names what it will copy by database table_ (`products`,
  `menu_item_variant_overrides`, `print_agents`…) in both languages
  (`apps/setup/src/screens/configuration-preview-screen.ts`). The names come from each module's
  `configuration-transfer.ts` list; about fifty can arrive. Give them operator words, grouped, or
  keep the table names.

## The certificate export help has never been followed on a real machine

**Still open after #334:**

Nobody exported a
  certificate through Windows', macOS' or Firefox's own certificate store while reading the new
  guidance, so the instructions are unverified against the thing they describe. Fold this into the
  device walkthrough (item 1 of _What to work on next_) and tick it off per operating system in
  [ui-review.md](../ui-review.md).

### A834 link qualification, 2026-10-20

The macOS link in setup and the dashboard now uses `/en/`, matching Windows and Firefox. A headless Chromium opening of
all three URLs returned HTTP 200 and `html lang="en-GB"`; opening the old macOS `/eu/` URL
returned `html lang="eu-ES"`. This qualifies the site language, not a translated article or a
certificate export. The existing walkthrough above remains open.

| FNMT page opened | Source wording | Observation |
| --- | --- | --- |
| [Windows export](https://www.sede.fnmt.gob.es/en/preguntas-frecuentes/exp-imp-y-elim-de-certificados/-/asset_publisher/EwGOMAWPq4DV/content/1501-como-puedo-exportar-un-certificado-digital-con-google-chrome-en-windows-) | “Para exportar un certificado con Google Chrome” | English site controls; Spanish article text. |
| [macOS export](https://www.sede.fnmt.gob.es/en/preguntas-frecuentes/android-mac/-/asset_publisher/1RphW9IeUoAH/content/1379-como-puedo-exportar-mi-certificado-desde-el-llavero-de-mac-) | “Para exportar su certificado personal” | English site controls; Spanish article text. |
| [Firefox export](https://www.sede.fnmt.gob.es/en/preguntas-frecuentes/exp-imp-y-elim-de-certificados/-/asset_publisher/EwGOMAWPq4DV/content/1399-como-puedo-exportar-mi-certificado-con-mozilla-firefox-) | “Acudir al almacén de certificados” | English site controls; Spanish article text. |

`pnpm --filter @waitron/setup exec vitest run src/screens/cert-screen.test.ts` checks that both
setup languages render three FNMT links under `/en/` and retain the three article identifiers.
It does not fetch FNMT or check its translations.

## Switching setup mode does not clean up what the server already holds

**Still open after #334:**

#334 clears the browser's
  own record that a certificate import was requested, and nothing more. If someone fills in Demo,
  Prepare or Live far enough that the server has stored part of that answer and then switches mode,
  what the server kept is untested — write a test that stages configuration in one mode, switches,
  and asserts what survives.

## The setup app's catch-all redirect was not proven by deleting it

**Still open after #334:**

Unknown setup addresses go
  to `/` while real files and API routes keep their own responses. The reviews checked this by
  running the route tests and the full server suites, not by removing each exclusion one at a time
  and watching a test fail, and no separate probe confirmed the trading app is untouched by the
  redirect.

## In Demo, a server refusal of a field Demo hides can only be retried unchanged

**Demo gaps on the setup wizard's venue screen, as they stand after C47s (#840), left unfixed** —
each says whether it was seen in a run or only read in the code:

The shell routes
  a refused `seriesCode`, `rectificativeSeriesCode` or `operationDescription` back to the venue
  screen whatever the mode (`apps/setup/src/setup-app.ts`, the venue case of the refusal routing).
  The refusal's sentence shows above Next and pressing Next moves on to the review screen, which
  sends the same series codes again, so the operator has nothing to change if the server refused
  them. The venue screen's half is pinned by the `shows a Demo refusal of the hidden
%s above Next, and pressing Next tries again` cases in `apps/setup/src/screens/venue-screen.test.ts`;
  the move to the review screen (`#onAdvance` in `setup-app.ts`) was read, not run. Whether the
  server ever refuses Demo's fixed series codes is not established.

## In Demo, a local check that fails only on a field Demo hides

**Demo gaps on the setup wizard's venue screen, as they stand after C47s (#840), left unfixed** —
each says whether it was seen in a run or only read in the code:

- _In Demo, a local check that fails only on a field Demo hides_ — for example a draft whose series
  code equals its refund-invoice series code — shows its message above Next once Next has been
  pressed, while Next stays enabled (it is disabled only by errors on fields the screen shows).
  In that example both hidden fields carry the same message, and the message above Next is built
  from every hidden field's error (the `bottom` list in `render`,
  `apps/setup/src/screens/venue-screen.ts`), so "Use different codes for ordinary and correction
  invoices." would appear twice. Every press only runs the focus-the-first-invalid-field step and
  returns, so the draft is never sent. All of this was read in the code, not run; whether a real
  draft can reach that state has not been tested.

## A venue's time zone must come from its country pack's list (A166, owner 2026-10-01)

**OPEN.** The
owner: _"in fact this should be chosen from a dropdown, and the options specified in the country
package, eg Spain has two time zones, one for mainland and one for las canarias"_. Today setup does
not let anyone choose it: it takes the zone from the province of the venue's address (Spain's pack,
`packages/country-es/src/spain.ts:180`, gives Las Palmas and Santa Cruz de Tenerife
`Atlantic/Canary` and every other province `Europe/Madrid`; the UK pack gives `Europe/London`). But
the column, `locations.time_zone`, is plain text, and provisioning copies whatever it is given
(`packages/provisioning/src/venue-apply.ts`).
Readers then disagree about a bad zone: reporting throws, bookings falls back to Madrid, account
emails to UTC. **Wanted:** each country pack lists the zones it allows (Spain: Madrid and Canary),
and creation/provisioning writers refuse a zone not on its country's list. A dropdown is needed
only if a venue could ever need a zone other than
its province's; for Spain the province decides. (Aside: a Canary venue cannot be set up yet — the
pack marks the Canary tax territory unsupported.)
A261 step 7's approved plan separately permits a named-zone override before dated history;
its editor validates named zones and refuses numeric offsets. Importing configuration into an
existing venue retains its saved zone (`applyPreparedVenue`,
`packages/provisioning/src/configuration-transfer.ts`); importing venue details is a creation concern,
not an edit through that applicator.

## The demo data carries Catalan and Galician text (W109-3, #1321, Task 3 of the same plan) — DONE; the text is UNCHECKED by a speaker (owner decision 4, 2026-10-06) — OPEN

Every customer-facing text
in `casa-delgado-es` (`packages/country-es/src/demo/menu.ts`, `reasons.ts`,
`casa-delgado-es.ts`) has a Catalan and a Galician value, written by Claude; nothing
wrote them until Task 4 (W109-4), which now does in the areas that use them. The PR carries the side-by-side table. A speaker of each should
read it; the drafter was least sure of the Galician "Charcutaría", "Lombo embuchado", "Ventrecha de
bonito", "Luras á romana", "Polbo á feira", "Café só", "Tortilla de patacas" and the doneness
choices, and the Catalan "Salsitxó", "Llom embotit", "Filet al whisky", "Error en marcar" and
"Invitació de l'encarregat".

The demo's Drinks section labels in Catalan and Galician are drafts awaiting the
same check, left open by A321 (the demo's included Drinks menu opens onto four sections).

## A guided tutorial for Demo and Preparation (A250, owner 2026-10-03)

**OPEN, partly designed, not
to be built yet (owner: "we just mustn't forget it"); needs a spec before queueing.** A walk-through
that teaches a new user what to set up and in what order — devices, printers, device profiles, and
the other settings a venue needs before it trades — shown in Demo and Preparation
(`onboardingIntent` `demo` and `prepare`). The user can leave the tutorial at any point and come back
later to carry on where they stopped.

Owner decisions from the 2026-10-03 brainstorm:

- **It teaches the real setup, never the pretend devices.** A lesson shows how to set up a real
  printer or card reader, or at least where to find the screen, even in Demo; it does not route the
  user through the pretend printer (A241) or the pretend card reader (A247), so it does not depend
  on them.
- **Two kinds of lesson.** A _tour_ ("here is where you do this") is ticked off by the person. A
  _required_ lesson ("you need to do this before going on") ticks itself when the server sees the
  work done, and the tutorial does not move past it until then. A person can also mark any lesson
  done or skip it by hand.
- **Everything the tutorial stores is per person**: each person's marks, skips and whether the
  tutorial is open. A required lesson still reads the venue's state, so it is ticked for everyone
  once anyone has done the work.

The owner's starting point for the lessons, in order (owner: "a good starting point"). The order
follows what depends on what: a newly approved device takes its printers from its profile's lists
(A238), so printers come before profiles and profiles before devices.

| #   | Lesson                                                            | Kind     | Ticks itself when                                |
| --- | ----------------------------------------------------------------- | -------- | ------------------------------------------------ |
| 1   | Products: what you sell, prices, VAT                              | Required | at least one product exists                      |
| 2   | Extras and options                                                | Tour     | —                                                |
| 3   | Menus: put products on a menu and publish it                      | Required | a menu is published                              |
| 4   | Kitchen: preparation stations and where tickets go                | Tour     | —                                                |
| 5   | Floor plan, for table service                                     | Tour     | —                                                |
| 6   | Printers: receipt and kitchen printers                            | Tour     | a printer exists (ticks, never blocks)           |
| 7   | Device profiles: what each kind of device may do, its printers    | Tour     | —                                                |
| 8   | Devices: open the till on the device, approve it in the dashboard | Required | a device is approved                             |
| 9   | Card payments: connect a card reader                              | Tour     | a reader exists (ticks, never blocks)            |
| 10  | Staff: the team and their PINs                                    | Tour     | a second person exists (ticks, never blocks)     |
| 11  | Receipts: what the receipt says                                   | Tour     | —                                                |
| 12  | A first sale on the till                                          | Required | a sale from a device (sample sales do not count) |
| 13  | Backups: a copy off the box                                       | Tour     | backups are set up (ticks, never blocks)         |
| 14  | Going Live: export the setup, start the Live box (Prepare only)   | Tour     | —                                                |

In Demo, lessons 1 and 3 tick themselves at once (the sample restaurant has products and a published
menu) and stay open as tours; lesson 14 is not shown, because Demo reaches Prepare by a wipe, not a
copy. The owner account made at setup already has a till PIN, which is why staff is not required.

Facts found while designing: going Live never happens on the same database — Prepare to Live is a
fresh database plus the configuration copy (`apps/server/src/configuration-export-api.ts`,
`apps/server/src/configuration-import.ts`) and Demo to Prepare is a wipe — so progress stored in the
venue database ends at Live unless the configuration copy is made to carry it. The sample restaurant
is seeded in Demo only (`seedDemo`, called for `mode === "demo"` in `apps/server/src/setup-api.ts`);
both modes get the three default device profiles (`DEFAULT_DEVICE_PROFILES`,
`packages/layouts/src/device-profile.ts`).

Still open for the spec: whether a required lesson blocks every lesson after it or only those that
depend on it; whether any of content languages, rosters and working time,
purchasing or Cloud services gets a lesson; whether a printer or staff should be required; how the
tutorial is reopened (the Demo bar, A246, W36, is the obvious place); whether it spans the till as
well as the dashboard; and how each required lesson's check is read without slowing the dashboard.
It comes after the Demo bar (A246, W36) and A238, whose device and profile model it teaches.

## Android/iOS on-device install and trust rows

Real phones on the shop WiFi, the owner's to
run. The name-constrained CA does NOT protect a personal Android phone (measured 2026-09-08); BYOD
Android either accepts broad trust in the box CA or uses the public-certificate path — an owner
call before go-live.

## The till's "This device hasn't trusted the till yet" page has never been seen on a real device

`isTrustBroken` (`apps/till/src/trust-check.ts`) reads a `SecurityError` from
registering the non-existent `/sw-probe.js` as "certificate not trusted"; that signal is still a
belief, never checked on a device that clicked past the browser's warning. It runs only on pages
served over HTTPS. Two gaps remain: the signal is trustworthy only while the server answers the
probe with 404, which the box's `mountSpa` does; and no test covers the HTTPS default, because a
browser test page cannot be served over HTTPS. **Next action:** during the on-device trust rows
above, click past the certificate warning on one device and confirm the page appears in the
browser's preferred supported language, falling back to English when none is supported.

## A fresh Demo venue opens its dashboard on a red tax-filing alert

Seen on a box image during
A680, 2026-10-14: a Demo set up through the wizard showed "473 fiscal record(s) have been waiting
705h to reach the tax agency" (`fiscal.submission_delayed`). The 473 records are the demo seed's
back-dated sales, and a Demo venue sends nothing to the tax agency. A Preparation venue set up the
same way had no fiscal records and no fiscal alert. The alert is raised in
`packages/fiscal-verifactu/src/submission-alerts.ts`; why it fires for Demo was not traced.

## Loose ends left by A496 (moving to a new tax ID).

- How long, and in what form, an old taxpayer's database must be kept. Not checked;
  `deploy/README.md` → _Moving to a new tax ID_ says so.
- The new-tax-ID procedure cannot tell the operator when the old box has sent its last sales to
  AEAT. Step 3 of `deploy/README.md` → _Moving to a new tax ID_ keeps the box on so it can; the
  only signal it names is the delay alert (`fiscal.submission_delayed`), raised after four hours.
- A change of country cannot import a configuration. Setup refuses an export whose country
  differs from the new venue's (`provision`, `apps/server/src/boot.ts`); importing across
  countries needs its own design.
- The dashboard shows the configuration export card where the export route is not served, so its
  download fails there: on a demo box, and on a box whose settings name no onboarding intent, such
  as a promoted mirror (`persistTradingEnv` writes none). The route is mounted only when the
  intent is preparation or live (`apps/server/src/boot.ts`).

## Loose ends left by SQLite slice 2 Task 9c (#646, "Restore from my bucket" in the setup wizard).

- The bucket route answers a wrong key (`recovery.passphrase_invalid`) and a damaged copy
  (`backup.artifact_invalid`, `backup.archive_invalid`) with different codes; the wizard shows
  one sentence for all three, as the command line does.
- The first, unconfirmed attempt downloads the whole copy only to show whose it is, and the
  confirmed attempt downloads it again; the HTTP request stays open for the whole download.
- Walked in the browser test harness against a stubbed server, not yet on a running box. Walk it
  on the box after 2 November: back up a test venue to a real bucket, wipe it, and restore it
  through setup.
- After an archive restore or a Cloud restore the final screen does not show the device steps the
  bucket rebuild's shows (`rebuilt` is set only on the bucket path,
  `apps/setup/src/setup-app.ts`), although the first start re-issues the certificate for this
  machine's addresses after an archive restore too.

## Loose ends left by #334.

- The certificate export help has never been followed on a real machine. Nobody exported a
  certificate through Windows', macOS' or Firefox's own certificate store while reading the new
  guidance, so the instructions are unverified against the thing they describe. The Spanish
  steps name Chrome, macOS and Firefox menus from memory ("Gestionar certificados importados de
  Windows", "Acceso a Llaveros", "Sus certificados"…). The three FNMT links use its English
  site, whose article text was still Spanish when opened on 2026-10-20; check the instructions
  on real Spanish systems (left open by C42, #837).
  [Detail](#the-certificate-export-help-has-never-been-followed-on-a-real-machine)
- Switching setup mode does not clean up what the server already holds. If someone fills in
  Demo, Prepare or Live far enough that the server has stored part of that answer and then
  switches mode, what the server kept is untested — write a test that stages configuration in
  one mode, switches, and asserts what survives.
  [Detail](#switching-setup-mode-does-not-clean-up-what-the-server-already-holds)
- The setup app's catch-all redirect was not proven by deleting it. The reviews checked this by
  running the route tests and the full server suites, not by removing each exclusion one at a
  time and watching a test fail, and no separate probe confirmed the trading app is untouched by
  the redirect.
  [Detail](#the-setup-apps-catch-all-redirect-was-not-proven-by-deleting-it)

## The first-setup record store still accepts the `retire` and `select-workspace` actions and `nextWorkspace`, which nothing writes since A1042

Left open by A1042 (D4). `packages/provisioning/src/first-setup-resolution.ts` still declares and
validates both actions and the `nextWorkspace` field (`:43-48`, `:195-267`); every writer passes
`nextWorkspace: null` (`first-setup-finish-audit.ts`, `first-setup-owner-audit.ts`) and none
writes either action. Remove them, with the tests that pin them.

## The repair page's Start again oddities from #1752

Three things on the setup app's repair page, all on main since 4e318802f (#1752): after Start
again the heading still reads "First setup was interrupted" above "The old attempt is deleted.
Reconnect to continue."; two "Start again" buttons are drawn at once, the one that opens the
confirmation and the one that confirms; and Continue sits tight against the password field at
phone width (`apps/setup/src/setup-app.ts`, the first-owner screen).

## The spare file's size is measured on HFS+ and Linux tmpfs only

A1127 measured the room a lock, the emptying and the Start-again flow need on a 32 MiB HFS+ image,
and CI runs the real-disk cases on Linux tmpfs mounts of 32 MiB (48 MiB for `start-from-spare.e2e.test.ts`). Not measured: ext4 (the box's likely
filesystem: 4 KiB blocks, its journal, root-reserved blocks), copy-on-write filesystems with
snapshots or compression (btrfs, zfs), and whether the `logs` volume shares the state folder's disk
on every box. Detail:
A1127's design, "Open, not measured".

## The repair page draws a Start-again error twice

On the Start-again confirmation, a refusal's message appears under the password field and again
under the tick box; with A1127's longer full-disk words that is about half a phone screen at 375 px
(`~/waitron-campaign/a1127-measure/look/`). Believed to predate A1127: both slots show the same
stored error, and a plain 500 also shows twice (look check of 2026-10-28, run on the branch, not on
`main`).

## A boot test's disk assertion reads the checkout's path

`apps/server/src/first-setup-resolution.boot.test.ts`'s two supervised cases assert the page does
not match `/disk/i`, and the page prints a stack trace holding the checkout's path, so the cases fail
in any worktree whose path contains "disk" (A1127's own worktree, `…-full-disk-spare-file`). They pass
in a copy at another path and on `main`.

## A1142: a cut-off Start again beside found files the Move cannot handle gets only the explanation

- **A1142: a cut-off Start again beside found files the Move cannot handle gets only the
  explanation.** A link, device or lock file, a finisher's `setup.start_again_incomplete` for any
  other reason, or more than 20,000 found entries: no Keep
  or Move (owner question Q2, built with A). Left open by A1098.
  [Detail](setup.md#a1142-a-cut-off-start-again-beside-found-files-the-move-cannot-handle-gets-only-the-explanation)

Left open by A1098 (owner question Q2, built with option A, the most cautious). When the found
files include, at any depth, a symbolic link or special file, a lock file (`venue.lock`,
`venue.lock-journal`, `venue.holder.json`, `migrations.lock`, `recovery.lock`), or more than
20,000 entries (`START_AGAIN_ENTRY_LIMIT`), or the finisher refuses `setup.start_again_incomplete`
for a reason other than found files, the box shows A1042's `setup.start_again_incomplete` page:
the explanation and what reinstalling would lose, with no choice (`surveyStartAgainLeftovers`,
`packages/provisioning/src/first-setup-start-again-leftovers.ts`). In every one of these cases
`classifyStartAgainRefusal` hands back the finisher's own refusal, so the survey's reason for
explaining is dropped and the start's `recovery.serving_refused_start` log line carries the
finisher's reason instead. A finisher refusal with any
other code is not one of the start's refusals, so that start carries on past it instead
(`refusedAtStart`, `apps/server/src/first-setup-entry.ts`; read, not run). Option B, offering Keep alone
for these boxes, is still open to the owner.

## A1285: should the staged reset of a stopped join delete `secrets.env`?

Left open by A947 slice 3a. A staged reset of a stopped join keeps `secrets.env` (its list in
`runStagedReset`, `apps/server/src/reset-request.ts`, leaves it out). That was kept so a Move folder
sealed under the box's own ring stays readable after an early-stopped join; a join that stopped
after it replaced `secrets.env` leaves the main box's ring there. Now that the Move keeps its own
copy (A1143), decide whether the staged reset should delete `secrets.env`.

## A1284: where the environment sets the vault key, a Move or a join leaves a ring that is not the one in use

Left open by A947 slice 3a. Setup mode always writes `secrets.env` with its own key
(`ensureBoxSecrets`, called from `apps/server/src/boot.ts` in setup mode), and in trading mode a
non-empty `WAITRON_CREDENTIALS_KEY` in the environment wins over the file
(`apps/server/src/box-env.ts`). So on such a box a Move copies `secrets.env`, which opens rows
sealed in setup mode but not rows sealed in trading mode. Measured with the real `ensureBoxSecrets`
and `loadBoxEnv` in the slice's Task R review. The slice's finish-branch review (2026-11-01) then
ran both cases in a scratch test with the key set in the environment: after a Move and a join, the
copied ring opened neither the moved signing key nor the payment credential
(`credentials.decrypt_failed`); and a join through the real route wrote the main box's ring to
`secrets.env` (`apps/server/src/adopt.ts`), which the next start ignores, so the spare's new
signing key failed `credentials.decrypt_failed`. No production box sets the key in the environment
today (`deploy/` names none); a cloud profile can (`box-env.ts`). Decide whether the Move should
record the key in use or refuse to copy, and whether a join should refuse before any write when
the environment's key would hide the ring it receives.

## A1149: a failed restart after Retry or a Move exits the process, and a page that fails to draw after a recorded choice answers a bare 500

Left open by A1098. Both recovery-page routes, `POST /recovery-api/retry` and `POST
/recovery-api/start-again`, start the restart with `void` once the answer is written
(`apps/server/src/recovery-surface.ts`, `apps/server/src/recovery-start-again.ts`), so a restart
that rejects is an unhandled rejection, which exits the process (Node 26, a rejection in a
`finish` listener, run by the A1098 Task 8a review). Separately, the Start again route draws its
answer after the choice is recorded and outside its error handling, so a throw while drawing
answers Hono's bare 500 (`apps/server/src/recovery-start-again.test.ts`, "a page that fails to
draw after a recorded Move is not answered as unfinished, and still restarts once"); the recovery
app sets no error handler. Wanted: both routes log a failed restart and keep serving the page, and
the draw failure answers a page that says the choice was recorded.

## A1153: the recovery page's Retry restarts nothing if the browser disconnects before the answer arrives

Left open by A1098 (owner, 2026-10-27: file it, give it the Move's fix). `POST
/recovery-api/retry` asks for its restart only on the answer's `'finish'` event
(`apps/server/src/recovery-surface.ts`, unchanged since 2026-09-09 per `git blame`). A browser that
drops the connection first closes the response without `'finish'`, so the box would stay on the page
without restarting. The Move had the same shape and was fixed in #2131 by `afterResponse` in
`apps/server/src/recovery-start-again.ts`: restart once on whichever comes first of the answer
finishing, the connection closing, or a connection already over. For the Retry this was read, not
run; pressing Retry again would ask for the restart again. Wanted: the Retry uses the same
once-only restart, with a test that closes the connection before the answer is written.

## On a full disk, Start again's summary may need room for a copy of the setup database

Start again no longer goes through the password step (A1131bc slice 2). Its summary reads the setup
database in place, and copies it to a scratch folder only when a `-journal` file, or a `-wal` file
holding pages, sits beside it (`readSetupDatabase`, `apps/server/src/first-setup-database-holdings.ts`;
read, not run on a full disk). Continue's password step still keeps a whole copy, encoded as text
(`captureFirstSetupOriginals`, `packages/provisioning/src/first-setup-resolution-inspection.ts`). On
a full disk either copy has only the box's spare file (8 MiB) to use, and no step of the repair
page gives the spare up. So beside a held setup database, which this slice newly offers, the summary and Start again answer 507
`storage.disk_full` on a full disk and delete nothing (`apps/server/src/start-again-full-disk.e2e.test.ts`,
the held case). Wanted: give the spare up for every Start again the page offers,
measure the largest setup database an unfinished setup can leave, and either keep a copy within the
spare or say on the full-disk page what to do.

## A Waitron Cloud recovery whose download takes more than 30 seconds may be refused its series name

Left open by A1042; the behaviour predates it. Taking an invoice series name needs a second clock,
a time reading from somewhere other than the box, and a reading more than 30 seconds older than the
box's own counts as stale (`packages/fiscal-verifactu/src/hour-clock.ts:81`). A1042's U4a review
held a Waitron Cloud recovery's commit step before its download in the test host
`apps/server/test/hour-recovery-host.ts`, whose internet clock answers "offline" (`:140-144`), so
the only second clock was the browser's reading. Held 29 seconds, the commit finished; held 31
seconds, it was refused `sif.allocation_invalid` with reason `second_clock_missing`. The same run on
main at 21d01dfac gave the same result. A Cloud download may run for up to 14 minutes
(`apps/server/src/cloud-recovery.ts:121`). Not measured: whether a real box takes a fresh internet
reading when it places the recovery. (2026-11-04, A1131bc slice 4: that measurement held the old
recovery from backup's commit step, which is deleted with the rest of that recovery; the fresh-box
Cloud restore that Recover from backup now uses has not been measured the same way.) Next step: hold
the fresh-box Cloud restore's download past 30 seconds in `apps/server/test/hour-recovery-host.ts`
and see whether the series name is refused; then measure a real box.

## A1223. A stored series pick that turns out taken

From A1207. An attempt whose chosen name is found taken before it finishes is refused
(`minute_in_use`), and the person is not offered a way on. Start a new attempt by itself, and word
the refusal where it shows at activation (the setup app's general message with the code,
`apps/setup/src/setup-app.ts:2001-2008`).

## A1224. Delete the time floors the series choice no longer reads

From A1207. `recordedTimeFloorMs`, the backup's `backup-created` floor and
`readHourHistoryWithRecordFloor` are still worked out but nothing in the choice reads them. A
backup's record keeps accepting `timeFloorMs` (`packages/fiscal-verifactu/src/hour-backup-state.ts:20-21`)
until a check of shipped backups says it may stop.

## A1226. Compare clocks on the restore page can choose a series name by itself

From the A1207 finish-branch review. When the page's preview is refused because there is no second
clock, the page starts its 15-second second-clock check, and once a second clock answers, that check
sends a real `select` although Make the series was never pressed. This happens at A1207's base
(`61625b0ab`) too; the code is from #1990 (`3ba85c7a6`). Make the page's own re-checks after a
preview read-only, as A1207 did for a taken minute (`#compare` in
`packages/fiscal-verifactu/src/setup/recovery-hour.ts`).

A related path (A1207's figure review, probe R1): when Compare clocks shows a wait the box has
already recorded, the end of that countdown sends a real `select` although Make the series was not
pressed on this page load (at A1207's base too, one `select`; since A1207, a lost one is
repeated about every 15 seconds). The box records such a wait only after an earlier `select`, so
this may be intended; decide it with the rest of this entry. The setup page has the same shape
after a reload during the box's wait (read, not run: `#select(true)` in `first-hour.ts` skips
`#canSelect`).

## A1186. The setup tour offers Waitron Cloud's level-2 trial (owner, 2026-10-29).

- **A1186. The setup tour offers Waitron Cloud's level-2 trial (owner, 2026-10-29).** Setup
  invites the owner to sign up for Cloud and try level 2 (remote access, translation, the
  rota solver, backups) free for 30 days, with no payment details. Sign-up and payment
  happen on Cloud's pages. [Cloud billing design](https://github.com/waitron-io/waitron-cloud/blob/4064f3044f4826235e399070e564a94e4dd7bdd0/docs/superpowers/specs/2026-10-29-cloud-billing-design.md) §4–§5.
  [Plan](../superpowers/plans/2026-10-29-a1186-cloud-trial-offer.md) and
  proposed EN/ES mockups (removed from the repository on 2026-11-02) propose a small
  completion invitation without building A250. **Build remains open**; Cloud's qualified
  trial journey is prerequisite G1 in the plan.

## No Recover from backup when the setup's own record cannot be read or needs repair

- **No Recover from backup when the setup's own record cannot be read or needs repair.** Since
  A1131bc slice 3, Recover from backup is drawn disabled wherever Start again is disabled, including a setup
  record whose password cannot be checked and one whose claim mark needs repair; before, it opened
  the old recovery in both. The only way out is then a reinstall, unless the setup had saved nothing
  yet (Continue with the setup password repairs the mark only for a present, empty setup database
  with nothing else left behind: `repairEligible`, `packages/provisioning/src/first-setup-owner.ts`).
  Left open by A1131bc slice 3 (plan, N2).

## The bucket and Waitron Cloud restores have not been run after Start again's deletion

- **The bucket and Waitron Cloud restores have not been run after Start again's deletion.** A1131bc
  slice 3's server tests run the backup-file restore after the deletion (with the setup database
  missing, and with a held setup database: `first-setup-start-again-held-wipe.test.ts`); the bucket and Cloud routes were not run on that path.
  Left open by A1131bc slice 3 (plan, N5).

## "The saved setup cannot be read. Contact support."

- **"The saved setup cannot be read. Contact support."** (`shell.first_setup.attempt_invalid`,
  `apps/setup/src/i18n/strings/shell.ts`) sends the person to somebody else, against the refusal rule
  in `CLAUDE.md` §3. Wanted: say what happened and what each choice does. The words date from C42
  (#837, 2026-09-29). Noticed while planning A1131bc slice 3, not changed there.

## `restoreFromArtifact` has no production caller

- **`restoreFromArtifact` has no production caller.** Since A1131bc slice 4 deleted the repair
  page's old recovery from backup, only tests and the test helper `apps/server/src/testing/staged-hour-restore.ts` call it
  (`apps/server/src/restore.ts`; `git grep -n -w restoreFromArtifact -- apps packages`), to place an
  archive. Decide whether those tests should
  place archives through `runStagedRestore` instead, then delete it. Left open by A1131bc slice 4.

## Recovery operations still buffer whole database files

A1334 separates ordinary first-setup admission from exact recovery snapshots. The remaining
whole-file reads are separate work:

- `packages/provisioning/src/first-setup-resolution-inspection.ts` fingerprints `venue.db` and its
  WAL for the repair inspection and captures originals with `readFile`. Each database artifact is
  capped at 128 MiB. The unused `recheckEmptyDatabase` reader also retains its whole-file
  128 MiB check. The resolution archive in `first-setup-resolution.ts` also caps total original
  bytes at 128 MiB. Keep content-change detection and the archive's validation when replacing
  those buffers. A1159's Start again work remains open.
- `packages/provisioning/src/first-setup-start-again-deletion.ts` (`sha256`) reads whole files for
  deletion markers, including `venue.db`, `node.db` and their WALs. `fingerprintAgainst` avoids the
  read when the size differs; equal-size files are still hashed through a whole buffer. Preserve
  the same-size replacement refusal when streaming these hashes.
- `apps/server/src/cloud-snapshot-archive.ts` snapshots `venue.db`, caps the copy at 512 MiB,
  then reads it whole before packing and encrypting the archive. Cloud recovery downloads also
  collect an archive of up to 512 MiB in memory (`cloud-recovery.ts`). Setup recovery uploads buffer
  archives within their 256 MiB upload limit (`setup-api.ts`, `setup-recovery-preparation-api.ts`).
  These are transfer limits and buffers, not ordinary-start database admission.

An oversized committed attempt's Finish request now passes the readable-database gate and refuses
later with `setup.not_ready` (HTTP 503); the old size classification refused
`setup.attempt_uncertain` (409). The whole-branch review ran both versions and found no publication
or state change. Trace the Finish page's actual wording and preserve the refusal while giving an
actionable explanation if this size limit is reached. The review did not establish a normal way
for an unpublished setup to reach that size.

The archive's total-original byte cap lacks an isolated behavioural control: removing that check
survived the existing suites in review. Add a case that discriminates this limit from the other
artifact limits when replacing the snapshot buffers.

Local scheduled backups and local file restoration already pass files and stream database chunks;
see [the developer convention](../developers/conventions-data.md#local-backup-and-restore-pass-database-files).
This inventory comes from following source reads, not large-file runtime qualification of these
remaining paths. Next: exercise each operation above its current buffer budget before replacing
that operation's reader. Do not remove exact-content checks to make a large file fit.

## Bundle: Restore paths run

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **The bucket and Waitron Cloud restores have not been run after Start again's deletion.** Left
  open by A1131bc slice 3.
  [Detail](setup.md#the-bucket-and-waitron-cloud-restores-have-not-been-run-after-start-agains-deletion)
- **Loose ends left by SQLite slice 2 Task 9c (#646, "Restore from my bucket" in the setup
  wizard).**
  [Detail](setup.md#loose-ends-left-by-sqlite-slice-2-task-9c-646-restore-from-my-bucket-in-the-setup-wizard)

## Bundle A1379: A failed setup always offers Start again

6 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1322. A failed setup always offers Start again; remove "Continue with your setup password" (owner, 2026-11-04).**
  Today, once a setup has saved the settings the box sells with, Start again is refused and Continue is the only choice, so a lost password means reinstalling.
  Remove Continue and its password step, and let Start again delete such a setup, still refusing when the database holds an invoice or another record Waitron never deletes.
  This replaces the owner's 16 October order (Continue first). Not yet checked: what else depends on Continue, including its repair of a damaged setup record.
- **The first-setup record store still accepts the `retire` and `select-workspace` actions and
  `nextWorkspace`, which nothing writes since A1042.**
  [Detail](setup.md#the-first-setup-record-store-still-accepts-the-retire-and-select-workspace-actions-and-nextworkspace-which-nothing-writes-since-a1042)
- **The repair page's Start again oddities from #1752** — a stale heading after Start again, two
  "Start again" buttons, and Continue tight against the password field at phone width.
  [Detail](setup.md#the-repair-pages-start-again-oddities-from-1752)
- **The repair page draws a Start-again error twice**, under the password and under the tick box.
  [Detail](setup.md#the-repair-page-draws-a-start-again-error-twice)
- **On a full disk, Start again's summary may need room for a copy of the setup database.** The box
  keeps its spare beside a held setup database, so Start again answers that the disk is full. Left open by A1131 and A1131bc slice 2.
  [Detail](setup.md#on-a-full-disk-start-agains-summary-may-need-room-for-a-copy-of-the-setup-database)
- **No Recover from backup when the setup's own record cannot be read or needs repair.** The only
  way out is a reinstall, unless the setup had saved nothing yet. Left open by A1131bc slice 3.
  [Detail](setup.md#no-recover-from-backup-when-the-setups-own-record-cannot-be-read-or-needs-repair)

## Bundle A1385: The A1207 leftovers in choosing a series name

4 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1223. A stored series pick that turns out taken** (from A1207): an attempt whose chosen name
  is found taken before it finishes is refused (`minute_in_use`), and the person is not offered a
  way on. Start a new attempt by itself, and word the refusal where it shows at activation.
  [Detail](setup.md#a1223-a-stored-series-pick-that-turns-out-taken)
- **A1224. Delete the time floors the series choice no longer reads** (from A1207): they are still
  worked out but nothing in the choice reads them.
  [Detail](setup.md#a1224-delete-the-time-floors-the-series-choice-no-longer-reads)
- **A1226. Compare clocks on the restore page can choose a series name by itself** (from the A1207
  finish-branch review): once a second clock answers, the page's 15-second second-clock check sends
  a real `select` although Make the series was never pressed. Make those re-checks read-only.
  [Detail](setup.md#a1226-compare-clocks-on-the-restore-page-can-choose-a-series-name-by-itself)
- **A Waitron Cloud recovery whose download takes more than 30 seconds may be refused its series
  name.** Measured only on the old recovery from backup, now deleted; the fresh-box Cloud restore
  has not been measured the same way. Left open by A1042.
  [Detail](setup.md#a-waitron-cloud-recovery-whose-download-takes-more-than-30-seconds-may-be-refused-its-series-name)

## Bundle: The key ring after a join

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1285: should the staged reset of a stopped join delete `secrets.env`?** Left open by A947
  slice 3a.
  [Detail](setup.md#a1285-should-the-staged-reset-of-a-stopped-join-delete-secretsenv)
- **A1284: where the environment sets the vault key, a Move or a join leaves a ring that is not the
  one in use.** A joined spare then cannot open its own signing key after a restart. Left open by
  A947 slice 3a.
  [Detail](setup.md#a1284-where-the-environment-sets-the-vault-key-a-move-or-a-join-leaves-a-ring-that-is-not-the-one-in-use)

## Bundle: The recovery page's restart

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1149: a failed restart after Retry or a Move exits the process, and a page that fails to draw
  after a recorded choice answers a bare 500.** Both recovery-page routes. Left open by A1098.
  [Detail](setup.md#a1149-a-failed-restart-after-retry-or-a-move-exits-the-process-and-a-page-that-fails-to-draw-after-a-recorded-choice-answers-a-bare-500)
- **A1153: the recovery page's Retry restarts nothing if the browser disconnects before the answer
  arrives.** Give it the once-only restart the Move got in #2131. Read, not run. Left open by A1098.
  [Detail](setup.md#a1153-the-recovery-pages-retry-restarts-nothing-if-the-browser-disconnects-before-the-answer-arrives)

## Bundle: Setup wizard tidy

5 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **`#onGoto` in `setup-app.ts` keeps `fiscalTestStatus`** — found by #567 while pruning comments.
  Several small wizard leftovers remain.
  [Detail](setup.md#ongoto-in-setup-appts-keeps-fiscalteststatus)
- **The Cloud restore screen shows capture and expiry times as the server's raw ISO text** in both
  languages. Left open by C42 (#837).
- **The setup route `GET /setup-api/venue-defaults` has no production reader** — left open by
  A1315 PR 5, which took setup's only call to it away (`apps/server/src/setup-api.ts`). Retiring it
  means removing the route's two direct cases in `apps/server/src/setup-api.test.ts`.
- **The setup role screen shows its choices as cards with buttons, not `wt-choice-row` rows**
  (`apps/setup/src/screens/role-screen.ts`, reached from Join or recover). Split out of A237.
- **The certificate help page the setup wizard opens writes the browser's warning as “not secure”
  in quotes** (`/setup/trust`, `apps/server/src/trust-page.ts`), where the wizard's first screen
  (#1107) writes Not secure without them. Split out of A237.

## Bundle: File input sweep

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A missing configuration export on the setup wizard's live-source screen gets no red ring.** The
  backup restore screen's file input draws one (A523); `live-source-screen.ts` marks its file input
  `aria-invalid` but has no style for it.
- **File pickers the browser still draws show "Choose File / No file chosen" in the browser's
  language**, not the chooser's. Left: the setup app's certificate, restore, bucket restore and
  live source screens, the dashboard's node recovery panel, and the fiscal first-setup, recovery
  key and offline custodian pages. `wt-file-input` hides that control and draws its own words.

## Bundle: Demo seed language

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **The demo venue's departments' internal names still follow the seed language.** Left open by
  W108 (#1276, the demo venue's names and tax ID come from the country pack).
- **Still open from W109-5's Barcelona look (2026-10-07):** product groups and prep stations
  stay English under Spanish staff-facing dish names (the plan's known limit).

## Decisions and deliberate limits

- **Demo and Preparation need no proof of who owns the box.** Whoever reaches an unconfigured box's
  setup page first can set up either; the owner accepted this when dropping the setup code
  (2026-10-26, B3 design §12.5). A production box offers neither (§12.1; A1384).

- **A reload between the deletion and Reconnect forgets which button was pressed (A1131bc slice 3,
  plan OQ2's default).** The page keeps the choice in memory only, so after a reload it opens its
  first screen, and the person chooses **Join or recover** there to restore.

**DECIDED (owner, 2026-10-29 ~10:38; A1206): Start again keeps no record of the names it
deletes.** The owner: "I think we must remove this concept of storing the used series name on
disk. It introduces too many complications. We use the current minute, with confirmed clock times,
and the latest invoice numbers if we have any." A new installation name is the box's current UTC
minute, taken only after a second clock on another machine agrees within 30 seconds, after setup's
and restore's 90–150 second wait. A1206 leaves the existing "strictly later than every name in the
history the box can still read" check as it was; the owner retired it at ~10:52 the same day ("If
later invoices exist then they are wrong, we should flag them up … but it doesn't stop us from
issuing the correct series based on the current minute, just as long as that minute series doesn't
exist in the database already"); A1207 replaced it (below). The start-again
note, its floor, A1098's Move floor, A1099's damaged-name-record floor and A1131's counting of a
held setup database's names are gone. A leftover note file is ignored; a plain `waitron.sh reset`
deletes it. The trade-off the owner accepts: a name an abandoned attempt used is forgotten once
Start again deletes the attempt, even one AEAT may already have seen. The 90-second wait keeps a
later setup or restore from repeating it while each box's clock is within 30 seconds of the true
time (`packages/fiscal-verifactu/src/hour-selection.test.ts`, "a $action that has forgotten an
earlier attempt's name still names a later minute when each clock was within 30 seconds"); if a box
and the machine that confirms its clock are both wrong by the same amount, the check passes, and
that setup can repeat an earlier attempt's name once its clock is more than about 90 seconds behind
the earlier attempt's. A promotion has no wait
(`settles` in `packages/fiscal-verifactu/src/hour-selection.ts` is setup and restore only), so it
is safe only if it comes long enough after a Start again, up to 120 seconds with each box 30
seconds off; that a promotion comes that late is reasoning about how long joining as a standby
takes, not measured.

**DECIDED (owner, 2026-10-29 ~10:52; A1207): a new installation name needs only that its minute is
not already in use.** The owner: "If later invoices exist then they are wrong, we should flag them
up to be dealt with (how?) but it doesn't stop us from issuing the correct series based on the
current minute, just as long as that minute series doesn't exist in the database already." Setup,
restore and promotion name the box's current UTC minute after the second clock and (setup and
restore) the 90–150 second wait, and refuse it only when a name in a history the box reads already
holds that minute; a later name, a later record, the newest invoice's time and the backup's creation
time no longer refuse or move it. Built with these defaults, open to the owner (A1207 plan, Q2–Q7):
"in use" counts every history the choice read before (the database in hand, the module's own record
of its picks, earlier abandoned attempts of the same setup, the database a restore replaces, the
backup's record of names), exact names only (Q2); a minute in use is skipped as an equal name was
before (Q3). The owner on Q4 (2026-10-30): "If the existing minute is taken then we should just wait
for another minute before checking again. Explain that to the user and show a countdown." So the
box's refusal (reason `minute_in_use`) says how long until the next free minute and when to check
again, and the setup and restore pages say the owner's own words (2026-10-30): "The auto-generated
invoice series code (which is time-based) already exists in the database." and "Generating a new
code in: 52 seconds", count down to it and check again by themselves; a promotion waits up to 150
seconds and is otherwise refused with those values. The owner then chose (2026-10-30) the Spanish
«Se generará un código nuevo en 00:52», the figure as two-digit minutes and seconds ("00:52", "02:30")
in both languages, and that a check the page makes by itself and loses on the network keeps the
countdown going and checks again about every 15 seconds. After a restore of a backup whose invoices are more than a minute later than the box's time,
payments stop until the box's clock catches up or a clock confirmation covers it, as for any clock
more than a minute behind the last sale (Q5); a later name held only in a database a restore
replaces is not in the database the restore places (Q6); a box whose clock went back behind
its own attempt's pick is still refused (Q7). What the owner accepts: later names and invoices no
longer stop anything; a box and the machine confirming its clock, behind by the same amount, name a
minute in the past; and no alert names a later name with no invoices under it or the series names
(A1207 plan, review experiment #7, a promotion only). The owner on Q1 (2026-10-30): "A later series
with no invoices is not a problem. It's only a problem when an invoice is issued. Also, if the box is
running fast and tries to file an invoice 3 days ahead, aeat will return an error code so we will
discover the problem quickly." (the owner's statement; not tested). Later invoices are listed
by `clock.records_misdated` once a clock confirmation lifts the stop
(`apps/server/src/hour-recovery-host.test.ts`, "a restore below the backup's newest invoice names its
minute, a sale is then refused by the clock-behind stop, and a confirmation lists the later sale").

- **DECIDED (owner, 2026-10-28 ~15:25–15:40; A1131bc design revised 2026-10-29, not yet built):
  Recover from backup first wipes the failed setup, then restores.** (2026-10-29, A1206: the
  never-reuse note is retired, so the wipe adds nothing first.) (2026-10-30, A1131bc slice 2: Start
  again's half is built; Recover from backup's is slices 3–4.) (2026-10-31, A1131bc slice 3: Recover
  from backup's half is built; slice 4 deletes the old recovery code.) (2026-11-04, A1131bc slice 4:
  the old recovery code is deleted.) Someone who only
  opens a backup to look has still chosen to discard the setup. Wiping a failed setup needs no proof
  beyond reaching the repair page ("If you have access to the box you can reinstall it"); restoring
  needs the backup's own secrets. The design applies the same rule to Start again, which runs the same
  wipe; the A1098 "files found" page keeps its password, since moving files aside is not that wipe.
- **DECIDED (owner, 2026-10-26): beside a stopped recovery, Start again is offered even when the
  setup database holds records; the page says what is there and what is lost.** (2026-10-29, A1131bc
  slice 1: the confirmation no longer counts what is there; it says what Start again deletes and
  that no invoice was sent.) (2026-10-30, A1131bc slice 2: offered without a stopped recovery and
  without a password.) (2026-11-04, A1131bc slice 4: the setup page no longer reads, shows or
  discards an old recovery from backup, and the old recovery code is deleted.)
- **Built with it, to respect the owner's fiscal stop (A1131 part 1; awaiting the owner's
  confirmation in the PR):** Start again does not go ahead when the database holds an invoice or another
  row Waitron never deletes (said to be a fault), when the setup saved its trading settings, or
  when it finished.
- **DECIDED (owner, 2026-10-29 ~11:00): "Yes. Start again can delete the failed setup dB."** —
  a setup database the box cannot fully read. Built in A1131bc slice 2: damage is SQLite's code 11
  or 26, or a table a reader expects missing; the box still refuses when the readable part shows a
  record Waitron never deletes, and keeps refusing as unsafe a database it may not open or over
  128 MiB, a damaged read beside a `-journal` file, a present database with a hot journal beside it,
  and a damaged `node.db` (plan, D3, N1, N2).

**DECIDED (owner, 2026-10-26 ~15:45; built as A1130): a renewal from the open backup recovery page
extends the recovery session's 15 minutes.** The page renews every 30 seconds while it is open
(`apps/setup/src/first-setup-backup-session.ts`), so the session that holds the decrypted backup key
can stay alive with no time limit while the open page's renewals keep reaching the box. The owner
accepted that cost so that someone still filling in the recovery form at minute 15 is not told the
recovery stopped. Without renewals or steps, the session still ends after 15 minutes
(`apps/server/src/first-setup-backup-lease.test.ts`). (2026-11-04, A1131bc slice 4: the setup page no
longer reads, shows, renews or discards an old recovery from backup, and
`first-setup-backup-session.ts` is deleted.) (2026-11-04, A1131bc slice 4: that page, its session
and `first-setup-backup-lease.test.ts` are deleted; nothing renews a recovery session any more.)

(2026-10-29: superseded by A1206 above — the note is retired; Q1's confirmation records and Q4's
reset rule for them remain.)
**DECIDED (owner, 2026-10-24): neither — Start again deletes the attempt after its empty-database
proof (or, with the database missing, after the person's recorded confirmation) and keeps one small
note of the last series name, which nothing but `waitron.sh reset --all` deletes (A1042).** The
question, left open by A1037, was whether a setup request should stop re-checking every kept
"start again" archive in full, or keep a cache; with no archives kept, there is nothing to re-check.
A box that still holds an archive or a first-setup workspace from an earlier Waitron is refused at
the start (`setup.workspace_unsupported`), and the page asks for Waitron to be reinstalled.

- **The note's file:** `first-setup-start-again.json` in the box's own state folder
  (`packages/provisioning/src/first-setup-start-again-note.ts`). It holds the last series name, the
  earliest moment a later name may be taken, and the module that gave it (2026-10-27, A1099: after
  Start again past a damaged name record it may hold no name, only the time floor). A write only ever replaces
  it with a later moment, and no backup carries it: a restore archive or recovery bundle holding it
  is refused.
- **The floor:** first setup, a restore and a promotion all read the note as a
  time floor (the earliest moment a new name may be taken), so none of them issues a production
  series name before it.
- **Q1:** with the venue database missing, the repair page asks instead of refusing: it says the box
  cannot check whether anything was filed or sold, shows what the attempt's own record says it
  reached, and Start again goes ahead only once the person confirms nothing was; each confirmation
  is kept as a small record in `first-setup-start-again-confirmations/` in the state folder.
- **Q2:** one note per box, whatever the tax number or environment.
- **Q3:** nothing deletes the note in normal operation (a read, a start, Start again, a restore or
  the in-app reset); a reinstall from the USB stick should keep it (a proposed change to B3's
  design) and every node of a venue should hold it (a failover requirement), neither built.
- **Q4:** a plain `waitron.sh reset` keeps the note and the confirmation records; `reset --all`
  removes them.
- **Q5:** A950's upgrade rollback must keep the newer note; an ordinary upgrade never writes it.
- **Q6:** practice setups — Demo, Preparation, Live on a development box, and the readiness test
  run — stay outside the note, as they stay outside every history check.

**DECIDED (owner, 2026-10-25 14:35): an unfinished backup recovery is disposable.** Start again
discards it once it has stopped, keeping its lock files (the `abandoned` tombstone: the recovery's
journal records and its restored copy's lock files stay, and the rest is deleted;
`packages/provisioning/src/first-setup-backup-discard.ts`). With the venue database missing, it does
so after the setup password and the missing-database confirmation; with it present, after the setup
password and the discard confirmation, and only for an empty, never-activated attempt
(`startAgainFirstSetup`, `apps/server/src/first-setup-resolution.ts`). A1042. (2026-10-28, A1131:
a database that holds records goes too, unless it holds a row Waitron never deletes, the setup saved
its trading settings, or it finished.) (2026-10-30, A1131bc slice 2: offered without a stopped
recovery and without a password.) (2026-11-04, A1131bc slice 4: the setup page no longer reads,
shows or discards an old recovery from backup.) (2026-11-04, A1131bc slice 4: no box makes such a
recovery any more; one whose state folder still holds its folder shows the reinstall page.)

**DECIDED (owner, 2026-10-17): setup, and the demo, start only for a country that has a country
pack.** A country without one is not offered at all, so no venue is set up against settings no pack
supplies.

A833 checked this on 2026-10-20 with a saved French-country draft and a provisioning request in
Demo, Preparation and Live. The screen marks the native country control invalid and sends no
venue patch; the request returns `400 setup.request_invalid` naming `country` before setup work.
Run `pnpm --filter @waitron/setup exec vitest run src/screens/venue-screen.test.ts` and
`pnpm --filter @waitron/server exec vitest run src/setup-api.test.ts` for these checks.

**DECIDED (owner, 2026-09-29): the mode screen's certificate note stays as built** (C40, #833) — it
shows only on the path where the wizard skipped the connection question, and the question is not
asked there.

**The wizard has no spacing values of its own — DECIDED (owner, 2026-09-29): leave it.** It
borrows the pop-up's side spacing (`--wt-modal-inline-margin` and `--wt-modal-inline-padding`, in
`apps/setup/src/setup-app.ts`), so a later change to the pop-up's spacing moves the wizard too.

**A country with no demo data of its own gets the existing demo data in English, and every demo's
practice sales go through the venue's own fiscal module (W109-2, Task 2 of the same plan) —
DONE (#1324, 2026-10-07).** A pack's `demo.dataSet` is optional; a pack whose identity names none seeds
`casa-delgado-es` under its own identity, with English the default content language and English
staff names (`demoDataSetFor`, `demoLanguagesFor`, `apps/server/scripts/demo-seed/data-set.ts`).
`seedSales` takes its backend from the composition's fiscal seat (`fiscalSlot(...).makeBackend`)
instead of building `VerifactuBackend` itself; a Spanish demo's practice sales are pinned row for
row by `apps/server/scripts/demo-seed/seed-sales.golden.test.ts`, and a United Kingdom venue's
are ordinary sales with no fiscal record. No real pack reaches the fallback today. Known limits,
not built: practice sales sit at fixed hours chosen for a Madrid business day, stamped with the
host's offset; they carry Spain's VAT rates, as every till sale does whatever the country
(`packages/shared/src/menu-document/vat-rates.ts`); and the guard holds a pack offered for Prepare or Live to
a demo identity too, because the venue screen has one country list for every mode (the plan's
reading of the owner's answer A — the alternative is hiding only the Demo choice). Correction to
the plan's prediction: a fallback demo in an area that requires languages does NOT list them as
missing when the data set carries text in them — the seed writes the set's own text for every
enabled language. Measured on a real database with the real migrations, not as a committed test:
the finish review (2026-10-07) seeded a Barcelona venue with a set that was not Spain's, and got
English default, `en`, `ca` and `es` enabled, every customer name in all three, and no missing
translations; the per-task review's earlier run found `ca` and `es` text written and no missing
translations. The finish review also removed the Catalan text from the
set: the Catalan texts were listed as missing translations, and the seed still completed.

- What A2's rework left as constraints on the next change to the wizard is under [Setup wizard — the
  constraints A2's rework left
  behind](setup.md#setup-wizard--the-constraints-a2s-rework-left-behind-a2).

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
  from the draft (`#onPatch`, `apps/setup/src/setup-app.ts`). The location name is not on that list,
  so a Demo's "Casa Delgado" stays in the draft when the operator switches to Prepare or Live. There
  the location-name field starts filled in but takes its hint, which the filled value hides, and no
  "?", because `#field` (`apps/setup/src/screens/venue-screen.ts`) chooses the "?" by Demo mode alone.
- **Default both series codes to values that survive a cold restore.** A cold restore appends
  `-<installation number>` and `stripOwnSuffixes` would then re-number a trailing `-<digits>`, so
  default to **FS** (factura simplificada — every till sale is `TipoFactura` F2) and **FR**
  (rectificativa). Nothing in the dashboard can change or add a series today.
- **`operation_description` comes from the installed fiscal contribution.** Setup supplies its
  bootstrap value internally. Product sales use the description you save in the **Receipts** tab
  of each department's dialog, or the fiscal module's default description when the department has
  none; the generic location field is not their fallback.

## Open owner call — setup always stores a language on the account

- **Open owner call — setup always stores a language on the account.** If the browser sends no
  language, or one Waitron does not ship, the account gets the venue's language saved as though
  chosen — so the stored value cannot tell "chose Spanish" from "said nothing", and it does not
  follow a later change to the venue default. Keep this, or store a language only when the browser
  asked for one? Since C42 a language picked in the wizard is sent as the provision's
  `Accept-Language`, so a choice made there is stored like any other browser answer.

## The configuration preview names what it will copy by database table

**Left open by C42 (#837):**

- _The configuration preview names what it will copy by database table_ (`products`,
  `menu_item_variant_overrides`, `print_agents`…) in both languages
  (`apps/setup/src/screens/configuration-preview-screen.ts`). The names come from each module's
  `configuration-transfer.ts` list; about fifty can arrive. Give them operator words, grouped, or
  keep the table names.

## The certificate export help has never been followed on a real machine

**Still open after #334:**

- _The certificate export help has never been followed on a real machine._ Nobody exported a
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

- _Switching setup mode does not clean up what the server already holds._ #334 clears the browser's
  own record that a certificate import was requested, and nothing more. If someone fills in Demo,
  Prepare or Live far enough that the server has stored part of that answer and then switches mode,
  what the server kept is untested — write a test that stages configuration in one mode, switches,
  and asserts what survives.

## The setup app's catch-all redirect was not proven by deleting it

**Still open after #334:**

- _The setup app's catch-all redirect was not proven by deleting it._ Unknown setup addresses go
  to `/` while real files and API routes keep their own responses. The reviews checked this by
  running the route tests and the full server suites, not by removing each exclusion one at a time
  and watching a test fail, and no separate probe confirmed the trading app is untouched by the
  redirect.

## A fiscal test or a provision that answers after the wizard has been removed from the page leaves it stuck when it is put back

**Found while bringing `apps/setup` to the coverage bar (2026-09-23), left unfixed** — each was
seen in a throwaway test, since deleted, and none has a test pinning it:

- _A fiscal test or a provision that answers after the wizard has been removed from the page leaves
  it stuck when it is put back_: the Run button stays on "Running test…", or the screen stays on
  "Provisioning…", with no retry. The connection check releases itself in the same case. The app
  mounts the wizard once and never removes it, so this may be unreachable in use.

## In Demo, a server refusal of a field Demo hides can only be retried unchanged

**Demo gaps on the setup wizard's venue screen, as they stand after C47s (#840), left unfixed** —
each says whether it was seen in a run or only read in the code:

- _In Demo, a server refusal of a field Demo hides can only be retried unchanged._ The shell routes
  a refused `seriesCode`, `rectificativeSeriesCode` or `operationDescription` back to the venue
  screen whatever the mode (`apps/setup/src/setup-app.ts`, the venue case of the refusal routing).
  The refusal's sentence shows above Next and pressing Next moves on to the review screen, which
  sends the same series codes and description again, so the operator has nothing to change if the
  server refused them. The venue screen's half is pinned by the `shows a Demo refusal of the hidden
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

**A venue's time zone must come from its country pack's list (A166, owner 2026-10-01) — OPEN.** The
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
existing venue retains its saved zone (`applyPreparedLocation`,
`apps/server/src/configuration-transfer.ts`); importing venue details is a creation concern,
not an edit through that applicator.

## Remaining "?" buttons that should be hints (A237, owner 2026-10-03)

**Remaining "?" buttons that should be hints (A237, owner 2026-10-03) — OPEN.** The rule — a short
explanation is the field's hint, and the "?" button is only for one too long for a hint or a field
that starts filled in — was applied to the setup wizard's first four screens only, and nothing
enforces it. Candidates still showing a "?" for a short explanation: every field on
`apps/setup/src/screens/connect-screen.ts` (strings `connect.*.help` in
`apps/setup/src/i18n/strings/start.ts`), and the backup file and the recovery key on the backup
restore screen (`restore.backup_file_help` and `restore.recovery_key_help` in
`apps/setup/src/i18n/strings/restore.ts`). The dashboard's "?" buttons, Department and Starting zone on the device profile form among them,
are help-mode badges since A582's slice 2b, which settles A237's dashboard half (A582
design §7). The connect screen fills its fields in again from the
earlier request when the operator comes back to it, which is the rule's "starts filled in"
exception, so each of its fields needs a judgement rather than a straight swap. Other screens' "?"
buttons were not reviewed against the rule. A243 removed every "?" button from the setup review
screen. Separately, the role screen
(`apps/setup/src/screens/role-screen.ts`), reached from Join or recover, still shows its choices as
cards with buttons rather than `wt-choice-row` rows. The certificate help page the setup wizard opens
(`/setup/trust`, drawn by `apps/server/src/trust-page.ts`) still writes the browser's warning as
“not secure” in quotes, where the wizard's first screen (#1107) now writes Not secure without them.

## No test covers the setup review screen's value cell's own centring

Left open: no test covers the value cell's own centring (`align-self: center` on the value in
`review-screen.ts`) — removing it alone leaves all 31 review-screen tests green, because it changes
nothing until a label is taller than its value (a label wrapping onto two lines). The test that
used to cover it was deleted on the owner's answer to the W33 question; the certificate-row test
covers only the label's centring.

## The demo data carries Catalan and Galician text (W109-3, #1321, Task 3 of the same plan) — DONE; the text is UNCHECKED by a speaker (owner decision 4, 2026-10-06) — OPEN

**The demo data carries Catalan and Galician text (W109-3, #1321, Task 3 of the same plan) — DONE; the
text is UNCHECKED by a speaker (owner decision 4, 2026-10-06) — OPEN.** Every customer-facing text
in `casa-delgado-es` (`apps/server/scripts/demo-seed/menu.ts`, `seed-adjustments.ts`,
`data-sets/casa-delgado-es.ts`) has a Catalan and a Galician value, written by Claude; nothing
wrote them until Task 4 (W109-4), which now does in the areas that use them. The PR carries the side-by-side table. A speaker of each should
read it; the drafter was least sure of the Galician "Charcutaría", "Lombo embuchado", "Ventrecha de
bonito", "Luras á romana", "Polbo á feira", "Café só", "Tortilla de patacas" and the doneness
choices, and the Catalan "Salsitxó", "Llom embotit", "Filet al whisky", "Error en marcar" and
"Invitació de l'encarregat".

## A guided tutorial for Demo and Preparation (A250, owner 2026-10-03)

**A guided tutorial for Demo and Preparation (A250, owner 2026-10-03) — OPEN, partly designed, not
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

- **Android/iOS on-device install and trust rows** — real phones on the shop WiFi, the owner's to
  run. The name-constrained CA does NOT protect a personal Android phone (measured 2026-09-08); BYOD
  Android either accepts broad trust in the box CA or uses the public-certificate path — an owner
  call before go-live.

## The till's "This device hasn't trusted the till yet" page has never been seen on a real device

- **The till's "This device hasn't trusted the till yet" page has never been seen on a real
  device.** `isTrustBroken` (`apps/till/src/trust-check.ts`) reads a `SecurityError` from
  registering the non-existent `/sw-probe.js` as "certificate not trusted"; that signal is still a
  belief, never checked on a device that clicked past the browser's warning. It runs only on pages
  served over HTTPS. Two gaps remain: the signal is trustworthy only while the server answers the
  probe with 404, which the box's `mountSpa` does; and no test covers the HTTPS default, because a
  browser test page cannot be served over HTTPS. **Next action:** during the on-device trust rows
  above, click past the certificate warning on one device and confirm the page appears in the
  browser's preferred supported language, falling back to English when none is supported.

## A fresh Demo venue opens its dashboard on a red tax-filing alert

- **A fresh Demo venue opens its dashboard on a red tax-filing alert.** Seen on a box image during
  A680, 2026-10-14: a Demo set up through the wizard showed "473 fiscal record(s) have been waiting
  705h to reach the tax agency" (`fiscal.submission_delayed`). The 473 records are the demo seed's
  back-dated sales, and a Demo venue sends nothing to the tax agency. A Preparation venue set up the
  same way had no fiscal records and no fiscal alert. The alert is raised in
  `packages/fiscal-verifactu/src/submission-alerts.ts`; why it fires for Demo was not traced.

## Loose ends left by A496 (moving to a new tax ID).

- **Loose ends left by A496 (moving to a new tax ID).**
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

- **Loose ends left by SQLite slice 2 Task 9c (#646, "Restore from my bucket" in the setup
  wizard).**
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

## Loose ends left by A680 (#1718).

- **Loose ends left by A680 (#1718).**
  - The setup wizard has no text for `sif.throwaway_allocation_refused`. A box started with
    `WAITRON_ENV=production` still offers Demo and Preparation
    (`apps/setup/src/screens/mode-screen.ts` shows only a production warning), and either one is
    refused with that code, so the operator sees the wizard's generic failure (its plan's D6).
  - Demo and Preparation can be set up by anyone who reaches the setup wizard first, as before
    #1700. Neither needs a supplied allocation since A680, so on a shared network a stranger can
    set up an unconfigured box in either mode before its owner does. Only a preproduction venue can
    come of it (its plan's unsure point 2).
  - The throwaway-allocation seat names a Spanish term in a country-neutral contract:
    `ModuleProvisioning.throwawayAllocation.prepare` takes `taxpayerNif`
    (`packages/module/src/provisioning.ts`); finish-branch's convention review asked for `taxId`.
    Left as is because the English-only guard allows "NIF" and lane E's A679 was given this exact
    shape, so a rename changes both. Owner's call.
  - The route tests in `apps/server/src/setup-throwaway.route.test.ts` are named after its plan's
    table ("cell 1" … "cell 14"), which goes when plans are deleted at go-live, and the file does
    not follow its siblings' `setup-api.<topic>.test.ts` pattern. Rename both to describe the
    behaviour.
  - Whether a throwaway venue can get an offline recovery pack is untested. #1717's recovery pack
    checks the allocation's recipient venue; a reviewer read that a throwaway venue would probably
    be refused one, which fits a practice-only venue, but nothing ran it.

## Loose ends left by #334.

- **Loose ends left by #334.**
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

## Loose ends left by C47s (#840): Demo gaps on the setup wizard's venue screen, left unfixed.

- **Loose ends left by C47s (#840): Demo gaps on the setup wizard's venue screen, left unfixed.**
  - In Demo, a server refusal of a field Demo hides can only be retried unchanged. Whether the
    server ever refuses Demo's fixed series codes is not established.
    [Detail](#in-demo-a-server-refusal-of-a-field-demo-hides-can-only-be-retried-unchanged)
  - In Demo, a local check that fails only on a field Demo hides. All of this was read in the code,
    not run; whether a real draft can reach that state has not been tested.
    [Detail](#in-demo-a-local-check-that-fails-only-on-a-field-demo-hides)

## Move the start-again note whenever a series name is put into use, and when a plain reset ends an unfinished setup

Left open by A1042 (owner, 2026-10-25: point 1 answered A). Today only Start again writes the
start-again note (`first-setup-start-again.json` in the state folder, the floor below which no new
invoice series name is taken). Wanted: the note also moves when setup's fiscal step finishes, when
a restore finishes, at a re-registration and at a promotion — designed so the name chooser never
refuses its own request. Written at the moment a path picks its name, the note would make the
chooser refuse that same request's pick until the next minute starts: it re-takes the request's
existing pick (`packages/fiscal-verifactu/src/hour-selection.ts:326-328`) and refuses
`minute_not_later` while the clock is before any recorded time floor (`:409-416`); A1042's
round-4 reviewer ran the real chooser and saw exactly that. Also wanted: a plain `waitron.sh
reset` raises the note from an unfinished setup's chosen name before it deletes that setup. Until
then a reset during an unfinished first setup forgets the series name that setup chose, and only
the box's clock check guards it (`deploy/README.md`, "Resetting a box"). The failover requirement
that every node holds the current note
([replication-cloud.md](replication-cloud.md#replication-membership--failover--residuals-afterwards))
depends on this.

## Starting a backup recovery and giving it up blocks Start again for good

Left open by A1042 (owner, 2026-10-25: point 5 answered B). Start again is refused while any
backup-recovery journal from the repair page's Recover from backup (A731) exists; with the venue database missing, the page
warns of this under Recover from backup. The journal A731 writes when a backup is prepared
(`first-setup-resolutions/backup-recovery/` in the box's folders) is never deleted; its restore target holds a
`venue.lock`, which must never be unlinked (`packages/store/src/venue-lock.ts`); and A731 refuses
any other backup into that recovery with `setup.attempt_conflict`, run on 2026-10-25 (A1042 plan,
"Task 0 results", (m)). So a person who starts a recovery and gives up can only finish a recovery
with that same backup, or have Waitron reinstalled. A way out needs A731 to learn an abandoned
recovery that its entry treats as absent while the folder and its lock stay.

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

## A damaged kept recovery-key record on a box whose database is present: Start again refuses and the page offers no way out

Left open by A1042 (S7l). With the venue database present, the kept recovery-key record
(`first-fiscal-documents/<module>.recovery.json` in the state folder) is what allows a Start again
without the setup password, so a damaged one makes Start again refuse `setup.not_ready`
(`apps/server/src/first-setup-unused-assignment.ts`; rows in
`apps/server/src/first-setup-unused-pdf.test.ts` pin the refusal), and the page offers nothing
else to do. With the database missing, A1042 fixed the same damage: the page says the record is
damaged and Start again goes ahead once the person confirms. Waiting for the owner.

## Decisions and deliberate limits

**DECIDED (owner, 2026-10-24): neither — Start again deletes the attempt after its empty-database
proof (or, with the database missing, after the person's recorded confirmation) and keeps one small
note of the last series name, which nothing but `waitron.sh reset --all` deletes (A1042).** The
question, left open by A1037, was whether a setup request should stop re-checking every kept
"start again" archive in full, or keep a cache; with no archives kept, there is nothing to re-check.
A box that still holds an archive or a first-setup workspace from an earlier Waitron is refused at
the start (`setup.workspace_unsupported`), and the page asks for Waitron to be reinstalled.

- **The note's file:** `first-setup-start-again.json` in the box's own state folder
  (`packages/provisioning/src/first-setup-start-again-note.ts`). It holds the last series name, the
  earliest moment a later name may be taken, and the module that gave it. A write only ever replaces
  it with a later moment, and no backup carries it: a restore archive or recovery bundle holding it
  is refused.
- **The floor:** first setup, a restore, a re-registration and a promotion all read the note as a
  time floor (the earliest moment a new name may be taken), so none of them issues a production
  series name at or before it.
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
(`packages/catalogue/src/vat-rates.ts`); and the guard holds a pack offered for Prepare or Live to
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

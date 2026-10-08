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
  (`apps/server/src/setup-api.ts`); the done screen treats a non-network status refusal as ready, so an HTTP 503
  can announce "The server is ready" early (A324 synthetic 503 probe through the real
  `SetupApi`, 2026-10-07; the polling rule is unchanged); the mode screen's own text says a live
  server files real invoices, which a live run on a development box does not; `setup-app.test.ts`
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
- **`operation_description` is a Veri\*Factu field, not a country fact.** It defaults from the fiscal
  contribution and is editable after setup on the dashboard's Venue settings **Receipts** tab (its location
  section), applying to records filed from then on and leaving already-filed records alone.

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

## A draft carrying a country with no venue-setup pack

**Found while bringing `apps/setup` to the coverage bar (2026-09-23), left unfixed** — each was
seen in a throwaway test, since deleted, and none has a test pinning it:

- _A draft carrying a country with no venue-setup pack_ (a configuration import can bring one) shows
  Spain in the country select while the screen holds the other value, so "Check the country." sits
  beside what looks like a valid choice.

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

## In Demo with a draft country that has no venue-setup pack

**Demo gaps on the setup wizard's venue screen, as they stand after C47s (#840), left unfixed** —
each says whether it was seen in a run or only read in the code:

- _In Demo with a draft country that has no venue-setup pack_, the screen says from the start that
  Demo's invoice settings have not loaded, even when they have (the unknown country names no filing
  module to take a description from), and Next only moves focus to that sentence. When the draft
  carries an operation description but no tax ID, a press puts "Enter the tax ID. Choose one or two
  invoice languages." above Next, ahead of the generic sentence — two fields Demo does not show.
  _(C113, #1014: the language sentence now reads "Choose the receipt language."; this case was
  not run again.)_ Seen in a throwaway test on 2026-09-29, since deleted; nothing pins it.

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
pack marks the Canary tax territory unsupported.) Slice 3b's station opening hours ignore hours
when the zone cannot be read, as a last defence
([plan](../superpowers/plans/2026-10-01-station-hours-fallbacks-slice-3b.md), S8).
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
`apps/setup/src/i18n/strings/restore.ts`). The connect screen fills its fields in again from the
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

## Decisions and deliberate limits

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

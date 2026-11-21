# FULL-INVOICE-ISSUER-ADDRESS PR 2: the registered address in parts, and the A4 header line

Status: plan, revised once after a fresh reader. Branch `feat/registered-address-parts`, worktree
`~/workspace/worktrees/waitron-feat-registered-address-parts`, on `main` at `0b1c8e3850` (PR 1, #3910, landed).
Every line number below was read at that commit. Background: `~/waitron-campaign-l/questions.md`, from
"WATCHER-NEEDED: FULL-INVOICE-ISSUER-ADDRESS" (2026-11-20 22:50) to "WATCHER 2026-11-21 09:35".

## Outcome

- Setup asks for the business's registered address as separate fields: street, line 2, postcode, city and
  province. Street, postcode and city are required, and the postcode gets the country's own check. A **Same as
  the venue's address** switch is on by default; while it is on, the fields are hidden and the venue's address
  is used. The **Change registered address** window in Venue details asks the same way. The server repeats the
  check.
- The parts are joined into the one line already stored (`taxpayer.taxpayer_domicile`). There is no table
  change, no migration and no venue reset. Invoices already issued keep their own copy: `packages/core/src/record-sale.ts:322`
  copies the line onto the sale, and `apps/server/src/invoice-document.ts:125` prints the sale's copy.
- **A4 full invoices** show the registered address, the phone and the email on one line. Simplified A4 invoices do
  not change.
- **Receipt paper changes in one way only.** A registered address that matches the venue's address no longer prints a second time,
  as "Domicilio fiscal: …", under the venue's lines.
- Task 1 looks for what put "2º 1ª" where the street belongs.
- **For the owner, and in the guide:** correct the venue's own address first. On the box, its line 1 is also
  "2º 1ª", and **Same as the venue's address** copies it. Line 1 and line 2 can still be changed after sales
  (`apps/server/src/venue-details.ts:167-168`).

## What the code says today (receipts for Task 1)

- **The address search cannot have done it in production.** Setup mounts the venue screen with no address
  provider (`apps/setup/src/setup-app.ts:2859-2865`). Without one, `wt-address-lookup` hides itself
  (`packages/ui/src/components/wt-address-lookup.ts:114`, `:145`). Only tests set `addressProvider`. Its line
  order is already pinned: line 1 takes `lines[0]` (`venue-screen.ts:555-563`, pinned by
  `venue-screen.address-lookup.test.ts:124-142` and `:151-156`), and the registered address keeps the provider's
  order (`:260-273`). No new search test is needed.
- **That leaves Chrome's own autofill, and its hints changed after the box was set up.** Until #3923
  (`058ac7e805`, landed 2026-11-21 03:40), every setup text field said `autocomplete="off"`. Now the venue's address
  fields share `section-venue …` (`venue-screen.ts:76-91`), and the registered address stays `off` (`:80`). I
  assume the box was set up before #3923, because its invoices were printed on 20 November; that is not checked.
  #3923's description records one review measurement (Playwright Chromium 158, CDP `Autofill.trigger`, a supplied
  address): with hints but no shared section, a fill from Street "put the second address line into the
  registered-address field". Nobody has measured the all-`off` form.
- `SEARCH_FILLS` (`venue-screen.ts:109-116`) is not an autofill hint. It says which search fills which field.

## What to reuse

- `composeRecipientAddress` (`packages/country-packs/src/recipient-address.ts:34-37`) joins as "street, postcode
  city, province", as PR 1's `oneLineAddress` does (`chosen-address.ts:27-32`).
- Its split, `recipientAddressFields` (`:41-60`), **cannot be reused as it is.** It takes the last comma part as
  the province. I ran it on `"Rúa Real 1, 15001 A Coruña, Coruña, A"` and it returned street
  `"Rúa Real 1, 15001 A Coruña"`, postcode `""`, city `"Coruña"`, province `"A"`, which passes its own
  joins-back check (`:59`). Spain's pack has four province names with a comma: "Balears, Illes", "Coruña, A",
  "Rioja, La" and "Palmas, Las" (`packages/country-es/src/spain.ts:117`, `:125`, `:136`, `:145`, in the list at
  `:110-163`).
- The postcode check is `pack.postalCode.validate` (`spain.ts:360`), with `findAdministrativeAreaByPostalCode` as
  the venue fields use it (`venue-screen.ts:505-525`, `:640-691`), and `areaOfChosenAddress` (`chosen-address.ts:11-25`).
- Primitives: the venue's own address fields (`venue-screen.ts:916-946`), `wt-switch`
  (`docs/developers/design-system.md:912`), and the domicile search (`venue-screen.ts:893`).
- PR 1's shared dialog: `taxpayer-field-dialog.ts:62` onwards (save, the "changed elsewhere" refusal, draft scope,
  unsaved changes) and its route's `check` hook (`apps/server/src/venue-settings-api.ts:278`, `:292-293`; the
  registered route is at `:337-342`). The panel mounts the dialog with the model (`venue-details-panel.ts:863`;
  the model's shape is in `apps/dashboard/src/api/client.ts:168`).
- A4 is the receipt builder run with `surface: "a4"` (`apps/server/src/invoice-page.ts:124-125`). It wraps long
  lines (`:63`). The header is built at `apps/server/src/receipt-document.ts:264-273`.

## Joining and splitting (Task 2)

- **Join:** `street[, line 2], postcode city[, province]`, leaving blank parts out.
- **Split:**
  1. Trim the line.
  2. If the line ends with `, <province name>`, using the pack's `administrativeAreas[].name` and the longest name
     that matches, and the comma part before it starts with a postcode that passes the pack's check, take that
     name as the province.
  3. The last remaining part is "postcode city" only when its first word passes the postcode check.
  4. Everything before it goes into **Street**, and **Line 2** stays empty. A street often holds a comma ("Carrer de
     Mallorca, 123"), so the line cannot say where line 2 begins.
  5. If joining the parts would not give back the trimmed line, or no postcode is found, put the whole line in
     **Street** and leave the rest empty. The box's "2º 1ª" opens this way: postcode and city are marked only once
     Save or Next is pressed.
  6. A split that leaves the province empty fills it from the postcode where the pack can.
- **The province guard is not optional.** A plain match at the end would read the "Madrid" of
  "Calle X 1, 28013 Madrid" as the province.
- **Opening never changes what is stored.** A split joins back to the trimmed saved line, plus a province filled from the postcode, which the form shows.
- **The switch, on opening:** it is on only when the saved line, split and joined again, equals the venue's
  address joined the same way.

## Tasks

Each task: write the failing test first and watch it fail, then make the change. Run the focused tests only. Every brief
includes `pnpm exec prettier --check <changed files>`. An implementer past about 150 tool calls stops at a green or
cleanly failing point, commits, and hands over.

**Task 1: put the owner's case through Chrome's autofill** (setup).
1. Add a setup browser command in `apps/setup/vitest.config.ts` (`:43`), beside `emulateColorScheme`. It opens a
   CDP session from the Playwright page, finds the backend node of the `wt-input`'s inner input (`DOM.getDocument`,
   piercing shadow roots), and calls `Autofill.trigger`. Put a case in `venue-screen.test.ts` beside the autocomplete
   map (`:1723-1768`). It fills from Street, then from the registered-address field, using both shapes Chrome
   may have stored:
   - (a) separate lines: "Carrer de Mallorca 123" / "2º 1ª" / 08010 / Barcelona;
   - (b) one street of two lines: "Carrer de Mallorca 123\n2º 1ª".

   Assert every field's value. **Write down the failure first:** "2º 1ª" in `addressLine1` or
   `taxpayerDomicile`. The control: if the first field filled stays empty, the command does not work and the run
   proves nothing.
2. Run it on this branch, and at `058ac7e805^` in a throwaway worktree (`git worktree add --detach`, `pnpm install`,
   then remove it). Write the field-by-field results to
   `~/waitron-campaign-l/receipts/registered-address/task1-autofill.md`.
3. **If one of them misfills,** fix that path with a test that fails before the fix. If only the old code
   misfills, the committed case is the regression test, and you say what #3923 already fixed.
4. **If neither misfills, the cause is not shown.** Say so in the report: the lane will ask the owner how the form
   was filled. Ship no autofill fix, keep the probe case only if it is green and asserts something, and carry on
   with Task 2. If `Autofill.trigger` cannot fill inside the test browser, keep the probe as a script that is not
   committed and record that in the receipt.

Command: `pnpm --filter @waitron/setup exec vitest run src/screens/venue-screen.test.ts`.

**Task 2: join, split and check** (`packages/country-packs`). Add `src/registered-address.ts`, exported from
`src/index.ts`, with:
- `joinRegisteredAddress(parts)`;
- `registeredAddressParts(line, pack)`, as described in the joining section above;
- `registeredAddressErrors(parts, pack)`: street, postcode and city required; the postcode passes the pack's check;
  a province, when given, matches the postcode.

`oneLineAddress` joins through it. Make the till's `recipientAddressFields` (`recipient-address.ts:41-60`) use the
same province-aware split, because its Coruña result is wrong (see "What to reuse").

Tests in `src/registered-address.test.ts`:
- the four comma provinces, and "Rúa Real 1, 15001 A Coruña, Coruña, A", which must give street "Rúa Real 1",
  postcode 15001, city "A Coruña", province "Coruña, A";
- a street with a comma, an empty line 2, a province equal to the city ("…, 08010 Barcelona, Barcelona"), a
  postcode starting with 0, and leading or trailing spaces (which join back trimmed);
- "Calle X 1, 28013 Madrid", which gives no province from the line and province Madrid from the postcode;
- the box's "2º 1ª", which goes whole into Street.

`recipient-address.test.ts` gains the Coruña case, and its existing assertions stay.
Command: `pnpm --filter @waitron/country-packs exec vitest run src/registered-address.test.ts src/chosen-address.test.ts src/recipient-address.test.ts`, plus
`pnpm --filter @waitron/till exec vitest run src/widgets/invoice-recipient-dialog.test.ts`.

**Task 3: the server repeats the check** (`apps/server`). Setup (`setup-api.ts:646`, outside Demo, and
`setup-first-fiscal-api.ts:419`) and the edit route (a `check` on `venue-settings-api.ts:337-342`) split the line
with `registeredAddressParts` in the business's country and refuse it with `registeredAddressErrors`:
- setup: `setup.request_invalid` with field `taxpayerDomicile`, as today;
- the route: `venue.detail_invalid` with reason `incomplete`, or `postcode` for a postcode that fails the check.

The check is not added to the command-line setup (`packages/provisioning/src/cli.ts:205`) or to configuration import
beyond setup. Several tests now send a line the check refuses:
- The shared setup fixture "Mayor 1, Madrid" (`apps/server/test/first-fiscal.ts:24`,
  `packages/provisioning/test/first-setup-request.ts:4`, `apps/setup/test/first-setup-browser.ts:6`) becomes
  "Mayor 1, 28013 Madrid, Madrid". The tests that assert the old text change to the new text, assertion for
  assertion: `first-fiscal-hour-refusals.e2e`, `first-fiscal-document-download.e2e`, `first-fiscal-launch`,
  `receipt-ticket` and `receipt-preview-api` (their `.test.ts` files). Run the provisioning tests that use it too.
- `venue-registered-address-api.test.ts` sends "Calle Mayor 1" in about eight places (`:70`, `:79`, `:130`,
  `:143`, `:154`, among others). Give those a complete address and keep every assertion. Add refusal cases: no
  postcode, a bad postcode, and the box's "2º 1ª".

Command: `pnpm --filter @waitron/server exec vitest run src/venue-registered-address-api.test.ts src/setup-api.test.ts src/setup-api.country-pack.test.ts src/setup-api.throwaway.test.ts src/setup-email-provision.test.ts src/first-fiscal-launch.test.ts src/first-fiscal-hour-refusals.e2e.test.ts src/first-fiscal-document-download.e2e.test.ts src/receipt-ticket.test.ts src/receipt-preview-api.test.ts`.

**Task 4a: the setup form** (`apps/setup/src/screens/venue-screen.ts`, `src/setup-app.ts`, `src/i18n/strings/venue.ts`).
- Replace the one `taxpayerDomicile` input (`:893`) with the switch (on by default) and the five parts. While the
  switch is on, Next sends the venue's fields joined. While it is off, Next sends the parts joined (`:739`).
- The required list (`:138-152`) and `#invalidFields` (`:640-691`) cover the parts only while the switch is off.
- The parts and the switch live in the browser draft, kept and stripped before sending the way `demoVenueNameSource`
  is (`setup-app.ts:177`, `:203`), so Back keeps line 2. A draft that holds only a line (an import, or an older
  draft) is seeded through the split (`:457`).
- Wording, English and Spanish: "Same as the venue's address" / "Igual que la dirección del local".

Tests that must change, each keeping what it checks:
- `venue-screen.test.ts:951-955`: type the parts with the switch off, and assert the exact line sent.
- `:723-725`: the server's mark now lands on Street.
- `:1359`/`:1382` and `:1692`: these hold `ZZ` lines with no postcode. Each one becomes parts.
- `:90` and `:128`, and `setup-app.test.ts:776` and `:794`: these seed "… 28013 Madrid" or "… 28001 Madrid" with no
  province. Give the fixture its province, so the exact line sent is still asserted.
- Add one case where a line with no province gains it from the postcode.
- `setup-app-venue.unsaved-changes.test.ts` (2 mentions) and `setup-app.test.ts:802`, `:856` and `:3871`.

Command: `pnpm --filter @waitron/setup exec vitest run src/screens/venue-screen.test.ts src/setup-app.test.ts src/setup-app-venue.unsaved-changes.test.ts src/setup-app-first-fiscal.test.ts src/screens/review-screen.test.ts src/server-fields.test.ts`.

**Task 4b: setup's search, hints and refusals.**
- The domicile search (`venue-screen.ts:550-552`) fills the registered parts and turns the switch off.
  `venue-screen.address-lookup.test.ts:218-226`, `:260-273` and `:275-281` assert parts in place of one line.
- The parts take their own hints (`section-registered address-line1`, and so on). The whole map in `:1751-1765`
  gains these keys and loses `taxpayerDomicile`, still with `toEqual`, and the Task 1 probe asserts that a fill from
  the venue's Street leaves them empty.
- A server refusal naming `taxpayerDomicile` (`src/server-fields.ts:65`) marks Street while the parts are shown, and
  appears in the bottom message while the switch is on.
- `venue-screen.a11y.test.ts` covers the switch on and off, in both themes.

Command: as for 4a, plus `src/screens/venue-screen.address-lookup.test.ts src/screens/venue-screen.a11y.test.ts`.

**Task 4c: the dashboard edit, its fields** (`registered-address-dialog.ts`, `taxpayer-field-dialog.ts`, `src/i18n/strings.ts`).
- The shared base gains two hooks that subclasses can override: one draws the fields, the other gives the value they
  make. The legal-name dialog keeps the base's single field.
- The registered dialog draws the parts, pre-filled through the split. The draft scope compares joined lines, so an
  edit that ends on the same line keeps Save quiet. It shows the server's `incomplete` and `postcode` refusals
  beside the right fields.
- Rewrite the 22 cases in `registered-address-dialog.test.ts` (`:93`-`:543`) to the parts, each keeping its
  assertion:
  - `:266` checks a saved line with spaces at either end or another Unicode spelling. It now asserts that the
    parts show the trimmed split, that Save is quiet, and that the stored spelling is still sent as `expected`.
  - `:118` and `:136` check the pre-fill.
  - Add one for the box: "2º 1ª" opens in Street with the other parts empty, and Save marks postcode and city.
- `registered-address-dialog.unsaved.test.ts` (5 cases, `:76`-`:135`) types into parts.

Command: `pnpm --filter @waitron/dashboard exec vitest run src/screens/registered-address-dialog.test.ts src/screens/registered-address-dialog.unsaved.test.ts src/screens/legal-name-dialog.test.ts src/screens/venue-details-panel.test.ts`.

**Task 4d: the dashboard edit, the switch and the search.**
- The switch joins `model.details`, and is set on opening as described in the joining section above.
- A search choice (`taxpayer-field-dialog.ts:182`) fills the parts and turns the switch off. The cases at `:478`,
  `:492`, `:508`, `:520`, `:528` and `:543` assert parts.
- `registered-address-dialog.a11y.test.ts` covers the switch on and off and a refused postcode, in both themes.
- The dialog's note says that the switch copies the venue's address when you save, and does not follow later changes to it.

Command: as for 4c, plus `src/screens/registered-address-dialog.a11y.test.ts`.

**Task 5: the A4 line and the duplicate on paper** (`apps/server/src/receipt-document.ts`).
- When `surface === "a4"` and the invoice is a full one (`!simplified`, `:268`), one centred text element holds
  the registered address, `Tel. <phone>` and the email, joined with " · ". Simplified A4 invoices and the thermal
  layout keep their separate lines. The `part()` ranges drive only the thermal preview marks
  (`receipt-ticket.ts:189`, `receipt-preview-api.ts:98`).
- On paper, `sameAddress` (`:134-141`) also takes the venue's address joined by `joinRegisteredAddress`. That line
  comes from `receipt-presentation.ts:62-64`, which reads the venue. A registered address equal to it prints once.
  This is needed because `addressLines` (`venue-address.ts:16-29`) leaves out a province that names the city.
- Tests:
  - Add a thermal case: a Barcelona venue whose province is its city, registered as "…, 08010 Barcelona,
    Barcelona", prints the address once with no "Domicilio fiscal:" line.
  - The cases at `receipt-document.test.ts:487-503` (case, commas and spacing ignored; one real character
    different prints both) stay green, unedited.
  - Add an A4 case for a full invoice and one for a simplified invoice.
  - `:207-232` ("keeps filed domicile separate…"): on A4, assert that the merged line equals
    `"Filed domicile · Tel. 910000000 · venue@example.test"` (the fixture's trim, `testing/full-invoice-fixture.ts:61-66`),
    in place of `endsWith("Filed domicile")`. Thermal keeps `endsWith`.
  - The "A4 current optional source matrix" (`invoice-document.test.ts:614`) still asserts "Saved domicile" and
    passes unedited.
  - `invoice-pdf.test.ts:324` and `:1160` step through 0 to 3 header lines to reach a page-break band. If the merged
    line moves that band, change the inputs, never the assertion.

Command: `pnpm --filter @waitron/server exec vitest run src/receipt-document.test.ts src/invoice-document.test.ts src/invoice-pdf.test.ts src/invoice-page-print.test.ts src/invoice-raster.test.ts src/receipt-preview-api.test.ts`.

**Task 6: docs, guards, look.**
- `design-system.md` → Forms (addresses).
- The guard comment in `scripts/address-lookup-forms.test.ts`, if what it finds changes.
- The guide's paragraph (`apps/server/src/guide/en/table-service.md:139-142`, Spanish at `es/table-service.md:150`)
  gains one sentence, in both languages, saying to correct the venue's address first if you use **Same as the venue's
  address**.
- `docs/developers/conventions-data.md`, if it describes the line.

## Guards (Task 6)

`pnpm exec vitest run scripts/native-form-fields.test.ts scripts/address-lookup-forms.test.ts scripts/english-only.test.ts scripts/guide-links.test.ts`,
`pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, and the golden huella:
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts inmutabilidad`. The last must
pass unedited. Read each run's `Tests` count.

## Look pass

Run `wa-wt onboarding <name>` for setup and `wa-wt demo <name>` for Venue details, on Claude's slots only. Check:
- the switch on and off;
- a refused postcode;
- the box's "2º 1ª" pre-fill;
- a Coruña address;

in light and dark themes, at 1280px and at 375px. For the A4 page and the receipt paper, write the PDF and the
receipt preview from a focused test that is not committed, and open them. Screenshots go to
`~/waitron-campaign-l/receipts/registered-address/` and are never committed.

## Decisions

Set by the coordinator on 2026-11-21, after the fresh reader:
- Street, postcode and city are required, and the province is not.
- The paper duplicate is fixed in this PR.
- The parts live in the setup draft.
- The server repeats the check for setup and the edit route.
- The one-line A4 header is for full invoices only.
- The split recognises comma provinces.
- Task 1 has a stated branch for "cause not shown".
- Task 4 is split into 4a–4d.

Lane L's own decisions, open to the watcher:
- **L1:** the joined line keeps the province even when it names the city, as `oneLineAddress` and the watcher's
  example "2º 1ª, 08010 Barcelona, Barcelona" do.
- **L2:** line 2 is never split back out of a saved line. It goes into Street.
- **L3:** a split with no province fills it from the postcode, so a line saved without a province gains one the
  next time it is saved.
- **L4:** the switch copies the venue's address when you save. A later change to the venue's address does not update
  the registered address, because nothing stores the switch.
- **L5:** the split matches the pack's province names only, not aliases such as "A Coruña", because an alias can also
  be a city name.
- **L6:** the till's `recipientAddressFields` takes the same province-aware split, because its Coruña result is
  wrong today.
- **L7:** the command-line setup and configuration import beyond setup do not get the server check.
- **L8:** the setup switch stays in the Business section, and its hint says the venue's address is asked for below.
- **L9:** the registered parts get their own autofill section rather than `off`. Task 1 measures this.

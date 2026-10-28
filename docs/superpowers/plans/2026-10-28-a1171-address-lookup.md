# A1171 — Address suggestions wherever an address is asked for (parts 1 and 2)

**Status:** design note and build plan, 2026-10-28, lane B. Owner's ask (2026-10-28 ~11:10–11:18):
"we should use address auto complete if enabled"; "Wherever we ask for an address we should use
auto complete when enabled". Part 3 (the till's invoice recipient dialog) waits for lane E's A963
(PR #2145), which rebuilds that dialog; it is not in this plan.

## Design note

### What exists

- `AddressAutocompleteProvider` (`packages/country/src/country.ts:169`) — `suggest({ query,
  countryCode, sessionToken })` returning `{ id, label, secondaryLabel? }[]`, and `resolve({
  suggestionId, sessionToken })` returning `{ lines, locality, administrativeAreaCode?, postalCode,
  countryCode }`. Nothing implements it and nothing reads it.
- Waitron Cloud's proposed address suggestions (`waitron-cloud`
  `docs/superpowers/specs/2026-10-16-address-suggestions.md`, PROPOSED, not approved for release)
  sit behind a Cloud login, a monthly allowance and a whole-address confirmation, with provider
  attribution beside the list. Its own words: "Suggestions never silently replace your fields",
  "Preserve manually entered units and other manual fields unless the person explicitly chooses
  their replacement", and "unknown or foreign country, conflicting province or unsupported fiscal
  area cannot become an accepted complete draft".
- The postal-address forms today (grep for `addressLine1`/`postalCode` in non-test app screens,
  2026-10-28): the setup app's venue screen (`apps/setup/src/screens/venue-screen.ts`) — its
  venue address fields and, outside Demo, the one-line registered business address
  (`taxpayerDomicile`) — the dashboard's Venue card (`apps/dashboard/src/screens/venue-details-panel.ts`), and the till's
  invoice recipient dialog (`apps/till/src/widgets/invoice-recipient-dialog.ts`, part 3).

### Decisions

1. **"Enabled" is the provider's presence.** A form shows suggestions only when it is handed an
   object with `suggest` and `resolve`; with none, the form is exactly today's manual fields. No
   setting is added: nothing could turn one on (no provider exists), and when the Cloud bridge
   lands, the thing that knows whether lookup is approved for this venue is the bridge itself — it
   hands the form a provider or does not. Each form takes it as an `addressProvider` property that
   its app does not set today; tests set a fake.
2. **The shared piece is a search field, not the whole address block — a departure from the
   brief's "one shared address field", flagged to the owner.** `wt-address-lookup`
   (`packages/ui`) is one text field that suggests addresses as the person types and, when one is
   chosen, sends `wt-address-chosen` with the resolved address. Each form copies that address into
   its own existing fields, which keep their labels, checks, locked rows and server refusals. A
   block that drew every address field would have to take over three different layouts — the
   dashboard's locked rows and province list from the server, the setup screen's postcode-driven
   province and demo name, the till's single address string and the registered business
   address's single line — for no gain. So the rule is worded as built: an address form offers
   `wt-address-lookup` above its address fields.
3. **The field hides itself without a provider** (`hidden`, so a form can always render it and the
   rule "an address form offers the shared field" can be checked by text).
4. **Choosing a suggestion is the explicit choice; nothing is saved by it.** The form's fields are
   filled and stay editable; the form's own Save or Next is the confirmation. Address line 2 is
   replaced only when the chosen address has a second line (lines after the second are joined
   onto it with ", ") — otherwise the person's own line 2 (a floor, a unit) is kept, as the Cloud
   design asks ("Preserve manually entered units"); they can clear it.
5. **A chosen address in another country is refused, not copied — a departure from the brief's
   "fills … country", flagged to the owner; the Cloud design asks for the same ("matching
   `countryCode: ES`").** The form asks for suggestions
   in its own country (setup: the country chosen above; dashboard: the venue's country). An answer
   naming another country fills nothing and the form says so under the search field.
6. **Setup: province comes from the chosen address's area code** — the pack's own code (Spain:
   INE numbers such as `"28"`; a bridge translates a provider's own codes), matched with
   `findAdministrativeArea`, which also takes names and aliases. With no code, or one the pack does
   not know, it comes from the postcode exactly as typing the postcode does today. The area code
   wins when the two disagree; the existing checks then mark postcode and province invalid and
   Next stays disabled. The follow-ups of a province change (the demo name, the receipt-language
   default, the fiscal-territory line) run as for a chosen province.
7. **Dashboard: the province is never filled — the server always locks it**
   (`apps/server/src/venue-details.ts:148`). The search field shows while line 1, line 2,
   postcode and city are all editable. A chosen address whose area code names another province
   (matched against the server's `provinces` by code, or by name ignoring accents, case and spacing
   but not a province's other names, which the server's list does not carry) is refused like another country;
   with no area code, or one the list does not name, the four fields are filled and the server's existing postcode check
   (`venue-details.ts:224-231`) refuses a postcode outside the saved province.
8. **No credential reaches the browser** — the field only calls the object it is handed. Nothing in
   this plan talks to Cloud.
9. **The field's typing is not form data.** Its `input` events stop at its shadow root (no ancestor
   in either app listens for them today; drafts change through `scope.changed()`), and it sends no
   `wt-change`. Enter in the field never reaches a form's Enter-to-submit (`submitOnEnter` stands
   down on a handled key); Escape on an open list stops there, on a closed one it passes on.
11. **A late answer lands nowhere.** The field drops a resolve answer once it is disconnected or a
    newer search began, or once its provider, country or disabled state changes. Both forms drop a
    chosen address still on its way once the person edits a field it would fill; the dashboard also
    drops it when a save begins or the leave-page question's discard keeps the edit open.
10. **The seam is not changed now.** `packages/country/src/country.ts` is in lane E's open #2145, so
    `@waitron/ui` declares the shape it needs (`AddressLookupProvider`, structurally the same as
    `AddressAutocompleteProvider`), and a type test in the setup app holds the two compatible. What
    the Cloud bridge will need from the seam (attribution beside the list, a confirm call at Save,
    a per-account allowance message, disclosing a province inferred from a postcode, and the Cloud
    design's server-created session token in place of the field's own) goes to the backlog for
    that bridge.

### Behaviour of `wt-address-lookup`

- Properties: `provider`, `countryCode`, `label`, `placeholder`, `noResultsLabel`,
  `unavailableLabel`, `message` (a form's own line, e.g. the other-country refusal), `name`, `disabled`,
  `delay` (300 ms).
- Asks after the person stops typing for 300 ms and the trimmed text has at least 3 characters; a
  shorter text closes the list. An answer to an older text is dropped.
- One session token (a random 128-bit hex string from `getRandomValues`; `randomUUID` needs a
  secure context) per search, renewed after each choice.
- The list sits under the field in the page flow (no popover). Up/Down move the active row, Enter
  chooses it, Escape closes the list, a click chooses. ARIA combobox: the input has
  `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`; the list is a
  `listbox` of `option`s.
- No suggestions → `noResultsLabel`; a refused `suggest` or `resolve` → `unavailableLabel`; both in
  one `role="status"` line under the field, with `message` when the form sets one, hidden once a
  new search is typed until the next choice or a new message.
- On a choice: `resolve`, then `wt-address-chosen` (`bubbles`, `composed`, `detail: { address }`),
  and the search text is cleared.

## Build plan

Inline trial item (lane B, `trial: inline`): the runner writes each task test-first. LIGHT path: no
risk trigger (no fiscal record, no migration, no grant, no route; the saved values go through the
existing checks and routes).

### Task 1 — `wt-address-lookup` primitive (`packages/ui`)

Files: `packages/ui/src/components/wt-address-lookup.ts`, `.test.ts`, `.a11y.test.ts`;
`packages/ui/src/index.ts` (export the types); `packages/ui/demo/main.ts` (workbench);
`scripts/native-form-fields.test.ts` (`EXEMPT_FILES` gains the primitive, which draws the native
control).

Tests first (browser): hidden with no provider; asks with the country and a session token after
the pause, not before, and not under 3 characters; drops a stale answer; Down + Enter and a click
both resolve and send `wt-address-chosen` with the resolved address; a new session token after a
choice; no-results and unavailable lines; Escape closes; typing does not send `input` out of the
field; paints from the field tokens and follows `--wt-field-max-width`; a11y in both themes —
closed, open with an active option, a status line, disabled. Run:
`pnpm --filter @waitron/ui exec vitest run src/components/wt-address-lookup` and
`pnpm exec vitest run scripts/native-form-fields.test.ts`.

### Task 2 — setup venue screen

Files: `apps/setup/src/screens/venue-screen.ts` (+ its test file), `apps/setup/src/i18n` strings
(en/es), a type test that `AddressAutocompleteProvider` is assignable to `AddressLookupProvider`.

The search field sits above address line 1 with the chosen country, and a second one above the
registered business address outside Demo, which fills that one line as
"<lines>, <postcode> <city>, <province>". A choice fills line 1, line 2
(when given), postcode, city and province (area code, else postcode), runs the same follow-ups as
typing a postcode (demo name, receipt language default), and marks the draft changed. Another
country: nothing filled, the line says so. Tests first: no provider → no visible search field and
the form unchanged; a choice fills every field and Next sends them; line 2 kept when the address
has one line; province from code and from postcode, code winning a disagreement (both marked);
the demo name and receipt languages follow; the server's refused mark on a filled field clears;
another country refused; a choice marks the draft changed; Enter on an active suggestion does not
press Next; the registered business address filled as one line.

### Task 3 — dashboard Venue card

Files: `apps/dashboard/src/screens/venue-details-panel.ts` (+ test), dashboard strings (en/es).

While editing, with line 1, line 2, postcode and city editable, the search field sits above
address line 1 with the venue's country. A choice fills those four fields through the same path as
typing (errors, warnings, acknowledgement and clock preview behave as for typed values). Tests
first: no provider → no search field; a choice fills and Save sends the patch; a locked postcode
or city → no search field; another country refused; another province refused; Enter on an active
suggestion does not press Save; an answer arriving after Cancel or during a save is dropped.

### Task 4 — rule, guard, docs

- CLAUDE.md §3 (screens) one line; `docs/developers/design-system.md` → Forms contract and the
  primitives table.
- Guard `scripts/address-lookup-forms.test.ts`, weaker than its name: every non-test `.ts` under
  `apps/*/src` whose text holds the string literal `"addressLine1"` or `"streetAddress"` (the
  names the forms' address fields go by) and draws a `<wt-input` or `<wt-textarea` holds
  `<wt-address-lookup`, except `apps/setup/src/setup-app.ts`, which only assembles the draft; the till's recipient dialog is listed as waiting for part 3. It reads
  text: a form naming its fields otherwise (the registered business address, `taxpayerDomicile`)
  is not seen. Proved by deletion.
- `docs/backlog.md`: A1171 entry for what is left — part 3 and the Cloud bridge's needs from the
  seam. No guide page covers venue setup or the Venue card today (`apps/server/src/guide/`), so
  no guide changes.

LOOK: with and without a fake provider (set from a browser test that screenshots the screen),
en/es, light/dark, 1280 and 390 px, both screens.

Plan review (fresh context, 2026-10-28): 1 Critical (the always-locked province), 6 Important,
6 Minor — folded above.

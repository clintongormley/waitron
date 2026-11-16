# SIBLING-REGION-TEXT: a regional request never takes another region's text (lane L)

Status: plan, 2026-11-16. Ask: lane L queue, SIBLING-REGION-TEXT (watcher 2026-11-16 19:04), after lane
H reproduced it (`~/waitron-campaign-h/receipts/language-fallback/review-a.md`, row C9:
`resolveContentText({"es-MX":"MX",fr:"FR"},"es-ES","fr")` returned `"MX"`). Closes the backlog entry
"Language resolution follow-ons" (`docs/backlog/menu.md`), which #3555 left to the invoice owner.

## What a person gets

The shared lookup stops taking another region's text: a name asked for in one region of a language
(Spain's Spanish, `es-ES`) no longer shows text stored only for another region (Mexico's, `es-MX`); it
falls back as the design orders: requested tag → its bare language → the venue default → any stored
text (`docs/superpowers/specs/2026-08-30-localization-fallback-negotiation-design.md:31-33`: "There is
no lateral sibling-region jump (`es-PT` does not detour through `es-ES`)"). Stored snapshots are not
touched.

**On today's sales nothing printed changes** (fresh plan read, 2026-11-16, traced): line names are
frozen in the default language under every receipt key (`defaultLanguageDescriptions`,
`packages/menu/src/default-language-text.ts`, called at `apps/server/src/working-order.ts:1033`),
unit names likewise (`prepareUnitSnapshot`), and content defaults never carry a region, so invoice and
receipt lines are only ever looked up with a region-less default or an exact stored key. The visible
change is on dashboard and till screens (whose interface language is `en-GB` or `es-ES`) reading a
name stored only under another region's code, which the API accepts. `toInvoiceLineDescriptions` is
called only by the demo seed.

## Decisions

1. **A request WITH a region stops at its bare language; a BARE request still takes any region of its
   language.** The design's lookup has no "any region" tier at all, but two real callers need it for a
   bare request: the default-language pass (`contentTranslationGap`,
   `packages/menu/src/content-languages.ts:46`, and every call's second pass) asks for bare `es` and
   must find a map stored under `es-ES`; and receipt snapshots are keyed by full invoice tags
   (`es-ES`, `ca-ES`), so a bare default `ca` must reach `ca-ES`. A bare request taking `es-ES` is not
   a lateral jump: nothing more specific was asked for. "Bare" means the request, written canonically
   (`new Intl.Locale(tag).toString()`), equals its content language code (`contentLanguageCode`), so
   `EN` counts as bare and `ca-ES-valencia` (Valencian's own code) does too. A tag that is not a
   valid locale (the catch branch) is bare when it has no `-`.
2. **The fix is in `resolveContentText` only** (`packages/shared/src/content-languages.ts:102`). Every
   caller reads through it, `resolveEnabledContentText` and `resolveSnapshotText` included; no new
   resolver.
3. **The receipt's `lineName` (`apps/server/src/receipt-document.ts:115`) reads through
   `resolveSnapshotText(descriptions, namesLocale, namesLocale)`** instead of "exact, else the first
   inserted value". The backlog entry names it. `namesLocale` is missing from a line's keys only when
   the receipt language changed after the order was saved, and every key holds the same default-
   language text, so no print changes; the change only decides what such a line prints (the shared order, then the
   alphabetically first non-blank text, never a blank one). The till's own `lineName`
   (`apps/till/src/screens/till-ticket-view.ts:69`) is on-screen, not a document: one line in the PR
   thread, not changed here.

## Changed test checks (owner rule 2026-10-05: noted, not controversial)

Both pin the jump this item removes; each case is renamed for what it now proves.

- `packages/shared/src/content-languages.test.ts` "chooses a deterministic regional variant after
  exact and bare matches": `resolveContentText({ "en-US": "US", "en-AU": "AU", english: "Unrelated",
  fr: "French" }, "en-CA", "fr")` expects `"AU"`; it becomes `"French"` (the default). Its other two
  lines (`en-US` exact, bare `en` before regions) stay.
- `packages/shared/src/menu-document/customer-menu-presentation.test.ts` "reports actual regional
  translation with its actual language" (`es-AR` against `es-ES`/`es-MX`): now returns the staff
  name, "Counter burger", instead of "Hamburguesa de España". Only that test reaches
  `resolveMenuText` with a regional request; every real caller passes a bare content code.

## Task 1 (one implementer, test-first)

1. `packages/shared/src/content-languages.test.ts`: change the case above; add lane H's reproduction
   (`{ "es-MX": "MX", fr: "FR" }`, `es-ES`, default `fr` → `"FR"`, today `"MX"`) through both
   `resolveContentText` and `resolveSnapshotText`. Watch them fail. Add two regression guards that
   pass before and after (say so in the commit): a bare request (`en`, `EN`) still takes `en-AU` when
   no `en` key exists, and lane H's map with default `es` still gives `"MX"` (the default is bare).
2. `packages/menu/src/invoice-descriptions.test.ts`: `toInvoiceLineDescriptions({ "es-MX": "Pan MX",
   fr: "Pain" }, ["es-ES", "fr-FR"], "fr")` gives `{ "es-ES": "Pain", "fr-FR": "Pain" }`. Watch it fail.
3. `apps/server/src/receipt-document.test.ts`: a line whose descriptions are
   `{ "fr-FR": "Pain", "es-ES": "Pan" }` printed with `namesLocale` `en-GB` prints `"Pan"` (the
   alphabetically first non-blank; today it prints the first inserted, `"Pain"`), and a line whose
   first inserted value is blank does not print a blank name. Watch both fail.
4. Implement decision 1 in `resolveContentText` and decision 3 in `lineName`. All three files green.
5. Run the whole `@waitron/shared` and `@waitron/menu` suites (`pnpm --filter @waitron/shared exec
   vitest run`, `pnpm --filter @waitron/menu exec vitest run`) and `pnpm --filter @waitron/server
   exec vitest run src/receipt-document.test.ts src/receipt-language.test.ts
   src/invoice-document.test.ts`. A failure other than the two changed checks is reported, not
   edited, until checked against decision 1.
6. Backlog: delete "Language resolution follow-ons" from `docs/backlog/menu.md` (its section and its
   bundle line); reword the bundle's intro and its index line in `docs/backlog.md` (now one entry, the
   other #379 followups); update the spec index row in `docs/backlog.md` that points at
   "_Language resolution follow-ons_" to whatever the backlog really still holds for that spec (grep
   it; write nothing you have not found).

Size: about 10 production lines, about 40 test lines, about 15 lines of docs removed. No migration, no
schema, no new error code. Fiscal: line descriptions are stored on the sale's lines and printed on
its receipt and invoice copies; they are not sent to AEAT, whose record carries one
`DescripcionOperacion` taken from `input.operationDescription` (`packages/core/src/record-sale.ts:324`).
`packages/fiscal-verifactu` calls none of the three resolvers (git grep), so the golden huella and
`inmutabilidad` are untouched; finish-branch still confirms them unedited.

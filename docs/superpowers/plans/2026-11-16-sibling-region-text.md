# SIBLING-REGION-TEXT: a regional request never takes another region's text (lane L)

Status: plan, 2026-11-16. Ask: lane L queue, SIBLING-REGION-TEXT (watcher 2026-11-16 19:04), after lane
H reproduced it (`~/waitron-campaign-h/receipts/language-fallback/review-a.md`, row C9:
`resolveContentText({"es-MX":"MX",fr:"FR"},"es-ES","fr")` returned `"MX"`). Closes the backlog entry
"Language resolution follow-ons" (`docs/backlog/menu.md`), which #3555 left to the invoice owner.

## What a person gets

An invoice line or receipt line asked for in one region of a language (Spain's Spanish, `es-ES`) no
longer prints text stored only for another region (Mexico's, `es-MX`). It prints the venue's default
language instead, as the design orders: requested tag → its bare language → the venue default → any
stored text (`docs/superpowers/specs/2026-08-30-localization-fallback-negotiation-design.md:31-33`:
"There is no lateral sibling-region jump (`es-PT` does not detour through `es-ES`)"). Stored
snapshots are not touched.

## Decisions

1. **A request WITH a region stops at its bare language; a BARE request still takes any region of its
   language.** The design's lookup has no "any region" tier at all, but two real callers need it for a
   bare request: the default-language pass (`contentTranslationGap`,
   `packages/menu/src/content-languages.ts:46`, and every call's second pass) asks for bare `es` and
   must find a map stored under `es-ES`; and receipt snapshots are keyed by full invoice tags
   (`es-ES`, `ca-ES`), so a bare default `ca` must reach `ca-ES`. A bare request taking `es-ES` is not
   a lateral jump: nothing more specific was asked for. "Bare" means the request, written canonically
   (`new Intl.Locale(tag).toString()`), equals its content language code (`contentLanguageCode`), so
   `EN` counts as bare and `ca-ES-valencia` (Valencian's own code) does too.
2. **The fix is in `resolveContentText` only** (`packages/shared/src/content-languages.ts:102`). Every
   caller reads through it, `resolveEnabledContentText` and `resolveSnapshotText` included; no new
   resolver.
3. **The receipt's `lineName` (`apps/server/src/receipt-document.ts:115`) reads through
   `resolveSnapshotText(descriptions, namesLocale, namesLocale)`** instead of "exact, else the first
   inserted value". The backlog entry names it. On a filed sale the line's keys are the sale's invoice
   locales and `namesLocale` is the first of them, so the exact key answers and the printed text does
   not change; the change only decides what a line missing that key prints (the shared order, then the
   alphabetically first non-blank text, never a blank one). The till's own `lineName`
   (`apps/till/src/screens/till-ticket-view.ts:69`) is on-screen, not a document: one line in the PR
   thread, not changed here.

## Changed test check (owner rule 2026-10-05: noted, not controversial)

`packages/shared/src/content-languages.test.ts` "chooses a deterministic regional variant after exact
and bare matches" pins the jump this item removes: `resolveContentText({ "en-US": "US", "en-AU":
"AU", english: "Unrelated", fr: "French" }, "en-CA", "fr")` expects `"AU"`. It becomes `"French"`
(the default), and the case is renamed for what it now proves. Its other two lines (`en-US` exact,
bare `en` before regions) stay.

## Task 1 (one implementer, test-first)

1. `packages/shared/src/content-languages.test.ts`: change the case above; add a case that a bare
   request (`en`, and `EN`) still takes `en-AU` when no `en` key exists; add lane H's reproduction
   (`{ "es-MX": "MX", fr: "FR" }`, `es-ES`, default `fr` → `"FR"`; default `es` → `"MX"`, because the
   default is bare); one `resolveSnapshotText` case with the same map (`es-ES`, default `fr` → `"FR"`).
   Watch them fail.
2. `packages/menu/src/invoice-descriptions.test.ts`: `toInvoiceLineDescriptions({ "es-MX": "Pan MX",
   fr: "Pain" }, ["es-ES", "fr-FR"], "fr")` gives `{ "es-ES": "Pain", "fr-FR": "Pain" }`. Watch it fail.
3. `apps/server/src/receipt-document.test.ts`: a line whose descriptions are
   `{ "fr-FR": "Pain", "es-ES": "Pan" }` printed with `namesLocale` `en-GB` prints `"Pan"` (the
   alphabetically first non-blank; today it prints the first inserted, `"Pain"`), and a line whose
   first inserted value is blank does not print a blank name. Watch both fail.
4. Implement decision 1 in `resolveContentText` and decision 3 in `lineName`. All three files green.
5. Run: `pnpm --filter @waitron/shared exec vitest run src/content-languages.test.ts`,
   `pnpm --filter @waitron/menu exec vitest run src/invoice-descriptions.test.ts
   src/content-languages.test.ts`, `pnpm --filter @waitron/server exec vitest run
   src/receipt-document.test.ts src/receipt-language.test.ts src/invoice-document.test.ts`, the
   golden huella and `inmutabilidad` (`pnpm --filter @waitron/fiscal-verifactu exec vitest run
   src/write-path.e2e.test.ts inmutabilidad`), unedited. Then `git grep -n "resolveContentText\|
   resolveSnapshotText\|resolveEnabledContentText" -- '*.test.ts'` and run every listed file, since
   a test elsewhere may pin the jump; any that fails is reported, not edited, until checked against
   decision 1.
6. Backlog: delete "Language resolution follow-ons" from `docs/backlog/menu.md` (entry and bundle
   line), and fix the bundle's count in `docs/backlog.md`; if #3555 has not landed, write against
   main's text and expect a rebase.

Size: about 10 production lines, about 40 test lines, about 15 lines of docs removed. No migration, no
schema, no new error code. Fiscal: line descriptions are stored on the sale's lines and printed on
its receipt and invoice copies; they are not sent to AEAT, whose record carries one
`DescripcionOperacion` taken from `input.operationDescription` (`packages/core/src/record-sale.ts:324`).
The golden huella and `inmutabilidad` must still pass unedited.

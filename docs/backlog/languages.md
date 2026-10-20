# Interface languages — detail

The open entries are listed in [the backlog](../backlog.md), under "Interface languages". This file holds
their full text.

## Catalan, Valencian, Galician and Basque — the receipt's words checked, and the whole app in all four (C125, owner 2026-10-02) — PARKED

- **Catalan, Valencian, Galician and Basque — the receipt's words checked, and the whole app in all
  four (C125, owner 2026-10-02) — PARKED by the owner (2026-10-02: "save the full translations for
  much later"); taken out of the campaign queues the same day.** Asked for on C113's question
  ("Land, review words later, and add full translations for catalán, valenciano, and gallego";
  "Receipt + whole app"; Basque: "Treat it like the others"). Nothing was written: the
  `docs/regional-languages` branch holds no commit and no draft. When it is picked up, the first
  step is a spec and plan, ending with the owner's choices:
  - **Receipt:** every fixed word C113 added in Catalan, Galician and Basque checked against an
    official or authoritative source (for example Termcat, the Acadèmia Valenciana de la Llengua,
    the Real Academia Galega or Xunta terminology, Euskaltzaindia or Euskalterm), each with a
    provenance row quoting the source; and Valencian as its own receipt language — which locations
    may or must use it (provinces 03, 12 and 46), what the law requires there, with sources, and
    which printed words differ from Catalan.
  - **Whole app:** the dashboard, the till and setup offered in all four beside English and
    Spanish — how strings are held today and every place that pins the list of interface
    languages (language choosers, `Accept-Language` matching, tests); how translations are
    produced and checked, and what shows when one is missing; whether Valencian is its own
    interface language or a variant; and an order of work that keeps `main` green.

- **Content-language names outside English and Spanish (A419 review, 2026-10-08):** when you add
  these interface languages, give Valencian its own translated display name and check the picker.
  The review probe returned the raw `ca-ES-valencia` code in Galician and the compound
  `Català (Espanya, valencià)` in Catalan from `languageDisplayName`; A419 supplies the English and
  Spanish names. Keep this with the parked interface work.

## The payment slip was left alone

- **The payment slip was left alone.** Its words («JUSTIFICANTE DE PAGO», «Importe»,
  «Cobrado») stay Spanish (`apps/server/src/payment-slip.ts`), and its date and amounts still
  follow `WAITRON_TILL_LOCALE` (`apps/server/src/payment-slip-print.ts`). It is not the
  invoice, but art. 128-1.2.a also covers «els altres documents que hi facin referència o que
  en derivin», so a Catalan venue's slip is arguably covered.

## The translations need a native or official check before go-live

- **The translations need a native or official check before go-live.** Apart from the Catalan
  «Factura» and «Propina», which the Consumer Code and the agency's pages use, no word in the
  table was checked against a terminology source. The owner landed it as is on 2026-10-02
  ("land, review words later"); the follow-up (C125, below) was then parked by the owner on
  2026-10-02 ("save the full translations for much later").

## The till's on-screen ticket writes a Galician or Basque sale's amounts and date the Spanish way

- The till's on-screen ticket writes a Galician or Basque sale's amounts and date the Spanish
  way (`20,00 €`, `5 ago 2026`), while its words are Galician or Basque. Measured 2026-10-02:
  Playwright's Chromium 153 resolved `gl-ES` and `eu-ES` number and date formats to `en-US`,
  and Google Chrome 154 on macOS to `en-GB`, so the screen falls back to the registry's
  `FALLBACK_RECEIPT_LOCALE` for any language the browser cannot format. The printed receipt is
  formatted on the server and keeps the language's own pattern.

## The dashboard's locale lookup reads inherited properties

- **The dashboard's locale lookup reads inherited properties** (A626 review, 2026-10-14).
  `pickLocale` in `packages/dashboard-kit/src/i18n.ts:65-67`, re-exported by the dashboard's
  `i18n/t.ts`, returns a function for `"constructor"` and an object for `"__proto__"`.
  An installed disposable-copy probe asserted both results and the Spanish control
  (`pnpm --filter @waitron/dashboard-kit exec vitest run src/a626-driver-probe.test.ts`,
  1 passed). Whether a real dashboard caller admits those locales is unverified.
  **Next:** check own locale keys, test the English fallback and trace the callers.

## A886. Dashboard wording: "Disabled product", "Menús", and two strings nothing reads

Found while checking the guides for A582 slice 3. One clean-up of the dashboard's strings:

- The image library marks a use by an inactive product "Disabled product" ("Producto
  deshabilitado"; `image.disabled_product`, `packages/media/src/dashboard/strings.ts`, drawn in
  `packages/media/src/dashboard/image-library.ts`), where the product screens say "Archived"
  (`product.archived_badge`).
- The Spanish `product.refusal_menus` is "Menús" and `folders.delete_off_menus` says "menús"
  (`apps/dashboard/src/i18n/strings.ts`), where the neighbouring strings in that file, such as
  `product.off_menus` and `folders.off_menus_unknown`, say "carta". Two strings in
  `packages/venue-service/src/dashboard/strings.ts` say "menús" too: `routing.period_not_on_menus`
  ("No está en los menús de {periods}", drawn by `routing-cell-editor.ts` and
  `routing-grid-model.ts`) and `venue.delete_item_staff_menus` ("Quita {count} ajustes de menús del
  personal").
- `product.disable_warning` and `product.disabled_badge` are declared in English and Spanish, and no
  other file under `apps/` or `packages/` names them (grep, 2026-10-18); the last change to their
  use was A435's first step (#1464, products and variants archived for good). Delete them.

Done when the three are changed and the dashboard's strings tests pass.

## A887. Find a bill's state filter still says "Held" for an order the till now calls parked

Found while checking the guides for A582 slice 3, narrowed in slice 4a. The English guides call an
order set aside on the till a "parked order" (`grep -n "parked order" apps/server/src/guide/en/*.md`:
`modifiers.md` and `products.md`), and since A738 (`d99a9f403`) the till's own button and list say
**Park** and **Parked orders** (`action.hold`, `held.title`, `apps/till/src/i18n/strings.ts:317`,
`:468`), with **Aparcar** and **Pedidos aparcados** in Spanish (`:1928`, `:2070`), so the guides and
Park agree. What is left: Find a bill's state filter (`till-find-bill-screen.ts:42`, `:394`) calls
an open, unpaid order with no table (`apps/server/src/find-bill-bills.ts:83`) **Held** /
**En espera** (`find_page.held`, `strings.ts:525`, `:2125`). Done when that filter uses the till's
word. Not renamed in A582: `strings.ts` was being changed heavily by two other lanes at the time.

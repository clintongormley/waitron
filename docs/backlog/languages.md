# Interface languages — detail

The open entries are listed in [the backlog](../backlog.md), under "Interface languages". This file holds
their full text.

## Catalan, Valencian, Galician and Basque — the receipt's words checked, and the whole app in all four (C125, owner 2026-10-02) — PARKED

- **Catalan, Valencian, Galician and Basque — the receipt's words checked, and the whole app in all
  four (C125, owner 2026-10-02) — PARKED by the owner (2026-10-02: "save the full translations for
  much later"); taken out of the campaign queues the same day.** Asked for on C113's question
  ("Land, review words later, and add full translations for catalán, valenciano, and gallego";
  "Receipt + whole app"; Basque: "Treat it like the others"). When it is picked up, the first step is a spec and plan, ending with the owner's choices:
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

## The translations need a native or official check

- **The translations need a native or official check.** Go live with the current words;
  staff report anything that reads wrong (owner, 2026-10-21). A terminology review remains
  future work, alongside the parked full-interface translations above. This is no longer a
  condition for go-live.

## The till's on-screen ticket writes a Galician or Basque sale's amounts and date the Spanish way

- The till's on-screen ticket writes a Galician or Basque sale's amounts and date the Spanish
  way (`20,00 €`, `5 ago 2026`), while its words are Galician or Basque. The screen falls back
  to the registry's `FALLBACK_RECEIPT_LOCALE` for any language the browser cannot format. The printed receipt is
  formatted on the server and keeps the language's own pattern.

## The dashboard's locale lookup reads inherited properties

`pickLocale` in `packages/dashboard-kit/src/i18n.ts`, re-exported by the dashboard's `i18n/t.ts`,
returns a function for `"constructor"` and an object for `"__proto__"`. `alertMessage` throws
`TypeError` for `"__proto__"`, `"constructor"` and `"toString"` as locales. Whether a real dashboard
caller admits those locales is unverified.

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

## The adjustment-reason and venue delete windows still use older wording

The A1014 retrospective review of A831 (#1974) found two other windows outside A831's prep-station
and staff-role scope. Source checks on 22 October 2026 at `d0f65694f` found:

- `packages/adjustments/src/dashboard/strings.ts:70-74` still uses "Settings removed" and
  "Checking whether this reason can be deleted…"; its Spanish `adjustments.delete_ends`,
  `adjustments.delete_removes` and `adjustments.delete_loading` also differ from the device window.
- `packages/venue-service/src/dashboard/strings.ts:8-12` still uses "Work ended", "Settings removed"
  and "Checking deletion impact…"; the Spanish `venue.delete_*` twins differ too.

Next, compare these windows' three fields with `devices.delete_ends`, `devices.delete_removes` and
`devices.delete_loading` in `apps/dashboard/src/i18n/strings.ts`, and align them in both languages.
Keep the windows' refusal and impact details. A831's prep-station and staff-role fields are covered
separately by `apps/dashboard/src/i18n/delete-dialog-wording.test.ts`; that comparison does not
audit these two windows.

## Future-tense lines outside the delete windows

The Remove-standby explanation (`servers.remove_explanation`, "It will be marked removed…"), the
Spanish variant badge "Se archivará al guardar", and the Spanish PIN reset confirmation
(`person.confirm_reset_pin`, "no podrá usar") whose English is present were left alone by A477
(#1530, delete windows in the present tense).

## A1076. Spanish names the three late flags three ways

- **A1076. Spanish names the three late flags three ways**: the station editor's «En demora»,
  «Retrasado», «Olvidado» (`prep.health.*`), the error's «aviso < atraso < olvido»
  (`prep.threshold_invalid`) and Add station's «Aviso / Atraso / Olvido a partir de (min)»
  (`packages/venue-service/src/dashboard/strings.ts`); English says warm, overdue and forgotten.
  Left open by A756 PR 5.

## Spanish calls the manager role «gerente» in the guide and README, and «Encargado» on screen

- **Spanish calls the manager role «gerente» in the guide and README, and «Encargado» on screen.**
  The dashboard's role name is «Encargado» (`roleName`, `apps/dashboard/src/i18n/domain.ts:11`,
  shown in the **Users** table and filter), and the Appearance guide says **Encargado**
  (`apps/server/src/guide/es/appearance.md`). The Users guide (`apps/server/src/guide/es/staff.md`),
  the data download's README (`apps/server/src/i18n/personal-data-readme.ts`) and four of the
  dashboard's bill-payment strings (`payments.bill.*` in `apps/dashboard/src/i18n/strings.ts`,
  among them «PIN de gerente») say «gerente». Seen by A980 S2c's screenshot pass. Both predate S2c: `git log -S` found
  «Encargado» in `domain.ts` since f3b91c284 (#82, 2026-08-12) and «Como gerente, abre» in
  `es/staff.md` since 0c86aeb87 (#1961, 2026-10-22), both ancestors of the main S2c branched
  from; the README's «gerente» lines came with S2a2 (#2049), and S2c added one more in the
  guide's new admin section. Pick one word and use it everywhere.

## Decisions and deliberate limits

- **Restaurant menus are “carta” in the Spanish dashboard, module, setup and till wording** (owner
  decision 2026-09-29; C55 #858, C56 #901). Account and row-action menus keep “menú”.
  `apps/till/src/i18n/strings.test.ts` fails if a Spanish string in the till's catalogue says
  “menú”; the till's error-code messages and allergen names (`apps/till/src/i18n/codes.ts`,
  `apps/till/src/i18n/allergen-names.ts`) are not scanned.

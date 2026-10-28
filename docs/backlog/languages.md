# Interface languages — detail

The open entries are listed in [the backlog](../backlog.md), under "Interface languages". This file holds
their full text.

## Catalan, Valencian, Galician and Basque — the receipt's words checked, and the whole app in all four (C125, owner 2026-10-02) — PARKED

- **PARKED by the owner (2026-10-02: "save the full translations for
  much later").** Asked for on C113's question
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
  Spanish names.

## The translations need a native or official check

Go live with the current words;
staff report anything that reads wrong (owner, 2026-10-21). A terminology review remains
future work, alongside the parked full-interface translations above. This is no longer a
condition for go-live.

## The till's on-screen ticket writes a Galician or Basque sale's amounts and date the Spanish way

The amounts and date read `20,00 €`, `5 ago 2026`, while its words are Galician or Basque.
The screen falls back to the registry's `FALLBACK_RECEIPT_LOCALE` for any language the browser cannot
format. The printed receipt is formatted on the server and keeps the language's own pattern.

## The dashboard's locale lookup reads inherited properties

`pickLocale` in `packages/dashboard-kit/src/i18n.ts`, re-exported by the dashboard's `i18n/t.ts`,
returns a function for `"constructor"` and an object for `"__proto__"`. `alertMessage` throws
`TypeError` for `"__proto__"`, `"constructor"` and `"toString"` as locales. Whether a real dashboard
caller admits those locales is unverified.

**Next:** check own locale keys, test the English fallback and trace the callers.

## The image library calls an archived variant an "Archived product"

`packages/media/src/dashboard/image-library.ts` (`#usage`) labels every inactive product or variant
use `image.archived_product` ("Archived product", "Producto archivado"). A variant use is inactive
when the variant or its product is archived (`packages/media/src/images.ts`, the `variant` branch of
`usage`), so an archived variant of a product that is not archived is said to be an archived product. The
label predates A886, which only renamed it. Decide whether a variant gets its own label ("Archived
variant", "Variante archivada") and, if so, update the content-and-images guides in both languages.

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

## Spanish calls the manager role «gerente» in the guide and README, and «Encargado» on screen

The dashboard's role name is «Encargado» (`roleName`, `apps/dashboard/src/i18n/domain.ts:11`,
shown in the **Users** table and filter), and the Appearance guide says **Encargado**
(`apps/server/src/guide/es/appearance.md`). The Users guide (`apps/server/src/guide/es/staff.md`),
the data download's README (`apps/server/src/i18n/personal-data-readme.ts`) and four of the
dashboard's bill-payment strings (`payments.bill.*` in `apps/dashboard/src/i18n/strings.ts`,
among them «PIN de gerente») say «gerente». Pick one word and use it everywhere.

## Decisions and deliberate limits

- **Restaurant menus are “carta” in the Spanish dashboard, module, setup and till wording** (owner
  decision 2026-09-29; C55 #858, C56 #901). Account and row-action menus keep “menú”.
  `apps/till/src/i18n/strings.test.ts` fails if a Spanish string in the till's catalogue says
  “menú”; the till's error-code messages and allergen names (`apps/till/src/i18n/codes.ts`,
  `apps/till/src/i18n/allergen-names.ts`) are not scanned. `apps/dashboard/src/i18n/t.test.ts`
  fails if a Spanish string in the dashboard's `strings.ts` says “menú”, except `nav.account_menu`
  and `appearance.colour.surface-raised`, and checks one code message (`product.on_live_menu`), not
  the rest of `codes.ts`, `alert-messages.ts` or `domain.ts`;
  `packages/venue-service/src/dashboard/strings.test.ts` fails if a Spanish string in venue-service's
  dashboard catalogue does; its starter content (`packages/venue-service/src/starter-content.ts`) is
  not scanned. Other modules' catalogues are not scanned.

- **An overdue order is «Con retraso» on every Spanish screen, never «atrasado»** (owner decision
  2026-10-28, A1138). The dashboard overview, the till's pass count, the station fields and the
  till's signal all use it. «Atrasado» stays only where a clock or a backup is behind. Nothing
  scans the catalogues for it.

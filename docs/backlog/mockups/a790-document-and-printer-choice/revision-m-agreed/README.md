# A790 M agreed: one Invoice setting

2026-10-22. Authority: owner **UPDATE EQUIPMENT TOO**, 2026-10-19 about 21:20,
lane F `questions.md`. The [current design](../../../../superpowers/specs/2026-10-19-a790-document-and-printer-choice-design.md)
controls this revision. A–M keep their precise scopes; complete design/plan/build remain
unapproved. Earlier mockups remain historical where conflicting.

Ana starts with Equipment Invoice **Office · A4**, Receipt **Bar receipt**. Her Harbour
profile permits Office and **Terrace belt · Receipt paper** for Invoice. She explicitly
selects Terrace for recorded **F/1042**. A successful selection save changes the same
Equipment Invoice setting, and next new **F/1043** starts there while eligible. Closing
without printing keeps that saved choice. Receipt stays Bar. The example assumes current
eligibility and server designation as a copy. The final **Print a copy on Terrace belt**
still confirms delivery. Choosing/saving prints nothing; pending/submitted work stays fixed.

Green labels mark agreed M. White/surface cards are **proposed UI details**, not product
screenshots. Text outside the cards explains the design. Blue labels identify proposed
save-outcome handling; amber identifies the owner-review boundary. Saving/unknown is
unconfirmed; refusal restores the authoritative prior choice; successful-save/failed-refresh
stays saved with a load failure. Unknown operations require same-identity reconciliation,
including late completion, before competing work. A796 Receipt concurrency is not an
Invoice implementation claim.

## Next owner request

**Do you approve the complete A790 document/printer routing design, including the builder
calls in the current addendum, for implementation planning, while A739's timing, slip
replacement, no-fallback policy and their integration remain separate and require
agreement before dependent build?**

Recommend approval for planning; the alternative is to request specific design changes.
This is a design-review question outside the product UI, not a new approval control in
the app. No answer is inferred. A739's [newer timing revision](../../../../superpowers/specs/2026-10-22-a739-receipt-timing-revision.md)
still leaves A (after settlement), B (on Finish), slip replacement and no-fallback recovery
unapproved. The boards name those limits, without selecting either timing or reproducing
its separate interview. A796 already covers device portable Receipt takeover; the proposed
management-without-pickup boundary is explicit in A790's builder calls. Common F1 delivery
guards and public F1 closure remain required. Overall build approval is still owed.

## Eight static boards

The PNGs below are rendered from the matching native SVGs. Each SVG uses no scripts or external assets,
using the previous revision's geometry style and `packages/ui-core/src/tokens/colors.css`
palette snapshot. Phone boards are 390 px wide; desktop boards are 1280 px wide.

| Language | Theme | Phone SVG                                 | Phone PNG                                     | Desktop SVG                                 | Desktop PNG                                     |
| -------- | ----- | ----------------------------------------- | --------------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| English  | light | [390](invoice-equipment-en-light-390.svg) | [390 PNG](invoice-equipment-en-light-390.png) | [1280](invoice-equipment-en-light-1280.svg) | [1280 PNG](invoice-equipment-en-light-1280.png) |
| English  | dark  | [390](invoice-equipment-en-dark-390.svg)  | [390 PNG](invoice-equipment-en-dark-390.png)  | [1280](invoice-equipment-en-dark-1280.svg)  | [1280 PNG](invoice-equipment-en-dark-1280.png)  |
| Español  | light | [390](invoice-equipment-es-light-390.svg) | [390 PNG](invoice-equipment-es-light-390.png) | [1280](invoice-equipment-es-light-1280.svg) | [1280 PNG](invoice-equipment-es-light-1280.png) |
| Español  | dark  | [390](invoice-equipment-es-dark-390.svg)  | [390 PNG](invoice-equipment-es-dark-390.png)  | [1280](invoice-equipment-es-dark-1280.svg)  | [1280 PNG](invoice-equipment-es-dark-1280.png)  |

Spanish interface examples translate names for readability: **Oficina · A4**, **Cinturón
terraza · Papel de ticket**, **Ticket · Barra**, **Guardado en Equipo**, **Imprimir una
copia en Cinturón terraza**. These are static translated examples, not new product strings.

All eight PNGs were rendered in headless Chromium, checked for native text bounds and
individually inspected. These static drawings provide no runtime, accessibility,
physical-printing or legal evidence. Historical receipts apply only to their earlier assets.

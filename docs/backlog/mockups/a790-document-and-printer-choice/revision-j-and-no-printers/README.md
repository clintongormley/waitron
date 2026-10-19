# A790: explicit choice agreed; no-printer behavior proposed

2026-10-19, after the owner's ~16:18 **“PICK IT MYSELF”** answer to J in
`/Users/clintongormley/waitron-campaign-f/questions.md`.
The [current design addendum](../../../../superpowers/specs/2026-10-19-a790-document-and-printer-choice-design.md)
controls. A–J retain only their precise answered scopes. **K alone is proposed;
the full design, plan and build remain unapproved.**

These eight manually authored SVGs are static design assets with native text/tspans,
no scripts, foreignObject or external resources. Cards show UI; colored labels and notes
outside cards explain the design. Green marks agreed J; amber explicitly marks both
unapproved K alternatives. Printer/venue names remain the worked-example names in Spanish.
Other translated UI wording is proposed copy. Muted Print on a quiet surface represents
disabled Print; the blue named action represents an explicit confirmation still to press.
No runtime semantics, focus, accessibility or product behavior are demonstrated.

## What you compare

1. **J agreed, before selection.** Newly opened device-free dashboard Receipt for Harbour
   `F/1042`, Mar Azul SL, €86.40. Remembered Bar receipt is now disabled. Office · A4 and
   Patio receipt are both active/eligible to Luis, Office first by name. Show **Choose a
   printer** / **Elige una impresora**; neither option is selected and Print is quiet/disabled.
   Office remains valid for Receipt under B. First use follows this rule without the
   previous-printer warning shown for this remembered-Bar example.
2. **J agreed, after Luis explicitly selects Patio.** The inline printer row may fold.
   You still press **Print a copy on Patio receipt** / **Imprimir una copia en Patio receipt**
   when the server designates a copy. Selection changes no memory; acceptance does.
3. **K proposed, recommended.** A different opening of Harbour `F/1042` Receipt has **no
   prior submission**. A successful offers read returns no eligible printers. Keep the
   document form open with **No printers available for this document** / **No hay impresoras
   disponibles para este documento**, **Refresh printers** / **Actualizar impresoras**,
   **Cancel** / **Cancelar**, and quiet disabled Print. Retaining the form lets you retry
   after an administrator restores a printer without losing document context.
4. **K proposed, alternative.** Close the print form and explain on the sale. Cancel/return
   remains available. After restoration, you must reopen Print/reprint. No print occurs.

K's excluded setup is author explanation only: Bar disabled, Office deleted, Patio not
permitted to the current person, Hillside outside the sale venue. **Neither K UI panel
shows inaccessible printer names or details.** Both alternatives preserve remembered
choices and substitute no venue/profile/printer. Add no email, invoice conversion or
Settings permission fallback. Refresh is an explicit offers read, never print or polling;
the drawings claim no existing refresh capability.

After an explicit refresh offers exactly one restored Bar, **explicitly choose then
confirm**. G preselects a sole printer only on a newly opened form with no usable memory;
it does not authorize automatic mid-form selection. J also concerns opening only. No
selection replacement or submitted-request rerouting is authorized. Loading or a failed
read is not a successful empty list. An unanswered submission is outside K and must
reconcile its **same request identity** first; empty offers prove nothing about prior paper.

## Artifacts and completed static checks

Phones are 390 × 1280; desktops are 1280 × 840. Colors are copied from
`packages/ui-core/src/tokens/colors.css`: light/dark bg, surface, border, field-fill,
field-line, text, text-muted, primary, on-primary, success and warning. SVG hex values
are snapshots of those palette tokens, not a proposed runtime styling implementation.

All eight final PNGs were rendered in headless Chromium and individually inspected. Native
SVG text bounds stay within each drawing. The parent aligned confirmation footers with
Cancel on the left and the named action on the right, then re-rendered and inspected all
eight final boards. These are static design checks, not product, accessibility, legal or
physical-paper evidence. Earlier revisions’ inspection statements apply to their own boards.

| Language | Theme | Width | SVG source                                | Rendered PNG                              |
| -------- | ----- | ----- | ----------------------------------------- | ----------------------------------------- |
| English  | Light | 390   | [SVG](choice-and-empty-en-light-390.svg)  | [PNG](choice-and-empty-en-light-390.png)  |
| English  | Dark  | 390   | [SVG](choice-and-empty-en-dark-390.svg)   | [PNG](choice-and-empty-en-dark-390.png)   |
| Spanish  | Light | 390   | [SVG](choice-and-empty-es-light-390.svg)  | [PNG](choice-and-empty-es-light-390.png)  |
| Spanish  | Dark  | 390   | [SVG](choice-and-empty-es-dark-390.svg)   | [PNG](choice-and-empty-es-dark-390.png)   |
| English  | Light | 1280  | [SVG](choice-and-empty-en-light-1280.svg) | [PNG](choice-and-empty-en-light-1280.png) |
| English  | Dark  | 1280  | [SVG](choice-and-empty-en-dark-1280.svg)  | [PNG](choice-and-empty-en-dark-1280.png)  |
| Spanish  | Light | 1280  | [SVG](choice-and-empty-es-light-1280.svg) | [PNG](choice-and-empty-es-light-1280.png) |
| Spanish  | Dark  | 1280  | [SVG](choice-and-empty-es-dark-1280.svg)  | [PNG](choice-and-empty-es-dark-1280.png)  |

## Boundaries retained

A–I remain unchanged: identical recorded invoice/customer details through both document
formats; inline foldable Invoice row and direct simplified Receipt with facts/language
retained. B admits all active sale-venue printers including A4/portable, subject to current
authorization, offers, Orders visibility and accompanying-device restrictions; no profile
step, borrowed till identity or dashboard Equipment update. Browser memory is shared across
logins, separate by venue/document, survives ordinary reopening and is forgotten by clearing
site data. Refusal/cancel-before-submit/empty offers leave memory alone; acceptance changes
it without establishing paper output. Device role lists and the phone's one Equipment receipt
setting remain; [A796 Revision 4](../../../../superpowers/specs/2026-10-19-a796-handheld-payments-design.md)
owns save/concurrency handling and overridable defaults. Do not re-ask A–J/A796.

Freeze sale/document/printer/language/context; recheck authorization and sale location in
the reservation transaction; retain same-identity uncertain/late reconciliation,
successful-write versus failed-refresh, server original/copy, shared F1 delivery guard
and closed public F1. No implicit print or new payment/fiscal/drawer effects. K, technical
storage/expiry/manual reset/errors/private lifecycles, concurrent accepted intents/account
transitions, device Invoice memory, portable receipt holding, wider steps, integration
and full design/plan/build agreement stay open.

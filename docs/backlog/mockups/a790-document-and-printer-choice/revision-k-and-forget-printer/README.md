# A790: empty form agreed; targeted forgetting proposed

2026-10-19, after the owner's ~16:55 **STAY OPEN + REFRESH** answer to K in
`/Users/clintongormley/waitron-campaign-f/questions.md`.
The [latest design addendum](../../../../superpowers/specs/2026-10-19-a790-document-and-printer-choice-design.md)
controls. **A–K retain only their precise answered scopes. L alone is proposed;
the complete design, plan and build remain unapproved.**

These eight compact SVG boards are static design assets. **Cards marked UI show forms or
form details; labels and prose outside cards explain the example.** Green marks agreed K;
amber marks both proposed L alternatives. Quiet muted Print means disabled; the blue named
action still needs an explicit press. UI wording is proposed copy, translated into EN/ES;
printer and venue names remain the example names. No existing implementation is claimed.

## What the boards compare

**K, agreed:** a separate newly opened Harbour F/1042 Receipt form has no prior submission.
A successful offers read finds no eligible printer. Keep the form open with **No printers
available for this document** / **No hay impresoras disponibles para este documento**,
quiet disabled Print, **Refresh printers** / **Actualizar impresoras**, and Cancel/Cancelar.
Refresh is an explicit offers read only, never printing or polling. The UI shows no inaccessible
printer names or details. Loading and failed reads are separate; an unanswered print must
reconcile under its same identity first. Empty offers leave memory alone. If a refresh offers
one printer, require explicit choice and named confirmation; G does not auto-select mid-form.

**L, proposed only:** should the device-free dashboard print form offer targeted **Forget
saved printer**, or leave clearing site data as the only manual way to forget it? Recommend
targeted forgetting so one preference can be cleared without forgetting other document/venue
choices or other site data. It is shared browser preference clearing, not a printer action,
device Equipment change or an administrator permission. Both options retain current offers
and permissions; neither prints by itself.

The L example uses the same normal shared browser. Ana's Harbour **F/1042 Receipt** request
on **Patio receipt** was accepted and completed; **all submissions have known outcomes**.
Harbour Invoice separately remembers **Office · A4**; Hillside Receipt remembers **Hillside
bar**. **Bar receipt** and **Patio receipt** are both active and eligible to Luis.

1. **Recommended targeted Forget, proposed.** The form detail offers **Forget saved printer** /
   **Olvidar impresora guardada**, with Harbour/Receipt/this browser and its shared-login scope
   stated beside it. The next card shows its requested effect: only this preference and the
   open form's printer selection are explicitly cleared. Neither printer is selected; choose
   again, then confirm by name. Harbour Invoice and Hillside remain unchanged, as the prose
   outside the cards explains. G cannot choose automatically mid-form. On the next **newly
   opened** Harbour Receipt form with the same two offers, J requires Choose a printer and
   quiet disabled Print. The last form detail shows Luis after explicitly choosing Bar; he
   still presses **Print a copy on Bar receipt** / **Imprimir una copia en Bar receipt** when
   server-designated. Selection does not remember Bar; only server acceptance does.
2. **Alternative, proposed.** No targeted Forget control. Patio stays remembered until a normal
   accepted replacement or clearing site data (I). Site-data clearing is outside this form,
   not a simple form button; no claim is made about what unrelated site data contains.

L applies only with **no unanswered submitted request**. Forget is local preference clearing,
not print/request cancellation. Never discard pending request identity or imply cancelled
paper. Technical storage, expiry, errors, private/unusual lifecycles and concurrent/late
accepted intents/account transitions remain open; this is one question about targeted
forgetting, not a question about those technical policies.

## Artifacts and completed static checks

SVGs use native text/tspans, without runtime scripts, foreignObject or external resources.
Phones are **390 × 1380**, desktops **1280 × 940**, with desktop columns. Cancel sits at
bottom-left and the named confirmation at bottom-right wherever that footer is drawn.
Colors are snapshots copied from `packages/ui-core/src/tokens/colors.css`: light/dark bg,
surface, border, field-fill, field-fill-disabled, field-line, text, text-muted, primary,
on-primary, success and warning. These literal SVG colors propose no runtime styling.

All eight final PNGs were rendered from the native SVGs inside a plain HTML wrapper in
headless Chromium and individually inspected. Native SVG text bounds stay within each
drawing. These are static design checks, with no runtime, accessibility, legal or
physical-paper evidence. Earlier revisions' receipts apply only to their own artifacts.

| Language | Theme | Width | Source                                    | Rendered PNG                              |
| -------- | ----- | ----- | ----------------------------------------- | ----------------------------------------- |
| English  | Light | 390   | [SVG](empty-and-forget-en-light-390.svg)  | [PNG](empty-and-forget-en-light-390.png)  |
| English  | Light | 1280  | [SVG](empty-and-forget-en-light-1280.svg) | [PNG](empty-and-forget-en-light-1280.png) |
| English  | Dark  | 390   | [SVG](empty-and-forget-en-dark-390.svg)   | [PNG](empty-and-forget-en-dark-390.png)   |
| English  | Dark  | 1280  | [SVG](empty-and-forget-en-dark-1280.svg)  | [PNG](empty-and-forget-en-dark-1280.png)  |
| Spanish  | Light | 390   | [SVG](empty-and-forget-es-light-390.svg)  | [PNG](empty-and-forget-es-light-390.png)  |
| Spanish  | Light | 1280  | [SVG](empty-and-forget-es-light-1280.svg) | [PNG](empty-and-forget-es-light-1280.png) |
| Spanish  | Dark  | 390   | [SVG](empty-and-forget-es-dark-390.svg)   | [PNG](empty-and-forget-es-dark-390.png)   |
| Spanish  | Dark  | 1280  | [SVG](empty-and-forget-es-dark-1280.svg)  | [PNG](empty-and-forget-es-dark-1280.png)  |

## Boundaries retained

A keeps identical recorded full-invoice/customer facts across formats. B includes all active
sale-venue dashboard printers, A4/portable included, subject to authorization/current offers,
Orders visibility and accompanying-device restrictions. No profile step, till identity or
Equipment change. C keeps Invoice inline/foldable; D opens simplified Receipt directly with
facts/language retained, no F1 conversion/email. E/H/I share browser memory across logins,
separate by venue/document, through ordinary reopening; site-data clearing forgets it.
F remembers a chosen printer only on acceptance, which is not paper; refusal, cancel-before-submit
and empty offers preserve it. G concerns only sole eligible/newly opened/no usable memory;
J concerns several eligible/newly opened/no usable memory. Neither replaces a selection
mid-form or reroutes submitted work. Device role lists and the phone's one Equipment receipt
setting remain; A796 Revision 4 owns save/concurrency and overridable defaults. Do not reopen
A–K/A796; Q1–Q6 retain scope subject to A–K, no exclusive Invoice holder check.

Freeze sale/document/printer/language/context under request identity; check authorization
and location at reservation. Reconcile unknown/late outcomes under that same identity before
fresh work. Keep successful-write versus failed-refresh, server original/copy, shared F1
delivery guard and closed public F1. No automatic reroute or extra fiscal/payment/drawer
effects. L, its technical uncertainties, device Invoice memory, portable receipt holding,
wider steps, integration and full design/plan/build stay open.

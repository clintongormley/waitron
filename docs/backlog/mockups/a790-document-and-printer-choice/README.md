# A790: latest dashboard and Equipment decisions, 2026-10-19

**A and B are approved; C is the sole next owner question. The complete design is not
approved for planning or build.** The [latest design addendum](../../../superpowers/specs/2026-10-19-a790-document-and-printer-choice-design.md)
and this brief take precedence over conflicting text and boards below. The entire earlier
README remains verbatim as dated history, including its earlier same-day revision.

- **A:** Receipt and Invoice deliver the same recorded full invoice; Receipt keeps its
  compact customer details. Neither issues a second invoice.
- **B:** without a device profile, dashboard Orders offers **every active printer at the
  sale's venue**, bypassing profile lists. Harbour's `F/1042` offers Harbour equipment even
  with Hillside selected in the dashboard; disabled, deleted and Hillside printers stay
  excluded. No Change profile or dedicated dashboard profile. Include active portable
  printers; receipt-holder enforcement is unresolved, not permission to exclude or reassign
  them. Preselect last use **on this browser**, collapsible; never borrow a till identity
  or read/change its Equipment. Browser storage and fallback details remain proposals.
- **A796 applied:** the phone's receipt dropdown at and after payment is its **one existing
  Equipment receipt-printer setting**, with no separate receipt memory or new storage.
  Ana chooses Terraza for Mesa 4's first share; Mesa 9 offers Terraza and Equipment shows
  Terraza even before a ticket prints. Save/rollback/concurrency handling needs a builder
  proposal and agreement; atomic Equipment/payment changes are not approved.

**C, one decision to ask next:** should Invoice use an inline, collapsible printer selector
in the same form as its named final confirmation, matching Receipt (recommended), or a
separate printer step? Show `F/1042`: Invoice, Office · A4 folded; expand, choose Terrace
belt · Receipt paper, then **Print a copy on Terrace belt** if the server designates a copy.
No invoice-memory storage is approved.

The [new dashboard/Equipment/C boards are available](revision-dashboard-equipment/README.md).
They show three comparisons: Harbour's every-active local list;
Mesa 4/Mesa 9 and Equipment all showing Terraza; and C's inline versus separate invoice
step. Proposed labels are **name · A4** / **name · Receipt paper**, ordered by name then id.
Proposed C details: choose the document first after payment, but keep the already chosen
full invoice in the payment draft; one printer retains its visible name and final press,
zero disables print with an explanation. These details and first-use preselection are
proposals, not extra owner questions. The design explains payment-time confirmation.

Do not silently replace an invalid selected/submitted destination. Request facts stay
fixed under the request key; preserve uncertainty, reconciliation and explicit confirmation.
Authorization, sale location, original/copy and fiscal/public-F1 gates remain required;
selection, loading, folding and Equipment changes never print. D, specific fallback,
storage/persistence and full-design/build agreement remain open.

All original and earlier revision boards are historical where they conflict, including
profile selection, portable-printer exclusion, accepted-print-only receipt memory and a
mandatory extra receipt step. Eight revised PNGs were rendered in headless Chromium and
visually inspected in EN/ES, light/dark, at 390/1280 px. The native SVG text boxes were
measured within the drawings. These static checks supply **no runtime, test or hardware
evidence**. The source map remains historical and unverified.

---

## Historical README retained verbatim from before the dashboard/Equipment revision

# A790: document and printer choice

## Current revision, 2026-10-19

The [design addendum](../../../superpowers/specs/2026-10-19-a790-document-and-printer-choice-design.md)
controls the revised flow. **A is approved:** Receipt prints the same recorded `F/1042`
compact, with its customer details, through the receipt list; Invoice prints that same
invoice through the invoice list, on A4 or receipt paper. Neither issues another invoice.

A796 applies to receipt printing at and after payment: an inline, optionally collapsed
printer dropdown, preselected to the last eligible receipt destination, with no mandatory
second printer step. The same form/action names the printer and confirms the request;
row selection, loading and collapse never print. Exact memory scope and persistence remain
proposed. Device-free dashboard eligibility/memory awaits B; do not import till memory.
Invoice-role inline behavior is recommended but unapproved C because A796's wording names
receipt-role printers. Card-reader memory belongs to A796, outside A790.

**B is the sole current owner question:** for Harbour's sale on a device-free dashboard,
suggest Counter 1's current Counter profile with an eligible-profile change (recommended),
use all eligible Harbour printers, or configure a dedicated dashboard profile. The design
states the conditions and consequences. C/D, persistence and the complete build remain
unapproved; do not ask those questions alongside B.

The [revised receipt-flow boards](revision-2026-10-19/README.md) show collapsed and expanded
equipment in the payment form and a receipt copy after payment. Eight English/Spanish,
light/dark, 390/1280 px PNGs were inspected. These are static drawings, with no product,
accessibility or paper checks. The existing B phone boards below still illustrate the
unapproved dashboard context. The owner settled last use on this device for the handheld
form; finer storage keys and first-use/unavailable-equipment fallback remain proposals.

## Historical brief and original boards

The text below is retained from commit `87f19d4bc98d2fb7925e886228430cabfc490a9b`.
Its “A only” instruction, all-recommendations-unapproved status and any mandatory separate
receipt-printer step are superseded by the addendum. Original A's document alternatives
are historical after approval; B–D remain unapproved alternatives wherever not superseded.
The generation/inspection statements below are historical receipts, not checks rerun for
this revision. Original boards do not demonstrate the revised interaction.

These are static discussion boards for the [design proposal](../../../superpowers/specs/2026-10-19-a790-document-and-printer-choice-design.md). All recommendations await agreement. The source SVGs sit beside their PNGs. The paper samples compare the same recorded invoice number and customer, not the finished fiscal layout.

Start with **A only** when asking the first owner question. B–D are ready for later decisions, and E illustrates proposed status wording. The Spanish words other than the owner's recorded Q1 labels are proposed copy.

| Board                 | Phone, English light                                         | What you compare                                                                                                                                  |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: what Receipt means | [Open PNG](a-full-invoice-document-meaning-en-light-390.png) | Receipt and Invoice route the same full invoice through different lists; one Full invoice choice and a separate payment receipt are alternatives. |
| B: dashboard context  | [Open PNG](b-dashboard-printer-context-en-light-390.png)     | A visible current profile, Change profile, location filtering, and the alternatives of all local printers or a dedicated profile.                 |
| C: choices and skips  | [Open PNG](c-phone-flow-and-skips-en-light-390.png)          | Invoice printers can use A4 or receipt paper. Payment stages the choice; a reprint requires a final named press.                                  |
| D: simplified sale    | [Open PNG](d-simplified-copy-en-light-390.png)               | Receipt only keeps the stored sale, language and guests. One printer keeps a confirmation; zero printers cannot print.                            |
| E: changing state     | [Open PNG](e-changing-state-and-outcomes-en-light-390.png)   | Loading, failed read, removed printer, accepted request with unavailable status, and unknown paper outcome are separate examples.                 |

Each stem has eight PNG/SVG variants: `en` or `es`, `light` or `dark`, `390` or `1280`. For example, [A in Spanish dark](a-full-invoice-document-meaning-es-dark-390.png) and [A on a wide screen](a-full-invoice-document-meaning-en-light-1280.png). Boards use colours read from the product tokens. Their geometry and text wrapping were checked during generation. The eight rendered overview sheets were inspected, alongside standalone phone samples.

These drawings do not exercise the product, transitions, accessibility, printer transport or physical output. The complete design and future implementation must cover those separately. The document describes the two-to-one/zero-printer transitions and original/copy races; these static snapshots do not demonstrate them.

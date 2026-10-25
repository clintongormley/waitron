# A841 slice 9 — the venue's logo on receipts and A4 invoices: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The logo of the theme in use prints, in black dots, at the top of every receipt and A4
invoice that has no department receipt logo of its own — a department with none, and a sale with no
department — while a department's own receipt logo still wins and a department whose receipt
settings cannot be trusted prints no logo at all. The till's ticket view and the department Receipts
tab's preview follow the same rule, and the Look card shows how the logo prints, saying so when it
prints blank.

**Architecture:** Two pull requests (D1). **9a, the paper:** `readPrintedDepartmentReceipt`
(`@waitron/venue-service`, behind the `VENUE_SERVICE` seat) answers `unreadable: true` in the four
"cannot be trusted" cases; `@waitron/layouts` gains one read of the theme in use's logo name and its
stored dots for one paper; a small server module decides, from the department's answer, whether the
venue's logo applies and reads it; the receipt, the A4 invoice, the ticket view and the Receipts
tab's preview call it. **9b, the Look card:** a read-only route draws the draft's logo the way a
receipt printer prints it (the receipt preview's own `drawPreviewLogo`) and counts its black dots; a
dashboard widget under the Logo field shows the picture, its caption and, at zero dots, "This logo
prints blank on receipts." No migration, no configuration format change, no fiscal code.

**Tech Stack:** TypeScript, Hono, drizzle-orm on `node:sqlite`, sharp (through `@waitron/media`),
Lit 3, Vitest 4.1.x (Node for `apps/server`, `packages/layouts`, `packages/venue-service`; real
headless Chromium for `apps/dashboard`), Markdown guides served by `apps/server`.

**Spec:** `docs/superpowers/specs/2026-10-19-a841-theme-editor-design.md` — section 16 item 9
(lines 2590-2594) is the scope. Detail: section 8a's "Receipts and A4 invoices" through "The two
logo entries in the backlog" (lines 1602-1723), the Look card row "Under the logo (Q5 A)" (line
645), section 15's receipts sentence (lines 2441-2453), section 17's receipt risk (lines 2764-2766),
section 18's pictures 23 and 42 (lines 2878, 2896). Earlier plans: slice 7
(`docs/superpowers/plans/2026-10-23-a841-7-logo-stored.md`: where `printedLogo` is stored and kept
current), slice 8 (`2026-10-24-a841-8-logo-screens.md`: the Logo field), slice 10
(`2026-10-24-a841-10-text-size.md`: the shape this plan follows).

**Revision, 2026-10-25,** after the fresh-context review (`~/waitron-campaign/a841-review/plan9-review.md`,
1 HIGH, 2 MEDIUM, 7 LOW) and lane A's rulings (`plan9-rulings.md`): no test updates the append-only
`sale_receipt_headers` — "not in this location" moves the department, and a sale with no department
gets its header when it is made (H1); the preview's "read throws" case renames on the route's second
read (M1); the preview never draws the venue's logo for a department that cannot be trusted, as the
design says (M2, D7); `receipt-print.ts` cites re-read (L1); the unprintable-paper case in A4 and A7
(L2); one decision point, `venueLogoMayPrint` (L3); "How it prints" follows a reframe through a new
`watchMediaImage` in `@waitron/ui` (L4, Task B3, D12); A8 restores its theme (L5); Remove and Use
Waitron's look go through the real save route (L6); B1's staff session, the 58 mm backlog line, and
9b after 9a (L7); who lands 9a is the owner's answer, asked by the controller.

---

## What the landed code already does (receipts, main `0569c71fd`)

- **The department read.** `readPrintedDepartmentReceipt(tx, cfg, departmentId, paperWidth)`
  (`packages/venue-service/src/department-receipts.ts:215-242`) left-joins `department_receipts` on
  the department in this location (`:222-226`), answers `{ receipt: {}, logo: null }` when no
  department row is found (`:227`), parses the trim (`parseReceipt`, `:101-136`, which keeps `logo`
  only when it is text of at most 255 bytes, `stringField("logo", 255)` `:77,40-45`, and a library
  name, `MEDIA_FILENAME` `:122`), answers the paper's picture only when the trim names a logo
  (`:229`), and answers `{ receipt: {}, logo: null }` after any throw, reporting
  `receipt.read_failed` to the scope's diagnostic (`:230-241`). Invalid JSON reads as `{}`
  (`validDocument`, `:34-38`). Its contract is `VenueServiceContribution.readPrintedDepartmentReceipt`
  (`packages/module/src/module.ts:900-905`).
- **Its four non-test callers** (`git grep -n readPrintedDepartmentReceipt -- ':!docs'`, 2026-10-25):
  `apps/server/src/receipt-print.ts:199`, `invoice-document.ts:103`, `receipt-presentation.ts:26`,
  `receipt-preview-api.ts:368`.
- **The receipt.** `buildReceiptBytes` (`apps/server/src/receipt-print.ts:172-230`) reads the sale's
  department (`:193-194`), that department's printed receipt only when there is one (`:196-208`, on
  the printer's paper), then `resolveReceiptTrim(authored, {}, …)` (`:210`) and
  `const logo = department?.logo ?? null` (`:211`). Every optional read reports to a
  `console.warn("receipt.optional_read_failed", event)` diagnostic (`:187-192`).
- **The A4 invoice.** `readInvoiceDocument` (`apps/server/src/invoice-document.ts:31-160`) does the
  same on the 80 mm pictures (`:98-115`, `"80mm"` at `:111`); the page draws the dots centred at the
  top (`invoice-page.ts:208-225`), written to the PDF at `invoice-pdf.ts:31`. Every A4 path —
  `orders-invoice-pdf.ts:23`, `page-print-api.ts:239`, both `boot.ts:1891,1941` readers — goes
  through `readInvoiceDocument`.
- **The ticket view.** `readReceiptPresentation` (`apps/server/src/receipt-presentation.ts:9-62`)
  resolves the trim the same way (`:42-47`), then turns `receiptTrim.logo` into the library image's
  `display` rendition address (`:48-55`, `readPresentations`, `packages/media/src/presentation.ts:49-67`),
  catching a failed read. Every sale answer carries it (`till-sale.ts:887,1050,1680,1857`,
  `bill-payments.ts:789`, `transaction-receipt.ts:138`); the till draws
  `receiptTrim.logoUrl` (`apps/till/src/screens/till-ticket-view.ts:691-698`).
- **The Receipts tab's preview.** `POST /management-api/receipt-preview`
  (`apps/server/src/receipt-preview-api.ts:311-395`) resolves the draft's trim with an empty venue
  (`:348-353`), reads the saved picture only when the draft names the saved logo (`:363-376`), and
  `renderDraftPreview` draws the draft's logo from the saved picture or, failing that, from the
  library image with `drawPreviewLogo` outside the transaction (`:237-259`). With no logo in the
  draft, nothing is drawn (`:242-244`).
- **The shared trim rules.** `resolveReceiptTrim` takes `department?.logo || venue.logo`
  (`packages/shared/src/receipt-text.ts:85`); `receiptLogoSource` answers `"department"`,
  `"venue"` or `null` in the same order (`:65-71`). Both were written for a venue logo and are used
  with `{}` today.
- **The stored dots** (slice 7). A theme with a logo is stored as `{ ...choices, printedLogo }`,
  `printedLogo` being `{ "58mm", "80mm" }` of `{ widthDots, heightDots, data }`
  (`packages/layouts/src/theme-store.ts:83-89`); every choices read strips them inside SQLite
  (`THEME_TEXT`, `:33-36`) and checks the document with `readThemeDocument` (`choicesOf`,
  `:44-52`). `readThemeInUse` (`:121-127`) is what `/api/theme` reads (`apps/server/src/venue-theme.ts:36-48`).
  `receipt-store.ts` holds the paper-picture bound (`storedPicture`, `:42-49`) and the decoder
  (`decodeLogoRaster`/`readLogoRaster`, `:78-103`), both private.
- **Drawing.** `drawLogoRasters` (`apps/server/src/receipt-logo.ts:23-27`) and `drawPreviewLogo`
  (`:66-85`) both dither through the same `drawLogo` (`:13-17`), so a preview drawn on 80 mm is the
  picture a save stores for 80 mm. `createLogoCache` (`:35-54`) keys by rendition address and paper.
- **The Look card's Logo field** (slice 8): `dashboard-theme-logo-field`
  (`apps/dashboard/src/widgets/theme-logo-field.ts:12-129`), rendered in the editor at
  `apps/dashboard/src/screens/look-card.ts:876-886`; the dark-screens fieldset ends at `:124`.
- **Paper in the dashboard.** `print-paper.ts` turns raster blocks into a PNG (`bitmapUrl`,
  `apps/dashboard/src/widgets/print-paper.ts:67-97`, private) and exports `paperGround`, the
  physical black-on-white (`:121-125`).
- **Passive reads.** The dashboard's `background` API sends `x-waitron-live: 1` on GETs
  (`apps/dashboard/src/api/client.ts:2148-2156`, `packages/dashboard-kit/src/request.ts:78`), and
  the server runs those as passive management reads (`apps/server/src/boot.ts:1049-1052`).
- **Theme routes** live in `mountThemesApi` (`apps/server/src/themes-api.ts:108-206`); the list
  read is under `venue.view` (`:122`), which supervisors hold and staff do not
  (`themes-api.test.ts:286-292`).
- **No receipt test has a theme in use.** Of the server's test files, only six name `custom_themes`
  and none of them prints a receipt or reads a ticket (probe P4), and no non-test code but the
  theme store inserts one. So every existing "a department with no logo prints none" assertion runs
  with Waitron's theme in use, which has no logo.

## Decisions this plan makes (the design or the brief left them open)

**D1. Two pull requests, 9a first.** 9a (Tasks A1-A10): the four places that read a department's
receipt settings, `unreadable`, the theme read, and the guide's receipts section. 9b (Tasks B1-B6):
the Look card's "How it prints". **9b lands after 9a**: its guide paragraph links to 9a's
`{#logo-receipts}` section (Task B5), and `guide-content.test.ts` refuses a link to a missing id. In
that order each leaves main working: after 9a paper prints the logo and the card says nothing yet;
9b only adds a read route, a media-image watcher and a widget.

**D2. The shape of `unreadable`.** `@waitron/module` gains, beside the contract,

```ts
/** `unreadable`: the department's receipt settings cannot be trusted, so no logo prints for it, not even the venue's. */
export interface PrintedDepartmentReceipt {
  readonly receipt: DepartmentReceiptConfig;
  readonly logo: ReceiptLogoRaster | null;
  readonly unreadable?: true;
}
```

and `readPrintedDepartmentReceipt` returns it. The key is present only when true, so every existing
whole-shape pin of a trusted answer stays as it is (`toEqual` treats an absent key and `undefined`
alike, but not `false`). The four cases, decided in one select with three more columns:
`row` (the department's own `department_receipts.department_id`, null without a receipt row),
`top` = `case when json_valid(receipt) then json_type(receipt) end`, and `hasLogoKey` =
`case when json_valid(receipt) then json_type(receipt, '$.logo') is not null end` — the guard is
needed: unguarded, `json_type` on `{bad json` raises "malformed JSON" (probe P1).

| Case (design lines 1667-1682) | Test | Answer |
| --- | --- | --- |
| 1. the read throws | the `catch` | `{ receipt: {}, logo: null, unreadable: true }` |
| 2. the stored document is not a JSON object | a receipt row and `top !== "object"` (`{bad json` gives `null`, `null`/`[]`/`42` give `null`/`array`/`integer`, probe P1) | the same |
| 3. a `logo` key with no kept name | `hasLogoKey === 1` and `parseReceipt` kept no `logo` (a number, more than 255 bytes, not a library name, and also `""` or `null`) | `{ receipt: <the fields parseReceipt kept>, logo: null, unreadable: true }` |
| 4. no department in this location | `!row` (`:227`) | `{ receipt: {}, logo: null, unreadable: true }` |
| control: no receipt row | `row === null` | `{ receipt: {}, logo: null }`, as today |
| control: readable, no `logo` key | | as today, no `unreadable` |
| control: a kept logo whose picture is bad | | `{ receipt: { logo, … }, logo: null }`, as today: the department names a logo, so the fallback follows the name and nothing prints |

Case 3 keeps the trim's other readable fields (phone, texts), as today; the design's "beside the
empty receipt" (line 1687) holds for cases 1, 2 and 4, while today case 3 already answers the other
fields (`department-receipts.test.ts:177-196` keeps them for the management read) and no ruling asked
to drop them — only the logo is untrusted. A stored `logo: ""` or `null` counts as case 3 by the
design's rule ("a document with a `logo` key and no kept name", line 1686); no product writer stores
either, since the receipt validator drops `""` and refuses `null`
(`packages/layouts/src/validate.ts:63-66`). Cases 2-4 report no diagnostic, as today.

**D3. Where the theme is read, and by whom.** A new read in `@waitron/layouts`
(`packages/layouts/src/theme-store.ts`), beside `readThemeInUse`:

```ts
export interface PrintedThemeLogo {
  /** The theme in use's light image, as the library names it. */
  readonly name: string;
  /** Its stored dots for the paper; `null` when they cannot be printed on it. */
  readonly picture: MonoRaster | null;
}
export async function readPrintedThemeLogo(tx: Transaction, paperWidth: PaperWidth): Promise<PrintedThemeLogo | null>;
```

One select on `custom_themes` where `in_use = 1` (the column's unique index, `theme-store.ts:91`),
reading `THEME_TEXT` and the one paper's picture (`case when json_valid(theme) then
json_extract(theme, '$.printedLogo."<paper>"') end`, bounded as `storedPicture` bounds it). The
choices go through `choicesOf`, so a theme this release refuses prints no venue logo, as the screens
then show Waitron's (`venue-theme.ts:54`); `null` when none is in use or its `logo` is `null`. The
theme is read **only when the venue's logo can apply** — no department, or a trusted one naming no
logo — so a sale whose department has its own logo, or cannot be trusted, costs no extra query. It is
never read per line. **No new seat:** `@waitron/layouts` is an ordinary dependency, not a module
(it has no `module.ts`; `packages/composition/src/modules.ts` composes no layouts module;
`scripts/module-seams.test.ts:11-15` names it as legitimate), and `apps/server` already reads the
theme through it (`venue-theme.ts:3`). The department side still goes through the `VENUE_SERVICE`
seat, and `@waitron/venue-service` never learns themes exist: the server composes the two.

**D4. One server module decides.** `apps/server/src/receipt-venue-logo.ts`:

```ts
export type ReceiptReadDiagnostic = (event: { operation: string; code: string }) => void;
/** No department, or a trusted one naming no logo of its own. */
export function venueLogoMayPrint(department: PrintedDepartmentReceipt | null): boolean;
/** The theme in use's logo for one paper, or `null`; a failed read reports and answers `null`. */
export async function readVenueLogo(tx: Transaction, paperWidth: PaperWidth, diagnostic: ReceiptReadDiagnostic): Promise<PrintedThemeLogo | null>;
/** What a printed document takes: the venue side for `resolveReceiptTrim`, and the dots to print. */
export async function resolvePrintedLogo(tx: Transaction, department: PrintedDepartmentReceipt | null, paperWidth: PaperWidth, diagnostic: ReceiptReadDiagnostic): Promise<{ venue: VenueReceiptConfig; logo: ReceiptLogoRaster | null }>;
/** The ticket view's venue side: the theme in use's light name, when it may print. */
export async function readVenueLogoName(tx: Transaction, department: PrintedDepartmentReceipt | null, diagnostic: ReceiptReadDiagnostic): Promise<VenueReceiptConfig>;
```

**`resolvePrintedLogo` and `readVenueLogoName` decide only by calling `venueLogoMayPrint`**, with
no branch of their own on `unreadable` or the department's logo; the preview also asks it. `resolvePrintedLogo`: when
`venueLogoMayPrint` says no → `{ venue: {}, logo: department?.logo ?? null }` — a department naming
its own logo prints its picture, or nothing when that picture is bad (the fallback follows the
name), and an untrusted department, whose answer never holds a logo (D2), prints nothing; when it
says yes → the theme's `{ venue: { logo: name }, logo: picture }`, or `{ venue: {}, logo: null }`
without one. Task A5's proof by deletion relies on those two having no branch of their own. A failed theme read reports
`{ operation: "readPrintedThemeLogo", code: "receipt.read_failed" }` (`readVenueLogoName`:
`"readThemeInUse"`) and prints no venue logo; the sale prints, as every other optional read does
(`receipt-print.ts:187-192`). `readVenueLogoName` reads `readThemeInUse` (the ticket view needs the
name, not ~10 KB of dots).

**D5. Which paper's pictures.** The receipt: the printer's paper, as the department's
(`receipt-print.ts:207`). The A4 invoice: `"80mm"`, as the department's (`invoice-document.ts:111`;
design line 1624). The Receipts tab's preview: the paper it draws at (`receipt-preview-api.ts:355-361`).
The Look card: 80 mm, the paper the A4 invoice also uses.

**D6. The ticket view's address.** `readReceiptPresentation` passes `readVenueLogoName`'s answer as
the venue side, so `receiptTrim.logo` is the theme's light name, and the existing lines
(`receipt-presentation.ts:48-55`) turn it into the light image's `display` rendition address,
`/media/renditions/v1/<source>/display/<x>-<y>-<zoom>.webp` — served by the media module's public
rendition route, the same kind of address `/api/theme` serves the screens (`venue-theme.ts:41-47`).
The till changes nothing: it already draws `logoUrl` (`till-ticket-view.ts:691-698`). Never the dark
image (design line 1607).

**D7. The Receipts tab's preview** (design lines 1693-1695 and 1699-1704). When the draft names no
logo, the snapshot transaction also reads `VENUE_SERVICE.readPrintedDepartmentReceipt(tx,
checked.scope, id, printer.paperWidth)` — one select — and asks `venueLogoMayPrint` about the draft
as the department would print it: `{ receipt: checked.input.receipt, logo: null }`, with
`unreadable: true` added when the stored answer carries it. Only when that says yes does it read
`readVenueLogo` for the preview's paper, and `renderDraftPreview` draws that picture where it draws
nothing today. So **a department whose stored settings cannot be trusted never shows the venue's
logo in its preview**, as the design says; a readable department whose draft names no logo shows
the theme's `printedLogo`. A draft that names a logo draws it exactly as today — the saved picture
or its library image (`:363-376`, `:237-259`) — never `printedLogo`. The dashboard learns nothing
new — the server draws the preview — and the Receipts tab gains no words (Left for later). The
preview's `logo` mark (`receipt-preview-api.ts:293`) covers the venue's logo too, so focusing the
Logo field outlines the logo that prints.

**D8. "How it prints": a read route.** `GET /management-api/theme-logo-print?image=<library name>`
in `mountThemesApi`. A GET, so the dashboard's `background` request is passive (automatic reads must
not keep a session alive, CLAUDE.md §3). Permission `venue.view`, the theme list's (a supervisor may
read; staff are refused) — it reads and writes nothing. Errors: `management_session.required` /
`management_session.expired` 401, `authorization.not_permitted` 403 (`{ permission: "venue.view" }`),
`management.request_invalid` 400 `{ field: "image" }` for a missing, repeated or non-library name.
One transaction authorizes and reads `readCurrentImageMetadata`; the drawing runs outside it with
`drawPreviewLogo` on the `display` rendition, through a `LogoCache` the mount owns, exactly as the
preview does (`receipt-preview-api.ts:237-259`). The answer:

```ts
export interface ThemeLogoPrint {
  /** The paper's printable dots across: `safeWidthDots("80mm")`. */
  readonly paperDots: number;
  /** The 80 mm picture, stored form; `null` when the image is gone or will not decode. */
  readonly picture: { readonly widthDots: number; readonly heightDots: number; readonly data: string } | null;
  /** Set dots in `picture`; 0 means the logo prints blank. */
  readonly blackDots: number;
}
```

It draws the draft's image, not the stored `printedLogo`: the draft's logo may be unsaved, and the
same `drawLogo` makes both pictures (`receipt-logo.ts:13-17,25,78`).

**D9. "Prints blank" is zero black dots** in the 80 mm picture. The design measured a white circle
on a see-through background at 0 of 25,600 (line 1632); probe P2 re-ran the real drawing: white 0,
`#f8f8f8` 421, lemon `#f2d300` 2,726, black 16,281 of 25,600. A near-white logo that prints a faint
scatter is not "blank": the picture shows the scatter, which is what prints. Not taken: a threshold,
which would need a number the design never chose.

**D10. The widget.** `dashboard-theme-logo-print` (`apps/dashboard/src/widgets/theme-logo-print.ts`),
rendered by the Logo field after the dark-screens fieldset while there is a logo (picture 23). Its
`image` is the draft's light name, so it asks again when the light image is picked or replaced, never
for a dark-image change, and disappears with Remove. **It also asks again when the image changes
under the same name** — a reframe or a replaced source in the image library the picker embeds — by
watching the key the Logo field's thumbnail already redraws on: the image's `display` presentation
address (`liveMediaImage(this.image, "display")`, `apps/dashboard/src/widgets/image-upload.ts:333`),
which names the source file and framing (`renditionUrl`, `packages/media/src/presentation.ts:10-16`)
and which `packages/ui/src/live-media-image.ts` refreshes on every library edit
(`invalidateMediaImages`, `:152-154`, called by the library's client after a PATCH,
`packages/media/src/dashboard/client.ts:93-98`) and every 15 s (`:48-50`). The directive keeps its
subscription private, so `live-media-image.ts` gains `watchMediaImage` (Task B3), built on the same
`subscribe`; the widget asks again when the watched address changes from one known address to
another, not on its first arrival. It dispatches nothing, so the draft and
`saveActionState` never see it. States: **asking** — the paper box, empty, with `aria-busy="true"`,
and the caption; **shown** — the picture on paper (`paperGround`) drawn a third of its dots wide
(`width: (widthDots / paperDots) * 100%` of a box `calc(var(--wt-space-6) * 6)` wide, 192 px:
Bar Lucía's 480-dot logo draws about 183 px, picture 23's size), `image-rendering: pixelated`, the
caption beside it on a wide card and under it on a phone, and, at zero dots, the blank line;
**no picture** (`picture: null`) — nothing; **failed** — "Could not show how this logo prints." and
**Try again**. An answer for an image the field no longer holds is dropped (a request generation,
CLAUDE.md §4's in-flight rule).

**D11. Nothing more for slice 7's paths.** Printing reads the dots slice 7 keeps current: a save
stores them (`theme-store.ts:83-89`), a library reframe or replaced source redraws them for every
theme naming the image as light (`packages/media/src/image-edits.ts:71-97`), a configuration copy
carries `custom_themes` (`packages/db/src/configuration-transfer.ts:87`) and its import refuses a
logo without printable dots (`packages/layouts/src/theme-configuration.ts:51-64`), and removing the
logo stores no dots (`theme-store.test.ts:572`, "stores no dots without a logo").

**D12. Mutation.** One mutation-tested file changes: `packages/ui/src/live-media-image.ts` gains
`watchMediaImage` (D10, Task B3), so Task B3 runs `pnpm --filter @waitron/ui exec stryker run
--mutate src/live-media-image.ts` and kills every survivor in the new function (a local run prints a
score and gates nothing; the nightly merged `mutation-ui` score does, `docs/developers/ci-and-gates.md:416`).
`ui-core`, `shared`, `fiscal` and `db` are untouched (the trim rules in
`packages/shared/src/receipt-text.ts` already handle a venue logo). If a task finds it must change
another mutation-tested file, it stops and reports.

**D13. Fiscal code is untouched.** No file under `packages/fiscal`, `packages/fiscal-verifactu` or
`packages/core` changes; `computeHuella`, the chain, invoice numbering, `registros_facturacion` and
the alta builders are not read or written by any change here — the logo is a picture on the printed
copy. The change to `@waitron/module` puts `@waitron/fiscal-verifactu` in CI's scope (probe P3), so
its whole suite runs on 9a's pull request, the golden huella cases of
`packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `inmutabilidad.test.ts` among them,
unedited; Task A9 also runs those two files locally.

## Departures from the design (no owner question)

- Case 3 keeps the trim's other readable fields (D2); the design says the empty receipt.
- "How it prints" is shown in the editor only, under the Logo field (picture 23); the saved card's
  Logo row does not draw it.
- The route answers `picture: null` for an image the library no longer has, and the card then shows
  no "How it prints" row; the Logo field's own save refusal (`image_not_found`) already says why.

## Global Constraints

- **No migration, no configuration format change, no change to any fiscal package** (D13). A task
  that finds it needs one stops and reports.
- **Risk triggers:** the `VenueServiceContribution` contract between `@waitron/module`,
  `@waitron/venue-service` and `apps/server`, and what a receipt and an A4 invoice print — the FULL
  review path.
- Coverage `98/98/98/95` in every package touched — `@waitron/venue-service`, `@waitron/layouts`,
  `@waitron/server`, `@waitron/ui`, `@waitron/dashboard` (`@waitron/module` gains a type only) — never an exclude or
  ignore comment over reachable code. `apps/server/src/testing/**` is outside the server's coverage
  (`apps/server/vitest.config.ts:43`).
- One mutation-tested source file changes, `packages/ui/src/live-media-image.ts`, with its Stryker run in Task B3 (D12).
- One `withTransaction` per request; the theme read and the department read run on the same
  transaction, awaited in turn, never `Promise.all`; sharp never runs inside a transaction (CLAUDE.md
  §3).
- Database tests through `useVenueDb`. Two of the files keep one database for every case:
  `invoice-document.test.ts` (`resetPerTest: false`, `:39-41`) and `receipt-preview-api.test.ts`
  (`:34-38`). In them every case restores what it changed — the theme it put in use (`clearThemes`),
  a renamed table, a moved department — in `finally`, as their neighbours do
  (`invoice-document.test.ts:466-536`), so later cases see no theme in use; Task A8's describe also
  runs `clearThemes` in its `afterEach`. Sales use the real clock, as the files' existing sales do
  (CLAUDE.md §4's fiscal-clock rule).
- **No test writes to an append-only table after the fact.** `sale_receipt_headers` is declared
  `appendOnly` (`packages/venue-service/src/classification.ts:19`), and the suites built from
  `migrationOptionsFor` (`receipt-print.test.ts:152-155`, `invoice-document.test.ts:41`,
  `receipt-preview-api.test.ts:35`) install its `RAISE(ABORT)` triggers: an update of a sold sale's
  header answers "sale_receipt_headers is append-only" (review E1). A sale with no department gets its
  header with no department when the sale is made (`receipt-print.test.ts:2952-2975`'s pattern), and
  "a department not in this location" moves the department, not the header (Task A3).
- A cannot-be-trusted case asserts what prints (no logo picture) **and** that the sale still prints
  its text; every such case has its control beside it (design line 2448): the same department with a
  readable logo prints its own, and with no receipt row prints the theme's.
- English only in general code; Spanish only in `apps/dashboard/src/i18n/strings.ts` and
  `apps/server/src/guide/es/`. A test of a Spanish screen reads its expected text from the strings.
- Every `--wt-*` name read is declared; no hex, named colour, `rem` or `em` in new styles — the paper
  colours come from `paperGround` (`print-paper.ts:121-125`), not new literals.
- The guides: every section heading carries a `{#id}` both languages share
  (`apps/server/src/guide-content.test.ts`).
- Every commit `git commit -s`. Before each commit: `pnpm format:check` and `pnpm --filter <pkg>
  typecheck` for each package touched (Vitest does not typecheck). Read the `Tests` count, never a
  blank output; `env -u AI_AGENT -u CLAUDECODE` shows a passing test's console.
- Implementers stop at about 150 tool calls with the task unfinished, commit at a passing or cleanly
  red point, and hand over (the `implementer` agent's definition carries this).

## Review Focus

1. **A department whose own logo's pictures are bad** must print nothing, not the venue's logo — the
   fallback follows the name. Tests in Tasks A3 and A4.
2. **A theme switched, or its logo removed, between a sale and its reprint**: the reprint prints what
   the theme in use holds now, as a department's trim already does ("reprints with the trim saved
   since", `receipt-print.test.ts:2748`). Test in Task A4.
3. **The theme's dots unprintable for one paper only**: that paper prints no logo, the other prints
   its own, and the ticket view still shows the image. Tests in Tasks A2, A4 and A7.
4. **A logo picked while the last "How it prints" answer is still on its way**: the late answer must
   not replace the new one. Test in Task B4.
5. **A faint near-white logo** (one black dot) is not "blank"; a white one on a see-through
   background is. Tests in Tasks B1 and B4.
6. **A logo reframed in the image library while the editor is open**: "How it prints" must redraw
   under the same name. Tests in Tasks B3 and B4.

---

## Probes (run 2026-10-25, in `~/waitron-campaign/a841-plan9/probes/`, outputs beside them)

Node v26.11.1, SQLite 3.54.0, one Mac. `node_modules` there is a symlink to this worktree's
`apps/server/node_modules`.

- **P1, telling the four cases apart in SQL (`json-logo-key.mjs`, `json-logo-key.out`).** Command:
  `node json-logo-key.mjs`. For each stored document it printed `json_type` of the top level and of
  `$.logo`, both inside `case when json_valid(x)`: `{}` → object / null / key absent; `{"logo":"a.png"}`
  → object / text / present; `{"logo":null}` → object / `null` / present; `{"logo":""}` and
  `{"logo":7}` → present; `[]` → array, `42` → integer, `null` → null, `"s"` → text, each with the
  key absent; `{bad json` → all null. The control: unguarded `json_type('{bad json', '$.logo')`
  raised "malformed JSON", so the guard is needed. A missing receipt row is told apart by its own
  column (D2), since `json_valid(NULL)` is also null.
- **P2, what "blank" measures (`blank-dots.mts`, `blank-dots.out`).** Command:
  `apps/server/node_modules/.bin/tsx blank-dots.mts`. It drew 400 × 400 circles on a see-through
  background through `prepareImage`, `renderRendition(…, "display", default framing)` and the real
  `drawLogoRasters`, and counted the set bits of the 80 mm picture (160 × 160): white 0, `#f8f8f8`
  421, lemon `#f2d300` 2,726, black 16,281. The failing case for D9's rule — a white logo printing
  some dots — would have printed a non-zero count for white; it printed 0.
- **P3, which CI gates a change switches on (`scope-gates.out`).** Command, per package:
  `pnpm --filter "...<pkg>" ls --depth -1 --json | node scripts/changed-scope.mjs`. `@waitron/module`:
  `fiscal_verifactu=true`. Control, `@waitron/layouts`: `fiscal_verifactu=false`, so the probe tells
  the two apart.
- **P4, which server tests set a theme (`theme-fixtures.out`).** `git grep -ln
  'customThemes\|custom_themes' -- 'apps/server/src/*.test.ts'` printed six files —
  `canvas-retirement-upgrade`, `configuration-transfer`, `themes-api.logo`, `themes-api.public`,
  `themes-api`, `till-api.setup-revision` — none of which prints a receipt or reads a ticket;
  `git grep -ln 'insert(customThemes)'` outside tests printed only `packages/layouts/src/theme-store.ts`.

## Performance: what runs when

- **Per receipt, A4 invoice or ticket answer whose department names no logo, or with no
  department:** one more select, on `custom_themes` by its `in_use` unique index; the receipt and
  invoice read one paper's dots (at most about 13 KB of base64 at 80 mm), the ticket view none.
- **With a department naming its own logo, or one that cannot be trusted:** no theme read.
- **Per Receipts tab preview of a draft with no logo:** the department's printed receipt (one
  select), then, when the venue's logo may print, the theme's (one select); no drawing.
- **Per "How it prints" answer:** one transaction (the session, the image row), then one decode and
  dither outside it — about 26 ms for a 1200 × 400 logo and 0.3 s at worst (slice 7's probe P1) —
  then cached by rendition address, so asking again for the same framing draws nothing.

## File map

| File | Task | Change |
| --- | --- | --- |
| `packages/module/src/module.ts`, `index.ts` | A1 | `PrintedDepartmentReceipt`; the contract returns it |
| `packages/venue-service/src/department-receipts.ts` | A1 | `unreadable` in cases 1-4 |
| `packages/layouts/src/receipt-store.ts` | A2 | share the picture bound and decoder inside the package |
| `packages/layouts/src/theme-store.ts`, `index.ts` | A2 | `readPrintedThemeLogo`, `PrintedThemeLogo` |
| `apps/server/src/receipt-venue-logo.ts` (new) | A3 | D4's four functions |
| `apps/server/src/testing/theme-logo.ts` (new) | A3 | theme fixtures and the cannot-be-trusted cases |
| `apps/server/src/receipt-print.ts` | A4 | `resolvePrintedLogo` |
| `apps/server/src/invoice-document.ts` | A6 | `resolvePrintedLogo` on 80 mm |
| `apps/server/src/receipt-presentation.ts` | A7 | `readVenueLogoName` |
| `apps/server/src/receipt-preview-api.ts` | A8 | the venue's dots for a draft with no logo |
| `apps/server/src/guide/{en,es}/appearance.md`, `content-and-images.md` | A9, B5 | receipts section; "How it prints" |
| `apps/server/src/receipt-logo.ts`, `themes-api.ts` | B1 | `countBlackDots`; the print route |
| `apps/dashboard/src/api/client.ts`, `widgets/print-paper.ts` | B2 | `getThemeLogoPrint`; `rasterUrl` |
| `packages/ui/src/live-media-image.ts` | B3 | `watchMediaImage` |
| `apps/dashboard/src/widgets/theme-logo-print.ts` (new), `i18n/strings.ts` | B4 | the widget and its words |
| `apps/dashboard/src/widgets/theme-logo-field.ts` | B5 | renders it |

---

# Pull request 9a — the paper

### Task A1: `unreadable` in the department's printed receipt (`@waitron/module`, `@waitron/venue-service`)

**Files:**
- Modify: `packages/module/src/module.ts:900-905`, `packages/module/src/index.ts` (type export)
- Modify: `packages/venue-service/src/department-receipts.ts:215-242`
- Test: `packages/venue-service/src/department-receipts.test.ts`,
  `apps/server/src/management-api.accounts-and-receipt-config.test.ts:2690-2693`

**Interfaces:**
- Produces: `PrintedDepartmentReceipt` (D2), exported from `@waitron/module`;
  `readPrintedDepartmentReceipt(tx, cfg, departmentId, paperWidth): Promise<PrintedDepartmentReceipt>`
  in both the contract and `@waitron/venue-service`.

- [ ] **Step 1: Write the failing tests** in `department-receipts.test.ts`, describe "department
  receipt storage":
  - Change "contains imported %s" (`:170-176`) to expect `{ receipt: {}, logo: null, unreadable: true }`.
  - Change "contains an optional SELECT failure …" (`:261-264`) and "contains a failed diagnostic
    sink too" (`:369-391`) to expect `unreadable: true` beside `{ receipt: {}, logo: null }`.
  - New `it.each` "marks a stored logo it cannot keep as unreadable, keeping the other fields: %s"
    over `7`, `` `${"a".repeat(300)}.png` ``, `"../secret.png"`, `""`, `null`: `imported(f.id,
    JSON.stringify({ logo: value, phone: "+34911234567" }), JSON.stringify(pair))` → on `"58mm"`
    `toEqual({ receipt: { phone: "+34911234567" }, logo: null, unreadable: true })`.
  - New "marks a department not found in this location as unreadable": `a = fixture()`, `b =
    fixture()`; `readPrintedDepartmentReceipt(tx, b.cfg, a.id, "80mm")` and with `randomUUID()` →
    each `toEqual({ receipt: {}, logo: null, unreadable: true })`.
  - New controls "a readable document without a logo key, or with a kept logo, is not unreadable":
    `imported(f.id, '{"phone":"+34911234567"}')` → `not.toHaveProperty("unreadable")` and
    `receipt` `{ phone: "+34911234567" }`; then `writeDepartmentReceipt` with
    `` `${"a".repeat(64)}.png` `` and `pair` → `not.toHaveProperty("unreadable")` and `logo.bits`
    `[128]` on 58 mm. The existing no-row case (`:63-69`) stays unchanged and is the third control.
  - In `management-api.accounts-and-receipt-config.test.ts:2690-2693`, the department side becomes
    `{ receipt: failDepartment ? {} : { headerSubtitle: { "es-ES": "Sala" } }, logo: null,
    ...(failDepartment ? { unreadable: true } : {}) }`.

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --filter @waitron/venue-service exec vitest run src/department-receipts.test.ts`
  Expected: FAIL — the changed and new unreadable cases print a diff missing `"unreadable": true`;
  the controls pass.

- [ ] **Step 3: Implement** D2: the type and its export in `@waitron/module`; in
  `readPrintedDepartmentReceipt`, add the three columns of D2 to its select (each JSON test inside
  `case when json_valid(…)`, built on `departmentReceipts.receipt` directly, not `validDocument`,
  since `validDocument` turns invalid JSON into `{}`), and return `unreadable: true` in cases 1-4 as
  D2's table says. Keep the catch's diagnostic exactly as it is.

- [ ] **Step 4: Run the tests and the callers' typecheck**

  Run: `pnpm --filter @waitron/venue-service exec vitest run src/department-receipts.test.ts src/service-delete.live-targets.test.ts && pnpm --filter @waitron/server exec vitest run src/management-api.accounts-and-receipt-config.test.ts -t "optional receipt source failures"`
  Expected: PASS. Then `pnpm --filter @waitron/module typecheck && pnpm --filter @waitron/venue-service typecheck && pnpm --filter @waitron/server typecheck`.

- [ ] **Step 5: Commit** — `git commit -s -m "A department's printed receipt says when its settings cannot be trusted (A841 slice 9)"`

### Task A2: The theme in use's printed logo (`@waitron/layouts`)

**Files:**
- Modify: `packages/layouts/src/receipt-store.ts:42-49,78-103` (export the bound and `readLogoRaster`
  to the package; not from `index.ts`)
- Modify: `packages/layouts/src/theme-store.ts`, `packages/layouts/src/index.ts:88-98`
- Test: `packages/layouts/src/theme-store.test.ts`

**Interfaces:**
- Produces: `readPrintedThemeLogo(tx: Transaction, paperWidth: PaperWidth): Promise<PrintedThemeLogo | null>`
  and `type PrintedThemeLogo` (D3), exported from `@waitron/layouts`.

- [ ] **Step 1: Write the failing tests**, a new describe "the theme in use's printed logo" in
  `theme-store.test.ts`. Insert rows directly (`suite.db.insert(customThemes)`, raw SQL for a broken
  document, as `:298-320` does). `L = ` `` `${"e".repeat(64)}.png` ``; `DOTS = { "58mm": {
  widthDots: 8, heightDots: 1, data: "8A==" }, "80mm": { widthDots: 16, heightDots: 1, data: "8A8=" } }`.
  - "answers null with no theme in use" (a theme with a logo stored, `inUse: null`) → `null`.
  - "answers null when the theme in use has no logo" → `null`.
  - "answers the light name and each paper's own dots": `{ ...LEMON, logo: { light: L, dark: D },
    printedLogo: DOTS }` in use → 58 mm `{ name: L, picture: { widthDots: 8, heightDots: 1, bits:
    new Uint8Array([0xf0]) } }`, 80 mm `bits` `[0xf0, 0x0f]`; never `D`.
  - "answers the name and no picture for a paper whose dots cannot print": `80mm.data` `"x"` → 80 mm
    `{ name: L, picture: null }`, 58 mm still its picture.
  - `it.each(["{broken", JSON.stringify({ ...LEMON, logo: { light: L }, textScale: 112, printedLogo: DOTS })])`
    "answers null for a theme this release cannot read: %s".

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --filter @waitron/layouts exec vitest run src/theme-store.test.ts -t "printed logo"`
  Expected: FAIL — `readPrintedThemeLogo` is not exported (`TypeError: … is not a function`).

- [ ] **Step 3: Implement** D3 in `theme-store.ts`: one select of `THEME_TEXT` and the paper's
  picture (`case when json_valid(theme) then json_extract(theme, '$.printedLogo."<paper>"') end`,
  bounded by the same byte limit `storedPicture` uses — extract that limit as a package function
  rather than repeating the formula), `choicesOf`, then `readLogoRaster`. Export the function and the
  type from `index.ts`.

- [ ] **Step 4: Run the tests and typecheck**

  Run: `pnpm --filter @waitron/layouts exec vitest run src/theme-store.test.ts src/receipt-store.test.ts && pnpm --filter @waitron/layouts typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "Read the theme in use's logo and its printed dots for one paper (A841 slice 9)"`

### Task A3: Deciding whether the venue's logo prints (`apps/server`)

**Files:**
- Create: `apps/server/src/receipt-venue-logo.ts`, `apps/server/src/receipt-venue-logo.test.ts`
- Create: `apps/server/src/testing/theme-logo.ts`

**Interfaces:**
- Consumes: `PrintedDepartmentReceipt` (A1), `readPrintedThemeLogo`, `readThemeInUse` (A2,
  `theme-store.ts:121`).
- Produces: D4's `ReceiptReadDiagnostic`, `venueLogoMayPrint`, `readVenueLogo`,
  `resolvePrintedLogo`, `readVenueLogoName`. From `testing/theme-logo.ts`:
  - `THEME_LOGO = ` `` `${"e".repeat(64)}.png` `` and `THEME_DOTS` (A2's `DOTS`), whose printed
    bytes are `[0xf0]` on 58 mm and `[0xf0, 0x0f]` on 80 mm — different from every department picture
    the receipt tests use (`receipt-print.test.ts:3413-3420,3446-3449`);
  - `putThemeInUse(db: Database, input?: { light?: string; printedLogo?: unknown; name?: string }): Promise<string>`
    — clears any theme's `in_use` (the column's unique index refuses a second 1,
    `theme-store.ts:91`), then inserts a custom theme in use, `{ ...WAITRON_CHOICES, brandColor:
    "#1e5b3a", logo: { light }, printedLogo }`, defaulting to `THEME_LOGO` and `THEME_DOTS`; answers
    its id;
  - `clearThemes(db: Database): Promise<void>`;
  - `saveThemeThroughRoute(db: Database, id: string, theme: ThemeChoices): Promise<Response>` — starts
    a manager's management session (`persons` insert and `startManagementSession`, as
    `apps/server/src/themes-api.test.ts:23-32` does), mounts `mountThemesApi` on a fresh `Hono` and
    sends `PUT /management-api/themes/:id` with `{ theme }`: the request the Look card's Save makes,
    so a test of Remove or Use Waitron's look goes through the real save (design line 2449-2450);
  - `UNTRUSTED_CASES: readonly UntrustedCase[]` with `interface UntrustedCase { readonly name: string;
    apply(db: Database, at: UntrustedAt): Promise<void>; undo(db: Database, at: UntrustedAt): Promise<void> }`
    and `type UntrustedAt = { departmentId: string; locationId: string; foreignLocationId: string }`,
    one per design lines 2443-2445: "the read throws" (rename `department_receipts` to
    `test_hidden_department_receipts`; undo renames back), `{bad json`, `null`, `[]`, `42` (raw
    `insert … on conflict (department_id) do update` of the document, as
    `department-receipts.test.ts:55-59` does), "a numeric logo" (`{"logo":7,"phone":"910111111"}`),
    "a logo longer than 255 bytes", "a logo that is not a library name" (`"../secret.png"`), and "a
    department not in this location": `update departments set location_id = foreignLocationId`
    for the department (undo moves it back to `locationId`) — **never an update of
    `sale_receipt_headers`, which is append-only** (`packages/venue-service/src/classification.ts:19`;
    the review's E1 saw "sale_receipt_headers is append-only"). The header keeps naming the
    department, and `readSaleReceiptHeader` reads it with no location filter
    (`packages/venue-service/src/operations.ts:651-661`), so the department read is what finds no
    department here (the review's E3 read `{ receipt: {}, logo: null, unreadable: true }` after the
    move). `foreignLocationId` is a second `locations` row the test inserts. Every stored-document
    undo deletes the row.

- [ ] **Step 1: Write the failing tests** in `receipt-venue-logo.test.ts` (`useVenueDb` with
  `CORE_MIGRATIONS`; departments are plain `PrintedDepartmentReceipt` literals, the theme a real row):
  - "with no department, the theme's name and that paper's dots": `putThemeInUse` →
    `resolvePrintedLogo(tx, null, "80mm", d)` `toEqual({ venue: { logo: THEME_LOGO }, logo: { widthDots: 16, heightDots: 1, bits: new Uint8Array([0xf0, 0x0f]) } })`; 58 mm → `bits` `[0xf0]`.
  - "a trusted department naming no logo takes the theme's" → the same answer for `{ receipt: { phone: "1" }, logo: null }`.
  - "a department naming its own logo prints its own and reads no theme": `{ receipt: { logo: OWN }, logo: OWN_BITS }` → `{ venue: {}, logo: OWN_BITS }`, and with a spy on `layouts.readPrintedThemeLogo` (`import * as layouts from "@waitron/layouts"`) not called.
  - "a department whose own logo cannot print prints nothing, not the theme's": `{ receipt: { logo: OWN }, logo: null }` → `{ venue: {}, logo: null }`.
  - "an untrusted department prints nothing and reads no theme": `{ receipt: {}, logo: null, unreadable: true }` → `{ venue: {}, logo: null }`, spy not called.
  - "no theme in use prints nothing" → `{ venue: {}, logo: null }`.
  - "a failed theme read reports and prints nothing": rename `custom_themes` to `test_hidden_custom_themes` in `try`/`finally` → `{ venue: {}, logo: null }` and the diagnostic called once with `{ operation: "readPrintedThemeLogo", code: "receipt.read_failed" }`.
  - `readVenueLogoName`: `null` department → `{ logo: THEME_LOGO }`; own logo → `{}`; untrusted → `{}`; failed read → `{}` and `{ operation: "readThemeInUse", code: "receipt.read_failed" }`.
  - `venueLogoMayPrint`: `true` for `null` and for a trusted department naming no logo; `false` for an own logo and for `unreadable: true`.
  - `saveThemeThroughRoute`: a theme put in use with a logo, saved through it with `logo: null` →
    status 200 and the stored row holds no `printedLogo` (the helper's own check that it reaches the
    real route).

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/receipt-venue-logo.test.ts`
  Expected: FAIL — `Failed to load url ./receipt-venue-logo.js`.

- [ ] **Step 3: Implement** `receipt-venue-logo.ts` (D4) and `testing/theme-logo.ts` as Interfaces
  says. **`resolvePrintedLogo` and `readVenueLogoName` decide whether the venue's logo may print only
  by calling `venueLogoMayPrint`** — no branch of their own on `unreadable` or on the department's
  logo (D4): Task A5's proof by deletion relies on it. Each read awaits in turn on the caller's
  transaction; a caught throw calls the diagnostic inside its own `try`, as
  `department-receipts.ts:231-239` does.

- [ ] **Step 4: Run the tests and typecheck**

  Run: `pnpm --filter @waitron/server exec vitest run src/receipt-venue-logo.test.ts && pnpm --filter @waitron/server typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "Decide when a receipt takes the theme's logo (A841 slice 9)"`

### Task A4: The receipt prints the theme's logo, the department's first (`apps/server`)

**Files:**
- Modify: `apps/server/src/receipt-print.ts:196-211`
- Test: `apps/server/src/receipt-print.test.ts` — a new describe "the theme's logo on thermal
  receipts" after "department receipt presentation on thermal jobs" (`:3359`), reusing that
  describe's `setupReceipt` pattern (`:3360-3402`), `storeDepartmentReceipt` (`:278-291`),
  `printedCommands`, `onlySaleId`, `enqueueReceiptReprint` and `registroCount`.

**Interfaces:**
- Consumes: `resolvePrintedLogo` (A3), `putThemeInUse`, `clearThemes`, `THEME_DOTS` (A3).

- [ ] **Step 1: Write the failing tests.** `logos(job)` = the job's `GS v 0` pictures after the QR,
  as `:3431-3436` computes them.
  - `it.each(["58mm", "80mm"])` "a department with no receipt logo prints the theme's logo on %s":
    printers at that paper (`:3409-3412`), `putThemeInUse`, a department receipt with no logo → the
    sale's job prints `[[0xf0]]` on 58 mm and `[[0xf0, 0x0f]]` on 80 mm; `registroCount` 1.
  - "a department's own receipt logo wins": the department with `` `${"b".repeat(64)}.png` `` and
    `ownPair` (`:3417-3420`) and a theme in use → its own bytes, never the theme's.
  - "a department naming a logo whose pictures are bad prints nothing, not the theme's": the
    corrupt-pictures write of `:3457-3459` with a theme in use → `[]`, and the job still contains the
    department's text.
  - `it.each(["absent", "null"])` "a sale with no department prints the theme's logo: header %s" —
    in the describe "automatic F1 receipt delivery enrollment" (`:2768`), beside "omits optional
    decoration with an %s department header" (`:2952-2990`), whose pattern it follows: `issued("auto")`
    makes a sale with no header, and for `"null"` the case inserts its header with `departmentId:
    null` before anything reads it; `putThemeInUse`; reprint → `[[0xf0, 0x0f]]`. No case updates
    `sale_receipt_headers` (Global Constraints).
  - `it.each(["58mm", "80mm"])` "theme dots that cannot print on %s print no logo, and the sale
    prints": a theme in use whose `printedLogo` `"80mm"` is `{ widthDots: 16, heightDots: 1, data:
    "x" }` → on 80 mm the job prints `[]` and still holds the sale's lines and total, with
    `registroCount` 1; on 58 mm it prints `[[0xf0]]`.
  - `it.each(["Remove", "Use Waitron's look"])` "saving %s stops the logo printing": sell with the
    theme in use (prints its dots); `saveThemeThroughRoute` with the theme's choices and `logo: null`
    (Remove; the fixture's theme sets `brandColor: "#1e5b3a"` so the two saves differ) or with
    `WAITRON_CHOICES` (Use Waitron's look, which puts Waitron's choices and no logo in the draft,
    design section 8a) → 200; reprint → `[]`.
  - "the reprint follows the theme in use now": sell with the theme in use; put a second theme in use
    with `printedLogo` `"80mm"` `{ widthDots: 8, heightDots: 1, data: "/w==" }` (`putThemeInUse`
    clears the first theme's `in_use`) → the reprint prints `[[0xff]]`; switch `in_use` to none
    (Waitron's theme) → `[]`. A theme not in use never prints.
  - The existing "uses the current department logo on %s and omits it after clearing"
    (`:3404-3442`) is unchanged: it has no theme in use (P4).

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/receipt-print.test.ts -t "theme's logo on thermal receipts"`
  Expected: FAIL — the theme cases print `[]` where they expect the theme's bytes; the "own logo wins"
  and "bad pictures" cases pass already (they are the department-first controls).

- [ ] **Step 3: Implement** in `buildReceiptBytes`: after the department read,
  `const { venue, logo } = await resolvePrintedLogo(tx, department, printer.paperWidth, diagnostic)`,
  then `resolveReceiptTrim(authored, venue, …)` and `logo` in place of `:211`.

- [ ] **Step 4: Run the file**

  Run: `pnpm --filter @waitron/server exec vitest run src/receipt-print.test.ts`
  Expected: PASS, every existing case included.

- [ ] **Step 5: Commit** — `git commit -s -m "Receipts print the theme's logo where the department has none (A841 slice 9)"`

### Task A5: A receipt whose department cannot be trusted prints no logo (`apps/server`)

**Files:**
- Test: `apps/server/src/receipt-print.test.ts` (the describe of Task A4)

**Interfaces:**
- Consumes: `UNTRUSTED_CASES`, `putThemeInUse` (A3).

- [ ] **Step 1: Write the tests.** `it.each(UNTRUSTED_CASES.map((c) => [c.name, c]))` "prints no
  logo, not even the theme's, when the department's settings cannot be trusted: %s": theme in use;
  a department receipt with `` `${"b".repeat(64)}.png` `` and `ownPair`; sell (the job prints the
  department's own bytes — the control that the department reads); `apply`; reprint → the reprint
  prints `[]`, its text still holds the sale's lines and total, and `registroCount` is still 1;
  `undo` in `finally`. A second `it.each` over the same cases with the department receipt holding no
  logo, so that before `apply` the sale prints the theme's bytes (the control that the theme
  applies) and after it the reprint prints `[]`. A third case: "a failed theme read prints the sale
  without a logo and reports it": `custom_themes` renamed after the sale, reprint → `[]`, the job
  exists, `console.warn` called with `"receipt.optional_read_failed", { operation:
  "readPrintedThemeLogo", code: "receipt.read_failed" }`.
  "A department not in this location" needs a second `locations` row (insert it as
  `department-receipts.test.ts:36-41` does) and moves the sale's department there; `undo` moves it
  back.

- [ ] **Step 2: Run them**

  Run: `pnpm --filter @waitron/server exec vitest run src/receipt-print.test.ts -t "cannot be trusted|failed theme read"`
  Expected: PASS once Tasks A1 and A4 are in. This task adds no code, so prove the cases bite:
  delete the `unreadable` check from `venueLogoMayPrint` and run again — every case of both
  `it.each` sets must fail with `[[240, 15]]` where `[]` was expected (an untrusted department keeps
  no logo name, so without the check the theme's logo prints). The proof holds only because every
  decision goes through `venueLogoMayPrint` (Task A3, Step 3); if a case still passes with the check
  deleted, look for a second decision point and remove it. Restore the check. The reprint path
  (`enqueueReceiptCopy` → `buildReceiptBytes`, `receipt-print.ts:326-335`) makes no mandatory
  department read, so "the read throws" can rename the table before the reprint.

- [ ] **Step 3: Commit** — `git commit -s -m "Untrusted department receipt settings print no logo (A841 slice 9)"`

### Task A6: The A4 invoice (`apps/server`)

**Files:**
- Modify: `apps/server/src/invoice-document.ts:100-115`
- Test: `apps/server/src/invoice-document.test.ts` — a new describe "the theme's logo on the A4
  invoice", using the file's `issue`, `read`, `none` and `venue` (`:39-60`) and the department and
  header inserts of `:446-461`.

**Interfaces:**
- Consumes: `resolvePrintedLogo` (A3) on `"80mm"`; `putThemeInUse`, `clearThemes`,
  `UNTRUSTED_CASES` (A3).

- [ ] **Step 1: Write the failing tests.** Every case calls `clearThemes` and its case's `undo` in
  `finally` (the suite keeps one database, `:39-41`). Headers are inserted once, when the case makes
  its sale, as `:455-460` does — never updated (`sale_receipt_headers` is append-only; this suite is
  built with `migrationOptionsFor`, `:41`).
  - "a department with no receipt logo prints the theme's 80 mm logo, and its trim names it":
    `document.logo` `toEqual({ widthDots: 16, heightDots: 1, bits: new Uint8Array([0xf0, 0x0f]) })`,
    `document.receipt.logo` `THEME_LOGO`.
  - "a department's own receipt logo wins": own 80 mm `QA==` → `bits` `[64]`.
  - "a sale with no department prints the theme's logo": the header inserted with `departmentId:
    null` (and a second case with no header at all).
  - "no theme in use prints none" — the control.
  - `it.each(UNTRUSTED_CASES)` "prints no logo when the department cannot be trusted: %s" →
    `document.logo` `null`, `document.receipt.logo` undefined, and `buildReceiptDocument(document)`
    still yields the invoice number's text (the invoice still renders).
  - "the page draws the theme's dots centred at the top": `layoutInvoicePages(document)`
    (`invoice-page.ts:112`) holds one element of `kind: "logo"` on the first page, centred
    (`:208-225`), drawn from the theme's picture.

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/invoice-document.test.ts -t "theme's logo on the A4 invoice"`
  Expected: FAIL — `document.logo` is `null` where the theme's dots are expected.

- [ ] **Step 3: Implement** as Task A4, with `"80mm"`.

- [ ] **Step 4: Run the A4 files**

  Run: `pnpm --filter @waitron/server exec vitest run src/invoice-document.test.ts src/invoice-pdf.test.ts src/invoice-raster.test.ts src/orders-invoice-pdf.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "A4 invoices print the theme's logo where the department has none (A841 slice 9)"`

### Task A7: The till's ticket view (`apps/server`)

**Files:**
- Modify: `apps/server/src/receipt-presentation.ts:23-47`
- Test: `apps/server/src/receipt-presentation.test.ts` (its `fixture`, `:30-91`; a library image as
  "resolves a current immutable logo URL" uploads one, `:114-153`)

**Interfaces:**
- Consumes: `readVenueLogoName` (A3), `putThemeInUse`, `UNTRUSTED_CASES` (A3).

- [ ] **Step 1: Write the failing tests**, a new describe "the theme's logo on the ticket view":
  - "a department with no receipt logo shows the theme's light image": upload two library images,
    theme in use with `logo: { light: A, dark: B }` → `receiptTrim` `toEqual({ logo: A, logoUrl:
    <A's display address from readPresentations> })`, never B's address.
  - "a sale with no department shows it too" (`fixture("null")` and `fixture("absent")`, which insert
    the header, or none, when the sale is made, `:65-71`).
  - "theme dots that cannot print still show the image on the ticket": a theme whose `printedLogo`
    `"80mm"` data is `"x"` → `receiptTrim` still `{ logo: A, logoUrl: <A's display address> }` (the
    ticket view reads the name, never the dots).
  - "a department's own logo wins" → its own name and address.
  - `it.each(UNTRUSTED_CASES)` "shows no logo when the department cannot be trusted: %s" →
    `receiptTrim.logo` and `.logoUrl` undefined; for the numeric-logo case the phone still shows.
  - The existing "has no optional decoration for an empty %s context" (`:154-170`) is unchanged: no
    theme in use.

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/receipt-presentation.test.ts -t "ticket view"`
  Expected: FAIL — `receiptTrim` is `{}` where the theme's name and address are expected.

- [ ] **Step 3: Implement**: `resolveReceiptTrim(department?.receipt ?? null, await
  readVenueLogoName(tx, department, diagnostic), …)`; the address lines (`:48-55`) stay as they are.

- [ ] **Step 4: Run the ticket readers' files**

  Run: `pnpm --filter @waitron/server exec vitest run src/receipt-presentation.test.ts src/till-sale.test.ts src/order-kitchen-note.receipts.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "The till's ticket view shows the theme's logo where the department has none (A841 slice 9)"`

### Task A8: The Receipts tab's preview (`apps/server`)

**Files:**
- Modify: `apps/server/src/receipt-preview-api.ts:219-259,329-392`
- Test: `apps/server/src/receipt-preview-api.test.ts` (its `rendered`, `libraryImage`, `sizes`,
  `departmentId`, `:780-980`). The file keeps one database (`resetPerTest: false`, `:34-38`), and the
  "top block" describe's `afterEach` (`:781-785`) clears receipts and images, not themes: the new
  describe runs `clearThemes` in its own `afterEach`, and each case also restores in `finally` any
  table it renamed, so the later `marks.logo: null` pins (`:826-847`) still see no theme in use.

**Interfaces:**
- Consumes: `venueLogoMayPrint`, `readVenueLogo` (A3); `putThemeInUse`, `clearThemes`, `THEME_DOTS`,
  `UNTRUSTED_CASES` (A3).
- Produces: `ReceiptPreviewSnapshot` gains `venueLogo: MonoRaster | null`.

- [ ] **Step 1: Write the failing tests**, a new describe "the theme's logo in a department's
  preview":
  - "a draft with no logo draws the theme's dots for the paper, and marks them": theme in use →
    `sizes(result)` `[[16, 1]]` at 80 mm and `[[8, 1]]` with `paperWidth: "58mm"`;
    `result.marks.logo` not `null`.
  - "a draft naming a logo draws that logo, never the theme's": `libraryImage(45)` in the draft →
    the sizes "draws a library logo fitted to the paper" (`:851-861`) draws, not `[16, 1]`.
  - "no theme in use draws none" → `[]` and `marks.logo` `null` (the existing `:826-847` cases keep
    passing unchanged: no theme).
  - `it.each` over `UNTRUSTED_CASES` whose `name` is not "a department not in this location" (the
    route refuses that one with `department.not_found`, `:56`) **"a draft with no logo draws no logo
    while the stored settings cannot be trusted: %s"** (D7; design lines 1693-1695), theme in use →
    status 200, `sizes(result)` `[]`, `marks.logo` `null`. "The read throws" renames
    `department_receipts` inside a `vi.spyOn(VENUE_SERVICE, "readDepartmentReceipt")` whose
    implementation reads first and renames after, on its **first** call — the draft's read in
    `checkedDepartmentReceiptWrite` (`apps/server/src/department-receipt-draft.ts:36`) — so the
    `readPrintedDepartmentReceipt` of D7 is the read that fails (it catches, answering
    `unreadable`). The control beside it: the same department with a readable stored document and no
    logo → `[[16, 1]]`.
  - "a draft naming its saved logo draws it from its image when the printed read throws" (review
    M1): the stored row names `libraryImage(46)` with its pictures, the draft names the same image;
    the spy reads and then renames on its **second** call — the route's own
    `readDepartmentReceipt` (`receipt-preview-api.ts:365`), which still answers — so
    `readPrintedDepartmentReceipt` (`:368`) throws inside and answers no picture → status 200, the
    image's drawn size (as "draws a library logo fitted to the paper", `:851-861`), never `[16, 1]`.
    Count calls in a `mockImplementation`; a `mockImplementationOnce` on the first call breaks the
    route's mandatory second read and answers 500 (the review's E2).
    _Note, 2026-10-25:_ renaming on the second `readDepartmentReceipt` call answers 500 too; the
    test instead wraps `readPrintedDepartmentReceipt` and renames the table only around that call.
  - `it.each` over the stored-document `UNTRUSTED_CASES` (`{bad json` through "not a library name")
    "a draft naming a logo draws it from its image while the stored settings cannot be trusted: %s":
    the draft names `libraryImage(47)` → its drawn size, never `[16, 1]`. These pass before the
    change — with a stored row that is not the draft's logo, `readPrintedDepartmentReceipt` is never
    called (`:364-376`) — and stay as guards that the venue's logo never replaces a draft's own.

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/receipt-preview-api.test.ts -t "department's preview"`
  Expected: FAIL — "a draft with no logo draws the theme's dots" and its readable control draw `[]`;
  the untrusted no-logo cases, the saved-logo case and the draft-logo guards pass already.

- [ ] **Step 3: Implement** D7: in the snapshot transaction, after `printer` is chosen and only when
  `receipt.logo === undefined`, read `VENUE_SERVICE.readPrintedDepartmentReceipt(tx, checked.scope,
  id, printer.paperWidth)`; if `venueLogoMayPrint({ receipt: checked.input.receipt, logo: null,
  ...(stored.unreadable ? { unreadable: true } : {}) })`, set `venueLogo` to `(await readVenueLogo(tx,
  printer.paperWidth, diagnostic))?.picture ?? null`, else `null` — with the
  `console.warn("receipt.optional_read_failed", …)` diagnostic the print path uses. In
  `renderDraftPreview`, `filename === undefined ? snapshot.venueLogo : …`.

- [ ] **Step 4: Run the preview files**

  Run: `pnpm --filter @waitron/server exec vitest run src/receipt-preview-api.test.ts src/receipt-preview-drafts.test.ts src/department-receipt-preview-api.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "A department's receipt preview shows the theme's logo when its draft has none (A841 slice 9)"`

### Task A9: The guide's receipts section, and the fiscal suites unedited

**Files:**
- Modify: `apps/server/src/guide/en/appearance.md` (after `## Where your logo shows {#logo-screens}`,
  `:132-156`), `apps/server/src/guide/es/appearance.md` (after `:145-173`)
- Modify: `apps/server/src/guide/en/content-and-images.md:229-232`,
  `apps/server/src/guide/es/content-and-images.md:237-240`

- [ ] **Step 1: Write the section** `## On receipts and invoices {#logo-receipts}` in English, and
  its Spanish twin with the same `{#logo-receipts}`, saying, in the guide's voice:
  - The logo of the theme in use also prints, in black dots, at the top of receipts and A4 invoices
    of a department with no receipt logo of its own, and of a sale with no department.
  - A department's own receipt logo, set on its **Receipts** tab, always wins; that is how a
    department prints a different picture.
  - The main logo prints, never the version for dark screens.
  - Saving a new logo, removing it, or putting another theme in use changes what the next receipt
    prints, reprints included; a theme not in use prints nothing.
  - A department's **Receipts** tab preview shows the theme's logo while the department has none of
    its own.
  - When a department's receipt settings cannot be read, its receipts print no logo at all rather
    than one that may be the wrong one.
  In both `content-and-images.md`, after the receipt-logo paragraph, one sentence: a department with
  no receipt logo prints the logo of the theme in use instead, linking
  `[…](appearance.md#logo-receipts)`. Say nothing yet about "How it prints" (9b).

- [ ] **Step 2: Run the guide checks**

  Run: `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts && pnpm exec vitest run scripts/guide-links.test.ts`
  Expected: PASS (both twins hold `{#logo-receipts}`).

- [ ] **Step 3: Run the fiscal suites unedited**

  Run: `git diff --stat main -- packages/fiscal packages/fiscal-verifactu packages/core` — Expected:
  no output. Then `pnpm --filter @waitron/fiscal-verifactu test:build-custodian && pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  — Expected: PASS, with the files' own `Tests` count.

- [ ] **Step 4: Commit** — `git commit -s -m "Guide: the theme's logo on receipts and invoices, English and Spanish (A841 slice 9)"`

### Task A10: Visual check of 9a (the controller dispatches it)

Against pictures `42-logo-on-receipt-and-invoice-light.png` and `23-q5-logo-on-receipts-light.png`
(`docs/backlog/mockups/a841-theme-editor/`), on `wa-wt demo <worktree-name>`, signed in as a
manager. Give Bar Lucía's made-up logo (`~/waitron-campaign/a841-mockups-src/lucia-logo.svg`,
exported to PNG) to a theme in use on the Look card. Receipts: the demo printer's jobs, opened in the
dashboard's printer job preview; A4: **Orders** → the bill → the invoice PDF, rendered with
`pdftoppm -png -r 110 -f 1 -l 1`. Save each to `docs/backlog/mockups/a841-9-logo-receipts/` and open
every one.

- [ ] (a) A department with no receipt logo: receipt and A4 invoice carry the venue's dots
  (`9a-a-receipt.png`, `9a-a-invoice.png`); the dots match `lucia-logo-receipt-80mm.png`.
- [ ] (b) A department with its own receipt logo: its own on both (`9a-b-*.png`).
- [ ] (c) A sale with no department: the venue's dots (`9a-c-*.png`).
- [ ] (d) The logo removed and saved: no logo on the next receipt and invoice (`9a-d-*.png`).
- [ ] The till's ticket view for (a) (`9a-ticket.png`), and the Receipts tab's preview of a
  department with no logo (`9a-receipts-tab.png`).
- [ ] Expected differences, not defects: picture 42's terrace logo is a drawn stand-in; the card does
  not yet show how the logo prints (9b).

---

# Pull request 9b — the Look card's "How it prints"

### Task B1: The print route (`apps/server`)

**Files:**
- Modify: `apps/server/src/receipt-logo.ts` (add `countBlackDots`), `apps/server/src/themes-api.ts:108`
- Test: `apps/server/src/receipt-logo.test.ts`, new `apps/server/src/themes-api.logo-print.test.ts`
  (its setup copies `themes-api.logo.test.ts:51-92` — `splitPicture`, `uploadImage`, the manager and
  supervisor sessions — and adds a **staff** session the same way, `cookieFor("staff")`, as
  `themes-api.test.ts:23-32` makes one; the copied setup makes only the other two)

**Interfaces:**
- Produces: `countBlackDots(raster: MonoRaster): number` — set bits inside `widthDots` on each row;
  `GET /management-api/theme-logo-print?image=<name>` answering `ThemeLogoPrint` (D8), the type
  exported from `themes-api.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `receipt-logo.test.ts`: "counts set dots inside the picture's width only": a 10 × 2 raster with
    bytes `[0xff, 0xff, 0x80, 0x00]` → `10` (the six padding bits of the first row's second byte are
    not dots); `[0, 0, 0, 0]` → 0.
  - `themes-api.logo-print.test.ts`, `const ask = (query: string, cookie = managerCookie) =>
    app().request(\`/management-api/theme-logo-print?${query}\`, { headers: { cookie } })`:
    - "draws the image as an 80 mm receipt draws it": `image=A` (the split picture) → 200,
      `paperDots` 504, `picture` equal to `drawLogoRasters(await renderRendition(<A's bytes>,
      "display", <A's framing>))["80mm"]`, `blackDots` its set bits and greater than 0.
    - "a white logo on a see-through background prints blank": a 400 × 400 white circle on a
      transparent PNG (P2's) → `blackDots` 0, `picture` not `null`.
    - "one dot is not blank": a white picture with one black pixel square large enough to survive
      the dither → `blackDots` greater than 0.
    - "a supervisor may read; staff are refused": supervisor 200; staff 403
      `{ error: { code: "authorization.not_permitted", params: { permission: "venue.view" } } }`.
    - "no session is refused": 401 `management_session.required`.
    - `it.each(["", "image=", "image=../x.png", "image=A&image=A", "other=A"])` "refuses %s" → 400
      `management.request_invalid` `{ field: "image" }` (substitute A's name).
    - "an image the library does not have draws nothing": `` image=${"c".repeat(64)}.png `` → 200
      `{ paperDots: 504, picture: null, blackDots: 0 }`.
    - "asking again draws nothing more; a reframe draws again": spy `decodeLogoGreyscale` (`import *
      as media from "@waitron/media"`) — one call for two asks; after `saveImage` reframes A, the
      next ask calls it again and answers different `data`.
    - "writes nothing": the `media_images` and `custom_themes` rows are equal before and after.

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/receipt-logo.test.ts src/themes-api.logo-print.test.ts`
  Expected: FAIL — `countBlackDots` is not exported; the route answers 404.

- [ ] **Step 3: Implement** D8 in `mountThemesApi`: `createLogoCache()` once per mount; the query is
  read with `c.req.queries()`, exactly one `image` key holding one value matching `MEDIA_FILENAME`;
  `authorizeManager(tx, { managementSessionId, permission: "venue.view" })` and
  `readCurrentImageMetadata(tx, image)` in one `withTransaction`; then `drawPreviewLogo(cache,
  renditionUrl(meta.sourceFilename, "display", meta.framing), "80mm", { exists, bytes })` with
  `exists`/`bytes` as `receipt-preview-api.ts:252-257` writes them; the answer stores the picture
  with `encodeLogoRaster` (`@waitron/layouts`).

- [ ] **Step 4: Run the files and typecheck**

  Run: `pnpm --filter @waitron/server exec vitest run src/receipt-logo.test.ts src/themes-api.logo-print.test.ts src/themes-api.test.ts src/themes-api.logo.test.ts && pnpm --filter @waitron/server typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "A route draws a logo as receipts print it and counts its dots (A841 slice 9)"`

### Task B2: The client call and a raster's picture (`apps/dashboard`)

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (beside `useTheme`, `:2499-2503`),
  `apps/dashboard/src/widgets/print-paper.ts:67-97`
- Test: `apps/dashboard/src/api/client-routes.test.ts` (the themes block, `:495-544`),
  `apps/dashboard/src/widgets/print-paper.test.ts`

**Interfaces:**
- Produces: `DashboardApi.getThemeLogoPrint(image: string): Promise<ThemeLogoPrint>` through
  `this.background` (a passive GET, as `:3072` does); `export interface ThemeLogoPrint` in the client
  (D8's shape); `export function rasterUrl(picture: { widthDots: number; heightDots: number; data: string }): string`
  in `print-paper.ts`, drawing one raster as `bitmapUrl` draws a run (refactor `bitmapUrl` to share
  the pixel loop rather than copy it).

- [ ] **Step 1: Write the failing tests.**
  - `client-routes.test.ts`: "asks how a theme logo prints, passively": `getThemeLogoPrint("a b.png")`
    → the call `["/management-api/theme-logo-print?image=a+b.png", "GET", undefined]` (or `%20`, as
    `URLSearchParams` writes it) with the `x-waitron-live: 1` header, and the answer passed through.
  - `print-paper.test.ts`: "draws a raster black on white": `rasterUrl({ widthDots: 16, heightDots:
    1, data: "8A8=" })` loaded into an `Image` and read back through a canvas → pixels 0-3 and 12-15
    black, 4-11 white.

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/api/client-routes.test.ts src/widgets/print-paper.test.ts`
  Expected: FAIL — `getThemeLogoPrint` and `rasterUrl` do not exist.

- [ ] **Step 3: Implement** as Interfaces says.

- [ ] **Step 4: Run them and typecheck**

  Run: the Step 2 command, then `pnpm --filter @waitron/dashboard typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "Dashboard: ask how a theme logo prints, and draw a raster (A841 slice 9)"`

### Task B3: Watching a library image's address (`@waitron/ui`)

**Files:**
- Modify: `packages/ui/src/live-media-image.ts` (beside `invalidateMediaImages`, `:152-154`)
- Test: `packages/ui/src/live-media-image.test.ts`

**Interfaces:**
- Produces: `export function watchMediaImage(reference: string, shape: "source" | "square" | "till" | "display", listener: (address: string | undefined) => void): () => void`
  — subscribes through the module's own `subscribe` (`:51-79`), so it shares the directive's
  batched passive refresh, its 15 s poll and `invalidateMediaImages`; after each refresh that
  answers for `reference` it calls `listener` with that shape's address (`undefined` when the image
  is explicitly missing); the answer unsubscribes. A `reference` that is not a library name
  (`MEDIA_FILENAME`) subscribes nothing and returns a no-op, as the directive does (`:165`).

- [ ] **Step 1: Write the failing tests** in `live-media-image.test.ts`, with the file's existing
  fetch stub pattern (`:46-64`):
  - "a watcher hears each refreshed address": watch `A` for `"display"` → after the first refresh the
    listener has `["/d/1.webp"]`; the stub answers `/d/2.webp` and `invalidateMediaImages()` runs →
    `["/d/1.webp", "/d/2.webp"]`.
  - "an explicitly missing image is heard as undefined" (the answer's `images` lacks `A`).
  - "unsubscribing stops the calls and the poll": after the returned function runs, a refresh adds no
    call, and with no other consumer the 15 s timer stops (as "unsubscribes replaced references…",
    `:181-204`, checks for the directive).
  - "a name that is not a library name subscribes nothing": `watchMediaImage("../x.png", …)` → no
    fetch.

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --filter @waitron/ui exec vitest run src/live-media-image.test.ts`
  Expected: FAIL — `watchMediaImage` is not exported.

- [ ] **Step 3: Implement** as Interfaces says; no change to the directive's behaviour.

- [ ] **Step 4: Run the tests, typecheck and mutation**

  Run: `pnpm --filter @waitron/ui exec vitest run src/live-media-image.test.ts && pnpm --filter @waitron/ui typecheck`
  Expected: PASS. Then `pnpm --filter @waitron/ui exec stryker run --mutate src/live-media-image.ts`
  and add a case for every survivor inside `watchMediaImage` (D12); report the score in the commit
  message.

- [ ] **Step 5: Commit** — `git commit -s -m "Let a screen watch a library image's address (A841 slice 9)"`

### Task B4: The "How it prints" widget and its words (`apps/dashboard`)

**Files:**
- Create: `apps/dashboard/src/widgets/theme-logo-print.ts`, `theme-logo-print.test.ts`,
  `theme-logo-print.a11y.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (after `"appearance.logo_dark_plate"`, `:3031` and
  `:6360`)

**Interfaces:**
- Consumes: `getThemeLogoPrint`, `ThemeLogoPrint`, `rasterUrl`, `paperGround` (B2);
  `watchMediaImage` (B3).
- Produces: `<dashboard-theme-logo-print>` with `api: DashboardApi` and `image: string | null`
  properties; dispatches no event. `data-test` hooks: `logo-print` (the figure), `logo-print-blank`,
  `logo-print-failed`.

New strings:

| Key | English | Spanish |
| --- | --- | --- |
| `appearance.logo_print` | How it prints on receipts of departments with no receipt logo of their own. | Así se imprime en los recibos de los departamentos sin logotipo de recibo propio. |
| `appearance.logo_print_blank` | This logo prints blank on receipts. | Este logotipo se imprime en blanco en los recibos. |
| `appearance.logo_print_failed` | Could not show how this logo prints. | No se ha podido mostrar cómo se imprime este logotipo. |
| `appearance.logo_print_retry` | Try again | Reintentar |

The first two are the design's (line 645); "recibo" follows the dashboard's Spanish for a
department's receipt logo ("Logotipo del recibo de …").

- [ ] **Step 1: Write the failing tests** (`theme-logo-print.test.ts`, browser; the api is a stub
  object with `getThemeLogoPrint: vi.fn()`; `BLACK = { paperDots: 504, picture: { widthDots: 16,
  heightDots: 1, data: "8A8=" }, blackDots: 8 }`, `BLANK = { …, data: "AAA=", blackDots: 0 }`):
  - "asks nothing and draws nothing without an image".
  - "while asking, shows an empty paper box marked busy and the caption": a never-settling promise
    → `[data-test="logo-print"]` has `aria-busy="true"` and text `t("appearance.logo_print")`.
  - "shows the picture and the caption": `BLACK` → an `img` whose `src` starts `data:image/png`,
    the caption, no `logo-print-blank`.
  - "says when the logo prints blank": `BLANK` → `logo-print-blank` reads
    `t("appearance.logo_print_blank")`, the empty picture still drawn.
  - "draws nothing for an image the library does not have": `picture: null` → no `logo-print`.
  - "a failed ask says so and Try again asks again": first call rejects → `logo-print-failed` with
    the retry button; pressing it calls again with the same name and then shows `BLACK`.
  - "an answer for an image no longer held is dropped": `image = A` (pending), then `image = B`;
    resolve B with `BLACK`, then A with `BLANK` → no `logo-print-blank`; the api was called with A
    then B.
  - "asks again when the image changes under the same name" (D10; the review's L4): `fetch` stubbed
    to answer `/media/presentations` with `A`'s `display` `/d/1.webp` → after it arrives the api has
    one call (the first address asks nothing more); the stub answers `/d/2.webp` and
    `invalidateMediaImages()` runs (what the library's client does after a reframe,
    `packages/media/src/dashboard/client.ts:93-98`) → a second call with `A`; a refresh answering
    `/d/2.webp` again asks nothing.
  - "Spanish": `setLocale("es-ES")` → the caption equals `es["appearance.logo_print"]`; restore the
    locale in `afterEach`.
  - `theme-logo-print.a11y.test.ts`: axe over asking, shown, blank and failed, in light and dark.

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/theme-logo-print.test.ts src/widgets/theme-logo-print.a11y.test.ts`
  Expected: FAIL — `Failed to load url ./theme-logo-print.js`.

- [ ] **Step 3: Implement** D10. Layout: a `figure` holding the paper box (`paperGround`, 192 px
  wide, padding `--wt-space-2`) and a `figcaption` with the caption, side by side with
  `flex-wrap: wrap` so a phone puts the caption under the box; the picture `alt=""` (the caption
  describes it); the blank line in the house warning style (`fixLineStyles`' `.warning`,
  `apps/dashboard/src/widgets/fix-line-styles.ts:5-11`, with the warning icon the Look card's brand
  warning uses, `look-card.ts:645`); caption and failure line in `--wt-font-size-sm` and
  `--wt-color-text-muted`; the retry a `wt-button` `variant="secondary"`. A request generation
  guards each answer. While `image` is set the widget holds one `watchMediaImage(image, "display",
  …)` subscription (replaced when `image` changes, ended on disconnect) and asks again when the
  heard address differs from the last known one.

- [ ] **Step 4: Run them and typecheck**

  Run: the Step 2 command, then `pnpm --filter @waitron/dashboard exec vitest run src/i18n` (the
  strings' parity guard) and `pnpm --filter @waitron/dashboard typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "Dashboard: a widget shows how a logo prints, and says when it prints blank (A841 slice 9)"`

### Task B5: "How it prints" under the Logo field, and its guide paragraph (`apps/dashboard`, guides)

**Files:**
- Modify: `apps/dashboard/src/widgets/theme-logo-field.ts:98-126`
- Test: `apps/dashboard/src/widgets/theme-logo-field.test.ts`, `apps/dashboard/src/screens/look-card.test.ts`
- Modify: `apps/server/src/guide/en/appearance.md` (`## Add your logo {#logo}`, `:109-130`) and
  `apps/server/src/guide/es/appearance.md` (`:118-143`)

**Interfaces:**
- Consumes: `<dashboard-theme-logo-print>` (B4).

- [ ] **Step 1: Write the failing tests.**
  - `theme-logo-field.test.ts` (its `api()` gains `getThemeLogoPrint: vi.fn(async () => BLACK)`):
    "shows how the main logo prints after the dark-screens field" → a `dashboard-theme-logo-print`
    after `[data-test="logo-dark"]` with `image` `LIGHT`; "shows none without a logo"; "follows the
    main image, not the dark one": replace the light → `image` `NEW`; set a dark image → `image`
    still `LIGHT`.
  - `look-card.test.ts` (the editor's `api` gains the same stub): "opening the editor on a theme with
    a logo asks once how it prints, and Save stays quiet" → one call with the light name, and the Save
    action still quiet and disabled after the answer arrives (assert it the way the file asserts a
    fresh editor's Save, `saveActionState`'s quiet state); "a dark image picked asks nothing more";
    "Remove hides it"; at `page.viewport(390, 900)` (as `:372` does) the figure's right edge is
    inside the card and the caption sits under the box.
  - Run every Look card and Logo field file: an existing case whose `api` lacks the method sees the
    widget's failure line; if one fails for that alone, give its mount the stub (setup only) and list
    it in the commit message.

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/theme-logo-field.test.ts src/screens/look-card.test.ts`
  Expected: FAIL — no `dashboard-theme-logo-print` in the field.

- [ ] **Step 3: Implement**: render `<dashboard-theme-logo-print .api=${this.api} .image=${logo.light}>`
  after the dark fieldset while `logo` is set. Then the guide: in `{#logo}`, after the dark-screens
  paragraph, English: under the logo, a small picture shows how it prints on receipts of departments
  with no receipt logo of their own — the logo in the black dots of an 80 mm receipt printer — with a
  link to `#logo-receipts`; when it would print no dots at all, as a white logo on a see-through
  background does, "This logo prints blank on receipts." shows beside it: pick a darker picture, or
  give the departments a receipt logo of their own. The Spanish twin quotes the Spanish strings.

- [ ] **Step 4: Run the Look card and guide files**

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/theme-logo-field src/screens/look-card src/screens/appearance-screen && pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts && pnpm exec vitest run scripts/guide-links.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "The Look card shows how the logo prints on receipts (A841 slice 9)"`

### Task B6: Visual check of 9b (the controller dispatches it)

Against picture `23-q5-logo-on-receipts-light.png` (its left panel) and `17-logo-editor-light.png`,
on `wa-wt demo <worktree-name>`, signed in as a manager, the Look card's editor open. Save each to
`docs/backlog/mockups/a841-9-logo-receipts/` and open every one.

- [ ] Bar Lucía's logo, 1280 px, light and dark, English (`9b-how-it-prints-{light,dark}.png`): the
  dotted picture under the dark-screens field with the caption beside it; the paper white in both.
- [ ] The same at 390 px, light and dark, English and Spanish (`9b-phone-{light,dark}-{en,es}.png`):
  the caption under the box, nothing wider than the screen.
- [ ] A white logo on a see-through background (P2's circle), light and dark, English and Spanish
  (`9b-blank-{light,dark}-{en,es}.png`): the empty paper box and "This logo prints blank on
  receipts." in the warning style.
- [ ] The failure line with Try again (stop the server while the editor asks), light
  (`9b-failed-light.png`).
- [ ] Expected differences, not defects: the picture is the real dither, not picture 23's drawing;
  the saved card shows no "How it prints" (Departures).

---

## Changed test checks

Every existing assertion this plan changes, and the design line behind it:

- `packages/venue-service/src/department-receipts.test.ts:170-176`, "contains imported %s": each of
  `{bad json`, `null`, `[]`, `42` now answers `unreadable: true` beside `{ receipt: {}, logo: null }`
  — design lines 1673-1676 (case 2) and 1684-1688 (`unreadable: true` in cases 1-4).
- `department-receipts.test.ts:261-264`, "contains an optional SELECT failure …": gains
  `unreadable: true` — lines 1671-1672 (case 1) and 1684-1688. Its diagnostic assertion is
  unchanged.
- `department-receipts.test.ts:369-391`, "contains a failed diagnostic sink too": gains `unreadable: true`
  — the same lines.
- `apps/server/src/management-api.accounts-and-receipt-config.test.ts:2690-2693`, "global refusal
  %s, department refusal %s …": the department side gains `unreadable: true` when `failDepartment` —
  the same lines; the trusted branch is unchanged.
- `apps/dashboard/src/api/client-routes.test.ts`: a new row for `getThemeLogoPrint` (an addition).
- **Unchanged, and still proving "department first" with nothing else to print:**
  `receipt-print.test.ts:3404-3442` ("omits it after clearing"), `:3444-3467` ("without substituting
  the venue logo", which reads the retired `tenant_receipts`), `invoice-document.test.ts:530,633`,
  `receipt-presentation.test.ts:154-170`, `receipt-preview-api.test.ts:826-847`. None has a theme in
  use (P4), so the venue side is Waitron's theme, which has no logo. Their replacements with a theme
  in use are Tasks A4-A8's "own logo wins", "bad pictures print nothing" and "no theme in use"
  cases, each beside a case where the theme's logo does print.
- Possibly, setup only: a Look card or Logo field mount gaining a `getThemeLogoPrint` stub (Task
  B5, Step 1), named in that commit.

## Driver steps (not implementer tasks)

- **Before each PR:** rebase; `/finish-branch` on the FULL path (risk triggers: the
  `VenueServiceContribution` contract, and what a receipt and an A4 invoice print). 9a's description
  **opens with the fiscal-untouched receipts**: 9a changes only the picture printed on the receipt
  and on the A4 invoice's copy — no invoice number, series, chain, filed record or required invoice
  field; `git diff --stat main -- packages/fiscal packages/fiscal-verifactu packages/core` prints
  nothing; the golden huella cases of `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and
  `inmutabilidad.test.ts` pass unedited (Task A9's run); and CI runs `@waitron/fiscal-verifactu`'s
  whole suite because `@waitron/module` changed (P3). Then, in plain words: D1-D7 and D13; the
  probes; the departures; and that every venue with a theme in use holding a logo starts printing it
  on the next receipt of every department with no receipt logo, as the owner chose (Q5 A). 9b's
  description lists D8-D10, the `@waitron/ui` mutation score of Task B3, and the four new Spanish
  strings with their English, and says it lands only after 9a (D1).
- **Who lands 9a.** The plan does not decide it. The controller has asked the owner whether lane A
  may land 9a; it waits for that answer. 9b waits for 9a whichever way the answer goes.
- **After 9a lands:** in `docs/backlog.md`'s A841 entry (`:2904-2963`), after slice 10b's sentence:
  "Slice 9a landed {date} (#{n}): the logo of the theme in use prints on receipts and A4 invoices of
  every department with no receipt logo of its own and of a sale with no department, a department's
  own logo still first; a department whose receipt settings cannot be trusted prints no logo; the
  till's ticket view and a department's Receipts preview follow the same rule." and make the last
  sentence "Next: 9b, 11, 12 and 14." Also replace "which nothing prints until slice 9" (slice 7's
  sentence) with "which slice 9 prints".
- **After 9b lands:** add "Slice 9b landed {date} (#{n}): the Look card shows how the logo prints,
  and says when it prints blank." and "Next: 11, 12 and 14."
- **The W111 entry** ("Left open by #1261's review (W111)", `docs/backlog.md:3433-3435`) already
  carries the theme logo's line, added by slice 7; slice 9 prints the logo but adds no new kind of
  image use, so the entry needs nothing more.
- **Record in the design's decisions list** (section 16, "The answers, and the branches not taken"),
  as lane A rulings dated the day they are made: slice 9 in two pull requests (D1), not taken: one
  of sixteen tasks; `unreadable` keeps the readable fields of case 3 (D2), not taken: an empty
  receipt; "prints blank" means zero black dots (D9), not taken: a threshold; "How it prints" is
  drawn by a read route under `venue.view` from the draft's image (D8), not taken: drawing the saved
  `printedLogo`, which an unsaved logo does not have yet; "How it prints" asks again when the light
  image's `display` address changes, so a reframe in the library is followed (D10), not taken:
  following the image's name only.
- **Backlog entries to add**, each one line with this plan as its pointer. In the printers area: "A
  department's Receipts preview shows the theme's logo, for a readable department whose draft names
  no logo, with no words saying it is the venue's (A841 slice 9, D7)"; "A department's Receipts
  preview does not redraw when the theme in use changes while it is open (A841 slice 9)". In the
  A841 area: "The Look card's "How it prints" draws the 80 mm picture only; a logo blank at 80 mm
  and not at 58 mm was not measured (A841 slice 9, D5)".

## Left for later

- Slices 11, 12 and 14 are untouched.
- The Receipts tab's wording for the venue's logo, its redraw on a theme switch, and a 58 mm "How it
  prints" — each a backlog line in the Driver steps.

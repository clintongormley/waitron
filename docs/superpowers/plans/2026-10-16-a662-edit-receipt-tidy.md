# A662 — Tidy the Edit receipt dialog, and a default tax-agency description

Spec: backlog entry A662 (`docs/backlog.md`) and its detail in `docs/backlog/printers.md`
("## A662 — tidy the Edit receipt dialog, and a default tax-agency description"), mockup
`docs/backlog/mockups/a662-edit-receipt/1-logo.png`. Five points, quoted where they decide
something below. Queue constraints: "Point 1 is a sale-path change: keep the refusal for any case
the owner did not name, assert the domain code where it still applies, and run the fiscal gates
UNEDITED. A department that gains the default must show it filled in and editable, and the
Departments screen's warning goes for it." Point 2: "a fixed medium/large height or width belongs to
the dialog primitive's existing size options (A734, #1762) if one fits — do not draw a one-off."

Review path: FULL — point 1 changes what the sale path files (a fiscal invariant), and
`ModuleRouteContext.cfg` (`packages/module/src/module.ts`), read by every module, gains a field.

Migration: none. The default is applied when a description is READ, so existing departments,
the owner's Santet department among them, get it without any row being written. No stored record
changes shape; no backwards-compatibility code (CLAUDE.md §3, last rule).

Files: `apps/server/src/{till-config,sale-operation-description,department-receipt-api,boot}.ts`,
`packages/module/src/module.ts`, `packages/venue-service/src/routes.ts`,
`apps/dashboard/src/screens/department-receipt-dialog.ts`,
`apps/dashboard/src/widgets/{image-upload,print-paper}.ts`, `apps/dashboard/src/i18n/strings.ts`,
their tests, `docs/developers/{design-system,products}.md`, `docs/backlog/setup.md`,
`docs/backlog.md`, `docs/backlog/printers.md`.

## Why the owner's Santet department had no description

Neither the Santet import nor "+ Add department" gives a department one: nothing in Waitron does.
A department's description lives only in a `department_receipts` row, and the only product writer
of that table is `writeDepartmentReceipt` (`packages/venue-service/src/department-receipts.ts:266-288`),
reached from the Edit receipt dialog's save. Neither department creator writes one:

- "+ Add department" posts to `/management-api/venue-service/departments`
  (`packages/venue-service/src/routes.ts:998-1013`) → `createDepartment`
  (`packages/venue-service/src/operations.ts:183-215`), which inserts the department and its sale
  policy only. Run: `pnpm --filter @waitron/venue-service exec vitest run src/routes.test.ts -t
  "department description setup"` — 9 passed, including the `undefined` case
  (`routes.test.ts:3913-3950`): a department made by `createDepartment` with no receipt row IS
  reported `department.operation_description_required`.
- A new venue's default department is made by venue-service provisioning
  (`packages/venue-service/src/provisioning.ts:54-62`), again with no receipt row.
- The Santet import (`local/square/import.mjs:261-291` in `waitron-local-santet-data`, read only)
  takes the first active department, renames it "Santet Deli Co" and makes it table service; it
  never touches the receipt. `apps/server/scripts/santet-setup.ts:63` there sets only the
  LOCATION's description, which a department sale does not fall back to
  (`docs/backlog/setup.md:42-44`).
- The Santet venue itself, read with `sqlite3 "file:…/.waitron-dev/instances/waitron-local-santet-data/box/venue/venue.db?mode=ro&immutable=1"`
  (no WAL file was present): one department, "Santet Deli Co", `is_default = 1` (the provisioned
  one), no `department_receipts` row at all (`select count(*) from department_receipts` → 0); the
  location's own description is "Venta en establecimiento".

So every department on every Veri\*Factu venue starts without a description, which is why point 1
is a default rather than a fix to the import.

## Decisions taken here (recorded in the PR)

- **Point 1: the default is applied when a description is read, never written at creation.**
  Writing it at creation would leave Santet's and every existing department without one (a data
  migration, which the queue prefers to avoid) and would need venue-service's two creators and the
  configuration import to learn the default. Read-time, it is one value handed down by boot from the
  fiscal seat — `enabledFiscal.venueFields?.defaults?.operationDescription`
  (`packages/fiscal/src/contribution.ts:78-79`; Veri\*Factu's is set at
  `packages/fiscal-verifactu/src/slot.ts:96`) — to three readers:
  1. the sale path, `readSaleOperationDescription` (`apps/server/src/sale-operation-description.ts:38`):
     a department with no usable description files the default. This covers new sales (`order`)
     and corrections and refunds (`sale`, through `readRetainedDepartmentReceipt`): a refund of a
     sale filed with the default must not then be refused.
  2. the dialog's read, `GET …/departments/:id/receipt` (`apps/server/src/department-receipt-api.ts:77-86`):
     `receipt.operationDescription` answers the default when none is stored, so the field opens
     filled in and editable, and the draft starts unchanged (Save stays disabled until an edit).
     Saving any change stores what the field shows. The dashboard needs no change for this.
  3. the Departments screen's warning, `listDepartmentReceiptReadiness` (`packages/venue-service/src/routes.ts:692-694`):
     listed only when a description is required AND no default is offered.
  The value travels as `operationDescriptionDefault?: string` on `TillConfig`
  (`apps/server/src/till-config.ts:29-30`, beside `operationDescriptionRequired`) and on
  `ModuleRouteContext.cfg` (`packages/module/src/module.ts:50-54`), both set in `boot.ts` (~1487,
  ~1800) from one `const`. No code outside the fiscal module names "Venta en establecimiento"; tests
  read it from the module (`ALL_MODULES.find((m) => m.fiscal?.id === "verifactu")`, the pattern of
  `apps/server/scripts/demo-seed/data-set.test.ts:332-334`) or use a test string such as "Seat
  default".
- **Where the refusal stays.** `department.operation_description_required` is still thrown when a
  description is required and the installed fiscal seat offers no default (`defaults` is optional,
  `contribution.ts:79`) — every existing refusal test runs unchanged, because its cfg carries no
  default, and now pins exactly that case. `sale.department_missing` is untouched and must still win
  over a default. A venue without Veri\*Factu (`operationDescriptionRequired === false`) still files
  `""` and shows no field. No error code is added, renamed or removed; the till's and the
  Departments screen's handling of the code stay, reachable in the no-default case.
- **A stored value that cannot be used counts as none — a departure to name in the PR.** The
  queue says "keep the refusal for any case the owner did not name"; a stored but unusable
  description (non-text, over 500 characters, a control character) is such a case, and it now
  files the default instead of being refused. Chosen because `parseReceipt`
  (`department-receipts.ts:113-121`) already reads every such value as absent, for the dialog, the
  warning and the printed receipt alike; keeping a refusal for it alone would add a second
  "stored but unusable" state to the venue-service read contract (`module.ts`). What the writers
  refuse, each pinned by a test: the dialog's save refuses `""`, `" "`, 501 characters and a
  control character before writing (`apps/server/src/department-receipt-settings-api.test.ts:198-210`,
  `department-receipt-draft.test.ts:101-116`); the configuration import refuses `null`, `[]`, 501
  characters and a control character (`packages/venue-service/src/configuration-transfer.test.ts:1405-1419`).
  Not pinned, and from reading only: the configuration import checks type, length and control
  characters (`configuration-transfer.ts:617-625`) but not blankness, so it is believed to store a
  blank description as given. A blank one is "no description", the case the owner named. Assumption:
  nothing else writes `department_receipts.receipt`.
- **Point 2: `<wt-modal size="wide">`** replaces `<wt-dialog>` and its one-off
  `--wt-dialog-max-width: min(96vw, var(--wt-modal-max-width))` (`department-receipt-dialog.ts:58-60`).
  `design-system.md:1631-1632` lists `size="wide"` (`--wt-modal-max-width`, 1024px) for "a
  side-by-side layout"; every size is bounded by the window, so on a phone it is the window less
  its margins. The width is then fixed from the first frame, and no logo can widen it. A wide
  modal keeps the full window height (`design-system.md:1647-1649`); the form is longer than that
  at 1280 × 900, so no `height` is set. Inside it, the preview column holds its space before the
  preview answers: it always contains an empty, zero-height strut as wide as the 80 mm paper
  (`columnsFor("80mm")` from `@waitron/printing/src/layout.js`, imported as
  `printers-screen.ts:54` does, drawn with the paper's font and padding from `paperStyles`), so the
  column's width depends neither on whether a preview has loaded nor on which paper it shows.
  The strut must NOT carry the `.paper` class: tests wait for `.paper` as the sign a preview drew
  (`department-receipt-dialog.client.test.ts:147`, `department-receipt-dialog.a11y.test.ts:45`).
  `wt-modal` extends `wt-dialog`, so `beforeClose`, `wt-close`, `description` and `dismissible`
  carry over. Two behaviours change, both accepted and both checked in the Task 0 / Task 5 looks:
  the dialog opens with focus on its body, which is always a Tab stop (`bodyTabStop = "always"`,
  `wt-modal.ts`; `design-system.md:1669-1670`), where today's overflowing `wt-dialog` hands focus
  to the first switch; and fields stop at `--wt-form-max-width` (576px), which `wt-modal` sets on
  its body (`wt-modal.ts:51`).
- **Point 3:** the address lines go. The sentence shown when the location has NO address
  (`receipts.no_address`, "This location has no address saved. It is set during setup.") stays: it
  is not a copy of the address, and nothing else says why the switch prints nothing.
- **Point 4:** a `logo` presentation of `dashboard-image-upload`, beside its `thumbnail` one, so
  the picker, its draft scope and its disabled handling are reused. With a logo: a bordered button
  showing the picture on the paper's white (`paperStyles` keeps paper colours in both themes;
  share that ground rather than writing a new colour), drawn at the size it prints. Printing fits
  every logo, small or large, inside 504 × 160 dots: `decodeLogoGreyscale` runs sharp's
  `.resize(maxWidth, maxHeight, { fit: "inside" })` (`packages/media/src/logo.ts:26`), which
  ENLARGES a small image, called with `safeWidthDots(paper)` and `LOGO_MAX_HEIGHT_DOTS`
  (`apps/server/src/receipt-logo.ts:15`). Measured 2026-10-16 with the worktree's sharp and that
  exact chain (flatten, resize 504 × 160 inside, b-w): 100 × 30 → 504 × 151, 2000 × 600 → 504 × 151,
  504 × 151 → 504 × 151. So
  the picture sits in a fixed box of `safeWidthDots("80mm")` × `LOGO_MAX_HEIGHT_DOTS` dots at
  `dpiValue("203dpi")` — 504/203 in × 160/203 in, about 238 × 76 CSS px, 63 × 20 mm
  (`packages/printing/src/layout.ts`, `dither.ts:2`) — with `object-fit: contain`, so a small logo
  is enlarged on screen as on paper; accessible name "Change logo". Beside it a ghost `wt-button`
  "Remove" (accessible name "Remove logo"). Without a logo: one dashed button "+ Add a logo", its
  "+" `aria-hidden` so the accessible name is exactly "Add a logo". Both
  buttons keep `data-test="choose-image"` / `"remove-image"`, which the dialog's tests already use.
  The picker's footer shows no Remove in this presentation (Remove is beside the picture). Remove
  only clears the receipt's logo; it sends nothing to the image library. Spanish: «Añadir un
  logotipo», «Cambiar el logotipo», «Quitar», «Quitar el logotipo» — «Quitar», not the existing
  `action.remove` «Eliminar», which reads as deleting the image.
- **Point 5:** `receipts.offered_languages` ("Available at the till.") is deleted, EN and ES.

## Task 0 — Reproduce first, and look at today's dialog

Before any code. Read CLAUDE.md §6 and `docs/developers/workflow-guide.md` (the dev stack from a
worktree). Start the dev stack on this worktree's UNCHANGED code with `wa-wt demo <this worktree's
name>` — never a bare `pnpm dev*`, never the Santet worktree. If a reset turns out to be needed,
first `lsof` port 8080 and the slot's venue folder and stop only what you started. On a department
with no stored description (check the Departments list shows "Set up the tax-agency description"),
open Edit receipt and take pictures on opening and again after the preview draws, at 1280 and 390,
light and dark, with and without a logo (choose one from the image library; take a wide one), into
`/Users/clintongormley/waitron-campaign-c/a662-shots/before/`. Record, with the measured dialog
width each time (devtools or `getBoundingClientRect` on the `<dialog>`): whether the dialog opens
narrow and widens when the preview draws, and whether the logo widens it further (the spec's point
2 says "not checked"). Note where focus lands on opening (Decisions, point 2). Put the findings in
the PR. Remove the test logo afterwards so Task 5 starts from the same state.

## Task 1 — The sale path files the fiscal seat's default when a department has none

Files: `apps/server/src/till-config.ts`, `apps/server/src/sale-operation-description.ts`,
`sale-operation-description.test.ts`, `sale-operation-description.integration.test.ts`.

Test first (watch each fail with `department.operation_description_required`):

1. `sale-operation-description.test.ts`: beside the refusal table (~149-167), the same seven values
   with `cfg` = `{ ...f.cfg, operationDescriptionDefault: "Seat default" }` return "Seat default"
   for both an `order` and a `sale` source; a stored "Deli meals" still wins over it for both. The
   existing table stays as it is: it is now the "no default offered" case.
2. Same file: with the default set, a missing order context, a missing sale and a null department
   header still refuse `sale.department_missing` (the default never stands in for a department).
3. `sale-operation-description.integration.test.ts`: with the department's description removed
   (`authored()`) and `const cfg = { ...venue.cfg, operationDescriptionDefault: "Seat default" }`,
   issuing the order's invoice through the file's helpers (`issueOrderInvoice(deps(), cfg, …)`)
   files `descripcion_operacion` "Seat default" — not the location's "Generic location service"
   the file sets at setup — and a whole-invoice credit of that sale (`creditWholeInvoice`, the
   file's existing credit path) files "Seat default" too. Read both with the file's `records(id)`.
   This is the failing control: today both refuse.

Then add `operationDescriptionDefault?: string` to `TillConfig` and fall back to it at
`sale-operation-description.ts:38` only when `parseReceipt` gave nothing usable; throw as now when
there is no default.

Trace before finishing (CLAUDE.md: trace every consumer before changing gating): every non-test
caller of `readSaleOperationDescription` (`till-sale.ts` ×3, `bill-payments.ts`, `cancel-credit.ts`,
`working-order.ts`) receives a cfg spread from boot's `till` — `requestCfg`
(`request-config.ts:6-7`), `sendingCfg` (`made-here.ts:37-42`), `{ ...deps.cfg, origin }`
(`payments-api.ts` ~1039). Re-check with grep and name any that is not in the PR.

Deletion proof: remove the fallback; cases 1 and 3 fail with the domain code; restore.

Checks: `pnpm --filter @waitron/server exec vitest run src/sale-operation-description
src/location-settings-api.test.ts` (its refusal cases ~152-180 must pass unedited);
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
src/inmutabilidad.test.ts` UNEDITED; `pnpm --filter @waitron/server typecheck`; `pnpm format:check`.

## Task 2 — The Departments warning goes, the dialog reads the default, boot wires it

Files: `packages/module/src/module.ts`, `packages/venue-service/src/routes.ts`, `routes.test.ts`,
`apps/server/src/department-receipt-api.ts`, `department-receipt-settings-api.test.ts`,
`apps/server/src/boot.ts`, `boot.departments-readiness.test.ts`.

Test first:

1. `packages/venue-service/src/routes.test.ts`: `fixture` (~76, ~143) takes an optional default.
   With `fixture(true, "Seat default")`, a department made by `createDepartment` with no receipt
   row, and each row of the table at ~3913, report no `department.operation_description_required`.
   The existing cases (no default) stay as they are.
2. `apps/server/src/department-receipt-settings-api.test.ts`: with the `cfg` at ~70 given
   `operationDescriptionDefault: "Seat default"`, a department with no stored description answers
   `receipt.operationDescription` "Seat default"; one with a stored description answers its own;
   without the default (existing cases) the field is absent. A save with an untouched default body
   stores "Seat default" (read it back).
3. `apps/server/src/boot.departments-readiness.test.ts`: for ES-common the readiness list holds no
   description issue, and `GET /management-api/venue-service/departments/<row.id>/receipt` answers
   `receipt.operationDescription` equal to the Veri\*Factu module's default, read from `ALL_MODULES`
   (never a literal). For GB-vat: no issue, the answer has no `operationDescription`, and
   `operationDescriptionRequired` is false. Rename the case to say what it now checks. This read
   goes through real start-up and reads boot's `till` object (`venueCfg: till`, `boot.ts:1718`),
   the same object every sale route's cfg is spread from (Task 1's trace), so it is the start-up
   check that the default reaches the sale path too — indirectly. Task 5 makes a real sale on the
   dev stack to see it directly; say both in the PR.

What start-up no longer shows: today this boot test is the only check that boot wires
`operationDescriptionRequired` into `routeCtx.cfg` (~1800) — it expects every ES-common department
reported. Afterwards Veri\*Factu always offers a default, so the list is empty for both packs and
deleting that flag at ~1800 passes every test. Nothing at start-up can observe it while the only
installed filing module has a default. The remaining guard for "required with no default" is the
routes level: `packages/venue-service/src/routes.test.ts`'s existing no-default table (~3913-3950)
and its `false`/`undefined` cases (~3958-3974). List this as a WEAKENED check in the PR
(below). The default's own wiring at ~1800 stays observable (deletion proof below).

Then: `operationDescriptionDefault?: string` on `ModuleRouteContext.cfg`; the routes condition
becomes required AND no default; the GET falls back to `cfg.operationDescriptionDefault`; boot sets
one `const` from `enabledFiscal.venueFields?.defaults?.operationDescription` and passes it at ~1487
(`till`) and ~1800 (`routeCtx.cfg`).

Deletion proofs, one at a time: drop the ~1487 default (boot GET case fails), the ~1800 default
(boot readiness case fails), the GET fallback (case 2 fails), the routes condition (case 1 fails).
Also drop the ~1800 `operationDescriptionRequired` and record in the PR that every test still
passes (the weakened check above).

Checks: the three files above; `pnpm exec vitest run scripts/module-seams.test.ts
scripts/live-subscriptions.test.ts`; `pnpm --filter @waitron/venue-service exec vitest run
src/routes.test.ts src/dashboard/departments src/dashboard/venue-operations-loader.test.ts`;
typecheck `@waitron/module`, `@waitron/venue-service`, `@waitron/server`; the fiscal gates again,
unedited; `pnpm format:check`.

## Task 3 — The dialog opens at full width, without the address copy or the stray line

Files: `apps/dashboard/src/screens/department-receipt-dialog.ts`,
`apps/dashboard/src/widgets/print-paper.ts` (export the strut and its style), `strings.ts`, a new
`department-receipt-dialog.width.test.ts`, the fixture and tests listed under "Changed test checks".

Check free memory first (`memory_pressure | grep free`); these run in real Chromium.

Test first, in the new file (watch 1 fail: today the dialog's width before the preview differs from
after):

1. At 1280 × 900 and 390 × 900 (`page.viewport`), with `previewReceiptDraft` held on a `deferred`:
   record the native `<dialog>`'s width and `.fields`' width while no `.paper` exists; resolve with
   `preview()`; wait for `.paper`; both widths are unchanged within 1px. Then pick 58 mm in
   `previewWidth` and answer a 58 mm preview (`columns: 30`): `.fields`' width is still unchanged.
2. With `venueAddress: ["Calle Mayor 1", "28013 Madrid"]`, the dialog's shadow text contains
   neither line (the fixture's preview text is "Sample", so it cannot supply them); with
   `venueAddress: []`, `[data-test=venue-address]` still reads `receipts.no_address`.
3. In en-GB the dialog's text does not contain "Available at the till.".

Then: `<wt-modal size="wide">`, drop the `--wt-dialog-max-width` rule, add the strut (see
Decisions), render the address block only when there is no address, delete the stray line and its
string (EN and ES; grep the key across `apps/` and `packages/` first). Keep `.layout`'s wrap, so the
preview stacks under the form on a phone.

Checks: `pnpm --filter @waitron/dashboard exec vitest run src/screens/department-receipt-dialog
src/screens/receipt-editor-boundaries.test.ts src/dashboard-app.receipt-dialog.test.ts src/i18n`;
`pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "[Rr]eceipt"` (the
hosted dialog's cases, ~8037-8170, cancel and Escape close among them; read the `Tests` count);
`pnpm exec vitest run scripts/style-token-names.test.ts scripts/native-form-fields.test.ts`;
`pnpm --filter @waitron/dashboard typecheck`; `pnpm format:check`.

## Task 4 — The logo: a small preview, Remove beside it, or "+ Add a logo"

Files: `apps/dashboard/src/widgets/image-upload.ts`, `image-upload.test.ts`,
`image-upload.a11y.test.ts`, `print-paper.ts` (share the paper ground), `strings.ts`,
`department-receipt-dialog.ts` and its tests.

Test first, in `image-upload.test.ts` (real Chromium):

1. `logo` with no image: one button, dashed border, text "+ Add a logo", accessible name exactly
   "Add a logo" (the "+" is `aria-hidden`); a click opens the picker; no `remove-image`.
2. With an image: the picture button's accessible name is "Change logo" and a click opens the
   picker; `remove-image` sits beside it (same row at 1280 px, by `getBoundingClientRect`); clicking
   it sends `image-changed { image: null }` and makes no `imageLibraryRequest` call (spy); the
   open picker's footer has no `remove-image`.
3. Printed size, for a SMALL and a LARGE picture: set the picture's `src` to a 100 × 30 PNG, then
   a 2000 × 600 one, each drawn on a canvas (`toDataURL`), and wait for `load`. The `<img>`'s box is
   the fixed box, `safeWidthDots("80mm") / dpiValue("203dpi")` × `LOGO_MAX_HEIGHT_DOTS / 203`
   inches in CSS px (about 238 × 76), within 1px. The DRAWN picture, computed from `naturalWidth`
   and `naturalHeight` and the box (`object-fit: contain`: scale = min(boxW / naturalWidth,
   boxH / naturalHeight)), is about 238 × 71 for both — the 504 × 151 dots both print at (Decisions,
   measured). A box bounded only by `max-inline-size`/`max-block-size` would draw the small
   picture at 100 × 30, so the small case is the one that fails against the wrong design.
4. `disabled` disables both buttons and closes an open picker (as the full presentation does).
5. `image-upload.a11y.test.ts`: both states, light and dark, no axe violations.

Then in the dialog: `<dashboard-image-upload logo …>` without `label`; delete `receipts.logo`
(EN, ES) after a grep; add the four strings (Decisions). A case in the new width test: with a logo
whose picture is the 2000 × 600 PNG, the dialog's width equals the no-logo width at 1280 and 390.

Deletion proofs: replace the fixed box with `max-*` bounds (the small case of 3 fails); remove the
box's size altogether (both cases of 3 and the dialog width case fail); restore.

Checks: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/image-upload
src/screens/department-receipt-dialog src/widgets/product-editor src/widgets/variant-form
src/widgets/section-details-form src/widgets/include-folder-form src/widgets/product-appearance
src/i18n` and `pnpm --filter @waitron/dashboard exec vitest run src/screens/catalogue-screen.test.ts
-t "image"` (the widget's other users must pass unchanged; check the filter selects cases by the
`Tests` count, and drop it if it selects none); the guards and typecheck of Task 3; `pnpm format:check`.

## Task 5 — Look, docs, backlog

1. Start the dev stack with `wa-wt demo <this worktree's name>` (never `wa-wt reset`, never the
   Santet worktree). Open Departments and zones: a department with no stored description shows no
   "Set up the tax-agency description". Open its Edit receipt: the description field shows the
   default, filled in; the dialog is at its final width from the first frame (screen-record or two
   shots, before and after the preview draws). Choose a logo from the library, then Remove it.
   Check the two `wt-modal` changes: where focus lands on opening (the body, then Tab reaches the
   first switch), and that fields stop at 576px at 1280 without looking cramped beside the preview.
   Then make one cash sale on the dev stack's till in that department and read its record:
   `sqlite3 -readonly <the slot's venue.db> "select descripcion_operacion from registros_facturacion
   order by secuencia desc limit 1"` — expect the Veri\*Factu default. This is the direct start-up
   check of the sale path's wiring (Task 2).
   Save pictures, both themes, at 1280 and 390, with and without a logo, plus the Departments list,
   to `/Users/clintongormley/waitron-campaign-c/a662-shots/after/`. Compare with the mockup and with
Task 0's `before/` pictures.
2. Docs, rewritten to the new behaviour:
   - `docs/developers/design-system.md` ~4411-4416 (Edit receipt): a wide modal that opens with
     focus on its body and holds its fields to the form width; the logo as a picture at its printed
     size with Remove, or "+ Add a logo"; no address copy; a department without its own tax-agency
     description shows, and files, the installed fiscal module's default.
   - `docs/developers/products.md` ~216-218: the department's description, or the fiscal module's
     default when it has none.
   - `docs/backlog/setup.md` ~42-44: the same, beside "the generic location field is not their
     fallback".
   - `design-system.md` ~484-489 says only the Pricing unit chooser reads a modal size token outside
     `wt-modal`; it is true again once this dialog is a `wt-modal` — check, do not edit unless false.
   - Grep `docs/` (not `docs/superpowers/`, `docs/handoffs/`) for "Edit receipt", "tax-agency",
     "Available at the till", "operation description" and fix any other sentence this makes stale.
3. `docs/backlog.md`: delete A662's entry (~3528-3533) and its detail section in
   `docs/backlog/printers.md` (~336-363). Keep the mockup: this plan links it. Each point left open
   becomes its own short entry.

Checks: `pnpm exec vitest run scripts/claude-md-pointers.test.ts`; `pnpm format:check`.

## Changed test checks (copy into the PR, with the spec point)

Server:
- `apps/server/src/boot.departments-readiness.test.ts:22-23, 77-85` (point 1): ES-common expected
  every department reported `department.operation_description_required` → none, and the receipt read
  answers the module's default. WEAKENED in one respect: it was the only check that start-up wires
  `operationDescriptionRequired` into the module routes (`boot.ts` ~1800); with Veri\*Factu always
  offering a default, that wiring is no longer observable at start-up. Remaining guard for "required
  with no default": `packages/venue-service/src/routes.test.ts` ~3913-3974. Gained: start-up now
  checks the default is wired (the receipt read).

Dashboard (point 2 — selector only, the assertions on the element are unchanged):
`querySelector("wt-dialog")` → `"wt-modal"` at `testing/department-receipt-dialog-fixture.ts:93`,
`screens/department-receipt-dialog.client.test.ts:45`, `screens/department-receipt-dialog.test.ts:349`,
`dashboard-app.receipt-dialog.test.ts:170, 184`, `screens/receipt-editor-boundaries.test.ts:63`.

Dashboard (behaviour):
- `department-receipt-dialog.retained.test.ts:369-387` (point 3): asserted the address block shows
  "Calle Mayor 1", then "Plaza Nueva 2" → asserts neither is shown; the re-asked preview and the
  untouched draft stay asserted.
- `department-receipt-dialog.retained.test.ts:530-548` (point 3): asserted each address line as its
  own element → asserts no line is shown; the absent-address sentence half is unchanged.
- `department-receipt-dialog.retained.test.ts:415` (point 5): asserted the text contains
  `receipts.offered_languages` → the key is gone; Task 3 case 3 asserts the sentence is absent.

Departure from the queue's wording to name in the PR: a stored but unusable description files the
default rather than being refused (Decisions).

Any other check that breaks is a STOP: report it, do not edit it. A fiscal or golden test, or a
`scripts/` guard, needing a change is a STOP.

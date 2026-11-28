# O4: the device sheet (lane O, TILL-REDESIGN-PAY-2)

What staff get: on Pay, on a phone or a till, at a table or a Counter, the button at the top right
opens a sheet with the camera already on. The waiter scans the QR stickers of the reader and
printer in their hand one after another; each scan says "Picked up Reader 3", changes that device
at once and leaves the camera on. Under the camera is one dropdown for each device this payment
uses: card reader, receipt printer, payment slip printer, and the cash drawer only on a device
whose profile may open one. Done closes it. Tapping a sticker on a phone that has NFC still
works on every screen, with nothing opened, as it does today.

Sources: spec §7.3, §7.8, §7.11 "The device sheet", §12 (`r` is the device sheet), §13, §14 (the
size and colour rules), §14.1, §14.2 (the sheet, the foot), §14.5; frames `r` 1–3
(`html/r-light.html`, `r-dark.html`, `base.css`); the O4 row and point 2 of
`2026-11-26-o-till-payment-after-pay.md`; row "O · 16" of the pass-1 split ("Keep NFC pickup
from any screen, camera fallback and ownership checks"). Lines are `main` at `3a3d1d86eb`, read,
not run.

## Should this exist?

The owner asked for it on 26 November (spec §7.3): no reader-and-printer row on Pay, a camera
that "scan[s] several QR stickers in a row", and a dropdown only for the devices this payment uses.
Today the button opens lane I's stand-in: the old folded row drawn inside Pay
(`bill-pay-dialog.ts:1127-1131`, `:1153-1160`), whose QR button films one sticker and then closes
the camera (`pay-equipment.ts:95-124`, `equipment-scanner.ts:35`). The simplest alternative is to
keep that row and only let the camera keep going. That would leave the owner's approved frame
unbuilt and the drawer missing. The extra cost is two shared pieces: an outlined dropdown and a
framed camera. O5 and O13 need the dropdown too. Approval: the spec's Status line records the
owner's approval of pass 1, which includes §7.3. The order plan was cleared by the watcher. The
size of this PR is in "Split".

## What it keeps (the money and safety rules)

- **Who may open the drawer does not change.** The server decides it from the profile
  (`apps/server/src/receipt-print.ts:109-116`, `:217-220`). The sheet only hides the drawer
  dropdown on a profile without `open-cash-drawer`. It reads the start read's `capabilities`
  (`till-app.ts:3720`, `:11436`), never the equipment read's `opensDrawer`. `opensDrawer` is false
  until a drawer is assigned (`receipt-print.ts:125-131`), so it would hide the very list used to
  assign one. Today the server lists drawer printers on any profile that lists them, whatever its
  flags (`apps/server/src/device-equipment.ts:288-300`).
- **Ownership checks stay as built.** Picking a device another phone holds from the list first
  asks "Take it?" (`pay-equipment.ts:327-336`, `:419-456`). The server refuses a list choice of
  such a device unless that question was answered (`device.equipment_held`,
  `api/device-session-api.ts:418-424`). A reader with a payment in progress on another device can
  be seen but not picked (`pay-equipment.ts:351`). A drawer or an invoice printer is never held
  (`device-equipment.ts:296`). Choices still go through today's `PUT /api/device/equipment`. The
  server is not changed.
- **NFC on any screen.** The app listens on every screen except ☰ Equipment
  (`till-app.ts:3817-3821`). It accepts a reader sticker for the reader and a printer sticker for
  the receipt or slip printer (`:3823-3849`). Away from Pay it shows the result as a message
  that pops up (`:24830-24836`). None of this changes. The sheet shows the same message as its
  notice. **Allow NFC** stays, as a text link under the hint, while the browser's NFC permission
  is "prompt" (today's `askNfc`, `pay-equipment.ts:286-298`). Without it a tap does nothing.
- **The camera as the fallback.** Where `canFilm()` is false, or the camera is refused, the sheet
  shows the scanner's unavailable line (`wt-qr-scanner.ts:181-193`) and the dropdowns. The camera
  films only while the sheet is open: the scanner starts as soon as it is on the page
  (`wt-qr-scanner.ts:73-76`), so the sheet draws it only while open.
- **Kept although `r` does not draw them:** why the phone lost its reader (`readerReason` and
  hint, `pay-equipment.ts:458-470`), above the camera; the printer warning under the receipt
  dropdown when the receipt cannot print now (`:23-29`); Charge held while a change is out or no
  reader is ready (`bill-pay-dialog.ts:1210-1213`); the reader the phone picks up by itself when
  there is only one (`state/pay-equipment.ts:137-147`); the simulator's reader shown, never
  chosen (`pay-equipment.ts:389-400`); a till paying from its start read keeps its list of
  readers (`bill-pay-dialog.ts:2079-2098`), drawn in the reader's place.
- **The rule that opens the row by itself** (`bill-pay-dialog.ts:614-616`, `payRowWantsOpen`)
  opens the sheet instead. See question 2.

## The sheet, element by element (`r` 1–2)

Sizes below are measured from `r-light.html`. Rounded corners and font sizes follow §14's rule.

- **Device button**: lane I's `quietEquipmentButton` (`quiet-pay.ts:205-220`) becomes the
  trigger of lane D's shared sheet. That is `wt-row-actions bottom-sheet sheet-variant="menu"`
  (`packages/ui/src/components/wt-row-actions.ts:257-258`), with the content marked
  `data-keep-open`. Its `trigger` part: 44 px square (`--wt-tap-min`), 1 px `--wt-color-border`,
  `--wt-radius-md`, lane I's `pay-contactless` icon (question 3). It turns
  `--wt-color-surface-lifted` while open, set from `wt-row-actions-toggle`.
- **Sheet**: the shared sheet as built: dimmed screen (`--wt-color-scrim`), corners
  `--wt-radius-lg`, handle (`--wt-menu-sheet-handle-*`, `--wt-color-surface-sunken`). The sheet
  is `--wt-color-surface`. Its height reaches 12 px (`--wt-space-3`) under the top bar, as §7.11
  asks. The shared sheet only caps height (`wt-row-actions.ts:141-147`), so the device sheet sets
  a minimum: `calc(100dvh - var(--wt-tap-min) - 2 * var(--wt-space-3))`.
- **Camera**: `till-equipment-scanner` with the new `framed` look (O4a). 230 px high, 16 px
  (`--wt-space-4`) from each side, 6 px from the handle, corners
  `calc(var(--wt-radius-md) + var(--wt-space-1))`. Four white corner brackets: 34 px, 4 px lines,
  8 px rounded outer corner, 40 px from top and bottom and 70 px from the sides. The caption
  "Point at a device's QR sticker · scan as many as you need" sits along its foot,
  `--wt-font-size-sm`, 10 px up. The ground, brackets and caption are fixed camera colours, from
  two new tokens with the same value in both themes (`#15171b` and `#e9ecf1`).
- **Hint**, muted `--wt-font-size-sm`, 8 px above and 20 px from the sides: "Or choose below." The
  second sentence, "Tapping a device on the phone works on any screen.", is added only where the
  browser has NFC (`nfcPermission !== null`, `till-app.ts:3808`). On an iPhone or a till it
  would be false.
- **Notice** (`r` 2), in the hint's place: `--wt-radius-md`, 10 × 14 px padding, `check` icon,
  "Picked up Reader 3" in bold `--wt-font-size-md`. It is drawn as the course heading's quiet
  green: `--wt-color-tab-ready-tint` behind `--wt-color-text`, the check in `--wt-color-success`
  (`wt-course-heading.ts:43-51`). §7.11 names `--wt-color-success`, which is the dark green, not
  a tint. `payNotice` (`pay-equipment.ts:46-83`) takes this look wherever it shows. An error
  keeps today's red.
- **Dropdowns**: `wt-combobox variant="outlined"` (O4a), one per role the device has anything
  listed for, as ☰ Equipment decides (`equipment-dialog.ts:381-388`). Order: card reader (only
  where the profile takes a card on a reader), receipt printer, payment slip printer, then the
  cash drawer (only with `open-cash-drawer`). Each is 56 px (`--wt-field-height`), 16 px from the
  sides, 8 px apart, with a 1 px `--wt-color-border` line, `--wt-radius-md` corners, on
  `--wt-color-surface`. The label is muted `--wt-font-size-sm` (today's `equipment.*` words,
  `strings.ts:1114-1118`). The device's name is `--wt-font-size-lg`, `--wt-font-weight-medium`.
  `chevron-down` sits at the right end. A dropdown a scan just changed gets a 2 px
  `--wt-color-primary` border and `--wt-color-surface-lifted` (`highlight`), until the next scan
  or until the sheet closes.
- **Done**: `wt-button` primary, full width, 52 px (`calc(var(--wt-tap-min) + var(--wt-space-2))`,
  as `wt-foot-button-bar.ts:13`). Padding 8 px, 16 px, 24 px. No line above it.

**Dropped from today:** the "Reader and printer" heading and summary line, **Change**, the QR and
NFC buttons, and the camera's own page with Back (`pay-equipment.ts:95-124`, `:263-325`). The
camera now films on the sheet itself. `till-pay-equipment` stays for now: three screens still
draw it (the Cash/Other card machine step, `bill-pay-dialog.ts:1985`; the confirmation step,
`:2336`; the presented bill's sheet, `presented-pay-dialog.ts:683`). O7, O13 and lane I's
presented-bill slice replace those screens. The last of them deletes it.

**Counter and the wide till.** Counter's Pay uses the same screen (#4516, `counterPayPanel`), so
it gets the sheet too. On a till Pay is still full screen until lane E's 14a places it in the
order's column. Until then the sheet is as wide as the window. Today a till's button opens nothing
once its equipment is read: the row is phone-only (`bill-pay-dialog.ts:2037`) and the list of
readers needs two or more (`:2082`). With O4 the till gets the same dropdowns, and its notice too
(today phones only, `till-app.ts:12436-12438`).

## Split

| PR | What | Size |
| --- | --- | --- |
| O4a | Shared pieces; nothing staff see changes | ~120 production / 220 test lines, ~3 h |
| O4b | The sheet on Pay, its wiring, the tests moved, guides | ~230 / 350, plus ~70 moved assertions, ~3.5–4 h |

**O4a.** (1) `wt-combobox` gains `variant="outlined"`, laid out as above, and `highlight`; the
filled look is unchanged. (2) `wt-qr-scanner` gains `framed`: the fixed height, the brackets
(hidden from screen readers) and the caption over the picture. The new camera tokens go in
`packages/ui-core/src/tokens/colors.css` (every theme block) and `structure.css`
(`--wt-camera-height` and the bracket sizes, beside `--wt-menu-sheet-handle-width`).
`wt-master-key-input` does not set `framed` and is unchanged. (3) `till-equipment-scanner` gains
`keep-going`. It does not stop after a code it keeps. The same sticker is not sent again until a
different code or no code has been read for 2 seconds. Without this pause, a sticker held in view
would send a choice every 250 ms (`wt-qr-scanner.ts:7`). (4) The takeover question moves out of
`TillPayEquipment` into an exported function, so the sheet uses it rather than a copy. (5)
`design-system.md`'s primitives and tokens tables; the workbench (`packages/ui/demo/main.ts`).

**O4b.** New `apps/till/src/widgets/device-sheet.ts` (`till-device-sheet`). It takes the
equipment, which roles to show, saving and refusals, the notice, the reason line, `canScan`,
`askNfc` and the fixed reader. It sends today's `pay-equipment-pick`, `pay-equipment-sticker` and
`pay-equipment-nfc`. `PayEquipmentRole` (`pay-equipment.ts:31`) widens to the four roles. So
does the app's count of picks (`till-app.ts:3863`), which today has only two keys.
`bill-pay-dialog.ts` (2,431 of its 2,500 cap) swaps the button and the inline row for the sheet;
deleting the inline branch pays for the new properties. `till-app.ts` (25,334 of 25,500) gains
only the two new properties: the drawer flag, and the notice on a till. `quiet-pay.ts` loses the
button.

## Tests, written first

- **O4a**: `wt-combobox.test.ts` (outlined and highlight paint their tokens; the filled look is
  unchanged), `.a11y.test.ts` and `.forced-colors.test.ts` (outlined, highlight, disabled, both
  themes). `wt-qr-scanner.test.ts` and `.a11y.test.ts` (framed: tokens, height, brackets unnamed;
  a refusal still shown). `equipment-scanner.test.ts`: two stickers in a row send two events; the
  same sticker held in view sends one; the first again after a second sticker sends again. The
  failing case is the one that sends every frame. `colors.test.ts`: the new tokens in each theme.
- **O4b**, new `device-sheet.test.ts` and `.a11y.test.ts` (`r` 1, `r` 2, the drawer shown, the
  takeover question, camera unavailable; both themes):
  - The camera is on only while the sheet is open: the fake camera's tracks are stopped on Done.
  - Rows by role. Real control: a profile that lists drawer printers but lacks `open-cash-drawer`
    shows no drawer row. With the flag it shows one.
  - A held reader asks first; a busy one cannot be picked; the printer warning shows.
  - Allow NFC shows only while permission is "prompt"; the hint's NFC sentence shows only with
    NFC.
- `till-app-handheld-pay.test.ts`: two stickers scanned in the open sheet send two `via: "scan"`
  choices, show "Picked up Reader 3", and leave the camera on. An NFC tap with Pay open and the
  sheet closed still picks up. The sheet opens by itself as question 2 decides.
- One Counter case in `till-app-counter-payment-window.test.ts`, one case at 1280 px.
- `till-app.nfc.test.ts` is kept as strict as it is.
- **Moving tests**: rg finds the old row in `till-app-handheld-pay.test.ts` 37 times,
  `bill-pay-dialog.test.ts` 30, `till-app-bill-payments.test.ts` 25 and
  `till-app-pay-for-items.test.ts` 6. Those reached through quiet Pay go through a new
  `openDeviceSheet(el)` in `apps/till/test/bill-pay-app.ts`, beside `:522`. Those on the steps
  that keep the old row stay.

**Words.** New `device_sheet.*` keys (caption, hint and its NFC sentence, Done) in English and
Spanish, in `strings.ts`. The guides' "Card and reader" paragraph is rewritten in both languages
(`apps/server/src/guide/en/table-service.md:1062-1064`, `es/…:1124-1128`). It says: the button
opens the camera; scan the reader and the printers you hold, one after another, or choose from the
lists; on a phone with NFC, tap a sticker on any screen. "Use **Change**" goes. rg finds no help
bubble that names this row. `design-system.md` gets a paragraph under "Full-screen panels and
payment controls" (`:890`).

**Pictures**, never committed, beside `r` 1 and 2: 390 × 844, light and dark. Also 844 × 390, a
till at 1280 × 800 and 800 × 1280, English and Spanish. States: after a scan; with the drawer; a
reader taken by another phone; the takeover question; camera refused. Differences to list:
- the icon (question 3);
- the notice colours;
- the hint's NFC sentence;
- font weights at the declared values;
- the till's sheet as wide as the window.

Lane P's finish review says "ready for the owner" first.

**Review and landing.** Both PRs take the full `/finish-branch` wave with two Codex run-it reviews.
O4b changes how a card payment's reader is chosen and where the drawer list shows. **Lane O lands
both**: the server, the request to change a device and how a receipt or invoice is issued are
unchanged. `r` 3 goes to O5 (question 1), which keeps it that way.

## Questions for the watcher

1. **`r` 3 (the invoice printer in the receipt printer's place).** A printed full invoice carries
   its printer in the invoice choice (`pagePrinterId`). The server checks that printer against the
   device's invoice printer (`apps/server/src/invoice-choice-delivery.ts:42-47`). Changing it from
   Pay changes how an invoice is delivered. Recommended: build `r` 3 in O5, which owns the full
   invoice's printer, so O4 changes no invoice path. Until then the sheet keeps the receipt printer,
   as today's row does (`pay-equipment.ts:409-417`).
2. **When nothing is ready.** Today the row opens by itself when there is no ready reader or the
   receipt cannot print. Recommended: the sheet opens by itself in those same cases, once each time
   Pay opens, never while the phone is still picking up its only reader by itself.
3. **The button's icon.** §7.11, which wins, says three arcs; §14.5 says "a phone with waves"; the
   frame draws both together. Lane I built three arcs (`quiet-pay.ts:15-16`). Recommended: keep
   lane I's icon, listed as a difference.
4. **Who builds the outlined dropdown.** Recommended: O4a, once, in `packages/ui`, for O5's printer
   dropdown and O13's machine dropdown to reuse.
5. **☰ Equipment** shows a cash drawer list on a profile that may not open one
   (`equipment-dialog.ts:46-52`, `:381-388`). The assignment does nothing there
   (`receipt-print.ts:109-116`), but staff may think it does. Recommended: the same rule in ☰, two
   lines in O4b.
6. **Split into O4a and O4b?** Recommended: yes. Together they are about seven hours.

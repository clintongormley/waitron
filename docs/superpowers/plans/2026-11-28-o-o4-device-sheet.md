# O4: the device sheet (lane O, TILL-REDESIGN-PAY-2)

**Cleared by the watcher at 03:48 on 28 November** (lane O `questions.md`), with its five
recommendations taken: frame `r` 3 goes to O5; receipt and slip rows are hidden on a profile without
`print-receipt`; lane I's icon stays, listed as a difference; ☰ Equipment gets the same drawer rule
in O4b; and the work is cut into O4a, O4b and O4c.

What staff get, once the three PRs land:
- On Pay, the top-right button opens a sheet with the camera already on. A table or a Counter, a
  phone or a till: all the same.
- The waiter scans the QR stickers of the reader and printers in their hand, one after another.
  Each scan says "Picked up Reader 3", changes that device and leaves the camera on.
- Under the camera is one dropdown per device this payment uses. The cash drawer is there only
  where the device's profile may open one; it decides which drawer this device's payments are
  counted into (`apps/server/src/bill-payment-settlement.ts:449-466`).
- Done closes the sheet. A phone with NFC still picks up a sticker tapped on any screen.

Sources: spec §7.3, §7.8, §7.11 "The device sheet", §12, §13, §14, §14.2, §14.5; frames `r` 1–2
(`html/r-light.html`, `base.css`); the order plan's O4 row and point 2; the pass-1 split's row
"O · 16". `r` 3 moves to O5 (question 1). Lines are `main` at `3a3d1d86eb`, read, not run, except
where a run is named.

## Should this exist?

The owner asked for it on 26 November (§7.3): no reader-and-printer row on Pay, a camera that
"scan[s] several QR stickers in a row", and only the dropdowns this payment uses. The spec's
Status line records the owner's approval; the watcher cleared the order plan.

Today the button opens lane I's stand-in: the old folded row inside Pay
(`apps/till/src/widgets/bill-pay-dialog.ts:1127-1131`, `:1153-1160`). Its QR button films one
sticker and closes the camera (`pay-equipment.ts:95-124`, `equipment-scanner.ts:35`). The simplest
alternative is to keep that row and only let the camera keep going. That leaves the approved frame
unbuilt and gives no drawer. The extra cost is two shared pieces, a boxed dropdown and a framed
camera, and O5 and O13 need the dropdown anyway.

## The rules it keeps

- **Who may open the drawer does not change.** The server decides it from the profile
  (`receipt-print.ts:109-116`, `:217-220`). The sheet hides the drawer row without
  `open-cash-drawer`, read from the start read's `capabilities` (`till-app.ts:3720`, `:11436`).
  It does not use `opensDrawer`, which is false until a drawer is assigned
  (`receipt-print.ts:125-131`). Today the server lists drawer printers whatever the profile's
  flags (`device-equipment.ts:288-300`).
- **The receipt and slip rows follow `print-receipt` the same way.** Without that flag the server
  prints no owed receipt or slip from the device (`receipt-print.ts:92-103`, called at
  `owed-receipts.ts:264` and `payment-slip-print.ts:191`), and the till hides its slip button
  (`till-app.ts:11686-11692`).
- **Ownership checks.** Picking a device another phone holds asks "Take it?" first, through the
  existing `equipmentTakeover` (`equipment-dialog.ts:55-91`), not a second copy. The server
  refuses a list choice of a held device without `takeOver`
  (`packages/payments/src/device-readers.ts:300-305`; `device-equipment.ts:404-411`, worded at
  `:438-443`). A reader busy with another device's payment can be seen, not picked
  (`pay-equipment.ts:351`). Choices still go through `PUT /api/device/equipment`; the server is
  unchanged.
- **Nothing moves while money is moving.** The trigger, dropdowns and camera are inert while
  `busy || confirmationLocked`, as today (`quiet-pay.ts:216`, `bill-pay-dialog.ts:2048`).
  `wt-row-actions` has no `disabled` setting today, so O4a adds one. A payment that starts while
  the sheet is open closes it.
- **NFC on any screen** is unchanged (`till-app.ts:3817-3849`, the message that pops up away from
  Pay `:24830-24836`). **Allow NFC** stays as a link while permission is "prompt"
  (`pay-equipment.ts:286-298`).
- **Camera fallback.** The scanner starts filming the moment it is on the page
  (`wt-qr-scanner.ts:73-76`), so the sheet draws it only while open. Without `canFilm()`, or with
  the camera refused, there is no dark box: only the unavailable line and the dropdowns.
- **Kept although `r` does not draw them:**
  - the line saying why the phone lost its reader (`pay-equipment.ts:458-470`);
  - the printer warning under the receipt row (`:23-29`);
  - Charge held while a change is out (`bill-pay-dialog.ts:1210-1213`);
  - the reader picked up by itself when it is the only one (`state/pay-equipment.ts:137-147`);
  - the simulator's fixed reader (`pay-equipment.ts:389-400`), and on a till its outcome radios
    (`bill-pay-dialog.ts:1153-1154`).
- **A `reader.not_held` refusal** today opens the row with the error under the reader
  (`openEquipmentRow`, `bill-pay-dialog.ts:626`, called from `till-app.ts:22975-22991`). It opens
  the sheet instead, with the error under Card reader.
- **When nothing is ready.** The sheet opens by itself only when Charge is held for the reader.
  A printer problem (`pay-equipment.ts:23-24`) marks the button through `wt-row-actions`' `badge`
  slot instead.

## The sheet, element by element (`r` 1–2, measured in `r-light.html`)

- **Why lane D's sheet.** `wt-row-actions bottom-sheet sheet-variant="menu"` already has what the
  device sheet needs: the dimmed screen, closing on a tap outside it or Escape, handing focus back
  to its trigger, `data-keep-open`, `show()` and `hide()` (`design-system.md:989`, `:1011-1019`).
  The rising full-screen panel (#4545, merged as `3a3d1d86eb`) is a layout piece only. It fills
  its container and has no dimming, trigger or closing (`wt-full-screen-panel.ts:11-23`, `:90-96`).
- **Device button and sheet**, as one helper in new `apps/till/src/widgets/device-sheet.ts`, so
  O7, O13 and the presented bill can reuse it. `bill-pay-dialog.ts` is 2,431 of its 2,500 lines.
  - The button is the sheet's `trigger` part: 44 px (`--wt-tap-min`), a 1 px
    `--wt-color-border` line, `--wt-radius-md`, lane I's `pay-contactless` icon (question 3). It
    turns `--wt-color-surface-lifted` while open.
  - The sheet is the shared one: `--wt-color-scrim`, `--wt-radius-lg` corners, the handle. It is
    `--wt-color-surface`, with a minimum height of
    `calc(100dvh - var(--wt-tap-min) - 2 * var(--wt-space-3))`, so it starts 12 px under the top
    bar as §7.11 asks.
- **Camera**: `till-equipment-scanner` with `framed` and `keep-going`.
  - 230 px high, 16 px from the sides, corners `calc(var(--wt-radius-md) + var(--wt-space-1))`.
  - Four white corner brackets, 34 px with 4 px lines, set 40 px and 70 px in from the edges.
  - The caption along its foot is `--wt-font-size-sm`: "Point at a device's QR sticker · scan as
    many as you need".
  - Fixed camera colours from two new tokens, the same in both themes (`#15171b`, `#e9ecf1`).
- **Hint**, muted `sm`: "Or choose below." Where the browser supports NFC it adds "On a phone
  with NFC, you can also tap a sticker on any screen." Support is all that
  `nfcPermission !== null` tells (`state/equipment-nfc.ts:24-28`), not whether the phone has NFC.
  The added sentence goes once an `equipment.nfc_unavailable` notice has shown
  (`till-app.ts:3798-3800`).
- **Notice** (`r` 2), in the hint's place: `--wt-radius-md`, `check`, "Picked up Reader 3" in bold
  `md`.
  - Text `--wt-color-text` on `--wt-color-tab-ready-tint`, the check in `--wt-color-success`, as
    the course heading (`wt-course-heading.ts:43-51`).
  - §7.11's `--wt-color-success` text would be 3.9:1 on that tint in light, against 12.8:1 for
    `--wt-color-text`. Dark: 5.3:1 against 10.5:1. Computed by WCAG's formula from
    `colors.css:12,25,135,150,163,266`; black on white gave 21:1 as a control.
  - `payNotice` (`pay-equipment.ts:46-83`) takes this look. An error stays red.
- **Dropdowns**: `wt-combobox variant="boxed"`, one per role that has something listed. Which roles:
  the visibility rule of ☰ Equipment (`equipment-dialog.ts:381-388`), exported rather than copied,
  plus the two flags above. Order: card reader, receipt printer, payment slip printer, cash drawer.
  - 56 px (`--wt-field-height`), 16 px from the sides, 8 px apart.
  - A 1 px border, `--wt-radius-md`, on `--wt-color-surface`.
  - A muted `sm` label (`strings.ts:1114-1118`) over the name in `lg`, medium weight, and
    `chevron-down`.
  - After a scan, **every** role whose chosen device changed between the reads before and after
    gets a 2 px `--wt-color-primary` border on `--wt-color-surface-lifted`. A printer sticker
    picks up as receipt and slip printer together (`device-equipment.ts:388-401`), though the
    app counts every printer scan as a receipt pick (`till-app.ts:3836`).
  - Not "outlined": `wt-input variant="outlined"` (#4491) is 44 px with its label hidden, on
    `--wt-color-bg` (`wt-input.ts:101-115`). `boxed` takes its border, focus, error and disabled
    styles from the shared `packages/ui-core/src/field-styles.ts`, and `design-system.md` says
    how the two differ.
- **Done**: primary, full width, 52 px (`wt-foot-button-bar.ts:13`), padding 8, 16 and 24 px, with
  no line above it. It closes the sheet through `hide()`.

**Dropped:** the row's heading and summary, **Change**, and the QR and NFC buttons
(`pay-equipment.ts:263-325`). The old row and its separate camera page stay where they are still
drawn:
- the presented bill (`presented-pay-dialog.ts:431`, `:683`);
- the confirmation step (`bill-pay-dialog.ts:1064-1065`, `:2336`);
- the Cash and Other card machine step (`:1985`).

O7, O13 and lane I's presented-bill slice replace those, and the last one deletes the old row.

## Three PRs, each leaving `main` working

| PR | What | Size |
| --- | --- | --- |
| O4a | Shared pieces only; nothing staff see changes | ~130 production / 240 tests, ~3 h |
| O4b | Phones: the sheet replaces the row on Pay; the till keeps today's button | ~190 / 300 + moved tests, ~3 h |
| O4c | The till gets the sheet | ~60 / 150, ~1.5 h |

**O4a**:
1. `wt-combobox variant="boxed"`, with a `highlight` setting.
2. `wt-qr-scanner framed`, with the camera tokens in `colors.css` and `structure.css`.
   `wt-master-key-input` does not set it.
3. `till-equipment-scanner`: `keep-going`, which does not resend the same sticker until a
   different code, or no code, has been read for 2 s. Without the pause, a sticker held in view
   sends a choice every 250 ms (`wt-qr-scanner.ts:7`). It also gets a `caption` property: today
   its words are fixed keys (`equipment-scanner.ts:22-25`).
4. A `disabled` setting on `wt-row-actions`.
5. The workbench, and `design-system.md`'s tables.

**O4b**: `device-sheet.ts` and the four roles. `PayEquipmentRole` (`pay-equipment.ts:31`)
becomes the existing `EquipmentRole` (`api/device-session-api.ts:177`), and so does the app's
count of picks (`till-app.ts:3863`). `quiet-pay.ts` loses its button. The till's branch keeps the
row as it is today.

**O4c**, the till:
1. It holds Charge while a change is out. Today the hold is phone-only
   (`bill-pay-dialog.ts:824-826`).
2. It reads the equipment again when Pay opens. Today only a phone does (`till-app.ts:21531`,
   `:22088`).
3. It shows the reader row whenever the profile has `integrated-card-payment`. Today's
   `cardReader !== "none"` (`bill-pay-dialog.ts:1099`) is false with no ready reader
   (`till-app.ts:12584-12587`), which would hide the very row used to choose one.
4. The notice shows on a till too. Today it shows on phones only (`till-app.ts:12436-12438`).

Until 14a puts Pay in the order's column, the sheet is as wide as the window.

## Tests, written first

- **O4a, first, in real Chromium:** a boxed dropdown inside the sheet. Pick an option, then pick a
  held one and answer "Take it?". The sheet stays open throughout (`data-keep-open`), and `hide()`
  closes it.
- **O4a, the pieces:**
  - The boxed look and `highlight` paint their tokens; the filled look is unchanged. Its
    accessibility and forced-colours files cover both themes.
  - `framed` paints its tokens and keeps the brackets unnamed.
  - `keep-going`: two stickers send two events. One sticker held in view sends one. An earlier
    "not one of ours" message clears after an accepted sticker. Today it is never cleared
    (`equipment-scanner.ts:30-43`).
  - The sheet's `disabled` setting stops it opening.
  - The new tokens in each theme.
- **O4b**, new `device-sheet.test.ts` and its accessibility file (`r` 1, `r` 2, drawer,
  "Take it?", camera unavailable; both themes):
  - `getUserMedia` is not called before the sheet opens. The camera's tracks stop on Done, a tap
    on the dimmed area, Escape, and Pay closing.
  - With no camera there is no dark box.
  - Rows by flag. Control: a profile listing drawer printers without `open-cash-drawer` shows no
    drawer row; with the flag it shows one. The same pair for `print-receipt` and the receipt and
    slip rows.
  - A printer sticker that picks up both roles highlights both.
  - The sheet is inert on a busy Pay. A payment starting with the sheet open closes it.
  - `reader.not_held` opens the sheet with the error under Card reader.
  - It opens by itself only when Charge waits for the reader. A printer problem marks the button.
  - The hint's NFC sentence, and its removal after `nfc_unavailable`.
- **O4b**, `till-app-handheld-pay.test.ts`: two stickers in a row send two `via: "scan"` choices
  and leave the camera on. An NFC tap with the sheet closed still picks up. One Counter case.
- **O4c**: Charge held while a change is out, the re-read on opening, the reader row with no
  ready reader, and cases at 1280 × 800.
- **Moving tests:** `rg -c -e 'till-pay-equipment|data-pay-equipment|data-pay-qr|data-pay-scan|data-pay-nfc|data-pay-take|data-quiet-pay-equipment|data-pay-reader-|data-pay-note|data-pay-printer-warning'`
  counts 52 lines in `till-app-handheld-pay.test.ts`, 30 in `bill-pay-dialog.test.ts`, 25 in
  `till-app-bill-payments.test.ts`, 8 in `bill-pay-dialog.a11y.test.ts` and 6 in
  `till-app-pay-for-items.test.ts`.
  - Those reached through Pay go through a new `openDeviceSheet(el)` beside
    `apps/till/test/bill-pay-app.ts:522`.
  - Those on the steps that keep the old row stay as they are.

**Words.** New `device_sheet.*` keys in English and Spanish. The guides' "Card and reader"
paragraph is rewritten (`guide/en/table-service.md:1062-1064`, `es/…:1124-1128`): scan the reader
and printers in your hand, one after another, or choose from the lists. "Use **Change**" goes.
`design-system.md` gets a paragraph under "Full-screen panels and payment controls" (`:890`).

**Pictures**, never committed, beside `r` 1–2:
- Phone 390 × 844 in light and dark, and 844 × 390. The till at 1280 × 800 and 800 × 1280, in
  O4c. English and Spanish.
- States: after a scan; the drawer; a reader lost; "Take it?"; the camera refused.
- Differences listed: the icon, the notice colours, the hint's words.

Then lane P, another lane that reads the pictures against the frames for the design, says "ready
for the owner".

**Review and landing.** All three take the full `/finish-branch` wave with two Codex run-it
reviews, because they change how a card payment's reader is chosen and where the drawer is
chosen. **Lane O lands all three.** The server, the request that changes a device, and how a
receipt or invoice is issued are unchanged.

## Questions for the watcher

1. **Frame `r` 3**, the invoice printer in the receipt printer's place. A printed full invoice
   carries its printer (`pagePrinterId`), which the server checks against the device's invoice
   printer (`invoice-choice-delivery.ts:42-47`). Recommended: O5 builds it; this change adds it to
   O5's row in the order plan.
2. **Hide the receipt and slip rows without `print-receipt`?** Recommended: yes, as above.
3. **The icon.** §7.11, which wins, says three arcs; §14.5 says a phone with waves; the frame
   draws both. Recommended: keep lane I's three arcs (`quiet-pay.ts:15-16`), listed as a
   difference.
4. **☰ Equipment** shows a drawer list on a profile that may not open one
   (`equipment-dialog.ts:46-52`, `:381-388`). The assignment does nothing there
   (`receipt-print.ts:109-116`). Recommended: the same rule in ☰, a few lines in O4b.
5. **Three PRs, O4a, O4b and O4c?** Recommended: yes, about 7.5 hours in all.

# Enter measured amounts at the till

At Counter or a table, tap a product sold by amount. Type into the field labelled with its name or use the till keypad. The unit appears inside the field. Adding 250 ml makes one line, and tapping its amount or the last-added line lets you edit it before sending. A weighed product uses the same field. Whole portions keep their existing quick controls.

The owner first asked for a single value in small question 8 on 24 November. In Lane E's questions.md at 10:19 on 25 November, the watcher recorded the owner's revision verbatim: “change of plan. the +- steppers don't make sense here. you enter the volume directly, so show a text field with the name of the product and the field, with the unit embedded in the field (but not editable). don't put "introduce la cantidad" on the handheld button”. The watcher confirmed the work at 14:07 and cleared the mixed-order summary at 15:04. At 15:22 the watcher cleared the layout and input review fixes, replacement pictures on a longer menu, and up to 725 added TypeScript lines. The owner's approval of those pictures is required before landing.

## One pull request

- In `apps/till/src/widgets/`, reuse the whole-portion decision in the product pick, basket and last-added controls. In `tender-pay.ts`, use the shared fixed-unit input with the existing keypad, exact quantity validation and variant picker. Keep entry available during a Counter payment hold, and respect send and edit locks. Keep the table amount panel in reach and scroll the selected tile clear if the panel overlaps it. Reveal the Counter controls when opening them. A whole amount takes digits without separators. Keep the unit visible before typing.
- In `basket.ts` and `modifier-picker.ts`, reuse the current line editor and prefill the amount. In the table screen and `state/new-order-count.ts`, show each measured line with its actual amount and unit. Count it as one item, and keep counting whole portions by their quantity. At phone width a single measured line reads, for example, **Orange juice 250 ml**.
- Keep the unit on the parked line and on reopen in `apps/server/src/working-order-held-read.ts`. Price refresh, late send and the table draft show the measured amount. Use the existing storage, sale, split and serving rules. The backlog records the remaining partial adjustment, partial payment and set-menu replacement work under Remaining actions on measured dishes.

## Checks and pictures

- Counter browser tests enter 0.125 L during a payment hold by keyboard and keypad, select a variant and open the existing amount from the basket. Table tests reject fractional ml, add and edit a single ml line, check kg entry, and show a mixed measured and counted order. Existing tests cover counted steps, send locks, Cancel and closing an unchanged edit.
- Server tests park and reopen 250 ml at €0.03/ml and check the saved unit and €7.50 beside a weighed line. Till reopen, price refresh, late-send and serving tests check their own displays or behavior.
- Capture Counter and table entry and result at 390 and 1280 widths in both languages and both themes, using a longer menu. Verify the unit's position, the selected table tile, the controls in view and the handset summary. Update both user guides and the developers' product notes, and remove A821f from the backlog.

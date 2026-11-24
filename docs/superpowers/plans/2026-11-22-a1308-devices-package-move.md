# A1308 devices and printing package move

**22 November 2026, 19:43.** The watcher retired dv17. See the [build order](2026-11-08-a1308-build-order.md#batch-2--area-slices) for the current sequence.

The watcher assigned this assessment on 22 November at 18:24. The proposed move would give devices and printing their
own CI selection. Base `84a5ba27c6` includes dv16 (#3823), refunds os12/os13
(#3962/#3971) and the correction-slip fix (#4077). [Build order](2026-11-08-a1308-build-order.md#batch-2--area-slices) · [dv17 plan](https://github.com/clintongormley/waitron/blob/f1842d0ffdf8f284ac3fb096c4a6a9f70e602de7/docs/superpowers/plans/2026-11-08-a1308-dv17-drawer-opens.md)

## Package and size

Put the area in `packages/devices` as `@waitron/devices`, with explicit exports for `apps/server`. The starting inventory
is dv1's devices and joining, printer and agent, A4, receipt and drawer, themes and printer offers, along with their
tests and support. The host keeps its route registration order. Preserve the schema, wire answers, permissions,
fiscal behaviour and transactions. [dv1 file list](https://github.com/clintongormley/waitron/blob/f8d93fd328/docs/superpowers/plans/2026-11-08-a1308-dv1-devices-row.md#area-files-for-the-package-move)

The TypeScript import scan at that base counts 35 production files (11,378 lines), 57 tests (53,890 lines) and five
support files (308 lines). Production imports 66 other server modules, 55 with a value or side-effect import. Tests
and support bring that to 133. The scan finds 479 imports or re-exports into the candidate set from 301 retained server
files and scripts. These are relocation counts. The handwritten work for shared code and fixtures is still unsized.
[Inventory in Lane H's `receipts/a1308-devices-package-move/inventory.json`]

Both area lists claim `receipt-print.ts`, `receipt-preview-api.ts`, `orders-reprint.ts`, `invoice-page-print.ts`,
`invoice-page.ts` and `invoice-print.ts` (2,136 production lines), their sibling tests and `tender-refund-drawer.test.ts`.
That includes the main file dv17 edits. Settle ownership once as part of the shared design. The build order records the
owner's 19 November 13:46 decision to design the shared pieces before moving orders and sales.
[Orders and sales inventory](https://github.com/clintongormley/waitron/blob/f8d93fd328/docs/superpowers/plans/2026-11-08-a1308-os1-order-numbers.md#area-files-for-the-package-move) · [Owner decision](2026-11-08-a1308-build-order.md#L92)

## Open questions about shared work

- Where should the kitchen waiting query and print trouble checks live? Both files import each other today, and
  alert, housekeeping, staff-notice and station-output code also calls the checks. The work for those callers is unsized.
  [Print trouble](../../../apps/server/src/print-job-trouble.ts#L14) · [Kitchen printing](../../../apps/server/src/kitchen-print.ts#L63)
- Which package owns the station-move parser and status mapping used by the device and till routes? The route inputs
  for session checks, trading context, receipt and invoice operations, and the placement of shared errors and real
  integration fixtures still need to be sized.
  [Device API](../../../apps/server/src/device-api.ts#L108) · [Print wiring](../../../apps/server/src/print-api.ts#L134) · [Errors](../../../apps/server/src/errors.ts#L28) · [Join suite](../../../apps/server/src/join-e2e.test.ts#L34)

## Check and sequencing decision

Only `print-job-preview.ts` and `theme-defaults.ts` (307 lines together) have no other server source imports once the
candidate files with outside dependencies are removed. The preview test still uses the server's test page and the
theme reads token files at runtime. Moving only those two leaves dv17's files in place.
[Preview test](../../../apps/server/src/print-job-preview.test.ts#L4) · [Theme token loading](../../../apps/server/src/theme-defaults.ts#L9)

On 21 November at 20:11, the watcher kept the bill fixture split with the first orders-and-sales move slice
and asked for a measured standalone benefit before designing further shared pieces. The first shared-piece design
landed in `99a9f19596`. [Bill fixture design](https://github.com/clintongormley/waitron/blob/f8d93fd328/docs/superpowers/plans/2026-11-21-a1308-orders-sales-first-shared-piece.md)

On 22 November at 19:27, the watcher kept the devices move on hold while the shared work is unsized and cleared dv17
to run first at today's server paths. After dv17, assess the payments move for env3 in one page and stop at the
assessment if its shared work is also unsized.
[dv17 writer](https://github.com/clintongormley/waitron/blob/f1842d0ffdf8f284ac3fb096c4a6a9f70e602de7/docs/superpowers/plans/2026-11-08-a1308-dv17-drawer-opens.md#L91) · [env3](https://github.com/clintongormley/waitron/blob/f8d93fd328/docs/superpowers/plans/2026-11-08-a1308-env3-payments-settings.md)

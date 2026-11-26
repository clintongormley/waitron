# O1. The venue's other card machines, kept on the dashboard · PLAN FOR APPROVAL

Part of [lane O's payment plan](2026-11-26-o-till-payment-after-pay.md). What a manager can do once
it lands: on the dashboard's card readers page, add, rename and remove the venue's other card
machines (the ones Waitron is not paired with), each with a name and where its payments go: "SumUp
account" or "Another bank". Staff see the list from O13, where the till's Other card machine screen
offers it as a dropdown ([spec §7.9](../specs/2026-11-26-till-handheld-redesign-design.md#79-pass-3-the-ways-to-pay)
and §13: "a new venue list on the dashboard's card readers page (name, and where its payments go),
read by the till"). No till file changes here, so nothing collides with lane I's PR 15.

There is no approved picture for the dashboard; the panel follows `design-system.md` → Forms and
sits on the card readers page under the readers table, beside the existing payment settings panel
(`apps/dashboard/src/screens/payments-screen.ts:2574`).

## What changes

1. **Stored in the payments settings document**, no table and no migration
   (`packages/payments/src/settings.ts:13-46`). It gains `otherCardMachines`, a list of
   `{ id, name, paysInto: "connected_account" | "other" }`, empty by default. `parse` refuses a list
   that is not an array, an entry with an unknown key, an id that is not a non-empty string, a blank
   or over-long name, a name repeated (ignoring case and spaces at either end), or another
   `paysInto`; it trims names. The shape changes on read, as the settings rule says (CLAUDE.md §3).
   The list goes with a venue's configuration export (`transfers`, beside `tipsEnabled`), because
   it describes the venue's own machines.
2. **Two management routes** in `apps/server/src/payments-provider-settings-routes.ts`, through its
   existing `gated` permission check: `GET /management-api/payments/other-card-machines` answers the
   list and the document's revision; `PUT` takes the whole list and that revision, keeps every other
   key of the document as it is (as the settings PUT does at `:70-75`), gives a new machine its id on
   the server, and answers the saved list. A stale revision is today's settings refusal. A machine
   marked "SumUp account" while SumUp is not connected is refused with an error on that row's field;
   the dashboard offers that choice only while SumUp is connected.
3. **One till read**, `GET /api/other-card-machines` (signed-in device), answering `{ id, name,
   paysInto }` for each machine, so O13 needs no server work to show the list. Nothing calls it yet.
4. **The dashboard panel**, a new small file `apps/dashboard/src/screens/other-card-machines-panel.ts`:
   a heading "Other card machines", a muted line saying what they are for, one row per machine (the
   name as a field primitive, "Where its payments go" as a select, Remove at the row's end), "Add a
   machine", and Save, quiet and disabled until the draft changes (`draftScopeFor`,
   `saveActionState`, the save handler's early return). Field errors under the field; one bottom
   message on a refusal. Leaving with unsaved changes asks, as every dashboard form does.
5. **Words** in English and Spanish in the dashboard's strings; the guide's `{#card-readers}`
   section (`apps/server/src/guide/en/printers.md:141` and its Spanish twin) gains a short
   paragraph; `design-system.md` needs nothing new because the panel uses existing primitives.

What a payment keeps is O13's: the till will send the machine's id, and the server will copy the
name and `paysInto` into the payment's `external_machine` and `external_provider`, following
today's rule that a venue without SumUp connected records "other" (`apps/till/src/widgets/outside-card.ts:18-30`).

## Tests first

- `packages/payments/src/settings.test.ts`: each refusal above, the trim, the empty default, and a
  saved document without the key reading as an empty list.
- `apps/server/src/payments-api.test.ts` (where the settings routes are tested): GET and PUT answers, other keys kept, a stale revision refused,
  someone without the permission refused, a SumUp machine refused while SumUp is not connected, ids
  given on the server; the till read answering the list to a signed-in device and refusing without
  one.
- The panel: a `*.test.ts` (add, rename, remove, save, field errors, the SumUp choice shown only
  while connected), a `*.unsaved.test.ts`, and a `*.a11y.test.ts` in both themes.
- The export: a configuration bundle carries the list, following `packages/adjustments/src/configuration-transfer.test.ts`.

Size: about 150–220 lines of product code and 200–280 of tests, about three hours. Pictures:
dashboard at phone and desktop widths, light and dark, English and Spanish, to the watcher. Review:
full, with two run-it reviews (payments). Lane O lands it: it issues and files nothing.

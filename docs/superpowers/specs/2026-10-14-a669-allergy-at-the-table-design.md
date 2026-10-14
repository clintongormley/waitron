# A669 — An allergy at the table: asked at Send, marked on the guest's dishes, told to the kitchen

Date: 2026-10-14. Status: design agreed with the owner in chat; awaiting review of this written spec.
Companion spec: [A668 — allergen information in the editor, at publishing and on the till](2026-10-14-a668-allergen-info-editor-and-till-design.md),
which this builds on (the allergen shape with kinds, the icons, the info window).

## Why

Nothing in Waitron lets a waiter record that a guest has an allergy, and nothing tells the kitchen
which plate must be kept free of what. A free-text line note is the only channel, and nothing
prompts for it.

What exists today (read on `main` at c75800ed7, not run):

- A table's guests are a **party** (`parties`, `packages/db/src/schema/parties.ts:33`), with a main
  bill (`mainBillId`, `:50`) and possibly more bills. Unsent dishes are an **order draft** owned by
  the party (`orderDrafts.partyId`, `packages/db/src/schema/order-drafts.ts:36`) with draft lines
  (`orderDraftLines`, `:61-79`, which carry a free-text `note`). Sent dishes are working-order lines
  (`workingOrderLines`, `packages/db/src/schema/orders.ts`, with `note` at `:201`). There is no
  seat or per-guest data anywhere.
- Ways a table's dishes reach the kitchen (`apps/till/src/screens/till-table-order-screen.ts`,
  `apps/server/src/till-api.ts`):
  - the order bar's Send / Send all / Fire buttons, which all open a preview dialog first
    (`#openPreview`, `:1766`; `#confirmPreview`, `:1925`) and then `POST
    /api/parties/:partyId/drafts/:draftId/submit` (`till-api.ts:3092` → `submitDraft`,
    `order-drafts.ts:302` → `placeGroups` → `fireLines`);
  - the per-line Send button (`table.send_line`, `:2165-2177`), with no preview, `POST
    /api/working-orders/:id/lines/send` (`till-api.ts:3311` → `sendLines`, `working-order.ts:2084`);
  - firing a held group (`POST /api/parties/:id/groups/:gid/fire`, `till-api.ts:2816` → `fireGroup`)
    and the course verb `fire` (`till-api.ts:2073` → `fireCourse`), with no preview.
- The counter (walk-up) path has no Send; its dishes reach the kitchen at payment or Place.
- Kitchen paper: `KitchenTicketItem` (`apps/server/src/kitchen-ticket.ts:13`) prints quantity and
  name, then `+ modifier`, `> cross-reference` and `* note` lines (`emitItem`, `:146-164`), wrapped
  to 30 columns at 58 mm and 42 at 80 mm (`packages/printing/src/layout.ts:8`). Tickets carry no
  allergen or diet information.
- Kitchen screen: a queue row is assembled at `apps/till/src/widgets/station-queue.ts:1096-1116`;
  the expo board likewise (`till-expo-screen.ts:1044`). The row's allergens come from the **live**
  product (`readQueueSubItems`, `apps/server/src/working-order.ts:6534-6557`), not a copy taken at
  send; the line note is copied at fire (`ticketItems.note`).
- Corrections already reach a station as **kitchen notices** a cook acknowledges
  (`kitchenNotices`, `packages/venue-service/src/schema/kitchen-notices.ts`, kinds `recalled`,
  `void`, `changed`, `moved`, `rerouted`), with the line copied by value.
- The table order screen has an Actions menu (`#actionMenu`, `till-table-order-screen.ts:4757`):
  Move guests, Join, Split table, Name, Move bill, Merge, Transfer, Split.

## What the owner said (2026-10-14)

> "the first time the waiter presses send, there is an allergies / no allergies choice, if they
> click allergies then it shows the items with allergens and the waiter can confirm."

> "this choice remains for the second order. although it should be possible to change it. Also, we
> need a way of signalling a known allergy to the kitchen."

> "just the dishes that person with the allergies is consuming. show me mockups"

## Decisions (owner, 2026-10-14)

1. **Table orders only.** The counter has no allergy step.
2. **Asked once per party,** at the first Send. The answer stays for every later Send and can be
   changed at any time.
3. **"Allergies" asks who and what:** a free-text "Who" (no seat picker exists), the 14 allergen
   ticks with kinds for gluten and nuts (as in A668), and an optional note for the kitchen. More
   than one guest may be added.
4. **The waiter ticks the dishes each allergic guest is eating.** A dish belongs to at most one
   guest, and is ticked as a whole line (no splitting a line of 2).
5. **A ticked dish that contains something its guest avoids turns red** with the reason, and can
   still be sent ("Send anyway"); the clash is printed on the ticket.
6. **Kitchen paper, option B:** the allergy block under each of the guest's dishes, and a heading
   at the top of any ticket that holds one.
7. **Every table path that sends dishes to the kitchen runs the step**: the preview Send, the
   per-line Send, and firing a held group or course.
8. **The allergy belongs to the party** (the people at the table), so every bill of the party
   shows it, and a dish moved to another bill keeps its tick.
9. **The order shows the answer** — a red Allergy banner, or a quiet "No allergies" line — each with
   **Change**; and **Actions → Allergies** opens the same window at any time, so it can be set
   before anything is ordered.
10. **A change that touches a dish the kitchen already has sends a notice**, "ALLERGY CHANGED" or
    "ALLERGY REMOVED", acknowledged like today's notices.
11. **The floor plan marks a table whose party has an allergy** with a red "!".

## Mockups

In [docs/backlog/mockups/a669-allergy-at-the-table/](../../backlog/mockups/a669-allergy-at-the-table/):
1 is the first Send (question, who and what, ticking dishes, the order afterwards) and both
ticket options (B chosen) with the kitchen screen; 2 is changing the allergy (the banner, Actions,
the window with sent dishes, the notice, the floor plan). Where a board and this text differ, this
text wins.

## Words

- **Allergy answer** — the party's "No allergies" or "Allergies". Unanswered until the first Send
  or until set from Actions.
- **Allergic guest** — one entry under "Allergies": who, what they avoid, and a note.
- **Ticked dish** — a line assigned to an allergic guest.
- **Clash** — a ticked dish whose as-served allergens include a code its guest avoids.

## What it stores

Owned by the `venue-service` module's migration set, beside the kitchen notices; all three tables
are classified `state` in its classification list. None is append-only: answers and ticks are
changed and removed in normal use.

- `party_allergy` — one row per party once answered: `party_id` (references `parties`), `answer`
  (`none` | `allergies`), who changed it last, and when.
- `party_allergy_guests` — `id`, `party_id`, `position`, `who` (label, required, at most 40
  characters as the party name is), `allergens` (the A668 `AllergenMap`, non-empty), `note` (label,
  optional).
- `allergy_line_ticks` — which line is ticked for which guest: the guest's id and **either** a
  draft line's id **or** a working-order line's id (one of the two, enforced by a check). When a
  draft is submitted its ticks move to the lines it creates, in the same transaction.
- **The kitchen's copy is frozen at fire.** When a ticked line is fired, the guest's who, the
  allergen names with kinds, the note and whether it clashed are copied beside its ticket item, and
  the paper ticket, the kitchen screen and the expo board read that copy — so an allergy cannot
  change under a cook without a notice. Where the copy lives (a column set on `ticket_items`, or a
  `venue-service` table keyed by ticket item) is the plan's call; the plan states which `REFERENCES`
  it adds and puts them in the descriptor's `requires`.

Every write goes through one `withTransaction` per request. The allergy belongs to the party: when
parties merge, the merged party's guests and ticks join the surviving party's; when a party is split
from a joined table, each resulting party keeps a copy of the guests, and each tick stays with its
line. (This split rule is mine: copying errs on the side of telling the kitchen too much. The plan
confirms it against how `split-table` moves lines.)

## The flow

- **First Send, unanswered:** every table path that would give the kitchen a dish first shows
  "Any allergies at this table?" — No allergies / Allergies. On the preview Send it is the first page
  of the existing preview dialog; on the per-line Send and the fire paths it is the same window,
  opened before the request.
- **Allergies:** "Who", the 14 ticks with kinds, "Note for the kitchen", "+ Another guest with
  allergies", then Next.
- **Ticking:** "{who} eats…", listing every dish leaving now that has not been offered for ticking
  before, with its allergen icons. With several guests, one list per guest, and a dish ticked for
  one guest is not offered to the others. A clash turns its row red: "Contains Gluten and Milk —
  Seat 3 avoids them". The button reads **Send** with no clash and **Send anyway** with one.
- **Later Sends:** no question. If the answer is Allergies, the ticking page appears for the new
  dishes only; if it is No allergies, nothing appears.
- **The server refuses** a table send or fire for a party with no answer: `allergy.unanswered`.
  The till always asks first, so this guards against a till that forgot. The ticks and the answer
  travel in the same request as the send, so a Send never fires a dish before its tick is stored.
- **The routes** that read or change the allergy check what the send routes check — the device
  profile's action and the person's permission for taking orders — and each gets a row in the maps
  atop `apps/server/src/till-api.profile-actions.test.ts` and `till-api.profile-zones.test.ts`,
  with a refusing case.

## On the order and the floor plan

- The top of the table order screen shows the red banner "Allergy · Seat 3: Gluten (wheat), Milk —
  coeliac, severe" (several guests joined by " · "), or the quiet "No allergies", each with Change.
  Nothing shows while unanswered.
- A ticked dish carries a small red tag with the guest's who, on unsent and sent lines.
- Actions gains **Allergies**, first in the list.
- **The allergy window** (from Change or Actions) lists each guest with Edit, "+ Another guest with
  allergies", every dish of the party's bills (sent ones marked "sent 13:24"), "No allergies"
  (which clears every guest and tick, after a confirmation when any dish was ticked) and Save.
- Other devices showing the party see an allergy change without reopening it. The plan names the
  mechanism (the party's `revision` or a live subscription) after checking which one those screens
  watch today; not checked for this spec.
- The floor plan's table (`wt-floor-map`, `packages/ui`) takes a flag and draws a red "!" for a
  party with at least one allergic guest. Being a change to a shared `wt-*` primitive, it extends
  that primitive's token and axe tests.

## The kitchen

Kitchen paper, in the kitchen's language (Spanish wording from the owner), at both widths:

```text
!!! ALLERGY ON THIS TICKET !!!
Grill
Mesa 4
Order 12
13:24
2 x CROQUETAS JAMON
1 x SECRETO IBERICO
  *** ALLERGY: SEAT 3 ***
  GLUTEN (WHEAT), MILK
  coeliac, severe
```

- The heading prints only on a ticket holding a ticked dish. The block prints under each ticked
  dish, after its modifiers, cross-references and note. "Who" and the note print as typed; the
  allergen names in capitals.
- A clash adds one line to the block: `  !! CONTAINS GLUTEN — SENT ANYWAY`.
- The kitchen screen and the expo board show the same: a red allergy line under the ticked dish
  ("ALLERGY · Seat 3: Gluten (wheat), Milk", the note beneath) and a red marker on the card's header.

**Notices.** When an allergy change touches a dish a station still has — fired or held with its
HOLD ticket printed, and not yet served — that station gets a kitchen notice of a new kind,
`allergy_changed` or `allergy_removed`, carrying the dish and the new block (or none). It prints
"*** ALLERGY CHANGED ***" / "*** ALLERGY REMOVED ***" and shows on screen until acknowledged, as the
existing kinds do. Unsent dishes need no notice: they go with their next Send.

## Not affected

Receipts, invoices and fiscal records: the allergy is never printed on a customer document and
never enters a fiscal record.

## Order of work

After A668's data shape (its slice 1), because the guest's allergens use the same map. Suggested
slices, each one implementer's size:

1. The tables and operations: answer, guests, ticks, the draft-to-line move, merge and split.
2. The send paths: the server refusal, ticks in the submit, per-line send and fire requests.
3. The till: the question, the who-and-what page, the ticking page, the banner, Actions, the
   allergy window, the line tags.
4. The kitchen: the frozen copy, paper (both widths), the station and expo screens, the notices.
5. The floor plan's "!".

## Testing

- Each of the four table paths, with a party unanswered: the till asks; and the server, called
  directly, refuses `allergy.unanswered` with no line fired.
- Ticks survive submit (draft line to working line), move bill, transfer and merge; a split copies
  the guests.
- A clash: ticking Croquetas (gluten, milk) for a guest avoiding gluten shows the reason and "Send
  anyway"; the ticket carries the clash line.
- Paper at 58 and 80 mm, English and Spanish: the heading only on the ticket with a ticked dish;
  the block under that dish only. Fixtures give the guest's who, note and allergens three different
  texts from the dish's own name and note.
- The kitchen copy is frozen: changing the guest after fire leaves the printed and screen copy as
  sent and produces an `allergy_changed` notice for that station only.
- The routes' profile-action and zone rows, with refusing cases.

## Out of scope

- The counter. Seats as data. Showing the allergy on the online menu or customer documents.

## Open points

- Spanish wording for the question, the pages, the banner, the paper heading and block, and the
  notices.
- The split-table rule above (copy to both) is mine; the owner may prefer otherwise.

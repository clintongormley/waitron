# A758 — Adjustment reasons: the rules, worked through, and a page of their own

Status: **design, waiting for the owner's answers (questions Q1–Q8 at the end).** Nothing is built
until they are answered. Backlog entry: `docs/backlog.md` "A758" and
[its detail](../../backlog/till.md#a758-adjustment-reasons-review-the-rules-then-a-page-of-their-own).
Mock-ups: `docs/backlog/mockups/a758-adjustment-reasons/` (light theme; the page and the form also in
dark, `-dark.png`; drawn in HTML with the dashboard's and till's own colour tokens, not screenshots).

Already decided by the owner (2026-10-16), not reopened here:

- The reasons get their own page under **Service**, leaving Venue settings without tabs (A755).
- The list gets a search bar, drag handles instead of Move up and Move down, and a cleaner layout.
- **Delete, not Disable**, through `wt-delete-dialog`. The Status column, the Status filter and
  Enable go.
- The edit form asks only what applies to the reason's kind, with role lists.
- A new venue starts with a list of reasons it can delete or change.
- Void and give-away stay separate: they tell the kitchen different things, and a report separates
  mistakes from hospitality.

"Void" in this document is what the code calls `cancel`; "give-away" is `comp`. All file references
are to `main` at `c7ebd2fd8`. Every behaviour marked **(run)** was checked on 2026-10-17 by a
throwaway test against `apps/server`'s adjustment venue (`apps/server/src/testing/adjustment-venue.ts`:
Burger €12, Bottle €30, Steak €25, Coffee €1.50), Node v26.11.1; its output is quoted where it is
used. **(read)** marks a conclusion from the code that was not run.

---

## 1. How a reason works today

A reason (`packages/adjustments/src/policy.ts:24-36`, table `adjustment_reasons`,
`packages/adjustments/src/schema/reasons.ts`) carries:

| Field | What it does |
|---|---|
| Actions | one or more of void, give away, percentage discount, amount discount |
| Most taken off an item (`maxPercentBp`) | caps the percentage the reason takes off one line, adding up its earlier percentage discounts on that line; counts percentage discounts only (`policy.ts:94-100`). A discount on the whole bill is checked on its own percentage and never added up, and a later line discount does not count it (`packages/adjustments/src/record.ts:101`, `:128-131`) |
| Most taken off a bill (`maxAmount`) | caps everything the reason takes off one bill, whatever the action, voids included (`policy.ts:101-106`) |
| Lowest role that applies it without approval (`applyRole`) | anyone below it needs an approver (`policy.ts:110-112`) |
| Lowest role that may approve it (`approverRole`) | must be at or above the apply role (`operations.ts:95`) |
| Note required | refuses the adjustment without a note |

Roles are a ladder of four: staff, supervisor, manager, admin (`ROLE_LADDER`,
`packages/identity/src/permissions.ts:93-105`).

Beside the reasons sits one venue setting, **the limit on a bill's discounts** (`maxBillDiscountBp`,
`packages/adjustments/src/settings.ts`): a share of the bill's full price. When the person is below a
manager, a discount that takes the bill's discounts past it, or a void that leaves the bill past it
with a larger share than before, needs a manager's PIN (`policy.ts:133-142`, `:166-191`; "manager" is
written into the code at `policy.ts:139`, `:179` and `apps/server/src/adjustments-apply.ts:540-541`).
Give-aways do not count (`adjustments-apply.ts:532-533`). No venue has a limit until someone sets one
(`settings.ts:11-16`).

**On the till** (`apps/till/src/widgets/adjustment-dialog.ts`): a line on a bill offers Cancel (only
once it is sent, fired or held), Give away and Discount; a bill offers "Discount the bill". The dialog
lists every active reason that allows the chosen action, whoever is signed in
(`adjustment-dialog.ts:349-352`). The server answers with ONE approving role; the till says "A
supervisor must approve this with their PIN." and lists the people at or above that role
(`apps/server/src/adjustments-api.ts:203-212`). A line not yet sent is removed with the ✕ and needs
no reason (`apps/till/src/widgets/basket.ts:454-467`).

**What each action does** (`adjustments-apply.ts:804-808`; receipt wording from
`apps/server/src/receipt-document.ts:96-103` and `receipt-adjustments.test.ts:590-597`):

| | On the bill | On the receipt | Kitchen | Counts towards the bill's discount limit |
|---|---|---|---|---|
| Void | the item goes | not printed | told | only if the void raises the discount share of what is left |
| Give away | stays, priced to zero | the item at its price, then "Invitación -12,00" | not told | no |
| 100% discount | stays, priced to zero | the item at its price, then "Descuento 100% -12,00" | not told | yes |

**Today's seeds.** A new venue gets one reason, "Entry error" — void, staff apply, supervisor
approves (`packages/adjustments/src/provisioning.ts:21-30`), because "a venue with none could cancel
nothing" (`provisioning.ts:8`). The demo venue gets seven
(`apps/server/scripts/demo-seed/seed-adjustments.ts:25-125`), two of them allowing more than one
action.

---

## 2. What the review found, with worked examples

### 2.1 An approver who is never asked

"Entry error" says _Staff applies it, Supervisor approves_. Staff is the bottom of the ladder, so
everyone applies it alone and no supervisor is ever asked. **(run)** A staff member voiding a burger
under a staff/supervisor reason: `needsApproval: null`; the control, a supervisor/manager reason:
`needsApproval: manager`. Three of the demo's reasons have the same unused approver.

The form causes it: it asks for an approver on every reason, even one everyone may use. In the
proposal (§3.2) the approver list appears only when someone would need one.

### 2.2 Going past a limit cannot be approved by anyone

A limit refuses before approval is considered (`policy.ts:82-83`: the limits at `:94-106` refuse
before the approval check at `:110-112`). Worked example: the demo's "Complaint" — supervisors use it
alone, managers approve, €30 a bill. A table of eight has two steaks at €25 to give away.

**(run)** A give-away reason set like that, two steaks (€50): a manager doing it alone gets
`adjustment.over_limit`; a staff member with the manager's PIN gets `adjustment.over_limit`; the
control, the manager previewing one steak (€25): allowed, no approval. **(read)** An admin is refused
the same way, since the limit refuses before any role is looked at; the venue under test has no
admin. The only way through is to edit the reason in the dashboard, or to pick a reason with no
cap. The till's message ends "Choose another reason or ask a manager"
(`apps/till/src/i18n/codes.ts:565`), and the manager is refused too.

So "Most taken off a bill" means "never more than this", while the bill-wide limit (§1) means "ask a
manager above this". **Q2** asks which a reason's limit should mean.

### 2.3 One kind per reason

A reason may allow several actions, and then its limits read oddly or leak:

- The demo's "Complaint" allows give-away and percentage discount, "up to 50% off an item, €30 a
  bill". The 50% applies to the discount only; the €30 to both.
- The form offers both caps to a void-only reason. "Most taken off an item" can never apply to it
  (`policy.ts:94-98`); "Most taken off a bill" does. **(run)** A void-only reason capped at €25: a
  manager voiding a €30 bottle gets `adjustment.over_limit`; the control, capped at €35: allowed.
- "Most taken off an item" counts percentage discounts only. **(run)** A reason allowing both kinds
  of discount, capped at 20% an item: a staff member's €12 amount discount on the €12 burger is
  allowed, no approval; the control, 100% as a percentage: `adjustment.over_limit`.
- Bill discounts are never added up (§1). **(run)** Under one reason capped at 50%, on a €12 burger:
  50% off the bill, 50% off the bill again, 50% off the burger's line — all applied; only a further 1%
  on the line is refused. The burger ends at €1.50, 87.5% off.

Proposal (**Q3**): a reason is one of three kinds, and the form shows only that kind's fields:

| Kind | On the till | Limits it can carry |
|---|---|---|
| **Void** — "Take it off the bill" | Cancel | none (but see Q7) |
| **Give-away** — "Give it free" | Give away | most given away on one bill (€) |
| **Discount** | Discount, Discount the bill | most off any one item (%) — counting everything the reason has taken off that item, as a percentage or an amount, on the item or through a bill discount; most off one bill (€) |

A discount reason says whether staff may enter a percentage, an amount, or both — the till already
offers only what the reasons allow (`adjustment-dialog.ts:340-347`).

### 2.4 Give-away or 100% discount

Both leave the item priced to zero and tell the kitchen nothing; they differ in the receipt's word,
in the report's column, and in the bill limit (§1 table). Worked example: a 20% bill limit and a
customer complaint about the only coffee on a bill (€1.50).

**(run)** As a give-away: `needsApproval: null` (give-aways are not counted). As a 100% discount:
`needsApproval: manager`, `overBillDiscountLimit: true`, because €1.50 off €1.50 is 100% of the bill.
The same 100% discount on a coffee beside two €25 steaks (€51.50): no approval — €1.50 is 2.9% of
that bill. So the same complaint about the same coffee asks a manager or not depending on what else
the table ordered.

The owner reports that at Santet, Square recorded complaints three ways — as a void, a give-away and
a "CUSTOMER COMPLAINT 100%" discount — depending on the button pressed (2026-10-16). The month of
Square orders on file (§2.6) shows none of the three: no discount but the staff one, and no line
priced at zero. **Q4** asks whether a discount may reach 100% at all.

### 2.5 The bill-wide limit

It is a share of the bill, so on a small bill anything reaches it at once (§2.4). Its explanation in
the dashboard is a paragraph of 83 words (`packages/adjustments/src/dashboard/strings.ts:88-89`). It
also catches what each reason's own limits cannot: two reasons used on one bill, each under its own
cap, and today repeated bill discounts under one reason (§2.3). **Q5** asks what replaces it.

### 2.6 Staff meals

There is no staff-meal concept in the code. The report already shows each reason apart ("By reason",
grouped by reason id, `packages/adjustments/src/reports.ts:191-214`), and each person's adjustments by
reason — the person who asked for the adjustment, not the person who ate (`reports.ts:64-76`).

Santet's month of Square orders (9 September – 9 October 2026; 4,098 orders, 4,048 completed, their
11,742 lines; `local/square/snapshot/orders.json` in the owner's Santet worktree) has one discount
used at all: "STAFF DISCOUNT 50%", on 5 whole orders. The discount's name says staff pay half; the
data cannot show whether other staff meals went through Square at all. **Q6** asks whether a staff
meal needs anything more than a reason.

### 2.7 Approval that depends on whether the kitchen has it

The owner's draft starter list wants "Customer changed mind" free to void until the kitchen has the
dish, and approved after. Today nothing in a reason's rules can depend on that: the rules read the
action, the amount, the percentage, the person's role, the note and the reason's earlier use on the
bill (`policy.ts:40-48`), never the dish's stage. The stage is recorded on each adjustment (`stageOf`,
`adjustments-apply.ts:280-284`: unsent, held, fired, served) and reported, but not used.

**(run)** A supervisor/manager void reason asked by staff: `needsApproval: manager` for a held burger
and for a fired one; a reason anyone may use: `null` for both.

**Q7** asks whether a void reason may ask for approval only once the kitchen has the dish.

### 2.8 Square's reasons that are not adjustments

The owner's Square lists (detail §8) sort into four piles:

1. **Voids and give-aways** — the starter list (Q8) covers them.
2. **CUSTOMER LEFT WITHOUT PAYING** — Waitron's "Record unpaid departure" (`apps/server/src/unpaid-departure.ts:41-47`:
   the bill is invoiced and the debt recorded, under its own free-text reason). Not a reason.
3. **PAID SEPARATELY** — the item belongs on another bill of the same party: Transfer moves it there
   while both bills are open and untouched (`apps/server/src/bill-actions.ts:106-124`, called at `:230`). **ALREADY
   PAID**, where the bill that paid for it is settled, is out of Transfer's reach, so it is a void
   under a void reason ("Entry error" fits).
4. **TRAINING** — Waitron's practice mode is a whole installation (Demo or Prepare,
   `apps/server/src/boot.ts:1523`), not a switch a waiter turns on during service. A Live venue has no
   way to ring up a practice sale. Not a reason; noted, not proposed here.

What the import tool can see is narrower. `local/square/import.mjs` lives only in the owner's Santet
worktree (git-excluded, not in the repository). It fetches Square's catalogue, locations, team and
orders (`local/square/fetch.mjs`), and the catalogue holds Square's **discounts** only — six at
Santet: EVENT GUEST 100%, INVITATIONAL ITEM 100%, CUSTOMER COMPLAINT 100%, FAMILY DISCOUNT 10%, WIZARD
DISCOUNT 20%, STAFF DISCOUNT 50% (the backlog lists the first four). Square's void and comp reasons
are not in anything the tool fetches; whether Square's API offers them was not checked. Today each
discount comes in as a discount reason capped at that percentage, which staff apply alone, a note
required at 100% (`import.mjs:348-366`). It names a manager as approver at 50% and over, but with
staff applying, that manager is never asked (§2.1).

If Q4 is A, the three "100%" discounts come in as give-away reasons (named without the "100%"), and
the rest as discount reasons. The tool is outside the repository, so that change is the owner's
local tool, not this item's pull requests.

---

## 3. The proposal

### 3.1 The list page (mock-up 08)

Service → **Adjustment reasons**. A search bar; each row a drag handle, the reason's name, its kind,
who can use it alone ("Everyone", or the roles), its limits in one short line, and a row menu with
Edit and Delete. No Status column, no Status filter, no Enable. The bill-wide limit's section goes or
changes by Q5.

**Delete removes the row** — unlike a course, which stays switched off when recorded work needs it
(`apps/server/src/course-delete.ts:78-82`). A reason needs no such row: a recorded adjustment keeps
its own copy of the reason's name and rules (`reason_name`, `policy_snapshot`, no foreign key:
`packages/adjustments/src/schema/adjustments.ts:60-64`), and a till holding a deleted reason is told
"That reason no longer exists. Reload and choose another" (`apps/till/src/i18n/codes.ts:596-598`).
Two rules go with it:

- **A venue always keeps a void reason** — the till's Cancel needs one (the reason the seed exists,
  §1). Deleting the last void reason is refused, and so is changing its kind; Delete on it explains
  why. The configuration import, which replaces every reason with the bundle's
  (`apps/server/src/configuration-transfer.ts:679-689`), refuses a bundle with no void reason.
- The migration deletes today's switched-off reasons (before go-live, no compatibility code,
  CLAUDE.md §3).

design-system.md's "Switching off versus deleting" stops listing adjustment reasons among the things
switched off.

### 3.2 The edit form (mock-ups 01, 03 and 09)

1. **Kind** — Void, Give-away or Discount (Q3). Changing it later clears the fields the new kind does
   not have.
2. **Name** in each content language.
3. **Who can use it without asking** — one checkbox per role. Default: every role.
4. **Who can approve it** — one checkbox per role; shown only when a role above is unticked, a limit
   is set and Q2 is B, or Q7's switch is on. A role that can approve can also use it alone.
5. The kind's own limits (§2.3), each with a one-line hint.
6. **Note required**.
7. Q7's switch, on a void, if Q7 is A: "Ask only once the kitchen has it". Before the dish is fired,
   the roles in item 3 void it alone; once it is fired or served, only the roles in item 4 do, and
   anyone else asks one of them.

### 3.3 Role lists now, or after editable roles

The backlog says the role lists are built "with or after" editable roles (A7,
[detail](../../backlog/dashboard.md#roles-the-admin-can-edit-a7)), whose design is not written. With
today's four roles a list says nothing a ladder cannot — except that it can name roles that are not
next to each other — but the form, the storage and the till's approval path are the work. A7 leaves
open whether custom roles keep a place on a ladder or modules move to permission groups; if A7 keeps
the ladder, lists here would be a second way of saying who may do what, and might be folded back. If
it does not, A7 adds its roles as more checkboxes. **Q1** asks whether to build the lists now.

### 3.4 The starter list (Q8, mock-up 08)

Drawn assuming the recommended answers (one kind per reason, ask above a limit, no 100% discount,
approval after the kitchen has it). No reason requires a note.

| Kind | English / Spanish | Who can use it alone | Approves | Limit |
|---|---|---|---|---|
| Void | Entry error / Error al marcar | Everyone | — | — |
| Void | Item not available / Producto agotado | Everyone | — | — |
| Void | Customer changed mind / Cambio del cliente | Everyone, until the kitchen has it | Supervisor, Manager, Admin | — |
| Give-away | Complaint / Queja del cliente | Supervisor, Manager, Admin | Supervisor, Manager, Admin | — |
| Give-away | On the house / Invitación | Manager, Admin | Manager, Admin | — |
| Discount | Staff meal / Comida de personal | Everyone | Manager, Admin | 50% an item |
| Discount | Discount / Descuento | Manager, Admin | Manager, Admin | — |

Changed from the backlog's draft: "Staff meal" is a 50% discount, as Santet's staff discount was
named (§2.6), not a give-away; and every give-away names who approves it (Complaint a supervisor or
above, On the house a manager or above) rather than "Approval" from an unnamed role. Under Q3 A, a
second "Staff meal" on the same bill counts with the first, so a waiter cannot take a colleague's
meal past 50% without a manager.

### 3.5 What the build changes (for sizing, not to decide)

- `packages/adjustments`: a `kind` instead of `actions`; two role lists instead of two roles; the
  limits per kind, the item limit counting every discount the reason gave the item (§2.3); Q2's and
  Q7's rules in `evaluateAdjustment`; the configuration import refusing a bundle with no void reason
  (§3.1); the policy snapshot recorded on each adjustment changes shape. A
  migration; before go-live no compatibility code (CLAUDE.md §3), so the PR measures the upgrade and
  says whether a venue reset is needed.
- **The approval path**, from "at or above a role" to "in the list": the verdict's single
  `approverRole` (`policy.ts:52`) and the preview's `needsApproval` (`adjustments-apply.ts:539-542`,
  `:704`); the approver check (`adjustments-apply.ts:724`); the till's approver picker and its route
  (`apps/server/src/adjustments-api.ts:203-212`); and the till's prompt, one sentence per role today
  (`apps/till/src/i18n/strings.ts:1018-1021`). With lists it names the reason instead: "Someone who
  can approve Complaint must enter their PIN."
- `apps/server/src/adjustments-apply.ts`: the dish's stage passed to the rules (Q7); the bill limit
  by Q5; refusing a 100% discount (Q4 A).
- **"Give the whole bill away" (Q4 A)** gives each item away, one give-away per item, so each prints
  "Invitación" under its line. A single bill-level give-away row is refused twice today — by the
  server (`adjustments-apply.ts:415`) and by the append-only `adjustments` table's own check, which
  allows only discounts at bill level (`packages/adjustments/src/schema/adjustments.ts:111-116`).
- `apps/till`: the dialog's reason lists unchanged in shape (still filtered by action); the approval
  prompt above; "Give the whole bill away" beside "Discount the bill" (Q4 A).
- The dashboard page (§3.1, §3.2) as a Service screen of the adjustments module.
- The new-venue seed (§3.4) and the demo seed (one kind each, no unused approvers).

---

## 4. Questions for the owner

Each is one decision, with a recommended answer and a picture in
`docs/backlog/mockups/a758-adjustment-reasons/`.

**Q1. Build the role lists now, or wait for editable roles (A7)?** — picture 01.
- **A (recommended):** now, over today's four roles: "Who can use it without asking" and "Who can
  approve it" as checkboxes. If A7 later keeps a ladder for its custom roles, the lists may be folded
  back into it; if not, A7 adds its roles as more checkboxes.
- **B:** wait for A7. This item keeps the ladder (with the never-asked approver hidden) until A7
  lands.

**Q2. What a reason's limit means** — picture 02. Complaint (supervisors alone, managers approve),
€30 a bill; a supervisor wants to give two €25 steaks away.
- **A:** as today: never more than €30 on a bill, whoever asks — the manager and the admin too.
- **B (recommended):** up to €30, whoever can use Complaint does it alone; above it, someone in "Who
  can approve it" enters their PIN. Someone in that list goes past it alone, as a manager passes the
  bill-wide limit today.

**Q3. One kind per reason** — picture 03.
- **A (recommended):** Void, Give-away or Discount; the form shows only that kind's fields, and a
  discount's limit per item counts everything the reason took off that item — amount discounts and
  bill discounts too.
- **B:** as today: one reason may allow several actions.

**Q4. Can a discount take an item to zero?** — picture 04. A complaint about a lone €1.50 coffee
under a 20% bill limit: as a give-away it goes through; as a 100% discount it asks a manager.
- **A (recommended):** no. A 100% discount is refused whatever the reason's limit, and the till
  points to Give away; "Give the whole bill away" joins "Discount the bill" for a guest whose whole
  meal is free.
- **B:** keep both.

**Q5. The venue's limit on a bill's discounts** — picture 05.
- **A (recommended):** drop it; each reason's own limits (with Q2 B, "ask above") do the job. What is
  lost: two different reasons on one bill can each reach their own limit; the report shows it after.
- **B:** a euro amount per bill instead of a share: above it, a manager approves.
- **C:** keep the share, but only on bills above an amount the venue sets.
- **D:** keep it as it is.

**Q6. Staff meals** — picture 06.
- **A (recommended):** an ordinary reason (the starter list's "Staff meal", 50% off); the report's By
  reason table already shows it apart.
- **B:** a reason that also records whose meal it was (a person picked on the till), so a report can
  list meals per person who ate.

**Q7. Approval only once the kitchen has the dish** — picture 07. "Customer changed mind": the dish
is held → anyone voids it; it is fired → a supervisor or above approves.
- **A (recommended):** yes: a switch on a void reason, "Ask only once the kitchen has it" (fired or
  served).
- **B:** no: the same rule at every stage.

**Q8. The starter list for a new venue** — picture 08 (§3.4).
- **A (recommended):** as drawn.
- **B:** as drawn, with changes you name.

Square's piles (§2.8) need no answer: the non-adjustments already have a home in Waitron, and the
import tool follows Q4.

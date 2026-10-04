# Devices, menus and service zones

**Status:** Conversation decisions agreed with the owner on 2026-10-04; written spec awaiting
review. No implementation plan or product changes accompany this spec. Behaviour below is the
target design, not a claim about what runs today. Section 9 labels the designer's proposed details
that were not individually agreed in the conversation.

**Related work:** A204 (menu schedules and publication), A238 (a till is a device), A254
(departments and service), and A261 (venue operations). This spec revises the choices listed in
section 10 without replacing those designs in full.

## 1. What you are configuring

You run a restaurant and a deli in the same venue. The restaurant has a bar, indoor tables and a
terrace. Those restaurant zones share a kitchen and a service timetable, but the bar can present
a drinks menu while the tables present lunch. A restaurant waiter can order from a deli menu
without gaining access to the deli's orders.

| Concept | What it controls |
| --- | --- |
| Department | Menus staff can order from, the menu timetable, default menus, shared service defaults and incoming tab transfers |
| Service zone | Where an order is served, its effective service settings and overrides of the department's default menus |
| Device profile | The department and zones a device may serve, login eligibility, permitted actions and screens, equipment lists and defaults |
| Device | Its approved profiles, active profile, current equipment and station/watcher selection |
| Staff session | The current zone and manual menu selection, within the active profile's permissions |
| Menu version | A fixed edition of a menu, activated immediately or by scheduled publication |

A department is a separate operation; a different menu alone does not require one. An upstairs
bar can be a department when operated separately, or a restaurant zone with different defaults.
Neither a profile nor a menu determines how a customer is served: the order's zone does.

## 2. Menus and the department timetable

### What staff can order

You assign the available-menu list to the department. Zones cannot add to or remove from it.
The restaurant can include the deli menu in its list. Ordering from it keeps the restaurant's
service context and pickup destination; preparation can take place in the deli.

The principal menu is what customers see by default and what a staff screen initially presents.
Staff can browse another available menu without changing that public default. Scheduling changes
the principal menu, not the available-menu list: after breakfast ends, staff can still choose
breakfast and check with the kitchen before ordering.

### One timetable, with zone choices

The department owns the only timetable. Each period has a department default menu; a zone may
choose another default for that same period. Zones have no independent hours or timetable gaps.

| Department period | Department default | Restaurant bar override | Terrace |
| --- | --- | --- | --- |
| Breakfast, 09:00–12:00 | Breakfast | Coffee | Inherit |
| Lunch, 12:00–16:00 | Lunch | Inherit | Inherit |
| Dinner, 18:00–20:00 | Dinner | Cocktails | Inherit |

The department also has an all-day default, such as Drinks, for gaps between periods. A zone may
override that all-day default. During a period, a missing zone override uses the period's department
default; the zone's all-day choice does not override the department's scheduled lunch.

You configure a normal week per department, so weekends can have different periods and menus.
Special dates use the shared venue-operations calendar from
[A261 §7](2026-10-03-venue-operations-design.md#7-hours). A special-date menu timetable replaces
that department's normal timetable for the date. Zones follow the applicable department timetable.
The calendar is shared with opening hours; there is no separate menu holiday calendar.

### During service

The device remembers the waiter's last selected zone until somebody else logs in. It does not
need a separate permanent personal zone preference. A profile supplies the starting zone for a
new operator. Opening an existing table's order uses the order's zone.

A screen following the default changes menus between orders when a period changes. It leaves an
open order or a manually selected menu undisturbed. Existing ordered lines retain their recorded
prices and details; a timetable change does not rewrite them.

## 3. Publishing menu versions

The timetable chooses a menu. Publication chooses the edition of that menu. You can queue several
future editions, for example version 4 for 1 April at 08:00, version 5 for 15 April at 08:00, and
version 6 for 1 May at 08:00, while version 3 remains current until the first activation.

Publication moves forward. You cannot schedule version 2 after version 3, or use Tuesday's
timetable to cycle back to an older edition. Reusing old contents requires a new edition.

If an immediate publication would overtake queued editions, you must explicitly cancel or replace
the overtaken publications. They cannot silently activate later and send the menu backwards.

The snapshot and rescheduling details proposed in section 9 keep scheduled content independent of
subsequent draft edits. This work defines what a future public menu surface resolves; it does not
by itself commission that whole surface.

## 4. Profiles and departmental access

Example profiles include Restaurant handheld, Bar handheld, Deli till, Fried-chicken till,
Kitchen display, Meat-station live orders and Bar live orders.

Each ordering profile belongs to a department. It can use all of that department's zones by
default, or an explicitly selected subset, and has a starting zone. A fried-chicken till can be
limited to its counter while restaurant handhelds can use the bar, dining room and terrace.

These permissions are separate:

- Offering the deli menu in the restaurant allows restaurant orders from that menu.
- Sending or receiving a tab crosses the departmental boundary through a transfer.
- Browsing and managing deli orders requires an active profile permitted to work in the deli.

A restaurant handheld cannot simply switch its zone to the deli. Management may approve several
profiles for the device, with one active at a time. Staff may switch only to an approved profile
for which they satisfy the login eligibility rules.

### People, actions and screens

Login eligibility uses staff groups or roles, with individual exceptions where needed. It controls
both admission and the names shown at login. The profile selects the available screens separately
from the actions it permits: taking orders, taking cash, taking card payments, preparing or
handing over orders, printing and opening a drawer. Hiding a screen is not an action permission.

Both the person's permissions and the active profile must permit a staff action. A view-only
live-orders screen need not grant preparation or payment rights. Section 9 proposes how shared
kitchen displays fit this model without a named staff login.

### Kitchen and live-order displays

The profile lists permitted stations or watchers; each device chooses from that list. One Kitchen
display profile can therefore serve several stations. A watcher follows selected stations and
service zones; reuse that concept and its configuration rather than duplicating routing inside
profiles.

Preparing a station's work and watching its progress are separate actions. A kitchen can prepare
orders from several departments: an ordering department restriction must not silently filter the
station's incoming work. The station or watcher determines that work scope.

## 5. Equipment choices and possession

| Equipment | Profile settings | Device setting |
| --- | --- | --- |
| Receipt printer | Allowed list and default | Current choice or Use default |
| Card-slip printer | Allowed list and default, including none | Current choice or Use default |
| Card terminal | Allowed list and default, including none | Current choice or Use default |
| Cash drawer | Allowed list and default, including none | Current choice or Use default |

The drawer is selected independently of the receipt printer. It may physically connect through a
printer, but selecting a portable receipt printer must not redirect drawer opening. The profile's
cash and drawer permissions still apply. This does not introduce a new cash-float or cash-up model;
A238's remaining cash work owns those subjects.

### Picking up a terminal or portable printer

You can scan its QR code or use NFC to identify and select registered equipment permitted by the
profile. Scanning takes it over without a second question about taking it from the previous
holder. A dropdown provides the alternative when scanning is unavailable. Selecting equipment
assigned elsewhere from the dropdown asks for confirmation and identifies the previous device,
with the signed-in person's name as context when available.

**Use default** releases the explicit selection and its portable assignment, then follows the
profile's default. The screen shows which equipment that resolves to, including None.

An active payment stays attached to the terminal and device that started it. A busy terminal
cannot be taken over until the payment finishes or is cancelled. Selecting another terminal must
not move an in-progress payment.

NFC is a desired interaction, not a compatibility claim. Its implementation needs a probe on the
intended handhelds. QR and the dropdown remain paths through the same selection operation.

### Persistence proposed for review

Keep equipment selections across screen locking, session expiry, inactivity, a new person's login
on the same handheld, and temporary disconnection. The link belongs to the device and has no idle
expiry setting. Show disconnected equipment and let staff switch; do not silently redirect a
payment or print.

On takeover, notify the previous handheld and clear its explicit selection. On a profile switch,
recheck login eligibility, reset the working zone and browsing state, retain only equipment choices
the new profile permits, and release the others. Section 9 covers the collision when a profile
default names equipment somebody else is carrying.

These persistence details were recommended in the conversation; they need review with the written
spec rather than being attributed to an explicit owner answer.

## 6. Service belongs to the zone

The department supplies shared service defaults; the zone supplies the effective settings with
optional overrides, following A254 and A261. The profile authorises operations in that zone and
does not redefine its service behaviour.

A counter can have a tab by name or counter position. Counter does not inherently mean immediate
payment, and a tab does not require a dining table. Keep the separate service choices in those
designs, including payment timing and collection-ticket behaviour. This spec does not resolve
their outstanding invoice or receipt advice questions.

## 7. Transfers between departments

A department has one shared incoming-transfer queue and a designated receiving profile. Every
device currently using that profile sees its pending requests and notifications. Sending to
Restaurant goes to its main-counter profile, not to every waiter or to a table chosen by the deli.

1. The sending department requests a transfer to the destination department.
2. The receiving desk gets a persistent notification and a visible pending count.
3. Staff accept and assign the destination zone and, where appropriate, table, or decline.
4. Acceptance or refusal updates all receiving devices and notifies the sender. A request can be
   accepted only once.

Until acceptance, responsibility stays with the sender. The sender sees that the request is
pending; it does not disappear if the destination has no attended device. Reading or dismissing a
notification does not accept the transfer. The proposed directional permissions and withdrawal
behaviour are in section 9.

An accepted tab uses the receiving zone for subsequent service actions and new orders. Existing
ordered items keep their recorded prices and history. Existing preparation and pickup instructions
stay unchanged, including work still in the kitchen; staff coordinate any exception themselves.
The receiving desk must see the outstanding work when accepting.

## 8. Implementation boundaries and acceptance evidence

This design spans separate pieces. Plan them as small branches with their shared contracts stated
first: department menu membership and scheduling; forward-only publication; profile access and
device selections; equipment possession and independent drawers; departmental transfers.

Calendar work must reuse A261's special-date model. Profile and transfer work must account for the
zone-service work in A261 step 2. No table definitions or migration strategy are approved by this
document; follow the repository's pre-production reset policy when implementation requires it.

The implementation plans must require failing behavioural tests before each change, including:

- Two zones following the same period boundary, one inheriting and one overriding the menu;
  all-day gaps, a weekend and a special date; breakfast still orderable after its default ends.
- A screen following defaults changing between orders, with an open order and a manual selection
  retained; a new operator receiving the profile's starting zone.
- Several queued editions activating in order, refusing backwards activation, and requiring an
  explicit decision when immediate publication overtakes queued editions.
- A restaurant ordering from the deli menu while direct access to deli orders and zones is refused;
  profile switches checked against both device approval and login eligibility.
- Action refusals checked independently of screen visibility, and shared kitchen work spanning
  departments without granting cross-department order management.
- QR/dropdown selection converging on the same assignment, dropdown confirmation on takeover,
  busy-terminal refusal, Use default, and an independent drawer unchanged by receipt-printer changes.
- Two receiving devices racing to accept one transfer, with exactly one acceptance; notifications
  and responsibility through pending, accepted and declined states; existing kitchen work unchanged.

Check changed screens in both themes and at phone width. NFC evidence must name the devices and
interaction tested. Do not infer hardware compatibility from a passing fake.

## 9. Designer's details for written-spec review

These make the agreed rules precise; they are proposals, not additional owner decisions.

- **Publication snapshots:** queue fixed content, not a future read of a changing draft. Allow
  cancellation and rescheduling while preserving forward version order. A restart selects the
  latest edition whose activation time has passed, without exposing overdue editions in sequence.
- **Time:** use the venue time zone; periods include their start and exclude their end. Reject
  overlapping periods. Overnight periods belong to the day on which they start, matching A261.
  Reject a publication's nonexistent daylight-saving time and require an explicit choice for an
  ambiguous one. No special-date override means the normal week; an explicitly empty timetable
  uses the all-day default. Resolve zone choices against stable period identities, not row order.
- **Menu browsing:** remember manual menu selection per zone during the operator's session. Offer
  Follow default to resume automatic switching. A same-person unlock retains this state; another
  operator's login resets it. A menu removed from department availability ceases to be selectable
  for new lines; existing recorded lines are retained.
- **Login mode:** profiles choose named staff login or a shared operational display, a starting
  screen and an inactivity-lock setting. A shared display has only its configured station/watcher
  actions, with no unnamed ordering, payment or drawer access.
- **Profile changes:** refuse a profile switch while that device has an active payment; require
  an unfinished local order draft to be saved or cancelled before switching. Keep the same person
  signed in only if eligible for the new profile.
- **Equipment defaults:** distinguish shared fixed equipment from portable equipment with one
  holder. A default is a preference, not a background takeover. If another device holds it, show
  that and require the normal explicit selection. Never silently reacquire equipment just taken
  over by another handheld. Removing a permitted choice releases it and resolves the default under
  this same rule. A temporarily disconnected choice is retained, as in section 5.
- **Transfer permissions:** configure allowed destination departments directionally. Sending a tab
  never grants browsing rights at its destination. Permit withdrawal while pending and require a
  reason for decline. Show receiver availability only from a defined presence signal; do not
  equate a signed-in session with someone actually attending the desk.
- **Transfer races:** keep one pending destination per tab. While pending, the source may continue
  managing it; acceptance checks and displays the latest tab state. Payment in progress blocks
  acceptance; settling or closing the tab withdraws the pending request. Acceptance records who
  accepted and where, and applies the ownership change once. Existing bill/party structures and
  any already-issued invoice remain intact; transfer never causes fiscal reissuance.

## 10. Relationship to earlier designs

- [A238](2026-10-03-till-is-a-device-design.md): replace receipt-printer-derived drawer selection
  with the independent drawer. Extend a device's choices to approved profiles, terminals and
  station/watcher bindings; a device is no longer described as holding only printer choices.
- [A254 §2](2026-10-03-departments-service-styles-hours-design.md#2-departments): replace the proposal
  that a device's zone is only a home, never a restriction. The active profile now establishes
  departmental access and its permitted zone set.
- [A261 §§4, 6.3, 8](2026-10-03-venue-operations-design.md): menu membership is department-wide,
  with only defaults overridden by zones. Profiles supply starting zones. Station/watcher choices
  are selectable on the device from its profile's list. Retain the placement of menu configuration
  on Menus and the shared special-date calendar on Hours.
- [A261 step 2 plan](../plans/2026-10-04-departments-and-zones.md): reconcile its per-device starting
  zone decision with this profile default before implementing the intersecting work. This spec
  does not silently expand that plan to implement profile access, transfers or menu scheduling.

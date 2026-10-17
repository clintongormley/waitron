# A773: One editor per bill

**Status: owner-approved design, revised 2026-10-17. Ownership is not built or runtime-verified by this document.**

You can work on Bill 1 while a colleague works on Bill 2 at the same table. If you open a bill
with saved unsent dishes, you see its editor's New order and must **Take over** that bill before
changing it. This prevents competing edits to one bill without stopping service at the table.

The owner approved per-bill ownership, the empty-bill first-save rule and the three EN/ES messages
in section 7 on 2026-10-17. This replaces the earlier whole-table proposal.

## 1. Scope and source boundary

Ownership covers **one bill**, including fresh and recalled unsent dishes. Kitchen groups still
belong to the party, meaning the guests seated together, and may contain several bills' dishes.

This revision read the full older proposal, the courses/groups spec and the implementation plan.
The read-only product checkout is `waitron-feat-a773-1-unsent-list`, signed checkpoint
`d17d45710169ccb810cbf711e0341f9a1d41cdcd`. Task 15's single-held-dish Fire now and paid service-group trigger work is separate from
this ownership change.
These are source observations, not test results:

| Source at that checkpoint | What the amendment must replace or retain |
|---|---|
| `packages/db/src/schema/order-drafts.ts`, `apps/server/src/order-drafts.ts` (`saveDraft`, `takeOverDraft`, `openDraftsOn`) | Drafts are bill-bound but selected by person; takeover can absorb another draft. Replace parallel saved drafts on one bill with one saved outbox. |
| `apps/till/src/state/draft-sync.ts` (`#load`, `#takeOver`, `#show`) | Loading selects the person's draft; takeover flushes first and then replaces the store. Preserve local candidates separately instead. |
| `apps/server/src/draft-recall.ts`, `order-drafts.ts` move helpers | Recall, save, resend and moves share stable recalled source identities. Preserve their exclusive reservations and all allergy references. |
| `apps/server/src/bill-unsent.ts`, `bill-payments.ts`, `till-sale.ts` | Keep bill-specific unsent checks and existing payment replay/reconciliation order; remove per-person Pay copy. |
| `apps/server/src/till-api.ts` draft GET; `apps/till/src/screens/till-floor-screen.ts` | Draft GET needs passive session activity; the floor's owner-only aggregate needs bill/editor pairs. |

## 2. Acquiring and releasing a bill

- Opening, reading or switching to an empty bill reserves nothing. A blank save claims nothing.
- The **first accepted nonempty save or Recall** establishes that bill's editor. If Ana and Luis
  start locally together, only the first server transaction can win. The refused device retains
  its local candidate for review; it cannot create a second saved outbox.
- While the outbox has any fresh or recalled dishes, only its editor changes that bill's order.
- Sending or explicitly resolving the last unsent dish releases **that bill** in the same
  transaction. Empty draft records reserve nothing. Bill 2's unsent work cannot prolong Bill 1's
  ownership. Removing a recalled dish still requires the normal adjustment/reason/approval flow.
- Two devices signed in as the **same person** share ownership without takeover. Their draft
  revisions still prevent overwriting each other's newer edits.

There is no timeout, heartbeat, lease or claim made merely by leaving a screen open.

## 3. What you see and can do

On a colleague's bill, New order shows their saved dishes, arrangement and editor name read-only.
You can switch to your own bill and edit it immediately. Reuse the existing takeover title, body,
confirm button and notices, with the table **and bill** heading visible throughout. In that context
“this order” means that bill's outbox. Confirming transfers only its saved dishes, never another
bill or a local candidate. Do not introduce new takeover wording where existing EN/ES copy fits.

| Action | Approved rule |
|---|---|
| Add, edit, remove, split, move or rearrange unsent dishes; Send all; selected unsent Fire | Current bill editor only while it has unsent work. Send all sends this bill's arrangement; selected Fire leaves the rest unsent and owned. |
| Recall | Check the source bill's editor first; if unowned, Recall acquires it atomically. Return to that bill's New order. Never acquire a second personal draft. Keep all started/paid/station restrictions. |
| Void, Comp/Discount, bill adjustment, station move and other order/bill composition changes | Require the affected bill's editor while ownership exists, plus all existing permissions, reasons, status and payment restrictions. For moves between bills, check both affected bills. |
| Pay | Check only the bill being paid. A colleague's nonempty outbox requires takeover first; the editor flushes local edits, then Pay refuses while this bill has unsent dishes. Another bill never blocks it. |
| Serve, Undo served, All served, fire an already-sent held group or dish; service heading reorder/snooze | Shared service under existing authority, without taking over unsent work. Group Fire can include another bill's sent dishes. Never fire a recalled source still reserved in New order. |
| Kitchen preparation/pass actions | Keep their existing device, station and zone authority. |

Taking over sends nothing and changes no quantity, price, discount, payment, invoice, fiscal
record or hash. It changes editor, versions and the existing ownership audit only. Shared firing
can invalidate a held target; section 7 retains the explicit refused-send recovery.

## 4. Transaction, version and refusal contract

These are **required new interfaces**, not a claim that they already exist. T24 in the plan owns
implementation and all callers. An ownership version is a number advanced whenever editing
responsibility changes; a draft revision advances whenever its saved contents change.

Store `bill_edit_states` in core: `bill_id` primary key/FK to `working_orders`, nullable
`editor_id` (plain person id, like draft owner), and integer `editor_version` default 0 with a
nonnegative CHECK. The bill foreign key cascades only when the bill itself is deleted; release
never deletes the version row. Classify it
as state, declare constraints/exports/transfer reference metadata, and retain its row after release.
A missing row reads as unowned/version 0; the first successful acquisition inserts version 1.
Every successful emptying operation closes any open draft before releasing its editor. Reacquisition
by another person must not collide with a leftover empty open draft.
This keeps ownership metadata out of the financial row's transition rules. Use an additive new
migration and a partial unique index on **bill_id WHERE draft state = open**, replacing the
person-based open key. One bill has at most one open saved draft, across all people and parties.
No backfill or automatic merging of incompatible pre-live drafts; require a reset.

Define these exact shared server/client shapes in `order-drafts.ts` and the till client:

- `BillEditState = {billId:string, editorId:string|null, editorName:string|null,
  editorVersion:number, draftId:string|null, draftRevision:number|null}`.
- `BillEditExpected = Pick<BillEditState, 'billId'|'editorVersion'|'draftId'|'draftRevision'>`.
- `BillDraftSnapshot = {draft:Draft|null, edit:BillEditState}`. `Draft` retains its existing
  bill, owner, stable lines, revision and `takenOverFrom` fields.
- `readBillEditState(tx:Transaction,billId:string):Promise<BillEditState>` and
  `requireBillEditor(tx:Transaction,billId:string,operatorId:string,
  expected:BillEditExpected):Promise<BillEditState>` live in new server `bill-editing.ts`.
  The latter validates only; save/Recall acquire in their caller's transaction after validation.

The draft GET remains `GET /api/parties/:id/drafts`, returning
`{drafts:Draft[],billEdits:BillEditState[]}` for **all current bills, empty ones included**, read in
one transaction. It uses passive session activity. Save input adds required `expectedEdit`;
existing `billId`, `draftId` and `revision` must agree with it (`revision=0` for no draft).
Save returns `BillDraftSnapshot`. Takeover retains
`POST /api/parties/:id/drafts/:did/take-over`, taking `{revision,expectedEdit,submissionId}` and
returning `BillDraftSnapshot`. Its server signature becomes
`takeOverDraft(tx:Transaction,cfg:TillConfig,partyId:string,draftId:string,operatorId:string,
ask:{revision:number,expectedEdit:BillEditExpected,submissionId:string},
attendance?:AttendanceRecorder):Promise<BillDraftSnapshot>`. Recall returns its existing `{revision,draft}` plus `edit`;
submit returns its existing result plus `edit`. Every other ownership-gated request carries
`expectedEdit`, or sorted `expectedEdits:BillEditExpected[]` when it affects several bills.
Absent/malformed/mismatched fields refuse the existing invalid-field code, never default to the
main bill. Extend their command fingerprints with these expectations.

Inside **one write transaction**, after session/profile/zone checks and any established command
replay lookup, re-read bill membership/status/payment reservation, ownership and draft revisions.
Check the acting person from the session, never a trusted body owner. A matching completed replay
returns its original facts without re-running ownership or granting fresh editing authority;
current authentication/route authorization still apply. A different fingerprint under the same
submission ID refuses as today.

An unanswered payment retry retains its **original submission ID and complete original request**,
including `expectedEdit`/`expectedEdits`, quantities, allocation and consent. Refreshing ownership
must not rebuild that request from a new confirmation or mint a second payment ID. Reconcile or
replay the unanswered request under the existing payment rules; only a confirmed outcome and a
new explicit payment can use freshly read expectations. This applies to whole and partial payments.

| Transaction | Required atomic result |
|---|---|
| First nonempty save/Recall | Compare unowned state; acquire editor and advance editorVersion; create exactly one draft/source reservation with its lines and audit. A rival loses without any inserted draft/charge/kitchen work. |
| Save by editor | Compare expected edit state and draft revision, then retain stable line/source IDs, update contents and draft revision. No ownership-version change unless the outbox empties. |
| Takeover | Compare expected editorVersion, draft ID and revision; transfer that bill's one saved draft in place; advance editorVersion and draft revision. Preserve positions, source reservations and allergy ticks. Never flush or absorb the taker's local candidate first. Same-person current-state takeover is a no-op; stale expectations still refuse. |
| Last Send/removal/Discard | Resolve recalled financial sources normally; close the empty draft as submitted for Send or discarded for removal/Discard; clear editor and advance editorVersion. Retain the version row. No fresh bill is created. |
| Bill/party relocation | Validate the exact affected set before moving anything; retain bill identity and editor, advance each relocated bill's editorVersion and draft revision to invalidate the old scope. Existing financial/group revisions still apply independently. |

Return HTTP 409 `draft.taken_over` when a nonempty bill belongs to another person, with
`{billId,draftId,ownerId,ownerName,edit}`. A version/draft mismatch without a different current
editor returns HTTP 409 `draft.out_of_date` with `{billId,draftId,revision,edit}` (nullable draft
facts when released). Takeover deliberately accepts the shown other editor, but refuses a changed
expectation as `draft.out_of_date`; it cannot take a newer unseen draft. Both refusals commit
**nothing**. Existing missing-party/bill, closed-bill, payment-in-flight and routing refusals keep
their meanings. Permission checks are additional to ownership, never replaced by it.

**Send versus takeover:** if Send commits first, takeover's old revision refuses; refresh before
confirming again, so only remaining unsent dishes can transfer. If takeover commits first, the
old editor's new Send refuses. A completed Send retry returns its original result and sends
nothing twice. After release and reacquisition, even by Ana again, an old request fails its old
editorVersion. Pure ownership changes on Bill 2 do not invalidate Bill 1's ownership version;
retain separate existing party/group revision checks where those commands already require them.

Enforce this at the shared write functions, including draft create/save/discard/send, Recall,
direct `placeGroups`/order-line add/edit/remove/split, adjustments/Void/Comp, station moves,
bill transfers/merges, party transitions, presentation and every new payment start. Inventory
all HTTP and internal callers in T24. Buttons alone cannot enforce it. Any route that could
mutate a reserved recalled source must either resolve it through its owning draft's command or
refuse `draft.out_of_date` without mutation; knowing a bill line ID cannot bypass its reservation.

## 5. The first device and retained local work

After Luis takes Bill 1, Ana's Bill 1 becomes read-only on its next refresh; her Bill 2, if she
owns one, remains editable. Cancel Bill 1 autosave timers, invalidate its editing windows and
selections, and fence late save/submit answers with person, party, bill, local generation and
editorVersion. Server checks protect the bill immediately, before polling notices the takeover.

Keep two separate things: the authoritative saved outbox, and any local unsaved candidate,
including its base edit state, stable/source IDs and placement. Do not replace one with the other.
Use the existing unsaved-takeover notice; show the candidate separately read-only. It never counts
as another saved outbox, a floor badge, a charge or something available to Send.

**Builder's call retained from the approved proposal:** passive refresh at most every 15 seconds
while the table is visible, on focus and after commands. Refresh metadata without resetting local
edits. Ignore responses from older scopes/generations and lower editorVersion/draft revisions.
Do not let an in-flight older GET replace a newer command answer. A failed periodic read keeps the last confirmed view and candidate. A failed new-scope or
recovery read freezes writes until an authoritative read succeeds; a periodic read failure alone
does not change known editing authority. Refresh cannot
clear an action's refusal merely because the read succeeded.

Apply the same rule to a lost first-save race, same-person revision conflict, refused takeover,
failed preparatory work, API replacement and a takeover whose reply is lost. A known refusal
keeps the original editor; an unknown outcome requires a read before any further write. No
automatic retry, takeover, candidate merge or Send follows recovery.

On bill/table navigation, look up retained candidates by stable `(personId,billId)` within the
same venue/app identity. Keep the original party ID, base edit state and generation on the
candidate for stale-write checks. When a bill moves or its parties join, reopening that same bill
finds the candidate even if its old party closed. Load the bill's authoritative current party and
edit state, then require review there; do not rewrite the candidate's old expectation into a fresh
write or apply it automatically. Late responses cannot populate the destination. Use existing leave/save/discard protection; a refused
save cannot be reported as successful navigation saving. Returning to a bill loads its current
saved state before review. Taking it back does **not** restore the old candidate automatically:
explicitly review the candidate against today's saved lines and reapply chosen edits through the
normal editor. Revalidate every recalled source reservation; do not revive a source already sent,
removed, moved or paid. Retain the candidate until explicit discard/review resolution.

At sign-out/session expiry, stop new writes and fence the old identity. Keep its in-memory
candidate inaccessible to a different person; the same person can review it after signing in
again in that app instance. A browser reload/close has no recovery guarantee; use existing
unsaved-leave protection and do not claim durable recovery. No new cross-person browser storage.

## 6. Join/move conflicts and the floor

Ownership follows the **bill**, not its table. Moving a whole party to empty tables, or moving a
bill to a party with no other unsent work, retains its editor. A split carries moved unsent dishes
and their editor to the resulting bill. Changes to bill contents still require the source and
destination editors, and existing payment/money/group/allergy restrictions remain.

Define the affected set for expected-state comparison before the transaction. Use only its
nonempty bills when comparing editors for a conflict:

- Party join: every current bill in both parties, including empty bills.
- Move a whole party into an occupied party: every current bill in both.
- Move a bill: the moved bill plus every current bill in the destination party; unrelated bills left
  behind are not part of this conflict set.
- Merge bills or transfer dishes: source and destination bills, including empty destinations.

For party/bill relocation, different editors among that set are an unresolved conflict. Return
409 `draft.taken_over` plus `conflicts:BillEditState[]` for the affected nonempty bills not owned
by the actor, sorted by bill ID. Show each existing bill/editor row with its existing Take over
action. The actor explicitly takes those bills one by one, then reviews and retries the move.
There is no automatic bulk takeover. A sole common editor can be retained during relocation;
bill merges/dish transfers require the actor to own each nonempty source/destination regardless.
Re-read the set and its expected states in the move transaction: a new outbox/editor since the
prompt refuses before moving any table, group, dish, bill, draft or source. Existing party revisions
also reject changed bill membership, so a newly created bill cannot be omitted from the expected set. Empty bills still
have expected versions to detect raced acquisition. Do not resolve conflicts by sending, discarding,
repricing, merging other people's drafts or changing a bill's payment allocation.

Same-owner bill merges may combine outboxes with the plan's slot-offset helper **only after**
these checks. Retain row/source IDs and allergy ticks; release the consumed bill's ownership and
advance the survivor's version. Split destinations are created and acquired in the split
transaction; rejected splits create neither a bill nor an ownership row. Preserve all existing
held-group move restrictions and source reservation uniqueness.

The floor lists **each nonempty bill/editor pair**, in bill order, with its unsent indication:
**“Bill 1 · Ana” and “Bill 2 · Luis”** at Table 4. Never collapse them into one table editor,
even when the editor names match. If a compact tile needs more room, its expanded table detail
must show the complete list; the two-pair example must fit visibly in the mockups. Taking Bill 1
changes only its pair. Sending its last dish removes only that pair; Bill 2 remains. Ready/held
signals remain independent. Floor reads claim nothing.

## 7. Approved copy and existing protections

These three EN/ES messages are **approved exactly**, including the final approval after correction:

| Use | EN | ES |
|---|---|---|
| Pay detailed refusal and `bill.unsent_dishes` code fallback, with existing bill heading | Send or remove the unsent dishes before paying. | Envía o quita los platos sin enviar antes de cobrar. |
| `table.draft_replaced_groups` | {groups} changed. The affected dishes have been re-arranged. Check New order and press Send again. | {groups}: los platos afectados se han reorganizado. Revisa Nuevo pedido y vuelve a enviar. |
| `table.draft_recovery_failed` | Could not refresh the order. Your dishes are unchanged. Try again. | No se ha podido actualizar el pedido. Tus platos siguen igual. Inténtalo de nuevo. |

The group labels use existing translations. Withdraw the five earlier Task 21 name/count strings;
do not retain their naming/count display as an alternative. Internal ownership refusals still
carry editor identity for takeover, distinct from Pay's simple unsent refusal. All **twelve**
approved cancellation translations remain exact. English till labels use **Void / Comp**;
Spanish uses **Cancelar / Descuento**. This does not rename internal `cancel`/`comp` wire actions.

Raced held targets retain the approved behavior: refuse atomically, refresh, re-place only affected
lines by A773 §2, save the corrected arrangement and send nothing until another press. If ownership
was lost, stop before that corrective save and keep the candidate. Never auto-send after recovery.

Pay checks fresh plus recalled dishes on its own bill in the same transaction as the new payment
reservation. Preserve completed-payment lookup, captured/pending reconciliation, provider callbacks
and established reservations. Already-taken money is recorded even if later ownership changed.
A new save/Recall after a payment reservation keeps its existing refusal. Automatic issuance cannot
invoice around that bill's unsent sources. No invoice, fiscal/hash, permission, money, allergy,
behavioral assertion or migration protection is waived. Task 15's separately approved paid-line
exception changes **only** service group, using unshipped SQL; every frozen field remains protected.

## 8. Worked example and pictures

At Table 4, Ana edits Bill 1: two saved bravas in Fire now (€8), one saved steak in a new held
Mains group (€18), and €14 of already-sent food. Luis edits Bill 2: two saved lemon pies (€12).
They can edit concurrently. The floor shows **Bill 1 · Ana; Bill 2 · Luis**.

Luis switches to Bill 1 and sees Ana's saved outbox read-only. He confirms takeover **of Bill 1**.
Its saved dishes and placement become his; Bill 2's dishes, editor and version are unchanged.
Ana sees Bill 1 read-only with Luis's name. Her locally added salad, still unsaved at takeover,
stays separately on her device and never appears on Luis's screen or either bill's total.

Luis sends selected bravas. Bill 1's steak remains unsent, so Pay gives the approved one-sentence
refusal. Sending the steak held empties Bill 1 and releases it. Luis can pay Bill 1 while his lemon
pies remain unsent on Bill 2. The floor now shows only **Bill 2 · Luis**. Either permitted waiter
can later fire the already-sent steak or serve the bravas without takeover.

[Light SVG](../../backlog/mockups/a773-one-editor/light.svg) ·
[Dark SVG](../../backlog/mockups/a773-one-editor/dark.svg)

These are design mockups, not product screenshots. They show concurrent Bill 1/Ana and Bill 2/Luis,
Bill 1's independent takeover, and Ana's read-only saved view beside her retained local salad.
[Light PNG](../../backlog/mockups/a773-one-editor/light.png) ·
[Dark PNG](../../backlog/mockups/a773-one-editor/dark.png)

## 9. Implementation handoff

The courses/groups spec §§3–4, 9–10, 13–14 and plan T24 plus its affected-task amendment map consume
this design. Preserve completed plan progress and Task 15;
apply ownership additions to existing work rather than repeat it. Before building, inventory every
write/read/replay caller and re-read foreign same-function reservations (A738/A739/public refund
seams). No ownership behavior was implemented or tested in this docs-only revision. No additional
user-visible choice is introduced; report one if implementation reveals it instead of guessing.

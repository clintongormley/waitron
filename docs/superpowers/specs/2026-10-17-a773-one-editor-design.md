# A773 — One editor for a table’s order

**Status: awaiting owner approval. Design proposal only.**

The owner, 2026-10-17: “There should only ever be one person changing an order at a time … another waiter opens the tab, they have to take over … before making changes.” This proposal replaces the parallel-draft rule in A773; implementation waits for approval.

## What the source currently says

These are **source observations, not verified runtime behavior**. No tests were run. Main was `45ce9e66d1c907a030212157d684cf04af0ee685`; the feature branch was `d2cc56475c512c094e6d924c0691312c2b7474dd`, with its in-progress target-recovery changes. Line numbers describe that inspected tree.

| Area | Observed in source |
|---|---|
| Approved design | A773 §4 gives each bill its own New order; §10 explicitly permits separate drafts for two waiters. Pay names their unsent dishes. See `docs/superpowers/specs/2026-10-16-a773-courses-and-groups-design.md:349`, `:515`; plan Tasks 9 and 21 at `docs/superpowers/plans/2026-10-16-a773-1-unsent-list.md:522`, `:829`. |
| Main ownership | The unique key is person + party. Listing returns everyone’s drafts. A waiter can create their own alongside another person’s; saving and submitting an existing draft check its owner and revision. Takeover transfers that draft and combines it with the taker’s existing draft. See **main** `packages/db/src/schema/order-drafts.ts:50`; `apps/server/src/order-drafts.ts:86`, `:114`, `:134`, `:198`, `:388`. |
| Feature ownership | The key adds bill ID. Listing still returns all party drafts; DraftSync selects the signed-in person’s draft for the active bill. Takeover affects one bill’s draft, rather than the whole table. See `packages/db/src/schema/order-drafts.ts:51`; `apps/server/src/order-drafts.ts:469`, `:1521`; `apps/till/src/state/draft-sync.ts:353`. |
| First device | Takeover first flushes the taker’s local edits. Certain save refusals reload the server draft; that reload replaces local lines. This path must change to preserve an unsaved candidate. See `apps/till/src/state/draft-sync.ts:414`, `:610`, `:682`. |
| Transitions | Bill merges and party moves relocate drafts, combining matching person/bill slots. Recall appends to the acting person’s bill draft. See `apps/server/src/order-drafts.ts:527`, `:561`, `:576`; `apps/server/src/draft-recall.ts:280`. |
| Pay | The feature checks fresh and recalled unsent dishes per bill, with owner/count details. The till flushes before Pay; completed payment lookup precedes the new-payment refusal. See `apps/server/src/bill-unsent.ts:13`; `apps/server/src/bill-payments.ts:1046`; `apps/till/src/till-app.ts:12505`, `:12566`. |
| Handheld and floor | Handheld uses the same app and draft flow: **main** `apps/till/src/till-app.ts:8602`; feature `:8715`. Floor polling runs every 15 seconds while its map is shown, and displays unsent-owner badges. That floor refresh is not an ownership watcher for DraftSync. See `apps/till/src/screens/till-floor-screen.ts:701`, `:2083`; `apps/till/src/till-app.ts:8489`. Draft GET currently calls `requireSession` without its passive option: `apps/server/src/till-api.ts:3403`; `apps/server/src/till-session.ts:117`. |

## Recommended scope

**One editor per seated party, across all its bills; one separate New order outbox per bill.** A party means the guests seated together, including joined tables.

Per-bill ownership would permit Ana to edit Bill 1 while Luis edits Bill 2 at the same table. That conflicts with “the table’s order has ONE editor.” Party ownership preserves that rule without merging bills, outboxes or table-wide kitchen groups.

Use the nonempty saved outboxes to establish ownership:

- Opening or reading a table never claims it.
- The first accepted addition or Recall establishes the editor.
- While any bill has unsent dishes, every nonempty outbox belongs to that person.
- Emptying Bill 1 does not release ownership while Bill 2 still has unsent dishes.
- **Once every outbox is empty, ownership ends.** Empty draft records do not reserve the table. Anyone may start the next addition.

If Ana and Luis both start from an empty order before either save answers, they can briefly have local candidates. The first accepted server save establishes the editor. The other save refuses and keeps that device’s candidate for explicit review; it never adds a second person’s saved outbox. This is the proposed meaning of one editor, rather than reserving an empty table just because someone opened it.

This needs no timeout, heartbeat, lease or reservation held merely because a screen remains open.

## What the waiters see and can do

A second waiter sees the saved unsent dishes, their arrangement and bill labels, under the current editor’s name. They can browse and switch bills, but order-changing controls require **Take over**. Opening another bill must not offer an independent editable draft.

Reuse the existing takeover confirmation, explaining that it covers **all unsent dishes at this table, on every bill**. On success, those saved dishes become the taker’s, retaining bill, line identity, placement, recalled sources and allergy references.

| Action | Proposed rule |
|---|---|
| Add, edit, remove, split or rearrange unsent dishes | Current editor only. |
| Send all | Sends the shown bill’s outbox, as arranged. |
| Selected Fire | Sends only the selected unsent dishes; the rest remain owned and unsent. |
| Recall | Current editor only; returns the dish to its original bill’s outbox. Existing started/paid restrictions remain. |
| Void, Comp and other order or bill changes | Require the editor while ownership exists. Existing reasons, permissions, payment and refund rules still apply. |
| Pay | Another person takes over first. The editor flushes local changes; Pay refuses if **that bill** has unsent dishes. Bill 2 may be paid while the editor’s Bill 1 outbox remains unsent. |
| Serve, Undo served, fire an already-sent held group or dish | **Builder’s call:** retain shared service access under existing permissions, without taking over unsent work. Existing kitchen preparation/pass actions also keep their own authority. |

The service exception lets Luis carry Ana’s ready dishes or fire the next held course without becoming her order editor. A raced held-group change retains A773’s explicit refresh and replacement behavior.

**Taking over itself changes no quantities, prices, discounts, payments, invoice, fiscal record or hash, and sends nothing to the kitchen.** It changes draft ownership, versions and audit information only.

## First device, races and unsaved work

After Luis takes over, Ana’s device becomes read-only on its next ownership refresh and shows Luis as editor. Stop pending autosaves and invalidate open editing windows and selections. Preserve browsing, Sent content and permitted service actions.

**Only saved dishes transfer.** Ana’s pending local changes are not assumed to exist on the server. Retain them separately as an unsaved recovery candidate; never silently discard, transfer, merge or resend them. Taking ownership back loads the current saved outbox first; reapplying a retained candidate requires explicit review.

The same preservation applies when takeover, its preliminary save, or its follow-up read fails. A confirmed refused takeover leaves the original editor in place. An unknown outcome requires a read before further writes.

Server requirements:

- Resolve the person from the authenticated session. Check ownership inside every affected write transaction, including new-draft creation, Recall, direct ordering routes, Void/Comp and new Pay starts. Disabled buttons are not enforcement.
- Take over **all affected outboxes atomically**, comparing the observed ownership version and draft revisions. A stale request changes nothing.
- Keep a monotonic ownership version across acquisition, transfer and release, so an old request cannot become valid again after the outboxes empty.
- **Send versus takeover:** if Send commits first, takeover refreshes before proceeding; only remaining unsent dishes can transfer. If takeover commits first, the old editor’s new Send refuses. A retry of an already completed Send returns its original result without restoring editing authority.
- Preserve established payment reconciliation and completed-payment replay. Ownership changes must never interrupt recording money already taken; existing payment-in-flight restrictions remain.
- Two devices signed in as **the same person** share ownership and need no takeover. Revision conflicts still refuse stale writes and retain their local candidates.

**Builder’s call:** use a bounded passive ownership refresh while the table is open, initially matching the floor’s 15-second interval, plus refresh on focus and after commands. Refresh metadata without resetting local drafts; ignore older responses. Server guards apply immediately even before another device refreshes.

## Party transitions and live floor

Moving a whole party keeps its editor. Bill outboxes follow their actual bills. Splitting into an empty party carries the owner of any moved unsent dishes; each resulting party releases ownership when its own outboxes empty.

**Builder’s call:** joining parties or moving a bill must refuse an unresolved ownership conflict. The actor first explicitly takes over the affected nonempty orders; the move must not silently absorb another editor’s work.

The floor shows one editor name with the existing unsent indication, aggregated across bills. Takeover changes Ana to Luis; the indication disappears only when every outbox is empty. Ready and held signals remain independent. Viewing the floor never claims ownership.

## Ana and Luis — Table 4, Bill 1

Two already-sent dishes total €14. Ana has saved two bravas under Fire now and one steak under a new held group on Bill 1. Luis opens Table 4 on his handheld. He sees those dishes and **Take over**, but cannot add, remove, Send, Recall, Void or Pay as editor.

Luis confirms takeover. The three saved dishes become his, still on Bill 1 and in the same places. Ana’s device shows Luis as editor. Any extra change still pending only on Ana’s device stays there as an unsaved candidate.

Luis selects the bravas and presses Fire. The steak remains unsent, so Pay says to send or remove it. He sends the steak held; Bill 1’s New order empties. Ownership ends if no other bill has unsent dishes. Either permitted waiter can later fire the held steak or serve the bravas.

## Pictures

[Light theme](../../backlog/mockups/a773-one-editor/light.png) · [Dark theme](../../backlog/mockups/a773-one-editor/dark.png)

These are review mockups, not screenshots of implemented ownership.

### What they show

One SVG with **two phone-width panels**, using the existing A773 panel layout and design tokens:

- **Left — Luis before takeover:** “Table 4 · Bill 1”; Sent collapsed; “New order · Ana”; Fire now: bravas ×2; new held group: steak ×1. Rows read-only; **Take over** prominent; ordering and Pay controls quiet and disabled.
- **Right — after takeover:** identical dishes and placement under Luis, with selection enabled and Send all available. Move to… and Fire remain quiet and disabled until a line is selected. Below, a small inset of Ana’s screen shows “Luis took over,” the read-only outbox and a separate retained unsaved-change notice when applicable.

Small floor-chip annotations show **Ana → Luis**. Do not depict a local unsaved candidate travelling between devices. Both themes accompany this proposal.

## A773 amendments

After approval:

- **Spec §§3.5–3.7, 4, 9–10, 13–14:** replace parallel personal drafts with party-wide editing ownership, bill-specific outboxes, atomic takeover, empty-outbox release, retained local candidates and the service exception. Replace named Pay refusals.
- **Plan goal, ownership/interface decisions and review focus; Tasks 3–4, 8–12, 19–23 and coverage inventory:** align their ownership, transitions, display, command and refusal requirements with this design. Retain existing money, fiscal, allergy, placement and behavioral protections.
- Prelive: no compatibility reader or backfill. Reset incompatible development data rather than combining old owners automatically.

## Pay wording

Use one sentence for both the detailed refusal and code fallback, with the existing table/bill heading:

- **EN:** “Send or remove the unsent dishes before paying.”
- **ES:** “Envía o quita los platos sin enviar antes de cobrar.”

Remove the proposed name/count variants. Reuse Take over and existing takeover notices where their meaning still fits. The twelve approved cancellation translations remain approved; till terminology follows **Void / Cancelar** and **Comp / Descuento**.

## Builder calls and checks for the driver

Builder calls are the empty-outbox release, shared service exception, refresh interval and transition-conflict refusal above.

Before building, check reuse of the party revision for ownership changes, every direct mutation/payment entry point, and preservation of local candidates through reload, navigation and session teardown. Candidate recovery here makes no promise of surviving a browser reload. None of these behaviors was runtime-verified in this invocation.

## Approval

Approve the whole-table editor, first-accepted-save rule, takeover and empty-outbox release, the shared service exception, and the wording above, or name the changes you want. The current product code remains on the earlier design until this is agreed.
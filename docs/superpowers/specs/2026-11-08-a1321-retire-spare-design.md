# A1321: retire a dead or reset spare

When a joined spare dies or is reset, you should be able to remove it from Servers so the main
box stops waiting for it at later starts. Extend **Remove / Retirar** with two declarations.
Keep the old box's data and fiscal originals; notification of an offline machine is unclaimed.

**2026-11-08: full design awaits OWNER approval. Build waits for A947 3b-6. No implementation plan.**

Authority, quoted for the review reader:

- Lane K `/Users/clintongormley/waitron-campaign-k/queue.md`, A1321, OWNER 2026-11-04:
  “Yes, before go-live”. This approves the need, not this full design.
- `/Users/clintongormley/waitron-campaign-k/questions.md`, WATCHER 2026-11-07 21:59:
  “write the design now (docs only, Claude read, bring it to me past one page). The build waits
  for A947 slice 3b-6, as the item says.”
- Same file, WATCHER 2026-11-08 02:33: “extend the existing Remove to a joined serving-secondary,
  both declarations checked on the server”; “Retiring requires exactly what the existing Remove
  action requires today”. The reduced scope below follows that answer.
- Same file, OWNER relayed 2026-11-07 22:51, A1002 item 5: “node.promote stays merged with
  node.manage, as accepted on 28 October; do not split them again.”

**SOURCE READ ONLY at `e0e4f5b8fd`; no runtime verification.** `apps/server/src/membership-removal.ts:43-52,71-74`
checks local node rows and explicitly cannot establish completed remote adoption today.
`membership-removal-api.ts:45-52` authorizes the existing session; `boot-peer-check.ts:130-138`
skips evicted peers. `apps/dashboard/src/screens/servers-screen.ts:264-266` uses server eligibility.
[A947 D17/G/Task 6.10](../plans/2026-11-04-a947-3b-spare-hosts-store.md) describe the unbuilt join
and dead-spare limit. These are not working joined-spare removal receipts.

**Proposed interaction.** Explain the joined spare in the existing dialog, naming address and
machine id. Require “This spare is switched off” and “No other recovery is in progress”. Keep
Remove disabled until both are checked; **Stop / Parar** changes nothing. Use the existing
administrator session with `node.manage`, following A1002, without another password or second-factor
form. [A1002's document](2026-10-22-a1002-custom-roles-design.md) still says separate promotion;
the newer recorded answer governs here.
When the main is waiting, use existing Carry on first, then Servers; add no waiting-page flow.

**Proposed saved change.** Under the write locks, check both declarations, expected chart term,
main-box authority and target. A current `serving-secondary` is eligible even if it once sold;
refuse current `serving-primary`/`sell-only` targets and unfinished handovers involving it.
Existing handover recovery is prerequisite: removal neither cancels nor bypasses it.
Sign the next chart with the target `evicted`; retain its Removed row until existing Clear moves
the id to `revoked`. Reuse the existing removal audit (`membership-removal.ts:266`) in the chart
transaction, with no new record/table. Keep node data and fiscal originals. Save the venue change
first, then clear only the matching pair link; retries repair interruption without broader deletion.
A replacement joins normally with a fresh id.

**Return boundary.** Existing mirror/promotion rules continue. Delivery to an offline old box is
unclaimed; add no retired-key trust exception, start check, proof system or future takeover work.
Preserve [A1018 fiscal-return/archive gates](2026-10-23-a1018-simple-handover-design.md#5-point-3-fiscal-only-return-with-a-visible-business-gap)
and [A1308 U5's kept second-box path](2026-11-02-rationalisation/README.md#5-decisions-made-across-the-areas).
Removal grants no permission to wipe a past-selling disk.

**Build acceptance.** Restart no longer counts that id; missing declarations, stale term and
unfinished handovers refuse without changes; Stop changes nothing. Cover once-selling spares,
retries, fresh replacement ids and preserved fiscal originals. Update
`apps/server/src/guide/{en,es}/servers.md` with shared `{#retire-spare}`; revise EN/ES
`membership.standby_joined` error and A947 G recovery wording.
The dated A947 pointer replaces D17/Task 6.10's duplicate backlog filing; once built, update those
behavior descriptions through a dated pointer, preserving historical text.

**Owner question:** approve this reduced design for planning, with build held until A947 3b-6?

# A1321: retire a dead or reset spare

**2026-11-08: proposal for OWNER APPROVAL. No build approval.**

Authority: `/Users/clintongormley/waitron-campaign-k/queue.md`, A1321:
“Retire a dead or reset spare from the Servers screen, so the main box stops waiting for it
— DESIGN FIRST, then BUILD”. It records the owner's 2026-11-04 “Yes, before go-live”
(entry added about 06:15). `/Users/clintongormley/waitron-campaign-k/questions.md`, watcher,
2026-11-07 21:59: “write the design now (docs only, Claude read, bring it to me past one page).
The build waits for A947 slice 3b-6, as the item says.” Product approval remains yours.

**Grounding, read-only observations at `aedb0c8f0d`; no runtime verification.**
`apps/server/src/membership-removal.ts:71` refuses a joined secondary with
`membership.standby_joined`; `apps/server/src/boot-peer-check.ts:130` selects active peers and
counts joined ones. The real join and its dead-spare limit belong to the **unbuilt**
[A947 3b plan](../plans/2026-11-04-a947-3b-spare-hosts-store.md), D17 and Tasks 6/G.

**Proposed interaction.** Extend the existing Servers Remove action/dialog for a joined spare.
Name its address and machine id; explain that future starts will stop waiting for it and that its
copy will stop receiving updates. Require fresh `node.promote` authorization alongside existing
`mirror.create`, using password and the enrolled second factor, with sign-in offered inline.
Require both Carry on declarations: this spare is switched off; no other recovery is in progress.
Offer **Stop**, which changes nothing, and **Retire spare**, disabled until complete.
If the main box is waiting, use existing Carry on first, then Servers.

**Proposed saved change.** Recheck the main box, target, expected chart term and handover state
under the write locks. Refuse a known former selling box or an unfinished handover endpoint.
Sign the next chart with the spare `evicted`, retaining previous revoked ids. Keep its Removed
row until existing Clear moves its id to `revoked`; never simply forget it. Retain its `nodes`
row/key and all fiscal data. Reuse the removal audit and Carry on's `node_handover_events`
storage for actor, target, term and declarations. Save the venue change first, then clear only
the matching A947 pair link and reload the stream, with retry repairing interrupted node writes.
A replacement joins normally with a fresh id.

**Proposed return path.** Eviction does not deliver a message. Today signed peer queries use
`peerKeyOf` (`apps/server/src/peer-status-api.ts:103`), which rejects evicted/revoked keys
(`packages/membership/src/verify.ts:163`); mirror starts also skip the peer check
(`apps/server/src/boot.ts:1834`). Add a chart-only exception on existing peer-status: verify a
retired requester's retained joined-node key, return only the signed chart in the existing status
envelope with its nonce, and grant no handover access; keep `peerKeyOf` restrictive elsewhere.
Check on spare start and before promotion; accept only a verified newer chart.
Learned eviction keeps the box read-only and bars promotion or automatic
rejoin. Lost local identity keeps A947 G's refusal. This changes a fiscal start step: **the owner
lands the build**, after 3b-6.

Keep [A1308 U5](2026-11-02-rationalisation/README.md#5-decisions-made-across-the-areas)'s retained
second-box path and [A1018 §5](2026-10-23-a1018-simple-handover-design.md#5-point-3-fiscal-only-return-with-a-visible-business-gap)'s
fiscal return/archive gates. Retirement grants no permission to wipe a past selling box.
No message stops an isolated old copy: the same switched-off/no-parallel-recovery human
declaration boundary applies.

Update `apps/server/src/guide/{en,es}/servers.md`: shared `{#retire-spare}`, declarations,
Carry on first when waiting, replacement joining, and preservation of old selling disks.

**Behavioral acceptance:**

- Retirement survives restart; the main no longer waits for that id.
- Stop, missing declarations, stale charts and competing handovers change nothing.
- Returning/cleared ids learn eviction; unknown keys gain no access; offline delivery is unclaimed.
- Retry preserves the audit, replacement admission and A1018 fiscal return.

**Owner question:** approve these proposed defaults, including the restricted chart read and
owner-landed start change, for planning with build held until 3b-6?

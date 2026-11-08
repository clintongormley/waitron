# A1321: retire a dead or reset spare

You can remove a dead or reset spare from Servers, after confirming it is switched off.
The main box stops waiting for it at later starts. Keep its data and fiscal originals.

**Proposed, not built. Full design awaits OWNER approval; build waits for A947 3b-6.**

**Recorded authority.** Lane K `/Users/clintongormley/waitron-campaign-k/queue.md`, A1321,
OWNER 2026-11-04: “Yes, before go-live”. In that lane's `questions.md`, WATCHER 2026-11-07
21:59: “write the design now (docs only, Claude read”; build waits for 3b-6. WATCHER
2026-11-08 02:33: “extend the existing Remove to a joined serving-secondary, both declarations
checked on the server”; “Retiring requires exactly what the existing Remove action requires
today”. OWNER relayed 2026-11-07 22:51: “node.promote stays merged with node.manage”.
These authorize this proposal, not its build.
WATCHER 2026-11-08 02:53, same file: “delete the client expected-term field and check”;
“keep the matching-link repair”; “Publish it for the owner's full-design approval”.

**SOURCE READ ONLY at `e0e4f5b8fd`; nothing run.** `membership-removal.ts:43-52,71-74`
checks local rows; completed remote joining remains unbuilt in
[A947](../plans/2026-11-04-a947-3b-spare-hosts-store.md). Its Task 6.2 writes the spare's row.
`boot-peer-check.ts:130-138` skips evicted peers. Paths are under `apps/server/src/`.

**Interaction.** Extend **Remove / Retirar**, retaining **Cancel / Cancelar**, which changes
nothing. For joined spares, require “This spare is switched off” and “No other recovery is in
progress”, naming its address/id. Never-joined removal stays as today. The listing exposes whether
confirmation is required, derived from the completed-join row; the server rechecks under the lock.
If joining finished meanwhile, return `membership.standby_joined` asking for these declarations.
EN: “Confirm that this spare is switched off and no other recovery is in progress.”
ES: “Confirma que este servidor en espera está apagado y no hay otra recuperación en curso.”
Use the existing session and whatever permission Remove checks when built, called `node.manage`
in [A1002](2026-10-22-a1002-custom-roles-design.md). A1321 neither adds nor renames a permission
and adds no authentication form. If waiting, use existing Carry on first, then Servers.

**Saved change.** Reuse the chart writer's reread/rejudgment, with no client expected-term field.
Recheck main authority and target: a `serving-secondary` remains eligible if it once sold;
current primary/sell-only targets remain refused. An unfinished handover involving it refuses
with `handover.operation_in_progress`; existing recovery must finish or abandon it first.
Check declarations server-side but do not store them or add columns.
Sign the target `evicted` and write the existing removal audit together. Keep its node data.
Existing Clear later moves its id to `revoked`.

After the venue commit, clear only the matching pair link and reload the stream. Remove's
already-removed answer and Clear also perform that cleanup. Before refusing a replacement join
for an existing link, repair it only when the held chart already marks that linked id evicted
or revoked; preserve every active link. This covers interruption after either chart commit
without new records or start checks. A replacement gets a fresh id.

**Return boundary.** An offline box is not promised notification. Existing mirror/promotion rules,
[A1018 fiscal return/archive](2026-10-23-a1018-simple-handover-design.md#5-point-3-fiscal-only-return-with-a-visible-business-gap)
and [A1308's retained second box](2026-11-02-rationalisation/README.md#5-decisions-made-across-the-areas)
continue. No trust exception or permission to wipe a past-selling disk.

**Build checks and copy.** Cover restart, both interruption points, replacement admission,
unchanged active links, declarations, joining during confirmation, handover refusal and Cancel.
Update EN/ES Servers guides, dialog explanations and `membership.standby_joined`,
`mirror.spare_already_joined`, `backup.spare_stream_active`, `credentials.rotation_spare_joined`;
replace “join from scratch” for past-selling spares. Date A947 D7/D17/G/Task 6.10 updates;
ask the CLAUDE.md maintainer to clarify active peers. Preserve historical text.

**Owner question:** approve this reduced proposal for planning, with build held until A947 3b-6?

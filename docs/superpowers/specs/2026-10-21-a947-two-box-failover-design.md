# A947 — Go-live on two local boxes: a spare box that takes over

**Date:** 2026-10-21, revised the same day for the owner's answers. **Status:** design; all four
questions answered (§12); the revision awaits the owner's approval. Nothing in it is built.
**Item:** A947. **Refreshes:** the
[topology design](2026-09-16-sqlite-litestream-topology-design.md) §4.4 (on-prem primary → on-prem
mirror), §5 (promotion, return, tail shipper, split brain), §6 (trust and fencing) and §11 (build
order, slices 3–5). Where this document and that one differ, this one is newer; that one is not
rewritten, and carries a dated pointer here.

**Mock-ups:** [`docs/backlog/mockups/a947-two-box-failover/`](../../backlog/mockups/a947-two-box-failover/README.md).

> **Revision 2026-10-21 — the owner's answers.** What changed, section by section:
>
> - **Question 1 (who switches): a manager, from any till** — as recommended. The owner then
>   added: "For the failover we can't wait one hour. We need to have an emergency suffix or prefix
>   to enable going live immediately." New **§6.5**: every switch names the spare's invoice series
>   with A679's hour code **plus the minute** (`A-06XV-40`), so a second switch in the same clock
>   hour sells at once. It touches invoice series, so it is its own fiscal slice, **4a**, which the
>   owner lands. The old "one case makes the venue wait" paragraph is gone.
> - **Question 2 (the proof at the switch): the manager's passkey, or password plus authenticator
>   code when one is enrolled** — the dashboard's sign-in, asked the same way on a till. The switch
>   no longer asks for the recovery sheet's installation code or the emergency (break-glass) key.
>   **§6.2** and mock-up 2 are rewritten; §6.2 says how this meets W41s's "fresh administrator
>   re-authentication".
> - **The owner's point that the counter till dies with the main box.** New **§6.6**: any device,
>   even one that has reloaded, reaches the switch — each box gets its own name under
>   `waitron.local`, the spare answers the venue's name with only its switch page while the main
>   box is silent, and a QR label on each box opens that page. It solves the two passkey traps (a
>   passkey works only under the name it was registered for; a phone passkey used at a till needs
>   the internet) and says what works with no internet. New slice **4d**; new mock-up 7. While
>   checking it, a defect in today's code turned up: both boxes put the same address,
>   `https://waitron.local`, in the membership chart, so a till's router sees one server, not two
>   (§2).
> - **"Do we need the recovery key for anything?"** New **§6.7** answers it. The answer the
>   watcher gave is half right and is corrected there: the recovery sheet plays no part in getting
>   back in when nobody can sign in.
> - **Question 3 (the returning main box): it hands over and becomes the spare by itself, but
>   only after three checks** — the new main box holds every handed-over record (count and
>   fingerprint), the new main box is healthy, and the returning box has archived its own
>   database. **§7.2** is rewritten; mock-up 4 is redrawn; new slice **5d**.
> - **Question 4 (a spare for every venue?): a choice** — as recommended (§4, §9).
> - **Slices** (§11): slice 4 now has five pull requests (4a the switch's series, 4b promotion
>   from a followed copy, 4c the screens, 4d reaching the switch, 4e the hand-over); slice 5 has
>   five (5d becoming the spare by itself, 5e copy-up).
> - New mock-ups 6 (the Friday worked example) and 7 (reaching the switch); mock-ups 2 and 4
>   redrawn; mock-up 5 stays as question 1 was asked.

---

## 0. Why this exists

The owner, on 2026-10-21 at about 08:25, asked whether the first venue can go live on one box:

> "For go live I want one box with failover to another local box. Shortly thereafter I want to add
> cloud, also the ability to run the main server in cloud from the outset. We need to get the
> necessary infrastructure in cloud built to support this and other services."

That replaces the September goal of a standalone box first, and the backlog line that accepted one
box with no failover "for exactly as long as Waitron is pre-production"
(`docs/backlog/replication-cloud.md`, "Replication, membership & failover — residuals"; updated in
this change).

So the go-live venue has **two boxes on site**. One sells — the **main box**. The other keeps a copy
of everything the main box writes, about a second behind, and does nothing else — the **spare box**.
When the main box dies in the middle of a dinner service, a manager switches the venue to the spare
box from any till, and the venue keeps selling with no internet. When the old main box comes back,
it hands over the sales the spare never saw, checks that the new main box has them and is healthy,
and becomes the new spare by itself.

"Main box" and "spare box" are the names staff and managers see. The code's words are primary and
mirror (`deployment mode`, `apps/server/src/promote.ts`); this document uses the staff words except
where it names code.

## 1. Goals, non-goals, anti-goals

**Goals.**

1. A venue with two boxes keeps selling when either box dies, with **no internet at all**.
2. Switching to the spare takes **one manager, at any till, in under two minutes**, during service —
   and **never waits for the next clock hour** (owner, 2026-10-21), however many switches the hour
   has already seen.
3. Open tables survive the switch: an open bill on table 4 is still open on the spare.
4. Nothing is filed with AEAT twice, no invoice number is reused, and no chain forks — the fiscal
   rules of CLAUDE.md §5 and the W41s recovery contract hold unchanged.
5. A sale the main box took in its last second, which never reached the spare, is not lost: it is
   handed over when the old main box returns.
6. Adding the spare box needs **no internet** either (owner, 2026-10-02: "Adding a mirror while the
   internet is down").
7. The pieces are the ones the Cloud topologies will reuse, so a Cloud standby and a Cloud-hosted
   main server are the next step, not a rebuild (§10).

**Non-goals for go-live.**

- Cloud anything: a Cloud standby, a Cloud-hosted main server, Cloud promotion. They come next
  (§10); lane D's D88 designs the Cloud side in parallel.
- Switching automatically with nobody deciding (the owner chose a manager, question 1).
- Three or more boxes. The membership chart allows up to eight machines (`MAX_NODES`,
  `packages/membership/src/verify.ts`), but go-live needs two, and every rule here is written for
  two.
- Merging two divergent sets of open tables after a split brain (shelved since 2026-09-16, topology
  §5.3).

**Anti-goals — it fails even if it "works" when:**

- a switch can leave **two boxes selling at once** without somebody having been told, in plain words,
  that they are about to cause it;
- staff need a terminal, a laptop or a phone call to us to switch;
- adding the spare **silently stops** a backup the venue already had (the owner's bucket stream);
- the switch needs something the manager on shift cannot have to hand at 21:40 — which is why it
  asks only for the manager's own sign-in, never a sheet kept in an office (question 2);
- a device that has reloaded its page, or lost the box it was attached to, **cannot find the
  switch** (§6.6).

## 2. What exists today, and what is missing

Read from the tree on 2026-10-21 (A947's research; every pointer is a file this design builds on):

- **Promotion code exists.** `promoteMirrorToPrimary` (`apps/server/src/promote.ts`) takes an
  operator's fence attestation (`promotion.fence_not_attested`), refuses a node its own document
  marks fenced (`promotion.node_fenced`), runs each module's `provisioning.standby.activate` seat,
  checks the standard and full series, and commits the role flip and a new membership document in
  one transaction. A manager route calls it (`apps/server/src/promote-api.ts`). That route takes a
  person's id, password and an authenticator code, or an emergency "break-glass" key instead
  (`promote-api.ts:105-113`; break-glass first at `:147-150`); the code is asked only of a person
  who has one enrolled (`packages/identity/src/manager-login.ts:105-107`); it needs `node.promote`
  (`promote-api.ts:169`) and ends the session it opened (`:171`). It accepts no passkey.
- **Joining exists, but copies no data.** A spare fetches a bundle from the main box
  (`POST /management-api/mirror-bundle`, `apps/server/src/mirror-bundle-api.ts`; the fetch logs in
  with a password, and an authenticator code when the person has one,
  `apps/server/src/mirror-bundle-fetch.ts`). The bundle carries identity and setup only: the
  spare's node id, the tenant, the box certificate authority's **public** certificate (`ca.crt`; the
  bundle reads only `caCertPath`, so the private `ca.key` stays behind), the relay address, the account
  key, each module's dormant standby state, and module overrides (`apps/server/src/mirror-bundle.ts`).
  Under hour-coded series the fiscal module's standby state carries **no series**: the bundle
  refuses one (`series === "on-activation"`, `mirror-bundle.ts`), and the spare is held dormant
  (`packages/fiscal-verifactu/src/hour-dormant-standby.ts`). Because no rows follow, a joined box
  stays in adoption-pending for good (`apps/server/src/finish-adoption.ts`, "PendingAdoption").
- **The stream exists, to S3 only.** Slice 2 streams the main box's `venue.db` with Litestream 0.5.17
  to an owner's S3-compatible bucket: generations named `gen-<term>-<node>-<time>` with a create-only
  marker, a signed `current.json` pointer moved only by a conditional write, freshness, the alerts,
  the 256 MiB side-file pause, and the rebuild from the bucket (`packages/stream/src/*`,
  `apps/server/src/stream-host.ts`, `apps/server/src/restore-stream.ts`). Nothing streams box to
  box, and nothing follows a stream.
- **The fiscal side of a take-over is decided by A679 and W41s, not by this item.** W41s-4's
  decision A (owner, 2026-10-12) kept the standby dormant until take-over: "At promotion, require
  fresh administrator reauthentication, the old-machine-offline and no-parallel-recovery
  confirmations" ([decision](../plans/2026-10-12-w41s4-standby-activation-decision.md), lines 39-41).
  The owner then replaced the paper register with **hour-coded series** (A679, approved 2026-10-16;
  [design](2026-10-16-a679-hour-coded-series-design.md)): "Standby admission | Keep it dormant
  without reserving a future hour. Promotion selects its hour when activation occurs", and "There
  is no register". At promotion the box picks a UTC hour **strictly later than every hour it knows
  of** — in code, a selected hour at or below the greatest spent hour refuses `hour_not_later`
  (`packages/fiscal-verifactu/src/hour-selection.ts:464-471`) and the wait runs to the next UTC
  hour (`:498`) — after comparing its clock with the browser's and, when online, an AEAT or an
  already configured Waitron origin's (flagging more than 120 seconds). For a recovery the operator
  types one installation code from the recovery sheet: "Your sheet prints only this node's current
  installation code. Enter that one four-character code in the recovery form" (owner, 2026-10-19,
  superseding the 2026-10-18 list). The server's hour selection takes the same proposal for a
  promotion and a recovery — an `answer` and a non-empty `installationCodes` list
  (`packages/fiscal-verifactu/src/hosted-hour-recovery.ts:79-86`; an empty list refuses
  `installation_codes_invalid`, `reported-hour-codes.ts:7`) — but no screen sends a promotion's
  yet: A679 names "Dormant promotion's host preparation" as still open. §6.2 and §6.5 change what
  a promotion asks. Activation itself landed with W41s-4 (#1700): for the **activating box's own
  rows only**, it revokes that box's live SIF (the "SIF" is the registered invoicing installation
  AEAT knows: taxpayer, software and installation number), inserts a new one, empties its chain
  head and retires its series for new ones (`packages/fiscal-verifactu/src/allocation.ts:434-460`,
  every step filtered by the activating node), reached through `standby.activate`. The old main
  box's SIF and series are left as they were; they are its own, and nothing issues on them while it
  is fenced. A promoted box therefore starts a **new installation identity, new series and a new
  chain**, never resuming the dead box's (CLAUDE.md §5).
- **Tills already follow whichever box sells — in principle.** Every 5 seconds a till's router
  asks each server in the membership chart's list (`routableServers`) whether it is accepting
  sales, and moves to the one that is, preferring the highest term; on a move it signs the person
  out, drops unsaved drafts and starts again against the new server
  (`apps/till/src/api/server-router.ts`, `apps/till/src/till-app.ts`). `acceptingSales` is true
  only on a primary that is neither a mirror nor fenced (`apps/server/src/boot.ts`). The print
  agent carries its own copy of this router (`packages/print-agent/src/router.ts`). **But today
  both boxes put the same address in the chart:** a box's `contactUrl` is its advertised origin
  (`boot.ts:1304` for the first box, `apps/server/src/adopt.ts:89` for a joining one), which is
  `https://waitron.local` unless configured otherwise (`apps/server/src/config.ts:549-551`), and the
  router keeps one entry per address (`server-router.ts:190-191`). So with two boxes the router
  sees one server. §4 gives each box its own address.
- **A returning box already fences itself at start when it has a peer configured**: it fetches the
  peer's chart, keeps it if newer, and if that chart fences it, starts as a secondary behind the
  read-only gate (`apps/server/src/boot.ts`, `membership-reconcile.ts`). Filing runs only on the
  `singleton_role = primary` box, re-read on every pass (`apps/server/src/singleton-pass.ts`).
- **Every box answers `waitron.local` with no role check** (`apps/server/src/mdns.ts:63-64`, a
  responder of our own that answers only the one name it is given, called from `boot.ts` with
  `BOX_HOSTNAME`, `:365`), and the install bakes that name in as the one origin every till is
  handed (`deploy/compose.yml`, `deploy/Dockerfile`; pairing shows `config.advertisedOrigin`,
  `boot.ts:1817`). Two boxes on one network today would both claim it.
- **Passkeys are bound to that one name, and the till has none.** A passkey is a sign-in key kept
  on a phone, a computer or a security key, unlocked by the person's fingerprint, face or PIN. The
  box registers and checks passkeys for one relying party — the name a passkey belongs to — set
  from `WAITRON_MANAGEMENT_RP_ID` and `WAITRON_MANAGEMENT_ORIGIN` (`apps/server/src/config.ts:484-492`),
  which the image sets to `waitron.local` and `https://waitron.local` (`deploy/Dockerfile:276-277`).
  Every passkey sign-in requires the person to unlock the key ("user verification",
  `packages/identity/src/passkey.ts:228-231`, checked at `:278-281`). Only the dashboard offers
  passkeys; the till signs in by PIN (`apps/till/src/api/client.ts:2621`).
- **Each box has its own certificate authority, limited to the venue's names.** A box's
  certificate authority may sign only `waitron.local` and `localhost` and private addresses
  (`apps/server/src/self-signed-cert.ts:33-39`, marked critical); each box's certificate names
  `waitron.local`, `localhost` and the box's own private IPv4 addresses (`self-signed-cert.ts:176-178`,
  `apps/server/src/box-secrets.ts:57`). Devices trust that authority because it is installed on
  them at pairing (`apps/server/src/trust-page.ts`).
- **Only the primary sells** (CLAUDE.md §5), and the drain files across every SIF in the database
  with no node filter (`claimBatch`, `packages/fiscal-verifactu/src/drain.ts`).
- **Each box keeps its secrets' key outside the database.** Credentials in `tenant_credentials`
  (a `local` table that, like every table since slice 2, lives in the streamed `venue.db`) are
  sealed under `WAITRON_CREDENTIALS_KEY` from the box's own environment
  (`packages/credentials/src/keyring.ts`), so a copy of `venue.db` on another box cannot open the
  AEAT certificate or a card provider's keys. This is the open "vault-ring question"
  (`docs/backlog/replication-cloud.md`, "Fiscal-certificate distribution").

What is missing is everything between "a spare has joined" and "the spare is selling": the data
getting there, the spare keeping up, the switch, devices finding the switch and the new main box,
the old main box coming back, and the screens.

## 3. The shape: the spare box hosts the stream

```
   main box (sells)                         spare box (waits)
   ┌──────────────┐  Litestream, over LAN  ┌───────────────────────────────┐
   │ venue.db ────┼──────── S3 ───────────▶│ a small S3 store on its disk   │
   └──────────────┘                        │        │ follows (restore -f)  │
                                           │        ▼                       │
                                           │ a copy of venue.db, ~1 s behind│
                                           │        │ copies up, when online│
                                           └────────┼───────────────────────┘
                                                    ▼
                                         the owner's bucket (if they have one)
```

**The main box streams to an S3 store that runs on the spare box.** The spare follows that store
into a local copy of `venue.db`, so it is always about a second behind whether or not the internet is
up. When the venue has a bucket, the spare copies its store up to it.

Three reasons for this shape, each checked:

1. **Litestream 0.5 streams a database to one place only.** At the pinned tag,
   `cmd/litestream/main.go:794-795` refuses a second replica: "multiple replicas on a single
   database are no longer supported" (read 2026-10-21 with `curl` from
   `raw.githubusercontent.com/benbjohnson/litestream/v0.5.17`). So the main box cannot stream to
   the spare and to the bucket at once; the spare has to receive it and pass it on. This is the
   topology design's §4.4, unchanged.
2. **Slice 2 built everything on S3**, so the spare speaks S3 rather than the SFTP the topology design
   named. The generation marker, the pointer's conditional write, the bucket probe and the rebuild
   all work against any S3 store (`packages/stream/src/conditional.ts`, `pointer.ts`, `probe.ts`).
   SFTP offers no conditional write, so the pointer's tie-break (topology §2.2) could not run on it.
   This is **my call**, and the one place this design departs from §4.4's text.
3. **The store is versitygw**, which the test suites already run as the S3 server
   (`scripts/setup-s3-test-server.mjs`, pinned 1.8.0), and on which the stream loop test already
   checks the conditional write (`apps/server/src/stream-loop.e2e.test.ts`). It is Apache-2.0
   (GitHub API, `repos/versity/versitygw`, read 2026-10-21: `"spdx_id": "Apache-2.0"`, not
   archived, last push 2026-10-21). In the box image it is a new binary, so it ships with its licence
   notices in `/app/third-party/` (CLAUDE.md §3).

**Both boxes run the same image and can play either part.** Which one is the main box is a fact in
the membership document, not in how the box was installed — so the USB installer (B3) does not need
to know which box it is installing (§9).

**What crosses the LAN is the whole database**, sessions and sealed credentials included, so it
travels over TLS under the venue's certificate authority, and the S3 store accepts only the access
key minted for this pair at joining.

## 4. Adding the spare box

**A spare is a choice, not a requirement** (owner, question 4). Setup offers "Add a spare box to
this venue"; the Servers screen shows it; a venue with one box keeps today's "only one copy"
warning and, if its box dies, is restored from its bucket or archive onto a new box. The first
venue has two.

The setup wizard on a fresh box offers "Add a spare box to this venue" (today's "Add a mirror node",
which `apps/setup` currently marks as not working; backlog, "should the setup wizard still OFFER
'Add a mirror node'"). It finds the main box by its local name, a manager signs in, and:

1. **The bundle grows two secrets: the venue's credentials key and the certificate authority's
   private key.** The credentials key (`WAITRON_CREDENTIALS_KEY` and its version, plus a previous
   key while a rotation is open) lets the spare open the AEAT certificate and the card provider's
   keys the moment it is switched on, with no internet and nobody re-entering them; this answers the
   vault-ring question (§2) by making the two boxes share one ring. The authority's key (`ca.key`,
   held back today) lets the spare issue and later renew the certificates for the venue's name and
   its own (item 5), including after the old main box is gone for good, under the authority every
   device already trusts. Both are **my call**. The
   bundle already carries one secret, the account key, over the same signed-in channel, but these
   two are new to it, and the cost is stated: the venue's secrets now sit on two disks in the same
   building. The builder lists every row sealed under the ring and confirms each is venue-wide (the
   AEAT certificate, card keys, bucket keys).
2. **Each box's own signing key leaves `venue.db`.** Today a box's membership signing key is a
   `tenant_credentials` row with purpose `membership.node_key` (`apps/server/src/node-identity.ts`),
   and `purpose` is that table's whole primary key, so a database holds one such key. On a spare
   following the main box's copy that row is the **main box's** key — which, with a shared ring, the
   spare could open — and the spare has nowhere to keep its own. So every box's own signing key moves
   to its `node.db` (below), sealed there; the main box's public key reaches the spare in its `nodes`
   row as today. Then **the spare stores the main box's public key** and checks every membership
   document it later acts on against it — the owner's 2026-09-26 decision (A45's first point),
   unbuilt until now.
3. **No fiscal identity is reserved at joining.** Under A679 the spare joins dormant, with no series
   and no hour (§2); its name is chosen when it is switched on (§6.5). This design adds nothing to
   that.
4. **The main box starts streaming to the spare.** A new place starts with a full copy of the
   database (to be measured on 0.5.17 in slice 3b — the backlog has asked for this receipt since
   2026-10-02). The spare's `nodes` row is written by the main box and arrives in the stream, so
   the adoption-pending latch, which today waits for the spare to insert that row itself against a
   `locations` row it never receives, can finally close (`finish-adoption.ts`).
5. **Each box gets its own name, and the chart carries it.** Every box answers a name of its own
   beneath the venue's — `equipo-<first four characters of its node id>.waitron.local`, for
   example `equipo-7f3a.waitron.local` (the builder settles the exact form) — and each box's chart
   row carries that name as its `contactUrl` instead of `https://waitron.local`. That fixes the
   router seeing one server (§2), and lets a till, the switch dialog and the returning box address
   each box on its own. Each box's certificate names its own name as well as the venue's; the
   authority may sign it, because its permitted name `waitron.local` admits any name under it
   ("Any DNS name that can be constructed by simply adding zero or more labels to the left-hand side
   of the name satisfies the name constraint", RFC 5280 §4.2.1.10, read 2026-10-21 with `curl`).
   The venue's name `waitron.local` is answered only by the box that sells — and by the spare's
   switch page while the main box is silent (§6.6). Joining prints a **QR label** for each box
   (§6.6).
6. **If the venue streams to a bucket today**, the main box's one stream moves from the bucket to the
   spare, and the spare's copy-up (§8) carries it on. Joining refuses until copy-up is built rather
   than drop the venue's offsite copy without saying so (anti-goal 3).

None of these steps needs the internet. Joining needs the main box to be up; there is no way to
add a spare to a dead box, and the cold restore from a bucket or an archive stays the path for that
(CLAUDE.md §5, "Re-registering a filing node").

**The spare's own state lives in `node.db`.** The spare's copy of `venue.db` is overwritten,
byte for byte, by every change the main box makes, so nothing the spare needs to remember about
itself can live there. Today joining writes several such rows into `venue.db`: the spare's
`node_roles` mode, its `mirror_config`, its break-glass verifier (`mintBreakGlassKey`,
`apps/server/src/break-glass.ts`), its own `nodes` row at the end of adoption
(`apps/server/src/adopt.ts`, `finish-adoption.ts`), and its signing key (item 2). The break-glass
verifier matters even though the switch no longer asks for it (§6.2): it is the same secret as the
box's recovery sheet key (§6.7), so once the stream overwrites it, the spare's own sheet would stop
matching. Each either
moves to `node.db` or is written by the main box instead (the spare's `nodes` row, by the one
allocator), together with what is new: the follower's position, the pair's access key, the last
time the spare heard from the main box. The topology design reserved `node.db` for exactly this (its §2.1 pointer of 2026-09-25:
"`node.db` stays empty, reserved for slice 5's mirror box"). Its first tables are this design's one
migration (slice 3a), classified `local`.

## 5. While both are up

The spare runs in a **waiting** start mode. It holds its S3 store, follows it, copies up, answers its
own health and status pages, and serves the take-over. It does not sell, file, print or open a
drawer, and it does not mount the trading routes: the copy it follows is not its own to write.

**Freshness is measured, not assumed.** The spare reports how far its copy is behind (the last change
applied, against the main box's last change in the store), and the main box reports when the spare
last took a change. Two new alerts, by the existing alert machinery (`apps/server/src/alert-sources.ts`;
names to be settled against their siblings by the builder):

- **the spare is behind** — more than a minute behind while the main box is writing;
- **the spare is not answering** — the main box cannot reach the store for two minutes. The main box
  then streams to the bucket directly if the venue has one (topology §4.4, "Box B dies"; a retarget
  opens a new generation), and warns that the venue has one copy again if it does not.

They show on the bell and on the Box status page that A798 designs (A798 §4.3), as a "Spare box"
row. Staff see nothing while the spare is merely behind; what staff need is in §6.

## 6. Switching to the spare

### 6.1 What staff see

A till or handheld that loses the main box for **20 seconds** shows a red strip in the style of
A798's (A798 §4.2), worded for this case. It is new device-side work: A798's strip carries notices
the box sends, and a device that cannot reach the box shows only its own "unreachable" line today.
The wording: «El equipo principal no responde». A manager — anyone holding `node.promote`, the permission the existing promote route already checks
(`packages/identity/src/permissions.ts`, `apps/server/src/promote-api.ts`) — sees one more thing in
it: «Cambiar al equipo de reserva». Mock-up 1. A device that has reloaded its page, or was the
main box's own screen, reaches the same switch by §6.6.

The spare box also shows a banner on its own status page and on any screen attached to it.

### 6.2 What the manager does

Mock-up 2. One dialog, the same on a till, a handheld or the dashboard. It asks for three things
and nothing else:

1. **"The main box is switched off."** The dialog says to unplug it — not "it seems dead". This is
   the decommission-then-promote rule (owner, 2026-09-17; topology §5.2) and W41s's "old machine is
   offline" confirmation in one line, beside W41s's second, "no other recovery is in progress"
   (`noParallelRecovery` on the promote route). The first is the venue's real defence against two
   boxes selling at once; nothing in software can prove a partitioned box is off.
2. **The clock check.** The till's browser is the second clock A679 compares with the box's, and an
   AEAT or already configured Waitron origin the third when the internet is up; a disagreement over
   120 seconds is shown, with «Comprobar otra vez» and an explicit confirmation, exactly as at
   setup. The spare then names its series with the hour and the minute (§6.5).
3. **The manager's own sign-in: their passkey, or their password plus their authenticator code
   when they have one enrolled** (owner, question 2: "I think we ask for the passkey or password
   (+authenticator code if configured)"). It is the dashboard's sign-in: a passkey with the
   person's fingerprint, face or PIN on the key (§2), or the password, followed by the code only
   for a person who has an authenticator enrolled (`manager-login.ts:105-107`; the dashboard asks
   for the code only after the box answers `totp.required`,
   `apps/dashboard/src/screens/login-screen.ts:672-673`). The same is asked on a till: the owner,
   "we should ask for the same info on the till". A till PIN is not enough (question 2's other
   option, not chosen). Where a passkey works and where it does not is §6.6.

**What the dialog does not ask** (owner, question 2: "I'm thinking we don't ask for the recovery
key, we wouldn't if the user were starting failover on cloud"):

- **The recovery sheet's installation code.** On a switch the spare's followed copy already holds
  every installation code and series the venue has used (§3), so the typed code would add no
  floor the copy does not (the original design called it "a confirmation more than a floor"). The
  promotion's hour selection stops requiring `installationCodes` and reads the copy's history
  instead — a fiscal change, in slice 4a. A recovery from a backup still asks for the code (§6.7).
- **The emergency (break-glass) key.** The switch dialog never sends it. The existing route keeps
  its break-glass path (`promote-api.ts:147-150`), untouched by this design, for the operator
  procedures that use it today.
- **A679's setup question "Has anyone set up a Waitron box for this business in the last hour?"**
  **My call**: a promotion's name carries the minute and can never equal any setup's, restore's or
  re-registration's (§6.5), so the question would protect nothing those cannot already collide
  with, and a manager at 21:40 could not answer it for the taxpayer's other venues anyway. The
  promotion's hour selection stops requiring an `answer` (slice 4a).

**How this meets W41s's "fresh administrator re-authentication".** It is still a fresh sign-in, by
a person holding `node.promote`, made at the switch for the switch: the box checks it on the spot,
grants nothing else with it, and ends the session it opened, as the route does today
(`promote-api.ts:171`). A passkey sign-in always requires unlocking the key (§2), so it proves the
person at least as well as a password and code. A password with no authenticator enrolled is the
weakest proof the switch accepts — the same the dashboard's sign-in accepts today; no rule in the
tree forces anyone to enrol an authenticator (searched for one by the research for this
revision). What W41s-4's text does not say is which credential; the owner's answer settles it.

**The cost:** every shift needs someone holding `node.promote` who can sign in at the venue — with
a password they know, or a passkey that works offline (§6.6). The owner cannot switch the venue
from outside it; a Cloud-side switch is §10's.

**No case makes the venue wait an hour.** The original design named one: a second switch inside
the same UTC hour had no later hour to take, and showed A679's countdown, up to 60 minutes, with no
box selling. The owner ruled it out ("we can't wait one hour"). §6.5 replaces it: a switch never
waits for the hour; two switches inside the **same minute** wait for the next minute.

**Before the dialog opens, the spare and the till both try the main box,** each at the main box's
own name (§4, item 5). If either can still reach it, the switch is refused with "the main box is
still answering", and the dialog offers the **hand-over** instead (§6.4). This catches the most
common false alarm — the main box is fine and one till's cable is out — without asking anybody to
judge it.

### 6.3 What the spare does

In this order, each step refusing cleanly before the next (the existing promotion's discipline):

1. **Stops following**, applies what its store already holds, runs `PRAGMA integrity_check` and the
   chain verifier over the tail of each chain (topology §5.1, step 1). Only now does it check the
   manager's sign-in, against the person rows and passkey rows of the copy it has just stopped
   writing: while following, Litestream is writing that file, so the spare does not read it as a
   live database. (A passkey's challenge is issued before this step, but it needs no database read:
   the box's passkey sign-in asks for any key the person holds, `passkey.ts:228-231`.) Stopping is
   reversible — a refused check resumes following — so nothing irreversible happens before the
   person is known.
2. **Promotes** through `promoteMirrorToPrimary`: the hour-and-minute name (§6.5) and the module
   activation seat switch on a fresh identity, the series checks run, membership term *n+1* is
   signed and checked against the stored main-box key (§4, item 2), and the role flips — one
   transaction, the point of no return.
3. **Restarts** into the trading start mode, resets every in-flight AEAT claim it inherited
   (`resetInFlightClaims`, already built), and starts filing — its own new chain, and the old main
   box's records that reached it.
4. **Devices find it.** An open till needs nothing new beyond §4's own names: the chart lists the
   spare at its own name, and within about 5 seconds of the spare accepting sales the till's router
   moves to it (§2), signing the person out and dropping any unsaved basket — so staff sign in again
   and re-add what they had not saved. A till that reloads asks for the venue's name; the spare,
   which while waiting answered it only with its switch page (§6.6), now answers it as the main
   box (`waitron.local`, or the owner's own name once A917 lands), with a certificate it issues from
   the venue's authority, whose key the bundle now carries (§4). The same-site cookie receipt the
   backlog still owes from #257 is part of this slice.
5. **Opens a new generation** — to the owner's bucket if there is one, otherwise none, with the
   "one copy" warning — until a new spare joins.

**What survives:** everything that reached the spare — open tables, held orders, kitchen tickets,
device enrolments and sessions (they are rows of `venue.db`, stored as hashes; CLAUDE.md §3,
"Anything that works as a live login is stored as a hash"). So staff sign back in with their PIN and
carry on. **What does not:** whatever the main box wrote in its last second or so and never
streamed. A sale in that window was printed and paid; its record is on the dead main box's disk, and
it is handed over when that box returns (§7). A table opened in that window is gone, and staff
re-open it. A card payment in flight when the main box died is the open "provider cancellation
ownership" question (A764), which this design does not settle and the switch slice must.

### 6.4 The hand-over: when the main box still answers

A main box that is up but failing — disk filling, a broken printer port, the owner wanting to swap
the hardware — can **hand over** without losing a second. The spare asks the main box to stop: the
main box fences itself — it stops selling, starts no new filing pass, **and waits for the answer to
any submission already sent**, up to the drain's own request deadline — then runs a last sync and
reports its last change; the spare waits until its copy holds exactly that change, then promotes as
in §6.3, under the same hour-and-minute name (§6.5). A submission still unanswered at the deadline
goes across as `enviando` and is settled as in §7.1. No fiscal step is skipped and the manager still
signs in (§6.2), but nobody unplugs anything. This is
the topology design's "if the old primary is reachable, ask it to fence and flush" (§5.1, step 1),
and on a LAN it is cheap.

### 6.5 The switch's series: the hour and the minute

**What A679 decided, and the rules it rests on.** The owner approved A679 on 2026-10-16 at 14:50
([design](2026-10-16-a679-hour-coded-series-design.md), line 3). Its naming:

- "The suffix is the integer number of elapsed UTC hours, encoded most-significant digit first in
  exactly four Crockford base32 symbols" (line 39), from the epoch 1 January 2026 00:00 UTC
  (line 37; in code, `packages/fiscal-verifactu/src/hour-identity.ts:3-6`, and a code is exactly
  four symbols, `:31-33`). "No `S`, `P`, `C` or `E` namespace prefix is added" (line 43). "There is
  no longer-code alternative" (line 31). "Never wrap, truncate, lengthen the code or silently change
  the epoch" (line 64).
- The installation number AEAT receives (`NumeroInstalacion`) is that same four-symbol value
  (line 66).
- "Require a **strictly later hour** for a new activation. Do not pretend a future known hour is
  today by calculating `maximum + 1`" (line 131); "Promotion selects its hour when activation
  occurs" (line 149).
- One prefix per purpose, combined with the code: "`A`, `FF` and `R` with `06RC` become `A-06RC`,
  `FF-06RC` and `R-06RC`, each starting at one" (lines 353-355); in code a series is the prefix, a
  hyphen and the installation code, with prefixes of up to 21 characters from
  `[A-Za-z0-9/_.-]` (`packages/fiscal-verifactu/src/allocation-identity.ts:65-72`).

The outside rules A679 cites (its evidence table, lines 223-237), which this section relies on:
invoice numbering "dentro de cada serie será correlativa" (RD 1619/2012, art. 6.1(a)) — consecutive
within each series, with no rule on how a series is named; AEAT's combined series-and-number field
is 1–60 characters of printable ASCII (`TextoIDFacturaType`; Validaciones v1.2.2 §3.1.3.1, p.8), and
Waitron's own check is narrower, `A-Z a-z 0-9 / _ . -` (`verifactu` repository,
`src/validate.ts:586-590`, at `2dc7609`); and the installation number "no puede repetirse nunca"
across the taxpayer's installations (AEAT developer FAQ v1.3, §4, pp.9–10), where AEAT recommends a
timestamp "(al menos fecha+hora+minuto+segundo)". The installation number is free text of up to
100 characters (`NumeroInstalacion`, `TextMax100Type`, in AEAT's `SuministroInformacion.xsd`; the
`verifactu` repository's copy, `schemas/SuministroInformacion.xsd:238` and `:581-585`).

**The owner's change (2026-10-21):** "For the failover we can't wait one hour. We need to have an
emergency suffix or prefix to enable going live immediately." For promotions only, this replaces
A679's "no longer-code alternative" and "never lengthen the code". Setup, restores and
re-registration keep A679 exactly as approved, waits included.

**The shape.** Every promotion — a switch (§6.2) or a hand-over (§6.4) — names its installation
**`<hour>-<minute>`**: A679's four-symbol code for the current UTC hour, a hyphen, and the current
UTC minute as two digits, `00` to `59`. Its series are each configured prefix, a hyphen and that
code, starting at one:

| | Setup, restore, re-registration (A679, unchanged) | Promotion (this design) |
| --- | --- | --- |
| Installation number | `06RB` | `06XV-40` |
| Series | `A-06RB`, `FF-06RB`, `R-06RB` | `A-06XV-40`, `FF-06XV-40`, `R-06XV-40` |
| First receipt | `A-06RB/1` | `A-06XV-40/1` |

It is a **suffix**, not a prefix: the hour stays where A679 put it, so every name still reads
oldest-first and sorts by hour. The minute is the box's own clock's, read once A679's clock
comparison has passed or been confirmed (§6.2, item 2). The hour part keeps A679's rule for a clock
reading near an hour boundary (A679 line 122: wait until the readings fall inside one hour, a wait
about as long as the clocks disagree, a couple of minutes at most under the 120-second check). The
minute does not get such a rule — a minute cannot hold a 120-second disagreement — and does not need
one: what keeps a promotion's minute apart from every earlier one this venue made is the history
check below, not the clocks.

**Why every promotion, and not only a second one in the same hour.** **My call**, for three
reasons. A setup, restore or re-registration, at this venue or any other of the taxpayer's, only
ever makes a four-symbol name, which can never equal a promotion's (below) — so the one
coordination case A679 discloses for a promotion ("Within one hour, independent boxes calculate the
same suffix", line 74) shrinks to two of the taxpayer's venues switching in the same minute. It
lets the switch drop A679's "anyone set up a box in the last hour?" question (§6.2), which a
manager at 21:40 cannot answer for other venues. And it is one rule rather than two. The cost is
three more characters in a promoted box's names.

**The history check.** Before it records the name, the promoting box reads every installation code
it knows of, in both forms — its followed copy holds every SIF and series row of every box that has
sold for this venue, the old main box's and every earlier promotion's — and:

1. **Refuses a known code naming a later hour than now** — A679's future-clock refusal
   (`hour_not_later`, `hour-selection.ts:464-471`), unchanged.
2. **Waits while a known promotion code in this same hour has a minute equal to or later than
   now's**, until the box's clock passes it — normally under a minute, since it takes two switches
   inside one minute; longer only if an earlier box's clock ran ahead, and by as much as it ran
   ahead. It never takes "the last minute plus one" instead: that is A679's `maximum + 1`, refused
   for the same reason (line 131) — a name taken ahead of the clock is one another box could take
   from its clock.
3. **Does not wait for a four-symbol code in the same hour** — a box set up at 21:05 does not stop
   a switch at 21:40, because the two names differ.

Then, as A679 requires for every activation, it records the chosen code as spent **before**
activating (A679 line 134), so an interrupted promotion never reuses it.

**Why it can never collide with or reuse a name already issued.**

- **Against every four-symbol name, anywhere, ever** (setups, restores, re-registrations, at any of
  the taxpayer's venues): a four-symbol series ends with a hyphen and four symbols, so its fifth
  character from the end is a hyphen; a promotion's series ends `-HHHH-MM`, so its fifth character
  from the end is the hour's third symbol, and the hour alphabet has no hyphen
  (`hour-identity.ts:6`). The two strings differ for every prefix, including prefixes that contain
  a hyphen or a slash, which are allowed (`allocation-identity.ts:68`). The installation numbers
  differ in length, four characters against seven, and the retired seven-character form below has
  no hyphen.
- **Against the retired paper and emergency forms** (`S000001`, `E` and 26 symbols;
  `allocation-identity.ts:1-7`): their series end in seven or more characters with no hyphen, so
  the third character from the end is never a hyphen; a promotion's always is.
- **Against an earlier promotion at this venue**: rule 2 above — a later minute in the same hour, or
  a later hour. A box can only be promoted while it is a following spare (a fenced or returning box
  first becomes the spare, §7.2), so it has followed the box that sold most recently, including
  that box's own promotion row.
- **A third switch**: the same rule, knowing both earlier codes.
- **The returning box**: it never issues on its old series again — it is fenced (§7), then its own
  database is archived and replaced by the copy it follows (§7.2). If it is promoted later, the
  activation retires its old series rows (`allocation.ts:452-455`, its own rows only) and it takes
  a new hour-and-minute name under the same check.
- **Within a series**, numbers run from one with no gaps, as before: nothing about numbering inside
  a series changes.

**What it does not prevent** (disclosed, as A679's own table does, lines 76-88): two of the same
taxpayer's venues switching in the same UTC minute with the same prefixes; a clock wrong by more
than the comparison catches; an old box or a cloned disk that keeps selling on its old series
without entering any of this (the fence is what stops that, §7).

**Limits of the format.** At most sixty promotions an hour, one a minute; the hour part's range is
A679's (it ends in 2145). The longest combined number is 21 (prefix) + 1 + 4 + 1 + 2 + 1 (`/`) + 10
(the counter) = 40 characters, within AEAT's 60; the installation number is 7 characters, within
its 100. The characters the promotion form adds are digits, capital letters and a hyphen, inside both
AEAT's and Waitron's sets.

**What AEAT and the chain see.** The promoted box's first record carries a new installation number
(`06XV-40`) in its software block and starts a new chain — activation empties the box's chain head
(`allocation.ts:445-451`), so its first record is marked as the first of its chain
(`PrimerRegistro = "S"`, `packages/fiscal-verifactu/src/chain.ts:148-151`). Its receipts are
`A-06XV-40/1`, `/2` and on. The old main box's series stops at its last number; that box's
last-second records arrive with the tail (§7) and are filed under its own installation number and
its own chain, by whichever box is filing (the drain files every SIF in the database, §2). Nothing
is renumbered.

**What else changes with it** (all in slice 4a, fiscal): the hour-selection code learns the second
form (today a code is exactly four symbols, `hour-identity.ts:31-33`, and the greatest spent hour is
read from four-symbol codes); the promotion path stops requiring `answer` and `installationCodes`
(`hosted-hour-recovery.ts:79-86`); and the recovery form and its code parser
(`reported-hour-codes.ts`) accept a seven-character code, because a promoted box's recovery sheet
prints "this node's current installation code" (A679 line 399), which is now `06XV-40`. After a
switch, the Servers screen asks a manager to print the new main box's sheet.

**Worked example** — Friday 23 October 2026, Bar Santet, Madrid summer time (UTC+2 until the 25th).
The main box, «Equipo de la barra», was set up on 16 October as `06RB`. Mock-up 6.

| Madrid time | What happens | Name |
| --- | --- | --- |
| 21:39:40 | The barra box's power supply trips. | — |
| 21:40:00 | Every till shows the red strip (20 s). | — |
| 21:40:50 | Marta, the manager on shift, taps «Cambiar» at the terrace till, ticks "unplugged", signs in with her password and the code on her phone. The trastienda box (spare) picks hour `06XV` (19:00 UTC), minute 40. | `06XV-40` |
| 21:41:30 | The trastienda box sells: first receipt `A-06XV-40/1`. Open tables are all there. | `A-06XV-40` |
| 21:47 | Someone finds the barra box's plug knocked out and plugs it back in. It learns it was replaced, hands over its three last-second sales, passes the three checks of §7.2, archives its database, wipes itself and starts following the trastienda box as the spare. | — |
| 21:55:10 | The trastienda box's disk fails. | — |
| 21:55:50 | Marta switches again, at the bar till. The barra box (now the spare) knows `06RB` and `06XV-40`; it is 19:55 UTC — the same hour, a later minute. **Under A679 as approved it would wait until 22:00** (four minutes here; a first switch at 21:05 would have meant 55). | `06XV-55` |
| 21:56:30 | The barra box sells again: `A-06XV-55/1`. Its old `A-06RB` series is retired by that activation. | `A-06XV-55` |
| (if) 21:55:58 | Had a third switch come inside minute 55, it would wait until 21:56:00 and take `06XV-56`. | `06XV-56` |

AEAT ends the evening with three installation numbers for this venue — `06RB`, `06XV-40`, `06XV-55`
— each with its own chain, every number in every series consecutive, none repeated. The trastienda
box's own last-second sales reach AEAT when it is repaired and hands them over.

### 6.6 Reaching the switch from any device

**The gap.** The counter till is often the main box's own screen, and dies with it (§9). A till or
handheld still showing the main box's page can switch — §6.1's strip is drawn by the page itself.
But a device that **reloads** asks for `https://waitron.local`, which nobody answers once the main
box is dead, and in the original design the spare answered that name only after promotion — so a
reloaded device had nowhere to go. The till registers no offline copy of its page that would
survive a reload (a search of `apps/till/src` for `serviceWorker` finds only the trust check,
`apps/till/src/trust-check.ts`, which probes for a script no box serves).

**The design: three ways in, one page.** The spare serves its **switch page** — the dialog of §6.2,
the spare's status, nothing that sells — and any device reaches it:

1. **At the venue's own name.** While the main box is silent, the spare answers `waitron.local`,
   but serves only its switch page there. "Silent" means the spare has failed to reach the main box
   at its own name (§4, item 5) for the strip's 20 seconds; the moment the main box answers again,
   the spare stops answering the venue's name. So a reloaded till or handheld lands on the switch
   page at the address it always uses — where passkeys work unchanged (below). The original design
   already required that a waiting spare not answer the venue's name otherwise; today's responder
   does it with no role check (§2), and its answer lasts 120 seconds in a device's cache
   (`MDNS_TTL_SECONDS`, `apps/server/src/mdns.ts:45`), so a device that looked the name up just
   before the main box died may need up to that long to find the spare — **not measured**; slice
   4d measures it on the till hardware and shortens the lifetime if needed. Partitions are covered
   by what already exists: if a device or the spare can still reach the main box, the switch is
   refused and the hand-over offered (§6.2).
2. **At the box's own name, from a QR label.** Each box carries a label printed at joining (§4,
   item 5): a QR code and, beneath it, the address in text — `https://equipo-7f3a.waitron.local/cambiar`
   — and the words «Si el equipo principal falla, escanea esto desde cualquier caja o móvil del
   local». Both boxes get one, because either can be the spare. Mock-up 7.
3. **On the spare's own screen**, if one is plugged in (B3 asks whether a box's screen is also a
   till): it shows the switch page.

**Trap (a): a passkey works only under the name it was registered for.** The box registers every
passkey for `waitron.local` (§2). A browser lets a page use that passkey only when its address is
`waitron.local` itself or a name beneath it — so the page at the venue's name (way 1) and at a
box's own name `equipo-7f3a.waitron.local` (way 2) can use it, and a page at the box's raw IP
address cannot. Measured 2026-10-21 in Playwright's Chromium 156 with a virtual authenticator (a
software passkey): a passkey created at `https://waitron.local` signed in at
`https://equipo-7f3a.waitron.local` with the relying party `waitron.local`, its signed data naming
the subdomain as the origin. Three controls failed as they should: the same page asking for its own
name as relying party found no passkey; `https://127.0.0.1` was refused ("This is an invalid
domain"); and `https://reserva-waitron.local`, a sibling name rather than one beneath, was refused
("not a registrable domain suffix of, nor equal to the current domain"). Not measured: Safari,
Firefox, Android's own passkey handling, a real phone or security key. The box must also accept the
sign-in: the server library takes a list of allowed origins (`expectedOrigin: string | string[]`,
`@simplewebauthn/server` 14.0.3, `verifyAuthenticationResponse.d.ts:25`), so each box checks
passkeys against `https://waitron.local` and both boxes' own names, keeping `waitron.local` as the
one relying party (slice 4d). Whether every till's browser resolves a two-part `.local` name such as
`equipo-7f3a.waitron.local`: macOS 26.6 did (a name advertised with `dns-sd -P` resolved with
`dscacheutil`; a name never advertised returned nothing); Android, ChromeOS and Windows are **not
measured** — slice 4d measures them on the till hardware, and where one cannot, way 1 still works
and way 2 falls back to a password.

**Trap (b): a phone's passkey used at a till needs the internet.** When the passkey is on the
manager's phone and the sign-in happens on a till, the browser shows a QR code, the phone scans it,
and the two meet through the "hybrid" route. The FIDO specification describes it: "It involves both
network communication via a service called a tunnel service, and BLE transmissions to show
proximity. A tunnel service is a high-availability network service with a domain name known to the
authenticators that use it" (CTAP 2.2, §11.5, the 14 July 2025 edition, read 2026-10-21 with
`curl`); the two devices reach it over WebSockets. So it needs the internet and Bluetooth on both
devices. That is read from the specification, **not measured** with the internet unplugged.

**What works with no internet:**

| Proof at the switch | Internet down? |
| --- | --- |
| Password, plus the authenticator code if enrolled — the code is made on the phone with no network, and checked against the box's clock | Works |
| A passkey kept on the device doing the switch (the handheld or till itself) | Works, at way 1 or 2 |
| A passkey on a security key plugged into, or tapped on, the till | Works, at way 1 or 2 |
| A passkey on the manager's phone, used at a till by scanning its QR code | **Fails** — needs the tunnel service and Bluetooth |
| The manager's phone opening the switch page itself, from the QR label, with the passkey on that phone | Works, if the phone is on the venue's Wi-Fi (way 2, or way 1) |

So the dialog always shows «Usar mi contraseña» beside «Usar mi llave de acceso», and the
setup of a venue with two boxes tells each manager to know their password (or hold a passkey that
lives on a device in the venue). The last row is the quickest path in practice: the manager scans
the label with their own phone, on the venue's Wi-Fi, and switches there with their phone's passkey.

### 6.7 What the recovery sheet is still for

The owner asked: "Do we need the recovery key for anything?" The answer the watcher gave — a cold
restore needs the sheet's installation code and the node key; password recovery and break-glass are
for when nobody can sign in — is **half right**. Checked in the tree on 2026-10-21:

- **Confirmed, with corrections: restoring a box that files from a backup.** A cold restore, or a
  rebuild from the bucket, of a box that files with Veri\*Factu needs the recovery operation and the
  node recovery key printed on the sheet (`apps/server/src/restore-command.ts:281-286`; a box that
  files cannot skip it, `packages/fiscal-verifactu/src/allocated-lifecycle.ts:15-16`; CLAUDE.md §5,
  "Re-registering a filing node"). The key must be the sheet that was current when that backup was
  made. The installation code on the sheet raises the "hour must be later than this" floor; it is
  not a secret and authenticates nothing (`hosted-hour-recovery.ts:79-86`). A restore also always
  needs the backup itself and its own backup recovery key or Cloud login, which are not on the
  sheet (`restore-command.ts:106-109`). A box that never filed restores with the backup alone
  (`allocated-lifecycle.ts:53-56`).
- **Also: re-registering a node, and downloading the node recovery pack**, which accept only the
  sheet's key (`apps/server/src/operation-authentication.ts:57`, `recovery-pack-api.ts`).
- **Corrected: the sheet plays no part in getting back in when nobody can sign in.** A679 says so:
  the sheet "does not itself create a management session or reset a password"
  (A679 line 215). A forgotten password is reset by email (`POST /management-api/password-reset`,
  `apps/server/src/management-api.ts:907`); an administrator locked out of everything is reset from
  a shell on the box by `waitron-break-glass`, which needs no key
  (`apps/server/src/break-glass-command.ts:32-34`). The "break-glass code" setup shows is the
  sheet's key under another name (both write one verifier, `apps/server/src/break-glass.ts`), and
  today it can also promote a standby instead of a manager's sign-in (`promote-api.ts:147-150`) —
  the switch dialog no longer offers that (§6.2).
- **If the sheet and the password are both lost**, the owner's A732 answer is to reinstall the box
  and start again (quoted in the B3 design, `2026-10-21-b3-usb-installer-design.md:38-41`).

So for this design: the switch needs no sheet; a restore onto a box with no copy still does.

## 7. When the old main box comes back

Mock-up 4. The old main box powers on still believing it is the main box. Two things must happen
before it can do any harm, and **both are structural, not a runbook step:**

1. **It learns it was replaced before its first filing pass and before it serves a till.** At start it
   asks the spare (on the LAN, at the spare's own name) for the newest membership document — the
   boot reconciliation already does this for a configured peer and starts a fenced box as a
   secondary behind the read-only gate (§2). What is new is making the spare that configured peer
   at joining, and a till that reaches the box carrying a newer signed document handing it over
   (`persistNodeMembershipIfNewer`).
2. **A fenced box neither sells nor files.** Filing already needs `singleton_role = primary`, and a
   fenced box does not accept sales (§2). It does not answer the venue's name either (§4, item 5).
   Promotion marks the old main box `sell-only`, a standing
   `routableServers` still lists (`packages/membership/src/standings.ts`, `fence.ts`), so tills keep
   probing it — harmlessly, since it answers `acceptingSales: false` — until it rejoins. What is open is the order: the backlog records that "on
   the first boot after returning, a node runs as its stale-held-doc primary until the
   reconciliation restarts it; restart-based fencing leaves a one-tick window for one more fiscal
   pass on the superseded chain" (residuals, "Carry-ins"). Slice 5a closes it by deciding the role
   before the first filing pass, and when the spare cannot be reached at all the box waits rather
   than files: a box that has a spare and cannot find it does not assume it is still the main box.
   That last rule is **my call**; it trades a slower return for never filing on a chain that may
   have been superseded. It changes Ruling C7 for a box that has a spare — today an unreachable peer
   means "proceed" (`apps/server/src/membership-reconcile.ts`) — and the topology design's "proceed
   as primary" (§5.2). After a venue-wide power cut the main box may start first; it waits the
   minute or two until the spare answers, then carries on as the main box. Because it would otherwise stop a venue whose spare has died,
   the waiting box offers a manager «Seguir sin el equipo de reserva», with the same
   sign-in as the switch (§6.2) and the same "the other box is switched off" confirmation.

Then it **hands over its tail** — the rows it wrote that the spare never saw — and becomes the new
spare by itself once three checks pass (§7.2). The owner's 2026-09-24 decision, "a cut-off primary keeps streaming, into its own copy", with
the tail taken from that copy, was written for a box that is cut off but still running
(`docs/backlog/replication-cloud.md`, residuals). On a LAN the switch's first step is unplugging
that box, so on return its own `venue.db` *is* that copy, read directly, and nothing extra streams.
If the unplugging was skipped and the box kept running cut off from the spare, it has no store to
stream into; its database still holds everything, which is what the decision protects. In the Cloud
topologies the decision applies as written.

### 7.1 The tail, and the fix for the failed prototype scenario

The topology design's tail shipper (§5.2) stands: one direction, once per return, `ledger` tables
only, rows keyed by the sender's node, parents before children, applied in one transaction. The
prototype's scenario S2 **failed** against it
([results](../../research/2026-09-16-sqlite-failover-prototype.md), "S2 — no second tax-agency
filing"): two shapes in its recorded run, and a third the review seat ran as a variant, which "is
**not part of S2's recorded run**". Each comes from **the sender filing after its batch was cut,
or its news not travelling**:

| Shape that filed a sale twice | Why | What removes it here |
| --- | --- | --- |
| A batch recomputed against a refreshed view of the receiver | The sender left out what the receiver already had, so the news that the sender had since FILED one of them never travelled | The batch carries the sender's **current state of every `envios`, `acks` and `envio_flujo` row it owns**, not only the rows the receiver lacks. Terminal-state-wins applies both ways (topology §5.2) |
| A batch taken while the sender was part-way through filing | A row was mid-filing when the batch was cut | The sender is **fenced before the batch is built** (§7, item 2), and a fence waits for answers already due (§6.4), so it starts no filing and has none in progress. What fencing cannot settle is a submission cut off by the power going: that row is `enviando` on the sender. The batch builder returns it to `pendiente` in the batch, as the restart reset (`resetInFlightClaims`) does at start, so the receiver files it and AEAT's duplicate handling settles it (below) without waiting out the five-minute recovery (`recoverStaleClaims`) |
| An unchanged earlier batch replayed after the sender filed (the variant) | The sender filed after the batch was cut | A fenced sender files nothing after it is fenced, so its state is **frozen**: every batch it can build is the same batch, and a replay applies nothing new |

The receiver also pauses filing for the sender's chains while a batch applies, as the topology
design already requires. The drain's per-chain block (`blockedSifIds`,
`packages/fiscal-verifactu/src/drain.ts`) is today built inside one pass from that pass's own
refusals, so the builder gives it an outside input; it is not a switch that exists yet.

**When two finished states disagree** — the receiver holds a record as refused while the sender
holds it as accepted, say — neither side wins: the apply opens a W41s filing case
(`packages/fiscal-verifactu/src/filing-cases.ts`) and leaves both facts recorded, because AEAT's
own copy is the only one that settles it.

**The fence makes the database frozen, and the frozen database makes every retry identical.** The
prototype could not show this, because nothing in it fenced a sender ("What this gate does NOT
establish": "Fencing a returning node. No scenario stops a node selling or filing"). So the gate for
the tail-shipper slice is to **re-run S2 with the fence modelled and the full-state batch**, with
the replay variant added to the scenario as a part of its own, and see it PASS — with two controls
that must still FAIL: the fence removed, and the batch cut back to the rows the receiver lacks. The
rig's drain has no five-minute recovery (the results note calls the stuck row "a **model gap**"),
so the re-run models the batch builder's return of `enviando` rows to `pendiente`, or a FAIL would
be the rig's rather than the design's. If S2 does not pass, the tail shipper is not built.

**One case begins at the switch, before any tail exists, and the rig cannot show it.** A record the
main box filed in its last second, after its last sync, reaches the spare still `pendiente`, and
the spare files it again. AEAT refuses the second with error 3000. The drain does not take that as
filed: it asks AEAT what it holds under that identity and counts the record filed only when the
fingerprint and installation match; missing evidence leaves the row waiting, and an original AEAT
holds as annulled is refused with `fiscal.duplicado_anulado` (`handleDuplicate`,
`packages/fiscal-verifactu/src/drain.ts`). So a byte-identical copy is settled as filed once the
spare can reach AEAT, which it needs for filing anyway. The annulled case — the main box filed a
cancellation in its last second too — opens a filing case on the spare; the cancellation itself
arrives with the tail. Both are named for slice 4b's tests, against the drain's real duplicate
handling, since the rig's stand-in for AEAT is not AEAT.

### 7.2 Becoming the new spare, by itself

The owner, question 3: "Can it check the health status of the new primary and then decide whether
to wipe itself automatically?" Yes. Once its tail is handed over, the returning box **wipes itself
and becomes the spare with nobody touching it — but only when all three checks pass**, in this
order, each re-run from the start on a retry:

1. **The new main box holds every handed-over record — count and fingerprint, record by record.**
   Not a "transfer finished" flag. The returning box sends, for every row in its tail, the row's
   table and key and a fingerprint of its content: for an invoice record, its AEAT fingerprint
   (`huella`); for any other `ledger` row, a SHA-256 over the row's columns in a fixed order. The new
   main box reads each row back from its own database, computes the same fingerprint, and answers
   with the count per table and every fingerprint. The check passes only when both counts and every
   fingerprint match. This is the tail receipt the original design required; today `retireSelf` and
   `rejoinAsSecondary` lost the proofs that a box's rows reached the carrier before an irreversible
   step (backlog residuals, "retireSelf and rejoinAsSecondary lost their drain confirmations"), and
   this is that proof.
2. **The new main box is healthy.** All of, read from the new main box's own status, signed by its
   node key:
   - **selling**: `acceptingSales` is true, and its membership term is the one that fenced this box;
   - **filing**: its filing pass has run in the last five minutes, no record is refused, no filing
     case is open, and either AEAT answered it in the last fifteen minutes or nothing is waiting to
     be filed. With the internet down and sales waiting, this part fails — on purpose, since the
     owner's words were "filing to AEAT";
   - **its offsite copy current**: if the venue has a bucket, no `backup.stream_behind`, stopped,
     refused or unusable-settings alert is raised (`apps/server/src/alert-sources.ts`); if the venue
     has no bucket, there is nothing to check, and this box becomes its copy in a moment anyway.
3. **The returning box has archived its own database.** It writes a consistent copy of its own
   `venue.db` (the store's backup, not a file copy of a live database) to a folder on its own disk
   outside the venue folder the wipe empties, reads the copy back, runs `PRAGMA integrity_check` on
   it and compares its invoice-record count with the live file's. Only then does the wipe start.

When all three pass, it wipes its `venue.db`, joins as a fresh spare (dormant, as in §4; its old
SIF and series are never issued on again — if it is ever switched on, activation retires them and
it takes a fresh hour-and-minute name, §6.5), and follows. Its screen and the Servers screen say
so; nobody is asked.

**When a check fails**, the box stops before the wipe, says which check failed and why on its own
screen and on the dashboard's Servers screen, and keeps retrying every minute. A manager may press
«Convertir en equipo de reserva», after the same sign-in as the switch (§6.2), but that **overrides
only check 2** — a new main box that is selling but cannot reach AEAT, say. Checks 1 and 3 protect
records that may exist nowhere else, so while either fails the button is quiet and says why
(**my call**: the owner's words, "waits for a manager", leave which checks a manager may override
open; the conservative reading is that no manager can override the proof that the records arrived,
or the archive).

**The archive copy — what it is for and how long it is kept.** It is the old main box's database
exactly as it stood when the box came back. It is for: (1) a defect in the tail shipper found later
— the rows are still there to hand over again; (2) a filing case AEAT's answers open later about
one of its records — the original row and its chain are there to compare; (3) the new main box
dying before its copy reaches anywhere else. It is kept on that box's disk only — never streamed,
never in a backup, never shipped — for **90 days**, a starting value, then deleted by the box
itself; longer while any open filing case names one of its records, until that case closes. A newer
archive does not delete an older one. It holds what `venue.db` holds — sessions as hashes and
credentials sealed under the shared ring — so it is as sensitive as the database it copies, and it
stays on the box's own disk. The Servers screen lists each archive with its date.

## 8. Offsite copies with two boxes

When the venue has a bucket, the spare copies its store up to it, **mirroring rather than
accumulating** — deletions travel too. The prototype's S3 showed why: an additive copy into a place
holding another node's files restored that other node's ledger, with Litestream exiting 0
(topology §4.4, 2026-09-18). Two rules, both from the topology design: the copy-up writes only
generations the main box opened, and it never moves the bucket's pointer to a lower term than the one
the bucket already names. Restoring from the bucket stays exactly the slice-2 rebuild.

## 9. Placement, the installer, and what a second box costs

**Placement.** One box under the counter driving the counter screen, the other in the back room
(the hardware decisions, §5: "If the venue ever runs a second box this gets better, not worse: one in
the back room, one under the counter, and failover stops needing the internet"). **Both on the UPS
and both wired to the same switch.** A dead switch takes both boxes off the LAN at once, and no
failover covers it — the one single point this design leaves, said here so nobody discovers it.
Each box carries its QR label (§6.6) where a manager can scan it.

**Printers, the drawer and the counter screen.** Anything plugged into the main box by USB dies
with it. Under the hardware decisions' O5 the main box drives the counter screen and, usually, the
receipt printer and its drawer, so when the main box dies the counter till goes with it and the
switch is made from another till, a handheld, a manager's phone through the QR label, or the
spare's own screen (§6.6). The design therefore asks that, in a two-box venue,
the receipt and kitchen printers be on the network, not USB, so either box's print agent reaches
them (the agent already follows whichever box sells, §2; the failover-printing design,
2026-08-26, §3, runs agents on more than one host). A printer that must stay on USB is lost with
its box until it is moved, and the setup should say so when a second box joins.

**The installer (B3).** Both boxes are installed from the same stick, identically. The setup wizard
asks which job the box does — "Set up a new venue" or "Add a spare box to this venue" — so the stick
does not need to know.

**Cost to the venue** (estimates, from the deli hardware design §3, 2026-07-30, which priced the box
at "Local server — fanless mini-PC, 16 GB, NVMe … ~€250 … Estimate"):

- **About €250 for the second box**, the same model as the first — and only where the venue chooses
  a spare (question 4).
- **The UPS may need to be larger**: the deli design sized one ~650 VA unit (~€100, estimate) for
  one box; whether it carries two boxes, the switch and the tills through a power cut is a sizing
  check against the actual hardware, not done here.
- **Possibly a saving**: a box can drive a counter screen (hardware decisions, O5), so a two-counter
  venue's second box can also be its second till, which the hardware decisions price at €300–450
  for a separate machine. Whether a box's screen may serve as a till is B3's question 3; whatever
  B3 settles, a screen on the spare also shows its switch page (§6.6).
- **Running cost**: a fanless mini PC of this class draws 10–15 W (hardware decisions, §6), an
  estimate; no box has been measured.

## 10. After go-live: the Cloud

The same pieces carry over, which is why the spare speaks S3:

- **A Cloud standby** is a spare whose store is the Cloud bucket and whose follower runs in the Cloud
  (topology §4.1). The main box's stream goes to the Cloud instead of to a spare box, or to the spare
  box and on via copy-up.
- **A Cloud-hosted main server from the outset** streams to the Cloud bucket, and an on-site spare
  box follows that bucket (topology §4.2), buffering when the internet is down.
- **The contract with the Cloud side** — for lane D's D88 to agree — is: the venue prefix layout under
  `venues/<venue-id>/`, the generation names and their create-only marker, the signed `current.json`
  pointer and its conditional write, the follower reading a store it does not write, the membership
  document as the one statement of who is main, the promotion's hour-and-minute name (§6.5), which
  takes no names from Cloud ("Take no names from paper or Cloud", A679's restore table), and the
  switch's proof — a manager's own sign-in, no recovery sheet (owner, question 2: "we wouldn't if
  the user were starting failover on cloud").

W41s-10b ("Signed stream witnesses and fencing", lane E) designs a signed witness outside the box.
This design uses the pointer in the spare's store as the main box's outside witness on the LAN, and
adopts W41s-10b's format when it lands rather than inventing one.

## 11. Build order: slices 3–5, as pull requests

Each line is one pull request. **Fiscal** ones wait for the owner to land (lanes land their own
pull requests except truly fiscal ones, owner 2026-10-21). Every slice adds its step to the stream
loop test (`apps/server/src/stream-loop.e2e.test.ts`), which grows into the two-box loop.

**Slice 3 — the spare keeps a copy.**

- **3a. Each box's own state leaves `venue.db`.** `node.db`'s first tables (the one migration);
  every box's signing key, and the spare's mode, mirror settings and break-glass verifier, move
  there (§4, items 2 and the `node.db` paragraph); the bundle's two new secrets; the stored
  main-box key and the three checks it guards. Not fiscal, but it moves the key that signs
  membership documents, so it takes the full review.
- **3b. The spare hosts the store, and joining brings the data.** versitygw in the box image, its
  licence notices, TLS under the venue authority, the pair's access key; each box's own name in its
  chart row and its certificate, and only the selling box answering the venue's name (§4, item 5);
  the main box's stream targets the spare; the first full copy over the LAN, measured on 0.5.17
  with the internet unplugged; the main box writes the spare's `nodes` row and adoption-pending
  closes; joining refuses while the venue streams to a bucket (until 5e). Not fiscal.
- **3c. The spare follows.** The waiting start mode; `restore -f` into the follower copy (follow mode
  exists at the pin, `cmd/litestream/restore.go:39`, but has never been run in this repository —
  measure lag and a byte-identical restore against a direct one); the two alerts; the "Spare box"
  row on the Box status page and the Servers screen (mock-up 3). Not fiscal.

**Slice 4 — switching.**

- **4a. The switch's series: hour and minute.** A679's dormant-promotion preparation, with §6.5's
  name: the seven-character form and its parser, the history check over both forms, the
  same-minute wait, the durable record before activation; the promotion path without `answer` or
  `installationCodes`; the recovery form accepting a promoted box's code. Tests include the
  collision cases of §6.5 (a four-symbol and a promotion series with hyphenated and slashed prefixes,
  a second and a third promotion in one hour and in one minute, a known later hour). **Fiscal — the
  owner lands it.** Built by whichever lane holds A679's remaining work, or here, first.
- **4b. Promotion from a followed copy.** Stop, verify, check the person, `promoteMirrorToPrimary`
  with 4a's name and W41s's activation, the stored-key check, restart, the in-flight reset; tests
  for the spare re-filing an inherited record against the drain's real duplicate handling (§7.1).
  **Fiscal.**
- **4c. Devices follow, and the take-over screens.** The strip, the dialog and its refusals (a till
  or the spare still reaching the main box), the switch's proof — a passkey or a password and, when
  enrolled, a code, on a till as on the dashboard (§6.2) — `node.promote` at the till, the venue name
  and certificate on the spare after promotion, the router's switch, the "print the new sheet"
  prompt, and the card-payment ownership rule A764 asks for. Not fiscal, but it lands after 4b.
- **4d. Reaching the switch from any device.** The spare's switch page; the spare answering the
  venue's name with only that page while the main box is silent, and stopping when it answers; the
  QR labels; passkeys checked against the venue's and both boxes' own origins; measured on the till
  hardware: two-part `.local` names, the name cache after the main box dies, and a passkey at each
  way in (§6.6). Not fiscal.
- **4e. The hand-over.** The main box fences on request, waits for answers already due, syncs, and
  reports its last change; the spare waits for exactly it. **Fiscal** (it fences a filing node).

**Slice 5 — the old main box comes back.**

- **5a. Fenced before the first pass.** The spare is the configured peer; boot decides the role
  before the first filing pass; a box with a spare waits for it rather than proceeding (the change
  to Ruling C7) with the manager's override; a till hands a newer document to a box it reaches.
  **Fiscal.**
- **5b. The prototype re-run.** S2 in `bench/sqlite-failover` with the fence, the full-state
  batch, the replay variant as a part of its own and the `enviando` return modelled, and both
  controls. The gate for 5c: no PASS, no tail shipper. Not fiscal (a rig).
- **5c. The tail shipper.** Sender and receiver, terminal-state-wins both ways, a filing case where
  two finished states disagree, and the per-record receipt (§7.2, check 1). A fresh-context review
  of its own before it is built (topology §5.2, risk 2). **Fiscal.**
- **5d. Becoming the spare by itself.** The three checks of §7.2, the archive and its 90-day expiry,
  the guarded wipe, a fresh dormant spare, the screens for a failed check and the manager's
  override of check 2 only (mock-up 4). **Fiscal** (it wipes a filing node's database).
- **5e. Copy-up.** The spare mirrors its store to the owner's bucket, deletions included, generation
  and pointer rules (§8); joining stops refusing a venue with a bucket. Not fiscal.

**Before the first venue goes live on two boxes:** a rehearsal on two real boxes on one switch —
pull the main box's plug mid-sale, switch from a reloaded handheld, sell, switch back inside the
same hour, power the first box back, watch it hand over and rejoin by itself — with the internet
unplugged throughout. The rigs prove the parts; only the rehearsal proves the venue's evening.

## 12. Questions for the owner — all answered 2026-10-21

Asked one at a time in the campaign's questions file by the watcher, each with a worked example
(`docs/backlog/mockups/a947-two-box-failover/question.txt`, which keeps the questions as asked).

1. **Who switches to the spare: a manager, or the boxes by themselves? Answered: A, a manager, from
   any till** (about 09:25), as recommended: the red strip after 20 s, «Cambiar al equipo de
   reserva», and a refusal with a lossless hand-over when the main box is still up. **Follow-up**
   (about 09:35): "For the failover we can't wait one hour. We need to have an emergency suffix or
   prefix to enable going live immediately." → §6.5, slice 4a.
2. **What proves it is a manager at the switch? Answered** (about 11:35): "The authenticator code
   may not exist. I think we ask for the passkey or password (+authenticator code if configured).
   I'm thinking we don't ask for the recovery key, we wouldn't if the user were starting failover
   on cloud. … Also we should ask for the same info on the till." → §6.2. In the same message:
   the till may die with the main box (→ §6.6) and "Do we need the recovery key for anything?"
   (→ §6.7).
3. **When the old main box comes back, what does it do by itself? Answered** (about 11:40): "Can it
   check the health status of the new primary and then decide whether to wipe itself
   automatically?" → §7.2: by itself, after three checks; a manager only when a check fails.
4. **Is a spare box required for every venue? Answered: A, a choice** (about 11:45), as recommended
   → §4.

**What is left for the owner:** approval of this revision before the build is planned. The calls
marked **my call** in §6.2, §6.5, §6.6 and §7.2 are the ones to look at: every promotion uses the
minute form (not only a second one in an hour); the switch drops A679's "anyone set up a box in the
last hour?" question; the spare answers the venue's name with its switch page while the main box is
silent; a manager may override only the health check; the archive is kept 90 days.

## 13. What this design does not settle, for the builder

- The exact names of the two alerts and the error codes, against their siblings.
- The 20-second strip delay and the one-minute and two-minute alert bounds are starting values, to be
  checked in the rehearsal; so are §7.2's five- and fifteen-minute filing bounds and the archive's
  90 days.
- The exact form of each box's own name and of the QR label's wording (§4, item 5; §6.6).
- Whether the router or the name carries a till across the switch, in each browser (§6.3, item 4).
- Whether every till platform resolves a two-part `.local` name, and how long a device keeps the
  dead main box's address (§6.6; slice 4d measures both).
- The card payment in flight at the moment of the switch (A764).
- Sizing the UPS for two boxes.

## Provenance

| Claim | Source | How established |
| --- | --- | --- |
| The owner's go-live words | owner, watcher session 2026-10-21 ~08:25 | quoted in queue item A947 |
| The owner's four answers and their follow-ups | owner, watcher session 2026-10-21 ~09:25–11:45 | quoted from the campaign's questions file |
| Litestream 0.5.17 refuses a second replica | `cmd/litestream/main.go:794-795` at tag v0.5.17 | `curl` of the raw file, 2026-10-21 |
| Follow mode exists at the pin | `cmd/litestream/restore.go:39` at tag v0.5.17 (`fs.BoolVar(&opt.Follow, "f", …)`) | `curl` of the raw file, 2026-10-21; never run in this repository |
| versitygw is Apache-2.0 and maintained | GitHub API `repos/versity/versitygw` | `curl`, 2026-10-21 |
| The conditional write holds on versitygw 1.8.0 | `apps/server/src/stream-loop.e2e.test.ts`; results note, "Standing obligations" | read |
| The bundle carries the authority's public certificate only, no series under hour codes, and no data | `apps/server/src/mirror-bundle.ts` (`readFile(caCertPath(…))`, the `on-activation` refusal), `finish-adoption.ts` | read 2026-10-21 |
| A box's signing key is a `tenant_credentials` row, one per database | `apps/server/src/node-identity.ts` (`membership.node_key`); the table's primary key is `purpose` | read by the fresh-context review, 2026-10-21 |
| Credentials are sealed under a key from each box's own environment | `packages/credentials/src/keyring.ts` | read 2026-10-21 |
| Dormant until take-over, with re-authentication and the offline confirmations | W41s-4 decision A, owner 2026-10-12 | `docs/superpowers/plans/2026-10-12-w41s4-standby-activation-decision.md:39-41` |
| No register; promotion selects its hour; strictly later; four symbols, never lengthened; one typed installation code for a recovery; 120-second clock check; promotion's preparation still open | A679, owner-approved 2026-10-16; PDF decisions of 2026-10-19 | `docs/superpowers/specs/2026-10-16-a679-hour-coded-series-design.md` lines 3, 31, 37-43, 64-66, 122, 131-134, 149, 353-355, 399 |
| The hour code is exactly four symbols; a selected hour at or below the greatest spent hour refuses; the wait runs to the next hour | `packages/fiscal-verifactu/src/hour-identity.ts:3-6,31-33`; `hour-selection.ts:464-471,498` | read 2026-10-21 |
| A series is prefix, hyphen, installation code; prefixes up to 21 characters of `[A-Za-z0-9/_.-]`; the retired forms | `packages/fiscal-verifactu/src/allocation-identity.ts:1-7,65-72` | read 2026-10-21 |
| A promotion's hour selection takes an `answer` and a non-empty `installationCodes` list | `packages/fiscal-verifactu/src/hosted-hour-recovery.ts:79-86`; `reported-hour-codes.ts:7` | read 2026-10-21 |
| Activation revokes the box's SIF, inserts a new one, empties its chain head, retires and inserts series — its own rows only | `packages/fiscal-verifactu/src/allocation.ts:434-460` | read 2026-10-21 |
| A chain's first record carries `PrimerRegistro = "S"` | `packages/fiscal-verifactu/src/chain.ts:148-151` | read 2026-10-21 |
| `NumeroInstalacion` is free text up to 100 characters; Waitron's series check is 1–60 of `A-Z a-z 0-9 / _ . -` | `verifactu` repository at `2dc7609`: `schemas/SuministroInformacion.xsd:238,581-585` (its copy of AEAT's XSD); `src/validate.ts:586-590` | read 2026-10-21 |
| Consecutive numbering within each series; installation number never repeated; AEAT's series field | RD 1619/2012 art. 6.1(a); AEAT FAQ v1.3 §4 pp.9–10; Validaciones v1.2.2 §3.1.3.1 | quoted from A679's evidence table (its live research, 2026-10-16); not re-fetched for this revision |
| Friday 23 October 2026, 21:40 and 21:55 Madrid are hour `06XV`; 22:00 is `06XW`; Madrid is UTC+2 that day | Python: A679's encoding (checked against A679's `06RB` example) and `zoneinfo` `Europe/Madrid` | run 2026-10-21 |
| The promote route's fields, break-glass first, `node.promote`, session ended; code asked only when enrolled | `apps/server/src/promote-api.ts:105-113,147-150,169,171`; `packages/identity/src/manager-login.ts:105-107` | read 2026-10-21 |
| Passkeys: one relying party from config, `waitron.local` in the image; user verification required; the till has PIN sign-in only | `apps/server/src/config.ts:484-492`; `deploy/Dockerfile:276-277`; `packages/identity/src/passkey.ts:228-231,278-281`; `apps/till/src/api/client.ts:2621` | read 2026-10-21 |
| Both boxes carry the same `contactUrl`; the router keeps one entry per address | `apps/server/src/boot.ts:1304`; `adopt.ts:89`; `config.ts:549-551`; `apps/till/src/api/server-router.ts:190-191` | read 2026-10-21 |
| The mDNS responder answers one name, with a 120-second lifetime | `apps/server/src/mdns.ts:45,63-64` | read 2026-10-21 |
| The authority may sign only `waitron.local`, `localhost` and private addresses; each box's certificate names its IPs | `apps/server/src/self-signed-cert.ts:33-39,176-178`; `box-secrets.ts:57` | read 2026-10-21 |
| A name constraint admits any name with labels added on the left | RFC 5280 §4.2.1.10 | `curl` of rfc-editor.org's text, 2026-10-21 |
| A passkey for `waitron.local` signs in at `equipo-7f3a.waitron.local`; refused at an IP and at a sibling name; not found under the subdomain's own name | Playwright Chromium 156, virtual authenticator, certificate errors ignored, names mapped to 127.0.0.1 | run 2026-10-21 with three controls; other browsers and real authenticators not measured |
| The server library accepts a list of origins | `@simplewebauthn/server` 14.0.3, `verifyAuthenticationResponse.d.ts:25` | read 2026-10-21 |
| macOS resolves a two-part `.local` name over mDNS | `dns-sd -P` then `dscacheutil -q host`, macOS 26.6.2, with a never-advertised control | run 2026-10-21; other platforms not measured |
| A phone passkey used at a till needs a tunnel service and Bluetooth | FIDO CTAP 2.2 (14 July 2025), §11.5 | `curl` of fidoalliance.org, 2026-10-21; not measured offline |
| What the recovery sheet is needed for, and that it resets no password | `restore-command.ts:106-109,281-286`; `allocated-lifecycle.ts:15-16,53-56`; `operation-authentication.ts:57`; `management-api.ts:907`; `break-glass-command.ts:32-34`; A679 line 215 | read 2026-10-21 |
| A732's "reinstall the box and start again" | `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md:38-41` | read |
| S2's three failing shapes, and that nothing in the rig fenced a sender | the prototype results note | read |
| A 3000 answer is settled by asking AEAT and comparing fingerprint and installation; annulled is refused | `handleDuplicate`, `packages/fiscal-verifactu/src/drain.ts` | read 2026-10-21; the results note's older reading cites a path that has since moved to the `@waitron/verifactu` package |
| Box price and UPS estimate | `docs/superpowers/specs/2026-07-30-deli-hardware-design.md` §3 | read; estimates, not quotes |
| 10–15 W, O5, the two-box placement | `docs/superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md` §5–§6 | read; reasoning, not measurement |

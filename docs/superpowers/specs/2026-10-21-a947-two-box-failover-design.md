# A947 — Go-live on two local boxes: a spare box that takes over

**Date:** 2026-10-21. **Status:** design, awaiting the owner's answers to four questions (§12). Nothing in it is built.
**Item:** A947. **Refreshes:** the
[topology design](2026-09-16-sqlite-litestream-topology-design.md) §4.4 (on-prem primary → on-prem
mirror), §5 (promotion, return, tail shipper, split brain), §6 (trust and fencing) and §11 (build
order, slices 3–5). Where this document and that one differ, this one is newer; that one is not
rewritten, and carries a dated pointer here.

**Mock-ups:** [`docs/backlog/mockups/a947-two-box-failover/`](../../backlog/mockups/a947-two-box-failover/README.md).

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
it hands over the sales the spare never saw, and becomes the new spare.

"Main box" and "spare box" are the names staff and managers see. The code's words are primary and
mirror (`deployment mode`, `apps/server/src/promote.ts`); this document uses the staff words except
where it names code.

## 1. Goals, non-goals, anti-goals

**Goals.**

1. A venue with two boxes keeps selling when either box dies, with **no internet at all**.
2. Switching to the spare takes **one manager, at any till, in under two minutes**, during service.
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
- Switching automatically with nobody deciding (question 1 asks; the recommendation is no).
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
- the switch needs something the manager on shift cannot have to hand at 21:40 — which is why
  question 2 asks what the re-authentication should be.

## 2. What exists today, and what is missing

Read from the tree on 2026-10-21 (A947's research; every pointer is a file this design builds on):

- **Promotion code exists.** `promoteMirrorToPrimary` (`apps/server/src/promote.ts`) takes an
  operator's fence attestation (`promotion.fence_not_attested`), refuses a node its own document
  marks fenced (`promotion.node_fenced`), runs each module's `provisioning.standby.activate` seat,
  checks the standard and full series, and commits the role flip and a new membership document in
  one transaction. A manager route calls it (`apps/server/src/promote-api.ts`).
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
  decision A (owner, 2026-10-12) kept the standby dormant until take-over, with fresh administrator
  re-authentication and the "old machine is offline" and "no other recovery" confirmations
  ([decision](../plans/2026-10-12-w41s4-standby-activation-decision.md)). The owner then replaced the
  paper register with **hour-coded series** (A679, approved 2026-10-16;
  [design](2026-10-16-a679-hour-coded-series-design.md)): "Standby admission | Keep it dormant
  without reserving a future hour. Promotion selects its hour when activation occurs", and "There
  is no register". At promotion the box picks a UTC hour **strictly later than every hour it knows
  of**, after comparing its clock with the browser's and, when online, an AEAT or an already
  configured Waitron origin's (flagging more than 120 seconds). For a recovery the operator types
  one installation code from the recovery sheet: "Your sheet prints only this node's current
  installation code. Enter that one four-character code in the recovery form" (owner, 2026-10-19,
  superseding the 2026-10-18 list). **What a promotion asks is not yet written down**: A679 names
  "Dormant promotion's host preparation" as an implementation task still open. Activation itself
  landed with W41s-4 (#1700): for the **activating box's own rows only**, it revokes that box's
  live SIF, inserts a new one, empties its chain head and retires its series for new ones
  (`packages/fiscal-verifactu/src/allocation.ts`, every step filtered by the activating node),
  reached through `standby.activate`. The old main box's SIF and series are left as they were;
  they are its own, and nothing issues on them while it is fenced. A promoted box therefore starts a **new installation identity, new series
  and a new chain**, never resuming the dead box's (CLAUDE.md §5).
- **Tills already follow whichever box sells.** Every 5 seconds a till's router asks each server
  in the membership chart's list (`routableServers`) whether it is accepting sales, and moves to the
  one that is, preferring the highest term; on a move it signs the person out, drops unsaved drafts
  and starts again against the new server (`apps/till/src/api/server-router.ts`,
  `apps/till/src/till-app.ts`). `acceptingSales` is true only on a primary that is neither a
  mirror nor fenced (`apps/server/src/boot.ts`). The print agent carries its own copy of this
  router (`packages/print-agent/src/router.ts`).
- **A returning box already fences itself at start when it has a peer configured**: it fetches the
  peer's chart, keeps it if newer, and if that chart fences it, starts as a secondary behind the
  read-only gate (`apps/server/src/boot.ts`, `membership-reconcile.ts`). Filing runs only on the
  `singleton_role = primary` box, re-read on every pass (`apps/server/src/singleton-pass.ts`).
- **Every box answers `waitron.local` with no role check** (`apps/server/src/mdns.ts`, called from
  `boot.ts`), and the install bakes that name in as the one origin every till is handed
  (`deploy/compose.yml`, `deploy/Dockerfile`). Two boxes on one network today would both claim it.
- **Only the primary sells** (CLAUDE.md §5), and the drain files across every SIF in the database
  with no node filter (`claimBatch`, `packages/fiscal-verifactu/src/drain.ts`).
- **Each box keeps its secrets' key outside the database.** Credentials in `tenant_credentials`
  (a `local` table that, like every table since slice 2, lives in the streamed `venue.db`) are
  sealed under `WAITRON_CREDENTIALS_KEY` from the box's own environment
  (`packages/credentials/src/keyring.ts`), so a copy of `venue.db` on another box cannot open the
  AEAT certificate or a card provider's keys. This is the open "vault-ring question"
  (`docs/backlog/replication-cloud.md`, "Fiscal-certificate distribution").

What is missing is everything between "a spare has joined" and "the spare is selling": the data
getting there, the spare keeping up, the switch, devices finding the new main box, the old main box
coming back, and the screens.

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

The setup wizard on a fresh box offers "Add a spare box to this venue" (today's "Add a mirror node",
which `apps/setup` currently marks as not working; backlog, "should the setup wizard still OFFER
'Add a mirror node'"). It finds the main box by its local name, a manager signs in, and:

1. **The bundle grows two secrets: the venue's credentials key and the certificate authority's
   private key.** The credentials key (`WAITRON_CREDENTIALS_KEY` and its version, plus a previous
   key while a rotation is open) lets the spare open the AEAT certificate and the card provider's
   keys the moment it is switched on, with no internet and nobody re-entering them; this answers the
   vault-ring question (§2) by making the two boxes share one ring. The authority's key (`ca.key`,
   held back today) lets the spare issue and later renew the certificate for the venue's name once
   it is the main box, including after the old main box is gone for good. Both are **my call**. The
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
   and no hour (§2); its hour is chosen when it is switched on. This design adds nothing to that.
4. **The main box starts streaming to the spare.** A new place starts with a full copy of the
   database (to be measured on 0.5.17 in slice 3a — the backlog has asked for this receipt since
   2026-10-02). The spare's `nodes` row is written by the main box and arrives in the stream, so
   the adoption-pending latch, which today waits for the spare to insert that row itself against a
   `locations` row it never receives, can finally close (`finish-adoption.ts`).
5. **If the venue streams to a bucket today**, the main box's one stream moves from the bucket to the
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
verifier matters most: once the stream overwrites it, the promote route's break-glass path would
check the main box's key, not the spare's. Each either
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
it: «Cambiar al equipo de reserva». Mock-up 1.

The spare box also shows a banner on its own status page and on any screen attached to it.

### 6.2 What the manager does

Mock-up 2. One dialog. What it asks is **whatever A679's dormant-promotion preparation asks** —
that preparation is still an open implementation task (§2), and this design neither adds a fiscal
step to it nor removes one. Since that preparation is not written down, the list below is this
design's reading of what A679 and W41s ask of a recovery, applied to a promotion — **my reading,
for A679's owner to confirm**:

1. **"The main box is switched off."** The dialog says to unplug it — not "it seems dead". This is
   the decommission-then-promote rule (owner, 2026-09-17; topology §5.2) and W41s's "old machine is
   offline" confirmation in one line, beside W41s's second, "no other recovery is in progress"
   (`noParallelRecovery` on the promote route). The first is the venue's real defence against two
   boxes selling at once; nothing in software can prove a partitioned box is off.
2. **The main box's installation code from its recovery sheet** («Código de instalación»), typed
   in, as a recovery asks since 2026-10-19. The spare's followed copy already holds that code, so
   on a promotion the typed code is a confirmation more than a floor; whether A679's promotion asks
   for it at all is its preparation's call. The spare then picks a UTC hour strictly later than
   every hour it knows of.
3. **The clock check.** The till's browser is the second clock A679 compares with the box's, and an
   AEAT or already configured Waitron origin the third when the internet is up; a disagreement over
   120 seconds is shown, with «Comprobar otra vez» and an explicit confirmation, exactly as at
   setup. Setup also asks "Has anyone set up a Waitron box for this business in the last hour?",
   where "Yes" and "I don't know" wait for the next hour; if promotion asks it too, the venue waits
   in more cases than the one below.
4. **The manager's password and authenticator code** — W41s's fresh administrator
   re-authentication, as the promote route already demands it: a person, their password and a
   current code, or the break-the-glass key instead (`personId`, `password`, `totp`, `breakGlass`,
   `apps/server/src/promote-api.ts`). Typed at the till they are standing at. Whether a till PIN
   may stand in for them during service is question 2: it would be quicker, and it is weaker than
   what the owner's W41s contract asks for, so this design does not assume it.

**One case makes the venue wait.** A679 requires a strictly later hour for every activation. The
main box's hour was chosen when it was set up, usually long before, so the spare can normally use
the current hour at once (unless the clock readings straddle an hour boundary, when A679 waits and
compares again, a matter of moments). But a second switch inside the same UTC hour — the spare fails too and
the venue switches back, or a switch follows a box set up within the hour — has no later hour to
take until the next one begins, and the dialog shows A679's countdown, up to 60 minutes, with no box
selling. That is A679's rule applied as written, named here so it is not discovered on a Friday.

**Before the dialog opens, the spare and the till both try the main box.** If either can still
reach it, the switch is refused with "the main box is still answering", and the dialog offers the
**hand-over** instead (§6.4). This catches the most common false alarm — the main box is fine and
one till's cable is out — without asking anybody to judge it.

### 6.3 What the spare does

In this order, each step refusing cleanly before the next (the existing promotion's discipline):

1. **Stops following**, applies what its store already holds, runs `PRAGMA integrity_check` and the
   chain verifier over the tail of each chain (topology §5.1, step 1). Only now does it check the
   manager's password and code, against the person rows of the copy it has just stopped writing:
   while following, Litestream is writing that file, so the spare does not read it as a live
   database. Stopping is reversible — a refused check resumes following — so nothing irreversible
   happens before the person is known.
2. **Promotes** through `promoteMirrorToPrimary`: A679's hour selection and the module activation
   seat switch on a fresh identity, the series checks run, membership term *n+1* is signed and checked against the stored
   main-box key (§4, item 2), and the role flips — one transaction, the point of no return.
3. **Restarts** into the trading start mode, resets every in-flight AEAT claim it inherited
   (`resetInFlightClaims`, already built), and starts filing — its own new chain, and the old main
   box's records that reached it.
4. **Devices find it.** An open till needs nothing new: the chart lists the spare's address, and
   within about 5 seconds of the spare accepting sales the till's router moves to it (§2), signing
   the person out and dropping any unsaved basket — so staff sign in again and re-add what they had
   not saved. A till that reloads from scratch asks for the venue's name, so the spare **starts
   answering that name only now** (`waitron.local`, or the owner's own name once A917 lands), with a
   certificate it issues from the venue's authority, whose key the bundle now carries (§4); while
   waiting it must not
   answer it, which today's mDNS responder does with no role check. The same-site cookie receipt
   the backlog still owes from #257 is part of this slice.
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
in §6.3. A submission still unanswered at the deadline goes across as `enviando` and is settled as
in §7.1. No fiscal step is skipped and the manager still re-authenticates, but nobody unplugs
anything. This is
the topology design's "if the old primary is reachable, ask it to fence and flush" (§5.1, step 1),
and on a LAN it is cheap.

## 7. When the old main box comes back

Mock-up 4. The old main box powers on still believing it is the main box. Two things must happen
before it can do any harm, and **both are structural, not a runbook step:**

1. **It learns it was replaced before its first filing pass and before it serves a till.** At start it
   asks the spare (on the LAN) for the newest membership document — the boot reconciliation already
   does this for a configured peer and starts a fenced box as a secondary behind the read-only gate
   (§2). What is new is making the spare that configured peer at joining, and a till that reaches
   the box carrying a newer signed document handing it over (`persistNodeMembershipIfNewer`).
2. **A fenced box neither sells nor files.** Filing already needs `singleton_role = primary`, and a
   fenced box does not accept sales (§2). Promotion marks the old main box `sell-only`, a standing
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
   re-authentication as the switch and the same "the other box is switched off" confirmation.

Then it **hands over its tail** — the rows it wrote that the spare never saw — and becomes the new
spare. The owner's 2026-09-24 decision, "a cut-off primary keeps streaming, into its own copy", with
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
arrives with the tail. Both are named for slice 4a's tests, against the drain's real duplicate
handling, since the rig's stand-in for AEAT is not AEAT.

### 7.2 Becoming the new spare

When the spare confirms it holds the tail (its counts match the sender's), the old main box shows
"Make this the spare box". A manager confirms; the box wipes its `venue.db`, joins as a fresh spare (dormant,
as in §4; its old SIF and series are never issued on again — if it is ever switched on, activation
retires them and A679 picks it a fresh hour then), and follows. Today `retireSelf` and `rejoinAsSecondary` lost the
proofs that a box's rows reached the carrier before an irreversible step (backlog residuals,
"retireSelf and rejoinAsSecondary lost their drain confirmations"); the tail receipt is that proof,
and the wipe refuses without it.

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

**Printers, the drawer and the counter screen.** Anything plugged into the main box by USB dies
with it. Under the hardware decisions' O5 the main box drives the counter screen and, usually, the
receipt printer and its drawer, so when the main box dies the counter till goes with it and the
switch is made from another till or a handheld. The design therefore asks that, in a two-box venue,
the receipt and kitchen printers be on the network, not USB, so either box's print agent reaches
them (the agent already follows whichever box sells, §2; the failover-printing design,
2026-08-26, §3, runs agents on more than one host). A printer that must stay on USB is lost with
its box until it is moved, and the setup should say so when a second box joins.

**The installer (B3).** Both boxes are installed from the same stick, identically. The setup wizard
asks which job the box does — "Set up a new venue" or "Add a spare box to this venue" — so the stick
does not need to know.

**Cost to the venue** (estimates, from the deli hardware design §3, 2026-07-30, which priced the box
at "Local server — fanless mini-PC, 16 GB, NVMe … ~€250 … Estimate"):

- **About €250 for the second box**, the same model as the first.
- **The UPS may need to be larger**: the deli design sized one ~650 VA unit (~€100, estimate) for
  one box; whether it carries two boxes, the switch and the tills through a power cut is a sizing
  check against the actual hardware, not done here.
- **Possibly a saving**: a box can drive a counter screen (hardware decisions, O5), so a two-counter
  venue's second box can also be its second till, which the hardware decisions price at €300–450
  for a separate machine. Whether the spare may serve as a till is B3's open lean (box-as-till);
  while it waits, its screen shows the spare's status, not the till.
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
  document as the one statement of who is main, and A679's hour selection at promotion, which takes
  no names from Cloud ("Take no names from paper or Cloud", A679's restore table).

W41s-10b ("Signed stream witnesses and fencing", lane E) designs a signed witness outside the box.
This design uses the pointer in the spare's store as the main box's outside witness on the LAN, and
adopts W41s-10b's format when it lands rather than inventing one.

## 11. Build order: slices 3–5, as pull requests

Each line is one pull request. **Fiscal** ones wait for the owner to land (lanes land their own
pull requests except truly fiscal ones, owner 2026-10-21). Every slice adds its step to the stream
loop test (`apps/server/src/stream-loop.e2e.test.ts`), which grows into the two-box loop.

**Slice 3 — the spare keeps a copy.**

- **3a. Each box's own state leaves `venue.db`.** `node.db`'s first tables (the one migration);
  every box's signing key, and the spare's mode and mirror settings, move there (§4, items 2 and the
  `node.db` paragraph); the bundle's two new secrets; the stored main-box key and the three checks
  it guards. Not fiscal, but it moves the key that signs membership documents, so it takes the full
  review.
- **3b. The spare hosts the store, and joining brings the data.** versitygw in the box image, its
  licence notices, TLS under the venue authority, the pair's access key; the main box's stream
  targets it; the first full copy over the LAN, measured on 0.5.17 with the internet unplugged;
  the main box writes the spare's `nodes` row and adoption-pending closes; joining refuses while
  the venue streams to a bucket (until 5d). Not fiscal.
- **3c. The spare follows.** The waiting start mode; `restore -f` into the follower copy (follow mode
  exists at the pin, `cmd/litestream/restore.go:39`, but has never been run in this repository —
  measure lag and a byte-identical restore against a direct one); the two alerts; the "Spare box"
  row on the Box status page and the Servers screen (mock-up 3). Not fiscal.

**Slice 4 — switching.**

- **4a. Promotion from a followed copy.** Stop, verify, check the person, `promoteMirrorToPrimary`
  with A679's dormant-promotion preparation (hour selection, the clock check, and whatever
  typed code and questions that preparation settles on) and W41s's activation, the stored-key check, restart, the in-flight reset; tests for the
  spare re-filing an inherited record against the drain's real duplicate handling (§7.1).
  **Fiscal.** If A679's dormant-promotion preparation has not landed by then, it is built here or
  first, by whichever lane holds A679.
- **4b. Devices follow, and the take-over screens.** The strip, the dialog and its refusals (a till
  or the spare still reaching the main box), `node.promote` at the till, the venue name and certificate on
  the spare, the router's switch, and the card-payment ownership rule A764 asks for. Not fiscal, but
  it lands after 4a.
- **4c. The hand-over.** The main box fences on request, waits for answers already due, syncs, and
  reports its last change; the spare waits for exactly it. **Fiscal** (it fences a filing node).

**Slice 5 — the old main box comes back.**

- **5a. Fenced before the first pass.** The spare is the configured peer; boot decides the role
  before the first filing pass; a box with a spare waits for it rather than proceeding (the change
  to Ruling C7) with the manager's override; a till hands a newer document to a box it reaches.
  **Fiscal.**
- **5b. The prototype re-run.** S2 in `bench/sqlite-failover` with the fence, the full-state
  batch, the replay variant as a part of its own and the `enviando` return modelled, and both
  controls. The gate for 5c: no PASS, no tail shipper. Not fiscal (a rig).
- **5c. The tail shipper and rejoin.** Sender and receiver, terminal-state-wins both ways, a filing
  case where two finished states disagree, the receipt, the guarded wipe, a fresh dormant spare. A fresh-context review of its own before it is built
  (topology §5.2, risk 2). **Fiscal.**
- **5d. Copy-up.** The spare mirrors its store to the owner's bucket, deletions included, generation
  and pointer rules (§8); joining stops refusing a venue with a bucket. Not fiscal.

**Before the first venue goes live on two boxes:** a rehearsal on two real boxes on one switch —
pull the main box's plug mid-sale, switch, sell, power it back, hand over, rejoin — with the internet
unplugged throughout. The rigs prove the parts; only the rehearsal proves the venue's evening.

## 12. Questions for the owner

Asked one at a time in `questions.md`, each with a worked example
(`docs/backlog/mockups/a947-two-box-failover/question.txt`). The recommendations are mine.

1. **Who switches to the spare: a manager, or the boxes by themselves?** Recommended: a manager, from
   any till, after the strip appears. An automatic switch needs a third party that can tell "the main
   box is off" from "the main box is cut off", and a two-box venue has none; W41s's confirmations
   also need a person. Mock-up 5 shows the evening both ways.
2. **What proves it is a manager at the switch: the password and authenticator code, or their till
   PIN?** Recommended: the password and code, as the promote route already demands and as W41s's
   "fresh administrator re-authentication" reads, with the break-the-glass key as the fallback when
   no such manager is on shift. A PIN is quicker mid-service but is a weaker proof for a step that
   switches on a never-reused fiscal identity, and it would change what the owner approved for
   W41s-4.
3. **When the old main box comes back, should it hand over its kept sales by itself?** Recommended:
   yes for the hand-over (it is fenced, so it is safe), but a manager confirms turning it into the
   new spare, because that wipes it.
4. **Is a spare box required for every venue, or a choice?** Recommended: a choice, offered at setup
   and on the Servers screen, with a one-box venue carrying today's "one copy" warning; the first
   venue takes two.

## 13. What this design does not settle, for the builder

- The exact names of the two alerts and the error codes, against their siblings.
- The 20-second strip delay and the one-minute and two-minute alert bounds are starting values, to be
  checked in the rehearsal.
- Whether the router or the name carries a till across the switch, in each browser (§6.3, item 4).
- The card payment in flight at the moment of the switch (A764).
- Sizing the UPS for two boxes.

## Provenance

| Claim | Source | How established |
| --- | --- | --- |
| The owner's go-live words | owner, watcher session 2026-10-21 ~08:25 | quoted in queue item A947 |
| Litestream 0.5.17 refuses a second replica | `cmd/litestream/main.go:794-795` at tag v0.5.17 | `curl` of the raw file, 2026-10-21 |
| Follow mode exists at the pin | `cmd/litestream/restore.go:39` at tag v0.5.17 (`fs.BoolVar(&opt.Follow, "f", …)`) | `curl` of the raw file, 2026-10-21; never run in this repository |
| versitygw is Apache-2.0 and maintained | GitHub API `repos/versity/versitygw` | `curl`, 2026-10-21 |
| The conditional write holds on versitygw 1.8.0 | `apps/server/src/stream-loop.e2e.test.ts`; results note, "Standing obligations" | read |
| The bundle carries the authority's public certificate only, no series under hour codes, and no data | `apps/server/src/mirror-bundle.ts` (`readFile(caCertPath(…))`, the `on-activation` refusal), `finish-adoption.ts` | read 2026-10-21 |
| A box's signing key is a `tenant_credentials` row, one per database | `apps/server/src/node-identity.ts` (`membership.node_key`); the table's primary key is `purpose` | read by the fresh-context review, 2026-10-21 |
| Credentials are sealed under a key from each box's own environment | `packages/credentials/src/keyring.ts` | read 2026-10-21 |
| Dormant until take-over, with re-authentication and the offline confirmations | W41s-4 decision A, owner 2026-10-12 | `docs/superpowers/plans/2026-10-12-w41s4-standby-activation-decision.md` |
| No register; promotion selects its hour; one typed installation code for a recovery; 120-second clock check; promotion's preparation still open | A679, owner-approved 2026-10-16; PDF decisions of 2026-10-19 | `docs/superpowers/specs/2026-10-16-a679-hour-coded-series-design.md` |
| S2's three failing shapes, and that nothing in the rig fenced a sender | the prototype results note | read |
| A 3000 answer is settled by asking AEAT and comparing fingerprint and installation; annulled is refused | `handleDuplicate`, `packages/fiscal-verifactu/src/drain.ts` | read 2026-10-21; the results note's older reading cites a path that has since moved to the `@waitron/verifactu` package |
| Box price and UPS estimate | `docs/superpowers/specs/2026-07-30-deli-hardware-design.md` §3 | read; estimates, not quotes |
| 10–15 W, O5, the two-box placement | `docs/superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md` §5–§6 | read; reasoning, not measurement |

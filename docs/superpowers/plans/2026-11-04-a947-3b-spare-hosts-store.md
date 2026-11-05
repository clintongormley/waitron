# A947 slice 3b — the spare hosts the store, and joining brings the data — Implementation Plan (revision 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Revision 4, 2026-11-04**, answering the fourth-round claim check of revision 3 (`866b1730f7`),
which found 0 Critical, 2 Important and 6 Minor problems
(`/Users/clintongormley/waitron-campaign/item-a947-3b-round4.md`). Written against `main` at
`6a52e7189c`; line numbers are that commit's (the worktree's code is identical to it, probe P21).
What changed:

- **I1 (a spare's network surface):** every start a spare can make — the joining spare's latch
  start, a mirror's time-zone repair start and a mirror's full start — now runs the landing pages on
  `127.0.0.1` only, through one helper; D8 gains item 7, the latch start's own surface; Task 4.5b
  checks all three starts; fact 25's "fenced" start is corrected to the time-zone repair start.
- **I2 (Task 4.1 and the FISCAL rule):** Task 4.1 changes how the start check reaches a peer by
  name, so D16 now names it as a second judgement beside Task 6.2, kept in 3b-4 with its reason, and
  3b-4's PR body says so in its first line; the header no longer says no other PR changes such a
  step.
- **Minors:** fact 25 no longer misquotes fact 6; G.3's recovery words say the main box waits at
  its next start; Task 6.8a's restart citations and D4's are corrected; Task 5.6b's route test is
  described as it will be built; Task 6.8a is split into 6.8a (the seams, with their own tests) and
  6.8b (the shared box set-up, the new file and the CI lists); the phases are now Task 6.8c.
- Each finding has a row in "Review response (revision 3 → revision 4)" at the end; revision 3's
  own summary is the "revision 2 → revision 3" table. The design's dated pointer is unchanged: no
  departure was added or removed.

**Spec:** [`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md`](../specs/2026-10-21-a947-two-box-failover-design.md)
§11 slice 3b; §3 (the shape); §4 items 1, 3, 4, 5 and 6 and the `node.db` paragraph; §5's first
paragraph; §6.6 way 1; the dated A1018 block at the top. Also read, for what it expects of 3b: the
[A1018 build plan](2026-11-02-a1018-handover-build.md) "Before you build" facts 1–5 (`:80-125`),
the slice table (`:776-796`) and "Slice 3 as built" (`:1731-1760`, Rulings R12 and R13).

## The header facts, for scheduling

- **Eight pull requests**, in order: 3b-1, 3b-2, 3b-3, 3b-4, 3b-5, **3b-G**, 3b-6, then **3b-F**.
  Each leaves `main` green and working on its own (the cut is explained below). 3b-1 depends on
  nothing and may be built beside the others. 3b-3 comes after 3b-2: Tasks 3.1 and 3.3 call
  `boxHostnameFor`, which Task 2.1 creates. 3b-G comes after 3b-4 (Task G.2 calls Task 4.1's
  lookup) and may be built beside 3b-5. **3b-6 lands only after 3b-G is on `main`**, because 3b-6
  is what makes a lost `node.db` dangerous (fact 16) and 3b-G holds the refusal for it.
- **Fiscal: two of the eight, both landed by the owner.** **3b-G** changes the start steps that
  decide whether a box files: what the start check trusts, how the boot reconcile reaches a peer,
  and a new start refusal for a box that lost its `node.db` (D16; house precedent: A1018 Slice 3,
  "decides, before the first filing pass, whether a box may file", landed as FISCAL, #2436). **3b-F**
  lets a venue that files with Veri*Factu add a spare; its content depends on the owner's question
  Q1. By their file lists, the other six touch nothing in `packages/fiscal-verifactu` and add no
  start refusal. **Two of their tasks do touch the start check, and stay out of 3b-G by a judgement
  the owner may overrule (D16):** Task 4.1 (in 3b-4) changes how the start check reaches another
  box by name, and Task 6.2 (in 3b-6) writes the spare's `nodes` row, which the already-landed start
  check then counts. Each PR's body says so in its first line.
- **Migration: yes, one, in `node.db` only**, in 3b-5: a new table `node_pair_link` in the node
  migration set (`packages/node-db/drizzle`, which holds `0000` and `0001` today). No `venue.db`
  migration in any of the eight. No venue reset is needed: the table is additive.
- **Review path: full** for 3b-2 to 3b-6, 3b-G and 3b-F. They touch trust and authentication (keys,
  certificates, an access key, who a box believes, what a mirror serves to the network),
  cross-package contracts (`@waitron/node-db`, `@waitron/membership`'s chart minting, the stream's
  target in `stream-host.ts`, the till's server router) and, in 3b-G and 3b-F, whether a box may
  file and when a fiscal module's spare may exist. 3b-1 (a binary and its licence notices in the
  image) touches no risk trigger and takes the light path. The Codex run-it seat runs on every
  branch.

## Words used here

- **Main box / spare box** (staff words): the box that sells, and the box that keeps a copy. The
  code says primary and mirror; the setup app says "primary server" and "this server"; the
  dashboard's Servers screen calls the spare a **Standby** («En espera») and removing it **Remove**
  («Retirar»), so words a person reads on those screens use those labels.
- **`venue.db`**: the venue's database, which the main box streams. **`node.db`**: each box's own
  small database, never streamed (slice 3a).
- **The store**: a small S3-compatible file server — the program **versitygw** — that runs on the
  spare and receives the main box's stream. S3 is the file-storage protocol Amazon defined; slice 2
  built the stream on it.
- **The stream**: **Litestream**, the program that copies every change to `venue.db` into a store,
  about a second behind. Version 0.5.17 is pinned.
- **The first full copy**: the whole database, which Litestream sends first to a new store, before
  the stream of changes.
- **Copy-up**: the spare passing its store on to the venue's own storage bucket (design §8). It is
  slice 5e and is not built; until it is, a venue cannot both copy to its bucket and have a spare.
- **The chart** (membership chart): the signed document listing every box of the venue, its
  address (`contactUrl`) and its standing. **Endorsement**: one box's signature over another box's
  public key, which lets a third party trust that key.
- **Authority**: the venue's certificate authority, the key that signs the boxes' HTTPS
  certificates, which every till trusts since pairing. **Leaf**: one box's own HTTPS certificate.
  **Client certificate**: a certificate a box shows when it is the one connecting, so the other end
  can check who connects.
- **mDNS**: how a `.local` name (such as `waitron.local`) is found on the venue's network without a
  name server: a device asks the whole network, and the box with that name answers.
- **Finished joining**: a spare whose `nodes` row the main box's `venue.db` holds (A1018's
  definition; the start check counts only such boxes).
- **The adoption latch** and **the latch start**: `pending-adoption.json`, the file a joining spare
  writes and keeps until it has finished joining (`apps/server/src/finish-adoption.ts:17-18`), and
  the start a box makes while that file exists (`boot.ts:1699-1745`).
- **The one main box**: the box `boot.ts` calls `isSingletonPrimary`, the only one that runs the
  duties a venue runs once (the Cloud tunnel, `boot.ts:3291`).
- **The session running this plan**: whoever dispatches the implementers and lands the pull
  requests. It, not an implementer, edits `docs/backlog.md`.

---

## What slice 3b delivers, in one paragraph

After 3b, the owner can add a spare to a venue with the internet unplugged, and it ends up holding a
full copy of the venue. The spare runs the store; the main box streams to it over the venue's
network, encrypted under the venue's authority, with an access key made for this pair and a client
certificate the store checks. Each box has its own name (`box-7f3a.waitron.local`), written in the
chart and in its certificate; `waitron.local` is answered by the box that sells (or waits to sell),
and by a box in setup mode only while no other box answers it. The boxes find each other by those
names, ignoring their own answers, trust each other's certificates and signed answers, and the main
box writes the spare's `nodes` row, so the spare finishes joining. What 3b does **not** do: the spare
does not keep following the stream into its own copy (3c), nobody can switch to it yet (A947 4b–4e), and
a venue that copies to its own storage bucket cannot add a spare until copy-up exists (5e).

---

## What exists today, traced on `6a52e7189c`

Every line below was opened or run on this commit. "Probe Pn" points at the "Probes" section near
the end, which gives the command and what it printed.

1. **A spare cannot join a venue that files with Veri*Factu.** `adoptFromPrimary` calls
   `assertAdoptionModules` (`apps/server/src/adopt.ts:143`), which refuses any module that has
   operations and opens its series at activation (`finish-adoption.ts:20-26`). Only the fiscal
   module declares that: `series: "on-activation"` appears once outside tests
   (`packages/fiscal-verifactu/src/allocated-standby.ts:164`). So a venue with the fiscal module
   disabled gets the whole join from 3b-6 on. The test "refuses allocation-dependent adoption
   before its first local write or handover" expects `module.operation_invalid`
   `{ module: "fiscal-verifactu" }`, and "still adopts when the allocation-dependent module is
   disabled" (`apps/server/src/adoption-allocation-refusal.test.ts:141,158`; probes P6, P16). The
   check runs **after** the main box has already reserved for the spare and added it to its chart
   (`adopt.ts:106-111` fetches the bundle first; `mirror-bundle-api.ts:127-143`).
2. **A joined spare never finishes joining** (A1018 fact 1): the latch is written at
   `adopt.ts:195-202`; finishing refuses `mirror.venue_not_copied` while the spare's own `venue.db`
   has no venue row (`apps/server/src/reserved-identity.ts:68-69`), and nothing copies one. Finishing
   today also inserts the spare's `nodes` row into the **spare's** file (`reserved-identity.ts:77-85`),
   not the main box's (A1018 fact 3).
3. **Joining needs a Cloud relay.** The main box's bundle route refuses `mirror.no_relay` when no
   tunnel is configured (`apps/server/src/mirror-bundle-api.ts:117`; the relay comes only from the
   tunnel settings, `boot.ts:3321-3324`; probe P1). Against design goal 6 ("Adding the spare box
   needs no internet either"). The mirror link's `relayUrl` has one reader: the boot reconcile's
   peer address (`boot.ts:1921`).
4. **Both boxes advertise the same address.** The spare sends `deps.advertisedOrigin` as its
   `contactUrl` (`adopt.ts:109`); the first box seeds its chart row with the same value
   (`boot.ts:1641`, `first-setup-publication.ts:68`); `advertisedOrigin` defaults to the management
   origin (`config.ts:539-541`), which the image sets to `https://waitron.local`
   (`deploy/Dockerfile:277`). The start check never asks a peer at its own address
   (`boot-peer-check.ts:143-149`, `own_address`).
5. **Every box answers `waitron.local`, whatever it is doing, and hears its own answer.** Five
   starts call `startMdnsResponder({ hostname: BOX_HOSTNAME, … })` — setup (`boot.ts:1656`), the
   latch start (`:1718`), the restricted start (`:1778`), the waiting start (`:1866`) and the full
   start (`:3625`) — and the responder answers that one name to anyone (`mdns.ts:59-73`); it is off
   in development and on a loopback-only listener (`mdns.ts:55`). The `multicast-dns` library loops
   a box's own multicast back to it unless told not to
   (`node_modules/.pnpm/multicast-dns@7.2.5/.../index.js:58`, `setMulticastLoopback(opts.loopback !== false)`).
   On Linux, a box asking for `waitron.local` while its own responder answers it gets its own
   address first; with loopback off it gets nothing (probe P13); with a second box answering too,
   the asking box's first answer is its own and dropping its own addresses leaves the other box's
   (probe P14).
6. **A mirror cannot be reached from the venue's network.** `assertMirrorBindSafe` refuses a mirror
   that listens on anything but loopback unless `WAITRON_MIRROR_ALLOW_EXPOSED` is set
   (`apps/server/src/mirror-bind-guard.ts:14-23`, called at `boot.ts:2005`); the image listens on
   `0.0.0.0` (`deploy/Dockerfile:275`) and nothing under `deploy/` sets the opt-in (probe P3). So a
   spare that finished joining would fail to start with `server.mirror_bind_exposed`. The guard
   exists because a mirror serves an ambient full-administrator dashboard with no sign-in
   (`mirror-session.ts:85-92`, mounted at `boot.ts:2020-2025`).
7. **Boxes cannot find each other by a `.local` name.** The runtime image is `node:26-slim`
   (`deploy/Dockerfile:164`); in it, `/etc/nsswitch.conf` reads `hosts: files dns` and there is no
   `libnss_mdns`, so Node's name lookup — which `fetch` and `node:https` use — fails for a `.local`
   name even while an mDNS responder on the same network answers it, and a direct mDNS query from
   Node gets the answer (probe P5). Inferred, not run against a box: a spare joining by the name
   `https://waitron.local` fails at the lookup today. A venue's private address typed instead is
   refused before anything is sent: `assertSafePrimaryUrl` refuses `10/8`, `172.16/12` and
   `192.168/16` literals over both schemes and lets any name through over https
   (`apps/server/src/primary-url.ts:17-19,52-56`; the case "rejects http to a 192.168.0.0/16
   literal" passes, probe P28). So today no address works for a real two-box join; after Task 4.1
   the name does. (Revision 2 said a typed IP works; that was wrong.)
8. **A main box holds no key for its spare** (Ruling R13). `peerKeyOf` knows this box's own key, a
   pinned main-box key and keys the held chart's endorsements vouch for
   (`apps/server/src/handover-signing.ts:32-41`); a minted chart carries only its signer's own
   endorsement (`apps/server/src/membership-mint.ts:67-73`). A chart carrying the main box's
   endorsement of the spare makes the spare's key known; a wrongly signed one does not (probe P4).
9. **A main box does not pin anything when it asks a peer** (Ruling R12): `authorityOf` returns a
   certificate only for the spare's own origin box (`start-peer-check.ts:191-196`), and otherwise the
   ask connects with `rejectUnauthorized: false` (`boot-peer-check.ts:346-353`). The boot reconcile
   uses the plain global `fetch`, with no time limit and no pin (`membership-reconcile.ts:60-78`).
10. **The venue authority can sign a box's own name, and a spare keeps a second authority's files.**
    A leaf for `box-7f3a.waitron.local` that the box's authority signs verifies under that
    authority; a leaf from another authority, a leaf without the name, and a name outside
    `waitron.local` are refused (probe P2; the permitted names, `self-signed-cert.ts:34-40`). Since
    3a a spare holds the venue authority as `tls/venue-ca.crt` and `tls/venue-ca.key`
    (`box-secrets.ts:93-101`), unused by the listener. `git grep -n venue-ca` finds, in code:
    `box-secrets.ts:99-100` (the writer), `adopt.ts:169` (its one caller),
    `backup-optional-state.ts:14-15`, `reset-request.ts:113-116` and `deploy/waitron.sh:813` (the
    two resets); in tests: `adopt.test.ts:564-567`, `archive-entries.test.ts:91-110`,
    `backup-data-placement.test.ts:327-336`, `backup-verification.installed.test.ts:91-92`,
    `reset-request.test.ts:120-124,154-157,231-234`, `scripts/waitron-sh.test.mjs:1753-1756`; in
    prose: `deploy/README.md:422-424,468`.
11. **Litestream trusts only the system's certificate list.** At v0.5.17 its S3 client builds its own
    HTTP transport and sets TLS options only to skip checking (`s3/replica_client.go:384-410`);
    `root-cas` exists only for NATS (`cmd/litestream/main.go:1175`) (probe P11). On Linux,
    `SSL_CERT_FILE` naming the authority made it stream (probe P7); on macOS the same setting did
    not (probe P8). With no trust, Litestream wrote nothing for 90 seconds **and logged no error**
    (probe P7).
12. **A byte pipe solves both.** Litestream speaking plain HTTP to a loopback port on the main box,
    piped by Node over TLS pinned to the venue authority to a Node TLS listener on the spare, piped to
    versitygw on the spare's loopback, streamed and restored on macOS; with another authority pinned,
    nothing was written and Node logged `CERT_SIGNATURE_FAILURE` (probe P9). The request signature
    (S3 signs the `Host` header) passed through unchanged, as the repository's own rehearsal proxy
    already relies on (`aws-rehearsal-interrupt.e2e.test.ts:94-95`).
13. **versitygw is ready to ship.** The repository pins 1.8.0 with checksums for four platforms
    (`scripts/setup-s3-test-server.mjs:20-39`) and a second copy of the version
    (`apps/server/src/testing/s3-test-server.ts:20`). Its release tarball carries `LICENSE` (Apache
    2.0, the same text as `deploy/third-party/licenses/Apache-2.0.txt` but for one leading blank
    line) and `NOTICE` ("versitygw - Versity S3 Gateway / Copyright 2023 Versity Software"); it takes
    its access key from `ROOT_ACCESS_KEY_ID` and `ROOT_SECRET_ACCESS_KEY` in the environment, not
    only from the command line (probe P10). The image already ships Litestream the same way: a
    pinned stage with checksums (`deploy/Dockerfile:145-159`), a pin test
    (`scripts/litestream-pin.test.ts`), generated Go module notices
    (`scripts/litestream-notices.mjs`, `deploy/third-party/litestream/NOTICES.txt`), and an
    image-smoke step that runs the binary (`.github/workflows/image-smoke.yml:270-285`). Go is not
    installed on this Mac (probe P12).
14. **The bucket settings live in `venue.db`**, sealed, as purpose `backup.stream`
    (`stream-host.ts:30`), saved by `PUT /api/backup/stream` (`stream-api.ts:227-250`) and removed by
    `DELETE /api/backup/stream` (`:255`). Litestream 0.5 streams a database to one place only
    (design §3, reason 1).
15. **Rotating the key ring leaves the spare behind** (A1273): `rotateCredentials` re-seals the main
    box's vault rows and its own signing key under the ring's current version
    (`packages/credentials/src/store.ts:260-285`), and nothing sends the new ring to a spare. No
    runbook under `docs/operations/` covers a rotation; the one written rule about what it reaches
    is `docs/developers/conventions-data.md:928`.
16. **A lost `node.db` reads as a sole primary** (A1274): `packages/node-db/src/mode.ts:15-16`. Before
    3b a spare holds no venue data, so its start fails before it could sell. After 3b its
    `venue.db` holds the main box's sales and its own `nodes` row, so the same start would come up as
    a selling, filing primary beside the main box — and the drain files across every invoicing
    installation in the database with no node filter (design §2). **3b makes this reachable**, so
    3b takes A1274 (Task G.3, which lands before 3b-6).
17. **The till ignores the node id the chart gives it.** The till's start read hands it
    `routableServers(held)` (`till-api.ts:1535`), which carries each box's `nodeId`
    (`packages/membership/src/fence.ts:54-60`) into `ServerEntry.nodeId`
    (`apps/till/src/api/server-router.ts:2-5`); the router builds its list from the page's origin
    first and each entry's URL, never reading `nodeId` (`server-router.ts:240-262`). Its lock screen
    draws a status line per entry unless there is exactly one, selling
    (`apps/till/src/screens/till-lock-screen.ts:393-399`). `/api/node` gives no `nodeId` before
    trading is admitted (`node-api.ts:46-47`). Read, not run.
18. **The spare's dormant tax-filing setup lives in the file of the box that establishes it, not in
    `venue.db`.** The fiscal module's `establish` step writes it through `host.withPreparationState`
    (`packages/fiscal-verifactu/src/hour-dormant-standby.ts:146-167`, `state.replace({… dormant …})`),
    which keeps it in `<stateDir>/module-preparation-state.json`
    (`packages/provisioning/src/module-preparation-state.ts:78,100`). A promotion reads it from the
    promoting box's own file (`apps/server/src/node-operation-preparation.ts:112`, then
    `hour-recovery-state.ts:50-52`). `establish` needs a person's live authority, which exists only
    in memory inside one request (`packages/module/src/operation-authority.ts:26`, a `WeakMap`), the
    spare's `nodes` row (`hour-dormant-standby.ts:209`, `requireTarget`), and the main box's active
    filing registration (`:237`). Without a person's authority, `establish` returns `false` and
    touches no database; a promotion with no retained setup is refused
    `sif.allocation_invalid` `{ reason: "reservation_mismatch" }` before it writes (probe P15).
    `reserve`, which the main box's joining route can already run under a person's sign-in
    (`mirror-bundle-api.ts:147-163`), writes no history (the test "reserves dormant configuration
    before the standby node exists", probe P16).
19. **Both resets keep what a join wrote.** The staged reset (the setup app's "Start again" after a
    stopped join; it runs only for an `adopt` record, `setup-api.ts:1136-1139`) removes the venue
    databases, the latch and `tls/venue-ca.*`, and keeps `secrets.env` and the rest of `tls/`
    (`reset-request.ts:107-117`; `reset-request.test.ts:239` asserts `secrets.env` kept). Since 3a
    (#2371, `git log -S persistCredentialsRing`), adopt writes the main box's key ring over the
    spare's `secrets.env` (`adopt.ts:168`), so a stopped join's reset already keeps the venue's ring.
    `waitron.sh reset` keeps `tls/` (less `venue-ca.*`) and removes `secrets.env`
    (`deploy/waitron.sh:806-813`; `waitron-sh.test.mjs:1767-1773` expects only `tls/` left).
20. **A box mints its certificates only in setup mode, and refuses half a set.** `ensureBoxSecrets`
    runs only in setup mode (`boot.ts:1331`); when the leaf's key is missing it refuses
    `setup.not_ready` if the authority, the leaf, `secrets.env` or a repair archive remain
    (`box-secrets.ts:196-206`); a leaf reissue first copies the old leaf (`box-secrets.ts:280`).
    So "remove the leaf and let the next start issue one" does not work, and a reset that empties
    `tls/` must also remove `secrets.env` (probe P18).
21. **Today's leaf cannot serve as a client certificate.** It carries `extKeyUsage` `serverAuth`
    only (`self-signed-cert.ts:189`). A TLS server checking client certificates under the authority
    refused it `INVALID_PURPOSE`; a certificate the same authority signed with `clientAuth` passed;
    one from another authority failed `CERT_SIGNATURE_FAILURE` (probe P17).
22. **On a mirror, promotion is open to anyone who can reach the box.** The read-only gate refuses
    every request but `GET`, `HEAD`, `OPTIONS` (`read-only-gate.ts:17`) and the exempt rows
    (`read-only-gate.ts:33-37`); on a mirror
    the exempt rows are `POST /management-api/promote` and `/promote/preparation`,
    `/api/node/peer-status` and `/api/node/membership` (`read-only-exemptions.ts:18-53`; retire is
    fenced-only). Promotion takes a manager's password and code, or the break-glass key
    (`promote-api.ts:155-180`). Today a mirror listens on loopback only (fact 6). After 3b-6 its
    `venue.db` holds every person's password hash, so a manager's own password works there.
23. **A second box's setup page is reached by the venue's name only.** After install the console
    prints `http://waitron.local/setup/trust` and its QR code, and nothing else to reach setup by
    (`deploy/waitron.sh:460-477`). With a main box answering that name, the person reaches the main
    box, not the new one. The box lists its own addresses on its discovery and landing pages
    (`box-reach.ts:104-112`), but those are reached through the box already.
24. **The setup app's joined screen says the join stalls**, and sends the person to "whoever
    installed this server" (`apps/setup/src/i18n/strings/finish.ts:73-81`). True until the join
    finishes, so its words change in 3b-6, not before.
25. **Every start also runs a second, plain-HTTP app on the landing port.** `startLandingListener`
    (`boot.ts:849-880`) serves `buildLandingApp` on `config.landingPort` at `config.httpHost`; the
    full start, mirrors included, calls it (`boot.ts:3736`), as do the setup, latch, restricted and
    waiting starts and the time-zone repair start (`:1674,1738,1796,1873,2177`; the last is the
    start a box makes while its saved time zone is not valid, `boot.ts:2076-2177`; revision 3
    called it "fenced"). It serves `GET /` and `/setup/trust`,
    `/ca.crt` and `/setup-api/ca.crt` (`landing-app.ts:61,73`), `/setup/connection`
    (`connection-bootstrap.ts:67`), and `POST /setup-api/connection/repair` and `/continue`
    (`connection-bootstrap.ts:110`), which take no sign-in: they check the `Origin` and `Host`
    headers and an empty body, and `repair` runs `repairBoxTls`. The read-only gate is not on this
    app. Today a mirror's full start refuses at the bind guard (`boot.ts:2005`) before this
    listener starts (fact 6), and the time-zone repair start comes after that guard, so neither
    serves it on a mirror; with the guard retired (D8), both would serve it on every address
    (`deploy/Dockerfile:275`). **A joining spare's latch start has no guard and serves it on every
    address today** (`boot.ts:1699-1738`), beside its own small surface: `/health`,
    `/api/box/status`, and the two signed `POST` routes `/api/node/peer-status` and
    `/api/node/membership` (`boot.ts:1695-1704`). The latch start runs only on a joining spare:
    `pending-adoption.json`, which selects it, has one writer, adopt (`adopt.ts:195`; `git grep -n
    "writePendingAdoption("` finds no other caller). Read, not run.
26. **A standby that finished joining cannot be removed.** The Servers screen's Remove
    (`removeUnjoinedStandby`) refuses `membership.standby_joined` (409) when the main box's
    `venue.db` holds a `nodes` row for it, and checks again under the write lock
    (`apps/server/src/membership-removal.ts:73,264`); the dashboard says "This standby finished
    joining, so it cannot be removed" (`apps/dashboard/src/i18n/codes.ts:1286-1289`). Both cases
    pass (probe P22). After 3b-6 a joined spare has that row (Task 6.2), so no screen can remove it.
    The screen calls the spare "Standby" / «En espera» and the action "Remove" / «Retirar»
    (`apps/dashboard/src/i18n/strings.ts:1811,1814,5593,5596`).
27. **The spare passes on only one of the main box's refusals.** `refusalFrom`
    (`apps/server/src/mirror-bundle-fetch.ts:75-89`) rebuilds `password.invalid` and turns every
    other refusal into `mirror.bundle_fetch_failed`, so the setup screen shows its generic words. The
    cases pinning this use the codes `totp.invalid`, `person.not_found` and `person.suspended` and
    four malformed bodies (`mirror-bundle-fetch.test.ts:175-221`; the relay and pass-nothing cases
    pass, probe P23). The spare's adopt route answers each code by its own table, `ADOPT_STATUS`
    (`setup-api.ts:290-302`), where `module.operation_invalid` is already 409.

---

## The cut, and why

| PR | What it does | Leaves `main` working because | Fiscal | Migration | Review |
| --- | --- | --- | --- | --- | --- |
| **3b-1** | versitygw in the box image, its licence notices, its pin | the binary sits unused | no | no | light |
| **3b-2** | Each box's own name in its chart row and mDNS answers; the mDNS lookup that ignores the box's own answers; who answers `waitron.local`; the console's second address; tills show one line per box | a one-box venue keeps selling at `waitron.local`; nothing calls the lookup yet | no | no | full |
| **3b-3** | A joining spare's authority becomes the venue's, installed with its leaf, and marked; both resets empty `tls/` and `secrets.env` on a box that joined; every start checks the leaf's names and signer | no spare finishes joining yet; a main box's files are unchanged but for its leaf's added name | no | no | full |
| **3b-4** | Boxes reach and trust each other: the lookup in every box-to-box call, charts that vouch for every listed box (R13), a mirror that listens on the network with its open dashboard, its landing pages and its promotion kept to its own screen | no box has a counted peer before 3b-6, so the start check still proceeds | no (D16 judgement 1) | no | full |
| **3b-5** | The store on the spare and the pair's access key: `node_pair_link`, a joining route that needs no relay and refuses first, the spare passing each refusal on in its own words, the spare running versitygw behind a TLS listener that checks the main box's client certificate, the bucket screen and rotation refusing while a spare is joined | the store runs and receives nothing | no | **yes** (`node.db`) | full |
| **3b-G** | The start steps that decide whether a box files: the start check trusts only the venue authority (R12); the boot reconcile reaches a real box; a box with a lost `node.db` refuses to start (A1274) | no box has a counted peer or a mirror link to a real box before 3b-6, so on a real venue only the A1274 refusal can fire, and only on a box that holds a chart naming it but no mode row | **yes — the owner lands it** (D16) | no | full |
| **3b-6** | Joining brings the data: the main box streams to the spare and writes its `nodes` row when the store answers; the spare restores, places and checks its first copy and finishes joining; a two-box end-to-end test on a main box without Veri*Factu; the setup app's and the guide's words | a venue that does not file with Veri*Factu adds a spare end to end; a Veri*Factu venue is still refused before anything is reserved | no (D16 judgement 2) | no | full |
| **3b-F** | A Veri*Factu venue can add a spare (Q1 decides how); the stream loop's Veri*Factu box B gains its spare steps | lands last; until then the refusal of 3b-5 stands | **yes — the owner lands it** | no | full |

Why this order: names (3b-2) and the authority (3b-3) before trust, because 3b-4 and 3b-G pin
`tls/ca.crt` and find boxes by their own names; trust before data, because 3b-6's main box must
verify the spare and the spare the main box; the store before the stream; 3b-G before 3b-6, because
3b-6 makes a lost `node.db` dangerous; the Veri*Factu change last. The owner lands two PRs: 3b-G,
which can be ready as soon as 3b-4 lands, and 3b-F. The other six never wait for the owner, though
3b-6 waits for 3b-G to be on `main`. A venue with the Veri*Factu module switched off proves 3b-6 end
to end without 3b-F: the main box's own modules are what the join checks (D12), and with
`{"fiscal-verifactu": false}` the refusal does not fire, while the stream loop's
`{"fiscal-none": false}` refuses `module.operation_invalid` (probe P24).

## Which A1018 slices each 3b PR unblocks

A1018 Slices 0, 1, 2, 3, 4b, 5a and 9 have landed: Slice 0 is documentation (`945cdc7963`),
Slice 1 #2417, Slice 2 #2420, Slice 3 #2436, Slice 4b #2422 ("payments: one collection owner per
payment (A764)"), Slice 5a #2428 (the relinquished approval) and Slice 9 #2431. Slice 4 is #2442,
**open**, waiting for the owner (probes P20, P27). The A1018 plan itself says Slices 5–8 and 10–14
are reachable on real boxes only after A947 3b
(`docs/superpowers/plans/2026-11-02-a1018-handover-build.md:116-125`). "Reachable on real boxes"
means: two physical boxes, not the one-process simulation A1018's tests use. "4b" below always says
whose: A947's slice 4b (switching to the spare) or A1018's Slice 4b (payment collection). Read from
the A1018 plan, not run.

| A1018 piece | What stops it on real boxes today | Unblocked by |
| --- | --- | --- |
| Slice 3 (landed): the start check counts a joined spare | no box has finished joining (fact 2); the main box cannot verify the spare's signed answer (R13) and does not pin its certificate (R12) | 3b-4 (R13), 3b-G (R12), 3b-6 (the `nodes` row) |
| Slice 4 (#2442, open): the final copy served to the selected box | M2 asks M1 by a signed query (A1018 plan Task 4.8): it needs M1's own address, the lookup and trust, and M1 must know M2's key | 3b-2 (addresses), 3b-4 (lookup, trust, R13) |
| Slice 5: controlled handover, server | M1 cannot reach a mirror bound to loopback (fact 6); Task 5.3 refuses `handover.destination_unaddressable` while M2's chart address equals M1's; M1 cannot find M2 by name; M2 never finished joining | 3b-2, 3b-4, 3b-G, 3b-6 for a non-Veri*Factu venue. For a Veri*Factu venue: 3b-F, and — under Q1's default — the activation itself must first write the spare's dormant setup (fact 18), which neither the A1018 plan nor A947's 4b says today |
| Slice 6: controlled handover screens | the dashboard opens "M2's own handover page", which needs an address of M2's own | 3b-2 (the address), 3b-3 (its certificate). Whether each till platform finds a two-part `.local` name stays A947 4d's measurement |
| Slice 7: emergency handover, server | as Slice 5, plus a copy on M2 | as Slice 5; the continuous copy is 3c |
| Slice 8: emergency declaration page | reached at M2's own address | 3b-2, 3b-3; passkeys there wait for A947 4b/4d (A1018 decision 9, `2026-11-02-a1018-handover-build.md:322-323`) |
| Slices 10–11: the return batch | M1 ↔ M2 calls over the venue's network, after a handover | 3b-4 for the calls; a handover first needs Slices 5 or 7, so as those |
| Slices 12a–12b: the reconciliation list and the VAT return line | nothing of their own on the network: they act on what Slice 11 returned | reachable when Slices 10–11 are |
| Slice 13: becoming the spare | the returning box must join as a spare | 3b-6; for a Veri*Factu venue also 3b-F |
| Slice 14: a last copy from a selected backup | it places a backup as the copy of a spare (`2026-11-02-a1018-handover-build.md:3705-3713`), so it needs a joined spare | 3b-6; for a Veri*Factu venue also 3b-F |

## The backlog items this plan was asked to place

| Item | Taken? | Where, or why not |
| --- | --- | --- |
| R13, "A947 3b must make the held chart vouch for a joined box's key…" (`docs/backlog.md:5736`) | **yes** | Task 4.4 (endorsements in every chart) and Task 5.4 (the first chart naming the spare carries its endorsement). Own addresses: Task 2.1 |
| "The boot peer reconcile cannot reach a real box's certificate" (`docs/backlog.md:5746`) | **yes** | Task G.2 |
| A1273, key ring rotation | **yes, as a rule** | Decision D7, Task 5.10 |
| A1274, a lost `node.db` reads as a sole primary | **yes** | Task G.3 — 3b makes it reachable (fact 16) |
| A1275, a Cloud peer's chart is refused | no | Cloud work; no Cloud peer signs charts |
| A1276, after two promotions in a three-box venue | no | needs three boxes; go-live is two |
| A1277, a malformed chart signed by a trusted key is copied on | no | 3b does not change how a chart's `nodes` entries are read or copied |
| A1278, the joining route spends a reservation on a chart it then refuses | **yes** | Task 5.3 moves every refusal before the reservation; this one joins them |
| A1279, a local secondary promotes only over its own chart | no | no production caller |
| A1280, a retried join leaves the abandoned id's `node.db` rows | **yes** | Task 5.5, driven by `NODE_CLASSIFICATION` |
| A1281, the venue command reads a missing `node.db` as version 0 | no | a command-line path 3b does not touch |
| A1282, the Servers screen's fingerprint is stale after a repair | no | 3b does not change the fingerprint line or the repair. Review Focus 5 names the related risk |
| A1283, no guide page covers adding a spare | **yes** | Task 6.10: `guide/en/servers.md` exists since A1018 Slice 2 (#2420) with three sections; 3b adds "Adding a spare box" in English and Spanish |
| A1284, an environment-set vault key | no | no production box sets it (`deploy/` names none, per the entry) |
| A1285, the staged reset and `secrets.env` | **partly** | Task 3.2: on a box that joined, the staged reset now removes `secrets.env` (fact 19). The entry's other cases are untouched |
| A1295, the venue authority pair in backups | **yes, by removal** | Task 3.1: a joined spare's authority becomes its `tls/ca.crt` and `tls/ca.key`, which backup verification already checks as a pair; `venue-ca.*` go |
| A spare's backup settings (the owner's answer of 2026-11-04, A1018 Slice 5's Ruling O3): joining gives `backup.env`, later changes follow, and a spare that was off catches up | **not yet planned here** | No task carries it yet. It is still to be written, docs-only, before 3b-1 starts, saying how it relates to A1273's key ring (Decision D7). Until it lands, the offer refuses `handover.backup_settings_differ` on a venue with a recovery key, the main box still selling |
| A1296, code-quality follow-ups from 3a | no | none is on 3b's path except the hand-written HTTPS client; 3b extends `boxExchange`; `boxDownload` is D4's one exception |

---

## Decisions made in this plan

- **D1 — Each box's own name is `box-<first four characters of its node id>.waitron.local`**, for
  example `box-7f3a.waitron.local`. The design's example was `equipo-7f3a` and left "the exact
  form" to the builder (§4 item 5); CLAUDE.md §3 makes general code English only. The box's own
  **contact URL** is its advertised origin with the host `waitron.local` replaced by that name; an
  origin with any other host (a development or Cloud profile, which already names each server by its
  own origin) is left as configured. A joining spare whose name equals a listed box's is refused
  `mirror.standby_name_taken` before anything is reserved; pressing Connect again draws a new node
  id (`adopt.ts:105`).
- **D2 — The main box's own chart row carries its own name too.** The first setup seeds it, a
  rebuild rewrites it, and the joining route rewrites the signer's row when it still holds the old
  value. No code converts existing charts (CLAUDE.md §3, pre-live).
- **D3 — Who answers `waitron.local`, and how a box looks a name up.**
  - A **full start that accepts sales** answers its own name and `waitron.local`.
  - The **waiting start** answers both too (review I2): it is the box that sells once its wait
    ends, and its page at `/` (`waiting-page.ts:95`) holds "Carry on as the main box"; a till that
    reloads while the spare is off reaches it at the address it always uses. Cost: in a split
    network where the spare sells and the waiting box cannot reach it, a device can see both
    answers; the waiting box serves only its waiting page, so it never sells beside the spare.
  - A **box in setup mode** answers `waitron.local` only while it hears no other box answer it: it
    asks once as it starts and again after 30 seconds plus a random delay of up to 10 seconds, each
    time drawn afresh, and answers only while its last ask heard no answer but its own. The first
    box of a venue is still reached at the printed `http://waitron.local/setup/trust`
    (`deploy/waitron.sh:465`), which is why setup mode keeps answering at all. A second box answers
    nothing of its own (it has no node id, so no own name, yet) and is reached at its own address,
    which the console now prints too (Task 2.4). The random delay is there because two boxes asking
    at the same moments stay in step for ever, both answering, then neither, every 30 seconds: in a
    simulation of the rule (probe P25), two boxes switched on within 2 seconds of each other were
    still doing that after 10 minutes in 1,909 of 2,000 runs without the delay, and in none of 2,000
    with it. Cost, from the same simulation, not run on boxes: two fresh boxes switched on together
    can both answer for a few minutes (the last moment both answered was at most 339 seconds in,
    median 37); neither sells. A second cost: while the main box is not answering `waitron.local` —
    restricted, or stopped for an update — a box in setup mode nearby answers it, so a till that
    reloads then can reach that box's setup pages instead of the main box until its name cache
    expires. Nothing sells twice; read, not run.
  - **Every other start** — the latch start, a mirror, restricted, fenced — answers only its own
    name.
  - **A lookup ignores answers carrying this box's own addresses** and collects every answer within
    its time limit (2 seconds), so a box never finds itself (review C1, probes P13, P14).
  - **Tests of the starts' answers bind `0.0.0.0` and inject the socket**: the responder is off on a
    loopback-only listener (`mdns.ts:55`), so a boot test that binds loopback sees no answers at all
    (`boot.mirror.test.ts:495` already binds `0.0.0.0`).
- **D4 — Box-to-box calls use one transport** (with one exception since A1018 Slice 5: `boxDownload`
  beside it opens its own request for the final copy, and Task 4.1 must reach it too): `boxExchange` (`mirror-bundle-fetch.ts:117`), with
  the mDNS lookup for `.local` names and the venue authority pinned. Each address the lookup returns
  is tried in turn under the pin, so a false answer from another device costs one failed connection,
  not the call. Every box holds the venue authority as `tls/ca.crt` after Task 3.1, so every
  box-to-box call can pin it. R12: Task G.1 removes the start check's unchecked branch
  (`boot-peer-check.ts:353`); the certificate read before the person confirms it
  (`fetchPrimaryCertificate`, `mirror-bundle-fetch.ts:189`) stays unchecked by design — they are the
  only two (`grep -n "rejectUnauthorized: false"` over `apps/server/src`, tests aside). Task 4.1
  keeps each call's trust as it is. (Revision 3 said Task 4.1 removed an unchecked path; it does
  not.) Cost: a box whose operator supplied certificate files of their own
  (`config.tls`) cannot verify a peer; no box is set up that way.
- **D5 — The stream to the spare travels through two byte pipes** (fact 12): Litestream and
  versitygw speak plain HTTP on loopback only; Node carries the bytes over TLS between the boxes,
  pinned to the venue authority, with the spare's name as the certificate name. Chosen over
  `SSL_CERT_FILE` because it works the same on the box and on a developer's Mac (probes P7–P9),
  because a failure is logged by our code instead of retried silently (probe P7), because the main
  box finds the spare by mDNS for every connection, and because `@waitron/stream` needs no change:
  the target is an ordinary bucket setting with an `http://127.0.0.1` endpoint, which
  `readBucketConfig` already accepts (`packages/stream/src/bucket-config.ts:25-35`). **The store's
  listener requires a client certificate** under the venue authority naming the paired main box
  (review I9): the pair's key reads the whole database, so nobody else on the venue's network
  reaches versitygw's parser at all. Today's leaf cannot serve (fact 21), so each box gains a
  client certificate of its own, `tls/client.crt` and `tls/client.key` (Task 5.8).
- **D6 — The main box writes the spare's `nodes` row when the spare's store first answers it**, not
  when it hands out the bundle. A join abandoned between the two leaves a chart entry, as today, and
  no counted peer, so the main box does not start waiting at every start for a box that never
  arrived (A1018 Slice 3 counts only boxes with a row). The row is written before the stream starts,
  so the first full copy carries it.
- **D7 — A1273: no key ring rotation while a spare holds the ring.** `waitron-credentials rotate`
  refuses `credentials.rotation_spare_joined` while this box holds a pair link (Task 5.10), and the
  rule is written where rotation is already described (`conventions-data.md:928`; fact 15). A spare
  that never finished joining can be removed under Servers, which deletes the link (Task 5.9), and
  the ring can then be rotated. A spare that finished joining cannot be removed in this version
  (fact 26), so while it is joined the ring is not rotated at all; revision 2's "remove the spare,
  rotate, add it again" was not possible. A ring changed by hand in `secrets.env` cannot be stopped
  by the command; the pair link records the ring version handed to the spare, so 3c's spare alerts
  can warn when they differ. Reasons: a rotation is an operator's terminal act with no product
  screen; pushing a ring needs its own secret channel and a restart of the spare; and go-live does
  not rotate.
- **D8 — A mirror listens on the venue's network, and this is everything it serves there.**
  `assertMirrorBindSafe` and `WAITRON_MIRROR_ALLOW_EXPOSED` are retired. From any address that is not
  the box itself (`requestFromBox`, `request-from-box.ts:40`), a mirror serves:
  1. every `GET`, `HEAD` and `OPTIONS` request the read-only gate lets through
     (`read-only-gate.ts:17`) to a route a full start mounts, each under its own check (a session
     cookie, a device token, or none for `/health`, `/api/node`, the guide pages and the certificate
     downloads). The ambient dashboard session attaches only to a request from the box itself, so a
     dashboard read from elsewhere is refused as signed out; there is no sign-in on a mirror, because
     the read-only gate refuses its `POST` (fact 22). A `GET` answered under a till's or a person's
     existing token reads the join-time copy (D10);
  2. `POST /api/node/peer-status` and `POST /api/node/membership`, which answer only signed
     requests and signed charts (`read-only-exemptions.ts:39-52`);
  3. **not** `POST /management-api/promote` or `/promote/preparation`: on a mirror they answer only
     the box itself, and anyone else is refused `promotion.from_box_only` (review I1), until A947's
     4b and A1018 Slice 7 replace them with the take-over that checks the main box is gone first. Without
     this, after 3b-6 a manager's password on the venue's network could switch a spare holding a
     join-time copy on beside a live main box (anti-goal 1);
  4. the store's port 7443, to the paired main box's client certificate only (D5);
  5. mDNS answers for its own name only (D3);
  6. **nothing on the landing port.** The plain-HTTP landing app (fact 25) is a second listener the
     read-only gate does not cover, with two unauthenticated `POST` routes, and a repair there would
     reissue the leaf for the names the landing app hands it, the venue's only (`boot.ts:873`,
     `box-tls-repair.ts:277,346,352`), dropping the spare's own name until its next start. Every
     start a spare makes runs it on `127.0.0.1` only, through one helper (`landingHostFor`, Task
     4.5b): the latch start always (only a joining spare makes one, fact 25), and the time-zone
     repair start and the full start when the box is a mirror (`isMirror`, `boot.ts:1954`, set
     before both). The spare's own screen keeps the pages and the network reaches none of them. A
     device trusts the spare through the main box's trust page: since 3b-3 both carry the same
     authority. (Revision 3 covered the mirror's full start only.)
  7. **A joining spare** (the latch start, which it makes from adopt until it finishes joining, and
     for good if its store never answers, D17) serves the network only `/health`,
     `/api/box/status` (with Task 6.3's copy progress), `POST /api/node/peer-status` and
     `POST /api/node/membership` (signed requests only, as item 2), the store's port to the paired
     main box's client certificate only (Tasks 5.7, 5.8), and mDNS for its own name (D3); every
     other path answers 404, because the latch start mounts nothing else (`boot.ts:1695-1704`).
  Task 4.5b's test walks every route a mirror's full start mounts and every route the latch start
  mounts, from a non-box address with each method, and checks them against items 1–3 and 7; and it
  checks the landing listener's bound address in all three starts named in item 6. So the list is
  run, not only read. The Cloud tunnel, which hands connections to
  `127.0.0.1` (`packages/tunnel/src/client.ts:41,89`) and so would count as the box, runs only on
  the one main box (`boot.ts:3291`), never on a mirror.
- **D9 — The spare's certificate authority becomes the venue's, installed whole and marked.** At
  joining, adopt's **first write after `beforeFirstWrite`** is `tls/joined.json` (the main box's
  node id, written durably) — before `stampDeployment` and before the main box's key ring replaces
  this box's `secrets.env` (`adopt.ts:166-168`). Later in adopt, the bundle's authority and a leaf
  it issues from it for this box's names are written, all four under working names, then a durable
  `tls/install.json` listing them, then each is renamed into place (`ca.key`, `ca.crt`,
  `server.key`, `server.crt`), then `install.json` is removed. Every start finishes a listed
  install before it reads `tls/`, and deletes working files no list names. `tls/venue-ca.*` are no
  longer written. This makes D4's pin one file on both boxes and retires A1295. Because the marker
  comes before the ring, a join that stops at any later point leaves the marker, so both resets
  remove the old venue's ring and authority (D13); a join that stops before it leaves the box's own
  ring and authority, which a reset then empties harmlessly. (Revision 2 wrote the marker inside
  the authority install, after the ring.)
- **D10 — 3b restores the first full copy once; 3c follows.** In the latch start the spare restores
  the newest point of the stream from its own store into a scratch file, checks it, and the next
  start puts it in place of its `venue.db`. Until 3c, the spare's `venue.db` stays as it was at that
  moment, while its store keeps receiving every change.
- **D11 — The store's port is 7443** (`WAITRON_SPARE_STORE_PORT`, a new setting with that default),
  on the spare's listening address. Nothing in the tree uses 7443 (`git grep -n 7443 -- deploy
  apps/server/src/config.ts` printed nothing).
- **D12 — The joining route checks a Veri*Factu venue on the main box, before reserving.** Until
  3b-F lands, the main box's own route refuses with today's code, `module.operation_invalid`
  `{ module }`, answering 409 (a new row in `mirror-bundle-api.ts`'s `STATUS`), so a refused join
  leaves no chart entry and no reservation. The spare passes the code on (Task 5.6b), and its own
  adopt route already answers that code with 409 (`setup-api.ts:291`; the existing 409 in
  `adoption-allocation-refusal.test.ts:173-197` comes from the spare's own check after the fetch,
  which stays). Its words (Task 5.6) say nothing was changed and what Back does.
- **D13 — Resetting a box that joined another empties `tls/` and removes `secrets.env`.** Both the
  staged reset and `waitron.sh reset` do this when `tls/joined.json` exists (the staged reset runs
  only after a join, so for it the marker is a check, not a choice). Both files hold the old venue's
  secrets: the authority every one of its tills trusts, and the key ring that opens its sealed
  credentials (fact 19). Emptying both lets the next setup start mint a fresh set (fact 20, probe
  P18). Cost: devices that trusted this box must trust it again before it is set up anew. A box
  that never joined keeps both, as today.
- **D14 — The first-copy figure is measured by the owner, after 3b-6, and 3b lands without it.**
  `ms` runs from the spare's pair link `created_at` until the spare holds a verified copy. Adopt
  writes the link (Task 5.5) inside the Connect request, after the bundle has been fetched
  (`setup-api.ts:1060` awaits adopt within the request), so `ms` starts a few seconds after Connect
  is pressed, not at the press. Both ends are read on the spare's own clock, so no difference
  between the two boxes' clocks enters; the end is the moment Task 6.3's checks pass. `bytes` is the copy's
  size. The spare logs both in `spare.first_copy_ready` and shows them on its box status. The
  backlog entry "Adding a mirror while the internet is down" stays open until the measurement is
  recorded (Task 6.11).
- **D15 — The spare tells the main box where its store is.** The joining request gains
  `standbyStoreUrl` beside today's `standbyContactUrl` (`mirror-bundle-fetch.ts`, the request body;
  `mirror-bundle-api.ts:80-113`, the check). Adopt sends `https://<this box's own name>:<its
  WAITRON_SPARE_STORE_PORT>` (Task 5.5); the main box refuses `mirror.standby_invalid` (as for a bad
  contact URL) unless it is an `https` bare origin whose host equals the contact URL's host, and
  writes it into its pair link (Task 5.4). So the port is the spare's own setting, never assumed by
  the main box, and three servers in one test process each use their own drawn port (Task 6.8b).
- **D16 — Which PRs are FISCAL, and the one judgement.** House precedent: A1018 Slice 3, "decides,
  before the first filing pass, whether a box may file", is FISCAL in its plan
  (`2026-11-02-a1018-handover-build.md:599`) and landed so, by the owner (`4fd28f1b38`, #2436);
  Slice 2's restricted start, which stops a filing box, also landed with a FISCAL title (#2420,
  probe P26). By that rule, a PR that changes a start step deciding
  whether a box files, or adds a start refusal meant to stop a box filing, is FISCAL and waits for
  the owner. Three tasks clearly do that, and they form **3b-G**: Task G.1 (what the start check trusts,
  R12), Task G.2 (the boot reconcile, which can demote a box at start so that it stops filing,
  `boot.ts:1904-1909`; the round-3 check did not name this one, and it is included by the same
  rule) and Task G.3 (a lost `node.db` refuses to start, so the box neither sells nor files).
  Isolating them keeps 3b-4, 3b-5 and 3b-6 autonomous. **Two judgements** keep two tasks that touch
  the start check out of 3b-G; the owner may overrule either.

  **Judgement 1, Task 4.1 (3b-4).** The start check sends every peer query through `boxExchange`
  (`boot-peer-check.ts:344-357`), and Task 4.1 makes `boxExchange` find a `.local` name by the mDNS
  lookup. So it changes how the start check reaches a peer, as Task G.2 does for the boot reconcile
  — and by the rule above it would belong in 3b-G. A peer the check asks without counting (a box
  this one demoted, `boot-peer-check.ts:135-136`) can answer that this box was superseded, which
  stops it filing (`:218`); before Task 4.1 a `.local` peer is never reached in the box image (fact
  7), so such an answer cannot arrive. It stays in 3b-4 because `boxExchange` is also what the
  spare's setup uses to find the main box: moving it would put the joining path of 3b-4 and 3b-5
  behind the owner's landing. In practice its effect on the start check before 3b-6 is small: until
  3b-2 every box's address is `https://waitron.local`, which the check skips as its own address,
  and no box has a counted peer before 3b-6 (round-4 claim check, I2; read, not run). 3b-4's PR body
  says in its first line: "From this PR, a box's start check can reach another box listed by a
  `.local` name, so an answer from such a box can now stop it filing at start; nothing else in the
  check changes." If the owner reads that as a fiscal change, 3b-4 is relabelled and waits for the
  owner.

  **Judgement 2, Task 6.2 (3b-6)** writes
  the spare's `nodes` row, after which the landed start check counts the spare, so a main box with
  a silent spare waits at its start. That is the rule the owner already landed (CLAUDE.md §5: a box
  "asks it by signed query before selling or filing, and waits while every box it counts is
  silent"); Task 6.2 changes neither the check's code nor its rule, so 3b-6 is not labelled FISCAL.
  3b-6's PR body says in its first line that from this PR a main box with a joined spare waits at
  start while the spare is silent. If the owner reads that as a fiscal change, 3b-6 is relabelled
  and waits for the owner; nothing else in the cut moves.
- **D17 — One spare per venue in 3b, and an unfinished join can be cleared.** The pair link holds
  one row per box (`node_id` is its key), so a second spare would replace the first's link. The
  joining route refuses `mirror.spare_already_joined` (409) while this box's link is `streaming`,
  before anything is reserved (Task 5.3). A link still `pending` belongs to a join that never
  finished; a new join replaces it, as Task 6.2 states, and Remove under Servers deletes it with
  the standby's chart entry (Task 5.9; Remove accepts a standby with no `nodes` row, fact 26). So
  a `pending` link never blocks the venue for good. While one exists, Task 6.2 keeps asking the
  missing store every 5 seconds; that costs one failed connection per ask and stops when the link
  is replaced or removed. **A limit 3b makes reachable and does not lift:** a spare that finished
  joining and then dies for good, or loses its `node.db` and is started again (Task G.3), stays a
  counted standby that no screen can remove (fact 26) and no second spare can replace. Under the
  landed start-check rule the main box then waits at every start until an administrator carries on
  for that start (CLAUDE.md §5; traced through `boot-peer-check.ts:137,219-223` and `boot.ts:1821-1833`
  by the round-4 claim check, and its two cases pass: the same chart proceeds without the spare's
  `nodes` row and waits with it, probe P29). The session running this plan
  adds a backlog entry for a way to retire a joined standby (Task 6.10), and the guide says what
  to do meanwhile.

## Departures from the approved design

Each is also listed, one line each, in the design's dated A947-3b pointer, rewritten for this
revision in the same commit. Only the first awaits the owner; the rest are stated here so the owner
can refuse any of them.

| # | Design text | What this plan does instead | Why | Awaits the owner? |
| --- | --- | --- | --- | --- |
| 1 | §11: 3b is "Not fiscal" | 3b has two owner-landed PRs: 3b-G (the start steps that decide whether a box files, D16) and 3b-F | today's code refuses a spare in a Veri*Factu venue (fact 1); 3b-G by the house's labelling of A1018 Slice 3 | **yes — Q1** for 3b-F; 3b-G is FISCAL by precedent, and the owner lands it. Under Q1's default (c), §4 item 3 ("No fiscal identity is reserved at joining") holds as written, and the switch-on writes the dormant setup; under (b) §4 item 3 changes |
| 2 | §4 item 5: `equipo-<id>.waitron.local` | `box-<id>.waitron.local` (D1) | English-only code (CLAUDE.md §3); the design left the form to the builder | no |
| 3 | §3: the stream travels "over TLS under the venue's certificate authority" | the TLS is Node's, between two byte pipes; Litestream and versitygw speak only on loopback (D5) | Litestream cannot pin an authority on macOS and logs nothing when it cannot connect (fact 11) | no |
| 4 | §3: the store "accepts only the access key minted for this pair" | it also requires the main box's client certificate (D5) | the key reads the whole database; nobody else should reach the store at all | no |
| 5 | §4 item 5: `waitron.local` "answered only by the box that sells" | also by the waiting start, and by a box in setup mode while no other box answers (D3) | a reloaded till must find "Carry on as the main box" (§6.6's anti-goal); the first box's setup is reached at `waitron.local` | no |
| 6 | (not in the design) the exposed-mirror guard | retired; a mirror listens on the network with the surface D8 lists; promotion on a mirror only from the box itself until A947's 4b | §5 needs the spare reachable; the open dashboard and promotion must not be | no |
| 7 | (not in the design) a lost `node.db` | the box refuses to start, with recovery words (Task G.3, in the owner-landed 3b-G) | 3b makes a selling spare reachable (fact 16) | no |
| 8 | §4 item 1: a rotation's previous key travels in the bundle | rotation is refused while a spare holds the ring; a spare that finished joining cannot be removed in this version, so its venue does not rotate (D7) | nothing sends a new ring to a spare | no |
| 9 | (not in the design) resets | a box that joined another empties `tls/` and `secrets.env` on reset (D13) | otherwise a reused box keeps the old venue's authority and key ring | no |
| 10 | §11: the first full copy "measured on 0.5.17 with the internet unplugged" in 3b | the owner measures it after 3b-6 lands; 3b's PRs land without it; the backlog entry stays open until then (D14) | the measurement needs two real boxes, which no implementer has | no |
| 11 | §11: "every slice adds its step to the stream loop test" | 3b-6's two-box steps run in a new file, `spare-join.e2e.test.ts`, on a main box with the Veri*Factu module switched off; the stream loop's box B gains its spare steps in 3b-F (Task F.2b) | the loop's box B files with Veri*Factu, so its join is refused until 3b-F (probe P24); a test that cannot pass when its PR lands is not planned | no |
| 12 | (not in the design) how many spares | one spare per venue in 3b: a second join is refused while one is joined (D17) | the pair link holds one row per box | no |

Not a departure: §4 item 5 says joining prints a QR label for each box; §11 places the labels in 4d,
and 3b leaves them there.

## Global Constraints

- **Pre-live: no backwards-compatibility or data-migration code** (CLAUDE.md §3). No reader of
  `tls/venue-ca.*`, of `mirror.no_relay` or of an old chart's `waitron.local` row is kept.
- **Every `node.db` table is `local`, keeps a `node_id` column, and every read and write names it**;
  no foreign key into or out of `node.db` (CLAUDE.md §3).
- **Across the two files: take `node.db`'s write lock outside `venue.db`'s; save `venue.db` first and
  `node.db` after**, so a re-run repairs `node.db` (CLAUDE.md §3). Task 6.2's join step states it at
  its site.
- **Secrets stay sealed.** The pair's secret key is sealed under the key ring in `node.db`, bound to
  the box's and the peer's node ids; it reaches versitygw through its environment, never its
  command line (fact 13), and never a log line.
- **Nothing external may block a sale** (CLAUDE.md §5): the stream to the spare never waits on the
  spare to sell; the main box's `backup.stream_behind` rule applies to it unchanged.
- **Error codes.** New, each registered in `apps/server/src/errors.ts` (or the throwing package's
  `errors.ts`) and imported by the throwing file (`scripts/errors-reachable.test.ts`):
  `mirror.standby_name_taken`, `mirror.bucket_stream_active`, `mirror.spare_already_joined`,
  `backup.spare_stream_active`,
  `credentials.rotation_spare_joined`, `node.state_missing`, `promotion.from_box_only`, and the
  log-only `mirror.peer_unresolved`, `spare.join_key_mismatch` (a fault in Waitron) and
  `spare.store_client_refused`. Retired: `mirror.no_relay`, `server.mirror_bind_exposed`
  (`errors.test.ts:175-177` and `boot.mirror.test.ts:491` change with them; rows in Tasks 4.5a, 5.4).
  Words go where each surface keeps them: the setup app's `ADOPT_ERROR_MESSAGES`
  (`apps/setup/src/setup-app.ts:254-264`) and `i18n/strings/shell.ts`; the dashboard's
  `apps/dashboard/src/i18n/codes.ts` (with `codes.test.ts`); the recovery page's
  `apps/server/src/i18n/recovery-page.ts`. Every word a person sees is written, in English and
  Spanish, in this plan, beside its task.
- **A new box-to-box route or duty**: a duty a full start runs is registered in
  `apps/server/src/background-duties.ts` with its stop, signalled at a stepdown or carrying a reason
  (guard: `handover-stepdown.test.ts`, "every closer is either atStepdown or carries a reason").
- **Tests that start versitygw or Litestream** skip locally without the binaries and fail in CI
  (the existing rule, `stream-loop.e2e.test.ts:1-6`), and run in the stream job.
- **Changed test checks**: every `expect(` line or test title a PR changes has a row in that PR's
  "Changed checks" list, written before the code. The rows known now are listed in each task; a
  changed line with no row is a STOP.
- **Tasks are sized for one implementer, about 60 tool calls or fewer.** An implementer past about
  150 calls with the task unfinished stops at a passing or cleanly failing point, commits, and
  returns a handover (its `implementer` definition carries this).
- Plain English in comments, commit messages and PRs; every commit `git commit -s`; run Vitest under
  `env -u AI_AGENT -u CLAUDECODE` when you need a passing test's output, and read the `Tests` count.

## Review Focus

1. **A join that stops half-way.** The spare loses power after the main box handed out the bundle
   but before its store answered: the main box must hold no `nodes` row for it, start without
   waiting, and a second join (new node id) must work. Test: Task 6.2, "a pending spare whose store
   never answers is not a counted peer".
2. **A spare whose `node.db` is lost after it finished joining** must not start as a selling,
   filing box (fact 16). Test: Task G.3, with the control that a first box with no mode row still
   starts.
3. **A store that rejects the main box** (wrong key, wrong certificate, no client certificate) must
   show up in the main box's stream status within one minute, not retry silently (probe P7). Test:
   Task 6.1.
4. **The spare's disk**: the store keeps Litestream's week of history
   (`packages/stream/src/litestream.ts:79-80`, `retention: 168h`) on the spare's disk beside its own
   copy. A full disk on the spare must stop the store, not the main box's sales. Test: Task 6.1.
5. **A box whose certificate authority changes** (a connection repair, `box-tls-repair.ts`) while a
   spare is joined breaks the pair's trust. 3b does not build a repair for this; Task G.1 makes the
   refusal visible.
6. **A box that finds itself.** A joining box with its own responder still answering, typing
   `https://waitron.local`, must reach the main box (Tasks 2.2, 4.1).
7. **A reused box.** After either reset of a box that joined another, no file of the old venue's
   authority or key ring remains, including after a join that stopped just after the key ring was
   written (Tasks 3.1, 3.2).
8. **A refusal the person cannot read.** Every refusal the main box gives a joining spare reaches
   the setup screen as its own words, not "couldn't join" (Task 5.6b, through the real fetch).

---

## File structure

- **`deploy/`**: `Dockerfile` (a `versitygw` stage, a copy into the runtime), `third-party/versitygw/`
  (`NOTICE`, `NOTICES.txt`), `third-party/README.md` (a section), `waitron.sh` (the second setup
  address; the reset of a joined box), `README.md` (the reset paragraphs).
- **`scripts/`**: `versitygw-pin.test.ts` (new); `go-binary-notices.mjs` (Litestream's generator,
  taking the program's name); `deploy-image-env.test.ts`; `ci-workflow.test.mjs`
  (`STREAM_TEST_FILES`: Task 5.7's store case and Task 6.8b's `spare-join.e2e.test.ts`);
  `waitron-sh.test.mjs`; `personal-log-params.test.ts` (the `mdns.responding` row, Task 2.3a);
  `write-path-tables.json` (`node_pair_link`); `backup-room-note.test.ts` and `spare-space.test.ts`
  hand lists (Task 6.4).
- **`.github/workflows/`**: `image-smoke.yml` (versitygw's version), `ci.yml` (Task 5.7's store
  case and Task 6.8b's two-box test in the stream job and the server shards' excludes,
  `ci.yml:1177,1312-1323`).
- **`packages/node-db/`**: `src/schema/node-pair-link.ts`, `drizzle/0002_*.sql` (generated),
  `src/classification.ts`, `src/pair-link.ts` (readers only), `src/index.ts`; delete helpers in
  `mode.ts`, `mirror-link.ts`, `recovery-key.ts`, `primary-key.ts`.
- **`packages/credentials/`**: `src/node-pair-link.ts` (the writers, which seal, and the pair link's
  delete helper — the file `write-path-tables.json` names for the table, Task 5.2), a delete helper
  in `src/node-signing-key.ts`, `src/cli.ts` (rotate).
- **`apps/server/src/`**: new `box-name.ts`, `box-lookup.ts`, `box-tls-install.ts`,
  `spare-store.ts`, `spare-pipe.ts`, `spare-join.ts`, `spare-copy.ts`, `spare-copy-placement.ts`,
  `boot.mirror-surface.test.ts`, `spare-join.e2e.test.ts`, `testing/spare-join-scenario.ts` and
  `testing/stream-box.ts`;
  changed `adopt.ts`, `mirror-bundle.ts`, `mirror-bundle-api.ts`, `mirror-bundle-fetch.ts`,
  `finish-adoption.ts`, `reserved-identity.ts`, `membership-mint.ts`, `membership-reconcile.ts`,
  `membership-seed.ts` callers, `rebuild-first-start.ts`, `start-peer-check.ts`,
  `boot-peer-check.ts`, `mdns.ts`, `mirror-session.ts`, `promote-api.ts`, `box-secrets.ts`,
  `self-signed-cert.ts`, `backup-optional-state.ts`, `reset-request.ts`, `stream-host.ts`,
  `stream-api.ts`, `membership-removal.ts`, `boot.ts`, `config.ts`, `errors.ts`,
  `i18n/recovery-page.ts`, `setup-api.ts` (`ADOPT_STATUS`), `testing/stream-loop-scenario.ts`
  (its box provisioning shared with the two-box scenario, Task 6.8b; its spare steps, Task F.2b);
  `mirror-bind-guard.ts` and its test
  deleted; `guide/en/servers.md` and `guide/es/servers.md`.
- **`apps/till/src/api/server-router.ts`**; **`apps/setup/src/`** (refusal words, the joined
  screen); **`apps/dashboard/src/i18n/codes.ts`** (the bucket refusal, the promotion refusal).
- **`docs/`**: `docs/developers/conventions-data.md` (the store, the pair link, the rotation rule,
  the resets), `docs/backlog/replication-cloud.md` (Task 6.11, by the session running this plan).

---

## PR 3b-1 — versitygw ships in the box image

Light review path. No server code.

### Task 1.1: The pinned versitygw in the image, with one pin

**Files:** Modify `deploy/Dockerfile` (a `versitygw` stage after the `litestream` stage, shaped like
it: `version=1.8.0`, the `linux-x64` and `linux-arm64` sums from `scripts/setup-s3-test-server.mjs:24-31`
under Docker's `amd64`/`arm64` names, `sha256sum -c`, `tar` of `<name>/versitygw` only, then
`test "$(versitygw --version | sed -n …)" = "${version}"`; in the runtime stage
`COPY --from=versitygw /usr/local/bin/versitygw /usr/local/bin/versitygw`),
`.github/workflows/image-smoke.yml` (run `docker exec "$app" versitygw --version` and compare with
the pin, beside the Litestream step at `:270-285`). Create `scripts/versitygw-pin.test.ts`, as
`scripts/litestream-pin.test.ts`; `apps/server/src/testing/s3-test-server.ts:20` keeps its copy of
the version (`scripts/setup-s3-test-server.test.mjs:234-240` reads that line as text), and the pin
test holds the copies equal; Task 5.7 adds the server's own copy to it.

- [ ] **Step 1: Write the failing test** `scripts/versitygw-pin.test.ts`: "names one version in the
  setup script, the test server and the box image"; "checks the same Linux checksums in the box
  image and the setup script"; "image-smoke runs the binary and compares it with the pin" (reads the
  workflow as text). Its header says it reads text and is weaker than its name, as the Litestream
  one does.
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/versitygw-pin.test.ts` from the root — FAIL: no
  `versitygw` stage.
- [ ] **Step 3: Implement.** The `apt-get` rule does not apply (no apt in this stage); the download
  uses `curl -fsSL` as the Litestream stage does.
- [ ] **Step 4: Run** it — PASS; then `pnpm exec vitest run scripts/litestream-pin.test.ts
  scripts/ci-workflow.test.mjs scripts/deploy-image-env.test.ts`, and build the image once
  (`docker build -f deploy/Dockerfile .`, recording its id) to see the stage's own version check
  pass; record the image's size before and after (the linux-arm64 binary is 54489706 bytes, probe
  P10).
- [ ] **Step 5: Commit** `git commit -s -m "image: ship the pinned versitygw, the store a spare box will run"`.

### Task 1.2: Its licence notices, and final checks

**Files:** Create `deploy/third-party/versitygw/NOTICE` (the tarball's `NOTICE`, unchanged) and
`deploy/third-party/versitygw/NOTICES.txt` (the Go modules built into the binary, generated as
Litestream's are). Generalise `scripts/litestream-notices.mjs` into `scripts/go-binary-notices.mjs`
taking the program's name and version for its header line (`<Name> version: <v>`), keeping
Litestream's output byte for byte; modify `deploy/third-party/README.md` (a `## versitygw` section:
the version, the release URL, the checksum check, Apache 2.0 with `licenses/Apache-2.0.txt`,
`versitygw/NOTICE`, `versitygw/NOTICES.txt` and the command that regenerates it),
`scripts/deploy-image-env.test.ts` (a block like the Litestream one at `:1048-1098`), and
image-smoke (`grep -qx "versitygw version: $pinned" /app/third-party/versitygw/NOTICES.txt`). Go is
not installed on this Mac (probe P12): run `go version -m` in a `golang` container on the pinned
Linux binaries, and say so in the README's regeneration steps.

**Changed checks:** `scripts/deploy-image-env.test.ts` "names no version in the notice but
libvips's, Litestream's and Iosevka's" (`:1062-1067`) — the set gains versitygw's version; the title
names it (the expected value changes).

- [ ] **Step 1: Write the failing tests** in `deploy-image-env.test.ts`: "names the pinned
  versitygw, and only that version, in its section of the notice"; "ships versitygw's NOTICE and the
  notices of what the binary bundles, generated for the pinned version"; "image-smoke checks the
  shipped notice". In the generator's test: "writes the program's own name in the header" and
  "writes Litestream's notice unchanged".
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/deploy-image-env.test.ts scripts/litestream-notices.test.mjs`
  — FAIL.
- [ ] **Step 3: Implement**; regenerate both notice files and check `git diff --stat
  deploy/third-party/litestream/` prints nothing.
- [ ] **Step 4: Run** them — PASS; then `pnpm format:check`.
- [ ] **Step 5: Commit** `git commit -s -m "image: versitygw's licence and the notices of what it bundles"`.
  Then `/finish-branch` on the light path.

---

## PR 3b-2 — each box's own name, and who answers the venue's

Full review path. Unblocks A1018 Task 5.3's address check.

### Task 2.1: The box's own name, in its chart row

**Files:** Create `apps/server/src/box-name.ts`. Modify `membership-seed.ts`'s two callers
(`boot.ts:1641`, `first-setup-publication.ts:68`), `rebuild-first-start.ts` (its `contactUrl`),
`boot.ts:1976` (`runFirstStart`'s `contactUrl`), `adopt.ts:109` (the standby's `contactUrl`),
`mirror-bundle-api.ts` (`appendStandbyToChart`, `:193-216`, also rewrites the signer's own row when
its `contactUrl` differs from the signer's own contact URL). `start-peer-check.ts:182` already reads
this box's own address from its chart row. Tests `box-name.test.ts` (new),
`membership-seed.test.ts`, `rebuild-first-start.test.ts`, `adopt.test.ts`, `mirror-bundle-api.test.ts`.

**Interfaces — Produces:** `boxHostnameFor(nodeId: string): string` →
`box-${nodeId.slice(0, 4)}.waitron.local`; `ownContactUrl(advertisedOrigin: string, nodeId: string): string`
(D1); `sameBoxName(a: string, b: string): boolean` (the four characters compared, Task 5.3).

**Changed checks:** a case asserting a chart row equal to the advertised origin gets a row (the
expected value changes); find them with `git grep -n "advertisedOrigin\|contactUrl" --
'apps/server/src/*.test.ts'` before Step 1.

- [ ] **Step 1: Write the failing tests.** `box-name.test.ts`: "names a box by the first four
  characters of its node id under waitron.local"; "keeps the advertised origin's scheme and port";
  "leaves an origin at another host as configured" (`https://localhost:8443` stays). The seed: "the
  first box's chart row names its own address". Adopt: "sends the spare's own address as its
  contactUrl". The joining route: "the chart that adds a spare names both boxes by their own
  addresses" (control: a held chart already naming the signer's own address keeps it). The
  rebuild: "a rebuilt box's chart row names its own address".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/box-name.test.ts src/membership-seed.test.ts src/rebuild-first-start.test.ts src/adopt.test.ts src/mirror-bundle-api.test.ts`
  — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/start-peer-check.test.ts src/boot-peer-check.test.ts
  src/till-reroute-e2e.test.ts src/boot.start-check.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: each box names itself in the chart, not by the venue's name"`.

### Task 2.2: The mDNS lookup, which never finds the box itself

**Files:** Create `apps/server/src/box-lookup.ts`. Test `apps/server/src/box-lookup.test.ts`. No
caller yet (Task 4.1 wires it into `boxExchange`; Task 2.3b uses its query in setup mode).

**Interfaces — Produces:** `lookupBoxName(hostname: string, opts?: { timeoutMs?: number; makeSocket?: () => MdnsQuerySocket; ownAddresses?: () => string[] }): Promise<string[]>`
— for a name ending `.local`: one multicast query for its A record; every IPv4 answered within
`timeoutMs` (default 2000), in arrival order, without repeats, **leaving out every address in
`ownAddresses()`** (default: this box's interface addresses, as `request-from-box.ts:14-21` reads
them, plus loopback); none left refuses `mirror.peer_unresolved` (log-only). Any other name goes to
`dns.lookup` (all addresses). A literal IP is returned as `[ip]`. `askedAndHeardOthers(hostname, opts)`:
the same query, answering whether any address but this box's own answered (Task 2.3b).

- [ ] **Step 1: Write the failing tests** with a fake socket: "collects every A record answered
  within the limit"; "ignores an answer for another name"; **"a box in setup mode does not resolve
  the venue's name to itself"** (the fake socket loops back the box's own answer first, then
  another box's: the result is the other box's address alone; control: with only its own answer
  looped back, it refuses `mirror.peer_unresolved`); "refuses after its time limit"; "hands a name
  that is not .local to the system lookup".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/box-lookup.test.ts` — FAIL.
- [ ] **Step 3: Implement**, with the `multicast-dns` package the responder already uses (its
  default loops the box's own answers back, fact 5; filtering, not switching loopback off, is what
  lets the setup-mode check of Task 2.3b hear other boxes).
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box finds another box's .local name by asking the network, and never finds itself"`.

### Task 2.3a: mDNS answers the box's own name, and the venue's name only where D3 says

**Files:** Modify `mdns.ts` (`MdnsDeps.hostname` becomes `names: () => readonly string[]`, read per
query; `buildMdnsAnswers(name, addresses)` unchanged; the `mdns.responding` log line's field
becomes `hostnames`), `scripts/personal-log-params.test.ts` (the row `mdns.responding.hostname` at
`:75` becomes `mdns.responding.hostnames`, "the box's own host names"), and four of the five starts
in `boot.ts`: the latch start and the restricted start `[ownHostname]`; the waiting start
`[ownHostname, BOX_HOSTNAME]`; the full start `[ownHostname, ...(acceptingSales ? [BOX_HOSTNAME] : [])]`,
with `acceptingSales` as `boot.ts:2309` computes it. The setup start keeps `[BOX_HOSTNAME]` until
Task 2.3b. `StartServerSeams` gains `mdnsSocket?` so a boot test can hand the responder a fake
socket. Tests `mdns.test.ts`, `boot.mirror.test.ts`, `waiting-start.test.ts`.

**Changed checks:** `mdns.test.ts:68` ("answers an A query for its hostname…") and `:84`, `:100`
take `names` instead of `hostname`; their expected answers stay (same value, new input).
`scripts/personal-log-params.test.ts:75`: the field's name changes with the log line.

- [ ] **Step 1: Write the failing tests.** "answers each of its names"; "stops answering a name
  dropped from the list on the next query"; "a box that is not selling answers its own name and not
  the venue's"; in `boot.mirror.test.ts`, binding `0.0.0.0` (the responder is off on a loopback
  listener, `mdns.ts:55`; `boot.mirror.test.ts:495` already binds `0.0.0.0`) with the injected
  socket: "a mirror start answers only its own name"; in `waiting-start.test.ts`, the same way: "a
  waiting box answers the venue's name and its own".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/mdns.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/boot.mirror.test.ts src/waiting-start.test.ts` and root
  `scripts/personal-log-params.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: only the box that sells or waits to sell answers waitron.local"`.

### Task 2.3b: A box in setup mode stops answering the venue's name once another box does

**Files:** Modify `boot.ts`'s setup start: `[BOX_HOSTNAME]` while `askedAndHeardOthers` (Task 2.2)
last answered no, else `[]`; asked at start and then after 30 seconds plus a random 0–10 seconds,
drawn afresh each time (D3); the timer stops on close. `StartServerSeams` gains `setupAskRandom?`
(the random source) for tests. Test `mdns.test.ts` (the rule as a function with a fake clock) and
`boot.setup-routes.test.ts` or the setup start's existing suite for the timer's stop.

- [ ] **Step 1: Write the failing tests.** "a box in setup mode stops answering the venue's name
  once another box answers it" (fake socket: a looped-back own answer alone keeps it answering;
  another box's answer stops it at the next ask); "asks again after 30 seconds plus the random
  delay" (fake clock and random source: the second ask at 30 s + the drawn delay, not at 30 s);
  "the setup start's ask timer stops when the server closes".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/mdns.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then the setup start's suite.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box in setup mode leaves waitron.local to a box that already answers it"`.

### Task 2.4: The console also gives the box's own address

**Files:** Modify `deploy/waitron.sh` (`print_links`, `:460-477`: after "Start here", one line per
address, `http://<address>/setup/trust`, under the words below; the QR code stays the
`waitron.local` one), `scripts/waitron-sh.test.mjs` (a stubbed `ip`), `deploy/README.md` (the
paragraph that quotes the printed links). Console text is English only, as today. **Which
addresses:** the ones the server itself advertises (`listBoxIpv4`, `box-reach.ts:75-91`): the
IPv4 addresses of the interface carrying the default route, read from `/proc/net/route` as
`defaultRouteIface` does (`box-reach.ts:40-52`), and when there is none, every non-loopback IPv4
except on interfaces whose names start with the prefixes in `VIRTUAL_IFACE_PREFIXES`
(`box-reach.ts:30`: `docker`, `br-`, `veth`, `virbr`, `cni`, `flannel`, `cali`). Addresses come from
`ip -4 -o addr show`, which names each address's interface. Not `hostname -I`: it lists every
interface, Docker's bridge included, without saying which (revision 2 used it).

The words: "If this venue already has a Waitron box, waitron.local reaches that box instead. Use
this box's own address:" followed by the addresses.

- [ ] **Step 1: Write the failing test** in `waitron-sh.test.mjs`: "the ready message gives the box's
  own setup address on the default-route interface" (stub `ip` listing `eth0` and `docker0`, and a
  route file naming `eth0`: only `eth0`'s address is printed); "without a default route, it skips
  Docker's and other virtual interfaces"; control: with `ip` missing or printing nothing, no extra
  lines and the script still succeeds.
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/waitron-sh.test.mjs -t "own setup address"` — FAIL.
- [ ] **Step 3: Implement**, under `set -u`, with `ip` failing quietly. The route file's path is a
  variable the test points at its own file.
- [ ] **Step 4: Run** the whole file — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "box: the console says how to reach a second box's setup"`.

### Task 2.5: A till shows one line per box

**Files:** Modify `apps/till/src/api/server-router.ts` (keep each entry's chart `nodeId`; remember
the page origin's node id from any probe that carried one; an entry whose chart `nodeId` equals it
is the page origin, and is neither probed for display nor drawn; before any probe gave the origin's
node id, entries are drawn as today). Check `packages/print-agent/src/router.ts` and do the same
there if it chooses by the same rule. Test `apps/till/src/api/server-router.test.ts`.

- [ ] **Step 1: Write the failing tests.** **"an own-name entry that never answers is hidden behind
  the page origin"** (the origin answers `nodeId: "n1"`, primary; the chart entry `{ nodeId: "n1",
  url: "https://box-n1xx.waitron.local" }` never answers: `statuses()` has one entry, the page's
  host); "two boxes are two servers" (different chart node ids, both shown); "before the origin has
  reported its node id, every entry is shown" (pins today's behaviour); a pin of the tie rule:
  "stays on the page's origin when its own name answers primary at the same term".
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/api/server-router.test.ts`
  — the first FAILS; the pins pass on today's code (say so in the commit).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `pnpm --filter @waitron/till typecheck` and, if changed,
  `pnpm --filter @waitron/print-agent exec vitest run src/router.test.ts`. No look at the dev
  stack's lock screen: its origin is `http://localhost:<port>`, which D1 leaves as configured, so
  its chart never holds a `box-…` entry and the screen looks the same with or without the change.
  The unit tests above are the evidence.
- [ ] **Step 5: Commit** `git commit -s -m "till: a box listed under its own name is the same server as the page's"`.

### Task 2.6: Final checks for 3b-2

- [ ] `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/till typecheck`,
  `pnpm format:check`; from the root `scripts/deploy-image-env.test.ts` (BOX_HOSTNAME pins
  unchanged), `scripts/errors-reachable.test.ts`, `scripts/waitron-sh.test.mjs`,
  `scripts/personal-log-params.test.ts`. PR first line:
  "Each box names itself (`box-<id>.waitron.local`) in the chart and its mDNS answers, never finds
  itself by name, and only the box that sells or waits to sell answers waitron.local." Then
  `/finish-branch` on the full path.

---

## PR 3b-3 — a spare's certificate authority is the venue's

Full review path. Retires A1295; closes C2. Built after 3b-2 lands: Tasks 3.1 and 3.3 call Task
2.1's `boxHostnameFor`.

### Task 3.1: Joining installs the venue authority whole, and `venue-ca` goes

**Files:** Create `apps/server/src/box-tls-install.ts`; modify `box-secrets.ts`
(`writeVenueAuthority` removed), `adopt.ts` (right after `hooks.beforeFirstWrite()` at `:166` and
before `stampDeployment` and `persistCredentialsRing` at `:167-168`: `markJoined`; at `:169-172`:
`installVenueAuthority`),
`boot.ts` (before any start reads `tls/`: `finishTlsInstall(stateDir)`),
`backup-optional-state.ts:14-15` (drop `tls/venue-ca.*`). Tests `box-tls-install.test.ts` (new),
`adopt.test.ts`, `archive-entries.test.ts`, `backup-data-placement.test.ts`,
`backup-verification.installed.test.ts`, `backup-optional-state.test.ts`.

**Interfaces — Produces:** `markJoined(stateDir: string, originNodeId: string): Promise<void>` —
writes `tls/joined.json` (`{ originNodeId }`) durably (written, synced, renamed into place);
`installVenueAuthority(deps: { stateDir; authority: { certPem; keyPem }; hostnames: string[]; listIpv4; now }): Promise<void>`
— D9's order: four working files (the authority and a leaf it issues with `reissueServerLeaf` for
`hostnames`), then durable `tls/install.json` naming them, then the renames, then `install.json`
removed;
`finishTlsInstall(stateDir): Promise<"none" | "finished" | "discarded">` — finishes the renames a
listed install left, or deletes working files no list names; `joinedAnotherBox(stateDir): Promise<boolean>`.

**Changed checks:** `adopt.test.ts:564` ("keeps the main box's authority certificate and key as
venue-ca files, 0600") becomes "installs the main box's authority as this box's own, 0600, with a
leaf it signed"; `archive-entries.test.ts:91-110` and `backup-data-placement.test.ts:327-336`,
`backup-verification.installed.test.ts:91-92` drop their `venue-ca` entries (the optional entries
no longer exist); each is a changed expected value.

- [ ] **Step 1: Write the failing tests.** `box-tls-install.test.ts`, with real TLS as probe P2
  did: "a joined box's leaf verifies under the main box's authority" (a `node:tls` connect with
  `servername` the own name and `ca` the main box's authority); "a crash after the list finishes at
  the next start" (stop after each rename in turn: `finishTlsInstall` leaves a matching authority
  and leaf every time); "working files with no list are deleted"; "a crash before the list leaves
  the box's own authority, and the next start serves the old leaf". `adopt.test.ts`: the changed
  row above; **"the joined marker is written before the main box's key ring"** (a
  `persistCredentialsRing` stub that records whether `tls/joined.json` exists when it is called:
  it does); **"a join stopped just after the key ring was written leaves the marker, so the staged
  reset removes the ring"** (the authority install made to throw after `persistCredentialsRing`
  wrote `secrets.env`; then Task 3.2's staged reset: `secrets.env` and `tls/` are gone; control: a
  join that stopped before `beforeFirstWrite` leaves no marker and the reset is not offered, as
  today).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/box-tls-install.test.ts src/adopt.test.ts`
  — FAIL. (The reset half of the stopped-join case runs once Task 3.2 lands; write it in Task 3.2's
  commit if Task 3.1 is committed first, and say so.)
- [ ] **Step 3: Implement.** Do not delete the leaf and rely on a later issue: no trading start
  mints, and a reissue needs the old leaf (fact 20).
- [ ] **Step 4: Run** them — PASS; then `src/archive-entries.test.ts src/backup-data-placement.test.ts
  src/backup-verification.installed.test.ts src/backup-optional-state.test.ts src/backup-verification.test.ts
  src/box-tls-repair.test.ts src/boot.mirror.test.ts`; then `git grep -n venue-ca -- apps packages
  scripts deploy` prints only Task 3.2's sites.
- [ ] **Step 5: Commit** `git commit -s -m "server: a joining spare takes the venue's certificate authority as its own"`.

### Task 3.2: Resetting a box that joined another leaves none of that venue's secrets

**Files:** Modify `reset-request.ts:107-117` (the staged reset: when `joinedAnotherBox`, every file
in `tls/` and `secrets.env` go, beside today's list; the `venue-ca` names go),
`deploy/waitron.sh:806-813` (the plain reset: when `tls/joined.json` exists, `tls/` is emptied too;
`secrets.env` already goes; the `venue-ca` names go), `deploy/README.md:416-424,464-470` (what each
reset keeps). Tests `reset-request.test.ts`, `scripts/waitron-sh.test.mjs`.

**Changed checks:** `reset-request.test.ts:120-124,154-157,231-234` (the `venue-ca` fixtures and
expected removals) and `:239` ("`secrets.env` kept") — on a joined box `secrets.env` now goes;
`waitron-sh.test.mjs:1740` ("removes the venue authority a join left in tls/ and keeps the box's own
files") — its fixture and expected list change: a box with `tls/joined.json` ends with an empty
`tls/`, and a new control keeps today's four files for a box without it.

- [ ] **Step 1: Write the failing tests.** `reset-request.test.ts`: "a staged reset of a box that
  joined leaves no authority, leaf, client certificate or key ring" (afterwards a setup start mints
  a fresh set: `ensureBoxSecrets` succeeds, probe P18's shape); `waitron-sh.test.mjs`: "the reset of
  a box that joined another empties tls/" and its control "the reset of a box that never joined
  keeps its authority and leaf".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/reset-request.test.ts` and
  `pnpm exec vitest run scripts/waitron-sh.test.mjs -t reset` — FAIL.
- [ ] **Step 3: Implement.** The shell test reads the `-c '…'` string as `:1741-1743` does; keep it
  one command.
- [ ] **Step 4: Run** both files whole — PASS; then `git grep -n venue-ca -- apps packages scripts
  deploy` prints nothing.
- [ ] **Step 5: Commit** `git commit -s -m "box: resetting a box that joined another removes that venue's authority and key ring"`.

### Task 3.3: Every start checks its leaf's names and signer

**Files:** Modify `box-secrets.ts` (new `ensureLeaf(deps: { stateDir; hostnames: string[]; listIpv4; now }): Promise<"kept" | "reissued">`
— reissues with `reissueBoxLeaf` when the leaf lacks a hostname or a current permitted address,
**or does not verify under the current `tls/ca.crt`** (review I5)); `boot.ts` (call it with
`[ownHostname, BOX_HOSTNAME, "localhost"]` at every trading start before the listener, the latch
start included). Test `apps/server/src/box-leaf-names.test.ts` (new).

- [ ] **Step 1: Write the failing tests**, with real TLS: "a reissued leaf for box-7f3a.waitron.local
  verifies under the box's authority"; "a leaf already naming every name and address under this
  authority is left alone" (bytes unchanged); **"a leaf with every name but another authority's
  signature is reissued"** (and afterwards verifies); control: "a leaf another authority signed is
  refused by a client pinning this one" (`CERT_SIGNATURE_FAILURE`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/box-leaf-names.test.ts` — FAIL.
- [ ] **Step 3: Implement.** A failed reissue logs and keeps the old leaf: a wrong name is no reason
  to stop selling (the rule of `tls.tighten_failed`, `boot.ts:1681-1684`).
- [ ] **Step 4: Run** it — PASS; then `src/box-secrets.test.ts src/rebuild-first-start.test.ts
  src/boot.mirror.test.ts src/boot.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: each start checks its certificate names this box and comes from its authority"`.

### Task 3.4: Final checks for 3b-3

- [ ] `pnpm --filter @waitron/server typecheck`; `pnpm format:check`; root
  `scripts/errors-reachable.test.ts`, `scripts/waitron-sh.test.mjs`, `scripts/deploy-image-env.test.ts`.
  One entry in `docs/developers/conventions-data.md` (D9's marker and D13's rule). PR first line:
  "A joining spare takes the venue's certificate authority as its own; resetting a box that joined
  another removes that venue's authority and key ring." `/finish-branch`, full path.

---

## PR 3b-4 — the boxes reach and trust each other

Full review path. Unblocks R13 and A1018 fact 4. The start check's trust (R12) and the boot
reconcile moved to 3b-G in revision 3 (D16); Task numbers 4.2 and 4.3 are not reused. Not labelled
FISCAL, by D16's judgement 1: Task 4.1 changes how the start check reaches a `.local` peer, and the
PR body's first line says so.

### Task 4.1: Box-to-box calls use the lookup, and try each answer under the pin

**Files:** Modify `mirror-bundle-fetch.ts` (`boxExchange` resolves the URL's host with
`lookupBoxName` and connects to each address in turn, with `servername` the host and the same
trust, until one completes the TLS handshake; a handshake failure on every address is the call's
failure), and `boxDownload` in the same file finds the name the same way: it opens its own request
for a handover's final copy (A1018 Slice 5), so a lookup in `boxExchange` alone would leave the new
box unable to reach the old one on real boxes. Share the request-opening code, or carry the lookup
across. Test `mirror-bundle-fetch.test.ts`.

- [ ] **Step 1: Write the failing tests** against local HTTPS servers: "connects to the address the
  lookup gave and checks the certificate against the name" (lookup stubbed to `127.0.0.1`, URL
  `https://box-7f3a.waitron.local:<port>`, leaf for that name: 200; control: a leaf without the
  name is refused); "a false first answer costs one connection, not the call" (lookup gives a
  closed port first, then the server); "the setup app's certificate read by `https://waitron.local`
  reaches the other box, not this one" (lookup fed a looped-back own answer and another box's,
  through Task 2.2's filter).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/mirror-bundle-fetch.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/setup-api.test.ts src/adopt.test.ts src/primary-url.test.ts`.
  `assertSafePrimaryUrl` still runs on the typed address before the lookup and is not changed: it
  refuses private literals and lets names through, and its header already says it does not
  defend a name that resolves to a private address (`primary-url.ts:1-7`).
- [ ] **Step 5: Commit** `git commit -s -m "server: box-to-box calls find a .local box by asking the network, and try each answer"`.

### Task 4.4: Every chart vouches for every listed box's key (R13)

**Files:** Modify `membership-mint.ts:67-73` (the endorsements carried are the signer's own and,
for every node the new chart lists in good standing, the endorsement its `venue.db` `nodes` row
holds, when a key this box trusts made it; at most `MAX_NODES`, which equals `MAX_ENDORSEMENTS`,
`packages/membership/src/verify.ts:25-27`); `mintNextMembershipDocument` gains `extraEndorsements?:
readonly Endorsement[]` for Task 5.4's first chart, before the row exists. Tests
`membership-mint.test.ts`, `start-peer-check.test.ts`.

**Changed checks:** `membership-mint.test.ts:78` ("carries no endorsement when the signer's row holds
none") — unchanged if its chart lists no other endorsed box; check before editing.
`boot.start-check.test.ts:145`'s fixture "Stands in for A947 3b's join step" now writes the spare's
`nodes` row and lets the mint carry the endorsement, and the comment goes — a setup change, no row.

- [ ] **Step 1: Write the failing tests.** "a chart carries the endorsement of each listed box whose
  row holds one"; "does not carry an evicted box's endorsement"; the R13 test: "a main box holding
  its spare's row verifies the spare's signed status" (control: with the endorsement signed by the
  wrong key, `peerKeyOf` returns `undefined`, as probe P4).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/membership-mint.test.ts src/start-peer-check.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/boot.start-check.test.ts src/mirror-bundle-api.test.ts
  src/membership-removal-api.test.ts src/promote.test.ts`; and `pnpm --filter @waitron/membership exec vitest run`.
- [ ] **Step 5: Commit** `git commit -s -m "membership: each chart vouches for the key of every box it lists"`.

### Task 4.5a: A mirror listens on the venue's network; its open dashboard stays on its own screen

**Files:** Delete `mirror-bind-guard.ts` and its test; modify `boot.ts:2002-2005` (the call and its
comment), `mirror-session.ts` (`mirrorSession` takes `isFromBox: (c) => boolean`, default
`requestFromBox`, and attaches nothing — no cookie, no keep-alive write — to any other request),
`errors.ts` (retire `server.mirror_bind_exposed` and its doc comment at `:214`). Tests
`mirror-session.test.ts`, `boot.mirror.test.ts`.

**Changed checks:** `boot.mirror.test.ts:475-505` ("refuses a mirror boot binding a non-loopback
host without the … opt-in" and its opted-in twin) — replaced by "a mirror boot listens on a
non-loopback host". `mirror-bind-guard.test.ts` (6 cases) — deleted with the guard; D8 retires its
behaviour, and the new cases here and in Task 4.5b carry the protection it gave.

- [ ] **Step 1: Write the failing tests.** "gives the ambient viewer to a request from the box
  itself"; "gives a request from another address no session and writes nothing" (the
  `managementSessions` row's `last_seen_at` unchanged); "a dashboard read from another address is
  refused as signed out" (401 through a real route); boot: "a mirror boot listens on a non-loopback
  host".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/mirror-session.test.ts src/boot.mirror.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Trace every consumer of the viewer first (global CLAUDE.md):
  `git grep -n "MIRROR_VIEWER\|mirrorSession\|ensureMirrorViewer" -- apps packages`.
- [ ] **Step 4: Run** them — PASS; then `src/request-from-box.test.ts src/till-reroute-e2e.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a spare can be reached from the venue's network; its open dashboard is for its own screen"`.

### Task 4.5b: What a spare serves the network, walked; its landing pages stay on its own screen

**Files:** Modify `boot.ts`: a helper `landingHostFor(config, { spare: boolean }): ServerConfig`
(the configured host, or `"127.0.0.1"` when `spare`), used by the latch start (`:1738`, always
`spare: true`), the time-zone repair start (`:2177`) and the full start (`:3736`), both with
`spare: isMirror` (D8 item 6); the setup, restricted and waiting starts are unchanged. Create
`boot.mirror-surface.test.ts`.

- [ ] **Step 1: Write the failing tests.** `boot.mirror-surface.test.ts`:
  - **"a mirror serves the network only what D8 lists"** — boot a mirror's full start on `0.0.0.0`,
    walk every route Hono's `app.routes` lists, send each from a non-box address with no
    credentials, with its own method and with `OPTIONS`, and check: each
    non-`GET`/`HEAD`/`OPTIONS` request answers 403 `node.read_only` except the two signed routes
    and the two promotion routes (Task 4.6 makes those answer `promotion.from_box_only`; until it
    lands, list them as the test's known gap and say so); each `GET` answers 401 or 403 unless it is
    on the test's own short list of open reads, which the test file names and Task 4.7's PR body
    copies;
  - **"a joining spare serves the network only what D8 item 7 lists"** — boot a latch start (a
    state folder holding `pending-adoption.json`, as `boot.adoption-allocation.test.ts` builds one)
    on `0.0.0.0` and walk its routes the same way: only `/health`, `/api/box/status` and the two
    signed routes answer; anything else is 404;
  - **"a spare's landing listener is on loopback only, in every start it makes"** — its bound
    address is `127.0.0.1` in a mirror's full start, a mirror's time-zone repair start (a saved
    zone that is not valid) and a latch start; control: a primary's full start and a primary's
    time-zone repair start bind the configured host.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.mirror-surface.test.ts` — FAIL.
- [ ] **Step 3: Implement.** If the walk finds an open read or an open write D8 does not name,
  STOP and report it rather than adding it to the list.
- [ ] **Step 4: Run** it — PASS; then `src/boot.mirror.test.ts src/boot.adoption-allocation.test.ts`;
  and the landing suites (`git grep -ln "startLandingListener\|buildLandingApp" -- 'apps/server/src/*.test.ts'`).
- [ ] **Step 5: Commit** `git commit -s -m "server: a spare's network surface is walked by a test, and its landing pages stay on its own screen"`.

### Task 4.6: On a mirror, promotion answers only the box itself

**Files:** Modify `promote-api.ts` (both routes: when the box is a mirror and
`requestFromBox(c)` is false, refuse `promotion.from_box_only`, 403, before reading the body),
`read-only-exemptions.ts:26-38` (the two rows' `authenticates` text names the new refusal),
`errors.ts`, `apps/dashboard/src/i18n/codes.ts` (words below). Tests `promote-api.test.ts` (or the
route suite that mounts it), `read-only-exemptions.test.ts`, `apps/dashboard/src/i18n/codes.test.ts`.

The words (dashboard; no screen sends this request today, `git grep -n "management-api/promote" --
apps` finds only the server; "Standby" / «servidor en espera» as the Servers screen says, fact 26):
- EN: "In this version a standby server can be switched on only from its own screen. Nothing was
  changed."
- ES: "En esta versión, un servidor en espera solo se puede activar desde su propia pantalla. No se
  ha cambiado nada."

**Changed checks:** `read-only-exemptions.test.ts`'s pinned rows (the `authenticates` text of the
two promotion rows changes).

- [ ] **Step 1: Write the failing tests.** "a mirror refuses promotion from another address,
  promotes nothing and reads no password" (a correct manager password from a non-box address:
  `promotion.from_box_only`, the role unchanged); "a mirror still accepts promotion from the box
  itself" (the existing promotion case, run with `requestFromBox` true); the same pair for
  `/promote/preparation`; control: "a fenced box's promotion refusal is unchanged".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/promote-api.test.ts src/read-only-exemptions.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/boot.mirror-surface.test.ts` (its two promotion routes
  now answer `promotion.from_box_only`; remove the known-gap note), `src/promote.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/codes.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a spare is switched on only from its own screen until the take-over lands"`.

### Task 4.7: Final checks for 3b-4

- [ ] Typecheck `@waitron/server`, `@waitron/membership`, `@waitron/dashboard`; `pnpm format:check`;
  root `scripts/errors-reachable.test.ts`, `scripts/write-path-tables.test.ts`. The R13 backlog
  entry's text is the session running this plan's, at landing. PR first line names R13, the
  retired opt-in, and D8's surface list, after D16's judgement-1 sentence, which comes first.
  `/finish-branch`, full path.

---

## PR 3b-5 — the store on the spare, and the pair's access key

Full review path. **Adds one `node.db` migration.**

### Task 5.1: `node_pair_link`, node.db's third migration, and its readers

**Files:** Create `packages/node-db/src/schema/node-pair-link.ts`, `src/pair-link.ts` (readers).
Modify `packages/node-db/src/schema/index.ts`, `classification.ts` (`local`, with the `LOCAL`
reason), `index.ts`; `scripts/write-path-tables.json` (`node_pair_link` →
`packages/credentials/src/node-pair-link.ts`); `scripts/schema-constraints.test.ts` (the new check
names). From `packages/node-db`, `pnpm exec drizzle-kit generate` once.

**The table** (columns through `packages/db/src/schema/columns.ts` builders only): `node_id`
(primary key: this box), `role` (`label`, `"streams" | "serves"`; check `node_pair_link_role_ck`),
`state` (`label`: `"pending" | "streaming"` for `streams`, `"awaiting_copy" | "copied"` for
`serves`; check `node_pair_link_state_ck`), `peer_node_id`, `peer_public_key`, `store_url`,
`venue_id`, `access_key_id`, `secret_ciphertext`, `secret_iv`, `secret_auth_tag` (`binary`, with
the 12- and 16-byte checks as `node_signing_key`), `key_version` (`count`, ≥ 1), `ring_version`
(`count`, D7), `created_at` (D14's start), `updated_at`. `peer_node_id` names a venue row: its
column comment says nothing establishes it exists in this file (CLAUDE.md §3).

**Interfaces — Produces:** `readPairLink(node: NodeDatabase, nodeId: string): Promise<PairLink | null>`
(no secret).

- [ ] **Step 1: Write the failing tests.** `packages/node-db/src/schema.test.ts`: "creates
  node_pair_link in node.db and not in venue.db"; "refuses a state that does not belong to its role"
  (CHECK naming `node_pair_link_state_ck`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/node-db exec vitest run src/schema.test.ts` — FAIL.
- [ ] **Step 3: Implement**; generate the migration once; do not hand-edit it or `_journal.json`.
- [ ] **Step 4: Run** it — PASS; then from the root `scripts/classification-complete.test.ts
  scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts
  scripts/schema-constraints.test.ts scripts/journal-monotonic.test.ts scripts/write-path-tables.test.ts
  scripts/column-vocabulary.test.ts scripts/module-graph-honesty.test.ts`.
  (`scripts/id-columns-are-references.test.ts` reads only tables a configuration export carries,
  its header says; `node_pair_link` is not one.)
- [ ] **Step 5: Commit** `git commit -s -m "node-db: the pair link, where each box keeps the store's address and the pair's access key"`.

### Task 5.2: The pair link's sealed writers, and a delete helper for every node.db table

**Files:** Create `packages/credentials/src/node-pair-link.ts` (writers). Add one
`delete<Table>OtherThanTx(tx, nodeId)` helper in each file `scripts/write-path-tables.json` names
for a `node.db` table: `packages/node-db/src/mode.ts`, `mirror-link.ts`, `recovery-key.ts`,
`primary-key.ts`, `packages/credentials/src/node-signing-key.ts`, `node-pair-link.ts` (review I8).
The three handover tables (`packages/node-db/src/handover.ts`) get none: they are A1018's record of
what a box did, and Slice 13 decides when they go.

**Interfaces — Produces:** `readPairSecret(node, ring, nodeId): Promise<string>`;
`writePairLinkTx(tx: NodeTransaction, ring: KeyRing, nodeId: string, link: NewPairLink): Promise<void>`;
`setPairLinkStateTx(tx, nodeId, state)`; `deletePairLinkTx(tx, nodeId)`.

- [ ] **Step 1: Write the failing tests.** `packages/credentials/src/node-pair-link.test.ts`: "seals
  the pair's secret so it opens only under this ring and these two node ids" (another ring:
  `credentials.decrypt_failed`; another peer id: refused). One case per helper: "deletes every row
  but this node id's, and keeps this one's".
- [ ] **Step 2: Run** `pnpm --filter @waitron/credentials exec vitest run src/node-pair-link.test.ts src/node-signing-key.test.ts`
  and `pnpm --filter @waitron/node-db exec vitest run` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; root `scripts/write-path-tables.test.ts`;
  `pnpm --filter @waitron/node-db mutation` (90 or more).
- [ ] **Step 5: Commit** `git commit -s -m "node-db: the pair's key sealed in node.db, and a sweep helper beside each writer"`.

### Task 5.3: The joining route refuses first

**Files:** Modify `mirror-bundle-api.ts`: after the credential, **before the reservation**: refuse
`mirror.spare_already_joined` (409) when this box's pair link is `streaming` (D17; in 3b-5 no link
reaches `streaming` yet, so the test writes one); refuse `mirror.bucket_stream_active` (409) when
`readStreamSettings` finds bucket settings; refuse `module.operation_invalid` `{ module }` (409)
when an enabled module fails `assertAdoptionModules` (D12; until 3b-F); refuse
`mirror.standby_name_taken` (409) when `sameBoxName` matches a listed box (D1); refuse repeated ids
in the held chart's `revoked` list with `membership.revoked_duplicate` (A1278). Each gets its row in
the route's `STATUS` (`mirror-bundle-api.ts:60-70`). Tests `mirror-bundle-api.test.ts`.

**Changed checks:** `adoption-allocation-refusal.test.ts:141` — the same code, now also from the main
box's route before any reservation: the test that checks the spare wrote nothing stays, and the new
route test checks the main box reserved nothing and listed nobody.

- [ ] **Step 1: Write the failing tests.** "refuses a second spare while one is joined, reserving
  nothing" (control: a `pending` link does not refuse); "refuses a join while the venue streams to
  a bucket, reserving nothing and listing nobody"; "refuses a Veri*Factu venue's join before
  reserving";
  "refuses a spare whose name a listed box already has"; "refuses a chart with a repeated revoked id
  before reserving" (reservations snapshot before and after: equal).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/mirror-bundle-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/adoption-allocation-refusal.test.ts src/allocated-standby-host.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "joining: every refusal before anything is reserved"`.

### Task 5.4: The joining route needs no relay, and hands out the pair's key

**Files:** Modify `mirror-bundle.ts` (`MirrorBundle` gains `primaryUrl` — the main box's own contact
URL — and `store: { accessKeyId; secretAccessKey; venueId }`; `relayUrl` becomes optional,
carried only when a tunnel is configured; the doc comment's list of secrets gains the pair's key),
`mirror-bundle-fetch.ts` (`isMirrorBundle`; `fetchMirrorBundle`'s `standby` argument gains
`storeUrl`, sent as `standbyStoreUrl`, D15), `mirror-bundle-api.ts` (read and screen
`standbyStoreUrl` beside `standbyContactUrl` at `:100-113`: an `https` bare origin whose host is the
contact URL's host, else `mirror.standby_invalid`; mint the access key:
`access_key_id` = `waitron` + 16 random hex characters, as `s3-test-server.ts:177`; secret = 32
random bytes, hex; the chart append passes the spare's endorsement in `extraEndorsements`; after the
append, this box's pair link `{ role: "streams", state: "pending", storeUrl: <standbyStoreUrl>, … }`
in one node transaction —
venue first, node after: a crash between leaves a chart entry and no link, which a second join
replaces), `errors.ts` (retire `mirror.no_relay`), the route's `STATUS`. Tests
`mirror-bundle-api.test.ts`, `mirror-bundle.test.ts`, `mirror-bundle-fetch.test.ts`, `errors.test.ts`.

**Changed checks:** `mirror-bundle-api.test.ts:721` ("refuses mirror.no_relay (400) when no relay is
configured") — becomes "hands out a bundle with no relay configured, naming the main box's own
address"; `errors.test.ts:175-177` ("constructs mirror.no_relay…") — deleted with the code.

- [ ] **Step 1: Write the failing tests.** "hands out a bundle with no relay, carrying the main box's
  address and the pair's key"; "writes a pending pair link naming the store address the spare
  sent"; "refuses a store address at another host than the spare's contact address"; "the first
  chart naming the spare vouches for its key".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/mirror-bundle-api.test.ts src/mirror-bundle.test.ts src/mirror-bundle-fetch.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/boot.setup-routes.test.ts src/setup-api.test.ts
  src/errors.test.ts`; root `scripts/errors-reachable.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "joining: no Cloud relay needed, and an access key for the pair"`.

### Task 5.5: Adopt keeps the pair's key, and clears an abandoned attempt's rows

**Files:** Modify `adopt.ts` (in its one node transaction: first, for every table in
`NODE_CLASSIFICATION` that has a delete helper (Task 5.2), delete every row keyed by another node
id — A1280; then `writePairLinkTx({ role: "serves", state: "awaiting_copy", peerNodeId:
designated.nodeId, peerPublicKey: bundle.primaryPublicKey, … })`; the mirror link's address is
`bundle.primaryUrl`; the bundle request sends `storeUrl` = `https://<own name>:<config.spareStorePort>`,
D15 — so `AdoptDeps` gains `spareStorePort`), `config.ts` (`WAITRON_SPARE_STORE_PORT`, default 7443,
D11; Task 5.8's listener reads the same setting), `boot.ts` (the setup start passes it to adopt),
`packages/node-db/src/mirror-link.ts` (the TypeScript field `relayUrl` becomes
`originUrl`; the column `relay_url` keeps its name, so no migration). Tests `adopt.test.ts`,
`packages/node-db/src/mirror-link.test.ts`.

**Changed checks:** the 3a cases naming `relayUrl` on the mirror link (`git grep -n "relayUrl" --
'apps/server/src/*.test.ts' 'packages/node-db/src/*.test.ts'`) — the field is renamed, same value.

- [ ] **Step 1: Write the failing tests.** "keeps the pair's key sealed in node.db, opening under the
  venue's ring"; "sends its own store address with the joining request"; "a second join under a new
  id removes the first attempt's node.db rows" (control:
  the new id's rows are all there); **"every node.db table is either swept by adopt or named as
  kept"** (walks `NODE_CLASSIFICATION`: each table has a helper or is one of the three handover
  tables; a new table with neither fails).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/adopt.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/boot.reconcile.test.ts`,
  `pnpm --filter @waitron/node-db exec vitest run src/mirror-link.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "joining: the spare keeps the pair's access key and clears what an abandoned attempt left"`.

### Task 5.6: The setup app explains the new refusals

**Files:** Modify `apps/setup/src/setup-app.ts:254-264` (`ADOPT_ERROR_MESSAGES` gains the four
codes), `apps/setup/src/i18n/strings/shell.ts` (English and Spanish). Test
`apps/setup/src/setup-app.test.ts`. The words use the setup app's own terms ("primary server", "this
server", Connect, Back) and, for the spare, the Servers screen's ("standby" / «servidor en espera»,
Remove / «Retirar», fact 26). These words reach the person only once Task 5.6b passes the codes
on; this task's tests stub the API.

- `mirror.bucket_stream_active`
  - EN: "The primary server copies the restaurant's data to its own storage bucket, and it can copy
    to only one place at a time. This version of Waitron cannot yet pass that copy on from this
    server to the bucket, so joining now would end the restaurant's offsite copy. Nothing was
    changed on either server. To join anyway, stop the bucket copy in the primary's dashboard under
    Backups — the restaurant then has no offsite copy — and press Connect again. To keep the bucket
    copy, press Back: nothing changes, and this server can join later."
  - ES: "El servidor principal copia los datos del restaurante en su propio bucket de
    almacenamiento, y solo puede copiar en un sitio a la vez. Esta versión de Waitron aún no puede
    pasar esa copia desde este servidor al bucket, así que unirlo ahora acabaría con la copia externa
    del restaurante. No se ha cambiado nada en ninguno de los dos servidores. Para unirlo de todos
    modos, detén la copia al bucket en el panel del servidor principal, en Copias de seguridad —el
    restaurante se queda entonces sin copia externa— y vuelve a pulsar Conectar. Para conservar la
    copia al bucket, pulsa Volver: no cambia nada, y este servidor puede unirse más adelante."
- `mirror.standby_name_taken`
  - EN: "This server picked a name another server of the restaurant already uses. Nothing was
    changed on either server. Press Connect again: it picks a new name."
  - ES: "Este servidor eligió un nombre que ya usa otro servidor del restaurante. No se ha cambiado
    nada en ninguno de los dos servidores. Vuelve a pulsar Conectar: elegirá un nombre nuevo."
- `module.operation_invalid` on the adopt path (until 3b-F)
  - EN: "The restaurant files its invoices with Veri*Factu, and this version of Waitron cannot yet
    add a standby server to a restaurant that does. Nothing was changed on either server, and the
    primary keeps working as before. Back returns to the start of setup. You can leave this server
    switched off and join it after an update that adds this."
  - ES: "El restaurante presenta sus facturas con Veri*Factu, y esta versión de Waitron aún no puede
    añadir un servidor en espera a un restaurante que lo hace. No se ha cambiado nada en ninguno de
    los dos servidores, y el principal sigue funcionando como antes. Volver te lleva al inicio de la
    configuración. Puedes dejar este servidor apagado y unirlo después de una actualización que lo
    permita."
- `mirror.spare_already_joined`
  - EN: "The primary server already has a standby server that finished joining, and this version of
    Waitron keeps one standby per restaurant. A standby that finished joining cannot be removed in
    this version. Nothing was changed on either server. Back returns to the start of setup, where
    this server can be set up for another restaurant; or leave it switched off."
  - ES: "El servidor principal ya tiene un servidor en espera que terminó de unirse, y esta versión
    de Waitron admite un solo servidor en espera por restaurante. Un servidor en espera que terminó
    de unirse no se puede retirar en esta versión. No se ha cambiado nada en ninguno de los dos
    servidores. Volver te lleva al inicio de la configuración, donde puedes configurar este servidor
    para otro restaurante; o déjalo apagado."

- [ ] **Step 1: Write the failing tests.** "shows the bucket refusal's words with both choices";
  "shows the name refusal and leaves Connect working"; "shows the Veri*Factu refusal and Back";
  "shows the second-standby refusal and Back"; the same four in Spanish (the screen tests read
  expected strings, CLAUDE.md §3).
- [ ] **Step 2: Run** `pnpm --filter @waitron/setup exec vitest run src/setup-app.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Open each refusal in both themes and at phone width, and look.
- [ ] **Step 4: Run** it — PASS; `pnpm --filter @waitron/setup typecheck`.
- [ ] **Step 5: Commit** `git commit -s -m "setup: words for a join refused by a bucket copy, a name in use, a joined standby, or Veri*Factu"`.

### Task 5.6b: The spare passes each of the main box's new refusals on, in its own words

**Files:** Modify `apps/server/src/mirror-bundle-fetch.ts` (`refusalFrom`, `:75-89`: besides
`password.invalid`, it rebuilds a short named list — `mirror.bucket_stream_active`,
`mirror.standby_name_taken`, `mirror.spare_already_joined` with no parameters, and
`module.operation_invalid` with `{ module }` only when `module` is the name of a module in
`ALL_MODULES`, else no relay; every other code, and every parameter not named here, still becomes
`mirror.bundle_fetch_failed`. The doc comment says so; the file's rule that nothing the main box
wrote travels on stays: each relayed error is built here from the list, not copied),
`apps/server/src/setup-api.ts` (`ADOPT_STATUS`, `:290-302`: the three new codes at 409;
`module.operation_invalid` is already 409 at `:291`). `membership.revoked_duplicate` is not on the
list: a repeated id comes only from a faulty chart, and the generic words stay for it. Tests
`mirror-bundle-fetch.test.ts`, `adoption-allocation-refusal.test.ts` (or a new
`adopt-refusal-relay.test.ts`).

**Changed checks: none.** The existing cases that pin today's mapping keep every assertion: they
use `totp.invalid`, `person.not_found`, `person.suspended` and four malformed bodies
(`mirror-bundle-fetch.test.ts:175-221`), none of them on the list, so "a code other than
password.invalid" stays as the control for codes not on it. Only new cases are added. If an
existing assertion turns out to need changing, STOP and report.

- [ ] **Step 1: Write the failing tests.** In `mirror-bundle-fetch.test.ts`: "passes on
  mirror.bucket_stream_active, carrying none of its parameters"; the same for
  `mirror.standby_name_taken` and `mirror.spare_already_joined`; "passes on module.operation_invalid
  with a known module's name, and nothing else" (the main box sends `{ module: "fiscal-verifactu",
  detail: "https://primary.internal" }`: the error's params are `{ module: "fiscal-verifactu" }`);
  "does not pass on module.operation_invalid naming an unknown module" (→
  `mirror.bundle_fetch_failed`). **Route-level, through the real `fetchMirrorBundle`:** the spare's
  `POST /setup-api/adopt`, mounted as `adoption-allocation-refusal.test.ts:173-197` mounts
  `mountSetup`, but with `adoptFromPrimary`'s `fetchBundle` the real `fetchMirrorBundle` (that test
  hands it a stub, `:73-99`), sent over plain `http` to a local main box route on `127.0.0.1` (the
  address guard allows a loopback host over either scheme, `primary-url.ts:6,50`) answering each
  code: the setup route answers 409 with that code and its
  parameters, writes nothing, and does not restart.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/mirror-bundle-fetch.test.ts src/adoption-allocation-refusal.test.ts`
  — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/setup-api.test.ts src/adopt.test.ts`; root
  `scripts/errors-reachable.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "joining: the spare shows each of the main box's refusals in its own words"`.

### Task 5.7: The spare runs the store

**Files:** Create `apps/server/src/spare-store.ts`. Modify `config.ts` (`WAITRON_VERSITYGW_BIN`,
default `versitygw`), `boot.ts` (start the store in the latch start and in a mirror's full start when
`readPairLink` gives `role: "serves"`; in the full start register it in `background-duties.ts` with
a reason), `scripts/versitygw-pin.test.ts` (one more case: "the spare's store names the same
version", reading `spare-store.ts` as text). `apps/server/src/testing/s3-test-server.ts:20` is
**not** changed: `scripts/setup-s3-test-server.test.mjs:234-240` expects that exact line, and
revision 2's import would have broken it. Test `spare-store.test.ts`.

**Interfaces — Produces:** `VERSITYGW_VERSION = "1.8.0"`; `SPARE_STORE_BUCKET = "waitron"`;
`SPARE_STORE_REGION = "us-east-1"` (as `s3-test-server.ts:176`);
`startSpareStore(deps: { bin; stateDir; accessKeyId; secretAccessKey; loopbackPort: number; spawn?; log }): Promise<SpareStore>`
— versitygw on `127.0.0.1:<loopbackPort>`, `posix --sidecar <state>/spare-store/meta
<state>/spare-store/data`, the bucket a folder created first, the keys in
`ROOT_ACCESS_KEY_ID`/`ROOT_SECRET_ACCESS_KEY`; restarted after it exits, with the stream
supervisor's backoff; `SpareStore = { loopbackUrl: string; stop(): Promise<void> }`.

- [ ] **Step 1: Write the failing tests** with a fake spawn: "passes the keys in the environment and
  never on the command line"; "listens on loopback only"; "starts again after versitygw exits"; and
  one case needing the binary: "the real versitygw answers with the pair's key and refuses another
  key with 403" (skips locally without it; add the file to the stream job's list, `ci.yml:1312-1323`
  and `scripts/ci-workflow.test.mjs:62-74`, and to the server shards' excludes, `ci.yml:1177`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/spare-store.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS, with the binaries installed
  (`node scripts/setup-s3-test-server.mjs`); then `src/boot.mirror.test.ts src/boot.failed-start.test.ts
  src/handover-stepdown.test.ts` and root `scripts/ci-workflow.test.mjs scripts/versitygw-pin.test.ts
  scripts/setup-s3-test-server.test.mjs`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a spare runs the store the main box will stream to"`.

### Task 5.8: The store's listener, which admits the paired main box only

**Files:** Create `apps/server/src/spare-pipe.ts` (the listener half). Modify `self-signed-cert.ts`
(a client-certificate issuer: `extKeyUsage` `clientAuth` only, the box's own name as its one name),
`box-secrets.ts` (`ensureLeaf` also keeps `tls/client.crt` and `tls/client.key` present, named for
this box, under the current authority), `boot.ts` (beside the store, on `config.spareStorePort`
from Task 5.5). Test `spare-pipe.test.ts`, `box-leaf-names.test.ts`.

**Interfaces — Produces:** `startStoreListener(deps: { port; host; certFile; keyFile; caFile; peerHostname: string; upstreamPort; log }): Promise<{ close() }>`
— a `node:tls` server with `requestCert: true`, `rejectUnauthorized: true` and `ca` the venue
authority, which also checks the presented certificate names `peerHostname` (the paired main box's
own name, from the pair link); each admitted connection is piped to the loopback store (probe P9's
shape); a refused one is logged `spare.store_client_refused` with its reason.

- [ ] **Step 1: Write the failing tests** with real TLS and a plain HTTP stand-in for versitygw:
  "carries a request from the paired main box's client certificate, Host header unchanged"; "a
  client with no certificate is refused and logged"; "a client certificate another authority signed
  is refused" (`CERT_SIGNATURE_FAILURE`); "the box's server leaf presented as a client certificate is
  refused" (`INVALID_PURPOSE`, probe P17); "a venue certificate for another box's name is refused";
  in `box-leaf-names.test.ts`: "every start leaves a client certificate for this box's name under
  its authority".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/spare-pipe.test.ts src/box-leaf-names.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/boot.mirror.test.ts src/box-secrets.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: the spare's store admits only its main box's certificate"`.

### Task 5.9: A spare stops a bucket copy; removing one that never finished joining lifts the stop

**Files:** Modify `stream-api.ts:227-250` (`PUT /api/backup/stream` refuses
`backup.spare_stream_active`, 409, when this box holds a pair link, before the probe),
`apps/dashboard/src/i18n/codes.ts` (words below), `apps/server/src/membership-removal.ts` (removing
the box a pair link names deletes this box's pair link, in a node transaction after the chart is
saved, then reloads the stream — the refusal's words offer this, so it must work). Remove accepts
only a standby with no `nodes` row (fact 26), so this lifts the stop for a spare that never
finished joining (D17), and not for a joined one. Tests `stream-api.route.test.ts`,
`membership-removal-api.test.ts`, `apps/dashboard/src/i18n/codes.test.ts`, the backup screen's test.

The words use the Servers screen's labels, "Standby" / «En espera» and "Remove" / «Retirar»
(fact 26; revision 2 said "spare box" and «quita»):
- EN: "This venue has a standby server, listed under Servers, which receives the venue's copy or is
  about to, and a venue copies its data to one place at a time. Nothing was saved. If the standby
  never finished joining, choose Remove on its row under Servers; the bucket can then be saved
  here. A standby that finished joining cannot be removed in this version, so the copy stays with
  it until an update lets the standby pass it on to a bucket."
- ES: "Este local tiene un servidor en espera, en la lista de Servidores, que recibe la copia del
  local o está a punto de recibirla, y un local copia sus datos en un solo sitio a la vez. No se ha
  guardado nada. Si el servidor en espera no terminó de unirse, elige Retirar en su fila de
  Servidores; después se puede guardar aquí el bucket. Un servidor en espera que terminó de unirse
  no se puede retirar en esta versión, así que la copia sigue yendo a él hasta que una
  actualización le permita pasarla a un bucket."

- [ ] **Step 1: Write the failing tests.** "refuses bucket settings while a pair link exists,
  saving nothing" (no `backup.stream` vault row afterwards); "removing a standby that never
  finished joining deletes the pair link, and bucket settings can then be saved"; "a standby with
  a `nodes` row is still refused removal, and its pair link stays" (fact 26's rule, now with a
  link); the screen shows the words in both languages.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/stream-api.route.test.ts src/membership-removal-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Look at the refusal on the backup screen in both themes and at phone width.
- [ ] **Step 4: Run** them — PASS; the dashboard tests.
- [ ] **Step 5: Commit** `git commit -s -m "server: a venue with a standby copies to it alone; removing an unfinished standby lifts that"`.

### Task 5.10: No key ring rotation under a joined spare (A1273)

**Files:** Modify `packages/credentials/src/cli.ts:180-189` (`rotate` refuses
`credentials.rotation_spare_joined` with exit 1 when `readPairLink` finds a link, before any
re-seal), `packages/credentials/src/errors.ts`, `docs/developers/conventions-data.md:928` (D7's
rule beside what a rotation reaches). Test `packages/credentials/src/cli.test.ts`.

The message (terminal, English, as the command's others; the dashboard's labels, fact 26): "This
box has a standby server, which holds this key ring too. Rotating here would leave the standby
unable to open the venue's keys. Nothing was changed. If the standby never finished joining,
remove it in the dashboard (Servers, then Remove on its row) and rotate again. A standby that
finished joining cannot be removed in this version, so this key ring cannot be rotated while it is
joined." (Revision 2 offered "remove the spare, rotate, add it again", which fact 26 rules out for
a joined spare.)

- [ ] **Step 1: Write the failing tests.** "rotate refuses while a spare is joined and re-seals
  nothing" (every row's `key_version` unchanged); control: "rotate runs with no pair link".
- [ ] **Step 2: Run** `pnpm --filter @waitron/credentials exec vitest run src/cli.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; root `scripts/errors-reachable.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "credentials: no key ring rotation while a spare holds the ring"`.

### Task 5.11: Final checks for 3b-5

- [ ] Typecheck `@waitron/server`, `@waitron/node-db`, `@waitron/credentials`, `@waitron/setup`,
  `@waitron/dashboard`; `pnpm format:check`; root `scripts/errors-reachable.test.ts`,
  `scripts/write-path-tables.test.ts`, `scripts/alert-codes.test.ts` (no new incident code is
  expected; it must stay green), `scripts/personal-log-params.test.ts`, `scripts/english-only.test.ts`.
  PR first line: "Adds a node.db migration (`node_pair_link`). A spare runs its store, which admits
  only its main box; nothing streams to it yet." `/finish-branch`, full path.

---

## PR 3b-G — the start steps that decide whether a box files (FISCAL — the owner lands it)

Full review path. **FISCAL** (D16): it changes what the start check trusts (R12) and how the boot
reconcile reaches a peer — the two start steps that can stop a box filing — and adds a start
refusal for a box that lost its `node.db`, so that box neither sells nor files. Built after 3b-4
(Task G.2 uses Task 4.1's lookup), beside 3b-5; **landed before 3b-6**, which makes a lost
`node.db` dangerous (fact 16). The fiscal suites run unedited. PR first line: "FISCAL — a box
trusts only the venue's authority when it asks another box at start, its start-time chart check
reaches a real box, and a box that lost its own record does not start selling or filing (A947 3b-G)."

### Task G.1: Every peer call trusts the venue authority and nothing else (was Task 4.2)

**Files:** Modify `start-peer-check.ts:191-196` (`authorityOf` returns this box's `tls/ca.crt` for
every peer), `boot-peer-check.ts:346-353` (the `rejectUnauthorized: false` branch and its comment
go; a TLS refusal records the silent reason `certificate`). Tests `boot-peer-check.test.ts`,
`start-peer-check.test.ts`.

**Changed checks:** the cases that ask a peer serving a certificate no authority signed and expect
an answer (`git grep -n "rejectUnauthorized\|authorityOf" -- 'apps/server/src/*.test.ts'`) now
expect silence with `certificate` (the expected value changes).

- [ ] **Step 1: Write the failing tests.** "a main box verifies its spare's certificate under the
  venue authority" (two local HTTPS servers under one authority); "a peer whose certificate another
  authority signed is silent, with the reason certificate" (Review Focus 5).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot-peer-check.test.ts src/start-peer-check.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/boot.start-check.test.ts src/waiting-start.test.ts`, and
  every suite naming the start check's client, unedited: `git grep -ln "boot-peer-check\|start-peer-check" -- 'apps/server/src/*.test.ts'`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box trusts another box's certificate only under the venue's authority"`.

### Task G.2: The boot reconcile uses the same transport (was Task 4.3)

**Files:** Modify `membership-reconcile.ts:60-78` (`fetchPeerMembershipDocument` sends through
`boxExchange` with the venue authority and a 5-second limit; its "unreachable → `null`" answers
stay), `boot.ts:1914-1935` (the peer address: the origin box's `contactUrl` from the held chart when
it lists one, else the mirror link's address). Tests `membership-reconcile.test.ts`,
`boot.reconcile.test.ts`. Uses Task 4.1's lookup in `boxExchange`, so it is built after 3b-4.

- [ ] **Step 1: Write the failing tests.** "fetches a peer's chart from a box under the venue
  authority" (fails today: the global `fetch` refuses the leaf); "answers null for a peer that does
  not answer within 5 seconds"; "answers null for a peer under another authority".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/membership-reconcile.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/boot.reconcile.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: the start's chart check reaches a real box, and gives up after five seconds"`.

### Task G.3: A box that lost its `node.db` does not start as a selling box (A1274; was Task 6.6)

**Files:** Modify `boot.ts` (before the role holders are built: when `readNodeMode` finds no row for
this node id and the held chart lists this node in any standing but `serving-primary`, or lists it
with another box as `serving-primary`, throw `node.state_missing`), `boot-failure.ts`, the recovery
page's words (`apps/server/src/i18n/recovery-page.ts`), `errors.ts`. Tests
`boot.node-state-missing.test.ts` (new), `recovery-surface.test.ts`.

The words (the recovery page's buttons are "Retry a normal boot" / «Reintentar un arranque normal»
and «Empezar de nuevo» for Start again, `recovery-page.ts:69,92,384-390`):
- Title EN: "This box has lost its record of which box it is". ES: "Este equipo ha perdido el
  registro de qué equipo es".
- Action EN: "It holds a copy of the venue's data but not its own role, so it does not sell or send
  anything to the tax agency, in case it is the venue's spare. The main box keeps selling. Retry a
  normal boot starts this box once more, and stops here again while the record is missing. While
  this box is stopped, the main box waits for it each time the main box starts, until an
  administrator chooses Carry on as the main box there. Start again empties this box, after an administrator
  signs in. In this version it cannot then join this venue again as its spare, because the main box
  still counts it as its standby, so the main box goes on waiting at each start in the same way; it
  can be set up for another venue. The venue's data stays on the main box."
- Action ES: "Guarda una copia de los datos del local, pero no su propio papel, así que no vende ni
  envía nada a Hacienda, por si es el equipo de reserva del local. El equipo principal sigue
  vendiendo. «Reintentar un arranque normal» vuelve a arrancar este equipo y se detiene aquí de nuevo
  mientras falte el registro. Mientras este equipo esté parado, el equipo principal lo espera cada
  vez que arranca, hasta que un administrador elige allí «Seguir como equipo principal». «Empezar de nuevo» vacía este
  equipo, después de que un administrador inicie sesión. En esta versión no puede volver a unirse a
  este local como equipo de reserva, porque el equipo principal lo sigue contando como su servidor
  en espera, así que el equipo principal sigue esperándolo de la misma forma en cada arranque; se
  puede configurar para otro local. Los datos del local siguen en el equipo principal."
- Revision 3 changed both: revision 2 promised the box could be added as a spare again, which D17's
  one-spare refusal and fact 26 now rule out, and said the main box was not affected. Revision 4
  adds the sentence saying the main box waits for this box at each of its starts until an
  administrator carries on (D17, probe P29); the button names are the guide's (`servers.md`
  `{#carry-on}`, English and Spanish).

- [ ] **Step 0:** The recovery page offers Start again only when a first-setup admission refusal
  carries a survey (`node-entry.ts:509-519`). Find, by a test, whether this refusal can carry one
  through the same path (its administrator sign-in over HTTPS and its Stop unchanged). If it cannot,
  STOP and report: the words above then name a choice the page does not offer, and the refusal rule
  (CLAUDE.md §3) needs a self-service way out that is not built.
- [ ] **Step 1: Write the failing tests.** "a spare whose node.db is lost refuses to start with
  node.state_missing and files nothing" (a joined spare's folder with `node.db` deleted, built as a
  fixture — a held chart listing this node as a standby and a `venue.db` holding its row — since no
  join brings data before 3b-6; the drain's stand-in is never called); control: "a first box with
  no mode row still starts as the sole primary" (the chart names it serving primary); "the recovery page shows the title, the action and
  Start again in both languages".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.node-state-missing.test.ts src/recovery-surface.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Render the page to a file and open it in both themes and at phone
  width (CLAUDE.md §4: string-rendered pages have no harness).
- [ ] **Step 4: Run** them — PASS; then `src/node-db-copy.test.ts` (its "reads as a sole primary
  once its node.db is lost" case stays: it reads the reader, not the start) and
  `src/boot.failed-start.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box that lost its own record does not start selling beside the main box"`.

### Task G.4: Final checks for 3b-G

- [ ] Typecheck `@waitron/server`; `pnpm format:check`; root `scripts/errors-reachable.test.ts`,
  `scripts/alert-codes.test.ts`, `scripts/personal-log-params.test.ts`. `git diff origin/main --stat
  -- packages/fiscal-verifactu` prints nothing, quoted in the PR body. The reconcile backlog entry's
  text is the session running this plan's, at landing. `/finish-branch`, full path; then wait for
  the owner to land it.

---

## PR 3b-6 — joining brings the data

Full review path. Unblocks "finished joining" for a venue that does not file with Veri*Factu.
Lands only after 3b-G is on `main` (fact 16). Not labelled FISCAL; D16 states why, and the PR
body's first line says: "From this PR, a main box with a joined spare asks it at start and waits
while it is silent (the landed A1018 Slice 3 rule), and a venue that does not file with Veri*Factu
can add a spare that receives its data over the venue's network." Task number 6.6 moved to 3b-G
(Task G.3) and is not reused.

### Task 6.1: The main box streams to the spare

**Files:** Modify `spare-pipe.ts` (`startStorePipe(deps: { storeUrl; authorityPem; clientCertFile; clientKeyFile; lookup?; log }): Promise<{ loopbackUrl: string; problem(): { reason: string; since: string } | null; close() }>`
— a `net` server on `127.0.0.1:0`; each connection tries the addresses `lookupBoxName` gives for the
store's host, `tls.connect` with `servername` that host, `ca` the venue authority, this box's client
certificate, `rejectUnauthorized: true`, then pipes; the last refusal is kept as `problem()`),
`stream-host.ts` (`start()` reads `readPairLink`: with `role: "streams"` and `state: "streaming"`,
it starts the pipe and builds the `BucketConfig` `{ endpoint: pipe.loopbackUrl, region:
SPARE_STORE_REGION, bucket: SPARE_STORE_BUCKET, prefix: "", accessKeyId, secretAccessKey }` with
`venueId` from the link; else today's bucket settings; `status()` reports the pipe's `problem()` as
the bucket problem when the supervisor has none). Tests `stream-host.test.ts`, `spare-pipe.test.ts`.

**Interfaces — Consumes:** `readPairLink`, `readPairSecret` (Tasks 5.1, 5.2); `lookupBoxName`
(Task 2.2).

- [ ] **Step 1: Write the failing tests.** "streams to the spare's store when the pair link says
  streaming"; "streams to the bucket when there is no pair link" (a pin); "a pipe refused by the
  spare's certificate puts the stream's bucket problem in its status" (Review Focus 3); "the main
  box keeps selling while the spare's store refuses every write" (Review Focus 4: a stand-in store
  answering 507; a sale's commit is not delayed past 1 second).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/stream-host.test.ts src/spare-pipe.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/stream-api.route.test.ts src/box-status.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: the main box streams to its spare's store over the venue's network"`.

### Task 6.2: The main box writes the spare's `nodes` row when its store answers

**Files:** Create `apps/server/src/spare-join.ts`; register it in `boot.ts`'s full start on the one
main box and in `background-duties.ts` (stopped at a stepdown). Test `spare-join.test.ts`.

**Interfaces — Produces:** `runSpareJoin(deps: { db; node; ring; nodeId; stream: StreamHost; probe?; intervalMs?; log; signal }): Promise<void>`
— while this box's pair link is `pending`: every 5 seconds probe the spare's store through a store
pipe with the pair's key (`packages/stream/src/probe.ts`); on the first success, in one `venue.db`
transaction insert the spare's `nodes` row through `insertReservedNodeTx`
(`packages/db/src/reserved-identity.ts:26-31`: name `<main box's name> (standby)`, the main box's
filing and tax modules, the spare's public key from the link, its endorsement re-made with
`endorseKey` — the same bytes, Ed25519 signatures being deterministic — and its location as
`venueLocationId`), skipping it when the row exists; then, in a node transaction, the link's state
→ `streaming`; then `stream.reload()`. One-line comment at the site: venue first, node after, and
why a re-run repairs it. A row whose public key differs from the link's is a fault in Waitron:
refuse and log `spare.join_key_mismatch`.

- [ ] **Step 1: Write the failing tests.** "writes the spare's row and starts streaming once its
  store answers"; "a pending spare whose store never answers is not a counted peer" (Review Focus 1:
  after 30 simulated seconds with a refusing probe, `joined(spareId)` is false, the start check
  proceeds, the link is still `pending`); "a crash after the row and before the link is repaired by
  the next run"; "a second join's link replaces a pending one".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/spare-join.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/handover-stepdown.test.ts src/boot.start-check.test.ts`,
  unedited: Task 6.2 changes neither the start check's code nor its tests (D16).
- [ ] **Step 5: Commit** `git commit -s -m "server: the main box records its spare once the spare's store answers"`.

### Task 6.3: The spare takes its first full copy

**Files:** Create `apps/server/src/spare-copy.ts`; run it in the latch start when the pair link is
`awaiting_copy`; `/api/box/status` there answers `{ adoption: "pending", copy: "waiting" |
"restoring" | "ready", bytes?, ms? }`. Test `spare-copy.test.ts`.

**Interfaces — Produces:** `takeFirstCopy(deps: { stateDir; node; ring; nodeId; litestreamBin; store: SpareStore; pinnedPrimaryKey: string; venueId; now; log; signal }): Promise<"ready">`
— every 5 seconds: `readPointer` from its own store over loopback (`packages/stream/src/pointer.ts`),
kept only when `verifyPointer` passes under the pinned main-box key (`node_primary_key`); then
`restoreGeneration` (`packages/stream/src/restore.ts:56`) of the pointer's generation into
`<state>/spare-copy/venue.db`; then, opening the copy read-only: integrity (`checkIntegrity`,
`restore-stream.ts:88`), not ahead of this software (`assertNotAhead`), and a `nodes` row for this
box whose public key is this box's own. A copy lacking the row is discarded and tried again (the
main box writes it before streaming, D6, so this is a late copy). Then it writes
`<state>/spare-copy/ready.json` and asks for a restart. Logs `spare.first_copy_ready` with `bytes`
and `ms` as D14 defines them (the pair link's `created_at` to the checks passing, both on this box's
clock).

- [ ] **Step 1: Write the failing tests** (fake store and fake restore): "restores the newest
  generation the main box signed"; "ignores a pointer another key signed" (control: the right key
  passes); "discards a copy without this box's row and tries again"; "ignores a pointer naming
  another venue id"; "reports waiting, restoring and ready, with bytes and ms, on the box status"
  (a fixed clock: `ms` equals ready minus `created_at`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/spare-copy.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/box-status.route.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a joining spare restores its first full copy from its own store"`.

### Task 6.4: The copy is put in place at the next start

**Files:** Create `apps/server/src/spare-copy-placement.ts`; call it in `boot.ts` before the venue
store opens. Modify the hand lists of `scripts/backup-room-note.test.ts` and
`scripts/spare-space.test.ts` (the placement replaces the live `venue.db`). Test
`spare-copy-placement.test.ts`.

**Interfaces — Produces:** `placeFirstCopy(deps: { stateDir; venueDir; log }): Promise<boolean>` —
when `ready.json` exists: under `lockVenueDatabase`, delete `<state>/backup-room-note.json` first
(CLAUDE.md §3), remove `venue.db-wal`, `venue.db-shm` and `.venue.db-litestream/`, rename the copy
over `venue.db`, remove `ready.json` last; a crash at any point re-runs at the next start.

- [ ] **Step 1: Write the failing tests.** "puts the copy in place before the store opens, keeping
  node.db, secrets.env and tls/" (their bytes unchanged); "deletes the backup-room note before
  replacing venue.db"; "a crash after the rename finishes at the next start".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/spare-copy-placement.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; root `scripts/backup-room-note.test.ts scripts/spare-space.test.ts
  scripts/write-path-tables.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a spare puts its first copy in place at its next start"`.

### Task 6.5: Joining finishes

**Files:** Modify `finish-adoption.ts` (`runFinishAdoption` no longer establishes: it checks that
this box's `nodes` row exists with its own public key — else keeps the latch and logs —
`ensureMirrorViewer`, clears the latch, sets the pair link to `copied`, and asks for a restart; the
`PendingAdoption` comment's "nothing copies" sentence goes), `reserved-identity.ts`
(`establishReservedStandbyIdentity`: Step 0 decides). Tests `finish-adoption.test.ts`,
`reserved-identity.test.ts`, `boot.adoption-allocation.test.ts`, `boot.mirror.test.ts`.

- [ ] **Step 0:** `git grep -n "insertReservedNodeTx\|establishReservedStandbyIdentity" -- apps packages`;
  record which callers remain once finishing no longer inserts the row. If none remains outside
  3b-F's reach, leave the function for 3b-F; write the Changed checks rows for the three suites
  before the code.
- [ ] **Step 1: Write the failing tests.** "joining finishes when the copy holds this box's row, and
  the next start is a mirror" (a boot test: the latch is gone, `holders.mode.current` is `mirror`,
  `/api/node` answers `acceptingSales: false`); "keeps the latch when the row's key is not this
  box's".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/finish-adoption.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/boot.mirror.test.ts src/boot.adoption-allocation.test.ts
  src/reserved-identity.test.ts src/allocated-standby-host.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a spare whose copy holds its own row finishes joining"`.

### Task 6.7: The setup app's joined screen tells the truth

**Files:** Modify `apps/setup/src/i18n/strings/finish.ts` (the `done.stalled.*` keys,
`:75-81`, and `done.break_glass.join_stalled`, `:73`, go; new `done.joining.*`), the joined screen
that reads them, its test.

The words:
- Heading EN: "This server is joining". ES: "Este servidor se está uniendo".
- Body EN: "The sign-in to the restaurant's primary worked. This server now takes its first copy of
  the restaurant's data from the primary, over the restaurant's network; no internet is needed. This
  can take a few minutes. It restarts by itself when it has the copy, and then waits as the
  standby. The primary keeps selling throughout."
- Body ES: "El inicio de sesión en el servidor principal del restaurante ha funcionado. Este servidor
  recibe ahora su primera copia de los datos del restaurante desde el principal, por la red del
  restaurante; no hace falta internet. Puede tardar unos minutos. Se reinicia solo cuando tiene la
  copia y después espera como servidor en espera. El principal sigue vendiendo todo el tiempo."

**Changed checks:** every case reading `done.stalled.*` or `join_stalled` (`git grep -n
"stalled" -- apps/setup/src`) — the words they expect change.

- [ ] **Step 1: Write the failing tests:** the screen shows the heading and body in both languages,
  and no sentence sends the person to anyone.
- [ ] **Step 2: Run** `pnpm --filter @waitron/setup exec vitest run` on the screen's test — FAIL.
- [ ] **Step 3: Implement.** Look at it in both themes and at phone width.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "setup: the joined screen says the spare is taking its copy"`.

### Task 6.8a: The seams a third in-process server needs

**Why** (departure 11, C1): 3b-6's two-box steps run in a new test file on a main box whose
`modules.json` is `{"fiscal-verifactu": false}`, because the stream loop's box B files with
Veri*Factu — box A's `modules.json` is `{"fiscal-none": false}`
(`testing/stream-loop-scenario.ts:359-362`) and B is a bucket restore of A with a Veri*Factu paper
allocation (`:470-496`) — and the main box checks its own modules (D12), so B refuses every join
until 3b-F (probe P24). The loop's own box B gains its spare steps in 3b-F (Task F.2b). Running two
boxes and a bucket server in one test process needs two seams first.

**Files:** Modify `boot.ts` (`StartServerSeams` gains `boxLookup?`, handed to every
`lookupBoxName` call — `boxExchange` through the setup routes and adopt, the start check, and the
store pipe — and `restart?`, which every restart request a start makes goes through: today the
setup start's `boot.ts:1389` (backup repair) and `:1648` (after adopt, the one the two-box test
meets), the time-zone repair start's `:2154`, and the full start's `:3390` and `:3449`, each of
which signals this process, so a test that let them run would stop its own runner; the stepdown's
`:3752` already takes `seams.stepdown.restart`. The latch start's restarts after the first copy and
after finishing (Tasks 6.3, 6.5) are new code and take the seam from the start). Tests in the
suites that already boot each start: `boot.setup-routes.test.ts`, `boot.adoption-allocation.test.ts`.

- [ ] **Step 1: Write the failing tests.** "an adopt in the setup start restarts through the seam,
  not by signalling the process" (the seam is called once; the process gets no signal); "a setup
  start's box-to-box call resolves a `.local` name through the injected lookup" (a lookup answering
  `127.0.0.1` for a name nothing else resolves: the certificate read reaches a local server).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.setup-routes.test.ts src/boot.adoption-allocation.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `src/boot.test.ts src/boot.mirror.test.ts src/handover-stepdown.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a test can hand boot its name lookup and its restart"`.

### Task 6.8b: A two-box test file, its shared box set-up, and its CI place

**Files:** Create `apps/server/src/spare-join.e2e.test.ts` and `testing/spare-join-scenario.ts`
(the phases, run as the loop runs its own: a phase list, a summed time limit, an abort signal);
move the stream loop's box provisioning (its step 2, the state folder, venue, node key and term-0
chart) into an exported helper in `testing/stream-box.ts` taking the `modules.json` contents, called
by both scenarios — the loop's behaviour and its test file unchanged. Add the new file to
`STREAM_TEST_FILES` (`scripts/ci-workflow.test.mjs:62-74`), to the stream job's list
(`ci.yml:1312-1323`) and to the server shards' excludes (`ci.yml:1177`).

What the harness sets up, for three servers in one process (main box M, spare S, and the S3 test
server the file starts for the bucket step), using Task 6.8a's seams:
- every port from **one** `freePorts(n)` draw (CLAUDE.md §4): M's and S's HTTPS ports, S's store
  port (`WAITRON_SPARE_STORE_PORT`, Task 5.5; S sends it in its store address, D15, so nothing
  assumes 7443) and S's versitygw loopback port;
- `WAITRON_ADVERTISED_ORIGIN` = `https://waitron.local:<port>` for each, so each box makes its own
  name (D1 leaves any other host as configured, and a `localhost` origin would test nothing);
- a `boxLookup` that answers `127.0.0.1` for every `.local` name, and a `restart` seam that closes
  and restarts that server in the test;
- S started from an empty state folder, so it boots in setup mode.

- [ ] **Step 1: Write the failing test** `spare-join.e2e.test.ts` with its first phase only:
  `probe` — M is provisioned (`{"fiscal-verifactu": false}`) and started selling; S is booted from
  an empty state folder and answers `POST /setup-api/primary-certificate` for M's address with M's
  authority. If S cannot boot in setup mode inside the test process, STOP and report: the two-box
  steps then need child processes, which is a different task.
- [ ] **Step 2: Run** `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`,
  then `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/spare-join.e2e.test.ts`
  — FAIL (no harness yet); read the `Tests` count.
- [ ] **Step 3: Implement** the helper move and the harness.
- [ ] **Step 4: Run** it — PASS; then `src/stream-loop.e2e.test.ts` (unchanged, still PASS) and root
  `scripts/ci-workflow.test.mjs`.
- [ ] **Step 5: Commit** `git commit -s -m "test: a two-box test file, sharing the stream loop's box set-up"`.

### Task 6.8c: The two-box test — refused, then joined, then copied

**Files:** `testing/spare-join-scenario.ts`, `spare-join.e2e.test.ts`.

The phases after `probe`:
1. `spare-refused`: M streams to the S3 test server's bucket; S's `POST /setup-api/adopt` against M
   answers 409 `mirror.bucket_stream_active` — through the real `fetchMirrorBundle`, so this is also
   Task 5.6b's relay end to end; M's chart and reservations are unchanged.
2. `bucket-stopped`: `DELETE /api/backup/stream` on M.
3. `spare-join`: S adopts with a confirmed authority; M's pair link reaches `streaming`.
4. `spare-copy`: S logs `spare.first_copy_ready`, restarts (through the seam), puts the copy in
   place, finishes joining and starts as a mirror; its `venue.db` holds M's sales of the earlier
   phases and its own `nodes` row; M's `nodes` table holds S's row.

- [ ] **Step 1: Write the phases** and their checks.
- [ ] **Step 2: Run** the file — PASS, with the phase log showing the four phases `ok`. Control:
  comment out Task 6.2's row write, see `spare-copy` fail for that reason (the copy lacks S's row and
  is discarded), restore it.
- [ ] **Step 3: Commit** `git commit -s -m "test: a spare joins a main box over the venue's network and takes its copy"`.

### Task 6.9: The two-box test — the spare is counted, and nothing left loopback

**Files:** as Task 6.8c.

The phases:
5. `start-check`: M restarts; its start check asks S at `box-<S>` and counts its verified answer
   (R13 end to end, under 3b-G's pin), with no `own_address`.
6. `loopback-only`: no socket the servers in this process opened went to an address other than
   loopback (a `net.Socket.prototype.connect` spy installed for the two-box phases; Litestream's and
   versitygw's addresses are loopback by configuration). The test prints the copy's `bytes` and `ms`
   as numbers for the PR, not as a bound.

- [ ] **Step 1: Write the phases.**
- [ ] **Step 2: Run** the file — PASS. Control: bind both servers to `0.0.0.0` and point the
  injected lookup at **one of this machine's own non-loopback addresses** (from
  `os.networkInterfaces()`), so the join still succeeds over it, and see `loopback-only` fail naming
  that address. (An address that is not this machine's would make `spare-join` fail first, which
  proves nothing about the spy.) Then root `scripts/ci-workflow.test.mjs`.
- [ ] **Step 3: Check the stream job's time on CI** after the push: it ran 148–160 seconds on recent
  green runs (probe P19). If it passes about 4 minutes, split by the cause, never cut a check
  (CLAUDE.md §2).
- [ ] **Step 4: Commit** `git commit -s -m "test: the main box counts its spare, and joining stays on the venue's network"`.

### Task 6.10: The guide, the docs, and final checks

**Files:** `apps/server/src/guide/en/servers.md` and `guide/es/servers.md` (a section "Adding a spare
box" / «Añadir un equipo de reserva» with the shared `{#adding-a-spare}` heading id — A1283: what
each box must have; that no internet is needed; that the second box's setup is opened at the address
its console prints; the fingerprint comparison; that a venue copying to its own bucket cannot add a
spare yet, and what to do; that a key ring is not rotated while a spare is joined; that a standby
that finished joining cannot be removed in this version, and one that never finished can, under
Servers; and that while a joined standby is off, the main box waits at each start until an
administrator carries on, linking the existing `{#carry-on}` section); the session running this
plan adds the backlog entry D17 names ("a joined standby cannot be retired, so a dead spare makes
the main box wait at every start"), in the A947 area;
`docs/developers/conventions-data.md` (one entry: the pair link and the store). Final checks:
typecheck every touched package, `pnpm format:check`, root `scripts/guide-links.test.ts`,
`apps/server` `src/guide-content.test.ts`, `scripts/errors-reachable.test.ts`,
`scripts/claude-md-pointers.test.ts`. PR first line: "A spare now receives the venue's data over the
venue's network and finishes joining (venues that do not file with Veri*Factu; 3b-F brings those)."
`/finish-branch`, full path.

### Task 6.11: The owner's measurement, and recording it (no implementer)

3b's pull requests land without this; the backlog entry "Adding a mirror while the internet is down"
(`docs/backlog/replication-cloud.md:280-293`) stays open until it is done. **The owner** measures, on
two boxes on one switch with the internet unplugged from the switch, the main box holding the
venue's real data:

1. Add the spare from its own setup page (the address its console prints). Note both boxes' clocks.
2. Wait for the spare to restart by itself. On the spare, read `/api/box/status` (or its log line
   `spare.first_copy_ready`): it gives `bytes` and `ms` (D14).
3. On the main box, Servers lists the spare; restart the main box and check it starts without
   waiting (its log line `handover.start_check` lists the spare as answered).
4. Read both boxes' clocks again (§11's rehearsal note).

**The session running this plan** then records the figures, the box hardware and the database size
in a dated note in the design (§11's 3b line), and deletes the backlog entry, turning anything the
measurement leaves open into its own short entry (CLAUDE.md §6, the docs rule).

---

## PR 3b-F — a Veri*Factu venue can add a spare (FISCAL — the owner lands it)

Waits for Q1. Full review path; the fiscal suites run unedited unless a row says otherwise.

### Task F.0: The trace so far, and what remains

**Run now (2026-11-04):**
- Where the setup lives and who reads it: `establish` writes it into the establishing box's own
  `module-preparation-state.json`, and a promotion reads the promoting box's own file (fact 18,
  read); a promotion with no retained setup is refused before it writes, and `establish` without a
  person's authority returns `false` and touches no database (probe P15, run); the fiscal module's
  dormant-setup suite passes, 54 cases, including "reserves dormant configuration before the
  standby node exists", "refuses a missing standby at establishment" and "requires a durable host
  before exposing an establishment token"; the server's adoption refusal and standby host suites
  pass, 10 cases (probe P16, run).
- So revision 1's option (a), "the main box writes it and the copy carries it", **cannot work**: a
  copy of `venue.db` does not carry `module-preparation-state.json`.

**Read only, not run:**
- that `establish` can run on the spare once its copy holds its own `nodes` row and the main box's
  active filing registration (`hour-dormant-standby.ts:199-245`), with a person signed in on the
  spare against the copy's password hashes;
- that a setup written at joining records the main box's invoice series bases as they were then;
- that neither the A1018 plan nor A947's 4b says who writes the setup before an activation (a search of the
  A1018 plan for "dormant" and "establish" finds no such step).

**Run since (A1018 Slice 5's review of its dormant-setup step, 2026-11-05):** with a setup already
held and a series the main box added later, or a series it replaced, the switch-on does **not**
refuse. A real selection and promotion on M2 printed `OK` on the old series, and the new one was gone
with no word. With no setup held, a fourth series is refused at the first request,
`series_configuration_unsupported`, and a replaced one is carried correctly. Revision 4's guess that
it refuses came from a test's title. Slice 5's Ruling R39 leaves this to be settled before this PR or
Slice 13: see the backlog's entry on a dormant setup.

Task F.1 runs the first of these under the option the owner picks.

### Task F.1: The failing test for the chosen option

- [ ] **Under (c), the default:** `apps/server/src/spare-join.fiscal.test.ts`, on a spare's database
  holding a copy (the pattern of `allocated-standby-host.test.ts:189-229`, the fiscal module
  enabled): "a Veri*Factu venue's join writes no fiscal row and no dormant setup" (the module's
  tables and `module-preparation-state.json` unchanged across the join); "a spare with no dormant
  setup cannot be switched on and writes nothing" (`sif.allocation_invalid`, `reservation_mismatch`,
  probe P15's shape through the route); and the viability case for the switch-on slices: "on the
  spare, under a person's sign-in, reserve then establish writes a dormant setup that a promotion
  then reads" (the input `{ kind: "hour-dormant", version: 1 }`). The first FAILS today at the
  joining route (D12); the other two may pass, and say so.
- [ ] **Under (b):** STOP. Write the tasks for the spare's second sign-in screen and its
  reserve-and-establish, and have them reviewed, before any code.

### Task F.2: Implement (c)

- [ ] `assertAdoptionModules` (`finish-adoption.ts:20-26`) and Task 5.3's check let through a module
  whose standby series is `on-activation` and whose dormant setup is written at switch-on (today:
  `fiscal-verifactu`); `reserved.series` stays empty for it. The setup app's words for
  `module.operation_invalid` on the adopt path go (Task 5.6), and their test with them. Every fiscal
  suite runs unedited, or each changed check has a row marked FISCAL — owner rules. Run F.1 — PASS;
  then `pnpm --filter @waitron/fiscal-verifactu exec vitest run` and the golden and immutability
  suites. One line in the backlog's A947 4b entry and the A1018 plan's Slice 5 and 7 notes, by the
  session running this plan: the activation writes the spare's dormant setup first.

### Task F.2b: The stream loop's Veri*Factu box gains its spare steps

**Files:** `apps/server/src/testing/stream-loop-scenario.ts` (new phases after `restore-compare`,
added to `STREAM_LOOP_PHASES` and to `STREAM_LOOP_SCENARIO_MS`'s sum; if the file passes about 900
lines, the phases go in `testing/stream-loop-spare.ts`, called from it), using Task 6.8a's seams, Task 6.8b's
`testing/stream-box.ts`. This is where §11's "every slice adds its step to the stream loop test"
lands for 3b (departure 11): the loop's box B files with Veri*Factu, so its join can pass only once
F.2 lets it through.

The phases, with box C a third server folder booted in setup mode:
1. `spare-refused`: B streams to the loop's bucket; C's `POST /setup-api/adopt` against B answers 409
   `mirror.bucket_stream_active`; B's chart and reservations are unchanged.
2. `bucket-stopped`: `DELETE /api/backup/stream` on B.
3. `spare-join`: C adopts; B's pair link reaches `streaming`; no fiscal row and no dormant setup is
   written on either box (under (c)).
4. `spare-copy`: C restarts as a mirror holding B's sales and its own `nodes` row.
5. `start-check`: B restarts and counts C's verified answer.

- [ ] **Step 1: Write the phases.** Before F.2, phase 3 fails with `module.operation_invalid`
  `{ module: "fiscal-verifactu" }`: run it once and record that as the failing state.
- [ ] **Step 2: Run** `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/stream-loop.e2e.test.ts`
  with F.2 in place — PASS, every new phase `ok`; check the stream job's time on CI as Task 6.9.
- [ ] **Step 3: Commit** `git commit -s -m "test: the stream loop's Veri*Factu box adds a spare"`.

### Task F.3: Final checks

- [ ] As Task 6.10's final checks, plus `git diff main -- packages/fiscal-verifactu` (empty under
  (c)) quoted in the PR body. PR first line: "FISCAL — a Veri*Factu venue can add a spare; its
  dormant tax-filing setup is written when it is switched on."

---

## What CI and the simulation prove, and what needs the owner's two boxes

**Proved in CI** (the stream job runs Linux with both binaries), **by PR:**
- **3b-6**, `spare-join.e2e.test.ts`, on a main box with the Veri*Factu module switched off: the
  store, the pipes, the pair's key, the client certificate and the authority pin, end to end on
  loopback; the refusal while a bucket streams, reaching the spare's setup route in its own code,
  and the join after the bucket is stopped; the first full copy, the placement, finishing joining,
  the main box's start check counting and verifying the spare; that the servers in the test opened
  no socket off loopback. It does **not** prove a join to a main box that files with Veri*Factu —
  that is refused until 3b-F, and Task 5.3's route test and Task 5.6b's relay test prove the
  refusal — nor anything about the stream loop's box B.
- **3b-F**, the stream loop (Task F.2b): the same join, copy and start check on the loop's box B,
  which files with Veri*Factu and was rebuilt from a bucket; and, under (c), that the join writes no
  fiscal row and no dormant setup.
- **3b-G** has no end-to-end step of its own: its three changes are proved by their own suites
  (Tasks G.1–G.3), and 3b-6's `start-check` phase runs under G.1's pin.
This is a simulation: servers on one machine, names resolved by an injected lookup, one network
interface. The mDNS lookup's own-address filter is proved with fake sockets
(Task 2.2) and was measured with two Linux containers (probe P14), not on the box image.

**Not provable in CI, and why:** that two real boxes find each other by mDNS on a real switch (CI has
one host); how long the first full copy takes for a real venue's database on the box's hardware and
network (Task 6.11); that nothing in joining reaches for the internet on a box whose cable is
unplugged (the test watches only its own process's sockets, not Litestream's or the operating
system's).

---

## Questions for the owner

### Q1 — When does a Veri*Factu venue's spare get its dormant tax-filing setup: when it is switched on, or when it joins?

**What it is.** A spare that can later take over filing needs a small piece of tax-filing setup kept
for it: which taxpayer, which environment (production or testing), and which invoice series names it
will base its own on. Writing it needs a person who may approve it to be signed in at that moment, and
it is kept in a file on the box that writes it — not in the venue's database, so the copy the spare
receives does not carry it (fact 18). The design says nothing fiscal is reserved at joining (§4
item 3: "No fiscal identity is reserved at joining… This design adds nothing to that"). Today's code
refuses to add a spare to a Veri*Factu venue at all — after the main box has already reserved for it
and listed it (fact 1); 3b-5 moves that refusal before anything is reserved.

**A worked example.** Friday afternoon, before service, you plug the second box in, open its setup
page and press Connect, signing in as yourself. On Saturday at 21:40 the main box dies, and the
manager on shift switches to the spare from a till, signing in as herself.

- **(c) At switch-on — recommended.** On Friday the spare joins and takes its copy; nothing fiscal is
  written, as §4 item 3 says. On Saturday, the switch-on first writes the spare's setup from the copy
  it holds, under the manager's sign-in, then names its installation. 3b-F is small: it lets the join
  through for this module and proves that a spare without the setup cannot be switched on and writes
  nothing (probe P15). The setup records the series as they are on Saturday, not Friday. Cost: the
  switch-on slices (A947's 4b, and A1018 Slices 5 and 7's activation) gain this one step, which
  neither plan names today; until one lands, nothing can switch the spare on anyway. Whether the
  spare can write the setup from its copy under the manager's sign-in is read from the code, not
  yet run; Task F.1 runs it.
- **(b) At joining.** On Friday, when the spare's copy arrives a few minutes after Connect, its setup
  page asks you to sign in once more ("Finish joining"), and the spare writes its setup then. If you
  walk away first, the spare keeps asking, and until you sign in it cannot be switched on. This
  changes §4 item 3, adds a screen, and records the series as they were on Friday; a series added to
  the main box later is dropped at Saturday's switch with no refusal, if that setup is still held
  (run, A1018 Slice 5's Ruling R39; Task F.0).

Revision 1's alternative, "the main box writes it and the copy carries it", cannot work: the copy
does not carry that file.

**Recommended default: (c).** Either way 3b-F lands last and you land it. You also land 3b-G (the
start steps that decide whether a box files, D16); the other six pull requests never wait for you.

---

## Probes

Revision 1's probes' scratch files are under `/tmp/a947-3b-*`; revision 2's under
`/tmp/a947-3b-r2.Jztr/`; revision 3's under `/tmp/a947-3b-r4/`, with the third claim check's own
under `/tmp/a947-3b-r3.Iv7F/` — all outside the worktree.

| # | Command | What it printed | Decides |
| --- | --- | --- | --- |
| P1 | `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/mirror-bundle-api.test.ts -t no_relay` | `Tests 1 passed \| 37 skipped` | fact 3 |
| P2 | (from `apps/server`, with its `tsx`) `tsx /tmp/a947-3b-probe.oe1e/cert-probe.mts`: an authority from `mintSelfSignedServerCert`, leaves from `reissueServerLeaf`, `node:tls` connects with `servername` | own name, box authority: `verified`; venue name, same leaf: `verified`; another authority: `refused: CERT_SIGNATURE_FAILURE`; leaf without the own name: `refused: ERR_TLS_CERT_ALTNAME_INVALID`; a name outside waitron.local: `refused: UNSPECIFIED` | fact 10, Task 3.1 |
| P3 | `pnpm --filter @waitron/server exec vitest run src/mirror-bind-guard.test.ts`; `git grep -n MIRROR_ALLOW_EXPOSED -- deploy` | `Tests 6 passed`; nothing | fact 6 |
| P4 | `tsx /tmp/a947-3b-probe.oe1e/r13.mts`: `endorsedKeyOf` over charts built with `buildNextMembershipDocument` | today's chart: `spare key known = false`; with the main box's endorsement: `matches = true`; endorsement signed by the wrong key: `known = false` | fact 8, Task 4.4 |
| P5 | `docker run --rm node:26-slim …`: `grep ^hosts /etc/nsswitch.conf`, `ls /lib/*/libnss_mdns*`, then a `multicast-dns` responder answering `equipo-7f3a.waitron.local` in the same container, `dns.lookup` and a `multicast-dns` query | `hosts: files dns`; no such file; `getaddrinfo (what fetch uses): EAI_AGAIN`; `mDNS query from Node: 127.0.0.1` | fact 7, Task 2.2 |
| P6 | `pnpm --filter @waitron/server exec vitest run src/adoption-allocation-refusal.test.ts`; `git log -S assertAdoptionModules --oneline -- apps/server/src/finish-adoption.ts` | `Tests 5 passed`; `59d51560f8 W41s-4 … (#1700)` | fact 1 |
| P7 | In `node:26-slim` (linux/aarch64), the pinned linux-arm64 Litestream 0.5.17 and versitygw 1.8.0, versitygw serving TLS with a leaf from the box authority, `litestream replicate` for 12 s per case, then `litestream restore` (`/tmp/a947-3b-linux.ihXa/run.sh`, `run2.sh`) | `SSL_CERT_FILE` = the authority: 2–3 files in the store; no trust: 0 files; another authority: 0; wrong secret: 0, and `StatusCode: 403` logged; restore `exit 0`, `restored rows 2000`; no trust for 90 s: `files: 0` and no `x509` or `ERROR` line | fact 11, D5, Review Focus 3 |
| P8 | The same on macOS 26 with the darwin-arm64 binaries, endpoint `https://127.0.0.1:17443` | the right authority in `SSL_CERT_FILE`: `files 0`; another: `files 0`; control over plain HTTP: `files 3` | fact 11, D5 |
| P9 | macOS: Litestream → plain HTTP on loopback → Node `tls.connect` pinned to an authority, `servername` `equipo-7f3a.waitron.local` → Node `tls.createServer` with the leaf → plain TCP to versitygw (`/tmp/a947-3b-mac.Wgln/pipes.mjs`, `run-pipes.sh`) | pinned to the right authority: `files 3`, restore `exit 0 rows 5000`; to another: `files 0; refused: CERT_SIGNATURE_FAILURE` | fact 12, D5, Tasks 5.8, 6.1 |
| P10 | `curl` of the darwin-arm64 and linux-arm64 versitygw 1.8.0 tarballs, `shasum -a 256`, `versitygw --help`, `diff LICENSE deploy/third-party/licenses/Apache-2.0.txt`, `cat NOTICE` | sums equal the pins; `--access … [$ROOT_ACCESS_KEY_ID, $ROOT_ACCESS_KEY]`, `--secret … [$ROOT_SECRET_ACCESS_KEY, …]`; `0a1 >` (one blank line); `versitygw - Versity S3 Gateway` / `Copyright 2023 Versity Software`; the linux binary is 54489706 bytes | fact 13, Tasks 1.1–1.2, 5.7 |
| P11 | `curl` of `cmd/litestream/main.go` and `s3/replica_client.go` at tag `v0.5.17` from `raw.githubusercontent.com/benbjohnson/litestream`, then `grep` | `SkipVerify` at `main.go:1136`, `RootCAs … yaml:"root-cas"` inside the NATS settings at `:1175`; `replica_client.go:384-410` builds `http.Transport` and sets `TLSClientConfig` only `if c.SkipVerify` | fact 11 |
| P12 | `command -v go` | nothing | Task 1.2 |
| P13 | `docker run --rm -v <worktree>/node_modules/.pnpm:/pnpm:ro -v /tmp/a947-3b-r2.Jztr:/p:ro node:26-slim node /p/self.mjs loop`, then `… noloop`: one process, a `multicast-dns` responder answering `waitron.local` with the container's address and a querier, default options, then both with `loopback: false` | `loopback=true own=127.0.0.1,172.17.0.2 answers=172.17.0.2 from 172.17.0.2`; `loopback=false … answers=none` | fact 5, D3, Task 2.2 (C1) |
| P14 | Two `node:26-slim` containers on Docker's default bridge: `main.mjs` answering `waitron.local` with its address; `joiner.mjs` running its own responder for `waitron.local` and a querier, then dropping its own addresses | main `172.17.0.2`; joiner `own=127.0.0.1,172.17.0.3 all=172.17.0.3,172.17.0.2 first=172.17.0.3 kept-after-own-filter=172.17.0.2` | D3, Tasks 2.2, 4.1 (C1) |
| P15 | (from `apps/server`) `pnpm exec tsx /tmp/a947-3b-r2.Jztr/dormant.mts`: `readRetainedHourDormant([], promote binding)`; `establishHourDormant(<a proxy that records any use>, standby, state, undefined)` | `no retained setup: refused sif.allocation_invalid {"reason":"reservation_mismatch"}`; `establish with no operation returned false database touched: no` | fact 18, Q1, Task F.1 |
| P16 | `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/fiscal-verifactu exec vitest run src/hour-dormant-standby.test.ts`; the same for `@waitron/server` with `src/adoption-allocation-refusal.test.ts src/allocated-standby-host.test.ts` | `Tests 54 passed (54)`; `Tests 10 passed (10)` | fact 18, Task F.0 |
| P17 | (from `apps/server`) `pnpm exec tsx /tmp/a947-3b-r2.Jztr/client-cert.mts`: a `tls.createServer` with `requestCert: true`, `ca` the box authority, reporting `authorized` and `authorizationError` per client | no certificate: `authorized=false reason=UNABLE_TO_GET_ISSUER_CERT`; today's leaf as client: `authorized=false reason=INVALID_PURPOSE`; a venue-signed certificate with `clientAuth`: `authorized=true`; another authority's with `clientAuth`: `authorized=false reason=CERT_SIGNATURE_FAILURE` | fact 21, D5, Task 5.8 (I9) |
| P18 | (from `apps/server`) `pnpm exec tsx /tmp/a947-3b-r2.Jztr/ensure.mts`: `ensureBoxSecrets` on a state folder with (1) `tls/` empty and `secrets.env` kept, (2) `tls/ca.*` kept and no leaf, (3) both gone | (1) `refused setup.not_ready`; (2) `refused setup.not_ready`; (3) `minted: ca.crt,ca.key,server.crt,server.key` | fact 20, D9, D13, Tasks 3.1, 3.2 (C2) |
| P19 | `gh run list --workflow ci.yml --status success --limit 25`, then each run's `test-server-stream` job start and end | four recent runs: 148 s, 160 s, 151 s, 155 s | Task 6.9 |
| P20 | `gh pr view 2442 --json state,mergedAt` | `"state":"OPEN"`, `"mergedAt":null` | the A1018 table |
| P21 | `git fetch origin main && git log --oneline 6a52e7189c..origin/main`; on 2026-11-04 for revision 3, `git fetch` then `git diff --stat 6a52e7189c origin/main -- apps packages deploy scripts .github` with `origin/main` at `cbca8c8ba0` | plan commits only (`A1301 S18 …`); the diff printed nothing | line numbers |
| P22 | `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/membership-removal-api.test.ts -t "standby_joined"` | `Tests 2 passed \| 37 skipped`: "refuses a standby this database holds a node row for as membership.standby_joined (409)" and the under-the-lock twin; if a joined standby could be removed, both would fail | fact 26, D7, D17, Tasks 5.9, 5.10 |
| P23 | `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/mirror-bundle-fetch.test.ts -t "passes no\|a code other than\|relays the primary"` | `Tests 4 passed \| 75 skipped` | fact 27, Task 5.6b |
| P24 | (from `apps/server`) `pnpm exec tsx /tmp/a947-3b-r3.Iv7F/loopmods.mts` (the third claim check's script, re-run): the real `ALL_MODULES` through `enabledModules` and `assertAdoptionModules` | `{"fiscal-none":false} enabled fiscal: [ 'fiscal-verifactu' ] -> module.operation_invalid {"module":"fiscal-verifactu"}`; `{"fiscal-verifactu":false} enabled fiscal: [ 'fiscal-none' ] -> no refusal` | C1, D12, Tasks 6.8a, F.2b |
| P25 | `node /tmp/a947-3b-r4/flap-jitter.mjs`: D3's setup-mode rule, two boxes switched on within 2 s of each other, 0.1 s steps for 10 minutes, 2,000 runs with and without the random delay; an ask is answered only by a box answering when it is sent. A first version also let a box hear answers that began after its ask; its no-delay control then never showed the known fault, so it was corrected before use | without the delay: `still-both-at-10-min=1909` of 2000; with 0–10 s: `still-both-at-10-min=0`, last moment both answered median `37.3s`, p99 `183.5s`, max `339.3s` | D3, Task 2.3b (M2) |
| P26 | `git log origin/main --oneline \| grep -i a1018` | `4fd28f1b38 FISCAL — A1018 Slice 3: a box asks the other box before it sells…(#2436)`; `fcc6f1a390 FISCAL: a box that has stepped down stays down (A1018 Slice 2) (#2420)`; `4aeb14613c … (A1018 slice 1) (#2417)`; `945cdc7963 docs(backlog): A1018 slices 0 and 1 are built …`; `7d183efe2c Bench: S2 … (#2431)` | D16, the A1018 table |
| P27 | `gh pr view 2442`, `2422`, `2428 --json state,title,mergedAt` | #2442 `OPEN` ("FISCAL … A1018 Slice 4: …"); #2422 `MERGED` 2026-11-03 ("payments: one collection owner per payment (A764) …"); #2428 `MERGED` 2026-11-03 ("FISCAL — a promotion whose old box relinquished filing stores a version 2 approval …") | the A1018 table |
| P28 | `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/primary-url.test.ts -t "192.168"` | `Tests 1 passed \| 32 skipped` | fact 7 |
| P29 | `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/boot-peer-check.test.ts -t "pending spare at the same address\|nodes row for the spare and no answer waits"` | `Tests 2 passed \| 128 skipped` | D17, Task G.3's words |

**Claims that rest on reading only:** the till router's list and lock-screen lines (fact 17); the
mirror's ambient viewer and who reaches it today (fact 6) — Task 4.5b's surface test turns D8 into a
run; every boot line number; that a join by name fails at the lookup today (inferred from P5); that
macOS's Go ignores `SSL_CERT_FILE` (P8 shows the result, not the reason); the placement rules Task
6.4 follows; in fact 18, where the setup is written and read (P15 runs the refusal and the no-op, not
the file paths); Task F.0's "read only" list; that `ip` exists on the box's host (Task 2.4's test
stubs it, and the script prints no extra line without it); that the server leaf's kind is
unchanged (its extended key use stays `serverAuth`; 3b does issue new leaves — Task 3.1 installs
one and Task 3.3 adds names — and adds a separate client certificate); that the waiting start's
page at `/` is what a reloading till reaches (`waiting-page.ts:95`); the landing listener's routes
and who reaches them, in the latch, time-zone repair and full starts (fact 25 — Task 4.5b turns
the spare's three cases into a run); Task 4.1's effect on the start check (D16 judgement 1); that a box in setup
mode answering `waitron.local` while the main box is restricted or stopped sends a reloading till
to its setup pages (D3); and that Task G.2's boot reconcile can demote a box at start
(`boot.ts:1904-1935`, read).

---

## Review response (revision 1 → revision 2)

| Finding | Done | One line |
| --- | --- | --- |
| C1, a box finds itself by `waitron.local` | fixed | P13 and P14 reproduce it and show the filter works; D3, Tasks 2.2, 2.3, 4.1; the named test is in Task 2.2. Setup-mode answering is still needed for the first box's printed link (`waitron.sh:465`), so it stays, narrowed; a second box's setup is reached at its printed address (Task 2.4) |
| C2, resets keep the venue authority | fixed, wider | Both resets empty `tls/` **and** remove `secrets.env` on a joined box (D13, Task 3.2): `secrets.env` holds the venue's ring since 3a (fact 19), and setup refuses to mint beside it (P18). Every `venue-ca` site named (fact 10) |
| C3, Q1's premise | fixed | Fact 18 from the code; option (c) stated fairly and recommended; §4 item 3 cited; F.0's trace run in part (P15, P16) with the read-only remainder listed |
| I1, promotion on the network | fixed | Task 4.6, `promotion.from_box_only`; D8 lists the whole surface and Task 4.5 walks it |
| I2, waiting start unreachable | fixed | The waiting start answers `waitron.local` (D3); read: its page is at `/` (`waiting-page.ts:95`). Revision 3 narrowed this row: the cost when the main box is not answering is stated in D3 |
| I3, unreachable own-name line | fixed | Task 2.5 merges by the chart's `nodeId`, with the reviewer's named test |
| I4, departures unlisted | fixed | "Departures from the approved design" table and the design's pointer; the stream loop is extended (Tasks 6.8, 6.9), no new e2e file |
| I5, names but not signer | fixed | Task 3.3 reissues a leaf that does not verify under `tls/ca.crt`; and Task 3.1 installs a leaf with the authority, since rev 1's "remove the leaf" could not work (fact 20) |
| I6, no measurement task | fixed | D14 defines `ms` on the spare's own clock; Task 6.11 is the owner's measurement and its recording; 3b lands without it. The controller's wording said "Connect pressed on the main box": Connect is pressed on the spare's setup page, and its request reaches the main box at once, so the start is read there |
| I7, tasks too big | fixed | 4.2 → 5.3, 5.4; 4.3 → 5.5, 5.6 (and the joined-screen words to 6.7); 5.4 → 6.4, 6.5; 5.6 → 6.8, 6.9; 4.1 → 5.1, 5.2; 4.4 → 5.7, 5.8; 4.5 → 5.9, 5.10; 3b-2 split into 3b-2 and 3b-3 |
| I8, stale table list and wrong file | fixed | Task 5.2 puts each delete helper in the file `write-path-tables.json` names; Task 5.5's sweep walks `NODE_CLASSIFICATION`, leaving the three handover tables, with a test |
| I9, store open to the network | fixed | The listener requires the main box's client certificate (D5, Task 5.8); today's leaf cannot serve (P17), so a separate `tls/client.*` |
| Minor: #2442 "parked" | fixed | P20: open; the A1018 table says so |
| Minor: id-columns guard on node.db | fixed | Instruction removed; the guard's header says it reads transferred tables only |
| Minor: error codes and words files | fixed | Global Constraints names every new and retired code, `errors.test.ts:175-177`, and each surface's words file |
| Minor: Spanish words | fixed | Every new refusal and recovery text is written in both languages beside its task; the Veri*Factu refusal now says what Back does |
| Minor: no rotation runbook | fixed | D7's rule goes in `conventions-data.md:928` and the command's own message (Task 5.10) |
| Minor: first answer can be spoofed | fixed | D4: every answer is tried under the pin (Task 4.1) |
| Minor: Q1's example contradicts fact 1 | fixed | Q1 now says the main box reserved and listed the spare before today's refusal |
| Minor: only `fiscal-verifactu` refused | fixed | Fact 1: `series: "on-activation"` once outside tests (`allocated-standby.ts:164`) |
| Minor: `box-tls-repair.test.ts` "if present" | fixed | It is present; Task 3.1 runs it |
| Minor: QR label unplaced | fixed, not moved | §11 places it in 4d; stated under the departures table |
| Minor: undefined words | fixed | "Copy-up", "latch start", "the one main box" defined; "the controller" replaced by "the session running this plan", defined |
| Minor: the Cloud tunnel counts as the box | noted | D8 states it runs only on the one main box (`boot.ts:3291`), so no mirror is reached through it; outside 3b otherwise |
| Found: rev 1's leaf removal could not work | fixed | Fact 20, P18; Task 3.1 |
| Found: a second box's setup unreachable once C1 is fixed | fixed | Fact 23, Task 2.4 |
| Found: rev 1 changed the joined screen's words in 3b-4, while joining still stalled | fixed | Fact 24, Task 6.7 in 3b-6 |
| Found: no plan writes the dormant setup before an A1018 activation | raised | Q1 (c)'s cost, the A1018 table, Task F.2's notes |

## Review response (revision 2 → revision 3)

The third-round claim check is `/Users/clintongormley/waitron-campaign/item-a947-3b-round3.md`.

| Finding | Done | One line |
| --- | --- | --- |
| C1, the loop's box B files with Veri*Factu, so 3b-6's two-box steps could not pass | fixed | 3b-6's steps run in a new `spare-join.e2e.test.ts` on a main box with `{"fiscal-verifactu": false}`, which does not refuse (P24); the loop's box B gains its steps in 3b-F (Task F.2b). Tasks 6.8a, 6.8b, 6.9; departure 11 records the change from "extend the loop"; "What CI … prove" says what each PR's test does and does not prove |
| C2, every refusal but `password.invalid` reached the spare as `mirror.bundle_fetch_failed` | fixed | New Task 5.6b in 3b-5 (the PR adding the refusals), failing tests first: `refusalFrom` rebuilds a named list, `module.operation_invalid` only with a known module's name; `ADOPT_STATUS` gains the codes; a route test runs the real `fetchMirrorBundle`. The existing cases keep every assertion — their codes are not on the list (fact 27, P23) — so no changed check; a needed change is a STOP |
| I1, the design's pointer not updated | fixed | The design's dated A947-3b pointer is rewritten in this commit: eight PRs, two owner-landed, twelve departures in one line each |
| I2, the marker came after the key ring | fixed | D9: `markJoined` is adopt's first write after `beforeFirstWrite`, before `stampDeployment` and the ring (`adopt.ts:166-168`); Task 3.1 tests the order and a join stopped right after the ring write, whose staged reset removes the ring |
| I3, D8 left out the landing listener and `OPTIONS` | fixed | Fact 25 (read); D8 item 6: a mirror runs the landing app on `127.0.0.1` only; `OPTIONS` in fact 22 and D8 item 1; Task 4.5b checks the landing listener's address and walks each route with `OPTIONS` too |
| I4, "no fiscal rule" stated as fact | fixed | D16 and new PR 3b-G, labelled FISCAL and owner-landed, holding Tasks G.1 (was 4.2), G.2 (was 4.3) and G.3 (was 6.6). G.2 was not named by the check; it is included by the same rule, because the boot reconcile can demote a box at start (`boot.ts:1904-1909`). Task 6.2 stays in 3b-6 with its reasoning stated so the owner can overrule it. Header facts and the A1018 table updated |
| I5, task sizes | fixed | 6.8 → 6.8a (the seams a third in-process server needs: `boxLookup`, `restart`, one port draw, the provisioning helper) and 6.8b; 4.5 → 4.5a and 4.5b; 2.3 → 2.3a and 2.3b, whose boot tests bind `0.0.0.0` with an injected socket (D3). The store address: D15 |
| M1, 3b-3 depends on 3b-2 | fixed | Header facts and the 3b-3 heading |
| M2, setup-mode boxes can stay in step for ever | fixed | D3 and Task 2.3b: a random 0–10 s delay on each ask; the cost sentence is now P25's simulated figures, marked as a simulation |
| M3, the A1018 table | fixed | Landed slices from P26 and P27 (0, 1, 2, 3, 4b, 5a, 9); the A1018 plan's own "after 3b" line cited; Slices 12a/12b added; Slice 14 needs a joined spare; decision 9 is "A947 4b/4d"; every "4b" says whose |
| M4, the header's "I1, I8" | fixed | The revision header is rewritten for revision 3; revision 2's own summary stays only in the first review table, whose I8 row already names Tasks 5.2 and 5.5 |
| M5, the file list put the pair-link delete helper in `node-db` | fixed | File structure now says `packages/credentials/src/node-pair-link.ts`, as Task 5.2 does |
| M6, `hostname -I` lists Docker's bridge | fixed | Task 2.4 prints the addresses the server itself picks (`box-reach.ts:30,40-52,75-91`), from `ip -4 -o addr show` and `/proc/net/route`; tests with a stubbed `docker0` |
| M7, Task 2.5's look could not show the fix | fixed | The look is removed, with the reason; the unit tests are the evidence |
| M8, the `mdns.responding` log field | fixed | Task 2.3a changes the field and its row in `scripts/personal-log-params.test.ts:75`, and runs the guard; Task 2.6 too |
| M9, words not using the dashboard's labels | fixed | Tasks 5.9 and 5.10 (and 4.6, 5.6, 6.7 for the same reason) say "standby" / «servidor en espera» and Remove / «Retirar» (fact 26) |
| M10, Q1 (c) without its hedge | fixed | Q1 (c) says the spare's write is read from the code, not run, and Task F.1 runs it |
| M11, two untested claims | fixed | D3 states the restricted-main-box cost as read; the I2 row in the first table is narrowed; "a browser accepts the unchanged leaf" became "the server leaf's kind is unchanged" |
| M12, an abandoned join's `pending` link | fixed | D17: a new join replaces it, and Remove under Servers deletes it (Remove accepts a standby with no `nodes` row, fact 26); Task 5.9's words fit a standby that never finished |
| M13, D14's starting point | fixed | D14 names the pair link's `created_at`, written inside the Connect request after the bundle fetch |
| M14, the store's address | fixed | D15: the spare sends `standbyStoreUrl`; the main box checks its host and stores it (Tasks 5.4, 5.5) |
| M15, Task 6.9's control could fail at the wrong step | fixed | Its control binds both servers to `0.0.0.0` and uses one of this machine's own non-loopback addresses |
| M16, D12's 409 | fixed | D12: the main box's route answers 409 (a new `STATUS` row); the spare's existing 409 stays and is named as the spare's |
| Carried: fact 7's "an IP works" | fixed | Fact 7 now says a private IP is refused before anything is sent (P28), so no address works today |
| Carried: Task 5.7's import broke `setup-s3-test-server.test.mjs` | fixed | `s3-test-server.ts:20` is left as it is; the server's own copy is held equal by the pin test (Tasks 1.1, 5.7) |
| Carried: a third box's join replaces a `streaming` link | fixed | D17 and Task 5.3: `mirror.spare_already_joined`, before anything is reserved, with words in Task 5.6 and the relay in Task 5.6b |
| Found: a joined standby cannot be removed | fixed | Fact 26 (P22). Revision 2's bucket words ("remove the spare box under Servers") and rotation message ("remove, rotate, add again") offered a choice that refuses for a joined spare; D7, Tasks 5.9 and 5.10 rewritten; departure 8 updated; the guide section says so |
| Found: Task 4.5's walk could not see the promotion change before Task 4.6 | fixed | Task 4.5b lists the two promotion routes as a known gap until Task 4.6 removes it |
| Found: G.3's recovery words promised the box could join again | fixed | With one spare per venue (D17) and no removal of a joined standby (fact 26), it cannot; the words now say so and that the main box keeps selling |
| Found: no way to retire a joined standby | raised, not built | 3b-6 makes it reachable: a dead spare leaves the main box waiting at every start until an administrator carries on. D17 states it; Task 6.10 adds the guide's words and a backlog entry. Not built in 3b; the owner may want it before go-live |

## Review response (revision 3 → revision 4)

The fourth-round claim check is `/Users/clintongormley/waitron-campaign/item-a947-3b-round4.md`.

| Finding | Done | One line |
| --- | --- | --- |
| I1, a joining spare's latch start and a mirror's time-zone repair start serve the landing pages on every address | fixed | Bound, not left as a limit: one helper, `landingHostFor`, puts the landing listener on `127.0.0.1` in the latch start always and in the time-zone repair and full starts on a mirror (D8 item 6). D8 item 7 lists the latch start's own surface (`boot.ts:1695-1704`). Task 4.5b walks the latch start's routes as well as the mirror's, and checks the landing address in all three starts, with primary starts as the control. Fact 25 now names the start at `:2177` as the time-zone repair start (`boot.ts:2076-2177`) and says the latch start serves the landing pages on every address today |
| I2, Task 4.1 falls under D16's rule | fixed, as a judgement | D16 now has two judgements: Task 4.1 (3b-4) and Task 6.2 (3b-6). Task 4.1 stays in 3b-4 because `boxExchange` is also the spare's way to the main box, so moving it would put 3b-4 and 3b-5 behind the owner. 3b-4's PR body says so in its first line, the cut table marks it, and the header no longer says no other PR touches the start check (`boot-peer-check.ts:135-137,218,344-357`, read) |
| M1, fact 25 misquoted fact 6 | fixed | Fact 25: a mirror's full start refuses at the bind guard (`boot.ts:2005`) before the landing listener starts |
| M2, G.3's words did not say the main box waits | fixed | One sentence in each language, naming the guide's Carry on button; the wait itself rests on the two cases of probe P29 |
| M3, Task 6.8a's restart citations | fixed | Task 6.8a lists the setup start's `:1389,1648`, the time-zone repair start's `:2154`, the full start's `:3390,3449`, notes `:3752` already has a seam, and names `:1648` as the one the test meets; the latch start's restarts are Tasks 6.3 and 6.5's new code |
| M4, D4 said Task 4.1 removes an unchecked path | fixed | D4: Task G.1 removes the start check's unchecked branch (`boot-peer-check.ts:353`); `fetchPrimaryCertificate`'s read before confirmation (`mirror-bundle-fetch.ts:189`) stays unchecked; these are the only two (`grep -n "rejectUnauthorized: false"`) |
| M5, Task 5.6b's route test said "as" a test that stubs the fetch | fixed | Mounted as that test mounts `mountSetup`, but with the real `fetchMirrorBundle` over plain `http` to `127.0.0.1` (that test's stub is at `:73-99`; loopback is allowed, `primary-url.ts:6,50`) |
| M6, Task 6.8a too big | fixed | Split: 6.8a (the `boxLookup` and `restart` seams, with their own tests in existing boot suites), 6.8b (the shared box set-up, the new file, the CI lists and the setup-mode probe with its STOP); the phases are now 6.8c |
| Design pointer | unchanged | No departure was added or removed; its item 6 ("a mirror listens on the venue's network with a listed surface") still holds |

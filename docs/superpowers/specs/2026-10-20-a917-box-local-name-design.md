# A917 — the owner chooses the server's `.local` name instead of `waitron.local`

Status: DESIGNED 2026-10-20 by an unattended campaign run; revised the same day after a fresh review
(round 1: 8 high, 8 medium, 10 low findings, all addressed — §14). Waiting for the owner's answers
to three questions (§12). Not built. Pictures:
[mockups/a917-box-local-name/](../../backlog/mockups/a917-box-local-name/).

The owner's words (2026-10-20, through the watcher): "we should allow … specifying a new .local
domain name".

## 1. Words used here

- **The server** is the venue's Waitron machine the tills talk to (the code and older docs call it
  "the box"; product text says "server" since #346, commit `64486a737`, and so do the pictures).
- **mDNS** (multicast DNS) is how a device finds `something.local` with no DNS server: it asks the
  whole network "who is `waitron.local`?", and the machine holding that name answers with its
  address. RFC 6762 defines it.
- **A certificate authority** (here, the server's own, made on the server) is a key that vouches for
  website certificates. Each till and phone installs it once, on the trust page, so the browser
  accepts the server's HTTPS pages without a warning.
- **A name constraint** is a line inside the authority's own certificate listing the names it may
  vouch for. Today's lists `waitron.local`, `localhost` and private addresses, so a stolen
  authority key could not be used to fake, say, the venue's printer on a device that honours it.
- **The leaf certificate** is the server's own website certificate, vouched for by the authority.
- **An origin** is what a browser keys everything to: `https://waitron.local` and
  `https://bar-lucia.local` are two origins, each with its own cookies, stored data, installed app
  and passkeys.
- **A passkey** is a sign-in key a phone or computer keeps for one website name (the "relying party
  ID"), usable only at that name.
- **The membership document** is the signed list of the venue's servers and the address
  (`contactUrl`) each is reached at; tills route by it.

## 2. What is there now (every reader of the name)

Checked at `main` bf034bc29. ✓ = re-opened by the designer; "sweep" = read by a read-only sweep;
"reviewer" = read by round 1's reviewer, whose report lists what it ran and read.

### 2.1 The single source and its copies

- ✓ `apps/server/src/boot.ts:353` `BOX_HOSTNAME = "waitron.local"`; `:356` adds `localhost` for
  the leaf. Used by the plain-HTTP listener (`:678`), discovery (`:944`), the certificate mint
  (`:967`), the mDNS responder in setup (`:1239`), adoption-pending (`:1300`) and trading (`:2537`)
  modes, the leaf re-issue after a restore (`:1405`) and the mirror bundle (`:2267`);
  `node-entry.ts:120` (recovery entry) too.
- ✓ Copies: `deploy/Dockerfile:265-266` bakes the passkey name and dashboard origin;
  ✓ `deploy/compose.yml:32-33` defaults them; ✓ `deploy/waitron.sh:21` `BOX_URL`, `:379` and `:390`
  print `http://waitron.local/setup/trust` and its QR code. ✓ `scripts/deploy-image-env.test.ts:74-75`
  pins the copies to `boot.ts`, reading text.
- ✓ `apps/server/src/config.ts:482-493` requires the passkey name (`WAITRON_MANAGEMENT_RP_ID`) and
  dashboard origin (`WAITRON_MANAGEMENT_ORIGIN`) in production. Derived from the origin: ✓ the
  Google sign-in return address (`config.ts:544`, `${managementOrigin}/management-api/google/callback`),
  ✓ account-email links (`boot.ts:1950`), `advertisedOrigin` (the address a new device is handed,
  sweep), and the reviewer-read single-origin checks in `cloud-api.ts:102,138` and
  `content-suggestions-api.ts:84`, which refuse a request whose `Origin` is not the dashboard origin.

### 2.2 What advertises it

- ✓ `apps/server/src/mdns.ts:55`: no socket at all in development or on a loopback-only listener.
  ✓ `:64` answers an `A` or `ANY` question whose name is **exactly** the one name (case counts).
  ✓ `:45` answers live 120 s. ✓ `:85` stopping just closes the socket: no probe first, no goodbye.

### 2.3 What certifies it

- ✓ `self-signed-cert.ts:33` permits `waitron.local` and `localhost` (plus loopback and the three
  private ranges), as a critical constraint. The authority's subject is `CN=waitron-setup-ca` on
  every server, with **no key identifiers** (reviewer: `openssl x509 -text` lists only basic
  constraints, key usage and name constraints) — which matters when a device holds two (§5.3).
- ✓ `box-secrets.ts:139-140`: authority, leaf and vault key are made only when
  `<state>/tls/server.key` is missing, at the first setup start. Sweep: the leaf is re-issued only
  after a restore (`rebuild-first-start.ts:112`); both last 3650 days.
- ✓ `state-secrets.ts:15-22`: recovery bundles and backup archives carry `secrets.env`,
  `trading.env` and the four TLS files (✓ `archive-entries.ts` adds the optional
  `backup.env`/`modules.json`, `backup-optional-state.ts:10`).
- `scripts/name-constraints-spike.sh` and commits `fb47efd68`, `75f17f9e3` (read): desktop Chrome 152
  and macOS refused an outside name; **one Android phone's Chrome accepted it** under a
  user-installed authority. **No iPhone has been measured** (`75f17f9e3`: "iOS device still to
  measure"; `docs/backlog.md` says the same). Every iPhone statement below is an assumption.

### 2.4 What tells a device where the server is

- The trust page (✓ `trust-page.ts:75-135`) lists addresses and "Continue to Waitron"; its first
  step on a device that already has one is "Remove an old Waitron certificate". Its QR code is the
  first **IP address** (`box-reach.ts:14-16`, sweep), so some devices are opened by IP, not name.
- The till ✓ uses `location.origin` (`apps/till/src/main.ts:31-34`) and keeps the server list in
  `localStorage["waitron.servers"]` (sweep). ✓ When it cannot trust the server it shows "This device
  hasn't trusted the till yet" with a link to `http://<the name it was opened at>/`
  (`main.ts:44-55`). ✓ Its device cookie is host-only on `.local` (`device-session.ts:30-40`).
  So a renamed server is a new origin to every device: no cookie, no stored data, no installed app.
- The print agent on the server dials `https://127.0.0.1` (sweep, `deploy/compose.yml:120`). ✓ It
  fetches the authority from `http://<host>/ca.crt`, re-checks hourly, and re-fetches when a request
  fails with a certificate error (`apps/print-agent/src/server-ca.ts:9-18,132`).
- Membership: `contactUrl` is written at setup (`membership-seed.ts`), adoption (`adopt.ts:89`) and a
  rebuild (✓ `rebuild-first-start.ts:118-130`, which signs the next document with this server's
  `contactUrl` replaced). Nothing rewrites it at a plain restart (reviewer).
- `mirror_config` (`packages/db/src/schema/mirror-config.ts`) is a `local` table on a **mirror
  node** of this repository, holding `box_hostname` and `box_ca_pem`; only tests read either (✓
  `tunnelHttpClient`, `tunnel-http.ts:26`, has no non-test caller). Cloud's pairing payload carries
  no name (sweep).

### 2.5 What tells a person

- ✓ The guides (`apps/server/src/guide/en|es/`) never name `waitron.local`
  (`grep -rln 'waitron\.local' apps/server/src/guide/` prints nothing).
- ✓ `apps/setup/src/i18n/strings/finish.ts:61,143`: after a rebuild, "Tills … that were opened at
  https://waitron.local reconnect by themselves."
- The trust page, `waitron.sh`'s printout, `deploy/README.md`, the two `.env.example` files and
  `docs/developers/{workflow-guide,cloud-connection,design-system}.md` (sweep). Receipts never name
  the server.

### 2.6 Tests that pin the literal

47 files in `apps/server/src`, 17 test files in `apps/dashboard/src`, 5 in `apps/setup/src`, 2 in
`packages/db`, 1 in `packages/diagnostics`, `scripts/waitron-sh.test.mjs`,
`scripts/deploy-image-env.test.ts` (counts confirmed by the reviewer). A fixture keeps
`waitron.local` where it means "the default name".

## 3. The decision (recommended)

- **The server is named once, on its first page, before its certificate authority exists**, and
  the authority permits only that name. Not naming it keeps `waitron.local`.
- **The name is read from the authority itself** (its one permitted DNS name other than
  `localhost`). There is no separate name file, so a restore cannot disagree with its authority and
  the recovery file list does not change (§8).
- **A later rename is a planned "re-trust every device" event** (path R, §6): when the venue is
  closed, the server restarts with a new authority for the new name only. Every device installs the
  new certificate and is paired again; every passkey is deleted and added again. For 14 days the
  old name answers only on plain HTTP, with a page saying where the server went.
- **No database migration** anywhere in the design.

The first draft recommended a 14-day two-name window instead (path W). Round 1 showed what that
really costs; §6 sets both side by side, and path W is now option B of question 3.

## 4. The name

### 4.1 What is allowed

The person types only the first part; `.local` is fixed beside the field.

- `a`–`z`, `0`–`9` and hyphens, 1 to 63 characters (RFC 1035), starting and ending with a letter or
  digit (RFC 1123 allows a digit first).
- Upper case becomes lower case as it is typed, keeping the caret where it was (CLAUDE.md §3).
  The server stores and compares lower case.
- Anything else is refused after the first press of "Use this name" (the forms rule, design-system.md
  → Forms: "A form says nothing about errors until the operator first presses its primary action"):
  "Use only letters a–z, numbers and hyphens.", with a button offering the cleaned-up name. "Café
  Lucía", typed as `café lucía`, offers `cafe-lucia`: accents off (Unicode decomposition, combining
  marks dropped), spaces, dots and underscores to hyphens, other characters dropped, repeated hyphens
  collapsed, ends trimmed. This is about what the network carries, not language.
- Why no accented names, measured (M5): a browser turns `https://Café-Lucía.local` into
  `xn--caf-luca-d1a8b.local`, while RFC 6762 §16 requires mDNS names in UTF-8; a responder answering
  the UTF-8 name was not found by a lookup of the browser's form.
- Refused names: `localhost`, `local`, and a name starting `xn--` (a browser would read it as an
  encoded accented name). Measured (M9): `new URL("https://ab--cd.local")` keeps `ab--cd.local`, so
  other double hyphens are allowed. `wpad` and `broadcasthost` are refused as a precaution (names
  operating systems treat specially; not measured).
- `waitron` is allowed; it is the default.
- Refusal codes: **`node.name_invalid`** and **`node.name_taken`**. Grepped every `errors.ts`:
  "this name is already used" is `<thing>.name_taken` everywhere (`device.name_taken`,
  `category.name_taken`, `department.name_taken`, `zone.name_taken` and nine more), while `.in_use`
  means "still referenced, cannot delete" (`device_profile.in_use`). Machine codes are `node.*`
  (`node.not_found`, `node.read_only`, `node.reset` …); `server.*` is reserved for facts about the
  process (CLAUDE.md §3). The clash alert is **`node.name_clash`**.

### 4.2 A name already in use on the network

Measured on this Mac (M1–M4) with the same `multicast-dns` 7.2.5 and the same answer logic as
`mdns.ts`. Both "devices" ran on one Mac; the "conforming device" was macOS's own responder
publishing a record (`dns-sd -P`), not a printer.

- Two Waitron-style responders on one name both answer and neither reacts: a lookup returns both
  addresses, so a till could reach either.
- macOS's responder probes first (RFC 6762 §8.1): started second, it found the name taken and gave
  up ("Name in use, please choose another").
- A Waitron-style responder answering a name macOS's responder already held made **macOS's give the
  name up**. RFC 6762 §9 says why this generalises: a host that does not require a unique name "will
  not perceive any conflict", while the one that does "will go through the necessary steps to ensure
  that a unique host name is obtained". A printer that follows the standard would expect to do the
  same — expected, not measured on a printer.
- A one-off query before choosing found the holder; with nobody holding the name it found nothing.
- A stopped responder's answer was still served from the Mac's cache (120 s life); a goodbye (the
  same answer with life 0, RFC 6762 §10.1) cleared it at once.

So:

- **Before a name is accepted** (setup or rename) the server probes it — three queries 250 ms apart
  (RFC 6762 §8.1). Another device's answer refuses the name beside the field
  (`node.name_taken`: "Another device on this network already answers to bar-lucia.local
  (192.168.1.40). Choose another name, or rename that device.") The button stays usable: a refusal
  from a request never disables the action by itself (design-system.md → Forms).
- **At every start** the server probes its own name first. If another device answers, **the server
  answers anyway and raises `node.name_clash`** ("Another device answers to bar-lucia.local: rename
  it, or rename this server"), with an area claim and English and Spanish wording (CLAUDE.md §3).
  **This displaces the other device** if it follows the standard (M3): it gives up the name and
  picks another. Decided, with the trade-off weighed: the server is what sells (CLAUDE.md §5,
  "Nothing EXTERNAL may block a sale"), and every till is opened at this name; a printer Waitron
  drives is reached by its address, and one that gave up a clashing name keeps working under its new
  one. Not answering would stop every till until someone renamed something. The alert is the
  remedy. While running, the responder also watches for another device's answer to its name (M1's
  log shows the library delivers them) and raises the same alert.
- The responder compares names ignoring case (RFC 6762 §16), answers each name it holds, and sends
  a goodbye for a name it stops answering.
- Android and Linux (Avahi) resolvers given two answers were **not measured**.

### 4.3 Setup on a network that already has a `waitron.local`

A new server in setup answers `waitron.local` **only if its probe finds no other holder**, so a
second server being set up beside a trading one does not displace it or trip its clash alert. When
the name is held, the new server answers nothing until named and is reached by its IP address:
`waitron.sh` prints the IP link and its QR code beside the `waitron.local` one (the trust page's QR
is already the IP address).

## 5. The certificate authority

### 5.1 What was measured (M6, M7)

Six authorities in a throwaway folder; "today" was made by the product's own
`mintSelfSignedServerCert` (bundled with esbuild from `self-signed-cert.ts`), the rest with OpenSSL.
Three checkers judged every pair: OpenSSL 4.0.3 `verify`; macOS 26.6.2's own checker
(`security verify-cert -r`, keychain untouched); Chromium 153.0.8010.12 (Playwright's Linux build,
in Docker, trusting only that authority through Chrome's `CACertificates` policy). All three agreed
on every row (the reviewer re-ran OpenSSL and Chromium with leaves that also carry `localhost` and
an IP, and got the same):

| Authority permits                   | `waitron.local` | `bar-lucia.local` | `hp-printer.local` | `example.com` |
| ----------------------------------- | --------------- | ----------------- | ------------------ | ------------- |
| today: `waitron.local`, `localhost` | accepted        | **refused**       | refused            | refused       |
| `local` (all of `.local`)           | accepted        | accepted          | **accepted**       | refused       |
| `.local` (leading dot)              | accepted        | accepted          | **accepted**       | refused       |
| `waitron.local` + chosen name       | accepted        | accepted          | refused            | refused       |
| chosen name only                    | refused         | accepted          | refused            | refused       |
| control: no constraint              | accepted        | accepted          | accepted           | accepted      |

(The probe used `cafe-lucia.local` for the chosen name.) With no authority trusted, Chromium's error
was `ERR_CERT_AUTHORITY_INVALID`, unlike the constraint's `ERR_CERT_INVALID`. M7: re-signing the
same key with a wider constraint does not help a device holding the old authority (OpenSSL
"permitted subtree violation", Chromium `ERR_CERT_INVALID`; trusting the wider one: accepted). Any
change to the permitted names is a new authority to install on every device.

### 5.2 The options, for Bar Lucía (3 tills, 2 phones)

- **C — named once at setup, before the authority exists (recommended).** Nothing has trusted the
  server yet, so naming costs nothing, and the authority is as narrow as today's.
- **A — a later rename makes a new authority for the new name (recommended for a rename).**
- **B — one authority for all of `.local`.** A rename needs no new certificate, but each device is
  still paired again (a new origin) and passkeys are still lost. The cost: whoever holds the
  server's authority key — it lives on the server and in every backup and recovery bundle — could
  make every staff Mac, PC and Chrome trusting it accept a fake printer or fake server page without
  a warning; iPhones are expected to behave like the Mac, not measured. Today they could fake only
  `waitron.local`. On Android nothing changes (the constraint is ignored there, `75f17f9e3`).
- **D — `waitron.local` plus the chosen name.** Adds nothing at setup; at a rename it is still a new
  authority (M7). Rejected.

Recommended: C, with A for a rename — B saves only the certificate step of a rare event and widens
what a stolen key can fake for ten years.

### 5.3 Each authority is distinguishable (round-1 finding H2)

Today every server's authority has the same subject and no key identifiers. Measured (M8) with two
authorities trusted at once: with the same subject and no key identifiers, OpenSSL and Node verified
only the leaf of whichever authority came first in the list ("certificate signature failure",
`UNSPECIFIED`); with distinct subjects and key identifiers, both leaves verified in both orders in
OpenSSL and Node. macOS's checker accepted both shapes in both orders; Chromium (reviewer) also
coped with the same-subject pair. So every new authority gets **a subject naming the server and when
it was made** (for example `Waitron server authority bar-lucia.local 2026-10-20T03:05Z`), **a
subject key identifier, and leaves carry an authority key identifier**. A device keeping an old
Waitron authority installed — the norm on a print-agent machine or a desktop someone never cleaned —
then cannot confuse the two. Slice 1.

## 6. Renaming later — the two paths side by side

**Path R — a planned re-trust (recommended).** The owner renames when closed. The server restarts
once with the new authority and leaf only; the old ones are deleted.

**Path W — two names for up to 14 days (the first draft).** Each device keeps working at the old
name until it moves itself.

| Piece                              | Path R                                                                                                     | Path W                                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trading during the change          | Each device stops until re-trusted and re-paired; do it when closed                                         | Uninterrupted                                                                                                                                                                      |
| Certificates on the server         | One authority, one leaf                                                                                     | Two of each; a leaf chosen per requested name (`SNICallback`, measured M10)                                                                                                         |
| Opened by IP / the server's print agent | One leaf, so a nameless request gets the new one (M10); the agent re-fetches `/ca.crt` on the error (M11) | A nameless request gets one default leaf (M10): IP-opened devices and the agent break at the switch or at the end of the window, and cannot "move" — a rule and a warning are needed |
| Two authorities on one device      | Never needed: the trust page's first step removes the old one                                               | Required during the move, and the trust page's removal step must be skipped for movers (round 1, H1)                                                                                 |
| Membership `contactUrl`            | Re-signed once at the rename (slice 4)                                                                       | Re-signed once, plus the CORS list (`allowed-origins.ts`) holding both names                                                                                                         |
| Single-origin checks (§2.1)        | Follow the one origin                                                                                        | Every one becomes per-name: `cloud-api.ts`, `content-suggestions-api.ts`, Google return address, email links                                                                        |
| Passkeys                           | All deleted at the rename; no new column                                                                     | Need a relying-party-ID column on `webauthn_credentials` (an identity migration) and a per-request ID                                                                                 |
| Device identity                    | Each device is paired again as a new device; its profile and printer are set again                           | A one-time move code; the server must issue a **new** device token (only its hash is stored), ending the old-name cookie at that moment                                              |
| Restores                           | One authority to restore                                                                                     | Two authority pairs to carry during the window                                                                                                                                      |
| Migrations                         | None                                                                                                         | At least one (passkeys), plus a per-device "moved" mark that has to be `local` and keyed by node                                                                                   |
| Build                              | Slices 4–5 as below                                                                                          | Roughly twice that, and every piece above needs its own tests                                                                                                                       |

Why R: a rename is rare and can be planned for a closed day. W buys an uninterrupted rename at the
price of a second certificate world, per-name origin handling, a passkey migration, a device-token
handover and rules for IP-opened devices — each a new place for a defect in authentication. For
Bar Lucía, path R costs about one closed-day session: each of 5 devices installs the certificate
and is paired again, a few minutes each — **an estimate, not timed**. If the owner wants W, the
design above is its starting point; it is question 3's option B.

## 7. A rename on path R, step by step

1. **Before**: the dialog (picture 04) probes the new name (§4.2) and lists what will happen.
2. **At the confirm** the server, in one go before restarting: makes the new authority and leaf
   (distinct subject, key identifiers, §5.3); signs the next membership document with this server's
   `contactUrl` changed to the new name, modelled on `completeRebuild` (`rebuild-first-start.ts`:
   `mintNextMembershipDocument`, never below the bucket pointer's term). Today a venue has one server
   (CLAUDE.md §5); a standby, when one exists, reads the document from the replicated database like
   any other term change — read, not run; deletes every passkey (they are all for the old name; the
   WebAuthn rule in §13 is why none could work); and records the old name and a 14-day deadline.
3. **Restart**: the passkey name, dashboard origin, Google return address, email links and new
   devices' address all derive from the new name (§8). Note: the Google return address must also be
   registered with Google by whoever set up Google sign-in; Google's rules for a `.local` return
   address were not checked.
4. **Devices**: a till opened at `https://waitron.local` can no longer reach the server, shows its
   existing "This device hasn't trusted the till yet" page, whose link goes to
   `http://waitron.local/` — which, for 14 days, is the pointer page (picture 06): "This Waitron
   server is now bar-lucia.local", install the new certificate (whose first step removes the old
   one), open the new address, a manager adds the device again. IP-opened devices meet the new leaf
   and do the same from the trust page. The server's own print agent fixes itself: its next request
   fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (M11), which is in its re-fetch list
   (`server-ca.ts:9-15,132`). A print agent on another machine is a device like any other.
5. **Dashboard**: the Servers screen shows "Renamed to bar-lucia.local" (picture 05) with the steps,
   a note that the devices paired before the rename stay under Devices until removed, and
   "Download a new recovery bundle".
6. **After 14 days** the server stops answering the old name (with a goodbye).

**Related origins, considered:** WebAuthn-3 §5.11 "Related Origin Requests" could let a new name use
an old name's passkeys while the old name serves `/.well-known/webauthn` (reviewer, curl'd). Path R
has no old name serving HTTPS, and browser support was not measured; not used.

`mirror_config.box_hostname` and `box_ca_pem` on a mirror node go stale at a rename. Nothing reads
them today; a future tunnel client that pins them must refresh them from the next mirror bundle.

## 8. Where the name lives, who changes it, restarts

- **Storage: the authority.** At start the server reads `<state>/tls/ca.crt` and takes its one
  permitted DNS name other than `localhost` as its name; an authority made before this feature reads
  as `waitron.local`. No new file, so `RECOVERY_FILES` and the backup archive are unchanged and an
  unnamed server's backups behave as today. A server given an operator's own certificate
  (`WAITRON_TLS_*`) still makes its own authority (✓ `boot.ts:963-964`) but serves the operator's;
  its addresses come from the operator's `.env` settings, as today.
- **Restore** (round-1 H5): a restore brings back the authority and so the name it permits; the
  leaf re-issued after a restore (`rebuild-first-start.ts:112`) is for that name, read from the same
  authority, so the two cannot disagree. `reissueServerLeaf` gains a check refusing a name its
  authority does not permit (a test pins it). If the installer named the new server on its first
  page and then restores, the restored authority and its name win, and the setup device installs a
  certificate again — as a restore already requires today. A bundle or backup from before a rename
  brings back the old name; the rename dialog and the after-rename card say so and offer a new
  recovery bundle.
- **The environment**: the image stops baking the passkey name and dashboard origin, and compose
  stops defaulting them; unset, the server derives both from its name. An operator's explicit `.env`
  values still win (the existing route for a real domain, `docs/developers/cloud-connection.md`).
- **Who may rename**: "Change network name…" on the Servers screen's "This server" row, checking
  `mirror.create`. Decided: the permission's own description is "Decides which machines are in the
  venue's membership chart and hands one its identity" (✓ `packages/identity/src/permissions.ts:33-35`),
  and a rename re-signs that chart (§7). It is admin-only; `system.manage`, which managers
  hold and which guards backup, cloud and email settings, is the alternative if the owner wants
  managers to rename.
- **Restarts**: naming at setup restarts the setup server once (§9); a rename restarts once.
- **Unnamed**: the first page opens with `waitron` filled in and "Use this name" enabled — the
  forms rule's "enabled at once if it opens already savable" (design-system.md → Forms). The line
  under the field ("Devices will open this server at https://waitron.local") is a live preview of
  the address, not a hint.

## 9. Setup before the server has a name (round-1 H6)

Today the setup start makes the vault key, the authority and the leaf before serving
(✓ `boot.ts:961-972`, `box-secrets.ts:139-160`), and the plain-HTTP listener exists only once a leaf
exists (✓ `boot.ts:670-676` returns nothing without one).

New pre-name state (slice 2):

- The setup start makes the **vault key** as today, but **not** the authority and leaf while the
  server has no name. It serves **plain HTTP only** on port 80: the first page shows "1. Name this
  server" (picture 01) and step 2 "Get the certificate" says it appears once named. No HTTPS
  listener runs yet; `/ca.crt` answers 404 with `node.unnamed`; the wizard's connection step is not
  reachable (it is HTTPS).
- `startLandingListener` no longer needs a leaf: without one it serves the naming page; with one, the
  trust page as today.
- The naming form is an **unauthenticated plain-HTTP write**. That is acceptable for the same reason
  setup itself is: an unclaimed server can be set up by anyone on its network. It is accepted only
  while no authority exists; once named, the page shows the trust steps and the name is changed only
  by a rename.
- Accepting a name: probe (§4.2), make the authority and leaf for it, restart the setup server
  (seconds, as finishing setup already restarts it). The page then shows the trust steps for the
  name (picture 02).
- A server that already has an authority (every server today, and any restored one) skips the
  naming page.
- Tests: a start with no TLS files serves the naming page and no HTTPS; `/ca.crt` refuses before
  naming; naming makes the authority with the chosen constraint and distinct subject; a second
  naming attempt is refused; a start with TLS files skips naming; development mode never probes.

## 10. What people read, and the development rule

- **Guides** never name the server (§2.5): nothing changes.
- **Trust page**: "This server is called bar-lucia.local." and links using the name (picture 02).
- **Pointer page** at the old name for 14 days (picture 06), English with the Spanish twin.
- **Setup done screen** (`finish.ts:61,143`): the name becomes a placeholder in both languages.
- **`waitron.sh`**: prints the `waitron.local` link and the IP link at install; later links read
  the name from the server, falling back to `waitron.local`.
- **The development and loopback rule** (CLAUDE.md §6, guard `apps/server/src/mdns.test.ts`): the
  gate at `mdns.ts:55` comes before any socket, whatever the name, and the probe sits behind it, so a
  development or loopback-only server neither answers nor probes any name. `mdns.test.ts` gains a
  case with a chosen name in development mode and on a loopback listener.

## 11. Build slices (full review path: certificates, sign-in and a cross-package contract)

1. **Name, responder, authority shape.** Read the name from the authority; the name rule and
   clean-up (tests at 63/64 characters, a leading digit, leading/trailing hyphen, `xn--`, `ab--cd`,
   `Café Lucía`, upper case); case-insensitive answers, several names, probe at start, goodbye,
   `node.name_clash`; distinct authority subjects and key identifiers; the restore check in
   `reissueServerLeaf`. No visible change for an unnamed server.
2. **Naming at setup.** The pre-name state of §9, the naming page (picture 01), probe on accept,
   trust-page line, done-screen string, `waitron.sh`'s IP link, `waitron.local` answered in setup
   only when free (§4.3).
3. **Environment from the name.** Dockerfile, compose, `config.ts`, deploy tests,
   `deploy/README.md`, the `.env.example` files, `docs/developers/*`.
4. **Rename, server side.** Route checking `mirror.create`, new authority and leaf, membership
   re-sign, delete passkeys, old name answered on plain HTTP only with the pointer page for 14 days,
   restart. Tests: the re-signed document's `contactUrl` and term; no passkey survives; the old
   name's HTTPS is not served; the server's print agent recovers.
5. **Rename, screens.** Servers row action, dialog, after-rename card (pictures 03–05), pointer page
   (06), English and Spanish strings, the dialog's unsaved-changes test.

## 12. Questions for the owner

Ready to paste in `~/waitron-campaign/a917-design/question.md`, in this order, because "at setup
only" makes the other two moot:

1. **Where the name is set** (picture 07): A, at setup and later from the dashboard (recommended);
   or B, at setup only — a new name later means setting the server up again (drops slices 4–5 and
   questions 2–3).
2. **The certificate authority** (picture 08): A, for the chosen name only, a new one at a rename
   (recommended); or B, one for every `.local` name.
3. **The old name during a rename** (picture 09): A, a planned re-trust: the old name only shows
   where the server went, for 14 days (recommended, path R); or B, two names for up to 14 days, each
   device working until it moves (path W, much more to build).

Decided without asking (trade-offs above): the name rule and codes (§4.1), probe-first and answering
anyway with an alert (§4.2), setup's `waitron.local` only when free (§4.3), the name read from the
authority (§8), `mirror.create` (§8), one restart per rename and deleting all passkeys (§7).

## 13. Outside sources

Fetched with `curl` on 2026-10-20 and searched in the raw text.

| Claim | Source's words | URL |
| ----- | -------------- | --- |
| Probe before using a name | "it MUST send a Multicast DNS query asking for those resource records, to see if any of them are already in use" (§8.1) | https://www.rfc-editor.org/rfc/rfc6762.txt |
| Probe timing | "250 ms after the first query, the host should send a second; then, 250 ms after that, a third" (§8.1) | same |
| Two answers for one name conflict | "Should a host witness another host announce an address record with the same name but a different IP address, then that is considered inconsistent, and that address record is considered to be in conflict." (§9) | same |
| Who gives way | "the one that has not been configured to require a unique host name will not perceive any conflict, and will not take any action. By reverting to Probing state, the host that desires a unique host name will go through the necessary steps to ensure that a unique host name is obtained." (§9) | same |
| Goodbye | "send an unsolicited Multicast DNS response packet, giving the same resource record name, rrtype, rrclass, and rdata, but an RR TTL of zero" (§10.1) | same |
| UTF-8, not Punycode | "all names in Multicast DNS MUST be encoded as precomposed UTF-8" (§16) | same |
| Case does not matter | "in name comparisons, the lowercase letters "a" to "z" (0x61 to 0x7A) match their uppercase equivalents" (§16) | same |
| A DNS constraint covers names below it | "Any DNS name that can be constructed by simply adding zero or more labels to the left-hand side of the name satisfies the name constraint." (§4.2.1.10) | https://www.rfc-editor.org/rfc/rfc5280.txt |
| Label shape | "They must start with a letter, end with a letter or digit, and have as interior characters only letters, digits, and hyphen. … Labels must be 63 characters or less." (§2.3.1) | https://www.rfc-editor.org/rfc/rfc1035.txt |
| A digit may start a name | "the restriction on the first character is relaxed to allow either a letter or a digit" (§2.1) | https://www.rfc-editor.org/rfc/rfc1123.txt |
| No name is sent for an IP address | "Literal IPv4 and IPv6 addresses are not permitted in "HostName"." (§3) | https://www.rfc-editor.org/rfc/rfc6066.txt |
| A passkey is tied to its name | "as long as the caller-specified RP ID value is a registrable domain suffix of or is equal to the caller’s origin’s effective domain" | https://www.w3.org/TR/webauthn-3/ |

## 14. Measurements

All on this Mac (macOS 26.6.2, Node v26.11.1), with processes this run started and stopped by
process id, keys and certificates in `mktemp -d` folders (deleted). Probe scripts, without keys:
`~/waitron-campaign/a917-mockups-src/probes/`.

- **M1** two responders, one name: `responder.cjs` ×2, `query.cjs`, `dns-sd -G v4`, `dscacheutil`.
  Control (nobody answering): `NONE`. Failure (one silently wins) would print one address; printed
  `192.0.2.1` and `192.0.2.2`, each process logging "SAW another answer". Reproduced by the reviewer.
- **M2** macOS's responder second (`dns-sd -P … 192.0.2.9`): "Name in use, please choose another".
- **M3** macOS's responder first: the probe query found `192.0.2.9`; then a Waitron-style responder
  on the same name made macOS's print "Name in use, please choose another"; lookups returned only
  the newcomer. Reproduced by the reviewer (the first holder exited).
- **M4** cache and goodbye: a stopped responder's answer was still served ~25 s later; after a
  life-0 answer, `dns-sd` printed `Rmv … 0` within a second. One responder answered two names.
- **M5** accented name: `new URL("https://Café-Lucía.local/").hostname` →
  `xn--caf-luca-d1a8b.local`; a lookup of the browser's form of a UTF-8 name timed out (exit 124);
  control, the UTF-8 form: `192.0.2.6`.
- **M6** the §5.1 table: `openssl verify -CAfile <ca> -verify_hostname <name> <leaf>`;
  `security verify-cert -c <leaf> -r <ca> -p ssl -s <name> -L`; Chromium `page.goto` to a Node HTTPS
  server on 127.0.0.1 with `--host-resolver-rules=MAP * 127.0.0.1`. Failure would be today's
  authority accepting the chosen name; all three refused.
- **M7** same key, wider constraint: OpenSSL "permitted subtree violation", Chromium
  `ERR_CERT_INVALID`; control (trusting the wider one) `OK` / `200`.
- **M8** (new, round 1) two authorities trusted at once. Same subject, no key identifiers:
  `openssl verify -CAfile <old+new>` → `waitron.local` OK, `cafe-lucia.local` "error 7 … certificate
  signature failure"; reversed order, the failure moved to the other leaf. Node `https.get` with
  `ca: [old, new]`: `waitron.local` 200, `cafe-lucia.local` `UNSPECIFIED`; reversed, the reverse.
  Distinct subjects (`Waitron server authority <name> <time>`) with key identifiers: all eight
  OpenSSL and Node checks OK. Controls: each leaf against its own authority alone OK. macOS
  (`security verify-cert -r old -r new` and reversed): both shapes accepted in both orders; its
  control, a leaf against the wrong authority alone, `CSSMERR_TP_NOT_TRUSTED`.
- **M9** (new) `new URL("https://ab--cd.local/")` → `ab--cd.local`; `xn--abc.local` → unchanged;
  `Bar-Lucia.local` → `bar-lucia.local`.
- **M10** (new, the reviewer's P2 shape) one Node HTTPS server, default leaf = the new name's,
  `SNICallback` choosing per name: `openssl s_client -servername waitron.local` → `CN=waitron.local`
  (callback called); `-servername cafe-lucia.local` → `CN=cafe-lucia.local`, verified against the new
  authority with `-verify_ip 127.0.0.1`: `0 (ok)`; `-noservername` → `CN=cafe-lucia.local`, `0 (ok)`,
  callback **not** called. So a nameless (IP) request always gets the default leaf.
- **M11** (new) the server's print agent after a path-R rename: a Node client still holding the old
  authority, against the new leaf at 127.0.0.1, failed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (for
  an old authority of either shape); with the new authority, `200`. That code is in the agent's
  re-fetch list (`server-ca.ts:9-15`), read, not run end to end.

## 15. Found while reading, outside this design

- Today's responder never probes, so a server can take its name from a standard-following device
  that already held it (M3). Slice 1 makes a server refuse a **new** name already held; a clash at
  start still displaces the other device by decision (§4.2), with an alert.
- Today's responder answers only an exact-case question (`mdns.ts:64`); RFC 6762 §16 says case does
  not matter. Read, not run. Slice 1.
- Today's responder sends no goodbye when it stops (`mdns.ts:85`); caches keep the answer up to
  120 s (M4). Slice 1.
- Every server's authority has the same subject and no key identifiers (M8). Slice 1.

# A917 — the owner chooses the server's `.local` name instead of `waitron.local`

Status: DESIGNED 2026-10-20 by an unattended campaign run; revised the same day after two fresh
reviews and a narrow check (round 1: 8 high, 8 medium, 10 low; round 2: 4 high, 9 medium, 12 low;
round 3: 1 high, 5 medium, 9 low — each finding's resolution is listed in §16). Waiting for the owner's answers
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
- ✓ `deploy/waitron.sh` (read by round 3): a plain `reset` deletes the state folder's contents
  **except `tls/`** (`:686-690`), so it keeps the name; `reset --all` (`:644`, `:683-684`) removes
  the whole state volume (§8).
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
- ✓ `state-secrets.ts:15-22`: backup archives, the bucket's sealed state and the (unused by any screen) `POST /api/box/recovery-bundle` carry `secrets.env`,
  `trading.env` and the four TLS files (✓ `archive-entries.ts` adds the optional
  `backup.env`/`modules.json`, `backup-optional-state.ts:10`).
- `scripts/name-constraints-spike.sh` and commits `fb47efd68`, `75f17f9e3` (read): desktop Chrome 152
  and macOS refused an outside name; **one Android phone's Chrome accepted it** under a
  user-installed authority. **No iPhone has been measured** (`75f17f9e3`: "iOS device still to
  measure"; `docs/backlog.md` says the same). Every iPhone statement below is an assumption.

### 2.4 What tells a device where the server is

- The trust page (✓ `trust-page.ts:75-135`) lists addresses and "Continue to Waitron". Its first
  step, shown on every device, is "Remove any old Waitron certificate" (✓ `trust-page.ts:44`); its
  third step's heading is the device's own (✓ `:63,67`). Its QR code is the
  first **IP address** (`box-reach.ts:14-16`, sweep), so some devices are opened by IP, not name.
- The till ✓ uses `location.origin` (`apps/till/src/main.ts:31-34`) and keeps the server list in
  `localStorage["waitron.servers"]` (sweep). ✓ Its "This device hasn't trusted the till yet" page,
  linking to `http://<the name it was opened at>/` (`main.ts:44-55`), shows only after someone clicks
  past the browser's own certificate warning (`trust-check.ts:1-2`, round 2); the till ships no
  service worker. ✓ Its device cookie is host-only on `.local` (`device-session.ts:30-40`).
  So a renamed server is a new origin to every device: no cookie, no stored data, no installed app.
- The print agent on the server dials `https://127.0.0.1` (sweep, `deploy/compose.yml:120`). ✓ It
  fetches the authority from `http://<host>/ca.crt` at start and after a certificate error, at most
  once an hour once it holds one, with no timer (`apps/print-agent/src/server-ca.ts:9-18,82-84,132`;
  §7.5). It accepts any non-empty 200 body as the authority (`:88-96`, round 2).
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
- **Devices are turned off by the rename and each pairs again in place of its old entry**, keeping
  its profile, printers and cash drawer (§7.4).
- **No database migration** anywhere in the design (the old name, its 14 days and the turned-off
  device ids live in a state file, §8).
- **Servers whose address or certificate the operator set in `.env` are neither named nor renamed**
  (§8).

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
- Refused names: `localhost` and `local`; and, as precautions, a name starting `xn--` (the form
  browsers use for encoded accented names), `wpad` and `broadcasthost` (names operating systems
  treat specially). None of the three precautions was measured to cause harm: M9 found `new URL`
  leaves both `ab--cd.local` and `xn--abc.local` as typed, so it does not show why `xn--` would
  fail; other double hyphens are allowed.
- `waitron` is allowed; it is the default.
- Refusal codes: **`node.name_invalid`** and **`node.name_taken`**. Grepped every `errors.ts`:
  "this name is already used" is `<thing>.name_taken` everywhere (`device.name_taken`,
  `category.name_taken`, `department.name_taken`, `zone.name_taken` and nine more), while `.in_use`
  means "still referenced, cannot delete" (`device_profile.in_use`). Machine codes are `node.*`
  (`node.not_found`, `node.read_only`, `node.reset` …); `server.*` is reserved for facts about the
  process (CLAUDE.md §3). Also: **`node.rename_operator_managed`** (a rename on a server whose
  address or certificate the operator set, §8), **`node.already_named`** (a naming request that lost, §9), and the alert **`node.name_clash`**.

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
  it, or rename this server"), an **ongoing** alert (true while the clash lasts, not a recorded incident): its code goes in
  `apps/server/src/alert-sources.ts`, one of the files `ONGOING_CODE_SOURCES` lists in
  `scripts/ongoing-alert-codes.test.ts`, with English and Spanish wording in
  `apps/dashboard/src/i18n/alert-messages.ts`. Every ongoing source declares an `area` and a
  `permission` (`packages/module/src/alerts.ts:35-42`): this one is a new area `network`, linking to
  the Servers screen, with `system.manage` — the permission the backup alerts use — so managers and
  admins see it, although only an admin can rename (§8); the text says to rename the other device
  or ask an admin.
  **This displaces the other device** if it follows the standard (M3): it gives up the name and
  picks another. Decided, with the trade-off weighed: the server is what sells (CLAUDE.md §5,
  "Nothing EXTERNAL may block a sale"), and every till is opened at this name; a printer Waitron
  drives is usually reached by its address (discovery stores the IPv4 address when it sees one and
  otherwise keeps the `.local` name, `print-agent/src/network.ts:142`, round 2), and one that gave up a clashing name keeps working under its new
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
  still paired again (a new origin) and passkeys are still lost. The authority then holds no chosen
  name, so the name needs its own file carried in backups, and a backup without it restores as
  `waitron.local` (§8). The cost: whoever holds the server's authority key — it lives on the server,
  in every backup archive and in the bucket's sealed state — could make every staff Mac and desktop
  Chrome trusting it accept a fake printer or fake server page without a warning; iPhones and
  Windows are expected to behave the same, not measured. Today they could fake only
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

| Piece | Path R | Path W |
| ----- | ------ | ------ |
| Trading during the change | Each till and phone stops until re-trusted and paired again in place; do it when closed | Uninterrupted |
| Certificates on the server | One authority, one leaf; the old name's HTTPS handshake is refused (M13) | Two of each; a leaf chosen per requested name (`SNICallback`, M10) |
| Opened by IP / the server's print agent | A nameless request gets the one leaf (M10); the agent re-fetches the authority on the error, once its one-hour limit is lifted (slice 4, §7) | A nameless request gets one default leaf (M10): IP-opened devices and the agent break at the switch or at the end of the window and cannot "move" |
| Two authorities on one device | Never needed: the trust page's first step removes any old one | Required during the move; the removal step must be skipped for movers (round 1, H1) |
| Membership `contactUrl` | Re-signed once, as `writeChartInRounds` does (§7) | The same, plus the CORS list (`allowed-origins.ts`) holding both names |
| Single-origin checks (§2.1) | Follow the one origin | Each becomes per-name: `cloud-api.ts`, `content-suggestions-api.ts`, email links |
| Passkeys | All deleted at the rename; no new column | A relying-party-ID column on `webauthn_credentials` (an identity migration) and a per-request ID |
| Device identity | Old rows turned off by the rename; each device pairs again **in place of** its old row and keeps its settings (§7.4) | A one-time move code; the server issues a **new** device token (only its hash is stored), ending the old-name cookie at that moment |
| Restores | One authority to restore | Two authority pairs to carry during the window |
| Migrations | None | At least one (passkeys), plus a per-device "moved" mark that has to be `local` and keyed by node |
| Build | Slices 4–5 below | Roughly twice that, each piece above with its own tests |

Why R: a rename is rare and can be planned for a closed day. W buys an uninterrupted rename at the
price of a second certificate world, per-name origin handling, a passkey migration, a device-token
handover and rules for IP-opened devices — each a new place for a defect in sign-in. For Bar Lucía,
path R costs one closed-day session: each of 5 devices installs the certificate and is paired again
in place, a few minutes each — **an estimate, not timed**. Path W is question 3's option B.

## 7. A rename on path R, step by step

### 7.1 Before: the dialog (picture 04)

The dialog probes the new name (§4.2), then shows, **before** anything happens, the new address, a
QR code of `http://bar-lucia.local/setup/trust`, and the steps for each kind of device: tills and
phones (install the certificate, open `https://bar-lucia.local`, a manager accepts each in place of
its old entry); this computer and other dashboards (install the certificate, sign in with the
password, add a passkey again — someone who has forgotten their password needs email set up to
reset it; read by round 2's helper at `boot.ts:1804-1811`); a print agent on another computer
(change its Server address on its own page, port 9110, as `finish.ts:65` already says after a
rebuild). The action reads "Change name and restart" — a decision against design-system.md's "A
form's submit button says Save", because this action restarts the server and every device stops
reaching it; the label says so.

### 7.2 At the confirm: one chart write, then a swap decided from what is on disk

**Who may.** The rename is offered only on a server whose address and certificate are its own
(§8, "operator settings"); elsewhere the row action is absent and the route refuses
`node.rename_operator_managed`.

**Refusals first** (in the request, before anything is written): the name rule and probe (§4);
and, for every active device, `assertNoPaymentInProgress` (✓ `device.ts:249-258`), so the rename
refuses with the existing `device.payment_in_progress` while any card payment still waits on its
provider — the same check `deleteDevice` makes (✓ `device-delete.ts:198-200`). The dialog says so.
A tender refund a till has saved for a retry lives only in that till's browser
(`waitron.tender-refund:`, `apps/till/src/state/tender-refund.ts:25`, round 3); the server cannot
see it, so the dialog asks for open refunds to be finished first, and §7.4 lists it as lost.

1. **Stage.** Write the new authority and leaf (distinct subject and key identifiers, §5.3) into
   `<state>/tls.next.partial/`, then rename it to `<state>/tls.next/` — so `tls.next/` exists only
   when complete.
2. **Marker.** Write `<state>/rename-pending.json`: the new name, the old name, the deadline (14
   days on), and the ids of the devices active right now.
3. **One database write, modelled on `writeChartInRounds`** (✓ `membership-removal.ts:204-229`:
   read the held chart, mint the next with `mintNextMembershipDocument`, persist it term-guarded with
   `persistNodeMembershipIfNewerTx` and a `record(tx, term)` in **one transaction**; it reads no
   bucket). The chart's entry for this server gets `contactUrl` `https://<new name>`. The record
   step, in the same transaction: check that the active devices are exactly the marker's ids (if
   one was added meanwhile, the transaction aborts and the request fails; the next boot discards
   the staging), turn each off as `disableDevice` does (✓ `device-delete.ts:175-185`: `active` off,
   sign-ins ended, holds released — not `deleteDevice`, which removes settings), delete every
   passkey, and clear every person's `passkey_offered_at` (round 2's helper:
   `packages/identity/src/passkey-offer.ts`). Not modelled on `completeRebuild`, which reads the
   bucket pointer first (`rebuild-first-start.ts:125-134`).
4. **Restart.** Boot settles the folders **before anything else** — before serving and before the
   sealed-state refresh at `boot.ts:2014` (§7.6) — and decides every step from what it finds:

   - Always first: delete `tls.next.partial/` (never complete).
   - **No marker**: if `tls/` is missing and `tls.old/` exists, rename `tls.old/` to `tls/`; delete
     any `tls.old/` and `tls.next/` left over. Done.
   - **Marker, not committed** (the held chart's own `contactUrl` does not name the marker's new
     name): if `tls/` is missing and `tls.old/` exists, rename it back; delete `tls.next/`,
     `tls.old/` and the marker. The server keeps its old name.
   - **Marker, committed**:
     - if `tls.next/` exists, the swap is unfinished and `tls/` (if present) still holds the old
       set: delete any stale `tls.old/`, rename `tls/` to `tls.old/` (if present), then rename
       `tls.next/` to `tls/`;
     - write `previous-name.json` from the marker (old name, deadline, the turned-off device ids;
       overwriting is harmless);
     - delete `tls.old/`;
     - delete the marker.

   Every branch is repeatable, so **a crash after any step is finished by the next boot**. This was
   simulated (M17): a crash after each of the ten points below, then three boots with no crash,
   ended every time with one complete `tls/` (the old set if the transaction had not committed, the
   new one if it had), no leftovers and no boot error; the rule as written at 86fd821c6 failed four
   of the same ten points (three of them as round 3's reviewer found: `ENOTEMPTY` forever, or no
   `tls/` at all).

**Crash points slice 4's test covers** (each followed by three restarts): during staging (partial
folder), after staging, after the marker, after the commit, after `tls/`→`tls.old/`, after
`tls.next/`→`tls/`, after writing `previous-name.json`, after deleting `tls.old/`, after deleting
the marker; and each of those followed by `waitron.sh reset` (database wiped, the folders kept,
§8), which must also end with one complete `tls/`. Plus: the rename succeeds with the bucket
unreachable; no passkey survives; every `passkey_offered_at` is clear; a payment in progress
refuses the rename.

**Mirrors.** A venue has one server today (CLAUDE.md §5). A mirror node keeps the chart it was
given when it was paired: the only writers of a node's chart are the mirror-bundle route at
pairing, retire and the rebuild (`persistNodeMembershipIfNewer` callers `mirror-bundle-api.ts:185`,
`retire.ts:74`, `rebuild-first-start.ts:137`, round 3), and the block at `boot.ts:1336-1360` runs
only on a **non**-mirror node, fetching its cloud peer's chart to demote itself. So after a rename a
mirror keeps the old chart and the old `contactUrl` until it is paired again. No reader that routes
by a mirror's copy was found (round 3, not exhaustive). Delivering the new chart to a mirror is
later work: backlog "A mirror keeps a renamed server's old chart (A917)" in _Replication, failover
and the cloud_.

### 7.3 What each device actually sees

Measured (M14, Chromium 153 trusting only the old authority):

- A till or phone **reloading `https://waitron.local`** gets the browser's own "This site can't be
  reached" page (`ERR_CONNECTION_CLOSED`): the server refuses the handshake for the old name (M13).
  No Waitron page runs. The till's own "This device hasn't trusted the till yet" page
  (`main.ts:44-55`) helps only someone who clicked past a browser certificate warning
  (`apps/till/src/trust-check.ts:1-2`); the till ships no service worker (round 2, grep).
- A till **opened by IP address** gets the browser's certificate warning (`ERR_CERT_AUTHORITY_INVALID`);
  control: trusting the new authority, the same address loads (200).
- A till that was **already open** keeps its loaded page; its requests to the server fail. How the
  till shows a failing server today was not examined; nothing new is designed here.
- So the steps reach staff through the **dialog** (shown before the restart, with the QR code) and
  the **after-rename card** (picture 05, at the new address). The plain-HTTP old name answers for 14
  days with the pointer page (picture 06) at `/` and `/setup/trust` only — it helps someone who
  types `http://waitron.local`. It answers **404 at `/ca.crt`** and every other path, so nothing
  can pin HTML as an authority (round 2's M-2: the agent accepts any non-empty 200 body,
  `server-ca.ts:88-96`). A test pins the 404.
- An already-open till noticing failed requests and pointing at the new name by itself would be new
  code; it is not designed here and is listed as a later possibility.

### 7.4 Pairing again in place

Device names are unique among **active** rows per location (`devices_location_label_active_key` on
`location_id, label`, `packages/db/src/schema/devices.ts:75-79`, round 3), and a second active "Bar
till" is refused with `device.name_taken`. The existing way back for a turned-off device needs the
device's own cookie (`provenDisabledDevice`, ✓ `join-requests.ts:231-242`), which a new origin does
not have. So:

- The rename turns off exactly the devices that were active (§7.2), freeing the names and keeping
  every row and id. Their ids are kept in `previous-name.json` (§8).
- The Devices screen's accept step gains **"Accept in place of …"**, listing **only** the ids in
  `previous-name.json` that are still turned off. A device a manager had turned off before the
  rename — a stolen till, say — is never offered, so its settings and drawer choice cannot be
  handed to a new browser. Accepting in place gives that row the new browser's token and turns it
  back on, under its old id, keeping everything stored on it: profile, kitchen screens, receipt,
  payment-slip and invoice printers, **cash drawer choice** (which decides which drawer opens,
  CLAUDE.md §5), "made here" stations, switchable profiles and chosen card reader, and its zone
  selections (`disableDevice` leaves all of these, `device-delete.ts:175-225`, round 3).
- **After day 14** `previous-name.json` is deleted, the offer disappears, and a device not yet
  paired again stays turned off; pairing it then makes a new device whose settings are set again
  (or a manager removes the old row).
- Lost, because only the old address's browser storage held them (keys found by round 3 in
  `apps/till/src`): the last operator (`lastOperator`), zone menu (`zoneMenu.`), last menu
  (`lastMenu`), diet filter (`dietFilter`), find-bill searches (`find-bill.*`), station screen view
  (`stationScreenView`), "make now" (`makeNow`), a tender refund saved for a retry
  (`waitron.tender-refund:`), and the server list (`servers`, rebuilt at the first request).
- This matches CLAUDE.md §3's "A retained hardware registration must remain re-addable" — the row
  comes back under its existing id — through a new path, since the old one needs the cookie.

### 7.5 The server's own print agent

Measured by round 2's reviewer with the real `createServerTrustingFetch`: 10 minutes after its last
fetch of the authority, a print after a certificate change failed
(`UNABLE_TO_VERIFY_LEAF_SIGNATURE`); 61 minutes after, it worked. ✓ The code agrees:
`server-ca.ts:82-84` skips a re-fetch within `REFRESH_INTERVAL_MS` (one hour) of the last one once
an authority is held, and there is no timer — the agent fetches at start and after a verification
error, at most once an hour. The rename restarts the server, not the agent's container.

Decided (slice 4): on a **verification error**, the agent may re-fetch after **one minute** rather
than one hour. `refresh()` is called only at start (unthrottled: `lastFetchAt` starts at
`-Infinity`, `server-ca.ts:62,112-123`) and after a verification error (`:132`), so this **removes
the hourly limit altogether**: an agent facing a server with a broken certificate asks
`http://<host>/ca.crt` at most once a minute. Test: switch the authority 10 minutes after
the agent started; the next print succeeds. (M11 showed the error code is one the agent already
treats as "maybe rotated".)

### 7.6 After

- The restart derives the passkey name, dashboard origin, email links and new devices' address
  from the new name (§8).
- The Servers screen at the new address shows "Renamed to bar-lucia.local" (picture 05): the steps,
  each turned-off device as "Waiting" or "Paired again", and the remote print agent note.
- After 14 days the server stops answering the old name (with a goodbye) and deletes
  `previous-name.json`.
- **Google sign-in** is not affected by a rename: Google refuses a `.local` return address
  ("Host TLDs (Top Level Domains) must belong to the public suffix list", §13; `local` is not on
  that list, M15). ✓ The code builds the return address from the dashboard origin
  (`config.ts:539-546`) only when a Google client is configured, so Google sign-in already works
  only for an operator's real domain set in `.env` — true at `waitron.local` today too.
- **Related origins, considered:** WebAuthn-3 §5.11 "Related Origin Requests" could let a new name
  use an old name's passkeys while the old name serves `/.well-known/webauthn`. Path R serves no
  HTTPS at the old name, and browser support was not measured; not used.
- `mirror_config.box_hostname` and `box_ca_pem` on a mirror node go stale at a rename. Nothing reads
  them today; a future tunnel client that pins them must refresh them from the next mirror bundle.
- **Backups**: archives and the bucket's sealed state carry `RECOVERY_FILES` (the TLS files
  included). The next archive carries the new authority. The sealed state is refreshed at each start
  (`boot.ts:2014`) **only when a recovery key is set** — otherwise it reports `no_key` and writes no
  row (`sealed-state.ts:109-112`, round 3) — and reaches the bucket only through the database
  stream; because boot settles the folders before that refresh (§7.2 step 4), the start after a
  rename seals the new authority. Nothing has to be downloaded. A backup taken before the
  rename brings back the old name; the dialog says so. (The product's words are "recovery kit" and
  "recovery pack", which hold keys, not these files; the unused `POST /api/box/recovery-bundle` is
  not offered.)

## 8. Where the name lives, who changes it, restarts

- **Storage: the authority.** At start the server reads `<state>/tls/ca.crt` and takes its one
  permitted DNS name other than `localhost` as its name; an authority made before this feature reads
  as `waitron.local`. No new file, so `RECOVERY_FILES` and the backup archive are unchanged and an
  unnamed server's backups behave as today. A server given an operator's own certificate
  (`WAITRON_TLS_*`) still makes its own authority (✓ `boot.ts:963-964`) but serves the operator's;
  its addresses come from the operator's `.env` settings, as today.
- **"Named"** means `<state>/tls/server.key` exists — today's sentinel (`box-secrets.ts:139-140`).
- **The old name** during the 14 days: `<state>/previous-name.json` (`{ name, until, devices }`,
  `devices` being the ids the rename turned off), written by the boot that finishes the swap
  (§7.2) from the marker. Read by the mDNS responder, the plain-HTTP listener (the pointer page),
  the after-rename card and the Devices screen's "Accept in place of …" (§7.4). It is a state file, **not carried in backups** (a
  restore inside the 14 days loses only the pointer page) — so no table and **no migration**.
- **Operator settings** (round 3, M3). A server where the operator set `WAITRON_MANAGEMENT_ORIGIN`,
  `WAITRON_ADVERTISED_ORIGIN`, `WAITRON_MANAGEMENT_RP_ID` or `WAITRON_TLS_*` in `.env` is **never
  unnamed and never renamed**: it makes its authority as today (named `waitron.local`) with no
  naming page, and the rename is not offered (the route refuses `node.rename_operator_managed`;
  the Servers row shows "This server's address is set in its settings file"). Reason: its address,
  passkey name or certificate are the operator's, not the `.local` name — the chart's `contactUrl`
  would not name the new name (so §7.2's commit test would undo every rename), deleting passkeys
  would be needless, and with `WAITRON_TLS_*` the setup start serves the operator's certificate
  (`boot.ts:1235`) and no plain-HTTP page (`boot.ts:666-672`).
- **`waitron.sh reset`** keeps `tls/` (`deploy/waitron.sh:686-690`: "keeping the CA + leaf so an
  already-trusting phone needs no new step"), so **a reset keeps the name**. Only `reset --all`
  (`:644`, `:683-684`), which removes the whole state volume — vault key and fiscal identity
  included — makes a server unnamed. Slice 4 adds the rename's working files to what a plain reset
  keeps (`tls.next/`, `tls.old/`, `rename-pending.json`), so a reset in the middle of a swap never
  deletes the only authority; the next boot settles them (§7.2; with the database wiped the
  rename reads as not committed or finished, and either way one complete `tls/` remains, M17).
  `previous-name.json` is deleted by a reset (its devices are gone with the database).
- **Restore**: a restore brings back the authority and so the name it permits; the leaf re-issued
  after a restore (`rebuild-first-start.ts:112`) is for that name, read from the same authority.
  `reissueServerLeaf` gains a check refusing a name its authority does not permit (a test pins
  it). If the installer named the new server and then restores, the restored name wins and the
  setup device installs a certificate again, as a restore already requires; the naming page says
  so beforehand ("Restoring from a backup? Keep the default: the backup brings back its own name").
- **If the owner picks B for question 2** (one authority for all of `.local`), the authority holds
  no chosen name. The name then needs its own file, `<state>/name.json`, added to
  `OPTIONAL_BACKUP_STATE` (`backup-optional-state.ts:10`) so backups carry it; a backup without it
  restores as `waitron.local`. Certificates cannot disagree with it (that authority permits any
  `.local` name), but a restore can bring back an older name. Question 2 tells the owner.
- **The environment**: the image stops baking the passkey name and dashboard origin, and compose
  stops defaulting them; unset, the server derives both from its name. An operator's explicit
  `.env` values still win (`docs/developers/cloud-connection.md`).
- **Who may rename**: "Change network name…" on the Servers screen's "This server" row, checking
  `mirror.create`. Decided: the permission's own description is "Decides which machines are in the
  venue's membership chart and hands one its identity" (✓ `packages/identity/src/permissions.ts:33-35`),
  and a rename re-signs that chart. It is admin-only; `system.manage`, which managers hold and
  which guards backup, cloud and email settings, is the alternative if managers should rename.
- **Restarts**: naming at setup restarts the setup server once (§9); a rename restarts once.
- **Unnamed**: the first page opens with `waitron` filled in and "Use this name" enabled — the
  forms rule's "enabled at once if it opens already savable" (design-system.md → Forms). The line
  under the field ("Devices will open this server at https://waitron.local") is a live preview,
  not a hint.

## 9. Setup before the server has a name

Today the setup start makes the vault key, the authority and the leaf before serving
(✓ `boot.ts:958-972`), the vault key independently of the TLS files (`box-secrets.ts:154-162`,
round 2), and the plain-HTTP listener exists only once a leaf exists (✓ `boot.ts:670-676`).

New pre-name state (slice 2):

- The setup start makes the **vault key** as today, and **no** authority or leaf while unnamed.
- **HTTPS still runs**, with a throwaway self-signed certificate made in memory at each start —
  never written to `tls/`, never offered for download, trusted by nothing. It answers `/health`,
  and `/setup-api/status` reporting `unnamed`; `/setup-api/ca.crt` keeps today's 404 `no_box_ca`
  (`discovery-api.test.ts:115-120`, round 3); every other route setup mounts today — discovery, the
  trust page, the guide pages and the setup app (`boot.ts:940-956`) — answers a plain page pointing
  at `http://<address>/`. This keeps the container health check and the installer working unchanged:
  - the health check (`deploy/compose.yml:56-66`) runs `node:https` against `127.0.0.1:443` for
    `/health` and `/setup-api/status`, with certificate checks off, and passes if either answers
    200. Measured (M12): the exact command from `compose.yml` exited 0 against such a server, and 1
    with nothing listening;
  - `waitron.sh`'s `wait_healthy` (`deploy/waitron.sh:574-588`) waits for Docker's `healthy`
    (36 tries, 5 s apart) and is unchanged.
- Plain HTTP on port 80 serves the naming page (picture 01); `startLandingListener` no longer needs
  a leaf. Its `/ca.crt` answers the same 404 `no_box_ca`; no new code is needed for it, so
  `node.unnamed` is dropped.
- **Single winner.** The probe and mint run under one in-process lock (one process owns the state
  folder, CLAUDE.md §3), and the mint writes all four files into `<state>/tls.staging-<random>/`,
  then renames that folder onto `<state>/tls`. Measured (M16): the first rename succeeded; a second
  contender's rename onto the now non-empty `tls` was refused (`ENOTEMPTY`) and its staging folder
  was left for cleanup — on macOS 26.6.2 and on Linux (Node 24, in Docker). The loser is refused
  with `node.already_named`; boot deletes any leftover staging folder. A `tls/` holding some files
  but no `server.key` — what today's mint leaves if it crashes part-way, since it writes
  `server.key` last (`box-secrets.ts:150-156`) — would refuse the rename onto it (round 3 measured
  `ENOTEMPTY`), so boot treats it like a leftover staging folder and deletes it while no rename
  marker exists; the server is then unnamed, as today's code re-mints over it.
  "Named" (`tls/server.key`) and "has an authority" therefore never disagree.
- The naming form is an **unauthenticated plain-HTTP write**, acceptable for the same reason setup
  itself is: an unclaimed server can be set up by anyone on its network. It is accepted only while
  unnamed.
- Accepting a name: probe (§4.2), mint, rename into place, restart the setup server (seconds). The
  page then shows the trust steps (picture 02).
- A server that already has `tls/server.key` (every server today, and any restored one), or one
  with operator settings (§8), skips this.
- Guards slice 2 must update or add to: `scripts/deploy-image-env.test.ts` (it pins the image's
  environment and `waitron.sh`'s printed setup link as text — the baked passkey name and origin go
  away, and the IP link is added) and `scripts/waitron-sh.test.mjs` (lines 529, 627-628 and 1407
  assert the printed setup links and QR code, and 625 and 1162 pin
  `https://waitron.local/manage/email`; a new case asserts the IP link). Slice 4 adds a
  `waitron-sh.test.mjs` case for what a plain reset keeps. New server tests: an
  unnamed start passes the health check's requests and serves the naming page; `/ca.crt` refuses
  before naming; two concurrent naming requests produce one authority and one refusal; a staging
  folder left by a crash is deleted at the next start and the server is still unnamed; a start
  with `tls/server.key` skips naming; development mode never probes.

## 10. What people read, and the development rule

- **Guides** never name the server (§2.5): nothing changes.
- **Trust page**: "This server is called bar-lucia.local." and links using the name (picture 02).
- **Naming page**: says a restore brings back the backup's own name (picture 01).
- **Pointer page** at the old name for 14 days (picture 06), English with the Spanish twin.
- **Rename dialog and after-rename card** carry the steps (pictures 04, 05).
- **Setup done screen** (`finish.ts:61,143`): the name becomes a placeholder in both languages.
- **`waitron.sh`**: prints the `waitron.local` link and the IP link at install; later links read the
  name from the server, falling back to `waitron.local`.
- **The development and loopback rule** (CLAUDE.md §6, guard `apps/server/src/mdns.test.ts`): the
  gate at `mdns.ts:55` comes before any socket, whatever the name, and the probe sits behind it.
  `mdns.test.ts` gains a case with a chosen name in development mode and on a loopback listener.

## 11. Build slices (full review path: certificates, sign-in and a cross-package contract)

1. **Name, responder, authority shape.** Read the name from the authority; the name rule and
   clean-up (tests at 63/64 characters, a leading digit, leading/trailing hyphen, `xn--`, `ab--cd`,
   `Café Lucía`, upper case); case-insensitive answers, several names, probe at start, goodbye,
   the ongoing alert `node.name_clash`; distinct authority subjects and key identifiers; the
   restore check in `reissueServerLeaf`. No visible change for an unnamed server.
2. **Naming at setup.** The pre-name state of §9 (throwaway HTTPS certificate, naming page, single
   winner), probe on accept, trust-page line, done-screen string, `waitron.sh`'s IP link,
   `waitron.local` answered in setup only when free (§4.3), the guards listed in §9.
3. **Environment from the name.** Dockerfile, compose, `config.ts`, deploy tests,
   `deploy/README.md`, the `.env.example` files, `docs/developers/*`.
4. **Rename, server side.** Route checking `mirror.create`; staging, the one chart write with its
   record step, the boot that finishes the swap (§7.2); the old name's handshake refused, its
   plain-HTTP pointer page and 404s (§7.3); `previous-name.json`; "accept in place of" on the
   server (§7.4); the print agent's one-minute re-fetch after a verification error (§7.5); the
   payment-in-progress refusal (§7.2); the operator-settings refusal (§8); what `waitron.sh reset`
   keeps (§8). Tests as listed in §7.2 (every crash point, each also followed by a reset).
5. **Rename, screens.** Servers row action, the dialog with QR code and steps, the after-rename
   card (pictures 03–05), the Devices screen's "Accept in place of …", the pointer page (06),
   English and Spanish strings, the dialog's unsaved-changes test.

## 12. Questions for the owner

Ready to paste in `~/waitron-campaign/a917-design/question.md`, in this order, because "at setup
only" makes the other two moot:

1. **Where the name is set** (picture 07): A, at setup and later from the dashboard (recommended);
   or B, at setup only — **a venue that keeps its data can then never be renamed**: an ordinary
   reset keeps the name, and so does restoring a backup; a new name means wiping the server
   completely (`waitron.sh reset --all`) and starting with no data (drops slices 4–5 and questions
   2–3).
2. **The certificate authority** (picture 08): A, for the chosen name only, a new one at a rename
   (recommended); or B, one for every `.local` name — which also needs the name in its own file,
   carried in backups, with a backup lacking it restoring as `waitron.local`.
3. **The old name during a rename** (picture 09): A, a planned re-trust: the old name only shows
   where the server went, for 14 days (recommended, path R); or B, two names for up to 14 days,
   each device working until it moves (path W, much more to build).

Decided without asking (trade-offs above): the name rule and codes (§4.1), probe-first and answering
anyway with an alert (§4.2), setup's `waitron.local` only when free (§4.3), the name read from the
authority (§8), `mirror.create` (§8), one restart per rename, deleting all passkeys and turning off
all devices with "accept in place of" (§7), the action label (§7.1), the agent's one-minute re-fetch
(§7.5).

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
| Google refuses `.local` return addresses | "Host TLDs (Top Level Domains) must belong to the public suffix list" | https://developers.google.com/identity/protocols/oauth2/web-server |
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
  re-fetch list (`server-ca.ts:9-15`), read, not run end to end. Round 2's reviewer ran the real
  `createServerTrustingFetch`: 10 minutes after its last fetch the print failed with that code, 61
  minutes after it worked — the one-hour limit §7.5 changes.
- **M12** (new, round 2) the pre-name health check: the exact `node -e` command from
  `deploy/compose.yml`, with `WAITRON_HTTP_PORT` pointed at a Node HTTPS server holding a throwaway
  self-signed certificate and answering `/health` and `/setup-api/status`. Failure would be exit 1;
  it exited **0**. Control, nothing listening: exit **1**.
- **M13** (new) refusing the old name: a Node HTTPS server whose `SNICallback` errors for
  `waitron.local`. `openssl s_client -servername waitron.local` → "no peer certificate available"
  (connection closed); `-servername cafe-lucia.local` and `-noservername` → `subject=CN=cafe-lucia.local`.
- **M14** (new) what a till sees: Chromium 153 trusting only the old authority, server as in M13 with
  the new leaf. `https://waitron.local` → `ERR_CONNECTION_CLOSED`; `https://127.0.0.1` →
  `ERR_CERT_AUTHORITY_INVALID`. Control, trusting the new authority: `https://127.0.0.1` → 200 (the
  old name stays closed, as designed).
- **M15** (new) Google's rule: `curl` of
  https://developers.google.com/identity/protocols/oauth2/web-server found "Host TLDs (Top Level
  Domains) must belong to the public suffix list"; `curl` of
  https://publicsuffix.org/list/public_suffix_list.dat (16,570 lines): an exact `local` rule 0 times,
  control `com` 1 time (`/usr/bin/grep -cx`).
- **M16** (new) single-winner naming: two staging folders, each renamed onto `tls` in turn with
  `fs.renameSync`. First: renamed into place; second: refused `ENOTEMPTY`; `tls/server.key` held the
  first's content; the loser's folder remained. Same on macOS 26.6.2 (Node v26.11.1, APFS) and in
  `mcr.microsoft.com/playwright:v1.63.0-noble` (Node v24.20.0, the container's own filesystem — not a
  Docker volume like the server's state folder; not measured there).
- **M17** (new, round 3) the rename's folder swap, crash-simulated: `node swap-sim.mjs <dir> new`
  (kept in `~/waitron-campaign/a917-mockups-src/probes/round3/`). Real folders in a `mktemp -d`;
  a crash injected after each of ten points (partial staging, staged, marker, commit,
  `tls/`→`tls.old/`, `tls.next/`→`tls/`, `previous-name.json`, delete `tls.old/`, delete marker,
  none), then three boots. Pass = no boot throws and one complete `tls/` (old set if uncommitted,
  new if committed), no `tls.next/`, `tls.old/` or marker. The failing case would print `FAIL` with
  a boot error or a missing or mixed `tls/`. Printed: **new rule, 0 of 10 failed**. Control,
  `node swap-sim.mjs <dir> old` (the rule as written at 86fd821c6): **4 of 10 failed** — after
  `tls.next/`→`tls/` and after `previous-name.json`, every boot threw `ENOTEMPTY`
  (`tls=NEW old=OLD marker=true`); after deleting `tls.old/`, every boot threw `ENOENT` and no
  `tls/` remained (`tls=- old=NEW`); after staging, `tls.next/` was left behind. With a reset after
  each crash (`… new reset`: database wiped, folders and marker kept; pass = one complete `tls/` of
  either set): **0 of 10 failed**.

## 15. Found while reading, outside this design

- Today's responder never probes, so a server can take its name from a standard-following device
  that already held it (M3). Slice 1 makes a server refuse a **new** name already held; a clash at
  start still displaces the other device by decision (§4.2), with an alert.
- Today's responder answers only an exact-case question (`mdns.ts:64`); RFC 6762 §16 says case does
  not matter. Read, not run. Slice 1.
- Today's responder sends no goodbye when it stops (`mdns.ts:85`); caches keep the answer up to
  120 s (M4). Slice 1.
- Every server's authority has the same subject and no key identifiers (M8). Slice 1.

## 16. Review findings and their resolution

Round 1 (8 high, 8 medium, 10 low; `~/waitron-campaign/a917-review/round1-findings.md`): the rename
path was re-weighed and changed to path R (§6); distinct authority subjects (§5.3, M8); the
no-name default certificate settled by one leaf (§6, M10); the membership re-sign (§7.2); the name
read from the authority (§8); the pre-name state (§9); the start-time clash stated and decided
(§4.2); passkeys deleted (§7.2); single-origin checks (§2.1); iPhone claims labelled; forms rules
on picture 01; `node.*` codes (§4.1); "server" wording; the question order (§12); and the ten low
items in place.

Round 2 (`round2-findings.md`):

| Finding | Resolution |
| ------- | ---------- |
| H1 the till never shows the pointer page | §7.3 rewritten from M14; the dialog and card carry the steps; §2.4 corrected |
| H2 health check and installer in the pre-name state | §9: a throwaway in-memory HTTPS certificate keeps both unchanged (M12); guards named |
| H3 question 2 B leaves no name in the authority | §5.2 B, §8 and question 2 state the name file and the restore rule |
| H4 question 1 B's real cost | §12, question 1 and picture 07 say a venue keeping its data can never be renamed |
| M-1 print agent's one-hour limit | §2.4 corrected; §7.5 one-minute re-fetch after a verification error, slice 4, with a test |
| M-2 remote print agent and `/ca.crt` | §7.3: the old name answers 404 at `/ca.crt`; its address change is in the dialog, card and §7.1 |
| M-3 pairing again collides with old rows | §7.4: the rename turns rows off; "accept in place of" keeps every setting; what is lost is listed |
| M-4 wrong re-sign model, standby sentence | §7.2 modelled on `writeChartInRounds`; mirror and future-standby wording corrected |
| M-5 where the old name is kept | `previous-name.json`, not in backups, no migration (§8) |
| M-6 naming race and sentinel | §9: one lock plus a staging folder renamed onto `tls` (M16); "named" = `tls/server.key` |
| M-7 crash-safe swap | §7.2: staging, one transaction, boot finishes or discards by the chart's own `contactUrl` |
| M-8 "recovery bundle" | Dropped; backups carry the new authority by themselves (§7.6); the product's words noted |
| M-9 the renamer's next step | The dialog shows the steps, QR code and new address before the restart (picture 04); computers sign in, not pair |
| L-1 Google | Settled with Google's rule (§7.6, M15) |
| L-2 bottom message | Picture 01's right panel gains it |
| L-3 action label | Kept as a stated decision (§7.1) |
| L-4 "Chrome" | "desktop Chrome"; Windows unmeasured (§5.2, question 2, picture 08) |
| L-5 alert kind, `node.unnamed` | Ongoing alert in `alert-sources.ts` (§4.2); codes listed (§4.1) |
| L-6 M9 does not discriminate | `xn--` called a precaution (§4.1) |
| L-7 trust-page headings | §2.4 and picture 02 use the real headings |
| L-8 how the old name's HTTPS is refused | `SNICallback` refusal (§7.3, M13) |
| L-9 status line | Points here |
| L-10 passkey offer, forgotten password | Offer reset in the rename transaction (§7.2); the dialog mentions email (§7.1) |
| L-11 printers by address | "usually" (§4.2) |
| L-12 restore replaces the name | The naming page says so (picture 01, §8) |

Round 3 (`round3-findings.md`):

| Finding | Resolution |
| ------- | ---------- |
| H1 swap not crash-safe | §7.2 step 4 decides each step from what is on disk; crash-simulated (M17: 0 of 10 failed, control 4 of 10); slice 4's crash points listed |
| M1 mirror sentence reversed | §7.2: a mirror keeps the old chart until paired again; delivery is later work, backlog entry added |
| M2 which devices the rename turned off | Their ids in `previous-name.json`; only those are offered; after day 14 the offer ends (§7.4, §8); no migration |
| M3 operator settings | Such servers are neither named nor renamed; `node.rename_operator_managed` (§8) |
| M4 `waitron.sh reset` | §2.1 and §8: a reset keeps the name, only `reset --all` clears it; reset keeps the rename's working files; question 1 B reworded |
| M5 payment in progress | The rename refuses with `device.payment_in_progress` via `assertNoPaymentInProgress`; saved tender refunds named and listed as lost (§7.2, §7.4, picture 04) |
| L1 partial `tls/` | Boot deletes a `tls/` without `server.key` when no rename is pending (§9) |
| L2 the hourly limit | §7.5 says the one-minute rule removes it altogether |
| L3 alert area and permission | Area `network`, permission `system.manage` (§4.2) |
| L4 pre-name routes | §9 names every setup route; `no_box_ca` kept, `node.unnamed` dropped |
| L5 sealed state | §7.6: only with a recovery key, through the stream; the swap runs before the refresh |
| L6 question 2 A | Android caveat added to the question |
| L7 device details | Per-location uniqueness; the browser keys found listed (§7.4) |
| L8 more pinned test lines | `waitron-sh.test.mjs:625,1162` added (§9) |
| L9 pictures | 02 marks the "Keep" note and step 4's paragraph unchanged; 06 and 09 say "shows how to remove" |

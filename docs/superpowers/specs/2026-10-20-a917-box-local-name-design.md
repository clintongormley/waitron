# A917 — the owner chooses the box's `.local` name instead of `waitron.local`

Status: DESIGNED 2026-10-20 by an unattended campaign run, waiting for the owner's answers to three
questions (§11). Not built. Pictures: [mockups/a917-box-local-name/](../../backlog/mockups/a917-box-local-name/).

The owner's words (2026-10-20, through the watcher): "we should allow … specifying a new .local
domain name".

## 1. Words used here

- **The box** is the venue's Waitron server, the machine the tills talk to.
- **mDNS** (multicast DNS) is how a device on the venue's network finds `something.local` without a
  DNS server: the device shouts "who is `waitron.local`?" to the whole network, and whichever
  machine owns that name answers with its address. RFC 6762 defines it.
- **A certificate authority** (here: the box's own, minted on the box) is a key that vouches for
  website certificates. Each till and phone installs the box's authority once, on the trust page,
  so the browser accepts the box's HTTPS pages without a warning.
- **A name constraint** is a line written inside the authority's own certificate saying which names
  it may vouch for. Today's says `waitron.local` only, plus `localhost` and private addresses —
  so even someone who stole the box's authority key could not use it to impersonate, say, the
  venue's printer or a bank, on a device that honours the constraint.
- **The leaf certificate** is the box's own website certificate, the one the authority vouches
  for. It lists the names it is good for.
- **An origin** is what a browser keys everything to: `https://waitron.local` and
  `https://bar-lucia.local` are two different origins, with separate cookies, stored data, installed
  apps and passkeys.
- **A passkey** is a sign-in key a phone or computer keeps for one website name (the "relying party
  ID"). It works only at that name.

## 2. What is there now (every reader of the name)

Checked 2026-10-20 at `main` bf034bc29. "Read" means the line was opened and read; "ran" means a
command was run. Two read-only sweeps covered `apps/server` and everything outside it; the lines
marked ✓ were re-opened by the designer.

### 2.1 The single source, and its copies

- ✓ `apps/server/src/boot.ts:353` — `export const BOX_HOSTNAME = "waitron.local";`, and `:356`
  `BOX_LEAF_HOSTNAMES = [BOX_HOSTNAME, "localhost"]`. Passed to the plain-HTTP trust-page listener
  (`:678`), discovery (`:944`), the certificate mint (`:967`), the mDNS responder in setup (`:1239`),
  adoption-pending (`:1300`) and trading (`:2537`) modes, the leaf re-issue after a restore
  (`:1405`), and the Cloud mirror bundle (`:2267`). `node-entry.ts:120` passes it to the recovery
  entry point's discovery.
- ✓ Copies outside the process: `deploy/Dockerfile:265-266` bakes
  `WAITRON_MANAGEMENT_RP_ID=waitron.local` and `WAITRON_MANAGEMENT_ORIGIN=https://waitron.local`;
  ✓ `deploy/compose.yml:32-33` passes them from the box's `.env` with those values as defaults;
  ✓ `deploy/waitron.sh:21` `BOX_URL`, `:379` and `:390` print `http://waitron.local/setup/trust` and
  its QR code at install time. ✓ `scripts/deploy-image-env.test.ts:74-75` pins the copies to the
  `boot.ts` line, reading it as text.
- ✓ `apps/server/src/config.ts:482-493` — the passkey name (`WAITRON_MANAGEMENT_RP_ID`) and the
  dashboard origin (`WAITRON_MANAGEMENT_ORIGIN`) are required in production; `advertisedOrigin`
  (the address a newly paired device is handed, `boot.ts:1734` → `join-api.ts:164`, and the
  membership `contactUrl` tills route by) defaults to the management origin (`config.ts:549-551`,
  read by the sweep).

### 2.2 What advertises it

- ✓ `apps/server/src/mdns.ts:55` — no socket at all when `devMode` or the listener is
  loopback-only. ✓ `:64` answers only a question whose name **exactly** equals the one name, as
  `A` or `ANY`. ✓ `:45` TTL 120 s. ✓ `:85` stopping only closes the socket. It never probes before
  answering and never sends a "goodbye" (§4.2).

### 2.3 What certifies it

- ✓ `apps/server/src/self-signed-cert.ts:33` `PERMITTED_DNS = ["waitron.local", "localhost"]`, plus
  loopback and the three private address ranges; the constraint is marked critical. Measured below
  (§5.1) in three engines: the product's own authority refuses a `bar-lucia.local` leaf.
- ✓ `apps/server/src/box-secrets.ts:139-140` — the authority and leaf are minted only when
  `<state>/tls/server.key` is missing, at the first setup boot. Read by the sweep: the leaf is never
  re-issued on a name or address change; the only re-issue is after a restore
  (`rebuild-first-start.ts:112`); the authority and leaf both last 3650 days.
- ✓ `apps/server/src/state-secrets.ts:15-22` — the recovery bundle carries `secrets.env`,
  `trading.env` and the four TLS files, so a restored box keeps its authority and devices keep
  trusting it.
- `scripts/name-constraints-spike.sh` (read) is an OpenSSL-only proof that a `waitron.local`
  authority accepts a `waitron.local` leaf and refuses `example.com`. Commits `fb47efd68` and
  `75f17f9e3` (read) record that desktop Chrome 152 and macOS refused the outside name, and **that
  one Android phone's Chrome accepted it** under a user-installed authority: on Android the
  constraint protects nothing.

### 2.4 What tells a device where the box is

- The trust page (`apps/server/src/trust-page.ts:75-135`, ✓ read) lists the box's addresses and a
  "Continue to Waitron" link; its QR code is the first IP address, not the name
  (`box-reach.ts:14-16`, sweep). Discovery (`discovery-api.ts:91-99`, sweep) reports the name.
- The till is served by the box and ✓ uses `location.origin` (`apps/till/src/main.ts:31-34`). It
  keeps the venue's server list in `localStorage["waitron.servers"]`
  (`apps/till/src/api/server-router.ts:20,217-236`, sweep) and probes each one's `/api/node` every
  5 s. Its device cookie is host-only for a `.local` host (✓ `device-session.ts:30-40`). So **a
  renamed box is a new origin to every device**: new cookie jar, new stored data, new installed app.
- The dashboard shows `deviceAddress` as text and a QR code when pairing
  (`devices-screen.ts:807-810,2091`, sweep); no dashboard source file holds the literal, only tests.
- The print agent on the box dials `https://127.0.0.1` (`deploy/compose.yml:120`, sweep), not the
  name. An agent on another machine stores the server address it was given
  (`packages/print-agent/src/agent.ts:76`, sweep).
- Cloud: the pairing payload carries no name (`cloud-client.ts:261-275`, sweep). The mirror bundle
  reports `boxHostname` (`mirror-bundle.ts:54`), stored as `mirror_config.box_hostname`; only a
  test reads it back (✓ `tunnelHttpClient` in `tunnel-http.ts:26` has no non-test caller).

### 2.5 What tells a person

- ✓ The user guides (`apps/server/src/guide/en|es/`) do not name `waitron.local` at all
  (`grep -rln 'waitron\.local' apps/server/src/guide/` prints nothing).
- ✓ `apps/setup/src/i18n/strings/finish.ts:61` (English) and `:143` (Spanish): after a rebuild,
  "Tills … that were opened at https://waitron.local reconnect by themselves."
- The trust page, `waitron.sh`'s install printout (§2.1), `deploy/README.md:105-142,511-544`,
  `deploy/.env.example:4-35`, `apps/server/.env.example:51`, and
  `docs/developers/{workflow-guide.md:185-190, cloud-connection.md:85,192-204, design-system.md:76}`
  (sweep). Receipts print the fiscal QR code only, never the box's name.

### 2.6 Tests and fixtures that pin the literal

About 45 files in `apps/server/src` (the most: `landing-app.test.ts`, `mdns.test.ts`,
`self-signed-cert.test.ts`, `box-reach.test.ts`, `boot.restore.test.ts`), 17 test files in
`apps/dashboard/src` (pairing fixtures `deviceAddress: "https://waitron.local"`, passkey fixtures
`rpId: "waitron.local"`), 5 in `apps/setup/src`, `packages/db` (2, fixtures), `packages/diagnostics`
(1, a test origin), `scripts/waitron-sh.test.mjs`, `scripts/deploy-image-env.test.ts`. A fixture
keeps `waitron.local` wherever it means "the default name"; §10 lists which change.

## 3. The decision in one paragraph (recommended)

The box is **named once, on its very first page, before its certificate authority exists**, and
the authority is constrained to that one name (option C of §5). A box that is not named keeps
`waitron.local`. Renaming later is possible from the dashboard, and it **mints a new authority for
the new name** (option A of §5): every device installs a certificate again and taps "Finish moving",
keeping its identity, while the old name keeps working for that device until it has moved, for at
most 14 days. The name lives in a small file in the box's state folder, not in the database; no
migration.

## 4. The name

### 4.1 What is allowed

The person types only the first part; `.local` is fixed and shown beside the field.

- Letters `a`–`z`, digits `0`–`9` and hyphens; 1 to 63 characters (RFC 1035's label limit, §12);
  it starts and ends with a letter or digit (RFC 1123 lets a digit start it).
- Upper case is turned into lower case as it is typed, keeping the caret where it was (CLAUDE.md §3's
  selection rule). The box stores and compares lower case only.
- Anything else is refused beside the field — "Use only letters a–z, numbers and hyphens." — with
  one button offering the cleaned-up name. **"Café Lucía" offers `cafe-lucia`**: accents are taken
  off (Unicode decomposition, combining marks dropped), spaces, dots and underscores become hyphens,
  anything else is dropped, repeated hyphens collapse, and the ends are trimmed. The English-only
  rule for general code does not stop a venue typing its own name; the refusal is about what the
  network can carry, not language.
- Why no accented names, measured (§6, probe M5): a browser turns `https://café-lucía.local` into
  the Punycode host `xn--caf-luca-d1a8b.local`, while RFC 6762 §16 requires an mDNS name in UTF-8.
  A responder answering the UTF-8 name was not found by a lookup of the browser's form.
- Refused names: `localhost`, `local`, and any name with hyphens in its third and fourth places
  (the `xn--` family, which a browser would read as Punycode). `wpad` and `broadcasthost` are also
  refused as a precaution — both are names operating systems give special meaning; not measured.
- `waitron` is allowed: it is the default.

### 4.2 A name already in use on the network

Measured on this Mac (§6, probes M1–M4) with the same `multicast-dns` 7.2.5 library and the same
answer logic as `mdns.ts`:

- Two Waitron-style responders on one name **both answer, and neither notices**. A lookup returns
  both addresses (`dscacheutil` listed `192.0.2.1` and `192.0.2.2`), so a till could reach either.
- Apple's own responder, which follows RFC 6762, **probes first**: started second, it found the name
  taken and gave up ("Name in use, please choose another").
- Worse, a Waitron-style responder started on a name a conforming device already held made **that
  device give up its own name** — so today's box can knock a printer or another machine off its
  name.
- A one-off query before choosing a name (what RFC 6762 §8.1 calls probing) found the conforming
  device's answer, and found nothing when nobody held the name.
- After a responder stops, macOS kept answering from its cache (TTL 120 s). An mDNS "goodbye" — the
  same answer with time-to-live 0 (RFC 6762 §10.1) — removed the cached answer at once.

So the design:

- **Before a name is accepted** (setup or rename), the box probes it as RFC 6762 §8.1 says: three
  queries 250 ms apart. Any answer that is not the box's own refuses the name, beside the field:
  "Another device on this network already answers to bar-lucia.local (192.168.1.40). Choose another
  name." The refusal code is `box_name.in_use`; a bad name is `box_name.invalid` (codes name the
  concept, CLAUDE.md §3).
- **At every start** the responder probes before answering. If something else answers, the box
  answers anyway — a venue whose tills cannot reach the box cannot sell — and raises an alert,
  `box_name.clash` ("Another device answers to bar-lucia.local: rename it, or rename this box"),
  with an area claim and English and Spanish wording as CLAUDE.md §3 requires. While running, the
  responder also listens for another device's answer to its name (measured: the library hands these
  over, M1's log) and raises the same alert.
- The responder compares names ignoring case (RFC 6762 §16; today's `mdns.ts:64` compares exactly),
  answers every name it currently holds (§8), and sends a goodbye for a name it stops answering.
- Android's and Linux's (Avahi) resolvers with two answers were **not measured** — no Android device
  or Avahi network was available to this run. The probe-first rule makes the two-answer case an
  alerted fault rather than a normal state either way.

## 5. The certificate authority — the central question

### 5.1 What was measured

Six authorities were minted in a throwaway folder (`mktemp -d`); "today" was minted by the product's
own `mintSelfSignedServerCert` (bundled with esbuild from `apps/server/src/self-signed-cert.ts`), the
others with OpenSSL. Each signed four leaves. Three engines judged every pair (probe M6, §6):
OpenSSL 4.0.3 `verify`, macOS 26.6.2's own checker (`security verify-cert`, the authority passed
with `-r`, the keychain untouched — this is the engine behind Safari and iPhones' checks), and
Chromium 153.0.8010.12 (Playwright's Linux build, in Docker, trusting only that authority through
Chrome's `CACertificates` policy). All three engines agreed on every row:

| Authority's permitted names            | `waitron.local` | `bar-lucia.local` (`cafe-lucia` in the probe) | `hp-printer.local` | `example.com` |
| -------------------------------------- | --------------- | -------------------------------------------- | ------------------ | ------------- |
| today: `waitron.local`, `localhost`    | accepted        | **refused**                                  | refused            | refused       |
| B: `local` (every `.local` name)       | accepted        | accepted                                     | **accepted**       | refused       |
| B': `.local` (leading dot)             | accepted        | accepted                                     | **accepted**       | refused       |
| D: `waitron.local` + the chosen name   | accepted        | accepted                                     | refused            | refused       |
| A/C: the chosen name only              | refused         | accepted                                     | refused            | refused       |
| control: no name constraint            | accepted        | accepted                                     | accepted           | accepted      |

Controls: the unconstrained authority accepted everything (so a refusal above is the constraint, not
something else about the leaf), and Chromium with no trusted authority refused with
`ERR_CERT_AUTHORITY_INVALID`, a different error from the constraint's `ERR_CERT_INVALID`.

One more probe (M7): **re-signing the same authority key with a wider constraint does not help a
device that already trusts the old one.** With the old authority trusted and the wider one sent
alongside the leaf, OpenSSL refused ("permitted subtree violation") and Chromium refused
(`ERR_CERT_INVALID`); trusting the wider one instead was accepted. A device judges by the authority
it installed. So any change to the permitted names is a new certificate to install on every device.
(macOS's checker refused the old-authority case too, but its control was also refused — "not
trusted" — so that engine's row is inconclusive and is not relied on.)

### 5.2 The options, for Bar Lucía (3 tills, 2 phones)

**C — the name is chosen once, at setup, before the authority is minted (recommended, with A for a
later rename).** The first page the installer opens is the box's plain-HTTP page; today it shows
the certificate steps. It would first show "1. Name this box" (picture 01), and only once the name
is accepted does the box mint its authority for that name and show the certificate steps for it
(picture 02). Nothing has trusted the box yet, so naming costs nothing. Bar Lucía's installer types
`bar-lucia`, and from then on everything says `bar-lucia.local`. The authority's reach is as narrow
as today's: one name.

**A — a later rename mints a new authority for the new name.** A year later Bar Lucía renames the
box. The old authority stays in use, for the old name only, until every device has moved. Each of
the 5 devices: tap "Move this till" on the notice (picture 06), install the new certificate from
`http://bar-lucia.local` (the trust page's existing per-device steps: Android settings, an iPhone's
profile plus the "full trust" switch, or a computer's keychain — about three minutes; an estimate,
not timed), come back, tap "Finish moving" (picture 07). Staff see a notice on a still-working till
until it moves; nothing breaks during service. About 15 minutes for the venue, spread over up to 14
days.

**B — one authority constrained to all of `.local`.** Measured above: such an authority accepts a
leaf for any `.local` name — `hp-printer.local`, another venue's box — while still refusing
`example.com`. A rename needs no new certificate; each device still taps "Move" and "Finish moving",
because a new name is a new origin to the browser (§2.4), and passkeys must still be added again
(§7.3). **The cost:** anyone holding the box's authority key — which lives on the box and in its
recovery bundle — could make every staff computer and iPhone accept a fake printer or fake box
page without a warning. Today they could only fake `waitron.local`. On Android nothing changes:
the constraint is not enforced there anyway (commit `75f17f9e3`).

**D — the authority covers `waitron.local` and the chosen name.** At setup it adds nothing to C. At
a rename it is still a new authority (M7), so it saves nothing over A; and keeping `waitron.local`
answered forever defeats the point for a venue with two boxes, or a box beside the owner's own
`waitron.local` box. Rejected.

**Why C + A.** A rename is rare and B saves only the certificate step of it, while widening what a
stolen key can fake on every desktop and iPhone for the box's whole ten-year life. Naming at setup
makes the common case free.

## 6. Measurements (command, what failure would print, what it printed)

All probes ran 2026-10-20 on this Mac (macOS 26.6.2, Node v26.11.1) with processes this run started
and stopped by their recorded process ids; every key and certificate lived in a `mktemp -d` folder.
The probe scripts (no keys) are kept outside the repository in
`~/waitron-campaign/a917-mockups-src/probes/`; the temporary folders were deleted.

- **M1 two responders, one name.** `node responder.cjs 192.0.2.1 boxA a917-probe-bar-lucia.local`,
  then the same with `192.0.2.2 boxB`; `node query.cjs <name>`, `dns-sd -G v4 <name>`,
  `dscacheutil -q host -a name <name>`. Control first: the query with nobody answering printed
  `NONE`. Failure (one silently wins) would print one address. Printed both:
  `ip_address: 192.0.2.1`, `ip_address: 192.0.2.2`; each process logged "SAW another answer" and
  carried on answering.
- **M2 conforming device arrives second.** With boxA answering,
  `dns-sd -P "A917 probe" _http._tcp local 8080 a917-probe-bar-lucia.local 192.0.2.9`. Printed
  `Got a reply for record a917-probe-bar-lucia.local: Name in use, please choose another`.
- **M3 conforming device holds the name first.** `dns-sd -P … a917-probe-printer.local 192.0.2.9`;
  `query.cjs` then printed `192.0.2.9` (the probe finds it; with nobody, M1's control printed
  `NONE`). Starting a Waitron-style responder on the same name: Apple's registration printed
  `Name in use, please choose another`, and lookups returned only `192.0.2.3`, the newcomer's.
- **M4 goodbye.** With a responder stopped, `dns-sd -G v4` still printed its answer (TTL 120) about
  25 s later; after `goodbye.cjs` sent the same answer with TTL 0, `dns-sd` printed
  `Rmv … 192.0.2.5 … 0` within a second. Two names on one responder: `dscacheutil` returned the
  same address for both `a917-probe-waitron.local` and `a917-probe-cafe-lucia.local`.
- **M5 accented name.** `new URL("https://Café-Lucía.local/").hostname` printed
  `xn--caf-luca-d1a8b.local`. A responder answering `a917-café-lucía.local` (UTF-8): looking up the
  browser's form `xn--a917-caf-luca-ihb8d.local` timed out (`gtimeout` exit 124); the control,
  looking up the UTF-8 form, printed `ip_address: 192.0.2.6`.
- **M6 authorities × leaves × engines.** The table in §5.1. Commands:
  `openssl verify -CAfile <ca> -verify_hostname <name> <leaf>`;
  `security verify-cert -c <leaf> -r <ca> -p ssl -s <name> -L`; and in
  `mcr.microsoft.com/playwright:v1.63.0-noble`, `page.goto("https://<name>:<port>/")` against a
  Node HTTPS server on `127.0.0.1` serving that leaf, with `--host-resolver-rules=MAP * 127.0.0.1`.
  Failure for the central question (today's authority accepting `bar-lucia.local`) would print
  ACCEPT / `verification successful` / a 200; all three refused. The trust step itself failed twice
  first (a Linux certificate store, then the wrong policy folder) — the unconstrained control
  printed `ERR_CERT_AUTHORITY_INVALID` for everything, which is how that was caught.
- **M7 same key, wider constraint.** `openssl verify -CAfile today-ca.pem -untrusted rekey-ca.pem
  -verify_hostname cafe-lucia.local <leaf>` printed `permitted subtree violation`; with
  `-CAfile rekey-ca.pem` it printed `OK`. Chromium: `REFUSE net::ERR_CERT_INVALID`, control
  `ACCEPT 200`.

## 7. Devices already paired at the old name (a rename)

### 7.1 Both names for a while

The box answers both names during the move (M4 showed one responder answering two names). It keeps
the old authority and leaf for the old name and serves the new leaf for the new name, picking by
the name the browser asks for (Node's HTTPS server chooses a certificate per name through its
`SNICallback`; not yet built or measured here). A device at the old name keeps its cookie, its
stored data and its passkeys, and keeps trading.

### 7.2 How a till moves

A till at the old name shows a notice (picture 06). "Move this till" opens the move screen
(picture 07): open the new name's certificate steps, install, come back. The till checks by itself
whether it can now read `https://bar-lucia.local/api/node` — it can only once the new certificate
is trusted, and the box will allow that one read from its old name (`allowed-origins.ts`) — then
enables "Finish moving". That asks the box — over the old, still-trusted connection —
for a one-time move code valid 10 minutes, and opens `https://bar-lucia.local/move#<code>`. The
page there sends the code to the box over HTTPS (the part after `#` never leaves the browser on its
own), and the box hands that browser the **same device's** cookie. The till keeps its name, device
profile, printer and drawer. The code never travels over plain HTTP. The box marks the device moved.
An installed till app (home-screen app) belongs to the old origin and has to be added to the home
screen again; a kiosk-locked handheld has its start address changed by whoever manages it.

### 7.3 Passkeys

A passkey is tied to one name: the WebAuthn standard allows a relying party ID only when it "is a
registrable domain suffix of or is equal to the caller's origin's effective domain" (§12). So a
passkey made at `waitron.local` cannot sign in at `bar-lucia.local`. During the move the box
accepts each passkey at its own name. After the move, people sign in with their password, and the
dashboard offers to add a passkey for the new name; when the old name stops, passkeys for it are
deleted, since they can never work again. Till PIN sign-in is unaffected.

### 7.4 Everything else

- The box's own print agent dials `https://127.0.0.1` and is unaffected. An agent on another
  machine is a device like any other: it is told the new address and fetches the new authority from
  `http://bar-lucia.local/ca.crt`.
- Cloud stores the name only in `mirror_config.box_hostname`, which nothing outside a test reads
  (§2.4). The box reports its current name in the next mirror bundle; no Cloud change.
- The address new devices are handed (`advertisedOrigin`), the membership `contactUrl` and email
  links switch to the new name at the restart.

### 7.5 When the old name stops

When every device on the box's device list has moved, or 14 days after the rename, or when an admin
taps "Stop answering waitron.local now" (picture 05). Then the box sends a goodbye for the old name,
deletes the old authority and leaf, and drops the old-name passkeys. A device that never moved finds
nothing at the old name, and is re-added like any new device.

## 8. Where the name lives, who changes it, and restarts

- **Storage: `<state>/box-name.json`** beside `trading.env` (decided). The name is needed in setup
  mode, before any venue database exists, and it belongs to this machine (a standby has its own).
  It joins the recovery bundle's file list (`state-secrets.ts:15`), so a restored box keeps its
  name, its authority and its devices. During a move the file also holds the old name and the
  deadline. **No database migration.** The device list's "moved" mark is the one exception: it is a
  column or small table in the venue database (a `state` table), added by the rename slice.
- **The environment:** the image stops baking `WAITRON_MANAGEMENT_RP_ID` and
  `WAITRON_MANAGEMENT_ORIGIN`, and compose stops defaulting them; when they are unset, the box
  derives both from the stored name. An operator's explicit values in `.env` still win — that is
  the existing route for a box reached by a real domain (`docs/developers/cloud-connection.md`).
  `scripts/deploy-image-env.test.ts` changes with it.
- **Who may rename:** the Servers screen's "This server" row gets "Change network name…"
  (pictures 03–04). The route checks `mirror.create`, the permission the Servers screen and removing
  a server already use (`membership-removal-api.ts:46`). Decided, trade-off: a manager cannot rename
  (only an admin can), the same reach as removing a server — no new permission.
- **Restarts:** naming at setup restarts the setup server once (a few seconds), as finishing setup
  already does. A rename restarts the box once, when the owner confirms; the dialog says "Do it when
  the venue is closed". No hot reload.
- **A box that is never named** keeps `waitron.local`: the setup page's field is filled with
  `waitron`, and accepting it is one tap.
- **Setup mode always also answers `waitron.local`** until setup finishes, so the installer's
  printed link and QR code (`waitron.sh:379,390`) stay right.

## 9. What people read, and the dev rule

- **Guides**: they never name the box (§2.5), so nothing to change; a future guide that needs the
  address says "your box's address (shown on the Servers screen)".
- **The trust page** says "This box is called bar-lucia.local." and its links use the stored name
  (picture 02). The recovery page does not name the box. The setup done screen's rebuild sentence
  (`finish.ts:61,143`) takes the name as a placeholder in both languages.
- **`waitron.sh`** keeps printing `waitron.local` at install; its later links (`BOX_URL`) read the
  name from the box's state volume, falling back to `waitron.local`.
- **The dev and loopback rule** (CLAUDE.md §6, guard `apps/server/src/mdns.test.ts`): the gate at
  `mdns.ts:55` comes before any socket, whatever the name, and the new probe sits behind the same
  gate — a development or loopback-only server sends no mDNS at all, so it neither advertises nor
  probes the chosen name. `mdns.test.ts` gains a case with a chosen name in dev mode and on a
  loopback listener. In dev mode the setup page still shows the name step; the name is stored but
  nothing advertises it.

## 10. Build slices (review path FULL — auth, a cross-package contract and the certificate)

Each is one pull request, small enough for one implementer.

1. **The name and the responder.** `box-name.json` reader and writer, the name rule and the
   clean-up suggestion (pure, tested on the format's edge cases: 63 and 64 characters, leading
   digit, leading/trailing hyphen, `xn--`, `Café Lucía`, upper case), `BOX_HOSTNAME` becomes the
   stored name with `waitron.local` as default, case-insensitive answers, several names, probe at
   start, goodbye on stop, the `box_name.clash` alert. Recovery bundle file list. No visible change
   for an unnamed box.
2. **Naming at setup.** The plain-HTTP page's "Name this box" step (picture 01), the probe before
   accepting, minting the authority after naming, the setup restart, the trust page's line and the
   done-screen string; `waitron.sh`'s links.
3. **Environment and passkey name from the stored name.** Dockerfile, compose, `config.ts`, the
   deploy tests, `deploy/README.md`, `.env.example` files, `docs/developers/*`.
4. **Rename: the box side.** The rename route (`mirror.create`), second authority and leaf, choosing
   a leaf by name, both names answered, per-name passkey checking, the move code exchange, the end of
   the move.
5. **Rename: the screens.** Servers row action, the dialog and the progress card (pictures 03–05),
   the till's notice and move screen (pictures 06–07), English and Spanish strings, unsaved-changes
   test for the dialog.

## 11. Questions for the owner

Ready to paste in `~/waitron-campaign/a917-design/question.md`.

1. **The certificate authority** (picture 08): A, an authority for the chosen name only, new one at
   a rename (recommended); or B, one authority for every `.local` name, no new certificate at a
   rename but its key could fake any `.local` device on staff computers and iPhones.
2. **The old name during a rename** (picture 09): A, keeps working until each device moves, at most
   14 days (recommended); or B, shows only where the box went, so every till stops until it moves
   and is paired again (simpler to build).
3. **Where the name is set** (picture 10): A, at setup and later from the dashboard (recommended);
   or B, at setup only — a new name later means setting the box up again (drops slices 4 and 5).

Decided without asking, each with its trade-off stated above: the name rule and refusals (§4.1),
probe-first and the clash alert (§4.2), storage in the state folder (§8), `mirror.create` (§8),
one restart per rename (§8), the 14-day cap and move codes (§7), and setup also answering
`waitron.local` (§8).

## 12. Outside sources

Fetched with `curl` on 2026-10-20 and searched in the raw text.

| Claim | Source's words | URL |
| ----- | -------------- | --- |
| Probe a name before using it | "it MUST send a Multicast DNS query asking for those resource records, to see if any of them are already in use" (§8.1) | https://www.rfc-editor.org/rfc/rfc6762.txt |
| Probe timing | "250 ms after the first query, the host should send a second; then, 250 ms after that, a third" (§8.1) | same |
| Two answers for one name is a conflict | "Should a host witness another host announce an address record with the same name but a different IP address, then that is considered inconsistent, and that address record is considered to be in conflict." (§9) | same |
| Goodbye | "send an unsolicited Multicast DNS response packet, giving the same resource record name, rrtype, rrclass, and rdata, but an RR TTL of zero" (§10.1) | same |
| mDNS names are UTF-8, not Punycode | "all names in Multicast DNS MUST be encoded as precomposed UTF-8"; "MUST NOT use any other encodings apart from precomposed UTF-8" (§16) | same |
| Case does not matter | "in name comparisons, the lowercase letters "a" to "z" (0x61 to 0x7A) match their uppercase equivalents" (§16) | same |
| A DNS name constraint covers names below it | "Any DNS name that can be constructed by simply adding zero or more labels to the left-hand side of the name satisfies the name constraint." (§4.2.1.10) | https://www.rfc-editor.org/rfc/rfc5280.txt |
| Label shape | "They must start with a letter, end with a letter or digit, and have as interior characters only letters, digits, and hyphen. … Labels must be 63 characters or less." (§2.3.1) | https://www.rfc-editor.org/rfc/rfc1035.txt |
| A digit may start a host name | "the restriction on the first character is relaxed to allow either a letter or a digit" (§2.1) | https://www.rfc-editor.org/rfc/rfc1123.txt |
| A passkey is tied to its name | "as long as the caller-specified RP ID value is a registrable domain suffix of or is equal to the caller’s origin’s effective domain" | https://www.w3.org/TR/webauthn-3/ |

## 13. Found while reading, outside this design

- Today's responder never probes, so a box can take the name from a conforming device that already
  held it (M3) — two boxes in one network, or a box beside another device called `waitron`.
  Slice 1 fixes it.
- Today's responder answers only an exact-case question (`mdns.ts:64`); RFC 6762 §16 says case does
  not matter. Read, not run. Slice 1 fixes it.
- Today's responder sends no goodbye when it stops (`mdns.ts:85`), so a moved box's old address is
  served from caches for up to 120 s (M4). Slice 1 fixes it.

# Appliance onboarding — from an installed box to a trading venue, in a browser

**Date:** 2026-08-26
**Status:** captured brainstorm — a design, not an implementation-ready spec. Records decisions,
leans, and open questions. Several slices named here (AP-mode firmware, the appliance OS image, the
ACME broker) need their own spec/spike before they are built.
**Decides / scope:** how a non-technical operator takes a **freshly installed on-prem server** from
nothing to a configured, trading venue **entirely through a web browser** — first network contact,
discovery, HTTPS, secret generation, the admin login, and the first tenant/location — plus the
non-obvious pieces that flow makes necessary (serving the PWAs, backup/recovery, time, updates). It
is the deferred **deployment sub-project (#9)** onboarding half, and it realises §7 of the
[distribution & client-topology design](2026-08-15-distribution-and-client-topology-design.md).

**Conviction legend** (this is a captured brainstorm, so marked per item): **[decided-by-user]** a
decision the owner took in this brainstorm; **[decided-elsewhere]** already fixed by a landed spec;
**[lean]** a recommendation argued for but not ratified; **[open]** a genuine fork left for later.

---

## 1. What this is not (scope boundaries)

- **Cloud-trial onboarding** (a prospect points the PWA at a cloud instance, no hardware) is a
  *different* flow — backlog top-tier #5, its own direction in the distribution design §6A. Out of
  scope here; this spec is the **on-prem box**.
- **The remote tunnel implementation** (T1/T2 of the
  [management-dashboard design](2026-08-07-management-dashboard-design.md) §5) is already designed.
  This spec *consumes* it as the paid tier; it does not redesign it.
- **Acquiring** the AEAT/FNMT fiscal certificate is the owner's out-of-band bureaucratic process
  (tracked in `docs/compliance/`). Onboarding *requires uploading* the obtained certificate for a
  production venue (§10); it does not automate obtaining it.
- **The fiscal topology / failover policy** (owned by the
  [2026-08-01 SIF & failover design](2026-08-01-local-server-sif-and-failover-design.md)). Not
  revisited.

---

## 2. Current state — receipts

The facts this design builds on, cited so a later reader re-checks rather than trusts the prose
(gathered 2026-08-26; verify before relying on any that a later branch may have moved):

- **Provisioning already stands up everything the business needs, via one CLI** `waitron-provision`
  (`packages/provisioning/src/bin.ts:47`; dispatch `src/cli.ts:119-131`). Its commands are pure
  plan/apply functions, callable **programmatically**, not just from a terminal:
  - `keyring` — generates the vault master key: `randomBytes(32)` → base64, prints once and clears
    the screen, **persists nothing** (`src/keyring-command.ts:20-26,42-43`).
  - `instance` — bare cluster → migrated, stamped, granted database; creates the three cluster roles;
    generates role passwords, prints once, stores nowhere (`src/instance-plan.ts:98,102`).
  - `venue` — one transaction under `withTenant`: `ensure-tenant`, `seed-admin`, `create-location`,
    `create-till`, `create-node`, `register-sif`, `create-series` (`src/venue-apply.ts:42,70-166`).
  - `status` — read-only report of DB/roles/migrations/stamp (`src/cli.ts:293`).
- **The first admin is created only at `venue`'s `seed-admin`** — one `persons` row, `role='admin'`,
  with `pin_hash` **and** `password_hash`, guarded `where not exists (… role='admin')`
  (`src/venue-apply.ts:75-92`). There is **no first-run / claim / self-registration** flow; dashboard
  login is roster-pick + password (`apps/server/src/management-api.ts:430-491`).
- **Till login is roster-pick + PIN, not PIN-only.** `loginWithPin` requires a `personId`
  (`packages/identity/src/login.ts:21-28`); the PIN is verified only against that person. No
  uniqueness constraint on PINs (`packages/identity/src/schema/persons.ts:68` checks length only).
- **The server serves HTTP on `127.0.0.1:8080` by default** (`apps/server/src/boot.ts:513`;
  `config.ts:112-113`; `WAITRON_HTTP_HOST`/`WAITRON_HTTP_PORT`). **Optional HTTPS already exists**:
  `buildServeOptions` swaps in `node:https` from PEM files `WAITRON_TLS_CERT_FILE`/`_KEY_FILE`
  (`apps/server/src/tls.ts:39`; validated both-or-neither `config.ts:426-436`).
- **The box does not serve the frontends today.** The only static serving is product images at
  `/media/:filename` (`apps/server/src/media-api.ts`). `apps/dashboard` and `apps/till` are separate
  Vite apps that proxy `/api` in dev (ports 5190/5191, `apps/server/.env.example`). Production
  static-serving was deferred to #9.
- **A private-CA + server-cert minter already exists — in test code**: `apps/server/src/testing/tls.ts`
  mints a CA + leaf via `node-forge` for the mTLS tests.
- **The credentials vault is AES-256-GCM** (`packages/credentials/src/cipher.ts`), keyed from
  `WAITRON_CREDENTIALS_KEY` (base64, exactly 32 bytes; `src/keyring.ts:5-8`). Purposes include
  `fiscal.aeat` → `[pfxBase64, passphrase, certKind]` (`src/purposes.ts`).
- **No network, discovery, or naming layer exists anywhere** — no mDNS/Avahi, `.local`, captive
  portal, AP-mode, hostapd/dnsmasq, DHCP, or wifi handling in `apps/` or `packages/` (confirmed by
  exhaustive grep). Code only *assumes* a reverse proxy exists in front (for global rate-limiting:
  `apps/server/src/enrol-rate-limit.ts:20`).
- **Tenant/location carry no currency and no environment column.** `tenants` = `id, country, tax_id,
  legal_name`, unique `(country, tax_id)` (`packages/db/src/schema/tenants.ts:47`). Environment is
  **per-database** (a deployment stamp from `WAITRON_ENV`, `packages/db/src/schema/deployment.ts`),
  not per-tenant. Currency is implicitly the tenant's (single-currency-per-tenant, `numeric(12,2)`).
- **Device pairing crypto exists** (KDS station enrolment): a single-use code `randomBytes(5)` →
  Crockford base32, stored as SHA-256, redeemed for a scrypt-hashed long-lived device token
  (`apps/server/src/device.ts:44,64`; `device-session.ts`). The pattern tills can reuse.
- **The sync node token is operator-supplied, not generated** (`apps/server/src/config.ts:217-224`).
  Only matters when a second server joins.

---

## 3. The spine — a two-tier model, decided by whether the user pays for our cloud

**[decided-by-user]** The deciding constraint: *a user must reach a fully working system without
subscribing to anything.* A browser-**trusted** certificate for a real hostname fundamentally
requires a DNS zone we operate, which is a paid service. Everything else falls out of that.

| | **Free / self-hosted (LAN-only)** | **Paid / Waitron cloud** |
| --- | --- | --- |
| Origin (cert + passkey binding) | `waitron.local` | `<box-id>.waitron.<tld>` |
| Discovery | mDNS (Avahi) + IP-QR fallback | public DNS → LAN IP locally, relay remotely |
| Certificate | **self-signed**, box mints its own CA | **real** Let's Encrypt via ACME DNS-01 (auto, invisible) |
| Per-device trust step | **yes** — trust the box CA once per device | **no** — cert is already trusted |
| Remote access | none (LAN only) | the blind tunnel (dashboard design §5 T1/T2) |
| Cost | free | subscription |

**The honest cost of "free" is the per-device trust step.** A self-signed cert the user merely
*clicks through* does **not** unlock the PWA: browsers refuse service-worker registration, block
"Add to Home Screen," and restrict WebAuthn/passkeys on an origin whose certificate is untrusted
(**[verify]** §18 — this is the load-bearing external claim). To get the real installed-PWA
experience on the free tier, each device must **trust the box's CA once** — a guided step, roughest
on iOS (install a configuration profile, then enable it under Certificate Trust Settings). The paid
tier's product value is precisely that a real cert removes this step everywhere.

**The free→paid transition changes the origin** (`waitron.local` → `<box>.waitron.<tld>`), which
**invalidates passkeys** registered on the old origin (WebAuthn binds to the RP ID). Passwords and
PINs are unaffected (not origin-bound). For a single-owner deli this is a tolerable one-time
re-enrolment; the spec records it rather than hides it.

This **fills in the open detail** the dashboard design left at its T0 tier ("the box's own cert" at
a "canonical hostname," source of the name unspecified for a user without DNS): T0 free = self-signed
on `waitron.local`; the canonical hostname exists only once the paid DNS/cert is taken. Add a dated
pointer to that spec at land time (CLAUDE.md §6).

### A second, orthogonal fork: demo vs live

**[decided-by-user]** Onboarding opens with an explicit choice — **"set up a demo" or "set up a live
venue"** — and it is **orthogonal** to the free/paid tier above. Free/paid decides *cert trust +
remote access*; demo/live decides *fiscal posture*. Do not conflate them.

| | **Demo** | **Live** |
| --- | --- | --- |
| Environment stamp | `preproduction` | `production` |
| AEAT certificate | **optional** | **required** (ES-common, §10) |
| Submitting to AEAT | **off** — records chain locally, never filed | on — the outbox drains to the real AEAT |
| Un-filed records | expected/normal (no nagging) | an alarm if they pile up |
| Promotable to the other? | **no** — going live is a fresh provision, never an upgrade (CLAUDE.md §5) | — |

Reuses existing machinery, **no new column**: demo == the `preproduction` deployment stamp
(`WAITRON_ENV`, `packages/db/src/schema/deployment.ts`); the fiscal backend already carries a
`preproduction`/`production` `environment` (`packages/fiscal-verifactu/src/backend.ts:110-116,210`).
The fork just makes this a **visible operator choice** instead of an env var they'd never see.

**Why submitting is off in demo, and why that's safe by construction.** With no `fiscal.aeat`
credential the drain worker has nothing to submit with, so records accumulate as `pendiente` and are
never filed — the natural consequence, not a special mode (`packages/fiscal-verifactu/src/drain.ts`).
And the drain already **refuses** to submit a preproduction record to the real AEAT
(`fiscal.environment_mismatch`, `drain.ts:116`; "submitting a pre-production record to the real AEAT
is unrecoverable," `errors.ts:228`) — so a demo box **cannot** accidentally file real records even if
misconfigured. A demo that *wants* to exercise the AEAT round-trip can upload a **preproduction/test**
certificate and file against AEAT's homologation endpoint; it stays a demo.

**The orthogonality matters — one combo is worth stating plainly: live + free.** A real trading venue
can run entirely on the **free** tier (self-signed front-door cert, LAN-only, no subscription) and
still file to AEAT perfectly, because the **fiscal certificate (AEAT mTLS, outbound from the box) is a
completely different certificate from the front-door HTTPS cert.** The subscription buys remote access
and a trusted front-door cert; it buys **nothing fiscal**. A free-tier box is fully fiscally capable.
(Useful combinations: demo+free = the classic on-box evaluation; live+free = a cost-conscious real
deli; live+paid = a real venue with remote access; demo+paid is possible but unusual.)

**Relationship to the cloud trial** (distribution design §6A): that is the *same demo posture*
(preproduction, no real filing) reached by a *different vector* — a PWA pointed at a cloud instance,
no box. This spec's demo is the **on-prem box** version. Same fiscal fork; different hardware.

---

## 4. The end-to-end flow

```
UNBOXED ──▶ FIRST NETWORK CONTACT ──▶ CLAIM / SECURE ──▶ PROVISION ──▶ PAIR ──▶ (optional) GO REMOTE

FIRST NETWORK CONTACT — two paths:
  A) WIRED (MVP)       plug into the switch → DHCP → advertises waitron.local via mDNS
  B) WIFI (later)      no network → box raises a WPA2 hotspot "Waitron-Setup" (password on a
                       sticker/QR) → phone joins → captive portal → pick shop WiFi + password →
                       box joins it, drops the hotspot, now reachable as waitron.local

CLAIM / SECURE     browse https://waitron.local → box already self-generated its CA + leaf cert
                   and persisted its secrets → setup page guides trusting the cert on this device →
                   operator sets the admin login (name + dashboard password + till PIN)

PROVISION          choose DEMO or LIVE (the fiscal fork, §3) → wizard collects tenant + first
                   location (LIVE ES-common also requires the AEAT cert) → runs planInstance/
                   applyVenue server-side → box flips to serving the till PWA

PAIR               setup page shows a QR to waitron.local → each tablet opens it, trusts the cert,
                   Add to Home Screen, logs in → printers discovered or typed in

GO REMOTE (paid)   subscribe → box registers with Waitron cloud → gets <box>.waitron.<tld> + a real
                   cert (ACME DNS-01) + the blind tunnel → trusted everywhere, LAN and remote
```

---

## 5. Server "setup mode" and serving the PWAs

The core new server-side capability is a **first-run / setup mode**. On boot the server detects it is
**unprovisioned** (no usable `DATABASE_URL` and/or no deployment stamp / no venue) and, instead of
mounting the till/dashboard APIs, binds the LAN interface over HTTPS and serves the **setup web app**.
Its backend endpoints:

- **generate + persist** the secrets (§9), wrapping the existing `keyring` logic but *writing* the
  key rather than printing-and-clearing;
- **mint** the self-signed CA + `waitron.local` leaf (productise `apps/server/src/testing/tls.ts`),
  write the PEMs, point `WAITRON_TLS_CERT_FILE`/`_KEY_FILE` at them;
- **(WiFi slice)** list networks / accept credentials → hand to the OS network layer (§6);
- **drive provisioning** by calling `planInstance`/`applyInstance` then `planVenue`/`applyVenue`
  **in-process** (they are pure functions, not just CLIs — no shelling out);
- **flip** the server out of setup mode into serving the real PWAs.

**Implementation note (2026-08-26, slices 1a #137 + 1b #139 landed).** Setup-mode boot is built:
`startServer` branches on `config.till` presence (setup mode = no venue bound; `tenants` is FORCE-RLS
so a cross-tenant "any venue?" boot query is not cheap — detection is config-binding presence, with
the trading path DB-confirmed via `withTenant` and anti-duplicate-provisioning left to the `tenants`
UNIQUE constraint in slice 2). **Deployment constraint for slices 5–6 (appliance image / supervisor):
a setup box's `/health` returns 503** (it runs no fiscal duty loop, so it is correctly not
*trading*-healthy) — a liveness/readiness probe must gate a setup box on **`/setup-api/status`**
(HTTP 200), never `/health`, or a restart-on-503 probe would loop-kill an unprovisioned box and make
onboarding impossible.

**Prerequisite gap — serve the built frontends from the box.** Today the box serves neither
`apps/dashboard` nor `apps/till`. The appliance cannot exist without this, so **"serve the built PWAs
from the box"** is slice 1 (§16). Approach **[lean]**: build both Vite apps to static bundles and
serve them from Hono with a fallback-to-`index.html` SPA handler and correct caching, at path roots
(e.g. `/` = till, `/manage` = dashboard) — same origin, so the existing httpOnly-cookie auth is
unchanged.

**Ports.** **[decided-by-user]** the appliance defaults to **80 (HTTP→HTTPS redirect) and 443
(HTTPS)**, not 8080. Ports < 1024 need root or `CAP_NET_BIND_SERVICE` on Linux (**[verify]** §18);
the appliance runs under systemd so this is free. **Local dev stays on 8080/higher** so a developer
never needs root — i.e. the port defaults differ appliance vs dev, driven by config, not code.

**Dev story — the existing dev stack shortcuts onboarding, so building it needs a fresh-box mode.**
The current laptop stack (`pnpm dev:setup` + `pnpm dev`, the
[local-dev-run-stack design](2026-08-18-local-dev-run-stack-design.md)) deliberately **bypasses this
whole flow**: it provisions the venue directly, generates the credentials key, writes `.env`, and
serves plain HTTP on `localhost:8080` — no wizard, no cert, no mDNS (its non-goals list TLS and LAN
binding explicitly). That is correct for feature work, but it means the onboarding wizard is
un-exercisable locally today. So this spec needs a **dev onboarding mode**: a way to boot the server
**unprovisioned** (empty DB, no `.env` ids) so it enters setup mode and serves the wizard — e.g. a
`pnpm dev:onboard` that does `dev:reset`'s volume wipe but **stops before provisioning**, then starts
the server in setup mode. Self-signed HTTPS + `waitron.local` can be exercised on the laptop
(the box's own CA, trusted into the dev browser once); AP-mode/firmware (§6) cannot and is tested on
real hardware. This dev mode is part of slices 1–2 (§16), not an afterthought — you cannot build the
wizard without a way to run it.

---

## 6. First network contact

- **Wired + DHCP is the MVP and needs no config** — plug into the switch, get an IP, advertise
  `waitron.local`. This path needs **none** of the AP-mode firmware, so it ships first.
- **WiFi → AP-mode setup wizard (later slice, [lean])** — the smart-plug/IoT pattern: on first boot
  with no network, the box raises its own **WPA2-protected** hotspot `Waitron-Setup` (password on a
  sticker/QR — WPA2 so the setup traffic, which carries the WiFi password and the admin password, is
  encrypted at L2 even though the captive page itself is HTTP). A captive portal redirects the phone
  to the setup page; the operator picks the shop network and enters its password; the box saves it,
  drops the hotspot, joins the real WiFi. Requires `hostapd` + `dnsmasq` + a captive-portal responder
  + the OS glue to write WiFi credentials — the **firmware slice**.
- **USB-stick config (escape hatch, [open])** — a small file on a stick with SSID+password, read on
  first boot. Near-zero to build; good for a technical/bulk install, poor for a lone owner. Optional.
- **DHCP reservation guidance** — the box's IP must be stable (the `waitron.local`→IP mapping and
  bookmarks/passkeys depend on it). **[decided-by-user]** the setup page links a short Waitron docs
  page ("reserve an IP for your Waitron box") explaining what to look for across common routers,
  since every router UI differs. The box can also request a stable lease and surface its MAC to make
  the reservation easy.

**WiFi caveat (from the distribution design §7):** the box is the SIF every till depends on, so wired
is the stronger foundation; recommend wired-for-the-server where a cable is possible.

---

## 7. Discovery & naming

- **Free tier:** Avahi advertises `waitron.local`; the cert, passkeys, and app origin all bind to it.
- **iOS `.local` reliability is [open]** (flagged in the distribution design §7): Android/desktop
  resolve `.local` well; iOS is patchier (**[verify]** §18). Always-available fallback the setup page
  shows: **a QR encoding the box's current IP** (`https://192.168.x.y`). Brittle if DHCP moves the
  lease — hence the reservation guidance (§6). A native agent, if built later, sidesteps `.local` by
  discovering the box itself (distribution design §2).
- **Paid tier:** the origin becomes `<box-id>.waitron.<tld>`, resolving to the LAN IP locally (the
  Plex `*.plex.direct` pattern — **[verify]** §18) and to the relay remotely, so the same trusted
  cert works LAN and remote and passkeys stay portable (dashboard design §4c/§5).

**Implementation note (2026-08-27): slice 3 = in-process mDNS + CA-serving, no OS Avahi.** The box
advertises `waitron.local` from inside the server process (`multicast-dns`), in both setup and
trading modes, so it runs on any Node host with no appliance OS. The setup surface serves the box CA
for download (`GET /setup-api/ca.crt`), machine-readable discovery (`GET /setup-api/discovery`), and
a minimal server-rendered trust page with per-OS steps + an IP-QR fallback (`GET /setup/trust`).
**Deferred:** the polished trust UX → slice 2c (`apps/setup`); the automated "is this device trusting
the CA?" check → a browser-behaviour spike, because §17/§18's untrusted-CA-blocks-PWA claim is still
unverified and must not be built on. OS-level Avahi publication and trading-mode
HTTPS-from-the-box-cert remain later (appliance / separate) work.

---

## 8. HTTPS & certificates

- **Free / self-signed.** At first boot the box mints a private **CA** and a `waitron.local` **leaf**,
  writes PEMs, serves HTTPS via the existing `tls.ts`. The setup page hosts the **CA download +
  per-platform trust instructions** (Android, iOS profile, Windows, macOS) and a check that the
  current device trusts it before it lets the operator pair tills (the trust step is mandatory for a
  working PWA, §3). The box CA key is a persisted secret (§9). Leaf renewal is internal (long-lived
  or auto-renewed by the box; no external dependency).
- **Paid / real cert via ACME DNS-01.** The box holds the ACME account key and the cert private key;
  it proves control of `<box-id>.waitron.<tld>` by asking **Waitron's cloud broker** to place the
  `_acme-challenge` TXT record in *our* DNS zone. **The cloud never holds the cert key** → the relay
  stays blind (dashboard design §5 T2 already commits to exactly this DNS-01-brokered shape). Fully
  automated; the operator sees nothing. This is a **Waitron-cloud engineering cost** (a DNS zone + an
  ACME broker service), not a user step — correcting the initial worry that DNS-01 burdens the user.
- **Captive-portal page during AP-mode** is HTTP (captive portals universally are), made safe by the
  WPA2 hotspot (§6). The moment the box is on the real network it serves HTTPS on `waitron.local`.

---

## 9. Secrets — generate once, persist, custody

Onboarding **auto-generates and persists** what today is either printed-and-forgotten or
operator-supplied:

- **Vault master key** `WAITRON_CREDENTIALS_KEY` (32 bytes) — reuse `keyring-command`'s generation,
  but **write** it (today it clears the screen and stores nothing, `keyring-command.ts:42-43`).
- **Self-signed CA + leaf keys** (§8).
- **A session-signing key** if/when sessions move to signed tokens (dashboard/failover designs
  contemplate this; today sessions are DB-row UUIDs so no key is needed yet — generate lazily).
- **Postgres role passwords** — already generated by `instance`; onboarding captures them into the
  box's runtime config (`DATABASE_URL`, `WAITRON_MIGRATIONS_DATABASE_URL`) instead of printing them.
- **Sync node token** — generate at onboarding (rather than leave operator-supplied) so a future
  second-server pairing has one ready.

**Custody [lean].** The box has no secret manager and a non-technical owner, so store these in a
**root-only protected file** on the box, on a **full-disk-encrypted (FDE) OS/data volume**.

**Boot-unlock policy — default auto-unlock, optional passphrase.** **[decided-by-user]**

- **Default: no passphrase — the box auto-unlocks and reopens on its own.** A back-room appliance
  reboots unattended (power cuts, updates, crashes); a shop that cannot trade until a human unlocks
  it every morning is a real failure. So by default the FDE volume auto-unlocks (a TPM-sealed key
  where the hardware has one, else an on-box keyfile) and the box trades again with zero interaction.
- **Optional: an operator passphrase, opt-in at setup.** For a security-conscious operator. What it
  buys, precisely: **auto-unlock FDE only protects against the disk being pulled out; it does NOT
  protect against theft of the whole powered-off box** (an attacker just boots it and it unlocks
  itself). A passphrase — no auto-unlock — is the **only** thing that protects against whole-box
  theft. Its cost, surfaced loudly at setup: **after any reboot the box comes up "locked" and cannot
  trade** until someone enters the passphrase. To keep that graceful on a headless box, it boots into
  a minimal **web unlock page** on `waitron.local` (the LUKS-remote-unlock / Home-Assistant pattern),
  unlocked from a phone — no physical console.
- **The forgotten-passphrase lockout is covered by the §12 recovery bundle** — a forgotten passphrase
  means "restore from your recovery bundle," not "brick." Offering the passphrase is safe *because*
  that escape hatch exists; the two decisions are linked.

The wizard states the trade-off plainly ("extra protection if your box could be stolen; the cost is
you must unlock it after every restart — skip this to have the box reopen on its own"). The
**mechanism** (encrypt the whole data volume, so the fiscal records and personal data are protected
too — not only the secrets file) is an OS-image detail deferred to the §15 spike. A hardware secure
element (TPM) for the default auto-unlock is a **[open]** hardening, not assumed (a mini-PC may lack
one; without a TPM the auto-unlock keyfile lives on the box, so the default protects only against a
pulled disk — which is exactly why the passphrase option exists).

**Why this matters beyond convenience → §12 (backup).** Losing this key makes every vaulted
credential — including the AEAT certificate — unrecoverable.

---

## 10. Admin, tenant, location — mostly existing logic, driven from the wizard

The wizard collects and calls the existing plan/apply:

- **Admin login** — name + dashboard **password** + till **PIN**. Seeded exactly as
  `venue`'s `seed-admin` does today (`venue-apply.ts:75-92`). **No PIN uniqueness needed** — till
  login is roster-pick + PIN (§2), so the first admin's PIN is just their own. (The Square
  "type-PIN-only" model, which *would* require tenant-unique PINs, is an identity/till-UX decision,
  **out of scope** here.)
- **Tenant** — `country`, `tax_id` (NIF), `legal_name`. No currency field (single-currency-per-tenant,
  implicit).
- **Location** — name, `fiscal_territory` (only `ES-common` implemented), `invoice_locales`,
  operation description, address, `time_zone` (default `Europe/Madrid`), `day_cutover`.
- **Environment** — per-database, stamped from `WAITRON_ENV`; the **demo/live fork (§3)** chooses it
  (demo = `preproduction`, live = `production`). The wizard makes it explicit and loud (a
  demo/preproduction DB can **never** become a live/production one — fiscal invariant, CLAUDE.md §5).

**[decided-by-user] The AEAT fiscal certificate is required for a LIVE venue in the Veri\*Factu
region, and optional for a DEMO** (the fork, §3). When the wizard provisions a **live**
(`production`) venue whose location is `fiscal_territory = ES-common`, it **requires uploading** the
obtained AEAT certificate (PFX + passphrase) into the `fiscal.aeat` vault purpose
(`packages/credentials`, purpose already exists) before the venue can trade. A **demo**
(`preproduction`) venue makes it optional — absent → records chain locally but never file (§3); a
preproduction test cert may be uploaded to exercise AEAT's homologation endpoint. Onboarding cannot
*acquire* the certificate (the owner's FNMT/AEAT process, `docs/compliance/`) — it enforces that a
*live* venue does not go live without one. Foral territories (País Vasco/Navarra → TicketBAI) are not
implemented and out of scope.

---

## 11. Pairing tills and devices

- **Tills (PWAs)** — the setup/status page shows a QR to the origin (`waitron.local` or the paid
  name); the tablet opens it, trusts the cert (free tier), "Add to Home Screen," logs in with
  roster + PIN. No per-till secret beyond the session cookie.
- **Kitchen/expo devices** — reuse the **existing device-pairing crypto** (`device.ts` pairing code →
  scrypt-hashed device token) already built for KDS station enrolment.
- **Printers** — discovered on the network or typed in by IP; Waitron does **not** onboard a printer
  onto WiFi (a screenless device; use the vendor's app / wired Ethernet — distribution design §7).
  Wired printers recommended.
- **A second server (failover)** — enrol via the sync node token (§9); a **later slice**, but the
  flow leaves the door open (don't design it here).

---

## 12. Backup, recovery, and break-glass — the biggest single-box risk

A single box holds two **unrecoverable** things: the **vault master key** (without it the AEAT cert
and every vaulted secret are lost) and the **hash-chained `registros`** (the fiscal record; losing
the DB loses the chain — CLAUDE.md §5). So onboarding must establish a backup posture as a
**first-class step**, not an afterthought:

- **Free tier [lean]** — a guided "download your recovery bundle" at claim time (the vault key +
  box config, itself encrypted under an operator-held recovery phrase or file), plus a scheduled
  local DB backup (to attached storage / a network share) with a visible "last backup" status and a
  reminder if it goes stale.
- **Paid tier** — automatic off-box backup is a natural part of the cloud subscription (and the
  cloud read-mirror leg, dashboard design §5 T3, already carries much of the data upward).
- **Break-glass admin recovery [open].** The first-admin spec has **no** password reset, so a lost
  admin password locks the owner out of a box with no cloud account. An appliance needs a **physical
  break-glass** (router-style reset semantics: local console / a held button / a boot-time recovery
  mode) that lets someone with physical possession reset the admin credential — while **warning
  loudly** that a full factory reset is chain-destructive (a re-provision starts a new chain and mints
  a fresh installation number — fiscal §5). Design the credential-reset break-glass; do not make
  factory-reset casual.

---

## 13. Time / NTP

Fiscal records are timestamped; a box with a wrong clock stamps wrong `fecha`s onto immutable
records. The appliance must keep accurate time (NTP by default) and onboarding includes a **time
health check** (correct, synced, sane timezone). A box that cannot sync time and has drifted should
surface a warning before it trades. Cheap, and a silent clock error is a fiscal-correctness bug.

---

## 14. Updates

**[decided-by-user]** Onboarding/status captures an **update policy**: opt into **automatic updates
at a preferred day + time window** (e.g. "Tuesdays 04:00", outside trading hours), with **advance
notification of an upcoming update**; manual-only is also allowed. The **update machinery itself**
(image OTA, staged rollout, telemetry) is the separate fleet-ops track named in the dashboard design
(§5 T3) — not built here — but onboarding records the *preference* so the machinery has it when it
lands. An update must never interrupt a sale (respect the window; defer if trading).

---

## 15. The OS / appliance layer (the out-of-repo part) — a spike

The riskiest, least-known piece; scope it as a **spike with a recommendation**, since the in-repo
slices (1–4, §16) do not depend on the final image choice — they run on any box with Node + Postgres.
The reference shape is **Home Assistant OS**: a minimal Linux base, a supervisor, the app + Postgres
+ a network/setup service as managed units the operator never sees.

Options:

- **(a) Stock Debian + our packages + a systemd setup service [lean for the first real box].** Fastest
  path to a working appliance; heavier image; well-trodden. `apps/server` already assumes a supervisor
  ("systemd or Docker restart policy," server-host design §8), so this is a small step.
- **(b) Purpose-built buildroot / HAOS-style image.** Cleanest appliance, smallest attack surface,
  most work. A later refinement once (a) proves the flow.
- **(c) Docker Compose on a stock distro.** Good for **technical/cloud** installs (Postgres + server +
  sync worker + driver service in one file), not a consumer appliance — assumes someone installs an
  OS + Docker.
- **(d) VM / OVA image (the "techie" path).** The same appliance image runnable as a **virtual
  machine** under **Proxmox / ESXi / etc.** — for a homelab owner who runs Waitron as a VM beside
  other things rather than dedicating a box. Essentially free if (a)/(b) also emit a VM image;
  explicitly **not** the consumer default. (Proxmox is a bare-metal hypervisor with a web console; the
  Home-Assistant community commonly runs HA-OS as a VM under it.)

Recommendation: **(a)** for the first shippable box; **(d)** as a cheap parallel artifact for
technical users; **(b)** later. AP-mode firmware (§6) is its own slice on top of whichever base.

---

## 16. Build order (slices)

Ordered so each slice is useful on its own and the in-repo work (buildable now, no firmware) comes
first:

1. **Serve the built PWAs from the box + setup-mode boot.** In-repo. Nothing works without it. (§5)
2. **Self-signed CA/leaf minting + persisted secrets + the setup wizard** driving
   `planInstance`/`planVenue` in-process, incl. the required AEAT-cert step for production. (§5, §8,
   §9, §10)
3. **Per-device trust UX + `waitron.local` mDNS (Avahi) + IP-QR fallback.** (§7, §8)
4. **Backup/recovery + status page + break-glass credential reset + time health.** (§12, §13)
5. **AP-mode WiFi onboarding** (hostapd + dnsmasq + captive portal + WiFi-write glue). Firmware
   slice / spike. (§6)
6. **The appliance OS image** — spike → build (option (a), plus the VM image). (§15)
7. **Paid tier: ACME DNS-01 broker + canonical hostname + tunnel wiring** (consumes the
   already-designed relay). (§3, §8)

**Implementation note (2026-08-26): slice 2 is built as 2a → 2b → 2c.** 2a = secret
generation/persistence + self-signed CA/leaf minting, server-side, no UI (slice 2a): first setup
boot mints a CA + `waitron.local`/IP leaf into a persisted state dir (`WAITRON_STATE_DIR`) and serves
the setup surface over HTTPS from it, and generates+persists the vault master key + sync node token —
idempotent across restarts; operator-supplied `WAITRON_TLS_*` overrides the served cert (the box still
mints and persists its own secrets regardless). 2b = the
`/setup-api` provisioning endpoints (`planInstance`/`planVenue` in-process, demo/live fork,
AEAT-cert-required-for-live, persist the till ids/DB URLs, then restart into trading — decided:
persist-config-then-restart, not hot-flip). 2c = a new `apps/setup` Vite+Lit wizard consuming 2b,
served in setup mode.

**Implementation note (2026-08-27): slice 2c built — the `apps/setup` Vite+Lit setup wizard.** Six
in-memory screens (mode → admin → venue → cert → review → provisioning/done); the `cert` step is
reached only for a **live + `ES-common`** provision. The wizard consumes 2b's `/setup-api` endpoints
(`GET /setup-api/status`, `POST /setup-api/provision`) and is served in setup mode via a new
`WAITRON_SETUP_APP_DIR` — `mountSetup` serves the built bundle at the origin root when the dir is set,
falling back to the inline placeholder otherwise (mirrors `tillAppDir`/`dashboardAppDir` + `mountSpa`;
the trading boot path is untouched). **Rulings:** the polished per-device trust UX + pairing QR are
**slice 3**, not 2c (the wizard carries only a one-line "the browser security warning is expected —
this box uses its own certificate" reassurance); the chrome is **English-only** for the MVP (es-ES
localisation deferred). The provision body is assembled client-side and posted whole; the AEAT PFX
rides the body **only for a live provision, never a demo** (gated on `mode === "live"`), so a
certificate can never be sealed onto a preproduction tenant.

Slices 1–4 give a **wired, LAN-only, self-hosted box that trades** — the free tier, minus the
appliance image (runs on any Node+Postgres host). 5–6 make it a true appliance. 7 is the paid tier.

---

## 17. Open questions

- **[verify, load-bearing] Untrusted-cert PWA behaviour** (§3, §18) — confirm that service-worker
  registration, install, and passkeys are actually blocked on a self-signed origin *until the CA is
  trusted*, across Chrome/Android, desktop, and iOS Safari. The whole free-tier trust step rests on
  this. Test in a container/real device, both directions (trusted vs not).
- **iOS `.local` reliability** (§7) — measure; decide whether the IP-QR fallback is primary on iOS.
- **Break-glass mechanism** (§12) — console vs held-button vs recovery-boot; how to reset the admin
  credential without enabling casual chain-destructive resets.
  - **Resolved 2026-08-30 (slice 4c):** the admin-credential break-glass ships as an **on-box loopback
    CLI**, `waitron-break-glass` (the "local console" option; held-button / recovery-boot are
    firmware-dependent and parked with slices 5–7). Physical shell access to the box + its
    `DATABASE_URL` is the gate; it resets the admin's dashboard password (and PIN) and reactivates a
    suspended admin, `withTenant` under the app role's RLS, **with no chain impact** — so it never
    enables a casual chain-destructive reset. The chain-destructive **factory reset** stays
    **design-only** (it re-provisions a fresh SIF / new chain, fiscal §5): see
    `docs/superpowers/plans/2026-08-30-onboarding-slice4c-factory-reset-design.md`.
- **Secret custody hardening / passphrase mechanism** (§9) — TPM-sealed vs keyfile auto-unlock for
  the default; and for the optional passphrase, encrypt-the-whole-data-volume (LUKS + web-unlock) vs
  wrap-only-the-secrets-file. What the first real box ships with, and the web-unlock-page UX.
- **OS base** (§15) — ratify (a); confirm the VM image is worth emitting in the same slice.
- **AP-mode captive-portal UX** (§6) — the exact iOS/Android captive-portal auto-open behaviour to
  target (varies by OS).
- **Second-server pairing UX** (§11) — deferred; note where it slots in.
- **Explicit "filing off" for demo vs the no-cert consequence** (§3) — decide whether a demo needs a
  first-class "submission disabled" config so the dashboard/health treat un-filed records as normal,
  or whether "no `fiscal.aeat` credential" is a clear-enough signal on its own. Bears on the demo UX
  (no nagging about a growing `pendiente` backlog) and on whether a demo-with-test-cert filing to the
  homologation endpoint is a first-class option or a power-user path.

---

## 18. Provenance — external claims to verify (receipts)

External claims this design leans on. Per CLAUDE.md §1, claims about the outside world get the same
scrutiny as code and are **flagged to verify**, not stated as settled:

| Claim | Status | How to settle |
| --- | --- | --- |
| An untrusted (self-signed) HTTPS origin blocks service-worker registration, PWA install, and restricts WebAuthn until the cert is trusted | **[verify] — load-bearing** | Real browser test (Chrome/Android, desktop, iOS Safari), trusted vs untrusted CA |
| `getUserMedia` (camera, for QR scan) needs a secure context — HTTP on a non-localhost origin is blocked | [verify] (widely documented) | Same harness |
| Ports < 1024 need root / `CAP_NET_BIND_SERVICE` on Linux | [verify] (widely documented) | `setcap` / systemd test on the target base |
| Publicly-trusted certs are unobtainable for `.local` names and bare IPs | [verify] (CA/Browser Forum baseline) | Cite the BR; not attempt to obtain one |
| Let's Encrypt DNS-01 lets a third party (our broker) answer the challenge while the box keeps the key | [verify] (ACME RFC 8555) | Cite RFC 8555 §8.4 |
| The `*.plex.direct`-style pattern (public DNS record resolving to a private LAN IP, wildcard cert) works in current browsers | [verify] | Confirm Plex/HA still do this; test resolution + cert |
| iOS resolves `.local`/mDNS less reliably than Android/desktop | [verify] | Measure on a real iPad |
| Proxmox is a bare-metal hypervisor the HA community runs HA-OS under as a VM | context only, non-load-bearing | — |

---

## 19. Relationship to existing specs

- **Realises** the distribution & client-topology design §6–§7 (appliance, network onboarding,
  Postgres-everywhere) as an implementation-ready decomposition, and the deferred deployment
  sub-project (#9) onboarding half.
- **Consumes** the management-dashboard design §5 (T0 LAN cert-on-box; T1/T2 blind tunnel + ACME
  DNS-01) as the paid tier; **fills in** its T0 free-tier detail (self-signed on `waitron.local`; the
  canonical hostname is a paid-tier artifact) and records the passkey origin-transition cost (§3).
  Add a dated pointer there at land time.
- **Extends** provisioning (`packages/provisioning`) by calling its pure plan/apply from a web wizard
  rather than only a terminal, and by **persisting** the `keyring` output instead of printing it.
- **Adds a required onboarding step** — AEAT cert upload for production ES-common venues (§10) —
  wiring the existing `fiscal.aeat` vault purpose into the flow.
- **Surfaces new build gaps** not previously scoped: serving the built PWAs from the box (§5),
  backup/recovery + break-glass (§12), the appliance OS image + VM variant (§15).

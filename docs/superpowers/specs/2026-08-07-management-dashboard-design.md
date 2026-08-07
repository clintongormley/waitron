# Management dashboard — architecture + first slice — Design

**Date:** 2026-08-07
**Status:** Design approved; first slice not started.
**Scope of this document:** the owner/manager dashboard as a whole — the architectural frame, the
auth model, and the remote-access roadmap — plus one concrete, buildable **first slice** (staff
administration). Everything past the first slice and transport phase T0 is *decided and recorded* so
it is not relitigated, but is explicitly **not** first-slice work.

---

## 1. Problem and context

The management dashboard is the **named future consumer** of a run of deliberately headless work.
Catalogue (`2026-08-05-catalogue-model-design.md` D12: *"No management UI, CLI, or HTTP this slice…
→ dashboard"*), identity (a full headless staff-admin API — `createPerson` / `setRole` / `resetPin`
/ `suspendPerson` — shipped in #58), and reporting (`computeDailyClose`, #56, *"a till/UI consumes
it later"*) all built their domain logic on the explicit promise of a later management surface. That
surface has no other home: staff administration, catalogue authoring, and location editing will
never live on the till. This document designs it.

**The requirement (owner decision, this session).** The owner needs to reach the dashboard from
**off-premises**. Broken down by what they actually do remotely:

- **A — read** (the common case): "how did today/this week go" — sales, VAT, the daily close,
  labour hours.
- **B — light management** (occasional): edit the menu/prices, add or suspend staff, adjust next
  week's roster.
- **C — fiscal actions** (rare but real): approve a void / refund / rectificativa that only the
  owner is authorised for.

### 1a. Why Waitron's situation differs from Square and SumUp

Both incumbents are **cloud-first with no on-premises server as the system of record**, so "management
in the cloud" is free for them — the dashboard simply reads and writes the same cloud database the
POS syncs to.

- **Square** — the cloud is the system of record; the device is a client with a **time-limited**
  offline fallback: **24 hours** to accept offline payments, upload within **72 hours**, and offline
  mode is explicitly a fallback ("the cloud is primary and the device is secondary"). Offline
  payments are queued **on the individual device** (or browser storage) — *per-device and islanded*,
  not a shared local server; two offline tills do not share state.
- **SumUp** — same shape: a Cloud API triggers card-present transactions on Solo readers "from any
  backend… that can make HTTPS calls," management lives in the cloud dashboard, offline mode added
  recently to match.

**Waitron is deliberately the inverse.** The system of record and the SIF live on the **local
server**; the cloud is a mirror. This is forced by two things the incumbents do not carry: the
Spanish fiscal regime (the certificate and the hash-chain are local) and the **"nothing may block a
sale"** invariant — *indefinite* offline trading, not a 24–72h ceiling. During a multi-day internet
outage Waitron keeps trading and filing (the chain appends locally; AEAT submission is an outbox that
drains later), cash is unconditional, and every till in the venue shares one consistent state — where
Square stops *recording* at 24–72h and each device is islanded. Card authorisation remains bounded by
the acquirer/terminal's own offline policy (Waitron does not magic that away).

**Consequence for this design:** because the cloud is *not* the source of truth, a cloud dashboard is
a mirror consumer, and management writes must flow back down to the local server. That is what makes
the remote-access question real for us and absent for them.

---

## 2. The frame (architecture)

**The dashboard is a local-server app, and remote access is a transport layer beneath it that the app
never sees.** This single decision lets us build the dashboard now without resolving the tunnel/cloud
story first, and it keeps every later transport phase from forcing a change to the app or the fiscal
core.

- **New app `apps/dashboard`** — a browser app on the same stack as the till (Lit + Vite), reusing
  **`@waitron/ui`** (the `wt-*` primitives + tokens).
- **It is a client of the local server** (`apps/server`), exactly as `apps/till` is. The local server
  stays the sole system of record. The dashboard reads and writes through a **management API** on
  `apps/server` that wraps the **already-built headless package APIs** (`@waitron/identity`,
  `@waitron/reporting`, `@waitron/catalogue`, …) under `withTenant` + `authorize()`.
- **No new domain packages.** The dashboard is a surface, not a new source of truth — the payoff of
  all the headless-first work.
- **Separate app from the till, deliberately.** Different audience (owner/manager vs counter
  operator), device (laptop/desktop vs touch POS), session shape (browser login vs PIN-on-glass), and
  layout paradigm (data tables + forms vs a touch product-grid). They share `@waitron/ui` and the same
  local server + identity, but they are two apps.
- **Served by the local server.** In production the local server serves the built `apps/dashboard`
  bundle (the same pattern deployment sub-project #9 owns for `apps/till`); in dev, Vite.
- **Auth authority = `@waitron/identity` (local), never the cloud.** See §4.

**Data flow.** Browser (dashboard) → HTTP → local-server management API → session check +
`authorize()` → headless fn under `withTenant` → local Postgres (SoR) → response. Identical shape to
the till API.

**Transport-decoupling (load-bearing).** The dashboard is identical whether the request arrived over
the venue LAN, a tunnel, or a later cloud read-mirror. Remote reach lives *below* the app (§5).

---

## 3. First slice — staff administration

**Slice 1 is staff administration, and only that.** It is the cleanest possible vertical:
`@waitron/identity`'s staff-admin API is already built, tested, headless, `person.manage`-gated, and
has no UI home except this dashboard. It exercises the whole frame end-to-end — app → management API →
auth → a real read *and* write surface — while depending on nothing in flux.

**Actions** (each mapped 1:1 onto the existing identity API, gated by `authorize(person.manage)`):
list staff, add a person (name + role), change a role, reset a PIN, suspend / reactivate.

- One small read, **`listPersons`, may need adding** to `@waitron/identity` — it ships write verbs
  but not a list yet.
- **Reactivation** may need an inverse of `suspendPerson` (a set-status-active). Note the identity
  follow-up edge: a tenant's *sole* seeded admin, once suspended, cannot be reactivated through the
  app (no active session can `person.manage`) — that recovery path stays a privileged DB action and
  is out of slice-1 scope.

**Deferred from slice 1 (with reasons):**

- **Reporting-read → slice 2.** The obvious next surface, but **cierre Z (#8) is actively reshaping
  the reporting domain**, and reporting carries the catalogue-desglose divergence follow-up. Building
  its UI now would churn as #8 lands. Sequence it *after* #8 settles.
- **Catalogue management → later.** #18 (menu & allergens) is in flight and adds catalogue schema.
- **Remote transport → §5** (phases T1+).

---

## 4. Auth model

### 4a. The axis that matters here is *offline*, not *modern vs old*

The dashboard authenticates against `@waitron/identity` on the **local server**, which is the
authority and **must work when the internet is down**. So the real question for any method is: **can
the local box verify this credential with no internet?**

| Method | Locally verifiable (works offline)? |
| --- | --- |
| **Passkey (WebAuthn)** | **Yes** — the box stores the public key and verifies the signed challenge itself; no IdP round-trip |
| **Password + TOTP** | **Yes** — the hash and the TOTP secret both live on the box |
| **Login with Google / Microsoft (OIDC)** | **No** — needs the IdP reachable at login time |
| **Magic link (check-email)** | **No** — needs to send email |

**The principle:** every admin must always hold **at least one offline-capable credential** (a
passkey, or password+TOTP). Federated and email logins are **convenience layers on top, available
only when online** — never the sole method for an admin, or an internet outage locks the owner out of
their own POS during exactly the crisis they need it.

### 4b. Slice-1 auth floor

- **Passkey (primary) + password+TOTP (fallback)** — both offline-verifiable — built behind a
  **credential/verifier abstraction** in `@waitron/identity` (each method is a verifier), so the
  deferred methods plug in later without reworking the core.
- **Passkeys are already two-factor** (possession of the authenticator + a biometric/PIN unlock), so
  **TOTP is not stacked on top of a passkey**. TOTP is the second factor for *password* login only.
- **Passkeys without biometric hardware are a non-issue.** A fingerprint reader is one convenient
  unlock among several: a **device PIN** (Windows Hello PIN / device passcode), a **security key**
  (USB/NFC), the **phone via QR/cross-device** (scan a code on the desktop, the phone authorises,
  Bluetooth proximity-checked), or a **syncing password manager** (1Password / iCloud Keychain /
  Google / Microsoft).

### 4c. The passkey ↔ origin constraint (feeds the transport design)

WebAuthn binds a passkey to the **origin / RP ID (the domain)**. A passkey registered for
`pos.<venue>.<tld>` will not match a raw-LAN-IP origin. Therefore the dashboard must be reached at
**one canonical hostname, LAN and remote** — resolved to the local IP on-premises (split-horizon DNS
/ mDNS) and to the relay when remote, with the same cert on the box — so passkeys stay portable across
LAN and remote access. This is why the transport design (§5) keeps the TLS certificate on the box.

### 4d. Management session

Reuse the till's cookie-session **plumbing** pattern (`till-session.ts`'s cookie + `isUuid` guard),
but with management-appropriate policy:

- an **idle timeout**;
- it **re-reads `persons.status` on each request** — directly closing the identity follow-up where
  `authorize()` does not re-check mid-session status. The dashboard is exactly the sensitive surface
  where a suspended manager must lose access immediately.

### 4e. Configurable auth policy (seam now, build later)

A **per-tenant auth policy** — which methods are *permitted*, and which are *required per role* —
generalises "passwords for ordinary users, something stronger for admins." Designed as a seam in
identity/config; **the policy-config UI and the population of federated methods are deferred.** Note
the population: dashboard users are almost all managers/admins (operators use the till PIN), so the
policy surface is real but small — do not over-tier it.

### 4f. Deferred auth methods (later "auth methods" slice)

- **Login with Google** (SMB Gmail/Workspace — first), **Microsoft** (Entra/365 — second), **Apple**
  optional. **Skip Facebook** (consumer, wrong context). All online-only convenience.
- **Magic link** — online-only convenience and a decent account-recovery path; not a floor.
- **Spain-specific aside (not planned):** the owner already holds an FNMT certificate / Cl@ve for
  AEAT, but those are government-portal identity, not a sensible SaaS login. Parked as a curiosity,
  not a method.

---

## 5. Remote-transport roadmap

The dashboard is transport-decoupled (§2), so remote reach is added *beneath* it in phases.
Everything past **T0** is documented-and-decided but **not** slice-1 work — the point is that no later
phase forces a change to the app or the fiscal core.

- **T0 — LAN-only (ships with slice 1).** The local server serves the dashboard on the venue LAN at
  the **canonical hostname** (`pos.<venue>.<tld>`), resolved locally with the box's own cert.
  Passkeys register against that origin. No cloud, no tunnel. Free tier; the whole of what slice 1
  needs.

- **T1 — the blind tunnel (the first *remote* deliverable; gated on nothing).** A **Spain-hosted
  relay we operate**; the local server makes an **outbound** connection to it (no inbound ports at the
  venue); the relay routes by **SNI hostname** to the right box; **TLS is end-to-end to the box** (the
  cert is on the box — the relay is blind, sees only ciphertext). Built by **reimplementing the snitun
  pattern in Node** (avoids GPL-3 — see §7). The canonical hostname resolves *publicly* to the relay
  and *locally* to the box IP (same name, same cert), so passkeys stay portable LAN↔remote. Login
  still terminates on the box. Handles A + B + occasional C uniformly (remote == on-LAN). This is the
  **paid remote tier**. Known limit: box off → "venue offline."

- **T2 — branded front door + custom domain (polish on T1).** `app.waitron.<tld>` shows a **venue
  picker** from a **thin cloud account** (the customer / billing / tunnel-ownership record — *not*
  operational identity), then tunnels to the chosen box, which does the real login. Custom domain: the
  merchant CNAMEs `pos.<their-domain>` → relay, and **the box** obtains that cert via **ACME DNS-01**
  (the cloud brokers the DNS challenge, never holds the key → the relay stays blind). For a
  single-venue deli this is optional gloss; T1 already gives remote access on a custom domain.

- **T3 — cloud read-mirror leg (the "box off" case).** A Spain-hosted, **read-only** reporting /
  analytics surface over the already-designed sync mirror, up 24/7 even when the venue is closed and
  powered down — the one thing a tunnel cannot do. **Reuse:** it is the *same* `apps/dashboard` app
  pointed at a read-only cloud API (the §2 decoupling paying off). Gated on the **upward sync
  subsystem** (`2026-08-02-app-level-sync-design.md`; container gates ran 2026-08-06 — coming anyway).
  Writes (B) and fiscal (C) still go via the tunnel; the cloud never issues (the cert / key ring never
  leave the box). This same cloud presence is the natural carrier for **fleet ops** (version
  telemetry, staged OTA updates) — a **separate track**, not built here.

**Explicitly out of the roadmap:** cloud-*originated* management writes (the full "run it in the
cloud" option — needs the hardest, unbuilt cloud→local write-sync **and** advisor sign-off; someday
if ever), and **fiscal issuance from the cloud** (moving the cert/submitter to the cloud — the strong
ROF/hosting question). Both deliberately excluded.

**Sequencing.** T0 with slice 1; **T1 buildable independently**; T2 polish on T1; T3 waits for sync.
The dashboard's *feature* slices (staff admin → reporting-read → catalogue → …) proceed **in parallel
with** the transport phases — the whole payoff of decoupling them.

**Pricing model (owner's option "b").** On-LAN free, remote paid — the Nabu Casa template (Home
Assistant is free and local; *remote access is the paid subscription*).

---

## 6. Compliance

Hosting the relay and mirror **in a Spanish datacentre** removes **ROF art. 22.2** — the clause that
bites only when conservation happens *fuera de España* and that carries the prior-notification-to-AEAT
duty and the "constrains where the cloud may run" / "promise made to customers you cannot unwind"
weight (`2026-07-31-cloud-storage-model-design.md` §8a). It also softens the server-as-SIF design's
"a cloud that issues invoices operates the SIF abroad" question — a Spanish cloud is not abroad.

What does **not** vanish, and is a **one-line advisor confirmation before T3 carries anything**:

- **art. 19.3** — whether Waitron is a *tercero* holding records for the client. Note 19.3 is
  *permissive*: it explicitly allows a tercero and keeps responsibility on the client. Not an
  architectural blocker.
- **art. 23** — the ordinary, non-cross-border duty to give an AEAT inspector online access.

**T1/T2 keep all data on the box**, so they need none of this; only the cloud legs (T3) do.

---

## 7. Licence note — snitun is GPL-3.0

snitun (NabuCasa/snitun) is **GPL-3.0**, *not* AGPL-3.0. Waitron is ELv2 (source-available with
restrictions), and GPL-3 code cannot be distributed inside an ELv2 artifact. The rule: **never bundle
snitun into the local-server box we ship.** Three clean paths, in order of preference:

1. **Reimplement the *pattern*, not the code (chosen for T1).** The design — outbound connect, SNI
   routing, E2E with the cert on the box, TCP multiplexer — is an architecture, not copyrightable.
   Rebuild it in Node/TS (native to the stack). Zero GPL exposure.
2. **Run stock snitun *server-side only*.** GPL-3 (unlike AGPL-3) has the "SaaS gap": running GPL
   software as a network service you operate is **not distribution**, so it triggers no copyleft. The
   *client* on the shipped box is the only danger.
3. **Permissive alternative:** `frp` (Apache-2.0) for outbound reverse-tunnelling; `cloudflared`
   (Apache-2.0) but it terminates TLS at the edge, so the relay is not blind.

This is engineering reasoning, not a legal opinion; the recommended path (1) never touches GPL code,
so the question does not arise.

---

## 8. Components and boundaries

| Unit | What it does | Depends on | Phase |
| --- | --- | --- | --- |
| `apps/dashboard` | Browser app — screens/widgets on `@waitron/ui`; transport-agnostic | `@waitron/ui`, the management API | slice 1 |
| `apps/server` management API | Route group wrapping headless fns under `requireManagementSession` + `authorize()`; distinct from the till API | `@waitron/identity` (+ later reporting/catalogue) | slice 1 |
| `@waitron/identity` auth extension | Verifier abstraction; passkey (WebAuthn) + password + TOTP; `listPersons`; management session with status re-check | existing identity model | slice 1 |
| The relay | Spain-hosted blind SNI router; box makes the outbound connection | Node snitun-pattern impl | T1 |
| Thin cloud account | Customer / billing / venue-directory record; not operational identity | the relay | T2 |
| Cloud read-mirror API | Read-only management API over the sync mirror; serves `apps/dashboard` in read-only mode | the sync subsystem | T3 |

**Isolation check.** Each unit has one purpose and a defined interface: the dashboard renders and
calls the management API; the management API authorises and delegates to headless fns; identity owns
credentials and sessions; the relay routes ciphertext. The dashboard can be understood without the
relay's internals, and the relay can change without touching the dashboard.

---

## 9. Testing

- **Component + a11y** for `apps/dashboard` (as `apps/till` does), with **keyboard/focus** a11y
  weighted over touch-target rules — this is a pointer/keyboard data app, not a touch POS.
- **Real-Postgres RLS test** for the management API proving cross-tenant **staff isolation** (like the
  till API's `*.rls.test.ts`).
- **Prove the `person.manage` gate by deletion** (house convention: remove the check, confirm the
  test fails, restore).
- **Identity credential unit tests** — password + TOTP verification (as PIN is tested), and the
  **WebAuthn registration/authentication ceremony** (challenge issue, signature verify against the
  stored public key), including the offline-verify path.
- Coverage at the **browser tier** (95/95/90/88), matching `apps/till` and `packages/ui`.

---

## 10. YAGNI boundary — what is buildable now

**Buildable in the first slice:** §2 frame + §3 staff administration + §4b auth floor (passkey +
password/TOTP behind the verifier abstraction) + §5 **T0** (LAN-only). Everything else — reporting-read
(slice 2), catalogue management, federated/magic-link auth, the auth-policy UI, and transport phases
T1–T3 — is decided and recorded here but is **not** first-slice work.

---

## 11. Provenance — external claims

Per `CLAUDE.md` §1, every external claim carries its source; load-bearing ones quote the source's own
words.

| Claim | Source |
| --- | --- |
| Square offline mode is a fallback; cloud is primary | [magestore, POS offline mode](https://www.magestore.com/blog/pos-offline-mode/) |
| Square: **24h** to accept offline, upload within **72h** | [Square Support — Process offline payments](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode) |
| Square offline payments queued **on the device** / browser storage, per-device | [Square Mobile Payments SDK — Offline Payments](https://developer.squareup.com/docs/mobile-payments-sdk/ios/offline-payments); [connectpos](https://www.connectpos.com/5-pos-systems-support-offline-mode/) |
| SumUp Cloud API triggers card-present on Solo from any HTTPS backend; cloud dashboard | [SumUp Developer — Cloud API](https://developer.sumup.com/terminal-payments/cloud-api) |
| Nabu Casa remote: outbound tunnel, no port-forward, **SNI routing**, **E2E cert owned by the local instance** (relay blind) | [Nabu Casa — Remote access deep dive](https://support.nabucasa.com/hc/en-us/articles/25619268678557-Remote-access-Deep-dive); [NabuCasa/snitun](https://github.com/NabuCasa/snitun) |
| snitun licence is **GPL-3.0** | [NabuCasa/snitun LICENSE](https://github.com/NabuCasa/snitun/blob/main/LICENSE) |
| Passkeys without biometric HW: device PIN / security key / phone-QR (proximity-checked) / synced password manager | [Microsoft Support — Create and save a passkey](https://support.microsoft.com/en-us/windows/security/identity-signin/create-and-save-a-passkey); [Microsoft Learn — Passwordless sign-in](https://learn.microsoft.com/en-us/windows/security/book/identity-protection-passwordless-sign-in) |
| ROF arts. 19.3 / 22.1 / 22.2 / 23 (conservation *fuera de España*, prior notification, online access) | [BOE RD 1619/2012](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696), quoted in `2026-07-31-cloud-storage-model-design.md` §8a |

**Internal cross-references:** cloud-storage model (`2026-07-31-cloud-storage-model-design.md`),
app-level sync (`2026-08-02-app-level-sync-design.md`), server-as-SIF + failover
(`2026-08-01-local-server-sif-and-failover-design.md`), identity (`2026-08-04-identity-design.md`),
daily-close reporting (`2026-08-04-daily-close-reporting-design.md`), catalogue
(`2026-08-05-catalogue-model-design.md`), deli hardware (`2026-07-30-deli-hardware-design.md`).

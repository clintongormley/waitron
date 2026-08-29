# Sync cloud-mirror — sub-project C2b: the operator flow

**Status:** design, awaiting owner review · **Date:** 2026-08-29 · **Branch:** `feat/sync-cloud-mirror-c2b-operator-flow`

## 0. Where this sits

"Build the sync cloud-mirror peer" (backlog top-tier #2) is three subsystems, proven against a
**local stand-in cloud** (a second local Postgres + a reader on another port — no real hosting, DNS
or TLS yet, because none exists):

- **A — Peer identity & auth. LANDED (#144).** Each subscriber has a DB-backed identity and a
  per-peer scrypt bearer token; the source derives `subscriberId` from the token, never the body
  ([spec](2026-08-27-sync-cloud-mirror-peer-identity-design.md)).
- **B — Outbound tunnel. LANDED (#150).** The box dials outbound; the cloud's pull rides back down a
  blind byte-splice relay, TLS end-to-end ([spec](2026-08-27-sync-cloud-mirror-tunnel-design.md)).
- **C — Cloud read-mirror.** A "mirror mode" of `apps/server` that pulls + applies into its own
  Postgres and serves the dashboard read-only. Split into **C1 (LANDED #153)** — the `dining_tables`
  FK-closure enrolment ([spec](2026-08-27-sync-cloud-mirror-c1-enrolment-design.md)) — and **C2**,
  itself split (owner, 2026-08-28) into **C2a (LANDED #155)** and **C2b (THIS spec)**.

**C2a built the running mirror mechanism** ([spec](2026-08-28-sync-cloud-mirror-c2a-mirror-server-design.md)):
a third boot path keyed on `deployment.mode ∈ {primary, mirror}`, a runtime read-only write gate, an
unauthenticated ambient-viewer dashboard, and the pull-through-tunnel + apply wiring — all driven by
the mirror's **matching identity and connection details supplied by env / by hand**. C2a explicitly
deferred the *operator flow* to C2b (C2a §11).

**C2b is that operator flow, and nothing more.** It gives a human two things: a way for the **primary**
to hand out a "mirror bundle", and a **setup-wizard path** on the mirror that consumes the bundle,
"adopts" the existing venue into the mirror's own database, and stores the connection config in the DB
(replacing C2a's env). It builds **no** new runtime sync, apply, gate, or serving behaviour — those are
C2a's, unchanged. This spec's whole job is to make a non-technical owner able to stand up a mirror
without hand-editing env files.

## 1. The scenario, in plain terms

A restaurant runs a box on the premises — the **primary** — already provisioned and trading. The owner
wants a **mirror**: a second Waitron process (in the local stand-in, a second Postgres + a server on
another port) that continuously pulls the primary's rows and serves the venue's data read-only, as a
disaster-recovery copy (C2a).

For the mirror to work it must hold the **same venue identity** as the primary — the same
tenant/location/node/till/series ids — so that the rows it pulls resolve their foreign keys, and it
must know **how to reach the primary** (the relay address, the box's TLS identity, and a sync token).
C2a required an operator to assemble all of that by hand into env vars. C2b automates it:

1. The operator boots the fresh mirror box and opens its **setup app** (the mirror is in setup mode —
   it has no venue yet).
2. They choose **role: mirror**, then enter the **primary's address** and an **admin login** for the
   primary.
3. The mirror calls the primary, which mints and returns a **bundle** — the five identity ids, the
   box's CA certificate, the relay coordinates, and a freshly-minted per-peer sync token.
4. The mirror **adopts the venue** (inserts the identity rows with the primary's exact ids, *without*
   re-registering the fiscal SIF), stores the connection config in its own database, and **restarts
   into mirror mode** — C2a's read-only dashboard comes up showing the venue.

The operator types only **an address and an admin login**. Everything else rides in the bundle.

## 2. Locked decisions (owner answers, 2026-08-29)

1. **The mirror pulls the bundle from the primary** (operator enters the primary's URL + an admin
   login), rather than the operator carrying a file or pasting a blob. The **copyable-blob** variant
   is kept as a named, deferred alternative (§11) — it is the path for a primary the mirror cannot
   reach directly, which is a real-hosting concern.
2. **DB-stored connection config = an operational singleton table for the non-secret parts + the vault
   for the token.** The relay URL, box hostname, and box CA are effectively public (the CA is already
   served at `GET /setup-api/ca.crt`, discovery-api #143); only the per-peer sync token is secret and
   is sealed in the existing credentials vault.
3. **The first-contact trust bootstrap is deferred** (§9), with its constraint recorded: the v1
   stand-in fetches over localhost / plain first-contact (no adversary on the path), and a mirror that
   must reach a primary **over an untrusted network** MUST first have either a real public-CA cert on
   the primary or a fingerprint-before-credential step — neither of which C2b builds, because neither
   the untrusted path nor real hosting exists yet.
4. **v1 = single-tenant DR mirror**, matching A/B/C1/C2a. The multi-tenant whole-log reader and the
   fiscal/hash-chain lane stay deferred.

## 3. The mirror bundle

A JSON object the primary assembles on demand and the mirror consumes exactly once. It has three
parts: the **venue rows** (copied verbatim so the mirror is a faithful copy), the **connection**
details, and the **token**.

**Part 1 — venue rows (the identity scaffold).** The five parent tables `tenants`, `locations`,
`nodes`, `tills`, `invoice_series` are **NOT in the 17 synced tables** — the sync set is the commercial
lane only ([registry.ts](../../../packages/sync/src/registry.ts)), and config replication is deferred
(C1 §8). So the pulled commercial rows' FK parents never arrive over the wire; the mirror must be
provisioned with **complete** parent rows up front. C2a's e2e proved this by **hand-seeding** exactly
those five ([boot.mirror.rls.test.ts:88-99](../../../apps/server/src/boot.mirror.rls.test.ts)); C2b
replaces the hand-seed with a real step and the bundle carries the rows it needs.

The bundle therefore carries the primary's **actual rows**, read `SELECT`-style on the primary and
inserted verbatim on the mirror (both run the identical schema/version, so a column-for-column copy is
safe and survives schema additions):

- `tenant` — the one `tenants` row (`id, country, tax_id, legal_name`).
- `locations` — every `locations` row for the tenant (v1 is single-location, but carry the set).
- `nodes` — every `nodes` row (v1: the one primary node; the mirror **copies** its `node_id`, C2a
  decision 2, so a pulled row's `node_id` FK and the subscriber identity line up).
- `tills` — every `tills` row.
- `invoiceSeries` — every `invoice_series` row (there are ≥2: the standard + the rectificativa series
  `planVenue` emits, [venue-plan.ts](../../../packages/provisioning/src/venue-plan.ts)).

**Part 1b — the five designated ids for `trading.env`.** `tenantId`/`locationId`/`tillId`/`nodeId`/
`seriesId` = the primary's `config.till.*` values (the `WAITRON_TILL_*_ID` five). These pick which of
the carried rows `trading.env` names so the mirror boots the trading branch (§6); they are ids of rows
already in Part 1, not separate data. On a fresh primary four of the five are random
(`randomUUID()`d in `applyVenue`, [venue-apply.ts:95,135,143,161](../../../packages/provisioning/src/venue-apply.ts)),
which is exactly why they must be carried, not re-derived.

**Part 2 — connection + environment.**

| Field | Meaning | Source on the primary |
|---|---|---|
| `environment` | `production` \| `preproduction` — the mirror stamps the SAME | `readDeploymentEnvironment(db)` ([deployment.ts:35](../../../packages/db/src/deployment.ts)) |
| `boxHostname` | the SAN on the box leaf, for the mirror's tunnel SNI/verify | the box hostname (e.g. `waitron.local`) `mintSelfSignedServerCert` stamps ([self-signed-cert.ts](../../../apps/server/src/self-signed-cert.ts)) |
| `boxCaPem` | the box's private CA, the mirror's tunnel trust anchor | `caCertPath(stateDir)` ([box-secrets.ts:27](../../../apps/server/src/box-secrets.ts)) |
| `relayUrl` | the relay's client-facing address (→ the mirror's `peer.url`) | the primary's own `loadTunnelConfig` / `WAITRON_TUNNEL_RELAY_URL` ([config.ts:344](../../../apps/server/src/config.ts)) |

**Part 3 — the token.** `syncToken`: a freshly-minted per-peer bearer token, minted by
`enrolPeer(retentionDb, { subscriberId: nodeId, name: "cloud mirror" })`
([peers.ts:29](../../../packages/sync/src/peers.ts)), carried **in plaintext, once**.

**The token crosses in plaintext, inside the TLS response** — this is forced by the vault: each box
mints its **own** random `WAITRON_CREDENTIALS_KEY` into its own `secrets.env`
([box-secrets.ts:134-143](../../../apps/server/src/box-secrets.ts)), and a value sealed with the
primary's key **cannot** be opened with the mirror's — AES-256-GCM authentication fails and `open()`
returns `null` → `credentials.decrypt_failed` ([cipher.ts:53-66](../../../packages/credentials/src/cipher.ts)).
So the primary cannot pre-seal the token *for* the mirror; it hands over the plaintext once, and the
mirror re-seals it under its own key (§6). Everything else in the bundle is non-secret. The token is
**revocable** (`revokePeer`, A §6) if a bundle is mishandled.

## 4. Primary side — the bundle endpoint

`POST /management-api/mirror-bundle`, mounted **only on a trading + primary node**. It is on the
**management** surface, not setup-api, because a provisioned primary runs in trading mode where
`setup-api` is not mounted (`config.till === undefined` is the setup gate,
[boot.ts:441](../../../apps/server/src/boot.ts)); the mirror-bundle endpoint therefore lives beside the
other management routes the trading primary already mounts.

- **Auth.** The request carries the primary's **admin credential** (PIN or password, whatever the
  management login accepts). The handler authenticates it and calls `authorizeManager` against a **new
  `mirror.create` permission** (admin-tier). The permission name is grepped against the `permissions.ts`
  sets and the `*.` error-code siblings before it is fixed (error codes and permissions are
  conventions reviewers enforce, CLAUDE.md §3). Minting a bundle is a security-sensitive action (it
  mints a data-access token), so it is gated at the highest tier, not the ambient level.
- **Token mint.** `enrolPeer` runs as `sync_retention` (A §5). The trading primary already holds a
  `sync_retention` connection for the retention sweep
  ([boot.ts retention wiring](../../../apps/server/src/boot.ts)); the handler reuses it. Each call
  mints a **new** active `sync_peers` row for `subscriberId = nodeId` — rotation is supported (A §4),
  so re-running adopt is safe and leaves the prior token valid until revoked.
- **CA read.** The handler reads `caCertPath(stateDir)` (the single source of truth the discovery-api
  already serves, [discovery-api.ts](../../../apps/server/src/discovery-api.ts)).
- **Relay coords.** From the primary's own `loadTunnelConfig`; if the primary has no tunnel configured
  the endpoint refuses (a mirror with no relay to dial is unusable) with a `mirror.*` code, fail-closed.
- **Response.** The bundle (§3). The token appears **once**, in this response, and is never logged
  (the `sync.*` / `tunnel.*` no-row-content discipline).

**Reachability — provision-time vs runtime.** These are two different reaches and must not be
conflated. **Runtime sync ALWAYS goes box→relay→mirror** (B's tunnel): the box dials *outbound* to the
relay, the mirror connects to the relay's client port, the relay blind-splices them. The mirror never
dials the box's own address for anything — a NAT'd box is unreachable at its own address but always
reachable through the relay. So a mirror provisioned by *any* means below pulls identically.

What varies is only **how the mirror obtains the bundle at provision time**:

- **Direct-URL fetch (C2b builds this).** The mirror hits the primary's own address — works only when
  the primary is **directly reachable** (the stand-in / a LAN).
- **Relay-pointed fetch (deferred).** The **same** bundle endpoint is reachable through B's tunnel
  unchanged — the box-side tunnel client raw-splices the whole TLS connection to the box's own HTTPS
  listener, path-agnostic ([client.ts:118-124](../../../packages/tunnel/src/client.ts), forwarding to
  `config.httpPort`, [boot.ts tunnel wiring](../../../apps/server/src/boot.ts)), and `tunnelHttpClient`
  carries any path ([tunnel-http.ts:25-33](../../../apps/server/src/tunnel-http.ts)). So **no new
  transport** is needed — only a caller pointed at the relay, plus §9's trust bootstrap. But this
  fetch needs the relay coords + box CA + servername supplied out-of-band first (to establish the
  tunnel TLS), and those are themselves in the bundle — so it saves only re-fetching the ids/token, not
  the connection details.
- **Copyable blob (deferred, §11).** The operator carries the whole bundle out-of-band; no
  provision-time fetch at all. Strictly the simplest for a primary not directly reachable.

## 5. Mirror side — adopt venue provisioning

The mirror is in **setup mode** (fresh box, `config.till === undefined`), so `setup-api` **is**
mounted. The consume endpoint is `POST /setup-api/adopt`, beside the existing `POST /setup-api/provision`
([setup-api.ts:252](../../../apps/server/src/setup-api.ts)).

`adopt` reuses `provision`'s guardrails — the synchronous one-shot latch and the deps gate
([setup-api.ts:247,276-279,358](../../../apps/server/src/setup-api.ts)) — and takes a different body: the
primary's address + admin credential. The handler, **server-side on the mirror** (so the admin
credential never touches a browser-to-primary hop, and CORS is a non-issue):

1. **Fetch the bundle** from the primary's `/management-api/mirror-bundle` using the supplied admin
   credential. In the stand-in this is a direct HTTPS/HTTP call; §9 governs the trust of that first
   contact.
2. **Adopt the venue** — a new `adoptVenue` path (below).
3. **Seal the token** into the mirror's own vault (§6).
4. **Persist** the connection config (§6) and stamp the environment + mode.
5. **Restart** into mirror mode via the existing `requestRestart`
   ([setup-api.ts:352](../../../apps/server/src/setup-api.ts)) — the same
   persist-config-then-restart transition slice-2b uses.

### `adoptVenue` — insert identity with explicit ids, never `registerSif`

Today `applyVenue` cannot serve a mirror: it `randomUUID()`s the four non-tenant ids
([venue-apply.ts:95,135,143,161](../../../packages/provisioning/src/venue-apply.ts)), its `VenueAction`
variants carry no id except `ensure-tenant`
([venue-plan.ts:38-58](../../../packages/provisioning/src/venue-plan.ts)), and it **mandates**
`register-sif` (throws "register-sif never ran" at
[venue-apply.ts:178](../../../packages/provisioning/src/venue-apply.ts), and `VenueResult.sif` is
required). C2b adds a distinct adopt path — an `adoptVenue(rows, { db: ownerDb })` in `packages/provisioning`,
where `rows` is Part 1 of the bundle (the tenant + the location/node/till/series row arrays) — that:

- inserts the `tenants` row, then every `locations`/`nodes`/`tills`/`invoice_series` row **verbatim,
  all columns including the explicit ids**, under one `withTenant(ownerDb, tenantId, …)` transaction
  (the `applyVenue` shape, [venue-apply.ts:58](../../../packages/provisioning/src/venue-apply.ts)), in
  FK order (tenant → location → node → till → series), each insert `ON CONFLICT (id) DO NOTHING` for
  idempotency. Full rows, not just ids, because these parents do not sync and the mirror's dashboard
  reads their real content (§3 Part 1);
- **does not** `register-sif` and **does not** `seed-admin`. The mirror serves via C2a's ambient viewer
  (no admin needed), and the fiscal SIF must never be re-registered on the mirror;
- returns a result type in which **`sif` is absent** (a new `AdoptResult` carrying the five designated
  ids — the plan adds it rather than making `VenueResult.sif` optional, so `applyVenue`'s contract is
  untouched).

**Why no `registerSif` — the unrepairable-chain guardrail.** `registerSif` mints a *fresh*
`numero_instalacion` via `contadores_instalacion` and **nulls out** `cadenas.ultima_huella` to start a
new chain ([registro-sif.ts:150-160](../../../packages/fiscal-verifactu/src/registro-sif.ts)); it is
inherently non-idempotent and has no "adopt" flag — "re-registration always mints a fresh number". So
calling it on the mirror would create a **second, forked, unrecoverable hash chain** for the same venue
(CLAUDE.md §5). The correct behaviour is to **not insert `registro_sif`/`cadenas` at provision at all**:
those rows arrive on the mirror through **sync** like every other row, carrying the primary's real
installation number and chain. `adoptVenue` inserts only the identity scaffold the pulled rows need for
FK resolution.

### Environment + mode

`stampDeployment(ownerDb, bundle.environment)` first — the environment is immutable and must **match
the primary's** (same venue, same chain; the fiscal one-database-per-environment invariant, CLAUDE.md
§5) — then `setDeploymentMode(ownerDb, 'mirror')`
([deployment.ts:56,95](../../../packages/db/src/deployment.ts); `setDeploymentMode` throws
`deployment.not_stamped` on an unstamped DB, so the order is load-bearing). `provisionVenue` never calls
`setDeploymentMode` today ([provision.ts:57-80](../../../apps/server/src/provision.ts)); the adopt
orchestrator adds it. Both are owner-role writes (`app_user` holds no INSERT/UPDATE on `deployment`).

## 6. DB-stored connection config (owner Q2 choice)

C2a read the mirror's connection from env — `loadMirrorConfig` (box CA file + hostname,
[config.ts:408-440](../../../apps/server/src/config.ts), whose own comment says "C2b moves it to
DB-stored") and `WAITRON_SYNC_PEERS` (relay url + token). C2b moves it to the database:

- **`mirror_config` — a new operational singleton table**, modelled on `deployment`: `CHECK (id = 1)`,
  **no `tenant_id`, no RLS** (a whole-database operational record, out of the fiscal `inmutabilidad`
  FORCE-RLS scan by construction, like `deployment`/`sync_cursor`). Columns: `relay_url`,
  `box_hostname`, `box_ca_pem` (all non-secret — the CA is already public via discovery-api). A
  hand-written custom migration in `packages/db/drizzle` (drizzle-kit models no grants). **Grants:**
  `GRANT SELECT ON mirror_config TO app_user` (the boot read), owner-role writes (the adopt stamp) —
  the exact `deployment` grant shape ([0010_deployment_stamp.sql:18](../../../packages/db/drizzle/0010_deployment_stamp.sql)),
  verified by ACL read-back, both directions (CLAUDE.md §3).
- **The sync token → the credentials vault**, under a **new purpose `sync.mirror_token`** registered in
  the vault's `PURPOSES` list. Sealed at adopt on the **owner** connection under the adopted tenant
  (the `sealAeatCredential` precedent — [aeat-credential.ts:81-101](../../../apps/server/src/aeat-credential.ts),
  `putCredential` under `withTenant`), read at boot as **`app_user` via `withTenant`** — the same role
  and path the AEAT cert already uses ([credentials.ts:16-23](../../../apps/server/src/credentials.ts)).
  The vault table `tenant_credentials` is FORCE-RLS tenant-scoped
  ([0001_credentials_rls.sql](../../../packages/credentials/drizzle/0001_credentials_rls.sql)); the
  mirror has exactly one tenant (the adopted venue), so keying the token on `(tenantId, 'sync.mirror_token')`
  reuses the vault wholesale with **no new mechanism and no new grant** — the token is encrypted at
  rest under the mirror's own box key, never readable cross-box.

The five identity ids + DB URLs + `WAITRON_ENV` continue to live in `trading.env` via the existing
`writeTradingEnv` (so `config.till` is set at reboot → the trading branch → C2a's mirror wiring). Only
the **connection** config moves to the DB. This is the split C2a's `config.ts:422` note anticipated.

## 7. Boot — mirror reads connection from DB, not env

C2a's mirror boot reads `loadMirrorConfig(env)` (required, loud if absent) and composes
`tunnelHttpClient({ ca, servername })` + `runSyncPull({ peers: [{ url: relay, token }] })`
([boot.ts mirror branch](../../../apps/server/src/boot.ts)). C2b changes **only where that config comes
from** on a mirror: read `mirror_config` (as `app_user`, a plain SELECT — no RLS) for
`ca`/`servername`/`relayUrl`, and unseal the token from the vault (`sync.mirror_token`, `app_user` via
`withTenant`). The composed `tunnelHttpClient` + `runSyncPull` call, both lanes under one
`AbortController`, and every worker-absence property are **byte-for-byte C2a's** — no runtime sync,
apply, gate, ambient-session, or serving code changes. The env readers (`loadMirrorConfig`, the mirror
use of `WAITRON_SYNC_PEERS`) are retired for the mirror path and their comments updated (CLAUDE.md §3 —
editing a file is not auditing it; grep `loadMirrorConfig` / `WAITRON_MIRROR_BOX_*` before claiming
they are gone).

Fail-closed: a mirror that boots with `deployment.mode = 'mirror'` but an absent/partial `mirror_config`
or an unsealable token is a loud `server.config_invalid`, not a silent no-op — the same posture C2a's
required `loadMirrorConfig` had (an empty relay URL is refused; the empty-connection-string trap,
CLAUDE.md §3).

## 8. The setup wizard — role + connect-to-primary screens

`apps/setup` today is a 6-screen flow (`mode → admin → venue → cert → review → provisioning → done`,
[setup-app.ts:22](../../../apps/setup/src/setup-app.ts)) that only ever provisions a **primary**. C2b
adds a fork at the front:

- **A new first `role` screen** — **primary** | **mirror**. Primary → the existing demo/live flow,
  unchanged. Mirror → the connect screen. (Either a new screen element or an extension ahead of
  `mode-screen`; the plan picks whichever keeps the existing screens' tests intact — behaviour-preserving,
  CLAUDE.md.)
- **A new `connect-to-primary` screen** — two fields: the **primary's address** and an **admin login**.
  On submit it POSTs to the mirror's own `POST /setup-api/adopt` (§5). The mirror path **skips**
  `mode`/`admin`/`venue`/`cert`/`review` entirely — a mirror has no demo/live choice (it inherits the
  primary's environment), seeds no admin, and files nothing.
- **Reuse the existing terminal screens** — `provisioning` (progress) and `done` (reload into the
  read-only dashboard) serve the mirror path too.
- New typed dispatch helpers in `apps/setup/src/events.ts`
  ([events.ts](../../../apps/setup/src/events.ts)) and a `SetupApi.adopt(...)` client method mirroring
  `provision` ([client.ts:147](../../../apps/setup/src/api/client.ts)). The role/connect conditional
  lives in the shell (`#onAdvance`), matching the altitude fix (m) that lifted the venue→cert/review
  conditional out of a screen (backlog #149).

Served in setup mode via the existing `WAITRON_SETUP_APP_DIR` / `mountSetup`
([setup-api.ts:230,375](../../../apps/setup/src/…)); the trading path is untouched.

## 9. Trust bootstrap — deferred, constraint recorded

On first contact the mirror does not yet hold the primary's CA (it is *in* the bundle), so it cannot
verify the primary's TLS certificate the way it will verify every later tunnel connection. The **full
analysis** (owner exchange, 2026-08-29):

- A network MITM on the mirror→primary path can only intercept by **terminating TLS**, which means
  presenting a certificate. Presenting **its own** cert is caught by an out-of-band fingerprint
  comparison (the operator reads the primary's true fingerprint off the primary's own dashboard); it
  **cannot** present the primary's real cert because completing the TLS handshake requires the
  primary's **private key**, which it does not have.
- The fingerprint therefore works — but **only** if the admin credential is **withheld until after the
  fingerprint is confirmed**. Send the credential in the first request and a MITM has it in the clear
  regardless of any fingerprint shown afterwards. And the same is true of *any* fetch-authorising
  secret (a pairing code no less than a password), because the bundle it unlocks contains the
  data-access token.

**Decision: defer.** C2b's two actual targets need none of it — the **stand-in is localhost** (no
attacker on the path), and **real hosting** brings a real public-CA cert (standard TLS verification, no
first-contact problem). The only case wanting the fingerprint dance is a **self-signed primary reached
over an untrusted network**, which does not exist until real hosting, and even there a real cert is the
cleaner answer.

**Constraint recorded** (so a later slice cannot regress into leaking the credential): a mirror that
reaches a primary **over an untrusted network** MUST send the admin credential only over a channel it
has verified — via a real public-CA cert on the primary, or a **fingerprint-before-credential** two-step
(observe cert → operator confirms against the primary's out-of-band fingerprint → *then* send the
credential). C2b's stand-in flow sends over localhost / plain first-contact and carries a comment naming
this constraint at the fetch site, so the untrusted-path build cannot be bolted on without it.

## 10. Roles & grants

C2b introduces **one** table grant and **one** vault purpose, no new role:

- `GRANT SELECT ON mirror_config TO app_user` (boot read); the `mirror_config` write (adopt stamp) is an
  **owner-role** write, asserted by a negative ACL read-back (`app_user` holds no INSERT/UPDATE on
  `mirror_config`) — the `deployment` pattern (CLAUDE.md §3).
- The `sync.mirror_token` vault credential reuses `tenant_credentials`' existing `app_user`
  SELECT/INSERT/UPDATE grants under FORCE-RLS ([0001_credentials_rls.sql](../../../packages/credentials/drizzle/0001_credentials_rls.sql))
  — no new grant; the seal is an owner-connection write under `withTenant` (the `sealAeat` precedent),
  the read an `app_user` `withTenant` read.
- The primary's bundle endpoint mints via the **existing** `sync_retention` connection (A §5) and reads
  the CA from disk — no new grant. The `mirror.create` permission is an identity-layer permission, not a
  DB grant.

`mirror_config` carries **no `tenant_id`**, so it is out of the `inmutabilidad` FORCE-RLS scan by
construction (that scan keys on the column). The plan still runs
`pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` to confirm it added no tenant-scoped table
(CLAUDE.md §3).

## 11. Out of scope (named, not dropped)

- **The copyable-blob emission variant** — a primary dashboard action that mints + shows a bundle blob
  the operator carries out-of-band into the mirror. It is for when the mirror **cannot do the
  provision-time fetch over a direct URL** (a primary not directly reachable at provision time) — NOT
  because the mirror can't reach the primary at all: runtime sync always goes through the relay (§4),
  so a blob-provisioned mirror pulls identically. It is the simplest bootstrap for a NAT'd primary
  (the relay-pointed fetch of §4 still needs the connection details out-of-band anyway) and pairs with
  real hosting. Deferred; the bundle shape (§3) serialises cleanly for it.
- **The trust bootstrap for an untrusted path** (§9) — the fingerprint-before-credential two-step or a
  real public-CA cert. Deferred with real hosting; the constraint is recorded so it cannot be skipped.
- **The relay-pointed provision fetch** — reaching the primary's bundle endpoint through B's tunnel for
  a NAT'd primary. No new transport (§4); it is a caller change plus §9's trust bootstrap, belonging to
  the hosting slice.
- **The promote action** (mirror → primary at runtime) — C2a designed for it; it is its own slice.
- **Multi-tenant whole-log reader** and the **fiscal hash-chain lane** — later slices, unchanged.
- **Real cloud hosting / DNS / TLS / per-user mirror auth** — the real T1 relay + hosting slice.

## 12. Testing

Real Postgres, not PGlite, for anything touching the role split, RLS-as-`app_user`, the
apply-under-FORCE-RLS path, or the vault seal/unseal under a real key (PGlite is superuser-only and
serialises queries, CLAUDE.md §4). `TESTCONTAINERS_RYUK_DISABLED=true` locally. The wizard + pure
bundle-serialisation logic may use the lighter target where a comment says why. The closest existing
patterns are C2a's `boot.mirror.rls.test.ts` and `mirror-e2e.rls.test.ts` (primary + relay stand-in +
mirror reader), and the provisioning suite's `venue-apply.*.test.ts`.

- **Headline e2e — a fresh mirror adopts a bundle fetched from a booted primary, then pulls + serves
  read-only.** Boot a trading **primary** (real Postgres, seeded `sync_log`) mounting
  `/management-api/mirror-bundle`; boot a fresh **mirror** in setup mode against a second Postgres; drive
  `POST /setup-api/adopt` with the primary's URL + an admin login. Assert: the mirror **fetches the
  bundle**, **adopts** the identity rows with the primary's **exact ids** (read them back), stamps
  `environment` = the primary's + `mode = 'mirror'`, seals `sync.mirror_token`, and after restart
  **pulls + applies** through the tunnel and serves a `GET` dashboard read of the applied data **with no
  login** (C2a's ambient viewer), while a `POST` mutation returns `node.read_only` 403 (C2a's gate). No
  `registro_sif`/`cadenas` row is written by adopt; those arrive only via the pulled `sync_log`.
- **Proven by deletion** (CLAUDE.md §4):
  1. remove the `setDeploymentMode('mirror')` call → the adopted node boots as a **primary** (writes
     succeed, primary workers engage); restore → mirror.
  2. make `adoptVenue` call `registerSif` (the thing we forbid) → a second `registro_sif` /
     `contadores_instalacion` row + a nulled `cadenas` pointer appears **in addition to** the pulled
     chain (the fork); restore → only the pulled chain exists. This pins the guardrail, not just the
     absence of a call.
  3. feed `adoptVenue` a mismatched id (e.g. a random `locationId` ≠ the bundle's) → a pulled row's FK
     fails to resolve / the read returns empty; restore → resolves. This pins "explicit ids are actually
     used".
  4. drop the token-seal step → the mirror boot fails `server.config_invalid` (no token to unseal);
     restore → boots and pulls.
- **`mirror_config` unit + grant tests:** insert/read round-trip; the `CHECK (id = 1)` singleton; ACL
  read-back that `app_user` holds `SELECT` and **not** INSERT/UPDATE (`has_table_privilege`/`aclexplode`,
  both directions, CLAUDE.md §3).
- **`adoptVenue` unit tests:** idempotent re-adopt (`ON CONFLICT DO NOTHING`); the result type carries no
  `sif`; inserts exactly the identity scaffold and nothing fiscal.
- **Bundle endpoint tests:** `mirror.create` gates it (an under-privileged admin is refused); the token
  is minted once per call and never appears in a log line; a primary with no relay configured refuses.
- **Vault cross-box test** (the design's load-bearing fact): a token sealed under key A cannot be
  unsealed under key B → `credentials.decrypt_failed`; sealed and read under the **same** key round-trips.
- **Wizard tests** (the per-screen `*.test.ts` + `*.a11y.test.ts` shape): the role screen routes
  primary vs mirror; the connect screen assembles the adopt body; the mirror path skips
  mode/admin/venue/cert/review; a stub `SetupApi.adopt` drives the terminal screens.
- **Run unfiltered.** `pnpm --filter @waitron/server test:coverage`,
  `pnpm --filter @waitron/db test:coverage`, `pnpm --filter @waitron/provisioning test:coverage`,
  `pnpm --filter @waitron/setup test:coverage` for the thresholds, plus the whole `apps/server`,
  `@waitron/db`, `@waitron/provisioning` suites **unfiltered** (cross-cutting guards — teardown,
  english-only, errors-reachable, the `inmutabilidad` FORCE-RLS scan — do not load under a name filter,
  CLAUDE.md §2/§4).

## 13. Security review

C2b adds an operator-facing trust boundary (a primary that hands out a data-access token, a mirror that
ingests one), so a security review is part of the slice (the cloud-mirror boundary, owner note). Points
it must confirm:

- **Only an authorised admin can mint a bundle.** `mirror.create` gates `/management-api/mirror-bundle`;
  proven by an under-privileged-admin refusal, not asserted.
- **The token is protected at rest and never leaked.** Sealed under the mirror's own box key
  (unreadable cross-box, proven), never logged in plaintext, revocable via `revokePeer`.
- **No second fiscal chain is created.** `adoptVenue` writes no `registro_sif`/`cadenas`; the
  proven-by-deletion `registerSif` control (§12.2) is the receipt, and the fiscal write path is
  byte-unchanged by the branch (H2 grep-proven, the counter-receipt/cash-drawer precedent).
- **The first-contact caveat is honoured, not silently violated** (§9): the stand-in fetch is
  localhost/plain and the untrusted-path constraint is recorded at the fetch site; no admin credential is
  transmitted ahead of a trust check on any path C2b actually builds.
- **The mirror gains no write capability.** Adopt sets `mode = 'mirror'`; C2a's gate refuses every
  mutation; `app_user` cannot flip the mode (the `deployment`/`mirror_config` negative read-backs).
- **A/B/C1/C2a are unchanged** — C2b is a *consumer* of the existing enrol/tunnel/apply/gate paths and
  adds no transport, weakening none.

## 14. Docs & comments this change touches (editing a file is not auditing it, CLAUDE.md §1/§3)

- `config.ts`'s `loadMirrorConfig` "C2b moves it to DB-stored" note ([config.ts:422](../../../apps/server/src/config.ts))
  is discharged — replace it with a pointer to `mirror_config` + the vault purpose; grep
  `WAITRON_MIRROR_BOX_*` / `loadMirrorConfig` before claiming the env path is gone for the mirror.
- The boot mirror-branch comment gains the DB-read of connection config (vs C2a's env read).
- `deployment.ts` / `setDeploymentMode` docs note the adopt path as a second writer of `mode`.
- The setup-api header gains `/setup-api/adopt` beside `/setup-api/provision`; the management-api header
  gains `/management-api/mirror-bundle`.
- The **backlog** "C2 — the mirror-mode server" thread ([backlog.md](../../../docs/backlog.md)) moves
  C2b from "next" to "in flight / landed", and the `sync-cloud-mirror-peer-identity` memory records
  C2b's state. (Backlog + memory updated at land, per `/land-branch`.)

## 15. Provenance

Internal receipts are cited inline as `file:line` against the branch tree and were read from the current
code this session (two exploration passes), not from memory: the `applyVenue` id-generation and mandatory
`register-sif` ([venue-apply.ts](../../../packages/provisioning/src/venue-apply.ts),
[venue-plan.ts](../../../packages/provisioning/src/venue-plan.ts)); `registerSif`'s chain-forking
([registro-sif.ts](../../../packages/fiscal-verifactu/src/registro-sif.ts)); `obligadoTenantId`
([tenant-id.ts](../../../packages/provisioning/src/tenant-id.ts)); the deployment accessors incl.
`setDeploymentMode` ([deployment.ts](../../../packages/db/src/deployment.ts)); the setup-api provision
contract, latch, and restart ([setup-api.ts](../../../apps/server/src/setup-api.ts),
[provision.ts](../../../apps/server/src/provision.ts)); the wizard flow, events, and client
([setup-app.ts](../../../apps/setup/src/setup-app.ts), [events.ts](../../../apps/setup/src/events.ts),
[client.ts](../../../apps/setup/src/api/client.ts)); the C2a mirror boot, `loadMirrorConfig`, and
`tunnelHttpClient` ([config.ts](../../../apps/server/src/config.ts),
[boot.ts](../../../apps/server/src/boot.ts), [tunnel-http.ts](../../../apps/server/src/tunnel-http.ts));
`enrolPeer` and the CLI ([peers.ts](../../../packages/sync/src/peers.ts)); the vault cipher, keyring,
store, and per-box key ([cipher.ts](../../../packages/credentials/src/cipher.ts),
[box-secrets.ts](../../../apps/server/src/box-secrets.ts),
[aeat-credential.ts](../../../apps/server/src/aeat-credential.ts),
[credentials.ts](../../../apps/server/src/credentials.ts)); and the tunnel path-agnosticism
([client.ts](../../../packages/tunnel/src/client.ts), [relay.ts](../../../packages/tunnel/src/testing/relay.ts)).
The `file:line` anchors are the design basis and are **re-verified during implementation** — a receipt
read this session is still a claim (CLAUDE.md §1). External claims: none — C2b is entirely internal. The
seeding memories (`sync-cloud-mirror-peer-identity`, `sync-cloud-mirror-connection-direction`,
`replication-is-shared-infra`) are point-in-time notes and were re-verified against code before use.

# Card payment providers and readers, configured from the dashboard — Design

**Date:** 2026-09-11. **Status:** approved in brainstorm, spec under review.

This is **slice 1** of a two-slice track. Slice 2 (the handheld-to-reader link: NFC first, QR
second, picker fallback) is deferred and only touched here where slice 1 must leave a seam for it.

## The problem

Today a card payment provider and its reader are fixed per server process by environment variables.
`apps/server/src/till-config.ts` reads `WAITRON_TILL_CARD_PROVIDER` and, for SumUp,
`WAITRON_TILL_SUMUP_READER_ID`; `buildCardProvider` (`apps/server/src/boot.ts`) turns those into one
`PaymentProvider` object at boot, and every till on the box drives that single object. The SumUp API
key and merchant code live in the sealed credential vault (`packages/credentials`, purpose
`payments.sumup`), writable only by the `waitron-credentials` command-line tool. A real box operator
has neither a shell nor the CLI, so today none of this can be set up on site.

The owner wants setup done in the dashboard: connect one or more providers, register the readers the
venue owns, and give each till a default reader — all at runtime, no restart, no terminal.

The `devices` table already carries `card_provider` and `card_reader_id` columns and the Devices
screen already edits them, but nothing on the pay path reads them: they are write-and-display only,
and the dropdown does not even offer SumUp. This slice makes device→reader routing real and moves it
off those two columns.

## What the owner decided (brainstorm, 2026-09-11)

- **A list of readers ("POS devices") across one or more providers.** A venue may run a SumUp Solo
  and a Stripe reader at once. `WAITRON_TILL_CARD_PROVIDER`'s single-provider-per-box shape is
  replaced.
- **Providers are shipped code, enabled and configured at runtime.** "Add a provider module at
  runtime" means enable/configure a provider whose adapter is already in the image, not load new
  code. Today that is SumUp and Stripe; the registry is built so Redsys slots in later.
- **No standalone reader records.** A reader we do not communicate with is reconciled from the paper
  slip; a database row for it buys nothing. Manual card stays exactly as it is, naming no reader.
- **Each provider module owns its own reader flow.** How a SumUp reader is paired, how a Stripe
  reader is registered, what a provider's credential fields are — all live in the provider's package.
  Generic dashboard and server code names no provider.
- **Redsys and bank terminals are parked.** See _Deferred_ for the research receipts so nobody
  re-does them: the cabled Redsys path (TPV-PC Implantado) wants a Windows PC beside the pinpad with
  a vendor DLL and Redsys homologation, and the box is Linux — that is a separate payment-agent
  project, and it cannot be designed until the deli's bank names its acquirer and integrated mode.
- **Readers list uses the shared data table** (`wt-data-table`), not a list of cards.
- **Handheld link is slice 2**, NFC > QR > picker in preference order.

## Architecture: a lazy provider pool (approach A, approved)

The server keeps an in-memory map from provider name to a live `PaymentProvider` (and, where needed,
its underlying client). The map is empty at boot. The first sale, sweep, reader operation or status
check that needs a provider builds it from the sealed credential and caches it. A dashboard save of
that provider's credentials **evicts** the entry, so the next use rebuilds it. Credentials are
verified against the provider **at save time** — this is where boot's "bad credentials fail here
rather than on the first sale" check moves to, and it reports the failure to the person who typed it.

- Rejected **B (restart on change)**: interrupts trading for a config edit, and a box operator has
  no terminal if the new boot fails.
- Rejected **C (build per request, no cache)**: fine for SumUp, wasteful for the Stripe client, and
  the background sweeps would rebuild every tick.

The existing `buildCardProvider` seam already reads `db` and the keyring and already calls
`readCredential` → `withTenant`, so the pool's `build` step is the same shape; the boot-time single
build becomes the pool's first miss. The providers already expose a per-call
`resolveReader(tenantId, tillId) => Promise<string>` hook — boot passes a constant closure today, so
routing a call to a chosen reader needs no provider signature change.

## Section 1 — data model

All new tables live in the **payments** module's own migration set
(`packages/payments/drizzle`, set name `payments`), the correct home for tenant-bearing payment
tables. No backwards-compatibility or data-migration code: nothing is in production, so schema
changes drop and recreate (CLAUDE.md §3).

### `card_readers`

One row per physical reader the venue owns.

| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL FK → `tenants` restrict | every read scopes to it (§ isolation) |
| `provider` | text NOT NULL | `"sumup"` / `"stripe"`; a plain config token, never a credential |
| `provider_ref` | text NOT NULL | opaque to generic code: the SumUp reader id, the Stripe reader id |
| `name` | text NOT NULL | operator-facing label |
| `active` | boolean NOT NULL default true | retire = false, never DELETE |
| `created_at` | timestamptz NOT NULL default now() | |
| `retired_at` | timestamptz NULL | set when `active` flips false |

- Classified **`state`** (`packages/payments/src/classification.ts`, via `classify`), replicated,
  single-writer-per-row.
- `UNIQUE (tenant_id, provider, provider_ref)` so the same physical reader is not added twice.
- Retired rows are kept so historical payments still resolve a reader name.
- `provider_ref` is deliberately **not** a credential and never sealed: it is a public identifier
  (the same status the current `devices.card_reader_id` comment already asserts).

### `device_card_readers`

A device's default reader. Its own table (not a column on `card_readers`) because it is a
core→payments cross-set link and the FK must point at the core `devices` table.

| column | type | notes |
| --- | --- | --- |
| `tenant_id` | uuid NOT NULL FK → `tenants` restrict | |
| `device_id` | uuid NOT NULL | FK → `devices(tenant_id, id)` composite |
| `reader_id` | uuid NOT NULL | FK → `card_readers(tenant_id, id)` composite |
| PK | `(tenant_id, device_id)` | one default per device |

- Classified **`state`**.
- The two write-and-display columns on `devices` — `card_provider` and `card_reader_id` — are
  **dropped** in this slice's core migration, along with their reads in `device-session.ts`, the
  echo in `device-api.ts`, the PATCH in `device-api.ts`, and the Devices-screen editor. A core-set
  change is a deliberate exception and the commit says why (CLAUDE.md §3): the columns are being
  removed, not added, and the replacement lives in the payments set where its grants travel with it.
- **Cross-set edge honesty:** this is an ordinary FK cross-set edge (payments → core), the kind
  `scripts/module-graph-honesty.test.ts` already models; no cross-set trigger is created.

### Reader stamp on payments

`packages/payments/src/schema/payments.ts` gains a nullable `reader_id uuid` (FK →
`card_readers(tenant_id, id)`), stamped for integrated card tenders. This is what later lets an
acquirer statement be matched to a machine. Nullable because cash, manual card and the Stripe
phone-as-reader path name no reader. Migration `0003_reader_id.sql` (or the next free number).

The Stripe phone-as-reader provider (`stripe_on_device`) is unchanged: the paying device *is* the
reader, so it gets no `card_readers` row and stamps no `reader_id`.

## Section 2 — provider accounts from the dashboard

A new **Payments** screen under the Configuration nav group, gated by a **new `payments.manage`
permission** held by MANAGER and ADMIN (beside `device.manage` / `printer.manage` in
`packages/identity/src/permissions.ts`; permissions are never renamed once shipped).

**Top half: the providers list.** Each shipped, dashboard-configurable provider shows its state:
_not connected_, _connected as "&lt;merchant name&gt;"_, or _simulator active_ (demo/prepare). The
connect and disconnect controls are the only provider-specific UI here, and they are contributed by
the provider package (Section 3).

**Connecting** verifies before it seals:

- **SumUp:** the operator enters the API key; the affiliate app id and key are optional, behind a
  `wt-help-tooltip`. On save the server calls SumUp's memberships endpoint with that key, reads the
  merchant code from it, and returns the merchant name for confirmation. If the key spans more than
  one merchant, the screen asks which. Only then is the four-field `payments.sumup` credential
  sealed. A merchant without an affiliate key seals the literal `-` in both affiliate fields, exactly
  as the CLI path does today.
- **Stripe:** the existing four `payments.stripe` fields; the secret key verified by one read call
  (and the existing `sk_live_`/`sk_test_` environment-prefix guard in `stripe-account.ts`) before
  sealing.

**Disconnecting** deletes the credential and evicts the pool entry. It **refuses** if any active
`card_readers` row still belongs to that provider, with a message naming the count.

**This is the first dashboard route that writes a vault credential.** Constraints, each a §1/§5
risk trigger:

- The write route validates the payload shape with the same per-purpose field list the CLI uses
  (`validatePayload`, `packages/credentials/src/purposes.ts`), rejecting missing and extra fields.
- The route **never echoes a secret back**; the response carries only the merchant name (SumUp) or a
  bare success (Stripe). The screen thereafter shows "connected as &lt;name&gt;" and never a field
  value.
- `app_user` already holds INSERT/UPDATE/DELETE on `tenant_credentials`
  (`packages/credentials/drizzle/0001_credentials_baseline_sql.sql`), so **no grant change**.
- The credential purpose params carry no secret onto any log or the recovery page — the existing
  per-code discipline in `apps/server/src/errors.ts` is preserved; new codes below hold only ids and
  counts.

## Section 3 — each provider module owns its reader flow

SumUp and Stripe each fill a **new card-provider seat** (`CardProviderContribution`), assembled by
composition into a standalone `CARD_PROVIDERS` registry (see _Knock-on facts_ for why this is a
registry and not an `ALL_MODULES` membership). The seat is the single home for a provider's
specifics; generic code names no provider. This mirrors the existing fiscal-regime seam
(`scripts/module-seams.test.ts`) and the dashboard-module seam (`@waitron/dashboard-modules`).

### The seat (server side)

A `CardProviderContribution` declaring:

- `providerId` — `"sumup"` / `"stripe"`.
- `credentialPurpose` + its field list — for the generic connect form and `validatePayload`.
- `connect(payload)` — verify the typed credentials against the provider; return
  `{ merchantName }` (or the multi-merchant choice for SumUp) for confirmation before sealing.
- `build(sealed)` — construct the live `PaymentProvider` for the pool.
- `readers` — the reader operations the generic screen relays to:
  - `add(input)` — SumUp: post the pairing code, return the reader in `processing` and its id;
    Stripe: verify the reader id by one retrieve call.
  - `status(providerRef)` — SumUp: online/offline + connection type; Stripe: online/offline.
  - `remove(providerRef)` — SumUp: unpair at SumUp (which restores standalone use on that Solo);
    Stripe: no vendor call needed.

The generic Payments routes (`apps/server/src/payments-api.ts`, new) look up the contribution for the
`provider` named in the request and relay. The pool's `build`/evict live here too.

### The seat (dashboard side)

Each provider package contributes a UI piece for the generic Payments screen — its connect form and
its add-reader dialog, with their `en`/`es` strings — mounted the way `@waitron/dashboard-modules`
already mounts module screens.

- **SumUp add-reader dialog:** the on-device steps in plain words (**including that pairing switches
  off standalone use on that Solo**), a name field and the 8–9 character code field. Pressing _Pair_
  relays the code; the dialog then polls the reader every 2 s and shows a **countdown from five
  minutes** (the code's lifetime). It ends three ways: `paired` saves the row and closes; `expired`
  or a rejection shows plain text and offers _try again_; navigating away stops polling
  (`disconnectedCallback`, the printers-screen `#endScan` precedent). All pairing calls go through
  the server, so the API key never reaches the browser.
- **Stripe add-reader dialog:** one reader-id field, verified before the row is saved. Stripe's own
  device-code registration additionally needs a Stripe `Location` object; that ceremony is **out of
  this slice** (_Deferred_).

### The generic Payments screen owns the rest

The providers list, the readers **`wt-data-table`** (name, provider, live status, default-for
devices, a two-tap-armed retire), and the wiring between them. It knows only "connected providers"
and "readers". Adding Redsys later is one new package plus one line in the composition list.

### Knock-on facts

- **Providers are a standalone registry, not `ALL_MODULES` members** (refined at plan time). SumUp and
  Stripe own no tables, and `WaitronModule.migrations` is required, so rather than force empty
  migration sets onto adapter packages the card-provider seat is assembled into a standalone
  `CARD_PROVIDERS` list in `@waitron/composition` (server) and `CARD_PROVIDER_PANELS` in
  `@waitron/dashboard-modules` (browser) — the exact parallels of `ALL_MODULES` / `DASHBOARD_MODULES`.
  The `WaitronModule` descriptor is untouched; the `card_readers` / `device_card_readers` tables
  belong to the generic `payments` module, which already has a migration set. Adding Redsys later is
  one new package plus one line in `CARD_PROVIDERS`.
- **The seam test grows a rule:** `apps/server/src` reaches a provider package
  (`@waitron/payments-sumup`, `@waitron/payments-stripe`) only through the composition list — with a
  small, reason-carrying allowlist for the Stripe hosted-checkout and webhook code
  (`webhook.ts`, `stripe-account.ts`, `boot.ts`'s hosted wiring) that stays as it is today and moves
  behind the seat in a later slice. New provider-reaching code must go through the seat.

## Section 4 — routing a sale to a reader

- **Devices screen:** the two dropped columns become one **default-reader** dropdown, listing active
  readers by name with their provider; empty = cash and manual card only. Writes
  `device_card_readers`.
- **Pay path:** the `/api/pay` request may name a `readerId`; absent, the device's default applies
  (the device is already resolved per request via `requireSaleTillId`). The server checks the reader
  is this tenant's, is active, and its provider is connected, then takes the provider from the pool
  and hands it the reader's `provider_ref` through the existing `resolveReader` hook. **Every by-id
  read carries `eq(card_readers.tenantId, cfg.tenantId)`** — one-tenant-per-db is not the query's
  isolation boundary (CLAUDE.md §3, the till-reroute leak).
- **Manual card** is unchanged and names no reader (owner: standalone rows buy nothing).
- **Picker at payment time:** the till shows the default reader's name on the card button, with a
  _use a different reader_ control opening a picker of active readers and their status. **This picker
  is the component slice 2 reuses for the handheld link** — built generic here, session-link table
  and NFC/QR added in slice 2 with no reshaping.

## Section 5 — till boot payload and practice mode

`GET /api/till` today carries one provider string for the whole box. It becomes **per device**: the
default reader's provider and name (or none), plus the list of active readers for the picker. The
till's existing branches keyed on the provider string keep working because the string still arrives
(`apps/till/src/widgets/tender-pay.ts`).

Demo and Prepare keep forcing the `SimulatorPaymentProvider` exactly as now
(`buildCardProvider`'s intent gate). The Payments screen states that plainly at the top in those
modes and still lets a venue connect providers and add readers, so setup can be prepared before
go-live; routing ignores configured readers until the box is live or
`WAITRON_PAYMENT_TEST_PROVIDERS` is set. (This matches the node-onboarding spec: "A live system
refuses the simulator and test credentials.")

## Section 6 — errors, security, testing

**New error codes**, each with `en`+`es` text in `apps/dashboard/src/i18n/codes.ts` and named for the
domain concept, never the throwing package (CLAUDE.md §3):

- `reader.not_found`, `reader.provider_disconnected`
- `payment.pairing_expired`, `payment.pairing_refused`
- `payment.provider_credential_rejected` (connect-time verify failed)
- `payment.provider_in_use` (disconnect refused; params: `{ activeReaders: <count> }`)

None carries a secret in its params, so the recovery-page boundary holds
(`apps/server/src/recovery-surface.ts`).

**Testing** (CLAUDE.md §4):

- The **pool** proven by deletion: a save evicts, the next use rebuilds; a negative control shows a
  stale entry would otherwise serve old credentials.
- The **SumUp pairing dialog** driven with a fake clock through `processing → paired`, `→ expired`,
  and a rejection; prove the countdown and the stop-on-navigate by deletion.
- The **connect route** refusing a bad key via a `FakeSumUpClient`, and sealing only after the
  merchant-name confirmation; assert the response never contains a field value (`toEqual`, not
  `toMatchObject`, per §4).
- **Two-tenant isolation probe** on every by-id `card_readers` / `device_card_readers` read, run as
  `app_user` (rolsuper=f) on **real Postgres** (Testcontainers), because reading missed exactly this
  class in till-reroute and only a run-it probe caught it.
- **Migrations** covered by the root guards: `scripts/classification-complete.test.ts` (every new
  table classified once) and, since no `reject_mutation` trigger is added,
  `append-only-enable-always` is unaffected. Run the whole workspace after touching
  `packages/composition` (a value more than one suite asserts).
- **Seam** proven by a synthetic positive control (a server file importing a provider package
  outside the allowlist fails the test), per `module-seams`' existing pattern.

## Scope

**In this slice:**

- `card_readers`, `device_card_readers`, `payments.reader_id`; drop `devices.card_provider` /
  `card_reader_id`.
- The `CardProviderContribution` seat; SumUp and Stripe filling it; the standalone `CARD_PROVIDERS` /
  `CARD_PROVIDER_PANELS` registries and the seam-test rule.
- The generic Payments screen (providers list + readers `wt-data-table`), the provider-contributed
  connect forms and add-reader dialogs, `payments-api.ts`, `payments.manage`.
- The lazy provider pool; connect-time credential verification; the first dashboard credential-write
  route.
- Device default-reader dropdown; pay-path reader routing; per-device till boot payload; the reusable
  payment-time picker.
- SumUp client's five new calls (list, pair, get, status, delete).

**Deferred, each with a reason:**

- **Stripe `stripe_on_device` (Tap-to-Pay on the phone)** — reachable today only through the env
  `WAITRON_TILL_CARD_PROVIDER=stripe_on_device` selection this slice removes, and no venue uses it
  (env-only, nothing in production). The paying phone IS the reader, so it is not a `card_readers`
  row; restoring it means a per-device on-device MODE flag, a small follow-up. The till branch stays
  dormant until then.
- **The handheld-to-reader link (slice 2)** — NFC > QR > picker, session-scoped, drops on logout /
  idle-timeout / another handheld taking the reader. The picker built here is its UI seam. NFC may
  need no native app if the tag carries the same URL the QR does (iOS reads a URL tag from the lock
  screen; Chrome-Android reads it in-page) — an **experiment**, not a fact, to run on the owner's
  actual handhelds.
- **Redsys and bank terminals** — parked (owner, 2026-09-11). Research receipts, so nobody re-does
  them: Spain has three acquirer worlds and no single API.
  - _Redsys-processed banks_ (BBVA, Sabadell, Bankinter, Cajamar, Unicaja, …): the in-person product
    is **TPV-PC**; its "Implantado" mode captures the card from the pinpad and requires the pinpad
    and a vendor **library on the same machine** — serial `COM:,19200,N,8,1` or USB, a **32-bit
    Windows DLL** (`dllTpvpcLatente.dll` / `TpvPcImplantado.dll`), Redsys homologation, and three
    bank-issued credentials (merchant number, terminal number, signing key). A Java library for
    Mac/Linux is listed but unread (unverified). The box is Linux → this is a **separate
    payment-agent project** (print-agent shape), undesignable until the bank names its acquirer and
    mode.
    Sources: <https://redsys.es/en/pago-presencial>,
    <https://docs.globalpayments.es/docs/tpv-pc/tpv-pc-implantado/integracion-del-tpv-pc-implantado/>,
    <https://yuraksisa.com/tpv-pc-de-redsys/>, <https://www.clubdelphi.com/foros/showthread.php?t=93693>.
  - _Comercia Global Payments_ (CaixaBank): same TPV-PC stack **plus** a modern no-cable
    **InStore Payment REST API** — the till calls the terminal directly on the venue LAN by IP
    (`192.168.x.x:3000`), synchronous, sale + refund; Revo uses it with ITOS terminals, and it is
    **CaixaBank-only** ("No es posible realizar la integración con bancos distintos"). If the deli
    banks with CaixaBank this is far simpler than the DLL path (HTTP from the box, no cable, no
    vendor library, but reader-must-be-on-LAN, which the `provider_ref` + reach-declaration model
    below already anticipates).
    Sources: <https://docs.globalpayments.es/en/docs/pos-integrated-payments/payment-integrated-with-android-pos/instore-payment-rest-api/>,
    <https://support.revo.works/es/articles/611>.
  - _Getnet_ (Santander): Redsys-hosted docs, same TPV-PC Implantado; no terminal-level REST API
    found. Sources: <https://desarrolladores.santandertpv.es/>,
    <https://www.bancosantander.es/en/empresas/cobros-pagos/cobros/tpv/tpv-pc>.
  - **Bizum Pay** in shops (from 18 May 2026) is a **software update to the bank's terminal**, no
    merchant-side integration — from Waitron's view a payment method the terminal accepts on its own.
    Whether the integrated modes report a Bizum tender distinctly is unverified.
    Source: <https://www.mobileworldlive.com/spanish/bizum-llega-a-los-datafonos-pagos-por-nfc-en-comercios-espanoles-a-partir-del-18-de-mayo/>.
  - **Seam left for it:** a reader's `provider_ref` is already opaque (an IP + port, a serial path on
    an agent, or a cloud id all fit), and a later provider seat can declare whether it must be
    reached from **inside the venue network** so the dashboard warns when a cloud primary could not
    drive it.
- **The SumUp reconciler** and **webhook wiring** — unchanged from the provider spec (§6 there):
  polling is the floor; neither is launch work.
- **Stripe device-code reader registration** (needs a Stripe `Location`) — this slice registers a
  Stripe reader by an id pasted from the Stripe dashboard.
- **Multiple providers on ONE device** / per-tender provider routing — a device has one default
  reader here; the pool already holds several providers at once, so this is a routing question, not a
  credential one.

## Open questions folded into the plan

- The exact `CardProviderContribution` type and where it sits (`packages/module` vs a new
  `packages/card-provider` kit) — decided at plan time by which keeps `module-seams` cleanest; the
  fiscal `FiscalContribution` in `packages/module` is the precedent.
- Whether the till boot payload's active-readers list is filtered to the device's location — the
  owner said reader→location is optional and skippable, so **not** in this slice; the picker shows
  all active readers.

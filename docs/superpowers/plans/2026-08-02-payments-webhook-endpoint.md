# Design brief — the payments webhook HTTP endpoint

**Status:** research/design only. No code written. Every "required / only / cannot" below carries a
`file:line` receipt or is explicitly flagged as an assumption (per `CLAUDE.md` §1). Claims about
Stripe's own behaviour are marked ASSUMPTION because I could not exercise a live Stripe from here.

---

## 0. One-paragraph summary

The receiving half of Mode 3 (hosted Stripe Checkout) is built and unit-proven inside
`packages/payments` / `packages/payments-stripe`, but **nothing in a running process ever receives a
Stripe webhook** — there is no HTTP route, and `apps/server` today serves exactly one route,
`/health`. The novel problem is the ordering conflict the backlog names: signature verification needs
a **per-tenant** secret, and the tenant is only knowable from the (still-unverified) payload. The
recommendation is to resolve the tenant from a payload/route field, load **that tenant's**
`webhookSecret`, and only then verify — the signature stays the sole gate, so naming a tenant buys an
attacker nothing. The endpoint mounts on the existing Hono app and replays the already-tested
`orchestrate` flow. The one genuine blocker to end-to-end usefulness is unrelated to webhooks: the
`recordSale` hand-off needs working-order data (lines/till/series) that no table produces yet.

---

## 1. How webhook events are ingested today, and exactly what is missing

### What exists (verified from code)

- **The neutral async contract.** `AsyncPaymentProvider` (`packages/payments/src/provider.ts:183-192`)
  has two methods: `initiate(params)` and `verifyAndParse(payload, signature)`. `verifyAndParse`
  returns a verified, vendor-neutral `InboundSettlement` (`provider.ts:163-174`: `outcome:
  "settled" | "expired"`, `externalRef`, `amount`, `settledAt`) or `null` for an event we ignore, and
  **throws on a bad signature** (`provider.ts:189-191`).
- **The Stripe implementation.** `StripeHostedProvider.verifyAndParse`
  (`packages/payments-stripe/src/hosted-provider.ts:82-108`) delegates to
  `client.constructWebhookEvent(payload, signature)`, maps `checkout.session.completed → "settled"`
  and `checkout.session.expired → "expired"`, else `null`. The real client
  (`stripe-hosted-client.ts:51-60`) wraps `stripe.webhooks.constructEvent(payload, signature,
  config.webhookSecret)` and reads `event.data.object.id` as the session id (our `external_ref`).
- **The tenant-resolution seam** (added #26). `resolve_payment_tenant(provider, external_ref)` is a
  `SECURITY DEFINER` SQL function owned by a dedicated `NOLOGIN` role with a role-scoped permissive
  SELECT policy; it returns **only** `tenant_id` and nothing wider
  (`packages/payments/drizzle/0008_payments_webhook_resolver.sql:1-69`). Its TS wrapper
  `resolvePaymentTenant(db, provider, externalRef)` runs on a plain handle **outside any tenant scope**
  (`packages/payments/src/store.ts:479-495`). `EXECUTE` is granted to `app_user` only (`0008:68-69`).
- **The state transitions.** `settleInitiated` advances `initiated → captured`, state-guarded, returns
  the row or `null` (`store.ts:436-457`); `expireInitiated` advances `initiated → failed`
  (`store.ts:463-477`); `associatePaymentWithSale` is write-once (`store.ts` / barrel
  `index.ts:20`).
- **The orchestration, as a test capstone only.** `packages/payments/src/async.wiring.test.ts:85-118`
  defines `orchestrate(...)`: `verifyAndParse` → `resolvePaymentTenant` → `withTenant(tenant){
  settleInitiated + recordSale + associatePaymentWithSale }`, all in one transaction, and proves it is
  idempotent under redelivery (`:149-176`) and handles expiry (`:178-207`). Its header (`:28-32`) says
  in as many words that it "composes the REAL neutral pieces the way the (deferred) app-level webhook
  endpoint will — with no `apps/` layer."
- **The webhook secret already has a home.** `PURPOSES["payments.stripe"] = ["secretKey",
  "webhookSecret", "successUrl", "cancelUrl"]` (`packages/credentials/src/purposes.ts:16`). It is one
  encrypted credential row **per tenant**, read via `readCredential(db, ring, tenantId,
  "payments.stripe")` (`apps/server/src/credentials.ts:16-22`).

### What is missing (the HTTP boundary)

- **There is no HTTP route that receives a webhook.** The only HTTP framework in the tree is Hono, in
  exactly one file: `apps/server/src/health.ts:1`. `healthApp` mounts a single `GET /health`
  (`health.ts:254-261`), and its own comment states the intent: *"The ONLY route this cycle: … no
  webhook. The webhook cycle attaches to this app rather than creating a second one."*
  (`health.ts:252-253`). `boot.ts` serves that app via `@hono/node-server`'s `serve(...)`
  (`boot.ts:2, 143-149`).
- **No production caller of `initiate` or `verifyAndParse` exists.** Grep for `.initiate(` /
  `StripeHostedProvider` / `verifyAndParse` across `apps/` (excluding tests) returns nothing in the
  running server — only a dev script (`apps/server/scripts/record-one-sale.ts`) and the sandbox/wiring
  tests. So the *sending* half of Mode 3 (mint a Checkout Session from a till) has no production caller
  either; see §6, decision 5.
- **No app-level `orchestrate` function.** The composition lives only in the test file above; it must be
  lifted into shippable code (§3).
- **`apps/server` has never called `recordSale`.** The running server today does `drain` (AEAT
  submission) and `reconcile` only (`boot.ts:206-276`). The webhook would be the **first** production
  `recordSale` caller — which is where the real coupling bites (§6, decision 5).

---

## 2. Signature-verification vs tenant-resolution — recommendation and rejected alternatives

### The hard constraint that fixes the shape

The webhook signing secret is **per tenant**: it is a field of the per-tenant `payments.stripe`
credential (`purposes.ts:16`), and `tenant_credentials` is under FORCE ROW LEVEL SECURITY read only
inside `withTenant(tenantId)` (`apps/server/src/credentials.ts:7-22`;
`packages/credentials/src/store.ts:45-55` selects by `tenantId`). Therefore **you cannot read the
secret you need to verify with until you already know the tenant** — the chicken-and-egg the backlog
describes. The accounts are standalone (one Stripe account per merchant, "no Connect layer to carry
the scope" — `apps/server/src/stripe-account.ts:83-87`), which is *why* each tenant has its own secret
rather than one platform secret.

Note this also contradicts the capstone's *ordering*: `async.wiring.test.ts` calls `verifyAndParse`
**before** `resolvePaymentTenant`, which only works because `FakeAsyncProvider` has no real
per-tenant secret. In production the order must invert to resolve-then-verify — which is exactly what
`store.ts:482-483`'s own comment already says ("the app-level orchestrator calls this first, then
opens `withTenant`").

### Recommended approach: **per-tenant path selects the secret; signature is the gate**

Expose `POST /webhooks/stripe/:tenantId`. The `:tenantId` segment selects which tenant's
`webhookSecret` to load; the HMAC signature check is what actually authorises the request.

Flow:

1. Read the **raw request body bytes** and the `Stripe-Signature` header (ASSUMPTION: Stripe's
   `constructEvent` requires the exact received bytes — a re-serialised JSON body breaks the HMAC;
   this is standard Stripe-webhook behaviour but must be confirmed against Stripe's docs/sandbox).
   Hono exposes this via `c.req.text()` — do **not** put a JSON body parser in front of this route.
2. Take `tenantId` from the path. Treat it as **untrusted** until the signature verifies.
3. `readCredential(db, ring, tenantId, "payments.stripe")` → `webhookSecret`
   (`credentials.ts:16-22`). A missing/undecryptable credential throws a structured
   `credentials.*` code (`store.ts:37,62,77`) → map to HTTP 400/500 and log.
4. Construct a hosted client bound to that secret and call `verifyAndParse(rawBody, signature)`
   (`hosted-provider.ts:82-108`). On a bad signature it throws → **HTTP 400**, log
   `payment.webhook_signature_invalid` (§4). This is the gate: a caller who names a real tenant in the
   path but cannot produce a body signed by that tenant's secret gets nothing.
5. On a verified `null` (event type we ignore) → **HTTP 2xx**, no-op.
6. On a verified `InboundSettlement`, resolve/settle **scoped to the path tenant** and hand off (§3).
7. **Defence-in-depth cross-check:** after verifying, call `resolvePaymentTenant("stripe",
   event.externalRef)` (`store.ts:486-495`) and assert it equals the path `tenantId`. A mismatch means
   a tenant mis-configured their Stripe endpoint to point at another tenant's path — refuse
   (`payment.webhook_tenant_mismatch`, §4) rather than settle a row across the tenant boundary. This
   keeps the #26 seam load-bearing even though the path already names the tenant.

Why this is the safest option:

- **The signature is unambiguously the sole gate.** Path is attacker-controllable, so nothing acts on
  it until the tenant's real secret verifies the bytes. This is the property the backlog worries about,
  made explicit.
- **No untrusted JSON is parsed before verification.** The alternative (below) must `JSON.parse` an
  attacker-supplied body just to find the session id; this option never does.
- **Tenant selection is O(1)** from the path, and matches the operational reality that each tenant
  already provisions their own Stripe account and therefore their own endpoint URL + endpoint secret.
- It reuses the exact per-tenant resolver pattern already in the tree
  (`stripeAccountResolver`, `stripe-account.ts:90-103`).

### Rejected / alternative options (honestly)

- **A single platform endpoint + one platform signing secret (Stripe Connect style).** Verify first
  with one secret, then read the tenant from the verified event's `account` field. This is the *only*
  option that preserves the capstone's verify-then-resolve ordering, and it is genuinely cleaner —
  **but it requires a Stripe Connect topology the code does not have.** Today the design is explicitly
  standalone-account-per-merchant with no Connect layer (`stripe-account.ts:83-87`), and each tenant
  carries its own `secretKey` (`purposes.ts:16`). Adopting a platform secret is a payments
  re-architecture, not a webhook endpoint. Flag for the owner (§6, decision 1) but do not assume it.

- **Single endpoint, resolve tenant from the UNVERIFIED payload** (the seam's originally-imagined use).
  `POST /webhooks/stripe`; `JSON.parse` the raw body, read `data.object.id` as the candidate
  `external_ref`, `resolvePaymentTenant("stripe", id)` → tenant, load that tenant's secret, verify,
  then re-read the id from the **verified** event for the actual settle. Safe in the same way
  (signature still gates; a forged id at worst resolves to a tenant whose secret then fails to verify),
  and it needs only one endpoint URL. Rejected as the primary because: (a) it must parse
  attacker-controlled JSON before any authentication; (b) a bogus-but-well-formed request costs a
  `resolve_payment_tenant` SELECT and, on a lucky guess, a credential **decrypt** per request — a
  mild DoS lever the path option avoids (session ids are high-entropy `cs_..` strings, so the practical
  risk is low, but it is non-zero); (c) it does not actually save the per-tenant-secret selection work,
  it only moves it from the path to the payload. It remains a perfectly acceptable fallback and is the
  option to pick if the owner wants exactly one externally-published URL.

- **Per-tenant path but skip `resolve_payment_tenant` entirely.** Viable, but leaving the #26 seam
  unused throws away a cheap cross-tenant misconfiguration check. Keep it as step 7 above.

---

## 3. Where the endpoint lives, request handling, idempotency, hand-off

### Route and composition

- **Route:** add `POST /webhooks/stripe/:tenantId` to the Hono app. Because `health.ts:252-253`
  already declares that the webhook attaches to this app, the cleanest shape is to widen `healthApp`
  into an app builder (e.g. `httpApp(healthState, webhookDeps, now)`) that mounts both `/health` and
  the webhook, or add a `apps/server/src/webhook.ts` that registers the route on the Hono instance
  `boot.ts` builds. `boot.ts:143-149` is the single wiring site.
- **Deps injected at boot** (mirrors how the reconciler is wired at `boot.ts:122-131`): `db`, `ring`,
  `environment`, `makeStripe`, a `TrustedClock` (`systemClock()` — the same one
  `record-one-sale.ts:146` uses), and a fiscal-backend factory (`VerifactuBackend` from
  `@waitron/fiscal-verifactu`, per `record-one-sale.ts:147-170`).
- **The orchestrator** (lift `async.wiring.test.ts`'s `orchestrate` into shippable code): the natural
  home is `apps/server`, because that is "the one place the real implementations meet"
  (`boot.ts:54-56`) — it is where `@waitron/core` (`recordSale`), `@waitron/fiscal-verifactu`
  (`VerifactuBackend`) and `@waitron/payments` (the store) all already dependencies
  (`apps/server/package.json`). Everything it needs is on the public barrels:
  `resolvePaymentTenant`, `settleInitiated`, `expireInitiated`, `associatePaymentWithSale`,
  `getPaymentByRef` are all exported from `@waitron/payments` (`packages/payments/src/index.ts:18-44`),
  and `StripeHostedProvider` / `stripeHostedClient` from `@waitron/payments-stripe`
  (`payments-stripe/src/index.ts:13,15`).

### Request handling / status-code contract (ASSUMPTIONS about Stripe retry semantics — confirm)

Stripe retries any non-2xx delivery with backoff (ASSUMPTION — standard Stripe behaviour, confirm in
docs/sandbox). Map outcomes so retries help rather than hurt:

- **2xx** — verified-and-processed, verified-and-ignored (`null` event type), redelivery no-op, and
  **unknown session** (`resolvePaymentTenant` / `settleInitiated` returns `null`: not our row, or a
  crash-orphaned session that `reconcile`'s `missing_local` class audits — `store.ts:483-484`). Return
  a uniform empty 2xx for all no-ops so there is no existence oracle.
- **400** — signature verification failed, or the tenant cross-check (step 7) disagreed, or the body
  could not be read at all. These are misconfiguration/abuse, not transient; a retry will not fix them.
- **5xx** — genuinely transient (DB unavailable, `recordSale` threw on infrastructure) so Stripe
  retries and the pending settle is not lost.

### Idempotency (Stripe delivers at-least-once — ASSUMPTION, confirm)

**Already handled at the store layer; the endpoint must simply be a faithful caller.**
`settleInitiated` only advances a row still in `initiated` and returns `null` otherwise
(`store.ts:445-457`); the orchestrator treats `null` as "redelivery — already chained; do nothing"
(`async.wiring.test.ts:108`). The capstone proves a redelivered webhook chains **no** second sale
(`async.wiring.test.ts:149-176`, asserting exactly one `sales` row) and that the invoice number is
never re-minted. So no HTTP-level dedup table is required for correctness. An optional
processed-event-id log (keyed on Stripe's `event.id`) would help observability but is not needed to
be correct — note it, do not gold-plate it.

### Fiscal-invariant check (`CLAUDE.md` §5)

The webhook's `recordSale` step chains the invoice **locally** (append to `registros_facturacion`);
it does **not** call AEAT — that stays the outbox `drain` (`record-one-sale.ts:11` header;
`boot.ts:214-246`). So this path does not violate "fiscal submission is an outbox, never inline." And
it does not "block a sale": the customer already paid out-of-band on the hosted page, so the webhook
is settling an already-collected payment, not gating a till.

---

## 4. Error codes

**Convention (verified):** codes name the DOMAIN CONCEPT, lowercase, dot-namespaced, and the payments
domain uses the **singular** `payment.*`. The twelve siblings in
`packages/payments/src/errors.ts:42-143` are all `payment.` (`not_found`, `refund_exceeds_capture`,
`not_voidable`, `not_refundable`, `already_associated`, `offline_forward_declined`,
`reconcile_unsettled`, `reconcile_lost_settlement`, `reconcile_orphan`, `reconcile_missing_local`,
`reconcile_drift`, `reconcile_remediation_failed`), and `apps/server/src/errors.ts:124` adds a
thirteenth, `payment.credential_environment_mismatch`, in the app layer — so a webhook code may live in
`apps/server/errors.ts` too. The `payments.stripe` occurrences (`purposes.ts:16`, `boot.ts:261`) are
credential **purpose** keys, **not** error codes — do not model a new code on them. `server.*` is
reserved for facts about the process itself (`apps/server/src/errors.ts:6-9`), so a *signature*
failure is `payment.*` (a fact about a payment event), not `server.*`.

**Proposed new codes** (all `payment.webhook_*`, matching the singular-domain convention;
they belong wherever the endpoint throws/logs them — likely `apps/server/errors.ts`):

- `payment.webhook_signature_invalid` — `{ tenantId }`. Verification threw. Logged + HTTP 400. Never
  carry the signature, the body, or the secret (same no-leak discipline as
  `server.credential_unusable`, `errors.ts:41-48`).
- `payment.webhook_tenant_mismatch` — `{ pathTenantId, resolvedTenantId, externalRef }`. Step-7
  cross-check disagreed. HTTP 400.
- `payment.webhook_unresolved` — `{ provider, externalRef }`. Verified event but no local
  `initiated` row / no tenant (the 2xx no-op path). Log-only (not thrown-and-caught); the code is the
  structured log field. Note the distinction from a thrown code so a reader does not expect a `catch`.

Introducing a code is cheap now and permanent after ship (`CLAUDE.md` §3: codes are never renamed).
Keep the set minimal — do not pre-invent codes for branches that only ever log.

Existing codes the endpoint will surface unchanged (map to HTTP, do not re-wrap): `credentials.missing`
/ `credentials.decrypt_failed` / `credentials.key_version_unknown` (`credentials/src/store.ts:37,62,77`)
and `payment.credential_environment_mismatch` (`stripe-account.ts:73`) if the secret-key environment
guard is reused on this path.

---

## 5. TDD implementation plan (ordered, failing-test-first)

Touches `apps/server` primarily; **no new migration** is needed — the resolver seam and the
`payments.stripe` credential fields already exist (`0008_payments_webhook_resolver.sql`,
`purposes.ts:16`), so this does **not** collide with the fiscal-sequence `packages/db` journal nor
with other `packages/payments` migration work. If a per-tenant provider construction shape is chosen
that needs a new type export from `packages/payments-stripe`, that is a code change, not a migration.

1. **Lift `orchestrate` into shippable code (red→green).** Port `async.wiring.test.ts:85-118` into an
   `apps/server` module with the FakeAsyncProvider first (fastest target), asserting the same three
   behaviours: settle+chain+associate atomically, redelivery chains no second sale, expiry →
   `failed`. This is a refactor of proven behaviour — preserve the assertions verbatim (global
   instruction: don't rewrite tests to match new code).
2. **Route wiring on Hono (red→green).** Add `POST /webhooks/stripe/:tenantId`; assert: raw body is
   read via `c.req.text()` (a JSON-parser-in-front test that fails HMAC is the negative control);
   good signature → 2xx and the orchestrator ran; bad signature → 400 and nothing settled; unknown
   session → 2xx no-op; DB error → 5xx. Prove the health route still works on the same app.
3. **Per-tenant secret selection (red→green).** Assert the secret comes from `readCredential(…,
   "payments.stripe")` for the **path** tenant, and that two tenants with different secrets each verify
   only their own signed body (cross-secret body → 400). This is the core security property — prove it
   by construction, and prove the guard by deletion (`CLAUDE.md` §4: remove the secret-selection, watch
   a cross-tenant body wrongly verify).
4. **Step-7 tenant cross-check (red→green).** A body validly signed by tenant A's secret but posted to
   tenant B's path (only reachable if B's secret == A's, i.e. misconfiguration) → assert
   `payment.webhook_tenant_mismatch` + 400. If the path already guarantees the tenant, this test
   documents/pins the defence-in-depth; keep it.
5. **Real-Postgres RLS test (Testcontainers, non-superuser role).** The whole point of the #26 seam is
   behaviour under the deployment role — PGlite is a superuser and cannot show it (`CLAUDE.md` §4).
   Assert, as the app role: `resolve_payment_tenant` crosses exactly one tenant and returns only
   `tenant_id`; the settle+chain runs under `withTenant`; a redelivery is idempotent. Requires
   `TESTCONTAINERS_RYUK_DISABLED=true` locally (`CLAUDE.md` §4).
6. **Error codes + registry reachability.** Add the `payment.webhook_*` codes to `apps/server/errors.ts`
   with `import "./errors.js"` at the throwing site (`CLAUDE.md` §3). Run the package **unfiltered**
   (`CLAUDE.md` §2/§4: cross-cutting guard suites — english-only, schema-ownership — don't load under a
   name-filtered run).
7. **Gate:** `pnpm --filter @waitron/... test:coverage` (not plain `test`), plus the four-command gate.
   Coverage thresholds are 98/98/98/95 (`CLAUDE.md` §2).

**Note the coupling that step 1 exposes:** in production `recordSale` needs a full `RecordSaleInput`
— `tillId`, `seriesId`, `lines`, `total`, `locale` (`record-one-sale.ts:172-199`). The hosted
`initiate` only stored `working_order_id` + `amount` (`hosted-provider.ts:47-79`), and **there is no
working-orders table to read the lines/till/series back from** — `sales` carries no FK onto
`working_orders` and nothing produces them yet (`record-one-sale.ts:176-179`; backlog "Not started",
sub-project 7). So step 1 can be built and fully tested with a fixture/fake working-order source, but
the **production** `recordSale` hand-off is blocked on the working-order/till model (and the
server-as-SIF `server_id` rekey that re-keys series/chain). See §6, decision 5.

---

## 6. Open decisions for the owner

1. **Endpoint topology — per-tenant path vs single endpoint vs platform/Connect secret.**
   Recommendation: per-tenant path (`/webhooks/stripe/:tenantId`), because the accounts are
   standalone-per-merchant with per-tenant secrets (`stripe-account.ts:83-87`, `purposes.ts:16`). A
   single platform secret would be cleaner but needs a Stripe **Connect** re-architecture the code does
   not have. Decide before building the route.

2. **Webhook secret provisioning.** The `webhookSecret` field already exists in the `payments.stripe`
   purpose (`purposes.ts:16`) but nothing sets it for a real venue (backlog: "Stripe is unprovisioned
   for the deli"). Each tenant's Stripe endpoint secret is generated **when the endpoint URL is created
   in that tenant's Stripe dashboard** — which, with per-tenant paths, is a per-tenant URL. Confirm the
   provisioning runbook: create endpoint → capture signing secret → `putCredential`.

3. **Public reachability + TLS.** `WAITRON_HTTP_HOST` defaults to `127.0.0.1` and `WAITRON_HTTP_PORT`
   to `8080` (`apps/server/src/config.ts:60-61,201`), i.e. **not reachable by Stripe as shipped**. The
   deployment needs a public HTTPS ingress / reverse proxy in front (Stripe requires HTTPS — ASSUMPTION,
   confirm). Decide the ingress shape; it also bears on which host binds the route in active-active.

4. **HTTP status contract for no-ops.** Confirm the intended 2xx-for-unknown-session behaviour (ack and
   let `reconcile` backstop the missing-local case) vs. some other signalling. Recommended: uniform
   empty 2xx for all no-ops.

5. **Sequencing vs the till / working-orders model (the real blocker).** The verify/resolve/idempotency
   machinery is independently valuable and fully testable now, but the production `recordSale`
   hand-off needs working-order data no table produces yet, and no code initiates hosted sessions in
   production either (§1, §5). Decide: (a) build the full endpoint now against a test working-order
   source and accept it is dormant until the till lands; or (b) build only verify+resolve+settle now
   and add `recordSale`+associate when working-orders + the `server_id` rekey exist. This is the
   decision that determines how much of the cycle lands now.

6. **Does this need the sync design's "payments fast lane"?** No dependency exists to build the
   endpoint: the fast lane is a *replication cadence* between servers
   (`docs/superpowers/specs/2026-08-02-app-level-sync-design.md:527-530`), and the endpoint just writes
   the local `payments`/`sales` rows the sync layer later propagates. The real interaction is
   **single-writer**: the webhook is a writer, so under active-active it must land on (or route to) the
   tenant's current primary/SIF server — the same "one primary" invariant #33 already owns. Flag so the
   endpoint is built single-writer-friendly, but it does not block on the sync layer.

7. **New `payment.webhook_*` error codes (§4)** — approve the minimal set
   (`_signature_invalid`, `_tenant_mismatch`, `_unresolved`) before shipping, since codes are permanent
   once shipped (`CLAUDE.md` §3).

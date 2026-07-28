# Kickoff handoff — Mode 3 (asynchronous / hosted payments): where to start

**Date:** 2026-07-24
**Type:** *Forward-looking* kickoff (Mode 3 is **not designed or built yet**) — a starting brief so a fresh session can begin Mode 3's brainstorm cold. It frames the mode, gathers the deferred work that finally lands here, and lists the open design questions **to resolve in the brainstorm** (it does NOT pre-decide them).
**Main at handoff:** `5dc20a2` (Mode 2b Cycle B, #25). All prior payment modes landed: 4a seam (#20) · Mode 1 manual (#21) · Mode 2a Stripe Terminal (#22) · Mode 2b Cycle A offline (#23) · Mode 2b Cycle B on-device (#25).

> **Before starting: run `superpowers:brainstorming` first** (per the repo workflow). This doc is input to that brainstorm, not a substitute for it. Then revise the umbrella design (new "Mode 3" section + §10 status), `superpowers:writing-plans`, SDD, `/finish-branch`, `/land-branch` — the exact cycle that shipped #21–#25.

---

## What Mode 3 is

The **third settlement mode** in the capture-mode taxonomy (design §0, `docs/superpowers/specs/2026-07-22-payment-layer-design.md:73-107`). The customer pays **out-of-band** — a **QR at the table, a payment link, or an online order** — and the settled tender is **written later by a webhook, not returned synchronously**.

This is a **different method shape**, not another `PaymentProvider` adapter (§0 line 86-88, §10 item 4 line 549-550):

- Synchronous modes (2a/2b): `collect(): Promise<PaymentResult>` — the tender comes **back** in the return value, and the till composes `recordSale` right after.
- Mode 3: `initiate(params) → { ref, url/qr }` mints a hosted payment (link/QR/intent) and returns a URL/QR for the customer; **a webhook later produces and associates the settled tender**. Core sees the same universal join — a settled tender flowing into `recordSale` — but it arrives asynchronously, driven by an inbound event, not a staff tap.

**The load-bearing shift to work out in the brainstorm:** in every mode so far, a synchronous till action produces the settled tender and *then* chains the sale. In Mode 3 the tender is written by a webhook at an unknown later time — so **what triggers `recordSale`, and when does the sale chain?** The working order stays open until the webhook settles the tender; the webhook (not a till action) is what advances it. That ordering is the crux of the design.

## What deferred work finally lands here

Two things were deliberately deferred through 2a/2b **to Mode 3 / reconcile** (design lines 529-531, 697-701, 1022; memory `payment-layer-4b-followups`):

1. **Webhooks + async events.** An inbound HTTP event from the PSP (payment succeeded, refund confirmed, dispute). Signature verification, at-least-once delivery → **idempotent** handling, and the write path that turns an event into a settled tender + associates it.
2. **Untenanted tenant-resolution.** A webhook arrives with **no tenant context** (it's an inbound call, RLS-exempt). It must resolve the tenant from **`(provider, external_ref)`** (the payment-link / PaymentIntent id) — which needs an **RLS-exempt resolver + an index on `(provider, external_ref)`**. The neutral store already has the untenanted `findPaymentByRef(provider, ref)` (returns nothing under RLS with no tenant GUC — see its doc comment in `packages/payments/src/store.ts`); the webhook path is the genuine untenanted case it was built for.

Mode 3 is also intertwined with **`reconcile()` (the old "4d")**: a missed/late webhook is exactly what reconcile backstops (the `unsettled` / `missingLocal` mismatch classes, design §6). Decide in the brainstorm whether Mode 3 pulls reconcile in or leans on it as a follow-up.

## Open design questions for the brainstorm (resolve these; don't assume)

1. **Slice it?** Mode 3 is a large new surface (a distinct interface + webhooks + untenanted resolution + the async orchestration). Prior modes sliced **neutral-then-adapter** (4a→2a; Cycle A→B). A natural Mode 3 slice: **(A)** the neutral async interface + the webhook→tender→associate→chain path + untenanted resolution + idempotency, proven with a fake; **(B)** the real Stripe async adapter (Payment Links / Checkout Sessions). Decide first.
2. **The neutral async interface.** What is it and where does it live? `initiate()` + a webhook-handler seam in `@waitron/payments` (neutral, no vendor vocab), with the Stripe adapter in `@waitron/payments-stripe`. What does `initiate` take/return; what's the neutral "handle an inbound settlement event" shape.
3. **Sale-chaining ordering.** Confirmed the crux: the working order stays open; the webhook settles the tender and triggers `recordSale`. Where does that composition live (an `apps/*` webhook endpoint calling into the payments + core layers, like the till orchestration is SP7)? What's in-scope for the payments layer vs. deferred to the app.
4. **Untenanted resolution + index.** The `(provider, external_ref)` unique index (idempotency anchor) + the RLS-exempt resolver. How does the webhook path safely bypass RLS to find the tenant, then re-enter a tenant-scoped transaction to write? (Mirror how the fiscal layer handles any untenanted path.)
5. **Idempotency.** Webhooks are at-least-once → the same event may arrive twice. State-guarded writes + the `(provider, external_ref)` unique are the tools (same discipline as `settleForwarded`'s state guard and the fiscal error-3000 idempotency).
6. **Which Stripe surface first.** Payment Links vs. Checkout Sessions vs. hosted PaymentIntents + QR. QR-pay-at-table vs. payment-link vs. online-order are three product flows — scope which one Mode 3 builds first.
7. **Webhook endpoint = `apps/*`.** The actual inbound HTTP endpoint + signature-secret provisioning is a deployment concern (like the `forward`/`reconcile` scheduler and per-tenant Stripe provisioning — deferred throughout). Decide the seam between the payments-layer webhook *handler* and the app-level *endpoint*.
8. **Reconcile relationship.** In-scope now, or the designed backstop for a later reconcile plan?

## Precedents to mirror

- **`packages/payments-stripe`** — the adapter package (2a server-driven + 2b on-device; injected client seams + fakes + coverage-excluded real bindings + nightly sandbox). The Stripe async adapter is a third provider class / seam here.
- **`fiscal-verifactu`** — adapter raising incidents; `drain`/`reconcile`; the idempotent, T1/T2 discipline. Mode 3's webhook idempotency + reconcile-backstop mirror it.
- **The neutral store** (`packages/payments/src/store.ts`) — `findPaymentByRef` (the untenanted lookup, built for exactly this), the `external_ref` column, `associatePaymentWithSale` (Option B), the `payments` lifecycle + `payment_state` enum. Mode 3 likely adds new states (`initiated`/`pending` for a minted-but-unpaid link) — brainstorm the enum additions.
- **`STRIPE_SANDBOX_SECRET_KEY`** is now set — the nightly sandbox can exercise real Stripe async surfaces (payment link / checkout creation) server-side, self-skipping in per-PR CI (the `*.sandbox.test.ts` pattern).

## Carry the process lessons (from #21–#25; full detail in `payment-layer-4b-followups` memory)

- **A table-wide unique index conflicts with any "N distinct same-key rows" caller** — before adding one (e.g. a `(provider, external_ref)` unique), grep every writer. The whole-branch review caught this in #25; run it on cross-cutting changes.
- **Transient CI Docker outage** (`REQUIRE_DOCKER=1`, daemon absent → real-PG tests throw): `gh run rerun <id> --failed`. Not a code issue.
- **Coverage is CI-only** (not the pre-push hook); run `pnpm --filter <pkg> test:coverage` locally, and let one task own the coverage run. **`format:check` (prettier) is a separate gate from `lint`.** **Copilot COMMENTED reviews don't block; resolve trivial threads with a reply, not a push.**
- Real SDK bindings / `testing/**` / `*.sandbox.test.ts` / barrels are coverage-excluded; the neutral `@waitron/payments` bans vendor vocabulary (a webhook seam must stay generic there — the Stripe webhook specifics live in `payments-stripe`).

## Pointers

- **Umbrella design:** `docs/superpowers/specs/2026-07-22-payment-layer-design.md` — §0 taxonomy (async mode: lines 73-107), §6 reconcile mismatch classes, §10 sequence (Mode 3 = item 4, line 549), and the deferred-webhooks notes (lines 529-531, 697-701).
- **The two prior full cycles to mirror the SDD shape:** plans `docs/superpowers/plans/2026-07-23-payment-mode-2b-cycle-a-offline-layer.md` and `docs/superpowers/plans/2026-07-24-payment-mode-2b-cycle-b-on-device-stripe.md`.
- **Prior handoff (what just landed):** `docs/handoffs/2026-07-24-payment-mode-2b-cycle-b-landed-next-mode-3-or-reconcile.md`.
- **Memory to read first:** `payment-layer-4b-followups` (state + deferred items + all CI/coverage lessons), `currency-and-localisation-requirements`, `verifactu-mode-separate-modules`.

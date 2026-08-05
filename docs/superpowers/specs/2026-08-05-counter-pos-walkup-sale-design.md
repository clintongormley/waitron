# Counter POS — walk-up cash sale (sub-project 7, slice 1) — design

**Date:** 2026-08-05. **Sub-project:** 7 (Counter POS UI), first slice. **Status:** designed, awaiting
plan.

This is the **first thing a person can operate**. Fourteen packages and a server exist; the whole
sale pipeline — catalogue → priced basket → chained, filed fiscal record — is built and headless
(`apps/server/scripts/catalogue-demo.ts` runs it end to end). Nothing yet consumes `@waitron/ui`;
there is no `apps/till`. This slice builds the human-operable front: a logged-in operator rings up a
cash sale and gets a legally-correct ticket, and **no fiscal machinery is reimplemented** — the till
is a face on proven code.

---

## 1. Scope

**Slice 1 = the walk-up cash sale (7a).** An operator unlocks the till (staff picker → PIN), rings up
products (weighed items entered by keypad), takes cash and gives change, the sale **files with AEAT**
in the same transaction, and a **compliant ticket + QR** displays. A **Logout** ends the session; an
unfinished basket **stays on the till** for the next person.

This slice is the thinnest thing that proves the whole seam — screen → server → domain → fiscal chain
→ ticket — exactly once, on a foundation the later slices extend without a rewrite.

### The #7 roadmap this sits in

| Slice | What | State |
| --- | --- | --- |
| **7a** | **Walk-up cash sale** (this spec) | designed |
| 7b | **Park & retrieve** open orders (persist working orders, named held list) | future |
| 7c | **Prepare & collect** (send-to-kitchen states, call the customer, pay-on-order vs pay-on-collect) + the **working-order amendment log** | future |
| — | Card/Terminal tender · offline-first store-and-forward · scale + printer hardware · refunds/voids/corrections UI · the layout & receipt **editors** · multi-till-per-server | future |

The unifying concept across 7a–7c is the **working order** (§4). Slice 1 keeps it as in-browser state;
7b is the first to persist it.

### Explicitly out of slice 1

Card tender, offline-first, hardware (scale, printer, cash drawer), refunds/voids/corrections screens,
the working-order **amendment log** (only bites once an order is amended *after* it is placed — 7b/7c),
tabs/table service, the layout and receipt **editors**, and one-server-serves-many-tills. Each has a
named home above.

---

## 2. Architecture — how the browser reaches the domain

The domain functions (`recordSale`, `listAvailableProducts`, `authorize`, …) each take a live Postgres
`tx` running as the restricted `app_user` role under `withTenant`. A browser cannot hold that, and the
established topology already answers where it lives:

- **server-as-SIF (#33):** the shop's local server holds the database, the certificate and the
  submitter; tills are **clients** on the LAN.
- **deployment (#9):** the same codebase must run both standalone-local and multi-tenant-cloud.

A browser till talking to a server API satisfies both with one codebase; an embedded-database desktop
app would put DB access on every till device and needs a separate cloud story. **Decision: browser
till + server HTTPS API.**

- **`apps/till`** — a new Lit single-page app (the same toolkit as `@waitron/ui`, whose primitives it is
  the first consumer of), built with Vite. Served by the local server.
- **`apps/server`** grows a **small HTTPS/JSON API (TLS)**. Each endpoint opens `withTenant(db, tenantId, tx
  => { await asAppUser(tx); … })` and calls the existing domain function, then returns JSON. RLS and
  every fiscal invariant stay server-side; the browser holds no DB credentials.
- **The server is the price authority.** The browser builds a basket of `{ productId, quantity }` and
  previews the total using the *same* pure pricing (`priceBasket`, shipped in `@waitron/catalogue`,
  runnable in the browser). At pay time it POSTs the basket lines; the server **re-reads the catalogue
  and re-prices authoritatively** before `recordSale`. A total computed by the browser is never
  trusted or filed.
- **The server already knows which till it is.** Provisioning (#57) stood up tenant → location → till →
  node → standard series; the local server is configured for that venue, so the API resolves
  `tenantId / tillId / nodeId / seriesId` from server configuration, not from the browser. **One server
  = one till in slice 1;** multi-till-per-server is deferred.

### Transport security

**The till talks to the server over HTTPS (TLS), never plain HTTP — even on the LAN.** A PIN and a
session cookie cross the wire; TLS is the floor for that. The local server therefore needs a TLS
certificate the till devices trust. Because the LAN has no public DNS or internet-facing endpoint, this
is a **local-CA / self-signed** story (a local CA trusted on each till, or an equivalent) that must work
**offline** — no OCSP/CRL round-trip at connect time — and it is **distinct from the AEAT signing
certificate** the server already holds for fiscal submission. How the local TLS cert is issued, trusted
and rotated is a plan/deployment detail (§14) and also belongs to sub-project 9 (Deployment).

### Trust boundary

The browser is untrusted. The server authenticates every request against an **open session** (§6),
re-prices every basket, and enforces authorization (`authorize`) for any gated action server-side. The
browser's job is presentation and input; the server's job is truth.

---

## 3. The widget foundation (the configurable-till vision — the seam, not the editor)

The till is a **dashboard of movable blocks**, not a fixed screen (owner intent, 2026-08-05). Slice 1
ships those blocks locked into one arrangement (layout A), but builds them as widgets **from the
start**, so the drag-and-drop editor, add/remove, per-widget settings and custom themes become
**plug-in later slices, not a rewrite**.

- **The shell** renders a **layout definition** — plain data: an ordered list of widget instances, each
  `{ type, position, config }`. Slice 1 hardcodes the default (layout A); the *format* is what matters.
- **Per-widget config.** Each instance carries its own settings blob whose shape depends on the widget
  `type` (e.g. the product-grid's "which category tabs / how many columns"). Slice 1 uses sensible
  defaults; the screens to *edit* config come with the editor.
- **Widgets coordinate through shared state + events — never direct references.** No widget holds a
  handle to another. They read from, and dispatch actions against, a shared **working-order store**
  (§4), and subscribe to a small event channel (`product-selected`, `sale-settled`, …). This is the
  mechanism that lets a widget be moved, removed, or added without touching its neighbours — and it is
  what makes a future **product-detail widget** work (tapping a product publishes `product-selected`; a
  detail widget reacts). *Correction to an earlier framing: widgets do communicate — they just never
  reference each other directly.*
- **Slice-1 widgets:** `product-grid`, `basket`, `total`, `tender/pay`. (Login is a separate lock
  screen, not a widget.)

**Deferred:** the layout editor (drag/drop, add/remove), per-widget settings UI, saved/named layouts,
custom CSS.

---

## 4. The working order — the unifying concept

The thing on the till is a **working order**, and its life story is what later slices extend: build →
(park/retrieve) → (send-to-kitchen → prepare → ready → collect) → pay → filed. The architecture design
already earmarked this: *"the Counter POS owns working-order mutation — nothing writes working orders
yet."*

- **In slice 1 the working order is in-browser state only.** A basket of `{ productId, quantity }`
  lines plus its computed preview. It **survives logout** (belongs to the till, not the person) and is
  cleared by "New sale" or by the next operator.
- **Slice 1 writes nothing to `working_orders`.** Verified: `recordSale` accepts a `workingOrderId` but
  there is **no enforced FK from `sales` to `working_orders`** (only `working_order_lines →
  working_orders` and `working_orders → tenants/tills/nodes` exist), and `catalogue-demo.ts` files a
  sale with a freshly-generated `randomUUID()` and no `working_orders` row. So slice 1 **generates a
  `workingOrderId` at pay time** and passes it through; **persisting** working orders (a `working_orders`
  row + lines) is 7b's first job.
- **Operator of record = whoever confirms payment.** Because the basket survives a login change and no
  record exists until pay, the `operatorId` on the filed sale is the session that hit "Confirm payment".

**Legal note carried forward:** the append-only **working-order amendment log** (art. 29.2.j LGT — flagged
*probable but unconfirmed* by the architecture design and Q14) becomes relevant only when an order can
be **amended after it is placed** (7b/7c). A slice-1 walk-up order is built and paid atomically and is
never amended after placing, so the log is out of scope here — but keeping the working order's shape
clean now is why it is called out.

---

## 5. The flow

1. **Lock screen** → staff picker: the till lists the venue's **active staff** (§6). Tap a name.
2. **PIN pad** → `loginWithPin` opens a `Session` on `(tenant, till)`.
3. **Counter screen** (layout A): tap products to add lines; a **weighed** product opens a **kg keypad**
   before adding (the measured weight becomes the line `quantity`). The **basket** and **total** update
   live from the browser-side `priceBasket` preview.
4. **Pay** → **cash screen**: enter amount tendered (keypad + quick-cash buttons), see **change due**.
5. **Confirm payment** → the browser POSTs the basket + tender; the server re-prices, calls `recordSale`
   with `settlement: { kind: "immediate", tenders: [{ method: "cash", amount, tipAmount: "0.00",
   settledAt }] }` inside one `withTenant`/`asAppUser` transaction; the sale **chains and files**.
6. **Ticket** (§7) displays with the QR. **New sale** clears the working order.

(UI copy above is the **English base**; for the deli it renders in Spanish — *Pay → Cobrar*,
*Confirm payment → Confirmar cobro*, *New sale → Nueva venta* — through the i18n layer in §9.)
7. **Logout** (a control in the header) → `endSession` → back to the lock screen. Any unfinished basket
   **stays** on the till.

**No tip in slice 1** (the deli counter has no tipping flow yet; `tipAmount` is `"0.00"`). Cash only.

---

## 6. Identity & the login seam

`loginWithPin(tx, { tenantId, tillId, personId, pin })` needs a `personId` before the PIN, and a UUID
is not typeable; salted PINs cannot be reverse-looked-up. So the operator must **identify themselves
first**, and *how* is a **pluggable, configurable seam**: slice 1 ships the **staff picker**, and the
same slot later accepts an **NFC fob** or a **fingerprint reader** without touching the rest.

- **Pre-login staff read (new).** The lock screen must list active staff *before* any session exists,
  so it cannot go through `authorize`. Add a **pre-login, tenant-scoped** read that returns
  `{ personId, displayName }` for the till's `active` persons only — no PIN hashes, no roles, nothing
  sensitive. It runs under the till's server-resolved `tenantId` (RLS-scoped), served by one endpoint.
  *(The identity package exposes staff mutations but no such list read yet — this slice adds a minimal
  one. Justification for exposing names on a lock screen: acceptable for a small counter team; the
  identify-yourself mechanism is configurable, so a venue that dislikes it can switch to a coded/NFC
  variant later.)*
- **Logout** = `endSession(tx, sessionId)`. Slice 1 has one concept (logout → lock screen), not a
  separate "lock but keep session".
- **No authorization gates fire in slice 1.** A plain cash sale needs no `sale.void` / `sale.refund` /
  `sale.discount` / `sale.rectify` permission; any staff PIN can ring one up. Those gates arrive with
  their screens (refunds/voids and the discount write path) in a later slice.

---

## 7. The receipt

Rendered from an **editable template**: a **legally-required core that cannot be removed** plus
**additive extras**. Slice 1 ships the correct default and the **QR drawn in-browser** (a small QR
library, no network); the template **editor** is deferred.

**Legally-required core** (kept, non-removable) and **allowed extras** are settled on primary source —
see the accompanying finding, `docs/compliance/verifactu-findings.md` §14. Summary:

- **Required** (RD 1619/2012 art. 7.1): número + serie (a); **fecha de expedición** (b); issuer **NIF +
  name** (d); identification of the goods (e); **tipo(s) impositivo(s) aplicado(s)**, and — when several
  rates — the **base imponible per rate** (f); **contraprestación total** (g). Plus, for an RRSIF/
  Veri\*Factu system (Orden HAC/1177/2024 arts. 20–21; RD 1619/2012 art. 7.5→6.5): the **QR** and the
  legend **"VERI\*FACTU"** *or* "Factura verificable en la sede electrónica de la AEAT" (either
  satisfies; required in Veri\*Factu mode).
- **Per-item VAT rate is NOT required** — the requirement is per rate-group at invoice level, never per
  line. This is the direct answer to the design question that prompted the finding.
- **Allowed extras** (additive template, harmless): the **cuota** per rate (required only when a
  business recipient requests it — art. 7.2), issuer **address / phone / email**, a **thank-you
  message**, a **logo**, and the operational **efectivo / cambio** lines. A simplified ticket needs
  only the issuer NIF + name, not a domicilio.

The QR **content** is fixed by Orden art. 21.2: the AEAT cotejo URL carrying the issuer NIF, series+
number, issue date and total — the till reads these from the `FiscalRecordRef` / sale, it does not
invent them.

---

## 8. Theming

Through the **token layer already in `@waitron/ui`** (`--wt-*` semantic custom properties): light/dark
work today via `prefers-color-scheme` with a `data-theme` override, and a **venue theme is a set of
token overrides**. **Freeform custom CSS is deferred** and will be carefully bounded — it can break the
44px tap-target and contrast guarantees the toolkit enforces (`no-hardcoded-chrome`, the a11y suite).

---

## 9. Localisation (i18n)

**English is the base language; Spanish (and any later locale) is a translation layer.** All operator
UI copy is authored in **English keys** and rendered through an **i18n layer** — never Spanish
hardcoded in the source. The deli runs in Spanish (Catalan a plausible second), so **es is the first
translation shipped**, but the source of truth is English. This matches the repo's standing rule:
*never store formatted or English-baked text; localise via structured, per-locale content* (the same
principle behind the domain's `locale` handling and structured error codes).

Three kinds of text, deliberately **not** conflated:

- **Operator UI chrome** — buttons, headings, prompts ("Pay", "Confirm payment", "New sale", "Cash",
  "Change"). English keys → i18n layer → the till's UI locale. This is the layer this section adds.
- **Domain content** — product and category names. Already **per-locale data**, not UI translation:
  `products.descriptions` is a `Record<locale, string>` in `@waitron/catalogue`; the till shows the
  entry for the current locale. An English product name is *data*, not a translation key.
- **The customer receipt** — a **legal document issued in Spain**, rendered in the **invoice locale**
  (es/ca for the deli), independent of the operator's UI language. Its fiscal labels (*Base*, *IVA*,
  *Total*, and the mandatory Spanish fields) come from the invoice-locale template, driven by the
  domain's `locale` / `invoiceLocales`, not the operator-UI i18n. An English-speaking operator still
  hands the customer a Spanish ticket.

**Locale-aware formatting** (money, dates) rides with the i18n layer: es renders `12,27 €` (comma
decimal, trailing symbol) where the English base would render `€12.27`. Reuse any existing
`@waitron/shared` money/locale helpers rather than reformatting in the UI — the repo already forbids
storing formatted money (confirmed as a plan item, §14).

**Slice-1 scope:** the i18n layer, the English base catalogue of the ~two dozen strings this screen
needs, and the es translation. A locale *switcher* and further languages are additive later; the layer
is the seam.

---

## 10. Domain reuse — the exact seam

Nothing fiscal is rebuilt. The server endpoints wrap, verbatim:

| Purpose | Function | Package |
| --- | --- | --- |
| List a location's sellable products | `listAvailableProducts(tx, locationId)` | `@waitron/catalogue` |
| Price a basket (browser preview **and** server-authoritative) | `priceBasket(items)` → `{ lines, total, vatBreakdown }` | `@waitron/catalogue` |
| List active staff for the lock screen | **new** minimal pre-login read | `@waitron/identity` |
| Open a session | `loginWithPin(tx, { tenantId, tillId, personId, pin })` | `@waitron/identity` |
| End a session | `endSession(tx, sessionId)` | `@waitron/identity` |
| Record + immediately settle the sale | `recordSale(tx, backend, input)` with `settlement.kind = "immediate"` | `@waitron/core` |

`recordSale`'s `input` is assembled server-side from the re-priced basket: `tenantId / tillId / nodeId /
seriesId` from server config, `total / lines / vatBreakdown` from `priceBasket`, `workingOrderId` a
generated UUID, `operatorId` from the session, `fiscalBackend: "verifactu"`, and the `VerifactuBackend`
constructed as the demos do (submission is the outbox `drain`'s job, not the sale path).

---

## 11. HTTPS API surface (slice 1)

Small and session-guarded. Shapes to be finalised in the plan; the set:

- `GET /api/till` → the till's public identity for the UI (venue display name, till label, locale, the
  layout definition). No secrets.
- `GET /api/staff` → pre-login active-staff list `[{ personId, displayName }]` (tenant-scoped).
- `POST /api/session` `{ personId, pin }` → opens a session; returns a session handle (see auth below).
- `DELETE /api/session` → `endSession`.
- `GET /api/products` → `listAvailableProducts` for the configured location (auth required).
- `POST /api/sales` `{ lines: [{ productId, quantity }], tender: { method: "cash", amount } }` →
  re-price + `recordSale` immediate; returns the filed `{ invoiceNumber, issuedAt, vatBreakdown, total,
  change, qr }` for the ticket (auth required).

All endpoints are served over **HTTPS** (§2, Transport security).

**Session transport:** an `httpOnly`, `Secure`, `SameSite=Strict` cookie carrying the session id (not
readable by browser JS, and — being `Secure` — only ever sent over the TLS connection), validated
server-side against an open `sessions` row on every guarded request. (Final choice — cookie vs bearer —
is a plan detail; the constraint is that the browser never holds a long-lived secret it can leak.)

**Error handling:** endpoints translate domain throws to JSON `{ error: { code, message } }` using the
existing structured error codes (`sale.*`, `person.*`, `session.*`, …); the UI renders the localized
message. Never surface a raw Postgres error to the browser.

---

## 12. Testing (test-first)

- **Widgets & flow:** real-browser tests (Playwright via Vitest — the pattern `@waitron/ui` already
  uses), including the **axe-core accessibility** checks per theme. Cover: add each/weighed line,
  running total, cash + change, empty-basket guard, logout-keeps-basket.
- **API endpoints:** integration tests against **real Postgres as `app_user`** (Testcontainers,
  `TESTCONTAINERS_RYUK_DISABLED=true` locally) so tenant isolation and the non-superuser role are
  actually exercised — plus a server-authoritative-pricing test proving a tampered browser total is
  ignored.
- **End-to-end:** ring a cash sale through the till and assert a **genuine chained, filed
  `registros_facturacion` record** came out and the ticket payload carries **every legally-required
  field** (§7): número+serie, fecha, NIF+name, per-rate base, total, QR content, VERI\*FACTU.
- **Guard-by-deletion** for each new server-side check (auth required, re-price authoritative).
- Coverage thresholds per package (98/98/98/95; `apps/till` UI likely mirrors `packages/ui`'s
  95/95/90/88 with a documented reason).

---

## 13. New tenant-scoped tables?

**None in slice 1.** No new `tenant_id`-bearing table is introduced (so the FORCE-RLS + tenant-isolation
policy + grants + `inmutabilidad` guard obligation does not arise here). The pre-login staff read and
all sale writes go through existing tables via existing domain functions. `apps/till` is `apps/*` and so
outside the `english-only` guard's scope; the API code in `apps/server` is likewise `apps/*`.

---

## 14. Open questions for the plan

- **Local TLS certificate** for the HTTPS API (§2): how the local server's cert is issued, trusted on
  each till device, kept working offline (no OCSP/CRL round-trip), and rotated — a local-CA/self-signed
  story shared with sub-project 9 (Deployment), distinct from the AEAT signing cert.
- **Session transport** final choice (httpOnly+Secure cookie vs bearer) and CSRF posture for the cookie case.
- **i18n layer** choice (a small dependency-light library vs a tiny in-house catalogue) and **confirm the
  `@waitron/shared` money/locale-format helpers** to reuse for `12,27 €`-style rendering rather than
  formatting in the UI (§9).
- **QR library** selection (small, dependency-light, offline; renders ISO/IEC 18004, error level M per
  Orden art. 21.1) and where the QR **content string** is assembled (server, from the sale/`FiscalRecordRef`).
- **Shared-store shape**: a Lit reactive controller vs a tiny standalone store; the event-channel API.
- **Layout-definition format**: the exact JSON shape for `{ type, position, config }` and where the
  slice-1 default lives (server config vs a checked-in default).
- **Where `apps/till` is served from** in dev vs prod (Vite dev server proxying the API vs the server
  serving the built bundle).
- **`priceBasket` in the browser**: confirm `@waitron/catalogue`'s pricing is import-clean for a browser
  bundle (no Node-only deps) so the preview and the server share one implementation.

---

## 15. Sources

- Legal receipt-content finding (per-item VAT, required fields, QR/legend), with BOE quotes:
  `docs/compliance/verifactu-findings.md` §14.
- Architecture & phasing: `docs/superpowers/specs/2026-07-18-pos-architecture-design.md` §2 (#7).
- Domain interfaces reused: `@waitron/catalogue` (`operations.ts`, `pricing.ts`), `@waitron/core`
  (`record-sale.ts`), `@waitron/identity` (`authorize.ts`, `login.ts`, `staff.ts`), `@waitron/db`
  (`tenancy.ts` `withTenant`, `testing/roles.ts` `asAppUser`). Working reference wiring:
  `apps/server/scripts/catalogue-demo.ts`.
- UI foundation: `packages/ui/docs/developers/design-system.md`.
- Provisioning that stands up the till identity: `2026-08-04-locations-provisioning-design.md` (#57).

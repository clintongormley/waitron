# `@waitron/till`

The Counter POS till — the walk-up cash-sale browser app (Lit + Vite). It is the front end for the
server's till HTTP API (`/api/*`): the operator logs in on a lock screen, rings a basket on the
counter screen, takes cash, and gets a filed Veri\*Factu ticket with its QR.

Slice 1 (**7a — walk-up cash sale**) of the Counter POS. Design:
[`docs/superpowers/specs/2026-08-05-counter-pos-walkup-sale-design.md`](../../docs/superpowers/specs/2026-08-05-counter-pos-walkup-sale-design.md).
The matching HTTP surface lives in `@waitron/server` (`apps/server/src/till-api.ts`); this app never
talks to the database directly.

## The flow

`<till-app>` (`src/till-app.ts`) runs the whole journey and never gates on anything but the sale
itself:

1. **Lock screen** — pick your name from the pre-login staff roster (`GET /api/staff`) and enter a
   PIN (`POST /api/session`).
2. **Counter screen** — a layout-driven composition of the product grid, basket, total and pay
   widgets, priced from `GET /api/products`.
3. **Pay** — one **cash** tender; the sale is filed by `POST /api/sales`, which re-prices the basket
   authoritatively (the browser never sends a price).
4. **Ticket** — the filed invoice number, per-rate VAT desglose, change and the AEAT verification QR,
   then "new sale". Logging out keeps the basket for the next operator.

## Running it in dev

The till is a same-origin front end: run the server's till API on `:8080` and the Vite dev server on
`:5190`, which proxies `/api` → `http://127.0.0.1:8080` (`vite.config.ts`).

1. **Provision a venue.** `waitron-provision venue` creates the tenant, location, till, node (SIF)
   and invoice series a sellable venue needs — see
   ["Provisioning a venue"](../server/README.md#provisioning-a-venue) in the server README.

2. **Read its five ids.** The `venue` command prints the tenant and node ids; read all five the till
   needs (verified against a provisioned `postgres:18`) with, for a venue whose NIF is `50000000K`:

   ```sql
   select t.id as tenant_id, l.id as location_id, ti.id as till_id, n.id as node_id, s.id as series_id
   from tenants t
   join locations l on l.tenant_id = t.id
   join tills ti on ti.tenant_id = t.id and ti.location_id = l.id
   join nodes n on n.tenant_id = t.id and n.location_id = l.id
   join invoice_series s on s.tenant_id = t.id and s.node_id = n.id and s.purpose = 'standard'
   where t.tax_id = '50000000K';
   ```

3. **Boot the server** with those ids as the `WAITRON_TILL_*` env. This is the normal server boot
   ([server README](../server/README.md#running-it)) — the credential key ring, migrations database
   and the rest apply unchanged; the variables below are the till-specific additions:

   ```bash
   DATABASE_URL=postgres://app_user_role@127.0.0.1:5432/waitron \
   WAITRON_CREDENTIALS_KEY=<base64, 32 bytes> \
   WAITRON_TILL_TENANT_ID=<tenant_id> \
   WAITRON_TILL_LOCATION_ID=<location_id> \
   WAITRON_TILL_TILL_ID=<till_id> \
   WAITRON_TILL_NODE_ID=<node_id> \
   WAITRON_TILL_SERIES_ID=<series_id> \
   WAITRON_TILL_LOCALE=es-ES \
   node apps/server/dist/server.js
   ```

   (Build the bundle first with `pnpm --filter @waitron/server build`, as the server README
   describes — running from source needs `WAITRON_MIGRATIONS_DIR` set.)

4. **Run the till** and open it:

   ```bash
   pnpm --filter @waitron/till dev
   # → http://localhost:5190
   ```

### The `WAITRON_TILL_*` variables

| Variable                   | Required | Default | What it is                                    |
| -------------------------- | -------- | ------- | --------------------------------------------- |
| `WAITRON_TILL_TENANT_ID`   | yes      | —       | The venue's tenant.                           |
| `WAITRON_TILL_LOCATION_ID` | yes      | —       | The location this till sells from.            |
| `WAITRON_TILL_TILL_ID`     | yes      | —       | This physical till.                           |
| `WAITRON_TILL_NODE_ID`     | yes      | —       | The compute node whose SIF/chain it files to. |
| `WAITRON_TILL_SERIES_ID`   | yes      | —       | The standard invoice series.                  |
| `WAITRON_TILL_LOCALE`      | no       | `es-ES` | The till's UI + invoice locale.               |

Each is resolved once at boot by `loadTillConfig` (`apps/server/src/till-config.ts`); a missing or
malformed value fails the boot loudly (`server.till_config_missing` / `server.till_config_invalid`),
naming the variable, never echoing its value.

### A no-browser check

`pnpm --filter @waitron/server demo:till` runs the entire login → menu → cash-sale path in-process
against a **fresh** Postgres (`DATABASE_URL`), provisioning its own venue and printing the ticket. It
is the fastest way to confirm the API path end to end without the browser — see
`apps/server/scripts/till-demo.ts` (run it only against a throwaway database; it chains a real fiscal
record).

## What this slice does and does not do

> **As of 7b (park & retrieve, 2026-08-06):** the scope below was written for slice 1 (7a). Since then
> **7b park & retrieve** has landed on this package — the Hold/Park control, the **cross-till**
> held-orders list, and retrieve/discard/pay of a parked order. Two "out of scope" items below are
> lifted by 7b and no longer appear in that list: park & retrieve itself, and "one till per server"
> (the held list is now shared across every register on a node, spec §4). 7c (prepare & collect) is
> still out. Design:
> [`2026-08-05-counter-pos-park-retrieve-and-card-design.md`](../../docs/superpowers/specs/2026-08-05-counter-pos-park-retrieve-and-card-design.md).

**In scope (slice 1 / 7a):** one walk-up **cash** sale — choose products, weigh or count them, take
cash, print the filed ticket with its Veri\*Factu QR.

**Out of scope, deliberately:**

- **Cash only.** No card / Terminal tender or any other method.
- **No offline.** The till needs the server reachable — no store-and-forward.
- **No hardware.** Scales, receipt printers and cash drawers are not driven yet.
- **No refunds, voids or corrections** UI.
- **No layout or receipt editors.** The counter screen is layout-driven and each widget already
  carries a `config` seam, but the editor that authors those layouts (and reads that per-widget
  config) is a later slice.
- **7c prepare & collect** (kitchen states) — the remaining Counter POS slice — is not here. (7b park
  & retrieve HAS landed; see the note above.)
- **TLS termination, LAN binding and serving the built bundle are deployment (#9).** In dev the app
  is served by Vite on loopback over plain HTTP, so the session cookie is not marked `Secure` (boot
  derives that from whether TLS is configured); production HTTPS, LAN exposure and serving the built
  assets are that deployment slice's job.

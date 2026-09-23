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
`:5190`. The proxy inspects the shared box state and sends `/api` and `/media` to HTTP for a
leaf-less demo or HTTPS for a server using its persisted self-signed leaf (`vite.config.ts`).

1. **Provision a venue.** `waitron-provision venue` creates the taxpayer row, location, till, node
   (SIF) and invoice series a sellable venue needs — see
   ["Provisioning a venue"](../server/README.md#provisioning-a-venue) in the server README.

2. **Read its four ids.** The `venue` command prints the node id; read all four the till needs with
   the query below, against `venue.db` inside the venue directory — any SQLite client will do,
   since the venue is just a folder of files. There is one taxpayer per database and no tenant
   column, so nothing here is scoped by a tenant — the location is the only thing that narrows it,
   and a single-location venue has just the one:

   ```sql
   select l.id as location_id, ti.id as till_id, n.id as node_id, s.id as series_id
   from locations l
   join tills ti on ti.location_id = l.id
   join nodes n on n.location_id = l.id
   join invoice_series s on s.node_id = n.id and s.purpose = 'standard' and s.retired_at is null;
   ```

   Run on 2026-09-22 with `sqlite3` 3.51.0 against a fresh database built from
   `packages/db/drizzle/0000_baseline.sql` and seeded with one location, one till, one node and two
   series, it returns exactly those four columns and one row — the rectificative series is filtered
   out by `purpose`. The control, a column the schema does not have, fails to prepare.

   A cold restore rewrites `trading.env` with your new live series id automatically.

3. **Boot the server** with those ids as the `WAITRON_TILL_*` env. This is the normal server boot
   ([server README](../server/README.md#running-it)) — the credential key ring and the rest apply
   unchanged, and the server must open the SAME venue directory you provisioned, or the till sells
   into a database nobody serves. The variables below are the till-specific additions:

   ```bash
   WAITRON_VENUE_DIR=<the directory you provisioned> \
   WAITRON_CREDENTIALS_KEY=<base64, 32 bytes> \
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

| Variable                   | Required | Default | What it is                                                        |
| -------------------------- | -------- | ------- | ----------------------------------------------------------------- |
| `WAITRON_TILL_LOCATION_ID` | yes      | —       | The location this till sells from.                                |
| `WAITRON_TILL_TILL_ID`     | yes      | —       | This physical till.                                               |
| `WAITRON_TILL_NODE_ID`     | yes      | —       | The compute node whose SIF/chain it files to.                     |
| `WAITRON_TILL_SERIES_ID`   | yes      | —       | The standard invoice series.                                      |
| `WAITRON_TILL_LOCALE`      | no       | `es-ES` | The till's UI + invoice locale.                                   |
| `WAITRON_TILL_TIPS`        | no       | off     | Offer a tip prompt at card collect. Only `true` or `1` enable it. |

Each is resolved once at boot by `loadTillConfig` (`apps/server/src/till-config.ts`); a missing or
malformed value fails the boot loudly (`server.till_config_missing` / `server.till_config_invalid`),
naming the variable, never echoing its value.

### A no-browser check

There is no longer a one-command in-process walk of the login → menu → cash-sale path: the script
that did it (`demo:till`) was deleted on 2026-09-22 along with the three other demo scripts that
opened a PostgreSQL connection string, and nothing replaced it. What covers that path now is
`apps/server`'s own suites — `src/till-api.*.test.ts` and `src/till-sale*.test.ts` — and, for a
by-hand check, the dev stack (`pnpm dev:setup`, then `wa-wt demo <worktree-name>`), which provisions
a venue and serves the real till.

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
- **The Vite page stays on loopback HTTP in development.** Its proxy matches the server transport:
  HTTP for a fresh demo, or HTTPS when shared box state contains the development leaf. Server-issued
  session cookies follow that resolved transport. The packaged box provides LAN binding and serves the
  built app over its trusted HTTPS origin.

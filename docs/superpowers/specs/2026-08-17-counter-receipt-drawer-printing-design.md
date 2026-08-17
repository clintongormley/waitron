# Counter printing — customer receipt + cash drawer

**Date:** 2026-08-17. **Status:** design (approved with the owner); plan alongside. **Track:** a consumer
of the [printing subsystem](2026-08-17-printing-subsystem-design.md) (Slice A) — the counter-POS output
half the deli-hardware design specified. **Runs SUPERVISED**. **Fiscal-adjacent** (the receipt is a legal
document), though it touches **no** fiscal record — it re-renders the already-filed receipt to paper.

Today the customer receipt is **screen-only** (`apps/till/src/screens/till-ticket-view.ts` — a Lit
component) and the cash drawer does not exist. The deli-hardware design specified an ESC/POS
`ReceiptPrinter` + a printer-kicked cash drawer; the printing subsystem now provides the transport. This
slice prints the receipt and opens the drawer through it.

## 0. Owner decisions this slice is built on (2026-08-17)

- **Auto-print, configurable** — a per-location `receipt_print_mode` (`auto` default / `on_request` /
  `never`); a **manual reprint/print** is always available.
- **Drawer: auto on cash + a manual button** — the drawer kicks automatically on a **cash** tender, plus
  a manual "open drawer" (session-gated + audited).
- **Per-till receipt printer** — each till points at its own counter printer (`tills.receipt_printer_id`);
  the **drawer is that printer's kick** (deli-hardware §6: the drawer is a printer capability, no separate
  device).

## 1. Scope

**In:** `tills.receipt_printer_id` (the per-till receipt printer, dashboard-managed) + a per-location
`receipt_print_mode`; a **`qr()` method** on the subsystem's ESC/POS builder (native `GS ( k`, raster
fallback); a **`formatReceipt`** that reproduces the receipt's every mandated element as ESC/POS;
**print-on-sale** (server-side, after filing, respecting the mode) + the **cash drawer kick** on a cash
tender; a **manual reprint** and a **manual drawer-open** (audited); the dashboard designation.

**Out:** kitchen printing (KDS-4); the `cloud_poll` transport (Slice A fast-follow); a customer-facing
display; **any change to the fiscal record** — the filed `registro`/`huella`/invoice number are untouched
(§4). A **permission** gate on manual drawer-open (vs today's session-gate + audit) is a fast-follow tied
to the first till-side `authorize()` path (§8).

## 2. Data model

Pre-production. The receipt content is **not stored** — it is formatted at print time from the filed
`TillSaleResult` (as the screen does).

- `tills.receipt_printer_id uuid NULL` — composite FK `(tenant_id, receipt_printer_id) → printers`
  (Slice A). The till's receipt printer + drawer. Nullable (a till with no printer just doesn't print).
  Additive on the existing `tills` table (`tenant_id`-scoped, already FORCE-RLS).
- `locations.receipt_print_mode` — a new pgEnum `receipt_print_mode` (`['auto','on_request','never']`,
  default `auto`), read per-location the way `order_flow` is (`till-config.ts:183-203`).
- `drawer_opens` (new, tenant-scoped, **audit**) — `id, tenant_id, till_id, person_id, opened_at,
  reason ('cash_sale'|'manual'), sale_id?`. Records **manual** (no-sale) opens for cash accountability;
  a cash-sale kick may also record one. FORCE RLS + append-only-ish grants (`SELECT,INSERT`, no
  UPDATE/DELETE). Enumerated by `inmutabilidad`.

One migration set (number via `db:generate`): add the two columns + the enum, create `drawer_opens`;
custom part = the `receipt_printer_id` composite FK + `drawer_opens` FORCE RLS/policy/grants. Re-run
`inmutabilidad`. Sequences after the printing subsystem (the FK target).

## 3. Behaviour

### 3a. ESC/POS `qr()` (extend Slice A's `@waitron/printing` builder)

Add `qr(text: string, { ecLevel = "M", moduleSize }): this` — emits the **native `GS ( k`** QR sequence
(model, module size chosen so the printed symbol lands in the mandated **30–40 mm** at typical 203-dpi
density, error-correction **level M** per Orden HAC/1177/2024 art. 21.1), with a **raster fallback**
(`GS v 0`) for printers lacking native QR. The content is the **same `r.qr` string** the screen QR uses
(the server-minted AEAT cotejo URL, art. 21.2) — passed through verbatim.

### 3b. `formatReceipt` — the legal document, faithfully (`@waitron/receipt` or `apps/server`)

`formatReceipt({ result, issuer, receipt, invoiceLocale }) → Uint8Array` reproduces **every element the
screen renders** (`till-ticket-view.ts:229-318`), in order, with the **fixed Spanish labels**
(`nif/factura/fecha/base/iva/total/efectivo/cambio`) and money/date/name in the **invoice locale**:
issuer venue + NIF (art. 7.1.d), header-subtitle trim, factura número+serie (7.1.a), fecha (7.1.b),
per-line goods (7.1.e), **VAT breakdown Base/IVA per rate** (7.1.f), TOTAL (7.1.g), Efectivo/Cambio
(allowed extras), the **QR** (§3a), the **VERI\*FACTU legend** (fixed string, Orden 20.1.b), footer-message
trim, then a cut. **A test pins that every art. 7.1 / arts. 20–21 element is present and none is
suppressed** (the receipt-editor §8 non-suppression discipline, now for paper).

### 3c. Print-on-sale + drawer kick (SERVER-SIDE, after filing, non-blocking)

Printing is **server-side** (the browser can't drive a printer; the topology puts printers on the
server). After a sale is **filed** (`recordSale` / `collectOrder` — unchanged), the server:

1. reads the calling till's `receipt_printer_id` and the location's `receipt_print_mode`;
2. if `mode = 'auto'` and a printer is set → `enqueuePrintJob(formatReceipt(...))` to it (Slice A outbox
   — an INSERT, so **filing/selling is never blocked**, CLAUDE.md §5);
3. if the tender is **cash** (`method === "cash"`) → append the **drawer-kick** bytes to that job (open
   the drawer as the receipt prints) and record a `drawer_opens('cash_sale')`.

`mode = 'on_request'/'never'` skip the auto-enqueue. **This adds nothing to the fiscal path** — it reads
the filed result and enqueues an outbox row (§4).

### 3d. Manual reprint + manual drawer-open (`requireSession`, audited)

- `POST /api/sales/:id/reprint` — re-`formatReceipt` the filed sale to the till's printer (no re-filing).
- `POST /api/drawer/open` — enqueue a **kick-only** job to the till's printer; **records
  `drawer_opens('manual')`** (who/when) for accountability. Session-gated now; a `cash.drawer` **permission
  + supervisor override** is the fast-follow once the till-side `authorize()` path exists (§8).

### 3e. HTTP

Till (`requireSession`): `POST /api/sales/:id/reprint`, `POST /api/drawer/open`. Management
(`printer.manage`): set `tills.receipt_printer_id`, set `locations.receipt_print_mode`. Reuse `run` /
`STATUS` / `requireUuidId`.

## 4. Fiscal safety (H2)

**The fiscal record is untouched.** `recordSale`/`collectOrder`/the alta builders/`computeHuella`/the
chain/invoice numbering are **byte-unchanged** — this slice reads the **already-filed** `TillSaleResult`
and enqueues a paper rendering. Nothing it does can alter, delay, or block the filing (print is a
post-filing outbox INSERT; a broken printer never stops a sale — CLAUDE.md §5). **But the printed document
is a legal receipt**, so §3b's completeness test is load-bearing: the paper must carry the same art. 7.1 /
arts. 20–21 elements as the screen, never fewer. The plan greps to prove `formatReceipt` reads
`TillSaleResult` only and writes no fiscal table, and pins the completeness + the QR (level M, 30–40 mm)
+ the fixed legend.

## 5. Client

- **Till** — the ticket screen (`till-ticket-view`) gains a **Reprint** button (→ `POST …/reprint`) and,
  gated by session, an **Abrir cajón** (open drawer) button (→ `POST /api/drawer/open`). The on-screen
  receipt is unchanged; paper is the server's job. `TillApi.reprint(saleId)` / `openDrawer()`.
- **Dashboard** — the **Impresoras** screen (Slice A) gains: per **till**, a **receipt-printer** picker
  (from the location's printers); per **location**, the **`receipt_print_mode`** toggle. `printer.manage`;
  `DashboardApi.setTillReceiptPrinter` / `setReceiptPrintMode`.

## 6. Conventions

- **English identifiers** — `receipt_printer_id`, `receipt_print_mode`, `drawer_opens`. The receipt's
  on-paper **labels stay the fixed Spanish legal constants** (`nif`/`factura`/…), as on screen. No new
  `SPANISH_WORDS` schema tokens; UI copy en/es.
- **Domain error codes** — `printer.not_found` (reuse, Slice A); a `drawer.no_printer` (400 — open-drawer
  with no till printer set). `import "./errors.js"`. Never renamed.
- **Permissions** — `printer.manage` (config); `requireSession` (reprint, drawer-open — audited). No new
  permission this slice (the `cash.drawer` gate is the §8 fast-follow).
- No backwards-compat / data-migration code (pre-production).

## 7. Testing

- **Real Postgres** — `drawer_opens` cross-tenant RLS + append-only grants (by deletion); `tills.receipt_printer_id`
  / `locations.receipt_print_mode` visible under `app_user`; `inmutabilidad` green.
- **`@waitron/printing`** — the `qr()` builder emits the `GS ( k` bytes for a given URL at EC level M (and
  the raster fallback path); byte-asserted against a fake sink.
- **`formatReceipt` (the load-bearing fiscal test)** — every mandated element present for a filed
  `TillSaleResult` (issuer/NIF, serie+número, fecha, each line, **Base+IVA per rate**, total, QR, the fixed
  `VERI*FACTU` legend), trim rendered around the core, labels the fixed Spanish constants, money/date in
  the invoice locale. **Prove non-suppression by removing an element → the test fails.**
- **Print-on-sale** — `mode='auto'` + a cash sale → one outbox job to the till's printer whose bytes
  contain the receipt **and** the drawer kick + a `drawer_opens('cash_sale')`; a card sale → receipt, no
  kick; `mode='on_request'/'never'` → no auto job; **filing is never blocked** (no I/O in the sale path).
  Reprint re-enqueues without re-filing. Manual open → a kick-only job + `drawer_opens('manual')`;
  `drawer.no_printer` when unset.
- **H2 grep** — `formatReceipt` + the print hook read `TillSaleResult` only; `record-sale.ts` / the alta
  builders unchanged.
- **Dashboard / till** — the receipt-printer picker + mode toggle; the Reprint + Abrir cajón buttons;
  `.a11y` both themes.
- Coverage **98/98/98/95** (db, server, `@waitron/printing`), **95/95/90/88** (till, dashboard). Run
  `packages/db` unfiltered; `TESTCONTAINERS_RYUK_DISABLED=true` locally.

## 8. Sequencing / dependencies

- **Builds on the printing subsystem (Slice A)** (`enqueuePrintJob`, the ESC/POS builder it extends with
  `qr()`, `printers`) — build after it. Re-verify those symbols first (CLAUDE.md §1). Independent of the
  table-service track.
- **Manual drawer-open hardening** — session-gated + audited now; a `cash.drawer` permission with a
  supervisor override lands once the **first till-side `authorize()` path** exists (the same net-new hop
  device-identity/on-till-config needs — [[device-identity-1]] §3c). Recorded, not built here.
- **Sibling consumer**: KDS-4 kitchen printing shares the subsystem; both prove the outbox.

## 9. Provenance

Designed against the live tree on 2026-08-17. The receipt element list + citations are **carried from**
`apps/till/src/screens/till-ticket-view.ts:12,35-83,229-318` and `apps/till/src/qr.ts:3-27` and
`docs/compliance/verifactu-findings.md §14` (`:865-925` — the 30–40 mm size at `:876-877`, level M art.
21.1, content art. 21.2, legend art. 20.1.b) and the receipt-editor spec §8 (`2026-08-08-layout-receipt-editors-design.md:233-250`)
— this design **adds no new legal citation**, it reproduces the settled one on paper. The sale-complete
hook (`till-app.ts:373-374,432-434,566-567` → now server-side after filing), the cash discriminant
(`method==="cash"`, `client.ts:96-115`), the net-new receipt-printer designation (`till-config.ts:44-82`
has none; per-till hardware precedent is the env-provisioned card terminal), and the missing ESC/POS QR
command (subsystem builder is `init/text/line/feed/cut/kick` only) are all cited above and re-verified in
the plan once the subsystem lands.

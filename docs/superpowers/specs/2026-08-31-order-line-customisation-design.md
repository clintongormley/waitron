# Order-line customisation — free-text notes & meat doneness

**Date:** 2026-08-31
**Status:** design, awaiting review
**Author:** brainstormed with the owner
**Sibling spec:** `2026-08-31-dietary-classification-design.md` (this spec depends on its **meat**
origin for doneness gating).

## 1. Problem

An order line today carries a product, a quantity, and selected structured options (modifiers, #184).
No order line carries a **free-text instruction** — bookings and purchase-invoices have a `note`
column, but working-order lines do not. The owner wants two per-line customisations:

- **A free-text note on any line** — "hold the mayo", "extra crispy", "birthday plate".
- **A "how it's cooked" (doneness) choice** — that appears **automatically on any dish that contains
  meat** (rare → well-done).

Both are **kitchen instructions**: they must reach the kitchen and pass surfaces, and they must
**never** enter the fiscal record.

## 2. The fiscal boundary (the load-bearing constraint)

A line moves **working_order_lines** (till, mutable) → **ticket_items** (kitchen, ephemeral,
snapshotted at fire) → **sale_lines** (fiscal, immutable, hashed by `computeHuella`).

Note and doneness are **our metadata, not AEAT's**. CLAUDE.md §5: *"Never put our own metadata into a
hash."* They therefore:

- live on **`working_order_lines`** (persist with the line, editable while the order is open);
- are **snapshotted onto `ticket_items`** at fire time, exactly the way `station_id` / `course_id` are
  snapshotted, so re-editing later never rewrites food already sent;
- **never touch `sale_lines`** and **never enter `computeHuella`**.

A test pins that two sales differing only in a line's note/doneness produce an **identical huella** —
the same shape as the `entorno` invariance test that guards allergen/metadata leakage into the hash.

## 3. Data model

New pgEnum `doneness` (`rare`, `medium_rare`, `medium`, `medium_well`, `well_done`). English
identifiers, i18n labels at render (consistent with the codebase; `english-only` unaffected).

- `working_order_lines.note` — `text`, nullable. Bounded (≤ 200 chars, trimmed) at the write path.
- `working_order_lines.doneness` — `doneness` enum, **nullable** — optional *even on meat*, so a stew
  or a bolognese line simply leaves it NULL (see §4 over-trigger note).
- `ticket_items.note` — `text`, nullable; snapshotted at fire.
- `ticket_items.doneness` — `doneness` enum, nullable; snapshotted at fire.

All four are **additive columns on existing RLS tables** — they ride the tables' existing FORCE RLS +
tenant-isolation policy + `app_user` grants (no new table ⇒ no new policy; CLAUDE.md §3). One
`drizzle-kit generate` for the enum + columns; run
`pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after (it scans every `tenant_id` table).
No backfill (pre-production; existing rows get NULL, the correct empty state).

## 4. Doneness gating — the coupling to the dietary spec

The till offers the doneness picker on a line **iff the product's published diet profile has
`meat` in its `contains` set** — the derived `meat` origin from the sibling dietary spec. This is the
one hard dependency: **doneness cannot be built until the dietary spec's meat origin + published
`contains` exist.** The free-text note has no such dependency and can ship first.

- **Selection is optional**, not required. "Auto for meat" means the picker *appears* for every meat
  dish; it does not force a choice. This is the deliberate mitigation for the over-trigger case —
  minced/stewed meat dishes get the picker but staff just leave it blank, with no per-dish setup.
- **Over-trigger tradeoff, recorded:** a bolognese is `meat` and will show the picker though doneness
  is meaningless for it. Accepted for v1 (optional selection makes it harmless). If it proves
  annoying, a future per-dish "no doneness" suppress flag is the escape hatch — explicitly *not* built
  now (YAGNI).

## 5. Wire contract & server validation

The working-order line wire (`SaleLine`) sends `productId`, `quantity`,
`options: [{ optionGroupItemId }]`. Add two optional fields to the line payload: `note` and
`doneness`. Server is authoritative:

- `doneness` must be a member of the enum or absent — reject otherwise (`working_order.invalid_doneness`).
- `note` trimmed and length-checked (`working_order.note_too_long`).
- Error codes domain-named (`working_order.*`), grepped against sibling families before committing (codes are
  never renamed once shipped; CLAUDE.md §3). (Corrected 2026-09-01 in pre-merge review: the codes were
  first written `order.*`, but this entity's six existing sibling codes use `working_order.*`, so they
  ship as `working_order.note_too_long` / `working_order.invalid_doneness`.)
- The server does **not** re-derive meat to police doneness — the till gates the *UI*; the server
  stores a validated value. Coupling the fiscal write path to diet derivation would be gratuitous.

## 6. Surfaces

- **Till** — a free-text box on every line; a doneness picker on lines whose product contains meat.
  Both editable while the order is open.
- **KDS / expo / printed kitchen ticket** — render the note and the doneness prominently (the cook
  needs both). Snapshotted values from `ticket_items`.
- **Not the customer fiscal receipt, not the dashboard** — these are per-order runtime instructions,
  not menu authoring and not fiscal.

## 7. Testing

- **Fiscal hash invariance (crux):** two sales identical but for a line's note / doneness hash to the
  same `huella`; note/doneness absent from `sale_lines`. Prove by construction, not by reading.
- **Snapshot at fire:** editing the working-order line's note/doneness after fire does not mutate the
  already-created `ticket_items` row (mirrors the station/course snapshot tests).
- **Wire/validation:** enum membership, note length; malformed rejected with the right code.
- **Doneness gating (till):** picker shows for a meat product, hidden for a non-meat one — proven by
  toggling the product's `contains`. Browser-mode suites: don't run their `test:coverage`
  concurrently (memory).
- **KDS/expo/ticket rendering + a11y.**
- **RLS:** covered by existing policies; run `inmutabilidad` after the schema change.

## 8. Non-goals

- Per-dish doneness suppression (§4) — deferred until the over-trigger actually bites.
- Doneness on non-meat dishes, or multiple doneness values per line (a surf-and-turf) — one optional
  doneness per line for v1.
- Notes on the fiscal receipt or any fiscal record (§2, deliberate).
- Backfill / backwards-compatibility (pre-production; CLAUDE.md §3).

## 9. Build order (for the plan)

1. **Note first** (no dependency): `working_order_lines.note` + `ticket_items.note`, migration,
   inmutabilidad; wire + validation; snapshot at fire; the fiscal-invariance test; till text box;
   KDS/expo/ticket rendering.
2. **Doneness** (after the dietary spec's meat origin + published `contains` land): `doneness` enum +
   columns; wire + validation; snapshot; till picker gated on `contains ∋ meat`; render on kitchen
   surfaces; extend the fiscal-invariance test to cover doneness.

Sequence 1 can proceed in parallel with the dietary spec; sequence 2 waits on it.

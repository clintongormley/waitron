# Cash-drawer authorization — the first till-side `authorize()`-with-override path

**Date:** 2026-08-17. **Status:** design (approved with the owner); plan alongside. **Track:** the
hardening follow-on to
[counter receipt + drawer printing](2026-08-17-counter-receipt-drawer-printing-design.md), and — more
importantly — the **first till-side privileged-action authorization path** (a shared foundation).
**Runs SUPERVISED**. **Security-adjacent** (cash control + the first supervisor-override on the till).

The receipt+drawer slice made the manual "open drawer" **session-gated + audited** and flagged a
`cash.drawer` permission gate as a fast-follow "once the first till-side `authorize()` path exists". That
path does not exist yet: `authorize(tx, { sessionId, permission, override? })` is built
(`packages/identity/src/authorize.ts:39-67` — satisfied by the operator's role **or** a supervisor PIN
override), but **no till route calls it**, and **no till route parses a supervisor override**
([device identity-1](2026-08-17-device-identity-1-station-enrolment-design.md) §3c uses `authorize()`
without an override; this slice adds the override hop). This slice builds that hop, applies it to the
drawer, and leaves a **reusable supervisor-override component** on-till config and other privileged actions
inherit.

## 0. Owner decisions this slice is built on (2026-08-17)

- **Drawer-open policy is configurable, default gated.** A per-location `drawer_open_policy`: **`gated`**
  (default — a supervisor/manager opens directly; a cashier opens via a supervisor **PIN override**) or
  **`open`** (any logged-in operator opens, every open audited). The full authorize-with-override path is
  built either way; `gated` uses it.
- **The auto-open on a cash SALE is unaffected** — that is part of a sale, not gated (receipt+drawer §3c).

## 1. Scope

**In:** a `cash.drawer` permission; a per-location `drawer_open_policy`; the **first till route to parse a
supervisor override and call `authorize()`** — applied to `POST /api/drawer/open`; the audit gains **who
authorized** + **via-override**; a **reusable supervisor-override dialog** on the till; the dashboard
policy toggle.

**Out:** applying the override path to other actions (on-till config / `till.configure`, void/refund via
the till — future consumers of the same foundation, named not built); the auto-open on cash (unchanged);
any change to `authorize()` itself (reused as-is).

## 2. Data model

Pre-production, non-fiscal.

- **`cash.drawer` permission** — added to `PERMISSIONS` + the **`SUPERVISOR`** set (so supervisor +
  manager + admin hold it, like `sale.void`; staff do **not**) — `packages/identity/src/permissions.ts:7-47`.
  **Churn:** update `permissions.test.ts`.
- **`locations.drawer_open_policy`** — a new pgEnum `drawer_open_policy` (`['gated','open']`, default
  `'gated'`), read per-location like `order_flow` (`till-config.ts:183-203`).
- **`drawer_opens`** (from receipt+drawer §2) gains **`authorized_by uuid → persons`** (who authorized —
  the operator, or the supervisor when via override) + **`via_override bool NOT NULL DEFAULT false`**. The
  existing `person_id` stays as the operator who performed the open. (Coordinate: both columns land in the
  same `drawer_opens` — additive, both slices pre-production.)

One migration set (via `db:generate`): the two enum/columns + the `drawer_opens` columns; custom part =
the `authorized_by` FK. Re-run `inmutabilidad`. Sequences after receipt+drawer (the `drawer_opens` host).

## 3. Behaviour — the till authorize()-with-override hop (`apps/server`)

Upgrade `POST /api/drawer/open` (receipt+drawer §3d), which today is session-gated:

1. `const { personId, sessionId } = requireSession(deps, c)` — as today.
2. read the location's `drawer_open_policy`.
3. **`open`** → proceed; `authorizedBy = personId`, `viaOverride = false`.
4. **`gated`** → parse an optional `override: { personId, pin }` from the body; call
   **`const authz = await authorize(tx, { sessionId, permission: "cash.drawer", override })`**
   (`authorize.ts:39-67`) — satisfied by the operator's own role, **or** by a supervisor whose PIN
   verifies **and** who holds `cash.drawer`; else it throws `authorization.not_permitted` (→ 403). Take
   `authorizedBy = authz.authorizedBy`, `viaOverride = authz.viaOverride`.
5. enqueue the **kick-only** print job to the till's receipt printer (receipt+drawer §3d), and INSERT
   `drawer_opens('manual', person_id: personId, authorized_by: authorizedBy, via_override: viaOverride)`.
   `drawer.no_printer` when the till has none.

This is the **verb-side pattern from `record-void.ts:58-62`** (the only existing `authorize()` caller),
now reached through the **first till HTTP route that parses a supervisor override** — the reusable hop.
The **audit stamps who actually authorized**, so a cashier's override-opened drawer records the supervisor.

## 4. Fiscal safety (H2)

**None** — the drawer + its authorization are non-fiscal cash-control; the audit is append-only. Nothing
touches `record-sale.ts` / the alta builders / the pay path (grep receipt). (The `authorize()` +
`drawer_opens` stamps are an audit trail, not a fiscal record.)

## 5. Client — the supervisor-override dialog (reusable) + policy

- **Till** — the **Abrir cajón** button (receipt+drawer §5): in `open` policy, tap → `POST /api/drawer/open`
  directly. In `gated` policy, if the operator's role lacks `cash.drawer`, tap → a **supervisor-override
  dialog** (pick the authorizing supervisor + enter their **PIN**) → the request carries
  `override: { personId, pin }`; a supervisor operator (holds `cash.drawer`) opens with no dialog. **The
  override dialog is a reusable component** — the first supervisor-override UI on the till, which future
  privileged actions (on-till config, till void/refund) reuse. `TillApi.openDrawer(override?)`.
  - The dialog resolves the authorizing person from a **picker of eligible supervisors** (persons whose
    role holds `cash.drawer`) + their PIN → `{ personId, pin }` (the `authorize()` override shape). It
    never sends a raw PIN anywhere but this authenticated request.
- **Dashboard** — the venue-config surface gains the **`drawer_open_policy`** toggle (`printer.manage` or
  the general venue config); `DashboardApi.setDrawerOpenPolicy`.

## 6. Conventions

- **English identifiers** — `drawer_open_policy`, `authorized_by`, `via_override`. No new `SPANISH_WORDS`;
  UI copy en/es ("Abrir cajón", "Autorización de un responsable").
- **Domain error codes** — reuse `authorization.not_permitted` (403, from `authorize()`) + `drawer.no_printer`
  (receipt+drawer). No new code. `import "./errors.js"`.
- **Permission** — a new **`cash.drawer`** (supervisor + manager + admin). No other new permission.
- **Reuse `authorize()` unchanged** — do not fork the identity gate; this slice only wires it to the till.
- No backwards-compat / data-migration code (pre-production).

## 7. Testing

- **Real Postgres** — `roleHasPermission("supervisor","cash.drawer")` true / `("staff",…)` false; the
  drawer route under `gated`: a supervisor operator opens directly (`via_override=false`), a **staff
  operator with a valid supervisor override** opens (`via_override=true`, `authorized_by=` the supervisor),
  a staff operator **without** an override → **403** (`authorization.not_permitted` — **prove the gate by
  deletion** of the `authorize()` call), a **wrong override PIN** → 403; under `open`, a staff operator
  opens directly (`via_override=false`); `drawer.no_printer` when unset; `inmutabilidad` green after the
  migration; `drawer_opens` append-only.
- **Identity reuse** — assert `authorize()` is called with `permission:"cash.drawer"` + the parsed override
  (not reimplemented).
- **Till** — the override dialog appears for a non-permitted operator in `gated` mode and not for a
  supervisor / in `open` mode; the PIN reaches only the authenticated request; `.a11y` both themes.
- **Dashboard** — the policy toggle; `.a11y` both themes.
- **Fiscal** — the H2 grep (drawer/authorize touch nothing filed).
- Coverage **98/98/98/95** (db, server, identity), **95/95/90/88** (till, dashboard). Run `packages/db`
  unfiltered; `TESTCONTAINERS_RYUK_DISABLED=true` locally.

## 8. Sequencing / dependencies

- **Builds on receipt + drawer** (the `POST /api/drawer/open` route + `drawer_opens` it upgrades) and
  **`@waitron/identity`'s `authorize()`** (reused as-is). Build after receipt+drawer. Re-verify
  `authorize()`'s signature + `requireSession`'s `{ personId, sessionId }` against real code first
  (CLAUDE.md §1).
- **The foundation this establishes** — the first till route to **parse a supervisor override + call
  `authorize()`** + the reusable override dialog — is what **on-till config editing** (device-identity's
  manager-on-till, FP-2's "Editar plano") and any future privileged till action (till-side void/refund)
  build on. Recorded as the shared consumer; those slices reuse this hop rather than re-inventing it.

## 9. Provenance

Designed against the live tree on 2026-08-17. Cited: `authorize()` (`packages/identity/src/authorize.ts:39-67`
— role check `:54`, override `:58-67`, `Override {personId,pin}` `:10-13`), the **only** existing caller
`record-void.ts:58-62` (the verb-side pattern), `requireSession → { personId, sessionId }`
(`till-session.ts:76-95`, the `sessionId` today unused by routes), the **absence** of any till route
calling `authorize()` or parsing an override (device-identity-1 §3c uses it without override), the
`SUPERVISOR` permission set (`permissions.ts:42-47`), and `drawer_opens` + `POST /api/drawer/open`
(receipt+drawer §2/§3d). The receipt+drawer slice explicitly deferred this gate to "once the first
till-side `authorize()` path exists" — this is that path.

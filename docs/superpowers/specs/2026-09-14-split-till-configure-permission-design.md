# Split `till.configure` into three permissions named for what they guard

Status: design approved by the owner in a brainstorm on 2026-09-14. Step 0 of backlog A5
([dashboard alerts](2026-09-14-dashboard-alerts-design.md)); the alerts work needs `system.manage`
to exist.

## Why

`till.configure` is one name over four unrelated concerns. The word says "till", but the permission
also gates backups, retiring the box, the recovery bundle, the physical floor plan and the venue's
location settings. A reader gating a new route on it cannot tell what audience it implies, and the
alerts work needs a permission that means "box management" for its backup alerts. Nobody's access
changes: this is a rename and split, not a re-grant.

## The split

`till.configure` is removed from the catalogue and replaced by three permissions, all held by the
same roles it is today (manager and admin):

- **`layout.configure`** — authoring what appears on a screen or receipt: till card layouts, saved
  canvases, device profiles, the theme, and the receipt trim.
- **`venue.configure`** — the physical restaurant: floor zones and tables, table placement, the
  service statuses, and the venue's location settings. This is also what the till's "Editar plano"
  (edit floor plan) capability checks.
- **`system.manage`** — box lifecycle: backups, the recovery bundle, configuration export, retiring
  the box, and the box-status chain read.

Names follow the existing dotted style (`report.view`, `device.manage`, `payments.manage`).

## Exact call-site mapping

Every current `till.configure` site (non-test, found 2026-09-14), and the permission it becomes. The
mapping is behaviour-preserving; a reviewer checks that no site changes which roles it admits.

### → `layout.configure`

- `packages/layouts/src/canvas-store.ts` (createCanvas, and the two other write verbs at 149, 182)
- `packages/layouts/src/theme-store.ts` (putTenantTheme)
- `packages/layouts/src/receipt-store.ts` (putReceipt)
- `packages/layouts/src/device-profile-store.ts` (the three write verbs at 172, 222, 268)
- `apps/server/src/management-api.ts` reads: `/management-api/receipt` (1277), `/canvases` (1336),
  `/canvases/:id` (1354), `/theme` (1460), `/device-profiles` (1517), `/device-profiles/:id` (1536)

### → `venue.configure`

- `apps/server/src/management-api.ts` `withVenueAuth` (497) — every zone and table verb that uses it
  (create/list/update/deactivate zones and tables, 1844–2008)
- `apps/server/src/till-api.ts` table placement PUT and DELETE (2219, 2238)
- `apps/server/src/till-api.ts` `canConfigureTill` capability (736) — the till's "Editar plano" gate
- `apps/server/src/tables.ts` `requireConfigure` (456) — the service-status CRUD verbs
- `apps/server/src/location-settings-api.ts` (36, and the error at 39)
- The `table-layout-editor` card's `requiredPermission` in all three places that name it:
  `packages/layouts/src/card-contract.ts` (96), `apps/dashboard/src/screens/canvas-editor/card-contracts.ts`
  (124), `apps/till/src/layout.ts` `CARD_REQUIRED_PERMISSION` (114); and the client read of it in
  `apps/till/src/widgets/card-grid.ts` (177), which compares against `canConfigureTill`

### → `system.manage`

- `apps/server/src/backup-api.ts` (206) — the backup routes' shared `authorize`
- `apps/server/src/recovery-bundle-api.ts` (59)
- `apps/server/src/configuration-export-api.ts` (49, and the error at 56)
- `apps/server/src/box-retire.ts` (80)
- `apps/server/src/box-status.ts` (257)

### The catalogue and role map

- `packages/identity/src/permissions.ts`: remove `till.configure` from `PERMISSIONS`; add
  `layout.configure`, `venue.configure`, `system.manage`. In `MANAGER`, replace the one
  `till.configure` entry with the three. `ALL`/admin already spreads `PERMISSIONS`. Update the doc
  comment that describes `till.configure`.

## `canConfigureTill`

The till session response field `canConfigureTill` (`till-api.ts:736`) now reflects
`venue.configure`. Its name is left unchanged in this work — it is an internal client convenience
field, not a permission, and renaming it widens the diff into the till client for no behaviour
change. A follow-up may rename it to `canEditFloorPlan`; noted, not done here.

## Testing

- **Grant parity, proven by role.** For each new permission, a test asserts manager and admin hold it
  and staff and supervisor do not — the same shape the suite asserts for `till.configure` today, moved
  onto the three names. Delete-to-prove each gate: dropping the `authorizeManager` call on a
  representative route per permission flips its staff-role case from 403 to 200 (the existing
  `management-api.pg.test.ts` and `tables` suites already do this for the sites they cover).
- **No orphan.** A guard (or a grep in the existing permissions test) asserts `till.configure` appears
  nowhere in `packages/` or `apps/` after the change — catalogue, call sites and tests alike — so the
  old name cannot linger on a missed route.
- **Every existing behavioural assertion is preserved, not rewritten** (`CLAUDE.md` global rule): a
  test that asserted a staff 403 on a backup route still asserts it, now against `system.manage`. The
  point of the split is that no role's access moves, so any test whose expected status changes is a
  bug in the split.
- Error-code registry: `authorization.not_permitted` params carry a `permission` string; the three
  new values need no registry change (the code is unchanged, only the param value).

## Not in this work

Any change to which roles hold what; a data-driven RBAC; renaming `canConfigureTill`; splitting any
other permission.

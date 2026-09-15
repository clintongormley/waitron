# Dashboard alerts, branch 1 (framework and recorded events) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the incidents Waitron already records visible in the management dashboard: a bell with a count in the banner, a panel, an Alerts screen with Open and Handled tabs, a pop-up when a new alert arrives, and a way to mark an incident handled.

**Architecture:** The server gains an alert model and a registry: event codes are claimed by areas (each with a permission), and ongoing-check sources plug in through a new `alerts` seat on `WaitronModule` (no source exists until branch 2, but the framework and its failure handling are built and tested now). Three routes under `/management-api/alerts` read open alerts, read handled ones, and mark one handled. The dashboard reads them through the shared query controller, shows them in a bell built on `wt-row-actions`, and uses two new shared components (`wt-count-badge`, `wt-toast`).

**Tech Stack:** TypeScript, Hono, Drizzle on PostgreSQL (PGlite in tests), Lit, Vitest (Node and real-Chromium browser mode), axe-core.

**Spec:** `docs/superpowers/specs/2026-09-14-dashboard-alerts-design.md` — this plan builds its "Order of work" item 1 only. Read the spec before any task.

**Worktree:** `/Users/clintongormley/workspace/worktrees/waitron-feat-dashboard-alerts-events`, branch `feat/dashboard-alerts-events`.

## Global Constraints

- Every commit: `git commit -s`. Stage explicit paths, never `git add -A`.
- Every task's verify step runs, and checks the exit status of each: the focused tests named in the task, `pnpm format:check`, `pnpm lint`, and `pnpm --filter <each touched package> typecheck`.
- Error codes are domain concepts, never renamed once shipped. New codes: `alert.not_found`, `alert.source_unavailable`.
- Permissions: `fiscal.view` (new, core catalogue, manager and admin). Areas use `payments.manage`, `diagnostics.view`; branch 2 adds `system.manage` and `printer.manage`.
- Every colour, spacing, radius and font in a component or view reads a `--wt-*` token. No hex, no named colours, no `rem`/`em`, no px above 1 (`packages/ui/src/no-hardcoded-chrome.test.ts`).
- Custom events are named `wt-*`, carry `detail`, are dispatched `bubbles: true, composed: true`, and the triggering event is `stopPropagation()`ed first.
- A new `wt-*` primitive needs a token-painting test and a sibling `*.a11y.test.ts` covering each distinct state in both themes, with one test proving axe goes red when accessibility is broken.
- The dashboard's API types are LOCAL copies; browser code never imports `@waitron/module`, `@waitron/core` or any server package.
- Background reads go through `DashboardQueries` so refreshes carry `x-waitron-live: 1` (passive).
- Tenant convention: `tenant_id` still exists on `main`. Every incident read and the handled update scope to the tenant; routes compare the session's tenant with the configured one. If `feat/drop-tenant-id` lands first, rebase and follow `main`.
- Comments state the invariant and the non-obvious reason, never the history. Plain English in commit messages.
- Grants are never widened. `app_user` already holds `SELECT, INSERT` on `incidents` and `UPDATE (acknowledged_at, acknowledged_by)`.

## Rulings (where this plan narrows or fills in the spec)

1. **Wording lives in the dashboard app** (`apps/dashboard/src/i18n/alert-messages.ts`), registered through a new kit registry. Why: the packages that own these codes (`core`, `payments`, `fiscal-verifactu`) have no dashboard folder, and the app already holds their `payment.*` error wording in `apps/dashboard/src/i18n/codes.ts`. A module with its own dashboard folder can call `registerAlertMessages` itself.
2. **Core's `chain.` and `clock.` claims are written inline on the `core` descriptor** in `@waitron/composition`, the way that descriptor already writes its `migrations` literal. Payments and fiscal-verifactu export their claims from their own packages. Every claim therefore comes from `ALL_MODULES`.
3. **The list routes answer `{ visible, alerts }`.** `visible` is true when the session holds at least one alert permission. A session holding none, or a session from another tenant, gets `{ visible: false, alerts: [] }` rather than an error. The bell shows only when `visible` is true, so the server stays the one authority on who sees alerts.
4. **Each ongoing source reads inside a savepoint** (`tx.transaction(...)`). Why: all reads share one transaction, and a failed query would otherwise abort it for every source after it.
5. **A malformed incident id answers `alert.not_found`** (404), like an unknown or another tenant's id.
6. **The "only `payments.manage`" test runs at service level** with an explicit permission set: no role holds that shape. The route tests use real roles (manager holds all, supervisor holds none).
7. **`handledBy` is the person's display name**, looked up server-side, or `null` when no person has that id.
8. **Warning colour tokens are added** (`--wt-color-warning`, `--wt-color-on-warning`): the design system has none, and the spec needs amber.
9. **`wt-row-actions` gains** a `badge` slot inside its trigger, `part="popup"` on its popover, and public `show()`/`hide()`. The bell is a `wt-row-actions` instance, so the panel reuses its popover positioning.
10. **The panel lists at most five alerts** (`PANEL_LIMIT`); "See all" opens the screen. Its width is `44ch` capped by the viewport and its height `70vh`: sizes relative to text and screen, as the sidebar's `18ch` is, not chrome tokens.
11. **The Alerts screen is reachable by any non-staff session.** It shows a "no access" notice when the server answers `visible: false`. Why: a deep link resolves before the first alerts read arrives.
12. **A pop-up compares against the previous read only**, as the spec says. An alert that clears and returns raises a pop-up again.

## File map

| File | Responsibility |
| --- | --- |
| `packages/identity/src/permissions.ts` | `fiscal.view` in the catalogue and manager set |
| `packages/core/src/incidents.ts` | tenant-scoped incident reads and the handled update |
| `packages/module/src/alerts.ts` | alert model, source and claim types, `ModuleAlerts` seat |
| `packages/payments/src/alerts.ts`, `packages/fiscal-verifactu/src/alerts.ts` | each area's event-code claim |
| `packages/composition/src/modules.ts` | fills the `alerts` seat, core's claims inline |
| `apps/server/src/alerts.ts` | registry, claim lookup, open and handled reads, sorting |
| `apps/server/src/alerts-api.ts` | the three routes |
| `apps/server/src/modules.ts`, `boot.ts` | assembly and mount |
| `packages/dashboard-kit/src/alert-messages.ts` | params-aware wording lookup |
| `apps/dashboard/src/i18n/alert-messages.ts`, `alerts.ts` | wording table (no imports) and its registration |
| `scripts/alert-codes.test.ts` | root guard: every incident code claimed and worded |
| `packages/ui/src/tokens/colors.css` | warning tokens |
| `packages/ui/src/components/wt-count-badge.ts`, `wt-toast.ts`, `wt-row-actions.ts` | shared components |
| `apps/dashboard/src/api/client.ts`, `api/live-queries.ts` | alert routes on the client |
| `apps/dashboard/src/state/alert-arrivals.ts` | which alerts are new since the previous read |
| `apps/dashboard/src/widgets/alert-format.ts`, `alerts-bell.ts` | shared formatting; the bell and panel |
| `apps/dashboard/src/screens/alerts-screen.ts` | the Alerts screen |
| `apps/dashboard/src/dashboard-app.ts` | bell, pop-up, screen routing |
| `docs/developers/design-system.md`, `docs/backlog.md`, `CLAUDE.md` | contract, backlog, guard pointer |

---

### Task 1: The `fiscal.view` permission

**Files:**
- Modify: `packages/identity/src/permissions.ts` (the `PERMISSIONS` tuple and the `MANAGER` set)
- Test: `packages/identity/src/permissions.test.ts`

**Interfaces:**
- Produces: the permission string `"fiscal.view"`, held by manager and admin.

- [ ] **Step 1: Write the failing test** — add beside the `system.manage` test:

```ts
  it("grants fiscal.view to manager and admin only", () => {
    expect(PERMISSIONS).toContain("fiscal.view");
    expect(roleHasPermission("manager", "fiscal.view")).toBe(true);
    expect(roleHasPermission("admin", "fiscal.view")).toBe(true);
    expect(roleHasPermission("supervisor", "fiscal.view")).toBe(false);
    expect(roleHasPermission("staff", "fiscal.view")).toBe(false);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/identity exec vitest run src/permissions.test.ts`
Expected: FAIL. `PERMISSIONS` does not contain `fiscal.view`. Typecheck may also flag the literal.

- [ ] **Step 3: Implement** — append after `"diagnostics.view",` in `PERMISSIONS`:

```ts
  // Seeing tax-filing alerts: rejected or diverging invoice records, chain and clock checks, and
  // submission delays; manager + admin.
  "fiscal.view",
```

and add `"fiscal.view",` after `"diagnostics.view",` in the `MANAGER` set.

- [ ] **Step 4: Find tests that pin a role's full permission list**

Run: `grep -rn '"diagnostics.view"' --include='*.test.ts' packages apps scripts`
For each hit that pins a whole list (`toEqual([...])`) of a manager's or admin's permissions, add `"fiscal.view"` in the same position the catalogue order gives it. Leave hits that only check membership alone.

- [ ] **Step 5: Run and verify**

Run: `pnpm --filter @waitron/identity exec vitest run src/permissions.test.ts` → PASS. Then run each test file edited in Step 4 with `pnpm --filter <its package> exec vitest run <file>` → PASS. Then `pnpm --filter @waitron/identity typecheck && pnpm format:check && pnpm lint`.

- [ ] **Step 6: Commit**

```bash
git add packages/identity/src/permissions.ts packages/identity/src/permissions.test.ts <files from step 4>
git commit -s -m "Add the fiscal.view permission for tax-filing alerts

Managers and admins hold it. The dashboard alerts use it to decide who
sees rejected invoice records and chain or clock problems."
```

---

### Task 2: Tenant-scoped incident reads and marking one handled

**Files:**
- Modify: `packages/core/src/incidents.ts`
- Modify: `packages/core/src/index.ts` (the `./incidents.js` export line)
- Modify: `packages/db/src/schema/incidents.ts` (one index); generated: a new `packages/db/drizzle/00NN_*.sql` plus its `meta/` snapshot and journal entry
- Test: `packages/core/src/incidents.test.ts`

**Interfaces:**
- Consumes: `incidents` table from `@waitron/db`; `Incident` from this file.
- Produces:

```ts
export interface TenantIncident extends Incident {
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
}
export function listOpenIncidents(tx: Transaction, tenantId: TenantId): Promise<TenantIncident[]>;
export function listHandledIncidents(tx: Transaction, tenantId: TenantId, handledSince: Date): Promise<TenantIncident[]>;
export function findIncident(tx: Transaction, tenantId: TenantId, id: string): Promise<TenantIncident | null>;
export function markIncidentHandled(
  tx: Transaction,
  input: { tenantId: TenantId; id: string; personId: string; handledAt: Date },
): Promise<void>;
```

`listOpenIncidents` is newest `detectedAt` first. `listHandledIncidents` returns incidents with `acknowledged_at >= handledSince`, newest `acknowledgedAt` first. `markIncidentHandled` changes nothing when the incident is already handled, so the first handler's time and person stay.

- [ ] **Step 1: Write the failing tests** — append to `incidents.test.ts`, and add the four new names to its `./incidents.js` import:

```ts
describe("tenant incident reads", () => {
  function chainFailed(forTill: TillId): RecordIncidentInput["error"] {
    return new AppError("chain.verification_failed", {
      tillId: forTill,
      issues: [{ issueCode: "predecessor-hash-mismatch", recordId: null, issueParams: {} }],
    });
  }

  async function raise(forTenant: TenantId, forTill: TillId, detectedAt: Date): Promise<void> {
    await withTenant(suite.db, forTenant, async (tx) => {
      await asAppUser(tx);
      await recordIncident(tx, {
        tenantId: forTenant,
        tillId: forTill,
        error: chainFailed(forTill),
        severity: "error",
        detectedAt,
      });
    });
  }

  function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  it("lists this tenant's open incidents across tills, newest first", async () => {
    const secondTill = await seedTenant(suite.db, { tenantId });
    await raise(tenantId, tillId, BASE);
    await raise(tenantId, secondTill.tillId, new Date(BASE.getTime() + 60_000));
    const rows = await asApp((tx) => listOpenIncidents(tx, tenantId));
    expect(rows.map((r) => r.tillId)).toEqual([secondTill.tillId, tillId]);
    expect(rows[0]).toMatchObject({ acknowledgedAt: null, acknowledgedBy: null });
  });

  it("never lists another tenant's incidents", async () => {
    const other = await seedTenant(suite.db);
    await raise(other.tenantId, other.tillId, BASE);
    expect(await asApp((tx) => listOpenIncidents(tx, tenantId))).toEqual([]);
  });

  it("finds an incident by id only within its tenant", async () => {
    const other = await seedTenant(suite.db);
    await raise(tenantId, tillId, BASE);
    await raise(other.tenantId, other.tillId, BASE);
    const [mine] = await asApp((tx) => listOpenIncidents(tx, tenantId));
    const theirs = await withTenant(suite.db, other.tenantId, async (tx) => {
      await asAppUser(tx);
      return (await listOpenIncidents(tx, other.tenantId))[0]!;
    });
    expect((await asApp((tx) => findIncident(tx, tenantId, mine!.id)))?.id).toBe(mine!.id);
    expect(await asApp((tx) => findIncident(tx, tenantId, theirs.id))).toBeNull();
  });

  it("marks an incident handled once; a second mark keeps the first time and person", async () => {
    await raise(tenantId, tillId, BASE);
    const [open] = await asApp((tx) => listOpenIncidents(tx, tenantId));
    const first = new Date(BASE.getTime() + 1_000);
    const firstPerson = "00000000-0000-4000-8000-000000000001";
    await asApp((tx) =>
      markIncidentHandled(tx, { tenantId, id: open!.id, personId: firstPerson, handledAt: first }),
    );
    await asApp((tx) =>
      markIncidentHandled(tx, {
        tenantId,
        id: open!.id,
        personId: "00000000-0000-4000-8000-000000000002",
        handledAt: new Date(BASE.getTime() + 9_000),
      }),
    );
    expect(await asApp((tx) => listOpenIncidents(tx, tenantId))).toEqual([]);
    const handled = await asApp((tx) => findIncident(tx, tenantId, open!.id));
    expect(handled?.acknowledgedAt?.toISOString()).toBe(first.toISOString());
    expect(handled?.acknowledgedBy).toBe(firstPerson);
  });

  it("does not mark another tenant's incident handled", async () => {
    const other = await seedTenant(suite.db);
    await raise(other.tenantId, other.tillId, BASE);
    const theirs = await withTenant(suite.db, other.tenantId, async (tx) => {
      await asAppUser(tx);
      return (await listOpenIncidents(tx, other.tenantId))[0]!;
    });
    await asApp((tx) =>
      markIncidentHandled(tx, {
        tenantId,
        id: theirs.id,
        personId: "00000000-0000-4000-8000-000000000001",
        handledAt: BASE,
      }),
    );
    const still = await withTenant(suite.db, other.tenantId, async (tx) => {
      await asAppUser(tx);
      return listOpenIncidents(tx, other.tenantId);
    });
    expect(still.map((r) => r.id)).toEqual([theirs.id]);
  });

  it("lists handled incidents inside the window, newest handled first", async () => {
    const secondTill = await seedTenant(suite.db, { tenantId });
    const thirdTill = await seedTenant(suite.db, { tenantId });
    await raise(tenantId, tillId, BASE);
    await raise(tenantId, secondTill.tillId, BASE);
    await raise(tenantId, thirdTill.tillId, BASE);
    const open = await asApp((tx) => listOpenIncidents(tx, tenantId));
    const byTill = new Map(open.map((r) => [r.tillId, r.id]));
    const person = "00000000-0000-4000-8000-000000000001";
    const mark = (till: TillId, at: Date) =>
      asApp((tx) =>
        markIncidentHandled(tx, { tenantId, id: byTill.get(till)!, personId: person, handledAt: at }),
      );
    await mark(tillId, new Date("2026-03-10T10:00:00Z"));
    await mark(secondTill.tillId, new Date("2026-03-12T10:00:00Z"));
    await mark(thirdTill.tillId, new Date("2026-02-01T10:00:00Z"));
    const rows = await asApp((tx) =>
      listHandledIncidents(tx, tenantId, new Date("2026-03-01T00:00:00Z")),
    );
    expect(rows.map((r) => r.tillId)).toEqual([secondTill.tillId, tillId]);
  });
});
```

Add `Transaction` to the existing `@waitron/db` type imports if it is not there (`import type { Transaction } from "@waitron/db";`).

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/core exec vitest run src/incidents.test.ts`
Expected: FAIL. The four functions are not exported from `./incidents.js`.

- [ ] **Step 3: Implement** — in `packages/core/src/incidents.ts`, change the drizzle import to `import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";` and append:

```ts
/** An incident as the dashboard alerts read it: who handled it and when, if anyone has. */
export interface TenantIncident extends Incident {
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
}

const tenantIncidentColumns = {
  id: incidents.id,
  tillId: incidents.tillId,
  saleId: incidents.saleId,
  code: incidents.code,
  params: incidents.params,
  severity: incidents.severity,
  detectedAt: incidents.detectedAt,
  acknowledgedAt: incidents.acknowledgedAt,
  acknowledgedBy: incidents.acknowledgedBy,
};

type TenantIncidentRow = {
  id: string;
  tillId: string;
  saleId: string | null;
  code: string;
  params: Record<string, unknown>;
  severity: string;
  detectedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
};

function toTenantIncident(row: TenantIncidentRow): TenantIncident {
  return {
    id: row.id,
    tillId: row.tillId as TillId,
    saleId: row.saleId as SaleId | null,
    code: row.code,
    params: row.params,
    severity: row.severity as IncidentSeverity,
    detectedAt: new Date(row.detectedAt),
    acknowledgedAt: row.acknowledgedAt === null ? null : new Date(row.acknowledgedAt),
    acknowledgedBy: row.acknowledgedBy,
  };
}

/** Every open incident in the tenant, newest first. */
export async function listOpenIncidents(
  tx: Transaction,
  tenantId: TenantId,
): Promise<TenantIncident[]> {
  const rows = await tx
    .select(tenantIncidentColumns)
    .from(incidents)
    .where(and(eq(incidents.tenantId, tenantId), isNull(incidents.acknowledgedAt)))
    .orderBy(desc(incidents.detectedAt));
  return rows.map(toTenantIncident);
}

/** Incidents handled at or after `handledSince`, most recently handled first. */
export async function listHandledIncidents(
  tx: Transaction,
  tenantId: TenantId,
  handledSince: Date,
): Promise<TenantIncident[]> {
  const rows = await tx
    .select(tenantIncidentColumns)
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        gte(incidents.acknowledgedAt, handledSince.toISOString()),
      ),
    )
    .orderBy(desc(incidents.acknowledgedAt));
  return rows.map(toTenantIncident);
}

/** One incident by id, scoped to the tenant: another tenant's id reads as absent. */
export async function findIncident(
  tx: Transaction,
  tenantId: TenantId,
  id: string,
): Promise<TenantIncident | null> {
  const [row] = await tx
    .select(tenantIncidentColumns)
    .from(incidents)
    .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, id)));
  return row === undefined ? null : toTenantIncident(row);
}

/**
 * Marks an open incident handled. An already-handled incident keeps its first handler and time, so
 * two people handling at once both succeed. Handling frees the `incidents_open_dedup` key: a
 * producer that detects the same condition again records a new incident.
 */
export async function markIncidentHandled(
  tx: Transaction,
  input: { tenantId: TenantId; id: string; personId: string; handledAt: Date },
): Promise<void> {
  await tx
    .update(incidents)
    .set({ acknowledgedAt: input.handledAt.toISOString(), acknowledgedBy: input.personId })
    .where(
      and(
        eq(incidents.tenantId, input.tenantId),
        eq(incidents.id, input.id),
        isNull(incidents.acknowledgedAt),
      ),
    );
}
```

In `packages/core/src/index.ts` replace the incidents export line with:

```ts
export {
  findIncident,
  listHandledIncidents,
  listOpenIncidents,
  markIncidentHandled,
  openIncidents,
  recordIncident,
  recordIncidentOnce,
} from "./incidents.js";
export type { TenantIncident } from "./incidents.js";
```

(If `index.ts` already exports the `Incident` types on another line, keep that line.)

- [ ] **Step 3b: Index the handled read**

The open read matches the shape of the partial unique index `incidents_open_dedup` (`tenant_id` first, `WHERE acknowledged_at IS NULL`); whether the planner uses it has not been measured. The handled read filters and sorts on `acknowledged_at`, which no index covers. Add to the index list in `packages/db/src/schema/incidents.ts`:

```ts
    // The dashboard's Handled tab: incidents handled since a date, most recent first.
    index("incidents_handled_idx").on(t.acknowledgedAt),
```

It is keyed on `acknowledged_at` alone, not `(tenant_id, acknowledged_at)`, so it survives `feat/drop-tenant-id` removing the column. Then generate the migration and read it:

```bash
pnpm --filter @waitron/db db:generate
git status --short packages/db/drizzle
```

Expected: one new `.sql` file containing only `CREATE INDEX "incidents_handled_idx" ON "incidents" USING btree ("acknowledged_at");`, plus the snapshot and journal changes. If it contains anything else, stop and report: the schema and the migrations had already drifted. Then run `pnpm vitest run scripts/journal-monotonic.test.ts scripts/classification-complete.test.ts` → PASS.

If a rebase later collides on the migration number, regenerate (CLAUDE.md §3); never hand-edit the snapshot or journal.

- [ ] **Step 4: Run and verify**

Run: `pnpm --filter @waitron/core exec vitest run src/incidents.test.ts` → PASS.
Mutation check: delete `eq(incidents.tenantId, tenantId),` from `findIncident` → "finds an incident by id only within its tenant" FAILS. Delete `isNull(incidents.acknowledgedAt),` from `markIncidentHandled` → the "second mark keeps the first" test FAILS. Restore both.
Then `pnpm --filter @waitron/core typecheck && pnpm format:check && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/incidents.ts packages/core/src/incidents.test.ts packages/core/src/index.ts \
  packages/db/src/schema/incidents.ts packages/db/drizzle
git commit -s -m "Read a tenant's incidents and mark one handled

Adds the reads the dashboard alerts need: every open incident in the
tenant, incidents handled since a date, one incident by id, and marking
one handled. Every read is limited to the tenant. Marking an incident
that is already handled changes nothing, so the first person and time
are kept. A new index on acknowledged_at serves the handled list, which
no existing index covered."
```

---

### Task 3: The `alerts` module seat and each area's event-code claim

**Files:**
- Create: `packages/module/src/alerts.ts`
- Modify: `packages/module/src/module.ts` (add the seat to `WaitronModule`), `packages/module/src/index.ts`
- Create: `packages/payments/src/alerts.ts`, `packages/payments/src/alerts.test.ts`; modify `packages/payments/src/index.ts`
- Create: `packages/fiscal-verifactu/src/alerts.ts`, `packages/fiscal-verifactu/src/alerts.test.ts`; modify `packages/fiscal-verifactu/src/index.ts`
- Modify: `packages/composition/src/modules.ts`, `packages/composition/src/composition.test.ts`
- Modify: `apps/server/src/modules.ts`, `apps/server/src/modules.test.ts`

**Interfaces:**
- Produces (`@waitron/module`):

```ts
export type AlertSeverity = "warning" | "error";
export interface Alert {
  readonly key: string;              // event: `incident:<id>`; ongoing: `<code>:<subject>`
  readonly kind: "event" | "ongoing";
  readonly code: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly severity: AlertSeverity;
  readonly since: string | null;     // ISO-8601
  readonly area: string;
  readonly screen?: string;          // ongoing only
  readonly handledAt?: string;       // handled events only, ISO-8601
  readonly handledBy?: string | null;
}
export type OngoingAlert = Pick<Alert, "key" | "code" | "params" | "severity" | "since" | "screen">;
export interface AlertReadContext { readonly tx: Transaction; readonly tenantId: TenantId; readonly now: Date }
export interface AlertSource {
  readonly area: string;
  readonly permission: string;
  read(ctx: AlertReadContext): Promise<readonly OngoingAlert[]>;
}
export interface AlertEventClaim { readonly prefix: string; readonly area: string; readonly permission: string }
export interface ModuleAlerts {
  readonly events?: readonly AlertEventClaim[];
  readonly sources?: readonly AlertSource[];
}
```

- Produces: `PAYMENTS_ALERTS` (`@waitron/payments`), `FISCAL_ALERTS` (`@waitron/fiscal-verifactu`), `ALL_ALERT_CLAIMS: readonly AlertEventClaim[]` and `enabledAlertSources(modules): readonly AlertSource[]` (`apps/server/src/modules.ts`).

- [ ] **Step 1: Write the failing tests**

`packages/payments/src/alerts.test.ts`:

```ts
import { expect, it } from "vitest";
import { PAYMENTS_ALERTS } from "./index.js";

it("claims payment. incidents for the payments area under payments.manage", () => {
  expect(PAYMENTS_ALERTS).toEqual({
    events: [{ prefix: "payment.", area: "payments", permission: "payments.manage" }],
  });
});
```

`packages/fiscal-verifactu/src/alerts.test.ts`:

```ts
import { expect, it } from "vitest";
import { FISCAL_ALERTS } from "./index.js";

it("claims fiscal. incidents for the fiscal area under fiscal.view", () => {
  expect(FISCAL_ALERTS).toEqual({
    events: [{ prefix: "fiscal.", area: "fiscal", permission: "fiscal.view" }],
  });
});
```

In `packages/composition/src/composition.test.ts`, import `PAYMENTS_ALERTS` from `@waitron/payments` and `FISCAL_ALERTS` from `@waitron/fiscal-verifactu` beside the existing imports, and add:

```ts
describe("ALL_MODULES alerts seat", () => {
  it("payments and fiscal-verifactu carry their event-code claims, by reference", () => {
    expect(ALL_MODULES.find((m) => m.name === "payments")?.alerts).toBe(PAYMENTS_ALERTS);
    expect(ALL_MODULES.find((m) => m.name === "fiscal-verifactu")?.alerts).toBe(FISCAL_ALERTS);
  });
  it("core claims chain. and clock. incidents for the fiscal area under fiscal.view", () => {
    expect(ALL_MODULES.find((m) => m.name === "core")?.alerts).toEqual({
      events: [
        { prefix: "chain.", area: "fiscal", permission: "fiscal.view" },
        { prefix: "clock.", area: "fiscal", permission: "fiscal.view" },
      ],
    });
  });
});
```

In `apps/server/src/modules.test.ts` add (import `ALL_ALERT_CLAIMS`, `enabledAlertSources` from `./modules.js` and `WaitronModule`/`AlertSource` types from `@waitron/module`):

```ts
describe("alert assembly", () => {
  it("collects every module's event-code claims", () => {
    expect(ALL_ALERT_CLAIMS.map((c) => c.prefix)).toEqual(
      expect.arrayContaining(["chain.", "clock.", "payment.", "fiscal."]),
    );
  });

  it("collects sources from the modules it is given only", () => {
    const source: AlertSource = {
      area: "test",
      permission: "diagnostics.view",
      read: () => Promise.resolve([]),
    };
    const withSource = { ...ALL_MODULES[0]!, alerts: { sources: [source] } } as WaitronModule;
    expect(enabledAlertSources([withSource])).toEqual([source]);
    expect(enabledAlertSources([ALL_MODULES[0]!])).toEqual([]);
  });
});
```

(If `modules.test.ts` lacks a `describe`/`it`/`expect` or `ALL_MODULES` import, add them.)

- [ ] **Step 2: Run them and watch them fail**

Run each:
`pnpm --filter @waitron/payments exec vitest run src/alerts.test.ts`
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/alerts.test.ts`
`pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`
`pnpm --filter @waitron/server exec vitest run src/modules.test.ts`
Expected: each FAILS on a missing export.

- [ ] **Step 3: Implement**

`packages/module/src/alerts.ts`:

```ts
import type { Transaction } from "@waitron/db";
import type { TenantId } from "@waitron/shared";

export type AlertSeverity = "warning" | "error";

/** One alert as the dashboard receives it. An event is a recorded incident and stays until someone
 * marks it handled; an ongoing alert exists only while the check that raised it still finds it. */
export interface Alert {
  readonly key: string;
  readonly kind: "event" | "ongoing";
  readonly code: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly severity: AlertSeverity;
  readonly since: string | null;
  readonly area: string;
  readonly screen?: string;
  readonly handledAt?: string;
  readonly handledBy?: string | null;
}

/** What a source returns; the registry stamps `kind` and `area` from the source itself. */
export type OngoingAlert = Pick<Alert, "key" | "code" | "params" | "severity" | "since" | "screen">;

export interface AlertReadContext {
  readonly tx: Transaction;
  readonly tenantId: TenantId;
  readonly now: Date;
}

/** An ongoing check, asked only when the session holds `permission`. */
export interface AlertSource {
  readonly area: string;
  readonly permission: string;
  read(ctx: AlertReadContext): Promise<readonly OngoingAlert[]>;
}

/** Incidents whose code starts with `prefix` belong to `area` and need `permission` to see. */
export interface AlertEventClaim {
  readonly prefix: string;
  readonly area: string;
  readonly permission: string;
}

export interface ModuleAlerts {
  readonly events?: readonly AlertEventClaim[];
  readonly sources?: readonly AlertSource[];
}
```

In `packages/module/src/module.ts` add `import type { ModuleAlerts } from "./alerts.js";` and, inside `WaitronModule` after `venueService`:

```ts
  /** Incident codes this module claims for the dashboard alerts, and its ongoing checks. Claims are
   * read from every module; sources only from enabled modules, since a disabled module's tables are
   * not migrated. */
  readonly alerts?: ModuleAlerts;
```

In `packages/module/src/index.ts` add:

```ts
export type {
  Alert,
  AlertEventClaim,
  AlertReadContext,
  AlertSeverity,
  AlertSource,
  ModuleAlerts,
  OngoingAlert,
} from "./alerts.js";
```

`packages/payments/src/alerts.ts` (payments does not depend on `@waitron/module`; the composition root checks the shape):

```ts
/** The payments area's claim on `payment.` incidents, for the dashboard alerts seat. */
export const PAYMENTS_ALERTS = {
  events: [{ prefix: "payment.", area: "payments", permission: "payments.manage" }],
} as const;
```

and in `packages/payments/src/index.ts`: `export { PAYMENTS_ALERTS } from "./alerts.js";`

`packages/fiscal-verifactu/src/alerts.ts`:

```ts
import type { ModuleAlerts } from "@waitron/module";

/** The fiscal area's claim on `fiscal.` incidents, for the dashboard alerts seat. */
export const FISCAL_ALERTS: ModuleAlerts = {
  events: [{ prefix: "fiscal.", area: "fiscal", permission: "fiscal.view" }],
};
```

and in `packages/fiscal-verifactu/src/index.ts`: `export { FISCAL_ALERTS } from "./alerts.js";`

In `packages/composition/src/modules.ts`: add `PAYMENTS_ALERTS` to the `@waitron/payments` import and `FISCAL_ALERTS` to the `@waitron/fiscal-verifactu` import; add `alerts: PAYMENTS_ALERTS,` to the `payments` descriptor and `alerts: FISCAL_ALERTS,` to the `fiscal-verifactu` descriptor; and add to the `core` descriptor, after its `migrations` line:

```ts
    // Core's own incident codes: chain integrity and clock trust, shown with the tax-filing alerts.
    alerts: {
      events: [
        { prefix: "chain.", area: "fiscal", permission: "fiscal.view" },
        { prefix: "clock.", area: "fiscal", permission: "fiscal.view" },
      ],
    },
```

In `apps/server/src/modules.ts`: extend the `@waitron/module` type import with `AlertEventClaim, AlertSource`, and append:

```ts
/** Every module's incident-code claims. Read from ALL_MODULES: an incident recorded while a module
 * was enabled keeps its area after the module is switched off. */
export const ALL_ALERT_CLAIMS: readonly AlertEventClaim[] = ALL_MODULES.flatMap(
  (m) => m.alerts?.events ?? [],
);

/** The ongoing checks of the modules given — boot passes the enabled set, because a disabled
 * module's tables are not migrated. */
export function enabledAlertSources(modules: readonly WaitronModule[]): readonly AlertSource[] {
  return modules.flatMap((m) => m.alerts?.sources ?? []);
}
```

- [ ] **Step 4: Run and verify**

Run the four commands from Step 2 → PASS. Then:
`pnpm --filter @waitron/module typecheck && pnpm --filter @waitron/payments typecheck && pnpm --filter @waitron/fiscal-verifactu typecheck && pnpm --filter @waitron/composition typecheck && pnpm --filter @waitron/server typecheck && pnpm format:check && pnpm lint`
Also run the root guards that read descriptors and package manifests: `pnpm vitest run scripts/module-seams.test.ts scripts/workspace-cycles.test.ts scripts/errors-reachable.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/module/src/alerts.ts packages/module/src/module.ts packages/module/src/index.ts \
  packages/payments/src/alerts.ts packages/payments/src/alerts.test.ts packages/payments/src/index.ts \
  packages/fiscal-verifactu/src/alerts.ts packages/fiscal-verifactu/src/alerts.test.ts packages/fiscal-verifactu/src/index.ts \
  packages/composition/src/modules.ts packages/composition/src/composition.test.ts \
  apps/server/src/modules.ts apps/server/src/modules.test.ts
git commit -s -m "Add an alerts seat to modules and claim each area's incident codes

A module can now say which incident codes belong to it, which area they
show under and which permission is needed to see them, and it can offer
ongoing checks. Payments claims payment. codes under payments.manage and
fiscal-verifactu claims fiscal. codes under fiscal.view, and core claims
its chain. and clock. codes under fiscal.view."
```

---

### Task 4: The server alert registry and reads

**Files:**
- Create: `apps/server/src/alerts.ts`, `apps/server/src/alerts.test.ts`
- Modify: `apps/server/src/errors.ts` (register two codes)

**Interfaces:**
- Consumes: Task 2's `listOpenIncidents`, `listHandledIncidents`, `TenantIncident`; Task 3's types.
- Produces:

```ts
export const UNCLAIMED: AlertEventClaim;          // { prefix: "", area: "diagnostics", permission: "diagnostics.view" }
export const HANDLED_WINDOW_MS: number;           // 30 days
export interface AlertRegistry { readonly claims: readonly AlertEventClaim[]; readonly sources: readonly AlertSource[] }
export function createAlertRegistry(parts: { claims: readonly AlertEventClaim[]; sources: readonly AlertSource[] }): AlertRegistry;
export function claimFor(registry: AlertRegistry, code: string): AlertEventClaim;
export function alertsVisible(registry: AlertRegistry, held: ReadonlySet<string>): boolean;
export function incidentKey(id: string): string;  // `incident:<id>`
export interface AlertReadDeps { registry: AlertRegistry; tenantId: TenantId; now: Date; log: Logger }
export function readOpenAlerts(tx: Transaction, deps: AlertReadDeps, held: ReadonlySet<string>): Promise<Alert[]>;
export function readHandledAlerts(tx: Transaction, deps: AlertReadDeps, held: ReadonlySet<string>): Promise<Alert[]>;
```

Open alerts sort: `error` before `warning`, then newest `since` first, `null` since last, then `key`.

- [ ] **Step 1: Register the codes** — in `apps/server/src/errors.ts`, inside `interface ErrorParams`, add beside `"diagnostics.invalid_verbosity"`:

```ts
    /** No incident with this id exists in this venue. Also answered for a malformed id and for
     * another tenant's incident, so the answer never reveals which. */
    "alert.not_found": { id: string };
    /** An alert source failed while being read. Its alerts are replaced by this one, under the
     * source's own area and permission. Built as data, never thrown. */
    "alert.source_unavailable": { area: string };
```

- [ ] **Step 2: Write the failing tests** — `apps/server/src/alerts.test.ts`:

```ts
// PGlite: reads on one transaction, no concurrency and no connection-role question.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { listOpenIncidents, markIncidentHandled, recordIncident } from "@waitron/core";
import { hashPin } from "@waitron/identity";
import type { AlertSource } from "@waitron/module";
import type { Logger } from "@waitron/server-kit";
import { AppError, tillId as brandTillId, type TenantId, type TillId } from "@waitron/shared";
import {
  HANDLED_WINDOW_MS,
  UNCLAIMED,
  alertsVisible,
  claimFor,
  createAlertRegistry,
  readHandledAlerts,
  readOpenAlerts,
} from "./alerts.js";
import { ALL_ALERT_CLAIMS } from "./modules.js";
import "./errors.js";

const suite = usePgliteDb({ migrations: migrationOptionsFor(manifestSets(), null), timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const NOW = new Date("2026-09-14T12:00:00.000Z");
const noopLog: Logger = () => {};
const registry = createAlertRegistry({
  claims: ALL_ALERT_CLAIMS,
  sources: [],
});
const EVERYTHING = new Set(["fiscal.view", "payments.manage", "diagnostics.view"]);

async function seedVenue(): Promise<{ tenantId: TenantId; tillId: TillId }> {
  const tenantId = await seedTenant(db);
  const location = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Sala', array['es-ES'], 'Venta en establecimiento') returning id`);
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${location.rows[0]!.id}, 'Caja 1') returning id`);
  return { tenantId, tillId: brandTillId(till.rows[0]!.id) };
}

function asApp<T>(tenantId: TenantId, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Records an incident with an arbitrary code; the registry is what is under test, not the code. */
function raise(
  v: { tenantId: TenantId; tillId: TillId },
  code: string,
  severity: "warning" | "error",
  detectedAt: Date,
): Promise<void> {
  return asApp(v.tenantId, (tx) =>
    recordIncident(tx, {
      tenantId: v.tenantId,
      tillId: v.tillId,
      error: new AppError(code as never, {} as never),
      severity,
      detectedAt,
    }),
  );
}

describe("claims", () => {
  it("takes the longest matching prefix and falls back to diagnostics", () => {
    const r = createAlertRegistry({
      claims: [
        { prefix: "payment.", area: "payments", permission: "payments.manage" },
        { prefix: "payment.reconcile_", area: "reconcile", permission: "fiscal.view" },
      ],
      sources: [],
    });
    expect(claimFor(r, "payment.reconcile_drift").area).toBe("reconcile");
    expect(claimFor(r, "payment.offline_forward_declined").area).toBe("payments");
    expect(claimFor(r, "printing.mystery")).toEqual(UNCLAIMED);
  });

  it("refuses two claims on the same prefix", () => {
    expect(() =>
      createAlertRegistry({
        claims: [
          { prefix: "payment.", area: "a", permission: "payments.manage" },
          { prefix: "payment.", area: "b", permission: "payments.manage" },
        ],
        sources: [],
      }),
    ).toThrow(/payment\./);
  });

  it("is visible to a session holding any claim or source permission, including diagnostics", () => {
    expect(alertsVisible(registry, new Set(["payments.manage"]))).toBe(true);
    expect(alertsVisible(registry, new Set(["diagnostics.view"]))).toBe(true);
    expect(alertsVisible(registry, new Set(["report.view"]))).toBe(false);
  });
});

describe("readOpenAlerts", () => {
  it("shows a session only the areas it holds", async () => {
    const v = await seedVenue();
    await raise(v, "payment.offline_forward_declined", "error", NOW);
    await raise(v, "fiscal.registro_rechazado", "error", NOW);
    await raise(v, "chain.verification_failed", "error", NOW);
    await raise(v, "printing.mystery", "warning", NOW);
    const deps = { registry, tenantId: v.tenantId, now: NOW, log: noopLog };
    const paymentsOnly = await asApp(v.tenantId, (tx) =>
      readOpenAlerts(tx, deps, new Set(["payments.manage"])),
    );
    expect(paymentsOnly.map((a) => a.code)).toEqual(["payment.offline_forward_declined"]);
    const all = await asApp(v.tenantId, (tx) => readOpenAlerts(tx, deps, EVERYTHING));
    expect(all.map((a) => [a.code, a.area]).sort()).toEqual([
      ["chain.verification_failed", "fiscal"],
      ["fiscal.registro_rechazado", "fiscal"],
      ["payment.offline_forward_declined", "payments"],
      ["printing.mystery", "diagnostics"],
    ]);
  });

  it("builds an event alert from the incident", async () => {
    const v = await seedVenue();
    await raise(v, "payment.offline_forward_declined", "error", NOW);
    const [incident] = await asApp(v.tenantId, (tx) => listOpenIncidents(tx, v.tenantId));
    const [alert] = await asApp(v.tenantId, (tx) =>
      readOpenAlerts(tx, { registry, tenantId: v.tenantId, now: NOW, log: noopLog }, EVERYTHING),
    );
    expect(alert).toEqual({
      key: `incident:${incident!.id}`,
      kind: "event",
      code: "payment.offline_forward_declined",
      params: {},
      severity: "error",
      since: NOW.toISOString(),
      area: "payments",
    });
  });

  it("puts errors first, then the newest", async () => {
    const v = await seedVenue();
    await raise(v, "payment.offline_forward_declined", "warning", new Date(NOW.getTime() - 1_000));
    await raise(v, "fiscal.registro_rechazado", "error", new Date(NOW.getTime() - 5_000));
    await raise(v, "chain.verification_failed", "error", new Date(NOW.getTime() - 2_000));
    const alerts = await asApp(v.tenantId, (tx) =>
      readOpenAlerts(tx, { registry, tenantId: v.tenantId, now: NOW, log: noopLog }, EVERYTHING),
    );
    expect(alerts.map((a) => a.code)).toEqual([
      "chain.verification_failed",
      "fiscal.registro_rechazado",
      "payment.offline_forward_declined",
    ]);
  });

  it("asks only the sources whose permission the session holds, and stamps kind and area", async () => {
    const v = await seedVenue();
    const held: AlertSource = {
      area: "printing",
      permission: "payments.manage",
      read: vi.fn(async () => [
        { key: "printing.agent_silent:a1", code: "printing.agent_silent", params: {}, severity: "warning" as const, since: null, screen: "printers" },
      ]),
    };
    const notHeld: AlertSource = { area: "backup", permission: "system.manage", read: vi.fn(async () => []) };
    const r = createAlertRegistry({ claims: [], sources: [held, notHeld] });
    const alerts = await asApp(v.tenantId, (tx) =>
      readOpenAlerts(tx, { registry: r, tenantId: v.tenantId, now: NOW, log: noopLog }, new Set(["payments.manage"])),
    );
    expect(alerts).toEqual([
      { key: "printing.agent_silent:a1", kind: "ongoing", code: "printing.agent_silent", params: {}, severity: "warning", since: null, screen: "printers", area: "printing" },
    ]);
    expect(notHeld.read).not.toHaveBeenCalled();
  });

  it("replaces a failing source with source_unavailable and keeps reading the others", async () => {
    const v = await seedVenue();
    const log = vi.fn<Logger>();
    const failing: AlertSource = {
      area: "backup",
      permission: "diagnostics.view",
      // A failed QUERY, not just a throw: without a savepoint it would abort the shared transaction.
      read: async ({ tx }) => {
        await tx.execute(sql`select * from no_such_table`);
        return [];
      },
    };
    const healthy: AlertSource = {
      area: "printing",
      permission: "diagnostics.view",
      read: async ({ tx }) => {
        await tx.execute(sql`select 1`);
        return [{ key: "printing.jobs_waiting:p1", code: "printing.jobs_waiting", params: {}, severity: "error", since: null }];
      },
    };
    const r = createAlertRegistry({ claims: [], sources: [failing, healthy] });
    await raise(v, "payment.offline_forward_declined", "warning", NOW);
    const alerts = await asApp(v.tenantId, (tx) =>
      readOpenAlerts(tx, { registry: r, tenantId: v.tenantId, now: NOW, log }, new Set(["diagnostics.view"])),
    );
    // This registry claims nothing, so the payment incident shows under diagnostics.
    expect(alerts.map((a) => a.code).sort()).toEqual([
      "alert.source_unavailable",
      "payment.offline_forward_declined",
      "printing.jobs_waiting",
    ]);
    expect(alerts.find((a) => a.code === "alert.source_unavailable")).toEqual({
      key: "alert.source_unavailable:backup",
      kind: "ongoing",
      code: "alert.source_unavailable",
      params: { area: "backup" },
      severity: "error",
      since: NOW.toISOString(),
      area: "backup",
    });
    expect(log).toHaveBeenCalledWith(
      "error",
      "alert.source_unavailable",
      expect.objectContaining({ area: "backup" }),
    );
  });
});

describe("readHandledAlerts", () => {
  it("lists handled events from the last 30 days with who handled them", async () => {
    const v = await seedVenue();
    const person = await asApp(v.tenantId, async (tx) => {
      const p = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${v.tenantId}, 'Ada', ${hashPin("1234")}, 'manager') returning id`);
      return p.rows[0]!.id;
    });
    await raise(v, "payment.offline_forward_declined", "error", NOW);
    await raise(v, "fiscal.registro_rechazado", "error", NOW);
    await raise(v, "chain.verification_failed", "error", NOW);
    const open = await asApp(v.tenantId, (tx) => listOpenIncidents(tx, v.tenantId));
    const byCode = new Map(open.map((i) => [i.code, i.id]));
    const mark = (code: string, personId: string, ageMs: number) =>
      asApp(v.tenantId, (tx) =>
        markIncidentHandled(tx, {
          tenantId: v.tenantId,
          id: byCode.get(code)!,
          personId,
          handledAt: new Date(NOW.getTime() - ageMs),
        }),
      );
    const DAY = 24 * 60 * 60 * 1000;
    await mark("payment.offline_forward_declined", person, 29 * DAY);
    await mark("fiscal.registro_rechazado", "00000000-0000-4000-8000-00000000abcd", DAY);
    await mark("chain.verification_failed", person, HANDLED_WINDOW_MS + DAY);
    const handled = await asApp(v.tenantId, (tx) =>
      readHandledAlerts(tx, { registry, tenantId: v.tenantId, now: NOW, log: noopLog }, EVERYTHING),
    );
    expect(handled.map((a) => [a.code, a.handledBy])).toEqual([
      ["fiscal.registro_rechazado", null],
      ["payment.offline_forward_declined", "Ada"],
    ]);
    expect(handled[1]!.handledAt).toBe(new Date(NOW.getTime() - 29 * DAY).toISOString());
    const paymentsOnly = await asApp(v.tenantId, (tx) =>
      readHandledAlerts(tx, { registry, tenantId: v.tenantId, now: NOW, log: noopLog }, new Set(["payments.manage"])),
    );
    expect(paymentsOnly.map((a) => a.code)).toEqual(["payment.offline_forward_declined"]);
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts`
Expected: FAIL. `./alerts.js` does not exist.

- [ ] **Step 4: Implement** — `apps/server/src/alerts.ts`:

```ts
import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { listHandledIncidents, listOpenIncidents, type TenantIncident } from "@waitron/core";
import { persons } from "@waitron/identity";
import type { Alert, AlertEventClaim, AlertSource } from "@waitron/module";
import { codeOf, type Logger } from "@waitron/server-kit";
import type { TenantId } from "@waitron/shared";
import "./errors.js";

/** Where an incident whose code no area claims is shown, so a new code is never recorded and then
 * hidden from everyone. */
export const UNCLAIMED: AlertEventClaim = {
  prefix: "",
  area: "diagnostics",
  permission: "diagnostics.view",
};

export const HANDLED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface AlertRegistry {
  readonly claims: readonly AlertEventClaim[];
  readonly sources: readonly AlertSource[];
}

export function createAlertRegistry(parts: {
  claims: readonly AlertEventClaim[];
  sources: readonly AlertSource[];
}): AlertRegistry {
  const seen = new Set<string>();
  for (const claim of parts.claims) {
    if (seen.has(claim.prefix)) throw new Error(`two alert claims on the prefix "${claim.prefix}"`);
    seen.add(claim.prefix);
  }
  return { claims: [...parts.claims], sources: [...parts.sources] };
}

export function claimFor(registry: AlertRegistry, code: string): AlertEventClaim {
  let best: AlertEventClaim | undefined;
  for (const claim of registry.claims) {
    if (code.startsWith(claim.prefix) && (best === undefined || claim.prefix.length > best.prefix.length))
      best = claim;
  }
  return best ?? UNCLAIMED;
}

export function alertsVisible(registry: AlertRegistry, held: ReadonlySet<string>): boolean {
  return [UNCLAIMED, ...registry.claims, ...registry.sources].some((p) => held.has(p.permission));
}

export function incidentKey(id: string): string {
  return `incident:${id}`;
}

export interface AlertReadDeps {
  registry: AlertRegistry;
  tenantId: TenantId;
  now: Date;
  log: Logger;
}

function eventAlert(incident: TenantIncident, claim: AlertEventClaim): Alert {
  return {
    key: incidentKey(incident.id),
    kind: "event",
    code: incident.code,
    params: incident.params,
    severity: incident.severity,
    since: incident.detectedAt.toISOString(),
    area: claim.area,
  };
}

const SEVERITY_RANK = { error: 0, warning: 1 } as const;

function compareOpen(a: Alert, b: Alert): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.since !== b.since) {
    if (a.since === null) return 1;
    if (b.since === null) return -1;
    return a.since < b.since ? 1 : -1;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export async function readOpenAlerts(
  tx: Transaction,
  deps: AlertReadDeps,
  held: ReadonlySet<string>,
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  for (const incident of await listOpenIncidents(tx, deps.tenantId)) {
    const claim = claimFor(deps.registry, incident.code);
    if (held.has(claim.permission)) alerts.push(eventAlert(incident, claim));
  }
  for (const source of deps.registry.sources) {
    if (!held.has(source.permission)) continue;
    try {
      // A savepoint per source: a failed query aborts only this source's work, not the transaction
      // every later source reads on.
      const found = await tx.transaction((sp) =>
        source.read({ tx: sp, tenantId: deps.tenantId, now: deps.now }),
      );
      for (const alert of found) alerts.push({ ...alert, kind: "ongoing", area: source.area });
    } catch (error) {
      deps.log("error", "alert.source_unavailable", { area: source.area, errorCode: codeOf(error) });
      alerts.push({
        key: `alert.source_unavailable:${source.area}`,
        kind: "ongoing",
        code: "alert.source_unavailable",
        params: { area: source.area },
        severity: "error",
        since: deps.now.toISOString(),
        area: source.area,
      });
    }
  }
  return alerts.sort(compareOpen);
}

export async function readHandledAlerts(
  tx: Transaction,
  deps: AlertReadDeps,
  held: ReadonlySet<string>,
): Promise<Alert[]> {
  const since = new Date(deps.now.getTime() - HANDLED_WINDOW_MS);
  const visible = (await listHandledIncidents(tx, deps.tenantId, since)).flatMap((incident) => {
    const claim = claimFor(deps.registry, incident.code);
    return held.has(claim.permission) ? [{ incident, claim }] : [];
  });
  const ids = [...new Set(visible.flatMap(({ incident }) => incident.acknowledgedBy ?? []))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const rows = await tx
      .select({ id: persons.id, displayName: persons.displayName })
      .from(persons)
      .where(and(eq(persons.tenantId, deps.tenantId), inArray(persons.id, ids)));
    for (const row of rows) names.set(row.id, row.displayName);
  }
  return visible.map(({ incident, claim }) => ({
    ...eventAlert(incident, claim),
    handledAt: incident.acknowledgedAt!.toISOString(),
    handledBy: incident.acknowledgedBy === null ? null : (names.get(incident.acknowledgedBy) ?? null),
  }));
}
```

`acknowledgedAt!` is safe: `listHandledIncidents` selects only rows with `acknowledged_at` at or after a date, which excludes nulls.

- [ ] **Step 5: Run and verify**

Run: `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts src/modules.test.ts` → PASS.
Mutation check: replace `tx.transaction((sp) => source.read({ tx: sp, ...}))` with `source.read({ tx, tenantId: deps.tenantId, now: deps.now })` → "replaces a failing source" FAILS (the healthy source also fails with an aborted transaction). Restore.
Then `pnpm --filter @waitron/server typecheck && pnpm format:check && pnpm lint && pnpm vitest run scripts/module-seams.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/alerts.ts apps/server/src/alerts.test.ts apps/server/src/errors.ts
git commit -s -m "Work out a session's open and handled alerts on the server

Incidents are shown under the area that claims their code, and only to
people who hold that area's permission. An incident no area claims is
shown to anyone with diagnostics.view. Ongoing checks run one at a time,
each in its own savepoint. A check that fails is replaced by one
alert.source_unavailable alert and the rest still run. Handled incidents
from the last 30 days come back with the name of whoever handled them."
```

---

### Task 5: The alert routes and their wiring at boot

**Files:**
- Create: `apps/server/src/alerts-api.ts`, `apps/server/src/alerts-api.test.ts`
- Modify: `apps/server/src/boot.ts` (mount beside `mountDiagnosticsApi`)

**Interfaces:**
- Consumes: Task 2 `findIncident`, `markIncidentHandled`; Task 4 registry and reads; identity's `resolveManagementSession`, `permissionsForRole`.
- Produces (HTTP):
  - `GET /management-api/alerts` → `200 { visible: boolean, alerts: Alert[] }`
  - `GET /management-api/alerts/handled` → `200 { visible: boolean, alerts: Alert[] }`
  - `POST /management-api/alerts/incidents/:id/handled` → `204`; `404 alert.not_found`; `403 authorization.not_permitted { permission }`; `401 management_session.required`
- Produces (TS): `export interface AlertsApiDeps { db: Database; cfg: { tenantId: string }; registry: AlertRegistry; now: () => Date }` and `export function mountAlertsApi(app: Hono, deps: AlertsApiDeps, log: Logger): void`.

The session's permissions are empty when its tenant is not `cfg.tenantId`. The POST order is: session (401); a session holding no alert permission at all answers 404 before any lookup, so it learns nothing about which ids exist; incident lookup in this tenant (404); that incident's area permission (403); update.

- [ ] **Step 1: Write the failing tests** — `apps/server/src/alerts-api.test.ts`:

```ts
// PGlite: route authorization over one transaction per request; no concurrency and no
// connection-role question, and grants are enforced once the session assumes app_user.
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { listOpenIncidents, recordIncident } from "@waitron/core";
import { hashPin, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { AppError, tillId as brandTillId, type TenantId, type TillId } from "@waitron/shared";
import { mountAlertsApi } from "./alerts-api.js";
import { createAlertRegistry } from "./alerts.js";
import { ALL_ALERT_CLAIMS } from "./modules.js";
import "./errors.js";

const suite = usePgliteDb({ migrations: migrationOptionsFor(manifestSets(), null), timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const NOW = new Date("2026-09-14T12:00:00.000Z");
const noopLog: Logger = () => {};

interface Venue {
  tenantId: TenantId;
  tillId: TillId;
  manager: string;
  supervisor: string;
  admin: string;
}

async function seedVenue(): Promise<Venue> {
  const tenantId = await seedTenant(db);
  const location = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Sala', array['es-ES'], 'Venta en establecimiento') returning id`);
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${location.rows[0]!.id}, 'Caja 1') returning id`);
  const cookie = (role: string, name: string) =>
    withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const p = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, ${name}, ${hashPin("1234")}, ${role}) returning id`);
      const session = await startManagementSession(tx, { tenantId, personId: p.rows[0]!.id });
      return `${MANAGEMENT_COOKIE}=${session.id}`;
    });
  return {
    tenantId,
    tillId: brandTillId(till.rows[0]!.id),
    manager: await cookie("manager", "Marta"),
    supervisor: await cookie("supervisor", "Sergio"),
    admin: await cookie("admin", "Ana"),
  };
}

async function raise(v: Venue, code: string, severity: "warning" | "error" = "error"): Promise<string> {
  return withTenant(db, v.tenantId, async (tx) => {
    await asAppUser(tx);
    await recordIncident(tx, {
      tenantId: v.tenantId,
      tillId: v.tillId,
      error: new AppError(code as never, {} as never),
      severity,
      detectedAt: NOW,
    });
    const open = await listOpenIncidents(tx, v.tenantId);
    return open.find((i) => i.code === code)!.id;
  });
}

function appFor(
  v: Pick<Venue, "tenantId">,
  registry = createAlertRegistry({ claims: ALL_ALERT_CLAIMS, sources: [] }),
): Hono {
  const app = new Hono();
  mountAlertsApi(
    app,
    {
      db,
      cfg: { tenantId: v.tenantId },
      registry,
      now: () => NOW,
    },
    noopLog,
  );
  return app;
}

const get = (app: Hono, path: string, cookie?: string) =>
  app.request(path, { method: "GET", headers: cookie === undefined ? {} : { cookie } });
const post = (app: Hono, path: string, cookie: string) =>
  app.request(path, { method: "POST", headers: { cookie } });

describe("alert routes", () => {
  it("refuses a request with no session", async () => {
    const v = await seedVenue();
    const res = await get(appFor(v), "/management-api/alerts");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "management_session.required",
    );
  });

  it("lists open alerts for a manager", async () => {
    const v = await seedVenue();
    await raise(v, "payment.offline_forward_declined");
    await raise(v, "chain.verification_failed");
    const res = await get(appFor(v), "/management-api/alerts", v.manager);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { visible: boolean; alerts: { code: string }[] };
    expect(body.visible).toBe(true);
    expect(body.alerts.map((a) => a.code).sort()).toEqual([
      "chain.verification_failed",
      "payment.offline_forward_declined",
    ]);
  });

  it("answers not visible and empty to a session holding no alert permission", async () => {
    const v = await seedVenue();
    await raise(v, "payment.offline_forward_declined");
    const res = await get(appFor(v), "/management-api/alerts", v.supervisor);
    expect(await res.json()).toEqual({ visible: false, alerts: [] });
  });

  it("answers not visible and empty to another tenant's manager", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    await raise(a, "payment.offline_forward_declined");
    const res = await get(appFor(a), "/management-api/alerts", b.manager);
    expect(await res.json()).toEqual({ visible: false, alerts: [] });
  });

  it("marks an incident handled; it moves from open to handled with who and when", async () => {
    const v = await seedVenue();
    const id = await raise(v, "payment.offline_forward_declined");
    const app = appFor(v);
    const res = await post(app, `/management-api/alerts/incidents/${id}/handled`, v.manager);
    expect(res.status).toBe(204);
    expect(((await (await get(app, "/management-api/alerts", v.manager)).json()) as { alerts: unknown[] }).alerts).toEqual([]);
    const handled = (await (await get(app, "/management-api/alerts/handled", v.manager)).json()) as {
      visible: boolean;
      alerts: { key: string; handledBy: string; handledAt: string }[];
    };
    expect(handled.visible).toBe(true);
    expect(handled.alerts).toEqual([
      expect.objectContaining({ key: `incident:${id}`, handledBy: "Marta", handledAt: NOW.toISOString() }),
    ]);
  });

  it("succeeds when the incident is already handled", async () => {
    const v = await seedVenue();
    const id = await raise(v, "payment.offline_forward_declined");
    const app = appFor(v);
    expect((await post(app, `/management-api/alerts/incidents/${id}/handled`, v.manager)).status).toBe(204);
    expect((await post(app, `/management-api/alerts/incidents/${id}/handled`, v.manager)).status).toBe(204);
  });

  it("refuses a session that sees some alerts to handle an incident in an area it does not hold", async () => {
    // Every real role that sees alerts holds every alert permission today, so this registry puts
    // fiscal. under an admin-only permission: the manager still sees payments and diagnostics.
    const registry = createAlertRegistry({
      claims: [
        { prefix: "fiscal.", area: "fiscal", permission: "node.promote" },
        { prefix: "payment.", area: "payments", permission: "payments.manage" },
      ],
      sources: [],
    });
    const v = await seedVenue();
    const id = await raise(v, "fiscal.registro_rechazado");
    const app = appFor(v, registry);
    const refused = await post(app, `/management-api/alerts/incidents/${id}/handled`, v.manager);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "node.promote" } },
    });
    expect((await post(app, `/management-api/alerts/incidents/${id}/handled`, v.admin)).status).toBe(204);
  });

  it("answers alert.not_found to a session holding no alert permission, even for a real id", async () => {
    const v = await seedVenue();
    const id = await raise(v, "fiscal.registro_rechazado");
    const res = await post(appFor(v), `/management-api/alerts/incidents/${id}/handled`, v.supervisor);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("alert.not_found");
  });

  it("answers alert.not_found for an unknown, a malformed, and another tenant's id", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    const theirs = await raise(b, "payment.offline_forward_declined");
    const app = appFor(a);
    for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid", theirs]) {
      const res = await post(app, `/management-api/alerts/incidents/${id}/handled`, a.manager);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("alert.not_found");
    }
    const stillOpen = await withTenant(db, b.tenantId, async (tx) => {
      await asAppUser(tx);
      return listOpenIncidents(tx, b.tenantId);
    });
    expect(stillOpen.map((i) => i.id)).toEqual([theirs]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/alerts-api.test.ts`
Expected: FAIL. `./alerts-api.js` does not exist.

- [ ] **Step 3: Implement** — `apps/server/src/alerts-api.ts`:

```ts
import type { Context, Hono } from "hono";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
import { findIncident, markIncidentHandled } from "@waitron/core";
import { permissionsForRole, resolveManagementSession } from "@waitron/identity";
import { createErrorBoundary, requireManagementSession, type Logger } from "@waitron/server-kit";
import { AppError, isUuid, tenantId as brandTenantId } from "@waitron/shared";
import {
  alertsVisible,
  claimFor,
  readHandledAlerts,
  readOpenAlerts,
  type AlertRegistry,
} from "./alerts.js";
import "./errors.js";

export interface AlertsApiDeps {
  db: Database;
  cfg: { tenantId: string };
  registry: AlertRegistry;
  now: () => Date;
}

const STATUS = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "alert.not_found": 404,
} as const;

/**
 * The dashboard alerts: open alerts, recently handled ones, and marking an incident handled. Each
 * request opens one transaction as the app role. A session from another tenant holds no permissions
 * here, so it sees nothing and can handle nothing.
 */
export function mountAlertsApi(app: Hono, deps: AlertsApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "alerts.failed");
  const tenantId = brandTenantId(deps.cfg.tenantId);

  const inSession = <T>(
    c: Context,
    fn: (tx: Transaction, session: { personId: string; held: ReadonlySet<string> }) => Promise<T>,
  ): Promise<T> => {
    const sessionId = requireManagementSession(c);
    return withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const session = await resolveManagementSession(tx, sessionId);
      const held = new Set(
        session.tenantId === deps.cfg.tenantId ? permissionsForRole(session.role) : [],
      );
      return fn(tx, { personId: session.personId, held });
    });
  };

  const list = (read: typeof readOpenAlerts) => (c: Context) =>
    run(c, log, async () => {
      const body = await inSession(c, async (tx, { held }) => {
        if (!alertsVisible(deps.registry, held)) return { visible: false, alerts: [] };
        const alerts = await read(tx, { registry: deps.registry, tenantId, now: deps.now(), log }, held);
        return { visible: true, alerts };
      });
      return c.json(body);
    });

  app.get("/management-api/alerts", list(readOpenAlerts));
  app.get("/management-api/alerts/handled", list(readHandledAlerts));

  app.post("/management-api/alerts/incidents/:id/handled", (c) =>
    run(c, log, async () => {
      const id = c.req.param("id");
      await inSession(c, async (tx, { personId, held }) => {
        const incident =
          alertsVisible(deps.registry, held) && isUuid(id) ? await findIncident(tx, tenantId, id) : null;
        if (incident === null) throw new AppError("alert.not_found", { id });
        const { permission } = claimFor(deps.registry, incident.code);
        if (!held.has(permission)) throw new AppError("authorization.not_permitted", { permission });
        await markIncidentHandled(tx, { tenantId, id, personId, handledAt: deps.now() });
      });
      return c.body(null, 204);
    }),
  );
}
```

In `apps/server/src/boot.ts`: add imports

```ts
import { mountAlertsApi } from "./alerts-api.js";
import { createAlertRegistry } from "./alerts.js";
```

and add `ALL_ALERT_CLAIMS, enabledAlertSources` to the existing `./modules.js` import. Directly after the `mountDiagnosticsApi(...)` line:

```ts
  // Dashboard alerts. Claims come from every module; ongoing checks only from the enabled set,
  // whose tables are migrated.
  mountAlertsApi(
    app,
    {
      db,
      cfg: { tenantId: till.tenantId },
      registry: createAlertRegistry({
        claims: ALL_ALERT_CLAIMS,
        sources: enabledAlertSources(setsToMigrate),
      }),
      now,
    },
    log,
  );
```

(`setsToMigrate` and `now` are already in scope there: `setsToMigrate` is used by the catalogue mount below it, `now` is `const now = () => new Date()` near the top of the boot function. If `now` has a different name in scope, pass `() => new Date()`.)

- [ ] **Step 4: Run and verify**

Run: `pnpm --filter @waitron/server exec vitest run src/alerts-api.test.ts src/alerts.test.ts` → PASS.
Mutation check: change `session.tenantId === deps.cfg.tenantId ? ... : []` to always use `permissionsForRole(session.role)` → "another tenant's manager" FAILS. Remove the `isUuid(id)` condition (always call `findIncident`) → the malformed id case FAILS with a 500. Change `claimFor(...).permission` to `alertsVisible(deps.registry, held)` → "refuses a session that sees some alerts" FAILS. Restore all three.
Then `pnpm --filter @waitron/server typecheck && pnpm format:check && pnpm lint && pnpm vitest run scripts/module-seams.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/alerts-api.ts apps/server/src/alerts-api.test.ts apps/server/src/boot.ts
git commit -s -m "Serve the dashboard alerts and let managers mark incidents handled

GET /management-api/alerts and /management-api/alerts/handled return
the alerts this session may see, plus whether it may see any. POST
/management-api/alerts/incidents/:id/handled marks one handled if the
session holds that area's permission. An unknown id, a malformed id and
another tenant's id all answer alert.not_found. A session from another
tenant sees nothing."
```

---

### Task 6: A wording lookup that fills in params

**Files:**
- Create: `packages/dashboard-kit/src/alert-messages.ts`, `packages/dashboard-kit/src/alert-messages.test.ts`
- Modify: `packages/dashboard-kit/src/index.ts`

**Interfaces:**
- Produces:

```ts
export type AlertMessageTable = Readonly<Record<string, { readonly en: string; readonly es: string }>>;
export function registerAlertMessages(table: AlertMessageTable): void;
export function hasAlertMessage(code: string): boolean;
export function alertMessage(code: string, params: Readonly<Record<string, unknown>>, l?: string): string;
```

`{name}` is replaced by the param: a string, number or boolean as text, null or missing as `—`, anything else as JSON. An unregistered code gives "Something needs attention" / "Algo requiere atención".

- [ ] **Step 1: Write the failing test** — `packages/dashboard-kit/src/alert-messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { alertMessage, hasAlertMessage, registerAlertMessages } from "./alert-messages.js";

registerAlertMessages({
  "test.rejected": { en: "Rejected: {mensaje} (code {codigo})", es: "Rechazado: {mensaje} (código {codigo})" },
  // Placeholder non-English text: dashboard-kit's tests are scanned by the english-only guard.
  "test.count": { en: "{count} payments", es: "{count} ES" },
});

describe("alertMessage", () => {
  it("fills params into the locale's sentence, stripping the region", () => {
    expect(alertMessage("test.rejected", { mensaje: "NIF", codigo: 4102 }, "es-ES")).toBe(
      "Rechazado: NIF (código 4102)",
    );
    expect(alertMessage("test.count", { count: 3 }, "en-GB")).toBe("3 payments");
  });

  it("shows a dash for a null or missing param", () => {
    expect(alertMessage("test.rejected", { mensaje: null }, "en")).toBe("Rejected: — (code —)");
  });

  it("writes a structured param as JSON", () => {
    expect(alertMessage("test.count", { count: [1, 2] }, "en")).toBe("[1,2] payments");
  });

  it("does not read a param inherited from Object.prototype", () => {
    registerAlertMessages({ "test.proto": { en: "{constructor}", es: "{constructor}" } });
    expect(alertMessage("test.proto", {}, "en")).toBe("—");
  });

  it("gives a generic sentence for an unregistered code, including a prototype name", () => {
    expect(alertMessage("nothing.registered", {}, "en")).toBe("Something needs attention");
    expect(alertMessage("toString", {}, "es")).toBe("Algo requiere atención");
    expect(hasAlertMessage("toString")).toBe(false);
    expect(hasAlertMessage("test.count")).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @waitron/dashboard-kit exec vitest run src/alert-messages.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `packages/dashboard-kit/src/alert-messages.ts`:

```ts
import { currentLocale, pickLocale } from "./i18n.js";

export type AlertMessageTable = Readonly<
  Record<string, { readonly en: string; readonly es: string }>
>;

// Unlike an error banner, an alert with no wording is still worth identifying, so the caller shows
// the raw code beside this sentence (see `hasAlertMessage`).
const GENERIC = { en: "Something needs attention", es: "Algo requiere atención" };

const messages: Record<string, { en: string; es: string }> = {};

export function registerAlertMessages(table: AlertMessageTable): void {
  Object.assign(messages, table);
}

export function hasAlertMessage(code: string): boolean {
  return Object.hasOwn(messages, code);
}

function formatParam(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

export function alertMessage(
  code: string,
  params: Readonly<Record<string, unknown>>,
  l: string = currentLocale(),
): string {
  const template = pickLocale(hasAlertMessage(code) ? messages[code]! : GENERIC, l);
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name: string) =>
    formatParam(Object.hasOwn(params, name) ? params[name] : undefined),
  );
}
```

In `packages/dashboard-kit/src/index.ts` add `export * from "./alert-messages.js";`.

- [ ] **Step 4: Run and verify**

Run: `pnpm --filter @waitron/dashboard-kit exec vitest run src/alert-messages.test.ts` → PASS. Then `pnpm vitest run scripts/english-only.test.ts` → PASS (dashboard-kit is a generic package; its source and tests are scanned for Spanish words). Then `pnpm --filter @waitron/dashboard-kit typecheck && pnpm format:check && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard-kit/src/alert-messages.ts packages/dashboard-kit/src/alert-messages.test.ts packages/dashboard-kit/src/index.ts
git commit -s -m "Add a wording lookup for dashboard alerts that fills in values

Alert codes get an English and a Spanish sentence with {name} slots for
the values the alert carries. A code with no sentence gets a generic
one, so the screen can show it with its raw code."
```

---

### Task 7: Wording for every incident code, and a guard that keeps it complete

**Files:**
- Create: `apps/dashboard/src/i18n/alert-messages.ts` (the table; imports nothing, so the root guard can load it)
- Create: `apps/dashboard/src/i18n/alerts.ts` (registers the table), `apps/dashboard/src/i18n/alerts.test.ts`
- Create: `scripts/alert-codes.test.ts`

**Interfaces:**
- Consumes: Task 3's `ALL_MODULES[*].alerts`; Task 6's `registerAlertMessages`.
- Produces: `ALERT_MESSAGES` (the table); `apps/dashboard/src/i18n/alerts.ts` re-exports `alertMessage` and `hasAlertMessage` after registering.

The incident codes recorded in production source today (found by a whole-repo search on 2026-09-14; the guard re-derives them):
`chain.verification_failed`, `clock.degraded`, `clock.jump_detected`,
`fiscal.aceptado_con_errores`, `fiscal.duplicado_anulado`, `fiscal.environment_mismatch`, `fiscal.environment_unknown`, `fiscal.huella_divergente`, `fiscal.reconcile_drift_anulada`, `fiscal.reconcile_drift_errores`, `fiscal.reconcile_no_trace`, `fiscal.record_totals_disagree`, `fiscal.registro_rechazado`,
`payment.offline_forward_declined`, `payment.pending_outcome_unactionable`, `payment.reconcile_drift`, `payment.reconcile_lost_settlement`, `payment.reconcile_missing_local`, `payment.reconcile_orphan`, `payment.reconcile_remediation_failed`, `payment.reconcile_unsettled`.

> **Dated note, 2026-09-14.** Named in production source is not the same as raised in production:
> `createTrustedClock` has no production caller, so no production path raises the `clock.` codes,
> and the fiscal reconciliation sweep that raises `fiscal.reconcile_*` has none either. The opening
> comment of `scripts/alert-codes.test.ts` records this.

Params each can use come from the registries: `packages/core/src/errors.ts`, `packages/fiscal/src/errors.ts`, `packages/fiscal-verifactu/src/errors.ts`, `packages/payments/src/errors.ts`. The reconcilers raise again after an incident is handled when a later check still finds the problem, so their sentences say so; `payment.reconcile_remediation_failed` is the exception (those payments are never retried).

> **Dated note, 2026-09-14.** Retracted in review: the reconcilers mostly do not look again, so no
> alert's wording promises that it comes back. See the spec's "Marking handled" section
> (`docs/superpowers/specs/2026-09-14-dashboard-alerts-design.md`) and commit 0770603c.

- [ ] **Step 1: Write the failing guard** — `scripts/alert-codes.test.ts`:

```ts
// Reads source TEXT. A code built at runtime (a template literal, or a string spliced from parts)
// escapes the scan, and so does a new code added to a file that is not in INCIDENT_CODE_SOURCES
// unless that file also calls recordIncident/recordIncidentOnce or an incidents sink directly.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { ALERT_MESSAGES } from "../apps/dashboard/src/i18n/alert-messages.js";

const root = join(import.meta.dirname, "..");

/** Files that name, as a string literal, the code of an incident that gets recorded. */
const INCIDENT_CODE_SOURCES = [
  "packages/core/src/record-correction.ts",
  "packages/core/src/record-sale.ts",
  "packages/core/src/record-substitution.ts",
  "packages/core/src/record-void.ts",
  "packages/fiscal/src/clock.ts",
  "packages/fiscal-verifactu/src/chain.ts",
  "packages/fiscal-verifactu/src/drain.ts",
  "packages/fiscal-verifactu/src/reconcile.ts",
  "packages/payments-stripe/src/device-provider.ts",
  "packages/payments-sumup/src/provider.ts",
  "packages/payments/src/reconcile.ts",
];

/** Dotted literals in those files that are thrown or name a permission, never recorded. */
const NOT_RECORDED = new Set([
  "chain.append_contention",
  "fiscal.record_invalid",
  "sale.already_substituted",
  "sale.already_voided",
  "sale.not_found",
  "sale.rectify",
  "sale.series_not_found",
  "sale.series_retired",
  "sale.series_wrong_node",
  "sale.series_wrong_purpose",
  "sale.total_mismatch",
  "sale.void",
  "sale.voided",
  "stripe.tenant_mismatch",
  "sumup.tenant_mismatch",
]);

const WRITES_INCIDENT = /\b(?:recordIncident|recordIncidentOnce)\(|\bincidents\(tx\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "testing") return [];
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    return stat.isFile() && name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

function productionSources(): string[] {
  return ["packages", "apps"].flatMap((top) =>
    readdirSync(join(root, top)).flatMap((pkg) => {
      const src = join(root, top, pkg, "src");
      try {
        return statSync(src).isDirectory() ? sourceFiles(src) : [];
      } catch {
        return [];
      }
    }),
  );
}

function recordedCodes(): string[] {
  const found = new Set<string>();
  for (const file of INCIDENT_CODE_SOURCES) {
    for (const match of readFileSync(join(root, file), "utf8").matchAll(/"([a-z_]+\.[a-z_]+)"/g))
      found.add(match[1]!);
  }
  return [...found].filter((code) => !NOT_RECORDED.has(code)).sort();
}

describe("incident codes reach the dashboard alerts", () => {
  it("every file that records an incident is a listed code source", () => {
    const writers = productionSources()
      .filter((file) => WRITES_INCIDENT.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file))
      .filter((file) => file !== "packages/core/src/incidents.ts");
    expect(writers.filter((file) => !INCIDENT_CODE_SOURCES.includes(file))).toEqual([]);
  });

  it("finds the incident codes known to be recorded", () => {
    // A control against a scan that silently matches nothing.
    expect(recordedCodes()).toEqual(
      expect.arrayContaining(["chain.verification_failed", "fiscal.registro_rechazado", "payment.reconcile_drift"]),
    );
  });

  it("every recorded code is claimed by an area", () => {
    const prefixes = ALL_MODULES.flatMap((module) => module.alerts?.events ?? []).map(
      (claim) => claim.prefix,
    );
    expect(recordedCodes().filter((code) => !prefixes.some((p) => code.startsWith(p)))).toEqual([]);
  });

  it("every recorded code, and alert.source_unavailable, has English and Spanish wording", () => {
    const missing = [...recordedCodes(), "alert.source_unavailable"].filter(
      (code) => !(ALERT_MESSAGES[code]?.en && ALERT_MESSAGES[code]?.es),
    );
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run scripts/alert-codes.test.ts`
Expected: FAIL on the missing `apps/dashboard/src/i18n/alert-messages.js` import.

- [ ] **Step 3: Write the table** — `apps/dashboard/src/i18n/alert-messages.ts`:

> **Dated note, 2026-09-14.** The shipped wording changed in review. The "it will appear again"
> sentences below were dropped (the spec's "Marking handled" section says why), and the clock, payment and fiscal reconciliation sentences were
> rewritten, so this table is not what the dashboard shows. `apps/dashboard/src/i18n/alert-messages.ts`
> is the truth.

```ts
// English and Spanish sentences for every alert code. `{name}` slots are filled from the alert's
// params. Kept free of imports so the root guard (`scripts/alert-codes.test.ts`) can load it.
const RETURNS_EN = " If the next check still finds it after you mark it handled, it will appear again.";
const RETURNS_ES = " Si la próxima comprobación lo sigue encontrando después de marcarlo como resuelto, volverá a aparecer.";

export const ALERT_MESSAGES: Readonly<Record<string, { readonly en: string; readonly es: string }>> = {
  "alert.source_unavailable": {
    en: "One of Waitron's checks could not run. It will try again in a minute.",
    es: "Una de las comprobaciones de Waitron no se ha podido ejecutar. Lo volverá a intentar en un minuto.",
  },
  "chain.verification_failed": {
    en: "The invoice record chain failed its integrity check on a sale. Contact support.",
    es: "La cadena de registros de facturación no ha superado su comprobación de integridad en una venta. Contacta con soporte.",
  },
  "clock.degraded": {
    en: "The till's clock has not been checked against a trusted time source for {anchorAgeSeconds} seconds. Sales continue; check the box's internet connection.",
    es: "La hora de la caja no se ha comprobado con una fuente fiable desde hace {anchorAgeSeconds} segundos. Las ventas continúan; revisa la conexión a internet del equipo.",
  },
  "clock.jump_detected": {
    en: "The till's clock jumped by {wallClockDeltaSeconds} seconds. Check the date and time on the box.",
    es: "La hora de la caja ha saltado {wallClockDeltaSeconds} segundos. Revisa la fecha y la hora del equipo.",
  },
  "fiscal.registro_rechazado": {
    en: "The tax agency (AEAT) rejected an invoice record: {mensaje} (code {codigo}). Later records on the same chain are on hold. Contact support.",
    es: "La AEAT ha rechazado un registro de facturación: {mensaje} (código {codigo}). Los registros posteriores de la misma cadena están en espera. Contacta con soporte.",
  },
  "fiscal.aceptado_con_errores": {
    en: "The tax agency (AEAT) accepted an invoice record but reported a problem: {mensaje} (code {codigo}).",
    es: "La AEAT ha aceptado un registro de facturación, pero ha indicado un problema: {mensaje} (código {codigo}).",
  },
  "fiscal.duplicado_anulado": {
    en: "The tax agency (AEAT) already holds this invoice record as cancelled. Sending on this chain is on hold. Contact support.",
    es: "La AEAT ya tiene este registro de facturación como anulado. El envío de esta cadena está en espera. Contacta con soporte.",
  },
  "fiscal.huella_divergente": {
    en: "An invoice record's fingerprint does not match the copy the tax agency (AEAT) holds. Sending on this chain is on hold. Contact support.",
    es: "La huella de un registro de facturación no coincide con la copia de la AEAT. El envío de esta cadena está en espera. Contacta con soporte.",
  },
  "fiscal.environment_mismatch": {
    en: "An invoice record was made for the tax agency's {recordEnvironment} service, but this box sends to {hostEnvironment}. It has not been sent. Contact support.",
    es: "Un registro de facturación se creó para el servicio de {recordEnvironment} de la AEAT, pero este equipo envía a {hostEnvironment}. No se ha enviado. Contacta con soporte.",
  },
  "fiscal.environment_unknown": {
    en: "An invoice record does not say which tax agency service it was made for, so it has not been sent. Contact support.",
    es: "Un registro de facturación no indica para qué servicio de la AEAT se creó, así que no se ha enviado. Contacta con soporte.",
  },
  "fiscal.record_totals_disagree": {
    en: "An invoice's totals do not match its tax lines. The tax agency accepts it, but check that sale's prices.",
    es: "Los totales de una factura no coinciden con sus líneas de impuestos. La AEAT la acepta, pero revisa los precios de esa venta.",
  },
  "fiscal.reconcile_no_trace": {
    en: `Invoice {numSerieFactura} was sent, but the tax agency (AEAT) has no record of it. Contact support.${RETURNS_EN}`,
    es: `La factura {numSerieFactura} se envió, pero la AEAT no tiene constancia de ella. Contacta con soporte.${RETURNS_ES}`,
  },
  "fiscal.reconcile_drift_errores": {
    en: `The tax agency (AEAT) now lists invoice {numSerieFactura} as accepted with errors, which differs from the record here.${RETURNS_EN}`,
    es: `La AEAT indica ahora que la factura {numSerieFactura} se aceptó con errores, lo que no coincide con el registro de aquí.${RETURNS_ES}`,
  },
  "fiscal.reconcile_drift_anulada": {
    en: `The tax agency (AEAT) lists invoice {numSerieFactura} as cancelled, but it was not voided here. Contact support.${RETURNS_EN}`,
    es: `La AEAT indica que la factura {numSerieFactura} está anulada, pero aquí no se anuló. Contacta con soporte.${RETURNS_ES}`,
  },
  "payment.offline_forward_declined": {
    en: "A card payment of {amount} taken while offline was declined when it was sent on (reference {paymentRef}). Collect the money another way.",
    es: "Un pago con tarjeta de {amount} cobrado sin conexión se rechazó al enviarlo (referencia {paymentRef}). Cobra el importe de otra forma.",
  },
  "payment.pending_outcome_unactionable": {
    en: "The card provider did not confirm whether payment {paymentRef} went through (status {status}). Check it in the provider's own dashboard.",
    es: "El proveedor de pagos no ha confirmado si el pago {paymentRef} se completó (estado {status}). Compruébalo en el panel del proveedor.",
  },
  "payment.reconcile_unsettled": {
    en: `{count} card payments have not been paid out by the card provider yet.${RETURNS_EN}`,
    es: `El proveedor de pagos aún no ha liquidado {count} pagos con tarjeta.${RETURNS_ES}`,
  },
  "payment.reconcile_lost_settlement": {
    en: `The card provider says {count} payments were paid, but they never finished here. Check those orders.${RETURNS_EN}`,
    es: `El proveedor de pagos indica que {count} pagos se cobraron, pero aquí no se completaron. Revisa esos pedidos.${RETURNS_ES}`,
  },
  "payment.reconcile_orphan": {
    en: `{count} card payments were taken for orders that were already closed or abandoned. Waitron refunds some of these by itself; check the rest.${RETURNS_EN}`,
    es: `Se cobraron {count} pagos con tarjeta de pedidos ya cerrados o abandonados. Waitron devuelve algunos por sí mismo; revisa el resto.${RETURNS_ES}`,
  },
  "payment.reconcile_missing_local": {
    en: `The card provider reports {count} payments that are not recorded here.${RETURNS_EN}`,
    es: `El proveedor de pagos indica {count} pagos que no están registrados aquí.${RETURNS_ES}`,
  },
  "payment.reconcile_drift": {
    en: `{count} card payments were paid out for a different amount than was charged.${RETURNS_EN}`,
    es: `Se liquidaron {count} pagos con tarjeta por un importe distinto del cobrado.${RETURNS_ES}`,
  },
  "payment.reconcile_remediation_failed": {
    en: "Automatic refunds failed for {count} card payments. Refund them in the card provider's own dashboard.",
    es: "Las devoluciones automáticas han fallado en {count} pagos con tarjeta. Devuélvelos desde el panel del proveedor.",
  },
};
```

`payment.reconcile_remediation_failed` carries no "comes back" sentence: those payments are marked as tried and are never retried (`packages/payments/src/errors.ts`).

> **Dated note, 2026-09-14.** No alert carries a "comes back" sentence now; see the spec's "Marking
> handled" section.

- [ ] **Step 4: Register it** — `apps/dashboard/src/i18n/alerts.ts`:

```ts
import { registerAlertMessages } from "@waitron/dashboard-kit";
import { ALERT_MESSAGES } from "./alert-messages.js";

export { alertMessage, hasAlertMessage } from "@waitron/dashboard-kit";

registerAlertMessages(ALERT_MESSAGES);
```

`apps/dashboard/src/i18n/alerts.test.ts`:

```ts
import { expect, it } from "vitest";
import { alertMessage, hasAlertMessage } from "./alerts.js";

it("registers the dashboard's alert wording on import", () => {
  expect(hasAlertMessage("payment.offline_forward_declined")).toBe(true);
  expect(
    alertMessage("payment.offline_forward_declined", { amount: "12.50", paymentRef: "pi_1" }, "en"),
  ).toBe(
    "A card payment of 12.50 taken while offline was declined when it was sent on (reference pi_1). Collect the money another way.",
  );
});
```

- [ ] **Step 5: Run and verify**

Run: `pnpm vitest run scripts/alert-codes.test.ts` → PASS.
Run: `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts` → PASS.
Deletion proofs, one at a time, each restored after:
1. Delete the `"clock.degraded"` entry from `ALERT_MESSAGES` → the wording test FAILS naming `clock.degraded`.
2. Remove `alerts: PAYMENTS_ALERTS,` from the payments descriptor → the claim test FAILS listing the eight `payment.` codes.
3. Remove `"packages/payments/src/reconcile.ts"` from `INCIDENT_CODE_SOURCES` → the writers test FAILS naming it.
Then `pnpm --filter @waitron/dashboard typecheck && pnpm format:check && pnpm lint`.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/i18n/alert-messages.ts apps/dashboard/src/i18n/alerts.ts apps/dashboard/src/i18n/alerts.test.ts scripts/alert-codes.test.ts
git commit -s -m "Word every incident code for the dashboard, and guard that none is missed

Each of the 21 incident codes the system records today gets an English
and a Spanish sentence. A new repo-wide test reads the source files that
record incidents. It fails if a recorded code belongs to no area or has
no wording, or if a new file starts recording incidents without being
listed. It reads text, so a code built at runtime would escape it."
```

---

### Task 8: Warning colours and the `wt-count-badge` primitive

**Files:**
- Modify: `packages/ui/src/tokens/colors.css` (all four blocks), `packages/ui/src/tokens/colors.test.ts`
- Create: `packages/ui/src/components/wt-count-badge.ts`, `wt-count-badge.test.ts`, `wt-count-badge.a11y.test.ts`
- Modify: `packages/ui/src/index.ts`, `packages/ui/demo/main.ts`

**Interfaces:**
- Produces: tokens `--wt-color-warning`, `--wt-color-on-warning`; element `<wt-count-badge count tone>` with `tone: "neutral" | "warning" | "error"` (reflected); `export type WtCountBadgeTone`.

- [ ] **Step 1: Write the failing tests**

In `colors.test.ts`, add `"--wt-color-warning"` and `"--wt-color-on-warning"` to the "defines the core colour contract" list.

`packages/ui/src/components/wt-count-badge.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import type { WtCountBadge } from "./wt-count-badge.js";
import "./wt-count-badge.js";

afterEach(cleanup);

const badge = (el: Element) => el.shadowRoot!.querySelector("span");

test("shows the count, capped at 99+", async () => {
  const el = (await mount('<wt-count-badge count="3"></wt-count-badge>')) as WtCountBadge;
  expect(badge(el)!.textContent).toBe("3");
  el.count = 120;
  await el.updateComplete;
  expect(badge(el)!.textContent).toBe("99+");
});

test("renders nothing at zero", async () => {
  const el = await mount('<wt-count-badge count="0"></wt-count-badge>');
  expect(badge(el)).toBeNull();
});

test.each([
  ["error", "--wt-color-danger", "--wt-color-on-danger"],
  ["warning", "--wt-color-warning", "--wt-color-on-warning"],
  ["neutral", "--wt-color-surface-raised", "--wt-color-text"],
] as const)("a %s badge paints from its tokens", async (tone, background, text) => {
  const el = await mount(`<wt-count-badge count="2" tone="${tone}"></wt-count-badge>`);
  host.style.setProperty(background, "rgb(1, 2, 3)");
  host.style.setProperty(text, "rgb(4, 5, 6)");
  const style = getComputedStyle(badge(el)!);
  expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
  expect(style.color).toBe("rgb(4, 5, 6)");
});
```

`packages/ui/src/components/wt-count-badge.a11y.test.ts`:

```ts
import axe from "axe-core";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-count-badge.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-count-badge a11y (%s theme)", (theme) => {
  test.each(["neutral", "warning", "error"] as const)("a %s badge", async (tone) => {
    await mountThemed(`<wt-count-badge count="12" tone="${tone}"></wt-count-badge>`, theme);
    await expectNoA11yViolations(host);
  });

  test("detects unreadable badge text", async () => {
    await mountThemed('<wt-count-badge count="12" tone="warning"></wt-count-badge>', theme);
    host.style.setProperty("--wt-color-on-warning", "var(--wt-color-warning)");
    const result = await axe.run(host);
    expect(result.violations.map(({ id }) => id)).toContain("color-contrast");
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/ui exec vitest run src/tokens/colors.test.ts src/components/wt-count-badge.test.ts src/components/wt-count-badge.a11y.test.ts`
Expected: FAIL (tokens undefined; element missing).

- [ ] **Step 3: Implement**

In `colors.css`, add after `--wt-color-success` in each block. Light (the bare block and the `data-theme="light"` block):

```css
  --wt-color-warning: #8a5300;
  --wt-color-on-warning: #ffffff;
```

Dark (the `prefers-color-scheme: dark` block and the `data-theme="dark"` block):

```css
  --wt-color-warning: #f2b24c;
  --wt-color-on-warning: #241500;
```

`packages/ui/src/components/wt-count-badge.ts`:

```ts
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

export type WtCountBadgeTone = "neutral" | "warning" | "error";

/** A count pill. Renders nothing at zero and caps its text at "99+". It has no accessible name of
 * its own: the control it decorates must say the count. */
@customElement("wt-count-badge")
export class WtCountBadge extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
      }
      span {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-space-5);
        padding: 0 var(--wt-space-1);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        line-height: var(--wt-space-5);
      }
      :host([tone="warning"]) span {
        border-color: transparent;
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
      }
      :host([tone="error"]) span {
        border-color: transparent;
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
      }
    `,
  ];

  @property({ type: Number }) count = 0;
  @property({ reflect: true }) tone: WtCountBadgeTone = "neutral";

  override render() {
    if (!(this.count > 0)) return nothing;
    return html`<span part="badge">${this.count > 99 ? "99+" : String(this.count)}</span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-count-badge": WtCountBadge;
  }
}
```

In `packages/ui/src/index.ts` add beside `WtLozenge`:

```ts
export { WtCountBadge, type WtCountBadgeTone } from "./components/wt-count-badge.js";
```

In `packages/ui/demo/main.ts` add `import "../src/components/wt-count-badge.js";` and, in `panel()` after the spinner row:

```html
    <div class="row">
      <wt-count-badge count="3"></wt-count-badge>
      <wt-count-badge count="12" tone="warning"></wt-count-badge>
      <wt-count-badge count="120" tone="error"></wt-count-badge>
    </div>
```

- [ ] **Step 4: Run and verify**

Run the Step 2 command → PASS. Then `pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts src/tap-target-and-focus.test.ts` → PASS.
Break-it check: temporarily set the light `--wt-color-warning` to `#f2b24c` (white text on light amber) → the light-theme warning a11y test FAILS with `color-contrast`. Restore.
Then `pnpm --filter @waitron/ui typecheck && pnpm format:check && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/tokens/colors.css packages/ui/src/tokens/colors.test.ts packages/ui/src/components/wt-count-badge.ts packages/ui/src/components/wt-count-badge.test.ts packages/ui/src/components/wt-count-badge.a11y.test.ts packages/ui/src/index.ts packages/ui/demo/main.ts
git commit -s -m "Add warning colours and a count badge component

The design system had no amber, which the alerts bell needs for
warnings. wt-count-badge shows a number in a pill (neutral, warning or
error), hides itself at zero, and shows 99+ above 99. Its accessibility
test checks every tone in both themes, and one test confirms that
unreadable text makes it fail."
```

---

### Task 9: The `wt-toast` primitive

**Files:**
- Create: `packages/ui/src/components/wt-toast.ts`, `wt-toast.test.ts`, `wt-toast.a11y.test.ts`
- Modify: `packages/ui/src/index.ts`, `packages/ui/demo/main.ts`

**Interfaces:**
- Produces: `<wt-toast open tone message close-label duration>`; `tone: "info" | "error"` (reflected); `duration` in ms, default `8000`, `0` means it stays. Events: `wt-activate` (message pressed, then it closes) and `wt-close` (closed by the timer, the close button, or after activation), both `detail: {}`. Needs the app to register a `close` icon. The info tone is announced politely (`role="status"`), the error tone assertively (`role="alert"`). Hovering or focusing it pauses the timer; leaving restarts the full duration.

- [ ] **Step 1: Write the failing tests** — `wt-toast.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import type { WtToast } from "./wt-toast.js";
import "./wt-toast.js";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const part = (el: Element, selector: string) => el.shadowRoot!.querySelector<HTMLElement>(selector);

test("shows the message in a polite region, or an assertive one for an error", async () => {
  const el = (await mount('<wt-toast open message="3 new alerts" close-label="Close"></wt-toast>')) as WtToast;
  expect(part(el, '[role="status"] .message')!.textContent).toBe("3 new alerts");
  expect(part(el, '[role="alert"] .toast')).toBeNull();
  el.tone = "error";
  await el.updateComplete;
  expect(part(el, '[role="alert"] .message')!.textContent).toBe("3 new alerts");
  expect(part(el, '[role="status"] .toast')).toBeNull();
});

test("renders nothing inside its regions while closed", async () => {
  const el = await mount('<wt-toast message="Hidden"></wt-toast>');
  expect(part(el, ".toast")).toBeNull();
  expect(el.shadowRoot!.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(2);
});

test("closes itself after its duration and says so", async () => {
  vi.useFakeTimers();
  const el = (await mount('<wt-toast open message="Hi" duration="8000"></wt-toast>')) as WtToast;
  const closed = vi.fn();
  el.addEventListener("wt-close", closed);
  vi.advanceTimersByTime(7_999);
  expect(el.open).toBe(true);
  vi.advanceTimersByTime(1);
  expect(el.open).toBe(false);
  expect(closed).toHaveBeenCalledOnce();
});

test("pauses while hovered and restarts the full duration after", async () => {
  vi.useFakeTimers();
  const el = (await mount('<wt-toast open message="Hi" duration="1000"></wt-toast>')) as WtToast;
  const toast = part(el, ".toast")!;
  vi.advanceTimersByTime(900);
  toast.dispatchEvent(new MouseEvent("mouseenter"));
  vi.advanceTimersByTime(5_000);
  expect(el.open).toBe(true);
  toast.dispatchEvent(new MouseEvent("mouseleave"));
  vi.advanceTimersByTime(999);
  expect(el.open).toBe(true);
  vi.advanceTimersByTime(1);
  expect(el.open).toBe(false);
});

test("pressing the message activates and closes; the close button only closes", async () => {
  const el = (await mount('<wt-toast open message="Hi" close-label="Close"></wt-toast>')) as WtToast;
  const activated = vi.fn();
  const closed = vi.fn();
  host.addEventListener("wt-activate", activated);
  host.addEventListener("wt-close", closed);
  part(el, ".message")!.click();
  expect(activated).toHaveBeenCalledOnce();
  expect(closed).toHaveBeenCalledOnce();
  el.open = true;
  await el.updateComplete;
  part(el, ".close")!.click();
  expect(activated).toHaveBeenCalledOnce();
  expect(closed).toHaveBeenCalledTimes(2);
});

test("an error toast marks its edge with the danger token", async () => {
  const el = await mount('<wt-toast open tone="error" message="Hi"></wt-toast>');
  host.style.setProperty("--wt-color-danger", "rgb(1, 2, 3)");
  expect(getComputedStyle(part(el, ".toast")!).borderInlineStartColor).toBe("rgb(1, 2, 3)");
});
```

`wt-toast.a11y.test.ts`:

```ts
import axe from "axe-core";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-toast.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-toast a11y (%s theme)", (theme) => {
  test.each(["info", "error"] as const)("an open %s toast", async (tone) => {
    await mountThemed(
      `<wt-toast open tone="${tone}" message="2 new alerts" close-label="Close" duration="0"></wt-toast>`,
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("a closed toast", async () => {
    await mountThemed('<wt-toast message="x" close-label="Close"></wt-toast>', theme);
    await expectNoA11yViolations(host);
  });

  test("detects a close button with no name", async () => {
    const el = await mountThemed(
      '<wt-toast open message="2 new alerts" close-label="Close" duration="0"></wt-toast>',
      theme,
    );
    el.shadowRoot!.querySelector(".close")!.removeAttribute("aria-label");
    const result = await axe.run(host);
    expect(result.violations.map(({ id }) => id)).toContain("button-name");
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-toast.test.ts src/components/wt-toast.a11y.test.ts` → FAIL (element missing).

- [ ] **Step 3: Implement** — `packages/ui/src/components/wt-toast.ts`:

```ts
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import "./wt-icon.js";

export type WtToastTone = "info" | "error";

/**
 * A brief notice. Both live regions are always in the document, so a screen reader announces the
 * message when it appears. Positioning belongs to the consumer. The consuming app registers the
 * `close` icon.
 */
@customElement("wt-toast")
export class WtToast extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .toast {
        display: flex;
        align-items: stretch;
        gap: var(--wt-space-1);
        padding: var(--wt-space-1);
        border: 1px solid var(--wt-color-border);
        border-inline-start-width: var(--wt-space-1);
        border-inline-start-color: var(--wt-color-primary);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }
      :host([tone="error"]) .toast {
        border-inline-start-color: var(--wt-color-danger);
      }
      button {
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        border: 0;
        border-radius: var(--wt-radius-sm);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .message {
        flex: 1 1 auto;
        padding: 0 var(--wt-space-2);
        text-align: start;
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ reflect: true }) tone: WtToastTone = "info";
  @property() message = "";
  @property({ attribute: "close-label" }) closeLabel = "";
  @property({ type: Number }) duration = 8000;

  #timer: ReturnType<typeof setTimeout> | undefined;

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("open") || changed.has("message") || changed.has("duration")) this.#restart();
  }

  override disconnectedCallback(): void {
    clearTimeout(this.#timer);
    super.disconnectedCallback();
  }

  #restart(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.open && this.duration > 0) this.#timer = setTimeout(() => this.#close(), this.duration);
  }

  readonly #pause = (): void => {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  };

  readonly #resume = (): void => {
    if (!this.matches(":focus-within")) this.#restart();
  };

  #close(): void {
    if (!this.open) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.open = false;
    this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true, detail: {} }));
  }

  #onMessage(event: MouseEvent): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent("wt-activate", { bubbles: true, composed: true, detail: {} }));
    this.#close();
  }

  #onClose(event: MouseEvent): void {
    event.stopPropagation();
    this.#close();
  }

  override render() {
    const toast = this.open
      ? html`<div
          class="toast"
          part="toast"
          @mouseenter=${this.#pause}
          @mouseleave=${this.#resume}
          @focusin=${this.#pause}
          @focusout=${this.#resume}
        >
          <button class="message" type="button" @click=${this.#onMessage}>${this.message}</button>
          <button class="close" type="button" aria-label=${this.closeLabel} @click=${this.#onClose}>
            <wt-icon name="close"></wt-icon>
          </button>
        </div>`
      : nothing;
    return html`<div role="status">${this.tone === "error" ? nothing : toast}</div>
      <div role="alert">${this.tone === "error" ? toast : nothing}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-toast": WtToast;
  }
}
```

In `packages/ui/src/index.ts`: `export { WtToast, type WtToastTone } from "./components/wt-toast.js";`

In `packages/ui/demo/main.ts`: add `import "../src/components/wt-toast.js";`, register a `close` icon in the demo's `registerIcons` call — `close: "M3.7 2.6 8 6.9l4.3-4.3 1.1 1.1L9.1 8l4.3 4.3-1.1 1.1L8 9.1l-4.3 4.3-1.1-1.1L6.9 8 2.6 3.7Z",` — and add to `panel()`:

```html
    <wt-toast open message="2 new alerts" close-label="Close" duration="0"></wt-toast>
    <wt-toast open tone="error" message="The tax agency rejected an invoice record" close-label="Close" duration="0"></wt-toast>
```

- [ ] **Step 4: Run and verify**

Run the Step 2 command → PASS; then `pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts` → PASS. Then `pnpm --filter @waitron/ui typecheck && pnpm format:check && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/wt-toast.ts packages/ui/src/components/wt-toast.test.ts packages/ui/src/components/wt-toast.a11y.test.ts packages/ui/src/index.ts packages/ui/demo/main.ts
git commit -s -m "Add a toast component for brief notices

wt-toast shows a message for eight seconds, or for a set time, and
pauses while the pointer or keyboard focus is on it. Pressing the
message sends wt-activate and closes it. Screen readers announce errors
straight away and other notices politely."
```

---

### Task 10: `wt-row-actions` gains a badge slot, a styleable popup, and `show()`/`hide()`

**Files:**
- Modify: `packages/ui/src/components/wt-row-actions.ts`
- Test: `packages/ui/src/components/wt-row-actions.test.ts`, `wt-row-actions.a11y.test.ts`

**Interfaces:**
- Produces: `<slot name="badge">` inside the trigger button, placed at its top trailing corner; `part="popup"` on the popover; public `show(): void` (opens and positions before first paint) and `hide(): void`.

- [ ] **Step 1: Write the failing tests** — append to `wt-row-actions.test.ts` (add imports it lacks: `host` from `../test-helpers.js`, `WtRowActions` type):

```ts
test("puts a badge-slotted element inside the trigger button", async () => {
  const el = (await mount(
    '<wt-row-actions label="Alerts"><span slot="badge">3</span><wt-button>See all</wt-button></wt-row-actions>',
  )) as WtRowActions;
  const slot = el.shadowRoot!.querySelector<HTMLSlotElement>("button slot[name=badge]")!;
  expect(slot.assignedElements().map((e) => e.textContent)).toEqual(["3"]);
});

test("show() opens the popup and hide() closes it", async () => {
  const el = (await mount(
    '<wt-row-actions label="Alerts"><wt-button>See all</wt-button></wt-row-actions>',
  )) as WtRowActions;
  const popup = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  el.show();
  expect(popup.matches(":popover-open")).toBe(true);
  expect(popup.style.top).not.toBe("");
  el.hide();
  expect(popup.matches(":popover-open")).toBe(false);
});

test("a consumer can size the popup through its part", async () => {
  const style = document.createElement("style");
  style.textContent = "wt-row-actions.wide::part(popup) { width: 300px; }";
  document.head.append(style);
  try {
    const el = (await mount(
      '<wt-row-actions class="wide" label="Alerts"><wt-button>See all</wt-button></wt-row-actions>',
    )) as WtRowActions;
    el.show();
    expect(el.shadowRoot!.querySelector<HTMLElement>("[popover]")!.getBoundingClientRect().width).toBe(300);
  } finally {
    style.remove();
  }
});
```

Append to the a11y `describe.each` in `wt-row-actions.a11y.test.ts`:

```ts
  test("a trigger carrying a badge, closed and open", async () => {
    const el = await mountThemed(
      `<wt-row-actions label="Alerts, 3 open"><span slot="badge">3</span>
        <wt-button>See all alerts</wt-button></wt-row-actions>`,
      theme,
    );
    await expectNoA11yViolations(host);
    (el as unknown as { show(): void }).show();
    await expectNoA11yViolations(host);
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-row-actions.test.ts src/components/wt-row-actions.a11y.test.ts` → FAIL (`show` is not a function; no badge slot).

- [ ] **Step 3: Implement** — in `wt-row-actions.ts`:

1. In the `button` CSS rule add `position: relative;`, and add after it:

```css
      ::slotted([slot="badge"]) {
        position: absolute;
        inset-block-start: 0;
        inset-inline-end: 0;
      }
```

2. Replace `onTriggerClick` with:

```ts
  private onTriggerClick(event: MouseEvent): void {
    event.preventDefault();
    if (this.popup.matches(":popover-open")) this.hide();
    else this.show();
  }

  /** Opens the menu. Positioned synchronously so its first paint is already in place. */
  show(): void {
    if (this.popup.matches(":popover-open")) return;
    this.popup.showPopover();
    this.positionPopup();
  }

  hide(): void {
    if (this.popup.matches(":popover-open")) this.popup.hidePopover();
  }
```

3. In `render()`, put the badge slot inside the trigger after the icon, and name the popup part:

```ts
        <wt-icon name=${this.icon} size=${this.iconSize}></wt-icon>
        <slot name="badge"></slot>
      </button>
      <div id="actions" part="popup" popover @toggle=${this.onToggle} @keydown=${this.onKeydown}>
```

- [ ] **Step 4: Run and verify**

Run the Step 2 command, plus `src/no-hardcoded-chrome.test.ts src/tap-target-and-focus.test.ts` → PASS. Then run every existing consumer's tests that open a row-actions menu: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/row-actions.test.ts` → PASS. Then `pnpm --filter @waitron/ui typecheck && pnpm format:check && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/wt-row-actions.ts packages/ui/src/components/wt-row-actions.test.ts packages/ui/src/components/wt-row-actions.a11y.test.ts
git commit -s -m "Let a row-actions menu carry a badge, be sized, and open from code

The trigger button can now hold a badge in its corner, a screen can set
the menu's width through a CSS part, and show() and hide() open and
close it from code. The alerts bell needs all three."
```

---

### Task 11: Alerts on the dashboard client, the new-arrivals helper, icons and strings

**Files:**
- Modify: `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/api/client.test.ts`
- Modify: `apps/dashboard/src/api/live-queries.ts`, `apps/dashboard/src/api/live-queries.test.ts`
- Create: `apps/dashboard/src/state/alert-arrivals.ts`, `apps/dashboard/src/state/alert-arrivals.test.ts`
- Modify: `apps/dashboard/src/icons.ts` (add `bell`, `close`), `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/i18n/codes.ts`

**Interfaces:**
- Produces (`client.ts`):

```ts
export interface AlertView {
  key: string;
  kind: "event" | "ongoing";
  code: string;
  params: Record<string, unknown>;
  severity: "warning" | "error";
  since: string | null;
  area: string;
  screen?: string;
  handledAt?: string;
  handledBy?: string | null;
}
export interface AlertsResponse { visible: boolean; alerts: AlertView[] }
// DashboardApi methods:
listAlerts(): Promise<AlertsResponse>;
listHandledAlerts(): Promise<AlertsResponse>;
markIncidentHandled(incidentId: string): Promise<void>;
```

- Produces: `QUERY_DEPENDENCIES.listAlerts = ["incidents"]`, `listHandledAlerts = ["incidents"]` (60-second refresh, the default).
- Produces: `class AlertArrivals { next<T extends { key: string }>(alerts: readonly T[]): T[]; reset(): void }` — the first read after construction or `reset()` returns `[]`; later reads return alerts whose key was not in the previous read.
- Produces string keys (English / Spanish):

| key | en | es |
| --- | --- | --- |
| `alerts.bell` | Alerts | Avisos |
| `alerts.bell_count` | Alerts, {count} open | Avisos, {count} abiertos |
| `alerts.title` | Alerts | Avisos |
| `alerts.none` | Nothing needs attention. | No hay nada que requiera atención. |
| `alerts.see_all` | See all alerts | Ver todos los avisos |
| `alerts.mark_handled` | Mark handled | Marcar como resuelto |
| `alerts.go_to` | Go to {screen} | Ir a {screen} |
| `alerts.toast_many` | {count} new alerts | {count} avisos nuevos |
| `alerts.tab_open` | Open | Abiertos |
| `alerts.tab_handled` | Handled | Resueltos |
| `alerts.col_alert` | Alert | Aviso |
| `alerts.col_area` | Area | Área |
| `alerts.col_since` | Since | Desde |
| `alerts.col_handled` | Handled | Resuelto |
| `alerts.col_actions` | Actions | Acciones |
| `alerts.handled_by` | {time} by {person} | {time} por {person} |
| `alerts.someone` | someone | alguien |
| `alerts.loading` | Loading alerts… | Cargando avisos… |
| `alerts.no_handled` | Nothing was handled in the last 30 days. | No se ha resuelto nada en los últimos 30 días. |
| `alerts.no_access` | You don't have access to any alerts. | No tienes acceso a ningún aviso. |
| `alerts.load_error` | Alerts could not be loaded. | No se han podido cargar los avisos. |
| `alerts.severity.error` | Problem | Problema |
| `alerts.severity.warning` | Warning | Aviso |
| `alerts.area.fiscal` | Tax filing | Facturación AEAT |
| `alerts.area.payments` | Card payments | Pagos con tarjeta |
| `alerts.area.diagnostics` | System | Sistema |
| `alerts.area.backup` | Backups | Copias de seguridad |
| `alerts.area.printing` | Printing | Impresión |
| `alerts.area.card_reader` | Card readers | Lectores de tarjetas |

- Produces `CODE_MESSAGES["alert.not_found"]`: en "This alert no longer exists. Refresh the list." / es "Este aviso ya no existe. Actualiza la lista."

- [ ] **Step 1: Write the failing tests**

Append to `client.test.ts` inside `describe("DashboardApi", ...)`:

```ts
  it("reads open and handled alerts and marks an incident handled", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ visible: true, alerts: [] }))
      .mockResolvedValueOnce(jsonResponse({ visible: true, alerts: [] }))
      .mockResolvedValueOnce(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listAlerts()).toEqual({ visible: true, alerts: [] });
    await api.listHandledAlerts();
    await api.markIncidentHandled("a b");
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/management-api/alerts", "GET"],
      ["/management-api/alerts/handled", "GET"],
      ["/management-api/alerts/incidents/a%20b/handled", "POST"],
    ]);
  });
```

Append to `live-queries.test.ts`:

```ts
it("refreshes the open alerts passively and when incidents change", async () => {
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify({ visible: true, alerts: [] })),
  );
  const api = new DashboardApi("", fetchImpl);
  const query = dashboardQuery(api, "listAlerts", []);
  expect(query.dependencies).toEqual([{ type: "incidents" }]);
  expect(query.refreshMs).toBe(60_000);
  await query.read();
  await query.read();
  expect(new Headers(fetchImpl.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
});
```

`apps/dashboard/src/state/alert-arrivals.test.ts`:

```ts
import { expect, it } from "vitest";
import { AlertArrivals } from "./alert-arrivals.js";

const a = (key: string) => ({ key });

it("raises nothing on the first read, then only keys missing from the previous read", () => {
  const arrivals = new AlertArrivals();
  expect(arrivals.next([a("one")])).toEqual([]);
  expect(arrivals.next([a("one"), a("two")])).toEqual([a("two")]);
  expect(arrivals.next([a("two")])).toEqual([]);
  // "one" cleared and came back: new again compared with the previous read.
  expect(arrivals.next([a("two"), a("one")])).toEqual([a("one")]);
});

it("starts over after reset", () => {
  const arrivals = new AlertArrivals();
  arrivals.next([a("one")]);
  arrivals.reset();
  expect(arrivals.next([a("two")])).toEqual([]);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts src/api/live-queries.test.ts src/state/alert-arrivals.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`client.ts` — add the two interfaces above next to `BackupStatusView`'s neighbours (with a one-line doc: "LOCAL copy of the server's `Alert` (`packages/module/src/alerts.ts`)"), and in `DashboardApi` beside `getBackupStatus`:

```ts
  // ── Alerts ────────────────────────────────────────────────────────────────────────────────────

  /** `GET /management-api/alerts` — this session's open alerts, and whether it may see any. */
  listAlerts(): Promise<AlertsResponse> {
    return this.#request<AlertsResponse>("/management-api/alerts", "GET");
  }

  /** `GET /management-api/alerts/handled` — incidents handled in the last 30 days. */
  listHandledAlerts(): Promise<AlertsResponse> {
    return this.#request<AlertsResponse>("/management-api/alerts/handled", "GET");
  }

  /** `POST /management-api/alerts/incidents/:id/handled` — succeeds when already handled. */
  markIncidentHandled(incidentId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/alerts/incidents/${encodeURIComponent(incidentId)}/handled`,
      "POST",
    );
  }
```

`live-queries.ts` — add to `QUERY_DEPENDENCIES` after `getBackupStatus`:

```ts
  listAlerts: ["incidents"],
  listHandledAlerts: ["incidents"],
```

`apps/dashboard/src/state/alert-arrivals.ts`:

```ts
/** Which alerts are new since this tab's previous read. The first read raises nothing, so opening
 * the dashboard does not pop up everything already open. */
export class AlertArrivals {
  #previous: ReadonlySet<string> | null = null;

  next<T extends { key: string }>(alerts: readonly T[]): T[] {
    const previous = this.#previous;
    this.#previous = new Set(alerts.map((alert) => alert.key));
    return previous === null ? [] : alerts.filter((alert) => !previous.has(alert.key));
  }

  reset(): void {
    this.#previous = null;
  }
}
```

`icons.ts` — add to the doc list "- bell: the banner's alerts trigger." and "- close: wt-toast's dismiss button (wt-toast requires its consuming app to register this).", and to `DASHBOARD_ICONS`:

```ts
  bell: "M8 14.5a1.5 1.5 0 0 0 1.5-1.5h-3A1.5 1.5 0 0 0 8 14.5ZM12.5 10.5V7.25c0-2.2-1.2-4-3.25-4.5V2.25a1.25 1.25 0 0 0-2.5 0v.5C4.7 3.25 3.5 5.05 3.5 7.25v3.25L2 12v.5h12V12Z",
  close: "M3.7 2.6 8 6.9l4.3-4.3 1.1 1.1L9.1 8l4.3 4.3-1.1 1.1L8 9.1l-4.3 4.3-1.1-1.1L6.9 8 2.6 3.7Z",
```

`strings.ts` — add every key in the table above to `en` (after `"nav.account_menu"`) and its Spanish to `es` (after the Spanish `"nav.account_menu"`).

`codes.ts` — add to `CODE_MESSAGES`:

```ts
  "alert.not_found": {
    en: "This alert no longer exists. Refresh the list.",
    es: "Este aviso ya no existe. Actualiza la lista.",
  },
```

- [ ] **Step 4: Run and verify**

Run the Step 2 command, plus `src/i18n/codes.test.ts src/i18n/t.test.ts` → PASS. Run `pnpm vitest run scripts/live-subscriptions.test.ts` → PASS (`incidents` is a declared resource). Then `pnpm --filter @waitron/dashboard typecheck && pnpm format:check && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/api/client.test.ts apps/dashboard/src/api/live-queries.ts apps/dashboard/src/api/live-queries.test.ts apps/dashboard/src/state/alert-arrivals.ts apps/dashboard/src/state/alert-arrivals.test.ts apps/dashboard/src/icons.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/i18n/codes.ts
git commit -s -m "Teach the dashboard client about alerts

Adds the three alert calls, refreshes open alerts when incidents change
or once a minute without keeping the session awake, and adds a helper
that works out which alerts are new since the last read. Also adds the
bell and close icons and the English and Spanish text the alerts use."
```

---

### Task 12: Alert formatting helpers and the bell with its panel

**Files:**
- Create: `apps/dashboard/src/widgets/alert-format.ts`, `apps/dashboard/src/widgets/alert-format.test.ts`
- Create: `apps/dashboard/src/widgets/alerts-bell.ts`, `alerts-bell.test.ts`, `alerts-bell.a11y.test.ts`

**Interfaces:**
- Consumes: Task 11's `AlertView`; Task 7's `alertMessage`, `hasAlertMessage`; Tasks 8 and 10's components.
- Produces (`alert-format.ts`):

```ts
export function incidentIdOf(alert: Pick<AlertView, "key" | "kind">): string | null; // id for an event, else null
export function areaLabel(area: string): string;       // alerts.area.<area>, or the raw area when unknown
export function severityLabel(severity: AlertView["severity"]): string;
export function formatAlertTime(iso: string | null): string; // "" for null
export function goToLabel(screen: string): string;     // alerts.go_to with the nav label of that screen
```

- Produces (`alerts-bell.ts`): `<dashboard-alerts-bell>` with properties `alerts: AlertView[]`, `canOpen: (screen: string) => boolean`, `error: string | null`, `busyKey: string | null`; method `open(): void`; constant `PANEL_LIMIT = 5`. Events: `wt-alert-handle` `{ incidentId: string; key: string }` (panel stays open), `wt-alerts-see-all` `{}` and `wt-alert-go-to` `{ screen: string }` (panel closes).

- [ ] **Step 1: Write the failing tests**

`alert-format.test.ts`:

```ts
import { afterEach, expect, it } from "vitest";
import { setLocale } from "../i18n/t.js";
import { areaLabel, formatAlertTime, goToLabel, incidentIdOf, severityLabel } from "./alert-format.js";

afterEach(() => setLocale("es-ES"));

it("reads the incident id only from an event key", () => {
  expect(incidentIdOf({ key: "incident:abc", kind: "event" })).toBe("abc");
  expect(incidentIdOf({ key: "backup.disabled:local", kind: "ongoing" })).toBeNull();
});

it("labels areas and severities in the active language, keeping an unknown area as is", () => {
  setLocale("en-GB");
  expect(areaLabel("fiscal")).toBe("Tax filing");
  expect(areaLabel("mystery")).toBe("mystery");
  expect(severityLabel("error")).toBe("Problem");
  setLocale("es-ES");
  expect(areaLabel("payments")).toBe("Pagos con tarjeta");
});

it("names the destination screen by its navigation label", () => {
  setLocale("en-GB");
  expect(goToLabel("backup")).toBe("Go to Backups");
  setLocale("es-ES");
  expect(goToLabel("backup")).toBe("Ir a Copias de seguridad");
});

it("formats a time, and nothing for no time", () => {
  expect(formatAlertTime(null)).toBe("");
  expect(formatAlertTime("2026-09-14T12:00:00.000Z")).not.toBe("");
});
```

`alerts-bell.test.ts`:

```ts
import { page, userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n/t.js";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { AlertView } from "../api/client.js";
import "./alerts-bell.js";
import type { AlertsBell } from "./alerts-bell.js";

registerIcons(DASHBOARD_ICONS);
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const event = (id: string, severity: AlertView["severity"] = "error"): AlertView => ({
  key: `incident:${id}`,
  kind: "event",
  code: "payment.offline_forward_declined",
  params: { amount: "12.50", paymentRef: `pi_${id}` },
  severity,
  since: "2026-09-14T12:00:00.000Z",
  area: "payments",
});
const ongoing: AlertView = {
  key: "backup.disabled:local",
  kind: "ongoing",
  code: "backup.disabled",
  params: {},
  severity: "warning",
  since: null,
  area: "backup",
  screen: "backup",
};

const menu = (el: AlertsBell) => el.shadowRoot!.querySelector("wt-row-actions")!;
const popup = (el: AlertsBell) => menu(el).shadowRoot!.querySelector<HTMLElement>("[popover]")!;
const q = (el: AlertsBell, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const qa = (el: AlertsBell, sel: string) => [...el.shadowRoot!.querySelectorAll<HTMLElement>(sel)];

describe("dashboard-alerts-bell", () => {
  it("counts open alerts, red when any is an error and amber otherwise, and says the count", async () => {
    setLocale("en-GB");
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", {
      alerts: [event("1", "warning"), event("2", "warning")],
    });
    const badge = q(el, "wt-count-badge")!;
    expect(badge.getAttribute("tone")).toBe("warning");
    expect((badge as unknown as { count: number }).count).toBe(2);
    expect(menu(el).getAttribute("label")).toBe("Alerts, 2 open");
    el.alerts = [event("1", "warning"), event("2", "error")];
    await el.updateComplete;
    expect(badge.getAttribute("tone")).toBe("error");
  });

  it("lists at most five alerts with their wording, and always offers See all", async () => {
    setLocale("en-GB");
    const alerts = ["1", "2", "3", "4", "5", "6"].map((id) => event(id));
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", { alerts });
    expect(qa(el, "li")).toHaveLength(5);
    expect(qa(el, "li")[0]!.textContent).toContain("A card payment of 12.50 taken while offline");
    expect(q(el, "[data-test=alerts-see-all]")).not.toBeNull();
  });

  it("shows an empty message when nothing is open", async () => {
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", { alerts: [] });
    expect(q(el, "[data-test=alerts-empty]")).not.toBeNull();
  });

  it("asks to handle an event without closing the panel", async () => {
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", { alerts: [event("9")] });
    const handle = vi.fn();
    el.addEventListener("wt-alert-handle", handle);
    el.open();
    await userEvent.click(q(el, "[data-test=alert-handle]")!);
    expect(handle.mock.calls[0]![0].detail).toEqual({ incidentId: "9", key: "incident:9" });
    expect(popup(el).matches(":popover-open")).toBe(true);
  });

  it("offers Go to only for an ongoing alert whose screen the session may open, and closes", async () => {
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", {
      alerts: [ongoing],
      canOpen: () => false,
    });
    expect(q(el, "[data-test=alert-go-to]")).toBeNull();
    el.canOpen = (screen) => screen === "backup";
    await el.updateComplete;
    const goTo = vi.fn();
    el.addEventListener("wt-alert-go-to", goTo);
    el.open();
    await userEvent.click(q(el, "[data-test=alert-go-to]")!);
    expect(goTo.mock.calls[0]![0].detail).toEqual({ screen: "backup" });
    expect(popup(el).matches(":popover-open")).toBe(false);
  });

  it("See all asks for the screen and closes the panel", async () => {
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", { alerts: [event("1")] });
    const seeAll = vi.fn();
    el.addEventListener("wt-alerts-see-all", seeAll);
    el.open();
    await userEvent.click(q(el, "[data-test=alerts-see-all]")!);
    expect(seeAll).toHaveBeenCalledOnce();
    expect(popup(el).matches(":popover-open")).toBe(false);
  });

  it("shows a generic sentence and the raw code for an alert with no wording", async () => {
    setLocale("en-GB");
    const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", {
      alerts: [{ ...event("1"), code: "mystery.thing" }],
    });
    const item = qa(el, "li")[0]!.textContent!;
    expect(item).toContain("Something needs attention");
    expect(item).toContain("mystery.thing");
  });

  it("opens full width at phone width", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(400, 800);
    try {
      const { el } = await mountWidget<AlertsBell>("dashboard-alerts-bell", { alerts: [event("1")] });
      el.open();
      const rect = popup(el).getBoundingClientRect();
      expect(rect.width).toBeGreaterThanOrEqual(400 - 2 * 8 - 1);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(400);
    } finally {
      await page.viewport(width, height);
    }
  });
});
```

`alerts-bell.a11y.test.ts`:

```ts
import { afterEach, describe, it } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { AlertView } from "../api/client.js";
import "./alerts-bell.js";
import type { AlertsBell } from "./alerts-bell.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

const alerts: AlertView[] = [
  { key: "incident:1", kind: "event", code: "fiscal.registro_rechazado", params: { mensaje: "NIF", codigo: 4102 }, severity: "error", since: "2026-09-14T12:00:00.000Z", area: "fiscal" },
  { key: "backup.disabled:local", kind: "ongoing", code: "backup.disabled", params: {}, severity: "warning", since: null, area: "backup", screen: "backup" },
];

describe.each(["light", "dark"] as const)("dashboard-alerts-bell a11y (%s theme)", (theme) => {
  it("closed and open with alerts", async () => {
    const { el, host } = await mountWidget<AlertsBell>("dashboard-alerts-bell", { alerts, canOpen: () => true }, theme);
    await expectNoA11yViolations(host);
    el.open();
    await expectNoA11yViolations(host);
  });

  it("open and empty, and open with an error message", async () => {
    const { el, host } = await mountWidget<AlertsBell>("dashboard-alerts-bell", { alerts: [], error: "alert.not_found" }, theme);
    el.open();
    await expectNoA11yViolations(host);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/alert-format.test.ts src/widgets/alerts-bell.test.ts src/widgets/alerts-bell.a11y.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`alert-format.ts`:

```ts
import { t as tKit } from "@waitron/dashboard-kit";
import { currentLocale, t } from "../i18n/t.js";
import type { AlertView } from "../api/client.js";

const INCIDENT_PREFIX = "incident:";

export function incidentIdOf(alert: Pick<AlertView, "key" | "kind">): string | null {
  return alert.kind === "event" && alert.key.startsWith(INCIDENT_PREFIX)
    ? alert.key.slice(INCIDENT_PREFIX.length)
    : null;
}

export function areaLabel(area: string): string {
  const key = `alerts.area.${area}`;
  const label = tKit(key);
  return label === key ? area : label;
}

export function severityLabel(severity: AlertView["severity"]): string {
  return t(severity === "error" ? "alerts.severity.error" : "alerts.severity.warning");
}

export function formatAlertTime(iso: string | null): string {
  if (iso === null) return "";
  return new Intl.DateTimeFormat(currentLocale(), { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

export function goToLabel(screen: string): string {
  return t("alerts.go_to").replace("{screen}", tKit(`nav.${screen}`));
}
```

`alerts-bell.ts`:

```ts
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, type WtRowActions } from "@waitron/ui";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-count-badge.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { alertMessage, hasAlertMessage } from "../i18n/alerts.js";
import type { AlertView } from "../api/client.js";
import { areaLabel, formatAlertTime, goToLabel, incidentIdOf, severityLabel } from "./alert-format.js";

export const PANEL_LIMIT = 5;

/** The banner's alerts bell: a count badge on a row-actions trigger whose popover lists the most
 * urgent open alerts. The shell owns the data and acts on this element's events. */
@customElement("dashboard-alerts-bell")
export class AlertsBell extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
      }
      wt-row-actions::part(popup) {
        width: 44ch;
        max-width: calc(100vw - 2 * var(--wt-space-2));
        max-height: 70vh;
        overflow-y: auto;
      }
      @media (max-width: 48rem) {
        wt-row-actions::part(popup) {
          width: calc(100vw - 2 * var(--wt-space-2));
        }
      }
      h2 {
        margin: 0;
        padding: var(--wt-space-1) var(--wt-space-2);
        font-size: var(--wt-font-size-md);
      }
      ul {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      li {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--wt-space-1);
        padding: var(--wt-space-2);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-border);
      }
      li[data-severity="error"] {
        border-inline-start-color: var(--wt-color-danger);
      }
      li[data-severity="warning"] {
        border-inline-start-color: var(--wt-color-warning);
      }
      .meta {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .empty,
      .error {
        margin: 0;
        padding: var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) alerts: AlertView[] = [];
  @property({ attribute: false }) canOpen: (screen: string) => boolean = () => false;
  @property({ attribute: false }) error: string | null = null;
  @property({ attribute: false }) busyKey: string | null = null;

  #menu(): WtRowActions | null {
    return this.renderRoot.querySelector<WtRowActions>("wt-row-actions");
  }

  open(): void {
    this.#menu()?.show();
  }

  #emit(name: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }

  #onHandle(event: MouseEvent, alert: AlertView, incidentId: string): void {
    event.stopPropagation();
    this.#emit("wt-alert-handle", { incidentId, key: alert.key });
  }

  #onGoTo(event: MouseEvent, screen: string): void {
    event.stopPropagation();
    this.#menu()?.hide();
    this.#emit("wt-alert-go-to", { screen });
  }

  #onSeeAll(event: MouseEvent): void {
    event.stopPropagation();
    this.#menu()?.hide();
    this.#emit("wt-alerts-see-all", {});
  }

  #item(alert: AlertView): TemplateResult {
    const incidentId = incidentIdOf(alert);
    const screen =
      alert.kind === "ongoing" && alert.screen !== undefined && this.canOpen(alert.screen)
        ? alert.screen
        : null;
    const when = formatAlertTime(alert.since);
    return html`<li data-severity=${alert.severity} data-test="alert-item">
      <span>${alertMessage(alert.code, alert.params)}</span>
      ${hasAlertMessage(alert.code) ? nothing : html`<span class="meta">${alert.code}</span>`}
      <span class="meta"
        >${severityLabel(alert.severity)} · ${areaLabel(alert.area)}${when ? ` · ${when}` : ""}</span
      >
      ${
        incidentId === null
          ? nothing
          : html`<wt-button
              size="sm"
              variant="secondary"
              data-test="alert-handle"
              ?loading=${this.busyKey === alert.key}
              @click=${(e: MouseEvent) => this.#onHandle(e, alert, incidentId)}
              >${t("alerts.mark_handled")}</wt-button
            >`
      }
      ${
        screen === null
          ? nothing
          : html`<wt-button
              size="sm"
              variant="secondary"
              data-test="alert-go-to"
              @click=${(e: MouseEvent) => this.#onGoTo(e, screen)}
              >${goToLabel(screen)}</wt-button
            >`
      }
    </li>`;
  }

  override render(): TemplateResult {
    const count = this.alerts.length;
    const label =
      count === 0 ? t("alerts.bell") : t("alerts.bell_count").replace("{count}", String(count));
    return html`<wt-row-actions
      icon="bell"
      align="end"
      .iconSize=${"lg"}
      label=${label}
      data-test="alerts-menu"
    >
      <wt-count-badge
        slot="badge"
        data-test="alerts-count"
        .count=${count}
        tone=${this.alerts.some((a) => a.severity === "error") ? "error" : "warning"}
      ></wt-count-badge>
      <h2>${t("alerts.title")}</h2>
      ${this.error === null ? nothing : html`<p class="error" role="alert">${codeMessage(this.error)}</p>`}
      ${
        count === 0
          ? html`<p class="empty" data-test="alerts-empty">${t("alerts.none")}</p>`
          : html`<ul>
              ${this.alerts.slice(0, PANEL_LIMIT).map((alert) => this.#item(alert))}
            </ul>`
      }
      <wt-button variant="ghost" align="start" data-test="alerts-see-all" @click=${this.#onSeeAll}
        >${t("alerts.see_all")}</wt-button
      >
    </wt-row-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-alerts-bell": AlertsBell;
  }
}
```

- [ ] **Step 4: Run and verify**

Run the Step 2 command → PASS.
Break-it checks, each restored: add `this.#menu()?.hide();` to `#onHandle` → "asks to handle an event without closing the panel" FAILS; remove `this.#menu()?.hide();` from `#onSeeAll` → "See all asks for the screen and closes the panel" FAILS. (Each handler stops its click, so `wt-row-actions` never sees it: the panel closes only where this element calls `hide()`.)
Then `pnpm --filter @waitron/dashboard typecheck && pnpm format:check && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/widgets/alert-format.ts apps/dashboard/src/widgets/alert-format.test.ts apps/dashboard/src/widgets/alerts-bell.ts apps/dashboard/src/widgets/alerts-bell.test.ts apps/dashboard/src/widgets/alerts-bell.a11y.test.ts
git commit -s -m "Add the alerts bell and its panel

The bell shows how many alerts are open, red if any is an error and
amber otherwise, and says the count to screen readers. Its panel lists
the five most urgent alerts with their wording, area and time. Each has
Mark handled for a recorded incident or a link to the screen that fixes
an ongoing problem, and See all is at the bottom. It fills the width of
a phone screen."
```

---

### Task 13: The Alerts screen

**Files:**
- Create: `apps/dashboard/src/screens/alerts-screen.ts`, `alerts-screen.test.ts`, `alerts-screen.a11y.test.ts`

**Interfaces:**
- Consumes: Task 11 (`listAlerts`, `listHandledAlerts`, `markIncidentHandled`, `DashboardQueries` names), Task 12 (`alert-format.ts`).
- Produces: `<dashboard-alerts-screen>` with properties `api: DashboardApi` and `canOpen: (screen: string) => boolean`. URL: `/manage/alerts/view/open` or `/manage/alerts/view/handled`, where an unknown or missing view shows `open`. Event: `wt-alert-go-to` `{ screen }`.

- [ ] **Step 1: Write the failing tests** — `alerts-screen.test.ts`:

```ts
import { userEvent } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { LiveData } from "@waitron/dashboard-kit";
import type { AlertView, AlertsResponse, DashboardApi } from "../api/client.js";
import "./alerts-screen.js";
import type { AlertsScreen } from "./alerts-screen.js";

const open: AlertView = {
  key: "incident:i1",
  kind: "event",
  code: "payment.offline_forward_declined",
  params: { amount: "12.50", paymentRef: "pi_1" },
  severity: "error",
  since: "2026-09-14T12:00:00.000Z",
  area: "payments",
};
const handled: AlertView = { ...open, key: "incident:i2", handledAt: "2026-09-14T13:00:00.000Z", handledBy: "Marta" };
const ongoing: AlertView = {
  key: "backup.disabled:local",
  kind: "ongoing",
  code: "backup.disabled",
  params: {},
  severity: "warning",
  since: null,
  area: "backup",
  screen: "backup",
};

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): DashboardApi {
  return {
    listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [open, ongoing] } satisfies AlertsResponse),
    listHandledAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [handled] } satisfies AlertsResponse),
    markIncidentHandled: vi.fn().mockResolvedValue(undefined),
    // A real LiveData: marking handled refreshes through invalidation, as in the running app.
    liveData: new LiveData(),
    ...overrides,
  } as unknown as DashboardApi;
}

const flush = async (el: AlertsScreen) => {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};
const rows = (el: AlertsScreen, test: string) =>
  el.shadowRoot!.querySelector(`[data-test=${test}]`)!.shadowRoot!.querySelectorAll("tbody tr");

beforeEach(() => {
  setLocale("en-GB");
  history.replaceState(null, "", "/manage/alerts");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("dashboard-alerts-screen", () => {
  it("shows open alerts on the Open tab, with wording, and records the tab in the URL", async () => {
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api: stubApi() });
    await flush(el);
    expect(rows(el, "open-alerts-table")).toHaveLength(2);
    expect(el.shadowRoot!.textContent).toContain("A card payment of 12.50 taken while offline");
    expect(location.pathname).toBe("/manage/alerts/view/open");
  });

  it("switches to Handled and shows who handled it", async () => {
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api: stubApi() });
    await flush(el);
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    const handledTab = [...tabs.shadowRoot!.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) =>
      t.textContent!.includes("Handled"),
    )!;
    await userEvent.click(handledTab);
    await flush(el);
    expect(location.pathname).toBe("/manage/alerts/view/handled");
    const text = rows(el, "handled-alerts-table")[0]!.textContent!;
    expect(text).toContain("Marta");
  });

  it("opens on the Handled tab from the URL", async () => {
    history.replaceState(null, "", "/manage/alerts/view/handled");
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("handled");
  });

  it("marking an event handled moves it from Open to Handled", async () => {
    const nowHandled: AlertView = { ...open, handledAt: "2026-09-14T14:00:00.000Z", handledBy: "Ana" };
    const api = stubApi({
      listAlerts: vi
        .fn()
        .mockResolvedValueOnce({ visible: true, alerts: [open, ongoing] })
        .mockResolvedValue({ visible: true, alerts: [ongoing] }),
      listHandledAlerts: vi
        .fn()
        .mockResolvedValueOnce({ visible: true, alerts: [handled] })
        .mockResolvedValue({ visible: true, alerts: [nowHandled, handled] }),
    });
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
    await flush(el);
    const button = rows(el, "open-alerts-table")[0]!.querySelector<HTMLElement>("[data-test=alert-handle]")!;
    await userEvent.click(button);
    expect(api.markIncidentHandled).toHaveBeenCalledWith("i1");
    await vi.waitFor(() => expect(rows(el, "open-alerts-table")).toHaveLength(1));
    await vi.waitFor(() => expect(rows(el, "handled-alerts-table")).toHaveLength(2));
    expect(rows(el, "handled-alerts-table")[0]!.textContent).toContain("Ana");
  });

  it("shows the error when marking handled fails and keeps the alert listed", async () => {
    const api = stubApi({ markIncidentHandled: vi.fn().mockRejectedValue({ code: "alert.not_found" }) });
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
    await flush(el);
    await userEvent.click(rows(el, "open-alerts-table")[0]!.querySelector<HTMLElement>("[data-test=alert-handle]")!);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=alerts-error]")!.textContent).toContain(
      "This alert no longer exists",
    );
    expect(rows(el, "open-alerts-table")).toHaveLength(2);
  });

  it("offers Go to only for a screen the session may open", async () => {
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", {
      api: stubApi(),
      canOpen: (screen: string) => screen === "backup",
    });
    await flush(el);
    const goTo = vi.fn();
    el.addEventListener("wt-alert-go-to", goTo);
    const button = el.shadowRoot!
      .querySelector("[data-test=open-alerts-table]")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=alert-go-to]")!;
    await userEvent.click(button);
    expect(goTo.mock.calls[0]![0].detail).toEqual({ screen: "backup" });
  });

  it("says so when the session may see no alerts", async () => {
    const api = stubApi({ listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }) });
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=alerts-no-access]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("wt-tabs")).toBeNull();
  });

  it("shows a load error", async () => {
    const api = stubApi({ listAlerts: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=alerts-load-error]")!.textContent).toContain(
      "Alerts could not be loaded",
    );
    expect(el.shadowRoot!.querySelector("[data-test=alerts-error]")).toBeNull();
  });
});
```

Cell content lives in `wt-data-table`'s shadow root, which is why the tests reach through it.

`alerts-screen.a11y.test.ts`:

```ts
import { afterEach, describe, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { AlertView, DashboardApi } from "../api/client.js";
import "./alerts-screen.js";
import type { AlertsScreen } from "./alerts-screen.js";

afterEach(cleanupWidgets);

const alerts: AlertView[] = [
  { key: "incident:i1", kind: "event", code: "fiscal.registro_rechazado", params: { mensaje: "NIF", codigo: 4102 }, severity: "error", since: "2026-09-14T12:00:00.000Z", area: "fiscal" },
  { key: "backup.disabled:local", kind: "ongoing", code: "backup.disabled", params: {}, severity: "warning", since: null, area: "backup", screen: "backup" },
];
const handled: AlertView[] = [{ ...alerts[0]!, key: "incident:i2", handledAt: "2026-09-14T13:00:00.000Z", handledBy: null }];

const api = (visible = true) =>
  ({
    listAlerts: vi.fn().mockResolvedValue({ visible, alerts: visible ? alerts : [] }),
    listHandledAlerts: vi.fn().mockResolvedValue({ visible, alerts: visible ? handled : [] }),
    markIncidentHandled: vi.fn(),
    liveData: new LiveData(),
  }) as unknown as DashboardApi;

const settle = async (el: AlertsScreen) => {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

describe.each(["light", "dark"] as const)("dashboard-alerts-screen a11y (%s theme)", (theme) => {
  it("the Open tab with alerts", async () => {
    history.replaceState(null, "", "/manage/alerts/view/open");
    const { el, host } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api: api(), canOpen: () => true }, theme);
    await settle(el);
    await expectNoA11yViolations(host);
  });

  it("the Handled tab", async () => {
    history.replaceState(null, "", "/manage/alerts/view/handled");
    const { el, host } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api: api() }, theme);
    await settle(el);
    await expectNoA11yViolations(host);
  });

  it("no access", async () => {
    const { el, host } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api: api(false) }, theme);
    await settle(el);
    await expectNoA11yViolations(host);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/alerts-screen.test.ts src/screens/alerts-screen.a11y.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `apps/dashboard/src/screens/alerts-screen.ts`:

```ts
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UrlStateController, baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-tabs.js";
import { dashboardPath } from "../navigation.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { alertMessage, hasAlertMessage } from "../i18n/alerts.js";
import { DashboardQueries } from "../api/query-controller.js";
import type { AlertView, DashboardApi } from "../api/client.js";
import {
  areaLabel,
  formatAlertTime,
  goToLabel,
  incidentIdOf,
  severityLabel,
} from "../widgets/alert-format.js";

const VIEWS = ["open", "handled"] as const;
type View = (typeof VIEWS)[number];

/** Open and recently handled alerts. Not in the navigation: the banner bell opens it. */
@customElement("dashboard-alerts-screen")
export class AlertsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) canOpen: (screen: string) => boolean = () => false;

  @state() private view: View = "open";
  @state() private open: AlertView[] = [];
  @state() private handled: AlertView[] = [];
  @state() private visible: boolean | null = null;
  @state() private loading = true;
  /** A failed read. Kept apart from `actionError`: a refresh failing after a successful write is a
   * load failure, not a failed save. */
  @state() private loadError: string | null = null;
  @state() private actionError: string | null = null;
  @state() private busyKey: string | null = null;

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.loadError = codeOf(error);
      this.loading = false;
    },
  );

  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "alerts") return;
      const view = this.#url.read("view");
      this.view = (VIEWS as readonly string[]).includes(view ?? "") ? (view as View) : "open";
      if (view !== this.view) this.#url.write({ view: this.view }, true);
    },
    dashboardPath,
  );

  override connectedCallback(): void {
    super.connectedCallback();
    this.#load();
  }

  #load(): void {
    void this.#queries
      .watch("listAlerts", [], (response) => {
        this.visible = response.visible;
        this.open = response.alerts;
        this.loading = false;
        this.loadError = null;
      })
      .catch(() => undefined);
    void this.#queries
      .watch("listHandledAlerts", [], (response) => {
        this.handled = response.alerts;
      })
      .catch(() => undefined);
  }

  async #handle(alert: AlertView, incidentId: string): Promise<void> {
    this.busyKey = alert.key;
    this.actionError = null;
    try {
      await this.api.markIncidentHandled(incidentId);
    } catch (error) {
      this.actionError = codeOf(error);
      return;
    } finally {
      this.busyKey = null;
    }
    // Invalidate rather than re-watch: the shell's bell observes the same query, so its shared cache
    // entry would survive a release and hand back the stale value.
    this.api.liveData.invalidate([{ type: "incidents" }]);
  }

  #goTo(event: MouseEvent, screen: string): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-alert-go-to", { bubbles: true, composed: true, detail: { screen } }),
    );
  }

  #alertCell(alert: AlertView): TemplateResult {
    return html`${alertMessage(alert.code, alert.params)}${
      hasAlertMessage(alert.code) ? nothing : html`<br />${alert.code}`
    }<br />${severityLabel(alert.severity)}`;
  }

  #openColumns(): DataTableColumn<AlertView>[] {
    return [
      { key: "alert", label: t("alerts.col_alert"), cell: (a) => this.#alertCell(a) },
      { key: "area", label: t("alerts.col_area"), cell: (a) => areaLabel(a.area) },
      { key: "since", label: t("alerts.col_since"), cell: (a) => formatAlertTime(a.since) },
      {
        key: "actions",
        label: t("alerts.col_actions"),
        cell: (a) => {
          const incidentId = incidentIdOf(a);
          if (incidentId !== null)
            return html`<wt-button
              size="sm"
              variant="secondary"
              data-test="alert-handle"
              ?loading=${this.busyKey === a.key}
              @click=${() => void this.#handle(a, incidentId)}
              >${t("alerts.mark_handled")}</wt-button
            >`;
          if (a.screen !== undefined && this.canOpen(a.screen)) {
            const screen = a.screen;
            return html`<wt-button
              size="sm"
              variant="secondary"
              data-test="alert-go-to"
              @click=${(e: MouseEvent) => this.#goTo(e, screen)}
              >${goToLabel(screen)}</wt-button
            >`;
          }
          return nothing;
        },
      },
    ];
  }

  #handledColumns(): DataTableColumn<AlertView>[] {
    return [
      { key: "alert", label: t("alerts.col_alert"), cell: (a) => this.#alertCell(a) },
      { key: "area", label: t("alerts.col_area"), cell: (a) => areaLabel(a.area) },
      {
        key: "handled",
        label: t("alerts.col_handled"),
        cell: (a) =>
          t("alerts.handled_by")
            .replace("{time}", formatAlertTime(a.handledAt ?? null))
            .replace("{person}", a.handledBy ?? t("alerts.someone")),
      },
    ];
  }

  override render(): TemplateResult {
    const error = html`${
      this.loadError === null
        ? nothing
        : html`<p role="alert" data-test="alerts-load-error">${t("alerts.load_error")}</p>`
    }${
      this.actionError === null
        ? nothing
        : html`<p role="alert" data-test="alerts-error">${codeMessage(this.actionError)}</p>`
    }`;
    if (this.visible === false)
      return html`<h1 class="title">${t("alerts.title")}</h1>
        <p data-test="alerts-no-access">${t("alerts.no_access")}</p>`;
    return html`<h1 class="title">${t("alerts.title")}</h1>
      ${error}
      <wt-tabs
        label=${t("alerts.title")}
        .value=${this.view}
        .items=${[
          { key: "open", label: t("alerts.tab_open") },
          { key: "handled", label: t("alerts.tab_handled") },
        ]}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          if (event.target !== event.currentTarget) return;
          this.view = event.detail.value as View;
          this.#url.write({ dashboard: "alerts", view: this.view });
        }}
      >
        <div slot="open">
          <wt-data-table
            data-test="open-alerts-table"
            aria-label=${t("alerts.tab_open")}
            .rows=${this.open}
            .columns=${this.#openColumns()}
            .rowKey=${(a: AlertView) => a.key}
            .loading=${this.loading}
            .loadingMessage=${t("alerts.loading")}
            .emptyMessage=${t("alerts.none")}
          ></wt-data-table>
        </div>
        <div slot="handled">
          <wt-data-table
            data-test="handled-alerts-table"
            aria-label=${t("alerts.tab_handled")}
            .rows=${this.handled}
            .columns=${this.#handledColumns()}
            .rowKey=${(a: AlertView) => a.key}
            .loading=${this.loading}
            .loadingMessage=${t("alerts.loading")}
            .emptyMessage=${t("alerts.no_handled")}
          ></wt-data-table>
        </div>
      </wt-tabs>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-alerts-screen": AlertsScreen;
  }
}
```

The `.title` rule matches the printers screen's heading.

- [ ] **Step 4: Run and verify**

Run the Step 2 command → PASS.
Break-it check: delete the `invalidate` line at the end of `#handle` → "marking an event handled moves it from Open to Handled" FAILS. Restore. (Why invalidation rather than re-watching is tested in Task 14, where the bell and the screen observe the same query.)
Then `pnpm --filter @waitron/dashboard typecheck && pnpm format:check && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/alerts-screen.ts apps/dashboard/src/screens/alerts-screen.test.ts apps/dashboard/src/screens/alerts-screen.a11y.test.ts
git commit -s -m "Add the Alerts screen with Open and Handled tabs

Open lists every alert the session may see with its full wording, area
and time, and Mark handled or a link to the screen that fixes it.
Handled lists what was handled in the last 30 days and by whom. The tab
is kept in the address bar. A session with no alert permission is told
it has no access."
```

---

### Task 14: Put the bell, the pop-up and the Alerts screen into the dashboard shell

**Files:**
- Modify: `apps/dashboard/src/dashboard-app.ts`
- Test: `apps/dashboard/src/dashboard-app.test.ts`, `apps/dashboard/src/dashboard-app.a11y.test.ts`

**Interfaces:**
- Consumes: Tasks 9, 11, 12, 13.
- Produces: in the authenticated banner, `<dashboard-alerts-bell data-test="alerts-bell">` before the account menu, shown only while the last alerts read said `visible: true`; `<wt-toast data-test="alert-toast">`; the `alerts` destination (`/manage/alerts`) for any non-staff session.

Behaviour to build:
1. After `#applyMe`, a non-staff session watches `listAlerts` through its own `DashboardQueries`. A failed read keeps the last alerts (recorded in `diag`, nothing shown).
2. Each read sets `alertsVisible`. When not visible it clears the alerts and releases the watch.
3. `AlertArrivals.next` decides the pop-up: one new alert shows its wording; several show `alerts.toast_many`; the tone is `error` if any new one is an error. The first read shows nothing.
4. Pressing the pop-up opens the bell's panel.
5. `wt-alert-handle` calls `api.markIncidentHandled`, shows the error code on the bell if it fails, and invalidates the `incidents` resource once it succeeds so every observer of the alert queries reads again.
6. `wt-alerts-see-all` selects `alerts`; `wt-alert-go-to` selects its screen. Both go through `#selectScreen`.
7. `#returnToLogin` releases the watch, resets arrivals, and clears alerts, visibility, pop-up, bell error and busy key.
8. `#permittedScreen("alerts")` returns `"alerts"` for a non-staff session. The bell's and screen's `canOpen` is `(s) => this.#permittedScreen(s) === s`.

- [ ] **Step 1: Write the failing tests**

In `dashboard-app.test.ts`, add to `stubApi`'s defaults:

```ts
    // The shell watches alerts for every non-staff session; default to none visible.
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    listHandledAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    markIncidentHandled: vi.fn().mockResolvedValue(undefined),
```

Add `import { LiveData } from "@waitron/dashboard-kit";` and `import type { AlertView } from "./api/client.js";`, and a new `describe` (use the file's existing `flush` helper and `mountWidget`; read how nearby tests wait for the probe and copy that):

```ts
describe("alerts in the shell", () => {
  const alert = (id: string, severity: AlertView["severity"] = "warning"): AlertView => ({
    key: `incident:${id}`,
    kind: "event",
    code: "payment.offline_forward_declined",
    params: { amount: "12.50", paymentRef: `pi_${id}` },
    severity,
    since: "2026-09-14T12:00:00.000Z",
    area: "payments",
  });
  const bell = (el: DashboardApp) => el.shadowRoot!.querySelector<HTMLElement>("[data-test=alerts-bell]");
  const toast = (el: DashboardApp) =>
    el.shadowRoot!.querySelector<HTMLElement & { open: boolean; message: string; tone: string }>(
      "[data-test=alert-toast]",
    )!;

  // The shell applies the session's language on login, so the session itself must be English.
  const alertsApi = (overrides: Record<string, unknown> = {}) =>
    alertsApi({
      getMe: vi.fn().mockResolvedValue({ ...meResponse, sessionDefault: "en-GB" }),
      liveData: new LiveData(),
      ...overrides,
    });
  const countOf = (el: DashboardApp) =>
    (bell(el)!.shadowRoot!.querySelector("wt-count-badge") as HTMLElement & { count: number }).count;

  it("shows the bell with its count when alerts are visible, and no pop-up on the first read", async () => {
    const api = alertsApi({
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("1", "error"), alert("2")] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    const count = bell(el)!.shadowRoot!.querySelector("wt-count-badge") as HTMLElement & { count: number };
    expect(count.count).toBe(2);
    expect(count.getAttribute("tone")).toBe("error");
    expect(toast(el).open).toBe(false);
  });

  it("shows no bell when the session may see no alerts", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api: alertsApi(), request: stubRequest });
    await flush(el);
    expect(bell(el)).toBeNull();
  });

  it("pops up a new alert, and opens the panel when the pop-up is pressed", async () => {
    const liveData = new LiveData();
    const listAlerts = vi
      .fn()
      .mockResolvedValueOnce({ visible: true, alerts: [alert("1")] })
      .mockResolvedValue({ visible: true, alerts: [alert("1"), alert("2", "error")] });
    const api = alertsApi({ listAlerts, liveData });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    liveData.invalidate([{ type: "incidents", id: "new" }]);
    await vi.waitFor(() => expect(toast(el).open).toBe(true));
    expect(toast(el).message).toContain("A card payment of 12.50 taken while offline");
    expect(toast(el).tone).toBe("error");
    toast(el).shadowRoot!.querySelector<HTMLElement>(".message")!.click();
    const popup = bell(el)!
      .shadowRoot!.querySelector("wt-row-actions")!
      .shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    expect(popup.matches(":popover-open")).toBe(true);
  });

  it("marks an alert handled from the panel and the bell updates", async () => {
    const api = alertsApi({
      listAlerts: vi
        .fn()
        .mockResolvedValueOnce({ visible: true, alerts: [alert("7")] })
        .mockResolvedValue({ visible: true, alerts: [] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    bell(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=alert-handle]")!.click();
    expect(api.markIncidentHandled).toHaveBeenCalledWith("7");
    await vi.waitFor(() => expect(countOf(el)).toBe(0));
  });

  it("handling on the Alerts screen also updates the bell, which reads the same query", async () => {
    const api = alertsApi({
      listAlerts: vi
        .fn()
        .mockResolvedValueOnce({ visible: true, alerts: [alert("7")] })
        .mockResolvedValue({ visible: true, alerts: [] }),
      listHandledAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    bell(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=alerts-see-all]")!.click();
    await flush(el);
    const screen = el.shadowRoot!.querySelector("dashboard-alerts-screen")!;
    await vi.waitFor(() =>
      expect(
        screen.shadowRoot!
          .querySelector("[data-test=open-alerts-table]")!
          .shadowRoot!.querySelector("[data-test=alert-handle]"),
      ).not.toBeNull(),
    );
    screen.shadowRoot!
      .querySelector("[data-test=open-alerts-table]")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=alert-handle]")!
      .click();
    await vi.waitFor(() => expect(countOf(el)).toBe(0));
  });

  it("See all opens the Alerts screen", async () => {
    const api = alertsApi({
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("1")] }),
      listHandledAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    bell(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=alerts-see-all]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-alerts-screen")).not.toBeNull();
    expect(location.pathname).toMatch(/^\/manage\/alerts/);
  });

  it("does not open the Alerts screen for a staff session", async () => {
    history.replaceState(null, "", "/manage/alerts");
    const api = alertsApi({ getMe: vi.fn().mockResolvedValue({ ...meResponse, role: "staff", permissions: [] }) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-alerts-screen")).toBeNull();
    expect(api.listAlerts).not.toHaveBeenCalled();
  });

  it("forgets the previous session's alerts on logout", async () => {
    const api = alertsApi({
      listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("1")] }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]")!.click();
    await flush(el);
    // The next session's first alerts read fails, so anything the bell shows is left over.
    (api as unknown as { listAlerts: unknown }).listAlerts = vi
      .fn()
      .mockRejectedValue({ code: "server.internal" });
    el.shadowRoot!
      .querySelector("dashboard-login-screen")!
      .dispatchEvent(new CustomEvent("logged-in", { bubbles: true, composed: true, detail: {} }));
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=account-menu]")).not.toBeNull();
    expect(bell(el)).toBeNull();
  });
});
```

In `dashboard-app.a11y.test.ts`, add one case to its existing theme loop that mounts a manager with `listAlerts` resolving `{ visible: true, alerts: [<one error alert>] }`, waits for the probe the way the file's other cases do, and runs its axe helper on the host, with the bell closed and then after `(bell as AlertsBell).open()`.

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "alerts in the shell"` → FAIL (no bell).

- [ ] **Step 3: Implement** — in `dashboard-app.ts`:

Imports:

```ts
import "@waitron/ui/src/components/wt-toast.js";
import "./widgets/alerts-bell.js";
import type { AlertsBell } from "./widgets/alerts-bell.js";
import "./screens/alerts-screen.js";
import { alertMessage } from "./i18n/alerts.js";
import { AlertArrivals } from "./state/alert-arrivals.js";
import type { AlertView, AlertsResponse } from "./api/client.js";
```

(`DashboardApi, PersonRole` are already imported from `./api/client.js`; merge the type import.)

Add `| "alerts"` to `CoreScreen`.

CSS, inside the component's `css` block after `.banner-actions`:

```css
      .banner-actions {
        gap: var(--wt-space-1);
      }

      /* The pop-up sits under the banner at the trailing edge, and spans the width on a phone. */
      .alert-toast {
        position: fixed;
        inset-block-start: calc(var(--wt-tap-min) + 2 * var(--wt-space-3));
        inset-inline-end: var(--wt-space-3);
        z-index: 40;
        max-width: calc(100vw - 2 * var(--wt-space-3));
      }
```

and inside the existing `@media (max-width: 48rem)` block:

```css
        .alert-toast {
          inset-inline: var(--wt-space-2);
          max-width: none;
        }
```

(If `.banner-actions` already has a `gap`, keep one declaration.)

State and controllers, beside `#languageQueries`:

```ts
  @state() private alerts: AlertView[] = [];
  @state() private alertsVisible = false;
  @state() private alertError: string | null = null;
  @state() private alertBusyKey: string | null = null;
  @state() private alertToast: { message: string; tone: "info" | "error" } | null = null;
  readonly #alertArrivals = new AlertArrivals();
  readonly #alertQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => diag.record("warn", "alerts.load_failed", { code: codeOf(error) }),
  );
```

Methods:

```ts
  #watchAlerts(): void {
    if (this.sessionRole === undefined || this.sessionRole === "staff") return;
    void this.#alertQueries
      .watch("listAlerts", [], (response) => this.#applyAlerts(response))
      .catch(() => undefined);
  }

  #applyAlerts(response: AlertsResponse): void {
    this.alertsVisible = response.visible;
    if (!response.visible) {
      this.alerts = [];
      this.#alertArrivals.reset();
      this.#alertQueries.release("listAlerts");
      return;
    }
    const arrived = this.#alertArrivals.next(response.alerts);
    this.alerts = response.alerts;
    if (arrived.length === 0) return;
    this.alertToast = {
      message:
        arrived.length === 1
          ? alertMessage(arrived[0]!.code, arrived[0]!.params)
          : t("alerts.toast_many").replace("{count}", String(arrived.length)),
      tone: arrived.some((a) => a.severity === "error") ? "error" : "info",
    };
  }

  #clearAlerts(): void {
    this.#alertQueries.release("listAlerts");
    this.#alertArrivals.reset();
    this.alerts = [];
    this.alertsVisible = false;
    this.alertError = null;
    this.alertBusyKey = null;
    this.alertToast = null;
  }

  async #onAlertHandle(event: CustomEvent<{ incidentId: string; key: string }>): Promise<void> {
    event.stopPropagation();
    this.alertBusyKey = event.detail.key;
    this.alertError = null;
    try {
      await this.api.markIncidentHandled(event.detail.incidentId);
    } catch (error) {
      if (this.isConnected) this.alertError = codeOf(error);
      return;
    } finally {
      if (this.isConnected) this.alertBusyKey = null;
    }
    // Invalidate rather than re-watch: the Alerts screen may observe the same query, and a shared
    // cache entry survives one side releasing it.
    if (this.isConnected) this.api.liveData.invalidate([{ type: "incidents" }]);
  }

  #canOpenScreen = (screen: string): boolean => this.#permittedScreen(screen) === screen;
```

Call `this.#watchAlerts();` at the end of `#applyMe` (after `#loadContentLanguages()`), and `this.#clearAlerts();` near the top of `#returnToLogin` (after the language query release).

In `#permittedScreen`, after the staff early return:

```ts
    if (requested === "alerts") return "alerts";
```

In `#banner`, inside `.banner-actions` before `<wt-row-actions ... data-test="account-menu">`:

```ts
              ${
                this.alertsVisible
                  ? html`<dashboard-alerts-bell
                      data-test="alerts-bell"
                      .alerts=${this.alerts}
                      .error=${this.alertError}
                      .busyKey=${this.alertBusyKey}
                      .canOpen=${this.#canOpenScreen}
                      @wt-alert-handle=${(e: CustomEvent<{ incidentId: string; key: string }>) =>
                        void this.#onAlertHandle(e)}
                      @wt-alerts-see-all=${(e: Event) => {
                        e.stopPropagation();
                        this.#selectScreen("alerts");
                      }}
                      @wt-alert-go-to=${(e: CustomEvent<{ screen: string }>) => {
                        e.stopPropagation();
                        this.#selectScreen(e.detail.screen);
                      }}
                    ></dashboard-alerts-bell>`
                  : nothing
              }
```

In `render()`'s authenticated branch, after `${this.#renderProfileModal()}`:

```ts
        <wt-toast
          class="alert-toast"
          data-test="alert-toast"
          .open=${this.alertToast !== null}
          .message=${this.alertToast?.message ?? ""}
          tone=${this.alertToast?.tone ?? "info"}
          close-label=${t("action.close")}
          @wt-activate=${(e: Event) => {
            e.stopPropagation();
            this.renderRoot.querySelector<AlertsBell>("dashboard-alerts-bell")?.open();
          }}
          @wt-close=${(e: Event) => {
            if (e.target !== e.currentTarget) return;
            this.alertToast = null;
          }}
        ></wt-toast>
```

In `#renderScreen`'s switch, before `default`:

```ts
      case "alerts":
        return html`<dashboard-alerts-screen
          .api=${this.api}
          .canOpen=${this.#canOpenScreen}
          @wt-alert-go-to=${(e: CustomEvent<{ screen: string }>) => {
            e.stopPropagation();
            this.#selectScreen(e.detail.screen);
          }}
        ></dashboard-alerts-screen>`;
```

Add a one-line mention to the class doc comment listing the faces: "…or see and handle alerts (reached from the banner bell, not the sidebar)".

- [ ] **Step 4: Run and verify**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts src/dashboard-app.a11y.test.ts` → PASS (the whole files: existing shell tests must stay green with the new stub methods).
Break-it checks, each restored: delete the `invalidate` line in `#onAlertHandle` → "marks an alert handled from the panel and the bell updates" FAILS; replace the `invalidate` line in the screen's `#handle` with a re-watch of its own two queries → "handling on the Alerts screen also updates the bell" FAILS (the shell still holds the shared cache entry); in `#applyAlerts` replace `this.#alertArrivals.next(response.alerts)` with `response.alerts` → "no pop-up on the first read" FAILS; delete `this.#clearAlerts()` from `#returnToLogin` → "forgets the previous session's alerts on logout" FAILS.
Then `pnpm --filter @waitron/dashboard typecheck && pnpm format:check && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/dashboard-app.ts apps/dashboard/src/dashboard-app.test.ts apps/dashboard/src/dashboard-app.a11y.test.ts
git commit -s -m "Show alerts in the dashboard banner and open the Alerts screen from it

Anyone allowed to see alerts gets a bell beside the account menu. It
updates when incidents change and once a minute. A new alert that
arrives while the dashboard is open shows a pop-up for eight seconds,
and pressing it opens the panel. Mark handled works from the panel, and
See all opens the Alerts screen. Logging out clears it all."
```

---

### Task 15: Documentation, backlog, and looking at it

**Files:**
- Modify: `docs/developers/design-system.md`, `docs/backlog.md`, `CLAUDE.md`
- Modify: `docs/handoffs/2026-09-14-dashboard-alerts.md` (gitignored ledger; not committed)

- [ ] **Step 1: Design system** — in `docs/developers/design-system.md`:
  - Colour tokens list: add `--wt-color-warning`, `--wt-color-on-warning`, with one sentence: "`--wt-color-warning` is the amber for a warning that is not yet an error (the alerts count badge); text on it uses `--wt-color-on-warning`."
  - Primitives table: add rows
    - `wt-count-badge` | `count`, `tone` (`neutral`\|`warning`\|`error`); renders nothing at zero, `99+` above 99; no accessible name of its own, so the control it decorates says the count | —
    - `wt-toast` | `open`, `tone` (`info`\|`error`), `message`, `close-label`, `duration` (ms, default 8000, `0` stays); pauses while hovered or focused; needs the app to register a `close` icon; the consumer positions it | `wt-activate` — `detail: {}`; `wt-close` — `detail: {}`
  - Update the `wt-row-actions` row: add "`badge` slot (inside the trigger, top trailing corner); `part="popup"`; methods `show()`, `hide()`".
  - Under "Dashboard banner", add: "When the session may see alerts, the alerts bell (`dashboard-alerts-bell`, a `wt-row-actions` with the `bell` icon and a `wt-count-badge`) sits immediately before the account menu. The badge is red when any open alert is an error and amber otherwise, and the trigger's name says the count. The panel lists at most five alerts and fills the width at phone width. New alerts that arrive while the page is open show a `wt-toast` under the banner at the trailing edge."
  - Under "Adding a primitive" nothing changes.

- [ ] **Step 2: Backlog** — in `docs/backlog.md`, under A5, record that branch 1 (framework and recorded events) is built on `feat/dashboard-alerts-events` and that branch 2 (the ongoing checks) is next. Keep the existing pointer to the spec.

- [ ] **Step 3: CLAUDE.md** — in §3 "Data, modules and migrations", add one line:

```markdown
- **A recorded incident code needs an area claim and English and Spanish alert wording**, or the
  dashboard shows it only under diagnostics with a generic sentence. Guard: `scripts/alert-codes.test.ts`
  — it reads source TEXT from a listed set of files, so it misses a code built at runtime, a code
  written in an unlisted file that records nothing itself (the way `packages/fiscal/src/clock.ts`
  feeds `record-sale.ts`), and an incidents sink not called `incidents(tx`.
```

- [ ] **Step 4: Look at it** (CLAUDE.md §4: open it in both themes and at phone width)

1. Start the dev stack: `wa-wt demo waitron-feat-dashboard-alerts-events`. Wait until the dashboard answers at the URL it prints.
2. Record two incidents through the running box, as the database owner, using the dev database the stack prints (a manager's view needs at least one error and one warning). Find the tenant and a till with `select id, tenant_id from tills limit 1;`, then:
   ```sql
   insert into incidents (tenant_id, till_id, code, params, severity, detected_at) values
     ('<tenant>', '<till>', 'fiscal.registro_rechazado', '{"registroId":"x","codigo":4102,"mensaje":"NIF no identificado"}', 'error', now()),
     ('<tenant>', '<till>', 'payment.reconcile_unsettled', '{"count":2,"payments":[]}', 'warning', now() - interval '2 hours');
   ```
3. Sign in as the demo manager. Confirm with `curl` in the browser's network panel, or by reading the page, that `GET /management-api/alerts` answered `visible: true` with two alerts.
4. Check, with screenshots saved to the scratchpad, in light theme and dark theme, at desktop width and at 400 px wide: the bell and its red badge; the open panel (full width at 400 px, nothing cut off); the Alerts screen on Open and on Handled after marking one handled; the pop-up, triggered by inserting a third incident while the page is open and waiting for the refresh (up to a minute, sooner if the live stream is running).
5. Render the `bell` and `close` icons large (the icons file asks for this before use) by zooming the screenshot, and confirm each is recognisable.
6. Fix anything that looks wrong in the task that owns it, with a test where one can catch it, and re-run that task's verify step.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format:check && pnpm lint && pnpm vitest run scripts/claude-md-pointers.test.ts scripts/alert-codes.test.ts` → PASS.

```bash
git add docs/developers/design-system.md docs/backlog.md CLAUDE.md
git commit -s -m "Document the alerts bell, badge and toast, and the incident wording rule

Adds the warning colours, wt-count-badge, wt-toast and the new
wt-row-actions options to the design system, describes the bell in the
banner, records in the backlog that alerts branch 1 is built, and adds a
CLAUDE.md rule that every recorded incident code needs an area and
wording, naming the guard that checks it."
```

Update the ledger `docs/handoffs/2026-09-14-dashboard-alerts.md`: branch 1 tasks complete, next step `/finish-branch` (fiscal-adjacent: owner sign-off at land), then branch 2.

---

## Self-review notes (for the plan reviewer)

- Spec coverage: model (T3), sources and seat (T3, T4), `fiscal.view` (T1), three routes (T5), marking handled (T2, T5), bell/panel/screen/pop-up (T12–T14), shared badge and toast (T8, T9), wording for every code in use (T7), code-coverage guard (T7), passive refresh (T11), look at it (T15). The ongoing checks and caches are branch 2 and are not here.
- The spec's route test "a session with only `payments.manage`" is at service level (ruling 6).
- The spec's "The poll carries the passive header" is tested in T11 (`live-queries.test.ts`); the server side is the existing global `x-waitron-live` middleware in `boot.ts`, unchanged.
- A fresh-context plan-vs-spec review ran on 2026-09-14 (no blockers; six important, seven minor). Every finding is applied here: core claims inline on the descriptor, the area-mismatch refusal tested with a registry that splits permissions, 404 before lookup for a session with no alert permission, invalidation after marking handled (a re-watch returns the shared cache entry), separate load and action errors, English sessions in the shell tests, no `data-keep-open`, a non-Spanish kit fixture plus the english-only guard in Task 6's verify step, the guard's full blind spots in CLAUDE.md, an index for the handled read, and corrected reconcile wording.

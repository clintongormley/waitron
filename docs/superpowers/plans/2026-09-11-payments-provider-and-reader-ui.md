# Card payment providers and readers from the dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator connect card payment providers (SumUp, Stripe), register the venue's card readers, and give each till a default reader — all from the dashboard at runtime, with no restart and no terminal on the box — and route each card sale to the chosen reader's provider.

**Architecture:** A new **card-provider seat** (`CardProviderContribution`) lets each provider package own its credential shape, connect verification, live-provider construction, and reader operations (pair/register, status, remove); generic code names no provider. Composition assembles the seats into a `CARD_PROVIDERS` registry (server) and a `CARD_PROVIDER_PANELS` registry (browser), the twins of `@waitron/composition`'s `ALL_MODULES` and `@waitron/dashboard-modules`'s `DASHBOARD_MODULES`. A **lazy in-memory pool** builds each provider from its sealed vault credential on first use and evicts it when the credential is saved. Two new payments-module tables (`card_readers`, `device_card_readers`) hold the readers and each device's default; the env-var provider selection is removed (nothing is in production — CLAUDE.md §3).

**Tech Stack:** TypeScript, pnpm workspaces, Hono (server), Lit (dashboard/till), Drizzle + PostgreSQL, Vitest (+ Testcontainers for real-PG), the existing `@waitron/credentials` AES-GCM vault.

**Spec:** `docs/superpowers/specs/2026-09-11-payments-provider-and-reader-ui-design.md` (read it alongside this plan).

## Global Constraints

- **No backwards-compatibility / data-migration code.** Nothing is in production; schema changes drop and recreate (CLAUDE.md §3).
- **Every by-id read of a tenant-bearing table carries `eq(<table>.tenantId, cfg.tenantId)`.** One-tenant-per-db is NOT the query's isolation boundary since RLS was dropped (#255). This is a risk trigger — full review + a real-PG two-tenant probe as `app_user` (CLAUDE.md §3, §4).
- **Error codes name the DOMAIN concept, never the throwing package** (`reader.not_found`, not `payments.reader_not_found`); codes are never renamed once shipped; every file that throws a code imports its registry `import "./errors.js"` (CLAUDE.md §3).
- **Credentials: never echo a secret back; validate the payload with `validatePayload`; no secret in any `AppError` params** (the recovery-page boundary, CLAUDE.md §3). `app_user` already holds INSERT/UPDATE/DELETE on `tenant_credentials` — no grant change.
- **A dashboard client type is a LOCAL copy, never imported from a server/db package** (bundle purity; `apps/dashboard/src/api/client.ts:11-21`). A provider's browser strings live in its `@waitron/<pkg>/dashboard` subpath, never in server code.
- **Payments-table grants use `GRANT SELECT, INSERT, UPDATE` (no DELETE)** unless the table is a mutable mapping that needs row deletion; statements separated by `--> statement-breakpoint`.
- **Plain English** in every commit message and PR line (owner rule).
- **Run the gate** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test` before the PR; per task run the changed package's `test:coverage` + direct dependents, and the WHOLE workspace after touching `packages/composition`, `packages/module`, `packages/identity` or `packages/db` schema (values more than one suite asserts).
- **Coverage floors:** `payments`, `db`, `core`, `sync` sit at `98/98/98/95`; others at `90/90/85/85`. New root guards live in the root Vitest project (`scripts/`).

---

## File Structure

**New files**

- `packages/payments/src/card-provider.ts` — the `CardProviderContribution` seat type + `selectCardProviders`/`cardProviderById` selector; exported from `@waitron/payments`.
- `packages/payments/src/schema/card-readers.ts` — `card_readers` table.
- `packages/payments/src/schema/device-card-readers.ts` — `device_card_readers` table.
- `packages/payments/drizzle/`: `0003_card_readers.sql` + `0004_card_readers_sql.sql` (Task 1); `0005_device_card_readers.sql` + `0006_device_card_readers_sql.sql` (Task 2); `0007_payment_reader_id.sql` (+ `0008_*_sql.sql` only if the FK needs hand-writing) (Task 3) — plus snapshots. (The payments journal ends at `0002`, so `0003` is the next free number.)
- `packages/payments-sumup/src/card-provider.ts` — `SUMUP_CARD_PROVIDER` (server seat).
- `packages/payments-sumup/src/dashboard/index.ts` + `panel.ts` + `strings.ts` + `client.ts` + `sumup-connect-form.ts` + `sumup-add-reader.ts` — browser panel (`@waitron/payments-sumup/dashboard`).
- `packages/payments-stripe/src/card-provider.ts` — `STRIPE_CARD_PROVIDER` (server seat).
- `packages/payments-stripe/src/dashboard/index.ts` + `panel.ts` + `strings.ts` + `client.ts` + `stripe-connect-form.ts` + `stripe-add-reader.ts` — browser panel.
- `apps/server/src/payments-api.ts` — the generic `mountPaymentsApi` routes.
- `apps/server/src/card-provider-pool.ts` — the lazy provider pool.
- `packages/dashboard-modules/src/card-providers.ts` — `CARD_PROVIDER_PANELS` registry (or a sibling file in the same package).
- `apps/dashboard/src/screens/payments-screen.ts` — the generic Payments screen.
- `apps/dashboard/src/widgets/reader-picker.ts` — the payment-time reader picker (reused by slice 2).
- Root guard: extend `scripts/module-seams.test.ts` (no new file).

> **Plan refinement of the spec (I3).** Spec §3's "Knock-on facts" imagined folding SumUp/Stripe into `ALL_MODULES` as table-less modules and making `WaitronModule.migrations` optional. This plan does NOT do that: `WaitronModule.migrations` is required, and forcing empty migration sets onto pure adapter packages is friction with no payoff. Instead the card-provider seat is a **standalone registry** — `CARD_PROVIDERS` in `packages/composition/src/card-providers.ts` (server) and `CARD_PROVIDER_PANELS` in `packages/dashboard-modules` (browser), each the exact parallel of `ALL_MODULES` / `DASHBOARD_MODULES`. So `packages/module`'s descriptor and `packages/composition/src/modules.ts` are NOT touched, and the spec's "run the whole workspace after touching `packages/module`" note does not apply; run it after touching `packages/composition` instead.

**Modified files** (exact edits in the tasks): `packages/payments/src/{index.ts,classification.ts,schema/index.ts}`, `packages/payments-sumup/src/{index.ts,sumup-client.ts,client.ts,errors.ts,testing/*}`, `packages/payments-stripe/src/index.ts`, `packages/composition/src/index.ts`, `packages/dashboard-modules/src/index.ts`, `packages/identity/src/permissions.ts`, `packages/db/src/schema/devices.ts`, `packages/db/drizzle/*` (new core migration dropping two columns), `apps/server/src/{boot.ts,till-config.ts,till-api.ts,device-session.ts,device-api.ts,errors.ts}`, `apps/till/src/{api/client.ts,widgets/tender-pay.ts,widgets/card-grid.ts,screens/till-counter-screen.ts,till-app.ts}`, `apps/dashboard/src/{dashboard-app.ts,api/client.ts,screens/devices-screen.ts,i18n/strings.ts,i18n/codes.ts}`, the demo/seed/fixture files that insert `devices.card_provider`.

---

# Phase A — data model and the seat contract

### Task 1: `card_readers` table

**Files:**
- Create: `packages/payments/src/schema/card-readers.ts`
- Modify: `packages/payments/src/schema/index.ts` (add named export), `packages/payments/src/classification.ts`
- Create (generated): `packages/payments/drizzle/0003_card_readers.sql` + `packages/payments/drizzle/0004_card_readers_sql.sql`
- Test: `packages/payments/src/schema/card-readers.fk.test.ts`, and the existing `packages/payments/src/classification.test.ts` gains a case.

**Interfaces:**
- Produces: table `cardReaders` with columns `id, tenantId, provider, providerRef, name, active, createdAt, retiredAt` and `unique("card_readers_tenant_id_key").on(tenantId, id)` (the composite-FK target Task 3 and Task 2 use), `unique("card_readers_provider_ref_key").on(tenantId, provider, providerRef)`.

- [ ] **Step 1: Write the failing schema-shape test.** Use `useRealPostgres` + `asAppUser` (not PGlite) so this doubles as the grant check — grants are not enforced on PGlite (CLAUDE.md §4). The accessor pattern is the one `useRealPostgres` returns (an accessor that throws before setup); `withTenant`/`asAppUser` come from `@waitron/db`. Assert the row round-trips; the `(tenant_id, provider, provider_ref)` unique rejects a duplicate; `retired_at` defaults null.

```ts
// card-readers.fk.test.ts — shape + unique (useRealPostgres accessor `pg`)
it("stores a reader and rejects a duplicate (tenant, provider, provider_ref)", async () => {
  const db = pg(); // the useRealPostgres accessor, throws before setup
  await withTenant(db, tenantId, async (tx) => { await asAppUser(tx);
    await tx.insert(cardReaders).values({ tenantId, provider: "sumup", providerRef: "rdr_1", name: "Counter" });
  });
  await expect(withTenant(db, tenantId, async (tx) => { await asAppUser(tx);
    await tx.insert(cardReaders).values({ tenantId, provider: "sumup", providerRef: "rdr_1", name: "Dup" });
  })).rejects.toThrow(/card_readers_provider_ref_key/);
});
```

- [ ] **Step 2: Run it, expect FAIL** (`cardReaders` undefined). Run: `pnpm --filter @waitron/payments test -- card-readers.fk`

- [ ] **Step 3: Write the table.** Follow the `payments.ts` idioms (uuid/text/timestamptz, `foreignKey`, `unique`).

```ts
// packages/payments/src/schema/card-readers.ts
import { boolean, foreignKey, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";

export const cardReaders = pgTable(
  "card_readers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    // A plain config token (the provider's id), NOT a credential.
    provider: text("provider").notNull(),
    // The provider's own opaque reference (SumUp/Stripe reader id). A public identifier, NOT a credential.
    providerRef: text("provider_ref").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    // Set when `active` flips false; the row is kept so historical payments still resolve a name.
    retiredAt: timestamp("retired_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id], name: "card_readers_tenant_fk" }).onDelete("restrict"),
    // Composite target for tenant-consistent FKs from device_card_readers and payments.reader_id.
    unique("card_readers_tenant_id_key").on(t.tenantId, t.id),
    unique("card_readers_provider_ref_key").on(t.tenantId, t.provider, t.providerRef),
  ],
);
```

- [ ] **Step 4: Register in the schema barrel.** Add to `packages/payments/src/schema/index.ts`:
```ts
export { cardReaders } from "./card-readers.js";
```

- [ ] **Step 5: Generate the DDL + write the custom grants.** From `packages/payments`: `pnpm db:generate --name card_readers` (emits `0003_card_readers.sql` with the `CREATE TABLE`), then `pnpm db:generate:custom --name card_readers_sql` and hand-write the grants into `0004_card_readers_sql.sql`:
```sql
REVOKE ALL ON "card_readers" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "card_readers" TO app_user;
```
(SELECT/INSERT/UPDATE only — a reader is retired via UPDATE `active=false`, never DELETE.)

- [ ] **Step 6: Classify it.** Add to `packages/payments/src/classification.ts` in the `state` group:
```ts
  classify("card_readers", "state", STATE),
```
and add a matching assertion in `classification.test.ts` (or rely on the existing completeness assertion — confirm it enumerates the new table).

- [ ] **Step 6b: Free "reader" as neutral vocabulary (controller ruling, 2026-09-11).** `packages/payments/src/no-provider-vocabulary.test.ts` bans the substrings `"reader"` and `"readerid"` in this neutral package (it keeps provider/SDK names out). This feature makes "card reader" the neutral, provider-agnostic domain concept the payments module owns, so remove `"reader"` and `"readerid"` from that guard's `FORBIDDEN` list and update its teeth: drop the `expect(mentionsTerm("class NFCReader {}", "reader")).toBe(true)` line, and change the "longer word that merely starts with the term" teeth case to use a still-forbidden term (e.g. `mentionsTerm("the terminates soon", "terminal")` → false) instead of `reader`. Leave `stripe`, `adyen`, `sumup`, `paymentintent`, `terminal`, `connectiontoken`, `acquirer` banned — the provider-neutrality boundary is unchanged. This edit is part of Task 1's commit.

- [ ] **Step 7: Run tests.** `pnpm --filter @waitron/payments test:coverage` (the full package suite must be green — the guard above is what kept it red); then the root guard `pnpm test -- classification-complete` (every created table classified once). Expected: PASS.

- [ ] **Step 8: Commit.** `git add -A packages/payments && git commit -s -m "Add the card_readers table for venue-owned card readers"`

---

### Task 2: `device_card_readers` table (a device's default reader)

**Files:**
- Create: `packages/payments/src/schema/device-card-readers.ts`
- Modify: `packages/payments/src/schema/index.ts`, `packages/payments/src/classification.ts`
- Create: `packages/payments/drizzle/0005_device_card_readers.sql` (generated) + `0006_device_card_readers_sql.sql` (custom grants + composite FKs)
- Test: `packages/payments/src/schema/device-card-readers.fk.test.ts`

**Interfaces:**
- Produces: table `deviceCardReaders` — `tenantId`, `deviceId`, `readerId`, PK `(tenantId, deviceId)`, composite FK `(tenantId, deviceId) → devices(tenantId, id)` and `(tenantId, readerId) → card_readers(tenantId, id)`.

- [ ] **Step 1: Write the failing test.** Insert a device + a reader + a `device_card_readers` row; assert PK `(tenant, device)` rejects a second default for the same device; assert the composite FK to a non-existent reader is rejected; assert delete-the-row clears the default.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Write the table.**
```ts
// packages/payments/src/schema/device-card-readers.ts
import { foreignKey, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { devices, tenants } from "@waitron/db";
import { cardReaders } from "./card-readers.js";

export const deviceCardReaders = pgTable(
  "device_card_readers",
  {
    tenantId: uuid("tenant_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    readerId: uuid("reader_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.deviceId] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id], name: "device_card_readers_tenant_fk" }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id], name: "device_card_readers_device_fk" }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.readerId], foreignColumns: [cardReaders.tenantId, cardReaders.id], name: "device_card_readers_reader_fk" }).onDelete("restrict"),
  ],
);
```

- [ ] **Step 4: Barrel + generate + custom SQL.** Add `export { deviceCardReaders } from "./device-card-readers.js";`. Generate DDL, then custom grants — this table is a mutable mapping, so it gets DELETE:
```sql
REVOKE ALL ON "device_card_readers" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "device_card_readers" TO app_user;
```

- [ ] **Step 5: Classify** `classify("device_card_readers", "state", STATE)`.

- [ ] **Step 6: Run** `pnpm --filter @waitron/payments test:coverage` + `pnpm test -- classification-complete module-graph-honesty`. The graph guard must see the cross-set FK payments→core is declared: confirm the `payments` descriptor `requires: { core: "*" }` already covers it (it does — `modules.ts`). Expected PASS.

- [ ] **Step 7: Commit.** `-m "Add device_card_readers: each device's default card reader"`

---

### Task 3: `payments.reader_id` — stamp the reader on a payment

**Files:**
- Modify: `packages/payments/src/schema/payments.ts` (add nullable `readerId` + composite FK)
- Create: `packages/payments/drizzle/0007_payment_reader_id.sql` (generated) + `0008_payment_reader_id_sql.sql` if the FK needs hand-writing
- Test: extend `packages/payments/src/schema/payments.*.test.ts` or add `payments-reader-id.test.ts`

**Interfaces:**
- Produces: `payments.readerId: uuid | null` with composite FK `(tenantId, readerId) → card_readers(tenantId, id)` (MATCH SIMPLE, satisfied while null), named `payments_reader_fk`.

- [ ] **Step 1: Write the failing test.** Insert a payment with a `readerId` pointing at a `card_readers` row; assert it round-trips; assert a `readerId` for a different tenant's reader is rejected by the composite FK.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Add the column + FK** in `payments.ts` (nullable uuid + `foreignKey(...)` in the `(t) => [...]` array, following `payments_sale_fk`):
```ts
    readerId: uuid("reader_id"),
```
```ts
    foreignKey({
      columns: [t.tenantId, t.readerId],
      foreignColumns: [cardReaders.tenantId, cardReaders.id],
      name: "payments_reader_fk",
    }).onDelete("restrict"),
```
Import `cardReaders` from `./card-readers.js` at the top of `payments.ts`.

- [ ] **Step 4: Generate.** `pnpm db:generate --name payment_reader_id`. Grants unchanged (payments already has SELECT/INSERT/UPDATE). If drizzle emits the FK inline, no custom file is needed; otherwise hand-write it in `0008_*_sql.sql`.

- [ ] **Step 5: Run** `pnpm --filter @waitron/payments test:coverage`. Expected PASS.

- [ ] **Step 6: Commit.** `-m "Stamp the card reader on each payment row"`

---

### Task 4: the `payments.manage` permission

**Files:**
- Modify: `packages/identity/src/permissions.ts`
- Test: `packages/identity/src/permissions.test.ts`

**Interfaces:**
- Produces: core permission `"payments.manage"`, held by MANAGER and ADMIN, never staff/supervisor.

- [ ] **Step 1: Write the failing test.** Assert `roleHasPermission("manager", "payments.manage")` is true, `("admin", ...)` true, `("supervisor", ...)` and `("staff", ...)` false.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Add it.** Append `"payments.manage"` to the `PERMISSIONS` array (beside `"printer.manage"`, `permissions.ts:70` region) with a one-line comment stating the invariant (gates the Payments configuration screen; never renamed). Add `"payments.manage"` to the `MANAGER` set (`permissions.ts:105-118`). Admin inherits it via `ALL = new Set(PERMISSIONS)`.

- [ ] **Step 4: Run** `pnpm --filter @waitron/identity test:coverage`. Expected PASS.

- [ ] **Step 5: Commit.** `-m "Add the payments.manage permission for managers and admins"`

---

### Task 5: the `CardProviderContribution` seat + selector

**Files:**
- Create: `packages/payments/src/card-provider.ts`
- Modify: `packages/payments/src/index.ts` (export the type + selector)
- Test: `packages/payments/src/card-provider.test.ts`

**Interfaces:**
- Produces (imported by payments-sumup, payments-stripe, apps/server, composition):
```ts
// packages/payments/src/card-provider.ts
import type { Database } from "@waitron/db";
import type { KeyRing, Purpose } from "@waitron/credentials";
import { AppError, type TenantId, type TillId } from "@waitron/shared";
import type { PaymentProvider } from "./provider.js";
import type { IncidentSink } from "./reconcile.js";

/** A browser-safe field descriptor for the generic connect form. `secret` fields are password inputs
 * and are never echoed back by any GET. `optional` lets a field (SumUp affiliate) be left blank. */
export interface ProviderCredentialField {
  name: string;          // the vault payload key (e.g. "apiKey")
  labelKey: string;      // an i18n key the provider's dashboard panel registers
  secret: boolean;
  optional?: boolean;
}

/** How the generic screen renders "add a reader" for this provider. */
export type ReaderAddMode =
  | { kind: "pairing-poll"; codeLabelKey: string }   // SumUp: post a code, poll until paired
  | { kind: "reference"; refLabelKey: string };       // Stripe: paste a reader id, verify once

export interface ConnectResult {
  /** The merchant name to show for confirmation; the seat has verified the credentials. */
  merchantName: string;
  /** The COMPLETE payload to seal under `credentialPurpose`, assembled by the seat from the form
   * values plus anything it discovered (SumUp fills in `merchantCode` from the memberships call and
   * the `-` affiliate placeholders). The route validates it with `validatePayload` and seals it
   * verbatim, so the generic route never assembles a provider-shaped payload. */
  sealedPayload: Record<string, string>;
}

export interface AddReaderResult {
  providerRef: string;
  /** For pairing-poll: `processing` until the device confirms; the screen polls status until paired. */
  status: "paired" | "processing";
}

export interface CardProviderContribution {
  readonly providerId: string;                 // "sumup" | "stripe"
  readonly credentialPurpose: Purpose;         // "payments.sumup" | "payments.stripe"
  readonly credentialFields: readonly ProviderCredentialField[];
  readonly readerAdd: ReaderAddMode;
  /** Verify the typed credentials against the provider WITHOUT sealing, and return the merchant name
   * to confirm PLUS the complete payload to seal. Throws `payment.provider_credential_rejected` on a
   * bad credential. If the credential spans several merchants and `payload` names none, throws
   * `payment.provider_merchant_ambiguous` with `{ merchants: [{ code, name }] }` (codes and names are
   * not secrets) so the form offers a picker and re-submits `payload` with the chosen `merchantCode`. */
  connect(deps: { fetch?: typeof fetch }, payload: Record<string, string>): Promise<ConnectResult>;
  /** Build the live PaymentProvider from the sealed credential (called by the pool). */
  build(deps: CardProviderBuildDeps): PaymentProvider;
  readers: {
    add(deps: CardProviderRuntimeDeps, input: { name: string; code?: string; reference?: string }): Promise<AddReaderResult>;
    status(deps: CardProviderRuntimeDeps, providerRef: string): Promise<ReaderStatus>;
    remove(deps: CardProviderRuntimeDeps, providerRef: string): Promise<void>;
  };
}

export interface ReaderStatus { online: boolean; detail?: string } // detail: connection type, screen state
export interface CardProviderBuildDeps {
  db: Database; ring: KeyRing; tenantId: TenantId; nodeId: string;
  environment: "preproduction" | "production";
  /** The pool supplies this so the built provider resolves each sale's chosen reader ref. */
  resolveReader: (tenantId: TenantId, tillId: TillId) => Promise<string>;
  /** Where a provider raises `payment.pending_outcome_unactionable` (SumUp's resolvePending). */
  incidents: IncidentSink;
}
export interface CardProviderRuntimeDeps { db: Database; ring: KeyRing; tenantId: TenantId; fetch?: typeof fetch }

export function selectCardProviders(list: readonly CardProviderContribution[]): Map<string, CardProviderContribution> {
  const byId = new Map<string, CardProviderContribution>();
  for (const c of list) {
    if (byId.has(c.providerId)) throw new AppError("payment.provider_duplicate", { providerId: c.providerId });
    byId.set(c.providerId, c);
  }
  return byId;
}
export function cardProviderById(list: readonly CardProviderContribution[], id: string): CardProviderContribution {
  const c = selectCardProviders(list).get(id);
  if (c === undefined) throw new AppError("payment.provider_unknown", { providerId: id });
  return c;
}
```
(Import `AppError` from `@waitron/shared`; register `payment.provider_duplicate` / `payment.provider_unknown` in `packages/payments/src/errors.ts`.)

- [ ] **Step 1: Write the failing test** for `selectCardProviders` (duplicate id throws `payment.provider_duplicate`) and `cardProviderById` (unknown throws `payment.provider_unknown`, found returns it), using two fake contributions.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Write `card-provider.ts`** (the type + selectors above) and add the two error codes to `packages/payments/src/errors.ts`.

- [ ] **Step 4: Export** from `packages/payments/src/index.ts`:
```ts
export type { CardProviderContribution, ProviderCredentialField, ReaderAddMode, ConnectResult, AddReaderResult, ReaderStatus, CardProviderBuildDeps, CardProviderRuntimeDeps } from "./card-provider.js";
export { selectCardProviders, cardProviderById } from "./card-provider.js";
```

- [ ] **Step 5: Run** `pnpm --filter @waitron/payments test:coverage`. Expected PASS.

- [ ] **Step 6: Commit.** `-m "Add the card-provider seat contract each provider fills"`

---

# Phase B — provider seats, client calls, and the pool

### Task 6: SumUp client — the five reader-management calls

**Files:**
- Modify: `packages/payments-sumup/src/client.ts` (grow `SumUpClient`), `packages/payments-sumup/src/sumup-client.ts` (implement), `packages/payments-sumup/src/testing/fake-sumup-client.ts` (grow the fake — find its path), `packages/payments-sumup/src/index.ts`
- Test: `packages/payments-sumup/src/sumup-client.test.ts` (add cases with a stub `fetch`)

**Interfaces:**
- Produces on `SumUpClient`:
```ts
  listReaders(): Promise<{ id: string; name: string; status: string }[]>;
  pairReader(params: { pairingCode: string; name: string }): Promise<{ id: string; status: string }>;
  getReader(readerId: string): Promise<{ id: string; status: string } | null>;
  readerStatus(readerId: string): Promise<{ online: boolean; detail?: string }>;
  deleteReader(readerId: string): Promise<void>;
```

- [ ] **Step 1: Write the failing tests** with an injected `fetch` stub asserting the exact method+path and returning canned bodies. The paths, verified against the experiments runbook and SumUp docs:
  - `listReaders` → `GET /v0.1/merchants/{mc}/readers` → `{ items: [...] }`.
  - `pairReader` → `POST /v0.1/merchants/{mc}/readers` body `{ pairing_code, name }` → 201 `{ id, status: "processing" }`.
  - `getReader` → `GET /v0.1/merchants/{mc}/readers/{id}` → `{ id, status }`; 404 → null.
  - `readerStatus` → `GET /v0.1/merchants/{mc}/readers/{id}/status` → map `ONLINE`→`{online:true, detail}`.
  - `deleteReader` → `DELETE /v0.1/merchants/{mc}/readers/{id}` → 204.

```ts
it("pairs a reader from a code", async () => {
  const calls: [string, string][] = [];
  const fetchStub = async (url: string, init: RequestInit) => {
    calls.push([init.method!, new URL(url).pathname]);
    return new Response(JSON.stringify({ id: "rdr_9", status: "processing" }), { status: 201 });
  };
  const c = sumupClient({ apiKey: "k", merchantCode: "MY2NPHDW", fetch: fetchStub as typeof fetch });
  const r = await c.pairReader({ pairingCode: "ABC12345", name: "Counter" });
  expect(r).toEqual({ id: "rdr_9", status: "processing" });
  expect(calls).toContainEqual(["POST", "/v0.1/merchants/MY2NPHDW/readers"]);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** the five methods in `sumup-client.ts` using the existing `call(method, path, body?)` helper (`sumup-client.ts:46`), and add them to the `SumUpClient` interface in `client.ts`. **`call`'s `method` param is typed `"GET" | "POST"` (`sumup-client.ts:37`) — widen it to include `"DELETE"`** for `deleteReader`. `readerStatus` maps the `status` field (`ONLINE`/`OFFLINE`) and includes the connection type in `detail`. A `>= 500` throws (existing `call` behaviour); a 404 on `getReader` returns null. Also add a `memberships()` method here (used by the SumUp connect seat in Task 7): `GET /v0.1/memberships` → the merchant list.

- [ ] **Step 4: Grow the fake** (`FakeSumUpClient`) so hermetic seat/provider tests can drive pairing: an in-memory reader map, `pairReader` inserts with `processing`, a test helper to flip it to `paired`, `readerStatus` returns online.

- [ ] **Step 5: Run** `pnpm --filter @waitron/payments-sumup test:coverage`. Expected PASS.

- [ ] **Step 6: Commit.** `-m "Add SumUp reader pairing, status and removal calls"`

---

### Task 7: SumUp card-provider seat (server)

**Files:**
- Create: `packages/payments-sumup/src/card-provider.ts`
- Modify: `packages/payments-sumup/src/index.ts`
- Test: `packages/payments-sumup/src/card-provider.test.ts`

**Interfaces:**
- Produces: `export const SUMUP_CARD_PROVIDER: CardProviderContribution` with `providerId: "sumup"`, `credentialPurpose: "payments.sumup"`, `credentialFields` = apiKey (secret), merchantCode is DERIVED not entered (see below), affiliateAppId/affiliateKey (secret, optional), `readerAdd: { kind: "pairing-poll", codeLabelKey: "payments.sumup.pairing_code" }`.

Design note the executor must honour: **the operator enters only the API key (+ optional affiliate).** `connect` calls SumUp's memberships endpoint (`GET /v0.1/memberships`) with that key, reads the merchant code, and returns BOTH `merchantName` and the complete `sealedPayload` — the full four-field `payments.sumup` shape (`apiKey, merchantCode, affiliateAppId, affiliateKey`, `-` for an absent affiliate). So `credentialFields` describes the FORM (apiKey + affiliate); the seat assembles the sealed payload inside `connect` and the generic route seals `result.sealedPayload` verbatim (C1). If the key spans several merchants and `payload.merchantCode` is absent, `connect` throws `payment.provider_merchant_ambiguous` with `{ merchants: [{ code, name }] }` and the form re-submits with the chosen `merchantCode`.

- [ ] **Step 1: Write failing tests** with a `FakeSumUpClient` + a stub memberships fetch:
  - `connect` with a good key over a single-merchant membership returns `{ merchantName: "Test restaurant", sealedPayload: { apiKey, merchantCode: "MY2NPHDW", affiliateAppId: "-", affiliateKey: "-" } }`.
  - `connect` with a bad key (memberships 401) throws `payment.provider_credential_rejected`.
  - `connect` with a key spanning two merchants and no `merchantCode` throws `payment.provider_merchant_ambiguous` carrying both `{ code, name }`; re-calling with the chosen `merchantCode` returns that merchant's `sealedPayload`.
  - `build` returns a `SumUpCloudProvider` whose `provider === "sumup"`.
  - `readers.add({ name, code })` calls `pairReader` and returns `{ providerRef, status }`.
  - `readers.status(ref)` maps online; `readers.remove(ref)` calls `deleteReader`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `SUMUP_CARD_PROVIDER`, and register `payment.provider_merchant_ambiguous` in `packages/payments-sumup/src/errors.ts` (no secret in its params — merchant codes and names only). `connect` builds a `sumupClient` from the form key and calls a `memberships()` client method (add it to `SumUpClient` in Task 6, or here if missed), assembles `sealedPayload`, and throws the ambiguity error when needed. `build` reads the sealed credential via the same shape as `sumupClientResolver` and constructs `SumUpCloudProvider`, taking `resolveReader` and `incidents` from `CardProviderBuildDeps` (both are on the Task 5 type — the seat stays pure, no import from apps/server).

- [ ] **Step 4: Export** `SUMUP_CARD_PROVIDER` from `packages/payments-sumup/src/index.ts`.

- [ ] **Step 5: Run** `pnpm --filter @waitron/payments-sumup test:coverage`. Expected PASS.

- [ ] **Step 6: Commit.** `-m "Add the SumUp card-provider seat: connect, build and reader pairing"`

---

### Task 8: Stripe card-provider seat (server)

**Files:**
- Create: `packages/payments-stripe/src/card-provider.ts`
- Modify: `packages/payments-stripe/src/index.ts`
- Test: `packages/payments-stripe/src/card-provider.test.ts`

**Interfaces:**
- Produces: `export const STRIPE_CARD_PROVIDER: CardProviderContribution` with `providerId: "stripe"`, `credentialPurpose: "payments.stripe"`, `credentialFields` = secretKey (secret) + webhookSecret/successUrl/cancelUrl (as today's payload), `readerAdd: { kind: "reference", refLabelKey: "payments.stripe.reader_id" }`.

- [ ] **Step 1: Write failing tests** with an injected `makeStripe` fake:
  - `connect` verifies the secret key by one retrieve/balance call and returns a merchant name (the Stripe account's display name, or the account id if none); a bad key throws `payment.provider_credential_rejected`; a live/test prefix mismatch throws `payment.credential_environment_mismatch` (reuse `stripeSecretKeyFrom`).
  - `build` returns a `StripeTerminalProvider` with `provider === "stripe"`.
  - `readers.add({ name, reference })` verifies the reader id via `client.retrieve`-equivalent and returns `{ providerRef: reference, status: "paired" }`.
  - `readers.status(ref)` returns online/offline; `readers.remove` is a no-op (no vendor call).

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `STRIPE_CARD_PROVIDER`, reusing `stripeSecretKeyFrom` and the existing `stripeClient`/`stripeDeviceClient`. `build` constructs `StripeTerminalProvider` (server-driven reader) — the `stripe_on_device` phone path is NOT a reader and is out of this seat.

- [ ] **Step 4: Export** from `packages/payments-stripe/src/index.ts`.

- [ ] **Step 5: Run** `pnpm --filter @waitron/payments-stripe test:coverage`. Expected PASS.

- [ ] **Step 6: Commit.** `-m "Add the Stripe card-provider seat: connect, build and reader registration"`

---

### Task 9: the `CARD_PROVIDERS` registry + the seam rule

**Files:**
- Modify: `packages/composition/src/index.ts` (export `CARD_PROVIDERS`), create `packages/composition/src/card-providers.ts`
- Modify: `scripts/module-seams.test.ts` (new `PROVIDER_PACKAGES` rule)
- Test: `packages/composition/src/card-providers.test.ts` + the seam test

**Interfaces:**
- Produces: `export const CARD_PROVIDERS: readonly CardProviderContribution[] = [SUMUP_CARD_PROVIDER, STRIPE_CARD_PROVIDER]`.

- [ ] **Step 1: Write the failing test.** `card-providers.test.ts`: `selectCardProviders(CARD_PROVIDERS)` has keys `["sumup","stripe"]` and no duplicate. Seam test: a new describe block asserting `apps/server/src` files import `@waitron/payments-sumup` / `@waitron/payments-stripe` ONLY via an allowlist. **Derive the allowlist by grep, don't trust a hard-coded four-file list** — at authoring time `grep -rl '@waitron/payments-sumup\|@waitron/payments-stripe' apps/server/src` returns `boot.ts`, `stripe-account.ts`, `sumup-account.ts`, `webhook.ts`; put each in the allowlist `Map` with a one-line reason (e.g. `boot.ts → "env buildCardProvider + hosted/webhook wiring; migrates behind the seat later — Task 12 removes it"`). Mirror the provisioning-block pattern (`module-seams.test.ts:86-103`) and add a positive control (a synthetic file importing a provider package is flagged). **Do NOT copy the regime rule's "every allowlist entry must genuinely import the package" sub-assertion** — Task 12 empties `boot.ts` from the list mid-branch, and a strict sub-assertion would go red between commits; instead the allowlist is advisory (non-allowlisted files must be clean; allowlisted files may or may not import). Task 12 removes `boot.ts` when it becomes clean.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Write** `packages/composition/src/card-providers.ts`:
```ts
import type { CardProviderContribution } from "@waitron/payments";
import { SUMUP_CARD_PROVIDER } from "@waitron/payments-sumup";
import { STRIPE_CARD_PROVIDER } from "@waitron/payments-stripe";
export const CARD_PROVIDERS: readonly CardProviderContribution[] = [SUMUP_CARD_PROVIDER, STRIPE_CARD_PROVIDER];
```
Export it from `packages/composition/src/index.ts`. Add `@waitron/payments-sumup` + `@waitron/payments-stripe` to `packages/composition/package.json` dependencies.

- [ ] **Step 4: Add the seam rule** with a `PROVIDER_PACKAGES = ["@waitron/payments-sumup", "@waitron/payments-stripe"]` const and an allowlist `Map` carrying the reason per existing file (e.g. `"apps/server/src/boot.ts" → "env-path buildCardProvider + hosted/webhook wiring, migrates behind the seat in a later slice"`). New provider-reaching files must go through `CARD_PROVIDERS`.

- [ ] **Step 5: Run** `pnpm test -- module-seams` and `pnpm --filter @waitron/composition test:coverage`. Expected PASS.

- [ ] **Step 6: Commit.** `-m "Assemble the card-provider registry and guard the seam"`

---

### Task 10: the lazy provider pool

**Files:**
- Create: `apps/server/src/card-provider-pool.ts`
- Test: `apps/server/src/card-provider-pool.test.ts`

**Interfaces:**
- Produces:
```ts
export interface CardProviderPool {
  /** Build-or-cache the live provider for `providerId` and this tenant; throws if not connected. */
  get(providerId: string, resolveReader: (t: TenantId, till: TillId) => Promise<string>): Promise<PaymentProvider>;
  /** Drop the cached provider after its credential changes. */
  evict(providerId: string): void;
}
export function createCardProviderPool(deps: {
  providers: readonly CardProviderContribution[];
  db: Database; ring: KeyRing; tenantId: TenantId; nodeId: string;
  environment: DeploymentEnvironment; incidents: IncidentSink;
}): CardProviderPool;
```

- [ ] **Step 1: Write failing tests** (hermetic, PGlite + a seeded `payments.sumup` credential, fake providers list):
  - `get("sumup", rr)` builds once and returns a provider; a second `get` returns the SAME instance (spy the seat's `build` called once).
  - After `evict("sumup")`, `get` rebuilds (build called twice) — proves a saved credential is picked up (negative control: without evict, the stale instance would serve).
  - `get("redsys", rr)` (unknown) throws `payment.provider_unknown`.
  - `get("sumup")` when no credential is sealed throws (build reads the vault and fails) — surfaced as `reader.provider_disconnected` at the call site (Task 12), but the pool itself propagates the build error.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** the pool: a `Map<string, PaymentProvider>`; `get` looks up the `CardProviderContribution` via `cardProviderById`, and on a miss calls `contribution.build({ db, ring, tenantId, nodeId, environment, incidents, resolveReader })` and caches it; `evict` deletes the key.

- [ ] **Step 4: Run** `pnpm --filter @waitron/server test:coverage -- card-provider-pool`. Expected PASS.

- [ ] **Step 5: Commit.** `-m "Add the lazy card-provider pool that rebuilds on credential change"`

---

# Phase C — the server API

### Task 11: `payments-api.ts` — providers, readers, and the device default

**Files:**
- Create: `apps/server/src/payments-api.ts`
- Modify: `apps/server/src/boot.ts` (mount it; construct the pool), `apps/server/src/errors.ts` (or the payments error registry) for the new codes
- Test: `apps/server/src/payments-api.pg.test.ts` (real-PG, `app_user`, two-tenant probes)

**Interfaces:**
- Produces routes (all `payments.manage`-gated via the `gated` helper pattern, `print-api.ts:331-339`; `authorizeManager`/`Permission` from `@waitron/identity`):
  - `GET  /management-api/payments/providers` → `[{ providerId, displayName?, state: "connected"|"not_connected"|"simulator", merchantName?, credentialFields, readerAdd }]`
  - `POST /management-api/payments/providers/:id/connect` body = form payload (may include a chosen `merchantCode`) → `seat.connect(...)` returns `{ merchantName, sealedPayload }`; the route `validatePayload(seat.credentialPurpose, result.sealedPayload)` then `putCredential`, evicts the pool, and returns `{ merchantName }` (NO secret). A `payment.provider_merchant_ambiguous` from the seat is relayed with its `{ merchants }` list so the form can re-submit with a `merchantCode`.
  - `POST /management-api/payments/providers/:id/disconnect` → refuses `payment.provider_in_use` (params `{ activeReaders }`) if any active `card_readers` row uses it; else `deleteCredential` + evict
  - `GET  /management-api/payments/readers` → `[{ id, provider, name, active, deviceCount }]`
  - `POST /management-api/payments/readers` body `{ providerId, name, code?, reference? }` → relays to the seat's `readers.add`, inserts a `card_readers` row, returns `{ id, status }`
  - `GET  /management-api/payments/readers/:id/status` → `{ online, detail? }` (relays to the seat)
  - `POST /management-api/payments/readers/:id/retire` → UPDATE `active=false, retired_at=now()`; relays to the seat's `readers.remove`
  - `GET  /management-api/devices/:id/reader` and `PUT /management-api/devices/:id/reader` body `{ readerId | null }` → read/write `device_card_readers`
- New error codes (both `en`+`es` in dashboard `codes.ts`, Task 15): `reader.not_found`, `reader.provider_disconnected`, `payment.provider_in_use`, `payment.provider_credential_rejected` (from the seat), `payment.provider_merchant_ambiguous` (from the seat), `payment.pairing_expired`, `payment.pairing_refused`. (`reader.provider_mismatch` was dropped — `reader.provider_disconnected` covers it.)

- [ ] **Step 1: Write failing real-PG tests** as `app_user` (rolsuper=f), with two tenants:
  - connect seals and the response has NO field value; a bad key → `payment.provider_credential_rejected`.
  - a reader added under tenant A is invisible to tenant B's `GET readers` (isolation probe — delete the `eq(tenantId)` and watch it fail).
  - `GET readers/:id/status` for tenant B's reader id under tenant A → `reader.not_found` (by-id isolation probe).
  - disconnect with an active reader → `payment.provider_in_use { activeReaders: 1 }`.
  - `PUT devices/:id/reader` with a reader from another tenant → `reader.not_found`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `mountPaymentsApi(app, deps, log)` following `print-api.ts` exactly: a `STATUS` map + `createErrorBoundary`, `requireManagementSession`, the `gated` helper with `PAYMENTS_MANAGE_PERMISSION: Permission = "payments.manage"`, `readJsonBody`/`requireString`/`requireEnum`/`requireUuidParam` for body screening, and **`eq(tenantId)` on every by-id read**. The connect route: `const seat = cardProviderById(CARD_PROVIDERS, id)`, `const { merchantName, sealedPayload } = await seat.connect({ fetch }, payload)`, `validatePayload(seat.credentialPurpose, sealedPayload)`, `putCredential(tx, ring, { tenantId, purpose: seat.credentialPurpose, value: sealedPayload })`, `pool.evict(id)`, return `{ merchantName }`. Relays never name a provider.

- [ ] **Step 4: Mount + pool in boot.** In `boot.ts`, after the vault ring is open and the till cfg resolved, construct `const cardPool = createCardProviderPool({ providers: CARD_PROVIDERS, db, ring, tenantId: till.tenantId, nodeId: till.nodeId, environment: config.environment, incidents: recordIncidentOnce })` and `mountPaymentsApi(app, { db, cfg: till, ring, pool: cardPool, providers: CARD_PROVIDERS }, log)` inside the trading/`!fencedOrMirror` block beside `mountPrintApi`. Import `CARD_PROVIDERS` from `@waitron/composition` (allowlisted in the seam test).

- [ ] **Step 5: Run** `pnpm --filter @waitron/server test:coverage -- payments-api` (real-PG; `TESTCONTAINERS_RYUK_DISABLED=true`). Expected PASS.

- [ ] **Step 6: Commit.** `-m "Add the payments API: connect providers, manage readers, set a device's default"`

---

# Phase D — the pay-path cutover (sequenced late, well-tested)

### Task 12: route a sale to a reader; retire the env card-provider selection

**Files:**
- Modify: `apps/server/src/till-api.ts` (`/api/pay` reader routing; `GET /api/till` per-device payload), `apps/server/src/boot.ts` (`buildCardProvider` → simulator-only; pass the pool + a reader resolver), `apps/server/src/till-config.ts` (remove `cardProvider`/`stripeReaderId`/`sumupReaderId`/`CARD_PROVIDERS`), `apps/till/src/api/client.ts` + `apps/till/src/widgets/tender-pay.ts` + `card-grid.ts` + `till-counter-screen.ts` + `till-app.ts` (the provider string now per-device)
- Test: update `till-config.test.ts`, `boot-card-provider.test.ts`, `till-api.test.ts`; add a real-PG pay-routing test

**Interfaces:**
- Consumes: `CardProviderPool.get` (Task 10), `card_readers`/`device_card_readers` (Tasks 1-2).
- Produces: `/api/pay` resolves the reader (request `readerId` or the device's default), loads the provider from the pool with a `resolveReader` closure returning that reader's `providerRef`, and drives `payWorkingOrderIntegrated`. The env `WAITRON_TILL_CARD_PROVIDER` family is gone; the simulator is still selected by onboarding intent.

- [ ] **Step 1: Write failing tests.**
  - Real-PG: a device with a default SumUp reader, `/api/pay` (fake provider in the pool) captures and stamps `payments.reader_id`; a `/api/pay` naming a different active reader overrides the default; naming another tenant's reader → `reader.not_found`; a device with no default and no `readerId` → `reader.not_found` (or the existing "no provider configured" error, chosen deliberately — pick `reader.not_found` and assert it).
  - `till-config.test.ts`: the card cases are REMOVED; assert `loadTillConfig` no longer reads `WAITRON_TILL_CARD_PROVIDER` (a set value is ignored, not an error) — or delete those cases and add one asserting the field is absent from the returned config.
  - `GET /api/till`: for a device with a default reader, `cardProvider` is that reader's provider string MAPPED to the till's union (see the map below); demo/prepare → `"simulator"`; no default → `"none"`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**
  - `buildCardProvider` collapses to: demo/prepare (and prepare+testProviders=false) → `SimulatorPaymentProvider`; otherwise `undefined` (readers now come from the pool). Keep the simulator branch and its tests.
  - `/api/pay`: resolve `readerId = body.readerId ?? defaultReaderFor(device)`; load `card_readers` row (with `eq(tenantId)`); `pool.get(row.provider, () => Promise.resolve(row.providerRef))`; drive `payWorkingOrderIntegrated` with that provider; stamp `reader_id`. In demo/prepare, keep using `deps.cardProvider` (the simulator) and stamp no reader.
  - **Provider-string mapping (I1).** `card_readers.provider` / the seat `providerId` are `"sumup"` / `"stripe"`, but the till's `CardProvider` union is `"sumup_cloud"` / `"stripe_terminal"` / `"stripe_on_device"` / `"simulator"` / `"none"` (`apps/till/src/api/client.ts:99`). When building `GET /api/till`'s per-device `cardProvider` string, map `"sumup" → "sumup_cloud"` and `"stripe" → "stripe_terminal"`. Put this map in one helper (server-side) so the till's closed union is never handed an unknown value.
  - `GET /api/till`: compute the per-device provider string from the device's default reader (join `device_card_readers` → `card_readers`, apply the map above), falling back to `"simulator"` (intent) or `"none"`. Add an `activeReaders` list to the payload for the picker (Task 17).
  - Remove the three card fields + `CARD_PROVIDERS` from `till-config.ts` and every reference; the till's `CardProvider` string union stays in `apps/till` (still `none|stripe_terminal|stripe_on_device|sumup_cloud|simulator`).
  - **`stripe_on_device` (Tap-to-Pay) is deferred in this slice (I2).** It was reachable only through the env `WAITRON_TILL_CARD_PROVIDER=stripe_on_device` selection this task removes, and no venue uses it (env-only, nothing in production). The till branch stays dormant; nothing selects it after the cutover. Restoring it as a per-device on-device mode (a device flag, not a `card_readers` row, since the paying phone IS the reader) is a follow-up recorded in _Scope → Deferred_. Do NOT try to route it through a reader row.
  - **Seam allowlist (I4):** this task removes `boot.ts`'s direct `@waitron/payments-sumup` / `@waitron/payments-stripe` imports (reader construction moved to the pool; only `SimulatorPaymentProvider` from `@waitron/payments` remains). In the SAME commit, remove `boot.ts` from the Task 9 provider-package allowlist in `scripts/module-seams.test.ts`, and re-grep the remaining allowlist entries (`stripe-account.ts`, `sumup-account.ts`, `webhook.ts`) to confirm each still genuinely imports a provider package — so the seam test stays green across the cutover.
  - Update `.env.example` / `apps/till/README.md` env tables to drop `WAITRON_TILL_CARD_PROVIDER`/`WAITRON_TILL_SUMUP_READER_ID`/`WAITRON_TILL_STRIPE_READER_ID` (base-to-tip receipt sweep, CLAUDE.md §1).

- [ ] **Step 4: Run** the whole workspace-scoped set: `pnpm --filter @waitron/server test:coverage` + `pnpm --filter @waitron/till test:coverage` + `pnpm test -- module-seams`. Expected PASS.

- [ ] **Step 5: Commit.** `-m "Route each card sale to its reader's provider and remove the env card selection"`

---

### Task 13: drop the `devices` card columns and their consumers

**Files:**
- Modify: `packages/db/src/schema/devices.ts` (drop `cardProvider`, `cardReaderId`), new core migration `packages/db/drizzle/0016_drop_device_card_columns.sql`
- Modify: `apps/server/src/device-session.ts` (`DeviceBinding` + projection + mapper), `apps/server/src/device-api.ts` (echo + PATCH), `apps/dashboard/src/screens/devices-screen.ts` + `apps/dashboard/src/api/client.ts` + `apps/dashboard/src/i18n/strings.ts` (remove the editor), the demo/seed/fixture inserts
- Test: update `device-session.test.ts`, `device-api.pg.test.ts`, `devices-screen.test.ts` + `.a11y`, `client.test.ts`

**Interfaces:**
- Consumes: the device default-reader now lives in `device_card_readers` (Task 2) and is edited on the Payments/Devices screen (Task 16), not on these columns.

- [ ] **Step 1: Write the failing test.** A schema test asserting `devices` has no `card_provider`/`card_reader_id` column (query `information_schema.columns`); update `device-session.test.ts` to expect no such fields on `DeviceBinding`.

- [ ] **Step 2: Run, expect FAIL** (columns still present).

- [ ] **Step 3: Drop them.** Remove the two columns from `devices.ts`; `pnpm --filter @waitron/db db:generate --name drop_device_card_columns` (emits `ALTER TABLE "devices" DROP COLUMN ...`, the `0003_drop_device_kind.sql` idiom). Remove the fields from `device-session.ts` (`DeviceBinding` 134-135, projection 159-160, mapper 186-187), the `/api/device/me` echo (`device-api.ts:337-338`), the PATCH hardware handler (body type, `set` type, the two `if (... in body)` blocks, `updated` type, `returning` — `device-api.ts:532-584`), and the now-unused `CARD_PROVIDERS` import there. In the dashboard, remove the `CARD_PROVIDERS` const, `HardwareEdit.cardProvider`/`cardReaderId`, the select + reader input in `#renderHardware`, `#cardProviderName`, the `updated()` reconcile loop, the `patchDeviceHardware` type fields, and the four `devices.card_provider*` i18n keys. Fix every seed/fixture insert that sets `devices.card_provider`: `apps/server/scripts/dev-setup.ts:437`, `apps/server/scripts/demo-seed/seed-floor.ts:48`, `apps/server/src/testing/venue-fixtures.ts:52`, and the demo scripts `apps/server/scripts/{park-retrieve-demo.ts,till-demo.ts,integrated-card-demo.ts}` (grep `cardProvider` across `apps/server` to confirm none is missed — base-to-tip receipt sweep, CLAUDE.md §1).

- [ ] **Step 4: Run** the whole workspace: `pnpm typecheck && pnpm test` (this touches `packages/db` schema — a value many suites assert). Expected PASS.

- [ ] **Step 5: Commit.** `-m "Remove the unused per-device card columns, now replaced by the reader default"`

---

# Phase E — the dashboard UI

### Task 14: the browser provider-panel seam + the SumUp and Stripe panels

**Files:**
- Create: `packages/payments-sumup/src/dashboard/{index.ts,panel.ts,strings.ts,client.ts,sumup-connect-form.ts,sumup-add-reader.ts}` + `"./dashboard"` subpath export in `packages/payments-sumup/package.json`
- Create: `packages/payments-stripe/src/dashboard/{index.ts,panel.ts,strings.ts,client.ts,stripe-connect-form.ts,stripe-add-reader.ts}` + subpath export
- Create: `packages/dashboard-modules/src/card-providers.ts` (the `CARD_PROVIDER_PANELS` registry) + export from its index
- Create: `packages/dashboard-kit/src/card-provider-panel.ts` (the `CardProviderPanel` contract) if the contract belongs in dashboard-kit
- Test: `packages/payments-sumup/src/dashboard/*.test.ts` (browser-mode, real headless Chromium — check machine headroom first, CLAUDE.md §4)

**Interfaces:**
- Produces (browser twin of the server seat):
```ts
// packages/dashboard-kit/src/card-provider-panel.ts
export interface CardProviderPanel {
  providerId: string;
  displayNameKey: string;
  strings: { en: Record<string, string>; es: Record<string, string> };
  /** The connect form; on submit it calls request(...) to POST connect and emits `provider-connected`. */
  renderConnectForm(ctx: { request: DashboardRequest }): TemplateResult;
  /** The add-reader dialog; SumUp shows the pairing countdown, Stripe a reference field. */
  renderAddReader(ctx: { request: DashboardRequest; onAdded: () => void; onClose: () => void }): TemplateResult;
}
export const CARD_PROVIDER_PANELS: readonly CardProviderPanel[]; // in dashboard-modules
```

- [ ] **Step 1: Write failing browser tests** for the SumUp panel's pairing dialog (the critical one). Mirror the printers-screen SCAN machinery — the real precedent is the scan timer (`#scanTimer`/`#scanUntil`/`#scanInFlight`, `#scan`/`#scanTick`/`#endScan`, `printers-screen.ts:305-312, 660-703`) cleared in `disconnectedCallback` (`printers-screen.ts:326-328`) — with fake timers:
  - entering a code + pressing Pair calls `POST readers` then polls `GET readers/:id/status` every 2s; on `paired` it emits `onAdded` and closes.
  - a 5-minute countdown renders and decrements; at expiry it shows `payment.pairing_expired` copy and offers _try again_.
  - `disconnectedCallback` clears the timer (prove by deletion: without the clear, a tick fires after detach).
  Stripe panel test: a reference field + Add calls `POST readers` with `{ reference }` and emits `onAdded`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement the panels.** Each `dashboard/index.ts` mirrors `BOOKINGS_DASHBOARD` (`packages/bookings/src/dashboard/index.ts`): a side-effect `import "./strings.js"` (registers the catalogue), a small `client.ts` built from `ctx.request`, and the `CardProviderPanel` object. The SumUp add-reader element copies the printers-screen scan-timer shape (a poll `setInterval` + a wall-clock `until` + an in-flight guard, cleared in `disconnectedCallback` — the real field names there are `#scanTimer`/`#scanUntil`/`#scanInFlight`/`#endScan`; name the pairing equivalents to taste) plus a 5-minute countdown; the connect form follows the design-system Forms contract (semantic `name`, required markers, `wt-form-error-summary`, secret fields behind `wt-help-tooltip` for the affiliate keys, `wt-form-actions`). Add the `"./dashboard"` subpath export to each package.json (`{".": "./src/index.ts", "./dashboard": "./src/dashboard/index.ts"}`).

- [ ] **Step 3b: Extend the browser seam guard (M5).** In `scripts/module-seams.test.ts`, add `@waitron/payments-sumup` and `@waitron/payments-stripe` to the `APP_FORBIDDEN` list so `apps/dashboard` may not import a provider package directly — the provider panels must be reached only through `@waitron/dashboard-modules`'s `CARD_PROVIDER_PANELS` (the browser twin of the server seam rule). Note the `/dashboard` subpath is what `dashboard-modules` imports; `apps/dashboard` imports neither the subpath nor the root.

- [ ] **Step 4: Build the registry.** `packages/dashboard-modules/src/card-providers.ts`:
```ts
import { SUMUP_PANEL } from "@waitron/payments-sumup/dashboard";
import { STRIPE_PANEL } from "@waitron/payments-stripe/dashboard";
import type { CardProviderPanel } from "@waitron/dashboard-kit";
export const CARD_PROVIDER_PANELS: readonly CardProviderPanel[] = [SUMUP_PANEL, STRIPE_PANEL];
```

- [ ] **Step 5: Run** `pnpm --filter @waitron/payments-sumup test:coverage` + `--filter @waitron/payments-stripe test:coverage` (browser-mode — check `memory_pressure` first). Expected PASS.

- [ ] **Step 6: Commit.** `-m "Add the SumUp and Stripe dashboard panels behind a provider-panel seam"`

---

### Task 15: the generic Payments screen

**Files:**
- Create: `apps/dashboard/src/screens/payments-screen.ts`
- Modify: `apps/dashboard/src/dashboard-app.ts` (CoreScreen, side-effect import, NAV_GROUPS, `#renderScreen`), `apps/dashboard/src/api/client.ts` (the payments client methods), `apps/dashboard/src/i18n/strings.ts` (nav + screen keys, en+es), `apps/dashboard/src/i18n/codes.ts` (the new error codes, en+es)
- Test: `apps/dashboard/src/screens/payments-screen.test.ts` + `.a11y.test.ts`

**Interfaces:**
- Consumes: `CARD_PROVIDER_PANELS` (Task 14), the payments routes (Task 11).
- Produces: `<dashboard-payments-screen>` under Configuration, gated `requiresManager: true`.

- [ ] **Step 1: Write failing tests.**
  - lists providers with state badges (not connected / connected as name / simulator); a demo-mode banner states the simulator is active.
  - hosting: for a not-connected provider, the panel's connect form renders (mounted from `CARD_PROVIDER_PANELS` by matching `providerId`); on `provider-connected` the list reloads.
  - readers render in a `wt-data-table` with columns name/provider/status/default-devices/actions; retire is two-tap-armed and calls `POST retire`.
  - a11y: the table has an `aria-label`; the pairing dialog traps focus; error copy is in a `role="alert"`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement the screen.** A Lit element taking `.api` (or `.request` to build panel contexts). It renders the providers list, finds each provider's `CardProviderPanel` from `CARD_PROVIDER_PANELS` by `providerId`, and mounts its connect form / add-reader dialog. The readers `wt-data-table` follows `staff-list.ts` (columns via `DataTableColumn<Row>`, a `cell`-rendered action button dispatching a composed event; `wt-data-table` has NO built-in row/sort events). Status is loaded lazily per reader via `GET readers/:id/status`. Add client methods to `DashboardApi` copying the `listPrinters`/`createPrinter`/`updatePrinter` shapes:
```ts
listPaymentProviders(): Promise<PaymentProviderRow[]> { return this.#request("/management-api/payments/providers", "GET"); }
connectPaymentProvider(id: string, payload: Record<string, string>): Promise<{ merchantName: string }> { return this.#request(`/management-api/payments/providers/${id}/connect`, "POST", payload); }
disconnectPaymentProvider(id: string): Promise<void> { return this.#request(`/management-api/payments/providers/${id}/disconnect`, "POST"); }
listReaders(): Promise<ReaderRow[]> { return this.#request("/management-api/payments/readers", "GET"); }
addReader(input: AddReaderInput): Promise<{ id: string; status: string }> { return this.#request("/management-api/payments/readers", "POST", input); }
readerStatus(id: string): Promise<{ online: boolean; detail?: string }> { return this.#request(`/management-api/payments/readers/${id}/status`, "GET"); }
retireReader(id: string): Promise<void> { return this.#request(`/management-api/payments/readers/${id}/retire`, "POST"); }
```
(all types are LOCAL copies). Wire the six dashboard-app edits (CoreScreen `| "payments"`, side-effect import, a `{ screen: "payments", labelKey: "nav.payments" }` item in the `configuration` group with `requiresManager: true`, a `case "payments":` in `#renderScreen`). Add `nav.payments` + `payments.*` keys to en AND es in `strings.ts`, and the new error codes (both columns) to `codes.ts`.

- [ ] **Step 4: Run** `pnpm --filter @waitron/dashboard test:coverage` (browser-mode). Expected PASS.

- [ ] **Step 5: Commit.** `-m "Add the Payments dashboard screen: providers and readers"`

---

### Task 16: the device default-reader control

**Files:**
- Modify: `apps/dashboard/src/screens/devices-screen.ts` (a default-reader dropdown replacing the removed card fields), `apps/dashboard/src/api/client.ts` (`getDeviceReader`/`setDeviceReader`), `apps/dashboard/src/i18n/strings.ts`
- Test: `devices-screen.test.ts`

**Interfaces:**
- Consumes: `GET/PUT /management-api/devices/:id/reader` (Task 11), `GET readers` (Task 11).

- [ ] **Step 1: Write the failing test.** The Devices screen shows a "default reader" dropdown per device listing active readers by name+provider; empty = cash/manual only; selecting one calls `PUT devices/:id/reader { readerId }`; clearing calls it with `{ readerId: null }`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Add the dropdown to `#renderHardware` (the card select/input were removed in Task 13); load the reader list once; write via `setDeviceReader`. Add the two client methods and the i18n keys (en+es).

- [ ] **Step 4: Run** `pnpm --filter @waitron/dashboard test:coverage`. Expected PASS.

- [ ] **Step 5: Commit.** `-m "Let a device pick its default card reader on the Devices screen"`

---

### Task 17: the payment-time reader picker (reused by slice 2)

**Files:**
- Create: `apps/till/src/widgets/reader-picker.ts`
- Modify: `apps/till/src/widgets/tender-pay.ts` (show the default reader name on the card button + a "use a different reader" control), `apps/till/src/api/client.ts` (the boot payload's `activeReaders` list), `apps/till/src/widgets/card-grid.ts` / `till-counter-screen.ts` (thread the readers)
- Test: `apps/till/src/widgets/reader-picker.test.ts`, extend `tender-pay.test.ts`

**Interfaces:**
- Consumes: `GET /api/till`'s `activeReaders` (added in Task 12).
- Produces: `<till-reader-picker>` — a list of active readers with status; emits `reader-chosen` with a `readerId`. `/api/pay` sends the chosen `readerId` (Task 12 already reads it).

- [ ] **Step 1: Write the failing test.** The card button shows the default reader's name; a "use a different reader" control opens the picker; choosing a reader sends `readerId` on the next `/api/pay`; a reader shown offline is still selectable but marked.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `<till-reader-picker>` and wire it into `tender-pay.ts`. Keep it self-contained so slice 2 can mount the same element for the NFC/QR handheld link. `/api/pay`'s reader routing (Task 12) already accepts `body.readerId`.

- [ ] **Step 4: Run** `pnpm --filter @waitron/till test:coverage` (browser-mode). Expected PASS.

- [ ] **Step 5: Commit.** `-m "Add a payment-time reader picker on the till"`

---

## Final verification (before the PR)

- [ ] Run the full gate: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
- [ ] Run the whole workspace once more (this branch touches `packages/composition`, `packages/module`-adjacent seams, `packages/identity`, `packages/db` schema, and `packages/payments`): `pnpm -r test:coverage` scaled to measured headroom (`memory_pressure | grep free` first).
- [ ] Confirm the seam test's provider-package allowlist has a stated reason per entry and no stale entries.
- [ ] Confirm no secret appears in any new `AppError` params (grep the new codes) and that connect responses carry only a merchant name.
- [ ] Update `docs/backlog.md` in the same change: mark the payment-provider config UI slice 1 landed; keep the Redsys/bank-terminal item parked with its receipts; note slice 2 (handheld link) as next.
- [ ] `/finish-branch`.

---

## Self-review notes (author)

- **Spec coverage:** §1 data model → Tasks 1-3; §2 provider accounts + first credential write → Tasks 7/8/11; §3 provider-owned flow + seat + seam → Tasks 5/7/8/9/14; §4 routing + picker → Tasks 12/17; §5 till boot + practice mode → Task 12; §6 errors/security/testing → Tasks 11/14/15 + the isolation probes throughout; scope drops of the env path and device columns → Tasks 12/13. Redsys stays parked (no task), as specified.
- **Type consistency:** `CardProviderContribution` (Task 5) is the one seat type reused by Tasks 7, 8, 9, 10; `CardProviderPanel` (Task 14) is its browser twin used by Tasks 14, 15. `providerRef` is the single opaque-reference name across schema (Task 1), seat (Task 5), and API (Task 11). `CardProviderBuildDeps` (Task 5) already carries `resolveReader` + `incidents`, which the pool (Task 10) supplies and Tasks 7/8's `build` consume.
- **Review-fold (2026-09-11):** a fresh-context review found and this revision fixed — the connect→seal flow (connect now returns `sealedPayload`, C1), the `"sumup"→"sumup_cloud"` / `"stripe"→"stripe_terminal"` till-string map (I1), the `stripe_on_device` deferral (I2, see below), the standalone-registry refinement (I3), the seam-allowlist cutover ordering (I4), and the Task 5 imports (I5). `stripe_on_device` Tap-to-Pay is deferred: it was env-only and unused, and restoring it as a per-device on-device mode is a follow-up (add it to `docs/backlog.md` at land alongside slice 2).

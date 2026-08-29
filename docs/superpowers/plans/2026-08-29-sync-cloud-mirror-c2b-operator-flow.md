# Cloud-mirror C2b — operator flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a non-technical owner stand up a cloud mirror by choosing "mirror" in the setup wizard and entering the primary's address + an admin login — the mirror fetches a bundle from the primary, adopts the existing venue (explicit ids, no fiscal re-registration), stores its connection config in the DB, and restarts into C2a's read-only mirror mode.

**Architecture:** The **primary** (trading mode) exposes `POST /management-api/mirror-bundle`, which mints a per-peer sync token and returns the venue's parent rows + connection details. The **mirror** (setup mode) exposes `POST /setup-api/adopt`, which fetches that bundle server-side, inserts the parent rows verbatim via a new `adoptVenue` (NO `registerSif` — that would fork the unrepairable fiscal chain), seals the token in its own vault, writes a `mirror_config` singleton + `deployment.mode='mirror'`, persists `trading.env`, and restarts. No C2a runtime code (the read-only gate, ambient viewer, pull/apply) changes — only where the mirror's connection config comes from.

**Tech Stack:** TypeScript, Drizzle ORM, Postgres (real-PG via Testcontainers for role/RLS/vault/apply tests; PGlite where roles don't matter), Hono, Lit (setup wizard), Vitest.

**Spec:** [docs/superpowers/specs/2026-08-29-sync-cloud-mirror-c2b-operator-flow-design.md](../specs/2026-08-29-sync-cloud-mirror-c2b-operator-flow-design.md) — read it alongside this plan; every task argues from it.

## Global Constraints

- **No `registerSif` on the mirror, ever.** It mints a fresh `numero_instalacion` and nulls `cadenas.ultima_huella` → a second unrecoverable hash chain (spec §5, CLAUDE.md §5). `adoptVenue` inserts identity rows only; `registro_sif`/`cadenas` arrive via sync.
- **No backfill / back-compat code** — nothing is deployed (CLAUDE.md §3). Schema changes are custom migrations.
- **Never build SQL by string concatenation.** Drizzle parameterises `sql` interpolations; utility statements (`GRANT`, `CREATE ROLE`) take no placeholders — none are built dynamically here.
- **Error codes name the DOMAIN concept, never the package**; `node.*`/`mirror.*` join existing families; codes are never renamed once shipped (CLAUDE.md §3). Every file that throws a code does `import "./errors.js"`.
- **Real Postgres, not PGlite,** for anything touching the role split, RLS-as-`app_user`, the apply-under-FORCE-RLS path, or vault seal/unseal under a real key. `TESTCONTAINERS_RYUK_DISABLED=true` locally; run `pnpm reap` if a run is interrupted (CLAUDE.md §4).
- **Coverage thresholds:** 98/98/98/95 for `packages/*` and `apps/server`; `apps/setup` carries 95/95/90/88. CI shards run `test:coverage`, not `test` — verify with `pnpm --filter <pkg> test:coverage`, and run cross-cutting-guard packages **unfiltered** (CLAUDE.md §2/§4).
- **Object-privilege GRANTs are verified by reading the ACL back**, both directions (`has_table_privilege`/`aclexplode`), not by the command tag (CLAUDE.md §3).
- **The token crosses in plaintext-over-TLS and is re-sealed under the mirror's OWN vault key** — cross-box unseal is impossible (verified: [cipher.ts:53-66](../../../packages/credentials/src/cipher.ts)). Never log the token.
- **v1 = single-tenant DR mirror.** No multi-tenant reader, no fiscal-lane sync, no promotion, no untrusted-path trust bootstrap (spec §9/§11).
- **`git commit -s`** every commit (DCO).

---

### Task 1: `sync.mirror_token` vault purpose

**Files:**
- Modify: `packages/credentials/src/purposes.ts:15-30` (the `PURPOSES` map)
- Test: `packages/credentials/src/purposes.test.ts` (or the existing purposes/store test — locate with `ls packages/credentials/src/*purposes*test* packages/credentials/src/store.test.ts`)

**Interfaces:**
- Produces: a new `Purpose` member `"sync.mirror_token"` with payload field list `["token"]`. `putCredential`/`getCredential`/`validatePayload` gain no new signature — they key on `PURPOSES` ([store.ts:130](../../../packages/credentials/src/store.ts) calls `validatePayload`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { PURPOSES, isPurpose, validatePayload } from "./purposes.js";

describe("sync.mirror_token purpose", () => {
  it("is a known purpose whose payload field is `token`", () => {
    expect(isPurpose("sync.mirror_token")).toBe(true);
    expect(PURPOSES["sync.mirror_token"]).toEqual(["token"]);
  });
  it("validatePayload accepts a token and rejects a payload missing it", () => {
    expect(() => validatePayload("sync.mirror_token", { token: "abc" })).not.toThrow();
    expect(() => validatePayload("sync.mirror_token", {})).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/credentials test purposes`
Expected: FAIL — `isPurpose("sync.mirror_token")` is `false`.

- [ ] **Step 3: Add the purpose**

In `packages/credentials/src/purposes.ts`, inside the `PURPOSES` object (beside `"fiscal.aeat": ["pfxBase64", "passphrase", "certKind"]` at line 29), add:

```ts
  /** The per-peer sync bearer token a cloud mirror presents when it pulls (sync cloud-mirror C2b).
   * Sealed under the mirror's OWN box key at adopt; a mirror-local operational secret, one field. */
  "sync.mirror_token": ["token"],
```

- [ ] **Step 4: Run the test — PASS**

Run: `pnpm --filter @waitron/credentials test purposes`
Expected: PASS.

- [ ] **Step 5: Full package gate + commit**

Run: `pnpm --filter @waitron/credentials test:coverage` (unfiltered — loads the reachability/guard suites).

```bash
git add packages/credentials/src/purposes.ts packages/credentials/src/purposes.test.ts
git commit -s -m "feat(credentials): add sync.mirror_token vault purpose (C2b)"
```

---

### Task 2: `mirror_config` operational singleton — table, migration, grants, accessors

**Files:**
- Create: `packages/db/src/schema/mirror-config.ts` (the Drizzle table; kept OUT of the schema barrel, like `deployment.ts`)
- Create: `packages/db/drizzle/00XX_mirror_config.sql` (custom migration — find the next number with `ls packages/db/drizzle/ | tail`)
- Create: `packages/db/src/mirror-config.ts` (accessors, exported from the package barrel)
- Modify: `packages/db/src/index.ts` (export the accessors + types, the way `deployment.ts` accessors are exported — grep `readDeploymentMode` in `index.ts` for the pattern)
- Test: `packages/db/src/mirror-config.test.ts` (PGlite for the accessor round-trip) and `packages/db/src/mirror-config.rls.test.ts` (real-PG for the grant read-back)

**Interfaces:**
- Produces:
  - `MirrorConnection = { relayUrl: string; boxHostname: string; boxCaPem: string }`
  - `readMirrorConfig(db: Database): Promise<MirrorConnection | null>` — `null` when the row/table is absent (an unstamped or primary DB).
  - `writeMirrorConfig(db: Database, cfg: MirrorConnection): Promise<void>` — owner-role UPSERT of the singleton (`id = 1`).
- Consumes: the `deployment.ts` accessor pattern for the `to_regclass` guard.

- [ ] **Step 1: Write the migration**

Model it on `packages/db/drizzle/0010_deployment_stamp.sql` (singleton stamp + `GRANT SELECT … app_user`). Create `packages/db/drizzle/00XX_mirror_config.sql`:

```sql
-- Custom migration (drizzle-kit models no grants). The mirror's connection config — an operational
-- whole-database singleton like `deployment`/`sync_cursor`: NO tenant_id, NO RLS, out of the fiscal
-- inmutabilidad FORCE-RLS scan by construction. Written owner-role at adopt (C2b); read app_user at
-- mirror boot. Non-secret only — the per-peer sync token lives in the credentials vault, never here.
CREATE TABLE "mirror_config" (
  "id" integer PRIMARY KEY NOT NULL DEFAULT 1,
  "relay_url" text NOT NULL,
  "box_hostname" text NOT NULL,
  "box_ca_pem" text NOT NULL,
  "adopted_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mirror_config_singleton_ck" CHECK ("id" = 1)
);

GRANT SELECT ON "mirror_config" TO app_user;
```

- [ ] **Step 2: Write the schema file**

`packages/db/src/schema/mirror-config.ts` — model on `packages/db/src/schema/deployment.ts` (singleton, out of the barrel):

```ts
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** The cloud mirror's connection config (sync cloud-mirror C2b). A whole-database operational
 * singleton — NO tenant_id, NO RLS — like `deployment`. Non-secret parts only (the sync token is in
 * the vault). Deliberately kept out of the schema barrel; accessors are exported from the package
 * barrel (`../mirror-config.ts`). */
export const mirrorConfig = pgTable("mirror_config", {
  id: integer("id").primaryKey().notNull().default(1),
  relayUrl: text("relay_url").notNull(),
  boxHostname: text("box_hostname").notNull(),
  boxCaPem: text("box_ca_pem").notNull(),
  adoptedAt: timestamp("adopted_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Write the accessors**

`packages/db/src/mirror-config.ts` — copy the `to_regclass` guard shape from `packages/db/src/deployment.ts:35-101` (`readDeploymentMode`/`setDeploymentMode`):

```ts
import { sql } from "drizzle-orm";
import type { Database } from "./types.js"; // match deployment.ts's Database import

export interface MirrorConnection {
  relayUrl: string;
  boxHostname: string;
  boxCaPem: string;
}

/** Read the mirror connection config, or null when the table/row is absent (a primary/unstamped DB). */
export async function readMirrorConfig(db: Database): Promise<MirrorConnection | null> {
  const present = await db.execute(sql`select to_regclass('public.mirror_config') as t`);
  if (present.rows[0]?.t == null) return null;
  const rows = await db.execute(
    sql`select relay_url, box_hostname, box_ca_pem from mirror_config where id = 1`,
  );
  const r = rows.rows[0];
  if (r == null) return null;
  return { relayUrl: r.relay_url as string, boxHostname: r.box_hostname as string, boxCaPem: r.box_ca_pem as string };
}

/** Owner-role UPSERT of the singleton. */
export async function writeMirrorConfig(db: Database, cfg: MirrorConnection): Promise<void> {
  await db.execute(sql`
    insert into mirror_config (id, relay_url, box_hostname, box_ca_pem)
    values (1, ${cfg.relayUrl}, ${cfg.boxHostname}, ${cfg.boxCaPem})
    on conflict (id) do update set
      relay_url = excluded.relay_url,
      box_hostname = excluded.box_hostname,
      box_ca_pem = excluded.box_ca_pem,
      adopted_at = now()
  `);
}
```

Match `deployment.ts`'s exact `db.execute`/`rows` access style — read it first and mirror it (the `Database` type and the `.rows` shape must line up).

- [ ] **Step 4: Export from the barrel**

In `packages/db/src/index.ts`, beside the `deployment.ts` accessor exports, add:

```ts
export { readMirrorConfig, writeMirrorConfig } from "./mirror-config.js";
export type { MirrorConnection } from "./mirror-config.js";
```

- [ ] **Step 5: Accessor round-trip test (PGlite)**

`packages/db/src/mirror-config.test.ts` — use `usePgliteDb` + `runMigrations` (copy the setup from an existing `packages/db/src/*.test.ts` that migrates CORE):

```ts
import { describe, it, expect } from "vitest";
import { usePgliteDb } from "./testing/lifecycle.js";
import { readMirrorConfig, writeMirrorConfig } from "./mirror-config.js";

describe("mirror_config accessors", () => {
  const db = usePgliteDb(/* CORE migrations — match the sibling's args */);
  it("reads null before any write", async () => {
    expect(await readMirrorConfig(db())).toBeNull();
  });
  it("upserts the singleton and reads it back", async () => {
    await writeMirrorConfig(db(), { relayUrl: "https://relay.test:9000/", boxHostname: "waitron.local", boxCaPem: "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n" });
    expect(await readMirrorConfig(db())).toEqual({ relayUrl: "https://relay.test:9000/", boxHostname: "waitron.local", boxCaPem: "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n" });
  });
  it("is a singleton — a second write updates, never inserts a second row", async () => {
    await writeMirrorConfig(db(), { relayUrl: "https://relay.test:9000/", boxHostname: "a", boxCaPem: "a" });
    await writeMirrorConfig(db(), { relayUrl: "https://relay2.test:9000/", boxHostname: "b", boxCaPem: "b" });
    const r = await db().execute(sql`select count(*)::int as n from mirror_config`);
    expect(r.rows[0].n).toBe(1);
  });
});
```

- [ ] **Step 6: Grant read-back test (real-PG)**

`packages/db/src/mirror-config.rls.test.ts` — copy the real-PG harness + role-URL helper from an existing `packages/db/src/*.rls.test.ts`. Assert `app_user` holds `SELECT` and **not** INSERT/UPDATE:

```ts
// app_user MUST hold SELECT and MUST NOT hold INSERT/UPDATE on mirror_config (owner-only write).
const sel = await admin.execute(sql`select has_table_privilege('app_user','mirror_config','SELECT') as p`);
expect(sel.rows[0].p).toBe(true);
const ins = await admin.execute(sql`select has_table_privilege('app_user','mirror_config','INSERT') as p`);
expect(ins.rows[0].p).toBe(false);
const upd = await admin.execute(sql`select has_table_privilege('app_user','mirror_config','UPDATE') as p`);
expect(upd.rows[0].p).toBe(false);
```

- [ ] **Step 7: Run, verify, commit**

Run: `pnpm --filter @waitron/db test mirror-config` then `pnpm --filter @waitron/db test:coverage` (unfiltered — `@waitron/db` hosts cross-cutting guards).

```bash
git add packages/db/src/schema/mirror-config.ts packages/db/drizzle/00XX_mirror_config.sql packages/db/src/mirror-config.ts packages/db/src/index.ts packages/db/src/mirror-config.test.ts packages/db/src/mirror-config.rls.test.ts
git commit -s -m "feat(db): mirror_config operational singleton + accessors + app_user SELECT grant (C2b)"
```

---

### Task 3: `mirror.create` permission

**Files:**
- Modify: `packages/identity/src/permissions.ts` (the `PERMISSIONS` array — line ~16-68 — and confirm it lands in `admin` only)
- Test: `packages/identity/src/permissions.test.ts`

**Interfaces:**
- Produces: `"mirror.create"` as a `Permission`, held by `admin` (via `ALL`) and **not** by supervisor/manager/cashier — so `roleHasPermission("admin","mirror.create")` is `true` and `roleHasPermission("supervisor","mirror.create")` is `false`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { PERMISSIONS, roleHasPermission } from "./permissions.js";

describe("mirror.create permission", () => {
  it("exists and is admin-only", () => {
    expect(PERMISSIONS).toContain("mirror.create");
    expect(roleHasPermission("admin", "mirror.create")).toBe(true);
    expect(roleHasPermission("supervisor", "mirror.create")).toBe(false);
    expect(roleHasPermission("manager", "mirror.create")).toBe(false);
  });
});
```

(Confirm the exact role value names — `supervisor`/`manager`/`cashier` — against `permissions.ts` before writing; use whatever the file's `PersonRoleValue` union actually contains.)

- [ ] **Step 2: Run — FAIL** (`PERMISSIONS` lacks the member).

Run: `pnpm --filter @waitron/identity test permissions`

- [ ] **Step 3: Add the permission**

In `packages/identity/src/permissions.ts`, add `"mirror.create"` to the `PERMISSIONS` array (near `"cash.drawer"` at line 68), with a comment:

```ts
  // Minting a cloud-mirror bundle (sync cloud-mirror C2b) — hands out a data-access sync token, so
  // admin-only. Not in SUPERVISOR/MANAGER; reaches `admin` via ALL.
  "mirror.create",
```

Do **not** add it to the `SUPERVISOR`/`MANAGER` sets. Confirm `admin: ALL` (line ~104) spreads the full `PERMISSIONS` set so the new member is included automatically; if `ALL` is a hand-listed set rather than derived, add `"mirror.create"` to it explicitly.

- [ ] **Step 4: Run — PASS**, then full gate.

Run: `pnpm --filter @waitron/identity test:coverage`

- [ ] **Step 5: Commit**

```bash
git add packages/identity/src/permissions.ts packages/identity/src/permissions.test.ts
git commit -s -m "feat(identity): add admin-only mirror.create permission (C2b)"
```

---

### Task 4: `adoptVenue` + `AdoptResult` (packages/provisioning)

**Files:**
- Create: `packages/provisioning/src/venue-adopt.ts`
- Modify: `packages/provisioning/src/index.ts` (export `adoptVenue`, `AdoptVenueRows`, `AdoptResult`)
- Test: `packages/provisioning/src/venue-adopt.test.ts` (PGlite — inserts + idempotency + result shape) and `packages/provisioning/src/venue-adopt.no-sif.test.ts` (PGlite — proven-by-deletion that no `registro_sif`/`cadenas` row is written)

**Interfaces:**
- Consumes: `withTenant` (the `applyVenue` transaction shape, [venue-apply.ts:58](../../../packages/provisioning/src/venue-apply.ts)); the Drizzle tables `tenants`/`locations`/`nodes`/`tills`/`invoiceSeries` from `@waitron/db`.
- Produces:

```ts
export interface VenueRow { [column: string]: unknown } // a raw row object (all columns), inserted verbatim
export interface AdoptVenueRows {
  tenant: VenueRow;
  locations: VenueRow[];
  nodes: VenueRow[];
  tills: VenueRow[];
  invoiceSeries: VenueRow[];
}
export interface AdoptResult {
  tenantId: string;
  locationId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
}
export function adoptVenue(rows: AdoptVenueRows, designated: AdoptResult, deps: { db: Database }): Promise<AdoptResult>;
```

`designated` = the five ids the bundle names for `trading.env` (spec §3 Part 1b); `adoptVenue` returns it unchanged after asserting each id is present among the inserted rows.

- [ ] **Step 1: Write the failing test (insert + idempotency + result)**

`packages/provisioning/src/venue-adopt.test.ts`. Use `usePgliteDb` with CORE+IDENTITY+FISCAL migrations (copy the args from `packages/provisioning/src/venue-apply.test.ts:19-21`). Build a small `AdoptVenueRows` fixture matching the C2a seed columns ([boot.mirror.rls.test.ts:88-99](../../../apps/server/src/boot.mirror.rls.test.ts) — `tenants(id,country,tax_id,legal_name)`, `locations(id,tenant_id,name,invoice_locales,operation_description)`, `nodes(id,tenant_id,location_id,name)`, `tills(id,tenant_id,location_id,name)`, `invoice_series(id,tenant_id,node_id,code)`), plus any other NOT NULL columns the current schema requires (read the schema; the fixture must satisfy every NOT NULL without a default):

```ts
it("inserts every parent row verbatim and returns the designated ids", async () => {
  const rows = makeRows(); // tenant + 1 location + 1 node + 1 till + 2 invoice_series, explicit uuids
  const designated = { tenantId: rows.tenant.id, locationId: rows.locations[0].id, tillId: rows.tills[0].id, nodeId: rows.nodes[0].id, seriesId: rows.invoiceSeries[0].id };
  const result = await adoptVenue(rows, designated, { db: db() });
  expect(result).toEqual(designated);
  // parents exist with the exact ids
  const t = await db().execute(sql`select id from tenants where id = ${designated.tenantId}`);
  expect(t.rows).toHaveLength(1);
  const s = await db().execute(sql`select count(*)::int as n from invoice_series where tenant_id = ${designated.tenantId}`);
  expect(s.rows[0].n).toBe(2);
});

it("is idempotent — a second adopt inserts no duplicates", async () => {
  const { rows, designated } = fixture();
  await adoptVenue(rows, designated, { db: db() });
  await adoptVenue(rows, designated, { db: db() }); // ON CONFLICT DO NOTHING
  const n = await db().execute(sql`select count(*)::int as n from locations where tenant_id = ${designated.tenantId}`);
  expect(n.rows[0].n).toBe(1);
});
```

- [ ] **Step 2: Run — FAIL** (`adoptVenue` not defined).

Run: `pnpm --filter @waitron/provisioning test venue-adopt`

- [ ] **Step 3: Implement `adoptVenue`**

`packages/provisioning/src/venue-adopt.ts` — one `withTenant(deps.db, designated.tenantId, tx => …)` transaction (the `applyVenue` shape), inserting in FK order with `onConflictDoNothing`:

```ts
import { withTenant } from "@waitron/db";
import { tenants, locations, nodes, tills, invoiceSeries } from "@waitron/db"; // confirm exact exports

export async function adoptVenue(rows: AdoptVenueRows, designated: AdoptResult, deps: { db: Database }): Promise<AdoptResult> {
  await withTenant(deps.db, designated.tenantId, async (tx) => {
    await tx.insert(tenants).values(rows.tenant as typeof tenants.$inferInsert).onConflictDoNothing({ target: tenants.id });
    for (const r of rows.locations) await tx.insert(locations).values(r as typeof locations.$inferInsert).onConflictDoNothing({ target: locations.id });
    for (const r of rows.nodes) await tx.insert(nodes).values(r as typeof nodes.$inferInsert).onConflictDoNothing({ target: nodes.id });
    for (const r of rows.tills) await tx.insert(tills).values(r as typeof tills.$inferInsert).onConflictDoNothing({ target: tills.id });
    for (const r of rows.invoiceSeries) await tx.insert(invoiceSeries).values(r as typeof invoiceSeries.$inferInsert).onConflictDoNothing({ target: invoiceSeries.id });
  });
  // Assert the designated ids are actually present (fail loudly on a malformed bundle).
  await assertPresent(deps.db, designated); // SELECT 1 for each; throw provisioning.* if any missing
  return designated;
}
```

Notes for the implementer: the raw `VenueRow` objects must be inserted with their column NAMES matching the Drizzle insert type (`$inferInsert`) — the bundle assembler (Task 5) produces them from `select` so the keys already match Drizzle's camelCase mapping; if the assembler emits snake_case DB column names instead, map them there, not here. `adoptVenue` NEVER touches `registro_sif`/`cadenas`/`contadores_instalacion`.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Write the proven-by-deletion no-SIF test**

`packages/provisioning/src/venue-adopt.no-sif.test.ts`:

```ts
it("writes NO registro_sif / cadenas / contadores_instalacion row", async () => {
  const { rows, designated } = fixture();
  await adoptVenue(rows, designated, { db: db() });
  for (const table of ["registro_sif", "cadenas", "contadores_instalacion"]) {
    const r = await db().execute(sql.raw(`select count(*)::int as n from ${table}`));
    expect(r.rows[0].n, `${table} must be empty after adopt`).toBe(0);
  }
});
```

To PROVE this test bites (CLAUDE.md §4): temporarily add a `registerSifForNode(tx, …)` call inside `adoptVenue`, run the test, watch it FAIL (`registro_sif` count = 1), then remove it and watch it PASS. Record that you did this in the commit body.

- [ ] **Step 6: Export + full gate + commit**

Add exports to `packages/provisioning/src/index.ts`. Run `pnpm --filter @waitron/provisioning test:coverage` (unfiltered).

```bash
git add packages/provisioning/src/venue-adopt.ts packages/provisioning/src/index.ts packages/provisioning/src/venue-adopt.test.ts packages/provisioning/src/venue-adopt.no-sif.test.ts
git commit -s -m "feat(provisioning): adoptVenue — insert parent rows with explicit ids, never registerSif (C2b)

Proven-by-deletion: temporarily calling registerSifForNode makes the no-sif test fail; removed."
```

---

### Task 5: `MirrorBundle` type + `assembleMirrorBundle` (primary side)

**Files:**
- Create: `apps/server/src/mirror-bundle.ts` (the `MirrorBundle` type + `assembleMirrorBundle`)
- Test: `apps/server/src/mirror-bundle.rls.test.ts` (real-PG — reads real rows as `app_user`, mints a token via `enrolPeer`)

**Interfaces:**
- Consumes: `enrolPeer` ([peers.ts:29](../../../packages/sync/src/peers.ts), `(db, { subscriberId, name }) => { peerId, token }`); `readDeploymentEnvironment` ([deployment.ts:35](../../../packages/db/src/deployment.ts)); `caCertPath` ([box-secrets.ts:27](../../../apps/server/src/box-secrets.ts)); `withTenant`.
- Produces:

```ts
export interface MirrorBundle {
  rows: AdoptVenueRows;                 // from @waitron/provisioning — tenant + location/node/till/series arrays
  designated: AdoptResult;              // the five WAITRON_TILL_*_ID ids
  environment: "production" | "preproduction";
  boxHostname: string;
  boxCaPem: string;
  relayUrl: string;
  syncToken: string;                    // plaintext, once
}
export interface AssembleDeps {
  appDb: Database;            // app_user pool — reads venue rows under withTenant
  retentionDb: Database;      // sync_retention pool — enrolPeer mints the token
  ring: KeyRing;              // not used here; kept out — token is NOT sealed on the primary
  stateDir: string;           // → caCertPath
  relayUrl: string;           // from the primary's loadTunnelConfig
  boxHostname: string;        // the box leaf SAN
  designated: AdoptResult;    // config.till.* (the five ids)
}
export function assembleMirrorBundle(deps: AssembleDeps): Promise<MirrorBundle>;
```

- [ ] **Step 1: Write the failing test (real-PG)**

`apps/server/src/mirror-bundle.rls.test.ts` — boot a real-PG venue via `applyVenue`/`planVenue` (copy the setup from `apps/server/src/management-api.rls.test.ts:46`), enrol the `sync_retention`/`app_user` roles (the harness the mirror-e2e uses). Assert:

```ts
it("assembles a bundle carrying the venue rows, connection details, and a fresh token", async () => {
  const bundle = await assembleMirrorBundle({ appDb, retentionDb, ring, stateDir, relayUrl: "https://relay.test:9000/", boxHostname: "waitron.local", designated });
  expect(bundle.rows.tenant.id).toBe(designated.tenantId);
  expect(bundle.rows.invoiceSeries.length).toBeGreaterThanOrEqual(1);
  expect(bundle.designated).toEqual(designated);
  expect(bundle.environment).toBe("preproduction");
  expect(bundle.boxCaPem).toContain("BEGIN CERTIFICATE");
  expect(bundle.relayUrl).toBe("https://relay.test:9000/");
  // the token authenticates as a real peer (round-trips through authenticatePeer)
  const auth = await authenticatePeer(retentionDb, bundle.syncToken);
  expect(auth.subscriberId).toBe(designated.nodeId);
});
```

Write `caCertPath(stateDir)`'s file first (the test's `stateDir` must contain `tls/ca.crt`) or point `stateDir` at a fixture dir with a PEM.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement `assembleMirrorBundle`**

```ts
export async function assembleMirrorBundle(deps: AssembleDeps): Promise<MirrorBundle> {
  const rows = await withTenant(deps.appDb, deps.designated.tenantId, async (tx) => ({
    tenant: (await tx.select().from(tenants).where(eq(tenants.id, deps.designated.tenantId)))[0],
    locations: await tx.select().from(locations),        // RLS scopes to the tenant
    nodes: await tx.select().from(nodes),
    tills: await tx.select().from(tills),
    invoiceSeries: await tx.select().from(invoiceSeries),
  }));
  const environment = await readDeploymentEnvironment(deps.appDb);
  if (environment == null) throw new AppError("mirror.not_provisioned", {});
  const boxCaPem = await readFile(caCertPath(deps.stateDir), "utf8");
  const { token } = await enrolPeer(deps.retentionDb, { subscriberId: deps.designated.nodeId, name: "cloud mirror" });
  return { rows: rows as AdoptVenueRows, designated: deps.designated, environment, boxHostname: deps.boxHostname, boxCaPem, relayUrl: deps.relayUrl, syncToken: token };
}
```

`import "./errors.js"` at the top (Task 6 registers `mirror.*`). Confirm `app_user` holds SELECT on all five parent tables during Step 1 — if `nodes` SELECT is missing for `app_user`, read that one on the owner pool and note why in a comment (do NOT widen a grant to make a test pass — CLAUDE.md §3).

- [ ] **Step 4: Run — PASS. Commit.**

```bash
git add apps/server/src/mirror-bundle.ts apps/server/src/mirror-bundle.rls.test.ts
git commit -s -m "feat(server): assembleMirrorBundle — venue rows + connection + minted sync token (C2b)"
```

---

### Task 6: `mirror.*` error codes

**Files:**
- Modify: `apps/server/src/errors.ts` (register the new codes beside the `node.*` family, ~line 103)
- Test: `apps/server/src/errors.test.ts` (or the reachability test — follow the existing per-code test shape in that file)

**Interfaces:**
- Produces error codes (params `Record<string, never>` — no row content, the `sync.*`/`tunnel.*` discipline):
  - `mirror.not_provisioned` — the primary has no stamped environment (assemble refused).
  - `mirror.no_relay` — the primary has no tunnel/relay configured (bundle endpoint refused).
  - `mirror.bundle_fetch_failed` — the mirror could not fetch or parse the bundle from the primary.
  - HTTP mappings: `mirror.not_provisioned`/`mirror.no_relay` → 409/400 (primary-side precondition); `mirror.bundle_fetch_failed` → 502 (mirror-side upstream failure).

- [ ] **Step 1: Write the failing test** — one assertion per code that constructing `new AppError("mirror.no_relay", {})` is registered and the barrel loads (copy the existing per-code test shape in `apps/server/src/errors.test.ts`).

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Register the codes** in `apps/server/src/errors.ts`, beside `node.not_found`/`node.read_only` (~line 103), each with `params: Record<string, never>` and a doc line naming the domain concept. Grep the `mirror.` prefix first to confirm none exist (codes are never renamed — CLAUDE.md §3).

- [ ] **Step 4: Run — PASS. Commit.**

```bash
git add apps/server/src/errors.ts apps/server/src/errors.test.ts
git commit -s -m "feat(server): mirror.{not_provisioned,no_relay,bundle_fetch_failed} error codes (C2b)"
```

---

### Task 7: `POST /management-api/mirror-bundle` (primary endpoint)

**Files:**
- Create: `apps/server/src/mirror-bundle-api.ts` (`mountMirrorBundleApi(app, deps)` — one route)
- Modify: `apps/server/src/boot.ts` (mount it in the trading + **primary** branch only, wiring `appDb`, the `sync_retention` connection, `stateDir`, relay coords from `loadTunnelConfig`, and `config.till` as `designated`)
- Test: `apps/server/src/mirror-bundle-api.rls.test.ts` (real-PG — auth gate + bundle shape + no-relay refusal)

**Interfaces:**
- Consumes: `assembleMirrorBundle` (Task 5); `authorizeManager`/`requireManagementSession` (the management-auth pattern, [report-api.ts:102-119](../../../apps/server/src/report-api.ts)); the admin credential login (`loginWithPin`/password — read the management login the dashboard uses and reuse it).
- Produces: `POST /management-api/mirror-bundle` → 200 `MirrorBundle` (JSON) for an authorised `mirror.create` admin; refuses others.

**Auth shape:** the request body carries the admin credential (the mirror calls this server-side, §5). The handler authenticates it (the management login path), then `authorizeManager(tx, { managementSessionId, permission: "mirror.create" })` — OR, if a fresh login is cleaner than a session, authenticate the credential directly and check `roleHasPermission(role, "mirror.create")`. Pick whichever matches the existing management login; pin the exact call by reading `apps/server/src/management-api.ts`'s login route first.

- [ ] **Step 1: Write the failing test**

```ts
it("returns a bundle for an authorised admin", async () => {
  const res = await app.request("/management-api/mirror-bundle", { method: "POST", body: JSON.stringify({ credential: adminPin }), headers: { "content-type": "application/json" } });
  expect(res.status).toBe(200);
  const bundle = await res.json();
  expect(bundle.rows.tenant.id).toBe(designated.tenantId);
  expect(bundle.syncToken).toMatch(/\./); // selector.secret
});
it("refuses a non-admin credential", async () => {
  const res = await app.request("/management-api/mirror-bundle", { method: "POST", body: JSON.stringify({ credential: cashierPin }), headers: { "content-type": "application/json" } });
  expect(res.status).toBe(403);
});
it("refuses when no relay is configured", async () => {
  // boot the endpoint with relayUrl undefined → mirror.no_relay
  const res = await appNoRelay.request("/management-api/mirror-bundle", { method: "POST", body: JSON.stringify({ credential: adminPin }), headers: { "content-type": "application/json" } });
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe("mirror.no_relay");
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement the route** in `apps/server/src/mirror-bundle-api.ts` (use `readJsonBody` — the shared malformed-body helper #145 — not a bare `c.req.json()`). Refuse `mirror.no_relay` when the wired relay coords are absent, **before** minting a token. `import "./errors.js"`.

- [ ] **Step 4: Wire it in boot** — in the trading+primary branch of `boot.ts` (where `readDeploymentMode(db) === "primary"`), mount `mountMirrorBundleApi` with `appDb = db`, the `sync_retention` connection the retention sweep already opens, `stateDir = config.stateDir`, `relayUrl` from `loadTunnelConfig(env)?.relayHost:relayPort` (undefined if no tunnel), `boxHostname` from the box hostname source, and `designated = config.till` (the five ids). Do NOT mount it on a mirror (a mirror emits no bundle).

- [ ] **Step 5: Run — PASS.** Run `pnpm --filter @waitron/server test mirror-bundle-api`.

- [ ] **Step 6: Boot-wiring assertion** — extend `apps/server/src/boot.test.ts` (or `boot.mirror.rls.test.ts`) so a **primary** boot mounts the route and a **mirror** boot does NOT (proven by a control). Commit.

```bash
git add apps/server/src/mirror-bundle-api.ts apps/server/src/boot.ts apps/server/src/mirror-bundle-api.rls.test.ts apps/server/src/boot.test.ts
git commit -s -m "feat(server): POST /management-api/mirror-bundle — admin-gated bundle emission (C2b)"
```

---

### Task 8: mirror-side adopt orchestrator

**Files:**
- Create: `apps/server/src/adopt.ts` (`adoptFromPrimary(deps, req)` — the mirror-side orchestrator; the `provision.ts` analogue)
- Create: `apps/server/src/mirror-token.ts` (`sealMirrorToken`/`readMirrorToken` — the `aeat-credential.ts` analogue for purpose `sync.mirror_token`)
- Test: `apps/server/src/adopt.rls.test.ts` (real-PG — full adopt with a stubbed bundle-fetcher)

**Interfaces:**
- Consumes: `adoptVenue` (Task 4); `stampDeployment`/`setDeploymentMode` ([deployment.ts:56,95](../../../packages/db/src/deployment.ts)); `writeMirrorConfig` (Task 2); `putCredential`/`getCredential` via a `sealMirrorToken` wrapper (the `sealAeatCredential` shape, [aeat-credential.ts:81-101](../../../apps/server/src/aeat-credential.ts)); `persistTrading` (the setup-api dep, writes `trading.env`).
- Produces:

```ts
export interface AdoptRequest { primaryUrl: string; credential: string }
export interface AdoptDeps {
  ownerDb: Database;                 // migrationsDatabaseUrl — inserts tenants + writes deployment/mirror_config
  ring: KeyRing;                     // the mirror's own vault key (its secrets.env)
  fetchBundle: (primaryUrl: string, credential: string) => Promise<MirrorBundle>; // HTTP call, stubbable
  persistTrading: (args: PersistTradingArgs) => Promise<void>;
  databaseUrl: string;
  migrationsDatabaseUrl: string;
}
export function adoptFromPrimary(deps: AdoptDeps, req: AdoptRequest): Promise<{ tenantId: string }>;
```

- [ ] **Step 1: Write `sealMirrorToken`/`readMirrorToken`** first (tiny wrappers). Model on `apps/server/src/aeat-credential.ts:81-101`:

```ts
export function sealMirrorToken(ownerDb: Database, ring: KeyRing, tenantId: string, token: string): Promise<void> {
  return withTenant(ownerDb, tenantId, (tx) => putCredential(tx, ring, { tenantId, purpose: "sync.mirror_token", value: { token } }));
}
export function readMirrorToken(appDb: Database, ring: KeyRing, tenantId: string): Promise<string> {
  return withTenant(appDb, tenantId, async (tx) => {
    const c = await getCredential(tx, ring, { tenantId, purpose: "sync.mirror_token" });
    return c.token as string;
  });
}
```

Test the round-trip in real-PG (seal owner, read app_user) + the cross-box negative (seal under ring A, read under ring B → `credentials.decrypt_failed`). This is the design's load-bearing fact.

- [ ] **Step 2: Write the failing orchestrator test**

`apps/server/src/adopt.rls.test.ts` — a real-PG mirror DB (fresh), a **stub** `fetchBundle` returning a hand-built `MirrorBundle` (parent rows + a token enrolled on a separate source DB, or any string for the seal test), a stub `persistTrading` capturing its args:

```ts
it("adopts: inserts parents, stamps env + mirror mode, seals the token, writes mirror_config, persists trading.env", async () => {
  const persisted: PersistTradingArgs[] = [];
  await adoptFromPrimary({ ownerDb, ring, fetchBundle: async () => bundle, persistTrading: async (a) => { persisted.push(a); }, databaseUrl, migrationsDatabaseUrl }, { primaryUrl: "https://primary.test/", credential: "1234" });
  expect(await readDeploymentEnvironment(ownerDb)).toBe(bundle.environment);
  expect(await readDeploymentMode(ownerDb)).toBe("mirror");
  expect((await readMirrorConfig(ownerDb))!.relayUrl).toBe(bundle.relayUrl);
  expect(await readMirrorToken(appDb, ring, bundle.designated.tenantId)).toBe(bundle.syncToken);
  expect(persisted[0]).toMatchObject({ tenantId: bundle.designated.tenantId, nodeId: bundle.designated.nodeId, seriesId: bundle.designated.seriesId, environment: bundle.environment });
  // the parent rows are present (adoptVenue ran)
  const t = await ownerDb.execute(sql`select id from tenants where id = ${bundle.designated.tenantId}`);
  expect(t.rows).toHaveLength(1);
});
```

- [ ] **Step 3: Implement the orchestrator** — the exact order is load-bearing (`stampDeployment` before `setDeploymentMode`, which throws `deployment.not_stamped` on an unstamped DB):

```ts
export async function adoptFromPrimary(deps: AdoptDeps, req: AdoptRequest): Promise<{ tenantId: string }> {
  const bundle = await deps.fetchBundle(req.primaryUrl, req.credential);   // throws mirror.bundle_fetch_failed on failure
  const { designated, rows } = bundle;
  await stampDeployment(deps.ownerDb, bundle.environment);                 // env immutable, must match primary
  await adoptVenue(rows, designated, { db: deps.ownerDb });                // inserts parents, NO registerSif
  await setDeploymentMode(deps.ownerDb, "mirror");
  await sealMirrorToken(deps.ownerDb, deps.ring, designated.tenantId, bundle.syncToken);
  await writeMirrorConfig(deps.ownerDb, { relayUrl: bundle.relayUrl, boxHostname: bundle.boxHostname, boxCaPem: bundle.boxCaPem });
  await deps.persistTrading({ tenantId: designated.tenantId, locationId: designated.locationId, tillId: designated.tillId, nodeId: designated.nodeId, seriesId: designated.seriesId, databaseUrl: deps.databaseUrl, migrationsDatabaseUrl: deps.migrationsDatabaseUrl, environment: bundle.environment });
  return { tenantId: designated.tenantId };
}
```

`import "./errors.js"`.

- [ ] **Step 4: Run — PASS. Commit.**

```bash
git add apps/server/src/adopt.ts apps/server/src/mirror-token.ts apps/server/src/adopt.rls.test.ts apps/server/src/mirror-token.rls.test.ts
git commit -s -m "feat(server): adoptFromPrimary orchestrator + mirror-token vault wrappers (C2b)"
```

---

### Task 9: `POST /setup-api/adopt` + SetupDeps wiring + the real bundle-fetcher

**Files:**
- Modify: `apps/server/src/setup-api.ts` (add `adopt` to `SetupDeps`, mount `POST /setup-api/adopt`, reuse the one-shot latch + deps gate — [setup-api.ts:247,252,276-279,358](../../../apps/server/src/setup-api.ts))
- Create: `apps/server/src/mirror-bundle-fetch.ts` (`fetchMirrorBundle(primaryUrl, credential)` — the HTTP call, plus the untrusted-path constraint comment, spec §9)
- Modify: `apps/server/src/boot.ts` (wire `adopt` into `SetupDeps` on the setup boot path)
- Test: `apps/server/src/setup-api.test.ts` (stubbed `adopt` dep — latch, deps gate, restart) and `apps/server/src/mirror-bundle-fetch.test.ts` (fetch parses a 200, maps a non-200/parse error to `mirror.bundle_fetch_failed`)

**Interfaces:**
- Consumes: `adoptFromPrimary` (Task 8); the existing setup-api latch/gate/`requestRestart`.
- Produces: `POST /setup-api/adopt` → 200 `{ adopted: true, tenantId, restarting: true }`, then `setTimeout(requestRestart, 0)`; `fetchMirrorBundle` (the default `adopt` `fetchBundle`).

- [ ] **Step 1: Write the failing setup-api test** — copy the `provision` handler tests' shape in `setup-api.test.ts` (stubbed deps, `mkdtempSync` state dir): the latch returns `setup.already_provisioning` on a concurrent second call; a missing `adopt` dep → `setup.not_ready` 503; a success returns `{ adopted: true }` and calls `requestRestart` once.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — add `adopt?: (req: AdoptRequest) => Promise<{ tenantId: string }>` to `SetupDeps`, mount the route reusing the exact latch/gate/restart the `provision` route uses (read `setup-api.ts:252-358` and mirror it; use `readJsonBody`). The body is `{ primaryUrl, credential }`.

- [ ] **Step 4: Implement `fetchMirrorBundle`** — a `POST ${primaryUrl}/management-api/mirror-bundle` with `{ credential }`, parse the JSON `MirrorBundle`, map any non-200 or parse failure to `new AppError("mirror.bundle_fetch_failed", {})`. Add the spec-§9 constraint comment at the fetch site verbatim:

```ts
// TRUST BOOTSTRAP (spec §9): v1 sends the admin credential over the primary's first-contact TLS.
// This is safe ONLY on a trusted path (the stand-in is localhost). A mirror reaching a primary over an
// UNTRUSTED network MUST NOT reuse this as-is: it must first verify the primary (a real public-CA cert,
// or a fingerprint-before-credential step) BEFORE this credential is transmitted. Do not lift this to a
// reachable-over-the-internet flow without that.
```

- [ ] **Step 5: Wire `adopt` in boot** — on the setup boot path, set `adopt: (req) => adoptFromPrimary({ ownerDb, ring, fetchBundle: fetchMirrorBundle, persistTrading, databaseUrl: config.databaseUrl, migrationsDatabaseUrl: config.migrationsDatabaseUrl }, req)`. Reuse the same `persistTrading`/`ownerDb`/`ring` the `provision` dep already wires (read the setup boot block).

- [ ] **Step 6: Run — PASS. Commit.**

```bash
git add apps/server/src/setup-api.ts apps/server/src/mirror-bundle-fetch.ts apps/server/src/boot.ts apps/server/src/setup-api.test.ts apps/server/src/mirror-bundle-fetch.test.ts
git commit -s -m "feat(server): POST /setup-api/adopt + fetchMirrorBundle + boot wiring (C2b)"
```

---

### Task 10: mirror boot reads connection config from DB + vault (retire the env read)

**Files:**
- Modify: `apps/server/src/boot.ts` (the mirror branch — replace `loadMirrorConfig(env)` + the mirror use of `WAITRON_SYNC_PEERS` with `readMirrorConfig(db)` + `readMirrorToken`)
- Modify: `apps/server/src/config.ts` (retire/replace `loadMirrorConfig` and its "C2b moves it to DB-stored" note at line ~422 — grep `WAITRON_MIRROR_BOX_*` / `loadMirrorConfig` and update every site)
- Test: `apps/server/src/boot.mirror.rls.test.ts` (extend — a mirror booted after adopt pulls using DB config; a mirror with no `mirror_config` fails closed)

**Interfaces:**
- Consumes: `readMirrorConfig` (Task 2), `readMirrorToken` (Task 8), the C2a `tunnelHttpClient({ ca, servername })` + `runSyncPull({ peers, http, … })` composition ([boot.ts mirror branch](../../../apps/server/src/boot.ts)).
- Produces: the mirror pull worker configured from DB+vault. **No** change to `runSyncPull`, the read-only gate, the ambient viewer, or the apply path.

- [ ] **Step 1: Write the failing test** — extend `boot.mirror.rls.test.ts` so the mirror's connection is read from `mirror_config` + the sealed `sync.mirror_token` (written by `adoptFromPrimary` or seeded directly) rather than from `WAITRON_MIRROR_BOX_*` env. Assert (a) the mirror pulls + applies through the tunnel using the DB config, and (b) a mirror booted with `deployment.mode='mirror'` but **no** `mirror_config` row throws `server.config_invalid` (fail-closed).

- [ ] **Step 2: Run — FAIL** (boot still reads env).

- [ ] **Step 3: Implement** — in the mirror branch of `boot.ts`, replace the `loadMirrorConfig(env)` read with:

```ts
const mirror = await readMirrorConfig(db);
if (mirror == null) throw new AppError("server.config_invalid", { mirror_requires_mirror_config: true });
const syncToken = await readMirrorToken(db, ring, config.till.tenantId);
const syncHttp = tunnelHttpClient({ ca: mirror.boxCaPem, servername: mirror.boxHostname });
// peers: one entry — the relay, with the vault token
const peers = [{ nodeId: config.till.nodeId, url: mirror.relayUrl, token: syncToken }];
// … the rest of the C2a runSyncPull({ localDb: db, subscriberId: config.till.nodeId, tenantId: config.till.tenantId, http: syncHttp, peers, … }) is UNCHANGED
```

Keep the C2a `Promise.all([runLane("ordered"), runLane("fast")])` shape byte-identical. Retire the mirror path's dependence on `WAITRON_SYNC_PEERS`/`WAITRON_MIRROR_BOX_*`; update the `config.ts:422` note to point at `mirror_config` + the `sync.mirror_token` purpose (CLAUDE.md §3 — editing a file is not auditing it; grep those env names before claiming the mirror path no longer reads them).

- [ ] **Step 4: Run — PASS.** Prove-by-deletion the fail-closed guard: remove the `if (mirror == null) throw` and watch a no-config mirror boot proceed to a confusing later error; restore → clean `server.config_invalid`.

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/boot.ts apps/server/src/config.ts apps/server/src/boot.mirror.rls.test.ts
git commit -s -m "feat(server): mirror boot reads connection from mirror_config + vault, not env (C2b)"
```

---

### Task 11: Headline end-to-end — adopt → pull → read-only, proven by deletion

**Files:**
- Create: `apps/server/src/adopt-e2e.rls.test.ts` (real-PG: a primary + relay stand-in + a fresh mirror driven through `/setup-api/adopt`)
- Test target only (no product code — if a gap surfaces, fix it in the owning task).

**Interfaces:**
- Consumes: everything above + C2a's `boot.mirror.rls.test.ts` / `mirror-e2e.rls.test.ts` harness (the `createRelayStandin` + `runTunnelClient` + `startServer` setup — copy it).

- [ ] **Step 1: Write the e2e**

Structure (copy the primary+relay+mirror scaffolding from `apps/server/src/mirror-e2e.rls.test.ts`):

```ts
it("a fresh mirror adopts a bundle from a booted primary, then pulls + serves read-only", async () => {
  // 1. Boot a trading PRIMARY (real-PG, provisioned via applyVenue, some seeded sales in sync_log),
  //    mounting /management-api/mirror-bundle, with a relay stand-in + runTunnelClient in front.
  // 2. Boot the MIRROR in SETUP mode against a second fresh real-PG DB, with adopt wired to a
  //    fetchBundle that calls the primary's /management-api/mirror-bundle directly (stand-in = direct URL).
  // 3. POST /setup-api/adopt { primaryUrl, credential: adminPin }.
  const res = await mirrorSetup.request("/setup-api/adopt", { method: "POST", body: JSON.stringify({ primaryUrl, credential: adminPin }), headers: { "content-type": "application/json" } });
  expect(res.status).toBe(200);
  // 4. Assert adopt outcomes on the mirror DB:
  expect(await readDeploymentMode(mirrorOwnerDb)).toBe("mirror");
  const parents = await mirrorOwnerDb.execute(sql`select id from tenants where id = ${designated.tenantId}`);
  expect(parents.rows).toHaveLength(1);
  const sif = await mirrorOwnerDb.execute(sql`select count(*)::int as n from registro_sif`);
  expect(sif.rows[0].n).toBe(0); // NO second chain
  // 5. Reboot the mirror into MIRROR mode; it pulls through the tunnel using DB config.
  //    A GET dashboard read returns the pulled sales with NO login (ambient viewer):
  const read = await mirrorTrading.request("/report-api/...", { method: "GET" });
  expect(read.status).toBe(200);
  // 6. A POST mutation is refused read_only:
  const write = await mirrorTrading.request("/api/...", { method: "POST", ... });
  expect(write.status).toBe(403);
  expect((await write.json()).code).toBe("node.read_only");
});
```

- [ ] **Step 2: Run — PASS** (`TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test adopt-e2e`).

- [ ] **Step 3: Proven-by-deletion controls** (each: break, watch fail, restore, watch pass — record in the commit):
  1. remove `setDeploymentMode("mirror")` in `adopt.ts` → the adopted node boots primary (the `POST` succeeds); restore → 403.
  2. (covered by Task 4's no-sif test, re-assert here) the `registro_sif` count stays 0.
  3. feed a mismatched `designated.locationId` → a pulled row's read returns empty / FK unresolved; restore → resolves.

- [ ] **Step 4: Commit.**

```bash
git add apps/server/src/adopt-e2e.rls.test.ts
git commit -s -m "test(server): C2b end-to-end — adopt, pull-through-tunnel, read-only serve, proven by deletion"
```

---

### Task 12: Wizard — role screen (primary | mirror)

**Files:**
- Create: `apps/setup/src/screens/role-screen.ts` + `role-screen.test.ts` + `role-screen.a11y.test.ts` (copy the structure of `apps/setup/src/screens/mode-screen.ts` and its tests)
- Modify: `apps/setup/src/setup-app.ts` (add `"role"` to the `Screen` union, make it the first screen, route primary → existing `mode` flow, mirror → the connect screen from Task 13)
- Modify: `apps/setup/src/events.ts` (a typed dispatcher for the role choice)

**Interfaces:**
- Produces: a `role` screen emitting `role: "primary" | "mirror"`; on `primary` the shell shows `mode`; on `mirror` the shell shows `connect` (Task 13).

- [ ] **Step 1: Write the failing screen test** — copy `mode-screen.test.ts`; assert the role screen renders two choices and dispatches a typed role event on select (primary advances to `mode`, mirror advances to `connect`). Include the a11y test (single `role="alert"` region convention, backlog #149 (j)).

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement `role-screen.ts`** as a Lit element mirroring `mode-screen.ts`. Add the `dispatchSetupRole(el, role)` helper to `events.ts` (typed on `"primary" | "mirror"`, the `events.ts` typed-dispatcher pattern (o), backlog #151). In `setup-app.ts`: add `"role"` to `Screen`, seed `screen = "role"`, and in the shell's advance handler route `primary → "mode"`, `mirror → "connect"`.

- [ ] **Step 4: Run — PASS.** Update `setup-app.test.ts` for the new first screen (the primary path still reaches `mode`).

- [ ] **Step 5: Commit.**

```bash
git add apps/setup/src/screens/role-screen.ts apps/setup/src/screens/role-screen.test.ts apps/setup/src/screens/role-screen.a11y.test.ts apps/setup/src/setup-app.ts apps/setup/src/events.ts apps/setup/src/setup-app.test.ts
git commit -s -m "feat(setup): wizard role screen — primary | mirror (C2b)"
```

---

### Task 13: Wizard — connect-to-primary screen + `SetupApi.adopt` + shell routing

**Files:**
- Create: `apps/setup/src/screens/connect-screen.ts` + `connect-screen.test.ts` + `connect-screen.a11y.test.ts`
- Modify: `apps/setup/src/api/client.ts` (add `adopt(body)` + local `AdoptBody`/response types — the file deliberately keeps local copies, [client.ts:6-17](../../../apps/setup/src/api/client.ts))
- Modify: `apps/setup/src/setup-app.ts` (the mirror path: `connect → provisioning → done`; `#onAdoptRequested` calls `api.adopt`; error routing via `#mapProvisionError`'s shape)
- Modify: `apps/setup/src/events.ts` (a typed `dispatchAdoptRequested`)

**Interfaces:**
- Consumes: `POST /setup-api/adopt` (Task 9).
- Produces: `SetupApi.adopt({ primaryUrl, credential }) → { adopted: true; tenantId; restarting: true }`; the mirror wizard path reaching `done` (reload into the read-only dashboard).

- [ ] **Step 1: Write the failing screen + client tests** — copy `venue-screen.test.ts` + `api/client.test.ts` shapes. The connect screen has two fields (primary URL + admin credential), validates non-empty, and dispatches `adopt-requested`; `SetupApi.adopt` POSTs the body and surfaces the `{ code, params }` error envelope (the `#request` pattern, [client.ts:169](../../../apps/setup/src/api/client.ts)).

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — `connect-screen.ts` (Lit, two `ha`/`wt`-style fields per the repo's existing form primitives — match `venue-screen.ts`), `dispatchAdoptRequested` in `events.ts`, `SetupApi.adopt` in `client.ts` with local `AdoptBody = { primaryUrl: string; credential: string }`. In `setup-app.ts`: `#onAdoptRequested` → `api.adopt(assembleAdoptBody(this.draft))` → `provisioning` → `done`; map `mirror.bundle_fetch_failed`/`setup.*` back to the connect screen with a retry (the `#mapProvisionError` precedent).

- [ ] **Step 4: Run — PASS.** Full setup gate: `pnpm --filter @waitron/setup test:coverage` (95/95/90/88).

- [ ] **Step 5: Commit.**

```bash
git add apps/setup/src/screens/connect-screen.ts apps/setup/src/screens/connect-screen.test.ts apps/setup/src/screens/connect-screen.a11y.test.ts apps/setup/src/api/client.ts apps/setup/src/setup-app.ts apps/setup/src/events.ts
git commit -s -m "feat(setup): connect-to-primary screen + SetupApi.adopt + mirror wizard path (C2b)"
```

---

### Task 14: Docs, comments, backlog — retire what this change made stale

**Files:**
- Modify: `apps/server/src/config.ts` (the `loadMirrorConfig` "C2b moves it to DB-stored" note — discharge it, Task 10 already touched this; confirm it points at `mirror_config` + `sync.mirror_token`)
- Modify: `apps/server/src/boot.ts` (mirror-branch + management-branch comments)
- Modify: `docs/backlog.md` (move the C2b thread from "next" to landed — at land, per `/land-branch`)
- Modify: the `sync-cloud-mirror-peer-identity` memory (record C2b — at land)

- [ ] **Step 1: Grep for stale claims** — `grep -rn "WAITRON_MIRROR_BOX_\|loadMirrorConfig\|C2b moves it" apps/server/src` — every hit is either updated or gone. Confirm no comment still says the mirror reads its connection from env.
- [ ] **Step 2: Update the boot/config comments** to describe the DB+vault read (only if Tasks 9/10 left any stale).
- [ ] **Step 3: Backlog + memory** are updated in the `/land-branch` step, not here — leave a note in the PR description listing them.
- [ ] **Step 4: Commit** any comment fixes.

```bash
git add apps/server/src/config.ts apps/server/src/boot.ts
git commit -s -m "docs(server): retire the env-mirror-config comments now the mirror reads DB (C2b)"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- §3 bundle (rows + connection + token) → Tasks 5 (assemble), 3-Part-1 rows via Task 4.
- §4 primary bundle endpoint → Tasks 6 (codes), 7 (route + boot mount, primary-only).
- §5 adoptVenue (explicit ids, no registerSif/seed-admin) → Task 4; env+mode stamp → Task 8.
- §6 DB config (mirror_config + vault token) → Tasks 1 (purpose), 2 (table), 8 (seal).
- §7 mirror boot reads DB → Task 10.
- §8 wizard (role + connect) → Tasks 12, 13.
- §9 trust bootstrap deferred, constraint recorded → Task 9 Step 4 (the verbatim comment).
- §10 grants (mirror_config SELECT app_user; mirror.create) → Tasks 2, 3.
- §12 testing (real-PG, proven-by-deletion, unfiltered) → every task's gate + Task 11 e2e.
- §13 security review → run as the finish-branch review phase (below).

**Placeholder scan:** no "TBD"/"add error handling"/"similar to Task N" — each task carries concrete code or a named sibling with `file:line`. Two deliberate late-bindings (the next migration number `00XX`; the exact management-login call shape) are flagged with the exact command to resolve them, not left vague.

**Type consistency:** `AdoptVenueRows`/`AdoptResult` defined in Task 4 are consumed unchanged in Tasks 5/8/11; `MirrorBundle` defined in Task 5 is consumed in Tasks 8/9/11; `MirrorConnection` (Task 2) is consumed in Tasks 8/10; `sync.mirror_token` purpose (Task 1) is consumed in Task 8's seal/read. `readMirrorConfig`/`writeMirrorConfig`/`readMirrorToken`/`sealMirrorToken`/`adoptFromPrimary`/`assembleMirrorBundle` names are used identically across tasks.

## Finish

After Task 14, run the full gate (`pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, then `test:coverage` for each touched package), then the **finish-branch** flow — simplify, the two-stage review **including the security review §13**, rebase, PR, CI + Copilot. **This slice touches provisioning + the fiscal-adjacent adopt path, so it is owner-gated: do NOT land it unattended.**

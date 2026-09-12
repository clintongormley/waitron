# Device join-and-accept — implementation plan

> **2026-09-12:** this document refers to `.github/instructions/waitron.instructions.md`, which has
> been deleted. Its rules moved to `docs/developers/conventions-ui.md`, `conventions-data.md` and
> `testing-guide.md` — sweep those instead. The original is still readable with
> `git show f5941462:.github/instructions/waitron.instructions.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the device pairing code with a venue-wide pairing window plus a two-digit numeric match the admin picks out of three, carrying the shared `join_requests` mechanism that the print agent slice will later adopt.

**Architecture:** One `join_requests` table (`local`, a `kind` of `device | print_agent`) holds pending joins for both surfaces; an in-memory `PairingMode` holder on the primary gates every knock; the mechanism routes (list, challenge, deny) are shared and take their permission from the row's kind, while accept is per-surface because it is the only step where the surfaces differ in what an approved request becomes. The device's enrolment collapses to one screen carrying a name, and the profile and binding move into the admin's accept dialog — which also moves that write behind a `device.manage` session.

**Tech Stack:** TypeScript, Hono, drizzle-orm + PostgreSQL 18, Lit (dashboard + till), Vitest (node + real-Postgres via `useTemplateDb`, and browser-mode Chromium for the two front ends).

**Spec:** [`docs/superpowers/specs/2026-09-08-device-join-and-accept-design.md`](../specs/2026-09-08-device-join-and-accept-design.md)

## Global Constraints

- **The device slice drops `device_pairing_codes` only.** `print_agent_pairing_codes` stays until the agent slice adopts the mechanism (spec §4) — the agent enrol route reading it ships today.
- **Verification numbers are two digits, `"00"`–`"99"`, stored as `text`.** Never a Crockford string.
- **The pending list route must never return a verification number** (spec §1.2 rule 1). Only `…/challenge` returns numbers, three of them, shuffled, without saying which is real.
- **No decoy may equal any other pending request's real number, in either kind, in the tenant** (spec §1.2 rule 3).
- **A wrong choice DENIES the request** — it is deleted, not retried (spec §1.2).
- **The pending cap is ten per `(tenant, kind)`**; the join TTL is fifteen minutes; the pairing window is fifteen minutes and extendable.
- **Pairing mode lives in memory on the primary**, never in the database; it fails closed on restart and on promotion (spec §1.1).
- **Every by-id management route carries its own `eq(table.tenantId, cfg.tenantId)`** — one tenant per database is not the query's isolation boundary (CLAUDE.md §3).
- **Multi-table writes share one `withTenant` transaction** (CLAUDE.md §3). Accept inserts the device row (auto-creating a register for a `till` form factor) and deletes the request in one.
- **Every file that throws an error code carries `import "./errors.js";`** (CLAUDE.md §3); codes name the domain concept, never the throwing package.
- **The rate limiter and the window are checked before the body is parsed and before any DB work**, so a flood on an unauthenticated route draws no connection from the pool.
- **Per-task gate:** `pnpm --filter <pkg> lint && pnpm --filter <pkg> typecheck && pnpm format:check && pnpm --filter <pkg> test:coverage`, plus the direct dependents of anything whose contract changed. Reserve a full `pnpm test` for Task 12.
- **Every commit is `git commit -s`.**

---

## File map

| File | Responsibility |
| --- | --- |
| `packages/sync-enrolment/src/migration-tables.ts` (new) | `tablesCreatedBy` — scan migration SQL in order, add on `CREATE TABLE`, remove on `DROP TABLE` |
| `packages/sync-enrolment/src/migration-tables.test.ts` (new) | its unit tests, including create→drop→create |
| `scripts/classification-complete.test.ts` | use the shared scanner instead of its local `CREATE_TABLE` regex |
| `packages/db/src/classification.test.ts` | same, and read the directory in sorted order |
| `packages/db/src/schema/join-requests.ts` (new) | the `join_request_kind` enum and the `join_requests` table |
| `packages/db/src/schema/devices.ts` | `devicePairingCodes` deleted |
| `packages/db/src/classification.ts` | `join_requests` classified `local`; `device_pairing_codes` line removed |
| `packages/db/drizzle/0008_join_requests.sql` + `0009_join_requests_grants_sql.sql` (new) | the generated DDL and its hand-written grants twin |
| `packages/fiscal-verifactu/src/privileges.expected.ts` | `join_requests: "SID"`; `device_pairing_codes` row removed |
| `apps/server/src/pairing-mode.ts` (new) | the in-memory window holder and its refused counter |
| `apps/server/src/join-requests.ts` (new) | every store verb: create, list, challenge, accept, deny, resolve |
| `apps/server/src/device.ts` | pairing-code verbs deleted; `enrolDevice` becomes `acceptDeviceJoinRequest`'s body |
| `apps/server/src/device-api.ts` | `join` + `join/status`; enrol routes and `device-codes` deleted |
| `apps/server/src/join-api.ts` (new) | the shared mechanism routes and the pairing-mode routes |
| `apps/server/src/dev-pairing.ts` | deleted |
| `apps/server/src/boot.ts` | build one `PairingMode`, pass it to both mounts, mount `join-api` |
| `apps/dashboard/src/screens/devices-screen.ts` | pairing toggle + countdown, pending list, numeric-match accept dialog |
| `apps/till/src/screens/till-enrol-screen.ts` | one step (name), then the waiting view with the number |
| `apps/server/scripts/dev-setup.ts` | no pairing code; devMode auto-accepts |

---

### Task 1: Teach the classification guards that a table can be dropped

This is the repository's first dropped table, and both guards derive "the tables that exist" from
`CREATE TABLE` text with nothing subtracting from that set (spec §4.1). Task 2 cannot land until this
does: dropping `device_pairing_codes` would leave both guards demanding a classification row for a
table that no longer exists, while `packages/fiscal-verifactu`'s `privileges.test.ts` reads the live
database and demands the opposite.

**Files:**

- Create: `packages/sync-enrolment/src/migration-tables.ts`
- Create: `packages/sync-enrolment/src/migration-tables.test.ts`
- Modify: `packages/sync-enrolment/src/index.ts` (export the new function)
- Modify: `scripts/classification-complete.test.ts:29-30` (the `CREATE_TABLE` regex), `:35-42`
  (`stripSql`), `:70-73` (the file read), `:80-91` (`createdTablesByModule`)
- Modify: `packages/db/src/classification.test.ts:8-17` (`tablesInDrizzle`) and `:32`
  (`const created = new Set(tablesInDrizzle());`)

**Interfaces:**

- Produces: `tablesCreatedBy(files: readonly string[]): Set<string>` — the SQL texts of one migration
  set, **already in filename order**, returning the lowercased table names that survive. Both guards
  consume it.

- [ ] **Step 1: Write the failing test**

Create `packages/sync-enrolment/src/migration-tables.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tablesCreatedBy } from "./migration-tables.js";

describe("tablesCreatedBy", () => {
  it("collects created tables, quoted or bare, schema-qualified or not", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "public"."devices" (id uuid);',
        "CREATE TABLE IF NOT EXISTS tills (id uuid);",
      ]),
    ).toEqual(new Set(["devices", "tills"]));
  });

  it("removes a table a later migration drops", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "device_pairing_codes" (id uuid);',
        'DROP TABLE "device_pairing_codes";',
      ]),
    ).toEqual(new Set());
  });

  it("honours order: create, drop, create again leaves the table present", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "t" (id uuid);',
        'DROP TABLE "t";',
        'CREATE TABLE "t" (id uuid, extra text);',
      ]),
    ).toEqual(new Set(["t"]));
  });

  it("accepts DROP TABLE IF EXISTS and a schema qualifier", () => {
    expect(
      tablesCreatedBy(['CREATE TABLE "t" (id uuid);', 'DROP TABLE IF EXISTS "public"."t";']),
    ).toEqual(new Set());
  });

  it("ignores CREATE TABLE and DROP TABLE inside comments and string literals", () => {
    expect(
      tablesCreatedBy([
        'CREATE TABLE "kept" (id uuid);',
        "-- CREATE TABLE commented_out (id uuid);",
        "/* DROP TABLE kept; */",
        "SELECT 'DROP TABLE kept';",
      ]),
    ).toEqual(new Set(["kept"]));
  });

  it("does not treat DROP TABLE of an uncreated table as an error", () => {
    expect(tablesCreatedBy(['DROP TABLE "never_created";'])).toEqual(new Set());
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/sync-enrolment test -- migration-tables`
Expected: FAIL — `Cannot find module './migration-tables.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/sync-enrolment/src/migration-tables.ts`:

```ts
/**
 * The set of tables a migration SET leaves in existence, read as TEXT (never executed).
 *
 * Both classification guards — `scripts/classification-complete.test.ts` (tree-wide) and
 * `packages/db/src/classification.test.ts` (core) — must agree with the LIVE database, which
 * `packages/fiscal-verifactu/src/privileges.test.ts` compares against with `toEqual`. A scanner that
 * only counted `CREATE TABLE` would keep a dropped table forever and put the three in permanent
 * disagreement, so this subtracts on `DROP TABLE`.
 *
 * ORDER IS THE CONTRACT: the caller passes one migration set's SQL in FILENAME order, because
 * create → drop → create must resolve to "present" and the reverse to "absent". `readdirSync` does
 * not sort, so both callers sort.
 */

/** `CREATE TABLE ["public".]"<name>"` — quoted or bare, schema-qualified or not, IF NOT EXISTS or not.
 * The name capture is digit-tolerant (`[a-z0-9_]+`, `i` flag): real table names carry digits. */
const CREATE_TABLE =
  /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?"?(?:public"?\.)?"?([a-z0-9_]+)"?/gi;

/** `DROP TABLE [IF EXISTS] ["public".]"<name>"`, the same tolerances. A trailing CASCADE/RESTRICT is
 * outside the capture and does not need matching. */
const DROP_TABLE = /\bdrop\s+table\s+(?:if\s+exists\s+)?"?(?:public"?\.)?"?([a-z0-9_]+)"?/gi;

/** Blank block comments, `--` line comments, and `'…'` string literals to whitespace, preserving line
 * count (so a CREATE/DROP TABLE mentioned in prose or a literal is ignored). Naive by design — the
 * same scanner `module-graph-honesty.test.ts` uses, whose header records why a real parser is not
 * worth it here. */
function stripSql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .replace(/'(?:[^']|'')*'/g, (literal) => literal.replace(/[^\n]/g, " "));
}

/** One statement's position and what it does, so a file's CREATEs and DROPs apply in the order they
 * appear WITHIN the file as well as across files. */
interface Statement {
  index: number;
  table: string;
  drops: boolean;
}

export function tablesCreatedBy(files: readonly string[]): Set<string> {
  const tables = new Set<string>();
  for (const raw of files) {
    const sql = stripSql(raw);
    const statements: Statement[] = [];
    for (const m of sql.matchAll(CREATE_TABLE)) {
      /* v8 ignore next -- a matched group 1 is always defined; the guard is for the type, not a case */
      if (m[1] !== undefined) statements.push({ index: m.index, table: m[1].toLowerCase(), drops: false });
    }
    for (const m of sql.matchAll(DROP_TABLE)) {
      /* v8 ignore next */
      if (m[1] !== undefined) statements.push({ index: m.index, table: m[1].toLowerCase(), drops: true });
    }
    statements.sort((a, b) => a.index - b.index);
    for (const s of statements) {
      if (s.drops) tables.delete(s.table);
      else tables.add(s.table);
    }
  }
  return tables;
}
```

- [ ] **Step 4: Export it and run the test**

Add to `packages/sync-enrolment/src/index.ts`, beside the existing `classify` export:

```ts
export { tablesCreatedBy } from "./migration-tables.js";
```

Run: `pnpm --filter @waitron/sync-enrolment test -- migration-tables`
Expected: PASS, six tests.

- [ ] **Step 5: Switch the tree-wide guard to it**

In `scripts/classification-complete.test.ts`: delete the `CREATE_TABLE` const (`:29-33`) and the
`stripSql` function (`:35-44`), add to the imports at the top

```ts
import { tablesCreatedBy } from "../packages/sync-enrolment/src/migration-tables.js";
```

(a runtime-value import, the same shape as the existing `ALL_MODULES` / `packageDirOf` imports — this
file is not typechecked, per its header), **sort the directory read** at `:70`

```ts
    const sqls = entries
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => readFileSync(join(drizzleDir, name), "utf8"));
```

and replace the body of `createdTablesByModule` (`:80-95`) with:

```ts
/** Every table a module's migrations leave in existence (lowercased), by module name — CREATEs minus
 * later DROPs, in filename order. A module with a `drizzle/` dir but no `.sql` (e.g. `fiscal-none`)
 * contributes an empty set. */
function createdTablesByModule(discovered: DrizzlePackage[]): Map<string, Set<string>> {
  const byModule = new Map<string, Set<string>>();
  for (const { moduleName, sqls } of discovered) {
    const existing = byModule.get(moduleName);
    const tables = tablesCreatedBy(sqls);
    if (existing !== undefined) for (const t of existing) tables.add(t);
    byModule.set(moduleName, tables);
  }
  return byModule;
}
```

- [ ] **Step 6: Switch the core guard to it**

In `packages/db/src/classification.test.ts`, replace `tablesInDrizzle` (`:8-17`) with:

```ts
import { tablesCreatedBy } from "@waitron/sync-enrolment";

/** The tables core's migrations LEAVE IN EXISTENCE — CREATEs minus later DROPs, filename order
 * (`readdirSync` does not sort). */
function tablesInDrizzle(): Set<string> {
  const files = readdirSync(DRIZZLE)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(DRIZZLE, f), "utf8"));
  return tablesCreatedBy(files);
}
```

and at `:32` change `const created = new Set(tablesInDrizzle());` to `const created = tablesInDrizzle();`
(`:31` is `const classified = …` — do not touch it).

`DROP COLUMN` and `DROP CONSTRAINT` must keep NOT matching: `packages/db/drizzle/0003_drop_device_kind.sql`
and `0004_device_binding_rule_sql.sql:6` contain both, and `DROP_TABLE` requires the word `table`.

Confirm `@waitron/sync-enrolment` is already a dependency of `@waitron/db` — `packages/db/src/classification.ts:1` imports `classify` from it, so it is.

- [ ] **Step 7: Prove the new behaviour by deletion, then run both guards**

Temporarily append `DROP TABLE "devices";` to a scratch copy of a core migration and confirm
`packages/db`'s guard now FAILS with `devices` in the "classified but not created" list — that is the
negative control proving the subtraction is live, not decorative. Revert the scratch edit.

Run: `pnpm --filter @waitron/sync-enrolment test:coverage && pnpm --filter @waitron/db test -- classification && pnpm vitest run scripts/classification-complete.test.ts`
Expected: all PASS, and the tree-wide guard's anchors (`allCreatedTables.size >= 78`, `discovered.length >= 8`) still hold.

- [ ] **Step 8: Commit**

```bash
git add packages/sync-enrolment scripts/classification-complete.test.ts packages/db/src/classification.test.ts
git commit -s -m "feat(sync-enrolment): classification scanners subtract a dropped table

Both guards derived 'the tables that exist' from CREATE TABLE text with
nothing subtracting from it, so the repository's first DROP TABLE would
have left them demanding a classification row for a table gone from the
live database that fiscal-verifactu's privileges suite compares with
toEqual. One shared scanner now applies CREATEs and DROPs in order,
within a file and across a set, and both callers sort the directory read
because readdirSync does not."
```

---

### Task 2: The `join_requests` table

> **Amended before execution (controller Ruling 1).** This task no longer drops
> `device_pairing_codes` — the drop, its classification row, its `privileges.expected.ts` row and the
> two `packages/db` test files that use it all move to **Task 7**, which deletes the code that imports
> it in the same commit. As originally written, this task removed the table and its barrel export while
> `apps/server/src/device.ts` still imported it, so neither this task nor Tasks 4, 5, 6 or 6b could end
> green — and Task 6b's gate is an unfiltered `apps/server` run. Ignore every instruction below about
> deleting, dropping or removing `device_pairing_codes`; ADD `join_requests` and change nothing else.

**Files:**

- Create: `packages/db/src/schema/join-requests.ts`
- Modify: `packages/db/src/schema/devices.ts:96-148` (delete `devicePairingCodes` and its doc block)
- Modify: `packages/db/src/schema/index.ts` (add `export * from "./join-requests.js";`)
- Modify: `packages/db/src/index.ts:31` (drop `devicePairingCodes`; add `joinRequestKind, joinRequests`)
- Modify: `packages/db/src/classification.ts:88` (replace the `device_pairing_codes` row)
- Create: `packages/db/drizzle/0008_join_requests.sql` (generated) and
  `packages/db/drizzle/0009_join_requests_grants_sql.sql` (`--custom`)
- Modify: `packages/fiscal-verifactu/src/privileges.expected.ts:27` (row swap)
- Modify: `packages/db/src/schema/devices.test.ts` — `:8` drops `devicePairingCodes` from the import,
  and the whole `device_pairing_codes` material goes: `:44`, `:122`, `:172-224` (columns, the
  `DELETE … RETURNING`, the 23505-on-duplicate-digest case, the `drop index …_lookup_idx` mutation)
- Modify: `packages/db/src/schema/devices.fk.test.ts:65` — `delete from device_pairing_codes`
- Create: `packages/db/src/schema/join-requests.test.ts`

**Interfaces:**

- Produces: `joinRequests` (drizzle table) with columns `id, tenantId, locationId, kind, label,
  tokenHash, verificationNumber, createdAt`; `joinRequestKind` (pgEnum `join_request_kind`, values
  `device`, `print_agent`). Tasks 4-6 select and mutate it; Task 12 asserts its grants.

- [ ] **Step 1: Write the failing schema test**

Create `packages/db/src/schema/join-requests.test.ts`, following the shape of
`packages/db/src/schema/devices.test.ts` (`useTemplateDb` + `withTenant` + `asAppUser`):

```ts
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { seedTenantAndLocation } from "../testing/seed.js";

const suite = useTemplateDb({ template: "manifest" });

describe("join_requests", () => {
  it("accepts a device request and a print_agent request in the same tenant", async () => {
    const { tenantId, locationId } = await seedTenantAndLocation(suite.admin);
    await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into join_requests (tenant_id, location_id, kind, label, token_hash, verification_number)
        values (${tenantId}, ${locationId}, 'device', 'Bar till', 'h1', '47'),
               (${tenantId}, ${locationId}, 'print_agent', 'Kitchen box', 'h2', '13')`);
      const rows = await tx.execute<{ kind: string; verification_number: string }>(
        sql`select kind, verification_number from join_requests order by kind`,
      );
      expect(rows.rows.map((r) => r.kind)).toEqual(["device", "print_agent"]);
    });
  });

  it("refuses an unknown kind", async () => {
    const { tenantId, locationId } = await seedTenantAndLocation(suite.admin);
    await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      await expect(
        tx.execute(sql`
          insert into join_requests (tenant_id, location_id, kind, label, token_hash, verification_number)
          values (${tenantId}, ${locationId}, 'kitchen_sink', 'x', 'h', '00')`),
      ).rejects.toThrow();
    });
  });

  it("grants app_user SELECT, INSERT and DELETE but not UPDATE", async () => {
    const { rows } = await suite.admin.execute<{ privs: string }>(sql`
      select
        case when has_table_privilege('app_user','join_requests','SELECT') then 'S' else '' end ||
        case when has_table_privilege('app_user','join_requests','INSERT') then 'I' else '' end ||
        case when has_table_privilege('app_user','join_requests','UPDATE') then 'U' else '' end ||
        case when has_table_privilege('app_user','join_requests','DELETE') then 'D' else '' end
        as privs`);
    expect(rows[0]!.privs).toBe("SID");
  });

  it("no longer has a device_pairing_codes table", async () => {
    const { rows } = await suite.admin.execute<{ n: string }>(
      sql`select count(*)::text as n from pg_class where relname = 'device_pairing_codes'`,
    );
    expect(rows[0]!.n).toBe("0");
  });
});
```

Check `packages/db/src/testing/seed.js`'s real export name before using `seedTenantAndLocation`; if
the harness has no such helper, seed with the same `applyVenue(planVenue(…), …)` call
`apps/server/src/device-api.pg.test.ts:135-228` uses and take `tenantId`/`locationId` off the result.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/db test -- join-requests`
Expected: FAIL — relation `join_requests` does not exist.

- [ ] **Step 3: Write the schema**

Create `packages/db/src/schema/join-requests.ts`:

```ts
import { pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/** What an accepted request BECOMES. The two surfaces share one table because they need the same
 * columns and both models are core-set; the cross-surface decoy rule (design §1.2) is then one read
 * rather than a union two implementations must keep in step. If printing ever leaves the core for a
 * module, this enum value goes with it. */
export const joinRequestKind = pgEnum("join_request_kind", ["device", "print_agent"]);

/**
 * A pending ask-to-join: someone knocked while pairing mode was open, and an admin has not yet matched
 * its number. NEVER a `devices` or `print_agents` row — for devices that is forced (the
 * station-XOR-register constraint trigger cannot accept a request whose binding is unchosen), and for
 * agents it is chosen, so both real tables hold only approved rows and `active`/revoke keep one
 * meaning. Accept inserts the real row and deletes the request in one transaction; deny just deletes.
 *
 * `local`: a standby inherits no pending joins, which is the same fail-closed posture as the in-memory
 * pairing window (design §1.1).
 */
export const joinRequests = pgTable(
  "join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // The venue the joiner belongs to — stamped from the node's own `cfg.locationId`, exactly as
    // `generatePairingCode` stamped it, so a joiner still asks nothing about which venue it is joining.
    locationId: uuid("location_id")
      .notNull()
      /* v8 ignore next */
      .references(() => locations.id, { onDelete: "restrict" }),
    kind: joinRequestKind("kind").notNull(),
    // The name the joiner asked for. A device accept copies it to `devices.label`, an agent accept to
    // `print_agents.name`.
    label: text("label").notNull(),
    // scrypt of the token minted at join. Copied to the real row at accept, so the joiner's cookie or
    // bearer token survives approval unchanged — only its SELECTOR changes.
    tokenHash: text("token_hash").notNull(),
    // The two-digit number the joiner displays and the admin matches. NOT a secret and NOT typed: its
    // whole job is to be compared across a room, so two digits, not a Crockford string. What defends a
    // mix-up is the decoy rule plus deny-on-wrong (design §1.2), never this column's entropy.
    verificationNumber: text("verification_number").notNull(),
    // The two decoys, minted WITH the number at join and never re-rolled. Re-rolling per challenge
    // would let two calls intersect in exactly one value — the real one — so any client with a
    // management session could derive the answer and never risk a mismatch, which is the check the
    // whole design rests on (design §1.2 rule 2).
    decoyNumbers: text("decoy_numbers").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the composite-FK target shape every tenant table here carries.
    unique("join_requests_tenant_id_key").on(t.tenantId, t.id),
  ],
);
```

Delete `devicePairingCodes` and its doc block from `packages/db/src/schema/devices.ts:96-148`, and
drop `uniqueIndex` from that file's import at `:1` if nothing else there uses it.

- [ ] **Step 4: Wire the exports and the classification**

`packages/db/src/schema/index.ts` — add beside `export * from "./devices.js";`:

```ts
export * from "./join-requests.js";
```

`packages/db/src/index.ts:31` — replace:

```ts
export { devices } from "./schema/devices.js";
export { joinRequestKind, joinRequests } from "./schema/join-requests.js";
```

`packages/db/src/classification.ts:88` — replace the `device_pairing_codes` row with:

```ts
  classify("join_requests", "local", "this node's pending joins, device and agent; not copied"),
```

Leave the `print_agent_pairing_codes` row at `:89-93` alone — the agent slice removes it.

- [ ] **Step 5: Generate the migrations**

```bash
pnpm --filter @waitron/db db:generate --name join_requests
pnpm --filter @waitron/db db:generate:custom --name join_requests_grants_sql
```

The generated `0008_join_requests.sql` should contain the `CREATE TYPE "public"."join_request_kind"`,
the `CREATE TABLE "join_requests"`, its FKs and the composite unique, and — because the schema no
longer declares it — `DROP TABLE "device_pairing_codes";`. **Read the generated file.** If drizzle-kit
emits the drop as `DROP TABLE "device_pairing_codes" CASCADE;`, keep it; nothing references that table.
If it does not emit a drop at all, add the statement by hand to the `--custom` file instead, with a
comment saying drizzle-kit did not generate it.

Write `0009_join_requests_grants_sql.sql` by hand:

```sql
-- `join_requests` is written by the app role on an UNAUTHENTICATED knock and deleted on accept or deny,
-- so app_user holds SELECT, INSERT and DELETE — and deliberately NOT UPDATE: a request is never edited,
-- only created and consumed, so an UPDATE grant would be a privilege with no caller (CLAUDE.md §3,
-- "never widen a grant"). The same SID shape `device_pairing_codes` held, which this table replaces.
REVOKE ALL ON "join_requests" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "join_requests" TO app_user;
```

- [ ] **Step 6: Update the privileges fixture**

`packages/fiscal-verifactu/src/privileges.expected.ts` — delete the `device_pairing_codes: "SID",` row
(`:27`) and add, in alphabetical position:

```ts
  join_requests: "SID",
```

- [ ] **Step 7: Run the gate for this task**

```bash
pnpm --filter @waitron/db test:coverage
pnpm --filter @waitron/fiscal-verifactu test -- privileges
pnpm vitest run scripts/classification-complete.test.ts
pnpm --filter @waitron/db typecheck && pnpm format:check
```

Expected: all PASS. `packages/db`'s classification guard passing here is the proof Task 1 actually
subtracts — before Task 1 it would fail with `device_pairing_codes` in the "classified but not
created" list.

Also run the second root guard, as spec §11 asks — `join_requests` creates no `reject_mutation`
trigger so it will pass, but the guard is what proves that:

```bash
pnpm vitest run scripts/append-only-enable-always.test.ts
```

**Note:** `apps/server` will not typecheck until Tasks 6 and 6b delete and migrate the code that
imports `devicePairingCodes`. That is expected; do not try to fix `apps/server` here. `packages/db`'s
OWN suite is a different matter — the two files above are in this task precisely so this task can end
green.

- [ ] **Step 8: Commit**

```bash
git add packages/db packages/fiscal-verifactu/src/privileges.expected.ts
git commit -s -m "feat(db): one join_requests table replaces device_pairing_codes

A pending join is never a devices row: the station-XOR-register trigger
cannot accept a request whose binding is unchosen, and keeping requests
separate leaves devices holding only approved rows. One table serves both
surfaces so the cross-surface decoy rule is a single read; the kind enum
carries which. app_user gets SID and deliberately not UPDATE — a request
is created and consumed, never edited.

print_agent_pairing_codes stays until the agent slice adopts the
mechanism: the enrol route reading it ships today."
```

---

### Task 3: The pairing-mode holder

**Files:**

- Create: `apps/server/src/pairing-mode.ts`
- Create: `apps/server/src/pairing-mode.test.ts`

**Interfaces:**

- Produces: `createPairingMode(opts?: { now?: () => number; ttlMs?: number }): PairingMode` with
  `open(): { openUntil: string }`, `close(): void`, `isOpen(): boolean`, `noteRefused(): void`,
  `refusedRecently(): number`, `openUntil(): string | null`. Tasks 7 and 8 consume it; Task 12's
  e2e drives it.
- Produces: `PAIRING_WINDOW_MS = 15 * 60 * 1000`, `REFUSED_WINDOW_MS = 10 * 60 * 1000`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/pairing-mode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PAIRING_WINDOW_MS, REFUSED_WINDOW_MS, createPairingMode } from "./pairing-mode.js";

/** A controllable clock — no sleeping, the shape `enrol-rate-limit.test.ts` uses. */
function atClock() {
  let t = 1_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createPairingMode", () => {
  it("is CLOSED on a fresh holder — a restart or a promotion never inherits an open door", () => {
    expect(createPairingMode().isOpen()).toBe(false);
    expect(createPairingMode().openUntil()).toBeNull();
  });

  it("opens for the window and closes when it lapses", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now });
    mode.open();
    expect(mode.isOpen()).toBe(true);
    clock.advance(PAIRING_WINDOW_MS - 1);
    expect(mode.isOpen()).toBe(true);
    clock.advance(2);
    expect(mode.isOpen()).toBe(false);
  });

  it("open() on an open window EXTENDS it rather than starting a second one", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now });
    mode.open();
    clock.advance(PAIRING_WINDOW_MS - 1_000);
    const { openUntil } = mode.open();
    clock.advance(PAIRING_WINDOW_MS - 1_000);
    expect(mode.isOpen()).toBe(true);
    expect(Date.parse(openUntil)).toBe(clock.now() + 1_000);
  });

  it("close() shuts it immediately", () => {
    const mode = createPairingMode();
    mode.open();
    mode.close();
    expect(mode.isOpen()).toBe(false);
    expect(mode.openUntil()).toBeNull();
  });

  it("counts refused knocks and forgets them after the refused window", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now });
    mode.noteRefused();
    mode.noteRefused();
    expect(mode.refusedRecently()).toBe(2);
    clock.advance(REFUSED_WINDOW_MS + 1);
    expect(mode.refusedRecently()).toBe(0);
  });

  it("reports openUntil only while open", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now });
    const { openUntil } = mode.open();
    expect(mode.openUntil()).toBe(openUntil);
    clock.advance(PAIRING_WINDOW_MS + 1);
    expect(mode.openUntil()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server test -- pairing-mode`
Expected: FAIL — `Cannot find module './pairing-mode.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/pairing-mode.ts`:

```ts
/**
 * Pairing mode — the venue-wide window during which anything may ask to join (design §1.1).
 *
 * IN MEMORY, ON THE PRIMARY, DELIBERATELY. It is not a table: a window is a thing an admin is doing
 * right now, not a fact about the venue, and holding it here makes it fail closed on both the events
 * that should close it — a restart, and a promotion (a node that has just taken over must not inherit
 * an open door). It also costs no migration, no classification and no grant.
 *
 * ONE holder serves BOTH surfaces (owner decision 2026-09-08): `boot.ts` builds it once and passes it
 * to the device and print mounts, so "venue-wide" is a property of the wiring rather than a rule
 * anyone has to remember.
 */

export const PAIRING_WINDOW_MS = 15 * 60 * 1000;

/** How far back `refusedRecently` looks. The dashboard renders it as "N tried to join in the last 10
 * minutes" beside the toggle, so the copy and this constant must move together. */
export const REFUSED_WINDOW_MS = 10 * 60 * 1000;

export interface PairingMode {
  /** Open the window, or extend an already-open one by a fresh TTL. */
  open(): { openUntil: string };
  close(): void;
  isOpen(): boolean;
  /** The ISO instant the window lapses, or `null` when shut. */
  openUntil(): string | null;
  /** Record a knock refused because the window was shut. Deliberately NOT a row: persisting refused
   * knocks would hand an attacker the row creation the window exists to deny (design §12). */
  noteRefused(): void;
  refusedRecently(): number;
}

export function createPairingMode(
  opts: { now?: () => number; ttlMs?: number } = {},
): PairingMode {
  const { now = Date.now, ttlMs = PAIRING_WINDOW_MS } = opts;
  let openUntilMs = 0;
  let refusedAt: number[] = [];
  return {
    open() {
      openUntilMs = now() + ttlMs;
      return { openUntil: new Date(openUntilMs).toISOString() };
    },
    close() {
      openUntilMs = 0;
    },
    isOpen() {
      return now() < openUntilMs;
    },
    openUntil() {
      return now() < openUntilMs ? new Date(openUntilMs).toISOString() : null;
    },
    noteRefused() {
      refusedAt.push(now());
    },
    refusedRecently() {
      const cutoff = now() - REFUSED_WINDOW_MS;
      refusedAt = refusedAt.filter((t) => t > cutoff);
      return refusedAt.length;
    },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/server test -- pairing-mode`
Expected: PASS, six tests.

- [ ] **Step 5: Prove the fail-closed property by deletion**

Change `let openUntilMs = 0;` to `let openUntilMs = Number.MAX_SAFE_INTEGER;` and confirm the first
test FAILS. Revert. A holder that started open would be the one bug here that no route-level test
would catch, because every route test opens the window first.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/pairing-mode.ts apps/server/src/pairing-mode.test.ts
git commit -s -m "feat(server): the venue-wide pairing-mode window

In memory on the primary, not a table: a window is something an admin is
doing now, not a fact about the venue, and holding it here fails closed on
exactly the two events that should close it — a restart and a promotion.
One holder serves both surfaces, so venue-wide is a property of the wiring.
Refused knocks are counted, never recorded as rows: persisting them would
hand an attacker the row creation the window exists to deny."
```

---

### Task 4: Store verbs — knock, and read a joiner's status

**The request's id BECOMES the accepted row's id.** A joiner's cookie is `${joinId}.${token}`, and if
accept minted a fresh `devices.id` that cookie would name a row that no longer exists, forcing a
re-issued cookie on the status response. Carrying the id over instead means the cookie is set once at
join and never changes: the status route resolves the selector against `join_requests` (pending), then
against `devices` (approved), and a miss in both is `not_approved`. Nothing else in the tree keys off
a device id being freshly minted, and a denied request's id is simply never used.

**Files:**

- Create: `apps/server/src/join-requests.ts`
- Create: `apps/server/src/join-requests.test.ts`
- Modify: `apps/server/src/errors.ts` (declare the new codes)

**Interfaces:**

- Produces: `createJoinRequest(tx, cfg, input: { kind: JoinRequestKind; label: string; numbers?: () => number }): Promise<{ joinId: string; verificationNumber: string; token: string }>`
  — **no `fullCode` parameter.** An earlier draft passed the surface's own `*.join_full` code, but
  `agent.join_full` does not exist (grep of `apps` + `packages`, excluding `dist`: zero hits;
  `packages/printing/src/errors.ts` declares only `agent.not_found`, `agent.unauthorized` and the
  three `agent.pairing_*`), so `new AppError("agent.join_full", {})` would not typecheck. This slice
  throws `device.join_full` for both kinds; the agent slice declares its own code and widens the verb
  then, when there is a caller to justify it.
- Produces: `readJoinStatus(tx, cfg, joinId: string, token: string): Promise<"pending" | "approved" | "not_approved">`
- Produces: `PENDING_CAP = 10`, `JOIN_TTL_MS = 15 * 60 * 1000`
- Consumes: `joinRequests` (Task 2), `hashSecret`/`verifySecret` from `@waitron/identity`

- [ ] **Step 1: Declare the error codes**

In `apps/server/src/errors.ts`, inside the `declare module "@waitron/shared"` block, beside the other
`device.*` entries:

```ts
    /**
     * A knock arrived while pairing mode was SHUT (design §1.1). The window is the deliberate admin act
     * that replaced the pairing code's secret, so this is the ordinary state, not an anomaly: the device
     * shows "ask the manager to switch on pairing mode" and the operator has a real next step. NO params
     * — nothing about the window is the joiner's business. Mapped to HTTP 403 by `device-api.ts`'s local
     * STATUS map. Never renamed once shipped.
     */
    "device.pairing_closed": Record<string, never>;
    /**
     * The tenant already holds the cap of pending DEVICE join requests (design §1.2's decoy rule needs
     * room, and an uncapped pending list is a denial-of-service on the admin's attention). Per (tenant,
     * kind), so ten agents mid-install cannot lock devices out. HTTP 429.
     */
    "device.join_full": Record<string, never>;
    /**
     * Too many knocks in the limiter's window. The device twin of `agent.join_rate_limited`; replaces
     * `device.pairing_rate_limited`, which went with the pairing code. HTTP 429.
     */
    "device.join_rate_limited": Record<string, never>;
    /**
     * The admin tapped a number that is not this request's (design §1.2). The request is DELETED, not
     * offered again: a wrong tap denies, which is what makes one-in-three an acceptable guess rate. The
     * device's recovery is its own "Try again", which knocks afresh with a new number. HTTP 400.
     */
    "device.join_mismatch": Record<string, never>;
    /**
     * No pending join request with that id in this tenant — never existed, already accepted or denied,
     * or lapsed past its TTL. All fold into one code, as `device.pairing_invalid` folded the pairing
     * code's misses: the admin's recovery is the same in every case, and the joiner must knock again.
     * `join_request.*` names the domain concept. HTTP 404.
     */
    "join_request.not_found": Record<string, never>;
```

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/join-requests.test.ts`. Real Postgres, because these verbs run as `app_user`
and the grants are part of what is being asserted:

```ts
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { JOIN_TTL_MS, PENDING_CAP, createJoinRequest, readJoinStatus } from "./join-requests.js";
// `useTemplateDb` is NOT on the `@waitron/db` barrel — the exports map is enumerated (CLAUDE.md §3),
// and the sibling suite imports it from the subpath (`device-api.pg.test.ts:5-6`).
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

// … suite + `setupVenue()` exactly as `device-api.pg.test.ts:135-228` builds them; reuse that helper
// by extracting it if it is not already exported.

describe("createJoinRequest", () => {
  it("mints a two-digit number, an id and a token, and leaves one pending row", async () => {
    const venue = await setupVenue();
    const made = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "Bar till",
      });
    });
    expect(made.verificationNumber).toMatch(/^\d{2}$/);
    expect(made.token.length).toBeGreaterThan(20);
    expect(made.joinId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("never mints a number another pending request already holds, in EITHER kind", async () => {
    const venue = await setupVenue();
    // Force the generator to want 47 every time; the first request takes it, the second must not.
    const always47 = () => 47;
    const first = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, {
        kind: "print_agent",
        label: "Kitchen box",
        numbers: always47,
      });
    });
    expect(first.verificationNumber).toBe("47");
    const second = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "Bar till",
        numbers: (() => {
          let n = 0;
          return () => (n++ === 0 ? 47 : 13);
        })(),
      });
    });
    expect(second.verificationNumber).toBe("13");
  });

  it("refuses past the cap, per (tenant, kind)", async () => {
    const venue = await setupVenue();
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      for (let i = 0; i < PENDING_CAP; i++) {
        await createJoinRequest(tx, venue.cfg, {
          kind: "device",
          label: `d${i}`,
          });
      }
      await expect(
        createJoinRequest(tx, venue.cfg, {
          kind: "device",
          label: "one too many",
          }),
      ).rejects.toMatchObject({ code: "device.join_full" });
      // The OTHER kind is unaffected — the cap is per (tenant, kind).
      await expect(
        createJoinRequest(tx, venue.cfg, {
          kind: "print_agent",
          label: "agent",
          }),
      ).resolves.toBeDefined();
    });
  });

  it("sweeps lapsed requests, so they do not occupy the cap or a number", async () => {
    const venue = await setupVenue();
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const stale = await createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "stale",
      });
      await tx.execute(sql`
        update join_requests set created_at = now() - interval '16 minutes' where id = ${stale.joinId}`);
      await createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "fresh",
      });
      const { rows } = await tx.execute<{ label: string }>(sql`select label from join_requests`);
      expect(rows.map((r) => r.label)).toEqual(["fresh"]);
    });
  });
});

describe("readJoinStatus", () => {
  it("is pending for a live request with the right token", async () => { /* … */ });
  it("is not_approved for a wrong token on a live request", async () => { /* … */ });
  it("is not_approved for an id that never existed", async () => { /* … */ });
  it("is not_approved once the request has lapsed", async () => { /* … */ });
  // The `approved` case needs an accepted device and lands in Task 6, whose test asserts it.
});
```

Fill the four `readJoinStatus` bodies following the first `createJoinRequest` test's shape — a
`withTenant` + `asAppUser` block, `createJoinRequest`, then `readJoinStatus(tx, cfg, id, token)`
asserted with `toBe`.

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @waitron/server test -- join-requests`
Expected: FAIL — `Cannot find module './join-requests.js'`.

- [ ] **Step 4: Write the implementation**

Create `apps/server/src/join-requests.ts`:

```ts
import "./errors.js";
import { randomBytes, randomInt } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { type Transaction, devices, joinRequests } from "@waitron/db";
import { hashSecret, verifySecret } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";

/** Both surfaces' pending joins live in one table; this is which one a row is for. */
export type JoinRequestKind = "device" | "print_agent";

/** A request lapses after this long — the same fifteen minutes the pairing code had, and the same as
 * the pairing window, so a knock cannot outlive the window that admitted it by more than one window. */
export const JOIN_TTL_MS = 15 * 60 * 1000;

/** Pending rows per (tenant, kind). Ten is enough for the largest install anyone runs at once, and it
 * bounds both the admin's attention and the numbers the decoy rule must avoid. */
export const PENDING_CAP = 10;

/** Delete this tenant's lapsed requests. Called at the head of every verb that reads or counts them, so
 * a lapsed row never occupies the cap, never blocks a number, and never appears in the pending list —
 * the same opportunistic sweep the pairing code's TTL used, rather than a background job. */
async function sweepLapsed(tx: Transaction, cfg: TillConfig): Promise<void> {
  await tx
    .delete(joinRequests)
    .where(
      and(
        eq(joinRequests.tenantId, cfg.tenantId),
        lt(joinRequests.createdAt, new Date(Date.now() - JOIN_TTL_MS).toISOString()),
      ),
    );
}

/** Every number currently spoken for in this tenant, EITHER kind, split by role. The cross-surface
 * scope is the point (design §1.2 rule 3): an agent request and a device request must never show the
 * same number, or an admin comparing across two screens can be honestly misled. */
export async function pendingNumbers(
  tx: Transaction,
  cfg: TillConfig,
): Promise<{ reals: Set<string>; decoys: Set<string> }> {
  const rows = await tx
    .select({ n: joinRequests.verificationNumber, d: joinRequests.decoyNumbers })
    .from(joinRequests)
    .where(eq(joinRequests.tenantId, cfg.tenantId));
  return {
    reals: new Set(rows.map((r) => r.n)),
    decoys: new Set(rows.flatMap((r) => r.d)),
  };
}

/** `00`–`99`. Two digits because the number is COMPARED across a room, never typed — its job is
 * legibility, and what defends a mix-up is the distinctness rule plus deny-on-wrong, not entropy. */
function twoDigits(n: number): string {
  return String(n).padStart(2, "0");
}

export async function createJoinRequest(
  tx: Transaction,
  cfg: TillConfig,
  input: {
    kind: JoinRequestKind;
    label: string;
    /** Injectable for tests; production uses `randomInt(0, 100)`. */
    numbers?: () => number;
  },
): Promise<{ joinId: string; verificationNumber: string; token: string }> {
  await sweepLapsed(tx, cfg);

  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(joinRequests)
    .where(and(eq(joinRequests.tenantId, cfg.tenantId), eq(joinRequests.kind, input.kind)));
  if (count >= PENDING_CAP) throw new AppError("device.join_full", {});

  // The REAL number avoids every existing real AND every issued decoy; the DECOYS avoid every real.
  // Both directions matter because the decoys are fixed here and live as long as the row: without the
  // first rule, a decoy issued at 10:01 becomes somebody's real number at 10:02, and the collision
  // §1.2 rule 3 forbids arrives by the back door. Worst case that reserves sixty of the hundred
  // values (twenty pending rows × three), which the cap is what keeps true.
  const { reals, decoys } = await pendingNumbers(tx, cfg);
  const next = input.numbers ?? (() => randomInt(0, 100));
  const pick = (forbidden: ReadonlySet<string>): string | undefined => {
    for (let attempt = 0; attempt < 400; attempt++) {
      const candidate = twoDigits(next() % 100);
      if (!forbidden.has(candidate)) return candidate;
    }
    /* v8 ignore next */
    return undefined;
  };
  const spokenFor = new Set([...reals, ...decoys]);
  const verificationNumber = pick(spokenFor);
  /* v8 ignore next */
  if (verificationNumber === undefined) throw new AppError("device.join_full", {});
  const decoyNumbers: string[] = [];
  const decoyForbidden = new Set([...reals, verificationNumber]);
  while (decoyNumbers.length < 2) {
    const d = pick(decoyForbidden);
    /* v8 ignore next */
    if (d === undefined) throw new AppError("device.join_full", {});
    decoyNumbers.push(d);
    decoyForbidden.add(d);
  }

  const token = randomBytes(32).toString("base64url");
  const [row] = await tx
    .insert(joinRequests)
    .values({
      tenantId: cfg.tenantId,
      locationId: cfg.locationId,
      kind: input.kind,
      label: input.label,
      tokenHash: hashSecret(token),
      verificationNumber,
      decoyNumbers,
    })
    .returning({ id: joinRequests.id });
  return { joinId: row!.id, verificationNumber, token };
}

/**
 * What a joiner polling with `${joinId}.${token}` should be told.
 *
 * The id is carried THROUGH accept — an accepted request becomes a `devices` row with the same id and
 * the same token hash — so one selector answers both questions and the joiner's cookie is set once, at
 * join, and never re-issued. Denied, lapsed and never-existed all fold into `not_approved`: the
 * joiner's recovery is identical in every case.
 */
export async function readJoinStatus(
  tx: Transaction,
  cfg: TillConfig,
  joinId: string,
  token: string,
): Promise<"pending" | "approved" | "not_approved"> {
  await sweepLapsed(tx, cfg);
  const [pending] = await tx
    .select({ tokenHash: joinRequests.tokenHash })
    .from(joinRequests)
    .where(and(eq(joinRequests.tenantId, cfg.tenantId), eq(joinRequests.id, joinId)));
  if (pending !== undefined) {
    return verifySecret(token, pending.tokenHash) ? "pending" : "not_approved";
  }
  const [accepted] = await tx
    .select({ tokenHash: devices.tokenHash })
    .from(devices)
    .where(
      and(eq(devices.tenantId, cfg.tenantId), eq(devices.id, joinId), eq(devices.active, true)),
    );
  if (accepted !== undefined && verifySecret(token, accepted.tokenHash)) return "approved";
  return "not_approved";
}
```

Note both reads carry `eq(…tenantId, cfg.tenantId)` beside the by-id predicate — a globally unique
UUID is not the query's isolation boundary (CLAUDE.md §3).

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @waitron/server test -- join-requests`
Expected: PASS.

- [ ] **Step 6: Prove the distinctness rule by deletion**

Delete `if (!taken.has(candidate))` (accept the first candidate unconditionally) and confirm the
"never mints a number another pending request already holds" test FAILS. Revert. Then delete the
`eq(joinRequests.tenantId, …)` from `readJoinStatus`'s first query and confirm a two-tenant probe
fails — add that probe if the suite does not already have one.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/join-requests.ts apps/server/src/join-requests.test.ts apps/server/src/errors.ts
git commit -s -m "feat(server): knock and status verbs for join requests

A request's id is carried through accept onto the devices row, so a
joiner's cookie is set once and never re-issued and one selector answers
both 'am I pending' and 'am I approved'. Numbers are distinct across BOTH
kinds in the tenant: an agent request and a device request showing the
same number could honestly mislead an admin comparing across screens,
which is the mix-up the number exists to prevent. The cap is per (tenant,
kind) so an install's agents cannot lock devices out, and lapsed rows are
swept at the head of every verb rather than by a background job."
```

---

### Task 5: The challenge — three numbers, one of them real

**Files:**

- Modify: `apps/server/src/join-requests.ts`
- Modify: `apps/server/src/join-requests.test.ts`

**Interfaces:**

- Produces: `listPendingJoinRequests(tx, cfg, kind): Promise<{ id: string; kind: JoinRequestKind; label: string; createdAt: string }[]>` — **no number in the row type**, which is the design's rule 1 expressed as a type.
- Produces: `challengeFor(tx, cfg, id: string): Promise<{ choices: string[] }>` — it READS the row's
  fixed set and shuffles it; it takes no number source, because re-rolling is the defect (spec §1.2
  rule 2).

- [ ] **Step 1: Write the failing tests**

Append to `apps/join-requests.test.ts`:

```ts
describe("listPendingJoinRequests", () => {
  it("returns pending rows of the asked-for kind and NEVER the number", async () => {
    const venue = await setupVenue();
    const rows = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      await createJoinRequest(tx, venue.cfg, { kind: "print_agent", label: "Box" });
      return listPendingJoinRequests(tx, venue.cfg, "device");
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("Bar till");
    // The whole point of the numeric match: the list cannot show the answer beside the question. The
    // key set is what expresses that — a "no two digits anywhere" assertion would trip on the row's
    // own UUID and ISO timestamp and could never pass.
    expect(Object.keys(rows[0]!).sort()).toEqual(["createdAt", "id", "kind", "label"]);
  });
});

describe("challengeFor", () => {
  it("returns three choices, one of which is the request's own number", async () => {
    const venue = await setupVenue();
    const { made, choices } = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
      return { made, choices: (await challengeFor(tx, venue.cfg, made.joinId)).choices };
    });
    expect(choices).toHaveLength(3);
    expect(new Set(choices).size).toBe(3);
    expect(choices).toContain(made.verificationNumber);
    for (const c of choices) expect(c).toMatch(/^\d{2}$/);
  });

  it("returns the SAME three numbers on every call — a second call must teach nothing", async () => {
    const venue = await setupVenue();
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
      const first = await challengeFor(tx, venue.cfg, made.joinId);
      const second = await challengeFor(tx, venue.cfg, made.joinId);
      // Sets, not arrays: the order is shuffled per call, the MEMBERSHIP is fixed. Two re-rolled sets
      // would intersect in exactly one value — the real one — handing the answer to any client with a
      // management session.
      expect(new Set(second.choices)).toEqual(new Set(first.choices));
    });
  });

  it("never offers a decoy that is another pending request's real number, in EITHER kind", async () => {
    const venue = await setupVenue();
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const agent = await createJoinRequest(tx, venue.cfg, { kind: "print_agent", label: "a" });
      const device = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
      // Drive the decoy source to WANT the agent's number; it must be skipped.
      const wantsAgents = (() => { let i = 0; return () => (i++ < 2 ? Number(agent.verificationNumber) : 88); })();
      const { choices } = await challengeFor(tx, venue.cfg, device.joinId, { numbers: wantsAgents });
      expect(choices).toContain(device.verificationNumber);
      expect(choices).not.toContain(agent.verificationNumber);
    });
  });

  it("shuffles — the real number is not always in the same position", async () => {
    const venue = await setupVenue();
    const positions = new Set<number>();
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      for (let i = 0; i < 40; i++) {
        const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: `d${i}` });
        const { choices } = await challengeFor(tx, venue.cfg, made.joinId);
        positions.add(choices.indexOf(made.verificationNumber));
        await denyJoinRequest(tx, venue.cfg, made.joinId); // keep under the cap
      }
    });
    expect(positions.size).toBeGreaterThan(1);
  });

  it("throws join_request.not_found for an unknown id, and for another tenant's request", async () => {
    // … two venues; challengeFor(tx, venueA.cfg, requestFromB.joinId) rejects with join_request.not_found
  });
});
```

The shuffle test uses `denyJoinRequest`, which Task 6 adds — write it now and expect this one test to
stay red until Task 6, or hold this single test back to Task 6. Prefer holding it back; a task should
end green.

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/server test -- join-requests`
Expected: FAIL — `listPendingJoinRequests`/`challengeFor` are not exported.

- [ ] **Step 3: Implement**

Append to `apps/server/src/join-requests.ts`:

```ts
/** The pending list the dashboard renders. The return type deliberately has NO number field: the list
 * must never carry the answer beside the question (design §1.2 rule 1), and a type that cannot express
 * it is a stronger guarantee than a `select` that happens not to ask for it. */
export async function listPendingJoinRequests(
  tx: Transaction,
  cfg: TillConfig,
  kind: JoinRequestKind,
): Promise<{ id: string; kind: JoinRequestKind; label: string; createdAt: string }[]> {
  await sweepLapsed(tx, cfg);
  const rows = await tx
    .select({
      id: joinRequests.id,
      kind: joinRequests.kind,
      label: joinRequests.label,
      createdAt: joinRequests.createdAt,
    })
    .from(joinRequests)
    .where(and(eq(joinRequests.tenantId, cfg.tenantId), eq(joinRequests.kind, kind)))
    .orderBy(joinRequests.createdAt);
  return rows;
}

/** Fetch one pending request, tenant-scoped, or throw. Shared by challenge, accept and deny so the
 * scoping and the TTL are applied identically in one place. */
async function requirePending(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<{ id: string; kind: JoinRequestKind; label: string; verificationNumber: string; decoyNumbers: string[]; tokenHash: string; locationId: string }> {
  await sweepLapsed(tx, cfg);
  const [row] = await tx
    .select({
      id: joinRequests.id,
      kind: joinRequests.kind,
      label: joinRequests.label,
      verificationNumber: joinRequests.verificationNumber,
      decoyNumbers: joinRequests.decoyNumbers,
      tokenHash: joinRequests.tokenHash,
      locationId: joinRequests.locationId,
    })
    .from(joinRequests)
    .where(and(eq(joinRequests.tenantId, cfg.tenantId), eq(joinRequests.id, id)));
  if (row === undefined) throw new AppError("join_request.not_found", {});
  return row;
}

/**
 * The three numbers the admin picks from: this request's own, plus two decoys.
 *
 * The server builds the set and does NOT say which is real — the dashboard receives three
 * indistinguishable strings and posts back the one the admin tapped, so the check is server-side and
 * the page cannot leak the answer. The person is what is being tested, not the browser.
 *
 * No decoy may equal ANY other pending request's real number in the tenant, either kind. Without that,
 * two joiners at once can be honestly ambiguous — and an attacker would arrange exactly that, knocking
 * beside a real device in the hope its number turns up among the decoys.
 */
export async function challengeFor(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<{ choices: string[] }> {
  const row = await requirePending(tx, cfg, id);
  // The set was fixed at join and is READ here, never re-rolled — see the column's comment and
  // design §1.2 rule 2. Only the ORDER varies per call.
  const choices = [row.verificationNumber, ...row.decoyNumbers];

  // Fisher-Yates over a cryptographic source: a predictable position would let a careless admin learn
  // "the real one is always first" and stop comparing, which is the whole failure this guards.
  for (let i = choices.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [choices[i], choices[j]] = [choices[j]!, choices[i]!];
  }
  return { choices };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server test -- join-requests`
Expected: PASS (minus the shuffle test if held back to Task 6).

- [ ] **Step 5: Prove both rules by deletion**

In `createJoinRequest`, remove the decoys from `spokenFor` (so a real number may collide with an
issued decoy) and confirm the cross-kind test FAILS. Then make `challengeFor` mint two fresh decoys
instead of reading the row's, and confirm the "same three numbers on every call" test FAILS. Revert
both. The second is the one that matters: without it the property §1.2 rule 2 claims is simply false,
and no other test in the tree would notice.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/join-requests.ts apps/server/src/join-requests.test.ts
git commit -s -m "feat(server): the three-number challenge

The server builds the choice set and does not say which is real, so the
check is server-side and the page cannot leak the answer — the admin is
what is being tested, not the browser. No decoy may equal another pending
request's number in either kind: two joiners showing the same number is
the ambiguity an attacker would engineer. The pending list's row type has
no number field at all, which is a stronger guarantee than a select that
happens not to ask for one."
```

---

### Task 6: Accept and deny

**Files:**

- Modify: `apps/server/src/join-requests.ts`
- Modify: `apps/server/src/device.ts` (extract the binding resolution `enrolDevice` held)
- Modify: `apps/server/src/join-requests.test.ts`

**Interfaces:**

- Produces: `acceptDeviceJoinRequest(tx, cfg, id, input): Promise<AcceptResult>` where
  `type AcceptResult = { ok: true; deviceId: string; name: string; formFactor: FormFactor } | { ok: false; reason: "mismatch" }`.
  **It returns the mismatch; it does not throw it** — see Step 4.
- Produces: `denyJoinRequest(tx, cfg, id): Promise<JoinRequestKind>` — it returns the kind it deleted
  rather than taking one. On the SHARED deny route the kind is not known until the row is read, so a
  `kind` parameter would either be vacuous or force the route to read the row twice.
- Produces (in `device.ts`): `resolveDeviceBinding(tx, cfg, locationId, input: { profileId; name; stationId?; registerId? }): Promise<{ stationId: string | null; tillId: string | null; formFactor: FormFactor }>` — the profile→form-factor→binding logic lifted verbatim out of `enrolDevice`, including the register auto-creation for a `till` form factor.

- [ ] **Step 1: Lift the binding logic out of `enrolDevice`**

In `apps/server/src/device.ts`, replace `enrolDevice` (`:355-435`) with an exported
`resolveDeviceBinding` carrying its steps 3-4 verbatim — the `getDeviceProfile` lookup, the
`device_profile.not_found` throw, and the `switch (kindOfFormFactor(profile.formFactor))` that
requires a station for `kds_station`, auto-creates a register for `till` via the existing private
`createRegister`, and requires one for `handheld` via `requireLiveRegister`:

```ts
/**
 * Resolve which binding a device with this profile must carry, creating the register a counter till
 * owns. Lifted out of the old `enrolDevice` unchanged — the rules did not change, only who calls them:
 * accept now runs inside a `device.manage` management session rather than on an unauthenticated route,
 * which matters because this WRITES (a `till` form factor inserts a `tills` row).
 */
export async function resolveDeviceBinding(
  tx: Transaction,
  cfg: TillConfig,
  locationId: string,
  input: { profileId: string; name: string; stationId?: string | null; registerId?: string | null },
): Promise<{ stationId: string | null; tillId: string | null; formFactor: FormFactor }> {
  const profile = await getDeviceProfile(tx, cfg.tenantId, input.profileId);
  if (profile === undefined) throw new AppError("device_profile.not_found", {});
  let stationId: string | null = null;
  let tillId: string | null = null;
  switch (kindOfFormFactor(profile.formFactor)) {
    case "kds_station":
      if (input.stationId == null) throw new AppError("device.station_required", {});
      await requireLiveStation(tx, cfg, input.stationId);
      stationId = input.stationId;
      break;
    case "till":
      tillId = await createRegister(tx, cfg, locationId, input.name);
      break;
    case "handheld":
      if (input.registerId == null) throw new AppError("device.register_required", {});
      tillId = await requireLiveRegister(tx, cfg, locationId, input.registerId);
      break;
  }
  return { stationId, tillId, formFactor: profile.formFactor };
}
```

Delete `generatePairingCode` (`:160-193`), `verifyPairingCode` (`:308-328`), `readEnrolCatalogue`
(`:281-297`) and `EnrolCatalogue` (`:269-273`), `encodePairingCode`, `normalizePairingCode`,
`PAIRING_TTL_MS`, `PAIRING_CODE_BYTES` and `CROCKFORD_ALPHABET`. `tsconfig.base.json` sets
`noUnusedLocals`, so every import those verbs alone used must go with them: `devicePairingCodes`,
`createHash`, `randomBytes` and `hashSecret` (token minting lives in `join-requests.ts` now),
`listDeviceProfiles` (`:16`) and `listStations` (`:19`). Typecheck names them if any is missed. `listDeviceProfiles`, `listStations` and the `tills` read that
`readEnrolCatalogue` used are still wanted — the dashboard's accept dialog needs the same three lists,
so keep them reachable through whatever management reads already serve the devices screen (check
`GET /management-api/devices` and the device-profiles screen's client before deleting anything they
share).

- [ ] **Step 2: Write the failing tests**

Append to `apps/server/src/join-requests.test.ts`:

```ts
describe("acceptDeviceJoinRequest", () => {
  it("creates the device with the request's OWN id, so the joiner's cookie survives", async () => {
    const venue = await setupVenue();
    const profileId = await seedProfile(venue.cfg, "till");
    const { made, accepted, status } = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      const { choices } = await challengeFor(tx, venue.cfg, made.joinId);
      void choices;
      const accepted = await acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
        choice: made.verificationNumber,
        profileId,
      });
      return { made, accepted, status: await readJoinStatus(tx, venue.cfg, made.joinId, made.token) };
    });
    expect(accepted).toMatchObject({ ok: true, deviceId: made.joinId });
    expect(status).toBe("approved");
  });

  it("auto-creates the register for a till form factor, in the SAME transaction as the device", async () => {
    // … accept a `till` profile; assert a `tills` row named after the device exists and devices.till_id points at it
  });

  it("rolls the register back when the device insert fails", async () => {
    // … force the device insert to fail (e.g. a profile whose form factor demands a station, with none
    // given, after createRegister would have run — or stub the insert); assert NO orphan tills row
  });

  it("DENIES on a wrong choice, and the deny SURVIVES THE TRANSACTION", async () => {
    const venue = await setupVenue();
    const profileId = await seedProfile(venue.cfg, "till");
    // Two SEPARATE withTenant blocks on purpose. A single block that catches the rejection inside
    // itself never commits or rolls anything back, so it would pass against code that throws from
    // inside the transaction and loses the DELETE — the defect this test exists to catch.
    const made = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
    });
    const wrong = made.verificationNumber === "00" ? "01" : "00";
    const refused = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, { choice: wrong, profileId });
    });
    expect(refused).toEqual({ ok: false, reason: "mismatch" });
    // Gone AFTER the transaction committed — this is what makes one-in-three an acceptable guess rate.
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await expect(
        acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, { choice: made.verificationNumber, profileId }),
      ).rejects.toMatchObject({ code: "join_request.not_found" });
      expect(await readJoinStatus(tx, venue.cfg, made.joinId, made.token)).toBe("not_approved");
    });
  });

  it("refuses a print_agent request — a device accept cannot turn an agent's ask into a device", async () => {
    // … createJoinRequest kind: "print_agent"; acceptDeviceJoinRequest rejects join_request.not_found
  });

  it("refuses another tenant's request", async () => { /* … two venues */ });
});

describe("denyJoinRequest", () => {
  it("deletes the request, and the joiner reads not_approved", async () => { /* … */ });
  it("throws join_request.not_found for an unknown id or another tenant's", async () => { /* … */ });
  it("returns the kind it deleted, so the shared route can authorize against it", async () => { /* … */ });
});
```

Add `seedProfile(venue, formFactor)` if the suite has none — `device-api.pg.test.ts:334-345` has one
to copy.

- [ ] **Step 3: Run and watch them fail**

Run: `pnpm --filter @waitron/server test -- join-requests`
Expected: FAIL — the two verbs are not exported.

- [ ] **Step 4: Implement**

Append to `apps/server/src/join-requests.ts`:

```ts
/**
 * Approve a device's ask-to-join.
 *
 * ONE transaction: the caller's `withTenant` covers the register auto-creation, the device insert and
 * the request's deletion, so a device insert that throws rolls the register back and leaves no orphan
 * (CLAUDE.md §3). The request's id becomes the device's id, which is what lets the joiner's cookie
 * survive approval untouched.
 *
 * A WRONG CHOICE DENIES — AND THAT IS WHY THIS RETURNS RATHER THAN THROWS. `withTenant` IS the
 * transaction (`packages/db/src/tenancy.ts:15`, `db.transaction((tx) => fn(tx))`), so an `AppError`
 * thrown from here rolls the DELETE back with it and a wrong tap becomes an unlimited retry — the
 * exact opposite of the property that makes one-in-three an acceptable guess rate (design §1.2). The
 * caller commits this result and throws `device.join_mismatch` AFTER the transaction returns.
 */
export async function acceptDeviceJoinRequest(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  input: { choice: string; profileId: string; stationId?: string | null; registerId?: string | null },
): Promise<{ deviceId: string; name: string; formFactor: FormFactor }> {
  const row = await requirePending(tx, cfg, id);
  if (row.kind !== "device") throw new AppError("join_request.not_found", {});

  if (input.choice !== row.verificationNumber) {
    await tx
      .delete(joinRequests)
      .where(and(eq(joinRequests.tenantId, cfg.tenantId), eq(joinRequests.id, id)));
    return { ok: false, reason: "mismatch" };
  }

  const binding = await resolveDeviceBinding(tx, cfg, row.locationId, {
    profileId: input.profileId,
    name: row.label,
    stationId: input.stationId,
    registerId: input.registerId,
  });

  await tx.insert(devices).values({
    id: row.id,
    tenantId: cfg.tenantId,
    locationId: row.locationId,
    stationId: binding.stationId,
    tillId: binding.tillId,
    deviceProfileId: input.profileId,
    label: row.label,
    tokenHash: row.tokenHash,
    active: true,
  });
  await tx
    .delete(joinRequests)
    .where(and(eq(joinRequests.tenantId, cfg.tenantId), eq(joinRequests.id, id)));

  return { ok: true, deviceId: row.id, name: row.label, formFactor: binding.formFactor };
}

/** Refuse a request. Deleting the row is the whole of it — there is no denied state to carry, because
 * both real tables now hold only approved rows and a joiner's recovery is to knock again. */
export async function denyJoinRequest(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<JoinRequestKind> {
  const row = await requirePending(tx, cfg, id);
  await tx
    .delete(joinRequests)
    .where(and(eq(joinRequests.tenantId, cfg.tenantId), eq(joinRequests.id, id)));
  return row.kind;
}
```

Import `resolveDeviceBinding` from `./device.js` and `FormFactor` from `@waitron/layouts`.

- [ ] **Step 5: Run the tests, and un-hold the shuffle test from Task 5**

Run: `pnpm --filter @waitron/server test -- join-requests`
Expected: PASS, including Task 5's shuffle test now that `denyJoinRequest` exists.

- [ ] **Step 6: Prove deny-on-wrong by deletion, and prove the rollback trap is really there**

First remove the `delete` before the mismatch return and confirm the test FAILS. Revert.

Then change the mismatch branch to `throw new AppError("device.join_mismatch", {})` — the shape an
earlier draft of this plan had — and confirm the test **still fails**, because the throw rolls the
DELETE back out of `withTenant`. That is the trap: a wrong tap would have become an unlimited retry,
and the only reason it is visible is that this test spans transactions. Revert to the returned result.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/join-requests.ts apps/server/src/device.ts apps/server/src/join-requests.test.ts
git commit -s -m "feat(server): accept and deny a join request

Accept runs the register auto-creation, the device insert and the
request's deletion in the caller's one transaction, so a failed insert
leaves no orphan register. The request's id becomes the device's id, so
the joiner's cookie survives approval untouched. A wrong choice deletes
the request before throwing: a mistaken tap costs a fresh knock rather
than handing a guesser a second attempt, which is what makes one-in-three
acceptable. Each accept filters on kind, so a device accept cannot turn
an agent's ask into a device.

The profile/binding rules are lifted out of enrolDevice unchanged; only
the caller moved, from an unauthenticated route to a device.manage
session — which matters because they write."
```

---

### Task 6b: Migrate every enrolment fixture in `apps/server`

Ten test suites and `dev-setup` build devices through the verbs Task 6 deletes. Task 7's gate is an
UNFILTERED `pnpm --filter @waitron/server test:coverage`, so unless this lands first that task cannot
end green. This is the largest single piece of work in the slice and it is almost entirely mechanical.

**Files** (every one verified by
`grep -rln "enrolDevice\|generatePairingCode\|verifyPairingCode\|readEnrolCatalogue" apps/server`):

| File | What it does today |
| --- | --- |
| `apps/server/src/device.test.ts:18,73-115` | a whole `describe("generatePairingCode")` |
| `apps/server/src/device.pg.test.ts:17,121-310` | ~12 `enrolDevice` call sites |
| `apps/server/src/device-session.test.ts:19,96-705` | ~8 device fixtures |
| `apps/server/src/boot.test.ts:58,2401-2402` | |
| `apps/server/src/till-api.test.ts:34,294` | |
| `apps/server/src/till-api.pg.test.ts:37,280,591,1273,1490` | |
| `apps/server/src/till-api.courses.test.ts:28,224` | |
| `apps/server/src/till-api.receipt.test.ts:43,341-342` | |
| `apps/server/src/till-api.reprint.test.ts:24,171` | |
| `apps/server/src/sale-till-source.receipt.test.ts:33,196,214` | |
| `apps/server/src/errors.test.ts:179-184` | constructs `device.pairing_rate_limited` |
| `apps/server/scripts/dev-setup.ts:66,409-478` | seeds three demo devices |
| `apps/server/scripts/dev-setup.test.ts:365` | `select count(*) from device_pairing_codes` |
| `apps/server/src/promote-endpoint-e2e.test.ts:236`, `till-reroute-e2e.test.ts:109` | comments only — stale receipts naming `enrolDevice` |

- [ ] **Step 1: Write the one shared fixture the ten suites will use**

Create `apps/server/src/testing/enrol.ts` (a test-only helper, not shipped code):

```ts
/**
 * Enrol a device the way production now does — knock, then accept — in one call, so ten suites that
 * only ever wanted "a device exists" do not each re-implement the two-step flow. Deliberately NOT a
 * production verb: it bypasses the pairing window and the numeric match, which is exactly what a
 * fixture wants and exactly what a route must never do.
 */
export async function enrolDeviceForTest(
  db: Database,
  cfg: TillConfig,
  input: { name: string; profileId: string; stationId?: string; registerId?: string },
): Promise<{ deviceId: string; token: string }> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const made = await createJoinRequest(tx, cfg, { kind: "device", label: input.name });
    const accepted = await acceptDeviceJoinRequest(tx, cfg, made.joinId, {
      choice: made.verificationNumber,
      profileId: input.profileId,
      stationId: input.stationId ?? null,
      registerId: input.registerId ?? null,
    });
    /* v8 ignore next -- the fixture always passes the request's own number */
    if (!accepted.ok) throw new Error("enrolDeviceForTest: mismatch");
    return { deviceId: accepted.deviceId, token: made.token };
  });
}
```

- [ ] **Step 2: Migrate the ten suites**

Mechanically: every `enrolDevice(tx, cfg, { code, name, profileId, … })` becomes
`enrolDeviceForTest(db, cfg, { name, profileId, … })`, and every `generatePairingCode` call that only
existed to feed it is deleted. Delete `device.test.ts:73-115` outright — it tests a verb that no
longer exists. In `errors.test.ts:179-184`, swap `device.pairing_rate_limited` for
`device.join_rate_limited`.

Run each suite as you go: `pnpm --filter @waitron/server test -- <suite>`.

- [ ] **Step 3: Rewrite `dev-setup`'s three demo devices**

`dev-setup.ts:409-478` seeds a `till`, a `phone-portrait` bound to the till's auto-created register,
and a `kds` bound to the "Cocina" station, through `readEnrolCatalogue` + `generatePairingCode` +
`enrolDevice`. Rewrite it as three `enrolDeviceForTest` calls with the profiles and bindings it
already resolves — **not** through dev-mode auto-accept, which can only produce a default-profile
till and would silently drop the handheld and the kitchen display. Delete the
`select count(*) from device_pairing_codes` assertion at `dev-setup.test.ts:365`.

- [ ] **Step 4: Sweep the two comment-only receipts**

`promote-endpoint-e2e.test.ts:236` and `till-reroute-e2e.test.ts:109` both explain a hand-built
`token_hash` as "the same shape `enrolDevice` stores". The shape is unchanged — it is
`hashSecret(token)` either way — so the fix is to name what stores it now
(`acceptDeviceJoinRequest`), not to change the fixtures. Editing a file is not auditing it; a claim
naming a deleted function is exactly the stale receipt CLAUDE.md §1 is about.

- [ ] **Step 5: Run the package unfiltered**

Run: `pnpm --filter @waitron/server test:coverage && pnpm --filter @waitron/server typecheck`
Expected: PASS. This is the gate Task 7 depends on.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -s -m "test(server): migrate every enrolment fixture to join-and-accept

Ten suites and dev-setup built devices through the pairing-code verbs.
One shared fixture replaces them, doing knock-then-accept in a call, so
suites that only ever wanted 'a device exists' say that. dev-setup keeps
building all three demo devices explicitly rather than leaning on dev-mode
auto-accept, which can only produce a default-profile till and would
silently drop the handheld and the kitchen display.

Two e2e comments explained a hand-built token_hash as 'the shape
enrolDevice stores'; the shape is unchanged, so they now name what stores
it."
```

---

### Task 7: The device's two routes, and the death of the pairing code

> **Amended before execution (controller Rulings 1 and 2).** This task additionally carries, all in the
> same commit as the route swap that deletes the importing code:
>
> - `DROP TABLE "device_pairing_codes"` — a hand-written `--custom` migration, since Task 2's generated
>   one no longer emits it. Follow `0009_join_requests_grants_sql.sql`'s shape and say in the SQL
>   comment why the drop is safe (nothing references it; pre-production, no backfill — CLAUDE.md §3).
> - Deleting `devicePairingCodes` from `packages/db/src/schema/devices.ts`, from
>   `packages/db/src/index.ts`, and its `classify("device_pairing_codes", …)` row from
>   `packages/db/src/classification.ts`.
> - Deleting the `device_pairing_codes: "SID",` row from
>   `packages/fiscal-verifactu/src/privileges.expected.ts`.
> - `packages/db/src/schema/devices.test.ts` — `:8` drops it from the import; the whole
>   `device_pairing_codes` material goes (`:44`, `:122`, `:172-224`).
> - `packages/db/src/schema/devices.fk.test.ts:65` — `delete from device_pairing_codes`.
> - Building the `PairingMode` holder in `boot.ts` and passing it to `mountDeviceApi`, because this task
>   makes `DeviceApiDeps.pairingMode` required and this task's gate includes `typecheck`. Task 8 adds
>   `mountJoinApi` and the pairing-mode routes on top.
>
> Its gate therefore also runs `pnpm --filter @waitron/db test:coverage`,
> `pnpm --filter @waitron/fiscal-verifactu test -- privileges` and both root guards.

**Files:**

- Modify: `apps/server/src/device-api.ts` (`:129-166` STATUS, `:206-207` limiter, `:243-321` the enrol
  routes, `:412-422` `device-codes`)
- Delete: `apps/server/src/dev-pairing.ts`
- Modify: `apps/server/src/errors.ts` (delete the four retired codes)
- Modify: `apps/server/src/device-api.pg.test.ts`

**Interfaces:**

- Consumes: `createJoinRequest`, `readJoinStatus` (Task 4); `PairingMode` (Task 3)
- Produces: `DeviceApiDeps` gains `pairingMode: PairingMode` (required — a mount without a window
  would accept every knock, so this must not be optional)

- [ ] **Step 1: Write the failing route tests**

In `apps/server/src/device-api.pg.test.ts`, replace the enrol describes (`:409`, `:1273`) with:

```ts
describe("POST /api/device/join", () => {
  it("refuses with device.pairing_closed when the window is shut, and touches NO row", async () => {
    const venue = await setupVenue();
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, undefined, mode);
    const res = await send(app, "POST", "/api/device/join", { body: { name: "Bar till" } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("device.pairing_closed");
    const { rows } = await suite.admin.execute(sql`select count(*)::int as n from join_requests`);
    expect(rows[0]!.n).toBe(0);
    expect(mode.refusedRecently()).toBe(1);
  });

  it("mints a request, sets the cookie and returns the number when the window is open", async () => {
    const venue = await setupVenue();
    const mode = createPairingMode();
    mode.open();
    const app = mountApp(venue.cfg, undefined, mode);
    const res = await send(app, "POST", "/api/device/join", { body: { name: "Bar till" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verificationNumber).toMatch(/^\d{2}$/);
    expect(body.joinId).toMatch(/^[0-9a-f-]{36}$/);
    // The token leaves the process ONLY in the cookie, never in the body.
    expect(JSON.stringify(body)).not.toContain("token");
    expect(deviceCookieFrom(res)).toContain("waitron_device=");
  });

  it("requires a name", async () => {
    // … open window, POST with {} → 400 management.request_invalid naming `name`
  });

  it("is rate limited BEFORE the window is consulted and before any DB work", async () => {
    // … inject a pre-filled createEnrolRateLimiter({ code: "device.join_rate_limited" }); expect 429
  });
});

describe("GET /api/device/join/status", () => {
  it("is pending, then approved once accepted, on the SAME cookie", async () => {
    // … join → status pending → acceptDeviceJoinRequest directly on the db → status approved,
    //     sending the ORIGINAL cookie both times and asserting no Set-Cookie on the approved response
  });
  it("is not_approved after a deny, and for a cookie that names nothing", async () => { /* … */ });
  it("401s without a cookie", async () => { /* … */ });
});

// `device-api.pg.test.ts:1261` ALREADY has a `describe("deleted routes are gone (404)")`. Extend that
// one with these three rows rather than adding a second describe of the same name.
describe("deleted routes are gone (404)", () => {
  it.each([
    ["POST", "/api/device/enrol"],
    ["POST", "/api/device/enrol/verify"],
    ["POST", "/management-api/device-codes"],
  ])("%s %s", async (method, path) => {
    const venue = await setupVenue();
    const res = await send(mountApp(venue.cfg), method as "POST", path, { body: {} });
    expect(res.status).toBe(404);
  });
});
```

Extend `mountApp` to take the pairing mode:

```ts
function mountApp(cfg: TillConfig, enrolRateLimiter?: EnrolRateLimiter, pairingMode = createPairingMode()): Hono {
  const app = new Hono();
  mountDeviceApi(app, { db: suite.admin, cfg, secureCookies: false, enrolRateLimiter, pairingMode }, noopLog);
  return app;
}
```

Delete `mintCode` (`:349-354`) and rewrite `enrolKds`/`enrolTill`/`enrolHandheld` (`:358-407`) to open
the window, `POST /api/device/join`, then accept through `acceptDeviceJoinRequest` on `suite.admin` —
every later describe in this file depends on those three fixtures, so they must keep returning
`{ deviceId, jar, profileId }` unchanged.

Also rewrite the `enrol rate limiter (spec §8)` describe at `:1155-1207`: it drives the deleted verify
and enrol routes, and its limiter is constructed with `device.pairing_rate_limited`. Point it at
`POST /api/device/join` with `createEnrolRateLimiter({ code: "device.join_rate_limited" })`, keeping
its controllable clock and its pre-filled-window technique.

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/server test -- device-api.pg`
Expected: FAIL — `/api/device/join` 404s.

- [ ] **Step 3: Replace the routes**

In `apps/server/src/device-api.ts`: add `pairingMode: PairingMode` to `DeviceApiDeps`; change the
limiter default at `:206-207` to `createEnrolRateLimiter({ code: "device.join_rate_limited" })`; and
replace both enrol routes with:

```ts
  // ── Knock (UNAUTHENTICATED) ────────────────────────────────────────────────────────────────────────
  app.post("/api/device/join", (c) =>
    run(c, log, async () => {
      // Rate limit, then the window, BOTH before the body is parsed and before any DB work — so a flood
      // on this unauthenticated route draws no connection from the pool and creates no row (CLAUDE.md §5,
      // nothing external may block a sale). The window is the cheaper check but runs second, so a flood
      // is refused as a flood rather than reported as a shut door.
      enrolLimiter.check();
      if (!deps.pairingMode.isOpen()) {
        deps.pairingMode.noteRefused();
        throw new AppError("device.pairing_closed", {});
      }
      const body = await readJsonBody<{ name?: unknown }>(c);
      const name = requireString(body.name, "name");
      const made = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return createJoinRequest(tx, deps.cfg, {
          kind: "device",
          label: name,
          });
      });
      // The cookie's SELECTOR is the join request's id, which accept carries onto the devices row — so
      // this cookie is set once and never re-issued. Until then it names no device, so `requireDevice`
      // finds nothing and every other device route answers `device.unauthorized`: the token is inert by
      // construction rather than by a flag. The token itself leaves the process only here.
      setDeviceCookie(c, `${made.joinId}.${made.token}`, deps.secureCookies, deps.tenantDomain);
      return c.json({ joinId: made.joinId, verificationNumber: made.verificationNumber }, 200);
    }),
  );

  // ── Am I in yet? (the joiner's own cookie) ─────────────────────────────────────────────────────────
  app.get("/api/device/join/status", (c) =>
    run(c, log, async () => {
      const raw = readDeviceCookie(c);
      if (raw === null) throw new AppError("device.unauthorized", {});
      const dot = raw.indexOf(".");
      if (dot <= 0 || dot === raw.length - 1) throw new AppError("device.unauthorized", {});
      const joinId = raw.slice(0, dot);
      const token = raw.slice(dot + 1);
      if (!isUuid(joinId)) throw new AppError("device.unauthorized", {});
      const status = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return readJoinStatus(tx, deps.cfg, joinId, token);
      });
      return c.json({ status }, 200);
    }),
  );
```

Delete `POST /management-api/device-codes` (`:412-422`) and delete `apps/server/src/dev-pairing.ts`.

In the STATUS map, remove `device.pairing_invalid`, `device.pairing_expired`,
`device.pairing_rate_limited` and `device.pairing_code_unavailable`, and add:

```ts
  "device.pairing_closed": 403,
  "device.join_full": 429,
  "device.join_rate_limited": 429,
  "device.join_mismatch": 400,
  "join_request.not_found": 404,
```

- [ ] **Step 4: Retire the four error codes**

Delete `device.pairing_invalid` (`errors.ts:962`), `device.pairing_expired` (`:974`),
`device.pairing_rate_limited` (`:1011`) and `device.pairing_code_unavailable` (`:1034`) with their doc
blocks. Codes are never renamed once shipped (CLAUDE.md §3) — nothing here is shipped, no client
outside this repository has seen them, and the commit says so, exactly as the print-agent design
retires its `agent.pairing_*` family. Check `EnrolRateLimiterOptions`' `code` union in
`enrol-rate-limit.ts:48-66` and swap `"device.pairing_rate_limited"` for `"device.join_rate_limited"`.

- [ ] **Step 5: Run the package**

Run: `pnpm --filter @waitron/server test:coverage && pnpm --filter @waitron/server typecheck`
Expected: PASS. **Run the package unfiltered, not `test -- device-api`** — a name-filtered run does not
load the boot suites or the error-code reachability guard, and this task changes a wire body several
suites pin (CLAUDE.md §2).

- [ ] **Step 6: Prove the window is real by deletion**

Delete the `if (!deps.pairingMode.isOpen())` block and confirm the first join test FAILS. Revert.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src
git rm apps/server/src/dev-pairing.ts
git commit -s -m "feat(server): the device knocks; the pairing code is gone

Two routes replace three. The knock is rate-limited and window-checked
before the body is parsed and before any DB work, so a flood creates no
row and draws no connection. The cookie's selector is the join request's
id, which accept carries onto the devices row, so it is set once and never
re-issued — and until accept it names no device, which makes the token
inert by construction rather than by a flag.

The four device.pairing_* codes go with their routes: nothing is shipped
and no client outside this repository has seen them."
```

---

### Task 8: The shared mechanism routes and the pairing-mode control

**Files:**

- Create: `apps/server/src/join-api.ts`
- Create: `apps/server/src/join-api.pg.test.ts`
- Modify: `apps/server/src/boot.ts:1391-1420` (build one holder, pass it to both mounts, mount join-api)

**Interfaces:**

- Produces: `mountJoinApi(app: Hono, deps: { db: Database; cfg: TillConfig; pairingMode: PairingMode }, log: Logger): void`

Everything that is the mechanism is shared; the only per-surface route is accept, because that is the
one step where the surfaces differ in what an approved request becomes. List, challenge and deny take
their permission from the row's `kind`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/join-api.pg.test.ts` covering:

```ts
// pairing mode
it("GET /management-api/pairing-mode reports shut, with the refused count", …)
it("POST opens it and returns openUntil; a second POST extends rather than stacking", …)
it("DELETE closes it", …)
it("all three need device.manage — a staff session is 403", …)

// the shared routes
it("GET /management-api/join-requests?kind=device lists only device rows, and NO number", …)
it("GET …?kind=print_agent needs printer.manage, not device.manage", …)
it("GET …/:id/challenge returns three numbers, one of them the request's", …)
it("challenge on another tenant's request is 404", …)
it("POST …/:id/deny deletes it; a second deny is 404", …)
it("a caller with NEITHER permission gets 403 for a live id AND for an unknown one", …)
it("a wrong choice is 400 AND the request is gone when a FRESH request re-reads it", …)
  // the route-level proof of the rollback trap: the verb test spans transactions, this spans requests

// the device accept
it("POST /management-api/device-join-requests/:id/accept with the right number enrols the device", …)
it("… with a wrong number is 400 device.join_mismatch AND the request is gone", …)
it("… on a print_agent request is 404", …)
it("… needs device.manage", …)
it("a till profile auto-creates its register; a kds profile without a station is 400", …)
```

Use the manager/staff cookies `setupVenue()` already mints, and drive the window through the injected
`PairingMode` rather than by sleeping.

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/server test -- join-api`
Expected: FAIL — no such module.

- [ ] **Step 3: Implement `join-api.ts`**

```ts
import "./errors.js";
// … Hono, drizzle, @waitron/db, @waitron/identity, server-kit imports as device-api.ts has them

const STATUS: Record<string, ContentfulStatusCode> = {
  "join_request.not_found": 404,
  "device.join_mismatch": 400,
  "device.station_required": 400,
  "device.register_required": 400,
  "device.register_name_taken": 409,
  "device.binding_invalid": 400,
  "device_profile.not_found": 404,
  "station.not_found": 404,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
};
const run = createErrorBoundary(STATUS, "join.failed");

/** Which permission a kind's rows are gated on. The shared routes read this rather than hard-coding
 * `device.manage`, so a `printer.manage` holder can work their own pending list and nobody else's. */
const PERMISSION_FOR: Record<JoinRequestKind, Permission> = {
  device: "device.manage",
  print_agent: "printer.manage",
};

export function mountJoinApi(app: Hono, deps: JoinApiDeps, log: Logger): void {
  const gated = <T>(sessionId: string, permission: Permission, fn: (tx: Transaction) => Promise<T>) =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, { managementSessionId: sessionId, permission });
      return fn(tx);
    });

  /**
   * The shared by-id routes need the permission the ROW's kind demands, which is not known until the
   * row is read — so `gated` cannot take it up front. The shape, exactly:
   *
   *   1. inside `withTenant` + `asAppUser`, read the row (tenant-scoped);
   *   2. `authorizeManager` for `PERMISSION_FOR[row.kind]`;
   *   3. act.
   *
   * A caller holding neither permission gets 403 whether or not the row exists — step 2 runs before
   * anything is disclosed, and a MISSING row must also answer 403 rather than 404, or the status code
   * itself tells an unauthorised caller which ids are live. So: read the row; if it is missing, still
   * authorize (against `device.manage`, the stricter reading) and only then answer
   * `join_request.not_found`.
   */
  // … GET /management-api/pairing-mode      → { open, openUntil, refusedRecently }   (device.manage)
  // … POST /management-api/pairing-mode     → { openUntil }                          (device.manage)
  // … DELETE /management-api/pairing-mode   → 204                                    (device.manage)
  // … GET /management-api/join-requests?kind=…            → listPendingJoinRequests
  // … GET /management-api/join-requests/:id/challenge     → challengeFor
  // … POST /management-api/join-requests/:id/deny         → denyJoinRequest
  // … POST /management-api/device-join-requests/:id/accept→ acceptDeviceJoinRequest, device.manage,
  //       body { choice, profileId, stationId?, registerId? } screened with requireString /
  //       requireBodyUuid / the optionalUuid helper device-api.ts already has (lift it into
  //       server-kit's request-screens if both files want it rather than copying it).
  //
  // THE ACCEPT ROUTE THROWS THE MISMATCH AFTER THE TRANSACTION, NOT INSIDE IT:
  //
  //   const result = await gated(sessionId, "device.manage", (tx) =>
  //     acceptDeviceJoinRequest(tx, deps.cfg, id, body),
  //   );
  //   if (!result.ok) throw new AppError("device.join_mismatch", {});
  //   return c.json({ deviceId: result.deviceId, name: result.name, formFactor: result.formFactor }, 200);
  //
  // `withTenant` IS the transaction (`packages/db/src/tenancy.ts:15`), so throwing from inside it
  // would roll back the deny the verb just wrote and turn a wrong tap into an unlimited retry.
}
```

Write each route out in full following `device-api.ts`'s management routes as the model: `run(c, log,
…)`, `requireManagementSession(c)`, `gated(...)`, and a `c.json(..., status)`.

`GET /management-api/pairing-mode` is gated on `device.manage` alone, not on either permission:
`device.manage` and `printer.manage` are held by exactly the same roles today
(`packages/identity/src/permissions.ts:112-113` put both in `MANAGER`, and `admin` holds `ALL`), so a
single gate excludes nobody who could otherwise open one of two windows. Put that sentence in the
route's comment — it is the kind of claim that goes stale silently if the role map ever changes.

- [ ] **Step 4: Wire it in `boot.ts`**

At `:1391`, inside `if (!fencedOrMirror) {`, before the device mount:

```ts
    // ONE window for the venue: the device and print surfaces share this holder, so "venue-wide" is a
    // property of the wiring rather than a rule (design §1.1). In memory, so a restart or a promotion
    // starts shut.
    const pairingMode = createPairingMode();
```

then pass `pairingMode` into `mountDeviceApi`'s deps, add `mountJoinApi(app, { db, cfg: till, pairingMode }, log)`,
and leave `mountPrintApi` alone — the agent slice adds it there.

- [ ] **Step 5: Run the package unfiltered**

Run: `pnpm --filter @waitron/server test:coverage && pnpm --filter @waitron/server typecheck && pnpm format:check`
Expected: PASS, including the boot suites.

- [ ] **Step 6: Prove the kind gate by deletion**

Delete the `row.kind !== "device"` check in `acceptDeviceJoinRequest` and confirm the "refuses a
print_agent request" test FAILS. Revert. That check is what stops a `device.manage` holder turning an
agent's ask into a device.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src
git commit -s -m "feat(server): shared join-request routes and the pairing-mode control

List, challenge and deny are the mechanism and are shared, taking their
permission from the row's kind; accept is per-surface because it is the
one step where the surfaces differ in what an approved request becomes.
boot builds one window holder and hands it to the device mount, so
venue-wide is a property of the wiring rather than a rule.

Pairing mode is gated on device.manage alone: it and printer.manage are
held by the same roles today (permissions.ts, both in MANAGER; admin holds
ALL), so one gate excludes nobody."
```

---

### Task 9: The dashboard — the window, the pending list, the numeric match

**Files:**

- Modify: `apps/dashboard/src/api/client.ts` (seven verbs; `createDeviceCode` at `:1757` deleted, with
  its doc block `:1751-1756`)
- Modify: `apps/dashboard/src/api/client.test.ts:1623-1650` — the two tests for that verb
- Modify: `apps/dashboard/src/screens/devices-screen.ts` (`:193` the armed-revoke state is the confirm
  idiom to reuse; the generate-code panel is replaced)
- Modify: `apps/dashboard/src/i18n/strings.ts` (`en` at `:158-171`, `es` at `:598+`)
- Modify: `apps/dashboard/src/screens/devices-screen.test.ts`, `devices-screen.a11y.test.ts`

**Interfaces:**

- Produces on `DashboardApi`: `pairingMode()`, `openPairingMode()`, `closePairingMode()`,
  `joinRequests(kind)`, `joinChallenge(id)`, `denyJoinRequest(id)`, `acceptDeviceJoinRequest(id, input)`

- [ ] **Step 1: Add the client verbs**

Following the `#request` shape at `apps/dashboard/src/api/client.ts:1169`:

```ts
  /** The venue-wide pairing window (design §1.1). `refusedRecently` is how many knocks were turned away
   * while it was shut — an in-memory count on the primary, never rows, so it resets on a restart. */
  pairingMode(): Promise<{ open: boolean; openUntil: string | null; refusedRecently: number }> {
    return this.#request("/management-api/pairing-mode", "GET");
  }
  openPairingMode(): Promise<{ openUntil: string }> {
    return this.#request("/management-api/pairing-mode", "POST");
  }
  closePairingMode(): Promise<void> {
    return this.#request<void>("/management-api/pairing-mode", "DELETE");
  }
  /** Pending joins of one kind. The rows deliberately carry NO verification number — the list must not
   * show the answer beside the question (design §1.2). */
  joinRequests(kind: "device" | "print_agent"): Promise<JoinRequestRow[]> {
    return this.#request(`/management-api/join-requests?kind=${kind}`, "GET");
  }
  /** Three numbers, shuffled, one of them this request's. The server does not say which. */
  joinChallenge(id: string): Promise<{ choices: string[] }> {
    return this.#request(`/management-api/join-requests/${id}/challenge`, "GET");
  }
  denyJoinRequest(id: string): Promise<void> {
    return this.#request<void>(`/management-api/join-requests/${id}/deny`, "POST");
  }
  /** A wrong `choice` DENIES the request — the dialog must treat `device.join_mismatch` as terminal for
   * that row and tell the operator the device has to ask again. */
  acceptDeviceJoinRequest(
    id: string,
    input: { choice: string; profileId: string; stationId?: string; registerId?: string },
  ): Promise<{ deviceId: string; name: string; formFactor: FormFactor }> {
    return this.#request(`/management-api/device-join-requests/${id}/accept`, "POST", input);
  }
```

Delete `createDeviceCode` (`client.ts:1757`) — the verb is `createDeviceCode`, not
`generateDeviceCode`, and there is no `DeviceCode` type; it returns `Promise<{ code: string }>`. Its
caller is `devices-screen.ts:274`, its doc block is `client.ts:1742` and `:1751-1756`, and it is
stubbed in both screen suites at `devices-screen.test.ts:89` and `.a11y.test.ts:93`.

The accept dialog's three pickers need profiles, stations and registers. The client ALREADY has
`listStations()` (`client.ts:1621`), `listDeviceProfiles()` (`:1797`) and the tills read (`:1004`) —
no new route is needed, which is what `readEnrolCatalogue`'s deletion in Task 6 was betting on. Those
three are gated on `till.configure` rather than `device.manage`; `MANAGER` holds both
(`packages/identity/src/permissions.ts:102-115`) so nobody is excluded today, and that sentence
belongs in a comment because it is a claim that would go stale silently if the role map changed.

- [ ] **Step 2: Write the failing screen tests**

In `devices-screen.test.ts`, following its existing mount-and-fake-fetch setup, add:

```ts
it("shows the pairing toggle shut, with the refused hint when knocks were turned away", …)
  // asserts the hint renders "2" and disappears when refusedRecently is 0

it("opens pairing mode and shows a countdown", …)

it("lists pending requests by name, and never renders the request's verification number", …)
  // Assert the absence of the SPECIFIC number the fake API knows, not "any two digits" — a blanket
  // /\d{2}/ trips on "12 minutes ago" and on the row's own id, and could never pass.

it("opening a row fetches the challenge and renders THREE number buttons", …)

it("accepting posts the tapped number with the chosen profile", …)

it("a mismatch removes the row and tells the operator the device must ask again", …)

it("deny is behind the two-step confirm, like revoke", …)
```

And in `devices-screen.a11y.test.ts`, one case asserting each number button has an accessible name
(`Number 47`, not a bare `47`), and one asserting the dialog is reachable by keyboard.

- [ ] **Step 3: Run and watch them fail**

Run: `pnpm --filter @waitron/dashboard test -- devices-screen`
Expected: FAIL.

**Before running:** the four browser packages run vitest in real headless Chromium. Check free memory
(`memory_pressure | grep free`) and the heaviest processes (`ps -axo rss,command | sort -nr | head`)
first, and do not start this beside another session's browser run or a backgrounded whole-workspace
run (CLAUDE.md §2).

- [ ] **Step 4: Implement the screen**

Replace the "Enrol a new device" panel with two panels. The pairing control:

```ts
  #renderPairingMode(): TemplateResult {
    const mode = this.pairing;
    if (mode === undefined) return html`<p class="hint">${t("devices.pairing_loading")}</p>`;
    return html`
      <wt-card data-test="pairing-mode">
        <h2>${t("devices.pairing_title")}</h2>
        <p class="hint">${t("devices.pairing_hint")}</p>
        ${
          mode.open
            ? html`
                <p data-test="pairing-open">
                  ${t("devices.pairing_open_until", { time: formatIsoMinute(mode.openUntil!) })}
                </p>
                <wt-button data-extend @click=${() => void this.#openPairing()}>
                  ${t("devices.pairing_extend")}
                </wt-button>
                <wt-button data-close variant="secondary" @click=${() => void this.#closePairing()}>
                  ${t("devices.pairing_close")}
                </wt-button>
              `
            : html`
                <wt-button data-open variant="primary" @click=${() => void this.#openPairing()}>
                  ${t("devices.pairing_open")}
                </wt-button>
                ${
                  mode.refusedRecently > 0
                    ? html`<p class="hint" data-test="pairing-refused">
                        ${t("devices.pairing_refused", { count: String(mode.refusedRecently) })}
                      </p>`
                    : nothing
                }
              `
        }
      </wt-card>
    `;
  }
```

and the accept dialog, whose three buttons are the design's whole point:

```ts
  #renderChallenge(request: JoinRequestRow): TemplateResult {
    const choices = this.challenges.get(request.id);
    if (choices === undefined) return html`<p class="hint">…</p>`;
    return html`
      <p id=${`match-${request.id}`}>${t("devices.join_match_prompt")}</p>
      <div class="choices" role="group" aria-labelledby=${`match-${request.id}`}>
        ${choices.map(
          (n) => html`
            <wt-button
              data-choice=${n}
              aria-label=${t("devices.join_choice_label", { number: n })}
              @click=${() => void this.#accept(request, n)}
            >
              ${n}
            </wt-button>
          `,
        )}
      </div>
    `;
  }
```

The accept handler sends the tapped number with the chosen profile and binding, and treats
`device.join_mismatch` as terminal for that row:

```ts
  async #accept(request: JoinRequestRow, choice: string): Promise<void> {
    const profileId = this.chosenProfile.get(request.id) ?? "";
    if (profileId === "") return;
    try {
      await this.api.acceptDeviceJoinRequest(request.id, {
        choice,
        profileId,
        ...(this.#kindOf(profileId) === "kds_station" ? { stationId: this.chosenStation.get(request.id)! } : {}),
        ...(this.#kindOf(profileId) === "handheld" ? { registerId: this.chosenRegister.get(request.id)! } : {}),
      });
      this.error = null;
    } catch (cause) {
      // A wrong number DENIED the request server-side — the row is gone and cannot be retried, so the
      // operator's next step is at the device, not here (design §1.2).
      this.error = codeOf(cause) === "device.join_mismatch" ? t("devices.join_mismatch") : codeMessage(cause);
    }
    await this.#refresh();
  }
```

Reuse the armed-confirm state at `:193` for Deny, exactly as Revoke uses it.

- [ ] **Step 5: Strings, both locales**

Add to `en` (`:171`) and the matching `es` block. Every key must exist in both — the `Record<StringKey,
string>` type on `es` (`:598`) makes a missing one a type error.

```ts
  "devices.pairing_title": "Allow new devices",
  "devices.pairing_hint": "Devices and printer agents can only ask to join while this is on.",
  "devices.pairing_open": "Allow new devices",
  "devices.pairing_open_until": "Open until {time}",
  "devices.pairing_extend": "Extend",
  "devices.pairing_close": "Close now",
  "devices.pairing_refused": "{count} tried to join in the last 10 minutes",
  "devices.pairing_loading": "Checking…",
  "devices.join_waiting_title": "Devices waiting to join",
  "devices.join_none": "Nothing waiting to join",
  "devices.join_match_prompt": "Tap the number showing on the device",
  "devices.join_choice_label": "Number {number}",
  "devices.join_mismatch": "That number did not match, so the request was refused. The device must ask again.",
  "devices.join_deny": "Deny",
  "devices.join_deny_confirm": "Confirm deny?",
```

Spanish: *"Permitir dispositivos nuevos"*, *"Los dispositivos y los agentes de impresión solo pueden
solicitar el alta mientras esto esté activado."*, *"Abierto hasta {time}"*, *"Ampliar"*, *"Cerrar
ahora"*, *"{count} intentaron darse de alta en los últimos 10 minutos"*, *"Comprobando…"*,
*"Dispositivos esperando el alta"*, *"No hay nada esperando"*, *"Pulsa el número que aparece en el
dispositivo"*, *"Número {number}"*, *"Ese número no coincide, así que se rechazó la solicitud. El
dispositivo debe solicitarlo de nuevo."*, *"Rechazar"*, *"¿Confirmar rechazo?"*. Grep the siblings
before settling the register/till wording — `devices.kind_till` is "Till" in `en` while the
device-profile picker says "Caja registradora" in `es`, and backlog item 7(b) already records that
inconsistency; do not add a third variant.

Delete `devices.generate_title` and any other string only the generate-code panel used.

- [ ] **Step 6: Run the package**

Run: `pnpm --filter @waitron/dashboard test:coverage && pnpm --filter @waitron/dashboard typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard
git commit -s -m "feat(dashboard): pairing mode, the pending list and the numeric match

The pending list carries no verification number — the challenge route is
the only thing that returns numbers, and it returns three without saying
which is real, so the admin is what gets tested rather than the page. A
wrong tap is terminal for the row: the server has already denied it, and
the copy says the device must ask again. Deny reuses Revoke's two-step
confirm.

The refused-knock hint renders inline beside the toggle; it wants the
dashboard notification surface the backlog now records."
```

---

### Task 10: The till — one screen, then a number and a wait

**Files:**

- Modify: `apps/till/src/screens/till-enrol-screen.ts` (the whole two-step component)
- Modify: `apps/till/src/api/client.ts:1429-1460` (`enrolVerify`/`enrol` → `join`/`joinStatus`)
- Modify: `apps/till/src/i18n/strings.ts` (`en` at `:169-186`, `es` at `:548+`)
- Modify: the boot front door and the dev chooser that render `<till-enrol-screen>` (find them by
  `grep -rn "till-enrol-screen" apps/till/src`) — the `code` property is gone
- Modify: `apps/till/src/screens/till-enrol-screen.test.ts`,
  `apps/till/src/screens/till-enrol-screen.a11y.test.ts:5,7` and
  `apps/till/src/screens/till-device-chooser.test.ts:5,28` — both import `type { EnrolCatalogue }`,
  which this task deletes, so `@waitron/till` will not typecheck until they are updated
- Modify: `apps/till/src/i18n/codes.ts:37-44` and `apps/till/src/i18n/codes.test.ts:46-58` — the
  user-facing messages for `device.pairing_invalid` / `device.pairing_expired`, codes Task 7 deletes.
  Replace with a `device.pairing_closed` message pointing at the dashboard toggle
- Check: `apps/till/src/till-app.test.ts:414,753` and `till-app.a11y.test.ts:45` reference the
  two-step enrol screen; confirm whether they assert on step-1 DOM before assuming they still pass

**Interfaces:**

- Consumes: `POST /api/device/join`, `GET /api/device/join/status` (Task 7)
- Produces: the same composed, bubbling `enrolled` event carrying `{ deviceId }`, so neither parent
  changes — the boot front door still re-boots on it and the dev chooser still writes the id to
  `sessionStorage`.

- [ ] **Step 1: Replace the client verbs**

```ts
  /**
   * Ask to join this venue (design §2) → `POST /api/device/join` with `{ name }`. UNAUTHENTICATED and
   * behind the enrol limiter. The server refuses with `device.pairing_closed` unless an admin has
   * pairing mode open, and otherwise sets an httpOnly cookie that names a pending REQUEST — inert until
   * an admin matches the number this returns. Nothing about the venue comes back: the device no longer
   * reads a catalogue, because the profile and binding are chosen in the dashboard's accept dialog.
   */
  join(name: string): Promise<{ joinId: string; verificationNumber: string }> {
    return this.#request("/api/device/join", "POST", { name });
  }

  /** Poll the pending cookie → `pending` | `approved` | `not_approved`. The cookie's selector is carried
   * onto the devices row at accept, so `approved` needs no new cookie. */
  joinStatus(): Promise<{ status: "pending" | "approved" | "not_approved" }> {
    return this.#request("/api/device/join/status", "GET");
  }
```

Delete `enrolVerify`, `enrol`, `EnrolCatalogue` and `DeviceEnrolResult`.

- [ ] **Step 2: Write the failing screen tests**

```ts
it("asks only for a name", …)                       // no key field, no profile picker
it("shows the two-digit number and 'waiting for approval' after joining", …)
it("polls and emits `enrolled` when the status turns approved", …)
it("shows 'not approved' with a Try again that knocks afresh", …)
it("tells the operator to ask for pairing mode when the server says pairing_closed", …)
it("stops polling when disconnected", …)            // no timer left running after teardown
```

- [ ] **Step 3: Run and watch them fail**

Run: `pnpm --filter @waitron/till test -- till-enrol-screen` (check machine headroom first, as Task 9)

- [ ] **Step 4: Rewrite the component**

Three states rather than two steps:

```ts
  /** `name` asks for a name; `waiting` shows the number and polls; `refused` offers Try again. */
  @state() private phase: "name" | "waiting" | "refused" = "name";
  @state() private name = "";
  @state() private verificationNumber = "";
  /** `device.pairing_closed` gets its OWN message — the operator has a real next step ("ask the manager
   * to switch on pairing mode"), unlike a generic refusal where they can only try again. */
  @state() private closed = false;
  @state() private busy = false;
  #poll?: ReturnType<typeof setInterval>;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // A screen torn down mid-wait must not keep a timer alive against a dead component.
    if (this.#poll !== undefined) clearInterval(this.#poll);
  }

  async #join(): Promise<void> {
    if (this.name === "" || this.busy) return;
    this.busy = true;
    this.closed = false;
    try {
      const { verificationNumber } = await this.api.join(this.name);
      if (!this.isConnected) return;
      this.verificationNumber = verificationNumber;
      this.phase = "waiting";
      this.#startPolling();
    } catch (cause) {
      this.closed = codeOf(cause) === "device.pairing_closed";
      this.failed = !this.closed;
    } finally {
      this.busy = false;
    }
  }

  #startPolling(): void {
    this.#poll = setInterval(() => void this.#tick(), 2_000);
  }

  async #tick(): Promise<void> {
    let status: string;
    try {
      ({ status } = await this.api.joinStatus());
    } catch {
      return; // a transient failure keeps waiting; the admin has not answered either way
    }
    if (!this.isConnected) return;
    if (status === "approved") {
      clearInterval(this.#poll);
      // The detail MUST still carry deviceId: `till-device-chooser.ts:130-135` destructures it and
      // calls `setDevDeviceId(deviceId)`. Under Task 4's id carry-over the join response's `joinId`
      // IS the device's id, so the screen already holds it.
      this.dispatchEvent(
        new CustomEvent("enrolled", {
          detail: { deviceId: this.joinId },
          bubbles: true,
          composed: true,
        }),
      );
    } else if (status === "not_approved") {
      clearInterval(this.#poll);
      this.phase = "refused";
    }
  }
```

The waiting view renders the number large and announced, not merely styled:

```ts
  #renderWaiting(): TemplateResult {
    return html`
      <h1 class="title">${t("device.join_waiting_title")}</h1>
      <p class="hint">${t("device.join_waiting_hint")}</p>
      <p class="number" data-number role="status" aria-label=${t("device.join_number_label", { number: this.verificationNumber })}>
        ${this.verificationNumber}
      </p>
    `;
  }
```

The `enrolled` event's detail keeps `deviceId` and loses `name`/`formFactor` — the device never learns
its profile now. Verified consumers: `till-device-chooser.ts:130-135` destructures `deviceId` only,
and the boot front door merely re-boots. If a third parent turns up reading `formFactor`, have it read
`/api/device/me` after the re-boot rather than widening this event.

Add `@state() private joinId = "";`, set from the join response.

- [ ] **Step 5: Strings, both locales**

```ts
  "device.join_name_title": "Set up this device",
  "device.join_name_hint": "Give this device a name, then ask a manager to approve it in the dashboard",
  "device.join_name_label": "Name",
  "device.join_submit": "Ask to join",
  "device.join_waiting_title": "Waiting for approval",
  "device.join_waiting_hint": "In the dashboard, tap this number to approve this device",
  "device.join_number_label": "Verification number {number}",
  "device.join_closed": "New devices are not being accepted right now. Ask a manager to switch on “Allow new devices”.",
  "device.join_refused": "This device was not approved.",
  "device.join_retry": "Try again",
```

Spanish: *"Configurar este dispositivo"*, *"Pon un nombre a este dispositivo y pide a un responsable
que lo apruebe en el panel"*, *"Nombre"*, *"Solicitar alta"*, *"Esperando aprobación"*, *"En el panel,
pulsa este número para aprobar este dispositivo"*, *"Número de verificación {number}"*, *"Ahora mismo
no se aceptan dispositivos nuevos. Pide a un responsable que active «Permitir dispositivos nuevos»."*,
*"Este dispositivo no fue aprobado."*, *"Intentar de nuevo"*.

Delete `device.enrol_key_*`, `device.describe_*`, `device.enrol_continue` and `device.enrol_failed` if
nothing else uses them — `grep -rn "device.enrol_failed" apps/till/src` first, because
`:144` and `:164`'s comments say the till and KDS enrol screens shared it.

- [ ] **Step 6: Run the package and commit**

Run: `pnpm --filter @waitron/till test:coverage && pnpm --filter @waitron/till typecheck`

```bash
git add apps/till
git commit -s -m "feat(till): one screen, a number, and a wait

The device carries a name and nothing else: there is no catalogue to read
because the profile and binding are chosen in the accept dialog, so an
unapproved device learns nothing about the venue. pairing_closed gets its
own message because the operator has a real next step; everything else
folds into 'not approved' with a Try again that knocks afresh. The poll is
cleared on teardown so a torn-down screen leaves no timer."
```

---

### Task 11: Dev mode, and the receipts the change retires

**Files:**

- Modify: `apps/server/src/device-api.ts` (the devMode branch on join)
- Modify: `docs/backlog.md:155` (the run-path line naming pairing code **DEMO**) and `:386` (which
  calls the new table `device_join_requests` — it is `join_requests`)
- Modify: `CLAUDE.md` (§6's `wa-wt reset` paragraph: "the till is then re-enrolled per browser with the
  fixed dev pairing code `DEMO`")
- Modify: `README.md:89-90` — "Enrol the till once per browser with the pairing code **DEMO**". The
  root README is format-checked and takes the normal flow (CLAUDE.md §6), so it is not a docs-only edit
- Modify: `docs/ui-review.md:12` **and** `:27` — two separate DEMO claims
- Modify: `apps/server/src/errors.ts:949`, `:1014`, `:1105-1107` — doc blocks on codes that SURVIVE
  (`device.binding_invalid` among them) but describe `device_pairing_codes` constraint names
- Modify: `apps/server/src/device-api.ts:108`, `:190`, `:195-198` — header prose describing the
  verify / enrol / device-code routes
- Modify: `packages/db/src/unique-violation.test.ts:54,58` — a `"device_pairing_codes_till_fk"` string
  fixture naming a table that no longer exists (the parser under test is unaffected; the name is a
  stale receipt)
- Modify: `packages/layouts/src/device-profile-store.ts:82-83,100,238` — three comments explaining what
  a pairing code may and may not reference

`dev-setup`'s three demo devices are Task 6b's, not this task's: dev-mode auto-accept can only produce
a default-profile till, so it cannot seed the handheld or the kitchen display.

`grep -rn -i 'pairing\|enrol\|DEMO' .github/` returns nothing relevant — a checked negative, recorded
here so nobody re-checks it, and because SP-3b's receipt sweep missed exactly that path once.

A behaviour change retires every receipt about the old behaviour, and editing a file is not auditing
it (CLAUDE.md §1). Read the whole base-to-tip range for prose that describes enrolment, not just the
lines near your hunks: `git diff origin/main...HEAD --name-only` then grep the READMEs and
`.github/instructions/waitron.instructions.md` for "pairing", "enrol" and "DEMO".

- [ ] **Step 1: Write the failing test**

In `device-api.pg.test.ts`:

```ts
describe("devMode", () => {
  it("auto-accepts a knock with the location's default profile, and the cookie works immediately", async () => {
    const venue = await setupVenue();
    const app = mountDevApp(venue.cfg, true);          // devMode, window NOT opened
    const res = await send(app, "POST", "/api/device/join", { body: { name: "Dev till" } });
    expect(res.status).toBe(200);
    const me = await send(app, "GET", "/api/device/me", { cookie: deviceCookieFrom(res) });
    expect(me.status).toBe(200);
  });

  it("outside devMode the same knock needs an open window", async () => {
    const venue = await setupVenue();
    const res = await send(mountDevApp(venue.cfg, false), "POST", "/api/device/join", { body: { name: "x" } });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Implement**

In the join handler, before the window check:

```ts
      // devMode holds the window permanently open and accepts immediately, so a fresh browser at a
      // worktree till boots straight in — the step that used to need the fixed `DEMO` code and a
      // re-enrol after every `wa-wt reset`. It runs the REAL join and accept verbs, so demo mode
      // exercises the production path rather than a second, divergent one (the defect #269 named).
      const auto = deps.devMode === true;
      if (!auto && !deps.pairingMode.isOpen()) { … }
```

and after `createJoinRequest`, when `auto`, call `acceptDeviceJoinRequest` in the same transaction with
the request's own number and a profile resolved from the venue's default: read `listDeviceProfiles` and take the `till` form
factor, throwing **`device_profile.not_found`** if the venue has none. Not `device.profile_missing` —
that code has no thrower anywhere in the tree and `device-api.ts:155` records that it was retired, and
in any case it is absent from Task 7's STATUS map, so it would fall through the error boundary to the
default status.

**A regression this introduces, deliberately.** `till-device-chooser.ts`'s dev-only "Set up a new
device" used to let the operator pick the form factor and binding; under auto-accept it always mints a
`till`, and a repeated name throws `device.register_name_taken` (409) because a till enrol
auto-creates a register named after the device. That is acceptable for a dev affordance — the three
demo devices `dev-setup` seeds still cover the other form factors, and the real flow is exercised by
the dashboard. Say so in the chooser's header comment rather than leaving the next reader to discover
it.

- [ ] **Step 3: Sweep the receipts**

`docs/backlog.md:155` — replace *"Enrol the till once per browser with pairing code **DEMO** (dev
only)."* with *"The till enrols itself on first load in dev mode — no code, no approval step."*

`CLAUDE.md` §6 — in the `wa-wt reset` paragraph, delete *"; the till is then re-enrolled per browser
with the fixed dev pairing code `DEMO`"*. Add nothing in its place: dev mode now needs no step, and a
rule about a step that does not exist is exactly the stale receipt §1 warns about.

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @waitron/server test:coverage && pnpm format:check`

```bash
git add apps/server docs/backlog.md CLAUDE.md docs/ui-review.md
git commit -s -m "feat(server): devMode auto-accepts, and DEMO is retired

A fresh browser at a worktree till boots straight in — the step that used
to need the fixed DEMO code and a re-enrol after every wa-wt reset. It
runs the real join and accept verbs rather than a second divergent path,
which was the defect #269 named about the old dev form.

Sweeps the receipts the change retires: the backlog's run path and
CLAUDE.md §6's wa-wt reset paragraph both documented the DEMO step."
```

---

### Task 12: End to end, and the gate

**Files:**

- Create: `apps/server/src/join-e2e.pg.test.ts`
- Modify: `docs/backlog.md` (mark the slice landed; the print-agent plan's banner already points here)

- [ ] **Step 1: Write the end-to-end test**

Real Postgres, the real routes, one flow per assertion:

```ts
it("open the window, knock, match the number, and the device is in", async () => {
  // 1. POST /management-api/pairing-mode as the manager
  // 2. POST /api/device/join { name: "Bar till" } → cookie + number
  // 3. GET /management-api/join-requests?kind=device → the row, and assert the payload has NO number
  // 4. GET /management-api/join-requests/:id/challenge → three numbers, one of them the device's
  // 5. POST /management-api/device-join-requests/:id/accept { choice, profileId } → 200
  // 6. GET /api/device/join/status with the ORIGINAL cookie → approved, and no Set-Cookie header
  // 7. GET /api/device/me with the same cookie → the device, with the register the accept created
});

it("a wrong number denies, and the device is told to ask again", async () => { … });

it("two tenants: A's manager can neither see, challenge, accept nor deny B's request", async () => {
  // Four separate assertions — the by-id class the till-reroute S3 receipt was paid for, and the one
  // reading missed and a two-tenant probe caught. Run as `app_user`, rolsuper = f.
});

it("a knock with the window shut writes nothing and is counted, not recorded", async () => { … });
```

- [ ] **Step 2: Run the affected packages**

```bash
pnpm --filter @waitron/db test:coverage
pnpm --filter @waitron/sync-enrolment test:coverage
pnpm --filter @waitron/fiscal-verifactu test:coverage
pnpm --filter @waitron/server test:coverage
pnpm --filter @waitron/dashboard test:coverage
pnpm --filter @waitron/till test:coverage
```

- [ ] **Step 3: The full gate**

This change touches a value more than one package asserts — the schema barrel, the error registry and
the privileges matrix — so the whole workspace runs here, not per task (CLAUDE.md §2):

```bash
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
```

Check machine headroom first (`memory_pressure | grep free`, `ps -axo rss,command | sort -nr | head`)
and scale `--workspace-concurrency` to what is free; the four browser packages launch real Chromium.

- [ ] **Step 4: Update the backlog and open the PR**

Move Track B item 7's "next slice" bullet to landed, keeping the pointer to the spec, and confirm the
print-agent plan's banner still describes what is true — its Tasks 5-8 are now unblocked, and their
"BLOCKED" wording must change to "regenerate against the amended spec; the mechanism now exists".

Then run `/finish-branch`. This diff touches auth, permissions, tenant isolation, a by-id read and a
cross-package contract, so it takes the FULL review ceremony, not the light path.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/join-e2e.pg.test.ts docs/backlog.md docs/superpowers/plans/2026-09-08-print-agent-process.md
git commit -s -m "test(server): join-and-accept end to end, and unblock the agent slice"
```

---

## Self-review

**Spec coverage.** §1.1 pairing mode → Tasks 3, 8, 9. §1.2 the numeric match, all three rules and
deny-on-wrong → Tasks 4, 5, 6, 9. §2 the device flow → Tasks 7, 10. §3 the admin flow → Tasks 8, 9;
§3.3's refused counter → Tasks 3, 8, 9. §4 data → Task 2; §4.1 the first dropped table → Task 1. §5
routes → Tasks 7, 8. §6 errors → Tasks 4, 7. §7 the print-agent amendments → out of scope by design;
Task 12 step 4 updates that plan's banner. §8 dev mode → Task 11. §9 deletions → Tasks 6, 7, 9, 10.
§10 is a statement of posture, nothing to build. §11 testing → distributed, with the by-id two-tenant
probe in Task 12. §12 sequencing → this plan is the first slice.

**Deviations from the spec, all now folded back into it** (the spec was updated in the same commit as
this revision, so plan and spec agree):

- The cookie is set once, at join: accept gives the device row the request's own id, rather than the
  status response re-issuing a cookie.
- The choice set is fixed at join and stored on the row (`decoy_numbers`), rather than re-rolled per
  challenge — a re-rolled set intersects in exactly one value, which hands the answer to any client
  holding a management session.
- The mint rule spans decoys as well as reals, in both directions, so a decoy issued now cannot become
  somebody's real number later.
- Spec §1.1's "passed to both `mountDeviceApi` and `mountPrintApi`" is deferred to the agent slice; so
  is §3.1's printers-screen copy of the toggle. This slice wires the device side only.

**Type consistency.** `JoinRequestKind` is used identically in Tasks 4, 5, 6 and 8.
`createJoinRequest` takes no error-code parameter in any task (`agent.join_full` does not exist yet).
`challengeFor(tx, cfg, id)` takes no number source, and its `{ choices: string[] }` is what Task 9's
client types. `acceptDeviceJoinRequest` returns the `AcceptResult` discriminated union in Tasks 6, 6b
and 8, and only the route turns `{ ok: false }` into `device.join_mismatch`. `denyJoinRequest` returns
the kind and takes none.

**Known soft spots for the executor.** Task 2 step 5 depends on what drizzle-kit actually emits for a
removed table — read the generated file rather than assuming. Task 6b is the largest and least
interesting task in the slice; resist doing it in the same commit as Task 6, because a mechanical
migration and a behaviour change reviewed together hide each other. The decoy budget is worth watching
if the cap ever rises: twenty pending rows reserve sixty of the hundred two-digit values.

**What a fresh-context review found in the first draft of this plan, and where it landed.** A wrong
choice was deleted-then-thrown inside `withTenant`, so the transaction rolled the deny back and a
wrong tap became an unlimited retry — the property §1.2 rests on, silently absent, with the plan's own
test passing because it never spanned a transaction (Task 6). The challenge re-rolled its decoys, so
two calls intersected in the real number (Tasks 4, 5). Eleven `apps/server` consumers of the deleted
verbs went unnamed, which no task could have ended green (Task 6b). `agent.join_full` was typed but
does not exist (Task 4). And the receipt sweep missed the root README, the till's error-code map and
three `packages/layouts` comments (Task 11).

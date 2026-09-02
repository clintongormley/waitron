# Identity-config flow-down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrol the identity **config** tables (`persons`, `webauthn_credentials`) into the existing
app-level **ordered** sync lane so they flow down to a read-only secondary the way catalogue does,
and keep the ephemeral auth tables (`sessions`, `management_sessions`, `webauthn_challenges`) **out**.
Thread `nodeId` origin attribution through the identity-config writers. After this lands a secondary
can authenticate the venue's people on failover; session re-establishment stays PIN-re-prompt v1.

**Architecture:** Enrolment = one `ENROLLED` row + one `sync_capture()` trigger per table, exactly as
the 17 already-enrolled tables (14 commercial + C1's 3 dining: floor_zones, table_service_statuses,
dining_tables) enrol. The two config tables carry **no `updated_at`**, so they use Group C's
mechanism (`mode: "watermark-upsert"`, `watermarkColumn: null`, unconditional upsert, monotonicity
from the seq cursor). Capture runs as the writing `app_user` (not `SECURITY DEFINER`); apply writes as
`app_user` under `withTenant(..., app.sync_apply='on')` — the app-level path that (unlike native
logical replication) *can* write into a FORCE-RLS table. Origin attribution rides `withTenant`'s 4th
arg (`app.node_id`), threaded from `management-api`'s `cfg.nodeId`.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL 18 (Testcontainers for RLS/replication suites),
PGlite (hermetic unit suites), Vitest, pnpm workspace.

**Spec:** docs/superpowers/specs/2026-08-16-identity-config-flow-down-design.md

## Global Constraints

- **Coverage 98/98/98/95** in every package touched (`@waitron/sync`, `apps/server` is 95/95/90/88 only for `apps/till`/`packages/ui` — `apps/server` is 98/98/98/95). Run `pnpm --filter <pkg> test:coverage`, not `test` (CLAUDE.md §2).
- **Real Postgres for anything about RLS / the non-superuser app role / capture-under-FORCE-RLS / apply.** PGlite connects as superuser and bypasses FORCE RLS — a false pass (CLAUDE.md §4). Set `TESTCONTAINERS_RYUK_DISABLED=true` locally or container suites hang at 180s.
- **Single-writer-per-row:** identity config is authored on the PRIMARY only; the null-watermark unconditional upsert is correct *because* there is one origin (spec §4). Do not add a DB-enforced secondary write-block (no `nodes.role` exists — owner-review flag).
- **Error-code naming:** reuse existing `sync.*` codes; introduce none. `identity` is a GENERIC_PACKAGE (english-only guard applies to `packages/identity/src`); both new table names are English `[a-z_]+`.
- **No backwards-compat / data-migration code** (CLAUDE.md §3 — nothing deployed).
- **Prove every guard by deletion** (remove the check → test fails → restore). Prove the replicate/exclude boundary by a real-PG measurement where the two answers differ (person write → 1 sync_log row; session write → 0).
- **Owner-review guardrail:** if the work drifts into the fiscal core, or begins writing `totp_secret`, or adds a `nodes.role` gate — leave the PR `needs-owner-review` and do NOT land (spec §9).
- **Every commit `-s`.** Run the gate (`pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`) plus `pnpm --filter @waitron/sync test:coverage` and `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` before the PR.

---

## Task 1 — Enrol the two config tables in the registry (unit; red→green)

**Files:**
- `packages/sync/src/registry.test.ts` (edit — failing test first)
- `packages/sync/src/registry.ts` (edit — impl)

**Interfaces:**
- Consumes: nothing new.
- Produces: two new `EnrolledTable` rows in `ENROLLED`; `tablesForLane("ordered")` now returns 17 tables (15 today + the 2 new).

**Steps:**

- [ ] **1.1 (failing test)** In `registry.test.ts`, add the two rows to the `SPEC` map (after `working_order_lines`):

```ts
  // Identity CONFIG flow-down (spec §3): mutable, NO watermark column → Group C mechanism
  // (watermark-upsert with null watermark; monotonicity from the seq cursor under single-writer).
  // persons holds no DELETE grant (suspended, never removed — 0001_identity_rls.sql), so insert+update
  // only; webauthn_credentials holds DELETE (a passkey is revoked — 0008_silent_mauler.sql), so it
  // captures the delete too (revocation MUST propagate to the secondary).
  persons: {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    lane: "ordered",
  },
  webauthn_credentials: {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    lane: "ordered",
  },
```

- [ ] **1.2 (failing test)** Update the counts and partition in `registry.test.ts`. (Counts corrected
  for the current post-C1 baseline: 17 enrolled today → 19 after this slice; ordered 15 → 17. The plan
  was drafted pre-C1 against a 14→16 baseline — the numbers below are the live ones.)
  - `it("has exactly seventeen rows, no duplicates")` → rename to `nineteen`; `expect(ENROLLED).toHaveLength(19)` and `expect(byName.size).toBe(19)`.
  - The `describe("ENROLLED carries exactly spec §2's fourteen tables plus the C1 slice's three (seventeen)")` title → append `plus §3's two identity-config (nineteen)`.
  - In the fast/ordered partition `describe`: `tablesForLane("ordered")).toHaveLength(15)` → `17`; the "remaining fifteen" title/comment → "remaining seventeen".

- [ ] **1.3 (failing test)** Relax the group invariant in `describe("captureOps match each table's group")`, else-branch:

```ts
      } else {
        // Group C / identity CONFIG: mutable, no watermark. Always captures insert+update; captures
        // delete IFF the table holds the DELETE grant (working_orders/working_order_lines/
        // webauthn_credentials do; persons does NOT — it is suspended, never removed). spec §3.
        expect(entry.captureOps.slice(0, 2)).toEqual(["insert", "update"]);
        const tail = entry.captureOps.slice(2);
        expect(tail.length === 0 || (tail.length === 1 && tail[0] === "delete")).toBe(true);
      }
```

- [ ] **1.4 (failing test)** Add the identity FK edge to the `PARENT_CHILD` array in the fkRank `describe`:

```ts
    ["persons", "webauthn_credentials"],
```

- [ ] **1.5 (run → fail)** `pnpm --filter @waitron/sync test registry` — the SPEC/ENROLLED set-equality and count assertions fail (registry.ts still has 14).

- [ ] **1.6 (minimal impl)** In `registry.ts`, append a "Group D — identity CONFIG" block after `working_order_lines`:

```ts
  // Group D — identity CONFIG flowing DOWN to a read-only secondary (spec §3). Mutable, NO watermark
  // column (persons/webauthn_credentials carry no updated_at), so — like Group C — the upsert is
  // UNCONDITIONAL and monotonicity rests on the seq cursor under the single-writer-per-row invariant
  // (identity config is authored on the PRIMARY only). persons holds no DELETE grant (a person is
  // suspended, never removed — packages/identity/drizzle/0001_identity_rls.sql:16-20), so it captures
  // insert+update only; webauthn_credentials holds DELETE (a passkey is revoked outright —
  // 0008_silent_mauler.sql), so its revocation MUST propagate and it captures insert+update+delete.
  // Both ride the ORDERED lane (config, not the payments fast lane). fkRank: persons is a root (FK
  // only to tenants, unenrolled) = 0; webauthn_credentials FKs persons = 1.
  {
    table: "persons",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  },
  {
    table: "webauthn_credentials",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    fkRank: 1,
    lane: "ordered",
  },
```

  Also update the module-header comment (line 1, currently "seventeen") and the `fkRank levels` comment block to say "nineteen … seventeen (14 commercial + 3 C1 dining) + two identity-config" and add `persons`/`webauthn_credentials` to the level-0/level-1 lists.

- [ ] **1.7 (run → pass)** `pnpm --filter @waitron/sync test registry` — green.
- [ ] **1.8 (commit)** `git commit -s -m "feat(sync): enrol identity config tables (persons, webauthn_credentials) in the ordered lane registry"`

---

## Task 2 — Register the Drizzle schema objects for apply + add the identity dep (unit; red→green)

**Files:**
- `packages/sync/package.json` (edit — add `@waitron/identity` dependency)
- `packages/sync/src/apply-sql.ts` (edit — impl)
- `packages/sync/src/apply-sql.test.ts` (edit — failing test first)

**Interfaces:**
- Consumes: `persons`, `webauthnCredentials` from `@waitron/identity` (the package barrel exports both — `@waitron/identity` index.ts:24-27).
- Produces: `SYNC_SCHEMA_TABLES.persons`, `SYNC_SCHEMA_TABLES.webauthn_credentials`; `applyStatementFor(persons)` is an **unconditional** upsert (null watermark → no `WHERE`); `deleteStatementFor(webauthn_credentials)` builds `delete … where id = ($1->>'id')::uuid`.

**Steps:**

- [ ] **2.1 (failing test)** Add a focused block to `apply-sql.test.ts` (the existing
  `describe("SYNC_SCHEMA_TABLES covers every enrolled table …")` loop already iterates `ENROLLED`, so
  after Task 1 it will fail for `persons`/`webauthn_credentials` — but add explicit assertions that
  pin the statement SHAPE, since those are the load-bearing correctness facts):

```ts
describe("identity config tables apply as unconditional Group-C upserts (spec §3)", () => {
  const persons = ENROLLED.find((e) => e.table === "persons")!;
  const creds = ENROLLED.find((e) => e.table === "webauthn_credentials")!;

  it("persons is registered and its upsert is UNCONDITIONAL (no watermark WHERE)", () => {
    expect(SYNC_SCHEMA_TABLES.persons).toBeDefined();
    const stmt = applyStatementFor(persons);
    expect(stmt).toContain("on conflict (id) do update set");
    expect(stmt).not.toContain("where"); // null watermark → unconditional; monotonicity via seq cursor
    // A person is mutable config: pin_hash/password_hash/role/status must all be in the SET list.
    expect(stmt).toContain("pin_hash = excluded.pin_hash");
    expect(stmt).toContain("role = excluded.role");
  });

  it("webauthn_credentials is registered and builds a Group-C delete", () => {
    expect(SYNC_SCHEMA_TABLES.webauthn_credentials).toBeDefined();
    expect(deleteStatementFor(creds)).toBe(
      "delete from webauthn_credentials where id = ($1->>'id')::uuid",
    );
  });
});
```

- [ ] **2.2 (run → fail)** `pnpm --filter @waitron/sync test apply-sql` — `SYNC_SCHEMA_TABLES.persons` is `undefined`; `applyStatementFor(persons)` throws (`no drizzle schema object registered`).

- [ ] **2.3 (minimal impl — dep)** In `packages/sync/package.json`, add to `dependencies`:

```json
    "@waitron/identity": "workspace:*",
```

  Run `pnpm install` at the repo root and commit the updated `pnpm-lock.yaml` (CLAUDE.md §2 — a moved/added dep fails CI's `--frozen-lockfile`).

- [ ] **2.4 (minimal impl — schema map)** In `apply-sql.ts`, add the import. Deep-import the schema
  objects (mirroring how the file already deep-imports the payments schema), NOT the `@waitron/identity`
  barrel: the barrel (`index.ts`) pulls in the whole auth runtime (`@simplewebauthn/server`, login,
  passkey) which the apply hot path does not need. `@waitron/identity` declares no `exports` map, so a
  subpath import resolves exactly as `@waitron/payments/src/schema/index.js` does; `schema/index.ts`
  exports both objects (`persons`, `webauthnCredentials`):

```ts
// Deep import into @waitron/identity: its schema table objects are exported from ./schema/index.js.
// The package declares no `exports` map, so a subpath import resolves (same as @waitron/payments's
// schema, above). Deliberately NOT the package barrel — that loads identity's auth runtime
// (@simplewebauthn/server, login, passkey) the apply path never uses.
import { persons, webauthnCredentials } from "@waitron/identity/src/schema/index.js";
```

  and add the two entries to `SYNC_SCHEMA_TABLES`:

```ts
  persons,
  webauthn_credentials: webauthnCredentials,
```

  Update the header comment (currently "Covers all seventeen") → "Covers all nineteen".

- [ ] **2.5 (run → pass)** `pnpm --filter @waitron/sync test apply-sql` and `pnpm --filter @waitron/sync typecheck` — green.
- [ ] **2.6 (commit)** `git commit -s -m "feat(sync): register persons + webauthn_credentials drizzle objects for apply, depend on @waitron/identity"`

---

## Task 3 — Capture-trigger migration + the replicate/exclude BOUNDARY test (real-PG; red→green)

This is the **acceptance test**: it proves both directions (config captures, ephemeral does NOT) and
proves the trigger by deletion. Mirrors `packages/sync/src/capture.gate.test.ts` exactly (real
Postgres, the `app_login` non-superuser probe role, the full migration manifest with `sync` last).

**Files:**
- `packages/sync/src/capture-identity.gate.test.ts` (new — failing test first)
- `packages/sync/drizzle/0007_sync_identity_capture.sql` (new — impl)  ← NOTE: 0007, not 0003 (plan drafted pre-0003..0006; highest existing sync migration is now 0006_enrol_table_service, idx 6)
- `packages/sync/drizzle/meta/_journal.json` (edit — impl)
- `packages/sync/drizzle/meta/0007_snapshot.json` (new — impl)

**Interfaces:**
- Consumes: the migration manifest (`manifestSets`), the `app_login` probe role, `withTenant`.
- Produces: `persons_capture` (AFTER INSERT OR UPDATE) and `webauthn_credentials_capture` (AFTER INSERT OR UPDATE OR DELETE) triggers, both echo-guarded on `app.sync_apply`.

**Steps:**

- [ ] **3.1 (failing test)** Create `capture-identity.gate.test.ts`. Copy the `useRealPostgres` +
  `withTenantNode` scaffolding from `capture.gate.test.ts` (same `probeRole: { name: "app_login",
  password: "app_pw", inRole: "app_user" }`, same `NODE_A`/`ZERO` constants, same
  `startMigratedPostgres` + `runMigrationSets` migrate). Add a seed helper that inserts a tenant plus,
  where a test needs them, a person and a till (as the superuser admin — setup, RLS bypassed):

```ts
async function seedTenantPersonTill(admin: Database): Promise<{
  tenantId: string; personId: string; locationId: string; tillId: string;
}> {
  const tenantId = await seedTenant(admin);
  const loc = await admin.execute<{ id: string }>(
    sql`insert into locations (tenant_id, name, invoice_locales, operation_description)
        values (${tenantId}, 'Location', array['en']::text[], 'Hospitality') returning id`,
  );
  const locationId = loc.rows[0]!.id;
  const till = await admin.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Till') returning id`,
  );
  const person = await admin.execute<{ id: string }>(
    sql`insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'Ada', 'hash', 'staff') returning id`,
  );
  return { tenantId, personId: person.rows[0]!.id, locationId, tillId: till.rows[0]!.id };
}

async function syncCount(tenantId: string, table: string): Promise<string> {
  const r = await postgres.admin.execute<{ n: string }>(
    sql`select count(*)::text as n from sync_log where table_name = ${table} and tenant_id = ${tenantId}`,
  );
  return r.rows[0]!.n;
}
```

  Then the assertions (each with a failing-case comment, per CLAUDE.md §1):

```ts
describe("identity CONFIG tables capture; ephemeral auth tables do NOT (spec §2)", () => {
  it("a persons INSERT and UPDATE by the app role capture, with origin = app.node_id", async () => {
    // Failing case: no persons_capture trigger, so a person write leaves ZERO sync_log rows and the
    // secondary can never learn of the account. Control: the write lands exactly one insert row
    // carrying NODE_A, and an UPDATE lands one more op='update' row.
    const tenantId = await seedTenant(postgres.admin);
    const probe = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      const ins = await withTenantNode(probe, tenantId, NODE_A, (tx) =>
        tx.execute<{ id: string }>(
          sql`insert into persons (tenant_id, display_name, pin_hash, role)
              values (${tenantId}, 'Ada', 'hash', 'staff') returning id`,
        ),
      );
      const personId = ins.rows[0]!.id;
      await withTenantNode(probe, tenantId, NODE_A, (tx) =>
        tx.execute(sql`update persons set role = 'manager' where id = ${personId}`),
      );
      const rows = await postgres.admin.execute<{ op: string; origin: string }>(sql`
        select op, origin_id::text as origin from sync_log
        where table_name = 'persons' and tenant_id = ${tenantId} order by seq asc`);
      expect(rows.rows.map((r) => r.op)).toEqual(["insert", "update"]);
      expect(rows.rows.every((r) => r.origin === NODE_A)).toBe(true);
    } finally {
      await probe.close();
    }
  });

  it("a webauthn_credentials DELETE captures as op='delete' carrying to_jsonb(OLD)", async () => {
    // Failing case: no webauthn_credentials_capture, so a revoked passkey's DELETE never reaches the
    // secondary and the credential stays valid there. Control: exactly one op='delete' row with the id.
    const { tenantId, personId } = await seedTenantPersonTill(postgres.admin);
    const probe = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      const cred = await withTenantNode(probe, tenantId, NODE_A, (tx) =>
        tx.execute<{ id: string }>(
          sql`insert into webauthn_credentials (tenant_id, person_id, credential_id, public_key)
              values (${tenantId}, ${personId}, 'cred-1', 'pk-1') returning id`,
        ),
      );
      const credId = cred.rows[0]!.id;
      await withTenantNode(probe, tenantId, NODE_A, (tx) =>
        tx.execute(sql`delete from webauthn_credentials where id = ${credId}`),
      );
      const del = await postgres.admin.execute<{ id: string }>(sql`
        select row_image->>'id' as id from sync_log
        where table_name = 'webauthn_credentials' and op = 'delete' and tenant_id = ${tenantId}`);
      expect(del.rows).toHaveLength(1);
      expect(del.rows[0]!.id).toBe(credId);
    } finally {
      await probe.close();
    }
  });

  it("sessions, management_sessions and webauthn_challenges do NOT capture (the exclusion)", async () => {
    // The 'sessions must NOT replicate' guarantee (spec §2), as a measurement where the two answers
    // DIFFER (CLAUDE.md §1): a persons write captures (1) while each ephemeral write captures nothing (0).
    const { tenantId, personId, tillId } = await seedTenantPersonTill(postgres.admin);
    const probe = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`insert into sessions (tenant_id, person_id, till_id)
                       values (${tenantId}, ${personId}, ${tillId})`),
      );
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`insert into management_sessions (tenant_id, person_id)
                       values (${tenantId}, ${personId})`),
      );
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`insert into webauthn_challenges (tenant_id, person_id, challenge)
                       values (${tenantId}, ${personId}, 'chal-1')`),
      );
      // Control (the other direction): a persons write DOES capture, so 0 below is a real exclusion.
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`insert into persons (tenant_id, display_name, pin_hash, role)
                       values (${tenantId}, 'Grace', 'hash', 'staff')`),
      );
      expect(await syncCount(tenantId, "sessions")).toBe("0");
      expect(await syncCount(tenantId, "management_sessions")).toBe("0");
      expect(await syncCount(tenantId, "webauthn_challenges")).toBe("0");
      expect(await syncCount(tenantId, "persons")).toBe("1"); // the control captured
    } finally {
      await probe.close();
    }
  });

  it("suppresses the echo under app.sync_apply='on', re-captures once the WHEN clause is removed", async () => {
    // Prove the WHEN clause is the mechanism, by DELETION (CLAUDE.md §1). Mirrors capture.gate.test.ts.
    const tenantId = await seedTenant(postgres.admin);
    const probe = await postgres.pg.connectAs("app_login", "app_pw");
    async function applyStyleInsert(name: string): Promise<void> {
      await probe.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        await tx.execute(sql`select set_config('app.sync_apply', 'on', true)`);
        await tx.execute(sql`insert into persons (tenant_id, display_name, pin_hash, role)
                             values (${tenantId}, ${name}, 'hash', 'staff')`);
      });
    }
    try {
      await applyStyleInsert("Echo");
      expect(await syncCount(tenantId, "persons")).toBe("0"); // suppressed
      await postgres.admin.execute(sql.raw(`drop trigger persons_capture on persons`));
      await postgres.admin.execute(sql.raw(
        `create trigger persons_capture after insert or update on persons
           for each row execute function sync_capture()`));
      try {
        await applyStyleInsert("NoGuard");
        expect(await syncCount(tenantId, "persons")).toBe("1"); // no WHEN → echo captured
      } finally {
        await postgres.admin.execute(sql.raw(`drop trigger persons_capture on persons`));
        await postgres.admin.execute(sql.raw(
          `create trigger persons_capture after insert or update on persons
             for each row when (current_setting('app.sync_apply', true) is distinct from 'on')
             execute function sync_capture()`));
      }
    } finally {
      await probe.close();
    }
  });
});
```

  (Import `withTenant` and `type Database`/`Transaction` from `@waitron/db`, and `seedTenant` from `@waitron/db/testing/seed.js`, as `capture.gate.test.ts` does.)

- [ ] **3.2 (run → fail)** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test capture-identity` — the persons/webauthn assertions fail (no triggers → 0 rows). The exclusion assertions already pass (never a trigger), which is correct — do not treat that as green.

- [ ] **3.3 (minimal impl — SQL)** Create `packages/sync/drizzle/0007_sync_identity_capture.sql`:

```sql
-- Hand-written custom migration for @waitron/sync (this package has NO drizzle.config.ts — its
-- journal + snapshots are hand-maintained and drizzle-kit never diffs it). Runs LAST in
-- migrations.manifest.json's `sync` set, AFTER the `identity` set (manifest orders identity 2nd,
-- sync last), so `persons` and `webauthn_credentials` already exist when these triggers attach.
--
-- WHAT THIS BUILDS. Identity-config flow-down (spec
-- docs/superpowers/specs/2026-08-16-identity-config-flow-down-design.md §2/§3): two capture triggers
-- enrolling the identity CONFIG tables into the commercial ORDERED outbox, reusing the existing
-- generic sync_capture() function (0000_sync_outbox.sql:126). The ephemeral auth tables — sessions,
-- management_sessions, webauthn_challenges — are DELIBERATELY not enrolled: they must NOT replicate
-- (session write-amplification + single-writer-per-row conflict + no origin column; spec §2). No grant
-- or RLS change: persons/webauthn_credentials already carry FORCE RLS + a tenant-isolation policy + the
-- app_user grants (packages/identity/drizzle/0001_identity_rls.sql, 0008_silent_mauler.sql), and
-- app_user already holds INSERT on sync_log (0000_sync_outbox.sql:62), which is the whole grant the
-- capture path needs — the trigger runs as the WRITING app role (not SECURITY DEFINER), so the sync_log
-- WITH CHECK (tenant_id = current_tenant_id()) is satisfied by construction.
--
-- The WHEN clause reads app.sync_apply so a replicated write is NOT re-captured (no A->B->A echo loop;
-- 0000_sync_outbox.sql:149-156). `IS DISTINCT FROM` so an unset GUC still fires the capture.

-- persons — mutable CONFIG (SELECT, INSERT, UPDATE; NO delete grant): AFTER INSERT OR UPDATE.
CREATE TRIGGER persons_capture AFTER INSERT OR UPDATE ON persons
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- webauthn_credentials — mutable + DELETABLE CONFIG (SELECT, INSERT, UPDATE, DELETE): AFTER INSERT OR
-- UPDATE OR DELETE, so a revoked passkey's DELETE propagates to the secondary (a revoked credential
-- must not stay valid on a failover target).
CREATE TRIGGER webauthn_credentials_capture AFTER INSERT OR UPDATE OR DELETE ON webauthn_credentials
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
```

- [ ] **3.4 (minimal impl — journal)** Append to `drizzle/meta/_journal.json`'s `entries` array:

```json
    {
      "idx": 7,
      "version": "7",
      "when": 1786492800007,
      "tag": "0007_sync_identity_capture",
      "breakpoints": true
    }
```

- [ ] **3.5 (minimal impl — snapshot)** Create `drizzle/meta/0007_snapshot.json` chained off `0006`'s
  `id` (an empty-tables snapshot, inert at apply time but kept for folder self-consistency — copy
  `0006_snapshot.json` verbatim, then set a fresh random `id` and set `prevId` to `0006`'s `id`
  (`52149cf9-f5e5-4c71-baac-371e46cf021d`); all of `tables`/`enums`/`policies`/etc. stay `{}`).

- [ ] **3.6 (run → pass)** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test capture-identity` — all four cases green. Also run `pnpm --filter @waitron/sync test:coverage` to confirm the whole package (unfiltered) is green (a name-filtered run misses cross-cutting suites — CLAUDE.md §2).

- [ ] **3.7 (guard: fiscal FORCE-RLS scan still green)** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — this slice adds no tenant-scoped table, so it must stay green (it already covers persons/webauthn_credentials's FORCE RLS).

- [ ] **3.8 (commit)** `git commit -s -m "feat(sync): capture persons + webauthn_credentials; prove sessions/management_sessions/webauthn_challenges stay out"`

---

## Task 4 — Apply path for identity config under FORCE RLS (real-PG; red→green)

Proves a peer's captured `persons`/`webauthn_credentials` rows apply into the local mirror as the
non-superuser app role under FORCE RLS, are seq-cursor idempotent, and are tenant-fenced. Mirrors
`packages/sync/src/apply.gate.test.ts` (the `sync_applier` role = member of `app_user` + `sync_tailer`;
the `setEnv` deployment stamp helper; `applyBatch`).

**Files:**
- `packages/sync/src/apply.gate.test.ts` (edit — add an identity `describe`)

**Interfaces:**
- Consumes: `applyBatch(subscriberDb, rows, { subscriberId, localEnvironment, sourceEnvironment })` (spec/apply.ts). Build a `SyncLogRow` whose `rowImage` is the verbatim `to_jsonb(row)::text`.
- Produces: assertions that apply writes a `persons` row, a `webauthn_credentials` delete, and refuses a cross-tenant row_image.

**Steps:**

- [ ] **4.1 (failing test)** Add to `apply.gate.test.ts`. Each test opens its own applier connection
  `const applier = await postgres.pg.connectAs("sync_applier", "ap")` and closes it in a `finally`,
  exactly as the file's existing tests do (apply.gate.test.ts:255/308/351) — the `applier` handle in
  the code below is that connection. Helper to mint a verbatim row_image as admin (RLS-bypassed setup),
  then delete it so apply must re-create it as `app_user` (wrap each test body in
  `try { … } finally { await applier.close(); }`):

```ts
describe("apply lands identity config under FORCE RLS (spec §3/§4)", () => {
  it("applies a persons row as app_user, seq-cursor idempotent", async () => {
    await setEnv("preproduction");
    const tenantId = await seedTenant(postgres.admin);
    // Mint the exact row_image the capture trigger would write, then remove the row so apply re-creates
    // it — proving the app-role apply writes into a FORCE-RLS table (native logical apply cannot).
    const seeded = await postgres.admin.execute<{ id: string; img: string }>(sql`
      with ins as (
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'Ada', 'hash', 'staff') returning *
      ) select id::text as id, to_jsonb(ins.*)::text as img from ins`);
    const personId = seeded.rows[0]!.id;
    const rowImage = seeded.rows[0]!.img;
    await postgres.admin.execute(sql`delete from persons where id = ${personId}`);

    const subscriberId = uuid();
    const originId = uuid();
    const row: SyncLogRow = {
      seq: 1n, originId, table: "persons", op: "insert", tenantId, rowImage,
    };
    const first = await applyBatch(applier, [row], {
      subscriberId, localEnvironment: "preproduction", sourceEnvironment: "preproduction",
    });
    expect(first.applied).toBe(1);
    const landed = await postgres.admin.execute<{ n: string }>(
      sql`select count(*)::text as n from persons where id = ${personId} and tenant_id = ${tenantId}`);
    expect(landed.rows[0]!.n).toBe("1"); // the app role wrote into the FORCE-RLS table

    // Re-deliver the SAME seq: skipped by the cursor (null-watermark idempotency rests on the seq
    // cursor, NOT ON CONFLICT — an unconditional upsert would otherwise re-run). applied = 0.
    const second = await applyBatch(applier, [row], {
      subscriberId, localEnvironment: "preproduction", sourceEnvironment: "preproduction",
    });
    expect(second.applied).toBe(0);
  });

  it("applies a webauthn_credentials delete (removes the mirror row)", async () => {
    await setEnv("preproduction");
    const tenantId = await seedTenant(postgres.admin);
    const person = await postgres.admin.execute<{ id: string }>(
      sql`insert into persons (tenant_id, display_name, pin_hash, role)
          values (${tenantId}, 'Ada', 'hash', 'staff') returning id`);
    const personId = person.rows[0]!.id;
    const cred = await postgres.admin.execute<{ id: string; img: string }>(sql`
      with ins as (
        insert into webauthn_credentials (tenant_id, person_id, credential_id, public_key)
        values (${tenantId}, ${personId}, 'cred-1', 'pk-1') returning *
      ) select id::text as id, to_jsonb(ins.*)::text as img from ins`);
    const credId = cred.rows[0]!.id;
    const subscriberId = uuid();
    const originId = uuid();
    const del = await applyBatch(
      applier,
      [{ seq: 1n, originId, table: "webauthn_credentials", op: "delete", tenantId, rowImage: cred.rows[0]!.img }],
      { subscriberId, localEnvironment: "preproduction", sourceEnvironment: "preproduction" },
    );
    expect(del.applied).toBe(1);
    const remaining = await postgres.admin.execute<{ n: string }>(
      sql`select count(*)::text as n from webauthn_credentials where id = ${credId}`);
    expect(remaining.rows[0]!.n).toBe("0");
  });

  it("refuses a persons row_image whose tenant_id differs from the batch tenant (WITH CHECK fence)", async () => {
    // The FORCE-RLS WITH CHECK holds under the app role (CLAUDE.md §4): a row claiming tenant B applied
    // under tenant A is a 42501, which propagates (not a 23503 defer) — it never lands. Mirrors
    // apply.gate.test.ts's existing cross-tenant fence test.
    await setEnv("preproduction");
    const a = await seedTenant(postgres.admin);
    const b = await seedTenant(postgres.admin);
    const seeded = await postgres.admin.execute<{ id: string; img: string }>(sql`
      with ins as (
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${b}, 'Mallory', 'hash', 'staff') returning *
      ) select id::text as id, to_jsonb(ins.*)::text as img from ins`);
    await postgres.admin.execute(sql`delete from persons where id = ${seeded.rows[0]!.id}`);
    // Claim it belongs to tenant A (the batch tenant) though the image carries tenant B.
    const row: SyncLogRow = { seq: 1n, originId: uuid(), table: "persons", op: "insert", tenantId: a, rowImage: seeded.rows[0]!.img };
    const err = await captureError(() =>
      applyBatch(applier, [row], {
        subscriberId: uuid(), localEnvironment: "preproduction", sourceEnvironment: "preproduction",
      }));
    expect(pgErrorCode(err)).toBe("42501");
  });
});
```

  (Confirm the exact accessor name the suite uses for the applier connection — `apply.gate.test.ts`
  sets up `sync_applier` in `useRealPostgres({ setup })`; reuse whatever handle the existing tests use
  to run `applyBatch` as that role. Import `captureError`, `pgErrorCode` from `@waitron/db` as the file
  already does.)

- [ ] **4.2 (run)** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test apply.gate` — green (the DISPATCH/SYNC_SCHEMA_TABLES entries from Tasks 1–2 make `persons`/`webauthn_credentials` applyable). If red because the row image round-trips wrong, debug with a logged `row_image` (CLAUDE.md — add debug logging proactively).

- [ ] **4.3 (prove-by-deletion)** Temporarily revert Task 2's `SYNC_SCHEMA_TABLES.persons` entry and confirm the persons apply test fails with `sync.table_not_enrolled` (DISPATCH miss), then restore. This proves the apply wiring is load-bearing.

- [ ] **4.4 (commit)** `git commit -s -m "test(sync): prove identity config applies under FORCE RLS, seq-idempotent, tenant-fenced"`

---

## Task 5 — Origin attribution for a persons write via `withTenant` (real-PG; red→green)

Extends `packages/sync/src/origin.gate.test.ts` to prove the production 4-arg `withTenant` reaches
`sync_log.origin_id` for a `persons` write (the raw-write half of the origin story; Task 6 proves the
real call site passes it).

**Files:**
- `packages/sync/src/origin.gate.test.ts` (edit)

**Steps:**

- [ ] **5.1 (test)** Add an `it` mirroring the existing products test, for `persons`:

```ts
  it("stamps a persons write's origin_id with the node id (4-arg), all-zero on the plain form", async () => {
    const awareT = await seedTenant(postgres.admin);
    const plainT = await seedTenant(postgres.admin);
    const probe = await postgres.pg.connectAs("app_login", "app_pw");
    const insertPerson = (t: string) =>
      sql`insert into persons (tenant_id, display_name, pin_hash, role)
          values (${t}, 'Ada', 'hash', 'staff')`;
    const originFor = async (t: string) => {
      const r = await postgres.admin.execute<{ n: string; origin: string | null }>(
        sql`select count(*)::text as n, max(origin_id::text) as origin
            from sync_log where table_name = 'persons' and tenant_id = ${t}`);
      return r.rows[0]!;
    };
    try {
      await withTenant(probe, awareT, (tx) => tx.execute(insertPerson(awareT)), { nodeId: NODE_A });
      await withTenant(probe, plainT, (tx) => tx.execute(insertPerson(plainT)));
      const aware = await originFor(awareT);
      const plain = await originFor(plainT);
      expect(aware.origin).toBe(NODE_A);
      expect(plain.origin).toBe(ZERO);
      expect(aware.origin).not.toBe(plain.origin); // the two paths visibly differ (CLAUDE.md §1)
    } finally {
      await probe.close();
    }
  });
```

- [ ] **5.2 (run → pass)** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test origin` — green (Task 3's trigger + the existing `withTenant` 4th arg make this pass; it fails before Task 3, so if you want a red-first run, author it in Task 3's window — otherwise it is a regression-lock here).
- [ ] **5.3 (commit)** `git commit -s -m "test(sync): persons write stamps sync_log.origin_id from withTenant nodeId"`

---

## Task 6 — Thread `nodeId` through the identity-config writers (server; real-PG; red→green)

The real call sites must pass `cfg.nodeId` or the enrolled writes capture the all-zero origin. Only
`management-api.ts` writes identity config (`me-api.ts` writes workforce tables only). Extends
`apps/server/src/sync-origin.rls.test.ts` (the suite that guards the commercial call sites), following
its catalogue precedent exactly.

**Files:**
- `apps/server/src/sync-origin.rls.test.ts` (edit — failing test first)
- `apps/server/src/management-api.ts` (edit — impl)
- `apps/server/src/boot.ts` (edit — impl)

**Interfaces:**
- Consumes: `ManagementApiDeps.cfg` gains `nodeId: string`.
- Produces: every identity-config `withTenant` in `management-api.ts` passes `{ nodeId: deps.cfg.nodeId }`; `boot.ts` passes `till.nodeId` at `mountManagementApi`.

**Steps:**

- [ ] **6.1 (failing test)** In `sync-origin.rls.test.ts`, add a helper that mounts the management API
  under a node id and creates a person via the manager cookie (reuse the file's existing manager-login
  helper that mints the `MANAGEMENT_COOKIE`), then reads back the captured origin:

```ts
function mountMgmt(tenantId: string, nodeId: string): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    { db: suite.admin, cfg: { tenantId, nodeId }, secureCookies: false, rpId: "localhost", origin: "http://localhost:5191" },
    noopLog,
  );
  return app;
}
async function personOrigin(tenantId: string): Promise<string | null> {
  const r = await suite.admin.execute<{ v: string | null }>(
    sql`select max(origin_id::text) as v from sync_log
        where table_name = 'persons' and tenant_id = ${tenantId}`);
  return r.rows[0]!.v;
}

it("a createPerson write captures sync_log.origin_id = cfg.nodeId (all-zero without the fix)", async () => {
  // Guard-by-deletion: with the fix, management-api threads { nodeId: cfg.nodeId } into the createPerson
  // withTenant, so the enrolled persons INSERT captures NODE_C. Revert (drop the 4th arg) and this drops
  // to ZERO. A control tenant mounted with the all-zero node id also captures ZERO — so the origin
  // tracks cfg.nodeId, not a constant (CLAUDE.md §1).
  const venue = await provisionVenue(); // the file's existing venue-provision helper
  const app = mountMgmt(venue.tenantId, NODE_C);
  const cookie = await managerCookie(app, venue); // the file's existing helper
  const res = await app.request("/management-api/staff", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ displayName: "Ada", pin: "1234", role: "staff" }),
  });
  expect(res.status).toBe(201);
  expect(await personOrigin(venue.tenantId)).toBe(NODE_C);

  const zeroVenue = await provisionVenue();
  const zeroApp = mountMgmt(zeroVenue.tenantId, ZERO);
  const zeroCookie = await managerCookie(zeroApp, zeroVenue);
  await zeroApp.request("/management-api/staff", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: zeroCookie },
    body: JSON.stringify({ displayName: "Grace", pin: "1234", role: "staff" }),
  });
  expect(await personOrigin(zeroVenue.tenantId)).toBe(ZERO);
});
```

  (Match the file's actual route path and request body to `mountManagementApi`'s create-person route
  and its existing manager-login/provision helpers — read the suite before writing so the fixture calls
  line up; the `import { mountManagementApi }` and `MANAGEMENT_COOKIE` import already exist in the file.)

- [ ] **6.2 (run → fail)** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-origin` — the type is wrong first (`cfg` has no `nodeId`), then at runtime the captured origin is `ZERO`.

- [ ] **6.3 (minimal impl — deps type)** In `management-api.ts`, change `ManagementApiDeps.cfg`:

```ts
  cfg: { tenantId: string; nodeId: string };
```

  and update the doc-comment above it to note `nodeId` is threaded into every identity-config
  `withTenant` so enrolled writes capture this node's origin (mirroring `CatalogueApiDeps`'s comment).

- [ ] **6.4 (minimal impl — thread it)** In `management-api.ts`, add `{ nodeId: deps.cfg.nodeId }` as
  the 4th arg to **every** `withTenant(deps.db, deps.cfg.tenantId, …)` that wraps an identity-config
  write — the call sites at (current lines) 312 `createPerson`, 365/368/371
  `setRole`/`suspendPerson`/`reactivatePerson`, 394 `resetPin`, 416 `setPassword`, 564
  `finishPasskeyRegistration`, and 612 `finishPasskeyAuthentication` (the passkey counter bump is a
  `webauthn_credentials` UPDATE that must carry origin too). Read-only `withTenant` blocks (roster
  reads, session resolves) need no change, but adding the arg to them is harmless — the load-bearing
  ones are the writes.

- [ ] **6.5 (minimal impl — boot)** In `boot.ts` at the `mountManagementApi(...)` call (~line 312), add
  `nodeId: till.nodeId` to the `cfg` object (the same `till.nodeId` the adjacent `mountCatalogueApi`
  receives — one source of truth, `boot.ts:334`).

- [ ] **6.6 (run → pass)** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-origin`, then `pnpm --filter @waitron/server test:coverage` (unfiltered, for the cross-cutting suites) — green.
- [ ] **6.7 (prove-by-deletion)** Drop the `{ nodeId }` from the `createPerson` `withTenant`; confirm 6.1 fails (origin becomes ZERO); restore.
- [ ] **6.8 (commit)** `git commit -s -m "feat(server): thread nodeId through management-api identity-config writers for sync origin attribution"`

---

## Task 7 — Docs pointer, comment hygiene, self-review

**Files:**
- `docs/superpowers/specs/2026-08-15-distribution-and-client-topology-design.md` (edit — dated pointer)
- `packages/sync/src/{registry.ts,index.ts,migrations.ts,apply-sql.ts}` comment counts (edit)

**Steps:**

- [ ] **7.1 (dated pointer, not rewrite — CLAUDE.md §6)** Add a dated note at #86 §4a and §14's "14
  commercial / identity absent" lines, e.g.:
  `> **Update 2026-08-16:** identity **config** now flows down — persons + webauthn_credentials are enrolled in the ordered lane (19 enrolled: 17 commercial+dining = 14 commercial + 3 C1 dining, plus 2 identity-config). The ephemeral auth tables (sessions, management_sessions, webauthn_challenges) remain out, by design. See docs/superpowers/specs/2026-08-16-identity-config-flow-down-design.md.`
  Do NOT edit the original prose (historical record).

- [ ] **7.2 (comment counts)** Update the enrolled-**total** count comments in `@waitron/sync` — the
  ones that currently say "seventeen" (`registry.ts:1`, `index.ts:11`, `apply-sql.ts:39`) — to
  "nineteen … 17 commercial+dining + 2 identity-config". (`migrations.ts` carries no enrolled-total
  count — leave it.) Grep the package for any other "seventeen"/"17" enrolled-total mention and bump it
  too. Leave comments that describe the *commercial subset* specifically (e.g. `capture.gate.test.ts`,
  `apply.gate.test.ts` headers about "the capture triggers over the enrolled COMMERCIAL tables")
  accurate as-is, or amend to "+ 2 identity-config". These are comments, not load-bearing assertions —
  the only pinned count assertion lives in `registry.test.ts` (Task 1).

- [ ] **7.3 (self-review against the spec)** Re-read the spec §2 table and confirm: exactly
  `persons` + `webauthn_credentials` enrolled; exactly `sessions`/`management_sessions`/`webauthn_challenges`
  excluded (proven by Task 3's exclusion test); no `updated_at` added; no new grant/RLS/identity
  migration; no `nodes.role` gate; no `totp_secret` write introduced; fiscal core untouched (re-run the
  §7 greps). Fix any drift inline.

- [ ] **7.4 (full gate)** From the repo root: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, then `pnpm --filter @waitron/sync test:coverage`, `pnpm --filter @waitron/server test:coverage`, and `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`. Commit the lockfile if `pnpm install` changed it.

- [ ] **7.5 (commit)** `git commit -s -m "docs(sync): dated pointer on #86 + enrolled-count comment hygiene for identity config flow-down"`

---

## Finish

- [ ] Run `superpowers:finishing-a-development-branch` / the `finish-branch` flow: simplify, review, rebase, open PR, poll CI + Copilot, address findings on the threads themselves.
- [ ] **Owner-review gate (spec §9):** because this slice replicates credential material (hashes today; `totp_secret` is NULL-only today but flow-down multiplies its future exposure) and the read-only-secondary property is an app-layer posture rather than a DB write-block, mark the PR **`needs-owner-review`** and do **NOT** auto-land — surface, in the PR description: (1) credential replication is safe only while `totp_secret` stays unwritten; the TOTP-enrollment slice must land at-rest encryption first; (2) no `nodes.role` DB write-block was added (same posture as catalogue). Land only on explicit owner approval.
</content>

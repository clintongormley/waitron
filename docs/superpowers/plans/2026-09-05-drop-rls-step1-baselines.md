# Drop RLS — Step 1: baselines, roles collapsed, tests moved — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate every module's migrations as a two-file baseline with no row-level security, collapse the eight database roles to one, replace the 122 RLS test suites with a privilege matrix that proves the app role's grants did not change, and hollow out `withTenant` — all with a mechanical schema-equivalence proof.

**Architecture:** The old migration chain and the new baselines are applied to two fresh Postgres containers and their schema dumps diffed after normalising away exactly the objects this step deletes; the diff must be empty. Before any schema changes, a privilege matrix (`has_table_privilege` for every table × verb, as `app_user`) is captured from the OLD schema and committed as the expected value; it then stands as the proof that the app role can do exactly what it could before. The outbox tables stay in this step (as plain tables) so `packages/sync` keeps compiling; step 4 of the chain deletes them.

**Tech Stack:** drizzle-kit 0.x (`drizzle-kit generate`, `--custom`), PostgreSQL 18 (`postgres:18-alpine`), Testcontainers, Vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md` (§1 end state, §2 proof, §3 step 1, §4 tests, §5 provisioner, §6 docs). Companion: `docs/superpowers/specs/2026-09-05-outbox-to-native-replication-swap-design.md` §2.1 (classification, for CLAUDE.md wording only — the guards themselves are step 2).

## Global Constraints

- **Branch:** `feat/drop-rls-step1` in a worktree from `python3 ~/workspace/tools/worktree.py new waitron feat/drop-rls-step1` (never plain `git worktree add`). Every commit `git commit -s`.
- **Keep:** every `tenant_id` column and composite FK; `withTenant(db, tenantId, fn, opts?)`'s signature; `app_user` (`NOLOGIN`) + `waitron_app`/`waitron_migrator` logins; every `GRANT`/`REVOKE` naming `app_user`; every trigger and function except `current_tenant_id()` and the five `SECURITY DEFINER` clauses; the four `sync_*` tables and every capture trigger (they go in step 4).
- **Delete:** all `CREATE POLICY`; all `ALTER TABLE … ENABLE|FORCE ROW LEVEL SECURITY`; `current_tenant_id()`; the roles `tenant_provisioner`, `credentials_enumerator`, `envios_drainer`, `payments_webhook_resolver`, `sales_coverage_checker`, `sync_tailer`, `sync_retention` and every `GRANT`/`REVOKE`/`OWNER TO`/`CREATE POLICY` naming them; the `waitron_provisioner` login; `SECURITY DEFINER` on `credential_tenants`, `envios_tenants_with_work`, `resolve_payment_tenant`, `sales_assert_tenders_cover`, `sale_settlements_check_coverage`.
- **Add:** `ALTER TABLE <t> ENABLE ALWAYS TRIGGER <name>` for every trigger whose function is `reject_mutation()` (spec §1; the table list is what `grep -B3 'EXECUTE FUNCTION reject_mutation' packages/*/drizzle/*.sql` returns on the base commit — 20 triggers on 10 tables: `registros_facturacion`, `sales`, `sale_lines`, `tenders`, `sale_voids`, `sale_settlements`, `sale_substitutions`, `time_entries`, `daily_closes`, `order_amendments`).
- **Grants that fold into `app_user`:** `sync_tailer`'s and `sync_retention`'s (the outbox must keep working). `app_user` gains NOTHING else — in particular no `INSERT` on `tenants`, `locations`, `nodes` (CLAUDE.md §3 "never widen a grant"). The privilege matrix (Task 2) is the check.
- **Error codes are never renamed** (CLAUDE.md §3). `provisioning.role_over_privileged` keeps its name; its payload loses `bypassRls`.
- **No new migration files outside the baselines.** Each module ends with exactly the files Task 3–9 name.
- **Gate per task:** `pnpm --filter <pkg> test:coverage` (the whole package, never name-filtered — CLAUDE.md §2's filtered-run trap) and `pnpm format:check`; `pnpm lint && pnpm typecheck` are workspace-wide and run in Task 11. Coverage bars after #239: 98/98/98/95 on `verifactu`, `fiscal-verifactu`, `core`, `db`, `sync`, `payments`; 90/90/85/85 elsewhere.
- **Real Postgres suites need `TESTCONTAINERS_RYUK_DISABLED=true`.** Never run two browser-package coverage gates at once; never background `pnpm -r test:coverage`. Run `pnpm reap` if a suite hangs at `beforeAll`.
- **TDD:** a failing test (or a failing proof diff) first, then the change, then the receipt in the commit message. Prove every guard by deletion.
- **Comments state invariants, not history** (CLAUDE.md §1). When a file you touch carries a narrative comment about RLS, thin it to the invariant that survives.

## File map

| Path | Responsibility |
| --- | --- |
| `scripts/schema-equivalence.sh` (new) | apply OLD migrations and NEW migrations to two containers, dump, normalise, diff |
| `packages/fiscal-verifactu/src/privileges.test.ts` + `privileges.expected.ts` (new) | the `app_user` privilege matrix over the full manifest, captured from the old schema |
| `packages/<module>/drizzle/0000_<module>_baseline.sql` + `meta/` (regenerated) | Drizzle-generated DDL |
| `packages/<module>/drizzle/0001_<module>_baseline_sql.sql` (new, custom) | functions, triggers, grants, `ENABLE ALWAYS` — carried verbatim |
| `packages/sync/drizzle/0000_sync_baseline.sql` + `meta/_journal.json` (hand-written) | the outbox as plain tables + `sync_capture()` + capture triggers + folded grants |
| `packages/db/src/tenancy.ts` | `withTenant` without the tenant `set_config` |
| `packages/catalogue/src/operations.ts` | explicit `tenantId` instead of `current_tenant_id()` |
| `packages/db/src/testing/global-setup.ts`, `packages/sync/src/testing/global-setup.ts`, `apps/server/src/testing/global-setup.ts` | test logins without the helper roles |
| `packages/fiscal-verifactu/src/inmutabilidad.test.ts` | trigger + `ENABLE ALWAYS` scan instead of the RLS catalog scan |
| `packages/provisioning/src/instance-state.ts`, `instance-plan.ts`, `instance-apply.ts`, `errors.ts`, `cli.ts`, `venue-apply.ts` | two logins, no `bypassRls`, venue apply as the owner |
| `CLAUDE.md` §3 + §4, `packages/db/README.md`, `apps/server/README.md`, `docs/backlog.md` | the rules after |

---

### Task 1: The schema-equivalence proof script

**Files:**
- Create: `scripts/schema-equivalence.sh`
- Create: `scripts/schema-equivalence.md` (how to read a non-empty diff)

**Interfaces:**
- Produces: `scripts/schema-equivalence.sh <OLD_ROOT> <NEW_ROOT> <OUT_DIR>` — exits 0 with `EQUIVALENT` on an empty normalised diff, exits 1 and prints the diff otherwise. Both roots are repository checkouts (a `git worktree` of the base commit is the OLD one).

- [ ] **Step 1: Create the base worktree the proof compares against**

```bash
BASE=$(git merge-base HEAD origin/main)
git worktree add /tmp/waitron-base "$BASE"
echo "$BASE"   # record it; every task's proof run uses this path
```

- [ ] **Step 2: Write the script**

```bash
#!/bin/sh
# Schema-equivalence proof for a migration squash (spec 2026-09-05-drop-rls-… §2).
# Applies every migration set of OLD_ROOT to one postgres:18-alpine container and of NEW_ROOT
# to another, as a non-superuser owner role (the shape the provisioner produces), dumps both
# schemas, removes from the OLD dump exactly the objects the squash deletes and from the NEW
# dump exactly what it adds, and diffs. Any remaining difference is a defect in the baseline.
set -eu
OLD_ROOT=$1; NEW_ROOT=$2; OUT=$3; mkdir -p "$OUT"
order() {  # migration files of a checkout in manifest + journal order
  python3 - "$1" <<'PY'
import json, os, sys
repo = sys.argv[1]
for s in json.load(open(os.path.join(repo, "packages/migrations/migrations.manifest.json"))):
    d = os.path.normpath(os.path.join("packages/migrations", s["from"]))
    for e in json.load(open(os.path.join(repo, d, "meta/_journal.json")))["entries"]:
        print(f"{d}/{e['tag']}.sql")
PY
}
run() {  # run <name> <root>: fresh container, migrate as waitron_migrator, dump schema
  name=$1; root=$2
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --label com.waitron.reapable=true -e POSTGRES_PASSWORD=pg \
    -v "$root":/repo:ro postgres:18-alpine >/dev/null
  until docker exec "$name" pg_isready -U postgres -q; do sleep 1; done
  docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -q \
    -c "CREATE ROLE waitron_migrator LOGIN CREATEROLE PASSWORD 'mig'" \
    -c "CREATE DATABASE waitron OWNER waitron_migrator" </dev/null
  order "$root" | while read -r f; do
    docker exec "$name" psql -U waitron_migrator -d waitron -v ON_ERROR_STOP=1 -q -1 -f "/repo/$f" </dev/null \
      || { echo "FAILED applying $f on $name"; exit 1; }
  done
  docker exec "$name" pg_dump -U postgres -d waitron --schema-only --no-owner \
    </dev/null > "$OUT/$name.sql"
  docker exec "$name" psql -U postgres -d waitron -Atc \
    "select rolname from pg_roles where rolname not like 'pg_%' and rolname not in ('postgres','waitron_migrator') order by 1" \
    </dev/null > "$OUT/$name.roles"
  docker rm -f "$name" >/dev/null
}
run old "$OLD_ROOT"; run new "$NEW_ROOT"
# Normalise. OLD loses what the squash deletes; NEW loses what it adds. Nothing else is touched.
# sync_tailer and sync_retention are here too: their grants FOLD into app_user in step 1 (checked
# separately by hand in Task 6 — `\dp sync_log` on the NEW container) and the roles go in step 4.
DELETED_ROLES='tenant_provisioner|credentials_enumerator|envios_drainer|payments_webhook_resolver|sales_coverage_checker|sync_tailer|sync_retention'
python3 - "$OUT" "$DELETED_ROLES" <<'PY'
import re, sys
out, roles = sys.argv[1], sys.argv[2]
def load(p): return open(p, encoding="utf-8").read()
old, new = load(f"{out}/old.sql"), load(f"{out}/new.sql")
def drop_statements(text, patterns):
    # pg_dump emits one statement per line-block terminated by ";\n"; drop whole statements
    stmts = re.split(r"(?<=;)\n", text)
    keep = [s for s in stmts if not any(re.search(p, s, re.S) for p in patterns)]
    return "\n".join(keep)
old_n = drop_statements(old, [
    r"^CREATE POLICY ", r"ROW LEVEL SECURITY;", r"FUNCTION public\.current_tenant_id\b",
    rf"\b({roles})\b",                       # grants, revokes, OWNER TO, policies naming a deleted role
    r"SECURITY DEFINER",                     # the five seam functions lose the clause (compared by name below)
])
new_n = drop_statements(new, [r"ENABLE ALWAYS TRIGGER"])
# migration bookkeeping tables carry the same DDL in both; comments and SET lines are noise
def scrub(t):
    t = re.sub(r"^--.*$", "", t, flags=re.M)
    t = re.sub(r"^(SET|SELECT pg_catalog\.set_config).*$", "", t, flags=re.M)
    t = re.sub(r"\n{2,}", "\n", t)
    return t.strip() + "\n"
open(f"{out}/old.normalised.sql", "w").write(scrub(old_n))
open(f"{out}/new.normalised.sql", "w").write(scrub(new_n))
# The five seam functions must still exist in NEW, as invoker-rights
for fn in ["credential_tenants", "envios_tenants_with_work", "resolve_payment_tenant",
           "sales_assert_tenders_cover", "sale_settlements_check_coverage"]:
    assert re.search(rf"CREATE FUNCTION public\.{fn}\(", new), f"{fn} missing from NEW"
    assert not re.search(rf"CREATE FUNCTION public\.{fn}\([^;]*SECURITY DEFINER", new, re.S), f"{fn} still SECURITY DEFINER"
PY
if diff -u "$OUT/old.normalised.sql" "$OUT/new.normalised.sql" > "$OUT/schema.diff"; then
  echo "EQUIVALENT ($(wc -l < "$OUT/old.normalised.sql" | tr -d ' ') normalised lines each)"
else
  echo "NOT EQUIVALENT — see $OUT/schema.diff"; head -60 "$OUT/schema.diff"; exit 1
fi
echo "roles OLD: $(tr '\n' ' ' < "$OUT/old.roles")"; echo "roles NEW: $(tr '\n' ' ' < "$OUT/new.roles")"
```

Make it executable: `chmod +x scripts/schema-equivalence.sh`.

- [ ] **Step 3: Prove the script measures something — run it OLD vs OLD**

Run: `scripts/schema-equivalence.sh /tmp/waitron-base /tmp/waitron-base .superpowers/sdd/drop-rls-step1/proof-self`
Expected: `EQUIVALENT`, and `old.roles` lists the seven helper roles plus `app_user`.

- [ ] **Step 4: Prove it fails when it should — a control**

Copy the checkout (`cp -R "$(pwd)" /tmp/waitron-probe`), append `ALTER TABLE tenants ADD COLUMN probe text;` to `/tmp/waitron-probe/packages/db/drizzle/0000_tenancy.sql`, and run the script with `/tmp/waitron-base` as OLD and `/tmp/waitron-probe` as NEW.
Expected: `NOT EQUIVALENT` with a diff line `+    probe text`, exit 1. Then `rm -rf /tmp/waitron-probe`.

- [ ] **Step 5: Write `scripts/schema-equivalence.md`** — six lines: what the script compares, what it normalises (the exact list above, copied), and the rule "a non-empty diff is fixed in the baseline, never in the normaliser". Add both files to the root `lint`'s view (nothing to do: `scripts/*.sh` is not linted; `prettier --check .` ignores `.sh` — verify with `pnpm format:check`).

- [ ] **Step 6: Commit**

```bash
git add scripts/schema-equivalence.sh scripts/schema-equivalence.md
git commit -s -m "test(squash): schema-equivalence proof script (old chain vs new baselines, normalised dump diff)"
```

---

### Task 2: The `app_user` privilege matrix, captured from the OLD schema

**Files:**
- Create: `packages/fiscal-verifactu/src/privileges.test.ts`
- Create: `packages/fiscal-verifactu/src/privileges.expected.ts`

**Interfaces:**
- Produces: `PRIVILEGES: Record<string, string>` — table name → the letters of `SELECT INSERT UPDATE DELETE TRUNCATE` `app_user` holds, e.g. `registros_facturacion: "SI"`; and the suite that pins it.

This lives beside `inmutabilidad.test.ts` because that suite already migrates the FULL manifest on real Postgres (its header says why); the matrix must cover every module's tables.

- [ ] **Step 1: Write the capture script (throwaway) and run it on the base worktree's schema**

```bash
cat > /tmp/order.py <<'ORDER'
import json, os, sys
repo = sys.argv[1]
for s in json.load(open(os.path.join(repo, "packages/migrations/migrations.manifest.json"))):
    d = os.path.normpath(os.path.join("packages/migrations", s["from"]))
    for e in json.load(open(os.path.join(repo, d, "meta/_journal.json")))["entries"]:
        print(f"{d}/{e['tag']}.sql")
ORDER
docker run -d --name cap --label com.waitron.reapable=true -e POSTGRES_PASSWORD=pg -v /tmp/waitron-base:/repo:ro postgres:18-alpine
until docker exec cap pg_isready -U postgres -q; do sleep 1; done
docker exec cap psql -U postgres -q -c "CREATE ROLE waitron_migrator LOGIN CREATEROLE PASSWORD 'mig'" -c "CREATE DATABASE waitron OWNER waitron_migrator" </dev/null
python3 /tmp/order.py /tmp/waitron-base | while read -r f; do
  docker exec cap psql -U waitron_migrator -d waitron -v ON_ERROR_STOP=1 -q -1 -f "/repo/$f" </dev/null || { echo "FAILED $f"; break; }
done
```
Then:

```bash
docker exec cap psql -U postgres -d waitron -Atc "
select c.relname || ': \"' ||
  (case when has_table_privilege('app_user', c.oid, 'SELECT') then 'S' else '' end) ||
  (case when has_table_privilege('app_user', c.oid, 'INSERT') then 'I' else '' end) ||
  (case when has_table_privilege('app_user', c.oid, 'UPDATE') then 'U' else '' end) ||
  (case when has_table_privilege('app_user', c.oid, 'DELETE') then 'D' else '' end) ||
  (case when has_table_privilege('app_user', c.oid, 'TRUNCATE') then 'T' else '' end) || '\",'
from pg_class c where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
  and c.relname not like '\_\_drizzle%' order by 1" </dev/null > /tmp/matrix.txt
wc -l /tmp/matrix.txt   # expect 82 (the 80 live tables + 2 sync-side tables … count what you get and record it)
docker rm -f cap
```

- [ ] **Step 2: Write `privileges.expected.ts` from `/tmp/matrix.txt`**

```ts
/**
 * What `app_user` may do on every table, captured from the schema BEFORE the RLS drop
 * (2026-09-05 base <BASE SHA>) with `has_table_privilege`. Letters: S=SELECT I=INSERT U=UPDATE
 * D=DELETE T=TRUNCATE. This is the receipt that dropping row-level security and the helper roles
 * changed nothing about the app role's reach (spec §1): the suite beside it reads the live catalog
 * and expects exactly this. A deliberate grant change edits this file in the same commit, with the
 * reason in the message.
 */
export const PRIVILEGES: Record<string, string> = {
  // paste /tmp/matrix.txt here, one line per table
};
```

- [ ] **Step 3: Write the failing test**

```ts
// packages/fiscal-verifactu/src/privileges.test.ts
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PRIVILEGES } from "./privileges.expected.js";
// Reuse inmutabilidad.test.ts's harness setup verbatim: the same useRealPostgres/full-manifest
// migration and the same `db` accessor. Copy its imports and its `use…` call.

describe("app_user's table privileges are exactly the captured matrix", () => {
  it("matches every table, and every table is in the matrix", async () => {
    const { rows } = await db().execute<{ relname: string; privs: string }>(sql`
      select c.relname,
        (case when has_table_privilege('app_user', c.oid, 'SELECT') then 'S' else '' end) ||
        (case when has_table_privilege('app_user', c.oid, 'INSERT') then 'I' else '' end) ||
        (case when has_table_privilege('app_user', c.oid, 'UPDATE') then 'U' else '' end) ||
        (case when has_table_privilege('app_user', c.oid, 'DELETE') then 'D' else '' end) ||
        (case when has_table_privilege('app_user', c.oid, 'TRUNCATE') then 'T' else '' end) as privs
      from pg_class c
      where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
        and c.relname not like '\_\_drizzle%'
      order by 1`);
    const live = Object.fromEntries(rows.map((r) => [r.relname, r.privs]));
    expect(live).toEqual(PRIVILEGES);
  });

  it("is not vacuous: the matrix names the fiscal table and grants it no UPDATE", () => {
    expect(PRIVILEGES.registros_facturacion).toBe("SI");
  });
});
```

- [ ] **Step 4: Run it — it must PASS on the old schema (this is a capture, not a change)**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test privileges`
Expected: PASS, 2 tests. If the first case fails, the capture in Step 1 was taken from a different schema than the suite migrates — fix the capture, never the expectation.

- [ ] **Step 5: Prove it by mutation** — edit `PRIVILEGES.sales` to add `"U"`; run; expected FAIL naming `sales`. Revert.

- [ ] **Step 6: Commit**

```bash
git add packages/fiscal-verifactu/src/privileges.test.ts packages/fiscal-verifactu/src/privileges.expected.ts
git commit -s -m "test(fiscal): pin app_user's privilege matrix over every table, captured before the RLS drop"
```

---

### Task 3: Read the 122 RLS suites; keep what is not isolation; delete them

**Files:**
- Delete: every `**/*.rls.test.ts` (list with `find packages apps -name '*.rls.test.ts' -not -path '*/node_modules/*'`)
- Modify/Create: the non-RLS suites that inherit their surviving assertions (named per package below)

Split this across four subagents by package so each reads a tractable set: (a) `packages/db` (29), (b) `apps/server` (50), (c) `packages/identity` + `packages/fiscal-verifactu` + `packages/provisioning` (16), (d) everything else (`reporting`, `payments-stripe`, `layouts`, `payments`, `sync`, `credentials`, `workforce*`, `catalogue`, `scheduler` — the rest of the 122). The procedure is identical for each; a reviewer checks the ledger.

- [ ] **Step 1: For each file, write one ledger line BEFORE deleting it** in `.superpowers/sdd/drop-rls-step1/rls-ledger.md` (gitignored):

`| <path> | isolation-only / privilege / behaviour | <what moves, and to which file> |`

Classify each `it(`:
- **isolation** — "tenant B cannot see/write tenant A's row", "cross-tenant insert is rejected by RLS", "as a different tenant the list is empty": DELETE, no replacement (one tenant per database, owner decision 2026-09-05).
- **privilege** — "app_user cannot UPDATE/DELETE/TRUNCATE <table>", "app_user may INSERT": covered by Task 2's matrix; DELETE. If the case asserts a TRIGGER refusal (`reject_mutation`'s message, `42501` vs `P0001`), it moves to the module's existing behavioural suite for that table, or to `inmutabilidad.test.ts` if fiscal.
- **behaviour** — anything else (a route's 404 for a foreign id, a webhook resolving its tenant, a provisioning step's effect): move the case, unchanged, into the nearest non-RLS suite for the same subject (same directory, `<subject>.test.ts`); if none exists, rename the file by dropping `.rls` and delete only the isolation cases from it.

- [ ] **Step 2: Delete the files and run the package unfiltered**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter <pkg> test:coverage`
Expected: PASS; coverage still at the package's bar. (A drop below the bar means an RLS suite was the ONLY coverage of some production branch — find it in the coverage table and add a behavioural case for that branch to the receiving suite; never lower the bar.)

- [ ] **Step 3: Commit per package**

```bash
git add -A packages/<pkg>
git commit -s -m "test(<pkg>): retire <n> RLS suites — isolation cases deleted (one tenant per database), privilege cases pinned by the matrix, <m> behaviour cases moved"
```

The ledger is pasted into the PR description (not committed).

---

### Task 4: Core (`packages/db`) — baseline, RLS gone, roles collapsed, `withTenant` hollowed

**Files:**
- Delete: `packages/db/drizzle/*.sql`, `packages/db/drizzle/meta/*`
- Create: `packages/db/drizzle/0000_db_baseline.sql` (generated), `packages/db/drizzle/0001_db_baseline_sql.sql` (custom), `packages/db/drizzle/meta/0000_snapshot.json`, `_journal.json` (generated)
- Modify: `packages/db/src/tenancy.ts:52-64`, `packages/catalogue/src/operations.ts:283-291,334,482,605` (and its callers' signatures where `tenantId` is not already in scope), `packages/db/src/testing/global-setup.ts:55,61`, `packages/db/README.md:39-41`

**Interfaces:**
- `withTenant<T>(db: Database, tenantId: string, fn: (tx: Transaction) => Promise<T>, opts?: TenantTxOptions): Promise<T>` — unchanged signature; no longer sets `app.tenant_id`; still sets `app.node_id` when `opts.nodeId` is given (the capture triggers read it until step 4).
- `createCatalogue(tx, tenantId: TenantId, input)`, `createCategory(tx, tenantId, input)`, `createProduct(tx, tenantId, input)`, `assignCatalogueToLocation(tx, tenantId, …)` — the four operations that used `current_tenant_id()` take `tenantId` first after `tx`. Find each caller with `grep -rn "createCatalogue(\|createCategory(\|createProduct(" apps packages --include='*.ts'`.

- [ ] **Step 1: Write the failing test for `withTenant`**

In `packages/db/src/tenancy.test.ts` add:

```ts
it("no longer sets app.tenant_id — the database holds one tenant (spec §1)", async () => {
  await withTenant(db(), tenantId, async (tx) => {
    const { rows } = await tx.execute<{ v: string }>(sql`select current_setting('app.tenant_id', true) as v`);
    expect(rows[0]?.v ?? "").toBe("");
  });
});
it("still sets app.node_id when asked (the capture triggers read it until step 4)", async () => {
  await withTenant(db(), tenantId, async (tx) => {
    const { rows } = await tx.execute<{ v: string }>(sql`select current_setting('app.node_id', true) as v`);
    expect(rows[0]?.v).toBe(nodeId);
  }, { nodeId });
});
```

Run: `pnpm --filter @waitron/db test tenancy` — expected: the first case FAILS (the setting is set today).

- [ ] **Step 2: Hollow `withTenant`**

```ts
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
  opts?: TenantTxOptions,
): Promise<T> {
  // One tenant per database (owner decision 2026-09-05): no session variable, no policy. The
  // parameter stays so every write path still names the tenant it acts for, and so the transaction
  // discipline of CLAUDE.md §3 (one withTenant per request) keeps its single entry point.
  void tenantId;
  return db.transaction(async (tx) => {
    if (opts?.nodeId !== undefined) {
      await tx.execute(sql`select set_config('app.node_id', ${opts.nodeId}, true)`);
    }
    return fn(tx);
  });
}
```

Thin the header comment above it to the invariant (the `set_config` parameter-binding lesson stays; the tenant-fencing narrative goes). Run the two cases → PASS.

- [ ] **Step 3: Replace `current_tenant_id()` in the catalogue** — delete `CURRENT_TENANT`; each of the four inserts uses the new `tenantId` parameter (`.values({ tenantId, name: input.name })`). Update the callers found by the grep and their tests (they already hold a `tenantId` from `withTenant`). Run `pnpm --filter @waitron/catalogue test:coverage` and the server's catalogue suites → PASS.

- [ ] **Step 4: Regenerate the core baseline**

```bash
cd packages/db
git rm -rq drizzle && mkdir -p drizzle
pnpm db:generate --name db_baseline            # → drizzle/0000_db_baseline.sql + meta/
pnpm db:generate:custom --name db_baseline_sql # → drizzle/0001_db_baseline_sql.sql (empty)
```

- [ ] **Step 5: Fill the custom file, verbatim from the OLD files, in their original order**

Source: `/tmp/waitron-base/packages/db/drizzle/*.sql` in journal order (`python3 /tmp/order.py /tmp/waitron-base | grep packages/db/`). Copy into `0001_db_baseline_sql.sql`, separated by `--> statement-breakpoint` exactly as the old files do, EVERY statement of these kinds and NO other:

1. `CREATE ROLE app_user NOLOGIN` (from `0001_tenancy_rls.sql`) — and none of the other seven.
2. `CREATE [OR REPLACE] FUNCTION …` — all except `current_tenant_id`. For `sales_assert_tenders_cover` and `sale_settlements_check_coverage`, remove the `SECURITY DEFINER` line (invoker rights); drop the `ALTER FUNCTION … OWNER TO sales_coverage_checker` statements.
3. `CREATE [CONSTRAINT] TRIGGER …` — all, including the `0037` gated variants as they are.
4. `GRANT`/`REVOKE … TO|FROM app_user` — all. None naming a deleted role.
5. Any hand-written `ALTER TABLE … ADD CONSTRAINT … CHECK` that the generated file lacks (Task 6's diff tells you which).
6. At the end: `ALTER TABLE "<t>" ENABLE ALWAYS TRIGGER "<name>";` for each `reject_mutation` trigger on a core table: `sales_enforce_immutability`, `sales_block_truncate`, `sale_lines_*`, `tenders_*`, `sale_voids_*`, `sale_settlements_*`, `sale_substitutions_*`, `daily_closes_immutable`, `daily_closes_no_truncate`, `order_amendments_enforce_immutability`, `order_amendments_block_truncate` (confirm the exact names from the old files).

Nothing about policies, `ROW LEVEL SECURITY`, or `current_tenant_id`.

- [ ] **Step 6: The test harness's logins** — `packages/db/src/testing/global-setup.ts:55` `inRole: ["app_user", "tenant_provisioner"]` → `inRole: "app_user"`; line 61's `inRole: "tenant_provisioner"` login: read what suite uses it (`grep -rn "<its name>" packages/db/src`) — if only RLS suites (now deleted), remove the login; otherwise make it `app_user`.

- [ ] **Step 7: Run the proof for core** (other modules still OLD in the worktree):

Run: `scripts/schema-equivalence.sh /tmp/waitron-base "$(pwd)" .superpowers/sdd/drop-rls-step1/proof-core`
Expected: `EQUIVALENT`. A non-empty diff names a constraint or grant missing from the custom file — add it from the old files. Repeat until empty.

- [ ] **Step 8: Run the package and its dependents**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage && pnpm --filter @waitron/catalogue test:coverage && pnpm format:check`
Expected: PASS at 98/98/98/95 (db) and 90/90/85/85 (catalogue). Fix by reading, not by lowering.

- [ ] **Step 9: Commit**

```bash
git add -A packages/db packages/catalogue
git commit -s -m "feat(db): core baseline without RLS — 111 files → 2, seven helper roles gone, withTenant no longer sets app.tenant_id, catalogue takes tenantId

Schema-equivalence proof: scripts/schema-equivalence.sh <BASE> <HEAD> → EQUIVALENT (<n> lines)."
```

---

### Task 5: `identity`, `workforce`, `workforce-es`, `payments`, `scheduler`, `credentials` baselines

One subagent per module, same procedure as Task 4 Steps 4, 5, 7, 8, 9, with these module facts:

| module | old files | generate scripts | custom SQL to carry |
| --- | --- | --- | --- |
| identity | 12 | `db:generate`, `db:generate:custom` | grants to `app_user`; capture-trigger statements stay in `sync` (not here); no functions |
| workforce | 11 | same | `time_entries_enforce_immutability`, `time_entries_block_truncate` (+ `ENABLE ALWAYS` both), grants |
| workforce-es | 2 | same | grants |
| payments | 13 | same | `resolve_payment_tenant` WITHOUT `SECURITY DEFINER` and without `OWNER TO payments_webhook_resolver`; `tenders_reject_post_settlement` etc. if they live here (check the old files), grants |
| scheduler | 2 | same | grants |
| credentials | 3 | same | `credential_tenants(text)` WITHOUT `SECURITY DEFINER`/`OWNER TO credentials_enumerator`; grants |

For each: `git rm -rq packages/<m>/drizzle && mkdir packages/<m>/drizzle && pnpm --filter @waitron/<m> db:generate --name <m>_baseline && pnpm --filter @waitron/<m> db:generate:custom --name <m>_baseline_sql`, fill the custom file, run the proof (`EQUIVALENT`), run `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/<m> test:coverage && pnpm format:check`, commit:

```bash
git add -A packages/<m>
git commit -s -m "feat(<m>): baseline without RLS — <old> files → 2; proof EQUIVALENT"
```

Roles that these modules' old migrations CREATE (`credentials_enumerator` in credentials, `payments_webhook_resolver` in payments, `envios_drainer` in fiscal — check each with `grep 'CREATE ROLE' /tmp/waitron-base/packages/<m>/drizzle/*.sql`) are simply not carried.

---

### Task 6: `sync` — hand-written baseline, outbox kept, its two roles folded into `app_user`

**Files:**
- Delete: `packages/sync/drizzle/*.sql`, `packages/sync/drizzle/meta/*`
- Create: `packages/sync/drizzle/0000_sync_baseline.sql`, `packages/sync/drizzle/meta/_journal.json`
- Modify: `packages/sync/src/testing/global-setup.ts:69-72`, `apps/server/src/testing/global-setup.ts:64-69`, `apps/server/src/config.ts:283` (comment), the headers of `source.ts`, `apply.ts`, `pull.ts`, `retention.ts`, `cursor-report.ts`, `disposal.ts` (comments naming the roles)

`sync` has no `drizzle.config.ts` and no schema TS: its migrations are hand-written, so its baseline is one hand-written file and a hand-written journal.

- [ ] **Step 1: Write the journal**

```json
{ "version": "7", "dialect": "postgresql",
  "entries": [ { "idx": 0, "version": "7", "when": 1788000000000, "tag": "0000_sync_baseline", "breakpoints": true } ] }
```
(Copy the exact top-level shape from `/tmp/waitron-base/packages/sync/drizzle/meta/_journal.json`; only `entries` changes.)

- [ ] **Step 2: Write `0000_sync_baseline.sql`** from the ten old files in order: the four `CREATE TABLE`s (`sync_log`, `sync_cursor`, `sync_peers`, `sync_config_conflicts`) with every later `ALTER TABLE … ADD COLUMN`/index folded into the `CREATE` (or kept as separate statements — either way the proof decides); `sync_capture()`; every `CREATE TRIGGER … sync_capture` on other modules' tables (`0006`, `0007`, `0008`); the grants — every `GRANT … TO sync_tailer` and `TO sync_retention` rewritten as `TO app_user`; nothing about `sync_tailer`, `sync_retention`, policies, or RLS.

- [ ] **Step 3: Test logins** — `sync_reader`, `sync_applier`, `sync_pruner`, `tailer_login` (`packages/sync/src/testing/global-setup.ts:69-72`) and the same three in `apps/server/src/testing/global-setup.ts:64-69`: every `inRole` becomes `"app_user"`. Keep the login names (the suites reference them). `peers.grants.test.ts` and `config-conflict.grants.test.ts` assert what each role may do: rewrite each assertion to `app_user`'s grant (the matrix of Task 2 is the source of truth; `has_table_privilege('app_user', 'sync_log', 'DELETE')` is now true).

- [ ] **Step 4: Proof + tests**

Run: `scripts/schema-equivalence.sh /tmp/waitron-base "$(pwd)" .superpowers/sdd/drop-rls-step1/proof-sync` → `EQUIVALENT`. The normaliser strips every statement naming `sync_tailer`/`sync_retention` from the OLD dump, so the FOLD is checked by hand: rerun the script's NEW half, keep the container, and `psql -c "\dp sync_log" -c "\dp sync_cursor" -c "\dp sync_peers" -c "\dp sync_config_conflicts"`; paste the four ACLs into the commit message and confirm `app_user` holds, on each, exactly the union of what the two roles held in the old files.
Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage && pnpm format:check` → PASS at 98/98/98/95.

- [ ] **Step 5: Commit**

```bash
git add -A packages/sync apps/server/src/testing/global-setup.ts apps/server/src/config.ts
git commit -s -m "feat(sync): hand-written baseline — outbox tables kept as plain tables, sync_tailer/sync_retention folded into app_user until step 4 deletes the outbox"
```

---

### Task 7: `fiscal-verifactu` — baseline, `ENABLE ALWAYS`, `inmutabilidad` rewritten

**Files:**
- Delete/Create: as Task 4 for `packages/fiscal-verifactu/drizzle`
- Modify: `packages/fiscal-verifactu/src/inmutabilidad.test.ts:169-240`

- [ ] **Step 1: Write the failing test first** — replace the `describe("row-level security on every tenant-scoped table …")` block (lines 169–240) with:

```ts
describe("every append-only trigger exists and fires for replication too (spec §1)", () => {
  const EXPECTED: Record<string, string[]> = {
    registros_facturacion: ["registros_facturacion_enforce_immutability", "registros_facturacion_block_truncate"],
    sales: ["sales_enforce_immutability", "sales_block_truncate"],
    sale_lines: ["sale_lines_enforce_immutability", "sale_lines_block_truncate"],
    tenders: ["tenders_enforce_immutability", "tenders_block_truncate"],
    sale_voids: ["sale_voids_enforce_immutability", "sale_voids_block_truncate"],
    sale_settlements: ["sale_settlements_enforce_immutability", "sale_settlements_block_truncate"],
    sale_substitutions: ["sale_substitutions_enforce_immutability", "sale_substitutions_block_truncate"],
    time_entries: ["time_entries_enforce_immutability", "time_entries_block_truncate"],
    daily_closes: ["daily_closes_immutable", "daily_closes_no_truncate"],
    order_amendments: ["order_amendments_enforce_immutability", "order_amendments_block_truncate"],
  };
  it("lists exactly the reject_mutation triggers, each ENABLE ALWAYS (tgenabled = 'A')", async () => {
    const { rows } = await db().execute<{ table: string; name: string; enabled: string }>(sql`
      select c.relname as "table", t.tgname as name, t.tgenabled::text as enabled
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
      where not t.tgisinternal and p.proname = 'reject_mutation' order by 1, 2`);
    const byTable: Record<string, string[]> = {};
    for (const r of rows) (byTable[r.table] ??= []).push(r.name);
    expect(byTable).toEqual(Object.fromEntries(Object.entries(EXPECTED).map(([t, n]) => [t, [...n].sort()])));
    expect(rows.filter((r) => r.enabled !== "A").map((r) => `${r.table}.${r.name}`)).toEqual([]);
  });
  it("the guard bites: a trigger left at the default fires only at origin", async () => {
    await db().execute(sql`alter table registros_facturacion enable trigger registros_facturacion_block_truncate`);
    try {
      const { rows } = await db().execute<{ e: string }>(sql`select tgenabled::text as e from pg_trigger where tgname = 'registros_facturacion_block_truncate'`);
      expect(rows[0]?.e).toBe("O");
    } finally {
      await db().execute(sql`alter table registros_facturacion enable always trigger registros_facturacion_block_truncate`);
    }
  });
});
```
(Adjust the trigger names to what `grep 'CREATE TRIGGER' /tmp/waitron-base/packages/*/drizzle/*.sql | grep -B1 reject_mutation` prints; the names above are from that grep on 2026-09-05.) Run → FAIL: `enabled` is `O` for every trigger.

- [ ] **Step 2: Regenerate** as Task 4 Steps 4–5 with `fiscal_baseline` / `fiscal_baseline_sql`; carry `reject_mutation()`, `envios_tenants_with_work()` WITHOUT `SECURITY DEFINER`/`OWNER TO envios_drainer`, every trigger (incl. `0014`'s capture trigger), every `app_user` grant, and the `ENABLE ALWAYS` lines for the two `registros_facturacion` triggers. The `ENABLE ALWAYS` lines for the OTHER modules' triggers live in THOSE modules' custom files (Tasks 4, 5) — this suite checks the whole set.

- [ ] **Step 3: Proof + tests** — `scripts/schema-equivalence.sh … proof-fiscal` → `EQUIVALENT`; `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test:coverage && pnpm format:check` → PASS, both new cases green, `privileges.test.ts` still green.

- [ ] **Step 4: Commit**

```bash
git add -A packages/fiscal-verifactu
git commit -s -m "feat(fiscal): baseline without RLS; every reject_mutation trigger ENABLE ALWAYS; inmutabilidad scans triggers, not policies"
```

---

### Task 8: Provisioning — two logins, no `bypassRls`, venue apply as the owner

**Files:**
- Modify: `packages/provisioning/src/instance-state.ts:13,27,91-111`, `instance-plan.ts:55-80,208-228`, `instance-apply.ts` (the `waitron_provisioner` branch), `errors.ts:281`, `status-command.ts:26-29`, `cli.ts` (the venue command's connection), `venue-apply.ts:60-80`, and their tests

- [ ] **Step 1: Failing tests** in `instance-plan.test.ts`:

```ts
it("refuses a superuser, and only a superuser (bypassrls means nothing without RLS)", () => {
  expect(() => assertUsable("waitron_app", { ...facts, superuser: false, bypassRls: true })).not.toThrow();
  expect(() => assertUsable("waitron_app", { ...facts, superuser: true, bypassRls: false })).toThrow(/role_over_privileged/);
});
it("plans exactly two logins: the migrator and the app", () => {
  expect(INSTANCE_ROLES).toEqual(["waitron_migrator", "waitron_app"]);
  expect(REQUIREMENTS.waitron_app.memberOf).toEqual(["app_user"]);
});
```
Run → FAIL (three roles; bypassRls refused).

- [ ] **Step 2: Implement** — `INSTANCE_ROLES = ["waitron_migrator", "waitron_app"]`; delete the `waitron_provisioner` entry of `REQUIREMENTS`; `assertUsable`: `if (facts.superuser) throw new AppError("provisioning.role_over_privileged", { role, superuser: true })` and drop `bypassRls` from the error's payload type (`errors.ts:281`) and from `RoleFacts`/the `pg_roles` read (`instance-state.ts`) and `status-command.ts`. Thin the comment at `instance-plan.ts:208-215` to: "A superuser can DISABLE TRIGGER; the append-only guarantee is the triggers. Refused, never repaired."
- [ ] **Step 3: Venue apply as the owner** — in `cli.ts`, the venue command opens the OWNER-admin connection for the target database (the `withOwnerConnection`-style helper at `cli.ts:587` already exists for `instance`); `venue-apply.ts`'s `ensure-tenant` insert runs on that connection. Delete the `waitron_provisioner` login creation from `instance-apply.ts`. Update `venue*.test.ts` fixtures that created `waitron_provisioner`.
- [ ] **Step 4: Run** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test:coverage && pnpm format:check` → PASS at 90/90/85/85.
- [ ] **Step 5: Commit** — `git commit -s -am "feat(provisioning): two logins; superuser refused, bypassrls ignored; venue apply runs as the owner"`

---

### Task 9: Real-Postgres → PGlite where RLS was the only reason; measurements

**Files:**
- Modify: each suite whose header names RLS as its reason for a container (found by `grep -rln "RLS\|row-level\|deployment role" --include='*.test.ts' packages apps | xargs grep -l "useRealPostgres\|describeEachTarget\|useTemplateDb"`)

- [ ] **Step 1: Measure before** (on the base worktree): `grep -rlE "useRealPostgres|describeEachTarget|startMigratedPostgres|useTemplateDb|REQUIRE_DOCKER|startPostgresContainer" packages apps --include='*.test.ts' | grep -v node_modules | wc -l` → 212 (2026-09-05). Wall clock: `time (pnpm vitest run --coverage && TESTCONTAINERS_RYUK_DISABLED=true pnpm -r --workspace-concurrency=2 test:coverage)` — alone on the machine (browser packages, CLAUDE.md §2). Record both in `.superpowers/sdd/drop-rls-step1/measurements.md`.
- [ ] **Step 2: Move** each candidate to `usePgliteDb` when its remaining assertions need no privilege, trigger-as-a-role or concurrency; leave a one-line comment naming why it stays if it stays. Run each package's `test:coverage`.
- [ ] **Step 3: Measure after**, same two commands. Paste both pairs into the PR description and into `docs/backlog.md`'s item 3 line (Task 10).
- [ ] **Step 4: Commit** — `git commit -s -am "test: <n> suites to PGlite now that RLS is gone; real-PG files 212 → <m>, full suite <before> → <after>"`

---

### Task 10: Guidance — CLAUDE.md, READMEs, backlog

**Files:**
- Modify: `CLAUDE.md:187-195` (the FORCE-RLS bullet), `CLAUDE.md:228-235` (collision recipe), `CLAUDE.md:240-245` (§4 PGlite), `packages/db/README.md:39-41`, `apps/server/README.md:80-86`, `docs/backlog.md` (Track A item 3)

- [ ] **Step 1: CLAUDE.md §3** — replace the bullet beginning "A new `tenant_id`-bearing table needs FORCE RLS" with:

```
- **A new table is classified `ledger`, `state` or `local` (swap design §2.1), and an append-only
  table's `reject_mutation()` triggers are `ENABLE ALWAYS`** — the replication apply worker skips
  ordinary triggers, and a copy of a corrupted row is exactly what those triggers exist to refuse.
  No policies, no `ROW LEVEL SECURITY`: one tenant per database (owner decision 2026-09-05). The
  guard is `packages/fiscal-verifactu`'s `inmutabilidad` suite (the trigger scan; the
  classification guard arrives with step 2 of the chain) — run it after adding any table anywhere.
```
Replace the collision recipe's `db:generate:custom --name <foo>_rls, pasting back the RLS SQL you saved first` with `db:generate:custom --name <foo>_sql, pasting back the triggers and grants you saved first` and "the package's RLS suite" with "the package's grant assertions and `privileges.test.ts`". §4's first bullet: "every connection is a superuser (RLS bypassed)" → "every connection is a superuser (grants and triggers are not enforced)"; "privileges, RLS as the deployment role, or concurrency" → "privileges, triggers as the deployment role, or concurrency".

- [ ] **Step 2: READMEs** — `packages/db/README.md:39-41`: "Triggers, grants and `ENABLE ALWAYS` are hand-written into the module's `…_baseline_sql` custom migration; they survive later `generate` runs because drizzle-kit diffs against its own snapshot, which has no concept of them." `apps/server/README.md:80-86`: "this role needs to be a member of `app_user`, who the migrations grant table access to (and nothing more: `app_user` cannot update or delete a fiscal record, a sale or a tender — the grants and triggers say so, `privileges.test.ts` pins it)". Keep the `create role` SQL.
- [ ] **Step 3: backlog** — item 3's line: step 1 landed as PR #<n>, with the measurements from Task 9 and the proof line; the "no new table until A3 lands" rule in the sequencing paragraph becomes "no new table until step 1 of A3 lands — LANDED #<n>; from here a new table needs Task 10's classification line".
- [ ] **Step 4: `pnpm format:check`** (CLAUDE.md and READMEs are format-checked). Commit: `git commit -s -am "docs: RLS rule retired — classification + ENABLE ALWAYS; PGlite note; baseline recipe; backlog"`

---

### Task 11: Whole-workspace proof and gate

- [ ] **Step 1: Full proof** — `scripts/schema-equivalence.sh /tmp/waitron-base "$(pwd)" .superpowers/sdd/drop-rls-step1/proof-final` → `EQUIVALENT`; `roles NEW` = `app_user` only. Paste the three output lines into the PR.
- [ ] **Step 2: Behavioural receipts on the NEW container** (rerun the script's `run new` half by hand and keep the container): as `waitron_app` (create it `LOGIN IN ROLE app_user`): `UPDATE registros_facturacion SET importe_total='0' WHERE false` → `ERROR: permission denied` (`42501`); `INSERT` of a well-formed row (use `docs/superpowers/specs/2026-09-05-native-replication-post-rls-prototype-findings.md`'s seed shape) → `INSERT 0 1`; as `waitron_migrator`: `UPDATE … WHERE secuencia = 1` → `table registros_facturacion is append-only`. Paste verbatim.
- [ ] **Step 3: Gate** — `pnpm lint && pnpm typecheck && pnpm format:check`, then `pnpm reap`, then `pnpm vitest run --coverage && TESTCONTAINERS_RYUK_DISABLED=true pnpm -r --workspace-concurrency=2 test:coverage`, alone on the machine. Root guards (`module-graph-honesty`, `english-only`, `errors-reachable`, `coverage-thresholds`) all green.
- [ ] **Step 4: Remove the base worktree** — `git worktree remove /tmp/waitron-base`.
- [ ] **Step 5: `/finish-branch`** with the PR body carrying: the proof lines, the receipts, the ledger summary (counts per class), the measurements, and the one deviation from the spec: `withTenant` does not assert the single tenant at runtime (61 suites seed more than one tenant for reasons unrelated to isolation; the one-tenant property is enforced where tenants are created — the provisioner — and by `app_user` holding no `INSERT` on `tenants`, pinned by the matrix). Add that deviation to the spec §1 as a dated line in the same PR.

---

## Self-review

- **Spec §1 end state:** Tasks 4–8 (roles, RLS, functions, `withTenant`, logins); `ENABLE ALWAYS` Tasks 4/5/7; outbox kept Task 6. ✔
- **Spec §2 proof:** Task 1, run per module and in Task 11. ✔ Behavioural receipts: Task 11 Step 2. ✔
- **Spec §3 step 1:** every bullet has a task; CLAUDE.md Task 10. ✔
- **Spec §4 tests:** read-then-delete Task 3; grant proof Task 2 (matrix) — the spec's "grant suite per module" is realised as ONE matrix suite over the full manifest plus the moved behavioural cases; state so in the PR. `inmutabilidad` Task 7; PGlite + measurements Task 9. ✔
- **Spec §5 provisioner:** Task 8. ✔
- **Spec §6 guidance:** Task 10. ✔
- **Deviation recorded:** the runtime single-tenant assertion (Task 11 Step 5). ✔
- **Type consistency:** `withTenant` signature unchanged everywhere; `PRIVILEGES` name used in Tasks 2, 6, 10; `INSTANCE_ROLES`/`REQUIREMENTS` names match `instance-plan.ts`/`instance-state.ts`. ✔

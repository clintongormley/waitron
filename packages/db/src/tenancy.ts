import { sql } from "drizzle-orm";
import type { Database, Transaction } from "./client.js";

/**
 * Runs `fn` inside a transaction scoped to one tenant.
 *
 * The tenant id is bound as a PARAMETER, via set_config. The obvious
 * alternative does not exist:
 *
 *     SET LOCAL app.tenant_id = $1     -- syntax error
 *
 * SET is a utility statement, and Postgres only substitutes parameters into
 * optimisable statements (SELECT/INSERT/UPDATE/DELETE/VALUES). Preparing that
 * statement fails with `syntax error at or near "set"` — verified. The naive
 * repair is to interpolate the id into the string, which is an injection
 * vector in the one place in the system that must not have one, since it is
 * the value every tenancy decision is made from. set_config() is an ordinary
 * function call inside a SELECT, so it parameterises like anything else.
 *
 * The `true` third argument means "local to this transaction". Combined with
 * the transaction wrapper it is also what makes pooling safe: node-postgres
 * pins one client for the whole transaction() callback, so the GUC cannot leak
 * to another tenant's request, and it is discarded at commit.
 *
 * In the standalone deployment this collapses to a no-op in effect. The same
 * migrations run and the same policy is evaluated, but there is exactly one
 * tenant, so the predicate never excludes a row — and PGlite connects as
 * superuser, which bypasses RLS entirely. That is acceptable only because
 * standalone is single-tenant (spec §3), and it is precisely why the tests
 * must not rely on it. Rejected alternative: branching on a deployment mode
 * inside this function, which would mean the standalone path runs a code path
 * the cloud tests never exercise.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { hashSecret } from "@waitron/identity";
import { authenticateAgent } from "./agent.js";
import type { PrintAgentConfig } from "./agent.js";
import "./errors.js";

// Real Postgres (a `core` template clone), not PGlite: auth exercises the REAL deployment role and its
// exact grants — every call runs through `withTenant` + `asAppUser`, the shape the Task-6 route uses.
// (Agent enrolment is join-and-accept, in apps/server/src/join-requests.ts; this suite covers only the
// bearer-token auth core that stays here.)
const LOCALE = "es-ES";
const suite = useTemplateDb({ template: "core" });

/**
 * A fresh tenant + venue, seeded on the superuser admin connection. Each test gets its OWN tenant
 * so agent/code counts are order-independent across the shared clone.
 */
async function setup(): Promise<PrintAgentConfig> {
  const admin = suite.admin;
  const tenantId = await seedTenant(admin);
  const loc = await admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Bar', array[${LOCALE}], 'Sale on premises') returning id`);
  return { tenantId, locationId: loc.rows[0]!.id };
}

/** Run `fn` as the real deployment role: a tenant-scoped transaction that first switches to
 * `app_user`, exactly the shape the Task-6 route wraps each core call in. */
function asApp<T>(
  db: Database,
  cfg: { tenantId: string },
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** The AppError code a thrown rejection carries, or undefined if `fn` resolved. */
async function codeOf(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("authenticateAgent", () => {
  /** Mint an approved `print_agents` row directly (enrolment is join-and-accept, in apps/server) and
   * return its config + bearer token — the `${agentId}.${secret}` shape `authenticateAgent` parses. */
  async function enrolled(): Promise<{ cfg: PrintAgentConfig; agentId: string; token: string }> {
    const cfg = await setup();
    const secret = randomBytes(32).toString("base64url");
    const [{ id }] = (
      await suite.admin.execute<{ id: string }>(sql`
        insert into print_agents (tenant_id, location_id, name, token_hash, active)
        values (${cfg.tenantId}, ${cfg.locationId}, 'Auth agent', ${hashSecret(secret)}, true)
        returning id`)
    ).rows;
    return { cfg, agentId: id, token: `${id}.${secret}` };
  }

  it("a valid token resolves to its agentId and stamps last_seen_at", async () => {
    const { cfg, agentId, token } = await enrolled();
    const before = await suite.admin.execute<{ last_seen_at: string | null }>(
      sql`select last_seen_at from print_agents where id = ${agentId}`,
    );
    expect(before.rows[0]!.last_seen_at).toBeNull(); // NULL until first seen

    const result = await asApp(suite.admin, cfg, (tx) => authenticateAgent(tx, cfg, token));
    expect(result.agentId).toBe(agentId);

    const after = await suite.admin.execute<{ last_seen_at: string | null }>(
      sql`select last_seen_at from print_agents where id = ${agentId}`,
    );
    expect(after.rows[0]!.last_seen_at).not.toBeNull(); // the sighting was recorded
  });

  it("a wrong token (tampered secret) → agent.unauthorized", async () => {
    const { cfg, agentId } = await enrolled();
    const forged = `${agentId}.${randomBytes(32).toString("base64url")}`;
    expect(
      await codeOf(() => asApp(suite.admin, cfg, (tx) => authenticateAgent(tx, cfg, forged))),
    ).toBe("agent.unauthorized");
  });

  it("a revoked (active=false) agent → agent.unauthorized", async () => {
    const { cfg, agentId, token } = await enrolled();
    await suite.admin.execute(sql`update print_agents set active = false where id = ${agentId}`);
    expect(
      await codeOf(() => asApp(suite.admin, cfg, (tx) => authenticateAgent(tx, cfg, token))),
    ).toBe("agent.unauthorized");
  });

  it("an unknown agent id → agent.unauthorized", async () => {
    const cfg = await setup();
    const token = `${randomUUID()}.${randomBytes(32).toString("base64url")}`;
    expect(
      await codeOf(() => asApp(suite.admin, cfg, (tx) => authenticateAgent(tx, cfg, token))),
    ).toBe("agent.unauthorized");
  });

  it("a malformed token — no separator, trailing dot, or non-uuid selector — → agent.unauthorized", async () => {
    const cfg = await setup();
    for (const bad of ["nodothere", "abc.", "not-a-uuid.somesecret"]) {
      expect(
        await codeOf(() => asApp(suite.admin, cfg, (tx) => authenticateAgent(tx, cfg, bad))),
      ).toBe("agent.unauthorized");
    }
  });

  it("an agent enrolled in tenant A cannot authenticate under tenant B's cfg", async () => {
    const { cfg: cfgA, agentId, token } = await enrolled();
    const cfgB = await setup();

    // Sanity FIRST: the very same token DOES authenticate under its own tenant, so the rejection below
    // is about the tenant SCOPE and not a token that simply never verifies.
    const own = await asApp(suite.admin, cfgA, (tx) => authenticateAgent(tx, cfgA, token));
    expect(own.agentId).toBe(agentId);

    // Under tenant B's cfg the SAME token is refused by `authenticateAgent`'s explicit `tenant_id
    // = cfg.tenantId` predicate. The superuser connection and `withTenant` add no tenant
    // filtering. The control uses a valid token for tenant A: removing the predicate would let
    // that row and its matching secret authenticate under tenant B's cfg.
    expect(
      await codeOf(() =>
        withTenant(suite.admin, cfgB.tenantId, (tx) => authenticateAgent(tx, cfgB, token)),
      ),
    ).toBe("agent.unauthorized");
  });
});

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { verifySecret } from "@waitron/identity";
import { PAIRING_TTL_MS, authenticateAgent, enrolAgent, generateAgentCode } from "./agent.js";
import type { PrintAgentConfig } from "./agent.js";
import "./errors.js";

// Real Postgres (a `core` template clone), not PGlite: the single-use redemption guarantee is a
// CONCURRENCY property enforced by the locking DELETE … RETURNING, and PGlite serialises every query
// onto ONE backend, so two concurrent enrolments never truly overlap there — a false pass, not a weak
// one (CLAUDE.md §4). The non-race suites also run here (rather than on a separate PGlite harness) so
// enrol/auth exercise the REAL deployment role and its exact grants: every call runs through
// `withTenant` + `asAppUser`, the shape the Task-6 route will use.
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

async function agentCount(cfg: PrintAgentConfig): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from print_agents where tenant_id = ${cfg.tenantId}`,
  );
  return rows[0]!.n;
}

async function tokenHashOf(agentId: string): Promise<string> {
  const { rows } = await suite.admin.execute<{ token_hash: string }>(
    sql`select token_hash from print_agents where id = ${agentId}`,
  );
  return rows[0]!.token_hash;
}

describe("generateAgentCode + enrolAgent", () => {
  it("generate → enrol mints a verifySecret-able token; the stored hash is NOT the plaintext", async () => {
    const cfg = await setup();
    const { code } = await asApp(suite.admin, cfg, (tx) =>
      generateAgentCode(tx, cfg, { label: "Kitchen USB" }),
    );
    const { agentId, token } = await asApp(suite.admin, cfg, (tx) => enrolAgent(tx, cfg, { code }));

    // The bearer credential is `${agentId}.${secret}` — a selector (the row id) + a validator (the
    // scrypt-checked secret), the device-identity shape.
    expect(token.startsWith(`${agentId}.`)).toBe(true);
    const secret = token.slice(token.indexOf(".") + 1);

    // The stored value is the scrypt hash of the SECRET half, never the plaintext token or secret.
    const stored = await tokenHashOf(agentId);
    expect(stored).not.toBe(token);
    expect(stored).not.toBe(secret);
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifySecret(secret, stored)).toBe(true); // the secret half verifies…
    expect(verifySecret(token, stored)).toBe(false); // …the composite bearer does NOT

    // The enrolled agent carries the code's label as its name, and the code was consumed.
    const { rows } = await suite.admin.execute<{ name: string; location_id: string }>(
      sql`select name, location_id from print_agents where id = ${agentId}`,
    );
    expect(rows[0]!.name).toBe("Kitchen USB");
    expect(rows[0]!.location_id).toBe(cfg.locationId);
    const codes = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from print_agent_pairing_codes where tenant_id = ${cfg.tenantId}`,
    );
    expect(codes.rows[0]!.n).toBe(0);
  });

  it("an unknown code → agent.pairing_invalid", async () => {
    const cfg = await setup();
    expect(
      await codeOf(() =>
        asApp(suite.admin, cfg, (tx) => enrolAgent(tx, cfg, { code: "never-minted-code" })),
      ),
    ).toBe("agent.pairing_invalid");
  });

  it("a consumed (already-redeemed) code → agent.pairing_invalid", async () => {
    const cfg = await setup();
    const { code } = await asApp(suite.admin, cfg, (tx) =>
      generateAgentCode(tx, cfg, { label: "Once" }),
    );
    await asApp(suite.admin, cfg, (tx) => enrolAgent(tx, cfg, { code })); // consumes it
    expect(await codeOf(() => asApp(suite.admin, cfg, (tx) => enrolAgent(tx, cfg, { code })))).toBe(
      "agent.pairing_invalid",
    );
  });

  it("an expired code (past its TTL) → agent.pairing_expired", async () => {
    const cfg = await setup();
    // Seed a code whose created_at is well past PAIRING_TTL_MS (using the admin connection), then
    // redeem it: the row matches but the TTL check rejects it.
    const code = randomBytes(15).toString("base64url");
    const codeSha256 = createHash("sha256").update(code).digest("hex");
    const staleCreatedAt = new Date(Date.now() - PAIRING_TTL_MS - 60_000).toISOString();
    await suite.admin.execute(sql`
      insert into print_agent_pairing_codes (tenant_id, location_id, code_sha256, label, created_at)
      values (${cfg.tenantId}, ${cfg.locationId}, ${codeSha256}, 'Stale', ${staleCreatedAt})`);
    expect(await codeOf(() => asApp(suite.admin, cfg, (tx) => enrolAgent(tx, cfg, { code })))).toBe(
      "agent.pairing_expired",
    );
  });
});

describe("authenticateAgent", () => {
  /** Enrol one agent and return its config + bearer token. */
  async function enrolled(): Promise<{ cfg: PrintAgentConfig; agentId: string; token: string }> {
    const cfg = await setup();
    const { code } = await asApp(suite.admin, cfg, (tx) =>
      generateAgentCode(tx, cfg, { label: "Auth agent" }),
    );
    const { agentId, token } = await asApp(suite.admin, cfg, (tx) => enrolAgent(tx, cfg, { code }));
    return { cfg, agentId, token };
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

describe("enrolment single-use race (real Postgres)", () => {
  it("two concurrent enrolments of ONE code create exactly one agent; the loser is agent.pairing_invalid", async () => {
    const cfg = await setup();
    const { code } = await asApp(suite.admin, cfg, (tx) =>
      generateAgentCode(tx, cfg, { label: "Race" }),
    );

    // TWO distinct backends racing to redeem ONE code. Load-bearing: distinct backend PROCESSES — on
    // PGlite these collapse onto one and the race never happens (a false pass).
    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const pids = await Promise.all(
        [connA, connB].map(async (db) => {
          const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          return rows[0]!.pid;
        }),
      );
      expect(new Set(pids).size).toBe(2);

      // Both race past the locking DELETE … RETURNING. One row-locks the code, deletes it and enrols;
      // the other blocks, then — once the winner commits — matches zero rows and throws pairing_invalid.
      const results = await Promise.allSettled([
        asApp(connA, cfg, (tx) => enrolAgent(tx, cfg, { code })),
        asApp(connB, cfg, (tx) => enrolAgent(tx, cfg, { code })),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1); // exactly one enrolment succeeded
      expect(rejected).toHaveLength(1); // the loser was rejected
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "agent.pairing_invalid",
      });
      // The database agrees: exactly ONE agent row for this tenant — the loser filed nothing.
      expect(await agentCount(cfg)).toBe(1);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });
});

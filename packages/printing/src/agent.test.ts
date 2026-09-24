import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, printAgents, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { hashSecret } from "@waitron/identity";
import { authenticateAgent } from "./agent.js";
import type { PrintAgentConfig } from "./agent.js";
import "./errors.js";

const LOCALE = "es-ES";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function setup(): Promise<PrintAgentConfig> {
  await seedTenant(suite.db);
  const [row] = await suite.db
    .insert(locations)
    .values({
      name: "Bar",
      invoiceLocales: [LOCALE],
      operationDescription: "Sale on premises",
    })
    .returning({ id: locations.id });
  return { locationId: row!.id };
}

function asApp<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

async function lastSeenAt(agentId: string): Promise<string | null> {
  const [row] = await suite.db
    .select({ lastSeenAt: printAgents.lastSeenAt })
    .from(printAgents)
    .where(eq(printAgents.id, agentId));
  return row!.lastSeenAt;
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
    const [row] = await suite.db
      .insert(printAgents)
      .values({
        locationId: cfg.locationId,
        name: "Auth agent",
        tokenHash: hashSecret(secret),
        active: true,
      })
      .returning({ id: printAgents.id });
    const id = row!.id;
    return { cfg, agentId: id, token: `${id}.${secret}` };
  }

  it("a valid token resolves to its agentId and stamps last_seen_at", async () => {
    const { agentId, token } = await enrolled();
    expect(await lastSeenAt(agentId)).toBeNull();

    const result = await asApp(suite.db, (tx) => authenticateAgent(tx, token));
    expect(result.agentId).toBe(agentId);

    expect(await lastSeenAt(agentId)).not.toBeNull();
  });

  // Time is moved by writing `last_seen_at`, not by faking the clock — the value under test is the
  // one the gate reads.
  it("skips the sighting write inside the interval and makes it once the sighting is older", async () => {
    const { agentId, token } = await enrolled();
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

    const fresh = ago(1_000);
    await suite.db
      .update(printAgents)
      .set({ lastSeenAt: fresh })
      .where(eq(printAgents.id, agentId));
    await asApp(suite.db, (tx) => authenticateAgent(tx, token));
    expect(await lastSeenAt(agentId)).toBe(fresh);

    const stale = ago(90_000);
    await suite.db
      .update(printAgents)
      .set({ lastSeenAt: stale })
      .where(eq(printAgents.id, agentId));
    await asApp(suite.db, (tx) => authenticateAgent(tx, token));
    const written = await lastSeenAt(agentId);
    expect(written).not.toBe(stale);
    expect(Date.parse(written!)).toBeGreaterThan(Date.parse(stale));
  });

  it("a wrong token (tampered secret) → agent.unauthorized", async () => {
    const { agentId } = await enrolled();
    const forged = `${agentId}.${randomBytes(32).toString("base64url")}`;
    expect(await codeOf(() => asApp(suite.db, (tx) => authenticateAgent(tx, forged)))).toBe(
      "agent.unauthorized",
    );
  });

  it("a revoked (active=false) agent → agent.unauthorized", async () => {
    const { agentId, token } = await enrolled();
    await suite.db.update(printAgents).set({ active: false }).where(eq(printAgents.id, agentId));
    expect(await codeOf(() => asApp(suite.db, (tx) => authenticateAgent(tx, token)))).toBe(
      "agent.unauthorized",
    );
  });

  it("an unknown agent id → agent.unauthorized", async () => {
    const token = `${randomUUID()}.${randomBytes(32).toString("base64url")}`;
    expect(await codeOf(() => asApp(suite.db, (tx) => authenticateAgent(tx, token)))).toBe(
      "agent.unauthorized",
    );
  });

  it("a malformed token — no separator, trailing dot, or non-uuid selector — → agent.unauthorized", async () => {
    for (const bad of ["nodothere", "abc.", "not-a-uuid.somesecret"]) {
      expect(await codeOf(() => asApp(suite.db, (tx) => authenticateAgent(tx, bad)))).toBe(
        "agent.unauthorized",
      );
    }
  });
});

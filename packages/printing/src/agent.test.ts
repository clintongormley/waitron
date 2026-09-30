import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, locations, printAgents, withTransaction } from "@waitron/db";
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

async function lastSeenAt(agentId: string): Promise<string | null> {
  const [row] = await suite.db
    .select({ lastSeenAt: printAgents.lastSeenAt })
    .from(printAgents)
    .where(eq(printAgents.id, agentId));
  return row!.lastSeenAt;
}

/**
 * Holds the venue's write lock open until `release` is called. `during` runs inside the held
 * transaction first, so what it writes commits only on release.
 */
function holdWriteLock(during?: () => Promise<unknown>): {
  release: () => void;
  done: Promise<void>;
} {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = withTransaction(suite.db, async () => {
    await during?.();
    await opened;
  });
  return { release: () => release(), done };
}

/**
 * Counts the callers that have asked `suite.db` for the write lock and been queued behind whoever
 * holds it. `requested(n)` resolves at the n-th; `restore` puts the real method back.
 */
function watchLockRequests(): {
  requested: (count: number) => Promise<void>;
  seen: () => number;
  restore: () => void;
} {
  const original = suite.db.withWriteLock;
  let seen = 0;
  const waiters: { count: number; resolve: () => void }[] = [];
  const spy = vi.spyOn(suite.db, "withWriteLock").mockImplementation((body) => {
    const queued = original(body);
    seen += 1;
    for (const waiter of waiters) if (seen >= waiter.count) waiter.resolve();
    return queued;
  });
  return {
    requested: (count) =>
      seen >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiters.push({ count, resolve });
          }),
    seen: () => seen,
    restore: () => spy.mockRestore(),
  };
}

/** What `outcome` settles to, or "still waiting" if it has not settled within two seconds. */
async function within(outcome: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      outcome,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("still waiting"), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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

    const result = await authenticateAgent(suite.db, token);
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
    await authenticateAgent(suite.db, token);
    expect(await lastSeenAt(agentId)).toBe(fresh);

    const stale = ago(90_000);
    await suite.db
      .update(printAgents)
      .set({ lastSeenAt: stale })
      .where(eq(printAgents.id, agentId));
    await authenticateAgent(suite.db, token);
    const written = await lastSeenAt(agentId);
    expect(written).not.toBe(stale);
    expect(Date.parse(written!)).toBeGreaterThan(Date.parse(stale));
  });

  it("a wrong token (tampered secret) → agent.unauthorized", async () => {
    const { agentId } = await enrolled();
    const forged = `${agentId}.${randomBytes(32).toString("base64url")}`;
    expect(await codeOf(() => authenticateAgent(suite.db, forged))).toBe("agent.unauthorized");
  });

  it("a revoked (active=false) agent → agent.unauthorized", async () => {
    const { agentId, token } = await enrolled();
    await suite.db.update(printAgents).set({ active: false }).where(eq(printAgents.id, agentId));
    expect(await codeOf(() => authenticateAgent(suite.db, token))).toBe("agent.unauthorized");
  });

  it("an unknown agent id → agent.unauthorized", async () => {
    const token = `${randomUUID()}.${randomBytes(32).toString("base64url")}`;
    expect(await codeOf(() => authenticateAgent(suite.db, token))).toBe("agent.unauthorized");
  });

  it("lets another writer commit while it derives the key", async () => {
    const { cfg, token } = await enrolled();
    const order: string[] = [];
    const authenticated = authenticateAgent(suite.db, token).then(() =>
      order.push("authenticated"),
    );
    const written = new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        withTransaction(suite.db, (tx) =>
          tx.update(locations).set({ name: "Bar" }).where(eq(locations.id, cfg.locationId)),
        )
          .then(() => {
            order.push("writer");
            resolve();
          })
          .catch(reject);
      });
    });
    await Promise.all([authenticated, written]);
    expect(order).toEqual(["writer", "authenticated"]);
  });

  it("authenticates while another caller holds the write lock, when no sighting is due", async () => {
    const { agentId, token } = await enrolled();
    await suite.db
      .update(printAgents)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(printAgents.id, agentId));
    const lock = holdWriteLock();
    const auth = authenticateAgent(suite.db, token);
    try {
      expect(await within(auth.then((result) => result.agentId))).toBe(agentId);
    } finally {
      lock.release();
      await lock.done;
      await auth;
    }
  });

  it("refuses a revoked agent and a wrong token while the write lock is held", async () => {
    const { agentId, token } = await enrolled();
    await suite.db
      .update(printAgents)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(printAgents.id, agentId));
    const forged = `${agentId}.${randomBytes(32).toString("base64url")}`;
    const lock = holdWriteLock();
    try {
      expect(await within(codeOf(() => authenticateAgent(suite.db, forged)))).toBe(
        "agent.unauthorized",
      );
    } finally {
      lock.release();
      await lock.done;
    }
    await suite.db.update(printAgents).set({ active: false }).where(eq(printAgents.id, agentId));
    const again = holdWriteLock();
    try {
      expect(await within(codeOf(() => authenticateAgent(suite.db, token)))).toBe(
        "agent.unauthorized",
      );
    } finally {
      again.release();
      await again.done;
    }
  });

  // The change is written inside the held transaction, so the lock-free reads cannot see it; it
  // commits on release, after the call has queued for the lock to record its sighting.
  it.each([
    ["revoked", { active: false }],
    ["re-keyed", { tokenHash: hashSecret(randomBytes(32).toString("base64url")) }],
  ] as const)(
    "refuses an agent %s while it waits for the lock to record a sighting",
    async (_label, change) => {
      const { agentId, token } = await enrolled();
      expect(await lastSeenAt(agentId)).toBeNull();
      const lock = holdWriteLock(() =>
        suite.db.update(printAgents).set(change).where(eq(printAgents.id, agentId)),
      );
      const watch = watchLockRequests();
      let auth: Promise<string | undefined> | undefined;
      try {
        auth = codeOf(() => authenticateAgent(suite.db, token));
        await Promise.race([watch.requested(1), auth]);
        expect(watch.seen()).toBe(1);
      } finally {
        watch.restore();
        lock.release();
        await lock.done;
      }
      expect(await auth).toBe("agent.unauthorized");
      expect(await lastSeenAt(agentId)).toBeNull();
    },
  );

  it("writes one sighting when several calls find it due at once", async () => {
    const { agentId, token } = await enrolled();
    await suite.db
      .update(printAgents)
      .set({ lastSeenAt: new Date(Date.now() - 90_000).toISOString() })
      .where(eq(printAgents.id, agentId));
    await suite.db.execute(sql`create table sighting_writes (n integer)`);
    await suite.db.execute(sql`
      create trigger count_sighting_writes after update of last_seen_at on print_agents
      begin insert into sighting_writes values (1); end`);
    try {
      // Every call reads the stale row and queues for the lock before any of them writes.
      const CALLS = 6;
      const lock = holdWriteLock();
      const watch = watchLockRequests();
      let calls: Promise<{ agentId: string }>[] = [];
      try {
        calls = Array.from({ length: CALLS }, () => authenticateAgent(suite.db, token));
        await Promise.race([watch.requested(CALLS), Promise.allSettled(calls)]);
        expect(watch.seen()).toBe(CALLS);
      } finally {
        watch.restore();
        lock.release();
        await lock.done;
      }
      const results = await Promise.all(calls);
      expect(results.map((result) => result.agentId)).toEqual(Array(CALLS).fill(agentId));
      const { rows } = await suite.db.execute<{ writes: number }>(
        sql`select count(*) as writes from sighting_writes`,
      );
      expect(rows[0]!.writes).toBe(1);
    } finally {
      await suite.db.execute(sql`drop trigger count_sighting_writes`);
      await suite.db.execute(sql`drop table sighting_writes`);
    }
  });

  it("refuses an agent revoked while its key is being derived", async () => {
    const { agentId, token } = await enrolled();
    // No sighting is due, so the write that re-checks the row inside the lock never runs.
    await suite.db
      .update(printAgents)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(printAgents.id, agentId));
    const revoked = new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        withTransaction(suite.db, (tx) =>
          tx.update(printAgents).set({ active: false }).where(eq(printAgents.id, agentId)),
        )
          .then(() => resolve())
          .catch(reject);
      });
    });
    const code = await codeOf(() => authenticateAgent(suite.db, token));
    await revoked;
    expect(code).toBe("agent.unauthorized");
  });

  it("refuses a token whose agent was re-keyed while its key was being derived", async () => {
    const { agentId, token } = await enrolled();
    // No sighting is due, so the write that re-checks the row inside the lock never runs.
    await suite.db
      .update(printAgents)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(printAgents.id, agentId));
    const rekeyed = new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        withTransaction(suite.db, (tx) =>
          tx
            .update(printAgents)
            .set({ tokenHash: hashSecret(randomBytes(32).toString("base64url")) })
            .where(eq(printAgents.id, agentId)),
        )
          .then(() => resolve())
          .catch(reject);
      });
    });
    const code = await codeOf(() => authenticateAgent(suite.db, token));
    await rekeyed;
    expect(code).toBe("agent.unauthorized");
  });

  it("a malformed token — no separator, trailing dot, or non-uuid selector — → agent.unauthorized", async () => {
    for (const bad of ["nodothere", "abc.", "not-a-uuid.somesecret"]) {
      expect(await codeOf(() => authenticateAgent(suite.db, bad))).toBe("agent.unauthorized");
    }
  });
});

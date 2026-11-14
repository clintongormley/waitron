import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, printAgents, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { hashDeviceToken, hashSecret } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { authenticateAgent } from "./agent.js";
import "./errors.js";

const LOCALE = "es-ES";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function setup(): Promise<void> {
  await seedVenue(suite.db, {
    name: "Bar",
    invoiceLocales: [LOCALE],
    operationDescription: "Sale on premises",
  });
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
   * return its bearer token — the `${agentId}.${secret}` shape `authenticateAgent` parses. */
  async function enrolled(): Promise<{ agentId: string; token: string }> {
    await setup();
    const secret = randomBytes(32).toString("base64url");
    const [row] = await suite.db
      .insert(printAgents)
      .values({
        name: "Auth agent",
        tokenHash: hashDeviceToken(secret),
        active: true,
      })
      .returning({ id: printAgents.id });
    const id = row!.id;
    return { agentId: id, token: `${id}.${secret}` };
  }

  const setActive = (agentId: string, active: boolean) =>
    suite.db.update(printAgents).set({ active }).where(eq(printAgents.id, agentId));

  /** Makes the agent's last sighting 90 seconds old, so a new one is due. */
  const makeSightingDue = (agentId: string) =>
    suite.db
      .update(printAgents)
      .set({ lastSeenAt: new Date(Date.now() - 90_000).toISOString() })
      .where(eq(printAgents.id, agentId));

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

  it("a row still holding the token's old scrypt hash → agent.unauthorized", async () => {
    const { agentId, token } = await enrolled();
    const secret = token.slice(token.indexOf(".") + 1);
    await suite.db
      .update(printAgents)
      .set({ tokenHash: hashSecret(secret) })
      .where(eq(printAgents.id, agentId));
    expect(await codeOf(() => authenticateAgent(suite.db, token))).toBe("agent.unauthorized");
    expect(await lastSeenAt(agentId)).toBeNull();
  });

  it("a revoked (active=false) agent → agent.unauthorized", async () => {
    const { agentId, token } = await enrolled();
    await setActive(agentId, false);
    expect(await codeOf(() => authenticateAgent(suite.db, token))).toBe("agent.unauthorized");
  });

  it("an unknown agent id → agent.unauthorized", async () => {
    const token = `${randomUUID()}.${randomBytes(32).toString("base64url")}`;
    expect(await codeOf(() => authenticateAgent(suite.db, token))).toBe("agent.unauthorized");
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
    await setActive(agentId, false);
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
    ["re-keyed", { tokenHash: hashDeviceToken(randomBytes(32).toString("base64url")) }],
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
    await makeSightingDue(agentId);
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

  it("a malformed token — no separator, trailing dot, or non-uuid selector — → agent.unauthorized", async () => {
    for (const bad of ["nodothere", "abc.", "not-a-uuid.somesecret"]) {
      expect(await codeOf(() => authenticateAgent(suite.db, bad))).toBe("agent.unauthorized");
    }
  });

  describe("when the sighting write is refused", () => {
    /** The venue database, except that every write turn runs `before` and then rejects with `error`. */
    function sightingRefused(error: Error, before: () => Promise<unknown> = async () => {}) {
      return Object.create(suite.db, {
        withWriteLock: {
          value: async () => {
            await before();
            throw error;
          },
        },
      }) as Database;
    }
    const diskFull = () => new AppError("storage.disk_full", {});

    it("a full disk still authenticates the agent, and saves no sighting", async () => {
      const { agentId, token } = await enrolled();
      expect(await authenticateAgent(sightingRefused(diskFull()), token)).toEqual({ agentId });
      expect(await lastSeenAt(agentId)).toBeNull();
    });

    it("on a full disk, an agent revoked meanwhile is refused", async () => {
      const { agentId, token } = await enrolled();
      const db = sightingRefused(diskFull(), () => setActive(agentId, false));
      expect(await codeOf(() => authenticateAgent(db, token))).toBe("agent.unauthorized");
    });

    it("on a full disk, an agent re-keyed meanwhile is refused", async () => {
      const { agentId, token } = await enrolled();
      const db = sightingRefused(diskFull(), () =>
        suite.db
          .update(printAgents)
          .set({ tokenHash: hashDeviceToken(randomBytes(32).toString("base64url")) })
          .where(eq(printAgents.id, agentId)),
      );
      expect(await codeOf(() => authenticateAgent(db, token))).toBe("agent.unauthorized");
    });

    it("on a full disk, a token whose agent was revoked meanwhile is refused, and accepted once active again", async () => {
      const { agentId, token } = await enrolled();
      await authenticateAgent(suite.db, token);
      await makeSightingDue(agentId);
      const db = sightingRefused(diskFull(), () => setActive(agentId, false));
      expect(await codeOf(() => authenticateAgent(db, token))).toBe("agent.unauthorized");

      await setActive(agentId, true);
      expect(await authenticateAgent(suite.db, token)).toEqual({ agentId });
    });

    it("any other failure still fails the call", async () => {
      const { agentId, token } = await enrolled();
      const boom = new Error("boom");
      await expect(authenticateAgent(sightingRefused(boom), token)).rejects.toBe(boom);
      expect(await lastSeenAt(agentId)).toBeNull();
    });
  });

  describe("a token that has signed in before", () => {
    it("refuses the old token after a re-key and accepts the new one", async () => {
      const { agentId, token } = await enrolled();
      await authenticateAgent(suite.db, token);
      const newSecret = randomBytes(32).toString("base64url");
      await suite.db
        .update(printAgents)
        .set({ tokenHash: hashDeviceToken(newSecret) })
        .where(eq(printAgents.id, agentId));

      expect(await codeOf(() => authenticateAgent(suite.db, token))).toBe("agent.unauthorized");
      expect(await authenticateAgent(suite.db, `${agentId}.${newSecret}`)).toEqual({ agentId });
    });

    it("refuses a different secret for the agent, and still accepts the right one", async () => {
      const { agentId, token } = await enrolled();
      await authenticateAgent(suite.db, token);
      const forged = `${agentId}.${randomBytes(32).toString("base64url")}`;

      expect(await codeOf(() => authenticateAgent(suite.db, forged))).toBe("agent.unauthorized");
      expect(await authenticateAgent(suite.db, token)).toEqual({ agentId });
    });

    it("refuses the token when the sighting write finds the agent revoked, and accepts it once active again", async () => {
      const { agentId, token } = await enrolled();
      await authenticateAgent(suite.db, token);
      await makeSightingDue(agentId);

      // Written inside the held transaction, so the lock-free read still finds the agent active.
      const lock = holdWriteLock(() => setActive(agentId, false));
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

      await setActive(agentId, true);
      expect(await authenticateAgent(suite.db, token)).toEqual({ agentId });
    });
  });
});

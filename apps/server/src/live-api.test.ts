// This suite checks route authorization and stream lifecycle; what the database itself delivers is
// `packages/db/src/change-feed.test.ts`.
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_CHANGE_SOURCES,
  CORE_MIGRATIONS,
  diningTables,
  installChangeFeed,
  locations,
  subscribeToChanges,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  IDENTITY_MIGRATIONS,
  hashPin,
  managementSessions,
  persons,
  startManagementSession,
  resolveManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { ResourceChange } from "@waitron/shared";
import type { Logger } from "./logger.js";
import { LiveEvents, changeSubscriber, mountLiveApi } from "./live-api.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

async function fixture() {
  await seedTenant(suite.db);
  const session = await withTransaction(suite.db, async (tx) => {
    // Through the table definition, the change `apps/server/src/testing/fiscal-fixtures.ts` took:
    // `persons.id` and `persons.created_at` are `$defaultFn` generators on this engine which a raw
    // insert never reaches, and both columns are NOT NULL.
    const [p] = await tx
      .insert(persons)
      .values({ displayName: "Manager", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    return startManagementSession(tx, { personId: p!.id });
  });
  const bus = new LiveEvents();
  const app = new Hono();
  mountLiveApi(app, { db: suite.db, bus, resourceTypes: ["printers", "print_jobs"] }, () => {});
  const path = `/management-api/events?resources=${encodeURIComponent(JSON.stringify([{ type: "printers", id: "p1" }]))}`;
  const cookie = `${MANAGEMENT_COOKIE}=${session.id}`;
  return { app, bus, path, cookie, session };
}

describe("management live events", () => {
  it("requires an authenticated session before opening the stream", async () => {
    const { app, path } = await fixture();
    const response = await app.request(path);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "management_session.required" } });
  });

  it("sends only subscribed identities and releases the subscription", async () => {
    const { app, path, cookie, bus } = await fixture();
    const response = await app.request(path, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
      expect(bus.subscriberCount).toBe(1);
      bus.publish({ resources: [{ type: "printers", id: "p2" }] });
      bus.publish({ resources: [{ type: "printers", id: "p1" }] });
      const message = new TextDecoder().decode((await reader.read()).value);
      expect(message).toBe('event: change\ndata: [{"type":"printers","id":"p1"}]\n\n');
    } finally {
      await reader.cancel();
    }
    await vi.waitFor(() => expect(bus.subscriberCount).toBe(0));
  });

  it("does not extend the session and closes it when the next change finds it expired", async () => {
    const { app, path, cookie, bus, session } = await fixture();
    // The clock is read in JavaScript and the instant bound: this engine has neither `now()` nor an
    // interval type. Each of these is one statement, so there is no transaction-start reading of
    // `now()` that two statements had to share.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    await suite.db.execute(
      sql`update management_sessions set last_seen_at = ${tenMinutesAgo} where id = ${session.id}`,
    );
    const before = await withTransaction(suite.db, (tx) =>
      resolveManagementSession(tx, session.id, { touch: false }),
    );
    const response = await app.request(path, { headers: { cookie } });
    const reader = response.body!.getReader();
    try {
      await reader.read();
      const after = await withTransaction(suite.db, (tx) =>
        resolveManagementSession(tx, session.id, { touch: false }),
      );
      expect(after.expiresAt).toBe(before.expiresAt);
      const anHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
      await suite.db.execute(
        sql`update management_sessions set last_seen_at = ${anHourAgo} where id = ${session.id}`,
      );
      bus.publish({ resources: [{ type: "printers", id: "p1" }] });
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(
        'event: session-invalid\ndata: {"code":"management_session.expired"}',
      );
      expect((await reader.read()).done).toBe(true);
    } finally {
      await reader.cancel();
    }
  });
});

it.each([
  undefined,
  "not-json",
  "null",
  "[]",
  JSON.stringify(Array.from({ length: 129 }, () => ({ type: "printers" }))),
  "[null]",
  '[{"type":"unknown"}]',
  '[{"type":"printers","id":""}]',
  '[{"type":"printers","id":1}]',
  JSON.stringify([{ type: "printers", id: "a".repeat(201) }]),
])("rejects invalid or unknown subscription interests: %s", async (resources) => {
  const { app, cookie, bus } = await fixture();
  const response = await app.request(
    `/management-api/events${resources === undefined ? "" : `?resources=${encodeURIComponent(resources)}`}`,
    { headers: { cookie } },
  );
  expect(response.status).toBe(400);
  expect(bus.subscriberCount).toBe(0);
});

it("closes streams during server shutdown", async () => {
  const { app, path, cookie, bus } = await fixture();
  const response = await app.request(path, { headers: { cookie } });
  const reader = response.body!.getReader();
  try {
    await reader.read();
    bus.close();
    expect((await reader.read()).done).toBe(true);
    expect(bus.subscriberCount).toBe(0);
    const late = vi.fn();
    bus.subscribe(late)();
    await Promise.resolve();
    expect(late).toHaveBeenCalledExactlyOnceWith({ kind: "close" });
  } finally {
    await reader.cancel();
  }
});

it("bounds a burst of identities with a reset", async () => {
  const { app, cookie, bus } = await fixture();
  const path = `/management-api/events?resources=${encodeURIComponent('[{"type":"printers"}]')}`;
  const response = await app.request(path, { headers: { cookie } });
  const reader = response.body!.getReader();
  try {
    await reader.read();
    for (let i = 0; i < 300; i++) bus.publish({ resources: [{ type: "printers", id: String(i) }] });
    const message = new TextDecoder().decode((await reader.read()).value);
    expect(message).toContain("event: reset");
    expect(message.length).toBeLessThan(12_000);
  } finally {
    await reader.cancel();
  }
});

it("revalidates idle streams on the heartbeat without extending their session", async () => {
  const { app, path, cookie, session } = await fixture();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const response = await app.request(path, { headers: { cookie } });
  const reader = response.body!.getReader();
  try {
    await reader.read();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: keepalive");
    // Fake timers are installed for `setInterval` only (`toFake` above), so `Date.now()` here is
    // still the real clock and this instant really is an hour in the session's past.
    const anHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    await suite.db.execute(
      sql`update management_sessions set last_seen_at = ${anHourAgo} where id = ${session.id}`,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "event: session-invalid",
    );
    expect((await reader.read()).done).toBe(true);
  } finally {
    await reader.cancel();
    vi.useRealTimers();
  }
});

it("closes the stream with session-invalid when the person is suspended while it is open", async () => {
  const { app, path, cookie, bus, session } = await fixture();
  const response = await app.request(path, { headers: { cookie } });
  const reader = response.body!.getReader();
  try {
    await reader.read();
    const [row] = await suite.db
      .select({ personId: managementSessions.personId })
      .from(managementSessions)
      .where(eq(managementSessions.id, session.id));
    await suite.db
      .update(persons)
      .set({ status: "suspended" })
      .where(eq(persons.id, row!.personId));
    bus.publish({ resources: [{ type: "printers", id: "p1" }] });
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      'event: session-invalid\ndata: {"code":"person.suspended"}\n\n',
    );
    expect((await reader.read()).done).toBe(true);
  } finally {
    await reader.cancel();
  }
});

it("logs and ends the stream, without a session-invalid event, when revalidation fails for another reason", async () => {
  const { cookie, path } = await fixture();
  const bus = new LiveEvents();
  const log = vi.fn<Logger>();
  const app = new Hono();
  mountLiveApi(app, { db: suite.db, bus, resourceTypes: ["printers"] }, log);
  const response = await app.request(path, { headers: { cookie } });
  const reader = response.body!.getReader();
  await suite.db.execute(sql`alter table management_sessions rename to management_sessions_away`);
  try {
    await reader.read();
    bus.publish({ resources: [{ type: "printers", id: "p1" }] });
    expect((await reader.read()).done).toBe(true);
    expect(log).toHaveBeenCalledWith("warn", "live.stream_failed", { errorCode: "unknown" });
    expect(bus.subscriberCount).toBe(0);
  } finally {
    await suite.db.execute(sql`alter table management_sessions_away rename to management_sessions`);
    await reader.cancel();
  }
});

it("ends without sending a change that was pending when the server shut down mid-revalidation", async () => {
  const { app, path, cookie, bus } = await fixture();
  const response = await app.request(path, { headers: { cookie } });
  const reader = response.body!.getReader();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await reader.read();
    // Holding the one write transaction keeps the stream's revalidation queued behind it.
    const holding = withTransaction(suite.db, () => held);
    bus.publish({ resources: [{ type: "printers", id: "p1" }] });
    await new Promise((resolve) => setImmediate(resolve));
    bus.close();
    release();
    await holding;
    expect((await reader.read()).done).toBe(true);
  } finally {
    release();
    await reader.cancel();
  }
});

describe("the change subscriber", () => {
  it("hands each change to the bus", () => {
    const bus = new LiveEvents();
    const seen: ResourceChange[] = [];
    bus.subscribe((event) => {
      if (event.kind === "change") seen.push(event.change);
    });
    changeSubscriber(bus, () => {})({ resources: [{ type: "printers", id: "p1" }] });
    expect(seen).toEqual([{ resources: [{ type: "printers", id: "p1" }] }]);
  });

  it("logs and swallows a failing subscriber instead of failing the committed write", () => {
    const bus = new LiveEvents();
    bus.subscribe(() => {
      throw new Error("a subscriber blew up");
    });
    const lines: [string, string, Record<string, unknown> | undefined][] = [];
    const log: Logger = (level, event, fields) => lines.push([level, event, fields]);
    expect(() =>
      changeSubscriber(bus, log)({ resources: [{ type: "printers", id: "p1" }] }),
    ).not.toThrow();
    expect(lines).toEqual([["warn", "live.publish_failed", { errorCode: "unknown" }]]);
  });
});

it("delivers a write made outside withTransaction on the next transaction the process runs", async () => {
  // A development script writing the database directly leaves its change row behind: the trigger
  // still fills `change_log`, but nothing in this process has a transaction open to take it out.
  // The drain is unfiltered, so the next transaction that does run carries it — here the stream's
  // own fifteen-second session check.
  const { cookie, bus } = await fixture();
  const app = new Hono();
  mountLiveApi(app, { db: suite.db, bus, resourceTypes: ["dining_tables"] }, () => {});
  // KEEP THIS THE LAST TEST IN THE FILE while this call lives inside it: the triggers it installs
  // stay on the suite's one database for everything that runs after, so a test appended below would
  // silently write change rows — and pay for them — without asking. Hoisting the call into
  // `fixture()` instead would do that to every test in the file.
  await installChangeFeed(suite.db, CORE_CHANGE_SOURCES);
  const unsubscribe = subscribeToChanges(changeSubscriber(bus, () => {}));
  const path = `/management-api/events?resources=${encodeURIComponent('[{"type":"dining_tables"}]')}`;
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const response = await app.request(path, { headers: { cookie } });
  const reader = response.body!.getReader();
  try {
    await reader.read();
    const [location] = await suite.db
      .insert(locations)
      .values({ name: "Probe", invoiceLocales: ["es"], operationDescription: "probe" })
      .returning({ id: locations.id });
    await suite.db.insert(diningTables).values({ locationId: location!.id, label: "T9" });
    // No `::int`: `count(*)` already comes back as a JavaScript number here, and the cast operator
    // is a syntax error to this parser (`unrecognized token: ":"`).
    const waiting = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from change_log`,
    );
    expect(waiting.rows[0]!.n).toBe(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: change");
  } finally {
    await reader.cancel();
    unsubscribe();
    bus.close();
    vi.useRealTimers();
  }
});

// PGlite checks route authorization and stream lifecycle; change-feed.pg.test.ts checks DB delivery.
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  IDENTITY_MIGRATIONS,
  hashPin,
  startManagementSession,
  resolveManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { LiveEvents, mountLiveApi } from "./live-api.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

async function fixture() {
  await seedTenant(suite.db);
  const session = await withTransaction(suite.db, async (tx) => {
    const p = await tx.execute<{ id: string }>(
      sql`insert into persons (display_name, pin_hash, role) values ('Manager', ${hashPin("1234")}, 'manager') returning id`,
    );
    return startManagementSession(tx, { personId: p.rows[0]!.id });
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
    await suite.db.execute(
      sql`update management_sessions set last_seen_at = now() - interval '10 minutes' where id = ${session.id}`,
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
      await suite.db.execute(
        sql`update management_sessions set last_seen_at = now() - interval '1 hour' where id = ${session.id}`,
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

it("refreshes snapshots after listener reset and closes streams during server shutdown", async () => {
  const { app, path, cookie, bus } = await fixture();
  const response = await app.request(path, { headers: { cookie } });
  const reader = response.body!.getReader();
  try {
    await reader.read();
    bus.reset();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: reset");
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
    await suite.db.execute(
      sql`update management_sessions set last_seen_at = now() - interval '1 hour' where id = ${session.id}`,
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

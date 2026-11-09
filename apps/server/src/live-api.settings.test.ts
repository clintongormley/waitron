import { Hono } from "hono";
import { expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  CORE_CHANGE_SOURCES,
  defineSettingsDocument,
  installChangeFeed,
  saveSettings,
  subscribeToChanges,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { LiveEvents, changeSubscriber, mountLiveApi } from "./live-api.js";
import { liveResourceTypes } from "./live-resources.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  setup: (db) => installChangeFeed(db, CORE_CHANGE_SOURCES),
});
const document = (module: string) =>
  defineSettingsDocument({
    module,
    version: 1,
    transfers: false,
    defaults: () => ({ note: "" }),
    parse: (doc: unknown) =>
      typeof doc === "object" && doc !== null && "note" in doc && typeof doc.note === "string"
        ? { ok: true as const, doc: { note: doc.note } }
        : { ok: false as const, field: "note" },
  });
async function fixture() {
  await seedTenant(suite.db);
  const session = await withTransaction(suite.db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Manager", role: "manager" })
      .returning();
    return startManagementSession(tx, { personId: person!.id });
  });
  const bus = new LiveEvents();
  const app = new Hono();
  mountLiveApi(
    app,
    { db: suite.db, bus, resourceTypes: liveResourceTypes(CORE_CHANGE_SOURCES, ["venue", "menu"]) },
    () => {},
  );
  return { app, bus, cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
}
function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no event within 5 s")), 5_000);
    reader.read().then(
      (value) => {
        clearTimeout(timer);
        resolve(new TextDecoder().decode(value.value));
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
const path = (type: string) =>
  `/management-api/events?resources=${encodeURIComponent(JSON.stringify([{ type }]))}`;

it("a save to one module's document wakes only that module's subscribers", async () => {
  const { app, bus, cookie } = await fixture();
  const unsubscribe = subscribeToChanges(changeSubscriber(bus, () => {}));
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  try {
    for (const type of ["settings.venue", "settings.menu"]) {
      const response = await app.request(path(type), { headers: { cookie } });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      readers.push(reader);
      expect(await readWithin(reader)).toContain("event: ready");
    }
    await withTransaction(suite.db, (tx) =>
      saveSettings(tx, document("menu"), {
        doc: { note: "menu changed" },
        expectedRevision: 0,
        personId: null,
      }),
    );
    expect(await readWithin(readers[1]!)).toBe(
      'event: change\ndata: [{"type":"settings.menu"}]\n\n',
    );
    await withTransaction(suite.db, (tx) =>
      saveSettings(tx, document("venue"), {
        doc: { note: "venue changed" },
        expectedRevision: 0,
        personId: null,
      }),
    );
    expect(await readWithin(readers[0]!)).toBe(
      'event: change\ndata: [{"type":"settings.venue"}]\n\n',
    );
  } finally {
    for (const reader of readers) await reader.cancel();
    unsubscribe();
    bus.close();
  }
}, 20_000);

it("refuses a subscription to the bare settings type", async () => {
  const { app, bus, cookie } = await fixture();
  const controller = new AbortController();
  try {
    const response = await app.request(path("settings"), {
      headers: { cookie },
      signal: controller.signal,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "resources" } },
    });
  } finally {
    controller.abort();
    bus.close();
  }
});

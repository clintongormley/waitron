import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import {
  devices,
  deviceProfiles,
  kitchenStations,
  kitchenCourses,
  locations,
  products,
  printers,
  stationPrinters,
} from "@waitron/db";
import { persons } from "@waitron/identity";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setDeviceKitchenScreens, setProfileKitchenScreens } from "@waitron/venue-service";
import { createCourse, createStation } from "./kitchen.js";
import { mountManagementApi } from "./management-api.js";
import { inTx, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;
let app: Hono;
let cookie: string;
let station: string;
let course: string;
beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  station = (await inTx(v, (tx) => createStation(tx, v.cfg, { name: "Grill" }))).id;
  course = (await inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Main" }))).id;
  app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: v.cfg,
      venueCfg: v.cfg,
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
    },
    () => {},
  );
  const login = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "dashPass123" }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});
function request(
  kind: "courses" | "stations",
  method: string,
  id = kind === "courses" ? course : station,
  suffix = "",
  body?: unknown,
  session = cookie,
) {
  return app.request(`/management-api/${kind}/${id}${suffix}`, {
    method,
    headers: { "content-type": "application/json", cookie: session },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function impact(kind: "courses" | "stations") {
  return {
    target: {
      id: kind === "courses" ? course : station,
      name: kind === "courses" ? "Main" : "Grill",
    },
    refusals: [],
    ends: [],
    removes: [],
  };
}
it.each(["courses", "stations"] as const)(
  "%s returns complete impact and recomputes deletion",
  async (kind) => {
    const preview = await request(kind, "GET", undefined, "/delete-impact");
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual(impact(kind));
    if (kind === "courses") {
      await suite.db
        .update(products)
        .set({ courseId: course })
        .where(eq(products.id, v.productId("Burger")));
    } else {
      const [printer] = await suite.db
        .insert(printers)
        .values({
          name: "Kitchen",
          locationId: v.cfg.locationId,
          transport: "network_tcp",
          host: "192.0.2.1",
          port: 9100,
        })
        .returning();
      await suite.db.insert(stationPrinters).values({ stationId: station, printerId: printer!.id });
    }
    const answer = await request(kind, "DELETE");
    expect(answer.status).toBe(200);
    const names = kind === "courses" ? [] : await suite.db.select().from(printers);
    expect(await answer.json()).toEqual({
      ...impact(kind),
      removes:
        kind === "courses"
          ? [{ key: "course_products", count: 1, targets: [] }]
          : [
              {
                key: "station_printers",
                count: 1,
                targets: [{ id: names[0]!.id, name: "Kitchen" }],
              },
            ],
    });
    if (kind === "courses")
      expect(
        (
          await suite.db
            .select()
            .from(products)
            .where(eq(products.id, v.productId("Burger")))
        )[0]!.courseId,
      ).toBeNull();
    else expect(await suite.db.select().from(stationPrinters)).toEqual([]);
    for (const [method, suffix, body] of [
      ["GET", "/delete-impact", undefined],
      ["DELETE", "", undefined],
      ["PATCH", "", {}],
      ["PATCH", "", { name: "Changed" }],
    ] as const) {
      const again = await request(kind, method, undefined, suffix, body);
      expect(again.status).toBe(404);
      expect(await again.json()).toMatchObject({
        error: {
          code: kind === "courses" ? "course.not_found" : "station.not_found",
          params: {
            [kind === "courses" ? "courseId" : "stationId"]: kind === "courses" ? course : station,
          },
        },
      });
    }
    const list = await app.request(`/management-api/${kind}?includeDisabled=true`, {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    expect(await list.json()).not.toContainEqual(
      expect.objectContaining({ id: kind === "courses" ? course : station }),
    );
  },
);
it.each(["courses", "stations"] as const)("%s rejects any active PATCH presence", async (kind) => {
  for (const active of [true, false, null, "true", [true]]) {
    const answer = await request(kind, "PATCH", undefined, "", { active, name: "Unexpected" });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "active" } },
    });
  }
  const answer = await request(kind, "GET", undefined, "/delete-impact");
  expect(answer.status).toBe(200);
  expect(await answer.json()).toEqual(impact(kind));
});
it.each(["courses", "stations"] as const)(
  "%s impact and delete require configuration permission and a session",
  async (kind) => {
    for (const [method, suffix] of [
      ["GET", "/delete-impact"],
      ["DELETE", ""],
    ] as const) {
      const answer = await request(kind, method, undefined, suffix, undefined, "");
      expect(answer.status).toBe(401);
      expect(await answer.json()).toMatchObject({ error: { code: "management_session.required" } });
    }
    await suite.db
      .update(persons)
      .set({ role: "supervisor" })
      .where(eq(persons.email, "owner@example.test"));
    expect((await app.request(`/management-api/${kind}`, { headers: { cookie } })).status).toBe(
      200,
    );
    for (const [method, suffix] of [
      ["GET", "/delete-impact"],
      ["DELETE", ""],
    ] as const) {
      const answer = await request(kind, method, undefined, suffix);
      expect(answer.status).toBe(403);
      expect(await answer.json()).toMatchObject({
        error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
      });
    }
  },
);
it.each(["courses", "stations"] as const)(
  "%s unknown, malformed and foreign ids are not found",
  async (kind) => {
    const [location] = await suite.db
      .insert(locations)
      .values({ name: "Elsewhere", invoiceLocales: ["es-ES"], operationDescription: "Bar" })
      .returning();
    const foreign = randomUUID();
    if (kind === "courses")
      await suite.db
        .insert(kitchenCourses)
        .values({ id: foreign, locationId: location!.id, name: "Elsewhere" });
    else
      await suite.db
        .insert(kitchenStations)
        .values({ id: foreign, locationId: location!.id, name: "Elsewhere" });
    for (const id of [randomUUID(), "not-a-uuid", foreign])
      for (const [method, suffix] of [
        ["GET", "/delete-impact"],
        ["DELETE", ""],
        ["PATCH", ""],
      ] as const) {
        const answer = await request(kind, method, id, suffix, method === "PATCH" ? {} : undefined);
        expect(answer.status).toBe(404);
        expect(await answer.json()).toMatchObject({
          error: {
            code: kind === "courses" ? "course.not_found" : "station.not_found",
            params: { [kind === "courses" ? "courseId" : "stationId"]: id },
          },
        });
      }
  },
);
it("rejects every legacy course disable query without deleting", async () => {
  for (const value of ["", "true", "false", "1"]) {
    const answer = await request("courses", "DELETE", course, `?disable=${value}`);
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "disable" } },
    });
  }
  expect((await request("courses", "GET", course, "/delete-impact")).status).toBe(200);
});
it.each([
  {},
  null,
  [],
  "",
  { openDishes: "leave" },
  { openDishes: "send", sendsToStationId: randomUUID() },
])("rejects nonempty station delete body %j", async (body) => {
  const answer = await request("stations", "DELETE", station, "", body);
  expect(answer.status).toBe(400);
  expect(await answer.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "body" } },
  });
  expect((await request("stations", "GET", station, "/delete-impact")).status).toBe(200);
});
it("default station refuses deletion with its exact conflict params", async () => {
  const [row] = (await suite.db.select().from(kitchenStations)).filter((s) => s.isDefault);
  const answer = await request("stations", "DELETE", row!.id);
  expect(answer.status).toBe(409);
  expect(await answer.json()).toMatchObject({
    error: { code: "station.is_default", params: { stationId: row!.id } },
  });
});
it("station bound to an off KDS refuses deletion with distinct device count", async () => {
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: "KDS", formFactor: "kds" })
    .returning();
  await inTx(v, (tx) =>
    setProfileKitchenScreens(tx, v.cfg, profile!.id, {
      station: { stationIds: null, zoneIds: null },
    }),
  );
  const [device] = await suite.db
    .insert(devices)
    .values({
      locationId: v.cfg.locationId,
      deviceProfileId: profile!.id,
      label: "Off display",
      active: false,
      tokenHash: randomUUID(),
    })
    .returning();
  await inTx(v, (tx) =>
    setDeviceKitchenScreens(tx, v.cfg, {
      deviceId: device!.id,
      profileId: profile!.id,
      screens: [{ kind: "station", stationIds: [station], zoneIds: null }],
    }),
  );
  const preview = await request("stations", "GET", station, "/delete-impact");
  expect(preview.status).toBe(200);
  expect(await preview.json()).toEqual({
    ...impact("stations"),
    refusals: [
      {
        code: "station.screen_in_use",
        params: { stationId: station, count: 1 },
        targets: [{ id: device!.id, name: "Off display" }],
      },
    ],
    removes: [
      {
        key: "station_device_screens",
        count: 1,
        targets: [{ id: device!.id, name: "Off display" }],
      },
    ],
  });
  const answer = await request("stations", "DELETE");
  expect(answer.status).toBe(409);
  expect(await answer.json()).toMatchObject({
    error: { code: "station.screen_in_use", params: { stationId: station, count: 1 } },
  });
});

it("rejects malformed nonempty station delete JSON before any write", async () => {
  const answer = await app.request(`/management-api/stations/${station}`, {
    method: "DELETE",
    headers: { cookie, "content-type": "application/json" },
    body: "{broken",
  });
  expect(answer.status).toBe(400);
  expect(await answer.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "body" } },
  });
  expect((await request("stations", "GET", station, "/delete-impact")).status).toBe(200);
});

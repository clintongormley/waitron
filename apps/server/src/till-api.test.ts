import { seedPendingCardPayment } from "./testing/bill-payment-fixture.js";
import { fixturePinHash, fixturePasswordHash } from "./testing/known-secret-hashes.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { seedZone, attachStationPrinterForTest } from "@waitron/db/testing/seed.js";
import { venueMenus } from "./testing/venue-menus.js";
import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { floorZones, printers, printJobs, ticketItems, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { seedDevice, seedKitchenStation } from "@waitron/db/testing/seed.js";
import { departments, setProfileServiceAccess } from "@waitron/venue-service";
import {
  deactivatePerson,
  hashSessionToken,
  loginWithPin,
  startManagementSession,
} from "@waitron/identity";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import {
  createExtraList,
  addProductToMenu,
  createOptionList,
  createProduct,
  readContentLanguages,
  updateOptionList,
  writeProductModifiers,
  addMember,
  listMembers,
  listAvailableProducts,
  removeMember,
} from "@waitron/menu";
import { AppError, PERSON_HEADER, decimal } from "@waitron/shared";
import type { LogLevel } from "./logger.js";
import { createTable } from "./testing/live-table.js";
import { mountTillApi } from "./till-api.js";
import { run } from "./till-api-errors.js";
import { seedSessionDevice } from "./testing/session-device.js";
import { offerProducts } from "./testing/zone-offers.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { VENUE_SERVICE } from "./modules.js";
import { workingOrderLines } from "@waitron/db";
import { SESSION_COOKIE, requireSession } from "./till-session.js";
import "./errors.js";
import {
  sendRound,
  cfg,
  anna,
  waterProduct,
  eachUnit,
  beerProduct,
  counterZoneId,
  waterOfferId,
  hiddenWaterOfferId,
  hiddenMenuId,
  sessionDeviceCookie,
  sessionDeviceId,
  suite,
  collect,
  deps,
  openSession,
  closeSession,
  enrolTillDeviceCookie,
  enrolTillDevice,
  seedDeviceProfile,
} from "./testing/till-api.test-support.js";

describe("the run wrapper (the shared error boundary)", () => {
  it("maps a registered but UNMAPPED AppError code to 400 (its default)", async () => {
    const app = new Hono();
    // `content.language_invalid` is a real code deliberately absent from STATUS, so it takes the `?? 400`
    // default.
    app.get("/boom", (c) =>
      run(c, collect([]), () => Promise.reject(new AppError("content.language_invalid", {}))),
    );
    const res = await app.request("/boom");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "content.language_invalid" } });
  });

  /* The two refusals the FISCAL FILING itself raises are not client faults, so they are listed in
   * STATUS rather than left to the 400 default that says "the till sent something wrong". 409 is
   * this table's "the state forbids it" family, and it keeps the structured code — which a 500
   * would drop — so the till can tell the operator this one is permanent and to stop retrying
   * (`apps/till/src/till-app.ts`, `sale.refused`). */
  it.each([["fiscal.record_invalid"], ["fiscal.foreign_recipient_unsupported"]])(
    "answers %s with 409, keeping the code the till needs to say the refusal is permanent",
    async (code) => {
      const app = new Hono();
      app.get("/refused", (c) =>
        run(c, collect([]), () =>
          Promise.reject(
            code === "fiscal.record_invalid"
              ? new AppError("fiscal.record_invalid", {
                  fields: ["NumSerieFactura"],
                  codes: ["NUMSERIE_CHARSET"],
                })
              : new AppError("fiscal.foreign_recipient_unsupported", { countryCode: "FR" }),
          ),
        ),
      );
      const res = await app.request("/refused");
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code } });
    },
  );

  it("answers sale.number_reused with 409, keeping its code", async () => {
    const app = new Hono();
    app.get("/refused", (c) =>
      run(c, collect([]), () =>
        Promise.reject(
          new AppError("sale.number_reused", { seriesId: randomUUID(), invoiceNumber: 1 }),
        ),
      ),
    );
    const res = await app.request("/refused");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "sale.number_reused" } });
  });

  // A menu whose data breaks the reporting tree refuses the issuance pass: not the till's fault,
  // and permanent until the menu is fixed.
  it("answers sale_classification.invalid with 409, keeping its code", async () => {
    const app = new Hono();
    app.get("/refused", (c) =>
      run(c, collect([]), () =>
        Promise.reject(
          new AppError("sale_classification.invalid", {
            productId: randomUUID(),
            reason: "empty_name",
          }),
        ),
      ),
    );
    const res = await app.request("/refused");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "sale_classification.invalid" } });
  });

  it("maps a non-AppError to an opaque 500 server.internal and logs it at error", async () => {
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    const app = new Hono();
    app.get("/crash", (c) => run(c, collect(lines), () => Promise.reject(new Error("boom"))));

    const res = await app.request("/crash");
    expect(res.status).toBe(500);
    // No message leaks — only the opaque code, and the structured line is logged at error level with
    // `codeOf`'s classification (an unclassified value → "unknown").
    expect(await res.json()).toEqual({ error: { code: "server.internal" } });
    const failed = lines.find((l) => l.event === "till.failed");
    expect(failed?.level).toBe("error");
    expect(failed?.fields).toMatchObject({ errorCode: "unknown" });
  });
});

describe("requireSession (validates an OPEN session for protected routes)", () => {
  // A throwaway route standing in for the protected routes: it calls `requireSession` and echoes what
  // it resolved.
  function guardApp(db: Database, options: Parameters<typeof requireSession>[2] = {}): Hono {
    const app = new Hono();
    const d = { db, cfg };
    app.get("/whoami", (c) =>
      run(c, collect([]), async () => c.json(await requireSession(d, c, options))),
    );
    return app;
  }

  /** What `requireSession` answers for a session on {@link sessionDeviceId}. */
  async function sessionOnSeededDevice(sessionId: string) {
    const { rows } = await suite.db.execute<{
      device_profile_id: string;
      label: string;
    }>(sql`select device_profile_id, label from devices where id = ${sessionDeviceId}`);
    return {
      personId: anna.id,
      sessionId,
      deviceId: sessionDeviceId,
      device: {
        deviceId: sessionDeviceId,
        formFactor: "till",
        label: rows[0]!.label,
        deviceProfileId: rows[0]!.device_profile_id,
        capabilities: [...CAPABILITY_FLAGS],
      },
    };
  }

  it("ACCEPTS an open session and returns the operator's personId, sessionId and the session's device", async () => {
    const token = await openSession(suite.db);
    const { rows } = await suite.db.execute<{ id: string }>(
      sql`select id from till_sessions where token_hash = ${hashSessionToken(token)}`,
    );
    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(await sessionOnSeededDevice(rows[0]!.id));
  });

  it("records a sighting of the session's device when one is due, at most once a minute", async () => {
    const deviceId = await seedSessionDevice(suite.db);
    const token = await openSession(suite.db, deviceId);
    const request = () =>
      guardApp(suite.db).request("/whoami", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    const lastSeen = async () =>
      (
        await suite.db.execute<{ last_seen_at: string | null }>(
          sql`select last_seen_at from devices where id = ${deviceId}`,
        )
      ).rows[0]!.last_seen_at;
    const setLastSeen = (msAgo: number) => {
      const seenAt = new Date(Date.now() - msAgo).toISOString();
      return suite.db.execute(
        sql`update devices set last_seen_at = ${seenAt} where id = ${deviceId}`,
      );
    };

    expect(await lastSeen()).toBeNull();
    expect((await request()).status).toBe(200);
    expect(await lastSeen()).not.toBeNull();

    await setLastSeen(30_000);
    const recent = await lastSeen();
    expect((await request()).status).toBe(200);
    expect(await lastSeen()).toBe(recent);

    await setLastSeen(120_000);
    const stale = await lastSeen();
    expect((await request()).status).toBe(200);
    expect(Date.parse((await lastSeen())!)).toBeGreaterThan(Date.parse(stale!));
  });

  it("REJECTS (401 device.unauthorized) an open session whose device has since been revoked", async () => {
    const deviceId = await seedSessionDevice(suite.db);
    const token = await openSession(suite.db, deviceId);
    const request = () =>
      guardApp(suite.db).request("/whoami", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect((await request()).status).toBe(200);

    await suite.db.execute(sql`update devices set active = 0 where id = ${deviceId}`);
    const res = await request();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "device.unauthorized" } });
  });

  it("REJECTS (401 session.required) the row's own id — what a copy of the database holds", async () => {
    const token = await openSession(suite.db);
    const { rows } = await suite.db.execute<{ id: string }>(
      sql`select id from till_sessions where token_hash = ${hashSessionToken(token)}`,
    );
    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${rows[0]!.id}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
    // The other direction: the cookie's own token is accepted, and the guard hands back the row id.
    const ok = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(await sessionOnSeededDevice(rows[0]!.id));
  });

  it("REJECTS the stored token hash from a database copy as a cookie", async () => {
    const token = await openSession(suite.db);
    const { rows } = await suite.db.execute<{ token_hash: string; person_id: string }>(
      sql`select token_hash, person_id from till_sessions where token_hash = ${hashSessionToken(token)}`,
    );
    const res = await guardApp(suite.db).request("/whoami", {
      headers: {
        cookie: `${SESSION_COOKIE}=${rows[0]!.token_hash}`,
        [PERSON_HEADER]: rows[0]!.person_id,
      },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS (401 session.required) when no cookie is present", async () => {
    const res = await guardApp(suite.db).request("/whoami");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS (401 session.required) a well-formed but nonexistent/forged session id", async () => {
    // A valid uuid the attacker guessed — never issued, so it names no row. A cookie is present, so a
    // mere presence check would WRONGLY accept it; the DB lookup is what refuses it.
    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${randomUUID()}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS (401 session.required) a NON-UUID cookie", async () => {
    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=not-a-uuid` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS (401 session.required) an ENDED session — logging out invalidates the cookie", async () => {
    // Open a real session, then end it. Its token still names a row, but `ended_at IS NOT NULL`, so
    // the `IS NULL` filter excludes it: a logged-out cookie is as good as no cookie.
    const token = await openSession(suite.db);
    await closeSession(suite.db, token);

    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  /** The venue database, except that every write turn rejects with `error`. */
  function stampRefused(error: Error): Database {
    return Object.create(suite.db, {
      withWriteLock: {
        value: async () => {
          throw error;
        },
      },
    }) as Database;
  }

  /** An open session on a freshly seeded device that has never been seen. */
  async function sessionOnUnseenDevice() {
    const deviceId = await seedSessionDevice(suite.db);
    const token = await openSession(suite.db, deviceId);
    const lastSeen = async () =>
      (
        await suite.db.execute<{ last_seen_at: string | null }>(
          sql`select last_seen_at from devices where id = ${deviceId}`,
        )
      ).rows[0]!.last_seen_at;
    const headers = { cookie: `${SESSION_COOKIE}=${token}` };
    return { deviceId, token, headers, lastSeen };
  }

  it("a stamp refused for a full disk still answers the session", async () => {
    const { deviceId, headers, lastSeen } = await sessionOnUnseenDevice();
    const db = stampRefused(new AppError("storage.disk_full", {}));
    const res = await guardApp(db).request("/whoami", { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ personId: anna.id, deviceId });
    expect(await lastSeen()).toBeNull();
  });

  it("an ended session is still refused", async () => {
    const { token, headers } = await sessionOnUnseenDevice();
    await closeSession(suite.db, token);
    const res = await guardApp(stampRefused(new AppError("storage.disk_full", {}))).request(
      "/whoami",
      { headers },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("a deactivated person is still refused", async () => {
    const deviceId = await seedSessionDevice(suite.db);
    const [admin] = await seedPersons(suite.db, {
      displayName: "Admin",
      pinHash: fixturePinHash("8181"),
      passwordHash: fixturePasswordHash("admin password"),
      role: "admin",
    });
    let token: string;
    try {
      const [leaver] = await seedPersons(suite.db, {
        displayName: "Leaver",
        pinHash: fixturePinHash("8282"),
        role: "staff",
      });
      ({ token } = await withTransaction(suite.db, (tx) =>
        loginWithPin(tx, { deviceId, personId: leaver!.id, pin: "8282" }),
      ));
      const manager = await withTransaction(suite.db, (tx) =>
        startManagementSession(tx, { method: "password", personId: admin!.id }),
      );
      await withTransaction(suite.db, (tx) =>
        deactivatePerson(tx, { managementSessionId: manager.token, personId: leaver!.id }),
      );
    } finally {
      // This suite shares one database, and the staff rosters it checks list every active person.
      await suite.db.execute(sql`update persons set status = 'suspended' where id = ${admin!.id}`);
    }
    const res = await guardApp(stampRefused(new AppError("storage.disk_full", {}))).request(
      "/whoami",
      { headers: { cookie: `${SESSION_COOKIE}=${token}` } },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("a revoked device is still refused", async () => {
    const { deviceId, headers } = await sessionOnUnseenDevice();
    await suite.db.execute(sql`update devices set active = 0 where id = ${deviceId}`);
    const res = await guardApp(stampRefused(new AppError("storage.disk_full", {}))).request(
      "/whoami",
      { headers },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "device.unauthorized" } });
  });

  it("a missing permission is still refused", async () => {
    const { headers } = await sessionOnUnseenDevice();
    const db = stampRefused(new AppError("storage.disk_full", {}));
    const res = await guardApp(db, { permission: "person.manage" }).request("/whoami", {
      headers,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  });

  it("an action the device's profile does not allow is still refused", async () => {
    const { deviceId } = await seedDevice(suite.db, { capabilities: ["take-cash"] });
    const token = await openSession(suite.db, deviceId);
    const db = stampRefused(new AppError("storage.disk_full", {}));
    const res = await guardApp(db, { action: "take-orders" }).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "device.forbidden_action" } });
  });

  it("any other failure still fails", async () => {
    const { headers, lastSeen } = await sessionOnUnseenDevice();
    const app = new Hono();
    const d = { db: stampRefused(new Error("boom")), cfg };
    app.get("/whoami", (c) =>
      requireSession(d, c).then(
        () => c.text("answered"),
        (error: unknown) => c.text(String(error)),
      ),
    );
    expect(await (await app.request("/whoami", { headers })).text()).toBe("Error: boom");
    expect(await lastSeen()).toBeNull();
  });

  it("with room, a stamp due is saved", async () => {
    const { headers, lastSeen } = await sessionOnUnseenDevice();
    expect((await guardApp(suite.db).request("/whoami", { headers })).status).toBe(200);
    expect(await lastSeen()).not.toBeNull();
  });
});

describe("zone-offer menu routes", () => {
  it.each(["absent", "invalid", "valid"])(
    "does not serve the retired product menu with a %s session",
    async (session) => {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));
      const token = session === "valid" ? await openSession(suite.db) : "not-a-uuid";
      const res = await app.request("/api/products", {
        headers: session === "absent" ? {} : { cookie: `${SESSION_COOKIE}=${token}` },
      });
      expect(res.status).toBe(404);
    },
  );

  it("offers the effective zone pay timing to the counter", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const token = await openSession(suite.db);
    const headers = { cookie: `${SESSION_COOKIE}=${token}` };
    await suite.db.execute(sql`
      update departments set paid_when = 'ticket_then_pay'
      where id = (select department_id from floor_zones where id = ${counterZoneId})`);
    try {
      for (const path of [
        "/api/default-service-zone/offers",
        `/api/service-zones/${counterZoneId}/offers`,
      ]) {
        const response = await app.request(path, { headers });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          context: { zoneId: counterZoneId, serviceMode: "ticket_then_pay" },
        });
      }
    } finally {
      await suite.db.execute(sql`
        update departments set paid_when = 'prepay'
        where id = (select department_id from floor_zones where id = ${counterZoneId})`);
    }
  });

  it.each(["prepay", "ticket_then_pay"] as const)(
    "offers %s policy even when the zone retains the retired invoice-first setting",
    async (paidWhen) => {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));
      const token = await openSession(suite.db);
      const headers = { cookie: `${SESSION_COOKIE}=${token}` };
      await suite.db.execute(
        sql`update floor_zones set order_start = 'counter' where id = ${counterZoneId}`,
      );
      await suite.db.execute(sql`
        update departments set paid_when = ${paidWhen}
        where id = (select department_id from floor_zones where id = ${counterZoneId})`);
      try {
        for (const path of [
          "/api/default-service-zone/offers",
          `/api/service-zones/${counterZoneId}/offers`,
        ]) {
          const response = await app.request(path, { headers });
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({
            context: { zoneId: counterZoneId, serviceMode: paidWhen },
          });
        }
      } finally {
        await suite.db.execute(
          sql`update floor_zones set order_start = 'counter' where id = ${counterZoneId}`,
        );
        await suite.db.execute(sql`
          update departments set paid_when = 'prepay'
          where id = (select department_id from floor_zones where id = ${counterZoneId})`);
      }
    },
  );

  it("offers different pay timing for two zones in the same department", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const token = await openSession(suite.db);
    const headers = { cookie: `${SESSION_COOKIE}=${token}` };
    const second = await seedZone(suite.db, { name: "Collect at counter" });
    await suite.db.execute(sql`
      update floor_zones set department_id = (select department_id from floor_zones where id = ${counterZoneId}) where id = ${second!.id}`);
    await suite.db.execute(
      sql`update floor_zones set order_start = 'counter', paid_when = 'ticket_then_pay' where id = ${second!.id}`,
    );
    try {
      for (const [zoneId, serviceMode] of [
        [counterZoneId, "prepay"],
        [second!.id, "ticket_then_pay"],
      ] as const) {
        const response = await app.request(`/api/service-zones/${zoneId}/offers`, { headers });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ context: { zoneId, serviceMode } });
      }
    } finally {
      await suite.db.execute(sql`delete from floor_zones where id = ${second!.id}`);
      await suite.db.delete(floorZones).where(eq(floorZones.id, second!.id));
    }
  });

  it.each([
    ["default", 409, "device_profile.no_service_zone"],
    ["selected", 404, "service_zone.not_found"],
  ] as const)(
    "refuses %s-zone offers while its department is inactive",
    async (route, status, code) => {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));
      const token = await openSession(suite.db);
      const [policy] = await suite.db
        .select()
        .from(floorZones)
        .where(eq(floorZones.id, counterZoneId));
      expect(policy).toBeDefined();
      const [department] = await suite.db
        .select()
        .from(departments)
        .where(eq(departments.id, policy!.departmentId));
      await suite.db
        .update(departments)
        .set({ active: false })
        .where(eq(departments.id, policy!.departmentId));
      try {
        const path =
          route === "default"
            ? "/api/default-service-zone/offers"
            : `/api/service-zones/${counterZoneId}/offers`;
        const response = await app.request(path, {
          headers: { cookie: `${SESSION_COOKIE}=${token}` },
        });
        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({
          error: { code },
        });
      } finally {
        await suite.db
          .update(departments)
          .set({ active: department!.active })
          .where(eq(departments.id, department!.id));
      }
    },
  );

  it("returns the configured default counter zone and its offers", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const token = await openSession(suite.db);

    const res = await app.request("/api/default-service-zone/offers", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.context).not.toHaveProperty("receiptPrintMode");
    expect(body).toMatchObject({
      context: { zoneId: counterZoneId, serviceMode: "prepay" },
      zones: [{ id: counterZoneId, name: "Counter" }],
      offers: [{ id: waterOfferId, grossPrice: "1.75" }],
    });
  });

  it("prefers the session's device's profile's starting zone, whatever device cookie the request carries", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const profileId = await seedDeviceProfile(suite.db, `Starting zone ${randomUUID()}`, []);
    const { deviceId } = await enrolTillDevice(suite.db, profileId);
    const token = await openSession(suite.db, deviceId);
    const otherCookie = await enrolTillDeviceCookie(suite.db);
    const second = await seedZone(suite.db, { name: `Device zone ${deviceId}` });
    await suite.db.execute(sql`
      update floor_zones set department_id = (select department_id from floor_zones where id = ${counterZoneId}) where id = ${second!.id}`);
    await suite.db.execute(
      sql`update floor_zones set order_start = 'counter' where id = ${second!.id}`,
    );
    await withTransaction(suite.db, async (tx) => {
      const [policy] = await tx
        .select({ departmentId: floorZones.departmentId })
        .from(floorZones)
        .where(eq(floorZones.id, counterZoneId));
      await setProfileServiceAccess(tx, profileId, {
        departmentId: policy!.departmentId,
        allowedZoneIds: null,
        startingZoneId: second!.id,
      });
    });

    for (const cookie of [
      `${SESSION_COOKIE}=${token}`,
      `${SESSION_COOKIE}=${token}; ${otherCookie}`,
    ]) {
      const res = await app.request("/api/default-service-zone/offers", { headers: { cookie } });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ context: { zoneId: second!.id } });
    }
  });

  it("returns the offers allowed in an explicit service zone", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const token = await openSession(suite.db);

    const res = await app.request(`/api/service-zones/${counterZoneId}/offers`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.context).not.toHaveProperty("receiptPrintMode");
    expect(body).toMatchObject({
      context: { zoneId: counterZoneId, serviceMode: "prepay" },
      defaultMenuId: waterProduct.menuId,
      menus: [{ id: waterProduct.menuId, name: "Daily menu", isDefault: true }],
      offers: [{ id: waterOfferId, productId: waterProduct.id, grossPrice: "1.75" }],
    });
  });

  it("leaves out a product taken off its menu's structure, and lists it again once put back", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const token = await openSession(suite.db);
    const offerIds = async (): Promise<string[]> => {
      const res = await app.request(`/api/service-zones/${counterZoneId}/offers`, {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { offers: { id: string }[] }).offers.map((offer) => offer.id);
    };
    const menuId = waterProduct.menuId;
    const [held] = (
      await suite.db.execute<{
        sectionId: string;
        position: number;
        grossPrice: number | null;
      }>(sql`
        select m.section_id as "sectionId", m.position, i.gross_price as "grossPrice"
        from section_members m join sections d on d.id = m.section_id and d.role = 'menu_root'
          join menu_items i on i.menu_id = d.owner_menu_id and i.product_id = m.product_id
        where d.owner_menu_id = ${menuId} and m.product_id = ${waterProduct.id}`)
    ).rows;

    try {
      await withTransaction(suite.db, async (tx) => {
        const [member] = (await listMembers(tx, held!.sectionId)).filter(
          ({ ref }) => ref.kind === "product" && ref.productId === waterProduct.id,
        );
        await removeMember(tx, held!.sectionId, member!.id);
        await publishWorkingMenu(tx, menuId);
      });
      expect(await offerIds()).not.toContain(waterOfferId);
    } finally {
      // Taking it off reset the menu's price for it; the suite's other cases read that price.
      await withTransaction(suite.db, async (tx) => {
        await addMember(
          tx,
          held!.sectionId,
          { kind: "product", productId: waterProduct.id },
          held!.position,
        );
        await tx.execute(
          sql`update menu_items set gross_price = ${held!.grossPrice} where id = ${waterOfferId}`,
        );
        await publishWorkingMenu(tx, menuId);
      });
    }
    expect(await offerIds()).toContain(waterOfferId);
  });

  it("REJECTS (401 session.required) when no cookie is present — proves the requireSession guard", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // No cookie: the guard must refuse before any menu is read.
    const res = await app.request("/api/default-service-zone/offers");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS (401 session.required) a NON-UUID cookie on the menu route", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const res = await app.request("/api/default-service-zone/offers", {
      headers: { cookie: `${SESSION_COOKIE}=not-a-uuid` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("reads the venue's accessible menus and product values", async () => {
    const menu = await withTransaction(suite.db, async (tx) => ({
      menus: await venueMenus(tx),
      products: (await listAvailableProducts(tx)).products,
    }));
    expect(menu).toEqual({
      menus: [
        { id: waterProduct.menuId, name: "Daily menu", isDefault: true },
        { id: beerProduct.menuId, name: "Happy Hour", isDefault: false },
        { id: hiddenMenuId, name: "Staff", isDefault: false },
      ],
      products: [
        {
          id: waterProduct.id,
          name: "Agua mineral",
          customerName: null,
          pricingUnit: "each",
          unit: eachUnit,
          unitPrice: "1.50",
          vatClass: "general",
          takeawayVatClass: "general",
          category: "Drinks",
          allergens: { sulphites: {} },
          // No override: vegan/vegetarian "unknown" — an unreviewed plate asserts no
          // positive diet claim.
          diet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
          dietOverride: null,
          dietaryDeclarations: [],
          courseId: null,
          // `offeredModifiers` is the extras-and-options walk the till draws from
          // (`readOfferedModifiers`), empty here because these seeded products attach nothing.
          offeredModifiers: [],
        },
        {
          id: beerProduct.id,
          name: "Cerveza",
          customerName: null,
          pricingUnit: "each",
          unit: eachUnit,
          unitPrice: "2.50",
          vatClass: "general",
          takeawayVatClass: "general",
          category: "Drinks",
          allergens: null,
          // No override → the cautious "unknown" profile (see Agua mineral above).
          diet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
          dietOverride: null,
          dietaryDeclarations: [],
          courseId: null,
          offeredModifiers: [],
        },
      ],
    });
  });
});

// Park a fresh order for the logged-in operator over the real HTTP surface (never the working-order
// module directly), so every assertion using it rides the route's own requireSession + run wrapper.
// Module-scoped because the place/prep/cancel suites below all need a parked order to place first.
async function park(
  app: Hono,
  cookie: string,
  body: { id: string; lines: { menuItemId: string; quantity: string }[]; label?: string },
): Promise<Response> {
  return app.request("/api/working-orders", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ dining: "eat_in", ...body }),
  });
}

describe("/api/working-orders (session-guarded park & retrieve)", () => {
  it.each([
    ["stale", "working_order.out_of_date", 409, "Ana"],
    ["closed", "working_order.not_open", 409, "Ana"],
    // A rename goes through while paying; one that changes nothing is still refused.
    ["paying", "order.payment_in_flight", 409, "Mesa 7"],
  ])(
    "refuses a %s held label save without changing the order",
    async (state, code, status, label) => {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));
      const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
      const id = randomUUID();
      await park(app, cookie, {
        id,
        lines: [{ menuItemId: waterOfferId, quantity: "2" }],
        label: "Mesa 7",
      });
      if (state === "closed")
        await suite.db.execute(
          sql`update working_orders set status = 'abandoned' where id = ${id}`,
        );
      if (state === "paying") await seedPendingCardPayment(suite.db, id);
      const before = await suite.db.execute(sql`select * from working_orders where id = ${id}`);
      const response = await app.request(`/api/working-orders/${id}/label`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ label, revision: state === "stale" ? 99 : 0 }),
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
      expect(
        (await suite.db.execute(sql`select * from working_orders where id = ${id}`)).rows,
      ).toEqual(before.rows);
    },
  );

  it("renames a held order while a card is at the reader, keeping the card payment pending", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = randomUUID();
    await park(app, cookie, {
      id,
      lines: [{ menuItemId: waterOfferId, quantity: "2" }],
      label: "Mesa 7",
    });
    const paymentId = await seedPendingCardPayment(suite.db, id);
    const response = await app.request(`/api/working-orders/${id}/label`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ label: "Ana", revision: 0 }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ revision: 1 });
    expect(
      (await suite.db.execute(sql`select label, revision from working_orders where id = ${id}`))
        .rows,
    ).toEqual([{ label: "Ana", revision: 1 }]);
    expect(suite.db.all(sql`select state from bill_payments where id = ${paymentId}`)).toEqual([
      { state: "pending" },
    ]);
  });

  it("saves only a held order label and retains its stored lines", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = randomUUID();
    await park(app, cookie, {
      id,
      lines: [{ menuItemId: waterOfferId, quantity: "2" }],
      label: "Mesa 7",
    });
    const before = await (
      await app.request(`/api/working-orders/${id}`, { headers: { cookie } })
    ).json();
    const save = (body: unknown, authenticated = true) =>
      app.request(`/api/working-orders/${id}/label`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...(authenticated ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    const storedLines = await suite.db.execute(
      sql`select * from working_order_lines where working_order_id = ${id} order by line_no`,
    );
    const renamed = await save({ label: "Ana", revision: 0 });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual({ revision: 1 });
    const after = await (
      await app.request(`/api/working-orders/${id}`, { headers: { cookie } })
    ).json();
    expect(after).toEqual({
      ...before,
      label: "Ana",
      billName: "Ana",
      revision: 1,
      kitchenNote: { ...before.kitchenNote, ownerRevision: 1 },
    });
    expect(
      (
        await suite.db.execute(
          sql`select * from working_order_lines where working_order_id = ${id} order by line_no`,
        )
      ).rows,
    ).toEqual(storedLines.rows);
    const replay = await save({ label: "Ana", revision: 1 });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ revision: 1 });
    const stale = await save({ label: "Old copy", revision: 0 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "working_order.out_of_date" } });
    for (const label of [undefined, null, 42, []]) {
      const invalid = await save({ label, revision: 1 });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "label" } },
      });
    }
    const anonymous = await save({ label: "No session", revision: 1 }, false);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS every route with 401 session.required when no cookie is present", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const id = randomUUID();
    const json = { "content-type": "application/json" };
    // The guard runs FIRST on each route (before any body is read or menu touched), so an
    // unauthenticated park/list/retrieve/update/abandon/place/prep/cancel all 401 with the one
    // code. (The station-operate routes have their own 401 guard test below.)
    const cases = [
      app.request("/api/working-orders", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ dining: "eat_in", id, lines: [] }),
      }),
      app.request("/api/working-orders"),
      app.request(`/api/working-orders/${id}`),
      app.request(`/api/working-orders/${id}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ dining: "eat_in", lines: [] }),
      }),
      app.request(`/api/working-orders/${id}`, { method: "DELETE" }),
      // The prep surface.
      app.request(`/api/working-orders/${id}/place`, { method: "POST" }),
      app.request(`/api/working-orders/${id}/cancel`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ reason: "changed mind" }),
      }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
    }
  });

  it("POST parks an order as the session's device and returns { id, orderNumber }", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = randomUUID();

    const res = await park(app, cookie, {
      id,
      lines: [{ menuItemId: waterOfferId, quantity: "2" }],
      label: "Mesa 4",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; orderNumber: number };
    expect(body.id).toBe(id);
    // Order numbers are shared across this suite's tests, so assert the shape, not the
    // value.
    expect(Number.isInteger(body.orderNumber)).toBe(true);
    expect(body.orderNumber).toBeGreaterThanOrEqual(1);

    // The order really persisted OPEN, opened by the session's device at the venue's location.
    const rows = await suite.db.execute<{
      status: string;
      source: string;
      device_id: string;
    }>(sql`select status, source, device_id from working_orders where id = ${id}`);
    expect(rows.rows[0]).toEqual({
      status: "open",
      source: "device",
      device_id: sessionDeviceId,
    });
  });

  it("POST prices an allowed menu offer and rejects an offer outside the selected zone", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;

    const allowedId = randomUUID();
    const allowed = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        dining: "eat_in",
        id: allowedId,
        zoneId: counterZoneId,
        lines: [{ menuItemId: waterOfferId, quantity: "2" }],
      }),
    });
    expect(allowed.status).toBe(200);
    // Read straight from the column, which counts whole cents: 175 is the stored 1.75. The cast
    // refuses no width on this engine; the values here are three digits, so nothing turns on that.
    const priced = await suite.db.execute<{ unit_price_gross: number }>(sql`
      select cast(unit_price_gross as int) as unit_price_gross
      from working_order_lines where working_order_id = ${allowedId}`);
    expect(priced.rows).toEqual([{ unit_price_gross: 175 }, { unit_price_gross: 175 }]);

    const rejected = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        dining: "eat_in",
        id: randomUUID(),
        zoneId: counterZoneId,
        lines: [{ menuItemId: hiddenWaterOfferId, quantity: "1" }],
      }),
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      error: {
        code: "service_zone.offer_not_allowed",
        params: { zoneId: counterZoneId, menuItemId: hiddenWaterOfferId },
      },
    });
  });

  it("POST refuses a line naming only a product id", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;

    const res = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        dining: "eat_in",
        id: randomUUID(),
        lines: [{ productId: waterProduct.id, quantity: "1" }],
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "lines" } },
    });
  });

  it("POST with a malformed id is 400 shared.invalid_id", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;

    // Park is the one route where the client MINTS the working-order id that becomes the PK; the
    // route screen refuses a malformed one 400. The non-empty basket clears parkOrder's empty-basket
    // early-out.
    const res = await park(app, cookie, {
      id: "not-a-uuid",
      lines: [{ menuItemId: waterOfferId, quantity: "1" }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "WorkingOrderId", value: "not-a-uuid" } },
    });
  });

  it("PUT /:id/lines/:lineNo on a counter order names no party in its answer", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = randomUUID();
    expect(
      (await park(app, cookie, { id, lines: [{ menuItemId: waterOfferId, quantity: "1" }] }))
        .status,
    ).toBe(200);

    const edited = await app.request(`/api/working-orders/${id}/lines/1`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ portionLineNos: [], note: "para llevar", revision: 0 }),
    });

    expect(edited.status).toBe(200);
    expect(await edited.json()).toEqual({ revision: 1, party: null });
  });

  it("GET lists it, GET/:id retrieves its lines, PUT edits it, DELETE abandons it", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = randomUUID();

    const parked = await park(app, cookie, {
      id,
      lines: [{ menuItemId: waterOfferId, quantity: "2" }],
      label: "Mesa 7",
    });
    const { orderNumber } = (await parked.json()) as { orderNumber: number };

    // GET list carries this order's summary. `total` is the GROSS (VAT-inclusive) draft total the
    // operator saw: 2 × 1.75 = 3.50 gross. Assert
    // containment — the suite shares one node, so other tests' open orders also list.
    const list = await app.request("/api/working-orders", { headers: { cookie } });
    expect(list.status).toBe(200);
    const summaries = (await list.json()) as {
      id: string;
      orderNumber: number;
      label: string | null;
      counts: { ordered: number };
      total: string;
    }[];
    expect(summaries).toContainEqual(
      expect.objectContaining({
        id,
        orderNumber,
        label: "Mesa 7",
        counts: expect.objectContaining({ ordered: 2 }),
        total: "3.50",
      }),
    );

    // GET /:id rebuilds the basket from the frozen menu offer and returns its product details,
    // one line per stored dish. `quantity` reads back at the three places `thousandthsToDecimal`
    // always renders ("1.000", not "1").
    const waterLine = {
      menuItemId: waterOfferId,
      productId: waterProduct.id,
      quantity: "1.000",
      product: {
        menuItemId: waterOfferId,
        productId: waterProduct.id,
        unitPrice: "1.75",
      },
    };
    const got = await app.request(`/api/working-orders/${id}`, { headers: { cookie } });
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({
      id,
      orderNumber,
      label: "Mesa 7",
      lines: [waterLine, waterLine],
    });

    // PUT replaces the whole basket + label — a 200 with the revision it moved to — and a re-retrieve
    // reflects it.
    const put = await app.request(`/api/working-orders/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        dining: "eat_in",
        lines: [{ menuItemId: waterOfferId, quantity: "5" }],
        label: "Mesa 7 bis",
        revision: 0,
      }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ revision: 1 });
    const afterPut = await (
      await app.request(`/api/working-orders/${id}`, { headers: { cookie } })
    ).json();
    expect(afterPut).toMatchObject({
      id,
      orderNumber,
      label: "Mesa 7 bis",
      lines: Array.from({ length: 5 }, () => waterLine),
    });

    // DELETE abandons it — a 200 with no body — after which retrieve is 404 and it leaves the list.
    const del = await app.request(`/api/working-orders/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(200);
    expect(await del.text()).toBe("");
    const goneGet = await app.request(`/api/working-orders/${id}`, { headers: { cookie } });
    expect(goneGet.status).toBe(404);
    expect(await goneGet.json()).toMatchObject({ error: { code: "working_order.not_found" } });
    const afterList = (await (
      await app.request("/api/working-orders", { headers: { cookie } })
    ).json()) as { id: string }[];
    expect(afterList.find((o) => o.id === id)).toBeUndefined();
  });

  it("GET /:id of an unknown id is 404 working_order.not_found", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const res = await app.request(`/api/working-orders/${randomUUID()}`, { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "working_order.not_found" } });
  });

  it("PUT of an abandoned (terminal) order is 409 working_order.not_open", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ menuItemId: waterOfferId, quantity: "1" }] });
    await app.request(`/api/working-orders/${id}`, { method: "DELETE", headers: { cookie } });

    // The order now sits in the terminal `abandoned` state, so an edit is refused 409 — the mutation
    // counterpart to the retrieve side's 404.
    const put = await app.request(`/api/working-orders/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        dining: "eat_in",
        lines: [{ menuItemId: waterOfferId, quantity: "2" }],
        revision: 0,
      }),
    });
    expect(put.status).toBe(409);
    expect(await put.json()).toMatchObject({ error: { code: "working_order.not_open" } });
  });

  // The retrieve/edit/abandon routes: the `requireUuidId` screen refuses a malformed `:id` before any
  // query runs, with the same domain code an absent/non-open id gets on that route.
  it("GET /:id with a malformed id is 404 working_order.not_found", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;

    const res = await app.request("/api/working-orders/not-a-uuid", { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_found", params: { workingOrderId: "not-a-uuid" } },
    });
  });

  it("PUT /:id with a malformed id is 409 working_order.not_open", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;

    // A well-formed body, so the refusal comes from the id screen, not the body parse.
    const res = await app.request("/api/working-orders/not-a-uuid", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lines: [{ menuItemId: waterOfferId, quantity: "1" }], revision: 0 }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_open", params: { workingOrderId: "not-a-uuid" } },
    });
  });

  it("DELETE /:id with a malformed id is 409 working_order.not_open", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;

    const res = await app.request("/api/working-orders/not-a-uuid", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_open", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

// This suite uses prepay, so placing and cancelling unissued orders need no fiscal backend.
describe("/api/working-orders/:id/place (send-to-prep placing)", () => {
  it("POST places an open order (open → placed), fires a ticket item at queued, and returns { id, status }", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = randomUUID();
    await park(app, cookie, {
      id,
      lines: [{ menuItemId: waterOfferId, quantity: "1" }],
      label: "Mesa 2",
    });

    const placed = await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${sessionDeviceCookie}` },
    });
    expect(placed.status).toBe(200);
    // `prepay` files nothing at placing — just the bare transition result.
    expect(await placed.json()).toEqual({ id, status: "placed" });

    // The order really transitioned AND a ticket item was fired at `queued` — placing fires the
    // lines to the kitchen (`placeOrder` → `fireLines`); the single line routes to the seeded default
    // station "Cocina".
    const order = await suite.db.execute<{ status: string }>(
      sql`select status from working_orders where id = ${id}`,
    );
    expect(order.rows[0]).toEqual({ status: "placed" });
    const ticket = await suite.db.execute<{ state: string }>(
      sql`select state from ticket_items where working_order_line_id in (select id from working_order_lines where working_order_id = ${id})`,
    );
    expect(ticket.rows[0]).toEqual({ state: "queued" });
    const details = await app.request(`/api/working-orders/${id}/lines`, { headers: { cookie } });
    expect(details.status).toBe(200);
    expect((await details.json()).lines[0]).toMatchObject({
      sentAt: expect.any(String),
      nutrition: { allergens: { sulphites: {} }, dietaryDeclarations: [] },
    });
  });

  it("POST repeats the original placed result when the first place already committed", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ menuItemId: waterOfferId, quantity: "1" }] });
    await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${sessionDeviceCookie}` },
    });

    const rePlace = await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${sessionDeviceCookie}` },
    });
    expect(rePlace.status).toBe(200);
    expect(await rePlace.json()).toEqual({ id, status: "placed" });
  });

  it("POST with a malformed id is 409 working_order.not_open", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;

    // The route's `isUuid` screen refuses "not-a-uuid" before any query.
    const res = await app.request("/api/working-orders/not-a-uuid/place", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_open", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

// Station-display operate routes: GET /api/stations, GET /api/stations/:id/queue, POST
// Per-item preparation operations. Under this suite's
// `prepay` cfg, `placeOrder`'s fire seeds ticket items with no fiscal write.
describe("station-display operate routes", () => {
  /** The seeded default station "Cocina", read back through `GET /api/stations` (the picker's own read). */
  async function defaultStation(
    app: Hono,
    cookie: string,
  ): Promise<{ id: string; name: string; isDefault: boolean }> {
    const res = await app.request("/api/stations", { headers: { cookie } });
    expect(res.status).toBe(200);
    const stations = (await res.json()) as { id: string; name: string; isDefault: boolean }[];
    return stations.find((s) => s.isDefault)!;
  }

  /** Park + place a one-line order (fires one ticket item to the default station at `queued`), returning
   *  the order id — the seed the queue/bump tests read from. */
  async function placeFired(app: Hono, cookie: string, label?: string): Promise<string> {
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ menuItemId: waterOfferId, quantity: "1" }], label });
    await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${sessionDeviceCookie}` },
    });
    return id;
  }

  it("a session lists stations, reads a station's queue, bumps a ticket item, and the queue reflects it", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = await placeFired(app, cookie, "Mesa 8");

    // 1. List stations → the seeded default "Cocina".
    const kitchenStation = await defaultStation(app, cookie);
    expect(kitchenStation.name).toBe("Cocina");

    const [printer] = await suite.db
      .insert(printers)
      .values({
        name: `KDS ${randomUUID()}`,
        transport: "cloud_poll",
        pollId: randomUUID(),
      })
      .returning({ id: printers.id });
    await attachStationPrinterForTest(suite.db, kitchenStation.id, printer!.id);
    await suite.db.insert(printJobs).values({
      printerId: printer!.id,
      payload: Uint8Array.of(1),
      status: "failed",
      attempts: 5,
      createdAt: "2026-10-02T18:00:00.000Z",
    });

    // 2. Read its queue → the order's group carries one queued line.
    const q1 = await app.request(`/api/stations/${kitchenStation.id}/queue`, {
      headers: { cookie },
    });
    expect(q1.status).toBe(200);
    expect(
      ((await q1.clone().json()) as { printersDown: { printerId: string }[] }).printersDown,
    ).toMatchObject([{ printerId: printer!.id }]);
    const { items: groups1 } = (await q1.json()) as {
      items: {
        orderId: string;
        label: string | null;
        items: { id: string; state: string }[];
      }[];
    };
    const group = groups1.find((g) => g.orderId === id)!;
    expect(group).toMatchObject({ label: "Mesa 8" });
    expect(group.items).toHaveLength(1);
    expect(group.items[0]!.state).toBe("queued");
    const itemId = group.items[0]!.id;

    // 3. Bump that item queued → preparing.
    const bump = await app.request(`/api/ticket-items/${itemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "preparing", stationId: kitchenStation.id }),
    });
    expect(bump.status).toBe(200);
    expect(await bump.text()).toBe("");

    // 4. The queue reflects it.
    const q2 = await app.request(`/api/stations/${kitchenStation.id}/queue`, {
      headers: { cookie },
    });
    const { items: groups2 } = (await q2.json()) as {
      items: { orderId: string; items: { state: string }[] }[];
    };
    expect(groups2.find((g) => g.orderId === id)!.items[0]!.state).toBe("preparing");
  });

  it("a queued item bumped straight to ready (skipping preparing) is refused 409 ticket.invalid_transition", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = await placeFired(app, cookie);
    const kitchenStation = await defaultStation(app, cookie);
    const q = await app.request(`/api/stations/${kitchenStation.id}/queue`, {
      headers: { cookie },
    });
    const { items: groups } = (await q.json()) as {
      items: { orderId: string; items: { id: string }[] }[];
    };
    const itemId = groups.find((g) => g.orderId === id)!.items[0]!.id;

    // The legal next step from `queued` is `preparing`; jumping to `ready` matches no row → refused.
    const skip = await app.request(`/api/ticket-items/${itemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "ready", stationId: kitchenStation.id }),
    });
    expect(skip.status).toBe(409);
    expect(await skip.json()).toMatchObject({
      error: { code: "ticket.invalid_transition", params: { ticketItemId: itemId } },
    });
  });

  it("a Ready item sent back to preparing answers 200 and reads preparing on the queue", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = await placeFired(app, cookie);
    const kitchenStation = await defaultStation(app, cookie);
    const queue = async () => {
      const q = await app.request(`/api/stations/${kitchenStation.id}/queue`, {
        headers: { cookie },
      });
      const { items: groups } = (await q.json()) as {
        items: { orderId: string; items: { id: string; state: string }[] }[];
      };
      return groups.find((g) => g.orderId === id)!.items[0]!;
    };
    const advance = (itemId: string, to: string) =>
      app.request(`/api/ticket-items/${itemId}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ to, stationId: kitchenStation.id }),
      });
    const itemId = (await queue()).id;
    expect((await advance(itemId, "preparing")).status).toBe(200);
    expect((await advance(itemId, "ready")).status).toBe(200);

    const back = await advance(itemId, "preparing");
    expect(back.status).toBe(200);
    expect(await queue()).toMatchObject({ id: itemId, state: "preparing" });
  });

  it("POST /api/ticket-items/:id/advance with an unknown or malformed id is 404 ticket_item.not_found", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const kitchenStation = await defaultStation(app, cookie);
    for (const id of [randomUUID(), "not-a-uuid"]) {
      const res = await app.request(`/api/ticket-items/${id}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ to: "preparing", stationId: kitchenStation.id }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: { code: "ticket_item.not_found", params: { ticketItemId: id } },
      });
    }
  });

  it("POST /api/ticket-items/:id/advance with a garbage or missing `to` is 400 management.request_invalid, not a 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = await placeFired(app, cookie);
    const kitchenStation = await defaultStation(app, cookie);
    const q = await app.request(`/api/stations/${kitchenStation.id}/queue`, {
      headers: { cookie },
    });
    const { items: groups } = (await q.json()) as {
      items: { orderId: string; items: { id: string }[] }[];
    };
    const itemId = groups.find((g) => g.orderId === id)!.items[0]!.id;

    // A `to` outside {preparing, ready, queued} — no route-level screen, so it reaches the verb as-is.
    const garbage = await app.request(`/api/ticket-items/${itemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "garbage", stationId: kitchenStation.id }),
    });
    expect(garbage.status).toBe(400);
    expect(await garbage.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "to" } },
    });

    // Names every object inherits are not transitions, and a non-string `to` is refused, not
    // converted to a key.
    const malformed: unknown[] = [
      "__proto__",
      "toString",
      "constructor",
      "hasOwnProperty",
      ["preparing"],
      [["preparing"]],
      { toString: null },
      { toString: "preparing" },
    ];
    for (const to of malformed) {
      const refused = await app.request(`/api/ticket-items/${itemId}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ to, stationId: kitchenStation.id }),
      });
      expect({ to, status: refused.status }).toEqual({ to, status: 400 });
      expect(await refused.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "to" } },
      });
    }

    // A missing `to` — the body has no `to` field at all.
    const missing = await app.request(`/api/ticket-items/${itemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ stationId: kitchenStation.id }),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "to" } },
    });

    const after = await app.request(`/api/stations/${kitchenStation.id}/queue`, {
      headers: { cookie },
    });
    const { items: afterGroups } = (await after.json()) as {
      items: { orderId: string; items: { state: string }[] }[];
    };
    expect(afterGroups.find((g) => g.orderId === id)!.items[0]!.state).toBe("queued");
  });

  /** The one ticket item `placeFired` put on order `orderId`, read from the table. */
  async function firedItem(orderId: string) {
    const [item] = await suite.db
      .select({
        id: ticketItems.id,
        stationId: ticketItems.stationId,
        lineId: ticketItems.workingOrderLineId,
        state: ticketItems.state,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(workingOrderLines.workingOrderId, orderId));
    return item!;
  }

  it("a dish moved to another station is refused 403 device.forbidden_station when bumped from its old station's view, and stays as it was", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = await placeFired(app, cookie);
    const kitchenStation = await defaultStation(app, cookie);
    const grill = await seedKitchenStation(suite.db, {
      name: `Grill ${randomUUID()}`,
      isDefault: false,
    });
    const before = await firedItem(id);
    expect(before.stationId).toBe(kitchenStation.id);

    const moved = await app.request(`/api/working-orders/${id}/lines/move-station`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        submissionId: randomUUID(),
        lineIds: [before.lineId],
        stationId: grill,
      }),
    });
    expect(moved.status).toBe(200);

    // Cocina's view still shows the dish until its next read, and presses it.
    const stale = await app.request(`/api/ticket-items/${before.id}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "preparing", stationId: kitchenStation.id }),
    });
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({
      error: { code: "device.forbidden_station", params: { stationId: grill } },
    });
    expect(await firedItem(id)).toMatchObject({ stationId: grill, state: "queued" });

    // The dish's own station still bumps it.
    const own = await app.request(`/api/ticket-items/${before.id}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "preparing", stationId: grill.toUpperCase() }),
    });
    expect(own.status).toBe(200);
    expect(await firedItem(id)).toMatchObject({ stationId: grill, state: "preparing" });
  });

  it("POST /api/ticket-items/:id/advance with a missing or malformed `stationId` is 400 management.request_invalid", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = await placeFired(app, cookie);
    const item = await firedItem(id);
    for (const body of [
      { to: "preparing" },
      { to: "preparing", stationId: "not-a-uuid" },
      { to: "preparing", stationId: 7 },
      { to: "preparing", stationId: null },
    ]) {
      const res = await app.request(`/api/ticket-items/${item.id}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "stationId" } },
      });
    }
    expect(await firedItem(id)).toMatchObject({ state: "queued" });
  });

  it("GET /api/stations/:id/queue with a malformed id is 404 station.not_found", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const res = await app.request("/api/stations/not-a-uuid/queue", { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "station.not_found", params: { stationId: "not-a-uuid" } },
    });
  });

  it("a station's queue carries its unacknowledged kitchen notices, and acknowledging one clears it", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = randomUUID();
    await park(app, cookie, {
      id,
      lines: [{ menuItemId: waterOfferId, quantity: "1" }],
      label: "Mesa 3",
    });
    // A unit label its product does not have, so the notice can only carry it by copying the line's.
    await withTransaction(suite.db, (tx) =>
      tx.execute(
        sql`update working_order_lines set unit_name = ${JSON.stringify({ "es-ES": "kg" })}
            where working_order_id = ${id}`,
      ),
    );
    await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${sessionDeviceCookie}` },
    });
    const kitchenStation = await defaultStation(app, cookie);
    // A notice as a void of that line records it.
    await withTransaction(suite.db, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(
        sql`select id from working_order_lines where working_order_id = ${id}`,
      );
      await VENUE_SERVICE.recordKitchenNotices(
        tx,
        id,
        [
          {
            workingOrderLineId: rows[0]!.id,
            stationId: kitchenStation.id,
            quantity: decimal("1"),
            wasStarted: true,
          },
        ],
        "void",
      );
    });
    const notices = async () => {
      const res = await app.request(`/api/stations/${kitchenStation.id}/queue`, {
        headers: { cookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        notices: { id: string; workingOrderId: string; kind: string; wasStarted: boolean }[];
      };
      return body.notices.filter((notice) => notice.workingOrderId === id);
    };

    const [notice] = await notices();
    expect(notice).toMatchObject({
      kind: "void",
      wasStarted: true,
      orderLabel: expect.stringContaining("Mesa 3"),
      unitName: { "es-ES": "kg" },
    });
    const ack = await app.request(`/api/kitchen-notices/${notice!.id}/acknowledge`, {
      method: "POST",
      headers: { cookie },
    });
    expect(ack.status).toBe(200);
    expect(await ack.text()).toBe("");
    expect(await notices()).toEqual([]);

    for (const unknown of [randomUUID(), "not-a-uuid"]) {
      const res = await app.request(`/api/kitchen-notices/${unknown}/acknowledge`, {
        method: "POST",
        headers: { cookie },
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: { code: "kitchen_notice.not_found", params: { noticeId: unknown } },
      });
    }
  });

  it("REJECTS every station-operate route with 401 session.required when no cookie is present", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const someId = randomUUID();
    const j = { "content-type": "application/json" };
    const advanceBody = JSON.stringify({ to: "preparing" });
    // The guard runs FIRST on each route.
    const cases = [
      app.request("/api/stations"),
      app.request(`/api/stations/${someId}/queue`),
      app.request(`/api/kitchen-notices/${someId}/acknowledge`, { method: "POST" }),
      app.request(`/api/ticket-items/${someId}/advance`, {
        method: "POST",
        headers: j,
        body: advanceBody,
      }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
    }
  });
});

describe("/api/working-orders/:id/cancel", () => {
  it.each([{}, { reason: null }, { reason: 42 }])(
    "refuses a cancellation with no text reason in %j",
    async (body) => {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));
      const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
      const id = randomUUID();
      const res = await app.request(`/api/working-orders/${id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "working_order.reason_required", params: { workingOrderId: id } },
      });
    },
  );

  it("POST cancels a PLACED order (placed → abandoned) given a reason", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ menuItemId: waterOfferId, quantity: "1" }] });
    await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${sessionDeviceCookie}` },
    });

    const cancel = await app.request(`/api/working-orders/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reason: "customer left" }),
    });
    expect(cancel.status).toBe(200);
    expect(await cancel.text()).toBe("");

    const order = await suite.db.execute<{ status: string }>(
      sql`select status from working_orders where id = ${id}`,
    );
    expect(order.rows[0]).toEqual({ status: "abandoned" });
  });

  it("POST with an empty reason is 400 working_order.reason_required, changing nothing", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ menuItemId: waterOfferId, quantity: "1" }] });
    await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${sessionDeviceCookie}` },
    });

    const cancel = await app.request(`/api/working-orders/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reason: "" }),
    });
    expect(cancel.status).toBe(400);
    expect(await cancel.json()).toMatchObject({ error: { code: "working_order.reason_required" } });

    // Refused BEFORE any transition — still `placed`, the guard `cancelPlacedOrder` itself enforces.
    const order = await suite.db.execute<{ status: string }>(
      sql`select status from working_orders where id = ${id}`,
    );
    expect(order.rows[0]).toEqual({ status: "placed" });
  });

  it("POST with a malformed id is 409 working_order.not_placed", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;

    const res = await app.request("/api/working-orders/not-a-uuid/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reason: "changed mind" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_placed", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

// The live-floor till surface: GET /api/zones (list-only), the mark/unmark-served route, and the
// zoneId + pendingToServe fields of the /api/tables/state read. served_at is a PRE-FISCAL
// operational field: nothing here touches a fiscal path. Zone CRUD is the management API's, so a
// zone is seeded directly.
describe("/api/zones + served route + /api/tables/state occupancy fields", () => {
  async function tabZone(): Promise<{ zoneId: string; waterOffer: string }> {
    const offers = await withTransaction(suite.db, (tx) =>
      offerProducts(tx, { zone: "tables", productIds: [waterProduct.id] }),
    );
    return { zoneId: offers.zoneId, waterOffer: offers.offerFor(waterProduct.id) };
  }

  /** The id of line `lineNo` of the tab, as the tab's lines read carries it. */
  async function lineIdOf(app: Hono, cookie: string, tabId: string, lineNo: number) {
    const res = await app.request(`/api/working-orders/${tabId}/lines`, { headers: { cookie } });
    const { lines } = (await res.json()) as { lines: { id: string; lineNo: number }[] };
    return lines.find((line) => line.lineNo === lineNo)!.id;
  }

  /** A served (or unserved) mark for the party, at the revision its groups read answers. */
  async function mark(
    app: Hono,
    cookie: string,
    partyId: string,
    path: "served" | "unserved",
    items: unknown,
  ): Promise<Response> {
    const read = await app.request(`/api/parties/${partyId}/groups`, { headers: { cookie } });
    const { revision } =
      read.status === 200 ? ((await read.json()) as { revision: number }) : { revision: 0 };
    return app.request(`/api/parties/${partyId}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ submissionId: randomUUID(), expectedPartyRevision: revision, items }),
    });
  }

  it("lists zones, marks a line served (2→1) and unmarks it (1→2), surfacing zoneId + pendingToServe in the state read", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;

    // Seed one active floor zone in the till's own venue. `GET /api/zones` must read it back, and
    // the table-create must accept it, so those two paths — not this insert — are under test. This
    // is the only zone-seeding test in the suite, so "Comedor" cannot collide.
    const zoneRow = await seedZone(suite.db, { name: "Comedor" });
    const zoneId = zoneRow!.id;
    const [department] = await suite.db
      .insert(departments)
      .values({
        name: "Dining room",
        tradingName: "Restaurant",
      })
      .returning({ id: departments.id });
    await suite.db.execute(
      sql`update floor_zones set department_id = ${department!.id} where id = ${zoneId}`,
    );
    await suite.db.execute(
      sql`update departments set order_start = 'table' where id = ${department!.id}`,
    );
    await suite.db.execute(sql`update floor_zones set order_start = 'table' where id = ${zoneId}`);
    await withTransaction(suite.db, async (tx) => {
      await offerMenuThroughZone(tx, zoneId, waterProduct.menuId, { makeDefault: true });
    });

    const { id: tableId } = await withTransaction(suite.db, (tx) =>
      createTable(tx, { label: "4", zoneId }),
    );

    // Seat the table, then ring TWO lines. `priceBasket` maps items 1:1 (it does NOT merge by
    // product), so two lines of the one seeded product become line_no 1 and 2 — pendingToServe
    // starts at 2.
    const tabRes = await app.request(`/api/tables/${tableId}/seat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(tabRes.status).toBe(200);
    const { tabId, partyId } = (await tabRes.json()) as { tabId: string; partyId: string };
    const round = await sendRound(app, { cookie }, partyId, [
      { menuItemId: waterOfferId, quantity: "1" },
      { menuItemId: waterOfferId, quantity: "1" },
    ]);
    expect(round.status).toBe(200);

    // GET /api/zones lists the active zone (session-gated, by display_order).
    const zonesRes = await app.request("/api/zones", { headers: { cookie } });
    expect(zonesRes.status).toBe(200);
    const zones = (await zonesRes.json()) as {
      id: string;
      name: string;
      displayOrder: number;
      active: boolean;
    }[];
    expect(zones.map((z) => z.name)).toContain("Comedor");
    expect(zones).toContainEqual({
      id: zoneId,
      name: "Comedor",
      displayOrder: 0,
      active: true,
      closed: false,
      closesAt: null,
      hasPlan: false,
      layoutSetName: null,
      layoutDue: null,
      serviceMode: "table_tab",
    });

    // Read this table's occupancy row out of the state read.
    const stateOf = async () => {
      const res = await app.request("/api/tables/state", { headers: { cookie } });
      expect(res.status).toBe(200);
      const rows = (await res.json()) as {
        id: string;
        zoneId: string | null;
        pendingToServe: number;
      }[];
      return rows.find((t) => t.id === tableId)!;
    };

    // The state read carries the table's zoneId and its pending-to-serve count (2 unserved).
    let state = await stateOf();
    expect(state.zoneId).toBe(zoneId);
    expect(state.pendingToServe).toBe(2);

    // Serving line 1 drops pendingToServe to 1; the answer is the party's new revision.
    const lineId = await lineIdOf(app, cookie, tabId, 1);
    const partyRevision = async () =>
      (
        (await (
          await app.request(`/api/parties/${partyId}/groups`, { headers: { cookie } })
        ).json()) as {
          revision: number;
        }
      ).revision;
    const served = await mark(app, cookie, partyId, "served", [{ lineId, quantity: "1" }]);
    expect(served.status).toBe(200);
    expect(await served.json()).toEqual({ revision: await partyRevision() });
    state = await stateOf();
    expect(state.pendingToServe).toBe(1);

    // Unserving takes it back (the mis-tap inverse) — pendingToServe returns to 2.
    const unserved = await mark(app, cookie, partyId, "unserved", [{ lineId, quantity: "1" }]);
    expect(unserved.status).toBe(200);
    expect(await unserved.json()).toEqual({ revision: await partyRevision() });
    state = await stateOf();
    expect(state.pendingToServe).toBe(2);
  });

  it("REJECTS GET /api/zones + the served, unserved and group served POSTs with 401 session.required when no cookie is present", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const id = randomUUID();
    // The guard runs FIRST on each route (before any DB work), so an unauthenticated list or mark
    // all 401 with the one code.
    const cases = [
      app.request("/api/zones"),
      app.request(`/api/parties/${id}/served`, { method: "POST" }),
      app.request(`/api/parties/${id}/unserved`, { method: "POST" }),
      app.request(`/api/parties/${id}/groups/${randomUUID()}/served`, { method: "POST" }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
    }
  });

  it("served POST with a malformed :id is 409 party.not_open", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;

    // The route refuses a non-UUID :id with the SAME code a closed or absent party gets.
    const res = await mark(app, cookie, "not-a-uuid", "served", [
      { lineId: randomUUID(), quantity: "1" },
    ]);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "party.not_open", params: { partyId: "not-a-uuid" } },
    });
  });

  it("served POST with items that are not a list of string lineId and quantity is 400 management.request_invalid", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;

    // A REAL party with a line, so only the body's shape can refuse.
    const tab = await tabZone();
    const { id: tableId } = await withTransaction(suite.db, (tx) =>
      createTable(tx, { label: "served-bad-items", zoneId: tab.zoneId }),
    );
    const tabRes = await app.request(`/api/tables/${tableId}/seat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    const { tabId, partyId } = (await tabRes.json()) as { tabId: string; partyId: string };
    const round = await sendRound(app, { cookie }, partyId, [
      { menuItemId: tab.waterOffer, quantity: "1" },
    ]);
    expect(round.status).toBe(200);
    const lineId = await lineIdOf(app, cookie, tabId, 1);

    for (const items of [
      undefined,
      "all",
      [null],
      [{ lineId }],
      [{ lineId, quantity: 1 }],
      [{ lineId: 7, quantity: "1" }],
    ]) {
      for (const path of ["served", "unserved"] as const) {
        const res = await mark(app, cookie, partyId, path, items);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          error: { code: "management.request_invalid", params: { field: "items" } },
        });
      }
    }
  });

  it("served POST naming a line that is not on the party's bills is 400 group.not_found", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;

    // A real party with one line, then a mark of a line id that names nothing — and one that is no
    // UUID at all: the command's own guard, not a route screen.
    const tab = await tabZone();
    const { id: tableId } = await withTransaction(suite.db, (tx) =>
      createTable(tx, { label: "served-99", zoneId: tab.zoneId }),
    );
    const tabRes = await app.request(`/api/tables/${tableId}/seat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    const { partyId } = (await tabRes.json()) as { tabId: string; partyId: string };
    const round = await sendRound(app, { cookie }, partyId, [
      { menuItemId: tab.waterOffer, quantity: "1" },
    ]);
    expect(round.status).toBe(200);

    for (const lineId of [randomUUID(), "99"]) {
      const res = await mark(app, cookie, partyId, "served", [{ lineId, quantity: "1" }]);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "group.not_found", params: { lineId } },
      });
    }
  });

  it("served POST on a well-formed id that names no OPEN party is 409 party.not_open (the command's own guard)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;

    // A valid uuid naming no party: clears the route's isUuid screen and reaches the command, which
    // finds no open party.
    const res = await mark(app, cookie, randomUUID(), "served", [
      { lineId: randomUUID(), quantity: "1" },
    ]);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "party.not_open" } });
  });
});

// HTTP serialization and deterministic pricing need no concurrency or privilege assertion here.
// Each fixture owns a fresh product and offer so other menu expectations remain independent.
// The suite shares one database and an Active product's staff name is unique, so each fixture's
// products carry its own number.
let modifierFixtures = 0;

async function modifierOfferFixture() {
  const fixture = ++modifierFixtures;
  const data = await withTransaction(suite.db, async (tx) => {
    const { defaultLanguage } = await readContentLanguages(tx, cfg.locale);
    const product = await createProduct(tx, {
      categoryId: null,
      name: `Prueba de modificadores ${fixture}`,
      pricingUnit: "each",
      unitPrice: "8.00",
      vatClass: "general",
    });
    const offer = await addProductToMenu(tx, {
      menuId: waterProduct.menuId,
      productId: product.id,
      grossPrice: "1.75",
    });

    const cheese = await createProduct(tx, {
      categoryId: null,
      name: `Cheese staff ${fixture}`,
      customerName: { [defaultLanguage]: "Queso customer" },
      kitchenName: "Queso kitchen",
      pricingUnit: "each",
      unitPrice: "9.00",
      vatClass: "general",
    });
    const extrasList = await createExtraList(
      tx,
      {
        name: "Extras",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 2,
        active: true,
        items: [{ productId: cheese.id, maxQuantity: 2, preselected: false, price: "0.35" }],
      },
      cfg.locale,
    );
    const secondExtrasList = await createExtraList(
      tx,
      {
        name: "Extras sin publicar",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 1,
        active: true,
        items: [{ productId: cheese.id, maxQuantity: 1, preselected: false, price: "1.00" }],
      },
      cfg.locale,
    );
    const prepList = await createOptionList(
      tx,
      {
        name: "Preparation staff",
        customerName: { [defaultLanguage]: "Preparación customer" },
        kitchenName: "Preparación kitchen",
        defaultLabelId: null,
        active: true,
        labels: [
          {
            name: "Cold staff",
            customerName: { [defaultLanguage]: "Frío customer" },
            kitchenName: "Frío kitchen",
            available: true,
          },
          {
            name: "Hot staff",
            customerName: { [defaultLanguage]: "Caliente customer" },
            kitchenName: "Caliente kitchen",
            available: true,
          },
        ],
      },
      cfg.locale,
    );
    await writeProductModifiers(tx, product.id, [
      { kind: "extras", id: extrasList.id },
      { kind: "extras", id: secondExtrasList.id },
      { kind: "options", id: prepList.id },
    ]);

    await publishWorkingMenu(tx, waterProduct.menuId);
    return {
      product,
      offer,
      cheese,
      extrasList,
      secondExtrasList,
      prepList,
      defaultLanguage,
    };
  });
  const coldLabel = data.prepList.labels.find((label) => label.name === "Cold staff")!;
  const hotLabel = data.prepList.labels.find((label) => label.name === "Hot staff")!;
  const language = data.defaultLanguage;
  /** The diner's answers, in the wire shape every order route takes. */
  const answers = {
    extras: [{ listId: data.extrasList.id, picks: [{ productId: data.cheese.id, quantity: 2 }] }],
    options: [{ listId: data.prepList.id, labelId: coldLabel.id }],
  };
  const optionSnapshots = [
    {
      listId: data.prepList.id,
      listName: { [language]: "Preparation staff" },
      listCustomerName: { [language]: "Preparación customer" },
      listKitchenName: "Preparación kitchen",
      labelName: { [language]: "Cold staff" },
      labelCustomerName: { [language]: "Frío customer" },
      labelKitchenName: "Frío kitchen",
    },
  ];
  /** The child line as the held-order read hands it back: the list's price, per-dish picks, and
   * the list the pick was taken from. */
  const parkedExtras = [
    {
      productId: data.cheese.id,
      name: `Cheese staff ${fixture}`,
      descriptions: { "es-ES": "Queso customer" },
      kitchenName: "Queso kitchen",
      price: "0.35",
      quantity: 2,
      listId: data.extrasList.id,
      addAllergens: null,
      suitableFor: [],
    },
  ];
  const app = new Hono();
  mountTillApi(app, deps(suite.db), collect([]));
  const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${sessionDeviceCookie}`;
  const headers = { "content-type": "application/json", cookie };
  return {
    ...data,
    coldLabel,
    hotLabel,
    answers,
    optionSnapshots,
    parkedExtras,
    app,
    headers,
  };
}

/** The held-order read's shape, as far as these tests assert on it. */
type HeldLine = {
  workingOrderLineId: string;
  quantity: string;
  optionSnapshots?: unknown;
  extras?: unknown;
};

describe("canonical modifier HTTP serialization", () => {
  it("publishes every mode, parks explicit answers and prices published extras exactly", async () => {
    const f = await modifierOfferFixture();

    const offers = await f.app.request("/api/default-service-zone/offers", { headers: f.headers });
    expect(offers.status).toBe(200);
    const offerBody = (await offers.json()) as {
      offers: { id: string; offeredModifiers: { kind: string; id: string }[] }[];
    };
    const published = offerBody.offers.find((offer) => offer.id === f.offer.id)!;
    expect(published.offeredModifiers.map((entry) => [entry.kind, entry.id])).toEqual([
      ["extras", f.extrasList.id],
      ["extras", f.secondExtrasList.id],
      ["options", f.prepList.id],
    ]);
    expect(published.offeredModifiers[0]).toMatchObject({
      items: [expect.objectContaining({ productId: f.cheese.id, price: "0.35" })],
    });
    const id = randomUUID();
    const parked = await f.app.request("/api/working-orders", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        dining: "eat_in",
        id,
        lines: [{ menuItemId: f.offer.id, quantity: "2", ...f.answers }],
      }),
    });
    expect(parked.status, await parked.clone().text()).toBe(200);
    const got = await f.app.request(`/api/working-orders/${id}`, { headers: f.headers });
    expect(got.status).toBe(200);
    const body = (await got.json()) as { lines: HeldLine[]; revision: number };
    expect(body.lines[0]!.optionSnapshots).toEqual(f.optionSnapshots);
    expect(body.lines[0]!.extras).toEqual(f.parkedExtras);
    // 1.75 × 2 dishes = 3.50, plus the published 0.35 × (2 dishes × 2 picks) = 1.40.
    const listed = await f.app.request("/api/working-orders", { headers: f.headers });
    expect(await listed.json()).toContainEqual(expect.objectContaining({ id, total: "4.90" }));

    // A quantity-only edit keeps the frozen answers and re-prices from the stored lock alone.
    const edited = await f.app.request(`/api/working-orders/${id}`, {
      method: "PUT",
      headers: f.headers,
      body: JSON.stringify({
        dining: "eat_in",
        lines: [
          {
            workingOrderLineId: body.lines[0]!.workingOrderLineId,
            menuItemId: f.offer.id,
            quantity: "4",
            ...f.answers,
          },
        ],
        revision: body.revision,
      }),
    });
    expect(edited.status, await edited.clone().text()).toBe(200);
    const afterEdit = await f.app.request(`/api/working-orders/${id}`, { headers: f.headers });
    const afterEditBody = (await afterEdit.json()) as { lines: HeldLine[] };
    expect(afterEditBody.lines[0]!.optionSnapshots).toEqual(f.optionSnapshots);
    expect(afterEditBody.lines[0]!.extras).toEqual(f.parkedExtras);
    const editedList = await f.app.request("/api/working-orders", { headers: f.headers });
    expect(await editedList.json()).toContainEqual(expect.objectContaining({ id, total: "9.80" }));

    // The parked line holds the six names BY VALUE, so renaming the list and its labels afterwards
    // leaves the order reading exactly what the diner was shown.
    await withTransaction(suite.db, async (tx) => {
      await updateOptionList(
        tx,
        f.prepList.id,
        {
          name: "Nombre nuevo",
          customerName: null,
          kitchenName: null,
          defaultLabelId: null,
          active: true,
          labels: f.prepList.labels.map((label) => ({
            id: label.id,
            name: `${label.name} nuevo`,
            customerName: null,
            kitchenName: null,
            available: label.available,
          })),
        },
        cfg.locale,
      );
    });
    const resumed = await f.app.request(`/api/working-orders/${id}`, { headers: f.headers });
    expect(((await resumed.json()) as { lines: HeldLine[] }).lines[0]!.optionSnapshots).toEqual(
      f.optionSnapshots,
    );
  });

  it("accepts every carried extras list and refuses an unknown list or withdrawn label through the working-order request", async () => {
    const f = await modifierOfferFixture();
    const park = (line: Record<string, unknown>) =>
      f.app.request("/api/working-orders", {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({
          dining: "eat_in",
          id: randomUUID(),
          lines: [{ menuItemId: f.offer.id, quantity: "1", ...f.answers, ...line }],
        }),
      });

    const carried = await park({
      extras: [
        ...f.answers.extras,
        { listId: f.secondExtrasList.id, picks: [{ productId: f.cheese.id, quantity: 1 }] },
      ],
    });
    expect(carried.status, await carried.clone().text()).toBe(200);

    // A list id nothing attaches to this dish at all.
    const unknown = await park({
      options: [{ listId: randomUUID(), labelId: f.coldLabel.id }],
    });
    expect(unknown.status, await unknown.clone().text()).toBe(400);
    expect(await unknown.json()).toMatchObject({
      error: { code: "options.invalid", params: { field: "listId" } },
    });

    // A label the list still carries and no longer offers: a till holding a stale menu is refused
    // rather than selling the dish with a withdrawn answer.
    await withTransaction(suite.db, async (tx) => {
      await updateOptionList(
        tx,
        f.prepList.id,
        {
          name: f.prepList.name,
          customerName: f.prepList.customerName,
          kitchenName: f.prepList.kitchenName,
          defaultLabelId: null,
          active: true,
          labels: f.prepList.labels.map((label) => ({
            id: label.id,
            name: label.name,
            customerName: label.customerName,
            kitchenName: label.kitchenName,
            available: label.id !== f.coldLabel.id,
          })),
        },
        cfg.locale,
      );
    });
    const withdrawn = await park({});
    expect(withdrawn.status, await withdrawn.clone().text()).toBe(400);
    expect(await withdrawn.json()).toMatchObject({
      error: { code: "options.label_required", params: { optionListId: f.prepList.id } },
    });
  });

  it("carries extras and options through each round on a seated table", async () => {
    const f = await modifierOfferFixture();
    const zone = await seedZone(suite.db, { name: "Modifier tables" });
    const zoneId = zone!.id;
    const [modifierDepartment] = await suite.db
      .insert(departments)
      .values({
        name: "Modifier tables",
        tradingName: "Restaurant",
      })
      .returning({ id: departments.id });
    await suite.db.execute(
      sql`update floor_zones set department_id = ${modifierDepartment!.id} where id = ${zoneId}`,
    );
    await suite.db.execute(
      sql`update departments set order_start = 'table' where id = ${modifierDepartment!.id}`,
    );
    await suite.db.execute(sql`update floor_zones set order_start = 'table' where id = ${zoneId}`);
    await withTransaction(suite.db, async (tx) => {
      await offerMenuThroughZone(tx, zoneId, waterProduct.menuId, { makeDefault: true });
    });
    const { id: tableId } = await withTransaction(suite.db, (tx) =>
      createTable(tx, { label: "Modifiers", zoneId }),
    );
    const line = { menuItemId: f.offer.id, quantity: "1", ...f.answers };
    const opened = await f.app.request(`/api/tables/${tableId}/seat`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({}),
    });
    expect(opened.status, await opened.clone().text()).toBe(200);
    const { tabId, partyId } = (await opened.json()) as { tabId: string; partyId: string };
    for (let round = 0; round < 2; round++) {
      const rung = await sendRound(f.app, f.headers, partyId, [line]);
      expect(rung.status, await rung.clone().text()).toBe(200);
    }
    const got = await f.app.request(`/api/working-orders/${tabId}`, { headers: f.headers });
    expect(got.status).toBe(200);
    const body = (await got.json()) as { lines: HeldLine[]; revision: number };
    expect(body.lines.map((line) => line.optionSnapshots)).toEqual([
      f.optionSnapshots,
      f.optionSnapshots,
    ]);
    // Each dish is ONE here, so a pick of two is a child quantity of two on both rounds.
    expect(body.lines.map((line) => line.extras)).toEqual([f.parkedExtras, f.parkedExtras]);
  });
});

describe("canonical modifier checkout refusal", () => {
  it.each(["park", "pay"])(
    "rejects a repeated negative extra pick before %s writes an order",
    async (step) => {
      const f = await modifierOfferFixture();
      const id = randomUUID();
      const lines = [
        {
          menuItemId: f.offer.id,
          quantity: "1",
          options: f.answers.options,
          extras: [
            {
              listId: f.extrasList.id,
              picks: [
                { productId: f.cheese.id, quantity: 2 },
                { productId: f.cheese.id, quantity: -1 },
              ],
            },
          ],
        },
      ];
      const path = step === "park" ? "/api/working-orders" : `/api/working-orders/${id}/payments`;
      const body =
        step === "park"
          ? { dining: "eat_in", id, lines }
          : {
              dining: "eat_in",
              submissionId: id,
              kind: "share",
              shareOf: 1,
              method: "cash",
              tendered: "20.00",
              basket: { lines },
            };
      const response = await f.app.request(path, {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify(body),
      });
      expect(response.status, await response.clone().text()).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "extras.invalid", params: { field: "productId" } },
      });
      const stored = await suite.db.execute(sql`select id from working_orders where id=${id}`);
      expect(stored.rows).toEqual([]);
    },
  );
});

describe("a till request cannot hand over settled extras or options", () => {
  /** An extras pick in the shape the server settles internally, at a price and count of the
   * sender's choosing: the list sells this cheese at 0.35, two at most. */
  const settledPick = (f: Awaited<ReturnType<typeof modifierOfferFixture>>) => ({
    productId: f.cheese.id,
    name: f.cheese.name,
    descriptions: {},
    kitchenName: null,
    price: "0.00",
    listId: f.extrasList.id,
    vatClass: "general",
    quantity: 7,
  });

  async function storedLines(id: string) {
    return (
      await suite.db.execute(sql`
        select product_id, cast(unit_price_gross as int) as unit_price_gross, quantity
        from working_order_lines where working_order_id = ${id} order by line_no`)
    ).rows;
  }

  it.each([
    ["frozenExtras", (f: Awaited<ReturnType<typeof modifierOfferFixture>>) => [settledPick(f)]],
    ["frozenOptions", (f: Awaited<ReturnType<typeof modifierOfferFixture>>) => f.optionSnapshots],
  ] as const)("refuses a parked line carrying %s before any write", async (key, value) => {
    const f = await modifierOfferFixture();
    const id = randomUUID();
    const response = await f.app.request("/api/working-orders", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        dining: "eat_in",
        id,
        lines: [{ menuItemId: f.offer.id, quantity: "1", ...f.answers, [key]: value(f) }],
      }),
    });
    expect(response.status, await response.clone().text()).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "lines" } },
    });
    const stored = await suite.db.execute(sql`select id from working_orders where id=${id}`);
    expect(stored.rows).toEqual([]);
  });

  it("refuses a held-order edit adding a line that carries frozenExtras, leaving the order as it was", async () => {
    const f = await modifierOfferFixture();
    const id = randomUUID();
    const parked = await f.app.request("/api/working-orders", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        dining: "eat_in",
        id,
        lines: [{ menuItemId: f.offer.id, quantity: "1", ...f.answers }],
      }),
    });
    expect(parked.status, await parked.clone().text()).toBe(200);
    const got = await f.app.request(`/api/working-orders/${id}`, { headers: f.headers });
    const body = (await got.json()) as { lines: HeldLine[]; revision: number };
    const before = await storedLines(id);

    const edited = await f.app.request(`/api/working-orders/${id}`, {
      method: "PUT",
      headers: f.headers,
      body: JSON.stringify({
        dining: "eat_in",
        lines: [
          {
            workingOrderLineId: body.lines[0]!.workingOrderLineId,
            menuItemId: f.offer.id,
            quantity: "1",
            ...f.answers,
          },
          {
            menuItemId: f.offer.id,
            quantity: "1",
            options: f.answers.options,
            frozenExtras: [settledPick(f)],
          },
        ],
        revision: body.revision,
      }),
    });
    expect(edited.status, await edited.clone().text()).toBe(400);
    expect(await edited.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "lines" } },
    });
    expect(await storedLines(id)).toEqual(before);
    const after = await f.app.request(`/api/working-orders/${id}`, { headers: f.headers });
    expect(((await after.json()) as { revision: number }).revision).toBe(body.revision);
  });

  it.each([
    ["frozenExtras", (f: Awaited<ReturnType<typeof modifierOfferFixture>>) => [settledPick(f)]],
    ["frozenOptions", (f: Awaited<ReturnType<typeof modifierOfferFixture>>) => f.optionSnapshots],
  ] as const)(
    "refuses a held-order edit whose retained line carries %s, leaving the order as it was",
    async (key, value) => {
      const f = await modifierOfferFixture();
      const id = randomUUID();
      const parked = await f.app.request("/api/working-orders", {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({
          dining: "eat_in",
          id,
          lines: [{ menuItemId: f.offer.id, quantity: "1", ...f.answers }],
        }),
      });
      expect(parked.status, await parked.clone().text()).toBe(200);
      const got = await f.app.request(`/api/working-orders/${id}`, { headers: f.headers });
      const body = (await got.json()) as { lines: HeldLine[]; revision: number };
      const before = await storedLines(id);

      const edited = await f.app.request(`/api/working-orders/${id}`, {
        method: "PUT",
        headers: f.headers,
        body: JSON.stringify({
          dining: "eat_in",
          lines: [
            {
              workingOrderLineId: body.lines[0]!.workingOrderLineId,
              menuItemId: f.offer.id,
              quantity: "2",
              ...f.answers,
              [key]: value(f),
            },
          ],
          revision: body.revision,
        }),
      });
      expect(edited.status, await edited.clone().text()).toBe(400);
      expect(await edited.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "lines" } },
      });
      expect(await storedLines(id)).toEqual(before);
      const after = await f.app.request(`/api/working-orders/${id}`, { headers: f.headers });
      expect(((await after.json()) as { revision: number }).revision).toBe(body.revision);
    },
  );

  it("still refuses extras picked past the list's limit through the plain extras field", async () => {
    const f = await modifierOfferFixture();
    const id = randomUUID();
    const response = await f.app.request("/api/working-orders", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        dining: "eat_in",
        id,
        lines: [
          {
            menuItemId: f.offer.id,
            quantity: "1",
            options: f.answers.options,
            extras: [{ listId: f.extrasList.id, picks: [{ productId: f.cheese.id, quantity: 7 }] }],
          },
        ],
      }),
    });
    expect(response.status, await response.clone().text()).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "extras.limit_exceeded", params: { extraListId: f.extrasList.id } },
    });
    const stored = await suite.db.execute(sql`select id from working_orders where id=${id}`);
    expect(stored.rows).toEqual([]);
  });
});

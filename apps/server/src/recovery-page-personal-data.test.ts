import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPassword,
  hashPin,
  loginWithPin,
  persons,
  startManagementSession,
} from "@waitron/identity";
import { applyHistoricalTestVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import "@waitron/payments-sumup";
import { AppError, locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import { createErrorBoundary, MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";
import { createLogger, type Logger } from "./logger.js";
import { createRotatingFileSink, tee } from "./log-file.js";
import { mountManagementApi } from "./management-api.js";
import { mountMeApi } from "./me-api.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { FRESH, afterFailure } from "./recovery-state.js";
import { recoveryApp } from "./recovery-surface.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { inTx, setupPartyVenue } from "./testing/party-venue.js";
import { plannedZone, withRevision } from "./testing/floor-today-venue.js";
import { seedSessionDevice } from "./testing/session-device.js";

const MARTA_EMAIL = "marta.soler@example.test";
const MARTA_NAME = "Marta Soler";
const VENUE_LEGAL_NAME = "Jordi Puig Ferrer";
const VENUE_TAX_ID = "12345678Z";
const LOCATION_NAME = "Bar del Port";
const TODAY_NAME = "Soler";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 120_000,
});

const state = afterFailure(FRESH, "module.config_invalid", new Date());

interface Rig {
  log: Logger;
  stdout: string[];
  logDir: string;
  page: () => Promise<string>;
  file: () => Promise<string>;
}

async function rig(): Promise<Rig> {
  const logDir = await mkdtemp(join(tmpdir(), "recovery-page-personal-data-"));
  const stdout: string[] = [];
  // As boot.ts builds the process logger, with stdout captured instead of written.
  const log = createLogger(
    tee(
      (line) => stdout.push(line),
      createRotatingFileSink({ dir: logDir, maxBytes: 10_000_000, maxFiles: 5 }),
    ),
    () => new Date(),
  );
  return {
    log,
    stdout,
    logDir,
    page: async () => (await recoveryApp({ state, logDir, onRetry: vi.fn() }).request("/")).text(),
    file: async () => readFile(join(logDir, "waitron.log"), "utf8"),
  };
}

function lineFor(text: string, event: string): unknown {
  const lines = text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { event?: unknown });
  const found = lines.filter((line) => line.event === event);
  expect(found).toHaveLength(1);
  return found[0];
}

/**
 * The event's line, on stdout and in the file, carries exactly `fields`; the page shows the code
 * and each masked key, so an empty tail cannot pass the "not on the page" checks.
 */
async function expectLogged(
  r: Rig,
  event: string,
  fields: Record<string, unknown>,
  hidden: string[],
): Promise<void> {
  const stdout = r.stdout.join("");
  const file = await r.file();
  const page = await r.page();
  const expected = { ...fields, at: expect.any(String), level: "warn", event };
  expect(lineFor(stdout, event)).toEqual(expected);
  expect(lineFor(file, event)).toEqual(expected);
  expect(page).toContain(event);
  for (const [key, value] of Object.entries(fields)) {
    if (value === "***") expect(page).toContain(`&quot;${key}&quot;:&quot;***&quot;`);
  }
  for (const secret of hidden) {
    expect(stdout).not.toContain(secret);
    expect(file).not.toContain(secret);
    expect(page).not.toContain(secret);
  }
}

let nif = 0;
let venueCfg: Parameters<typeof mountManagementApi>[1]["venueCfg"];

async function setupVenue(): Promise<{ adminId: string; martaId: string; clerkId: string }> {
  nif += 1;
  const venue = await applyHistoricalTestVenue(
    planVenue(
      {
        country: "ES",
        taxId: `${String(71_000_000 + nif).padStart(8, "0")}K`,
        legalName: "Recovery Deli SL",
        location: {
          name: "Main room",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Owner",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  venueCfg = {
    nodeId: brandNodeId(venue.nodeId),
    locationId: brandLocationId(venue.locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  return withTransaction(suite.db, async (tx) => {
    const [admin] = await tx.select({ id: persons.id }).from(persons).limit(1);
    const [marta] = await tx
      .insert(persons)
      .values({
        displayName: MARTA_NAME,
        email: MARTA_EMAIL,
        pinHash: hashPin("1111"),
        passwordHash: hashPassword("martaPass123"),
        role: "staff",
      })
      .returning({ id: persons.id });
    const [clerk] = await tx
      .insert(persons)
      .values({
        displayName: "Clerk",
        email: "clerk@example.test",
        pinHash: hashPin("2222"),
        passwordHash: hashPassword("clerkPass123"),
        role: "staff",
      })
      .returning({ id: persons.id });
    return { adminId: admin!.id, martaId: marta!.id, clerkId: clerk!.id };
  });
}

async function cookieFor(personId: string): Promise<string> {
  const session = await withTransaction(suite.db, (tx) => startManagementSession(tx, { personId }));
  return `${MANAGEMENT_COOKIE}=${session.token}`;
}

function management(log: Logger): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      venueCfg,
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: { current: { version: 1, key: Buffer.alloc(32, 21) } },
    },
    log,
  );
  return app;
}

function me(log: Logger): Hono {
  const app = new Hono();
  mountMeApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      venueLocale: "en-GB",
      modules: ["core"],
      credentialKeyRing: { current: { version: 1, key: Buffer.alloc(32, 6) } },
    },
    log,
  );
  return app;
}

async function send(
  app: Hono,
  method: string,
  path: string,
  cookie: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const EMAIL_TAKEN = {
  status: 409,
  body: { error: { code: "person.email_taken", params: { email: MARTA_EMAIL } } },
};
const NAME_TAKEN = {
  status: 409,
  body: { error: { code: "person.display_name_taken", params: { displayName: MARTA_NAME } } },
};

describe("the recovery page, the log file and stdout carry no person's details", () => {
  it("masks the email a new staff member was refused for", async () => {
    const { adminId } = await setupVenue();
    const r = await rig();

    const answer = await send(
      management(r.log),
      "POST",
      "/management-api/staff",
      await cookieFor(adminId),
      {
        displayName: "Someone Else",
        firstNames: "Someone",
        lastNames: "Else",
        telephone: null,
        role: "staff",
        email: MARTA_EMAIL,
      },
    );

    expect(answer).toEqual(EMAIL_TAKEN);
    await expectLogged(r, "person.email_taken", { email: "***" }, [MARTA_EMAIL]);
  });

  it("masks the display name a new staff member was refused for", async () => {
    const { adminId } = await setupVenue();
    const r = await rig();

    const answer = await send(
      management(r.log),
      "POST",
      "/management-api/staff",
      await cookieFor(adminId),
      {
        displayName: MARTA_NAME,
        firstNames: "Marta",
        lastNames: "Soler",
        telephone: null,
        role: "staff",
        email: "another@example.test",
      },
    );

    expect(answer).toEqual(NAME_TAKEN);
    await expectLogged(r, "person.display_name_taken", { displayName: "***" }, [MARTA_NAME]);
  });

  it("masks both when an administrator gives a staff member another person's email, then name", async () => {
    const { adminId, clerkId } = await setupVenue();
    const r = await rig();
    const cookie = await cookieFor(adminId);
    const edit = (change: { email: string; displayName: string }) =>
      send(management(r.log), "PUT", `/management-api/staff/${clerkId}`, cookie, {
        firstNames: "Clerk",
        lastNames: "Person",
        telephone: null,
        role: "staff",
        status: "active",
        ...change,
      });

    expect(await edit({ email: MARTA_EMAIL, displayName: "Clerk" })).toEqual(EMAIL_TAKEN);
    expect(await edit({ email: "clerk@example.test", displayName: MARTA_NAME })).toEqual(
      NAME_TAKEN,
    );
    await expectLogged(r, "person.email_taken", { email: "***" }, [MARTA_EMAIL, MARTA_NAME]);
    await expectLogged(r, "person.display_name_taken", { displayName: "***" }, [
      MARTA_EMAIL,
      MARTA_NAME,
    ]);
  });

  it("masks both when a person takes another person's name, then email, on their own profile", async () => {
    const { clerkId } = await setupVenue();
    const r = await rig();
    const cookie = await cookieFor(clerkId);
    const profile = (change: { email: string; displayName: string }) =>
      send(me(r.log), "PUT", "/management-api/session/me/profile", cookie, {
        firstNames: "Clerk",
        lastNames: "Person",
        telephone: null,
        locale: "en-GB",
        currentPassword: "clerkPass123",
        ...change,
      });

    expect(await profile({ displayName: MARTA_NAME, email: "clerk@example.test" })).toEqual(
      NAME_TAKEN,
    );
    expect(await profile({ displayName: "Clerk", email: MARTA_EMAIL })).toEqual(EMAIL_TAKEN);
    await expectLogged(r, "person.display_name_taken", { displayName: "***" }, [
      MARTA_EMAIL,
      MARTA_NAME,
    ]);
    await expectLogged(r, "person.email_taken", { email: "***" }, [MARTA_EMAIL, MARTA_NAME]);
  });

  it("masks people's names at any depth through the error boundary, and keeps things' names", async () => {
    const r = await rig();
    const run = createErrorBoundary(
      {
        "draft.taken_over": 409,
        "device.equipment_held": 409,
        "table.label_taken": 409,
        "restore.stream_venue_unconfirmed": 409,
        "payment.provider_merchant_ambiguous": 409,
      },
      "recovery_test.failed",
    );
    // Built afresh per request and compared with literals, so a mask that wrote into the thrown
    // params in place would show in the answers.
    const throws: [string, () => AppError, string, Record<string, unknown>][] = [
      [
        "owner",
        () =>
          new AppError("draft.taken_over", { draftId: "d1", ownerId: "p1", ownerName: MARTA_NAME }),
        "draft.taken_over",
        { draftId: "d1", ownerId: "p1", ownerName: "Marta Soler" },
      ],
      [
        "editor",
        () =>
          new AppError("draft.taken_over", {
            billId: "b1",
            draftId: null,
            ownerId: "p2",
            ownerName: null,
            edit: {
              billId: "b1",
              editorId: "p2",
              editorName: MARTA_NAME,
              editorVersion: 3,
              draftId: null,
              draftRevision: null,
            },
          }),
        "draft.taken_over",
        {
          billId: "b1",
          draftId: null,
          ownerId: "p2",
          ownerName: null,
          edit: {
            billId: "b1",
            editorId: "p2",
            editorName: "Marta Soler",
            editorVersion: 3,
            draftId: null,
            draftRevision: null,
          },
        },
      ],
      [
        "holder",
        () =>
          new AppError("device.equipment_held", {
            field: "receiptPrinterId",
            holderDeviceId: "dev1",
            holderDeviceName: "Bar till",
            holderPersonName: MARTA_NAME,
          }),
        "device.equipment_held",
        {
          field: "receiptPrinterId",
          holderDeviceId: "dev1",
          holderDeviceName: "Bar till",
          holderPersonName: "Marta Soler",
        },
      ],
      [
        "today",
        () => new AppError("table.label_taken", { todayName: TODAY_NAME, field: "name" }),
        "table.label_taken",
        { todayName: "Soler", field: "name" },
      ],
      [
        "plan",
        () => new AppError("table.label_taken", { label: "Patio 1" }),
        "table.label_taken",
        { label: "Patio 1" },
      ],
      [
        "venue",
        () =>
          new AppError("restore.stream_venue_unconfirmed", {
            legalName: VENUE_LEGAL_NAME,
            taxId: VENUE_TAX_ID,
            locationName: LOCATION_NAME,
          }),
        "restore.stream_venue_unconfirmed",
        { legalName: "Jordi Puig Ferrer", taxId: "12345678Z", locationName: "Bar del Port" },
      ],
      [
        "merchants",
        () =>
          new AppError("payment.provider_merchant_ambiguous", {
            merchants: [
              { code: "MC1", name: VENUE_LEGAL_NAME },
              { code: "MC2", name: MARTA_NAME },
            ],
          }),
        "payment.provider_merchant_ambiguous",
        {
          merchants: [
            { code: "MC1", name: "Jordi Puig Ferrer" },
            { code: "MC2", name: "Marta Soler" },
          ],
        },
      ],
    ];
    const api = new Hono();
    for (const [path, error] of throws) {
      api.get(`/${path}`, (c) =>
        run(c, r.log, () => {
          throw error();
        }),
      );
    }

    for (const [path, , code, params] of throws) {
      const res = await api.request(`/${path}`);
      expect({ status: res.status, body: await res.json() }).toEqual({
        status: 409,
        body: { error: { code, params } },
      });
    }

    const stdout = r.stdout.join("").split("\n").filter(Boolean);
    const file = (await r.file()).split("\n").filter(Boolean);
    const expected = [
      { draftId: "d1", ownerId: "p1", ownerName: "***", event: "draft.taken_over" },
      {
        billId: "b1",
        draftId: null,
        ownerId: "p2",
        ownerName: null,
        edit: {
          billId: "b1",
          editorId: "p2",
          editorName: "***",
          editorVersion: 3,
          draftId: null,
          draftRevision: null,
        },
        event: "draft.taken_over",
      },
      {
        field: "receiptPrinterId",
        holderDeviceId: "dev1",
        holderDeviceName: "Bar till",
        holderPersonName: "***",
        event: "device.equipment_held",
      },
      { todayName: "***", field: "name", event: "table.label_taken" },
      { label: "Patio 1", event: "table.label_taken" },
      {
        legalName: "***",
        taxId: "***",
        locationName: LOCATION_NAME,
        event: "restore.stream_venue_unconfirmed",
      },
      {
        merchants: [
          { code: "MC1", name: "***" },
          { code: "MC2", name: "***" },
        ],
        event: "payment.provider_merchant_ambiguous",
      },
    ].map((line) => ({ ...line, at: expect.any(String), level: "warn" }));
    expect(stdout.map((line) => JSON.parse(line) as unknown)).toEqual(expected);
    expect(file.map((line) => JSON.parse(line) as unknown)).toEqual(expected);

    const page = await r.page();
    for (const code of [
      "draft.taken_over",
      "device.equipment_held",
      "table.label_taken",
      "restore.stream_venue_unconfirmed",
      "payment.provider_merchant_ambiguous",
    ]) {
      expect(page).toContain(code);
    }
    for (const key of [
      "ownerName",
      "editorName",
      "holderPersonName",
      "todayName",
      "legalName",
      "taxId",
    ]) {
      expect(page).toContain(`&quot;${key}&quot;:&quot;***&quot;`);
    }
    expect(page).toContain("&quot;code&quot;:&quot;MC2&quot;,&quot;name&quot;:&quot;***&quot;");
    for (const visible of [LOCATION_NAME, "MC1", "Patio 1", "Bar till"]) {
      expect(page).toContain(visible);
    }
    for (const hidden of [MARTA_NAME, VENUE_LEGAL_NAME, VENUE_TAX_ID, TODAY_NAME]) {
      expect(r.stdout.join("")).not.toContain(hidden);
      expect(file.join("\n")).not.toContain(hidden);
      expect(page).not.toContain(hidden);
    }
  });

  it("masks a table's name for today refused on the till's real route", async () => {
    const v = await setupPartyVenue(suite.db);
    const r = await rig();
    const app = new Hono();
    mountTillApi(
      app,
      {
        db: v.db,
        backend: v.backend,
        clock: v.clock,
        cfg: v.cfg,
        tableRemovals: enabledTableRemovals(ALL_MODULES),
        secureCookies: false,
        venueLocale: v.cfg.locale,
      },
      r.log,
    );
    const deviceId = await seedSessionDevice(v.db, v.cfg);
    const session = await inTx(v, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
        .returning({ id: persons.id });
      return loginWithPin(tx, { deviceId, personId: person!.id, pin: "5555" });
    });
    const cookie = `${SESSION_COOKIE}=${session.token}`;
    const first = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }]);
    const second = await plannedZone(v, [{ key: "a", place: { x: 0, y: 0 } }]);
    const name = async (tableId: string) =>
      send(
        app,
        "POST",
        `/api/tables/${tableId}/today/name`,
        cookie,
        await withRevision(v, tableId, { name: TODAY_NAME }),
      );

    expect((await name(first.table.a!)).status).toBe(200);
    expect(await name(second.table.a!)).toEqual({
      status: 409,
      body: {
        error: { code: "table.label_taken", params: { todayName: TODAY_NAME, field: "name" } },
      },
    });

    const stdout = r.stdout.join("");
    const file = await r.file();
    const page = await r.page();
    const logged = {
      todayName: "***",
      field: "name",
      at: expect.any(String),
      level: "warn",
      event: "table.label_taken",
    };
    expect(lineFor(stdout, "table.label_taken")).toEqual(logged);
    expect(lineFor(file, "table.label_taken")).toEqual(logged);
    expect(page).toContain("table.label_taken");
    expect(page).toContain("&quot;todayName&quot;:&quot;***&quot;");
    expect(stdout).not.toContain(TODAY_NAME);
    expect(file).not.toContain(TODAY_NAME);
    expect(page).not.toContain(TODAY_NAME);
  });

  it("reads the codes above from the log tail, not some other part of the page", async () => {
    const { adminId } = await setupVenue();
    const r = await rig();
    await send(management(r.log), "POST", "/management-api/staff", await cookieFor(adminId), {
      displayName: MARTA_NAME,
      firstNames: "Marta",
      lastNames: "Soler",
      telephone: null,
      role: "staff",
      email: "another@example.test",
    });
    const run = createErrorBoundary({}, "recovery_test.failed");
    const api = new Hono();
    api.get("/", (c) =>
      run(c, r.log, () => {
        throw new AppError("table.label_taken", { todayName: TODAY_NAME, field: "name" });
      }),
    );
    await api.request("/");
    const empty = await mkdtemp(join(tmpdir(), "recovery-page-personal-data-empty-"));

    const withLog = await r.page();
    const withoutLog = await (
      await recoveryApp({ state, logDir: empty, onRetry: vi.fn() }).request("/")
    ).text();

    for (const code of ["person.display_name_taken", "table.label_taken"]) {
      expect(withLog).toContain(code);
    }
    for (const code of [
      "person.email_taken",
      "person.display_name_taken",
      "draft.taken_over",
      "device.equipment_held",
      "table.label_taken",
      "restore.stream_venue_unconfirmed",
      "payment.provider_merchant_ambiguous",
    ]) {
      expect(withoutLog).not.toContain(code);
    }
    expect(withoutLog).not.toContain("&quot;***&quot;");
  });
});

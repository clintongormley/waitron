import { requestIdMiddleware } from "./request-id.js";
import { fixturePasswordHash, fixturePinHash } from "./testing/known-secret-hashes.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import nodemailer from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loginWithPin, persons, startManagementSession } from "@waitron/identity";
import { applyHistoricalTestVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import "@waitron/payments-sumup";
import { AppError, nodeId as brandNodeId } from "@waitron/shared";
import { createErrorBoundary, MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";
import { flushAccountMail } from "./testing/account-mail.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { sql } from "drizzle-orm";
import { PERSONAL_LOG_KEYS } from "./log-personal-data.js";
import { createLogger, type Logger, type LogLevel } from "./logger.js";
import { createRotatingFileSink, tee } from "./log-file.js";
import { mountManagementApi } from "./management-api.js";
import { mountMeApi } from "./me-api.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { FRESH, afterFailure } from "./recovery-state.js";
import { recoveryApp } from "./recovery-surface.js";
import { mountTillApi } from "./till-api.js";
import { inTx, setupPartyVenue } from "./testing/party-venue.js";
import { plannedZone, withRevision } from "./testing/floor-today-venue.js";
import { seedSessionDevice, sessionCookieForTest } from "./testing/session-device.js";
import { smtpRig } from "./testing/smtp-settings-fixture.js";

type SmtpRig = Awaited<ReturnType<typeof smtpRig>>;

const MARTHA_EMAIL = "martha.lewis@example.test";
const MARTHA_NAME = "Martha Lewis";
const VENUE_LEGAL_NAME = "Jordi Puig Ferrer";
const VENUE_TAX_ID = "12345678Z";
const LOCATION_NAME = "Bar del Port";
const TODAY_NAME = "Soler";
const GEORGE_EMAIL = "george.hill@example.test";
const GEORGE_NAME = "George Hill";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 120_000,
});

const state = afterFailure(FRESH, "module.config_invalid", new Date());

const tempDirs: string[] = [];
async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Rig {
  log: Logger;
  stdout: string[];
  logDir: string;
  page: () => Promise<string>;
  file: () => Promise<string>;
}

async function rig(): Promise<Rig> {
  const logDir = await tempDir("recovery-page-personal-data-");
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
  level: LogLevel = "warn",
): Promise<void> {
  const stdout = r.stdout.join("");
  const file = await r.file();
  const page = await r.page();
  const expected = { ...fields, at: expect.any(String), level, event };
  expect(lineFor(stdout, event)).toEqual(expected);
  expect(lineFor(file, event)).toEqual(expected);
  expect(page).toContain(event);
  for (const [key, value] of Object.entries(fields)) {
    if (PERSONAL_LOG_KEYS.has(key)) {
      expect(page).toContain(`&quot;${key}&quot;:&quot;${String(value)}&quot;`);
    }
  }
  for (const secret of hidden) {
    expect(stdout).not.toContain(secret);
    expect(file).not.toContain(secret);
    expect(page).not.toContain(secret);
  }
}

let nif = 0;
let venueCfg: Parameters<typeof mountManagementApi>[1]["venueCfg"];

async function setupVenue(): Promise<{ adminId: string; clerkId: string }> {
  nif += 1;
  const venue = await applyHistoricalTestVenue(
    planVenue(
      {
        country: "ES",
        taxId: `${String(71_000_000 + nif).padStart(8, "0")}K`,
        legalName: "Recovery Deli SL",
        name: "Main room",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        seriesCode: "A",
        correctiveSeriesCode: "R",
        admin: {
          displayName: "Owner",
          pinHash: fixturePinHash("1234"),
          passwordHash: fixturePasswordHash("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  venueCfg = {
    nodeId: brandNodeId(venue.nodeId),
    locale: "es-ES",
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  return withTransaction(suite.db, async (tx) => {
    const [admin] = await tx.select({ id: persons.id }).from(persons).limit(1);
    await seedPersons(tx, {
      displayName: MARTHA_NAME,
      email: MARTHA_EMAIL,
      pinHash: fixturePinHash("1111"),
      passwordHash: fixturePasswordHash("martaPass123"),
      role: "staff",
    });
    const [clerk] = await seedPersons(tx, {
      displayName: "Clerk",
      email: "clerk@example.test",
      pinHash: fixturePinHash("2222"),
      passwordHash: fixturePasswordHash("clerkPass123"),
      role: "staff",
    });
    return { adminId: admin!.id, clerkId: clerk!.id };
  });
}

async function cookieFor(personId: string): Promise<string> {
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { method: "password", personId }),
  );
  await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, session.token));
  return `${MANAGEMENT_COOKIE}=${session.token}`;
}

function management(log: Logger, configured = false): Hono {
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
      accountMailMode: async () => (configured ? "smtp" : "unconfigured"),
      credentialKeyRing: { current: { version: 1, key: Buffer.alloc(32, 21) } },
    },
    log,
  );
  return app;
}

function me(log: Logger, configured = false): Hono {
  const app = new Hono();
  mountMeApi(
    app,
    {
      db: suite.db,
      venueLocale: "en-GB",
      modules: ["core"],
      credentialKeyRing: { current: { version: 1, key: Buffer.alloc(32, 6) } },
      accountMailMode: async () => (configured ? "smtp" : "unconfigured"),
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

// The relay refusal must carry the address for the checks that omit it to be meaningful.
async function relayRefusal(relay: SmtpRig): Promise<string> {
  const transport = nodemailer.createTransport({ url: relay.config.url });
  try {
    await transport.sendMail({
      from: "venue@example.test",
      to: GEORGE_EMAIL,
      subject: "s",
      text: "t",
    });
  } catch (error) {
    return (error as Error).message;
  } finally {
    transport.close();
  }
  throw new Error("the relay accepted the message");
}

const EMAIL_TAKEN = {
  status: 409,
  body: { error: { code: "person.email_taken", params: { email: MARTHA_EMAIL } } },
};
const NAME_TAKEN = {
  status: 409,
  body: { error: { code: "person.display_name_taken", params: { displayName: MARTHA_NAME } } },
};

describe("the recovery page, the log file and stdout carry no person's details", () => {
  it("keeps only safe request metadata in the unauthenticated log tail", async () => {
    const r = await rig();
    const app = new Hono();
    const run = createErrorBoundary({}, "sale.failed");
    app.use(
      "*",
      requestIdMiddleware(r.log, () => new Date()),
    );
    app.post("/api/working-orders/:id/collect", (c) =>
      run(c, r.log, () => Promise.reject(new AppError("session.required", {}))),
    );
    const orderId = "2ecbbef3-e05d-4c56-9b52-81d596ebc74c";
    const res = await app.request(
      `/api/working-orders/${orderId}/collect?${MARTHA_EMAIL}=private-query-value`,
      { method: "POST", headers: { "x-request-id": "collect-request" } },
    );
    expect(await res.json()).toEqual({ error: { code: "session.required", params: {} } });
    const page = await r.page();
    expect(page).toContain("http.request");
    expect(page).toContain(`/api/working-orders/${orderId}/collect?***`);
    expect(page).toContain("&quot;errorCode&quot;:&quot;session.required&quot;");
    expect(page).toContain("collect-request");
    expect(page).not.toContain(MARTHA_EMAIL);
    expect(page).not.toContain("private-query-value");
  });

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
        roleIds: [],
        email: MARTHA_EMAIL,
      },
    );

    expect(answer).toEqual(EMAIL_TAKEN);
    await expectLogged(r, "person.email_taken", { email: "m***s@e***e.test" }, [MARTHA_EMAIL]);
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
        displayName: MARTHA_NAME,
        firstNames: "Martha",
        lastNames: "Lewis",
        telephone: null,
        roleIds: [],
        email: "another@example.test",
      },
    );

    expect(answer).toEqual(NAME_TAKEN);
    await expectLogged(r, "person.display_name_taken", { displayName: "M***a L***s" }, [
      MARTHA_NAME,
    ]);
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
        status: "active",
        ...change,
      });

    expect(await edit({ email: MARTHA_EMAIL, displayName: "Clerk" })).toEqual(EMAIL_TAKEN);
    expect(await edit({ email: "clerk@example.test", displayName: MARTHA_NAME })).toEqual(
      NAME_TAKEN,
    );
    await expectLogged(r, "person.email_taken", { email: "m***s@e***e.test" }, [
      MARTHA_EMAIL,
      MARTHA_NAME,
    ]);
    await expectLogged(r, "person.display_name_taken", { displayName: "M***a L***s" }, [
      MARTHA_EMAIL,
      MARTHA_NAME,
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

    expect(await profile({ displayName: MARTHA_NAME, email: "clerk@example.test" })).toEqual(
      NAME_TAKEN,
    );
    expect(await profile({ displayName: "Clerk", email: MARTHA_EMAIL })).toEqual(EMAIL_TAKEN);
    await expectLogged(r, "person.display_name_taken", { displayName: "M***a L***s" }, [
      MARTHA_EMAIL,
      MARTHA_NAME,
    ]);
    await expectLogged(r, "person.email_taken", { email: "m***s@e***e.test" }, [
      MARTHA_EMAIL,
      MARTHA_NAME,
    ]);
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
          new AppError("draft.taken_over", {
            draftId: "d1",
            ownerId: "p1",
            ownerName: MARTHA_NAME,
          }),
        "draft.taken_over",
        { draftId: "d1", ownerId: "p1", ownerName: "Martha Lewis" },
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
              editorName: MARTHA_NAME,
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
            editorName: "Martha Lewis",
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
            holderPersonName: MARTHA_NAME,
          }),
        "device.equipment_held",
        {
          field: "receiptPrinterId",
          holderDeviceId: "dev1",
          holderDeviceName: "Bar till",
          holderPersonName: "Martha Lewis",
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
            venueName: LOCATION_NAME,
          }),
        "restore.stream_venue_unconfirmed",
        { legalName: "Jordi Puig Ferrer", taxId: "12345678Z", venueName: "Bar del Port" },
      ],
      [
        "merchants",
        () =>
          new AppError("payment.provider_merchant_ambiguous", {
            merchants: [
              { code: "MC1", merchantName: VENUE_LEGAL_NAME },
              { code: "MC2", merchantName: MARTHA_NAME },
            ],
          }),
        "payment.provider_merchant_ambiguous",
        {
          merchants: [
            { code: "MC1", merchantName: "Jordi Puig Ferrer" },
            { code: "MC2", merchantName: "Martha Lewis" },
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
      { draftId: "d1", ownerId: "p1", ownerName: "M***a L***s", event: "draft.taken_over" },
      {
        billId: "b1",
        draftId: null,
        ownerId: "p2",
        ownerName: null,
        edit: {
          billId: "b1",
          editorId: "p2",
          editorName: "M***a L***s",
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
        holderPersonName: "M***a L***s",
        event: "device.equipment_held",
      },
      { todayName: "S***r", field: "name", event: "table.label_taken" },
      { label: "Patio 1", event: "table.label_taken" },
      {
        legalName: "J***i P***g F***r",
        taxId: "1***Z",
        venueName: LOCATION_NAME,
        event: "restore.stream_venue_unconfirmed",
      },
      {
        merchants: [
          { code: "MC1", merchantName: "J***i P***g F***r" },
          { code: "MC2", merchantName: "M***a L***s" },
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
    for (const [key, masked] of [
      ["ownerName", "M***a L***s"],
      ["editorName", "M***a L***s"],
      ["holderPersonName", "M***a L***s"],
      ["todayName", "S***r"],
      ["legalName", "J***i P***g F***r"],
      ["taxId", "1***Z"],
    ]) {
      expect(page).toContain(`&quot;${key}&quot;:&quot;${masked}&quot;`);
    }
    expect(page).toContain(
      "&quot;code&quot;:&quot;MC2&quot;,&quot;merchantName&quot;:&quot;M***a L***s&quot;",
    );
    for (const visible of [LOCATION_NAME, "MC1", "Patio 1", "Bar till"]) {
      expect(page).toContain(visible);
    }
    for (const hidden of [MARTHA_NAME, VENUE_LEGAL_NAME, VENUE_TAX_ID, TODAY_NAME]) {
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
        admission: testTradingAdmission(),
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
    const deviceId = await seedSessionDevice(v.db);
    const session = await inTx(v, async (tx) => {
      const [person] = await seedPersons(tx, {
        displayName: "Anna",
        pinHash: fixturePinHash("5555"),
        role: "staff",
      });
      return loginWithPin(tx, { deviceId, personId: person!.id, pin: "5555" });
    });
    const cookie = await sessionCookieForTest(v.db, session.token);
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
    await expectLogged(r, "table.label_taken", { todayName: "S***r", field: "name" }, [TODAY_NAME]);
  });

  it("reads the codes above from the log tail, not some other part of the page", async () => {
    const { adminId } = await setupVenue();
    const r = await rig();
    await send(management(r.log), "POST", "/management-api/staff", await cookieFor(adminId), {
      displayName: MARTHA_NAME,
      firstNames: "Martha",
      lastNames: "Lewis",
      telephone: null,
      roleIds: [],
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
    const empty = await tempDir("recovery-page-personal-data-empty-");

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
    expect(withoutLog).not.toContain("***");
  });

  for (const at of ["rcpt", "data"] as const) {
    it(`logs no address or name when the relay refuses an invitation at ${at.toUpperCase()}`, async () => {
      const { adminId } = await setupVenue();
      const r = await rig();
      const relay = await smtpRig(at === "rcpt" ? "recipient-refused" : "data-refused", false, {
        echoRecipient: true,
      });
      try {
        const answer = await send(
          management(r.log, true),
          "POST",
          "/management-api/staff",
          await cookieFor(adminId),
          {
            displayName: GEORGE_NAME,
            firstNames: "George",
            lastNames: "Hill",
            telephone: null,
            roleIds: [],
            email: GEORGE_EMAIL,
          },
        );

        expect(answer).toEqual({
          status: 201,
          body: {
            id: expect.any(String),
            invitationSent: true,
            delivery: "queued",
          },
        });
        const personId = (answer.body as { id: string }).id;
        await flushAccountMail(suite.db, {
          log: r.log,
          keyRing: { current: { version: 1, key: Buffer.alloc(32, 21) } },
          timeZone: "Europe/Madrid",
          smtp: relay.config,
        });
        expect(relay.recipients).toEqual([GEORGE_EMAIL]);
        expect(await relayRefusal(relay)).toContain(GEORGE_EMAIL);
        await expectLogged(
          r,
          "mail.send_failed",
          {
            kind: "account_action",
            mailId: suite.db.get<{ id: string }>(
              sql`select id from outgoing_mail where person_id=${personId}`,
            )!.id,
            errorCode: "email.test_refused",
          },
          [GEORGE_EMAIL, GEORGE_NAME],
          "error",
        );
      } finally {
        await relay.close();
      }
    });
  }

  it("logs the sender's code, not the relay's reply, when a person's new email is refused", async () => {
    const { clerkId } = await setupVenue();
    const r = await rig();
    const relay = await smtpRig("recipient-refused", false, { echoRecipient: true });
    try {
      const answer = await send(
        me(r.log, true),
        "PUT",
        "/management-api/session/me/profile",
        await cookieFor(clerkId),
        {
          displayName: "Clerk",
          firstNames: "Clerk",
          lastNames: "Person",
          telephone: null,
          locale: "en-GB",
          currentPassword: "clerkPass123",
          email: GEORGE_EMAIL,
        },
      );

      expect(answer).toEqual({
        status: 200,
        body: { emailVerificationSent: true, delivery: "queued" },
      });
      await flushAccountMail(suite.db, {
        log: r.log,
        keyRing: { current: { version: 1, key: Buffer.alloc(32, 21) } },
        timeZone: "Europe/Madrid",
        smtp: relay.config,
      });
      expect(relay.recipients).toEqual([GEORGE_EMAIL]);
      expect(await relayRefusal(relay)).toContain(GEORGE_EMAIL);
      await expectLogged(
        r,
        "mail.send_failed",
        {
          kind: "account_action",
          mailId: suite.db.get<{ id: string }>(
            sql`select id from outgoing_mail where person_id=${clerkId}`,
          )!.id,
          errorCode: "email.test_refused",
        },
        [GEORGE_EMAIL],
        "error",
      );
      expect(await r.page()).toContain("&quot;errorCode&quot;:&quot;email.test_refused&quot;");
    } finally {
      await relay.close();
    }
  });
});

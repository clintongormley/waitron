import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  endManagementSession,
  hashPassword,
  hashPin,
  persons,
  startManagementSession,
} from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { loadKeyRing } from "@waitron/credentials";
import type { FiscalCertificateAnswer, FiscalCertificateSeat } from "@waitron/fiscal";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountFiscalCertificateApi } from "./fiscal-certificate-api.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

type Role = "admin" | "manager" | "supervisor";
interface Signed {
  cookie: string;
  token: string;
  personId: string;
}
let nif = 77_000_000;
async function setupVenue(): Promise<Record<Role, Signed>> {
  nif += 1;
  await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: `${nif}K`,
        legalName: "Certificate Test SL",
        location: {
          name: "Sala",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Uno 1",
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
  return withTransaction(suite.db, async (tx) => {
    const start = async (role: Role): Promise<Signed> => {
      const [inserted] = await tx
        .insert(persons)
        .values({
          displayName: `The ${role}`,
          pinHash: hashPin("1234"),
          role,
          email: `${role}-${nif}@example.test`,
        })
        .returning({ id: persons.id });
      const session = await startManagementSession(tx, { personId: inserted!.id });
      return {
        cookie: `${MANAGEMENT_COOKIE}=${session.token}`,
        token: session.token,
        personId: inserted!.id,
      };
    };
    return {
      admin: await start("admin"),
      manager: await start("manager"),
      supervisor: await start("supervisor"),
    };
  });
}

const PASSPHRASE = "s3cret-passphrase-value";
const FILE = Buffer.alloc(64, 7).toString("base64");

interface FakeSeat extends Pick<FiscalCertificateSeat, "read" | "install"> {
  calls: string[];
  bodies: unknown[];
  authorizedAs: string[];
  betweenAuthorizations?: () => Promise<void>;
  installAnswer: () => FiscalCertificateAnswer;
}

/** Mirrors the real seat's shape: `authorize` first inside each of its transactions. */
function fakeSeat(): FakeSeat {
  const seat: FakeSeat = {
    calls: [],
    bodies: [],
    authorizedAs: [],
    installAnswer: () => ({ outcome: "installed", reason: "installed" }),
    async read(deps) {
      seat.calls.push("read");
      return withTransaction(deps.db, async (tx) => {
        await deps.authorize(tx);
        seat.calls.push("read.authorized");
        const [first] = await tx.select({ id: persons.id }).from(persons).limit(1);
        return {
          state: "card",
          nodeId: deps.nodeId,
          locationId: deps.locationId,
          installedBy: await deps.nameOf(tx, first!.id),
          unknownName: await deps.nameOf(tx, "no-such-person"),
        };
      });
    },
    async install(deps, body) {
      seat.calls.push("install");
      seat.bodies.push(body);
      const first = await withTransaction(deps.db, (tx: Transaction) => deps.authorize(tx));
      seat.authorizedAs.push(first.personId);
      seat.calls.push("install.checked");
      deps.log?.("info", "fiscal.certificate_checked", { outcome: "checked" });
      await seat.betweenAuthorizations?.();
      const second = await withTransaction(deps.db, (tx: Transaction) => deps.authorize(tx));
      seat.authorizedAs.push(second.personId);
      seat.calls.push("install.written");
      return seat.installAnswer();
    },
  };
  return seat;
}

const path = "/management-api/fiscal-certificate";
function mount(seat: FakeSeat, options: { filing?: boolean; log?: Logger } = {}) {
  const app = new Hono();
  mountFiscalCertificateApi(
    app,
    {
      db: suite.db,
      ring,
      seat,
      nodeId: "node-1",
      locationId: "location-1",
      environment: "preproduction",
      filing: () => options.filing ?? true,
      now: () => new Date("2026-10-18T10:00:00Z"),
    },
    options.log ?? (() => {}),
  );
  return app;
}
const get = (app: Hono, cookie?: string) =>
  app.request(path, { headers: cookie === undefined ? {} : { cookie } });
const post = (app: Hono, cookie: string | undefined, body: string) =>
  app.request(path, {
    method: "POST",
    headers: { ...(cookie === undefined ? {} : { cookie }), "Content-Type": "application/json" },
    body,
  });
const certificateBody = JSON.stringify({ file: FILE, passphrase: PASSPHRASE });

describe("GET /management-api/fiscal-certificate", () => {
  it("a manager reads the card with filing true", async () => {
    const venue = await setupVenue();
    const seat = fakeSeat();
    const response = await get(mount(seat), venue.manager.cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      filing: true,
      state: "card",
      nodeId: "node-1",
      locationId: "location-1",
      installedBy: expect.any(String),
      unknownName: null,
    });
    expect(seat.calls).toEqual(["read", "read.authorized"]);
  });

  it("answers filing false on a box that does not send records", async () => {
    const venue = await setupVenue();
    const response = await get(mount(fakeSeat(), { filing: false }), venue.manager.cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ filing: false, state: "card" });
  });

  it("names a person through persons.displayName", async () => {
    const venue = await setupVenue();
    const seat = fakeSeat();
    seat.read = async (deps) =>
      withTransaction(deps.db, async (tx) => {
        await deps.authorize(tx);
        return { installedBy: await deps.nameOf(tx, venue.manager.personId) };
      });
    const response = await get(mount(seat), venue.manager.cookie);
    expect(await response.json()).toEqual({ filing: true, installedBy: "The manager" });
  });

  it("an admin reads it", async () => {
    const venue = await setupVenue();
    const response = await get(mount(fakeSeat()), venue.admin.cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ filing: true, state: "card" });
  });

  it("a supervisor is refused 403 authorization.not_permitted", async () => {
    const venue = await setupVenue();
    const seat = fakeSeat();
    const response = await get(mount(seat), venue.supervisor.cookie);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "authorization.not_permitted", params: { permission: "fiscal.view" } },
    });
    expect(seat.calls).toEqual(["read"]);
  });

  it("no session is 401", async () => {
    await setupVenue();
    const seat = fakeSeat();
    const response = await get(mount(seat));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "management_session.required" },
    });
    expect(seat.calls).toEqual([]);
  });
});

describe("POST /management-api/fiscal-certificate", () => {
  it("a manager's POST reaches the seat with the body, and authorize returns the manager", async () => {
    const venue = await setupVenue();
    const seat = fakeSeat();
    seat.installAnswer = () => ({ outcome: "refused", reason: "expired", field: "file" });
    const response = await post(mount(seat), venue.manager.cookie, certificateBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "refused", reason: "expired", field: "file" });
    expect(seat.bodies).toEqual([{ file: FILE, passphrase: PASSPHRASE }]);
    expect(seat.authorizedAs).toEqual([venue.manager.personId, venue.manager.personId]);
  });

  it("a person without system.manage is refused by the seat's first authorize", async () => {
    const venue = await setupVenue();
    const seat = fakeSeat();
    const response = await post(mount(seat), venue.supervisor.cookie, certificateBody);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "authorization.not_permitted", params: { permission: "system.manage" } },
    });
    expect(seat.calls).toEqual(["install"]);
  });

  it("no session is 401 and never reaches the seat", async () => {
    await setupVenue();
    const seat = fakeSeat();
    const response = await post(mount(seat), undefined, certificateBody);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "management_session.required" },
    });
    expect(seat.calls).toEqual([]);
  });

  it("a session revoked during the check is refused when the seat re-authorises", async () => {
    const venue = await setupVenue();
    const seat = fakeSeat();
    seat.betweenAuthorizations = async () => {
      await withTransaction(suite.db, (tx) => endManagementSession(tx, venue.manager.token));
    };
    const response = await post(mount(seat), venue.manager.cookie, certificateBody);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "management_session.required" },
    });
    expect(seat.calls).toEqual(["install", "install.checked"]);
  });

  it("a body over 200 000 bytes is 413 fiscal.certificate_too_large and never reaches the seat", async () => {
    const venue = await setupVenue();
    const seat = fakeSeat();
    const big = JSON.stringify({ file: "A".repeat(200_001), passphrase: PASSPHRASE });
    const response = await post(mount(seat), venue.manager.cookie, big);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: "fiscal.certificate_too_large", params: {} },
    });
    expect(seat.calls).toEqual([]);
  });

  it("refuses fiscal.certificate_not_used on a box that does not send records", async () => {
    const venue = await setupVenue();
    const seat = fakeSeat();
    const response = await post(
      mount(seat, { filing: false }),
      venue.manager.cookie,
      certificateBody,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "fiscal.certificate_not_used", params: {} },
    });
    expect(seat.calls).toEqual(["install"]);
  });

  it("fiscal.certificate_changed from the seat is 409", async () => {
    const venue = await setupVenue();
    const seat = fakeSeat();
    seat.installAnswer = () => {
      throw new AppError("fiscal.certificate_changed", {});
    };
    const response = await post(mount(seat), venue.manager.cookie, certificateBody);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "fiscal.certificate_changed", params: {} },
    });
  });

  it("fiscal.certificate_request_invalid from the seat is 400", async () => {
    const venue = await setupVenue();
    const seat = fakeSeat();
    seat.installAnswer = () => {
      throw new AppError("fiscal.certificate_request_invalid", { field: "passphrase" });
    };
    const response = await post(mount(seat), venue.manager.cookie, certificateBody);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "fiscal.certificate_request_invalid", params: { field: "passphrase" } },
    });
  });

  it("an unexpected failure is 500 under the fiscal_certificate.failed tag", async () => {
    const venue = await setupVenue();
    const seat = fakeSeat();
    seat.installAnswer = () => {
      throw new Error(`boom ${PASSPHRASE}`);
    };
    const logs: unknown[][] = [];
    const response = await post(
      mount(seat, { log: (...args) => void logs.push(args) }),
      venue.manager.cookie,
      certificateBody,
    );
    expect(response.status).toBe(500);
    expect(logs.map((line) => line[1])).toContain("fiscal_certificate.failed");
    const logged = logs.map((line) =>
      JSON.stringify(line, (_key, value: unknown) =>
        value instanceof Error ? `${value.message} ${value.stack ?? ""}` : value,
      ),
    );
    expect([await response.text(), ...logged].join("\n")).not.toContain(PASSPHRASE);
  });

  it("no response or log line carries the passphrase or the file", async () => {
    const venue = await setupVenue();
    const logs: unknown[][] = [];
    const log: Logger = (...args) => void logs.push(args);
    const texts: string[] = [];
    const answers: (() => FiscalCertificateAnswer)[] = [
      () => ({ outcome: "installed", reason: "installed" }),
      () => {
        throw new AppError("fiscal.certificate_request_invalid", { field: "passphrase" });
      },
      () => {
        throw new Error("unexpected");
      },
    ];
    for (const answer of answers) {
      const seat = fakeSeat();
      seat.installAnswer = answer;
      const response = await post(mount(seat, { log }), venue.manager.cookie, certificateBody);
      texts.push(await response.text());
    }
    const big = JSON.stringify({ file: FILE.repeat(4000), passphrase: PASSPHRASE });
    texts.push(await (await post(mount(fakeSeat(), { log }), venue.manager.cookie, big)).text());
    expect(logs.length).toBeGreaterThan(0);
    const everything = [...texts, ...logs.map((line) => JSON.stringify(line))].join("\n");
    expect(everything).not.toContain(PASSPHRASE);
    expect(everything).not.toContain(FILE);
  });
});

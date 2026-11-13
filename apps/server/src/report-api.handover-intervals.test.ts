import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, handoverReturnBatches, nodes, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { insertHandoverActivationTx, signEnvelope } from "@waitron/handover";
import { generateNodeKeyPair } from "@waitron/membership";
import { startManagementSession } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { seedSale, seedVenueWithSeries } from "@waitron/reporting/test/fixtures.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { returnDigest } from "./return-records.js";
import * as intervalReads from "./handover-intervals.js";
import { mountReportApi } from "./report-api.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let source: string;
let destination: string;
let cookie: string;
let staffCookie: string;
let app: Hono;
const path = "/management-api/reports/handover-intervals";
const declaredAtMs = Date.parse("2026-11-10T10:00:00Z");
const activatedAt = "2026-11-10T09:59:00.000Z";
let venue: Awaited<ReturnType<typeof seedVenueWithSeries>>;

beforeEach(async () => {
  venue = await seedVenueWithSeries(suite.db);
  source = venue.nodeId;
  destination = await seedNode(suite.db);
  await suite.db.update(nodes).set({ name: "Old kitchen box" }).where(eq(nodes.id, source));
  await suite.db.update(nodes).set({ name: "New counter box" }).where(eq(nodes.id, destination));
  await withTransaction(suite.db, async (tx) => {
    for (const role of ["supervisor", "staff"] as const) {
      const [person] = await seedPersons(tx, {
        displayName: role,
        role,
        pinHash: fixturePinHash("1234"),
      });
      const session = await startManagementSession(tx, { personId: person!.id });
      const value = `${MANAGEMENT_COOKIE}=${session.token}`;
      if (role === "supervisor") cookie = value;
      else staffCookie = value;
    }
  });
  app = new Hono();
  mountReportApi(
    app,
    { db: suite.db, cfg: { nodeId: destination }, venueLocale: "en-GB" },
    () => {},
  );
});

async function activation(
  scenario: "emergency" | "controlled",
  lastChangeAtMs: number | null,
  at = activatedAt,
) {
  const operationId = randomUUID();
  const body = {
    binding: {
      operationId,
      scenario,
      venue: { country: "ES", taxId: "40000000K", environment: "preproduction" },
      sourceNodeId: source,
      destinationNodeId: destination,
      membership: { term: 1, digest: "a".repeat(64) },
    },
    wordingVersion: "a1018-emergency-v1",
    locale: "en",
    statements: { sourceSwitchedOff: true, noParallelRecovery: true, missingTailAccepted: true },
    reason: "The old box failed during lunch",
    lastCopy: { source: "mirror-copy", identifier: "b".repeat(64), lastChangeAtMs },
    provider: null,
    actor: { personId: randomUUID(), method: "password" },
    declaredAtMs,
    replaces: null,
  };
  const evidence = signEnvelope("declaration", body, {
    nodeId: destination,
    ...generateNodeKeyPair(),
  });
  await withTransaction(suite.db, (tx) =>
    insertHandoverActivationTx(tx, {
      operationId,
      scenario,
      sourceNodeId: source,
      destinationNodeId: destination,
      evidence,
      personId: body.actor.personId,
      activatedAt: at,
    }),
  );
  return operationId;
}

it("lists committed emergency history with current box names, newest first, without local operations", async () => {
  const older = await activation("emergency", 123, "2026-11-09T10:00:00Z");
  await activation("controlled", 999);
  const newer = await activation("emergency", Date.parse("2026-11-10T09:50:00Z"));
  const res = await app.request(path, { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({
    timeZone: "Europe/Madrid",
    intervals: [
      {
        operationId: newer,
        inventoryReceived: false,
        sourceName: "Old kitchen box",
        destinationName: "New counter box",
        lastChangeAtMs: Date.parse("2026-11-10T09:50:00Z"),
        declaredAtMs,
        activatedAt,
        reason: "The old box failed during lunch",
      },
      {
        operationId: older,
        inventoryReceived: false,
        sourceName: "Old kitchen box",
        destinationName: "New counter box",
        lastChangeAtMs: 123,
        declaredAtMs,
        activatedAt: "2026-11-09T10:00:00.000Z",
        reason: "The old box failed during lunch",
      },
    ],
  });
});

it("does not fill unknown copy activity from recorded sales", async () => {
  const operationId = await activation("emergency", null);
  await seedSale(suite.db, venue, {
    invoiceNumber: 1,
    issuedAt: "2026-11-10T09:55:00Z",
    total: "12.10",
    lines: [{ vatRate: "21.00", lineTotal: "12.10" }],
  });
  const res = await app.request(path, { headers: { cookie } });
  expect(res.status).toBe(200);
  expect((await res.json()).intervals).toEqual([
    {
      operationId,
      inventoryReceived: false,
      sourceName: "Old kitchen box",
      destinationName: "New counter box",
      lastChangeAtMs: null,
      declaredAtMs,
      activatedAt,
      reason: "The old box failed during lunch",
    },
  ]);
});

it("refuses signed-out readers and staff without report.view", async () => {
  const signedOut = await app.request(path);
  expect(signedOut.status).toBe(401);
  expect((await signedOut.json()).error.code).toBe("management_session.required");
  const staff = await app.request(path, { headers: { cookie: staffCookie } });
  expect(staff.status).toBe(403);
  expect((await staff.json()).error.code).toBe("authorization.not_permitted");
});

it("reads receipt confirmation from venue facts without needing a local operation", async () => {
  const operationId = await activation("emergency", null);
  const digest = returnDigest({ module: "sample", payload: "received" });
  await suite.db.insert(handoverReturnBatches).values({
    operationId,
    inventory: returnDigest([digest]),
    batchIndex: 0,
    batchCount: 1,
    batchDigest: digest,
  });
  const response = await app.request(path, { headers: { cookie } });
  expect(response.status).toBe(200);
  expect((await response.json()).intervals).toMatchObject([
    { operationId, inventoryReceived: true },
  ]);
});

it("answers only whether an emergency takeover exists without running the full interval read", async () => {
  const full = vi
    .spyOn(intervalReads, "readHandoverIntervals")
    .mockRejectedValue(new Error("A report warning must not compute inventory receipt"));
  try {
    const read = () =>
      app.request("/management-api/reports/handover-warning", { headers: { cookie } });
    expect(await (await read()).json()).toEqual({
      hasEmergencyHandover: false,
      hasReturnedInvoices: false,
    });
    await activation("controlled", null);
    expect(await (await read()).json()).toEqual({
      hasEmergencyHandover: false,
      hasReturnedInvoices: false,
    });
    await activation("emergency", null);
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      hasEmergencyHandover: true,
      hasReturnedInvoices: false,
    });
    expect(full).not.toHaveBeenCalled();
  } finally {
    full.mockRestore();
  }
});

it("gates the cheap warning read with report.view", async () => {
  const returnedInvoices = vi.fn().mockResolvedValue([]);
  app = new Hono();
  mountReportApi(
    app,
    { db: suite.db, cfg: { nodeId: destination }, venueLocale: "en-GB", returnedInvoices },
    () => {},
  );
  const path = "/management-api/reports/handover-warning";
  const signedOut = await app.request(path);
  expect(signedOut.status).toBe(401);
  expect((await signedOut.json()).error.code).toBe("management_session.required");
  const staff = await app.request(path, { headers: { cookie: staffCookie } });
  expect(staff.status).toBe(403);
  expect((await staff.json()).error.code).toBe("authorization.not_permitted");
  expect(returnedInvoices).not.toHaveBeenCalled();
});

it("checks one returned invoice independently of emergency history without exposing its payload", async () => {
  const returnedInvoices = vi.fn().mockResolvedValue([]);
  const warning = new Hono();
  mountReportApi(
    warning,
    {
      db: suite.db,
      cfg: { nodeId: destination },
      venueLocale: "en-GB",
      returnedInvoices,
    },
    () => {},
  );
  const read = () =>
    warning.request("/management-api/reports/handover-warning", { headers: { cookie } });
  expect(await (await read()).json()).toEqual({
    hasEmergencyHandover: false,
    hasReturnedInvoices: false,
  });
  returnedInvoices.mockResolvedValue([
    {
      recordId: "returned-record",
      saleId: "returned-sale",
      sourceNodeId: source,
      sourceName: "Old kitchen box",
      generationId: "generation",
      installation: "ABCDE",
      sequence: 1,
      invoiceNumber: "2026/1",
      issueDate: "2026-11-10",
      kind: "F1",
      category: "invoice",
      correctsRecordId: null,
      taxable: "10.00",
      gross: "12.10",
      tax: "2.10",
      receivedAt: "2026-11-13T10:00:00.000Z",
    },
  ]);
  const response = await read();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ hasEmergencyHandover: false, hasReturnedInvoices: true });
  await activation("emergency", null);
  expect(await (await read()).json()).toEqual({
    hasEmergencyHandover: true,
    hasReturnedInvoices: true,
  });
  expect(returnedInvoices).toHaveBeenCalledTimes(3);
  for (const [, page] of returnedInvoices.mock.calls) {
    expect(page).toEqual({ offset: 0, limit: 1 });
  }
});

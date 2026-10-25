import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  locations,
  sales,
  saleVoids,
  tenderRefunds,
  tenders,
  type Database,
  type Transaction,
} from "@waitron/db";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { formatInvoiceNumber } from "@waitron/core";
import type { PersonalDataPart, PersonalDataSubject } from "@waitron/module";
import { locationId as brandLocationId } from "@waitron/shared";
import { ACTIONS_FILES, actionsPersonalData } from "./personal-data-actions.js";

const MARTA = "cccccccc-0000-4000-8000-0000000000a1";
const LUIS = "cccccccc-0000-4000-8000-0000000000b2";
const NOBODY = "cccccccc-0000-4000-8000-0000000000c3";

interface Place {
  locationId: string;
  nodeId: string;
  deviceId: string;
  series: Record<string, string>;
}

let place: Place;

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  resetPerTest: false,
  setup: async (db) => {
    place = await seedPlace(db);
    await seedActions(db, place);
  },
});

async function seedPlace(db: Database): Promise<Place> {
  await seedTenant(db);
  const [location] = await db
    .insert(locations)
    .values({ name: "Actions", invoiceLocales: ["en"], operationDescription: "Meals" })
    .returning();
  const locationId = brandLocationId(location!.id);
  const nodeId = await seedNode(db, locationId);
  const { deviceId } = await seedDevice(db, { locationId });
  const series: Record<string, string> = {};
  for (const code of ["TA", "TB"]) {
    const [row] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code, purpose: "standard" })
      .returning();
    series[code] = row!.id;
  }
  return { locationId, nodeId, deviceId, series };
}

async function seedSale(
  db: Database,
  at: Place,
  sale: { code: string; number: number; total: number; method: "cash" | "card" },
): Promise<{ saleId: string; tenderId: string }> {
  const [row] = await db
    .insert(sales)
    .values({
      source: "device",
      deviceId: at.deviceId,
      nodeId: at.nodeId,
      seriesId: at.series[sale.code]!,
      invoiceNumber: sale.number,
      issuedAt: "2026-10-20T08:00:00.000Z",
      issuedOffsetMinutes: 0,
      total: sale.total,
      vatBreakdown: [],
      locale: "en",
      invoiceLocales: ["en"],
      fiscalBackend: "none",
      fiscalState: "not_applicable",
    })
    .returning();
  const [tender] = await db
    .insert(tenders)
    .values({
      saleId: row!.id,
      method: sale.method,
      amount: sale.total,
      settledAt: "2026-10-20T08:00:00.000Z",
    })
    .returning();
  return { saleId: row!.id, tenderId: tender!.id };
}

async function seedVoid(
  db: Database,
  saleId: string,
  row: { id: string; voidedBy: string; voidedAt: string },
): Promise<void> {
  await db.insert(saleVoids).values({ ...row, saleId, reason: `void reason ${row.id}` });
}

async function seedTenderRefund(
  db: Database,
  at: Place,
  sale: { saleId: string; tenderId: string },
  row: {
    id: string;
    appliedAmount: number;
    tipAmount: number;
    requestedBy: string;
    authorizedBy: string;
    method: "cash" | "card";
    state: "pending" | "completed";
    createdAt: string;
  },
): Promise<void> {
  await db.insert(tenderRefunds).values({
    ...row,
    saleId: sale.saleId,
    tenderId: sale.tenderId,
    submissionId: randomUUID(),
    fingerprint: `refund ${row.id}`,
    reason: `refund reason ${row.id}`,
    source: "device",
    deviceId: at.deviceId,
    nodeId: at.nodeId,
    locationId: at.locationId,
    manual: false,
    ...(row.method === "card" ? { provider: "sumup", providerPaymentRef: `ref-${row.id}` } : {}),
    ...(row.state === "completed" ? { completedAt: row.createdAt } : {}),
  });
}

// Each refund's id sorts opposite to its time, so a list ordered by id alone comes out reversed.
async function seedActions(db: Database, at: Place): Promise<void> {
  const martaVoided = await seedSale(db, at, {
    code: "TA",
    number: 7,
    total: 1234,
    method: "cash",
  });
  const martaCash = await seedSale(db, at, { code: "TB", number: 31, total: 5678, method: "cash" });
  const martaCard = await seedSale(db, at, { code: "TA", number: 9, total: 4321, method: "card" });
  const luisVoided = await seedSale(db, at, { code: "TA", number: 8, total: 9876, method: "cash" });
  const luisRefunded = await seedSale(db, at, {
    code: "TB",
    number: 32,
    total: 6543,
    method: "cash",
  });

  await seedVoid(db, martaVoided.saleId, {
    id: "00000000-0000-4000-8000-00000000f001",
    voidedBy: MARTA,
    voidedAt: "2026-10-20T09:15:00.000Z",
  });
  await seedVoid(db, luisVoided.saleId, {
    id: "00000000-0000-4000-8000-00000000f002",
    voidedBy: LUIS,
    voidedAt: "2026-10-20T09:20:00.000Z",
  });
  await seedTenderRefund(db, at, martaCard, {
    id: "00000000-0000-4000-8000-00000000a001",
    appliedAmount: 1111,
    tipAmount: 0,
    requestedBy: MARTA,
    authorizedBy: MARTA,
    method: "card",
    state: "pending",
    createdAt: "2026-10-20T11:45:00.000Z",
  });
  await seedTenderRefund(db, at, martaCash, {
    id: "00000000-0000-4000-8000-00000000a002",
    appliedAmount: 2345,
    tipAmount: 150,
    requestedBy: MARTA,
    authorizedBy: LUIS,
    method: "cash",
    state: "completed",
    createdAt: "2026-10-20T10:30:00.000Z",
  });
  await seedTenderRefund(db, at, luisRefunded, {
    id: "00000000-0000-4000-8000-00000000a003",
    appliedAmount: 3456,
    tipAmount: 25,
    requestedBy: LUIS,
    authorizedBy: LUIS,
    method: "cash",
    state: "completed",
    createdAt: "2026-10-20T10:40:00.000Z",
  });
}

function subject(personId: string): PersonalDataSubject {
  return {
    personId,
    language: "en",
    at: new Date("2026-10-25T12:00:00.000Z"),
    timeZone: "UTC",
    locationId: place.locationId,
  };
}

function onlyPart(parts: PersonalDataPart[]): PersonalDataPart {
  expect(parts).toHaveLength(1);
  return parts[0]!;
}

// As `sendPersonalData` does: prepare inside the snapshot turn, build outside it.
async function download(personId: string, part = onlyPart(actionsPersonalData(suite.db))) {
  const build = await suite.db.withWriteLock(() => part.part.prepare(suite.db, subject(personId)));
  return build();
}

describe("actionsPersonalData", () => {
  it("is one server part declaring actions.json", () => {
    const { owner, part } = onlyPart(actionsPersonalData(suite.db));
    expect(owner).toBe("server");
    expect(part.files).toEqual(["actions.json"]);
    expect(ACTIONS_FILES).toEqual(["actions.json"]);
  });

  it("writes the person's sale voids and tender refunds, and nobody else's", async () => {
    const files = await download(MARTA);
    expect(files.map((f) => f.name)).toEqual(["actions.json"]);
    expect(JSON.parse(files[0]!.content as string)).toEqual({
      counts: { voids: 1, refunds: 2, drawerOpenings: 0 },
      voids: [
        { sale: formatInvoiceNumber("TA", 7), amount: "12.34", at: "2026-10-20T09:15:00.000Z" },
      ],
      refunds: [
        {
          kind: "sale",
          sale: formatInvoiceNumber("TB", 31),
          amount: "23.45",
          tip: "1.50",
          method: "cash",
          state: "completed",
          at: "2026-10-20T10:30:00.000Z",
          yourPart: ["requested"],
        },
        {
          kind: "sale",
          sale: formatInvoiceNumber("TA", 9),
          amount: "11.11",
          tip: "0.00",
          method: "card",
          state: "pending",
          at: "2026-10-20T11:45:00.000Z",
          yourPart: ["requested", "authorized"],
        },
      ],
      drawerOpenings: [],
    });
  });

  it("builds no file for a person with no action", async () => {
    expect(await download(NOBODY)).toEqual([]);
  });

  it("reads nothing in the snapshot turn, and takes its own turns only after it", async () => {
    const { part } = onlyPart(actionsPersonalData(suite.db));
    const throwingTx = new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(`prepare touched tx.${String(property)}`);
        },
      },
    ) as Transaction;
    const lock = vi.spyOn(suite.db, "withWriteLock");
    const reads = (["select", "all", "get", "run", "execute"] as const).map((name) =>
      vi.spyOn(suite.db, name),
    );
    try {
      let locksDuringPrepare = -1;
      const build = await suite.db.withWriteLock(async () => {
        const returned = await part.prepare(throwingTx, subject(MARTA));
        locksDuringPrepare = lock.mock.calls.length;
        return returned;
      });
      const readsDuringPrepare = reads.map((spy) => spy.mock.calls.length);
      for (const spy of reads) spy.mockRestore();
      expect(locksDuringPrepare).toBe(1);
      expect(readsDuringPrepare).toEqual([0, 0, 0, 0, 0]);
      expect(lock.mock.calls.length).toBe(1);
      const files = await build();
      expect(lock.mock.calls.length).toBeGreaterThan(1);
      expect(files.map((f) => f.name)).toEqual(["actions.json"]);
    } finally {
      for (const spy of reads) spy.mockRestore();
      lock.mockRestore();
    }
  });
});

import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  locations,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { AppError, type ChangesAfterSending } from "@waitron/shared";
import { readStationChanges, refuseChangesAfterSending } from "./changes-after-sending.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function stations(values: readonly ChangesAfterSending[]): Promise<string[]> {
  await seedTenant(db);
  const [loc] = await db
    .insert(locations)
    .values({ name: "Barra", invoiceLocales: ["es-ES"], operationDescription: "Venue" })
    .returning({ id: locations.id });
  const ids: string[] = [];
  for (const [i, changesAfterSending] of values.entries()) {
    const [row] = await db
      .insert(kitchenStations)
      .values({ locationId: loc!.id, name: `Station ${i}`, changesAfterSending })
      .returning({ id: kitchenStations.id });
    ids.push(row!.id);
  }
  return ids;
}

describe("readStationChanges", () => {
  it("answers an empty map for no ids without querying", async () => {
    const tx = {
      select: () => {
        throw new Error("no query expected");
      },
    } as unknown as Transaction;
    expect(await readStationChanges(tx, [])).toEqual(new Map());
  });

  it("reads each named station's value, an inactive station's too", async () => {
    const [never, held, open] = await stations(["never", "held", "held-or-waiting"]);
    await db.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, never!));
    const read = await withTransaction(db, (tx) => readStationChanges(tx, [never!, held!, open!]));
    expect(read).toEqual(
      new Map([
        [never!, "never"],
        [held!, "held"],
        [open!, "held-or-waiting"],
      ]),
    );
  });
});

describe("refuseChangesAfterSending", () => {
  const orderId = "order-1";
  const refusal = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      return error;
    }
    return undefined;
  };
  const check = (
    records: { stationId: string; firedAt: string | null }[],
    values: Record<string, ChangesAfterSending>,
  ) => refusal(() => refuseChangesAfterSending(orderId, records, new Map(Object.entries(values))));
  const fired = "2026-10-24T10:00:00.000Z";

  it("refuses nothing when there are no records", () => {
    expect(check([], {})).toBeUndefined();
  });

  it("lets a held record through at held and held-or-waiting, and refuses it at never", () => {
    const held = [{ stationId: "s", firedAt: null }];
    expect(check(held, { s: "held" })).toBeUndefined();
    expect(check(held, { s: "held-or-waiting" })).toBeUndefined();
    const refused = check(held, { s: "never" });
    expect(refused).toBeInstanceOf(AppError);
    expect(refused).toMatchObject({
      code: "ticket.already_fired",
      params: { workingOrderId: orderId },
    });
  });

  it("lets a fired record through only at held-or-waiting", () => {
    const waiting = [{ stationId: "s", firedAt: fired }];
    expect(check(waiting, { s: "held-or-waiting" })).toBeUndefined();
    expect(check(waiting, { s: "held" })).toMatchObject({ code: "ticket.already_fired" });
    expect(check(waiting, { s: "never" })).toMatchObject({ code: "ticket.already_fired" });
  });

  it("refuses when one of two records' stations refuses", () => {
    const records = [
      { stationId: "dish", firedAt: null },
      { stationId: "extra", firedAt: null },
    ];
    expect(check(records, { dish: "held-or-waiting", extra: "held" })).toBeUndefined();
    expect(check(records, { dish: "held-or-waiting", extra: "never" })).toMatchObject({
      code: "ticket.already_fired",
      params: { workingOrderId: orderId },
    });
  });

  it("throws a programming error when a record's station was not read", () => {
    const refused = check([{ stationId: "missing", firedAt: null }], { other: "held-or-waiting" });
    expect(refused).toBeInstanceOf(Error);
    expect(refused).not.toBeInstanceOf(AppError);
    expect((refused as Error).message).toContain("missing");
  });
});

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, printers, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import { createPrinter, refuseDeletedPrinters } from "./printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function printer(localKey: string): Promise<string> {
  return withTransaction(
    suite.db,
    async (tx) => (await createPrinter(tx, { name: localKey, transport: "usb", localKey })).id,
  );
}

async function deleted(localKey: string): Promise<string> {
  const id = await printer(localKey);
  await suite.db
    .update(printers)
    .set({ active: false, deletedAt: "2026-10-10T09:00:00.000Z" })
    .where(eq(printers.id, id));
  return id;
}

async function refusal(ids: readonly (string | null | undefined)[]): Promise<unknown> {
  try {
    await withTransaction(suite.db, (tx) => refuseDeletedPrinters(tx, ids));
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("refuseDeletedPrinters", () => {
  it("refuses printer.not_found naming the first deleted printer in the order given", async () => {
    await seedVenue(suite.db, { name: "Bar", invoiceLocales: ["es-ES"] });
    const live = await printer("USB-LIVE");
    const first = await deleted("USB-GONE-1");
    const second = await deleted("USB-GONE-2");

    for (const [ids, expected] of [
      [[live, second, first], second],
      [[null, first, undefined, second], first],
    ] as const) {
      const error = await refusal(ids);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "printer.not_found", params: { id: expected } });
    }
  });

  it("passes an unknown id, a switched-off printer, missing ids and an empty list", async () => {
    await seedVenue(suite.db, { name: "Bar", invoiceLocales: ["es-ES"] });
    const off = await printer("USB-OFF");
    await suite.db.update(printers).set({ active: false }).where(eq(printers.id, off));

    expect(await refusal([randomUUID(), off, null, undefined])).toBeUndefined();
    expect(await refusal([null, undefined])).toBeUndefined();
    expect(await refusal([])).toBeUndefined();
  });
});

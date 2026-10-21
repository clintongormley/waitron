import { validateCapabilities } from "@waitron/layouts";
import jsQR from "jsqr";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deviceProfiles,
  locations,
  printers,
  printJobs,
  sales,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordSale } from "@waitron/core";
import { prepareIssueClock, type FiscalBackend, type TrustedClock } from "@waitron/fiscal";
import { provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { enqueueReceiptCopy } from "./receipt-print.js";
import { printedCommands } from "./testing/decode-ticket.js";
import { previewPrintJob } from "./print-job-preview.js";

const AT = "2026-10-14T23:30:00.000Z";
let v: BillVenue;
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
beforeEach(async () => {
  v = await provisionBillVenue(suite.db);
});

async function issue(prepared: boolean) {
  const source: TrustedClock = {
    ...v.clock,
    now: () => ({ ...v.clock.now(), instant: new Date(AT), offsetMinutes: 0 }),
  };
  return withTransaction(v.db, async (tx) =>
    recordSale(tx, v.backend, {
      origin: v.cfg.origin,
      nodeId: v.cfg.nodeId,
      seriesId: v.seriesId,
      locale: "en-GB",
      invoiceLocales: ["en-GB"],
      operationDescription: "Restaurant service",
      total: "12.10",
      lines: [
        {
          lineNo: 1,
          name: "Staff dish",
          descriptions: { "en-GB": "Customer dish" },
          quantity: "1",
          unitPrice: "10.00",
          vatRate: "21.00",
          lineTotal: "10.00",
        },
      ],
      settlement: { kind: "deferred" },
      clock: prepared ? await prepareIssueClock(tx, v.cfg, source) : source,
    }),
  );
}

describe("receipt issue facts independent of recipient and current venue zone", () => {
  it.each([false, true])(
    "retains the saved F2 offset and QR date, prepared=%s",
    async (prepared) => {
      const sale = await issue(prepared);
      const [before] = await v.db.select().from(sales).where(eq(sales.id, sale.saleId));
      for (const timeZone of ["Europe/Madrid", "Europe/London", "Invalid/Zone"]) {
        await v.db.update(locations).set({ timeZone }).where(eq(locations.id, v.cfg.locationId));
        await withTransaction(v.db, async (tx) => {
          const facts = await readReceiptIssuer(v.backend, tx, sale.saleId);
          expect(facts).toMatchObject({
            issuedOffsetMinutes: prepared ? 120 : 0,
            invoiceType: "F2",
          });
          expect(facts).not.toHaveProperty("recipient");
          expect(facts).not.toHaveProperty("operationDate");
          const filed = await v.backend.filedReceiptFor(tx, sale.saleId);
          expect(new URL(filed!.verificationUrl!).searchParams.get("fecha")).toBe(
            prepared ? "15-10-2026" : "14-10-2026",
          );
          const ticket = await readTransactionReceipt(v.backend, tx, v.cfg, sale.saleId);
          expect(ticket.issuedOffsetMinutes).toBe(prepared ? 120 : 0);
          expect(ticket.issuedAt).toBe(AT);
          const [printer] = await tx.select().from(printers);
          const job = await enqueueReceiptCopy(tx, v.cfg, ticket, sale.saleId, printer!, "en-GB");
          expect(job).toBeDefined();
          const [savedJob] = await tx.select().from(printJobs).where(eq(printJobs.id, job!.jobId));
          const preview = previewPrintJob(savedJob!.payload);
          expect(preview.truncated).toBe(false);
          expect(preview.unsupported).toBe(false);
          expect(preview.text).toContain(prepared ? "15 Oct 2026, 01:30" : "14 Oct 2026, 23:30");
          const qr = printedCommands(savedJob!.payload).find(
            (c) => c.name === "GS v 0" && c.heightDots! > 56,
          )!;
          const rgba = new Uint8ClampedArray(qr.widthDots! * qr.heightDots! * 4).fill(255);
          const bits = qr.bytes.subarray(8);
          for (let y = 0; y < qr.heightDots!; y++)
            for (let x = 0; x < qr.widthDots!; x++)
              if (bits[y * Math.ceil(qr.widthDots! / 8) + (x >> 3)]! & (0x80 >> (x & 7)))
                rgba.fill(0, (y * qr.widthDots! + x) * 4, (y * qr.widthDots! + x) * 4 + 3);
          const decoded = jsQR(rgba, qr.widthDots!, qr.heightDots!)?.data;
          expect(decoded).toBe(ticket.qr);
          expect(new URL(decoded!).searchParams.get("fecha")).toBe(
            prepared ? "15-10-2026" : "14-10-2026",
          );
        });
        expect((await v.db.select().from(sales).where(eq(sales.id, sale.saleId)))[0]).toEqual(
          before,
        );
      }
    },
  );

  it("returns the saved offset on a real sale, pay replay and reprint", async () => {
    const clock: TrustedClock = {
      ...v.clock,
      now: () => ({ ...v.clock.now(), instant: new Date(AT), offsetMinutes: 0 }),
    };
    for (const profile of await v.db.select().from(deviceProfiles)) {
      await v.db
        .update(deviceProfiles)
        .set({ capabilities: [...validateCapabilities(profile.capabilities), "print-receipt"] })
        .where(eq(deviceProfiles.id, profile.id));
    }
    const app = v.appAt(clock);
    const id = randomUUID();
    const body = {
      workingOrderId: id,
      zoneId: v.zoneId,
      lines: [{ menuItemId: v.offerFor("Paella"), quantity: "1" }],
      tender: { method: "cash", amount: "35.00" },
    };
    const pay = () =>
      app.request("/api/sales", {
        method: "POST",
        headers: { cookie: v.cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const first = await pay();
    expect(first.status).toBe(200);
    const original = await first.json();
    expect(original).toMatchObject({ issuedAt: AT, issuedOffsetMinutes: 120, invoiceType: "F2" });
    expect(new URL(original.qr).searchParams.get("fecha")).toBe("15-10-2026");
    const stored = await v.db.select().from(sales);
    for (const timeZone of ["Europe/London", "Invalid/Zone"]) {
      await v.db.update(locations).set({ timeZone }).where(eq(locations.id, v.cfg.locationId));
      const replay = await pay();
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(original);
      const reprint = await app.request(`/api/sales/${id}/reprint`, {
        method: "POST",
        headers: { cookie: v.cookie },
      });
      expect(reprint.status).toBe(200);
      expect(await v.db.select().from(sales)).toEqual(stored);
    }
  });

  it("returns the saved offset even without a filed issuer", async () => {
    const sale = await issue(true);
    const backend = new Proxy(v.backend, {
      get(target, key, receiver) {
        if (key === "filedReceiptFor") return async () => undefined;
        return Reflect.get(target, key, receiver);
      },
    }) as FiscalBackend;
    expect(
      await withTransaction(v.db, (tx) => readReceiptIssuer(backend, tx, sale.saleId)),
    ).toEqual({ issuedOffsetMinutes: 120 });
  });
});

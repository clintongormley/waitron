import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  locations,
  printJobs,
  tenants,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { createPrinter, enqueuePrintJob } from "@waitron/printing";
import { recordSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import type { TrustedClock } from "@waitron/fiscal";
import { jobOrigin, locationId, seriesId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import {
  reserveInvoiceDelivery,
  claimInvoiceDelivery,
  expireInvoiceDeliveryClaims,
  reportInvoiceDelivery,
} from "./invoice-delivery.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const clock: TrustedClock = {
  now: () => ({
    instant: new Date("2026-10-07T12:00:00.000Z"),
    offsetMinutes: 0,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("Unused anchor");
  },
  currentAnchor: () => null,
};
const consent = {
  statementVersion: "invoice-email-v1",
  language: "es-ES",
  recordedAt: "2026-10-07T14:00:00+02:00",
  personId: "staff-one",
  contactEmail: "venue@example.test",
  contactPhone: "910000000",
};
const email = () => ({
  requestKey: randomUUID(),
  personId: "staff-one",
  medium: "email" as const,
  recipient: "customer@example.test",
  consent,
});

async function issue(full = true) {
  await seedTenant(suite.db);
  await suite.db.update(tenants).set({ taxpayerDomicile: "Saved domicile" });
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning();
  const nodeId = await seedNode(suite.db, locationId(location!.id));
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId, code: "F", purpose: full ? "full" : "standard" })
    .returning();
  const modules = enabledModules(
    ALL_MODULES,
    venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat"),
  );
  const backend = fiscalSlot(modules, null).makeBackend({
    db: suite.db,
    clock,
    environment: "preproduction",
  });
  return withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, {
      origin: jobOrigin("operator_script"),
      nodeId,
      seriesId: seriesId(series!.id),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total: "1.00",
      lines: [
        {
          lineNo: 1,
          name: "Coffee",
          descriptions: { "es-ES": "Café" },
          quantity: "1",
          unitPrice: "1.00",
          vatRate: "0",
          lineTotal: "1.00",
        },
      ],
      clock,
      settlement: { kind: "deferred" },
      ...(full
        ? {
            counterparty: { taxId: "12345678Z", legalName: "Saved customer", countryCode: "ES" },
            recipientAddress: "Saved address",
          }
        : {}),
    }),
  );
}

async function rows() {
  return (await suite.db.execute(sql`select * from invoice_deliveries order by generation`)).rows;
}

describe("invoice delivery reservation", () => {
  it("stores a queued original and frozen consent metadata without sending or retaining a document", async () => {
    const sale = await issue();
    const input = email();
    const delivery = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, input),
    );
    expect(delivery).toMatchObject({
      saleId: sale.saleId,
      medium: "email",
      designation: "original",
      status: "queued",
      generation: 1,
      attempts: 0,
      recipient: "customer@example.test",
      consent: {
        statementVersion: "invoice-email-v1",
        language: "es-ES",
        recordedAt: "2026-10-07T12:00:00.000Z",
        personId: "staff-one",
        contactEmail: "venue@example.test",
        contactPhone: "910000000",
      },
    });
    consent.contactEmail = "changed@example.test";
    try {
      expect(JSON.parse(String((await rows())[0]!.consent)).contactEmail).toBe(
        "venue@example.test",
      );
    } finally {
      consent.contactEmail = "venue@example.test";
    }
    const columns = (
      await suite.db.execute<{ name: string }>(
        sql`select name from pragma_table_info('invoice_deliveries')`,
      )
    ).rows.map((row) => row.name);
    expect(columns.some((name) => /payload|pdf|raster|document/.test(name))).toBe(false);
  });

  it("replays the same request after completion without allocating another delivery", async () => {
    const sale = await issue();
    const input = email();
    const first = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, input),
    );
    await suite.db.execute(
      sql`update invoice_deliveries set status = 'sent' where id = ${first.id}`,
    );
    const replay = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, input),
    );
    expect(replay).toMatchObject({ id: first.id, status: "sent", designation: "original" });
    expect(await rows()).toHaveLength(1);
  });

  it("serializes competing requests, refuses a different key and keeps another sale eligible", async () => {
    const sale = await issue();
    const other = await issue();
    const results = await Promise.allSettled(
      [email(), email()].map((input) =>
        withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, input)),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "invoice_delivery.active" },
    });
    const allowed = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, other.saleId, email()),
    );
    expect(allowed.designation).toBe("original");
  });

  it.each(["failed", "unknown"])(
    "reserves an original after %s, preserving the earlier address",
    async (status) => {
      const sale = await issue();
      const first = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, email()),
      );
      await suite.db.execute(
        sql`update invoice_deliveries set status = ${status} where id = ${first.id}`,
      );
      const next = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, {
          ...email(),
          recipient: "corrected@example.test",
        }),
      );
      expect(next).toMatchObject({
        designation: "original",
        generation: 2,
        recipient: "corrected@example.test",
      });
      expect((await rows())[0]).toMatchObject({ status, recipient: "customer@example.test" });
    },
  );

  it("marks another delivery after a completed original as duplicate", async () => {
    const sale = await issue();
    const first = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, email()),
    );
    await suite.db.execute(
      sql`update invoice_deliveries set status = 'sent' where id = ${first.id}`,
    );
    const next = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, email()),
    );
    expect(next).toMatchObject({ designation: "duplicate", generation: 2 });
  });

  it("rolls back its reservation with the caller's write", async () => {
    const sale = await issue();
    await expect(
      withTransaction(suite.db, async (tx) => {
        await reserveInvoiceDelivery(tx, sale.saleId, email());
        throw new Error("Caller refused");
      }),
    ).rejects.toThrow("Caller refused");
    expect(await rows()).toHaveLength(0);
  });

  it("refuses an absent sale and an F2 with domain codes", async () => {
    await expect(
      withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, randomUUID(), email())),
    ).rejects.toMatchObject({ code: "invoice_delivery.not_found" });
    const sale = await issue(false);
    await expect(
      withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, email())),
    ).rejects.toMatchObject({ code: "invoice_delivery.full_invoice_required" });
    expect(await rows()).toHaveLength(0);
  });
});

const start = new Date("2026-10-07T12:00:00.000Z");
const expired = new Date("2026-10-07T12:01:00.000Z");
async function queued() {
  const sale = await issue();
  const delivery = await withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, sale.saleId, email()),
  );
  await suite.db.execute(
    sql`update invoice_deliveries set next_attempt_at = ${start.toISOString()} where id = ${delivery.id}`,
  );
  return { sale, delivery };
}
async function claim(id: string, holder = "server-one", now = start) {
  return withTransaction(suite.db, (tx) => claimInvoiceDelivery(tx, id, holder, now));
}
async function expire(restart = false) {
  return withTransaction(suite.db, (tx) =>
    expireInvoiceDeliveryClaims(tx, restart ? start : expired, restart),
  );
}

describe("invoice delivery claims", () => {
  it("claims once, hashes its fresh token and excludes another worker before expiry", async () => {
    const { delivery } = await queued();
    const held = await claim(delivery.id);
    expect(held).toMatchObject({ deliveryId: delivery.id, generation: 1, holder: "server-one" });
    expect(held!.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(await claim(delivery.id, "server-two")).toBeUndefined();
    expect(await rows()).toMatchObject([
      { status: "sending", attempts: 1, claimed_at: start.toISOString() },
    ]);
    expect((await rows())[0]!.claim_token_hash).not.toBe(held!.token);
  });

  it("keeps a scheduled queue entry reserved without claiming it early", async () => {
    const { sale, delivery } = await queued();
    await suite.db.execute(
      sql`update invoice_deliveries set next_attempt_at = ${expired.toISOString()} where id = ${delivery.id}`,
    );
    expect(await claim(delivery.id)).toBeUndefined();
    await expect(
      withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, email())),
    ).rejects.toMatchObject({ code: "invoice_delivery.active" });
    expect(await claim(delivery.id, "server-one", expired)).toBeDefined();
  });

  it.each([false, true])(
    "expires a claim on timeout/restart=%s without silently replaying it",
    async (restart) => {
      const { delivery } = await queued();
      await claim(delivery.id);
      if (!restart) {
        await withTransaction(suite.db, (tx) =>
          expireInvoiceDeliveryClaims(tx, new Date(start.getTime() + 59_999)),
        );
        expect((await rows())[0]!.status).toBe("sending");
      }
      expect(await expire(restart)).toBe(1);
      expect(await claim(delivery.id, "server-two", expired)).toBeUndefined();
      expect(await rows()).toMatchObject([
        { status: "unknown", attempts: 1, failure_code: restart ? "restart" : "timeout" },
      ]);
    },
  );

  it.each(["deliveryId", "generation", "token", "holder"] as const)(
    "ignores a report with the wrong %s",
    async (field) => {
      const { delivery } = await queued();
      const held = (await claim(delivery.id))!;
      const bad = { ...held, [field]: field === "generation" ? 2 : "wrong" };
      expect(
        await withTransaction(suite.db, (tx) =>
          reportInvoiceDelivery(tx, bad, { status: "sent" }, expired),
        ),
      ).toEqual({ updated: false, historical: false });
      expect((await rows())[0]!.status).toBe("sending");
      expect(
        await withTransaction(suite.db, (tx) =>
          reportInvoiceDelivery(tx, held, { status: "sent" }, start),
        ),
      ).toEqual({ updated: true, historical: false });
      expect((await rows())[0]!.status).toBe("sent");
    },
  );

  it("applies the first authenticated result once and ignores a contradictory duplicate", async () => {
    const { delivery } = await queued();
    const held = (await claim(delivery.id))!;
    await withTransaction(suite.db, (tx) =>
      reportInvoiceDelivery(tx, held, { status: "sent" }, start),
    );
    expect(
      await withTransaction(suite.db, (tx) =>
        reportInvoiceDelivery(
          tx,
          held,
          { status: "failed", failureCode: "transport_failed" },
          expired,
        ),
      ),
    ).toEqual({ updated: false, historical: false });
    expect(await rows()).toMatchObject([
      { status: "sent", completed_at: start.toISOString(), attempts: 1, failure_code: null },
    ]);
  });

  it.each(["sent", "failed"] as const)(
    "resolves late %s before retry without treating failure as certainty",
    async (status) => {
      const { sale, delivery } = await queued();
      const held = (await claim(delivery.id))!;
      await expire();
      await withTransaction(suite.db, (tx) =>
        reportInvoiceDelivery(
          tx,
          held,
          status === "sent" ? { status } : { status, failureCode: "transport_failed" },
          expired,
        ),
      );
      expect((await rows())[0]!.status).toBe(status === "sent" ? "sent" : "unknown");
      const next = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, email()),
      );
      expect(next.designation).toBe(status === "sent" ? "duplicate" : "original");
    },
  );

  it.each([
    ["sent", "queued"],
    ["failed", "queued"],
    ["sent", "sending"],
    ["failed", "sending"],
    ["sent", "sent"],
    ["failed", "sent"],
    ["sent", "failed"],
    ["failed", "failed"],
  ] as const)(
    "records late %s only as history while the retry is %s",
    async (status, retryState) => {
      const { sale, delivery } = await queued();
      const held = (await claim(delivery.id))!;
      await expire();
      const next = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, email()),
      );
      await suite.db.execute(
        sql`update invoice_deliveries set next_attempt_at = ${expired.toISOString()} where id = ${next.id}`,
      );
      const retry =
        retryState === "queued" ? undefined : (await claim(next.id, "server-one", expired))!;
      if (retry !== undefined) {
        expect(retry).toMatchObject({ generation: 2, holder: "server-one" });
        expect(retry.token).not.toBe(held.token);
        if (retryState === "sent" || retryState === "failed") {
          await withTransaction(suite.db, (tx) =>
            reportInvoiceDelivery(
              tx,
              retry,
              retryState === "sent"
                ? { status: "sent" }
                : { status: "failed", failureCode: "transport_failed" },
              expired,
            ),
          );
        }
      }
      expect((await rows())[1]!.status).toBe(retryState);
      const before = (await rows())[1];
      expect(
        await withTransaction(suite.db, (tx) =>
          reportInvoiceDelivery(
            tx,
            held,
            status === "sent" ? { status } : { status, failureCode: "transport_failed" },
            expired,
          ),
        ),
      ).toEqual({ updated: false, historical: true });
      expect((await rows())[1]).toEqual(before);
      expect((await rows())[0]).toMatchObject({
        status: "unknown",
        reported_outcome: status,
        reported_failure_code: status === "failed" ? "transport_failed" : null,
      });
      if (retryState === "sending") {
        await withTransaction(suite.db, (tx) =>
          reportInvoiceDelivery(tx, retry!, { status: "sent" }, expired),
        );
        expect((await rows())[1]).toMatchObject({
          status: "sent",
          designation: "original",
          attempts: 1,
        });
      }
      expect(
        await withTransaction(suite.db, (tx) =>
          reportInvoiceDelivery(tx, held, { status: "sent" }, expired),
        ),
      ).toEqual({ updated: false, historical: false });
    },
  );
});

describe("existing F1 receipt delivery", () => {
  async function receipt(
    saleId: string,
    status: "queued" | "printing" | "done" | "failed",
    attempts = 0,
    receiptCopy = false,
    kind: "document" | "drawer" = "document",
  ) {
    const [location] = await suite.db.select().from(locations);
    return withTransaction(suite.db, async (tx) => {
      const printer = await createPrinter(
        tx,
        { locationId: location!.id },
        { name: "Receipt", transport: "network_tcp", host: "printer.test" },
      );
      const job = await enqueuePrintJob(
        tx,
        { locationId: location!.id },
        printer.id,
        new Uint8Array([27, 64]),
        kind,
        { saleId, receiptCopy },
      );
      await tx.update(printJobs).set({ status, attempts }).where(eq(printJobs.id, job.jobId));
      return job;
    });
  }
  it("makes email after a completed A231 receipt original a duplicate", async () => {
    const sale = await issue();
    await receipt(sale.saleId, "done");
    const next = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, email()),
    );
    expect(next.designation).toBe("duplicate");
  });
  it.each([
    ["queued", 0],
    ["printing", 0],
    ["failed", 4],
  ] as const)("refuses email beside an eligible existing %s receipt", async (status, attempts) => {
    const sale = await issue();
    await receipt(sale.saleId, status, attempts);
    await expect(
      withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, email())),
    ).rejects.toMatchObject({ code: "invoice_delivery.active" });
    expect(await rows()).toHaveLength(0);
  });
  it("permits an original after an exhausted receipt and ignores copies and drawers", async () => {
    const sale = await issue();
    await receipt(sale.saleId, "failed", 5);
    await receipt(sale.saleId, "done", 0, true);
    await receipt(sale.saleId, "done", 0, false, "drawer");
    const next = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, email()),
    );
    expect(next.designation).toBe("original");
  });
});

describe("active invoice outcome", () => {
  it.each(["failed", "unknown"] as const)(
    "records a current %s result and its safe failure code",
    async (status) => {
      const { delivery } = await queued();
      const held = (await claim(delivery.id))!;
      await withTransaction(suite.db, (tx) =>
        reportInvoiceDelivery(
          tx,
          held,
          { status, failureCode: "transport_failed" },
          new Date("2026-10-07T14:00:30+02:00"),
        ),
      );
      expect((await rows())[0]).toMatchObject({
        status,
        failure_code: "transport_failed",
        reported_failure_code: "transport_failed",
        reported_at: "2026-10-07T12:00:30.000Z",
        reported_outcome: status,
        completed_at: null,
        attempts: 1,
      });
    },
  );
});

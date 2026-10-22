import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billPayments, incidents, products, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { insertCapturedPayment } from "@waitron/payments";
import { startManagementSession } from "@waitron/identity";
import { loadKeyRing } from "@waitron/credentials";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { centsToDecimal, workingOrderId } from "@waitron/shared";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { mountPaymentsApi } from "./payments-api.js";
import { provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";

const fault = vi.hoisted(() => ({ enabled: false }));
vi.mock("@waitron/verifactu", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/verifactu")>();
  return {
    ...real,
    buildAltaRecord: (...args: Parameters<typeof real.buildAltaRecord>) => {
      const record = real.buildAltaRecord(...args);
      if (fault.enabled)
        record.Huella = (record.Huella[0] === "A" ? "B" : "A") + record.Huella.slice(1);
      return record;
    },
  };
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let venue: BillVenue;
let pendingId: string;
let app: Hono;
let cookie: string;
beforeEach(async () => {
  venue = await provisionBillVenue(suite.db);
  const [product] = await suite.db.select().from(products);
  if (product?.unitPrice == null) throw new Error("fixture needs a priced product");
  const billId = await tabWith(venue, product.name);
  pendingId = await withTransaction(suite.db, async (tx) => {
    const [payment] = await tx
      .insert(billPayments)
      .values({
        workingOrderId: billId,
        submissionId: randomUUID(),
        fingerprint: "stranded",
        kind: "contribution",
        method: "card",
        applied: product.unitPrice!,
        tip: 0,
        state: "pending",
        requestedBy: venue.operatorId,
        source: "device",
        deviceId: venue.deviceId,
      })
      .returning();
    await insertCapturedPayment(tx, {
      origin: venue.cfg.origin,
      workingOrderId: workingOrderId(billId),
      provider: "fake",
      paymentRef: randomUUID(),
      amount: centsToDecimal(product.unitPrice!),
      settledAt: new Date(),
      billPaymentId: payment!.id,
    });
    return payment!.id;
  });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: venue.adminId }),
  );
  cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
  app = new Hono();
  mountPaymentsApi(
    app,
    {
      db: suite.db,
      backend: venue.backend,
      clock: venue.clock,
      cfg: venue.cfg,
      ring: loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
      }),
      environment: "preproduction",
      pool: venue.pool,
      providers: [],
    },
    () => {},
  );
});
afterEach(() => {
  fault.enabled = false;
  vi.restoreAllMocks();
});

function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of [
    "bill_payments",
    "payments",
    "invoice_series",
    "sales",
    "sale_lines",
    "sale_settlements",
    "tenders",
    "working_orders",
    "working_order_lines",
    "cadenas",
    "registros_facturacion",
    "envios",
    "print_jobs",
    "drawer_opens",
  ]) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("invalid snapshot identifier");
    result[table] = suite.db.all(sql.raw(`select * from "${table}" order by rowid`));
  }
  return result;
}

const settle = () =>
  settlePendingBillPayments({
    db: suite.db,
    backend: venue.backend,
    clock: venue.clock,
    cfg: venue.cfg,
  });

describe("previously captured bill payments", () => {
  it.each(["loop", "resolve", "attest"] as const)(
    "%s retains one mismatch incident, leaves capture pending and retries without collecting",
    async (owner) => {
      const before = snapshot();
      fault.enabled = true;
      const attempt = async () => {
        if (owner === "loop") {
          const pass = await settle();
          expect(pass).toMatchObject({
            received: 0,
            pending: 1,
            errors: [
              {
                billPaymentId: pendingId,
                error: expect.stringContaining("fiscal.fingerprint_mismatch"),
              },
            ],
          });
        } else {
          const response = await send(
            app,
            cookie,
            "POST",
            `/management-api/payments/bill-payments/${pendingId}/${owner}`,
            owner === "attest"
              ? { outcome: "received", note: "Provider confirmed capture", pin: "1234" }
              : {},
          );
          expect(response).toEqual({
            status: 409,
            json: { code: "fiscal.fingerprint_mismatch", params: {} },
          });
        }
      };
      await attempt();
      await attempt();
      expect(snapshot()).toEqual(before);
      const alerts = await suite.db.select().from(incidents);
      expect(alerts.map((row) => ({ code: row.code, saleId: row.saleId }))).toEqual([
        { code: "fiscal.fingerprint_mismatch", saleId: null },
      ]);
      fault.enabled = false;
      const repaired = await settle();
      expect(repaired).toMatchObject({ received: 1, pending: 0, errors: [] });
      expect(suite.db.all(sql`select state from bill_payments`)).toEqual([{ state: "received" }]);
      expect(suite.db.all(sql`select count(*) as count from registros_facturacion`)).toEqual([
        { count: 1 },
      ]);
      expect(venue.card.collectCalls).toEqual([]);
      expect(await suite.db.select().from(incidents)).toEqual(alerts);
    },
  );

  it("incident persistence failure still returns the original mismatch", async () => {
    suite.db.run(
      sql`create trigger refuse_mismatch_incident before insert on incidents begin select raise(abort, 'private incident error'); end`,
    );
    const before = snapshot();
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    fault.enabled = true;
    try {
      const answer = await send(
        app,
        cookie,
        "POST",
        `/management-api/payments/bill-payments/${pendingId}/resolve`,
        {},
      );
      expect(answer).toEqual({
        status: 409,
        json: { code: "fiscal.fingerprint_mismatch", params: {} },
      });
      expect(snapshot()).toEqual(before);
      expect(await suite.db.select().from(incidents)).toEqual([]);
      expect(stderr.mock.calls.flat().join(" ")).not.toContain("private incident error");
    } finally {
      suite.db.run(sql`drop trigger refuse_mismatch_incident`);
    }
  });

  it("an unrelated background issuance failure still raises its existing settle-failed incident", async () => {
    suite.db.run(
      sql`create trigger refuse_test_sale before insert on sales begin select raise(abort, 'test sale refusal'); end`,
    );
    try {
      const pass = await settle();
      expect(pass.errors).toHaveLength(1);
      expect((await suite.db.select().from(incidents)).map((row) => row.code)).toEqual([
        "payment.bill_settle_failed",
      ]);
    } finally {
      suite.db.run(sql`drop trigger refuse_test_sale`);
    }
  });
});

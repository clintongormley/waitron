import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  devices,
  invoiceDeliveries,
  invoiceSeries,
  nodes,
  parties,
  printAgents,
  printers,
  printJobs,
  sales,
  taxpayer,
  unpaidDepartures,
  withTransaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedDepartmentReceipt,
  seedDevice,
  seedDeviceProfiles,
  seedPerson,
  seedVenue,
  seedWorkingOrder,
} from "@waitron/db/testing/seed.js";
import {
  claimPrintJobs,
  createPrinter,
  enqueueA4PrintJob,
  enqueuePrintJob,
  MAX_DELIVERY_ATTEMPTS,
  updatePrinter,
} from "@waitron/printing";
import { insertA4Printer } from "@waitron/db/testing/printers.js";
import { expireInvoiceDeliveryClaims, reserveInvoiceDelivery } from "./invoice-delivery.js";
import { insertCorrective } from "./testing/replacement-fixture.js";
import type { Transaction } from "@waitron/db";
import type { Logger } from "./logger.js";
import type { LayOutSaleReceipt } from "./receipt-print.js";
import {
  givenUpOriginals,
  owedReceiptJob,
  owesOriginal,
  printOwedTickets,
  startFreshRounds,
} from "./owed-receipts.js";
import { Hono } from "hono";
import type { FiscalBackend } from "@waitron/fiscal";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import {
  assignMenuToVenue,
  addProductToMenu,
  createCategory,
  createMenu,
  createProduct,
} from "@waitron/menu";
import { planVenue } from "@waitron/provisioning";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";
import { departments, routingCells } from "@waitron/venue-service";
import { recordSale } from "@waitron/core";
import {
  deviceOrigin,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  workingOrderId as brandWorkingOrderId,
  jobOrigin,
} from "@waitron/shared";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { systemClock } from "./till-backend.js";
import { printSaleReceipt } from "./till-sale.js";
import { createOpenOrder } from "./working-order.js";
import { deletePrinter } from "./printer-delete.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { fixturePasswordHash, fixturePinHash } from "./testing/known-secret-hashes.js";
import type { TradingContext } from "./trading-context.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const STAFF = "dddddddd-0000-4000-8000-000000000001";
const NODE = "eeeeeeee-0000-4000-8000-000000000001";

/** Stands in for the sale's receipt laid out again: bytes naming the sale, the copy marking and the roll. */
const layOut: LayOutSaleReceipt = async (_tx, saleId, duplicate, printer) =>
  new TextEncoder().encode(`${saleId} ${duplicate} ${printer.paperWidth}`);
const AT = "2026-11-19T12:00:00.000Z";

/** A recorded sale on its own bill, and a receipt printer to print it on. */
async function issued(saleValues: Partial<typeof sales.$inferInsert> = {}): Promise<{
  saleId: string;
  billId: string;
  partyId: string;
  printerId: string;
}> {
  await seedPerson(suite.db, { id: STAFF });
  await seedVenue(suite.db, { name: "Bar", invoiceLocales: ["es-ES"] });
  const nodeId = NODE;
  await suite.db.insert(nodes).values({ id: NODE, name: "Test node" });
  const { deviceId } = await seedDevice(suite.db);
  return withTransaction(suite.db, async (tx) => {
    const [series] = await tx
      .insert(invoiceSeries)
      .values({ nodeId, code: "F", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    const [party] = await tx.insert(parties).values({ openedBy: STAFF }).returning();
    const bill = await seedWorkingOrder(tx, {
      source: "dashboard",
      deviceId: null,
      nodeId,
      orderNumber: 1,
      status: "placed",
      openedAt: AT,
      partyId: party!.id,
    });
    const [sale] = await tx
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: AT,
        issuedOffsetMinutes: 60,
        total: 150,
        vatBreakdown: [],
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
        workingOrderId: bill.id,
        ...saleValues,
      })
      .returning({ id: sales.id });
    const printer = await createPrinter(tx, {
      name: "Recibos",
      transport: "network_tcp",
      host: "recibos.test",
    });
    return { saleId: sale!.id, billId: bill.id, partyId: party!.id, printerId: printer.id };
  });
}

async function receiptJob(
  saleId: string,
  printerId: string,
  set: Partial<typeof printJobs.$inferInsert> = {},
  receiptCopy = false,
): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const { jobId } = await enqueuePrintJob(tx, printerId, new Uint8Array([27, 64]), "document", {
      saleId,
      receiptCopy,
    });
    if (Object.keys(set).length > 0)
      await tx.update(printJobs).set(set).where(eq(printJobs.id, jobId));
    return jobId;
  });
}

async function delivery(
  saleId: string,
  values: Pick<typeof invoiceDeliveries.$inferInsert, "medium" | "status"> &
    Partial<typeof invoiceDeliveries.$inferInsert>,
  generation = 1,
): Promise<void> {
  await suite.db.insert(invoiceDeliveries).values({
    saleId,
    requestKey: randomUUID(),
    designation: "original",
    generation,
    personId: STAFF,
    ...(values.medium === "email" ? { recipient: "customer@example.test" } : {}),
    ...values,
  });
}

/** These suites' own sales never reach the fiscal seat: each already has an original job. */
const unusedBackend = {} as FiscalBackend;
const nodeCfg: TradingContext = {
  nodeId: brandNodeId(NODE),
  locale: "es-ES",
  tipsEnabled: false,
  simplifiedInvoiceLimit: null,
};

const owes = (saleId: string) => withTransaction(suite.db, (tx) => owesOriginal(tx, saleId));

const GIVEN_UP = {
  status: "failed",
  attempts: MAX_DELIVERY_ATTEMPTS,
  lastError: "refused",
} as const;

describe("owesOriginal", () => {
  it("owes a sale nothing has printed or sent", async () => {
    const { saleId } = await issued();
    expect(await owes(saleId)).toBe(true);
  });

  it("owes a sale whose original email failed", async () => {
    const { saleId } = await issued();
    await delivery(saleId, { medium: "email", status: "failed", failureCode: "transport_failed" });
    expect(await owes(saleId)).toBe(true);
  });

  it("owes a sale whose plain original print gave up", async () => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, GIVEN_UP);
    expect(await owes(saleId)).toBe(true);
  });

  it("owes a full invoice whose tracked receipt original gave up", async () => {
    const { saleId, printerId } = await issued();
    const jobId = await receiptJob(saleId, printerId, GIVEN_UP);
    await delivery(saleId, {
      medium: "receipt",
      status: "failed",
      printJobId: jobId,
      printerId,
      failureCode: "printer_refused",
    });
    expect(await owes(saleId)).toBe(true);
  });

  it.each([false, true])(
    "owes nothing for a full invoice's tracked receipt that may have printed (restart: %s)",
    async (restart) => {
      const { saleId, printerId } = await issued();
      const claimedAt = "2026-11-19T11:00:00.000Z";
      const jobId = await receiptJob(saleId, printerId, {
        status: "printing",
        attempts: 1,
        claimedAt,
      });
      await delivery(saleId, {
        medium: "receipt",
        status: "sending",
        printJobId: jobId,
        printerId,
      });
      expect(
        await withTransaction(suite.db, (tx) =>
          expireInvoiceDeliveryClaims(tx, new Date("2026-11-19T12:00:00.000Z"), restart),
        ),
      ).toBe(1);
      const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
      expect(job).toMatchObject({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });
      expect(await owes(saleId)).toBe(false);
    },
  );

  it("does not take an A4 page's job for a receipt original", async () => {
    const { saleId } = await issued();
    await withTransaction(suite.db, async (tx) => {
      const office = await insertA4Printer(tx);
      const { jobId } = await enqueueA4PrintJob(tx, office, saleId, AT);
      await tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, jobId));
    });
    expect(await owes(saleId)).toBe(true);
  });

  it("still owes a sale whose only printed receipt is a copy", async () => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, GIVEN_UP);
    await receiptJob(saleId, printerId, { status: "done" }, true);
    expect(await owes(saleId)).toBe(true);
  });

  it.each([
    ["done", { status: "done" }],
    ["queued", {}],
    ["printing", { status: "printing", attempts: 1 }],
    ["failed with attempts left", { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS - 1 }],
  ] as const)("owes nothing while an original print is %s", async (_, set) => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, set);
    expect(await owes(saleId)).toBe(false);
  });

  it("owes nothing while a resend of a given-up original is still trying", async () => {
    const { saleId, printerId } = await issued();
    const first = await receiptJob(saleId, printerId, GIVEN_UP);
    await receiptJob(saleId, printerId, { resendOf: first });
    expect(await owes(saleId)).toBe(false);
  });

  it.each(
    (["email", "a4"] as const).flatMap((medium) =>
      (["queued", "sending", "sent", "unknown"] as const).map(
        (status) => [medium, status] as const,
      ),
    ),
  )("owes nothing once an %s original is %s", async (medium, status) => {
    const { saleId } = await issued();
    await delivery(saleId, { medium, status });
    expect(await owes(saleId)).toBe(false);
  });

  it.each(["unknown", "sent"] as const)(
    "owes nothing for an email the mail server accepted late, stored as %s",
    async (status) => {
      const { saleId } = await issued();
      await delivery(saleId, {
        medium: "email",
        status,
        reportedOutcome: "sent",
        reportedAt: AT,
      });
      expect(await owes(saleId)).toBe(false);
    },
  );

  it("owes nothing to a corrective", async () => {
    const { saleId } = await issued();
    const corrective = await withTransaction(suite.db, (tx) =>
      insertCorrective(tx, saleId, { total: "-1.50" }),
    );
    expect(await owes(corrective)).toBe(false);
  });

  it("owes nothing to a bill whose party left without paying", async () => {
    const { saleId, billId, partyId } = await issued();
    const [bill] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    await suite.db.insert(unpaidDepartures).values({
      partyId,
      workingOrderId: billId,
      saleId,
      amount: bill!.total,
      reason: "Left without paying",
      recordedBy: STAFF,
      authorizedBy: STAFF,
      source: "device",
      deviceId: bill!.deviceId,
    });
    expect(await owes(saleId)).toBe(false);
  });
});

describe("startFreshRounds", () => {
  const NOW = new Date(Date.parse(AT) + 60 * 60_000);
  const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
  const givenUpAt = (minutes: number, lastError = "refused") => ({
    ...GIVEN_UP,
    lastError,
    claimedAt: minutesAgo(minutes),
  });
  let warnings: string[] = [];
  const log: Logger = (level, message) => {
    if (level === "warn") warnings.push(message);
  };
  const run = async (at = NOW) => {
    warnings = [];
    return (await startFreshRounds(suite.db, layOut, NODE, at, log)).resent;
  };
  // Each refusal below is the round's own filter, not a resend that threw and was logged.
  const leftAlone = async (saleId: string, at = NOW) => {
    expect(await run(at)).toEqual([]);
    expect(warnings).toEqual([]);
    expect(await jobsOf(saleId)).toHaveLength(1);
  };
  const jobsOf = (saleId: string) =>
    suite.db.select().from(printJobs).where(eq(printJobs.saleId, saleId));

  it("resends an original that gave up 11 minutes ago once, on its printer, naming the first job", async () => {
    const { saleId, printerId } = await issued();
    const first = await receiptJob(saleId, printerId, givenUpAt(11));
    const [resent] = await run();
    expect(await run()).toEqual([]);
    const jobs = await jobsOf(saleId);
    expect(jobs).toHaveLength(2);
    expect(jobs.find((job) => job.id === resent)).toMatchObject({
      printerId,
      receiptCopy: false,
      status: "queued",
      resendOf: first,
    });
    expect(new TextDecoder().decode(jobs.find((job) => job.id === resent)!.payload!)).toMatch(
      new RegExp(`^${saleId} false `, "u"),
    );
  });

  it("leaves an original that gave up 9 minutes ago", async () => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, givenUpAt(9));
    await leftAlone(saleId);
  });

  it("leaves a sale issued over 24 hours ago", async () => {
    const { saleId, printerId } = await issued();
    const later = new Date(Date.parse(AT) + 24 * 60 * 60_000 + 60_000);
    await receiptJob(saleId, printerId, {
      ...GIVEN_UP,
      claimedAt: new Date(later.getTime() - 11 * 60_000).toISOString(),
    });
    await leftAlone(saleId, later);
  });

  it.each(["printer.deleted", "printer.unpaired", "print_job.moved"])(
    "never resends an original ended by %s",
    async (lastError) => {
      const { saleId, printerId } = await issued();
      await receiptJob(saleId, printerId, givenUpAt(11, lastError));
      expect(await owes(saleId)).toBe(true);
      await leftAlone(saleId);
    },
  );

  it("leaves an original whose printer was deleted", async () => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, givenUpAt(11));
    await suite.db
      .update(printers)
      .set({ active: false, deletedAt: minutesAgo(5) })
      .where(eq(printers.id, printerId));
    await leftAlone(saleId);
  });

  it("leaves an original on a switched-off printer until it is switched back on", async () => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, givenUpAt(11));
    await suite.db.update(printers).set({ active: false }).where(eq(printers.id, printerId));
    await leftAlone(saleId);
    await suite.db.update(printers).set({ active: true }).where(eq(printers.id, printerId));
    expect(await run()).toHaveLength(1);
    expect(await jobsOf(saleId)).toHaveLength(2);
  });

  it("stops resending once the runner asks it to stop", async () => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, givenUpAt(11));
    const stopped = new AbortController();
    stopped.abort();
    expect(await startFreshRounds(suite.db, layOut, NODE, NOW, log, stopped.signal)).toEqual({
      resent: [],
      nextDueAt: null,
    });
    const job = owedReceiptJob({
      db: suite.db,
      layOutSaleReceipt: layOut,
      backend: unusedBackend,
      cfg: nodeCfg,
      isPrimary: () => true,
      log,
    });
    expect(await job.pass({ now: NOW, signal: stopped.signal })).toEqual({ nextDueAt: null });
    expect(await jobsOf(saleId)).toHaveLength(1);
  });

  /** The suite's database, calling `onWriteLock` each time a transaction asks for the write lock. */
  const watching = (onWriteLock: () => void) =>
    new Proxy(suite.db, {
      get(target, key) {
        if (key === "withWriteLock")
          return (fn: () => Promise<unknown>) => {
            onWriteLock();
            return target.withWriteLock(fn);
          };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  /**
   * Holds the write lock until the round has read its candidates and asked for the lock, then runs
   * `meanwhile` inside the held transaction before letting the round in.
   */
  async function raceTheRound(
    meanwhile: (tx: Transaction) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<string[]> {
    let holding!: () => void;
    const holds = new Promise<void>((resolve) => (holding = resolve));
    let asked!: () => void;
    const asking = new Promise<void>((resolve) => (asked = resolve));
    const holder = withTransaction(suite.db, async (tx) => {
      holding();
      await asking;
      await meanwhile(tx);
    });
    await holds;
    warnings = [];
    const round = startFreshRounds(watching(asked), layOut, NODE, NOW, log, signal);
    await holder;
    return (await round).resent;
  }

  it("resends nothing once stopped while it waited for the write lock", async () => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, givenUpAt(11));
    const stop = new AbortController();
    expect(await raceTheRound(async () => stop.abort(), stop.signal)).toEqual([]);
    expect(warnings).toEqual([]);
    expect(await jobsOf(saleId)).toHaveLength(1);
  });

  it("leaves a candidate that a newer original replaced while it waited for the write lock", async () => {
    const { saleId, printerId } = await issued();
    const first = await receiptJob(saleId, printerId, givenUpAt(11));
    expect(
      await raceTheRound(async (tx) => {
        const { jobId } = await enqueuePrintJob(
          tx,
          printerId,
          new Uint8Array([27, 64]),
          "document",
          {
            saleId,
            receiptCopy: false,
          },
        );
        await tx
          .update(printJobs)
          .set({ ...givenUpAt(1), resendOf: first })
          .where(eq(printJobs.id, jobId));
      }),
    ).toEqual([]);
    expect(warnings).toEqual([]);
    expect(await jobsOf(saleId)).toHaveLength(2);
  });

  it.each([
    [
      "its original was then emailed",
      async (saleId: string) => delivery(saleId, { medium: "email", status: "sent" }),
    ],
    [
      "its party then left without paying",
      async (saleId: string, billId: string, partyId: string) => {
        const [sale] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
        await suite.db.insert(unpaidDepartures).values({
          partyId,
          workingOrderId: billId,
          saleId,
          amount: sale!.total,
          reason: "Left without paying",
          recordedBy: STAFF,
          authorizedBy: STAFF,
          source: "device",
          deviceId: sale!.deviceId,
        });
      },
    ],
  ] as const)(
    "takes no write lock for a given-up original whose sale no longer owes it: %s",
    async (_, settle) => {
      const { saleId, billId, partyId, printerId } = await issued();
      await receiptJob(saleId, printerId, givenUpAt(11));
      await settle(saleId, billId, partyId);
      let locks = 0;
      expect(
        await startFreshRounds(
          watching(() => locks++),
          layOut,
          NODE,
          NOW,
          log,
        ),
      ).toEqual({
        resent: [],
        nextDueAt: null,
      });
      expect(locks).toBe(0);
    },
  );

  it("says when the next given-up original falls due, and nothing when none waits", async () => {
    const { saleId, printerId } = await issued();
    expect(await startFreshRounds(suite.db, layOut, NODE, NOW, log)).toEqual({
      resent: [],
      nextDueAt: null,
    });
    await receiptJob(saleId, printerId, givenUpAt(7));
    expect(await startFreshRounds(suite.db, layOut, NODE, NOW, log)).toEqual({
      resent: [],
      nextDueAt: new Date(NOW.getTime() + 3 * 60_000),
    });
  });

  it("looks again in a minute after a resend that failed", async () => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, { ...givenUpAt(11), payload: new Uint8Array() });
    expect(await startFreshRounds(suite.db, layOut, NODE, NOW, log)).toEqual({
      resent: [],
      nextDueAt: NOW,
    });
  });

  it("leaves a sale that no longer owes its original", async () => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, givenUpAt(11));
    await delivery(saleId, { medium: "email", status: "unknown" });
    await leftAlone(saleId);
  });

  it("resends only the newest of a sale's given-up originals, on that job's printer", async () => {
    const { saleId, printerId } = await issued();
    const elsewhere = await withTransaction(suite.db, async (tx) =>
      createPrinter(tx, { name: "Bar", transport: "network_tcp", host: "barra.test" }),
    );
    const first = await receiptJob(saleId, printerId, givenUpAt(30));
    await receiptJob(saleId, elsewhere.id, { ...givenUpAt(20), resendOf: first });
    const resent = await run();
    expect(resent).toHaveLength(1);
    const jobs = await jobsOf(saleId);
    expect(jobs).toHaveLength(3);
    expect(jobs.find((job) => job.id === resent[0])).toMatchObject({
      printerId: elsewhere.id,
      resendOf: first,
      status: "queued",
    });
  });

  it("takes the last original made as the newest, even after the clock stepped back", async () => {
    const { saleId, printerId } = await issued();
    const elsewhere = await withTransaction(suite.db, async (tx) =>
      createPrinter(tx, { name: "Terrace", transport: "network_tcp", host: "terrace.test" }),
    );
    const first = await receiptJob(saleId, printerId, {
      ...givenUpAt(30),
      createdAt: minutesAgo(40),
    });
    await receiptJob(saleId, elsewhere.id, {
      ...givenUpAt(20),
      resendOf: first,
      createdAt: minutesAgo(90),
    });
    const [resent] = await run();
    const jobs = await jobsOf(saleId);
    expect(jobs).toHaveLength(3);
    expect(jobs.find((job) => job.id === resent)).toMatchObject({ printerId: elsewhere.id });
  });

  it("logs a resend that fails and carries on with the next sale", async () => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, { ...givenUpAt(11), payload: new Uint8Array() });
    const [first] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    const [next] = await suite.db
      .insert(sales)
      .values({ ...first!, id: randomUUID(), invoiceNumber: 2, workingOrderId: null })
      .returning({ id: sales.id });
    await receiptJob(next!.id, printerId, givenUpAt(11));
    const resent = await run();
    expect(warnings).toEqual(["receipt.fresh_round_failed"]);
    expect(resent).toHaveLength(1);
    expect(await jobsOf(next!.id)).toHaveLength(2);
    expect(await jobsOf(saleId)).toHaveLength(1);
  });

  it("resends a full invoice's tracked original with no person", async () => {
    const { saleId, printerId } = await issued({
      counterpartyTaxId: "B12345674",
      counterpartyLegalName: "Customer SL",
    });
    const first = await receiptJob(saleId, printerId, givenUpAt(11));
    await delivery(saleId, {
      medium: "receipt",
      status: "failed",
      printJobId: first,
      printerId,
      failureCode: "printer_refused",
    });
    const [resent] = await run();
    const rows = await suite.db
      .select()
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.printJobId, resent!));
    expect(rows).toEqual([
      expect.objectContaining({
        medium: "receipt",
        designation: "original",
        status: "queued",
        personId: null,
        generation: 2,
      }),
    ]);
  });
});

describe("owedReceiptJob", () => {
  it("runs on the primary only, at most once a minute, woken by what can make a receipt owed", async () => {
    let primary = false;
    const job = owedReceiptJob({
      db: suite.db,
      layOutSaleReceipt: layOut,
      backend: unusedBackend,
      cfg: nodeCfg,
      isPrimary: () => primary,
      log: () => {},
    });
    expect(job).toMatchObject({
      name: "receipt.owed",
      minSleepMs: 60_000,
      maxSleepMs: 60 * 60_000,
      wakeOn: [
        "print_jobs",
        "printers",
        "invoice_deliveries",
        "sales",
        "devices",
        "device_profiles",
      ],
    });
    expect(job.applies()).toBe(false);
    primary = true;
    expect(job.applies()).toBe(true);
  });

  it("starts a fresh round on each pass", async () => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, {
      ...GIVEN_UP,
      claimedAt: AT,
    });
    const job = owedReceiptJob({
      db: suite.db,
      layOutSaleReceipt: layOut,
      backend: unusedBackend,
      cfg: nodeCfg,
      isPrimary: () => true,
      log: () => {},
    });
    expect(
      await job.pass({
        now: new Date(Date.parse(AT) + 11 * 60_000),
        signal: new AbortController().signal,
      }),
    ).toEqual({ nextDueAt: null });
    expect(
      await suite.db.select().from(printJobs).where(eq(printJobs.saleId, saleId)),
    ).toHaveLength(2);
  });
});

it("finds candidates through the issued-time index, and checks unpaid departures per print job, not per sale", async () => {
  const plan = await withTransaction(suite.db, async (tx) => {
    const rows = await tx.execute<{ detail: string }>(
      sql`explain query plan ${givenUpOriginals(tx, NODE, new Date(AT)).getSQL()}`,
    );
    return rows.rows.map((row) => row.detail);
  });
  const joined = plan.indexOf("SEARCH print_jobs USING INDEX print_jobs_sale_id_idx (sale_id=?)");
  expect(plan[0]).toBe("SEARCH sales USING INDEX sales_issued_idx (issued_at>?)");
  expect(joined).toBe(1);
  expect(plan.indexOf("SCAN unpaid_departures")).toBeGreaterThan(joined);
});

describe("printOwedTickets", () => {
  let backend: FiscalBackend;
  beforeAll(() => {
    backend = new VerifactuBackend({
      clock: systemClock(),
      db: suite.db,
      environment: deploymentEnvironment(process.env),
      deploymentEnvironment: deploymentEnvironment(process.env),
    });
  });
  let warnings: { message: string; params: unknown }[] = [];
  const log: Logger = (level, message, params) => {
    if (level === "warn") warnings.push({ message, params });
  };
  const PRINTS = CAPABILITY_FLAGS.filter((flag) => flag !== "open-cash-drawer");

  /**
   * A venue with one menu item on its counter, and a till signed in on a device whose profile allows
   * `capabilities`, on a receipt printer unless `printer` is false. A sale is a counter cash sale
   * rung on that till; `close` is its window's close request (Done).
   */
  async function till({
    printer = true,
    capabilities = PRINTS,
  }: { printer?: boolean; capabilities?: readonly string[] } = {}) {
    const venue = await applyVenue(
      planVenue(
        {
          country: "ES",
          taxId: "61000003R",
          legalName: "Recibos Debidos SL",
          name: "Sala",
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
          rectificativeSeriesCode: "R",
          admin: {
            displayName: "Administrator",
            pinHash: fixturePinHash("1234"),
            passwordHash: fixturePasswordHash("dashPass123"),
            email: "owner@example.test",
          },
        },
        ALL_MODULES,
      ),
      { db: suite.db, modules: ALL_MODULES },
    );
    const cfg: TradingContext = {
      nodeId: brandNodeId(venue.nodeId),
      locale: "es-ES",
      tipsEnabled: false,
      simplifiedInvoiceLimit: null,
    };
    const { menuItemId, operatorId } = await withTransaction(suite.db, async (tx) => {
      const menu = await createMenu(tx, { name: "Barra" });
      const category = await createCategory(tx, { name: "Bebidas" });
      const product = await createProduct(tx, {
        categoryId: category.id,
        name: "Agua mineral",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await assignMenuToVenue(tx, menu.id);
      const item = await addProductToMenu(tx, {
        menuId: menu.id,
        productId: product.id,
        grossPrice: "1.50",
      });
      const counter = await tx.execute<{ zone_id: string }>(
        sql`select id as zone_id from floor_zones where is_counter_default`,
      );
      await offerMenuThroughZone(tx, counter.rows[0]!.zone_id, menu.id, { makeDefault: true });
      await publishWorkingMenu(tx, menu.id);
      await tx
        .insert(routingCells)
        .values({ categoryId: category.id, stationId: null, noPreparation: true });
      for (const department of await tx
        .select({ id: departments.id })
        .from(departments)
        .where(isNull(departments.receiptUpdatedAt)))
        await seedDepartmentReceipt(tx, department.id, {
          operationDescription: "Sale on the premises",
        });
      const [staff] = await seedPersons(tx, {
        displayName: "Cashier",
        pinHash: fixturePinHash("5555"),
        role: "staff",
      });
      return { menuItemId: item.id, operatorId: staff!.id };
    });
    const [profile] = await seedDeviceProfiles(suite.db, {
      name: "Counter till",
      formFactor: "till",
      capabilities: [...capabilities],
    });
    const device = await enrolDeviceForTest(suite.db, cfg, {
      name: "Counter till",
      profileId: profile!.id,
    });
    const deviceId = device.deviceId;
    const newPrinter = () =>
      withTransaction(suite.db, async (tx) => {
        const { id } = await createPrinter(tx, {
          name: "Recibos",
          transport: "network_tcp",
          host: `recibos-${randomUUID()}.test`,
        });
        await tx.update(devices).set({ receiptPrinterId: id }).where(eq(devices.id, deviceId));
        return id;
      });
    const printerId = printer ? await newPrinter() : null;
    const app = new Hono();
    mountTillApi(
      app,
      {
        admission: testTradingAdmission(),
        db: suite.db,
        backend,
        clock: systemClock(),
        cfg,
        secureCookies: false,
        venueLocale: "es-ES",
      },
      () => {},
    );
    const deviceCookie = `${DEVICE_COOKIE}=${deviceId}.${device.token}`;
    const signIn = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId: operatorId, pin: "5555" }),
    });
    expect(signIn.status).toBe(200);
    const cookie = `${signIn.headers.get("set-cookie")!.split(";")[0]!}; ${deviceCookie}`;
    async function ring() {
      const orderId = randomUUID();
      const res = await app.request(`/api/working-orders/${orderId}/payments`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          dining: "eat_in",
          submissionId: orderId,
          kind: "share",
          shareOf: 1,
          method: "cash",
          tendered: "1.50",
          basket: { lines: [{ menuItemId, quantity: "1" }] },
        }),
      });
      expect(res.status).toBe(200);
      const [sale] = await suite.db.select().from(sales).where(eq(sales.workingOrderId, orderId));
      return { orderId, saleId: sale!.id, sale: sale!, issuedAt: Date.parse(sale!.issuedAt) };
    }
    const close = async (orderId: string) => {
      const res = await app.request(`/api/sales/${orderId}/receipt`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ ifOwed: true }),
      });
      expect(res.status).toBe(200);
    };
    return { cfg, deviceId, printerId, operatorId, menuItemId, newPrinter, ring, close };
  }

  const after = (sale: { issuedAt: number }, minutes: number) =>
    new Date(sale.issuedAt + minutes * 60_000);
  const pass = (
    cfg: TradingContext,
    at: Date,
    deps: { db?: typeof suite.db; backend?: FiscalBackend } = {},
  ) => {
    warnings = [];
    return printOwedTickets(
      { db: deps.db ?? suite.db, backend: deps.backend ?? backend, cfg, log },
      at,
    );
  };
  const jobsOf = (saleId: string) =>
    suite.db
      .select({
        id: printJobs.id,
        printerId: printJobs.printerId,
        receiptCopy: printJobs.receiptCopy,
        status: printJobs.status,
        payload: printJobs.payload,
      })
      .from(printJobs)
      .where(eq(printJobs.saleId, saleId));
  const shape = async (saleId: string) =>
    (await jobsOf(saleId)).map(({ printerId, receiptCopy, status }) => ({
      printerId,
      receiptCopy,
      status,
    }));

  it("prints the original 10 minutes after a sale whose close request never came", async () => {
    const { cfg, printerId, ring } = await till();
    const sale = await ring();
    expect((await pass(cfg, after(sale, 9))).queued).toEqual([]);
    expect(await jobsOf(sale.saleId)).toEqual([]);
    expect((await pass(cfg, after(sale, 10))).queued).toEqual([sale.saleId]);
    expect((await pass(cfg, after(sale, 11))).queued).toEqual([]);
    expect(await shape(sale.saleId)).toEqual([{ printerId, receiptCopy: false, status: "queued" }]);
    expect(warnings).toEqual([]);
  });

  it("prints the original after an email sent before Done failed", async () => {
    const { cfg, printerId, operatorId, ring } = await till();
    const sale = await ring();
    await delivery(sale.saleId, {
      medium: "email",
      status: "failed",
      failureCode: "transport_failed",
      personId: operatorId,
    });
    expect((await pass(cfg, after(sale, 10))).queued).toEqual([sale.saleId]);
    expect(await shape(sale.saleId)).toEqual([{ printerId, receiptCopy: false, status: "queued" }]);
  });

  it.each(["queued", "sending", "sent", "unknown"] as const)(
    "prints nothing while an original email is %s",
    async (status) => {
      const { cfg, operatorId, ring } = await till();
      const sale = await ring();
      await delivery(sale.saleId, { medium: "email", status, personId: operatorId });
      expect((await pass(cfg, after(sale, 10))).queued).toEqual([]);
      expect((await pass(cfg, after(sale, 23 * 60))).queued).toEqual([]);
      expect(warnings).toEqual([]);
      expect(await jobsOf(sale.saleId)).toEqual([]);
    },
  );

  it("prints once the device is given a receipt printer, and nothing for a sale over 24 hours old", async () => {
    const { cfg, newPrinter, ring } = await till({ printer: false });
    const sale = await ring();
    expect((await pass(cfg, after(sale, 10))).queued).toEqual([]);
    const printerId = await newPrinter();
    expect((await pass(cfg, after(sale, 24 * 60 + 1))).queued).toEqual([]);
    expect(await jobsOf(sale.saleId)).toEqual([]);
    expect((await pass(cfg, after(sale, 11))).queued).toEqual([sale.saleId]);
    expect(await shape(sale.saleId)).toEqual([{ printerId, receiptCopy: false, status: "queued" }]);
    expect(warnings).toEqual([]);
  });

  it("queues on a switched-off printer, which prints when switched on", async () => {
    const { cfg, printerId, ring } = await till();
    await withTransaction(suite.db, (tx) => updatePrinter(tx, printerId!, { active: false }));
    const sale = await ring();
    expect((await pass(cfg, after(sale, 10))).queued).toEqual([sale.saleId]);
    expect(await shape(sale.saleId)).toEqual([{ printerId, receiptCopy: false, status: "queued" }]);
    await suite.db.insert(printAgents).values({ id: "agent-one", name: "Agent", tokenHash: "x" });
    const claim = () =>
      withTransaction(suite.db, (tx) => claimPrintJobs(tx, "agent-one", { visibleKeys: [] }));
    expect(await claim()).toEqual([]);
    await withTransaction(suite.db, (tx) => updatePrinter(tx, printerId!, { active: true }));
    expect((await claim()).map((job) => job.printer_id)).toEqual([printerId]);
  });

  it("leaves a sale whose original was ended by a deleted printer", async () => {
    const { cfg, printerId, newPrinter, ring, close } = await till();
    const sale = await ring();
    await close(sale.orderId);
    await withTransaction(suite.db, (tx) => deletePrinter(tx, printerId!));
    await newPrinter();
    expect(await owes(sale.saleId)).toBe(true);
    expect((await pass(cfg, after(sale, 11))).queued).toEqual([]);
    expect(warnings).toEqual([]);
    expect(await shape(sale.saleId)).toEqual([{ printerId, receiptCopy: false, status: "failed" }]);
  });

  it("leaves a device whose profile may not print receipts", async () => {
    const { cfg, ring } = await till({
      capabilities: PRINTS.filter((flag) => flag !== "print-receipt"),
    });
    const sale = await ring();
    expect((await pass(cfg, after(sale, 11))).queued).toEqual([]);
    expect(warnings).toEqual([]);
    expect(await jobsOf(sale.saleId)).toEqual([]);
  });

  it("Done and the pass together leave one original", async () => {
    const { cfg, printerId, ring, close } = await till();
    const sale = await ring();
    await Promise.all([close(sale.orderId), pass(cfg, after(sale, 11))]);
    expect(warnings).toEqual([]);
    expect(await shape(sale.saleId)).toEqual([{ printerId, receiptCopy: false, status: "queued" }]);
  });

  it("a full invoice whose A4 page failed prints on the receipt printer, enrolled with no person", async () => {
    const { cfg, deviceId, printerId, operatorId, menuItemId } = await till();
    const orderId = randomUUID();
    const origin = deviceOrigin(deviceId);
    const { saleId } = await withTransaction(suite.db, async (tx) => {
      await tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" });
      const [series] = await tx
        .select()
        .from(invoiceSeries)
        .where(eq(invoiceSeries.purpose, "full"));
      const counter = await tx.execute<{ zone_id: string }>(
        sql`select id as zone_id from floor_zones where is_counter_default`,
      );
      await createOpenOrder(
        tx,
        { ...cfg, origin },
        orderId,
        [{ menuItemId, quantity: "1" }],
        null,
        {
          zoneId: counter.rows[0]!.zone_id,
        },
      );
      return recordSale(tx, backend, {
        operationDescription: "Sale on the premises",
        origin,
        nodeId: cfg.nodeId,
        seriesId: brandSeriesId(series!.id),
        workingOrderId: brandWorkingOrderId(orderId),
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        counterparty: { taxId: "12345678Z", legalName: "Customer", countryCode: "ES" },
        recipientAddress: "Calle Mayor 9, Madrid",
        total: "1.50",
        lines: [
          {
            lineNo: 1,
            name: "Agua mineral",
            descriptions: { "es-ES": "Agua mineral" },
            quantity: "1",
            unitPrice: "1.50",
            vatRate: "21",
            lineTotal: "1.50",
          },
        ],
        clock: systemClock(),
        settlement: { kind: "deferred" },
        operatorId,
      });
    });
    const page = await withTransaction(suite.db, async (tx) =>
      reserveInvoiceDelivery(tx, saleId, {
        medium: "a4",
        pagePrinterId: await insertA4Printer(tx),
        personId: operatorId,
        requestKey: randomUUID(),
      }),
    );
    await suite.db
      .update(invoiceDeliveries)
      .set({ status: "failed", failureCode: "printer_refused" })
      .where(eq(invoiceDeliveries.id, page.id));
    const [sale] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect((await pass(cfg, after({ issuedAt: Date.parse(sale!.issuedAt) }, 11))).queued).toEqual([
      saleId,
    ]);
    const [job] = await suite.db
      .select()
      .from(printJobs)
      .where(and(eq(printJobs.saleId, saleId), eq(printJobs.kind, "document")));
    expect(job).toMatchObject({ printerId, receiptCopy: false, status: "queued" });
    expect(
      await suite.db
        .select({
          medium: invoiceDeliveries.medium,
          designation: invoiceDeliveries.designation,
          status: invoiceDeliveries.status,
          personId: invoiceDeliveries.personId,
        })
        .from(invoiceDeliveries)
        .where(eq(invoiceDeliveries.printJobId, job!.id)),
    ).toEqual([{ medium: "receipt", designation: "original", status: "queued", personId: null }]);
  });

  it("prints the same bytes as the close request", async () => {
    const { cfg, deviceId, ring } = await till();
    const sale = await ring();
    await printSaleReceipt(
      { db: suite.db, backend },
      { ...cfg, origin: deviceOrigin(deviceId) },
      sale.orderId,
      "owed",
    );
    const [asked] = await jobsOf(sale.saleId);
    await suite.db.delete(printJobs).where(eq(printJobs.id, asked!.id));
    expect((await pass(cfg, after(sale, 11))).queued).toEqual([sale.saleId]);
    const [unasked] = await jobsOf(sale.saleId);
    expect(unasked!.id).not.toBe(asked!.id);
    expect(Buffer.from(unasked!.payload!)).toEqual(Buffer.from(asked!.payload!));
  });

  /** The sale's original as the till's close request queued it, given up 11 minutes before `at`. */
  async function givenUp(saleId: string, at: Date) {
    await suite.db
      .update(printJobs)
      .set({ ...GIVEN_UP, claimedAt: new Date(at.getTime() - 11 * 60_000).toISOString() })
      .where(eq(printJobs.saleId, saleId));
  }

  it("leaves a sale under a series a restore retired", async () => {
    const { cfg, ring, close } = await till();
    const sale = await ring();
    const other = await ring();
    await close(other.orderId);
    const at = after(other, 30);
    await givenUp(other.saleId, at);
    await suite.db
      .update(invoiceSeries)
      .set({ retiredAt: new Date(at.getTime() - 60_000) })
      .where(eq(invoiceSeries.id, sale.sale.seriesId));
    expect((await pass(cfg, at)).queued).toEqual([]);
    expect(await jobsOf(sale.saleId)).toEqual([]);
    expect(await startFreshRounds(suite.db, layOut, cfg.nodeId, at, log)).toEqual({
      resent: [],
      nextDueAt: null,
    });
    expect(await jobsOf(other.saleId)).toHaveLength(1);
  });

  it("leaves a sale another node recorded", async () => {
    const { cfg, ring, close } = await till();
    const sale = await ring();
    const other = await ring();
    await close(other.orderId);
    const at = after(other, 30);
    await givenUp(other.saleId, at);
    const elsewhere = brandNodeId(randomUUID());
    expect((await pass({ ...cfg, nodeId: elsewhere }, at)).queued).toEqual([]);
    expect(await jobsOf(sale.saleId)).toEqual([]);
    expect(await startFreshRounds(suite.db, layOut, elsewhere, at, log)).toEqual({
      resent: [],
      nextDueAt: null,
    });
    expect(await jobsOf(other.saleId)).toHaveLength(1);
  });

  /** A copy of `sale` under the next free number, with `values` in place of its own. */
  async function copyOf(
    sale: typeof sales.$inferSelect,
    values: Partial<typeof sales.$inferInsert>,
  ): Promise<string> {
    const [copy] = await suite.db
      .insert(sales)
      .values({ ...sale, id: randomUUID(), invoiceNumber: sale.invoiceNumber + 100, ...values })
      .returning({ id: sales.id });
    return copy!.id;
  }

  it("leaves a sale with no working order", async () => {
    const { cfg, ring } = await till();
    const sale = await ring();
    const loose = await copyOf(sale.sale, { workingOrderId: null });
    expect((await pass(cfg, after(sale, 11))).queued).toEqual([sale.saleId]);
    expect(warnings).toEqual([]);
    expect(await jobsOf(loose)).toEqual([]);
  });

  it.each(["business_day_close", "demo_seed"] as const)("leaves a %s sale", async (source) => {
    const { cfg, ring } = await till();
    const sale = await ring();
    const orderId = randomUUID();
    await withTransaction(suite.db, (tx) =>
      createOpenOrder(tx, { ...cfg, origin: jobOrigin("operator_script") }, orderId, [], null),
    );
    const other = await copyOf(sale.sale, { source, deviceId: null, workingOrderId: orderId });
    expect((await pass(cfg, after(sale, 11))).queued).toEqual([sale.saleId]);
    expect(warnings).toEqual([]);
    expect(await jobsOf(other)).toEqual([]);
  });

  it("resolves a printerless device once for many owed sales", async () => {
    const { cfg, ring } = await till({ printer: false });
    /** The pass's reads, counted as calls on the database, and the write locks it asked for. */
    async function counted(at: Date) {
      let reads = 0;
      let locks = 0;
      const db = new Proxy(suite.db, {
        get(target, key) {
          if (key === "withWriteLock")
            return (fn: () => Promise<unknown>) => {
              locks++;
              return target.withWriteLock(fn);
            };
          const value: unknown = Reflect.get(target, key, target);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            reads++;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
      expect((await pass(cfg, at, { db })).queued).toEqual([]);
      expect(warnings).toEqual([]);
      return { reads, locks };
    }
    const first = await ring();
    const one = await counted(after(first, 11));
    const rung = [first];
    for (let n = 1; n < 20; n++) rung.push(await ring());
    expect(await counted(after(rung.at(-1)!, 11))).toEqual(one);
    expect(one.locks).toBe(0);
  });

  it("says when the next sale falls due", async () => {
    const { cfg, ring } = await till();
    expect(await pass(cfg, new Date())).toEqual({ queued: [], nextDueAt: null });
    const sale = await ring();
    expect(await pass(cfg, after(sale, 3))).toEqual({
      queued: [],
      nextDueAt: after(sale, 10),
    });
    const job = owedReceiptJob({
      db: suite.db,
      layOutSaleReceipt: layOut,
      backend,
      cfg,
      isPrimary: () => true,
      log,
    });
    expect(await job.pass({ now: after(sale, 3), signal: new AbortController().signal })).toEqual({
      nextDueAt: after(sale, 10),
    });
  });

  it("logs a failure and carries on", async () => {
    const { cfg, ring } = await till();
    const failing = await ring();
    const next = await ring();
    const broken = Object.create(backend, {
      filedReceiptFor: {
        value: (tx: Transaction, saleId: string) => {
          if (saleId === failing.saleId) throw new Error("no record");
          return backend.filedReceiptFor(
            tx,
            saleId as Parameters<FiscalBackend["filedReceiptFor"]>[1],
          );
        },
      },
    }) as FiscalBackend;
    const answer = await pass(cfg, after(next, 11), { backend: broken });
    expect(answer.queued).toEqual([next.saleId]);
    expect(warnings).toEqual([
      {
        message: "receipt.owed_ticket_failed",
        params: { saleId: failing.saleId, errorCode: expect.any(String) },
      },
    ]);
    expect(await jobsOf(failing.saleId)).toEqual([]);
    expect(await jobsOf(next.saleId)).toHaveLength(1);
  });
});

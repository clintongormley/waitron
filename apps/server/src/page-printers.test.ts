import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceDeliveries,
  invoiceSeries,
  locations,
  pagePrinters,
  printAgents,
  tenants,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { recordSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import type { TrustedClock } from "@waitron/fiscal";
import type { OfficePrinterReport } from "@waitron/print-agent";
import { jobOrigin, locationId as brandLocation, seriesId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import {
  claimInvoiceDelivery,
  reportInvoiceDelivery,
  reserveInvoiceDelivery,
} from "./invoice-delivery.js";
import {
  disablePagePrinter,
  listPagePrinters,
  registerPagePrinter,
  renamePagePrinter,
  type PagePrinterDiscovery,
} from "./page-printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const NOW = Date.parse("2026-10-12T10:00:00.000Z");
const closed = { now: NOW, discoveryUntil: 0 };
const clock: TrustedClock = {
  now: () => ({
    instant: new Date("2026-10-12T09:00:00.000Z"),
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

const pdfReport: OfficePrinterReport = {
  port: 631,
  resourcePath: "/ipp/print",
  printable: true,
  documentFormat: "application/pdf",
  media: "iso_a4_210x297mm",
  resolutionDpi: 600,
  supportedFormats: ["application/pdf", "image/urf"],
};
const urfReport: OfficePrinterReport = {
  port: 631,
  resourcePath: "/ipp/print",
  printable: true,
  documentFormat: "image/urf",
  media: "na_letter_8.5x11in",
  resolutionDpi: 300,
  supportedFormats: ["image/urf"],
};

async function venue() {
  await seedTenant(suite.db);
  await suite.db.update(tenants).set({ taxpayerDomicile: "Saved domicile" });
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning();
  const nodeId = await seedNode(suite.db, brandLocation(location!.id));
  const agentOne = await agent(location!.id, "Back office agent");
  const agentTwo = await agent(location!.id, "Re-paired agent");
  return { locationId: location!.id, nodeId, agentOne, agentTwo };
}

async function agent(locationId: string, name: string): Promise<string> {
  const [row] = await suite.db
    .insert(printAgents)
    .values({ locationId, name, tokenHash: "scrypt$fixture" })
    .returning({ id: printAgents.id });
  return row!.id;
}

/** Another location, with an agent of its own: an agent registers printers only in its location. */
async function otherLocation(): Promise<{ id: string; agentId: string }> {
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Terrace", invoiceLocales: ["es-ES"], operationDescription: "Sale" })
    .returning({ id: locations.id });
  return { id: location!.id, agentId: await agent(location!.id, "Terrace agent") };
}

function entry(agentId: string, extra: Partial<PagePrinterDiscovery> = {}): PagePrinterDiscovery {
  return { agentId, host: "192.0.2.40", office: pdfReport, lastSeenAt: NOW - 1_000, ...extra };
}

function register(
  locationId: string,
  discovery: PagePrinterDiscovery | undefined,
  window = closed,
) {
  return withTransaction(suite.db, (tx) =>
    registerPagePrinter(tx, locationId, { name: "Back office", entry: discovery }, window),
  );
}

async function printerRows() {
  return suite.db.select().from(pagePrinters).orderBy(pagePrinters.name, pagePrinters.id);
}

async function deliveryRows() {
  return suite.db.select().from(invoiceDeliveries).orderBy(invoiceDeliveries.createdAt);
}

/** A synthetic F1 written through the core, as part 1's delivery suites do. */
async function fullInvoice(nodeId: string): Promise<string> {
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId, code: `F${randomUUID().slice(0, 4)}`, purpose: "full" })
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
  const sale = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, {
      origin: jobOrigin("operator_script"),
      nodeId: nodeId as Parameters<typeof recordSale>[2]["nodeId"],
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
      counterparty: { taxId: "12345678Z", legalName: "Saved customer", countryCode: "ES" },
      recipientAddress: "Saved address",
    }),
  );
  return sale.saleId;
}

/** Reserves an A4 delivery due before the suite's clock, so a claim at `NOW - 5_000` can take it. */
async function reserveA4(saleId: string, pagePrinterId: string) {
  const delivery = await withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, saleId, {
      requestKey: randomUUID(),
      personId: "staff-one",
      medium: "a4",
      pagePrinterId,
    }),
  );
  const due = new Date(NOW - 10_000).toISOString();
  const [dated] = await suite.db
    .update(invoiceDeliveries)
    .set({ createdAt: due, nextAttemptAt: due })
    .where(eq(invoiceDeliveries.id, delivery.id))
    .returning();
  return dated!;
}

describe("registering a page printer from discovery", () => {
  it("adds a printer at the report's IPP queue with its capabilities and the reporting agent", async () => {
    const v = await venue();
    const result = await register(
      v.locationId,
      entry(v.agentOne, { office: { ...pdfReport, port: 8631, resourcePath: "/ipp/office" } }),
    );
    expect(result.outcome).toBe("created");
    expect(await printerRows()).toEqual([
      {
        id: result.id,
        locationId: v.locationId,
        name: "Back office",
        host: "192.0.2.40",
        port: 8631,
        resourcePath: "/ipp/office",
        documentFormat: "application/pdf",
        supportedFormats: ["application/pdf", "image/urf"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 600,
        active: true,
        agentId: v.agentOne,
      },
    ]);
  });

  it("refuses a report that is not printable, or no report at all, and writes nothing", async () => {
    const v = await venue();
    await expect(
      register(
        v.locationId,
        entry(v.agentOne, {
          office: {
            port: 631,
            resourcePath: "/ipp/print",
            printable: false,
            reason: "unsupported_document_format",
            supportedFormats: ["application/postscript"],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "page_printer.not_printable" });
    await expect(
      register(v.locationId, entry(v.agentOne, { office: undefined })),
    ).rejects.toMatchObject({ code: "page_printer.not_printable" });
    expect(await printerRows()).toEqual([]);
  });

  it("refuses an absent or stale discovery entry and writes nothing", async () => {
    const v = await venue();
    await expect(register(v.locationId, undefined)).rejects.toMatchObject({
      code: "page_printer.not_found",
    });
    await expect(
      register(v.locationId, entry(v.agentOne, { lastSeenAt: NOW - 15_001 })),
    ).rejects.toMatchObject({ code: "page_printer.not_found" });
    // While a discovery window is open the list keeps an entry for 45 s, so registration does too.
    const open = { now: NOW, discoveryUntil: NOW + 60_000 };
    await expect(
      register(v.locationId, entry(v.agentOne, { lastSeenAt: NOW - 45_001 }), open),
    ).rejects.toMatchObject({ code: "page_printer.not_found" });
    expect(await printerRows()).toEqual([]);
  });

  it("accepts an entry exactly at the discovered list's bound, with and without a window open", async () => {
    const v = await venue();
    const first = await register(v.locationId, entry(v.agentOne, { lastSeenAt: NOW - 15_000 }));
    const second = await register(
      v.locationId,
      entry(v.agentOne, { host: "192.0.2.41", lastSeenAt: NOW - 45_000 }),
      { now: NOW, discoveryUntil: NOW + 60_000 },
    );
    expect((await printerRows()).map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("re-enables a disabled printer at the same address under its id with fresh capabilities and agent", async () => {
    const v = await venue();
    const { id } = await register(v.locationId, entry(v.agentOne));
    await withTransaction(suite.db, (tx) => disablePagePrinter(tx, v.locationId, id));
    const result = await register(v.locationId, entry(v.agentTwo, { office: urfReport }));
    expect(result).toEqual({ id, outcome: "enabled" });
    expect(await printerRows()).toEqual([
      expect.objectContaining({
        id,
        name: "Back office",
        active: true,
        documentFormat: "image/urf",
        supportedFormats: ["image/urf"],
        media: "na_letter_8.5x11in",
        resolutionDpi: 300,
        agentId: v.agentTwo,
      }),
    ]);
  });

  it("re-points an active printer to a new agent's fresh report, keeping its id and name", async () => {
    const v = await venue();
    const { id } = await register(v.locationId, entry(v.agentOne));
    const result = await withTransaction(suite.db, (tx) =>
      registerPagePrinter(
        tx,
        v.locationId,
        { name: "Another name", entry: entry(v.agentTwo, { office: urfReport }) },
        closed,
      ),
    );
    expect(result).toEqual({ id, outcome: "repointed" });
    expect(await printerRows()).toEqual([
      expect.objectContaining({
        id,
        name: "Back office",
        active: true,
        documentFormat: "image/urf",
        media: "na_letter_8.5x11in",
        resolutionDpi: 300,
        agentId: v.agentTwo,
      }),
    ]);
  });

  it("matches an existing printer's host without regard to case", async () => {
    const v = await venue();
    const { id } = await register(v.locationId, entry(v.agentOne, { host: "HP-Office.local" }));
    const result = await register(v.locationId, entry(v.agentTwo, { host: "hp-office.local" }));
    expect(result).toEqual({ id, outcome: "repointed" });
    expect(await printerRows()).toEqual([
      expect.objectContaining({ id, host: "HP-Office.local", agentId: v.agentTwo }),
    ]);
  });

  it("leaves an active printer untouched when the new agent's entry is stale or absent", async () => {
    const v = await venue();
    await register(v.locationId, entry(v.agentOne));
    const before = await printerRows();
    await expect(
      register(v.locationId, entry(v.agentTwo, { office: urfReport, lastSeenAt: NOW - 15_001 })),
    ).rejects.toMatchObject({ code: "page_printer.not_found" });
    await expect(register(v.locationId, undefined)).rejects.toMatchObject({
      code: "page_printer.not_found",
    });
    expect(await printerRows()).toEqual(before);
  });

  it("adds a separate printer in another location at the same address", async () => {
    const v = await venue();
    const terrace = await otherLocation();
    const here = await register(v.locationId, entry(v.agentOne));
    const there = await register(terrace.id, entry(terrace.agentId));
    expect(there.outcome).toBe("created");
    expect(there.id).not.toBe(here.id);
  });
});

describe("which queue and which agent a registration may name", () => {
  it("adds a printer for each IPP queue on one host: another path, or another port", async () => {
    const v = await venue();
    const first = await register(v.locationId, entry(v.agentOne));
    const otherPath = await register(
      v.locationId,
      entry(v.agentTwo, { office: { ...pdfReport, resourcePath: "/ipp/print2" } }),
    );
    const otherPort = await register(
      v.locationId,
      entry(v.agentTwo, { office: { ...pdfReport, port: 8631 } }),
    );
    expect([first.outcome, otherPath.outcome, otherPort.outcome]).toEqual([
      "created",
      "created",
      "created",
    ]);
    expect(new Set([first.id, otherPath.id, otherPort.id]).size).toBe(3);
    expect((await printerRows()).find((row) => row.id === first.id)).toMatchObject({
      port: 631,
      resourcePath: "/ipp/print",
      agentId: v.agentOne,
    });
  });

  it("refuses an entry from a revoked agent or another location's agent, changing nothing", async () => {
    const v = await venue();
    const terrace = await otherLocation();
    const { id } = await register(v.locationId, entry(v.agentOne));
    await suite.db.update(printAgents).set({ active: false }).where(eq(printAgents.id, v.agentTwo));
    const before = await printerRows();
    for (const agentId of [v.agentTwo, terrace.agentId]) {
      // Re-pointing the existing printer, and adding one at a new address, are both refused.
      for (const host of ["192.0.2.40", "192.0.2.44"]) {
        await expect(register(v.locationId, entry(agentId, { host }))).rejects.toMatchObject({
          code: "page_printer.not_found",
        });
      }
    }
    expect(await printerRows()).toEqual(before);
    await suite.db.update(printAgents).set({ active: true }).where(eq(printAgents.id, v.agentTwo));
    expect(await register(v.locationId, entry(v.agentTwo))).toEqual({ id, outcome: "repointed" });
  });
});

describe("listing and renaming page printers", () => {
  it("lists the location's printers, disabled ones included, with their recorded agent", async () => {
    const v = await venue();
    const terrace = await otherLocation();
    const office = await register(v.locationId, entry(v.agentOne));
    const upstairs = await register(v.locationId, entry(v.agentTwo, { host: "192.0.2.41" }));
    await withTransaction(suite.db, (tx) => disablePagePrinter(tx, v.locationId, upstairs.id));
    await register(terrace.id, entry(terrace.agentId, { host: "192.0.2.42" }));
    const unattached = randomUUID();
    await suite.db.insert(pagePrinters).values({
      id: unattached,
      locationId: v.locationId,
      name: "Imported",
      host: "192.0.2.43",
      port: 631,
      resourcePath: "/ipp/print",
      documentFormat: "application/pdf",
      supportedFormats: ["application/pdf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 300,
      active: false,
    });
    await withTransaction(suite.db, (tx) =>
      renamePagePrinter(tx, v.locationId, upstairs.id, "Upstairs"),
    );
    const listed = await withTransaction(suite.db, (tx) => listPagePrinters(tx, v.locationId));
    expect(listed).toEqual([
      expect.objectContaining({
        id: office.id,
        name: "Back office",
        active: true,
        agentId: v.agentOne,
        agentName: "Back office agent",
      }),
      expect.objectContaining({ id: unattached, name: "Imported", agentId: null, agentName: null }),
      expect.objectContaining({
        id: upstairs.id,
        name: "Upstairs",
        active: false,
        agentId: v.agentTwo,
        agentName: "Re-paired agent",
      }),
    ]);
  });

  it("refuses to rename a printer of another location or an unknown id", async () => {
    const v = await venue();
    const terrace = await otherLocation();
    const there = await register(terrace.id, entry(terrace.agentId));
    const before = await printerRows();
    await expect(
      withTransaction(suite.db, (tx) => renamePagePrinter(tx, v.locationId, there.id, "Mine")),
    ).rejects.toMatchObject({ code: "page_printer.not_found" });
    await expect(
      withTransaction(suite.db, (tx) => renamePagePrinter(tx, v.locationId, randomUUID(), "Mine")),
    ).rejects.toMatchObject({ code: "page_printer.not_found" });
    expect(await printerRows()).toEqual(before);
  });
});

describe("disabling a page printer", () => {
  it("fails its waiting A4 deliveries and leaves a sending one uncertain", async () => {
    const v = await venue();
    const office = await register(v.locationId, entry(v.agentOne));
    const other = await register(v.locationId, entry(v.agentOne, { host: "192.0.2.41" }));
    const queued = await reserveA4(await fullInvoice(v.nodeId), office.id);
    const sending = await reserveA4(await fullInvoice(v.nodeId), office.id);
    const claim = await withTransaction(suite.db, (tx) =>
      claimInvoiceDelivery(tx, sending.id, v.agentOne, new Date(NOW - 5_000)),
    );
    expect(claim).toBeDefined();
    const elsewhere = await reserveA4(await fullInvoice(v.nodeId), other.id);
    const emailSale = await fullInvoice(v.nodeId);
    const emailed = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, emailSale, {
        requestKey: randomUUID(),
        personId: "staff-one",
        medium: "email",
        recipient: "customer@example.test",
      }),
    );
    const before = new Map((await deliveryRows()).map((row) => [row.id, row]));

    await withTransaction(suite.db, (tx) =>
      disablePagePrinter(tx, v.locationId, office.id, new Date(NOW)),
    );

    expect((await printerRows()).find((row) => row.id === office.id)).toMatchObject({
      active: false,
    });
    const after = new Map((await deliveryRows()).map((row) => [row.id, row]));
    expect(after.get(queued.id)).toEqual({
      ...before.get(queued.id),
      status: "failed",
      failureCode: "printer_disabled",
    });
    expect(after.get(sending.id)).toEqual({
      ...before.get(sending.id),
      status: "unknown",
      failureCode: "printer_disabled",
      expiredAt: new Date(NOW).toISOString(),
    });
    expect(after.get(elsewhere.id)).toEqual(before.get(elsewhere.id));
    expect(after.get(emailed.id)).toEqual(before.get(emailed.id));
  });

  it("still accepts a late success from the claim it ended", async () => {
    const v = await venue();
    const office = await register(v.locationId, entry(v.agentOne));
    const sending = await reserveA4(await fullInvoice(v.nodeId), office.id);
    const claim = await withTransaction(suite.db, (tx) =>
      claimInvoiceDelivery(tx, sending.id, v.agentOne, new Date(NOW - 5_000)),
    );
    await withTransaction(suite.db, (tx) =>
      disablePagePrinter(tx, v.locationId, office.id, new Date(NOW)),
    );
    const result = await withTransaction(suite.db, (tx) =>
      reportInvoiceDelivery(tx, claim!, { status: "sent" }, new Date(NOW + 1_000)),
    );
    expect(result).toEqual({ updated: true, historical: false });
    expect((await deliveryRows()).find((row) => row.id === sending.id)).toMatchObject({
      status: "sent",
      failureCode: null,
      reportedOutcome: "sent",
    });
  });

  it("is not undone by re-enabling: the failed delivery stays failed and nothing is queued", async () => {
    const v = await venue();
    const office = await register(v.locationId, entry(v.agentOne));
    const queued = await reserveA4(await fullInvoice(v.nodeId), office.id);
    await withTransaction(suite.db, (tx) => disablePagePrinter(tx, v.locationId, office.id));
    const failed = await deliveryRows();
    const again = await register(v.locationId, entry(v.agentOne));
    expect(again).toEqual({ id: office.id, outcome: "enabled" });
    expect(await deliveryRows()).toEqual(failed);
    expect(failed).toEqual([
      expect.objectContaining({ id: queued.id, status: "failed", failureCode: "printer_disabled" }),
    ]);
  });

  it("refuses a printer of another location or an unknown id and changes nothing", async () => {
    const v = await venue();
    const terrace = await otherLocation();
    const there = await register(terrace.id, entry(terrace.agentId));
    const before = await printerRows();
    await expect(
      withTransaction(suite.db, (tx) => disablePagePrinter(tx, v.locationId, there.id)),
    ).rejects.toMatchObject({ code: "page_printer.not_found" });
    await expect(
      withTransaction(suite.db, (tx) => disablePagePrinter(tx, v.locationId, randomUUID())),
    ).rejects.toMatchObject({ code: "page_printer.not_found" });
    expect(await printerRows()).toEqual(before);
  });
});

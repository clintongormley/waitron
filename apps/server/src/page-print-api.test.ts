import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import {
  a4HoldCodes,
  invoiceDeliveries,
  invoiceSeries,
  locations,
  pagePrinterFormat,
  pagePrinterMedia,
  pagePrinters,
  printAgents,
  sales,
  tenants,
  withTransaction,
} from "@waitron/db";
import { hashSecret } from "@waitron/identity";
import { createClient, PAGE_FORMATS, PAGE_HOLDS, PAGE_MEDIA } from "@waitron/print-agent";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { recordSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import type { TrustedClock } from "@waitron/fiscal";
import {
  jobOrigin,
  locationId as brandLocation,
  nodeId as brandNode,
  seriesId,
} from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import { claimInvoicePagePrint } from "./invoice-page-print.js";
import { readInvoiceDocument } from "./invoice-document.js";
import { registerPagePrinter } from "./page-printers.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { renderInvoiceRaster } from "./invoice-raster.js";
import { encodeInvoiceRaster } from "./invoice-raster-encode.js";
import { mountPrintApi } from "./print-api.js";
import { renderInvoicePage } from "./page-print-api.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";
import { createPairingMode } from "./pairing-mode.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const T0 = Date.parse("2026-10-12T10:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms);
const SECRET = "synthetic-agent-secret";
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

type Render = (
  document: ReceiptDocumentInput,
  format: (typeof pagePrinters.$inferSelect)["documentFormat"],
  resolutionDpi: number,
) => Promise<Buffer>;

type Venue = Awaited<ReturnType<typeof venue>>;

async function venue(opts: { render?: Render; realClock?: true } = {}) {
  await seedTenant(suite.db);
  await suite.db.update(tenants).set({ taxpayerDomicile: "Saved domicile" });
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  const locationId = location!.id;
  const nodeId = await seedNode(suite.db, brandLocation(locationId));
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId, code: "F", purpose: "full" })
    .returning();
  const backend = fiscalSlot(
    enabledModules(ALL_MODULES, venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat")),
    null,
  ).makeBackend({ db: suite.db, clock, environment: "preproduction" });
  const cfg: TillConfig = {
    nodeId: brandNode(nodeId),
    seriesId: seriesId(series!.id),
    locationId: brandLocation(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const agentOne = await agent(locationId, "Back office agent");
  const agentTwo = await agent(locationId, "Re-paired agent");
  const state = { now: at(0), reads: 0 };
  const app = new Hono();
  mountPrintApi(
    app,
    {
      db: suite.db,
      cfg,
      pairingMode: createPairingMode(),
      readMembership: async () => null,
      venueLocale: "es-ES",
      ...(opts.realClock
        ? {}
        : {
            now: () => {
              state.reads++;
              return state.now;
            },
          }),
      readInvoiceDocument: (tx, saleId) => readInvoiceDocument(backend, tx, cfg, saleId),
      ...(opts.render === undefined ? {} : { renderInvoicePage: opts.render }),
    },
    () => {},
  );
  return {
    app,
    state,
    cfg,
    backend,
    locationId,
    nodeId,
    seriesId: series!.id,
    agentOne,
    agentTwo,
    tokenOne: `${agentOne}.${SECRET}`,
    tokenTwo: `${agentTwo}.${SECRET}`,
  };
}

async function agent(locationId: string, name: string): Promise<string> {
  const [row] = await suite.db
    .insert(printAgents)
    .values({ locationId, name, tokenHash: hashSecret(SECRET) })
    .returning({ id: printAgents.id });
  return row!.id;
}

let hostCounter = 20;

async function printer(
  v: Venue,
  agentId: string | null,
  extra: Partial<typeof pagePrinters.$inferInsert> = {},
): Promise<string> {
  const [row] = await suite.db
    .insert(pagePrinters)
    .values({
      locationId: v.locationId,
      name: "Back office",
      host: `192.0.2.${hostCounter++}`,
      port: 631,
      resourcePath: "/ipp/print",
      documentFormat: "application/pdf",
      supportedFormats: ["application/pdf", "image/pwg-raster", "image/urf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 300,
      agentId,
      ...extra,
    })
    .returning({ id: pagePrinters.id });
  return row!.id;
}

/** A synthetic F1 written through the core, as part 1's delivery suites do. */
async function fullInvoice(v: Venue, name = "Coffee"): Promise<string> {
  const sale = await withTransaction(suite.db, (tx) =>
    recordSale(tx, v.backend, {
      origin: jobOrigin("operator_script"),
      nodeId: brandNode(v.nodeId),
      seriesId: seriesId(v.seriesId),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total: "1.00",
      lines: [
        {
          lineNo: 1,
          name,
          descriptions: { "es-ES": name },
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

async function queueA4(saleId: string, pagePrinterId: string, ms = 0): Promise<string> {
  const delivery = await withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, saleId, {
      requestKey: randomUUID(),
      personId: "staff-one",
      medium: "a4",
      pagePrinterId,
    }),
  );
  await suite.db
    .update(invoiceDeliveries)
    .set({ createdAt: at(ms).toISOString(), nextAttemptAt: at(ms).toISOString() })
    .where(eq(invoiceDeliveries.id, delivery.id));
  return delivery.id;
}

async function row(id: string) {
  const [found] = await suite.db
    .select()
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.id, id));
  return found!;
}

type Job = {
  id: string;
  generation: number;
  token: string;
  printer: {
    id: string;
    host: string;
    port: number;
    resourcePath: string;
    documentFormat: string;
    media: string;
    resolutionDpi: number;
  };
};

function post(v: Venue, path: string, bearer: string | undefined, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (bearer !== undefined) headers["authorization"] = `Bearer ${bearer}`;
  return v.app.request(path, {
    method: "POST",
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function claim(v: Venue, token = v.tokenOne): Promise<Job | undefined> {
  const res = await post(v, "/print-api/agent/page-jobs/claim", token);
  if (res.status === 204) return undefined;
  expect(res.status).toBe(200);
  return (await res.json()) as Job;
}

const held = (job: Job) => ({ generation: job.generation, token: job.token });

function fetchDocument(v: Venue, id: string, body: unknown, token = v.tokenOne) {
  return post(v, `/print-api/agent/page-jobs/${id}/document`, token, body);
}

function renew(v: Venue, id: string, body: unknown, token = v.tokenOne) {
  return post(v, `/print-api/agent/page-jobs/${id}/renew`, token, body);
}

function result(v: Venue, id: string, body: unknown, token = v.tokenOne) {
  return post(v, `/print-api/agent/page-jobs/${id}/result`, token, body);
}

async function lost(res: Response) {
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    error: { code: "invoice_delivery.claim_lost", params: {} },
  });
}

async function documentFor(v: Venue, saleId: string, duplicate: boolean) {
  const document = await withTransaction(suite.db, (tx) =>
    readInvoiceDocument(v.backend, tx, v.cfg, saleId),
  );
  return { ...document, duplicate };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const parts: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      for (const item of content.items) if ("str" in item) parts.push(item.str);
    }
    return parts.join(" ");
  } finally {
    await loading.destroy();
  }
}

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Operation exceeded 5 seconds")), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe("agent authentication", () => {
  it("refuses every page-job route without a valid, active agent token and claims nothing", async () => {
    let rendered = 0;
    const v = await venue({
      render: async () => {
        rendered++;
        return Buffer.from("unused");
      },
    });
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    const before = await row(id);
    const claimBody = { generation: 1, token: randomUUID() };
    const [revoked] = await suite.db
      .insert(printAgents)
      .values({
        locationId: v.locationId,
        name: "Revoked",
        tokenHash: hashSecret(SECRET),
        active: false,
      })
      .returning({ id: printAgents.id });

    for (const bearer of [undefined, `${v.agentOne}.wrong-secret`, `${revoked!.id}.${SECRET}`]) {
      for (const [path, body] of [
        ["/print-api/agent/page-jobs/claim", undefined],
        [`/print-api/agent/page-jobs/${id}/document`, claimBody],
        [`/print-api/agent/page-jobs/${id}/renew`, claimBody],
        [`/print-api/agent/page-jobs/${id}/result`, { ...claimBody, status: "sent" }],
      ] as const) {
        const res = await post(v, path, bearer, body);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: { code: "agent.unauthorized", params: {} } });
      }
    }
    expect(await row(id)).toEqual(before);
    expect(rendered).toBe(0);
    expect((await claim(v))?.id).toBe(id);
  });
});

describe("claiming a page job", () => {
  it("answers 204 with nothing due, then hands its own agent one job with the printer's endpoint", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne, {
      host: "192.0.2.40",
      port: 8631,
      resourcePath: "/ipp/office",
      documentFormat: "image/urf",
      media: "na_letter_8.5x11in",
      resolutionDpi: 600,
    });
    const id = await queueA4(await fullInvoice(v), office, 1_000);

    expect(await claim(v)).toBeUndefined();
    v.state.now = at(1_000);
    expect(await claim(v, v.tokenTwo)).toBeUndefined();
    const job = await claim(v);

    expect(job).toEqual({
      id,
      generation: 1,
      token: expect.any(String),
      printer: {
        id: office,
        host: "192.0.2.40",
        port: 8631,
        resourcePath: "/ipp/office",
        documentFormat: "image/urf",
        media: "na_letter_8.5x11in",
        resolutionDpi: 600,
      },
    });
    expect(Object.keys(job!)).not.toContain("saleId");
    expect(await row(id)).toMatchObject({
      status: "sending",
      claimedBy: v.agentOne,
      claimedAt: at(1_000).toISOString(),
    });
    expect(await claim(v)).toBeUndefined();
  });

  it("reads the real time when the server is given no clock", async () => {
    const v = await venue({ realClock: true });
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);

    const job = await claim(v);

    expect(job?.id).toBe(id);
    expect(Date.parse((await row(id)).claimedAt!)).toBeGreaterThan(T0);
  });

  it("fails a due delivery whose printer is disabled and hands out nothing for it", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    await suite.db.update(pagePrinters).set({ active: false }).where(eq(pagePrinters.id, office));

    expect(await claim(v)).toBeUndefined();
    expect(await row(id)).toMatchObject({ status: "failed", failureCode: "printer_disabled" });
  });

  it("gives the second of two queued claims nothing for a printer the first claim made busy", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const first = await queueA4(await fullInvoice(v, "Coffee"), office);
    const second = await queueA4(await fullInvoice(v, "Tea"), office);

    const answers = await Promise.all([claim(v), claim(v)]);

    expect(answers.map((job) => job?.id ?? "nothing").sort()).toEqual([first, "nothing"].sort());
    expect(await row(second)).toMatchObject({ status: "queued", claimTokenHash: null });
  });
});

describe("renewing a page job", () => {
  it("keeps the claim alive past 60 s, and refuses another token, generation or agent", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    const job = (await claim(v))!;

    v.state.now = at(40_000);
    expect((await renew(v, id, held(job))).status).toBe(204);
    v.state.now = at(90_000);
    expect((await renew(v, id, held(job))).status).toBe(204);
    expect(await row(id)).toMatchObject({ status: "sending", claimedAt: at(90_000).toISOString() });
    expect((await fetchDocument(v, id, held(job))).status).toBe(200);

    await lost(await renew(v, id, { ...held(job), token: randomUUID() }));
    await lost(await renew(v, id, { ...held(job), generation: 2 }));
    await lost(await renew(v, id, held(job), v.tokenTwo));
    await lost(await renew(v, randomUUID(), held(job)));
  });

  it("keeps a renewed claim's record when a claim poll runs while the renewal waits to commit", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    const job = (await claim(v))!;
    v.state.now = at(40_000);
    expect((await renew(v, id, held(job))).status).toBe(204);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const writer = withTransaction(suite.db, async () => {
      locked();
      await gate;
    });
    await holding;
    const read = (ms: number) => {
      v.state.now = at(ms);
      const before = v.state.reads;
      return async () => {
        while (v.state.reads === before) await new Promise((resolve) => setImmediate(resolve));
      };
    };
    let renewal: Promise<Response>;
    let poll: Promise<Response>;
    try {
      const renewRead = read(95_000);
      renewal = Promise.resolve(renew(v, id, held(job)));
      await within(renewRead());
      const pollRead = read(101_000);
      poll = Promise.resolve(post(v, "/print-api/agent/page-jobs/claim", v.tokenOne));
      await within(pollRead());
    } finally {
      release();
      await writer;
    }
    expect((await renewal).status).toBe(204);
    expect((await poll).status).toBe(204);
    expect(await row(id)).toMatchObject({ status: "sending", claimedAt: at(95_000).toISOString() });
    expect((await fetchDocument(v, id, held(job))).status).toBe(200);
  });

  it("answers lost once the lease has run out without renewal", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    const job = (await claim(v))!;

    v.state.now = at(60_000);
    await lost(await renew(v, id, held(job)));
    expect(await row(id)).toMatchObject({ status: "unknown", failureCode: "timeout" });
  });

  it("refuses a malformed claim and never reads one from the URL", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    const job = (await claim(v))!;
    const query = `?generation=${job.generation}&token=${job.token}`;

    for (const body of [
      {},
      { generation: "1", token: job.token },
      { generation: 0, token: job.token },
      { generation: 1.5, token: job.token },
      { generation: 1, token: "not-a-uuid" },
    ]) {
      const res = await renew(v, id, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "claim" } },
      });
    }
    for (const step of ["renew", "document"]) {
      const res = await post(v, `/print-api/agent/page-jobs/${id}/${step}${query}`, v.tokenOne);
      expect(res.status).toBe(400);
    }
    const bad = await renew(v, "not-a-uuid", held(job));
    expect(bad.status).toBe(400);
    expect(await row(id)).toMatchObject({ status: "sending", claimedAt: at(0).toISOString() });
  });
});

describe("the hold a renewal reports", () => {
  it("stores a reported hold, and clears it on a renewal with null or no hold", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    const job = (await claim(v))!;

    v.state.now = at(20_000);
    expect((await renew(v, id, { ...held(job), hold: "paper_out" })).status).toBe(204);
    expect(await row(id)).toMatchObject({
      status: "sending",
      claimedAt: at(20_000).toISOString(),
      printerHold: "paper_out",
    });
    v.state.now = at(40_000);
    expect((await renew(v, id, { ...held(job), hold: null })).status).toBe(204);
    expect((await row(id)).printerHold).toBeNull();
    expect((await renew(v, id, { ...held(job), hold: "paper_jam" })).status).toBe(204);
    expect((await row(id)).printerHold).toBe("paper_jam");
    v.state.now = at(60_000);
    expect((await renew(v, id, held(job))).status).toBe(204);
    expect(await row(id)).toMatchObject({
      claimedAt: at(60_000).toISOString(),
      printerHold: null,
    });
  });

  it("refuses a hold outside the list and changes nothing", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    const job = (await claim(v))!;
    v.state.now = at(10_000);
    expect((await renew(v, id, { ...held(job), hold: "paper_out" })).status).toBe(204);

    v.state.now = at(20_000);
    for (const hold of [
      "media-empty",
      "Printer said: out of paper",
      "",
      "PAPER_OUT",
      3,
      false,
      {},
    ]) {
      const res = await renew(v, id, { ...held(job), hold });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "hold" } },
      });
    }
    expect(await row(id)).toMatchObject({
      status: "sending",
      claimedAt: at(10_000).toISOString(),
      printerHold: "paper_out",
    });
  });

  it("keeps the last hold when the job is reported", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    const job = (await claim(v))!;
    v.state.now = at(20_000);
    expect((await renew(v, id, { ...held(job), hold: "paper_out" })).status).toBe(204);

    v.state.now = at(30_000);
    expect((await result(v, id, { ...held(job), status: "sent" })).status).toBe(204);
    expect(await row(id)).toMatchObject({ status: "sent", printerHold: "paper_out" });
  });
});

describe("reporting a page job", () => {
  it("records the outcome, and answers a repeat, agreeing or not, with the same success", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    const job = (await claim(v))!;

    v.state.now = at(5_000);
    expect((await result(v, id, { ...held(job), status: "sent" })).status).toBe(204);
    const done = await row(id);
    expect(done).toMatchObject({ status: "sent", reportedOutcome: "sent" });
    v.state.now = at(6_000);
    expect((await result(v, id, { ...held(job), status: "sent" })).status).toBe(204);
    expect(
      (
        await result(v, id, {
          ...held(job),
          status: "unknown",
          failureCode: "printer_aborted",
        })
      ).status,
    ).toBe(204);
    expect(await row(id)).toEqual(done);
  });

  it("records a failure with its code and answers lost for a claim that matches no row", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    const job = (await claim(v))!;

    await lost(await result(v, id, { ...held(job), token: randomUUID(), status: "sent" }));
    await lost(await result(v, id, { ...held(job), generation: 2, status: "sent" }));
    await lost(await result(v, id, { ...held(job), status: "sent" }, v.tokenTwo));
    expect((await row(id)).status).toBe("sending");

    const failed = await result(v, id, {
      ...held(job),
      status: "failed",
      failureCode: "printer_refused",
    });
    expect(failed.status).toBe(204);
    expect(await row(id)).toMatchObject({
      status: "failed",
      failureCode: "printer_refused",
      reportedOutcome: "failed",
    });
  });

  it("refuses an outcome outside the list, or a failure without a code, and changes nothing", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    const job = (await claim(v))!;

    for (const [outcome, field] of [
      [{ status: "done" }, "status"],
      [{ status: "failed" }, "failureCode"],
      [{ status: "unknown", failureCode: "transport_failed" }, "failureCode"],
      [{ status: "failed", failureCode: "Printer said: paper jam" }, "failureCode"],
      [{ status: "failed", failureCode: "switched" }, "failureCode"],
      [{ status: "failed", failureCode: "printer_disabled" }, "failureCode"],
      [{ status: "unknown", failureCode: "printer_disabled" }, "failureCode"],
      [{ status: "unknown", failureCode: "printer_refused" }, "failureCode"],
      [{ status: "unknown", failureCode: "document_unavailable" }, "failureCode"],
      [{ status: "failed", failureCode: "timeout" }, "failureCode"],
      [{ status: "failed", failureCode: "printer_aborted" }, "failureCode"],
      [{ status: "sent", failureCode: "timeout" }, "failureCode"],
    ] as const) {
      const res = await result(v, id, { ...held(job), ...outcome });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    expect(await row(id)).toMatchObject({ status: "sending", reportedAt: null });
  });

  it.each([
    ["failed", "printer_refused"],
    ["failed", "printer_unreachable"],
    ["failed", "document_unavailable"],
    ["unknown", "printer_aborted"],
    ["unknown", "timeout"],
  ] as const)("records an agent's %s outcome with %s", async (status, failureCode) => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    const job = (await claim(v))!;

    expect((await result(v, id, { ...held(job), status, failureCode })).status).toBe(204);
    expect(await row(id)).toMatchObject({
      reportedOutcome: status,
      reportedFailureCode: failureCode,
      failureCode,
    });
  });

  it("accepts a late success as history after a reclaim, and the new claim is unaffected", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const saleId = await fullInvoice(v);
    const first = await queueA4(saleId, office);
    const old = (await claim(v))!;
    v.state.now = at(61_000);
    await lost(await renew(v, first, held(old)));
    const retry = await queueA4(saleId, office, 61_000);
    const fresh = (await claim(v))!;
    expect(fresh.id).toBe(retry);

    expect((await result(v, first, { ...held(old), status: "sent" })).status).toBe(204);
    expect(await row(first)).toMatchObject({ status: "unknown", reportedOutcome: "sent" });
    expect(await row(retry)).toMatchObject({ status: "sending", reportedOutcome: null });
    expect((await renew(v, retry, held(fresh))).status).toBe(204);
  });
});

describe("the print agent's own client", () => {
  it("accepts exactly the formats and paper the server stores for an office printer", () => {
    expect([...PAGE_FORMATS].sort()).toEqual([...pagePrinterFormat.enumValues].sort());
    expect([...PAGE_MEDIA].sort()).toEqual([...pagePrinterMedia.enumValues].sort());
  });

  it("reports exactly the holds the server stores", () => {
    expect([...PAGE_HOLDS]).toEqual([...a4HoldCodes]);
  });

  it("claims, fetches, renews and reports over these routes, and reads a lost claim as claim_lost", async () => {
    const v = await venue({ render: async () => Buffer.from([1, 2, 3]) });
    const office = await printer(v, v.agentOne, { documentFormat: "image/pwg-raster" });
    const id = await queueA4(await fullInvoice(v), office);
    const agentClient = createClient({
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        v.app.request(String(input), init)) as typeof fetch,
    });
    const url = "http://box.test";

    expect(await agentClient.claimPageJob(url, v.tokenTwo)).toEqual({ ok: true, value: null });
    const claimed = await agentClient.claimPageJob(url, v.tokenOne);
    if (!claimed.ok || claimed.value === null) throw new Error("expected a claim");
    const job = claimed.value;
    expect(job).toEqual({
      id,
      generation: 1,
      token: expect.any(String),
      printer: {
        id: office,
        host: expect.any(String),
        port: 631,
        resourcePath: "/ipp/print",
        documentFormat: "image/pwg-raster",
        media: "iso_a4_210x297mm",
        resolutionDpi: 300,
      },
    });
    expect(await agentClient.fetchPageDocument(url, v.tokenOne, job)).toEqual({
      ok: true,
      value: new Uint8Array([1, 2, 3]),
    });
    expect(await agentClient.renewPageJob(url, v.tokenOne, job, "paper_out")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await row(id)).toMatchObject({ status: "sending", printerHold: "paper_out" });
    expect(
      await agentClient.renewPageJob(url, v.tokenOne, { ...job, generation: 2 }, null),
    ).toEqual({
      ok: false,
      failure: { kind: "claim_lost" },
    });
    expect(
      await agentClient.reportPageJob(url, v.tokenOne, job, {
        status: "failed",
        failureCode: "document_unavailable",
      }),
    ).toEqual({ ok: true, value: undefined });
    expect(await row(id)).toMatchObject({ status: "failed", failureCode: "document_unavailable" });
    expect(await agentClient.reportPageJob(url, v.tokenTwo, job, { status: "sent" })).toEqual({
      ok: false,
      failure: { kind: "claim_lost" },
    });
  });
});

describe("fetching a page job's document", () => {
  it.each([
    ["application/pdf", 300],
    ["image/pwg-raster", 300],
    ["image/urf", 300],
  ] as const)("returns %s bytes the renderer gives for that document", async (format, dpi) => {
    const v = await venue();
    const office = await printer(v, v.agentOne, { documentFormat: format, resolutionDpi: dpi });
    const saleId = await fullInvoice(v);
    const id = await queueA4(saleId, office);
    const job = (await claim(v))!;

    const res = await fetchDocument(v, id, held(job));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(format);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const bytes = Buffer.from(await res.arrayBuffer());
    const document = await documentFor(v, saleId, false);
    const expected =
      format === "application/pdf"
        ? await renderInvoicePdf(document)
        : encodeInvoiceRaster(
            await renderInvoiceRaster(document, dpi),
            format === "image/pwg-raster" ? "pwg" : "apple",
          );
    expect(bytes.equals(expected)).toBe(true);
    if (format === "application/pdf") expect(await pdfText(bytes)).not.toContain("DUPLICADO");
    expect(await row(id)).toMatchObject({ status: "sending" });
  });

  it("marks a duplicate's PDF «duplicado»", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const saleId = await fullInvoice(v);
    const original = await queueA4(saleId, office);
    const first = (await claim(v))!;
    expect((await result(v, original, { ...held(first), status: "sent" })).status).toBe(204);
    const duplicate = await queueA4(saleId, office);
    expect(await row(duplicate)).toMatchObject({ designation: "duplicate" });
    const job = (await claim(v))!;

    const res = await fetchDocument(v, duplicate, held(job));

    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(await renderInvoicePdf(await documentFor(v, saleId, true)))).toBe(true);
    expect(await pdfText(bytes)).toContain("DUPLICADO");
  });

  it("gives a stale, lapsed, reported, historical or unrecorded claim no bytes", async () => {
    let rendered = 0;
    const v = await venue({
      render: async () => {
        rendered++;
        return Buffer.from("bytes");
      },
    });
    const office = await printer(v, v.agentOne);
    const saleId = await fullInvoice(v);
    const first = await queueA4(saleId, office);
    const job = (await claim(v))!;

    await lost(await fetchDocument(v, first, { ...held(job), token: randomUUID() }));
    await lost(await fetchDocument(v, first, { ...held(job), generation: 2 }));
    await lost(await fetchDocument(v, first, held(job), v.tokenTwo));
    v.state.now = at(60_000);
    await lost(await fetchDocument(v, first, held(job)));
    expect(await row(first)).toMatchObject({ status: "unknown" });

    const retry = await queueA4(saleId, office, 60_000);
    const fresh = (await claim(v))!;
    expect(fresh.id).toBe(retry);
    expect((await result(v, first, { ...held(job), status: "sent" })).status).toBe(204);
    await lost(await fetchDocument(v, first, held(job)));
    expect((await fetchDocument(v, retry, held(fresh))).status).toBe(200);
    expect((await result(v, retry, { ...held(fresh), status: "sent" })).status).toBe(204);
    await lost(await fetchDocument(v, retry, held(fresh)));

    const direct = await queueA4(await fullInvoice(v, "Tea"), office, 60_000);
    const { job: unrecorded } = await withTransaction(suite.db, (tx) =>
      claimInvoicePagePrint(tx, v.agentOne, { locationId: v.locationId }, at(60_000)),
    );
    expect(unrecorded?.claim.deliveryId).toBe(direct);
    const { generation, token } = unrecorded!.claim;
    await lost(await fetchDocument(v, direct, { generation, token }));
    expect(rendered).toBe(1);
  });

  it("gives no bytes when the row's claim no longer matches a recorded one", async () => {
    const v = await venue({ render: async () => Buffer.from("bytes") });
    const office = await printer(v, v.agentOne);
    const id = await queueA4(await fullInvoice(v), office);
    const job = (await claim(v))!;
    expect((await fetchDocument(v, id, held(job))).status).toBe(200);

    // Guards against a future writer that claims a row again under a new token or generation.
    const recorded = (await row(id)).claimTokenHash;
    await suite.db
      .update(invoiceDeliveries)
      .set({ claimTokenHash: "another claim" })
      .where(eq(invoiceDeliveries.id, id));
    await lost(await fetchDocument(v, id, held(job)));
    await suite.db
      .update(invoiceDeliveries)
      .set({ claimTokenHash: recorded, generation: 2 })
      .where(eq(invoiceDeliveries.id, id));
    await lost(await fetchDocument(v, id, held(job)));
  });

  it("renders in the claimed format and resolution after a re-point, and the old agent still renews and reports", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne, {
      host: "192.0.2.90",
      resourcePath: "/ipp/print",
      documentFormat: "image/pwg-raster",
      resolutionDpi: 300,
    });
    const saleId = await fullInvoice(v);
    const id = await queueA4(saleId, office);
    const job = (await claim(v))!;
    expect(job.printer).toMatchObject({ documentFormat: "image/pwg-raster", resolutionDpi: 300 });

    const repointed = await withTransaction(suite.db, (tx) =>
      registerPagePrinter(
        tx,
        v.locationId,
        {
          name: "Back office",
          entry: {
            agentId: v.agentTwo,
            host: "192.0.2.90",
            lastSeenAt: T0,
            office: {
              port: 631,
              resourcePath: "/ipp/print",
              printable: true,
              documentFormat: "application/pdf",
              media: "iso_a4_210x297mm",
              resolutionDpi: 600,
              supportedFormats: ["application/pdf"],
            },
          },
        },
        { now: T0 + 1_000, discoveryUntil: 0 },
      ),
    );
    expect(repointed).toEqual({ id: office, outcome: "repointed" });
    expect(
      (await suite.db.select().from(pagePrinters).where(eq(pagePrinters.id, office)))[0],
    ).toMatchObject({ agentId: v.agentTwo, documentFormat: "application/pdf", resolutionDpi: 600 });

    v.state.now = at(2_000);
    const res = await fetchDocument(v, id, held(job));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/pwg-raster");
    const bytes = Buffer.from(await res.arrayBuffer());
    const expected = encodeInvoiceRaster(
      await renderInvoiceRaster(await documentFor(v, saleId, false), 300),
      "pwg",
    );
    expect(bytes.equals(expected)).toBe(true);

    v.state.now = at(30_000);
    expect((await renew(v, id, held(job))).status).toBe(204);
    expect((await result(v, id, { ...held(job), status: "sent" })).status).toBe(204);
    expect((await row(id)).status).toBe("sent");
  });

  it("commits the claim before rendering, renders with no transaction open, and caches nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const rendering = new Promise<void>((resolve) => {
      started = resolve;
    });
    const renders: { format: string; resolutionDpi: number; duplicate: boolean | undefined }[] = [];
    const v = await venue({
      render: async (document, format, resolutionDpi) => {
        renders.push({ format, resolutionDpi, duplicate: document.duplicate });
        started();
        await gate;
        return Buffer.from(`rendered ${renders.length}`);
      },
    });
    const office = await printer(v, v.agentOne, {
      documentFormat: "image/urf",
      resolutionDpi: 600,
    });
    const id = await queueA4(await fullInvoice(v), office);
    const job = (await claim(v))!;

    const fetching = Promise.resolve(fetchDocument(v, id, held(job)));
    try {
      await within(
        Promise.race([
          rendering,
          fetching.then(() => {
            throw new Error("Document answered before rendering");
          }),
        ]),
      );
      expect(await row(id)).toMatchObject({ status: "sending", claimedBy: v.agentOne });
      await within(fullInvoice(v, "Tea"));
      expect(await suite.db.select().from(sales)).toHaveLength(2);
    } finally {
      release();
    }
    const res = await fetching;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("rendered 1");
    expect(await (await fetchDocument(v, id, held(job))).text()).toBe("rendered 2");
    expect(renders).toEqual([
      { format: "image/urf", resolutionDpi: 600, duplicate: false },
      { format: "image/urf", resolutionDpi: 600, duplicate: false },
    ]);
  });
});

describe("rendering a page", () => {
  it("draws a raster only at 300 or 600 dpi", async () => {
    const refusal = /^An invoice raster is drawn at 300 or 600 dpi$/;
    await expect(
      renderInvoicePage(FULL_INVOICE_DOCUMENT_FIXTURE, "image/urf", 450),
    ).rejects.toThrow(refusal);
    await expect(
      renderInvoicePage(FULL_INVOICE_DOCUMENT_FIXTURE, "image/pwg-raster", 150),
    ).rejects.toThrow(refusal);
  });
});

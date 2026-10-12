import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import {
  invoiceDeliveries,
  invoiceSeries,
  locations,
  pagePrinters,
  printAgents,
  tenants,
  withTransaction,
} from "@waitron/db";
import { hashPin, hashSecret, persons, startManagementSession } from "@waitron/identity";
import { createClient } from "@waitron/print-agent";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { recordSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import type { ReceiptQrText, TrustedClock } from "@waitron/fiscal";
import {
  jobOrigin,
  locationId as brandLocation,
  nodeId as brandNode,
  seriesId,
} from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import { readInvoiceDocument } from "./invoice-document.js";
import { mountPrintApi } from "./print-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { createPageTestPages } from "./page-test-pages.js";
import { sampleSale } from "./sample-receipt.js";
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
const QR_TEXT: ReceiptQrText = { caption: "QR tributario:", legend: "VERI*FACTU" };
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

async function venue(opts: { render?: Render } = {}) {
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
    locationId: brandLocation(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const agentOne = await agent(locationId, "Back office agent");
  const agentTwo = await agent(locationId, "Other agent");
  const cookies = await withTransaction(suite.db, async (tx) => {
    const [manager] = await tx
      .insert(persons)
      .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    const [staff] = await tx
      .insert(persons)
      .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
      .returning({ id: persons.id });
    return {
      manager: `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: manager!.id })).token}`,
      staff: `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: staff!.id })).token}`,
    };
  });
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
      receiptQrText: QR_TEXT,
      now: () => {
        state.reads++;
        return state.now;
      },
      readInvoiceDocument: (tx, saleId) => readInvoiceDocument(backend, tx, cfg, saleId),
      ...(opts.render === undefined ? {} : { renderInvoicePage: opts.render }),
    },
    () => {},
  );
  return {
    app,
    state,
    backend,
    locationId,
    nodeId,
    seriesId: series!.id,
    agentOne,
    agentTwo,
    tokenOne: `${agentOne}.${SECRET}`,
    tokenTwo: `${agentTwo}.${SECRET}`,
    cookies,
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

async function queuedInvoice(v: Venue, pagePrinterId: string): Promise<string> {
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
          name: "Coffee",
          descriptions: { "es-ES": "Coffee" },
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
  const delivery = await withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, sale.saleId, {
      requestKey: randomUUID(),
      personId: "staff-one",
      medium: "a4",
      pagePrinterId,
    }),
  );
  await suite.db
    .update(invoiceDeliveries)
    .set({ createdAt: at(-1_000).toISOString(), nextAttemptAt: at(-1_000).toISOString() })
    .where(eq(invoiceDeliveries.id, delivery.id));
  return delivery.id;
}

function call(
  v: Venue,
  method: "GET" | "POST",
  path: string,
  auth: { cookie?: string; bearer?: string },
  body?: unknown,
) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth.cookie !== undefined) headers["cookie"] = auth.cookie;
  if (auth.bearer !== undefined) headers["authorization"] = `Bearer ${auth.bearer}`;
  return v.app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const requestPage = (v: Venue, id: string, cookie = v.cookies.manager) =>
  call(v, "POST", `/management-api/page-printers/${id}/test-page`, { cookie });

async function requested(v: Venue, id: string): Promise<{ id: string; status: string }> {
  const res = await requestPage(v, id);
  expect(res.status).toBe(202);
  return (await res.json()) as { id: string; status: string };
}

async function outcome(v: Venue, id: string, cookie = v.cookies.manager): Promise<unknown> {
  const res = await call(v, "GET", `/management-api/page-printers/${id}/test-page`, { cookie });
  expect(res.status).toBe(200);
  return res.json();
}

type Job = {
  id: string;
  generation: number;
  token: string;
  printer: Record<string, unknown>;
};

async function claim(v: Venue, token = v.tokenOne): Promise<Job | undefined> {
  const res = await call(v, "POST", "/print-api/agent/page-jobs/claim", { bearer: token });
  if (res.status === 204) return undefined;
  expect(res.status).toBe(200);
  return (await res.json()) as Job;
}

const held = (job: Job) => ({ generation: job.generation, token: job.token });

const agentPost = (v: Venue, path: string, body: unknown, token = v.tokenOne) =>
  call(v, "POST", `/print-api/agent/page-jobs/${path}`, { bearer: token }, body);

async function lost(res: Response) {
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    error: { code: "invoice_delivery.claim_lost", params: {} },
  });
}

async function deliveryRows(): Promise<number> {
  return (await suite.db.select({ id: invoiceDeliveries.id }).from(invoiceDeliveries)).length;
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

describe("requesting a test page", () => {
  it("needs printer.manage to request or read one, and a staff refusal queues nothing", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);

    for (const res of [
      await requestPage(v, office, v.cookies.staff),
      await call(v, "GET", `/management-api/page-printers/${office}/test-page`, {
        cookie: v.cookies.staff,
      }),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    }
    expect(await claim(v)).toBeUndefined();
    expect(await outcome(v, office)).toBeNull();

    const page = await requested(v, office);
    expect(page).toEqual({ id: expect.any(String), status: "waiting" });
    expect(await outcome(v, office)).toEqual({ id: page.id, status: "waiting" });
  });

  it("refuses a printer that is disabled, unknown or in another location", async () => {
    const v = await venue();
    const disabled = await printer(v, v.agentOne, { active: false });
    const [elsewhere] = await suite.db
      .insert(locations)
      .values({ name: "Terrace", invoiceLocales: ["es-ES"], operationDescription: "Sale" })
      .returning({ id: locations.id });
    const [foreign] = await suite.db
      .insert(pagePrinters)
      .values({
        locationId: elsewhere!.id,
        name: "Elsewhere",
        host: "192.0.2.250",
        port: 631,
        resourcePath: "/ipp/print",
        documentFormat: "application/pdf",
        supportedFormats: ["application/pdf"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 300,
        agentId: v.agentOne,
      })
      .returning({ id: pagePrinters.id });

    for (const id of [disabled, foreign!.id, randomUUID()]) {
      const res = await requestPage(v, id);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "page_printer.not_found" } });
    }
    expect(await claim(v)).toBeUndefined();
  });

  it("refuses an active printer with no print agent, and queues nothing", async () => {
    const v = await venue();
    const orphan = await printer(v, null);

    const res = await requestPage(v, orphan);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "page_printer.no_agent", params: {} } });
    expect(await outcome(v, orphan)).toBeNull();
    expect(await claim(v)).toBeUndefined();
    expect(await claim(v, v.tokenTwo)).toBeUndefined();
  });

  it("answers a request while one is still out with that same page", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const first = await requested(v, office);

    expect(await requested(v, office)).toEqual(first);
    const job = (await claim(v))!;
    expect(await requested(v, office)).toEqual({ id: first.id, status: "printing" });
    expect(await claim(v)).toBeUndefined();
    expect((await agentPost(v, `${job.id}/result`, { ...held(job), status: "sent" })).status).toBe(
      204,
    );

    const next = await requested(v, office);
    expect(next.id).not.toBe(first.id);
    expect((await claim(v))?.id).toBe(next.id);
  });
});

describe("printing a test page", () => {
  it("hands it to the printer's own agent in the printer's format, renders the sample sale and writes no delivery row", async () => {
    const rendered: { document: ReceiptDocumentInput; format: string; dpi: number }[] = [];
    const v = await venue({
      render: async (document, format, dpi) => {
        rendered.push({ document, format, dpi });
        return Buffer.from([7, 7, 7]);
      },
    });
    const office = await printer(v, v.agentOne, {
      host: "192.0.2.40",
      port: 8631,
      resourcePath: "/ipp/office",
      documentFormat: "image/urf",
      media: "na_letter_8.5x11in",
      resolutionDpi: 600,
    });
    const page = await requested(v, office);

    expect(await claim(v, v.tokenTwo)).toBeUndefined();
    const job = (await claim(v))!;
    expect(job).toEqual({
      id: page.id,
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
    expect(await outcome(v, office)).toEqual({ id: page.id, status: "printing" });
    await lost(await agentPost(v, `${job.id}/document`, held(job), v.tokenTwo));

    const res = await agentPost(v, `${job.id}/document`, held(job));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/urf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([7, 7, 7]));
    expect(rendered).toHaveLength(1);
    expect(rendered[0]!.format).toBe("image/urf");
    expect(rendered[0]!.dpi).toBe(600);
    expect(rendered[0]!.document.surface).toBe("a4");
    expect(rendered[0]!.document.result).toEqual(sampleSale(QR_TEXT));
    expect(rendered[0]!.document.result.invoiceNumber).toBe("MUESTRA/1");

    expect((await agentPost(v, `${job.id}/result`, { ...held(job), status: "sent" })).status).toBe(
      204,
    );
    expect(await outcome(v, office)).toEqual({ id: page.id, status: "sent" });
    expect((await agentPost(v, `${job.id}/result`, { ...held(job), status: "sent" })).status).toBe(
      204,
    );
    await lost(await agentPost(v, `${job.id}/document`, held(job)));
    expect(await deliveryRows()).toBe(0);
  });

  it("prints MUESTRA/1 on a real PDF page", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    await requested(v, office);
    const job = (await claim(v))!;

    const res = await agentPost(v, `${job.id}/document`, held(job));

    expect(res.status).toBe(200);
    expect(await pdfText(new Uint8Array(await res.arrayBuffer()))).toContain("MUESTRA/1");
  });

  it("gives a real queued invoice to the agent before a test page", async () => {
    const v = await venue({ render: async () => Buffer.from("x") });
    const office = await printer(v, v.agentOne);
    const page = await requested(v, office);
    const invoice = await queuedInvoice(v, office);

    const job = (await claim(v))!;
    expect(job.id).toBe(invoice);
    expect((await agentPost(v, `${job.id}/result`, { ...held(job), status: "sent" })).status).toBe(
      204,
    );
    expect((await claim(v))?.id).toBe(page.id);
  });

  it("hands out the agent's oldest waiting page first, and leaves a claimed invoice's routes to the invoice", async () => {
    const v = await venue({ render: async () => Buffer.from("x") });
    const first = await printer(v, v.agentOne);
    const second = await printer(v, v.agentOne);
    const third = await printer(v, v.agentOne);
    const queued = await queuedInvoice(v, first);
    const invoiceJob = (await claim(v))!;
    expect(invoiceJob.id).toBe(queued);

    const oldest = await requested(v, second);
    v.state.now = at(1_000);
    const middle = await requested(v, first);
    v.state.now = at(2_000);
    const newest = await requested(v, third);

    expect((await agentPost(v, `${invoiceJob.id}/renew`, held(invoiceJob))).status).toBe(204);
    expect((await claim(v))?.id).toBe(oldest.id);
    expect((await claim(v))?.id).toBe(newest.id);
    expect(await claim(v)).toBeUndefined();
    expect(
      (await agentPost(v, `${invoiceJob.id}/result`, { ...held(invoiceJob), status: "sent" }))
        .status,
    ).toBe(204);
    expect((await claim(v))?.id).toBe(middle.id);
  });

  it("is claimed only by the agent the printer records, even after a re-point", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const page = await requested(v, office);
    await suite.db
      .update(pagePrinters)
      .set({ agentId: v.agentTwo })
      .where(eq(pagePrinters.id, office));

    expect(await claim(v)).toBeUndefined();
    expect((await claim(v, v.tokenTwo))?.id).toBe(page.id);
  });

  it.each([
    ["failed", "printer_refused"],
    ["failed", "printer_unreachable"],
    ["failed", "document_unavailable"],
    ["unknown", "printer_aborted"],
    ["unknown", "timeout"],
  ] as const)("shows a %s outcome with its code %s", async (status, failureCode) => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const page = await requested(v, office);
    const job = (await claim(v))!;

    expect(
      (await agentPost(v, `${job.id}/result`, { ...held(job), status, failureCode })).status,
    ).toBe(204);
    expect(await outcome(v, office)).toEqual({ id: page.id, status, failureCode });
  });

  it("refuses an outcome an agent may not report, another agent's report or a wrong claim, and changes nothing", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const page = await requested(v, office);
    const job = (await claim(v))!;

    const refused = await agentPost(v, `${job.id}/result`, {
      ...held(job),
      status: "failed",
      failureCode: "printer_disabled",
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "failureCode" } },
    });
    await lost(
      await agentPost(v, `${job.id}/result`, { ...held(job), status: "sent" }, v.tokenTwo),
    );
    await lost(
      await agentPost(v, `${job.id}/result`, { ...held(job), token: randomUUID(), status: "sent" }),
    );
    await lost(
      await agentPost(v, `${job.id}/result`, { ...held(job), generation: 2, status: "sent" }),
    );
    expect(await outcome(v, office)).toEqual({ id: page.id, status: "printing" });
  });
});

describe("one job per office printer, test pages included", () => {
  it("keeps a printer's invoice back while its test page prints, and hands out another printer's", async () => {
    const v = await venue({ render: async () => Buffer.from("x") });
    const x = await printer(v, v.agentOne);
    const y = await printer(v, v.agentOne);
    await requested(v, x);
    const page = (await claim(v))!;
    const onX = await queuedInvoice(v, x);
    const onY = await queuedInvoice(v, y);

    expect((await claim(v))?.id).toBe(onY);
    expect(await claim(v)).toBeUndefined();
    expect(
      (await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, onX)))[0]
        ?.status,
    ).toBe("queued");

    expect(
      (await agentPost(v, `${page.id}/result`, { ...held(page), status: "sent" })).status,
    ).toBe(204);
    expect((await claim(v))?.id).toBe(onX);
  });

  it("keeps a printer's test page waiting while its invoice is out, and hands out another printer's", async () => {
    const v = await venue({ render: async () => Buffer.from("x") });
    const x = await printer(v, v.agentOne);
    const y = await printer(v, v.agentOne);
    const queued = await queuedInvoice(v, x);
    const invoice = (await claim(v))!;
    expect(invoice.id).toBe(queued);
    const onX = await requested(v, x);
    v.state.now = at(1_000);
    const onY = await requested(v, y);

    expect((await claim(v))?.id).toBe(onY.id);
    expect(await claim(v)).toBeUndefined();
    expect(await outcome(v, x)).toEqual({ id: onX.id, status: "waiting" });

    expect(
      (await agentPost(v, `${invoice.id}/result`, { ...held(invoice), status: "sent" })).status,
    ).toBe(204);
    expect((await claim(v))?.id).toBe(onX.id);
  });

  it("hands out one job for a printer to two overlapping claims, when only the later finds its invoice due", async () => {
    const v = await venue({ render: async () => Buffer.from("x") });
    const x = await printer(v, v.agentOne);
    const page = await requested(v, x);
    const onX = await queuedInvoice(v, x);
    await suite.db
      .update(invoiceDeliveries)
      .set({ nextAttemptAt: at(1_000).toISOString() })
      .where(eq(invoiceDeliveries.id, onX));
    // A fresh sighting spares the agent check its own write, which would wait behind the writer.
    await suite.db.update(printAgents).set({ lastSeenAt: new Date().toISOString() });

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
    // Each claim reads the clock just before it waits for the write lock the writer holds.
    const queuedAt = async (ms: number) => {
      v.state.now = at(ms);
      const before = v.state.reads;
      const answer = { job: claim(v) };
      const deadline = Date.now() + 5_000;
      while (v.state.reads === before) {
        if (Date.now() > deadline) throw new Error(`The claim at ${ms} ms never read the clock`);
        await new Promise((resolve) => setImmediate(resolve));
      }
      return answer;
    };
    let early: Promise<Job | undefined>;
    let late: Promise<Job | undefined>;
    try {
      early = (await queuedAt(0)).job;
      late = (await queuedAt(2_000)).job;
    } finally {
      release();
      await writer;
    }
    expect([(await early)?.id, (await late)?.id]).toEqual([page.id, undefined]);
  });

  it("frees a printer whose test page has lapsed on the same call, and hands out its invoice", async () => {
    const v = await venue({ render: async () => Buffer.from("x") });
    const x = await printer(v, v.agentOne);
    const page = await requested(v, x);
    expect((await claim(v))?.id).toBe(page.id);
    const onX = await queuedInvoice(v, x);

    v.state.now = at(59_999);
    expect(await claim(v)).toBeUndefined();
    v.state.now = at(60_000);
    expect((await claim(v))?.id).toBe(onX);
    expect(await outcome(v, x)).toEqual({ id: page.id, status: "unknown", failureCode: "timeout" });
  });
});

describe("a test page's time limits", () => {
  it("keeps a renewed claim past the 60 s lease, and lets an unrenewed one lapse to unknown", async () => {
    const v = await venue({ render: async () => Buffer.from("x") });
    const office = await printer(v, v.agentOne);
    const page = await requested(v, office);
    const job = (await claim(v))!;

    v.state.now = at(50_000);
    expect((await agentPost(v, `${job.id}/renew`, held(job))).status).toBe(204);
    await lost(await agentPost(v, `${job.id}/renew`, { ...held(job), token: randomUUID() }));
    await lost(await agentPost(v, `${job.id}/renew`, held(job), v.tokenTwo));
    v.state.now = at(100_000);
    expect((await agentPost(v, `${job.id}/document`, held(job))).status).toBe(200);
    expect(await outcome(v, office)).toEqual({ id: page.id, status: "printing" });

    v.state.now = at(110_000);
    expect(await outcome(v, office)).toEqual({
      id: page.id,
      status: "unknown",
      failureCode: "timeout",
    });
    await lost(await agentPost(v, `${job.id}/document`, held(job)));
    await lost(await agentPost(v, `${job.id}/renew`, held(job)));
    expect((await agentPost(v, `${job.id}/result`, { ...held(job), status: "sent" })).status).toBe(
      204,
    );
    expect(await outcome(v, office)).toEqual({ id: page.id, status: "sent" });
  });

  it("fails a page no agent took within five minutes, and never hands it out after", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const page = await requested(v, office);

    v.state.now = at(299_999);
    expect(await outcome(v, office)).toEqual({ id: page.id, status: "waiting" });
    v.state.now = at(300_000);
    expect(await claim(v)).toBeUndefined();
    expect(await outcome(v, office)).toEqual({
      id: page.id,
      status: "failed",
      failureCode: "not_claimed",
    });
  });

  it("fails a waiting page whose printer is disabled before it is claimed", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const page = await requested(v, office);
    await suite.db.update(pagePrinters).set({ active: false }).where(eq(pagePrinters.id, office));

    expect(await claim(v)).toBeUndefined();
    expect(await outcome(v, office)).toEqual({
      id: page.id,
      status: "failed",
      failureCode: "printer_disabled",
    });
  });

  it("forgets a finished outcome ten minutes after it finished", async () => {
    const v = await venue();
    const office = await printer(v, v.agentOne);
    const page = await requested(v, office);
    const job = (await claim(v))!;
    v.state.now = at(1_000);
    await agentPost(v, `${job.id}/result`, { ...held(job), status: "sent" });

    v.state.now = at(1_000 + 599_999);
    expect(await outcome(v, office)).toEqual({ id: page.id, status: "sent" });
    v.state.now = at(1_000 + 600_000);
    expect(await outcome(v, office)).toBeNull();
    await lost(await agentPost(v, `${job.id}/result`, { ...held(job), status: "sent" }));
  });
});

describe("a test page the printer is holding", () => {
  it("reads printing with the hold its renewal reports, until a renewal clears it or the page ends", async () => {
    const v = await venue({ render: async () => Buffer.from("x") });
    const office = await printer(v, v.agentOne);
    const page = await requested(v, office);
    const job = (await claim(v))!;

    v.state.now = at(20_000);
    expect(
      (await agentPost(v, `${job.id}/renew`, { ...held(job), hold: "paper_out" })).status,
    ).toBe(204);
    expect(await outcome(v, office)).toEqual({
      id: page.id,
      status: "printing",
      hold: "paper_out",
    });
    v.state.now = at(40_000);
    expect((await agentPost(v, `${job.id}/renew`, held(job))).status).toBe(204);
    expect(await outcome(v, office)).toEqual({ id: page.id, status: "printing" });
    expect(
      (await agentPost(v, `${job.id}/renew`, { ...held(job), hold: "paper_jam" })).status,
    ).toBe(204);

    v.state.now = at(100_000);
    expect(await outcome(v, office)).toEqual({
      id: page.id,
      status: "unknown",
      failureCode: "timeout",
    });
  });

  it("refuses a hold outside the list and keeps the page as it was", async () => {
    const v = await venue({ render: async () => Buffer.from("x") });
    const office = await printer(v, v.agentOne);
    const page = await requested(v, office);
    const job = (await claim(v))!;
    v.state.now = at(20_000);
    await agentPost(v, `${job.id}/renew`, { ...held(job), hold: "paper_out" });

    v.state.now = at(50_000);
    const res = await agentPost(v, `${job.id}/renew`, { ...held(job), hold: "media-empty" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "hold" } },
    });
    expect(await outcome(v, office)).toEqual({
      id: page.id,
      status: "printing",
      hold: "paper_out",
    });
    v.state.now = at(80_000);
    expect(await outcome(v, office)).toMatchObject({ status: "unknown", failureCode: "timeout" });
  });

  it("drops the hold from the view once the page is reported", async () => {
    const v = await venue({ render: async () => Buffer.from("x") });
    const office = await printer(v, v.agentOne);
    const page = await requested(v, office);
    const job = (await claim(v))!;
    v.state.now = at(20_000);
    await agentPost(v, `${job.id}/renew`, { ...held(job), hold: "paper_out" });

    expect((await agentPost(v, `${job.id}/result`, { ...held(job), status: "sent" })).status).toBe(
      204,
    );
    expect(await outcome(v, office)).toEqual({ id: page.id, status: "sent" });
  });

  it("answers a printer's held test page's hold, and null for any other printer or state", () => {
    const state = { now: at(0) };
    const pages = createPageTestPages(() => state.now);
    const printers = ["x", "y"].map((id) => ({
      id,
      active: true,
      agentId: "agent",
      documentFormat: "application/pdf" as const,
      resolutionDpi: 300,
    }));
    expect(pages.holdOn("x")).toBeNull();
    pages.request("x");
    pages.request("y");
    expect(pages.holdOn("x")).toBeNull();
    const onX = pages.claim("agent", printers)!;
    const onY = pages.claim("agent", printers)!;
    const claimOf = (job: typeof onX) => ({
      deliveryId: job.id,
      generation: 1,
      token: job.token,
      holder: "agent",
    });
    expect(onX.pagePrinterId).toBe("x");

    state.now = at(20_000);
    expect(pages.renew(claimOf(onX), "paper_out")).toBe(true);
    expect(pages.renew(claimOf(onY), null)).toBe(true);
    expect(pages.holdOn("x")).toBe("paper_out");
    expect(pages.holdOn("y")).toBeNull();
    expect(pages.holdOn("z")).toBeNull();
    expect(pages.renew({ ...claimOf(onX), token: randomUUID() }, "paper_jam")).toBe(false);
    expect(pages.holdOn("x")).toBe("paper_out");

    expect(pages.report(claimOf(onY), { status: "sent" })).toBe(true);
    state.now = at(80_000);
    expect(pages.holdOn("x")).toBeNull();
    expect(pages.read("x")).toMatchObject({ status: "unknown", failureCode: "timeout" });
  });
});

describe("the print agent's own client", () => {
  it("claims, fetches and reports a test page over the same routes it uses for invoices", async () => {
    const v = await venue({ render: async () => Buffer.from([1, 2, 3]) });
    const office = await printer(v, v.agentOne, { documentFormat: "image/pwg-raster" });
    const page = await requested(v, office);
    const agentClient = createClient({
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        v.app.request(String(input), init)) as typeof fetch,
    });
    const url = "http://box.test";

    const claimed = await agentClient.claimPageJob(url, v.tokenOne);
    if (!claimed.ok || claimed.value === null) throw new Error("expected a claim");
    const job = claimed.value;
    expect(job.id).toBe(page.id);
    expect(await agentClient.fetchPageDocument(url, v.tokenOne, job)).toEqual({
      ok: true,
      value: new Uint8Array([1, 2, 3]),
    });
    expect(await agentClient.renewPageJob(url, v.tokenOne, job, null)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      await agentClient.reportPageJob(url, v.tokenOne, job, {
        status: "failed",
        failureCode: "printer_unreachable",
      }),
    ).toEqual({ ok: true, value: undefined });
    expect(await outcome(v, office)).toEqual({
      id: page.id,
      status: "failed",
      failureCode: "printer_unreachable",
    });
  });
});

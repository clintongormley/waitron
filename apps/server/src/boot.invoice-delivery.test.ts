import { once } from "node:events";
import { createServer as createNetServer, type AddressInfo, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  invoiceDeliveries,
  invoiceSeries,
  locations,
  nodes,
  printJobs,
  setDeploymentMode,
  setSingletonRole,
  stampDeployment,
  tenants,
  withTransaction,
  writeMirrorConfig,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { recordSale } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import { enqueuePrintJob, esc, MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";
import { jobOrigin, locationId, seriesId } from "@waitron/shared";
import { startServer, type StartedServer } from "./boot.js";
import { configureDemoPrinter, DEMO_PRINTER_KEY } from "./demo-printer.js";
import {
  claimInvoiceDelivery,
  reserveInvoiceDelivery,
  reportInvoiceDelivery,
} from "./invoice-delivery.js";
import { claimInvoicePrintJobs } from "./invoice-print.js";
import { writeModuleConfig } from "./module-config.js";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("./demo-printer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./demo-printer.js")>();
  return { ...actual, configureDemoPrinter: vi.fn(actual.configureDemoPrinter) };
});
afterEach(() => vi.mocked(configureDemoPrinter).mockReset());

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const modules = venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat");
let migrationsRoot: string;
let stateDir: string;
beforeAll(async () => {
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-invoice-boot-migrations-"));
  const sets = manifestSets();
  const options = migrationOptionsFor(sets, null);
  for (const [index, set] of sets.entries()) {
    await cp(options[index]!.migrationsFolder, join(migrationsRoot, set.name), { recursive: true });
  }
  stateDir = await mkdtemp(join(tmpdir(), "waitron-invoice-boot-state-"));
  await writeModuleConfig(stateDir, modules);
});
afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});

async function fixture() {
  await seedTenant(suite.db);
  await stampDeployment(suite.db, "preproduction");
  await suite.db.update(tenants).set({ taxpayerDomicile: "Saved issuer address" });
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Bar",
      invoiceLocales: ["es-ES"],
      operationDescription: "Sale on premises",
    })
    .returning();
  const node = await seedNode(suite.db, locationId(location!.id));
  await suite.db.update(nodes).set({ filingModule: "none" }).where(eq(nodes.id, node));
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId: node, code: "F", purpose: "full" })
    .returning();
  const instant = new Date();
  const clock: TrustedClock = {
    now: () => ({
      instant,
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
  const backend = fiscalSlot(enabledModules(ALL_MODULES, modules), null).makeBackend({
    db: suite.db,
    clock,
    environment: "preproduction",
  });
  const sale = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, {
      origin: jobOrigin("operator_script"),
      nodeId: node,
      seriesId: seriesId(series!.id),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total: "1.00",
      clock,
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
      settlement: { kind: "deferred" },
      counterparty: { taxId: "12345678Z", legalName: "Saved customer", countryCode: "ES" },
      recipientAddress: "Saved customer address",
    }),
  );
  const identity = (await configureDemoPrinter(suite.db, location!.id, true))!;
  const { jobId } = await withTransaction(suite.db, (tx) =>
    enqueuePrintJob(
      tx,
      { locationId: location!.id },
      identity.printerId,
      esc().init().bytes(),
      "document",
      { saleId: sale.saleId, receiptCopy: false },
    ),
  );
  const paper = await withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, sale.saleId, {
      medium: "receipt",
      requestKey: randomUUID(),
      personId: null,
      printJobId: jobId,
    }),
  );
  const [job] = await withTransaction(suite.db, (tx) =>
    claimInvoicePrintJobs(
      tx,
      identity.agentId,
      { locationId: location!.id, visibleKeys: [DEMO_PRINTER_KEY] },
      new Date(Date.now() + 1000),
    ),
  );
  expect(job!.invoiceClaim).toBeDefined();
  const { rows: files } = await suite.db.execute<{ name: string; file: string }>(
    sql`pragma database_list`,
  );
  const venueDir = dirname(files.find((file) => file.name === "main")!.file);
  const [port, deadPeerPort] = await freePorts(2);
  const env = {
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_STATE_DIR: stateDir,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_ENV: "preproduction",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_TILL_LOCATION_ID: location!.id,
    WAITRON_TILL_NODE_ID: node,
    WAITRON_TILL_SERIES_ID: series!.id,
    WAITRON_ONBOARDING_INTENT: "demo",
  };
  return {
    paper,
    jobId,
    identity,
    env,
    node,
    deadPeerPort,
    location: location!.id,
    claim: { ...job!.invoiceClaim!, holder: identity.agentId },
  };
}

async function delivery(id: string) {
  return (await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, id)))[0]!;
}

describe("invoice delivery recovery at trading boot", () => {
  it("marks a fresh inherited receipt claim unknown before printing resumes, while ordinary jobs still print", async () => {
    const ctx = await fixture();
    const { jobId: ordinary } = await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(
        tx,
        { locationId: ctx.location },
        ctx.identity.printerId,
        esc().init().bytes(),
        "document",
      ),
    );
    let server: StartedServer | undefined;
    try {
      server = await startServer(ctx.env);
      await vi.waitFor(async () => {
        const response = await fetch(`http://127.0.0.1:${ctx.env.WAITRON_HTTP_PORT}/health`);
        expect(response.status).toBe(200);
      });
      expect(await delivery(ctx.paper.id)).toMatchObject({
        status: "unknown",
        failureCode: "restart",
        attempts: 1,
        reportedAt: null,
      });
      expect((await delivery(ctx.paper.id)).expiredAt).not.toBeNull();
      const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.jobId));
      expect(job).toMatchObject({
        status: "failed",
        attempts: MAX_DELIVERY_ATTEMPTS,
        lastError: "restart",
        receiptHandover: null,
      });
      await vi.waitFor(async () => {
        const [control] = await suite.db.select().from(printJobs).where(eq(printJobs.id, ordinary));
        expect(control!.status).toBe("done");
      });
      expect(await delivery(ctx.paper.id)).toMatchObject({
        status: "unknown",
        designation: "original",
      });
    } finally {
      await server?.close();
    }
  });

  it.each(["sent", "failed"] as const)(
    "recovers a fresh email claim independently of filing and accepts authenticated late %s",
    async (outcome) => {
      const ctx = await fixture();
      await withTransaction(suite.db, (tx) =>
        reportInvoiceDelivery(tx, ctx.claim, { status: "failed", failureCode: "transport_failed" }),
      );
      const email = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, ctx.paper.saleId, {
          medium: "email",
          requestKey: randomUUID(),
          personId: "staff-one",
          recipient: "customer@example.test",
          consent: {
            statementVersion: "invoice-email-v1",
            language: "es-ES",
            recordedAt: new Date().toISOString(),
            personId: "staff-one",
            contactEmail: "venue@example.test",
          },
        }),
      );
      const claim = (await withTransaction(suite.db, (tx) =>
        claimInvoiceDelivery(tx, email.id, "previous-server", new Date(Date.now() + 1000)),
      ))!;
      expect(claim).toBeDefined();
      let server: StartedServer | undefined;
      try {
        server = await startServer(ctx.env);
        await vi.waitFor(async () => {
          const response = await fetch(`http://127.0.0.1:${ctx.env.WAITRON_HTTP_PORT}/health`);
          expect(response.status).toBe(200);
        });
        expect(await delivery(email.id)).toMatchObject({
          status: "unknown",
          failureCode: "restart",
          attempts: 1,
          designation: "original",
          recipient: "customer@example.test",
          consent: email.consent,
        });
        expect(
          await withTransaction(suite.db, (tx) => claimInvoiceDelivery(tx, email.id, "new-server")),
        ).toBeUndefined();
        expect(
          await withTransaction(suite.db, (tx) =>
            reportInvoiceDelivery(
              tx,
              claim,
              outcome === "sent"
                ? { status: "sent" }
                : { status: "failed", failureCode: "transport_failed" },
            ),
          ),
        ).toEqual({ updated: true, historical: false });
        expect(await delivery(email.id)).toMatchObject({
          status: outcome === "sent" ? "sent" : "unknown",
          reportedOutcome: outcome,
          failureCode: outcome === "sent" ? null : "restart",
        });
        expect(await delivery(ctx.paper.id)).toMatchObject({
          status: "failed",
          failureCode: "transport_failed",
        });
      } finally {
        await server?.close();
      }
    },
  );

  it("leaves inherited delivery claims unchanged when the trading node is read-only", async () => {
    const ctx = await fixture();
    await setDeploymentMode(suite.db, ctx.node, "mirror");
    await writeMirrorConfig(suite.db, ctx.node, {
      relayUrl: `http://127.0.0.1:${ctx.deadPeerPort}`,
      boxHostname: "waitron.local",
      boxCaPem: "unused",
      originNodeId: ctx.node,
    });
    const before = await delivery(ctx.paper.id);
    let server: StartedServer | undefined;
    try {
      server = await startServer(ctx.env);
      await vi.waitFor(async () => {
        const response = await fetch(`http://127.0.0.1:${ctx.env.WAITRON_HTTP_PORT}/health`);
        expect(response.status).toBe(503);
      });
      expect(await delivery(ctx.paper.id)).toEqual(before);
      const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.jobId));
      expect(job).toMatchObject({ status: "printing", claimedBy: ctx.identity.agentId });
    } finally {
      await server?.close();
    }
  });
});

async function smtpFixture(hold = false) {
  const sockets = new Set<Socket>();
  const messages: string[] = [];
  let pending: Socket | undefined;
  const listener = createNetServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    socket.write("220 boot-invoice ESMTP\r\n");
    let buffer = "";
    let data: string[] | undefined;
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== undefined) {
          if (line !== ".") {
            data.push(line);
            continue;
          }
          messages.push(data.join("\r\n"));
          data = undefined;
          pending = socket;
          if (!hold) socket.write("250 accepted\r\n");
        } else if (line.startsWith("EHLO") || line.startsWith("HELO")) {
          socket.write("250 boot-invoice\r\n");
        } else if (line === "DATA") {
          data = [];
          socket.write("354 send message\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  return {
    messages,
    accept: () => pending?.write("250 accepted\r\n"),
    smtp: {
      url: `smtp://127.0.0.1:${(listener.address() as AddressInfo).port}`,
      from: "boot-venue@example.test",
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

async function queuedEmail(
  ctx: Awaited<ReturnType<typeof fixture>>,
  smtp: { url: string; from: string },
  duplicate = false,
) {
  await withTransaction(suite.db, (tx) =>
    reportInvoiceDelivery(
      tx,
      ctx.claim,
      duplicate ? { status: "sent" } : { status: "failed", failureCode: "transport_failed" },
    ),
  );
  await withTransaction(suite.db, (tx) =>
    putCredential(tx, loadKeyRing(ctx.env), { purpose: "email.smtp", value: smtp }),
  );
  ctx.env.WAITRON_ONBOARDING_INTENT = "prepare";
  return withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, ctx.paper.saleId, {
      medium: "email",
      requestKey: randomUUID(),
      personId: "staff-one",
      recipient: "saved-customer@example.test",
      consent: {
        statementVersion: "invoice-email-v1",
        language: "es-ES",
        recordedAt: new Date().toISOString(),
        personId: "staff-one",
        contactEmail: "boot-venue@example.test",
      },
    }),
  );
}

async function pdfText(message: string) {
  const part = message.split("Content-Type: application/pdf")[1]!;
  expect(part).toContain("Content-Disposition: attachment");
  const base64 = part.split("\r\n\r\n")[1]!.split("\r\n--")[0]!;
  const loading = getDocument({
    data: Uint8Array.from(Buffer.from(base64.replace(/\s/g, ""), "base64")),
    useSystemFonts: false,
  });
  try {
    const pdf = await loading.promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    return content.items.flatMap((item) => ("str" in item ? [item.str] : [])).join(" ");
  } finally {
    await loading.destroy();
  }
}

describe("invoice email worker at trading boot", () => {
  it("sends a queued duplicate through stored SMTP with the saved invoice facts", async () => {
    const ctx = await fixture();
    const smtp = await smtpFixture();
    let server: StartedServer | undefined;
    try {
      const email = await queuedEmail(ctx, smtp.smtp, true);
      server = await startServer(ctx.env);
      await vi.waitFor(
        async () =>
          expect(await delivery(email.id)).toMatchObject({
            status: "sent",
            designation: "duplicate",
            attempts: 1,
            reportedOutcome: "sent",
          }),
        { timeout: 5_000 },
      );
      expect(smtp.messages).toHaveLength(1);
      expect(smtp.messages[0]).toContain("To: saved-customer@example.test");
      expect(smtp.messages[0]).toContain("From: boot-venue@example.test");
      const text = await pdfText(smtp.messages[0]!);
      for (const saved of [
        "F/1",
        "Saved customer",
        "Saved customer address",
        "Saved issuer address",
        "Café",
        "1,00",
        "DUPLICADO",
      ]) {
        expect(text).toContain(saved);
      }
      expect(await delivery(ctx.paper.id)).toMatchObject({ status: "sent", attempts: 1 });
    } finally {
      await server?.close();
      await smtp.close();
    }
  });

  it("joins a pending SMTP acceptance and records it before normal close returns", async () => {
    const ctx = await fixture();
    const smtp = await smtpFixture(true);
    let server: StartedServer | undefined;
    let closing: Promise<void> | undefined;
    try {
      const email = await queuedEmail(ctx, smtp.smtp);
      server = await startServer(ctx.env);
      await vi.waitFor(() => expect(smtp.messages).toHaveLength(1), { timeout: 5_000 });
      expect(await delivery(email.id)).toMatchObject({ status: "sending", attempts: 1 });
      let closed = false;
      closing = server.close().then(() => {
        closed = true;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(closed).toBe(false);
      smtp.accept();
      await closing;
      expect(await delivery(email.id)).toMatchObject({ status: "sent", reportedOutcome: "sent" });
      expect(smtp.messages).toHaveLength(1);
    } finally {
      smtp.accept();
      await closing;
      await server?.close();
      await smtp.close();
    }
  });

  it("joins the SMTP report when a later startup step fails and stops claiming more email", async () => {
    const ctx = await fixture();
    const smtp = await smtpFixture(true);
    let starting: Promise<unknown> | undefined;
    try {
      const email = await queuedEmail(ctx, smtp.smtp);
      const failure = new Error("later boot step refused");
      vi.mocked(configureDemoPrinter).mockImplementationOnce(async () => {
        await vi.waitFor(() => expect(smtp.messages).toHaveLength(1), { timeout: 5_000 });
        throw failure;
      });
      let settled = false;
      starting = startServer(ctx.env).then(
        async (server) => {
          await server.close();
          settled = true;
          return undefined;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
      await vi.waitFor(() => expect(smtp.messages).toHaveLength(1), { timeout: 5_000 });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(settled).toBe(false);
      smtp.accept();
      expect(await starting).toBe(failure);
      expect(await delivery(email.id)).toMatchObject({ status: "sent", reportedOutcome: "sent" });
      const later = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, email.saleId, {
          medium: "email",
          requestKey: randomUUID(),
          personId: "staff-one",
          recipient: email.recipient!,
          consent: email.consent!,
        }),
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      expect(await delivery(later.id)).toMatchObject({ status: "queued", attempts: 0 });
      expect(smtp.messages).toHaveLength(1);
    } finally {
      smtp.accept();
      await starting;
      await smtp.close();
    }
  });

  it("does not send queued email from a local secondary", async () => {
    const ctx = await fixture();
    const smtp = await smtpFixture();
    let server: StartedServer | undefined;
    try {
      const email = await queuedEmail(ctx, smtp.smtp);
      await setSingletonRole(suite.db, ctx.node, "secondary");
      const before = await delivery(email.id);
      server = await startServer(ctx.env);
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      expect(await delivery(email.id)).toEqual(before);
      expect(smtp.messages).toEqual([]);
    } finally {
      await server?.close();
      await smtp.close();
    }
  });

  it("leaves queued email untouched on a read-only mirror", async () => {
    const ctx = await fixture();
    const smtp = await smtpFixture();
    let server: StartedServer | undefined;
    try {
      const email = await queuedEmail(ctx, smtp.smtp);
      await setDeploymentMode(suite.db, ctx.node, "mirror");
      await writeMirrorConfig(suite.db, ctx.node, {
        relayUrl: `http://127.0.0.1:${ctx.deadPeerPort}`,
        boxHostname: "waitron.local",
        boxCaPem: "unused",
        originNodeId: ctx.node,
      });
      const before = await delivery(email.id);
      server = await startServer(ctx.env);
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      expect(await delivery(email.id)).toEqual(before);
      expect(smtp.messages).toEqual([]);
    } finally {
      await server?.close();
      await smtp.close();
    }
  });
});

import { randomUUID } from "node:crypto";
import jsQR from "jsqr";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { locations, printers, printJobs, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { persons, hashPin, startManagementSession } from "@waitron/identity";
import { readRasterText } from "@waitron/printing";
import { cardReaders, DEMO_READER_ID } from "@waitron/payments";
import { formatEquipmentCode, locationId, nodeId } from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountPrintApi } from "./print-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { opensDrawer, printedCommands } from "./testing/decode-ticket.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let app: Hono;
let cookie: string;
let staffCookie: string;
let target: string;
let reader: string;
let source: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["en-GB"], operationDescription: "Sale" })
    .returning();
  const makePrinter = async (name: string) =>
    (
      await suite.db
        .insert(printers)
        .values({
          name,
          locationId: location!.id,
          transport: "network_tcp",
          host: "10.0.0.9",
          paperWidth: "58mm",
          resolution: "203dpi",
          hasCashDrawer: true,
        })
        .returning()
    )[0]!.id;
  target = await makePrinter("Destination");
  source = await makePrinter("Portable Café");
  reader = (
    await suite.db
      .insert(cardReaders)
      .values({ provider: "sumup", providerRef: randomUUID(), name: "Reader Café" })
      .returning()
  )[0]!.id;
  const login = (role: "manager" | "staff") =>
    withTransaction(suite.db, async (tx) => {
      const [p] = await tx
        .insert(persons)
        .values({ displayName: role, pinHash: hashPin("1234"), role })
        .returning();
      return `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: p!.id })).token}`;
    });
  cookie = await login("manager");
  staffCookie = await login("staff");
  app = new Hono();
  mountPrintApi(
    app,
    {
      db: suite.db,
      cfg: {
        nodeId: nodeId(randomUUID()),
        locationId: locationId(location!.id),
        locale: "en-GB",
        invoiceLocales: ["en-GB"],
        tipsEnabled: false,
        simplifiedInvoiceLimit: null,
      },
      readMembership: async () => null,
      pairingMode: createPairingMode(),
      venueLocale: "en-GB",
      readInvoiceDocument: () => Promise.reject(new Error("No invoice")),
    },
    () => {},
  );
});
const send = (body: unknown, auth: string | null = cookie) =>
  app.request(`/management-api/printers/${target}/equipment-label`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth === null ? {} : { cookie: auth }) },
    body: JSON.stringify(body),
  });

it.each(["printer", "reader"] as const)(
  "queues a %s label as a document with its registered name and code, and no drawer pulse",
  async (kind) => {
    const id = kind === "reader" ? reader : source;
    const response = await send({ kind, id });
    expect(response.status).toBe(202);
    const { jobId } = await response.json();
    const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
    expect(job).toMatchObject({
      printerId: target,
      kind: "document",
      saleId: null,
      receiptCopy: null,
    });
    expect(opensDrawer(job!.payload)).toBe(false);
    const previewResponse = await app.request(`/management-api/print-jobs/${jobId}/preview`, {
      headers: { cookie },
    });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    expect(preview).toMatchObject({
      unsupported: false,
      truncated: false,
      omittedGraphics: false,
      widthDots: 384,
    });
    const qr = preview.blocks.find(
      (block: { kind: string; width: number; height: number }) =>
        block.kind === "image" && block.width === block.height && block.height > 56,
    );
    expect(qr).toBeDefined();
    const pixels = new Uint8ClampedArray(qr.width * qr.height * 4).fill(255),
      bits = Buffer.from(qr.data, "base64"),
      stride = Math.ceil(qr.width / 8);
    for (let y = 0; y < qr.height; y++)
      for (let x = 0; x < qr.width; x++) {
        if (bits[y * stride + (x >> 3)]! & (0x80 >> (x & 7)))
          pixels.fill(0, (y * qr.width + x) * 4, (y * qr.width + x) * 4 + 3);
      }
    expect(jsQR(pixels, qr.width, qr.height)?.data).toBe(formatEquipmentCode(kind, id));
    expect(preview.text.replaceAll(/\s/g, "")).toContain(formatEquipmentCode(kind, id));
    const commands = printedCommands(job!.payload);
    const heading = commands.find((c) => c.name === "GS v 0")!;
    expect(heading.heightDots).toBe(56);
    expect(heading.widthDots).toBe(384);
    const bands = commands.filter((c) => c.name === "GS v 0" && c.heightDots === 56);
    const words = bands
      .map((band) => {
        const bytes = band.bytes.subarray(8),
          packed = new Uint8Array(24 * 28);
        for (let y = 0; y < 28; y++)
          for (let x = 0; x < 192; x++) {
            const ink = bytes[y * 2 * 48 + ((x * 2) >> 3)]! & (0x80 >> ((x * 2) & 7));
            if (ink) packed[y * 24 + (x >> 3)]! |= 0x80 >> (x & 7);
          }
        return readRasterText(192, 28, packed)?.trim();
      })
      .join(" ");
    expect(words).toBe(kind === "reader" ? "Reader Café" : "Portable Café");
  },
);
it.each([null, "staff"])("refuses an unauthorised caller (%s) and queues nothing", async (auth) => {
  const response = await send({ kind: "reader", id: reader }, auth === null ? null : staffCookie);
  expect(response.status).toBe(auth === null ? 401 : 403);
  expect((await response.json()).error.code).toBe(
    auth === null ? "management_session.required" : "authorization.not_permitted",
  );
  expect(await suite.db.select().from(printJobs)).toEqual([]);
});
it.each([
  { kind: null, id: randomUUID() },
  { kind: "drawer", id: randomUUID() },
  { kind: ["reader"], id: randomUUID() },
  { kind: "reader", id: null },
  { kind: "reader", id: "bad" },
])("refuses malformed input %j without queuing", async (body) => {
  const response = await send(body);
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("management.request_invalid");
  expect(await suite.db.select().from(printJobs)).toEqual([]);
});
it.each(["reader", "printer"] as const)("refuses a missing %s label", async (kind) => {
  const response = await send({ kind, id: randomUUID() });
  expect(response.status).toBe(404);
  expect((await response.json()).error.code).toBe(`${kind}.not_found`);
  expect(await suite.db.select().from(printJobs)).toEqual([]);
});
it.each(["inactive", "deleted"])("refuses an %s destination printer", async (state) => {
  await suite.db
    .update(printers)
    .set(state === "inactive" ? { active: false } : { deletedAt: new Date().toISOString() })
    .where(eq(printers.id, target));
  const response = await send({ kind: "reader", id: reader });
  expect(response.status).toBe(404);
  expect((await response.json()).error.code).toBe("printer.not_found");
  expect(await suite.db.select().from(printJobs)).toEqual([]);
});
it.each(["printer", "reader"] as const)("refuses a deleted %s source", async (kind) => {
  if (kind === "printer")
    await suite.db
      .update(printers)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(printers.id, source));
  else
    await suite.db
      .update(cardReaders)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(cardReaders.id, reader));
  const response = await send({ kind, id: kind === "printer" ? source : reader });
  expect(response.status).toBe(404);
  expect((await response.json()).error.code).toBe(`${kind}.not_found`);
  expect(await suite.db.select().from(printJobs)).toEqual([]);
});
it.each(["target", "label"])(
  "prints a venue printer from another location as %s",
  async (which) => {
    const [other] = await suite.db
      .insert(locations)
      .values({ name: "Other", invoiceLocales: ["en-GB"], operationDescription: "Sale" })
      .returning();
    await suite.db
      .update(printers)
      .set({ locationId: other!.id })
      .where(eq(printers.id, which === "target" ? target : source));
    const response = await send({ kind: "printer", id: source });
    expect(response.status).toBe(202);
    const { jobId } = await response.json();
    const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
    expect(job).toMatchObject({ printerId: target, kind: "document" });
    expect(opensDrawer(job!.payload)).toBe(false);
  },
);
it("refuses a demo reader label that the till cannot select", async () => {
  await suite.db
    .insert(cardReaders)
    .values({ id: DEMO_READER_ID, provider: "simulator", providerRef: "demo", name: "Demo" });
  const response = await send({ kind: "reader", id: DEMO_READER_ID });
  expect(response.status).toBe(404);
  expect((await response.json()).error.code).toBe("reader.not_found");
  expect(await suite.db.select().from(printJobs)).toEqual([]);
});

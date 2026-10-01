import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { printers, readTenant, tills, withTransaction } from "@waitron/db";
import { validateReceiptConfig } from "@waitron/layouts";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { isAppError } from "@waitron/shared";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { mountReceiptPreviewApi, type ReceiptPreviewResponse } from "./receipt-preview-api.js";
import type { TillConfig } from "./till-config.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});
let venue: Venue;
let taxId: string;
beforeAll(async () => {
  venue = await setupVenue(suite.db);
  taxId = (await withTransaction(suite.db, (tx) => readTenant(tx)))!.taxId;
});

function app(cfg: Partial<TillConfig> = {}) {
  const app = new Hono();
  mountReceiptPreviewApi(app, { db: suite.db, cfg: { ...venue.cfg, ...cfg } }, () => {});
  return app;
}

async function previewQuery(
  query: string,
  { cookie = venue.managerCookie, cfg = {} }: { cookie?: string; cfg?: Partial<TillConfig> } = {},
): Promise<Response> {
  return app(cfg).request(`/management-api/receipt-preview${query}`, {
    method: "GET",
    headers: { cookie },
  });
}

async function preview(
  body: { receipt?: unknown },
  options: { cookie?: string; cfg?: Partial<TillConfig> } = {},
): Promise<Response> {
  const query =
    "receipt" in body ? `?receipt=${encodeURIComponent(JSON.stringify(body.receipt))}` : "";
  return previewQuery(query, options);
}

async function rendered(receipt: unknown, cfg: Partial<TillConfig> = {}) {
  const response = await preview({ receipt }, { cfg });
  expect(response.status).toBe(200);
  return (await response.json()) as ReceiptPreviewResponse;
}

/** The printed lines of blocks `[start, end)`, read back from their pictures. */
function linesOf(result: ReceiptPreviewResponse, start: number, end: number): string[] {
  return result.preview.blocks
    .slice(start, end)
    .map((block) => (block.kind === "image" ? (block.text ?? "").trim() : ""));
}

function printedLines(result: ReceiptPreviewResponse): string[] {
  return linesOf(result, 0, result.preview.blocks.length);
}

async function withPrinters(
  rows: {
    till: string;
    paperWidth: "58mm" | "80mm";
    resolution: "180dpi" | "203dpi";
    active?: boolean;
  }[],
  fn: () => Promise<void>,
): Promise<void> {
  const created: { tillId: string; printerId: string }[] = [];
  try {
    for (const row of rows) {
      await withTransaction(suite.db, async (tx) => {
        const [printer] = await tx
          .insert(printers)
          .values({
            locationId: venue.cfg.locationId,
            name: `Printer ${row.till}`,
            transport: "network_tcp",
            host: "192.0.2.10",
            paperWidth: row.paperWidth,
            resolution: row.resolution,
            active: row.active ?? true,
          })
          .returning({ id: printers.id });
        const [existing] = await tx
          .select({ id: tills.id })
          .from(tills)
          .where(eq(tills.name, row.till));
        if (existing !== undefined) {
          await tx
            .update(tills)
            .set({ receiptPrinterId: printer!.id })
            .where(eq(tills.id, existing.id));
          created.push({ tillId: existing.id, printerId: printer!.id });
        } else {
          const [till] = await tx
            .insert(tills)
            .values({
              locationId: venue.cfg.locationId,
              name: row.till,
              receiptPrinterId: printer!.id,
            })
            .returning({ id: tills.id });
          created.push({ tillId: till!.id, printerId: printer!.id });
        }
      });
    }
    await fn();
  } finally {
    await suite.db.execute(sql`update tills set receipt_printer_id = null`);
    await suite.db.execute(sql`delete from tills where id <> ${venue.cfg.tillId}`);
    for (const { printerId } of created) {
      await suite.db.execute(sql`delete from printers where id = ${printerId}`);
    }
  }
}

describe("GET /management-api/receipt-preview", () => {
  it("requires a management session, and a manager's configuration permission", async () => {
    expect((await preview({ receipt: {} }, { cookie: "" })).status).toBe(401);
    expect((await preview({ receipt: {} }, { cookie: venue.staffCookie })).status).toBe(403);
  });

  it("refuses an unknown session before it checks the receipt's text, as the save does", async () => {
    const response = await preview(
      { receipt: { footerMessage: 5 } },
      { cookie: `${MANAGEMENT_COOKIE}=${randomUUID()}` },
    );
    expect(response.status).toBe(401);
  });

  it.each([
    ["a request without a receipt", ""],
    ["a receipt that is not JSON", `?receipt=${encodeURIComponent("{headerSubtitle:")}`],
    ["a receipt given twice", "?receipt=%7B%7D&receipt=%7B%7D"],
  ])("refuses %s as the save does", async (_, query) => {
    const response = await previewQuery(query);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "receipt" } },
    });
  });

  it("draws the sample sale with the venue's legal name and tax ID, and the unsaved trim where a receipt prints it", async () => {
    const result = await rendered({
      headerSubtitle: "Calle Mayor 1, Madrid",
      footerMessage: "Gracias por su visita",
    });
    const lines = printedLines(result);
    const name = lines.indexOf("Deli Test SL");
    expect(name).toBeGreaterThanOrEqual(0);
    expect(lines[name + 1]).toBe("Calle Mayor 1, Madrid");
    expect(lines[name + 2]).toBe(`NIF: ${taxId}`);
    expect(lines.some((line) => line.startsWith("1  Café y tostada"))).toBe(true);
    const legend = lines.indexOf("VERI*FACTU");
    expect(lines.slice(legend + 1).filter(Boolean)).toEqual(["Gracias por su visita"]);
    expect(result.preview.text).toContain("5,50 €");
  });

  it("saves nothing and enqueues no print job, even with a receipt printer registered", async () => {
    await withPrinters([{ till: "Caja 1", paperWidth: "80mm", resolution: "203dpi" }], async () => {
      const count = async (table: string) =>
        (
          await suite.db.execute<{ n: number }>(
            sql`select count(*) as n from ${sql.identifier(table)}`,
          )
        ).rows[0]!.n;
      const [jobs, receipts] = [await count("print_jobs"), await count("tenant_receipts")];
      await rendered({ headerSubtitle: "Sin guardar", footerMessage: "Tampoco" });
      expect(await count("print_jobs")).toBe(jobs);
      expect(await count("tenant_receipts")).toBe(receipts);
    });
  });

  it("marks exactly the lines each trim field adds, a wrapped one included", async () => {
    const header = "Una dirección bastante larga que no cabe en una sola línea del papel";
    const result = await rendered({ headerSubtitle: header, footerMessage: "Hasta pronto" });
    const { headerSubtitle, footerMessage } = result.marks;
    expect(headerSubtitle).not.toBeNull();
    expect(headerSubtitle!.end - headerSubtitle!.start).toBe(2);
    expect(linesOf(result, headerSubtitle!.start, headerSubtitle!.end).join(" ")).toBe(header);
    expect(linesOf(result, headerSubtitle!.start - 1, headerSubtitle!.start)).toEqual([
      "Deli Test SL",
    ]);
    expect(linesOf(result, footerMessage!.start, footerMessage!.end)).toEqual(["Hasta pronto"]);
  });

  it("marks nothing for a trim field left out", async () => {
    const result = await rendered({});
    expect(result.marks).toEqual({ headerSubtitle: null, footerMessage: null });
    const lines = printedLines(result);
    expect(lines[lines.indexOf("Deli Test SL") + 1]).toBe(`NIF: ${taxId}`);
  });

  it("is drawn 512 dots wide (80 mm at 180 dpi) when the location has no active receipt printer", async () => {
    await withPrinters(
      [{ till: "Caja 1", paperWidth: "58mm", resolution: "203dpi", active: false }],
      async () => {
        const result = await rendered({});
        expect([result.preview.widthDots, result.preview.columns]).toEqual([512, 42]);
      },
    );
  });

  it("is drawn at the width of the receipt printer of the location's one till that has one", async () => {
    await withPrinters([{ till: "Caja 1", paperWidth: "58mm", resolution: "203dpi" }], async () => {
      const result = await rendered({ headerSubtitle: "Calle Mayor 1" });
      expect([result.preview.widthDots, result.preview.columns]).toEqual([384, 30]);
      for (const block of result.preview.blocks) {
        if (block.kind === "image" && block.text !== undefined) expect(block.width).toBe(384);
      }
    });
  });

  it("takes the receipt printer of the till first by name when several tills have one", async () => {
    await withPrinters(
      [
        { till: "Caja 1", paperWidth: "80mm", resolution: "203dpi" },
        { till: "Barra", paperWidth: "58mm", resolution: "180dpi" },
      ],
      async () => {
        expect((await rendered({})).preview.widthDots).toBe(360);
      },
    );
  });

  it("formats the sample in the location's receipt language", async () => {
    expect((await rendered({}, { locale: "en-GB" })).preview.text).toContain("€5.50");
  });

  it("marks a practice installation's receipt as a practice one, as its printed receipts are", async () => {
    expect((await rendered({}, { practiceMode: true })).preview.text).toContain(
      "PRUEBA - SIN COBRO REAL",
    );
    expect((await rendered({})).preview.text).not.toContain("PRUEBA");
  });

  it.each([
    ["too long a subtitle", { headerSubtitle: "x".repeat(201) }],
    ["too long a footer", { footerMessage: "x".repeat(201) }],
    ["a field that is not text", { footerMessage: 5 }],
    ["a field the receipt does not have", { operationDescription: "Venta" }],
    ["a receipt that is not an object", ["Venta"]],
  ])("refuses %s with the code and params a save would refuse it with", async (_, body) => {
    let saveRefusal: unknown;
    try {
      validateReceiptConfig(body);
    } catch (error) {
      saveRefusal = error;
    }
    expect(isAppError(saveRefusal)).toBe(true);
    const response = await preview({ receipt: body });
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: { code: string; params: unknown } };
    const expected = saveRefusal as { code: string; params: unknown };
    expect(error).toEqual({ code: expected.code, params: expected.params });
  });
});

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  devices,
  locations,
  printers,
  readTenant,
  tenantReceipts,
  withTransaction,
} from "@waitron/db";
import { mediaImages, uploadImage } from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
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
  ask: { receipt?: unknown },
  options: { cookie?: string; cfg?: Partial<TillConfig> } = {},
): Promise<Response> {
  const query =
    "receipt" in ask ? `?receipt=${encodeURIComponent(JSON.stringify(ask.receipt))}` : "";
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

/** The pictures that are not a drawn line of text: the sample QR's. */
function pictures(result: ReceiptPreviewResponse) {
  return result.preview.blocks.filter(
    (block) => block.kind === "image" && block.text === undefined,
  );
}

function printedLines(result: ReceiptPreviewResponse): string[] {
  return linesOf(result, 0, result.preview.blocks.length);
}

function setLocationLanguages(invoiceLocales: string[]): Promise<unknown> {
  return withTransaction(suite.db, (tx) =>
    tx.update(locations).set({ invoiceLocales }).where(eq(locations.id, venue.cfg.locationId)),
  );
}

/** Each row is one device of the location, on its own new receipt printer. */
async function withPrinters(
  rows: {
    device: string;
    paperWidth: "58mm" | "80mm";
    resolution: "180dpi" | "203dpi";
    active?: boolean;
    deviceActive?: boolean;
  }[],
  fn: () => Promise<void>,
): Promise<void> {
  const created: { deviceId: string; printerId: string }[] = [];
  try {
    for (const row of rows) {
      const [printer] = await suite.db
        .insert(printers)
        .values({
          locationId: venue.cfg.locationId,
          name: `Printer ${row.device}`,
          transport: "network_tcp",
          host: "192.0.2.10",
          paperWidth: row.paperWidth,
          resolution: row.resolution,
          active: row.active ?? true,
        })
        .returning({ id: printers.id });
      const { deviceId } = await seedDevice(suite.db, {
        locationId: venue.cfg.locationId,
        label: row.device,
      });
      await suite.db
        .update(devices)
        .set({ receiptPrinterId: printer!.id, active: row.deviceActive ?? true })
        .where(eq(devices.id, deviceId));
      created.push({ deviceId, printerId: printer!.id });
    }
    await fn();
  } finally {
    for (const { deviceId, printerId } of created) {
      await suite.db.execute(sql`delete from devices where id = ${deviceId}`);
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
  ])("refuses %s as the save does", async (_, query) => {
    const response = await previewQuery(query);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "receipt" } },
    });
  });

  it("refuses a receipt given twice with the same code", async () => {
    const response = await previewQuery("?receipt=%7B%7D&receipt=%7B%7D");
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
    expect(lines.slice(name + 2, name + 5)).toEqual([
      "Calle Mayor 1",
      "28013 Madrid",
      `NIF: ${taxId}`,
    ]);
    expect(lines.some((line) => line.startsWith("1  Café y tostada"))).toBe(true);
    const change = lines.findIndex((line) => line.startsWith("Cambio"));
    expect(lines.slice(change + 1).filter(Boolean)).toEqual(["Gracias por su visita"]);
    expect(result.preview.text).toContain("5,50 €");
  });

  it("previews a department's enabled trading name before the legal issuer without saving", async () => {
    const [{ id, trading_name: originalName }] = (
      await suite.db.execute<{ id: string; trading_name: string }>(
        sql`select id, trading_name from departments where location_id = ${venue.cfg.locationId} limit 1`,
      )
    ).rows;
    await suite.db.execute(
      sql`update departments set trading_name = 'Deli Counter' where id = ${id}`,
    );
    try {
      const response = await previewQuery(`?receipt=%7B%7D&departmentId=${encodeURIComponent(id)}`);
      expect(response.status).toBe(200);
      const lines = printedLines((await response.json()) as ReceiptPreviewResponse);
      expect(lines.indexOf("Deli Counter")).toBeGreaterThanOrEqual(0);
      expect(lines.indexOf("Deli Counter")).toBeLessThan(lines.indexOf("Deli Test SL"));
    } finally {
      await suite.db.execute(
        sql`update departments set trading_name = ${originalName} where id = ${id}`,
      );
    }
  });

  it("refuses malformed and unknown department choices", async () => {
    const malformed = await previewQuery("?receipt=%7B%7D&departmentId=not-a-uuid");
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("shared.invalid_id");

    const unknown = await previewQuery(
      "?receipt=%7B%7D&departmentId=aa000000-0000-4000-8000-000000000001",
    );
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe("department.not_found");

    const repeated = await previewQuery(
      "?receipt=%7B%7D&departmentId=aa000000-0000-4000-8000-000000000001&departmentId=aa000000-0000-4000-8000-000000000001",
    );
    expect(repeated.status).toBe(400);
    expect((await repeated.json()).error).toEqual({
      code: "management.request_invalid",
      params: { field: "departmentId" },
    });
  });

  it("saves nothing and enqueues no print job, even with a receipt printer registered", async () => {
    await withPrinters(
      [{ device: "Caja 1", paperWidth: "80mm", resolution: "203dpi" }],
      async () => {
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
      },
    );
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

  it("marks nothing for a trim field left out, and the location's address, which prints unless switched off", async () => {
    const result = await rendered({});
    const lines = printedLines(result);
    const name = lines.indexOf("Deli Test SL");
    expect(result.marks).toEqual({
      headerSubtitle: null,
      footerMessage: null,
      phone: null,
      email: null,
      address: { start: name + 1, end: name + 3 },
      logo: null,
    });
    expect(lines.slice(name + 1, name + 4)).toEqual([
      "Calle Mayor 1",
      "28013 Madrid",
      `NIF: ${taxId}`,
    ]);
  });

  it("is drawn 512 dots wide (80 mm at 180 dpi) when the location has no active receipt printer", async () => {
    await withPrinters(
      [{ device: "Caja 1", paperWidth: "58mm", resolution: "203dpi", active: false }],
      async () => {
        const result = await rendered({});
        expect([result.preview.widthDots, result.preview.columns]).toEqual([512, 42]);
      },
    );
  });

  it("is drawn at the width of the receipt printer of the location's one device that has one", async () => {
    await withPrinters(
      [{ device: "Caja 1", paperWidth: "58mm", resolution: "203dpi" }],
      async () => {
        const result = await rendered({ headerSubtitle: "Calle Mayor 1" });
        expect([result.preview.widthDots, result.preview.columns]).toEqual([384, 30]);
        for (const block of result.preview.blocks) {
          if (block.kind === "image" && block.text !== undefined) expect(block.width).toBe(384);
        }
      },
    );
  });

  it("takes the receipt printer of the device first by name when two devices' paper widths tie", async () => {
    await withPrinters(
      [
        { device: "Caja 1", paperWidth: "80mm", resolution: "203dpi" },
        { device: "Barra", paperWidth: "58mm", resolution: "180dpi" },
      ],
      async () => {
        expect((await rendered({})).preview.widthDots).toBe(360);
      },
    );
  });

  describe("paper widths", () => {
    const at = (query: string) =>
      previewQuery(`?receipt=${encodeURIComponent("{}")}${query}`).then(async (response) => {
        expect(response.status).toBe(200);
        return (await response.json()) as ReceiptPreviewResponse;
      });

    it("offers each width the location's receipt printers have, narrowest first, and draws at the one most devices use", async () => {
      await withPrinters(
        [
          { device: "Barra", paperWidth: "58mm", resolution: "180dpi" },
          { device: "Caja 1", paperWidth: "80mm", resolution: "203dpi" },
          { device: "Caja 2", paperWidth: "80mm", resolution: "203dpi" },
        ],
        async () => {
          const result = await at("");
          expect([result.paperWidths, result.paperWidth]).toEqual([["58mm", "80mm"], "80mm"]);
          expect([result.preview.widthDots, result.preview.columns]).toEqual([576, 42]);
        },
      );
    });

    it("counts a printer two devices share once for each device", async () => {
      await withPrinters(
        [
          { device: "Barra", paperWidth: "58mm", resolution: "180dpi" },
          { device: "Caja 1", paperWidth: "80mm", resolution: "203dpi" },
        ],
        async () => {
          const [shared] = await suite.db
            .select({ printerId: devices.receiptPrinterId })
            .from(devices)
            .where(eq(devices.label, "Caja 1"));
          const { deviceId } = await seedDevice(suite.db, {
            locationId: venue.cfg.locationId,
            label: "Caja 2",
          });
          try {
            await suite.db
              .update(devices)
              .set({ receiptPrinterId: shared!.printerId })
              .where(eq(devices.id, deviceId));
            expect((await at("")).paperWidth).toBe("80mm");
          } finally {
            await suite.db.execute(sql`delete from devices where id = ${deviceId}`);
          }
        },
      );
    });

    it("leaves out the receipt printer of a device that is no longer active", async () => {
      await withPrinters(
        [
          { device: "Barra", paperWidth: "58mm", resolution: "180dpi", deviceActive: false },
          { device: "Caja 1", paperWidth: "80mm", resolution: "203dpi" },
        ],
        async () => {
          const result = await at("");
          expect([result.paperWidths, result.paperWidth]).toEqual([["80mm"], "80mm"]);
        },
      );
    });

    it("reads each device's receipt printer, not every printer at the location", async () => {
      await withPrinters(
        [{ device: "Caja 1", paperWidth: "80mm", resolution: "203dpi" }],
        async () => {
          const [unusedPrinter] = await suite.db
            .insert(printers)
            .values({
              locationId: venue.cfg.locationId,
              name: "Printer no device uses",
              transport: "network_tcp",
              host: "192.0.2.11",
              paperWidth: "58mm",
              resolution: "180dpi",
            })
            .returning({ id: printers.id });
          try {
            const result = await at("");
            expect([result.paperWidths, result.paperWidth]).toEqual([["80mm"], "80mm"]);
          } finally {
            await suite.db.execute(sql`delete from printers where id = ${unusedPrinter!.id}`);
          }
        },
      );
    });

    it("draws at the width asked for, at the resolution of that width's printer", async () => {
      await withPrinters(
        [
          { device: "Barra", paperWidth: "58mm", resolution: "180dpi" },
          { device: "Caja 1", paperWidth: "80mm", resolution: "203dpi" },
          { device: "Caja 2", paperWidth: "80mm", resolution: "203dpi" },
        ],
        async () => {
          const result = await at("&paperWidth=58mm");
          expect(result.paperWidth).toBe("58mm");
          expect([result.preview.widthDots, result.preview.columns]).toEqual([360, 30]);
        },
      );
    });

    it("breaks a tie between widths by the device first by name, and says which width it drew", async () => {
      await withPrinters(
        [
          { device: "Caja 1", paperWidth: "80mm", resolution: "203dpi" },
          { device: "Barra", paperWidth: "58mm", resolution: "180dpi" },
        ],
        async () => {
          const result = await at("");
          expect([result.paperWidths, result.paperWidth]).toEqual([["58mm", "80mm"], "58mm"]);
        },
      );
    });

    it("takes a width's resolution from the device first by name with that width", async () => {
      await withPrinters(
        [
          { device: "Barra", paperWidth: "80mm", resolution: "180dpi" },
          { device: "Caja 1", paperWidth: "80mm", resolution: "203dpi" },
          { device: "Caja 2", paperWidth: "58mm", resolution: "203dpi" },
        ],
        async () => {
          const result = await at("&paperWidth=80mm");
          expect(result.paperWidths).toEqual(["58mm", "80mm"]);
          expect(result.preview.widthDots).toBe(512);
          expect((await at("")).preview.widthDots).toBe(512);
        },
      );
    });

    it("offers one width when every receipt printer has it", async () => {
      await withPrinters(
        [{ device: "Caja 1", paperWidth: "58mm", resolution: "203dpi" }],
        async () => {
          const result = await at("");
          expect([result.paperWidths, result.paperWidth]).toEqual([["58mm"], "58mm"]);
        },
      );
    });

    it("offers no width, and draws at 80 mm, when the location has no receipt printer", async () => {
      const result = await at("");
      expect([result.paperWidths, result.paperWidth]).toEqual([[], "80mm"]);
    });

    it("leaves an inactive printer's width out", async () => {
      await withPrinters(
        [
          { device: "Barra", paperWidth: "58mm", resolution: "203dpi", active: false },
          { device: "Caja 1", paperWidth: "80mm", resolution: "203dpi" },
        ],
        async () => {
          const result = await at("");
          expect([result.paperWidths, result.paperWidth]).toEqual([["80mm"], "80mm"]);
        },
      );
    });

    it("draws as if no width were asked for, and says which width it drew, when asked for a width no receipt printer has any more", async () => {
      await withPrinters(
        [{ device: "Caja 1", paperWidth: "58mm", resolution: "203dpi" }],
        async () => {
          const result = await at("&paperWidth=80mm");
          expect(result.paperWidth).toBe("58mm");
          expect([result.preview.widthDots, result.preview.columns]).toEqual([384, 30]);
        },
      );
    });

    it.each([
      ["a width that is not a paper width", "&paperWidth=99mm"],
      ["an empty width", "&paperWidth="],
      ["a width given twice", "&paperWidth=58mm&paperWidth=58mm"],
    ])("refuses %s", async (_, query) => {
      const response = await previewQuery(`?receipt=${encodeURIComponent("{}")}${query}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "paperWidth" } },
      });
    });
  });

  it("formats the sample in the location's receipt language", async () => {
    // `cfg.locale` stays the fixture's `es-ES`, which would print «5,50 €». Restored in `finally`, as
    // the location is shared.
    await setLocationLanguages(["en-GB"]);
    try {
      expect((await rendered({})).preview.text).toContain("€5.50");
    } finally {
      await setLocationLanguages(["es-ES"]);
    }
  });

  describe("language", () => {
    const at = async (query: string) => {
      const response = await previewQuery(`?receipt=${encodeURIComponent("{}")}${query}`);
      expect(response.status).toBe(200);
      return printedLines((await response.json()) as ReceiptPreviewResponse);
    };
    const labelled = (lines: string[], label: string) =>
      lines.some((line) => line === label || line.startsWith(`${label} `));

    it("draws the sample in a language asked for, whatever the location has saved", async () => {
      const lines = await at("&language=gl-ES");
      expect(labelled(lines, "Data")).toBe(true);
      expect(lines.some((line) => line.startsWith("IVE "))).toBe(true);
      expect(labelled(lines, "Fecha")).toBe(false);
    });

    it("follows the location's saved language when none is asked for", async () => {
      await setLocationLanguages(["gl-ES"]);
      try {
        const lines = await at("");
        expect(labelled(lines, "Data")).toBe(true);
        expect(lines.some((line) => line.startsWith("IVE "))).toBe(true);
      } finally {
        await setLocationLanguages(["es-ES"]);
      }
      expect(labelled(await at(""), "Fecha")).toBe(true);
    });

    it("draws in one transaction", async () => {
      let opened = 0;
      const counting = new Proxy(suite.db, {
        get(target, key) {
          if (key === "withWriteLock")
            return (fn: Parameters<typeof target.withWriteLock>[0]) => {
              opened += 1;
              return target.withWriteLock(fn);
            };
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? (value as () => unknown).bind(target) : value;
        },
      });
      const counted = new Hono();
      mountReceiptPreviewApi(counted, { db: counting, cfg: venue.cfg }, () => {});
      const response = await counted.request(
        `/management-api/receipt-preview?receipt=${encodeURIComponent("{}")}&language=gl-ES`,
        { headers: { cookie: venue.managerCookie } },
      );
      expect([response.status, opened]).toEqual([200, 1]);
    });

    it.each([
      ["a language the pack does not offer", "&language=en-GB"],
      ["an empty language", "&language="],
      ["a language given twice", "&language=gl-ES&language=gl-ES"],
    ])("refuses %s", async (_, query) => {
      const response = await previewQuery(`?receipt=${encodeURIComponent("{}")}${query}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "language" } },
      });
    });
  });

  it("draws the sample QR with the venue fiscal backend's words around it", async () => {
    const withWords = new Hono();
    mountReceiptPreviewApi(
      withWords,
      { db: suite.db, cfg: venue.cfg, receiptQrText: { caption: "CAP-X", legend: "LEG-Y" } },
      () => {},
    );
    const response = await withWords.request(
      `/management-api/receipt-preview?receipt=${encodeURIComponent("{}")}`,
      { method: "GET", headers: { cookie: venue.managerCookie } },
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as ReceiptPreviewResponse;
    expect(pictures(result)).toHaveLength(1);
    const lines = printedLines(result);
    expect(lines.indexOf("CAP-X")).toBeGreaterThanOrEqual(0);
    expect(lines.indexOf("LEG-Y")).toBeGreaterThan(lines.indexOf("CAP-X"));
    expect(lines.indexOf("LEG-Y")).toBeLessThan(lines.indexOf("Deli Test SL"));
  });

  it("draws no QR, caption or legend for a venue whose fiscal backend gives no words", async () => {
    const result = await rendered({});
    expect(pictures(result)).toEqual([]);
    expect(result.preview.text).not.toContain("VERI*FACTU");
    expect(result.preview.text).not.toContain("QR tributario");
    expect(printedLines(result)).toContain("Deli Test SL");
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

describe("the receipt preview's top block", () => {
  afterEach(async () => {
    await suite.db.delete(tenantReceipts);
    await suite.db.delete(mediaImages);
  });

  async function libraryImage(width: number): Promise<string> {
    const image = await samplePreparedImage({ width, height: 12, format: "png" });
    const { image: stored } = await withTransaction(suite.db, (tx) =>
      uploadImage(tx, { image, names: { es: "Logo" } }),
    );
    return stored.filename;
  }

  async function spoilImageBytes(filename: string): Promise<void> {
    await suite.db.execute(
      sql`update media_image_data set bytes = ${Buffer.from([1, 2, 3])}
          where image_id = (select id from media_images where filename = ${filename})`,
    );
  }

  const sizes = (result: ReceiptPreviewResponse) =>
    pictures(result).map((block) => (block.kind === "image" ? [block.width, block.height] : []));

  it("draws the location's address, the phone and the email under the slogan, and marks each", async () => {
    const result = await rendered({
      headerSubtitle: "Desde 1990",
      phone: "910 000 000",
      email: "hola@deli.test",
    });
    const lines = printedLines(result);
    const name = lines.indexOf("Deli Test SL");
    expect(lines.slice(name, name + 7)).toEqual([
      "Deli Test SL",
      "Desde 1990",
      "Calle Mayor 1",
      "28013 Madrid",
      "Tel. 910 000 000",
      "hola@deli.test",
      `NIF: ${taxId}`,
    ]);
    const { address, phone, email, logo } = result.marks;
    expect(linesOf(result, address!.start, address!.end)).toEqual([
      "Calle Mayor 1",
      "28013 Madrid",
    ]);
    expect(linesOf(result, phone!.start, phone!.end)).toEqual(["Tel. 910 000 000"]);
    expect(linesOf(result, email!.start, email!.end)).toEqual(["hola@deli.test"]);
    expect(logo).toBeNull();
  });

  it("draws no address, and marks none, when the receipt switches it off", async () => {
    const result = await rendered({ printAddress: false });
    const lines = printedLines(result);
    expect(lines[lines.indexOf("Deli Test SL") + 1]).toBe(`NIF: ${taxId}`);
    expect(result.marks).toEqual({
      headerSubtitle: null,
      footerMessage: null,
      phone: null,
      email: null,
      address: null,
      logo: null,
    });
  });

  it("draws a library logo fitted to the paper above the venue's name, and marks it", async () => {
    const logo = await libraryImage(40);
    const result = await rendered({ logo });
    // 40 × 12 fitted inside 504 × 160 on the default 80 mm paper.
    expect(sizes(result)).toEqual([[504, 151]]);
    const mark = result.marks.logo!;
    expect(mark.end - mark.start).toBe(1);
    expect(result.preview.blocks[mark.start]).toMatchObject({ kind: "image", width: 504 });
    expect(linesOf(result, mark.end, mark.end + 1)).toEqual(["Deli Test SL"]);
  });

  it("draws the saved picture when the logo is the saved one", async () => {
    const logo = await libraryImage(41);
    const raster = {
      widthDots: 16,
      heightDots: 2,
      data: Buffer.from([1, 2, 3, 4]).toString("base64"),
    };
    await suite.db
      .insert(tenantReceipts)
      .values({ receipt: { logo, logoRasters: { "58mm": raster, "80mm": raster } } });
    expect(sizes(await rendered({ logo }))).toEqual([[16, 2]]);
  });

  it("draws a library logo once, and from then on without reading the image", async () => {
    const logo = await libraryImage(42);
    const mounted = app();
    const draw = async () => {
      const response = await mounted.request(
        `/management-api/receipt-preview?receipt=${encodeURIComponent(JSON.stringify({ logo }))}`,
        { headers: { cookie: venue.managerCookie } },
      );
      expect(response.status).toBe(200);
      return (await response.json()) as ReceiptPreviewResponse;
    };
    // 42 × 12 fitted inside 504 × 160.
    expect(sizes(await draw())).toEqual([[504, 144]]);
    await spoilImageBytes(logo);
    expect(sizes(await draw())).toEqual([[504, 144]]);
    // A fresh mount has nothing drawn yet, and the image will no longer decode.
    expect(sizes(await rendered({ logo }))).toEqual([]);
  });

  it("draws no logo, and refuses nothing, when the image is gone or will not decode", async () => {
    const gone = await rendered({ logo: `${"c".repeat(64)}.png` });
    expect([sizes(gone), gone.marks.logo]).toEqual([[], null]);

    const spoiled = await libraryImage(43);
    await spoilImageBytes(spoiled);
    const undecodable = await rendered({ logo: spoiled });
    expect([sizes(undecodable), undecodable.marks.logo]).toEqual([[], null]);
  });
});

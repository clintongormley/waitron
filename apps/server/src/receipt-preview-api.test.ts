import { registerModulePermissions } from "@waitron/identity";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
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
import {
  emptyPrinterLists,
  setProfilePrinterLists,
  validateDepartmentReceipt,
} from "@waitron/layouts";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { isAppError } from "@waitron/shared";
import { contentLanguages } from "@waitron/catalogue";
import { departments, departmentReceipts, departmentSalePolicies } from "@waitron/venue-service";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { mountReceiptPreviewApi, type ReceiptPreviewResponse } from "./receipt-preview-api.js";
import type { TillConfig } from "./till-config.js";
import { deletePrinter } from "./printer-delete.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});
let venue: Venue;
let taxId: string;
let departmentId: string;
const policy = { receiptPrintMode: "auto", printTradingName: false } as const;
beforeAll(async () => {
  registerModulePermissions([{ permission: "venue_service.manage", grantedFrom: "manager" }]);
  venue = await setupVenue(suite.db);
  const [department] = await suite.db
    .select()
    .from(departments)
    .where(eq(departments.locationId, venue.cfg.locationId));
  departmentId = department!.id;
  await suite.db
    .update(departmentSalePolicies)
    .set({ printTradingName: false })
    .where(eq(departmentSalePolicies.departmentId, departmentId));
  await suite.db
    .update(contentLanguages)
    .set({ defaultLanguage: "es", languages: ["es", "ca", "gl", "eu"] });
  taxId = (await withTransaction(suite.db, (tx) => readTenant(tx)))!.taxId;
});

function app(cfg: Partial<TillConfig> = {}) {
  const app = new Hono();
  mountReceiptPreviewApi(app, { db: suite.db, cfg: { ...venue.cfg, ...cfg } }, () => {});
  return app;
}

async function previewRaw(
  body: string,
  { cookie = venue.managerCookie, cfg = {} }: { cookie?: string; cfg?: Partial<TillConfig> } = {},
): Promise<Response> {
  return app(cfg).request("/management-api/receipt-preview", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body,
  });
}

async function preview(
  body: {
    receipt?: unknown;
    policy?: unknown;
    departmentId?: unknown;
    paperWidth?: unknown;
    language?: unknown;
  },
  options: { cookie?: string; cfg?: Partial<TillConfig> } = {},
): Promise<Response> {
  return previewRaw(JSON.stringify({ departmentId, receipt: {}, policy, ...body }), options);
}

function localized(receipt: unknown): unknown {
  if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt)) return receipt;
  const result = { ...receipt } as Record<string, unknown>;
  for (const field of ["headerSubtitle", "footerMessage"]) {
    if (typeof result[field] === "string") result[field] = { "es-ES": result[field] };
  }
  return result;
}

async function rendered(receipt: unknown, cfg: Partial<TillConfig> = {}) {
  const response = await preview(
    { receipt: localized({ printAddress: true, ...(receipt as object) }) },
    { cfg },
  );
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

/** The venue's legal name, on its own line; its tax ID is the line under it. */
const legal = () => "Deli Test SL";
const nif = () => `NIF: ${taxId}`;
/** The ruled line that ends a section. */
const RULE = expect.stringMatching(/^-+$/);

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

describe("POST /management-api/receipt-preview", () => {
  it("draws the department receipt and draft policy through the public mount", async () => {
    const [{ id }] = (
      await suite.db.execute<{ id: string }>(
        sql`select id from departments where location_id = ${venue.cfg.locationId} limit 1`,
      )
    ).rows;
    const response = await previewRaw(
      JSON.stringify({
        departmentId: id,
        receipt: { headerSubtitle: { "es-ES": "Authored department" }, printAddress: true },
        policy: { receiptPrintMode: "on_request", printTradingName: false },
      }),
    );
    expect(response.status).toBe(200);
    const answer = (await response.json()) as ReceiptPreviewResponse;
    expect(printedLines(answer)).toContain("Authored department");
    expect(printedLines(answer)).toContain(legal());
    expect(printedLines(answer)).toContain(nif());
    expect(printedLines(answer)).toContain("Calle Mayor 1");
    expect(answer.marks.headerSubtitle).not.toBeNull();
    expect(answer.marks.address).not.toBeNull();
  });

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
    ["a request without policy", JSON.stringify({ departmentId, receipt: {} })],
    ["a body that is not JSON", "{receipt:"],
  ])("refuses %s as a malformed body", async (_, body) => {
    const response = await previewRaw(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
  });

  it("refuses receipt content that is not an object with the receipt validation code", async () => {
    const response = await preview({ receipt: [{}, {}] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "receipt.invalid", params: { reason: "not_object" } },
    });
  });

  it("draws the sample sale with the venue's legal name and tax ID, and the unsaved trim where a receipt prints it", async () => {
    const result = await rendered({
      headerSubtitle: "Calle Mayor 1, Madrid",
      footerMessage: "Gracias por su visita",
    });
    const lines = printedLines(result);
    const name = lines.indexOf(legal());
    expect(name).toBeGreaterThanOrEqual(0);
    expect(lines[name - 1]).toBe("Calle Mayor 1, Madrid");
    expect(lines.slice(name + 1, name + 5)).toEqual([nif(), "Calle Mayor 1", "28013 Madrid", RULE]);
    expect(lines.some((line) => line.startsWith("1  Café y tostada"))).toBe(true);
    const change = lines.findIndex((line) => line.startsWith("Cambio"));
    expect(lines.slice(change + 1).filter(Boolean)).toEqual([RULE, "Gracias por su visita"]);
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
      const response = await preview({
        receipt: {},
        departmentId: id,
        policy: { ...policy, printTradingName: true },
      });
      expect(response.status).toBe(200);
      const lines = printedLines((await response.json()) as ReceiptPreviewResponse);
      expect(lines.indexOf("Deli Counter")).toBeGreaterThanOrEqual(0);
      expect(lines.indexOf("Deli Counter")).toBeLessThan(lines.indexOf(legal()));
    } finally {
      await suite.db.execute(
        sql`update departments set trading_name = ${originalName} where id = ${id}`,
      );
    }
  });

  it("refuses malformed and unknown department choices", async () => {
    const malformed = await preview({ receipt: {}, departmentId: "not-a-uuid" });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("shared.invalid_id");

    const unknown = await preview({
      receipt: {},
      departmentId: "aa000000-0000-4000-8000-000000000001",
    });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe("department.not_found");

    const repeated = await preview({
      receipt: {},
      departmentId: [
        "aa000000-0000-4000-8000-000000000001",
        "aa000000-0000-4000-8000-000000000001",
      ],
    });
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
    expect(linesOf(result, headerSubtitle!.end, headerSubtitle!.end + 2)).toEqual([legal(), nif()]);
    expect(linesOf(result, footerMessage!.start, footerMessage!.end)).toEqual(["Hasta pronto"]);
    expect(linesOf(result, footerMessage!.start - 1, footerMessage!.start)).toEqual([RULE]);
  });

  it("marks only the footer's own line on a practice receipt, not the rule drawn below it", async () => {
    const result = await rendered({ footerMessage: "Hasta pronto" }, { practiceMode: true });
    const { footerMessage } = result.marks;
    expect(linesOf(result, footerMessage!.start, footerMessage!.end)).toEqual(["Hasta pronto"]);
    expect(linesOf(result, footerMessage!.end, footerMessage!.end + 2)).toEqual([
      RULE,
      "PRUEBA - SIN COBRO REAL",
    ]);
  });

  it("marks nothing for absent trim and marks the explicitly enabled location address", async () => {
    const result = await rendered({});
    const lines = printedLines(result);
    const name = lines.indexOf(legal());
    expect(result.marks).toEqual({
      headerSubtitle: null,
      footerMessage: null,
      phone: null,
      email: null,
      address: { start: name + 2, end: name + 4 },
      logo: null,
    });
    expect(lines.slice(name + 1, name + 5)).toEqual([nif(), "Calle Mayor 1", "28013 Madrid", RULE]);
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
    const at = (paperWidth?: unknown) =>
      preview({ receipt: {}, paperWidth }).then(async (response) => {
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
          const result = await at();
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
            expect((await at()).paperWidth).toBe("80mm");
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
          const result = await at();
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
            const result = await at();
            expect([result.paperWidths, result.paperWidth]).toEqual([["80mm"], "80mm"]);
          } finally {
            await suite.db.execute(sql`delete from printers where id = ${unusedPrinter!.id}`);
          }
        },
      );
    });

    it("counts a device on Use default with its profile's default receipt printer", async () => {
      const [printer] = await suite.db
        .insert(printers)
        .values({
          locationId: venue.cfg.locationId,
          name: "Default receipt printer",
          transport: "network_tcp",
          host: "192.0.2.12",
          paperWidth: "58mm",
          resolution: "180dpi",
        })
        .returning({ id: printers.id });
      const { deviceId, profileId } = await seedDevice(suite.db, {
        locationId: venue.cfg.locationId,
        label: "Caja por defecto",
      });
      try {
        await withTransaction(suite.db, (tx) =>
          setProfilePrinterLists(tx, profileId, {
            ...emptyPrinterLists(),
            receiptPrinterIds: [printer!.id],
            receiptPrinterDefaultId: printer!.id,
          }),
        );
        const result = await at();
        expect([result.paperWidths, result.paperWidth]).toEqual([["58mm"], "58mm"]);
      } finally {
        await suite.db.execute(
          sql`delete from device_profile_printers where device_profile_id = ${profileId}`,
        );
        await suite.db.execute(sql`delete from devices where id = ${deviceId}`);
        await suite.db.execute(sql`delete from printers where id = ${printer!.id}`);
      }
    });

    it("draws at the width asked for, at the resolution of that width's printer", async () => {
      await withPrinters(
        [
          { device: "Barra", paperWidth: "58mm", resolution: "180dpi" },
          { device: "Caja 1", paperWidth: "80mm", resolution: "203dpi" },
          { device: "Caja 2", paperWidth: "80mm", resolution: "203dpi" },
        ],
        async () => {
          const result = await at("58mm");
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
          const result = await at();
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
          const result = await at("80mm");
          expect(result.paperWidths).toEqual(["58mm", "80mm"]);
          expect(result.preview.widthDots).toBe(512);
          expect((await at()).preview.widthDots).toBe(512);
        },
      );
    });

    it("offers one width when every receipt printer has it", async () => {
      await withPrinters(
        [{ device: "Caja 1", paperWidth: "58mm", resolution: "203dpi" }],
        async () => {
          const result = await at();
          expect([result.paperWidths, result.paperWidth]).toEqual([["58mm"], "58mm"]);
        },
      );
    });

    it("offers no width, and draws at 80 mm, when the location has no receipt printer", async () => {
      const result = await at();
      expect([result.paperWidths, result.paperWidth]).toEqual([[], "80mm"]);
    });

    it("leaves an inactive printer's width out", async () => {
      await withPrinters(
        [
          { device: "Barra", paperWidth: "58mm", resolution: "203dpi", active: false },
          { device: "Caja 1", paperWidth: "80mm", resolution: "203dpi" },
        ],
        async () => {
          const result = await at();
          expect([result.paperWidths, result.paperWidth]).toEqual([["80mm"], "80mm"]);
        },
      );
    });

    it("honours an explicit width with the default resolution when no receipt printer has it", async () => {
      await withPrinters(
        [{ device: "Caja 1", paperWidth: "58mm", resolution: "203dpi" }],
        async () => {
          const result = await at("80mm");
          expect(result.paperWidth).toBe("80mm");
          expect([result.preview.widthDots, result.preview.columns]).toEqual([512, 42]);
        },
      );
    });

    it.each([
      ["a width that is not a paper width", "99mm"],
      ["an empty width", ""],
      ["an array of widths", ["58mm", "58mm"]],
    ])("refuses %s", async (_, paperWidth) => {
      const response = await preview({ receipt: {}, paperWidth });
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
    const at = async (language?: unknown) => {
      const response = await preview({ receipt: {}, language });
      expect(response.status).toBe(200);
      return printedLines((await response.json()) as ReceiptPreviewResponse);
    };
    const labelled = (lines: string[], label: string) =>
      lines.some((line) => line === label || line.startsWith(`${label} `));

    it("draws the sample in a language asked for, whatever the location has saved", async () => {
      const lines = await at("gl-ES");
      expect(labelled(lines, "IVE 10% incluído")).toBe(true);
      expect(lines.some((line) => line.startsWith("IVE "))).toBe(true);
      expect(labelled(lines, "IVA 10% incluido")).toBe(false);
    });

    it("follows the location's saved language when none is asked for", async () => {
      await setLocationLanguages(["gl-ES"]);
      try {
        const lines = await at();
        expect(labelled(lines, "IVE 10% incluído")).toBe(true);
        expect(lines.some((line) => line.startsWith("IVE "))).toBe(true);
      } finally {
        await setLocationLanguages(["es-ES"]);
      }
      expect(labelled(await at(), "IVA 10% incluido")).toBe(true);
    });

    it("checks permission before reading the body, then draws from one transaction snapshot", async () => {
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
      const response = await counted.request("/management-api/receipt-preview", {
        method: "POST",
        headers: { cookie: venue.managerCookie, "content-type": "application/json" },
        body: JSON.stringify({ departmentId, receipt: {}, policy, language: "gl-ES" }),
      });
      expect([response.status, opened]).toEqual([200, 2]);
    });

    it.each([
      ["a language the pack does not offer", "en-GB"],
      ["an empty language", ""],
      ["an array of languages", ["gl-ES", "gl-ES"]],
    ])("refuses %s", async (_, language) => {
      const response = await preview({ receipt: {}, language });
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
    const response = await withWords.request("/management-api/receipt-preview", {
      method: "POST",
      headers: { cookie: venue.managerCookie, "content-type": "application/json" },
      body: JSON.stringify({ departmentId, receipt: {}, policy }),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as ReceiptPreviewResponse;
    expect(pictures(result)).toHaveLength(1);
    const lines = printedLines(result);
    expect(lines.indexOf("CAP-X")).toBeGreaterThanOrEqual(0);
    expect(lines.indexOf("LEG-Y")).toBeGreaterThan(lines.indexOf("CAP-X"));
    expect(lines.indexOf("LEG-Y")).toBeLessThan(lines.indexOf(legal()));
  });

  it("draws no QR, caption or legend for a venue whose fiscal backend gives no words", async () => {
    const result = await rendered({});
    expect(pictures(result)).toEqual([]);
    expect(result.preview.text).not.toContain("VERI*FACTU");
    expect(result.preview.text).not.toContain("QR tributario");
    expect(printedLines(result)).toContain(legal());
    expect(printedLines(result)).toContain(nif());
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
    ["a field the receipt does not have", { unknownDecoration: "Venta" }],
    ["a receipt that is not an object", ["Venta"]],
  ])("refuses %s with the code and params a save would refuse it with", async (_, body) => {
    let saveRefusal: unknown;
    try {
      validateDepartmentReceipt(localized(body), ["es-ES", "ca-ES", "gl-ES", "eu-ES"]);
    } catch (error) {
      saveRefusal = error;
    }
    expect(isAppError(saveRefusal)).toBe(true);
    const response = await preview({ receipt: localized(body) });
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: { code: string; params: unknown } };
    const expected = saveRefusal as { code: string; params: unknown };
    expect(error).toEqual({ code: expected.code, params: expected.params });
  });
});

describe("the receipt preview's top block", () => {
  afterEach(async () => {
    await suite.db.delete(departmentReceipts);
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

  it("draws the enabled location address and authored contact under the subtitle, and marks each", async () => {
    await suite.db
      .insert(tenantReceipts)
      .values({ receipt: { phone: "910 000 000", email: "hola@deli.test" } });
    const result = await rendered({
      headerSubtitle: "Desde 1990",
      phone: "910 000 000",
      email: "hola@deli.test",
    });
    const lines = printedLines(result);
    const name = lines.indexOf(legal());
    expect(lines.slice(name - 1, name + 7)).toEqual([
      "Desde 1990",
      legal(),
      nif(),
      "Calle Mayor 1",
      "28013 Madrid",
      "Tel. 910 000 000",
      "hola@deli.test",
      RULE,
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
    const name = lines.indexOf(legal());
    expect(lines.slice(name + 1, name + 3)).toEqual([nif(), RULE]);
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
    expect(linesOf(result, mark.start, mark.end)).toEqual(["", "", ""]);
    expect(result.preview.blocks[mark.start + 1]).toMatchObject({ kind: "image", width: 504 });
    expect(linesOf(result, mark.end, mark.end + 1)).toEqual([legal()]);
  });

  it("draws the saved picture when the logo is the saved one", async () => {
    const logo = await libraryImage(41);
    const raster = {
      widthDots: 16,
      heightDots: 2,
      data: Buffer.from([1, 2, 3, 4]).toString("base64"),
    };
    await suite.db
      .insert(departmentReceipts)
      .values({ departmentId, receipt: { logo }, logoRasters: { "58mm": raster, "80mm": raster } });
    expect(sizes(await rendered({ logo }))).toEqual([[16, 2]]);
  });

  it("draws a library logo once, and from then on without reading the image", async () => {
    const logo = await libraryImage(42);
    const mounted = app();
    const draw = async () => {
      const response = await mounted.request("/management-api/receipt-preview", {
        method: "POST",
        headers: { cookie: venue.managerCookie, "content-type": "application/json" },
        body: JSON.stringify({ departmentId, receipt: { logo }, policy }),
      });
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

  it("draws no logo once the unsaved logo's image is deleted, though it was drawn before", async () => {
    const logo = await libraryImage(44);
    const mounted = app();
    const draw = async () => {
      const response = await mounted.request("/management-api/receipt-preview", {
        method: "POST",
        headers: { cookie: venue.managerCookie, "content-type": "application/json" },
        body: JSON.stringify({ departmentId, receipt: { logo }, policy }),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as ReceiptPreviewResponse;
    };
    expect(sizes(await draw())).toEqual([[504, 137]]);
    await suite.db.delete(mediaImages).where(eq(mediaImages.filename, logo));
    const after = await draw();
    expect([sizes(after), after.marks.logo]).toEqual([[], null]);
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

describe("a deleted receipt printer in the receipt preview", () => {
  it("is no longer offered as a width, nor drawn at, once deleted", async () => {
    const widths = async () => {
      const response = await preview({ receipt: {} });
      expect(response.status).toBe(200);
      const result = (await response.json()) as ReceiptPreviewResponse;
      return [result.paperWidths, result.paperWidth];
    };
    await withPrinters(
      [
        { device: "Barra", paperWidth: "58mm", resolution: "180dpi" },
        { device: "Caja 1", paperWidth: "58mm", resolution: "180dpi" },
        { device: "Caja 2", paperWidth: "80mm", resolution: "203dpi" },
      ],
      async () => {
        expect(await widths()).toEqual([["58mm", "80mm"], "58mm"]);
        const narrow = await suite.db
          .select({ id: printers.id })
          .from(printers)
          .where(inArray(printers.name, ["Printer Barra", "Printer Caja 1"]));
        await withTransaction(suite.db, async (tx) => {
          for (const { id } of narrow)
            await deletePrinter(tx, { locationId: venue.cfg.locationId }, id);
        });
        expect(await widths()).toEqual([["80mm"], "80mm"]);
      },
    );
  });
});

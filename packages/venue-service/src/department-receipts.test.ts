import { workingOrders } from "@waitron/db";
import { seedPhotoMetadata } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  departments,
  invoiceSeries,
  mediaImages,
  sales,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue, seedWorkingOrder, seedZone } from "@waitron/db/testing/seed.js";
import { eq, sql } from "drizzle-orm";
import { createDepartment, listDepartments } from "./operations.js";
import * as receipts from "./index.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
const pair = {
  "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
  "80mm": { widthDots: 8, heightDots: 1, data: "QA==" },
};
async function fixture(active = true) {
  await seedVenue(suite.db, {
    name: randomUUID(),
    invoiceLocales: ["es-ES"],
  });
  await seedPhotoMetadata(suite.db, {
    id: "existing-logo",
    filename: `${"a".repeat(64)}.png`,
    names: {},
  });
  const cfg = {
    receiptLanguages: ["es-ES", "ca-ES"],
  };
  const [dept] = await suite.db
    .insert(departments)
    .values({
      name: "Dining",
      tradingName: "Dining",
      active,
      isDefault: true,
    })
    .returning();
  return { cfg, id: dept!.id };
}
function scoped<T>(body: (tx: Transaction) => Promise<T>) {
  return withTransaction(suite.db, body);
}
async function imported(id: string, receipt: string, rasters: string | null = null) {
  let imageId: string | null = null;
  let operationDescription: string | null = null;
  try {
    const parsed = JSON.parse(receipt);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      operationDescription =
        typeof parsed.operationDescription === "string" ? parsed.operationDescription : null;
      delete parsed.operationDescription;
      receipt = JSON.stringify(parsed);
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      parsed.logo === `${"a".repeat(64)}.png`
    ) {
      imageId = "existing-logo";
      delete parsed.logo;
      receipt = JSON.stringify(parsed);
    }
  } catch {
    /* The malformed-document controls deliberately bypass the writer. */
  }
  await suite.db.execute(
    sql`update departments set operation_description = ${operationDescription}, receipt_text = ${receipt}, receipt_logo_image_id = ${imageId}, receipt_logo_rasters = ${rasters}, receipt_updated_at = '2026-10-10T00:00:00Z' where id = ${id}`,
  );
}

describe("department receipt storage", () => {
  it("stores the editor's description in its column and leaves it out of receipt text", async () => {
    const f = await fixture();
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(tx, f.id, {
        operationDescription: "Dining meals",
        phone: "+34911234567",
      }),
    );
    expect(
      (
        await suite.db.execute(
          sql`select operation_description, receipt_text from departments where id = ${f.id}`,
        )
      ).rows,
    ).toEqual([
      { operation_description: "Dining meals", receipt_text: '{"phone":"+34911234567"}' },
    ]);
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
      operationDescription: "Dining meals",
      phone: "+34911234567",
    });
    await scoped((tx) => receipts.writeDepartmentReceipt(tx, f.id, {}));
    expect(
      (
        await suite.db.execute(
          sql`select operation_description from departments where id = ${f.id}`,
        )
      ).rows,
    ).toEqual([{ operation_description: null }]);
  });
  it("saves a logo by image id, reads its name, and leaves logo out of receipt text", async () => {
    const f = await fixture();
    const filename = `${"d".repeat(64)}.png`;
    await seedPhotoMetadata(suite.db, { id: "receipt-image", filename, names: {} });
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(tx, f.id, { logo: filename, phone: "+34911234567" }, pair),
    );
    expect(
      (
        await suite.db.execute(
          sql`select receipt_logo_image_id, receipt_text from departments where id = ${f.id}`,
        )
      ).rows,
    ).toEqual([
      { receipt_logo_image_id: "receipt-image", receipt_text: '{"phone":"+34911234567"}' },
    ]);
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
      logo: filename,
      phone: "+34911234567",
    });
  });
  it("refuses a receipt logo whose image does not exist", async () => {
    const f = await fixture();
    await expect(
      scoped((tx) =>
        receipts.writeDepartmentReceipt(tx, f.id, { logo: `${"d".repeat(64)}.png` }, pair),
      ),
    ).rejects.toMatchObject({
      code: "receipt.invalid",
      params: { reason: "image_not_found", field: "logo" },
    });
  });
  it("the database protects a used logo and permits deleting it once cleared", async () => {
    const f = await fixture();
    const filename = `${"d".repeat(64)}.png`;
    await seedPhotoMetadata(suite.db, { id: "receipt-image", filename, names: {} });
    await scoped((tx) => receipts.writeDepartmentReceipt(tx, f.id, { logo: filename }, pair));
    await expect(
      (async () => {
        await suite.db.execute(sql`delete from media_images where id = 'receipt-image'`);
      })(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    await scoped((tx) => receipts.writeDepartmentReceipt(tx, f.id, {}));
    await suite.db.execute(sql`delete from media_images where id = 'receipt-image'`);
    expect(
      await suite.db.select().from(mediaImages).where(eq(mediaImages.id, "receipt-image")),
    ).toEqual([]);
  });
  it("reads an empty authored receipt without copying defaults", async () => {
    const f = await fixture();
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({});
    expect(
      await scoped((tx) => receipts.readPrintedDepartmentReceipt(tx, f.cfg, f.id, "58mm")),
    ).toEqual({ receipt: {}, logo: null });
  });
  it("round-trips translations and the requested picture, then replaces by department key", async () => {
    const f = await fixture();
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(
        tx,
        f.id,
        {
          logo: `${"a".repeat(64)}.png`,
          phone: "+34911234567",
          email: "dining@example.com",
          headerSubtitle: { "es-ES": "Hola", "ca-ES": "Bon dia" },
          footerMessage: { "ca-ES": "Gràcies" },
        },
        pair,
      ),
    );
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
      logo: `${"a".repeat(64)}.png`,
      phone: "+34911234567",
      email: "dining@example.com",
      headerSubtitle: { "es-ES": "Hola", "ca-ES": "Bon dia" },
      footerMessage: { "ca-ES": "Gràcies" },
    });
    expect(
      await scoped((tx) => receipts.readPrintedDepartmentReceipt(tx, f.cfg, f.id, "58mm")),
    ).toMatchObject({ logo: { widthDots: 8, heightDots: 1, bits: new Uint8Array([128]) } });
    expect(
      await scoped((tx) => receipts.readPrintedDepartmentReceipt(tx, f.cfg, f.id, "80mm")),
    ).toMatchObject({ logo: { bits: new Uint8Array([64]) } });
    expect(await scoped((tx) => receipts.readDepartmentLogoRasters(tx, f.id))).toEqual(pair);
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(tx, f.id, { footerMessage: { "es-ES": "Adiós" } }),
    );
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
      footerMessage: { "es-ES": "Adiós" },
    });
    expect(await scoped((tx) => receipts.readDepartmentLogoRasters(tx, f.id))).toBeNull();
    const rows = (
      await suite.db.execute(
        sql`select id from departments where id = ${f.id} and receipt_updated_at is not null`,
      )
    ).rows;
    expect(rows).toHaveLength(1);
  });
  it("keeps recorded receipt settings internally while hiding deleted departments from management", async () => {
    const f = await fixture();
    await scoped((tx) => receipts.writeDepartmentReceipt(tx, f.id, { email: "old@example.com" }));
    await suite.db.update(departments).set({ active: false }).where(eq(departments.id, f.id));
    await expect(
      scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id)),
    ).rejects.toMatchObject({ code: "department.not_found" });
    expect(
      (await scoped((tx) => receipts.readPrintedDepartmentReceipt(tx, f.cfg, f.id, "80mm")))
        .receipt,
    ).toEqual({
      email: "old@example.com",
    });
    expect(await scoped((tx) => listDepartments(tx))).toEqual([]);
    expect(
      await suite.db.select().from(departments).where(eq(departments.id, f.id)),
    ).toContainEqual(expect.objectContaining({ id: f.id, isDefault: true, active: false }));
  });
  it("refuses unknown ids without changing the saved row", async () => {
    const a = await fixture();
    await scoped((tx) => receipts.writeDepartmentReceipt(tx, a.id, { phone: "+34911234567" }));
    const id = randomUUID();
    await expect(
      scoped((tx) => receipts.writeDepartmentReceipt(tx, id, { phone: "+34917654321" })),
    ).rejects.toMatchObject({ code: "department.not_found" });
    await expect(
      scoped((tx) => receipts.readDepartmentReceipt(tx, a.cfg, id)),
    ).rejects.toMatchObject({ code: "department.not_found" });
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, a.cfg, a.id))).toEqual({
      phone: "+34911234567",
    });
  });
  it("requires two printable pictures for a named logo", async () => {
    const f = await fixture();
    for (const pictures of [undefined, { ...pair, "80mm": { ...pair["80mm"], data: "?" } }]) {
      await expect(
        scoped((tx) =>
          receipts.writeDepartmentReceipt(tx, f.id, { logo: `${"a".repeat(64)}.png` }, pictures),
        ),
      ).rejects.toThrow();
    }
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({});
  });
  it.each(["{bad json", "null", "[]", "42"])("contains imported %s", async (value) => {
    const f = await fixture();
    await imported(f.id, value, "{bad json");
    expect(
      await scoped((tx) => receipts.readPrintedDepartmentReceipt(tx, f.cfg, f.id, "58mm")),
    ).toEqual({ receipt: {}, logo: null, unreadable: true });
  });
  it("marks an unknown department as unreadable", async () => {
    const a = await fixture();
    const id = randomUUID();
    expect(
      await scoped((tx) => receipts.readPrintedDepartmentReceipt(tx, a.cfg, id, "80mm")),
    ).toEqual({ receipt: {}, logo: null, unreadable: true });
  });
  it("a readable document without a logo key, or with a kept logo, is not unreadable", async () => {
    const f = await fixture();
    await imported(f.id, '{"phone":"+34911234567"}');
    const plain = await scoped((tx) =>
      receipts.readPrintedDepartmentReceipt(tx, f.cfg, f.id, "58mm"),
    );
    expect(plain).not.toHaveProperty("unreadable");
    expect(plain.receipt).toEqual({ phone: "+34911234567" });
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(tx, f.id, { logo: `${"a".repeat(64)}.png` }, pair),
    );
    const kept = await scoped((tx) =>
      receipts.readPrintedDepartmentReceipt(tx, f.cfg, f.id, "58mm"),
    );
    expect(kept).not.toHaveProperty("unreadable");
    expect(kept.logo?.bits).toEqual(new Uint8Array([128]));
  });
  it("preserves good fields while dropping bad shapes, keys, contacts and oversized entries", async () => {
    const f = await fixture();
    await imported(
      f.id,
      JSON.stringify({
        logo: "../secret",
        phone: ["123"],
        email: " wrong@example.com ",
        headerSubtitle: { "es-ES": "Hola", "ca-ES": 12, "en-GB": "Never", __proto__: "Never" },
        footerMessage: { "es-ES": "x".repeat(201), "ca-ES": "Gràcies" },
        printAddress: false,
        extra: "x".repeat(100_000),
      }),
    );
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
      printAddress: false,
      headerSubtitle: { "es-ES": "Hola" },
      footerMessage: { "ca-ES": "Gràcies" },
    });
  });
  it("bounds imported maps and pictures before returning them from the engine", async () => {
    const f = await fixture();
    await imported(
      f.id,
      JSON.stringify({
        logo: `${"a".repeat(64)}.png`,
        email: "good@example.com",
        headerSubtitle: { "es-ES": "x".repeat(100_000), "ca-ES": "Bon dia" },
        footerMessage: { "es-ES": "Gracias" },
      }),
      JSON.stringify({
        "58mm": { widthDots: 8, heightDots: 1, data: "x".repeat(1_000_000) },
        "80mm": pair["80mm"],
      }),
    );
    const seen: unknown[][] = [];
    const session = (
      suite.db as unknown as {
        session: {
          prepareQuery: (...args: unknown[]) => { all: (...args: unknown[]) => unknown[] };
        };
      }
    ).session;
    const original = session.prepareQuery.bind(session);
    const spy = vi.spyOn(session, "prepareQuery").mockImplementation((...args) => {
      const query = original(...args);
      const all = query.all.bind(query);
      query.all = (...values) => {
        const result = all(...values);
        if (JSON.stringify(args[0]).includes("receipt_text")) seen.push(result);
        return result;
      };
      return query;
    });
    try {
      expect(
        await scoped((tx) => receipts.readPrintedDepartmentReceipt(tx, f.cfg, f.id, "58mm")),
      ).toEqual({
        receipt: {
          logo: `${"a".repeat(64)}.png`,
          email: "good@example.com",
          headerSubtitle: { "ca-ES": "Bon dia" },
          footerMessage: { "es-ES": "Gracias" },
        },
        logo: null,
      });
      expect(seen).toHaveLength(1);
      expect(JSON.stringify(seen).length).toBeLessThan(65_536);
    } finally {
      spy.mockRestore();
    }
    expect(
      await scoped((tx) => receipts.readPrintedDepartmentReceipt(tx, f.cfg, f.id, "80mm")),
    ).toMatchObject({ logo: { bits: new Uint8Array([64]) } });
    expect(await scoped((tx) => receipts.readDepartmentLogoRasters(tx, f.id))).toBeNull();
  });
  it("contains an optional SELECT failure with a bounded diagnostic while a management read still refuses", async () => {
    const f = await fixture();
    const events: unknown[] = [];
    const cfg = { ...f.cfg, receiptDiagnostic: (event: unknown) => events.push(event) };
    const spy = vi.spyOn(suite.db, "select").mockImplementation(() => {
      throw new Error("secret imported email should not appear");
    });
    try {
      expect(await receipts.readPrintedDepartmentReceipt(suite.db, cfg, f.id, "58mm")).toEqual({
        receipt: {},
        logo: null,
        unreadable: true,
      });
      expect(events).toEqual([
        {
          operation: "readPrintedDepartmentReceipt",
          departmentId: f.id,
          code: "receipt.read_failed",
        },
      ]);
      await expect(receipts.readDepartmentReceipt(suite.db, cfg, f.id)).rejects.toThrow(
        "secret imported",
      );
    } finally {
      spy.mockRestore();
    }
  });
  it.each([
    "oops",
    7,
    [],
    null,
    { widthDots: 0, heightDots: 1, data: "gA==" },
    { widthDots: 8, heightDots: 161, data: "gA==" },
    { widthDots: 505, heightDots: 1, data: "gA==" },
    { widthDots: 8, heightDots: 1, data: "????" },
  ])("keeps good trim beside a corrupt picture %j", async (bad) => {
    const f = await fixture();
    await imported(
      f.id,
      JSON.stringify({ logo: `${"a".repeat(64)}.png`, footerMessage: { "es-ES": "Gracias" } }),
      JSON.stringify({ "58mm": bad, "80mm": pair["80mm"] }),
    );
    expect(
      await scoped((tx) => receipts.readPrintedDepartmentReceipt(tx, f.cfg, f.id, "58mm")),
    ).toEqual({
      receipt: { logo: `${"a".repeat(64)}.png`, footerMessage: { "es-ES": "Gracias" } },
      logo: null,
    });
    expect(await scoped((tx) => receipts.readDepartmentLogoRasters(tx, f.id))).toBeNull();
  });
  it("uses the validator's UTF-16 length bound for imported translated entries", async () => {
    const f = await fixture();
    await imported(
      f.id,
      JSON.stringify({ headerSubtitle: { "es-ES": "😀".repeat(101), "ca-ES": "😀".repeat(100) } }),
    );
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
      headerSubtitle: { "ca-ES": "😀".repeat(100) },
    });
  });
  it("drops wrong map shapes and blank entries without hiding the other text", async () => {
    const f = await fixture();
    await imported(
      f.id,
      JSON.stringify({
        headerSubtitle: ["Wrong"],
        footerMessage: { "es-ES": "  ", "ca-ES": "Gràcies" },
      }),
    );
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
      footerMessage: { "ca-ES": "Gràcies" },
    });
  });
  it("bounds the combined authored fields in the engine even with a large allowed-language list", async () => {
    const f = await fixture();
    const languages = Array.from({ length: 400 }, (_, i) => `lang-${i}`);
    const cfg = { ...f.cfg, receiptLanguages: languages };
    const texts = Object.fromEntries(languages.map((language) => [language, "x".repeat(200)]));
    await imported(
      f.id,
      JSON.stringify({
        email: "good@example.com",
        headerSubtitle: texts,
        footerMessage: { "lang-0": "Thanks" },
      }),
    );
    const seen: unknown[][] = [];
    const session = (
      suite.db as unknown as {
        session: {
          prepareQuery: (...args: unknown[]) => { all: (...args: unknown[]) => unknown[] };
        };
      }
    ).session;
    const original = session.prepareQuery.bind(session);
    const spy = vi.spyOn(session, "prepareQuery").mockImplementation((...args) => {
      const query = original(...args);
      const all = query.all.bind(query);
      query.all = (...values) => {
        const result = all(...values);
        if (JSON.stringify(args[0]).includes("receipt_text")) seen.push(result);
        return result;
      };
      return query;
    });
    try {
      expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, cfg, f.id))).toEqual({
        email: "good@example.com",
        footerMessage: { "lang-0": "Thanks" },
      });
      expect(seen).toHaveLength(1);
      expect(Buffer.byteLength(JSON.stringify(seen))).toBeLessThan(65_536);
    } finally {
      spy.mockRestore();
    }
  });
  it("contains a failed diagnostic sink too", async () => {
    const f = await fixture();
    const spy = vi.spyOn(suite.db, "select").mockImplementation(() => {
      throw new Error("read failed");
    });
    try {
      expect(
        await receipts.readPrintedDepartmentReceipt(
          suite.db,
          {
            ...f.cfg,
            receiptDiagnostic: () => {
              throw new Error("log failed");
            },
          },
          f.id,
          "80mm",
        ),
      ).toEqual({ receipt: {}, logo: null, unreadable: true });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("receipt department lookups", () => {
  it("never substitutes the designated default for a missing or null sale header", async () => {
    await fixture(false);
    const nodeId = await seedNode(suite.db);
    const [series] = await suite.db.insert(invoiceSeries).values({ nodeId, code: "F" }).returning();
    const values = {
      source: "readiness_test",
      nodeId,
      seriesId: series!.id,
      invoiceNumber: 1,
      issuedAt: "2026-10-10T00:00:00Z",
      issuedOffsetMinutes: 0,
      total: 0,
      vatBreakdown: [],
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "none",
      fiscalState: "not_applicable",
    } satisfies typeof sales.$inferInsert;
    const [absent, sale] = await suite.db
      .insert(sales)
      .values([
        values,
        { ...values, invoiceNumber: 2, receiptTradingName: "", receiptPrintsTradingName: false },
      ])
      .returning();
    expect(await scoped((tx) => receipts.receiptDepartmentForSale(tx, absent!.id))).toBeNull();
    const session = (
      suite.db as unknown as { session: { prepareQuery: (...args: unknown[]) => unknown } }
    ).session;
    const original = session.prepareQuery.bind(session);
    const selects: string[] = [];
    const spy = vi.spyOn(session, "prepareQuery").mockImplementation((...args) => {
      const query = args[0] as { sql: string };
      if (query.sql.startsWith("select") && !query.sql.includes("change_log"))
        selects.push(query.sql);
      return original(...args);
    });
    try {
      expect(
        await scoped((tx) => receipts.VENUE_SERVICE.receiptDepartmentForSale(tx, sale!.id)),
      ).toBeNull();
      expect(selects).toHaveLength(1);
      expect(selects[0]).not.toContain("is_default");
    } finally {
      spy.mockRestore();
    }
    expect(await scoped((tx) => receipts.receiptDefaultDepartment(tx))).toBeNull();
  });
  it("reads the recorded disabled sale department", async () => {
    const f = await fixture(false);
    const nodeId = await seedNode(suite.db);
    const [series] = await suite.db.insert(invoiceSeries).values({ nodeId, code: "F" }).returning();
    const [sale] = await suite.db
      .insert(sales)
      .values({
        source: "readiness_test",
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: "2026-10-10T00:00:00Z",
        issuedOffsetMinutes: 0,
        total: 0,
        vatBreakdown: [],
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "none",
        fiscalState: "not_applicable",
        receiptDepartmentId: f.id,
        receiptTradingName: "Saved name",
        receiptPrintsTradingName: true,
      })
      .returning();
    expect(
      await scoped((tx) => receipts.VENUE_SERVICE.receiptDepartmentForSale(tx, sale!.id)),
    ).toBe(f.id);
  });
  it("reads authoritative order context without borrowing a default", async () => {
    const f = await fixture();
    const nodeId = await seedNode(suite.db);
    const order = await seedWorkingOrder(suite.db, {
      nodeId,
      source: "readiness_test",
      orderNumber: 1,
    });
    expect(await scoped((tx) => receipts.receiptDepartmentForOrder(tx, order.id))).toBeNull();
    const zone = await seedZone(suite.db, { name: "Bar" });
    await suite.db
      .update(workingOrders)
      .set({
        zoneId: zone!.id,
        departmentId: f.id,
        serviceMode: "prepay",
      })
      .where(eq(workingOrders.id, order.id));
    expect(
      await scoped((tx) => receipts.VENUE_SERVICE.receiptDepartmentForOrder(tx, order.id)),
    ).toBe(f.id);
  });
  it("ignores a deleted designated default", async () => {
    await fixture(false);
    expect(await scoped((tx) => receipts.VENUE_SERVICE.receiptDefaultDepartment(tx))).toBeNull();
  });
  it("makes storage available through the module seat", async () => {
    const f = await fixture();
    await scoped((tx) =>
      receipts.VENUE_SERVICE.writeDepartmentReceipt(tx, f.id, { email: "seat@example.com" }),
    );
    expect(
      await scoped((tx) => receipts.VENUE_SERVICE.readDepartmentReceipt(tx, f.cfg, f.id)),
    ).toEqual({ email: "seat@example.com" });
    expect(
      await scoped((tx) =>
        receipts.VENUE_SERVICE.readPrintedDepartmentReceipt(tx, f.cfg, f.id, "58mm"),
      ),
    ).toEqual({ receipt: { email: "seat@example.com" }, logo: null });
    expect(
      await scoped((tx) => receipts.VENUE_SERVICE.readDepartmentLogoRasters(tx, f.id)),
    ).toBeNull();
  });
});

describe("department-owned address and fiscal description", () => {
  it.each([true, false])(
    "round trips the department address switch %s and description",
    async (printAddress) => {
      const f = await fixture();
      const receipt = { printAddress, operationDescription: "Dining service" };
      await scoped((tx) => receipts.writeDepartmentReceipt(tx, f.id, receipt));
      expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual(
        receipt,
      );
      expect(
        await scoped((tx) => receipts.readPrintedDepartmentReceipt(tx, f.cfg, f.id, "80mm")),
      ).toEqual({ receipt, logo: null });
      await suite.db.update(departments).set({ active: false }).where(eq(departments.id, f.id));
      expect(await scoped((tx) => receipts.readRetainedDepartmentReceipt(tx, f.cfg, f.id))).toEqual(
        receipt,
      );
    },
  );
  it("clears both fields without taking the other department or venue value", async () => {
    const f = await fixture();
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(tx, f.id, {
        printAddress: true,
        operationDescription: "Dining service",
      }),
    );
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
      printAddress: true,
      operationDescription: "Dining service",
    });
    const other = await scoped((tx) => createDepartment(tx, { name: "Deli" }));
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(tx, other.id, {
        printAddress: true,
        operationDescription: "Other department",
      }),
    );
    await scoped((tx) => receipts.writeDepartmentReceipt(tx, f.id, {}));
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({});
  });
  it.each([
    { printAddress: 1 },
    { printAddress: "true" },
    { printAddress: null },
    { operationDescription: null },
    { operationDescription: "x".repeat(501) },
    { operationDescription: "bad\u0000text" },
  ])("omits malformed optional imported fields %j", async (receipt) => {
    const f = await fixture();
    await imported(f.id, JSON.stringify(receipt));
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({});
  });
});

describe("receipt and printing policy transaction", () => {
  it("reads the bare department's policy defaults before an authored receipt exists", async () => {
    const f = await fixture();
    expect(await scoped((tx) => receipts.readDepartmentReceiptPolicy(tx, f.id))).toEqual({
      printTradingName: true,
    });
  });
  it("saves receipt and policy while preserving the department's other service choices", async () => {
    const f = await fixture();
    await suite.db
      .update(departments)
      .set({
        orderStart: "table",
        paidWhen: "ticket_then_pay",
        collectionNumber: "numbered",
        dining: "till_choice",
        diningStartsAs: "takeaway",
      })
      .where(eq(departments.id, f.id));
    const receipt = { printAddress: false, operationDescription: "Dining service" };
    const policy = { printTradingName: false };
    await scoped((tx) => receipts.saveDepartmentReceiptSettings(tx, f.id, { receipt, policy }));
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual(receipt);
    expect(await scoped((tx) => receipts.readDepartmentReceiptPolicy(tx, f.id))).toEqual(policy);
    expect(
      await suite.db
        .select({
          departmentId: departments.id,
          orderStart: departments.orderStart,
          paidWhen: departments.paidWhen,
          collectionNumber: departments.collectionNumber,
          printTradingName: departments.printTradingName,
          dining: departments.dining,
          diningStartsAs: departments.diningStartsAs,
        })
        .from(departments)
        .where(eq(departments.id, f.id)),
    ).toEqual([
      {
        departmentId: f.id,
        orderStart: "table",
        paidWhen: "ticket_then_pay",
        collectionNumber: "numbered",
        dining: "till_choice",
        diningStartsAs: "takeaway",
        ...policy,
      },
    ]);
  });
  it("rolls receipt and department state back when the subsequent policy write is refused", async () => {
    const f = await fixture();
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(tx, f.id, { operationDescription: "Old description" }),
    );
    await suite.db.execute(
      sql`CREATE TRIGGER test_receipt_policy_refusal AFTER UPDATE OF receipt_text ON departments BEGIN UPDATE departments SET active = 0 WHERE id = NEW.id; END`,
    );
    try {
      await expect(
        scoped((tx) =>
          receipts.saveDepartmentReceiptSettings(tx, f.id, {
            receipt: { operationDescription: "New description" },
            policy: { printTradingName: false },
          }),
        ),
      ).rejects.toMatchObject({ code: "department.not_found", params: { departmentId: f.id } });
      expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
        operationDescription: "Old description",
      });
      expect(
        (await suite.db.select().from(departments).where(eq(departments.id, f.id)))[0]?.active,
      ).toBe(true);
      expect(
        await suite.db
          .select({ printTradingName: departments.printTradingName })
          .from(departments)
          .where(eq(departments.id, f.id)),
      ).toEqual([{ printTradingName: true }]);
    } finally {
      await suite.db.execute(sql`DROP TRIGGER test_receipt_policy_refusal`);
    }
  });
  it("refuses a policy read or write for an unknown or deleted department", async () => {
    const f = await fixture(false);
    for (const id of [f.id, randomUUID()]) {
      await expect(
        scoped((tx) => receipts.readDepartmentReceiptPolicy(tx, id)),
      ).rejects.toMatchObject({ code: "department.not_found" });
      await expect(
        scoped((tx) =>
          receipts.saveDepartmentReceiptSettings(tx, id, {
            receipt: {},
            policy: { printTradingName: true },
          }),
        ),
      ).rejects.toMatchObject({ code: "department.not_found" });
    }
  });
});

it("keeps a JSON-looking string distinct from a JSON array", async () => {
  const f = await fixture();
  await scoped((tx) => receipts.writeDepartmentReceipt(tx, f.id, { operationDescription: "[]" }));
  expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
    operationDescription: "[]",
  });
});

it.each([
  { label: "500 characters", value: "x".repeat(500) },
  { label: "250 supplementary characters", value: "😀".repeat(250) },
  { label: "permitted text whitespace", value: "Dining\tand drinks\n" },
])("reads a valid $label description without changing its spelling", async ({ value }) => {
  const f = await fixture();
  await scoped((tx) => receipts.writeDepartmentReceipt(tx, f.id, { operationDescription: value }));
  expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
    operationDescription: value,
  });
});

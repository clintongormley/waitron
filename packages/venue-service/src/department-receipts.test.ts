import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  locations,
  invoiceSeries,
  sales,
  workingOrders,
  floorZones,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { seedNode } from "@waitron/db/testing/seed.js";
import { eq, sql } from "drizzle-orm";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import {
  departments,
  departmentSalePolicies,
  orderServiceContexts,
  saleReceiptHeaders,
} from "./schema/service.js";
import { createDepartment, listDepartments } from "./operations.js";
import * as receipts from "./index.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const pair = {
  "58mm": { widthDots: 8, heightDots: 1, data: "gA==" },
  "80mm": { widthDots: 8, heightDots: 1, data: "QA==" },
};
async function fixture(active = true) {
  const [place] = await suite.db
    .insert(locations)
    .values({ name: randomUUID(), invoiceLocales: ["es-ES"], operationDescription: "Hospitality" })
    .returning();
  const cfg = { locationId: locationId(place!.id), receiptLanguages: ["es-ES", "ca-ES"] };
  const [dept] = await suite.db
    .insert(departments)
    .values({
      locationId: cfg.locationId,
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
  await suite.db.execute(
    sql`insert into department_receipts (department_id, receipt, logo_rasters, updated_at) values (${id}, ${receipt}, ${rasters}, '2026-10-10T00:00:00Z') on conflict (department_id) do update set receipt = excluded.receipt, logo_rasters = excluded.logo_rasters`,
  );
}

describe("department receipt storage", () => {
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
        f.cfg,
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
    expect(await scoped((tx) => receipts.readDepartmentLogoRasters(tx, f.cfg, f.id))).toEqual(pair);
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(tx, f.cfg, f.id, { footerMessage: { "es-ES": "Adiós" } }),
    );
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
      footerMessage: { "es-ES": "Adiós" },
    });
    expect(await scoped((tx) => receipts.readDepartmentLogoRasters(tx, f.cfg, f.id))).toBeNull();
    const rows = (
      await suite.db.execute(
        sql`select department_id from department_receipts where department_id = ${f.id}`,
      )
    ).rows;
    expect(rows).toHaveLength(1);
  });
  it("keeps recorded receipt settings internally while hiding deleted departments from management", async () => {
    const f = await fixture();
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(tx, f.cfg, f.id, { email: "old@example.com" }),
    );
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
    expect(await scoped((tx) => listDepartments(tx, f.cfg))).toEqual([]);
    expect(
      await suite.db.select().from(departments).where(eq(departments.id, f.id)),
    ).toContainEqual(expect.objectContaining({ id: f.id, isDefault: true, active: false }));
  });
  it("refuses another location and unknown ids without changing the saved row", async () => {
    const a = await fixture();
    const b = await fixture();
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(tx, a.cfg, a.id, { phone: "+34911234567" }),
    );
    for (const id of [a.id, randomUUID()]) {
      await expect(
        scoped((tx) => receipts.writeDepartmentReceipt(tx, b.cfg, id, { phone: "+34917654321" })),
      ).rejects.toMatchObject({ code: "department.not_found" });
      await expect(
        scoped((tx) => receipts.readDepartmentReceipt(tx, b.cfg, id)),
      ).rejects.toMatchObject({ code: "department.not_found" });
    }
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, a.cfg, a.id))).toEqual({
      phone: "+34911234567",
    });
  });
  it("requires two printable pictures for a named logo", async () => {
    const f = await fixture();
    for (const pictures of [undefined, { ...pair, "80mm": { ...pair["80mm"], data: "?" } }]) {
      await expect(
        scoped((tx) =>
          receipts.writeDepartmentReceipt(
            tx,
            f.cfg,
            f.id,
            { logo: `${"a".repeat(64)}.png` },
            pictures,
          ),
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
    ).toEqual({ receipt: {}, logo: null });
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
        if (JSON.stringify(args[0]).includes("department_receipts")) seen.push(result);
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
    expect(await scoped((tx) => receipts.readDepartmentLogoRasters(tx, f.cfg, f.id))).toBeNull();
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
    expect(await scoped((tx) => receipts.readDepartmentLogoRasters(tx, f.cfg, f.id))).toBeNull();
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
        if (JSON.stringify(args[0]).includes("department_receipts")) seen.push(result);
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
      ).toEqual({ receipt: {}, logo: null });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("receipt department lookups", () => {
  it("never substitutes the designated default for a missing or null sale header", async () => {
    const f = await fixture(false);
    const nodeId = await seedNode(suite.db, f.cfg.locationId);
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
      })
      .returning();
    expect(await scoped((tx) => receipts.receiptDepartmentForSale(tx, f.cfg, sale!.id))).toBeNull();
    await suite.db
      .insert(saleReceiptHeaders)
      .values({ saleId: sale!.id, departmentId: null, tradingName: "", printTradingName: false });
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
        await scoped((tx) => receipts.VENUE_SERVICE.receiptDepartmentForSale(tx, f.cfg, sale!.id)),
      ).toBeNull();
      expect(selects).toHaveLength(1);
      expect(selects[0]).not.toContain("is_default");
    } finally {
      spy.mockRestore();
    }
    expect(await scoped((tx) => receipts.receiptDefaultDepartment(tx, f.cfg))).toBeNull();
  });
  it("reads the recorded disabled sale department within its location", async () => {
    const f = await fixture(false);
    const other = await fixture();
    const nodeId = await seedNode(suite.db, f.cfg.locationId);
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
      })
      .returning();
    await suite.db.insert(saleReceiptHeaders).values({
      saleId: sale!.id,
      departmentId: f.id,
      tradingName: "Saved name",
      printTradingName: true,
    });
    expect(
      await scoped((tx) => receipts.VENUE_SERVICE.receiptDepartmentForSale(tx, f.cfg, sale!.id)),
    ).toBe(f.id);
    expect(
      await scoped((tx) => receipts.receiptDepartmentForSale(tx, other.cfg, sale!.id)),
    ).toBeNull();
  });
  it("reads authoritative order context without borrowing a default or another location", async () => {
    const f = await fixture();
    const other = await fixture();
    const nodeId = await seedNode(suite.db, f.cfg.locationId);
    const [order] = await suite.db
      .insert(workingOrders)
      .values({ nodeId, locationId: f.cfg.locationId, source: "readiness_test", orderNumber: 1 })
      .returning();
    expect(
      await scoped((tx) => receipts.receiptDepartmentForOrder(tx, f.cfg, order!.id)),
    ).toBeNull();
    const [zone] = await suite.db
      .insert(floorZones)
      .values({ locationId: f.cfg.locationId, name: "Bar" })
      .returning();
    await suite.db.insert(orderServiceContexts).values({
      workingOrderId: order!.id,
      locationId: f.cfg.locationId,
      zoneId: zone!.id,
      departmentId: f.id,
      serviceMode: "prepay",
    });
    expect(
      await scoped((tx) => receipts.VENUE_SERVICE.receiptDepartmentForOrder(tx, f.cfg, order!.id)),
    ).toBe(f.id);
    expect(
      await scoped((tx) => receipts.receiptDepartmentForOrder(tx, other.cfg, order!.id)),
    ).toBeNull();
  });
  it("ignores a deleted designated default and returns no department for an empty location", async () => {
    const f = await fixture(false);
    expect(
      await scoped((tx) => receipts.VENUE_SERVICE.receiptDefaultDepartment(tx, f.cfg)),
    ).toBeNull();
    const [empty] = await suite.db
      .insert(locations)
      .values({ name: "Empty", invoiceLocales: ["es-ES"], operationDescription: "Hospitality" })
      .returning();
    expect(
      await scoped((tx) =>
        receipts.receiptDefaultDepartment(tx, { locationId: locationId(empty!.id) }),
      ),
    ).toBeNull();
  });
  it("makes storage available through the module seat", async () => {
    const f = await fixture();
    await scoped((tx) =>
      receipts.VENUE_SERVICE.writeDepartmentReceipt(tx, f.cfg, f.id, { email: "seat@example.com" }),
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
      await scoped((tx) => receipts.VENUE_SERVICE.readDepartmentLogoRasters(tx, f.cfg, f.id)),
    ).toBeNull();
  });
});

describe("department-owned address and fiscal description", () => {
  it.each([true, false])(
    "round trips the department address switch %s and description",
    async (printAddress) => {
      const f = await fixture();
      const receipt = { printAddress, operationDescription: "Dining service" };
      await scoped((tx) => receipts.writeDepartmentReceipt(tx, f.cfg, f.id, receipt));
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
  it("clears both fields without taking the other department or location value", async () => {
    const f = await fixture();
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(tx, f.cfg, f.id, {
        printAddress: true,
        operationDescription: "Dining service",
      }),
    );
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
      printAddress: true,
      operationDescription: "Dining service",
    });
    const other = await scoped((tx) => createDepartment(tx, f.cfg, { name: "Deli" }));
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(tx, f.cfg, other.id, {
        printAddress: true,
        operationDescription: "Other department",
      }),
    );
    await scoped((tx) => receipts.writeDepartmentReceipt(tx, f.cfg, f.id, {}));
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({});
  });
  it.each([
    { printAddress: 1 },
    { printAddress: "true" },
    { printAddress: null },
    { operationDescription: null },
    { operationDescription: [] },
    { operationDescription: "x".repeat(501) },
    { operationDescription: "bad\u0000text" },
  ])("omits malformed optional imported fields %j", async (receipt) => {
    const f = await fixture();
    await imported(f.id, JSON.stringify(receipt));
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({});
  });
});

describe("receipt and printing policy transaction", () => {
  it("reads the department creation policy even before an authored receipt exists", async () => {
    const f = await fixture();
    expect(await scoped((tx) => receipts.readDepartmentReceiptPolicy(tx, f.cfg, f.id))).toEqual({
      receiptPrintMode: "auto",
      printTradingName: true,
    });
  });
  it("saves receipt and policy while preserving the department's other service choices", async () => {
    const f = await fixture();
    await suite.db.insert(departmentSalePolicies).values({
      departmentId: f.id,
      orderStart: "table",
      paidWhen: "ticket_then_pay",
      collectionNumber: "numbered",
    });
    const receipt = { printAddress: false, operationDescription: "Dining service" };
    const policy = { receiptPrintMode: "on_request" as const, printTradingName: false };
    await scoped((tx) =>
      receipts.saveDepartmentReceiptSettings(tx, f.cfg, f.id, { receipt, policy }),
    );
    expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual(receipt);
    expect(await scoped((tx) => receipts.readDepartmentReceiptPolicy(tx, f.cfg, f.id))).toEqual(
      policy,
    );
    expect(
      await suite.db
        .select()
        .from(departmentSalePolicies)
        .where(eq(departmentSalePolicies.departmentId, f.id)),
    ).toEqual([
      {
        departmentId: f.id,
        orderStart: "table",
        paidWhen: "ticket_then_pay",
        collectionNumber: "numbered",
        ...policy,
      },
    ]);
  });
  it("rolls receipt and department state back when the subsequent policy write is refused", async () => {
    const f = await fixture();
    await scoped((tx) =>
      receipts.writeDepartmentReceipt(tx, f.cfg, f.id, { operationDescription: "Old description" }),
    );
    await suite.db.execute(
      sql`CREATE TRIGGER test_receipt_policy_refusal AFTER UPDATE OF receipt ON department_receipts BEGIN UPDATE departments SET active = 0 WHERE id = NEW.department_id; END`,
    );
    try {
      await expect(
        scoped((tx) =>
          receipts.saveDepartmentReceiptSettings(tx, f.cfg, f.id, {
            receipt: { operationDescription: "New description" },
            policy: { receiptPrintMode: "on_request", printTradingName: false },
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
          .select()
          .from(departmentSalePolicies)
          .where(eq(departmentSalePolicies.departmentId, f.id)),
      ).toEqual([]);
    } finally {
      await suite.db.execute(sql`DROP TRIGGER test_receipt_policy_refusal`);
    }
  });
  it("refuses a policy read or write for an unknown or deleted department", async () => {
    const f = await fixture(false);
    for (const id of [f.id, randomUUID()]) {
      await expect(
        scoped((tx) => receipts.readDepartmentReceiptPolicy(tx, f.cfg, id)),
      ).rejects.toMatchObject({ code: "department.not_found" });
      await expect(
        scoped((tx) =>
          receipts.saveDepartmentReceiptSettings(tx, f.cfg, id, {
            receipt: {},
            policy: { receiptPrintMode: "auto", printTradingName: true },
          }),
        ),
      ).rejects.toMatchObject({ code: "department.not_found" });
    }
  });
});

it("keeps a JSON-looking string distinct from a JSON array", async () => {
  const f = await fixture();
  await scoped((tx) =>
    receipts.writeDepartmentReceipt(tx, f.cfg, f.id, { operationDescription: "[]" }),
  );
  expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
    operationDescription: "[]",
  });
});

it("refuses another location's receipt policy while serving its owning location", async () => {
  const own = await fixture();
  const other = await fixture();
  await expect(
    scoped((tx) => receipts.readDepartmentReceiptPolicy(tx, own.cfg, other.id)),
  ).rejects.toMatchObject({ code: "department.not_found", params: { departmentId: other.id } });
  expect(
    await scoped((tx) => receipts.readDepartmentReceiptPolicy(tx, other.cfg, other.id)),
  ).toEqual({ receiptPrintMode: "auto", printTradingName: true });
});

it.each([
  { label: "500 characters", value: "x".repeat(500) },
  { label: "250 supplementary characters", value: "😀".repeat(250) },
  { label: "permitted text whitespace", value: "Dining\tand drinks\n" },
])("reads a valid $label description without changing its spelling", async ({ value }) => {
  const f = await fixture();
  await scoped((tx) =>
    receipts.writeDepartmentReceipt(tx, f.cfg, f.id, { operationDescription: value }),
  );
  expect(await scoped((tx) => receipts.readDepartmentReceipt(tx, f.cfg, f.id))).toEqual({
    operationDescription: value,
  });
});

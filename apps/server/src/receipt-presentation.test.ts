import { seedPhotoMetadata } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  sales,
  tenders,
  saleSubstitutions,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedNode,
  seedVenue,
  seedDepartmentReceipt,
  seedWorkingOrder,
} from "@waitron/db/testing/seed.js";
import { departments } from "@waitron/venue-service";
import { PAYMENTS_MIGRATIONS, payments } from "@waitron/payments";
import { readReceiptPresentation } from "./receipt-presentation.js";
import { uploadImage, saveImage, readPresentations } from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import * as media from "@waitron/media";
import { putThemeInUse, UNTRUSTED_CASES, type UntrustedCase } from "./testing/theme-logo.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
async function fixture(header: "department" | "null" | "absent" = "department", db = suite.db) {
  await seedVenue(db, {
    name: randomUUID(),
    invoiceLocales: ["es-ES"],
    addressLine1: "Current street",
    city: "Madrid",
  });
  const cfg = {};
  const nodeId = await seedNode(db);
  const [department] = await db
    .insert(departments)
    .values({ name: "Dining", tradingName: "Live brand" })
    .returning();
  const [series] = await db.insert(invoiceSeries).values({ nodeId, code: "F" }).returning();
  const [sale] = await db
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
      ...(header === "absent"
        ? {}
        : {
            receiptDepartmentId: header === "null" ? null : department!.id,
            receiptTradingName: "Recorded brand",
            receiptPrintsTradingName: true,
          }),
    })
    .returning();

  const authored = async (receipt: Record<string, unknown>) => {
    await seedDepartmentReceipt(db, department!.id, receipt);
  };
  const read = (language = "es-ES", practice = false) =>
    withTransaction(db, (tx) => readReceiptPresentation(tx, sale!.id, language, practice));
  return { cfg, sale: sale!, departmentId: department!.id, read, authored };
}

describe("department-only on-screen receipt", () => {
  it("keeps optional receipt facts when the logo presentation read fails and reports that read", async () => {
    const f = await fixture();
    const logo = `${"d".repeat(64)}.png`;
    await seedPhotoMetadata(suite.db, { filename: logo, names: {} });
    await f.authored({ logo, phone: "910111111" });
    const read = vi
      .spyOn(media, "readPresentations")
      .mockRejectedValue(new Error("unavailable image table"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await f.read();
      expect(result.receiptTrim).toEqual({ logo, phone: "910111111" });
      expect(warn).toHaveBeenCalledWith("receipt.optional_read_failed", {
        operation: "readReceiptLogoPresentation",
        code: "receipt.read_failed",
      });
    } finally {
      read.mockRestore();
      warn.mockRestore();
    }
  });
  it("resolves a current immutable logo URL while preserving the photo reference and earlier answer", async () => {
    const f = await fixture();
    const source = await samplePreparedImage({ width: 800, height: 200 });
    const { image } = await withTransaction(suite.db, (tx) =>
      uploadImage(tx, { image: source, names: { es: "Logo", en: "Logo" } }),
    );
    await f.authored({ logo: image.filename, phone: "910111111" });
    const before = await f.read();
    const snapshot = structuredClone(before);
    expect(before.receiptTrim).toMatchObject({
      logo: image.filename,
      logoUrl: `/media/renditions/v1/${source.filename}/display/5000-5000-100.webp`,
      phone: "910111111",
    });
    const replacement = await samplePreparedImage({ width: 900, height: 300 });
    await withTransaction(suite.db, (tx) =>
      saveImage(
        tx,
        image.id,
        {
          names: image.names,
          framing: { x: 7500, y: 2500, zoom: 200 },
          expectedRevision: image.revision,
        },
        replacement,
        {
          "58mm": { widthDots: 8, heightDots: 1, data: "AA==" },
          "80mm": { widthDots: 8, heightDots: 1, data: "AA==" },
        },
        "es",
      ),
    );
    const after = await f.read();
    expect(after.receiptTrim).toMatchObject({
      logo: image.filename,
      logoUrl: `/media/renditions/v1/${replacement.filename}/display/7500-2500-200.webp`,
      phone: "910111111",
    });
    expect(before).toEqual(snapshot);
  });
  it.each(["department", "null", "absent"] as const)(
    "has no optional decoration for an empty %s context",
    async (header) => {
      const f = await fixture(header);
      if (header === "department") await f.authored({});
      const presentation = await f.read();
      expect(presentation.receiptTrim).toEqual({});
      expect(presentation).toHaveProperty("receiptSettings", { printAddress: false });
      expect(presentation).not.toHaveProperty("venueReceiptSettings");
      expect(presentation.receiptHeader).toEqual(
        header === "department"
          ? { departmentId: f.departmentId, tradingName: "Recorded brand", printTradingName: true }
          : undefined,
      );
    },
  );

  it.each([undefined, false, true])(
    "requires explicit address consent %j while keeping department wording",
    async (printAddress) => {
      const f = await fixture();
      await seedPhotoMetadata(suite.db, { filename: `${"b".repeat(64)}.png`, names: {} });
      await f.authored({
        ...(printAddress === undefined ? {} : { printAddress }),
        logo: `${"b".repeat(64)}.png`,
        phone: "910111111",
        email: "own@example.test",
        headerSubtitle: { "ca-ES": "Own Catalan", "es-ES": "Own Spanish" },
        footerMessage: { "es-ES": "Own footer" },
      });
      const presentation = await f.read("ca-ES");
      expect(presentation.receiptTrim).toEqual({
        logo: `${"b".repeat(64)}.png`,
        logoUrl:
          "/media/renditions/v1/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png/display/5000-5000-100.webp",
        phone: "910111111",
        email: "own@example.test",
        headerSubtitle: "Own Catalan",
        footerMessage: "Own footer",
      });
      expect(presentation).toHaveProperty("receiptSettings", {
        printAddress: printAddress === true,
      });
      expect(presentation.venueAddress).toEqual(["Current street", "Madrid"]);
    },
  );

  it("reads a deleted department's stored language and clears optional values on a later answer", async () => {
    const f = await fixture();
    await f.authored({
      printAddress: true,
      headerSubtitle: { "eu-ES": "Retained Basque", "es-ES": "Spanish" },
      footerMessage: { "es-ES": "Own footer" },
    });
    await suite.db
      .update(departments)
      .set({ active: false })
      .where(eq(departments.id, f.departmentId));
    expect(await f.read("eu-ES")).toMatchObject({
      receiptTrim: { headerSubtitle: "Retained Basque", footerMessage: "Own footer" },
      receiptSettings: { printAddress: true },
    });
    await f.authored({});
    expect(await f.read("eu-ES")).toMatchObject({
      receiptTrim: {},
      receiptSettings: { printAddress: false },
    });
  });

  it.each(["department"])(
    "ignores retired storage and bounds diagnostics with %s storage absent",
    async (source) => {
      const f = await fixture();
      await f.authored({ printAddress: true, headerSubtitle: { "es-ES": "Own subtitle" } });
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      const hiddenDepartment = source !== "venue";
      try {
        if (hiddenDepartment)
          await suite.db.execute(
            sql`alter table departments rename column receipt_text to test_hidden_receipt_text`,
          );
        const presentation = await f.read();
        expect(presentation.receiptTrim).toEqual(
          hiddenDepartment ? {} : { headerSubtitle: "Own subtitle" },
        );
        expect(presentation).toHaveProperty("receiptSettings", { printAddress: !hiddenDepartment });
        expect(warning.mock.calls).toEqual(
          hiddenDepartment
            ? [
                [
                  "receipt.optional_read_failed",
                  {
                    operation: "readPrintedDepartmentReceipt",
                    departmentId: f.departmentId,
                    code: "receipt.read_failed",
                  },
                ],
              ]
            : [],
        );
      } finally {
        if (hiddenDepartment)
          await suite.db.execute(
            sql`alter table departments rename column test_hidden_receipt_text to receipt_text`,
          );
        warning.mockRestore();
      }
    },
  );
});

describe("the theme's logo on the ticket view", () => {
  let drawn = 0;
  async function libraryImage(name: string): Promise<{ filename: string; display: string }> {
    drawn += 1;
    const source = await samplePreparedImage({ width: 800 + drawn, height: 200 });
    const { image } = await withTransaction(suite.db, (tx) =>
      uploadImage(tx, { image: source, names: { es: name, en: name } }),
    );
    const presentations = await withTransaction(suite.db, (tx) =>
      readPresentations(tx, [image.filename]),
    );
    return { filename: image.filename, display: presentations[image.filename]!.display };
  }

  async function themeImages() {
    const light = await libraryImage("Light");
    const dark = await libraryImage("Dark");
    expect(dark.filename).not.toBe(light.filename);
    expect(dark.display).not.toBe(light.display);
    await putThemeInUse(suite.db, { light: light.filename, dark: dark.filename });
    return { light, dark };
  }

  it("a department with no receipt logo shows the theme's light image", async () => {
    const f = await fixture();
    const { light } = await themeImages();
    const presentation = await f.read();
    expect(presentation.receiptTrim).toEqual({ logo: light.filename, logoUrl: light.display });
  });

  it.each(["null", "absent"] as const)(
    "a sale with no department shows it too (%s header)",
    async (header) => {
      const f = await fixture(header);
      const { light } = await themeImages();
      const presentation = await f.read();
      expect(presentation.receiptTrim).toEqual({ logo: light.filename, logoUrl: light.display });
    },
  );

  it("theme dots that cannot print still show the image on the ticket", async () => {
    const f = await fixture();
    const light = await libraryImage("Light");
    await putThemeInUse(suite.db, {
      light: light.filename,
      printedLogo: { "80mm": { widthDots: 16, heightDots: 1, data: "x" } },
    });
    const presentation = await f.read();
    expect(presentation.receiptTrim).toEqual({ logo: light.filename, logoUrl: light.display });
  });

  it("a department's own logo wins", async () => {
    const f = await fixture();
    await themeImages();
    const own = await libraryImage("Own");
    await f.authored({ logo: own.filename });
    const presentation = await f.read();
    expect(presentation.receiptTrim).toEqual({ logo: own.filename, logoUrl: own.display });
  });

  async function untrustedRead(untrusted: UntrustedCase, own: boolean) {
    const f = await fixture();
    const { light } = await themeImages();
    const ownImage = own ? await libraryImage("Own") : null;
    if (ownImage) await f.authored({ logo: ownImage.filename });
    const at = { departmentId: f.departmentId };
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const control = await f.read();
      const expected = ownImage ?? light;
      expect(control.receiptTrim).toEqual({ logo: expected.filename, logoUrl: expected.display });
      await untrusted.apply(suite.db, at);
      try {
        const presentation = await f.read();
        return { control, presentation, light, ownImage };
      } finally {
        await untrusted.undo(suite.db, at);
      }
    } finally {
      warning.mockRestore();
    }
  }

  function expectNoLogo(
    untrusted: UntrustedCase,
    presentation: Awaited<ReturnType<typeof untrustedRead>>["presentation"],
  ) {
    expect(presentation.receiptTrim.logo).toBeUndefined();
    expect(presentation.receiptTrim.logoUrl).toBeUndefined();
    if (untrusted.name === "a numeric logo")
      expect(presentation.receiptTrim.phone).toBe("910111111");
  }

  it.each(UNTRUSTED_CASES.map((c) => [c.name, c] as const))(
    "shows no logo when the department cannot be trusted: %s",
    async (_name, untrusted) => {
      const { presentation } = await untrustedRead(untrusted, false);
      expectNoLogo(untrusted, presentation);
    },
  );

  it.each(UNTRUSTED_CASES.map((c) => [c.name, c] as const))(
    "a department's own logo shows until it cannot be trusted, then no logo shows: %s",
    async (_name, untrusted) => {
      const { presentation } = await untrustedRead(untrusted, true);
      expectNoLogo(untrusted, presentation);
    },
  );
});

describe("receipt charge wording", () => {
  const paid = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

  it.each([
    ["sumup", "captured", false],
    ["sumup", "refunded", false],
    ["sumup", "partially_refunded", false],
    ["sumup", "attempting", false],
    ["sumup", "failed", false],
    ["sumup", "voided", false],
    ["sumup", "initiated", false],
    ["simulator", "captured", true],
    ["simulator", "refunded", true],
    ["simulator", "partially_refunded", true],
    ["simulator", "failed", false],
    ["manual", "captured", false],
  ] as const)("uses saved %s %s facts in Prepare", async (provider, state, expected) => {
    const f = await fixture("absent", paid.db);
    const order = await seedWorkingOrder(paid.db);
    await paid.db.insert(payments).values({
      workingOrderId: order.id,
      source: "readiness_test",
      saleId: f.sale.id,
      provider,
      state,
      paymentRef: randomUUID(),
      amount: 140,
    });
    expect((await f.read("es-ES", true)).simulatedCardPayment).toBe(expected);
    expect((await f.read("es-ES", false)).simulatedCardPayment).toBe(false);
  });

  it.each(["sumup", "simulator"] as const)(
    "keeps saved %s facts on corrective and substituted documents after refund",
    async (provider) => {
      const f = await fixture("absent", paid.db);
      const order = await seedWorkingOrder(paid.db);
      await paid.db.insert(payments).values([
        {
          workingOrderId: order.id,
          source: "readiness_test",
          saleId: f.sale.id,
          provider: "simulator",
          state: "captured",
          paymentRef: randomUUID(),
          amount: 40,
        },
        {
          workingOrderId: order.id,
          source: "readiness_test",
          saleId: f.sale.id,
          provider,
          state: "refunded",
          paymentRef: randomUUID(),
          amount: 100,
        },
      ]);
      const [corrective] = await paid.db
        .insert(sales)
        .values({
          ...f.sale,
          id: randomUUID(),
          invoiceNumber: 2,
          correctsSaleId: f.sale.id,
        })
        .returning();
      const [substitute] = await paid.db
        .insert(sales)
        .values({
          ...f.sale,
          id: randomUUID(),
          invoiceNumber: 3,
        })
        .returning();
      await paid.db.insert(saleSubstitutions).values({
        substitutionSaleId: substitute!.id,
        substitutedSaleId: corrective!.id,
      });
      for (const id of [f.sale.id, corrective!.id, substitute!.id]) {
        const receipt = await withTransaction(paid.db, (tx) =>
          readReceiptPresentation(tx, id, "es-ES", true),
        );
        expect(receipt.simulatedCardPayment).toBe(provider === "simulator");
      }
    },
  );
  it("does not call a mixed cash and simulator payment uncharged", async () => {
    const f = await fixture("absent", paid.db);
    const order = await seedWorkingOrder(paid.db);
    await paid.db.insert(payments).values({
      workingOrderId: order.id,
      source: "readiness_test",
      saleId: f.sale.id,
      provider: "simulator",
      state: "captured",
      paymentRef: randomUUID(),
      amount: 100,
    });
    await paid.db.insert(tenders).values({
      saleId: f.sale.id,
      method: "cash",
      amount: 40,
      cashTendered: 40,
      settledAt: "2026-11-17T17:36:29.000Z",
    });
    expect((await f.read("es-ES", true)).simulatedCardPayment).toBe(false);
  });
});

describe("receipt wording with Payments off", () => {
  it("makes no no-charge claim without a payments table", async () => {
    const f = await fixture("absent");
    expect((await f.read("es-ES", true)).simulatedCardPayment).toBe(false);
    expect((await f.read("es-ES", false)).simulatedCardPayment).toBe(false);
  });
});

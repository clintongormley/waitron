import { CORE_MIGRATIONS, captureError, tenantReceipts, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEFAULT_RECEIPT } from "./defaults.js";
import { encodeLogoRaster, getReceipt, getReceiptLogo, putReceipt } from "./receipt-store.js";
import type { ReceiptConfig, ReceiptLogoRasters, StoredLogoRaster } from "./types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

/** Through drizzle rather than raw SQL: `persons.id` and `created_at` take their value from the
 * table's `$defaultFn`, which is not a SQL DEFAULT, so a raw insert naming neither is refused
 * `NOT NULL constraint failed: persons.id`. */
async function seedSession(role: PersonRoleValue): Promise<string> {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Operator", pinHash: "seed-pin-hash", role })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  return session.token;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `did not throw an AppError: ${String(error)}`;
}

async function rowCount(): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from tenant_receipts`,
  );
  return rows.rows[0]!.n;
}

describe("tenant receipt store against a real migrated database", () => {
  it("returns DEFAULT_RECEIPT ({}) for a tenant that has never authored a receipt", async () => {
    await seedTenant(suite.db);
    expect(await inTx((tx) => getReceipt(tx))).toEqual(DEFAULT_RECEIPT);
  });

  it("round-trips a manager-authored receipt through put → get", async () => {
    await seedTenant(suite.db);
    const managerSession = await seedSession("manager");
    const receipt: ReceiptConfig = { headerSubtitle: "Hola" };
    await inTx((tx) => putReceipt(tx, { managementSessionId: managerSession, receipt }));
    expect(await inTx((tx) => getReceipt(tx))).toEqual(receipt);
  });

  it("upserts the single per-tenant row on a second put — no duplicate", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    await inTx((tx) =>
      putReceipt(tx, {
        managementSessionId: session,
        receipt: { headerSubtitle: "Calle Mayor 1" },
      }),
    );
    const next: ReceiptConfig = { footerMessage: "Gracias por su visita" };
    await inTx((tx) => putReceipt(tx, { managementSessionId: session, receipt: next }));
    expect(await rowCount()).toBe(1);
    expect(await inTx((tx) => getReceipt(tx))).toEqual(next);
  });

  it("refuses a put from a staff-role session — the authorizeManager gate (differential)", async () => {
    await seedTenant(suite.db);
    const staffSession = await seedSession("staff");
    const code = await codeOf(() =>
      inTx((tx) =>
        putReceipt(tx, {
          managementSessionId: staffSession,
          receipt: { footerMessage: "Gracias" },
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    expect(await rowCount()).toBe(0); // the gate ran before the write
  });

  it("rejects an invalid receipt with receipt.invalid before any INSERT", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    // A manager passes the gate, so this refusal is validation's.
    const code = await codeOf(() =>
      inTx((tx) =>
        putReceipt(tx, {
          managementSessionId: session,
          receipt: { unknownField: "x" },
        }),
      ),
    );
    expect(code).toBe("receipt.invalid");
    expect(await rowCount()).toBe(0); // validate threw before the INSERT
  });
});

const LOGO = `${"ab".repeat(32)}.png`;
const OTHER_LOGO = `${"cd".repeat(32)}.webp`;

/** A raster `widthDots` × `heightDots` with every byte `fill`, as the store keeps it. */
function stored(widthDots: number, heightDots: number, fill = 0xa5): StoredLogoRaster {
  const bits = new Uint8Array(Math.ceil(widthDots / 8) * heightDots).fill(fill);
  return { widthDots, heightDots, data: Buffer.from(bits).toString("base64") };
}

const RASTERS: ReceiptLogoRasters = { "58mm": stored(360, 160), "80mm": stored(504, 80, 0x0f) };

async function storedJson(): Promise<Record<string, unknown> | undefined> {
  const [row] = await suite.db.select({ receipt: tenantReceipts.receipt }).from(tenantReceipts);
  return row?.receipt as Record<string, unknown> | undefined;
}

/** Writes the row as an import would: whatever JSON it carries, unchecked. */
async function storeRaw(receipt: unknown): Promise<void> {
  await suite.db.insert(tenantReceipts).values({ receipt });
}

describe("the receipt logo", () => {
  it("stores the rasters beside the logo, never returns them from getReceipt, and returns each paper's for printing", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const receipt = { logo: LOGO, phone: "912 345 678" };
    await inTx((tx) =>
      putReceipt(tx, { managementSessionId: session, receipt, logoRasters: RASTERS }),
    );
    expect(await inTx((tx) => getReceipt(tx))).toEqual(receipt);
    expect((await storedJson())?.logoRasters).toEqual(RASTERS);
    const narrow = await inTx((tx) => getReceiptLogo(tx, "58mm"));
    expect(narrow).toEqual({
      widthDots: 360,
      heightDots: 160,
      bits: new Uint8Array(45 * 160).fill(0xa5),
    });
    const wide = await inTx((tx) => getReceiptLogo(tx, "80mm"));
    expect(wide).toEqual({
      widthDots: 504,
      heightDots: 80,
      bits: new Uint8Array(63 * 80).fill(0x0f),
    });
  });

  it("strips logoRasters from getReceipt even when an import stored the row", async () => {
    await seedTenant(suite.db);
    await storeRaw({ footerMessage: "Hola", logo: LOGO, logoRasters: RASTERS });
    expect(await inTx((tx) => getReceipt(tx))).toEqual({ footerMessage: "Hola", logo: LOGO });
  });

  it("refuses a logo with no rasters when none are stored for it, writing nothing", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const error = await captureError(() =>
      inTx((tx) => putReceipt(tx, { managementSessionId: session, receipt: { logo: LOGO } })),
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/raster/);
    expect(await rowCount()).toBe(0);
  });

  it("refuses a CHANGED logo with no rasters, keeping the stored logo and its rasters", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    await inTx((tx) =>
      putReceipt(tx, {
        managementSessionId: session,
        receipt: { logo: LOGO },
        logoRasters: RASTERS,
      }),
    );
    const error = await captureError(() =>
      inTx((tx) => putReceipt(tx, { managementSessionId: session, receipt: { logo: OTHER_LOGO } })),
    );
    expect(String(error)).toMatch(/raster/);
    expect(await storedJson()).toEqual({ logo: LOGO, logoRasters: RASTERS });
  });

  it("keeps the stored rasters when the logo is unchanged and none are given", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    await inTx((tx) =>
      putReceipt(tx, {
        managementSessionId: session,
        receipt: { logo: LOGO },
        logoRasters: RASTERS,
      }),
    );
    await inTx((tx) =>
      putReceipt(tx, {
        managementSessionId: session,
        receipt: { logo: LOGO, footerMessage: "Gracias" },
      }),
    );
    expect(await storedJson()).toEqual({
      logo: LOGO,
      footerMessage: "Gracias",
      logoRasters: RASTERS,
    });
  });

  it("refuses an unchanged logo with no rasters when the stored ones are not printable", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    await storeRaw({ logo: LOGO, logoRasters: { ...RASTERS, "80mm": stored(505, 1) } });
    const error = await captureError(() =>
      inTx((tx) => putReceipt(tx, { managementSessionId: session, receipt: { logo: LOGO } })),
    );
    expect(String(error)).toMatch(/raster/);
  });

  it("replaces the rasters when new ones are given", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    await inTx((tx) =>
      putReceipt(tx, {
        managementSessionId: session,
        receipt: { logo: LOGO },
        logoRasters: RASTERS,
      }),
    );
    const next: ReceiptLogoRasters = { "58mm": stored(8, 1), "80mm": stored(16, 2) };
    await inTx((tx) =>
      putReceipt(tx, {
        managementSessionId: session,
        receipt: { logo: OTHER_LOGO },
        logoRasters: next,
      }),
    );
    expect(await storedJson()).toEqual({ logo: OTHER_LOGO, logoRasters: next });
  });

  it("removes the rasters when the logo is removed, and stores none given without a logo", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    await inTx((tx) =>
      putReceipt(tx, {
        managementSessionId: session,
        receipt: { logo: LOGO },
        logoRasters: RASTERS,
      }),
    );
    await inTx((tx) =>
      putReceipt(tx, {
        managementSessionId: session,
        receipt: { footerMessage: "Adiós" },
        logoRasters: RASTERS,
      }),
    );
    expect(await storedJson()).toEqual({ footerMessage: "Adiós" });
    expect(await inTx((tx) => getReceiptLogo(tx, "80mm"))).toBeNull();
  });

  it.each([
    ["a 58 mm raster wider than its paper's safe width", { "58mm": stored(361, 1) }],
    ["an 80 mm raster wider than its paper's safe width", { "80mm": stored(505, 1) }],
    ["a raster taller than 160 dots", { "58mm": stored(8, 161) }],
    [
      "data one byte short",
      { "58mm": { ...stored(16, 2), data: Buffer.alloc(3).toString("base64") } },
    ],
    ["a missing paper", { "58mm": undefined }],
  ])("refuses given rasters with %s, writing nothing", async (_, broken) => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const logoRasters = { ...RASTERS, ...broken } as ReceiptLogoRasters;
    const error = await captureError(() =>
      inTx((tx) =>
        putReceipt(tx, { managementSessionId: session, receipt: { logo: LOGO }, logoRasters }),
      ),
    );
    expect(String(error)).toMatch(/raster/);
    expect(await rowCount()).toBe(0);
  });

  it("returns no logo for a venue with no receipt row, or a receipt naming no logo", async () => {
    await seedTenant(suite.db);
    expect(await inTx((tx) => getReceiptLogo(tx, "58mm"))).toBeNull();
    await storeRaw({ logoRasters: RASTERS });
    expect(await inTx((tx) => getReceiptLogo(tx, "58mm"))).toBeNull();
  });

  it.each<[string, unknown]>([
    ["no rasters at all", undefined],
    ["rasters that are not an object", "abc"],
    ["rasters that are an array", [stored(8, 1)]],
    ["no raster for the paper", { "80mm": stored(8, 1) }],
    ["a raster that is not an object", { "58mm": 7 }],
    ["a width wider than the paper's safe width", { "58mm": stored(361, 1) }],
    ["a height over 160 dots", { "58mm": stored(8, 161) }],
    ["a zero width", { "58mm": { ...stored(8, 1), widthDots: 0 } }],
    ["a negative height", { "58mm": { ...stored(8, 1), heightDots: -1 } }],
    ["a fractional width", { "58mm": { ...stored(8, 1), widthDots: 7.5 } }],
    ["a width given as text", { "58mm": { ...stored(8, 1), widthDots: "8" } }],
    ["data that is not text", { "58mm": { ...stored(8, 1), data: [0] } }],
    [
      "data one byte short",
      { "58mm": { ...stored(16, 2), data: Buffer.alloc(3).toString("base64") } },
    ],
    [
      "data one byte long",
      { "58mm": { ...stored(16, 2), data: Buffer.alloc(5).toString("base64") } },
    ],
    ["data that is not base64", { "58mm": { ...stored(8, 1), data: "!!!!" } }],
  ])(
    "returns no logo, rather than throwing, for a stored raster with %s",
    async (_, logoRasters) => {
      await seedTenant(suite.db);
      await storeRaw({ logo: LOGO, logoRasters });
      expect(await inTx((tx) => getReceiptLogo(tx, "58mm"))).toBeNull();
    },
  );

  it("encodes a 1-bit raster as the store keeps it", () => {
    const bits = Uint8Array.of(0x80, 0x01);
    expect(encodeLogoRaster({ widthDots: 9, heightDots: 1, bits })).toEqual({
      widthDots: 9,
      heightDots: 1,
      data: "gAE=",
    });
  });
});

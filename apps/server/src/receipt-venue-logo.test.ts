import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import * as layouts from "@waitron/layouts";
import type { PrintedDepartmentReceipt } from "@waitron/module";
import { WAITRON_CHOICES } from "@waitron/ui-core/theme";
import {
  readVenueLogoName,
  resolvePrintedLogo,
  venueLogoMayPrint,
  type ReceiptReadDiagnostic,
} from "./receipt-venue-logo.js";
import {
  THEME_LOGO,
  clearThemes,
  putThemeInUse,
  saveThemeThroughRoute,
} from "./testing/theme-logo.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: seedTenant,
});

const OWN = `${"a".repeat(64)}.png`;
const OWN_BITS = { widthDots: 8, heightDots: 1, bits: new Uint8Array([0x81]) };
const OWN_LOGO: PrintedDepartmentReceipt = { receipt: { logo: OWN }, logo: OWN_BITS };
const UNTRUSTED: PrintedDepartmentReceipt = { receipt: {}, logo: null, unreadable: true };
const NO_LOGO: PrintedDepartmentReceipt = { receipt: { phone: "1" }, logo: null };
const THEME_80 = {
  venue: { logo: THEME_LOGO },
  logo: { widthDots: 16, heightDots: 1, bits: new Uint8Array([0xf0, 0x0f]) },
};
const NOTHING = { venue: {}, logo: null };

let diagnostic: ReturnType<typeof vi.fn<ReceiptReadDiagnostic>>;

beforeEach(() => {
  diagnostic = vi.fn<ReceiptReadDiagnostic>();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function inTx<T>(body: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, body);
}

async function withHiddenThemes(body: () => Promise<void>): Promise<void> {
  await suite.db.execute(sql`alter table custom_themes rename to test_hidden_custom_themes`);
  try {
    await body();
  } finally {
    await suite.db.execute(sql`alter table test_hidden_custom_themes rename to custom_themes`);
  }
}

describe("resolvePrintedLogo", () => {
  it("with no department, the theme's name and that paper's dots", async () => {
    await putThemeInUse(suite.db);
    expect(await inTx((tx) => resolvePrintedLogo(tx, null, "80mm", diagnostic))).toEqual(THEME_80);
    expect(await inTx((tx) => resolvePrintedLogo(tx, null, "58mm", diagnostic))).toEqual({
      venue: { logo: THEME_LOGO },
      logo: { widthDots: 8, heightDots: 1, bits: new Uint8Array([0xf0]) },
    });
    expect(diagnostic).not.toHaveBeenCalled();
  });

  it("a trusted department naming no logo takes the theme's", async () => {
    await putThemeInUse(suite.db);
    const read = vi.spyOn(layouts, "readPrintedThemeLogo");
    expect(await inTx((tx) => resolvePrintedLogo(tx, NO_LOGO, "80mm", diagnostic))).toEqual(
      THEME_80,
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("a department naming its own logo prints its own and reads no theme", async () => {
    await putThemeInUse(suite.db);
    const read = vi.spyOn(layouts, "readPrintedThemeLogo");
    expect(await inTx((tx) => resolvePrintedLogo(tx, OWN_LOGO, "80mm", diagnostic))).toEqual({
      venue: {},
      logo: OWN_BITS,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("a department whose own logo cannot print prints nothing, not the theme's", async () => {
    await putThemeInUse(suite.db);
    const department = { receipt: { logo: OWN }, logo: null };
    expect(await inTx((tx) => resolvePrintedLogo(tx, department, "80mm", diagnostic))).toEqual(
      NOTHING,
    );
  });

  it("an untrusted department prints nothing and reads no theme", async () => {
    await putThemeInUse(suite.db);
    const read = vi.spyOn(layouts, "readPrintedThemeLogo");
    expect(await inTx((tx) => resolvePrintedLogo(tx, UNTRUSTED, "80mm", diagnostic))).toEqual(
      NOTHING,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("no theme in use prints nothing", async () => {
    expect(await inTx((tx) => resolvePrintedLogo(tx, null, "80mm", diagnostic))).toEqual(NOTHING);
    expect(diagnostic).not.toHaveBeenCalled();
  });

  it("a theme naming a logo with no printable picture keeps the name and prints nothing", async () => {
    await putThemeInUse(suite.db, { printedLogo: undefined });
    expect(await inTx((tx) => resolvePrintedLogo(tx, null, "80mm", diagnostic))).toEqual({
      venue: { logo: THEME_LOGO },
      logo: null,
    });
    expect(diagnostic).not.toHaveBeenCalled();
  });

  it("a failed theme read reports and prints nothing", async () => {
    await putThemeInUse(suite.db);
    await withHiddenThemes(async () => {
      expect(await inTx((tx) => resolvePrintedLogo(tx, null, "80mm", diagnostic))).toEqual(NOTHING);
    });
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(diagnostic).toHaveBeenCalledWith({
      operation: "readPrintedThemeLogo",
      code: "receipt.read_failed",
    });
  });

  it("a throwing diagnostic still prints nothing rather than failing the sale", async () => {
    await putThemeInUse(suite.db);
    const throwing = vi.fn<ReceiptReadDiagnostic>(() => {
      throw new Error("diagnostic down");
    });
    await withHiddenThemes(async () => {
      expect(await inTx((tx) => resolvePrintedLogo(tx, null, "80mm", throwing))).toEqual(NOTHING);
      expect(await inTx((tx) => readVenueLogoName(tx, null, throwing))).toEqual({});
    });
    expect(throwing).toHaveBeenCalledTimes(2);
  });
});

describe("readVenueLogoName", () => {
  it("with no department, the theme's light name", async () => {
    await putThemeInUse(suite.db);
    expect(await inTx((tx) => readVenueLogoName(tx, null, diagnostic))).toEqual({
      logo: THEME_LOGO,
    });
    expect(await inTx((tx) => readVenueLogoName(tx, NO_LOGO, diagnostic))).toEqual({
      logo: THEME_LOGO,
    });
  });

  it("a department's own logo, or an untrusted one, takes no venue name", async () => {
    await putThemeInUse(suite.db);
    expect(await inTx((tx) => readVenueLogoName(tx, OWN_LOGO, diagnostic))).toEqual({});
    expect(await inTx((tx) => readVenueLogoName(tx, UNTRUSTED, diagnostic))).toEqual({});
  });

  it("no theme in use, or one with no logo, takes no venue name", async () => {
    expect(await inTx((tx) => readVenueLogoName(tx, null, diagnostic))).toEqual({});
    const id = await putThemeInUse(suite.db);
    const response = await saveThemeThroughRoute(suite.db, id, {
      ...WAITRON_CHOICES,
      logo: null,
    });
    expect(response.status).toBe(200);
    expect(await inTx((tx) => readVenueLogoName(tx, null, diagnostic))).toEqual({});
    expect(diagnostic).not.toHaveBeenCalled();
  });

  it("a failed read reports and takes no venue name", async () => {
    await putThemeInUse(suite.db);
    await withHiddenThemes(async () => {
      expect(await inTx((tx) => readVenueLogoName(tx, null, diagnostic))).toEqual({});
    });
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(diagnostic).toHaveBeenCalledWith({
      operation: "readThemeInUse",
      code: "receipt.read_failed",
    });
  });
});

describe("venueLogoMayPrint", () => {
  it("allows the venue's logo with no department or a trusted one naming none", () => {
    expect(venueLogoMayPrint(null)).toBe(true);
    expect(venueLogoMayPrint(NO_LOGO)).toBe(true);
  });

  it("refuses it for a department's own logo or an untrusted department", () => {
    expect(venueLogoMayPrint(OWN_LOGO)).toBe(false);
    expect(venueLogoMayPrint({ receipt: { logo: OWN }, logo: null })).toBe(false);
    expect(venueLogoMayPrint(UNTRUSTED)).toBe(false);
  });
});

describe("saveThemeThroughRoute", () => {
  it("saves through the real route, which drops the stored dots with the logo", async () => {
    const id = await putThemeInUse(suite.db);
    const response = await saveThemeThroughRoute(suite.db, id, {
      ...WAITRON_CHOICES,
      logo: null,
    });
    expect(response.status).toBe(200);
    const rows = await suite.db.all<{ theme: string }>(
      sql`select theme from custom_themes where id = ${id}`,
    );
    const stored = JSON.parse(rows[0]!.theme) as Record<string, unknown>;
    expect(stored.logo).toBeNull();
    expect("printedLogo" in stored).toBe(false);
    await clearThemes(suite.db);
    expect(await suite.db.all(sql`select id from custom_themes`)).toEqual([]);
  });
});

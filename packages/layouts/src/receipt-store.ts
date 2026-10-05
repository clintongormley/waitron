import { nowIso, tenantReceipts } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import {
  LOGO_MAX_HEIGHT_DOTS,
  safeWidthDots,
  type MonoRaster,
  type PaperWidth,
} from "@waitron/printing";
import { sql } from "drizzle-orm";
import { DEFAULT_RECEIPT } from "./defaults.js";
import type { ReceiptConfig, ReceiptLogoRasters, StoredLogoRaster } from "./types.js";
import { isPlainObject, RECEIPT_STRING_FIELDS, validateReceiptConfig } from "./validate.js";

const PAPER_WIDTHS: readonly PaperWidth[] = ["58mm", "80mm"];
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The row without its pictures, which are most of its size, so reading the trim parses none. */
const TRIM = sql<string>`json_remove(${tenantReceipts.receipt}, '$.logoRasters')`;

/** One stored picture as JSON text, `null` when absent. */
function storedPicture(path: string) {
  return sql<string | null>`${tenantReceipts.receipt} -> ${path}`;
}

/**
 * A configuration import copies the row unchecked, and a sale prints this trim inside its own
 * transaction, so a field of the wrong type is dropped rather than printed or thrown on; a
 * `printAddress` that is not a boolean is absent, which prints the address. A row that is not an
 * object reads as no trim at all.
 */
function parseTrim(trim: string): ReceiptConfig {
  const value: unknown = JSON.parse(trim);
  if (!isPlainObject(value)) return DEFAULT_RECEIPT;
  const receipt: ReceiptConfig = {};
  for (const field of RECEIPT_STRING_FIELDS) {
    const text = value[field];
    if (typeof text === "string") receipt[field] = text;
  }
  if (typeof value.printAddress === "boolean") receipt.printAddress = value.printAddress;
  return receipt;
}

export async function getReceipt(tx: Transaction): Promise<ReceiptConfig> {
  const [row] = await tx.select({ trim: TRIM }).from(tenantReceipts);
  return row === undefined ? DEFAULT_RECEIPT : parseTrim(row.trim);
}

function isDots(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

/** `null` for anything that is not a raster this paper can print. */
function decodeLogoRaster(value: unknown, paperWidth: PaperWidth): MonoRaster | null {
  if (!isPlainObject(value)) return null;
  const { widthDots, heightDots, data } = value;
  if (
    !isDots(widthDots, safeWidthDots(paperWidth)) ||
    !isDots(heightDots, LOGO_MAX_HEIGHT_DOTS) ||
    typeof data !== "string"
  ) {
    return null;
  }
  const size = Math.ceil(widthDots / 8) * heightDots;
  // Bounded before the pattern runs: on ten million characters it overflowed the stack.
  if (data.length !== Math.ceil(size / 3) * 4 || !BASE64.test(data)) return null;
  const bits = new Uint8Array(Buffer.from(data, "base64"));
  if (bits.length !== size) return null;
  return { widthDots, heightDots, bits };
}

/**
 * The stored picture as a raster, or `null`. It runs inside a sale's transaction, where a throw
 * would roll the sale back, so nothing about the stored text may throw past it.
 */
function readLogoRaster(json: string | null, paperWidth: PaperWidth): MonoRaster | null {
  if (json === null) return null;
  try {
    return decodeLogoRaster(JSON.parse(json), paperWidth);
  } catch {
    return null;
  }
}

export function encodeLogoRaster(raster: MonoRaster): StoredLogoRaster {
  return {
    widthDots: raster.widthDots,
    heightDots: raster.heightDots,
    data: Buffer.from(raster.bits).toString("base64"),
  };
}

/**
 * The trim and the logo `paperWidth` prints, from one read that parses that paper's picture alone.
 * The logo is `null` for a stored picture of any wrong shape; a failed read still throws.
 */
export async function getPrintedReceipt(
  tx: Transaction,
  paperWidth: PaperWidth,
): Promise<{ receipt: ReceiptConfig; logo: MonoRaster | null }> {
  const [row] = await tx
    .select({ trim: TRIM, picture: storedPicture(`$.logoRasters."${paperWidth}"`) })
    .from(tenantReceipts);
  if (row === undefined) return { receipt: DEFAULT_RECEIPT, logo: null };
  const receipt = parseTrim(row.trim);
  const logo = receipt.logo === undefined ? null : readLogoRaster(row.picture, paperWidth);
  return { receipt, logo };
}

/**
 * The pictures stored for `logo`, when the row names that logo and every paper's picture is one it
 * can print; otherwise `null`, and the caller draws them again.
 */
export async function getStoredLogoRasters(
  tx: Transaction,
  logo: string,
): Promise<ReceiptLogoRasters | null> {
  const [row] = await tx
    .select({
      logo: sql<unknown>`${tenantReceipts.receipt} ->> '$.logo'`,
      pictures: storedPicture("$.logoRasters"),
    })
    .from(tenantReceipts);
  if (row?.logo !== logo || row.pictures === null) return null;
  try {
    const pictures: unknown = JSON.parse(row.pictures);
    return printable(pictures) ? pictures : null;
  } catch {
    return null;
  }
}

/** `logoRasters` are required with a logo, so the row never names a logo it cannot print. */
export async function putReceipt(
  tx: Transaction,
  input: { managementSessionId: string; receipt: unknown; logoRasters?: ReceiptLogoRasters },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "layout.configure",
  });
  const config = validateReceiptConfig(input.receipt);
  let receipt: ReceiptConfig & { logoRasters?: ReceiptLogoRasters } = config;
  if (config.logo !== undefined) {
    if (!printable(input.logoRasters)) {
      throw new Error(`no printable logo raster was given for ${config.logo}`);
    }
    receipt = { ...config, logoRasters: input.logoRasters };
  }
  await tx
    .insert(tenantReceipts)
    .values({ receipt })
    .onConflictDoUpdate({
      target: tenantReceipts.id,
      set: { receipt, updatedAt: nowIso() },
    });
}

function printable(rasters: unknown): rasters is ReceiptLogoRasters {
  return (
    isPlainObject(rasters) &&
    PAPER_WIDTHS.every((paperWidth) => decodeLogoRaster(rasters[paperWidth], paperWidth) !== null)
  );
}

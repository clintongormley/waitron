import { nowIso, tenantReceipts } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import {
  LOGO_MAX_HEIGHT_DOTS,
  safeWidthDots,
  type MonoRaster,
  type PaperWidth,
} from "@waitron/printing";
import { DEFAULT_RECEIPT } from "./defaults.js";
import type { ReceiptConfig, ReceiptLogoRasters, StoredLogoRaster } from "./types.js";
import { validateReceiptConfig } from "./validate.js";

const PAPER_WIDTHS: readonly PaperWidth[] = ["58mm", "80mm"];
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

type StoredReceipt = ReceiptConfig & { logoRasters?: unknown };

/**
 * The `as` cast restores a type the JSON column does not carry: this package depends on
 * `@waitron/db`, so the column cannot name one of its types without a dependency cycle. Nothing
 * here re-validates the row, and a configuration import copies it unchecked.
 */
async function readStored(tx: Transaction): Promise<StoredReceipt | undefined> {
  const [row] = await tx.select({ receipt: tenantReceipts.receipt }).from(tenantReceipts);
  return row?.receipt as StoredReceipt | undefined;
}

export async function getReceipt(tx: Transaction): Promise<ReceiptConfig> {
  const stored = await readStored(tx);
  if (stored === undefined) return DEFAULT_RECEIPT;
  const receipt: StoredReceipt = { ...stored };
  delete receipt.logoRasters;
  return receipt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDots(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

/** `null` for anything that is not a raster this paper can print. */
function decodeLogoRaster(value: unknown, paperWidth: PaperWidth): MonoRaster | null {
  if (!isRecord(value)) return null;
  const { widthDots, heightDots, data } = value;
  if (
    !isDots(widthDots, safeWidthDots(paperWidth)) ||
    !isDots(heightDots, LOGO_MAX_HEIGHT_DOTS) ||
    typeof data !== "string" ||
    !BASE64.test(data)
  ) {
    return null;
  }
  const bits = new Uint8Array(Buffer.from(data, "base64"));
  if (bits.length !== Math.ceil(widthDots / 8) * heightDots) return null;
  return { widthDots, heightDots, bits };
}

export function encodeLogoRaster(raster: MonoRaster): StoredLogoRaster {
  return {
    widthDots: raster.widthDots,
    heightDots: raster.heightDots,
    data: Buffer.from(raster.bits).toString("base64"),
  };
}

/**
 * The logo to print on `paperWidth`, or `null`. It runs inside a sale's transaction, where a throw
 * would roll the sale back, so a stored raster of any wrong shape yields `null` instead.
 */
export async function getReceiptLogo(
  tx: Transaction,
  paperWidth: PaperWidth,
): Promise<MonoRaster | null> {
  const stored = await readStored(tx);
  if (typeof stored?.logo !== "string" || !isRecord(stored.logoRasters)) return null;
  return decodeLogoRaster(stored.logoRasters[paperWidth], paperWidth);
}

/**
 * `logoRasters` are required unless the row already holds printable ones for the same logo, which
 * are then kept, so the row never names a logo it holds no printable raster for.
 */
export async function putReceipt(
  tx: Transaction,
  input: { managementSessionId: string; receipt: unknown; logoRasters?: ReceiptLogoRasters },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "layout.configure",
  });
  const config = validateReceiptConfig(input.receipt);
  let receipt: StoredReceipt = config;
  if (config.logo !== undefined) {
    receipt = { ...config, logoRasters: await rastersFor(tx, config.logo, input.logoRasters) };
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
    isRecord(rasters) &&
    PAPER_WIDTHS.every((paperWidth) => decodeLogoRaster(rasters[paperWidth], paperWidth) !== null)
  );
}

async function rastersFor(
  tx: Transaction,
  logo: string,
  given: ReceiptLogoRasters | undefined,
): Promise<ReceiptLogoRasters> {
  if (given !== undefined) {
    if (!printable(given)) throw new Error("a given logo raster is not one its paper can print");
    return given;
  }
  const stored = await readStored(tx);
  if (stored?.logo !== logo || !printable(stored.logoRasters)) {
    throw new Error(`no logo raster was given for ${logo}, and none printable is stored for it`);
  }
  return stored.logoRasters;
}

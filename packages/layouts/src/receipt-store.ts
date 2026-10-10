import { nowIso, tenantReceipts } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import {
  LOGO_MAX_HEIGHT_DOTS,
  safeWidthDots,
  type MonoRaster,
  type PaperWidth,
} from "@waitron/printing";
import type { VenueReceiptSettings } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { DEFAULT_RECEIPT } from "./defaults.js";
import type { ReceiptConfig, ReceiptLogoRasters, StoredLogoRaster } from "./types.js";
import {
  isPlainObject,
  RECEIPT_STRING_FIELDS,
  validateReceiptConfig,
  validateVenueReceiptSettings,
} from "./validate.js";

const PAPER_WIDTHS: readonly PaperWidth[] = ["58mm", "80mm"];
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const DOCUMENT = sql`case when json_valid(${tenantReceipts.receipt}) then ${tenantReceipts.receipt} else '{}' end`;

function boundedString(field: string, max: number) {
  const value = sql`json_extract(${DOCUMENT}, ${`$.${field}`})`;
  return sql<
    string | null
  >`case when typeof(${value}) = 'text' and length(${value}) <= ${max} and length(cast(${value} as blob)) <= ${max * 4} then ${value} else null end`;
}

const TRIM = sql<string>`json_object(
  'headerSubtitle', ${boundedString("headerSubtitle", 200)},
  'footerMessage', ${boundedString("footerMessage", 200)},
  'phone', ${boundedString("phone", 30)},
  'email', ${boundedString("email", 254)},
  'logo', ${boundedString("logo", 255)},
  'printAddress', case when json_type(${DOCUMENT}, '$.printAddress') in ('true', 'false') then json_extract(${DOCUMENT}, '$.printAddress') else null end
)`;

function storedPicture(paper: PaperWidth) {
  const value = sql`json_extract(${DOCUMENT}, ${`$.logoRasters."${paper}"`})`;
  const maxBytes =
    Math.ceil((Math.ceil(safeWidthDots(paper) / 8) * LOGO_MAX_HEIGHT_DOTS) / 3) * 4 + 128;
  return sql<
    string | null
  >`case when typeof(${value}) = 'text' and length(cast(${value} as blob)) <= ${maxBytes} then ${value} else null end`;
}

function parseTrim(trim: string): ReceiptConfig {
  const value = JSON.parse(trim) as Record<string, unknown>;
  const receipt: ReceiptConfig = {};
  for (const field of RECEIPT_STRING_FIELDS) {
    const text = value[field];
    if (typeof text !== "string") continue;
    try {
      Object.assign(receipt, validateReceiptConfig({ [field]: text }));
    } catch {
      // Imported fields are independent; one invalid field does not hide valid siblings.
    }
  }
  if (value.printAddress === 0) receipt.printAddress = false;
  if (value.printAddress === 1) receipt.printAddress = true;
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

export async function getPrintedReceipt(
  tx: Transaction,
  paperWidth: PaperWidth,
  diagnostic?: (event: {
    operation: "getPrintedReceipt";
    receiptId: 1;
    code: "receipt.read_failed";
  }) => void,
): Promise<{ receipt: ReceiptConfig; logo: MonoRaster | null }> {
  try {
    const [row] = await tx
      .select({ trim: TRIM, picture: storedPicture(paperWidth) })
      .from(tenantReceipts);
    if (row === undefined) return { receipt: DEFAULT_RECEIPT, logo: null };
    const receipt = parseTrim(row.trim);
    const logo = receipt.logo === undefined ? null : readLogoRaster(row.picture, paperWidth);
    return { receipt, logo };
  } catch {
    try {
      diagnostic?.({ operation: "getPrintedReceipt", receiptId: 1, code: "receipt.read_failed" });
    } catch {
      // Diagnostics cannot replace an omitted optional source with another failure.
    }
    return { receipt: DEFAULT_RECEIPT, logo: null };
  }
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
      logo: boundedString("logo", 255),
      narrow: storedPicture("58mm"),
      wide: storedPicture("80mm"),
    })
    .from(tenantReceipts);
  if (row?.logo !== logo || row.narrow === null || row.wide === null) return null;
  try {
    const pictures: unknown = { "58mm": JSON.parse(row.narrow), "80mm": JSON.parse(row.wide) };
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

export async function getVenueReceiptSettings(tx: Transaction): Promise<VenueReceiptSettings> {
  const { logo, headerSubtitle, footerMessage, printAddress } = await getReceipt(tx);
  return {
    ...(logo === undefined ? {} : { logo }),
    ...(headerSubtitle === undefined ? {} : { headerSubtitle }),
    ...(footerMessage === undefined ? {} : { footerMessage }),
    ...(printAddress === undefined ? {} : { printAddress }),
  };
}

export async function putVenueReceiptSettings(
  tx: Transaction,
  input: { managementSessionId: string; settings: unknown; logoRasters?: ReceiptLogoRasters },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "layout.configure",
  });
  const settings = validateVenueReceiptSettings(input.settings);
  const { phone, email } = await getReceipt(tx);
  await putReceipt(tx, {
    managementSessionId: input.managementSessionId,
    receipt: {
      ...settings,
      ...(phone === undefined ? {} : { phone }),
      ...(email === undefined ? {} : { email }),
    },
    ...(input.logoRasters === undefined ? {} : { logoRasters: input.logoRasters }),
  });
}

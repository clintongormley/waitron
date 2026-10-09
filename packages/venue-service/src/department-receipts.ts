import { and, eq, sql, type SQL } from "drizzle-orm";
import { nowIso, type Transaction } from "@waitron/db";
import { isValidEmail } from "@waitron/identity";
import { LOGO_MAX_HEIGHT_DOTS, safeWidthDots } from "@waitron/printing";
import {
  AppError,
  isValidTelephone,
  MEDIA_FILENAME,
  type DepartmentReceiptConfig,
  type DepartmentReceiptScope,
  type ReceiptLogoRaster,
  type ReceiptLogoRasters,
  type ReceiptPaperWidth,
} from "@waitron/shared";
import { departmentReceipts } from "./schema/department-receipts.js";
import { departments, orderServiceContexts, saleReceiptHeaders } from "./schema/service.js";
import type { VenueScope } from "./operations.js";
import "./errors.js";

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_AUTHORED_BYTES = 65_536;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDocument(
  column: SQL | typeof departmentReceipts.receipt | typeof departmentReceipts.logoRasters,
) {
  return sql`case when json_valid(${column}) then ${column} else '{}' end`;
}

function stringField(field: string, max: number) {
  const value = sql`json_extract(${validDocument(departmentReceipts.receipt)}, ${`$.${field}`})`;
  return sql<
    string | null
  >`case when typeof(${value}) = 'text' and length(cast(${value} as blob)) <= ${max} then ${value} else null end`;
}

function textMap(field: string, languages: readonly string[]) {
  if (languages.length === 0) return sql<string>`'{}'`;
  const doc = validDocument(departmentReceipts.receipt);
  const path = `$.${field}`;
  const map = sql`case when json_type(${doc}, ${path}) = 'object' then json_extract(${doc}, ${path}) else '{}' end`;
  const entries = sql`(select json_group_object(key, value) from json_each(${map}) where key in (${sql.join(
    languages.map((language) => sql`${language}`),
    sql`, `,
  )}) and type = 'text' and length(cast(value as blob)) <= 800 and length(value) <= 200)`;
  // Two maps leave room for the separately bounded contact and filename fields within 64 KiB.
  const mapBudget = MAX_AUTHORED_BYTES / 2 - 2048;
  return sql<string>`case when length(cast(${entries} as blob)) <= ${mapBudget} then ${entries} else '{}' end`;
}

function picture(paper: ReceiptPaperWidth) {
  const value = sql`json_extract(${validDocument(departmentReceipts.logoRasters)}, ${`$."${paper}"`})`;
  const maxBytes =
    Math.ceil((Math.ceil(safeWidthDots(paper) / 8) * LOGO_MAX_HEIGHT_DOTS) / 3) * 4 + 128;
  return sql<
    string | null
  >`case when typeof(${value}) = 'text' and length(cast(${value} as blob)) <= ${maxBytes} then ${value} else null end`;
}

function trimProjection(cfg: DepartmentReceiptScope) {
  return {
    departmentId: departments.id,
    logo: stringField("logo", 255),
    phone: stringField("phone", 120),
    email: stringField("email", 1016),
    headerSubtitle: textMap("headerSubtitle", cfg.receiptLanguages),
    footerMessage: textMap("footerMessage", cfg.receiptLanguages),
  };
}

function rowQuery(cfg: VenueScope, departmentId: string) {
  return and(eq(departments.id, departmentId), eq(departments.locationId, cfg.locationId));
}

function parseMap(text: string): Record<string, string> | undefined {
  if (Buffer.byteLength(text) > MAX_AUTHORED_BYTES) return undefined;
  const value: unknown = JSON.parse(text);
  if (!object(value)) return undefined;
  // Match the validator's UTF-16 bound after SQLite's code-point length check.
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].length <= 200 && entry[1].trim() !== "",
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function parseReceipt(row: {
  logo: string | null;
  phone: string | null;
  email: string | null;
  headerSubtitle: string;
  footerMessage: string;
}): DepartmentReceiptConfig {
  const receipt: DepartmentReceiptConfig = {};
  if (row.logo && MEDIA_FILENAME.test(row.logo)) receipt.logo = row.logo;
  if (row.phone && row.phone.length <= 30 && isValidTelephone(row.phone)) receipt.phone = row.phone;
  if (
    row.email &&
    row.email.length <= 254 &&
    row.email.trim() === row.email &&
    isValidEmail(row.email)
  )
    receipt.email = row.email;
  for (const field of ["headerSubtitle", "footerMessage"] as const) {
    const value = parseMap(row[field]);
    if (value) receipt[field] = value;
  }
  return receipt;
}

function decode(value: unknown, paper: ReceiptPaperWidth): ReceiptLogoRaster | null {
  if (!object(value)) return null;
  const { widthDots, heightDots, data } = value;
  if (
    typeof widthDots !== "number" ||
    !Number.isInteger(widthDots) ||
    widthDots < 1 ||
    widthDots > safeWidthDots(paper) ||
    typeof heightDots !== "number" ||
    !Number.isInteger(heightDots) ||
    heightDots < 1 ||
    heightDots > LOGO_MAX_HEIGHT_DOTS ||
    typeof data !== "string"
  )
    return null;
  const size = Math.ceil(widthDots / 8) * heightDots;
  if (data.length !== Math.ceil(size / 3) * 4 || !BASE64.test(data)) return null;
  const bits = new Uint8Array(Buffer.from(data, "base64"));
  return bits.length === size ? { widthDots, heightDots, bits } : null;
}

function parsePicture(text: string | null, paper: ReceiptPaperWidth): ReceiptLogoRaster | null {
  if (text === null) return null;
  try {
    return decode(JSON.parse(text), paper);
  } catch {
    return null;
  }
}

export async function readDepartmentReceipt(
  tx: Transaction,
  cfg: DepartmentReceiptScope,
  departmentId: string,
): Promise<DepartmentReceiptConfig> {
  const [row] = await tx
    .select(trimProjection(cfg))
    .from(departments)
    .leftJoin(departmentReceipts, eq(departmentReceipts.departmentId, departments.id))
    .where(rowQuery(cfg, departmentId));
  if (!row) throw new AppError("department.not_found", { departmentId });
  return parseReceipt(row);
}

export async function readPrintedDepartmentReceipt(
  tx: Transaction,
  cfg: DepartmentReceiptScope,
  departmentId: string,
  paperWidth: ReceiptPaperWidth,
): Promise<{ receipt: DepartmentReceiptConfig; logo: ReceiptLogoRaster | null }> {
  try {
    const [row] = await tx
      .select({ ...trimProjection(cfg), picture: picture(paperWidth) })
      .from(departments)
      .leftJoin(departmentReceipts, eq(departmentReceipts.departmentId, departments.id))
      .where(rowQuery(cfg, departmentId));
    if (!row) return { receipt: {}, logo: null };
    const receipt = parseReceipt(row);
    return { receipt, logo: receipt.logo ? parsePicture(row.picture, paperWidth) : null };
  } catch {
    try {
      cfg.receiptDiagnostic?.({
        operation: "readPrintedDepartmentReceipt",
        departmentId,
        code: "receipt.read_failed",
      });
    } catch {
      /* Diagnostics must not turn an optional read failure into a sale failure. */
    }
    return { receipt: {}, logo: null };
  }
}

export async function readDepartmentLogoRasters(
  tx: Transaction,
  cfg: DepartmentReceiptScope,
  departmentId: string,
): Promise<ReceiptLogoRasters | null> {
  const [row] = await tx
    .select({
      id: departments.id,
      logo: stringField("logo", 255),
      narrow: picture("58mm"),
      wide: picture("80mm"),
    })
    .from(departments)
    .leftJoin(departmentReceipts, eq(departmentReceipts.departmentId, departments.id))
    .where(rowQuery(cfg, departmentId));
  if (!row) throw new AppError("department.not_found", { departmentId });
  if (!row.logo || !MEDIA_FILENAME.test(row.logo) || row.narrow === null || row.wide === null)
    return null;
  if (!parsePicture(row.narrow, "58mm") || !parsePicture(row.wide, "80mm")) return null;
  return { "58mm": JSON.parse(row.narrow), "80mm": JSON.parse(row.wide) } as ReceiptLogoRasters;
}

export async function writeDepartmentReceipt(
  tx: Transaction,
  cfg: DepartmentReceiptScope,
  departmentId: string,
  receipt: DepartmentReceiptConfig,
  rasters?: ReceiptLogoRasters,
): Promise<void> {
  const [row] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(rowQuery(cfg, departmentId));
  if (!row) throw new AppError("department.not_found", { departmentId });
  if (
    receipt.logo &&
    (!rasters || !decode(rasters["58mm"], "58mm") || !decode(rasters["80mm"], "80mm"))
  )
    throw new Error("Receipt logo requires both printable pictures");
  const values = { receipt, logoRasters: receipt.logo ? rasters! : null, updatedAt: nowIso() };
  await tx
    .insert(departmentReceipts)
    .values({ departmentId, ...values })
    .onConflictDoUpdate({ target: departmentReceipts.departmentId, set: values });
}

export async function receiptDepartmentForSale(
  tx: Transaction,
  cfg: VenueScope,
  saleId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: departments.id })
    .from(saleReceiptHeaders)
    .innerJoin(departments, eq(departments.id, saleReceiptHeaders.departmentId))
    .where(and(eq(saleReceiptHeaders.saleId, saleId), eq(departments.locationId, cfg.locationId)));
  return row?.id ?? null;
}
export async function receiptDepartmentForOrder(
  tx: Transaction,
  cfg: VenueScope,
  orderId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: orderServiceContexts.departmentId })
    .from(orderServiceContexts)
    .where(
      and(
        eq(orderServiceContexts.workingOrderId, orderId),
        eq(orderServiceContexts.locationId, cfg.locationId),
      ),
    );
  return row?.id ?? null;
}
export async function receiptDefaultDepartment(
  tx: Transaction,
  cfg: VenueScope,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.isDefault, true)));
  return row?.id ?? null;
}

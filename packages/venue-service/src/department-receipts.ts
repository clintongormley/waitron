import { and, eq, sql, type SQL } from "drizzle-orm";
import {
  mediaImages,
  departments,
  nowIso,
  sales,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { isValidEmail } from "@waitron/identity";
import { LOGO_MAX_HEIGHT_DOTS, safeWidthDots } from "@waitron/printing";
import {
  AppError,
  isValidTelephone,
  MEDIA_FILENAME,
  type DepartmentReceiptConfig,
  type DepartmentReceiptPolicy,
  type DepartmentReceiptWrite,
  type DepartmentReceiptScope,
  type ReceiptLogoRaster,
  type ReceiptLogoRasters,
  type ReceiptPaperWidth,
} from "@waitron/shared";
import type { PrintedDepartmentReceipt } from "@waitron/module";
import { setDepartmentSalePolicyField } from "./operations.js";
import "./errors.js";

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_AUTHORED_BYTES = 65_536;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDocument(
  column: SQL | typeof departments.receiptText | typeof departments.receiptLogoRasters,
) {
  return sql`case when json_valid(${column}) then ${column} else '{}' end`;
}

function stringField(field: string, max: number) {
  const value = sql`json_extract(${validDocument(departments.receiptText)}, ${`$.${field}`})`;
  return sql<
    string | null
  >`case when json_type(${validDocument(departments.receiptText)}, ${`$.${field}`}) = 'text' and length(cast(${value} as blob)) <= ${max} then ${value} else null end`;
}

function textMap(field: string, languages: readonly string[]) {
  if (languages.length === 0) return sql<string>`'{}'`;
  const doc = validDocument(departments.receiptText);
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
  const value = sql`json_extract(${validDocument(departments.receiptLogoRasters)}, ${`$."${paper}"`})`;
  const maxBytes =
    Math.ceil((Math.ceil(safeWidthDots(paper) / 8) * LOGO_MAX_HEIGHT_DOTS) / 3) * 4 + 128;
  return sql<
    string | null
  >`case when typeof(${value}) = 'text' and length(cast(${value} as blob)) <= ${maxBytes} then ${value} else null end`;
}

function trimProjection(cfg: DepartmentReceiptScope) {
  return {
    departmentId: departments.id,
    printAddress: sql<
      string | null
    >`json_type(${validDocument(departments.receiptText)}, '$.printAddress')`,
    operationDescription: sql<
      string | null
    >`case when typeof(${departments.operationDescription}) = 'text' and length(cast(${departments.operationDescription} as blob)) <= 2000 then ${departments.operationDescription} else null end`,
    logo: mediaImages.filename,
    phone: stringField("phone", 120),
    email: stringField("email", 1016),
    headerSubtitle: textMap("headerSubtitle", cfg.receiptLanguages),
    footerMessage: textMap("footerMessage", cfg.receiptLanguages),
  };
}

function rowQuery(departmentId: string) {
  return eq(departments.id, departmentId);
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
  printAddress: string | null;
  operationDescription: string | null;
  logo: string | null;
  phone: string | null;
  email: string | null;
  headerSubtitle: string;
  footerMessage: string;
}): DepartmentReceiptConfig {
  const receipt: DepartmentReceiptConfig = {};
  if (row.printAddress === "true" || row.printAddress === "false")
    receipt.printAddress = row.printAddress === "true";
  if (
    row.operationDescription &&
    row.operationDescription.length <= 500 &&
    !Array.from(row.operationDescription).some(
      (character) => character < " " && !"\t\n\r".includes(character),
    ) &&
    row.operationDescription.trim() !== ""
  )
    receipt.operationDescription = row.operationDescription;
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

export async function listDepartmentReceiptReadiness(tx: Transaction) {
  const rows = await tx
    .select({ ...trimProjection({ receiptLanguages: [] }), name: departments.name })
    .from(departments)
    .leftJoin(mediaImages, eq(mediaImages.id, departments.receiptLogoImageId))
    .where(eq(departments.active, true));
  return rows.flatMap((row) =>
    parseReceipt(row).operationDescription === undefined
      ? [
          {
            code: "department.operation_description_required" as const,
            departmentId: row.departmentId,
            departmentName: row.name,
          },
        ]
      : [],
  );
}

export async function readDepartmentReceipt(
  tx: Transaction,
  cfg: DepartmentReceiptScope,
  departmentId: string,
): Promise<DepartmentReceiptConfig> {
  const [row] = await tx
    .select(trimProjection(cfg))
    .from(departments)
    .leftJoin(mediaImages, eq(mediaImages.id, departments.receiptLogoImageId))
    .where(and(rowQuery(departmentId), eq(departments.active, true)));
  if (!row) throw new AppError("department.not_found", { departmentId });
  return parseReceipt(row);
}

export async function readRetainedDepartmentReceipt(
  tx: Transaction,
  cfg: DepartmentReceiptScope,
  departmentId: string,
): Promise<DepartmentReceiptConfig> {
  const [row] = await tx
    .select(trimProjection(cfg))
    .from(departments)
    .leftJoin(mediaImages, eq(mediaImages.id, departments.receiptLogoImageId))
    .where(rowQuery(departmentId));
  if (!row) throw new AppError("department.not_found", { departmentId });
  return parseReceipt(row);
}

export async function readPrintedDepartmentReceipt(
  tx: Transaction,
  cfg: DepartmentReceiptScope,
  departmentId: string,
  paperWidth: ReceiptPaperWidth,
): Promise<PrintedDepartmentReceipt> {
  const doc = departments.receiptText;
  try {
    const [row] = await tx
      .select({
        ...trimProjection(cfg),
        picture: picture(paperWidth),
        receiptRow: departments.receiptUpdatedAt,
        top: sql<string | null>`case when json_valid(${doc}) then json_type(${doc}) end`,
        hasLogoKey: departments.receiptLogoImageId,
      })
      .from(departments)
      .leftJoin(mediaImages, eq(mediaImages.id, departments.receiptLogoImageId))
      .where(rowQuery(departmentId));
    if (!row) return { receipt: {}, logo: null, unreadable: true };
    if (row.receiptRow !== null && row.top !== "object")
      return { receipt: {}, logo: null, unreadable: true };
    const receipt = parseReceipt(row);
    if (row.hasLogoKey !== null && !receipt.logo) return { receipt, logo: null, unreadable: true };
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
    return { receipt: {}, logo: null, unreadable: true };
  }
}

export async function readDepartmentLogoRasters(
  tx: Transaction,
  departmentId: string,
): Promise<ReceiptLogoRasters | null> {
  const [row] = await tx
    .select({
      id: departments.id,
      logo: mediaImages.filename,
      narrow: picture("58mm"),
      wide: picture("80mm"),
    })
    .from(departments)
    .leftJoin(mediaImages, eq(mediaImages.id, departments.receiptLogoImageId))
    .where(and(rowQuery(departmentId), eq(departments.active, true)));
  if (!row) throw new AppError("department.not_found", { departmentId });
  if (!row.logo || !MEDIA_FILENAME.test(row.logo) || row.narrow === null || row.wide === null)
    return null;
  if (!parsePicture(row.narrow, "58mm") || !parsePicture(row.wide, "80mm")) return null;
  return { "58mm": JSON.parse(row.narrow), "80mm": JSON.parse(row.wide) } as ReceiptLogoRasters;
}

export async function writeDepartmentReceipt(
  tx: Transaction,
  departmentId: string,
  receipt: DepartmentReceiptConfig,
  rasters?: ReceiptLogoRasters,
): Promise<void> {
  const [row] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(rowQuery(departmentId), eq(departments.active, true)));
  if (!row) throw new AppError("department.not_found", { departmentId });
  if (
    receipt.logo &&
    (!rasters || !decode(rasters["58mm"], "58mm") || !decode(rasters["80mm"], "80mm"))
  )
    throw new Error("Receipt logo requires both printable pictures");
  const { logo, operationDescription, ...receiptText } = receipt;
  let receiptLogoImageId: string | null = null;
  if (logo !== undefined) {
    const [image] = await tx
      .select({ id: mediaImages.id })
      .from(mediaImages)
      .where(eq(mediaImages.filename, logo));
    if (!image) throw new AppError("receipt.invalid", { reason: "image_not_found", field: "logo" });
    receiptLogoImageId = image.id;
  }
  await tx
    .update(departments)
    .set({
      operationDescription: operationDescription ?? null,
      receiptText,
      receiptLogoImageId,
      receiptLogoRasters: logo ? rasters! : null,
      receiptUpdatedAt: nowIso(),
    })
    .where(eq(departments.id, departmentId));
}

export async function receiptDepartmentForSale(
  tx: Transaction,
  saleId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: sales.receiptDepartmentId })
    .from(sales)
    .where(eq(sales.id, saleId));
  return row?.id ?? null;
}
export async function receiptDepartmentForOrder(
  tx: Transaction,
  orderId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: workingOrders.departmentId })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return row?.id ?? null;
}
export async function receiptDefaultDepartment(tx: Transaction): Promise<string | null> {
  const [row] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.isDefault, true), eq(departments.active, true)));
  return row?.id ?? null;
}

export async function readDepartmentReceiptPolicy(
  tx: Transaction,
  departmentId: string,
): Promise<DepartmentReceiptPolicy> {
  const [row] = await tx
    .select({
      printTradingName: departments.printTradingName,
    })
    .from(departments)
    .where(and(rowQuery(departmentId), eq(departments.active, true)));
  if (!row) throw new AppError("department.not_found", { departmentId });
  return {
    printTradingName: row.printTradingName,
  };
}

export async function saveDepartmentReceiptSettings(
  tx: Transaction,
  departmentId: string,
  input: DepartmentReceiptWrite,
  rasters?: ReceiptLogoRasters,
): Promise<void> {
  await writeDepartmentReceipt(tx, departmentId, input.receipt, rasters);
  await setDepartmentSalePolicyField(
    tx,
    departmentId,
    "printTradingName",
    input.policy.printTradingName,
  );
}

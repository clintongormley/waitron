import "./errors.js";
import type { Context, Hono } from "hono";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  devices,
  printPaperWidth,
  printers,
  readTenant,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { departments } from "@waitron/venue-service";
import { authorizeManager } from "@waitron/identity";
import { resolveDevicePrinterIds, type ReceiptConfig } from "@waitron/layouts";
import {
  imageExists,
  readImageBytes,
  readCurrentImageMetadata,
  renditionUrl,
  renderRendition,
} from "@waitron/media";
import { textGrid, type EscSetting, type MonoRaster, type PaperWidth } from "@waitron/printing";
import {
  createErrorBoundary,
  requireEnum,
  requireManagementSession,
  requireUuidParam,
} from "@waitron/server-kit";
import type { ReceiptQrText } from "@waitron/fiscal";
import { AppError, resolveReceiptTrim } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import type { Logger } from "./logger.js";
import {
  previewPrintJob,
  type PrintJobPreview,
  type PrintPreviewBlock,
} from "./print-job-preview.js";
import { drawReceipt } from "./receipt-ticket.js";
import { createLogoCache, drawPreviewLogo, type LogoCache } from "./receipt-logo.js";
import { sampleSale } from "./sample-receipt.js";
import type { TillConfig } from "./till-config.js";
import { readReceiptAddress } from "./venue-address.js";
import { checkedDepartmentReceiptWrite } from "./department-receipt-draft.js";
import { departmentReceiptLanguages } from "./department-receipt-languages.js";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "management.request_invalid": 400,
    "receipt.invalid": 400,
    "shared.invalid_id": 400,
    "department.not_found": 404,
  },
  "management.failed",
);

/** The printers table's own default setting (80 mm at 180 dpi, 512 dots across). */
const DEFAULT_PRINTER: EscSetting = { paperWidth: "80mm", resolution: "180dpi" };

/** Blocks `[start, end)` of the preview. */
export interface BlockRange {
  start: number;
  end: number;
}

export interface ReceiptPreviewResponse {
  preview: PrintJobPreview;
  /** The width drawn at. */
  paperWidth: PaperWidth;
  /** The widths of the location's active devices' active receipt printers, narrowest first. */
  paperWidths: PaperWidth[];
  /** The blocks each part of the trim adds; `null` for one that prints nothing. */
  marks: Record<
    "headerSubtitle" | "footerMessage" | "phone" | "email" | "address" | "logo",
    BlockRange | null
  >;
}

/**
 * Where `withField` differs from `without`: the blocks between their common start and end, less
 * any of `withField`'s `rules` at either end, which belong to the section a field opens or closes,
 * not to the field.
 */
function addedBlocks(
  without: PrintPreviewBlock[],
  withField: PrintPreviewBlock[],
  rules: ReadonlySet<number>,
): BlockRange {
  const same = (a: PrintPreviewBlock | undefined, b: PrintPreviewBlock | undefined) =>
    JSON.stringify(a) === JSON.stringify(b);
  let start = 0;
  while (start < without.length && same(without[start], withField[start])) start++;
  let tail = 0;
  while (
    tail < without.length - start &&
    tail < withField.length - start &&
    same(without.at(-1 - tail), withField.at(-1 - tail))
  )
    tail++;
  let end = withField.length - tail;
  while (start < end && rules.has(start)) start++;
  while (end > start && rules.has(end - 1)) end--;
  return { start, end };
}

/**
 * The indexes of `preview`'s blocks that show the job's pictures numbered `pictures`. Holds while
 * the receipt sends no native `qr()` and the preview drops no picture (`omittedGraphics`).
 */
function pictureBlocks(preview: PrintJobPreview, pictures: number[]): Set<number> {
  const wanted = new Set(pictures);
  const blocks = new Set<number>();
  let picture = 0;
  preview.blocks.forEach((block, index) => {
    if (block.kind !== "image") return;
    if (wanted.has(picture)) blocks.add(index);
    picture++;
  });
  return blocks;
}

/** The paper setting of each active device's resolved, switched-on receipt printer, by device name. */
async function activeReceiptSettings(tx: Transaction, locationId: string): Promise<EscSetting[]> {
  const active = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.locationId, locationId), eq(devices.active, true)))
    .orderBy(asc(devices.label), asc(devices.id));
  const resolvedBy = await resolveDevicePrinterIds(
    tx,
    active.map((device) => device.id),
    "receipt",
  );
  const resolved = active
    .map((device) => resolvedBy.get(device.id) ?? null)
    .filter((id): id is string => id !== null);
  if (resolved.length === 0) return [];
  const rows = await tx
    .select({ id: printers.id, paperWidth: printers.paperWidth, resolution: printers.resolution })
    .from(printers)
    .where(and(inArray(printers.id, resolved), eq(printers.active, true)));
  const byId = new Map(rows.map(({ id, ...setting }) => [id, setting]));
  return resolved.flatMap((id) => {
    const setting = byId.get(id);
    return setting === undefined ? [] : [setting];
  });
}

/**
 * The setting to draw at: the asked-for width when a receipt printer has it, else the width most
 * devices print on, a tie going to the device first by name. A width's resolution is that of the
 * device first by name with it. `settings` holds one entry per device, ordered by name.
 */
function chooseSetting(settings: EscSetting[], asked: PaperWidth | undefined): EscSetting {
  const devicesUsing = new Map<PaperWidth, number>();
  for (const { paperWidth } of settings)
    devicesUsing.set(paperWidth, (devicesUsing.get(paperWidth) ?? 0) + 1);
  let width = asked;
  if (width === undefined || !devicesUsing.has(width)) {
    width = undefined;
    // A map iterates in insertion order, the order of the first device with each width.
    for (const [each, count] of devicesUsing)
      if (width === undefined || count > devicesUsing.get(width)!) width = each;
  }
  return settings.find((setting) => setting.paperWidth === width) ?? DEFAULT_PRINTER;
}

async function draftBody(c: Context): Promise<Record<string, unknown>> {
  const invalid = () => new AppError("management.request_invalid", { field: "body" });
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      // Enforce the bound on bytes received, including requests without Content-Length.
      if (size > 32768) {
        await reader.cancel();
        throw invalid();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
  } catch {
    throw invalid();
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw invalid();
  const result = body as Record<string, unknown>;
  if (
    !Object.hasOwn(result, "departmentId") ||
    !Object.hasOwn(result, "receipt") ||
    !Object.hasOwn(result, "policy")
  )
    throw invalid();
  if (
    Object.keys(result).some(
      (key) =>
        !["departmentId", "receipt", "policy", "language", "paperWidth", "passive"].includes(key),
    )
  )
    throw invalid();
  if (result.passive !== undefined && typeof result.passive !== "boolean")
    throw new AppError("management.request_invalid", { field: "passive" });
  return result;
}

interface ReceiptPreviewSnapshot {
  receipt: ReceiptConfig;
  printer: EscSetting;
  available: EscSetting[];
  locale: string;
  receiptHeader?: { tradingName: string | null; printTradingName: boolean };
  issuer: { venueName: string; nif: string };
  address: string[];
  savedLogo: MonoRaster | null;
}
async function renderDraftPreview(
  deps: { db: Database; cfg: TillConfig },
  sample: ReturnType<typeof sampleSale>,
  logoCache: LogoCache,
  snapshot: ReceiptPreviewSnapshot,
): Promise<ReceiptPreviewResponse> {
  const { receipt, printer, available, locale, receiptHeader, issuer, address, savedLogo } =
    snapshot;
  const filename = receipt.logo;
  const current =
    filename === undefined || savedLogo !== null
      ? null
      : await readCurrentImageMetadata(deps.db, filename);
  const logo =
    filename === undefined
      ? null
      : (savedLogo ??
        (current === null
          ? null
          : await drawPreviewLogo(
              logoCache,
              renditionUrl(current.sourceFilename, "display", current.framing),
              printer.paperWidth,
              {
                exists: () => imageExists(deps.db, filename),
                bytes: async () => {
                  const source = await readImageBytes(deps.db, current.sourceFilename);
                  return source ? renderRendition(source.bytes, "display", current.framing) : null;
                },
              },
            )));
  const widthDots = textGrid(printer.paperWidth, printer.resolution).widthDots;
  const job = (trim: ReceiptConfig, venueAddress = address, picture = logo) =>
    drawReceipt({
      result: sample,
      receipt: trim,
      printer,
      invoiceLocale: locale,
      receiptHeader,
      issuer,
      venueAddress,
      logo: picture,
      simulated: deps.cfg.practiceMode,
    });
  const draw = (...args: Parameters<typeof job>) =>
    previewPrintJob(job(...args).bytes, { widthDots });
  const drawn = job(receipt);
  const preview = previewPrintJob(drawn.bytes, { widthDots });
  const rules = pictureBlocks(preview, drawn.rules);
  const without = (other: PrintJobPreview) => addedBlocks(other.blocks, preview.blocks, rules);
  const markOf = (field: "headerSubtitle" | "footerMessage" | "phone" | "email") =>
    receipt[field] ? without(draw({ ...receipt, [field]: undefined })) : null;
  const response: ReceiptPreviewResponse = {
    preview,
    paperWidth: printer.paperWidth,
    paperWidths: printPaperWidth.enumValues.filter((width) =>
      available.some((setting) => setting.paperWidth === width),
    ),
    marks: {
      headerSubtitle: markOf("headerSubtitle"),
      footerMessage: markOf("footerMessage"),
      phone: markOf("phone"),
      email: markOf("email"),
      address: address.length ? without(draw(receipt, [])) : null,
      logo: logo === null ? null : without(draw(receipt, address, null)),
    },
  };
  return response;
}

export function mountReceiptPreviewApi(
  app: Hono,
  deps: {
    db: Database;
    cfg: TillConfig;
    receiptQrText?: ReceiptQrText;
    validateOperationDescription?: (description: string) => void;
  },
  log: Logger,
): void {
  const sample = sampleSale(deps.receiptQrText);
  const logoCache = createLogoCache();
  app.post("/management-api/receipt-preview", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await withTransaction(deps.db, (tx) =>
        authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "layout.configure",
          touch: false,
        }),
      );
      const body = await draftBody(c);
      if (typeof body.departmentId !== "string")
        throw new AppError("management.request_invalid", { field: "departmentId" });
      const id = requireUuidParam(body.departmentId, "departmentId");
      const askedWidth =
        body.paperWidth === undefined
          ? undefined
          : requireEnum(body.paperWidth, "paperWidth", printPaperWidth.enumValues);
      const snapshot = await withTransaction(deps.db, async (tx) => {
        const checked = await checkedDepartmentReceiptWrite(
          tx,
          deps.cfg,
          id,
          sessionId,
          { receipt: body.receipt, policy: body.policy },
          deps.validateOperationDescription,
          { touch: body.passive !== true, allowEmptyDescription: true },
        );
        const languages = await departmentReceiptLanguages(tx, deps.cfg);
        const locale =
          body.language === undefined
            ? languages.receiptLanguage
            : requireEnum(body.language, "language", languages.languages);
        const [department] = await tx
          .select({ tradingName: departments.tradingName })
          .from(departments)
          .where(eq(departments.id, id));
        const receipt = resolveReceiptTrim(
          checked.input.receipt,
          {},
          locale,
          languages.receiptLanguage,
        );
        const available = await activeReceiptSettings(tx, deps.cfg.locationId);
        const printer =
          askedWidth === undefined
            ? chooseSetting(available, undefined)
            : (available.find((setting) => setting.paperWidth === askedWidth) ?? {
                ...DEFAULT_PRINTER,
                paperWidth: askedWidth,
              });
        const taxpayer = (await readTenant(tx))!;
        let savedLogo: MonoRaster | null = null;
        if (receipt.logo !== undefined) {
          const stored = await VENUE_SERVICE.readDepartmentReceipt(tx, checked.scope, id);
          if (stored.logo === receipt.logo) {
            savedLogo = (
              await VENUE_SERVICE.readPrintedDepartmentReceipt(
                tx,
                checked.scope,
                id,
                printer.paperWidth,
              )
            ).logo;
          }
        }
        return {
          receipt,
          printer,
          available,
          locale,
          receiptHeader: {
            tradingName: department!.tradingName,
            printTradingName: checked.input.policy.printTradingName,
          },
          issuer: { venueName: taxpayer.legalName, nif: taxpayer.taxId },
          address: await readReceiptAddress(tx, deps.cfg.locationId, {
            printAddress: checked.input.receipt.printAddress === true,
          }),
          savedLogo,
        };
      });
      return c.json(await renderDraftPreview(deps, sample, logoCache, snapshot));
    }),
  );
}

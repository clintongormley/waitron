import "./errors.js";
import type { Hono } from "hono";
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
import { readReceiptLanguage } from "@waitron/catalogue";
import { departments, departmentSalePolicies } from "@waitron/venue-service";
import { authorizeManager } from "@waitron/identity";
import {
  getPrintedReceipt,
  resolveDevicePrinterIds,
  validateReceiptConfig,
  type ReceiptConfig,
} from "@waitron/layouts";
import { imageExists, readImageBytes } from "@waitron/media";
import { textGrid, type EscSetting, type MonoRaster, type PaperWidth } from "@waitron/printing";
import {
  createErrorBoundary,
  requireEnum,
  requireManagementSession,
  requireUuidParam,
} from "@waitron/server-kit";
import type { ReceiptQrText } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import type { Logger } from "./logger.js";
import {
  previewPrintJob,
  type PrintJobPreview,
  type PrintPreviewBlock,
} from "./print-job-preview.js";
import { formatReceipt } from "./receipt-ticket.js";
import { createLogoCache, drawPreviewLogo } from "./receipt-logo.js";
import { sampleSale } from "./sample-receipt.js";
import type { TillConfig } from "./till-config.js";
import { readVenueReceiptLanguageRules } from "./venue-locale.js";
import { readReceiptAddress } from "./venue-address.js";

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

/** Where `withField` differs from `without`: the blocks between their common start and end. */
function addedBlocks(without: PrintPreviewBlock[], withField: PrintPreviewBlock[]): BlockRange {
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
  return { start, end: withField.length - tail };
}

function requireReceiptParameter(given: string[] | undefined): unknown {
  if (given?.length !== 1) throw new AppError("management.request_invalid", { field: "receipt" });
  try {
    return JSON.parse(given[0]!);
  } catch {
    throw new AppError("management.request_invalid", { field: "receipt" });
  }
}

function optionalPaperWidth(given: string[] | undefined): PaperWidth | undefined {
  if (given === undefined) return undefined;
  if (given.length !== 1) throw new AppError("management.request_invalid", { field: "paperWidth" });
  return requireEnum(given[0], "paperWidth", printPaperWidth.enumValues);
}

function optionalDepartmentId(given: string[] | undefined): string | undefined {
  if (given === undefined) return undefined;
  if (given.length !== 1)
    throw new AppError("management.request_invalid", { field: "departmentId" });
  return requireUuidParam(given[0]!, "departmentId");
}

/** A language to draw in other than the saved one: one of those the venue's pack offers. */
function optionalLanguage(
  given: string[] | undefined,
  choices: readonly string[],
): string | undefined {
  if (given === undefined) return undefined;
  if (given.length !== 1 || !choices.includes(given[0]!)) {
    throw new AppError("management.request_invalid", { field: "language" });
  }
  return given[0];
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

/**
 * A sample receipt drawn by the formatter a sale's receipt prints from, with unsaved trim. It
 * files, saves and enqueues nothing. A GET, so a dashboard refresh can ask for it passively; the
 * `receipt` parameter holds the JSON object a save sends as `receipt`, an optional `paperWidth`
 * picks one of the widths an answer offers, and an optional `language` draws in another of the
 * receipt languages the venue may choose.
 */
export function mountReceiptPreviewApi(
  app: Hono,
  deps: { db: Database; cfg: TillConfig; receiptQrText?: ReceiptQrText },
  log: Logger,
): void {
  const sample = sampleSale(deps.receiptQrText);
  const logoCache = createLogoCache();
  app.get("/management-api/receipt-preview", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const requested = requireReceiptParameter(c.req.queries("receipt"));
      const asked = optionalPaperWidth(c.req.queries("paperWidth"));
      const departmentId = optionalDepartmentId(c.req.queries("departmentId"));
      const {
        issuer,
        settings,
        printer,
        receipt,
        venueAddress,
        savedLogo,
        language,
        rules,
        receiptHeader,
      } = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "layout.configure",
        });
        const receipt = validateReceiptConfig(requested);
        // Provisioning writes the one taxpayer row before the management API is served.
        const taxpayer = (await readTenant(tx))!;
        const [department] =
          departmentId === undefined
            ? []
            : await tx
                .select({
                  tradingName: departments.tradingName,
                  printTradingName: departmentSalePolicies.printTradingName,
                })
                .from(departments)
                .innerJoin(
                  departmentSalePolicies,
                  eq(departmentSalePolicies.departmentId, departments.id),
                )
                .where(
                  and(
                    eq(departments.id, departmentId),
                    eq(departments.locationId, deps.cfg.locationId),
                    eq(departments.active, true),
                  ),
                );
        if (departmentId !== undefined && department === undefined) {
          throw new AppError("department.not_found", { departmentId });
        }
        const settings = await activeReceiptSettings(tx, deps.cfg.locationId);
        const printer = chooseSetting(settings, asked);
        let saved: MonoRaster | null = null;
        if (receipt.logo !== undefined) {
          const stored = await getPrintedReceipt(tx, printer.paperWidth);
          if (stored.receipt.logo === receipt.logo) saved = stored.logo;
        }
        return {
          issuer: { venueName: taxpayer.legalName, nif: taxpayer.taxId },
          settings,
          printer,
          receipt,
          venueAddress: await readReceiptAddress(tx, deps.cfg.locationId, receipt),
          savedLogo: saved,
          language: await readReceiptLanguage(tx, deps.cfg.locationId),
          rules: await readVenueReceiptLanguageRules(tx, { locationId: deps.cfg.locationId }),
          receiptHeader: department,
        };
      });
      const locale = optionalLanguage(c.req.queries("language"), rules.choices) ?? language.locale;
      const { logo: logoName } = receipt;
      // Outside the transaction: drawing a logo decodes its image.
      const logo =
        logoName === undefined
          ? null
          : (savedLogo ??
            (await drawPreviewLogo(logoCache, logoName, printer.paperWidth, {
              exists: () => imageExists(deps.db, logoName),
              bytes: async () => (await readImageBytes(deps.db, logoName))?.bytes ?? null,
            })));
      const widthDots = textGrid(printer.paperWidth, printer.resolution).widthDots;
      const draw = (
        trim: ReceiptConfig,
        address: readonly string[] = venueAddress,
        picture: MonoRaster | null = logo,
      ) =>
        previewPrintJob(
          formatReceipt({
            result: sample,
            issuer,
            receiptHeader,
            receipt: trim,
            venueAddress: address,
            logo: picture,
            invoiceLocale: locale,
            printer,
            simulated: deps.cfg.practiceMode,
          }),
          { widthDots },
        );
      const preview = draw(receipt);
      const without = (drawn: PrintJobPreview) => addedBlocks(drawn.blocks, preview.blocks);
      const markOf = (field: "headerSubtitle" | "footerMessage" | "phone" | "email") =>
        receipt[field] ? without(draw({ ...receipt, [field]: undefined })) : null;
      const response: ReceiptPreviewResponse = {
        preview,
        paperWidth: printer.paperWidth,
        paperWidths: printPaperWidth.enumValues.filter((width) =>
          settings.some((setting) => setting.paperWidth === width),
        ),
        marks: {
          headerSubtitle: markOf("headerSubtitle"),
          footerMessage: markOf("footerMessage"),
          phone: markOf("phone"),
          email: markOf("email"),
          address: venueAddress.length > 0 ? without(draw(receipt, [])) : null,
          logo: logo === null ? null : without(draw(receipt, venueAddress, null)),
        },
      };
      return c.json(response);
    }),
  );
}

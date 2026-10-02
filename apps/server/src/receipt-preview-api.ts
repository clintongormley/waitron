import "./errors.js";
import type { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import {
  printPaperWidth,
  printers,
  readTenant,
  tills,
  withTransaction,
  type Database,
} from "@waitron/db";
import { readReceiptLanguage } from "@waitron/catalogue";
import { authorizeManager } from "@waitron/identity";
import { validateReceiptConfig, type ReceiptConfig } from "@waitron/layouts";
import { textGrid, type EscSetting, type PaperWidth } from "@waitron/printing";
import { createErrorBoundary, requireEnum, requireManagementSession } from "@waitron/server-kit";
import type { ReceiptQrText } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import type { Logger } from "./logger.js";
import {
  previewPrintJob,
  type PrintJobPreview,
  type PrintPreviewBlock,
} from "./print-job-preview.js";
import { formatReceipt } from "./receipt-ticket.js";
import { sampleSale } from "./sample-receipt.js";
import type { TillConfig } from "./till-config.js";
import { readVenueReceiptLanguageRules } from "./venue-locale.js";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "management.request_invalid": 400,
    "receipt.invalid": 400,
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
  /** The widths of the location's tills' active receipt printers, narrowest first. */
  paperWidths: PaperWidth[];
  /** The blocks each trim field adds; `null` for a field left out or blank. */
  marks: { headerSubtitle: BlockRange | null; footerMessage: BlockRange | null };
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

/**
 * The setting to draw at: the asked-for width when a receipt printer has it, else the width most
 * tills print on, a tie going to the till first by name. A width's resolution is that of the till
 * first by name with it. `settings` holds one entry per till, ordered by name.
 */
function chooseSetting(settings: EscSetting[], asked: PaperWidth | undefined): EscSetting {
  const tillsUsing = new Map<PaperWidth, number>();
  for (const { paperWidth } of settings)
    tillsUsing.set(paperWidth, (tillsUsing.get(paperWidth) ?? 0) + 1);
  let width = asked;
  if (width === undefined || !tillsUsing.has(width)) {
    width = undefined;
    // A map iterates in insertion order, the order of the first till with each width.
    for (const [each, count] of tillsUsing)
      if (width === undefined || count > tillsUsing.get(width)!) width = each;
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
  app.get("/management-api/receipt-preview", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const requested = requireReceiptParameter(c.req.queries("receipt"));
      const asked = optionalPaperWidth(c.req.queries("paperWidth"));
      const { issuer, settings, language, rules } = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "layout.configure",
        });
        // Provisioning writes the one taxpayer row before the management API is served.
        const taxpayer = (await readTenant(tx))!;
        const settings = await tx
          .select({ paperWidth: printers.paperWidth, resolution: printers.resolution })
          .from(tills)
          .innerJoin(
            printers,
            and(eq(printers.id, tills.receiptPrinterId), eq(printers.active, true)),
          )
          .where(eq(tills.locationId, deps.cfg.locationId))
          .orderBy(asc(tills.name), asc(tills.id));
        return {
          issuer: { venueName: taxpayer.legalName, nif: taxpayer.taxId },
          settings,
          language: await readReceiptLanguage(tx, deps.cfg.locationId),
          rules: await readVenueReceiptLanguageRules(tx, { locationId: deps.cfg.locationId }),
        };
      });
      const locale = optionalLanguage(c.req.queries("language"), rules.choices) ?? language.locale;
      const printer = chooseSetting(settings, asked);
      const receipt = validateReceiptConfig(requested);
      const widthDots = textGrid(printer.paperWidth, printer.resolution).widthDots;
      const draw = (trim: ReceiptConfig) =>
        previewPrintJob(
          formatReceipt({
            result: sample,
            issuer,
            receipt: trim,
            invoiceLocale: locale,
            printer,
            simulated: deps.cfg.practiceMode,
          }),
          { widthDots },
        );
      const preview = draw(receipt);
      const markOf = (field: "headerSubtitle" | "footerMessage") =>
        receipt[field]
          ? addedBlocks(draw({ ...receipt, [field]: undefined }).blocks, preview.blocks)
          : null;
      const response: ReceiptPreviewResponse = {
        preview,
        paperWidth: printer.paperWidth,
        paperWidths: printPaperWidth.enumValues.filter((width) =>
          settings.some((setting) => setting.paperWidth === width),
        ),
        marks: { headerSubtitle: markOf("headerSubtitle"), footerMessage: markOf("footerMessage") },
      };
      return c.json(response);
    }),
  );
}

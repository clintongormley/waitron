import "./errors.js";
import type { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { printers, readTenant, tills, withTransaction, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { validateReceiptConfig, type ReceiptConfig } from "@waitron/layouts";
import { textGrid, type EscSetting } from "@waitron/printing";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { Logger } from "./logger.js";
import {
  previewPrintJob,
  type PrintJobPreview,
  type PrintPreviewBlock,
} from "./print-job-preview.js";
import { formatReceipt } from "./receipt-ticket.js";
import { SAMPLE_SALE } from "./sample-receipt.js";
import type { TillConfig } from "./till-config.js";

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

/**
 * A sample receipt drawn by the formatter a sale's receipt prints from, with unsaved trim. It
 * files, saves and enqueues nothing. A GET, so a dashboard refresh can ask for it passively; the
 * `receipt` parameter holds the JSON object a save sends as `receipt`.
 */
export function mountReceiptPreviewApi(
  app: Hono,
  deps: { db: Database; cfg: TillConfig },
  log: Logger,
): void {
  app.get("/management-api/receipt-preview", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const requested = requireReceiptParameter(c.req.queries("receipt"));
      const { issuer, printer } = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "layout.configure",
        });
        // Provisioning writes the one taxpayer row before the management API is served.
        const taxpayer = (await readTenant(tx))!;
        const [receiptPrinter] = await tx
          .select({ paperWidth: printers.paperWidth, resolution: printers.resolution })
          .from(tills)
          .innerJoin(
            printers,
            and(eq(printers.id, tills.receiptPrinterId), eq(printers.active, true)),
          )
          .where(eq(tills.locationId, deps.cfg.locationId))
          .orderBy(asc(tills.name), asc(tills.id))
          .limit(1);
        return {
          issuer: { venueName: taxpayer.legalName, nif: taxpayer.taxId },
          printer: receiptPrinter ?? DEFAULT_PRINTER,
        };
      });
      const receipt = validateReceiptConfig(requested);
      const widthDots = textGrid(printer.paperWidth, printer.resolution).widthDots;
      const draw = (trim: ReceiptConfig) =>
        previewPrintJob(
          formatReceipt({
            result: SAMPLE_SALE,
            issuer,
            receipt: trim,
            invoiceLocale: deps.cfg.locale,
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
        marks: { headerSubtitle: markOf("headerSubtitle"), footerMessage: markOf("footerMessage") },
      };
      return c.json(response);
    }),
  );
}

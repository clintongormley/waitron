import "./errors.js";
import { open, stat, type FileHandle } from "node:fs/promises";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { readTaxpayer, recordActivity, withTransaction, type Database } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { authorizeManager, withInspectorAdmitted } from "@waitron/identity";
import { resolveVenueClock } from "@waitron/reporting";
import {
  createErrorBoundary,
  requireEnum,
  requireManagementSession,
  requirePeriod,
  requireRange,
} from "@waitron/server-kit";
import {
  AppError,
  isUuid,
  stringToBasisPoints,
  stringToCents,
  type SupportedLocale,
} from "@waitron/shared";
import { errnoOf } from "./errno.js";
import type { Logger } from "./logger.js";
import {
  invoicePdfFileName,
  readSaleCopy,
  renderSaleCopy,
  type SaleCopy,
} from "./orders-invoice-pdf.js";
import { toLanguage } from "./personal-data-export-api.js";
import { resolveSessionLocale } from "./session-locale.js";
import { taxOfficeMonthEntries, type TaxOfficeMonth } from "./tax-office-export.js";
import { TAX_OFFICE_ROOM_BYTES, type TaxOfficeMonthBuilds } from "./tax-office-month-builds.js";
import { SPACE_LOW_BYTES } from "./free-space-watch.js";
import { optionalSearch } from "./orders-list.js";
import {
  countTaxOfficeInvoices,
  listTaxOfficeInvoices,
  TAX_OFFICE_KINDS,
  TAX_OFFICE_PAGE_SIZE,
  type TaxOfficeCursor,
  type TaxOfficeFilter,
} from "./tax-office-list.js";
import type { TradingContext } from "./trading-context.js";

export interface TaxOfficeApiDeps {
  db: Database;
  cfg: { nodeId: string };
  backend: FiscalBackend;
  tradingContext: TradingContext;
  venueLocale: SupportedLocale;
  builds: TaxOfficeMonthBuilds;
  /** Null when unreadable. */
  freeBytes: () => Promise<number | null>;
}

/** The month's ZIP entries for the builds' job, which passes its own stop check. */
export function taxOfficeMonthSource(deps: {
  db: Database;
  backend: FiscalBackend;
  tradingContext: TradingContext;
  log: Logger;
  /** Default `renderSaleCopy`; a test passes a stub. */
  render?: (copy: SaleCopy) => Promise<Uint8Array>;
}): (
  month: TaxOfficeMonth,
  stopIfAsked: () => void,
) => AsyncIterable<{ name: string; content: string | Uint8Array }> {
  return (month, stopIfAsked) =>
    taxOfficeMonthEntries(
      {
        db: deps.db,
        backend: deps.backend,
        tradingContext: deps.tradingContext,
        render: deps.render ?? renderSaleCopy,
        stopIfAsked,
        log: deps.log,
      },
      month,
    );
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "invoice_delivery.not_found": 404,
  "tax_office.export_running": 409,
  "tax_office.space_low": 507,
  "tax_office.download_missing": 404,
};

const FILE_CHUNK_BYTES = 64 * 1024;

const run = createErrorBoundary(STATUS, "report.failed");

// Bounds how much of `sales` one search can scan while it holds the write lock.
const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const RATE = /^\d{1,3}(\.\d{1,2})?$/;
const AMOUNT = /^-?\d{1,10}(\.\d{1,2})?$/;
const STORED_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The month's first and last calendar days. */
function requireMonth(raw: string): { from: string; to: string } {
  const match = MONTH.exec(raw);
  if (match === null) throw invalid("month");
  const last = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  return { from: `${raw}-01`, to: `${raw}-${String(last).padStart(2, "0")}` };
}

const invalid = (field: string) => new AppError("management.request_invalid", { field });

function optionalMatch<T>(
  raw: string | undefined,
  field: string,
  pattern: RegExp,
  parse: (value: string) => T,
): T | undefined {
  if (raw === undefined) return undefined;
  if (!pattern.test(raw)) throw invalid(field);
  return parse(raw);
}

function requireCursor(
  at: string | undefined,
  id: string | undefined,
): TaxOfficeCursor | undefined {
  if (at === undefined && id === undefined) return undefined;
  if (at === undefined || id === undefined || !STORED_INSTANT.test(at) || !isUuid(id))
    throw invalid("after");
  return { at, id: id.toLowerCase() };
}

function readFilter(
  query: (name: string) => string | undefined,
  timeZone: string,
): TaxOfficeFilter {
  const { from, to } = requireRange(query("from"), query("to"));
  if ((Date.parse(to) - Date.parse(from)) / DAY_MS + 1 > MAX_RANGE_DAYS) throw invalid("range");
  const rawFrom = query("operationFrom");
  const rawTo = query("operationTo");
  const operation = {
    ...(rawFrom === undefined ? {} : { from: requirePeriod(rawFrom, "operationFrom") }),
    ...(rawTo === undefined ? {} : { to: requirePeriod(rawTo, "operationTo") }),
  };
  if (operation.from !== undefined && operation.to !== undefined && operation.from > operation.to)
    throw invalid("operationRange");
  const search = optionalSearch(query("q"));
  const rate = optionalMatch(query("rate"), "rate", RATE, stringToBasisPoints);
  const amount = optionalMatch(query("amount"), "amount", AMOUNT, stringToCents);
  const rawKind = query("kind");
  const after = requireCursor(query("afterAt"), query("afterId"));
  return {
    issued: { from, to, timeZone },
    ...(search === undefined ? {} : { search }),
    ...(rate === undefined ? {} : { rate }),
    ...(amount === undefined ? {} : { amount }),
    ...(rawFrom === undefined && rawTo === undefined ? {} : { operation }),
    ...(rawKind === undefined ? {} : { kind: requireEnum(rawKind, "kind", TAX_OFFICE_KINDS) }),
    ...(after === undefined ? {} : { after }),
    limit: TAX_OFFICE_PAGE_SIZE,
  };
}

/** Every invoice the venue issued, for the tax office, under `invoice.inspect`. */
export function mountTaxOfficeApi(app: Hono, deps: TaxOfficeApiDeps, log: Logger): void {
  app.get("/management-api/tax-office/invoices", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const result = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "invoice.inspect",
        });
        const { timeZone } = await resolveVenueClock(tx, deps.cfg.nodeId);
        const page = await listTaxOfficeInvoices(
          tx,
          readFilter((name) => c.req.query(name), timeZone),
        );
        return { ...page, timeZone };
      });
      c.header("Cache-Control", "no-store");
      return c.json(result);
    }),
  );
  app.post("/management-api/tax-office/invoices/:saleId/pdf", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const saleId = c.req.param("saleId").toLowerCase();
      if (!isUuid(saleId)) throw new AppError("invoice_delivery.not_found", {});
      const copy = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "invoice.inspect",
        });
        return readSaleCopy(tx, deps, saleId, authorizedBy);
      });
      const bytes = await renderSaleCopy(copy);
      return c.body(new Uint8Array(bytes), 200, {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${invoicePdfFileName(copy.code, copy.number)}"`,
        "cache-control": "no-store",
      });
    }),
  );
  app.post("/management-api/tax-office/months/:month", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const raw = c.req.param("month");
      const days = requireMonth(raw);
      let claimedBy: string | null = null;
      // Read outside the transaction, whose write lock sales wait behind.
      const freeBytes = await deps.freeBytes();
      const asked = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "invoice.inspect",
        });
        const running = deps.builds.view(authorizedBy);
        // A repeat takes the running build's view: that build's own writing lowers free space.
        if (running.status !== "building" || running.month !== raw) {
          const neededBytes = SPACE_LOW_BYTES + TAX_OFFICE_ROOM_BYTES;
          if (freeBytes !== null && freeBytes < neededBytes)
            throw new AppError("tax_office.space_low", { freeBytes, neededBytes });
        }
        const { claimed, view } = deps.builds.claim(authorizedBy, raw);
        if (!claimed) return { personId: authorizedBy, view, month: null };
        claimedBy = authorizedBy;
        const { timeZone } = await resolveVenueClock(tx, deps.cfg.nodeId);
        const issued = { ...days, timeZone };
        const locale = await withInspectorAdmitted(() =>
          resolveSessionLocale(tx, sessionId, c.req.header("Accept-Language"), deps.venueLocale),
        );
        const venue = (await readTaxpayer(tx))?.legalName ?? null;
        await recordActivity(tx, {
          kind: "tax_office.month_requested",
          subjectId: "tax-office-month",
          personId: authorizedBy,
          data: { month: raw, invoices: await countTaxOfficeInvoices(tx, issued) },
        });
        const month: TaxOfficeMonth = {
          month: raw,
          issued,
          language: toLanguage(locale),
          venue,
          at: new Date(),
        };
        return { personId: authorizedBy, view, month };
      }).catch((error: unknown) => {
        if (claimedBy !== null) deps.builds.release(claimedBy);
        throw error;
      });
      if (asked.month !== null) deps.builds.begin(asked.personId, asked.month);
      c.header("Cache-Control", "no-store");
      return c.json(asked.view, 202);
    }),
  );
  app.get("/management-api/tax-office/month-download", (c) =>
    run(c, log, async () => {
      const personId = await inspectingPerson(deps.db, requireManagementSession(c));
      c.header("Cache-Control", "no-store");
      return c.json(deps.builds.view(personId));
    }),
  );
  app.get("/management-api/tax-office/month-download/:id/file", (c) =>
    run(c, log, async () => {
      const personId = await inspectingPerson(deps.db, requireManagementSession(c));
      const id = c.req.param("id");
      const file = deps.builds.file(personId, id);
      if (file === null) throw new AppError("tax_office.download_missing", {});
      const size = await stat(file.path).then(
        ({ size }) => size,
        (error: unknown) => {
          if ((error as { code?: unknown }).code === "ENOENT")
            throw new AppError("tax_office.download_missing", {});
          throw error;
        },
      );
      const connection = c.req.raw.signal;
      // Node ends the process when it collects an open file handle. Hono drops a HEAD's body
      // unread, and a connection lost before the answer is written leaves nothing to read or
      // cancel it, so the file is opened only at the first read and closed on every way out.
      let handle: FileHandle | null = null;
      let closed = false;
      const closeHandle = (opened: FileHandle) => {
        opened.close().catch((error: unknown) => {
          log("error", "tax_office.file_close_failed", { errno: errnoOf(error) ?? null });
        });
      };
      const closeFile = () => {
        if (closed) return;
        closed = true;
        connection.removeEventListener("abort", closeFile);
        if (handle !== null) closeHandle(handle);
      };
      if (connection.aborted) closeFile();
      else connection.addEventListener("abort", closeFile);
      // Pulled only as the reader asks, so its end means every byte was taken by the connection.
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              if (handle === null) {
                const opened = await open(file.path, "r");
                if (closed) {
                  closeHandle(opened);
                  throw new Error("The download ended before the file was opened");
                }
                handle = opened;
              }
              const buffer = new Uint8Array(FILE_CHUNK_BYTES);
              const { bytesRead } = await handle.read(buffer, 0, FILE_CHUNK_BYTES, null);
              if (bytesRead > 0) {
                controller.enqueue(buffer.subarray(0, bytesRead));
                return;
              }
            } catch (error) {
              closeFile();
              throw error;
            }
            controller.close();
            const whole = !connection.aborted;
            closeFile();
            if (whole) deps.builds.sent(personId, id);
          },
          cancel: closeFile,
        },
        { highWaterMark: 0 },
      );
      return c.body(body, 200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="invoices-${file.month}.zip"`,
        "Content-Length": String(size),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
    }),
  );
}

/** The session's person, while they hold `invoice.inspect`. */
async function inspectingPerson(db: Database, sessionId: string): Promise<string> {
  const { authorizedBy } = await withTransaction(db, (tx) =>
    authorizeManager(tx, { managementSessionId: sessionId, permission: "invoice.inspect" }),
  );
  return authorizedBy;
}

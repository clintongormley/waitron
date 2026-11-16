import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { readTaxpayer, recordActivity, withTransaction, type Database } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { authorizeManager, withInspectorAdmitted } from "@waitron/identity";
import { resolveVenueClock } from "@waitron/reporting";
import {
  codeOf,
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
import type { Logger } from "./logger.js";
import { readSaleCopy, renderSaleCopy, type SaleCopy } from "./orders-invoice-pdf.js";
import { zipStream } from "./download-archive.js";
import { toLanguage } from "./personal-data-export-api.js";
import { resolveSessionLocale } from "./session-locale.js";
import { taxOfficeMonthEntries, type TaxOfficeMonth } from "./tax-office-export.js";
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
  /** The handover gate's: a month's export stops when it aborts. */
  closed?: AbortSignal;
  /** Default `renderSaleCopy`; a test passes a stub. */
  render?: (copy: SaleCopy) => Promise<Uint8Array>;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "invoice_delivery.not_found": 404,
  "tax_office.export_running": 409,
};

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

/** Releases on the generator's end, or on a `return()` that arrives before the first `next()`,
 * which an async generator answers without running its `finally`. */
function releasing<T>(entries: AsyncGenerator<T>, release: () => void): AsyncIterable<T> {
  let started = false;
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        started = true;
        return entries.next();
      },
      return: (value?: unknown) => {
        if (!started) release();
        return entries.return(value);
      },
    }),
  };
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
  // One export at a time, so two never render at once.
  let running: object | null = null;
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
        "content-disposition": `attachment; filename="${copy.fileName}"`,
        "cache-control": "no-store",
      });
    }),
  );
  app.post("/management-api/tax-office/months/:month", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const raw = c.req.param("month");
      const days = requireMonth(raw);
      const mine = {};
      const release = () => {
        if (running === mine) running = null;
      };
      const month = await withTransaction(deps.db, async (tx): Promise<TaxOfficeMonth> => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "invoice.inspect",
        });
        if (running !== null) throw new AppError("tax_office.export_running", {});
        running = mine;
        const { timeZone } = await resolveVenueClock(tx, deps.cfg.nodeId);
        const issued = { ...days, timeZone };
        const locale = await withInspectorAdmitted(() =>
          resolveSessionLocale(tx, sessionId, c.req.header("Accept-Language"), deps.venueLocale),
        );
        const venue = (await readTaxpayer(tx))?.legalName ?? null;
        await recordActivity(tx, {
          kind: "tax_office.month_downloaded",
          subjectId: "tax-office-month",
          personId: authorizedBy,
          data: { month: raw, invoices: await countTaxOfficeInvoices(tx, issued) },
        });
        return {
          month: raw,
          issued,
          language: toLanguage(locale),
          venue,
          authorizedBy,
          sessionId,
          at: new Date(),
        };
      }).catch((error: unknown) => {
        release();
        throw error;
      });
      const signal = c.req.raw.signal;
      async function* entries() {
        try {
          yield* taxOfficeMonthEntries(
            {
              db: deps.db,
              backend: deps.backend,
              tradingContext: deps.tradingContext,
              render: deps.render ?? renderSaleCopy,
              stopIfAsked: () => {
                if (deps.closed?.aborted === true) throw new AppError("handover.stepping_down", {});
                signal.throwIfAborted();
              },
              log,
            },
            month,
          );
        } catch (error) {
          log("warn", "tax_office.export_stopped", {
            month: raw,
            errorCode: codeOf(error),
            errorClass: error instanceof Error ? error.name : typeof error,
          });
          throw error;
        } finally {
          release();
        }
      }
      return c.body(zipStream(releasing(entries(), release), month.at), 200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="invoices-${raw}.zip"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
    }),
  );
}

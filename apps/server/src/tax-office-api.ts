import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { resolveVenueClock } from "@waitron/reporting";
import {
  createErrorBoundary,
  requireEnum,
  requireManagementSession,
  requirePeriod,
  requireRange,
} from "@waitron/server-kit";
import { AppError, isUuid, stringToBasisPoints, stringToCents } from "@waitron/shared";
import type { Logger } from "./logger.js";
import { optionalSearch } from "./orders-list.js";
import {
  listTaxOfficeInvoices,
  TAX_OFFICE_KINDS,
  TAX_OFFICE_PAGE_SIZE,
  type TaxOfficeCursor,
  type TaxOfficeFilter,
} from "./tax-office-list.js";

export interface TaxOfficeApiDeps {
  db: Database;
  cfg: { nodeId: string };
}

/** Client faults only; anything else reaches `run` as a server fault. */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
};

const run = createErrorBoundary(STATUS, "report.failed");

// Bounds how much of `sales` one search can scan while it holds the write lock.
const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const RATE = /^\d{1,3}(\.\d{1,2})?$/;
const AMOUNT = /^-?\d{1,10}(\.\d{1,2})?$/;
const STORED_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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

/** Every invoice the venue issued, for the tax office, under `invoice.inspect`. Read-only. */
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
}

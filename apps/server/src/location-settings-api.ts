import { readLocationClock } from "@waitron/reporting";
import type { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import {
  readCatalogueSettings,
  readInvoiceLocales,
  saveCatalogueSettings,
} from "@waitron/catalogue";
import { locations, withTransaction, type Database, type Transaction } from "@waitron/db";
import type { FiscalContribution } from "@waitron/fiscal";
import { authorizeManager } from "@waitron/identity";
import { renameTaxpayer } from "@waitron/provisioning";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { readVenueReceiptLanguageRules } from "./venue-locale.js";
import {
  normalizeVenueText,
  readOnlyVenueFields,
  readVenueDetails,
  writeVenueDetails,
} from "./venue-details.js";
import { previewBusinessDayStart, writeBusinessDayStart } from "./business-day-start.js";

import { venueClockPreview } from "./venue-clock-preview.js";
import type { VenueClockPreview, VenueDefaults, VenueDetailWrite } from "./venue-detail-types.js";
import "./errors.js";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "management.request_invalid": 400,
    "product.invalid": 400,
    "receipt.language_fixed": 400,
    "receipt.language_orders_open": 409,
    "venue.business_day_invalid": 400,
    "venue.business_day_changed": 409,
    "venue.business_day_locked": 409,
    "venue.business_day_hours_conflict": 409,
    "venue.detail_invalid": 400,
    "venue.detail_read_only": 409,
    "venue.detail_locked": 409,
    "venue.detail_changed": 409,
  },
  "management.failed",
);

/**
 * The open orders at the location holding a line. The till can still split or move such a line, and
 * the line triggers refuse a copy or a move of text keyed under a language the location no longer has.
 */
async function ordersBlockingReceiptLanguage(tx: Transaction, locationId: string): Promise<number> {
  const { rows } = await tx.execute<{ count: number }>(sql`
    select cast(count(*) as int) as count
    from working_orders wo
    where wo.location_id = ${locationId}
      and wo.status = 'open'
      and exists (select 1 from working_order_lines l where l.working_order_id = wo.id)`);
  return rows[0]!.count;
}

/** The location's saved receipt languages. */
async function storedLanguages(tx: Transaction, locationId: string): Promise<string[]> {
  const stored = await readInvoiceLocales(tx, locationId);
  if (stored.length === 0)
    throw new AppError("management.request_invalid", { field: "locationId" });
  return stored;
}

/** Saves `language` as the location's one receipt language, under the pack's and the region's rules. */
async function writeReceiptLanguage(
  tx: Transaction,
  locationId: string,
  language: string,
): Promise<void> {
  const rules = await readVenueReceiptLanguageRules(tx, { locationId });
  if (!rules.choices.includes(language)) {
    throw new AppError("management.request_invalid", { field: "receiptLanguage" });
  }
  if (rules.fixed !== undefined && language !== rules.fixed.locale) {
    throw new AppError("receipt.language_fixed", {
      field: "receiptLanguage",
      language: rules.fixed.locale,
    });
  }
  const stored = await storedLanguages(tx, locationId);
  // Saving the list the location already holds changes no line's key.
  if (stored.length === 1 && stored[0] === language) return;
  const count = await ordersBlockingReceiptLanguage(tx, locationId);
  if (count > 0) {
    throw new AppError("receipt.language_orders_open", { field: "receiptLanguage", count });
  }
  await tx
    .update(locations)
    .set({ invoiceLocales: [language] })
    .where(eq(locations.id, locationId));
}

async function readVenueDefaults(tx: Transaction, locationId: string): Promise<VenueDefaults> {
  const rules = await readVenueReceiptLanguageRules(tx, { locationId });
  const [receiptLanguage] = await storedLanguages(tx, locationId);
  const { defaultProductVatClass } = await readCatalogueSettings(tx);
  return {
    receiptLanguage: receiptLanguage!,
    receiptLanguageChoices: [...rules.choices],
    fixedReceiptLanguage: rules.fixed?.locale ?? null,
    defaultProductVatClass,
  };
}

function venueDefaultsRequest(body: unknown): {
  receiptLanguage?: unknown;
  defaultProductVatClass?: unknown;
} {
  const keys =
    typeof body === "object" && body !== null && !Array.isArray(body) ? Object.keys(body) : [];
  if (
    keys.length === 0 ||
    keys.some((key) => key !== "receiptLanguage" && key !== "defaultProductVatClass")
  )
    throw new AppError("management.request_invalid", { field: "body" });
  return body as { receiptLanguage?: unknown; defaultProductVatClass?: unknown };
}

function legalNameRequest(body: unknown): { legalName: string; expected: string } {
  const invalid = (field: string, reason: string) =>
    new AppError("venue.detail_invalid", { field, reason });
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw invalid("body", "type");
  for (const key of Object.keys(body))
    if (key !== "legalName" && readOnlyVenueFields.has(key))
      throw new AppError("venue.detail_read_only", { field: key });
  if (Object.keys(body).some((key) => key !== "legalName" && key !== "expected"))
    throw invalid("body", "unknown_field");
  const { legalName, expected } = body as Record<string, unknown>;
  if (typeof legalName !== "string") throw invalid("legalName", "type");
  if (typeof expected !== "string") throw invalid("expected", "type");
  return { legalName: normalizeVenueText(legalName), expected: normalizeVenueText(expected) };
}

export function mountLocationSettingsApi(
  app: Hono,
  deps: {
    db: Database;
    cfg: { locationId: string };
    fiscal: FiscalContribution;
    now?: () => Date;
    readBackupDeadlines?: () => VenueClockPreview["backupDeadlines"];
  },
  log: Logger,
): void {
  const gated = <T>(
    sessionId: string,
    fn: (tx: Transaction) => Promise<T>,
    permission: "venue.configure" | "venue.view" = "venue.configure",
  ) =>
    withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission,
      });
      return fn(tx);
    });
  app.get("/management-api/venue-details", (c) =>
    run(c, log, async () => {
      const model = await gated(
        requireManagementSession(c),
        (tx) => readVenueDetails(tx, deps.cfg, (deps.now ?? (() => new Date()))()),
        "venue.view",
      );
      return c.json(model);
    }),
  );
  app.get("/management-api/venue-details/business-day-start/preview", (c) =>
    run(c, log, async () => {
      const query = c.req.query();
      const model = await gated(
        requireManagementSession(c),
        (tx) =>
          previewBusinessDayStart(
            tx,
            deps.cfg,
            {
              ...query,
              expectedClockRevision: /^\d+$/.test(query.expectedClockRevision ?? "")
                ? Number(query.expectedClockRevision)
                : query.expectedClockRevision,
            },
            (deps.now ?? (() => new Date()))(),
          ),
        "venue.view",
      );
      return c.json({
        ...model,
        backupDeadlines: deps.readBackupDeadlines?.() ?? model.backupDeadlines,
      });
    }),
  );
  app.put("/management-api/venue-details/business-day-start", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const body = await readJsonBody<unknown>(c);
      const result = await gated(session, (tx) =>
        writeBusinessDayStart(tx, deps.cfg, body, (deps.now ?? (() => new Date()))()),
      );
      return c.json(result);
    }),
  );
  app.get("/management-api/venue-details/clock-preview", (c) =>
    run(c, log, async () => {
      const model = await gated(
        requireManagementSession(c),
        async (tx) => ({
          details: await readVenueDetails(tx, deps.cfg),
          clock: await readLocationClock(tx, deps.cfg.locationId),
        }),
        "venue.view",
      );
      const preview = venueClockPreview(
        (deps.now ?? (() => new Date()))(),
        model.clock,
        {
          ...model.clock,
          timeZone: c.req.query("timeZone") ?? "",
          dayCutover: c.req.query("dayCutover") ?? "",
        },
        deps.readBackupDeadlines?.() ?? { archive: null, cloud: null },
      );
      return c.json(preview);
    }),
  );
  app.patch("/management-api/venue-details", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<unknown>(c);
      const result = await gated(sessionId, (tx) =>
        writeVenueDetails(
          tx,
          deps.cfg,
          body as VenueDetailWrite,
          (deps.now ?? (() => new Date()))(),
        ),
      );
      return c.json(result);
    }),
  );
  app.put("/management-api/venue-details/legal-name", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<unknown>(c);
      const result = await gated(sessionId, async (tx) => {
        const { legalName, expected } = legalNameRequest(body);
        const refuse = (reason: string) =>
          new AppError("venue.detail_invalid", { field: "legalName", reason });
        if (legalName === "") throw refuse("required");
        try {
          deps.fiscal.venueFields?.validateLegalName(legalName);
        } catch (error) {
          if (
            !isAppError(error) ||
            !hasCode(error, "setup.request_invalid") ||
            error.params.field !== "legalName"
          )
            throw error;
          throw refuse("fiscal_format");
        }
        const { issuer } = await readVenueDetails(tx, deps.cfg);
        const stored = normalizeVenueText(issuer.legalName);
        if (legalName === stored && expected === stored) throw refuse("unchanged");
        // A match after normalising stands for the stored spelling, which the write compares exactly.
        const { renamed } = await renameTaxpayer(tx, {
          expected: expected === stored ? issuer.legalName : expected,
          legalName,
        });
        if (!renamed) throw new AppError("venue.detail_changed", { field: "legalName" });
        return { model: await readVenueDetails(tx, deps.cfg) };
      });
      return c.json(result);
    }),
  );
  app.get("/management-api/receipt-language", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const answer = await gated(sessionId, async (tx) => {
        const rules = await readVenueReceiptLanguageRules(tx, {
          locationId: deps.cfg.locationId,
        });
        const [language] = await storedLanguages(tx, deps.cfg.locationId);
        return { language, choices: rules.choices, fixed: rules.fixed ?? null };
      });
      return c.json(answer);
    }),
  );
  app.get("/management-api/venue-defaults", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(
        await gated(sessionId, (tx) => readVenueDefaults(tx, deps.cfg.locationId), "venue.view"),
      );
    }),
  );
  app.put("/management-api/venue-defaults", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<unknown>(c);
      const answer = await gated(sessionId, async (tx) => {
        const request = venueDefaultsRequest(body);
        if ("receiptLanguage" in request) {
          if (typeof request.receiptLanguage !== "string")
            throw new AppError("management.request_invalid", { field: "receiptLanguage" });
          await writeReceiptLanguage(tx, deps.cfg.locationId, request.receiptLanguage);
        }
        if ("defaultProductVatClass" in request)
          await saveCatalogueSettings(tx, {
            defaultProductVatClass: request.defaultProductVatClass,
          });
        return readVenueDefaults(tx, deps.cfg.locationId);
      });
      return c.json(answer);
    }),
  );
}

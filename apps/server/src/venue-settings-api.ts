import type { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { readCatalogueSettings, saveCatalogueSettings } from "@waitron/catalogue";
import {
  locations,
  readVenue,
  venueLocationId,
  withTransaction,
  type Database,
  type Transaction,
  type Venue,
} from "@waitron/db";
import type { ReceiptLanguageRules } from "@waitron/country";
import type { FiscalContribution } from "@waitron/fiscal";
import { authorizeManager } from "@waitron/identity";
import { readPrivacyContact, renameTaxpayer, savePrivacyContact } from "@waitron/provisioning";
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
import { privacyContactRequest } from "./venue-privacy.js";
import type { VenueClockPreview, VenueDefaults, VenueDetailWrite } from "./venue-detail-types.js";
import "./errors.js";

const run = createErrorBoundary(
  {
    "venue.time_zone_not_ready": 409,
    "venue.not_found": 409,
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
 * The open orders holding a line. The till can still split or move such a line, and the line
 * triggers refuse a copy or a move of text keyed under a language the venue no longer has.
 */
async function ordersBlockingReceiptLanguage(tx: Transaction): Promise<number> {
  const { rows } = await tx.execute<{ count: number }>(sql`
    select cast(count(*) as int) as count
    from working_orders wo
    where wo.status = 'open'
      and exists (select 1 from working_order_lines l where l.working_order_id = wo.id)`);
  return rows[0]!.count;
}

interface ReceiptLanguageState {
  venue: Venue;
  rules: ReceiptLanguageRules;
}

async function readReceiptLanguageState(tx: Transaction): Promise<ReceiptLanguageState> {
  const venue = await readVenue(tx);
  return { venue, rules: await readVenueReceiptLanguageRules(tx, venue) };
}

/** Saves `language` as the venue's one receipt language, under the pack's and the region's rules,
 * and answers the state as saved. */
async function writeReceiptLanguage(
  tx: Transaction,
  state: ReceiptLanguageState,
  language: string,
): Promise<ReceiptLanguageState> {
  const { venue, rules } = state;
  if (!rules.choices.includes(language)) {
    throw new AppError("management.request_invalid", { field: "receiptLanguage" });
  }
  if (rules.fixed !== undefined && language !== rules.fixed.locale) {
    throw new AppError("receipt.language_fixed", {
      field: "receiptLanguage",
      language: rules.fixed.locale,
    });
  }
  const stored = venue.invoiceLocales;
  // Saving the list the venue already holds changes no line's key.
  if (stored.length === 1 && stored[0] === language) return state;
  const count = await ordersBlockingReceiptLanguage(tx);
  if (count > 0) {
    throw new AppError("receipt.language_orders_open", { field: "receiptLanguage", count });
  }
  const invoiceLocales = [language];
  await tx
    .update(locations)
    .set({ invoiceLocales })
    .where(eq(locations.id, await venueLocationId(tx)));
  return { rules, venue: { ...venue, invoiceLocales } };
}

async function readVenueDefaults(
  tx: Transaction,
  { venue, rules }: ReceiptLanguageState,
): Promise<VenueDefaults> {
  const { defaultProductVatClass } = await readCatalogueSettings(tx);
  return {
    receiptLanguage: venue.invoiceLocales[0]!,
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

function withTaxpayer<T>(contact: T | null): T {
  if (contact === null) throw new AppError("venue.not_found", {});
  return contact;
}

export function mountVenueSettingsApi(
  app: Hono,
  deps: {
    db: Database;
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
        (tx) => readVenueDetails(tx, (deps.now ?? (() => new Date()))()),
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
        writeBusinessDayStart(tx, body, (deps.now ?? (() => new Date()))()),
      );
      return c.json(result);
    }),
  );
  app.get("/management-api/venue-details/clock-preview", (c) =>
    run(c, log, async () => {
      const model = await gated(
        requireManagementSession(c),
        async (tx) => ({ clock: (await readVenueDetails(tx)).businessDayClock.clock }),
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
        writeVenueDetails(tx, body as VenueDetailWrite, (deps.now ?? (() => new Date()))()),
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
        const at = new Date();
        const { issuer, businessDayClock } = await readVenueDetails(tx, at);
        const stored = normalizeVenueText(issuer.legalName);
        if (legalName === stored && expected === stored) throw refuse("unchanged");
        // A match after normalising stands for the stored spelling, which the write compares exactly.
        const { renamed } = await renameTaxpayer(tx, {
          expected: expected === stored ? issuer.legalName : expected,
          legalName,
        });
        if (!renamed) throw new AppError("venue.detail_changed", { field: "legalName" });
        return { model: await readVenueDetails(tx, at, businessDayClock) };
      });
      return c.json(result);
    }),
  );
  app.get("/management-api/receipt-language", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const answer = await gated(sessionId, async (tx) => {
        const { venue, rules } = await readReceiptLanguageState(tx);
        return {
          language: venue.invoiceLocales[0],
          choices: rules.choices,
          fixed: rules.fixed ?? null,
        };
      });
      return c.json(answer);
    }),
  );
  app.get("/management-api/venue-privacy", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(
        await gated(
          sessionId,
          async (tx) => withTaxpayer(await readPrivacyContact(tx)),
          "venue.view",
        ),
      );
    }),
  );
  app.put("/management-api/venue-privacy", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<unknown>(c);
      const answer = await gated(sessionId, async (tx) =>
        withTaxpayer(await savePrivacyContact(tx, privacyContactRequest(body))),
      );
      return c.json(answer);
    }),
  );
  app.get("/management-api/venue-defaults", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(
        await gated(
          sessionId,
          async (tx) => readVenueDefaults(tx, await readReceiptLanguageState(tx)),
          "venue.view",
        ),
      );
    }),
  );
  app.put("/management-api/venue-defaults", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<unknown>(c);
      const answer = await gated(sessionId, async (tx) => {
        const request = venueDefaultsRequest(body);
        let state: ReceiptLanguageState | undefined;
        if ("receiptLanguage" in request) {
          if (typeof request.receiptLanguage !== "string")
            throw new AppError("management.request_invalid", { field: "receiptLanguage" });
          state = await writeReceiptLanguage(
            tx,
            await readReceiptLanguageState(tx),
            request.receiptLanguage,
          );
        }
        if ("defaultProductVatClass" in request)
          await saveCatalogueSettings(tx, {
            defaultProductVatClass: request.defaultProductVatClass,
          });
        return readVenueDefaults(tx, state ?? (await readReceiptLanguageState(tx)));
      });
      return c.json(answer);
    }),
  );
}

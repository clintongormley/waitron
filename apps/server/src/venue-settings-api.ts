import type { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { readMenuSettings, readVenueVatRates, saveMenuDefaultTakeawayVatRate } from "@waitron/menu";
import {
  readVenue,
  saveVenueFields,
  taxpayer,
  withTransaction,
  type Database,
  type Transaction,
  type Venue,
} from "@waitron/db";
import type { ReceiptLanguageRules } from "@waitron/country";
import { getCountryPack } from "@waitron/country-packs";
import type { FiscalContribution } from "@waitron/fiscal";
import { authorizeManager, requireFreshManagementSignIn } from "@waitron/identity";
import {
  changeTaxpayerDomicile,
  readPrivacyContact,
  renameTaxpayer,
  saveBankAccount,
  savePrivacyContact,
} from "@waitron/provisioning";
import { AppError, hasCode, isAppError, normalizeIban } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { VENUE_SERVICE } from "./modules.js";
import { readVenueReceiptLanguageRules } from "./venue-locale.js";
import {
  normalizeVenueText,
  readOnlyVenueFields,
  readVenueDetails,
  writeVenueDetails,
} from "./venue-details.js";
import { previewBusinessDayStart, writeBusinessDayStart } from "./business-day-start.js";

import { venueClockPreview } from "./venue-clock-preview.js";
import { registeredAddressRefusal } from "./registered-address-check.js";
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
    "venue.detail_read_only": 400,
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
  personId: string,
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
  await saveVenueFields(tx, { invoiceLocales }, personId);
  return { rules, venue: { ...venue, invoiceLocales } };
}

async function readVenueDefaults(
  tx: Transaction,
  { venue, rules }: ReceiptLanguageState,
): Promise<VenueDefaults> {
  const rates = await readVenueVatRates(tx);
  const { defaultTakeawayVatRate } = await readMenuSettings(tx, rates);
  return {
    receiptLanguage: venue.invoiceLocales[0]!,
    receiptLanguageChoices: [...rules.choices],
    fixedReceiptLanguage: rules.fixed?.locale ?? null,
    defaultTakeawayVatRate,
    takeawayVat: await VENUE_SERVICE.venueChargesTakeawayVat(tx),
    vatRates: [...rates.pickable],
  };
}

interface VenueDefaultsRequest {
  receiptLanguage?: unknown;
  defaultTakeawayVatRate?: unknown;
}

const VENUE_DEFAULTS_KEYS = ["receiptLanguage", "defaultTakeawayVatRate"];

function venueDefaultsRequest(body: unknown): VenueDefaultsRequest {
  const keys =
    typeof body === "object" && body !== null && !Array.isArray(body) ? Object.keys(body) : [];
  if (keys.length === 0 || keys.some((key) => !VENUE_DEFAULTS_KEYS.includes(key)))
    throw new AppError("management.request_invalid", { field: "body" });
  return body as VenueDefaultsRequest;
}

interface StoredTaxpayerFields {
  legalName: string;
  taxpayerDomicile: string | null;
}

/** The new value of one taxpayer field and the value the page showed, both normalised. */
function taxpayerFieldRequest(
  body: unknown,
  field: keyof StoredTaxpayerFields,
): { value: string; expected: string } {
  const invalid = (name: string, reason: string) =>
    new AppError("venue.detail_invalid", { field: name, reason });
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw invalid("body", "type");
  for (const key of Object.keys(body))
    if (key !== field && readOnlyVenueFields.has(key))
      throw new AppError("venue.detail_read_only", { field: key });
  if (Object.keys(body).some((key) => key !== field && key !== "expected"))
    throw invalid("body", "unknown_field");
  const { [field]: value, expected } = body as Record<string, unknown>;
  if (typeof value !== "string") throw invalid(field, "type");
  if (typeof expected !== "string") throw invalid("expected", "type");
  return { value: normalizeVenueText(value), expected: normalizeVenueText(expected) };
}

interface BankAccountRequest {
  iban: string;
  bankName: string;
  expected: { iban: string; bankName: string };
}

/** The bank-account body, refused as `taxpayerFieldRequest` refuses a taxpayer field's. */
function bankAccountRequest(body: unknown): BankAccountRequest {
  const invalid = (name: string, reason: string) =>
    new AppError("venue.detail_invalid", { field: name, reason });
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isObject(body)) throw invalid("body", "type");
  for (const key of Object.keys(body))
    if (readOnlyVenueFields.has(key)) throw new AppError("venue.detail_read_only", { field: key });
  const fields = ["iban", "bankName"];
  if (Object.keys(body).some((key) => !fields.includes(key) && key !== "expected"))
    throw invalid("body", "unknown_field");
  for (const field of fields) if (typeof body[field] !== "string") throw invalid(field, "type");
  const { expected } = body;
  if (!isObject(expected)) throw invalid("expected", "type");
  if (Object.keys(expected).some((key) => !fields.includes(key)))
    throw invalid("expected", "unknown_field");
  if (typeof expected.iban !== "string" || typeof expected.bankName !== "string")
    throw invalid("expected", "type");
  return {
    iban: body.iban as string,
    bankName: body.bankName as string,
    expected: {
      iban: normalizeIban(expected.iban),
      bankName: normalizeVenueText(expected.bankName),
    },
  };
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
    fn: (tx: Transaction, personId: string) => Promise<T>,
    permission: "venue.configure" | "venue.view" = "venue.configure",
  ) =>
    withTransaction(deps.db, async (tx) => {
      const { authorizedBy } = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission,
      });
      return fn(tx, authorizedBy);
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
      const result = await gated(session, (tx, personId) =>
        writeBusinessDayStart(tx, body, (deps.now ?? (() => new Date()))(), personId),
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
      const result = await gated(sessionId, (tx, personId) =>
        writeVenueDetails(
          tx,
          body as VenueDetailWrite,
          (deps.now ?? (() => new Date()))(),
          personId,
        ),
      );
      return c.json(result);
    }),
  );
  const taxpayerFieldRoute = <F extends keyof StoredTaxpayerFields>(route: {
    path: string;
    field: F;
    /** The refusal reason for a value this field's own rules refuse, if any; `country` is the
     *  taxpayer's, when there is one. */
    check?: (value: string, country: string | undefined) => string | undefined;
    write: (
      tx: Transaction,
      change: { expected: StoredTaxpayerFields[F] | string; value: string; personId: string },
    ) => Promise<boolean>;
  }) =>
    app.put(route.path, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<unknown>(c);
        const result = await gated(sessionId, async (tx, personId) => {
          await requireFreshManagementSignIn(tx, sessionId);
          const { value, expected } = taxpayerFieldRequest(body, route.field);
          const refuse = (reason: string) =>
            new AppError("venue.detail_invalid", { field: route.field, reason });
          if (value === "") throw refuse("required");
          const [row] = await tx
            .select({
              country: taxpayer.country,
              legalName: taxpayer.legalName,
              taxpayerDomicile: taxpayer.taxpayerDomicile,
            })
            .from(taxpayer)
            .where(eq(taxpayer.id, 1));
          const refused = route.check?.(value, row?.country);
          if (refused !== undefined) throw refuse(refused);
          if (row === undefined) throw new AppError("venue.not_found", {});
          const stored: StoredTaxpayerFields[F] = row[route.field];
          const shown = normalizeVenueText(stored ?? "");
          if (value === shown && expected === shown) throw refuse("unchanged");
          // A match after normalising stands for the stored spelling, which the write compares
          // exactly; a page showing nothing sends "", which stands for a stored null.
          const written = await route.write(tx, {
            expected: expected === shown ? stored : expected,
            value,
            personId,
          });
          if (!written) throw new AppError("venue.detail_changed", { field: route.field });
          return { model: await readVenueDetails(tx, (deps.now ?? (() => new Date()))()) };
        });
        return c.json(result);
      }),
    );
  taxpayerFieldRoute({
    path: "/management-api/venue-details/legal-name",
    field: "legalName",
    check: (legalName) => {
      try {
        deps.fiscal.venueFields?.validateLegalName(legalName);
        return undefined;
      } catch (error) {
        if (
          !isAppError(error) ||
          !hasCode(error, "setup.request_invalid") ||
          error.params.field !== "legalName"
        )
          throw error;
        return "fiscal_format";
      }
    },
    write: async (tx, { expected, value, personId }) =>
      (await renameTaxpayer(tx, { expected, legalName: value, personId })).renamed,
  });
  taxpayerFieldRoute({
    path: "/management-api/venue-details/registered-address",
    field: "taxpayerDomicile",
    check: (line, country) => {
      const pack = getCountryPack(country ?? "");
      return pack === undefined ? undefined : registeredAddressRefusal(line, pack);
    },
    write: async (tx, { expected, value, personId }) =>
      (await changeTaxpayerDomicile(tx, { expected, taxpayerDomicile: value, personId })).changed,
  });
  app.put("/management-api/venue-details/bank-account", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<unknown>(c);
      const result = await gated(sessionId, async (tx, personId) => {
        await requireFreshManagementSignIn(tx, sessionId);
        const change = await saveBankAccount(tx, { ...bankAccountRequest(body), personId });
        if (!change.saved) throw new AppError("venue.detail_changed", { field: "iban" });
        return { model: await readVenueDetails(tx, (deps.now ?? (() => new Date()))()) };
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
      const answer = await gated(sessionId, async (tx, personId) =>
        withTaxpayer(await savePrivacyContact(tx, privacyContactRequest(body), personId)),
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
      const answer = await gated(sessionId, async (tx, personId) => {
        const request = venueDefaultsRequest(body);
        let state: ReceiptLanguageState | undefined;
        if ("receiptLanguage" in request) {
          if (typeof request.receiptLanguage !== "string")
            throw new AppError("management.request_invalid", { field: "receiptLanguage" });
          state = await writeReceiptLanguage(
            tx,
            await readReceiptLanguageState(tx),
            request.receiptLanguage,
            personId,
          );
        }
        if ("defaultTakeawayVatRate" in request)
          await saveMenuDefaultTakeawayVatRate(tx, request.defaultTakeawayVatRate, personId);
        return readVenueDefaults(tx, state ?? (await readReceiptLanguageState(tx)));
      });
      return c.json(answer);
    }),
  );
}

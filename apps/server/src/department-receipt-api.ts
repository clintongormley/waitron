import "./errors.js";
import type { Hono } from "hono";
import { readReceiptLanguage } from "@waitron/catalogue";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import {
  getStoredLogoRasters,
  getVenueReceiptSettings,
  putVenueReceiptSettings,
  validateDepartmentReceipt,
  validateVenueReceiptSettings,
  type ReceiptLogoRasters,
} from "@waitron/layouts";
import { imageExists, readImageBytes } from "@waitron/media";
import {
  createErrorBoundary,
  readJsonBody,
  requireManagementSession,
  requireUuidParam,
} from "@waitron/server-kit";
import { AppError, untranslatedLanguages } from "@waitron/shared";
import type { Logger } from "./logger.js";
import { VENUE_SERVICE } from "./modules.js";
import { drawLogoRasters } from "./receipt-logo.js";
import type { TillConfig } from "./till-config.js";
import { readLocationAddress } from "./venue-address.js";
import { readVenueReceiptLanguageRules } from "./venue-locale.js";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "management.request_invalid": 400,
    "receipt.invalid": 400,
    "image.invalid_file": 422,
    "shared.invalid_id": 400,
    "department.not_found": 404,
  },
  "management.failed",
);

function logoNotFound() {
  return new AppError("receipt.invalid", { reason: "image_not_found", field: "logo" });
}

async function authorize(tx: Transaction, managementSessionId: string) {
  await authorizeManager(tx, { managementSessionId, permission: "layout.configure" });
}

async function prepareLogo(
  tx: Transaction,
  logo: string | undefined,
  kept: ReceiptLogoRasters | null,
) {
  if (logo === undefined) return undefined;
  if (kept !== null) return kept;
  const image = await readImageBytes(tx, logo);
  if (image === null) throw logoNotFound();
  return image.bytes;
}

export function mountDepartmentReceiptApi(
  app: Hono,
  deps: { db: Database; venueCfg: () => TillConfig },
  log: Logger,
): void {
  app.get("/management-api/venue-service/departments/:id/receipt", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "departmentId");
      const cfg = deps.venueCfg();
      const body = await withTransaction(deps.db, async (tx) => {
        await authorize(tx, sessionId);
        const { choices: languages } = await readVenueReceiptLanguageRules(tx, cfg);
        const receipt = await VENUE_SERVICE.readDepartmentReceipt(
          tx,
          { ...cfg, receiptLanguages: languages },
          id,
        );
        const { locale: receiptLanguage } = await readReceiptLanguage(tx, cfg.locationId);
        const venueDefaults = await getVenueReceiptSettings(tx);
        const venueAddress = await readLocationAddress(tx, cfg.locationId);
        return {
          receipt,
          receiptLanguage,
          venueDefaults,
          languages,
          warningLanguages: untranslatedLanguages(
            [receipt.headerSubtitle, receipt.footerMessage],
            languages,
          ),
          venueAddress,
        };
      });
      return c.json(body);
    }),
  );

  app.put("/management-api/venue-service/departments/:id/receipt", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "departmentId");
      const body = await readJsonBody<unknown>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body) || !("receipt" in body))
        throw new AppError("management.request_invalid", { field: "receipt" });
      const cfg = deps.venueCfg();
      // Sharp runs between transactions; the write repeats permission, scope, language and image checks.
      const prepared = await withTransaction(deps.db, async (tx) => {
        await authorize(tx, sessionId);
        const { choices: languages } = await readVenueReceiptLanguageRules(tx, cfg);
        const scope = { ...cfg, receiptLanguages: languages };
        const current = await VENUE_SERVICE.readDepartmentReceipt(tx, scope, id);
        const receipt = validateDepartmentReceipt(body.receipt, languages);
        const kept =
          receipt.logo !== undefined && receipt.logo === current.logo
            ? await VENUE_SERVICE.readDepartmentLogoRasters(tx, scope, id)
            : null;
        return { picture: await prepareLogo(tx, receipt.logo, kept) };
      });
      const rasters =
        prepared.picture instanceof Uint8Array
          ? await drawLogoRasters(prepared.picture)
          : prepared.picture;
      await withTransaction(deps.db, async (tx) => {
        await authorize(tx, sessionId);
        const { choices: languages } = await readVenueReceiptLanguageRules(tx, cfg);
        const receipt = validateDepartmentReceipt(body.receipt, languages);
        if (receipt.logo !== undefined && !(await imageExists(tx, receipt.logo)))
          throw logoNotFound();
        await VENUE_SERVICE.writeDepartmentReceipt(
          tx,
          { ...cfg, receiptLanguages: languages },
          id,
          receipt,
          rasters,
        );
      });
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/receipt-settings", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const settings = await withTransaction(deps.db, async (tx) => {
        await authorize(tx, sessionId);
        return getVenueReceiptSettings(tx);
      });
      return c.json({ settings });
    }),
  );

  app.put("/management-api/receipt-settings", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<unknown>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body) || !("settings" in body))
        throw new AppError("management.request_invalid", { field: "settings" });
      // Defaults retain contact from the write transaction; decoding does not hold the write lock.
      const prepared = await withTransaction(deps.db, async (tx) => {
        await authorize(tx, sessionId);
        const settings = validateVenueReceiptSettings(body.settings);
        const kept =
          settings.logo === undefined ? null : await getStoredLogoRasters(tx, settings.logo);
        return { settings, picture: await prepareLogo(tx, settings.logo, kept) };
      });
      const logoRasters =
        prepared.picture instanceof Uint8Array
          ? await drawLogoRasters(prepared.picture)
          : prepared.picture;
      await withTransaction(deps.db, async (tx) => {
        if (
          prepared.settings.logo !== undefined &&
          !(await imageExists(tx, prepared.settings.logo))
        )
          throw logoNotFound();
        await putVenueReceiptSettings(tx, {
          managementSessionId: sessionId,
          settings: body.settings,
          ...(logoRasters === undefined ? {} : { logoRasters }),
        });
      });
      return c.body(null, 204);
    }),
  );
}

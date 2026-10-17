import "./errors.js";
import type { Hono } from "hono";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { ReceiptLogoRasters } from "@waitron/layouts";
import { readCurrentImage, readPresentations, renderRendition } from "@waitron/media";
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
import { departmentReceiptLanguages } from "./department-receipt-languages.js";
import { checkedDepartmentReceiptWrite } from "./department-receipt-draft.js";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "management.request_invalid": 400,
    "receipt.invalid": 400,
    "image.invalid_file": 422,
    "image.changed": 409,
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
  const image = await readCurrentImage(tx, logo);
  if (image === null) throw logoNotFound();
  return { ...image, kept };
}

export function mountDepartmentReceiptSettingsApi(
  app: Hono,
  deps: {
    db: Database;
    venueCfg: () => TillConfig;
    validateOperationDescription?: (description: string) => void;
  },
  log: Logger,
): void {
  app.get("/management-api/venue-service/departments/:id/receipt", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "departmentId");
      const cfg = deps.venueCfg();
      const body = await withTransaction(deps.db, async (tx) => {
        await authorize(tx, sessionId);
        const { receiptLanguage, languages, storageLanguages } = await departmentReceiptLanguages(
          tx,
          cfg,
        );
        const stored = await VENUE_SERVICE.readDepartmentReceipt(
          tx,
          { ...cfg, receiptLanguages: storageLanguages },
          id,
        );
        const receipt =
          stored.operationDescription === undefined && cfg.operationDescriptionDefault !== undefined
            ? { ...stored, operationDescription: cfg.operationDescriptionDefault }
            : stored;
        const policy = await VENUE_SERVICE.readDepartmentReceiptPolicy(tx, cfg, id);
        const venueAddress = await readLocationAddress(tx, cfg.locationId);
        return {
          receipt,
          policy,
          receiptLanguage,
          operationDescriptionRequired: deps.validateOperationDescription !== undefined,
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
      const cfg = deps.venueCfg();
      // Decoding runs outside the write queue; permission, scope, language, policy and image are rechecked before saving.
      const prepared = await withTransaction(deps.db, async (tx) => {
        const checked = await checkedDepartmentReceiptWrite(
          tx,
          cfg,
          id,
          sessionId,
          body,
          deps.validateOperationDescription,
        );
        const receipt = checked.input.receipt;
        const current = await VENUE_SERVICE.readDepartmentReceipt(tx, checked.scope, id);
        const kept =
          receipt.logo !== undefined && receipt.logo === current.logo
            ? await VENUE_SERVICE.readDepartmentLogoRasters(tx, checked.scope, id)
            : null;
        return prepareLogo(tx, receipt.logo, kept);
      });
      const rasters =
        prepared === undefined
          ? undefined
          : (prepared.kept ??
            (await drawLogoRasters(
              await renderRendition(prepared.bytes, "display", prepared.framing),
            )));
      await withTransaction(deps.db, async (tx) => {
        const checked = await checkedDepartmentReceiptWrite(
          tx,
          cfg,
          id,
          sessionId,
          body,
          deps.validateOperationDescription,
        );
        const { receipt } = checked.input;
        if (receipt.logo !== undefined) {
          const current = (await readPresentations(tx, [receipt.logo]))[receipt.logo];
          if (!current) throw logoNotFound();
          if (current.revision !== prepared?.revision)
            throw new AppError("image.changed", { imageId: current.id });
        }
        await VENUE_SERVICE.saveDepartmentReceiptSettings(
          tx,
          checked.scope,
          id,
          checked.input,
          rasters,
        );
      });
      return c.body(null, 204);
    }),
  );
}

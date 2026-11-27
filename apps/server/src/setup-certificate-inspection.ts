import { ALL_MODULES } from "@waitron/composition";
import { venueFiscalSelection } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { readRawJsonBody } from "@waitron/server-kit";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { isSecure } from "./encrypted-connection.js";
import type { Logger } from "./logger.js";
import { sentFromThisOrigin } from "./own-page.js";
import type { SetupDeps } from "./setup-api-deps.js";
import { runProvision } from "./setup-api-errors.js";
import "./errors.js";

export const CERTIFICATE_INSPECTION_PATH = "/setup-api/certificate/inspect";

export function mountSetupCertificateInspection(app: Hono, deps: SetupDeps, log: Logger): void {
  let busy = false;
  app.post(
    CERTIFICATE_INSPECTION_PATH,
    (c, next) =>
      runProvision(c, log, async () => {
        c.header("Cache-Control", "no-store");
        if (!isSecure(c)) throw new AppError("setup.connection_insecure", {});
        if (!sentFromThisOrigin(c)) throw new AppError("setup.owner_required", {});
        if (
          c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
        )
          throw new AppError("setup.request_invalid", { field: "body" });
        await next();
        return c.res;
      }),
    bodyLimit({
      maxSize: 256 * 1024,
      onError: (c) =>
        c.json(
          {
            error: {
              code: "setup.certificate_refused",
              params: { field: "pfxBase64", reason: "too_large" },
            },
          },
          413,
        ),
    }),
    (c) =>
      runProvision(c, log, async () => {
        const body = await readRawJsonBody<{ fiscalTerritory?: unknown; aeatCert?: unknown }>(c);
        if (typeof body?.fiscalTerritory !== "string")
          throw new AppError("setup.request_invalid", { field: "fiscalTerritory" });
        const { contribution } = venueFiscalSelection(
          deps.firstFiscal?.modules ?? ALL_MODULES,
          body.fiscalTerritory,
        );
        const secret = contribution?.provisioningSecret;
        if (deps.devMode || !secret?.required("production") || !secret.inspect)
          throw new AppError("setup.request_invalid", { field: "fiscalTerritory" });
        if (busy)
          return c.json(
            {
              error: {
                code: "setup.certificate_refused",
                params: { field: "body", reason: "busy" },
              },
            },
            409,
          );
        busy = true;
        try {
          return c.json(await secret.inspect(body.aeatCert));
        } finally {
          busy = false;
        }
      }),
  );
}

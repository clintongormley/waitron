import { createErrorBoundary, type Logger } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { Hono } from "hono";
import { openingKeyFor } from "./backup-file-key.js";
import {
  listHostDriveBackups,
  readDriveJson,
  SETUP_DRIVE_LIST_BODY_MAX,
} from "./drive-backup-files.js";
import type { SetupDeps } from "./setup-api-deps.js";
import { directError, runRestore } from "./setup-api-errors.js";
import { assertOwnerTransport } from "./setup-recovery-preparation-api.js";
import { asMasterKey, invalidRequest } from "./setup-request-fields.js";
import "./errors.js";

const runDriveList = createErrorBoundary(
  {
    "setup.not_ready": 503,
    "setup.owner_required": 403,
    "setup.request_invalid": 400,
    "box_host.unavailable": 409,
    "box_host.busy": 409,
    "box_host.failed": 502,
  },
  "setup.drive_list_failed",
);

/** `POST /setup-api/restore/preview` and `POST /setup-api/recovery/drives`. */
export function mountSetupDriveRoutes(
  app: Hono,
  deps: SetupDeps,
  log: Logger,
  options: { busy(): boolean; setBusy(value: boolean): void },
): void {
  app.post("/setup-api/recovery/drives", (c) =>
    runDriveList(c, log, async () => {
      c.header("Cache-Control", "no-store");
      assertOwnerTransport(c);
      const host = deps.driveHost;
      if (host === undefined) throw new AppError("setup.not_ready", {});
      if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json"))
        invalidRequest("body");
      const body = await readDriveJson(c.req.raw, SETUP_DRIVE_LIST_BODY_MAX);
      if (typeof body !== "object" || body === null || Array.isArray(body)) invalidRequest("body");
      if (Object.keys(body).length > 0) invalidRequest("body");
      return c.json(await listHostDriveBackups(host, { root: deps.drivesRoot, log }), 200);
    }),
  );

  app.post("/setup-api/restore/preview", async (c) => {
    const preview = deps.previewRestore;
    if (preview === undefined || deps.receiveArchive === undefined)
      return directError(c, log, "setup.not_ready", 503);
    if (options.busy()) return directError(c, log, "setup.already_provisioning", 409);
    options.setBusy(true);
    return runRestore(c, log, async () => {
      try {
        const type = c.req.header("content-type")?.toLowerCase() ?? "";
        const json = type.startsWith("application/json");
        if (!json && !type.startsWith("application/octet-stream")) invalidRequest("artifact");
        const read = (fields?: Map<string, string>) => {
          const get = (name: string, header: string) =>
            fields ? fields.get(name) : c.req.header(header);
          const masterKey = asMasterKey(get("masterKey", "x-waitron-master-key"), "masterKey");
          const environment = get("environment", "x-waitron-restore-environment");
          if (environment !== "production" && environment !== "preproduction")
            invalidRequest("environment");
          return { masterKey, environment } as const;
        };
        if (!json) read();
        const upload = await deps.receiveArchive!(c.req.raw, {
          fields: ["masterKey", "environment"],
          exactFields: json,
        });
        try {
          const { masterKey, environment } = read(json ? upload.fields : undefined);
          c.header("Cache-Control", "no-store");
          return c.json(
            await preview({
              kind: "archive-file",
              artifactPath: upload.artifactPath,
              recoveryKey: await openingKeyFor(upload, masterKey),
              environment,
            }),
            200,
          );
        } finally {
          await upload.dispose();
        }
      } finally {
        options.setBusy(false);
      }
    });
  });
}

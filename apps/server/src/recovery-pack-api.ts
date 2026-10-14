import type { Hono } from "hono";
import { authorizeManager } from "@waitron/identity";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { createRecoveryPack } from "./recovery-pack.js";
import "./errors.js";

export function mountRecoveryPackApi(
  app: Hono,
  deps: Omit<Parameters<typeof createRecoveryPack>[0], "now" | "authorize"> & {
    readonly now: () => Date;
  },
  log: Logger,
): void {
  const run = createErrorBoundary(
    {
      "management_session.required": 401,
      "management_session.expired": 401,
      "person.suspended": 403,
      "authorization.not_permitted": 403,
      "promotion.break_glass_invalid": 400,
      "recovery.pack_invalid": 400,
      "sif.allocation_invalid": 400,
    },
    "recovery.pack_download_failed",
  );
  app.post("/api/box/recovery-pack", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      const request = await readJsonBody<unknown>(c);
      let personId: string | undefined;
      const pack = await createRecoveryPack(
        {
          ...deps,
          now: deps.now(),
          authorize: async (tx) => {
            personId = (
              await authorizeManager(tx, {
                managementSessionId: token,
                permission: "system.manage",
              })
            ).authorizedBy;
          },
        },
        request,
      );
      log("info", "recovery.pack_downloaded", { personId });
      return c.body(JSON.stringify(pack, null, 2), 200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="waitron-node-recovery-${pack.createdAt.slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      });
    }),
  );
}

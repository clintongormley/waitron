import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { bodyLimit } from "hono/body-limit";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { readAddressLookup } from "./cloud-address-lookup.js";
import type { CloudConnection } from "./cloud-client.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export interface AddressLookupAccess {
  connection?: Pick<CloudConnection, "addressLookup">;
  isPrimary(): boolean;
}

export function mountAddressLookupApi(
  app: Hono,
  path: string,
  { connection, isPrimary }: AddressLookupAccess,
  authorize: (c: Context, passive: boolean) => Promise<unknown>,
  authorizationStatuses: Record<string, ContentfulStatusCode>,
  log: Logger,
): void {
  const run = createErrorBoundary(
    {
      ...authorizationStatuses,
      "cloud.not_primary": 409,
      "cloud.not_configured": 409,
      "cloud.binding_conflict": 409,
      "cloud.busy": 409,
      "cloud.state_invalid": 409,
      "cloud.address_lookup_expired": 410,
      "cloud.unavailable": 503,
    },
    "cloud.failed",
  );
  app.post(
    path,
    (c, next) => {
      c.header("Cache-Control", "no-store");
      return next();
    },
    bodyLimit({
      maxSize: 4096,
      onError: (c) => c.json({ error: { code: "cloud.request_invalid", params: {} } }, 400),
    }),
    (c) =>
      run(c, log, async () => {
        const check = async (passive: boolean) => {
          await authorize(c, passive);
          if (!isPrimary()) throw new AppError("cloud.not_primary", {});
        };
        await check(false);
        if (
          c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
        )
          throw new AppError("cloud.request_invalid", {});
        const input = readAddressLookup(await readRawJsonBody(c));
        if (!connection) {
          if (input.kind === "available") return c.json({ available: false });
          throw new AppError("cloud.not_configured", {});
        }
        return c.json(await connection.addressLookup(input, () => check(true), c.req.raw.signal));
      }),
  );
}

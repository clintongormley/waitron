import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Database } from "@waitron/db";
import { createErrorBoundary } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import { authorizeSystemManager } from "./box-health-api.js";
import type {
  BoxHostRequests,
  HostAnswer,
  PersonActor,
  ProtocolRefusal,
} from "./box-host-client.js";
import "./errors.js";
import type { Logger } from "./logger.js";

export interface BoxHostApiDeps {
  db: Database;
  host: BoxHostRequests;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "box_host.unavailable": 409,
  "box_host.failed": 502,
};

function personActor(authorizedBy: string): PersonActor {
  if (!isUuid(authorizedBy)) throw new Error("a person id the host protocol would refuse");
  return { source: "person", person: authorizedBy };
}

async function askHost<Value extends object, Refusal extends string>(
  call: () => Promise<HostAnswer<Value, Refusal>>,
  onInvalid: () => Error = () =>
    new Error("the host protocol refused a request the route had checked"),
): Promise<Value> {
  const result = await call();
  if (result.available) {
    const value: Partial<typeof result> = { ...result };
    delete value.available;
    return value as Value;
  }
  switch (result.reason) {
    case "missing":
      throw new AppError("box_host.unavailable", { reason: "missing", detail: result.detail });
    case "unsupported":
      throw new AppError("box_host.unavailable", { reason: "unsupported", detail: result.detail });
    case "lost":
    case "timeout":
    case "malformed":
      throw new AppError("box_host.failed", { reason: result.reason });
    case "invalid":
      throw onInvalid();
    case "refused":
      throw new AppError("box_host.failed", { reason: result.refusal as ProtocolRefusal });
  }
}

/** `GET /api/box/network` and `GET /api/box/screen`, both `system.manage`. */
export function mountBoxHostApi(app: Hono, deps: BoxHostApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "box-host-route.failed");
  app.get("/api/box/network", (c) =>
    run(c, log, async () => {
      const actor = personActor(await authorizeSystemManager(deps.db, c));
      return c.json(await askHost(() => deps.host.networkRead(actor)), 200);
    }),
  );
  app.get("/api/box/screen", (c) =>
    run(c, log, async () => {
      const actor = personActor(await authorizeSystemManager(deps.db, c));
      return c.json(await askHost(() => deps.host.screenRead(actor)), 200);
    }),
  );
}

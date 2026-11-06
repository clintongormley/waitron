import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Database } from "@waitron/db";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import { authorizeSystemManager } from "./box-health-api.js";
import type {
  BoxHostRequests,
  HostAnswer,
  PersonActor,
  ProtocolRefusal,
  StartScreen,
} from "./box-host-client.js";
import "./errors.js";
import type { Logger } from "./logger.js";
import { START_SCREENS } from "../../../scripts/box/host-protocol.mjs";
import { isSsidHex } from "../../../scripts/box/wifi-record.mjs";

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
  "box_network.busy": 409,
  "box_network.no_wifi": 409,
  "box_network.not_saved": 409,
};

const BODY_MAX_BYTES = 4096;

type OwnRefusalCode = "box_network.busy" | "box_network.no_wifi" | "box_network.not_saved";

function personActor(authorizedBy: string): PersonActor {
  if (!isUuid(authorizedBy)) throw new Error("a person id the host protocol would refuse");
  return { source: "person", person: authorizedBy };
}

async function askHost<Value extends object, Refusal extends string>(
  call: () => Promise<HostAnswer<Value, Refusal>>,
  own: Record<Exclude<Refusal, ProtocolRefusal>, OwnRefusalCode>,
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
    case "refused": {
      const { refusal } = result;
      if (isOwn(own, refusal)) throw new AppError(own[refusal], {});
      throw new AppError("box_host.failed", { reason: refusal as ProtocolRefusal });
    }
  }
}

function isOwn<Refusal extends string>(
  own: Record<Exclude<Refusal, ProtocolRefusal>, OwnRefusalCode>,
  refusal: Refusal,
): refusal is Exclude<Refusal, ProtocolRefusal> {
  return Object.hasOwn(own, refusal);
}

type FieldChecks<Body> = { [Key in keyof Body]: (value: unknown) => value is Body[Key] };

/** Refuses a body that is not a JSON object with exactly these keys, naming the first key that is
 * missing or wrong, or `body` for anything else, so a caller's own key names never reach the log. */
async function bodyOf<Body extends object>(c: Context, checks: FieldChecks<Body>): Promise<Body> {
  const body = await readRawJsonBody<unknown>(c);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("management.request_invalid", { field: "body" });
  }
  const record = body as Record<string, unknown>;
  for (const [field, check] of Object.entries(checks) as [string, (value: unknown) => boolean][]) {
    if (!Object.hasOwn(record, field) || !check(record[field])) {
      throw new AppError("management.request_invalid", { field });
    }
  }
  if (Object.keys(record).length !== Object.keys(checks).length) {
    throw new AppError("management.request_invalid", { field: "body" });
  }
  return record as Body;
}

const ssidHex = (value: unknown): value is string => isSsidHex(value);
const startScreen = (value: unknown): value is StartScreen =>
  typeof value === "string" && START_SCREENS.includes(value);

/** `GET /api/box/network`, `POST /api/box/network/scan`, `POST /api/box/network/forget`,
 * `GET /api/box/screen` and `POST /api/box/screen`, all `system.manage`. */
export function mountBoxHostApi(app: Hono, deps: BoxHostApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "box-host-route.failed");
  const limit = bodyLimit({
    maxSize: BODY_MAX_BYTES,
    onError: (c) =>
      c.json({ error: { code: "management.request_invalid", params: { field: "body" } } }, 400),
  });
  app.use("/api/box/network/*", limit);
  app.use("/api/box/screen", limit);
  app.get("/api/box/network", (c) =>
    run(c, log, async () => {
      const actor = personActor(await authorizeSystemManager(deps.db, c));
      return c.json(await askHost(() => deps.host.networkRead(actor), {}), 200);
    }),
  );
  app.get("/api/box/screen", (c) =>
    run(c, log, async () => {
      const actor = personActor(await authorizeSystemManager(deps.db, c));
      return c.json(await askHost(() => deps.host.screenRead(actor), {}), 200);
    }),
  );
  app.post("/api/box/network/scan", (c) =>
    run(c, log, async () => {
      const actor = personActor(await authorizeSystemManager(deps.db, c));
      const scanned = await askHost(() => deps.host.networkScan(actor), {
        busy: "box_network.busy",
        no_wifi: "box_network.no_wifi",
      });
      return c.json(scanned, 200);
    }),
  );
  app.post("/api/box/network/forget", (c) =>
    run(c, log, async () => {
      const actor = personActor(await authorizeSystemManager(deps.db, c));
      const forget = await bodyOf(c, { ssidHex });
      await askHost(() => deps.host.networkForget(forget, actor), {
        busy: "box_network.busy",
        not_saved: "box_network.not_saved",
      });
      return c.json({}, 200);
    }),
  );
  app.post("/api/box/screen", (c) =>
    run(c, log, async () => {
      const actor = personActor(await authorizeSystemManager(deps.db, c));
      const set = await bodyOf(c, { start: startScreen });
      return c.json(await askHost(() => deps.host.screenSet(set, actor), {}), 200);
    }),
  );
}

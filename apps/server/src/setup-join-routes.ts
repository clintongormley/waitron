import { type Logger, readJsonBody } from "@waitron/server-kit";
import { AppError, isUnset } from "@waitron/shared";
import type { Hono, Context } from "hono";
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { isSecure } from "./encrypted-connection.js";
import { sentFromThisOrigin } from "./own-page.js";
import { isLoopbackHost } from "./primary-url.js";
import { requestAddress } from "./request-from-box.js";
import type { SetupDeps } from "./setup-api-deps.js";
import { runJoin, directError } from "./setup-api-errors.js";
import { asString } from "./setup-request-fields.js";
import "./errors.js";

/** How long after its last state read the page holding a join's handle still counts as open. */
const JOIN_TAB_LIVE_MS = 15_000;

export function mountSetupJoinRoutes(app: Hono, deps: SetupDeps, log: Logger) {
  // The handle keeps the code on the page that started the join. Only its hash is kept.
  let joinHolder: { handleHash: Buffer; readAt: number } | null = null;
  const handleHash = (handle: string) => createHash("sha256").update(handle).digest();
  const holderOf = (c: Context) => {
    const handle = c.req.header("x-waitron-join-handle");
    return joinHolder !== null &&
      handle !== undefined &&
      timingSafeEqual(handleHash(handle), joinHolder.handleHash)
      ? joinHolder
      : null;
  };
  const refuseJoinElsewhere = (c: Context) => {
    if (!isSecure(c) && !isLoopbackHost(requestAddress(c) ?? "")) {
      throw new AppError("setup.connection_insecure", {});
    }
    if (!sentFromThisOrigin(c)) throw new AppError("setup.owner_required", {});
  };
  /** A start, Yes or cancel without the handle waits until the holding page has stopped reading. */
  const refuseJoinInUse = (c: Context) => {
    if (
      holderOf(c) === null &&
      joinHolder !== null &&
      performance.now() - joinHolder.readAt < JOIN_TAB_LIVE_MS
    )
      throw new AppError("mirror.join_in_use", {});
  };

  app.get("/setup-api/join", (c) =>
    runJoin(c, log, async () => {
      refuseJoinElsewhere(c);
      const state = deps.joinAttempt?.current() ?? null;
      const holder = holderOf(c);
      if (holder !== null) {
        holder.readAt = performance.now();
        return c.json(state ?? { state: "none" });
      }
      if (!isUnset(c.req.header("x-waitron-join-handle"))) return c.json({ state: "replaced" });
      return c.json({ state: state === null ? "none" : "elsewhere" });
    }),
  );

  app.post("/setup-api/join/start", async (c) => {
    const joinAttempt = deps.joinAttempt;
    if (joinAttempt === undefined) return directError(c, log, "setup.not_ready", 503);
    return runJoin(c, log, async () => {
      refuseJoinElsewhere(c);
      const operation = await deps.operations?.read();
      if (operation?.kind === "adopt" && operation.phase !== "started")
        throw new AppError("setup.adopt_incomplete", {});
      if (operation != null) throw new AppError("setup.already_provisioning", {});
      const body = await readJsonBody<{ primaryUrl?: unknown }>(c);
      const primaryUrl = asString(body.primaryUrl, "primaryUrl");
      refuseJoinInUse(c);
      const previous = joinHolder;
      const handle = randomBytes(32).toString("base64url");
      // Live for as long as the start runs; its answer counts as the tab's first read.
      const holder = { handleHash: handleHash(handle), readAt: Number.POSITIVE_INFINITY };
      joinHolder = holder;
      const shown = await joinAttempt.start(primaryUrl).catch((error: unknown) => {
        joinHolder = previous;
        throw error;
      });
      holder.readAt = performance.now();
      return c.json({ ...shown, handle });
    });
  });

  app.post("/setup-api/join/cancel", async (c) => {
    const joinAttempt = deps.joinAttempt;
    if (joinAttempt === undefined) return directError(c, log, "setup.not_ready", 503);
    return runJoin(c, log, async () => {
      refuseJoinElsewhere(c);
      refuseJoinInUse(c);
      const ending = joinHolder;
      await joinAttempt.cancel();
      if (joinHolder === ending) joinHolder = null;
      return c.body(null, 204);
    });
  });

  app.post("/setup-api/join/confirm", async (c) => {
    const joinAttempt = deps.joinAttempt;
    if (joinAttempt === undefined) return directError(c, log, "setup.not_ready", 503);
    return runJoin(c, log, async () => {
      refuseJoinElsewhere(c);
      refuseJoinInUse(c);
      await joinAttempt.confirm();
      return c.body(null, 204);
    });
  });
  return { holderOf, refuseJoinElsewhere };
}

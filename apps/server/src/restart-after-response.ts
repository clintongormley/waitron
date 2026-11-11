import type { ServerResponse } from "node:http";
import type { Context } from "hono";
import { isAppError } from "@waitron/shared";
import { errnoOf } from "./errno.js";
import type { Logger } from "./logger.js";

export function outgoingOf(c: Context): ServerResponse | undefined {
  return (c.env as { outgoing?: ServerResponse } | undefined)?.outgoing;
}

/**
 * Runs `restart` once the answer is written or the connection is gone, whichever comes first:
 * exiting before the socket has flushed returns an empty body, and a browser that disconnects
 * mid-answer closes the response without `'finish'`. Runs at once when there is no response or it
 * is already over. A failed restart is logged rather than ending the process.
 */
export function restartAfterResponse(
  outgoing: ServerResponse | undefined,
  restart: () => void | Promise<void>,
  log?: Logger,
): void {
  const failed = (error: unknown) => {
    try {
      log?.("error", "server.restart_failed", {
        errorCode: isAppError(error) ? error.code : null,
        errno: errnoOf(error) ?? null,
        reason: isAppError(error) ? (error.reason ?? null) : null,
      });
    } catch {
      // Nothing is left to tell.
    }
  };
  let requested = false;
  const run = () => {
    if (requested) return;
    requested = true;
    outgoing?.off("finish", run);
    outgoing?.off("close", run);
    try {
      void Promise.resolve(restart()).catch(failed);
    } catch (error) {
      failed(error);
    }
  };
  if (
    outgoing === undefined ||
    outgoing.writableFinished ||
    outgoing.destroyed ||
    outgoing.closed
  ) {
    run();
    return;
  }
  outgoing.once("finish", run);
  outgoing.once("close", run);
}

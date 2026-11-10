import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { AppError, type ResourceIdentity } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import type { LiveEvents } from "./live-api.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export interface LiveStreamOptions {
  bus: LiveEvents;
  interests: readonly ResourceIdentity[];
  recheck: () => Promise<void>;
  invalidCodes: ReadonlySet<string>;
  sendIds: boolean;
  log: Logger;
  keepaliveMs?: number;
  /** Transfer invalidation retains no identities and carries an empty object. */
  invalidationOnly?: boolean;
}

export function parseInterests(
  raw: string | undefined,
  allowed: ReadonlySet<string>,
): ResourceIdentity[] {
  const invalid = (): never => {
    throw new AppError("management.request_invalid", { field: "resources" });
  };
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "null");
  } catch {
    return invalid();
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) return invalid();
  return (value as unknown[]).map((identity) => {
    if (
      identity === null ||
      typeof identity !== "object" ||
      !("type" in identity) ||
      typeof identity.type !== "string" ||
      !allowed.has(identity.type)
    )
      return invalid();
    if (!("id" in identity)) return { type: identity.type };
    if (typeof identity.id !== "string" || identity.id.length === 0 || identity.id.length > 200)
      return invalid();
    return { type: identity.type, id: identity.id };
  });
}

export function liveStreamResponse(c: Context, options: LiveStreamOptions): Response {
  const response = streamSSE(c, async (stream) => {
    const pending = new Map<string, ResourceIdentity>();
    let reset = false;
    let invalidated = false;
    let closed = false;
    let wake = (): void => {};
    const unsubscribe = options.bus.subscribe((event) => {
      if (event.kind === "close") closed = true;
      else {
        for (const resource of event.change.resources) {
          if (
            options.interests.some(
              (interest) =>
                interest.type === resource.type &&
                (interest.id === undefined ||
                  resource.id === undefined ||
                  interest.id === resource.id),
            )
          ) {
            if (options.invalidationOnly) invalidated = true;
            else {
              const identity = options.sendIds ? resource : { type: resource.type };
              pending.set(JSON.stringify(identity), identity);
            }
          }
        }
        if (pending.size === 0 && !invalidated) return;
        // Slow readers receive a bounded reset instead of retaining an unbounded identity queue.
        if (pending.size > 256) {
          pending.clear();
          reset = true;
        }
      }
      wake();
    });
    const timer = setInterval(() => wake(), 15_000);
    const cleanup = (): void => {
      closed = true;
      clearInterval(timer);
      unsubscribe();
      wake();
    };
    stream.onAbort(cleanup);
    try {
      await stream.writeSSE({ event: "ready", data: "{}" });
      while (!closed && !stream.aborted) {
        if (!reset && pending.size === 0 && !invalidated)
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        if (closed || stream.aborted) break;
        try {
          await options.recheck();
        } catch (error) {
          const code = codeOf(error);
          if (options.invalidCodes.has(code)) {
            await stream.writeSSE({ event: "session-invalid", data: JSON.stringify({ code }) });
          } else options.log("warn", "live.stream_failed", { errorCode: code });
          break;
        }
        if (closed || stream.aborted) break;
        const identities = [...pending.values()];
        pending.clear();
        const event = reset
          ? "reset"
          : invalidated || identities.length > 0
            ? "change"
            : "keepalive";
        reset = false;
        invalidated = false;
        await stream.writeSSE({
          event,
          data: options.invalidationOnly ? "{}" : JSON.stringify(identities),
        });
      }
    } catch (error) {
      options.log("warn", "live.stream_failed", { errorCode: codeOf(error) });
    } finally {
      cleanup();
    }
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Accel-Buffering", "no");
  return response;
}

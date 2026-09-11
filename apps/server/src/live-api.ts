import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { AppError, type ResourceChange, type ResourceIdentity } from "@waitron/shared";
import { resolveManagementSession } from "@waitron/identity";
import { createErrorBoundary, requireManagementSession, codeOf } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import "./errors.js";

type BusEvent = { kind: "change"; change: ResourceChange } | { kind: "reset" } | { kind: "close" };

export class LiveEvents {
  #listeners = new Set<(event: BusEvent) => void>();
  #closed = false;
  get subscriberCount(): number {
    return this.#listeners.size;
  }
  subscribe(listener: (event: BusEvent) => void): () => void {
    if (this.#closed) queueMicrotask(() => listener({ kind: "close" }));
    else this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  publish(change: ResourceChange): void {
    for (const listener of this.#listeners) listener({ kind: "change", change });
  }
  reset(): void {
    for (const listener of this.#listeners) listener({ kind: "reset" });
  }
  close(): void {
    this.#closed = true;
    for (const listener of this.#listeners) listener({ kind: "close" });
    this.#listeners.clear();
  }
}

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "management.request_invalid": 400,
  },
  "live.stream_failed",
);

function parseInterests(raw: string | undefined, allowed: ReadonlySet<string>): ResourceIdentity[] {
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

/** Events expose identities to signed-in venue people; resource reads retain their own authorization. */
export function mountLiveApi(
  app: Hono,
  deps: { db: Database; tenantId: string; bus: LiveEvents; resourceTypes: readonly string[] },
  log: Logger,
): void {
  const allowed = new Set(deps.resourceTypes);
  app.get("/management-api/events", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const authenticate = async (): Promise<void> => {
        await withTenant(deps.db, deps.tenantId, async (tx) => {
          await asAppUser(tx);
          const session = await resolveManagementSession(tx, sessionId, { touch: false });
          if (session.tenantId !== deps.tenantId)
            throw new AppError("management_session.required", {});
        });
      };
      await authenticate();
      const interests = parseInterests(c.req.query("resources"), allowed);
      const response = streamSSE(c, async (stream) => {
        const pending = new Map<string, ResourceIdentity>();
        let reset = false;
        let closed = false;
        let wake = (): void => {};
        const unsubscribe = deps.bus.subscribe((event) => {
          if (event.kind === "close") closed = true;
          else if (event.kind === "reset") reset = true;
          else {
            if (event.change.tenantId !== null && event.change.tenantId !== deps.tenantId) return;
            for (const resource of event.change.resources) {
              if (
                interests.some(
                  (interest) =>
                    interest.type === resource.type &&
                    (interest.id === undefined ||
                      resource.id === undefined ||
                      interest.id === resource.id),
                )
              ) {
                pending.set(JSON.stringify(resource), resource);
              }
            }
            if (pending.size === 0) return;
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
            if (!reset && pending.size === 0)
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            if (closed || stream.aborted) break;
            try {
              await authenticate();
            } catch (error) {
              const code = codeOf(error);
              if (
                code === "management_session.required" ||
                code === "management_session.expired" ||
                code === "person.suspended"
              ) {
                await stream.writeSSE({ event: "session-invalid", data: JSON.stringify({ code }) });
              } else log("warn", "live.stream_failed", { errorCode: code });
              break;
            }
            if (closed || stream.aborted) break;
            const identities = [...pending.values()];
            pending.clear();
            const event = reset ? "reset" : identities.length > 0 ? "change" : "keepalive";
            reset = false;
            await stream.writeSSE({ event, data: JSON.stringify(identities) });
          }
        } catch (error) {
          log("warn", "live.stream_failed", { errorCode: codeOf(error) });
        } finally {
          cleanup();
        }
      });
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Accel-Buffering", "no");
      return response;
    }),
  );
}

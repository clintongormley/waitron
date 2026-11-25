import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { withTransaction, type Database } from "@waitron/db";
import { type ResourceChange, type ResourceIdentity } from "@waitron/shared";
import { resolveManagementSession, checkManagementSession } from "@waitron/identity";
import { createErrorBoundary, requireManagementSession, codeOf } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { liveStreamResponse, parseInterests } from "./live-stream.js";
import "./errors.js";

type BusEvent = { kind: "change"; change: ResourceChange } | { kind: "close" };

export class LiveEvents {
  #listeners = new Set<(event: BusEvent) => void>();
  #closed = false;
  readonly #run = randomUUID();
  #published = 0;
  #lastChanged = new Map<string, number>();

  /** Names this server run and how many changes it has announced. A change is announced only after
   * its commit, so a read sent after a position was handed out sees everything the position covers. */
  get position(): string {
    return `${this.#run}:${this.#published}`;
  }
  /** The types among `interests` that changed after `position`, or undefined when that is unknown. */
  changedSince(
    position: string | undefined,
    interests: readonly ResourceIdentity[],
  ): ResourceIdentity[] | undefined {
    const [run, number = ""] = position?.split(":") ?? [];
    const since = Number(number);
    if (run !== this.#run || !/^\d+$/.test(number) || since > this.#published) return undefined;
    const types = new Set(interests.map(({ type }) => type));
    return [...types]
      .filter((type) => (this.#lastChanged.get(type) ?? 0) > since)
      .map((type) => ({ type }));
  }
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
    this.#published += 1;
    for (const { type } of change.resources) this.#lastChanged.set(type, this.#published);
    for (const listener of this.#listeners) listener({ kind: "change", change });
  }
  close(): void {
    this.#closed = true;
    for (const listener of this.#listeners) listener({ kind: "close" });
    this.#listeners.clear();
  }
}

/**
 * Publishes a change onto the bus, absorbing whatever a subscriber does with it.
 *
 * The change feed runs on the writing request's own call stack, after its transaction has
 * committed, so a throw here would fail a request whose write already succeeded.
 */
export function changeSubscriber(bus: LiveEvents, log: Logger): (change: ResourceChange) => void {
  return (change) => {
    try {
      bus.publish(change);
    } catch (error) {
      log("warn", "live.publish_failed", { errorCode: codeOf(error) });
    }
  };
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

/** Events expose identities to signed-in venue people; resource reads retain their own authorization. */
export function mountLiveApi(
  app: Hono,
  deps: { db: Database; bus: LiveEvents; resourceTypes: readonly string[] },
  log: Logger,
): void {
  const allowed = new Set(deps.resourceTypes);
  app.get("/management-api/events", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const authenticate = async (): Promise<void> => {
        await withTransaction(deps.db, async (tx) => {
          await resolveManagementSession(tx, sessionId, { touch: false });
        });
      };
      await authenticate();
      const interests = parseInterests(c.req.query("resources"), allowed);
      return liveStreamResponse(c, {
        bus: deps.bus,
        interests,
        recheck: () => checkManagementSession(deps.db, sessionId),
        invalidCodes: new Set([
          "management_session.required",
          "management_session.expired",
          "person.suspended",
          "authorization.inspection_only",
        ]),
        sendIds: true,
        log,
        catchUp: { since: c.req.query("since") },
      });
    }),
  );
}

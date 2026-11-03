import type { Hono } from "hono";
import type { NodeDatabase } from "@waitron/db";
import type { SignedMembershipDocument } from "@waitron/membership";
import { codeOf } from "@waitron/server-kit";
import type { StartedServer } from "./boot.js";
import type { DeploymentEnvironment } from "./config.js";
import { createHandoverGate } from "./handover-gate.js";
import { stepDown, type StepDownRequest, type StepDownResult } from "./handover-stepdown.js";
import { healthApp, type HealthState } from "./health.js";
import type { Logger } from "./logger.js";
import { mountNodeApi } from "./node-api.js";
import type { StartPeerCheckOutcome } from "./start-peer-check.js";
import { waitingPageRoute } from "./waiting-page.js";

/** The page's words say "every 15 seconds"; change both together. */
export const WAIT_RECHECK_MS = 15_000;

/** What the routes of the waiting start may ask of it. */
export interface WaitingHooks {
  /** Writes the restriction, then closes the waiting start and restarts the process. */
  stepDown: (request: StepDownRequest) => Promise<StepDownResult>;
  /** Ends the wait as a peer's `proceed` would; does nothing once the wait has ended. */
  carryOn: () => Promise<void>;
}

export interface WaitingStartDeps {
  /** The start's health state; `/health` answers that the box takes no sales while it waits. */
  health: HealthState;
  now: () => Date;
  venueDir?: string;
  nodeId: string;
  environment: DeploymentEnvironment;
  readMembership: () => Promise<SignedMembershipDocument | null>;
  /** The boxes this one waits for, as the check that began the wait named them. */
  waitingOn: readonly string[];
  /** The page's name for each box, or `null` where it has none. */
  namesOf: (ids: readonly string[]) => Promise<readonly (string | null)[]>;
  /** The peer routes, mounted on the waiting start's own app. */
  routes: ((app: Hono, hooks: WaitingHooks) => void)[];
  node: NodeDatabase;
  /** The start check, asked again every `intervalMs` until it answers other than `wait`. */
  recheck: () => Promise<StartPeerCheckOutcome>;
  intervalMs: number;
  /** Binds the waiting start's listeners; `close` closes them and nothing else. */
  listen: (app: Hono) => { close(): Promise<void> };
  closeStore: () => Promise<void>;
  restart: () => void;
  log: Logger;
}

export type WaitEnd =
  | { kind: "checked"; outcome: StartPeerCheckOutcome }
  | { kind: "carried-on" }
  /** Closed by a shutdown or a stepdown: the store is closed and the start must not go on. */
  | { kind: "stopped" };

export interface WaitingStart {
  /** What the start answers while it waits; `close` stops the wait and closes the store. */
  server: StartedServer;
  /** Settles once the listeners and timer are gone; a `checked` or `carried-on` start goes on. */
  ended: Promise<WaitEnd>;
  carryOn: () => Promise<void>;
}

/**
 * A box whose check found no joined peer answering serves only its status and the peer routes, from
 * its own app and listeners, and asks again until a peer answers. Nothing here sells or files.
 */
export function startWaiting(deps: WaitingStartDeps): WaitingStart {
  const { log } = deps;
  const app = healthApp(deps.health, deps.now, {
    ...(deps.venueDir === undefined ? {} : { venueDir: deps.venueDir }),
  });
  const gate = createHandoverGate();
  app.use("*", gate.middleware);
  mountNodeApi(
    app,
    {
      nodeId: deps.nodeId,
      acceptingSales: false,
      environment: deps.environment,
      readMembership: deps.readMembership,
    },
    log,
  );
  let waitingOn = deps.waitingOn;
  waitingPageRoute(() => deps.namesOf(waitingOn))(app);

  let resolveEnd: (end: WaitEnd) => void = () => {};
  const ended = new Promise<WaitEnd>((resolve) => (resolveEnd = resolve));
  let leaving = false;
  // Set before the stepdown's first await, so an answer that lands while the restriction is being
  // written never continues the start the stepdown is about to restart.
  let steppingDown = false;
  let timer: NodeJS.Timeout | undefined;
  // The store stays open until a re-ask that is reading or saving through it has settled.
  let asking: Promise<unknown> = Promise.resolve();

  const leave = async (end: WaitEnd): Promise<void> => {
    if (leaving) return;
    leaving = true;
    clearTimeout(timer);
    try {
      await listeners.close();
    } catch (error) {
      log("warn", "waiting_start.close_failed", { errorCode: codeOf(error) });
    }
    if (end.kind === "stopped") {
      await asking;
      await deps.closeStore();
    } else deps.health.takesNoSales = false;
    resolveEnd(end);
  };

  const hooks: WaitingHooks = {
    stepDown: (request) => {
      steppingDown = true;
      return stepDown(
        {
          node: deps.node,
          nodeId: deps.nodeId,
          gate,
          // Nothing runs in the background while the box waits but the re-ask, which
          // `steppingDown` stops.
          duties: { aborts: [], closers: [] },
          close: () => leave({ kind: "stopped" }),
          restart: deps.restart,
          log,
        },
        request,
      );
    },
    carryOn: () => (steppingDown ? Promise.resolve() : leave({ kind: "carried-on" })),
  };
  for (const mount of deps.routes) mount(app, hooks);

  const ask = async (): Promise<void> => {
    let outcome: StartPeerCheckOutcome | null = null;
    const pending = deps.recheck();
    asking = pending.catch(() => {});
    try {
      outcome = await pending;
    } catch (error) {
      log("warn", "waiting_start.recheck_failed", { errorCode: codeOf(error) });
    }
    if (leaving || steppingDown) return;
    if (outcome !== null && outcome.result !== "wait") {
      await leave({ kind: "checked", outcome });
      return;
    }
    if (outcome?.waitingOn !== undefined) waitingOn = outcome.waitingOn;
    timer = setTimeout(() => void ask(), deps.intervalMs);
  };

  deps.health.takesNoSales = true;
  const listeners = deps.listen(app);
  timer = setTimeout(() => void ask(), deps.intervalMs);
  log("info", "waiting_start.waiting", { waitingOn });

  return {
    server: {
      health: deps.health,
      close: async () => {
        await leave({ kind: "stopped" });
        await ended;
      },
    },
    ended,
    carryOn: hooks.carryOn,
  };
}
